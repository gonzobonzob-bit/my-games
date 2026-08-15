// Server-side tests for the lobby directory, the spectator role, the
// enter-at-start rule and auto-advance — raw sockets plus plain fetch, no
// browser. Everything here is a protocol concern: who may write to the
// directory, who may answer, and when the room moves on its own.
import WS from 'ws';

const ORIGIN = 'http://localhost:8000';
const WORKER = 'http://localhost:8787';
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor(name, room, extra = '') { this.name = name; this.room = room; this.extra = extra; this.msgs = []; }
  connect() {
    const url = `ws://localhost:8787/room?code=${this.room}&name=${encodeURIComponent(this.name)}${this.extra}`;
    this.ws = new WS(url, { origin: ORIGIN });
    this.ws.on('message', (r) => this.msgs.push({ t: Date.now(), m: JSON.parse(r.toString()) }));
    return new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
      setTimeout(() => rej(new Error(this.name + ' connect timeout')), 8000);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  last(t) { return [...this.msgs].reverse().find((x) => x.m.type === t); }
  all(t) { return this.msgs.filter((x) => x.m.type === t); }
  async wait(pred, ms = 25000, label = '') {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const hit = this.msgs.find(pred); if (hit) return hit; await sleep(60); }
    throw new Error(`${this.name}: timeout waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

/* Fresh codes PER RUN — Durable Object storage persists, and both the rooms
   and the directory itself remember. A fixed code here would make every run
   inherit the previous run's listing. */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const room = () => Array.from({ length: 6 },
  () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

const listing = async () => {
  const r = await fetch(WORKER + '/lobby', { headers: { Origin: ORIGIN } });
  return (await r.json()).rooms;
};
const find = (rooms, code) => rooms.find((r) => r.code === code);
// Reports are fire-and-forget from the room, so give the directory a beat.
const settle = () => sleep(800);

try {
  // ---- 1. the directory door ------------------------------------------------
  {
    const bare = await fetch(WORKER + '/lobby');
    ok(bare.status === 403, '/lobby with no Origin is refused (not a browser, not welcome)');
    const good = await fetch(WORKER + '/lobby', { headers: { Origin: ORIGIN } });
    ok(good.status === 200, '/lobby answers an allowed origin');
    ok((good.headers.get('access-control-allow-origin') || '') === ORIGIN,
       '/lobby echoes the allowed origin for CORS', good.headers.get('access-control-allow-origin'));
    const body = await good.json();
    ok(Array.isArray(body.rooms), '/lobby returns a rooms array');
  }

  // ---- 2. opt-in gating: private by default, host-only, both told -----------
  {
    const r = room();
    const A = new C('Ann', r), B = new C('Ben', r);
    await A.connect(); await B.connect();
    const w = await A.wait((x) => x.m.type === 'welcome', 8000, 'welcome');
    ok(w.m.isPublic === false, 'welcome carries isPublic:false for a fresh room');
    await settle();
    ok(!find(await listing(), r), 'a room is NOT listed by default — listing a code publishes it');

    B.send({ type: 'public', on: true });
    await B.wait((x) => x.m.type === 'error', 5000, 'non-host toggle error');
    await settle();
    ok(!find(await listing(), r), "a non-host cannot list the room");

    A.send({ type: 'public', on: true });
    const pub = await B.wait((x) => x.m.type === 'public', 5000, 'public broadcast');
    ok(pub.m.on === true, "the whole room hears the 'public' broadcast — being listed is a fact about the room");
    await settle();
    const entry = find(await listing(), r);
    ok(!!entry, 'host opt-in registers the room');
    if (entry) {
      ok(entry.host === 'Ann', 'listing names the host', entry.host);
      ok(entry.players === 2, 'listing counts connected players', entry.players);
      ok(entry.phase === 'lobby', "listing phase starts at 'lobby'", entry.phase);
      ok(entry.watching === 0, 'listing starts with nobody watching');
      // The listing must never carry more than the advertised shape — no
      // scores, no player names, nothing that grew by accident.
      const keys = Object.keys(entry).sort().join(',');
      ok(keys === 'code,difficulty,genre,host,phase,players,voice,watching',
         'listing carries exactly the advertised fields', keys);
    }
    A.close(); B.close();
    await sleep(1200);
    ok(!find(await listing(), r), 'an empty room deregisters itself');
  }

  // ---- 3. spectators: watch everything, touch nothing -----------------------
  {
    const r = room();
    const A = new C('Ann', r), B = new C('Ben', r);
    await A.connect(); await B.connect();
    await A.wait((x) => x.m.type === 'welcome', 8000, 'welcome');

    const S = new C('Sam', r, '&role=spectator');
    await S.connect();
    const sw = await S.wait((x) => x.m.type === 'welcome', 8000, 'spectator welcome');
    ok(sw.m.spectator === true && sw.m.you === null,
       'a spectator is welcomed as a spectator, with no player identity');
    const ros = await A.wait((x) => x.m.type === 'roster' && x.m.watching === 1, 8000, 'watching=1');
    ok(ros.m.players.length === 2, 'a spectator holds no seat in the roster');

    S.send({ type: 'start' });
    const err = await S.wait((x) => x.m.type === 'error' && x.m.code === 'spectator', 5000, 'spectator refusal');
    ok(!!err, 'a spectator game verb is refused out loud, with a code the client can translate');

    A.send({ type: 'start' });
    const q0 = await S.wait((x) => x.m.type === 'question' && x.m.index === 0, 25000, 'S q0');
    ok(!!q0, 'a spectator receives the question broadcast');
    // THE INVARIANT applies to the audience too.
    ok(!JSON.stringify(q0.m).toLowerCase().includes('correct'),
       "a spectator's question frame carries nothing answer-shaped");

    // A spectator's 'answer' must not count, must not broadcast, and must
    // not tip the all-answered early reveal.
    S.send({ type: 'answer', index: 0, choice: 0 });
    await sleep(600);
    ok(A.all('answered').length === 0, "a spectator 'answer' produces no answered broadcast");
    ok(A.all('reveal').length === 0, "a spectator 'answer' cannot trigger the early reveal");

    A.send({ type: 'answer', index: 0, choice: 0 });
    B.send({ type: 'answer', index: 0, choice: 1 });
    const rev = await S.wait((x) => x.m.type === 'reveal', 8000, 'reveal reaches S');
    ok(rev.m.perPlayer.length === 2, 'the reveal scores players only — the audience holds no state');

    // Spectators may arrive mid-game; that is the watch party.
    const S2 = new C('Sue', r, '&role=spectator');
    await S2.connect();
    const caught = await S2.wait((x) => x.m.type === 'question' || x.m.type === 'reveal', 8000, 'S2 catchUp');
    ok(!!caught, 'a spectator joining mid-game is caught up into the current phase');

    S2.close();
    await A.wait((x) => x.m.type === 'roster' && x.m.watching === 1 && x.t > rev.t, 8000, 'watching drops');
    ok(true, 'a spectator leaving updates the watching count');
    A.close(); B.close(); S.close();
  }

  await sleep(900);
  // ---- 4. enter at start: players join in the lobby or not at all -----------
  {
    const r = room();
    const A = new C('Ann', r), B = new C('Ben', r);
    await A.connect(); await B.connect();
    await A.wait((x) => x.m.type === 'welcome', 8000, 'welcome');
    A.send({ type: 'start' });
    await A.wait((x) => x.m.type === 'question', 25000, 'q0');

    const Z = new C('Zed', r);
    let refused = false;
    try { await Z.connect(); } catch { refused = true; }
    ok(refused, 'a NEW player name is turned away mid-game');

    // A reconnect is not a join: the same name gets back in, keeps its
    // score record, and is caught up mid-question.
    B.close();
    await sleep(400);
    const B2 = new C('Ben', r);
    let rejoined = true;
    try { await B2.connect(); } catch { rejoined = false; }
    ok(rejoined, 'a KNOWN name reconnecting mid-game is let back in');
    if (rejoined) {
      const bq = await B2.wait((x) => x.m.type === 'question', 8000, 'B2 catchUp');
      ok(!!bq, 'the reconnect is caught up into the open question');
    }
    A.close(); if (rejoined) B2.close();
  }

  await sleep(900);
  // ---- 5. auto-advance: the room moves on its own ---------------------------
  {
    const r = room();
    const A = new C('Ann', r), B = new C('Ben', r);
    await A.connect(); await B.connect();
    await A.wait((x) => x.m.type === 'welcome', 8000, 'welcome');
    A.send({ type: 'start' });
    const q0 = await A.wait((x) => x.m.type === 'question' && x.m.index === 0, 25000, 'q0');
    A.send({ type: 'answer', index: 0, choice: 0 });
    B.send({ type: 'answer', index: 0, choice: 1 });
    const rev = await A.wait((x) => x.m.type === 'reveal', 8000, 'reveal');
    ok(Number.isFinite(rev.m.nextAt), 'the reveal carries nextAt so every client draws the same countdown');
    const lead = rev.m.nextAt - rev.t;
    ok(lead > 4500 && lead < 7500, 'nextAt is ~6s out from the reveal', lead);

    // NOBODY sends 'next'. The room must advance itself — this is the alarm
    // slot firing in the reveal phase, i.e. the case the old
    // `if (phase !== 'question') return;` guard would have swallowed.
    const q1 = await A.wait((x) => x.m.type === 'question' && x.m.index === 1, 12000, 'auto q1');
    const delta = q1.t - rev.t;
    ok(delta > 4500 && delta < 9000, 'the next question arrives ~6s after the reveal, unprompted', delta);

    // The host's Next survives as a skip.
    A.send({ type: 'answer', index: 1, choice: 0 });
    B.send({ type: 'answer', index: 1, choice: 1 });
    const rev1 = await A.wait((x) => x.m.type === 'reveal' && x.t > q1.t, 8000, 'reveal 1');
    A.send({ type: 'next' });
    const q2 = await A.wait((x) => x.m.type === 'question' && x.m.index === 2, 5000, 'skip q2');
    ok(q2.t - rev1.t < 3000, "the host's Next still skips the wait", q2.t - rev1.t);
    A.close(); B.close();
  }

  await sleep(900);
  // ---- 6. the question alarm still fires (dispatch regression) --------------
  {
    // One player answers, one never does: the reveal must come from the 20s
    // question deadline — the dispatch's 'question' case, early-fire re-arm
    // and all. Slow on purpose; it is the only block that waits out a clock.
    const r = room();
    const A = new C('Ann', r), B = new C('Ben', r);
    await A.connect(); await B.connect();
    await A.wait((x) => x.m.type === 'welcome', 8000, 'welcome');
    A.send({ type: 'start' });
    const q0 = await A.wait((x) => x.m.type === 'question' && x.m.index === 0, 25000, 'q0');
    A.send({ type: 'answer', index: 0, choice: 0 });
    const rev = await A.wait((x) => x.m.type === 'reveal', 26000, 'clock-out reveal');
    const held = rev.t - q0.t;
    ok(held > 15000, 'a half-answered question waits for the 20s clock, not the answer', held);
    A.close(); B.close();
  }
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack || e));
}

console.log('');
for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
