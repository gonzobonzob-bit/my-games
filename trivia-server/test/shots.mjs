// Capture the game at the moments worth looking at. Not an assertion harness —
// this exists so a human (or the model) can actually SEE the result rather than
// infer it from computed styles.
//
// Needs: wrangler dev on :8787, a static server on :8000 from the worktree
// root, and Chrome with --remote-debugging-port=9222.
import fs from 'node:fs';
import WS from 'ws';

const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const OUT = (process.env.LS_OUT || '/tmp/late-signal') + '/shots';
const ROOM = (process.argv[2] || 'SHOT01').toUpperCase();
const VIEW = { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false };

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Tab {
  constructor() { this.id = 0; this.pending = new Map(); }
  async open() {
    const r = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' });
    this.target = await r.json();
    this.ws = new WS(this.target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
    await this.cmd('Runtime.enable');
    await this.cmd('Page.enable');
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout ' + method)), 40000);
      this.pending.set(id, (m) => {
        clearTimeout(to);
        if (m.error) rej(new Error(method + ': ' + m.error.message)); else res(m.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(body) {
    const r = await this.cmd('Runtime.evaluate', {
      expression: `(function(){${body}})()`, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  async shot(name) {
    const r = await this.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log('  shot', name);
  }
  async until(body, what, ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await this.ev(body)) return true; await sleep(300); }
    throw new Error('timed out waiting for ' + what);
  }
  async close() { try { await fetch(CDP + '/json/close/' + this.target.id); } catch {} }
}

async function join(tab, name) {
  await tab.cmd('Page.navigate', { url: PAGE });
  await sleep(1400);
  await tab.ev(`
    document.getElementById('nameInput').value = ${JSON.stringify(name)};
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(1000);
}

const A = new Tab(), B = new Tab();
try {
  await A.open(); await B.open();
  await join(A, 'Ada');
  await join(B, 'Bo');
  await A.cmd('Emulation.setDeviceMetricsOverride', VIEW);
  await A.cmd('Page.bringToFront');
  await sleep(600);
  await A.shot('atmos-lobby');

  await A.ev("document.getElementById('startBtn').click(); return true;");
  await A.until("return !!document.querySelector('.tile[data-i=\"0\"]');", 'the tiles');
  await sleep(1500);
  await A.shot('atmos-question-cruise');

  // The clock runs 20s: wait into the panic window rather than guessing.
  await A.until("return document.getElementById('clock').className.indexOf('panic') >= 0;",
                'the panic clock', 22000);
  await sleep(400);
  await A.shot('atmos-question-panic');

  // Answer and catch the reveal.
  await A.ev("var t=document.querySelector('.tile[data-i=\"0\"]'); if(t) t.click(); return true;");
  await B.ev("var t=document.querySelector('.tile[data-i=\"1\"]'); if(t) t.click(); return true;");
  await sleep(1800);
  await A.shot('atmos-reveal');
  console.log('done');
} catch (e) {
  console.log('FAILED:', e.message);
} finally {
  await A.close(); await B.close();
}
