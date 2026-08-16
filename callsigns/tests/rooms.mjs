// Callsigns — rooms invariants. Pure sim in a node vm, NO browser, so it runs
// in about a second and can be used as a tight loop while tuning.
//
// Why this exists alongside smoke.mjs and harness.mjs: smoke proves the machine
// runs, harness proves the economy is a game, and neither can see the things
// that would silently break signal condition. The two prohibitions in
// docs/DESIGN_PROOF_ROOMS.md §3 — a room may never add to attn, and may never
// cut the BASE COND_WEAR term — are invisible to both suites because violating
// them produces a perfectly healthy-looking game in which idle no longer dies.
// That is the LOSABLE failure this project spent a full pass closing.
//
// Also pins the transition rules that were found by measurement, not by review:
// building the first Sales Floor must not cliff the stations that lack one, and
// deleting the last one must not hand back the stronger v6 empire-wide reading
// (which was a two-click, free, strictly-better exploit before the latch).
//
// Run:  node callsigns/tests/rooms.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Repo-relative, not absolute: this file has to survive being cloned anywhere.
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'js') + '/';
const store = new Map();
const ctx = {
  console,
  Math, JSON, Date, Object, Array, Number, String, Set, Map, isFinite, parseInt, parseFloat,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  document: { getElementById: () => null },
  window: {},
  setInterval: () => 0, clearInterval: () => {},
  // presentation stubs sim calls
  render: () => {}, toast: () => {}, openModal: () => {}, closeAllModals: () => {},
  showScreen: () => {}, refreshMenu: () => {}, noteHudDeltas: () => {},
  sfxOnAir: () => {}, sfxTrouble: () => {}, sfxFault: () => {}, sfxDeadAir: () => {},
  sfxBankrupt: () => {}, sfxBuy: () => {}, modalQueue: [], dismissAutoModal: () => {},
  setPausedUI: () => {}, autoPaused: false, eventVars: () => ({})
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['content.js', 'sim.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
};
const run = expr => vm.runInContext(expr, ctx);

/* ---- 1. wear identity ---- */
run(`S = sanitize(newState('KTST'));`);
const wear = run(`(function(){
  const st = S.stations[0];
  const out = {};
  for (const g of [[0,0],[1,1],[4,4]]) {
    st.tx = g[0]; st.ant = g[1];
    const before = COND_WEAR * (1 + WEAR_PER_TX*g[0] + WEAR_PER_ANT*g[1]);
    // no rooms
    const now = stationWear(st);
    // full maintenance bay: 10 points -> gearCut capped 0.60
    S.bays = 1;
    S.rooms = [{ id:'r1', type:'maint', station:0, staff:[] }];
    const p = makePerson('eng', 10); p.skill = 10; S.staff.push(p);
    S.rooms[0].staff = [p.id];
    const cut = stationWear(st);
    out[g.join('/')] = { before, now, cut, gearCut: gearCut(st) };
    S.rooms = []; S.bays = 0; S.staff = [];
  }
  st.tx = 0; st.ant = 0;
  return out;
})()`);
ok('wear at TX0/ANT0 is unchanged with no rooms', Math.abs(wear['0/0'].now - wear['0/0'].before) < 1e-12, JSON.stringify(wear['0/0']));
ok('wear at TX0/ANT0 is IDENTICAL with a full Maintenance Bay',
  wear['0/0'].cut === wear['0/0'].before && wear['0/0'].gearCut > 0.5, JSON.stringify(wear['0/0']));
ok('wear at TX1/ANT1 unchanged with no rooms', Math.abs(wear['1/1'].now - wear['1/1'].before) < 1e-12, JSON.stringify(wear['1/1']));
ok('a Maintenance Bay cuts the gear term at TX4/ANT4 only',
  wear['4/4'].cut < wear['4/4'].before && wear['4/4'].cut > COND_WEARish(), JSON.stringify(wear['4/4']));
function COND_WEARish(){ return run('COND_WEAR') * 0.999; }

/* ---- 2. idle decay untouched: attn 0 -> linear at COND_WEAR ---- */
const idle = run(`(function(){
  S = sanitize(newState('KIDL'));
  S.bays = 6;
  // Every surviving room type, all empty: attn must still be 0 on an unstaffed
  // station or LOSABLE re-opens. The cut types (green, sales) are covered by
  // the hostile-save block instead, as unknown types.
  S.rooms = [{id:'a',type:'maint',station:0,staff:[]},
             {id:'c',type:'news',station:0,staff:[]},{id:'d',type:'library',station:0,staff:[]}];
  const st = S.stations[0];
  const a0 = stationAttn(st);
  let days = 0; while (st.cond > COND_MIN + 1e-9 && days < 2000) { stepCondition(st, 1); days++; }
  return { attn: a0, days, cond: st.cond, target: condTarget(st) };
})()`);
ok('an unstaffed station with six empty rooms still has attn 0', idle.attn === 0, JSON.stringify(idle));
ok('idle still reaches COND_MIN in 260 days', idle.days === 260, JSON.stringify(idle));

/* ---- 3. inertness at bays: 0 ---- */
const inert = run(`(function(){
  S = sanitize(newState('KINE'));
  const p = makePerson('sales', 10); p.skill = 10; S.staff.push(p);
  const q = makePerson('dj', 8); q.skill = 8; S.staff.push(q);
  S.stations[0].schedule.morning.djs = [q.id];
  S.stations[0].schedule.midday.djs = [q.id];
  S.rep = 60;
  return {
    fill: salesFill(), price: salesPrice(), wasted: salesWasted(),
    legacyFill: Math.min(0.50 + roleStrength('sales')*0.040, fillCap()),
    fatigue: djFatigue(q.id), legacyFatigue: 1 - 0.18*(2-1),
    news: newsMul(S.stations[0]), lib: libMul(S.stations[0]),
    bayLease: bayLeaseTotal(), leases: totalLeases(), lease0: leaseFor(S.stations[0]),
    load: JSON.stringify(staffSlotLoad())
  };
})()`);
ok('sales reads exactly v6 at bays 0', Math.abs(inert.fill - inert.legacyFill) < 1e-12 && inert.price > 1, JSON.stringify(inert));
ok('fatigue coefficient is 0.18 at bays 0', Math.abs(inert.fatigue - inert.legacyFatigue) < 1e-12, JSON.stringify(inert));
ok('newsMul and libMul are both 1.00, and bay lease is $0, at bays 0',
  inert.news === 1 && inert.lib === 1 && inert.bayLease === 0 && inert.leases === inert.lease0, JSON.stringify(inert));

/* ---- 4. a room seat costs attention and fatigue ---- */
const seat = run(`(function(){
  S = sanitize(newState('KSEA'));
  const st = S.stations[0]; st.tx = 4; st.ant = 4;
  const e = makePerson('eng', 6); e.skill = 6; S.staff.push(e);
  st.schedule.morning.engs = [e.id];
  const attnBefore = stationAttn(st), cBefore = condTarget(st);
  S.bays = 1; S.rooms = [{ id:'m', type:'maint', station:0, staff:[e.id] }];
  const attnAfter = stationAttn(st), cAfter = condTarget(st);
  // now a SURPLUS engineer instead
  const e2 = makePerson('eng', 6); e2.skill = 6; S.staff.push(e2);
  S.rooms[0].staff = [e2.id];
  const cSurplus = condTarget(st);
  return { attnBefore, attnAfter, cBefore, cAfter, cSurplus, power: roomPower(S.rooms[0]) };
})()`);
ok('seating the working engineer LOWERS attention (dilution is real)', seat.attnAfter < seat.attnBefore, JSON.stringify(seat));
ok('diluting your one engineer into the bay makes condition WORSE', seat.cAfter < seat.cBefore, JSON.stringify(seat));
ok('a surplus engineer in the bay makes condition BETTER', seat.cSurplus > seat.cBefore, JSON.stringify(seat));

/* ---- 5. roomPower divides by load ---- */
const power = run(`(function(){
  S = sanitize(newState('KPOW'));
  // Fixtured on the Newsroom now that the Sales Floor is gone. The check is
  // about roomPower's arithmetic, not about any one room.
  const p = makePerson('dj', 9); p.skill = 9; S.staff.push(p);
  S.bays = 1; S.rooms = [{ id:'s', type:'news', station:0, staff:[p.id] }];
  const solo = roomPower(S.rooms[0]);
  S.stations[0].schedule.morning.djs = [];
  const d = makePerson('eng', 9); d.skill = 9; S.staff.push(d);
  S.rooms[0].staff = [p.id, d.id];
  const pair = roomPower(S.rooms[0]);
  // now double-book the seller onto two slots -> load 3
  S.rooms[0].staff = [p.id];
  S.stations[0].schedule.morning.djs = [];
  S.staff.find(x=>x.id===p.id);
  S.stations[0].schedule.evening.djs = [];
  // seat them in a second room instead (load 2)
  S.rooms.push({ id:'s2', type:'maint', station:0, staff:[p.id] });
  const diluted = roomPower(S.rooms[0]);
  return { solo, pair, diluted, fitDj: roomFit('news','dj'), fitEng: roomFit('news','eng') };
})()`);
ok('roomPower = fit x skill for one full-time person',
  Math.abs(power.solo - power.fitDj * 9) < 1e-12, JSON.stringify(power));
ok('a second body is priced by ROLE FIT, not by skill rank',
  Math.abs(power.pair - (power.fitDj * 9 + power.fitEng * 9)) < 1e-12, JSON.stringify(power));
ok('a second assignment halves what someone brings to the first',
  Math.abs(power.diluted - power.fitDj * 9 / 2) < 1e-12, JSON.stringify(power));

/* ---- 6. ceilings: points above the cap are worth exactly zero ---- */
const ceil = run(`(function(){
  S = sanitize(newState('KCAP'));
  S.rep = 38;
  // Sales has no room any more: it is a GLOBAL, reputation-capped lever, which
  // is the fix that actually removed its dominance (commit 1916875). Hiring
  // more sellers past what reputation can carry must still buy nothing.
  const seat = n => {
    S.staff = [];
    for (let i=0;i<n;i++){ const p = makePerson('sales',10); p.skill=10; S.staff.push(p); }
    return { fill: salesFill(), price: salesPrice(), wasted: salesWasted() };
  };
  return { one: seat(1), three: seat(3), fillCap: fillCap(), priceCap: priceCap() };
})()`);
ok('sales points above the reputation ceiling buy nothing',
  ceil.three.fill === ceil.one.fill && ceil.three.price === ceil.one.price && ceil.three.wasted > ceil.one.wasted,
  JSON.stringify(ceil));
ok('the sales ceiling is the rep-set one',
  Math.abs(ceil.one.wasted - (10 - Math.max((ceil.fillCap-0.5)/0.04, (ceil.priceCap-1)/0.03))) < 1e-9,
  JSON.stringify(ceil));

/* ---- 7. newsroom / library disjoint supports ---- */
const disjoint = run(`(function(){
  const build = (shows, type) => {
    S = sanitize(newState('KDIS'));
    const parts = ['morning','midday','evening','night'];
    parts.forEach((p,i) => setSlotShow(0, p, shows[i]));
    const st = S.stations[0];
    const before = slotPull(st, 'morning');
    S.bays = 1;
    const p = makePerson('dj', 9); p.skill = 9; S.staff.push(p);
    S.rooms = [{ id:'x', type, station:0, staff:[p.id] }];
    return { pullBefore: before, pullAfter: slotPull(st, 'morning'),
             ceiling: roomCeiling(S.rooms[0]), served: servedSlots(st, type) };
  };
  return {
    newsOnMusic: build(['music','music','music','music'], 'news'),
    newsOnTalk:  build(['talk','talk','news','news'], 'news'),
    libOnMusic:  build(['music','music','music','music'], 'library'),
    libOnTalk:   build(['talk','talk','news','news'], 'library')
  };
})()`);
ok('a Newsroom on an all-music station is worth exactly zero pull',
  disjoint.newsOnMusic.pullAfter === disjoint.newsOnMusic.pullBefore, JSON.stringify(disjoint.newsOnMusic));
ok('a Newsroom on a talk/news station raises pull',
  disjoint.newsOnTalk.pullAfter > disjoint.newsOnTalk.pullBefore, JSON.stringify(disjoint.newsOnTalk));
/* The Library stopped cutting royalties in v2 and became an appeal multiplier
   on music slots, mirroring the Newsroom on talk/news — because a royalty cut
   is structurally capped at ROYALTY_RATE*0.55 = 2.475% of music revenue while
   the Newsroom reaches ~7%, and one room worth a sixth of another is not a
   choice. So it is now tested the same way its twin is: pull, not money. */
ok('a Record Library on an all-talk station is worth exactly zero pull',
  disjoint.libOnTalk.pullAfter === disjoint.libOnTalk.pullBefore, JSON.stringify(disjoint.libOnTalk));
ok('a Record Library on an all-music station raises pull',
  disjoint.libOnMusic.pullAfter > disjoint.libOnMusic.pullBefore, JSON.stringify(disjoint.libOnMusic));
/* The structural zero is the whole argument: a room with no served slots has a
   ceiling of ZERO, not merely a small multiplier. No constant can tune that
   away, which is what makes the schedule a real decision. */
ok('a room with no served slots has a ceiling of exactly zero',
  disjoint.libOnTalk.ceiling === 0 && disjoint.libOnTalk.served === 0 &&
  disjoint.newsOnMusic.ceiling === 0 && disjoint.newsOnMusic.served === 0,
  JSON.stringify({ lib: disjoint.libOnTalk, news: disjoint.newsOnMusic }));
/* ...and the ceiling scales with HOW MUCH of the board serves the room, which
   is what makes concentration a decision rather than a binary. */
ok('the ceiling is 3 points per served slot',
  disjoint.libOnMusic.served === 4 && Math.abs(disjoint.libOnMusic.ceiling - 12) < 1e-9,
  JSON.stringify(disjoint.libOnMusic));

/* ---- 8. bay leases ride the leases line, and the ledger reconciles ---- */
const ledger = run(`(function(){
  S = sanitize(newState('KLED'));
  S.cash = 200000; S.rep = 40; S.bays = 4;
  S.rooms = [{ id:'s', type:'sales', station:0, staff:[] }];
  const out = [];
  for (let i=0;i<30;i++){ simulateDay(); out.push(ledgerDrift()); }
  return { maxDrift: Math.max.apply(null, out.map(Math.abs)),
           bayLeases: S.lastDay.bayLeases, leases: S.lastDay.leases, ladder: [0,1,2,3].reduce((a,i)=>a+bayLease(i),0) };
})()`);
ok('the ledger reconciles every day with bays leased', ledger.maxDrift < 1e-6, JSON.stringify(ledger));
ok('bay leases are inside the leases line, charged once',
  ledger.bayLeases === ledger.ladder && ledger.leases > ledger.bayLeases, JSON.stringify(ledger));

/* ---- 9. migration ---- */
const mig = run(`(function(){
  // a v6 save with three sellers on payroll
  S = sanitize(newState('KMIG'));
  for (let i=0;i<4;i++){ const p = makePerson('sales',10); p.skill=10; S.staff.push(p); }
  S.rep = 70;
  const v6fill = salesFill(), v6price = salesPrice();
  const raw = JSON.parse(JSON.stringify(S)); raw.v = 6; delete raw.bays; delete raw.rooms;
  localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
  const loaded = loadGame();
  S = loaded;
  return { ver: S.v, bays: S.bays, rooms: S.rooms.length, type: S.rooms[0] && S.rooms[0].type,
           seats: S.rooms[0] ? S.rooms[0].staff.length : 0,
           v6fill, v6price, fill: salesFill(S.stations[0]), price: salesPrice(S.stations[0]) };
})()`);
ok('a v6 save migrates to v7 with bays 0', mig.ver === 7 && mig.bays === 0, JSON.stringify(mig));
// With no Sales Floor there is no transition to grandfather: a v6 save simply
// arrives with no rooms, and its sellers keep working the global lever exactly
// as they did. The multiplier check below is what actually protects the player.
ok('a v6 save with sellers migrates to NO rooms and loses nothing',
  mig.rooms === 0 && mig.seats === 0, JSON.stringify(mig));
ok('the migrated save keeps the multiplier it paid for',
  Math.abs(mig.fill - mig.v6fill) < 1e-12 && Math.abs(mig.price - mig.v6price) < 1e-12, JSON.stringify(mig));

const migNoSales = run(`(function(){
  S = sanitize(newState('KNOS'));
  const raw = JSON.parse(JSON.stringify(S)); raw.v = 6; delete raw.bays; delete raw.rooms;
  localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
  S = loadGame();
  return { ver: S.v, bays: S.bays, rooms: S.rooms.length };
})()`);
ok('a v6 save with no sellers gets no room', migNoSales.rooms === 0 && migNoSales.bays === 0, JSON.stringify(migNoSales));

/* ---- 10. hostile save ---- */
const hostile = run(`(function(){
  S = sanitize(newState('KHOS'));
  const p = makePerson('dj', 5); S.staff.push(p);
  const raw = JSON.parse(JSON.stringify(S));
  raw.v = 7;
  raw.bays = 9999;
  raw.rooms = [
    { id:'a', type:'news', station: 0, staff:[p.id, p.id, 'ghost', 'ghost2', p.id] },
    { id:'a', type:'news', station: 0, staff:[] },               // duplicate id AND duplicate type
    { id:'b', type:'spaceport', station: 0, staff:[] },          // unknown type
    { id:'c', type:'maint', station: 99, staff:[] },             // station out of range
    // Cut room types must be dropped, not honoured — same path as sales.
    { id:'d', type:'green', station: -5, staff:[p.id] },
    { id:'e', type:'news', station: 0, staff:[] },
    { id:'f', type:'library', station: 0, staff:[] },
    // A save written by the in-progress build that HAD a Sales Floor. It must be
    // dropped like any other unknown type rather than throwing.
    { id:'g', type:'sales', station: 0, staff:[] },
    'not an object', null
  ];
  localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
  S = loadGame();
  return { bays: S.bays, rooms: S.rooms.length, types: S.rooms.map(r=>r.type),
           stations: S.rooms.map(r=>r.station), firstSeats: S.rooms[0].staff,
           ids: S.rooms.map(r=>r.id) };
})()`);
ok('S.bays is clamped to [0, MAX_BAYS]', hostile.bays === 6, JSON.stringify(hostile));
ok('unknown room types are dropped', hostile.types.indexOf('spaceport') < 0, JSON.stringify(hostile));
ok('a retired Sales Floor in an old v7 save is dropped, not honoured',
  hostile.types.indexOf('sales') < 0, JSON.stringify(hostile));
ok('room.station is clamped into the station array', hostile.stations.every(x => x === 0), JSON.stringify(hostile));
ok('seats are deduped, capped and filtered to the roster', hostile.firstSeats.length === 1, JSON.stringify(hostile));
ok('duplicate room ids are re-issued', new Set(hostile.ids).size === hostile.ids.length, JSON.stringify(hostile));
ok('one room type per station survives', new Set(hostile.types).size === hostile.types.length, JSON.stringify(hostile));

/* ---- 11. firing scrubs room seats ---- */
const fired = run(`(function(){
  S = sanitize(newState('KFIR'));
  const p = makePerson('dj', 9); S.staff.push(p);
  S.bays = 1; S.rooms = [{ id:'s', type:'news', station:0, staff:[p.id] }];
  const before = roomPower(S.rooms[0]);
  scrubStaffFromSchedules(p.id);
  S.staff = S.staff.filter(x => x.id !== p.id);
  return { before, after: roomPower(S.rooms[0]), seats: S.rooms[0].staff.length };
})()`);
ok('firing a person empties their room seat', fired.before > 0 && fired.after === 0 && fired.seats === 0, JSON.stringify(fired));

/* ---- 12. causeOverbuilt ---- */
const cause = run(`(function(){
  S = sanitize(newState('KOVB'));
  S.rep = 45;
  const quiet = bankruptCause().key;
  S.bays = 4; S.rooms = [{ id:'s', type:'news', station:0, staff:[] }];
  const overbuilt = bankruptCause().key;
  S.bays = 0; S.rooms = [];
  return { quiet, overbuilt, back: bankruptCause().key };
})()`);
ok('causeOverbuilt fires for four bays and one empty room', cause.overbuilt === 'causeOverbuilt', JSON.stringify(cause));
ok('causeOverbuilt is silent at bays 0', cause.quiet !== 'causeOverbuilt' && cause.back !== 'causeOverbuilt', JSON.stringify(cause));

/* ---- 13. mutators ---- */
const mut = run(`(function(){
  S = sanitize(newState('KMUT'));
  S.cash = 50000; S.rep = 5;
  const lockedByRep = canBuyBay();
  S.rep = 30;
  const buy1 = buyBay();
  const noBayLeft = buildRoom(0, 'news');    // 1 bay, 0 rooms -> should be ok
  const dupe = buildRoom(0, 'news');
  const second = buildRoom(0, 'maint');      // no free bay
  const cashAfter = S.cash;
  return { lockedByRep: lockedByRep.reason, buy1: buy1.ok, bays: S.bays,
           built: noBayLeft.ok, dupe: dupe.reason, second: second.reason,
           spent: 50000 - cashAfter, capex: S.book.capex };
})()`);
ok('bays are gated on reputation', mut.lockedByRep === 'rep', JSON.stringify(mut));
ok('buying a bay books capex', mut.buy1 && mut.bays === 1 && mut.spent === mut.capex && mut.spent > 0, JSON.stringify(mut));
ok('one room type per station, and a room needs a free bay',
  mut.built && mut.dupe === 'duplicate' && mut.second === 'nobay', JSON.stringify(mut));

/* ---- 14. a long run with rooms does not throw or drift ---- */
const longRun = run(`(function(){
  S = sanitize(newState('KLNG'));
  S.cash = 500000; S.rep = 50; S.bays = 6;
  const roles = ['dj','eng','sales'];
  for (let i=0;i<12;i++){ const p = makePerson(roles[i%3], 9); p.skill = 9; S.staff.push(p); }
  const parts = ['morning','midday','evening','night'];
  const djs = S.staff.filter(p=>p.role==='dj'), engs = S.staff.filter(p=>p.role==='eng');
  parts.forEach((p,i) => { addDj(0,p,djs[i%djs.length].id); addEngineer(0,p,engs[i%engs.length].id); });
  setSlotShow(0,'evening','news'); setSlotShow(0,'night','talk');
  S.rooms = ['maint','news','library'].map((t,i) => ({
    id:'r'+i, type:t, station:0, staff:[S.staff[(i*2)%S.staff.length].id]
  }));
  let worstDrift = 0, bad = 0;
  for (let d=0; d<540; d++){
    simulateDay();
    worstDrift = Math.max(worstDrift, Math.abs(ledgerDrift()));
    if (!Number.isFinite(S.cash) || !Number.isFinite(S.rep) || S.stations[0].cond < COND_MIN - 1e-9 || S.stations[0].cond > 1 + 1e-9) bad++;
  }
  return { worstDrift, bad, cash: Math.round(S.cash), cond: S.stations[0].cond, rep: Math.round(S.rep) };
})()`);
ok('540 days with five staffed rooms: ledger reconciles, invariants hold',
  longRun.worstDrift < 1e-6 && longRun.bad === 0, JSON.stringify(longRun));

/* Sections 15-19 removed with the Sales Floor.

   They policed the empire-wide -> per-station sales transition: the live cliff,
   the S.salesRoomed latch, the free-room entitlement and the migration that
   granted a Sales Floor per station. Every one of those existed ONLY to manage
   moving sales into a room, and the room was cut after measurement showed it
   structurally negative — never worth building at any seller count, because the
   empire-wide reading stacks sellers geometrically across all stations while a
   per-station room splits the same people up.

   Deleted rather than adapted on purpose: an assertion kept alive against a
   mechanic that no longer exists is how a suite starts lying. Sales is now a
   global, reputation-capped lever with no room, and section 6 below still pins
   the ceiling that actually fixed its dominance. */

/* ---- 20. still inert: nothing above fires without a bay ---- */
const inert2 = run(`(function(){
  S = sanitize(newState('KIN2'));
  for (let i=0;i<2;i++){ const p = makePerson('sales',10); p.skill = 10; S.staff.push(p); }
  S.rep = 88;
  // 'sales' is no longer a room type at all, so this is refused on type before
  // the bay budget is even consulted. Ask for a real room to test the budget.
  const gone = buildRoom(0, 'sales');
  const real = buildRoom(0, 'news');
  return { rooms: S.rooms.length, goneReason: gone.reason, realReason: real.reason,
           mult: +(salesFill() * salesPrice() / 0.5).toFixed(3) };
})()`);
ok('the Sales Floor is gone as a room type',
  inert2.goneReason === 'type', JSON.stringify(inert2));
ok('at bays 0 no room can be built and sales still reads v6',
  inert2.realReason === 'nobay' && inert2.rooms === 0 && inert2.mult > 2.4,
  JSON.stringify(inert2));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall room checks passed');
process.exit(fails ? 1 : 0);
