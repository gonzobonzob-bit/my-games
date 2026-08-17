# Callsigns — design proof, voice-tracking

Reasons forward from `RESEARCH_RADIO_OPERATIONS.md` §5
([FCC unattended operation](https://www.fcc.gov/media/radio/unattended-operation),
[Wikipedia: voice-tracking](https://en.wikipedia.org/wiki/Voice-tracking) — one
talent across multiple dayparts *and* multiple stations, from anywhere). Reuses
the self-reference check format of `DESIGN_PROOF_ROOMS_V3.md` §3.

## 1. The core decision

Per slot, every few days: **run this shift live, or have the jock pre-record it
— buying coverage with a fraction of a person, and paying for it with the
localism penalty and with the fact that nobody is in the building tending the
plant.**

This is not a new scarcity. `staffSlotLoad()` already dilutes a person over N
assignments; voice-tracking is the real-world mechanism that dilution *is*.
Today the 1/N rule is a rule. After this it has a reason, and the player
controls the N.

## 2. The objects, and what they are in the real world

| Object | Real counterpart |
|---|---|
| `slot.mode = 'live'` | a jock in the air studio for the shift |
| `slot.mode = 'tracked'` | breaks cut into automation ahead of time; playout unattended, FCC-permitted |
| `TRACK_LOAD = 0.35` | a three-hour shift tracked in ~an hour including prep and log approval. Conservative end of the real 0.2–0.4 band, so tracking is never free |
| `TRACK_APPEAL = 0.88` | localism: no live phones, no real-time weather or traffic, no local reference |
| zero `attn`, no engineer seat | there is no shift, so there is nobody in the building |

Nothing is invented. No new purchasable, no new stockpile, no fifth resource.

## 3. The value formulas and the self-reference check

```
staffSlotLoad()  load[id] += trackedOn(slot) ? TRACK_LOAD : 1     (DJs and room seats)
djLoad(id)       same fractional count, so fatigue reflects tracked hours
stationAttn(st)  if (trackedOn(slot)) continue;   // before the eng/dj branch
quality          show.appeal · djTerm · parts · (trackedOn(slot) ? TRACK_APPEAL : 1)
```

| input | player sets it | for this mechanic? |
|---|---|---|
| `slot.mode` | yes | yes — it **is** the choice, as `pts` is the purchase in v3 §3a |
| `TRACK_LOAD`, `TRACK_APPEAL` | no | world constants, sourced above |
| `DJ_TEND`, `ENG_TEND`, `COND_GAIN`, `COND_WEAR`, `COND_MIN`, `FATIGUE_PER_LOAD` | no | world constants, untouched |
| `st.tx`, `st.ant` (via `stationWear`, which sets where the floor bites) | yes | **no, and anti-correlated.** Plant is bought for reach/fidelity at up to $900/day lease, and it *raises* wear — which raises the marginal value of attention, which makes tracking **worse**. Buying a transmitter to make tracking pay is paying $900/day to devalue your own choice |
| roster depth (`S.staff`) — the flip axis in §4 | yes | **no, and anti-correlated.** A deeper roster makes tracking worse: the second DJ is worth +51% of station pull against the 5.2% tracking ever returns in the thin state. To make tracking pay you would have to *under-hire*, which is dominated in every other term |
| daypart revenue weight (`segPop × SHOWS[show].parts`) | segment and show, yes | **no — and the direction is the whole point.** `newsMul()` **paid** in proportion to a schedule choice made knowing the room existed. `TRACK_APPEAL` **charges** in proportion to one. A high-weight, high-appeal slot is *more expensive* to track, so the incentive is to schedule better shows, not worse. A penalty cannot self-reference in the payoff direction |
| station gross (`fill`, `price`, `S.rep`, `audience`) | yes | **not an input at all.** None of the four formulas read cash, revenue or payroll. Stronger: the live-vs-tracked comparison is `[c*_T/c*_L] · [Σwq_T/Σwq_L]`, homogeneous of degree 1 in station gross, so **gross cancels exactly from the crossover** |

**PASS.** Structural zero: with `mode = 'live'` everywhere — the default, and what
every v8 save migrates to — all four expressions are the shipped ones character
for character. A run that never tracks is **bit-identical** to v8.

## 4. The non-constant arithmetic — one ordering, flipped

One citywide station, all music, skill-6 solo DJs, chem 1.00, **TX3/ANT2** →
`wear = 0.0025·(1+2.25) = 0.008125`, no Rack Room. Weights `w = segPop × parts`:
morning 5700, midday 6720, evening 5200, night 2160; `Σw = 19780`.
`djTerm(f) = 0.58 + 0.312·f`, `f = 1 − 0.18(L−1)` floored 0.40.

**The switch is the condition floor.** `∂c*/∂attn = wear/(COND_GAIN·attn²)` is
**exactly zero** once `attn ≤ wear/((1−COND_MIN)·COND_GAIN)` = `0.008125/0.0195`
= **0.41667**. Above that line the attention tracking gives up is real money;
below it, it is arithmetically free and only localism and fatigue remain.

**Arm A — two DJs, two slots each.**
- all live: `L=2, f=0.82, djTerm 0.83584`; `attn = 0.500` (above) →
  `c* = 0.45833`. Score `0.45833 × 19780 × 0.83584 =` **7,577.9**
- night tracked: `L = 1.35, djTerm 0.872344`; `attn = 0.43519` (still above) →
  `c* = 0.37766`, `Σwq = 16,631.0`. Score **6,280.4**
→ **live wins by 20.7%**

**Arm B — one DJ, all four slots.** Same station, day, plant, schedule.
- all live: `L=4, f=0.46, djTerm 0.72352`; `attn = 0.250` (below) →
  `c* = COND_MIN = 0.35`. Score **5,008.9**
- evening + night tracked: `L = 2.70, djTerm 0.796528` / tracked `0.700945`;
  `attn = 0.18519` (below) → `c* = 0.35, identical`. `Σwq = 15,051.8`.
  Score **5,268.1**
→ **tracked wins by 5.2%**

**The ordering reverses on roster depth**, a state the player controls and does
not set for this reason. No fixed heuristic survives: "never track" loses 5.2%
in Arm B, "track the low-weight dayparts" loses 20.7% in Arm A, and the cut line
moves again the day a transmitter is installed (TX0 → TX3/ANT2 moves the
threshold from `attn ≤ 0.128` to `attn ≤ 0.417`, dropping a station that was
safely above it underneath, for a purchase made entirely for reach). The
*ranking* of slots by weight is fixed; **how far down it you cut is not.**

## 5. Signal condition — and why `LOSABLE` does not re-open

1. **The attention ceiling is unchanged.** `attn(st) ≤ Σ_{live slots} TEND_i` —
   exactly today's bound. Tracking **redistributes** presence; it can never mint
   a maximum all-live could not already reach. The `Math.max(1, …)` in
   `stationAttn()` is what protects this and must stay.
2. **Every conversion strictly lowers empire attention.** `L/(L+κT) < 1` for
   `T>0, κ<1`, and `f(L)` is increasing in `L`, so converting any slot
   live→tracked is a **monotone decrease**. No configuration raises attention.
3. **`LOSABLE` is untouched, structurally.** An idle run never sets a mode;
   `mode` defaults `'live'` and unknown values sanitise to `'live'`. Idle still
   floors in 260 days and dies **day 369**. Asserted as bit-identity, not "close".
4. **A fully-tracked station lands on `COND_MIN = 0.35` and stops.** Pull ×0.35,
   revenue positive, lease and payroll unchanged — a **new road to bankruptcy,
   not a new way to survive.** It makes `LOSABLE` stronger and gets its own arm.
5. **No death spiral.** Recovery is proportional; the instant one slot goes live
   the gap closes geometrically — at TX0 with `attn = 0.5`, a **46-day
   half-life**. Floored at 0.35 down, capped at `c*` up. Condition still reaches
   `slotPull()` and nothing else; the spiral guard is unmodified.
6. **The reputation path is one-directional.** `TRACK_APPEAL` sits in `quality`,
   so it reaches `repTarget` as `show.appeal` already does. Fully tracking four
   music slots moves `avgQuality` 1.05925 → 0.93214 → `repTarget` down **9.9
   points**. `quality` reads no rep, cash or fill, so there is no loop to close.
7. **Fault risk rises, and that is the real thing.** A tracked slot takes no
   engineer, so `slotRisk` goes 0.0214 → 0.0600 — dead air with nobody in the
   building, the classic unattended failure. Four stations fully tracked sits
   **4.8 rep below target**, against the documented 3.6 at three stations.
   Finite. Not a spiral.

## 6. What it costs, on screen, before the choice

The slot editor renders, for the **tracked** option, while it is still
hypothetical:

- **`0.35 of an assignment` against `1.00`** — the person-hours price, next to
  that DJ's current total load.
- **`Attention 0.00 — nobody is in the building`**, and the station's settling
  point **before → after**, in `conditionCard()`'s existing "settles at N%"
  idiom. This must be visible *first*, because it is the cost that arrives 46
  days late.
- **`Localism −12% appeal`** beside `djTerm` on the slot's pull readout.
- **Engineer row greyed**, reason stated, and the slot's fault chance shown
  rising from its live value to its tracked value.
- **When the station is already pinned at `COND_MIN`:** say so — "this signal is
  already at the floor; tracking costs it no further attention." That is the
  honest disclosure of Arm B, and it is a *state* readout, not advice.

**What must not be shown:** any recommended mode, any crossover threshold, any
"track slots under weight W". That is printing the number the player is solving
for — the Purr & Power sin verbatim.

## 7. Failure state, pressure curve, scarce resource

**Failure state:** bankruptcy, unchanged. New road to it: an over-tracked group
sits at `COND_MIN` on every signal, gives up ~10 points of `repTarget`, triples
its fault rate with no engineer anywhere, and pays full payroll for it.

**Minute 5** — unchanged, deliberately. One station at TX0, `attn = 0.25` sits
*above* the 0.128 threshold, so tracking loses. The readout appears and states
its cost; the mechanic announces itself without yet demanding a choice.

**Hour 1** — the second station. One roster spans eight slots; live-everywhere
puts every DJ at load 4 and both signals at `attn 0.25`. The first genuine cut:
concentrate live presence on one callsign and track the other's low-weight
dayparts, knowing it drifts to 0.35 over a 46-day half-life.

**Hour 10** — installing TX3/ANT2 moves the threshold `0.128 → 0.417` and drops
a station underneath it, inverting that station's answer on a purchase made for
reach; hiring one DJ inverts it back. Meanwhile `tickRivalCapacity()` compounds
in segments you under-serve, so the tracked signal's share erodes and the cut
must be re-made against a market that moved. The decision carries a 46-day
commitment cost, so it is a plan, not a toggle.

**Scarce resource:** person-hours through `staffSlotLoad()`, unchanged.
Voice-tracking changes its **exchange rate**, not its identity. There is
deliberately **no per-slot cash discount** — the saving is the hire you do not
make, and a per-slot pay cut would read payroll, which is forbidden and would
re-open the cost-basis class of defect.

## 8. The gate, and the instrument break

`STATE_VER` **8 → 9**: new per-slot `mode`. `sanitize()` maps absent/unknown →
`'live'`, which is what makes both the migration and the structural zero free.

**Gate VT-1.** Paired by seed, N ≥ 60, ≥ 540 days.

- **(a)** `readsState` beats **both** `neverTrack` and `alwaysTrackButOne` by
  ≥ 5% of end cash, paired 95% CI excluding zero.
- **(b) The sign must reverse.** `neverTrack` beats `alwaysTrackButOne` in a
  **deep-roster arm**; `alwaysTrackButOne` beats `neverTrack` in a **thin-roster
  arm**. If either wins both, the choice is decoration — say so and cut it.
  **Before believing (b), assert `mean(staffCount)` differs by ≥ 2 between the
  arms**, or it is one run measured twice.
- **(c)** A run that never tracks matches the v8 build **to the cent** on the
  same seed — cash, `S.rep`, and every station's `cond` trajectory.
- **(d)** On a station pinned at `COND_MIN`, the measured condition cost of
  tracking a slot is **exactly 0.0000**.
- **(e)** The idle arm still dies at median day 369 (±10), and a new
  `trackEverything` arm dies **sooner**, not later.

**Instrument break first (rule 5), before any of the above is believed:**

1. `TRACK_LOAD = 1.0` → (a) and (b) must both **scream**. If (b) still reverses
   with tracking made worthless, the two arms are the same run.
2. `TRACK_APPEAL = 1.0` → `alwaysTrackButOne`'s margin in the thin arm must
   **widen**. If nothing moves, the multiplier is not wired into `quality` —
   check **both** sites, because wiring one and not the other makes pull and
   reputation silently disagree.
3. `COND_MIN = 0.0` → (d) must **fail**. The floor is the entire switch in §4.
4. Delete `if (trackedOn(slot)) continue;` in `stationAttn()` → (e) must fail,
   idle must survive past 540. That is the exact shape of the failure this
   mechanic is most likely to ship with.

## 9. Change list, prioritised

1. **`slot.mode` + `trackedOn(slot)`; `STATE_VER 8 → 9`** — `defaultSchedule()`,
   `newStation()`, `migrate()`, `sanitize()`. Default and fallback `'live'`.
2. **`staffSlotLoad()`** — `load[id] += trackedOn(slot) ? TRACK_LOAD : 1`; a
   tracked slot takes no engineer assignment at all.
3. **`stationAttn()`** — `if (trackedOn(slot)) continue;`. This is the
   load-bearing line; §5.2 and gate (e) are about it.
4. **`djLoad()`** — same fractional count. Its return becomes a float: audit
   every caller doing `djLoad(id) - 1` or rendering it as a slot count.
5. **`slotPull()` and the mirrored `quality` in `simulateDay()`** —
   `× (trackedOn(slot) ? TRACK_APPEAL : 1)`. **Both sites or neither.**
6. **Slot editor readout per §6** — reusing `conditionCard()`'s settling idiom.
   No recommendation, no crossover.
7. **`TRACK_LOAD = 0.35`, `TRACK_APPEAL = 0.88`** with the §2 citations.
8. **Harness: gate VT-1 (a)–(e) plus the four instrument breaks**, breaks run
   and seen to fail first.
