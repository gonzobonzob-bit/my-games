# Gate VT-1 — voice-tracking, measured

Run 2026-08-17, `node callsigns/tests/harness.mjs --gate vt --vt-runs 60`,
60 seeds per policy, 540 in-game days, paired by seed. **10 checks passed,
3 failed.** The design is `docs/DESIGN_PROOF_VOICETRACK.md` §8.

**Verdict: voice-tracking as shipped in v9 is not the decision it was designed
to be.** Never tracking wins in BOTH arms. There is no reversal on roster depth,
which is the whole claim.

## What the design predicted, and what the game does

| | design predicts | measured (never − alwaysTrackButOne, per seed) |
|---|---|---|
| deep roster (a DJ per slot) | live wins | **+$2,323,543** median, 95% CI $1.95M..$2.64M, t=13.1 ✔ direction |
| thin roster (a DJ per station) | **tracked wins** | **+$188,682** median, 95% CI $85K..$698K, t=2.51 ✘ wrong sign |

Tracking never wins. In the thin arm it loses by less, and a lighter cut
(`trackBottomHalf`, two dayparts of four) is a statistical tie — median
−$88,790, CI −$153K..+$292K, which crosses zero. So the honest statement is
*tracking is neutral-to-negative everywhere*, not *tracking is for thin rosters*.

## The three failures

**(b) no reversal.** Both signs positive; see the table. A toggle whose better
setting never changes with the state is decoration.

**(a) reading state cannot beat both fixed rules.** Pooled across arms,
`readsState` − `never-track` = $0 median against a 5% bar of $337,031 (CI
$54K..$158K — significant, but an order of magnitude under the bar).
The per-arm split says why:

- deep: `readsState` − `never` = −$1,935, CI −$27.8K..+$48.9K. It ran 269 flips
  against 103,254 holds — the state-reading policy independently discovered
  "never track" and its end cash is identical to `vtZero` to the dollar.
- thin: `readsState` − `never` = **+$123,961**, CI $111K..$292K, t=4.37, with
  8 of 16 slots tracked. This is the one place the mechanic pays, and it pays
  about 2%.

**(e) a fully-tracked operator outlives an abandoned one.** `trackEverything`
survives 48% (censored median death day 287); `idle` survives 2% (day 368).

⚠ **This check is the one line worth re-deriving before acting on it.** The gate
reads a fully-tracked empire outliving idle as proof the mechanic mints
attention somewhere. It does not: `trackEverything` ends with attention exactly
0 and condition pinned at COND_MIN 0.35, as designed. It survives because 12
staff selling ads against tracked slots at 0.88 appeal still clears payroll and
lease — which is what an operating station is supposed to do against an
abandoned one. The assertion, as written, demands that running a business be
worse than running nothing. **(a) and (b) are not explainable this way and are
the real result.**

## What did pass — the mechanic is wired correctly

The failure is a design failure, not a plumbing one:

- **(d)** on a station pinned at COND_MIN, tracking costs **exactly 0.0000000000**
  condition. Unclamped c\* moves 0.200 → 0.107; the floor absorbs all of it.
- **TRACK_APPEAL reaches both quality sites.** `slotPull()` ratio 0.880000 to
  nine places; `avgQuality` 0.850162 → 0.823666 against an expected 0.823666.
  One site wired and not the other would make pull and reputation describe
  different schedules — the wrong-answer class this project has shipped before.
- **(e) first half:** the idle line still dies at censored median day 368.
- **Every instrument check.** Each arm hired and staffed for real (deep 912 DJ
  hires / 11,400 assignments; thin 240 / 3,540), every tracking policy actually
  flipped slots, both never-track arms ended at 0 tracked, and the `vtZero`
  control never touched a slot mode. Arm separation: 36.18 vs 9.92 mean staff,
  max DJ load 0.95 vs 4.00.

The four instrument breaks of §8 were run first against scratch copies
(`CALLSIGNS_GAME_DIR`), never in the repo, and each was seen to fail the check
it targets. Break 4 is why `medDeathC` exists: deleting the tracked-slot skip in
`stationAttn()` took survival from 40% to 88% while the dead-only median death
day went *down*, and the old assertion passed on that broken build.

## Not yet run

**(c) the structural zero across builds** — a run that never tracks must
reproduce the pre-v9 build to the cent on the same seed. Needs a v8 checkout:

```
CALLSIGNS_GAME_DIR=/path/to/v8 node tests/harness.mjs --gate vt --zero-out /tmp/v8.json
node tests/harness.mjs --gate vt --zero-in /tmp/v8.json
```

## RESOLVED — the disagreement was a threshold, and the axis is host skill

*Everything above this line is the original run and stands as recorded. What
follows resolves it. Read both: the first verdict was right about its cohort and
wrong about the game.*

A direct probe contradicted the cohort, and chasing that contradiction is what
found the real mechanic. The story, in order.

Rule 4 sent me to read what automation actually buys a station; the answer is
"it does not get tired", which is the fatigue term this game already models. So
before proposing a second axis I measured the trade directly, outside the
cohort: **one host across all four dayparts** — load 4.0, fatigue at
`clamp(1 − 0.18·(4−1), 0.40, 1) = 0.46`, which is what "thin" is supposed to
mean — against the same station with three of the four slots tracked. 30 seeds,
540 days, own RNG, paired.

```
one station    tracked − live   median +$75,886   tracked wins 30/30   rep 78.3 → 83.7
four stations  tracked − live   median +$220,961  tracked wins 30/30   rep 73.4 → 78.8
```

Tracking wins every single seed. The arithmetic behind it is unambiguous: the
host's load falls 4.0 → 1 + 3(0.35) = 2.05, fatigue 0.46 → 0.81, and `djTerm`
rises 0.771 → 0.917 **on all four slots including the live one**. A 19% lift on
every slot beats a 12% appeal haircut on three of them — station pull 2292 →
2466.

### Step 2 — the ladder: it is not an ingredient of the policy

`--gate vtrec` runs the cohort's own thin arm with exactly one ingredient
removed per rung, 30 paired seeds each. Positive means never-tracking wins,
which is what the cohort reported.

```
0 base        $73,904   CI [-$98,303 ..   $992,414]  the cohort thin arm, unmodified
+ noExp      $389,624   CI [$293,165 ..   $657,622]  no expansion — one station
0 noSales    -$15,991   CI [-$71,424 ..    $96,208]  no sellers hired
+ noGear     $504,611   CI [$427,009 ..   $723,020]  no gear upgrades
0 noSched    $185,077   CI [-$21,646 ..   $454,444]  no setSchedules() churn
0 noRebuild  $336,008   CI [-$22,272 .. $1,052,106]  no roster wipe on shape change
0 flipOnce   $138,048   CI [-$1,121  .. $1,009,105]  modes set once, not re-asserted
+ static      $94,870   CI [$87,492  ..    $96,977]  all of the above off at once
```

**No rung flips the sign.** `static` — one station, one host, no churn, the
closest thing the cohort has to the probe's fixture — is *more* certain that
never-tracking wins (t=38). So the disagreement is not expansion, sellers, gear,
schedule churn, roster rebuilds or flip cadence.

### Step 3 — the threshold

The probe pins its host at skill 8. The cohort hires whoever turns up. That is
the entire difference, and it matters because of where `TRACK_APPEAL` lands:

```
djTerm = 0.58 + 0.052 · skill · fatigue
```

`TRACK_APPEAL` multiplies **all** of that — including the flat 0.58 a host earns
just by being a voice on the air — while fatigue relief reaches only the second
term. Tracking three of four dayparts needs

```
djTerm(f') / djTerm(f)  >  Σw / (w_live + 0.88·Σw_tracked)  =  3.9 / 3.594  =  1.0851
```

which with fatigue 0.46 → 0.811 solves at **skill 3.0** for pull alone, and sits
a little higher once the same haircut passes through `avgQuality` into
reputation. Measured, one station, 30 paired seeds per row:

```
skill  3    -$41,190   tracked wins  0/30      rep 65.7 → 64.5
skill  4    -$19,186   tracked wins  0/30      rep 67.8 → 67.9
skill  5     +$3,577   tracked wins 30/30      rep 70.4 → 71.8
skill  6    +$27,067   tracked wins 30/30      rep 72.5 → 75.3
skill  8    +$75,886   tracked wins 30/30      rep 77.8 → 83.2
skill 10   +$126,760   tracked wins 30/30      rep 83.4 → 91.4
```

Break-even between 4 and 5 — and the cohort's own rosters, now that the harness
reports them, come in at **djSkill 3.5 in the thin arm and 4.19 in the deep
arm**. Both sit under the line. `trackEverything` sits at 2.75.

**Both measurements were correct.** The cohort staffed the game with journeymen
and correctly found that tracking loses; the probe staffed it with a star and
correctly found that tracking wins. Neither reported the variable that decides
it.

### What this means for the design

**The toggle is a real decision, and it was never the decision the design proof
claimed.** It is not "deep roster versus thin roster". It is **"is this host
good enough to be worth multiplying?"** — which is the thing radio actually does
with voice-tracking: you take your best personality and put them in four
dayparts, and you do not do that with someone the audience is lukewarm on.

It is also, unavoidably, a **late-game** decision. `makePerson()` rolls
`clamp(randInt(1, 3 + 2 + floor(rep/22)), 1, 10)`, so a skill-8 host needs high
reputation *and* a good draw. Early on the game hands you people who are worse
tracked than live, and it is right to. That is a progression arc, not a flaw —
but nothing in the game says so.

### Step 4 — the corrected gate, and it passes

Gate VT-1(b) rewritten against host skill, planted rosters, 30 seeds paired
(positive = never-tracking wins):

```
Weak  (skill 3)   never − tracked =  +$35,604   95% CI [ $35,333 ..  $36,051]  t=195
Even  (skill 5)   never − tracked =   -$9,565   95% CI [ -$9,736 ..  -$9,200]  t=-69
Star  (skill 8)   never − tracked =  -$82,743   95% CI [-$82,817 .. -$82,029]  t=-410
```

**A clean reversal, both signs significant.** `ok GATE VT-1(b): the better mode
REVERSES on HOST SKILL`. At the full gate: 12 passed, 2 failed — (a) and (e),
both listed as open below with their reasons.

One instrument note worth keeping: the first run of this cohort reported **zero
plants for three arms that had visibly planted rosters** — the `djSkill` column
read exactly 3, 5 and 8. The action counts were read into a snapshot *before*
these arms ran, so the check was interrogating a stale instrument. It failed
loudly, which is the only reason it was a two-line fix instead of a wrong number
in this document.

### What changed in the harness

- **Gate VT-1(b) is rewritten** against the real axis: planted rosters at skill
  3, 5 and 8, one station, no hiring, no expansion, declared as a fixture cohort
  rather than a play-the-game one. The sign must reverse between weak and star.
- **The refuted claim is pinned.** A standing check asserts roster depth is
  *not* the axis, so if the game ever changes underneath the docs, the harness
  says so instead of the docs quietly going stale.
- **`djSkill` is reported on every row.** A cohort that hires its way across a
  break-even mid-run is averaging two opposite answers, and no column said so.
- **`tests/vtprobe.mjs`** keeps the direct measurement, with `sweep` mode.

### Still open

- **(a) `readsState` beats both fixed rules** was measured against the wrong
  axis and needs re-running now that the axis is known — a state-reading policy
  should track a star and leave a journeyman live, which no fixed rule can do,
  and that is a much stronger version of the same gate.
- **(e)** remains mis-specified; see the note above.
- **(c)** the cross-build structural zero is still unrun.
- **The engineer/fault inversion** found in `RESEARCH_VOICETRACK_AXIS.md` is
  still a live defect: a tracked slot carries `BASE_RISK · load` undivided, so
  automating a slot currently makes it *more* fault-prone.
- **Rule 7: none of this is legible.** The break-even is real, the game prices
  it (the state-reading policy finds it through `uiWhatIf()`, the same
  arithmetic the Building tab shows), but no player can see that tracking a
  weak host is a loss and tracking a star is a win. That is the design work
  this leaves behind.

## The decision this leaves open

*Superseded by the resolution above. Kept because it is what the first verdict
recommended, and because the option that looked most attractive then — bolting a
second axis onto the mechanic — would have added a system the game did not need
to fix a problem it did not have. That is the cost of acting on one cohort.*

The three options recorded at the time were: retune `TRACK_LOAD` / `TRACK_APPEAL`;
give tracking a second structural axis (fault immunity, the Minot exposure); or
withdraw the toggle. **None of them is the answer.** The mechanic already has an
axis, it is host skill, and it works. What is left is not a redesign:

1. **Make the break-even legible** (rule 7). The game prices the trade already —
   `uiWhatIf()` carries it and the state-reading policy finds it — but nothing
   tells a player that tracking a journeyman is a loss and tracking a star is a
   win. This is the real work, and it is a UI problem, not an economy one.
2. **Fix the fault inversion.** A tracked slot should not carry a bigger
   load-driven fault risk than a live one; see `RESEARCH_VOICETRACK_AXIS.md`.
3. **Re-run gate (a)** against the corrected axis, and settle (c) and (e).

The second axis from the research — an automated daypart cannot answer a
breaking local event, which is Minot — remains a good idea for a *later* pass,
on its own design proof. It is no longer a rescue.
