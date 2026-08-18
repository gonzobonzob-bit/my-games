# Callsigns — smoke.mjs hangs silently in a sandbox, and what that cost

Rule 5 says test the instrument before you trust its measurements, and rule 6
says the pass writes down what would have caught the problem. This is both.

## What happened

`tests/smoke.mjs` produced **zero bytes in seven minutes** and had to be killed.
Not a failure, not a stack trace, not a partial run — silence, under both
`microsoft-edge` and `google-chrome`, at 420s and again at 500s.

Everything about that reads as "the suite is broken" or "the browser is
missing". Neither was true. Edge 151 is installed, launches headless, writes
`DevToolsActivePort` in 200ms, answers `/json/version`, accepts a WebSocket, and
returns cleanly from `Target.createTarget`, `Target.attachToTarget`,
`Runtime.enable` and `Page.enable`. Every single piece works in isolation.

**It hangs on `Page.navigate` to a `127.0.0.1` HTTP origin.** The suite serves
the game from a local `http.createServer` — correctly, and for a documented
reason: `localStorage` is partitioned and unreliable on `file://`, so the
save/reload half of the suite needs a real http origin. In a sandboxed tool
environment the spawned browser cannot reach that server. The navigation never
commits, the CDP reply never arrives, and the promise never settles.

## Why it was silent, which is the part worth learning

Three things stacked, and no one of them would have been enough:

1. **`send()` has no timeout.** Every other wait in the file is bounded —
   `until()` deadlines at 5s and throws with the expression it was waiting for,
   the port loop caps at 100 tries, the version loop caps at 100. The one
   unbounded wait in the file is the CDP round-trip itself, and that is the one
   that hung.
2. **The hang is before the first `assert()`**, so the suite had not yet printed
   a single line when it stalled.
3. **`timeout` kills with SIGTERM and Node's buffered writes die with it.** Early
   diagnosis was run as `node tests/smoke.mjs | head`, which lost the buffer
   entirely and made a partially-working run look like a totally-dead one. The
   stage markers that finally located the hang only appeared once the output
   went to a file that survived the kill.

Tell worth keeping: **a suite that prints nothing has not failed, it has
stalled** — and the two need different debugging. A failure is in the
assertions; a stall is in the plumbing, and it is almost always the one wait
nobody put a deadline on.

## The fix this pass did NOT make, and why it should be made

`send()` should take a deadline and reject with the method name, exactly as
`until()` already rejects with its expression. Then this environment produces
`CDP timeout: Page.navigate` in fifteen seconds instead of an eight-minute
silence, and the next person reads the cause off the screen.

It is not in this commit because the change belongs to whoever can also
re-verify the full 64-assertion suite afterwards, and this environment cannot
run it. Doing it blind would mean editing the instrument without being able to
test the instrument, which is the exact thing rule 5 is about.

## What to use instead, here

`docs/cutprobe.mjs` drives the real game over `file://` and measures the
rendered DOM. `file://` navigation works in the sandbox; only the local-server
origin is blocked. It cannot test save/reload — that is precisely what needs the
http origin — but it can measure layout, geometry, contrast, animation state and
console errors, which is what a visual pass needs.

`tests/rooms.mjs` and `tests/qafix.mjs` are pure Node with no browser and are
unaffected.
