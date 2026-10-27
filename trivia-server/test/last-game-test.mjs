// Protocol-level tests for the host-only "last game" results feature —
// g.lastGameSummary (built in finish()) and the getLastGame/'lastGame'
// request/response pair. Same raw-socket style as teams-test.mjs.
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
  async wait(t, ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.last(t); if (m) return m; await sleep(60); }
    throw new Error(`${this.name}: no '${t}' in ${ms}ms`);
  }
  async waitFor(pred, ms = 25000) {
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
  const r = room();
  const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
  const B = new C('Bea', r); await B.connect(); await B.wait('welcome');
  const Cat = new C('Cat', r); await Cat.connect(); await Cat.wait('welcome');

  // Before any game has ever finished here — explicit null, not an error,
  // not a stale object from a different room.
  B.send({ type: 'getLastGame' });
  const notHost = await B.wait('error', 4000);
  ok(/only the host/i.test(notHost.message || ''), 'getLastGame from a non-host is refused', notHost);

  A.send({ type: 'getLastGame' });
  const empty = await A.wait('lastGame', 4000);
  ok(empty.summary === null, 'getLastGame before any game has finished returns summary: null', empty);

  A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'custom', rounds: 1, questionsPerRound: 1, questionMs: 20000 } });
  await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
  A.send({
    type: 'questions', items: [
      { text: 'Capital of France?', choices: ['Paris', 'Rome', 'Berlin', 'Madrid'], correctIndex: 0 },
    ],
  });
  await A.wait('customQuestions');

  A.send({ type: 'teamSetup', count: 2, names: ['Red', 'Blue'] });
  const r1 = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
  const redId = r1.teams[0].id, blueId = r1.teams[1].id;
  B.send({ type: 'joinTeam', teamId: redId });
  await B.waitFor((m) => m.type === 'roster');
  Cat.send({ type: 'joinTeam', teamId: blueId });
  await Cat.waitFor((m) => m.type === 'roster');

  A.send({ type: 'openEvent' });
  await A.wait('phase');
  A.send({ type: 'start' });
  const q = await B.wait('question');

  // Red gets it right, Blue gets it wrong.
  // Choices are shuffled at save time (onQuestions), so "Paris" is not
  // necessarily index 0 by the time it's actually played, and the live
  // 'question' message carries no correctIndex (THE INVARIANT) — find it
  // the way a player who already knows the answer would: by its text,
  // among the choices that ARE sent.
  const correctChoice = q.choices.indexOf('Paris');
  const wrongChoice = (correctChoice + 1) % 4;
  B.send({ type: 'answer', index: q.index, choice: correctChoice }); // Red — correct
  await sleep(150);
  Cat.send({ type: 'answer', index: q.index, choice: wrongChoice }); // Blue — wrong

  // Both answered early -> the 5s flash/hold from the early-reveal feature.
  await A.wait('reveal', 7000);

  // Teams mode is host-paced — advance off the single question to finish().
  A.send({ type: 'next' });
  await A.wait((m) => true, 100).catch(() => {}); // let it process
  const fin = await A.wait('final', 4000);
  ok(fin.mode === 'teams', 'the game actually reached final', fin);
  // Safe to broadcast by now — every question has already been revealed
  // live, so a correct-count on the FINAL standings (not just the
  // host-only lastGame summary) leaks nothing THE INVARIANT cares about.
  const finRed = fin.standings.find((s) => s.id === redId);
  const finBlue = fin.standings.find((s) => s.id === blueId);
  ok(finRed && finRed.correct === 1 && finRed.total === 1,
     'the final broadcast itself carries a correct/total count for the winner', finRed);
  ok(finBlue && finBlue.correct === 0 && finBlue.total === 1,
     'and for the team that got it wrong', finBlue);

  // Now ask for last game's results.
  A.msgs.length = 0;
  A.send({ type: 'getLastGame' });
  const lg = await A.wait('lastGame', 4000);
  const summary = lg.summary;
  ok(!!summary, 'getLastGame now returns a real summary', lg);
  ok(summary.mode === 'teams', 'summary carries the mode', summary);
  ok(Array.isArray(summary.standings) && summary.standings.length === 2,
     'summary carries final standings for both teams', summary.standings);
  ok(Array.isArray(summary.questions) && summary.questions.length === 1,
     'summary carries exactly one question (this was a 1-question game)', summary.questions);

  const q0 = summary.questions[0];
  ok(q0.text === 'Capital of France?' && q0.choices[q0.correctIndex] === 'Paris',
     'the question entry carries its text and correct answer', q0);
  const redRow = q0.perTeam.find((t) => t.id === redId);
  const bluRow = q0.perTeam.find((t) => t.id === blueId);
  ok(redRow && redRow.correct === true && redRow.name === 'Red',
     'Red\'s per-question row is marked correct, with its name snapshotted', redRow);
  ok(bluRow && bluRow.correct === false && bluRow.name === 'Blue',
     'Blue\'s per-question row is marked incorrect', bluRow);

  const redStanding = summary.standings.find((s) => s.id === redId);
  const bluStanding = summary.standings.find((s) => s.id === blueId);
  ok(redStanding.score > bluStanding.score, 'Red (correct) outscored Blue (wrong) in the final standings', summary.standings);

  // Non-host still refused, even though a real summary now exists.
  B.msgs.length = 0;
  B.send({ type: 'getLastGame' });
  const stillRefused = await B.wait('error', 4000);
  ok(/only the host/i.test(stillRefused.message || ''), 'a non-host is still refused even once a summary exists', stillRefused);

  A.close(); B.close(); Cat.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack || e));
}

notes.forEach((l) => console.log(l));
fails.forEach((l) => console.log(l));
console.log(`passed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
