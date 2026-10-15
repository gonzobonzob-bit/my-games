// Protocol-level tests for live voice relay and the whisper/talk channels.
// No real audio anywhere — the relay only ever moves bytes, and that part
// is fully testable with raw binary WebSocket frames. Actual mic capture/
// playback lives entirely in the client and has to be judged by ear.
import WS from 'ws';

const ORIGIN = 'http://localhost:8000';
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor(name, room) { this.name = name; this.room = room; this.msgs = []; this.bins = []; }
  connect() {
    const url = `ws://localhost:8787/room?code=${this.room}&name=${encodeURIComponent(this.name)}`;
    this.ws = new WS(url, { origin: ORIGIN });
    this.ws.on('message', (r, isBinary) => {
      if (isBinary) this.bins.push(r);
      else this.msgs.push(JSON.parse(r.toString()));
    });
    return new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
      setTimeout(() => rej(new Error(this.name + ' connect timeout')), 8000);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  sendBinary(buf) { this.ws.send(buf, { binary: true }); }
  last(t) { return [...this.msgs].reverse().find((m) => m.type === t); }
  async wait(t, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.last(t); if (m) return m; await sleep(60); }
    throw new Error(`${this.name}: no '${t}' in ${ms}ms`);
  }
  close() { try { this.ws.close(); } catch {} }
}

function voiceFrame(channel, payload) {
  const header = Buffer.alloc(6);
  header.writeUInt8(channel, 0);
  header.writeUInt8(0, 1);
  header.writeUInt32LE(16000, 2);
  return Buffer.concat([header, Buffer.from(payload)]);
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const room = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

(async () => {
  // ---- setup: a teams-mode room with a host and two teams ----
  const r = room();
  const Host = new C('Host', r); await Host.connect(); await Host.wait('welcome');
  Host.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
  await Host.wait('settings');
  Host.send({ type: 'teamSetup', count: 2, names: ['Red', 'Blue'] });
  await sleep(200);

  const Ann = new C('Ann', r); await Ann.connect(); await Ann.wait('welcome');
  const Bea = new C('Bea', r); await Bea.connect(); await Bea.wait('welcome');
  const Cat = new C('Cat', r); await Cat.connect(); await Cat.wait('welcome');

  const redTeamId = Ann.last('roster').teams[0].id;
  const blueTeamId = Ann.last('roster').teams[1].id;
  Ann.send({ type: 'joinTeam', teamId: redTeamId });
  Bea.send({ type: 'joinTeam', teamId: redTeamId });
  Cat.send({ type: 'joinTeam', teamId: blueTeamId });
  await sleep(300);

  // ---- 1. host voice reaches everyone except the host themselves ----
  {
    [Host, Ann, Bea, Cat].forEach((c) => c.bins.length = 0);
    Host.sendBinary(voiceFrame(1, 'hello-everyone'));
    await sleep(300);
    ok(Host.bins.length === 0, 'host does not receive an echo of their own broadcast');
    ok(Ann.bins.length === 1 && Ann.bins[0].toString('latin1').includes('hello-everyone'),
       'Ann (red team) receives the host broadcast');
    ok(Cat.bins.length === 1, 'Cat (blue team) also receives the host broadcast', Cat.bins.map(String));
  }

  // ---- 2. team voice stays within the team, never reaches the host or the other team ----
  {
    [Host, Ann, Bea, Cat].forEach((c) => c.bins.length = 0);
    Ann.sendBinary(voiceFrame(2, 'hey-red-team'));
    await sleep(300);
    ok(Ann.bins.length === 0, 'Ann does not receive an echo of her own team voice');
    ok(Bea.bins.length === 1 && Bea.bins[0].toString('latin1').includes('hey-red-team'),
       'Bea (same team) receives it');
    ok(Cat.bins.length === 0, 'Cat (other team) does NOT receive it');
    ok(Host.bins.length === 0, 'the host does NOT receive team-internal voice');
  }

  // ---- 3. a non-host publishing on the host channel is refused, silently ----
  {
    [Host, Ann, Bea, Cat].forEach((c) => c.bins.length = 0);
    Ann.sendBinary(voiceFrame(1, 'impersonating-host'));
    await sleep(300);
    ok(Bea.bins.length === 0 && Cat.bins.length === 0 && Host.bins.length === 0,
       'a non-host cannot publish on the host broadcast channel');
  }

  // ---- 4. talk start/stop is relayed with the correct stamped identity ----
  {
    Host.send({ type: 'talk', channel: 'host', state: 'start' });
    const t = await Ann.wait('talk');
    ok(t.channel === 'host' && t.state === 'start' && t.name === 'Host', 'host talk-start relayed with name', t);

    Bea.msgs.length = 0; // clear the host's talk-start Bea already received too
    Ann.send({ type: 'talk', channel: 'team', state: 'start' });
    const t2 = await Bea.wait('talk');
    ok(t2.channel === 'team' && t2.state === 'start' && t2.name === 'Ann', 'team talk-start relayed with sender name', t2);
    Cat.msgs.length = 0;
    await sleep(300);
    ok(!Cat.last('talk'), 'the other team never sees a talk indicator for a team that is not theirs');
  }

  // ---- 5. whisper reaches only the host, sender can't whisper as host ----
  {
    Host.msgs.length = 0;
    Ann.send({ type: 'whisper', text: 'can we get a hint?' });
    const w = await Host.wait('whisper');
    ok(w.from === 'Ann' && w.text === 'can we get a hint?', 'whisper reaches the host with sender identity', w);

    Ann.msgs.length = 0; Bea.msgs.length = 0; Cat.msgs.length = 0;
    Host.send({ type: 'whisper', text: 'should never arrive anywhere' });
    await sleep(300);
    ok(!Ann.last('whisper') && !Bea.last('whisper') && !Cat.last('whisper'),
       'the host sending a whisper goes nowhere (no host to whisper to)');
  }

  Host.close(); Ann.close(); Bea.close(); Cat.close();

  console.log('\n' + notes.join('\n'));
  if (fails.length) console.log('\n' + fails.join('\n'));
  console.log('\npassed', notes.length, ' failed', fails.length);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAIL  threw ::', e && e.stack || e);
  process.exit(1);
});
