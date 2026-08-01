/* Veil Legends — balance harness  (vault binding rule 2)
 *
 *   node test/balance.mjs            full run, exits 1 if a MANDATORY assertion fails
 *   node test/balance.mjs --quick    fewer seeds (smoke-speed)
 *   node test/balance.mjs --whatif   also run the proposed-constants counterfactual
 *
 * This file is READ-ONLY with respect to the game: it loads js/content.js and
 * js/sim.js by indirect eval into global scope (exactly as index.html does) and
 * drives the real Sim. It never writes to js/, css/ or index.html. The
 * "what-if" section mutates the IN-MEMORY CONTENT/TUNING objects only, and
 * restores them; nothing is persisted.
 *
 * Paths resolve relative to this file (import.meta.url) so it runs from any
 * clone and from any working directory.
 *
 * WHAT IS ASSERTED (DESIGN.md Part 5.5 — "mandatory"):
 *   #1  flat-V vs pulsed overdraw, three wave sizes: neither may dominate by
 *       more than 8% on motes-per-HP.
 *   #2  burnRequired(w,P) / (85 - veilFloor(P)) strictly increasing in w for
 *       every reachable Pact set P.
 *   #3  policy spread: timid ~w12-15, reckless ~w9-11, adaptive w20+.
 *   #4  invariants across every run: no exceptions, no NaN/Infinity, veil in
 *       [floor,100], motes never negative, hp <= hpMax, no enemy explosion.
 *
 * The loader, kiteMove and the three policies TIMID / RECKLESS / ADAPTIVE are
 * lifted verbatim from test/smoke.mjs so the two harnesses cannot drift.
 *
 * CURRENT STATUS (2026-08-01): this harness FAILS and exits 1. That is the
 * correct state, not a broken test. The measured balance does not meet
 * DESIGN 5.5 on any of its three mandatory points, and section 5's Veil
 * equilibrium probe explains why in one number. Do not relax an assertion to
 * make it green — change the constants, then re-measure with --whatif.
 *
 * It also reports its OWN measurement ceiling (section 10a). A crude
 * autoplayer is not expert play; any result at or above that ceiling is
 * saturated and must not be read as "the game is fixed".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const ARGV = new Set(process.argv.slice(2));
const QUICK = ARGV.has('--quick');
const WHATIF = ARGV.has('--whatif') || ARGV.has('--what-if');

/* ==================================================================== *
 * 0. plumbing                                                          *
 * ==================================================================== */

let failures = 0, checks = 0, warnings = 0;
const failLog = [];
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; failLog.push(msg); console.error('  FAIL: ' + msg); }
  return !!cond;
}
function warn(msg) { warnings++; console.warn('  WARN: ' + msg); }
function section(name) { console.log('\n=== ' + name); }
function sub(name) { console.log('\n-- ' + name); }

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

/* stats helpers — every headline number in this file is a distribution */
const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => (a.length ? sum(a) / a.length : 0);
function quantile(a, p) {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  const i = Math.min(b.length - 1, Math.max(0, Math.round((b.length - 1) * p)));
  return b[i];
}
const median = a => quantile(a, 0.5);
function fmtDist(a, dp) {
  dp = dp == null ? 1 : dp;
  if (!a.length) return 'n=0';
  return `n=${a.length} mean ${mean(a).toFixed(dp)} p10 ${quantile(a, .1).toFixed(dp)} ` +
    `p50 ${median(a).toFixed(dp)} p90 ${quantile(a, .9).toFixed(dp)} max ${Math.max(...a).toFixed(dp)}`;
}
function histogram(a) {
  const h = {};
  for (const v of a) h[v] = (h[v] || 0) + 1;
  return Object.keys(h).map(Number).sort((x, y) => x - y)
    .map(k => `${k}:${h[k]}`).join(' ');
}

/* ==================================================================== *
 * 1. load the real game                                                *
 * ==================================================================== */

globalThis.window = globalThis;   // content.js / sim.js attach to window

let Sim, CONTENT, T;
try {
  loadScript('js/content.js');
  loadScript('js/sim.js');
  Sim = globalThis.Sim;
  CONTENT = globalThis.CONTENT;
  T = Sim.TUNING;
} catch (err) {
  console.error('FATAL: could not load js/content.js + js/sim.js:', err);
  process.exit(1);
}

console.log('Veil Legends — balance harness' + (QUICK ? ' (--quick)' : ''));
console.log(`  content: ${CONTENT.HEROES.length} heroes, ${CONTENT.ENEMY_TYPES.length} enemy types, ` +
  `${CONTENT.PACTS.length} pacts, ${CONTENT.COVENANT.length} covenant nodes`);
console.log(`  tuning : k=${T.DAMAGE_PER_FOCUS} rho=${T.FOCUS_REGEN} q=${T.OVERDRAW_Q} ` +
  `decay=${T.VEIL_DECAY}/s settle=${T.SETTLE_WINDOW}s parOverrun=+${T.PAR_OVERRUN_VEIL}V/s ` +
  `atkPeriod=${T.ENEMY_ATTACK_PERIOD}s atkGrowth=${T.ENEMY_ATK_GROWTH}/wave`);

Sim._setStorage(makeStorage());

const HERO_IDS = CONTENT.HEROES.map(h => h.id);
const SEEDS = QUICK ? 8 : 12;                       // seeds per hero
const RUN_SEEDS = n => Array.from({ length: n }, (_, i) => 40_000 + i * 7919);
const STEP = 1 / 60;
const ARENA = { w: 390, h: 700 };                   // the shipped mobile-portrait size

/* ==================================================================== *
 * 2. policies  (kiteMove + TIMID/RECKLESS/ADAPTIVE copied from smoke.mjs)
 * ==================================================================== */

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

/* --- a fourth profile: "competent". ------------------------------------
   The three above are deliberately crude (they are the design's named
   extremes). A competent player keeps a standoff distance instead of fleeing
   flat-out, spends motes on the most expensive thing they can afford, and
   refuses upkeep once headroom is short. Its job is to answer "is the game
   winnable by someone who is trying", separately from "do the extremes
   differ". */
const PACT_BY_ID = Object.fromEntries(CONTENT.PACTS.map(p => [p.id, p]));
function standoffMove(v) {
  const want = 150;
  if (v.nearestDist < want && isFinite(v.nearestDist)) return kiteMove(v);
  // safe: close on the nearest target, but grab a mote first if one is closer
  if (v.moteDist < v.nearestDist && v.moteDist < 300) {
    const d = v.moteDist || 1;
    return { x: (v.moteX - v.px) / d, y: (v.moteY - v.py) / d };
  }
  const d = v.nearestDist || 1;
  return { x: (v.nearestX - v.px) / d, y: (v.nearestY - v.py) / d };
}
const POLICY_COMPETENT = {
  name: 'competent',
  move: standoffMove,
  cast(v) {
    const behindPar = v.parRemaining < v.parTotal * 0.35;
    const mayOverdraw = (v.waveHpRemaining > v.overdrawThreshold || behindPar) &&
      v.veil < 82 && v.hpFrac > 0.30;
    let best = null, bestScore = -1;
    for (let i = 0; i < v.abilities.length; i++) {
      const a = v.abilities[i];
      if (!a.ready) continue;
      if (a.cost > v.focus && !mayOverdraw) continue;
      if (a.kind === 'dash' && v.nearestDist > 200) continue;
      if (a.range < v.nearestDist && a.kind !== 'aoe' && a.kind !== 'dash') continue;
      // prefer expensive (high-damage) buttons when they are up
      const score = a.cost + (a.kind === 'aoe' && v.enemyCount >= 3 ? 20 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  },
  pact(v, offer) {
    const headroom = 85 - v.veilFloor;
    let pick = null, pickCost = -1;
    for (const id of offer) {
      const p = PACT_BY_ID[id];
      if (!p || p.cost > v.motes) continue;
      if (p.upkeep > 0 && headroom - p.upkeep < 35) continue;   // decline upkeep when tight
      if (p.cost > pickCost) { pickCost = p.cost; pick = id; }
    }
    if (pick) return pick;
    // nothing affordable/safe with upkeep: take a free one if offered
    for (const id of offer) {
      const p = PACT_BY_ID[id];
      if (p && p.cost <= v.motes && !(p.upkeep > 0)) return id;
    }
    return null;
  }
};

const CORE_POLICIES = [POLICY_TIMID, POLICY_RECKLESS, POLICY_ADAPTIVE, POLICY_COMPETENT];

/* ==================================================================== *
 * 3. invariant checking  (copied from smoke.mjs, + state.error)         *
 * ==================================================================== */

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

/* ==================================================================== *
 * 4. the run driver                                                     *
 * ==================================================================== */

/** One full run to death (or waveCap). Returns a rich record: everything the
 *  report needs to explain WHY a run ended, not just that it did. */
function runToDeath(policy, opts) {
  opts = opts || {};
  const waveCap = opts.waveCap || 30;
  const maxSeconds = opts.maxSeconds || 1800;
  const stallFactor = opts.stallFactor || 6;    // wave abandoned after 6x par
  const bag = [];

  Sim._setStorage(makeStorage());
  Sim._setSeed(opts.seed);
  Sim.setArena(ARENA.w, ARENA.h);
  Sim.newRun(opts.heroId, opts.riftId || null);

  const S = Sim.state;
  if (typeof policy.reset === 'function') policy.reset();

  const waves = [], draftLog = [];
  let t = 0, steps = 0, casts = 0, overdraws = 0, drafts = 0, declines = 0;
  let veilGained = 0, veilShed = 0, decayTicks = 0, prevVeil = S.veil, sinceOverdraw = 99;
  let cur = null, stalled = false;

  const openWave = () => {
    cur = {
      wave: S.wave, t0: t, hp0: S.hp, hpMax0: S.hpMax, veil0: S.veil, floor0: S.veilFloor,
      pool0: S.waveHpTotal, par: S.parTotal, motes0: S.motes, earned0: S.runStats.motesEarned,
      dealt: 0, taken: 0, veilPeak: S.veil, enemyPeak: S.enemies.length,
      poolEnd: S.waveHpTotal, cleared: false
    };
  };
  openWave();

  while (t < maxSeconds) {
    if (S.phase === 'dead') break;
    if (S.phase === 'pactDraft') {
      drafts++;
      const offer = (S.draftOffer || []).slice();
      const pv = Sim.policyView();
      const affordable = offer.filter(id => PACT_BY_ID[id] && PACT_BY_ID[id].cost <= pv.motes);
      draftLog.push({
        wave: S.wave + 1, motes: pv.motes, offered: offer.length,
        affordable: affordable.length,
        allAffordable: offer.length > 0 && affordable.length === offer.length,
        dearest: offer.length ? Math.max(...offer.map(id => (PACT_BY_ID[id] || { cost: 0 }).cost)) : 0
      });
      const pick = policy.pact(pv, offer);
      if (pick == null) declines++;
      const before = S.wave;
      if (!Sim.choosePact(pick)) { declines++; Sim.choosePact(null); }
      if (S.phase === 'pactDraft') { bag.push('stuck in pactDraft'); break; }
      if (S.wave <= before) bag.push('wave did not advance after draft');
      continue;
    }
    if (S.phase !== 'combat') break;
    if (S.wave > waveCap) break;

    if (cur.wave !== S.wave) {
      cur.cleared = true; waves.push(cur); openWave();
      if (opts.godHeal) S.hp = S.hpMax;
    }
    if (opts.godVeil) { S.veil = S.veilFloor; }
    if (opts.godFocus) { S.focus = S.focusMax; }
    if (t - cur.t0 > cur.par * stallFactor) { stalled = true; break; }

    const view = Sim.policyView();
    const mv = policy.move(view);
    Sim.setMove(mv.x, mv.y);
    const idx = policy.cast(view);
    let didOverdraw = false;
    if (idx != null) {
      const costed = view.abilities[idx] ? view.abilities[idx].cost : 0;
      const hadFocus = S.focus;
      if (Sim.useAbility(idx)) { casts++; if (costed > hadFocus) { overdraws++; didOverdraw = true; } }
    }
    if (didOverdraw) sinceOverdraw = 0; else sinceOverdraw += STEP;

    const hpBefore = S.hp;
    Sim.tick(STEP);
    t += STEP; steps++;
    /* COUNTERFACTUAL ONLY (opts.settleFromOverdraw): apply the decay the sim
       withheld, emulating "the settle window is measured from the last
       OVERDRAW, not the last cast". Off by default; used by --whatif. */
    if (opts.settleFromOverdraw && sinceOverdraw >= T.SETTLE_WINDOW && S.veil > S.veilFloor) {
      S.veil = Math.max(S.veilFloor, S.veil - T.VEIL_DECAY * STEP);
    }

    if (S.hp < hpBefore) cur.taken += hpBefore - S.hp;
    for (const ev of Sim.drainEvents()) if (ev.type === 'hit') cur.dealt += ev.amount;

    const dv = S.veil - prevVeil;
    if (dv > 0) veilGained += dv; else if (dv < 0) { veilShed -= dv; decayTicks++; }
    prevVeil = S.veil;

    if (S.veil > cur.veilPeak) cur.veilPeak = S.veil;
    if (S.enemies.length > cur.enemyPeak) cur.enemyPeak = S.enemies.length;
    cur.poolEnd = S.waveHpTotal;

    if (steps % 17 === 0) checkInvariants(S, policy.name, bag);
    if (bag.length > 6) break;
  }
  checkInvariants(S, policy.name, bag);
  cur.tEnd = t;
  waves.push(cur);

  /* state at death — the thing the report needs */
  const contact = S.enemies.filter(e =>
    Math.hypot(e.x - S.player.x, e.y - S.player.y) <= e.size + T.PLAYER_R);
  const death = {
    wave: S.wave,
    hp: S.hp, hpMax: S.hpMax,
    veil: S.veil, veilFloor: S.veilFloor,
    headroom: 85 - S.veilFloor,
    parRemaining: S.parRemaining, parTotal: S.parTotal,
    overPar: S.parRemaining < 0,
    secondsIntoWave: t - cur.t0,
    enemiesAlive: S.enemies.length,
    wraiths: S.wraithCount,
    inContact: contact.map(e => e.archetypeId),
    waveHpRemaining: S.waveHpRemaining,
    waveHpTotal: S.waveHpTotal,
    fracWaveCleared: 1 - S.waveHpRemaining / Math.max(1, S.waveHpTotal),
    motes: S.motes,
    pacts: S.pactsTaken.slice()
  };

  return {
    seed: opts.seed, heroId: opts.heroId, policy: policy.name,
    seconds: t, steps, casts, overdraws, drafts, declines, stalled,
    bestWave: S.runStats.bestWave, phase: S.phase,
    kills: S.runStats.kills, breaches: S.runStats.breaches,
    motesEarned: S.runStats.motesEarned, motesUnspent: S.motes,
    veilFloor: S.veilFloor, veilGained, veilShed,
    decayDuty: steps ? decayTicks / steps : 0,
    waves, draftLog, death, problems: bag, simError: S.error || null
  };
}

/** Deterministic god-mode fast-forward to the start of wave W, then hand the
 *  wave over to `policy` from a clean, comparable state (full HP, Veil 0,
 *  floor 0, Focus full). Used for the per-wave experiments so that a wave's
 *  own difficulty is measured, not the accumulated state of the run. */
function isolateWave(seed, heroId, W, policy, opts) {
  opts = opts || {};
  Sim._setStorage(makeStorage());
  Sim._setSeed(seed);
  Sim.setArena(ARENA.w, ARENA.h);
  Sim.newRun(heroId, null);
  const S = Sim.state;
  if (typeof policy.reset === 'function') policy.reset();

  let t = 0, guard = 0;
  /* --- fast-forward --- */
  while (S.wave < W && guard++ < 400_000) {
    if (S.phase === 'dead') return null;
    if (S.phase === 'pactDraft') {
      /* opts.draft lets a caller build a real Pact loadout on the way up —
         chainCount / pierceCount only exist once someone has bought them, and
         some sim paths are only reachable with them. */
      let pick = null;
      if (opts.draft) { try { pick = opts.draft(Sim.policyView(), (S.draftOffer || []).slice()); } catch (e) { pick = null; } }
      if (!Sim.choosePact(pick)) Sim.choosePact(null);
      continue;
    }
    if (S.phase !== 'combat') return null;
    S.hp = S.hpMax; S.veilFloor = 0; S.veil = 0; S.focus = S.focusMax;
    S.motes = 6000;                       // fast-forward is not a mote test
    const v = Sim.policyView(); const mv = kiteMove(v); Sim.setMove(mv.x, mv.y);
    const i = POLICY_ADAPTIVE.cast(v); if (i != null) Sim.useAbility(i);
    Sim.tick(STEP); t += STEP; Sim.drainEvents();
    /* a god-mode player can stall a wave forever; force-clear so the
       fast-forward always terminates. Splicing the array is enough: the sim
       detects wave clear from state.enemies on the next tick. */
    if (S.parRemaining < -S.parTotal * 2) {
      for (let k = S.enemies.length - 1; k >= 0; k--) if (!S.enemies[k].isWraith) S.enemies.splice(k, 1);
    }
  }
  if (S.wave !== W || S.phase !== 'combat') return null;

  /* --- clean slate, then measure --- */
  S.hp = S.hpMax; S.veilFloor = 0; S.veil = 0; S.focus = S.focusMax;
  const rec = {
    wave: W, hero: heroId, seed, par: S.parTotal, pool0: S.waveHpTotal, hpMax: S.hpMax,
    dealt: 0, taken: 0, motes: 0, veilPeak: 0, veilSum: 0, ticks: 0,
    poolEnd: S.waveHpTotal, died: 0, cleared: 0, stalled: 0
  };
  const t0 = t, cap = S.parTotal * (opts.capFactor || 4);
  const bag = [];
  while (t - t0 < cap) {
    if (S.phase === 'dead') { rec.died = 1; break; }
    if (S.phase !== 'combat' || S.wave !== W) { rec.cleared = 1; break; }
    const v = Sim.policyView(); const mv = policy.move(v); Sim.setMove(mv.x, mv.y);
    const i = policy.cast(v); if (i != null) Sim.useAbility(i);
    const hpB = S.hp, mB = S.motes;
    Sim.tick(STEP); t += STEP;
    if (S.hp < hpB) rec.taken += hpB - S.hp;
    if (S.motes > mB) rec.motes += S.motes - mB;
    for (const ev of Sim.drainEvents()) if (ev.type === 'hit') rec.dealt += ev.amount;
    if (S.veil > rec.veilPeak) rec.veilPeak = S.veil;
    rec.veilSum += S.veil; rec.ticks++;
    rec.poolEnd = S.waveHpTotal;
    if (rec.ticks % 31 === 0) checkInvariants(S, 'isolate-w' + W, bag);
  }
  if (!rec.died && !rec.cleared) rec.stalled = 1;
  checkInvariants(S, 'isolate-w' + W, bag);
  rec.dur = Math.max(0.01, t - t0);
  rec.veilAvg = rec.ticks ? rec.veilSum / rec.ticks : 0;
  rec.problems = bag;
  return rec;
}

/* ==================================================================== *
 * 5. ASSERTION #4 (invariants) + baseline policy spread = ASSERTION #3  *
 * ==================================================================== */

section('ASSERTION #3 + #4 — policy spread and invariants over full runs');

const allRuns = [];
const byPolicy = {};
for (const policy of CORE_POLICIES) {
  const rows = [];
  for (const hero of HERO_IDS) {
    for (const seed of RUN_SEEDS(SEEDS)) {
      const r = runToDeath(policy, { seed: seed + hero.length, heroId: hero });
      rows.push(r); allRuns.push(r);
    }
  }
  byPolicy[policy.name] = rows;
}

sub('distribution of best wave reached (N=' + (HERO_IDS.length * SEEDS) + ' runs per policy)');
console.log('policy                  ' + 'bestWave distribution'.padEnd(52) +
  'died%  stall%  medSeconds  medMotes  medFloor');
for (const policy of CORE_POLICIES) {
  const rows = byPolicy[policy.name];
  const w = rows.map(r => r.bestWave);
  const died = rows.filter(r => r.phase === 'dead').length / rows.length;
  const stall = rows.filter(r => r.stalled).length / rows.length;
  console.log('  ' + policy.name.padEnd(22) + fmtDist(w, 1).padEnd(52) +
    (died * 100).toFixed(0).padStart(4) + '%' +
    (stall * 100).toFixed(0).padStart(6) + '%' +
    median(rows.map(r => r.seconds)).toFixed(0).padStart(12) +
    median(rows.map(r => r.motesEarned)).toFixed(0).padStart(10) +
    median(rows.map(r => r.veilFloor)).toFixed(1).padStart(10));
}
sub('best-wave histogram (wave:count)');
for (const policy of CORE_POLICIES) {
  console.log('  ' + policy.name.padEnd(22) + histogram(byPolicy[policy.name].map(r => r.bestWave)));
}

sub('per-hero median best wave');
console.log('  policy                ' + HERO_IDS.map(h => h.padStart(11)).join(''));
for (const policy of CORE_POLICIES) {
  const rows = byPolicy[policy.name];
  console.log('  ' + policy.name.padEnd(22) +
    HERO_IDS.map(h => median(rows.filter(r => r.heroId === h).map(r => r.bestWave)).toFixed(0).padStart(11)).join(''));
}

/* --- ASSERTION #4 --------------------------------------------------- */
sub('ASSERTION #4 — invariants');
const problemRuns = allRuns.filter(r => r.problems.length);
const errorRuns = allRuns.filter(r => r.simError);
ok(problemRuns.length === 0,
  `invariant violations in ${problemRuns.length}/${allRuns.length} runs; first: ` +
  (problemRuns[0] ? problemRuns[0].problems.slice(0, 3).join(' | ') : ''));
ok(errorRuns.length === 0,
  `sim threw in ${errorRuns.length}/${allRuns.length} runs; first: ` +
  (errorRuns[0] ? errorRuns[0].simError : ''));
if (errorRuns.length) {
  const byWave = {};
  for (const r of errorRuns) byWave[r.death.wave] = (byWave[r.death.wave] || 0) + 1;
  console.log('    exceptions by wave: ' + JSON.stringify(byWave));
  console.log('    message           : ' + errorRuns[0].simError);
}
const stalls = allRuns.filter(r => r.stalled);
if (stalls.length) warn(`${stalls.length}/${allRuns.length} runs stalled (wave never cleared within 6x par)`);
ok(allRuns.every(r => r.motesEarned >= 0), 'motes never negative across every run');
ok(allRuns.every(r => r.death.hp <= r.death.hpMax + 1e-6), 'hp <= hpMax at end of every run');
ok(allRuns.every(r => r.death.veil >= r.death.veilFloor - 1e-6 && r.death.veil <= 100 + 1e-6),
  'veil within [floor,100] at end of every run');
ok(allRuns.every(r => r.death.enemiesAlive <= T.MAX_ENEMIES),
  'enemy count never exceeded MAX_ENEMIES (' + T.MAX_ENEMIES + ')');

/* --- ASSERTION #3 --------------------------------------------------- */
sub('ASSERTION #3 — policy spread (DESIGN 5.5#3: timid w12-15, reckless w9-11, adaptive w20+)');
const medTimid = median(byPolicy['timid (x=0)'].map(r => r.bestWave));
const medReck = median(byPolicy['reckless (max burn)'].map(r => r.bestWave));
const medAdapt = median(byPolicy['adaptive (threshold)'].map(r => r.bestWave));
const medComp = median(byPolicy['competent'].map(r => r.bestWave));
console.log(`  medians: timid ${medTimid}  reckless ${medReck}  adaptive ${medAdapt}  competent ${medComp}`);
ok(medTimid >= 12 && medTimid <= 15, `timid median wave ${medTimid}, DESIGN says 12-15`);
ok(medReck >= 9 && medReck <= 11, `reckless median wave ${medReck}, DESIGN says 9-11`);
ok(medAdapt >= 20, `adaptive median wave ${medAdapt}, DESIGN says 20+`);
ok(medAdapt > medReck && medAdapt > medTimid,
  `adaptive (${medAdapt}) must beat both extremes (timid ${medTimid}, reckless ${medReck})`);
/* the vault rule the design spread exists to serve: skill has to matter */
const spread = Math.max(medAdapt, medComp) / Math.max(1, Math.min(medTimid, medReck));
ok(spread >= 1.5, `best policy only reaches ${spread.toFixed(2)}x the worst policy's wave — ` +
  'if a bad strategy scores the same as a good one the central decision does not matter');

/* --- how runs end --------------------------------------------------- */
sub('state at death, aggregated (adaptive + competent)');
{
  const rows = byPolicy['adaptive (threshold)'].concat(byPolicy['competent']).filter(r => r.phase === 'dead');
  const d = rows.map(r => r.death);
  console.log('  wave              ' + fmtDist(d.map(x => x.wave), 1));
  console.log('  veil at death     ' + fmtDist(d.map(x => x.veil), 0));
  console.log('  veil floor        ' + fmtDist(d.map(x => x.veilFloor), 1));
  console.log('  headroom (85-fl)  ' + fmtDist(d.map(x => x.headroom), 1));
  console.log('  seconds into wave ' + fmtDist(d.map(x => x.secondsIntoWave), 1));
  console.log('  wave % cleared    ' + fmtDist(d.map(x => x.fracWaveCleared * 100), 0));
  console.log('  enemies alive     ' + fmtDist(d.map(x => x.enemiesAlive), 0));
  console.log('  wraiths           ' + fmtDist(d.map(x => x.wraiths), 1));
  console.log('  pacts held        ' + fmtDist(d.map(x => x.pacts.length), 1));
  console.log('  motes unspent     ' + fmtDist(d.map(x => x.motes), 0));
  const overPar = rows.filter(r => r.death.overPar).length / Math.max(1, rows.length);
  const earlyWave = rows.filter(r => r.death.secondsIntoWave < 8).length / Math.max(1, rows.length);
  console.log(`  died while over par: ${(overPar * 100).toFixed(0)}%   ` +
    `died in the first 8s of a wave: ${(earlyWave * 100).toFixed(0)}%`);
  const contact = {};
  for (const r of rows) for (const id of r.death.inContact) contact[id] = (contact[id] || 0) + 1;
  console.log('  touching at death : ' + (Object.keys(contact).sort((a, b) => contact[b] - contact[a])
    .map(k => k + '×' + contact[k]).join(' ') || '(nothing — died to ranged/AoE)'));
}

/* --- the Veil equilibrium probe ------------------------------------- */
sub('Veil equilibrium probe — is there a reachable steady state?');
{
  const rows = allRuns;
  const gained = rows.map(r => r.veilGained), shed = rows.map(r => r.veilShed);
  const duty = rows.map(r => r.decayDuty * 100);
  console.log('  Veil gained / run  ' + fmtDist(gained, 0));
  console.log('  Veil shed   / run  ' + fmtDist(shed, 0));
  console.log('  decay active       ' + fmtDist(duty, 1) + '  (% of combat ticks)');
  console.log('\n  policy                 shed/gained   decayDuty   Vgained   Vshed');
  for (const pol of CORE_POLICIES) {
    const rs = byPolicy[pol.name];
    const g = mean(rs.map(r => r.veilGained)), sh = mean(rs.map(r => r.veilShed));
    console.log('  ' + pol.name.padEnd(22) +
      (sh / Math.max(1e-9, g) * 100).toFixed(0).padStart(10) + '%' +
      (mean(rs.map(r => r.decayDuty)) * 100).toFixed(1).padStart(11) + '%' +
      g.toFixed(0).padStart(10) + sh.toFixed(0).padStart(8));
  }
  const fighters = byPolicy['adaptive (threshold)'].concat(byPolicy['competent']);
  const fg = mean(fighters.map(r => r.veilGained)), fsh = mean(fighters.map(r => r.veilShed));
  const ratio = fsh / Math.max(1e-9, fg);
  console.log(`\n  A player who is actually fighting (adaptive+competent) sheds ` +
    `${(ratio * 100).toFixed(0)}% of the Veil it gains.`);
  console.log(`  Decay is gated on ${T.SETTLE_WINDOW}s with NO cast AND parRemaining >= 0.`);
  ok(ratio > 0.75, `Veil sheds only ${(ratio * 100).toFixed(0)}% of what it gains for a fighting ` +
    'player: there is no reachable equilibrium, so Veil is a one-way ratchet');

  /* what does a Veil reset actually cost, in seconds of not attacking? */
  let fastest = Infinity, fastestName = '';
  for (const h of CONTENT.HEROES) for (const a of h.abilities) {
    if (a.maxCd < fastest) { fastest = a.maxCd; fastestName = h.id + '/' + a.id; }
  }
  const from = 85, to = 25;
  const idleNeeded = (from - to) / T.VEIL_DECAY + T.SETTLE_WINDOW;
  const par8 = 20 + 0.8 * 8;
  console.log(`  Fastest ability cooldown ${fastest}s (${fastestName}); every cast of every ability ` +
    'resets the settle window.');
  console.log(`  Shedding Veil ${from} -> ${to} therefore costs ${idleNeeded.toFixed(1)}s of ZERO ` +
    `casting, against a ${par8.toFixed(0)}s par clock at wave 8, during which wave HP does not fall.`);
  ok(idleNeeded < par8 * 0.5, `a full Veil reset costs ${idleNeeded.toFixed(1)}s of cast downtime vs a ` +
    `${par8.toFixed(0)}s par clock (wave 8) — recovery is unaffordable, which is what makes the ` +
    'ratchet terminal');
  console.log(`  Past par, decay is switched off entirely AND +${T.PAR_OVERRUN_VEIL} V/s is added: ` +
    'once behind, Veil is strictly increasing no matter what the player does.');
}

/* ==================================================================== *
 * 6. ASSERTION #1 — flat-V vs pulsed overdraw                           *
 * ==================================================================== */

section('ASSERTION #1 — flat-V vs pulsed overdraw, three wave sizes (DESIGN 5.5#1)');

/** Flat-V: hold Veil at a constant target; overdraw only while under it. */
function makeFlatV(target) {
  return {
    name: 'flat-V@' + target,
    move: standoffMove,
    cast(v) {
      const room = v.veil < target;
      for (let i = 0; i < v.abilities.length; i++) {
        const a = v.abilities[i];
        if (!a.ready) continue;
        if (a.cost > v.focus && !room) continue;
        if (a.kind === 'dash' && v.nearestDist > 200) continue;
        if (a.range < v.nearestDist && a.kind !== 'aoe' && a.kind !== 'dash') continue;
        return i;
      }
      return null;
    },
    pact(v, offer) { return null; }
  };
}

/** Pulse: burn to the top tier band, then hold all four buttons until Veil has
 *  bled back down, then burn again. This is the policy the tier exponent is
 *  supposed to make no better than flat. */
function makePulse(high, low) {
  /* DESIGN 5.2's own script: "burn 60% over regen for 17s, then hard-stop ...
     coast at 216, kite, let V bleed 70->33". Coast therefore means casting
     WITHIN Focus, not standing still. The hands-still fallback below exists
     because under the shipped settle rule a coasting player still resets the
     window on every cast and would shed nothing at all — so a competent pulse
     player would notice and stop casting. */
  let mode = 'burn', coastT = 0, coastV0 = 0;
  return {
    name: 'pulse(' + low + '->' + high + ')',
    reset() { mode = 'burn'; coastT = 0; coastV0 = 0; },
    move: standoffMove,
    cast(v) {
      if (mode === 'burn' && v.veil >= high) { mode = 'coast'; coastT = 0; coastV0 = v.veil; }
      else if (mode === 'coast' && v.veil <= Math.max(low, v.veilFloor + 2)) mode = 'burn';
      const coasting = (mode === 'coast');
      if (coasting) {
        coastT += STEP;
        if (coastT > 3 && coastV0 - v.veil < 5) return null;   // bleed is not happening
      }
      for (let i = 0; i < v.abilities.length; i++) {
        const a = v.abilities[i];
        if (!a.ready) continue;
        if (coasting && a.cost > v.focus) continue;            // coast = never overdraw
        if (a.kind === 'dash' && v.nearestDist > 200) continue;
        if (a.range < v.nearestDist && a.kind !== 'aoe' && a.kind !== 'dash') continue;
        return i;
      }
      return null;
    },
    pact(v, offer) { return null; }
  };
}

const FLAT = makeFlatV(55);          // mid of the ×4 band
const PULSE = makePulse(92, 20);     // ×16 band down to ×1
const WAVE_SIZES = [3, 6, 9];        // small / medium / large (DESIGN 5.3 uses w6)
const ISO_SEEDS = QUICK ? 4 : 8;

const flatVsPulse = [];
console.log('  wave |  pool | policy      | motes | HP lost | motes/HP | avgV | dur/par | died%');
for (const W of WAVE_SIZES) {
  const out = {};
  for (const pol of [FLAT, PULSE]) {
    const rows = [];
    for (const hero of HERO_IDS) {
      for (let s = 0; s < ISO_SEEDS; s++) {
        const r = isolateWave(60_000 + s * 131, hero, W, pol);
        if (r) rows.push(r);
      }
    }
    const motes = sum(rows.map(r => r.motes));
    const hp = sum(rows.map(r => r.taken));
    const mph = motes / Math.max(1, hp);
    out[pol.name] = { rows, motes, hp, mph };
    console.log(`  ${String(W).padStart(4)} | ${mean(rows.map(r => r.pool0)).toFixed(0).padStart(5)} | ` +
      `${pol.name.padEnd(11)} | ${(motes / rows.length).toFixed(0).padStart(5)} | ` +
      `${(hp / rows.length).toFixed(0).padStart(7)} | ${mph.toFixed(3).padStart(8)} | ` +
      `${mean(rows.map(r => r.veilAvg)).toFixed(0).padStart(4)} | ` +
      `${(mean(rows.map(r => r.dur)) / Math.max(1, mean(rows.map(r => r.par)))).toFixed(2).padStart(7)} | ` +
      `${(mean(rows.map(r => r.died)) * 100).toFixed(0).padStart(4)}%`);
    for (const r of rows) if (r.problems && r.problems.length) {
      ok(false, `flat/pulse isolation invariants (w${W}): ${r.problems.slice(0, 2).join(' | ')}`);
    }
  }
  const a = out[FLAT.name].mph, b = out[PULSE.name].mph;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  const dom = lo > 0 ? hi / lo : Infinity;
  const winner = a > b ? 'flat-V' : 'pulse';
  flatVsPulse.push({
    W, flat: a, pulse: b, dom, winner,
    flatMotes: out[FLAT.name].motes / out[FLAT.name].rows.length,
    pulseMotes: out[PULSE.name].motes / out[PULSE.name].rows.length,
    flatHp: out[FLAT.name].hp / out[FLAT.name].rows.length,
    pulseHp: out[PULSE.name].hp / out[PULSE.name].rows.length,
    moteRatio: (out[PULSE.name].motes / Math.max(1, out[PULSE.name].rows.length)) /
      Math.max(1e-9, out[FLAT.name].motes / Math.max(1, out[FLAT.name].rows.length))
  });
  console.log(`       -> ${winner} leads by ${((dom - 1) * 100).toFixed(1)}% on motes-per-HP ` +
    `(limit 8%)`);
  ok(dom <= 1.08, `wave ${W}: ${winner} dominates by ${((dom - 1) * 100).toFixed(1)}% ` +
    `on motes-per-HP (DESIGN 5.5#1 allows 8%)`);
}

/* If it fails, DESIGN 5.5#1 says the fix is the VEIL_TIERS exponent and
   nothing else. Compute the number to use. */
{
  const tiers = CONTENT.VEIL_TIERS.map(t => t.mult);
  const base = Math.pow(tiers[tiers.length - 1], 1 / (tiers.length - 1));  // 16^(1/4) = 2
  const worst = flatVsPulse.reduce((a, b) => (b.dom > a.dom ? b : a), flatVsPulse[0]);
  console.log(`\n  VEIL_TIERS mults ${JSON.stringify(tiers)} = base ${base.toFixed(2)}^n`);
  console.log(`  worst case wave ${worst.W}: ${worst.winner} +${((worst.dom - 1) * 100).toFixed(1)}%`);
  if (worst.dom <= 1.08) {
    console.log('  Tier exponent is inside tolerance at every wave size; no VEIL_TIERS change indicated.');
  } else {
    /* The two policies differ by roughly 2 tier steps of held Veil, so the mote
       side of the ratio scales like base^2. To move the observed dominance to
       the 8% limit:  base_new = base * (1.08/dom)^(1/2)  when PULSE leads
       (flatten the ladder), or base * (dom/1.08)^(1/2) when FLAT leads (steepen
       it, so holding a high band pays for the damage it costs). */
    const steps = 2;
    const raw = worst.winner === 'pulse'
      ? base * Math.pow(1.08 / worst.dom, 1 / steps)
      : base * Math.pow(worst.dom / 1.08, 1 / steps);
    const suggested = Math.min(4, Math.max(1.15, raw));
    const newMults = [1, 2, 3, 4].map(n => +Math.pow(suggested, n).toFixed(2));
    console.log(`  -> indicated VEIL_TIERS exponent base ${raw.toFixed(2)} (clamped to ${suggested.toFixed(2)}), ` +
      `i.e. mults [1, ${newMults.join(', ')}]`);
    /* Honesty guard: the tier exponent only moves the MOTES side of the ratio.
       If the two policies earn near-identical motes and differ only in HP lost,
       VEIL_TIERS is the wrong lever and the harness must say so. */
    for (const r of flatVsPulse) {
      if (r.dom > 1.08 && r.moteRatio < 1.15 && r.moteRatio > 0.87) {
        console.log(`  NOTE wave ${r.W}: motes are within ${((Math.abs(r.moteRatio - 1)) * 100).toFixed(0)}% ` +
          `(${r.flatMotes.toFixed(0)} vs ${r.pulseMotes.toFixed(0)}) — the whole gap is HP lost ` +
          `(${r.flatHp.toFixed(0)} vs ${r.pulseHp.toFixed(0)}). VEIL_TIERS cannot fix that; it only ` +
          'scales the mote side. Escalate as a design defect, do not retune the ladder.');
      }
    }
  }
}

/* ==================================================================== *
 * 7. ASSERTION #2 — runs must end                                       *
 * ==================================================================== */

section('ASSERTION #2 — burnRequired(w,P)/(85-veilFloor(P)) strictly increasing in w (DESIGN 5.5#2)');

/* Pure arithmetic over CONTENT — no simulation. Mirrors sim.js op semantics:
   keys ending in "Mult" multiply, everything else adds. */
function aggregate(pactIds) {
  const m = {
    focusRegenAdd: 0, focusMaxAdd: 0, hpMaxAdd: 0, parAdd: 0, upkeep: 0,
    damageMult: 1, meleeDamageMult: 1, projDamageMult: 1, aoeDamageMult: 1,
    cooldownMult: 1, overdrawRateMult: 1, veilDecayMult: 1
  };
  for (const id of pactIds) {
    const p = PACT_BY_ID[id]; if (!p) continue;
    m.upkeep += (p.upkeep || 0);
    const o = p.ops || {};
    for (const k of Object.keys(m)) {
      if (k === 'upkeep' || !(k in o)) continue;
      if (k.endsWith('Mult')) m[k] *= o[k]; else m[k] += o[k];
    }
  }
  return m;
}
const H_of = w => (6 + 2 * w) * 100 * (1 + 0.15 * w);   // DESIGN Part 7
const Tpar_of = (w, m) => 20 + 0.8 * w + m.parAdd;
const heroRegen = h => (CONTENT.HEROES.find(x => x.id === h) || { focusRegen: 18 }).focusRegen;

/* (a) DESIGN 5.1's own burn: B = (H - C)/30, C = 100k(1+V/50)/q.
      k scales with the pact damage multiplier; q with overdrawRateMult. */
function burnDesign(w, m) {
  const k = T.DAMAGE_PER_FOCUS * m.damageMult;
  const q = T.OVERDRAW_Q * m.overdrawRateMult;
  const V = m.upkeep;
  const C = 100 * k * (1 + V / 50) / q;
  return Math.max(0, H_of(w) - C) / 30;
}
/* (b) the burn par actually forces: Focus/s you must borrow to hit u_req,
      charged at q, over the whole par window. DESIGN Part 4 asserts this
      starts biting around wave 10. */
function burnPar(w, m, heroId) {
  const k = T.DAMAGE_PER_FOCUS * m.damageMult;
  const P0 = k * (heroRegen(heroId) + m.focusRegenAdd);
  const Tp = Tpar_of(w, m);
  const uReq = H_of(w) / Tp;
  const x = Math.max(0, uReq - P0) / k;
  return x * T.OVERDRAW_Q * m.overdrawRateMult * Tp;
}
const headroom = m => 85 - m.upkeep;

/* Reachable pact sets: one draft per wave from wave 2, so |P(w)| <= w-1.
   We test trajectories, not arbitrary sets, because the assertion is about
   monotonicity ALONG a run. Trajectories sampled:
     - decline everything (the floor case)
     - greedy-cheapest, greedy-most-upkeep, greedy-least-upkeep
     - every "focus regen" pact taken as early as its tier allows (the case
       that mathematically threatens monotonicity)
     - 200 random affordable trajectories against the measured mote income */
/* Cumulative motes EARNED by the moment wave w starts. Read straight off the
   per-wave records (earned0 = runStats.motesEarned at that wave's first tick),
   so it is measured, not modelled. */
const moteIncomeByWave = (() => {
  const buckets = {};
  for (const r of allRuns) {
    for (const wv of r.waves) {
      if (!wv || wv.wave == null) continue;
      (buckets[wv.wave] = buckets[wv.wave] || []).push(wv.earned0 || 0);
    }
  }
  const cum = {};
  for (let w = 1; w <= 30; w++) cum[w] = buckets[w] && buckets[w].length ? median(buckets[w]) : null;
  return cum;
})();

function tierAllowed(tier, w) {   // mirrors sim.js tierWeight gating
  if (tier <= 1) return true;
  if (tier === 2) return w > 3;
  return w > 8;
}
function trajectory(order, wMax) {
  const taken = [];
  const steps = [];
  let pool = [...order];
  for (let w = 2; w <= wMax; w++) {
    const idx = pool.findIndex(id => tierAllowed(PACT_BY_ID[id].tier, w));
    if (idx >= 0) { taken.push(pool[idx]); pool.splice(idx, 1); }
    steps.push({ w, set: taken.slice() });
  }
  return steps;
}

const P_ALL = CONTENT.PACTS.map(p => p.id);
const byUpkeepDesc = P_ALL.slice().sort((a, b) => (PACT_BY_ID[b].upkeep || 0) - (PACT_BY_ID[a].upkeep || 0));
const byUpkeepAsc = P_ALL.slice().sort((a, b) => (PACT_BY_ID[a].upkeep || 0) - (PACT_BY_ID[b].upkeep || 0));
const byCostAsc = P_ALL.slice().sort((a, b) => PACT_BY_ID[a].cost - PACT_BY_ID[b].cost);
const focusFirst = P_ALL.slice().sort((a, b) =>
  ((PACT_BY_ID[b].ops || {}).focusRegenAdd || 0) - ((PACT_BY_ID[a].ops || {}).focusRegenAdd || 0));

const TRAJ = [
  { name: 'decline everything', order: [] },
  { name: 'cheapest first', order: byCostAsc },
  { name: 'most upkeep first', order: byUpkeepDesc },
  { name: 'least upkeep first', order: byUpkeepAsc },
  { name: 'focus-regen first', order: focusFirst }
];
{
  /* random trajectories */
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < (QUICK ? 40 : 200); i++) {
    const o = P_ALL.slice();
    for (let j = o.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1));[o[j], o[k]] = [o[k], o[j]]; }
    TRAJ.push({ name: 'random#' + i, order: o, quiet: true });
  }
}

const W_LO = 2, W_HI = 25;
/* Two failure shapes, which want different fixes and must not be conflated:
     zeroFlat  — burnRequired is 0 on both sides. The economy is not "solved by
                 a pact", it simply never asked for a Veil burn at that wave.
     realFall  — burnRequired was positive and went DOWN. That is the "solved by
                 a pact" case, and the added pact is the one to reprice. */
function testMonotone(fn, label, wLo, heroId) {
  const offenders = {};      // pactId -> count of REAL falls it caused
  let realFall = 0, zeroFlat = 0, total = 0, exhausted = 0;
  const exemplars = [];
  const exhaustWaves = [];
  for (const tr of TRAJ) {
    const steps = trajectory(tr.order, W_HI);
    let prevR = null, prevSet = [];
    for (const st of steps) {
      if (st.w < wLo) { prevSet = st.set; continue; }
      const m = aggregate(st.set);
      /* headroom gone: the run is over by definition (DESIGN Part 3: the
         scarce resource is 85 - veilFloor). Not a monotonicity violation. */
      if (headroom(m) <= 0) { exhausted++; exhaustWaves.push(st.w); break; }
      const r = fn(st.w, m, heroId) / headroom(m);
      if (prevR != null) {
        total++;
        if (r <= prevR + 1e-9) {
          if (prevR <= 1e-9 && r <= 1e-9) zeroFlat++;
          else {
            realFall++;
            const added = st.set.filter(x => !prevSet.includes(x));
            for (const id of added) offenders[id] = (offenders[id] || 0) + 1;
            if (!added.length) offenders['(curve itself, no acquisition)'] =
              (offenders['(curve itself, no acquisition)'] || 0) + 1;
            if (exemplars.length < 5) {
              exemplars.push(`${tr.name}: w${st.w - 1} r=${prevR.toFixed(3)} -> w${st.w} r=${r.toFixed(3)}` +
                (added.length ? ` after taking ${added.join(',')}` : ' (no acquisition)'));
            }
          }
        }
      }
      prevR = r; prevSet = st.set;
    }
  }
  console.log(`  ${label}`);
  console.log(`      ${realFall}/${total} steps FELL from a positive value  (a pact solved the wave)`);
  console.log(`      ${zeroFlat}/${total} steps were flat at ZERO           (no burn was ever required)`);
  if (exhausted) {
    console.log(`      ${exhausted}/${TRAJ.length} trajectories spent all 85 headroom before w${W_HI} ` +
      `(median wave ${median(exhaustWaves)}) and were truncated there`);
  }
  for (const e of exemplars) console.log('      ' + e);
  const ranked = Object.keys(offenders).sort((a, b) => offenders[b] - offenders[a]).slice(0, 6);
  if (ranked.length) {
    console.log('      pacts to reprice, by number of real falls caused:');
    for (const id of ranked) {
      const q = PACT_BY_ID[id];
      console.log(`        ${String(offenders[id]).padStart(5)}  ${id}` +
        (q ? `  (tier ${q.tier}, cost ${q.cost}, upkeep ${q.upkeep}, ${JSON.stringify(q.ops)})` : ''));
    }
  }
  return { bad: realFall, zeroFlat, total, offenders, exhausted };
}

sub('(a) DESIGN 5.1 burn:  B = (H(w) - C(P))/30,  C = 100k(1+V/50)/q');
const monoA = testMonotone(burnDesign, 'B/headroom, all heroes (B has no hero term)', W_LO);
ok(monoA.bad === 0, `DESIGN 5.5#2 (design form): B/headroom FALLS from a positive value on ` +
  `${monoA.bad} of ${monoA.total} wave steps — a Pact solved the wave`);
ok(monoA.zeroFlat === 0, `DESIGN 5.5#2 (design form): B/headroom is pinned at ZERO on ` +
  `${monoA.zeroFlat} of ${monoA.total} wave steps — no Veil burn is required at all there`);

sub('(b) par-forced burn:  x = (H/T_par - k*rho_eff)/k, burned at q over T_par');
console.log('      (DESIGN Part 4 says this starts binding around wave 10; tested from w10 up)');
let monoB = { bad: 0, zeroFlat: 0, total: 0, offenders: {} };
for (const hero of HERO_IDS) {
  const r = testMonotone(burnPar, `burnPar/headroom [${hero}]`, 10, hero);
  monoB.bad += r.bad; monoB.zeroFlat += r.zeroFlat; monoB.total += r.total;
  for (const k of Object.keys(r.offenders)) monoB.offenders[k] = (monoB.offenders[k] || 0) + r.offenders[k];
}
ok(monoB.bad === 0, `DESIGN 5.5#2 (par form): FALLS from a positive value on ${monoB.bad} of ` +
  `${monoB.total} wave steps — a Pact solved the wave`);
ok(monoB.zeroFlat === 0, `DESIGN 5.5#2 (par form): pinned at ZERO on ${monoB.zeroFlat} of ` +
  `${monoB.total} wave steps at wave 10+ — par never forces an overdraw there`);

sub('when does par first force overdraw at all? (empty pact set)');
{
  const m0 = aggregate([]);
  const rows = [];
  for (const hero of HERO_IDS) {
    let first = null;
    for (let w = 2; w <= 25; w++) if (burnPar(w, m0, hero) > 0) { first = w; break; }
    rows.push(`${hero}: w${first == null ? '>25' : first}`);
  }
  console.log('  ' + rows.join('   '));
  console.log('  -> before that wave the Veil decision is optional: a player who never ' +
    'overdraws still makes par. DESIGN Part 4 places this crossover at w10.');
}

/* ==================================================================== *
 * 8. the late economy — is the Pact draft still a choice?               *
 * ==================================================================== */

section('LATE ECONOMY — motes banked vs the price of everything on offer');

{
  const costs = CONTENT.PACTS.map(p => p.cost).sort((a, b) => b - a);
  console.log('  pact prices: T1 ' +
    CONTENT.PACTS.filter(p => p.tier === 1).map(p => p.cost).sort((a, b) => a - b).join('/') +
    '  T2 ' + CONTENT.PACTS.filter(p => p.tier === 2).map(p => p.cost).sort((a, b) => a - b).join('/') +
    '  T3 ' + CONTENT.PACTS.filter(p => p.tier === 3).map(p => p.cost).sort((a, b) => a - b).join('/'));

  console.log('\n  wave | median motes EARNED by then | cost of the (w-1) most expensive pacts | ratio');
  const rows = [];
  for (let w = 2; w <= 14; w++) {
    if (moteIncomeByWave[w] == null) continue;
    const earned = moteIncomeByWave[w];
    const need = sum(costs.slice(0, w - 1));
    const ratio = need ? earned / need : Infinity;
    rows.push({ w, earned, need, ratio });
    if (earned > 0) {
      console.log(`  ${String(w).padStart(4)} | ${earned.toFixed(0).padStart(27)} | ` +
        `${need.toFixed(0).padStart(38)} | ${ratio.toFixed(2).padStart(5)}` +
        (ratio >= 1 ? '   <-- can afford every pact it will ever be offered' : ''));
    }
  }
  const solved = rows.find(r => r.earned > 0 && r.ratio >= 1);
  ok(!solved, solved
    ? `late economy is solved from wave ${solved.w}: median income ${solved.earned.toFixed(0)} motes ` +
    `covers the ${solved.w - 1} most expensive pacts (${solved.need}) — the draft stops being a ` +
    'purchase decision and becomes an upkeep-only decision'
    : 'motes remain scarce relative to pact prices');

  sub('mote income per wave (measured, all policies)');
  const perWave = {};
  for (const r of allRuns) {
    for (let i = 0; i < r.waves.length; i++) {
      const wv = r.waves[i];
      if (!wv || !wv.cleared) continue;
      (perWave[wv.wave] = perWave[wv.wave] || []).push(wv.motes0);
    }
  }
  /* motes0 is the bank at wave start; differences give per-wave income */
  console.log('  wave | median bank at wave start');
  for (let w = 1; w <= 12; w++) {
    if (!perWave[w] || !perWave[w].length) continue;
    console.log(`  ${String(w).padStart(4)} | ${median(perWave[w]).toFixed(0).padStart(6)}  (n=${perWave[w].length})`);
  }

  sub('is PRICE a constraint at the draft? (every draft, every run)');
  {
    const all = [];
    for (const r of allRuns) for (const d of r.draftLog) all.push(d);
    console.log('  wave | drafts | median motes | median affordable-of-3 | % where ALL 3 affordable');
    for (let w = 2; w <= 12; w++) {
      const rows = all.filter(d => d.wave === w);
      if (!rows.length) continue;
      console.log(`  ${String(w).padStart(4)} | ${String(rows.length).padStart(6)} | ` +
        `${median(rows.map(d => d.motes)).toFixed(0).padStart(12)} | ` +
        `${median(rows.map(d => d.affordable)).toFixed(0).padStart(22)} | ` +
        `${(rows.filter(d => d.allAffordable).length / rows.length * 100).toFixed(0).padStart(23)}%`);
    }
    /* The economy is "solved" once the player can afford whatever is put in
       front of them: at that point the draft is not a purchase, only an
       upkeep decision, and mote income has stopped being a scarcity. */
    const late = all.filter(d => d.wave >= 6);
    const solvedFrac = late.length ? late.filter(d => d.allAffordable).length / late.length : 0;
    console.log(`  from wave 6 on, all three offers were affordable in ` +
      `${(solvedFrac * 100).toFixed(0)}% of drafts (n=${late.length})`);
    ok(solvedFrac < 0.6, `from wave 6 on the player can afford the entire offer in ` +
      `${(solvedFrac * 100).toFixed(0)}% of drafts — motes have stopped being scarce and the ` +
      'draft is an upkeep decision only');
  }

  sub('what reckless actually banks and buys');
  const rk = byPolicy['reckless (max burn)'];
  console.log('  motes earned      ' + fmtDist(rk.map(r => r.motesEarned), 0));
  console.log('  motes left unspent' + fmtDist(rk.map(r => r.motesUnspent), 0));
  console.log('  pacts held        ' + fmtDist(rk.map(r => r.death.pacts.length), 1));
  console.log('  drafts offered    ' + fmtDist(rk.map(r => r.drafts), 1));
  const declineRate = mean(rk.map(r => r.drafts ? r.declines / r.drafts : 0));
  console.log(`  declined ${(declineRate * 100).toFixed(0)}% of drafts ` +
    '(DESIGN Part 4 wants declining to start ~wave 12)');
}

/* ==================================================================== *
 * 9. per-wave difficulty curve, isolated                                *
 * ==================================================================== */

section('DIFFICULTY CURVE — each wave measured from a clean slate');
console.log('  (full HP, Veil 0, floor 0, competent policy; capped at 4x par)');
console.log('  wave |  N | pool  | par | dur  | reqDPS | gotDPS | pool grow | HP lost | %maxHP | died | stall');
const curve = [];
for (let W = 2; W <= (QUICK ? 9 : 12); W++) {
  const rows = [];
  for (const hero of HERO_IDS) {
    for (let s = 0; s < (QUICK ? 3 : 5); s++) {
      const r = isolateWave(70_000 + s * 977, hero, W, POLICY_COMPETENT);
      if (r) rows.push(r);
    }
  }
  if (!rows.length) continue;
  const rec = {
    W, n: 6 + 2 * W,
    pool: mean(rows.map(r => r.pool0)), par: mean(rows.map(r => r.par)),
    dur: mean(rows.map(r => r.dur)),
    req: mean(rows.map(r => r.pool0 / r.par)),
    dps: mean(rows.map(r => r.dealt / r.dur)),
    grow: mean(rows.map(r => r.poolEnd / r.pool0)),
    taken: mean(rows.map(r => r.taken)),
    frac: mean(rows.map(r => r.taken / r.hpMax)),
    died: mean(rows.map(r => r.died)), stall: mean(rows.map(r => r.stalled))
  };
  curve.push(rec);
  console.log(`  ${String(W).padStart(4)} | ${String(rec.n).padStart(2)} | ${rec.pool.toFixed(0).padStart(5)} | ` +
    `${rec.par.toFixed(0).padStart(3)} | ${rec.dur.toFixed(1).padStart(4)} | ${rec.req.toFixed(0).padStart(6)} | ` +
    `${rec.dps.toFixed(0).padStart(6)} | ${rec.grow.toFixed(2).padStart(9)} | ${rec.taken.toFixed(0).padStart(7)} | ` +
    `${(rec.frac * 100).toFixed(0).padStart(5)}% | ${(rec.died * 100).toFixed(0).padStart(3)}% | ${(rec.stall * 100).toFixed(0)}%`);
}
{
  /* the curve must not have a cliff: HP-lost-per-wave should not more than
     double from one wave to the next. */
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (a.taken > 20 && b.taken / a.taken > 2) {
      warn(`difficulty cliff at wave ${b.W}: HP lost jumps ${a.taken.toFixed(0)} -> ` +
        `${b.taken.toFixed(0)} (x${(b.taken / a.taken).toFixed(2)}) vs wave ${a.W}`);
    }
  }
  /* the between-wave restore has to cover the average wave */
  const restore = T.HP_RESTORE_BETWEEN;
  const over = curve.filter(c => c.frac > restore);
  if (over.length) {
    console.log(`\n  between-wave restore is ${(restore * 100).toFixed(0)}% of max HP. Waves where the ` +
      `average wave costs MORE than that: ${over.map(c => c.W).join(', ')}`);
    console.log(`  first such wave: ${over[0].W} (costs ${(over[0].frac * 100).toFixed(0)}% of max HP). ` +
      'From there the HP budget is strictly falling.');
  }
  ok(!over.length || over[0].W >= 12,
    `HP attrition outruns the +${(restore * 100).toFixed(0)}% between-wave restore from wave ` +
    `${over.length ? over[0].W : '-'}; DESIGN Part 4 wants the squeeze to start around wave 8-12`);
}

/* ==================================================================== *
 * 10. wave-5 boss counterfactuals                                       *
 * ==================================================================== */

section('WAVE 5 — The Toll Collector, single-lever counterfactuals');
console.log('  (in-memory mutation of CONTENT only, restored after each trial)');
{
  const boss = CONTENT.ENEMY_TYPES.find(e => e.id === 'toll_collector');
  const snapshot = JSON.parse(JSON.stringify(boss));
  const restore = () => {
    boss.hp = snapshot.hp; boss.atk = snapshot.atk; boss.size = snapshot.size; boss.spd = snapshot.spd;
    boss.behaviors[0] = JSON.parse(JSON.stringify(snapshot.behaviors[0]));
    boss.behaviors[1] = JSON.parse(JSON.stringify(snapshot.behaviors[1]));
  };
  function trial(label, mutate) {
    if (mutate) mutate(boss);
    const rows = [];
    for (const hero of HERO_IDS) {
      for (let s = 0; s < (QUICK ? 3 : 6); s++) {
        const r = isolateWave(80_000 + s * 613, hero, 5, POLICY_COMPETENT);
        if (r) rows.push(r);
      }
    }
    restore();
    console.log(`  ${label.padEnd(34)} dur ${mean(rows.map(r => r.dur)).toFixed(1).padStart(5)}s/par ` +
      `${mean(rows.map(r => r.par)).toFixed(0)}  HPlost ${mean(rows.map(r => r.taken)).toFixed(0).padStart(4)}  ` +
      `pool× ${mean(rows.map(r => r.poolEnd / r.pool0)).toFixed(2)}  died ${(mean(rows.map(r => r.died)) * 100).toFixed(0).padStart(3)}%`);
    return { dur: mean(rows.map(r => r.dur)), taken: mean(rows.map(r => r.taken)), died: mean(rows.map(r => r.died)) };
  }
  const base = trial('baseline', null);
  trial('summon count 3 -> 1', b => b.behaviors[1].count = 1);
  trial('summon count 3 -> 0', b => b.behaviors[1].count = 0);
  trial('summon period 7 -> 12', b => b.behaviors[1].period = 12);
  trial('atk 34 -> 20', b => b.atk = 20);
  trial('hp 2600 -> 1700', b => b.hp = 1700);
  trial('size 50 -> 34', b => b.size = 34);
  trial('dashCd 4.5 -> 8', b => b.behaviors[0].dashCd = 8);

  /* the summoner adds HP the par clock never budgeted for */
  const husk = CONTENT.ENEMY_TYPES.find(e => e.id === 'husk');
  console.log(`\n  The summon tax: ${snapshot.behaviors[1].count} x ${husk.hp} HP every ` +
    `${snapshot.behaviors[1].period}s of husk, scaled into a wave whose whole pool is ` +
    `${(6 + 2 * 5) * 100 * (1 + 0.15 * 5)} HP over a ${20 + 0.8 * 5}s par clock.`);
  console.log('  It is time-proportional, so falling behind makes the wave bigger, which ' +
    'makes you fall further behind. Nothing else in the game does this.');
}

/* ==================================================================== *
 * 10a. how far can THIS autoplayer go with every pressure deleted?       *
 * ==================================================================== *
 * A crude autoplayer is not a human expert. Before believing any wave
 * number, measure the ceiling of the measuring instrument: run with Veil
 * pinned at the floor, HP fully restored every wave and Focus never empty.
 * Whatever wave that reaches is the harness's resolution limit — a balance
 * change that pushes runs near it has SATURATED the measurement, and the
 * harness must say so rather than claim the game is fixed. */

section('INSTRUMENT CEILING — autoplayer with Veil, HP and Focus pressure removed');
let CEILING = 0;
{
  const rows = [];
  for (const hero of HERO_IDS) {
    for (const seed of RUN_SEEDS(QUICK ? 4 : 8)) {
      rows.push(runToDeath(POLICY_COMPETENT, {
        seed: seed + hero.length, heroId: hero,
        godVeil: true, godHeal: true, godFocus: true
      }).bestWave);
    }
  }
  CEILING = median(rows);
  console.log('  best wave with all three pressures deleted: ' + fmtDist(rows, 1));
  console.log('  histogram: ' + histogram(rows));
  console.log(`  -> the harness can only resolve balance changes up to about wave ${CEILING}. ` +
    'Past that the autoplayer, not the economy, is what ends the run.');
  ok(CEILING >= 20, `the autoplayer tops out at wave ${CEILING} even with Veil, HP and Focus ` +
    'pressure deleted, so it CANNOT verify the DESIGN 5.5#3 "adaptive reaches w20+" target. ' +
    'That assertion needs either a stronger autoplayer or a human playtest.');
}

/* ==================================================================== *
 * 10b. deep-wave crash stress                                           *
 * ==================================================================== *
 * The full-run section above cannot reach waves 7+ because the run wall
 * stops it, so anything that only crashes with a Slagbrute (w7+) or a
 * Motherglass (w9+) on the field is invisible there. Isolate those waves and
 * hammer them with the pierce-heavy reckless policy. */

section('DEEP-WAVE CRASH STRESS — waves 6-13 in isolation');
{
  let runs = 0, errs = 0, invariants = 0;
  const errByWave = {}, msgs = new Set();
  for (let W = 6; W <= (QUICK ? 10 : 13); W++) {
    for (const hero of HERO_IDS) {
      for (let s = 0; s < (QUICK ? 2 : 4); s++) {
        for (const pol of [POLICY_RECKLESS, POLICY_COMPETENT]) {
          /* prefer chain/pierce/AoE pacts on the way up: a projectile that
             kills its target AND chains into a neighbour (or pops a bomber)
             removes 2+ entries from state.enemies inside one loop iteration. */
          const draft = (v, offer) => {
            const risky = offer.find(id => {
              const o = (PACT_BY_ID[id] || {}).ops || {};
              return o.chainCount > 0 || o.pierceCount > 0 || o.aoeRadiusMult > 1;
            });
            return risky || (offer.length ? offer[0] : null);
          };
          const r = isolateWave(90_000 + s * 383 + W * 17, hero, W, pol, { capFactor: 3, draft });
          if (!r) continue;
          runs++;
          if (r.problems && r.problems.length) {
            invariants++;
            for (const m of r.problems) {
              if (m.includes('sim error')) {
                errs++; errByWave[W] = (errByWave[W] || 0) + 1;
                msgs.add(m.replace(/^.*sim error: /, ''));
              }
            }
          }
        }
      }
    }
  }
  console.log(`  ${runs} isolated waves driven; ${invariants} with invariant problems, ` +
    `${errs} sim exceptions.`);
  if (errs) {
    console.log('  exceptions by wave: ' + JSON.stringify(errByWave));
    for (const m of msgs) console.log('  message: ' + m);
  }
  ok(errs === 0, `sim threw ${errs} exception(s) across ${runs} isolated deep waves: ` +
    (msgs.size ? [...msgs][0] : ''));
}

/* ==================================================================== *
 * 11. what-if: the proposed constants, measured                         *
 * ==================================================================== */

if (WHATIF) {
  section('WHAT-IF — proposed changes, applied in memory only (nothing written to disk)');
  const boss = CONTENT.ENEMY_TYPES.find(e => e.id === 'toll_collector');
  const save = {
    atkGrowth: T.ENEMY_ATK_GROWTH, atkPeriod: T.ENEMY_ATTACK_PERIOD,
    summon: boss.behaviors[1].count, summonPeriod: boss.behaviors[1].period, bossAtk: boss.atk,
    heroHp: CONTENT.HEROES.map(h => h.hp)
  };
  const minions = ['husk', 'wisp', 'cairnbound', 'slagbrute', 'motherglass', 'warden'];
  const stalkers = ['nettle', 'lancer', 'ashcaster'];
  const atkOf = {};
  for (const e of CONTENT.ENEMY_TYPES) atkOf[e.id] = e.atk;
  const scaleAtk = (ids, f) => { for (const id of ids) { const e = CONTENT.ENEMY_TYPES.find(x => x.id === id); if (e) e.atk = +(atkOf[id] * f).toFixed(1); } };
  const restoreAtk = () => { for (const e of CONTENT.ENEMY_TYPES) e.atk = atkOf[e.id]; };
  const tiers = CONTENT.VEIL_TIERS.map(t => t.mult);

  const cases = [
    {
      name: 'R1 sim  : settle window measured from last OVERDRAW',
      opts: { settleFromOverdraw: true }, apply: () => { }, undo: () => { }
    },
    {
      name: 'R2 sim  : PAR_OVERRUN_VEIL 4 -> 1.5 /s',
      apply: () => { T.PAR_OVERRUN_VEIL = 1.5; }, undo: () => { T.PAR_OVERRUN_VEIL = 4; }
    },
    {
      name: 'R3 sim  : ENEMY_ATTACK_PERIOD 1.0 -> 1.5s',
      apply: () => { T.ENEMY_ATTACK_PERIOD = 1.5; }, undo: () => { T.ENEMY_ATTACK_PERIOD = save.atkPeriod; }
    },
    {
      name: 'R4 sim  : ENEMY_ATK_GROWTH 0.10 -> 0.07 /wave',
      apply: () => { T.ENEMY_ATK_GROWTH = 0.07; }, undo: () => { T.ENEMY_ATK_GROWTH = save.atkGrowth; }
    },
    {
      name: 'R5 cont : minion atk x0.75, stalker atk x0.80',
      apply: () => { scaleAtk(minions, 0.75); scaleAtk(stalkers, 0.80); }, undo: restoreAtk
    },
    {
      name: 'R6 cont : hero HP x1.30',
      apply: () => { CONTENT.HEROES.forEach(h => h.hp = Math.round(h.hp * 1.30)); },
      undo: () => { CONTENT.HEROES.forEach((h, i) => h.hp = save.heroHp[i]); }
    },
    {
      name: 'R7 cont : Toll summon 3->1, period 7->9, atk 34->26',
      apply: () => { boss.behaviors[1].count = 1; boss.behaviors[1].period = 9; boss.atk = 26; },
      undo: () => { boss.behaviors[1].count = save.summon; boss.behaviors[1].period = save.summonPeriod; boss.atk = save.bossAtk; }
    },
    {
      name: 'R8 cont : VEIL_TIERS 1/2/4/8/16 -> 1/1.85/3.4/6.3/11.7',
      apply: () => { const v = [1, 1.85, 3.4, 6.3, 11.7]; CONTENT.VEIL_TIERS.forEach((t, i) => t.mult = v[i]); },
      undo: () => { CONTENT.VEIL_TIERS.forEach((t, i) => t.mult = tiers[i]); }
    },
    {
      name: 'PACKAGE R1+R2 (Veil equilibrium only)',
      opts: { settleFromOverdraw: true },
      apply: () => { T.PAR_OVERRUN_VEIL = 1.5; }, undo: () => { T.PAR_OVERRUN_VEIL = 4; }
    },
    {
      name: 'PACKAGE R3+R5+R6+R7 (content/attrition only)',
      apply: () => {
        T.ENEMY_ATTACK_PERIOD = 1.5; scaleAtk(minions, 0.75); scaleAtk(stalkers, 0.80);
        CONTENT.HEROES.forEach(h => h.hp = Math.round(h.hp * 1.30));
        boss.behaviors[1].count = 1; boss.behaviors[1].period = 9; boss.atk = 26;
      },
      undo: () => {
        T.ENEMY_ATTACK_PERIOD = save.atkPeriod; restoreAtk();
        CONTENT.HEROES.forEach((h, i) => h.hp = save.heroHp[i]);
        boss.behaviors[1].count = save.summon; boss.behaviors[1].period = save.summonPeriod; boss.atk = save.bossAtk;
      }
    },
    {
      name: 'PACKAGE ALL R1-R8',
      opts: { settleFromOverdraw: true },
      apply: () => {
        T.PAR_OVERRUN_VEIL = 1.5; T.ENEMY_ATTACK_PERIOD = 1.5; T.ENEMY_ATK_GROWTH = 0.07;
        scaleAtk(minions, 0.75); scaleAtk(stalkers, 0.80);
        CONTENT.HEROES.forEach(h => h.hp = Math.round(h.hp * 1.30));
        boss.behaviors[1].count = 1; boss.behaviors[1].period = 9; boss.atk = 26;
        const v = [1, 1.85, 3.4, 6.3, 11.7]; CONTENT.VEIL_TIERS.forEach((t, i) => t.mult = v[i]);
      },
      undo: () => {
        T.PAR_OVERRUN_VEIL = 4; T.ENEMY_ATTACK_PERIOD = save.atkPeriod; T.ENEMY_ATK_GROWTH = save.atkGrowth;
        restoreAtk(); CONTENT.HEROES.forEach((h, i) => h.hp = save.heroHp[i]);
        boss.behaviors[1].count = save.summon; boss.behaviors[1].period = save.summonPeriod; boss.atk = save.bossAtk;
        CONTENT.VEIL_TIERS.forEach((t, i) => t.mult = tiers[i]);
      }
    }
  ];
  console.log('  case'.padEnd(50) + CORE_POLICIES.map(pp => pp.name.slice(0, 9).padStart(11)).join(''));
  console.log('  ' + 'BASELINE'.padEnd(48) + CORE_POLICIES.map(pp =>
    (median(byPolicy[pp.name].map(r => r.bestWave)) + '/' +
      mean(byPolicy[pp.name].map(r => r.bestWave)).toFixed(1)).padStart(11)).join(''));
  for (const c of cases) {
    c.apply();
    const meds = [], means = [];
    for (const pol of CORE_POLICIES) {
      const w = [];
      for (const hero of HERO_IDS) for (const seed of RUN_SEEDS(QUICK ? 4 : 8)) {
        w.push(runToDeath(pol, Object.assign({ seed: seed + hero.length, heroId: hero }, c.opts || {})).bestWave);
      }
      meds.push(median(w)); means.push(mean(w));
    }
    c.undo();
    console.log('  ' + c.name.padEnd(48) +
      meds.map((m, i) => (m + '/' + means[i].toFixed(1)).padStart(11)).join(''));
  }
  console.log('  (cells are median/mean best wave. Design target for adaptive is 20+.)');
  console.log(`  NOTE: the instrument ceiling measured above is wave ${CEILING}. Any cell at or ` +
    'above it is saturated and understates the change.');

  /* The attrition curve is the policy-robust number: each wave is measured
     from full HP at Veil 0, so it reports what the WAVE costs rather than what
     the autoplayer survives. This is the table to judge the package on. */
  sub('isolated per-wave HP cost, baseline vs PACKAGE ALL (% of max HP)');
  const pkg = cases[cases.length - 1];
  const curveFor = () => {
    const out = {};
    for (let W = 4; W <= 12; W += 2) {
      const rows = [];
      for (const hero of HERO_IDS) {
        for (let sd = 0; sd < (QUICK ? 2 : 4); sd++) {
          const r = isolateWave(70_000 + sd * 977, hero, W, POLICY_COMPETENT);
          if (r) rows.push(r);
        }
      }
      out[W] = rows.length ? { frac: mean(rows.map(r => r.taken / r.hpMax)), died: mean(rows.map(r => r.died)) } : null;
    }
    return out;
  };
  const before = curveFor();
  pkg.apply();
  const after = curveFor();
  pkg.undo();
  console.log('  wave |  baseline HP cost  died% | package HP cost  died% | restore budget');
  for (const W of Object.keys(before)) {
    if (!before[W] || !after[W]) continue;
    console.log(`  ${String(W).padStart(4)} | ${(before[W].frac * 100).toFixed(0).padStart(17)}% ` +
      `${(before[W].died * 100).toFixed(0).padStart(5)}% | ${(after[W].frac * 100).toFixed(0).padStart(14)}% ` +
      `${(after[W].died * 100).toFixed(0).padStart(5)}% | ${(T.HP_RESTORE_BETWEEN * 100).toFixed(0).padStart(13)}%`);
  }
  console.log('  A wave that costs more than the restore budget is a net HP loss. The wave where ' +
    'that first happens is where the run has a finite countdown.');
  console.log('\n  (nothing above was written to js/. Re-run without --whatif to confirm ' +
    'the baseline is unchanged.)');
} else {
  console.log('\n(run with --whatif to measure the proposed constant changes)');
}

/* ==================================================================== *
 * 12. verdict                                                           *
 * ==================================================================== */

section('VERDICT');
console.log(`  ${checks} assertions, ${failures} failed, ${warnings} warnings, ` +
  `${allRuns.length} full runs simulated.`);
if (failures) {
  console.log('\n  failed assertions:');
  for (const f of failLog) console.log('    - ' + f);
}
console.log(failures ? '\nBALANCE HARNESS: FAIL' : '\nBALANCE HARNESS: PASS');
process.exit(failures ? 1 : 0);
