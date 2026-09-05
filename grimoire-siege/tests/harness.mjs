#!/usr/bin/env node
// Grimoire Siege — balance harness (vault rule 2).
// Extracts js/content.js + js/sim.js from the game directory at runtime and
// drives the REAL sim functions (generateWave, startWave, update, hitEnemy,
// towerStats, killEnemy, chooseBranch, recordRunEnd) headlessly under a
// virtual clock, with ui/fx entry points stubbed. Four autoplayer policies,
// N runs each, full 12 scripted waves + up to 10 endless waves.
//
// Usage:   node harness.mjs            (from grimoire-siege/tests/ or anywhere)
//          GRIMOIRE_DIR=/path/to/grimoire-siege node harness.mjs
//          RUNS=30 node harness.mjs
// Exit:    0 = all invariants held across all runs; nonzero = failure.
//
// Invariants asserted every simulated step of every run:
//   - no exceptions escape the real update()/spawn/schedule path
//   - gold/lives/investedGold finite, never NaN/Infinity, gold never negative
//   - lives clamped at >= 0
//   - every enemy hp finite; no dead (hp<=0) enemy persists across steps
//   - ledger reconciles continuously: START_GOLD + bounties + wave bonuses
//     - spends === gold (checked EVERY step, not just wave ends)
//   - wave index never exceeds WAVE_SCRIPT.length while !endlessMode
// Plus statically: generateWave(n) for n=1..40 stays finite and spawnable.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_DIRS = [
  process.env.GRIMOIRE_DIR,
  path.join(HERE, '..'),                                   // committed home: grimoire-siege/tests/
  HERE,
  '/home/gonzobonzob/projects/my-games/grimoire-siege',    // dev fallback
].filter(Boolean);

const GAME_DIR = CANDIDATE_DIRS.find(d => existsSync(path.join(d, 'js', 'content.js')) && existsSync(path.join(d, 'js', 'sim.js')));
if (!GAME_DIR) {
  console.error('FATAL: cannot locate grimoire-siege js/ (set GRIMOIRE_DIR)');
  process.exit(2);
}
let contentSrc = readFileSync(path.join(GAME_DIR, 'js', 'content.js'), 'utf8');
let simSrc = readFileSync(path.join(GAME_DIR, 'js', 'sim.js'), 'utf8');

// --patched: apply proposed balance-fix constants to the HARNESS COPY of the
// source (the repo is never touched) so fixes can be validated by re-run.
const PATCHED = process.argv.includes('--patched') || process.env.PATCHED === '1';
if (PATCHED) {
  const subs = [
    // [file, from, to]
    ['sim', 'const reward=Math.floor(12+e.maxHp/16);', 'const reward=Math.floor(8+e.maxHp/22);'],
    ['sim', 'const bonus=35+wave*10;', 'const bonus=20+wave*6;'],
  ];
  for (const [which, from, to] of subs) {
    const src = which === 'sim' ? simSrc : contentSrc;
    if (!src.includes(from)) { console.error('PATCH FAILED: source drifted, cannot find: ' + from); process.exit(2); }
    if (which === 'sim') simSrc = src.replace(from, to); else contentSrc = src.replace(from, to);
  }
  console.log('*** PATCHED MODE: harness-copy balance fixes applied (repo untouched) ***');
}

const RUNS = Math.max(1, Number(process.env.RUNS) || 30);
const ENDLESS_TARGET = 10;      // endless waves attempted past wave 12
const DT = 0.02;                // 50 Hz fixed step; max projectile 780 px/s
const DTMS = DT * 1000;         //   moves 15.6 px/step < min hit radius 18 px,
                                //   so no tunneling artifacts vs the real 60 fps loop.
const MAX_STEPS = Math.round(3600 / DT);   // 1h virtual per run = stall watchdog

// ---------------------------------------------------------------- utilities
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function fmt(x, d = 0) { return Number.isFinite(x) ? x.toFixed(d) : '—'; }

let failures = 0;
function fail(msg) { failures++; console.error('ASSERT FAIL: ' + msg); }

class RunAssert extends Error {}

// ---------------------------------------------------------------- sandbox
// The real content.js + sim.js run inside one function scope, with ui/fx
// stubs preluded and a driver API appended (same scope => it can read/write
// the sim's top-level let bindings and rebind killEnemy/onWaveCleared for
// ledger hooks). Timers and Math.random are virtualized per run.
const PRELUDE = `
'use strict';
var uiDirty=false;
var __gameOver=null;
function updateHUD(){}
function refreshGoldUI(){}
function flushGoldUI(){}
function render(){}
function showMsg(){}
function sfx(){}
function spark(){}
function ring(){}
function floater(){}
function portalBurst(){}
function buildTowerPanel(){}
function showGameOver(win){ __gameOver={win:!!win}; gameStarted=false; }
`;
// NOTE: 'use strict' is deliberately NOT inherited by the game source: strict
// mode would turn any accidental undeclared-global write in shipped code into
// a throw we want to catch. So the prelude ends before the sources and the
// sources run in their shipped (sloppy) semantics via separate concatenation.
const PRELUDE_SLOPPY = PRELUDE.replace("'use strict';\n", '');

const API_SRC = `
return {
  get gold(){return gold;},
  get lives(){return lives;},
  get wave(){return wave;},
  get kills(){return kills;},
  get waveActive(){return waveActive;},
  get waveState(){return waveState;},
  get enemies(){return enemies;},
  get towers(){return towers;},
  get projectiles(){return projectiles;},
  get nextWaveDef(){return nextWaveDef;},
  get endlessOffered(){return endlessOffered;},
  get endlessMode(){return endlessMode;},
  get investedGold(){return investedGold;},
  get gameStarted(){return gameStarted;},
  get gameOver(){return __gameOver;},
  get path(){return path;},
  get pathTotal(){return pathTotal;},
  consts:{TOWERS:TOWERS,RESIST_PROFILES:RESIST_PROFILES,WAVE_SCRIPT:WAVE_SCRIPT,ENDLESS:ENDLESS,
          LEAK_COST:LEAK_COST,BRANCHES:BRANCHES,START_GOLD:START_GOLD,START_LIVES:START_LIVES,
          PREP_TIME:PREP_TIME,WAVE_GAP:WAVE_GAP,SPAWN_INTERVAL:SPAWN_INTERVAL,
          MAX_TOWER_LEVEL:MAX_TOWER_LEVEL,DOT_INTERVAL:DOT_INTERVAL,BOSS_HP_MULT:BOSS_HP_MULT,
          ENEMY_BASE_SPEED:ENEMY_BASE_SPEED,FAST_MULT:FAST_MULT,BOSS_MULT:BOSS_MULT,
          SLOW_FACTOR:SLOW_FACTOR},
  init:function(){W=960;H=540;path=buildPath(W,H);computePathCum();gameStarted=true;paused=false;},
  update:function(dt){update(dt);},
  scheduleWave:function(d){scheduleWave(d);},
  beginEndless:function(){beginEndless();},
  claimVictory:function(){claimVictory();},
  recordRunEnd:function(){return recordRunEnd();},
  generateWave:function(n){return generateWave(n);},
  towerStats:function(t){return towerStats(t);},
  upgradeCost:function(t){return upgradeCost(t);},
  chooseBranch:function(t,w){return chooseBranch(t,w);},
  isValidPlacement:function(x,y){return isValidPlacement(x,y);},
  baseWaveCount:function(){return baseWaveCount();},
  // Exact ui.js onCanvasClick purchase semantics (ui does NOT call recordInvestment)
  placeTower:function(def,x,y){
    if(!def||gold<def.cost)return false;
    if(!isValidPlacement(x,y))return false;
    towers.push(Object.assign({},def,{x:x,y:y,cd:0,level:0,invested:def.cost,
      aim:-Math.PI/2,aimTo:-Math.PI/2,recoil:0,flash:0,phase:0}));
    gold-=def.cost;
    return true;
  },
  // Exact ui.js doPlainUpgrade semantics
  plainUpgrade:function(t){
    if(!t||(t.level||0)>=MAX_TOWER_LEVEL)return false;
    var c=upgradeCost(t);
    if(gold<c)return false;
    gold-=c;t.level=(t.level||0)+1;t.invested=(t.invested||t.cost)+c;
    return true;
  },
  hookGold:function(onDelta){
    var k=killEnemy;
    killEnemy=function(e){var b=gold;k(e);if(gold!==b)onDelta('bounty',gold-b);};
    var w=onWaveCleared;
    onWaveCleared=function(){var b=gold;w();onDelta('bonus',gold-b);};
  }
};
`;

function makeSandbox(seed) {
  const store = new Map();
  const localStorageStub = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => store.clear(),
  };
  let vnow = 0, tid = 1;
  const timers = new Map();
  const vSetTimeout = (fn, d) => { timers.set(tid, { at: vnow + Math.max(0, Number(d) || 0), fn, every: null }); return tid++; };
  const vSetInterval = (fn, d) => { timers.set(tid, { at: vnow + Math.max(1, Number(d) || 1), fn, every: Math.max(1, Number(d) || 1) }); return tid++; };
  const vClear = id => { timers.delete(id); };
  const warnings = [], errors = [];
  const consoleStub = {
    log: () => {},
    warn: (...a) => warnings.push(a.map(String).join(' ')),
    error: (...a) => errors.push(a.map(String).join(' ')),
  };
  const rng = mulberry32(seed);
  const MathStub = Object.create(Math);
  MathStub.random = rng;
  const rafStub = () => 0;

  const factory = new Function(
    'localStorage', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'requestAnimationFrame', 'console', 'Math',
    PRELUDE_SLOPPY + '\n' + contentSrc + '\n' + simSrc + '\n' + API_SRC
  );
  const api = factory(localStorageStub, vSetTimeout, vSetInterval, vClear, vClear,
    rafStub, consoleStub, MathStub);

  function advance(ms) {
    vnow += ms;
    let guard = 0;
    for (;;) {
      if (guard++ > 10000) throw new RunAssert('timer storm: >10000 timer fires in one step');
      let bestId = 0, best = null;
      for (const [id, t] of timers) if (t.at <= vnow && (!best || t.at < best.at)) { best = t; bestId = id; }
      if (!best) break;
      if (best.every) best.at += best.every; else timers.delete(bestId);
      best.fn();
    }
  }
  return { api, advance, vnow: () => vnow, warnings, errors };
}

// ------------------------------------------------------- placement spots
// Rank candidate build spots by path coverage (path samples within 110 px).
// Computed once per run against the real path/isValidPlacement.
function buildSpots(api) {
  const p = api.path;
  const samples = [];
  for (let i = 0; i < p.length - 1; i++) {
    const A = p[i], B = p[i + 1];
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const n = Math.max(1, Math.round(len / 12));
    for (let k = 0; k <= n; k++) samples.push({ x: A.x + (B.x - A.x) * k / n, y: A.y + (B.y - A.y) * k / n });
  }
  const spots = [];
  for (let x = 24; x <= 936; x += 22) {
    for (let y = 24; y <= 516; y += 22) {
      if (!api.isValidPlacement(x, y)) continue;   // empty board: pure geometry check
      let cov = 0;
      for (const s of samples) if (Math.hypot(s.x - x, s.y - y) <= 110) cov++;
      if (cov > 0) spots.push({ x, y, cov });
    }
  }
  spots.sort((a, b) => b.cov - a.cov);
  return spots;
}
function pickSpot(api, spots) {
  for (const s of spots) if (api.isValidPlacement(s.x, s.y)) return s;
  return null;
}

// ------------------------------------------------------- policy helpers
// Heuristic effective DPS for a (possibly hypothetical) tower — uses the REAL
// towerStats for numbers, heuristics only for aoe/chain/dot/slow weighting.
function heurDPS(api, C, def, level, branchPick) {
  const fake = Object.assign({}, def, { level, branch: branchPick || null });
  const s = api.towerStats(fake);
  let dps = s.dmg * 60 / s.rate;
  if (s.aoe > 0) dps *= 1 + s.aoe / 50;                       // splash multi-hit estimate
  if (s.chain > 0) {                                          // chain falloff 0.6^i
    let f = 0, c = 0.6;
    for (let i = 0; i < s.chain; i++) { f += c; c *= 0.6; }
    dps *= 1 + f;
  }
  if (s.dotDamage > 0) dps += s.dotDamage * Math.max(1, s.dotStacks) / C.DOT_INTERVAL * 0.6; // uptime discount
  if (s.slow) dps *= 1.35;                                    // slow utility credit
  return dps;
}
function effVsDef(def, cls) {
  const profs = (def && def.profiles && def.profiles.length) ? def.profiles : null;
  if (!profs) return 1;
  let sum = 0;
  for (const p of profs) sum += 1 - ((p.resists && p.resists[cls]) || 0);
  return sum / profs.length;
}

function makeDriver(api, ledger) {
  return {
    buy(def, x, y) {
      const b = api.gold;
      if (api.placeTower(def, x, y)) { ledger.spend += b - api.gold; return true; }
      return false;
    },
    upgrade(t) {
      const b = api.gold;
      if (api.plainUpgrade(t)) { ledger.spend += b - api.gold; return true; }
      return false;
    },
    branch(t, w) {
      const b = api.gold;
      if (api.chooseBranch(t, w)) { ledger.spend += b - api.gold; return true; }
      return false;
    },
  };
}

// ------------------------------------------------------- policies
function makePolicy(name, api, C, rng, spots, ledger) {
  const drv = makeDriver(api, ledger);

  function activeDef() {
    if (api.waveActive && api.waveState) return api.waveState.def;
    return api.nextWaveDef;
  }

  function competentCandidates(def) {
    const cands = [];
    for (const td of C.TOWERS) {
      const gain = heurDPS(api, C, td, 0) * effVsDef(def, td.dmgClass);
      cands.push({ v: gain / td.cost, cost: td.cost, run: () => { const s = pickSpot(api, spots); return !!s && drv.buy(td, s.x, s.y); } });
    }
    for (const t of api.towers) {
      const lvl = t.level || 0;
      const eff = effVsDef(def, t.dmgClass);
      if (lvl === 0) {
        const c = api.upgradeCost(t);
        const gain = (heurDPS(api, C, t, 1) - heurDPS(api, C, t, 0)) * eff;
        cands.push({ v: gain / c, cost: c, run: () => drv.upgrade(t) });
      } else if (lvl === 1 && !t.branch) {
        const c = api.upgradeCost(t);
        const ga = heurDPS(api, C, t, 2, 'a'), gb = heurDPS(api, C, t, 2, 'b');
        const which = ga >= gb ? 'a' : 'b';
        const gain = (Math.max(ga, gb) - heurDPS(api, C, t, 1)) * eff;
        cands.push({ v: gain / c, cost: c, run: () => drv.branch(t, which) });
      } else if (lvl === 2 && t.branch) {
        const c = api.upgradeCost(t);
        const gain = (heurDPS(api, C, t, 3, t.branch) - heurDPS(api, C, t, 2, t.branch)) * eff;
        cands.push({ v: gain / c, cost: c, run: () => drv.upgrade(t) });
      }
    }
    return cands.filter(c => c.cost <= api.gold).sort((a, b) => b.v - a.v);
  }

  if (name === 'COMPETENT') {
    // Reads the preview, buys best off-resist DPS/gold, upgrades freely,
    // branches to match the wave mix, sells nothing.
    return { act() {
      const def = activeDef();
      if (!def) return;
      for (let i = 0; i < 6; i++) {
        const cands = competentCandidates(def);
        if (!cands.length) break;
        if (!cands[0].run()) break;
      }
    } };
  }

  if (name === 'MONO') {
    // Preview-blind: spams the single best raw DPS/gold tower (+ Frost every
    // 4th), upgrades to L1. Never reads resists. The pre-overhaul solved build.
    let best = null, bestV = -1;
    for (const td of C.TOWERS) {
      const v = (td.dmg * 60 / td.rate) / td.cost;
      if (v > bestV) { bestV = v; best = td; }
    }
    const frost = C.TOWERS.find(t => t.slow) || best;
    let bought = 0;
    return { act() {
      for (let i = 0; i < 6; i++) {
        const l0 = api.towers.find(t => (t.level || 0) === 0 && api.upgradeCost(t) <= api.gold);
        if (l0) { if (!drv.upgrade(l0)) break; continue; }
        const td = (bought % 4 === 3) ? frost : best;
        if (api.gold < td.cost) break;
        const s = pickSpot(api, spots);
        if (!s || !drv.buy(td, s.x, s.y)) break;
        bought++;
      }
    } };
  }

  if (name === 'RECKLESS') {
    // Random affordable tower, random placement, no upgrades.
    return { act() {
      if (rng() > 0.12) return;   // acts ~every 1.7s of policy polling
      const td = C.TOWERS[Math.floor(rng() * C.TOWERS.length)];
      if (api.gold < td.cost) return;
      for (let tries = 0; tries < 25; tries++) {
        const x = 20 + rng() * 920, y = 20 + rng() * 500;
        if (api.isValidPlacement(x, y)) { drv.buy(td, x, y); return; }
      }
    } };
  }

  if (name === 'HOARDER') {
    // Builds the minimum it believes it needs, banks the rest.
    return { act() {
      if (api.waveActive) return;
      const def = api.nextWaveDef;
      if (!def) return;
      const rawHP = def.count * def.hp + (def.fast || 0) * def.hp + (def.boss || 0) * def.hp * C.BOSS_HP_MULT;
      const total = def.count + (def.fast || 0) + (def.boss || 0);
      const window_ = total * (C.SPAWN_INTERVAL / 1000) + api.pathTotal / (C.ENEMY_BASE_SPEED * def.spd);
      const need = (rawHP / Math.max(1, window_)) * 2.6;   // fudge for resists/overkill/idle-range/travel
      for (let i = 0; i < 6; i++) {
        let board = 0;
        for (const t of api.towers) board += heurDPS(api, C, t, t.level || 0, t.branch) * effVsDef(def, t.dmgClass);
        if (board >= need) break;
        const cands = competentCandidates(def);
        if (!cands.length) break;
        if (!cands[0].run()) break;
      }
    } };
  }

  throw new Error('unknown policy ' + name);
}

// ------------------------------------------------------- single run
function runOne(policyName, seed) {
  const sb = makeSandbox(seed);
  const api = sb.api;
  api.init();
  const C = api.consts;
  const scriptLen = C.WAVE_SCRIPT.length;

  const ledger = { bounty: 0, bonus: 0, spend: 0 };
  let clearedWave = 0, income12 = null, spend12 = null, livesAt12 = null;
  api.hookGold((kind, delta) => {
    ledger[kind] += delta;
    if (kind === 'bonus') {
      clearedWave = api.wave;
      if (clearedWave === scriptLen) { income12 = ledger.bounty + ledger.bonus; spend12 = ledger.spend; livesAt12 = api.lives; }
    }
  });

  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const spots = buildSpots(api);
  const pol = makePolicy(policyName, api, C, rng, spots, ledger);

  api.scheduleWave(C.PREP_TIME);

  const check = (cond, msg) => { if (!cond) throw new RunAssert(policyName + ' seed=' + seed + ' wave=' + api.wave + ' t=' + (sb.vnow() / 1000).toFixed(1) + 's: ' + msg); };
  let steps = 0, done = false;

  while (!done) {
    check(steps++ < MAX_STEPS, 'stall watchdog: run exceeded 1h virtual time');
    sb.advance(DTMS);                       // real setTimeout/setInterval spawns & scheduling
    if (api.gameStarted && !api.gameOver) api.update(DT);   // REAL update — throws propagate

    // ---- invariants, every step ----
    check(Number.isFinite(api.gold), 'gold is not finite: ' + api.gold);
    check(api.gold >= 0, 'gold went negative: ' + api.gold);
    check(Number.isFinite(api.lives), 'lives is not finite: ' + api.lives);
    check(api.lives >= 0, 'lives went negative: ' + api.lives);
    check(Number.isFinite(api.investedGold) && api.investedGold >= 0, 'investedGold invalid: ' + api.investedGold);
    if (!api.endlessMode) check(api.wave <= scriptLen, 'wave index ' + api.wave + ' past WAVE_SCRIPT bounds pre-endless');
    for (const e of api.enemies) {
      check(Number.isFinite(e.hp) && Number.isFinite(e.maxHp), 'enemy hp not finite: ' + e.hp);
      check(!e.dead, 'dead enemy persisted in enemies[]');
    }
    check(api.gold === C.START_GOLD + ledger.bounty + ledger.bonus - ledger.spend,
      'ledger mismatch: gold=' + api.gold + ' expected=' + (C.START_GOLD + ledger.bounty + ledger.bonus - ledger.spend) +
      ' (bounty=' + ledger.bounty + ' bonus=' + ledger.bonus + ' spend=' + ledger.spend + ')');

    if (api.gameOver) { done = true; break; }
    if (api.endlessOffered) {
      check(clearedWave === scriptLen, 'endless offered before wave ' + scriptLen + ' cleared');
      api.beginEndless();
    }
    if (clearedWave >= scriptLen + ENDLESS_TARGET && !api.waveActive && api.enemies.length === 0) { done = true; break; }
    if (steps % 10 === 0) pol.act();        // policy thinks at 200 ms virtual
  }

  const over = api.gameOver;
  const finalLives = api.lives;
  const end = api.recordRunEnd();           // REAL score path (invested-gold formula)
  check(Number.isFinite(end.highScore), 'score not finite');
  return {
    policy: policyName, seed,
    survived12: clearedWave >= scriptLen,
    deathWave: (over && !over.win) ? api.wave : null,
    clearedWave,
    endlessDepth: Math.max(0, clearedWave - scriptLen),
    finalLives,
    livesAt12,
    score: end.highScore,
    income12, spend12,
    bankedAtEnd: api.gold,
    errors: sb.errors.slice(),
  };
}

// ------------------------------------------------------- static checks
function staticChecks() {
  const sb = makeSandbox(1234);
  const api = sb.api;
  api.init();
  const C = api.consts;
  // generateWave(n) finite & spawnable for n = 1..40
  for (let n = 1; n <= 40; n++) {
    for (let trial = 0; trial < 25; trial++) {
      const d = api.generateWave(n);
      const ok = d && Number.isFinite(d.count) && d.count >= 1 && d.count <= 500
        && Number.isFinite(d.hp) && d.hp >= 1
        && Number.isFinite(d.spd) && d.spd > 0 && d.spd < 10
        && Number.isFinite(d.boss) && d.boss >= 0
        && Number.isFinite(d.fast) && d.fast >= 0
        && Array.isArray(d.profiles) && d.profiles.length >= 1
        && d.profiles.every(p => p && p.resists && Object.values(p.resists).every(v => Number.isFinite(v) && v >= 0 && v <= 0.9));
      if (!ok) { fail('generateWave(' + n + ') produced unspawnable def: ' + JSON.stringify(d)); return; }
    }
  }
  console.log('  static: generateWave(1..40) x25 rolls each — finite & spawnable  OK');

  // Wave income table (design §3 cross-check): expected income through wave 12
  let income = 0;
  C.WAVE_SCRIPT.forEach((row, i) => {
    const w = i + 1;
    const bounty = Math.floor(12 + row.hp / 16);
    const bossBounty = Math.floor(12 + row.hp * C.BOSS_HP_MULT / 16);
    income += row.count * bounty + (row.fast || 0) * bounty + (row.boss || 0) * bossBounty + (35 + w * 10);
  });
  console.log('  static: zero-leak income through wave 12 = ' + income + 'g (+' + C.START_GOLD + 'g start)');
  return income;
}

// "Optimal buy flips wave-to-wave" — sample real generateWave rolls, find the
// best single-target effective-DPS/gold tower per roll, count flips.
function flipAnalysis() {
  const sb = makeSandbox(777);
  const api = sb.api;
  api.init();
  const C = api.consts;
  const SAMPLES = 400;
  const perWaveBest = [];
  for (let n = 1; n <= 12; n++) {
    const counts = {};
    for (let s = 0; s < SAMPLES; s++) {
      const d = api.generateWave(n);
      let best = null, bv = -1;
      for (const td of C.TOWERS) {
        const v = (td.dmg * 60 / td.rate) * effVsDef(d, td.dmgClass) / td.cost;
        if (v > bv) { bv = v; best = td.name; }
      }
      counts[best] = (counts[best] || 0) + 1;
    }
    perWaveBest.push(counts);
  }
  // flip rate between consecutive waves (independent rolls)
  let flips = 0, trials = 0;
  for (let s = 0; s < SAMPLES; s++) {
    let prev = null;
    for (let n = 1; n <= 12; n++) {
      const d = api.generateWave(n);
      let best = null, bv = -1;
      for (const td of C.TOWERS) {
        const v = (td.dmg * 60 / td.rate) * effVsDef(d, td.dmgClass) / td.cost;
        if (v > bv) { bv = v; best = td.name; }
      }
      if (prev !== null) { trials++; if (best !== prev) flips++; }
      prev = best;
    }
  }
  console.log('\nOptimal-buy flip analysis (' + SAMPLES + ' sampled runs, best eff-DPS/gold tower per rolled wave):');
  perWaveBest.forEach((c, i) => {
    const parts = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + Math.round(100 * v / SAMPLES) + '%');
    console.log('  wave ' + String(i + 1).padStart(2) + ': ' + parts.join(', '));
  });
  const flipPct = 100 * flips / trials;
  console.log('  wave-to-wave flip rate of the best buy: ' + flipPct.toFixed(1) + '%');
  return flipPct;
}

// ------------------------------------------------------- main
console.log('Grimoire Siege balance harness — game dir: ' + GAME_DIR);
console.log('runs per policy: ' + RUNS + ', dt=' + DT + 's, endless target: +' + ENDLESS_TARGET + ' waves\n');

console.log('Static checks:');
staticChecks();
const flipPct = flipAnalysis();
if (flipPct < 20) fail('optimal buy barely flips (' + flipPct.toFixed(1) + '% wave-to-wave) — resist system not creating the decision');

const POLICIES = ['COMPETENT', 'MONO', 'RECKLESS', 'HOARDER'];
const results = {};
for (const pol of POLICIES) {
  const rs = [];
  process.stdout.write('\n' + pol + ': ');
  for (let i = 0; i < RUNS; i++) {
    const seed = (0x5EED0 + i * 7919 + POLICIES.indexOf(pol) * 104729) >>> 0;
    try {
      const r = runOne(pol, seed);
      if (r.errors.length) fail(pol + ' seed=' + seed + ' console.error from sim: ' + r.errors[0]);
      rs.push(r);
      process.stdout.write(r.survived12 ? (r.endlessDepth >= ENDLESS_TARGET ? '*' : '+') : '.');
    } catch (e) {
      if (e instanceof RunAssert) { fail(e.message); rs.push({ policy: pol, seed, crashed: true, survived12: false, deathWave: -1, clearedWave: 0, endlessDepth: 0, finalLives: 0, score: 0 }); }
      else { fail(pol + ' seed=' + seed + ' EXCEPTION from real sim: ' + (e && e.stack || e)); rs.push({ policy: pol, seed, crashed: true, survived12: false, deathWave: -1, clearedWave: 0, endlessDepth: 0, finalLives: 0, score: 0 }); }
      process.stdout.write('X');
    }
  }
  results[pol] = rs;
}
console.log('\n');

// ------------------------------------------------------- report
console.log('policy      | surv12 | med death wave | lives@12 | med final lives | med score | med endless depth | med banked');
console.log('------------|--------|----------------|----------|-----------------|-----------|-------------------|-----------');
for (const pol of POLICIES) {
  const rs = results[pol];
  const surv = rs.filter(r => r.survived12).length / rs.length;
  const deaths = rs.filter(r => r.deathWave != null && r.deathWave > 0).map(r => r.deathWave);
  console.log(
    pol.padEnd(11) + ' | ' + (100 * surv).toFixed(0).padStart(5) + '% | '
    + fmt(median(deaths)).padStart(14) + ' | '
    + fmt(median(rs.filter(r => r.livesAt12 != null).map(r => r.livesAt12))).padStart(8) + ' | '
    + fmt(median(rs.map(r => r.finalLives))).padStart(15) + ' | '
    + fmt(median(rs.map(r => r.score))).padStart(9) + ' | '
    + fmt(median(rs.map(r => r.endlessDepth))).padStart(17) + ' | '
    + fmt(median(rs.map(r => r.bankedAtEnd || 0))).padStart(9)
  );
}

const comp = results.COMPETENT, mono = results.MONO, reck = results.RECKLESS, hoard = results.HOARDER;
const survRate = rs => rs.filter(r => r.survived12).length / rs.length;
const cs = survRate(comp), ms = survRate(mono), rk = survRate(reck), hs = survRate(hoard);

const inc12 = comp.filter(r => r.income12 != null).map(r => r.income12);
console.log('\nCOMPETENT measured income through wave 12 (bounties+bonuses): median '
  + fmt(median(inc12)) + 'g; median spend by w12: ' + fmt(median(comp.filter(r => r.spend12 != null).map(r => r.spend12))) + 'g');

console.log('COMPETENT vs MONO survival spread: ' + (100 * (cs - ms)).toFixed(0) + ' points ('
  + (100 * cs).toFixed(0) + '% vs ' + (100 * ms).toFixed(0) + '%)');
console.log('HOARDER median score ' + fmt(median(hoard.map(r => r.score))) + ' vs COMPETENT ' + fmt(median(comp.map(r => r.score)))
  + ' (banked gold no longer scores; spread should favor COMPETENT)');

// ---- design-level pass/fail gates ----
if (cs < 0.8) fail('COMPETENT survival to wave 12 is ' + (100 * cs).toFixed(0) + '% (<80%) — competent play should win at a high rate');
if (rk > cs - 0.2) fail('RECKLESS survives at ' + (100 * rk).toFixed(0) + '% vs COMPETENT ' + (100 * cs).toFixed(0) + '% — careless play must die at a meaningful rate');
if (cs - ms < 0.25) fail('CENTRAL-DECISION DEFECT: preview-blind MONO survives at ' + (100 * ms).toFixed(0)
  + '% vs COMPETENT ' + (100 * cs).toFixed(0) + '% — reading the resist preview does not matter enough');
if (median(hoard.map(r => r.score)) >= median(comp.map(r => r.score)))
  fail('score exploit: HOARDER scores >= COMPETENT despite banking (investedGold fix ineffective)');

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
