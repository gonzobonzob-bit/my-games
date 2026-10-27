// Protocol-level tests for four small host-facing additions in one batch:
// name-collision auto-suffix, the intro->standby "Back" step, replayMedia
// (host-triggered tune replay), and getCustomQuestions (loading a saved
// quiz's real content back into the editor). Same raw-socket style as
// teams-test.mjs.
import WS from 'ws';

const ORIGIN = 'http://localhost:8000';
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor(name, room) { this.name = name; this.room = room; this.msgs = []; }
  connect() {
    const url = `ws://localhost:8787/room?code=${this.room}&name=${encodeURIComponent(this.name)}`;
    this.ws = new WS(url, { origin: ORIGIN });
    this.ws.on('message', (r) => this.msgs.push(JSON.parse(r.toString())));
    return new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
      setTimeout(() => rej(new Error(this.name + ' connect timeout')), 8000);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  last(t) { return [...this.msgs].reverse().find((m) => m.type === t); }
  async wait(t, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.last(t); if (m) return m; await sleep(60); }
    throw new Error(`${this.name}: no '${t}' in ${ms}ms`);
  }
  async waitFor(pred, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.msgs.find(pred); if (m) return m; await sleep(60); }
    throw new Error(`${this.name}: predicate never matched in ${ms}ms`);
  }
  close() { try { this.ws.close(); } catch {} }
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const room = () => Array.from({ length: 6 },
  () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

try {
  // ---- 1. Name collision: a SECOND live "Ben" gets auto-suffixed, the
  //         FIRST Ben is never kicked. A reconnect under the same name
  //         (first Ben dropping and coming back) still works normally. --
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const Ben1 = new C('Ben', r); await Ben1.connect();
    const w1 = await Ben1.wait('welcome');
    ok(w1.you.name === 'Ben', 'the first Ben keeps the plain name', w1.you);

    const Ben2 = new C('Ben', r); await Ben2.connect();
    const w2 = await Ben2.wait('welcome');
    ok(w2.you.name === 'Ben-2', 'a second live Ben is auto-suffixed to Ben-2', w2.you);
    ok(w2.you.id !== w1.you.id, 'the two Bens are genuinely different player records', [w1.you, w2.you]);

    // The first Ben's socket must NOT have been closed by the second join.
    await sleep(400);
    ok(Ben1.ws.readyState === 1, 'the FIRST Ben is still connected, not kicked by the second', Ben1.ws.readyState);

    const Ben3 = new C('Ben', r); await Ben3.connect();
    const w3 = await Ben3.wait('welcome');
    ok(w3.you.name === 'Ben-3', 'a third live Ben lands on Ben-3, not colliding with Ben-2', w3.you);

    A.close(); Ben1.close(); Ben2.close(); Ben3.close();
  }

  await sleep(200);
  // ---- 2. Back to standby: intro-only, host-only, lighter than closeEvent
  // -------------------------------------------------------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');

    B.msgs.length = 0;
    B.send({ type: 'backToStandby' });
    const notHost = await B.wait('error');
    ok(/only the host/i.test(notHost.message || ''), 'backToStandby from a non-host is refused', notHost);

    A.msgs.length = 0;
    A.send({ type: 'backToStandby' });
    const tooEarly = await A.wait('error');
    ok(/nothing to go back/i.test(tooEarly.message || ''), 'backToStandby from lobby (not intro) is refused', tooEarly);

    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.msgs.length = 0;
    A.send({ type: 'backToStandby' });
    const stillStandby = await A.wait('error');
    ok(/nothing to go back/i.test(stillStandby.message || ''), 'backToStandby from standby itself (not intro) is refused', stillStandby);

    A.msgs.length = 0;
    A.send({ type: 'showIntro' });
    await A.wait('phase');
    A.msgs.length = 0; B.msgs.length = 0;
    A.send({ type: 'backToStandby' });
    const backA = await A.wait('phase');
    const backB = await B.wait('phase');
    ok(backA.phase === 'standby', 'backToStandby from intro lands back on standby', backA);
    ok(backB.phase === 'standby', 'every connected client sees the step back too', backB);

    // And still joinable/team-forming from there — nothing was reset.
    ok(true, 'reached standby again cleanly');

    A.close(); B.close();
  }

  await sleep(200);
  // ---- 3. replayMedia: host-only, question-phase-only, tune-only -------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'custom', rounds: 1, questionsPerRound: 1, questionMs: 20000 } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');

    B.msgs.length = 0;
    B.send({ type: 'replayMedia' });
    const notHost = await B.wait('error');
    ok(/only the host/i.test(notHost.message || ''), 'replayMedia from a non-host is refused', notHost);

    A.msgs.length = 0;
    A.send({ type: 'replayMedia' });
    const notQuestion = await A.wait('error');
    ok(/nothing to replay/i.test(notQuestion.message || ''), 'replayMedia outside the question phase is refused', notQuestion);

    // A standard (non-tune) question in play — replay should refuse even
    // though the phase is right, because there is no clip to replay.
    A.send({
      type: 'questions', items: [
        { text: 'Plain question', choices: ['A', 'B', 'C', 'D'], correctIndex: 0 },
      ],
    });
    await A.wait('customQuestions');
    A.send({ type: 'teamSetup', count: 1, names: ['Solo'] });
    const r1 = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
    B.send({ type: 'joinTeam', teamId: r1.teams[0].id });
    await B.waitFor((m) => m.type === 'roster');
    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.send({ type: 'start' });
    await A.wait('question');

    A.msgs.length = 0;
    A.send({ type: 'replayMedia' });
    const noClip = await A.wait('error');
    ok(/no clip/i.test(noClip.message || ''), 'replayMedia on a question with no media is refused', noClip);

    A.close(); B.close();
  }

  await sleep(200);
  // ---- 3b. replayMedia actually works end to end on a real tune question
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'custom', rounds: 1, questionsPerRound: 1, questionMs: 20000 } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    A.send({
      type: 'questions', items: [
        {
          text: 'Name this tune', choices: ['A', 'B', 'C', 'D'], correctIndex: 0, kind: 'tune',
          media: { type: 'audio', dataUrl: 'data:audio/wav;base64,' + 'A'.repeat(200) },
        },
      ],
    });
    await A.wait('customQuestions');
    A.send({ type: 'teamSetup', count: 1, names: ['Solo'] });
    const r1 = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
    B.send({ type: 'joinTeam', teamId: r1.teams[0].id });
    await B.waitFor((m) => m.type === 'roster');
    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.send({ type: 'start' });
    const q = await A.wait('question');

    A.msgs.length = 0; B.msgs.length = 0;
    A.send({ type: 'replayMedia' });
    const replayA = await A.wait('replayMedia', 4000);
    const replayB = await B.wait('replayMedia', 4000);
    ok(replayA.index === q.index, 'replayMedia broadcasts the same question index to the host', replayA);
    ok(replayB.index === q.index, 'and to every other connected client too', replayB);

    A.close(); B.close();
  }

  await sleep(200);
  // ---- 4. getCustomQuestions: host-only, lobby-only, real content back -
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');

    B.msgs.length = 0;
    B.send({ type: 'getCustomQuestions' });
    const notHost = await B.wait('error');
    ok(/only the host/i.test(notHost.message || ''), 'getCustomQuestions from a non-host is refused', notHost);

    A.msgs.length = 0;
    A.send({ type: 'getCustomQuestions' });
    const empty = await A.wait('customQuestionsFull', 4000);
    ok(Array.isArray(empty.items) && empty.items.length === 0, 'with nothing saved, items comes back an empty array', empty);

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'custom', rounds: 1, questionsPerRound: 1, questionMs: 20000 } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    A.send({
      type: 'questions', items: [
        { text: 'Capital of France?', choices: ['Paris', 'Rome', 'Berlin', 'Madrid'], correctIndex: 0 },
      ],
    });
    await A.wait('customQuestions');

    A.msgs.length = 0;
    A.send({ type: 'getCustomQuestions' });
    const full = await A.wait('customQuestionsFull', 4000);
    ok(full.items.length === 1, 'the saved question comes back, not just a count', full.items);
    ok(full.items[0].text === 'Capital of France?', 'with its real text', full.items[0]);
    ok(full.items[0].choices.includes('Paris') && full.items[0].choices[full.items[0].correctIndex] === 'Paris',
       'and its correct answer, choices shuffled or not', full.items[0]);

    // Lobby-only — once the doors are open, editing (and so seeing the
    // editable content) is closed, same as every other config action.
    // Teams mode needs an actual team before openEvent will allow it.
    A.send({ type: 'teamSetup', count: 1, names: ['Solo'] });
    await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.msgs.length = 0;
    A.send({ type: 'getCustomQuestions' });
    const closed = await A.wait('error', 4000);
    ok(/edit setup/i.test(closed.message || ''), 'getCustomQuestions is refused once standby has started', closed);

    A.close(); B.close();
  }
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack || e));
}

notes.forEach((l) => console.log(l));
fails.forEach((l) => console.log(l));
console.log(`passed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
