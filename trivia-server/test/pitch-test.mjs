// The amplitude tests cannot see pitch. Two sounds that differ only in
// frequency measure identically for peak and RMS — so a rank/heat parameter
// that silently does nothing would pass the main harness. This measures the
// spectral centroid (the "brightness" centre of mass) to prove the parameter
// actually moves the sound.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import WS from 'ws';

const CDP = process.env.LS_CDP || 'http://127.0.0.1:9222';
// Pull the audio engine out of the shipped client so this tests the code that
// actually runs, rather than a copy that can silently drift from it.
function engineSource() {
  const html = fs.readFileSync(path.join(ROOT, 'trivia/index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const start = script.indexOf('function makeAudio');
  if (start < 0) throw new Error('makeAudio not found in trivia/index.html');
  const tail = script.slice(start);
  const end = tail.indexOf('\n  var SFX = makeAudio');
  if (end < 0) throw new Error('end of makeAudio not found');
  return tail.slice(0, end);
}
const ENGINE = engineSource();

class Tab {
  constructor() { this.id = 0; this.pending = new Map(); }
  async open(url) {
    const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
    const t = await r.json();
    this.ws = new WS(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
    await this.cmd('Runtime.enable');
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('CDP timeout ' + method)), 60000);
      this.pending.set(id, (m) => {
        clearTimeout(to);
        if (m.error) rej(new Error(method + ': ' + m.error.message));
        else res(m.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evalAsync(expr) {
    const r = await this.cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
}

const tab = new Tab();
await tab.open('about:blank');
await tab.evalAsync(ENGINE + '\n;window.makeAudio = makeAudio; true');

// Spectral centroid via an AnalyserNode is awkward offline, so do a plain
// DFT over a modest bin set — accurate enough to compare two sounds.
const centroid = async (name, args) => tab.evalAsync(`(async () => {
  const SR = 44100;
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const A = window.makeAudio(() => ctx, () => true);
  A['${name}'].apply(null, ${JSON.stringify(args)});
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  // Trim to the audible span so trailing silence does not skew the result.
  let first = -1, last = -1;
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i]) > 1e-4) { if (first < 0) first = i; last = i; }
  }
  if (first < 0) return 0;
  const seg = d.subarray(first, last + 1);
  const N = Math.min(seg.length, 8192);
  let num = 0, den = 0;
  for (let k = 1; k < 400; k++) {
    const f = k * SR / N;
    if (f > 8000) break;
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const ang = -2 * Math.PI * k * n / N;
      re += seg[n] * Math.cos(ang);
      im += seg[n] * Math.sin(ang);
    }
    const mag = Math.sqrt(re * re + im * im);
    num += f * mag; den += mag;
  }
  return den > 0 ? Math.round(num / den) : 0;
})()`);

const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

const rowTop = await centroid('rowLand', [1, 8]);
const rowBot = await centroid('rowLand', [8, 8]);
const tickCool = await centroid('tick', [0]);
const tickHot = await centroid('tick', [1]);
const pod3 = await centroid('podium', [3]);
const pod1 = await centroid('podium', [1]);
const cd3 = await centroid('countdown', [3]);
const cd1 = await centroid('countdown', [1]);

console.log('centroid (Hz)');
console.log('  rowLand rank1 / rank8 :', rowTop, '/', rowBot);
console.log('  tick cool / hot       :', tickCool, '/', tickHot);
console.log('  podium bronze / gold  :', pod3, '/', pod1);
console.log('  countdown 3 / 1       :', cd3, '/', cd1);
console.log('');

ok(rowTop > rowBot * 1.08, 'rowLand: rank actually changes pitch (1st brighter than 8th)', { rank1: rowTop, rank8: rowBot });
ok(tickHot > tickCool * 1.08, 'tick: heat actually raises pitch', { cool: tickCool, hot: tickHot });
ok(pod1 > pod3 * 1.08, 'podium: gold is brighter than bronze', { bronze: pod3, gold: pod1 });
ok(cd1 > cd3 * 1.08, 'countdown: the final pip resolves higher', { three: cd3, one: cd1 });

for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
