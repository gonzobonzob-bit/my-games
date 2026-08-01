// Grimoire Siege — content: tower roster, wave table, tuning constants
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing top-level scope; load order: content, sim, fx, ui.

const TOWERS=[
  {id:'arrow',name:'Archer',icon:'🏹',cost:50,dmg:25,range:120,rate:60,color:'#22c55e',proj:'arrow'},
  {id:'fire',name:'Pyromage',icon:'🔥',cost:80,dmg:40,range:100,rate:80,color:'#ef4444',proj:'fire',aoe:30},
  {id:'ice',name:'Frost',icon:'❄️',cost:70,dmg:20,range:110,rate:70,color:'#38bdf8',proj:'ice',slow:0.5},
  {id:'lightning',name:'Storm',icon:'⚡',cost:100,dmg:60,range:130,rate:100,color:'#fbbf24',proj:'lightning',chain:2},
  {id:'poison',name:'Venom',icon:'☠️',cost:90,dmg:15,range:95,rate:50,color:'#84cc16',proj:'poison',dot:5},
  {id:'cannon',name:'Cannon',icon:'💣',cost:120,dmg:100,range:90,rate:120,color:'#9ca3af',proj:'cannon',aoe:50},
  {id:'magic',name:'Arcane',icon:'🔮',cost:150,dmg:80,range:150,rate:90,color:'#a855f7',proj:'magic'},
  {id:'dark',name:'Shadow',icon:'🌑',cost:200,dmg:150,range:140,rate:130,color:'#6b7280',proj:'dark',aoe:40},
  {id:'holy',name:'Divine',icon:'✨',cost:180,dmg:120,range:160,rate:100,color:'#fde047',proj:'holy'},
  {id:'dragon',name:'Dragon',icon:'🐉',cost:300,dmg:200,range:180,rate:150,color:'#f97316',proj:'dragon',aoe:60},
];

// Wave speeds are multipliers on ENEMY_BASE_SPEED (px/sec). The curve is
// deliberately shallow: difficulty comes from HP and count, not from enemies
// outrunning every projectile in the game.
const WAVE_DEFS=[
  {count:8,hp:60,spd:1.00},{count:12,hp:80,spd:1.05},{count:10,hp:100,spd:1.10,boss:1},
  {count:15,hp:90,spd:1.15},{count:12,hp:130,spd:1.15,fast:3},{count:18,hp:120,spd:1.20,boss:1},
  {count:20,hp:150,spd:1.25},{count:15,hp:200,spd:1.30,fast:5},{count:22,hp:180,spd:1.30,boss:2},
  {count:25,hp:220,spd:1.35},{count:20,hp:300,spd:1.40,boss:2},{count:30,hp:400,spd:1.50,boss:3},
];

const SAVE_KEY='grimoireSiege_save_v1';
const MAX_TOWER_LEVEL=3;

// ---- Tuning constants (all time-based, in seconds / pixels-per-second) ----
const ENEMY_BASE_SPEED=72;   // px/sec at spd multiplier 1.0
const FAST_MULT=1.45;        // "fast" variant speed multiplier
const BOSS_MULT=0.75;        // bosses are tanky, not swift
const BOSS_HP_MULT=4.5;
const SLOW_FACTOR=0.45;      // frost slow
const SLOW_DURATION=2.2;
const DOT_DURATION=3.5;
const DOT_INTERVAL=0.5;
const DOT_DAMAGE=5;
const START_GOLD=240;
const START_LIVES=20;
const PREP_TIME=6000;        // ms before wave 1 — time to actually build
const WAVE_GAP=5000;         // ms between waves
const SPAWN_INTERVAL=750;    // ms between spawns within a wave
const MAX_PARTICLES=420;

// Projectile speeds (px/sec) and steering (radians/sec) per projectile type.
const PROJ_TUNE={
  arrow:{speed:520,turn:5},   fire:{speed:330,turn:6},    ice:{speed:400,turn:6},
  lightning:{speed:780,turn:9},poison:{speed:340,turn:7},  cannon:{speed:290,turn:2.2},
  magic:{speed:430,turn:8},   dark:{speed:360,turn:7},     holy:{speed:480,turn:8},
  dragon:{speed:360,turn:5},
};
