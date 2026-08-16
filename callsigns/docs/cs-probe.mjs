import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const DIR = '/home/gonzobonzob/projects/my-games/.claude/worktrees/agent-a7b5c654d972dd61c/callsigns';
const store = new Map();
const ctx = {
  console, Math, Date, JSON, Number, String, Array, Object, Set, Map, Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k,v)=>store.set(k,String(v)), removeItem: k=>store.delete(k) },
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {}
};
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['js/content.js','js/sim.js']) vm.runInContext(await readFile(DIR+'/'+f,'utf8'), ctx, { filename:f });
vm.runInContext(`var modalQueue=[];var autoPaused=false;var lastModal=null;function toast(){}function render(){}
function openModal(t){lastModal=t;}function modalPause(){}function dismissAutoModal(){}function closeAllModals(){}
function showScreen(){}function refreshMenu(){}function noteHudDeltas(){}function sfxOnAir(){}function sfxDeadAir(){}
function sfxTrouble(){}function sfxBankrupt(){}function sfxBuy(){}function sfxClick(){}`, ctx);
const run = e => vm.runInContext(e, ctx);
let fails = 0;
const ok = (name, cond, detail) => { if (cond) console.log('  ok  ' + name); else { fails++; console.log('FAIL  ' + name + (detail!==undefined?' — '+detail:'')); } };

/* day one */
// Retry until a fault-free day: an unstaffed, unengineered station rolls
// 4 x BASE_RISK a day (~22%), and a fault multiplies that slot by 0.55.
let d1;
for (let i = 0; i < 60; i++) {
  run(`S = sanitize(newState('KTST')); simulateDay();`);
  d1 = run('JSON.parse(JSON.stringify(S.lastDay))');
  if (d1.faults === 0) break;
}
console.log('day1:', JSON.stringify(d1));
ok('lease charged day one', d1.leases === 60, d1.leases);
ok('day-one gross near DESIGN $60.9', Math.abs(d1.revenue - 60.9) < 3, d1.revenue);
ok('ledger reconciles day one', Math.abs(run('ledgerDrift()')) < 1e-9);

/* v2 -> v3 */
const v2 = { v:2, call:'WOLD', freq:'99.5', day:140, cash:150000, listeners:900, rep:72, buzz:1.1, tx:3, ant:2,
  schedule:{ morning:{show:'news',dj:'pAAA'}, midday:{show:'music',dj:null}, evening:{show:'talk',dj:'pBBB'}, night:{show:'ads',dj:'pAAA'} },
  staff:[{id:'pAAA',name:'Ray Vance',role:'dj',skill:7,salary:55},{id:'pBBB',name:'Dot Okoye',role:'dj',skill:5,salary:43},{id:'pCCC',name:'Ike Kwan',role:'eng',skill:6,salary:63}],
  candidates:[], nextHireDay:143, log:[], unlockedExpansion:true, seenExpansion:true, seenIntro:true,
  secondStation:{call:'KZZZ',foundedDay:120,totalEarned:40000},
  lastDay:{listeners:900,revenue:900,costs:300,net:600,quality:0.9,network:200,royalties:20,repTarget:74},
  opts:{speed:2,autosave:true,eventPopups:false,reducedMotion:false,sound:true},
  stats:{totalEarned:90000,totalCosts:40000,peakListeners:1200,daysOnAir:139}, lastTick:Date.now() };
store.set('callsigns.save', JSON.stringify(v2));
run('S = loadGame()');
ok('v2 save migrates to v3', run('S.v') === 3);
ok('v2 run wraps into stations[0] with gear intact', run('S.stations[0].call')==='WOLD' && run('S.stations[0].tx')===3 && run('S.stations[0].ant')===2);
ok('v2 slot.dj becomes djs:[id]', JSON.stringify(run('S.stations[0].schedule.morning.djs'))==='["pAAA"]');
ok('v2 secondStation becomes a real station on Part 15 gear',
   run('S.stations.length')===2 && run('S.stations[1].call')==='KZZZ' && run('S.stations[1].tx')===0 && run('S.stations[1].ant')===0);
ok('founded station keeps its founding day', run('S.stations[1].foundedDay')===120);
ok('staff stayed global (3 people, no per-station roster)', run('S.staff.length')===3 && run('S.stations[1].staff')===undefined);
ok('opts survive migration', run('S.opts.speed')===2 && run('S.opts.eventPopups')===false);
ok('save omits the legacy scalar mirrors', !('call' in JSON.parse(run('JSON.stringify(S)'))));
ok('legacy view still resolves for the v2 UI', run('S.call')==='WOLD' && run('S.tx')===3 && run('S.schedule.morning.show')==='news');
ok('hasSave() accepts a v3 payload', (run('saveGame(true)'), run('hasSave()')) === true);
ok('saveHeadline() finds the callsign in stations[0]', run('saveHeadline().call') === 'WOLD');

/* hostile input */
const nasty = {
  'prototype pollution': '{"v":3,"__proto__":{"pwned":1},"day":5,"stations":[{"call":"KBAD"}]}',
  'out-of-range scalars': '{"v":3,"day":-99,"cash":-500000,"rep":900,"buzz":-40,"stations":"nope","staff":{},"rivals":{"__proto__":1,"citywide":50}}',
  'junk stations/ghosts': '{"v":3,"day":10,"stations":[null,{"call":"KAAA","tx":99,"ant":-3,"segment":"tv-primetime","schedule":{"morning":{"show":"nope","djs":["ghost","ghost"],"eng":"ghost"}}},{},{},{},{}]}',
  'future version': '{"v":9,"day":1}',
  'not json': 'not json at all'
};
for (const [name, raw] of Object.entries(nasty)) {
  store.set('callsigns.save', raw);
  let res;
  try { res = run(`(function(){ const s = loadGame(); if (!s) return 'refused'; S = s; simulateDay(); return JSON.stringify({day:S.day,cash:S.cash,rep:S.rep,buzz:S.buzz,st:S.stations.length,seg:S.stations[0].segment,pol:({}).pwned===undefined?'clean':'POLLUTED',finite:[S.cash,S.rep,S.buzz,S.listeners].every(Number.isFinite)}); })()`); }
  catch (e) { res = 'THREW ' + e.message; }
  ok('hostile save survives: ' + name, !String(res).startsWith('THREW') && !String(res).includes('POLLUTED') && !String(res).includes('"finite":false'), res);
}

/* invariants */
run(`S = sanitize(newState('KINV')); S.unlockedExpansion = true; S.cash = 2e6;
     foundStation('college'); foundStation('talkband');
     S.staff = [makePerson('eng',50), makePerson('dj',50), makePerson('dj',50)];
     S.staff[0].role='eng'; S.staff[1].role='dj'; S.staff[2].role='dj';`);
const eId = run('S.staff[0].id'), dId = run('S.staff[1].id');
run(`setSlotEngineer(0,'morning','${eId}')`);
const steal = run(`setSlotEngineer(1,'morning','${eId}')`);
ok('one engineer covers one daypart empire-wide', run(`S.stations.filter(s=>s.schedule.morning.eng==='${eId}').length`) === 1);
ok('the steal is reported to the UI', !!steal.stole && steal.stole.call === 'KINV', JSON.stringify(steal));
run(`addDj(0,'morning','${dId}')`); run(`addDj(2,'morning','${dId}')`);
ok('a DJ works one place per daypart', run(`S.stations.filter(s=>s.schedule.morning.djs.indexOf('${dId}')>=0).length`) === 1);
ok('a non-engineer cannot take the eng slot', run(`setSlotEngineer(0,'night','${dId}').ok`) === false);
ok('crew caps at three', run(`(function(){ for (let i=0;i<6;i++) { const p = makePerson('dj',50); p.role='dj'; S.staff.push(p); addDj(0,'night',p.id); } return S.stations[0].schedule.night.djs.length; })()`) === 3);
ok('station cap is 4', run(`(function(){ S.cash=1e9; foundStation('border'); foundStation('border'); return S.stations.length; })()`) === 4);
ok('founding past the cap is refused, not silent', run(`foundStation('border').reason`) === 'cap');
ok('capex lands in the expense total', run(`(function(){ const before=S.stats.totalCosts; S.cash=1e9; S.stations.length=1; const r=foundStation('college'); return S.stats.totalCosts - before === r.cost; })()`) === true);

/* candidate throughput must not scale with stations */
const thru = run(`(function(){
  let a=0,b=0;
  S.stations.length = 1; for (let i=0;i<600;i++){ refreshCandidates(); a+=S.candidates.length; }
  S.cash=1e9; foundStation('college'); foundStation('border'); foundStation('talkband');
  for (let i=0;i<600;i++){ refreshCandidates(); b+=S.candidates.length; }
  return [a/600, b/600];
})()`);
ok('candidate throughput flat in stations.length', Math.abs(thru[0]-thru[1]) < 0.12, thru.join(' vs '));

/* catchUp closes the tab-dodge */
run(`S = sanitize(newState('KOFF')); bookCash(4200,'events'); S.lastDay.net = -50; S.lastTick = Date.now() - 3600e3; catchUp();`);
const lose = { cash: run('S.cash'), off: run('S.book.offline'), drift: run('ledgerDrift()') };
ok('offline losses are applied in full', lose.off === -4800 && lose.cash === 200, JSON.stringify(lose));
ok('offline ledger reconciles', Math.abs(lose.drift) < 1e-9, lose.drift);
run(`S = sanitize(newState('KON')); bookCash(4200,'events'); S.lastDay.net = 50; S.lastTick = Date.now() - 3600e3; catchUp();`);
ok('offline gains still pay half rate', run('S.book.offline') === 2400, run('S.book.offline'));
run(`S = sanitize(newState('KFLR')); S.lastDay.net = -5000; S.lastTick = Date.now() - 3600e3; catchUp();`);
ok('offline losses stop at the bankruptcy floor', run('S.cash') === run('BANKRUPTCY_FLOOR'), run('S.cash'));

/* mechanic 2 against DESIGN's worked example (chem forced neutral) */
run(`S = sanitize(newState('KCHK'));
     S.staff = [{id:'a',name:'A',role:'dj',skill:9,tags:['musical'],salary:salaryFor('dj',9)},
                {id:'b',name:'B',role:'dj',skill:6,tags:['streetwise'],salary:salaryFor('dj',6)}];
     S.stations[0].schedule.morning.djs=['a'];`);
const solo = run('djTerm(S.stations[0].schedule.morning)');
run(`S.stations[0].schedule.morning.djs=['a','b'];`);
const duo = run('djTerm(S.stations[0].schedule.morning)');
const gain = (duo/solo - 1) * 100;
ok('DESIGN: neutral-chem co-host adds +16.4% slot revenue', Math.abs(gain - 16.4) < 0.3, gain.toFixed(2) + '%');
ok('DESIGN: load 1.00 -> 1.45', Math.abs(run('loadFactor(S.stations[0].schedule.morning)') - 1.45) < 1e-9);
ok('DESIGN: fault risk +0.027 on an unengineered slot',
   Math.abs(run('slotRisk(S.stations[0].schedule.morning, segmentOf("citywide"))') - 0.087) < 1e-9);
ok('chem is exactly 1.00 for a solo host', run(`(S.stations[0].schedule.morning.djs=['a'], chem(S.stations[0].schedule.morning))`) === 1);

/* market share: own stations are in the denominator */
run(`S = sanitize(newState('KSHR')); S.cash = 1e9; S.unlockedExpansion = true;`);
const oneShare = run(`marketShare(S.stations[0],'morning').audience`);
run(`foundStation('citywide');`);
const twoShare = run(`marketShare(S.stations[0],'morning').audience`);
ok('a second station in the SAME segment cannibalises the first', twoShare < oneShare, oneShare.toFixed(1)+' -> '+twoShare.toFixed(1));
// The interesting regime: a station that already dominates its pool. At low
// pull the binding constraint is the RIVALS, not the pool, so a second signal
// nearly doubles you — which is exactly why founding early is right and
// founding late into your own segment is wrong.
run(`S = sanitize(newState('KBIG')); S.cash=1e9; S.unlockedExpansion=true; S.rep=95;
     S.stations[0].tx=4; S.stations[0].ant=4;
     S.staff=[{id:'a',name:'A',role:'dj',skill:10,tags:['musical'],salary:99}];
     for (const p of DAYPARTS) S.stations[0].schedule[p.id].djs=['a'];`);
const bigOne = run(`marketShare(S.stations[0],'morning').audience`);
run(`foundStation('citywide'); S.stations[1].tx=4; S.stations[1].ant=4;`);
const bigTwo = run(`marketShare(S.stations[0],'morning').audience + marketShare(S.stations[1],'morning').audience`);
ok('a dominant station gains almost nothing from a second signal in its own pool',
   bigTwo < bigOne * 1.30, bigOne.toFixed(0)+' -> '+bigTwo.toFixed(0));
ok('audience can never exceed the finite pool', bigTwo < run(`segPop(segmentOf('citywide'),'morning')`), bigTwo.toFixed(0));
run(`S = sanitize(newState('KSEG')); S.cash = 1e9; S.unlockedExpansion = true; foundStation('college');`);
const split = run(`marketShare(S.stations[0],'morning').audience + marketShare(S.stations[1],'morning').audience`);
ok('a station in a DIFFERENT segment adds audience instead', split > oneShare, split.toFixed(1));

/* rival response is bounded and never revenue-derived */
const rival0 = run(`(S.rivals.citywide = 0, rivalPull('citywide','morning'))`);
const rival1 = run(`(S.rivals.citywide = 1, rivalPull('citywide','morning'))`);
ok('rival pull responds to share', rival1 > rival0);
ok('rival response is bounded at 1.9x base', rival1 / rival0 <= 1.9001, (rival1/rival0).toFixed(3));
ok('rival pull ignores cash entirely',
   run(`(function(){ S.rivals.citywide=0.4; const a=rivalPull('citywide','morning'); S.cash*=1000; const b=rivalPull('citywide','morning'); return a===b; })()`) === true);

console.log('\n' + (fails ? fails + ' FAILED' : 'all probe checks passed'));
process.exit(fails ? 1 : 0);
