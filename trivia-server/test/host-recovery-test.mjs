// Protocol-level tests for the host recovery code: minted format, reclaiming
// the seat from a different connection/name, and the "host is static in
// teams mode" guarantee surviving BOTH disconnect-time reassignment and the
// separate pruneDisconnected() cleanup path — two different places in the
// server that each independently needed to respect the same rule, and each
// was a real bug when it didn't.
import WS from 'ws';

const ORIGIN = 'http://localhost:8000';
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor(name, room, hostToken) { this.name = name; this.room = room; this.hostToken = hostToken; this.msgs = []; }
  connect() {
    let url = `ws://localhost:8787/room?code=${this.room}&name=${encodeURIComponent(this.name)}`;
    if (this.hostToken) url += `&hostToken=${encodeURIComponent(this.hostToken)}`;
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
  close() { try { this.ws.close(); } catch {} }
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const room = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

(async () => {
  // ---- 1. token format and host-only delivery ----
  {
    const r = room();
    const A = new C('Ann', r); await A.connect();
    const welA = await A.wait('welcome');
    ok(welA.isHost === true, 'first connection becomes host');
    ok(typeof welA.hostToken === 'string' && /^[a-z]+-[a-z]+-[a-z]+$/.test(welA.hostToken),
       'host token is three lowercase words, hyphen-joined', welA.hostToken);

    const B = new C('Bea', r); await B.connect();
    const welB = await B.wait('welcome');
    ok(welB.isHost === false, 'second connection is not host');
    ok(welB.hostToken === undefined, 'a non-host never receives the host token', welB.hostToken);

    A.close(); B.close(); await sleep(300);
  }

  // ---- 2. a different connection reclaims host using the token ----
  {
    const r = room();
    const A = new C('Ann', r); await A.connect();
    const welA = await A.wait('welcome');
    const token = welA.hostToken;
    A.close();
    await sleep(300);

    // "Bea" never saw the token except by being handed it — same as a host
    // sharing their recovery code with themselves on a different device.
    const B = new C('Bea', r, token); await B.connect();
    const welB = await B.wait('welcome');
    ok(welB.isHost === true, 'a second, different-named connection reclaims host using the token', welB);
    ok(typeof welB.hostToken === 'string', 'the reclaiming connection also receives the token back');
    B.close();
  }

  // ---- 3. wrong token does not reclaim ----
  {
    const r = room();
    const A = new C('Ann', r); await A.connect();
    await A.wait('welcome');

    const B = new C('Bea', r, 'definitely-not-the-real-code'); await B.connect();
    const welB = await B.wait('welcome');
    ok(welB.isHost === false, 'a wrong token does not reclaim host', welB);
    A.close(); B.close();
  }

  // ---- 4. teams mode: host survives disconnect+reconnect without the token
  //         (same name, same device — the common case) ----
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.wait('settings');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');

    A.close();
    await sleep(500); // let the server see the disconnect

    const A2 = new C('Ann', r); await A2.connect();
    const welA2 = await A2.wait('welcome');
    ok(welA2.isHost === true, 'teams-mode host reconnecting under the same name stays host', welA2);
    A2.close(); B.close();
  }

  // ---- 5. the actual bug: pruneDisconnected() must not delete the host's
  //         seat (or null g.hostId) in teams mode just because SOMEONE ELSE
  //         connects while the host happens to be disconnected ----
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.wait('settings');
    A.close();
    await sleep(500);

    // A THIRD, unrelated player connects while the host is away. Before the
    // pruneDisconnected() fix, this alone would delete Ann's player record,
    // null g.hostId, and make Cat the new host — nobody even needed the
    // token. That is exactly the bug: host identity drifting to whoever
    // merely showed up next.
    const Cat = new C('Cat', r); await Cat.connect();
    const welCat = await Cat.wait('welcome');
    ok(welCat.isHost === false, 'an unrelated player connecting while the host is away does NOT become host', welCat);

    const A2 = new C('Ann', r); await A2.connect();
    const welA2 = await A2.wait('welcome');
    ok(welA2.isHost === true, 'the original host still reclaims the seat afterward, under their own name', welA2);
    Cat.close(); A2.close();
  }

  console.log('\n' + notes.join('\n'));
  if (fails.length) console.log('\n' + fails.join('\n'));
  console.log('\npassed', notes.length, ' failed', fails.length);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAIL  threw ::', e && e.stack || e);
  process.exit(1);
});
