# CALLSIGNS — DESIGN PROOF (design-architect, 2026-08-07, accepted by owner)

## VERDICT: STOP as briefed → NON-CONSTANT with the three named mechanics below (owner accepted them; scope decision: DEEP — 3–4 stations, TV/movies architecture-only).

## PART 1 — the current game is SOLVED (proofs)

### 1.1 DJ assignment is a fixed sort
From `simulateDay()` (line 1366 of callsigns/index.html):
```
quality  = show.appeal * (0.58 + 0.052 * djSkill) * show.parts[part.id]
potential = LISTENER_BASE * reach * part.weight * (1 + S.rep/62) * S.buzz
revenue  += slotListeners * show.adRate * AD_VALUE * fill * price * (1 + S.rep/140)
```
Slot i revenue: `rev_i = K · w_i · A_i · (0.58 + 0.052·s_i)` where K (cash, rep, buzz, tx, ant, engineer, sales) is identical for all slots and `A_i = appeal · parts[i] · adRate`. Rearrangement inequality ⇒ sort DJs by skill, slots by `w_i·A_i`, match. Slot order is compile-time constant: morning 1.369 > evening 1.365 > night 1.123 > midday 0.880. Best DJ → morning, forever.

### 1.2 Schedule is a one-time fixed point; music is dominated everywhere
Revenue coefficients `w_i·appeal·parts·adRate`: music is never the argmax in any daypart (morning: talk 1.672 wins; midday/evening/night: ads win) yet music is the default in 3 of 4 slots. repTarget = 78·avgQuality + 14·avgPressure is a function of schedule ONLY (no rep feedback) so rep converges to a schedule-determined fixed point; best schedule ≈ news/music/talk/ads (score 20.57). Solve once, never touch the grid again.

### 1.3 Everything purchasable is strictly dominant; you cannot lose
- No upkeep anywhere: gear is a one-time cost with strictly positive return ⇒ buy-when-affordable is always optimal.
- Second station: `network = revenue * 0.32 * clamp(S.rep/100, 0.3, 1)` (line 1429) — zero cost, zero cannibalization, always correct. Reward derived from station 1's own output (the Purr & Power self-reference trap).
- Day-1 idle: revenue ≈ $60.9/day, costs $2.06 ⇒ +$58.8/day with zero inputs; BANKRUPTCY_FLOOR −4000 unreachable. Cannot lose.
- Cash sink terminates (~$303k trains everyone to 10; then no use for money).
- Only genuine threshold in the whole game: second engineer via `roleStrength()` 0.40^i decay + engBonus cap (crossed once).

## PART 2 — the overhaul AS BRIEFED is also solved
(a) Engineer-per-slot as a multiplier ⇒ value ∝ rev_i ⇒ rearrangement sort ⇒ constant.
(b) Multi-DJ additive skill ⇒ marginal host strictly positive, slot-independent ⇒ fill-to-cap constant.
(c) More stations under `network = rev*0.32` ⇒ free money ⇒ constant.

## PART 3 — the NON-CONSTANT design (the three accepted mechanics)

### Core decision
Which of your too-few people cover which of your too-many simultaneous slots today, and which slots you deliberately leave exposed. (Morning drive happens at 6 AM on EVERY station at once; person-hours per daypart do not scale with station count.)

### Failure state
Per-station daily lease whether or not it performs: `lease(s) = 60 + TX_LEASE[tx_s] + ANT_LEASE[ant_s]`, TX_LEASE = [0,40,120,340,900]. Over-expand into contested segments + split talent ⇒ payroll+leases exceed share-limited revenue ⇒ cash floor ⇒ loss. Also fixes base game: at TX0 lease $60/day vs $60.9 gross ⇒ idling loses; TX3→TX4 (+61% reach, +$560/day lease) pays only above $918/day revenue — a threshold on state.

### Scarce resource
Qualified person-hours within a daypart. `refreshCandidates()` yields 2–3 candidates/week (~0.83 DJs/week) and MUST NOT scale with station count. Skill caps at 10.

### 3.1 Engineer assignment (mechanic #3): risk driven by player-set load
```
loadFactor(i) = 1 + 0.45·(djCount(i) − 1) + SHOW_TECH[show(i)]
                SHOW_TECH = { music: 0.00, ads: 0.10, talk: 0.35, news: 0.55 }
slotRisk(i)   = BASE_RISK · loadFactor(i) / (1 + 0.30·engSkill(i))
on fault:       slot revenue ×0.55  AND  rep −= 0.25·loadFactor(i)   [rep damage ∝ LOAD, not revenue]
```
value_i ∝ 0.45·rev_i·load_i + 0.25·V·load_i² (quadratic in load, linear in revenue), V = 20·R_total·(1/(62+rep) + 1/(140+rep)).
Worked: R_total $2,600/day, rep 40 ⇒ V=$799. Engineer flips from $1,200 morning (load 1.00, value $31.3/day) to $300 overnight with 3 co-hosts on news (load 2.45, value $64.8/day). Crossover L* = 1.616 — between "2 co-hosts music" (1.45) and "2 co-hosts news" (2.00). Depends on djCount(i) and show(i), both player-set per slot per turn. Hard constraint: ONE engineer covers ONE daypart across the WHOLE empire (E engineers ⇒ at most E of S same-daypart slots covered).

### 3.2 Multi-DJ (with mechanic #3 coupling): second co-host sometimes wrong
```
crewSkill(i) = s₁ + 0.55·s₂ + 0.30·s₃
djTerm(i)    = 0.58 + 0.052 · crewSkill(i) · chem(i) · fatigue
```
Skill-6 second host under skill-9 lead: +16.4% slot revenue; costs salary $50.6/day + load 1.00→1.45 (fault risk +0.027). Net at $300 slot: −$12.9/day (WRONG); at $1,200 slot: +$123.8/day (RIGHT). Threshold R* = $385/day. Non-degenerate because (1) the co-host you add is removed from another slot on another station (shared pool), (2) load rise can pull the sole engineer off a different station — (a) and (b) are NOT separable.

### 3.3 Multi-station (mechanic #1): finite audience, share denominator with your own stations in it
```
audience(s,p) = POP(p) · pull(s,p) / (K_COMP + Σ_all_stations_in_segment pull(·,p))
pull(s,p)     = quality(s,p) · reach(s) · segmentMatch(s,p)
```
Denominator built from audience pull, NEVER from player costs/revenue (the P&P trap). Rival pull C must be day-indexed + bounded share-response only — never revenue/payroll-derived, or it collapses back to self-reference.
Two identical stations in one segment splitting one pool: total audience unchanged, double lease/payroll ⇒ founding is WRONG (makes failure reachable).
Found iff `M_B·reach_B/C_B > M_A·C_A·reach_A/(C_A + reach_A·T)²`. With M_A=6000, C_A=2000, flagship Class B (reach 5.70), niche B: M_B=2000, C_B=400, new station Part 15 rig (reach 1.00) ⇒ LHS=5.00; crossover at talent T ≈ 290 (T=200: no; 350: yes). Threshold moves with T and C_A (rivals respond). Segment choice is a second live decision (M_B/C_B differs; $1,400 Class A upgrade ×1.85 LHS).
**TV/movies = another segment tuple** with its own POP, C, lease, staffing rules in the same share equation. Build the SEGMENTS table now; TV is a content row later, not an architecture change.

### Negative-feedback check
Fault rep drift additive, recovery proportional (5%/day toward repTarget): equilibrium sits 3.6 rep below target at 3 stations (0.18/day drift), 12 below at 10 stations. Bounded, no spiral — but balance-scientist must re-verify if BASE_RISK or fault rep penalty is retuned.

### Pressure curve
- Min 5: $800 cash, −$4,000 floor, $60/day lease, $60.9/day automated gross; first DJ costs $312 hire + $39/day ⇒ ~120 days of runway to make the schedule pay.
- Hour 1: four slots, one engineer, one daypart covered; adding a co-host or news moves the L* crossover under you.
- Hour 10: 3–5 stations, 12–20 slots, all morning drives simultaneous, 0.83 DJs/week, rivals responding, leases daily. Empire gets harder per station.

## PART 4 — collisions (all line refs to callsigns/index.html @ grimoire-overhaul-era main)
1. `S.secondStation` is a decoration `{call, foundedDay, totalEarned}` (2632); its whole sim is line 1429.
2. `S.schedule` flat daypart-keyed; single-schedule assumed at newState (1294), migrate (1747-54), sanitize (1831), simulateDay (1379), djLoad (1350), openSlotEditor (2667), firePerson (2590).
3. `S.tx`/`S.ant` scalar globals read by reachValue, fidelityValue, buyGear, sceneTier, nextGoal, breakdown-naming (1409).
4. `slot.dj` single string id; readers break on multi-DJ: djFor (1360), djLoad (1349), sanitize orphan cleanup (1830-33), openSlotEditor elsewhere-count (2700), viewStudio (2168).
5. `engBonus()`/`salesFill()`/`salesPrice()` empire-wide scalars; engineer-per-slot means REMOVING engBonus from reachValue/fidelityValue, not adding a second path.
6. `sceneTier()` hardcodes station count into art (1896, 1920).
7. `catchUp()` gates on `S.lastDay.net > 0` (1865) ⇒ with leases, closing the tab dodges losses. Apply negative net offline or accrue leases separately.
8. `SAVE_VER = 2`; overhaul is v3: wrap existing run into `stations[0]`, real v2→v3 migrate path.
9. `SECOND_STATION_COST` single constant ⇒ needs rising cost curve per station.
10. CLAUDE.md rule 3 binding: ships as index.html + js/sim.js + js/ui.js + js/content.js + js/fx.js or not at all.

## PART 5 — prioritised change list (1–3 are the greenlight conditions)
1. DEFECT: `network = revenue*0.32` self-reference → `marketShare()` with finite POP(segment,daypart) + share denominator incl. own stations; C day-indexed+bounded. (js/sim.js; deletes network block)
2. DEFECT: no recurring costs → per-station daily lease 60 + TX_LEASE[tx] + ANT_LEASE[ant], TX_LEASE=[0,40,120,340,900]. (simulateDay cost aggregation)
3. DEFECT: engineer ∝ revenue sort → loadFactor()/slotRisk() per 3.1, fault rep ∝ load; one engineer per daypart empire-wide. (replaces breakRisk block 1403-12)
4. DEFECT: DJ fixed sort → crewSkill 0.55/0.30 decay, chem() style-tag pairing, load coupling; `slot.dj` → `slot.djs: string[]`. (djFor, djLoad, djFatigue, sanitize, openSlotEditor)
5. DEFECT: music dominated everywhere yet default → retune SHOWS.music.adRate or parts so music wins ≥1 daypart on merit; re-verify 1.2 table. (SHOWS, js/content.js)
6. Keep refreshCandidates() flat with station count; harness asserts candidate throughput independent of stations.length.
7. catchUp() negative-net fix (line 1865).
8. Empire state shape: `S.stations: [{call, freq, segment, tx, ant, schedule, lease}]`, S.staff stays GLOBAL (that is the scarcity), SEGMENTS table with POP/C/lease/staffRules; v2→v3 migrate in same commit. (newState, migrate, sanitize)
