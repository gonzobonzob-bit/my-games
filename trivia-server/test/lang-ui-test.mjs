// The language selector in real browsers, including the case the whole feature
// exists for: two people in one room reading different languages, picking the
// same slot, and both being scored correctly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WS from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CDP = process.env.LS_CDP || 'http://127.0.0.1:9222';
const PAGE = process.env.LS_PAGE || 'http://localhost:8000/trivia/';
const OUT = (process.env.LS_OUT || '/tmp/late-signal') + '/shots';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM = (process.argv[2] || Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('')).toUpperCase();

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

/* A browser-level connection, used only to mint isolated contexts. */
class Browser {
  constructor() { this.id = 0; this.pending = new Map(); }
  async connect() {
    const v = await (await fetch(CDP + '/json/version')).json();
    this.ws = new WS(v.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('browser timeout ' + method)), 20000);
      this.pending.set(id, (m) => { clearTimeout(to); m.error ? rej(new Error(m.error.message)) : res(m.result); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
const browser = new Browser();

class Tab {
  constructor(n) { this.name = n; this.id = 0; this.pending = new Map(); this.errors = []; }
  /* Each player gets a genuinely SEPARATE browser context — the CDP equivalent
     of a different device. Opening two ordinary tabs shares one profile's
     localStorage, so setting the language for one silently sets it for the
     other; an earlier version of this test did exactly that and reported that
     both players were English, hiding the real bug underneath. */
  async open() {
    const { browserContextId } = await browser.cmd('Target.createBrowserContext', {
      disposeOnDetach: false,
    });
    this.contextId = browserContextId;
    const { targetId } = await browser.cmd('Target.createTarget', {
      url: 'about:blank', browserContextId,
    });
    this.target = { id: targetId };
    this.ws = new WS(`ws://127.0.0.1:9222/devtools/page/${targetId}`, { maxPayload: 64 * 1024 * 1024 });
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
    throw new Error(this.name + ' timed out waiting for ' + what);
  }
  async close() {
    try { await browser.cmd('Target.closeTarget', { targetId: this.target.id }); } catch {}
    try { await browser.cmd('Target.disposeBrowserContext', { browserContextId: this.contextId }); } catch {}
  }
}

const board = `
  var tiles = [].slice.call(document.querySelectorAll('.tile'));
  return {
    q: (document.getElementById('questionText')||{}).textContent || '',
    choices: tiles.map(function (t) {
      var n = t.querySelector('.tile-text') || t;
      return n.textContent.trim();
    }),
    lang: document.getElementById('langLabel').textContent,
    htmlLang: document.documentElement.getAttribute('lang'),
  };`;

const A = new Tab('es'), B = new Tab('en');

async function join(tab, name) {
  await tab.cmd('Page.navigate', { url: PAGE });
  await sleep(1400);
  await tab.ev(`
    document.getElementById('nameInput').value = ${JSON.stringify(name)};
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(1100);
}

try {
  await browser.connect();
  await A.open(); await B.open();
  // Language is announced on the WebSocket handshake, so it must be set before
  // the join click — and set independently per tab.
  await A.cmd('Page.navigate', { url: PAGE });
  await sleep(1200);
  await A.ev("localStorage.setItem('ls:lang','es'); return true;");
  await B.cmd('Page.navigate', { url: PAGE });
  await sleep(1200);
  await B.ev("localStorage.setItem('ls:lang','en'); return true;");
  await join(A, 'Ana');
  await join(B, 'Ben');
  await A.cmd('Page.bringToFront');
  await sleep(600);

  const la = await A.ev("return { label: document.getElementById('langLabel').textContent, html: document.documentElement.getAttribute('lang'), join: document.getElementById('createBtn').textContent };");
  ok(la.label === 'ES', 'the Spanish player sees the ES toggle', la);
  ok(la.html === 'es', 'the document language attribute follows', la);

  const lb = await B.ev("return { label: document.getElementById('langLabel').textContent, html: document.documentElement.getAttribute('lang') };");
  ok(lb.label === 'EN', 'the English player is unaffected', lb);

  // Spanish chrome in the lobby.
  const chrome = await A.ev("var k=document.querySelectorAll('.slot-k'); return { genre: k[0]&&k[0].textContent, diff: k[1]&&k[1].textContent };");
  ok(chrome.genre === 'Género', 'lobby chrome is Spanish for the Spanish player', chrome);
  await A.shot('lang-lobby-es');
  await B.shot('lang-lobby-en');

  // Pick a genre that HAS Spanish, then play a round.
  await A.ev("var b=document.getElementById('genreSlot'); for(var i=0;i<8;i++){ if(document.getElementById('genreVal').textContent.indexOf('Music')===0) break; b.click(); } return document.getElementById('genreVal').textContent;");
  await sleep(900);
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await A.until("return !!document.querySelector('.tile');", 'tiles (es)');
  await B.until("return !!document.querySelector('.tile');", 'tiles (en)');
  await sleep(900);

  const ba = await A.ev(board), bb = await B.ev(board);
  console.log('  ES question:', ba.q.slice(0, 62));
  console.log('  EN question:', bb.q.slice(0, 62));
  console.log('  ES choices :', ba.choices.join(' | ').slice(0, 80));
  console.log('  EN choices :', bb.choices.join(' | ').slice(0, 80));

  ok(ba.q && bb.q, 'both players see a question');
  ok(ba.q !== bb.q, 'the two players are reading DIFFERENT text', { es: ba.q.slice(0, 40), en: bb.q.slice(0, 40) });
  ok(ba.choices.length === 4 && bb.choices.length === 4, 'both boards have four tiles');
  // NOT asserted: that the choice strings differ. Plenty of correct answers are
  // proper nouns that are identical in both languages — this round's were
  // Run-DMC, Beastie Boys, Public Enemy, N.W.A. Demanding a difference there
  // fails a perfectly correct translation. What must hold is that the boards
  // are ALIGNED, which the slot assertions below check.
  ok(ba.choices.length === bb.choices.length, 'both boards have the same number of slots');
  // Spanish text should carry Spanish orthography somewhere in the round.
  ok(/[¿¡áéíóúñÁÉÍÓÚÑ]/.test(ba.q + ba.choices.join('')), 'the Spanish board actually reads as Spanish', ba.q.slice(0, 50));
  await A.shot('lang-question-es');
  await B.shot('lang-question-en');

  // THE POINT: same slot, different language, both scored the same way.
  await A.ev("var t=document.querySelector('.tile[data-i=\"1\"]'); if(t) t.click(); return true;");
  await B.ev("var t=document.querySelector('.tile[data-i=\"1\"]'); if(t) t.click(); return true;");
  await sleep(2600);
  const verdicts = await Promise.all([A, B].map((t) => t.ev(`
    var tiles = [].slice.call(document.querySelectorAll('.tile'));
    return {
      correctSlot: tiles.findIndex(function (x) { return /correct|right|flood/.test(x.className); }),
      picked: tiles.findIndex(function (x) { return /picked/.test(x.className); }),
    };`)));
  ok(verdicts[0].picked === verdicts[1].picked, 'both picked the same slot', verdicts);
  ok(verdicts[0].correctSlot === verdicts[1].correctSlot,
     'THE POINT: the same slot is marked correct in BOTH languages', verdicts);
  await A.shot('lang-reveal-es');

  // Switching mid-game re-renders without breaking anything.
  await A.ev("document.getElementById('langBtn').click(); return true;");
  await sleep(900);
  const afterSwitch = await A.ev("return { label: document.getElementById('langLabel').textContent, html: document.documentElement.getAttribute('lang') };");
  ok(afterSwitch.label === 'EN', 'the toggle switches back mid-game', afterSwitch);

  // The game's own messages must reach a Spanish player in Spanish. Before
  // this, every notice and error was English-only prose from the server —
  // "Spanish support, except when the game talks to you".
  const toastA = await A.ev("var t=document.querySelector('.toast'); return t ? t.textContent : '';");
  const toastB = await B.ev("var t=document.querySelector('.toast'); return t ? t.textContent : '';");
  console.log('  ES toast:', JSON.stringify(toastA));
  console.log('  EN toast:', JSON.stringify(toastB));
  if (toastA || toastB) {
    ok(!/Everyone can read these/i.test(toastA),
       'the Spanish player does not get the English notice', toastA);
  }

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
