# Plate Empire — Project Guide

Restaurant / hospitality **tycoon** game. PC-first (mobile is secondary, not the
primary driver). Lives in the `my-games` repo as a self-contained game and is
served via GitHub Pages.

> **Global build standards:** No central standards file was found in this repo as
> of this writing. The cross-game "every game standard" rules are captured in the
> [Build standards](#build-standards-every-game) section below; if/when a global
> doc is added (suggested location: `my-games/CLAUDE.md` or `my-games/STANDARDS.md`),
> point this reference at it and treat that file as the source of truth.

## Layout
```
plate-empire/
  index.html            # the whole game — inline CSS + JS, organized in sections
  assets/               # baked static art (NO live generation at runtime)
    backdrop.svg        # isometric establishing-shot (food-truck scene)
    dish-*.svg          # 5 menu dish icons
  CLAUDE.md             # this file
```
`index.html` is a single self-contained file (inline CSS/JS) to match the existing
`my-games` index-card convention. Code is split into clearly labelled **internal
sections**, not separate files. CSS sections 1–8; JS sections A–I (see comments).

## Design brief (v1 — food-truck tier)

**Scope this pass:** food-truck tier ONLY. Do **not** build diner / bistro /
fine-dining / resort tiers yet.

- **Viewport:** isometric / 2.5D **atmospheric backdrop only** — one static
  establishing-shot image as a backdrop layer. NOT a tile-based sim floor. No
  staff sprites, no pathing, no clickable tables. All gameplay happens in UI
  panels layered over/beside the backdrop.
- **PC sim aesthetic:** persistent left sidebar nav, data-rich overlay panels —
  not a mobile card stack. Sidebar: **Overview, Menu, Staff, Finance, Community**.
  Only **Overview** (and Menu, read-only) are wired this pass; Staff / Finance /
  Community are "Coming soon" stubs.
- **Signature mechanic:** animated **order-ticket rail** across the top. Tickets
  slide in requesting a dish + countdown timer. Click before expiry → +cash,
  +small reputation. Expiry → miss (−reputation).
- **Core loop:** cash, reputation (0–100), day counter, 3–5 hardcoded dishes,
  tickets spawn on an interval. Day is a timed service period; closing a day
  rolls a summary and autosaves.

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
harmonizes with the palette.

## Build standards (every game)
- **Main menu:** New Game / Continue / Settings.
- **Autosave** every 30s to `localStorage` **and** a manual Save button, all
  wrapped in `try/catch` (storage may be blocked).
- **Pause overlay** reachable any time (button + `Esc`): Resume / Save / Main Menu.
- Single self-contained `index.html`; registered as a card in `my-games/index.html`.

Save key: `plate-empire-save-v1`.

## Localization
**English-only** for now. Do NOT add Spanish text. A Spanish pass is deferred to
final draft and must be **confirmed before** starting.

## Art pipeline (IMPORTANT)
- Two asset types: (1) ONE isometric establishing-shot backdrop; (2) 3–5 flat
  dish icons (UI icons, need not match the iso angle).
- **MANDATE:** generate with Adobe's **commercially-friendly / licensed**
  generative model only — never an experimental / non-commercial model. If that
  option is not selectable, **stop and ask** — do not guess.
- **Current state:** the connected Adobe MCP exposes only image-*editing* tools
  (adjust / blur / mask / vectorize / stock-license), with no text-to-image
  generator offering model selection. Per the mandate, the v1 assets in `/assets`
  are **hand-built SVG placeholders** standing in for the real commercial render.
  Replacing them is purely additive — drop new files into `/assets` and keep the
  same filenames (or update the `DISHES[].icon` paths and `#backdrop` URL).
- Never call generation APIs live during gameplay — all art is baked static files.

## Stop condition (this pass)
Food-truck loop playable end-to-end (menu, tickets, save/autosave, pause/menu,
backdrop visible behind UI, dish icons baked in) → **stop and report for review**
before: next tier, wiring other sidebar panels, or a live sim floor.

## Working rules
- Additive commits of new work can be pushed without extra confirmation so the
  build goes live on GitHub Pages.
- Do **not** rewrite / restructure **existing** files (other games, root
  `index.html`, `manifest.json`) without confirming first.
