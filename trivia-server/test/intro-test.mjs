// Protocol-level tests for the optional how-to-play 'intro' phase inserted
// between standby and question 1 — entirely host-triggered (showIntro),
// nothing times out or advances on its own. Covers: the phase transition
// itself, that it's skippable (Start still works directly from standby),
// that it's reachable from intro too, that closeEvent backs out of it the
// same way it does from standby, and that team formation stays open
// through it. Same raw-socket style as teams-test.mjs/standby-lifecycle-test.mjs.
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
  // ---- 1. showIntro gating: host-only, standby-only --------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');

    B.msgs.length = 0;
    B.send({ type: 'showIntro' });
    const notHost = await B.wait('error');
    ok(/only the host/i.test(notHost.message || ''), 'showIntro from a non-host is refused', notHost);

    A.msgs.length = 0;
    A.send({ type: 'showIntro' });
    const tooEarly = await A.wait('error');
    ok(/open the event/i.test(tooEarly.message || ''), 'showIntro before standby is refused', tooEarly);

    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.msgs.length = 0; B.msgs.length = 0;
    A.send({ type: 'showIntro' });
    const introA = await A.wait('phase');
    const introB = await B.wait('phase');
    ok(introA.phase === 'intro', 'showIntro moves the room into intro', introA);
    ok(introB.phase === 'intro', 'every connected client sees the intro phase too', introB);

    A.close(); B.close();
  }

  await sleep(200);
  // ---- 2. intro is skippable — Start still fires directly from standby -
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');

    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.msgs.length = 0;
    A.send({ type: 'start' });
    const started = await A.wait('phase');
    ok(started.phase === 'question', 'Start works directly from standby, skipping intro entirely', started);

    A.close(); B.close();
  }

  await sleep(200);
  // ---- 3. Start also works FROM intro, and closeEvent backs out of it --
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');

    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.msgs.length = 0;
    A.send({ type: 'showIntro' });
    const intro1 = await A.wait('phase');
    ok(intro1.phase === 'intro', 'reached intro the first time through', intro1);

    // Back out from intro to lobby — same escape hatch as from standby.
    A.msgs.length = 0;
    A.send({ type: 'closeEvent' });
    const backToLobby = await A.wait('phase');
    ok(backToLobby.phase === 'lobby', 'closeEvent backs out of intro to lobby, same as from standby', backToLobby);

    // Redo the trip and this time actually start from intro.
    A.msgs.length = 0;
    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.msgs.length = 0;
    A.send({ type: 'showIntro' });
    const intro2 = await A.wait('phase');
    ok(intro2.phase === 'intro', 'reopened and reached intro a second time', intro2);

    A.msgs.length = 0; B.msgs.length = 0;
    A.send({ type: 'start' });
    const startedFromIntro = await A.wait('phase');
    ok(startedFromIntro.phase === 'question', 'Start works from intro, not just standby', startedFromIntro);
    const bSeesQuestion = await B.wait('question');
    ok(!!bSeesQuestion, 'the other player actually receives question 1', bSeesQuestion && bSeesQuestion.type);

    A.close(); B.close();
  }

  await sleep(200);
  // ---- 4. teams can still form/claim captain during intro --------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    A.send({ type: 'teamSetup', count: 2, names: ['Red', 'Blue'] });
    const r1 = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
    const redId = r1.teams[0].id;

    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.msgs.length = 0;
    A.send({ type: 'showIntro' });
    const introForTeams = await A.wait('phase');
    ok(introForTeams.phase === 'intro', 'showIntro works in teams mode too', introForTeams);

    B.msgs.length = 0;
    B.send({ type: 'joinTeam', teamId: redId });
    const joined = await B.waitFor((m) => m.type === 'roster');
    const bTeam = joined.teams.find((t) => t.id === redId);
    ok(!!bTeam && bTeam.memberIds.length === 1, 'a player can still join a team while the intro is showing', joined.teams);
    ok(bTeam.leaderId === bTeam.memberIds[0], 'auto-assigned captaincy still works during intro', bTeam);

    A.close(); B.close();
  }

  await sleep(200);
  // ---- 5. showIntro refused once the game has actually started ---------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');

    A.send({ type: 'openEvent' });
    await A.wait('phase');
    A.msgs.length = 0;
    A.send({ type: 'start' });
    await A.waitFor((m) => m.type === 'phase' && m.phase === 'question');

    A.msgs.length = 0;
    A.send({ type: 'showIntro' });
    const refused = await A.wait('error');
    ok(/open the event/i.test(refused.message || ''), 'showIntro is refused once the game has started', refused);

    A.close(); B.close();
  }
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack || e));
}

notes.forEach((l) => console.log(l));
fails.forEach((l) => console.log(l));
console.log(`passed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
