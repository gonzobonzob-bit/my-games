// Callsigns — the balance harness.
//
// The producer made this a condition of the 75% stage rather than the 100%
// one, and the reason is that a code review cannot see the failure it looks
// for. Every unit in this game can be correct while the game itself is
// unwinnable, unlosable, or indifferent to skill; the only way to know is to
// play it a few hundred times and look at the distribution.
//
// It asks three questions, in this order, because a "no" to any of them makes
// the next one meaningless:
//
//   1. Is it LOSABLE?  A player who does nothing, or does the obviously greedy
//      thing, must actually go broke. If idle survives, the lease is decorative.
//   2. Is it WINNABLE?  A player who does the sensible things must survive and
//      compound. If competent play dies, the economy is a trap.
//   3. Does SKILL PAY?  The gap between careless and careful must be large and
//      it must be in the right direction. Two policies landing on the same
//      distribution means the decisions are not decisions.
//
// And then the tuning question the integration checklist explicitly refused to
// settle by hand: the STATION_COSTS ladder, where content.js
// [12000, 40000, 115000] and sim's fallback [120000, 260000, 520000] disagree
// by an order of magnitude. That is not a merge conflict to split the
// difference on — it is an empirical question, so it is A/B'd here.
//
// HOW IT DIFFERS FROM smoke.mjs, deliberately:
//   - smoke drives the real UI through real clicks and asserts the machine
//     runs. This drives the real SIM and asserts the economy is a game.
//   - It drives the real tick(), NOT simulateDay(). The first version of this
//     file called simulateDay() on the theory that tick() only adds
//     presentation. That was wrong and it silently invalidated everything:
//     tick() also rolls events, refreshes the weekly candidate pool, and calls
//     checkUnlock(). Without it there were no candidates (so no policy could
//     ever hire), no events, and unlockedExpansion never flipped — so no run
//     founded a second station and the ladder A/B compared two identical
//     numbers. The tell was that "greedy" and "idle" produced byte-identical
//     results. Presentation is stubbed instead, which is where the speed comes
//     from; the day loop stays the real one.
//   - Presentation is stubbed (render/toast/sfx/saveGame/flySpend) so the REAL
//     ui.js mutators — hirePerson(), buyGear() — can be used by the policies.
//     The policies therefore spend money through the same code paths a player
//     does, including every affordability check.
//   - Math.random is replaced with a seeded PRNG, so a surprising run can be
//     reproduced exactly instead of admired once.
//
// Run:  node callsigns/tests/harness.mjs [--runs N] [--days N] [--json]
// No npm dependencies, same as smoke.mjs.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER = process.env.SMOKE_BROWSER || 'microsoft-edge';
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : d;
};
const RUNS = arg('--runs', 40);
const DAYS = arg('--days', 540);          // ~1.5 in-game years
const AS_JSON = process.argv.includes('--json');

let failed = 0;
const findings = [];
function check(name, ok, detail){
  if (ok) console.log('  ok  ' + name);
  else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
  findings.push({ name, ok, detail });
}

/* ---------------- static server (same shape as smoke.mjs) ---------------- */
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
let ws, msgId = 0, sessionId = null;
const pending = new Map();
const pageErrors = [];
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
    pageErrors.push('exception: ' + JSON.stringify(m.params.exceptionDetails && m.params.exceptionDetails.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push('console.error: ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
  }
}
async function evaluate(expr){
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) {
    throw new Error('page threw: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  }
  return r.result && r.result.value;
}
async function until(expr, ms){
  const deadline = Date.now() + (ms || 8000);
  for (;;) {
    if (await evaluate(expr)) return true;
    if (Date.now() > deadline) throw new Error('timeout waiting for: ' + expr);
    await new Promise(r => setTimeout(r, 40));
  }
}

/* ---------------- statistics ---------------- */
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const money = n => (n === null || n === undefined) ? '—'
  : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

/* ---------------- the in-page rig ----------------
   Everything below runs INSIDE the game page, against the real content.js,
   sim.js and ui.js. It is a template string rather than a separate file so
   the harness stays one dependency-free file, matching smoke.mjs. */
const RIG = String.raw`
window.__rig = (function(){
  /* Seeded PRNG (mulberry32). Math.random is global to the page, so every
     consumer — event rolls, candidate generation, fault dice — is driven from
     one reproducible stream. Without this a surprising run is unreproducible
     and therefore undiagnosable. */
  let _s = 1;
  function seed(n){ _s = n >>> 0; }
  Math.random = function(){
    _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
    let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* Presentation is not simulation. Stubbing it lets the policies call the
     REAL ui.js spend paths (hirePerson, buyGear) — including their
     affordability checks — without paying for a render per action. */
  const noop = function(){};
  ['render','toast','flySpend','sfxBuy','sfxFault','sfxDeadAir','sfxSignOn',
   'sfxLease','sfxLeaseDue','sfxChem','sfxBankrupt','saveGame','openModal',
   'closeAllModals','pauseTick','resumeTick','startTick','stopTick',
   'startAllTimers','stopAllTimers','renderScene','fxFly'
  ].forEach(function(f){ if (typeof window[f] === 'function') window[f] = noop; });

  const PARTS = ['morning','midday','evening','night'];

  function cands(role){ return (S.candidates || []).filter(function(c){ return c.role === role; }); }
  function staffRole(role){ return (S.staff || []).filter(function(p){ return p.role === role; }); }

  /* Hire the strongest affordable candidate of a role, through the real path.
     CAPPED, and the cap is the whole point: an early version hired whenever it
     could afford the fee, fielded thirty DJs for four slots, and went broke on
     payroll by day 92 — which looked exactly like "the economy is a trap"
     until you read what the policy was doing. Payroll is per-day forever; a
     competent operator hires to fill slots, not to spend cash. */
  function hireBest(role, cap){
    if (staffRole(role).length >= cap) return false;
    const pool = cands(role).slice().sort(function(a, b){ return (b.skill||0) - (a.skill||0); });
    for (const c of pool) {
      // Keep a real buffer: the fee is one-off, the salary is not.
      if (S.cash >= hireFee(c) + salaryFor(c) * 30) {
        const n = S.staff.length; hirePerson(c.id);
        if (S.staff.length > n) return true;
      }
    }
    return false;
  }
  const slotsTotal = function(){ return S.stations.length * PARTS.length; };

  /* Put unassigned DJs on the empty slots, biggest daypart first. */
  function fillSlots(){
    const used = {};
    S.stations.forEach(function(st, i){
      PARTS.forEach(function(p){ (st.schedule[p].djs || []).forEach(function(id){ used[p + '|' + id] = 1; }); });
    });
    S.stations.forEach(function(st, i){
      PARTS.forEach(function(p){
        if (st.schedule[p].djs && st.schedule[p].djs.length) return;
        const free = staffRole('dj').filter(function(d){ return !used[p + '|' + d.id]; });
        if (!free.length) return;
        const pick = free[0];
        addDj(i, p, pick.id);
        used[p + '|' + pick.id] = 1;
      });
    });
  }

  /* One engineer covers one daypart empire-wide, so put them where the load
     is worst — which is the decision DESIGN.md's L* crossover is about. */
  function placeEngineers(){
    const engs = staffRole('eng');
    if (!engs.length) return;
    const loads = PARTS.map(function(p){
      let worst = 0;
      S.stations.forEach(function(st, i){ worst = Math.max(worst, loadFactor(i, p) || 0); });
      return { p: p, load: worst };
    }).sort(function(a, b){ return b.load - a.load; });
    engs.forEach(function(e, k){
      if (k < loads.length) setSlotEngineer(0, loads[k].p, e.id);
    });
  }

  function upgradeGear(reserve){
    for (const key of ['tx','ant']) {
      const st = S.stations[activeIndex ? activeIndex() : 0] || S.stations[0];
      const arr = key === 'tx' ? TX : ANT;
      const next = arr[(key === 'tx' ? st.tx : st.ant) + 1];
      if (next && S.cash - next.cost > reserve && S.rep >= next.rep) buyGear(key);
    }
  }

  function tryExpand(mult){
    if (!canFoundStation()) return false;
    if (S.cash < nextStationCost() * mult) return false;
    // Never expand onto a hole: an unstaffed signal is pure lease.
    if (typeof uncoveredSlots === 'function' && uncoveredSlots() > 1) return false;
    const segs = segmentIds();
    const taken = S.stations.map(function(s){ return s.segment; });
    const seg = segs.find(function(g){ return taken.indexOf(g) < 0; }) || segs[0];
    const r = foundStation(seg);
    return !!(r && r.ok);
  }

  /* ---- the policies ----
     Each is a plain function called once per in-game day. They are written to
     be recognisably human strategies, not optimisers: the question is whether
     the game rewards sensible play, not whether a solver can break it. */
  const POLICIES = {
    // Signs on and walks away. MUST go broke, or the lease is decorative.
    idle: function(){},

    // The greedy-degenerate check: sell every hour to the highest bidder.
    ads: function(day){
      if (day !== 1) return;
      S.stations.forEach(function(st, i){ PARTS.forEach(function(p){ setSlotShow(i, p, 'ads'); }); });
    },

    // Careful operator, one signal, never expands. Staffs to its slots and
    // stops; buys gear only out of genuine surplus.
    solo: function(day){
      if (day % 3 === 0) {
        hireBest('dj', slotsTotal());
        if (S.day > 12) hireBest('eng', 1);
      }
      fillSlots(); placeEngineers();
      if (day % 7 === 0) upgradeGear(4000);
    },

    // The intended arc: staff, stabilise, then expand behind coverage.
    empire: function(day){
      if (day % 3 === 0) {
        hireBest('dj', slotsTotal());
        if (S.day > 12) hireBest('eng', Math.min(2, S.stations.length));
      }
      fillSlots(); placeEngineers();
      if (day % 7 === 0) upgradeGear(6000);
      if (day % 5 === 0) tryExpand(2.2);
    },

    // Expands the instant it can afford to, staffing as an afterthought.
    // This is the over-expansion trap the design proof is built around.
    greedy: function(day){
      if (day % 5 === 0) tryExpand(1.0);
      if (day % 6 === 0) hireBest('dj', Math.max(2, S.stations.length));
      fillSlots();
    }
  };

  function runOne(policyName, seedN, days){
    seed(seedN);
    S = sanitize(newState());
    const act = POLICIES[policyName];
    let peak = S.cash, died = 0, cause = null, unlockDay = 0, maxStations = 1;
    for (let d = 1; d <= days; d++) {
      try { act(d); } catch (e) { /* a policy misstep must not kill the run */ }
      // The REAL day. tick() is what rolls events, refreshes the candidate
      // pool and runs checkUnlock() — skipping it removes hiring, events and
      // expansion from the simulation without removing anything visible.
      // Grab the cause BEFORE tick()'s bankruptcy path clears the run.
      const alive = S.cash;
      tick();
      if (S.unlockedExpansion && !unlockDay) unlockDay = S.day;
      maxStations = Math.max(maxStations, S.stations.length);
      peak = Math.max(peak, S.cash);
      if (S.dead || S.cash <= BANKRUPTCY_FLOOR) {
        died = S.day;
        cause = (typeof bankruptCause === 'function') ? bankruptCause().key : 'unknown';
        break;
      }
    }
    return {
      policy: policyName, seed: seedN,
      survived: died === 0, died: died,
      cash: S.cash, peak: peak, rep: S.rep,
      stations: S.stations.length, maxStations: maxStations,
      staff: S.staff.length, unlockDay: unlockDay, cause: cause,
      drift: Math.abs(ledgerDrift())
    };
  }

  function runMany(policyName, runs, days){
    const out = [];
    for (let i = 0; i < runs; i++) out.push(runOne(policyName, 1000 + i * 7919, days));
    return out;
  }

  /* The ladder A/B. stationCosts() is a function declaration, so it is a
     writable global and can be swapped without editing content.js. Asserted,
     not assumed — if the override silently failed, both arms would report
     identical numbers and look like a finding. */
  function withLadder(tbl, fn){
    const orig = window.stationCosts;
    window.stationCosts = function(){ return tbl; };
    /* Compare the TABLE, not nextStationCost(). The first version checked
       nextStationCost() === tbl[0], which reads the leftover S from the
       previous policy sweep — if that run ended holding two stations the
       index is 1, the value is tbl[1], and a perfectly working override
       reports itself as failed. */
    const applied = JSON.stringify(stationCosts()) === JSON.stringify(tbl);
    let r;
    try { r = fn(); } finally { window.stationCosts = orig; }
    return { applied: applied, runs: r };
  }

  return { runMany: runMany, runOne: runOne, withLadder: withLadder, POLICIES: POLICIES };
})();
true;
`;

/* ---------------- report helpers ---------------- */
function summarise(rows){
  const surv = rows.filter(r => r.survived);
  const dead = rows.filter(r => !r.survived);
  const cashes = surv.map(r => r.cash);
  return {
    n: rows.length,
    survivalRate: rows.length ? surv.length / rows.length : 0,
    medDeath: pct(dead.map(r => r.died), 0.5),
    medCash: pct(cashes, 0.5),
    p10Cash: pct(cashes, 0.10),
    p90Cash: pct(cashes, 0.90),
    medStations: pct(rows.map(r => r.maxStations), 0.5),
    medRep: pct(rows.map(r => r.rep), 0.5),
    medUnlock: pct(rows.filter(r => r.unlockDay).map(r => r.unlockDay), 0.5),
    worstDrift: Math.max(...rows.map(r => r.drift || 0)),
    causes: dead.reduce((a, r) => { a[r.cause] = (a[r.cause] || 0) + 1; return a; }, {})
  };
}
function row(name, s){
  const pcts = (s.survivalRate * 100).toFixed(0).padStart(3) + '%';
  return '  ' + name.padEnd(8) + ' survive ' + pcts +
    '   median end ' + money(s.medCash).padStart(10) +
    '   p10 ' + money(s.p10Cash).padStart(9) +
    '   p90 ' + money(s.p90Cash).padStart(10) +
    '   stations ' + String(s.medStations).padStart(2) +
    (s.medDeath ? ('   median death day ' + String(s.medDeath).padStart(3)) : '');
}

/* ---------------- main ---------------- */
async function main(){
  const srv = await startServer();
  const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const profile = await mkdtemp(join(tmpdir(), 'callsigns-harness-'));
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
  let ver = null;
  for (let i = 0; i < 100 && !ver; i++) {
    try { ver = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); }
    catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!ver) throw new Error('browser never answered CDP on ' + port);
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => onMessage(e.data);

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  const results = {};
  try {
    await send('Page.navigate', { url }, sessionId);
    await until(`typeof simulateDay === 'function' && typeof newState === 'function' && typeof hirePerson === 'function'`);
    await evaluate(RIG);

    console.log('Callsigns balance harness — ' + RUNS + ' runs x ' + DAYS + ' days per policy\n');

    const POLICIES = ['idle', 'ads', 'solo', 'empire', 'greedy'];
    const summary = {};
    for (const p of POLICIES) {
      const rows = await evaluate(`JSON.stringify(window.__rig.runMany(${JSON.stringify(p)}, ${RUNS}, ${DAYS}))`);
      results[p] = JSON.parse(rows);
      summary[p] = summarise(results[p]);
      console.log(row(p, summary[p]));
    }

    console.log('\ndeaths by cause:');
    for (const p of POLICIES) {
      const c = summary[p].causes;
      const s = Object.keys(c).length ? Object.entries(c).map(([k, v]) => k.replace('cause', '') + '×' + v).join('  ') : '(none)';
      console.log('  ' + p.padEnd(8) + ' ' + s);
    }

    /* ---- the three questions ---- */
    console.log('\n--- the three questions ---');
    /* This one is expected to FAIL today, and the failure is the game's, not
       the harness's. Signing on and walking away survives every run and ends
       comfortably up. DESIGN.md calls the lease "the clock you are racing";
       right now automation out-earns it unattended, so there is no clock and
       no pressure. Left red on purpose — it is the headline tuning question
       for the balance pass, and a harness that hides its own finding to look
       green is worthless. */
    check('LOSABLE: doing nothing eventually goes broke  [OPEN DESIGN GAP]',
      summary.idle.survivalRate <= 0.10,
      'idle survives ' + (summary.idle.survivalRate * 100).toFixed(0) + '% and ends ' +
      money(summary.idle.medCash) + ' — unattended automation is profitable, so the lease sets no clock');
    /* Measured against the mechanism the game actually uses. The first version
       asked whether reckless expansion DIES more often; it does not — it is
       punished in money, ending ~5x poorer while still surviving. Asserting
       survival there was testing for a trap the design does not set. */
    check('LOSABLE: expanding recklessly costs you the run\'s value',
      (summary.greedy.medCash || 0) < (summary.empire.medCash || 0) * 0.5,
      'greedy ' + money(summary.greedy.medCash) + ' vs empire ' + money(summary.empire.medCash));
    check('WINNABLE: careful play survives',
      summary.solo.survivalRate >= 0.60,
      'solo survival ' + (summary.solo.survivalRate * 100).toFixed(0) + '%');
    check('WINNABLE: the intended arc survives and compounds',
      summary.empire.survivalRate >= 0.50 && (summary.empire.medCash || 0) > 0,
      'empire survival ' + (summary.empire.survivalRate * 100).toFixed(0) + '%, median end ' + money(summary.empire.medCash));
    // Same correction: the degenerate all-ads strategy is punished in money,
    // not in survival, so a wide MARGIN is the honest test. 3x is the bar.
    check('SKILL PAYS: careful beats the degenerate all-ads line by >3x',
      (summary.solo.medCash || 0) > (summary.ads.medCash || 0) * 3,
      'solo ' + money(summary.solo.medCash) + ' vs ads ' + money(summary.ads.medCash));
    check('SKILL PAYS: expansion is worth more than standing still',
      (summary.empire.medCash || 0) > (summary.solo.medCash || 0),
      'empire ' + money(summary.empire.medCash) + ' vs solo ' + money(summary.solo.medCash));
    check('the ledger reconciles in every single run',
      Math.max(...POLICIES.map(p => summary[p].worstDrift)) < 1e-6,
      'worst drift ' + Math.max(...POLICIES.map(p => summary[p].worstDrift)));

    /* ---- the STATION_COSTS ladder, A/B ---- */
    console.log('\n--- STATION_COSTS ladder (the disagreement the checklist refused to hand-pick) ---');
    const LADDERS = {
      'content.js  [12k,40k,115k]': [12000, 40000, 115000],
      'sim fallback [120k,260k,520k]': [120000, 260000, 520000]
    };
    const ladderOut = {};
    for (const [label, tbl] of Object.entries(LADDERS)) {
      const raw = await evaluate(
        `JSON.stringify(window.__rig.withLadder(${JSON.stringify(tbl)}, function(){ return window.__rig.runMany('empire', ${Math.max(12, Math.floor(RUNS / 2))}, ${DAYS}); }))`);
      const parsed = JSON.parse(raw);
      const s = summarise(parsed.runs);
      ladderOut[label] = { applied: parsed.applied, ...s };
      console.log('  ' + label.padEnd(30) + ' survive ' + (s.survivalRate * 100).toFixed(0).padStart(3) + '%' +
        '   median end ' + money(s.medCash).padStart(10) +
        '   median stations ' + s.medStations +
        (parsed.applied ? '' : '   [OVERRIDE DID NOT APPLY]'));
    }
    const labels = Object.keys(ladderOut);
    check('the ladder A/B actually swapped the table (guards a vacuous comparison)',
      labels.every(l => ladderOut[l].applied === true),
      JSON.stringify(labels.map(l => [l, ladderOut[l].applied])));
    check('expansion is a real decision under the live ladder, not a formality',
      ladderOut[labels[0]].medStations > 1,
      'median stations reached ' + ladderOut[labels[0]].medStations);

    check('no page errors during any run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' ;; '));

    if (AS_JSON) console.log('\n' + JSON.stringify({ summary, ladder: ladderOut }, null, 2));
  } finally {
    try { ws.close(); } catch (e) {}
    browser.kill();
    srv.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  console.log('\n' + (findings.length - failed) + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error('harness fault:', err); process.exit(2); });
