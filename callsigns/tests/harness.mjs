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
      // c.salary is already salaryFor(c.role, c.skill), set in makePerson().
      // This once read salaryFor(c) — a one-arg call to a two-arg function,
      // which threw TypeError inside the affordability test on the FIRST
      // candidate every time and was swallowed whole by the policy try/catch
      // below. No policy ever hired anyone: solo was idle-plus-gear and
      // empire was idle-plus-gear-plus-expansion. Every balance number this
      // project published before 2026-08-14 described an unstaffed game.
      if (S.cash >= hireFee(c) + c.salary * 30) {
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
      if (bestRoom && bestVal > (p.salary || 0)) seatInRoom(bestRoom.id, p.id);
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

    /* ---- the rooms cohort. Identical staffing, different room strategy. ---- */
    rooms:       function(day){ empireCore(day); if (day % 4 === 0) manageRooms(greedyChoice, 8000); },
    alwaysLib:   function(day){ empireCore(day); if (day % 4 === 0) manageRooms(fixedChoice('library'), 8000); },
    alwaysMaint: function(day){ empireCore(day); if (day % 4 === 0) manageRooms(fixedChoice('maint'), 8000); },
    alwaysNews:  function(day){ empireCore(day); if (day % 4 === 0) manageRooms(fixedChoice('news'), 8000); },
    roundRobin:  function(day){ empireCore(day); if (day % 4 === 0) manageRooms(roundRobinChoice, 8000); },
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
    }
  };

  function runOne(policyName, seedN, days){
    seed(seedN);
    S = sanitize(newState());
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

  return { runMany: runMany, runOne: runOne, withLadder: withLadder, POLICIES: POLICIES,
           policyThrows: function(){ return policyThrows; } };
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
    medCond: pct(rows.map(r => r.cond), 0.5),
    medCondMin: pct(rows.map(r => r.condMin), 0.5),
    medRooms: pct(rows.map(r => r.rooms), 0.5),
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

    /* ---- THE ROOMS GATE ----
       docs/DESIGN_PROOF_ROOMS.md §3.3 and §10: this ships WITH the code, not
       after it. If any fixed room priority comes within 5% of the policy that
       reads state, §2's non-constancy argument is wrong and the feature does
       not merge. Written to be able to fail, and to say plainly what it means
       if it does. */
    console.log('\n--- rooms: is the choice a decision, or a shopping list? ---');
    // alwaysGreen is gone with the Green Room: a policy that can never build
    // anything is not a fixed PRIORITY, it is a control, and leaving it in the
    // fixedBest max would have let "build nothing" win the comparison.
    const ROOM_POLICIES = ['rooms', 'roomsFlagship', 'alwaysMaint', 'alwaysNews',
                           'alwaysLib', 'roundRobin', 'builder',
                           'lean', 'leanBare'];
    const ROOM_RUNS = Math.max(12, Math.floor(RUNS / 2));
    const rsum = {};
    for (const rp of ROOM_POLICIES) {
      const rrows = JSON.parse(await evaluate('JSON.stringify(window.__rig.runMany(' +
        JSON.stringify(rp) + ', ' + ROOM_RUNS + ', ' + DAYS + '))'));
      rsum[rp] = summarise(rrows);
      rsum[rp].rows = rrows;
      console.log(row(rp, rsum[rp]) + '   bays ' + (pct(rrows.map(r => r.bays), 0.5) || 0) +
        '   rooms ' + (pct(rrows.map(r => r.rooms), 0.5) || 0) +
        '   roomValue ' + money(rsum[rp].medRoomValue) + '/day' +
        '   bayBill ' + money(rsum[rp].medBayBill) + '/day');
    }
    console.log('  (rooms cohort runs at ' + ROOM_RUNS + ' seeds, not ' + RUNS +
      ' — seven extra policies at ' + DAYS + ' days is real wall clock, and this is a margin test)');

    /* Only policies that ACTUALLY BUILT count as fixed priorities.

       alwaysMaint reaches bays 0 / rooms 0 — the Maintenance Bay never clears a
       bay lease at any state these policies reach — so including it made the
       "best fixed priority" a policy that builds nothing, and this assertion
       silently became rooms-versus-no-rooms. That question is already asked, and
       asked better, by 'rooms beat leaving the same money in the bank' below.
       Same flaw that made alwaysGreen worth removing. If EVERY fixed policy
       declines to build, say so out loud rather than comparing against a
       control. */
    /* PAIRED comparison, because the unpaired one has no power.

       Measured spread is p10-p90 $4.8M-$7.9M, so sigma is ~$1.05M on a $7.1M
       median and the standard error of a DIFFERENCE OF MEDIANS at n=20 is about
       6.2% of the median. A 5% threshold therefore sits at 0.81 SE: a design
       with a true 5% edge passes it about half the time and a design with no
       edge passes it about a fifth of the time. Comparing medians here is
       reading tea leaves, which is why roundRobin can post WORSE room economics
       ($73/day of value against $130/day of bays) and still show a higher
       median than the state-reading policy.

       Every policy runs the same seed list, so the honest statistic is the
       median of the PER-SEED differences. It is not full common-random-numbers
       — one global PRNG still desynchronises once policies diverge — but the
       opening of each run is shared, which removes most of the between-seed
       variance that swamps the signal. Report the paired figure alongside the
       raw medians and judge on the paired one. */
    const pairedMedian = (a, b) => {
      if (!a || !b || !a.rows || !b.rows) return null;
      const n = Math.min(a.rows.length, b.rows.length), d = [];
      for (let i = 0; i < n; i++) {
        const x = a.rows[i], y = b.rows[i];
        if (!x || !y) continue;
        d.push((x.survived ? x.cash : 0) - (y.survived ? y.cash : 0));
      }
      return pct(d, 0.5);
    };
    const fixedCandidates = [['alwaysMaint', rsum.alwaysMaint], ['alwaysNews', rsum.alwaysNews],
                             ['alwaysLib', rsum.alwaysLib], ['roundRobin', rsum.roundRobin]]
      .filter(function(e){ return (e[1].medRooms || 0) > 0; });
    if (!fixedCandidates.length) console.log('  NOTE: every fixed-priority policy declined to build a room at all.');
    const fixedBest = fixedCandidates.length
      ? Math.max.apply(null, fixedCandidates.map(function(e){ return e[1].medCash || 0; })) : 0;
    const fixedBestName = fixedCandidates.length
      ? fixedCandidates.reduce(function(a, b){ return (b[1].medCash || 0) > (a[1].medCash || 0) ? b : a; })[0] : 'none';
    const greedyCash = rsum.rooms.medCash || 0;
    /* Paired: the median seed-by-seed gain of reading state over each fixed
       rule that actually builds. Positive on every one, and large enough to
       matter, is what "the choice is a decision" looks like. */
    const pairedVsFixed = fixedCandidates.map(function(e){
      return [e[0], pairedMedian(rsum.rooms, e[1])];
    });
    console.log('  paired (median per-seed gain of reading state):');
    for (const [nm, v] of pairedVsFixed) console.log('    vs ' + nm.padEnd(12) + ' ' + money(v));
    const worstPaired = pairedVsFixed.length
      ? Math.min.apply(null, pairedVsFixed.map(function(e){ return e[1] === null ? 0 : e[1]; })) : 0;
    check('ROOMS ARE NOT A SHOPPING LIST: reading state beats every fixed priority, paired',
      pairedVsFixed.length > 0 && worstPaired > greedyCash * 0.05,
      'worst paired gain ' + money(worstPaired) + ' against a bar of ' + money(greedyCash * 0.05) +
      ' — unpaired medians for reference: state-reading ' + money(greedyCash) +
      ' vs best fixed (' + fixedBestName + ') ' + money(fixedBest) +
      '; if this fails, DESIGN_PROOF_ROOMS.md §2 is wrong and rooms must not ship');
    check('(reference, low power) unpaired median also favours reading state',
      greedyCash > fixedBest * 1.05,
      'state-reading ' + money(greedyCash) + ' vs best fixed (' + fixedBestName + ') ' + money(fixedBest) +
      ' (' + (fixedBest ? ((greedyCash / fixedBest - 1) * 100).toFixed(1) : '-') + '%)' +
      ' — if this fails, DESIGN_PROOF_ROOMS.md §2 is wrong and rooms must not ship');
    /* Placement, tested separately from type. Reputation is empire-wide, so
       every Sales Floor shares one ceiling and "which station" could easily be
       a constant. If it is, say so out loud rather than letting the combined
       number hide it. */
    check('room PLACEMENT is a decision too, not just room type',
      greedyCash > (rsum.roomsFlagship.medCash || 0) * 1.02,
      'greedy placement ' + money(greedyCash) + ' vs always-flagship ' +
      money(rsum.roomsFlagship.medCash) +
      ' — reputation is empire-wide, so this is the weakest leg of §2');
    check('LOSABLE: overbuilding bays costs the run',
      (rsum.builder.medCash || 0) < (summary.empire.medCash || 0) * 0.85,
      'builder ' + money(rsum.builder.medCash) + ' vs empire ' + money(summary.empire.medCash));
    /* The 5% bar here was set for the GREEN ROOM, which is now cut — it existed
       to help exactly this short-staffed player. What survives is the fairer
       question: do the three remaining rooms earn their bays for an operator who
       expanded faster than they hired? Bar dropped to a margin that is merely
       real rather than one calibrated for a deleted mechanic. */
    check('rooms earn their bays for a SHORT-STAFFED operator',
      (rsum.lean.medCash || 0) > (rsum.leanBare.medCash || 0) * 1.02,
      'lean+rooms ' + money(rsum.lean.medCash) + ' vs lean alone ' + money(rsum.leanBare.medCash) +
      ' — the Green Room, which existed for this player, was cut; these are the other three');
    check('SKILL PAYS: rooms beat leaving the same money in the bank',
      greedyCash > (summary.empire.medCash || 0) * 1.10,
      'rooms ' + money(greedyCash) + ' vs empire ' + money(summary.empire.medCash));

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
