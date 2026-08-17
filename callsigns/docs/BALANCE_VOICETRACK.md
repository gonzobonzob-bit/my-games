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

## ⚠ ADDENDUM — a direct probe CONTRADICTS the cohort. Do not act on the verdict above yet.

Written the same day, before designing anything on the strength of it.

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

**So the mechanic does reverse, and gate VT-1's thin arm does not see it.** One
of the two measurements is not measuring what it claims, and until that is
resolved the verdict at the top of this file is not safe to design against.
Candidate differences, none yet confirmed: the cohort's thin arm also hires
sellers and upgrades gear, expands on a timer, rebuilds its whole DJ assignment
whenever the roster shape changes, and flips modes only every fourth day against
a roster still being built.

**Next step is reconciliation, not redesign** — add the one-host probe to the
harness as a fixed instrument, then find which cohort ingredient flips the sign.
Rule 5's own tell applies: a claim whose direct measurement disagrees with its
cohort has no opinion yet, and neither should we.

## The decision this leaves open

Voice-tracking is live on `main` in v9. Three ways forward, owner's call:

1. **Retune.** TRACK_LOAD 0.35 and TRACK_APPEAL 0.88 are the two knobs. Cheaper
   tracking, or a smaller localism penalty, could move the thin arm's +$189K
   negative — but a knob-tuned reversal is a tuning artefact, not a decision,
   and rule 1 says prove it before coding it.
2. **Give tracking a second axis** so the trade is structural rather than
   numeric — e.g. tracked slots being immune to a fault class live slots are
   not, which is the real-world reason automation exists.
3. **Withdraw the toggle** and keep voice-tracking as flavour, or cut it. Live
   scheduling is the decision players are already making well.

Rule 1 applies to whichever is chosen: a design proof before a line of code.
