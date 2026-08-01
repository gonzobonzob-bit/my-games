# purr-and-power-tests

Test harnesses for `../purr-and-power.html`. Required by binding rule 2 in
`../CLAUDE.md` ("the balance harness ships with the game").

**No dependencies.** Node 24+ only — these use the native `WebSocket` global to
drive Chrome over the DevTools Protocol. Do not `npm install` anything.

Run from inside this directory:

```
node balance.mjs       # 40 runs x 4 years, survival distribution      ~2 min
node profiles.mjs      # 4 play-style profiles, skill-gradient check   ~5 min
node browsertest.mjs   # 48 assertions in real Chrome                  ~1 min
node hostile.mjs       # 28 hostile/corrupt saves                      ~2 min
```

Each resolves the game relative to its own location, so they work from any
clone. Chrome is expected at
`C:/Program Files/Google/Chrome/Application/chrome.exe` — edit `CHROME` if yours
differs.

## What each one guards

**`balance.mjs`** — the economy is winnable. Extracts the game's script, runs it
in Node against a minimal DOM stub, and drives the real simulation with a
competent autoplayer. Catches the class of bug that is invisible in a code read:
a starting roster missing a role required to finish a job, capacity constants
unrelated to real capacity, a stat with negative drift and no equilibrium.

**`profiles.mjs`** — skill matters. Runs competent / lowballer / reckless /
neglectful policies and reports the spread. If a deliberately bad strategy scores
the same as a good one, the central decision does not matter and that is a design
defect, not a balance one. Current expected spread: competent ~$7.0M vs lowballer
~$2.6M end cash, with reckless dying some of the time in year one.

**`browsertest.mjs`** — the game works. Menu, all five tabs at early and late
state, the quote modal, save/reload/continue, credit line, pause, the overwrite
guard, interval hygiene across menu cycles, and the bankruptcy path. Fails on any
uncaught exception or console error.

**`hostile.mjs`** — saves are untrusted input. 11 malformed shapes, out-of-range
numbers, two `__proto__` payloads, and an XSS attempt via a crafted save. Every
one must degrade gracefully rather than crash or blank the screen.

## Two traps, learned the expensive way

**Make the harness play the game.** A suite that idles the clock lets the economy
die, and then every later assertion fails against a dead save — which reads as
half a dozen product bugs that do not exist.

**An assertion can pass vacuously.** "Cat timers do not accumulate" scored
`0 -> 0` as a pass when the truth was that `startClock()` cleared them on
creation and the cats never moved at all. Assert a thing exists before asserting
it is bounded.
