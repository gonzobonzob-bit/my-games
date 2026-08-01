/* Veil Legends — js/sim.js
 * The entire simulation. Owner: systems-engineer. See CONTRACT.md.
 *
 * HARD RULES OBSERVED HERE
 *  - ZERO DOM / canvas / audio access. localStorage only through store().
 *  - NO timers of any kind (no setInterval / setTimeout / requestAnimationFrame).
 *    ui.js owns the one loop; Sim.tick(dt) is a pure step.
 *  - Everything is dt-scaled in SECONDS. No frame counting, no Date.now() in
 *    logic (Date.now is used only for a save timestamp).
 *  - Saves are untrusted input: validated field by field with hasOwnProperty,
 *    every number clamped, every array checked with Array.isArray, unknown
 *    enum keys dropped, schema version embedded and checked, all in try/catch.
 *  - Run snapshots are taken at wave boundaries only, so the old save-scum
 *    wave-refund exploit is structurally impossible, and the snapshot schema
 *    has no field for buffs/shields so the old Berserker-in-the-save exploit
 *    is structurally impossible too.
 *  - tick() is wrapped: an internal exception ends the run cleanly (echoes
 *    banked, phase -> 'dead') and is surfaced on state.error. It never leaves
 *    the caller with a frozen screen and never rethrows every frame.
 */
(function (g) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. Small utilities
   * ------------------------------------------------------------------ */

  var hasOwn = function (o, k) {
    return o != null && Object.prototype.hasOwnProperty.call(o, k);
  };
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, def, lo, hi) {
    if (!isNum(v)) return def;
    return clamp(v, lo, hi);
  }
  /** Reads a validated number off an untrusted object. */
  function fieldNum(o, k, def, lo, hi) {
    if (!hasOwn(o, k)) return def;
    return num(o[k], def, lo, hi);
  }
  /** Content authors may write 5 (percent) or 0.05 (fraction); accept both. */
  function pctToFrac(v) {
    if (!isNum(v) || v <= 0) return 0;
    return v > 1 ? v / 100 : v;
  }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }

  /* Deterministic PRNG (mulberry32) so the balance harness can repeat runs. */
  var _seed = 0x9e3779b9;
  /* Math.imul is ES2015; shim it so an older engine does not throw on the very
     first random number the sim asks for. */
  var imul = Math.imul || function (a, b) {
    var aHi = (a >>> 16) & 0xffff, aLo = a & 0xffff;
    var bHi = (b >>> 16) & 0xffff, bLo = b & 0xffff;
    return ((aLo * bLo) + (((aHi * bLo + aLo * bHi) << 16) >>> 0)) | 0;
  };
  function setSeed(s) { _seed = (isNum(s) ? (s >>> 0) : 0x9e3779b9) || 1; }
  function rnd() {
    _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
    var t = imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rndRange(a, b) { return a + rnd() * (b - a); }
  function rndInt(n) { return Math.floor(rnd() * n) % (n || 1); }

  /* ------------------------------------------------------------------ *
   * 1. Tuning constants (DESIGN.md is authoritative for every one of these)
   * ------------------------------------------------------------------ */

  var T = {
    FOCUS_REGEN: 18,          // rho
    OVERDRAW_Q: 0.8,          // Veil charged per Focus of deficit
    VEIL_MAX: 100,
    VEIL_DECAY: 4,            // per second, after the settle window
    SETTLE_WINDOW: 1.5,       // seconds with no cast before Veil decays
    BREACH_RESET: 60,
    MAX_VEIL_FLOOR: 90,       // hard cap; keeps breach from re-triggering instantly
    WRAITH_SPEED_MULT: 1.05,  // x player BASE speed
    WRAITH_BASE_HP: 220,
    PAR_OVERRUN_VEIL: 1.5,    // Veil per second past par; MUST stay under
                              // VEIL_DECAY or the overrun spiral is terminal
    PAR_OVERRUN_FLOOR: 0.1,   // permanent run floor per second past par
    HP_RESTORE_BETWEEN: 0.25, // +25% of hpMax
    MOTE_LIFE: 6,
    TICK_INTERVAL: 0.25,      // seconds between pulses of a `ticks` ability
    DAMAGE_PER_FOCUS: 12,     // k
    ENEMY_ATTACK_PERIOD: 1.5, // per-enemy contact cadence (no global i-frame).
                              // 1.0 put wave 5 at 48% of max HP against a 25%
                              // between-wave restore — the squeeze landed on
                              // DESIGN Part 4's onboarding runway.
    ENEMY_ATK_GROWTH: 0.10,   // per wave, linear
    PLAYER_R: 16,
    PICKUP_R: 26,
    MAX_ENEMIES: 90,
    MAX_PROJECTILES: 220,
    MAX_MOTES: 160,
    MAX_EVENTS: 600,
    SLOW_TICK: 0.05,          // seconds between O(n^2) housekeeping passes
    CHAIN_RANGE: 160,
    CHAIN_FALLOFF: 0.6,
    DMG_VARIANCE: 0.1,        // +/-10%
    EXECUTE_BASE: 0.3,
    CRIT_MULT_BASE: 2,
    DASH_INVULN: 0.4,
    SPAWN_MARGIN: 34
  };

  var SAVE_KEY = 'veilLegendsSave';
  var SCHEMA = 2;

  /* Every pact/covenant op key, with its identity value and combine rule.
     Keys ending in "Mult" multiply; everything else adds. */
  var OP_DEFS = {
    focusRegenAdd: { v: 0, mul: false },
    focusMaxAdd: { v: 0, mul: false },
    hpMaxAdd: { v: 0, mul: false },
    moveSpeedMult: { v: 1, mul: true },
    damageMult: { v: 1, mul: true },
    meleeDamageMult: { v: 1, mul: true },
    projDamageMult: { v: 1, mul: true },
    aoeDamageMult: { v: 1, mul: true },
    cooldownMult: { v: 1, mul: true },
    lifestealPct: { v: 0, mul: false },
    thornsPct: { v: 0, mul: false },
    executeThresholdAdd: { v: 0, mul: false },
    chainCount: { v: 0, mul: false },
    pierceCount: { v: 0, mul: false },
    aoeRadiusMult: { v: 1, mul: true },
    moteMagnetRadius: { v: 0, mul: false },
    moteLifeAdd: { v: 0, mul: false },
    parAdd: { v: 0, mul: false },
    veilDecayMult: { v: 1, mul: true },
    overdrawRateMult: { v: 1, mul: true },
    brinkGuard: { v: 0, mul: false },
    hpRestoreMultBetweenWaves: { v: 1, mul: true },
    critChanceAdd: { v: 0, mul: false },
    critMult: { v: T.CRIT_MULT_BASE, mul: true },
    wraithDamageMult: { v: 1, mul: true },   // player damage dealt TO wraiths
    settleWindowAdd: { v: 0, mul: false }
  };

  /* Ascension / rift mod keys. */
  var AMOD_DEFS = {
    moteLifeMult: { v: 1, mul: true },
    veilFloorAdd: { v: 0, mul: false },
    parMult: { v: 1, mul: true },
    enemySpeedMult: { v: 1, mul: true },
    enemyHpMult: { v: 1, mul: true },
    enemyCountAdd: { v: 0, mul: false },
    wraithHpMult: { v: 1, mul: true },
    hpRestoreMult: { v: 1, mul: true },
    settleWindowMult: { v: 1, mul: true }
  };

  var BEHAVIOR_TYPES = {
    chaser: 1, ranged: 1, charger: 1, splitter: 1,
    summoner: 1, orbiter: 1, shielder: 1, bomber: 1
  };
  var ABILITY_KINDS = { melee: 1, projectile: 1, dash: 1, execute: 1, aoe: 1 };

  /* Fallbacks so sim never crashes against a stub/absent content.js. */
  var FALLBACK_HERO = {
    id: '_fallback', name: 'Wanderer', icon: '@', hp: 1000, focusMax: 100,
    focusRegen: 18, atk: 100, spd: 375, color: '#7c3aed',
    abilities: [
      { id: 'f_strike', name: 'Strike', icon: '/', kind: 'melee', focusCost: 14, maxCd: 0.5, range: 95, lunge: true },
      { id: 'f_bolt', name: 'Bolt', icon: '*', kind: 'projectile', focusCost: 18, maxCd: 0.8, range: 340, speed: 520 },
      { id: 'f_burst', name: 'Burst', icon: 'o', kind: 'aoe', focusCost: 30, maxCd: 3, range: 130 },
      { id: 'f_step', name: 'Step', icon: '>', kind: 'dash', focusCost: 12, maxCd: 4, range: 200 }
    ]
  };
  var FALLBACK_ENEMY = {
    id: '_husk', name: 'Husk', shape: 'orb', color: '#94a3b8', size: 16,
    hp: 100, atk: 8, spd: 120, moteValue: 3, behaviors: [{ type: 'chaser' }]
  };

  /* ------------------------------------------------------------------ *
   * 2. Storage wrapper (injectable, always try/catch)
   * ------------------------------------------------------------------ */

  var _storage = null;
  try {
    if (typeof localStorage !== 'undefined' && localStorage) _storage = localStorage;
  } catch (e) { _storage = null; }

  function store() {
    return _storage;
  }
  function storeGet(k) {
    try { var s = store(); return s ? s.getItem(k) : null; } catch (e) { return null; }
  }
  function storeSet(k, v) {
    try { var s = store(); if (s) s.setItem(k, v); return true; } catch (e) { return false; }
  }
  function storeDel(k) {
    try { var s = store(); if (s) s.removeItem(k); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * 3. Content access (tolerant of a missing/partial CONTENT)
   * ------------------------------------------------------------------ */

  function C() {
    var c = g.CONTENT;
    return (c && typeof c === 'object') ? c : {};
  }
  function list(key) {
    var v = C()[key];
    return Array.isArray(v) ? v : [];
  }
  function findById(key, id) {
    var a = list(key);
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id) return a[i];
    return null;
  }
  function heroes() { var h = list('HEROES'); return h.length ? h : [FALLBACK_HERO]; }
  function getHero(id) {
    return findById('HEROES', id) || heroes()[0] || FALLBACK_HERO;
  }
  function enemyTypes() {
    var e = list('ENEMY_TYPES');
    return e.length ? e : [FALLBACK_ENEMY];
  }
  function getEnemyType(id) {
    var e = enemyTypes();
    for (var i = 0; i < e.length; i++) if (e[i] && e[i].id === id) return e[i];
    return null;
  }
  function veilTiers() {
    var t = C().VEIL_TIERS;
    if (!Array.isArray(t) || !t.length) {
      return [{ min: 0, mult: 1 }, { min: 25, mult: 2 }, { min: 50, mult: 4 },
      { min: 75, mult: 8 }, { min: 90, mult: 16 }];
    }
    return t;
  }
  function tierIndexFor(v) {
    var t = veilTiers(), idx = 0;
    for (var i = 0; i < t.length; i++) {
      var m = t[i] && isNum(t[i].min) ? t[i].min : 0;
      if (v >= m) idx = i;
    }
    return idx;
  }
  function tierMultFor(v) {
    var t = veilTiers(), e = t[tierIndexFor(v)];
    return (e && isNum(e.mult) && e.mult > 0) ? e.mult : 1;
  }

  /* Legacy-unit tolerance: the old game stored speeds per-frame (player 2.5,
     enemies ~1.2). The new sim is px/second. Anything implausibly small is
     treated as legacy and converted, so sim works with either convention. */
  function heroSpeed(v) {
    var s = num(v, 375, 0.1, 4000);
    return s < 20 ? s * 150 : s;
  }
  function enemySpeed(v) {
    var s = num(v, 120, 0.1, 4000);
    return s < 20 ? s * 120 : s;
  }
  function projSpeed(v, def) {
    var s = num(v, def, 1, 6000);
    return s < 60 ? s * 60 : s;
  }

  /* ------------------------------------------------------------------ *
   * 4. State
   * ------------------------------------------------------------------ */

  var state = {
    phase: 'menu',
    time: 0,
    wave: 0,
    parRemaining: 0,
    parTotal: 0,
    veil: 0,
    veilFloor: 0,
    veilTier: 0,
    focus: 0,
    focusMax: 100,
    motes: 0,
    hp: 0,
    hpMax: 1,
    waveHpRemaining: 0,
    waveHpTotal: 0,
    wraithCount: 0,
    arena: { w: 390, h: 700 },
    player: {
      x: 195, y: 350, vx: 0, vy: 0, spd: 375, heroId: null,
      color: '#7c3aed', icon: '@', invuln: 0, shield: 0
    },
    enemies: [],
    projectiles: [],
    motesOnGround: [],
    abilities: [],
    pactsTaken: [],
    draftOffer: null,
    heroId: null,
    riftId: null,
    lastRunEchoes: 0,
    error: null,
    runStats: { kills: 0, breaches: 0, motesEarned: 0, timePlayed: 0, bestWave: 0 },
    meta: {
      echoes: 0, covenantOwned: [], ascension: 0, ascensionUnlocked: 0,
      heroesUnlocked: [], bestWaveEver: 0, riftsUnlocked: []
    }
  };
  /* Alias: fx.js may look for either name; both point at ONE array that is
     only ever mutated in place, never reassigned. */
  state.drops = state.motesOnGround;

  var events = [];

  /* Internal (never serialised, never exposed on state): transient run data. */
  var run = null;          // null when no run is active
  var runSnapshot = null;  // last wave-boundary snapshot for the save file
  var mods = defaults(OP_DEFS);
  var amods = defaults(AMOD_DEFS);
  var slowAcc = 0;
  var halted = false;

  function defaults(defs) {
    var o = {};
    for (var k in defs) if (hasOwn(defs, k)) o[k] = defs[k].v;
    return o;
  }

  function emit(ev) {
    events.push(ev);
    if (events.length > T.MAX_EVENTS) events.splice(0, events.length - T.MAX_EVENTS);
  }

  /* ------------------------------------------------------------------ *
   * 5. Modifier aggregation
   * ------------------------------------------------------------------ */

  function accumulate(target, defs, ops) {
    if (!ops || typeof ops !== 'object') return;
    for (var k in defs) {
      if (!hasOwn(defs, k) || !hasOwn(ops, k)) continue;
      var v = ops[k];
      if (!isNum(v)) continue;
      if (defs[k].mul) {
        if (v > 0 && v < 1000) target[k] *= v;
      } else {
        target[k] += clamp(v, -100000, 100000);
      }
    }
  }

  /** Recompute all run modifiers from scratch (covenant + pacts). Called on
   *  newRun, on every pact taken and on continueRun — never incremental, so a
   *  modifier can never be applied twice or stranded after a reload. */
  function recomputeMods() {
    mods = defaults(OP_DEFS);
    if (!run) return;
    var i, n;
    var owned = state.meta.covenantOwned;
    for (i = 0; i < owned.length; i++) {
      n = findById('COVENANT', owned[i]);
      if (n) accumulate(mods, OP_DEFS, n.ops);
    }
    for (i = 0; i < state.pactsTaken.length; i++) {
      var p = findById('PACTS', state.pactsTaken[i]);
      if (p) accumulate(mods, OP_DEFS, p.ops);
    }
    /* Sanity clamps: a hand-edited save or a mis-typed content number must not
       invert the economy (a well-typed -500000 once turned costs into income). */
    mods.cooldownMult = clamp(mods.cooldownMult, 0.15, 5);
    mods.damageMult = clamp(mods.damageMult, 0.1, 20);
    mods.meleeDamageMult = clamp(mods.meleeDamageMult, 0.1, 20);
    mods.projDamageMult = clamp(mods.projDamageMult, 0.1, 20);
    mods.aoeDamageMult = clamp(mods.aoeDamageMult, 0.1, 20);
    mods.moveSpeedMult = clamp(mods.moveSpeedMult, 0.3, 3);
    mods.veilDecayMult = clamp(mods.veilDecayMult, 0.1, 8);
    mods.overdrawRateMult = clamp(mods.overdrawRateMult, 0.2, 4);
    mods.aoeRadiusMult = clamp(mods.aoeRadiusMult, 0.3, 4);
    mods.wraithDamageMult = clamp(mods.wraithDamageMult, 0.1, 20);
    mods.critMult = clamp(mods.critMult, 1, 12);
    mods.focusRegenAdd = clamp(mods.focusRegenAdd, -T.FOCUS_REGEN * 0.9, 200);
    mods.focusMaxAdd = clamp(mods.focusMaxAdd, -80, 2000);
    mods.hpMaxAdd = clamp(mods.hpMaxAdd, -5000, 100000);
    mods.parAdd = clamp(mods.parAdd, -60, 120);
    mods.brinkGuard = clamp(Math.floor(mods.brinkGuard), 0, 99);
    mods.chainCount = clamp(Math.floor(mods.chainCount), 0, 12);
    mods.pierceCount = clamp(Math.floor(mods.pierceCount), 0, 12);
    mods.moteMagnetRadius = clamp(mods.moteMagnetRadius, 0, 500);
    mods.moteLifeAdd = clamp(mods.moteLifeAdd, -5, 60);
    mods.settleWindowAdd = clamp(mods.settleWindowAdd, -1.4, 10);
    mods.hpRestoreMultBetweenWaves = clamp(mods.hpRestoreMultBetweenWaves, 0, 8);

    applyDerived();
  }

  function recomputeAmods() {
    amods = defaults(AMOD_DEFS);
    var asc = state.meta.ascension | 0;
    var all = list('ASCENSIONS');
    for (var i = 0; i < all.length; i++) {
      var a = all[i];
      if (a && isNum(a.level) && a.level <= asc && a.level >= 1) {
        accumulate(amods, AMOD_DEFS, a.mods);
      }
    }
    var rift = run ? findById('RIFTS', run.riftId) : null;
    if (rift) accumulate(amods, AMOD_DEFS, rift.mods);
    amods.parMult = clamp(amods.parMult, 0.3, 3);
    amods.enemySpeedMult = clamp(amods.enemySpeedMult, 0.3, 4);
    amods.enemyHpMult = clamp(amods.enemyHpMult, 0.2, 8);
    amods.enemyCountAdd = clamp(Math.floor(amods.enemyCountAdd), -5, 40);
    amods.moteLifeMult = clamp(amods.moteLifeMult, 0.1, 4);
    amods.wraithHpMult = clamp(amods.wraithHpMult, 0.2, 8);
    amods.hpRestoreMult = clamp(amods.hpRestoreMult, 0, 6);
    amods.settleWindowMult = clamp(amods.settleWindowMult, 0.2, 4);
    amods.veilFloorAdd = clamp(amods.veilFloorAdd, 0, T.MAX_VEIL_FLOOR);
  }

  /** hpMax / focusMax / cooldowns derive from base + mods. Buffs are NEVER
   *  folded into a base stat (that was the old Berserker save exploit); they
   *  live in run.buffs and are summed on read. */
  function applyDerived() {
    if (!run) return;
    var prevMax = state.hpMax;
    state.hpMax = Math.max(1, run.baseHp + mods.hpMaxAdd);
    if (state.hpMax > prevMax) state.hp += (state.hpMax - prevMax); // a +HP pact heals
    state.hp = clamp(state.hp, -1e9, state.hpMax);
    state.focusMax = Math.max(5, run.baseFocusMax + mods.focusMaxAdd);
    state.focus = clamp(state.focus, 0, state.focusMax);
    state.player.spd = effSpd();
    for (var i = 0; i < state.abilities.length; i++) {
      var a = state.abilities[i];
      a.maxCd = Math.max(0.05, a.baseMaxCd * mods.cooldownMult);
      if (a.cd > a.maxCd) a.cd = a.maxCd;
    }
  }

  function buffSum(stat) {
    if (!run) return 0;
    var s = 0;
    for (var i = 0; i < run.buffs.length; i++) {
      if (run.buffs[i].stat === stat) s += run.buffs[i].amount;
    }
    return s;
  }
  function effAtk() { return Math.max(0, run.baseAtk + buffSum('atk')); }
  function effSpd() {
    return Math.max(30, (run.baseSpd + buffSum('spd')) * mods.moveSpeedMult);
  }
  function effFocusRegen() {
    return Math.max(0, run.baseFocusRegen + mods.focusRegenAdd + buffSum('focusRegen'));
  }
  function settleWindow() {
    return Math.max(0.1, (T.SETTLE_WINDOW + mods.settleWindowAdd) * amods.settleWindowMult);
  }

  /* ------------------------------------------------------------------ *
   * 6. Wave construction
   * ------------------------------------------------------------------ */

  function waveCount(w) {
    return Math.max(1, Math.round(6 + 2 * w) + amods.enemyCountAdd);
  }
  function waveAvgHp(w) {
    return 100 * (1 + 0.15 * w) * amods.enemyHpMult;
  }
  function waveParTime(w) {
    return Math.max(5, (20 + 0.8 * w) * amods.parMult + mods.parAdd);
  }

  /** Weighted archetype roster for wave w. Consumes CONTENT.waveTable(w). */
  function rosterFor(w, count) {
    var table = null;
    try {
      if (typeof C().waveTable === 'function') table = C().waveTable(w);
    } catch (e) { table = null; }
    var entries = [];
    if (Array.isArray(table)) {
      for (var i = 0; i < table.length; i++) {
        var t = table[i];
        if (!t || typeof t !== 'object') continue;
        var et = getEnemyType(t.id);
        if (!et) continue;                       // drop unknown enum keys
        var wt = num(t.weight, 1, 0, 1e6);
        if (wt <= 0) continue;
        entries.push({ type: et, weight: wt });
      }
    }
    if (!entries.length) {
      var all = enemyTypes();
      for (var j = 0; j < all.length; j++) {
        if (all[j] && !all[j].boss) entries.push({ type: all[j], weight: 1 });
      }
      if (!entries.length) entries.push({ type: enemyTypes()[0] || FALLBACK_ENEMY, weight: 1 });
    }
    var total = 0;
    for (var k = 0; k < entries.length; k++) total += entries[k].weight;

    var picked = [], p, r, acc;
    for (var n = 0; n < count; n++) {
      r = rnd() * total; acc = 0; p = entries[entries.length - 1].type;
      for (var m = 0; m < entries.length; m++) {
        acc += entries[m].weight;
        if (r <= acc) { p = entries[m].type; break; }
      }
      picked.push(p);
    }

    /* Bosses are NEVER weight-sampled: content carries them in ENEMY_TYPES with
       boss:true and gives them weight 0 in waveTable, then names exactly one
       per boss wave through CONTENT.bossForWave(w) (rotation is content's).
       Sim substitutes it for one roster slot so N(w) and the HP pool are
       unchanged. Falls back to its own %5 rotation only if bossForWave is
       missing, so a partial content.js still produces boss waves. */
    var boss = null;
    try {
      if (typeof C().bossForWave === 'function') {
        var bid = C().bossForWave(w);
        if (typeof bid === 'string' && bid) boss = getEnemyType(bid);
      } else if (w % 5 === 0) {
        var bosses = [], et2 = enemyTypes();
        for (var b = 0; b < et2.length; b++) if (et2[b] && et2[b].boss) bosses.push(et2[b]);
        if (bosses.length) boss = bosses[(Math.floor(w / 5) - 1) % bosses.length];
      }
    } catch (e) { boss = null; }
    if (boss) {
      var already = false;
      for (var q = 0; q < picked.length; q++) if (picked[q] && picked[q].boss) { already = true; break; }
      if (!already) picked[0] = boss;
    }
    return picked;
  }

  function spawnPoint() {
    var W = state.arena.w, H = state.arena.h, M = T.SPAWN_MARGIN;
    var side = rndInt(4);
    if (side === 0) return { x: rndRange(0, W), y: -M };
    if (side === 1) return { x: W + M, y: rndRange(0, H) };
    if (side === 2) return { x: rndRange(0, W), y: H + M };
    return { x: -M, y: rndRange(0, H) };
  }

  function sanitizeBehaviors(bs) {
    var out = [];
    if (!Array.isArray(bs)) return [{ type: 'chaser' }];
    for (var i = 0; i < bs.length && out.length < 2; i++) {
      var b = bs[i];
      if (!b || typeof b !== 'object') continue;
      if (!hasOwn(BEHAVIOR_TYPES, b.type)) continue;   // unknown descriptor: dropped
      out.push(b);
    }
    return out.length ? out : [{ type: 'chaser' }];
  }

  function makeEnemy(type, w, hpOverride, at) {
    var t = type || FALLBACK_ENEMY;
    var pos = at || spawnPoint();
    var hp = isNum(hpOverride) ? hpOverride : num(t.hp, 100, 1, 1e7);
    var e = {
      x: pos.x, y: pos.y, vx: 0, vy: 0,
      hp: hp, maxHp: hp,
      size: num(t.size, 16, 4, 120),
      color: typeof t.color === 'string' ? t.color : '#94a3b8',
      shape: typeof t.shape === 'string' ? t.shape : 'orb',
      archetypeId: t.id,
      isWraith: false,
      isBoss: !!t.boss,
      slowMult: 1,
      /* internal */
      atk: num(t.atk, 8, 0, 1e5) * (1 + T.ENEMY_ATK_GROWTH * Math.max(0, w - 1)),
      spd: enemySpeed(t.spd),
      moteValue: num(t.moteValue, 2, 0, 1e5),
      behaviors: sanitizeBehaviors(t.behaviors),
      telegraph: 0, telegraphMax: num(t.telegraph, 0, 0, 10),
      atkTimer: rndRange(0, 0.6),
      slowTimer: 0,
      shieldAura: 0,
      st: {},              // per-behavior scratch
      dead: false,
      uid: ++uidCounter
    };
    return e;
  }
  var uidCounter = 0;

  function startWave(w) {
    state.wave = w;
    if (w > state.runStats.bestWave) state.runStats.bestWave = w;

    /* Transients never survive a wave boundary. */
    state.projectiles.length = 0;
    state.motesOnGround.length = 0;
    run.delayed.length = 0;
    run.buffs.length = 0;
    state.player.shield = 0;
    state.player.invuln = 0;

    /* Wraiths persist across waves; wave enemies do not. */
    for (var i = state.enemies.length - 1; i >= 0; i--) {
      if (!state.enemies[i].isWraith) state.enemies.splice(i, 1);
    }

    var count = waveCount(w);
    var pool = count * waveAvgHp(w);
    var roster = rosterFor(w, count);

    var baseSum = 0, k;
    for (k = 0; k < roster.length; k++) baseSum += num(roster[k].hp, 100, 1, 1e7);
    if (baseSum <= 0) baseSum = 1;
    var scale = pool / baseSum;   // pool always matches DESIGN N(w)*avgHP(w)

    run.hpScale = scale;

    /* Wraiths persist across waves and count against MAX_ENEMIES. At the cap
       this loop spawned NOTHING, so waveEnemiesAlive() was false on the next
       tick and onWaveClear() fired again immediately — an unbounded wave/echo
       farm (measured: wave 1 -> 601 in ten seconds of sim time). Guarantee the
       wave can always place at least one body by evicting the oldest wraiths,
       which only ever bites at a boundary the player cannot survive anyway. */
    while (state.enemies.length >= T.MAX_ENEMIES && roster.length) {
      var oldest = -1;
      for (k = 0; k < state.enemies.length; k++) {
        if (state.enemies[k].isWraith) { oldest = k; break; }
      }
      if (oldest < 0) break;             // nothing evictable: let the cap hold
      state.enemies.splice(oldest, 1);
      if (state.wraithCount > 0) state.wraithCount--;
    }

    var total = 0;
    for (k = 0; k < roster.length && state.enemies.length < T.MAX_ENEMIES; k++) {
      var hp = Math.max(1, num(roster[k].hp, 100, 1, 1e7) * scale);
      var e = makeEnemy(roster[k], w, hp, null);
      state.enemies.push(e);
      total += hp;
    }
    state.waveHpTotal = total;
    state.waveHpRemaining = total;

    state.parTotal = waveParTime(w);
    state.parRemaining = state.parTotal;
    state.phase = 'combat';
    state.draftOffer = null;
    for (var a = 0; a < state.abilities.length; a++) state.abilities[a].cd = 0;
    emit({ type: 'wave_start', wave: w });
  }

  function recomputeWaveHp() {
    var s = 0, n = 0;
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (e.isWraith) { n++; continue; }
      if (e.hp > 0) s += e.hp;
    }
    state.waveHpRemaining = Math.max(0, s);
    state.wraithCount = n;
  }

  /* ------------------------------------------------------------------ *
   * 7. Veil
   * ------------------------------------------------------------------ */

  function setVeil(v) {
    var nv = clamp(v, state.veilFloor, T.VEIL_MAX);
    if (nv !== state.veil) {
      state.veil = nv;
      var ti = tierIndexFor(nv);
      if (ti !== state.veilTier) {
        state.veilTier = ti;
        emit({ type: 'tier_change', tier: ti });
      }
    }
  }
  function addVeil(d) { setVeil(state.veil + d); }

  function checkBreach() {
    if (!run) return;          // the run can end mid-cast (bomber chain kill)
    var guards = 0;
    while (state.veil >= T.VEIL_MAX && guards++ < 4) {
      state.runStats.breaches++;
      emit({ type: 'breach', x: state.player.x, y: state.player.y });
      var available = mods.brinkGuard - run.brinkGuardUsed;
      if (available > 0) {
        run.brinkGuardUsed++;
      } else {
        spawnWraith();
      }
      state.veilFloor = Math.min(state.veilFloor, T.MAX_VEIL_FLOOR);
      setVeil(Math.max(T.BREACH_RESET, state.veilFloor));
      if (state.veil >= T.VEIL_MAX) { state.veil = T.MAX_VEIL_FLOOR; break; }
    }
  }

  function spawnWraith() {
    if (state.enemies.length >= T.MAX_ENEMIES) return;
    var pos = spawnPoint();
    var hp = T.WRAITH_BASE_HP * (1 + 0.15 * state.wave) * amods.wraithHpMult;
    var wr = makeEnemy({
      id: '_veilwraith', name: 'Veilwraith', shape: 'wisp', color: '#c4b5fd',
      size: 20, hp: hp, atk: 14, spd: 1, moteValue: 8,
      behaviors: [{ type: 'chaser' }]
    }, state.wave, hp, pos);
    wr.isWraith = true;
    /* 1.05x the player's BASE speed — unkiteable by design. */
    wr.spd = run.baseSpd * T.WRAITH_SPEED_MULT;
    wr.atk = 14 * (1 + T.ENEMY_ATK_GROWTH * Math.max(0, state.wave - 1));
    state.enemies.push(wr);
    state.wraithCount++;
    emit({ type: 'wraith_spawn', x: wr.x, y: wr.y });
  }

  /* ------------------------------------------------------------------ *
   * 8. Damage
   * ------------------------------------------------------------------ */

  function nearestEnemy(maxDist) {
    var best = null, bd = isNum(maxDist) ? maxDist : Infinity;
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (e.dead) continue;
      var d = hyp(e.x - state.player.x, e.y - state.player.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function rollDamage(base) {
    var v = base * (1 + rndRange(-T.DMG_VARIANCE, T.DMG_VARIANCE));
    var crit = false;
    var cc = pctToFrac(mods.critChanceAdd);
    if (cc > 0 && rnd() < cc) { v *= mods.critMult; crit = true; }
    return { amount: Math.max(1, v), crit: crit };
  }

  function dealDamage(e, base, opts) {
    if (!e || e.dead || !run) return 0;
    var r = rollDamage(base);
    var amount = r.amount;
    if (e.shieldAura > 0) amount *= (1 - clamp(e.shieldAura, 0, 0.9));
    if (e.isWraith) amount *= mods.wraithDamageMult;
    amount = Math.max(1, amount);
    if (amount > e.hp) amount = e.hp;
    e.hp -= amount;
    emit({ type: 'hit', x: e.x, y: e.y, amount: Math.round(amount), crit: r.crit });
    var ls = pctToFrac(mods.lifestealPct);
    if (ls > 0) healPlayer(amount * ls);
    if (e.hp <= 0) killEnemy(e);
    else if (!e.isWraith) state.waveHpRemaining = Math.max(0, state.waveHpRemaining - amount);
    if (opts && opts.chain) applyChains(e, base);
    return amount;
  }

  function applyChains(source, base) {
    var n = mods.chainCount;
    if (n <= 0) return;
    var hit = 0;
    for (var i = 0; i < state.enemies.length && hit < n; i++) {
      var e = state.enemies[i];
      if (e === source || e.dead) continue;
      if (hyp(e.x - source.x, e.y - source.y) <= T.CHAIN_RANGE) {
        hit++;
        dealDamage(e, base * T.CHAIN_FALLOFF, null);
      }
    }
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    var idx = state.enemies.indexOf(e);
    if (idx >= 0) state.enemies.splice(idx, 1);
    state.runStats.kills++;
    emit({ type: 'kill', x: e.x, y: e.y, color: e.color, shape: e.shape });

    /* on-death behaviors */
    for (var i = 0; i < e.behaviors.length; i++) {
      var b = e.behaviors[i];
      if (b.type === 'splitter') doSplit(e, b);
      else if (b.type === 'bomber') doBomb(e, b);
    }
    dropMote(e);
    recomputeWaveHp();
  }

  function doSplit(parent, b) {
    var child = getEnemyType(b.into);
    if (!child) return;
    var count = clamp(Math.floor(num(b.count, 2, 0, 12)), 0, 12);
    for (var i = 0; i < count; i++) {
      if (state.enemies.length >= T.MAX_ENEMIES) break;
      var hp = Math.max(1, num(child.hp, 50, 1, 1e7) * (run.hpScale || 1));
      var ang = (i / Math.max(1, count)) * Math.PI * 2;
      var c = makeEnemy(child, state.wave, hp, {
        x: parent.x + Math.cos(ang) * 18, y: parent.y + Math.sin(ang) * 18
      });
      state.enemies.push(c);
      if (!c.isWraith) state.waveHpTotal += hp;   // bar stays honest
    }
  }

  function doBomb(e, b) {
    var r = num(b.radius, 90, 4, 600);
    var dmg = num(b.damage, e.atk * 2, 0, 1e5);
    var d = hyp(state.player.x - e.x, state.player.y - e.y);
    if (d <= r) hurtPlayer(dmg * (1 + state.veil / 50), e);
  }

  function dropMote(e) {
    if (state.motesOnGround.length >= T.MAX_MOTES) return;
    var tier = tierIndexFor(state.veil);
    var value = Math.max(1, Math.round(e.moteValue * tierMultFor(state.veil)));
    var life = Math.max(0.5, (T.MOTE_LIFE + mods.moteLifeAdd) * amods.moteLifeMult);
    state.motesOnGround.push({ x: e.x, y: e.y, value: value, tier: tier, life: life });
    emit({ type: 'mote_drop', x: e.x, y: e.y, tier: tier });
  }

  function healPlayer(amount) {
    if (!run || state.phase === 'dead') return;   // no post-mortem lifesteal
    if (!(amount > 0)) return;
    state.hp = Math.min(state.hpMax, state.hp + amount);
  }

  function hurtPlayer(amount, source) {
    if (!run || state.phase !== 'combat') return;
    if (state.player.invuln > 0) return;
    if (!(amount > 0)) return;
    if (state.player.shield > 0) {
      var absorbed = Math.min(state.player.shield, amount);
      state.player.shield -= absorbed;
      amount -= absorbed;
      if (amount <= 0) return;
    }
    state.hp -= amount;
    emit({ type: 'player_hurt', amount: Math.round(amount) });
    var th = pctToFrac(mods.thornsPct);
    if (th > 0 && source && !source.dead) dealDamage(source, amount * th, null);
    if (state.hp <= 0) {
      state.hp = 0;
      die();
    }
  }

  /* ------------------------------------------------------------------ *
   * 9. Abilities (ported from the old game, adapted to Focus/Overdraw)
   * ------------------------------------------------------------------ */

  // Predicts an intercept point for a moving target given a projectile speed,
  // so ranged abilities actually lead their target instead of always aiming
  // at its current (soon-to-be-stale) position.   [PORTED VERBATIM]
  /* ES5 only, deliberately: this file ships as a plain script and const/let/
     arrow/spread here would be a PARSE-time failure on an older engine, which
     takes the whole of sim.js down rather than just this function. */
  function leadAim(px, py, target, speed) {
    var tvx = target.vx || 0, tvy = target.vy || 0;
    var dx = target.x - px, dy = target.y - py;
    var a = tvx * tvx + tvy * tvy - speed * speed;
    var b = 2 * (dx * tvx + dy * tvy);
    var c = dx * dx + dy * dy;
    var t = 0;
    if (Math.abs(a) < 0.0001) {
      if (b !== 0) t = -c / b;
    } else {
      var disc = b * b - 4 * a * c;
      if (disc >= 0) {
        var sq = Math.sqrt(disc);
        var t1 = (-b + sq) / (2 * a), t2 = (-b - sq) / (2 * a);
        var best = Infinity;
        if (t1 > 0 && isFinite(t1)) best = t1;
        if (t2 > 0 && isFinite(t2) && t2 < best) best = t2;
        if (best !== Infinity) t = best;
      }
    }
    if (!isFinite(t) || t < 0) t = 0;
    var aimX = target.x + tvx * t, aimY = target.y + tvy * t;
    var ang = Math.atan2(aimY - py, aimX - px);
    return { vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed };
  }

  function abilityDamage(a) {
    /* Baseline: 12 damage per Focus point spent (DESIGN 5.1, k = 12). Content
       may override with an explicit `damage`.
       Hero `atk` is an INDEX, not a flat bonus: 100 = baseline, so atk 100
       multiplies by exactly 1.0 and hero variance is a percentage. This is
       what keeps the old game's unbounded flat-atk runaway impossible — there
       is no additive damage term anywhere, and `buff:{stat:'atk',amount:35}`
       reads as +35% for its duration. Clamped so a mis-typed content value
       cannot invert or explode the economy. */
    var atkMult = clamp(effAtk() / 100, 0.05, 6);
    var base = isNum(a.damage) ? a.damage : num(a.focusCost, 10, 0, 1e4) * T.DAMAGE_PER_FOCUS;
    var d = base * atkMult * mods.damageMult;
    if (a.kind === 'melee') d *= mods.meleeDamageMult;
    else if (a.kind === 'projectile') d *= mods.projDamageMult;
    else if (a.kind === 'aoe') d *= mods.aoeDamageMult;
    return Math.max(1, d);
  }

  function abilityRange(a) {
    var def = a.kind === 'melee' ? 95 : a.kind === 'projectile' ? 340
      : a.kind === 'dash' ? 200 : a.kind === 'execute' ? 220 : 130;
    return num(a.range, def, 8, 2000);
  }

  function applyBuff(stat, amount, duration) {
    if (!run) return;
    if (stat !== 'atk' && stat !== 'spd' && stat !== 'focusRegen') return;
    if (!isNum(amount) || !isNum(duration) || duration <= 0) return;
    run.buffs.push({ stat: stat, amount: clamp(amount, -1000, 1000), timer: clamp(duration, 0, 60) });
    state.player.spd = effSpd();
  }

  function castMelee(a, dmg) {
    /* `ticks` applies here too — Twin Fang promises "two hits of 130" and used
       to land exactly one. Each pulse re-resolves its target, so backing off
       between them drops the later hits, which is what its tip describes. */
    var ticks = clamp(Math.floor(num(a.ticks, 0, 0, 20)), 0, 20);
    var strike = function (announceMiss) {
      var near = nearestEnemy();
      if (!near) {
        if (announceMiss) emit({ type: 'float', x: state.player.x, y: state.player.y, text: 'No target', color: '#94a3b8' });
        return;
      }
      var range = abilityRange(a);
      var dx = near.x - state.player.x, dy = near.y - state.player.y;
      var dist = hyp(dx, dy) || 0.0001;
      var ang = Math.atan2(dy, dx);
      if (dist <= range) {
        dealDamage(near, dmg, { chain: true });
      } else if (a.lunge && dist <= range + 80) {
        movePlayerTo(near.x - Math.cos(ang) * (range * 0.6), near.y - Math.sin(ang) * (range * 0.6));
        dealDamage(near, dmg, { chain: true });
      } else if (announceMiss) {
        emit({ type: 'float', x: state.player.x, y: state.player.y, text: 'Out of range', color: '#94a3b8' });
      }
    };
    strike(true);
    if (!run) return;
    for (var k = 1; k < ticks; k++) {
      run.delayed.push({ timer: k * T.TICK_INTERVAL, fn: function () { strike(false); } });
    }
  }

  function castProjectile(a, dmg) {
    var near = nearestEnemy();
    if (!near) { emit({ type: 'float', x: state.player.x, y: state.player.y, text: 'No target', color: '#94a3b8' }); return; }
    var range = abilityRange(a);
    var dist = hyp(near.x - state.player.x, near.y - state.player.y);
    if (dist <= range * 0.35) { dealDamage(near, dmg, { chain: true }); return; }
    var speed = projSpeed(a.speed, 480);
    var aim = leadAim(state.player.x, state.player.y, near, speed);
    if (state.projectiles.length >= T.MAX_PROJECTILES) state.projectiles.shift();
    state.projectiles.push({
      x: state.player.x, y: state.player.y, vx: aim.vx, vy: aim.vy,
      r: a.pierce ? 8 : 6, col: state.player.color,
      dmg: dmg, owner: 'player', speed: speed,
      homing: !!a.homing, target: near.uid,
      pierce: (a.pierce ? 3 : 1) + mods.pierceCount,
      hit: null, life: 4,
      slow: a.slow && typeof a.slow === 'object' ? a.slow : null
    });
  }

  function castDash(a, dmg) {
    var near = nearestEnemy();
    var ang = near ? Math.atan2(near.y - state.player.y, near.x - state.player.x)
      : Math.atan2(run.moveY || 0, run.moveX || 1);
    var dashDist = Math.min(abilityRange(a), 260);
    var steps = 10;
    var hitIds = {};
    for (var i = 1; i <= steps; i++) {
      movePlayerTo(state.player.x + Math.cos(ang) * (dashDist / steps),
        state.player.y + Math.sin(ang) * (dashDist / steps));
      for (var j = state.enemies.length - 1; j >= 0; j--) {
        var e = state.enemies[j];
        if (!e || e.dead || hitIds[e.uid]) continue;
        if (hyp(e.x - state.player.x, e.y - state.player.y) < e.size + 24) {
          hitIds[e.uid] = 1;
          dealDamage(e, dmg, { chain: true });
        }
      }
    }
    state.player.invuln = Math.max(state.player.invuln, T.DASH_INVULN);
  }

  function castExecute(a, dmg) {
    var near = nearestEnemy();
    if (!near) { emit({ type: 'float', x: state.player.x, y: state.player.y, text: 'No target', color: '#94a3b8' }); return; }
    var range = abilityRange(a);
    var dist = hyp(near.x - state.player.x, near.y - state.player.y);
    if (dist > range + 60) {
      emit({ type: 'float', x: state.player.x, y: state.player.y, text: 'Out of range', color: '#94a3b8' });
      return;
    }
    var thresh = clamp(T.EXECUTE_BASE + pctToFrac(mods.executeThresholdAdd), 0, 0.9);
    if (near.maxHp > 0 && near.hp / near.maxHp <= thresh) {
      emit({ type: 'float', x: near.x, y: near.y - 40, text: 'EXECUTED', color: '#7c3aed' });
      dealDamage(near, near.hp * 2 + 9999, { chain: true });
    } else {
      dealDamage(near, dmg, { chain: true });
    }
  }

  function castAoe(a, dmg) {
    var cx = state.player.x, cy = state.player.y;
    var radius = abilityRange(a) * mods.aoeRadiusMult;
    var ticks = clamp(Math.floor(num(a.ticks, 0, 0, 20)), 0, 20);
    /* `damage` is PER TICK, not a total to be split — see CONTRACT.md. Every
       tooltip reads it that way ("Two hits of 130"), and only this reading
       lands DESIGN 5.1's 12 damage per Focus. */
    var perHit = dmg;
    var slow = (a.slow && typeof a.slow === 'object') ? a.slow : null;

    var apply = function () {
      for (var i = state.enemies.length - 1; i >= 0; i--) {
        var e = state.enemies[i];
        if (!e || e.dead) continue;
        if (hyp(e.x - cx, e.y - cy) < radius) {
          if (slow) {
            e.slowMult = clamp(1 - pctToFrac(slow.amount), 0.1, 1);
            e.slowTimer = num(slow.duration, 2, 0, 30);
          }
          dealDamage(e, perHit, null);
        }
      }
    };

    /* delay and ticks compose: a delayed multi-tick ability lands all N pulses,
       the first one `delay` seconds out. Ordering these as exclusive branches
       silently dropped every pulse but one. */
    var delay = (isNum(a.delay) && a.delay > 0) ? clamp(a.delay, 0, 10) : 0;
    if (ticks > 0) {
      for (var k = 0; k < ticks; k++) {
        run.delayed.push({ timer: delay + k * T.TICK_INTERVAL, fn: apply });
      }
    } else if (delay > 0) {
      run.delayed.push({ timer: delay, fn: apply });
    } else {
      apply();
    }
    /* apply() above can end the run (a bomber's death blast). Everything from
       here on touches run, so bail rather than dereference null. */
    if (!run) return;
    if (a.buff && typeof a.buff === 'object') applyBuff(a.buff.stat, a.buff.amount, a.buff.duration);
    if (isNum(a.heal) && a.heal > 0) healPlayer(a.heal);
    if (a.shield && typeof a.shield === 'object') {
      var amt = num(a.shield.amount, 0, 0, 1e5);
      if (amt > 0) {
        state.player.shield = Math.max(state.player.shield, amt);
        run.shieldTimer = Math.max(run.shieldTimer, num(a.shield.duration, 4, 0, 60));
      }
    }
  }

  function movePlayerTo(x, y) {
    var R = T.PLAYER_R;
    state.player.x = clamp(isNum(x) ? x : state.player.x, R, Math.max(R + 1, state.arena.w - R));
    state.player.y = clamp(isNum(y) ? y : state.player.y, R, Math.max(R + 1, state.arena.h - R));
  }

  /* ------------------------------------------------------------------ *
   * 10. Enemy behaviors — all eight descriptors
   * ------------------------------------------------------------------ */

  function enemyMoveSpeed(e) {
    var veilMult = 1 + state.veil / 60;
    return e.spd * veilMult * (e.slowMult || 1) * amods.enemySpeedMult;
  }

  function stepToward(e, tx, ty, speed, dt) {
    var dx = tx - e.x, dy = ty - e.y;
    var d = hyp(dx, dy);
    if (d < 0.0001) { e.vx = 0; e.vy = 0; return; }
    e.vx = dx / d * speed; e.vy = dy / d * speed;
    e.x += e.vx * dt; e.y += e.vy * dt;
  }

  function fireEnemyProjectile(e, speed, dmg) {
    if (state.projectiles.length >= T.MAX_PROJECTILES) return;
    var aim = leadAim(e.x, e.y, {
      x: state.player.x, y: state.player.y,
      vx: state.player.vx * state.player.spd, vy: state.player.vy * state.player.spd
    }, speed);
    state.projectiles.push({
      x: e.x, y: e.y, vx: aim.vx, vy: aim.vy, r: 6, col: e.color,
      dmg: dmg, owner: 'enemy', speed: speed, homing: false, target: null,
      pierce: 1, hit: null, life: 5, slow: null
    });
  }

  function updateEnemy(e, dt) {
    var p = state.player;
    var dx = p.x - e.x, dy = p.y - e.y;
    var dist = hyp(dx, dy);
    var speed = enemyMoveSpeed(e);
    var moved = false;

    if (e.slowTimer > 0) {
      e.slowTimer -= dt;
      if (e.slowTimer <= 0) { e.slowTimer = 0; e.slowMult = 1; }
    }
    if (e.telegraph > 0) e.telegraph = Math.max(0, e.telegraph - dt);

    for (var i = 0; i < e.behaviors.length; i++) {
      var b = e.behaviors[i];
      switch (b.type) {

        case 'chaser':
          if (!moved && dist > e.size + T.PLAYER_R * 0.6) {
            stepToward(e, p.x, p.y, speed, dt); moved = true;
          }
          break;

        case 'ranged': {
          var range = num(b.range, 260, 20, 1200);
          var cd = num(b.attackCd, 2, 0.15, 20);
          var ps = projSpeed(b.projSpeed, 260);
          e.st.fire = (e.st.fire || 0) + dt;
          if (!moved) {
            if (dist > range) { stepToward(e, p.x, p.y, speed, dt); moved = true; }
            else if (dist < range * 0.65) {
              stepToward(e, e.x - dx, e.y - dy, speed * 0.8, dt); moved = true;
            } else {
              /* strafe */
              var ang = Math.atan2(dy, dx) + Math.PI / 2;
              stepToward(e, e.x + Math.cos(ang) * 40, e.y + Math.sin(ang) * 40, speed * 0.5, dt);
              moved = true;
            }
          }
          if (e.st.fire >= cd && dist <= range * 1.2) {
            e.st.fire = 0;
            fireEnemyProjectile(e, ps, e.atk * 0.85);
          }
          break;
        }

        case 'charger': {
          var windup = num(b.windup, 0.6, 0.05, 5);
          var dashSpeed = enemySpeed(b.dashSpeed);
          var dashCd = num(b.dashCd, 4, 0.5, 30);
          e.st.chargeCd = (e.st.chargeCd == null) ? rndRange(0, dashCd) : e.st.chargeCd + dt;
          if (e.st.phase === 'wind') {
            e.telegraph = Math.max(e.telegraph, e.st.windLeft);
            e.st.windLeft -= dt;
            e.vx = 0; e.vy = 0; moved = true;
            if (e.st.windLeft <= 0) {
              e.st.phase = 'dash';
              e.st.dashLeft = 0.35;
              var a2 = Math.atan2(dy, dx);
              e.st.dx = Math.cos(a2); e.st.dy = Math.sin(a2);
            }
          } else if (e.st.phase === 'dash') {
            e.st.dashLeft -= dt;
            e.vx = e.st.dx * dashSpeed * amods.enemySpeedMult;
            e.vy = e.st.dy * dashSpeed * amods.enemySpeedMult;
            e.x += e.vx * dt; e.y += e.vy * dt;
            moved = true;
            if (e.st.dashLeft <= 0) { e.st.phase = null; e.st.chargeCd = 0; }
          } else if (e.st.chargeCd >= dashCd && dist < 420) {
            e.st.phase = 'wind'; e.st.windLeft = windup;
            e.telegraph = windup; e.vx = 0; e.vy = 0; moved = true;
          } else if (!moved && dist > e.size + T.PLAYER_R * 0.6) {
            stepToward(e, p.x, p.y, speed * 0.75, dt); moved = true;
          }
          break;
        }

        case 'summoner': {
          var period = num(b.period, 6, 0.5, 60);
          var cnt = clamp(Math.floor(num(b.count, 2, 0, 8)), 0, 8);
          e.st.sum = (e.st.sum || 0) + dt;
          if (e.st.sum >= period) {
            e.st.sum = 0;
            var child = getEnemyType(b.spawns);
            if (child) {
              for (var s = 0; s < cnt; s++) {
                if (state.enemies.length >= T.MAX_ENEMIES) break;
                var hp = Math.max(1, num(child.hp, 50, 1, 1e7) * (run.hpScale || 1));
                var ang2 = rnd() * Math.PI * 2;
                var minion = makeEnemy(child, state.wave, hp, {
                  x: e.x + Math.cos(ang2) * 26, y: e.y + Math.sin(ang2) * 26
                });
                state.enemies.push(minion);
                state.waveHpTotal += hp;
                state.waveHpRemaining += hp;
              }
            }
          }
          if (!moved && dist > 220) { stepToward(e, p.x, p.y, speed * 0.6, dt); moved = true; }
          break;
        }

        case 'orbiter': {
          var orbR = num(b.radius, 120, 20, 600);
          var strikeCd = num(b.strikeCd, 3, 0.3, 30);
          e.st.orb = (e.st.orb || 0) + dt;
          if (e.st.strike > 0) {
            e.st.strike -= dt;
            if (!moved) { stepToward(e, p.x, p.y, speed * 1.9, dt); moved = true; }
          } else if (e.st.orb >= strikeCd) {
            e.st.orb = 0; e.st.strike = 0.6;
          } else if (!moved) {
            var ca = Math.atan2(-dy, -dx);           // angle enemy->player reversed
            var targetA = ca + speed / Math.max(20, orbR) * dt * 1.4;
            var tx = p.x + Math.cos(targetA) * orbR;
            var ty = p.y + Math.sin(targetA) * orbR;
            stepToward(e, tx, ty, speed, dt); moved = true;
          }
          break;
        }

        case 'shielder':
          if (!moved && dist > 200) { stepToward(e, p.x, p.y, speed * 0.7, dt); moved = true; }
          break;

        case 'bomber':
          if (!moved && dist > e.size + T.PLAYER_R * 0.5) {
            stepToward(e, p.x, p.y, speed * 1.05, dt); moved = true;
          } else if (dist <= e.size + T.PLAYER_R) {
            doBomb(e, b);
            killEnemy(e);
            return;
          }
          break;

        case 'splitter':
        default:
          if (!moved && dist > e.size + T.PLAYER_R * 0.6) {
            stepToward(e, p.x, p.y, speed, dt); moved = true;
          }
          break;
      }
      if (e.dead) return;
    }
    if (!moved) { e.vx = 0; e.vy = 0; }

    /* Contact damage. No global i-frame (deliberately deleted — DESIGN Part 6):
       each enemy has its own cadence, so being surrounded actually kills. */
    if (dist <= e.size + T.PLAYER_R) {
      e.atkTimer += dt;
      var period = T.ENEMY_ATTACK_PERIOD;
      if (e.atkTimer >= period) {
        e.atkTimer = 0;
        hurtPlayer(e.atk * (1 + state.veil / 50), e);
      }
    } else {
      e.atkTimer = Math.min(e.atkTimer + dt, T.ENEMY_ATTACK_PERIOD);
    }

    /* Keep enemies from drifting off into infinity. */
    var M = 260;
    e.x = clamp(e.x, -M, state.arena.w + M);
    e.y = clamp(e.y, -M, state.arena.h + M);
  }

  function updateShieldAuras() {
    var i, j, e, s;
    for (i = 0; i < state.enemies.length; i++) state.enemies[i].shieldAura = 0;
    for (i = 0; i < state.enemies.length; i++) {
      s = state.enemies[i];
      var red = 0, rad = 0;
      for (var b = 0; b < s.behaviors.length; b++) {
        if (s.behaviors[b].type === 'shielder') {
          red = pctToFrac(s.behaviors[b].reduction);
          rad = num(s.behaviors[b].radius, 140, 10, 900);
        }
      }
      if (red <= 0) continue;
      for (j = 0; j < state.enemies.length; j++) {
        e = state.enemies[j];
        if (e === s) continue;
        if (hyp(e.x - s.x, e.y - s.y) <= rad && red > e.shieldAura) e.shieldAura = red;
      }
    }
  }

  function separateEnemies(dt) {
    var n = state.enemies.length;
    if (n < 2) return;
    for (var i = 0; i < n; i++) {
      var a = state.enemies[i];
      for (var j = i + 1; j < n; j++) {
        var b = state.enemies[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var min = (a.size + b.size) * 0.8;
        var d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 0.0001) continue;
        var d = Math.sqrt(d2);
        var push = (min - d) * 0.5;
        var ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 11. Projectiles & motes
   * ------------------------------------------------------------------ */

  function updateProjectiles(dt) {
    var W = state.arena.w, H = state.arena.h;
    for (var i = state.projectiles.length - 1; i >= 0; i--) {
      var p = state.projectiles[i];
      p.life -= dt;
      if (p.life <= 0) { state.projectiles.splice(i, 1); continue; }
      if (p.homing && p.target != null) {
        var tgt = null;
        for (var k = 0; k < state.enemies.length; k++) {
          if (state.enemies[k].uid === p.target) { tgt = state.enemies[k]; break; }
        }
        if (tgt) {
          var desired = Math.atan2(tgt.y - p.y, tgt.x - p.x);
          var cur = Math.atan2(p.vy, p.vx);
          var diff = desired - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          var turn = clamp(diff, -9 * dt, 9 * dt);   // 9 rad/s
          var na = cur + turn;
          var sp = p.speed || hyp(p.vx, p.vy);
          p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -80 || p.x > W + 80 || p.y < -80 || p.y > H + 80) {
        state.projectiles.splice(i, 1); continue;
      }
      if (p.owner === 'player') {
        for (var e = state.enemies.length - 1; e >= 0; e--) {
          var en = state.enemies[e];
          /* dealDamage -> killEnemy splices state.enemies, and a chain or a
             Slagbrute detonation can remove two or more in one iteration while
             `e` only decrements by one — so this index can outrun the array.
             castAoe and castDash already guard the same way. */
          if (!en || en.dead) continue;
          if (p.hit && p.hit[en.uid]) continue;
          if (hyp(en.x - p.x, en.y - p.y) < en.size + p.r) {
            if (p.slow) {
              en.slowMult = clamp(1 - pctToFrac(p.slow.amount), 0.1, 1);
              en.slowTimer = num(p.slow.duration, 2, 0, 30);
            }
            dealDamage(en, p.dmg, { chain: true });
            p.pierce--;
            if (p.pierce <= 0) { state.projectiles.splice(i, 1); break; }
            (p.hit = p.hit || {})[en.uid] = 1;
          }
        }
      } else {
        if (hyp(state.player.x - p.x, state.player.y - p.y) < T.PLAYER_R + p.r) {
          hurtPlayer(p.dmg * (1 + state.veil / 50), null);
          state.projectiles.splice(i, 1);
        }
      }
    }
  }

  function updateMotes(dt) {
    var pickR = T.PICKUP_R + mods.moteMagnetRadius;
    for (var i = state.motesOnGround.length - 1; i >= 0; i--) {
      var m = state.motesOnGround[i];
      m.life -= dt;
      if (m.life <= 0) {
        /* state.motesOnGround is the authoritative render source; expiry needs
           no event — fx.js draws the array directly. */
        state.motesOnGround.splice(i, 1);
        continue;
      }
      if (hyp(m.x - state.player.x, m.y - state.player.y) <= pickR) {
        state.motes += m.value;
        state.runStats.motesEarned += m.value;
        emit({ type: 'mote_pickup', x: m.x, y: m.y, value: m.value, tier: m.tier });
        state.motesOnGround.splice(i, 1);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 12. Wave transition / pact draft / death
   * ------------------------------------------------------------------ */

  function waveEnemiesAlive() {
    for (var i = 0; i < state.enemies.length; i++) {
      if (!state.enemies[i].isWraith && !state.enemies[i].dead) return true;
    }
    return false;
  }

  function onWaveClear() {
    var over = state.parRemaining < 0 ? -state.parRemaining : 0;
    emit({ type: 'wave_clear', wave: state.wave, overPar: over });

    /* +25% max HP restore (x pact/ascension mods) */
    healPlayer(state.hpMax * T.HP_RESTORE_BETWEEN *
      mods.hpRestoreMultBetweenWaves * amods.hpRestoreMult);

    /* Transients gone before anything can be serialised. */
    state.projectiles.length = 0;
    state.motesOnGround.length = 0;
    run.delayed.length = 0;
    run.buffs.length = 0;
    state.player.shield = 0;
    state.player.invuln = 0;
    run.shieldTimer = 0;

    var next = state.wave + 1;
    var offers = (next >= 2) ? buildDraft(next) : [];
    if (offers.length) {
      state.phase = 'pactDraft';
      state.draftOffer = offers;
      run.pendingWave = next;
      /* Snapshot BEFORE the choice, keyed to the upcoming wave: quitting mid
         draft forfeits the draft rather than allowing a reroll, and there is
         never a mid-wave snapshot to scum. */
      snapshotRun(next);
      saveInternal();
    } else {
      state.draftOffer = null;
      startWave(next);
      snapshotRun(next);
      saveInternal();
    }
  }

  /** 3 offers, weighted by tier and wave. Higher tiers unlock with depth. */
  function tierWeight(tier, w) {
    if (tier <= 1) return 1;
    if (tier === 2) return clamp((w - 3) / 6, 0, 1) * 0.9;
    return clamp((w - 8) / 8, 0, 1) * 0.7;
  }

  function buildDraft(w) {
    var pacts = list('PACTS');
    if (!pacts.length) return [];
    var pool = [];
    for (var i = 0; i < pacts.length; i++) {
      var p = pacts[i];
      if (!p || typeof p.id !== 'string') continue;
      if (state.pactsTaken.indexOf(p.id) >= 0) continue;
      var tier = clamp(Math.floor(num(p.tier, 1, 1, 3)), 1, 3);
      var wgt = tierWeight(tier, w);
      if (wgt <= 0) continue;
      /* Unaffordable pacts stay visible but rare. */
      if (num(p.cost, 0, 0, 1e9) > state.motes) wgt *= 0.25;
      pool.push({ id: p.id, w: wgt });
    }
    var out = [];
    for (var n = 0; n < 3 && pool.length; n++) {
      var total = 0, j;
      for (j = 0; j < pool.length; j++) total += pool[j].w;
      if (total <= 0) break;
      var r = rnd() * total, acc = 0, chosen = pool.length - 1;
      for (j = 0; j < pool.length; j++) { acc += pool[j].w; if (r <= acc) { chosen = j; break; } }
      out.push(pool[chosen].id);
      pool.splice(chosen, 1);
    }
    return out;
  }

  /** Echoes banked on death/abandon.
   *
   *  echoes = 4*W + W^2/5 + 1.5*sqrt(motesEarned)
   *
   *  Depth is the dominant term and is SUPERLINEAR in wave (W^2/5), because
   *  reaching wave 20 should be worth far more than two runs to wave 10 —
   *  that is what makes the meta reward the adaptive policy rather than
   *  farming. Motes enter SUBLINEARLY (sqrt) on purpose: the Veil tier
   *  multiplier is up to 16x, so a linear mote term would make "sit at V=95
   *  farming trash on wave 3" the optimal meta strategy. sqrt keeps holding
   *  high Veil worth doing (it is still the biggest single lever available
   *  inside a wave) without letting it out-earn depth.
   *  W=10, 2k motes -> 127.  W=20, 8k motes -> 294.  W=5, 20k motes -> 237.
   */
  function echoesFor(bestWave, motesEarned) {
    var W = clamp(num(bestWave, 0, 0, 100000), 0, 100000);
    var M = clamp(num(motesEarned, 0, 0, 1e12), 0, 1e12);
    return clamp(Math.floor(4 * W + (W * W) / 5 + 1.5 * Math.sqrt(M)), 0, 1e9);
  }

  function updateUnlocks() {
    var m = state.meta, i;
    var hs = heroes();
    for (i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (!h || typeof h.id !== 'string') continue;
      if (m.heroesUnlocked.indexOf(h.id) >= 0) continue;
      var u = h.unlockAt;
      if (u == null) { m.heroesUnlocked.push(h.id); continue; }
      if (typeof u !== 'object') continue;
      if (isNum(u.wave) && m.bestWaveEver >= u.wave) { m.heroesUnlocked.push(h.id); continue; }
      if (isNum(u.ascension) && m.ascensionUnlocked >= u.ascension) m.heroesUnlocked.push(h.id);
    }
    var rs = list('RIFTS');
    for (i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (!r || typeof r.id !== 'string') continue;
      if (m.riftsUnlocked.indexOf(r.id) >= 0) continue;
      var ru = r.unlockAt;
      if (ru == null) { m.riftsUnlocked.push(r.id); continue; }
      if (typeof ru !== 'object') continue;
      if (isNum(ru.wave) && m.bestWaveEver >= ru.wave) { m.riftsUnlocked.push(r.id); continue; }
      if (isNum(ru.ascension) && m.ascensionUnlocked >= ru.ascension) m.riftsUnlocked.push(r.id);
    }
    /* Ascension 1 unlocks at wave 15, then one more every 5 waves. */
    var unlocked = clamp(Math.floor((m.bestWaveEver - 10) / 5), 0, 8);
    if (unlocked > m.ascensionUnlocked) m.ascensionUnlocked = unlocked;
    if (m.ascension > m.ascensionUnlocked) m.ascension = m.ascensionUnlocked;
  }

  function endRun(dead) {
    if (!run) { state.phase = dead ? 'dead' : 'menu'; return; }
    var gained = echoesFor(state.runStats.bestWave, state.runStats.motesEarned);
    state.meta.echoes = clamp(state.meta.echoes + gained, 0, 1e12);
    state.lastRunEchoes = gained;
    if (state.runStats.bestWave > state.meta.bestWaveEver) {
      state.meta.bestWaveEver = state.runStats.bestWave;
    }
    updateUnlocks();
    runSnapshot = null;
    run = null;
    state.draftOffer = null;
    state.phase = dead ? 'dead' : 'menu';
    saveInternal();
  }

  function die() {
    if (state.phase === 'dead') return;
    emit({ type: 'death' });
    endRun(true);
  }

  /* ------------------------------------------------------------------ *
   * 13. The step
   * ------------------------------------------------------------------ */

  function step(dt) {
    var p = state.player;
    state.time += dt;
    state.runStats.timePlayed += dt;

    /* --- timers ------------------------------------------------------ */
    var i;
    for (i = 0; i < state.abilities.length; i++) {
      var a = state.abilities[i];
      if (a.cd > 0) a.cd = Math.max(0, a.cd - dt);
    }
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
    if (run.shieldTimer > 0) {
      run.shieldTimer -= dt;
      if (run.shieldTimer <= 0) { run.shieldTimer = 0; p.shield = 0; }
    }
    for (i = run.buffs.length - 1; i >= 0; i--) {
      run.buffs[i].timer -= dt;
      if (run.buffs[i].timer <= 0) run.buffs.splice(i, 1);
    }
    for (i = run.delayed.length - 1; i >= 0; i--) {
      run.delayed[i].timer -= dt;
      if (run.delayed[i].timer <= 0) {
        var fn = run.delayed[i].fn;
        run.delayed.splice(i, 1);
        fn();
      }
    }

    /* --- Focus & Veil ------------------------------------------------ */
    state.focus = Math.min(state.focusMax, state.focus + effFocusRegen() * dt);
    run.sinceCast += dt;
    /* Decay applies inside the settle window, past par as well as under it.
       The old code disabled decay past par to stop the +4 V/s overrun penalty
       cancelling the 4 V/s decay exactly — but that made the overrun spiral
       terminal by construction: once behind, Veil rose no matter what the
       player did. PAR_OVERRUN_VEIL is now 1.5, comfortably under VEIL_DECAY,
       so a player who stops casting past par sheds a net 2.5 V/s. Attrition
       pressure (DESIGN Part 2.3) still bites through the permanent floor,
       which PAR_OVERRUN_FLOOR ratchets and nothing ever lowers. */
    if (run.sinceCast >= settleWindow()) {
      setVeil(state.veil - T.VEIL_DECAY * mods.veilDecayMult * dt);
    } else {
      setVeil(state.veil);   // keeps veil >= floor and tier events flowing
    }

    /* --- par clock --------------------------------------------------- */
    state.parRemaining -= dt;
    if (state.parRemaining < 0) {
      addVeil(T.PAR_OVERRUN_VEIL * dt);
      state.veilFloor = Math.min(T.MAX_VEIL_FLOOR, state.veilFloor + T.PAR_OVERRUN_FLOOR * dt);
      if (state.veil < state.veilFloor) setVeil(state.veilFloor);
    }

    /* --- player movement --------------------------------------------- */
    p.spd = effSpd();
    var mx = run.moveX, my = run.moveY;
    var len = hyp(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    p.vx = mx; p.vy = my;
    if (len > 0.0001) movePlayerTo(p.x + mx * p.spd * dt, p.y + my * p.spd * dt);

    /* --- enemies ------------------------------------------------------ */
    for (i = state.enemies.length - 1; i >= 0; i--) {
      var e = state.enemies[i];
      if (!e || e.dead) continue;
      updateEnemy(e, dt);
      if (state.phase !== 'combat') return;   // death mid-loop
    }

    updateProjectiles(dt);
    if (state.phase !== 'combat') return;
    updateMotes(dt);

    /* --- housekeeping at a fixed sim-time cadence (never frame-based) - */
    slowAcc += dt;
    if (slowAcc >= T.SLOW_TICK) {
      slowAcc = slowAcc % T.SLOW_TICK;
      separateEnemies(dt);
      updateShieldAuras();
      recomputeWaveHp();
    }

    checkBreach();

    /* --- wave clear --------------------------------------------------- */
    if (!waveEnemiesAlive()) {
      recomputeWaveHp();
      onWaveClear();
    }
  }

  /* ------------------------------------------------------------------ *
   * 14. Save / load — untrusted input
   * ------------------------------------------------------------------ */

  function blankMeta() {
    return {
      echoes: 0, covenantOwned: [], ascension: 0, ascensionUnlocked: 0,
      heroesUnlocked: [], bestWaveEver: 0, riftsUnlocked: []
    };
  }

  function sanitizeIdArray(v, contentKey, max) {
    var out = [];
    if (!Array.isArray(v)) return out;
    for (var i = 0; i < v.length && out.length < (max || 200); i++) {
      var id = v[i];
      if (typeof id !== 'string' || !id) continue;
      if (out.indexOf(id) >= 0) continue;
      if (contentKey) {
        /* Drop records whose enum keys are unknown to the current content. */
        if (!findById(contentKey, id)) continue;
      }
      out.push(id);
    }
    return out;
  }

  function sanitizeMeta(raw) {
    var m = blankMeta();
    if (!raw || typeof raw !== 'object') return m;
    m.echoes = fieldNum(raw, 'echoes', 0, 0, 1e12);
    m.bestWaveEver = Math.floor(fieldNum(raw, 'bestWaveEver', 0, 0, 100000));
    m.ascensionUnlocked = Math.floor(fieldNum(raw, 'ascensionUnlocked', 0, 0, 8));
    m.ascension = Math.floor(fieldNum(raw, 'ascension', 0, 0, 8));
    if (m.ascension > m.ascensionUnlocked) m.ascension = m.ascensionUnlocked;
    m.covenantOwned = sanitizeIdArray(raw.covenantOwned, 'COVENANT', 64);
    /* Hero/rift ids are validated against content only when content exists;
       an unknown hero would otherwise be silently deleted by a stub load. */
    m.heroesUnlocked = sanitizeIdArray(raw.heroesUnlocked, null, 32);
    m.riftsUnlocked = sanitizeIdArray(raw.riftsUnlocked, null, 32);
    return m;
  }

  function sanitizeRunStats(raw) {
    var s = { kills: 0, breaches: 0, motesEarned: 0, timePlayed: 0, bestWave: 0 };
    if (!raw || typeof raw !== 'object') return s;
    s.kills = Math.floor(fieldNum(raw, 'kills', 0, 0, 1e9));
    s.breaches = Math.floor(fieldNum(raw, 'breaches', 0, 0, 1e6));
    s.motesEarned = Math.floor(fieldNum(raw, 'motesEarned', 0, 0, 1e12));
    s.timePlayed = fieldNum(raw, 'timePlayed', 0, 0, 1e9);
    s.bestWave = Math.floor(fieldNum(raw, 'bestWave', 0, 0, 100000));
    return s;
  }

  function sanitizeRun(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.heroId !== 'string') return null;
    var hero = findById('HEROES', raw.heroId);
    if (!hero && list('HEROES').length) return null;   // unknown hero -> discard run
    var r = {
      heroId: raw.heroId,
      riftId: (typeof raw.riftId === 'string' && (!list('RIFTS').length || findById('RIFTS', raw.riftId)))
        ? raw.riftId : null,
      wave: Math.floor(fieldNum(raw, 'wave', 1, 1, 100000)),
      motes: Math.floor(fieldNum(raw, 'motes', 0, 0, 1e12)),
      hpMax: fieldNum(raw, 'hpMax', 100, 1, 1e7),
      hp: fieldNum(raw, 'hp', 1, 0, 1e7),
      focus: fieldNum(raw, 'focus', 0, 0, 1e5),
      veil: fieldNum(raw, 'veil', 0, 0, T.VEIL_MAX),
      veilFloor: fieldNum(raw, 'veilFloor', 0, 0, T.MAX_VEIL_FLOOR),
      pactsTaken: sanitizeIdArray(raw.pactsTaken, 'PACTS', 128),
      runStats: sanitizeRunStats(raw.runStats),
      waveHpRemaining: fieldNum(raw, 'waveHpRemaining', 0, 0, 1e9)
    };
    if (r.hp <= 0) r.hp = Math.max(1, r.hpMax * 0.25);
    if (r.hp > r.hpMax) r.hp = r.hpMax;
    if (r.veil < r.veilFloor) r.veil = r.veilFloor;
    return r;
  }

  /** v1 -> v2. Old shape: {saveVersion:1, heroId, wave, gold, kills, player}. */
  function migrateV1(raw) {
    var m = blankMeta();
    var wave = Math.floor(num(raw && raw.wave, 0, 0, 100000));
    var gold = num(raw && raw.gold, 0, 0, 1e12);
    m.echoes = clamp(Math.floor(wave * 5 + Math.floor(gold / 10)), 0, 1e12);
    m.bestWaveEver = wave;
    if (raw && typeof raw.heroId === 'string' && raw.heroId) m.heroesUnlocked = [raw.heroId];
    return { meta: m, run: null };
  }

  function loadSave() {
    var out = { meta: blankMeta(), run: null };
    try {
      var txt = storeGet(SAVE_KEY);
      if (!txt || typeof txt !== 'string') return out;
      var raw = JSON.parse(txt);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
      /* Schema version lives IN the payload and is checked. Never
         Object.assign(blank, parsed) — a parsed own __proto__ would reparent. */
      var ver = hasOwn(raw, 'saveVersion') ? raw.saveVersion : 0;
      if (ver === 1) {
        var mig = migrateV1(raw);
        out.meta = mig.meta; out.run = null;
        return out;
      }
      if (ver !== SCHEMA) return out;             // unknown/newer -> fresh
      out.meta = sanitizeMeta(hasOwn(raw, 'meta') ? raw.meta : null);
      out.run = sanitizeRun(hasOwn(raw, 'run') ? raw.run : null);
      return out;
    } catch (e) {
      return { meta: blankMeta(), run: null };
    }
  }

  function snapshotRun(waveNum) {
    if (!run) { runSnapshot = null; return; }
    /* Only the schema fields, built one by one. No buffs, no shields, no
       projectiles, no enemies — the exploit surface simply has no field. */
    runSnapshot = {
      heroId: state.heroId,
      riftId: state.riftId,
      wave: Math.floor(clamp(num(waveNum, state.wave, 1, 100000), 1, 100000)),
      motes: Math.floor(state.motes),
      hp: state.hp,
      hpMax: state.hpMax,
      focus: state.focus,
      veil: state.veil,
      veilFloor: state.veilFloor,
      pactsTaken: state.pactsTaken.slice(),
      runStats: {
        kills: state.runStats.kills, breaches: state.runStats.breaches,
        motesEarned: state.runStats.motesEarned, timePlayed: state.runStats.timePlayed,
        bestWave: state.runStats.bestWave
      },
      waveHpRemaining: state.waveHpRemaining
    };
  }

  function saveInternal() {
    try {
      var payload = {
        saveVersion: SCHEMA,
        meta: {
          echoes: state.meta.echoes,
          covenantOwned: state.meta.covenantOwned.slice(),
          ascension: state.meta.ascension,
          ascensionUnlocked: state.meta.ascensionUnlocked,
          heroesUnlocked: state.meta.heroesUnlocked.slice(),
          bestWaveEver: state.meta.bestWaveEver,
          riftsUnlocked: state.meta.riftsUnlocked.slice()
        },
        run: runSnapshot,
        ts: Date.now()
      };
      return storeSet(SAVE_KEY, JSON.stringify(payload));
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * 15. Run setup
   * ------------------------------------------------------------------ */

  function cloneAbilities(hero) {
    var src = Array.isArray(hero.abilities) ? hero.abilities : [];
    var out = [];
    for (var i = 0; i < 4; i++) {
      var a = src[i];
      var copy;
      try {
        copy = (a && typeof a === 'object') ? JSON.parse(JSON.stringify(a)) : null;
      } catch (e) { copy = null; }
      if (!copy || !hasOwn(ABILITY_KINDS, copy.kind)) {
        copy = { id: 'a' + i, name: '—', icon: '·', kind: 'melee', focusCost: 10, maxCd: 1, range: 90, damage: 0, empty: !copy };
      }
      copy.focusCost = num(copy.focusCost, 10, 0, 1e4);
      copy.baseMaxCd = num(copy.maxCd, 1, 0.05, 120);
      copy.maxCd = copy.baseMaxCd;
      copy.cd = 0;
      out.push(copy);
    }
    return out;
  }

  function resetRunState(hero, rift) {
    state.heroId = hero.id;
    state.riftId = rift ? rift.id : null;
    state.wave = 0;
    state.motes = 0;
    state.time = 0;
    state.veil = 0;
    state.veilFloor = 0;
    state.veilTier = 0;
    state.enemies.length = 0;
    state.projectiles.length = 0;
    state.motesOnGround.length = 0;
    state.pactsTaken.length = 0;
    state.draftOffer = null;
    state.wraithCount = 0;
    state.waveHpRemaining = 0;
    state.waveHpTotal = 0;
    state.error = null;
    state.lastRunEchoes = 0;
    state.runStats = { kills: 0, breaches: 0, motesEarned: 0, timePlayed: 0, bestWave: 0 };
    state.player.heroId = hero.id;
    state.player.color = typeof hero.color === 'string' ? hero.color : '#7c3aed';
    state.player.icon = typeof hero.icon === 'string' ? hero.icon : '@';
    state.player.x = state.arena.w / 2;
    state.player.y = state.arena.h / 2;
    state.player.vx = 0; state.player.vy = 0;
    state.player.invuln = 0; state.player.shield = 0;
    state.abilities = cloneAbilities(hero);
    slowAcc = 0;
    halted = false;

    run = {
      baseHp: num(hero.hp, 1000, 1, 1e7),
      baseFocusMax: num(hero.focusMax, 100, 5, 1e5),
      baseFocusRegen: num(hero.focusRegen, T.FOCUS_REGEN, 0, 500),
      baseAtk: num(hero.atk, 10, 0, 1e4),
      baseSpd: heroSpeed(hero.spd),
      riftId: rift ? rift.id : null,
      moveX: 0, moveY: 0,
      sinceCast: 99,
      buffs: [],
      delayed: [],
      shieldTimer: 0,
      brinkGuardUsed: 0,
      hpScale: 1,
      pendingWave: 1
    };
    state.hpMax = run.baseHp;
    state.hp = run.baseHp;
    state.focusMax = run.baseFocusMax;
    state.focus = run.baseFocusMax;
  }

  function startingVeilFloor() {
    var f = amods.veilFloorAdd;
    var owned = state.meta.covenantOwned;
    for (var i = 0; i < owned.length; i++) {
      var n = findById('COVENANT', owned[i]);
      if (n) f += num(n.upkeep, 0, 0, 100);
    }
    return clamp(f, 0, T.MAX_VEIL_FLOOR);
  }

  /* ------------------------------------------------------------------ *
   * 16. Public API
   * ------------------------------------------------------------------ */

  var Sim = {
    state: state,
    events: events,
    TUNING: T,

    newRun: function (heroId, riftId) {
      try {
        var hero = getHero(heroId);
        var rift = riftId ? findById('RIFTS', riftId) : null;
        resetRunState(hero, rift);
        recomputeAmods();
        recomputeMods();
        state.veilFloor = startingVeilFloor();
        setVeil(state.veilFloor);
        state.phase = 'combat';
        startWave(1);
        snapshotRun(1);
        saveInternal();
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    },

    continueRun: function () {
      try {
        var data = loadSave();
        state.meta = sanitizeMeta(data.meta);
        if (!data.run) return false;
        var hero = findById('HEROES', data.run.heroId) || (list('HEROES').length ? null : FALLBACK_HERO);
        if (!hero) return false;
        var rift = data.run.riftId ? findById('RIFTS', data.run.riftId) : null;
        resetRunState(hero, rift);
        recomputeAmods();

        state.motes = data.run.motes;
        for (var i = 0; i < data.run.pactsTaken.length; i++) state.pactsTaken.push(data.run.pactsTaken[i]);
        state.runStats = data.run.runStats;
        recomputeMods();                       // rebuilds hpMax/focusMax/cooldowns

        state.veilFloor = clamp(Math.max(startingVeilFloor(), data.run.veilFloor), 0, T.MAX_VEIL_FLOOR);
        state.hp = clamp(data.run.hp, 1, state.hpMax);
        state.focus = clamp(data.run.focus, 0, state.focusMax);
        setVeil(clamp(data.run.veil, state.veilFloor, T.VEIL_MAX));
        state.veilTier = tierIndexFor(state.veil);

        state.phase = 'combat';
        startWave(data.run.wave);
        snapshotRun(data.run.wave);
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    },

    hasSave: function () {
      try { return !!loadSave().run; } catch (e) { return false; }
    },

    tick: function (dt) {
      if (halted) return;
      if (!isNum(dt) || dt <= 0) return;
      if (dt > 0.1) dt = 0.1;                    // never let a stall teleport the sim
      if (state.phase !== 'combat' || !run) return;
      try {
        step(dt);
      } catch (err) {
        fail(err);
      }
    },

    useAbility: function (i) {
      try {
        if (state.phase !== 'combat' || !run) return false;
        i = Math.floor(num(i, -1, -1, 3));
        if (i < 0 || i > 3) return false;
        var a = state.abilities[i];
        if (!a || a.empty) return false;
        if (a.cd > 0) return false;

        var cost = num(a.focusCost, 0, 0, 1e4);
        if (cost > state.focus) {
          /* OVERDRAW: allowed. Deficit is charged to Veil at q, Focus -> 0. */
          var deficit = cost - state.focus;
          state.focus = 0;
          addVeil(deficit * T.OVERDRAW_Q * mods.overdrawRateMult);
          emit({ type: 'overdraw', deficit: deficit });
          /* Only BORROWING holds the Veil open. Resetting the settle window on
             every cast gave Veil no reachable equilibrium: decay needs 1.5s of
             silence and the fastest cooldown is 0.42s, so a player who was
             fighting at all shed ~31% of what they gained and a full 85->25
             reset cost 16.5s of not casting against a 26s par. DESIGN Part 1
             is explicit that casting PAST your Focus is what feeds the Veil —
             so spending inside your own regen now settles normally. */
          run.sinceCast = 0;
        } else {
          state.focus -= cost;
        }
        a.cd = a.maxCd;

        var dmg = abilityDamage(a);
        var tgt = nearestEnemy();
        /* Telegraph timing for fx.js. `delay` is the fuse before a delayed AoE
           detonates and is ALWAYS a number (0 = instant), so fx can use it
           directly rather than a fixed 0.5s guess; note `ev.delay || 0.5`
           would mis-telegraph instant AoEs, test `typeof ev.delay==='number'`.
           A `ticks` ability instead lands in N pulses `tickInterval` apart.
           Both are clamped here with the same validation as the cast itself,
           so a mis-typed content number cannot produce a NaN telegraph. */
        var castTicks = Math.floor(num(a.ticks, 0, 0, 20));
        emit({
          type: 'cast', kind: a.kind, x: state.player.x, y: state.player.y,
          targetX: tgt ? tgt.x : state.player.x, targetY: tgt ? tgt.y : state.player.y,
          abilityId: a.id, range: abilityRange(a) * (a.kind === 'aoe' ? mods.aoeRadiusMult : 1),
          delay: isNum(a.delay) ? clamp(a.delay, 0, 10) : 0,
          ticks: castTicks,
          tickInterval: castTicks > 0 ? T.TICK_INTERVAL : 0
        });

        switch (a.kind) {
          case 'melee': castMelee(a, dmg); break;
          case 'projectile': castProjectile(a, dmg); break;
          case 'dash': castDash(a, dmg); break;
          case 'execute': castExecute(a, dmg); break;
          case 'aoe': default: castAoe(a, dmg); break;
        }
        checkBreach();
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    },

    setMove: function (mx, my) {
      if (!run) return;
      run.moveX = clamp(isNum(mx) ? mx : 0, -1, 1);
      run.moveY = clamp(isNum(my) ? my : 0, -1, 1);
    },

    /* The floor must stay below anything the CSS can hand us or the sim
       silently simulates space the canvas never draws: in landscape the
       playfield is ~157px tall, so a floor of 200 put 21.5% of the arena — and
       the player — off the bottom of the visible canvas. */
    setArena: function (w, h) {
      state.arena.w = clamp(isNum(w) ? w : 390, 120, 8000);
      state.arena.h = clamp(isNum(h) ? h : 700, 120, 8000);
      movePlayerTo(state.player.x, state.player.y);
      return { w: state.arena.w, h: state.arena.h };   // so callers can assert
    },

    choosePact: function (idOrNull) {
      try {
        if (state.phase !== 'pactDraft' || !run) return false;
        var next = run.pendingWave;
        if (idOrNull != null) {
          var offer = state.draftOffer || [];
          if (offer.indexOf(idOrNull) < 0) return false;
          var p = findById('PACTS', idOrNull);
          if (!p) return false;
          var cost = num(p.cost, 0, 0, 1e9);
          if (state.motes < cost) return false;            // stay in the draft
          state.motes -= cost;
          state.pactsTaken.push(p.id);
          state.veilFloor = clamp(state.veilFloor + num(p.upkeep, 0, 0, 100), 0, T.MAX_VEIL_FLOOR);
          recomputeMods();
          if (state.veil < state.veilFloor) setVeil(state.veilFloor);
          emit({ type: 'pact_taken', pactId: p.id });
        }
        state.draftOffer = null;
        startWave(next);
        snapshotRun(next);
        saveInternal();
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    },

    buyCovenant: function (nodeId) {
      try {
        var n = findById('COVENANT', nodeId);
        if (!n) return false;
        if (state.meta.covenantOwned.indexOf(n.id) >= 0) return false;
        var reqs = Array.isArray(n.requires) ? n.requires : [];
        for (var i = 0; i < reqs.length; i++) {
          if (state.meta.covenantOwned.indexOf(reqs[i]) < 0) return false;
        }
        var cost = num(n.cost, 0, 0, 1e9);
        if (state.meta.echoes < cost) return false;
        state.meta.echoes -= cost;
        state.meta.covenantOwned.push(n.id);
        if (run) recomputeMods();
        saveInternal();
        return true;
      } catch (err) { fail(err); return false; }
    },

    respecCovenant: function () {
      try {
        var owned = state.meta.covenantOwned, refund = 0;
        for (var i = 0; i < owned.length; i++) {
          var n = findById('COVENANT', owned[i]);
          if (!n) continue;
          var cost = num(n.cost, 0, 0, 1e9);
          /* Clean nodes cost ~3x and refund at 50%; ordinary nodes refund full. */
          refund += n.clean ? Math.floor(cost * 0.5) : cost;
        }
        state.meta.covenantOwned = [];
        state.meta.echoes = clamp(state.meta.echoes + refund, 0, 1e12);
        if (run) recomputeMods();
        saveInternal();
        return refund;
      } catch (err) { fail(err); return 0; }
    },

    setAscension: function (n) {
      var v = Math.floor(num(n, 0, 0, 8));
      state.meta.ascension = clamp(v, 0, clamp(state.meta.ascensionUnlocked, 0, 8));
      recomputeAmods();
      saveInternal();
      return state.meta.ascension;
    },

    save: function () { return saveInternal(); },

    abandonRun: function () {
      try {
        if (!run) { state.phase = 'menu'; return false; }
        endRun(false);
        return true;
      } catch (err) { fail(err); return false; }
    },

    drainEvents: function () {
      var e = events.slice();
      events.length = 0;
      return e;
    },

    /* ---- test / harness hooks (not used by ui.js or fx.js) ---------- */
    _setStorage: function (obj) {
      _storage = (obj && typeof obj.getItem === 'function') ? obj : null;
      var d = loadSave();
      state.meta = sanitizeMeta(d.meta);
      return true;
    },
    _setSeed: function (s) { setSeed(s); },
    _clearSave: function () { storeDel(SAVE_KEY); runSnapshot = null; },
    _echoesFor: echoesFor,
    _leadAim: leadAim,

    /** Compact read model for autoplayers/harness policies. Allocates one
     *  small object; never leaks internal enemy references. */
    policyView: function () {
      var p = state.player, best = null, bd = Infinity, wraith = null, wd = Infinity;
      var i, e, d;
      for (i = 0; i < state.enemies.length; i++) {
        e = state.enemies[i];
        d = hyp(e.x - p.x, e.y - p.y);
        if (d < bd) { bd = d; best = e; }
        if (e.isWraith && d < wd) { wd = d; wraith = e; }
      }
      var threatX = 0, threatY = 0;
      for (i = 0; i < state.enemies.length; i++) {
        e = state.enemies[i];
        d = hyp(e.x - p.x, e.y - p.y) || 1;
        if (d > 300) continue;
        threatX -= (e.x - p.x) / d / d * 100;
        threatY -= (e.y - p.y) / d / d * 100;
      }
      var moteX = 0, moteY = 0, moteD = Infinity;
      for (i = 0; i < state.motesOnGround.length; i++) {
        var m = state.motesOnGround[i];
        d = hyp(m.x - p.x, m.y - p.y);
        if (d < moteD) { moteD = d; moteX = m.x; moteY = m.y; }
      }
      return {
        phase: state.phase, wave: state.wave,
        hp: state.hp, hpMax: state.hpMax, hpFrac: state.hp / (state.hpMax || 1),
        focus: state.focus, focusMax: state.focusMax,
        veil: state.veil, veilFloor: state.veilFloor, veilTier: state.veilTier,
        motes: state.motes,
        waveHpRemaining: state.waveHpRemaining, waveHpTotal: state.waveHpTotal,
        parRemaining: state.parRemaining, parTotal: state.parTotal,
        enemyCount: state.enemies.length, wraithCount: state.wraithCount,
        nearestDist: best ? bd : Infinity,
        nearestX: best ? best.x : p.x, nearestY: best ? best.y : p.y,
        nearestIsWraith: best ? !!best.isWraith : false,
        wraithDist: wraith ? wd : Infinity,
        threatX: threatX, threatY: threatY,
        moteDist: moteD, moteX: moteX, moteY: moteY,
        px: p.x, py: p.y, arenaW: state.arena.w, arenaH: state.arena.h,
        /* the threshold from DESIGN 5.1: overdraw iff H > 1500*(1+V/50) */
        overdrawThreshold: 1500 * (1 + state.veil / 50),
        abilities: state.abilities.map(function (a) {
          return { i: a.id, cd: a.cd, ready: a.cd <= 0, cost: a.focusCost, kind: a.kind, range: abilityRange(a) };
        })
      };
    }
  };

  /** Internal failure path. A sim exception must never rethrow every frame and
   *  must never leave a frozen screen: log once, surface on state.error, end
   *  the run cleanly (banking echoes) so the UI can route to the death screen. */
  function fail(err) {
    halted = true;
    state.error = (err && err.message) ? String(err.message) : String(err);
    try {
      if (typeof console !== 'undefined' && console && console.error) {
        console.error('[Sim] simulation error:', err && err.stack ? err.stack : err);
      }
    } catch (e) { /* ignore */ }
    try {
      if (run) { emit({ type: 'death' }); endRun(true); }
      else state.phase = 'menu';
    } catch (e2) { state.phase = 'menu'; run = null; }
    halted = false;   // a new run is allowed to start cleanly
  }

  /* ------------------------------------------------------------------ *
   * 17. Boot
   * ------------------------------------------------------------------ */

  (function boot() {
    try {
      var d = loadSave();
      state.meta = sanitizeMeta(d.meta);
      updateUnlocks();
      recomputeAmods();
    } catch (e) { state.meta = blankMeta(); }
    try {
      if (typeof C().validatePacts === 'function') {
        var violations = C().validatePacts();
        if (Array.isArray(violations) && violations.length && typeof console !== 'undefined' && console.error) {
          console.error('[Sim] CONTENT.validatePacts() reported ' + violations.length +
            ' anti-runaway violation(s):', violations);
        }
      }
    } catch (e) { /* content is not allowed to break boot */ }
  })();

  g.Sim = Sim;

})(typeof window !== 'undefined' ? window : globalThis);
