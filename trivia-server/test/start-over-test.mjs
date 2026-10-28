// Protocol-level tests for 'startOver' — the host's way to abandon a game
// that already went live (standby/intro/question/reveal/final) and reset
// straight back to the lobby, without tearing down the room or roster.
// Same raw-socket style as teams-test.mjs.
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
  // ---- 1. Refused from a non-host, and from 'lobby' (nothing to restart) -
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');

    B.msgs.length = 0;
    B.send({ type: 'startOver' });
    const notHost = await B.wait('error');
    ok(/only the host/i.test(notHost.message || ''), 'startOver from a non-host is refused', notHost);

    A.msgs.length = 0;
    A.send({ type: 'startOver' });
    const nothingYet = await A.wait('error');
    ok(/nothing in progress/i.test(nothingYet.message || ''), 'startOver from the lobby itself is refused', nothingYet);

    A.close(); B.close();
  }

  await sleep(200);
  // ---- 2. From standby: resets to lobby, keeps the roster/teams, resets
  //         scores, and every connected client hears about it. --------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'custom', rounds: 1, questionsPerRound: 1, questionMs: 20000 } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    A.send({ type: 'teamSetup', count: 1, names: ['Solo'] });
    const r1 = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
    const teamId = r1.teams[0].id;
    B.send({ type: 'joinTeam', teamId });
    await B.waitFor((m) => m.type === 'roster');
    A.send({ type: 'openEvent' });
    await A.wait('phase');

    A.msgs.length = 0; B.msgs.length = 0;
    A.send({ type: 'startOver' });
    const phaseA = await A.wait('phase');
    const phaseB = await B.wait('phase');
    ok(phaseA.phase === 'lobby', 'startOver from standby lands everyone back in the lobby', phaseA);
    ok(phaseB.phase === 'lobby', 'including every other connected client', phaseB);

    const noticeA = await A.wait('notice');
    const noticeB = await B.wait('notice');
    ok(noticeA.code === 'startOver', 'a notice explains what just happened, to the host too', noticeA);
    ok(noticeB.code === 'startOver', 'and to everyone else', noticeB);

    const rosterAfter = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
    ok(rosterAfter.teams[0].id === teamId, 'the team itself survives the reset — same id, not recreated', rosterAfter.teams);
    ok(rosterAfter.players.length === 2, 'and both players are still in the room', rosterAfter.players);

    // The room is not broken afterward — the host can open the doors again.
    A.msgs.length = 0;
    A.send({ type: 'openEvent' });
    const reopened = await A.wait('phase');
    ok(reopened.phase === 'standby', 'and the event can be reopened right away, no new room needed', reopened);

    A.close(); B.close();
  }

  await sleep(200);
  // ---- 3. Mid-game (an actual live question): still works, and a team's
  //         just-earned score is wiped along with everything else. ---------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'custom', rounds: 1, questionsPerRound: 1, questionMs: 20000 } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    A.send({
      type: 'questions', items: [
        { text: 'Capital of France?', choices: ['Paris', 'Rome', 'Berlin', 'Madrid'], correctIndex: 0 },
      ],
    });
    await A.wait('customQuestions');
    A.send({ type: 'teamSetup', count: 1, names: ['Solo'] });
    const r1 = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
    const teamId = r1.teams[0].id;
    B.send({ type: 'joinTeam', teamId });
    await B.waitFor((m) => m.type === 'roster');
    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.send({ type: 'start' });
    const q = await A.wait('question');

    const correctIndex = q.choices.indexOf('Paris');
    B.msgs.length = 0;
    B.send({ type: 'answer', index: q.index, choice: correctIndex });
    await B.wait('answered');

    // Non-host refused even mid-question.
    B.msgs.length = 0;
    B.send({ type: 'startOver' });
    const notHost = await B.wait('error');
    ok(/only the host/i.test(notHost.message || ''), 'startOver mid-question from a non-host is still refused', notHost);

    A.msgs.length = 0; B.msgs.length = 0;
    A.send({ type: 'startOver' });
    const phaseA = await A.wait('phase');
    ok(phaseA.phase === 'lobby', 'startOver works even from a live question, not just standby/final', phaseA);

    const rosterAfter = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
    ok(rosterAfter.teams[0].score === 0, 'the team\'s in-progress score is reset along with everything else', rosterAfter.teams[0]);

    A.close(); B.close();
  }
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack || e));
}

notes.forEach((l) => console.log(l));
fails.forEach((l) => console.log(l));
console.log(`passed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
