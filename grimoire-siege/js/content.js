// Grimoire Siege — content: towers, damage classes, resist profiles, wave
// script, endless scaling, branches, tuning constants, player-facing strings.
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing top-level scope; load order: content, sim, fx, ui.
// Data only — no functions, no logic. Shapes per CONTRACT.md (content.js section).

// ---------------- Damage classes ----------------
// Every tower deals exactly one class; every resist profile reduces classes
// independently. hitEnemy applies dmg * (1 - (e.resists[dmgClass]||0)).
const DAMAGE_CLASSES=['pierce','blast','arcane'];

// Per-class display metadata (not named in CONTRACT — gap-fill, see report).
// ui uses icon on shop buttons; fx may use color/icon for the resist glyphs.
const DMG_CLASS_META={
  pierce:{icon:'🗡️',label:'Pierce',color:'#e5e7eb'},
  blast: {icon:'💥',label:'Blast', color:'#f97316'},
  arcane:{icon:'🔮',label:'Arcane',color:'#a855f7'},
};

// ---------------- Towers ----------------
// Class spread — each class has a cheap and an expensive option:
//   pierce: Archer 50 / Venom 90 / Divine 180
//   blast:  Pyromage 80 / Cannon 120 / Dragon 300
//   arcane: Frost 70 / Storm 100 / Arcane 150 / Shadow 200
//
// Rebalance target (DESIGN.md §3 is the baseline being fixed): the old table
// ran 0.500 (Archer) down to 0.200 (Venom) — a solved ranking. New base
// single-target DPS/gold (DPS = dmg*60/rate) sits in a 0.27–0.42 band, with
// the spread carried by role, not raw efficiency. A 0.6 resist multiplies any
// tower's effective DPS/gold by 0.4 — e.g. Archer 0.420 → 0.168 on an
// Ironshell wave, below every unresisted option — so the ranking flips per
// wave and the preview is the read-and-react moment.
//
// `dot` semantics CHANGED: it is now the fraction of the firing tower's
// (branch/level-scaled) dmg dealt per DoT tick, not a flat amount. With
// DOT_INTERVAL=0.5s, sustained DoT DPS on a refreshed target = dmg*dot/0.5.
// Field names sim/fx already read are all preserved:
// id,name,icon,cost,dmg,range,rate,color,proj,aoe,slow,dot,chain.
const TOWERS=[
  // Archer — cheap pierce baseline. DPS 21*60/60=21.0 → 0.420/g (was 0.500).
  // Best naked value in the shop, worst thing to own on an Ironshell wave.
  {id:'arrow',name:'Archer',icon:'🏹',dmgClass:'pierce',cost:50,dmg:21,range:120,rate:60,color:'#22c55e',proj:'arrow'},
  // Pyromage — cheap blast splash. DPS 40*60/80=30.0 → 0.375/g, aoe 30.
  // Single-target discount pays for the splash circle.
  {id:'fire',name:'Pyromage',icon:'🔥',dmgClass:'blast',cost:80,dmg:40,range:100,rate:80,color:'#ef4444',proj:'fire',aoe:30},
  // Frost — cheap arcane utility. DPS 22*60/70=18.9 → 0.269/g.
  // Priced for the slow (SLOW_FACTOR 0.45), not the damage; Deepfrost branch
  // pushes the slow to ~0.30 of full speed.
  {id:'ice',name:'Frost',icon:'❄️',dmgClass:'arcane',cost:70,dmg:22,range:110,rate:70,color:'#38bdf8',proj:'ice',slow:0.5},
  // Storm — mid arcane, chain 2 at 0.6 falloff. DPS 55*60/100=33.0 → 0.330/g
  // single-target; up to +96% (0.6+0.36) against packed lines, so its real
  // ceiling ~0.65/g is situational (spacing), not constant.
  {id:'lightning',name:'Storm',icon:'⚡',dmgClass:'arcane',cost:100,dmg:55,range:130,rate:100,color:'#fbbf24',proj:'lightning',chain:2},
  // Venom — mid pierce, the old 0.200 dead slot made real. Direct DPS
  // 18*60/55=19.6 → 0.218/g; DoT adds dmg*dot/DOT_INTERVAL = 18*0.5/0.5 =
  // 18.0 sustained DPS while refreshed. Total ~37.6 → 0.418/g on a target
  // that lives — pierce's anti-boss pick, weak against chaff that dies fast.
  {id:'poison',name:'Venom',icon:'☠️',dmgClass:'pierce',cost:90,dmg:18,range:95,rate:55,color:'#84cc16',proj:'poison',dot:0.5},
  // Cannon — mid blast, big splash. DPS 90*60/120=45.0 → 0.375/g, aoe 50.
  // Heavy per-shot hits overkill chaff; earns its keep on dense waves.
  {id:'cannon',name:'Cannon',icon:'💣',dmgClass:'blast',cost:120,dmg:90,range:90,rate:120,color:'#9ca3af',proj:'cannon',aoe:50},
  // Arcane — mid-high arcane, no gimmick. DPS 85*60/90=56.7 → 0.378/g,
  // range 150. The reliable arcane damage line when Runewards are absent.
  {id:'magic',name:'Arcane',icon:'🔮',dmgClass:'arcane',cost:150,dmg:85,range:150,rate:90,color:'#a855f7',proj:'magic'},
  // Shadow — expensive arcane splash. DPS 145*60/125=69.6 → 0.348/g, aoe 40.
  // The only arcane area answer to late mixed waves.
  {id:'dark',name:'Shadow',icon:'🌑',dmgClass:'arcane',cost:200,dmg:145,range:140,rate:125,color:'#6b7280',proj:'dark',aoe:40},
  // Divine — expensive pierce single-target. DPS 115*60/100=69.0 → 0.383/g,
  // range 160 (longest bar Dragon). Pierce's boss-killer alongside Venom.
  {id:'holy',name:'Divine',icon:'✨',dmgClass:'pierce',cost:180,dmg:115,range:160,rate:100,color:'#fde047',proj:'holy'},
  // Dragon — capstone blast. DPS 210*60/140=90.0 → 0.300/g, aoe 60,
  // range 180. Buffed from 0.267: the biggest circle in the game should not
  // also be the worst gold in the game.
  {id:'dragon',name:'Dragon',icon:'🐉',dmgClass:'blast',cost:300,dmg:210,range:180,rate:140,color:'#f97316',proj:'dragon',aoe:60},
];

// ---------------- Resist profiles ----------------
// Shape per CONTRACT: {id,name,icon,resists:{pierce,blast,arcane}} — resist is
// a damage *reduction* fraction, 0..0.7. Names/icons teach the resist:
// armor shrugs arrows, cinder shrugs blasts, wards shrug spells. Singles
// resist one class at 0.6; duals resist two at 0.45 each, so exactly one
// class answers each dual ("only bombs crack a mirror").
const RESIST_PROFILES=[
  // Nothing between them and the arrows. Waves 1-2 exclusively.
  {id:'bare',  name:'Bare Rabble', icon:'🐀', resists:{pierce:0,   blast:0,   arcane:0}},
  // Riveted shell: arrows skip off. Burn it or blow it open.
  {id:'plate', name:'Ironshell',   icon:'🛡️', resists:{pierce:0.6, blast:0,   arcane:0}},
  // Born in the caldera: blasts are a warm breeze. Pierce or spell it.
  {id:'cinder',name:'Cinderborn',  icon:'🌋', resists:{pierce:0,   blast:0.6, arcane:0}},
  // Carved wards drink incoming magic. Steel and powder still bite.
  {id:'rune',  name:'Runeward',    icon:'🧿', resists:{pierce:0,   blast:0,   arcane:0.6}},
  // Polished plate turns arrows AND spells. Only blast cracks a mirror.
  {id:'mirror',name:'Mirrorplate', icon:'🪞', resists:{pierce:0.45,blast:0,   arcane:0.45}},
  // Sodden deep-thing: douses fire, grounds spells. Arrows sink right in.
  {id:'brine', name:'Brinehulk',   icon:'🐙', resists:{pierce:0,   blast:0.45,arcane:0.45}},
  // Bristling quills shed arrows and shrapnel. Spells slip between spines.
  {id:'thorn', name:'Thornmail',   icon:'🦔', resists:{pierce:0.45,blast:0.45,arcane:0}},
];

// ---------------- Wave script ----------------
// Replaces the old fixed WAVE_DEFS. Difficulty spine (count/hp/spd/boss/fast)
// keeps the shipped 12-wave curve; profilePool is what the RNG draws from at
// generateWave time, profileCount is how many distinct profiles the wave
// mixes (1-2). Waves 1-2 are no-resist only (contract). Wave 3 rolls the
// first single resist; duals enter the pool at wave 8; from wave 9 on every
// pool holds all three singles plus duals so the ranking cannot settle.
const WAVE_SCRIPT=[
  {count:8, hp:60, spd:1.00,                profilePool:['bare'],profileCount:1},
  {count:12,hp:80, spd:1.05,                profilePool:['bare'],profileCount:1},
  {count:10,hp:100,spd:1.10,boss:1,         profilePool:['plate','cinder','rune'],profileCount:1},
  {count:15,hp:90, spd:1.15,                profilePool:['plate','cinder','rune'],profileCount:1},
  {count:12,hp:130,spd:1.15,fast:3,         profilePool:['bare','plate','cinder','rune'],profileCount:2},
  {count:18,hp:120,spd:1.20,boss:1,         profilePool:['plate','cinder','rune'],profileCount:1},
  {count:20,hp:150,spd:1.25,                profilePool:['plate','cinder','rune'],profileCount:2},
  {count:15,hp:200,spd:1.30,fast:5,         profilePool:['plate','cinder','rune','mirror'],profileCount:2},
  {count:22,hp:180,spd:1.30,boss:2,         profilePool:['plate','cinder','rune','mirror','brine','thorn'],profileCount:2},
  {count:25,hp:220,spd:1.35,                profilePool:['plate','cinder','rune','mirror','brine','thorn'],profileCount:2},
  {count:20,hp:300,spd:1.40,boss:2,         profilePool:['mirror','brine','thorn','plate','rune'],profileCount:2},
  {count:30,hp:400,spd:1.50,boss:3,         profilePool:['plate','cinder','rune','mirror','brine','thorn'],profileCount:2},
];

// ---------------- Endless scaling (waves 13+) ----------------
// For wave n>12, let k = n-12. Intended arithmetic (sim implements):
//   hp    = 400 * hpGrowth^k        // 1.15^k: w13≈460, w16≈700, w20≈1224, w24≈2141
//   count = 30 + countGrowth*k      // w13: 31, w20: 38 — spawn time grows gently
//   spd   = min(spdCap, 1.50 + spdGrowth*k)  // caps at 1.9 around wave 25
//   boss  = 3 (wave-12 level); profilePool = every RESIST_PROFILES id incl.
//   duals; profileCount = 2 for all n >= profileCountFrom.
// spdGrowth is an extra key not named in CONTRACT (spdCap alone is not
// computable) — flagged in the build report.
const ENDLESS={hpGrowth:1.15,countGrowth:1,spdGrowth:0.03,spdCap:1.9,profileCountFrom:13};

// ---------------- Leak costs ----------------
// Restores the failure state (DESIGN.md change #4): a wave-12 boss is no
// longer priced like a wave-1 grunt. sim applies lives -= LEAK_COST[e.kind].
const LEAK_COST={grunt:1,fast:1,boss:4};

// ---------------- Upgrade branches (chosen at L2) ----------------
// mods MULTIPLY towerStats fields (dmg, range, rate — rate<1 means faster)
// and special fields (aoe, chain, slowFactor, dotDamage, dotStacks).
// Blurbs are button copy: <=40 chars, and every number in them matches the
// mod (verify before editing either side).
const BRANCHES={
  arrow:{
    a:{name:'Longbow',      blurb:'Heavier shafts fly a third farther.', mods:{dmg:1.6,range:1.3}},   // 1.6x dmg, 1.3x range
    b:{name:'Quickstring',  blurb:'Looses arrows twice as fast.',        mods:{rate:0.5}},            // 2x fire rate
  },
  fire:{
    a:{name:'Firestorm',    blurb:'Blast circle half again as wide.',    mods:{aoe:1.5}},             // aoe 30->45
    b:{name:'Whitefire',    blurb:'Hotter flame, half again the burn.',  mods:{dmg:1.5}},
  },
  ice:{
    a:{name:'Deepfrost',    blurb:'Chilled foes crawl at third speed.',  mods:{slowFactor:0.67}},     // 0.45*0.67≈0.30 of full speed
    b:{name:'Shatterspike', blurb:'Ice spikes hit twice as hard.',       mods:{dmg:2}},
  },
  lightning:{
    a:{name:'Forked Sky',   blurb:'Bolts leap to four foes, not two.',   mods:{chain:2}},             // chain 2->4
    b:{name:'Overload',     blurb:'One leap only, double the bolt.',     mods:{dmg:2,chain:0.5}},     // chain 2->1
  },
  poison:{
    // Venom's fix (DESIGN.md change #2): DoT derives from tower dmg, so both
    // branches scale with level — and Plaguebrood stacks doses.
    a:{name:'Virulence',    blurb:'Each venom tick bites twice as hard.',mods:{dotDamage:2}},         // dot tick = dmg*dot*2
    b:{name:'Plaguebrood',  blurb:'Venom stacks three doses deep.',      mods:{dotStacks:3}},         // 1 stack -> 3 stacks
  },
  cannon:{
    a:{name:'Siegemaster',  blurb:'Slower load, near-double the shell.', mods:{dmg:1.8,rate:1.2}},    // net 1.5x DPS, bigger overkill
    b:{name:'Grapeshot',    blurb:'Half again the spray, lighter shot.', mods:{aoe:1.5,dmg:0.8,rate:0.75}}, // aoe 50->75, ~1.07x DPS
  },
  magic:{
    a:{name:'Farseer',      blurb:'Strikes from across the field.',      mods:{range:1.4}},           // range 150->210
    b:{name:'Twinbolt',     blurb:'Casts near twice as fast.',           mods:{rate:0.55}},           // 1.82x fire rate
  },
  dark:{
    a:{name:'Umbral Edge',  blurb:'Each strike cuts half again deeper.', mods:{dmg:1.5}},
    b:{name:'Creeping Night',blurb:'Dark burst near double wide.',       mods:{aoe:1.8}},             // aoe 40->72
  },
  holy:{
    a:{name:'Sunlance',     blurb:'One lance, half again the force.',    mods:{dmg:1.5}},
    b:{name:'High Beacon',  blurb:'Sees a third farther, fires faster.', mods:{range:1.35,rate:0.8}},
  },
  dragon:{
    a:{name:'Cataclysm',    blurb:'Breath scorches half again as wide.', mods:{aoe:1.5}},             // aoe 60->90
    b:{name:'Elder Wyrm',   blurb:'Each breath burns half again deep.',  mods:{dmg:1.5}},
  },
};

// ---------------- Save / core tuning ----------------
// Schema v2 per CONTRACT (adds investedGold, per-tower branch, settings,
// endless progress). sim migrates v1 by reading SAVE_KEY_V1.
const SAVE_KEY='grimoireSiege_save_v2';
const SAVE_KEY_V1='grimoireSiege_save_v1';
const MAX_TOWER_LEVEL=3;

// ---- Tuning constants (all time-based, in seconds / pixels-per-second) ----
const ENEMY_BASE_SPEED=72;   // px/sec at spd multiplier 1.0
const FAST_MULT=1.45;        // "fast" variant speed multiplier
const BOSS_MULT=0.75;        // bosses are tanky, not swift
const BOSS_HP_MULT=4.5;
const SLOW_FACTOR=0.45;      // frost slow (Deepfrost branch multiplies this)
const SLOW_DURATION=2.2;
const DOT_DURATION=3.5;
const DOT_INTERVAL=0.5;
const DOT_DAMAGE=5;          // LEGACY v1 flat tick — v2 sim derives ticks from
                             // tower dmg * TOWERS.dot instead; kept only so a
                             // stale sim.js cannot throw during integration.
const START_GOLD=240;
const START_LIVES=20;
const PREP_TIME=6000;        // ms before wave 1 — time to actually build
const WAVE_GAP=5000;         // ms between waves — the preview/read window
const SPAWN_INTERVAL=750;    // ms between spawns within a wave
const MAX_PARTICLES=420;

// Projectile speeds (px/sec) and steering (radians/sec) per projectile type.
const PROJ_TUNE={
  arrow:{speed:520,turn:5},   fire:{speed:330,turn:6},    ice:{speed:400,turn:6},
  lightning:{speed:780,turn:9},poison:{speed:340,turn:7},  cannon:{speed:290,turn:2.2},
  magic:{speed:430,turn:8},   dark:{speed:360,turn:7},     holy:{speed:480,turn:8},
  dragon:{speed:360,turn:5},
};

// ---------------- Player-facing strings ----------------
// Voice guide:
// - The grimoire narrates: dry field-notes from the tower's war-librarian.
// - Fact first, consequence second ("a boss leak costs 4 lives", never "watch out!").
// - Never praise the player; warmth lives in the world (the crystal, the runes,
//   the gold), not in the narrator.
// Strings are data: {token} placeholders are substituted by ui, no functions
// here. Every number in copy matches a constant above (leak costs, wave 12).

// Wave preview panel (ui reads nextWaveDef and fills tokens). Kind rows teach
// LEAK_COST; profile rows teach the resist read.
const STR_WAVE_PREVIEW={
  title:'NEXT WAVE',
  waveLabel:'WAVE {n}',
  gruntRow:'{n}× grunt — a leak costs 1 life',
  fastRow:'{n}× swift — a leak costs 1 life',
  bossRow:'{n}× boss — a leak costs 4 lives',
  profileRow:'{icon} {name} resists {list}',   // {list} e.g. "🗡️ Pierce" or "🗡️+🔮"
  noResistRow:'{icon} {name} — resists nothing',
  hint:'Build the class they cannot shrug.',
};

// Endless prompt at wave-12 clear (ui calls beginEndless / claimVictory).
const STR_ENDLESS={
  title:'WAVE 12 BROKEN',
  body:'Past this gate the horde grows every wave and never ends. Score keeps counting.',
  continueBtn:'FIGHT ON',
  victoryBtn:'CLAIM VICTORY',
  enterMsg:'🌊 ENDLESS SIEGE',
};

// Settings panel (main menu + pause overlay).
const STR_SETTINGS={
  title:'SETTINGS',
  volume:'Volume',
  shake:'Screen shake',
  back:'Back',
};

// Branch picker shown when upgrading past L1 (both options cost upgradeCost).
const STR_BRANCH={
  title:'CHOOSE A PATH',
  prompt:'Level 2 sets this tower for good.',
  costNote:'Either path: {cost}🪙',
};
