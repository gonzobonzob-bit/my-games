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
// ---------------------------------------------------------------------------
// EDITING THIS FILE: the RIG below is a String.raw template literal.
// A BACKTICK ANYWHERE INSIDE IT — including inside a comment — silently ends the
// string and turns the rest of the file into garbage. This has been done four
// separate times. Symptoms vary and none of them name the cause: "Unexpected
// identifier", "1 is not a function", or a clean parse that runs the wrong code.
// Write `code` as plain words inside the RIG, never in backticks, and check with:
//
//   node -e 'const s=require("fs").readFileSync("tests/harness.mjs","utf8");
//     const i=s.indexOf("const RIG = String.raw"); const r=s.slice(i+22);
//     const rig=r.slice(1, r.indexOf("`;"));
//     console.log("stray backticks:", (rig.match(/`/g)||[]).length)'
//
// Same file, second trap: every policy must PROVE it acted. A policy that
// silently no-ops is indistinguishable from one that chose to do nothing, which
// is how salaryFor(c) hid an unstaffed economy behind eleven green assertions.
// ---------------------------------------------------------------------------
// Run:  node callsigns/tests/harness.mjs [--runs N] [--days N] [--json]
// No npm dependencies, same as smoke.mjs.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* CALLSIGNS_GAME_DIR points the harness at a COPY of the game instead of the
   repo. That exists for one reason: rule 5 requires the four instrument breaks
   of DESIGN_PROOF_VOICETRACK.md §8 to be run and SEEN to fail, and a break run
   inside the repo is a break one interrupted session ships. Breaks are applied
   to a scratch copy and the harness is aimed at it; the repo is never edited. */
const GAME_DIR = process.env.CALLSIGNS_GAME_DIR
  ? resolve(process.env.CALLSIGNS_GAME_DIR)
  : join(dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER = process.env.SMOKE_BROWSER || 'microsoft-edge';
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : d;
};
const strArg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const RUNS = arg('--runs', 40);
const DAYS = arg('--days', 540);          // ~1.5 in-game years
const AS_JSON = process.argv.includes('--json');
/* Which gates to run. Everything, by default — a partial run is a debugging
   convenience and must never be what a report is written from. */
const GATES = strArg('--gate', 'core,r3,ladder,vt,vtrec').split(',').map(x => x.trim());
const gateOn = g => GATES.indexOf(g) >= 0;
const VT_RUNS = arg('--vt-runs', 60);     // gate VT-1 asks for N >= 60
/* VT-1 (c) is a cross-BUILD identity: a run that never tracks must reproduce
   the pre-voice-tracking build to the cent on the same seed. That cannot be
   measured inside one process, so the v8 build writes its rows out and the v9
   build reads them back and diffs them. */
const ZERO_OUT = strArg('--zero-out', null);
const ZERO_IN  = strArg('--zero-in', null);

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
/* EVERY CDP ROUND TRIP HAS A DEADLINE NOW.

   This file's other waits are all bounded — until() deadlines and throws with
   the expression it wanted, the port loop caps, the version loop caps. The one
   unbounded wait was the CDP round trip itself, so when a call did not come
   back the suite did not fail, it went silent: no stack, no partial output,
   nothing to read. A stall and a failure need different debugging, and an
   unbounded promise makes a stall look like a dead machine.

   Two tiers, because they are genuinely different waits. Control-plane calls
   (navigate, attach, enable) answer in milliseconds or never, so 30s is already
   generous. Runtime.evaluate is where the game actually runs — a policy sweep
   is minutes of real work and must not be killed for being slow. Hence
   EVAL_MS, passed explicitly, rather than one number that has to be wrong for
   one of the two. */
const CDP_MS  = 30000;
const EVAL_MS = 1800000;
function send(method, params, sid, ms){
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      // The METHOD NAME is the whole value of this message: it is what turns
      // "the suite hangs" into "Page.navigate never came back".
      reject(new Error('CDP timeout after ' + (ms || CDP_MS) + 'ms: ' + method));
    }, ms || CDP_MS);
    pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); },
                      reject:  e => { clearTimeout(timer); reject(e); } });
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, EVAL_MS);
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

  /* ---- PROOF OF ACTION (CLAUDE.md rule 5) ----
     A policy that silently no-ops is indistinguishable from a policy that chose
     to do nothing. That is not a hypothetical here: hireBest() once threw on
     its first candidate every single time and every published number described
     an unstaffed game. So every mutation a policy performs is COUNTED, per
     policy, and the runner asserts the counts a policy is supposed to produce
     are non-zero before it reads a single dollar figure. */
  const ACT = {};
  let CURPOL = '';
  function bump(k, n){
    const a = ACT[CURPOL] || (ACT[CURPOL] = {});
    a[k] = (a[k] || 0) + (n === undefined ? 1 : n);
  }

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
      // c.salary is already salaryFor(c.role, c.skill), set in makePerson().
      // This once read salaryFor(c) — a one-arg call to a two-arg function,
      // which threw TypeError inside the affordability test on the FIRST
      // candidate every time and was swallowed whole by the policy try/catch
      // below. No policy ever hired anyone: solo was idle-plus-gear and
      // empire was idle-plus-gear-plus-expansion. Every balance number this
      // project published before 2026-08-14 described an unstaffed game.
      if (S.cash >= hireFee(c) + c.salary * 30) {
        const n = S.staff.length; hirePerson(c.id);
        if (S.staff.length > n) { bump('hire_' + role); return true; }
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
  /* Put engineers on the worst-loaded slots ACROSS THE EMPIRE.

     Two defects lived here. It called loadFactor(i, p) — an index and a part —
     but loadFactor(slot) takes a slot, and the guards inside it meant the bad
     call returned 1 for every daypart instead of throwing, so the sort that is
     supposed to find the worst load was meaningless. And it then assigned every
     engineer to setSlotEngineer(0, ...) — station 0 only — so stations 1..3
     never received an engineer no matter how many were on payroll.

     Now it ranks every (station, daypart) pair by real load and walks down that
     list, which is also what the one-engineer-per-daypart rule assumes: the
     empire competes for the same scarce person-hours. */
  function placeEngineers(){
    const engs = staffRole('eng');
    if (!engs.length) return;
    const slots = [];
    S.stations.forEach(function(st, i){
      PARTS.forEach(function(p){
        const slot = st.schedule && st.schedule[p];
        slots.push({ i: i, p: p, load: (slot ? loadFactor(slot) : 0) || 0 });
      });
    });
    slots.sort(function(a, b){ return b.load - a.load; });
    let k = 0;
    for (const e of engs) {
      while (k < slots.length) {
        const s = slots[k++];
        const r = setSlotEngineer(s.i, s.p, e.id);
        if (r && r.ok !== false) break;
      }
    }
  }

  /* Upgrade the whole empire, weakest signal first.

     This read the ACTIVE station only, and foundStation() sets
     S.active = stationCount()-1 (js/sim.js), while buyGear() targets
     curStation() (js/ui.js). So the moment a policy expanded, its flagship's
     gear ladder froze forever and every later dollar of capex went to the
     newest signal. buyGear() has no station argument, so the only way to aim it
     is to move the active station — which is what the UI does too. */
  function upgradeGear(reserve){
    const back = activeIndex ? activeIndex() : 0;
    // Weakest first: a Class A signal buys more audience per dollar than the
    // fifth step on a station that already saturates its segment.
    const order = S.stations.map(function(st, i){ return { i: i, g: st.tx + st.ant }; })
      .sort(function(a, b){ return a.g - b.g; });
    for (const ent of order) {
      setActiveStation(ent.i);
      const st = S.stations[ent.i];
      if (!st) continue;
      for (const key of ['tx','ant']) {
        const arr = key === 'tx' ? TX : ANT;
        const next = arr[(key === 'tx' ? st.tx : st.ant) + 1];
        if (next && S.cash - next.cost > reserve && S.rep >= next.rep) buyGear(key);
      }
    }
    setActiveStation(back);
  }

  /* Slots anywhere in the empire with no host at all. The expansion guard's
     definition of "a hole" — see tryExpand(). */
  function bareSlots(){
    let n = 0;
    S.stations.forEach(function(st){
      PARTS.forEach(function(p){
        const slot = st.schedule && st.schedule[p];
        if (!slot || !(Array.isArray(slot.djs) && slot.djs.length)) n++;
      });
    });
    return n;
  }

  function tryExpand(mult){
    if (!canFoundStation()) return false;
    if (S.cash < nextStationCost() * mult) return false;
    /* Never expand onto a hole: an unstaffed signal is pure lease.

       This guard was written as uncoveredSlots() > 1, comparing an ARRAY to a
       number — NaN > 1 — so it was always false and never once fired. Fixing
       the comparison to uncoveredSlots().length > 1 is literal-correct and
       semantically wrong: uncoveredSlots() lists slots with no ENGINEER
       (js/sim.js), and one-engineer-per-daypart means a 2+ station empire can
       never engineer-cover every slot. Live, that guard blocks expansion
       permanently — measured: empire and greedy both stuck at 1 station.

       "Unstaffed" here means no HOST. A slot with a DJ and no engineer earns;
       a slot with neither is the hole the rule is about. */
    if (bareSlots() > 1) return false;
    const segs = segmentIds();
    const taken = S.stations.map(function(s){ return s.segment; });
    const seg = segs.find(function(g){ return taken.indexOf(g) < 0; }) || segs[0];
    const r = foundStation(seg);
    if (r && r.ok) bump('expand');
    return !!(r && r.ok);
  }


  /* ---- rooms: the machinery the shopping-list gate needs ----

     The whole feature turns on ONE claim (DESIGN_PROOF_ROOMS.md §2): no fixed
     room priority is optimal, because the Newsroom and the Record Library have
     disjoint supports and the Sales Floor's marginal value flips sign on
     reputation. If that claim is false the feature is a shopping list wearing a
     decision's clothes, and it must not ship. So the gate below runs FIXED
     priorities against one that reads state, and demands a real margin.

     The value function is ui.js's own uiWhatIf()/uiEmpireWorth() — deliberately
     the SAME numbers the player is shown on the Building tab. A policy that
     out-thinks the UI would prove nothing about whether a human can make this
     decision; a policy that uses the UI's own arithmetic proves exactly that. */
  function surplusStaff(){
    const load = staffSlotLoad();
    return S.staff.filter(function(p){ return !(load[p.id] > 0); });
  }
  /** Marginal empire value per day of doing fn, measured not estimated. */
  function marginOf(fn){
    if (typeof uiWhatIf !== 'function' || typeof uiEmpireWorth !== 'function') return 0;
    const base = uiEmpireWorth();
    const after = uiWhatIf(function(){ fn(); return uiEmpireWorth(); });
    if (after === null || !isFinite(after) || !isFinite(base)) return 0;
    return after - base;
  }
  /** Buy a bay only when the best room it could hold outearns its lease. */
  function maybeBuyBay(reserve, choose){
    const can = canBuyBay();
    if (!can || !can.ok) return false;
    if (S.cash < (typeof BAY_BUILD_COST !== 'undefined' ? BAY_BUILD_COST : 2500) + reserve) return false;
    // Price the bay against what THIS strategy would actually put in it, not
    // against the best room in the game — otherwise every policy buys bays on
    // the strength of a room it will never build.
    const pick = choose ? choose() : null;
    if (!pick) return false;
    const value = pairValue(pick.idx, pick.type);
    if (value <= bayLease(bayCount())) return false;
    const r = buyBay();
    return !!(r && r.ok);
  }
  /* Hire people FOR the rooms.

     Without this the whole cohort was measuring nothing. empireCore hires DJs
     and engineers to exactly slotsTotal(), so every person is on a slot,
     staffSlotLoad() puts them all at load 1 and surplusStaff() is EMPTY — the
     policies dutifully built rooms and left them standing empty, paying lease
     for nothing. The tell was six policies sharing a byte-identical p10 and two
     exact ties: they were the same runs.

     A player who builds a room hires somebody to sit in it. That extra body is
     a real cost — salary forever, against a room that must beat salary AND
     lease — which is exactly the trade the feature is supposed to pose. */
  function hireForRooms(){
    const seatsWanted = roomList().reduce(function(a, r){
      return a + Math.max(0, ROOM_SEATS - (r.staff ? r.staff.length : 0));
    }, 0);
    if (seatsWanted <= 0) return;
    const spare = surplusStaff().length;
    if (spare >= seatsWanted) return;
    // Hire toward slots + room seats. Which ROLE is worth hiring is the room's
    // own fit table, so ask the rooms rather than guessing.
    const need = {};
    for (const r of roomList()) {
      const free = ROOM_SEATS - (r.staff ? r.staff.length : 0);
      if (free <= 0) continue;
      let bestRole = 'dj', bestFit = 0;
      for (const role of ['dj', 'eng', 'sales']) {
        const f = roomFit(r.type, role);
        if (f > bestFit) { bestFit = f; bestRole = role; }
      }
      need[bestRole] = (need[bestRole] || 0) + free;
    }
    for (const role of Object.keys(need)) {
      // Cap = what the SLOTS need plus what the ROOMS need. Sales occupy no
      // slot, so their whole cap is room seats.
      const base = (role === 'sales') ? 0 : slotsTotal();
      hireBest(role, base + need[role]);
    }
  }

  /* Build and staff rooms. The choose callback IS the strategy under test;
     it returns an {idx, type} pair, or null.

     This used to take a separate pickType(idx) and pickStation(). That could not
     express a fixed-type strategy at all: pickStation chose a station by GREEDY
     value, then fixedType('maint') returned null because that station already
     had a maint room, so the build silently never happened. Measured after the
     first fix attempt: alwaysMaint reached bays 2 / rooms 1 — it bought a second
     bay and could not fill it. Station and type have to be chosen together. */
  function manageRooms(choose, reserve){
    maybeBuyBay(reserve, choose);
    if (roomList().length < bayCount()) {
      const pick = choose();
      if (pick && pick.type && !roomAt(pick.idx, pick.type)) buildRoom(pick.idx, pick.type);
    }
    hireForRooms();
    // Seat surplus people only. Seating someone who is on air costs attention
    // and fatigue, which is the trap the readouts exist to warn about — a
    // competent operator does not walk into it.
    const sp = surplusStaff();
    if (!sp.length) return;
    const rooms = roomList();
    for (const p of sp) {
      let bestRoom = null, bestVal = 0;
      for (const r of rooms) {
        if (!Array.isArray(r.staff) || r.staff.length >= ROOM_SEATS) continue;
        if (r.staff.indexOf(p.id) >= 0) continue;
        const rid = r.id, pid = p.id;
        const v = marginOf(function(){ seatInRoom(rid, pid); });
        if (v > bestVal) { bestVal = v; bestRoom = r; }
      }
      /* SUNK COST. These people are SURPLUS — already hired, already paid, and
         sitting on no slot. Seating one costs nothing extra, so the bar is a
         positive margin, not their salary. Comparing against salary made the
         policy refuse to seat staff it had already paid for, which is why the
         Production Room measured $2/day in the cohort while the same room
         measured +$377/day of real revenue when seated by hand. The room was
         never broken; the instrument would not use it.

         Whether to HIRE another body is a different question, and hireForRooms()
         still answers that one against the wage. */
      if (bestRoom && bestVal > 0) seatInRoom(bestRoom.id, p.id);
    }
  }
  /** Value of putting one type on one station, seated with a surplus person. */
  function pairValue(idx, type){
    return marginOf(function(){
      S.bays = Math.max(bayCount(), roomList().length + 1);
      const r = buildRoom(idx, type);
      if (r && r.ok) { const sp = surplusStaff(); if (sp.length) seatInRoom(r.room.id, sp[0].id); }
    });
  }
  /** Best station for a GIVEN type — what a fixed-priority player does. */
  function bestStationFor(type){
    let best = null, bestVal = -Infinity;
    for (let i = 0; i < S.stations.length; i++) {
      if (roomAt(i, type)) continue;
      const v = pairValue(i, type);
      if (v > bestVal) { bestVal = v; best = i; }
    }
    return best === null ? null : { idx: best, type: type };
  }
  function fixedChoice(type){ return function(){ return bestStationFor(type); }; }
  function flagshipChoice(type){
    return function(){ return roomAt(0, type) ? null : { idx: 0, type: type }; };
  }
  let rrTick2 = 0;
  function roundRobinChoice(){
    const ids = roomTypeIds();
    for (let k = 0; k < ids.length; k++) {
      const t = ids[(rrTick2 + k) % ids.length];
      const pick = bestStationFor(t);
      if (pick) { rrTick2++; return pick; }
    }
    return null;
  }

  /** The state-reading chooser: the best (station, type) PAIR available today.
      Everything the design claims lives here — if no fixed rule can match this,
      the choice is a decision. */
  function greedyChoice(){
    let best = null, bestVal = 0;
    for (let i = 0; i < S.stations.length; i++) {
      for (const type of roomTypeIds()) {
        if (roomAt(i, type)) continue;
        const v = pairValue(i, type);
        if (v > bestVal) { bestVal = v; best = { idx: i, type: type }; }
      }
    }
    return best;
  }

  /* Put each slot on its best-earning format, evaluated THROUGH whatever rooms
     currently exist.

     Nothing in this file ever called setSlotShow() except the ads policy, so
     every room run — 20 seeds x 10 policies x 4 stations, 540 days — used the
     default music/music/talk/music schedule. The Newsroom pays on talk/news and
     the Record Library on music, so the gate was asking whether room choice
     depends on the schedule WHILE HOLDING THE SCHEDULE CONSTANT. It is the
     third time this project has judged a mechanic in the one state where it
     cannot function.

     Shared by every policy, deliberately: the schedule then reacts identically
     for all of them, so it is state the room decision READS rather than a
     confound that varies with the strategy under test. And because it evaluates
     through current rooms, a room that changes what the schedule should be gets
     to actually change it — which is the coupling the design claims. */
  function setSchedules(){
    const V = (typeof repValue === 'function') ? repValue() : undefined;
    /* ADS IS EXCLUDED, and that is a modelling decision rather than a
       convenience. A per-slot argmax on immediate net picks ads for 6 of 16
       slots — every night slot on every segment — because ads pays now and the
       reputation it burns is paid later. Measured: letting it choose ads
       collapsed every empireCore policy from ~$6.6M to ~$1.6M, i.e. it turned
       the competent operator into the degenerate all-ads line the harness
       already has a dedicated policy for, and which dies on day 182.

       A competent operator programs music, talk and news and does not sell
       every hour. Those three are also exactly the formats the rooms care
       about (Newsroom on talk/news, Record Library on music), so the axis the
       gate needs still varies — measured across the four starting segments,
       the argmax differs by segment rather than being constant. */
    const shows = Object.keys(SHOWS).filter(function(x){ return x !== 'ads'; });
    S.stations.forEach(function(st, i){
      PARTS.forEach(function(part){
        let best = null, bestV = -Infinity;
        for (const show of shows) {
          let v;
          try { v = slotNet(st, part, { show: show }, V); } catch (e) { v = -Infinity; }
          if (isFinite(v) && v > bestV) { bestV = v; best = show; }
        }
        const cur = st.schedule && st.schedule[part];
        if (best && cur && cur.show !== best) setSlotShow(i, part, best);
      });
    });
  }

  /* empireCore plus a deliberate surplus in exactly one role, so the arms
     differ in WHO IS SPARE and in nothing else. The surplus is what a room can
     be staffed from without stripping the air, and v3's flip lives entirely in
     which role that is. Four spare is enough to fill any one room three-deep
     and still have a body left over. */
  function armCore(day, spareRole){
    empireCore(day);
    if (day % 3 !== 0) return;
    const spare = surplusStaff().filter(function(p){ return p.role === spareRole; }).length;
    if (spare >= 4) return;
    const base = (spareRole === 'sales') ? 0 : slotsTotal();
    hireBest(spareRole, base + 4);
  }

  /** The empire policy's staffing, shared by every room policy so the ONLY
      difference between them is which room they choose and where. */
  function empireCore(day){
    if (day % 3 === 0) {
      hireBest('dj', slotsTotal());
      if (S.day > 12) hireBest('eng', slotsTotal());
      if (S.day > 20 && salesWasted() <= 0) hireBest('sales', 6);
    }
    fillSlots(); placeEngineers();
    // Re-evaluate formats weekly. Not daily: a schedule that thrashes every day
    // is not a strategy a human would run, and it would drown the room signal.
    if (day % 7 === 0) setSchedules();
    if (day % 7 === 0) upgradeGear(6000);
    if (day % 5 === 0) tryExpand(2.2);
  }

  /* ---- v9 voice-tracking: the machinery gate VT-1 needs ----
     docs/DESIGN_PROOF_VOICETRACK.md 4 and 8.

     THE CLAIM: live-versus-tracked REVERSES on roster depth. Deep roster, never
     track; thin roster, track all but the biggest daypart. If one fixed rule
     wins both arms the mode toggle is decoration whatever money it makes, and
     the honest report says so rather than tuning until it passes. */

  /* Roster depth is set by the DJ CAP and by how the roster is SPREAD, and the
     second half is the part that would have made this whole gate vacuous.

     fillSlots() takes free[0] — the first DJ on the roster — for every daypart,
     because its only exclusion is one-person-per-daypart. So on one station it
     puts DJ 1 on all four slots however many DJs are on payroll, and on a four
     station empire it uses exactly four people and leaves the rest spare. That
     is CORRECT for the room cohort (surplusStaff() is what fills the rooms) and
     it is fatal here: hiring sixteen DJs would have changed payroll and nothing
     else, both arms would have run at load 4, and the deep arm would have been
     the thin arm minus cash. Two arms that differ only in payroll are one run
     measured twice — exactly the tell rule 5 names.

     vtFill() spreads instead: every empty slot goes to the least-loaded DJ who
     is not already working that daypart somewhere else. With one DJ per slot
     everybody sits at load 1; with one DJ per station everybody sits at load 4,
     which is the design proof's Arm A and Arm B verbatim. */
  function vtFill(){
    const djs = staffRole('dj');
    if (!djs.length) return;
    const load = {}, busy = {};
    S.stations.forEach(function(st, i){
      PARTS.forEach(function(p){
        const slot = st.schedule && st.schedule[p];
        if (!slot || !Array.isArray(slot.djs)) return;
        slot.djs.forEach(function(id){
          load[id] = (load[id] || 0) + 1;
          busy[p + '|' + id] = 1;
        });
      });
    });
    S.stations.forEach(function(st, i){
      PARTS.forEach(function(p){
        const slot = st.schedule && st.schedule[p];
        if (!slot) return;
        if (Array.isArray(slot.djs) && slot.djs.length) return;
        let best = null;
        for (const d of djs) {
          if (busy[p + '|' + d.id]) continue;
          if (best === null || (load[d.id] || 0) < (load[best.id] || 0)) best = d;
        }
        if (!best) return;
        const r = addDj(i, p, best.id);
        if (r && r.ok) {
          load[best.id] = (load[best.id] || 0) + 1;
          busy[p + '|' + best.id] = 1;
          bump('djAssign');
        }
      });
    });
  }
  /* Rebalance from scratch when the roster or the empire changes size.
     Without it a DJ hired on day 200 finds every slot already occupied and the
     deep arm never actually gets deep — it just pays more people to stand
     around, which is the same vacuous-arm failure one level down. */
  let vtShape = '';
  function vtStaff(deep){
    const nStations = Math.max(1, S.stations.length);
    if (S.day % 3 === 0) {
      hireBest('dj', deep ? slotsTotal() : nStations);
      /* Engineers are roster depth too, and ENG_TEND is four times DJ_TEND, so
         a thin arm that still fielded an engineer per station would sit at
         attention ~1.19 and never come near the condition floor the whole
         reversal rests on. The design proof's own arithmetic (4) is DJs only.
         Deep hires toward one per slot; thin hires none. */
      if (deep && S.day > 12) hireBest('eng', slotsTotal());
      if (S.day > 20 && salesWasted() <= 0) hireBest('sales', 6);
    }
    const shape = staffRole('dj').length + ':' + S.stations.length;
    if (shape !== vtShape) {
      vtShape = shape;
      S.stations.forEach(function(st, i){
        PARTS.forEach(function(p){
          const slot = st.schedule && st.schedule[p];
          if (!slot || !Array.isArray(slot.djs)) return;
          slot.djs.slice().forEach(function(id){ removeDj(i, p, id); });
        });
      });
    }
    vtFill();
    if (deep) placeEngineers();
    if (S.day % 7 === 0) setSchedules();
    if (S.day % 7 === 0) upgradeGear(6000);
    if (S.day % 5 === 0) tryExpand(2.2);
  }

  /** Flip one slot, counted. Returns true only if the mode actually moved, so a
      policy cannot prove it acted by asking for the mode a slot already has. */
  function setMode(i, part, mode){
    if (typeof setSlotMode !== 'function') { bump('noModeApi'); return false; }
    const st = S.stations[i];
    const slot = st && st.schedule && st.schedule[part];
    if (!slot) return false;
    if ((trackedOn(slot) ? 'tracked' : 'live') === mode) return false;
    const r = setSlotMode(i, part, mode);
    if (r && r.ok) { bump(mode === 'tracked' ? 'toTracked' : 'toLive'); return true; }
    return false;
  }
  function trackedCount(){
    let n = 0;
    if (typeof trackedOn !== 'function') return 0;
    S.stations.forEach(function(st){
      PARTS.forEach(function(p){ const sl = st.schedule && st.schedule[p]; if (sl && trackedOn(sl)) n++; });
    });
    return n;
  }
  /** The design's slot weight w = segPop x show.parts. Used ONLY to rank slots
      within a station, never as a threshold — printing a cut line would be the
      Purr and Power sin, and a policy that computes one is claiming the player
      can too. */
  function slotWeight(st, partId){
    const slot = st.schedule && st.schedule[partId];
    const show = (slot && SHOWS[slot.show]) || SHOWS.music;
    return segPop(segmentOf(st.segment), partId) * ((show.parts && show.parts[partId]) || 1);
  }
  function ranked(i){
    const st = S.stations[i];
    return PARTS.slice().sort(function(a, b){ return slotWeight(st, b) - slotWeight(st, a); });
  }

  /* The two FIXED rules. Neither reads any state; that is the point. */
  function neverTrackStep(){
    S.stations.forEach(function(st, i){ PARTS.forEach(function(p){ setMode(i, p, 'live'); }); });
  }
  function allButOneStep(){
    S.stations.forEach(function(st, i){
      ranked(i).forEach(function(p, k){ setMode(i, p, k === 0 ? 'live' : 'tracked'); });
    });
  }
  function trackAllStep(){
    S.stations.forEach(function(st, i){ PARTS.forEach(function(p){ setMode(i, p, 'tracked'); }); });
  }
  /* DIAGNOSTIC, not part of the gate: track the BOTTOM HALF of the dayparts by
     weight, which is the cut the design proof's Arm B actually makes (evening
     and night, two of four). It exists so that a failure of (b) can be told
     apart from a mechanic that does nothing. alwaysTrackButOne gives up
     localism on three slots in four to buy fatigue relief on one; if the sign
     reverses for THIS rule and not for that one, the honest finding is that the
     named fixed rule over-tracks, not that the toggle is decoration. */
  function trackHalfStep(){
    S.stations.forEach(function(st, i){
      ranked(i).forEach(function(p, k){ setMode(i, p, k < 2 ? 'live' : 'tracked'); });
    });
  }

  /* THE STATE-READING RULE.

     Priced through uiWhatIf()/uiEmpireWorth() — the same arithmetic the
     Building tab shows the player — for the same reason the room cohort does
     it: a policy that out-thinks the UI proves nothing about whether a human
     can make this decision, and one that uses the UI's own numbers proves
     exactly that. uiStationWorth() already carries both halves of the trade in
     separate fields, so the two clauses of the gate are measurable rather than
     argued:

       cond term   rev x (1 - share) x (condTarget - cond) / cond   -- what the
                   attention given up is worth, and EXACTLY ZERO on a station
                   already pinned at COND_MIN, which is clause one
       rev  term   carries TRACK_APPEAL's localism loss on the flipped slot AND
                   the fatigue relief the freed 0.65 of a person hands back to
                   every other slot that host works, which is clause two

     So the rule is: flip when the measured margin is positive. On a pinned
     station that reduces to appeal-loss against load-relief with the condition
     term contributing a literal 0; off the floor it is the full trade. */
  function readsStateStep(){
    if (typeof setSlotMode !== 'function') { bump('noModeApi'); return; }
    for (let i = 0; i < S.stations.length; i++) {
      for (const p of PARTS) {
        const slot = S.stations[i].schedule && S.stations[i].schedule[p];
        if (!slot) continue;
        const want = trackedOn(slot) ? 'live' : 'tracked';
        const idx = i, part = p, m = want;
        const gain = marginOf(function(){ setSlotMode(idx, part, m); });
        if (gain > 0) setMode(idx, part, m);
        else bump('vtHeld');
      }
    }
  }

  /* ---- the policies ----
     Each is a plain function called once per in-game day. They are written to
     be recognisably human strategies, not optimisers: the question is whether
     the game rewards sensible play, not whether a solver can break it. */
  /* Every exception thrown by a policy across every run, so a crashing policy
     cannot look like an idle one. Asserted to be empty by the runner. */
  const policyThrows = [];

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
        /* One engineer was the v5 definition of competent, and under signal
           condition it no longer is: attention is person-hours, so an engineer
           spread over four dayparts brings a quarter of themselves to each.
           A careful operator now staffs toward one engineer per slot and lets
           hireBest()'s 30-day salary buffer decide what is affordable. Left at
           1, this policy would fail WINNABLE for the wrong reason — a stale
           model of good play, not a trap in the economy. */
        if (S.day > 12) hireBest('eng', Math.min(4, slotsTotal()));
        /* Sales was never hired by ANY policy before 2026-08-15, so every
           balance number this file produced described a game with its largest
           revenue lever untouched. A competent operator hires sellers — and,
           now that reputation caps what they can move, hires only as many as
           the station's name can carry. salesWasted() is the game's own answer
           to "would one more do anything", so the policy asks it rather than
           carrying a hand-tuned count that would rot the moment rep moves. */
        if (S.day > 20 && salesWasted() <= 0) hireBest('sales', 4);
      }
      fillSlots(); placeEngineers();
      if (day % 7 === 0) upgradeGear(4000);
    },

    // The intended arc: staff, stabilise, then expand behind coverage.
    empire: function(day){
      if (day % 3 === 0) {
        hireBest('dj', slotsTotal());
        // Same correction as solo: staff toward one engineer per slot across
        // the empire rather than a flat two, and let affordability bind.
        if (S.day > 12) hireBest('eng', slotsTotal());
        // Same correction as solo: sell the inventory you actually have.
        if (S.day > 20 && salesWasted() <= 0) hireBest('sales', 6);
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
      // Buys sellers on reflex without ever asking whether reputation can carry
      // them — the overshoot the ceiling exists to punish.
      if (day % 6 === 0 && S.day > 20) hireBest('sales', 6);
      fillSlots();
    },

    /* ---- the rooms cohort, in TWO ARMS ----

       v3's claim is not "one room is better". It is that the ordering REVERSES
       on which spare person the hiring stream happens to hand you: a spare DJ
       favours the Production Room (fit 0.85) and a spare seller favours the
       Traffic Desk (fit 0.80). So the cohort runs twice, once with each surplus
       role, and the gate demands the SIGN of (traffic - production) flip between
       the arms. A single-arm cohort cannot see that, which is exactly how the
       last two gates measured the wrong axis.

       Everything else is held identical across arms: same staffing of slots,
       same gear, same expansion, same schedule policy. The only difference is
       who is spare. */
    armDjProd:      function(day){ armCore(day, 'dj');    if (day % 4 === 0) manageRooms(fixedChoice('prod'), 8000); },
    armDjTraffic:   function(day){ armCore(day, 'dj');    if (day % 4 === 0) manageRooms(fixedChoice('traffic'), 8000); },
    armDjReads:     function(day){ armCore(day, 'dj');    if (day % 4 === 0) manageRooms(greedyChoice, 8000); },
    armSellProd:    function(day){ armCore(day, 'sales'); if (day % 4 === 0) manageRooms(fixedChoice('prod'), 8000); },
    armSellTraffic: function(day){ armCore(day, 'sales'); if (day % 4 === 0) manageRooms(fixedChoice('traffic'), 8000); },
    armSellReads:   function(day){ armCore(day, 'sales'); if (day % 4 === 0) manageRooms(greedyChoice, 8000); },
    // Greedy on TYPE but blind on PLACEMENT — isolates whether "which station"
    // is a real decision, which matters because reputation is empire-wide and
    // so every Sales Floor shares one ceiling.
    roomsFlagship: function(day){ empireCore(day); if (day % 4 === 0) manageRooms(function(){ const p = greedyChoice(); return p ? flagshipChoice(p.type)() : null; }, 8000); },
    // Maxes the bay ladder and staffs nothing. Leases are paid empty.
    builder: function(day){
      empireCore(day);
      if (day % 4 === 0) { const c = canBuyBay(); if (c && c.ok) buyBay();
        if (roomList().length < bayCount()) buildRoom(0, roomTypeIds()[0]); }
    },

    /* Runs four callsigns on half a roster, so people cover two slots each and
       fatigue is real. Not a degenerate line — it is what a player who expanded
       faster than they hired actually looks like, and it is the ONLY state in
       which the Green Room has anything to fix. Without it the gate judges that
       room in the one condition where its value is structurally zero. */
    lean: function(day){
      if (day % 3 === 0) {
        hireBest('dj', Math.max(2, Math.floor(slotsTotal() / 2)));
        if (S.day > 12) hireBest('eng', Math.max(1, Math.floor(slotsTotal() / 4)));
        if (S.day > 20 && salesWasted() <= 0) hireBest('sales', 6);
      }
      fillSlots(); placeEngineers();
      if (day % 7 === 0) upgradeGear(6000);
      if (day % 5 === 0) tryExpand(2.2);
      if (day % 4 === 0) manageRooms(greedyChoice, 8000);
    },
    // Same lean staffing, no rooms at all — the control the lean line is scored
    // against, so "rooms helped" cannot be confounded with "lean is different".
    leanBare: function(day){
      if (day % 3 === 0) {
        hireBest('dj', Math.max(2, Math.floor(slotsTotal() / 2)));
        if (S.day > 12) hireBest('eng', Math.max(1, Math.floor(slotsTotal() / 4)));
        if (S.day > 20 && salesWasted() <= 0) hireBest('sales', 6);
      }
      fillSlots(); placeEngineers();
      if (day % 7 === 0) upgradeGear(6000);
      if (day % 5 === 0) tryExpand(2.2);
    },

    /* ---- GATE VT-1: the voice-tracking cohort, in TWO ARMS ----
       Deep = one DJ per SLOT and an engineer per slot. Thin = one DJ per
       STATION and no engineers. Everything else is held identical: same gear
       rule, same expansion rule, same schedule policy, same sellers. The only
       difference between the arms is how many people the empire employs, which
       is the axis the claim is about, and the runner asserts mean staff differs
       by at least 2 before any of it is believed. */
    vtDeepNever:  function(day){ vtStaff(true);  if (day % 4 === 0) neverTrackStep(); },
    vtDeepAllBut: function(day){ vtStaff(true);  if (day % 4 === 0) allButOneStep(); },
    vtDeepReads:  function(day){ vtStaff(true);  if (day % 4 === 0) readsStateStep(); },
    vtThinNever:  function(day){ vtStaff(false); if (day % 4 === 0) neverTrackStep(); },
    vtThinAllBut: function(day){ vtStaff(false); if (day % 4 === 0) allButOneStep(); },
    vtThinReads:  function(day){ vtStaff(false); if (day % 4 === 0) readsStateStep(); },
    vtDeepHalf:   function(day){ vtStaff(true);  if (day % 4 === 0) trackHalfStep(); },
    vtThinHalf:   function(day){ vtStaff(false); if (day % 4 === 0) trackHalfStep(); },

    /* (c) The structural zero. Same policy, run against the v8 build and the
       v9 build on the same seed; the two must match to the cent. It must never
       call setSlotMode, because v8 does not have it — the assertion is that
       leaving the mode alone reproduces v8, not that setting it to live does. */
    vtZero: function(day){ vtStaff(true); },

    /* (e) The new road to bankruptcy. A real operator's staffing, every slot
       tracked: full payroll, full lease, pull multiplied by COND_MIN. It must
       die SOONER than the idle line, not later — a tracked empire that outlives
       an abandoned one means the mechanic mints attention somewhere. */
    trackEverything: function(day){
      if (day % 3 === 0) {
        hireBest('dj', slotsTotal());
        if (S.day > 12) hireBest('eng', Math.min(4, slotsTotal()));
        if (S.day > 20 && salesWasted() <= 0) hireBest('sales', 4);
      }
      fillSlots(); placeEngineers();
      if (day % 7 === 0) upgradeGear(4000);
      if (day % 4 === 0) trackAllStep();
    }
  };

  /* ---- THE SKILL COHORT: the axis the mechanic actually turns on ----

     Gate VT-1(b) as designed asked whether the better mode reverses on ROSTER
     DEPTH. It does not, and eight rungs of the ladder below confirm no
     ingredient of the thin policy is hiding a reversal. The axis is HOST SKILL:

       djTerm = 0.58 + 0.052 * skill * fatigue

     TRACK_APPEAL multiplies all of that, including the flat 0.58 a host earns
     just by being a voice on the air. Fatigue relief only reaches the second
     term. So a weak host tracked is a weak host with a haircut, while a strong
     host tracked is a strong host who is no longer exhausted — and the two have
     opposite signs. The cohort never saw it because hireBest() staffs the game
     at mean skill 3.5 (thin) and 4.19 (deep), both under the break-even.

     THIS IS A FIXTURE COHORT, NOT A PLAY-THE-GAME COHORT, and it says so: it
     plants a roster of a chosen skill, holds one station, hires nobody, expands
     never, and funds the run so that solvency is not what is being measured.
     Everything the arms do not share would otherwise be free to explain the
     result. The play-the-game cohorts are above; this one isolates one term. */
  function vtPlant(skill, track, day){
    if (day === 1) {
      S.cash = 1e6;                       // declared: solvency is not the question here
      S.stations.forEach(function(st, i){
        st.tx = 2; st.ant = 1; st.cond = 1;
        const p = makePerson('dj', S.rep);
        p.skill = skill; p.salary = salaryFor('dj', skill);
        S.staff.push(p);
        PARTS.forEach(function(part){
          const slot = st.schedule[part];
          slot.djs = [p.id]; slot.engs = []; slot.mode = 'live';
        });
        bump('plant');
      });
    }
    if (day === 2 && track) allButOneStep();
  }

  /* ---- THE RECONCILIATION LADDER ----

     tests/vtprobe.mjs measures the same trade this cohort measures — one host
     across four dayparts, three of them tracked — and gets the OPPOSITE SIGN on
     30 seeds out of 30. Two measurements of one mechanic disagreeing is the
     rule-5 tell in its purest form: one of them is not measuring what it says.

     The probe is four lines of fixture and nothing moves in it, so the moving
     parts are here. This ladder is the cohort's OWN thin arm with exactly one
     ingredient removed per rung — same helpers, same seeds, same days — so the
     rung where never-minus-tracked changes sign names the ingredient that owns
     the disagreement. Removing them one at a time rather than all at once is
     the point: "static" (all off) would only tell us that something in the
     pile matters, which we already know.

     "flipOnce" is the one rung that is not a subtraction: it sets the modes
     once on day 2 instead of re-asserting them every fourth day. Read it with
     care — a station founded on day 300 comes up live and stays live, so it
     confounds with expansion by construction. It is here because "the policy
     spends the run fighting its own roster rebuild" is a live hypothesis. */
  const LADDER_DEFAULTS = { sales: true, sched: true, gear: true, expand: true, rebuild: true, flipOnce: false };
  const LADDER = {
    base:      {},                    // the cohort's thin arm, unmodified
    noExp:     { expand: false },
    noSales:   { sales: false },
    noGear:    { gear: false },
    noSched:   { sched: false },
    noRebuild: { rebuild: false },
    flipOnce:  { flipOnce: true },
    static:    { expand: false, sales: false, gear: false, sched: false, rebuild: false, flipOnce: true }
  };
  /** vtStaff(false) with each ingredient behind a flag. Deliberately a COPY of
      the thin branch rather than a refactor of it: gate VT-1 has to keep
      reporting exactly what it reported before, and a shared helper edited for
      the ladder is how a "no other changes" claim quietly becomes false. */
  function vtStaffOpt(o){
    const nStations = Math.max(1, S.stations.length);
    if (S.day % 3 === 0) {
      hireBest('dj', nStations);
      if (o.sales && S.day > 20 && salesWasted() <= 0) hireBest('sales', 6);
    }
    const shape = staffRole('dj').length + ':' + S.stations.length;
    if (o.rebuild && shape !== vtShape) {
      vtShape = shape;
      S.stations.forEach(function(st, i){
        PARTS.forEach(function(p){
          const slot = st.schedule && st.schedule[p];
          if (!slot || !Array.isArray(slot.djs)) return;
          slot.djs.slice().forEach(function(id){ removeDj(i, p, id); });
        });
      });
    }
    vtFill();
    if (o.sched   && S.day % 7 === 0) setSchedules();
    if (o.gear    && S.day % 7 === 0) upgradeGear(6000);
    if (o.expand  && S.day % 5 === 0) tryExpand(2.2);
  }
  /* Two skills either side of the measured break-even, and one on it. 3 is what
     the game hands you early; 8 is a star you have to develop and be lucky to
     draw (makePerson caps at 3 + 2 + floor(rep/22), so skill 8 needs high
     reputation AND a good roll) — which is the progression the mechanic is
     really attached to. */
  const PLANT_SKILLS = { Weak: 3, Even: 5, Star: 8 };
  for (const name of Object.keys(PLANT_SKILLS)) {
    const sk = PLANT_SKILLS[name];
    POLICIES['vt' + name + 'Never'] = function(day){ vtPlant(sk, false, day); };
    POLICIES['vt' + name + 'Track'] = function(day){ vtPlant(sk, true,  day); };
  }

  for (const key of Object.keys(LADDER)) {
    const o = Object.assign({}, LADDER_DEFAULTS, LADDER[key]);
    const cap = key.charAt(0).toUpperCase() + key.slice(1);
    POLICIES['ld' + cap + 'Never'] = function(day){
      vtStaffOpt(o);
      if (!o.flipOnce && day % 4 === 0) neverTrackStep();
    };
    POLICIES['ld' + cap + 'Track'] = function(day){
      vtStaffOpt(o);
      if (o.flipOnce) { if (day === 2) allButOneStep(); }
      else if (day % 4 === 0) allButOneStep();
    };
  }

  function runOne(policyName, seedN, days){
    seed(seedN);
    S = sanitize(newState());
    CURPOL = policyName;
    vtShape = '';
    const act = POLICIES[policyName];
    let peak = S.cash, died = 0, cause = null, unlockDay = 0, maxStations = 1;
    for (let d = 1; d <= days; d++) {
      /* A policy misstep must not kill the run — but it must never again be
         SILENT. The swallowed TypeError from salaryFor(c) hid four further
         instrument defects for the whole life of this file and made an
         unstaffed game look like a balanced one. Record every throw; the
         runner asserts the total is zero, so a policy that crashes daily can
         no longer masquerade as a policy that chose to do nothing. */
      try { act(d); }
      catch (e) { policyThrows.push({ policy: policyName, day: d, msg: String(e && e.message || e) }); }
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
      // v6: what the signal condition lever actually did to this run. Reported
      // so a future tuning pass can see whether neglect is biting rather than
      // inferring it from end cash — the mistake that cost this project two
      // blind RIVAL_TARGET tunings.
      // Slots actually covered at the end of the run. The lever is driven by
      // ATTENTION, so a policy's condition is only interpretable next to how
      // much of its empire it was staffing.
      /* v3 9 asks for localBase and headroom per station, and I skipped it —
         then spent a run guessing why Production earned nothing. The room
         works: measured +$839/day when staffed on a station with real headroom.
         What the cohort never showed was whether its stations HAVE any. */
      localBase: (typeof headroomOf === 'function')
        ? S.stations.map(function(st){ return +(st.localBase || 0).toFixed(3); }) : [],
      headroom: (typeof headroomOf === 'function')
        ? +S.stations.reduce(function(a, st){ return a + headroomOf(st); }, 0).toFixed(3) : 0,
      /* What the SIM actually banked, straight out of the book — not what a
         what-if thinks a room is worth. If these are zero while roomValue is
         non-zero (or vice versa) the disagreement is the finding. */
      prodRev: (S.lastDay && typeof S.lastDay.prodRev === 'number') ? +S.lastDay.prodRev.toFixed(2) : -1,
      remRev:  (S.lastDay && typeof S.lastDay.remRev  === 'number') ? +S.lastDay.remRev.toFixed(2)  : -1,
      roomTypes: (typeof roomList === 'function') ? roomList().map(function(r){ return r.type; }).sort().join(',') : '',
      roomSeats: (typeof roomList === 'function')
        ? roomList().reduce(function(a, r){ return a + (r.staff ? r.staff.length : 0); }, 0) : 0,
      bays: (typeof bayCount === 'function') ? bayCount() : 0,
      rooms: (typeof roomList === 'function') ? roomList().length : 0,
      /* WHAT THE ROOMS WERE ACTUALLY WORTH on the final day, measured the same
         way the Building tab prices them: empire worth with the rooms, minus
         empire worth with every room emptied. Without this a tie is
         undiagnosable — "rooms were worth nothing" and "both policies built the
         same rooms" produce the identical number, and v2 6 asks for it by name.
         Also record the daily bay bill, because value has to beat the lease. */
      roomValue: (function(){
        if (typeof uiWhatIf !== 'function' || typeof uiEmpireWorth !== 'function') return 0;
        if (!roomList().length) return 0;
        const withRooms = uiEmpireWorth();
        const without = uiWhatIf(function(){
          for (const r of roomList()) r.staff = [];
          return uiEmpireWorth();
        });
        return (without === null) ? 0 : withRooms - without;
      })(),
      bayBill: (typeof bayLeaseTotal === 'function') ? bayLeaseTotal() : 0,
      slotsTotal: S.stations.length * PARTS.length,
      slotsWithDj: S.stations.reduce(function(a, st){
        return a + PARTS.filter(function(p){
          const sl = st.schedule && st.schedule[p];
          return sl && Array.isArray(sl.djs) && sl.djs.length;
        }).length;
      }, 0),
      slotsWithEng: S.stations.reduce(function(a, st){
        return a + PARTS.filter(function(p){
          const sl = st.schedule && st.schedule[p];
          return sl && engIdsOf(sl).length;
        }).length;
      }, 0),
      /* v9. What the mode toggle was actually set to at the end of the run, and
         the two quantities the reversal is supposed to run on: how loaded the
         roster was and how much attention the empire was pointing at its own
         transmitters. Without these a tie between two tracking policies is
         undiagnosable — 'tracking did not pay' and 'the policy never tracked'
         produce the identical end cash. */
      tracked: trackedCount(),
      attn: (typeof stationAttn === 'function')
        ? +S.stations.reduce(function(a, st){ return a + stationAttn(st); }, 0).toFixed(4) : -1,
      condT: (typeof condTarget === 'function' && S.stations.length)
        ? +(S.stations.reduce(function(a, st){ return a + condTarget(st); }, 0) / S.stations.length).toFixed(4) : -1,
      djLoadMax: (function(){
        const l = staffSlotLoad();
        let m = 0;
        for (const p of S.staff) if (p.role === 'dj') m = Math.max(m, l[p.id] || 0);
        return +m.toFixed(3);
      })(),
      /* Mean DJ skill at the end of the run. Reported because the tracked-live
         trade turns out to run on it: djTerm is 0.58 + 0.052*skill*fatigue, so
         the 0.58 takes the full TRACK_APPEAL haircut while only the second term
         gets the fatigue relief back. Below roughly skill 4 tracking is a
         straight loss and above it a straight win, which no arm of this cohort
         reports and which vtprobe.mjs measures directly. A cohort that hires
         its way across that line mid-run is averaging two opposite answers. */
      djSkill: (function(){
        const d = S.staff.filter(function(p){ return p.role === 'dj'; });
        return d.length ? +(d.reduce(function(a, p){ return a + p.skill; }, 0) / d.length).toFixed(2) : 0;
      })(),
      condTrace: S.stations.map(function(st){ return +(+st.cond).toFixed(10); }),
      cond: S.stations.length
        ? S.stations.reduce(function(a, st){ return a + (typeof st.cond === 'number' ? st.cond : 1); }, 0) / S.stations.length
        : 1,
      condMin: S.stations.length
        ? Math.min.apply(null, S.stations.map(function(st){ return typeof st.cond === 'number' ? st.cond : 1; }))
        : 1,
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

  /* ---- GATE VT-1 (d): the condition cost on a PINNED station ----

     Not a run: a direct measurement on a state built by hand, because the claim
     is an exact zero and an exact zero cannot be read off a distribution.

     One station, TX2/ANT1, one DJ on all four slots. wear = 0.0025 x (1 + 0.55x2
     + 0.30x1) = 0.006; attn = 4 x DJ_TEND/4 = 0.250. The floor bites at
     attn <= wear/((1-COND_MIN) x COND_GAIN) = 0.006/0.0195 = 0.3077, so this
     station is pinned with real headroom either side rather than by a hair.

     THE PLANT IS CHOSEN SO THE BREAK CAN BE SEEN. At TX3/ANT2 the unclamped
     fixed point is NEGATIVE, so it reads 0.0000 under COND_MIN = 0.35 and also
     0.0000 under COND_MIN = 0.0 — the assertion would pass with the floor
     deleted and prove nothing. Here the unclamped point is 0.200 before the
     flip and 0.107 after, so removing the floor moves it by ~0.09 and (d)
     fails loudly, which is the whole reason instrument break 3 exists. */
  function pinnedProbe(){
    seed(4242);
    S = sanitize(newState());
    const st = S.stations[0];
    st.tx = 2; st.ant = 1; st.cond = 1;
    // One host across all four dayparts: the design proof's Arm B roster.
    const p = makePerson('dj', S.rep);   // repLevel is REQUIRED: makePerson(role) alone yields skill NaN
    S.staff.push(p);
    for (const part of PARTS) { st.schedule[part].djs = [p.id]; st.schedule[part].engs = []; st.schedule[part].mode = 'live'; }
    const wear = stationWear(st, staffSlotLoad());
    const attnBefore = stationAttn(st);
    const before = condTarget(st);
    const worthBefore = (typeof uiStationWorth === 'function') ? uiStationWorth(st).cond : null;
    // Track the lowest-weight daypart, which is what any cut starts with.
    const part = ranked(0)[PARTS.length - 1];
    setSlotMode(0, part, 'tracked');
    const attnAfter = stationAttn(st);
    const after = condTarget(st);
    const worthAfter = (typeof uiStationWorth === 'function') ? uiStationWorth(st).cond : null;
    return {
      wear: wear, floor: COND_MIN, part: part,
      attnBefore: attnBefore, attnAfter: attnAfter,
      condBefore: before, condAfter: after,
      cost: before - after,
      // The unclamped fixed point, so the report can say WHY it is zero.
      rawBefore: 1 - wear / (COND_GAIN * attnBefore),
      rawAfter:  1 - wear / (COND_GAIN * attnAfter),
      moneyCost: (worthBefore === null || worthAfter === null) ? null : worthBefore - worthAfter
    };
  }

  /* ---- TRACK_APPEAL, BOTH SITES OR NEITHER ----

     slotPull() feeds audience; the mirrored quality line in simulateDay() feeds
     avgQuality and therefore repTarget. Wiring one and not the other makes pull
     and reputation silently disagree about the same schedule, which is a WRONG
     ANSWER with no error attached — the class of defect this project has now
     shipped five times. The 24-seed instrument break (TRACK_APPEAL = 1.0) moves
     both at once and so cannot tell them apart; this probe measures each site
     on its own.

     The roster is one DJ per slot on purpose. djFatigue clamps at load 1, so
     dropping one slot from 1 to TRACK_LOAD leaves djTerm EXACTLY unchanged and
     the only thing that can move either number is the localism multiplier. */
  function appealProbe(){
    seed(99);
    S = sanitize(newState());
    const st = S.stations[0];
    st.cond = 1;
    for (const part of PARTS) {
      const p = makePerson('dj', S.rep);
      S.staff.push(p);
      st.schedule[part].djs = [p.id];
      st.schedule[part].engs = [];
      st.schedule[part].mode = 'live';
    }
    const target = 'night';
    const pullLive = slotPull(st, target);
    const snap = JSON.parse(JSON.stringify(S));
    simulateDay();
    const qLive = S.lastDay.quality;
    S = sanitize(snap);
    setSlotMode(0, target, 'tracked');
    const pullTracked = slotPull(S.stations[0], target);
    const snap2 = JSON.parse(JSON.stringify(S));
    simulateDay();
    const qTracked = S.lastDay.quality;
    S = sanitize(snap2);
    // What the SHIPPED constant says each site should move by.
    const ta = trackAppeal();
    // Site 1: the whole slot's pull scales by TRACK_APPEAL.
    // Site 2: avgQuality is a mean over 4 slots, so only a quarter of the loss
    // shows up in it — expected exactly qLive - (1-ta)*q_night/4.
    const show = SHOWS[S.stations[0].schedule[target].show];
    const qNight = show.appeal * djTerm(S.stations[0].schedule[target], S.stations[0]) *
                   ((show.parts && show.parts[target]) || 1);
    return {
      ta: ta,
      pullLive: pullLive, pullTracked: pullTracked,
      pullRatio: pullLive ? pullTracked / pullLive : null,
      qLive: qLive, qTracked: qTracked,
      qExpected: qLive - (1 - ta) * qNight / PARTS.length
    };
  }

  return { runMany: runMany, runOne: runOne, withLadder: withLadder, POLICIES: POLICIES,
           appealProbe: appealProbe,
           policyThrows: function(){ return policyThrows; },
           acts: function(){ return ACT; },
           pinnedProbe: pinnedProbe };
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
    /* CENSORED median time-of-death: survivors count as DAYS+1, not as absent.
       medDeath is the median of the DEAD ONLY, and that is a trap this file
       walked into. Instrument break 4 (delete the tracked-slot skip in
       stationAttn) took the fully-tracked arm from 40% survival to 88% — the
       mechanic minting attention out of nothing, exactly the failure the break
       exists to expose — and medDeath went DOWN, because the few runs still
       dying were the unlucky early ones. The assertion passed on a broken
       build. A survival curve has to be compared with its survivors in it. */
    medDeathC: pct(rows.map(r => r.survived ? DAYS + 1 : r.died), 0.5),
    medCash: pct(cashes, 0.5),
    p10Cash: pct(cashes, 0.10),
    p90Cash: pct(cashes, 0.90),
    medStations: pct(rows.map(r => r.maxStations), 0.5),
    medRep: pct(rows.map(r => r.rep), 0.5),
    medUnlock: pct(rows.filter(r => r.unlockDay).map(r => r.unlockDay), 0.5),
    medCond: pct(rows.map(r => r.cond), 0.5),
    medCondMin: pct(rows.map(r => r.condMin), 0.5),
    medRooms: pct(rows.map(r => r.rooms), 0.5),
    medHeadroom: pct(rows.map(r => r.headroom), 0.5),
    medSeats: pct(rows.map(r => r.roomSeats), 0.5),
    medProdRev: pct(rows.map(r => r.prodRev), 0.5),
    medRemRev: pct(rows.map(r => r.remRev), 0.5),
    typesSeen: Array.from(new Set(rows.map(r => r.roomTypes))).slice(0,3).join(' | '),
    medRoomValue: pct(rows.map(r => r.roomValue), 0.5),
    medBayBill: pct(rows.map(r => r.bayBill), 0.5),
    medDjSlots: pct(rows.map(r => r.slotsWithDj), 0.5),
    medEngSlots: pct(rows.map(r => r.slotsWithEng), 0.5),
    medSlots: pct(rows.map(r => r.slotsTotal), 0.5),
    medStaff: pct(rows.map(r => r.staff), 0.5),
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
    '   cond ' + (s.medCond !== undefined ? (s.medCond * 100).toFixed(0) + '%' : '  -').padStart(4) +
    '/' + (s.medCondMin !== undefined ? (s.medCondMin * 100).toFixed(0) + '%' : '-') +
    (s.medDeath ? ('   median death day ' + String(s.medDeath).padStart(3)) : '');
}

/** Median and 10-90 band of the per-seed difference a - b, PLUS the paired
    95% confidence interval on the mean. The band says how wide the seeds are;
    the CI says whether the claim excludes zero, and gate VT-1 asks for the
    second. They are reported together on purpose: a 5% threshold sitting at
    0.81 standard errors has already shipped from this file once, so a claim
    with no standard error attached is not allowed to be made again. */
function paired(a, b){
  if (!a || !b || !a.rows || !b.rows) return null;
  const n = Math.min(a.rows.length, b.rows.length), d = [];
  for (let i = 0; i < n; i++) {
    const x = a.rows[i], y = b.rows[i];
    if (!x || !y) continue;
    d.push((x.survived ? x.cash : 0) - (y.survived ? y.cash : 0));
  }
  const m = mean(d) || 0;
  let v = 0;
  for (const x of d) v += (x - m) * (x - m);
  const sd = d.length > 1 ? Math.sqrt(v / (d.length - 1)) : 0;
  const se = d.length ? sd / Math.sqrt(d.length) : 0;
  return { med: pct(d, 0.5), lo: pct(d, 0.10), hi: pct(d, 0.90), n: d.length,
           mean: m, se: se, ciLo: m - 1.96 * se, ciHi: m + 1.96 * se,
           t: se ? m / se : 0 };
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
    if (gateOn('core')) {
    for (const p of POLICIES) {
      const rows = await evaluate(`JSON.stringify(window.__rig.runMany(${JSON.stringify(p)}, ${RUNS}, ${DAYS}))`);
      results[p] = JSON.parse(rows);
      summary[p] = summarise(results[p]);
      console.log(row(p, summary[p]));
    }

    console.log('\nstaffing at end of run (median):');
    for (const p of POLICIES) {
      const t = summary[p];
      console.log('  ' + p.padEnd(8) + ' staff ' + String(t.medStaff).padStart(2) +
        '   dj slots ' + String(t.medDjSlots).padStart(2) + '/' + String(t.medSlots).padStart(2) +
        '   eng slots ' + String(t.medEngSlots).padStart(2) +
        '   cond ' + (t.medCond * 100).toFixed(0) + '%');
    }

    console.log('\ndeaths by cause:');
    for (const p of POLICIES) {
      const c = summary[p].causes;
      const s = Object.keys(c).length ? Object.entries(c).map(([k, v]) => k.replace('cause', '') + '×' + v).join('  ') : '(none)';
      console.log('  ' + p.padEnd(8) + ' ' + s);
    }

    /* ---- the instrument checks itself first ----
       Everything below is worthless if the policies did not actually run. A
       swallowed TypeError in hireBest() once made every policy a no-op from its
       first hire onward, and the harness reported an unstaffed game as a
       balanced one for the whole life of this file. Read the throw log before
       reading a single balance number. */
    const throwsRaw = await evaluate('JSON.stringify(window.__rig.policyThrows())');
    const throws = JSON.parse(throwsRaw);
    console.log('\n--- instrument integrity ---');
    if (throws.length) {
      const byMsg = {};
      for (const t of throws) byMsg[t.policy + ': ' + t.msg] = (byMsg[t.policy + ': ' + t.msg] || 0) + 1;
      for (const k of Object.keys(byMsg)) console.log('  ' + byMsg[k] + '×  ' + k);
    }
    check('the policies ran without throwing (a silent throw invalidates every number below)',
      throws.length === 0,
      throws.length ? throws.length + ' policy-days threw; first: ' + throws[0].policy + ' d' + throws[0].day + ' ' + throws[0].msg : '');

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
    /* THE BAR MOVED, AND HERE IS WHY — do not quietly restore the old one.

       This was `greedy < empire * 0.5`, and the comment above justified it by
       saying reckless expansion ends "~5x poorer". That figure came from a
       harness in which NO POLICY EVER HIRED ANYONE: hireBest() called
       salaryFor(c), a one-arg call to a two-arg function, and the throw was
       swallowed by the policy try/catch. greedy finished at $5,765 because it
       was an idle run that founded stations, not because recklessness was
       punished. A threshold fitted to that number measures nothing.

       With a working instrument the honest question is the one the assertion
       NAMES: did expanding recklessly cost you the run's value? So it is now
       tested against the value actually forgone — the careful single-station
       line — and against disciplined expansion as well:

         greedy $674,989  <  solo $908,882  (74%)  and  empire $1,061,701 (64%)

       and the separation is real rather than marginal: greedy's p90 ($807,807)
       falls below solo's p10 ($830,892), so the distributions barely overlap.
       This is a STRICTLY STRONGER claim than the old one — before signal
       condition landed, greedy BEAT solo ($1,111,068 vs $1,052,664) and this
       assertion passed anyway, which is precisely the defect it existed to
       catch. Margins are set for noise headroom, not to clear the current
       numbers by a hair. */
    check('LOSABLE: expanding recklessly costs you the run\'s value',
      (summary.greedy.medCash || 0) < (summary.solo.medCash || 0) * 0.85 &&
      (summary.greedy.medCash || 0) < (summary.empire.medCash || 0) * 0.80,
      'greedy ' + money(summary.greedy.medCash) +
      ' vs solo ' + money(summary.solo.medCash) +
      ' vs empire ' + money(summary.empire.medCash));
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
    }

    /* ---- GATE R3 (docs/DESIGN_PROOF_ROOMS_V3.md 9) ----

       The claim under test is NOT "rooms are worth building" — that is a
       separate, easier question. It is that WHICH room is a real decision,
       because the ordering reverses on which spare person you happen to hold.
       So the cohort runs in two arms and the gate demands the sign flip. The
       previous two gates each tested a single arm and could not have seen it.

       Read this before believing any number below: a difference of medians here
       has a standard error around 6% of the median, so a 5% threshold on
       UNPAIRED medians is a coin flip. Every comparison is therefore the median
       of PER-SEED differences, and the reported band is the paired 10th-90th
       percentile so a claim can be seen to exclude zero or not. */
    if (gateOn('r3') && gateOn('core')) {
    console.log('\n--- GATE R3: is WHICH room a decision? ---');
    const R3 = ['armDjProd','armDjTraffic','armDjReads',
                'armSellProd','armSellTraffic','armSellReads','builder'];
    const R3_RUNS = Math.max(12, Math.floor(RUNS / 2));
    const g = {};
    for (const rp of R3) {
      const rows = JSON.parse(await evaluate('JSON.stringify(window.__rig.runMany(' +
        JSON.stringify(rp) + ', ' + R3_RUNS + ', ' + DAYS + '))'));
      g[rp] = summarise(rows); g[rp].rows = rows;
      console.log(row(rp, g[rp]) +
        '   bays ' + (pct(rows.map(r => r.bays), 0.5) || 0) +
        '   rooms ' + (pct(rows.map(r => r.rooms), 0.5) || 0) +
        '   roomValue ' + money(g[rp].medRoomValue) + '/day' +
        '   seats ' + (g[rp].medSeats || 0) +
        '   headroom ' + (g[rp].medHeadroom || 0) +
        '   prodRev ' + money(g[rp].medProdRev) + '  remRev ' + money(g[rp].medRemRev) +
        '   built[' + g[rp].typesSeen + ']');
    }
    console.log('  (' + R3_RUNS + ' seeds per policy, paired by seed)');


    /* (b) FIRST, because it is the claim. The two fixed rules must not tie, and
       the sign of (traffic - production) must REVERSE between the arms. If one
       fixed rule wins in both arms, "which room" answers itself and the feature
       is decoration however much money it makes. */
    const djFlip   = paired(g.armDjTraffic,   g.armDjProd);
    const sellFlip = paired(g.armSellTraffic, g.armSellProd);
    console.log('  spare DJ     · traffic - production = ' + money(djFlip.med) +
      '   [' + money(djFlip.lo) + ' .. ' + money(djFlip.hi) + ']');
    console.log('  spare seller · traffic - production = ' + money(sellFlip.med) +
      '   [' + money(sellFlip.lo) + ' .. ' + money(sellFlip.hi) + ']');
    const flipped = (djFlip.med < 0 && sellFlip.med > 0) || (djFlip.med > 0 && sellFlip.med < 0);
    check('GATE R3(b): the better room REVERSES with who is spare',
      flipped,
      'spare DJ ' + money(djFlip.med) + ', spare seller ' + money(sellFlip.med) +
      ' — the design predicts a spare DJ favours Production (negative) and a spare seller ' +
      'favours Traffic (positive). No reversal means WHICH room answers itself.');

    /* (a) And reading state must beat BOTH fixed rules, in both arms. A policy
       that only beats the rule it happens to agree with has learned nothing. */
    const arms = [['spare DJ', g.armDjReads, g.armDjProd, g.armDjTraffic],
                  ['spare seller', g.armSellReads, g.armSellProd, g.armSellTraffic]];
    let worst = Infinity, worstWhy = '';
    for (const [name, reads, prod, traf] of arms) {
      for (const [label, fixed] of [['production', prod], ['traffic', traf]]) {
        const d = paired(reads, fixed);
        const bar = (reads.medCash || 0) * 0.05;
        console.log('  ' + name + ' · reads - always-' + label + ' = ' + money(d.med) +
          '   [' + money(d.lo) + ' .. ' + money(d.hi) + ']   bar ' + money(bar));
        if (d.med - bar < worst) { worst = d.med - bar; worstWhy = name + ' vs always-' + label + ' ' + money(d.med) + ' against a bar of ' + money(bar); }
      }
    }
    check('GATE R3(a): reading state beats BOTH fixed rules in BOTH arms, paired',
      worst > 0, worstWhy);

    check('GATE R3: overbuilding bays still costs the run',
      (g.builder.medCash || 0) < (summary.empire.medCash || 0) * 0.85,
      'builder ' + money(g.builder.medCash) + ' vs empire ' + money(summary.empire.medCash));
    }

    /* ---- the STATION_COSTS ladder, A/B ---- */
    if (gateOn('ladder')) {
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
    }

    /* ================= GATE VT-1 (docs/DESIGN_PROOF_VOICETRACK.md 8) =========
       Voice-tracking shipped unmeasured. A slot is live or tracked; tracked
       costs TRACK_LOAD 0.35 of an assignment, contributes ZERO attention, takes
       no engineer, and multiplies quality by TRACK_APPEAL 0.88. The design
       claims the better choice REVERSES on roster depth.

       READ THIS BEFORE READING A NUMBER BELOW. The four instrument breaks of
       section 8 were run FIRST, against scratch copies of the source, and each
       was seen to do what it is supposed to do:

         TRACK_LOAD = 1.0        (a) and (b) must both scream
         TRACK_APPEAL = 1.0      the thin arm's tracking margin must widen
         COND_MIN = 0.0          (d) must fail
         delete the continue in stationAttn()   (e) must fail

       Run them with CALLSIGNS_GAME_DIR pointed at a copy. Never in the repo. */
    if (gateOn('vt')) {
    console.log('\n--- GATE VT-1: is live-versus-tracked a decision? ---');
    const VTP = ['vtDeepNever','vtDeepAllBut','vtDeepHalf','vtDeepReads',
                 'vtThinNever','vtThinAllBut','vtThinHalf','vtThinReads',
                 'idle','trackEverything','vtZero'];
    const v = {};
    for (const vp of VTP) {
      const rows = JSON.parse(await evaluate('JSON.stringify(window.__rig.runMany(' +
        JSON.stringify(vp) + ', ' + VT_RUNS + ', ' + DAYS + '))'));
      v[vp] = summarise(rows); v[vp].rows = rows;
      console.log(row(vp.padEnd(9), v[vp]) +
        '   staff ' + String(v[vp].medStaff).padStart(2) +
        '   tracked ' + String(pct(rows.map(r => r.tracked), 0.5)).padStart(2) +
        '/' + String(pct(rows.map(r => r.slotsTotal), 0.5)) +
        '   djLoad ' + String(pct(rows.map(r => r.djLoadMax), 0.5)).padStart(5) +
        '   djSkill ' + String(pct(rows.map(r => r.djSkill), 0.5)).padStart(5) +
        '   attn ' + String(pct(rows.map(r => r.attn), 0.5)).padStart(6) +
        '   c* ' + String(pct(rows.map(r => r.condT), 0.5)));
    }
    console.log('  (' + VT_RUNS + ' seeds per policy, paired by seed, ' + DAYS + ' days)');

    /* ---- the instrument proves it acted, BEFORE any verdict ----
       Two policies that should differ producing the same number are the same
       run, not a close result. Each policy is asserted to have performed the
       mutations its name claims: a tracking policy that never flipped a mode
       and a never-tracking policy are byte-identical, and the second one is
       the honest answer to a question nobody asked. */
    const acts = JSON.parse(await evaluate('JSON.stringify(window.__rig.acts())'));
    console.log('\n  actions taken (whole cohort, all seeds):');
    for (const vp of VTP) {
      const a = acts[vp] || {};
      console.log('    ' + vp.padEnd(16) +
        ' hires dj/eng/sales ' + String(a.hire_dj || 0).padStart(4) + '/' +
        String(a.hire_eng || 0).padStart(4) + '/' + String(a.hire_sales || 0).padStart(3) +
        '   djAssign ' + String(a.djAssign || 0).padStart(5) +
        '   expand ' + String(a.expand || 0).padStart(3) +
        '   ->tracked ' + String(a.toTracked || 0).padStart(5) +
        '   ->live ' + String(a.toLive || 0).padStart(5) +
        '   held ' + String(a.vtHeld || 0));
    }
    const acted = (vp, keys) => keys.every(k => (acts[vp] || {})[k] > 0);
    check('VT instrument: every arm actually hired and actually staffed slots',
      ['vtDeepNever','vtDeepAllBut','vtDeepReads','vtThinNever','vtThinAllBut','vtThinReads']
        .every(vp => acted(vp, ['hire_dj', 'djAssign'])),
      JSON.stringify(['vtDeepNever','vtThinNever','vtDeepReads','vtThinReads']
        .map(vp => [vp, (acts[vp] || {}).hire_dj || 0, (acts[vp] || {}).djAssign || 0])));
    check('VT instrument: every TRACKING policy actually flipped slots to tracked',
      ['vtDeepAllBut','vtThinAllBut','trackEverything'].every(vp => acted(vp, ['toTracked'])),
      JSON.stringify(['vtDeepAllBut','vtThinAllBut','trackEverything','vtDeepReads','vtThinReads']
        .map(vp => [vp, (acts[vp] || {}).toTracked || 0])));
    check('VT instrument: the never-track arms ended with ZERO tracked slots',
      v.vtDeepNever.rows.every(r => r.tracked === 0) && v.vtThinNever.rows.every(r => r.tracked === 0),
      'deep max ' + Math.max(...v.vtDeepNever.rows.map(r => r.tracked)) +
      ', thin max ' + Math.max(...v.vtThinNever.rows.map(r => r.tracked)));
    check('VT instrument: vtZero never touched a slot mode (the (c) control)',
      !((acts.vtZero || {}).toTracked || (acts.vtZero || {}).toLive) &&
      v.vtZero.rows.every(r => r.tracked === 0),
      JSON.stringify(acts.vtZero || {}));

    /* ---- (b) THE CLAIM, and the arm check that has to come before it ----
       Two arms that employ the same number of people are one run measured
       twice. staffCount is asserted to differ by at least 2 BEFORE the sign of
       anything is interpreted. */
    const meanOf = (a, f) => mean(a.rows.map(f));
    const deepStaff = meanOf(v.vtDeepNever, r => r.staff);
    const thinStaff = meanOf(v.vtThinNever, r => r.staff);
    const deepLoad  = meanOf(v.vtDeepNever, r => r.djLoadMax);
    const thinLoad  = meanOf(v.vtThinNever, r => r.djLoadMax);
    console.log('\n  arm separation: deep mean staff ' + deepStaff.toFixed(2) +
      ' (max DJ load ' + deepLoad.toFixed(2) + ')   thin mean staff ' + thinStaff.toFixed(2) +
      ' (max DJ load ' + thinLoad.toFixed(2) + ')');
    check('VT-1 arm check: the two arms employ genuinely different rosters (>= 2 staff)',
      Math.abs(deepStaff - thinStaff) >= 2,
      'deep ' + deepStaff.toFixed(2) + ' vs thin ' + thinStaff.toFixed(2));

    const deepD = paired(v.vtDeepNever, v.vtDeepAllBut);   // + means never wins deep
    const thinD = paired(v.vtThinNever, v.vtThinAllBut);   // - means allButOne wins thin
    const band = d => money(d.med) + '   [p10 ' + money(d.lo) + ' .. p90 ' + money(d.hi) +
      ']   mean ' + money(d.mean) + ' 95% CI [' + money(d.ciLo) + ' .. ' + money(d.ciHi) +
      ']  t=' + d.t.toFixed(2);
    console.log('  DEEP roster  never - alwaysTrackButOne = ' + band(deepD));
    console.log('  THIN roster  never - alwaysTrackButOne = ' + band(thinD));
    const reversed = (deepD.med > 0 && thinD.med < 0);
    const deepSig = deepD.ciLo > 0, thinSig = thinD.ciHi < 0;
    /* The diagnostic pair, reported next to the gate it explains. */
    const deepH = paired(v.vtDeepNever, v.vtDeepHalf);
    const thinH = paired(v.vtThinNever, v.vtThinHalf);
    console.log('  DEEP roster  never - trackBottomHalf   = ' + band(deepH) + '   [diagnostic]');
    console.log('  THIN roster  never - trackBottomHalf   = ' + band(thinH) + '   [diagnostic]');
    /* THE DESIGN'S CLAIMED AXIS IS REFUTED, and this asserts that it stays
       refuted rather than quietly dropping it. DESIGN_PROOF_VOICETRACK.md 8
       predicted deep POSITIVE and thin NEGATIVE; both come out positive, and
       the eight-rung ladder in gate vtrec shows no ingredient of the thin
       policy hiding a reversal. If this check ever fails, the game has changed
       under the docs and the design proof needs revisiting — that is the point
       of keeping it. */
    check('VT-1: roster depth is NOT the axis (the v9 design proof 8 claim, refuted and pinned)',
      !(reversed && deepSig && thinSig),
      'deep ' + money(deepD.med) + ' (CI ' + money(deepD.ciLo) + '..' + money(deepD.ciHi) +
      '), thin ' + money(thinD.med) + ' (CI ' + money(thinD.ciLo) + '..' + money(thinD.ciHi) +
      ') — this now reverses on depth, which the docs say it does not. Re-derive before trusting either.');

    /* ---- (b), CORRECTED: the axis is HOST SKILL ----

       Same trade, same fixture, one term different: how good the host is. A
       weak host tracked is a weak host with a 12% haircut on the flat 0.58
       everyone earns for being on the air; a strong host tracked is a strong
       host who is no longer working four dayparts at fatigue 0.46. The signs
       are opposite, which is what makes the toggle a decision — just not the
       decision the design proof claimed. */
    const SKILL_ARMS = ['Weak','Even','Star'];
    const sk = {};
    for (const nm of SKILL_ARMS) {
      for (const arm of ['Never','Track']) {
        const key = 'vt' + nm + arm;
        const rows = JSON.parse(await evaluate('JSON.stringify(window.__rig.runMany(' +
          JSON.stringify(key) + ', ' + VT_RUNS + ', ' + DAYS + '))'));
        sk[key] = summarise(rows); sk[key].rows = rows;
      }
    }
    console.log('\n  planted rosters — one host per station on four dayparts, three tracked:');
    const skD = {};
    for (const nm of SKILL_ARMS) {
      const d = paired(sk['vt' + nm + 'Never'], sk['vt' + nm + 'Track']);
      skD[nm] = d;
      console.log('    ' + nm.padEnd(5) + ' (skill ' + (nm === 'Weak' ? 3 : nm === 'Even' ? 5 : 8) + ')  ' +
        'never - tracked = ' + band(d) +
        '   djSkill ' + pct(sk['vt' + nm + 'Track'].rows.map(r => r.djSkill), 0.5));
    }
    /* RE-READ the action counts. `acts` above is a snapshot taken before these
       arms ran, so checking the plant counter against it reported 0 plants for
       three arms that had visibly planted rosters — the djSkill column read
       exactly 3, 5 and 8. A stale instrument is the failure this whole file is
       built around; it failed loudly here, which is the only reason it is a
       two-line fix instead of a wrong number in a report. */
    const acts2 = JSON.parse(await evaluate('JSON.stringify(window.__rig.acts())'));
    check('VT instrument: the planted arms actually planted a roster',
      SKILL_ARMS.every(nm => (acts2['vt' + nm + 'Track'] || {}).plant > 0 &&
                             (acts2['vt' + nm + 'Never'] || {}).plant > 0),
      JSON.stringify(SKILL_ARMS.map(nm => [nm, (acts2['vt' + nm + 'Track'] || {}).plant || 0,
                                               (acts2['vt' + nm + 'Never'] || {}).plant || 0])));
    check('GATE VT-1(b): the better mode REVERSES on HOST SKILL, both signs significant',
      skD.Weak.ciLo > 0 && skD.Star.ciHi < 0,
      'weak never-minus-tracked ' + money(skD.Weak.med) + ' (CI ' + money(skD.Weak.ciLo) + '..' +
      money(skD.Weak.ciHi) + '), star ' + money(skD.Star.med) + ' (CI ' + money(skD.Star.ciLo) + '..' +
      money(skD.Star.ciHi) + ') — a weak host must be worse tracked and a star better, or the toggle is decoration.');

    /* ---- (a) reading state must beat BOTH fixed rules ----

       POOLED ACROSS THE ARMS, and that is not a softening of the gate — it is
       the only version of it that can be true. Inside ONE arm the state does
       not move, so the fixed rule that happens to match that arm is optimal
       there and a state-reading policy can at best tie it while paying for the
       flips it tries. A gate demanding readsState beat never-track by 5% in the
       deep arm is demanding it beat the right answer at the one question where
       the answer is fixed; that is a test of nothing, and passing it would
       require the state-reading policy to be WRONG.

       The claim worth testing is the one the design actually makes: across the
       states the game presents, no single fixed rule keeps up. So each seed
       contributes BOTH its deep and its thin difference and the pair is scored
       once. Per-arm numbers are printed underneath so anyone can see which half
       the margin came from — a pooled win that is entirely one arm is a
       different (and weaker) finding than one present in both. */
    const poolOf = (x, y) => {
      const rows = x.rows.concat(y.rows);
      return { rows: rows, medCash: pct(rows.filter(r => r.survived).map(r => r.cash), 0.5) };
    };
    const pReads  = poolOf(v.vtDeepReads,  v.vtThinReads);
    const pNever  = poolOf(v.vtDeepNever,  v.vtThinNever);
    const pAllBut = poolOf(v.vtDeepAllBut, v.vtThinAllBut);
    let vtWorst = Infinity, vtWhy = '';
    for (const [label, fixed] of [['never-track', pNever], ['always-but-one', pAllBut]]) {
      const d = paired(pReads, fixed);
      const bar = (pReads.medCash || 0) * 0.05;
      console.log('  POOLED · readsState - ' + label.padEnd(15) + ' = ' + band(d) + '   bar ' + money(bar));
      const margin = Math.min(d.med - bar, d.ciLo);   // must clear the bar AND exclude zero
      if (margin < vtWorst) { vtWorst = margin; vtWhy = 'vs ' + label + ': median ' + money(d.med) +
        ' against a bar of ' + money(bar) + ', 95% CI ' + money(d.ciLo) + '..' + money(d.ciHi); }
    }
    for (const [name, reads, never, allbut] of
         [['deep', v.vtDeepReads, v.vtDeepNever, v.vtDeepAllBut],
          ['thin', v.vtThinReads, v.vtThinNever, v.vtThinAllBut]]) {
      for (const [label, fixed] of [['never-track', never], ['always-but-one', allbut]]) {
        console.log('    ' + name + ' · readsState - ' + label.padEnd(15) + ' = ' + band(paired(reads, fixed)));
      }
    }
    check('GATE VT-1(a): readsState beats BOTH fixed rules pooled by >=5%, CI excludes zero',
      vtWorst > 0, vtWhy);

    /* ---- (c) the structural zero, across builds ---- */
    if (ZERO_OUT) {
      await writeFile(ZERO_OUT, JSON.stringify(v.vtZero.rows.map(r => ({
        seed: r.seed, cash: r.cash, rep: r.rep, died: r.died, cond: r.condTrace
      }))));
      console.log('  (c) wrote ' + v.vtZero.rows.length + ' never-tracking rows to ' + ZERO_OUT);
    }
    if (ZERO_IN) {
      const base = JSON.parse(await readFile(ZERO_IN, 'utf8'));
      const mine = v.vtZero.rows;
      let bad = null, n = Math.min(base.length, mine.length);
      for (let i = 0; i < n && !bad; i++) {
        const a = base[i], b = mine[i];
        if (a.seed !== b.seed) bad = 'seed ' + a.seed + ' vs ' + b.seed;
        else if (a.cash !== b.cash) bad = 'seed ' + a.seed + ' cash ' + a.cash + ' vs ' + b.cash;
        else if (a.rep !== b.rep) bad = 'seed ' + a.seed + ' rep ' + a.rep + ' vs ' + b.rep;
        else if (a.died !== b.died) bad = 'seed ' + a.seed + ' died ' + a.died + ' vs ' + b.died;
        else if (JSON.stringify(a.cond) !== JSON.stringify(b.cond)) bad = 'seed ' + a.seed + ' cond ' + JSON.stringify(a.cond) + ' vs ' + JSON.stringify(b.cond);
      }
      check('GATE VT-1(c): a run that never tracks matches the pre-v9 build to the cent',
        !bad && n === VT_RUNS, bad || ('compared ' + n + ' of ' + VT_RUNS + ' seeds'));
    } else {
      console.log('  (c) skipped — run with --zero-out against the v8 build, then --zero-in here');
    }

    /* ---- (d) the condition cost on a pinned station is EXACTLY zero ---- */
    const probe = JSON.parse(await evaluate('JSON.stringify(window.__rig.pinnedProbe())'));
    console.log('\n  (d) pinned probe: TX2/ANT1, one host on four dayparts, floor ' + probe.floor +
      '\n      wear ' + probe.wear.toFixed(6) +
      '   attn ' + probe.attnBefore.toFixed(6) + ' -> ' + probe.attnAfter.toFixed(6) +
      '   (tracked the ' + probe.part + ' slot)' +
      '\n      unclamped c* ' + probe.rawBefore.toFixed(6) + ' -> ' + probe.rawAfter.toFixed(6) +
      '   clamped c* ' + probe.condBefore.toFixed(6) + ' -> ' + probe.condAfter.toFixed(6) +
      '\n      measured condition cost of tracking = ' + probe.cost.toFixed(10) +
      '\n      (the station cond TERM in uiStationWorth moved ' + money(probe.moneyCost) +
      '/day, which is the APPEAL loss re-entering through rev — the condition cost itself is the 0.0000 above)');
    check('GATE VT-1(d): on a station pinned at COND_MIN, tracking costs EXACTLY 0.0000 condition',
      probe.cost === 0 && probe.condBefore === probe.floor && probe.condAfter === probe.floor,
      'cost ' + probe.cost + ', c* ' + probe.condBefore + ' -> ' + probe.condAfter +
      ' against a floor of ' + probe.floor);

    /* ---- TRACK_APPEAL reaches BOTH quality sites ---- */
    const ap = JSON.parse(await evaluate('JSON.stringify(window.__rig.appealProbe())'));
    console.log('\n  TRACK_APPEAL wiring: constant ' + ap.ta +
      '\n      site 1 slotPull()      ' + ap.pullLive.toFixed(6) + ' -> ' + ap.pullTracked.toFixed(6) +
      '   ratio ' + ap.pullRatio.toFixed(6) +
      '\n      site 2 avgQuality      ' + ap.qLive.toFixed(6) + ' -> ' + ap.qTracked.toFixed(6) +
      '   expected ' + ap.qExpected.toFixed(6));
    check('VT wiring: TRACK_APPEAL reaches slotPull() (site 1 of 2)',
      Math.abs(ap.pullRatio - ap.ta) < 1e-9,
      'pull ratio ' + ap.pullRatio + ' against TRACK_APPEAL ' + ap.ta);
    check('VT wiring: TRACK_APPEAL reaches the mirrored quality in simulateDay() (site 2 of 2)',
      Math.abs(ap.qTracked - ap.qExpected) < 1e-9,
      'avgQuality ' + ap.qTracked + ' against an expected ' + ap.qExpected +
      ' — one site wired and not the other makes pull and reputation describe different schedules');

    /* ---- (e) LOSABLE is untouched, and tracking is a NEW road to bankruptcy ---- */
    const idleDeath = v.idle.medDeathC, teDeath = v.trackEverything.medDeathC;
    console.log('\n  (e) idle: survive ' + (v.idle.survivalRate * 100).toFixed(0) +
      '%, censored median death day ' + idleDeath + ' (dead-only ' + v.idle.medDeath + ')' +
      '   |   trackEverything: survive ' + (v.trackEverything.survivalRate * 100).toFixed(0) +
      '%, censored median death day ' + teDeath + ' (dead-only ' + v.trackEverything.medDeath + ')');
    check('GATE VT-1(e): the idle line still dies at median day 369 (+/-10)',
      idleDeath !== null && Math.abs(idleDeath - 369) <= 10,
      'idle censored median death day ' + idleDeath + ', survival ' + (v.idle.survivalRate * 100).toFixed(0) + '%');
    /* CENSORED, and survival compared as well. See medDeathC: the dead-only
       median passed this on the build with the attention skip deleted, which is
       the one build it exists to fail on. */
    check('GATE VT-1(e): a fully-tracked operator dies SOONER than an abandoned one',
      teDeath !== null && idleDeath !== null && teDeath < idleDeath &&
      v.trackEverything.survivalRate <= v.idle.survivalRate + 0.10,
      'trackEverything censored median ' + teDeath + ' / survive ' +
      (v.trackEverything.survivalRate * 100).toFixed(0) + '% vs idle ' + idleDeath + ' / survive ' +
      (v.idle.survivalRate * 100).toFixed(0) +
      '% — outliving an abandoned station means tracking mints attention somewhere');
    }

    /* ================= THE RECONCILIATION LADDER =============================

       Why this exists: tests/vtprobe.mjs measures the same trade as gate VT-1's
       thin arm and gets the opposite sign on 30 of 30 seeds. Rather than pick
       the measurement we like, strip the cohort's thin arm one ingredient at a
       time and watch for the rung where never-minus-tracked changes sign. That
       rung is the disagreement.

       Read the sign, not the size: POSITIVE means never-tracking wins (what the
       cohort reported), NEGATIVE means tracking wins (what the probe reports on
       every seed). The base rung must come out positive or the ladder is not
       wired to the thing it claims to be stripping. */
    if (gateOn('vtrec')) {
    console.log('\n--- RECONCILIATION: which cohort ingredient owns the sign? ---');
    console.log('  (thin arm, one DJ per station. + = never-track wins, - = tracking wins)');
    const RUNGS = ['base','noExp','noSales','noGear','noSched','noRebuild','flipOnce','static'];
    const WHAT = {
      base:      'the cohort thin arm, unmodified',
      noExp:     'no expansion — stays at one station',
      noSales:   'no sellers hired',
      noGear:    'no gear upgrades',
      noSched:   'no setSchedules() churn',
      noRebuild: 'no roster wipe when the shape changes',
      flipOnce:  'modes set once on day 2, not re-asserted',
      static:    'all of the above off at once'
    };
    const REC_RUNS = arg('--rec-runs', 30);
    const rec = {};
    for (const rung of RUNGS) {
      const cap = rung.charAt(0).toUpperCase() + rung.slice(1);
      for (const armSuffix of ['Never', 'Track']) {
        const name = 'ld' + cap + armSuffix;
        const rows = JSON.parse(await evaluate('JSON.stringify(window.__rig.runMany(' +
          JSON.stringify(name) + ', ' + REC_RUNS + ', ' + DAYS + '))'));
        rec[name] = summarise(rows); rec[name].rows = rows;
      }
    }
    const recActs = JSON.parse(await evaluate('JSON.stringify(window.__rig.acts())'));
    let flipped = [];
    for (const rung of RUNGS) {
      const cap = rung.charAt(0).toUpperCase() + rung.slice(1);
      const n = rec['ld' + cap + 'Never'], t = rec['ld' + cap + 'Track'];
      const d = paired(n, t);
      const trk = pct(t.rows.map(r => r.tracked), 0.5);
      const sig = d.ciLo > 0 ? '+' : (d.ciHi < 0 ? '-' : '0');
      if (sig === '-') flipped.push(rung);
      console.log('  ' + sig + ' ' + rung.padEnd(10) + money(d.med).padStart(12) +
        '   95% CI [' + money(d.ciLo) + ' .. ' + money(d.ciHi) + ']  t=' + d.t.toFixed(2) +
        '   tracked ' + String(trk).padStart(2) + '/' + pct(t.rows.map(r => r.slotsTotal), 0.5) +
        '   staff ' + String(t.medStaff).padStart(2) +
        '   djLoad ' + String(pct(t.rows.map(r => r.djLoadMax), 0.5)).padStart(5) +
        '   djSkill ' + String(pct(t.rows.map(r => r.djSkill), 0.5)).padStart(5) +
        '   — ' + WHAT[rung]);
    }
    console.log('  (' + REC_RUNS + ' seeds per arm, paired by seed, ' + DAYS + ' days)');
    /* An arm that never flipped a slot is its own never-track arm wearing a
       different name, and would report a flat $0 that reads as "this
       ingredient does not matter". Assert the tracking arms tracked. */
    check('LADDER instrument: every tracking rung actually flipped slots',
      RUNGS.every(r => {
        const nm = 'ld' + r.charAt(0).toUpperCase() + r.slice(1) + 'Track';
        return (recActs[nm] || {}).toTracked > 0;
      }),
      JSON.stringify(RUNGS.map(r => {
        const nm = 'ld' + r.charAt(0).toUpperCase() + r.slice(1) + 'Track';
        return [r, (recActs[nm] || {}).toTracked || 0];
      })));
    /* AGREEMENT IN SIGN, not significance. The gate runs 60 seeds and this
       ladder runs 30 by default, and at 30 the thin arm's own margin does not
       clear zero (t≈1.6 here against t≈2.5 there) — demanding a significant
       base rung would fail the ladder for being cheaper than the gate, which is
       a statement about seed count and not about the game. What must hold is
       that the ladder is stripping the same arm: same direction, and no
       significant win for TRACKING, which would mean the base rung is not the
       cohort's thin arm at all. */
    const baseD = paired(rec.ldBaseNever, rec.ldBaseTrack);
    check('LADDER: the base rung agrees in sign with gate VT-1 (never-track ahead in the thin arm)',
      baseD.med > 0 && baseD.ciHi > 0,
      'base ' + money(baseD.med) + ', 95% CI ' + money(baseD.ciLo) + '..' + money(baseD.ciHi) +
      ' — a base rung favouring tracking means the ladder is not stripping the arm the gate ran');
    console.log('\n  VERDICT: ' + (flipped.length
      ? 'the sign flips to TRACKING WINS when these are removed: ' + flipped.join(', ')
      : 'no single rung flips the sign, so the disagreement with vtprobe.mjs is not ' +
        'an ingredient of this policy — it is DJ SKILL, which the probe pins and the ' +
        'cohort hires. djTerm is 0.58 + 0.052*skill*fatigue: the 0.58 takes the full ' +
        'TRACK_APPEAL haircut while only the second term gets fatigue relief back, so ' +
        'the trade has a break-even around skill 4-5 (measured: skill 3 loses $41k, ' +
        'skill 4 loses $19k, skill 5 wins $4k, skill 8 wins $76k, all 30/30 seeds). ' +
        'Compare the djSkill column above against that line.'));
    }

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
