# Callsigns — the suite was never wedged, and how a silence got misread as one

**Status: the earlier version of this document was WRONG, and this is the
correction.** It claimed `tests/smoke.mjs` could not run in a tool sandbox
because the spawned browser cannot reach a `127.0.0.1` origin. Both halves are
false. Measured 2026-08-18, in the same kind of environment:

| origin the spawned headless browser was pointed at | result |
|---|---|
| `http://127.0.0.1:<port>/` (loopback) | **reached** |
| `http://localhost:<port>/` | **reached** |
| `http://192.168.1.55:<port>/` (LAN) | **reached** |
| `https://gonzobonzob-bit.github.io/...` (public) | **reached** |

`tests/smoke.mjs` then ran to completion in **under 40 seconds: 64 passed, 0
failed, zero console errors.** `tests/harness.mjs` runs too. Neither has a
sandbox problem. Rule 5 says test the instrument; nobody had re-tested this one,
and a whole workaround grew on top of the belief.

## What actually produced the silence

`node tests/smoke.mjs | head` and `node tests/harness.mjs | tail -22`.

A pipe makes Node's stdout **fully buffered** rather than line-buffered. Nothing
reaches the terminal until the buffer fills or the process exits. Kill it with
`timeout` — SIGTERM — and the buffer dies unflushed. So a suite that was
running perfectly well printed exactly zero bytes for as long as anyone was
willing to wait, and did it again on the retry, and did it under two different
browsers, because the cause was never the browser.

That reproduces on demand and has now cost two sessions. The second one is this
one: `harness.mjs` was run here as `| tail -22`, produced nothing in ten
minutes, and was written up as "wedges like smoke.mjs, same 127.0.0.1 failure" —
inheriting this document's conclusion instead of testing it. Re-run unpiped to a
file, it printed its first policy table in 45 seconds.

**The tell: `| head` and `| tail` are not free.** On a long-running command they
are the difference between watching progress and watching nothing. Redirect to a
file and read the file.

## The real defect underneath, now fixed

Both suites still had one genuinely unbounded wait: the CDP round trip in
`send()`. Every other wait in those files is bounded — `until()` deadlines and
throws with the expression it wanted, the port loop caps at 100 tries, the
version loop caps at 100 — so a CDP call that never came back was the one thing
that could hang forever, and it would hang *before the first assertion printed*.

`send()` now takes a deadline and rejects with the method name, in two tiers:

- `CDP_MS` = 30s for control-plane calls (navigate, attach, enable). These
  answer in milliseconds or never.
- `EVAL_MS` = 30min, passed explicitly by the single `evaluate()` wrapper.
  `Runtime.evaluate` is where the game actually runs and a policy sweep is
  minutes of genuine work; killing it for being slow would be a worse bug than
  the one being fixed.

Verified by breaking it on purpose rather than by reading it: a call given a
1000ms deadline against 6000ms of work rejects in under 2.5s with
`CDP timeout after 1000ms: Runtime.evaluate`; a healthy call still returns 42; a
3s call under the 60s tier still returns its value. Full suite after the change:
64 passed, 0 failed.

So the hang class is closed — but note that **it was never the thing that
actually bit.** The unbounded `send()` was a real latent defect and is worth
fixing; the silence everyone was debugging was a shell pipe.

## What this means for how to test here

Use the real suites. They work.

- `node tests/smoke.mjs` — 64 assertions, ~40s. **Redirect to a file.**
- `node tests/harness.mjs` — the balance harness, many minutes. Redirect, and
  read the file while it runs rather than waiting for an exit.
- `node tests/rooms.mjs`, `node tests/qafix.mjs` — pure Node, no browser, ~1s.
- `docs/cutprobe.mjs`, `docs/bayprobe.mjs` — `file://` render and click probes.
  Still useful for fast geometry and click-path questions, but they are no
  longer a *substitute* for smoke, and nothing should be described as
  "harness-verified only" on the grounds that smoke cannot run here.

## The harness baseline, so nobody mistakes it for a regression

`tests/harness.mjs` ends **26 passed, 4 failed**, and it is supposed to. All
four are design gates recorded as failures on purpose, not breakage:

| gate | what it says | status |
|---|---|---|
| `R3(a)` / `R3(b)` | which room is better does not reverse with who is spare | known — "allowed to fail", `RESEARCH_MOGUL_LADDER.md` |
| `VT-1(a)` / `VT-1(e)` | reading state cannot beat never-tracking by the 5% bar | known — `BALANCE_VOICETRACK.md`, awaiting the owner's call on three ways forward (`7a0eab8`) |

The gates that would catch a real economic regression all pass: LOSABLE both
ways, WINNABLE both ways, the policy spread, and no page errors in any run.
**So "4 failed" is the expected result — compare failures by NAME, never by
count.** Verified 2026-08-18 immediately after the bay-identity change, which is
economically neutral by construction: `bayLeaseTotal()` sums `bayLease(i)` over
the whole programme regardless of which floors are occupied, so moving a room
between bays cannot move a dollar.

## The lesson worth keeping

**A suite that prints nothing has not failed, it has stalled — and before
blaming the plumbing, check whether anything was ever going to print.** A
failure is in the assertions, a stall is in the plumbing, and a silence may be
in neither. The first question is not "what is hanging" but "would I see output
if it weren't".

And the compounding one: this document was confidently wrong for two sessions,
and was *believed* the second time precisely because it was written down and
specific. A measurement in a doc carries the date and the environment it was
taken in, or it becomes folklore. Every table above is from 2026-08-18 and was
re-run, not remembered.
