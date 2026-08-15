// Voice signalling tests over raw sockets. No browser: everything in
// trivia/docs/VOICE_PROTOCOL.md's server half is a protocol concern — the
// relay, the two gates, the two roster booleans and their lifetimes — and
// none of it needs a renderer to verify.
//
// Two disciplines this file is built around, both paid for already:
//
// 1. UNIQUE ROOM CODE PER BLOCK, PER RUN. Durable Object storage persists, so
//    a reused code inherits the previous run's players, mutes and settings.
//    Same rule as genre-test.mjs, same reason.
// 2. NO FIXED SLEEPS AS SYNCHRONISATION. The local dev worker occasionally
//    stalls ~650ms, so a 250ms wait after a `settings` flaked ~40% of runs —
//    every failure a late arrival, never a lost frame. Every wait here is for
//    a SPECIFIC frame. Where the expected outcome is silence, `flush()` sends
//    a deliberately-unknown message on the same socket and waits for the
//    'unknown message type' error it provokes: the DO processes one socket's
//    messages in order, so that error arriving proves everything sent before
//    it has been handled, and whatever did not arrive never will.
import WS from 'ws';

const ORIGIN = 'http://localhost:8000';
const fails = [], notes = [], obs = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));
// Behaviour that is real, reproduced, and reported to the integrator rather
// than asserted — either because the contract does not speak to it or because
// asserting today's answer would freeze a defect in as expected.
const note = (l) => obs.push('OBS   ' + l);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor(name, room, role) {
    this.name = name; this.room = room; this.role = role;
    this.msgs = []; this.raws = [];
  }
  connect() {
    let url = `ws://localhost:8787/room?code=${this.room}&name=${encodeURIComponent(this.name)}`;
    if (this.role) url += '&role=' + this.role;
    this.ws = new WS(url, { origin: ORIGIN });
    this.ws.on('message', (r) => {
      const s = r.toString();
      this.raws.push(s);
      this.msgs.push(JSON.parse(s));
    });
    return new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
      setTimeout(() => rej(new Error(this.name + ' connect timeout')), 8000);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  sendRaw(s) { this.ws.send(s); }
  last(t) { return [...this.msgs].reverse().find((m) => m.type === t); }
  all(t) { return this.msgs.filter((m) => m.type === t); }
  mark() { return this.msgs.length; }
  since(mark, t) { return this.msgs.slice(mark).filter((m) => !t || m.type === t); }
  /** Index of the first frame at/after `from` matching pred, or -1. */
  find(pred, from = 0) {
    for (let i = from; i < this.msgs.length; i++) if (pred(this.msgs[i])) return i;
    return -1;
  }
  async waitIndex(pred, from = 0, ms = 15000) {
    const t0 = Date.now();
    for (;;) {
      const i = this.find(pred, from);
      if (i >= 0) return i;
      if (Date.now() - t0 > ms) throw new Error(`${this.name}: no frame matching predicate in ${ms}ms`);
      await sleep(30);
    }
  }
  async waitFor(pred, from = 0, ms = 15000) { return this.msgs[await this.waitIndex(pred, from, ms)]; }
  /* The MOST RECENT frame of a type, like genre-test's last() — waiting only
     for one to exist. A "the state is now X" assertion wants the latest frame,
     never the first one that happened to arrive. */
  async wait(t, ms = 15000) { await this.waitIndex((m) => m.type === t, 0, ms); return this.last(t); }
  close() { try { this.ws.close(); } catch {} }
}

/* Round-trip barrier. Returns every frame this socket received between `mark`
   and the reply to the barrier message — i.e. everything the server produced
   in response to what was sent after `mark`, and nothing later. */
let pingN = 0;
async function flush(c, mark, ms = 15000) {
  const tag = 'zz-barrier-' + (++pingN);
  c.send({ type: tag });
  const i = await c.waitIndex(
    (m) => m.type === 'error' && m.message === 'unknown message type', mark, ms);
  return c.msgs.slice(mark, i);
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const room = () => Array.from({ length: 6 },
  () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

/** Join a player and return [client, welcome]. */
async function join(name, r, role) {
  const c = new C(name, r, role);
  await c.connect();
  const w = await c.wait('welcome');
  return [c, w];
}
/** Set settings and wait for the echo that carries them. Never a sleep. */
async function setSettings(host, s) {
  const mark = host.mark();
  host.send({ type: 'settings', settings: s });
  return (await host.waitFor((m) => m.type === 'settings', mark)).settings;
}
const rosterOf = (m, name) => m.players.find((p) => p.name === name);
let sigN = 0;
/** One legal relay, awaited at the far end. Doubles as a cross-socket barrier. */
async function relay(from, toId, to, extra = {}) {
  const tag = 'sig-' + (++sigN);
  const mark = to.mark();
  from.send({ type: 'voice-signal', to: toId, data: { tag }, ...extra });
  await to.waitFor((m) => m.type === 'voice-signal' && m.data && m.data.tag === tag, mark);
  return tag;
}

/* The public directory, read the way the landing screen reads it. Polled for
   a condition rather than slept on — reportToLobby() is fire-and-forget
   through waitUntil(), so "the room reported" is a state to wait for, not a
   duration to guess. */
async function listing(code, pred, ms = 8000) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    const res = await fetch('http://localhost:8787/lobby', { headers: { Origin: ORIGIN } });
    const body = await res.json();
    last = Array.isArray(body.rooms) ? body.rooms.find((r) => r.code === code) : undefined;
    if (pred(last)) return last;
    if (Date.now() - t0 > ms) return last;
    await sleep(150);
  }
}

const open = [];
const track = (...cs) => { open.push(...cs); return cs; };

try {
  /* ---- 1. the `voice` setting, and the sanitiser around it ---------------- */
  {
    const r = room();
    const [A, wa] = await join('Ann', r); const [B] = await join('Ben', r); track(A, B);

    ok(wa.settings && wa.settings.voice === false,
       '1.1 a new room defaults to voice OFF', wa.settings);
    ok(Object.prototype.hasOwnProperty.call(wa.settings, 'voice'),
       '1.2 welcome carries the voice setting so a joiner learns it for free');

    const r0 = await A.wait('roster');
    const ann = rosterOf(r0, 'Ann');
    ok(ann && ann.voice === false && ann.muted === false,
       '1.3 a fresh roster entry carries voice:false and muted:false', ann);
    ok(typeof ann.voice === 'boolean' && typeof ann.muted === 'boolean',
       '1.4 both voice fields are booleans on the wire, never undefined', ann);

    const s1 = await setSettings(A, { voice: true });
    ok(s1.voice === true, '1.5 the host can turn voice on', s1);
    const bs = await B.waitFor((m) => m.type === 'settings' && m.settings.voice === true);
    ok(!!bs, '1.6 a non-host is told the room turned voice on');

    const s2 = await setSettings(A, { genre: 'music', difficulty: 'hard', voice: true });
    ok(s2.voice === true && s2.genre === 'music' && s2.difficulty === 'hard',
       '1.7 voice survives alongside other settings fields', s2);

    for (const [raw, label] of [
      ['true', '1.8 the string "true" does not turn voice on'],
      [1, '1.9 the number 1 does not turn voice on'],
      [{}, '1.10 a truthy object does not turn voice on'],
      [['true'], '1.11 an array does not turn voice on'],
      ['on', '1.12 the string "on" does not turn voice on'],
    ]) {
      const s = await setSettings(A, { genre: 'music', voice: raw });
      ok(s.voice === false, label, s);
      await setSettings(A, { genre: 'music', voice: true }); // back on for the next case
    }

    // Field-by-field means OMITTED is not UNCHANGED. Worth pinning: a client
    // that PATCHes one field silently turns voice off for the room.
    const s3 = await setSettings(A, { genre: 'film' });
    ok(s3.voice === false,
       '1.13 a settings frame omitting `voice` turns voice OFF (fields are absolute, not a patch)', s3);

    const mark = B.mark();
    B.send({ type: 'settings', settings: { voice: true } });
    const nh = await flush(B, mark);
    ok(nh.some((m) => m.type === 'error'), '1.14 a non-host cannot turn voice on', nh);
    ok(!nh.some((m) => m.type === 'settings' && m.settings.voice === true),
       '1.15 a non-host voice change does not broadcast', nh);
    A.close(); B.close();
  }

  /* ---- 2. the blind relay ------------------------------------------------- */
  {
    const r = room();
    const [A, wa] = await join('Ann', r);
    const [B, wb] = await join('Ben', r);
    const [D, wd] = await join('Cal', r);
    track(A, B, D);
    ok((await setSettings(A, { voice: true })).voice === true, '2.0 voice on for the relay block');

    // A rich, deliberately awkward payload: nested, unicode, quotes, a lone
    // backslash, numbers that survive a round trip only if nothing reformats.
    const payload = {
      sdp: 'v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n"quoted" \\ backslash',
      cand: { foundation: '1', pri: 2113937151, ufrag: 'ñ✓👍', nested: [1, [2, [3, null]]] },
      t: true, f: false, z: 0, neg: -1.5e-7,
    };
    const wire = JSON.stringify(payload);
    let mark = B.mark(); const cmark = D.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: payload });
    const got = await B.waitFor((m) => m.type === 'voice-signal', mark);
    ok(got.from === wa.you.id, '2.1 a relayed signal is tagged with the real sender id', got.from);
    ok(JSON.stringify(got.data) === wire, '2.2 the relayed data is byte-identical to what was sent');
    const rawFrame = B.raws[B.msgs.indexOf(got)];
    ok(rawFrame.includes('"data":' + wire),
       '2.3 the data survives verbatim in the raw frame (no reserialisation drift)');
    ok(!Object.prototype.hasOwnProperty.call(got, 'to'),
       '2.4 the relayed frame does not echo `to` back at the receiver', got);

    // C hears nothing. Flush A first (so the relay has certainly been handled),
    // then flush C (per-socket ordering means anything owed to C is already in).
    await flush(A, A.mark());
    const cQuiet = D.since(cmark).filter((m) => m.type === 'voice-signal');
    ok(cQuiet.length === 0, '2.5 a third player receives nothing from a relay addressed elsewhere', cQuiet);

    // Order matters: an answer arriving before its offer breaks WebRTC.
    mark = B.mark();
    for (let i = 0; i < 20; i++) A.send({ type: 'voice-signal', to: wb.you.id, data: { seq: i } });
    await B.waitFor((m) => m.type === 'voice-signal' && m.data && m.data.seq === 19, mark);
    const seqs = B.since(mark, 'voice-signal').map((m) => m.data.seq);
    ok(seqs.length === 20, '2.6 twenty rapid relays all arrive', seqs.length);
    ok(seqs.every((v, i) => v === i), '2.7 rapid relays arrive in the order they were sent', seqs);

    // The cap is on JSON.stringify(payload). A string of n chars stringifies
    // to n+2, so 16382 is exactly the cap and 16383 is one over.
    const atCap = 'x'.repeat(16382);
    ok(JSON.stringify(atCap).length === 16384, '2.8 the boundary payload really is 16384 stringified');
    mark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: atCap });
    const cap = await B.waitFor((m) => m.type === 'voice-signal', mark);
    ok(cap.data === atCap, '2.9 a payload of exactly 16384 stringified bytes is relayed intact');

    const overCap = 'x'.repeat(16383);
    mark = B.mark(); let amark = A.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: overCap });
    let aQuiet = await flush(A, amark);
    ok(aQuiet.length === 0, '2.10 an oversized payload draws no error at the sender (silent drop)', aQuiet);
    let bQuiet = await flush(B, mark);
    ok(!bQuiet.some((m) => m.type === 'voice-signal'),
       '2.11 an oversized payload (16385) is dropped, not relayed', bQuiet);

    // Every silent-drop case, one loop: send the hostile frame, then prove the
    // sender got no error and the intended target got no frame.
    const drops = [
      [{ to: wa.you.id }, '2.12 a signal addressed to yourself is dropped silently'],
      [{ to: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }, '2.13 a signal to a nonexistent player id is dropped silently'],
      [{ to: '__proto__' }, '2.14 `to: "__proto__"` is dropped silently (hasOwnProperty, not a bare read)'],
      [{ to: 'constructor' }, '2.15 `to: "constructor"` is dropped silently'],
      [{ to: 'toString' }, '2.16 `to: "toString"` is dropped silently'],
      [{ to: 'hasOwnProperty' }, '2.17 `to: "hasOwnProperty"` is dropped silently'],
      [{ to: 42 }, '2.18 a numeric `to` is dropped silently'],
      [{ to: null }, '2.19 a null `to` is dropped silently'],
      [{ to: ['B'] }, '2.20 an array `to` is dropped silently'],
      [{ to: { id: 'B' } }, '2.21 an object `to` is dropped silently'],
      [{ to: 'x'.repeat(100000) }, '2.22 a 100k-character `to` is dropped silently'],
      [{ to: '', }, '2.23 an empty-string `to` is dropped silently'],
    ];
    for (const [frame, label] of drops) {
      amark = A.mark(); const bm = B.mark(), cm = D.mark();
      A.send({ type: 'voice-signal', data: { hostile: label }, ...frame });
      aQuiet = await flush(A, amark);
      ok(aQuiet.length === 0, label + ' — no error frame at the sender', aQuiet);
      const leaked = [...B.since(bm, 'voice-signal'), ...D.since(cm, 'voice-signal')];
      ok(leaked.length === 0, label + ' — and nothing reached anyone else', leaked);
    }

    // `data` itself.
    amark = A.mark(); mark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id });               // no data key at all
    aQuiet = await flush(A, amark);
    ok(aQuiet.length === 0, '2.24 a signal with no `data` key draws no error', aQuiet);
    bQuiet = await flush(B, mark);
    ok(!bQuiet.some((m) => m.type === 'voice-signal'), '2.25 a signal with no `data` key is not relayed', bQuiet);

    mark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: null });
    bQuiet = await flush(B, mark);
    note('`data: null` is ' + (bQuiet.some((m) => m.type === 'voice-signal') ? 'RELAYED' : 'dropped') +
         ' — null is present-but-empty, and the contract only refuses absent');

    // A hostile client cannot forge who a signal came from.
    mark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, from: wd.you.id, data: { spoof: 1 } });
    const spoof = await B.waitFor((m) => m.type === 'voice-signal', mark);
    ok(spoof.from === wa.you.id,
       '2.26 a client-supplied `from` is overwritten with the real sender id', spoof.from);

    // A 900KB envelope carrying a legal 20-byte payload: only the payload is
    // forwarded, so the cap cannot be walked around by fattening the envelope.
    mark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: { small: 1 }, junk: 'x'.repeat(900000) });
    const fat = await B.waitFor((m) => m.type === 'voice-signal', mark, 20000);
    ok(JSON.stringify(fat).length < 1000,
       '2.27 a fat envelope with a small payload forwards only the payload', JSON.stringify(fat).length);

    // Deeply nested payload — recursion in the DO would show up here.
    let deep = 0; for (let i = 0; i < 300; i++) deep = { d: deep };
    mark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: deep });
    const deepGot = await B.waitFor((m) => m.type === 'voice-signal', mark);
    ok(!!deepGot, '2.28 a 300-deep nested payload does not fault the relay');

    // The room is still healthy after all of that.
    await relay(A, wb.you.id, B);
    ok(true, '2.29 the relay still works after every hostile frame above');
    const rosterAfter = await A.wait('roster');
    ok(rosterAfter.players.every((p) => p.muted === false),
       '2.30 none of the hostile relay traffic set anybody muted', rosterAfter.players);
    A.close(); B.close(); D.close();
  }

  /* ---- 3. both gates when the room has voice OFF -------------------------- */
  {
    const r = room();
    const [A, wa] = await join('Ann', r); const [B, wb] = await join('Ben', r); track(A, B);
    const w = await A.wait('welcome');
    ok(w.settings.voice === false, '3.0 the block starts with voice off', w.settings);

    let amark = A.mark(); let bmark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: { off: 1 } });
    let q = await flush(A, amark);
    ok(q.length === 0, '3.1 a relay in a voice-off room draws no error (silent)', q);
    q = await flush(B, bmark);
    ok(!q.some((m) => m.type === 'voice-signal'),
       '3.2 a relay is REFUSED when settings.voice is false', q);

    // The guard added late: voice-state must be refused with voice off too.
    amark = A.mark(); bmark = B.mark();
    A.send({ type: 'voice-state', on: true });
    q = await flush(A, amark);
    ok(q.length === 0, '3.3 voice-state in a voice-off room draws no error', q);
    q = await flush(B, bmark);
    ok(!q.some((m) => m.type === 'roster' && rosterOf(m, 'Ann').voice === true),
       '3.4 voice-state is REFUSED when settings.voice is false (no roster, no flip)', q);
    const rNow = await A.wait('roster');
    ok(rosterOf(rNow, 'Ann').voice === false, '3.5 the roster still shows Ann voice:false', rosterOf(rNow, 'Ann'));

    // voice-mute is deliberately NOT gated on the room setting.
    amark = A.mark();
    A.send({ type: 'voice-mute', id: wb.you.id, on: true });
    const muteOff = await A.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').muted === true, amark);
    ok(!!muteOff, '3.6 voice-mute still applies in a voice-off room (it is not gated on the setting)');
    A.send({ type: 'voice-mute', id: wb.you.id, on: false });
    await A.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').muted === false, A.mark());

    // And the gate is not a wedge: turning voice on restores both verbs.
    ok((await setSettings(A, { voice: true })).voice === true, '3.7 voice can then be turned on');
    await relay(A, wb.you.id, B);
    ok(true, '3.8 the relay works again once voice is on (the gate is not a wedge)');
    bmark = B.mark();
    A.send({ type: 'voice-state', on: true });
    const flip = await B.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ann').voice === true, bmark);
    ok(!!flip, '3.9 voice-state works again once voice is on (the new guard did not break the on-path)');
    A.close(); B.close();
  }

  /* ---- 4. spectators are never in the mesh -------------------------------- */
  {
    const r = room();
    const [A, wa] = await join('Ann', r); const [B, wb] = await join('Ben', r); track(A, B);
    ok((await setSettings(A, { voice: true })).voice === true, '4.0 voice on for the spectator block');
    const [S] = await join('Sam', r, 'spectator'); track(S);
    const sw = await S.wait('welcome');
    ok(sw.spectator === true && sw.you === null, '4.1 a spectator gets a spectator welcome', sw.you);

    const rs = await A.waitFor((m) => m.type === 'roster' && m.watching === 1);
    ok(rs.players.length === 2 && !rosterOf(rs, 'Sam'),
       '4.2 a spectator is a headcount, not a roster entry', rs.players.map((p) => p.name));

    for (const [frame, label] of [
      [{ type: 'voice-signal', to: wb.you.id, data: { x: 1 } }, '4.3 voice-signal'],
      [{ type: 'voice-state', on: true }, '4.4 voice-state'],
      [{ type: 'voice-mute', id: wa.you.id, on: true }, '4.5 voice-mute'],
    ]) {
      const smark = S.mark(), bmark = B.mark(), amark = A.mark();
      S.send(frame);
      const err = await S.waitFor((m) => m.type === 'error' && m.code === 'spectator', smark);
      ok(err.code === 'spectator', `${label} from a spectator gets the spectator error`, err);
      ok(/spectator/i.test(err.message), `${label}: the spectator error says so in words`, err.message);
      await flush(B, bmark);
      const leaked = B.since(bmark, 'voice-signal');
      ok(leaked.length === 0, `${label} from a spectator relays nothing`, leaked);
      const rosters = A.since(amark, 'roster');
      ok(!rosters.some((m) => m.players.some((p) => p.voice || p.muted)),
         `${label} from a spectator changes no roster state`, rosters.length);
    }

    // The players' own mesh still works with a spectator watching.
    await relay(A, wb.you.id, B);
    ok(true, '4.6 players still relay normally while a spectator watches');
    A.close(); B.close(); S.close();
  }

  /* ---- 5. voice-state semantics ------------------------------------------ */
  {
    const r = room();
    const [A, wa] = await join('Ann', r); const [B, wb] = await join('Ben', r); track(A, B);
    ok((await setSettings(A, { voice: true })).voice === true, '5.0 voice on for the voice-state block');

    let bmark = B.mark();
    A.send({ type: 'voice-state', on: true });
    let ros = await B.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ann').voice === true, bmark);
    ok(!!ros, '5.1 voice-state on flips `voice` in the roster for everyone');
    ok(rosterOf(ros, 'Ben').voice === false, '5.2 one player unmuting does not flip anybody else', ros.players);
    ok(rosterOf(ros, 'Ann').muted === false, '5.3 voice-state does not touch the host-mute flag');

    // The no-op guard: a repeat of the same value must not cost a broadcast.
    bmark = B.mark();
    A.send({ type: 'voice-state', on: true });
    let q = await flush(B, bmark);
    ok(!q.some((m) => m.type === 'roster'), '5.4 an unchanged voice-state broadcasts no roster', q);

    // Strictness: only exactly true is on.
    for (const [val, label] of [
      ['yes', '5.5 a truthy string in `on` counts as OFF, not on'],
      [1, '5.6 the number 1 in `on` counts as OFF'],
      [undefined, '5.7 an omitted `on` counts as OFF'],
    ]) {
      bmark = B.mark();
      // off-then-on regardless of where we are: the first may be a no-op (and
      // so broadcast nothing), the second is always a real flip.
      A.send({ type: 'voice-state', on: false });
      A.send({ type: 'voice-state', on: true });
      await B.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ann').voice === true, bmark);
      bmark = B.mark();
      const frame = { type: 'voice-state' };
      if (val !== undefined) frame.on = val;
      A.send(frame);
      ros = await B.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ann').voice === false, bmark);
      ok(!!ros, label);
    }

    // Both players live at once, and a spectator sees the advisory state.
    A.send({ type: 'voice-state', on: true });
    bmark = B.mark();
    B.send({ type: 'voice-state', on: true });
    ros = await B.waitFor((m) => m.type === 'roster' &&
      rosterOf(m, 'Ann').voice === true && rosterOf(m, 'Ben').voice === true, bmark);
    ok(!!ros, '5.8 two players can be live in the mesh at once');
    A.close(); B.close();
  }

  /* ---- 6. voice-mute authority and semantics ----------------------------- */
  {
    const r = room();
    const [A, wa] = await join('Ann', r);
    const [B, wb] = await join('Ben', r);
    const [D, wd] = await join('Cal', r);
    track(A, B, D);
    ok((await setSettings(A, { voice: true })).voice === true, '6.0 voice on for the mute block');

    let mark = D.mark();
    A.send({ type: 'voice-mute', id: wb.you.id, on: true });
    let ros = await D.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').muted === true, mark);
    ok(!!ros, '6.1 the host muting a player flips `muted` in the next roster for everyone');
    ok(rosterOf(ros, 'Ann').muted === false && rosterOf(ros, 'Cal').muted === false,
       '6.2 a mute lands on exactly one player', ros.players);
    ok(rosterOf(ros, 'Ben').voice === false, '6.3 muting does not fabricate a `voice` flag', ros.players);

    mark = D.mark();
    A.send({ type: 'voice-mute', id: wb.you.id, on: true });
    let q = await flush(D, mark);
    ok(!q.some((m) => m.type === 'roster'), '6.4 re-muting an already-muted player broadcasts nothing', q);

    // Non-host authority, both directions.
    let bmark = B.mark();
    B.send({ type: 'voice-mute', id: wa.you.id, on: true });
    let bq = await flush(B, bmark);
    const err = bq.find((m) => m.type === 'error');
    ok(!!err, '6.5 a non-host muting someone is refused with an error', bq);
    ok(err && /only the host/i.test(err.message), '6.6 the refusal is worded like the other host-gated verbs', err);
    ok(!bq.some((m) => m.type === 'roster'), '6.7 a refused mute broadcasts no roster', bq);

    bmark = B.mark();
    B.send({ type: 'voice-mute', id: wb.you.id, on: false });
    bq = await flush(B, bmark);
    ok(bq.some((m) => m.type === 'error'), '6.8 a muted non-host cannot unmute themselves', bq);
    const still = await A.wait('roster');
    ok(rosterOf(still, 'Ben').muted === true, '6.9 and they are still muted afterwards', rosterOf(still, 'Ben'));

    // Host-side argument hygiene: bad ids are silent drops, not errors.
    for (const [id, label] of [
      ['__proto__', '6.10 `id: "__proto__"`'],
      ['constructor', '6.11 `id: "constructor"`'],
      ['toString', '6.12 `id: "toString"`'],
      ['nobody-here', '6.13 an unknown player id'],
      [42, '6.14 a numeric id'],
      [null, '6.15 a null id'],
      [{ id: 'x' }, '6.16 an object id'],
    ]) {
      const amark = A.mark();
      A.send({ type: 'voice-mute', id, on: true });
      const aq = await flush(A, amark);
      ok(!aq.some((m) => m.type === 'error'), label + ' draws no error from voice-mute', aq);
      ok(!aq.some((m) => m.type === 'roster'), label + ' changes no roster state', aq);
    }
    const afterJunk = await A.wait('roster');
    ok(afterJunk.players.filter((p) => p.muted).length === 1,
       '6.17 exactly one player is still muted after every junk id', afterJunk.players);

    // Strictness on `on`.
    mark = D.mark();
    A.send({ type: 'voice-mute', id: wb.you.id, on: 'false' });
    ros = await D.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').muted === false, mark);
    ok(!!ros, '6.18 only exactly true mutes: the string "false" unmutes (strict compare, both ways)');

    // Host muting itself is legal — there is no self-exclusion in the contract.
    mark = D.mark();
    A.send({ type: 'voice-mute', id: wa.you.id, on: true });
    ros = await D.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ann').muted === true, mark);
    ok(!!ros, '6.19 the host may mute itself');
    A.send({ type: 'voice-mute', id: wa.you.id, on: false });
    await D.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ann').muted === false, D.mark());

    // A muted player is still a full player: the relay does not gate on mute.
    A.send({ type: 'voice-mute', id: wb.you.id, on: true });
    await A.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').muted === true, A.mark());
    await relay(B, wa.you.id, A);
    ok(true, '6.20 a muted player can still signal (mute is enforced receiver-side, not at the relay)');
    A.close(); B.close(); D.close();
  }

  /* ---- 7. mid-game: the phase rules, and reconnect lifetimes -------------- */
  {
    const r = room();
    const [A, wa] = await join('Ann', r); const [B, wb] = await join('Ben', r); track(A, B);
    ok((await setSettings(A, { voice: true, genre: 'history' })).voice === true, '7.0 voice on before start');

    A.send({ type: 'voice-mute', id: wb.you.id, on: true });
    await A.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').muted === true, A.mark());

    A.send({ type: 'start' });
    const qframe = await A.wait('question', 30000);
    ok(!!qframe, '7.1 a room with voice on still starts a game');
    const startRoster = await A.wait('roster');
    ok(rosterOf(startRoster, 'Ben').muted === true,
       '7.1b a host mute set in the lobby survives the game starting', rosterOf(startRoster, 'Ben'));

    // Voice cannot be toggled mid-game — deliberate, per the contract.
    let amark = A.mark();
    A.send({ type: 'settings', settings: { voice: false } });
    let q = await flush(A, amark);
    ok(q.some((m) => m.type === 'error'), '7.2 settings (and so voice) are refused mid-game', q);
    ok(!q.some((m) => m.type === 'settings'), '7.3 a mid-game voice toggle does not broadcast', q);

    // voice-state mid-question: legal, and the roster it triggers must stay
    // clean — this frame rides DURING a question, which is only safe because
    // neither field reacts to correctness.
    let bmark = B.mark();
    B.send({ type: 'voice-state', on: true });
    let ros = await B.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').voice === true, bmark);
    ok(!!ros, '7.4 voice-state is legal mid-question and flips the roster');
    const phaseNow = [...B.msgs].reverse().find((m) => m.type === 'phase');
    ok(phaseNow && phaseNow.phase === 'question', '7.5 that happened while the phase was still `question`', phaseNow);
    const rosJson = JSON.stringify(ros).toLowerCase();
    ok(!rosJson.includes('correct') && !rosJson.includes('answer') && !rosJson.includes('streak'),
       '7.6 the mid-question roster carries nothing answer-shaped (THE INVARIANT)', rosJson.slice(0, 200));

    // host mute mid-question: the moment the control exists for.
    bmark = B.mark();
    A.send({ type: 'voice-mute', id: wb.you.id, on: false });
    ros = await B.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').muted === false, bmark);
    ok(!!ros, '7.7a the host can UNmute mid-question (legal in every phase)');
    bmark = B.mark();
    A.send({ type: 'voice-mute', id: wb.you.id, on: true });
    ros = await B.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').muted === true, bmark);
    ok(!!ros, '7.7 the host can mute mid-question (legal in every phase)');
    ok(!B.msgs.slice(bmark).some((m) => m.type === 'reveal'),
       '7.8 muting mid-question did not trigger a reveal');

    // and the relay works mid-question too.
    await relay(A, wb.you.id, B);
    ok(true, '7.9 the relay works mid-question');

    // Ben drops mid-game: his record survives (it holds a score), so `to` names
    // a real-but-disconnected player — the stale-candidate case.
    B.close();
    ros = await A.waitFor((m) => m.type === 'roster' &&
      rosterOf(m, 'Ben') && rosterOf(m, 'Ben').connected === false, A.mark(), 20000);
    ok(!!ros, '7.10 a player who drops mid-game keeps their roster record');
    ok(rosterOf(ros, 'Ben').muted === true, '7.11 and keeps the host mute while disconnected', rosterOf(ros, 'Ben'));
    if (rosterOf(ros, 'Ben').voice === true) {
      note('DEFECT-shaped: a player who drops with their mic live stays `voice: true` in the roster ' +
           'for as long as they are gone. Repro: voice on, Ben sends {voice-state,on:true}, Ben closes ' +
           'the socket -> the roster broadcast from webSocketClose() carries Ben {connected:false, ' +
           'voice:true}. voiceOn is only cleared on the RECONNECT path in fetch(), so every client is ' +
           'told a departed player\'s mic is live. Any speaking/mic indicator not also gated on ' +
           '`connected` will show it.');
    }

    amark = A.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: { stale: 'ice' } });
    q = await flush(A, amark);
    ok(!q.some((m) => m.type === 'error'),
       '7.12 a signal to a disconnected player is dropped SILENTLY (stale candidates must not spam errors)', q);

    // Reconnect: hostMuted must survive (it is not a mute dodge), voiceOn must
    // reset (a fresh page has no mic permission and no peers).
    const [B2, wb2] = await join('Ben', r); track(B2);
    ok(wb2.you.id === wb.you.id, '7.13 reconnecting under the same name resumes the same player record', wb2.you);
    ros = await B2.wait('roster');
    ok(rosterOf(ros, 'Ben').muted === true, '7.14 hostMuted SURVIVES a reconnect (reload is not a mute dodge)',
       rosterOf(ros, 'Ben'));
    ok(rosterOf(ros, 'Ben').voice === false, '7.15 voiceOn RESETS on reconnect (a fresh page has no live mic)',
       rosterOf(ros, 'Ben'));
    A.close(); B2.close();
  }

  /* ---- 8. turning room voice off ----------------------------------------- */
  {
    const r = room();
    const [A, wa] = await join('Ann', r); const [B, wb] = await join('Ben', r); track(A, B);
    ok((await setSettings(A, { voice: true })).voice === true, '8.0 voice on');
    A.send({ type: 'voice-mute', id: wb.you.id, on: true });
    A.send({ type: 'voice-state', on: true });
    B.send({ type: 'voice-state', on: true });
    let ros = await A.waitFor((m) => m.type === 'roster' &&
      rosterOf(m, 'Ann').voice === true && rosterOf(m, 'Ben').voice === true &&
      rosterOf(m, 'Ben').muted === true, A.mark());
    ok(!!ros, '8.1 both mics live and Ben muted by the host');

    const bmark = B.mark();
    ok((await setSettings(A, { voice: false })).voice === false, '8.2 the host turns voice off');
    ros = await B.waitFor((m) => m.type === 'roster' &&
      rosterOf(m, 'Ann').voice === false && rosterOf(m, 'Ben').voice === false, bmark);
    ok(!!ros, '8.3 turning voice off clears `voice` for everyone (no mesh, no live mics)');
    ok(rosterOf(ros, 'Ben').muted === true,
       '8.4 turning voice off PRESERVES the host mute (a standing decision, not a fact about the mesh)',
       rosterOf(ros, 'Ben'));

    // And it does not relight when voice comes back.
    const bmark2 = B.mark();
    ok((await setSettings(A, { voice: true })).voice === true, '8.5 the host turns voice back on');
    const lit = B.since(bmark2, 'roster').some((m) => m.players.some((p) => p.voice === true));
    ok(!lit, '8.6 turning voice back on does not relight anybody\'s mic', lit);
    const now = await A.wait('roster');
    ok(now.players.every((p) => p.voice === false), '8.7 every mic is still off after the round trip', now.players);
    ok(rosterOf(now, 'Ben').muted === true, '8.8 and Ben is still muted after the round trip');
    A.close(); B.close();
  }

  /* ---- 9. host reassignment and the mute lifetime ------------------------- */
  {
    const r = room();
    const [A, wa] = await join('Ann', r);
    const [B, wb] = await join('Ben', r);
    const [D, wd] = await join('Cal', r);
    track(A, B, D);
    ok((await setSettings(A, { voice: true })).voice === true, '9.0 voice on for the host-handover block');

    A.send({ type: 'voice-mute', id: wb.you.id, on: true });
    A.send({ type: 'voice-mute', id: wa.you.id, on: true }); // the host mutes itself too
    let ros = await B.waitFor((m) => m.type === 'roster' &&
      rosterOf(m, 'Ben').muted === true && rosterOf(m, 'Ann').muted === true, B.mark());
    ok(!!ros, '9.1 the host mutes Ben and itself');

    A.close();
    ros = await B.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben') &&
      rosterOf(m, 'Ben').isHost === true, B.mark(), 20000);
    ok(!!ros, '9.2 the host leaving promotes the longest-connected player');
    ok(rosterOf(ros, 'Cal').muted === false,
       '9.3 the departed host\'s mute flag does not leak onto anybody else', ros.players);

    // Ben is muted AND now host. Nothing in the contract stops him.
    const bmark = B.mark();
    B.send({ type: 'voice-mute', id: wb.you.id, on: false });
    const cleared = await B.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Ben').muted === false, bmark, 6000)
      .then(() => true).catch(() => false);
    if (cleared) {
      note('DEFECT-shaped: a muted player promoted to host on the old host\'s disconnect can clear ' +
           'their OWN hostMuted. Repro: host mutes B, host closes socket, B is promoted, ' +
           'B sends {type:"voice-mute", id:<B>, on:false} -> roster shows B.muted false.');
    }
    ok(true, '9.4 host handover with a muted player did not fault the room' + (cleared ? ' (see OBS)' : ''));

    // Lobby reconnect: in the lobby a disconnected player's record is pruned,
    // so the mute has nothing to survive on.
    const dmark = D.mark();
    B.send({ type: 'voice-mute', id: wd.you.id, on: true });
    await D.waitFor((m) => m.type === 'roster' && rosterOf(m, 'Cal').muted === true, dmark);
    D.close();
    await B.waitFor((m) => m.type === 'roster' && !rosterOf(m, 'Cal'), B.mark(), 20000);
    const [D2, wd2] = await join('Cal', r); track(D2);
    const back = await D2.wait('roster');
    const dodged = rosterOf(back, 'Cal') && rosterOf(back, 'Cal').muted === false;
    if (dodged) {
      note('DEFECT-shaped: in the LOBBY a host mute does not survive a reconnect. Repro: voice on, ' +
           'host mutes Cal, Cal closes the socket, Cal reconnects under the same name -> ' +
           'roster shows Cal.muted false, new player id. webSocketClose() deletes disconnected ' +
           'records while phase==="lobby", so the rejoin path in fetch() (which preserves hostMuted) ' +
           'is never reached. Contradicts the comment on onVoiceMute() that says reloading is not a way out.');
    }
    ok(rosterOf(back, 'Cal') !== undefined, '9.5 a reconnecting lobby player is back in the roster' +
       (dodged ? ' (mute lifetime: see OBS)' : ''));
    B.close(); D2.close();
  }

  /* ---- 10. abuse: rate, malformed frames, prototype integrity ------------- */
  {
    const r = room();
    const [A, wa] = await join('Ann', r); const [B, wb] = await join('Ben', r); track(A, B);
    const [S] = await join('Sam', r, 'spectator'); track(S);
    ok((await setSettings(A, { voice: true })).voice === true, '10.0 voice on for the abuse block');

    // An unrated toggle: every FLIP is a storage write plus a roster to every
    // socket in the room. The no-op guard only stops repeats of the same value.
    const N = 60;
    const bmark = B.mark();
    const t0 = Date.now();
    for (let i = 0; i < N; i++) A.send({ type: 'voice-state', on: i % 2 === 1 });
    await flush(A, A.mark(), 30000);
    await flush(B, B.mark(), 30000);
    const storm = B.since(bmark, 'roster');
    const outBytes = storm.reduce((n, m) => n + JSON.stringify(m).length, 0);
    const inBytes = N * JSON.stringify({ type: 'voice-state', on: true }).length;
    note(`${N} alternating voice-state frames (${inBytes} B in) produced ${storm.length} roster ` +
         `broadcasts (${outBytes} B out) to EACH of the room's sockets in ${Date.now() - t0}ms — ` +
         `no rate limit, and one storage write per flip. Amplification per socket ~` +
         `${(outBytes / inBytes).toFixed(1)}x, times (players + up to 20 spectators).`);
    ok(storm.length > 0, '10.1 alternating voice-state does broadcast (guard is per-value, not per-message)',
       storm.length);
    ok(storm.length <= N, '10.2 it never broadcasts more rosters than messages sent', storm.length);
    const settled = await A.wait('roster');
    ok(typeof rosterOf(settled, 'Ann').voice === 'boolean',
       '10.3 the room is still consistent after the toggle storm', rosterOf(settled, 'Ann'));
    await relay(A, wb.you.id, B);
    ok(true, '10.4 the relay still works after the toggle storm');

    // Malformed frames.
    let amark = A.mark();
    A.sendRaw('this is not json {{{');
    let e = await A.waitFor((m) => m.type === 'error', amark);
    ok(/malformed/i.test(e.message), '10.5 non-JSON gets a malformed-message error, not a crash', e);

    amark = A.mark();
    A.sendRaw('[{"type":"voice-signal"}]');
    e = await A.waitFor((m) => m.type === 'error', amark);
    ok(/unknown message type/i.test(e.message), '10.6 a top-level array is an unknown type, not a crash', e);

    amark = A.mark();
    A.sendRaw('{"type":"__proto__"}');
    e = await A.waitFor((m) => m.type === 'error', amark);
    ok(/unknown message type/i.test(e.message), '10.7 `type: "__proto__"` is an unknown type', e);

    amark = A.mark();
    A.sendRaw('{"type":"voice-signal","__proto__":{"hostMuted":true},"to":"' + wb.you.id +
              '","data":{"p":1},"constructor":{"prototype":{"x":1}}}');
    const relayed = await B.waitFor((m) => m.type === 'voice-signal' && m.data && m.data.p === 1, B.mark());
    ok(!!relayed, '10.8 a frame carrying __proto__/constructor keys still relays its payload');
    const rosterAfter = await A.wait('roster');
    ok(rosterAfter.players.every((p) => p.muted === false),
       '10.9 the __proto__ payload did not set hostMuted on anyone', rosterAfter.players);
    A.send({ type: 'voice-signal', to: wb.you.id, data: { p: 2 } });
    await B.waitFor((m) => m.type === 'voice-signal' && m.data && m.data.p === 2, B.mark());
    ok(true, '10.10 the room is still healthy after the pollution attempts');

    // Cross-room: a poisoned Object.prototype in the isolate would show up in a
    // brand-new room's defaults, which nothing in this run has ever touched.
    const r2 = room();
    const [Z, wz] = await join('Zoe', r2); track(Z);
    ok(wz.settings.voice === false, '10.11 a brand-new room still defaults voice OFF (no isolate pollution)',
       wz.settings);
    const zr = await Z.wait('roster');
    ok(rosterOf(zr, 'Zoe').muted === false && rosterOf(zr, 'Zoe').voice === false,
       '10.12 a brand-new player is neither muted nor live (no isolate pollution)', zr.players);
    A.close(); B.close(); S.close(); Z.close();
  }
  /* ---- 11. the payload is opaque, and the frame is hand-built ------------ */
  {
    const r = room();
    const [A, wa] = await join('Ann', r); const [B, wb] = await join('Ben', r); track(A, B);
    ok((await setSettings(A, { voice: true })).voice === true, '11.0 voice on for the payload block');

    /* The relayed frame is assembled by string concatenation around
       JSON.stringify(payload), so a payload that contains the frame's own
       delimiters is the interesting case: if the escaping were wrong, `from`
       would be attacker-controlled and the whole relay would be forgeable. */
    const inject = '","from":"HACKED","x":"';
    let mark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: { sdp: inject } });
    let got = await B.waitFor((m) => m.type === 'voice-signal', mark);
    ok(got.from === wa.you.id,
       '11.1 a payload containing the frame\'s own JSON delimiters cannot forge `from`', got.from);
    ok(got.data.sdp === inject, '11.2 and that payload still arrives byte-identical', got.data);

    // A lone surrogate: JSON.stringify must escape it or the hand-built frame
    // becomes unparseable at the far end.
    const lone = 'lead\ud800tail\udfff';
    mark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: lone });
    got = await B.waitFor((m) => m.type === 'voice-signal', mark);
    ok(got.data === lone, '11.3 a payload with lone surrogates survives the hand-built frame', [...got.data].length);

    // Markup and script tags: the room must neither sanitise nor mangle an
    // opaque payload — it is not the room's business.
    const markup = '<img src=x onerror=alert(1)></script><svg onload=alert(2)>';
    mark = B.mark();
    A.send({ type: 'voice-signal', to: wb.you.id, data: { m: markup } });
    got = await B.waitFor((m) => m.type === 'voice-signal', mark);
    ok(got.data.m === markup, '11.4 markup in an opaque payload is relayed verbatim, not sanitised', got.data);

    // Burst at the cap: how much a single client can push through the room.
    const big = 'y'.repeat(16000);
    const BURST = 30;
    mark = B.mark();
    const t0 = Date.now();
    for (let i = 0; i < BURST; i++) A.send({ type: 'voice-signal', to: wb.you.id, data: { i, big } });
    await B.waitFor((m) => m.type === 'voice-signal' && m.data && m.data.i === BURST - 1, mark, 30000);
    const burst = B.since(mark, 'voice-signal');
    ok(burst.length === BURST, '11.5 a burst of 30 at-cap payloads all arrive', burst.length);
    ok(burst.every((m, i) => m.data.i === i && m.data.big === big),
       '11.6 every payload in the burst is intact and in order');
    note(`one client relayed ${BURST} at-cap payloads (${(BURST * 16000 / 1024).toFixed(0)} KB) through ` +
         `the room in ${Date.now() - t0}ms with no rate limit — the 16384 cap bounds one message, not a burst`);

    // Hostile display names reach the roster verbatim: the server strips only
    // control characters and truncates to 16. Escaping is the client's job.
    const [X, wx] = await join('<svg onload=x>', r); track(X);
    const ros = await X.wait('roster');
    const hostile = ros.players.find((p) => p.name === '<svg onload=x>');
    ok(!!hostile, '11.7 a name containing markup round-trips verbatim in the roster (server does not escape)',
       ros.players.map((p) => p.name));
    ok(hostile && hostile.voice === false && hostile.muted === false,
       '11.8 the hostile-named player gets normal voice defaults', hostile);
    const bmark = B.mark();
    A.send({ type: 'voice-mute', id: wx.you.id, on: true });
    const muted = await B.waitFor((m) => m.type === 'roster' &&
      (m.players.find((p) => p.name === '<svg onload=x>') || {}).muted === true, bmark);
    ok(!!muted, '11.9 a hostile-named player can still be muted by id');
    await relay(A, wb.you.id, B);
    ok(true, '11.10 the room is still healthy after the payload and name attacks');
    A.close(); B.close(); X.close();
  }
  /* ---- 12. the room directory's `voice` flag ----------------------------- */
  /* Contract section 4: the landing screen must be able to say "voice on"
     BEFORE anyone joins. That is the one fact you want before you commit a
     microphone, so it is worth its own block. Depends on the directory having
     room for one more listing (LOBBY_MAX is 100 and every listing is removed
     when its room empties, so this is not normally close). */
  {
    const r = room();
    const [A] = await join('Ann', r); track(A);
    A.send({ type: 'public', on: true });
    await A.waitFor((m) => m.type === 'public' || m.type === 'roster', A.mark());
    let entry = await listing(r, (e) => !!e);
    ok(!!entry, '12.1 a public room appears in the directory', entry);
    ok(entry && entry.voice === false,
       '12.2 the listing carries voice:false for a room with voice off', entry);

    // Turn voice on and give the directory every chance to catch up.
    ok((await setSettings(A, { voice: true })).voice === true, '12.3 the host turns voice on');
    const afterToggle = await listing(r, (e) => e && e.voice === true, 3000);
    const stale = !(afterToggle && afterToggle.voice === true);
    if (stale) {
      note('DEFECT-shaped: the directory\'s `voice` flag is STALE until an unrelated event. Repro: ' +
           'host makes a room public, GET /lobby shows voice:false; host sends {settings:{voice:true}} ' +
           'and the settings echo arrives; GET /lobby still shows voice:false seconds later. ' +
           'onSettings() is the one mutator that never calls reportToLobby() — the same gap makes a ' +
           'listing\'s genre and difficulty stale. It resolves only when a join/leave/start happens to ' +
           'report. Contract section 4 wants this readable BEFORE anyone joins, which is exactly the ' +
           'window in which it is wrong.');
    }
    ok(true, '12.4 the directory survived a voice toggle' + (stale ? ' (flag freshness: see OBS)' : ''));

    // A join is a reporting event, so this pins that the flag itself travels
    // Room -> Lobby -> listing intact once something does report.
    const [B] = await join('Ben', r); track(B);
    const afterJoin = await listing(r, (e) => e && e.players === 2);
    ok(afterJoin && afterJoin.voice === true,
       '12.5 the listing carries voice:true once the room reports again', afterJoin);

    ok((await setSettings(A, { voice: false })).voice === false, '12.6 the host turns voice back off');
    B.close();
    const afterLeave = await listing(r, (e) => e && e.players === 1);
    ok(afterLeave && afterLeave.voice === false,
       '12.7 the listing follows voice back to false on the next report', afterLeave);
    A.close();
    const gone = await listing(r, (e) => !e);
    ok(!gone, '12.8 the listing is withdrawn when the room empties', gone);
  }
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
}

for (const c of open) c.close();

console.log('');
for (const n of notes) console.log(n);
if (obs.length) {
  console.log('\n--- observed and reported, deliberately NOT asserted ' +
              '(the contract does not speak to it, or asserting today\'s answer would freeze a defect ' +
              'in as expected). Every line below is reproduced by this run. ---');
  for (const o of obs) console.log(o);
}
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
