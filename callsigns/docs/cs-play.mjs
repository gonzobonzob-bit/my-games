// Scratch: competent autoplayer over the REAL tick-level sim, several policies,
// N seeds, to see whether the empire arc is reachable and whether policies spread.
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
ctx.globalThis = ctx;
vm.createContext(ctx);
const STUB = `var modalQueue=[];var autoPaused=false;function toast(){}function render(){}var lastModal=null;function openModal(t){lastModal=t;}
function modalPause(){}function dismissAutoModal(){}function closeAllModals(){}function showScreen(){}
function refreshMenu(){}function noteHudDeltas(){}function sfxOnAir(){}function sfxDeadAir(){}
function sfxTrouble(){}function sfxBankrupt(){}function sfxBuy(){}function sfxClick(){}`;
for (const f of ['js/content.js','js/sim.js']) vm.runInContext(await readFile(DIR+'/'+f,'utf8'), ctx, { filename: f });
vm.runInContext(STUB, ctx, { filename:'stub.js' });

// Seeded RNG so runs are comparable
let seed = 1;
ctx.Math = Object.create(Math);
ctx.Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
vm.runInContext(`Math = globalThis.Math;`, ctx);

const AUTOPLAY = `
function autoDay(policy){
  // 1. hire: always take a DJ we can afford early; later fill eng and sales.
  for (const c of S.candidates.slice()) {
    const fee = hireFee(c);
    const djs = staffOf('dj').length, engs = staffOf('eng').length, sales = staffOf('sales').length;
    const slots = S.stations.length * 4;
    let want = false;
    if (c.role === 'dj')    want = djs < slots;
    if (c.role === 'eng')   want = engs < Math.min(2, S.stations.length + 1);
    if (c.role === 'sales') want = sales < 3;
    const reserve = c.role === 'dj' && djs === 0 ? 120 : Math.max(400, payrollTotal() * 6 + totalLeases() * 6);
    if (want && S.cash - fee > reserve) { S.cash -= fee; S.staff.push(c); S.candidates = S.candidates.filter(x=>x.id!==c.id); }
  }
  // 2. schedule policy
  for (const st of S.stations) {
    for (const p of DAYPARTS) st.schedule[p.id].show = policy.shows[p.id];
  }
  // 3. crews: best DJs to the heaviest pools first, one each, then co-hosts.
  const djs = staffOf('dj').slice().sort((a,b)=>b.skill-a.skill);
  for (const st of S.stations) for (const p of DAYPARTS) { st.schedule[p.id].djs = []; st.schedule[p.id].eng = null; }
  const order = [];
  for (const p of ['morning','evening','midday','night']) for (let si=0; si<S.stations.length; si++) order.push([si,p]);
  let i = 0;
  for (const [si,p] of order) { if (i < djs.length) { addDj(si,p,djs[i].id); i++; } }
  // co-hosts only on slots worth it (policy.cohost = revenue threshold proxy)
  if (policy.cohost) { for (const [si,p] of order) { if (i < djs.length) { addDj(si,p,djs[i].id); i++; } } }
  // 4. engineer: put them where load is highest
  const engs = staffOf('eng').slice().sort((a,b)=>b.skill-a.skill);
  if (engs.length) {
    const cand = uncoveredSlots();
    for (let e=0; e<engs.length && e<cand.length; e++) setSlotEngineer(cand[e].station, cand[e].part, engs[e].id);
  }
  // 5. gear, cheapest affordable step first, keeping a lease/payroll buffer
  const buffer = (payrollTotal() + totalLeases()) * 25;
  for (let si=0; si<S.stations.length; si++) {
    const st = S.stations[si];
    const nt = TX[st.tx+1], na = ANT[st.ant+1];
    if (na && S.rep >= na.rep && S.cash - na.cost > buffer) { S.cash -= na.cost; st.ant++; }
    if (nt && S.rep >= nt.rep && S.cash - nt.cost > buffer) { S.cash -= nt.cost; st.tx++; }
  }
  // 6. train, cheap steps only
  for (const p of S.staff) {
    const c = trainCostFor(p.skill);
    if (p.skill < 10 && S.cash - c > buffer * 1.5) { S.cash -= c; p.skill++; p.salary = salaryFor(p.role,p.skill); }
  }
  // 7. expand
  if (policy.found && canFoundStation() && S.cash > nextStationCost() * policy.found) foundStation(policy.seg);
  // Drive the REAL tick(), never bare simulateDay(): checkUnlock() and the
  // candidate refresh live there, and a sim that skips them reports a false
  // plateau (the fx.js sceneTier comment records this exact trap).
  tick();
}`;
vm.runInContext(AUTOPLAY, ctx, { filename: 'autoplay.js' });
const run = e => vm.runInContext(e, ctx);

const SHOWS_POL = {
  music:  { morning:'music', midday:'music', evening:'music', night:'music' },
  mixed:  { morning:'news',  midday:'music', evening:'talk',  night:'music' },
  news:   { morning:'news',  midday:'news',  evening:'talk',  night:'talk'  },
  ads:    { morning:'ads',   midday:'ads',   evening:'talk',  night:'ads'   }
};

function trial(policy, days, sd){
  seed = sd;
  run(`S = sanitize(newState('KRUN')); refreshCandidates();`);
  let drift = 0, unlockDay = null, foundDay = null, minRep = 100, maxRep = 0;
  for (let i=0;i<days;i++){
    run(`autoDay(${JSON.stringify(policy)})`);
    drift = Math.max(drift, Math.abs(run('ledgerDrift()')));
    if (run('lastModal') === 'Broadcast fault') return { bad:'TICK THREW', day: run('S.day') };
    if (!unlockDay && run('S.unlockedExpansion')) unlockDay = run('S.day');
    if (!foundDay && run('S.stations.length') > 1) foundDay = run('S.day');
    const r = run('S.rep'); minRep = Math.min(minRep,r); maxRep = Math.max(maxRep,r);
    if (!Number.isFinite(run('S.cash'))) return { bad:'NaN cash', day: run('S.day') };
    if (run('S.cash') <= run('BANKRUPTCY_FLOOR')) return { dead:true, day: run('S.day'), unlockDay, foundDay, drift, maxRep:+maxRep.toFixed(1) };
  }
  return { dead:false, day: run('S.day'), cash: Math.round(run('S.cash')), rep:+run('S.rep').toFixed(1),
           maxRep:+maxRep.toFixed(1), listeners: run('S.listeners'), stations: run('S.stations.length'),
           staff: run('S.staff.length'), unlockDay, foundDay, drift, net:+run('S.lastDay.net').toFixed(0),
           repTarget:+run('S.lastDay.repTarget').toFixed(1), faults: run('S.lastDay.faults') };
}

const policies = [
  { name:'mixed expand   ', shows:SHOWS_POL.mixed, found:1.3, seg:'college', cohost:false },
  { name:'mixed noexpand ', shows:SHOWS_POL.mixed, found:0,   seg:'college', cohost:false },
  { name:'mixed citywide ', shows:SHOWS_POL.mixed, found:1.3, seg:'citywide',cohost:false },
  { name:'reckless expand', shows:SHOWS_POL.mixed, found:1.0, seg:'citywide',cohost:false }
];
console.log('1200-day runs, 5 seeds each\n');
for (const p of policies) {
  const rows = [];
  for (let s=1;s<=5;s++) rows.push(trial(p, 1200, s*7919));
  const alive = rows.filter(r=>!r.dead);
  const f = k => alive.length ? Math.round(alive.reduce((a,r)=>a+(r[k]||0),0)/alive.length) : 0;
  console.log(p.name,
    '| dead', rows.filter(r=>r.dead).length + '/5',
    '| cash~', f('cash'),
    '| rep~', f('rep'),
    '| maxRep~', f('maxRep'),
    '| listeners~', f('listeners'),
    '| stations~', (alive.reduce((a,r)=>a+r.stations,0)/(alive.length||1)).toFixed(1),
    '| unlock', rows.map(r=>r.unlockDay||'-').join('/'),
    '| found', rows.map(r=>r.foundDay||'-').join('/'),
    '| drift', rows.reduce((a,r)=>Math.max(a,r.drift||0),0).toExponential(1));
}
