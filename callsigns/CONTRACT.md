# Callsigns — Build Contract (Squad 1, 50% → 75%)

Binding on all four builders. Each builder edits EXACTLY one file. Anything
crossing a file boundary is named here; if you need something not in this
contract, implement your side against the names below and note the gap in your
report — do not edit another builder's file. Classic scripts sharing one
top-level scope, load order: content.js → sim.js → fx.js → ui.js. DESIGN.md's
arithmetic is binding; the owner's scope decision is DEEP (3–4 stations max,
TV/film architecture-only).

Line references in the greenlight documents point at the pre-split monolith
and are DEAD — locate by function name; the split moved code verbatim, so
every named function exists under the module listed here.

## File ownership

- `js/sim.js` — systems-engineer (and nothing else)
- `js/ui.js` + `index.html` + its CSS — interface-engineer (nobody else
  touches index.html)
- `js/content.js` — content-writer
- `js/fx.js` — art-and-feel
- `tests/` and these two .md files — integrator only

## The v3 state shape (SAVE_VER = 3, same 'callsigns.save' key)

```
S = {
  v: 3,
  stations: [                    // 1..4 entries; stations[0] is the flagship
    { call, freq, segment,       // segment: a SEGMENTS key
      tx, ant,                   // per-station gear indices (no more S.tx/S.ant globals)
      lease,                     // yesterday's lease bill, for display; recomputed daily
      schedule: {                // flat daypart-keyed, one per station
        morning: { show, djs: [], eng: null },
        midday:  { show, djs: [], eng: null },
        evening: { show, djs: [], eng: null },
        night:   { show, djs: [], eng: null }
      } }
  ],
  staff: [...],                  // GLOBAL — one pool for the whole empire.
                                 // That globality IS the scarce resource; a
                                 // per-station staff array is a design breach.
  candidates: [...],             // global; throughput must NOT scale with stations.length
  cash, rep, buzz, day, log, stats, opts, lastDay, lastTick, ...
}
```

- `slot.djs` is a string array of staff ids, ordered lead-first
  (crewSkill = s₁ + 0.55·s₂ + 0.30·s₃ reads that order). Cap length 3.
- `slot.eng` is a staff id or null. Invariant: within any one daypart, an
  engineer id appears on at most ONE station's slot (E engineers cover at most
  E same-daypart slots, empire-wide). sim owns enforcement; ui must surface
  the steal ("assigning here unassigns them from KXYZ morning").
- A staff id may appear in `slot.djs` on at most one station per daypart —
  same person, same hour, one place. Fatigue still counts total daily load.
- cash/rep/buzz stay empire-global (rep is the shared brand; per-station rep
  is out of scope this pass).

## SEGMENTS (content.js provides, data only)

```
SEGMENTS = {
  <id>: { name, icon,
          pop:   { morning, midday, evening, night },  // finite audience pools POP(p)
          comp:  { base, dayAmp },                     // rival pull C: day-indexed + bounded,
                                                       // NEVER revenue/payroll-derived
          leaseMul,                                    // segment premium on the lease formula
          staffRules }                                 // e.g. news segment needs eng coverage
}
```

3–5 radio segments this pass. **TV/film runway (architecture only, the whole
of it):** a station's `segment` is the game's channel abstraction — a TV or
film channel is just another SEGMENTS row with its own pop/comp/lease/
staffRules and a `medium` tag, flowing through the same
`audience = POP·pull/(K_COMP+Σpull)` share equation, the same lease line and
the same staff pool. Nothing in sim/ui/fx may branch on "radio"; when TV
lands in a future pass it must be a content row plus art, not an architecture
change. Zero lines of TV code and zero TV content rows ship in this overhaul —
adding any is a scope breach (producer condition #3).

## Cross-file API

### content.js provides (data + the t/t2 formatters, no logic)
- `SEGMENTS` as above; `TX_LEASE = [0,40,120,340,900]` and `ANT_LEASE` (tuned).
- `SHOW_TECH = { music:0.00, ads:0.10, talk:0.35, news:0.55 }`.
- `CHEM_TAGS` + per-person style tags on `makePerson`'s output shape: DJ
  affinity data for `chem(i)` pairing (producer condition #5 — this is what
  makes the portfolio card's "slots that suit them" true). Document pairings
  in comments.
- `STATION_COSTS = [cost2, cost3, cost4]` — rising buildout curve replacing
  the single SECOND_STATION_COST (collision #9).
- Retuned `SHOWS.music` so music wins ≥1 daypart on merit — show the
  coefficient arithmetic (weight·appeal·parts·adRate per daypart) in comments.
- All new player-facing copy in STR, keyed; keep event copy inline in EVENTS
  per the existing comment there.

### sim.js provides
- `marketShare(station, part)` implementing DESIGN.md mechanic #1. DELETES the
  `network = revenue*0.32` block in simulateDay outright (collision #1); the
  denominator includes own stations' pull; comp pull is day-indexed + bounded.
- Lease line in simulateDay's cost aggregation:
  `lease(s) = 60 + TX_LEASE[s.tx] + ANT_LEASE[s.ant]` (× segment leaseMul),
  paid per station per day, performing or not.
- `loadFactor(slot)` / `slotRisk(slot)` per mechanic #3, REPLACING the
  breakRisk block; fault: slot revenue ×0.55, rep −= 0.25·loadFactor. REMOVE
  engBonus from reachValue/fidelityValue rather than adding a second engineer
  path (collision #5) — reach/fidelity become per-station (station.tx/ant).
- `crewSkill(slot)`, `chem(slot)`, djFatigue over total daily load; djFor/
  djLoad and the sanitize orphan cleanup rewritten for `slot.djs` arrays +
  `slot.eng` across all stations (collision #4).
- `foundStation(segmentId)` with the rising STATION_COSTS curve and the
  station cap (4). Replaces foundSecondStation/doFoundSecondStation's state
  half; ui keeps the confirm flow.
- **v2→v3 migration** in `migrate()`, same commit as the state change
  (collision #8). Policy (from DESIGN.md, binding): a v2 save's run wraps into
  `stations[0]` — call, freq, tx, ant carried over, each `slot.dj` string
  becoming `djs:[id]`, `eng:null`. A founded v2 `secondStation` becomes a real
  `stations[1]` in the flagship's segment with a default schedule (v2
  newState's shows), NO staff of its own — staff stay exactly where they were,
  global — and Part 15/Whip gear (tx:0, ant:0): its revenue was always fiction,
  so it restarts as a real signal rather than inheriting invented gear. Keep
  wrapping v1→v2 first; sanitize() rebuilt for the stations array.
- `catchUp()` reworked for leases: apply negative net offline or accrue leases
  separately — closing the tab must not dodge losses (collision #7; the
  current positive-only gate `S.lastDay.net > 0` becomes an exploit the day
  leases exist).
- `refreshCandidates()` stays flat with station count — the harness asserts
  candidate throughput is independent of stations.length.
- **The balance harness ships in this stage** (producer condition #4):
  `tests/balance.mjs`, vault rule 2 shape — N≥30 runs of several game-years
  against the real tick(), ledger reconciling to cash daily, competent play
  survives / careless play dies / policy spread is real. Calibrate only
  against tick(), never bare simulateDay() (the sceneTier comment in fx.js
  records why: no candidate refresh → false plateau).

### fx.js provides
- `sceneTier()` reworked off hardcoded station count (collision #6) to read
  `S.stations.length` + empire state; the calibration envelope in its comment
  is pre-lease and INVALID — recalibrate against the 75% economy or the art
  ladder pins wrong.
- Scene art keyed per station (the Studio tab shows the selected station's
  tier); billboard/vehicle rebranding takes the station's call, not S.call.
- New sfx: lease-due warning, station sign-on, engineer fault. Keep the
  procedural tone() idiom, no asset files.

### ui.js / index.html provides
- **Station switcher** in the HUD (≤4 stations; the hud-call block becomes the
  switcher). Assignment surface must stay sub-linear in stations — one
  schedule visible at a time plus an empire-wide "uncovered slots today"
  strip, not four grids side by side (producer condition #2).
- Slot editor rebuilt for `djs[]` (add/remove co-hosts, lead first, chem and
  fatigue shown) and `eng` (with the cross-station steal warning). The
  "elsewhere" count now scans all stations (collision #4).
- firePerson's schedule scrub covers every station's schedule (collision #2).
- Empire tab becomes the founding flow: segment choice (SEGMENTS data,
  pop/comp shown), rising cost, cap at 4.
- viewStudio/viewGear read the ACTIVE station (gear is per-station now —
  buyGear targets station.tx/ant, collision #3); Daily Brief gains a lease
  line per station and an empire rollup.
- nextGoal() rewritten for the empire arc (it reads S.tx/S.ant today,
  collision #3).

## Collision list (from the accepted proof, mapped to the split)

1. `S.secondStation` is a decoration `{call,foundedDay,totalEarned}`; its
   whole sim is the network block in simulateDay — sim.js deletes it.
2. Single-schedule assumptions: newState, migrate, sanitize, simulateDay,
   djLoad (sim.js); openSlotEditor, firePerson (ui.js).
3. `S.tx`/`S.ant` scalar reads: reachValue, fidelityValue, sanitize (sim.js);
   buyGear, nextGoal, viewGear, render's hud-sub, breakdown gear-naming
   (ui.js/sim.js); sceneTier (fx.js).
4. `slot.dj` single-string readers: djFor, djLoad, sanitize orphan cleanup
   (sim.js); openSlotEditor elsewhere-count, viewStudio slot line (ui.js).
5. engBonus/salesFill/salesPrice are empire-wide scalars; engineer-per-slot
   REMOVES engBonus from reachValue/fidelityValue (sim.js) and the Station
   Effects card follows (ui.js).
6. sceneTier hardcodes station count into art (fx.js).
7. catchUp's `lastDay.net > 0` gate becomes a loss-dodge under leases (sim.js).
8. SAVE_VER 2 → 3, migration policy above, same commit as the shape change.
9. SECOND_STATION_COST single constant → STATION_COSTS curve (content.js).
10. Vault rule 3 modular layout — DONE at 50%; this directory is the split.

## Constraints (all builders)

- No CDN, no external runtime deps, no real brand names, no live API calls.
- Interval hygiene: new timers' handles stored and cleared with the existing
  stopAllTimers() discipline.
- Save/load stays try/catch-wrapped and degrades to fresh start; the v2→v3
  migration is exercised by a test fixture, not just eyeballed.
- `tests/smoke.mjs` must keep passing at every commit (it asserts the save
  key and — until the v3 commit lands — the v2 shape; the systems-engineer
  updates its shape assertions IN the v3 commit, not after).
- Every existing comment is a constraint post-mortem — preserve them through
  edits, and write new ones in the same voice.
- TV/film: one paragraph above is the entire allowance. Zero code.
