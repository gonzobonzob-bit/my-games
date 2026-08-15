# Callsigns — balance measurement: where idle's money goes, and why empire loses

*Produced by `balance-scientist`, 2026-08-14, branch `callsigns-rivals-build`.
Measurement only — **no game constant was changed**. Every figure below is a
median over N>=30 seeded runs unless labelled otherwise. Probe scripts live in
the session scratchpad, not the repo; the rig is described in §0 so anyone can
rebuild it.*

---

## 0. Instrument

`tests/harness.mjs` drives the real sim through headless Edge over CDP. That is
correct but slow, and it cannot be swept. For this pass the same rig was rebuilt
in Node + `vm` against the real `js/content.js` + `js/sim.js`, with presentation
stubbed and the two `js/ui.js` mutators the policies use (`hirePerson`,
`buyGear`) copied verbatim minus presentation. It uses the harness's exact
mulberry32 PRNG and its exact seed schedule (`1000 + i*7919`).

**It reproduces the harness to the dollar:**

| policy | harness (Edge/CDP) | Node rig | match |
|---|---|---|---|
| idle | $8,098 | $8,098 | exact |
| solo | $317,658 | $317,658 | exact |
| empire | $171,856 | $171,856 | exact |
| greedy | $5,765 | $5,765 | exact |
| ads | died d228 | died d228 | exact |

40 runs x 540 days x 5 policies takes **21 seconds** instead of several minutes,
which is what made the sweeps in §5 affordable. Worst ledger drift across every
run in this document: **1.2e-10** — the ledger reconciles.

---

## 0b. THE FINDING THAT REFRAMES EVERYTHING: no policy has ever hired anyone

`tests/harness.mjs:185`:

```js
if (S.cash >= hireFee(c) + salaryFor(c) * 30) {
```

`salaryFor` is `salaryFor(role, skill)` (`js/sim.js:110`) and does
`ROLES[role].baseSalary`. Passing a **person object** makes `ROLES[obj]`
`undefined`, so the expression throws `TypeError: Cannot read properties of
undefined (reading 'baseSalary')` — every time, before any hire can happen. The
throw is swallowed by the harness's own `try { act(d); } catch (e) {}` at
`tests/harness.mjs:299`.

Measured consequences, 40 seeds x 540 days:

| policy | median staff at end | policy-days that threw |
|---|---|---|
| idle | 0 | 0 |
| solo | **0** | **178 / 540** (= every `day % 3 === 0`) |
| empire | **0** | **178 / 540** |
| greedy | **0** | 49 / 540 |

So the current harness table does not describe the game. It describes:

- **`solo` = idle + a gear ladder.** Zero DJs, zero engineers, forever.
- **`empire` = idle + a gear ladder + expansion.** Same.
- Every slot in every published harness run is running on automation
  (`djTerm = 0.32`), which means the entire staffing pillar, the co-host
  chemistry mechanic, the per-slot engineer mechanic and the fault-risk
  mechanic have **never been exercised by the balance harness**.

This is a fifth instrument defect on top of the four `docs/DESIGN_PROOF_DECAY.md`
§5 already lists, and it is the dominant one. It also **refutes** that document's
diagnosis of failure #2 — see §3.

Every number in §1-§5 below is reported for the harness policies **as they are
today**, because that is what the failing assertions measure. §6 re-measures the
same questions with the hire call corrected, which is the game as designed.

---

## 1. Where idle's money comes from and goes

40 runs x 3,000 days. Idle has no payroll, no capex, no offline.

| window | gross rev/d | lease/d | royalties/d | events/d | **NET/d** | listeners | rep | rival K (citywide) |
|---|---|---|---|---|---|---|---|---|
| d1-90 | $105.43 | -$60.00 | -$3.56 | +$0.11 | **+$43.47** | 97 | 26.3 | 2,169 |
| d91-180 | $98.39 | -$60.00 | -$3.32 | -$1.39 | **+$34.04** | 87 | 31.8 | 2,583 |
| d181-360 | $70.11 | -$60.00 | -$2.37 | -$0.27 | **+$6.46** | 63 | 32.0 | 3,720 |
| d361-540 | $57.90 | -$60.00 | -$1.95 | -$4.59 | **-$7.99** | 51 | 32.1 | 4,400 |
| d541-900 | $58.35 | -$60.00 | -$1.97 | -$4.54 | **-$7.85** | 52 | 32.1 | 4,400 |
| d901-1500 | $58.18 | -$60.00 | -$1.96 | -$4.76 | **-$7.34** | 51 | 32.1 | 4,400 |
| d1501-3000 | $57.88 | -$60.00 | -$1.95 | -$3.84 | **-$7.74** | 51 | 32.1 | 4,400 |

Higher-resolution steady state (60 runs, days 600+):

```
gross revenue      +58.22
lease              -60.00
royalties           -1.96
------------------------------
OPERATIONS net      -3.75      <- the rival lever's entire contribution
random events       -3.98      <- unmodelled, and it is half the hole
------------------------------
TOTAL net           -7.73
```

**Answer to Q1: idle nets about -$8/day at steady state, of which only -$3.75 is
operations.** The other -$3.98 is the random-event line, which is net-negative on
average and is doing as much of the killing as the entire rivals system.

**The drag is hard-capped and the cap binds early.** Citywide rival capacity
reaches its `RIVAL_K_MAX = 2.20x` ceiling (4,400 against a 2,000 base) on
**median day 324**, after which no further pressure is possible at any
`RIVAL_TARGET`. This measurement agrees with `DESIGN_PROOF_DECAY.md` §0's
analytic prediction of t ~ 319 and -$5.4/day; the extra $2 of measured drag is
the event line the analysis did not include.

**Size of the hole a new lever must dig.** Idle peaks at a median **$10,807 on
day 378**. To put the median idle run under the -$4,000 floor by day 540 you need
to remove roughly **$91/day** on top of the current -$7.73, sustained from the
cash peak onward — i.e. **more than the entire $60/day lease line again**, or
about **12x** the drag the rivals system produces today. This is a big lever, not
a small one.

---

## 2. Idle's trajectory: a slow decline, not a plateau

40 runs, extended to 3,000 days.

| day | median cash | p10 | p90 | runs alive |
|---|---|---|---|---|
| 30 | $1,932 | $916 | $2,547 | 40/40 |
| 90 | $4,713 | $2,256 | $6,575 | 40/40 |
| 180 | $7,801 | $4,154 | $10,987 | 40/40 |
| **270** | **$9,446** | $4,483 | $12,562 | 40/40 |
| **360** | $9,324 | $4,815 | $13,298 | 40/40 |
| 450 | $8,230 | $2,813 | $13,348 | 40/40 |
| **540** | **$8,098** | $1,463 | $13,464 | 40/40 |
| 720 | $6,806 | $490 | $11,988 | 40/40 |
| 900 | $6,600 | -$2,005 | $12,334 | 38/40 |
| 1200 | $4,093 | -$1,044 | $10,386 | 35/40 |
| 1500 | $3,237 | -$3,472 | $11,195 | 29/40 |
| 1800 | $2,250 | -$1,275 | $10,440 | 20/40 |
| 2400 | $2,526 | -$585 | $6,424 | 13/40 |
| 3000 | $562 | -$2,798 | $6,704 | 7/40 |

**Answer to Q2: it is a decline. Idle is already losing money at day 540 — it
just has $8,098 of runway left.** The curve turns over at **day ~330-378** and
falls monotonically after that.

- Deaths within 3,000 days: **33/40**. Median death day **1,572-1,656**
  (two independent probes; p10 d946, p90 d2,122).
- Arithmetic runway from the day-540 median at -$7.73/day: **1,554 more days**,
  insolvency at **day ~2,094**. The measured median matches.

So the game already implements "doing nothing eventually goes broke". It does it
**1,100 days after the harness stops watching**. The harness horizon is 540 days;
idle needs ~2,100. Two ways to read that, and they need different fixes:

1. If 540 days is the intended play horizon, the drag must be ~12x stronger.
2. If the drag is right, the assertion is measuring the wrong window — but a
   pressure curve whose failure state is four in-game years away is not a
   pressure curve a player will ever feel.

---

## 3. Why empire loses to solo — and it does not, it is just later

### 3a. The published gap decomposed (40 paired seeds, 540 days)

| | solo | empire |
|---|---|---|
| end cash | $317,658 | $171,856 |
| gross revenue | $441,482 | $479,247 |
| leases paid | -$95,778 | -$151,546 |
| capex | -$15,500 | -$46,500 |
| royalties | -$15,360 | -$18,104 |
| events | +$295 | +$40 |
| end rep | 32.4 | 29.3 |
| stations | 1 | 3 |

Per-station revenue over the run:

| | median earned | tx/ant | lease/d | founded | end share of its segment |
|---|---|---|---|---|---|
| solo #0 (citywide) | $441,482 | 2/2 | $235 | d1 | 28.20% |
| empire #0 (citywide) | **$330,475** | **2/2** | $235 | d1 | 26.87% |
| empire #1 (countyline) | $187,693 | 2/2 | $200 | d305 | 42.70% |
| empire #2 (ledger) | $45,637 | 2/2 | $259 | d380 | 18.02% |
| empire #3 (nightshift) | $34,654 | 2/2 | $165 | d475 | 36.83% |

### 3b. The "stranded flagship" hypothesis is refuted

`docs/DESIGN_PROOF_DECAY.md` §5 predicts the empire flagship is "stranded around
TX2/ANT1 (gear factor 4.03) while solo climbs to TX4/ANT4 (18.40) — a 4.6x pull
gap that fully accounts for $171,856 vs $317,658."

**Measured: both reach exactly TX2/ANT2, and neither ever reaches TX3.** The
`S.active` bug is real, but it is not what costs empire the money — it costs
**time**:

| flagship milestone | solo (median day) | empire (median day) | delay |
|---|---|---|---|
| tx1/ant1 | d120 (36/40 runs) | d176 (31/40) | +56 |
| tx2/ant2 | **d218** (34/40) | **d267** (29/40) | **+49** |
| tx3/ant2 | never | never | — |

Paired timelines (medians):

| day | solo cash | solo rep | tx/ant | flagship $/d | net/d | empire cash | empire rep | tx/ant | n | flagship $/d | lease/d | net/d |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 90 | $4,682 | 31.5 | 0/0 | 106 | 44 | $4,713 | 31.5 | 0/0 | 1 | 105 | 60 | 40 |
| 180 | $7,012 | 32.0 | 1/1 | 193 | 153 | $7,152 | 32.0 | 0/1 | 1 | 108 | 78 | 58 |
| 270 | $28,264 | 31.7 | 2/2 | 535 | 671 | $9,860 | 31.7 | 1/2 | 1 | 220 | 155 | 108 |
| 360 | $111,538 | 32.5 | 2/2 | 1,195 | 1,124 | $22,072 | 31.7 | 2/2 | 2 | 596 | 286 | 699 |
| 450 | $211,365 | 32.1 | 2/2 | 1,400 | 1,150 | $80,864 | 29.9 | 2/2 | 3 | 1,230 | 565 | 1,510 |
| 540 | $317,658 | 32.4 | 2/2 | 1,408 | 235 -> 1,103 | $171,856 | 29.3 | 2/2 | 3 | 1,310 | 694 | **2,151** |

**Read the last column.** At day 540 empire's daily net is **$2,151 against
solo's $1,103** — empire is out-earning solo by 2x at the moment the harness
stops the clock and declares it the loser.

### 3c. Empire overtakes solo at day ~700

40 seeds, horizon extended to 1,440 days:

| day | solo median | empire median | ratio | empire wins (paired) |
|---|---|---|---|---|
| 360 | $111,538 | $22,072 | 0.20 | 4/40 |
| 450 | $211,365 | $80,864 | 0.38 | 4/40 |
| **540** | **$317,658** | **$171,856** | **0.54** | **11/40** |
| 630 | $430,279 | $345,157 | 0.80 | 20/40 |
| **720** | $535,659 | **$655,545** | **1.22** | 27/39 |
| 900 | $756,700 | $1,480,602 | 1.96 | 30/37 |
| 1,260 | $1,174,437 | $2,992,221 | 2.55 | 30/32 |
| 1,440 | $1,389,194 | $3,727,578 | 2.68 | 30/32 |

**Crossover: day ~690-700.** Final daily net: solo $1,160, empire $3,795. Final
station count: solo 1, empire 4.

**Answer to Q3, in one sentence: empire does not lose to solo — it compounds
about 150 days later than solo because it diverts cash into a $26,400 founding
threshold and holds a $6,000 gear reserve instead of solo's $4,000, so it reaches
TX2/ANT2 49 days later; the 540-day horizon cuts the comparison off 150 days
before the crossover at day ~695.**

None of the four candidate causes in the brief is the answer:

- **Station cost amortisation** — real but small: $31,000 of extra capex against
  a $146,000 gap.
- **Split staff quality** — impossible; there is no staff (§0b).
- **Lease stacking** — real: $55,768 more lease over the run. Also not decisive,
  and the extra stations earned $267,984 against it.
- **Rival capacity in thinly-held segments** — measured and it goes the *other*
  way. End-of-run rival K: empire's countyline sits at 419 and ledger at 1,338;
  solo's, un-entered, sit at 2,420 and 3,300 (the ceiling). Empire is *suppressing*
  rivals in the segments it holds. Entering a segment is strictly good for K.

### 3d. Empire's variance: it is unlock timing, not luck in the market

10/40 empire runs beat solo's median. Paired, empire beats solo on 11/40 seeds
(sign test **p = 6.4e-3** — the gap is real at 540 days, not noise).

| | n | median end | unlock day | 1st found day | tx2/ant2 day | median gross |
|---|---|---|---|---|---|---|
| empire runs > solo median | 10 | $466,860 | **d135** | **d221** | **d183** | $949,178 |
| empire runs <= solo median | 30 | $94,665 | **d285** | **d396** | **d302** | $305,592 |

The discriminator is a single number: **how early the run clears the expansion
unlock.** Everything downstream is compounding.

And the unlock gate is on a knife edge. `UNLOCK_REP = 32`, and **the automation
reputation equilibrium is 32.0-32.1** (§1 table). A run that does nothing sits
*exactly* on the gate, so whether it unlocks in the first 200 days is decided by
fault dice, not by play:

| | median unlock day | p10 | p90 | never unlocked in 540d |
|---|---|---|---|---|
| solo | d175 | d119 | — | **6/40** |
| empire | d229 | d134 | — | **9/40** |

That is the source of empire's enormous p10-p90 spread ($1,463 to $475,376): the
p10 runs are runs that never unlocked and are therefore literally idle runs.
Note that `idle`, `empire` and `greedy` all report the **same** p10 of $1,463 —
that is the same seed producing the same never-got-airborne run in all three.

---

## 4. Reachable share range, re-measured

Day-1 state (rep 5, buzz 1, TX0/ANT0, opening rival K), citywide, share of the
segment's four-daypart pool:

| configuration | share | audience/day |
|---|---|---|
| **automation, no staff** | **1.85%** | 318 |
| 1 DJ skill 5 | 3.95% | 679 |
| 1 DJ skill 8 | 4.33% | 745 |
| 1 DJ skill 10 | 4.59% | 789 |
| **3 DJs skill 10 (max crew)** | **5.66%** | 973 |

**The design notes' 1.85% figure is exactly right and still holds.** The 5.25%
"competently staffed" figure is bracketed by 4.33% (one good solo host) and 5.66%
(a maxed three-person crew) — call it confirmed, but note it describes a
*two-to-three-person crew*, not a normal staffed slot.

**The figure the notes are missing is what happens once gear is on the tower:**

| configuration | share |
|---|---|
| automation, TX2/ANT2, rep 32 | **11.18%** |
| 1 DJ skill 8, TX2/ANT2, rep 32 | **23.01%** |
| 1 DJ skill 10, TX4/ANT4, rep 95 | **65.86%** |

`RIVAL_TARGET = 3.2%` therefore only sits inside the live range for roughly the
**first 130 days**, at TX0/ANT0. From TX1/ANT1 onward every playing style is
permanently and enormously above target, rivals are pinned at `RIVAL_K_MIN`
forever, and the lever stops existing. Measured live share at day 540: idle
1.14% (below target, rivals at ceiling), solo 28.20% (rivals at the 600 floor).

**Three-station empire (citywide + countyline + ledger), the number that appears
nowhere in the notes:**

| configuration | per-station | empire-wide |
|---|---|---|
| automation, TX0/ANT0, rep 5 | 1.85% / 3.41% / 2.04% | **2.40%** |
| 1 DJ each skill 8, TX0/ANT0, rep 5 | 4.20% / 7.59% / 4.62% | **5.40%** |
| automation, TX2/ANT2, rep 32 | 11.18% / 19.20% / 12.23% | **14.02%** |
| 1 DJ each skill 8, TX2/ANT2, rep 32 | 22.45% / 35.60% / 24.32% | **27.14%** |

**This matters and the brief was right to suspect it.** An automated 3-station
empire holds **2.40%** empire-wide — *below* `RIVAL_TARGET = 3.2%`, so it is
still losing ground — while an automated single station holds 1.85%. Expanding
onto automation moves you toward the target but does not clear it. More
importantly: because share is computed **per segment**, a small segment is a much
easier place to clear 3.2% (countyline 3.41% on pure automation, already above
target on day one) than citywide. **The rival lever is not segment-neutral: a
3.2% global target is trivially cleared in countyline/nightshift and hard in
citywide.** Any retune of `RIVAL_TARGET` should be per-segment or it will be
mistuned for four of the five segments.

---

## 5. `RIVAL_TARGET` sensitivity — the cliff is real, but it is not where the notes say

All sweeps run against a **copy** of `js/sim.js` in the scratchpad with only
`const RIVAL_TARGET` rewritten. Override verified live in every cell
(`RIVAL_TARGET` read back from the loaded module). 40 seeds x 540 days per cell.

### 5a. Coarse sweep

| target | policy | survive | median end | p10 | p90 | stations |
|---|---|---|---|---|---|---|
| **3.2%** | idle | 100% | $8,098 | $1,463 | $13,464 | 1 |
| | solo | 100% | **$317,658** | $3,392 | $412,665 | 1 |
| | empire | 100% | **$171,856** | $1,463 | $475,376 | 3 |
| **3.5%** | idle | 100% | $6,498 | -$389 | $11,551 | 1 |
| | solo | 98% | **$285,852** | $3,633 | $399,651 | 1 |
| | empire | 100% | **$6,603** | -$389 | $340,802 | **1** |
| **3.8%** | idle | 100% | $5,095 | -$1,465 | $10,412 | 1 |
| | solo | 98% | **$239,702** | $2,754 | $369,540 | 1 |
| | empire | 100% | **$4,876** | -$1,939 | $246,872 | **1** |
| **4.2%** | idle | 98% | $4,557 | -$594 | $9,469 | 1 |
| | solo | 95% | **$9,647** | $1,905 | $347,957 | 1 |
| | empire | 98% | **$4,962** | -$1,905 | $20,184 | 1 |
| 5.0% | idle | 95% | $3,376 | -$1,345 | $8,338 | 1 |
| | solo | 88% | $4,037 | -$1,883 | $226,091 | 1 |
| | empire | 95% | $3,376 | -$1,449 | $6,981 | 1 |
| 8.0% | idle | 90% | $2,174 | -$285 | $6,887 | 1 |
| | solo | 88% | $2,646 | -$862 | $5,818 | 1 |
| 12.0% | idle | 90% | $1,646 | -$760 | $6,327 | 1 |
| | solo | 90% | $1,806 | -$2,269 | $6,320 | 1 |

### 5b. Cliff resolution — there are TWO cliffs, ~0.7pp apart

| target | policy | median end | p90 end | runs > $100k | runs that expanded | runs that unlocked | median unlock day |
|---|---|---|---|---|---|---|---|
| 3.2% | solo | $317,658 | $412,665 | 34/40 | 0/40 | **34/40** | d170 |
| | empire | $171,856 | $475,376 | 25/40 | **28/40** | **31/40** | d217 |
| 3.3% | solo | $299,791 | $407,488 | 34/40 | — | 34/40 | d170 |
| | empire | $116,088 | $467,865 | 21/40 | 25/40 | 26/40 | d205 |
| **3.4%** | solo | $286,442 | $403,921 | 31/40 | — | 33/40 | d180 |
| | empire | **$46,563** | $423,548 | 19/40 | **22/40** | 23/40 | d203 |
| **3.5%** | solo | $269,243 | $399,651 | 29/40 | — | 32/40 | d178 |
| | empire | **$6,603** | $340,802 | 16/40 | **18/40** | 22/40 | d223 |
| 3.6% | solo | $246,807 | $398,327 | 28/40 | — | 32/40 | d181 |
| | empire | $8,761 | $258,618 | 13/40 | 15/40 | 20/40 | d183 |
| 3.8% | solo | $235,980 | $369,540 | 24/40 | — | 32/40 | d197 |
| | empire | $4,876 | $246,872 | 12/40 | 12/40 | 16/40 | d185 |
| **4.0%** | solo | **$96,040** | $369,641 | 20/40 | — | 28/40 | d207 |
| | empire | $5,107 | $189,909 | 8/40 | 10/40 | 16/40 | d193 |
| **4.2%** | solo | **$9,280** | $347,957 | **15/40** | — | 26/40 | d214 |
| | empire | $4,953 | $20,184 | 2/40 | 5/40 | 13/40 | d208 |
| 4.5% | solo | $4,200 | $319,628 | 12/40 | — | 20/40 | d176 |
| | empire | $4,017 | $8,017 | 1/40 | 2/40 | 9/40 | d208 |

**Answer to Q5:**

- **The empire arc's cliff is between 3.3% and 3.5%** — median falls
  $116,088 -> $46,563 -> $6,603 across 0.2 percentage points. The cause is
  visible in the "runs that expanded" column: 28/40 -> 22/40 -> 18/40. Empire's
  median collapses when fewer than half the runs found a second station inside
  540 days. Nothing about the economy changes; the arc simply stops being
  reachable.
- **Solo's cliff is between 4.0% and 4.2%** — median $235,980 -> $96,040 ->
  $9,280.
- **The notes' claim that 4.2% "collapses everything to $10,403" is CONFIRMED for
  the median and REFUTED as a description of the distribution.** At 4.2% solo's
  median is $9,280 — but its **p90 is still $347,957** and 15/40 runs still clear
  $100k. 4.2% does not flatten the economy; it knocks slightly more than half the
  runs out of bootstrap and drags the median with them.

**The mechanism at both cliffs is the same, and it is not the economy — it is the
unlock gate.** Follow the "runs that unlocked" column: 34/40 at 3.2%, falling
monotonically to 20/40 at 4.5%. `RIVAL_TARGET` does not make late-game play
harder (§4: by TX1/ANT1 nobody is anywhere near the target). It makes the **first
150 days** poorer, which delays `cash >= 9,000` and holds `rep` under the 32 gate
that automation already sits exactly on. Runs that clear the gate go on to make
$300k+ regardless of the target; runs that do not, end at ~$4,000. The
distribution is bimodal at every value above 3.4%, which is why the median moves
in cliffs while the p90 barely moves at all.

**Consequence for tuning:** `RIVAL_TARGET` is a *bootstrap-difficulty* knob
mislabelled as a *late-game-pressure* knob. Raising it cannot create late-game
pressure (the ceiling in §1 caps that at -$3.75/day no matter what), and it
destroys the expansion arc long before it makes idle die. **Do not use
`RIVAL_TARGET` to fix `LOSABLE`.**

---

## 6. The same questions with the hire call corrected

Same rig, same seeds, same game constants, only `salaryFor(c)` ->
`salaryFor(c.role, c.skill)` in the policy, plus the three other instrument
defects from `DESIGN_PROOF_DECAY.md` §5 fixed (`loadFactor(slot)`,
engineers placed on the right station, `uncoveredSlots().length`).

Note: with the `uncoveredSlots().length > 1` guard now actually *firing*, a
competent empire can never expand — one or two engineers cannot cover 3 of 4
slots empire-wide. That guard as written makes expansion unreachable for any
realistic roster. Rows below are with the guard removed; keeping it produces
`empire+` = $1,031,579 with median 1 station.

| policy | survive | median end | p10 | p90 | stations | staff | dj/eng | payroll/d | lease/d | net/d |
|---|---|---|---|---|---|---|---|---|---|---|
| idle | 100% | $8,098 | $1,463 | $13,464 | 1 | 0 | 0/0 | $0 | $60 | -$6 |
| solo (broken) | 100% | $317,658 | $3,392 | $412,665 | 1 | 0 | 0/0 | $0 | $235 | $1,103 |
| empire (broken) | 100% | $171,856 | $1,463 | $475,376 | 3 | 0 | 0/0 | $0 | $694 | $2,151 |
| **solo+** | 100% | **$1,052,664** | $965,709 | $1,149,124 | 1 | 5 | 4/1 | $174 | $1,360 | $2,960 |
| **empire+** | 100% | **$2,074,840** | $1,737,959 | $2,303,680 | 4 | 18 | 16/2 | $712 | $2,679 | $7,619 |
| **greedy+** | 100% | **$1,111,068** | $944,660 | $1,348,971 | 4 | 4 | 4/0 | $151 | $219 | $3,906 |
| **neglect+** | 100% | **$756,093** | $614,824 | $929,993 | 4 | 16 | 16/0 | $607 | $219 | $3,328 |

Paired sign tests, same seeds, N=40:

| comparison | median diff | p10 | p90 | wins | sign-test p |
|---|---|---|---|---|---|
| empire+ vs solo+ | +$1,054,832 | +$684,887 | +$1,241,680 | **40/40** | 1.8e-12 |
| empire+ vs greedy+ | +$975,559 | +$489,744 | +$1,270,338 | 40/40 | 1.8e-12 |
| solo+ vs neglect+ | +$283,147 | +$54,579 | +$423,893 | 38/40 | 1.5e-9 |
| greedy+ vs neglect+ | +$342,918 | +$177,630 | +$471,228 | 38/40 | 1.5e-9 |
| **solo+ vs greedy+** | -$44,121 | -$354,183 | +$68,039 | **17/40** | **0.43 — indistinguishable** |
| empire vs solo (current) | -$105,891 | -$290,400 | +$58,174 | 11/40 | 6.4e-3 |

Four things fall out of this, and they should drive the next pass:

1. **`SKILL PAYS: expansion is worth more than standing still` passes cleanly
   once the harness can hire** — empire+ beats solo+ on **40/40 seeds**, by 2x.
   The assertion is failing because of the instrument, not the economy. Fix
   `tests/harness.mjs:185` before touching a single game constant.
2. **`LOSABLE` still fails, and correcting the harness does not touch it** —
   idle is unaffected by any of these fixes. §1 and §2 stand: the lever needed is
   ~$91/day, and `RIVAL_TARGET` cannot supply it (§5).
3. **Variance collapses to nothing once staffing works.** solo+ runs from $966k
   to $1,149k across 40 seeds — a p10/p90 span of ±9%. Zero deaths across four
   profiles including a reckless one and a neglectful one. The staffed economy is
   currently *unloseable*, which is a separate finding from idle being unloseable
   and a more serious one.
4. **ESCALATE: reckless expansion and careful single-station play are
   statistically indistinguishable** (solo+ $1,052,664 vs greedy+ $1,111,068,
   17/40 wins, p = 0.43). `greedy+` runs **4 stations on 4 DJs and zero
   engineers** and scores the same as a fully-crewed single station. Per
   CLAUDE.md rule 2, two policies landing on the same distribution means the
   central decision is not a decision. Note this is measured with the
   never-expand-onto-a-hole guard removed from both; the game itself has no such
   guard, so this is the live incentive.

---

## 7. Summary of what is measurement and what is defect

| # | finding | kind |
|---|---|---|
| 1 | `salaryFor(c)` in `tests/harness.mjs:185` throws; no policy has ever hired | **instrument defect (new)** |
| 2 | idle steady state is -$3.75/d operations, -$7.73/d with events; K ceiling binds at d324 | measurement |
| 3 | idle declines from d~378 and dies at d~1,600 median, 1,100 days past the harness horizon | measurement |
| 4 | empire crosses solo at d~695; at d540 empire's daily net is already 2x solo's | measurement |
| 5 | empire's variance is unlock timing; automation rep equilibrium 32.1 sits exactly on `UNLOCK_REP = 32` | **design risk** |
| 6 | 1.85% automation share confirmed; 3-station automated empire holds 2.40%, still below target | measurement |
| 7 | share range with gear is 11-66%, so `RIVAL_TARGET` only exists as a lever for ~130 days | **design risk** |
| 8 | `RIVAL_TARGET` is segment-relative: countyline clears 3.2% on day-one automation, citywide cannot | **design risk** |
| 9 | empire cliff at 3.4-3.5%, solo cliff at 4.0-4.2%; both are the unlock gate, not the economy | measurement |
| 10 | 4.2% collapses the median but not the p90 — the distribution is bimodal, not flattened | measurement (refines the notes) |
| 11 | with hiring fixed, empire+ beats solo+ 40/40 (p=1.8e-12) | measurement |
| 12 | with hiring fixed, nothing dies in 40 runs across 4 profiles | **design defect** |
| 13 | greedy+ and solo+ are indistinguishable (p=0.43) | **design defect — escalate** |

**No constant was changed in this pass.** The recommended order of operations is:
fix `tests/harness.mjs` (items 1 and the four in `DESIGN_PROOF_DECAY.md` §5),
re-run the harness, and re-open the balance question against a table that
describes the game rather than an unstaffed subset of it. On today's evidence
`SKILL PAYS` will go green on its own and `LOSABLE` will not.
