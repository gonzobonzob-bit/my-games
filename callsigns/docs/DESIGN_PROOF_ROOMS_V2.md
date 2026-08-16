# Callsigns — design proof v2: rooms that earn the bay

Supersedes `DESIGN_PROOF_ROOMS.md` §1–§8. §3's two prohibitions and §12's
measurements stand and are treated as given.

> **Integrator note (2026-08-15).** §6's three harness defects were verified
> against source before any of this was acted on, and they matter more than the
> design changes below:
>
> | claim | status |
> |---|---|
> | Fixed-type policies build exactly one room ever | **confirmed** — `fixedType()` returns `null` once `roomAt(idx,type)` exists, and `flagship` is `function(){ return 0; }`. The whole cohort read `bays 1 rooms 1`; `alwaysMaint` ≡ `alwaysGreen` and `alwaysNews` ≡ `roundRobin` to the dollar because they were the same runs. |
> | No policy ever varies the schedule | **confirmed** — `setSlotShow` appears at exactly ONE line in `tests/harness.mjs`, inside the `ads` policy. Every room run used the default `music/music/talk/music` for 540 days, so §2a's entire axis was a constant. |
> | One global PRNG destroys pairing | **confirmed** — a single `Math.random = function…` override serves fault dice, events, candidates and callsigns from one stream. |
>
> The v1 gate therefore measured almost nothing. Fix the instrument first, re-run,
> and only then move constants — otherwise the tuning is fitted to noise.

## 0. Verdict

**Ship three rooms.** Cut the Green Room. The Record Library becomes an appeal
multiplier on music slots, mirroring the Newsroom; the Maintenance Bay is kept
unchanged. The magnitude fix is not the multiplier — it is that the Library was
never a multiplier at all, that the bay ladder was unclimbable, and that the
harness never varied the one axis the whole proof rests on.

## 1. The core decision

> **Each bay: spend it amplifying one station's format commitment, or protecting
> a big signal you are under-crewing — and how far do you concentrate that
> station's schedule to earn it?**

## 2. The failure state

Unchanged: payroll plus leases outrun share-limited revenue. Rooms add three
routes, all legible in advance: (a) six bays at $1,950/day is 10.4% of a
mid-game empire's gross and 33% of an hour-3 empire's, paid empty; (b) points
above a served-slot ceiling are worth exactly $0 — a Newsroom on a one-talk-slot
station caps at 3 points and a single skill-10 DJ brings 7; (c) staffing rooms
out of your on-air roster cuts `attn` on every station those people work,
driving `c*` down into `causeSignalRot`. `causeOverbuilt` stays.

## 3. THE NON-CONSTANT PROOF

### 3a. The two schedule rooms, made symmetric

Today `royaltyCut()` multiplies `rev · ROYALTY_RATE · musicShare`. Its hard
ceiling is `0.045 · 0.55 = 2.475%` of music revenue. `newsMul()` multiplies
`show.appeal` inside `slotPull()`, and reaches ~7% of station revenue. Six-to-one.
**Raising `ROYALTY_RATE` to reach parity requires 0.12 — a 2.7× increase that
adds ~$253/day of new cost to a mid-game empire at 75% music. That manufactures a
problem in order to sell the cure. Reject it.**

Instead: delete `royaltyCut()`, leave `ROYALTY_RATE` at a flat 0.045, and give
the Library the Newsroom's own form at the same site in `slotPull()`:

```
LIBRARY_SHOWS = ['music']            // NEWSROOM_SHOWS = ['talk','news'] unchanged
libMul(st, load) = 1 + LIB_PER_PT * min(roomPts, roomCeiling(st, ROOM_LIB))
appeal = show.appeal * (newsroomServes(slot.show) ? newsMul(st,load)
                      : libraryServes(slot.show)  ? libMul(st,load) : 1)
```

Applied in `slotPull()` and **not** in the `quality` that `simulateDay()`
averages into `repPressure` — the same spiral guard `condOf()` and `newsMul()`
already obey. `ads` is served by neither, deliberately: that is the third regime,
"this station wants no schedule room, put the bay elsewhere," and it is what
makes placement non-constant.

New ceiling, replacing the flat 10 points:

```
servedSlots(st, type) = # of DAYPARTS whose show is in that type's support   // 0..4
roomCeiling(st, type) = ROOM_PTS_PER_SERVED_SLOT * servedSlots(st, type)     // 3.0/slot, 0..12
```

At zero served slots the ceiling is 0 and the multiplier is exactly 1.00. The
zero stays **structural**, not numeric, and for the first time the ceiling
readout says a true thing:
*"Newsroom — KXYZ · 7.0 / 3.0 pts · 4.0 wasted · ceiling set by 1 talk slot."*

**Why the served-slot ceiling and not a bigger flat multiplier.** With
`m(σ) = 1 + 0.055·3·4σ = 1 + 0.66σ` where σ is the fraction of dayparts served,
room value is

```
value(σ) = [ m(σ)/(1 + (m(σ)−1)·s) − 1 ] · σ
```

which is roughly **quadratic in σ**. At s = 0.45: σ=1.00 → 28.0% of station
revenue; σ=0.75 → 16.7%; σ=0.50 → 7.9%; σ=0.25 → 2.1%; σ=0 → 0. A committed
station is worth 3.5× a half-committed one, against 2× under a flat multiplier.
That is the commitment device, and it costs one constant.

### 3b. The room rewrites the schedule argmax — the coupling that makes it a decision

Slot revenue argmax is settled by `appeal · parts · adRate · segFit`. On
`nightshift` (fit music 1.18, ads 0.85) the night slot's argmax is **ads** at
1.735 against music 1.558. With a Library at full points (`m = 1.66`,
`g = 1.66/(1+0.66·0.30) = 1.386`), music night becomes `1.558 · 1.386 = 2.160`
and **the argmax flips to music.** On `citywide` at max points music night
reaches 1.792 against ads 1.837 and **does not flip** — a dead heat you lose.

So the room does not merely read the schedule; it changes what the schedule
should be, and it changes it on some segments and not others. Building the
Library and choosing the night format are one decision made in both directions.
That is what §2a was reaching for and never got.

### 3c. The ordering table — five states, three argmaxes

Station revenue R = $4,680/day (a quarter of the $18,720/day mid-game empire),
skill-10 surplus staff, `c* = 1 − wear/(COND_GAIN·attn)`,
`wear = 0.0025·(1 + (1−gearCut)·(0.55·tx + 0.30·ant))`, `g(m,s) = m/(1+(m−1)s)`.

| state | Newsroom | Record Library | Maintenance Bay | argmax |
|---|---|---|---|---|
| A. quadrangle, 4 music, TX2/ANT2, attn 2.0, s=0.30 | ceiling 0 → m=1.00 → **$0** | m=1.66, g=1.386, σ=1.00 → **+$1,806** | Δc/c=+4.8% → +2.6% → +$122 | **Library** |
| B. ledger, 3 talk 1 ads, TX2/ANT2, attn 2.0, s=0.40 | m=1.495, g=1.234, σ=0.75 → **+$822** | ceiling 0 → **$0** | +$122 | **Newsroom** |
| C. ledger, 3 talk 1 ads, **TX4/ANT4, attn 1.0**, s=0.40 | +$822 | $0 | c* 0.633→0.803, Δc/c=+26.8%, g=1.1315 → **+$618** | Newsroom, Bay second |
| D. citywide, 2 music 1 talk 1 ads, TX4/ANT4, **attn 0.8**, s=0.55 | m=1.165, σ=0.25 → +$80 | m=1.33, σ=0.50 → +$295 | c* 0.542→0.754, Δc/c=+39.2%, g=1.1451 → **+$679** | **Maintenance Bay** |
| E. **same station, attn 2.4** (you finished hiring) | +$80 | +$295 | c* 0.847→0.918, Δc/c=+8.4% → +$169 | **Library** |

A→B flips on the schedule, with both zeros structural and untunable. D→E flips
the Maintenance Bay from first to third **on attention density alone** — the map
`staffSlotLoad()` builds, which the player moves by hiring and by seating people
in rooms. The Bay's own seat is part of that: filling it out of your on-air
roster raises their load, cuts `attn`, and lowers the very `c*` the room exists
to raise. That asymmetry is unchanged from v1 §3 and it is correct.

### 3d. The four rule-checks

- **Depends on player-controlled state?** Yes, on three independent axes with
  three different zeros: schedule mix (news/library, disjoint supports,
  structural zeros), gear index (Bay, arithmetically zero at TX0/ANT0), attention
  density (Bay, and every room's `roomPower` divides by load). ✓
- **Anything derived from the player's own costs?** No, and the surface
  **shrinks**: deleting `royaltyCut()` removes the only room effect that ever
  touched a money line. ✓
- **Necessary and unboundedly purchasable?** No. Room points are cheap (surplus
  people), but the ceiling is `3 × servedSlots ≤ 12` and is set by a zero-sum
  allocation of four dayparts, not by money. Bays cap at 6 on a rising lease. ✓
- **Negative feedback with no counterbalance?** No, and the Library gets a
  natural one for free: `royalties = rev · 0.045 · musicShare` taxes exactly the
  revenue the Library creates, while talk/news pay none but forgo
  `music.parts.midday 1.60` and `adRate` at night. The Newsroom's side is
  counterbalanced by `SHOWS.news.rep 2.20` feeding `repTarget`. Cutting the Green
  Room removes v1's one acknowledged self-worsening trap. ✓

## 4. THE MAGNITUDE NUMBER, DERIVED

**Step 1 — the noise.** Measured p10–p90 is $4.6M–$7.3M → σ = 2.7M/2.563 =
**$1.053M** on a $6.7M median (CV 15.7%). SE of a median at n=20 is
`1.253σ/√20 = $295k`. The gate compares two **independent** medians (any policy
divergence desynchronises the single global PRNG, so the pairing is destroyed) →
SE of the difference = `$295k·√2 = $415k = 6.2% of the median`.

**The 5% threshold is 0.81 SE.** A design with a *true* 5% edge passes about half
the time; a design with no edge passes about 21% of the time. The gate as
instrumented is a coin flip, and that is a defect in the instrument, not a reason
to move the threshold.

**Step 2 — with the instrument fixed.** Common random numbers plus a **paired**
test — median of per-seed differences rather than difference of medians —
collapses the residual to roughly a quarter of the unpaired spread:
σ_diff ≈ $372k, SE ≈ $104k. Required true edge for 95% power at a 5% threshold
is ≈ **$506k**.

**Step 3 — from end cash to $/day.** First bay lands ~day 80; effective accrual
≈ 460 day-equivalents including light reinvestment. So

```
D ≥ $506k / 460 = $1,100/day ≈ 5.9% of an $18,720/day empire.
```

**Step 4 — from edge to total room value.** With N stations, room value V on a
matched station and ~0 on a mismatched one, **the type-choice edge is bounded at
`min(k, N−k)/N` of total room value.** Under the current tables the four starting
segments lean music **3:1**, so k = 1 and the ceiling on the edge is **25% of
total room value** — $4,400/day, 23% of empire gross, just to clear the gate. The
design above reaches ~15–17%.

**So one content line must move too, and it is not a room constant:**

```
countyline.fit: { music: 1.05, talk: 1.05, news: 1.00, ads: 1.10 }
             -> { music: 0.90, talk: 1.15, news: 1.20, ads: 1.05 }
```

`countyline` is the flattest segment in the table and the only one that can be
tipped without disturbing a validated balance line. Post-change its argmaxes are
talk / ads / talk / ads, giving **k = 2** and doubling the edge ceiling to 50%.

**The resulting numbers** (weights: citywide 0.35, countyline 0.25, ledger 0.25,
nightshift 0.15; s = 0.55/0.45/0.40/0.30):

| policy | value, % of empire gross |
|---|---|
| greedy (state-reading) | **17.4%** |
| alwaysLib | **11.0%** |
| alwaysNews | **7.6%** |
| roundRobin | ≈ **12%** |
| alwaysMaint | ≈ **4%** |

D = 17.4 − 12 = **5.4% of empire = $1,011/day → $465k of end cash = 6.9% on a
$6.7M median.** Against the CRN paired SE of $104k that is z = 1.25, ~89% power.
**Tight. If the first measurement lands short, raise `ROOM_PTS_PER_SERVED_SLOT`
3.0 → 3.5**, which lifts everything ~15% → D ≈ $1,160/day, z ≈ 1.9, 97% power.
Move that constant, not the multiplier per point and not the gate.

**Total room value goes from ~$450/day (2.4% of empire) to ~$3,250/day (17.4%) —
7.2×.**

## 5. The Green Room: CUT

Its payoff is `FATIGUE_PER_LOAD · (djLoad − 1) · (GREEN_PER_PT · pts)`. `djLoad`
is a decision variable with a **free minimum at 1**: ~2,500 candidates are
offered by hour 10, `hireFee ≈ $600`, no roster cap. Spreading DJs to load 1
costs nothing and beats the room outright — at load 4 the Green Room at max
recovers `djFatigue 0.46 → 0.757` (djTerm +19%), while simply assigning a second
DJ recovers `0.46 → 1.00` (djTerm +34%) **and** costs no bay.

A room whose support is exactly "you made an avoidable mistake", and which is
dominated by the free correction, is a crutch occupying a bay a real room could
use. Cut it.

*(Considered and rejected: giving fatigue a consecutive-days-on-air accrual so
the room triggers in normal play. That invents a hidden timer, makes the room a
mandatory tax rather than a choice, and adds a fifth resource to a game whose §0
finding is that it already has three surplus ones.)*

## 6. What the harness must read

**Three instrument defects, each individually sufficient to produce the observed
tie. Fix these before touching a single constant.**

1. **Every fixed-type policy passes `flagship` as `pickStation`.** With one room
   type per station, `fixedType('library')` returns `null` the moment station 0
   has a library — so each builds **exactly one room, ever**. That is why the
   cohort median was `bays 1 rooms 1`, and why two pairs of policies tied to the
   dollar: they were the same runs. **Fix: fixed-type policies use
   `greedyStation`.** "Always news" must mean news *everywhere*.
2. **No room policy ever calls `setSlotShow()`.** `defaultSchedule()` is
   `music/music/talk/music`, so all 20 seeds × 10 policies × 4 stations ran the
   identical schedule for 540 days. **The axis §2a's entire argument rests on was
   a constant.** **Fix: a shared `setSchedules()` in `empireCore` that sets each
   slot to the revenue argmax evaluated *through the rooms currently built*** —
   identical for every policy, so the schedule is state the room decision reads
   rather than a confound.
3. **One global PRNG.** Any policy divergence shifts everything downstream, so
   common seeds buy nothing. **Fix: day-indexed substreams** for the fault roll,
   `rollEvent()` and `refreshCandidates()`; then compute the gate on the **median
   of per-seed differences**.

**Plus one new assertion, and it is the one that actually falsifies §2:**

> **`ROOM ARGMAX IS NOT CONSTANT`** — log `argmax_type(station)` at every build
> decision. Assert (a) at least three distinct types are chosen across the
> cohort, and (b) at least one station's argmax changes type **within a single
> run**. Zero variance, one run, sub-second.

Terminal cash at 540 days is the noisiest possible proxy for a claim about an
argmax. Keep the 5% cash gate — it stays at 5% — but stop making it the only
evidence. Also add `roomValue` to the run record so a future tie is diagnosable
as *"rooms were worth nothing"* versus *"both policies chose the same rooms."*

## 7. Pressure curve

- **Minute 5 — untouched, to the dime.** Bays behind `BAY_UNLOCK_REP 20` and
  $2,500. Deleting `royaltyCut()` makes `ROYALTY_RATE` a flat 0.045 again, so
  DESIGN.md's $60/day lease against $60.9/day of automated gross and day-one
  `cond = 1.00` both survive verbatim.
- **Hour 1 — the ceiling lesson, now honest.** A Newsroom on the default schedule
  caps at **3 points**; a skill-10 DJ brings 7 and the card reads
  `7.0 / 3.0 pts — 4.0 wasted`. The lesson is "a room is worth your *schedule*,
  not your roster."
- **Hour 3 — the reversal.** Bays 3 and 4 ($180/$320) sit inside the $250–$650
  band of real room values. Under-crewed, the **Maintenance Bay outearns both
  schedule rooms** ($679 vs $295). The week you finish hiring, it stops ($169 vs
  $295). The room you were right to build becomes the room you should tear out,
  and `removeRoom()` is one free click.
- **Hour 10 — the schedule *is* the room.** Value is quadratic in concentration
  and inversely elastic in share. Move the bay to the signal that is *losing*,
  not the flagship.

## 8. The scarce resource

**Bays × served slots.** Room points are cheap. The ceiling is
`3 × servedSlots`, and the sixteen daypart slots of a four-station empire are
strictly zero-sum across three competing formats plus `ads`. What the player
manages is *how much airtime they will commit to one format to make a room worth
its bay*, against the revenue and reputation of the format they give up.

## 9. Change list, prioritised

| # | problem | fix | where |
|---|---|---|---|
| 1 | Fixed-type policies build exactly one room each | `fixedType(...)` policies take `greedyStation`, not `flagship` | `tests/harness.mjs` |
| 2 | The schedule — §2a's whole axis — is constant across every measured run | shared `setSchedules()` in `empireCore()`, argmax evaluated through current rooms | `tests/harness.mjs` |
| 3 | Library capped at 2.475% of music revenue; Newsroom reaches 7% | delete `royaltyCut()`; add `libMul()` on `LIBRARY_SHOWS = ['music']` at the same `slotPull()` site as `newsMul()` | `js/sim.js` |
| 4 | Total room value is 2.4% of empire — below run-to-run noise | `NEWS_PER_PT = LIB_PER_PT = 0.055`; `ROOM_PTS_PER_SERVED_SLOT = 3.0`; served-slot ceiling replacing the flat 10 | `js/sim.js` |
| 5 | Bay ladder unclimbable — rungs 4–6 exceed the best room by 1.4×/3.7×/9.2× | `BAY_LEASE = [40, 90, 180, 320, 520, 800]` | `js/content.js`, fallback in `js/sim.js` |
| 6 | Green Room pays only on states with a free escape | cut the type; `sanitize()` drops the id as unknown, same path the cut `sales` room uses | `js/content.js`, `js/sim.js` |
| 7 | Segments lean music 3:1, capping the type edge at 25% of room value | `countyline.fit → { music: 0.90, talk: 1.15, news: 1.20, ads: 1.05 }` | `js/content.js` |
| 8 | The gate tests an argmax claim through 540-day terminal cash | CRN substreams + paired median-of-differences; add `ROOM ARGMAX IS NOT CONSTANT`; add `roomValue` to the run record | `tests/harness.mjs` |

The three prohibitions are untouched: no room adds to `stationAttn()`; no room
cuts the base `COND_WEAR` term; the Maintenance Bay touches only the gear
bracket, which is `1` for every `gearCut` at `tx = ant = 0`, so
`DESIGN_PROOF_DECAY.md` §3 and the day-369 idle death hold verbatim. Room seats
remain assignments in `staffSlotLoad()`. No room effect reads cash, revenue,
payroll or any cost — and item 3 removes the last one that touched a money line.
No mechanic ranks people by skill. The gate stays at 5%.
