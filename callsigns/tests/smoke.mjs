// Callsigns — smoke test: boots the real game in a real headless browser and
// proves the machine works end to end: the menu boots clean, a new game starts
// through the actual UI, days simulate through the actual tick() without
// exceptions, and a save survives a full page reload.
//
// Updated to the v3 empire shape in the same commit as the state change
// (CONTRACT.md: "the systems-engineer updates its shape assertions IN the v3
// commit, not after"). What it now pins down is the v3 contract: S.stations is
// an array of up to four stations, each with its own gear and its own flat
// daypart schedule; staff is ONE global array; a slot carries djs[] plus eng;
// and every station pays a daily lease that lands in the day's costs.
//
// This is NOT the balance harness — it asserts nothing about winnability or
// spread, only that the machine runs and the ledger adds up.
//
// Run:  node callsigns/tests/smoke.mjs
// Needs a Chromium-family binary; defaults to microsoft-edge, override with
// SMOKE_BROWSER=/path/to/browser. SMOKE_PORT and SMOKE_PROFILE pin the CDP
// port and profile directory when several suites run at once (the default is
// an ephemeral port and a fresh temp profile, which is the right thing for a
// lone run — see the profile note below). No npm dependencies on purpose:
// Node 22's built-in fetch + WebSocket carry the whole CDP conversation, so
// this file can never rot the repo's "no external runtime dependency" rule.
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
  // A UNIQUE profile per run, always: a reused profile inherits the last run's
  // localStorage, which makes the "fresh boot shows New Game" assertion pass or
  // fail on history rather than on code.
  const profile = process.env.SMOKE_PROFILE || await mkdtemp(join(tmpdir(), 'callsigns-smoke-'));

  // --remote-debugging-port=0 + DevToolsActivePort: no fixed port to collide
  // with another session's browser (this repo is worked by parallel sessions).
  // SMOKE_PORT overrides it for a session that needs a known port.
  const browser = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + (process.env.SMOKE_PORT || '0'), 'about:blank'
  ], { stdio: 'ignore' });

  // With an ephemeral port the browser tells us which one it took by writing
  // DevToolsActivePort into the profile. With an explicit SMOKE_PORT we know
  // it already — and must not wait for that file: measured on Edge 1xx, a
  // fixed --remote-debugging-port does not always write it at all, so polling
  // for it is a ten-second wait ending in a false "browser never started".
  let port = process.env.SMOKE_PORT ? parseInt(process.env.SMOKE_PORT, 10) : null;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = parseInt((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 10) || null; }
    catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!port) throw new Error('browser never wrote DevToolsActivePort');

  // The endpoint can lag the process by a moment on either path.
  let ver = null;
  for (let i = 0; i < 100 && !ver; i++) {
    try { ver = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); }
    catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!ver) throw new Error('browser never answered on the CDP port ' + port);
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
    // The three v3 mechanics have to exist as callable seams, or the rest of
    // this file would be asserting the v2 game with new field names.
    assert('v3 mechanics present: marketShare / loadFactor / slotRisk / foundStation',
      // Function declarations in a classic script land on window, which is how
      // this can name them as data rather than as eight separate typeof reads.
      await evaluate(`['marketShare','loadFactor','slotRisk','crewSkill','chem','foundStation','leaseFor','ledgerDrift'].every(f => typeof window[f] === 'function')`) === true);

    /* ---- 2. new game through the real UI ---- */
    await click('#btn-new');
    await until(`document.querySelector('#modal-back').classList.contains('open')`);
    await clickModalButton('/start/i');            // "Start Broadcasting"
    await until(`typeof S === 'object' && S !== null && S.day === 1`);
    assert('new game: state installed at day 1', true);
    /* Onboarding is NOT a modal (producer condition #7). This used to wait for
       an intro modal and dismiss it; that modal is gone on purpose, replaced by
       an inline coach card above the schedule whose button performs the
       decision it describes. Asserting the absence is the point — a future
       change that "helpfully" reintroduces a blocking intro dialog would
       otherwise sail through a suite that was written expecting one. */
    await until(`!document.querySelector('#modal-back').classList.contains('open')`);
    assert('onboarding does not open a modal',
      await evaluate(`!document.querySelector('#modal-back').classList.contains('open')`) === true);
    assert('onboarding is an inline coach card with content',
      await evaluate(`(function(){
        const c = document.querySelector('#studio-coach');
        return !!c && c.textContent.trim().length > 0;
      })()`) === true);
    // ...and it must not have stopped the clock to say it.
    assert('onboarding leaves the sim running (no auto-pause)',
      await evaluate(`typeof paused === 'undefined' || paused === false`) === true);
    const s0 = await evaluate(`({
      v: S.v, cash: S.cash, key: SAVE_KEY,
      stationsIsArray: Array.isArray(S.stations), stations: S.stations.length,
      call: S.stations[0].call, segment: S.stations[0].segment,
      tx: S.stations[0].tx, ant: S.stations[0].ant,
      slots: Object.keys(S.stations[0].schedule).join(','),
      slotShape: (function(){ const m = S.stations[0].schedule.morning;
        return Array.isArray(m.djs) && Array.isArray(m.engs) && !('dj' in m); })(),
      staffIsArray: Array.isArray(S.staff), perStationStaff: 'staff' in S.stations[0],
      lease: leaseFor(S.stations[0]),
      legacySecondStation: 'secondStation' in S
    })`);
    assert('save schema is v4 under the same key', s0.v === 4 && s0.key === 'callsigns.save', JSON.stringify(s0));
    assert('new game: starting cash 800', s0.cash === 800, s0.cash);
    // The v3 shape, field by field — this is the assertion CONTRACT.md asks
    // for, and it is the one that fails loudly if anyone reintroduces a flat
    // S.tx / S.schedule / per-station roster.
    assert('state shape: stations array, one flagship, per-station gear',
      s0.stationsIsArray && s0.stations === 1 && s0.tx === 0 && s0.ant === 0 && s0.segment.length > 0,
      JSON.stringify(s0));
    assert('state shape: flat daypart schedule per station',
      s0.slots === 'morning,midday,evening,night', s0.slots);
    assert('state shape: slot carries djs[] + engs[], not a single dj', s0.slotShape === true);
    assert('state shape: staff is GLOBAL, never per-station',
      s0.staffIsArray && s0.perStationStaff === false, JSON.stringify(s0));
    assert('the v2 secondStation decoration is gone', s0.legacySecondStation === false);
    assert('flagship lease is the $60 base at tier 0 gear', s0.lease === 60, s0.lease);

    /* ---- 3. simulate days through the real tick() ---- */
    // tick() directly, not by waiting 5s/day of wall clock. Event/unlock modals
    // may queue behind these ticks; they pause the *interval*, but tick() called
    // by hand still simulates — which is exactly what we want asserted here.
    const after = await evaluate(`(function(){
      let worstDrift = 0, leaseDays = 0;
      for (let i = 0; i < ${TICKS}; i++) {
        tick();
        // The ledger has to reconcile EVERY day, not at the end (CLAUDE.md
        // rule 2). Checked inside the loop so a day that balances by accident
        // against a later one cannot hide.
        worstDrift = Math.max(worstDrift, Math.abs(ledgerDrift()));
        if (S.lastDay.leases > 0) leaseDays++;
      }
      const d = S.lastDay;
      return { day: S.day, cash: S.cash, rep: S.rep, buzz: S.buzz, listeners: S.listeners,
               worstDrift, leaseDays, leases: d.leases, costs: d.costs, payroll: d.payroll,
               stationLease: S.stations[0].lease, candidates: S.candidates.length,
               finite: [S.cash, S.rep, S.buzz, S.listeners, d.revenue, d.costs, d.net,
                        d.quality, d.royalties, d.leases, d.payroll, d.repTarget].every(Number.isFinite),
               ranges: S.rep >= 0 && S.rep <= 100 && S.buzz >= 0.55 && S.buzz <= 1.85 && S.listeners >= 0 };
    })()`);
    assert(TICKS + ' days simulated: day counter exact', after.day === 1 + TICKS, after.day);
    assert('all money/stat fields finite after simulation', after.finite, JSON.stringify(after));
    assert('rep / buzz / listeners stay in range', after.ranges, JSON.stringify(after));
    // The failure state: a lease is charged every single day, performing or
    // not, and it is inside the day's costs rather than a line drawn beside
    // them. Charging capital and rent outside the expense total is exactly how
    // a P&L reports profit on a day that emptied the bank.
    assert('lease charged on every simulated day', after.leaseDays === TICKS, after.leaseDays);
    assert('lease is in the day costs, not beside them',
      after.leases === 60 && after.costs >= after.leases && after.stationLease === 60, JSON.stringify(after));
    assert('an unstaffed station has zero payroll and still pays rent',
      after.payroll === 0 && after.leases > 0, JSON.stringify(after));
    assert('ledger reconciles to cash on every single day', after.worstDrift < 1e-6, after.worstDrift);

    /* ---- 4. save persists ---- */
    const saved = await evaluate(`(function(){
      const ok = saveGame(true);
      const raw = localStorage.getItem(SAVE_KEY);
      const d = raw && JSON.parse(raw);
      return { ok, hasRaw: !!raw, day: d && d.day, v: d && d.v,
               // The callsign lives inside stations[0] in v3. Anything that
               // reaches for a top-level d.call gets undefined, which is a
               // "Continue · undefined" waiting to happen — saveHeadline() is
               // the one supported way to read it out of an unloaded save.
               topLevelCall: d && d.call, call: d && d.stations && d.stations[0].call,
               headline: saveHeadline(), stations: d && d.stations.length,
               live: S.day };
    })()`);
    assert('saveGame() writes the save', saved.ok === true && saved.hasRaw, JSON.stringify(saved));
    assert('saved day/version match live state',
      saved.day === saved.live && saved.v === 4, JSON.stringify(saved));
    assert('v3 payload carries the callsign inside stations[0]',
      typeof saved.call === 'string' && saved.call.length === 4 && saved.topLevelCall === undefined, JSON.stringify(saved));
    assert('saveHeadline() reads an unloaded save', saved.headline && saved.headline.call === saved.call, JSON.stringify(saved));

    /* ---- 5. save survives a full reload ---- */
    await send('Page.navigate', { url }, sessionId);
    await until(`document.querySelector('#screen-menu') && document.querySelector('#screen-menu').classList.contains('active') && typeof S !== 'undefined' && S === null`);
    assert('reload: Continue enabled', await evaluate(`!document.querySelector('#btn-continue').disabled`) === true);
    await click('#btn-continue');
    await until(`typeof S === 'object' && S !== null`);
    const s1 = await evaluate(`({ day: S.day, call: S.stations[0].call, v: S.v, stations: S.stations.length })`);
    // >= not ===: a reload more than a minute after the save would legitimately
    // trigger catchUp() and advance the day. Same-run reloads are < 60s so it
    // is === in practice, but the assertion shouldn't depend on test speed.
    assert('reloaded save resumes same station',
      s1.call === saved.call && s1.day >= saved.day && s1.v === 4 && s1.stations === 1, JSON.stringify(s1));

    /* ---- 6. the empire invariants, through the real mutators ----
       Last, and deliberately so: this block funds itself with test money and
       founds three stations it never intends to keep. Running it before the
       save assertions would have persisted that fixture into the save under
       test. Nothing after it reads the run except the console-error check. */
    const empire = await evaluate(`(function(){
      S.cash = 5e6; S.unlockedExpansion = true;
      // A segment other than the flagship's, named through the sim's own
      // accessor — content.js owns the table and the ids may be retuned.
      const founded = foundStation(segmentIds()[1] || segmentIds()[0]);
      const eng = makePerson('eng', 60); eng.role = 'eng';
      const dj  = makePerson('dj', 60);  dj.role  = 'dj';
      S.staff.push(eng, dj);
      setSlotEngineer(0, 'morning', eng.id);
      const steal = setSlotEngineer(1, 'morning', eng.id);
      addDj(0, 'morning', dj.id);
      const djSteal = addDj(1, 'morning', dj.id);
      let sum = 0; for (let i = 0; i < 40; i++) { refreshCandidates(); sum += S.candidates.length; }
      return {
        founded: !!founded.ok, stations: S.stations.length, cost: founded.cost,
        engCount: S.stations.filter(s => (s.schedule.morning.engs||[]).indexOf(eng.id) >= 0).length,
        djCount:  S.stations.filter(s => s.schedule.morning.djs.indexOf(dj.id) >= 0).length,
        engSteal: !!(steal && steal.stole), djStolen: !!(djSteal && djSteal.stole),
        capMsg: (function(){
          S.cash = 1e9;
          for (let i = 0; i < 4; i++) foundStation(segmentIds()[0]);
          return foundStation(segmentIds()[0]).reason;
        })(),
        cap: S.stations.length,
        avgCandidates: sum / 40
      };
    })()`);
    assert('foundStation() signs on a second callsign for real money',
      empire.founded && empire.stations === 2 && empire.cost > 0, JSON.stringify(empire));
    assert('one engineer covers exactly one daypart empire-wide',
      empire.engCount === 1 && empire.engSteal === true, JSON.stringify(empire));
    assert('a DJ appears in one crew per daypart empire-wide',
      empire.djCount === 1 && empire.djStolen === true, JSON.stringify(empire));
    assert('station cap is 4 and founding past it is refused with a reason',
      empire.cap === 4 && empire.capMsg === 'cap', JSON.stringify(empire));
    // The scarce resource: qualified person-hours. Candidate throughput must
    // NOT grow with the empire, or expansion pays for its own staffing.
    assert('candidate throughput is flat at 4 stations (2-3/week)',
      empire.avgCandidates >= 2 && empire.avgCandidates <= 3, empire.avgCandidates);
    // Four stations on screen is also a render the v2 UI never had to do.
    await evaluate(`(function(){ render(); for (let i = 0; i < 3; i++) tick(); return true; })()`);
    assert('four stations simulate and render without a fault',
      await evaluate(`S.stations.length === 4 && Number.isFinite(S.cash) && Math.abs(ledgerDrift()) < 1e-6`) === true);

    /* ---- 6b. the two cross-file seams the integrator had to wire ----
       Both of these fail SILENTLY when unwired — no crash, no visible {brace},
       just permanently generic text. That is precisely why they are asserted
       rather than eyeballed. */

    // eventVars(S) merged into rollEvent()'s bag. Unwired, every event still
    // renders — through EVENT_FALLBACKS — as bland filler forever.
    const evars = await evaluate(`(function(){
      if (typeof eventVars !== 'function') return { missing: true };
      const v = eventVars(S);
      // Roll events until one fires, then check it resolved no raw braces.
      let msg = null;
      for (let i = 0; i < 400 && !msg; i++) { const e = rollEvent(); if (e) msg = e.msg; }
      return {
        keys: Object.keys(v),
        hasRival: typeof v.rival === 'string' && v.rival.length > 0,
        hasCall:  typeof v.call === 'string'  && v.call.length > 0,
        hasSeg:   typeof v.seg === 'string'   && v.seg.length > 0,
        sampled: msg,
        rawBrace: msg ? /\\{[a-z]+\\}/i.test(msg) : false
      };
    })()`);
    assert('eventVars() supplies the copy variables content.js writes against',
      !evars.missing && evars.hasRival && evars.hasCall && evars.hasSeg, JSON.stringify(evars));
    assert('a rolled event resolves every variable (no raw {brace} on screen)',
      evars.sampled === null || evars.rawBrace === false, JSON.stringify(evars));

    // The six post-mortems content.js authors must actually be reachable.
    /* Drive each branch to its own verdict. Asserting "the answer changed"
       was the first version of this and it was a bad test: stripping the
       crews makes an over-expanded empire MORE over-expanded, so the same
       (correct) verdict kept winning and the test called it a bug. What is
       actually worth pinning is that all six are REACHABLE — an unreachable
       post-mortem is authored copy nobody will ever read, which is the exact
       failure this whole block exists to catch. */
    const post = await evaluate(`(function(){
      if (typeof bankruptCause !== 'function') return { missing: true };
      const one = S.stations[0];
      const parts = Object.keys(one.schedule);
      const setAll = (show, eng, djs) => parts.forEach(p => {
        one.schedule[p].show = show;
        one.schedule[p].engs = eng ? [eng] : [];
        one.schedule[p].djs = djs.slice();
      });
      const solo = () => { S.stations = [one]; };
      const got = {};

      // over-expanded: two signals, the second airing nothing at all.
      const ghost = JSON.parse(JSON.stringify(one));
      Object.keys(ghost.schedule).forEach(p => { ghost.schedule[p].djs = []; ghost.schedule[p].engs = []; });
      S.stations = [one, ghost];
      setAll('music', 'e1', ['d1']);
      got.over = bankruptCause().key;

      solo();
      setAll('ads', 'e1', ['d1']);           got.ads   = bankruptCause().key;
      setAll('music', null, ['d1']);         got.noEng = bankruptCause().key;
      one.tx = 3; S.rep = 20;
      setAll('music', 'e1', ['d1']);         got.gear  = bankruptCause().key;
      one.tx = 0; S.rep = 80;
      S.staff = [{ id:'d1', role:'dj' }];    got.thin  = bankruptCause().key;
      S.staff = [{ id:'d1', role:'dj' }, { id:'d2', role:'dj' },
                 { id:'d3', role:'dj' }, { id:'d4', role:'dj' }];
      got.quiet = bankruptCause().key;

      const all = ['causeOverExpanded','causeTalentThin','causeGearHeavy',
                   'causeAdsOnly','causeNoEngineer','causeQuiet'];
      const bad = all.filter(k => {
        const s = t(k, { n: 2, slots: 8 });
        return !s || s === k || /\\{[a-z]+\\}/i.test(s);
      });
      return { got: got, unrenderable: bad,
               reached: Object.keys(got).map(k => got[k]).filter((v,i,a) => a.indexOf(v) === i).length };
    })()`);
    assert('every authored post-mortem renders with its variables filled',
      !post.missing && post.unrenderable && post.unrenderable.length === 0, JSON.stringify(post));
    assert('all six post-mortems are reachable from real state',
      post.got && post.got.over === 'causeOverExpanded' && post.got.ads === 'causeAdsOnly'
      && post.got.noEng === 'causeNoEngineer' && post.got.gear === 'causeGearHeavy'
      && post.got.thin === 'causeTalentThin' && post.got.quiet === 'causeQuiet',
      JSON.stringify(post));

    /* ---- 7. nothing errored anywhere along the way ---- */
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
