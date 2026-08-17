// Callsigns — regression net for the four defects qa-adversary found in rooms v3.
// Pure sim, no browser, ~1s. Each of these was a WRONG ANSWER or a free ride
// rather than a crash, which is the class a green suite does not notice.
//
//   1. roomCeiling(prod) was short by DAYPARTS.length, so the UI struck through
//      points that were still earning and told the player to dismantle the room.
//   2. A save declaring bays:0 kept three working rooms and paid no lease.
//   3. A save-supplied staff id reached HTML attributes unescaped; a working
//      `" onmouseover="` payload was landed through it.
//   4. buyStudio(99) clamped and silently upgraded a different station.
//
// Run:  node callsigns/tests/qafix.mjs
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'js') + '/';
const store=new Map();
const ctx={console,Math,JSON,Date,Object,Array,Number,String,Set,Map,isFinite,parseInt,parseFloat,
 localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
 document:{getElementById:()=>null},window:{},setInterval:()=>0,clearInterval:()=>{},
 render:()=>{},toast:()=>{},openModal:()=>{},closeAllModals:()=>{},showScreen:()=>{},refreshMenu:()=>{},
 noteHudDeltas:()=>{},sfxOnAir:()=>{},sfxTrouble:()=>{},sfxFault:()=>{},sfxDeadAir:()=>{},sfxBankrupt:()=>{},
 sfxBuy:()=>{},modalQueue:[],dismissAutoModal:()=>{},setPausedUI:()=>{},autoPaused:false,eventVars:()=>({})};
ctx.globalThis=ctx; vm.createContext(ctx);
for(const f of ['content.js','sim.js']) vm.runInContext(readFileSync(DIR+f,'utf8'),ctx,{filename:f});
const run=e=>vm.runInContext(e,ctx);
let bad=0; const ok=(n,c,d)=>{ if(c) console.log('  ok  '+n); else { bad++; console.log('FAIL  '+n+(d!==undefined?' — '+d:'')); } };

// 1. the ceiling now matches where allotment actually saturates
run(`S = sanitize(newState('KFIX')); S.cash=5e5; S.rep=60; S.unlockedExpansion=true;
  const segs=segmentIds(); for(let i=1;i<4;i++) foundStation(segs[i]);
  for(let i=0;i<16;i++){ const p=makePerson('dj',9); p.skill=9; S.staff.push(p); }
  const djs=S.staff.filter(p=>p.role==='dj');
  S.stations.forEach((st,i)=>DAYPARTS.forEach((pt,k)=>addDj(i,pt.id,djs[(i*4+k)%djs.length].id)));
  S.bays=3; buildRoom(0,'prod');`);
/* The precise claim, rather than a granular walk: at the PUBLISHED ceiling the
   allotment should be fully spent — total allotted local share equal to the
   group's headroom. Stepping the pool one whole person at a time (7.65 pts)
   can only bracket the saturation point, which is why an earlier version of
   this check reported a 1.41 ratio against a fix that was correct. */
const ceil = run(`+roomCeiling(ROOM_PROD).toFixed(3)`);
const head = run(`+S.stations.reduce((a,st)=>a+headroomOf(st),0).toFixed(4)`);
const spent = run(`(function(){
  const room = roomList()[0];
  // Seat enough points to reach the published ceiling exactly.
  while (roomPts(ROOM_PROD) < roomCeiling(ROOM_PROD)) {
    const p = makePerson('dj',9); p.skill=9; S.staff.push(p);
    if (room.staff.length < 3) seatInRoom(room.id, p.id); else room.staff.push(p.id);
  }
  let tot = 0; for (const v of prodAllotment().values()) tot += v;
  return +tot.toFixed(4);
})()`);
/* Allotment is spent PER SLOT and groupHeadroom() sums PER STATION, so a fully
   spent pool totals DAYPARTS.length x groupHeadroom. That factor is exactly the
   bug being fixed, and I wrote it into this assertion twice before noticing —
   which is a fair demonstration of why the original was easy to ship. */
const slotsPerStation = run(`DAYPARTS.length`);
const target = +(head * slotsPerStation).toFixed(4);
console.log('  ceiling', ceil, ' headroom', head, 'x', slotsPerStation, 'dayparts =', target,
            ' allotted at ceiling', spent);
ok('at the published ceiling the allotment is fully spent',
  Math.abs(spent - target) < 1e-3, 'allotted ' + spent + ' of ' + target);

// 2. a save claiming bays 0 with rooms must pay for them
const bays = run(`(function(){
  S = sanitize(newState('KBAY')); S.cash=3e5; S.rep=40; S.bays=3;
  buildRoom(0,'rack'); buildRoom(0,'prod'); buildRoom(0,'traffic');
  const raw = JSON.parse(JSON.stringify(S)); raw.bays = 0;
  localStorage.setItem(SAVE_KEY, JSON.stringify(raw)); S = loadGame();
  return JSON.stringify({ rooms:S.rooms.length, bays:S.bays, lease:+bayLeaseTotal().toFixed(2) }); })()`);
const b=JSON.parse(bays);
console.log('  after a bays:0 save →', bays);
ok('rooms that survive a hand-edit are billed for', b.rooms > 0 && b.bays >= b.rooms && b.lease > 0, bays);

// 3. an attribute-breaking id cannot survive load
const xss = run(`(function(){
  S = sanitize(newState('KXSS'));
  const p = makePerson('dj', 5); p.id = 'x" onmouseover="alert(1)'; S.staff.push(p);
  const raw = JSON.parse(JSON.stringify(S));
  localStorage.setItem(SAVE_KEY, JSON.stringify(raw)); S = loadGame();
  return JSON.stringify(S.staff.map(q=>q.id)); })()`);
console.log('  ids after load:', xss);
// Test the ID VALUE, not the JSON envelope — the envelope has its own quotes,
// which is how this assertion failed against a fix that worked.
const ids = JSON.parse(xss);
ok('a quote-bearing id cannot survive load',
  ids.length === 1 && /^[A-Za-z0-9_-]+$/.test(ids[0]) && !/["'<>=]/.test(ids[0]), xss);

// 4. buyStudio refuses an out-of-range station
run(`S = sanitize(newState('KSTU')); S.cash = 5e5;`);
const st = run(`JSON.stringify({ far: buyStudio(99), studios: studiosOn(S.stations[0]) })`);
console.log('  buyStudio(99) →', st);
ok('buyStudio refuses an out-of-range index instead of clamping', /"reason":"station"/.test(st), st);
console.log(bad? '\n'+bad+' FAILED' : '\nall four QA findings fixed');
process.exit(bad?1:0);
