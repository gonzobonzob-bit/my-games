// Callsigns — the voice-tracking trade, measured DIRECTLY. Pure sim in a node
// vm, no browser, ~30s per skill for 30 paired seeds.
//
// WHY THIS EXISTS. Gate VT-1 ran the cohort and reported that never-tracking
// wins in both arms — no reversal, mechanic is decoration. This probe measures
// the same trade with nothing else moving and, at a skilled host, says the
// opposite on every seed. Both are right. They sit on opposite sides of a
// threshold neither of them reports, and finding it is what this file is for:
//
//   djTerm = 0.58 + 0.052 * skill * fatigue
//
// TRACK_APPEAL multiplies the WHOLE of that, including the flat 0.58 a host
// contributes just by being a voice on the air. Fatigue relief only reaches the
// second term. So the better a host is, the more tracking gives back and the
// less the 12% localism haircut costs relative to it — and below a break-even
// the trade is a straight loss. Measured, one station, 30 paired seeds each:
//
//   skill  3    -$41,190   tracked wins  0/30
//   skill  4    -$19,186   tracked wins  0/30
//   skill  5     +$3,577   tracked wins 30/30
//   skill  6    +$27,067   tracked wins 30/30
//   skill  8    +$75,886   tracked wins 30/30
//   skill 10   +$126,760   tracked wins 30/30
//
// The arithmetic agrees: tracking three of four dayparts needs
// djTerm(f')/djTerm(f) > 3.9 / (1.35 + 0.88*2.55) = 1.0851, which with fatigue
// 0.46 -> 0.811 solves at skill 3.0 — and the measured line sits just above it
// once the appeal loss on reputation is carried too.
//
// The fixture is what "thin" is supposed to mean: ONE host across all four
// dayparts, so djLoad is 4.0 and djFatigue sits at
// clamp(1 - 0.18*(4-1), 0.40, 1) = 0.46. Tracking three of them drops the host
// to 1 + 3*0.35 = 2.05 and fatigue to 0.811 — on ALL FOUR slots, the live one
// included, because fatigue is a property of the person and not the slot.
//
// Run:  node callsigns/tests/vtprobe.mjs [stations] [skill|sweep]
//       node callsigns/tests/vtprobe.mjs 1 sweep
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
const probe = (mode, SEED, NST, SKILL) => run(`
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
    const dj = mkp('dj', SKILL); S.staff.push(dj);
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
`.replace(/SEED/g, SEED).replace(/NST/g, NST).replace(/SKILL/g, SKILL));
const NSTATIONS = parseInt(process.argv[2] || '1', 10);
const ARG3 = process.argv[3] || '8';
const SKILLS = ARG3 === 'sweep' ? [3, 4, 5, 6, 8, 10] : [parseInt(ARG3, 10)];

console.log('tracked - live, per seed. One host per station across four dayparts, ' +
  NSTATIONS + ' station(s), 540 days, 30 paired seeds.');
console.log('  + means TRACKING wins.\n');
for (const SKILL of SKILLS) {
  const d = [];
  for (let sd = 1; sd <= 30; sd++) {
    const L = probe('live', sd, NSTATIONS, SKILL), T = probe('track', sd, NSTATIONS, SKILL);
    d.push({ sd, diff: T.cash - L.cash, repL: L.rep, repT: T.rep });
  }
  d.sort((a, b) => a.diff - b.diff);
  const med = d[Math.floor(d.length / 2)].diff;
  const wins = d.filter(x => x.diff > 0).length;
  console.log('  skill ' + String(SKILL).padStart(2) + '   median ' +
    (med >= 0 ? '+' : '') + med.toLocaleString('en-US').padStart(9) +
    '   tracked wins ' + String(wins).padStart(2) + '/30' +
    '   [p10 ' + d[3].diff + ' .. p90 ' + d[26].diff + ']' +
    '   rep ' + d[15].repL.toFixed(1) + ' -> ' + d[15].repT.toFixed(1));
}
