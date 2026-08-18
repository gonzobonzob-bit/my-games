// Callsigns — rooms invariants (v3). Pure sim in a node vm, NO browser, ~1s.
//
// Why this exists next to smoke.mjs and harness.mjs: smoke proves the machine
// runs and harness proves the economy is a game, and NEITHER can see the things
// that would silently break this feature. Two classes in particular:
//
//   THE STRUCTURAL ZEROS. A Production Room earns EXACTLY $0 on a station whose
//   market has no local trade to win; a Rack Room moves condition by EXACTLY
//   0.0000 on a Part 15 rig. "Exactly" is the whole claim — a small number
//   instead of a hard zero means the ceiling is numeric rather than structural,
//   and the decision collapses back into a tuning knob.
//
//   THE CONDITION PROHIBITIONS. No room may add to stationAttn() or cut the base
//   COND_WEAR term. Violating either produces a perfectly healthy-looking game
//   in which idle simply stops dying — the LOSABLE failure that took a full pass
//   to close, and which no other suite here would notice.
//
// It also pins the repair that this whole version exists for: st.localBase is
// rolled at founding and must never be movable by anything the player does.
// Rooms v1 and v2 both failed because a room's ceiling read a choice the player
// had already made; if localBase ever becomes settable, that defect is back.
//
// Run:  node callsigns/tests/rooms.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'js') + '/';
const store = new Map();
const ctx = {
  console, Math, JSON, Date, Object, Array, Number, String, Set, Map, isFinite, parseInt, parseFloat,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k,v)=>store.set(k,String(v)), removeItem: k=>store.delete(k) },
  document: { getElementById: () => null }, window: {},
  setInterval: () => 0, clearInterval: () => {},
  render: () => {}, toast: () => {}, openModal: () => {}, closeAllModals: () => {},
  showScreen: () => {}, refreshMenu: () => {}, noteHudDeltas: () => {},
  sfxOnAir: () => {}, sfxTrouble: () => {}, sfxFault: () => {}, sfxDeadAir: () => {},
  sfxBankrupt: () => {}, sfxBuy: () => {}, modalQueue: [], dismissAutoModal: () => {},
  setPausedUI: () => {}, autoPaused: false, eventVars: () => ({})
};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['content.js', 'sim.js']) vm.runInContext(readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
vm.runInContext('var __n = 0; function mkp(role, skill){ var p = makePerson(role, 5); p.skill = skill; p.id = "x" + (++__n); p.salary = salaryFor(role, skill); return p; }', ctx);
let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log('  ok  ' + name);
  else { fails++; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
};
const run = e => vm.runInContext('(function(){' + e + '})()', ctx);

/* 1. localBase: rolled at founding, in band, stable, never written after */
const lb = run(`
  const out = {};
  const bands = {};
  for (const id of segmentIds()) {
    const r = segLocalRange(id); bands[id] = [r.min, r.max];
    const seen = [];
    for (let i = 0; i < 200; i++) { const st = newStation(undefined, id, 1 + (i % 50)); seen.push(st.localBase); }
    out[id] = { min: Math.min.apply(null, seen), max: Math.max.apply(null, seen),
                inBand: seen.every(v => v >= r.min - 1e-12 && v <= r.max + 1e-12),
                distinct: new Set(seen.map(v => v.toFixed(6))).size };
  }
  // stability: same station, re-sanitized, same number
  S = sanitize(newState('KLOC'));
  const before = S.stations[0].localBase;
  const again = sanitize(JSON.parse(JSON.stringify(S))).stations[0].localBase;
  return { out, bands, stable: before === again, headQuad: headroomOf({segment:'quadrangle', localBase: 0.55}),
           headLedgerFloor: headroomOf({segment:'ledger', localBase: 0.55}) };
`);
ok('localBase rolls inside every segment band', Object.values(lb.out).every(o => o.inBand), JSON.stringify(lb.out));
ok('localBase is not a constant (many distinct values per segment)',
  Object.values(lb.out).every(o => o.distinct > 20), JSON.stringify(Object.entries(lb.out).map(([k,v]) => k+':'+v.distinct)));
ok('localBase is stable across a save/load round trip', lb.stable === true, JSON.stringify(lb.stable));
ok('headroom is a HARD zero at exactly LOCAL_BASE_NOPROD (quadrangle top and ledger floor)',
  lb.headQuad === 0 && lb.headLedgerFloor === 0, JSON.stringify(lb));

/* 2. structural zero: production is EXACTLY $0.00 with no headroom anywhere */
const zeroProd = run(`
  Math.random = () => 1;                       // no faults, no events
  S = sanitize(newState('KZER'));
  S.cash = 500000; S.rep = 60;
  S.stations[0].segment = 'quadrangle'; S.stations[0].localBase = 0.55;
  const dj = mkp('dj', 10); S.staff.push(dj);
  const dj2 = mkp('dj', 10); dj2.skill = 10; S.staff.push(dj2);
  addDj(0, 'morning', dj.id);
  S.bays = 2;
  S.rooms = [{ id:'p', type:'prod', station:0, staff:[dj2.id] }];
  const pts = roomPts(ROOM_PROD);
  const alloc = prodAllotment(staffSlotLoad());
  simulateDay();
  return { pts, allocSize: alloc.size, prodRev: S.lastDay.prodRev, ceiling: roomCeiling(ROOM_PROD),
           headroom: headroomOf(S.stations[0]) };
`);
ok('a Production Room with 10 points on a 0.55 station earns EXACTLY $0.00',
  zeroProd.pts > 5 && zeroProd.prodRev === 0 && zeroProd.allocSize === 0 && zeroProd.ceiling === 0,
  JSON.stringify(zeroProd));

/* 3. structural zero: the Rack Room is 0.0000 condition delta at TX0/ANT0 */
const zeroRack = run(`
  S = sanitize(newState('KRAC'));
  const st = S.stations[0]; st.tx = 0; st.ant = 0;
  const e = mkp('eng', 10); e.skill = 10; S.staff.push(e);
  const e2 = mkp('eng', 10); e2.skill = 10; S.staff.push(e2);
  addEngineer(0, 'morning', e.id);
  const wearBefore = stationWear(st), targetBefore = condTarget(st);
  S.bays = 1; S.rooms = [{ id:'r', type:'rack', station:0, staff:[e2.id] }];
  const wearAfter = stationWear(st), targetAfter = condTarget(st);
  const cut0 = gearCut(), ceiling0 = roomCeiling(ROOM_RACK);
  // and at a real plant it must actually bite
  st.tx = 3; st.ant = 2;
  const bigBefore = COND_WEAR * (1 + WEAR_PER_TX*3 + WEAR_PER_ANT*2);
  return { wearBefore, wearAfter, targetBefore, targetAfter, cut0, ceiling0,
           bigBefore, bigAfter: stationWear(st), cutBig: gearCut(),
           ceilBig: roomCeiling(ROOM_RACK) };
`);
ok('Rack Room condition delta at TX0/ANT0 is EXACTLY 0.0000',
  zeroRack.wearAfter === zeroRack.wearBefore && zeroRack.targetAfter === zeroRack.targetBefore && zeroRack.cut0 === 0,
  JSON.stringify(zeroRack));
ok('the Rack Room does bite at TX3/ANT2 (design proof §5: 0.008125 -> 0.00475)',
  Math.abs(zeroRack.bigBefore - 0.008125) < 1e-9 && Math.abs(zeroRack.bigAfter - 0.00475) < 1e-9,
  JSON.stringify(zeroRack));

/* 4. traffic desk: clearance caps at 0.60, and pays MORE the less you sell */
const traffic = run(`
  Math.random = () => 1;
  const build = (rep) => {
    S = sanitize(newState('KTRF'));
    S.rep = rep; S.cash = 200000;
    const dj = mkp('dj', 8); dj.skill = 8; S.staff.push(dj); addDj(0,'morning',dj.id);
    for (let i=0;i<3;i++){ const p = mkp('sales', 10); p.skill = 10; S.staff.push(p); }
    const seller = mkp('sales', 10); seller.skill = 10; S.staff.push(seller);
    S.bays = 1; S.rooms = [{ id:'t', type:'traffic', station:0, staff:[seller.id] }];
    const rem = remnantClear(staffSlotLoad());
    simulateDay();
    return { rem, fill: salesFill(), remRev: S.lastDay.remRev, rev: S.lastDay.revenue, share: S.lastDay.remRev / S.lastDay.revenue };
  };
  return { weakSales: build(5), strongSales: build(95), cap: REMNANT_CLEAR_MAX / REMNANT_PER_PT };
`);
ok('remnant clearance is capped at 0.60', traffic.weakSales.rem <= 0.6 + 1e-12 && traffic.strongSales.rem <= 0.6 + 1e-12,
  JSON.stringify(traffic));
ok('the Traffic Desk is counter-cyclical: a bigger share of revenue when fill is LOW',
  traffic.weakSales.fill < traffic.strongSales.fill &&
  traffic.weakSales.share > traffic.strongSales.share && traffic.strongSales.share > 0, JSON.stringify(traffic));

/* 5. the revenue line reconciles term by term, and the ledger reconciles daily */
const revLine = run(`
  Math.random = () => 1;
  S = sanitize(newState('KREV'));
  S.cash = 300000; S.rep = 70;
  S.stations[0].segment = 'countyline'; S.stations[0].localBase = 0.90;
  const roles = ['dj','eng','sales'];
  for (let i=0;i<9;i++){ const p = mkp(roles[i%3], 9); p.skill = 9; S.staff.push(p); }
  const djs = S.staff.filter(p=>p.role==='dj'), engs = S.staff.filter(p=>p.role==='eng');
  ['morning','midday','evening','night'].forEach((p,i)=>{ addDj(0,p,djs[i%djs.length].id); addEngineer(0,p,engs[i%engs.length].id); });
  S.bays = 3;
  S.rooms = [{id:'r',type:'rack',station:0,staff:[engs[2].id]},
             {id:'p',type:'prod',station:0,staff:[djs[2].id]},
             {id:'t',type:'traffic',station:0,staff:[S.staff.filter(p=>p.role==='sales')[2].id]}];
  // recompute the day by hand
  const load = staffSlotLoad();
  const fill = salesFill(), price = salesPrice(), repRevMul = 1 + S.rep/140;
  const alloc = prodAllotment(load), rem = remnantClear(load);
  let hand = 0, handProd = 0, handRem = 0;
  for (const part of DAYPARTS) {
    const pulls = new Map();
    for (const st of S.stations) pulls.set(st, slotPull(st, part.id, load));
    for (let i=0;i<S.stations.length;i++){
      const st = S.stations[i], slot = st.schedule[part.id], show = SHOWS[slot.show];
      const aud = shareFrom(st, part.id, pulls).audience;
      const gross = aud * show.adRate * AD_VALUE * price * repRevMul;
      const dL = alloc.get(i + '|' + part.id) || 0;
      hand += gross * (fill * (1 + LOCAL_PREM * dL) + (1 - fill) * rem * REMNANT_RATE);
      handProd += gross * fill * LOCAL_PREM * dL;
      handRem += gross * (1 - fill) * rem * REMNANT_RATE;
    }
  }
  const drifts = [];
  simulateDay();
  const got = S.lastDay;
  for (let d=0; d<300; d++){ simulateDay(); drifts.push(Math.abs(ledgerDrift())); }
  return { hand, rev: got.revenue, handProd, prodRev: got.prodRev, handRem, remRev: got.remRev,
           gearCut: got.gearCut, maxDrift: Math.max.apply(null, drifts), cash: Math.round(S.cash) };
`);
ok('the revenue line matches §3e recomputed by hand',
  Math.abs(revLine.hand - revLine.rev) < 1e-6, JSON.stringify(revLine));
ok('prodRev and remRev are the two room terms of that line',
  Math.abs(revLine.handProd - revLine.prodRev) < 1e-6 && Math.abs(revLine.handRem - revLine.remRev) < 1e-6,
  JSON.stringify(revLine));
ok('the ledger reconciles every day for 300 days with all three rooms live',
  revLine.maxDrift < 1e-6, JSON.stringify(revLine.maxDrift));

/* 6. production allotment: bounded by points AND by headroom, best slot first */
const allot = run(`
  S = sanitize(newState('KALL'));
  S.cash = 1e7; S.rep = 60; S.unlockedExpansion = true;
  foundStation('quadrangle'); foundStation('countyline');
  S.stations[0].localBase = 0.70; S.stations[1].localBase = 0.50; S.stations[2].localBase = 0.95;
  const dj = mkp('dj', 10); S.staff.push(dj);
  S.bays = 2; S.rooms = [{ id:'p', type:'prod', station:0, staff:[dj.id] }];
  const pts = roomPts(ROOM_PROD);
  const alloc = prodAllotment(staffSlotLoad());
  let total = 0; const perSt = {};
  for (const [k,v] of alloc) { total += v; const i = k.split('|')[0]; perSt[i] = (perSt[i]||0) + v; }
  const capOne = roomTypeCap('prod');
  const second = buildRoom(0, 'prod');
  const third = (function(){ S.bays = 4; return buildRoom(0,'prod'); })();
  return { pts, total, budget: PROD_SHARE_PER_PT * pts, perSt,
           quadGot: perSt['1'] || 0, capOne, second: second.ok, third: third.reason || third.ok,
           rooms: roomsOfType('prod').length };
`);
ok('total Δlocal never exceeds the points bought',
  allot.total <= allot.budget + 1e-12, JSON.stringify(allot));
ok('a station below the local floor is never allotted a point', (allot.quadGot || 0) === 0, JSON.stringify(allot));
ok('Production Rooms are capped at stationCount()-1 (5-for-7)',
  allot.capOne === 2 && allot.second === true && allot.third === 'duplicate' && allot.rooms === 2,
  JSON.stringify(allot));

/* 7. one Rack Room, one Traffic Desk, per BUILDING (not per station) */
const perBuilding = run(`
  S = sanitize(newState('KBLD'));
  S.cash = 1e7; S.rep = 60; S.unlockedExpansion = true; S.bays = 6;
  foundStation('countyline');
  const a = buildRoom(0, 'rack'), b = buildRoom(1, 'rack');
  const c = buildRoom(0, 'traffic'), d = buildRoom(1, 'traffic');
  return { a: a.ok, b: b.reason, c: c.ok, d: d.reason, rooms: roomList().length,
           on0: roomsOn(0).length, on1: roomsOn(1).length };
`);
ok('a second Rack Room / Traffic Desk is refused anywhere in the building',
  perBuilding.a && perBuilding.b === 'duplicate' && perBuilding.c && perBuilding.d === 'duplicate',
  JSON.stringify(perBuilding));
ok('every room shows on every station (they are building objects)',
  perBuilding.on0 === 2 && perBuilding.on1 === 2, JSON.stringify(perBuilding));

/* 8. air studios */
const studio = run(`
  S = sanitize(newState('KSTU'));
  S.cash = 100000;
  const a = mkp('dj', 9), b = mkp('dj', 9), c = mkp('dj', 9);
  S.staff.push(a,b,c);
  const r1 = addDj(0,'morning',a.id), r2 = addDj(0,'morning',b.id), r3 = addDj(0,'morning',c.id);
  const cap1 = crewCapOf(S.stations[0]);
  const buy = buyStudio(0);
  const r4 = addDj(0,'morning',c.id);
  const cap2 = crewCapOf(S.stations[0]);
  const again = buyStudio(0);
  // hand-edited save cannot buy a fourth
  S.stations[0].studios = 99;
  const s2 = sanitize(JSON.parse(JSON.stringify(S)));
  return { r1: r1.ok, r2: r2.ok, r3: r3.reason, cap1, buy: buy.ok, cost: buy.cost, capex: S.book.capex,
           r4: r4.ok, cap2, again: again.reason, clamped: s2.stations[0].studios,
           crew: s2.stations[0].schedule.morning.djs.length };
`);
ok('one studio at founding caps a crew at two',
  studio.cap1 === 2 && studio.r1 && studio.r2 && studio.r3 === 'full', JSON.stringify(studio));
ok('the second studio is bought, booked as capex, and lifts the cap to three',
  studio.buy && studio.capex === studio.cost && studio.cost > 0 && studio.r4 && studio.cap2 === 3, JSON.stringify(studio));
ok('there is no third studio, and a hand-edited count is clamped',
  studio.again === 'cap' && studio.clamped === 2 && studio.crew === 3, JSON.stringify(studio));

/* 9. v7 save migration */
const mig = run(`
  S = sanitize(newState('KMIG'));
  const p = mkp('eng', 8); S.staff.push(p);
  S.bays = 4;
  S.rooms = [{ id:'m', type:'maint', station:0, staff:[p.id] },
             { id:'n', type:'news', station:0, staff:[p.id] },
             { id:'l', type:'library', station:0, staff:[] }];
  const raw = JSON.parse(JSON.stringify(S));
  raw.v = 7;
  for (const st of raw.stations) { delete st.localBase; delete st.studios; }
  localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
  const loaded = loadGame();
  return { ver: loaded.v, bays: loaded.bays, types: loaded.rooms.map(r=>r.type),
           seats: loaded.rooms[0] ? loaded.rooms[0].staff.length : 0,
           localBase: loaded.stations[0].localBase, studios: loaded.stations[0].studios };
`);
ok('a v7 save migrates to v9 keeping its bays', mig.ver === 9 && mig.bays === 4, JSON.stringify(mig));
ok('the v7 Maintenance Bay becomes the Rack Room and keeps its seat',
  mig.types.length === 1 && mig.types[0] === 'rack' && mig.seats === 1, JSON.stringify(mig));
ok('the Newsroom and the Record Library are dropped as unknown types',
  mig.types.indexOf('news') < 0 && mig.types.indexOf('library') < 0, JSON.stringify(mig));
ok('every migrated station gets a localBase and one studio',
  mig.localBase > 0 && mig.localBase <= 1 && mig.studios === 1, JSON.stringify(mig));

/* 10. hostile save */
const hostile = run(`
  S = sanitize(newState('KHOS'));
  const p = mkp('dj', 5); S.staff.push(p);
  const raw = JSON.parse(JSON.stringify(S));
  raw.v = 8; raw.bays = 9999;
  raw.stations[0].localBase = 5;      // a ceiling a hand-edit must not be able to raise
  raw.stations[0].studios = 40;
  raw.rooms = [
    { id:'a', type:'rack', station: 0, staff:[p.id, p.id, 'ghost', p.id] },
    { id:'a', type:'rack', station: 0, staff:[] },
    { id:'b', type:'spaceport', station: 0, staff:[] },
    { id:'c', type:'traffic', station: 99, staff:[] },
    { id:'d', type:'green', station: -5, staff:[p.id] },
    { id:'e', type:'news', station: 0, staff:[] },
    { id:'f', type:'library', station: 0, staff:[] },
    { id:'g', type:'sales', station: 0, staff:[] },
    { id:'h', type:'prod', station: 0, staff:[] },
    { id:'i', type:'prod', station: 0, staff:[] },
    'not an object', null
  ];
  localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
  const s = loadGame();
  return { bays: s.bays, types: s.rooms.map(r=>r.type), stations: s.rooms.map(r=>r.station),
           seats: s.rooms[0].staff.length, ids: new Set(s.rooms.map(r=>r.id)).size,
           localBase: s.stations[0].localBase, studios: s.stations[0].studios };
`);
ok('hostile save: bays clamped, unknown and cut types dropped, ids reissued',
  hostile.bays === 6 && hostile.types.join(',') === 'rack,traffic,prod' && hostile.ids === hostile.types.length,
  JSON.stringify(hostile));
ok('hostile save: seats deduped and filtered, station label clamped',
  hostile.seats === 1 && hostile.stations.every(x => x === 0), JSON.stringify(hostile));
ok('hostile save: localBase and studios are clamped, not trusted',
  hostile.localBase <= 1 && hostile.studios === 2, JSON.stringify(hostile));

/* 11. the two prohibitions still hold */
const prohib = run(`
  S = sanitize(newState('KPRO'));
  S.bays = 6;
  S.rooms = [{id:'r',type:'rack',station:0,staff:[]},{id:'p',type:'prod',station:0,staff:[]},
             {id:'t',type:'traffic',station:0,staff:[]}];
  const st = S.stations[0];
  const attn = stationAttn(st);
  let days = 0; while (st.cond > COND_MIN + 1e-9 && days < 2000) { stepCondition(st, 1); days++; }
  // and with them STAFFED, an unattended station still has zero attention
  const e = mkp('eng', 10); S.staff.push(e);
  S.rooms[0].staff = [e.id];
  const attnStaffed = stationAttn(st);
  const wear = stationWear(st);
  return { attn, days, attnStaffed, wear, base: COND_WEAR };
`);
ok('no room adds to stationAttn(), staffed or empty',
  prohib.attn === 0 && prohib.attnStaffed === 0, JSON.stringify(prohib));
ok('no room cuts the base COND_WEAR term: idle still floors in 260 days',
  prohib.days === 260 && prohib.wear === prohib.base, JSON.stringify(prohib));

/* 12. a long run with every room staffed does not throw or drift */
const long = run(`
  S = sanitize(newState('KLNG'));
  S.cash = 500000; S.rep = 50; S.bays = 6; S.unlockedExpansion = true;
  const roles = ['dj','eng','sales'];
  for (let i=0;i<14;i++){ const p = mkp(roles[i%3], 9); p.skill = 9; S.staff.push(p); }
  const parts = ['morning','midday','evening','night'];
  const djs = S.staff.filter(p=>p.role==='dj'), engs = S.staff.filter(p=>p.role==='eng');
  parts.forEach((p,i) => { addDj(0,p,djs[i%djs.length].id); addEngineer(0,p,engs[i%engs.length].id); });
  S.rooms = ['rack','prod','traffic'].map((t,i) => ({ id:'r'+i, type:t, station:0, staff:[S.staff[(i*2)%S.staff.length].id] }));
  let worst = 0, bad = 0;
  for (let d=0; d<540; d++){
    simulateDay();
    worst = Math.max(worst, Math.abs(ledgerDrift()));
    if (!Number.isFinite(S.cash) || !Number.isFinite(S.rep) || !Number.isFinite(S.lastDay.prodRev) ||
        S.stations[0].cond < COND_MIN - 1e-9 || S.stations[0].cond > 1 + 1e-9) bad++;
  }
  return { worst, bad, cash: Math.round(S.cash), rep: Math.round(S.rep), prodRev: S.lastDay.prodRev, remRev: S.lastDay.remRev };
`);
ok('540 days with three staffed rooms: no NaN, invariants in range, ledger reconciles',
  long.worst < 1e-6 && long.bad === 0, JSON.stringify(long));

/* 13. GIVING A BAY BACK.

   The owner found this by playing: the shop sells six bays, and at one station
   only three rooms can ever exist (one rack, one traffic log, max(1, n-1)
   production), so bays 4-6 were $1,640/day of empty space with no undo — the
   only purchase in the game that could not be reversed, while a room has always
   been one click to strip. closeBay() is the remedy, and these are the three
   things about it that could silently rot:

     THE LEASE IS WHAT STOPS, NOT THE CAPEX. If a refund ever appears, holding a
     bay becomes a free option and the whole build-or-wait decision goes away.
     Asserted as an exact equality on cash AND on book.capex, not a range.

     IT ALWAYS SHEDS THE DEAREST RUNG. bayLease is indexed, so closing must drop
     bayLease(bays-1); shedding the cheapest instead would still look like it
     worked on a two-bay building and would quietly under-refund every larger
     one.

     IT NEVER EVICTS A ROOM. A button labelled "give it back" that deletes a
     staffed room is how a save gets lost, so an occupied building refuses. */
const giveBack = run(`
  S = sanitize(newState('KBAY'));
  S.cash = 1e7; S.rep = 60; S.unlockedExpansion = true;
  const capOne = usableRoomCap();
  foundStation('countyline'); foundStation('quadrangle'); foundStation('ledger');
  const capFour = usableRoomCap();
  S.bays = 4; S.rooms = [];
  const leaseBefore = bayLeaseTotal(), dearest = bayLease(3);
  const cashBefore = S.cash, capexBefore = S.book.capex;
  const spareBefore = spareBays();
  const r = closeBay();
  const after = { bays: bayCount(), lease: bayLeaseTotal(), cash: S.cash, capex: S.book.capex };
  // strip to one bay, put a room in it, and the next give-back must refuse
  S.bays = 1; S.rooms = [{ id:'r', type:'rack', station:0, staff:[] }];
  const occupied = closeBay();
  S.rooms = [];
  const emptied = closeBay();
  const none = closeBay();
  const survives = sanitize(JSON.parse(JSON.stringify(S))).bays;
  return { capOne, capFour, maxBays: MAX_BAYS, spareBefore,
           ok: r.ok, saved: r.saved, dearest, leaseBefore, after,
           cashBefore, capexBefore, occupied: occupied.reason, emptied: emptied.ok,
           none: none.reason, survives };
`);
ok('the sixth bay can never hold a room: the cap is 3 at one station and 5 at four',
  giveBack.capOne === 3 && giveBack.capFour === 5 && giveBack.maxBays === 6, JSON.stringify(giveBack));
ok('closing sheds the DEAREST rung and stops exactly that much lease',
  giveBack.ok && giveBack.saved === giveBack.dearest && giveBack.after.bays === 3 &&
  Math.abs(giveBack.leaseBefore - giveBack.after.lease - giveBack.dearest) < 1e-9, JSON.stringify(giveBack));
ok('no cash refund and no capex reversal — the buildout stays spent',
  giveBack.after.cash === giveBack.cashBefore && giveBack.after.capex === giveBack.capexBefore,
  JSON.stringify(giveBack));
ok('an occupied building refuses; emptying it lets the bay go; an empty programme refuses',
  giveBack.occupied === 'occupied' && giveBack.emptied === true && giveBack.none === 'none',
  JSON.stringify(giveBack));
ok('the closed bay does not come back through sanitize()',
  giveBack.survives === 0, JSON.stringify(giveBack));

/* 14. sanitize() TERMINATES when the RNG stops varying.

   Found by section 13 hanging: the duplicate-callsign repair was `while
   (usedCalls.has(st.call)) st.call = randomCall()` with no guard, directly
   above a dial-position loop that has one. Every line of this file after
   section 2 runs with Math.random pinned to 1, so randomCall() returns the
   same four letters forever and loading a save with two identical callsigns
   never returns — no error, no frame, no way to tell it from a crash.

   In play four stations against 2x26^3 callsigns make the collision path
   effectively unreachable, which is exactly why it survived: the failure needs
   a degenerate RNG, and a suite is where degenerate RNGs live. The assertion
   is that the repair still produces DISTINCT calls under one. */
const dupCalls = run(`
  S = sanitize(newState('KDUP'));
  S.cash = 1e7; S.rep = 60; S.unlockedExpansion = true;
  foundStation('countyline'); foundStation('quadrangle');
  const raw = JSON.parse(JSON.stringify(S));
  raw.stations.forEach(st => { st.call = 'KDUP'; st.freq = '95.5'; });
  const s = sanitize(raw);
  const calls = s.stations.map(st => st.call), freqs = s.stations.map(st => st.freq);
  return { n: s.stations.length, calls, freqs,
           uniqueCalls: new Set(calls).size, uniqueFreqs: new Set(freqs).size };
`);
ok('three identical callsigns are repaired to three distinct ones under a frozen RNG',
  dupCalls.n === 3 && dupCalls.uniqueCalls === 3, JSON.stringify(dupCalls));

/* THE BAY IS A FIELD, NOT A POSITION.

   For eight versions a room's bay was its index in S.rooms. The picker took the
   floor the player tapped, printed its number and its lease in its own heading,
   and then dropped it: buildRoom() pushed onto the end. Tap floor 3's "+", read
   "Bay 3 — $180/day", get a room in bay 1 at $40/day — and the picker's own
   profit verdict, computed against the $180 lease, flipped sign on the way.

   It survived because a list has no floors. The cutaway made bays literal and
   the defect became a building that visibly rearranged itself, which is what
   finally paid for the field. These four assertions are what stop it coming
   back, and they are written against the three ways it actually showed up. */
const bayId = run(`
  S = sanitize(newState('KBAY'));
  S.cash = 1e7; S.bays = 4;
  // Ask for the TOP floor first, from an empty building. Under the old rule
  // this landed in bay 0 no matter what was asked for.
  const far = buildRoom(0, 'production', 3);
  const rack = buildRoom(0, 'rack', 1);
  return { farOk: !!(far && far.ok), farBay: far && far.ok ? roomBay(far.room) : null,
           rackBay: rack && rack.ok ? roomBay(rack.room) : null,
           topIsProd: (roomAtBay(3) || {}).type === 'prod',
           atThree: !!roomAtBay(3), atZero: !!roomAtBay(0), free: firstFreeBay() };
`);
ok('a room lands on the floor that was asked for, not the end of the list',
  bayId.farOk && bayId.farBay === 3 && bayId.rackBay === 1 && bayId.topIsProd,
  JSON.stringify(bayId));
ok('an unasked-for build takes the lowest free bay, and the asked-for ones are not disturbed',
  bayId.atThree && !bayId.atZero && bayId.free === 0, JSON.stringify(bayId));

const bayTaken = run(`
  S = sanitize(newState('KBAY'));
  S.cash = 1e7; S.bays = 3;
  buildRoom(0, 'rack', 1);
  // An occupied floor and a floor outside the programme are both refusals, not
  // silent rehousings — being quietly moved elsewhere IS the original defect.
  const onTop = buildRoom(0, 'traffic', 1);
  const offEnd = buildRoom(0, 'traffic', 9);
  return { onTop: onTop && onTop.reason, offEnd: offEnd && offEnd.reason,
           rooms: roomList().length };
`);
ok('a taken bay and an out-of-programme bay are both refused, and neither builds anything',
  bayTaken.onTop === 'bayfull' && bayTaken.offEnd === 'bayfull' && bayTaken.rooms === 1,
  JSON.stringify(bayTaken));

const bayHold = run(`
  S = sanitize(newState('KBAY'));
  S.cash = 1e7; S.bays = 4;
  buildRoom(0, 'rack', 0);
  const keep = buildRoom(0, 'traffic', 3);
  // Removing the room BELOW used to shift this one down a storey, because the
  // splice moved it up the array. Its floor is its own now.
  removeRoom(roomList().find(r => r.type === 'rack').id);
  const after = roomList()[0];
  return { bay: after ? roomBay(after) : null, type: after ? after.type : null,
           n: roomList().length };
`);
ok('removing the room below does not move the room above: a splice is not a move',
  bayHold.bay === 3 && bayHold.type === 'traffic' && bayHold.n === 1, JSON.stringify(bayHold));

/* THE MIGRATION, and the reason it is two passes. A save written before the
   field has no `bay` anywhere, and its rooms must load onto exactly the floors
   they were drawn on yesterday — which, under the old rule, means their list
   order. A save that HAS the field keeps it, except where two rooms claim one
   floor: stacking them would hide one room and its bill entirely. */
const bayMig = run(`
  S = sanitize(newState('KBAY'));
  S.cash = 1e7; S.bays = 3;
  const raw = JSON.parse(JSON.stringify(sanitize(newState('KBAY'))));
  raw.bays = 3;
  raw.rooms = [{ id: 'a', type: 'rack', station: 0, staff: [] },
               { id: 'b', type: 'traffic', station: 0, staff: [] },
               { id: 'c', type: 'production', station: 0, staff: [] }];
  const old = sanitize(raw).rooms.map(r => [r.type, r.bay]);
  raw.rooms = [{ id: 'a', type: 'rack', station: 0, staff: [], bay: 2 },
               { id: 'b', type: 'traffic', station: 0, staff: [], bay: 2 },
               { id: 'c', type: 'production', station: 0, staff: [], bay: 0 }];
  const clash = sanitize(raw).rooms.map(r => [r.type, r.bay]);
  return { old, clash, oldUnique: new Set(old.map(x => x[1])).size,
           clashUnique: new Set(clash.map(x => x[1])).size };
`);
ok('a pre-bay save loads onto its old floors: list order IS what its bays were',
  JSON.stringify(bayMig.old) === JSON.stringify([['rack',0],['traffic',1],['prod',2]]),
  JSON.stringify(bayMig.old));
ok('two rooms cannot claim one floor: the duplicate is rehoused, never stacked',
  bayMig.clashUnique === 3 && bayMig.clash[0][1] === 2 && bayMig.clash[2][1] === 0,
  JSON.stringify(bayMig.clash));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall v3 checks passed');
process.exit(fails ? 1 : 0);
