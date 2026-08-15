# Callsigns — final performance and compatibility pass

Branch `callsigns-rivals-build`. Read-only review; no game file was modified.

**Method.** Real Chrome 151 headless (`--remote-debugging-port=9232`), driven over
CDP with Node's native `WebSocket`, no npm. Numbers come from
`Performance.getMetrics` (`LayoutCount`, `RecalcStyleCount`, `TaskDuration`,
`ScriptDuration`, `JSHeapUsedSize`, `Nodes`, `JSEventListeners`),
`HeapProfiler.collectGarbage`, `Runtime.queryObjects`,
`Emulation.setCPUThrottlingRate`, `Emulation.setDeviceMetricsOverride` and
in-page `performance.now()` wrappers around the real `tick()`, `simulateDay()`
and `render()`. Every run drives the shipped code from a real
New Station → game screen click path, with `Math.random` seeded so a result is
reproducible.

**The fps number is ignored throughout.** Headless software rasterisation
reports a flat 60 regardless. `LayoutCount` is the figure that matters and it is
reported everywhere below.

---

## 1. Scoreboard

| # | Metric | Measured | Threshold | Verdict |
|---|--------|----------|-----------|---------|
| 1 | JS cost per simulated day, 4 stations, 1x CPU | **4.77 ms** | < 1/3 of the 1400 ms tick | **PASS** (0.34%) |
| 2 | Same, 6x CPU throttle (mid-range phone proxy) | **81.9 ms** | < 1/3 of 1400 ms | **PASS** (5.9%) |
| 3 | JS cost per simulated day, 1 station, 1x | **4.43 ms** | — | **PASS** |
| 4 | Cost growth 1 → 4 stations | **+7.7%** (4.43 → 4.77 ms) | < 2x | **PASS** |
| 5 | `tickRivalCapacity()` isolated (the v5 addition) | **0.017–0.022 µs/call**, 0.027 ms/day | < 5% of the day | **PASS** (0.5%) |
| 6 | LayoutCount per simulated day, 4 stations | **1.68** | < 5 | **PASS** |
| 7 | LayoutCount during 20 s idle, animations running | **0** | 0 | **PASS** |
| 8 | Heap after 100 / 500 / 2000 / 5000 real-time sim days | **1.48 / 1.98 / 2.64 / 3.59 MB** | no unbounded climb | **PASS** (see §3) |
| 9 | Live DOM nodes over 5000 sim days | **374 → 374** (flat) | flat | **PASS** |
| 10 | `JSEventListeners` over 5000 sim days | **17 → 15** | flat | **PASS** |
| 11 | `Nodes` after 2000 tab re-render cycles | **plateaus at 1428** from cycle 400 | plateau | **PASS** |
| 12 | Interval stacking over 40 menu↔game cycles | **net 0** after `stopAllTimers()` | 0 | **PASS** |
| 13 | Outstanding `setTimeout` handles, 5000 days | **oscillates 30–97, no trend** | no trend | **PASS** |
| 14 | Audio sources without a scheduled `stop()` | **0 of 29** across 11 sfx | 0 | **PASS** |
| 15 | Save payload, 4 stations, day 540 | **11,981 bytes** (0.23% of a 5 MB quota) | < 200 KB | **PASS** |
| 16 | `saveGame()` wall time | **0.12 ms**, fired once per 30 s wall clock | < 5 ms, throttled | **PASS** |
| 17 | Quota failure handling | returns `false`, **exactly 1 toast**, never throws | surfaced, not swallowed | **PASS** |
| 18 | Time to interactive, cold load | **144 ms** | < 1000 ms | **PASS** |
| 19 | Largest asset | **ui.js, 135 KB** | < 500 KB | **PASS** |
| 20 | External network requests | **0** over http *and* `file://` | 0 | **PASS** |
| 21 | Horizontal overflow at 320 px, every screen | **0 px** | 0 | **PASS** |
| 22 | Modal action buttons reachable at 320×320 landscape | **yes, sticky** | reachable | **PASS** |
| 23 | Buttons under 40×40 px at 320 px | **0** | 0 | **PASS** |
| 24 | Scroll position lost across 30 ticks, all 5 tabs | **0 px on all 5** | 0 | **PASS** |
| 25 | fx scene rebuilds over a real 540-day empire run | **33–35** (1 per ~16 days) | < 60 | **PASS** |
| 26 | Same, idle (non-expanding) run, hysteresis ON | **2** | — | **PASS** |
| 27 | Same, idle run, hysteresis DEFEATED | **4 / 10 / 14** across 3 seeds | — | deadband earns its keep |
| 28 | **Idle CPU, game paused, tab visible, nothing happening** | **1.43%** | < 0.2% | **FAIL — see F1** |
| 29 | Idle CPU with the gamepad rAF loop stopped | **0.03%** | — | 48x cheaper |
| 30 | Idle CPU, hidden tab | **0.05%**, sim timer cleared, 0 days advanced | ~0 | **PASS** |
| 31 | Oldest browser supported | **Chrome 105 / Safari 16.0 / Firefox 110** | ≥ 3 years old | **PASS**, barely — see §5 |
| 32 | Retained `OscillatorNode`s with a suspended AudioContext | **1847 after 6000 created** | 0 | **FAIL (latent) — see F2** |

Two failures. Everything else is clean and the clean results are stated
explicitly below so nobody re-tests this ground.

---

## 2. Frame cost and the tick loop

`tick()` is driven by `setInterval(tick, SPEEDS[speed])` with
`SPEEDS = {1:5000, 2:2600, 3:1400}`. The measurements below are at speed 3, the
fastest, per the brief.

### Per-simulated-day cost by empire size (1x CPU, 400 days per point)

| Stations | total JS ms/day | `simulateDay` | `render` (incl. children) | LayoutCount/day | RecalcStyle/day |
|---|---|---|---|---|---|
| 1 | 4.43 | 0.151 | 1.559 | 1.18 | 1.18 |
| 2 | — | 0.356 | 2.658 | 1.41 | 1.41 |
| 3 | — | 0.380 | 2.454 | 1.54 | 1.55 |
| 4 | 4.77 | 0.161–0.363 | 1.394–2.053 | 1.68 | 1.69 |

Going from 1 station to 4 costs **+7.7%** of the day's JS. Layout count rises
1.18 → 1.68, which is one extra layout per 2 simulated days.

### Where the time actually goes (4 stations, 6x CPU throttle, ms per simulated day)

```
render                20.98   <- 26% of the day, and it contains the next six
  viewSchedule         6.08
  viewBrief            4.29
  paintHudStats        1.82
  hudWarning           0.99
  viewCoach            0.97
  paintStationBar      0.53
  updateScene          0.37
simulateDay            2.43   <- the entire simulation is 3% of the day
empireExposure         1.39   (called 3x per render)
toast                  1.26   (0.67 calls/day)
noteHudDeltas          1.38
fxSceneKey             0.33
rollEvent              0.068
addLog                 0.030
```

**Answer to the question in the brief: time goes to DOM work in `ui.js`, not to
the sim.** At 6x throttle `render()` is 21 ms of an 82 ms day (26%) and
`simulateDay()` is 2.4 ms (3%). The single most expensive leaf is
`viewSchedule()` at 6.1 ms.

### The v5 per-segment rival capacity update: not a regression

`tickRivalCapacity()` was isolated over 20,000 calls at both empire sizes:

```
1 station: 0.0215 µs/call     4 stations: 0.0166 µs/call
segments: 5     rival networks: 3     => 15 (segment, network) pairs, fixed
```

It loops `segmentIds() × rivalNets()`, neither of which depends on how many
stations the player owns, so its cost is **constant in empire size and does not
appear in the 1-vs-4 delta at all**. In-tick it measured 0.023–0.044 ms/day —
under 1% of the day at every empire size. The v5 addition is not why anything is
expensive. Recorded explicitly because this was the specific suspicion.

### Lag spikes cannot run many simulated steps inside one frame

The loop has no accumulator (`/accumul|while.*dt|lag *[-+]=/` against
`String(tick)` → false). It is a plain `setInterval`, and the browser coalesces
missed firings. Measured: a **deliberate 4 s main-thread block at 1.4 s/day
advanced the sim by 2 days, not 3+**, and produced 2 renders rather than a burst.
A naive rAF/accumulator loop would have run three full days including three
`render()` calls inside one frame. **Clean — no fix needed.**

### The scroll container is not rebuilt out from under the player

`setPane()` compares the candidate HTML against a cached `el._uiHtml` and skips
the assignment when identical. Measured over 50 ticks on Studio at 4 stations:

```
studio-grid  22 writes of 50 ticks   <- guarded, and correctly so
stat-cash / lbl-cash / stat-listeners / stat-rep / studio-brief   50 of 50
```

`studio-brief` is the one container written unconditionally
(`ui.js:771 $('studio-brief').innerHTML = viewBrief();`). Checked whether that is
waste: over 200 real ticks the brief's HTML was **different on 200 of 200**
(`htmlIdentical: 0`), it has **0 interactive children**, and it is **not
scrollable** (`scrollHeight 164 === clientHeight 164`). So the unconditional
write is honest work on genuinely changed content — 2,241 bytes reparsed per
tick, ~1.6 KB/s at the fastest speed. **Not a defect. Leave it.**

Scroll preservation was measured directly: scroll `#game-content` to 60% of its
range, run 30 ticks, compare.

```
staff   1578 -> 1578   (lost 0)
empire   736 ->  736   (lost 0)
log     2548 -> 2548   (lost 0)
gear     307 ->  307   (lost 0)
studio   678 ->  678   (lost 0)
```

**Zero scroll loss on every tab.** The `_uiHtml` guard plus the fact that
`#game-content` itself is never rewritten is what buys this. This is the exact
failure mode the brief warned about and the game does not have it.

---

## 3. Long-session behaviour

This is the section that matters most for an idle game, so it was measured two
different ways.

### Real-time run (tick driven on a 6 ms interval, so `setTimeout` cleanup fires)

4 stations held for the whole run. GC forced twice before every sample.

| Sim day | Heap | `Nodes` | `JSEventListeners` | live DOM | scene nodes | outstanding timeouts | live intervals | `S.log` | save bytes | `fxTierMemo` |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1.16 MB | 747 | 17 | 359 | 72 | 18 | 0 | 21 | 5,509 | 2 |
| 100 | 1.48 MB | 885 | 32 | 374 | 72 | 67 | 0 | 60 | 12,039 | 2 |
| 500 | 1.98 MB | 984 | 37 | 374 | 72 | 97 | 0 | 60 | 11,967 | 2 |
| 2000 | 2.64 MB | 964 | 31 | 374 | 72 | 83 | 0 | 60 | 12,116 | 2 |
| 5000 | 3.59 MB | 834 | **15** | 374 | 72 | 30 | 0 | 60 | 12,328 | 2 |

5000 simulated days is ~1.9 hours of continuous play at the fastest speed, or
~7 hours at the default.

- **Live DOM is flat at 374 nodes from day 100 to day 5000.** No node leak.
- **Listeners end *lower* than they started** (17 → 15). No listener leak. The
  reason is architectural: `ui.js:2398` installs **one** delegated
  `document.addEventListener('click', …)` that dispatches on `e.target.closest(…)`
  for all 20-odd control types, so a re-render attaches nothing.
- **Every array with a growth path is capped.** `S.log` is trimmed to 60 in
  `addLog()` (`sim.js:1099-1100`) *and* again on load (`sim.js:1647, 1820`).
  `S.rivalNets` is bounded at 5 segments × 3 networks = **15 entries and it never
  moved**. `S.candidates` stayed at 2–3, `S.staff` at 18. There is **no unbounded
  history or notification array anywhere** — this was searched for specifically
  and is not present.
- **Save payload is flat at ~12 KB from day 100 to day 5000**, which is the same
  statement from the persistence side.
- **`fxTierMemo` held 2 entries** against its `size > 24` clear guard.
- Heap grew 1.48 → 3.59 MB between day 100 and 5000 = **0.43 KB per simulated
  day**, i.e. ~1.1 MB/hour at the fastest speed. That is JIT/code-cache and
  string churn, not retained state: nodes, listeners, timers, arrays and save
  size are all flat over the same window. A 12-hour session projects to ~17 MB.
  Not a leak, and not a phone problem.

### Re-render churn, isolated

2,000 tab-switch cycles in five batches of 400, GC'd between:

```
batch 1 (400):   Nodes=1428  liveDOM=819  detached=609  listeners=17  heap=2.83 MB
batch 2 (800):   Nodes=1428  liveDOM=819  detached=609  listeners=17  heap=3.04 MB
batch 3 (1200):  Nodes=1428  liveDOM=819  detached=609  listeners=17  heap=3.09 MB
batch 4 (1600):  Nodes=1428  liveDOM=819  detached=609  listeners=17  heap=3.16 MB
batch 5 (2000):  Nodes=1428  liveDOM=819  detached=609  listeners=17  heap=3.16 MB
```

`Nodes` is **identical to the digit across five batches**. The 609-node gap
between `Nodes` and live DOM is a constant retained pool (the inactive panes'
cached markup), not a growing set of detached nodes — a leak would show as
monotonic growth here and does not. Heap plateaus at 3.16 MB. **No detached-DOM
leak on re-render.**

### Interval hygiene

40 `returnToMenu()` → `enterGame()` cycles, with `setInterval`/`clearInterval`
wrapped and counted:

```
{"beforeLiveIntervals":0, "afterLiveIntervals":2, "afterStopAll":0}
```

Two live intervals after 40 cycles — the sim clock and the 30 s autosave from
the *final* `enterGame()` — and `stopAllTimers()` returns it to 0. **No interval
stacking**, which is the bug CLAUDE.md records as having bitten this vault three
times. `enterGame()` → `startAllTimers()` → `stopAllTimers()` is correctly
balanced.

### fx.js timers and audio nodes

Outstanding `setTimeout` handles oscillated 18 → 67 → 97 → 83 → 30 with no
trend across 5000 days. fx.js's two `setTimeout(kill, 1600)` paths and
`setTimeout(…, 520)` shake-class removal all fire and are matched by their
`animationend` handlers. `document.addEventListener(…, {once:true})` is used for
the three gesture latches, so there is nothing for `stopAllTimers()` to clean up.

Every sfx was rendered in an `OfflineAudioContext` (48 kHz, 4 s) with
`createOscillator`/`createBufferSource` counted and `stop()` intercepted:

| sfx | sources | stops scheduled | peak | rms | duration | clipped samples |
|---|---|---|---|---|---|---|
| sfxClick | 1 | 1 | 0.0436 | 0.00143 | 32 ms | 0 |
| sfxBuy | 2 | 2 | 0.0778 | 0.00305 | 144 ms | 0 |
| sfxOnAir | 3 | 3 | 0.0908 | 0.00655 | 354 ms | 0 |
| sfxDeadAir | 3 | 3 | 0.1003 | 0.00718 | 493 ms | 0 |
| sfxFault | 3 | 3 | 0.1002 | 0.00717 | 493 ms | 0 |
| sfxTrouble | 2 | 2 | 0.0559 | 0.00391 | 198 ms | 0 |
| sfxBankrupt | 3 | 3 | 0.0918 | 0.00845 | 952 ms | 0 |
| sfxLease | 2 | 2 | 0.0263 | 0.00096 | 99 ms | 0 |
| sfxLeaseDue | 3 | 3 | 0.0522 | 0.00383 | 444 ms | 0 |
| sfxSignOn | 6 | 6 | 0.1222 | 0.00897 | 839 ms | 0 |
| sfxChem | 1 | 1 | 0.0540 | 0.00248 | 123 ms | 0 |

**29 sources, 29 scheduled stops, zero clipped samples, peak 0.1222, longest
952 ms.** Nothing lingers on the audio graph in a running context, nothing is
loud enough to clip, and no sound outstays a tick. One latent hazard when the
context is *not* running — see F2.

---

## 4. Small screens and orientation

Six viewports, `Emulation.setDeviceMetricsOverride` at dsf 2 with touch
emulation, every screen (menu, new-station modal, intro modal, all five game
tabs, slot editor, pause menu, options), with the worst-case state forced:
**4 stations, 18 staff, a deliberate DJ double-booking on `morning` at every
station, and 30-character DJ names.**

| Viewport | Result |
|---|---|
| 320×568 | clean — 0 px horizontal overflow, 0 buttons under 40×40 |
| 360×640 | clean |
| 390×844 | clean |
| 844×390 landscape | clean |
| 667×375 landscape | clean |
| 568×320 landscape | clean |

`document.documentElement.scrollWidth - innerWidth = 0` on every screen at every
viewport. **No horizontal scroll anywhere.**

### The station switcher at 320 px — checked, and it is fine

The audit initially flagged `.st-chip` as extending 184 px past the right edge at
320 px. It is **not clipped**: `#station-bar` is a deliberate horizontal scroller.

```
overflowX: auto   scrollWidth: 512   clientWidth: 320   hidden: 192px   chips: 4
scrollLeft before a forced rebuild: 192   after: 192   (preserved)
active chip after setStation(last): fully visible
```

The rebuild in `paintStationBar()` is key-guarded (`stationBarKey`) and, when it
does fire, **does not reset `scrollLeft`**. `index.html:704-706` already tightens
`.st-bar` padding and `.st-chip` min-width below 359 px. Working as designed.

*One small gap, gamepad-only:* `cycleStation()` (`ui.js:2696-2703`) can select a
station whose chip is scrolled off-screen at 320 px, because nothing calls
`scrollIntoView`. Touch players tap the chip, so they cannot hit this.

### The always-visible staff bench and the DJ conflict warnings (v4)

These live in the slot-editor modal (`ui.js:1937-1990`), not the Staff tab, so
they were opened explicitly with a double-booked DJ so the `.warnrow` conflict
rows were on screen.

| Viewport | modal top | modal h | scroll height | overflow-y | clipped above? | actions reachable? | actions position | content wider than sheet? |
|---|---|---|---|---|---|---|---|---|
| 320×568 | 45 | 523 | 3051 | auto | no | **yes** | sticky | 0 px |
| 360×640 | 51 | 589 | 2963 | auto | no | **yes** | sticky | 0 px |
| 667×375 | 0 | 375 | 2601 | auto | no | **yes** | sticky | 0 px |
| 844×390 | 0 | 390 | 2591 | auto | no | **yes** | sticky | 0 px |
| 568×320 | 0 | 320 | 2668 | auto | no | **yes** | sticky | 0 px |

- **The modal is never clipped above its scroller** at any viewport, including
  320 px tall. This is the failure the brief calls out (centred content in an
  overflowing flex container) and the game avoids it: `index.html:757-758`
  switches `.modal-back` to `align-items:stretch` on short viewports instead of
  leaving it centred.
- **The action bar is `position:sticky; bottom:0` and stays on screen at every
  viewport**, including 320 px tall where the sheet is 2,668 px of scroll
  content. `index.html:456-470` documents the measured fix (the old
  `bottom:-18px` put Close/Done off-screen); it holds.
- **No content overflows the sheet horizontally** even with 30-character DJ
  names — the conflict warning text (`ui.js:1986-1987`, "takes Ray off WTPZ
  morning") wraps rather than clipping.
- 15 bench rows rendered at every viewport with the crew full.

The bench sits at y≈683–997 on open, i.e. **below the fold on every viewport
including 390×844** — that is inherent to a sheet that lists format, readout,
crew, engineers *then* bench, and the sticky title/actions mean the player never
loses their place. Noted, not filed.

### Empire tab, 4×4 coverage matrix at 360 px

```
153 nodes, 7,541 bytes, 16 coverage cells, 0 cells under 28x28,
pane scrollWidth 328 == clientWidth 328  (0 px horizontal overflow)
```

Worst-case pane sizes at 4 stations: studio 205 nodes / 9.9 KB, staff 222 / 10.7 KB,
empire 153 / 7.5 KB, log 45 / 2.1 KB, gear 43 / 1.8 KB. All small.

### Reduced motion

Honoured, and measured rather than assumed:

```
prefers-reduced-motion: reduce          -> 0 of 27 scene elements animating, fxReducedMotion() true
prefers-reduced-motion: no-preference   -> 8 of 27 scene elements animating, fxReducedMotion() false
```

`prefers-color-scheme` rules in the stylesheet: **0**. The game is dark-only and
makes no light-mode claim, so there is nothing to fail.

---

## 5. Older browsers

All four scripts pass `node --check`. Nothing found in the following sweep:

`structuredClone`, `Object.groupBy`, `Map.groupBy`, `Object.hasOwn`,
`Array.prototype.at`, `findLast`/`findLastIndex`, `toSorted`/`toReversed`/`toSpliced`/`with`,
`Promise.any`, `Promise.allSettled`, `WeakRef`, `FinalizationRegistry`,
`requestIdleCallback`, `ResizeObserver`, `AbortController`, `queueMicrotask`,
`crypto.randomUUID`, `replaceChildren`, `String.matchAll`, `Array.flat`,
`Intl.*`, `BigInt`, `Proxy`, `Reflect`, top-level `await`, `import`/`export`,
class fields, static blocks, `??=`/`||=`/`&&=`, numeric separators.

The JS does not even use `?.` or `??` (0 occurrences in all four files). The
scripts are classic `<script src>` tags at the end of `<body>` — no modules, no
`defer`, no top-level await. **JS floor is roughly ES2017.**

CSS in `index.html` is all long-baseline: `gap`, `inset`, `position:sticky`,
`backdrop-filter`, `aspect-ratio`, `:focus-visible`, `env(safe-area-inset-*)`,
`overscroll-behavior`, `clamp()`, `prefers-reduced-motion`. **No `:has()`, no
`dvh`/`svh`, no `color-mix()`, no `light-dark()`, no `@layer`, no `@property`,
no `@scope`, no `subgrid`, no `popover`.**

**The single feature that sets the floor is container queries**, used only by
the station scene in `fx.js`:

```
js/fx.js:24   container-type:inline-size;line-height:1;isolation:isolate;
              61 cqw declarations across width, height, border-radius,
              box-shadow, margin, font-size, transform, border
```

| Engine | Requires | Shipped |
|---|---|---|
| Chrome / Edge | 105 (container queries + `cqw`) | Aug 2022 |
| Safari / iOS | 16.0 (container queries **and** `overscroll-behavior`) | Sep 2022 |
| Firefox | **110** (container queries) | Feb 2023 |

**Oldest browser it runs on: Chrome 105, Safari 16.0, Firefox 110.** The binding
constraint is Firefox 110, ~3.5 years old. That clears a 3-year bar, but only
just, and Firefox is the reason.

**What actually breaks below that floor**, measured by invalidating all 61 `cqw`
declarations at runtime (the exact thing a browser that does not know the unit
does — invalid declaration, dropped) and re-measuring the scene:

```
supported:    scene 358x112, 69 elements,  3 zero-sized
cqw invalid:  scene 358x112, 69 elements,  9 zero-sized
rest of UI:   game content 390px, 5 tabs, HUD correct, 0 interactive nodes in the scene
```

The scene wrapper keeps its box (it is sized by `aspect-ratio`, not `cqw`); six
decorative sub-elements collapse to zero size. **The game stays fully playable
and correctly laid out — the skyline just loses detail.** The scene has zero
interactive children and is already `display:none` in landscape
(`index.html:~772`). So the degradation on Safari 15 / Firefox 109 is cosmetic,
not functional. That is a good outcome and it means no fix is required unless
those engines are explicitly in scope.

---

## 6. Battery / CPU when idle-but-open

`TaskDuration` deltas from `Performance.getMetrics` over 20-second windows.
Critically, these were sampled **without** an instrumenting rAF loop of our own,
because a probe that schedules `requestAnimationFrame` itself forces 60 fps frame
production and inflates every reading (the first attempt did exactly that and
reported 3.96%; the corrected figure is 2.62%).

| State | CPU | Script | RecalcStyle | LayoutCount | RecalcStyleCount |
|---|---|---|---|---|---|
| Main menu, animated backdrop | **4.83%** | 0.070 s | 0.2736 s | **0** | 1199 |
| Game, default speed 1 (5.0 s/day) | **2.62%** | 0.041 s | 0.1256 s | 6 | 441 |
| Game, fastest speed 3 (1.4 s/day) | **2.06%** | 0.036 s | 0.0608 s | 11 | 256 |
| Game, sim **paused** | **1.43%** | 0.025 s | 0.0506 s | **0** | 244 |
| Game, paused + `body.no-motion` | **1.21%** | 0.047 s | 0.0065 s | 1 | 1 |
| Game, paused + gamepad rAF loop stopped | **0.03%** | 0.000 s | 0.0004 s | **0** | 2 |
| **Hidden tab** | **0.05%** | 0.000 s | 0.0004 s | **0** | 2 |

Three readings out of this:

1. **`LayoutCount` is 0 during idle with all animations running.** The scene's
   twelve infinite animations are transform/opacity only and stay off the layout
   path. This is the regression the brief says to watch for and it is not present.
2. **Hidden-tab handling is correct.** `visibilitychange` clears the sim timer
   while deliberately leaving `running` true, the autosave interval stays alive
   by design, and **0 sim days advanced over 8 s of hidden time at 1.4 s/day**.
   Cost drops to 0.05%.
3. **A paused game with nothing happening costs 1.43% CPU, and 1.40 points of
   that is the gamepad polling loop.** That is F1.

---

## 7. Failures and the specific fix for each

### F1 — the gamepad rAF loop never stops, and it is the entire idle cost

**Where:** `pollPad()` / `initPad()`, `js/ui.js:2705-2770`.

```js
function pollPad(){
  const now = performance.now();
  if (!padOn && now - lastPoll < 250) { requestAnimationFrame(pollPad); return; }
  ...
  requestAnimationFrame(pollPad);
}
function initPad(){
  window.addEventListener('gamepadconnected', () => { padOn = false; });
  requestAnimationFrame(pollPad);
}
```

**Measured:** with the sim paused, `body.no-motion` off and the player doing
nothing, CPU is **1.43%**. Stopping the rAF loop (and nothing else) takes it to
**0.03%** — a **48x** reduction. The loop also survives reduced motion: the
`no-motion` sample still cost 1.21% because rAF keeps producing frames whether or
not anything animates. `RecalcStyleCount` over 20 s idle is 244 with the loop and
2 without.

The 250 ms throttle inside `pollPad` limits the *polling*, but the unconditional
`requestAnimationFrame(pollPad)` tail keeps a frame callback permanently pending,
so the browser produces frames at display rate forever. On a phone that is the
compositor and display pipeline never being allowed to idle, for a game people
leave open for hours.

**Fix:** only run the rAF loop when a pad is actually present, and never while
hidden.

- Gate the tail: `if (padOn && !document.hidden) requestAnimationFrame(pollPad);`
- Replace the "is a pad there yet" duty with a cheap wall-clock probe rather than
  a frame callback — a `setInterval(…, 500)` that calls `navigator.getGamepads()`
  and starts the rAF loop on first sight. Store its handle next to `timer` and
  `autosaveTimer` and clear it in `stopAllTimers()`, per CLAUDE.md's interval
  hygiene rule.
- Keep the existing `gamepadconnected` listener as the fast path (Chrome fires it
  on first button press) and add `gamepaddisconnected` to stop the loop again.
- Add the loop start/stop to the `visibilitychange` handler at `ui.js:2547`,
  which already owns the hidden-tab policy.

Projected result from the measurement: idle-but-open cost falls from 1.43% to
~0.05% for the ~100% of players with no controller attached, with no change to
controller behaviour.

### F2 — a suspended AudioContext accumulates oscillator nodes that never stop

**Where:** `tone()` `js/fx.js:1010-1025`, `sweep()` `1030-1046`,
`noiseBurst()` `1055-1080`. All three gate only on `audioOn()` (the Sound
setting), never on whether the context is actually running.

**Measured:** with `actx.state === 'suspended'` (so `currentTime` stays 0 and no
scheduled `stop(t0 + dur)` ever arrives), 4,500 sfx calls created ~6,000
oscillators and **`Runtime.queryObjects(OscillatorNode.prototype)` reported 1,847
still retained after two forced GCs**, plus 287 retained `AudioBuffer`s from
`noiseBurst`'s per-call 12k-float buffer.

**Severity: latent.** In normal play the first sound happens inside a click, so
the context resumes and every source stops on schedule — §3 confirms 29 sources /
29 stops and a flat heap over 5,000 days. The exposure is a context that stays
suspended: an autoplay-policy edge case, an iOS tab that comes back with the
context still suspended after `resume()` rejects, or any future non-gesture entry
path. Nothing about the current click-to-play flow triggers it, which is why the
heap results are clean.

**Fix, three lines, in `js/fx.js`:** add a state guard beside the existing
`audioOn()` check at the top of `tone()`, `sweep()` and `noiseBurst()`:

```js
const ctx = ensureAudioCtx();
if (!ctx || ctx.state !== 'running') return;   // <- add this clause
```

`ensureAudioCtx()` already calls `actx.resume()`, so the next call after a real
gesture succeeds normally. This also removes the wasted 12k-float buffer
allocation in `noiseBurst()` on every muted-context call.

---

## 8. Clean measurements — recorded so nobody re-tests them

Stated explicitly because a clean measurement is a result:

- **No memory leak.** Live DOM 374 → 374 and listeners 17 → 15 over 5,000
  simulated days; `Nodes` identical to the digit across five batches of 400 tab
  re-renders; heap plateaus. Heap grows 0.43 KB per simulated day, all of it
  code-cache and string churn, none of it retained state.
- **No unbounded array.** `S.log` capped at 60 in `addLog()` and again on load;
  `S.rivalNets` bounded at 15 entries and measured flat; save payload flat at
  ~12 KB from day 100 to day 5,000. There is no history or notification ledger
  anywhere in the state that grows.
- **No interval stacking.** 40 menu↔game cycles net zero live intervals.
- **The v5 rival capacity update is not a cost.** Constant in empire size,
  0.017–0.022 µs/call, <1% of a simulated day. The 1-vs-4-station delta is +7.7%
  and none of it comes from here.
- **No scroll loss and no destroyed in-flight interaction.** Zero pixels lost on
  all five tabs across 30 ticks; the one unconditional `innerHTML` write
  (`studio-brief`) is on genuinely changed content with no interactive children
  and no scroll.
- **No layout thrash.** 1.68 layouts per simulated day at 4 stations; **0**
  layouts during 20 s of idle with all animations running.
- **No lag-spike catch-up burst.** `setInterval`, no accumulator; a 4 s block
  advanced the sim 2 days.
- **Save is cheap, throttled and safe.** 12 KB, 0.12 ms, once per 30 s wall
  clock (0.047 saves per simulated day at the fastest speed). Quota failure
  returns `false`, raises exactly one toast, never throws. Corrupt, `null`,
  empty, array-shaped and future-version saves all degrade to "no save";
  a JSON `__proto__` payload does **not** pollute `Object.prototype`.
- **Startup is 144 ms to interactive** with `domInteractive` at 135 ms, no asset
  over 500 KB (largest is `ui.js` at 135 KB), and **zero blocking work before
  first paint**.
- **Zero network.** No CDN, no remote font, no `fetch`, no `XMLHttpRequest`, no
  `WebSocket`, no external API, no key material. Verified statically *and* by
  loading from `file:///…/callsigns/index.html` with `Network.enable` recording
  every request: five `file://` requests (`index.html` + the four scripts), **0
  non-`file://` requests**, all modules resolved, and the New Station modal
  opened normally with no console errors.
- **Reduced motion is honoured**, measured: 0 of 27 scene elements animating
  under `prefers-reduced-motion: reduce` versus 8 of 27 without.
- **Audio is clean**: 29 sources, 29 stops, 0 clipped samples, peak 0.1222,
  longest sting 952 ms.
- **fx.js scene rebuild count is at baseline**: 33–35 rebuilds over a real
  540-day, 4-station empire run across three seeds — one rebuild per ~16
  broadcast days, well under the "7 in 40 days" regression the code comment
  records.

### The `fxSceneKey()` deadband — it works, and here is the run type where it matters

Three seeds × 540 real days × two policies, with the shipped hysteresis on, then
with `fxTierMemo` cleared before every `sceneTier()` call so the 6% deadband
cannot fire:

| Run | rebuilds ON | rebuilds OFF | tier flips ON | tier flips OFF |
|---|---|---|---|---|
| seed 777, expanding empire | 34 | 34 | 4 | 4 |
| seed 1234, expanding empire | 35 | 35 | 4 | 4 |
| seed 90210, expanding empire | 33 | 33 | 4 | 4 |
| seed 777, idle single station | **2** | 4 | 2 | 4 |
| seed 1234, idle single station | **2** | **14** | 2 | 14 |
| seed 90210, idle single station | **2** | **10** | 2 | 10 |

On an **expanding** run the deadband is a no-op — the score climbs monotonically
and never dips back across a cut, so 34 = 34. On an **idle single-station** run,
which is where `S.listeners` swings with buzz and weather and parks near a cut,
it cuts rebuilds from 4/14/10 down to a flat 2 — up to **7x**, and it pins the
result at the minimum regardless of seed. That is precisely the flicker the
comment at `fx.js:673-693` says it was added for, confirmed on real runs rather
than a synthetic oscillation. Attribution of the 34 empire-run rebuilds: 16 from
genuine tier progression, 2 from `fxStationDark` flips, 1 initial; the remainder
from tier changes coincident with founding. `fxTierMemo` held 2–5 entries against
its 24-entry clear guard.

---

## 9. Reproducing this

Scripts are in the session scratchpad, not the repo, and are dependency-free
Node with a shared `cdp.mjs`:

```
1-tick-cost.mjs      per-day cost at 1/2/3/4 stations, innerHTML write census
2-tick-breakdown.mjs per-function breakdown at 1x/4x/6x CPU, save timing
3-longrun.mjs        heap/nodes/listeners/timers at day 100/500/2000/5000
4-audio-detached.mjs retained audio nodes, detached-DOM plateau, 20k-day heap
5-viewports.mjs      six viewports x nine screens, overflow and clipping
6-slot-editor.mjs    staff bench + DJ conflict rows on narrow/short screens
7-stationbar.mjs     station switcher scroll behaviour at 320 px
8-fx-idle-startup.mjs startup, file://, fx rebuilds
9-idle.mjs           idle CPU, visible vs paused vs no-motion vs hidden
10-misc.mjs          fx rebuild attribution, lag spike, reduced motion
11-audio-hyst.mjs    OfflineAudioContext sfx render, studio-brief churn
12-final.mjs         scroll preservation, hysteresis A/B, empire tab
13-compat.mjs        container-query degradation, save/quota/corrupt-load
```

Note for whoever runs these next: `9-idle.mjs` must not schedule its own
`requestAnimationFrame` to count frames. Doing so forces 60 fps frame production
and inflates every CPU reading — it is what made the first pass report 3.96%
where the true figure is 2.62%.
