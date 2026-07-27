// Renders every Late Signal sound in an OfflineAudioContext inside real
// Chrome and measures it. This cannot tell us whether a sound is PLEASANT.
// It can tell us that every sound actually produces audio, that none of them
// clip, that none of them are accidentally silent, and that their lengths are
// what the design says they are. Those are the failures that ship.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import WS from 'ws';

const CDP = 'http://127.0.0.1:9222';
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

// name -> [args, minDur, maxDur]  (expected audible length in seconds)
const CASES = [
  ['join', [], 0.05, 0.40],
  ['leave', [], 0.05, 0.40],
  ['start', [], 0.50, 1.30],
  ['question', [], 0.15, 0.60],
  ['tick', [0], 0.01, 0.20],
  ['tick', [1], 0.01, 0.20],
  ['timeup', [], 0.20, 0.70],
  ['lock', [], 0.30, 0.90],
  ['reveal', [], 0.12, 0.55],
  ['correct', [], 0.40, 1.10],
  ['wrong', [], 0.12, 0.55],
  ['rowLand', [1, 8], 0.03, 0.30],
  ['rowLand', [8, 8], 0.03, 0.30],
  ['podium', [3], 0.15, 0.70],
  ['podium', [2], 0.20, 0.80],
  ['podium', [1], 0.25, 0.95],
  ['win', [], 1.00, 2.20],
  ['finish', [], 0.35, 1.10],
  ['countdown', [3], 0.04, 0.35],
  ['countdown', [1], 0.10, 0.60],
  ['reconnect', [], 0.05, 0.40],
  ['blip', [660, 60, 0.05], 0.02, 0.25],
];

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
    const r = await this.cmd('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  }
}

const tab = new Tab();
await tab.open('about:blank');
await tab.evalAsync(ENGINE + '\n;window.makeAudio = makeAudio; true');

const results = await tab.evalAsync(`(async () => {
  const CASES = ${JSON.stringify(CASES)};
  const SR = 44100, LEN = 3;
  const out = [];
  for (const [name, args, minD, maxD] of CASES) {
    const ctx = new OfflineAudioContext(1, SR * LEN, SR);
    const A = window.makeAudio(() => ctx, () => true);
    A[name].apply(null, args);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0, first = -1, last = -1;
    const FLOOR = 1e-4;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
      if (a > FLOOR) { if (first < 0) first = i; last = i; }
    }
    out.push({
      name, args,
      peak: +peak.toFixed(5),
      rms: +Math.sqrt(sum / d.length).toFixed(6),
      dur: first < 0 ? 0 : +((last - first) / SR).toFixed(3),
      minD, maxD,
    });
  }
  return out;
})()`);

const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

console.log('sound              peak     rms       audible');
console.log('-'.repeat(52));
for (const r of results) {
  const tag = r.name + (r.args.length ? '(' + r.args.join(',') + ')' : '');
  console.log(
    tag.padEnd(18),
    String(r.peak).padEnd(8),
    String(r.rms).padEnd(9),
    r.dur + 's',
  );
  ok(r.peak > 0.002, `${tag}: produces audible output`, r.peak);
  ok(r.peak < 0.99, `${tag}: does not clip`, r.peak);
  ok(r.dur >= r.minD && r.dur <= r.maxD, `${tag}: length in design range`, { got: r.dur, want: [r.minD, r.maxD] });
}

// Rule 2 is a measurable claim, not a vibe: celebration must actually be
// louder than correction.
const correct = results.find((r) => r.name === 'correct');
const wrong = results.find((r) => r.name === 'wrong');
ok(correct.rms > wrong.rms * 1.5,
   'RULE 2: celebration is measurably louder than correction',
   { correct: correct.rms, wrong: wrong.rms });

// Rule 1: the clock sharpens under pressure.
const t0 = results.find((r) => r.name === 'tick' && r.args[0] === 0);
const t1 = results.find((r) => r.name === 'tick' && r.args[0] === 1);
ok(t1.peak > t0.peak, 'RULE 1: the tick intensifies as the deadline closes', { cool: t0.peak, hot: t1.peak });

// The winner fanfare should be the biggest moment in the game.
const win = results.find((r) => r.name === 'win');
ok(win.dur > correct.dur, 'the winner fanfare outlasts a correct answer', { win: win.dur, correct: correct.dur });

// Muted must mean silent — the gate, not just a low volume.
const muted = await tab.evalAsync(`(async () => {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const A = window.makeAudio(() => ctx, () => false);
  A.win(); A.correct(); A.tick(1); A.blip(880, 100, 0.5);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return peak;
})()`);
ok(muted === 0, 'muted is actually silent, not merely quiet', muted);

// A thrown error inside audio must never reach the caller.
const threw = await tab.evalAsync(`(() => {
  const A = window.makeAudio(() => { throw new Error('no audio device'); }, () => true);
  try { A.win(); A.correct(); A.tick(0.5); return 'survived'; }
  catch (e) { return 'THREW: ' + e.message; }
})()`);
ok(threw === 'survived', 'a dead AudioContext cannot throw into the render path', threw);

console.log('');
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
