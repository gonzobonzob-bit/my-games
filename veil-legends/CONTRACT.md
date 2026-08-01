# Veil Legends — Module Contract

Four builders work in parallel, one owner per file. This contract is the ONLY
coordination between them. If you need something from another module, it must
be in this contract — do not invent cross-module calls that aren't listed here,
and implement EVERYTHING listed for your module even if you don't use it
yourself. Deviations get caught at integration and cost everyone.

## Ownership (hard boundaries)

| File | Owner | May also touch |
|---|---|---|
| `js/content.js` | content-writer | nothing else |
| `js/sim.js` | systems-engineer | `test/` (smoke scripts) |
| `js/fx.js` | art-and-feel | nothing else |
| `js/ui.js` + `index.html` + `css/style.css` | interface-engineer | nothing else |

Old game for reference/porting: `../veil-legends.html` (read-only for all).

## Load order & globals (plain scripts, NO ES modules — file:// must work)

```html
<script src="js/content.js"></script>  → window.CONTENT
<script src="js/sim.js"></script>      → window.Sim
<script src="js/fx.js"></script>       → window.FX
<script src="js/ui.js"></script>       → window.UI (boots on DOMContentLoaded)
```

- **content.js**: pure data + pure helper functions. No DOM, no state, no
  localStorage. Must load and be fully readable under plain Node (`require`-
  free, just executes and defines `CONTENT` on `globalThis`).
- **sim.js**: the entire simulation. **ZERO DOM/canvas/audio access** — this is
  what makes the headless balance harness possible. May use localStorage but
  only via its internal `store()` wrapper (try/catch, injectable for tests:
  `Sim._setStorage(obj)`). Reads `CONTENT`. Never calls FX or UI.
- **fx.js**: canvas rendering + WebAudio. Reads `Sim.state` and drains
  `Sim.events`. Never mutates sim state. No DOM outside `#game-canvas` and the
  float-text layer `#fx-layer`.
- **ui.js**: DOM, menus, HUD text/bars, input, master loop. Calls `Sim.*` and
  `FX.*`. Never touches the canvas directly.

## The master loop (ui.js owns it — exactly one, handle-tracked)

```js
// fixed-step accumulator; EVERYTHING in sim is dt-scaled (seconds).
// NOTHING anywhere may be frame-count-based (the old game's frame%20 bug).
const STEP = 1/60;
let acc = 0, last = 0, rafId = null, running = false;
function frame(t){
  if(!running) return;
  acc += Math.min((t - last)/1000, 0.1); last = t;
  while(acc >= STEP){ Sim.tick(STEP); acc -= STEP; }
  FX.render(Sim.state, Sim.drainEvents());
  UI.syncHud(Sim.state);          // cheap text/bar updates only
  rafId = requestAnimationFrame(frame);
}
```
`UI.startLoop()` / `UI.stopLoop()` (cancels rafId, sets running=false). Menu,
pause, death and Pact-draft all STOP ticking via `running=false` or by not
calling `Sim.tick` (pause keeps rendering: loop runs, tick skipped —
`UI.paused` flag). `stopLoop()` is called on every route back to menu. Input
listeners are bound ONCE at boot (`UI.bindInput()`), never per-run.

## Sim public API (systems-engineer implements exactly this surface)

```js
Sim.newRun(heroId, riftId)        // fresh run, applies covenant+ascension
Sim.continueRun() -> bool         // restore saved run; false if none/invalid
Sim.tick(dt)                      // advance dt seconds; no-op unless phase 'combat'
Sim.useAbility(i)                 // 0..3; handles Focus/Overdraw internally
Sim.setMove(mx, my)               // normalized movement intent (-1..1 each)
Sim.setArena(W, H)                // canvas size for clamping (UI calls on resize)
Sim.choosePact(idOrNull)          // during 'pactDraft'; null = decline
Sim.buyCovenant(nodeId) -> bool   // meta screen
Sim.respecCovenant()              // refunds per design (Clean nodes 50%)
Sim.setAscension(n)               // 0..8, capped at meta.ascensionUnlocked
Sim.save()                        // persist meta + run snapshot (try/catch inside)
Sim.abandonRun()                  // end run, bank echoes, clear run save
Sim.drainEvents() -> Event[]      // returns and clears the event queue
Sim.state                         // read-only by convention (see below)
Sim._setStorage(obj)              // test hook: {getItem,setItem,removeItem}
```

### Sim.state read surface (field names are FROZEN — UI/FX render from these)

```js
{
  phase: 'menu'|'combat'|'pactDraft'|'dead',
  wave, parRemaining,            // seconds; negative = over par
  veil, veilFloor,               // 0..100
  focus, focusMax,
  motes,                         // run currency
  hp, hpMax,
  waveHpRemaining, waveHpTotal,
  player: { x, y, vx, vy, spd, heroId, color, icon, invuln },
  enemies: [ { x, y, vx, vy, hp, maxHp, size, color, shape, archetypeId,
               isWraith, isBoss, slowMult } ],
  projectiles: [ { x, y, vx, vy, r, col } ],
  abilities: [ { id, name, icon, cd, maxCd, focusCost, kind } ],  // 4 entries
  pactsTaken: [pactId],
  draftOffer: [pactId, pactId, pactId] | null,   // when phase==='pactDraft'
  runStats: { kills, breaches, motesEarned, timePlayed, bestWave },
  meta: { echoes, covenantOwned: [nodeId], ascension, ascensionUnlocked,
          heroesUnlocked: [heroId], bestWaveEver }
}
```

### Events (sim pushes; FX consumes; unknown types MUST be ignored)

```js
{type:'hit', x, y, amount, crit}         {type:'kill', x, y, color, shape}
{type:'overdraw', deficit}               {type:'breach', x, y}
{type:'wraith_spawn', x, y}              {type:'wave_start', wave}
{type:'wave_clear', wave, overPar}       {type:'pact_taken', pactId}
{type:'player_hurt', amount}             {type:'death'}
{type:'mote_drop', x, y, tier}           {type:'mote_pickup', x, y, value}
{type:'cast', kind, x, y, targetX, targetY, abilityId, range}
{type:'float', x, y, text, color}        {type:'tier_change', tier}
```
UI listens for phase changes by polling `Sim.state.phase` in `syncHud` (cheap),
not via events. FX renders combat feedback only from events + state.

## Vocabularies (content.js may ONLY use these; sim/fx MUST implement all)

**Enemy `shape`** (fx implements all, falls back to `'orb'`):
`diamond | block | hex | star | orb | wisp | shard | ring | crown | spike |
husk | core`

**Ability `kind`**: `melee | projectile | dash | execute | aoe`
**Ability modifier fields** (all optional):
`lunge:bool, homing:bool, pierce:bool, slow:{amount,duration},
ticks:int, delay:sec, buff:{stat,amount,duration}, heal:num,
shield:{amount,duration}, speed:px_s, range:px, focusCost, maxCd, damage`
(`buff.stat` ∈ `atk|spd|focusRegen`.)

**`damage` is PER TICK, and `ticks` composes with `delay`.** An ability with
`{damage:130, ticks:2}` deals 130 twice, for 260 — not 65 twice. Pulses land
`TUNING.TICK_INTERVAL` (0.25s) apart, and if `delay` is also present the first
pulse is `delay` seconds out rather than immediate. This was ambiguous until
2026-08-01 and sim.js had implemented the other reading: `damage` was split
across ticks, and `delay` and `ticks` were exclusive branches so an ability
carrying both fired exactly one pulse of `damage/ticks`. Toll the Hollow
delivered 36 of a declared 330. Per-tick is the reading every tooltip already
used ("Two hits of 130") and the only one that satisfies DESIGN 5.1's k = 12
damage per Focus, which the whole pressure curve is derived from.
`ticks` applies to `melee` and `aoe` kinds.

**Pact ops** — a Pact is `{id, name, icon, tier:1|2|3, cost:motes,
upkeep:veilFloorAdd, text, ops:{...}}`. Allowed op keys (sim implements every
one; numbers are additive deltas unless suffixed `Mult`):
```
focusRegenAdd, focusMaxAdd, hpMaxAdd, moveSpeedMult, damageMult,
meleeDamageMult, projDamageMult, aoeDamageMult, cooldownMult,
lifestealPct, thornsPct, executeThresholdAdd, chainCount, pierceCount,
aoeRadiusMult, moteMagnetRadius, moteLifeAdd, parAdd,
veilDecayMult, overdrawRateMult, brinkGuard (int: survive N breaches
without wraith), hpRestoreMultBetweenWaves, critChanceAdd, critMult,
wraithDamageMult, settleWindowAdd
```
**Anti-runaway rule (enforced by a content.js self-check function
`CONTENT.validatePacts()` returning []): any pact whose ops increase damage
output (damageMult>1, *DamageMult>1, critChanceAdd>0, chainCount>0,
pierceCount>0, cooldownMult<1, focusRegenAdd>0, focusMaxAdd>0) MUST have
`upkeep > 0`.** Sim calls this at boot and console.errors violations.

**Enemy archetypes** — `ENEMY_TYPES` entry:
`{id, name, shape, color, size, hp, atk, spd, moteValue, boss:bool,
behaviors:[1..2 descriptors], telegraph:sec}`. Behavior descriptors (sim
implements ALL of these; content composes from them and nothing else):
```
{type:'chaser'}                              // walk at player, contact damage
{type:'ranged', range, attackCd, projSpeed}  // kite to range, fire at player
{type:'charger', windup, dashSpeed, dashCd}  // telegraphed dash
{type:'splitter', into:enemyId, count}       // on death, spawn count children
{type:'summoner', spawns:enemyId, count, period}
{type:'orbiter', radius, strikeCd}           // circle player, dart in
{type:'shielder', radius, reduction}         // damage-reduction aura for allies
{type:'bomber', radius, damage}              // explodes on death/contact
```
12 archetypes total (variants of a behavior with different stats/shapes count),
of which 3 are named bosses (`boss:true`, appear on wave 5/10/15 rotation,
bigger stats, two behaviors). Wave composition: sim picks archetypes by wave
number using `CONTENT.waveTable(w) -> [{id, weight}]` (a pure function
content.js provides; brutes ~70% of HP pool, stalkers ~70% of threat per
DESIGN.md Part 1).

**Covenant node**: `{id, name, cost:echoes, clean:bool, upkeep:startingVeilFloorAdd,
requires:[nodeId], ops:{...same pact ops...}}`. Clean nodes: `upkeep:0`,
`cost` ≈ 3× equivalent. 18 nodes, max 3 tiers deep.

**Ascension rules** (content defines A1..A8 as `{level, name, text, mods:{...}}`
with mod keys): `moteLifeMult, veilFloorAdd, parMult, enemySpeedMult,
enemyHpMult, enemyCountAdd, wraithHpMult, hpRestoreMult, settleWindowMult`.
Design fixes A3 = moteLifeMult 0.5, A5 = veilFloorAdd 10, A7 = parMult 0.8.

**VEIL_TIERS**: `[{min:0,mult:1},{min:25,mult:2},{min:50,mult:4},
{min:75,mult:8},{min:90,mult:16}]` — content.js owns the numbers; sim reads.

**Heroes**: 5 heroes × 4 abilities (port 4 old heroes to the new
Focus/Overdraw economy, add a 5th). `{id, name, icon, hp, focusMax,
focusRegen, atk, spd, color, abilities:[4], unlockAt:{wave|ascension}|null}`.

**Rifts** (4): `{id, name, text, mods:{...ascension mod keys...},
unlockAt:{...}|null}`.

**Numbers content.js must respect** (from DESIGN.md): base `focusRegen` 18
(hero variance ±20%), damage-per-focus ≈ 12 at baseline, wave formulas
`N(w)=6+2w`, `avgHP=100(1+0.15w)`, `T_par=20+0.8w`, Veil q=0.8, decay 4/s,
settle 1.5s, wraith speed 1.05× player base, breach reset 60, par overrun
+4 V/s and +0.1 floor/s, between-wave restore +25% hpMax, mote life 6s.

## FX public API (art-and-feel implements)

```js
FX.init(canvas, floatLayerEl)
FX.render(state, events)          // full frame; also advances particles by real dt it computes internally
FX.setOptions({volume:0..1, muted:bool, screenShake:bool, reducedFx:bool})
FX.sfx(name)                      // exposed for UI (button clicks, menu)
FX.veilPalette(v)                 // 0..100 → arena tint (used internally; exposed for UI accents)
```
Damage floats: pooled, max 24 live, in `#fx-layer` (absolute-positioned div
over canvas) or on-canvas — art-and-feel's choice, but POOLED.
Audio: extend the old `sfx()` bank; add a procedural music bed with
`FX.music(on)`; everything behind the volume/mute options. Lazy AudioContext
with a resume-on-first-gesture guard (UI calls `FX.sfx('ui')` on first tap).

## UI responsibilities (interface-engineer)

- `index.html`: semantic containers — `#menu` (New / Continue / Settings —
  vault pattern), `#hud-top`, `#canvas-wrap > #game-canvas + #fx-layer +
  joystick`, `#hud-bottom` (4 ability buttons), `#pact-draft`, `#covenant`,
  `#pause`, `#death`, `#settings`. All screens are divs toggled by UI.
- Esc = pause overlay (Resume / Save / Settings / Main Menu). Vault rule.
- Veil meter with the 5 tier bands + wave-HP bar. **Do NOT display C, u*, or
  any recommended-burn hint (DESIGN.md 5.4).**
- Settings: volume slider, mute, screen shake toggle, reduced FX toggle,
  "Reset save" (double-confirm). Persist to `veilLegendsSettings` (try/catch),
  apply via `FX.setOptions`.
- Autosave: UI calls `Sim.save()` every 30s (handle-tracked interval, cleared
  on stopLoop), on `visibilitychange`(hidden) and `pagehide`. Sim also saves
  internally on wave transitions.
- Touch: joystick bottom-left (port the old zone/knob mechanics), ability
  buttons ≥ 48px touch targets, `viewport-fit=cover` safe areas.
- **Xbox controller (Gamepad API, standard mapping) — required.** UI polls
  `navigator.getGamepads()` inside the master loop (poll-based API; early-out
  when none connected). Bindings: left stick → `Sim.setMove` (deadzone 0.15),
  A/B/X/Y (buttons 0–3) → `Sim.useAbility(0..3)`, Start (9) → pause toggle,
  d-pad/left stick + A → menu/overlay navigation with a visible focus ring
  (menu, pause, settings, Pact draft, Covenant, death screen — all of them).
  LB/RB (4/5) cycle focus in the Pact draft. Show a toast on
  `gamepadconnected` and list the bindings in Settings. Sim and FX are
  unaffected — UI translates controller input into the same Sim calls.
- Fonts: `css/style.css` @font-face → `fonts/cinzel-latin.woff2` (Cinzel
  variable 700–900), `fonts/nunito-latin.woff2` (Nunito variable 700–800).
  `font-display: swap`, system-serif/sans fallbacks. NO external requests.

## Save schema (sim owns; key `veilLegendsSave`)

```js
{ saveVersion: 2,
  meta: { echoes, covenantOwned, ascension, ascensionUnlocked,
          heroesUnlocked, bestWaveEver, riftsUnlocked },
  run: null | { heroId, riftId, wave, motes, hp, hpMax, focus, veil, veilFloor,
                pactsTaken, runStats, waveHpRemaining }  // saved BETWEEN waves only
}
```
- Run snapshots are taken at wave boundaries (post-draft) — never mid-wave, so
  the save-scum wave-refund exploit is structurally impossible (continuing
  always restarts the current wave with the same state).
- Strip transient buffs/shields before serialising (old Berserker exploit).
- **v1 migration**: old shape `{saveVersion:1, heroId, wave, gold, kills,
  player:{...}}` → grant `echoes = wave*5 + floor(gold/10)`, mark the old
  hero unlocked, discard the run, write v2. Corrupt/unknown → fresh v2, no
  crash (try/catch everywhere).

## Style & platform ground rules (everyone)

- Self-contained: zero external network requests of any kind.
- No real-world brand names anywhere in content.
- Mobile-first: it must be playable one-thumb portrait 390×760; test sizes
  360×640 up.
- All timing dt-based in seconds. No `frame % n`. No `Date.now()` inside sim
  logic (sim keeps its own `state.time += dt` clock; Date.now only for save
  timestamps).
- Every setInterval/RAF/listener handle tracked and cleared by its owner.
