# Callsigns 75% — integrator checklist (accumulating as builders land)

## Landed
- ✅ content.js → branch callsigns-75-content (7660175). Agent had no Bash; I
  committed/pushed for it. (Lesson: content-writer agent type has no shell —
  never ask it for git ops; collect its files from the worktree.)

## Pending
- systems-engineer → callsigns-75-sim (sim.js + smoke v3 assertions)
- interface-engineer → callsigns-75-ui (ui.js + CSS)

## Landed: fx.js → callsigns-75-fx (a91e9df)
Verified: node --check, smoke 15/15, own 75-assertion harness (scratchpad
fxcheck.mjs — keep it; audio measured in OfflineAudioContext, 320px
containment, hostile input), perf rebuild count at baseline via 6% deadband
hysteresis on scene tier.

### fx.js API expectations for integration (from its report):
1. Reads S.activeStation (int index, clamped, falls back 0) — ui.js must use
   this name or call fxActiveStation(S).
2. ui.js must adopt fxSceneKey() for scene rebuild keying (old
   sceneTier()+'|'+S.call+'|'+S.freq breaks under v3: S.call undefined, no
   change on founding/switch). renderScene(idx)/sceneTier(st,idx) take
   optional index.
3. buildMenuScene() must use fxBrandArt(html,state,idx) or it prints
   "undefined" against v3 saves.
4. opts.volume (0..1) read if present — a settings slider drops in free.
5. sfxChem(v) takes the chem multiplier (1.0 neutral) — do NOT pass booleans.
6. Wire call sites in sim/ui: sfxFault, sfxSignOn, sfxLease (quiet daily),
   sfxLeaseDue (fire on threshold CROSSING only, not every day), sfxChem.
   Only sfxDeadAir is live today.
7. fxFly(fromEl,toEl,text,kind) — ui.js owns elements and calls it.
8. sceneTier recalibration = harness job (cuts [52,84,124,176,262] are
   DERIVED not measured; check cap/floor interaction on real 3–4 station
   saves). v2→v3 migrated saves never exercised through fxStations().
9. Reduced motion gated in JS deliberately (CSS animation:none would strand
   overlays waiting on animationend — they have setTimeout backstops anyway).
10. Haptics latch until first real user gesture (Chromium logs errors
    otherwise); unverifiable headless — someday check on phone.

## Integration decisions flagged by content-writer (settle at merge)
1. **STATION_COSTS disagreement, order of magnitude.** content.js declares
   [12000, 40000, 115000] (+ UNLOCK_CASH 60000→9000, UNLOCK_REP 70→32, keeping
   unlock below first buildout). sim.js carries STATION_COSTS_FALLBACK
   [120000, 260000, 520000]. content.js is the declared owner so its values
   take effect. Harness settles the right ladder — do NOT hand-pick at merge;
   note it as the harness's first tuning question.
2. **eventVars(S) must be wired into rollEvent()'s variable bag** (sim side).
   Event copy uses {rival},{co},{eng},{gear},{call},{seg}; sim currently
   supplies only {part},{name}. EVENT_FALLBACKS hardening means unwired vars
   render fallbacks, not raw braces. Side effect: sim's tOr() inline fallbacks
   now render "your signal" for unsupplied {call} — behavior change, benign.
3. **SEGMENTS key 'citywide' is load-bearing** — sim's DEFAULT_SEGMENT +
   segmentOf() fallback. Never rename.
4. **SAVE_VER stays 2** (localStorage key generation); sim owns STATE_VER=3
   inside the payload. Do not bump SAVE_VER.
5. **SECOND_STATION_COST kept as derived alias** (= STATION_COSTS[0]) because
   50%-baseline ui.js reads it. Delete in the commit that lands foundStation()
   (i.e., when ui branch merges).
6. **Copy written to v3 truth** (leases unconditional, one-engineer-per-daypart
   empire-wide, nothing-runs-itself) — false against 50% baseline; true once
   sim merges. Verify at merge: engineer exclusivity enforced on EVERY write
   path (setSlotEngineer returns `stole`, but check migrate/sanitize/firePerson).
7. **ui.js must supply {slots} for causeTalentThin.**
8. **Shared-scope globals:** content.js deliberately does NOT declare
   MAX_STATIONS, CHEM_MIN, CHEM_MAX, LEASE_BASE (sim owns them; duplicate
   const in classic-script shared scope = parse-time SyntaxError). Watch the
   other two branches for the same class of collision at merge — grep for
   duplicate top-level const/let across the four files.
9. Chem graph symmetry is a correctness requirement (sim reads first-member
   edges only) — if anyone edits CHEM_TAGS later, re-verify both ends of every
   edge; no tag lists itself.

## After all four merge into callsigns-empire
- Run tests/smoke.mjs (v3 assertions from sim branch).
- Wire-up gaps (eventVars, {slots}) — integrator commits.
- Launch balance-scientist to write callsigns/tests/harness.mjs vs merged v3
  sim (producer condition: harness at 75%), first question: STATION_COSTS
  ladder + the L*/R*/T* crossovers from DESIGN.md.
- 75% stop-and-report to Gonzo (playable build on branch; balance UNVERIFIED).
