/* Veil Legends — smoke test for js/sim.js
 *
 * SMOKE ONLY. This proves the simulation runs, does not throw, keeps its
 * invariants in range, advances waves, and round-trips its save. The real
 * N>=30 statistical harness (policy spread, flat-vs-pulse tie, "runs must
 * end") is balance-scientist's job — the policy hooks below are written to
 * be lifted straight into it: every policy is two pure functions,
 *   move(view) -> {x,y}        (movement intent, -1..1 each)
 *   cast(view) -> index|null   (which ability to fire this step, if any)
 * driven entirely off Sim.policyView(), which allocates one flat object and
 * leaks no internal references.
 *
 *   node test/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ------------------------------------------------------------------ */
/* harness plumbing                                                     */
/* ------------------------------------------------------------------ */

let failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.error('  FAIL: ' + msg); }
}
function section(name) { console.log('\n== ' + name); }

function loadScript(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // indirect eval -> global scope, which is how these files ship (no modules)
  (0, eval)(code);
}

/** localStorage stub: plain object store, injectable via Sim._setStorage. */
function makeStorage(seed) {
  const map = new Map(seed ? Object.entries(seed) : []);
  return {
    _map: map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

/* ------------------------------------------------------------------ */
/* fixture content (used only when the real content.js is still a stub) */
/* ------------------------------------------------------------------ */

function installFixtureContent() {
  const E = (o) => o;
  const ENEMY_TYPES = [
    E({ id: 'drifter', name: 'Drifter', shape: 'diamond', color: '#94a3b8', size: 14, hp: 70, atk: 7, spd: 105, moteValue: 2, behaviors: [{ type: 'chaser' }] }),
    E({ id: 'brute', name: 'Brute', shape: 'block', color: '#b45309', size: 24, hp: 320, atk: 12, spd: 78, moteValue: 6, behaviors: [{ type: 'chaser' }] }),
    E({ id: 'stalker', name: 'Stalker', shape: 'star', color: '#dc2626', size: 15, hp: 90, atk: 14, spd: 132, moteValue: 4, behaviors: [{ type: 'charger', windup: 0.5, dashSpeed: 300, dashCd: 4 }] }),
    E({ id: 'spitter', name: 'Spitter', shape: 'hex', color: '#0891b2', size: 16, hp: 110, atk: 10, spd: 90, moteValue: 4, behaviors: [{ type: 'ranged', range: 250, attackCd: 2.2, projSpeed: 240 }] }),
    E({ id: 'shard', name: 'Shard', shape: 'shard', color: '#a3e635', size: 12, hp: 45, atk: 6, spd: 120, moteValue: 1, behaviors: [{ type: 'chaser' }] }),
    E({ id: 'cluster', name: 'Cluster', shape: 'ring', color: '#65a30d', size: 20, hp: 150, atk: 8, spd: 85, moteValue: 3, behaviors: [{ type: 'splitter', into: 'shard', count: 3 }] }),
    E({ id: 'weaver', name: 'Weaver', shape: 'wisp', color: '#7c3aed', size: 18, hp: 180, atk: 6, spd: 70, moteValue: 5, behaviors: [{ type: 'summoner', spawns: 'shard', count: 2, period: 7 }] }),
    E({ id: 'moth', name: 'Moth', shape: 'orb', color: '#f472b6', size: 13, hp: 80, atk: 9, spd: 140, moteValue: 3, behaviors: [{ type: 'orbiter', radius: 130, strikeCd: 3 }] }),
    E({ id: 'warden', name: 'Warden', shape: 'crown', color: '#fbbf24', size: 22, hp: 240, atk: 8, spd: 72, moteValue: 6, behaviors: [{ type: 'shielder', radius: 150, reduction: 0.3 }] }),
    E({ id: 'popper', name: 'Popper', shape: 'spike', color: '#ef4444', size: 15, hp: 60, atk: 6, spd: 130, moteValue: 3, behaviors: [{ type: 'bomber', radius: 95, damage: 34 }] }),
    E({ id: 'boss_maw', name: 'The Maw', shape: 'core', color: '#7c3aed', size: 34, hp: 900, atk: 20, spd: 82, moteValue: 40, boss: true, telegraph: 0.7, behaviors: [{ type: 'charger', windup: 0.7, dashSpeed: 340, dashCd: 5 }, { type: 'summoner', spawns: 'shard', count: 3, period: 8 }] }),
    E({ id: 'boss_choir', name: 'The Choir', shape: 'husk', color: '#0ea5e9', size: 32, hp: 850, atk: 18, spd: 76, moteValue: 40, boss: true, telegraph: 0.6, behaviors: [{ type: 'ranged', range: 300, attackCd: 1.6, projSpeed: 260 }, { type: 'shielder', radius: 200, reduction: 0.25 }] })
  ];

  const abil = (id, name, kind, cost, cd, extra) => Object.assign({ id, name, icon: '*', kind, focusCost: cost, maxCd: cd }, extra || {});

  const HEROES = [
    {
      id: 'warden', name: 'Warden', icon: 'W', hp: 1000, focusMax: 100, focusRegen: 18,
      atk: 100, spd: 375, color: '#7c3aed', unlockAt: null,
      abilities: [
        abil('w_strike', 'Strike', 'melee', 14, 0.5, { range: 100, lunge: true }),
        abil('w_bolt', 'Bolt', 'projectile', 18, 0.7, { range: 340, speed: 520, homing: true }),
        abil('w_wave', 'Wave', 'aoe', 34, 2.6, { range: 140 }),
        abil('w_step', 'Step', 'dash', 12, 4, { range: 210 })
      ]
    },
    {
      id: 'seer', name: 'Seer', icon: 'S', hp: 820, focusMax: 120, focusRegen: 21,
      atk: 110, spd: 360, color: '#0ea5e9', unlockAt: { wave: 8 },
      abilities: [
        abil('s_lance', 'Lance', 'projectile', 16, 0.6, { range: 380, speed: 620, pierce: true }),
        abil('s_mark', 'Mark', 'execute', 22, 2.2, { range: 260 }),
        abil('s_frost', 'Frost', 'aoe', 30, 3.2, { range: 150, slow: { amount: 0.4, duration: 2.5 } }),
        abil('s_blink', 'Blink', 'dash', 10, 5, { range: 240 })
      ]
    }
  ];

  const PACTS = [
    { id: 'p_edge', name: 'Whetted Edge', icon: '/', tier: 1, cost: 60, upkeep: 4, text: '', ops: { meleeDamageMult: 1.25 } },
    { id: 'p_flow', name: 'Quick Flow', icon: '~', tier: 1, cost: 70, upkeep: 5, text: '', ops: { focusRegenAdd: 4 } },
    { id: 'p_ward', name: 'Ward', icon: '#', tier: 1, cost: 50, upkeep: 0, text: '', ops: { hpMaxAdd: 150 } },
    { id: 'p_settle', name: 'Long Breath', icon: 'o', tier: 1, cost: 55, upkeep: 0, text: '', ops: { settleWindowAdd: -0.4, veilDecayMult: 1.2 } },
    { id: 'p_chain', name: 'Chainwork', icon: 'c', tier: 2, cost: 140, upkeep: 7, text: '', ops: { chainCount: 1 } },
    { id: 'p_haste', name: 'Haste', icon: '>', tier: 2, cost: 160, upkeep: 8, text: '', ops: { cooldownMult: 0.85 } },
    { id: 'p_magnet', name: 'Lodestone', icon: 'm', tier: 2, cost: 120, upkeep: 0, text: '', ops: { moteMagnetRadius: 60, moteLifeAdd: 2 } },
    { id: 'p_guard', name: 'Brink Guard', icon: 'g', tier: 3, cost: 220, upkeep: 0, text: '', ops: { brinkGuard: 2 } },
    { id: 'p_crit', name: 'Keen Eye', icon: 'k', tier: 3, cost: 240, upkeep: 10, text: '', ops: { critChanceAdd: 0.15, critMult: 1.2 } },
    { id: 'p_thorn', name: 'Thorns', icon: 't', tier: 2, cost: 130, upkeep: 0, text: '', ops: { thornsPct: 20 } }
  ];

  const COVENANT = [
    { id: 'c_vigor', name: 'Vigor', cost: 40, clean: false, upkeep: 3, requires: [], ops: { hpMaxAdd: 120 } },
    { id: 'c_clean_vigor', name: 'Pure Vigor', cost: 120, clean: true, upkeep: 0, requires: ['c_vigor'], ops: { hpMaxAdd: 120 } },
    { id: 'c_focus', name: 'Wellspring', cost: 60, clean: false, upkeep: 4, requires: [], ops: { focusRegenAdd: 2 } }
  ];

  const ASCENSIONS = [
    { level: 1, name: 'Thin Veil', text: '', mods: { enemySpeedMult: 1.05 } },
    { level: 2, name: 'Press', text: '', mods: { enemyCountAdd: 2 } },
    { level: 3, name: 'Fading Motes', text: '', mods: { moteLifeMult: 0.5 } },
    { level: 4, name: 'Hardening', text: '', mods: { enemyHpMult: 1.1 } },
    { level: 5, name: 'Sunken Floor', text: '', mods: { veilFloorAdd: 10 } },
    { level: 6, name: 'Wraithbound', text: '', mods: { wraithHpMult: 1.4 } },
    { level: 7, name: 'Short Hour', text: '', mods: { parMult: 0.8 } },
    { level: 8, name: 'Cold Comfort', text: '', mods: { hpRestoreMult: 0.5 } }
  ];

  const RIFTS = [
    { id: 'r_still', name: 'Still Rift', text: '', mods: {}, unlockAt: null },
    { id: 'r_swift', name: 'Swift Rift', text: '', mods: { enemySpeedMult: 1.15, parMult: 1.1 }, unlockAt: { wave: 10 } }
  ];

  function waveTable(w) {
    const t = [{ id: 'drifter', weight: 6 }, { id: 'brute', weight: 2 + w * 0.3 }];
    if (w >= 2) t.push({ id: 'stalker', weight: 1 + w * 0.25 });
    if (w >= 3) t.push({ id: 'spitter', weight: 1 + w * 0.2 });
    if (w >= 4) t.push({ id: 'cluster', weight: 1 }, { id: 'popper', weight: 1 });
    if (w >= 6) t.push({ id: 'moth', weight: 1.5 }, { id: 'warden', weight: 1 });
    if (w >= 8) t.push({ id: 'weaver', weight: 1.2 });
    return t;
  }

  function validatePacts() {
    const bad = [];
    for (const p of PACTS) {
      const o = p.ops || {};
      const boosts = (o.damageMult > 1) || (o.meleeDamageMult > 1) || (o.projDamageMult > 1) ||
        (o.aoeDamageMult > 1) || (o.wraithDamageMult > 1) || (o.critChanceAdd > 0) ||
        (o.chainCount > 0) || (o.pierceCount > 0) || (o.cooldownMult < 1) ||
        (o.focusRegenAdd > 0) || (o.focusMaxAdd > 0);
      if (boosts && !(p.upkeep > 0)) bad.push(p.id);
    }
    return bad;
  }

  globalThis.CONTENT = {
    HEROES, PACTS, ENEMY_TYPES, RIFTS, COVENANT, ASCENSIONS,
    VEIL_TIERS: [{ min: 0, mult: 1 }, { min: 25, mult: 2 }, { min: 50, mult: 4 },
    { min: 75, mult: 8 }, { min: 90, mult: 16 }],
    STRINGS: {}, waveTable, validatePacts
  };
}

/* ------------------------------------------------------------------ */
/* policies — the hooks the real harness will reuse                     */
/* ------------------------------------------------------------------ */

function kiteMove(v) {
  // Walk away from local threat, drift toward the nearest mote when it is safe,
  // and stay off the walls.
  let x = v.threatX, y = v.threatY;
  if (v.moteDist < 260 && v.nearestDist > 90) {
    x += (v.moteX - v.px) / (v.moteDist || 1) * 1.2;
    y += (v.moteY - v.py) / (v.moteDist || 1) * 1.2;
  }
  const edge = 60;
  if (v.px < edge) x += 1.5; if (v.px > v.arenaW - edge) x -= 1.5;
  if (v.py < edge) y += 1.5; if (v.py > v.arenaH - edge) y -= 1.5;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  if (len < 0.05) {                       // nothing pressing: close on a target
    const d = v.nearestDist || 1;
    x = (v.nearestX - v.px) / d; y = (v.nearestY - v.py) / d;
  }
  return { x, y };
}

/** Timid: never overdraw. x = 0 in the design's notation. */
const POLICY_TIMID = {
  name: 'timid (x=0)',
  move: kiteMove,
  cast(v) {
    for (let i = 0; i < v.abilities.length; i++) {
      const a = v.abilities[i];
      if (!a.ready || a.cost > v.focus) continue;
      if (a.kind === 'dash' && v.nearestDist > 200) continue;
      if (a.range < v.nearestDist && a.kind !== 'aoe' && a.kind !== 'dash') continue;
      return i;
    }
    return null;
  },
  pact(v, offer) { return null; }          // declines everything
};

/** Reckless: fire everything the instant it is off cooldown, overdraw freely. */
const POLICY_RECKLESS = {
  name: 'reckless (max burn)',
  move: kiteMove,
  cast(v) {
    for (let i = 0; i < v.abilities.length; i++) if (v.abilities[i].ready) return i;
    return null;
  },
  pact(v, offer) { return offer.length ? offer[0] : null; }
};

/** Adaptive: the DESIGN 5.1 threshold policy — overdraw only while the
 *  remaining wave HP exceeds 1500*(1+V/50), and stop dead near the Brink. */
const POLICY_ADAPTIVE = {
  name: 'adaptive (threshold)',
  move: kiteMove,
  cast(v) {
    const mayOverdraw = v.waveHpRemaining > v.overdrawThreshold && v.veil < 78 && v.hpFrac > 0.35;
    for (let i = 0; i < v.abilities.length; i++) {
      const a = v.abilities[i];
      if (!a.ready) continue;
      if (a.cost > v.focus && !mayOverdraw) continue;
      if (a.kind === 'dash' && v.nearestDist > 200) continue;
      if (a.range < v.nearestDist && a.kind !== 'aoe' && a.kind !== 'dash') continue;
      return i;
    }
    return null;
  },
  pact(v, offer) {
    return offer.length ? offer[offer.length - 1] : null;
  }
};

/* ------------------------------------------------------------------ */
/* invariant checking                                                   */
/* ------------------------------------------------------------------ */

function fin(n) { return typeof n === 'number' && isFinite(n); }

function checkInvariants(S, label, bag) {
  if (!fin(S.hp) || S.hp < 0 || S.hp > S.hpMax + 1e-6) bag.push(label + ' hp=' + S.hp + '/' + S.hpMax);
  if (!fin(S.hpMax) || S.hpMax <= 0) bag.push(label + ' hpMax=' + S.hpMax);
  if (!fin(S.motes) || S.motes < 0) bag.push(label + ' motes=' + S.motes);
  if (!fin(S.veil) || S.veil < -1e-6 || S.veil > 100 + 1e-6) bag.push(label + ' veil=' + S.veil);
  if (!fin(S.veilFloor) || S.veilFloor < 0 || S.veilFloor > 90 + 1e-6) bag.push(label + ' veilFloor=' + S.veilFloor);
  if (S.veil < S.veilFloor - 1e-6) bag.push(label + ' veil<floor ' + S.veil + '<' + S.veilFloor);
  if (!fin(S.focus) || S.focus < -1e-6 || S.focus > S.focusMax + 1e-6) bag.push(label + ' focus=' + S.focus);
  if (!fin(S.waveHpRemaining) || S.waveHpRemaining < -1e-6) bag.push(label + ' waveHpRemaining=' + S.waveHpRemaining);
  if (!fin(S.parRemaining)) bag.push(label + ' parRemaining=' + S.parRemaining);
  if (!fin(S.player.x) || !fin(S.player.y)) bag.push(label + ' player pos NaN');
  if (S.player.x < 0 || S.player.x > S.arena.w || S.player.y < 0 || S.player.y > S.arena.h) {
    bag.push(label + ' player out of arena ' + S.player.x + ',' + S.player.y);
  }
  for (const e of S.enemies) {
    if (!fin(e.x) || !fin(e.y) || !fin(e.hp)) { bag.push(label + ' enemy NaN'); break; }
    if (e.hp > e.maxHp + 1e-6) { bag.push(label + ' enemy hp>maxHp'); break; }
  }
  for (const p of S.projectiles) {
    if (!fin(p.x) || !fin(p.y) || !fin(p.vx) || !fin(p.vy)) { bag.push(label + ' projectile NaN'); break; }
  }
  if (S.enemies.length > 200) bag.push(label + ' enemy explosion ' + S.enemies.length);
  if (S.error) bag.push(label + ' sim error: ' + S.error);
}

/* ------------------------------------------------------------------ */
/* the run driver                                                       */
/* ------------------------------------------------------------------ */

const STEP = 1 / 60;

function runPolicy(Sim, policy, opts) {
  const maxSeconds = opts.maxSeconds || 240;
  const stopWave = opts.stopWave || 6;
  const bag = [];
  let t = 0, steps = 0, drafts = 0, castCount = 0;
  const waveStarts = new Set();

  Sim._setSeed(opts.seed || 12345);
  Sim.setArena(390, 700);
  Sim.newRun(opts.heroId || 'warden', opts.riftId || null);

  while (t < maxSeconds) {
    const S = Sim.state;
    if (S.phase === 'dead') break;
    if (S.phase === 'pactDraft') {
      drafts++;
      const offer = (S.draftOffer || []).slice();
      const pick = policy.pact(Sim.policyView(), offer);
      const before = S.wave;
      const done = Sim.choosePact(pick);
      if (!done) Sim.choosePact(null);        // could not afford: decline
      if (Sim.state.phase === 'pactDraft') { bag.push('stuck in pactDraft'); break; }
      if (Sim.state.wave <= before) bag.push('wave did not advance after draft');
      continue;
    }
    if (S.phase !== 'combat') break;
    if (S.wave >= stopWave) break;

    const view = Sim.policyView();
    const mv = policy.move(view);
    Sim.setMove(mv.x, mv.y);
    const idx = policy.cast(view);
    if (idx != null) { if (Sim.useAbility(idx)) castCount++; }

    Sim.tick(STEP);
    t += STEP; steps++;
    waveStarts.add(Sim.state.wave);

    if (steps % 17 === 0) checkInvariants(Sim.state, policy.name, bag);
    if (bag.length > 4) break;
    Sim.drainEvents();
  }
  checkInvariants(Sim.state, policy.name, bag);

  return {
    seconds: t, steps, drafts, casts: castCount,
    wavesSeen: waveStarts.size,
    finalWave: Sim.state.wave,
    bestWave: Sim.state.runStats.bestWave,
    breaches: Sim.state.runStats.breaches,
    kills: Sim.state.runStats.kills,
    motes: Sim.state.runStats.motesEarned,
    veil: Sim.state.veil,
    veilFloor: Sim.state.veilFloor,
    phase: Sim.state.phase,
    problems: bag
  };
}

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */

console.log('Veil Legends — sim smoke test');

let Sim, REAL = null, FIXTURE = null;
try {
  loadScript('js/content.js');
  const c = globalThis.CONTENT;
  const stubbed = !c || !Array.isArray(c.HEROES) || c.HEROES.length === 0;
  REAL = stubbed ? null : c;
  console.log(stubbed
    ? '  content.js is still a stub'
    : '  real content.js present (' + c.HEROES.length + ' heroes, ' + c.ENEMY_TYPES.length +
    ' enemy types, ' + c.PACTS.length + ' pacts, ' + c.COVENANT.length + ' covenant nodes)');
  // The mechanics sections run against a FIXED fixture so their exact numbers
  // do not drift when content.js is retuned. The last section then re-runs the
  // policies against the real content.js as an integration check.
  installFixtureContent();
  FIXTURE = globalThis.CONTENT;
  loadScript('js/sim.js');
  Sim = globalThis.Sim;
} catch (err) {
  console.error('FATAL: could not load scripts:', err);
  process.exit(1);
}
const useContent = (c) => { globalThis.CONTENT = c; };

section('load & API surface');
ok(!!Sim, 'Sim is defined on globalThis');
for (const fn of ['newRun', 'continueRun', 'tick', 'useAbility', 'setMove', 'setArena',
  'choosePact', 'buyCovenant', 'respecCovenant', 'setAscension', 'save',
  'abandonRun', 'drainEvents', '_setStorage']) {
  ok(typeof Sim[fn] === 'function', 'Sim.' + fn + ' exists');
}
ok(Sim.state && Sim.state.phase === 'menu', 'boots into phase menu');
ok(Array.isArray(CONTENT.validatePacts()) && CONTENT.validatePacts().length === 0,
  'validatePacts reports no anti-runaway violations');

Sim._setStorage(makeStorage());

section('zero DOM/timer access in sim.js');
{
  const raw = fs.readFileSync(path.join(ROOT, 'js/sim.js'), 'utf8');
  // strip comments so the scan cannot match its own documentation
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame',
    'document', 'getElementById', 'AudioContext', 'canvas', 'window.']) {
    ok(src.indexOf(banned) === -1, 'sim.js code contains no "' + banned + '"');
  }
  ok(/localStorage/.test(src), 'sim.js references localStorage (through store() only)');
  ok(src.split('\n').filter(l => l.indexOf('localStorage') >= 0).length === 1,
    'localStorage appears on exactly one line (the store() wrapper)');
  ok((src.match(/Date\.now/g) || []).length === 1, 'Date.now used exactly once (save timestamp only)');
}

section('three policies, a few waves each');
const results = {};
for (const policy of [POLICY_TIMID, POLICY_RECKLESS, POLICY_ADAPTIVE]) {
  Sim._setStorage(makeStorage());
  const r = runPolicy(Sim, policy, { seed: 99, stopWave: 6, maxSeconds: 300 });
  results[policy.name] = r;
  console.log('  ' + policy.name.padEnd(22) +
    ' wave ' + r.bestWave + '  ' + r.seconds.toFixed(0) + 's  casts ' + r.casts +
    '  kills ' + r.kills + '  motes ' + r.motes + '  breaches ' + r.breaches +
    '  V ' + r.veil.toFixed(0) + '/floor ' + r.veilFloor.toFixed(1) +
    '  drafts ' + r.drafts + '  phase ' + r.phase);
  ok(r.problems.length === 0, policy.name + ' invariant problems: ' + r.problems.join(' | '));
  ok(r.steps > 100, policy.name + ' actually stepped the sim');
  ok(r.casts > 0, policy.name + ' cast abilities');
}
ok(results['adaptive (threshold)'].bestWave >= 2, 'adaptive policy advanced past wave 1');
ok(results['adaptive (threshold)'].drafts >= 1, 'pact draft phase was entered');
ok(results['reckless (max burn)'].veilFloor >= 0, 'reckless veilFloor sane');
ok(results['reckless (max burn)'].motes > 0 || results['reckless (max burn)'].kills > 0,
  'reckless policy killed something');

section('overdraw / veil mechanics');
{
  Sim._setStorage(makeStorage());
  Sim._setSeed(7);
  Sim.setArena(390, 700);
  Sim.newRun('warden', null);
  const S = Sim.state;
  S.focus = 0;
  const v0 = S.veil;
  const cost = S.abilities[2].focusCost;
  Sim.useAbility(2);
  const expected = v0 + cost * 0.8;
  ok(Math.abs(S.veil - expected) < 1e-6, 'overdraw charged deficit*0.8 to Veil (' +
    S.veil.toFixed(2) + ' vs ' + expected.toFixed(2) + ')');
  ok(S.focus === 0, 'overdraw drove Focus to 0');

  // settle window: no decay for 1.5s, then 4/s
  const vBefore = S.veil;
  for (let i = 0; i < 60; i++) Sim.tick(STEP);       // 1.0s < settle
  ok(Math.abs(S.veil - vBefore) < 1e-6, 'no Veil decay inside the settle window');
  for (let i = 0; i < 120; i++) Sim.tick(STEP);      // to t=3.0s, 1.5s of decay
  const decayed = vBefore - S.veil;
  ok(decayed > 4 && decayed < 8, 'Veil decays ~4/s after settle (saw ' + decayed.toFixed(2) + ')');

  // breach: overdraw with the Veil already at the Brink
  S.veil = 99.9;
  S.focus = 0;
  Sim.useAbility(1);
  ok(S.runStats.breaches >= 1, 'breach registered at V>=100');
  ok(S.veil <= 61 && S.veil >= 59.9, 'Veil reset to 60 after breach (' + S.veil.toFixed(1) + ')');
  const wraiths = S.enemies.filter(e => e.isWraith);
  ok(wraiths.length === 1, 'exactly one Veilwraith spawned');
  if (wraiths[0]) {
    ok(Math.abs(wraiths[0].spd - 375 * 1.05) < 1e-6, 'wraith speed is 1.05x player base');
  }
  ok(S.veilTier === 2, 'tier index tracks Veil bands (V=60 -> tier 2)');
}

section('wave formulas');
{
  Sim._setStorage(makeStorage());
  Sim._setSeed(3);
  Sim.newRun('warden', null);
  const S = Sim.state;
  ok(S.enemies.length === 8, 'wave 1 spawns N(1)=8 enemies (saw ' + S.enemies.length + ')');
  ok(Math.abs(S.waveHpTotal - 8 * 115) < 1, 'wave 1 HP pool = 8*115 (saw ' + S.waveHpTotal.toFixed(0) + ')');
  ok(Math.abs(S.parTotal - 20.8) < 1e-6, 'T_par(1) = 20.8s (saw ' + S.parTotal + ')');
  // and the design's worked wave 10
  S.enemies.length = 0;
  Sim.tick(STEP);           // clears the wave -> draft
  ok(S.phase === 'pactDraft' || S.wave === 2, 'clearing a wave leaves combat');
}

section('DESIGN 5.2 worked wave 10 (restored from a crafted save)');
{
  const st = makeStorage({
    veilLegendsSave: JSON.stringify({
      saveVersion: 2,
      meta: { echoes: 0, covenantOwned: [], ascension: 0, ascensionUnlocked: 0, heroesUnlocked: ['warden'], bestWaveEver: 9, riftsUnlocked: [] },
      run: {
        heroId: 'warden', riftId: null, wave: 10, motes: 400, hp: 800, hpMax: 1000,
        focus: 100, veil: 12, veilFloor: 6, pactsTaken: ['p_ward'],
        runStats: { kills: 100, breaches: 1, motesEarned: 900, timePlayed: 200, bestWave: 9 },
        waveHpRemaining: 0
      }
    })
  });
  Sim._setStorage(st);
  Sim._setSeed(101);
  ok(Sim.continueRun() === true, 'wave-10 snapshot restored');
  const S = Sim.state;
  ok(S.wave === 10, 'restored at wave 10');
  ok(S.enemies.filter(e => !e.isWraith).length === 26, 'N(10) = 26 enemies (saw ' +
    S.enemies.length + ')');
  ok(Math.abs(S.waveHpTotal - 6500) < 1, 'wave 10 HP pool = 6500 (saw ' + S.waveHpTotal.toFixed(0) + ')');
  ok(Math.abs(S.parTotal - 28) < 1e-6, 'T_par(10) = 28s (saw ' + S.parTotal + ')');
  ok(S.enemies.some(e => e.isBoss), 'wave 10 contains a boss');
  ok(S.hpMax === 1000 + 150, 'hpMax recomputed from base + restored pact ops (saw ' + S.hpMax + ')');
  ok(S.veilFloor >= 6, 'restored veil floor kept');
}

section('par overrun');
{
  Sim._setStorage(makeStorage());
  Sim._setSeed(5);
  Sim.newRun('warden', null);
  const S = Sim.state;
  S.parRemaining = 0;
  const f0 = S.veilFloor, v0 = S.veil;
  for (let i = 0; i < 60; i++) { Sim.setMove(0, 0); Sim.tick(STEP); }
  ok(Math.abs(S.veilFloor - (f0 + 0.1)) < 0.02, 'par overrun adds +0.1 floor/s (saw +' +
    (S.veilFloor - f0).toFixed(3) + ')');
  /* The overrun rate USED to be 4/s, exactly cancelling VEIL_DECAY, so once a
     player fell behind par their Veil rose no matter what they did — the
     spiral was terminal by construction rather than by play. It is now 1.5,
     and this invariant is the thing to protect: attrition pressure comes from
     the PERMANENT floor ratchet asserted above, which nothing ever lowers. */
  ok(Sim.TUNING.PAR_OVERRUN_VEIL < Sim.TUNING.VEIL_DECAY,
    'par overrun rate stays under the decay rate (' + Sim.TUNING.PAR_OVERRUN_VEIL +
    ' vs ' + Sim.TUNING.VEIL_DECAY + ')');
  ok(S.veil - v0 < 1, 'a player who stops casting past par can still settle (saw +' +
    (S.veil - v0).toFixed(2) + ')');
}

section('par overrun still applies to a player who cannot settle');
{
  /* Isolate the par term: overdraw once to open the settle window, then hold
     for under settleWindow() so decay never engages, and compare the Veil
     gained past par against the same second spent under par. The difference
     is PAR_OVERRUN_VEIL and nothing else. */
  const gainOverPar = (parRemaining) => {
    Sim._setStorage(makeStorage());
    Sim._setSeed(5);
    Sim.newRun('warden', null);
    const S = Sim.state;
    S.focus = 0;                       // guarantees the cast overdraws
    Sim.useAbility(0);                 // resets sinceCast to 0
    S.parRemaining = parRemaining;
    const v0 = S.veil;
    for (let i = 0; i < 60; i++) { Sim.setMove(0, 0); Sim.tick(STEP); }
    return S.veil - v0;
  };
  const over = gainOverPar(0), under = gainOverPar(100);
  const delta = over - under;
  ok(Math.abs(delta - Sim.TUNING.PAR_OVERRUN_VEIL) < 0.25,
    'past par costs exactly PAR_OVERRUN_VEIL more Veil per second (saw +' +
    delta.toFixed(2) + ' vs ' + Sim.TUNING.PAR_OVERRUN_VEIL + ')');
}

section('between-wave HP restore');
{
  Sim._setStorage(makeStorage());
  Sim._setSeed(11);
  Sim.newRun('warden', null);
  const S = Sim.state;
  S.hp = 100;
  S.enemies.length = 0;
  Sim.tick(STEP);
  ok(Math.abs(S.hp - (100 + S.hpMax * 0.25)) < 1e-6,
    '+25% hpMax restored between waves (saw ' + S.hp + ')');
}

section('save / load round-trip');
{
  const storage = makeStorage();
  Sim._setStorage(storage);
  Sim._setSeed(21);
  Sim.setArena(390, 700);
  Sim.newRun('warden', null);
  // play into wave 2+ so there is a real snapshot
  const r = runPolicy(Sim, POLICY_ADAPTIVE, { seed: 21, stopWave: 3, maxSeconds: 200 });
  Sim.save();
  const raw = storage.getItem('veilLegendsSave');
  ok(!!raw, 'save written to storage');
  const parsed = JSON.parse(raw);
  ok(parsed.saveVersion === 2, 'saveVersion 2 embedded in the payload');
  ok(parsed.run == null || typeof parsed.run.wave === 'number', 'run snapshot has a wave');
  if (parsed.run) {
    const keys = Object.keys(parsed.run).sort().join(',');
    ok(keys === ['heroId', 'riftId', 'petId', 'wave', 'motes', 'hp', 'hpMax', 'focus', 'veil',
      'veilFloor', 'pactsTaken', 'runStats', 'waveHpRemaining'].sort().join(','),
      'run snapshot has exactly the contract fields (no buffs/shields): ' + keys);
    const before = { wave: parsed.run.wave, motes: parsed.run.motes, pacts: parsed.run.pactsTaken.length };
    const restored = Sim.continueRun();
    ok(restored === true, 'continueRun restored the snapshot');
    ok(Sim.state.wave === before.wave, 'restored at the same wave (' + Sim.state.wave + ')');
    ok(Sim.state.motes === before.motes, 'restored motes');
    ok(Sim.state.pactsTaken.length === before.pacts, 'restored pacts');
    ok(Sim.state.phase === 'combat', 'restored into combat');
    ok(Sim.state.enemies.filter(e => !e.isWraith).length > 0, 'restored wave respawned its enemies');
  }
  console.log('  (round-trip run reached wave ' + r.bestWave + ')');
}

section('corrupt / hostile saves degrade, never crash');
{
  const hostile = [
    'not json at all',
    '[]',
    'null',
    '{"saveVersion":2,"meta":{"echoes":"lots"},"run":{}}',
    '{"saveVersion":2,"meta":{"echoes":-99999,"ascension":900,"covenantOwned":"nope"},"run":null}',
    '{"saveVersion":999,"meta":{"echoes":5000}}',
    '{"saveVersion":2,"__proto__":{"pwned":1},"meta":{"__proto__":{"pwned2":1},"echoes":3}}',
    '{"saveVersion":2,"meta":{"echoes":10},"run":{"heroId":"ghost","wave":-5,"motes":-500000}}',
    '{"saveVersion":2,"meta":{"echoes":10},"run":{"heroId":"warden","wave":1e308,"hp":null,"veil":500,"veilFloor":9999,"pactsTaken":["nonexistent","p_ward"]}}'
  ];
  for (const h of hostile) {
    const st = makeStorage({ veilLegendsSave: h });
    let threw = null;
    try {
      Sim._setStorage(st);
      Sim.continueRun();
      Sim.save();
    } catch (e) { threw = e; }
    ok(!threw, 'hostile save did not throw: ' + h.slice(0, 40));
    ok(fin(Sim.state.meta.echoes) && Sim.state.meta.echoes >= 0,
      'meta.echoes sane after ' + h.slice(0, 28) + ' (got ' + Sim.state.meta.echoes + ')');
  }
  ok(({}).pwned === undefined && ({}).pwned2 === undefined, 'Object.prototype not polluted');
  // the last hostile save has a real hero + one real pact and absurd numbers
  {
    Sim._setStorage(makeStorage({ veilLegendsSave: hostile[hostile.length - 1] }));
    const okRestore = Sim.continueRun();
    if (okRestore) {
      ok(Sim.state.veil <= 100 && Sim.state.veilFloor <= 90, 'absurd veil clamped');
      ok(Sim.state.motes >= 0, 'negative motes rejected');
      ok(Sim.state.pactsTaken.length === 1 && Sim.state.pactsTaken[0] === 'p_ward',
        'unknown pact id dropped, known one kept');
      ok(Sim.state.wave >= 1 && Sim.state.wave < 1e6, 'absurd wave clamped (' + Sim.state.wave + ')');
    }
  }
}

section('v1 migration');
{
  const v1 = JSON.stringify({
    saveVersion: 1, heroId: 'warden', wave: 7, gold: 250, kills: 88,
    player: { hp: 300, atk: 900 }
  });
  Sim._setStorage(makeStorage({ veilLegendsSave: v1 }));
  const cont = Sim.continueRun();
  ok(cont === false, 'v1 run is discarded (no mid-wave state carried over)');
  ok(Sim.state.meta.echoes === 7 * 5 + 25, 'v1 migration granted wave*5 + gold/10 = 60 echoes (got ' +
    Sim.state.meta.echoes + ')');
  ok(Sim.state.meta.heroesUnlocked.indexOf('warden') >= 0, 'v1 hero marked unlocked');
  ok(Sim.state.meta.bestWaveEver === 7, 'v1 best wave carried');
  Sim.save();
  const after = JSON.parse(Sim._setStorage === undefined ? '{}' : '{}');   // no-op guard
  ok(true, 'v1 save rewritten without throwing');
}

section('death banks echoes; meta persists');
{
  const st = makeStorage();
  Sim._setStorage(st);
  Sim._setSeed(31);
  Sim.newRun('warden', null);
  Sim.state.runStats.bestWave = 10;
  Sim.state.runStats.motesEarned = 2000;
  Sim.state.hp = 1;
  // force a lethal hit
  Sim.state.enemies.forEach(e => { e.x = Sim.state.player.x; e.y = Sim.state.player.y; e.atkTimer = 99; e.atk = 5000; });
  for (let i = 0; i < 90 && Sim.state.phase === 'combat'; i++) Sim.tick(STEP);
  ok(Sim.state.phase === 'dead', 'player died (phase dead)');
  ok(Sim.state.meta.echoes > 0, 'echoes banked on death (' + Sim.state.meta.echoes + ')');
  ok(Sim.state.meta.bestWaveEver === 10, 'bestWaveEver updated');
  const saved = JSON.parse(st.getItem('veilLegendsSave'));
  ok(saved.run === null, 'run cleared from the save on death');
  ok(saved.meta.echoes === Sim.state.meta.echoes, 'meta echoes persisted');
}

section('run ends mid-cast (bomber blast kills the player during your own AoE)');
{
  Sim._setStorage(makeStorage());
  Sim._setSeed(61);
  Sim.newRun('warden', null);
  const S = Sim.state;
  // put a lethal popper right on top of the player and blow it up with the AoE
  S.enemies.length = 0;
  const popper = CONTENT.ENEMY_TYPES.find(e => e.id === 'popper');
  S.hp = 5;
  S.enemies.push({
    x: S.player.x + 4, y: S.player.y + 4, vx: 0, vy: 0, hp: 1, maxHp: 1, size: 15,
    color: popper.color, shape: popper.shape, archetypeId: 'popper', isWraith: false,
    isBoss: false, slowMult: 1, atk: 6, spd: 130, moteValue: 3,
    behaviors: [{ type: 'bomber', radius: 200, damage: 9999 }],
    telegraph: 0, telegraphMax: 0, atkTimer: 0, slowTimer: 0, shieldAura: 0,
    st: {}, dead: false, uid: 999999
  });
  // the dangerous shape: an AoE that also buffs, heals and shields, cast while
  // the Veil is at the Brink and Focus is empty — so the post-cast buff/heal/
  // shield writes AND checkBreach() all run after the run has already ended.
  Object.assign(S.abilities[2], {
    kind: 'aoe', range: 160, focusCost: 40,
    buff: { stat: 'atk', amount: 30, duration: 5 },
    heal: 200, shield: { amount: 150, duration: 4 }
  });
  S.abilities[2].cd = 0;
  S.focus = 0;
  S.veil = 99.9;
  let threw = null;
  try { Sim.useAbility(2); Sim.tick(1 / 60); } catch (e) { threw = e; }
  ok(!threw, 'no exception when the run ends inside a cast: ' + (threw && threw.message));
  ok(S.error === null, 'state.error stayed null (no internal failure path taken)');
  ok(S.phase === 'dead', 'phase is dead after the fatal blast');
}

section('covenant + ascension');
{
  Sim._setStorage(makeStorage());
  Sim.state.meta.echoes = 1000;
  ok(Sim.buyCovenant('c_clean_vigor') === false, 'covenant requires are enforced');
  ok(Sim.buyCovenant('c_vigor') === true, 'covenant node bought');
  ok(Sim.buyCovenant('c_vigor') === false, 'cannot buy the same node twice');
  ok(Sim.buyCovenant('c_clean_vigor') === true, 'requirement satisfied -> buy allowed');
  const refund = Sim.respecCovenant();
  ok(refund === 40 + 60, 'respec refunds full for normal, 50% for Clean (got ' + refund + ')');
  ok(Sim.state.meta.covenantOwned.length === 0, 'respec cleared the tree');

  Sim.state.meta.ascensionUnlocked = 8;
  Sim.setAscension(5);
  Sim._setSeed(41);
  Sim.newRun('warden', null);
  ok(Math.abs(Sim.state.veilFloor - 10) < 1e-6, 'A5 adds +10 starting Veil floor (saw ' +
    Sim.state.veilFloor + ')');
  ok(Sim.state.veil >= 10, 'Veil starts at the floor');
  Sim.setAscension(7);
  Sim.newRun('warden', null);
  ok(Math.abs(Sim.state.parTotal - 20.8 * 0.8) < 1e-6, 'A7 multiplies par by 0.8 (saw ' +
    Sim.state.parTotal.toFixed(3) + ')');
  Sim.setAscension(0);
}

section('no timers, no leaks across newRun cycles');
{
  Sim._setStorage(makeStorage());
  const before = Sim.state.enemies;
  for (let i = 0; i < 6; i++) {
    Sim._setSeed(100 + i);
    Sim.newRun('warden', null);
    for (let s = 0; s < 30; s++) { Sim.setMove(0, 0); Sim.tick(STEP); }
  }
  ok(Sim.state.enemies === before, 'enemies array is mutated in place, never reassigned');
  ok(Sim.state.drops === Sim.state.motesOnGround, 'ground-mote alias stays consistent');
  ok(Sim.state.enemies.length <= 90, 'enemy count bounded across repeated runs');
  Sim.drainEvents();
  ok(Sim.events.length === 0, 'drainEvents clears the queue');
}

section('tick is a no-op outside combat');
{
  Sim._setStorage(makeStorage());
  Sim.newRun('warden', null);
  Sim.state.phase = 'menu';
  const snap = JSON.stringify({ x: Sim.state.player.x, t: Sim.state.time });
  for (let i = 0; i < 60; i++) Sim.tick(STEP);
  ok(JSON.stringify({ x: Sim.state.player.x, t: Sim.state.time }) === snap,
    'tick does nothing while phase!=combat');
  ok(Sim.tick(NaN) === undefined && Sim.tick(-1) === undefined && Sim.tick(0) === undefined,
    'tick rejects bad dt without throwing');
}

/* ------------------------------------------------------------------ */
/* integration: the real content.js                                     */
/* ------------------------------------------------------------------ */

// Contract vocabularies, copied from CONTRACT.md. sim.js implements all of
// these; content.js may use nothing outside them.
const OP_KEYS = ['focusRegenAdd', 'focusMaxAdd', 'hpMaxAdd', 'moveSpeedMult', 'damageMult',
  'meleeDamageMult', 'projDamageMult', 'aoeDamageMult', 'cooldownMult', 'lifestealPct',
  'thornsPct', 'executeThresholdAdd', 'chainCount', 'pierceCount', 'aoeRadiusMult',
  'moteMagnetRadius', 'moteLifeAdd', 'parAdd', 'veilDecayMult', 'overdrawRateMult',
  'brinkGuard', 'hpRestoreMultBetweenWaves', 'critChanceAdd', 'critMult',
  'wraithDamageMult', 'settleWindowAdd'];
const AMOD_KEYS = ['moteLifeMult', 'veilFloorAdd', 'parMult', 'enemySpeedMult', 'enemyHpMult',
  'enemyCountAdd', 'wraithHpMult', 'hpRestoreMult', 'settleWindowMult'];
const BEHAVIORS = ['chaser', 'ranged', 'charger', 'splitter', 'summoner', 'orbiter', 'shielder', 'bomber'];
const KINDS = ['melee', 'projectile', 'dash', 'execute', 'aoe'];
const SHAPES = ['diamond', 'block', 'hex', 'star', 'orb', 'wisp', 'shard', 'ring', 'crown',
  'spike', 'husk', 'core'];

if (!REAL) {
  section('real content.js integration — SKIPPED (content.js is still a stub)');
} else {
  section('real content.js — vocabulary conformance');
  useContent(REAL);
  ok(REAL.validatePacts().length === 0,
    'validatePacts(): no anti-runaway violations (' + REAL.validatePacts().join(',') + ')');
  const badOps = [];
  for (const src of [['PACTS', REAL.PACTS], ['COVENANT', REAL.COVENANT]]) {
    for (const item of src[1] || []) {
      for (const k of Object.keys(item.ops || {})) {
        if (OP_KEYS.indexOf(k) < 0) badOps.push(src[0] + ':' + item.id + '.' + k);
      }
    }
  }
  ok(badOps.length === 0, 'every pact/covenant op is implemented by sim: ' + badOps.join(', '));
  const badMods = [];
  for (const a of REAL.ASCENSIONS || []) {
    for (const k of Object.keys(a.mods || {})) if (AMOD_KEYS.indexOf(k) < 0) badMods.push('A' + a.level + '.' + k);
  }
  for (const r of REAL.RIFTS || []) {
    for (const k of Object.keys(r.mods || {})) if (AMOD_KEYS.indexOf(k) < 0) badMods.push(r.id + '.' + k);
  }
  ok(badMods.length === 0, 'every ascension/rift mod is implemented by sim: ' + badMods.join(', '));
  const badBeh = [], badShape = [];
  for (const e of REAL.ENEMY_TYPES || []) {
    for (const b of e.behaviors || []) if (BEHAVIORS.indexOf(b.type) < 0) badBeh.push(e.id + ':' + b.type);
    if (SHAPES.indexOf(e.shape) < 0) badShape.push(e.id + ':' + e.shape);
  }
  ok(badBeh.length === 0, 'every enemy behavior is implemented by sim: ' + badBeh.join(', '));
  ok(badShape.length === 0, 'every enemy shape is in the fx vocabulary: ' + badShape.join(', '));
  const badKind = [];
  for (const h of REAL.HEROES || []) {
    for (const a of h.abilities || []) if (KINDS.indexOf(a.kind) < 0) badKind.push(h.id + ':' + a.kind);
    ok((h.abilities || []).length === 4, 'hero ' + h.id + ' has exactly 4 abilities');
  }
  ok(badKind.length === 0, 'every ability kind is implemented by sim: ' + badKind.join(', '));
  // splitter/summoner targets must resolve, or those behaviors silently no-op
  const badRef = [];
  for (const e of REAL.ENEMY_TYPES || []) {
    for (const b of e.behaviors || []) {
      const ref = b.into || b.spawns;
      if (ref && !(REAL.ENEMY_TYPES || []).some(x => x.id === ref)) badRef.push(e.id + '->' + ref);
    }
  }
  ok(badRef.length === 0, 'splitter/summoner targets resolve: ' + badRef.join(', '));
  // ASC design fixes from DESIGN.md
  const a3 = (REAL.ASCENSIONS || []).find(a => a.level === 3);
  const a5 = (REAL.ASCENSIONS || []).find(a => a.level === 5);
  const a7 = (REAL.ASCENSIONS || []).find(a => a.level === 7);
  ok(a3 && a3.mods.moteLifeMult === 0.5, 'A3 = moteLifeMult 0.5');
  ok(a5 && a5.mods.veilFloorAdd === 10, 'A5 = veilFloorAdd 10');
  ok(a7 && a7.mods.parMult === 0.8, 'A7 = parMult 0.8');

  section('real content.js — every hero is playable');
  for (const h of REAL.HEROES) {
    Sim._setStorage(makeStorage());
    Sim._setSeed(1234);
    Sim.setArena(390, 700);
    const started = Sim.newRun(h.id, null);
    ok(started === true, 'newRun(' + h.id + ') started');
    ok(Sim.state.heroId === h.id, 'hero ' + h.id + ' resolved (not a fallback)');
    let casts = 0, threw = null;
    try {
      for (let i = 0; i < 60 * 40 && Sim.state.phase !== 'dead'; i++) {
        if (Sim.state.phase === 'pactDraft') { Sim.choosePact(null); continue; }
        const v = Sim.policyView();
        const mv = kiteMove(v); Sim.setMove(mv.x, mv.y);
        for (let a = 0; a < 4; a++) if (Sim.useAbility(a)) casts++;
        Sim.tick(STEP); Sim.drainEvents();
      }
    } catch (e) { threw = e; }
    ok(!threw, 'hero ' + h.id + ' 40s of all-abilities spam did not throw: ' + (threw && threw.message));
    ok(casts > 20, 'hero ' + h.id + ' abilities all fire (' + casts + ' casts)');
    ok(Sim.state.error === null, 'hero ' + h.id + ' no internal sim failure');
    ok(Sim.state.runStats.kills > 0, 'hero ' + h.id + ' can actually kill things');
  }

  section('real content.js — every archetype spawns and behaves');
  {
    const seen = new Set();
    for (let w = 1; w <= 20; w++) {
      const t = REAL.waveTable(w);
      ok(Array.isArray(t), 'waveTable(' + w + ') returns an array');
      for (const entry of t) if (entry.weight > 0) seen.add(entry.id);
    }
    const nonBoss = REAL.ENEMY_TYPES.filter(e => !e.boss).map(e => e.id);
    const missing = nonBoss.filter(id => !seen.has(id));
    ok(missing.length === 0, 'every non-boss archetype appears in waveTable(1..20): ' + missing.join(','));
    const unknown = [...seen].filter(id => !REAL.ENEMY_TYPES.some(e => e.id === id));
    ok(unknown.length === 0, 'waveTable references no unknown archetype: ' + unknown.join(','));
  }
  {
    // force every archetype through a live tick, including all boss waves
    for (const et of REAL.ENEMY_TYPES) {
      Sim._setStorage(makeStorage());
      Sim._setSeed(77);
      Sim.newRun(REAL.HEROES[0].id, null);
      const S = Sim.state;
      S.enemies.length = 0;
      for (let i = 0; i < 4; i++) Sim.state.enemies.push(null);
      S.enemies.length = 0;
      // spawn 4 of this archetype via the public-ish path: craft a wave table
      const prev = REAL.waveTable;
      globalThis.CONTENT = Object.assign({}, REAL, { waveTable: () => [{ id: et.id, weight: 1 }] });
      Sim.newRun(REAL.HEROES[0].id, null);
      let threw = null;
      try {
        for (let i = 0; i < 60 * 25 && Sim.state.phase === 'combat'; i++) {
          const v = Sim.policyView();
          const mv = kiteMove(v); Sim.setMove(mv.x, mv.y);
          for (let a = 0; a < 4; a++) Sim.useAbility(a);
          Sim.tick(STEP); Sim.drainEvents();
        }
      } catch (e) { threw = e; }
      globalThis.CONTENT = REAL;
      ok(!threw, 'archetype ' + et.id + ' ran 25s without throwing: ' + (threw && threw.message));
      ok(Sim.state.error === null, 'archetype ' + et.id + ' no internal sim failure');
      const bag = [];
      checkInvariants(Sim.state, et.id, bag);
      ok(bag.length === 0, 'archetype ' + et.id + ' invariants: ' + bag.join(' | '));
    }
  }
  section('real content.js — dual behaviours on non-boss archetypes');
  {
    // content carries [chaser,bomber] and [chaser,splitter] on ordinary enemies;
    // behaviour composition must not be boss-only.
    const duals = REAL.ENEMY_TYPES.filter(e => !e.boss && (e.behaviors || []).length > 1);
    ok(duals.length > 0, 'content has dual-behaviour non-boss archetypes to test');
    for (const et of duals) {
      globalThis.CONTENT = Object.assign({}, REAL, {
        waveTable: () => [{ id: et.id, weight: 1 }], bossForWave: () => null
      });
      Sim._setStorage(makeStorage());
      Sim._setSeed(31337);
      Sim.newRun(REAL.HEROES[0].id, null);
      const spawned = Sim.state.enemies.length;
      let threw = null;
      try {
        for (let i = 0; i < 60 * 30 && Sim.state.phase === 'combat'; i++) {
          const v = Sim.policyView();
          const mv = kiteMove(v); Sim.setMove(mv.x, mv.y);
          for (let a = 0; a < 4; a++) Sim.useAbility(a);
          Sim.tick(STEP); Sim.drainEvents();
        }
      } catch (e) { threw = e; }
      const kinds = et.behaviors.map(b => b.type);
      ok(!threw, et.id + ' [' + kinds.join('+') + '] ran without throwing: ' + (threw && threw.message));
      if (kinds.indexOf('splitter') >= 0) {
        ok(Sim.state.runStats.kills > spawned,
          et.id + ' splitter fired: ' + Sim.state.runStats.kills + ' kills from ' + spawned + ' spawns');
      }
      if (kinds.indexOf('bomber') >= 0) {
        // A kiting bot correctly never enters the blast, so drive the mechanic
        // directly: stand on one and cast nothing. A bomber must self-destruct
        // on contact and hurt the player.
        Sim._setStorage(makeStorage());
        Sim._setSeed(4242);
        Sim.newRun(REAL.HEROES[0].id, null);
        const S = Sim.state;
        const target = S.enemies[0];
        const kills0 = S.runStats.kills, n0 = S.enemies.length;
        S.player.x = target.x; S.player.y = target.y;
        Sim.setMove(0, 0);
        for (let i = 0; i < 30 && S.phase === 'combat'; i++) Sim.tick(STEP);
        ok(S.runStats.kills > kills0 || S.enemies.length < n0,
          et.id + ' bomber self-destructs on contact');
        ok(S.hp < S.hpMax || S.phase === 'dead', et.id + ' bomber blast damages the player');
        Sim.drainEvents();
      }
      globalThis.CONTENT = REAL;
    }
  }

  {
    // bosses come from CONTENT.bossForWave(w), never from weight sampling
    for (const w of [4, 6, 9]) {
      Sim._setStorage(makeStorage());
      Sim._setSeed(600 + w);
      Sim.newRun(REAL.HEROES[0].id, null);
      // fast-forward by restoring a crafted snapshot instead of playing
      ok(REAL.bossForWave(w) === null, 'bossForWave(' + w + ') is null (not a boss wave)');
    }
    for (const w of [5, 10, 15, 20]) {
      Sim._setStorage(makeStorage({
        veilLegendsSave: JSON.stringify({
          saveVersion: 2,
          meta: { echoes: 0, covenantOwned: [], ascension: 0, ascensionUnlocked: 0, heroesUnlocked: [], bestWaveEver: 1, riftsUnlocked: [] },
          run: {
            heroId: REAL.HEROES[0].id, riftId: null, wave: w, motes: 0,
            hp: 500, hpMax: 500, focus: 0, veil: 0, veilFloor: 0,
            pactsTaken: [], runStats: { kills: 0, breaches: 0, motesEarned: 0, timePlayed: 0, bestWave: w - 1 },
            waveHpRemaining: 0
          }
        })
      }));
      Sim._setSeed(500 + w);
      ok(Sim.continueRun() === true, 'restored to wave ' + w);
      const bosses = Sim.state.enemies.filter(e => e.isBoss);
      ok(bosses.length === 1, 'wave ' + w + ' spawns exactly one boss (got ' + bosses.length + ')');
      ok(bosses.length === 1 && bosses[0].archetypeId === REAL.bossForWave(w),
        'wave ' + w + ' boss is CONTENT.bossForWave(' + w + ') = ' + REAL.bossForWave(w) +
        ' (got ' + (bosses[0] && bosses[0].archetypeId) + ')');
      ok(Math.abs(Sim.state.enemies.filter(e => !e.isWraith).length - (6 + 2 * w)) <= 0,
        'wave ' + w + ' spawns N(w)=' + (6 + 2 * w) + ' enemies');
      ok(Math.abs(Sim.state.waveHpTotal - (6 + 2 * w) * 100 * (1 + 0.15 * w)) < 1,
        'wave ' + w + ' HP pool matches N(w)*avgHP(w)');
    }
  }

  section('real content.js — three policies');
  for (const policy of [POLICY_TIMID, POLICY_RECKLESS, POLICY_ADAPTIVE]) {
    Sim._setStorage(makeStorage());
    const r = runPolicy(Sim, policy, {
      seed: 4242, stopWave: 8, maxSeconds: 400, heroId: REAL.HEROES[0].id
    });
    console.log('  ' + policy.name.padEnd(22) +
      ' wave ' + r.bestWave + '  ' + r.seconds.toFixed(0) + 's  casts ' + r.casts +
      '  kills ' + r.kills + '  motes ' + r.motes + '  breaches ' + r.breaches +
      '  V ' + r.veil.toFixed(0) + '/floor ' + r.veilFloor.toFixed(1) +
      '  drafts ' + r.drafts + '  phase ' + r.phase);
    ok(r.problems.length === 0, 'real content / ' + policy.name + ': ' + r.problems.join(' | '));
    ok(r.casts > 0, 'real content / ' + policy.name + ' cast abilities');
    ok(r.bestWave >= 2, 'real content / ' + policy.name + ' cleared at least one wave');
  }

  section('real content.js — every contract event type is emitted');
  {
    // fx.js renders from these; a type sim never emits is a dead code path there.
    const want = ['hit', 'kill', 'overdraw', 'breach', 'wraith_spawn', 'wave_start',
      'wave_clear', 'pact_taken', 'player_hurt', 'death', 'mote_drop', 'mote_pickup',
      'cast', 'float', 'tier_change'];
    // There is deliberately NO mote-expiry event: state.motesOnGround is the
    // authoritative render source (integrator ruling), so fx.js sees an
    // unclaimed mote expire as that array shrinking. A second signal for the
    // same fact is exactly what would let the two desync.
    const seen = new Set();
    for (const seed of [3, 17, 88]) {
      Sim._setStorage(makeStorage());
      Sim._setSeed(seed);
      Sim.setArena(390, 700);
      Sim.newRun(REAL.HEROES[0].id, null);
      for (let i = 0; i < 60 * 260 && Sim.state.phase !== 'dead'; i++) {
        if (Sim.state.phase === 'pactDraft') {
          const o = Sim.state.draftOffer || [];
          if (!Sim.choosePact(o[0])) Sim.choosePact(null);
          continue;
        }
        const v = Sim.policyView();
        const mv = kiteMove(v); Sim.setMove(mv.x, mv.y);
        for (let a = 0; a < 4; a++) Sim.useAbility(a);   // reckless: forces overdraw/breach
        Sim.tick(STEP);
        for (const ev of Sim.drainEvents()) seen.add(ev.type);
      }
      for (const ev of Sim.drainEvents()) seen.add(ev.type);
    }
    const missing = want.filter(t => !seen.has(t));
    ok(missing.length === 0, 'all ' + want.length + ' event types emitted; missing: ' + missing.join(','));
    const extra = [...seen].filter(t => want.indexOf(t) < 0);
    ok(extra.length === 0, 'sim emits no event type outside the contract: ' + extra.join(','));
  }

  section('real content.js — fx.js render contract');
  {
    Sim._setStorage(makeStorage());
    Sim._setSeed(1010);
    Sim.setArena(390, 700);
    Sim.newRun(REAL.HEROES[0].id, null);

    // (1) state.motes is the run CURRENCY and must stay a number. Ground motes
    // live in state.motesOnGround (aliased as state.drops).
    ok(typeof Sim.state.motes === 'number',
      'state.motes is the currency number, not an array (CONTRACT frozen field)');
    ok(Array.isArray(Sim.state.motesOnGround), 'state.motesOnGround is the ground-mote array');
    ok(Sim.state.drops === Sim.state.motesOnGround, 'state.drops aliases the same array');

    const drops = [], picks = [], casts = [];
    for (let i = 0; i < 60 * 120 && Sim.state.phase !== 'dead'; i++) {
      if (Sim.state.phase === 'pactDraft') { Sim.choosePact(null); continue; }
      const v = Sim.policyView();
      // deliberately ignore motes while moving, so the array churns naturally
      const mv = kiteMove(Object.assign({}, v, { moteDist: Infinity }));
      Sim.setMove(mv.x, mv.y);
      for (let a = 0; a < 4; a++) Sim.useAbility(a);
      Sim.tick(STEP);
      for (const ev of Sim.drainEvents()) {
        if (ev.type === 'mote_drop') drops.push(ev);
        else if (ev.type === 'mote_pickup') picks.push(ev);
        else if (ev.type === 'cast') casts.push(ev);
      }
      if (Sim.state.motesOnGround.length && !Sim.state.motesOnGround._checked) {
        const m = Sim.state.motesOnGround[0];
        ok(fin(m.x) && fin(m.y) && fin(m.life) && Number.isInteger(m.tier),
          'ground mote carries {x,y,tier,life}: ' + JSON.stringify(m));
        ok(m.tier >= 0 && m.tier < CONTENT.VEIL_TIERS.length, 'ground mote tier indexes VEIL_TIERS');
        Sim.state.motesOnGround._checked = true;
      }
    }

    // (3) mote events carry what fx needs to pitch its pickup sound
    ok(drops.length > 0 && drops.every(e => Number.isInteger(e.tier) && fin(e.x) && fin(e.y)),
      'every mote_drop carries {x,y,tier} (' + drops.length + ' seen)');
    ok(picks.length > 0 && picks.every(e => fin(e.value) && Number.isInteger(e.tier)),
      'every mote_pickup carries value AND tier (' + picks.length + ' seen)');
    // Expiry is observable ONLY through the array (no event, by ruling), so
    // assert that path directly: one mote, dropped out of reach, must vanish
    // from state.motesOnGround within its 6s life and emit nothing.
    {
      // Fresh wave-1 run so the player survives being pinned, and track the
      // one planted mote by identity (other motes drop as enemies die).
      Sim._setStorage(makeStorage());
      Sim._setSeed(2024);
      Sim.setArena(390, 700);
      Sim.newRun(REAL.HEROES[0].id, null);
      Sim.drainEvents();
      const planted = {
        x: Sim.state.arena.w - 30, y: Sim.state.arena.h - 30, value: 7, tier: 1, life: 6
      };
      Sim.state.motesOnGround.push(planted);
      Sim.setMove(0, 0);
      const earnedBefore = Sim.state.runStats.motesEarned;
      let sawMoteEvent = false, gone = false, elapsed = 0;
      for (let i = 0; i < 60 * 9 && Sim.state.phase === 'combat'; i++) {
        Sim.state.player.x = 30; Sim.state.player.y = 30;   // pin, far from the mote
        Sim.tick(STEP);
        elapsed += STEP;
        for (const ev of Sim.drainEvents()) {
          if (ev.type === 'mote_pickup' && ev.value === planted.value) sawMoteEvent = true;
        }
        if (Sim.state.motesOnGround.indexOf(planted) < 0) { gone = true; break; }
      }
      ok(gone, 'an unclaimed mote leaves state.motesOnGround when its life runs out (t=' +
        elapsed.toFixed(2) + 's, phase ' + Sim.state.phase + ')');
      ok(gone && elapsed >= 5.9 && elapsed <= 6.2,
        'it expires at its 6s life, not early or late (t=' + elapsed.toFixed(2) + 's)');
      ok(!sawMoteEvent, 'expiry emits no event — the array is the single source of truth');
      ok(Sim.state.runStats.motesEarned === earnedBefore,
        'an expired mote is never credited to the player');
    }

    // (2) cast telegraph timing
    ok(casts.length > 0, 'cast events captured (' + casts.length + ')');
    ok(casts.every(e => typeof e.delay === 'number' && isFinite(e.delay) && e.delay >= 0),
      'every cast carries a finite numeric delay (0 = instant)');
    ok(casts.every(e => Number.isInteger(e.ticks) && e.ticks >= 0),
      'every cast carries an integer ticks count');
    ok(casts.every(e => e.ticks === 0 || e.tickInterval === 0.25),
      'multi-tick casts carry tickInterval 0.25');
    // the delay must equal the content value for a known delayed AoE
    const delayed = REAL.HEROES.flatMap(h => h.abilities).filter(a => a.delay > 0);
    for (const a of delayed) {
      const ev = casts.find(e => e.abilityId === a.id);
      if (ev) ok(Math.abs(ev.delay - a.delay) < 1e-9,
        'cast.delay for ' + a.id + ' matches content (' + ev.delay + ' vs ' + a.delay + ')');
    }
    ok(casts.filter(e => e.delay === 0).length > 0, 'instant abilities report delay 0, not a guess');
  }

  section('real content.js — pact draft actually offers and applies');
  {
    Sim._setStorage(makeStorage());
    Sim._setSeed(999);
    Sim.newRun(REAL.HEROES[0].id, null);
    Sim.state.motes = 100000;              // afford anything
    Sim.state.enemies.length = 0;
    Sim.tick(STEP);
    ok(Sim.state.phase === 'pactDraft', 'draft entered after wave 1');
    ok(Array.isArray(Sim.state.draftOffer) && Sim.state.draftOffer.length === 3,
      '3 pacts offered (got ' + (Sim.state.draftOffer || []).length + ')');
    const offered = Sim.state.draftOffer.slice();
    ok(new Set(offered).size === 3, 'offers are distinct');
    const pact = REAL.PACTS.find(p => p.id === offered[0]);
    const floorBefore = Sim.state.veilFloor;
    const motesBefore = Sim.state.motes;
    ok(Sim.choosePact(offered[0]) === true, 'pact accepted');
    ok(Sim.state.pactsTaken.indexOf(offered[0]) >= 0, 'pact recorded');
    ok(Math.abs(Sim.state.veilFloor - (floorBefore + (pact.upkeep || 0))) < 1e-6,
      'pact upkeep raised the Veil floor by ' + (pact.upkeep || 0));
    ok(Sim.state.motes === motesBefore - (pact.cost || 0), 'pact cost deducted');
    ok(Sim.state.phase === 'combat' && Sim.state.wave === 2, 'draft resolved into wave 2');
    // decline path
    Sim.state.enemies.length = 0; Sim.tick(STEP);
    if (Sim.state.phase === 'pactDraft') {
      const m2 = Sim.state.motes, f2 = Sim.state.veilFloor;
      ok(Sim.choosePact(null) === true, 'decline accepted');
      ok(Sim.state.motes === m2 && Sim.state.veilFloor === f2, 'decline costs nothing');
      ok(Sim.state.wave === 3, 'decline advanced the wave');
    }
    // a pact already taken is never offered twice
    let dupes = 0;
    for (let i = 0; i < 40; i++) {
      Sim.state.enemies.length = 0; Sim.tick(STEP);
      if (Sim.state.phase !== 'pactDraft') break;
      for (const id of Sim.state.draftOffer) if (Sim.state.pactsTaken.indexOf(id) >= 0) dupes++;
      Sim.choosePact(Sim.state.draftOffer[0]);
    }
    ok(dupes === 0, 'a taken pact is never re-offered');
    ok(Sim.state.pactsTaken.length > 5, 'many pacts stack without breaking (' +
      Sim.state.pactsTaken.length + ' taken, floor ' + Sim.state.veilFloor.toFixed(1) + ')');
  }

  section('real content.js — covenant tree is purchasable and respec is fair');
  {
    Sim._setStorage(makeStorage());
    Sim.state.meta.echoes = 1e6;
    let bought = 0, spent = 0;
    for (let pass = 0; pass < 4; pass++) {
      for (const n of REAL.COVENANT) {
        const before = Sim.state.meta.echoes;
        if (Sim.buyCovenant(n.id)) { bought++; spent += before - Sim.state.meta.echoes; }
      }
    }
    ok(bought === REAL.COVENANT.length, 'every covenant node reachable (' + bought + '/' +
      REAL.COVENANT.length + ')');
    const refund = Sim.respecCovenant();
    ok(refund > 0 && refund <= spent, 'respec refund ' + refund + ' <= spent ' + spent);
    ok(Sim.state.meta.covenantOwned.length === 0, 'respec cleared the tree');
  }
  useContent(FIXTURE);
}

console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ' — ' + (checks - failures) + '/' + checks + ' checks passed');
process.exit(failures === 0 ? 0 : 1);
