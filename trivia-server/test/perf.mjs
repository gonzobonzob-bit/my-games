// Framerate baseline. Drives two real clients into a live question and samples
// requestAnimationFrame deltas through the clock's cruise -> warm -> panic
// escalation, which is the most animation-dense moment in the game.
//
// CAVEAT, stated up front: this runs in headless Chrome with software
// rasterisation. The ABSOLUTE fps here is not what the Haswell iGPU will do on
// a real display. What it IS good for is a controlled before/after comparison —
// identical conditions, same probe, so a regression introduced by new visual
// effects shows up as a real delta.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import WS from 'ws';

const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || 'PRF1';
const LABEL = process.argv[3] || 'baseline';
const OUT = `process.env.LS_OUT || '/tmp/late-signal'/perf-${LABEL}.json`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Tab {
  constructor(name) { this.name = name; this.id = 0; this.pending = new Map(); }
  async open(url) {
    const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
    const t = await r.json();
    this.target = t;
    this.ws = new WS(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
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
      const to = setTimeout(() => rej(new Error(this.name + ' CDP timeout ' + method)), 40000);
      this.pending.set(id, (m) => {
        clearTimeout(to);
        if (m.error) rej(new Error(method + ': ' + m.error.message));
        else res(m.result);
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
  async close() { try { await fetch(CDP + '/json/close/' + this.target.id); } catch {} }
}

async function join(tab, name) {
  await tab.cmd('Page.navigate', { url: PAGE });
  await sleep(1200);
  await tab.ev(`
    document.getElementById('nameInput').value = ${JSON.stringify(name)};
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click();
    return true;
  `);
  await sleep(900);
}

// Sample rAF deltas for `ms`, then report the distribution.
// The setTimeout guard matters: a backgrounded tab stops firing rAF entirely,
// so without it a throttled tab hangs the probe instead of reporting that it
// was throttled. Any result with frames === 0 means "this tab wasn't drawing".
const SAMPLER = (ms) => `
  return new Promise(function (resolve) {
    var d = [], last = performance.now(), t0 = last, done = false;
    function finish() {
      if (done) return; done = true;
      if (!d.length) { resolve({ frames: 0, throttled: true }); return; }
      var s = d.slice().sort(function (a, b) { return a - b; });
      var n = s.length;
      var sum = s.reduce(function (a, b) { return a + b; }, 0);
      resolve({
        frames: n,
        mean: +(sum / n).toFixed(2),
        p50: +s[(n * 0.5) | 0].toFixed(2),
        p95: +s[(n * 0.95) | 0].toFixed(2),
        worst: +s[n - 1].toFixed(2),
        over32ms: s.filter(function (x) { return x > 32; }).length,
        over50ms: s.filter(function (x) { return x > 50; }).length,
      });
    }
    function step(now) {
      d.push(now - last); last = now;
      if (now - t0 < ${ms}) requestAnimationFrame(step);
      else finish();
    }
    requestAnimationFrame(step);
    setTimeout(finish, ${ms} + 2500);
  });
`;

const A = new Tab('A'), B = new Tab('B');
const report = { label: LABEL, room: ROOM, phases: {} };

try {
  await A.open('about:blank');
  await B.open('about:blank');
  await join(A, 'Perf1');
  await join(B, 'Perf2');

  // rAF cadence alone is a weak signal here — headless software rasterisation
  // drives frames on a fixed clock, so it reports a flat 60fps regardless of
  // how expensive the painting is. Chrome's own counters DO measure the real
  // style/layout/script cost, which is what a new visual effect would inflate.
  await A.cmd('Performance.enable');
  const metrics = async () => {
    const { metrics: m } = await A.cmd('Performance.getMetrics');
    const pick = {};
    for (const x of m) {
      if (['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration',
           'LayoutCount', 'RecalcStyleCount', 'Nodes'].includes(x.name)) pick[x.name] = x.value;
    }
    return pick;
  };
  const deltaOf = (a, b) => {
    const d = {};
    for (const k of Object.keys(b)) {
      d[k] = k.endsWith('Duration') ? +((b[k] - (a[k] || 0)) * 1000).toFixed(1)
                                    : b[k] - (a[k] || 0);
    }
    return d;
  };

  // A must be the visible tab or Chrome throttles its rAF to nothing.
  await A.cmd('Page.bringToFront');
  const m0 = await metrics();
  const lobby = await A.ev(SAMPLER(2500));
  report.phases.lobby = lobby;

  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(1500);

  // The question is 20s. Sample 12s of it — long enough to cross the warm
  // (10s) and panic (5s) thresholds where the clock animation intensifies.
  const mq0 = await metrics();
  const question = await A.ev(SAMPLER(12000));
  report.phases.question = question;
  report.cost = { question: deltaOf(mq0, await metrics()) };

  // Let the round resolve, then catch the reveal + scoreboard transition.
  await sleep(1500);
  const reveal = await A.ev(SAMPLER(3000));
  report.phases.reveal = reveal;

  report.cost.session = deltaOf(m0, await metrics());
} catch (e) {
  report.error = e.message;
}

await A.close(); await B.close();
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log(`=== framerate: ${LABEL} ===`);
for (const [k, v] of Object.entries(report.phases)) {
  if (!v) continue;
  const fps = (1000 / v.mean).toFixed(1);
  console.log(
    k.padEnd(10),
    `${fps} fps avg`.padEnd(14),
    `p50 ${v.p50}ms`.padEnd(13),
    `p95 ${v.p95}ms`.padEnd(13),
    `worst ${v.worst}ms`.padEnd(15),
    `janky(>32ms) ${v.over32ms}/${v.frames}`,
  );
}
if (report.cost) {
  console.log('\nreal rendering cost (ms of work, not cadence):');
  for (const [k, v] of Object.entries(report.cost)) {
    console.log(` ${k}: style ${v.RecalcStyleDuration}ms / layout ${v.LayoutDuration}ms / script ${v.ScriptDuration}ms` +
                ` | restyles ${v.RecalcStyleCount} layouts ${v.LayoutCount} nodes ${v.Nodes}`);
  }
}
if (report.error) console.log('ERROR:', report.error);
console.log('written to', OUT);
