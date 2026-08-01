# Grimoire Siege — Build Contract (Squad 1, 50% → 75%)

Binding on all four builders. Each builder edits EXACTLY one file. Anything
crossing a file boundary is named here; if you need something not in this
contract, implement your side against the names below and note the gap in your
report — do not edit another builder's file. Classic scripts sharing top-level
scope, load order: content.js → sim.js → fx.js → ui.js.

## File ownership
- `js/content.js` — content-writer
- `js/sim.js` — systems-engineer
- `js/fx.js` — art-and-feel
- `js/ui.js` + `index.html` + its CSS — interface-engineer (nobody else touches index.html)

## The design change being built (DESIGN.md is binding)
Randomized, previewed per-wave enemy **resistances** so the DPS/gold ranking
flips wave-to-wave (kills the solved loop), plus: per-type leak costs, score
without the hoard reward, branching upgrades at L2+, endless mode after wave 12,
Venom/Frost made real choices.

## Cross-file API

### content.js provides (all const, data only, no logic)
- `DAMAGE_CLASSES = ['pierce','blast','arcane']` — every TOWERS entry gains
  `dmgClass` (one of these). Spread the 10 towers across all three classes so
  every class has cheap and expensive options.
- `RESIST_PROFILES` — array of profile objects
  `{id, name, icon, resists:{pierce:0..0.7, blast:0..0.7, arcane:0..0.7}}`
  including a no-resist profile for early waves. Resist = damage *reduction*
  fraction.
- `WAVE_SCRIPT` — replaces WAVE_DEFS's fixed 12 rows: same base fields
  (`count,hp,spd,boss?,fast?`) plus `profilePool:[profileId,...]` (the RNG picks
  from the pool at generation time) and `profileCount` (how many distinct
  profiles that wave mixes, 1–2). Waves 1–2 use the no-resist profile only.
- `ENDLESS = {hpGrowth, countGrowth, spdCap, profileCountFrom}` — explicit
  scaling formula constants for waves 13+ (design change #7). Document the
  arithmetic in comments.
- `LEAK_COST = {grunt:1, fast:1, boss:4}`.
- `BRANCHES` — per tower id, two branch specs chosen at L2:
  `{a:{name, blurb, mods}, b:{name, blurb, mods}}` where `mods` multiply
  towerStats fields (`dmg`, `range`, `rate`) and/or special fields
  (`aoe`, `chain`, `slowFactor`, `dotDamage`, `dotStacks`). Venom's branches must
  make its DoT scale (design change #2): dot damage derives from tower dmg, and
  one branch lets it stack.
- Rebalanced base numbers on TOWERS so each tower owns a niche **under the
  resist system** — show the DPS/gold arithmetic in comments (DESIGN.md §3 table
  is the baseline being fixed). Do not delete fields sim/fx already read
  (`proj`, `color`, `icon`, `cost`, `dmg`, `range`, `rate`, `aoe`, `slow`,
  `dot`, `chain`).

### sim.js provides
- `generateWave(n)` → wave def `{n, count, hp, spd, boss, fast, profiles:[profile,...]}`
  using WAVE_SCRIPT for n≤12 and ENDLESS scaling beyond; assigns each spawned
  enemy a profile and `e.resists`. Uses `Math.random()` (no seed requirement).
- `nextWaveDef` — global, generated at *schedule* time (scheduleWave), so the
  preview exists during the whole gap. `startWave()` consumes it.
- `hitEnemy` applies `dmg * (1 - (e.resists[p.dmgClass]||0))`; chain and DoT
  damage go through the same reduction. DoT uses the firing tower's scaled
  damage per BRANCHES, not flat DOT_DAMAGE.
- Leak: `lives -= LEAK_COST[e.kind]` (clamped at 0).
- Score: `kills*10 + wave*50 + investedGold` where `investedGold` is the
  lifetime sum of gold spent on placements + upgrades (new global, saved).
- `towerStats(t)` consumes `t.branch` ('a'|'b'|null) and applies BRANCHES mods.
- `chooseBranch(t, which)` — sets branch, charges upgradeCost, called by ui.
- Endless: after wave 12 clears, sim sets `endlessOffered=true` and pauses wave
  scheduling until ui calls `beginEndless()` or `claimVictory()`.
- Save schema v2 (`grimoireSiege_save_v2`): adds `investedGold`, `branch` per
  tower, `settings`, endless progress. **Migrate v1 saves** (read old key,
  map, keep bestWave/highScore) rather than discarding.
- `settings` global `{volume:0..1, shake:true}` persisted in the save; sim owns
  persistence, ui owns the widgets, fx reads the values.

### fx.js provides
- Reads `settings.volume` as the sfx gain multiplier (0 = mute) and
  `settings.shake` to gate screen shake.
- `drawEnemy` renders the enemy's resist profile visibly (glyph/tint per
  DAMAGE_CLASSES — a player must be able to *see* what resists what at a
  glance; use profile `icon`).
- Visual differentiation for branched towers (small crest/tint per branch).
- New sfx names: `'branch'` (upgrade-branch pick), `'endless'` (endless start).
  Keep the existing procedural idiom.

### ui.js / index.html provides
- **Wave preview panel** during prep and every gap: reads `nextWaveDef`, shows
  count, kinds, and each profile's icon + what it resists (the read-and-react
  moment the whole design hangs on). Must be visible without hovering.
- **Settings** on the main menu (vault requirement) and pause overlay: volume
  slider, shake toggle — writes `settings`, calls sim's persistence.
- **Branch picker**: upgrading past L1 opens a two-option choice (BRANCHES
  blurbs) instead of a bare upgrade button; calls `chooseBranch`.
- **Endless prompt** at wave-12 clear: Continue Endless / Claim Victory,
  calling sim's `beginEndless()`/`claimVictory()`.
- Tower shop buttons show each tower's dmgClass icon.
- HUD wave counter handles endless (`WAVE 17` — drop the /12 past 12).

## Constraints (all builders)
- No CDN, no external runtime deps, no real brand names, no live API calls.
- Interval hygiene: any new timer's handle is stored and cleared on
  pause/game-over/menu paths.
- Do not break the pause-aware scheduleWave contract (pendingWaveTimer /
  wavePendingOnResume) — the soft-lock fix in it is load-bearing.
- Save/load stays try/catch-wrapped and degrades to fresh start.
- The smoke suite must keep passing; the integrator extends it after merge.
- Balance is verified by the harness at the 100% stage — favor legible
  arithmetic over cleverness so balance-scientist can extract it.
