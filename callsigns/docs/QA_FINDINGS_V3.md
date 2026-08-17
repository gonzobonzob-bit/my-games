# Callsigns — QA pass v3 (rooms v3 / STATE_VER 8)

Adversarial pass against `main` @ `55779f0`, run in **headless Chrome over CDP against the real
`index.html`** (no jsdom, no stubs). Every finding below was reproduced in the browser before it
was written down; every "clean" line below was executed, not read.

Harness (scratch, not committed):
`/tmp/claude-1000/-home-gonzobonzob/17830830-b93e-4590-92e2-09628e73938d/scratchpad/`
— `drv.mjs` (CDP driver), `t01-saves.mjs` (48 hostile saves), `t02-exploits.mjs` (17 exploit
probes), `t03-xss.mjs` / `t03b-xss-pin.mjs`, `t04-ui.mjs`, `t06-deep.mjs` (real-UI + 500-day
ledger), `t07-sweep.mjs` (localBase matrix + 3,988-click sweep), `t08c-proof.mjs` (ceiling proof),
`t09-chaos.mjs` (chaos monkey on the real clock).

**Uncaught exceptions across the entire pass: 0.** No blank screens, no dead Continue, no hangs.

**4 confirmed issues: 1 major (wrong answer), 2 medium (hostile-save), 1 minor.**

---

## 1. MAJOR — `roomCeiling(prod)` is 4x too small: the game tells the player their
##   Production Room is wasting staff while it is only 25% supplied

**Suspect:** `js/sim.js:998`
```js
if (key === ROOM_PROD)    return groupHeadroom() / PROD_SHARE_PER_PT;
```
`groupHeadroom()` sums headroom **per station**. `prodAllotment()` spends the pool **per
station x daypart slot** — `js/sim.js:963` books `need: head / PROD_SHARE_PER_PT` for *each* of
`DAYPARTS.length` slots on every station with headroom. The true saturation point is therefore
`DAYPARTS.length * groupHeadroom() / PROD_SHARE_PER_PT`. The stated ceiling drops the `x4`.
(The design proof's own arithmetic — "full allotment needs 16*0.181/x" — uses the 16-slot figure,
so the proof and the shipped ceiling disagree.)

**Reproduction** (`t08c-proof.mjs`): 4 stations (citywide + 3 countyline), 3 Production Rooms,
9 seats, `Math.random` pinned to 0.999 so no fault roll moves the numbers. Seat skill is swept to
move points; one `simulateDay()` per level from an identical snapshot.

| room points | `roomCeiling('prod')` | UI prints "wasted" | Σ ΔLocal actually allotted | % of achievable | `lastDay.prodRev` |
|---|---|---|---|---|---|
| 10.8 | 8.63 | **2.17 ⚠** | 1.404 | 31.3% | $162.95 |
| 21.6 | 8.63 | **12.97 ⚠** | 2.808 | 62.6% | $247.02 |
| 32.4 | 8.63 | **23.77 ⚠** | 4.212 | 93.9% | $301.61 |
| 59.4 | 8.63 | **50.77 ⚠** | 4.4854 | 100% | $307.62 |
| 1080 | 8.63 | 1071.37 ⚠ | 4.4854 | 100% | $307.62 |

Real saturation is at ~34.5 points — measured `trueSaturation` = 34.503 against
`statedCeiling` = 8.626, a ratio of **3.999**.

**What happened vs. what should happen.** At the stated ceiling the room is delivering about a
quarter of its money; every point from 8.6 to 34.5 is still buying revenue ($163 -> $308/day here,
and the design targets ~$1,028/day at scale). The UI renders that entire productive range as
waste: `js/ui.js:2364-2369` flips the meter to `.over`, `js/ui.js:2455-2460` and `4243-4273`
strike the points through (`<s class="struck">`) and mark the room card `bad`, and `4271` prints
"N wasted ⚠". A player following the readout stands down three of every four seats that were
still earning. Worse, `uiRoomMarginOf()` measures the *next* point with a probe and will report it
as **positive** on the same card that says the room is over-staffed — the card contradicts itself.

Note the other two ceilings are correct and were verified: `rack` is `min()`-ed against the same
cap it publishes (`gearCut`, `js/sim.js:912-914`), and `traffic` saturates exactly at 6.0 pts /
`remClear` 0.60 (measured: 4.8 pts -> 0.48; 24 pts -> 0.60).

**Fix shape:** `return DAYPARTS.length * groupHeadroom() / PROD_SHARE_PER_PT;` — balance owns
whether `PROD_SHARE_PER_PT` then wants re-tuning, but the published ceiling and the pool the
allotter actually spends have to be the same number.

---

## 2. MEDIUM — hostile save: `bays: 0` keeps every room working and pays no bay lease
##   (~$310/day free, forever)

**Suspect:** `js/sim.js:3380` — the room loop bounds paid rooms by `MAX_BAYS`, never by `s.bays`:
```js
if (paid >= MAX_BAYS) continue;
```
`buyBay()` only ever increments `S.bays`, so nothing repairs it afterwards.

**Reproduction** (`t07-sweep.mjs`, "lease dodge"): play normally to 3 bays + Rack + Prod + Traffic,
all seated; save. Edit one integer in `localStorage['callsigns.save']`: `"bays":3` -> `"bays":0`.
Reload, Continue.

* Loads clean, no toast, no warning. `S.rooms.length` = 3, `S.bays` = 0.
* All three rooms keep working: `rooms: ["prod:1","traffic:1","rack:1"]`, room points and
  `lastDay.prodRev`/`remRev` unchanged.
* `lastDay.bayLeases` = **$0** vs $310/day honest. Over 30 identical days: **+$9,106**.

The in-code comment defends keeping the rooms ("a player who is one bay short after a hand-edit
keeps their rooms"), which is right — but the bays should be raised to cover them, not the lease
waived. **Fix shape:** after the room loop, `s.bays = clamp(Math.max(s.bays, s.rooms.length), 0,
MAX_BAYS)`. Nobody loses a room and nobody dodges the ladder.

---

## 3. MEDIUM — XSS: a staff `id` from the save is written straight into live DOM attributes

**Suspects (raw `p.id`, no `esc()`):** `js/ui.js:3116` (`data-train`), `3117` (`data-fire`),
`3184` (`data-hire`), `3956` (`data-leadcrew`), `3958` (`data-dropcrew`), `4013` (`data-addcrew`),
`4076` (`data-seteng`). `sanitize()` coerces the id with `String(p.id)` (`js/sim.js:3155`) and
applies no charset filter, so any string survives the load path.

**Reproduction** (`t03-xss.mjs`, `t03b-xss-pin.mjs`): set
`staff[0].id = 'a" onmouseover="window.__pwned=(window.__pwned||0)+1" x="'` in the save
(and the matching ids in `rooms[].staff` / `schedule[].djs`), reload, Continue, open the Staff tab.
Two elements fire on hover — `window.__pwned === 2`. Pinned with an `onfocus`/`autofocus`
payload, the rendered DOM is:

```html
<button class="btn sm danger" data-fire="X" onfocus="window.__pwned=1" autofocus="">Fire</button>
<button class="btn buy" data-hire="X" onfocus="window.__pwned=1" autofocus="c">Hire · $360</button>
<button type="button" class="row" data-seteng="X" onfocus="window.__pwned=1" ... >   <!-- slot editor modal -->
```

Self-inflicted in a single-player game, but `localStorage` is per-origin and the whole vault ships
from one GitHub Pages origin, so any other page on that origin can plant the save. Everything that
goes through `esc()` is safe — staff *name*, log messages, callsign, candidate names, room ids in
`data-seatadd`/`data-seatdrop` (`js/ui.js:4335`, `4371`) all escaped correctly and did **not**
execute. **Fix shape:** wrap these seven sites in `esc()` (the seat buttons already show the
pattern), and/or filter ids to `[A-Za-z0-9_-]` in `sanitize()`.

---

## 4. MINOR — `buyStudio(idx)` silently retargets an out-of-range index instead of refusing

`js/sim.js:1530` `stationAt(i)` **clamps**. Measured with 3 stations at 1 studio each:
`buyStudio(99)` -> `{ok:true, cost:9500}` and upgraded **station 2**; `buyStudio(-1)` upgraded
**station 0**. Result `[2,1,2]`. Not reachable from the UI (`data-buystudio` always carries a real
index) and the money is charged correctly, so this is API hygiene only — but `canBuyStudio()`
already has a `'station'` reason string that can never fire.

---

## localBase: can the player move it?

**No — not by playing.** Attacked and clean:

* Founding, refounding, station switching, `setStation`, 80+ simulated days, every gear tier,
  both studios, all three rooms built/seated/stripped, rep 5 -> 100, buzz, schedule rewrites,
  20 x save/load round trips, `catchUp()` across an 8h absence: `localBase` byte-identical
  before and after (`t02-exploits.mjs` E10).
* No code path writes `st.localBase` outside `newStation()`, `readStation()` and `sanitize()`
  (grep-verified), and no path writes `st.segment` at all after founding.
* Save-scum reroll is **closed by `doFoundStation()`'s immediate `saveGame(true)`**
  (`js/ui.js:3825`): the roll is on disk before the toast fades. (Reloading a *pre-founding*
  save does reroll — 14 distinct values across 15 reloads — but reaching that state needs the tab
  killed hard enough to skip `pagehide`/`beforeunload`, both of which save.)
* Stable across reloads even from a corrupt save: a v7 station with `freq:"zzz"` and no
  `localBase` rolled the *same* 0.6711 on 8 consecutive loads.

**Yes — by editing the save, and the band is the only guard.** `js/sim.js:3272` clamps a
hand-edited `localBase` into the segment's band, but the *segment string* selects the band and is
trusted verbatim:

| edit | segment | localBase | headroom | `roomCeiling('prod')` |
|---|---|---|---|---|
| none | citywide | 0.7055 | 0.1555 | 1.196 |
| `localBase: 0.99` | citywide | **0.80** | 0.25 | 1.923 |
| `segment: "countyline"` *(localBase untouched)* | countyline | **0.80** | 0.25 | 1.923 |
| both | countyline | **0.95** | 0.40 (**2.6x**) | 3.077 |

Note row 3: changing only the segment string *raises* an existing legitimate roll to the new
band's floor. Clamping out-of-band values to the boundary is what does it; re-rolling
`rollLocalBase(segment, freq, foundedDay)` whenever the stored value falls outside the band would
keep the load deterministic and remove the "clamp to the best number in the band" reward.

---

## Attacked and clean (so the team knows what is covered)

**Hostile saves — 48 payloads, all loaded or refused gracefully, zero crashes, zero blank
screens** (`t01-saves.mjs`). Every one of these degraded correctly:

* v5, v6, v7, v8, v9(future). v9 -> `hasSave()` false, clean menu, Continue disabled and honest.
* **v7 -> v8 migration verified exactly as specified**: `{maint, news, library, traffic}` on 5 bays
  loads as Rack + Traffic; the Maintenance Bay **keeps its id (`maint-1`) and its seat**, `news`
  and `library` drop silently, `bays: 5` stays bought, every station gets a rolled `localBase` and
  `studios: 1`. A discarded-build v7 with `sales`/`green`/`salesRoomed`/`free:true` loads with only
  its real room and no free bay.
* Rooms: `station: 99`/`-5` (clamped), duplicate ids (regenerated), 3x same type (deduped to the
  cap), 5 prod rooms on 2 stations (capped at `stationCount()-1`), seats holding ghosts (dropped),
  one person in 3 rooms (kept, load-divided — not double-counted), 9 seats in one room (cut to 3),
  `rooms` as an object (ignored), `rooms` as `[null,'hello',42,{staff:null}]`, **10,000 rooms
  (load 6.1 ms, 5 sim days 1.6 ms, trimmed to 3)**.
* `bays`: 999 / -3 / `"6"` / `1e400` — all clamped to `[0, MAX_BAYS]`.
* `localBase`: `"0.95"` / 5 / -2 / null / absent / `1e400`. `studios`: 99 / -1 / over-crewed slot.
* `__proto__` at top level and inside a station — **no prototype pollution** (`({}).polluted`
  false); truncated JSON, `stations: {}`, `stations: []`, `staff: {}`, `cash: 1e400`,
  `lastDay.net: 1e300`, `lastTick` at 0 and at +1e12, `day: 0`, `day: 1e9`, unknown segment,
  unknown show enum, `book`/`lastDay` as string/array, `opts.speed: 1e9`, `dead: true`.
  Cash stayed finite in every case; `cash: -1e12` correctly refuses to resurrect a dead run.

**Exploits — 17 probes, all clean** (`t02-exploits.mjs`, `t07-sweep.mjs`):

* Build/remove/rebuild a room **200 times**: cash delta $0, bays delta 0, 200 unique ids, no leak.
* `buyBay()` x50 -> 6 bays, 44 `cap` refusals. Bay confirm button clicked 30x -> 1 bay, $2,500.
* `buyStudio()` x20 -> exactly one charge; UI third-studio button clicked 20x -> $0.
* Crew cap = `1 + studios` enforced at `addDj()` **and** on load (a hand-edit back to 1 studio
  trims a 3-DJ slot to 2).
* `staffSlotLoad()` counts a room seat exactly like a slot: one engineer in 3 rooms + 1 slot -> load 4,
  points divided not multiplied. Firing a seated person through the real confirm removed the seat
  and dropped room points 16.15 -> 10.2.
* Seat cap 3 with `already`/`full`/`staff`/`room` refusals; `buildRoom` rejects `news`, `__proto__`,
  `{}` and non-string types.
* **Bay leases are charged empty**: 0 rooms and 6 bays still bills $1,950/day; stripping every room
  changed `bayLeases` by $0. `bayLeases` is a subset of `leases`, so `catchUp()` extrapolates it.
* `catchUp()`: an 8h absence paid −$156,576 over 96 capped days at full loss rate with condition
  decayed to the floor first; an immediate second call paid $0. Ledger drift 0 through it.
* **The 70-tap sweep**: 3,988 clicks across every `data-*` control on all six tabs — no control
  raised cash, and no invariant (`rooms<=bays`, `seats<=3`, `studios<=2`, `stations<=4`,
  `bays<=6`, `crew<=cap`, `engs<=2`, `skill<=10`) was ever violated.

**Ledger — 500 days with all three rooms staffed, rooms stripped/rebuilt every 31 days, studios
bought, staff hired and fired mid-run, bays at 6: max `ledgerDrift()` = 1.16e-10.** A second
400-day churn run: 1.16e-10. Post-chaos 60 days: exactly 0. Room revenue was live throughout
(`roomDays` 500/500, `prodRev`/`remRev` non-zero) — the assertion is not vacuous.

**UI / timing / boundaries — clean** (`t04-ui.mjs`, `t06-deep.mjs`, `t09-chaos.mjs`):

* New game, hire, train, fire, slot editor, show change, gear, second studio, 6 bays, all room
  types, seating and unseating, and founding 3 stations — all driven by real element clicks.
* **Modal on a deleted entity**: stripping a room out from under its own open editor and then
  clicking all 14 controls in the stale modal — no throw, no cash movement, no ghost room, screen
  still usable. Confirming a Fire dialog after the person left the roster — no throw.
* Rapid speed toggling (150 clicks through Options), 200 keydowns, Escape spam over modals, pause
  during a modal: clock survives and resumes (day advanced afterwards — verified, not assumed).
* Tab hidden -> returned (`visibilitychange`): no double payout, ledger intact.
* 320x600, landscape 760x390, back to 390x760: every tab renders, horizontal overflow 0 px.
* 200-character staff names, 120-character candidate names, a 400-character log line: overflow 0.
* 12 rounds of random clicking on the live clock (~480 clicks): 0 exceptions, 0 invariant
  violations, save/load round trip byte-identical.
