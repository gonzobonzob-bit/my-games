# Callsigns — design proof: bays, rooms, and the assignment surface the ladder needs

Gate document per `my-games/CLAUDE.md` rule 1. Written before any code.
Covers the next feature: **divisions + buildable studio rooms**.

**Verdict: BUILD, with one cut.** "Division" as a separate object is cut. A room's
roster *is* the division. What ships is one object — a **bay** (a purchasable
slot in the empire's building programme) holding one **room** (whose effect
lands on one station).

> **Integrator verification note (2026-08-15).** The two defects in §5 were
> checked against source before this document was accepted, and one figure is
> corrected upward:
>
> | claim | status |
> |---|---|
> | No harness policy has ever hired a salesperson | **confirmed** — `tests/harness.mjs` calls `hireBest()` only with `'dj'` (×3) and `'eng'` (×2) |
> | Sales has zero opportunity cost | **confirmed** — `'sales'` appears in `js/sim.js` only in `salesFill()`/`salesPrice()` and the candidate role list; never in a slot, `stationAttn()` or `djLoad()` |
> | Sales multiplier ≈ 1.9× | **understated. Measured 2.70×** — two skill-10 salespeople give strength 14.0 → `fill 0.50→0.95`, `price 1.00→1.42`; one alone already gives 2.34× |
> | Full 1→10 training ladder = $39,640 | **confirmed at $39,636**, i.e. 22.9 complete ladders against $908,882 measured end cash |

---

## 0. What the game actually looks like at hour 10, measured

This is the ground the feature stands on, and it is not what the pressure curve
in `DESIGN.md` assumes.

A day is 5 s at 1×. The harness runs 540 days = **45 minutes of play**. So
"hour 1" ≈ day 720 and "hour 10" ≈ day 7,200 — an order of magnitude past
anything ever measured. Extrapolating from the shipped constants:

**Revenue is hard-capped. Cash is not.**

```
audience(s,p) ≤ POP(p)·cP/(K_MIN + cP),  K_MIN = 0.30·comp.base
```

Best four of the five segments by total POP (`js/content.js` SEGMENTS):

| segment | Σ POP over 4 dayparts |
|---|---|
| citywide | 17,200 |
| countyline | 13,000 |
| ledger | 10,300 |
| nightshift | 7,300 |
| *(quadrangle)* | *6,100* |

`MAX_STATIONS = 4`, so the empire's audience ceiling is **47,800 listeners/day**,
and at TX4/ANT4 (pull ≈ 4,400 against `K_MIN` ≈ 600) share tops out near 0.88.
At ~$1.10/listener (`adRate 1.10 · AD_VALUE 0.42 · fill 0.95 · price 1.30 ·
repRevMul 1.71`) that is a **gross ceiling near $45,000/day**, against ~$5,300 of
top-of-ladder leases.

Cash integrates that forever. Measured end cash at day 540 is $908,882 (solo) /
$1,061,701 (empire). By day 7,200 it is nine figures.

**Three things are therefore *not* scarce at hour 10, and all three are load-bearing:**

1. **Money.** Any room priced in dollars is bought by everyone, always.
2. **Skill.** `trainCostFor(skill) = 200·1.62^skill`; the full 1→10 ladder is
   **$39,636**. At $908k that is 22.9 complete ladders. By hour 2 every staffer
   is skill 10 and people differ only by **role and tag**.
   *Any room mechanic whose decision is "put your best person in the best room"
   is dead on arrival, because there is no best person.*
3. **Headcount.** `refreshCandidates()` yields 2–3/week forever — 1,029 weeks by
   hour 10, ~2,500 candidates offered. `hireFee = salary·8` ≈ $600. There is no
   roster cap. Only ~80 people can be usefully deployed (48 crew seats +
   32 engineer seats across 16 slots), so **surplus people exist by hour 2**.

Point 3 is the one that kills the naive version of this feature. "Rooms consume
person-hours" does not bind at hour 10, because you have people spare. The
feature must bind on something else.

**It binds on ceilings.** Every room's output has a ceiling set by state the
player chose, and a point above the ceiling is worth **exactly zero dollars**.

---

## 1. The shape

```
S.bays  = 0                                  // empire-wide count, cap MAX_BAYS = 6
S.rooms = [ { id, type, station: <idx>, staff: [ids] } ]   // one room per bay
```

- **Empire-wide bay count, per-station room effect.** Bays are capped at 6 no
  matter how many callsigns you hold, so the assignment surface stays sub-linear
  in stations (producer condition #2) — and *which station gets the bay* becomes
  a live decision, because stations differ in segment, gear, schedule and
  saturation.
- `ROOM_SEATS = 3`. A room type may appear at most once per station.
- **A room seat is an assignment.** `staffSlotLoad()` counts it exactly like a
  slot. This is the entire integration: no new scarcity is invented, the existing
  one is deepened.

```
roomPower(r) = Σ over p in r.staff of  ROOM_FIT[r.type][p.role] · p.skill / load[p.id]
```

`load[]` is the map `staffSlotLoad()` already builds once per day for
`stationAttn()`. A person on two slots plus one room has `load = 3` and brings a
third of themselves to each — the same person-hours accounting the v6 condition
lever is built on.

**The two costs of a room seat, both existing mechanisms, both automatic:**

- `attn` falls on every station that person works (`ENG_TEND/load` or
  `DJ_TEND/load` in `stationAttn()`) → condition falls.
- `djLoad(id)` rises → `djFatigue` falls → that slot's `djTerm` falls.

So rooms are **net-negative on the air** unless staffed by surplus people. That
is the correct sign and it is what makes hour 2 the moment rooms turn on.

### The bay ladder

`BAY_LEASE = [40, 120, 340, 900, 2400, 6000]` $/day, paid empty, mirroring
`TX_LEASE`'s shape (which `DESIGN.md` already validated as a non-dominant
ladder). Build cost is a small one-off; **the lease is the price.** Bay 6 at
$6,000/day against a $45,000/day empire ceiling is a genuinely dangerous buy.

Constants are the harness's to retune. The binding condition is stated in §6:
*bay N's lease must exceed the best available marginal room's value at the median
hour-3 state, or the ladder is a shopping list.*

### The five radio rooms

| room | effect | exactly zero when | ceiling set by |
|---|---|---|---|
| **Sales Floor** | this station's `fill` and `price` | — | **rep** |
| **Maintenance Bay** | cuts the *gear* term of `stationWear()` | `tx = ant = 0` | gear index, share |
| **Green Room** | shrinks the fatigue coefficient on this station | nobody double-booked | roster depth vs slots |
| **Newsroom** | `show.appeal` × on this station's talk/news slots | no talk/news slots | schedule |
| **Record Library** | cuts this station's royalty rate | no music slots | schedule |

```
fillCap(st)  = clamp(0.55 + 0.0040·rep, 0.55, 0.95)
priceCap(st) = clamp(1    + 0.0045·rep, 1.00, 1.45)
fill(st)     = clamp(0.50 + 0.040·SF, 0.50, fillCap)
price(st)    = clamp(1    + 0.030·SF, 1.00, priceCap)

wear(st)     = COND_WEAR · (1 + (1 − gearCut)·(WEAR_PER_TX·tx + WEAR_PER_ANT·ant))
gearCut      = min(0.60, 0.060·MB)

fatiguePer(st) = 0.18 · (1 − min(0.55, 0.055·GR))
newsMul(st)    = 1 + min(0.35, 0.035·NR)        // multiplies show.appeal, talk/news only
royalty(st)    = 0.045 · (1 − min(0.55, 0.055·RL))
```

`fillCap`/`priceCap` are the design's spine: **an unknown station cannot sell
premium inventory.** They convert reputation — which the newsroom moves and
faults damage — into the ceiling on the game's largest revenue multiplier.

**Nothing above reads cash, revenue, payroll or any cost.** Room points read
skill, role and assignment load. Ceilings read rep, gear indices, schedule and
roster load. The Purr & Power self-reference trap is untouched.

---

## 2. The non-constant proof

### 2a. The calibration-free half: Newsroom and Record Library

The Record Library's value is a fraction of `revenue · 0.045 · musicShare(st)`.
The Newsroom's value is a multiplier on `show.appeal` for the **talk and news**
slots only. On a four-slot station:

| schedule | Record Library at RL = 10 | Newsroom at NR = 10 |
|---|---|---|
| 4 × music | `0.55 · 0.045 · 1.00` = **+2.48% of revenue** | **+0.00%** |
| 4 × talk/news | **+0.00%** | +35% pull on every slot → at share 0.74, **+7.2% of revenue** |

Their supports are disjoint. The schedule that makes one worth 2.5–7% makes the
other worth **exactly zero**, and the schedule is set slot-by-slot by the player
in `setSlotShow()`. No fixed room priority is optimal; no retune of any constant
can make one so, because the zero is structural rather than numeric.

That alone discharges rule 1. The rest shows the flip is not a two-room curiosity.

### 2b. The full ordering flips across three player-set axes

One **surplus skill-9 person** (load 1, so `roomPower` = fit × 9), one free bay,
flagship revenue R. Marginal value as a percentage of that station's revenue,
then netted against salary at R = $9,000/day.

Fits used: Sales Floor `{sales 1.00, dj 0.55, eng 0.20}`, Maintenance Bay
`{eng 1.00, dj 0.20, sales 0.10}`, Newsroom `{dj 0.70, sales 0.55, eng 0.35}`.

**Sales Floor.** Marginal value per point is `0.040/fill + 0.030/price`, and
**zero above the ceiling** `max((fillCap−0.50)/0.040, (priceCap−1)/0.030)`.

- rep 38 (`fillCap 0.702`, `priceCap 1.171`) → ceiling **5.70 points**. From
  SF = 0, one skill-6 salesperson (6.0 pts) takes fill 0.50→0.702 and price
  1.00→1.171: multiplier `0.702·1.171/0.50 = 1.6442` → **+64.4% of revenue.**
  *The second salesperson is worth exactly $0.*
- rep 88 (`fillCap 0.902`, `priceCap 1.396`) → ceiling **13.2 points**. From
  SF = 13, adding the skill-9 salesperson moves price 1.390→1.396 and nothing
  else: `1.396/1.390 = 1.0043` → **+0.43%** = +$39/day against an $83 salary
  → **net −$44/day. Wrong.**

**Maintenance Bay** at MB = 9 (`gearCut = 0.54`), flagship `attn = 2.00`
(`COND_GAIN·attn = 0.060`), `g = WEAR_PER_TX·tx + WEAR_PER_ANT·ant`:

| gear | `c*` before | `c*` after | Δc/c | × (1−share 0.74) | net of $85 salary at R=$9k |
|---|---|---|---|---|---|
| TX0/ANT0, g = 0 | 0.9583 | 0.9583 | **0.00%** | 0.00% | −$85 |
| TX1/ANT1, g = 0.85 | 0.9229 | 0.9420 | 2.07% | +0.54% | −$37 **wrong** |
| TX4/ANT4, g = 3.40 | 0.8167 | 0.8932 | 9.37% | **+2.44%** | **+$134 right** |

`c* = 1 − wear/(COND_GAIN·attn)`, the closed form from `DESIGN_PROOF_DECAY.md`
§2, with `wear` as above. The bay **flips sign on the gear index alone** — a
thing the player buys in `buyGear()`.

**Newsroom** at NR = 6.3 (skill-9 DJ, fit 0.70) → `newsMul = 1.2205`. On a
station running two talk/news slots carrying half its revenue, at share 0.74:
`P/K = 2.846 → 3.473`, share `0.740 → 0.7765`, ratio 1.0493 → +4.93% on those
slots → **+2.47% of station revenue** = +$222/day against a $68 salary →
**net +$154/day.** On an all-music station: **+$0.00.**

**The ordering table** (same station, same person, same bay):

| state | Sales Floor | Maintenance Bay | Newsroom | Record Library | argmax |
|---|---|---|---|---|---|
| rep 38, TX1/ANT1, all music, SF = 0 | **+64.4%** | +0.54% | 0% | +2.48% | Sales Floor |
| rep 88, TX1/ANT1, all music, SF = 13 | +0.43% | +0.54% | 0% | **+2.48%** | Record Library |
| rep 88, TX4/ANT4, all music, SF = 13 | +0.43% | +2.44% | 0% | **+2.48%** | Library ≈ Bay |
| rep 88, TX4/ANT4, 2 news slots, SF = 13 | +0.43% | +2.44% | **+2.47%** | +1.24% | Newsroom |

Four states, three different argmaxes, one of them negative in the state where
it was previously dominant by 100×. Every axis moved is a thing the player did:
trained rep up, bought transmitters, changed the schedule, filled the sales
floor. **There is no fixed room priority list.** (The Bay/Newsroom/Library
margins in rows 3–4 are inside calibration noise; that is fine. The proof needs
the ordering to *change*, and the sign flip on Sales Floor plus the structural
zeros do that independently of tuning.)

### 2c. Room versus slot — the decision the owner actually asked about

Same surplus skill-9 DJ at the hour-3 state, flagship TX4/ANT4, share 0.74,
$/listener 0.944:

- **As a co-host on the night slot** (POP 1,800, currently a solo skill-9 lead):
  `crewSkill 9 → 9 + 0.55·9 = 13.95`, `djTerm 1.048 → 1.3054`, pull +24.6%,
  share 0.700 → 0.744, +79 listeners = **+$74.6/day**; less the fault-risk rise
  from `loadFactor 1.00 → 1.45` (`slotRisk 0.0162 → 0.0235` at engSkill 9;
  `0.0073 · 0.45 · $1,264` = −$4.2/day). **Net ≈ +$70/day.**
- **In the Newsroom:** **+$154/day.** The room wins.

At the hour-1 state — the same DJ, an **empty** night slot on a TX1 station at
share 0.11 — `djTerm 0.32 → 0.892` is a ×2.79 on pull, share 0.11 → 0.256, and
the slot is worth multiples of any room. **On-air wins by a wide margin.**

So the room-versus-air crossover is real and it lands where it should: rooms
turn on exactly when your slots are covered and your markets are saturated,
which is the dead stretch the game has today.

### 2d. The four rule-checks

- **Depends on player-controlled state?** Yes, on four independent axes: rep
  (sales ceilings), gear index (bay value, zero at TX0), schedule mix (newsroom
  and library have disjoint supports), roster load (green room, and every room's
  `roomPower` divides by `load`). ✓
- **Anything derived from the player's own costs or revenue?** No. Bay leases are
  a fixed ladder; room points read skill/role/load; ceilings read rep, gear
  indices, schedule, load. No money term enters any formula. ✓
- **Necessary and unboundedly purchasable?** Room points are not: above the
  ceiling the marginal point is worth $0, and every ceiling is set by state, not
  bought. **But two pre-existing resources fail this test and must be named** —
  see §5. ✓ *for the feature, ✗ for the game as it stands.*
- **Negative feedback with no counterbalance?** No. Every room effect is bounded
  by an explicit `min()`; `cond` retains its `COND_MIN` floor; `djFatigue` retains
  its 0.40 floor; and unlike gear, **a room seat is reversible in one click**, so
  there is no ratchet. One genuine trap exists and must be surfaced, not removed:
  a Green Room seat raises its own occupant's `djLoad`, which is the fatigue the
  room exists to fix. It is monotone and bounded (no spiral), but a naive player
  can make things strictly worse — readout #3 in §7 exists for exactly this. ✓

---

## 3. Rooms and signal condition — the coupling, bounded

This is the biggest risk in the feature and the answer is deliberately narrow.

**Forbidden, with the arithmetic:**

- **A room may not add to `attn`.** `c* = 1 − wear/(COND_GAIN·attn)` is undefined
  in spirit at `attn = 0`; `stationAttn()` returning anything positive with no
  staff assigned re-opens `LOSABLE: doing nothing eventually goes broke`. A room
  giving +0.5 attn to an unstaffed station sets `c* = 1 − 0.0025/0.015 = 0.833`
  and the idle run never dies. **Hard no.**
- **A room may not cut the base `COND_WEAR` term.** Idle decay is exactly linear
  at `0.0025/day` and the idle death date is `(1−0.35)/0.0025 = 260` days to
  floor, then `−$41.2/day` to bankruptcy at ~day 380 (measured: day 369). A 40%
  cut to the base moves the floor to day 433 and pushes median death past the
  540-day window. **Hard no.**

**Permitted, and only this:** the Maintenance Bay multiplies the **gear-driven**
part of wear.

```
wear(st) = COND_WEAR · (1 + (1 − gearCut)·(WEAR_PER_TX·tx + WEAR_PER_ANT·ant))
```

At `tx = ant = 0` the bracketed term is `1` for every value of `gearCut`. **The
bay's effect on an idle Part 15 station is arithmetically zero.** §3 of
`DESIGN_PROOF_DECAY.md` — the idle death table, the −$41.2/day terminal, the
~day-380 bankruptcy — holds verbatim, with no re-derivation.

And the coupling runs the other way too, which is the part that makes it a
decision: **every room seat lowers `attn` on every station that person works.**
Worked, on a TX4/ANT4 station at `attn = 1.75` (`c* = 0.7905`):

- Seat the empire's engineer (skill 6) in the bay alongside their one slot: their
  load goes 1 → 2, so they bring `ENG_TEND/2 = 0.50` instead of 1.00 →
  `attn = 1.25`; bay points `6/2 = 3.0` → `gearCut = 0.18`. `c* = 1 − 0.0025·
  (1+0.82·3.40)/0.0375 = 0.7548`. **Condition gets worse.** Diluting an engineer
  to build the room that protects the plant is a trap, and the readout must show
  it before the click.
- Seat a **surplus** engineer (load 1, room only): `attn` unchanged, points 6.0
  → `gearCut = 0.36`, `c* = 0.8342`. **Better.**

That asymmetry — rooms are worth building only out of genuine surplus — is the
mechanic, and it is produced entirely by machinery that already ships.

### What it does to the 11/11 harness: nothing

1. **The feature is inert at `bays: 0`.** `newState()` seeds `bays: 0,
   rooms: []`; every formula reduces to today's constants. `idle`, `ads`, `solo`,
   `empire` and `greedy` never build a bay, so all five policies are bit-identical.
2. **The sales refactor is measurement-neutral, and this is checkable.**
   `tests/harness.mjs` calls `hireBest()` only with `'dj'` and `'eng'`
   (`solo`, `empire`, `greedy`); `idle` and `ads` hire nobody. **No policy has
   ever hired a salesperson** — verified — so `roleStrength('sales') = 0`,
   `salesFill() = 0.50` and `salesPrice() = 1.00` in all 200 measured runs.
   Moving the sales bonus from a global scalar into a room changes no measured
   number. The new `fillCap` at rep 0 is 0.55 > 0.50, so the cap never binds at
   baseline either.
3. **Three new assertions, none of them a relaxation:**
   - `LOSABLE: overbuilding bays costs the run` — a `builder` policy that maxes
     bays without staffing them must end below `empire · 0.85`.
   - `SKILL PAYS: rooms beat the same money left in the bank` —
     `rooms.medCash > empire.medCash · 1.10`.
   - **THE GATE — `ROOMS ARE NOT A SHOPPING LIST`:** run `always-sales`,
     `always-bay`, `always-newsroom` and `round-robin` fixed room-priority
     policies against `greedy-on-marginal-value`. **If any fixed priority comes
     within 5% of the state-reading policy, §2 is wrong and this feature must not
     ship.** Same falsifiable shape as the rivals and decay proofs.

   **11/11 → 14/14.**

---

## 4. The failure state

Unchanged in kind, extended in surface: **payroll plus leases outrun
share-limited revenue.** Rooms add three new ways to get there, all of them
legible in advance and all of them the player's doing:

1. **Bay leases are paid empty**, on a ladder reaching $6,000/day at bay 6 — one
   eighth of the empire's entire revenue ceiling, for a room with nobody in it.
2. **Overshooting a ceiling.** Three salespeople on a rep-40 station produce
   ~20 points against a ceiling of 5.25. Two of them are pure salary.
3. **Diluting the air to fill a room.** Every seat costs `attn` (condition) and
   `djLoad` (fatigue). A player who staffs six rooms from their on-air roster
   drives every station's `c*` down and lands in `causeSignalRot`.

New `bankruptCause()` branch, sited after `causeOverExpanded` and before
`causeAdsOnly`:

```
causeOverbuilt — bays > staffed rooms + 1, or Σ roomPower < 0.5 · Σ ceiling
                 "You were paying for four bays and staffing one."
```

---

## 5. Two pre-existing defects this feature must not inherit

Found while reading `js/sim.js`, `js/content.js` and `tests/harness.mjs`. Both
predate the feature; both would silently neutralise it. Both verified against
source — see the note at the top.

**Defect A — sales staff are the only role with zero opportunity cost, and no
harness policy has ever bought one.** A salesperson occupies no slot, adds no
`attn`, carries no fatigue and takes no `loadFactor` risk. `roleStrength('sales')
= Σ skill·0.40ⁱ` reaches 14.0 with two skill-10 hires, giving `salesFill 0.95`
(capped) and `salesPrice 1.42` — a **2.70× multiplier on all empire revenue for
~$166/day of salary** (one salesperson alone is already 2.34×), strictly dominant
and never wrong. It is the largest un-decided lever in the game, and because
`hireBest()` is only ever called for `'dj'` and `'eng'`, every published balance
number describes a game where it was never pulled. **The Sales Floor is the fix**:
sales becomes per-station, gated by a bay lease, capped by reputation, and
staffed at the cost of a person's attention.

**Defect B — skill is necessary and unboundedly purchasable.** `trainCostFor` is
**$39,636** for a full 1→10 ladder against $908,882 of measured end cash — 22.9
complete ladders — with no cap on how many staff you train. By hour 2 everyone is
skill 10. **Consequence for this feature, and it is binding on the build:** the
room decision must never be "your best person in the best room". It is not, by
construction — `ROOM_FIT` is keyed on **role**, and the value differences in §2b
come from role fit, ceilings and the load divisor, not from skill ranking. Do not
add a mechanic that ranks people by skill and calls it a decision.

Neither defect is caused by rooms. Both should be recorded on the card.

---

## 6. Pressure curve

- **Minute 5 — untouched, and that is required.** Bays are locked behind
  `rep ≥ 20` and $2,500. `DESIGN.md`'s $60/day lease against $60.9/day of
  automated gross, and `DESIGN_PROOF_DECAY.md`'s `cond = 1.00` on day 1, both
  survive to the dime.
- **Hour 1 — the ceiling lesson.** The first bay costs $40/day against a
  ~$200/day station: 20% of gross, on a bet. At rep 20 the Sales Floor's ceiling
  is `1.25 + 0.1·20 = 3.25 points` — **one skill-3 salesperson saturates it.**
  The player learns the rule the whole feature runs on: a room is worth its
  ceiling and no more, and the way to make it worth more is to change your
  reputation, not to hire again.
- **Hour 3 — the squeeze.** Roster still thin, slots all contested. Every seat is
  stolen `attn` and stolen fatigue; the Maintenance Bay is negative because the
  gear is small; the Green Room and the Sales Floor fight over the same two
  people. Bay 4 at $900/day exceeds every available room's marginal value at
  this state (best is the Record Library at ~$111/day on a $9k flagship), so
  **bay 4 is a losing buy until a ceiling rises.**
- **Hour 10 — the ceilings are the game.** Money, skill and headcount are all
  surplus (§0). What is not surplus is ceiling headroom. The play becomes: read
  which ceiling is binding, change the state that sets it — swap two slots to
  news to move rep, which moves the Sales Floor's cap, which is worth thousands a
  day; or take a transmitter step, which makes the Maintenance Bay worth building
  — then re-staff to the new ceilings.

**Honest scope note.** Rooms extend the meaningful window from roughly hour 1 to
roughly hour 3. **They do not fill hour 10 on their own, and this document does
not claim they do.** Hour 10 is the mogul ladder's job. Rooms are the thing that
makes the ladder buildable — see §8.

---

## 7. What must appear on screen, named before it is built

This game has twice shipped a mechanic the player could not see: rival capacity
rendered `seg.comp.base`, a static constant, for a whole version; and condition
needed a gauge retrofitted for it. The readouts are specified here, ahead of the
code, and they are not optional.

1. **The Building tab is ONE matrix**, bays × stations — never six panels.
   Producer condition #2.
2. **Every bay card prints its ceiling and what sets it.** The ceiling is the
   number the player is solving for; hiding it is the Purr & Power UI failure in
   reverse.
   `Sales Floor — KXYZ · 8.4 / 13.2 pts · ceiling set by reputation 88`
3. **Points above the ceiling render struck-through with a count.**
   `13.0 / 5.7 pts — 7.3 wasted`. This single number is what stops "hire more,
   stuff every room," and it is the readout most likely to be dropped as clutter.
   It is the most important one on the screen.
4. **Every seat prints its cost, not just its contribution.**
   `Ana Reyes · 2 of 3 assignments · −0.13 attn on KXYZ · fatigue 0.82`
   The person-hour dilution is the entire mechanic and is otherwise invisible.
5. **Marginal value per room**, from the same closed forms: `next point ≈
   +$31/day`. Compute it, don't estimate it — every formula in §1 is closed-form.
6. **The bay-purchase card shows the lease against the best marginal room
   value**: `Bay 4 — $900/day · best room available today returns ~$111/day`.
   Without this the ladder is an invisible trap, exactly as the gear ladder was
   before the wear preview landed.
7. **Daily Brief** gains a bay-lease line and a rooms earned-vs-cost rollup.
8. **`bankruptCause()`** gains `causeOverbuilt` (§4).
9. **A warning on the Green Room specifically**, when the seat you are about to
   fill is already on-air: *"seating Ana here raises her own load — this room
   will get less effective, not more."*

---

## 8. Divisions versus rooms, and the mogul ladder

**Cut "division" as a separate object.** An organisational grouping with no
physical cost is free, and a free grouping is decoration. The room's roster *is*
the division; the bay is what makes it cost something.

The word survives, and this is where it earns its keep. A room type declares
which media it serves:

```
ROOM_TYPES[x].serves = ['radio']
```

A bay on a station offers only rooms whose `serves` contains
`segmentOf(st.segment).medium`. **That is a data join, not a branch** — nothing
in `sim.js` tests the literal string `'radio'`, so `CONTRACT.md`'s TV/film
constraint is honoured. This is the first consumer the `medium` tag has ever had.

**Why the ladder is much easier with this than without it.** Per
`DESIGN_PROOF_RIVALS.md` §8, a venue/label/film is a `SEGMENTS` row riding the
same share equation. But a theatre does not have a morning drive. **Stage 3 has
no daypart grid, and therefore no staff-assignment surface at all.** Without
rooms, "venue" needs a whole new assignment UI and a whole new scarcity invented
from nothing. With rooms:

- a venue is one `SEGMENTS` row (audience and share, already built) **plus three
  `ROOM_TYPES` rows** (box office, stage rigging, front of house) — two content
  tables and one unlock, no architecture;
- and staff flow through the **same `staffSlotLoad()` dilution**, so the engineer
  tending your Class C transmitter is literally the same engineer you want
  rigging the theatre. **The person-hour scarcity becomes cross-medium.** That
  single property is what makes stage 3 a contest instead of an unlock screen.

Build rooms now and the ladder is content. Skip them and the ladder is a second
assignment system.

---

## 9. Save shape and the traps

- **`STATE_VER` 6 → 7.** `S.bays = 0`, `S.rooms = []` seeded in `newState()`;
  `migrate()` seeds them for every `v ≤ 6` save.
- **The migration trap that will otherwise be shipped:** a live v6 save with
  salespeople on payroll is currently earning up to a 2.70× revenue multiplier
  through `salesFill`/`salesPrice`. If sales moves into a room, `migrate()` must
  **grant a free Sales Floor on station 0 and seat every salesperson in it**, or
  the update silently deletes a multiplier the player paid for. Same class as the
  v6 `cond: 1.00` seeding, and it must land in the same commit as the shape change.
- **`firePerson()` must scrub room seats**, not only schedules. `scrubStaffFromSchedules()`
  walks `slot.djs` and `slot.engs`; a fired id left in `room.staff` keeps
  contributing points forever, invisibly. Directly analogous to CONTRACT
  collision #2.
- **`sanitize()`** must: drop unknown room types, clamp `room.station` to the
  station array, cap `staff.length` at `ROOM_SEATS`, drop ids not on the roster,
  reject duplicate ids within one room, and clamp `S.bays` to `[0, MAX_BAYS]`.
- **`catchUp()`** needs no new logic — room effects already reach it through
  `cond` and `S.lastDay.net` — **provided bay leases are summed into the same
  `leases` line in `simulateDay()`**, so the negative-net offline path charges
  them. Adding them anywhere else is a loss-dodge exploit of exactly the kind
  CONTRACT collision #7 documents.

---

## 10. What this pass must not do

- **No room may add `attn` or cut the base `COND_WEAR` term.** §3. This is the
  one line whose violation invalidates a mechanic that took a full pass to land.
- **No room effect may read cash, revenue, payroll or any cost.** The ceilings
  read rep, gear and schedule. The day a ceiling reads what the player earns, the
  game is solved.
- **No room may be priced only in dollars.** §0: cash is unbounded against a
  capped revenue line. The recurring bay lease and the state-set ceiling are what
  make the buy a decision.
- **No skill-ranking room mechanic.** §5, Defect B: everyone is skill 10 by
  hour 2.
- **Zero venue/label/film content this pass.** `serves: ['radio']` on all five
  room types and nothing else. Adding a non-radio room row is the scope breach,
  the same rule `CONTRACT.md` applies to `SEGMENTS`.
- **The `ROOMS ARE NOT A SHOPPING LIST` assertion ships with the code, not
  after it.** If a fixed room priority matches the state-reading policy, this
  proof is wrong and the feature does not merge.

---

## 11. Change list, prioritised

| # | problem | fix | where |
|---|---|---|---|
| 1 | Sales is a strictly dominant, zero-opportunity-cost purchase no policy has ever made | move `salesFill`/`salesPrice` per-station, driven by a Sales Floor room and capped by `fillCap`/`priceCap(rep)` | `salesFill()`, `salesPrice()`, `simulateDay()` — `js/sim.js` |
| 2 | No assignment surface exists that is not a daypart slot | `S.bays`, `S.rooms`, `roomPower()`, `ROOM_FIT`; room seats counted in `staffSlotLoad()` | `js/sim.js`; `ROOM_TYPES` + `BAY_LEASE` in `js/content.js` |
| 3 | Condition coupling is the feature's largest risk | Maintenance Bay cuts **only** the gear term of `stationWear()`; assert `wear(TX0/ANT0)` is unchanged | `stationWear()` — `js/sim.js` |
| 4 | Money-priced upgrades stop being decisions (§0) | rising `BAY_LEASE` ladder paid empty, summed into `simulateDay()`'s existing `leases` line | `leaseFor()`/`simulateDay()` — `js/sim.js` |
| 5 | Newsroom + Record Library are the calibration-free non-constancy proof | `newsMul` on `show.appeal` for talk/news; per-station `royalty(st)` | `slotPull()`, `simulateDay()` — `js/sim.js` |
| 6 | New shape, no version bump; live saves lose their sales multiplier | `STATE_VER = 7`; `migrate()` grants a seeded Sales Floor to any save with salespeople | `newState()`/`migrate()`/`sanitize()` — `js/sim.js` |
| 7 | A fired person keeps earning room points forever | scrub `room.staff` alongside schedules | `firePerson()` — `js/ui.js`; `scrubStaffFromSchedules()` — `js/sim.js` |
| 8 | Invisible ceilings are the exact defect class this doc exists to prevent | the nine readouts in §7, ceiling and wasted-points first | `js/ui.js` + `index.html` |

Harness work rides with #2: one `rooms` policy, one `builder` policy, three new
assertions (§3), 11/11 → 14/14. Constants in §1 are the balance harness's to
retune; the **shapes** — disjoint newsroom/library supports, state-set ceilings,
zero gear-term at TX0, no money in any formula — are not.
