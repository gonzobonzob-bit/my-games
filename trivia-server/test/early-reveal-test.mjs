// Protocol-level tests for the teams-mode "everyone answered early" flow:
// triggerEarlyReveal() in trivia-server/src/index.js. Same raw-socket style
// as teams-test.mjs, which this picks up right after — covers the actual
// timing (delayed, not instant) and the scoring correctness this change was
// riskiest for (doReveal() must score off the ORIGINAL g.questionEndsAt,
// never the shortened g.endsAt triggerEarlyReveal() sets for the alarm).
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
  all(t) { return this.msgs.filter((m) => m.type === t); }
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
  // ---- Teams mode: all teams answering early flashes, holds ~5s, THEN
  //      reveals — and scores off the real answer time, not the shortened
  //      alarm deadline. --------------------------------------------------
  const r = room();
  const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
  const B = new C('Bea', r); await B.connect(); await B.wait('welcome');
  const Cat = new C('Cat', r); await Cat.connect(); await Cat.wait('welcome');

  A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre', rounds: 1, questionsPerRound: 1, questionMs: 20000 } });
  await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');

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
  const startedAt = Date.now();

  // Both teams answer almost immediately — a 20s question, answered inside
  // the first second, should score close to the full speed bonus (BASE
  // 500 + up to 500 more) if (and only if) doReveal() is scoring off the
  // ORIGINAL 20s deadline rather than the ~5s one triggerEarlyReveal() sets
  // for the alarm.
  B.msgs.length = 0; Cat.msgs.length = 0;
  B.send({ type: 'answer', index: q.index, choice: 0 });
  await sleep(200);
  Cat.send({ type: 'answer', index: q.index, choice: 0 });

  const flash = await B.wait('allAnswered', 3000);
  const flashAt = Date.now();
  ok(typeof flash.revealAt === 'number', 'the allAnswered broadcast carries a revealAt timestamp', flash);
  ok(flash.revealAt - flashAt > 3500 && flash.revealAt - flashAt < 5500,
     'revealAt is ~5s out from the flash, not instant', flash.revealAt - flashAt);
  ok(flashAt - startedAt < 2000,
     'the flash itself arrives right after both teams answer, well before the 20s clock', flashAt - startedAt);

  // No 'reveal' yet — the delay is real, not just a field on the message.
  ok(B.all('reveal').length === 0, 'no reveal has actually fired yet at the moment of the flash');

  const rev = await B.wait('reveal', 7000);
  const revealedAt = Date.now();
  ok(revealedAt - startedAt > 3500 && revealedAt - startedAt < 8000,
     'the actual reveal lands ~5s after both teams answered, not instantly and not at the 20s clock',
     revealedAt - startedAt);

  const redScore = rev.scores.find((s) => s.id === redId);
  const bluScore = rev.scores.find((s) => s.id === blueId);
  ok(redScore && redScore.score >= 900,
     'a team that answered almost instantly still gets near the full speed bonus (base 500 + up to 500)', redScore);
  ok(bluScore && bluScore.score >= 900,
     'same for the second team, answered ~200ms after the first', bluScore);

  A.close(); B.close(); Cat.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack || e));
}

notes.forEach((l) => console.log(l));
fails.forEach((l) => console.log(l));
console.log(`passed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
