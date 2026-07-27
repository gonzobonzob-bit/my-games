// Does the podium fit on screen? The assertions only checked horizontal
// scroll; the screenshot showed bronze clipped off the bottom. This measures
// whether the whole final screen fits without scrolling at realistic sizes,
// and captures each one to look at.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import WS from 'ws';

const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || 'FLD1';
const SHOTS = (process.env.LS_OUT || '/tmp/late-signal') + '/shots';

const VIEWPORTS = [
  { name: 'laptop-1366x768', w: 1366, h: 768, dsf: 1, mobile: false },
  { name: 'desktop-1920x1080', w: 1920, h: 1080, dsf: 1, mobile: false },
  { name: 'phone-390x844', w: 390, h: 844, dsf: 2, mobile: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

class Tab {
  constructor(n) { this.name = n; this.id = 0; this.pending = new Map(); }
  async open() {
    const r = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' });
    const t = await r.json(); this.target = t;
    this.ws = new WS(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
    await this.cmd('Runtime.enable'); await this.cmd('Page.enable');
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(this.name + ' timeout ' + method)), 40000);
      this.pending.set(id, (m) => { clearTimeout(to); m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(body) {
    const r = await this.cmd('Runtime.evaluate', { expression: `(function(){${body}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  async viewport(v) {
    await this.cmd('Emulation.setDeviceMetricsOverride', {
      width: v.w, height: v.h, deviceScaleFactor: v.dsf, mobile: v.mobile,
    });
  }
  async shot(name) {
    const r = await this.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64'));
  }
  async close() { try { await fetch(CDP + '/json/close/' + this.target.id); } catch {} }
}

const tabs = [new Tab('A'), new Tab('B'), new Tab('C'), new Tab('D')];
const names = ['Ada', 'Bo', 'Cy', 'Dee'];

async function join(tab, name) {
  await tab.cmd('Page.navigate', { url: PAGE });
  await sleep(1300);
  await tab.ev(`
    document.getElementById('nameInput').value = ${JSON.stringify(name)};
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(800);
}

const A = tabs[0];
try {
  for (const t of tabs) await t.open();
  // Four players so the podium has all three medals AND a plain 4th row.
  for (let i = 0; i < tabs.length; i++) await join(tabs[i], names[i]);
  await A.cmd('Page.bringToFront');
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(2500);

  const waitFor = async (tab, body, what, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await tab.ev(body)) return true; await sleep(250); }
    throw new Error('timed out waiting for ' + what);
  };

  for (let round = 0; round < 10; round++) {
    await waitFor(A, "return !!document.querySelector('.tile[data-i=\"0\"]:not([disabled])');", 'tiles r' + (round + 1));
    for (let i = 0; i < tabs.length; i++) {
      await tabs[i].ev(`var t=document.querySelector('.tile[data-i="${i % 4}"]'); if(t) t.click(); return true;`);
      await sleep(180);   // stagger so speed points separate the field
    }
    if (round === 9) break;
    await waitFor(A, "return !!document.querySelector('#boardActions button:not([disabled])');", 'board');
    await A.ev("var b=document.querySelector('#boardActions button'); if(b) b.click(); return true;");
  }
  await waitFor(A, "return !!document.querySelector('#boardActions button:not([disabled])');", 'final board');
  await A.ev("var b=document.querySelector('#boardActions button'); if(b) b.click(); return true;");
  await waitFor(A, "var e=document.getElementById('s-final'); return !!(e && e.offsetParent !== null);", 'final screen');
  await sleep(3400);

  for (const v of VIEWPORTS) {
    await A.viewport(v);
    await sleep(700);
    await A.shot('fold-' + v.name);
    const m = await A.ev(`
      var d = document.documentElement;
      var rows = document.querySelectorAll('#finalRest .row');
      var last = rows[rows.length - 1];
      var lastBottom = last ? last.getBoundingClientRect().bottom : 0;
      return {
        scrollH: d.scrollHeight, clientH: d.clientHeight,
        vScroll: d.scrollHeight > d.clientHeight + 1,
        hScroll: d.scrollWidth > d.clientWidth + 1,
        rows: rows.length,
        lastRowBottom: Math.round(lastBottom),
        lastRowVisible: last ? lastBottom <= d.clientHeight + 1 : false,
      };`);
    console.log(`${v.name.padEnd(18)} rows=${m.rows} content=${m.scrollH}px viewport=${m.clientH}px ` +
                `vScroll=${m.vScroll} lastRowVisible=${m.lastRowVisible}`);
    ok(!m.hScroll, `${v.name}: no horizontal scroll`);
    ok(m.lastRowVisible, `${v.name}: the whole podium is visible without scrolling`,
       { contentHeight: m.scrollH, viewport: m.clientH, lastRowBottom: m.lastRowBottom });
  }
} catch (e) {
  fails.push('FAIL  threw :: ' + e.message);
}

for (const t of tabs) await t.close();
console.log('');
for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
