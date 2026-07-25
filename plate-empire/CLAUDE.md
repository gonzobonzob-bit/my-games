# Plate Empire — Project Guide

Restaurant / hospitality **tycoon** game. PC-first (mobile is secondary, not the
primary driver). Lives in the `my-games` repo as a self-contained game and is
served via GitHub Pages.

> **Global build standards** live in `my-games/CLAUDE.md` — that file is the
> source of truth for cross-vault conventions (self-contained files, no
> external CDN/API deps, autosave/pause/interval hygiene, naming, etc.). This
> file covers only what's specific to Plate Empire.

## Layout
```
plate-empire/
  index.html            # the whole game — inline CSS + JS, organized in sections
  assets/                # baked static art (NO live generation at runtime)
    backdrop*.png         # 5 isometric establishing-shot backdrops, one per tier (Firefly)
    dish-*.png             # 25 menu dish icons, 5 per tier (Firefly)
    *.svg.placeholder     # original hand-built SVG placeholders (kept for reference)
  CLAUDE.md              # this file
```
`index.html` is a single self-contained file (inline CSS/JS). Code is split into
clearly labelled **internal sections**, not separate files. CSS sections 1–8;
JS sections A–K (see in-file comments):
`A. Config  B. State  C. Boot  D. Views  E. Staff/Upgrades  F. Tickets
G. Economy  H. Loop  I. UI  J. SFX  K. Wire`.

## Current shipped scope (accurate as of this pass)

The game is **feature-complete across all five tiers**, not just the
food-truck tier the earlier design brief covered. Actual content:

- **5 tiers**, each with its own backdrop, location name, dish set, day
  length, and rail capacity: Food Truck (El Paso Food Truck) → Diner
  (Gonzo's Diner) → Bistro (Mesa Bistro) → Fine Dining (Estrella Fine
  Dining) → Resort (The Grand Plata Resort). Tier progression is gated by
  reputation + cash thresholds (`TIERS[].unlockRep` / `unlockCash`) and
  confirmed through a "Tier Upgrade" overlay, not automatic.
- **25 dishes**, 5 per tier (`ALL_DISHES`), each with its own price,
  reputation value, ticket lifetime, and cook time.
- **11 hireable staff** (`ALL_STAFF`), 2–3 unlocked per tier, each granting
  one or more of: ticket-timer bonus (`ticketBonus`), auto-serve on a
  per-staff timer (`autoServe`), or extra simultaneous rail capacity
  (`railBonus`). Effects from multiple hired staff (and from equipment
  upgrades that share the same bonus keys) are summed via `staffBonus(key)`,
  not overwritten — see "Staff/upgrade stacking" below.
- **8 equipment upgrades** (`UPGRADES`): ticket-timer bonuses, rail-capacity
  bonuses, flat reputation-per-serve bonuses, and a tip-rate multiplier.
  One-time purchases, tier-independent.
- **4 random daily events** (`EVENTS`: Lunch Rush, Food Critic Visit, Rainy
  Day, Street Festival), ~30% chance per day starting day 2, each applying a
  temporary modifier for that day only (pace, rep multiplier, tip
  multiplier, or rail-capacity bonus).
- **15 achievements** (`ACHIEVEMENTS`) tracking serve counts, streaks, cash
  milestones, reputation, tier progress, and days survived.
- **5 reputation milestones** (`REP_MILESTONES`, Unknown → Legendary) shown
  in the Community panel alongside best-day personal records.
- A live **restaurant floor view** (`#floor`) with per-tier table layouts,
  animated customer SVG sprites that walk to a table, show an order bubble,
  and react to being served or missed, plus staff sprites positioned along
  the wall. This exceeds the original "atmospheric backdrop only, no
  clickable tables" v1 brief — the floor is now interactive (clicking a
  customer sprite fulfills their ticket, same as clicking the ticket itself).
- Ticket lifecycle now has a **cook phase**: clicking a ticket starts
  cooking (dish-specific `cookTime`), then auto-completes and pays out —
  it's no longer an instant click-to-cash action.
- Full **day cycle**: countdown timer, day-summary overlay (with a "Perfect
  Service" bonus for a zero-miss day), staff salaries deducted at day end,
  finance history retained (last 30 days), then a new day (with a fresh
  event roll) starts on confirmation.
- **Game over** at 0 reputation; **victory** overlay on reaching the Resort
  tier (can keep playing afterward — victory only shows once per save via
  `victoryShown`).
- A short **tutorial** overlay for first-time players (`TUTORIAL_STEPS`),
  shown once per save (`tutDone`).
- All five sidebar panels are wired: Restaurant (floor), Overview, Menu,
  Staff, Finance, Community. There are no remaining "Coming soon" stubs.

If you're picking this project back up, treat the above as ground truth over
any older design-brief language — check `index.html` directly before trusting
a stale summary, including this one, since the game continues to evolve.

### Visual identity (use exactly)
Charcoal / brass **kitchen-ticket** look for all UI chrome.

| Token | Value | Use |
|------|-------|-----|
| `--bg` | `#1C1A18` | app background |
| `--panel` | `#262320` | panel surface |
| `--brass` | `#C08A3E` | primary accent |
| `--cream` | `#EFE6D8` | ticket cream / text on dark |
| `--sage` | `#6B8E5A` | success |
| `--alert` | `#B5453A` | miss / danger |

Fonts: **Big Shoulders Display** (condensed bold display) · **Inter** (body) ·
**IBM Plex Mono** (data / ticket). The backdrop reads warm / cinematic and
harmonizes with the palette. Each tier beyond Food Truck also gets its own
backdrop tint gradient layered behind its image (see `#backdrop.tier-N` in
CSS section 3).

Known deviation from the vault's "no external CDN deps" rule: `index.html`
still pulls these three fonts from `fonts.googleapis.com` / `fonts.gstatic.com`
at runtime (see the `<link>` tags in `<head>`). This is a pre-existing,
vault-wide pattern shared with at least one other flagship game (Purr & Power
Co.), not something introduced here — flagged for a future pass to vendor the
font files locally across the affected games together, rather than fixing it
inconsistently in just one.

## Staff/upgrade stacking (verified this pass)

Confirmed by tracing the code: hiring multiple staff, and owning multiple
upgrades, that share a bonus key (`ticketBonus`, `railBonus`) **sum
correctly** and do not overwrite each other. `staffBonus(key)` reduces over
both `S.staff` and `S.upgrades` and adds every matching bonus together; it's
called fresh at each `spawnTicket()` for `ticketBonus`/`railBonus`, so newly
hired staff affect tickets spawned after the hire. `autoServe` isn't summed
into a rate — each staff member with `autoServe` gets its own independent
accumulator (`RT.staffAcc[staffId]`) in the tick loop, so N staff with
auto-serve each complete a ticket on their own cadence rather than one
shared/overwritten timer. No fix was needed here; this section exists so a
future pass doesn't have to re-derive it from scratch.

## Save system

- Save keys: `plate-empire-slot-0` through `plate-empire-slot-2` (3 slots,
  `SAVE_SLOTS`/`SAVE_PREFIX`).
- Autosave every 30s (`AUTOSAVE_MS`) while a session is running, plus
  save-on-important-transitions (day end, tier upgrade, achievement unlock,
  manual Save button, pause-menu exit, `visibilitychange`→hidden). All
  `localStorage` reads/writes are wrapped in try/catch (`save()`,
  `loadSlot()`) — a blocked or corrupt store degrades to "no save found"
  rather than crashing.
- **Legacy migration:** an older, pre-tier single-key save
  (`plate-empire-save-v2`) is migrated into slot 0 the first time the main
  menu renders, if slot 0 is still empty (`renderSaveSlots()`). `continueGame()`
  merges any loaded save over `defaultState()` (so fields the old schema
  never had — `tier`, `staff`, `upgrades`, `achievements`, `finances`,
  `bestDay`, `dayMsLeft`, etc. — fill in with sane defaults) and then
  normalizes types/ranges defensively (arrays coerced, `tier` clamped into
  `TIERS` range, unknown staff/upgrade ids dropped, `rep`/`cash`/`day`
  sanity-checked). Verified this pass: the v2→slot-0 path round-trips
  correctly even though the state shape has grown substantially since v2 was
  the only format. `deleteSlot(n)` only removes the slot it's asked to
  remove — it used to also unconditionally delete the legacy
  `plate-empire-save-v2` key on *any* slot deletion (dead/misleading code
  left over from an earlier migration approach); that's been removed since
  migration cleanup is already handled correctly in `renderSaveSlots()`.

## Build standards (every game)
- **Main menu:** New Game / Continue / Settings.
- **Autosave** every 30s to `localStorage` **and** a manual Save button, all
  wrapped in `try/catch` (storage may be blocked).
- **Pause overlay** reachable any time (button + `Esc`): Resume / Save / Main Menu.
- Single self-contained `index.html`; registered as a card in `my-games/index.html`.

## Localization

**English-only.** This is not blocked on anything — a Spanish pass is a
possible future option if there's ever demand, not a planned/committed
scope item. No open decision is pending here; nothing to resolve before
further work on this game.

## Art pipeline
- Two asset types: (1) 5 isometric establishing-shot backdrops, one per tier;
  (2) 25 flat dish icons (UI icons, need not match the iso angle), 5 per tier.
- **MANDATE:** generate with Adobe's **commercially-friendly / licensed**
  generative model only — never an experimental / non-commercial model. If that
  option is not selectable, **stop and ask** — do not guess.
- **Current state:** all tiers' assets are Firefly-generated PNGs (retrieved
  via `asset_search` with `entityScope: GenAIAsset`). The original hand-built
  SVG placeholders for the food-truck-tier assets are kept as
  `*.svg.placeholder` files for reference; customer/staff sprites on the
  restaurant floor are generated inline as parametric SVG (`buildCustSVG`,
  `buildStaffSVG`), not baked images.
- Never call generation APIs live during gameplay — all baked art is static
  files loaded from `assets/`.

## Working rules
- Additive commits of new work can be pushed without extra confirmation so the
  build goes live on GitHub Pages.
- Do **not** rewrite / restructure **existing** files (other games, root
  `index.html`, `manifest.json`) without confirming first.
