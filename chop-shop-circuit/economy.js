/* ============================================================
   CHOP SHOP CIRCUIT — economy, save/load, bot stat math
   ============================================================ */
'use strict';

const SAVE_KEY = 'chop-shop-circuit-save-slot0';
const SAVE_VERSION = 1;

function defaultSave() {
  return {
    version: SAVE_VERSION,
    credits: STARTING_CREDITS,
    owned: {
      chassis: ['ch0'], weapon: ['wp0'], armor: ['ar0'], drivetrain: ['dr0'], special: ['sp0'],
    },
    loadout: Object.assign({}, DEFAULT_LOADOUT),
    ladderIndex: 0,
    wins: 0,
    losses: 0,
    quality: 'high',
    muted: false,
    rank: 0,      // Chrome Circuit Gauntlet streak — unlocked after beating Chrome Reaper
    rankBest: 0,
  };
}

const store = (() => {
  let d = defaultSave();
  let hasSave = false;
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === SAVE_VERSION) { d = Object.assign(defaultSave(), parsed); hasSave = true; }
      }
    } catch (e) { /* corrupt save — fall back to defaults */ }
    return d;
  }
  load();
  return {
    get: () => d,
    hasSave: () => hasSave,
    save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); hasSave = true; } catch (e) {} },
    reset() { d = defaultSave(); hasSave = false; try { localStorage.removeItem(SAVE_KEY); } catch (e) {} },
  };
})();

let autosaveTimer = null;
function startAutosave() {
  if (autosaveTimer) return;
  autosaveTimer = setInterval(() => store.save(), 30000);
}

/* ---------------- number formatting ---------------- */
function fmtCredits(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
  return (n / 1000000).toFixed(2) + 'M';
}

/* ---------------- ownership / purchases ---------------- */
function ownsPart(slot, id) {
  const owned = store.get().owned[slot] || [];
  return owned.includes(id);
}

function buyPart(slot, id) {
  const s = store.get();
  const part = findPart(slot, id);
  if (ownsPart(slot, id)) return { ok: false, reason: 'already-owned' };
  if (s.credits < part.cost) return { ok: false, reason: 'cant-afford' };
  s.credits -= part.cost;
  s.owned[slot].push(id);
  store.save();
  return { ok: true };
}

function equipPart(slot, id) {
  if (!ownsPart(slot, id)) return { ok: false, reason: 'not-owned' };
  store.get().loadout[slot] = id;
  store.save();
  return { ok: true };
}

function getLoadout() {
  return store.get().loadout;
}

/* ---------------- bot stat math ----------------
   Heavier builds (chassis + armor weight) drag down the drivetrain's
   raw speed/accel/turn numbers. Lightest chassis (weight 20) is the
   baseline with no penalty; the heaviest combos trade a lot of mobility
   for a lot of HP. */
function weightFactor(weight) {
  return Math.max(0.5, Math.min(1.05, 1 - (weight - 20) * 0.008));
}

function computeBotStats(loadout) {
  const chassis = findPart('chassis', loadout.chassis);
  const drivetrain = findPart('drivetrain', loadout.drivetrain);
  const armor = findPart('armor', loadout.armor);
  const weapon = findPart('weapon', loadout.weapon);
  const special = findPart('special', loadout.special);
  const weight = chassis.weight + armor.weight;
  const wf = weightFactor(weight);
  return {
    maxHp: chassis.hp + armor.hp,
    speed: drivetrain.speed * wf,
    accel: drivetrain.accel * wf,
    turn: drivetrain.turn * (0.6 + 0.4 * wf),
    weight,
    weaponType: weapon.type,
    dmg: weapon.dmg,
    cooldown: weapon.cooldown,
    range: weapon.range,
    knockback: weapon.knockback,
    recoil: !!weapon.recoil,
    flip: !!weapon.flip,
    pierce: !!weapon.pierce,
    specialKind: special.kind,
    partNames: { chassis: chassis.name, weapon: weapon.name, armor: armor.name, drivetrain: drivetrain.name, special: special.name },
  };
}

function opponentStats(leagueEntry) {
  const s = leagueEntry.stats;
  return {
    maxHp: s.hp, speed: s.speed, accel: s.accel, turn: s.turn, weight: 30,
    weaponType: s.weaponType, dmg: s.dmg, cooldown: s.cooldown, range: s.range, knockback: s.knockback,
    recoil: !!s.recoil, flip: !!s.flip, pierce: !!s.pierce, specialKind: 'none',
    partNames: { chassis: '???', weapon: '???', armor: '???', drivetrain: '???', special: '???' },
  };
}

/* ---------------- battle results ---------------- */
function awardBattle(win, opponentIndex) {
  const s = store.get();
  if (win) {
    const entry = LEAGUE[opponentIndex];
    s.credits += entry.reward;
    s.wins++;
    if (opponentIndex === s.ladderIndex && s.ladderIndex < LEAGUE.length - 1) s.ladderIndex++;
    else if (opponentIndex === s.ladderIndex) s.ladderIndex = LEAGUE.length; // beat the last rung
  } else {
    s.losses++;
  }
  store.save();
}

/* ---------------- Chrome Circuit Gauntlet (post-ladder endgame loop) ----------------
   Unlocked once the player has beaten every league opponent (ladderIndex >= LEAGUE.length).
   Rather than invent new content, it remixes the existing league roster at escalating
   difficulty/reward as the player's rank streak climbs, and rotates through the whole
   roster so it doesn't turn into "fight Chrome Reaper forever." A loss softens the
   streak instead of zeroing it outright, so a single bad match doesn't erase a long run. */
function isGauntletUnlocked() {
  return store.get().ladderIndex >= LEAGUE.length;
}

function rankOpponent(rank) {
  const idx = rank % LEAGUE.length;
  const loops = Math.floor(rank / LEAGUE.length);
  const entry = LEAGUE[idx];
  const s = entry.stats;
  const mult = 1 + loops * 0.22 + idx * 0.03;
  return {
    name: `${entry.name} [Remix Rk ${rank + 1}]`,
    reward: Math.round(entry.reward * (1.15 + loops * 0.4)),
    flavor: `Gauntlet remix — rank ${rank + 1}. Tougher plating, tighter reflexes.`,
    stats: {
      hp: Math.round(s.hp * mult),
      speed: Math.min(9, s.speed * (1 + loops * 0.06)),
      accel: Math.min(7, s.accel * (1 + loops * 0.06)),
      turn: Math.min(6, s.turn * (1 + loops * 0.05)),
      weaponType: s.weaponType,
      dmg: Math.round(s.dmg * mult),
      cooldown: Math.max(0.35, s.cooldown * (1 - loops * 0.02)),
      range: s.range,
      knockback: s.knockback,
      recoil: !!s.recoil,
      flip: !!s.flip,
      pierce: !!s.pierce,
    },
  };
}

function awardRankBattle(win, reward) {
  const s = store.get();
  if (win) {
    s.credits += reward;
    s.wins++;
    s.rank = (s.rank || 0) + 1;
    s.rankBest = Math.max(s.rankBest || 0, s.rank);
  } else {
    s.losses++;
    s.rank = Math.floor((s.rank || 0) / 2); // a loss softens the streak instead of zeroing it
  }
  store.save();
}
