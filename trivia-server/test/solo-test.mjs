// One player, start to finish. The question is not whether MIN_PLAYERS changed
// — it is whether the whole loop still resolves with nobody else in the room:
// the reveal gate, the scoreboard, the podium, and play-again.
import fs from 'node:fs';
import WS from 'ws';

const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const OUT = (process.env.LS_OUT || '/tmp/late-signal') + '/shots';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM = (process.argv[2] || Array.from({ length: 6 },
  () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('')).toUpperCase();

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

class Tab {
  constructor() { this.id = 0; this.pending = new Map(); this.errors = []; }
  async open() {
    const r = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' });
    this.target = await r.json();
    this.ws = new WS(this.target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params?.exceptionDetails?.exception?.description || 'exception');
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push((m.params.args || []).map((a) => a.value).join(' '));
      }
    });
    await this.cmd('Runtime.enable'); await this.cmd('Page.enable');
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout ' + method)), 40000);
      this.pending.set(id, (m) => { clearTimeout(to); m.error ? rej(new Error(m.error.message)) : res(m.result); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(b) {
    const r = await this.cmd('Runtime.evaluate', { expression: `(function(){${b}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  async shot(n) {
    const r = await this.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, 'base64'));
  }
  async until(b, what, ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await this.ev(b)) return true; await sleep(250); }
    throw new Error('timed out waiting for ' + what);
  }
  async close() { try { await fetch(CDP + '/json/close/' + this.target.id); } catch {} }
}

const A = new Tab();
try {
  await A.open();
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await A.cmd('Page.navigate', { url: PAGE });
  await sleep(1400);
  // Pin the language. localStorage persists in the shared Chrome profile, so a
  // previous run that chose Spanish would otherwise make this a Spanish game,
  // which is then correctly REFUSED on Mixed (no Spanish questions) and looks
  // like the game is broken. Same class of bug as reusing room codes.
  await A.ev("try{localStorage.setItem('ls:lang','en')}catch(e){} return true;");
  await A.cmd('Page.reload');
  await sleep(1000);
  await A.ev(`
    document.getElementById('nameInput').value = 'Solo';
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(1200);
  await A.cmd('Page.bringToFront');

  const lobby = await A.ev(`
    var b = document.getElementById('startBtn');
    return { hidden: b.hidden, disabled: b.disabled, label: b.textContent };`);
  ok(!lobby.hidden, 'the host sees a start button alone in the room', lobby);
  ok(!lobby.disabled, 'it is enabled with one player', lobby);
  ok(/solo/i.test(lobby.label), 'it names the solo start', lobby.label);
  await A.shot('solo-lobby');

  await A.ev("document.getElementById('startBtn').click(); return true;");

  // Ten rounds alone. The reveal must fire on the answer, not on the 20s clock —
  // that is what makes solo playable rather than a waiting game.
  let fastest = true;
  for (let round = 0; round < 10; round++) {
    await A.until("return !!document.querySelector('.tile[data-i=\"0\"]:not([disabled])');", `tiles r${round + 1}`);
    const t0 = Date.now();
    await A.ev("var t=document.querySelector('.tile[data-i=\"0\"]'); if(t) t.click(); return true;");
    await A.until("return !!document.querySelector('.tile.correct, .tile.is-correct, .tile[data-correct]') || (window.__rev||false) || document.getElementById('lockLine').textContent.length > 0;",
                  `reveal r${round + 1}`, 25000);
    if (Date.now() - t0 > 15000) fastest = false;
    if (round === 9) break;
    await A.until("return !!document.querySelector('#boardActions button:not([disabled])');", `board r${round + 1}`);
    await A.ev("var b=document.querySelector('#boardActions button'); if(b) b.click(); return true;");
  }
  ok(fastest, 'a solo reveal fires on the answer, not on the 20s clock');

  await A.until("return !!document.querySelector('#boardActions button:not([disabled])');", 'final board');
  await A.ev("var b=document.querySelector('#boardActions button'); if(b) b.click(); return true;");
  await A.until("var e=document.getElementById('s-final'); return !!(e && e.offsetParent !== null);", 'final screen');
  await sleep(3000);

  const fin = await A.ev(`
    return {
      winner: document.getElementById('winnerName').textContent,
      score: document.getElementById('winnerScore').textContent,
      rows: document.querySelectorAll('#finalRest .row').length,
      again: !!document.querySelector('#finalActions button'),
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };`);
  ok(fin.winner === 'Solo', 'the solo player is crowned', fin.winner);
  ok(fin.score !== '0' && fin.score !== '', 'a real score landed', fin.score);
  ok(fin.rows === 0, 'no empty podium rows for a one-player game', fin.rows);
  ok(fin.again, 'play again is offered');
  ok(!fin.hScroll, 'no horizontal scroll on a solo final');
  await A.shot('solo-final');

  await A.ev("var b=document.querySelector('#finalActions button'); if(b) b.click(); return true;");
  await A.until("var e=document.getElementById('s-lobby'); return !!(e && e.offsetParent !== null);", 'lobby again');
  ok(true, 'play again returns a solo player to the lobby');

  const errs = A.errors.filter((e) => !/favicon|net::ERR/i.test(e));
  ok(errs.length === 0, 'no console errors across a full solo game', errs.slice(0, 3));
} catch (e) {
  fails.push('FAIL  threw :: ' + e.message);
}

await A.close();
console.log('');
for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
