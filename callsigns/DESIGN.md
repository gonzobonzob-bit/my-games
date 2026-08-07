# Design — Callsigns empire overhaul (accepted at 25%, staged at 50%)

**Source proof:** design-architect, 2026-08-07, accepted by owner. Verdict on
the shipped game and on the overhaul *as originally briefed*: SOLVED/CONSTANT —
DJ assignment is a rearrangement-inequality sort (best DJ → morning, forever),
the schedule is a one-time fixed point, everything purchasable is strictly
dominant, and you cannot lose (day-1 idle nets +$58.8/day against an
unreachable −4,000 floor). The `network = revenue*0.32` second station is the
Purr & Power self-reference trap: reward derived from the player's own output.
The proof that each of these is a constant is in the accepted greenlight
document; this file records what was approved to be BUILT.

**Owner's scope decision: DEEP.** 3–4 stations maximum, TV/movies as
architecture only (one paragraph in CONTRACT.md, zero lines of TV code).

## The core decision (accepted)

Which of your too-few people cover which of your too-many simultaneous slots
today, and which slots you deliberately leave exposed. Morning drive happens at
6 AM on EVERY station at once; person-hours per daypart do not scale with
station count.

## The failure state (accepted)

Per-station daily lease, paid whether or not the station performs:

    lease(s) = 60 + TX_LEASE[tx_s] + ANT_LEASE[ant_s]
    TX_LEASE = [0, 40, 120, 340, 900]

Over-expand into contested segments and split your talent, and payroll + leases
exceed share-limited revenue → cash floor → loss. This also fixes the base
game: at TX0 a $60/day lease against $60.9/day automated gross means idling
loses, and the TX3→TX4 step (+61% reach, +$560/day lease) only pays above
$918/day revenue — a threshold that depends on state, not a strictly dominant
buy.

## The scarce resource (accepted)

Qualified person-hours within a daypart. `refreshCandidates()` yields 2–3
candidates/week (~0.83 DJs/week) and MUST NOT scale with station count. Skill
caps at 10. Staff are GLOBAL to the empire — that globality is the scarcity.

## The three mechanics (accepted, with the arithmetic that gates them)

### 1. Multi-station audience: finite pools, share denominator with your own stations in it

    audience(s,p) = POP(p) · pull(s,p) / (K_COMP + Σ_all_stations_in_segment pull(·,p))
    pull(s,p)     = quality(s,p) · reach(s) · segmentMatch(s,p)

The denominator is built from audience pull, NEVER from player costs or revenue
(the P&P trap). Rival pull C must be day-indexed and bounded share-response
only — never revenue- or payroll-derived, or it collapses back to
self-reference. Two identical stations splitting one pool leave total audience
unchanged while doubling lease + payroll, so founding can be WRONG — which is
what makes it a decision. Found iff
`M_B·reach_B/C_B > M_A·C_A·reach_A/(C_A + reach_A·T)²`; with M_A=6000,
C_A=2000, flagship Class B (reach 5.70) and a niche segment (M_B=2000,
C_B=400, Part 15 rig reach 1.00), LHS=5.00 and the crossover sits at talent
T ≈ 290 (T=200: don't found; T=350: found). The threshold moves with T and
with C_A as rivals respond, and segment choice is a second live decision
(M_B/C_B differs per segment; the $1,400 Class A upgrade multiplies LHS ×1.85).

### 2. Multi-DJ crews: the second co-host is sometimes wrong

    crewSkill(i) = s₁ + 0.55·s₂ + 0.30·s₃
    djTerm(i)    = 0.58 + 0.052 · crewSkill(i) · chem(i) · fatigue

A skill-6 second host under a skill-9 lead adds +16.4% slot revenue and costs
$50.6/day salary plus a load rise (1.00 → 1.45, fault risk +0.027). Net at a
$300/day slot: −$12.9/day (WRONG). At a $1,200/day slot: +$123.8/day (RIGHT).
Threshold R* = $385/day. Non-degenerate because (a) the co-host you add is
removed from another slot on another station (shared global pool), and (b) the
load rise can pull the sole engineer off a different station — (a) and (b) are
not separable. DJ affinity/chem ships with multi-DJ (producer condition #5 —
it is what finally makes the portfolio card's old claim true).

### 3. Engineer assignment: risk driven by player-set load

    loadFactor(i) = 1 + 0.45·(djCount(i) − 1) + SHOW_TECH[show(i)]
                    SHOW_TECH = { music: 0.00, ads: 0.10, talk: 0.35, news: 0.55 }
    slotRisk(i)   = BASE_RISK · loadFactor(i) / (1 + 0.30·engSkill(i))
    on fault:       slot revenue ×0.55  AND  rep −= 0.25·loadFactor(i)

Rep damage is proportional to LOAD, not to revenue — that asymmetry is the
whole mechanic. Engineer value on a slot is
`0.45·rev_i·load_i + 0.25·V·load_i²` (quadratic in load, linear in revenue),
V = 20·R_total·(1/(62+rep) + 1/(140+rep)). Worked: at R_total $2,600/day and
rep 40, V=$799 and the engineer flips from the $1,200 morning slot (load 1.00,
value $31.3/day) to a $300 overnight slot running 3 co-hosts on news (load
2.45, value $64.8/day). The crossover L* = 1.616 sits between "2 co-hosts
music" (1.45) and "2 co-hosts news" (2.00) — both inputs are player-set, per
slot, per turn. Hard constraint: ONE engineer covers ONE daypart across the
WHOLE empire (E engineers cover at most E of S same-daypart slots).

### Negative-feedback check

Fault rep drift is additive, recovery proportional (5%/day toward repTarget):
equilibrium sits 3.6 rep below target at 3 stations, 12 below at 10. Bounded,
no spiral — but balance-scientist must re-verify if BASE_RISK or the fault rep
penalty is retuned.

## The pressure curve

- **Minute 5:** $800 cash, −$4,000 floor, $60/day lease against $60.9/day
  automated gross; the first DJ costs $312 to sign plus $39/day — roughly 120
  days of runway to make the schedule pay.
- **Hour 1:** four slots, one engineer, one daypart covered; adding a co-host
  or switching a slot to news moves the L* crossover under you.
- **Hour 10:** 3–4 stations, 12–16 slots, every morning drive simultaneous,
  0.83 DJs/week, rivals responding, leases due daily. The empire gets harder
  per station, not easier.

## Music must win somewhere

Revenue coefficients today make music the argmax in NO daypart while being the
default in three of four slots. Retune `SHOWS.music` (adRate or parts) so music
wins at least one daypart on merit, and re-verify the greenlight's coefficient
table afterwards. (Ships with the build; it invalidates balance numbers.)

## v2→v3 save migration is a design decision (producer risk #3)

Policy, decided here rather than in code review: a live v2 save's run wraps
into `stations[0]` unchanged (call, freq, tx, ant, schedule); a founded v2
`secondStation` becomes a REAL station with a default schedule and no staff of
its own — staff stay where they were, global. Details in CONTRACT.md.

## Deferred, with reasons

- **TV/film segments** — architecture only this pass (owner scope decision;
  producer condition #3). The SEGMENTS table is built so TV is a content row
  later, not an architecture change; one paragraph in CONTRACT.md, zero lines
  of TV code. Any TV content this pass is a scope breach.
- **Wide empire (6+ stations)** — deferred per producer condition #2: the
  assignment surface must grow sub-linearly with stations or the game becomes
  the spreadsheet Mad TV Tycoon is panned for. Hard cap 3–4 real stations this
  overhaul; delegation/station-policy mechanics are the price of ever raising
  it.
- **Rebalance of every constant** (LISTENER_BASE, AD_VALUE, salary curve,
  TX/ANT costs, UNLOCK gates, SECOND_STATION_COST curve, sceneTier ladder) —
  lands with the build at 75%, verified by the balance harness (producer
  condition #4: harness ships at 75%, not 100%). The sceneTier calibration
  envelope in fx.js predates the empire economy and is invalid the moment
  leases land.
- **Onboarding rework** — the three-paragraph intro modal will not survive
  empire surface area (producer condition #7: onboarding is not a modal;
  onboarding-tester gates release at 100%).

## Status (integrator, 2026-08-07)

- **25% Greenlight:** design proof + producer read accepted (INVEST, DEEP
  scope, all seven producer conditions accepted).
- **50% Stage (this directory):** modular split done (refactor-only, smoke
  test 15/15 before and after), this file + CONTRACT.md written, blocker-tier
  card-copy lies fixed at the repo root. NO design-change code exists yet —
  the game still plays exactly like v2.
- **75% Build:** Squad 1 codes the three mechanics against CONTRACT.md;
  balance harness ships and runs there.
- **100% Harden & ship:** Squad 2 + onboarding gate; merge to main is the
  owner's explicit call.
