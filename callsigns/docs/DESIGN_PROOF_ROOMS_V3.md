# Callsigns — design proof, rooms v3

Supersedes `DESIGN_PROOF_ROOMS.md` and `_V2.md`. Reasons forward from
`RESEARCH_RADIO_OPERATIONS.md` and the settled calls in `ROOMS_OWNER_NOTES.md`.

## 1. The core decision

Every few days: **take a named person off the air and seat them in one of the
building's three offices — and which one — where the Rack Room pays in
proportion to the transmitter plant you already own, the Production Room in
proportion to a local-advertiser base the market rolled when you signed on, and
the Traffic Desk in proportion to the inventory your sellers cannot move.**

## 2. The objects and their real counterparts

| Object | Sited | Real counterpart |
|---|---|---|
| **Rack Room (TOC)** | 1 per building | iHeart Portland's tech core: one room, per-station racks, one CE covering every signal |
| **Production Room** | 1..`stationCount()-1` per building | the production studio that cuts spec spots — 5 rooms for 7 signals in Portland |
| **Traffic Desk** | 1 per building | the traffic & continuity manager who builds the daily log and places remnant into unsold avails |
| **Air studio** | 1 per station free; 2nd purchasable | the air studio, 1:1 with signals; Portland's two AMs have a second talk studio, its five FMs do not |
| ~~Newsroom~~ | — | cut, §4 |
| ~~Record Library~~ | — | cut: it is a database, and the librarian is a Music Director wearing a second hat |

## 3. The value formulas, and the self-reference check

`pts` for any room is unchanged: `Σ roomFit(type, role)·skill / staffSlotLoad()[id]`.

### 3a. Rack Room

`gearCut(load) = min(0.60, 0.060·pts)`, ceiling
`PLANT_PTS_PER_UNIT · Σ_st (WEAR_PER_TX·tx + WEAR_PER_ANT·ant)`. Feeds the
existing `stationWear()` for every station.

| input | player sets it | for this mechanic? |
|---|---|---|
| `pts` | yes | yes — that is the purchase, and it is what the ceiling bounds |
| `st.tx`, `st.ant` | yes | **no.** Bought for `reachValue()`/`fidelityValue()`; `TX_LEASE[4] = 900`/day, and installing plant *raises* wear. There is no direction in which a player buys a transmitter to make the Rack Room pay. |
| `COND_WEAR`, `COND_GAIN` | no | world constants |

**PASS.** Structural zero: at `tx = ant = 0` the bracket `1 + (1−gearCut)·gear`
equals 1 for every value of `gearCut` — already true in live code.

### 3b. Production Room

`Δlocal(st) = min(PROD_SHARE_PER_PT·pts_allotted, headroom(st))`,
`headroom = max(0, st.localBase − LOCAL_BASE_NOPROD)`, revenue multiplier
`1 + LOCAL_PREM·Δlocal`.

| input | player sets it | for this mechanic? |
|---|---|---|
| `pts` | yes | yes — the purchase |
| `st.localBase` | **no** — rolled in `newStation()` from `SEGMENTS[seg].localRange`, revealed only after the founding cost is paid | **no. This is the repair.** A per-*segment* table would have been choosable off a menu; a per-*station* roll is not choosable at all. |
| `LOCAL_BASE_NOPROD = 0.55` | no | what one seller closes by phone without a produced spot |
| `LOCAL_PREM = 1/0.7225 − 1 = 0.3841` | no | 15% rep firm × 15% agency, compounding to 72.25% net |
| `fill` | yes, via sellers | **no.** Sellers are hired to raise `fill` for its own sake; the room does not move `fill` and cannot be pumped through it. |

**PASS.** Structural zero on any station with `localBase ≤ 0.55` — `min(pts, 0) = 0`,
however many points sit in the room.

### 3c. Traffic Desk

`remnant = (1 − fill) · min(REMNANT_PER_PT·pts, 0.60) · REMNANT_RATE`,
`REMNANT_RATE = 0.35` (65% off, inside the researched 40–70% band).

| input | player sets it | for this mechanic? |
|---|---|---|
| `fill` | yes | **anti-correlated.** The desk pays more the *less* you sell, and a remnant unit nets 0.35 against a sold unit's 1.00. Sandbagging `fill` gives up 0.65 to gain at most 0.21. No profitable direction exists. |
| `REMNANT_RATE`, `REMNANT_PER_PT` | no | world constants |

**PASS**, and it is the first counter-cyclical asset in the game.

### 3d. Air studio

No value formula. `MAX_CREW` becomes `crewCapOf(st) = 1 + studiosOn(st)` — a
threshold, with nothing to pump.

### 3e. Revenue line

Replacing the current slot revenue in `simulateDay()`, with
`gross = audience · show.adRate · AD_VALUE · price · repRevMul`:

```
slotRev = gross * ( fill * (1 + LOCAL_PREM * dLocal)
                  + (1 - fill) * remClear * REMNANT_RATE )
```

At zero rooms `dLocal = remClear = 0` and this is `gross * fill` — **bit-identical
to the shipped line. No retune.** `ui.js` mirrors it in two places.

## 4. What the check killed

**The building Newsroom.** The owner left it open as "unlocks news inserts on
music hours." Its value formula is `inserts · repPerInsert`, and `inserts` is
proportional to music dayparts scheduled. The player sets that, for free,
instantly, reversibly, and would set it in order to make inserts pay — the
identical class to `servedSlots()`. No world-shaped denominator is available,
because an insert's value is per-hour and hours are exactly what the schedule
is. **Cut.** The News Director survives as a person, and `SHOWS.news.rep = 2.20`
already pays for scheduling news.

## 5. The non-constant proof

One skill-8 body, one seat, countyline station rolled `localBase = 0.88`
(`headroom = 0.33`). Fits: production `{dj 0.85, eng 0.55, sales 0.30}`,
traffic `{dj 0.35, eng 0.30, sales 0.80}`. `PROD_SHARE_PER_PT = 0.020`,
`REMNANT_PER_PT = 0.10` (cap 0.60). Value as a fraction of slot gross:

```
Traffic    T(f) = (1 − f) · min(0.10·pts, 0.60) · 0.35
Production P(f) = f · 0.3841 · min(0.020·pts, 0.33)
```

| spare person | traffic pts | clear | prod pts | Δlocal | crossover f* | crossover rep |
|---|---|---|---|---|---|---|
| DJ | 2.8 | 0.28 | 6.8 | 0.136 | 0.6523 | **25.6** |
| Seller | 6.4 | 0.60 (capped) | 2.4 | 0.048 | 0.9193 | **92.3** |

At **rep 60**, `fill = fillCap(60) = 0.55 + 0.004·60 = 0.79`:

- spare **DJ**: T = 0.098 × 0.21 = **2.058%**, P = 0.052238 × 0.79 = **4.127%** → build **Production**
- spare **seller**: T = 0.21 × 0.21 = **4.410%**, P = 0.018437 × 0.79 = **1.457%** → build **Traffic**

Same day, same cash, same schedule, same building — **the ordering reverses on
which person the hiring stream happened to hand you.** On a `quadrangle` station
(`localBase` tops out at 0.55) P = 0 for every `f` and every `pts`, so the
crossover never occurs. Third axis: the Rack Room is 0.00 at TX0/ANT0 and, at
TX3/ANT2 (`gear = 2.25`), cuts wear 0.008125 → 0.00475, moving `condTarget` at
`attn = 1.5` from 0.8194 to 0.8944 — **+9.2% pull** — and is worth exactly
nothing at Part 15.

No fixed heuristic — "always Traffic", "always Production", "always Rack",
"rooms by rep" — is within 2% of optimal in all three states.

## 6. Failure state

Bankruptcy, unchanged: bay leases are charged empty, and every seat removes
person-hours from `staffSlotLoad()`, so `stationAttn()` falls, `condTarget()`
falls, pull falls, rep falls, `fillCap()` falls, revenue falls, leases do not.
An over-roomed group dies.

**Counterbalance, so this is not a death spiral:** vacating a seat is free and
instant, condition recovery is proportional (`c + COND_GAIN·attn·(1−c)`) so it
converges rather than ratchets, and `COND_MIN = 0.35` floors the drag.

## 7. Pressure curve

- **Minute 5** — no rooms exist (`BAY_UNLOCK_REP = 20`). Inert to the dime.
- **Hour 1** — reputation crosses 25.6 with a spare DJ. The first office is a
  genuinely close call whose answer *inverts inside the session*, and inverts
  again the moment the candidate stream hands you a seller instead.
- **Hour 10** — production capacity is group-wide and capped at
  `stationCount()−1` rooms (the 5-for-7 rule), so a four-signal group can never
  local-ise every station. The pool goes to the highest `gross × headroom` slot,
  and that ranking moves daily because `tickRivalCapacity()` grows in segments
  you under-serve. Meanwhile the Traffic Desk decays toward zero as `fillCap()`
  saturates and must be **closed** and its person re-seated — the game's first
  divestment decision.

## 8. Scarce resource

Person-hours through `staffSlotLoad()`, unchanged. No fourth stockpile, no fifth
resource.

## 9. What the harness reads, and the gate

**Read, per day, per station:** `localBase`, `headroom`, `fill`, the `Δlocal`
actually applied, `remClear` actually applied, `gearCut`, `condTarget`, and the
three room contributions **as separate dollar lines in the book**, so a room
earning nothing is distinguishable from one earning.

**Gate R3.** Paired by seed, N ≥ 60, ≥ 540 days:

- **(a)** `readsState` — seats the Traffic Desk while `T > P` for the spare
  person it actually holds, and re-seats when the sign flips — beats **both**
  `alwaysTraffic` and `alwaysProduction` by ≥ 5% of end cash, with the paired
  95% CI excluding zero.
- **(b)** The two fixed policies must not tie: `|alwaysTraffic − alwaysProduction| ≥ 5%`,
  and **the sign of that difference must reverse** between a spare-DJ arm and a
  spare-seller arm. If either fixed policy wins in both arms, the decision is
  decoration and the mechanic fails — say so and cut it.
- **(c)** A run with every station rolled `localBase ≤ 0.55` reports Production
  lifetime contribution of **exactly $0.00**, not a small number.
- **(d)** A run at TX0/ANT0 across all stations reports Rack Room `condTarget`
  delta of **exactly 0.0000**.

**Instrument first (rule 5).** Before any of the above is believed: set
`PROD_SHARE_PER_PT = 0` and confirm (a) and (c) both scream; set
`REMNANT_PER_PT = 0` and confirm the sign in (b) stops reversing. The harness
must call `hireBest('sales', …)` — never a `salaryFor(c)` one-argument call —
and must actually move `S.rep` across the arms, or (b) is measuring one run
twice.

## 10. Change list, prioritised

1. **Delete the schedule rooms.** `servedSlots()`, `schedMul()`, `newsMul()`,
   `libMul()`, `roomShows()`, `NEWSROOM_SHOWS`, `LIBRARY_SHOWS`,
   `ROOM_PTS_PER_SERVED_SLOT`, and the appeal branch in `slotPull()`. Drop
   `news`/`library` from `ROOM_TYPES`; `sanitize()` already discards unknown
   types, so v7 saves migrate.
2. **Re-site the Rack Room to the building.** `roomAt()`/`roomsOn()` key on the
   building, not `r.station`; `gearCut(st, load)` → `gearCut(load)`;
   `roomCeiling(ROOM_RACK)` = `PLANT_PTS_PER_UNIT · Σ_st(0.55·tx + 0.30·ant)`.
3. **Add `st.localBase`**, rolled in `newStation()` from
   `SEGMENTS[seg].localRange` (`citywide 0.62–0.80`, `countyline 0.80–0.95`,
   `ledger 0.55–0.70`, `nightshift 0.60–0.76`, `quadrangle 0.45–0.55`).
   `STATE_VER 7 → 8`, with `sanitize()` rolling it for existing saves.
4. **Add `ROOM_PROD` and `ROOM_TRAFFIC`** with the fits in §5, plus
   `prodAllotment(load)` distributing group production points across slots by
   descending `gross × headroom`.
5. **Rewrite the revenue line** per §3e; mirror in `ui.js` (two sites).
6. **`crewCapOf(st)`** replacing `MAX_CREW`; one studio free at founding, second
   purchasable per station.
7. **UI: realised $/day per room**, plus `headroom` on the build screen. Show the
   *backward-looking* contribution a real GM would have. **Do not** display the
   crossover reputation — that is printing the number the player is solving for,
   which is the Purr & Power sin verbatim.
8. **Harness rewrite** to §9, instrument-break first.
