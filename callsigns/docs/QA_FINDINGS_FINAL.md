# Callsigns — adversarial QA, final hardening pass

Branch: `callsigns-rivals-build`. Date: 2026-08-14.
Method: real game in headless Chrome (CDP over node's native `WebSocket`), served over
`http://127.0.0.1`, driven through the actual DOM. `Runtime.exceptionThrown`,
`Runtime.consoleAPICalled` and `Log.entryAdded` were captured for every step.
No file in `js/`, `tests/` or `index.html` was modified.

Scripts (scratchpad, not committed):
`/tmp/claude-1000/-home-gonzobonzob/17830830-b93e-4590-92e2-09628e73938d/scratchpad/qa9231/`
— `drv.mjs` (driver), `t1_saves.mjs` (57 hostile saves), `t2_exploit.mjs` (17 exploits),
`t3_session.mjs` (800 driven days + timing + responsive), `t4_repro.mjs`, `t5_ui_repro.mjs`
(pure-UI blocker repro), `t6_final.mjs`, `t7_misc.mjs`, `t8_quota.mjs`, `t9_mint.mjs`.

**Confirmed distinct issues: 5** — 1 blocker, 0 exploits, 2 minor, 2 informational.
Every one below was reproduced in a running browser. Nothing here is a static-read opinion.

---

## BLOCKER 1 — Every engineer assignment in the empire is destroyed on every save/load

**Severity: blocker.** This silently deletes DESIGN.md mechanic 3 (engineer assignment)
for any player who reloads, closes the tab, or lets the 30-second autosave + Continue
cycle happen — i.e. all of them. The engineers stay on payroll and keep costing money.

### Where

`js/sim.js:1763-1767`, in `readStation()`:

```js
    st.schedule[p.id] = {
      show: SHOWS[readStr(src, 'show', '')] ? src.show : base[p.id].show,
      djs,
      eng: readStr(src, 'eng', null)      // <- never reads src.engs
    };
```

`migrate()` (v >= 3 branch, `js/sim.js:1690`) funnels every modern save through
`readStation()`, which rebuilds each slot from a fixed field list and **has no `engs`
case**. The v4 `slot.engs` array is dropped on the floor. `sanitize()` then reads
`src.engs || src.eng` off `readStation()`'s output (`js/sim.js:1930-1932`) — but by then
`engs` is already gone and `eng` is `null`, so it produces `engs: []`.

DJs survive because `readStation()` *does* copy `src.djs` (line 1758). Engineers do not.

### Reproduction (100% real UI, no API pokes) — `t5_ui_repro.mjs`

1. New Game → callsign `KREP`.
2. Staff tab → hire the first engineer candidate with its own Hire button (day 7).
3. Empire tab → click the coverage cell `KQAA / Morning Drive` → slot editor opens.
4. Click the engineer's row in the Engineer section (`[data-seteng="<id>"]`).
5. Pause menu (`☰`) → **Save**.
6. Reload the tab → **Continue**.

Measured:

```
2) assigned via coverage cell -> slot editor:
   {"who":"p2voj065","slotNow":{"show":"music","djs":[],"engs":["p2voj065"]}}
3) written to localStorage by the Save button:
   {"show":"music","djs":[],"engs":["p2voj065"]}       <- the save is CORRECT
4) after reload + Continue:
   {"slot":{"show":"music","djs":[],"engs":[]},"engIds":[],
    "uncovered":4,"stillOnPayroll":1,"payroll":56}     <- the LOAD drops it
```

The engineer is written to disk correctly and thrown away by the reader. The
Empire Coverage grid goes from 1 covered slot to **4/4 exposed** while the engineer is
still drawing $56/day.

### Confirmed on the autosave path too (`t4_repro.mjs`)

`saveGame(true)` — literally what the 30s autosave timer, `hirePerson()`, `buyGear()`,
`doFoundStation()`, `trainPerson()`, `pagehide` and `beforeunload` all call:

```
written  : {"show":"talk","djs":[],"engs":["pj1yrjk5"]}
migrate(): {"show":"talk","djs":[],"engs":[]}
```

### The regression direction (this is the tell)

A **v3-shaped** save (`slot.eng` as a string, no `engs`) round-trips *fine* —
`readStation()` reads exactly the one field v3 had:

```
REPRO-1c  v3 save (slot.eng) DOES survive :: {"v3morning":["pj1yrjk5"]}
```

So old saves keep their engineer and every save the current build writes loses it.
v4 added `slot.engs` and `readStation()` was never updated alongside `sanitize()`.

### Measured consequence (`t6_final.mjs`)

With a skill-7 engineer on each daypart vs. after one reload:

```
slotRisk morning : 0.0316  ->  0.0600     (x1.90 fault risk)
slotRisk night   : 0.0462  ->  0.0600
payroll still charged: $302/day for engineers covering nothing
```

The player pays full engineer salary, sees "nobody was on the desk" fault toasts, and
has no way to tell that the game unassigned them — the assignment simply is not there
when they come back.

### Why the existing suite misses it

`tests/smoke.mjs` asserts the *shape* (`engs[]` not `dj`, line 246) and asserts
cross-station uniqueness (line 342), and `tests/harness.mjs` assigns engineers in-memory
(line 215-222). Nothing in either suite writes a save with an engineer assigned and reads
it back. A regression test would be: assign → `saveGame` → `migrate(JSON.parse(...))` →
assert `engs.length === 1`.

### Suspected fix

One line in `readStation()` — mirror the `djs` handling:

```js
engs: (src && Array.isArray(src.engs)) ? src.engs.filter(x => typeof x === 'string').slice(0, MAX_ENG)
      : (readStr(src, 'eng', null) ? [readStr(src, 'eng', null)] : []),
```

`sanitize()`'s existing `rawEngs` branch already handles both shapes correctly once the
data reaches it.

---

## MINOR 2 — A save from a newer build leaves Continue permanently dead, and never wipes

**Severity: minor** (recoverable via New Game / Delete save) **but it is exactly the
class `hasSave()`'s own comment says it exists to prevent**: *"a corrupt entry enabling
Continue forever with no way to clear it."*

### Where

- `js/sim.js:1626` — `if (v > STATE_VER) return null;` (correct, deliberate).
- `js/sim.js:1978-1983` — `hasSave()` only checks `day` is finite and a callsign exists.
  It does **not** check the version, so it keeps returning `true`.
- `js/ui.js:2361-2363` — `if (!s) { toast(t('loadFail'), 'bad'); refreshMenu(); return; }`
  — toasts and re-renders, but never `wipeSave()`.

Net: `refreshMenu()` re-enables the button on every pass, and the label even advertises
the unreachable run.

### Reproduction — `t4_repro.mjs` REPRO-2 / REPRO-3

1. Play any game, save.
2. In DevTools: `const r = JSON.parse(localStorage['callsigns.save']); r.v = 99;
   localStorage['callsigns.save'] = JSON.stringify(r);`
3. Reload.

```
Continue label   : "Continue · KREP · Day 123"   (enabled)
click 1/2/3      : onGame=false, S=null, toast "No save found.",
                   save NOT wiped, button still enabled
hasSave()        : true
```

Matrix over versions:

```
v99 : continueEnabled=true , loadGame()=null    <- brick
v6  : continueEnabled=true , loadGame()=null    <- brick
v5  : continueEnabled=true , loadGame()=state   <- ok
```

### What should happen

Either `hasSave()` reads `v` and returns false past `STATE_VER` (so Continue greys out
and the menu says "no save"), or the failed-load branch in `ui.js` calls `wipeSave()` the
way the `s.dead || s.cash <= BANKRUPTCY_FLOOR` branch two lines below it already does.
The negative-cash and truncated-JSON cases are handled correctly today — this one is the
only hole left.

---

## MINOR 3 — `sanitize()` clamps `cash` but not `lastDay.net`, and `catchUp()` multiplies the unclamped one straight into cash

**Severity: minor** (hostile-save only; single-player, self-inflicted). Listed because
`sanitize()`'s docblock promises *"Clamps ranges, not just types"*, and this is the one
field the code's own comment identifies as deciding money.

### Where

- `js/sim.js:1843-1847` — `lastDay` is rebuilt from a key list with `n(ld[k], 0)`:
  type coercion only, no range clamp. (`cash` is clamped to `[-1e12, 1e15]` at line 1780.)
- `js/sim.js:2023-2029` — `catchUp()` does `delta = daily * days * rate` and `bookCash(delta)`
  *after* `sanitize()` has already run, so nothing re-clamps the result.

### Reproduction — `t9_mint.mjs`

Plant `lastDay.net = 1e300` and `lastTick = now - 1h` in the save, then press **Continue**:

```
{"cash": 4.8e+301, "finite": true, "day": 97,
 "sanitizeCashCeiling": 1e15, "afterRoundTrip": 1e15}
```

Live cash is 286 orders of magnitude past the documented ceiling. It does not crash, the
HUD does not render `NaN`/`Infinity` (money() handles it), and the next save/load
re-clamps to 1e15 — so this is a containment gap, not a break. Clamping `lastDay.net`
to something like `[-1e9, 1e9]` in `sanitize()` closes it.

---

## INFORMATIONAL 4 — `day` has no upper bound

`js/sim.js:1786` — `s.day = Math.max(1, Math.floor(n(s.day, 1)))`. A hand-edited
`day: 1e15` loads, plays, advances correctly (`1e15 -> 1e15+5` over 5 days) and renders
with no layout overflow (`t7_misc.mjs`). `foundedDay` and `nextHireDay` are both clamped
against it, so nothing downstream breaks. Cosmetic only; noted for completeness because
`day` is the one unbounded numeric in the state.

## INFORMATIONAL 5 — `S.active` is not re-clamped when `S.stations` shrinks under it

Only clamped inside `activeIndex()` / `stationAt()` and on the load path. If the stations
array shrinks in memory, `S.active` keeps pointing past the end and is written to the save
that way (`t4_repro.mjs` REPRO-4: `S.active = 2`, `S.stations.length = 1`, saved as `2`,
re-clamped to `0` on next load). **Unreachable in real play** — grep confirms no code path
removes a station outside `migrate()`/`sanitize()` — so this is not a bug today. It becomes
one the moment a "shut down a station" feature lands.

---

# What was attacked and found CLEAN

Everything below reproduced zero uncaught exceptions and zero console errors.

## Hostile and stale saves — 57 payloads, `t1_saves.mjs`

All 57 loaded without a crash, a blank screen, or free money (except the two issues above).

Version shapes: **v2** (top-level `call`/`freq`/`schedule`, `secondStation` → real
stations[1], day 40 / 2 stations preserved) · **v3** (`slot.eng` string, no `rivalNets`) ·
**v4** (`engs` array, no rival-capacity block — capacity re-seeded from segment opening
size) · **v5** · `v` missing · **v99** (issue 2).

Structure: truncated JSON (Continue correctly greys out) · `stations: []` · `stations: {}` ·
`schedule: null` · a single slot `null` · `staff: {}` · `staff: [null, null, {id:1}]` ·
`rivalNets` as an array · `log` with 10,000 entries · **10,000 stations** (truncated to 4,
no hang) · `{}` · `[1,2,3]` · `"hello"` · `null`.

Numbers: `cash: -999999` (below floor → save wiped, "no save" toast — correct) ·
`cash: 1e308` (clamped to 1e15) · `1e400` → `Infinity` (rejected, defaults to 800) ·
`NaN` literal (invalid JSON → Continue greys out) · `"800"` string (accepted as 800) ·
`day: -5` → 1 · `rep: 900` → 100 · `rep: null` → 5 · `listeners: -5000` → 0 ·
`buzz: 900` → 1.85 · `active: 99` / `-3` → clamped · `freq: 5000` → re-rolled legal ·
`tx: 99` / `ant: -4` → clamped to tier range · `nextHireDay: -1e9` → clamped ·
`opts.speed: 999` → 1 · `book` all `"xx"` → 0 · `lastTick: 0` and `lastTick: now+1e12`
(future stamp treated as "just now") · staff `skill: 999` → 10, `salary: -1e9` → 0.

Enum / referential: unknown segment `"klingon"` → `DEFAULT_SEGMENT` · `segment: null` ·
unknown role `"wizard"` → person dropped · DJ/eng ids pointing at nobody → scrubbed.

Cap violations planted in the save: **9 DJs in one slot** → truncated to `MAX_CREW` ·
**4 engineers in one slot** → truncated to `MAX_ENG=2` · **same engineer on two stations,
same daypart** → the second occurrence is dropped (the empire-wide rule is enforced on
load, as documented) · **5 stations** → truncated to 4.

Prototype pollution: `{"__proto__":{"polluted":true}, ...}` at the root and inside
`stations[0]` — `({}).polluted === undefined` after load. The `own()`/`readNum()`/`readStr()`
discipline holds.

## Exploits — 17 attacks, `t2_exploit.mjs`. No value-for-nothing found.

- **Found a 5th station through every path**: Empire tab seg card → "Review the commitment"
  → confirm, four times in a row → stations 1→2→3→4, then the founding card is gone from
  the pane entirely. `foundStation()` called 50 times directly → still 4.
- **Double-fire the found confirm**: clicked the same confirm node 10 times → exactly one
  station, exactly one $12,000 charge.
- **70 taps on the gear buy button**: tx 0→1, $1,400 charged once. No free tier, no
  over-upgrade past `TX.length-1`.
- **40 taps on one Hire button**: staff +1, candidates −1, one fee. No candidate cloning.
- **40 taps on Train**: skill capped at 10, cost charged per step.
- **Fire/rehire payroll dodge**: firing refunds $0; the fired person leaves `S.candidates`
  permanently, so there is no rehire loop. Hire fee is `salary * 8` up front.
- **Un-found a station**: no such path exists anywhere in the codebase (confirmed by grep
  + UI sweep), so there is no found/un-found refund loop.
- **One engineer on two stations, same daypart, driven through the slot editor UI**:
  assigning them to KQAA morning then to the second station's morning *moves* them and
  toasts the steal — it never duplicates. `s0=["E1"] → s0=[], s1=["E1"]`.
- **`addEngineer` five times on one slot**: stops at `MAX_ENG = 2`.
- **Modal on a deleted entity**: opened the slot editor on a DJ, deleted that DJ from
  `S.staff` + scrubbed schedules underneath the open modal, then clicked the now-stale
  `data-dropcrew` control. No throw, no ghost crew.
- **Modal on a deleted station**: opened the slot editor on station index 2, truncated
  `S.stations` to 1 underneath it, clicked every `data-setshow` / `data-addcrew` /
  `data-seteng` in the sheet. No throw.
- **Ledger identity over 200 simulated days**: `opening + revenue + events + offline −
  payroll − royalties − leases − capex === closing` — worst drift **0.00** on every day.
- **Offline farming**: `catchUp()` called 20 times with no elapsed time pays **$0**.
  With time, it is capped at `OFFLINE_MAX_DAYS = 96` days at `OFFLINE_RATE = 0.5`, pinned
  to `SPEEDS[1]` so setting 3x before closing the tab does not inflate it. Offline losses
  cannot punch below `BANKRUPTCY_FLOOR` (lands exactly at −4000).
- **XSS**: `<img src=x onerror="window.__PWNED=1">` planted into `staff[].name`,
  `candidates[].name`, `log[].msg` and `stations[0].call`, then every tab rendered plus
  the slot editor plus a toast. `window.__PWNED === 0`, the raw tag never reaches
  `innerHTML`. `esc()` covers every name/log site; toasts use `textContent`; callsigns are
  regex-stripped to `[A-Z]{0,4}` in `sanitize()`.
- **Save-scumming**: reloading the same save and simulating 5 days gives different results
  each time (`[50370, 50379, 50395, 50403, 50403]`) — events are re-rolled at tick time,
  which is inherent to any autosave game and matches the genre norm. Not filed as a defect.
- **Candidate scarcity (design gate)**: mean candidates/refresh is **2.55 at 1 station** and
  **2.375 at 4 stations** — throughput does not scale with the empire, as CONTRACT requires.

## Long sessions — `t3_session.mjs`, ~800 driven days total

- **400 days, honest bot, real `tick()`**: hires via the Staff tab button, keeps dayparts
  staffed, buys gear, opens/closes the slot editor, churns tabs and stations every day.
  Zero uncaught exceptions. (It goes bankrupt around day 180-290 without ever reaching the
  expansion unlock — that is the known economy failure, another agent's lane, not filed here.)
- **400 days, solvent 4-station empire** (cash floored so balance is not the variable):
  reached day 401 alive, 4 stations, 20 staff, 6,467 listeners, **210 fault days**, every
  stat finite, **zero uncaught exceptions**.
- **Rival capacity (v5) verified live, not inert**: asserted the rows *exist* first —
  15/15 (segment × network) rows present, **15/15 actually moved** away from their opening
  value during play, and all 15 stayed inside `RIVAL_K_MIN..MAX`. Forced to both rails:
  400 ticks at share 1.0 pins every network at exactly `open × 0.30`; 400 ticks at share
  0.0 pins them at exactly `open × 2.20`. `marketShare()` stays finite at both clamps.

## Boundaries — `t3_session.mjs` / `t7_misc.mjs`

Zero of everything (no staff, no candidates, $0 cash, 0 listeners, rep 0, buzz at `BUZZ_MIN`,
every slot empty) simulated 5 days and rendered all six tabs · **day 540 → 580** ·
cash exactly at `BANKRUPTCY_FLOOR` · max tx + max ant on all 4 stations with 30 skill-10 staff
and `MAX_CREW` on every slot · all 16 dayparts empty across 4 stations for 30 days ·
**200 staff** (all tabs paint in 95ms, sim does not throw).

## Timing

- **200 rapid `stopTick`/`startTick` cycles across all three speeds**, then measured the
  real clock: 2 days in 3s at 1400ms/day. No interval stacking.
- **30 × `enterGame` → `returnToMenu`**: exactly one clock, `S` nulled every time, and the
  clock still runs at exactly 1× afterwards (2 days in 3s).
- **25 × pause-menu open/Resume**: 1 day in 2.5s. No stacking.
- **200 keydowns (Escape/Enter/Space/p/1/2/3/arrows/Tab) through an open modal**: no
  click-trap overlay left behind; `running` and `timer !== null` stayed consistent.
- **Bankruptcy modal is genuinely blocking**: 30 keydowns plus a backdrop click cannot
  dismiss it. Its one button returns to a clean menu, nulls `S`, wipes the save and greys
  out Continue.
- **Hidden tab → return**: hidden clears the timer and leaves `running` true; return pays
  offline catch-up capped at 96 days and correctly stops the clock behind its own modal.
- **Hammered every Options control 20× mid-game**: `S.opts.speed` stayed a valid `SPEEDS`
  key and the game screen stayed reachable.
- **Write-protected storage** (`Storage.prototype.setItem` throwing `QuotaExceededError`):
  `saveGame()` returns `false` 10/10, warns once via the `saveBroken` latch, and the sim
  keeps ticking (day 1 → 31, alive).

## UI / responsive

All six tabs rendered at **320×480, 320×760, 390×760, 760×390 (landscape), 280×600 and
1200×900** — no horizontal overflow anywhere, no empty pane, no throw.
**Very long generated names** (a 260-character staff name on every person) — Studio, Staff
and Empire all render, the game screen overflow is 0px and the slot-editor modal stays
inside its host.
