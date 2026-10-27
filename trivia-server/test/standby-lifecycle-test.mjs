// Protocol-level tests for the standby lifecycle added alongside the doors-
// open feature: closeEvent (host backs out of standby to fix setup),
// leaveRoom (explicit, immediate departure vs. a mere disconnect), and the
// disconnect-grace period (DISCONNECT_GRACE_MS) that now lets a dropped
// pre-game player reconnect without losing their seat/team/captaincy. Same
// raw-socket style as teams-test.mjs, which already covers openEvent and
// claimCaptain — this picks up right after it.
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
  // ---- 1. closeEvent: the host's way back out of standby ------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');

    // Not open yet — closeEvent only means something once standby has
    // actually started.
    A.msgs.length = 0;
    A.send({ type: 'closeEvent' });
    const tooEarly = await A.wait('error');
    ok(/not open/i.test(tooEarly.message || ''), 'closeEvent before the event is open is refused', tooEarly);

    A.send({ type: 'openEvent' });
    await A.waitFor((m) => m.type === 'phase' && m.phase === 'standby');

    // Only the host may back out.
    B.msgs.length = 0;
    B.send({ type: 'closeEvent' });
    const notHost = await B.wait('error');
    ok(/only the host/i.test(notHost.message || ''), 'a non-host closeEvent is refused', notHost);

    A.msgs.length = 0;
    A.send({ type: 'closeEvent' });
    const closed = await A.waitFor((m) => m.type === 'phase' && m.phase === 'lobby');
    ok(closed.phase === 'lobby', 'closeEvent moves the room from standby back to lobby', closed);

    // Config is editable again — teamSetup no longer refused as alreadyStarted.
    A.msgs.length = 0;
    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    A.msgs.length = 0;
    A.send({ type: 'teamSetup', count: 2 });
    const reopened = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
    ok(!!reopened, 'teamSetup works again after closeEvent reopened the lobby', reopened);

    // Closing again with no open event is refused the same way.
    A.msgs.length = 0;
    A.send({ type: 'closeEvent' });
    const alreadyClosed = await A.wait('error');
    ok(/not open/i.test(alreadyClosed.message || ''), 'closeEvent on an already-closed (lobby) room is refused', alreadyClosed);

    A.close(); B.close();
  }

  // ---- 2. leaveRoom: an explicit, immediate departure ----------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    A.send({ type: 'teamSetup', count: 1 });
    const setup = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
    const teamId = setup.teams[0].id;

    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');
    B.send({ type: 'joinTeam', teamId });
    const joined = await B.waitFor((m) => m.type === 'roster' && m.teams.find((t) => t.id === teamId)?.memberIds.length === 1);
    const beaPid = joined.players.find((p) => p.name === 'Bea').id;

    A.msgs.length = 0;
    B.msgs.length = 0;
    B.send({ type: 'leaveRoom' });
    const afterLeave = await A.waitFor((m) => m.type === 'roster' && !m.players.find((p) => p.id === beaPid));
    ok(!afterLeave.players.find((p) => p.id === beaPid), 'leaveRoom removes the player from the roster immediately', afterLeave);
    ok(!afterLeave.teams.find((t) => t.id === teamId).memberIds.includes(beaPid),
       'leaveRoom also drops them from their team, not just the roster', afterLeave);

    // The host sending leaveRoom is a no-op, not an error — closing the tab
    // is how a host already "leaves" without losing the seat.
    A.msgs.length = 0;
    A.send({ type: 'leaveRoom' });
    await sleep(500);
    ok(A.msgs.length === 0, 'leaveRoom from the host is a silent no-op (no error, no broadcast)', A.msgs);
    // The room still works normally afterward — the host record is intact.
    A.send({ type: 'teamSetup', count: 2 });
    const stillHost = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
    ok(!!stillHost, 'the host record survives sending leaveRoom on themselves', stillHost);

    A.close(); B.close();
  }

  // ---- 3. disconnect grace: a dropped (not left) player keeps their seat --
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    A.send({ type: 'teamSetup', count: 1 });
    const setup = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
    const teamId = setup.teams[0].id;

    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');
    B.send({ type: 'joinTeam', teamId });
    const joined = await B.waitFor((m) => m.type === 'roster' && m.teams.find((t) => t.id === teamId)?.memberIds.length === 1);
    const beaPid = joined.players.find((p) => p.name === 'Bea').id;
    ok(joined.teams.find((t) => t.id === teamId).leaderId === beaPid, 'Bea starts as her team\'s auto-assigned leader', joined);

    // A dropped socket, not a leaveRoom — the server cannot yet tell this
    // apart from "about to refresh the page."
    B.close();
    await sleep(400);

    // A third player joining triggers pruneDisconnected() (runs on connect,
    // pre-game) — before this fix that deleted Bea outright; now it should
    // leave her alone, well inside DISCONNECT_GRACE_MS.
    const D = new C('Deb', r); await D.connect(); await D.wait('welcome');
    const afterPrune = D.last('welcome');
    const beaStillThere = (afterPrune.teams || []).find((t) => t.id === teamId)?.memberIds.includes(beaPid);
    ok(beaStillThere === true, 'a disconnected player inside the grace period survives pruneDisconnected()', afterPrune);

    // And reconnecting under the same name picks the same record back up —
    // same team, same captaincy, not a fresh join.
    const B2 = new C('Bea', r); await B2.connect();
    const welcomeBack = await B2.wait('welcome');
    ok(welcomeBack.you && welcomeBack.you.id === beaPid, 'reconnecting under the same name resumes the SAME player record', welcomeBack);
    ok((welcomeBack.teams || []).find((t) => t.id === teamId)?.leaderId === beaPid,
       'reconnecting inside the grace period keeps her captaincy', welcomeBack);

    A.close(); B2.close(); D.close();
  }

} catch (e) {
  fails.push('FAIL  threw: ' + (e && e.stack || e));
}

console.log(notes.join('\n'));
if (fails.length) {
  console.log('\n' + fails.join('\n'));
}
console.log('\npassed', notes.length, ' failed', fails.length);
process.exit(fails.length ? 1 : 0);
