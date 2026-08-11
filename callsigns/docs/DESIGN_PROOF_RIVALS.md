# Callsigns — design proof: rival networks, and the mogul ladder

Gate document per `my-games/CLAUDE.md` rule 1. Written before any code.
Covers the 100% stage: the open `LOSABLE` finding, and "I had 4 stations, then what?"

---

## 1. What is actually broken, in one equation

Audience is

```
audience(s,p) = POP(p) · pull(s,p) / ( C(seg,p) + Σ your pull in that segment )
```

and the rival denominator is

```
C(seg,p) = base · wave(day) · (1 + RIVAL_GAIN · pressure)        RIVAL_GAIN = 0.90
pressure ← pressure + (takenShare − pressure) · RIVAL_ADAPT      RIVAL_ADAPT = 0.06
```

`pressure` is an exponential moving average of **the share you are currently taking**,
with roughly a 17-day memory. It carries no state of its own.

**This is a negative feedback loop pointed the wrong way.** Stop competing and
`takenShare → 0`, so `pressure → 0`, so `C → base · wave` — its floor. The
competition gets *weaker* the less you play. That is not a flavour problem; it is
the mechanical reason `LOSABLE: doing nothing eventually goes broke` fails and the
idle run ends ~$33k up over 540 days.

Two consequences, and they are the same bug:

- **No clock.** Absence is rewarded, so no decision is ever forced.
- **No endgame.** `C` has no memory, so nothing you do to a market persists. There
  is no opponent to beat, only a wave to surf. After the fourth station there is
  no further state to change.

---

## 2. The change

Replace the scalar `pressure` with **named rival networks that own capacity**.

```
C(seg,p) = Σ over rivals r active in seg of  K_r · fit_r(p) · wave_r(day)
```

`K_r` is a persistent capacity per rival per segment, and it moves:

```
K_r ← K_r · (1 + GROWTH · vacancy_seg)      when the segment is under-served
K_r ← K_r · (1 − SQUEEZE · yourShare_seg)   when you hold it
                                             floor K_MIN, ceiling K_MAX
```

`vacancy_seg = 1 − (Σ your share of that segment)`. A market you ignore is a market
a rival compounds into. The sign is now the right way round: **absence is punished.**

Everything else in the share equation is untouched, and nothing in `K` reads the
player's revenue, cash or payroll — the standing rule that keeps the loop unsolved.

---

## 3. The core recurring decision

Before: *"which show goes in which daypart"* — and because `C` was memoryless, the
answer was a lookup table, `argmax(appeal × fit × parts)` per segment per daypart.
Constant. Solved.

After: **"which market do I defend this week, knowing the ones I leave are compounding
against me."** You cannot hold four segments at once — one engineer per daypart
empire-wide is the existing scarcity — so every week is a choice about which rival
you allow to grow.

## 4. The failure state

Rival capacity outruns you. Share falls, revenue falls under lease plus payroll,
cash goes negative, `bankruptCause()` names it. Reachable by inaction, which is the
whole point.

## 5. The scarce resource

Unchanged and now load-bearing: **attention per daypart** (one engineer empire-wide
per daypart), and cash for leases. Rivals convert *your* inattention into *their*
permanent capacity, which is what gives the scarcity teeth.

---

## 6. The part that matters: the optimum is not a constant

**Claim.** With persistent `K`, no fixed policy is optimal, because the value of a
slot depends on rival state that your own earlier choices produced.

Take two segments with the shipped numbers:

| | POP (morning) | C base |
|---|---|---|
| A `citywide` | 6000 | 2000 |
| B `countyline` | 3800 | 1100 |

Your pull `P = 1800` can be spent in one of them per daypart.

**Before (memoryless C).** Audience if you take A: `6000 · 1800/(2000+1800) = 2842`.
If you take B: `3800 · 1800/(1100+1800) = 2359`. A wins, 2842 > 2359 — and it wins
by the same margin on day 1, day 200 and day 540, because `C` returns to
`base · wave` regardless of history. **A is the answer forever. That is the solved
loop.**

**After (persistent K).** Say `GROWTH = 0.010/day` on a fully vacant segment and you
have held A for 60 days while ignoring B. B's capacity has compounded:

```
K_B = 1100 · 1.010^60 ≈ 1100 · 1.817 ≈ 1999
```

Now recompute. Staying in A: still ≈ 2842. Switching to B: `3800 · 1800/(1999+1800)
= 1801`. So far A still wins — but B keeps compounding, and the *value of A* is not
static either, because holding A drives `K_A` down by `SQUEEZE`:

```
K_A after 60 held days at ~47% share, SQUEEZE = 0.008:
K_A = 2000 · (1 − 0.008·0.47)^60 ≈ 2000 · 0.798 ≈ 1596
A audience → 6000 · 1800/(1596+1800) = 3180
```

A got *better* because you held it — and B got worse because you didn't. Left
alone, that is a runaway. It is not, because B's growth is bounded by `K_MAX` and
because B's rising `K` raises the payoff for *re-entering* B later: at
`K_B = 1100 · 1.010^160 ≈ 5440`, B's pool is barely worth contesting, but the rival
holding it is now large enough to expand *into A* — rivals are not segment-locked.

The optimum therefore depends on the pair `(K_A, K_B)`, which is a function of your
own history. **There is no constant policy**: "always A" loses A eventually to a
rival grown fat on B, and "alternate every N days" is beaten by a policy that reads
the actual `K` values. The player is solving a state-dependent problem, which is
exactly what the Purr & Power failure was missing.

**Falsifiable test, and it ships:** the harness compares `always-A`, `always-B`,
`fixed-alternate` and `greedy-on-K`. If any *fixed* policy matches or beats
`greedy-on-K` across seeds, this proof is wrong and the gate has failed. That
assertion goes in `tests/harness.mjs` alongside the existing ten.

---

## 7. Pressure curve

- **Minute 5** — unchanged. One station, one daypart, lease $60/day against ~$60.9
  automated gross. The existing founding arithmetic is untouched because `K` starts
  at today's `base` and needs time to move.
- **Hour 1** — first rival visibly gains a market you left empty. Standings table
  shows you second in a segment you used to lead. This is the moment the game
  acquires a clock it never had.
- **Hour 10** — three or four rivals with real capacity, you at the cap of four
  radio stations. Radio alone can no longer absorb your cash. **This is where the
  mogul ladder starts** (§8), and it is a deliberate hand-off, not a wall.

---

## 8. The mogul ladder — and why it is nearly free

`MAX_STATIONS = 4` stays. Four is the cap on **radio** stations, not on the empire.

The architecture already anticipated this. From `sim.js`:

> "a TV row would be pop/comp/leaseMul/fit/staffRules plus a `medium` tag and flow
> through the same share equation" … "Nothing in this file branches on 'radio'"

and every segment already carries `medium: 'radio'`. Non-radio media are **content
rows**, not a new engine. The ladder:

| stage | medium | unlock | what is new |
|---|---|---|---|
| 1 | radio | start | the existing game |
| 2 | radio | cash + rep | stations 2–4 |
| 3 | **live venue** | 4 stations + rep | a theatre; bookings compete for the same evening audience |
| 4 | **label** | venue + a hit show | records; buzz becomes an asset you own, not a modifier |
| 5 | **film/TV** | label + capital | the largest pools, the longest lead times |

Each stage is a `SEGMENTS` row plus an unlock condition, riding the share equation
that already exists. Rivals expand across media too — which is what makes stage 5 a
contest rather than a victory lap.

**Scope note.** Stage 3+ is deliberately NOT in this pass. Rivals first: the ladder
is pointless without an opponent to climb against, and shipping media rows on top of
a loop that still cannot be lost would repeat the mistake this document exists to
prevent.

---

## 9. What this pass must not do

- `K` must never read revenue, cash or payroll. The day the denominator learns what
  the player earns, the game is solved — the existing comment is right and stays.
- The minute-5 arithmetic must not move. `K` starts at `base`.
- No new save-shape without a version bump (vault rule).
- The `🚧 Overhaul In Progress` card stays until the harness is 11/11 green.
