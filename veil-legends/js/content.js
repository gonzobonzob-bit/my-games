/* ============================================================================
   Veil Legends — content.js
   Owner: content-writer. Pure data + pure functions. No DOM, no state, no
   storage. Loads under plain Node (defines CONTENT on globalThis).

   CONVENTIONS THIS FILE ASSUMES (documented so sim.js can match them):

   1. `hero.atk` is a 100-baseline attack RATING. Damage = ability.damage *
      (atk/100) * damageMult. All five heroes ship at atk 100 so that
      "12 damage per Focus" is auditable straight off the ability numbers;
      hero identity lives in the kits, not in a global multiplier.
      buff:{stat:'atk',amount:35} therefore reads as +35%.
   2. `wraithDamageMult` = damage the PLAYER DEALS to Veilwraiths (consistent
      with meleeDamageMult / projDamageMult / aoeDamageMult, which are all
      player-dealt). >1 counts as a damage increase and requires upkeep.
   3. `settleWindowAdd` is in seconds, added to the 1.5s settle window.
      Negative = the Veil forgets you sooner.
   4. ENEMY_TYPES hp/atk are PRE-SCALING base values. Sim applies the wave
      curve (N(w)=6+2w, avgHP=100*(1+0.15w)) on top. Boss HP is absolute and
      is not part of the scaled minion pool.
   5. waveTable(w) returns filler weights. Entries whose archetype has
      boss:true carry weight 0 and are spawned EXACTLY ONCE, regardless of
      weight. CONTENT.bossForWave(w) is provided as a second, unambiguous
      route to the same answer.

   BALANCE ANCHOR (DESIGN.md 5.1): k = 12 damage per Focus, rho = 18 Focus/s,
   so base sustained DPS = 216. Every hero's first ability sits at 12.0-12.1
   damage per Focus and ~18-19 Focus/s at full uptime. The SPREAD against each
   hero's own focusRegen is deliberate: the Warrior spams into slight debt, the
   Veilcaller lives in debt, the Ranger sits exactly on the line.
   ========================================================================== */
(function (g) {
  'use strict';

  /* ==========================================================================
     VEIL TIERS
     ------------------------------------------------------------------------
     *** THE BALANCE LEVER. DESIGN.md 5.5 assertion 1: whether flat-Veil or
     pulsed-Veil play wins is an artefact of THIS TABLE'S STEEPNESS. If the
     harness finds one policy dominating the other by more than 8%
     motes-per-HP, the fix is the multipliers below and NOTHING ELSE. ***
     Shape is x1 / x2 / x4 / x8 / x16 at 0 / 25 / 50 / 75 / 90.
     Any copy in STRINGS that quotes a tier number is derived from here —
     grep '×16' before touching it.
     ======================================================================== */
  var VEIL_TIERS = [
    { min: 0,  mult: 1  },
    { min: 25, mult: 2  },
    { min: 50, mult: 4  },
    { min: 75, mult: 8  },
    { min: 90, mult: 16 }
  ];

  /* ==========================================================================
     HEROES — 5 x 4 abilities
     ======================================================================== */
  var HEROES = [
    {
      id: 'warrior', name: 'Warrior', icon: '⚔️', color: '#ef4444',
      hp: 1250, focusMax: 90, focusRegen: 17, atk: 100, spd: 340,
      unlockAt: null,
      tagline: 'Spends past regen on purpose and has the meat to survive it.',
      quirk: 'Counts the wave out loud and is usually wrong by two.',
      abilities: [
        { id: 'war_strike', name: 'Power Strike', icon: '⚔️', kind: 'melee',
          damage: 145, range: 70, cd: 0, maxCd: 0.65, focusCost: 12, lunge: true,
          tip: '145 damage for 12 Focus, every 0.65s. This is the whole economy — every other button is measured against this rate.' },
        { id: 'war_whirl', name: 'Whirlwind', icon: '🌀', kind: 'aoe',
          damage: 200, range: 110, cd: 0, maxCd: 3.5, focusCost: 30,
          tip: '200 to everything inside 110px. One enemy is a waste. Three is the reason you moved.' },
        { id: 'war_bulwark', name: 'Bulwark', icon: '🛡️', kind: 'aoe',
          damage: 70, range: 95, cd: 0, maxCd: 11, focusCost: 20,
          shield: { amount: 320, duration: 5 },
          tip: '320 shield for 5s. Shield eats this hit; it does not stop the Veil raising the next one.' },
        { id: 'war_berserk', name: 'BERSERKER', icon: '💢', kind: 'aoe',
          damage: 420, range: 130, cd: 0, maxCd: 14, focusCost: 55,
          buff: { stat: 'atk', amount: 35, duration: 5 }, heal: 180,
          tip: '420 in a ring, +35% attack for 5s, 180 healed. The five seconds are worth more than the hit — open with it, do not close with it.' }
      ]
    },
    {
      id: 'mage', name: 'Mage', icon: '🔮', color: '#8b5cf6',
      hp: 720, focusMax: 120, focusRegen: 20, atk: 100, spd: 330,
      unlockAt: null,
      tagline: 'The deepest pool in the roster and the softest body under it.',
      quirk: 'Will not cast standing on a seam in the stones.',
      abilities: [
        { id: 'mag_bolt', name: 'Firebolt', icon: '🔥', kind: 'projectile',
          damage: 194, range: 300, cd: 0, maxCd: 0.85, focusCost: 16,
          homing: true, speed: 620,
          tip: '194 for 16 Focus. It leads the target for you — the same baseline rate as everyone else’s first button.' },
        { id: 'mag_bliz', name: 'Blizzard', icon: '❄️', kind: 'aoe',
          damage: 150, range: 190, cd: 0, maxCd: 5, focusCost: 40,
          slow: { amount: 0.5, duration: 3 },
          tip: '150, and half speed for 3s. Catching a Lancer mid-windup is worth more than the damage.' },
        { id: 'mag_lance', name: 'Arcane Lance', icon: '✨', kind: 'projectile',
          damage: 260, range: 420, cd: 0, maxCd: 2.2, focusCost: 22,
          pierce: true, speed: 900,
          tip: '260 per body, straight through. The damage is fixed; the line is your job.' },
        { id: 'mag_meteor', name: 'METEOR', icon: '☄️', kind: 'aoe',
          damage: 760, range: 210, cd: 0, maxCd: 15, focusCost: 62, delay: 0.45,
          tip: '0.45s in the air, then 760 across 210px. Everything keeps walking during the delay — aim where they will be.' }
      ]
    },
    {
      id: 'assassin', name: 'Assassin', icon: '🗡️', color: '#10b981',
      hp: 860, focusMax: 80, focusRegen: 21, atk: 100, spd: 420,
      unlockAt: null,
      tagline: 'Fastest regen, smallest pool. Sustainable if you never stop moving.',
      quirk: 'Sharpens between waves whether or not it needs it.',
      abilities: [
        { id: 'asn_quick', name: 'Quick Strike', icon: '🗡️', kind: 'melee',
          damage: 96, range: 60, cd: 0, maxCd: 0.42, focusCost: 8,
          tip: '96 for 8 Focus, every 0.42s. Cheap enough that you can hold this down inside your own regen and owe the Veil nothing.' },
        { id: 'asn_dash', name: 'Shadow Dash', icon: '💨', kind: 'dash',
          damage: 170, range: 240, cd: 0, maxCd: 4, focusCost: 26, speed: 1500,
          tip: 'Through the target, not to it. Hits everything you pass and drops contact for the frames you are gone.' },
        { id: 'asn_fang', name: 'Twin Fang', icon: '🦷', kind: 'melee',
          damage: 130, range: 65, cd: 0, maxCd: 3, focusCost: 22, ticks: 2,
          tip: 'Two hits of 130 on one press. Both land or neither does — do not press it while backing off.' },
        { id: 'asn_mark', name: 'DEATH MARK', icon: '💀', kind: 'execute',
          damage: 900, range: 110, cd: 0, maxCd: 18, focusCost: 72,
          tip: '900, and it finishes anything already low. Spend it on a Cairnbound. Spending it on a Husk is how runs end at wave 12.' }
      ]
    },
    {
      id: 'ranger', name: 'Ranger', icon: '🏹', color: '#f59e0b',
      hp: 950, focusMax: 100, focusRegen: 18, atk: 100, spd: 375,
      unlockAt: null,
      tagline: 'Sits on the baseline: 18 Focus a second in, 18.2 out. Always slightly behind.',
      quirk: 'Feeds the wall cat. Every run. Before anything else.',
      abilities: [
        { id: 'rng_arrow', name: 'Arrow', icon: '🏹', kind: 'projectile',
          damage: 121, range: 340, cd: 0, maxCd: 0.55, focusCost: 10,
          homing: true, speed: 700,
          tip: '121 for 10 Focus. Held down it costs 18.2 Focus a second and you regen 18 — you are on the line, and every other button is a loan.' },
        { id: 'rng_rain', name: 'Rain of Arrows', icon: '🌧️', kind: 'aoe',
          damage: 90, range: 240, cd: 0, maxCd: 6, focusCost: 42, ticks: 3,
          tip: 'Three passes of 90 over the same ground. It rewards herding, not aiming.' },
        { id: 'rng_barb', name: 'Barbed Shot', icon: '🪝', kind: 'projectile',
          damage: 240, range: 320, cd: 0, maxCd: 2.4, focusCost: 20,
          speed: 800, slow: { amount: 0.35, duration: 2 },
          tip: '240 and 35% slower for 2s. Put it in whatever is about to reach you, not whatever is lowest.' },
        { id: 'rng_snipe', name: 'SNIPER', icon: '🎯', kind: 'projectile',
          damage: 820, range: 520, cd: 0, maxCd: 18, focusCost: 68,
          pierce: true, speed: 1600,
          tip: '820 through every body in a 520px line. Wait until the Cairnbound is stacked behind the Husks.' }
      ]
    },
    {
      id: 'veilcaller', name: 'Veilcaller', icon: '🕯️', color: '#f472b6',
      hp: 800, focusMax: 70, focusRegen: 15, atk: 100, spd: 355,
      unlockAt: { wave: 12 },
      tagline: 'Lowest regen, smallest pool. Built to be in debt and to schedule it.',
      quirk: 'Talks to the Veil the way you would talk to a landlord.',
      abilities: [
        { id: 'vlc_thread', name: 'Thread Pull', icon: '🧵', kind: 'projectile',
          damage: 168, range: 320, cd: 0, maxCd: 0.75, focusCost: 14,
          homing: true, speed: 640,
          tip: '168 for 14 Focus. Held down it costs 18.7 a second and you make 15. You will cast this with 3 Focus in the pool. That is the hero.' },
        { id: 'vlc_toll', name: 'Toll the Hollow', icon: '🔔', kind: 'aoe',
          damage: 110, range: 180, cd: 0, maxCd: 6, focusCost: 34,
          ticks: 3, delay: 0.25,
          tip: 'Three tolls of 110 on one spot after a 0.25s pause. Plant it where they are going, then walk out of it.' },
        { id: 'vlc_quiet', name: 'Quiet Hands', icon: '🤲', kind: 'aoe',
          damage: 0, range: 0, cd: 0, maxCd: 14, focusCost: 10,
          buff: { stat: 'focusRegen', amount: 15, duration: 4 }, heal: 90,
          tip: '+15 Focus regen for 4s and 90 healed, for 10 Focus. It is a settle window you can afford to take.' },
        { id: 'vlc_settle', name: 'FULL SETTLE', icon: '🌑', kind: 'aoe',
          damage: 640, range: 230, cd: 0, maxCd: 16, focusCost: 54,
          delay: 0.8, slow: { amount: 0.55, duration: 3 },
          tip: '0.8s of nothing, then 640 and 55% slower for 3s. Keep your hands still another 0.7s after it lands and the Veil starts bleeding.' }
      ]
    }
  ];

  /* ==========================================================================
     PACTS — 32, tiers 1-3
     ------------------------------------------------------------------------
     THE BINDING RULE (DESIGN.md Part 3): no Pact grants positive DPS at zero
     Veil upkeep. validatePacts() below enforces it and is called at boot.
     Zero-upkeep Pacts are defence, sustain, mote logistics and Veil plumbing
     ONLY. This is the rule that stops "buy Attack Boost forever" reappearing.

     Costs follow the pressure curve: T1 60-120 motes, T2 165-250, T3 340-470.
     Chains are by synergy, not by a requires field — the texts point at each
     other so a player can read the build off the draft screen.
     ======================================================================== */
  var PACTS = [
    /* ---- TIER 1 : upkeep-bearing (damage) ---- */
    { id: 't1_keen_edge', name: 'Keen Edge', icon: '🔪', tier: 1, cost: 70, upkeep: 2,
      ops: { meleeDamageMult: 1.18 },
      text: 'Melee damage ×1.18.',
      flavor: 'Ground on a stone nobody quarried. The edge holds. The hand goes numb.' },

    { id: 't1_true_shot', name: 'True Shot', icon: '🎯', tier: 1, cost: 70, upkeep: 2,
      ops: { projDamageMult: 1.18 },
      text: 'Projectile damage ×1.18.',
      flavor: 'The arrow arrives before you loose it. You get used to the order being wrong.' },

    { id: 't1_wide_burn', name: 'Wide Burn', icon: '🔥', tier: 1, cost: 75, upkeep: 2,
      ops: { aoeDamageMult: 1.20 },
      text: 'Area damage ×1.20.',
      flavor: 'It takes the whole room, and then asks for the whole room back.' },

    { id: 't1_quicken', name: 'Quicken', icon: '⏱️', tier: 1, cost: 90, upkeep: 3,
      ops: { cooldownMult: 0.90 },
      text: 'All cooldowns ×0.90.',
      flavor: 'Your hands come back before the rest of you does.' },

    { id: 't1_deeper_well', name: 'Deeper Well', icon: '🕳️', tier: 1, cost: 65, upkeep: 2,
      ops: { focusMaxAdd: 25 },
      text: 'Focus pool +25.',
      flavor: 'The well is deeper. Nobody said it was fuller.' },

    { id: 't1_second_breath', name: 'Second Breath', icon: '🌬️', tier: 1, cost: 95, upkeep: 4,
      ops: { focusRegenAdd: 2 },
      text: 'Focus regen +2/s.',
      flavor: 'A breath you did not take, handed back with interest.' },

    { id: 't1_splinter', name: 'Splinter', icon: '🪵', tier: 1, cost: 80, upkeep: 2,
      ops: { pierceCount: 1 },
      text: 'Projectiles pass through 1 extra body.',
      flavor: 'One shaft, two holes. The second one is not yours.' },

    { id: 't1_hooked_barb', name: 'Hooked Barb', icon: '⛓️', tier: 1, cost: 85, upkeep: 3,
      ops: { chainCount: 1 },
      text: 'Hits chain to 1 extra nearby enemy.',
      flavor: 'It leaves something behind in the first body so it can find the second.' },

    /* ---- TIER 1 : zero upkeep (defence / logistics) ---- */
    { id: 't1_thick_hide', name: 'Thick Hide', icon: '🧱', tier: 1, cost: 60, upkeep: 0,
      ops: { hpMaxAdd: 180 },
      text: 'Max HP +180.',
      flavor: 'Skin like a wall somebody gave up on halfway.' },

    { id: 't1_light_foot', name: 'Light Foot', icon: '👣', tier: 1, cost: 70, upkeep: 0,
      ops: { moveSpeedMult: 1.10 },
      text: 'Move speed ×1.10.',
      flavor: 'The stones stop reporting you.' },

    { id: 't1_long_lantern', name: 'Long Lantern', icon: '🏮', tier: 1, cost: 60, upkeep: 0,
      ops: { moteLifeAdd: 2 },
      text: 'Motes last 8s instead of 6s.',
      flavor: 'The wick was cut long on purpose. Somebody knew you would be slow.' },

    { id: 't1_beckon', name: 'Beckon', icon: '🧲', tier: 1, cost: 75, upkeep: 0,
      ops: { moteMagnetRadius: 70 },
      text: 'Motes within 70px come to you.',
      flavor: 'They come to the hand now. You still have to bring the hand.' },

    { id: 't1_short_memory', name: 'Short Memory', icon: '🌫️', tier: 1, cost: 110, upkeep: 0,
      ops: { settleWindowAdd: -0.45 },
      text: 'Veil starts bleeding 1.05s after your last cast, not 1.5s.',
      flavor: 'You learn to stop breathing before the Veil notices you started.' },

    { id: 't1_ledger_grace', name: "Ledger's Grace", icon: '📜', tier: 1, cost: 85, upkeep: 0,
      ops: { parAdd: 2 },
      text: 'Every wave par clock +2s.',
      flavor: 'Two seconds, entered in a hand that is not yours.' },

    /* ---- TIER 2 : upkeep-bearing ---- */
    { id: 't2_sever', name: 'Sever', icon: '🗡️', tier: 2, cost: 190, upkeep: 5,
      ops: { meleeDamageMult: 1.35 },
      text: 'Melee damage ×1.35.',
      flavor: 'Keen Edge taught the blade the trick. This one taught it the habit.' },

    { id: 't2_ranging_eye', name: 'Ranging Eye', icon: '👁️', tier: 2, cost: 190, upkeep: 5,
      ops: { projDamageMult: 1.35 },
      text: 'Projectile damage ×1.35.',
      flavor: 'It sights down the shaft from the far end. Stack it under Splinter.' },

    { id: 't2_bloom', name: 'Bloom', icon: '💥', tier: 2, cost: 210, upkeep: 6,
      ops: { aoeDamageMult: 1.30, aoeRadiusMult: 1.25 },
      text: 'Area damage ×1.30, area radius ×1.25.',
      flavor: 'Wide Burn wanted the room. This one wants the street.' },

    { id: 't2_hastened', name: 'Hastened', icon: '⚡', tier: 2, cost: 230, upkeep: 7,
      ops: { cooldownMult: 0.82 },
      text: 'All cooldowns ×0.82.',
      flavor: 'Faster hands spend faster. The Veil is fine with that.' },

    { id: 't2_hollow_lung', name: 'Hollow Lung', icon: '🫁', tier: 2, cost: 240, upkeep: 8,
      ops: { focusRegenAdd: 4 },
      text: 'Focus regen +4/s.',
      flavor: 'Something breathes for you now. It charges by the hour.' },

    { id: 't2_glass_edge', name: 'Glass Edge', icon: '💎', tier: 2, cost: 200, upkeep: 6,
      ops: { critChanceAdd: 0.18, critMult: 1.9 },
      text: 'Crit chance +18%. Crits deal ×1.9.',
      flavor: 'It breaks about one press in five, and takes something with it.' },

    { id: 't2_cheap_debt', name: 'Cheap Debt', icon: '🪙', tier: 2, cost: 250, upkeep: 6,
      ops: { overdrawRateMult: 0.80 },
      text: 'Overdraw costs 0.64 Veil per Focus instead of 0.80.',
      flavor: 'Better terms on the loan. The loan is still the problem.' },

    { id: 't2_iron_answer', name: 'Iron Answer', icon: '🌵', tier: 2, cost: 185, upkeep: 4,
      ops: { thornsPct: 0.25 },
      text: 'Attackers take 25% of the damage they deal you.',
      flavor: 'They keep coming. It keeps costing them. Neither party learns.' },

    /* ---- TIER 2 : zero upkeep ---- */
    { id: 't2_leech', name: 'Leech', icon: '🩸', tier: 2, cost: 175, upkeep: 0,
      ops: { lifestealPct: 0.06 },
      text: 'Heal 6% of damage dealt.',
      flavor: 'It takes nothing from the Veil. It takes it from them.' },

    { id: 't2_wardens_rest', name: "Warden's Rest", icon: '🛏️', tier: 2, cost: 165, upkeep: 0,
      ops: { hpRestoreMultBetweenWaves: 2.0 },
      text: 'Recover 50% of max HP between waves instead of 25%.',
      flavor: 'Somebody sets out water between waves. Nobody has seen them do it.' },

    { id: 't2_one_forgiveness', name: 'One Forgiveness', icon: '🕊️', tier: 2, cost: 220, upkeep: 0,
      ops: { brinkGuard: 1 },
      text: 'Your first breach this run spawns no wraith.',
      flavor: 'Once. Written down, and initialled, and once.' },

    { id: 't2_swift_tide', name: 'Swift Tide', icon: '🌊', tier: 2, cost: 200, upkeep: 0,
      ops: { veilDecayMult: 1.5 },
      text: 'Veil bleeds 6/s once settled, instead of 4/s.',
      flavor: 'The tide goes out faster. It comes in at the same hour.' },

    /* ---- TIER 3 ---- */
    { id: 't3_unmade_hand', name: 'The Unmade Hand', icon: '✋', tier: 3, cost: 380, upkeep: 12,
      ops: { damageMult: 1.5 },
      text: 'All damage ×1.50.',
      flavor: 'It does not sharpen the weapon. It sharpens the intent behind it.' },

    { id: 't3_wide_dark', name: 'The Wide Dark', icon: '🌑', tier: 3, cost: 420, upkeep: 14,
      ops: { aoeDamageMult: 1.5, aoeRadiusMult: 1.4, chainCount: 1 },
      text: 'Area damage ×1.50, area radius ×1.40, hits chain to 1 extra enemy.',
      flavor: 'The end of the Wide Burn line. Bring Bloom or do not bother.' },

    { id: 't3_gutter_kings_price', name: "Gutter King's Price", icon: '👑', tier: 3, cost: 470, upkeep: 22,
      ops: { damageMult: 1.9, moveSpeedMult: 0.88 },
      text: 'All damage ×1.90. Move speed ×0.88.',
      flavor: 'The best rate anyone offers, from the last person you should take it from.' },

    { id: 't3_wraithbane', name: 'Wraithbane', icon: '⚱️', tier: 3, cost: 340, upkeep: 6,
      ops: { wraithDamageMult: 2.2, executeThresholdAdd: 0.10 },
      text: 'Damage to Veilwraiths ×2.20. Execute threshold +10%.',
      flavor: 'Names the thing that came through, which is most of the work.' },

    { id: 't3_open_channel', name: 'Open Channel', icon: '🌀', tier: 3, cost: 450, upkeep: 15,
      ops: { focusRegenAdd: 7, focusMaxAdd: 40 },
      text: 'Focus regen +7/s. Focus pool +40.',
      flavor: 'Deeper Well, then Hollow Lung, then this, and the floor to pay for all three.' },

    { id: 't3_glass_cathedral', name: 'Glass Cathedral', icon: '⛪', tier: 3, cost: 460, upkeep: 0,
      ops: { hpMaxAdd: 600, veilDecayMult: 1.8, moveSpeedMult: 1.12 },
      text: 'Max HP +600. Veil bleeds 7.2/s once settled. Move speed ×1.12.',
      flavor: 'Costs a fortune and adds not one point of damage. Wins runs anyway.' }
  ];

  /* ==========================================================================
     ENEMY ARCHETYPES — 12, one per shape in the enum, 3 named bosses
     ------------------------------------------------------------------------
     DESIGN.md Part 1 second axis: BRUTES carry ~70% of the wave HP pool (they
     move the par clock), STALKERS carry ~70% of the incoming damage rate (they
     move the HP clock). The waveTable weights below are tuned to land both at
     69-71% by wave 10. `role` is an extra field for the harness and the UI
     bestiary; sim may ignore it.
     ======================================================================== */
  var ENEMY_TYPES = [
    /* --- minions --- */
    { id: 'husk', name: 'Husk', shape: 'husk', color: '#94a3b8', role: 'minion',
      size: 15, hp: 70, atk: 6, spd: 100, moteValue: 1, boss: false, telegraph: 0,
      behaviors: [{ type: 'chaser' }],
      text: 'Walks at you. Nothing else. Most of the wave, most of the time.' },

    { id: 'wisp', name: 'Emberwisp', shape: 'wisp', color: '#fbbf24', role: 'minion',
      size: 11, hp: 40, atk: 5, spd: 142, moteValue: 1, boss: false, telegraph: 0,
      behaviors: [{ type: 'chaser' }],
      text: 'Forty HP at 142 speed. Harmless alone, and never alone.' },

    /* --- brutes: ~70% of wave HP, low threat --- */
    { id: 'cairnbound', name: 'Cairnbound', shape: 'block', color: '#78716c', role: 'brute',
      size: 34, hp: 420, atk: 9, spd: 60, moteValue: 4, boss: false, telegraph: 0,
      behaviors: [{ type: 'chaser' }],
      text: '420 HP at speed 60. It cannot catch you and it does not need to — it is the par clock walking.' },

    { id: 'slagbrute', name: 'Slagbrute', shape: 'hex', color: '#ea580c', role: 'brute',
      size: 29, hp: 340, atk: 8, spd: 72, moteValue: 4, boss: false, telegraph: 0.5,
      behaviors: [{ type: 'chaser' }, { type: 'bomber', radius: 95, damage: 34 }],
      text: 'Bursts for 34 across 95px when it dies. Killing it in a crowd kills the crowd. Killing it next to you kills you.' },

    { id: 'motherglass', name: 'Motherglass', shape: 'diamond', color: '#2dd4bf', role: 'brute',
      size: 26, hp: 200, atk: 8, spd: 84, moteValue: 3, boss: false, telegraph: 0,
      behaviors: [{ type: 'chaser' }, { type: 'splitter', into: 'wisp', count: 3 }],
      text: 'Breaks into three Emberwisps. The HP pool does not go down when it dies — it spreads out.' },

    /* --- stalkers: ~70% of incoming damage rate --- */
    { id: 'nettle', name: 'Nettle', shape: 'shard', color: '#f43f5e', role: 'stalker',
      size: 13, hp: 90, atk: 30, spd: 132, moteValue: 2, boss: false, telegraph: 0.25,
      behaviors: [{ type: 'orbiter', radius: 120, strikeCd: 1.6 }],
      text: 'Circles at 120px and darts in every 1.6s for 30. Ninety HP. Kill it first; it will not be there later.' },

    { id: 'lancer', name: 'Lancer', shape: 'spike', color: '#fb7185', role: 'stalker',
      size: 18, hp: 130, atk: 38, spd: 88, moteValue: 3, boss: false, telegraph: 0.7,
      behaviors: [{ type: 'charger', windup: 0.7, dashSpeed: 470, dashCd: 3.2 }],
      text: '0.7s of windup, then 470 speed and 38 damage. The windup is the whole fight — step sideways, not back.' },

    { id: 'ashcaster', name: 'Ashcaster', shape: 'star', color: '#c084fc', role: 'stalker',
      size: 16, hp: 100, atk: 26, spd: 76, moteValue: 3, boss: false, telegraph: 0.4,
      behaviors: [{ type: 'ranged', range: 270, attackCd: 2.0, projSpeed: 250 }],
      text: 'Holds 270px and lobs for 26 every 2s. It never closes, so it never stops.' },

    /* --- support --- */
    { id: 'warden', name: 'Hollow Warden', shape: 'ring', color: '#38bdf8', role: 'support',
      size: 22, hp: 240, atk: 6, spd: 66, moteValue: 6, boss: false, telegraph: 0,
      behaviors: [{ type: 'shielder', radius: 150, reduction: 0.35 }],
      text: 'Everything within 150px takes 35% less. It is worth six motes and it is worth killing for free.' },

    /* --- bosses: wave 5 / 10 / 15 rotation --- */
    { id: 'toll_collector', name: 'The Toll Collector', shape: 'crown', color: '#fbbf24',
      role: 'boss', size: 50, hp: 2600, atk: 34, spd: 80, moteValue: 45,
      boss: true, telegraph: 1.0,
      behaviors: [
        { type: 'charger', windup: 1.0, dashSpeed: 520, dashCd: 4.5 },
        { type: 'summoner', spawns: 'husk', count: 3, period: 7 }
      ],
      text: 'Charges on a 4.5s cycle and sets down three Husks every 7s. The Husks are the toll. It is only collecting.' },

    { id: 'lamplighter', name: 'The Lamplighter', shape: 'orb', color: '#38bdf8',
      role: 'boss', size: 56, hp: 4200, atk: 40, spd: 62, moteValue: 70,
      boss: true, telegraph: 0.8,
      behaviors: [
        { type: 'ranged', range: 320, attackCd: 1.6, projSpeed: 300 },
        { type: 'shielder', radius: 210, reduction: 0.45 }
      ],
      text: 'Shields itself and everything within 210px by 45%, then shoots you from 320. Break the ring or leave the arena.' },

    { id: 'reckoner', name: 'The Reckoner', shape: 'core', color: '#f43f5e',
      role: 'boss', size: 46, hp: 6800, atk: 52, spd: 108, moteValue: 100,
      boss: true, telegraph: 0.6,
      behaviors: [
        { type: 'orbiter', radius: 150, strikeCd: 1.2 },
        { type: 'bomber', radius: 160, damage: 90 }
      ],
      text: 'Speed 108, and it climbs with your Veil — 216 at Veil 60, 270 at Veil 90. It detonates for 90 across 160px when it dies.' }
  ];

  /* Boss rotation on waves 5 / 10 / 15 / 20 / ... */
  var BOSS_ROTATION = ['toll_collector', 'lamplighter', 'reckoner'];

  function bossForWave(w) {
    w = Math.max(1, Math.floor(w || 1));
    if (w % 5 !== 0) return null;
    return BOSS_ROTATION[((w / 5) - 1) % BOSS_ROTATION.length];
  }

  /* ==========================================================================
     waveTable(w) -> [{id, weight}]   (PURE)
     ------------------------------------------------------------------------
     Progressive introduction. Waves 1-4 are deliberately simple (DESIGN Part
     4: minute-5 pressure is spatial, not economic). Weights then ramp so the
     brute share of HP and the stalker share of threat both converge on ~70%.

     Verified at wave 10 (N=26): brute HP share 69.6%, stalker threat share
     69.6%. Boss entries carry weight 0 and are spawned exactly once — see the
     header note and bossForWave().
     ======================================================================== */
  function waveTable(w) {
    w = Math.max(1, Math.floor(w || 1));

    // 0 before `from`, rising linearly to 1 at `full`.
    function ramp(from, full) {
      if (w < from) return 0;
      var span = Math.max(1, full - from + 1);
      return Math.min(1, (w - from + 1) / span);
    }

    var t = [];
    function add(id, gate, base, growth, rampFrom, rampFull) {
      if (w < gate) return;
      var weight = Math.round(base + growth * ramp(rampFrom, rampFull));
      if (weight > 0) t.push({ id: id, weight: weight });
    }

    var boss = bossForWave(w);
    if (boss) t.push({ id: boss, weight: 0 });

    add('husk',        1,  34, -17, 3, 12);   // 34 -> 17, always the floor
    add('wisp',        2,  10,   4, 2, 12);
    add('cairnbound',  3,   9,   8, 3, 12);   // first brute
    add('lancer',      4,   5,   4, 4, 13);   // first telegraph
    add('nettle',      6,   7,   6, 6, 15);
    add('slagbrute',   7,   6,   5, 7, 16);
    add('ashcaster',   8,   5,   3, 8, 16);
    add('motherglass', 9,   5,   3, 9, 17);
    add('warden',     11,   2,   2, 11, 20);

    return t;
  }

  /* ==========================================================================
     COVENANT — 18 nodes, five branches, max 3 deep
     ------------------------------------------------------------------------
     `upkeep` here is STARTING Veil floor, paid on every future run forever.
     "Clean" nodes (clean:true) buy the same effect with no floor at ~3x the
     echo cost — the meta-layer escape valve DESIGN Part 4 asks for, and the
     reason the hour-10 decision is the 10-second decision at 3,000x timescale.
     `requires` is always a single-element array so there is no AND/OR
     ambiguity for sim.
     ======================================================================== */
  var COVENANT = [
    /* --- Branch: The Edge --- */
    { id: 'cov_whetstone', name: 'Whetstone', icon: '🪨', cost: 40, clean: false,
      upkeep: 2, requires: [], ops: { damageMult: 1.06 },
      text: 'All damage ×1.06.',
      flavor: 'A stone on the sill by the door. You use it without deciding to.' },

    { id: 'cov_grindstone', name: 'Grindstone', icon: '⚙️', cost: 100, clean: false,
      upkeep: 3, requires: ['cov_whetstone'], ops: { damageMult: 1.10 },
      text: 'All damage ×1.10.',
      flavor: 'Bigger wheel, deeper bite, and a smell in the room afterwards.' },

    { id: 'cov_quiet_steel', name: 'Quiet Steel', icon: '🤫', cost: 320, clean: true,
      upkeep: 0, requires: ['cov_whetstone'], ops: { damageMult: 1.12 },
      text: 'All damage ×1.12. No starting Veil floor.',
      flavor: 'Paid in full, in advance, in echoes. The Veil has no claim on it.' },

    /* --- Branch: The Well --- */
    { id: 'cov_deep_well', name: 'Deep Well', icon: '🕳️', cost: 45, clean: false,
      upkeep: 2, requires: [], ops: { focusMaxAdd: 20 },
      text: 'Focus pool +20.',
      flavor: 'Dug one season, drawn from every season after.' },

    { id: 'cov_slow_tide', name: 'Slow Tide', icon: '🌊', cost: 120, clean: false,
      upkeep: 3, requires: ['cov_deep_well'], ops: { focusRegenAdd: 2 },
      text: 'Focus regen +2/s.',
      flavor: 'It fills while you sleep, and it bills while you sleep.' },

    { id: 'cov_open_throat', name: 'Open Throat', icon: '🌀', cost: 340, clean: false,
      upkeep: 6, requires: ['cov_slow_tide'], ops: { focusRegenAdd: 3, focusMaxAdd: 25 },
      text: 'Focus regen +3/s. Focus pool +25.',
      flavor: 'Six of your eighty-five headroom, before you have cast anything.' },

    { id: 'cov_still_water', name: 'Still Water', icon: '💧', cost: 360, clean: true,
      upkeep: 0, requires: ['cov_deep_well'], ops: { focusRegenAdd: 2.5 },
      text: 'Focus regen +2.5/s. No starting Veil floor.',
      flavor: 'Nothing moves on the surface. That is the expensive part.' },

    /* --- Branch: The Body --- */
    { id: 'cov_thick_bones', name: 'Thick Bones', icon: '🦴', cost: 40, clean: false,
      upkeep: 0, requires: [], ops: { hpMaxAdd: 120 },
      text: 'Max HP +120.',
      flavor: 'Set badly once, healed heavier. The Veil never asked for it.' },

    { id: 'cov_setbone', name: 'Setbone', icon: '🩹', cost: 130, clean: false,
      upkeep: 0, requires: ['cov_thick_bones'],
      ops: { hpMaxAdd: 220, hpRestoreMultBetweenWaves: 1.4 },
      text: 'Max HP +220. Recover 35% of max HP between waves instead of 25%.',
      flavor: 'Someone in the Ninth Ward sets bones for free and asks no names.' },

    { id: 'cov_iron_answer', name: 'Iron Answer', icon: '🌵', cost: 150, clean: false,
      upkeep: 3, requires: ['cov_thick_bones'], ops: { thornsPct: 0.20 },
      text: 'Attackers take 20% of the damage they deal you.',
      flavor: 'Reflected damage is still damage. The Veil counts it either way.' },

    /* --- Branch: The Ledger --- */
    { id: 'cov_short_memory', name: 'Short Memory', icon: '🌫️', cost: 60, clean: false,
      upkeep: 0, requires: [], ops: { settleWindowAdd: -0.3 },
      text: 'Veil starts bleeding 1.2s after your last cast, not 1.5s.',
      flavor: 'Three tenths of a second, bought once, kept for every run you ever make.' },

    { id: 'cov_ebb', name: 'Ebb', icon: '🌒', cost: 160, clean: false,
      upkeep: 0, requires: ['cov_short_memory'], ops: { veilDecayMult: 1.35 },
      text: 'Veil bleeds 5.4/s once settled, instead of 4/s.',
      flavor: 'It goes out further each night and comes back on the same hour.' },

    { id: 'cov_one_forgiveness', name: 'One Forgiveness', icon: '🕊️', cost: 320, clean: false,
      upkeep: 0, requires: ['cov_ebb'], ops: { brinkGuard: 1 },
      text: 'Your first breach of every run spawns no wraith.',
      flavor: 'Not mercy. A clerical allowance, renewed annually.' },

    { id: 'cov_cheap_debt', name: 'Cheap Debt', icon: '🪙', cost: 180, clean: false,
      upkeep: 4, requires: ['cov_short_memory'], ops: { overdrawRateMult: 0.88 },
      text: 'Overdraw costs 0.70 Veil per Focus instead of 0.80.',
      flavor: 'Four points of floor, forever, for a tenth off the rate. Do that arithmetic twice.' },

    /* --- Branch: The Take --- */
    { id: 'cov_long_wick', name: 'Long Wick', icon: '🏮', cost: 50, clean: false,
      upkeep: 0, requires: [], ops: { moteLifeAdd: 1.5, moteMagnetRadius: 60 },
      text: 'Motes last 7.5s instead of 6s, and drift in from 60px.',
      flavor: 'Someone trims the wicks on Lampwick Row. Nobody has met them.' },

    { id: 'cov_grace_period', name: 'Grace Period', icon: '📜', cost: 140, clean: false,
      upkeep: 0, requires: ['cov_long_wick'], ops: { parAdd: 2 },
      text: 'Every wave par clock +2s.',
      flavor: 'Two seconds a wave. Over twenty waves that is a whole extra fight.' },

    { id: 'cov_quick_hands', name: 'Quick Hands', icon: '⏱️', cost: 150, clean: false,
      upkeep: 3, requires: ['cov_long_wick'], ops: { cooldownMult: 0.94 },
      text: 'All cooldowns ×0.94.',
      flavor: 'Practice, mostly. Mostly practice.' },

    { id: 'cov_still_hands', name: 'Still Hands', icon: '🫱', cost: 380, clean: true,
      upkeep: 0, requires: ['cov_quick_hands'], ops: { cooldownMult: 0.90 },
      text: 'All cooldowns ×0.90. No starting Veil floor.',
      flavor: 'Faster than Quick Hands and quieter about it. That silence is the 380.' }
  ];

  /* ==========================================================================
     ASCENSIONS — A1..A8
     ------------------------------------------------------------------------
     Each entry lists ONLY its own new rule. Sim applies levels 1..n
     cumulatively. A3 / A5 / A7 are fixed by DESIGN.md Part 4.
     Every number in `text` is derived from the base constants: mote life 6s,
     between-wave restore 25%, T_par(10) = 28s, settle window 1.5s.
     ======================================================================== */
  var ASCENSIONS = [
    { level: 1, name: 'Thin Ground', mods: { enemyCountAdd: 2 },
      text: 'Every wave brings two more bodies.' },

    { level: 2, name: 'Long Stride', mods: { enemySpeedMult: 1.08 },
      text: 'Everything moves 8% faster before Veil is added on top.' },

    { level: 3, name: 'Short Wick', mods: { moteLifeMult: 0.5 },
      text: 'Motes lie on the ground for 3 seconds, not 6.' },

    { level: 4, name: 'Hard Meat', mods: { enemyHpMult: 1.20 },
      text: 'Every enemy carries 20% more HP. The par clock does not move.' },

    { level: 5, name: 'Old Debt', mods: { veilFloorAdd: 10 },
      text: 'Every run starts at Veil floor 10. Headroom 75, not 85.' },

    { level: 6, name: 'Sparing Hands', mods: { hpRestoreMult: 0.5 },
      text: 'Between waves you recover 12.5% of max HP, not 25%.' },

    { level: 7, name: 'The Clock Moved', mods: { parMult: 0.8 },
      text: 'Every par clock is cut by a fifth. Wave 10 par: 22.4s, not 28.' },

    { level: 8, name: 'The Ninth Wraith', mods: { wraithHpMult: 2.0, settleWindowMult: 1.5 },
      text: 'Wraiths carry double HP, and the Veil waits 2.25s before it forgets you.' }
  ];

  /* ==========================================================================
     RIFTS — 4 run modifiers, one unlockable
     ======================================================================== */
  var RIFTS = [
    { id: 'rift_hollow', name: 'The Hollow Deep', unlockAt: null, mods: {},
      text: 'No terms. The Veil behaves exactly as written.' },

    { id: 'rift_press', name: 'The Pressing Hour', unlockAt: null,
      mods: { parMult: 0.85, moteLifeMult: 1.5 },
      text: 'Par clocks cut by 15%. Motes keep for 9 seconds instead of 6.' },

    { id: 'rift_crowd', name: 'The Thin Crowd', unlockAt: null,
      mods: { enemyCountAdd: 4, enemyHpMult: 0.7, enemySpeedMult: 1.05 },
      text: 'Four more bodies a wave, each with 30% less HP and 5% more speed.' },

    { id: 'rift_famine', name: 'The Long Famine', unlockAt: { wave: 15 },
      mods: { hpRestoreMult: 0.4, veilFloorAdd: 6, moteLifeMult: 2, enemyHpMult: 0.9 },
      text: 'Start at Veil floor 6. Recover 10% of max HP between waves, not 25%. Motes keep for 12 seconds; enemies carry 10% less HP.' }
  ];

  /* ==========================================================================
     STRINGS — all player-facing copy
     ------------------------------------------------------------------------
     VOICE GUIDE (four rules, enough to write in):
     1. State the fact, then the consequence. "Veil floor 41. Headroom 44."
        Never "Nice run!". Congratulation is banned outright — the player can
        see the wave number.
     2. Every abstraction gets a physical anchor. Not "cooldowns are shorter"
        but "your hands come back before the rest of you does."
     3. Warmth comes from the world, never from praising the player. Lamps,
        weather, a cat on a wall, somebody who sets bones for free. Never an
        adjective about how you played.
     4. Mobile-short. One or two lines at 390px. An emoji at the head of a line
        is a category icon, not a reaction.

     PLACEHOLDERS UI must substitute: {wave} {floor} {headroom} {breaches}
     {kills} {motes} {echoes} {time} {n}. Missing keys should render as the
     literal brace text rather than crash.

     FACT-CHECK LOG — every number quoted below is sourced from this file or
     from DESIGN.md's binding constants:
       0.8 Veil per Focus (= "4 Veil per 5 Focus")  DESIGN 1
       decay 4/s after 1.5s settle                  DESIGN 1
       tiers 25/50/75/90 -> x2/x4/x8/x16            VEIL_TIERS above
       contact x(1+V/50): V=50 -> x2, V=96 -> x2.92 DESIGN 1
       brink at 100, resets to 60                   DESIGN 1
       wraith speed 1.05x player base               DESIGN 1
       over par: +4 Veil/s, +0.1 floor/s            DESIGN 1
       headroom = 85 - floor                        DESIGN 3
       restore +25% max HP between waves            DESIGN 7
       motes expire 6s                              DESIGN 3
       T_par(w) = 20 + 0.8w -> par(10) = 28s        DESIGN 7
       N(w) = 6 + 2w -> N(25)=56, N(50)=106, N(100)=206
     ======================================================================== */
  var STRINGS = {

    title: 'VEIL LEGENDS',
    subtitle: 'ENTER THE VEIL',

    /* Rotating under the title. Each one is the thesis from a different angle. */
    taglines: [
      'Every point of damage is bought. The Veil is what you buy it with.',
      'Cast inside your Focus and pay nothing. Cast past it and pay for the rest of the wave.',
      'Playing safe is a policy. It is not a surviving one.',
      'The Veil gives, and the Veil keeps a record.',
      'There is no attack button. There is only spending.'
    ],

    menu: {
      newRun: 'NEW RUN',
      continueRun: 'CONTINUE',
      covenant: 'COVENANT',
      settings: 'SETTINGS',
      help: 'HOW IT WORKS',
      noSave: 'No run in progress.',
      continueHint: 'Wave {wave} — {hero}. Resumes at the start of the wave.',
      echoes: 'Echoes: {echoes}',
      bestWave: 'Deepest run: wave {wave}',
      firstTime: 'Nothing banked yet. The first run is for finding the floor.'
    },

    heroSelect: {
      title: 'CHOOSE',
      sub: 'Focus regen and pool size are the whole difference. Read them.',
      focusLine: '{regen} Focus/s regen · {max} pool · {hp} HP',
      locked: 'Locked — reach wave {wave} in a single run.',
      unlockedToast: '🕯️ Veilcaller unlocked. Lowest regen in the roster, on purpose.'
    },

    riftSelect: {
      title: 'CHOOSE A CROSSING',
      sub: 'The rift sets the terms before you spend anything.',
      locked: 'Locked — reach wave {wave}.'
    },

    /* ---- HELP / TUTORIAL : the two passages that carry the most weight ---- */
    help: {
      thesis: 'Every point of damage in this game is bought with Focus. When Focus runs out you may keep casting on credit, and the Veil collects that credit in enemy speed and enemy teeth for the rest of the wave.',
      sections: [
        { h: 'FOCUS',
          p: 'Abilities cost Focus. Focus refills on its own. There is no auto-attack and nothing hits for free — if your hands are still, the wave HP bar is still.' },
        { h: 'OVERDRAW',
          p: 'Cast with less Focus than the ability costs and it fires anyway. The gap is charged to the Veil at 4 Veil per 5 Focus, and your pool drops to zero.' },
        { h: 'WHAT VEIL DOES',
          p: 'At 50 Veil everything that touches you hits twice as hard, and everything on the field is faster. Near 100, the quick ones run you down.' },
        { h: 'WHAT VEIL PAYS',
          p: 'Motes multiply with held Veil: ×2 at 25, ×4 at 50, ×8 at 75, ×16 at 90. Held Veil is the price. You are not paid for touching the number, only for staying there.' },
        { h: 'SETTLE',
          p: 'Stop casting for 1.5 seconds and Veil bleeds off at 4 a second. That pause is a real move. Most deaths are somebody who never took one.' },
        { h: 'BRINK',
          p: 'At 100 Veil the Veil breaches. A Veilwraith steps through at 1.05× your base speed, Veil drops to 60, and the wraith stays — through this wave and every wave after.' },
        { h: 'THE PAR CLOCK',
          p: 'Each wave has a par time. Every second past it adds +4 Veil and +0.1 to your run\'s permanent Veil floor. The floor never comes back down.' },
        { h: 'HEADROOM',
          p: 'Headroom is 85 minus your floor. Pacts that raise damage all raise the floor. Around wave 12 the correct answer to a Pact offer starts being no.' }
      ]
    },

    /* Gated first-run guidance. UI shows each once, on its trigger. Two lines
       max. `when` is the trigger name; sim/UI decides when it fires. */
    tutorial: [
      { id: 'tut_combat', when: 'first_combat',
        title: 'NO AUTO-ATTACK',
        body: 'Nothing swings by itself. Every point of damage is a button you press.' },
      { id: 'tut_focus', when: 'first_cast',
        title: 'FOCUS',
        body: 'Focus refills on its own. Spend inside the refill and you owe nothing.' },
      { id: 'tut_overdraw', when: 'first_overdraw',
        title: 'OVERDRAW',
        body: 'You cast past your Focus. The Veil covered the gap at 4 Veil per 5 Focus, and it wants the wave for it.' },
      { id: 'tut_tier', when: 'veil_25',
        title: 'VEIL 25 — ×2 MOTES',
        body: 'Motes now drop double. Contact damage is up half again, and it keeps climbing with the number.' },
      { id: 'tut_settle', when: 'settle_available',
        title: 'SETTLE',
        body: 'Hands still for 1.5s and Veil bleeds at 4 a second. Kiting is not stalling.' },
      { id: 'tut_par', when: 'par_visible',
        title: 'PAR',
        body: 'Past par: +4 Veil a second, and +0.1 on your Veil floor. The floor is permanent.' },
      { id: 'tut_draft', when: 'first_draft',
        title: 'PACTS',
        body: 'Anything that raises damage raises your floor. There is no free one. Declining is a build.' },
      { id: 'tut_breach', when: 'first_breach',
        title: 'BREACH',
        body: 'Veil hit 100. A wraith came through, Veil dropped to 60, and the wraith does not leave.' },
      { id: 'tut_wraith', when: 'second_breach',
        title: 'TWO WRAITHS',
        body: 'They stack and they carry between waves. Three is usually the end of a run.' },
      { id: 'tut_boss', when: 'first_boss',
        title: 'WAVE 5',
        body: 'Named waves every fifth. The par clock does not get longer for them.' }
    ],

    hud: {
      veil: 'VEIL',
      veilFloor: 'floor {floor}',
      focus: 'FOCUS',
      motes: 'MOTES',
      wave: 'WAVE {wave}',
      par: 'PAR {time}',
      overPar: 'OVER PAR +{time}',
      waveHp: 'WAVE HP',
      wraiths: 'WRAITHS {n}',
      /* Tier band labels on the Veil meter. Derived from VEIL_TIERS. */
      tierBands: [
        { min: 0,  label: 'CLEAR',     mult: '×1'  },
        { min: 25, label: 'THIN',      mult: '×2'  },
        { min: 50, label: 'DEEP',      mult: '×4'  },
        { min: 75, label: 'CLOSE',     mult: '×8'  },
        { min: 90, label: 'BREACHING', mult: '×16' }
      ]
    },

    toast: {
      overdraw: '⚠️ Overdraw — {n} Focus on credit.',
      tierUp: '🕯️ Veil {tier}. Motes {mult}.',
      tierDown: '🕯️ Veil {tier}. Motes {mult}.',
      breach: '🩸 Breach. Veil 60. One wraith on the field.',
      breachGuarded: '🕊️ Breach absorbed. No wraith. That was the only one.',
      wraith: '🩸 {name} came through.',
      parLost: '⏳ Past par. +0.1 floor a second from here.',
      waveClear: '✔ Wave {wave} cleared. {time}s under par.',
      waveClearLate: '✔ Wave {wave} cleared. {time}s over par. Floor now {floor}.',
      pactTaken: '📜 {name} bound. Veil floor {floor}.',
      pactDeclined: '📜 Declined. Floor holds at {floor}.',
      restore: '❤️ +{n} HP. {hp}/{hpMax}.',
      saved: '💾 Saved.'
    },

    pactDraft: {
      title: 'THREE OFFERS',
      sub: 'You may take none. Nothing here is free and one of them is honest about it.',
      declineLabel: 'TAKE NOTHING',
      declineHint: 'Keeps your floor where it is.',
      costLabel: '{cost} motes',
      upkeepLabel: 'Veil floor +{upkeep}, permanent this run',
      cleanLabel: 'No Veil floor',
      cantAfford: 'Short {n} motes.',
      headroomLine: 'Floor {floor} → {newFloor}. Headroom {headroom} → {newHeadroom}.',
      tierLabel: ['', 'TIER I', 'TIER II', 'TIER III']
    },

    covenant: {
      title: 'THE COVENANT',
      sub: 'Bought in echoes, paid for on every run you ever make again.',
      echoes: '{echoes} echoes',
      upkeepNote: 'Adds {upkeep} to your STARTING Veil floor. Every run. Forever.',
      cleanNote: 'Clean — costs about triple and adds no starting floor.',
      locked: 'Requires {name}.',
      owned: 'BOUND',
      cantAfford: 'Short {n} echoes.',
      respec: 'UNBIND ALL',
      respecConfirm: 'Unbind everything? Clean nodes refund half. The rest refund nothing.',
      floorLine: 'Starting Veil floor {floor}. Headroom {headroom} of 85.',
      empty: 'Nothing bound. Every run starts at floor 0 and that is worth something.'
    },

    ascension: {
      title: 'ASCENSION',
      sub: 'Each level adds a rule and keeps the ones below it.',
      current: 'Running at Ascension {n}.',
      locked: 'Locked — clear Ascension {n} first.',
      none: 'Ascension 0. Base rules.',
      levelLabel: 'A{n} · {name}'
    },

    /* ---- Cheap depth: one line per wave, cycled. Sense of place and time
           over a long run. Warmth from the world, never from the player. ---- */
    waveOmens: [
      'The lamps along Lampwick Row are lit. Nobody lit them.',
      'Something small and four-legged crosses the far edge and does not look at you.',
      'Frost on the hex stones. It is not the season for it.',
      'The noise from the Cinderworks stops all at once.',
      'A dog barks twice, a long way off, then thinks better of it.',
      'Rain that never reaches the ground.',
      'The air tastes like a coin held too long.',
      'Somebody\'s washing is still on the line above the Ninth Ward.',
      'Gulls, well inland, circling nothing.',
      'The ground is warm. It has no reason to be.',
      'Bells from the Drownwater chapel, in the wrong order.',
      'Moths at the edge of the ring, every one of them facing you.',
      'The wind stops. Everything else keeps moving.',
      'A cat sits on the wall and watches the whole thing.',
      'Smoke going down instead of up.',
      'The stones remember somebody standing exactly here.',
      'Snow that is not cold.',
      'Nothing at all. That is the part that is wrong.'
    ],

    bossIntro: {
      toll_collector: '👑 THE TOLL COLLECTOR\nIt sets down three Husks every seven seconds. Those are the toll. It is only collecting.',
      lamplighter: '🔵 THE LAMPLIGHTER\nEverything inside her ring takes 45% less. She has never had to come closer than 320.',
      reckoner: '🔴 THE RECKONER\nSpeed 108 at Veil 0, 270 at Veil 90. Take it low or do not take it.'
    },

    /* ---- Milestones at 1 / 10 / 25 / 50 / 100 ---- */
    milestones: {
      wave: {
        1:   'Wave 1 cleared. Everything after this is bought on credit.',
        10:  'Wave 10. Par is 28 seconds and the HP pool is not waiting for it.',
        25:  'Wave 25. Fifty-six bodies a wave. You are past where the maths was written for.',
        50:  'Wave 50. A hundred and six of them, sixty seconds of par.',
        100: 'Wave 100. Two hundred and six. The Veil has stopped pretending to be a resource.'
      },
      breaches: {
        1:  'First breach. It has a name now and it knows the way in.',
        3:  'Three wraiths. None of them expire and none of them are slower than you.',
        10: 'Ten breaches in one run. There is no record kept of this. There is just you and them.'
      },
      kills: {
        100:   '100 down. The stones are not going to clean themselves.',
        1000:  '1,000 down. Somewhere a wall cat has stopped flinching.',
        10000: '10,000 down. The Cinderworks has started leaving the gate open for you.'
      }
    },

    /* ---- Named wraiths, so a breach has a face. One of these is a joke. ---- */
    wraithNames: [
      'the Tallyman',
      'Widow Ash',
      'the Quiet Half',
      'Nine Fingers',
      'the Understudy',
      'Cold Marla',
      'the Second Opinion',
      'Brother Interest',
      'the Long Wick',
      'Gerald',
      'the Sixth Debt',
      'Hollow Tam',
      'the One You Left',
      'Bellwether'
    ],

    /* ==========================================================================
       DEATH — the passage that earns the run. Specific about what happened.
       Does not console. Does not mention doing well or badly.
       ======================================================================== */
    death: {
      titles: {
        brink:     'BREACHED',
        wraith:    'RUN DOWN',
        attrition: 'OUTPACED',
        contact:   'SURROUNDED',
        boss:      'COLLECTED',
        default:   'ENDED'
      },
      causes: {
        brink: [
          'You held above 90 Veil for the last stretch of it. At that height a Husk hits for very nearly three times its listed number, and there were more than three Husks.',
          'You were buying ×16 motes and paying for them with the only body you had.',
          'The breach opened under your feet on wave {wave}. Nothing on the field was faster than you when the wave started. By the end, most of it was.',
          'Veil 100 with {n} HP in hand. The arithmetic finished without you.'
        ],
        wraith: [
          '{breaches} breaches, {breaches} wraiths. Each of them moves at 1.05× your base speed and not one of them expires.',
          'Wraiths carry between waves. You brought that one in from two waves back and never found the time.',
          'You cannot kite something faster than you. There was never a lap that closed.',
          '{n} wraiths on the field. The wave was almost irrelevant by then.'
        ],
        attrition: [
          'You never went into debt. Par went unmet often enough that the floor climbed to {floor}, and headroom is 85 minus that.',
          'Veil floor {floor}. Headroom {headroom}. The wave needed more damage than {headroom} points of Veil could buy.',
          'Every second over par cost a tenth of a point of floor. You paid it in small change across {wave} waves and it came to this.',
          'Nothing killed you quickly. The par clock did it over about eleven minutes.'
        ],
        contact: [
          'Backed into the low edge of the arena on wave {wave} with three Nettles orbiting. {kills} kills.',
          'HP ran out before the wave HP did. {n} of the pool was still standing.',
          'A Lancer connected at the end of its windup. That is the one you were meant to step sideways for.'
        ],
        boss: [
          'It closed the distance on wave {wave} and there was nothing left in the pool to answer with.',
          'The named one does not get a longer par clock, and neither did you.'
        ],
        default: [
          'Wave {wave}. Floor {floor}. That is the whole account.'
        ]
      },
      /* One quiet closing line. World, not player. */
      coda: [
        'The lamps on Lampwick Row go out one at a time.',
        'The cat on the wall does not move.',
        'Somebody will sweep the stones before morning.',
        'The Cinderworks starts up again in about an hour.',
        'It rains, briefly, and stops.',
        'A gull lands where you were standing.'
      ],
      stats: {
        wave: 'Wave reached',
        floor: 'Veil floor at the end',
        headroom: 'Headroom left',
        breaches: 'Breaches',
        kills: 'Kills',
        motes: 'Motes taken',
        time: 'Time in the Veil',
        echoes: 'Echoes banked'
      },
      echoesLine: '{echoes} echoes banked. They spend in the Covenant.',
      newBest: 'Deepest run so far: wave {wave}.',
      buttons: { again: 'AGAIN', covenant: 'COVENANT', menu: 'MENU' }
    },

    pause: {
      title: 'PAUSED',
      resume: 'RESUME',
      save: 'SAVE',
      settings: 'SETTINGS',
      menu: 'MAIN MENU',
      menuConfirm: 'Leave the run? It resumes at the start of this wave.',
      state: 'Wave {wave} · Veil {veil} · floor {floor} · {motes} motes'
    },

    settings: {
      title: 'SETTINGS',
      volume: 'Volume',
      mute: 'Mute',
      screenShake: 'Screen shake',
      reducedFx: 'Reduced effects',
      reducedFxHint: 'Fewer particles and no palette warping. Use it if the arena is hard to read.',
      controls: 'Controls',
      resetSave: 'Reset save',
      resetConfirm1: 'Erase everything? Echoes, Covenant, Ascension, unlocked heroes.',
      resetConfirm2: 'Last chance. This does not come back.',
      resetDone: 'Save erased. Floor 0.',
      back: 'BACK'
    },

    controls: {
      title: 'CONTROLS',
      keyboard: 'WASD or arrows to move. 1–4 to cast. Esc to pause.',
      touch: 'Left thumb moves. Four buttons on the right cast.',
      controllerToast: '🎮 Controller connected. Left stick moves, A/B/X/Y cast 1–4, Start pauses.',
      controllerBindings: [
        'Left stick — move',
        'A / B / X / Y — abilities 1 / 2 / 3 / 4',
        'Start — pause',
        'D-pad or left stick — menu navigation, A to confirm',
        'LB / RB — cycle offers in the Pact draft'
      ]
    },

    /* Short, factual, no praise. Used on the between-wave card. */
    interlude: {
      title: 'WAVE {wave} CLEARED',
      restore: 'Recovered {n} HP.',
      floorHeld: 'Veil floor {floor}. Headroom {headroom}.',
      floorRose: 'Veil floor {floor}, up {n} from the overrun. Headroom {headroom}.',
      next: 'Wave {wave} — {count} bodies, {par}s par.'
    }
  };

  /* ==========================================================================
     validatePacts() — THE ANTI-RUNAWAY GATE
     ------------------------------------------------------------------------
     Sim calls this at boot and console.errors anything returned. Returns [] on
     a clean file. Implements the CONTRACT list, plus six extra ops this file
     also treats as damage output (critMult, aoeRadiusMult, thornsPct,
     wraithDamageMult, executeThresholdAdd, overdrawRateMult). Being stricter
     than the contract is safe: data that passes here passes there too.
     ======================================================================== */
  function isDamageOp(key, val) {
    switch (key) {
      /* Contract list */
      case 'damageMult':
      case 'meleeDamageMult':
      case 'projDamageMult':
      case 'aoeDamageMult':
      case 'wraithDamageMult':
      case 'critMult':
      case 'aoeRadiusMult':      return val > 1;
      case 'critChanceAdd':
      case 'chainCount':
      case 'pierceCount':
      case 'focusRegenAdd':
      case 'focusMaxAdd':
      case 'thornsPct':
      case 'executeThresholdAdd': return val > 0;
      case 'cooldownMult':
      case 'overdrawRateMult':    return val < 1;
      default: return false;
    }
  }

  function damageOpsOf(ops) {
    var found = [];
    for (var k in ops) {
      if (!Object.prototype.hasOwnProperty.call(ops, k)) continue;
      if (isDamageOp(k, ops[k])) found.push(k + '=' + ops[k]);
    }
    return found;
  }

  function validatePacts() {
    var out = [];
    var seen = {};
    for (var i = 0; i < PACTS.length; i++) {
      var p = PACTS[i];
      if (seen[p.id]) out.push('duplicate pact id: ' + p.id);
      seen[p.id] = true;
      if (!(p.tier >= 1 && p.tier <= 3)) out.push(p.id + ': tier out of range');
      if (!(p.cost > 0)) out.push(p.id + ': cost must be positive');
      if (!(p.upkeep >= 0)) out.push(p.id + ': upkeep must be >= 0');
      var dmg = damageOpsOf(p.ops || {});
      if (dmg.length && !(p.upkeep > 0)) {
        out.push('ANTI-RUNAWAY VIOLATION — ' + p.id + ' ("' + p.name +
          '") increases damage output at zero Veil upkeep: ' + dmg.join(', '));
      }
    }
    return out;
  }

  /* ==========================================================================
     validateAll() — extra self-check for the balance harness. Not required by
     the contract; sim may ignore it. Returns [] on a clean file.
     ======================================================================== */
  function validateAll() {
    var out = validatePacts();
    var i, j, ids = {}, shapes = {};

    if (PACTS.length !== 32) out.push('expected 32 pacts, got ' + PACTS.length);
    if (COVENANT.length !== 18) out.push('expected 18 covenant nodes, got ' + COVENANT.length);
    if (ASCENSIONS.length !== 8) out.push('expected 8 ascensions, got ' + ASCENSIONS.length);
    if (RIFTS.length !== 4) out.push('expected 4 rifts, got ' + RIFTS.length);
    if (HEROES.length !== 5) out.push('expected 5 heroes, got ' + HEROES.length);
    if (ENEMY_TYPES.length !== 12) out.push('expected 12 enemy types, got ' + ENEMY_TYPES.length);

    /* Heroes: 4 abilities, regen in band, filler at ~12 damage per Focus. */
    for (i = 0; i < HEROES.length; i++) {
      var h = HEROES[i];
      if (h.abilities.length !== 4) out.push(h.id + ': needs exactly 4 abilities');
      if (h.focusRegen < 14.4 || h.focusRegen > 21.6) {
        out.push(h.id + ': focusRegen ' + h.focusRegen + ' outside 18 +/-20%');
      }
      var a0 = h.abilities[0];
      var dpf = a0.damage / a0.focusCost;
      if (dpf < 11.5 || dpf > 12.5) {
        out.push(h.id + ': filler is ' + dpf.toFixed(2) + ' damage/Focus, want ~12');
      }
      for (j = 0; j < h.abilities.length; j++) {
        var ab = h.abilities[j];
        if (ids[ab.id]) out.push('duplicate ability id: ' + ab.id);
        ids[ab.id] = true;
        if (['melee', 'projectile', 'dash', 'execute', 'aoe'].indexOf(ab.kind) < 0) {
          out.push(ab.id + ': illegal kind ' + ab.kind);
        }
        if (ab.buff && ['atk', 'spd', 'focusRegen'].indexOf(ab.buff.stat) < 0) {
          out.push(ab.id + ': illegal buff stat ' + ab.buff.stat);
        }
      }
    }

    /* Enemies: legal shapes, one each, exactly 3 bosses with 2 behaviors. */
    var SHAPES = ['diamond', 'block', 'hex', 'star', 'orb', 'wisp', 'shard',
                  'ring', 'crown', 'spike', 'husk', 'core'];
    var BEHAVIORS = ['chaser', 'ranged', 'charger', 'splitter', 'summoner',
                     'orbiter', 'shielder', 'bomber'];
    var enemyIds = {}, bossCount = 0;
    for (i = 0; i < ENEMY_TYPES.length; i++) {
      var e = ENEMY_TYPES[i];
      enemyIds[e.id] = true;
      if (SHAPES.indexOf(e.shape) < 0) out.push(e.id + ': illegal shape ' + e.shape);
      if (shapes[e.shape]) out.push('shape used twice: ' + e.shape);
      shapes[e.shape] = true;
      if (!e.behaviors.length || e.behaviors.length > 2) out.push(e.id + ': needs 1-2 behaviors');
      for (j = 0; j < e.behaviors.length; j++) {
        if (BEHAVIORS.indexOf(e.behaviors[j].type) < 0) {
          out.push(e.id + ': illegal behavior ' + e.behaviors[j].type);
        }
      }
      if (e.boss) { bossCount++; if (e.behaviors.length !== 2) out.push(e.id + ': boss needs 2 behaviors'); }
    }
    if (bossCount !== 3) out.push('expected 3 bosses, got ' + bossCount);
    for (i = 0; i < ENEMY_TYPES.length; i++) {
      var sp = ENEMY_TYPES[i].behaviors.filter(function (b) { return b.type === 'splitter'; })[0];
      if (sp && !enemyIds[sp.into]) out.push(ENEMY_TYPES[i].id + ': splits into unknown ' + sp.into);
      var su = ENEMY_TYPES[i].behaviors.filter(function (b) { return b.type === 'summoner'; })[0];
      if (su && !enemyIds[su.spawns]) out.push(ENEMY_TYPES[i].id + ': summons unknown ' + su.spawns);
    }

    /* waveTable: ids resolve, waves 1-4 stay simple, boss lands on 5/10/15. */
    for (var w = 1; w <= 60; w++) {
      var tbl = waveTable(w);
      if (!tbl.length) out.push('waveTable(' + w + ') is empty');
      for (i = 0; i < tbl.length; i++) {
        if (!enemyIds[tbl[i].id]) out.push('waveTable(' + w + ') references unknown ' + tbl[i].id);
      }
      var nonBoss = tbl.filter(function (r) { return r.weight > 0; });
      if (w <= 4 && nonBoss.length > 4) out.push('wave ' + w + ' too complex: ' + nonBoss.length + ' archetypes');
      var hasBoss = tbl.filter(function (r) { return r.weight === 0; }).length;
      if ((w % 5 === 0) !== (hasBoss === 1)) out.push('wave ' + w + ': boss entry mismatch');
    }

    /* Covenant: requires resolve, depth <= 3, clean nodes carry no upkeep. */
    var byId = {};
    for (i = 0; i < COVENANT.length; i++) byId[COVENANT[i].id] = COVENANT[i];
    function depth(node, guard) {
      if (!node.requires || !node.requires.length) return 1;
      if (guard > 8) return 99;
      var parent = byId[node.requires[0]];
      if (!parent) return 99;
      return 1 + depth(parent, guard + 1);
    }
    for (i = 0; i < COVENANT.length; i++) {
      var c = COVENANT[i];
      if (c.requires.length > 1) out.push(c.id + ': use a single-element requires array');
      if (c.requires.length && !byId[c.requires[0]]) out.push(c.id + ': unknown requires ' + c.requires[0]);
      var d = depth(c, 0);
      if (d > 3) out.push(c.id + ': depth ' + d + ' exceeds 3');
      if (c.clean && c.upkeep !== 0) out.push(c.id + ': clean node must have upkeep 0');
    }

    /* Ascensions fixed by DESIGN.md Part 4. */
    function asc(n) { return ASCENSIONS.filter(function (a) { return a.level === n; })[0]; }
    if (!asc(3) || asc(3).mods.moteLifeMult !== 0.5) out.push('A3 must be moteLifeMult 0.5');
    if (!asc(5) || asc(5).mods.veilFloorAdd !== 10) out.push('A5 must be veilFloorAdd 10');
    if (!asc(7) || asc(7).mods.parMult !== 0.8) out.push('A7 must be parMult 0.8');

    /* Veil tiers keep the x1/2/4/8/16 shape. */
    var wantMult = [1, 2, 4, 8, 16];
    for (i = 0; i < wantMult.length; i++) {
      if (!VEIL_TIERS[i] || VEIL_TIERS[i].mult !== wantMult[i]) {
        out.push('VEIL_TIERS[' + i + '] must have mult ' + wantMult[i]);
      }
    }
    return out;
  }

  /* ==========================================================================
     EXPORT
     ======================================================================== */
  g.CONTENT = {
    HEROES: HEROES,
    PACTS: PACTS,
    ENEMY_TYPES: ENEMY_TYPES,
    RIFTS: RIFTS,
    COVENANT: COVENANT,
    ASCENSIONS: ASCENSIONS,
    VEIL_TIERS: VEIL_TIERS,
    STRINGS: STRINGS,
    validatePacts: validatePacts,
    waveTable: waveTable,
    /* additive helpers — sim may ignore these */
    BOSS_ROTATION: BOSS_ROTATION,
    bossForWave: bossForWave,
    validateAll: validateAll
  };

})(typeof window !== 'undefined' ? window : globalThis);
