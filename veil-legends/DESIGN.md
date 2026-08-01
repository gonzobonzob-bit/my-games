# Veil Legends — Design Proof (Major Overhaul, 2026-07-31)

Produced by design-architect at greenlight; approved for full-scope build.
This is the binding design document for the overhaul. The old single-file game
(`../veil-legends.html`) failed binding rule 1 (proofs in Part 0); this design
passes (proof in Part 5). Builders implement THIS, not the old game's systems.

---

## Part 0 — Why the old build failed rule 1 (kept for the record)

1. **Shop optimum was a constant.** Attack Boost: flat 50G, permanent +20 atk,
   unlimited buys. Auto-attack (3/s) + `totalDmg = a.damage + player.atk` made
   it 1.2 DPS/G forever; Mana Crystal was dominated by waiting 7.5s of free
   regen; Speed Boost was dominated because the player already outran every
   enemy 2.6×. Optimal policy: "buy Attack Boost with every gold piece" —
   state-independent. The Purr & Power slider, wearing a sword.
2. **Quadratic-vs-linear runaway.** Cumulative gold G(w) ≈ 16w²+69w →
   atk(10) ≈ 996; enemy HP scaled linearly ×(1+0.2w), capped at 3×. The game
   got easier from wave 4 on.
3. **No failure state.** Kiting was free (375 px/s vs 144 max enemy px/s) with
   a zero-input homing auto-attack; incoming damage was hard-capped at 1 hit
   per 0.3s by a global i-frame regardless of enemy count.
4. **Ultimates were dominated.** Fireball spam beat METEOR for all atk ≥ 0 on
   single targets; METEOR only won at N > ~5–11 enemies. (That N-dependence is
   the one genuine state-dependent seed in the old code — kept deliberately.)

Four live defects also confirmed: stacked rAF loops (backToMenu never cancels),
stacked document-level joystick listeners, save-scum wave refund (menu+continue
respawns a full wave keeping gold), Berserker buff serialised into the save.

---

## Part 1 — The core recurring decision

> **How deep do I go into the Veil right now — and on whom do I spend it?**

Every 5–20 seconds: cast within your Focus regen and stay safe, or **Overdraw**
— cast past your Focus, paying the deficit in Veil, buying immediate DPS at the
price of making every enemy on the field faster and harder-hitting for the rest
of the wave.

Exact mechanics:

- **Focus (F)**: pool `F_max`, regen `ρ = 18/s`. Abilities cost Focus. There is
  **no auto-attack** — every point of damage is a button press.
- **Overdraw**: casting with `F < cost` is permitted. Deficit `d = cost − F` is
  charged to Veil at `q = 0.8` Veil per Focus. `F → 0`.
- **Veil (V)**, 0–100. Decays at 4/s, but only after 1.5s with no cast (a
  "settle" window). Effects:
  - enemy contact damage ×`(1 + V/50)`
  - enemy speed ×`(1 + V/60)` — at V ≈ 100 minions are faster than you
  - mote yield per kill × tier step: V<25 →×1, 25–50 →×2, 50–75 →×4,
    75–90 →×8, ≥90 →×16  (`VEIL_TIERS` in content.js — tunable, see Part 5.5)
- **Brink**: V ≥ 100 breaches. A **Veilwraith** spawns (speed 1.05× the
  player's base — unkiteable, must be killed), V resets to 60, wraiths persist
  across waves and stack.
- **Par clock**: each wave has `T_par(w)`. Every second past par adds +4 Veil
  and +0.1 to the **permanent run Veil floor**.

Second axis, same resource: **target priority.** Brutes are ~70% of the wave HP
pool (they move the par clock); Stalkers are ~70% of incoming damage rate (they
move the HP clock). Which clock binds depends on `h/h_max` vs
`t_remaining/T_par` — both observable, both flip mid-wave.

## Part 2 — The failure state

Three distinct deaths; **both extremes of the policy space are fatal**:

1. **Brink death (reckless).** Rode V past 85; enemy speed converges on yours;
   surrounded and melted in ~2s. Legibly self-inflicted.
2. **Wraith accretion (careless).** Three breaches = three persistent wraiths,
   each faster than your base speed. Cannot kite, cannot out-DPS.
3. **Attrition death (timid).** Never overdrew, missed par repeatedly, each
   overrun second added +0.1 permanent Veil floor. By wave ~14 headroom is 20,
   par is unreachable, the floor climbs faster than you can clear. **Death by
   playing safe** — the mechanism that forbids a constant policy.

## Part 3 — The scarce resource

**Veil headroom: `85 − V_floor`** (85, not 100 — contact damage diverges near
V≈96). Four claimants on one budget: in-wave Overdraw (transient), Pact upkeep
(permanent per-run floor), mote tier multiplier (held V = sustained risk),
Covenant node upkeep (starting floor on every future run).

Secondary scarcities: **motes** (currency; expire 6s after drop; must be walked
over — collection is itself a positional risk) and **HP** (restores only +25%
of max between waves).

**Anti-runaway rule, binding on content.js:** *no Pact may grant positive DPS
at zero Veil upkeep.* This is what prevents Attack Boost reappearing.

## Part 4 — The pressure curve

- **Minute 5 (waves 1–4):** damage gated by cooldowns, not gold. Wave 3: 12
  enemies, ~1,380 HP pool, 22s par; clean play finishes ~19s. Pressure is
  spatial (four-edge convergence; position so one AoE catches three). Veil is
  deliberately slack — that's onboarding.
- **Hour 1 (waves 8–18, Pacts 6–16):** **required burn crosses available
  headroom.** Par demands overdraw (u_req(10) = 6500/28 = 232 DPS vs base
  216) while Pact upkeep has eaten 25–40 of 85 headroom. Around wave 12 the
  player starts *declining* Pacts — the moment the game becomes a game.
- **Hour 10:** runs feed **Echoes** into an 18-node **Covenant tree** (cheap
  nodes add *starting* Veil floor; "Clean" nodes cost 3× and add none).
  **Ascension 1–8** layers rules (A3: motes expire in 3s; A5: floor +10;
  A7: par −20%). The hour-10 respec question is the same decision as the
  10-second one at 3,000× timescale. 5 heroes × 4 rifts vary coefficients.

## Part 5 — The non-constant proof

### 5.1 Analytic result
Minimise damage taken over one wave. `H` = remaining wave HP, `V₀` = Veil now,
`x` = overdraw rate (Focus/s beyond regen), `k = 12` damage per Focus,
`q = 0.8`, `ρ = 18`, `P₀ = kρ = 216` DPS.

```
u* = 2P₀H/(C + H),   C = 100k(1+V₀/50)/q = 1500(1 + V₀/50)
```

**Overdraw iff remaining wave HP exceeds `1500·(1 + V/50)`.**
(V=0 → C=1500; V=40 → 2700; V=80 → 3900.) `H` falls through every wave and `V`
rises as you burn — **the threshold is crossed, in the same direction, in every
wave, at a point the player controls.** Total burn: `B = (H − C)/30`.

### 5.2 Worked wave 10 (H₀=6,500, 26 enemies, T_par=28s)
Start V=0: unconstrained u*=351 DPS would breach; Brink-constrained solution is
x=3.47 → 257.6 DPS for the first 4,500 HP (17.5s). At 2,000 HP left, V=70:
C=3,600 > H → **stop overdrawing, coast at 216, kite, let V bleed 70→33.**
Total 26.8s < 28s par. The script is: burn 60% over regen for 17s, then
hard-stop. A scheduled inversion, not a constant.

### 5.3 Three states, same wave, three optima (wave 6, H=8,928)
Contact model `d(V) = 4.94·375/(375 − 144(1+V/60))` (frequency ∝ 1/closing
speed — convex in V, and diegetic). Policy table: x=0 → 72 motes/331 HP lost;
x=1.5 → 113/416; x=3 → 148/689. Marginal rates 0.48 then 0.128 motes/HP.
- **A: full HP, nothing pending** (λ≈0.15): optimal x ≈ 1.5–2.5.
- **B: hurt, 220/1000 HP** (λ≈0.6): optimal x = 0 — and L(0)=331 > 220, so
  the right play is abandoning the DPS race to kite/Ward. A third behaviour.
- **C: full HP, next Pact costs 200 motes and doubles Focus regen**: step
  value at 200 motes → optimal x = 3.0.

### 5.4 HUD rule
Show `V` (meter with tier bands) and wave-HP-remaining. **Never show C, u*,
x*, or any recommended burn.** Two inputs are enough to feel the crossover and
not enough to trivialise it.

### 5.5 UNPROVEN — mandatory harness assertions (binding rule 2)
1. **Flat-V vs pulse near-tie.** Whether flat or pulsed overdraw wins is an
   artefact of `VEIL_TIERS` steepness. Harness must run flat-V and pulse
   policies head-to-head at three wave sizes and confirm **neither dominates
   by more than 8% motes-per-HP**. If one dominates, fix the tier exponent in
   content.js, not anything else.
2. **Runs must end.** For every Pact set `P` reachable by wave `w`:
   `burnRequired(w,P) / (85 − veilFloor(P))` **strictly increasing in w**.
   Any flat/falling combination is a solved economy → reprice that Pact.
3. **Policy spread.** Timid (never overdraw) dies ~w12–15; Reckless (max burn)
   dies ~w9–11; Adaptive (threshold policy from 5.1) reaches w20+.

## Part 6 — Keep verbatim from the old file

1. `render()` — hex grid, radial gradient, vignette, per-enemy procedural
   silhouettes (diamond/rounded-rect/hexagon-with-orbit/8-point star). Port to
   fx.js unchanged, then layer a Veil-reactive palette shift (arena reddens and
   warps as V climbs).
2. `leadAim()` — correct quadratic intercept solver. Keep exactly.
3. `sfx()` oscillator bank — keep, extend.
4. Dual control scheme (joystick + WASD/arrows + Digit1–4). Keep the map.
5. `renderHeroAbilities()` always-visible tip panel pattern — reuse for Pact
   draft and Covenant tree.
6. Ability-kind taxonomy `melee|projectile|dash|execute|aoe` + modifiers
   (`lunge,homing,pierce,slow,ticks,delay,buff,heal`). Grow it in content.js.
7. Theme: name, `--purple #7c3aed`, Cinzel/Nunito, "ENTER THE VEIL" framing.
8. `spawnDmgFloat` — keep but POOL it (cap ~24 live floats, in fx.js/canvas).

**Explicitly delete:** auto-attack, SHOP_ITEMS, MP + flat regen, MAX_WAVE=10,
deleteSave() on death/victory, global 0.3s i-frame damage cap.

## Part 7 — Wave scaling (endless)

Scale on **count, speed and shrinking par time — not HP**:
`N(w) = 6 + 2w`, `avgHP = 100·(1 + 0.15w)`, `T_par = 20 + 0.8w` seconds
(T_par grows slower than wave HP → required DPS rises; A7 multiplies par by
0.8). Boss/named waves every 5. No MAX_WAVE; runs end in death. Between waves:
+25% max-HP restore, Pact draft every wave from wave 2 (3 offered, may decline).
