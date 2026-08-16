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
  S.rooms = [{id:'a',type:'maint',station:0,staff:[]},{id:'b',type:'green',station:0,staff:[]},
             {id:'c',type:'news',station:0,staff:[]},{id:'d',type:'library',station:0,staff:[]},
             {id:'e',type:'sales',station:0,staff:[]}];
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
    news: newsMul(S.stations[0]), royalty: royaltyCut(S.stations[0]),
    bayLease: bayLeaseTotal(), leases: totalLeases(), lease0: leaseFor(S.stations[0]),
    load: JSON.stringify(staffSlotLoad())
  };
})()`);
ok('sales reads exactly v6 at bays 0', Math.abs(inert.fill - inert.legacyFill) < 1e-12 && inert.price > 1, JSON.stringify(inert));
ok('fatigue coefficient is 0.18 at bays 0', Math.abs(inert.fatigue - inert.legacyFatigue) < 1e-12, JSON.stringify(inert));
ok('newsMul 1.00 / royaltyCut 0 / bay lease $0 at bays 0',
  inert.news === 1 && inert.royalty === 0 && inert.bayLease === 0 && inert.leases === inert.lease0, JSON.stringify(inert));

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
  const p = makePerson('sales', 9); p.skill = 9; S.staff.push(p);
  S.bays = 1; S.rooms = [{ id:'s', type:'sales', station:0, staff:[p.id] }];
  const solo = roomPower(S.rooms[0]);
  S.stations[0].schedule.morning.djs = [];
  const d = makePerson('dj', 9); d.skill = 9; S.staff.push(d);
  S.rooms[0].staff = [p.id, d.id];
  const pair = roomPower(S.rooms[0]);
  // now double-book the seller onto two slots -> load 3
  S.rooms[0].staff = [p.id];
  S.stations[0].schedule.morning.djs = [];
  S.staff.find(x=>x.id===p.id);
  S.stations[0].schedule.evening.djs = [];
  // seat them in a second room instead (load 2)
  S.rooms.push({ id:'s2', type:'green', station:0, staff:[p.id] });
  const diluted = roomPower(S.rooms[0]);
  return { solo, pair, diluted, fitSales: roomFit('sales','sales'), fitDj: roomFit('sales','dj') };
})()`);
ok('roomPower = fit x skill for one full-time person', Math.abs(power.solo - 9) < 1e-12, JSON.stringify(power));
ok('a DJ in the sales floor is priced by ROLE FIT, not by skill rank',
  Math.abs(power.pair - (9 + 0.55*9)) < 1e-12, JSON.stringify(power));
ok('a second seat halves what someone brings to the first', Math.abs(power.diluted - 4.5) < 1e-12, JSON.stringify(power));

/* ---- 6. ceilings: points above the cap are worth exactly zero ---- */
const ceil = run(`(function(){
  S = sanitize(newState('KCAP'));
  S.rep = 38;
  S.bays = 1; S.rooms = [{ id:'s', type:'sales', station:0, staff:[] }];
  const seat = n => {
    S.staff = []; S.rooms[0].staff = [];
    for (let i=0;i<n;i++){ const p = makePerson('sales',10); p.skill=10; S.staff.push(p); S.rooms[0].staff.push(p.id); }
    return { fill: salesFill(S.stations[0]), price: salesPrice(S.stations[0]),
             wasted: salesWasted(S.stations[0]), power: roomPower(S.rooms[0]), ceiling: roomCeiling(S.rooms[0]) };
  };
  return { one: seat(1), three: seat(3), fillCap: fillCap(), priceCap: priceCap() };
})()`);
ok('sales points above the reputation ceiling buy nothing',
  ceil.three.fill === ceil.one.fill && ceil.three.price === ceil.one.price && ceil.three.wasted > ceil.one.wasted,
  JSON.stringify(ceil));
ok('the ceiling is the rep-set one', Math.abs(ceil.one.ceiling - Math.max((ceil.fillCap-0.5)/0.04,(ceil.priceCap-1)/0.03)) < 1e-9, JSON.stringify(ceil));

/* ---- 7. newsroom / library disjoint supports ---- */
const disjoint = run(`(function(){
  const build = (shows, type) => {
    S = sanitize(newState('KDIS'));
    const parts = ['morning','midday','evening','night'];
    parts.forEach((p,i) => setSlotShow(0, p, shows[i]));
    const st = S.stations[0];
    const base = { pull: slotPull(st,'morning'), roy: null };
    const d0 = simulateDayRoyalty();
    S.bays = 1;
    const p = makePerson('dj', 9); p.skill = 9; S.staff.push(p);
    S.rooms = [{ id:'x', type, station:0, staff:[p.id] }];
    return { pullBefore: base.pull, pullAfter: slotPull(st,'morning'), royBefore: d0, royAfter: simulateDayRoyalty() };
  };
  function simulateDayRoyalty(){
    const st = S.stations[0];
    let music = 0; for (const p of DAYPARTS) if (st.schedule[p.id].show === 'music') music++;
    return 1000 * ROYALTY_RATE * (music/DAYPARTS.length) * (1 - royaltyCut(st));
  }
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
ok('a Record Library on an all-talk station is worth exactly zero royalty',
  disjoint.libOnTalk.royAfter === disjoint.libOnTalk.royBefore && disjoint.libOnTalk.royAfter === 0,
  JSON.stringify(disjoint.libOnTalk));
ok('a Record Library on an all-music station cuts royalties',
  disjoint.libOnMusic.royAfter < disjoint.libOnMusic.royBefore, JSON.stringify(disjoint.libOnMusic));

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
ok('a v6 save with sellers is granted a free Sales Floor, seats capped at 3',
  mig.rooms === 1 && mig.type === 'sales' && mig.seats === 3, JSON.stringify(mig));
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
    { id:'a', type:'sales', station: 0, staff:[p.id, p.id, 'ghost', 'ghost2', p.id] },
    { id:'a', type:'sales', station: 0, staff:[] },              // duplicate id AND duplicate type
    { id:'b', type:'spaceport', station: 0, staff:[] },          // unknown type
    { id:'c', type:'maint', station: 99, staff:[] },             // station out of range
    { id:'d', type:'green', station: -5, staff:[p.id] },
    { id:'e', type:'news', station: 0, staff:[] },
    { id:'f', type:'library', station: 0, staff:[] },
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
ok('room.station is clamped into the station array', hostile.stations.every(x => x === 0), JSON.stringify(hostile));
ok('seats are deduped, capped and filtered to the roster', hostile.firstSeats.length === 1, JSON.stringify(hostile));
ok('duplicate room ids are re-issued', new Set(hostile.ids).size === hostile.ids.length, JSON.stringify(hostile));
ok('one room type per station survives', new Set(hostile.types).size === hostile.types.length, JSON.stringify(hostile));

/* ---- 11. firing scrubs room seats ---- */
const fired = run(`(function(){
  S = sanitize(newState('KFIR'));
  const p = makePerson('sales', 9); S.staff.push(p);
  S.bays = 1; S.rooms = [{ id:'s', type:'sales', station:0, staff:[p.id] }];
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
  S.bays = 4; S.rooms = [{ id:'s', type:'sales', station:0, staff:[] }];
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
  const noBayLeft = buildRoom(0, 'sales');   // 1 bay, 0 rooms -> should be ok
  const dupe = buildRoom(0, 'sales');
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
  S.rooms = ['sales','maint','green','news','library'].map((t,i) => ({
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

/* ---- 15. the live sales transition: no cliff on the other stations ---- */
const setUpEmpire = `
  S = sanitize(newState('KTRN'));
  S.cash = 5e6; S.rep = 88; S.unlockedExpansion = true;
  const segs = segmentIds();
  for (let i = 1; i < 4; i++) { const r = foundStation(segs[i % segs.length]); if (!r.ok) throw new Error('found failed: ' + r.reason); }
  for (let i=0;i<2;i++){ const p = makePerson('sales',10); p.skill = 10; S.staff.push(p); }
  S.bays = 2;
`;
const trans = run(`(function(){
  ${setUpEmpire}
  const read = () => S.stations.map(st => +(salesFill(st) * salesPrice(st) / 0.5).toFixed(3));
  const before = read();
  const built = buildRoom(0, 'sales');
  const after = read();
  return { before, after, built: built.ok, rooms: S.rooms.length,
           free: S.rooms.map(r => !!r.free), seats: S.rooms.map(r => r.staff.length),
           latch: S.salesRoomed, bays: S.bays, paid: paidRoomCount() };
})()`);
ok('before the transition every station reads the v6 multiplier',
  trans.before.every(x => x === trans.before[0] && x > 2.4), JSON.stringify(trans.before));
// Two sellers cannot staff four sales floors — that is the per-station
// mechanic, not the transition. What the transition must guarantee is that
// every seller the player employs keeps working at FULL strength (load 1,
// under the ceiling) and that no station the sellers reach is cliffed.
ok('every station a seller reaches keeps ~93% of the v6 multiplier',
  trans.after.filter(x => x >= trans.before[0] * 0.85).length === 2, JSON.stringify(trans));

// The integrator's case: sellers >= stations. Nobody is cliffed at all.
const transFull = run(`(function(){
  ${setUpEmpire}
  for (let i=0;i<2;i++){ const p = makePerson('sales',10); p.skill = 10; S.staff.push(p); }
  const read = () => S.stations.map(st => +(salesFill(st) * salesPrice(st) / 0.5).toFixed(3));
  const before = read();
  buildRoom(0, 'sales');
  return { before, after: read(), seats: S.rooms.map(r => r.staff.length) };
})()`);
ok('with a seller per station, the transition costs ~7% and nothing cliffs',
  transFull.after.every(x => x >= transFull.before[0] * 0.85) &&
  transFull.seats.every(n => n === 1), JSON.stringify(transFull));
ok('every station is granted a Sales Floor, only the bought one is paid',
  trans.rooms === 4 && trans.paid === 1 && trans.free.filter(Boolean).length === 3, JSON.stringify(trans));
ok('the two sellers are spread one per station, not stacked',
  trans.seats.filter(n => n === 1).length === 2 && trans.seats.filter(n => n > 1).length === 0, JSON.stringify(trans));
ok('the transition latches', trans.latch === true, JSON.stringify(trans));

/* ---- 16. grandfathered rooms do not eat bay budget ---- */
const budget = run(`(function(){
  ${setUpEmpire}
  buildRoom(0, 'sales');            // 1 paid + 3 free
  const second = buildRoom(1, 'maint');   // 2 bays, 1 paid so far -> must be allowed
  const third  = buildRoom(2, 'news');    // no bay left
  return { second: second.ok, third: third.reason, paid: paidRoomCount(), bays: S.bays, rooms: S.rooms.length };
})()`);
ok('a free Sales Floor does not consume a bay the player bought',
  budget.second === true && budget.third === 'nobay' && budget.paid === 2, JSON.stringify(budget));

/* ---- 17. the reverse cliff / delete-the-room exploit ---- */
const reverse = run(`(function(){
  ${setUpEmpire}
  buildRoom(0, 'sales');
  const withRooms = S.stations.map(st => +(salesFill(st) * salesPrice(st) / 0.5).toFixed(3));
  for (const r of S.rooms.slice()) removeRoom(r.id);
  const afterDelete = S.stations.map(st => +(salesFill(st) * salesPrice(st) / 0.5).toFixed(3));
  const rebuilt = buildRoom(0, 'sales');
  return { withRooms, afterDelete, latch: S.salesRoomed, rebuiltOk: rebuilt.ok,
           rebuiltFree: rebuilt.room && rebuilt.room.free, paid: paidRoomCount() };
})()`);
ok('deleting every Sales Floor does NOT restore the v6 empire-wide multiplier',
  reverse.afterDelete.every(x => x === 1) && reverse.latch === true, JSON.stringify(reverse));
ok('a deleted Sales Floor can be rebuilt free, so removal is symmetric',
  reverse.rebuiltOk && reverse.rebuiltFree === true && reverse.paid === 0, JSON.stringify(reverse));

/* ---- 18. migration grants one per station and spreads the sellers ---- */
const mig2 = run(`(function(){
  S = sanitize(newState('KMG2'));
  S.cash = 5e6; S.rep = 88; S.unlockedExpansion = true;
  const segs = segmentIds();
  for (let i = 1; i < 4; i++) { const r = foundStation(segs[i % segs.length]); if (!r.ok) throw new Error('found failed: ' + r.reason); }
  for (let i=0;i<2;i++){ const p = makePerson('sales',10); p.skill = 10; S.staff.push(p); }
  const before = S.stations.map(st => +(salesFill(st) * salesPrice(st) / 0.5).toFixed(3));
  const raw = JSON.parse(JSON.stringify(S)); raw.v = 6;
  delete raw.bays; delete raw.rooms; delete raw.salesRoomed;
  localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
  S = loadGame();
  const after = S.stations.map(st => +(salesFill(st) * salesPrice(st) / 0.5).toFixed(3));
  return { before, after, rooms: S.rooms.length, free: S.rooms.every(r => r.free),
           seats: S.rooms.map(r => r.staff.length), bays: S.bays, latch: S.salesRoomed };
})()`);
ok('a v6 empire migrates to one free Sales Floor per station',
  mig2.rooms === 4 && mig2.free === true && mig2.bays === 0 && mig2.latch === true, JSON.stringify(mig2));
ok('migration keeps the multiplier within ~15% on the stations that get a seller',
  mig2.after.filter(x => x >= mig2.before[0] * 0.85).length === 2, JSON.stringify(mig2));

/* ---- 19. a hand-edited save cannot grant itself free bays ---- */
const freeCheat = run(`(function(){
  S = sanitize(newState('KCHT'));
  const raw = JSON.parse(JSON.stringify(S));
  raw.v = 7; raw.bays = 0; raw.salesRoomed = false;
  raw.rooms = [
    { id:'n1', type:'news', station:0, staff:[], free:true },
    { id:'n2', type:'maint', station:0, staff:[], free:true },
    { id:'n3', type:'sales', station:0, staff:[], free:true }
  ];
  localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
  S = loadGame();
  return { free: S.rooms.map(r => r.type + ':' + !!r.free), paid: paidRoomCount(), latch: S.salesRoomed };
})()`);
ok('only a Sales Floor may be free; other rooms stay paid and bounded by bays',
  freeCheat.free.indexOf('news:true') < 0 && freeCheat.free.indexOf('maint:true') < 0 &&
  freeCheat.free.indexOf('sales:true') >= 0 && freeCheat.paid === 2, JSON.stringify(freeCheat));
ok('a save that keeps rooms but clears the latch cannot double-dip', freeCheat.latch === true, JSON.stringify(freeCheat));

/* ---- 20. still inert: nothing above fires without a bay ---- */
const inert2 = run(`(function(){
  S = sanitize(newState('KIN2'));
  for (let i=0;i<2;i++){ const p = makePerson('sales',10); p.skill = 10; S.staff.push(p); }
  S.rep = 88;
  const build = buildRoom(0, 'sales');
  return { latch: S.salesRoomed, rooms: S.rooms.length, reason: build.reason,
           mult: +(salesFill() * salesPrice() / 0.5).toFixed(3) };
})()`);
ok('at bays 0 no room can be built and sales still reads v6',
  inert2.reason === 'nobay' && inert2.rooms === 0 && inert2.latch === false && inert2.mult > 2.4,
  JSON.stringify(inert2));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall room checks passed');
process.exit(fails ? 1 : 0);
