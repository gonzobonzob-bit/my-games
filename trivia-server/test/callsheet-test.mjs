// The lobby call sheet, in a real browser. Host controls it, everyone sees it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import WS from 'ws';

const CDP = process.env.LS_CDP || 'http://127.0.0.1:9222';
const PAGE = process.env.LS_PAGE || 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || 'CS01';
const SHOTS = (process.env.LS_OUT || '/tmp/late-signal') + '/shots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

class Tab {
  constructor(n) { this.name = n; this.id = 0; this.pending = new Map(); this.errors = []; }
  async open() {
    const r = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' });
    const t = await r.json(); this.target = t;
    this.ws = new WS(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
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
  async shot(n) {
    const r = await this.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${SHOTS}/${n}.png`, Buffer.from(r.data, 'base64'));
  }
  async close() { try { await fetch(CDP + '/json/close/' + this.target.id); } catch {} }
}

const A = new Tab('host'), B = new Tab('guest');
const read = `
  var cs = document.getElementById('callSheet');
  return {
    genre: document.getElementById('genreVal').textContent,
    diff: document.getElementById('diffVal').textContent,
    readonly: cs.classList.contains('readonly'),
    busy: cs.classList.contains('busy'),
    genreDisabled: document.getElementById('genreSlot').disabled,
    accent: getComputedStyle(document.getElementById('genreSlot')).getPropertyValue('--accent').trim(),
    stage: getComputedStyle(document.documentElement).getPropertyValue('--stage-hue').trim(),
    aria: document.getElementById('genreSlot').getAttribute('aria-label'),
  };`;

async function join(tab, name) {
  await tab.cmd('Page.navigate', { url: PAGE });
  await sleep(1300);
    // Pin the language. localStorage persists in the shared Chrome profile, so
    // a previous run that chose Spanish would otherwise silently make this one
    // a Spanish game — which then gets correctly REFUSED on a genre with no
    // Spanish, and looks like the game is broken. Same class of bug as reusing
    // room codes: shared persistent state leaking between runs.
    await tab.ev("try{localStorage.setItem('ls:lang','en')}catch(e){} return true;");
    await tab.cmd('Page.reload');
    await sleep(900);
  await tab.ev(`
    document.getElementById('nameInput').value = ${JSON.stringify(name)};
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(1000);
}

try {
  await A.open(); await B.open();
  await join(A, 'Hosty');
  await join(B, 'Guesty');
  await A.cmd('Page.bringToFront');
  await sleep(600);

  const a0 = await A.ev(read), b0 = await B.ev(read);
  ok(a0.genre === 'Mixed', 'host sees the default genre', a0.genre);
  ok(a0.diff === 'Any', 'host sees the default difficulty', a0.diff);
  ok(!a0.readonly && !a0.genreDisabled, 'the host gets a real control');
  ok(b0.readonly && b0.genreDisabled, 'a non-host gets a readout, not a control', b0);
  ok(/tap to change/i.test(a0.aria), 'the host control announces itself as changeable', a0.aria);
  ok(!/tap to change/i.test(b0.aria), 'the readout does not claim to be changeable', b0.aria);

  // --- host cycles the genre; the guest must see it -------------------------
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await A.ev("document.getElementById('genreSlot').click(); return true;");
    await sleep(650);
    const a = await A.ev(read), b = await B.ev(read);
    seen.push(a.genre);
    ok(a.genre === b.genre, `cycle ${i + 1}: the guest sees the same genre as the host`,
       { host: a.genre, guest: b.genre });
  }
  ok(new Set(seen).size === seen.length, 'each tap moves to a different genre', seen);
  console.log('   cycled through:', seen.join(' -> '));

  const aNow = await A.ev(read);
  ok(aNow.accent && aNow.accent !== '', 'the genre carries an accent colour', aNow.accent);
  ok(aNow.stage && aNow.stage !== '#161B2E', 'the lobby back wall took the genre hue', aNow.stage);

  // --- difficulty -----------------------------------------------------------
  await A.ev("document.getElementById('diffSlot').click(); return true;");
  await sleep(600);
  const aD = await A.ev(read), bD = await B.ev(read);
  ok(aD.diff !== 'Any', 'difficulty cycles off Any', aD.diff);
  ok(aD.diff === bD.diff, 'the guest sees the difficulty change too', { a: aD.diff, b: bD.diff });

  // --- a guest cannot change anything ---------------------------------------
  const before = (await A.ev(read)).genre;
  await B.ev("document.getElementById('genreSlot').click(); return true;");
  await sleep(700);
  const after = (await A.ev(read)).genre;
  ok(before === after, 'a guest clicking the slot changes nothing', { before, after });

  await A.shot('callsheet-lobby');
  await B.shot('callsheet-guest');

  // --- starting freezes the sheet -------------------------------------------
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(500);
  const aBusy = await A.ev(read);
  ok(aBusy.busy, 'starting freezes the call sheet', aBusy);

  // --- the chosen genre reaches the question screen -------------------------
  const t0 = Date.now();
  let cat = null;
  while (Date.now() - t0 < 30000) {
    cat = await A.ev("var e=document.getElementById('catText'); return e ? e.textContent : null;");
    if (cat && cat !== '' && cat !== 'General knowledge') break;
    await sleep(400);
  }
  console.log('   category chip on the question screen:', JSON.stringify(cat));
  ok(!!cat, 'the question screen shows a category', cat);
  await A.shot('callsheet-question');

  const errs = [...A.errors, ...B.errors].filter((e) => !/favicon|net::ERR/i.test(e));
  ok(errs.length === 0, 'no console errors', errs.slice(0, 3));
} catch (e) {
  fails.push('FAIL  threw :: ' + e.message);
}

await A.close(); await B.close();
console.log('');
for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
