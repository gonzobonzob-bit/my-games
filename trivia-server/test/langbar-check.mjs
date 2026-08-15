/* The landing screen's language control.
 *
 * It exists because `body[data-screen="landing"] .hud{ display:none }` hides
 * the whole HUD — including the language chip — on the first screen anyone
 * sees. Before this bar, a Spanish reader could not switch language until they
 * were already inside a room.
 *
 * Deliberately single-page: no game, no second browser, no worker traffic. The
 * multi-browser suites need a quiet machine and go red under load; this one
 * does not, so a language regression stays findable on a busy box. */
import http from 'node:http';

const CDP = process.env.LS_CDP || 'http://127.0.0.1:9222';
const PAGE = process.env.LS_PAGE || 'http://localhost:8000/trivia/';
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const req = (u, method) => new Promise((res, rej) => {
  const url = new URL(u);
  http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method },
    (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); })
    .on('error', rej).end();
});

// Chrome now requires PUT for /json/new.
const targets = await req(CDP + '/json/new?' + encodeURIComponent(PAGE), 'PUT');
const wsUrl = targets.webSocketDebuggerUrl;
const { default: WS } = await import('ws');
const ws = new WS(wsUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((r) => ws.once('open', r));

let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params?.exceptionDetails?.exception?.description || 'exception');
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
  }
});
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await sleep(1800);

// --- structure -------------------------------------------------------------
ok(await evaluate(`!!document.getElementById('langBar')`), 'landing has a language bar');
const pills = await evaluate(`document.querySelectorAll('#langOpts .lang-pill').length`);
ok(pills === 2, 'it offers one pill per language', pills);
ok(await evaluate(`getComputedStyle(document.querySelector('.hud')).display`) === 'none',
   'the HUD really is hidden on landing (which is why this bar has to exist)');
ok(await evaluate(`document.getElementById('langOpts').getAttribute('role')`) === 'radiogroup',
   'the group is a radiogroup');

// Each option names itself in its OWN language — the control has to be findable
// by somebody who cannot read the language currently applied.
ok(await evaluate(`document.querySelector('.lang-pill[data-lang="es"]').getAttribute('aria-label')`) === 'Español',
   'the Spanish option is labelled in Spanish');
ok(await evaluate(`document.querySelector('.lang-pill[data-lang="en"]').getAttribute('aria-label')`) === 'English',
   'the English option is labelled in English');

// --- touch target ----------------------------------------------------------
const box = await evaluate(`(() => { const r = document.querySelector('.lang-pill').getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
ok(box.w >= 44 && box.h >= 44, 'pills meet the 44px touch floor', box);

// --- behaviour -------------------------------------------------------------
await evaluate(`localStorage.setItem('ls:lang','en'); location.reload()`);
await sleep(1800);
const ledeEn = await evaluate(`document.querySelector('.lede').textContent.slice(0,40)`);
ok(await evaluate(`document.querySelector('.lang-pill[data-lang="en"]').getAttribute('aria-checked')`) === 'true',
   'the active language is the checked pill');

await evaluate(`document.querySelector('.lang-pill[data-lang="es"]').click()`);
await sleep(500);
const ledeEs = await evaluate(`document.querySelector('.lede').textContent.slice(0,40)`);
ok(ledeEs !== ledeEn, 'clicking ES actually re-words the page', { ledeEn, ledeEs });
ok(await evaluate(`document.documentElement.getAttribute('lang')`) === 'es',
   'the document lang attribute follows');
ok(await evaluate(`document.getElementById('langBarLabel').textContent`) === 'Idioma',
   'the bar labels itself in the new language');
ok(await evaluate(`document.querySelector('.lang-pill[data-lang="es"]').getAttribute('aria-checked')`) === 'true',
   'the checked pill moves');
ok(await evaluate(`localStorage.getItem('ls:lang')`) === 'es', 'the choice persists');

// and back again, through the same shared setter
await evaluate(`document.querySelector('.lang-pill[data-lang="en"]').click()`);
await sleep(400);
ok(await evaluate(`document.querySelector('.lede').textContent.slice(0,40)`) === ledeEn,
   'switching back restores the English wording exactly');

// --- the HUD chip and the bar must agree -----------------------------------
await evaluate(`localStorage.setItem('ls:lang','en'); location.reload()`);
await sleep(1800);
ok(await evaluate(`document.getElementById('langLabel').textContent`) === 'EN', 'HUD chip starts EN');
await evaluate(`document.querySelector('.lang-pill[data-lang="es"]').click()`);
await sleep(400);
ok(await evaluate(`document.getElementById('langLabel').textContent`) === 'ES',
   'the HUD chip follows the landing bar (one shared setter, no drift)');

ok(consoleErrors.length === 0, 'no console errors', consoleErrors.slice(0, 3));

for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
ws.close();
process.exit(fails.length ? 1 : 0);
