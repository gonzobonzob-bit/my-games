// Callsigns — smoke test: boots the real game in a real headless browser and
// proves the split (index.html + js/{content,sim,fx,ui}.js) still behaves like
// the monolith it was carved from: the menu boots clean, a new game starts
// through the actual UI, days simulate through the actual tick() without
// exceptions, and a save written under the v2 key survives a full page reload.
//
// This is NOT the balance harness (that ships at 75%, per the producer's
// binding condition #4) — it asserts nothing about winnability or spread,
// only that the refactor didn't break the machine.
//
// Run:  node callsigns/tests/smoke.mjs
// Needs a Chromium-family binary; defaults to microsoft-edge, override with
// SMOKE_BROWSER=/path/to/browser. No npm dependencies on purpose: Node 22's
// built-in fetch + WebSocket carry the whole CDP conversation, so this file
// can never rot the repo's "no external runtime dependency" rule.
//
// Driving rules learned from trivia-server/test/: unique profile dir per run
// (a reused profile inherits the last run's localStorage, which makes the
// "fresh boot shows New Game" assertion pass or fail on history rather than
// code), and every assertion must be able to fail — day count is asserted as
// an exact number, not "did not throw".

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER = process.env.SMOKE_BROWSER || 'microsoft-edge';
const TICKS = 12; // several in-game days; day 1 + 12 ticks must land on day 13

let passed = 0, failed = 0;
function assert(name, ok, detail){
  if (ok) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}

/* ---------------- static server ---------------- */
// localStorage is partitioned by origin and unreliable on file://, so the
// save/reload half of this test requires a real http origin.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
function startServer(){
  return new Promise(resolve => {
    const srv = createServer(async (req, res) => {
      const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      try {
        const body = await readFile(join(GAME_DIR, path));
        res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
        res.end(body);
      } catch (e) { res.writeHead(404); res.end('not found'); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* ---------------- CDP plumbing ---------------- */
// One WebSocket to the browser endpoint, flat sessions. Kept dependency-free
// deliberately — see header.
let ws, msgId = 0;
const pending = new Map();
const consoleErrors = [];   // console.error + uncaught exceptions, page-wide
let sessionId = null;

function send(method, params, sid){
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {}, ...(sid ? { sessionId: sid } : {}) }));
  });
}

function onMessage(raw){
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('exception: ' + JSON.stringify(m.params.exceptionDetails && m.params.exceptionDetails.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push('console.error: ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
  }
}

/** Evaluate in the page; throws on page-side exceptions so a broken split
    fails the run loudly instead of returning undefined into an assertion. */
async function evaluate(expr){
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true
  }, sessionId);
  if (r.exceptionDetails) {
    throw new Error('page threw: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  }
  return r.result && r.result.value;
}

/** Poll until an in-page condition is truthy — modal animations are 30ms
    setTimeout chains, so a fixed sleep is a race and a poll is not. */
async function until(expr, ms){
  const deadline = Date.now() + (ms || 5000);
  for (;;) {
    if (await evaluate(expr)) return true;
    if (Date.now() > deadline) throw new Error('timeout waiting for: ' + expr);
    await new Promise(r => setTimeout(r, 60));
  }
}

/** Click through the real delegated handler — el.click() is exactly what the
    gamepad's padActivate() does, so this path is production, not test-only. */
async function click(sel){
  await evaluate(`(function(){ const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element ' + ${JSON.stringify(sel)}); el.click(); return true; })()`);
}
/** Click the modal action button whose label matches — modal buttons are
    positional [data-modal-act] indices, and hardcoding an index would silently
    click Cancel if an action were ever added ahead of the one we want. */
async function clickModalButton(rx){
  await evaluate(`(function(){
    const btns = Array.from(document.querySelectorAll('#modal [data-modal-act]'));
    const b = btns.find(x => ${rx}.test(x.textContent));
    if (!b) throw new Error('no modal button matching ${rx} among: ' + btns.map(x => x.textContent).join('|'));
    b.click(); return true;
  })()`);
}

/* ---------------- the test ---------------- */
async function main(){
  const srv = await startServer();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const profile = await mkdtemp(join(tmpdir(), 'callsigns-smoke-'));

  // --remote-debugging-port=0 + DevToolsActivePort: no fixed port to collide
  // with another session's browser (this repo is worked by parallel sessions).
  const browser = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'
  ], { stdio: 'ignore' });

  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = parseInt((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 10) || null; }
    catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!port) throw new Error('browser never wrote DevToolsActivePort');

  const ver = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => onMessage(e.data);

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  try {
    /* ---- 1. fresh boot ---- */
    // #screen-menu is `active` in the static HTML, so "menu visible" is true
    // before a single script has run — wait for something only boot() writes
    // (refreshMenu fills the tagline) or the Continue assertion races the
    // script tags. The monolith hid this race; four <script src> files don't.
    await send('Page.navigate', { url }, sessionId);
    await until(`document.querySelector('#screen-menu') && document.querySelector('#screen-menu').classList.contains('active') && document.querySelector('#menu-tagline').textContent.length > 0`);
    assert('boots to main menu', true);
    assert('fresh boot: Continue disabled (no save)', await evaluate(`document.querySelector('#btn-continue').disabled`) === true);
    assert('script split loaded: sim globals reachable from ui scope',
      await evaluate(`typeof simulateDay === 'function' && typeof render === 'function' && typeof SCENE_TIERS !== 'undefined' && typeof SHOWS === 'object'`) === true);

    /* ---- 2. new game through the real UI ---- */
    await click('#btn-new');
    await until(`document.querySelector('#modal-back').classList.contains('open')`);
    await clickModalButton('/start/i');            // "Start Broadcasting"
    await until(`typeof S === 'object' && S !== null && S.day === 1`);
    assert('new game: state installed at day 1', true);
    // The intro modal auto-pauses the sim; dismissing it is part of the flow.
    await until(`document.querySelector('#modal-back').classList.contains('open')`);
    await clickModalButton('/./');                  // "Start the day" is its only button
    await until(`!document.querySelector('#modal-back').classList.contains('open')`);
    const s0 = await evaluate(`({ v: S.v, cash: S.cash, call: S.call, key: SAVE_KEY, slots: Object.keys(S.schedule).join(','), staffIsArray: Array.isArray(S.staff) })`);
    assert('save schema is v2 under the v2 key', s0.v === 2 && s0.key === 'callsigns.save', JSON.stringify(s0));
    assert('new game: starting cash 800', s0.cash === 800, s0.cash);
    assert('state shape: flat daypart schedule + global staff array',
      s0.slots === 'morning,midday,evening,night' && s0.staffIsArray, s0.slots);

    /* ---- 3. simulate days through the real tick() ---- */
    // tick() directly, not by waiting 5s/day of wall clock. Event/unlock modals
    // may queue behind these ticks; they pause the *interval*, but tick() called
    // by hand still simulates — which is exactly what we want asserted here.
    const after = await evaluate(`(function(){
      for (let i = 0; i < ${TICKS}; i++) tick();
      const d = S.lastDay;
      return { day: S.day, cash: S.cash, rep: S.rep, buzz: S.buzz, listeners: S.listeners,
               finite: [S.cash, S.rep, S.buzz, S.listeners, d.revenue, d.costs, d.net, d.quality, d.royalties, d.repTarget].every(Number.isFinite) };
    })()`);
    assert(TICKS + ' days simulated: day counter exact', after.day === 1 + TICKS, after.day);
    assert('all money/stat fields finite after simulation', after.finite, JSON.stringify(after));
    assert('idle station is cash-positive at day ' + after.day + ' (v2 economy)', after.cash > 800, after.cash);

    /* ---- 4. save persists ---- */
    const saved = await evaluate(`(function(){
      const ok = saveGame(true);
      const raw = localStorage.getItem(SAVE_KEY);
      const d = raw && JSON.parse(raw);
      return { ok, hasRaw: !!raw, day: d && d.day, call: d && d.call, v: d && d.v };
    })()`);
    assert('saveGame() writes the save', saved.ok === true && saved.hasRaw, JSON.stringify(saved));
    assert('saved day/version match live state', saved.day === after.day && saved.v === 2, JSON.stringify(saved));

    /* ---- 5. save survives a full reload ---- */
    await send('Page.navigate', { url }, sessionId);
    await until(`document.querySelector('#screen-menu') && document.querySelector('#screen-menu').classList.contains('active') && typeof S !== 'undefined' && S === null`);
    assert('reload: Continue enabled', await evaluate(`!document.querySelector('#btn-continue').disabled`) === true);
    await click('#btn-continue');
    await until(`typeof S === 'object' && S !== null`);
    const s1 = await evaluate(`({ day: S.day, call: S.call, v: S.v })`);
    // >= not ===: a reload more than a minute after the save would legitimately
    // trigger catchUp() and advance the day. Same-run reloads are < 60s so it
    // is === in practice, but the assertion shouldn't depend on test speed.
    assert('reloaded save resumes same station', s1.call === saved.call && s1.day >= saved.day && s1.v === 2, JSON.stringify(s1));

    /* ---- 6. nothing errored anywhere along the way ---- */
    assert('zero console errors / uncaught exceptions', consoleErrors.length === 0, consoleErrors.join(' ;; '));
  } finally {
    try { ws.close(); } catch (e) {}
    browser.kill();
    srv.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error('smoke harness fault:', err); process.exit(2); });
