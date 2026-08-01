# Producer Read — Grimoire Siege (Squad 0 Greenlight)

**File:** `/home/gonzobonzob/projects/my-games/grimoire-siege.html` (1,836 lines, single file)
**Card:** `/home/gonzobonzob/projects/my-games/index.html` lines 210–218, `✓ Complete`, `data-tags="td"`

## 1. The one-line pitch

A 15-minute, one-map fantasy tower defense with ten elemental towers and twelve waves, wrapped in the best visual polish per line of code in the vault.

That pitch is honest, and it exposes the problem: "15-minute" and "one-map" are load-bearing words.

## 2. Who buys this

Vault currency is attention and return visits. The audience is the **coffee-break TD player** — someone who played Kingdom Rush or Bloons on a phone, wants one clean run in a browser tab with no install and no account, and will come back if there's a run they haven't beaten yet. They also play CoolMath-style web games and free itch.io HTML5 TDs. They are *not* the Bloons TD 6 grinder — that player needs meta-progression this game doesn't have. Right now the return-visit hook is a high score and a best-wave counter, which buys maybe two visits.

## 3. Comparables

Verified via web search, not memory:

| Game | Price | Reception | Relevant lesson |
|---|---|---|---|
| Kingdom Rush – Tower Defense (Steam) | $9.99 | 96% positive (~4.6K reviews), Overwhelmingly Positive | Praise centers on content-per-dollar, hero variety, continued dev support — i.e., *content volume*, exactly what Grimoire lacks |
| Bloons TD 6 (Steam) | $13.99 | 97% positive (~347K reviews) | Praised for "uncounted hours" — the genre's paying customers buy depth and replay systems, not a fixed 12-wave arc |
| Infinitode 2 (Steam) | **Free** | 91% positive (~4K reviews) | The direct threat: a free, minimalist-art TD praised for upgrade trees, map editor, ranked/dailies. This is the bar for "free TD people return to" |
| Free HTML5 TDs on itch.io (e.g., entries advertising "16 towers, 30+ fusions, infinite waves") | Free | Crowded field, hundreds of entries | Grimoire's current spec (10 towers, 12 waves, 1 map) is *below the median store blurb* of its free competition |

The blunt read: in the free browser TD market, Grimoire's polish is above average and its content is below average.

## 4. The hook

"Ten schools of magic, one road, twelve waves of darkness — hold the crystal or watch it shatter." The current card copy is close to this already and, unusually for this vault, it is *true*.

## 5. Distance to sellable (vault bar first, itch.io second)

**Card audit — every claim verified against code. The card is accurate.** 10 tower types: `TOWERS` array lines 153–164 matches all ten names verbatim (Archer…Dragon). 12 waves: `WAVE_DEFS` lines 169–174, bosses on waves 3/6/9/11/12, fast enemies on 5/8. Sell/upgrade mid-battle: lines 682–710 (3 upgrade levels, sell at 60% of invested). High score tracking: versioned `grimoireSiege_save_v1` with `bestWave`/`highScore`. No shipped lie here — worth noting because it's the exception in this portfolio.

**Vault required-structure checklist:**

- Main menu: New ✓, Continue ✓ (real checkpoint restore, resolution-independent tower coords with a legacy-pixel migration path — genuinely good), **Settings ✗ — missing entirely**.
- Pause overlay: ✓ Esc → Resume / Save & Main Menu / Main Menu (No Save). Compliant.
- Autosave: ✓ 30s interval + wave-boundary saves + `visibilitychange` + `pagehide`, all try/catch-wrapped, versioned key with schema field. This is flagship-grade save hygiene.
- Interval hygiene: **passes**. Only 2 `setInterval` sites (autosave line 498, spawn line 735); both handles stored and cleared; return-to-menu is `location.reload()`, which cannot leak. The three-games bug is not here.
- Controller: absent. Ruling: TD is pointer-driven, not a direct-control action game — **not required** by the CLAUDE.md rule. Keyboard already has 1–0 tower hotkeys and Esc.
- Offline catch-up: n/a, no passive accrual. Correctly exempt.
- Genre uniqueness: **confirmed the only TD in the vault** — sole card with `data-tags="td"`; Veil Legends is arena horde-survival, nothing else is close. Uniqueness favors keeping.

**Defects found in read (the gap list, ordered by cost):**

1. **CRITICAL, cheap to fix — pause soft-lock.** `startWave()` (line 719) opens with `if(paused||!gameStarted)return;` but is scheduled via *untracked* `setTimeout` (lines 494, 1111). Pause during the 6s prep or any 5s wave gap and the pending `startWave` fires into the guard and is swallowed; nothing reschedules it. The run wedges forever. Worse: the `visibilitychange` handler (line 383) *auto-pauses on tab switch*, so alt-tabbing during a wave gap — completely normal behavior — wedges the run. This alone invalidates "✓ Complete" and confirms the playtesting-requirement rule: a full live playthrough with one alt-tab would have caught it.
2. Cheap: victory plays the *defeat* sound — `showGameOver()` calls `sfx('lose')` unconditionally (line 1822).
3. Cheap: lightning chain never procs on a killing blow — `hitEnemy()` returns on kill (line 1121) before the chain block, so the Storm tower underperforms exactly when it's clearing.
4. Cheap: after victory the rAF loop keeps running behind the overlay (`lives>0`), burning CPU.
5. **Medium, design-gate — probable solved loop.** DPS-per-gold: Archer = 0.50, Cannon = 0.42 (+AoE), Arcane = 0.36, Dragon = 0.27 (+AoE); upgrades are exactly DPS-neutral per gold (L3 Archer: 106.8 DPS for 215g invested = 0.50). Unless AoE value on later waves is proven to carry the expensive towers, "spam Archers + two Frosts" may be near-optimal play forever — the precise Purr & Power failure mode rule 1 exists for. This is design-architect's call to prove or refute *before* any build tokens are spent. [Design-architect verdict: CONFIRMED — solved/constant.]
6. Medium: no Settings, no targeting-priority options, no next-wave preview, no difficulty modes.
7. **Expensive: content volume and day-3 reason.** One map, one fixed path, three enemy kinds, 12 waves ≈ 15 minutes, then nothing but a score. Every successful comparable above wins on exactly this axis. Needs: multiple maps, endless mode, enemy armor/resistance types that force tower diversity (which also fixes #5), and some between-run progression.
8. Expensive-ish: audio is *not* silent (6 procedural WebAudio sfx — better than most of the vault) but has no music and no volume control (ties to missing Settings).

**Honest itch.io read:** as a free browser game it could sit on itch.io today and collect modest plays on the strength of its looks. It could never charge money against a free Infinitode 2 without the expensive tier above, and probably not even then. Treat itch.io as free distribution, not revenue.

## 6. Production cost estimate

- **This greenlight (Squad 0, 2 agents — the requested 25%):** ~100–150K tokens (producer + design-architect). [Actual: ~155K.]
- **Remaining 75%, priced separately:**
  - **Mandatory modularisation first** (binding rule 3): split into `index.html` + `js/sim.js` + `js/ui.js` + `js/content.js` + `js/fx.js`. The file's internal sections map cleanly (sim: waves/update/economy ~400 lines; fx: the `draw*` block ~600 lines; content: `TOWERS`/`WAVE_DEFS`/tuning; ui: HUD/panels/splash). One integrator, serial, ~80–120K tokens — and it must land *before* Squad 1 or the build goes serial like Purr & Power's ~90-edit bottleneck.
  - Squad 1 build (4 agents, one file each): ~250–300K.
  - Squad 2 harden (4 read-only agents ~200–250K, per the measured 470K/5-agent baseline scaled down for a smaller, now-modular file) + integration ~40–60K (cheap *because* modular).
  - Squad 3 ship: ~30–50K.
  - **Remaining total ≈ 600–780K; whole overhaul ≈ 700–900K** — top of the overhaul-preset band, the overage being the modularisation the rules mandate. A balance harness (rule 2) is required and is included in the Squad 1/2 numbers.

Is the return there? This is the best single-file codebase in the vault getting overhauled anyway-priced work, in a genre slot nothing else occupies. Yes — with the condition below.

## 7. Scope verdict: **INVEST**

Defended: this is the rare vault game where the card is honest, the save system already exceeds the flagship bar, interval hygiene is clean, and the visual polish is genuinely strong — the foundation deserves the spend, and it holds the vault's only TD slot. But it is **not** "✓ Complete": the alt-tab wave-gap soft-lock is a shipped run-killer, there is no Settings menu, and 15 minutes of content with a possibly-solved build order does not exceed Purr & Power / Freight Dominion on depth — it doesn't currently *reach* them. Flip the card to `status-wip` now.

**Two hard conditions on the greenlight:** (1) design-architect must prove tower choice is non-constant across waves — [returned: it is constant; the resistance-system design change is therefore mandatory before Squad 1]; (2) the overhaul's content budget goes to *depth* (maps, enemy resistances, endless mode, difficulty tiers) — not an eleventh tower.
