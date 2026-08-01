# Design Proof — Grimoire Siege (Squad 0 greenlight gate)

**Source read:** `/home/gonzobonzob/projects/my-games/grimoire-siege.html` (1,836 lines). All numbers below are quoted from `TOWERS`, `WAVE_DEFS`, the tuning constants block (lines 179–202), `towerStats()`, `upgradeCost()`, `sellValue()`, `killEnemy()`, `onWaveCleared()`, `hitEnemy()`, `startWave()`, `recordRunEnd()`.

## 1. The core decision
*"Which tower do I buy or upgrade next, and where?"* — that is the only recurring choice. Placement, upgrade (`upgradeCost = floor(cost·0.55·(lvl+1))`, max level 3), and sell (`0.6·invested`) are the whole verb set. Stated in one sentence, fine. Proven non-constant — no. See §3.

## 2. The failure state
Lives start at 20 (`START_LIVES`); any enemy reaching the last waypoint costs exactly **1 life** regardless of type (line 998) — a 1,800 HP wave-12 boss leak costs the same as a 60 HP wave-1 grunt. At 0 lives, `showGameOver(false)`. The failure state exists but is toothless: you may leak 19 enemies across a 12-wave run, including every boss in the game (7 total bosses = 7 lives).

## 3. The non-constant proof — **FAILS**

**Ground truth.** Single-target DPS = `dmg·60/rate`. DPS-per-gold across all 10 towers:

| Tower | cost | dmg | rate | DPS | DPS/gold |
|---|---|---|---|---|---|
| **Archer** | 50 | 25 | 60 | 25.0 | **0.500** |
| Cannon (aoe50) | 120 | 100 | 120 | 50.0 | 0.417 |
| Divine | 180 | 120 | 100 | 72.0 | 0.400 |
| Pyromage (aoe30) | 80 | 40 | 80 | 30.0 | 0.375 |
| Storm (chain2) | 100 | 60 | 100 | 36.0 | 0.360 |
| Arcane | 150 | 80 | 90 | 53.3 | 0.356 |
| Shadow (aoe40) | 200 | 150 | 130 | 69.2 | 0.346 |
| Dragon (aoe60) | 300 | 200 | 150 | 80.0 | 0.267 |
| Frost (slow) | 70 | 20 | 70 | 17.1 | 0.245 |
| **Venom (dot)** | 90 | 15 | 50 | 18.0 | **0.200** |

**Upgrades are a wash by construction.** `towerStats`: dmg ×(1+0.45·lvl), rate ×(1−0.15·lvl). A max-level tower does 2.35/0.55 = **4.27× DPS for 4.3× cumulative cost** (base + 0.55c·(1+2+3)) — efficiency ratio 0.993. The upgrade-vs-buy-new "decision" is engineered to ±1%. The one exception: **L1 is always a free +10%** (1.45/0.85 = 1.706× DPS for 1.55× cost; Archer L1 = 17.35 marginal DPS for 27g = 0.643/gold, the best purchase in the game, always).

**Chain collapses to a constant too.** Enemy spacing = `SPAWN_INTERVAL·speed` = 0.75s × 72 px/s × spd = 54 px (wave 1) to 81 px (wave 12) — always under Storm's 90 px chain radius, so a 2-target chain is near-guaranteed in every wave: 60·1.6·0.6/100 = **0.576/gold, beating every fresh purchase, in every wave**. It's not situational; it's just the new constant. (And a code bug caps it: `hitEnemy` returns on kill *before* the chain block, line 1121 — killing blows never chain.)

**No player-facing state exists to react to.** `WAVE_DEFS` is a fixed 12-row table; the path (`buildPath`) is fixed; bounty `floor(12 + maxHp/16)` is fixed. The optimal policy is therefore **open-loop**: one build script ("Frost at a corner, Storm + L1s, Dragon over the slow zone late") solves every run identically, forever. Wave number is not state the player influences — it's a clock.

**The role's four checks:** (1) optimal choice depends on player state — **fail**, see above. (2) Price from own costs — pass (`12 + hp/16` derives from enemy HP). (3) Necessary + unboundedly purchasable — soft fail: cumulative income by wave 12 is ~5,700g (sum of bounties + `35+wave·10` clear bonuses) against a required sustained ~500 DPS for wave 12's 17,400 HP over ~35s; the economy is overprovisioned several-fold and board space never binds in 12 waves (estimate — the balance harness must confirm). (4) Death spiral — pass; leaks forfeit bounty but the clear bonus pays regardless.

**Bonus defect:** `recordRunEnd` score = `kills·10 + wave·50 + gold` — unspent gold scores, so score-optimal play is to *under-build and hoard*. The scoreboard rewards not playing.

## 4. The pressure curve — honestly stated
Total content: 224 enemies × 0.75s spawn + 11×5s gaps + 6s prep ≈ **7–8 minutes at 1x, ~3 at 3x**. Minute 5 ≈ waves 8–10, where HP scaling (200→300 HP, bounty falling from 0.25 to 0.10 g/HP) is the run's only pinch — and a mild one. **Hour 1 does not exist**: wave 12 → `showGameOver(true)`, "🏆 VICTORY!", no endless mode, nothing after. Hour 10 is replaying an identical deterministic puzzle whose solution you already have. There is no mechanism at any of the three checkpoints beyond "HP numbers get bigger."

## 5. The scarce resource
Gold, nominally — genuinely scarce only for the 240g opener and waves 1–4. By mid-game income outruns useful spending; lives are effectively abundant (20, leaks cost 1 flat); space never binds. Venom is strictly dominated (flat `DOT_DAMAGE=5` per 0.5s, unscaled by level, refreshes instead of stacking — a dead shop slot), Frost's slow doesn't stack (constant 0.45×), and selling at 0.6× is never correct on a fixed path — so roughly a third of the shop is decoration.

---

## VERDICT: **SOLVED/CONSTANT — stop.**
The overhaul may not proceed on the existing loop. The optimal policy is a fixed build script independent of anything the player did last run or this run. **Minimal design change that fixes it:** per-wave enemy *resistance types* (e.g., pierce/blast/arcane, ~60% damage reduction) assigned with randomness and **previewed during the 5s `WAVE_GAP`** — this alone makes the DPS/gold ranking flip wave-to-wave and forces a read-and-react purchase decision every gap. Everything else below supports that.

### Prioritised changes (defects first)
1. **Randomized, previewed wave composition with resistances** — kills the open-loop script; lives in `WAVE_DEFS`/`startWave`/`hitEnemy`.
2. **Rebalance DPS/gold so each tower owns a niche under the resist system**; Venom's dot must scale with `towerStats(t).dmg` and stack or it gets cut. `hitEnemy`/`update`.
3. **Chain-on-kill bug:** move the chain block before the `hp<=0` early-return in `hitEnemy` (line 1121) — Storm currently never chains off a killing blow.
4. **Leak cost by enemy type** (boss 3–5 lives) in the path-end branch of `update` (line 998) — restores the failure state.
5. **Score formula:** drop the raw `gold` term in `recordRunEnd` (or count invested gold) — stop rewarding hoarding.
6. **Upgrade curve:** replace the flat 0.993-efficiency ladder with branching L2+ specializations (range/damage/effect) so upgrade-vs-new is a real choice. `towerStats`/`upgradeCost`.
7. **Endless mode after wave 12** with an explicit scaling formula — 7 minutes of content cannot anchor an overhaul.
8. **Modular layout** (`index.html` + `js/sim.js`/`ui.js`/`content.js`/`fx.js`) per vault rule 3 — binding on any major overhaul regardless.

Per vault rule 2, the §3 economy-overprovisioning estimate and any rebalanced numbers must be verified by the `balance-scientist` harness before Squad 1 starts.

---

## Overhaul status (updated by the integrator, 2026-08-01)

- **Accepted direction:** change #1 (randomized, previewed wave resistances) approved by Gonzo; it is the design gate for Squad 1. Changes #2–#7 land with the build squad because they invalidate current balance. Change #8 (modular layout) is DONE — this directory is the split.
- **Already fixed pre-build (blocker tier, commit f5fa906):** pause/alt-tab soft-lock, chain-on-kill bug (#3), victory sfx, post-victory rAF leak.
- **Deferred with reasons, per integration rules:** score-formula gold term, per-type leak costs, upgrade branching, endless mode — do not half-apply; they ship with the rebalance.
- **For the build squad:** balance harness (vault rule 2) must verify the §3 economy-overprovision estimate before any rebalanced numbers are trusted. The Google Fonts CDN link in index.html violates the no-CDN rule and should be vendored during the art pass (also true of Chop Shop Circuit's Babylon CDN scripts, noted for a separate cleanup).

See PRODUCER.md for the commercial read, cost model, and the INVEST verdict this plan executes.

## 75% checkpoint (Build) — reached 2026-08-01

Squad 1 delivered all four files against CONTRACT.md; integrator reconciled and
verified with the 28-check smoke suite (28/28): resist system live (7 profiles,
randomized + previewed), rebalanced tower classes, branching upgrades, endless
mode, settings, save schema v2 with v1 migration, fonts vendored (no CDN).
Known integration notes: ui hardcodes its overlay copy — STR_* consts in
content.js are partially unused; consolidate to one copy source in the 100%
content/qa pass. BALANCE IS UNVERIFIED — the harness (rule 2) runs at 100%.
