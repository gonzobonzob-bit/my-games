# CALLSIGNS — PRODUCER READ (condensed; verdict INVEST-WITH-CONDITIONS, 2026-08-07; owner accepted DEEP scope: 3–4 stations, TV/film architecture-only)

## Hook
"Every hour of the broadcast day needs a voice and a pair of hands, and you own fewer of both than you have hours." Lead with the four-letter callsign and the 50-watt rig, not "media conglomerate." Radio is an open niche; TV/film tycoons are defended (Empire TV Tycoon 77%/822, Mad Television Tycoon 85%/239, Mad Games Tycoon 2 93%/7273, Game Dev Tycoon 95%/40138, Hollywood Animal 79% falling to 50% recent). Differentiation is highest at radio, lowest at film.

## Audience
Mad Games Tycoon / Game Dev Tycoon / Football-Manager-lite crowd: roster spreadsheet with personality, 20–40 min sittings, mobile browser. Secondary: radio-nostalgia audience (the TX/ANT ladder and FM band flavor already speak to them — keep it).

## Vault uniqueness
No cannibalization: Freight Dominion is spatial routing/capital allocation; Purr & Power is the staff-scarcity tycoon whose central decision (bid slider) is a documented solved constant. Empire-Callsigns becomes the allocation-scarcity game P&P failed to be — IF the design gate holds.

## Findings in current code
a) Game is ~12 minutes long: gear ladder done ~day 100, plateau day 140; day = 5,000ms ⇒ 11m40s wall clock. The overhaul targets the real flaw.
b) "Two-station network" card copy oversells a 32% revenue multiplier stat line.
c) CARD LIE: "put DJs on the slots that suit them" — makePerson() = {id,name,role,skill,salary}; NO affinity/genre/trait field exists. (Convergent with design-architect.)
d) No balance harness, no DESIGN.md, no CONTRACT.md; sceneTier calibration (40 runs × 600 days) was measured by an uncommitted instrument and the overhaul invalidates it.
e) Onboarding is a three-paragraph modal (showIntro, 2785) — won't survive empire surface area.

## Costs (grounded on ~470K benchmark for 5-agent review of 2,000-line game)
- 50%: design docs + modular split + blockers ≈ 180–260K (integrator serial; ~200 cross-refs into an import graph)
- 75%: build ≈ 550–750K (systems-engineer 160–220K is the risk concentration; balance harness ships HERE)
- 100%: harden & ship ≈ 420–550K
- All-in ≈ 1.15–1.55M + 3–5 serial integrator sessions. Biggest unbudgeted item: rebalancing (invalidates LISTENER_BASE, AD_VALUE, salary curve, TX/ANT costs, UNLOCK gates, SECOND_STATION_COST, sceneTier ladder).

## Risk register
1. Allocation grid becomes a spreadsheet (Mad TV Tycoon's top complaint) ⇒ assignment surface must grow SUB-LINEARLY with stations: delegation/station policy with real cost, roster caps, 3–4 stations not 6.
2. Core decision collapses to argmax ⇒ the design gate's three mechanics are mandatory.
3. Save migration policy for live v2 players (what does the migrated second station look like?) is a DESIGN decision — belongs in DESIGN.md before code.
4. TV/film runway = ONE paragraph in CONTRACT.md naming `channel/segment` abstraction, ZERO lines of TV code. Any TV content this pass is a scope breach.
5. Portfolio: Grimoire parked at 75% — two parked overhauls is the failure mode (being handled in parallel).
6. Day length: 5s/day tuned for one station; multi-station cadence touches every balance number + offline catch-up constants.

## Binding conditions (all accepted)
1. Design gate arithmetic holds across stations and across the run.
2. Assignment surface sub-linear; cap 3–4 real stations.
3. TV/film = one CONTRACT.md paragraph, zero code.
4. Balance harness ships at 75%, not 100%.
5. DJ affinity ships with multi-DJ (makes the existing card copy true).
6. Card copy corrected in the same commit.
7. Onboarding is not a modal; onboarding-tester gates release.
