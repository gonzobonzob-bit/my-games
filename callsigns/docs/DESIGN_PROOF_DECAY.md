# Callsigns — design proof: signal condition (the second lever)

*Produced by `design-architect` in the 100% hardening pass, 2026-08-14. The four
harness defects in §5 were independently verified against source by the
integrator before any of this was acted on — see the verification note at the
end of §5.*

## Verdict

**Automation decay: ACCEPT, in a specific form** — a per-station `cond`
multiplying `slotPull()`, worn by *watts* and tended by *person-hours*. It closes
#1 (LOSABLE) with a median idle death at ~day 380 of 540.

**Escalating lease: REJECT.** Arithmetic in §1.

**#1 and #2 need separate treatment, and #2 is probably not a game defect at
all.** There is a defect in the measuring instrument that fully accounts for the
$171,856 vs $317,658 gap. Fix the harness before changing the economy.

---

## 0. Baseline, re-derived so the rest is checkable

Day 1, citywide, TX0/ANT0, no staff, rep 5, default schedule
(music/music/talk/music).
`slotPull = 92·quality·reach·fid·segFit·(1+rep/62)·buzz`, `djTerm=0.32`
unstaffed.

| daypart | quality | pull | POP | audience | rev |
|---|---|---|---|---|---|
| morning | 0.304 | 31.7 | 6000 | 93.7 | $22.42 |
| midday | 0.512 | 53.4 | 4200 | 109.3 | $26.15 |
| evening (talk) | 0.316 | 29.9 | 5200 | 76.6 | $19.99 |
| night | 0.384 | 40.1 | 1800 | 35.4 | $8.47 |

Gross **$77.0/day** (DESIGN.md's $60.9 was against `SEG_FALLBACK`; `content.js`
pops and `fit.music = 1.05` are live, so the real figure is $77). Royalties
$2.60, lease $60 → **net +$14.4/day at rep 5**.

Idle rep does not stay at 5. `repTarget = 0.379·78 + 0.24·14 = 32.9`; recovery is
proportional (0.05) and fault drift additive (0.0723/day) → equilibrium
**rep ≈ 31.5**. That lifts pull ×1.396 and `repRevMul` to 1.225 → gross $122.5,
**net +$58.4/day**. This reproduces DESIGN.md's "+$58.8/day idle" exactly, so the
model is calibrated.

**Why idle survives today, in one line.** Held citywide share at rep 31.5 is
`436.3/17200 = 2.537%`. `drift = 1 − h/RIVAL_TARGET`, `h ≈ 50.74/K`, so

```
dK/dt = 0.006·K·(1 − 1585.6/K) = 0.006·(K − 1585.6)     ← linear
K(t)  = 1585.6 + 414.4·e^{0.006t}                        → hits RIVAL_K_MAX (4400) at t ≈ 319
```

At K = 4400 idle revenue is $56.5 and net is **−$5.4/day**. That is the *worst
case the rival lever can ever produce*, because `RIVAL_K_MAX = 2.20` bounds it.
Integrating net over 540 days gives closing cash **$8,328** — the harness
measured $8,098. The rival term is arithmetically incapable of killing an idle
run; no value of `RIVAL_TARGET` fixes that, only `RIVAL_K_MAX`, and raising that
ceiling is what collapsed the economy at 4.2%.

---

## 1. Escalating lease — rejected, with the arithmetic

Any escalation multiplies `(BASE_LEASE + TX_LEASE + ANT_LEASE)·leaseMul`. To move
idle from +$8,328 to below the −$4,000 floor you need ~$13,000 of extra cost, avg
$24/day on a $60/day line — roughly **+40%/year compounding**.

The same 40%/year lands on a TX4/ANT4 flagship at $1,360/day as **+$860/day at
day 540**, and on a four-station empire as ~4× its per-station line. So:

- It is **strictly worse for expansion** — cost scales with callsign count,
  revenue does not.
- It depends on **no state the player controls** except gear index. "Pay it" is
  the only play. Constant.
- It cannot distinguish attended from unattended, which is the entire
  distinction #1 needs.

Reject. It closes #1 by making #2 worse, which is the trade the brief forbids.

---

## 2. The lever: station condition

New per-station field `cond ∈ [COND_MIN, 1]`, starting at **1.00**.

```
wear(st) = COND_WEAR · (1 + WEAR_PER_TX·st.tx + WEAR_PER_ANT·st.ant)
attn(st) = Σ over st's 4 slots of ( ENG_TEND if engIdsOf(slot).length
                                    else DJ_TEND if slot.djs.length
                                    else 0 )
cond ← clamp( cond + COND_GAIN·attn·(1 − cond) − wear(st), COND_MIN, 1 )
```

and `slotPull()` gains a single trailing factor `· st.cond`.

**Constants to try first:**

| constant | value | why this number |
|---|---|---|
| `COND_WEAR` | **0.0025**/day | (1 − COND_MIN)/0.0025 = 260 days to floor from a standing start. See §3 — it is the number that dates the idle death. |
| `WEAR_PER_TX` | **0.55** | TX4 = 2.20 extra; a 100 kW/600 m plant wears 3.2× a Part 15 rig. Makes the top of the gear ladder cost person-hours. |
| `WEAR_PER_ANT` | **0.30** | Half the transmitter line, mirroring `ANT_LEASE ≈ ½ TX_LEASE`. |
| `COND_GAIN` | **0.030**/attn-unit/day | Set so 4 DJs alone hold a TX0 station at 0.917 — the early game is never gated on the scarce engineer. |
| `ENG_TEND` | **1.00** | |
| `DJ_TEND` | **0.25** | A host notices the audio is wrong; they don't climb the tower. |
| `COND_MIN` | **0.35** | Bounds the drag. Sets the idle terminal loss at −$41.2/day (§3). |

**Equilibrium is closed-form**, which is why this shape was chosen over a linear
drift:

```
c*(st) = 1 − wear(st) / (COND_GAIN · attn(st))        floored at COND_MIN
```

| station | attn | wear | c* |
|---|---|---|---|
| idle, TX0 | 0 | 0.0025 | 0.35 (linear decay, 260 days) |
| 1 DJ, TX0 | 0.25 | 0.0025 | 0.667 |
| 4 DJs, TX0 | 1.00 | 0.0025 | 0.917 |
| 4 DJs + 1 eng, TX0 | 1.75 | 0.0025 | 0.952 |
| 4 DJs + 2 eng, TX2/ANT2 | 2.50 | 0.00675 | 0.910 |
| 4 DJs, TX4/ANT4 | 1.00 | 0.011 | 0.633 |
| 4 DJs + 1 eng, TX4/ANT4 | 1.75 | 0.011 | 0.790 |
| 4 DJs + 4 eng, TX4/ANT4 | 4.00 | 0.011 | 0.908 |

Marginal engineers on the flagship buy **+15.7pp, +6.6pp, +3.0pp, +1.5pp**.
Properly diminishing, so "an engineer on everything" is never automatic.

### It is not anti-expansion, and here is why

Wear is charged against **watts, not callsigns**. A solo Class C / 12-bay station
needs 4 engineers on 4 slots to hold 0.91. A four-station empire at Class A /
2-bay (`wear = 0.0025·(1+0.55+0.30) = 0.00463`) holds 0.91 with **one engineer
per station** — `attn = 0.75 + 1 = 1.75`, `c* = 1 − 0.00463/0.0525 = 0.912` —
which is 4 engineers on 4 different dayparts, legal under the
one-engineer-per-daypart rule. **Same 4 engineers either way.** The lever is
neutral between concentration and spread, which is the property
`RIVAL_TARGET 4.2%` did not have.

The reckless cases get worse, correctly: `greedy` expands with no staff →
`attn = 0` on every new signal → all decay to 0.35. `ads` never hires a DJ at all
→ `attn = 0` empire-wide.

---

## 3. Why idle crosses into insolvency inside 540 days

`attn = 0` kills the gain term, so decay is exactly linear:
`cond(t) = max(0.35, 1 − 0.0025t)`, floor at day 260. Condition multiplies pull,
so held share drops, so K compounds faster: `dK/dt = 0.006·(K − 1585.6·cond)`, K
capped at 4400. Euler, 25-day steps, `R(t) ≈ 122.5·cond·2000/K`:

| day | cond | K | rev/day | net/day |
|---|---|---|---|---|
| 0 | 1.000 | 2000 | 122.5 | **+58.4** |
| 50 | 0.875 | 2148 | 99.8 | +36.4 |
| 100 | 0.750 | 2592 | 70.9 | +8.5 |
| 125 | 0.688 | 2817 | 59.8 | −2.2 |
| 200 | 0.500 | 3815 | 32.1 | −29.0 |
| 260 | 0.350 | 4400 | 19.5 | **−41.2** |

Cumulative to day 260: **+$130**. Peak cash **≈ $4,300 around day 110**. Cash at
day 260 = $930, then a flat −$41.2/day:

> **bankruptcy at day 260 + (930+4000)/41.2 ≈ day 380.**

That is inside the 540-day window with 160 days of margin for event noise.
Harness should read `idle.survivalRate ≤ 10%`, median death day **360–420**.

**Noticeable but not punishing.** Day 1 `cond = 1.00`, so the minute-5 arithmetic
is untouched to the dime. The gauge reads 92% at day 30, 85% at day 60, 75% at
day 100. First negative day is ~125. A player who hires four DJs — which the game
already teaches — sits at 0.917 and pays nothing further. A player who hires
*one* DJ sits at 0.667: a visible, fully reversible one-third haircut, against a
DJ who multiplied that slot's pull by 2.8×. They are still comfortably ahead.

**This is also what finally makes engineers worth hiring.** Today
`slotRisk = 0.06`, fault costs 45% of one slot → EV loss 2.7% of slot revenue ≈
$36/day on a $1,350 slot; a skill-6 engineer at $63/day saves $23. **Engineers
are currently negative EV on music slots.** Under this lever, one engineer on a
TX1/ANT1 solo station moves `c*` from 0.667 to ~0.86; at K=2000, P=83 the revenue
ratio `c·(K+P)/(K+cP)` goes 0.674 → 0.863, worth **+$42/day** on a $221/day
station and far more later. Positive EV, and it grows with the gear ladder.

---

## 4. The non-constant proof

### 4a. The recurring decision

*Which stations get your scarce engineer-hours today, and whether the next watt
of reach is worth the person-hours it will cost to keep.*

### 4b. The value of holding a station's condition

```
V(s) = R_s · [ 1 − COND_MIN · (K_s + P_s) / (K_s + COND_MIN·P_s) ]
```

`R_s` = station revenue, `P_s` = your pull in that segment, `K_s` = rival pull
there.

`V` rises with revenue ("cover the biggest earner") and **falls** with share
`P_s/K_s` ("don't bother covering the market you already own, its audience is
saturated"). Those two fight, so no fixed rule tracks it. Worked, two stations
with **identical revenue**:

- **A**: citywide, TX3/ANT3, dominant. R = $1,500, P = 1800, K = 600 (driven to
  `RIVAL_K_MIN` by your own share).
  `V_A = 1500·[1 − 0.35·2400/(600+630)] = 1500·0.3171 =` **$476/day**
- **B**: ledger, TX1/ANT1, contested. R = $1,500, P = 300, K = 1500 (grown while
  you ignored it).
  `V_B = 1500·[1 − 0.35·1800/(1500+105)] = 1500·0.6075 =` **$911/day**

Same revenue; **B is worth 1.91× as much to defend.** "Cover the biggest earner"
loses $435/day here. Hold B for 120 days and K_B falls toward its floor 450 while
P_B grows with gear to 900: `V_B' = 1500·0.3824 = $574/day` — **the ordering
flips, driven by nothing but your own earlier coverage decisions.** `K_s` is a
persistent function of the player's history (that is what v5 bought), so the
optimum is state-dependent by construction. `always-flagship`, `always-newest`,
`round-robin` and `biggest-earner` are all beatable by a policy that reads
`(K_s, P_s)`.

### 4c. The gear buy stops being automatic

Buying TX step *n* now costs cash, `ΔTX_LEASE`, **and**
`WEAR_PER_TX·COND_WEAR = 0.001375/day` of extra wear. Solving
`COND_GAIN·Δattn·(1−c) = 0.001375` at c ≈ 0.9 gives **Δattn ≈ 0.46
engineer-slots per transmitter step** — drawn from a candidate stream that
`refreshCandidates()` holds flat at ~0.83/week *forever*, shared with DJs. In
dollars that is only ~$28/day; the real price is the DJ you did not hire. This is
the first mechanic in the game where the gear ladder and the staff ladder compete
for the same scarce resource. Today they are independent, which is why TX4 is an
automatic buy for anyone who can afford it.

And `ΔR` itself is state-dependent: at 86% of citywide, TX3→TX4 is worth ~+13%
revenue against +$910/day of lease (**a losing buy**); at 20% share the same step
is worth ~+70% (**a winning buy**). The threshold moves with `K` and `P`.

### 4d. The four rule-checks

- **Depends on player-controlled state?** Yes — `attn` (staffing), `wear` (gear),
  `P_s` (gear + crew), `K_s` (your own coverage history). ✓
- **Anything derived from player costs/revenue?** No. `wear` reads gear indices,
  `attn` reads roster assignment, `cond` multiplies pull. No money term anywhere. ✓
- **Necessary and unboundedly purchasable?** No. Condition cannot be bought; it
  is tended with person-hours from a flat stream. ✓
- **Negative feedback with no counterbalance?** No. `cond` has a hard floor
  (0.35) and a positive gain term; the fixed point
  `c* = 1 − wear/(COND_GAIN·attn)` exists and is interior for every
  `attn > wear/COND_GAIN`. The pull→share→K→pull loop is the product of two
  bounded terms (`cond ≥ 0.35`, `K ≤ 2.20·open`), and that bound is exactly the
  −$41.2/day figure used to date the death. ✓

**Mandatory spiral guard:** `cond` goes into `slotPull()` **only**, never into
the `quality` that feeds `avgQuality`/`repPressure` in `simulateDay()`. Rep is
proportional-recovery with additive damage; adding a multiplicative rep term
driven by condition would create rep→pull→share→rep with no floor. Keep condition
out of the reputation path.

---

## 5. Failure #2 needs its own fix, and it is probably a harness defect

Failure #2 failed before the rivals work too ($93,838 vs $93,907). It would. From
`tests/harness.mjs`:

```js
function upgradeGear(reserve){
  for (const key of ['tx','ant']) {
    const st = S.stations[activeIndex ? activeIndex() : 0] || S.stations[0];
```

`buyGear()` in `js/ui.js:1620` targets `curStation()`, and `foundStation()` at
`js/sim.js:1144` sets `S.active = stationCount() - 1`. So **the moment the empire
policy founds a station, the flagship's gear ladder freezes forever** and every
subsequent dollar of capex goes to the newest signal only. Founding happens right
after unlock (`UNLOCK_CASH = 9000`, `UNLOCK_REP = 32`, `STATION_COSTS[0] =
12000`), so the empire flagship is stranded around TX2/ANT1 (gear factor 3.30 ×
1.22 = **4.03**) while `solo` climbs to TX4/ANT4 (**18.40**). At citywide
K ≈ 600–2000 the flagship is unsaturated at that gear, so audience is near-linear
in pull: a 4.6× pull gap on the largest station in the run. **That fully accounts
for $171,856 vs $317,658.** No economy change is warranted until this is
re-measured.

Three more instrument defects in the same file:

- `placeEngineers()` calls `setSlotEngineer(0, loads[k].p, e.id)` — **only ever
  station 0.** Under the condition lever, stations 1–3 would decay to `COND_MIN`
  and the harness would report a catastrophic false regression on empire. Must be
  fixed *before* the lever lands.
- The same function calls `loadFactor(i, p)` but `loadFactor(slot)` takes a slot.
  It does not throw (`crewOf(0)` returns `[]` via the falsy guard; `crewOf(1)`
  via the `Array.isArray` guard; `showTech(undefined)` falls back to 0), it
  silently returns **1 for every daypart**, so the sort that is supposed to place
  engineers where the load is worst is meaningless.
- `tryExpand()`'s guard `uncoveredSlots() > 1` compares an **array** to a
  number — `[{…}] > 1` is `NaN > 1` — so it is always false and the "never expand
  onto a hole" rule has never once fired.
- `solo` caps at `hireBest('eng', 1)`. Under this lever a TX4/ANT4 station wants
  4. Raise to `Math.min(4, slotsTotal())` or `WINNABLE: careful play survives`
  will fail for the wrong reason.

**If #2 still fails after those fixes**, the game-side fix is one line, not a new
system: `repTarget` at `js/sim.js:1033` averages slot quality **flat per slot**,
so founding a station you cannot instantly staff dilutes the empire-wide brand.
Empire at 8 staffed / 8 automated slots:
`avgQuality = (1.057 + 0.379)/2 = 0.718 → repTarget 61`, against solo's
`1.057 → repTarget 89.7`. That is a **−19% pull** and **−12.5% revenue/listener**
penalty applied to the flagship *for expanding*. Make `avgQuality` and
`avgPressure` **audience-weighted** instead of slot-count-weighted: reputation
should follow the ears, not the hours. No loop — rep enters every slot's pull as
the same `(1+rep/62)` factor, so it cancels out of the normalised weights. Idle
is unaffected (weighted `avgQuality` 0.388 vs flat 0.379, worth ~$1/day).

### Integrator verification note

All four instrument defects were confirmed against source before any action was
taken:

| claim | status |
|---|---|
| `upgradeGear()` reads `activeIndex()`; `foundStation()` sets `S.active` to newest (`js/sim.js:1144`) | confirmed — `tests/harness.mjs:227-234` |
| `placeEngineers()` calls `setSlotEngineer(0, …)` only | confirmed — `tests/harness.mjs:223` |
| `loadFactor(i, p)` passes an index to a slot-taking function (`js/sim.js:733`) | confirmed — `tests/harness.mjs:219` |
| `uncoveredSlots() > 1` compares an array to a number (`js/sim.js:1315` returns `out`) | confirmed — `tests/harness.mjs:240` |

---

## 6. What it costs in UI/comms — non-negotiable

A decaying station the player cannot see is a hidden trap, which is the exact
defect class this document exists to prevent.

1. **Condition gauge per station**, in the HUD station switcher and on the Studio
   tab: `Signal condition 78% ▼` with the daily drift.
2. **The `why`, on the same panel**:
   `wear −0.68%/day (Class C + 12-bay) · attention +0.42%/day (4 hosts, 1
   engineer) · settling toward 79%`. `c*` is closed-form, so show the
   destination, not just the slope. That is what makes it a decision instead of a
   mystery.
3. **Gear tab preview.** Next to "Class C — $105,000, +$900/day lease", add
   "**+0.28%/day wear — about one more engineered slot**". Without this the top
   of the ladder becomes an invisible trap.
4. **Daily Brief** gains a condition line per station plus an empire rollup,
   alongside the existing lease line.
5. **The uncovered-slots strip** already ranks by fault risk; it must now also
   carry the condition consequence, since that is the larger of the two effects.
6. **Threshold log lines** at 90 / 75 / 50 / floor, one-shot per crossing, not
   daily spam.
7. **`bankruptCause()`** (`js/sim.js:1426`) needs a `causeSignalRot` branch ahead
   of `causeQuiet` — "your transmitters were never touched" is the true cause of
   the idle death and must be named.
8. **The offline modal** must state that condition decayed while away — see §7.

---

## 7. Two implementation traps

- **`catchUp()` (`js/sim.js:2015`) is an exploit under this lever.** It
  extrapolates `S.lastDay.net` flat over up to `OFFLINE_MAX_DAYS = 96` days and
  never touches condition. Close the tab at `cond = 1.00`, return 96 days later
  at `cond = 1.00` with 96 days of full-condition net paid at half rate. Fix:
  advance `cond` by `days · (COND_GAIN·attn·(1−cond) − wear)` **first**, then
  credit the offline days from the decayed value.
- **Save shape.** `STATE_VER` 5 → 6, `station.cond` defaulting to 1.00.
  `migrate()` seeds 1.00 for every v ≤ 5 station — a live run must not be
  retroactively punished. `sanitize()` clamps to `[COND_MIN, 1]`.

---

## 8. Change list, prioritised

| # | problem | fix | where |
|---|---|---|---|
| 1 | Empire policy strands the flagship's gear ladder at founding; fully explains #2 | iterate all stations, not `activeIndex()` | `upgradeGear()`, `tests/harness.mjs` |
| 2 | Engineers only ever land on station 0; `loadFactor(i,p)` silently returns 1 | assign across stations; pass the slot | `placeEngineers()`, `tests/harness.mjs` |
| 3 | `uncoveredSlots() > 1` compares array to number, never fires | `uncoveredSlots().length > 1` | `tryExpand()`, `tests/harness.mjs` |
| 4 | Idle cannot be killed: the drag is bounded by `RIVAL_K_MAX` at −$5.4/day | add `cond`, `wear()`, `attn()`, tick it in `simulateDay()`, multiply into `slotPull()` | `js/sim.js` |
| 5 | Closing the tab freezes decay | advance condition over the credited days before crediting net | `catchUp()`, `js/sim.js` |
| 6 | New field, no version bump | `STATE_VER = 6`, seed `cond: 1.00` | `newStation()`/`migrate()`/`sanitize()`, `js/sim.js` |
| 7 | Invisible decay = hidden trap | gauge + wear/attention/`c*` readout + gear-tab wear preview + `causeSignalRot` | `js/ui.js`, `index.html`, `js/sim.js` |
| 8 | *Only if #2 survives 1–3*: rep dilutes on expansion | audience-weight `avgQuality`/`avgPressure` | `simulateDay()`, `js/sim.js:1033` |

Re-tune `solo`'s engineer cap to `Math.min(4, slotsTotal())` as part of #2.

---

## 9. What the harness should read if this is right

- `LOSABLE: doing nothing eventually goes broke` — **idle survival ≤ 10%**,
  median death day **360–420**, peak cash ~$4,300 near day 110.
- `LOSABLE: expanding recklessly costs the run's value` — margin widens (`greedy`
  runs `attn = 0` on every new signal).
- `WINNABLE: careful play survives` — solo ≥ 60%; expect median end cash **down
  8–12%** from $317,658 (a well-run station now sits at `c* ≈ 0.91`, not 1.00).
  If it drops further than that, `COND_GAIN` is too low, not `COND_WEAR` too
  high.
- `SKILL PAYS: careful beats all-ads by >3x` — margin widens; `ads` never hires a
  DJ, so `attn = 0`.
- `SKILL PAYS: expansion is worth more than standing still` — **this should flip
  on changes 1–3 alone.** If it flips there, do not ship change 8. If it does
  not, ship change 8 and re-measure.
- `the ledger reconciles` — unchanged; condition moves no cash.

**New assertion to add:** run `always-flagship`, `always-newest`, `round-robin`
and `greedy-on-V(s)` engineer-allocation policies. If any fixed rule matches or
beats `greedy-on-V`, §4b is wrong and this lever has not made the decision
non-constant.
