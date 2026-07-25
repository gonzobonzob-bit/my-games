/* ============================================================
   CHOP SHOP CIRCUIT — parts & league data
   Pure data, no engine calls. Edit this file to reskin/rebalance.
   ============================================================ */
'use strict';

const STARTING_CREDITS = 600;

/* Weight reduces effective speed/turn from the drivetrain — see computeBotStats() in economy.js */
const PARTS = {
  chassis: [
    { id: 'ch0', name: 'Scrap Frame', cost: 0, hp: 200, weight: 20, desc: 'Held together with baling wire and hope.' },
    { id: 'ch1', name: 'Alloy Chassis', cost: 400, hp: 300, weight: 28, desc: 'Actual aluminum. A step up from rust.' },
    { id: 'ch2', name: 'Reinforced Steel', cost: 1200, hp: 430, weight: 38, desc: 'Thick plate over a welded roll cage.' },
    { id: 'ch3', name: 'Titanium Shell', cost: 3000, hp: 580, weight: 46, desc: 'Aerospace surplus. Absurdly overbuilt.' },
    { id: 'ch4', name: 'Fortress Plate', cost: 7000, hp: 780, weight: 58, desc: 'A vault on wheels.' },
  ],
  drivetrain: [
    { id: 'dr0', name: 'Junkyard Wheels', cost: 0, speed: 3.2, accel: 2.0, turn: 2.4, desc: 'Four mismatched tires, zero warranty.' },
    { id: 'dr1', name: 'Dual Motor', cost: 350, speed: 4.0, accel: 2.6, turn: 2.8, desc: 'Twin electric hubs, decent torque.' },
    { id: 'dr2', name: 'Racing Treads', cost: 1000, speed: 4.8, accel: 3.4, turn: 3.4, desc: 'Tank-style treads built for grip.' },
    { id: 'dr3', name: 'Overdrive Servos', cost: 2500, speed: 5.6, accel: 4.2, turn: 4.0, desc: 'Racing-grade actuators, aggressively geared.' },
    { id: 'dr4', name: 'Quantum Drive', cost: 6000, speed: 6.6, accel: 5.0, turn: 4.6, desc: 'Nobody quite knows how it works. It works.' },
  ],
  armor: [
    { id: 'ar0', name: 'Bare Metal', cost: 0, hp: 0, weight: 0, desc: 'What you see is what you get.' },
    { id: 'ar1', name: 'Sheet Steel', cost: 300, hp: 100, weight: 8, desc: 'Bolted-on plating from a scrapped trailer.' },
    { id: 'ar2', name: 'Composite Plate', cost: 900, hp: 225, weight: 14, desc: 'Layered fiber-steel composite panels.' },
    { id: 'ar3', name: 'Ablative Ceramic', cost: 2200, hp: 375, weight: 18, desc: 'Chips away instead of caving in.' },
    { id: 'ar4', name: 'Reactive Armor', cost: 5000, hp: 575, weight: 24, desc: 'Explosively deflects incoming hits.' },
  ],
  /* Weapon archetypes follow real robot-combat classes. Vertical spinners are
     the current real-world meta — they brace against the floor and launch the
     opponent upward; horizontal spinners hit hardest but throw themselves back
     just as hard (modeled as `recoil`). */
  weapon: [
    { id: 'wp0', name: 'Drum Spinner', cost: 0, type: 'drum', dmg: 9, cooldown: 0.55, range: 2.0, knockback: 5, desc: 'A stubby scrap drum. Fast, steady, unimpressive.' },
    { id: 'wp1', name: 'Horizontal Spinner', cost: 500, type: 'hspinner', dmg: 18, cooldown: 0.9, range: 2.8, knockback: 11, recoil: true, desc: 'Enormous reach and energy — and it throws itself just as hard.' },
    { id: 'wp2', name: 'Pneumatic Flipper', cost: 1400, type: 'flipper', dmg: 14, cooldown: 1.2, range: 2.2, knockback: 20, flip: true, desc: 'Gets underneath and launches. Landing upside down is the real damage.' },
    { id: 'wp3', name: 'Vertical Spinner', cost: 3200, type: 'vspinner', dmg: 24, cooldown: 0.7, range: 2.1, knockback: 14, desc: 'The meta pick. Braces on the floor and sends opponents skyward.' },
    { id: 'wp4', name: 'Hydraulic Crusher', cost: 6500, type: 'crusher', dmg: 38, cooldown: 1.8, range: 1.7, knockback: 3, pierce: true, desc: 'Slow beak that punches straight through armor plating.' },
  ],
  special: [
    { id: 'sp0', name: 'None', cost: 0, kind: 'none', desc: 'No special system installed.' },
    { id: 'sp1', name: 'Gyro Stabilizer', cost: 400, kind: 'gyro', desc: 'Self-rights after a flip, shrugs off stuns faster.' },
    { id: 'sp2', name: 'Overdrive Core', cost: 1500, kind: 'overdrive', desc: 'Below 30% HP: a one-time 5s burst of +40% damage and speed.' },
    { id: 'sp3', name: 'Shield Capacitor', cost: 3000, kind: 'shield', desc: 'Absorbs the first 25 damage taken each battle.' },
    { id: 'sp4', name: 'EMP Disruptor', cost: 6000, kind: 'emp', desc: 'First contact with the enemy briefly stuns them.' },
  ],
};

const SLOT_ORDER = ['chassis', 'weapon', 'armor', 'drivetrain', 'special'];

const DEFAULT_LOADOUT = { chassis: 'ch0', weapon: 'wp0', armor: 'ar0', drivetrain: 'dr0', special: 'sp0' };

function findPart(slot, id) {
  return PARTS[slot].find(p => p.id === id) || PARTS[slot][0];
}

/* League ladder — hand-tuned opponents, not composed from the player catalog above. */
const LEAGUE = [
  {
    id: 'l0', name: 'Rustbucket Rookie', reward: 250,
    flavor: 'Fresh out of the scrapyard. Barely holds together.',
    stats: { hp: 225, speed: 3.0, accel: 2.0, turn: 2.2, weaponType: 'drum', dmg: 8, cooldown: 0.65, range: 2.0, knockback: 5 },
  },
  {
    id: 'l1', name: 'Sparkplug Sisters', reward: 450,
    flavor: 'Twin-built, twice the attitude.',
    stats: { hp: 325, speed: 3.6, accel: 2.6, turn: 2.8, weaponType: 'drum', dmg: 13, cooldown: 0.5, range: 2.1, knockback: 6 },
  },
  {
    id: 'l2', name: 'The Grinder', reward: 750,
    flavor: 'Slow, heavy, relentless. Reach for days.',
    stats: { hp: 525, speed: 2.6, accel: 1.8, turn: 2.0, weaponType: 'hspinner', dmg: 17, cooldown: 0.9, range: 2.8, knockback: 10, recoil: true },
  },
  {
    id: 'l3', name: 'Voltage Vandal', reward: 1200,
    flavor: 'Fast, erratic, and it will put you on your back.',
    stats: { hp: 475, speed: 5.2, accel: 4.4, turn: 4.2, weaponType: 'flipper', dmg: 15, cooldown: 1.1, range: 2.2, knockback: 20, flip: true },
  },
  {
    id: 'l4', name: 'Iron Marauder', reward: 2000,
    flavor: 'Championship-grade plating, championship-grade cruelty.',
    stats: { hp: 800, speed: 4.2, accel: 3.2, turn: 3.2, weaponType: 'vspinner', dmg: 22, cooldown: 0.7, range: 2.1, knockback: 14 },
  },
  {
    id: 'l5', name: 'Chrome Reaper', reward: 3500,
    flavor: 'Undefeated. Nobody has seen the judges against it.',
    stats: { hp: 1050, speed: 5.0, accel: 4.0, turn: 3.8, weaponType: 'crusher', dmg: 40, cooldown: 1.7, range: 1.8, knockback: 4, pierce: true },
  },
];
