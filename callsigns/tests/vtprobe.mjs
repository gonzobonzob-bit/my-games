// Callsigns — the voice-tracking trade, measured DIRECTLY. Pure sim in a node
// vm, no browser, ~30s for 30 paired seeds.
//
// WHY THIS EXISTS. Gate VT-1 in harness.mjs ran the cohort and reported that
// never-tracking wins in both arms — no reversal, mechanic is decoration. This
// probe measures the same trade with nothing else moving, and says the
// opposite, on every seed:
//
//   one station    tracked - live   +$75,886   30/30 seeds
//   four stations  tracked - live   +$220,961  30/30 seeds
//
// The fixture is what "thin" is supposed to mean and what the cohort claims to
// build: ONE host across all four dayparts, so djLoad is 4.0 and djFatigue sits
// at clamp(1 - 0.18*(4-1), 0.40, 1) = 0.46. Tracking three of the four drops
// the host to 1 + 3*0.35 = 2.05, fatigue to 0.811, and djTerm from 0.771 to
// 0.917 on ALL FOUR slots — the live one included, because fatigue is a
// property of the person, not the slot. A 19% lift on four slots beats a 12%
// appeal haircut on three.
//
// So one of the two measurements is not measuring what it claims, and the
// cohort is the one with the moving parts. Keep BOTH until that is resolved:
// deleting the one that disagrees is how a project talks itself into a wrong
// answer with confidence. See docs/BALANCE_VOICETRACK.md.
//
// Run:  node callsigns/tests/vtprobe.mjs [stations]   (default 1)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const DIR = '/home/gonzobonzob/projects/my-games/callsigns/js/';
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
for (const f of ['content.js','sim.js']) vm.runInContext(readFileSync(DIR+f,'utf8'), ctx, { filename:f });
vm.runInContext('var __n=0; function mkp(role,skill){var p=makePerson(role,5);p.skill=skill;p.id="x"+(++__n);p.salary=salaryFor(role,skill);return p;}', ctx);
const run = e => vm.runInContext('(function(){'+e+'})()', ctx);

// ONE station, ONE host across all four dayparts = the thin arm in miniature.
// Fixed roll so the only difference between the two runs is the mode.
const probe = (mode, SEED, NST) => run(`
  (function(){ let a = 0x9e3779b9 ^ (SEED * 2654435761);
    Math.random = function(){ a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  S = sanitize(newState('KVT'));
  S.cash = 1e7; S.rep = 60; S.unlockedExpansion = true;
  if (NST > 1) { foundStation('countyline'); foundStation('quadrangle'); foundStation('ledger'); }
  const parts = ['morning','midday','evening','night'];
  S.stations.forEach((st, i) => {
    st.tx = 2; st.ant = 1; st.cond = 1;
    const dj = mkp('dj', 8); S.staff.push(dj);
    parts.forEach(p => { st.schedule[p].djs = [dj.id]; st.schedule[p].engs = []; st.schedule[p].mode = 'live'; });
    ${mode === 'track' ? `parts.slice(1).forEach(p => setSlotMode(i, p, 'tracked'));` : ''}
  });
  const st = S.stations[0];
  const load = staffSlotLoad();
  const perSlot = parts.map(p => ({
    part: p, tracked: trackedOn(st.schedule[p]),
    dj: +djTerm(st.schedule[p], st, load).toFixed(4),
    pull: +slotPull(st, p, load).toFixed(3)
  }));
  const dj0 = S.staff[0];
  const before = { djLoad: +djLoad(dj0.id).toFixed(3), fatigue: +djFatigue(dj0.id, st, load).toFixed(4),
                   attn: +stationAttn(st).toFixed(4), condT: +condTarget(st).toFixed(4) };
  for (let d = 0; d < 540; d++) simulateDay();
  return { before, perSlot, pullTotal: +perSlot.reduce((a,s)=>a+s.pull,0).toFixed(2),
           cash: Math.round(S.cash), rep: +S.rep.toFixed(2), cond: +st.cond.toFixed(4),
           rev: Math.round(S.lastDay.revenue), listeners: Math.round(S.lastDay.listeners || 0),
           payroll: Math.round(S.lastDay.payroll) };
`.replace(/SEED/g, SEED).replace(/NST/g, NST));
const NSTATIONS = parseInt(process.argv[2] || '1', 10);
const d = [];
for (let sd = 1; sd <= 30; sd++) {
  const L = probe('live', sd, NSTATIONS), T = probe('track', sd, NSTATIONS);
  d.push({ sd, live: L.cash, track: T.cash, diff: T.cash - L.cash, repL: L.rep, repT: T.rep });
}
d.sort((a,b)=>a.diff-b.diff);
const med = d[Math.floor(d.length/2)].diff;
const wins = d.filter(x=>x.diff>0).length;
console.log('tracked - live, per seed, one host per station on four dayparts, ' + NSTATIONS + ' station(s), 540 days');
console.log('  median ' + med + '   tracked wins ' + wins + '/' + d.length);
console.log('  p10 ' + d[3].diff + '   p90 ' + d[26].diff);
console.log('  sample ' + JSON.stringify(d.slice(0,3)) + ' ... ' + JSON.stringify(d.slice(-2)));
