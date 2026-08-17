// Callsigns — content: player-facing strings, gear ladders, dayparts, shows, roles,
// name pools, events, and every tuning constant. Data plus the two string
// formatters (t/t2) — no simulation, no DOM.
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing one top-level scope; load order: content, sim, fx, ui.
// Carved verbatim from the single-file v1 at the 50% checkpoint — refactor
// only: same 'callsigns.save' key, same v2 state shape, identical behavior.
// The v3 empire work builds on this against CONTRACT.md at 75%.
//
// 75% content pass (2026-08-07). What landed, and the rule each piece keeps:
//   - SEGMENTS, TX_LEASE / ANT_LEASE, SHOW_TECH, STATION_COSTS, CHEM_TAGS — the
//     data half of CONTRACT.md's cross-file API.
//   - CHEM_TAGS carries the DJ affinity the retired portfolio card claimed and
//     the game did not have (producer condition #5).
//   - SHOWS.music retuned so music is the revenue argmax at midday; the full
//     coefficient arithmetic is in the comment above SHOWS.
//   - Event pool expanded to 20, every one writing only to cash / rep / buzz,
//     because those three fields exist in the v2 and v3 state shapes both.
//
// Bays-and-rooms content pass (DESIGN_PROOF_ROOMS.md, revised by _V2.md and
// REPLACED WHOLESALE by DESIGN_PROOF_ROOMS_V3.md). What landed here:
//   - BAY_LEASE, the empire-wide building ladder, paid empty. Re-rungged in v2:
//     the old ladder's top three rungs cost more than the best room in the game
//     was worth, so the measured player bought one bay and stopped.
//   - ROOM_TYPES: THREE rooms — rack, prod, traffic — all serves:['radio'], all
//     sited on the BUILDING and not on a callsign, keyed on ROLE fit and never
//     on skill rank (everyone is skill 10 by hour 2 — §5 defect B).
//     FOUR ROWS HAVE BEEN CUT AND NONE OF THEM COMES BACK:
//       Newsroom — v3 §4. Its value was inserts x rep, and inserts are
//         proportional to the music dayparts the player schedules, for free and
//         reversibly, knowing the room exists. That is Purr & Power's
//         cost-basis self-reference wearing a schedule instead of money. The
//         News Director survives as a person and SHOWS.news.rep = 2.20 already
//         pays for airing news.
//       Record Library — there is no music-library room in 2026. The library is
//         a database inside the scheduling system and the librarian is a Music
//         Director wearing a second hat. Person kept, room cut.
//       Sales Floor — structurally negative at every seller count (−$3,871/day at
//         three sellers, −$670/day at six). The empire-wide reading stacks
//         sellers geometrically and applies the total to every station; a
//         per-station room splits the same people up, so each station ends with
//         fewer points against its own ceiling. Sales stays the global,
//         reputation-capped lever it already was.
//       Green Room — it only paid when somebody was double-booked, and the fix
//         for that is free. At DJ load 4 the room at max points recovered
//         djTerm +19%; putting a second DJ on the slot recovers +34%, and costs
//         one signing fee (salary x 8) and no bay. A room whose only support is "you
//         made an avoidable mistake", and which loses to the correction, is a
//         crutch sitting in a bay a real room could use (v2 §5).
//   - STR.en.room[id] carrying each room's ceiling line, stamped onto the table
//     the same way SEGMENTS is, so the two cannot drift.
//   - The §7 readouts: ceiling, wasted points, seat cost, bay-purchase preview
//     and causeOverbuilt.
//   - v3: SEGMENTS[id].localRange, the band a station's local-advertiser base is
//     ROLLED from at sign-on. The player never sets it and never sees it before
//     the buildout is paid — that is the repair for the defect that sank v1 and
//     v2, where every room ceiling was a schedule the player could set for free.
// MAX_BAYS (6 bays, empire-wide) and ROOM_SEATS are sim.js's, as is roomPower();
// nothing here duplicates them, for the reason in house rule 2 below. Three room
// types against six bays is deliberate: bays are the scarce thing, not types.
//
// TWO HOUSE RULES THIS FILE IS HELD TO, both learned off the vault's repeat
// failure mode (copy that lies):
//   1. Every number in a string is checked against the code that produces it.
//      Load weights, crew weights, the fault revenue multiplier, the automation
//      penalty and the segment risk multiplier are all quoted here and all
//      match sim.js. If a builder retunes one of those, the string above it is
//      part of the change.
//   2. CLASSIC SCRIPTS SHARE ONE TOP-LEVEL SCOPE. A `const` here that sim.js
//      also declares is a SyntaxError at parse time — the whole game, not just
//      the new mechanic. MAX_STATIONS, CHEM_MIN, CHEM_MAX and BASE_LEASE are
//      sim.js's; they are deliberately NOT declared in this file.
'use strict';

/* ============================================================
   CALLSIGNS — v1
   All player-facing text lives in STR so an i18next EN/ES pass
   later is a data swap, not a code hunt. t('key',{vars}) only.
   ============================================================ */

const LANG = 'en';
const STR = {
  en: {
    tagline: 'Build a radio station into a media empire.',
    onair: 'ON AIR',
    foot: 'v1.0 · autosaves as you play',
    newGame: 'New Game', continueGame: 'Continue', options: 'Settings', quit: 'Quit',

    cash: 'Cash', listeners: 'Listeners', rep: 'Reputation',
    day: 'Day {n}', dayShort: 'DAY {n}',

    tabStudio: 'Studio', tabGear: 'Gear', tabStaff: 'Staff', tabEmpire: 'Empire', tabLog: 'Log',

    schedule: 'Broadcast Schedule',
    /* The two bare numbers on every tile — "×1.00 · 6.9%" — are load and the
       chance of a fault today, and neither carried a unit or a referent. The
       fix is a caption ONCE on the card rather than a label repeated on four
       tiles: the tiles are a grid to be compared down a column, and labels
       inside them would double the text on the busiest control in the game to
       explain something the player needs told exactly once. */
    scheduleNote: 'Tap a slot to change the show. Each tile ends with its load and the chance of a fault there today.',
    dailyBrief: 'Daily Brief',
    noDj: 'No DJ',
    // States the fact and its size instead of the mood. djTerm() returns a flat
    // 0.32 for an empty slot against 0.58 + 0.052·crewSkill for a staffed one,
    // so automation is about a third of a decent host — and the lease is
    // identical either way, which is the part that kills runs.
    unstaffed: 'Automation — about a third of a hosted slot, at the same lease.',
    /* A sales agent has no daypart to be missing from; they work the ad log.
       Shortened from "Works the ad log, not a daypart — no slot to assign them
       to." That trailing clause turned a STATUS into an apology, it rendered
       once per seller down the roster, and it was rendered in the same red the
       roster uses for a host who is genuinely on nothing — so four people
       doing their job read as four problems. The full explanation is on the
       person's card, once, where roleDesc already says it properly. */
    unstaffedSales: 'Works the ad log, not a daypart.',
    /* What a hire is worth BEFORE you buy them. A playtest followed the
       coach's advice, paid $392 + $49/day, and was later told by the game's own
       slot editor that the best home in the empire for that engineer was worth
       $3/day. Advice the game's own arithmetic contradicts is worse than no
       advice. */
    hireWorth: 'Best open slot pays {worth}/day — {net}/day after their salary',
    hireBoardClears: 'clears in {n} days',
    hireBoardLast: 'last day for this board',

    // Onboarding. nextGoal() picks the first unmet item; the intro modal runs
    // once, on the first day of a brand new station.
    goalHire: 'Hire your first DJ (Staff tab)',
    goalAssign: 'Put your DJ on Morning Drive — tap a slot',
    goalBuy: 'You can afford the {name} in Gear',
    goalRep: 'Reach {n} reputation — News raises it fastest',
    goalFound: 'Found your second station in Empire',
    goalEng: 'Hire an engineer before you put a second voice on a slot',
    goalCover: 'A slot is running on automation — put someone on it',
    // The thesis, in three screens. intro3 is the sentence that is true about
    // this game and not about other tycoons: the schedule is not a puzzle you
    // solve once, it is the same hour happening in four places at the same time.
    // The structural onboarding rework (a modal is the wrong shape for empire
    // surface area) is deferred to the 100% gate — this is the copy, not the
    // system. ui.js renders exactly intro1 / intro2 / intro3; do not add an
    // intro4 without a matching change there, or nobody will ever see it.
    introTitle: '📻 You are on the air',
    introSub: '{call} · {freq} FM — the shape of the job, in three lines.',
    intro1: 'A broadcast day passes in seconds. Four dayparts go out, the books close, and the Daily Brief says exactly what the day cost and what it brought back.',
    intro2: 'Every slot needs a show and a voice. An empty one still airs — automation, about a third of what a host pulls — and the lease is due either way.',
    intro3: 'Morning drive is 6 AM on every station you own, at the same time. A second callsign does not buy you a second morning. It buys you a second morning you cannot cover.',
    introGo: 'Start the day',

    // Clock times so a first-time player learns what a daypart actually is.
    // The 1.15-weight slot is Afternoon Drive — real radio's second-best hour
    // block — not a vague "Evening". The DAYPARTS ids are unchanged.
    partMorning: 'Morning Drive · 6-10 AM', partMidday: 'Midday · 10 AM-3 PM',
    partEvening: 'Afternoon Drive · 3-7 PM', partNight: 'Overnight · 7 PM-6 AM',
    // Prose form. The clock times belong in the schedule grid, where they teach
    // the player what a daypart is; spliced into a sentence they produce "A clip
    // from your Midday · 10 AM-3 PM show is everywhere online."
    partShortMorning: 'Morning Drive', partShortMidday: 'Midday',
    partShortEvening: 'Afternoon Drive', partShortNight: 'Overnight',
    showMusic: 'Music', showTalk: 'Talk', showNews: 'News', showAds: 'Paid Programming',
    // Descriptions track the coefficient table directly above SHOWS. Music's ad
    // rate moved 0.90 -> 1.10 in the midday retune, so "modest ad rates" became
    // false and had to move with it.
    showMusicDesc: 'Widest reach, fair rates, and it owns the midday hours outright.',
    showTalkDesc: 'Narrower audience, the best ad rates in the game, built for the drive hours.',
    showNewsDesc: 'Smallest reach, heaviest on the engineer, and the only thing that moves reputation fast.',
    showAdsDesc: 'Cash today. Listeners and reputation both pay for it — and reputation is what gates your next transmitter.',

    pickShow: 'Show', pickShowSub: '{part} · what goes out on this slot?',
    pickDj: 'DJ', pickDjSub: 'A DJ\'s skill multiplies this slot\'s quality.',
    cancel: 'Cancel', close: 'Close',
    short: '{amt} short',

    transmitter: 'Transmitter', antenna: 'Antenna',
    reach: 'Reach', fidelity: 'Audio Fidelity',
    tierOf: 'Tier {a} of {b}', maxTier: 'MAX',
    upgrade: 'Upgrade',
    needRep: 'Needs {n} rep',
    boostReach: '+{n}% reach', boostFid: '+{n}% fidelity',
    // Gear is per station in v3, and every tier above the first raises that
    // station's daily lease forever. Said at the point of purchase, because
    // this is the buy that most often ends a run.
    gearLeaseNote: 'Raises this station\'s lease by {amt}/day, permanently.',
    gearStation: 'Fitted to {call}',

    staffTitle: 'Payroll', hireTitle: 'Available for Hire',
    roleDj: 'DJ', roleEng: 'Sound Engineer', roleSales: 'Sales Agent',
    // Role copy teaches the rule instead of labelling the row. The engineer
    // line is the one that matters: runs are lost by players who assume an
    // engineer on the payroll is an engineer on the slot.
    roleDjDesc: 'Leads or co-hosts one slot. Skill, chemistry and fatigue all multiply the same number.',
    roleEngDesc: 'One engineer covers one daypart across the whole empire. Hiring them is not assigning them.',
    // Sales is a global lever and always was — the per-station Sales Floor room
    // was cut for being structurally negative. roleStrength() decays each extra
    // seller by 0.40, and fillCap/priceCap are both read off reputation, so both
    // halves of this sentence are the code.
    roleSalesDesc: 'Fills more of the ad log and holds the rate, empire-wide. Each extra seller counts far less than the last, and reputation caps what any of them can move.',
    skill: 'Skill {n}', salary: '{amt}/day',
    hire: 'Hire', fire: 'Fire',
    hireTerms: 'One-time signing fee · then {amt}/day',
    trainCost: 'Train {amt}', maxSkill: 'Peak skill',
    tired: '−{n}% tired',
    fireConfirm: 'Let {name} go?', fireConfirmSub: 'They walk with their skill, and they will not be back.',
    hiredMsg: '{name} joined as {role}.',
    firedMsg: '{name} has left the station.',
    trainedMsg: '{name} trained up to skill {n}.',
    noStaff: 'Nobody on payroll. Hire a DJ to get real numbers.',
    noPayroll: 'No one on payroll yet',
    noPayrollNote: 'Everyone you can hire today is listed below.',
    noCandidates: 'No candidates today. New talent turns up as your reputation grows.',
    // The scarce resource, stated on the screen where it bites. refreshCandidates()
    // rolls two or three names a week and does NOT scale with stations.length —
    // the balance harness asserts exactly that.
    candidateNote: 'Two or three names a week, no matter how many signals you own.',
    payroll: 'Payroll: {amt}/day',

    // Everything engBonus()/salesFill()/salesPrice() do, made visible — a
    // $36/day sales agent used to look like paying for nothing at all.
    effectsTitle: 'Station Effects',
    fxAdFill: 'Ad slots sold', fxAdRate: 'Ad rate',
    fxBreak: 'Breakdown risk', fxFid: 'Fidelity bonus',

    /* ---- v3: crews, chemistry, engineers ----
       Variables each new key expects, so ui.js never has to guess:
         coHostElsewhere {call},{part}      chemGood/chemBad/chemFlat {a},{b}
         engSteal {name},{call},{part}      engFault {call},{part},{gear},{n}
         engCaught {name}                   loadValue {n} */
    coHosts: 'On mic', addCoHost: 'Add co-host', leadHost: 'Lead', dropHost: 'Off mic',
    // CREW_WEIGHTS in sim.js is [1, 0.55, 0.30] and LOAD_PER_COHOST is 0.45.
    // If either moves, this sentence moves in the same commit.
    /* The load arithmetic is loadFactor = 1 + 0.45*(n-1), so the FIRST host adds
       nothing and each one AFTER the lead adds 0.45. The old wording said "each
       one adds 0.45", which prices a solo host's slot at 1.45 instead of 1.00 —
       a blind playtest checked it against the number on screen and found it
       wrong. Copy that disagrees with the sim teaches the player to distrust the
       readouts, which are the only thing they have. */
    coHostNote: 'The lead counts full. Second chair counts 55%, third counts 30% — and every chair AFTER the lead adds 0.45 to this slot\'s load.',
    coHostCap: 'Three voices is the most one slot will hold.',
    coHostElsewhere: 'Already on {call} {part} — same hour, one place.',
    chemLbl: 'Chemistry',
    // chem() in sim.js scores PAIRS only, and returns exactly 1.00 for a solo
    // host. Deliberately no magnitude quoted here: CHEM_LIKE / CHEM_CLASH are
    // sim-owned balance numbers the harness may move, and a string that names
    // them would go stale the first time it does.
    chemNone: 'Solo. Nothing to read, and no penalty for it.',
    chemGood: '{a} and {b} work. You can hear it in the breaks.',
    chemBad: '{a} and {b} talk over each other for the whole hour.',
    chemFlat: '{a} and {b} — professional, no spark.',
    tagLbl: 'Style',
    styleNote: 'Style is about who else is in the room. A pair that works lifts the crew\'s skill; a pair that does not drags it. It multiplies skill — it never replaces it.',
    quirkLbl: 'Known for',

    engTitle: 'Engineer', engNone: 'No engineer on this slot.',
    engAssign: 'Assign engineer',
    engSteal: 'Putting {name} here pulls them off {call} {part}. One engineer, one daypart, whole empire.',
    engNoneHired: 'Nobody on payroll can hold a rack. Hire an engineer first.',
    loadLbl: 'Slot load',
    loadValue: 'Load {n}',
    // Every figure here is SHOW_TECH plus LOAD_PER_COHOST, and the last
    // sentence is FAULT_REP_PER_LOAD — reputation damage scales with load and
    // not with what the slot earns, which is the whole of mechanic 3.
    loadNote: 'Each extra voice adds 0.45. Talk adds 0.35, news 0.55, paid programming 0.10, music nothing. Load drives the fault odds — and a fault costs reputation in proportion to load, not to what the slot was earning.',
    engFault: 'Fault on {call} {part}. The {gear} dropped out — slot revenue cut to 55%, reputation down {n}.',
    engCaught: '{name} caught it at the rack before it left the building.',
    engQuiet: 'A music slot at load 1.00 is the safest hour you own. It is also the one that needs an engineer least.',

    /* ---- v3: leases ---- */
    leaseTitle: 'Leases', leaseDue: 'Leases {amt}/day',
    leaseLine: '{call} — {amt}/day',
    leaseNote: 'Transmitter site and its power, tower rent by the bay, and the studio-to-transmitter link. Due every morning whether the slot was covered or not.',
    leaseParts: 'Site {a} · Transmitter {b} · Antenna {c}',
    leaseSegment: '{seg} carries a {n}× premium on the whole lease line.',
    leaseWarn: 'Leases alone empty the bank in {n} days at this balance.',

    /* ---- v3: founding ---- */
    empireTitle: 'The Empire',
    foundConfirm: 'Found a second station?',
    foundConfirmSub: '{amt} out of the bank, today. The buildout is permanent.',
    /* Both strings name the BUILDOUT price, not just the unlock threshold.
       UNLOCK_CASH is 9000 and STATION_COSTS[0] is 12000, so "reach $9,000"
       followed by "you have the capital" told the player they could afford a
       station that still cost $3,000 more than they had. The gate and the bill
       are two different numbers and the copy has to say both. */
    lockedSub: 'Reach {cash} and {rep} reputation to unlock expansion. The first buildout costs {cost}.',
    unlockedTitle: 'Expansion unlocked',
    unlockedSub: 'You have the name and the runway. The first buildout costs {cost} out of the bank.',
    progressTo: 'Progress to expansion',
    foundStation: 'Found Second Station',
    // Replaces "runs itself day to day, contributing a share of its take back
    // to headquarters." That sentence described the deleted network =
    // revenue*0.32 block — the self-reference trap — and it was the specific
    // lie the portfolio review caught. Nothing in v3 runs itself.
    foundStationNote: 'A one-time buildout of {amt}. From the next morning it is a real signal with its own lease, its own four slots and no staff of its own — everyone you hire is already working somewhere.',
    // Founding flow (new keys, Empire tab).
    foundTitle: 'Sign On a New Signal',
    foundSub: 'Pick the slice of the market you are going after. It is fixed once the licence issues.',
    foundCost: 'Buildout {amt}',
    foundLease: 'Lease from day one: {amt}/day, before you fit any gear.',
    /* THE FOUNDING CARD'S LOCAL-TRADE LINE, and the reason it names no number:
       localBase is rolled inside SEGMENTS[seg].localRange the morning the
       licence issues, and it is NOT KNOWN while this card is on screen. A
       figure here would be a lie on the one card the player reads before
       spending five figures. The segment's character is knowable; the roll is
       not. Per-segment prose lives in STR.en.seg[id].local and is stamped onto
       the SEGMENTS rows, exactly like taste and rule. */
    segLocalLbl: 'Local trade',
    foundLocalNote: 'How much of a signal\'s billing local shops can carry is settled when the licence issues, somewhere inside this segment\'s band. You do not pick it, and no room, seller or transmitter raises it afterwards.',
    // After the buildout is paid: the roll, once, in the log.
    localRolled: '{call} signed on. Local advertisers there can carry {pct} of its billing, and that is the whole of what a production room could ever chase.',
    foundWarn: 'It arrives with a transmitter and no people. Morning drive on it happens at the same 6 AM as morning drive on this one.',
    foundSplit: 'Two of your own signals in one segment split one pool. Total audience barely moves; the lease and the payroll both double.',
    foundCapNote: 'Four signals is the licence cap. Past that the only thing left to buy is better people.',
    foundCapped: 'Four callsigns. That is the whole file.',
    /* Signal condition. The copy names the CAUSE on both sides and the
       destination, because a bare percentage that drifts down on its own reads
       as a bug rather than as a consequence. */
    condTitle: 'Signal condition',
    condSettling: 'settling toward {pct}%',
    condPerWeek: '%/week',
    condWear: 'Wear −{pct}%/day · {tx} on a {ant}. Bigger plant, faster wear.',
    gearWearWarn: 'Wears faster: this station settles at {to}% condition instead of {from}%.',
    /* THE WORST LINE IN THE GAME, and the one the whole subtraction pass was
       named after. It read:

         "Attention closes 2.3% of the gap to full each day · 0 slots with an
          engineer, 4 with hosts only. People spread thin bring less of
          themselves."

       Exact, correct, and unreadable unless you already know that "the gap" is
       (1 − condition) — a term that appears nowhere else in the game and has
       no unit a player could attach to it. It was phrased that way for a good
       reason (the raw daily gain shrinks as condition rises, so printing it
       beside wear made the card contradict its own settling figure), and a
       good reason for a number is not the same thing as a reader for it.

       Rewritten in the player's terms: WHO mends it, HOW MANY of them there
       are, and WHERE it stops — the settling figure is on the same card, two
       lines up, which is the referent the percentage never had. The two counts
       stay because they are things the player can go and change today. */
    condTend: 'Attention is what mends it, and attention is people: {eng} dayparts on this signal have an engineer, {dj} have hosts only. More of them here mends it faster — and it stops mending where the card says it settles.',
    condFloor: 'This signal is as degraded as it gets. Everything it airs goes out weak, and the lease has not moved.',

    /* ---- voice-tracking (docs/DESIGN_PROOF_VOICETRACK.md §6) ----
       Sited next to the condition copy on purpose: the expensive half of this
       decision is a settling point, and vtSettle deliberately borrows
       condSettling's "settles at N%" wording so the slot editor and the
       condition card are describing the same number in the same words.

       THE RULE THIS BLOCK IS WRITTEN UNDER. Not one string here names a
       recommended mode, a crossover, a weight below which to track, or a slot
       worth tracking. Every one of them says what tracking DOES — the
       person-hours, the attention, the localism, the empty booth — and stops.
       Printing the number the player is solving for is the Purr & Power
       failure this vault has a binding rule about, and a penalty described in
       the payoff direction ("so track your cheap slots") is the same defect
       wearing prose. If a future line here wants to be helpful, it is wrong.

       Variables, so ui.js never has to guess:
         vtNow {mode}            vtSettle {call},{from},{to}
         vtSettleSame {call},{pct}   vtSettleLag {n}
         vtFloor {pct}           vtHours {track},{live}
         vtHoursWho {name},{live},{track}
         vtAppeal {pct}          vtPull {dj},{mul}
         vtRisk {from},{to}      vtRiskSame {pct}
         vtDropped {name},{call},{part}
         vtSwitchedTracked / vtSwitchedLive {call},{part}                      */
    vtTitle: 'How this shift airs',
    vtSub: 'Live is a person in the air studio for the hour. Tracked is the same host cutting their breaks ahead of time for automation to play out between the records. Both go on the air. Only one of them has anybody in the building.',
    vtNow: 'On the air {mode} now.',
    vtLive: 'Live',
    vtTracked: 'Voice-tracked',
    vtLiveDesc: 'Somebody is in the studio for the shift.',
    vtTrackedDesc: 'Breaks cut ahead of time, played out by automation.',
    vtOnTag: 'on air',

    vtAttnLbl: 'Attention and condition',
    vtAttnZero: 'Attention 0.00 — nobody is in the building to tend the plant.',
    vtSettle: '{call} settles at {from}% live, {to}% tracked.',
    vtSettleSame: '{call} settles at {pct}% either way.',
    vtSettleLag: 'Condition does not move the day you switch. It drifts, and it takes about {n} days to cover half the distance.',
    vtFloor: 'This signal is already at the floor — it settles at {pct}% whichever way this slot airs. Tracking costs it no further attention.',

    vtHoursLbl: 'Person-hours',
    vtHours: '{track} of an assignment against {live}.',
    vtHoursWho: '{name} carries {live} assignments with this slot live, {track} with it tracked.',
    vtHoursNobody: 'Nobody is on this slot, so there is no assignment here to divide.',

    vtAppealLbl: 'Localism',
    vtAppeal: 'Localism −{pct}% appeal. No live phones, no weather out the window, no local reference.',
    vtPull: 'Crew term {dj} · tracked ×{mul}',

    vtEngLbl: 'Engineer and faults',
    vtEngNone: 'No engineer sits on a tracked slot. There is no shift for one to work.',
    vtRisk: 'Fault chance {from}% with the booth as it is, {to}% with it empty.',
    vtRiskSame: 'Fault chance {pct}%. The booth is empty either way.',
    vtEngGrey: 'This slot is tracked, so the booth is closed. Put it back live to seat anybody here.',
    vtDropped: '{name} came off {call} {part}. A tracked slot takes no engineer.',
    vtSwitchedTracked: '{call} {part} is voice-tracked.',
    vtSwitchedLive: '{call} {part} is live again.',
    vtBackLive: 'Put this slot back live',
    vtTag: 'Tracked',
    vtSlotSub: 'automation plays the breaks',
    vtLegend: 'Voice-tracked',
    vtCovLabel: '{call} {part} — voice-tracked, nobody in the building',
    segPopLbl: 'Audience pool', segCompLbl: 'Incumbents', segLeaseLbl: 'Lease premium',
    segTasteLbl: 'What it listens to',
    segPopSub: 'People in play in this segment, by daypart.',
    segCompSub: 'Rival pull already sitting in the pool. Your share is what is left after them — and after your own other stations.',
    segRuleLbl: 'House rule',
    secondStationTitle: 'Second Station',
    secondStationSub: '{call} — signed on Day {day}.',
    networkContribution: 'Network contribution (yesterday)',
    networkTotal: 'Total earned by network',
    foundedMsg: '{call} signed on. Its lease starts in the morning.',
    empireTitle2: '🏙️ Media Empire',
    empireSub: '{a} and {b} are both on the air. You run a network.',
    // The old line called expansion "the last locked door in the game", which
    // was true of v2 and is the reverse of true now — the second signal is
    // where the scheduling problem starts, not where it ends.
    empireNote: 'Nothing here runs itself. Every signal you add is four more slots against the same two or three names a week.',
    empireDays: 'Days on air', empireNet: 'Net earned',
    // totalCosts has been tracked and sanitized since the economy retune and
    // shown nowhere, while the Empire tab labelled the NET figure "earned".
    empireCosts: 'Costs paid',
    empirePeak: 'Peak listeners', empireRep: 'Reputation',
    keepPlaying: 'Keep Playing',
    // Station switcher and the empire-wide coverage strip.
    stationsLbl: 'Signals', switchStation: 'Switch signal',
    uncovered: 'Uncovered today', uncoveredNone: 'Every slot has a voice on it.',
    uncoveredSlot: '{call} {part} — automation',

    /* ---- bays and rooms (DESIGN_PROOF_ROOMS_V3.md §2, §9) ----
       This game has twice shipped a mechanic nobody could see — rival capacity
       rendered a static constant for a whole version, and signal condition
       needed a gauge retrofitted. These keys are the nine readouts the proof
       names, written before the screen exists so they cannot be dropped as
       clutter later.

       Variables each key expects, so ui.js never has to guess:
         bayLine {n},{amt}             bayBuy {n},{amt}
         bayBuyValue {ret}             bayBuyThin {n},{amt},{ret}
         bayLocked {rep},{cash}        bayEmpty {amt}
         roomHead {room},{call}        roomPts {pts},{cap}
         roomWaste {pts},{cap},{waste} roomHeadroom {n}
         roomSeats {n},{max}           roomMargin {amt}
         seatLine {name},{n},{total}   seatCost {attn},{call},{fat}
         seatDiluted {n}               seatEngWarn {call}
         briefBayLease {amt}           briefRooms {amt},{cost}
         briefBaysIdle {n},{amt}       goalBay {amt}
         briefRemnant {amt}            briefLocal {pct}
         briefRack — none              roomProdCap {max}
         roomProdNoHead {call}         localRolled {call},{pct}
         roomCapRack / roomCapProd / roomCapTraffic / roomCapZero /
           roomTrafficCounter / roomTrafficStale / roomProdCapNone /
           foundLocalNote / segLocalLbl — no vars
         room.<id>.ceiling — its own variable list is on the table below.
       Amounts arrive already formatted by ui.js's money helper, as everywhere
       else in this file; {pts}/{cap}/{waste} are one-decimal point figures and
       every {pct} is a whole-number percentage WITHOUT its sign. */
    bayTitle: 'Building Programme',
    /* THE ONE SENTENCE FOR THE WHOLE TAB. It replaces four that each opened a
       different card — baySub, bayThesis, roomCeilingRule and roomFitNote —
       and between them said the same thing from four angles in ~110 words.
       All four are still authored below and all four are one tap down; what
       changed is that the tab no longer opens with a lecture.

       Written to answer the two questions in the owner's note in order: what
       is this (rented rooms behind the studios, shared by every callsign), and
       how does it work (they bill daily and earn from what the world gives
       them, not from who you put in them). */
    bayOneLine: 'Six rented rooms behind the studios, shared by every callsign you own. Each bills every morning and earns from what the world gives it to work on.',
    baySub: 'Six bays for the whole group, not six per signal. What sits in them works for every callsign in the building.',
    // The thesis of the whole feature, in one line, on the screen where it is
    // about to be got wrong. Everything else here is detail underneath it.
    // v3 moved it again, and this time off the schedule entirely: a room is now
    // ceilinged by the plant on the tower, the local trade the market rolled at
    // sign-on, and the airtime you failed to sell. None of the three is a thing
    // the player can set for free between one morning and the next.
    bayThesis: 'A room is worth what it is pointed at, not who is in it — the plant on your towers, the local trade in the market, the airtime you did not sell. Seating someone moves them; it does not multiply them.',
    bayMatrixNote: 'Three rooms, six bays, one building. Nothing in here belongs to a single callsign.',
    // For nextGoal(), if ui.js wants a rung between "found a station" and the
    // end of the ladder. Names the cost, because the lease is the price.
    goalBay: 'A bay is affordable — {amt}/day, and it bills empty (Building)',
    bayNone: 'No bays. Everything you own is on the air and nothing is standing behind it.',
    bayLine: 'Bay {n} — {amt}/day',
    bayEmpty: 'Empty bay — {amt}/day',
    // The whole trap in one sentence, said where the money leaves.
    bayEmptyNote: 'Due every morning whether the bay holds a room, and whether the room holds a person.',
    bayBuy: 'Buy bay {n} — {amt}/day, from tomorrow on',
    bayBuyValue: 'Best room you could put in it returns about {ret}/day at today\'s ceilings.',
    // Fires when lease > return. The gear ladder was an invisible trap until the
    // wear preview landed; this is that preview, for bays.
    bayBuyThin: '{amt}/day of lease against {ret}/day of room. Bay {n} loses money until a ceiling rises.',
    bayLocked: 'Bays open at {rep} reputation with {cash} in the bank.',
    bayCapped: 'Six bays is the whole programme. What is left to change is what the signals under them are airing.',
    bayLeaseLbl: 'Bay leases',

    roomLbl: 'Room', roomAssign: 'Put a room in this bay', roomOn: 'On {call}',
    roomMove: 'Point it at another signal', roomClear: 'Strip the bay',
    roomDup: 'The building already has one, and one is all it needs — it covers every callsign.',
    /* Production is the exception and the real cluster's shape: rooms run one
       short of signals, so a group can never produce local spots for everything
       it owns. {max} is stationCount() - 1. */
    roomProdCap: 'Production tops out at {max} rooms — one short of the callsigns you own. Somebody is always waiting on copy.',
    roomProdCapNone: 'One signal, no production room. There is nothing to share it with yet.',
    roomHead: '{room} — {call}',
    roomPts: '{pts} / {cap} pts',
    // THE readout. Points above the ceiling are worth zero dollars — not fewer
    // dollars — and this line is the only thing standing between the player and
    // "hire more, stuff every room". ui.js strikes the overshoot through.
    roomWaste: '{pts} / {cap} pts — {waste} wasted',
    roomWasteNote: 'Points past the ceiling earn nothing. Not less — nothing. The salaries are still due.',
    roomHeadroom: '{n} points of headroom before this room stops paying.',
    roomAtCeiling: 'At the ceiling. The next person in here is payroll and nothing else.',
    /* A Production Room on a station with no headroom is the one case where the
       player has bought something entirely real that does nothing at all here.
       Say it plainly, once, and say where it would work instead. */
    roomProdNoHead: 'Every spot this room cuts for {call} is a real spot that moves no number. That market has no local trade left to win — point the bay at another signal or strip it.',
    /* The Traffic Desk is the game's first counter-cyclical asset: it is paid
       out of the inventory your sellers could NOT move, so it is worth most on
       your worst week and least on your best. This line is the warning that it
       is designed to work its way out of a job. */
    roomTrafficCounter: 'This desk lives on what sales missed. Every point of sellout you gain takes work off it — the first thing you will own that you should one day close.',
    // Fires when the desk's realised return falls under the bay lease. Not a
    // reprimand and not a congratulation: the room got smaller because the
    // sellers got better, which is the shape of the whole asset.
    roomTrafficStale: 'The desk returned less than the bay under it. Nothing has gone wrong — there is simply less going unsold. Strip the bay and put the person back on the air.',
    roomMargin: 'Next point ≈ +{amt}/day',
    roomMarginNone: 'Next point ≈ nothing. Raise the ceiling or move the people.',
    roomEmpty: 'Nobody seated. The bay bills anyway.',
    /* The tail of the card, after the wasted-points figure and subordinate to
       it: "7.0 / 3.0 pts — 4.0 wasted · ceiling set by the plant on the tower".
       One form per room, each naming the piece of the WORLD that set the number
       — never a schedule, because no room is paid on the schedule any more. */
    roomCapRack:    'ceiling set by the plant on your towers',
    roomCapProd:    'ceiling set by the local trade this market has',
    roomCapTraffic: 'ceiling set by the airtime you failed to sell',
    roomCapZero:    'nothing here for this room to work on — ceiling zero',
    // The rule under the readout. Deliberately carries no constant: every per-
    // point rate is sim.js's and the balance pass is licensed to move all of
    // them, so this line says the SHAPE and lets the numbers come from the
    // ceiling figure itself.
    roomCeilingRule: 'A ceiling is set by the world — your plant, your market, your unsold log. Hiring fills a ceiling. It never raises one.',
    roomCeilingLbl: 'Ceiling', roomSeatsLbl: 'Seats', roomSeats: '{n} of {max} seats',
    roomFitLbl: 'Seat value by role',
    // Defect B, stated as copy: everyone is skill 10 eventually, so the decision
    // is role and ceiling, never "who is best".
    roomFitNote: 'Role decides what a seat is worth here, not skill. Everybody trains to ten in the end; nobody changes what they are.',

    seatAdd: 'Seat someone', seatDrop: 'Stand them down',
    seatLine: '{name} · {n} of {total} assignments',
    seatCost: '−{attn} attn on {call} · fatigue {fat}',
    seatSurplus: 'On no slot anywhere. This seat costs the air nothing.',
    /* Two forms: "1 slots" read as a bug in a line whose whole job is to be
       trusted. The UI picks by count — the file has no pluraliser and one
       string is not worth building one. */
    seatDiluted: 'Already on {n} slots. What they bring in here, they stop bringing out there.',
    seatDiluted1: 'Already on one slot. What they bring in here, they stop bringing out there.',
    seatNote: 'A room seat is an assignment exactly like a slot. Spread over three, a person brings a third of themselves to each.',
    // The specific trap in §3: diluting the engineer to build the room that
    // protects the plant can leave condition lower than it started.
    seatEngWarn: 'This is the engineer tending {call}. Seat them and attention there falls — condition can end up worse than before the bay was built.',
    // greenWarn lived here and went with the Green Room (v2 §5). It said
    // "seating {name} here adds to {name}'s own load" — true of every seat in
    // the building, which is what seatDiluted and seatNote already say.

    briefBayLease: 'Bay leases {amt}/day',
    briefRooms: 'Rooms returned {amt} against {cost} of bay lease.',
    briefBaysIdle: '{n} bays stood empty. {amt} out, nothing back.',
    // One line per room effect that actually moved money yesterday, so a room
    // earning nothing is visibly different from a room earning (v3 §9).
    briefRemnant: 'Traffic cleared {amt} of airtime that would have expired unsold.',
    briefLocal: 'Local direct carried {pct} of the billing. The rest went out through a rep firm and an agency, and both took their cut.',
    briefRack: 'The rack room held wear down on every signal in the group.',

    logTitle: 'Station Log', noLog: 'Nothing logged yet.',

    paused: 'Paused', resume: 'Resume', save: 'Save', mainMenu: 'Main Menu',
    saved: 'Game saved.', loadFail: 'No save found.',
    optTitle: 'Settings', optSpeed: 'Game speed', optSpeedDesc: 'How fast a broadcast day passes.',
    optAutosave: 'Autosave', optAutosaveDesc: 'Save automatically every 30 seconds.',
    optEvents: 'Event popups', optEventsDesc: 'Pause the game for big story moments.',
    optMotion: 'Reduced motion', optMotionDesc: 'Calm down animated scene effects.',
    optSound: 'Sound effects', optSoundDesc: 'Clicks, on-air chimes, and dead-air stings.',
    optWipe: 'Delete save', optWipeDesc: 'Erase this station permanently.',
    wipe: 'Delete', wipeConfirm: 'Delete your save?', wipeConfirmSub: 'This cannot be undone.',

    newStationTitle: 'Sign On', newStationSub: 'Every station needs a callsign. Four letters, starts with K or W.',
    start: 'Start Broadcasting', randomize: 'Random',

    breakdownMsg: 'The {gear} cut out mid-show. Listeners drifted.',
    breakdownFixed: 'Your engineer caught the fault before anyone noticed.',

    // Fires while the situation is still reversible (cash under five days of
    // burn), not once the balance is already negative.
    cashWarning: 'Cash covers only a few more days at this burn rate. Cut costs or grow revenue.',

    briefQuality: 'Show Quality', briefBuzz: 'Buzz',
    repTrend: '{now} / 100 → trending to {target}',
    firstDay: 'Your first broadcast day is underway.',
    royaltiesLbl: 'Music licensing',
    royaltiesNote: 'Performing rights, charged on the share of the day that is music. The one bill talk and news do not pay.',
    // The Daily Brief prints revenue / costs / net side by side, and net folds
    // in the second station's contribution — so the "in" figure has to include
    // it, and this line is what says where the difference came from.
    networkLbl: 'Network {call}', onAirLbl: 'On-air',

    /* ---- The failure screen. It is specific about what happened, it names the
       bill that did it, and it does not console. "Silent authority" is the real
       filing a broadcaster makes when it stops transmitting and wants to keep
       the licence; here it does not get to keep it.
       NOTE: sim.js's endRun() prefixes '📉 ' to bankruptTitle. No emoji here,
       or the modal reads with two of them. */
    bankruptTitle: 'Silent Authority',
    bankruptSub: '{call} filed silent. The tower stays up; the rent on it does not stop.',
    bankruptNote: 'Leases came due every morning whether the slots were covered or not, payroll came due beside them, and the signal could not sell enough to carry both. Cash went through the floor and the licence goes back. This save is closed.',
    // Optional post-mortem. ui.js picks the id matching the run's final state;
    // every one of these is a cause the simulation can actually produce. Do not
    // add an entry here that no state can trigger.
    causeOverExpanded: 'You were paying lease on {n} signals and covering the slots on one of them.',
    // Sited after causeOverExpanded and before causeAdsOnly in the branch order
    // (DESIGN_PROOF_ROOMS.md §4). {n} is bays owned, {k} is rooms with anyone
    // actually sitting in them.
    causeOverbuilt: 'You were paying for {n} bays and staffing {k}. An empty room bills every morning and bills back nothing.',
    /* Needs one branch in ui.js's cause picker or it never fires: {k} rooms
       that had people in them and a ceiling of zero — roomCeiling === 0 with
       roomPower > 0. In v3 there are exactly three ways to be in that state and
       the line names all three, because a player who reaches this screen is
       owed the specific one. Site it directly after causeOverbuilt; an empty
       room is the cruder mistake and should win the tie. */
    causeRoomsCold: '{k} rooms staffed against a ceiling of zero — no plant worth protecting, no local trade to win, or a log with nothing left unsold. Every point in them earned nothing. The leases and the salaries did not.',
    causeTalentThin: '{n} people against {slots} slots. Most of the empire aired automation at a third quality while you paid full lease for the privilege.',
    causeGearHeavy: 'The transmitter ladder ran three tiers ahead of the billing. Reach you cannot sell is just a bigger lease.',
    causeAdsOnly: 'The log was full and the reputation was gone. Paid programming pays today and closes every gear tier you had left.',
    causeSignalRot: 'The transmitters were never touched. Signal condition fell to {pct}% and everything you put on air went out degraded — the lease and the payroll did not degrade with it.',
    causeNoEngineer: 'No engineer on the heavy slots. Faults kept taking a rep bite proportional to load, and rep is what the ad rate multiplies by.',
    causeQuiet: 'Nothing dramatic. A small signal in a crowded segment, out-pulled every single day by people who were there first.',

    scenes: {
      garage: 'Garage Setup', storefront: 'Storefront Studio', tower: 'Broadcast Tower',
      citywide: 'Citywide Signal', network: 'Regional Network', empire: 'Media Empire'
    },

    // Segment copy. Names / blurbs / taste / rules live here so a localization
    // pass edits one file; SEGMENTS rows are stamped from this table at load
    // (see the loop under SEGMENTS), so the two can never drift apart.
    // `taste` describes the row's `fit` multipliers and nothing else — if a fit
    // number moves, its taste line moves with it.
    seg: {
      /* `local` describes the row's localRange band and NOTHING ELSE. It is
         read on the founding card, before the roll exists, so no line here may
         name a figure — it says what kind of advertiser is out there and how
         they buy. If a localRange moves, its line moves in the same commit
         (house rule 1); quadrangle's especially, because its band tops out at
         exactly the no-production baseline and the line has to say so rather
         than hedge. */
      citywide: {
        name: 'Downtown Hit Radio',
        blurb: 'The biggest pool in the market with four incumbents already standing in it. Glass storefront studio, tower space rented by the foot.',
        taste: 'Wants music. Tolerates talk. Punishes a brokered hour.',
        local: 'A real local trade — car dealers, furniture rows, a hospital group — and a good share of it already booked through an agency downtown.',
        rule: 'No house rule. Just everybody else.'
      },
      /* RETUNED (DESIGN_PROOF_ROOMS_V2.md §4, change #7). `fit` moved from
         music 1.05 / talk 1.05 / news 1.00 / ads 1.10 to music 0.90 / talk 1.15
         / news 1.20 / ads 1.05, so this segment now leans talk instead of
         sitting flat. The name and the blurb moved WITH it, because "County Line
         Country" as the row where music is the weakest format is exactly the
         class of lie house rule 1 exists to catch. `pop`, `comp` and `leaseMul`
         are untouched, and so is the cheap-lease character the blurb sells. */
      countyline: {
        name: 'County Line Talk and Trade',
        blurb: 'A swap-shop hour, the noon market report, obituaries read on air and every school closing in two counties. The tower sits on leased pasture forty minutes out, which is why the rent is cheap.',
        taste: 'News pulls hardest, talk just behind it, and it is the only crowd in the market that sits through the ads. Music is the one format this segment does nothing for.',
        local: 'The strongest local trade on the dial, and nearly all of it closable in person. The feed store, the implement dealer and the funeral home buy direct or not at all.',
        rule: 'No house rule. Remote broadcasts are half the job.'
      },
      ledger: {
        name: 'News, Weather and Business',
        blurb: 'Morning-loaded, dead by nine at night, and the incumbents swing hard week to week. Nobody forgives a missed top-of-hour.',
        taste: 'News and talk pull hardest here. Music is close to wasted.',
        local: 'Thin local trade. Most of this billing is placed out of town by an agency that has never heard your morning show, and it arrives already discounted.',
        // Checked against sim.js: segRiskMul() is applied to EVERY slot on the
        // segment, unconditionally — it is not gated on whether an engineer is
        // assigned. The first draft of this line said "15% higher without one",
        // which the code does not do. `wantsEng` is an advisory flag ui may
        // surface; it changes no number.
        rule: 'Every slot here carries 15% higher fault odds, engineer or not. News is 0.55 of load before a single voice goes on.'
      },
      nightshift: {
        name: 'Night Shift Rhythm',
        blurb: 'Hospital corridors, warehouse floors, the long drive home at one in the morning. Small pool, and almost nobody fighting you for it.',
        taste: 'Music, heavily. News least of all — they have already heard it.',
        local: 'Middling local trade, bought by the people who are also awake: the all-night diner, the tow yard, the twenty-four-hour pharmacy. There are not many of them.',
        rule: 'No house rule. This audience is awake when yours is not.'
      },
      quadrangle: {
        name: 'Campus and Specialty',
        blurb: 'A reserved-band licence, a student board op learning live on the air, and the best Thursday night in the market. Daytime is nearly empty.',
        taste: 'The strongest music pull in the game and the weakest tolerance for ads.',
        local: 'Barely any local trade at all. A reserved-band licence takes underwriting, not spots, and there is nothing here a produced commercial can win. A production room on this signal will earn nothing, ever.',
        rule: 'No house rule. The cheapest lease you will ever sign.'
      }
    },

    /* Room copy. Same idiom as `seg` above: names and blurbs live here and are
       stamped onto the ROOM_TYPES rows at load, so localization edits one file
       and the two can never drift.

       `ceiling` is the line the whole feature stands on. Every room's output has
       a ceiling, and a point above it is worth EXACTLY zero dollars — so each
       ceiling line names the state that sets it, in the player's own terms, and
       says what happens at the wrong end of it. Variables, by room:
         rack    {tx},{ant}     the heaviest transmitter and antenna standing in
                                the whole GROUP, not on one callsign — the room
                                is one tech core covering every signal
         prod    {call},{pct}   the station's rolled local-advertiser base as a
                                whole-number percentage, no sign
         traffic {pct}          the share of the GROUP's log that went UNSOLD
                                yesterday, whole-number percentage, no sign.
                                NO {call}, DELIBERATELY: salesFill() takes no
                                station argument and fillCap() reads the global
                                S.rep, so sellout — and therefore remnant — is
                                empire-wide. A per-callsign figure on this card
                                would be a number the simulation does not have.
                                It is also the truer object: one continuity
                                manager builds ONE daily log for the cluster.

       THE TWO ARE ASYMMETRIC ON PURPOSE. Production is measured per station
       because a local-advertiser base genuinely is per signal; Traffic is
       measured on the group because the log and the sellout level genuinely are.
       If the Building screen ever reads oddly for it, the fix is to show the two
       in separate groups, not to invent a per-station remnant number.

       THE CEILING IS NO LONGER THE SCHEDULE, AND THAT IS THE WHOLE V3 REPAIR.
       v1 and v2 paid rooms in proportion to dayparts, which the player sets for
       free, instantly and reversibly, knowing the room exists — the same
       self-reference class as Purr & Power pricing off its own cost basis. Every
       ceiling here is now something the player cannot set on the morning they
       want it:
         rack     the plant on the towers, bought for reach and fidelity, and
                  every tier of it RAISES wear before this room cuts any
         prod     st.localBase, rolled at sign-on inside the segment's band and
                  revealed only after the buildout is paid
         traffic  the inventory the sellers failed to move, which no player
                  raises on purpose — remnant nets about a third of rate against
                  a sold unit's full dollar
       No line here may imply that hiring raises a ceiling, or that anything on
       the schedule does.

       THE ORDER CHANGES WITH WHO WALKS IN THE DOOR, which is why no line ranks
       the rooms and no line prints a crossover. Same day, same cash, same
       building: a spare DJ makes Production the better seat and a spare seller
       makes it Traffic, because the fits invert (dj 0.85/0.35, sales 0.30/0.80).
       And on a campus signal Production is worth nothing at any point total, for
       ever, which its `zero` line says outright rather than hedging. */
    room: {
      rack: {
        name: 'Rack Room',
        blurb: 'The tech core: a rack per callsign in one room, and a chief engineer who gets to the site before the site calls. Holds down the wear your plant causes, on every signal in the group.',
        ceiling: 'The one ceiling nothing on the air can move — it is the plant. Heaviest rig in the group is a {tx} on a {ant}, and wear is all this room touches.',
        zero: 'A Part 15 rig with a whip on it wears at the floor rate already. There is nothing here for an engineer to save. Buy plant first, protect it second.'
      },
      prod: {
        name: 'Production Room',
        blurb: 'Where spec spots get cut — a finished commercial made for a shop that has not bought anything yet. Radio sells better played than pitched, and what it wins is billing that comes to you direct instead of through a rep firm.',
        ceiling: 'Ceiling is the local trade {call} was signed into: local advertisers there can carry {pct} of its billing, and this room only walks it up to that. The market set that number the day the licence issued.',
        zero: 'No local trade here worth cutting a spot for. A seller with a phone already reaches everything this market has, so every point in this room is worth zero dollars and always will be.'
      },
      traffic: {
        name: 'Traffic Desk',
        blurb: 'Continuity: orders in from sales, spots placed into avails, the daily log out by morning. An unsold minute cannot be stored — it expires. This desk clears what is left as remnant, at about a third of rate.',
        ceiling: 'Ceiling is what the group did not sell: {pct} of the log went out unsold across every callsign, and remnant is the only thing that can still be paid for it. Sell more and this desk has less to work with.',
        zero: 'The group is sold out. Nothing is expiring unsold on any callsign, so there is nothing left for this desk to clear — and the bay bills all the same.'
      }
    }
  }
};

/* Any placeholder an event's copy uses that rollEvent() did not supply resolves
   to a neutral phrase rather than printing a raw brace at the player. The event
   pool grew more variables than the sim's var bag passes, and a literal
   "{rival}" on screen is exactly the class of bug that ships because nobody
   rolled that one event in testing.

   Applied in t2 ONLY. Every STR key in this file kept the exact variable
   signature ui.js and sim.js already call it with, so t() needs no such net —
   and t() must not have one, because sim.js's tOr() distinguishes "key missing"
   by comparing the result to the key itself. */
const EVENT_FALLBACKS = {
  part: 'an afternoon', name: 'your overnight host', co: 'the second chair',
  rival: 'a station across town', rivalCall: 'the station across town',
  call: 'your signal', seg: 'the market', gear: 'the rig', eng: 'your engineer'
};

function t(key, vars) {
  const path = key.split('.');
  let s = STR[LANG];
  for (const p of path) s = s && s[p];
  if (s === undefined) return key;
  if (vars) for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
  return s;
}
// Event copy is inline (not in STR) so it stays adjacent to its effect;
// still routed through a formatter so a localization pass has one seam.
function t2(str, vars){
  for (const k in vars) str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
  return str.replace(/\{(\w+)\}/g, function(m, k){
    return EVENT_FALLBACKS[k] !== undefined ? EVENT_FALLBACKS[k] : m;
  });
}

/* ---------------- static data ---------------- */

// Transmitter tiers follow the real FCC FM service ladder (Part 15 hobby rig
// up through Class C). Names/specs are descriptive class labels, not brands.
const TX = [
  { name: 'Part 15 Rig',      spec: '50 W',                 reach: 1.00, cost: 0,      rep: 0  },
  { name: 'Class A',          spec: '6 kW @ 100 m · 28 km',  reach: 1.85, cost: 1400,   rep: 8  },
  { name: 'Class B1',         spec: '25 kW @ 100 m · 39 km', reach: 3.30, cost: 7200,   rep: 24 },
  { name: 'Class B',          spec: '50 kW @ 150 m · 52 km', reach: 5.70, cost: 29000,  rep: 45 },
  { name: 'Class C',          spec: '100 kW @ 600 m · 92 km',reach: 9.20, cost: 105000, rep: 66 }
];

const ANT = [
  { name: 'Whip Antenna',     spec: 'omni',               fid: 1.00, cost: 0,     rep: 0  },
  { name: 'Dipole Array',     spec: '2-bay',              fid: 1.22, cost: 1100,  rep: 6  },
  { name: 'Ring Array',       spec: '4-bay',              fid: 1.46, cost: 5800,  rep: 21 },
  { name: 'Panel Array',      spec: '8-bay',              fid: 1.72, cost: 23500, rep: 42 },
  // Descriptive class label like the four below it. This slot has now been
  // through two brand names (a real HD Radio mark, then "Meridian CP-12" — and
  // Meridian Audio is a real hi-fi company); CLAUDE.md line 11 wants invented,
  // non-competing names, and the safest invented name is no brand at all.
  // "CP" is circular polarization, industry vocabulary rather than a trademark.
  { name: 'Circular Array',   spec: '12-bay CP',          fid: 2.00, cost: 88000, rep: 63 }
];

/* ---- The lease line: the failure state (DESIGN.md) ----
   lease(s) = (BASE_LEASE + TX_LEASE[s.tx] + ANT_LEASE[s.ant]) × leaseMul(segment)
   paid per station per day, performing or not. BASE_LEASE (60) is declared in
   sim.js — one owner per constant, and that one is load-bearing on the
   simulation side.

   TX_LEASE is fixed by the accepted design proof and quoted in it: $60/day at
   TX0 against $60.9/day of automated gross (so idling loses), and a TX3 -> TX4
   step of +$560/day that only pays above $918/day of revenue (so the top
   transmitter is not a strictly dominant buy). Do not retune this array
   without re-running that arithmetic.

   ANT_LEASE is tuned here, and deliberately kept well under TX_LEASE. The
   transmitter line is a site with a power bill; the antenna line is tower rent
   per bay plus the studio link, which is a smaller footprint and no meter. If
   the antenna ladder cost what the transmitter ladder costs, it would swamp
   every number DESIGN.md quotes. Top of both ladders on a 1.00× segment is
   60 + 900 + 400 = $1,360/day. */
const TX_LEASE  = [0, 40, 120, 340, 900];
const ANT_LEASE = [0, 18,  55, 150, 400];

/* ---- BAY_LEASE: the building programme's ladder (DESIGN_PROOF_ROOMS_V2.md §9,
   item 5) ----
   $/day for the Nth bay, empire-wide, PAID EMPTY. Index 0 is bay 1. The build
   cost is a small one-off because the LEASE is the price.

   RE-RUNGGED IN V2, AND THE OLD LADDER IS WHY. It ran [40, 120, 340, 900, 2400,
   6000], which put rungs 4, 5 and 6 at 1.4x, 3.7x and 9.2x the value of the best
   room in the game. A measured cohort of build policies therefore bought one bay
   and stopped, and the strongest fixed strategy in the whole run was the one
   that built NOTHING. A rung nobody can climb is not a hard choice, it is a wall
   with a price tag on it.

   The new rungs 3 and 4 ($180 and $320) sit inside the $250-$650 band that real
   rooms are actually worth, so they are close calls that go either way on the
   state of the station — which is the whole feature. All six at once is
   $1,950/day: 10.4% of a mid-game empire's $18,720/day gross, and a third of an
   hour-3 empire's. Still rising, still payable on an empty room, still able to
   end a run.

   The binding condition the balance harness owns (§6): bay N's lease must EXCEED
   the best available marginal room's value at the median hour-3 state, so that
   the top of the ladder is a judgement and not a purchase. If a retune ever
   makes bay N cheap enough to buy on reflex, bayBuyThin in STR stops being able
   to fire and the ladder has gone quiet.

   MAX_BAYS and ROOM_SEATS are sim.js's constants and are deliberately NOT
   declared here — classic scripts share one top-level scope, and a duplicate
   `const` is a parse error for the whole game (see the house rules at the top of
   this file). The cap is this array's length; sim.js's MAX_BAYS must equal 6. */
/* Voice-tracking. Real talent pre-record their breaks into automation; the
   shift airs as if live and one jock covers multiple dayparts across multiple
   stations, from anywhere. FCC-permitted unattended operation. See
   docs/RESEARCH_RADIO_OPERATIONS.md §5.

   TRACK_LOAD 0.35 — a three-hour shift is tracked in about an hour including
   prep and log approval. The conservative end of the real 0.2-0.4 band, so
   tracking is never free.
   TRACK_APPEAL 0.88 — localism. No live phones, no real-time weather or
   traffic, no local reference. This is a PENALTY, and that direction is what
   keeps the mechanic honest: tracking a high-value slot costs MORE, so the
   incentive runs toward better shows rather than worse ones. */
const TRACK_LOAD   = 0.35;
const TRACK_APPEAL = 0.88;

const BAY_LEASE = [40, 90, 180, 320, 520, 800];

const DAYPARTS = [
  { id: 'morning', icon: '🌅', weight: 1.35 },
  { id: 'midday',  icon: '☀️', weight: 0.85 },
  { id: 'evening', icon: '🌆', weight: 1.15 },
  { id: 'night',   icon: '🌙', weight: 0.55 }
];
/** Two names per daypart, and the difference matters: partLabel() carries the
    clock times for the schedule grid and the slot editor's own title, while
    partShort() is the one that goes into sentences. Every {part} substitution
    picks one of these deliberately — see rollEvent() and pickShowSub. */
function partLabel(id){ return t('part' + id.charAt(0).toUpperCase() + id.slice(1)); }
function partShort(id){ return t('partShort' + id.charAt(0).toUpperCase() + id.slice(1)); }

/* ============================================================
   SHOWS — and the midday retune (DESIGN.md change #5)
   ============================================================
   `parts` is a per-daypart multiplier on slot quality, so the best show is a
   different answer in each of the four slots — without it the grid is one
   decision copied four times. News is the reputation engine its tooltip
   promises (at a real revenue cost); ads are the cash lever.

   THE PROBLEM DESIGN.md NAMED: music was the default in three of four slots and
   the revenue argmax in none of them. Slot revenue is proportional to
       weight(p) · appeal · parts(p) · adRate
   and weight(p) is common to every show inside a daypart, so the argmax WITHIN
   a daypart is settled by  appeal · parts · adRate  alone. Before:

     daypart   music   talk    news    ads     argmax
     morning   0.855   1.238   1.014   1.058   talk
     midday    1.035   0.980   0.780   1.588   ads
     evening   0.900   1.187   0.858   1.210   ads
     night     1.080   0.877   0.546   2.041   ads

   THE RETUNE — two numbers, both on SHOWS.music:
     adRate       0.90 -> 1.10   still under talk's 1.20, so talk keeps its
                                 "best rates in the game" identity and the copy
                                 above it stays true
     parts.midday 1.15 -> 1.60   the workday block: the one place a music format
                                 genuinely out-bills a brokered hour
   After:

     daypart   music   talk    news    ads     argmax
     morning   1.045   1.238   1.014   1.058   talk
     midday    1.760   0.980   0.780   1.588   MUSIC  (+10.8% over ads)
     evening   1.100   1.187   0.858   1.210   ads    (all three within 10%)
     night     1.320   0.877   0.546   2.041   ads

   THE MARGIN SURVIVES MUSIC'S OWN BILL. Music is the only show that pays
   performing rights: simulateDay charges revenue × 0.045 × musicShare, where
   musicShare is music slots over TOTAL slots empire-wide. On one station that
   is four slots, so flipping ONE slot to music moves musicShare by 0.25 and
   costs 1.125% of the whole day's revenue — call it 4.5% of a typical slot.
   Midday music net of that is 1.760 × 0.955 = 1.681 against ads at 1.588:
   +5.9%. Still a win, on merit, after the only tax music pays.

   That is the WORST case on purpose. At two stations the same flip moves
   musicShare by 0.125, at four by 0.0625, so the royalty offset shrinks as the
   empire grows and midday music's margin over ads only widens. Quote the
   one-station figure; it is the one that has to hold.

   IT DOES NOT MAKE MUSIC THE WHOLE GAME. Multiply back by daypart weight and
   morning talk is 1.35 × 1.238 = 1.671 against midday music at
   0.85 × 1.760 = 1.496. The best single hour in the day is still a talk hour.

   AND ADS ARE STILL THE CASH LEVER THEY WERE BUILT TO BE — they win two
   dayparts outright on gross, which is their entire job. What they do not win
   is the run: a slot flipped from ads to music at crew skill 6 moves repTarget
   by roughly +27.7 points (+20.2 from quality, +7.5 from show.rep pressure),
   and reputation multiplies audience by (1 + rep/62), multiplies ad price by
   (1 + rep/140), and gates every transmitter and antenna tier above the first.

   balance-scientist: this retune invalidates the pre-lease balance numbers by
   design — DESIGN.md says so in as many words. Re-verify the table above
   against tick(), never against bare simulateDay(). */
const SHOWS = {
  music: { icon: '🎵', appeal: 1.00, adRate: 1.10, rep:  0.35,
           parts: { morning: 0.95, midday: 1.60, evening: 1.00, night: 1.20 } },
  talk:  { icon: '🎙️', appeal: 0.86, adRate: 1.20, rep:  0.55,
           parts: { morning: 1.20, midday: 0.95, evening: 1.15, night: 0.85 } },
  news:  { icon: '📰', appeal: 0.78, adRate: 1.00, rep:  2.20,
           parts: { morning: 1.30, midday: 1.00, evening: 1.10, night: 0.70 } },
  ads:   { icon: '💰', appeal: 0.42, adRate: 3.60, rep: -1.30,
           parts: { morning: 0.70, midday: 1.05, evening: 0.80, night: 1.35 } }
};

/** How much rack attention each format demands, feeding loadFactor() in sim.js:
      loadFactor(i) = 1 + 0.45·(djCount − 1) + SHOW_TECH[show]
    Music is a log and a playout box. News is remotes, phoners, a network join
    and a hard top-of-hour, which is why news is the format that eats engineers.
    Fixed by the accepted design proof — retuning these moves the L* crossover
    the whole engineer decision is built on. */
const SHOW_TECH = { music: 0.00, ads: 0.10, talk: 0.35, news: 0.55 };

const ROLES = {
  dj:    { icon: '🎧', baseSalary: 32 },
  eng:   { icon: '🔧', baseSalary: 40 },
  sales: { icon: '📈', baseSalary: 36 }
};

/* ============================================================
   SEGMENTS — the market slice a station is licensed into
   ============================================================
   Read by sim.js through segTable()/segmentOf(), feeding marketShare():
       audience(s,p) = POP(p) · pull(s,p) / (K_COMP + Σ pull over every station
                                             in the segment, YOURS INCLUDED)
   `comp` is the rival pull C: `base` plus a day-indexed wobble of amplitude
   `dayAmp`. It is derived from the day number and from share pressure, and from
   nothing else. It must NEVER be computed from the player's revenue, payroll or
   costs — that is the Purr & Power self-reference trap the greenlight document
   exists to prevent.

   ROW SHAPE, and every field is present on every row so a missing key can never
   read as undefined:
     icon, medium   — medium is a LABEL, not a branch (see the TV note below)
     pop            — POP(p), the finite audience per daypart
     comp           — { base, dayAmp } rival pull
     leaseMul       — multiplies the whole lease line for this segment
     localRange     — [floor, ceiling] of the LOCAL-ADVERTISER BASE, as a share
                      of billing. sim.js's newStation() rolls st.localBase
                      uniformly inside this band ONCE, at sign-on, and nothing
                      the player owns, hires or schedules moves it afterwards.
                      This is the ceiling the Production Room is measured
                      against, and it is here rather than on the station row
                      because a per-station ROLL is not choosable while a
                      per-segment TABLE would have been: pick the segment, pick
                      the number. The bands are the design proof's (v3 §10.3)
                      and they overlap on purpose, so no segment is a guaranteed
                      production play and none but one is a guaranteed refusal.
                      `quadrangle` tops out at exactly the share a seller closes
                      by phone with no produced spot, so a Production Room on a
                      campus signal is worth ZERO at every point total, for
                      ever — a structural zero, not a small number. Its
                      STR.en.seg.quadrangle.local line says so in as many words,
                      and if this band ever moves that line moves with it.
     fit            — per-show multiplier on pull. A segment is an audience with
                      a taste, and it is the second live decision the design
                      proof asks for: which segment you found into changes which
                      show wins which daypart. Mirrored in STR.en.seg[id].taste,
                      which must move whenever one of these numbers does.
     staffRules     — { wantsEng, riskMul }. ADVISORY, never a hard block. A
                      segment you cannot operate without a role you might not
                      have is the "unwinnable and invisible to code review"
                      defect class CLAUDE.md rule 2 exists for, so the answer to
                      "no engineer" is worse odds, not a wall.

   `citywide` IS THE DEFAULT SEGMENT and the key name is load-bearing:
   sim.js sets DEFAULT_SEGMENT = 'citywide' and segmentOf() falls back to
   tbl[DEFAULT_SEGMENT] for any unknown id. Rename this key and every
   hand-edited or partly-migrated save silently resolves to sim.js's internal
   scaffold instead of this table — same numbers, different name on screen, and
   no error anywhere.

   SCALE: DESIGN.md's founding-crossover arithmetic uses M_A = 6000 / C_A = 2000
   for the flagship and M_B = 2000 / C_B = 400 for a niche. `citywide` morning
   and `nightshift` night are those two pairs exactly; move them and the
   crossover (talent T ≈ 290) moves with them.

   TV/FILM RUNWAY — architecture only, and this paragraph is the whole of it.
   A TV or film channel would be another row here: its own pop/comp/leaseMul/
   fit/staffRules and medium:'tv', flowing through the same share equation, the
   same lease line and the same global staff pool. Nothing in sim/ui/fx may
   branch on `medium`. Zero TV rows ship in this overhaul, and adding one is a
   scope breach (producer condition #3). */
const SEGMENTS = {
  citywide: {
    icon: '🌃', medium: 'radio',
    pop:  { morning: 6000, midday: 4200, evening: 5200, night: 1800 },
    comp: { base: 2000, dayAmp: 0.20 },
    // 1.00, not a downtown premium: citywide is the DEFAULT segment and the
    // design proof's minute-5 arithmetic ($60 lease vs $60.9 automated gross,
    // quoted above) is anchored to the BASE_LEASE line unmultiplied. A
    // premium here silently falsifies that promise for every new game.
    // Segment lease character belongs to the non-default rows.
    leaseMul: 1.00,
    localRange: [0.62, 0.80],
    fit:  { music: 1.05, talk: 0.95, news: 0.95, ads: 0.90 },
    staffRules: {}
  },
  countyline: {
    icon: '🌾', medium: 'radio',
    pop:  { morning: 3800, midday: 3400, evening: 3600, night: 2200 },
    comp: { base: 1100, dayAmp: 0.22 },
    leaseMul: 0.85,
    /* v2 §4, change #7 — A BALANCE CHANGE TO A SHIPPED GAME, not a copy edit.
       Was { music: 1.05, talk: 1.05, news: 1.00, ads: 1.10 }: the flattest row
       in the table, and with it the four starting segments leaned music 3:1.
       That capped the value of CHOOSING between the Newsroom and the Record
       Library at min(k, N−k)/N = 25% of total room value, k being how many of
       your segments lean talk. Tipping this one row to talk makes k = 2 and
       doubles that ceiling to 50%. `pop` and `comp` above are deliberately
       untouched; only `fit` moved, and STR.en.seg.countyline moved with it.
       v3 FOOTNOTE: the two rooms that argument was made for are both cut, so the
       reason above is history — but the row STAYS as it is. A talk-and-trade
       segment that leans talk is simply true, the segment mix is no longer 3:1
       music, and reverting a shipped balance number to restore a dead
       justification would move audience for no reason at all. */
    // The widest and highest band in the table: a swap-shop market is where a
    // produced spot is worth the most, and it is the segment a Production Room
    // is genuinely built for.
    localRange: [0.80, 0.95],
    fit:  { music: 0.90, talk: 1.15, news: 1.20, ads: 1.05 },
    staffRules: {}
  },
  ledger: {
    icon: '📰', medium: 'radio',
    pop:  { morning: 4400, midday: 2400, evening: 2600, night: 900 },
    comp: { base: 1500, dayAmp: 0.30 },
    leaseMul: 1.10,
    localRange: [0.55, 0.70],
    fit:  { music: 0.75, talk: 1.20, news: 1.30, ads: 0.95 },
    staffRules: { wantsEng: true, riskMul: 1.15 }
  },
  nightshift: {
    icon: '🌙', medium: 'radio',
    pop:  { morning: 1200, midday: 1500, evening: 2600, night: 2000 },
    comp: { base: 400, dayAmp: 0.18 },
    leaseMul: 0.70,
    localRange: [0.60, 0.76],
    fit:  { music: 1.18, talk: 1.00, news: 0.80, ads: 0.85 },
    staffRules: {}
  },
  quadrangle: {
    icon: '🎓', medium: 'radio',
    pop:  { morning: 700, midday: 1400, evening: 1600, night: 2400 },
    comp: { base: 260, dayAmp: 0.12 },
    leaseMul: 0.55,
    // Tops out at the no-production baseline. Production headroom here is 0 at
    // every roll — structural, not a tuning accident. See the row-shape note.
    localRange: [0.45, 0.55],
    fit:  { music: 1.22, talk: 1.02, news: 0.88, ads: 0.70 },
    staffRules: {}
  }
};
// CONTRACT.md's row sketch carries `name`; this file's i18n idiom (partLabel,
// showMusicDesc) says text lives in STR. Both, with one source of truth: stamp
// the row from STR at load, so sim.js and ui.js can read seg.name directly and
// a localization pass still only edits STR.en.seg.
for (const segId in SEGMENTS) {
  SEGMENTS[segId].id    = segId;
  SEGMENTS[segId].name  = t('seg.' + segId + '.name');
  SEGMENTS[segId].blurb = t('seg.' + segId + '.blurb');
  SEGMENTS[segId].taste = t('seg.' + segId + '.taste');
  SEGMENTS[segId].rule  = t('seg.' + segId + '.rule');
  SEGMENTS[segId].local = t('seg.' + segId + '.local');
}
const SEGMENT_IDS = Object.keys(SEGMENTS);
function segName(id){ return (SEGMENTS[id] && SEGMENTS[id].name) || id; }
function segBlurb(id){ return (SEGMENTS[id] && SEGMENTS[id].blurb) || ''; }
function segTaste(id){ return (SEGMENTS[id] && SEGMENTS[id].taste) || ''; }
function segRuleText(id){ return (SEGMENTS[id] && SEGMENTS[id].rule) || ''; }
/** The founding card's local-trade line. Names the SEGMENT's character only —
    st.localBase does not exist yet when this is read. */
function segLocalText(id){ return (SEGMENTS[id] && SEGMENTS[id].local) || ''; }
/** The band sim.js rolls st.localBase inside. Returned as {min,max} as well as
    read straight off the row as a [lo,hi] array, because two files own the two
    ends of this and one of them should not have to guess the shape. Falls back
    to the default segment's band rather than to zero: a missing band that rolls
    0 would silently make every Production Room worthless with no error. */
function segLocalRange(id){
  const row = SEGMENTS[id] || SEGMENTS.citywide;
  const r = (row && Array.isArray(row.localRange)) ? row.localRange : [0.62, 0.80];
  return { min: r[0], max: r[1] };
}

/* ============================================================
   ROOM_TYPES — what a bay can hold (DESIGN_PROOF_ROOMS_V3.md §2)
   ============================================================
   A bay is a purchasable slot in the group's building programme, and ALL THREE
   ROOMS ARE SITED ON THE BUILDING, not on a callsign — which is how a real
   cluster is laid out: one tech core with a rack per station, one traffic and
   continuity desk building every log, and production rooms shared out one short
   of the number of signals. Read by sim.js through roomPower():

       roomPower(r) = Σ over p in r.staff of  fit[r.type][p.role] · p.skill / load[p.id]

   `load` is the map staffSlotLoad() already builds once a day for stationAttn(),
   and a room seat counts in it exactly like a daypart slot. That is the entire
   integration: no new scarcity invented, the existing one deepened. A person on
   two slots plus one room has load 3 and brings a third of themselves to each,
   so a room is NET-NEGATIVE on the air unless it is staffed out of genuine
   surplus. That sign is correct and it is the mechanic.

   ROW SHAPE, every field present on every row:
     name, blurb  — stamped from STR.en.room[id] at load, same as SEGMENTS
     icon         — a category marker, never a reaction
     serves       — which media this room can be built for. sim.js joins it
                    against segmentOf(st.segment).medium and NOTHING branches on
                    the literal string 'radio'. This is the first consumer the
                    `medium` tag has ever had; it is what makes a future venue or
                    stage three content rows instead of a second assignment
                    system. ALL THREE ROWS ARE serves:['radio'] AND NOTHING ELSE
                    — adding a non-radio row now is the scope breach CONTRACT.md
                    already forbids for SEGMENTS.
     fit          — per-ROLE multiplier on a seated person's skill. Keyed on role
                    and never on rank: trainCostFor() makes a full 1->10 ladder
                    $39,636 against six figures of late-game cash, so everyone is
                    skill 10 by hour 2 and THERE IS NO BEST PERSON. Any room
                    mechanic whose decision is "put your best staffer in the best
                    room" is dead on arrival (§5, defect B). Role fit, ceilings
                    and the load divisor are the whole decision.

   THE CEILINGS, which are what the player is actually solving for. A point above
   the ceiling is worth EXACTLY ZERO DOLLARS, and not one of the three ceilings
   is a thing the player can set on the morning they would like it set:
     Rack Room     plant       cuts the GEAR term of stationWear() for every
                               station at once; at tx=ant=0 that term is 1 for
                               any value of the cut, so a Part 15 group gets
                               exactly zero. Plant is bought for reach and
                               fidelity and it RAISES wear — nobody buys a
                               transmitter to make this room pay
     Production    market      min(pts, headroom) where headroom is
                               st.localBase − the share one seller closes by
                               phone. localBase is ROLLED at sign-on inside
                               SEGMENTS[seg].localRange and revealed only after
                               the buildout is paid
     Traffic Desk  your misses (1 − fill) × the remnant clearance × ~35% of
                               rate, and EMPIRE-WIDE — salesFill() takes no
                               station argument and fillCap() reads the global
                               S.rep, so one log, one sellout level, one desk.
                               Its copy names the group and never a callsign
                               (see the note above STR.en.room). It pays out of
                               inventory the player failed to sell, and
                               sandbagging fill to feed it gives up a full
                               dollar to gain about a third of one
   The three are anti-correlated in different directions, which is why no fixed
   order exists: Production and Traffic invert on WHICH SPARE PERSON the hiring
   stream handed you (dj 0.85 vs 0.35, sales 0.30 vs 0.80), and on a campus
   signal Production is a structural zero at every point total while Traffic is
   at its most valuable exactly when the group is worst at selling.

   THE TRAFFIC DESK IS COUNTER-CYCLICAL, AND IT IS THE FIRST ASSET IN THIS GAME
   THE PLAYER SHOULD EVENTUALLY CLOSE. Everything else compounds; this one decays
   as reputation lifts fillCap() and the sellers get good, until the bay lease
   outruns it. The copy says so on the room itself (roomTrafficCounter) rather
   than waiting for the player to discover it from a shrinking number.

   THREE ROOMS. Four rows have now been cut and the reasons are at the head of
   this file: Sales Floor (structurally negative at every seller count), Green
   Room (paid only in a state the player fixes for free), Newsroom (paid in
   proportion to a schedule the player sets for free, knowing the room exists —
   the self-reference class this whole version exists to remove), Record Library
   (no such room exists in a 2026 station; it is a database). A fifth row is a
   scope decision, not a content one, and none of those four is it.

   NOTHING HERE READS CASH, REVENUE, PAYROLL OR ANY COST, and nothing may. The
   day a ceiling learns what the player earns, the game is solved — the Purr &
   Power self-reference trap CLAUDE.md rule 1 exists to prevent. */
const ROOM_TYPES = {
  /* THE FITS ARE WHAT MAKE THE DECISION FLIP, and they are the reason this table
     is worth having at all. Production and Traffic are near-mirrors on the two
     roles the hiring stream actually hands out: a spare DJ is worth 0.85 in
     Production against 0.35 in Traffic, a spare seller 0.80 in Traffic against
     0.30 in Production. Same building, same day, same cash — the better bay is
     settled by which body walked in, and it reverses when the next one does.
     Move either row and the whole decision goes constant; that is a balance
     change with a design gate on it, not a tuning nudge. */
  // The only room an engineer is first pick for, and it is one room for the
  // whole group — one chief engineer covering every signal, which is how
  // clusters have run for twenty years. Fit unchanged from the room it replaces.
  rack:    { icon: '🔧', serves: ['radio'], fit: { dj: 0.20, eng: 1.00, sales: 0.10 } },
  // Voices first: a spec spot is written, read and cut, and a host does all
  // three. The engineer is genuinely useful at the desk; the seller who cut the
  // deal is the least useful person in the room while it is being made.
  prod:    { icon: '🎛️', serves: ['radio'], fit: { dj: 0.85, eng: 0.55, sales: 0.30 } },
  // Sellers first: traffic is orders, avails and the log, which is the work a
  // seller already half does. A host in here is doing paperwork.
  traffic: { icon: '🗂️', serves: ['radio'], fit: { dj: 0.35, eng: 0.30, sales: 0.80 } }
  /* NO `green`, `sales`, `news` OR `library` ROW, AND DO NOT PUT ONE BACK. Each
     was cut for a different structural reason and all four reasons are written
     at the head of this file; the two newest are the important ones, because a
     Newsroom or a Record Library reads like an obvious omission from a radio
     game and neither is. sanitize() in sim.js drops an unknown type off an old
     save, so a v7 save carrying maint/news/library migrates by losing them. */
};
for (const roomId in ROOM_TYPES) {
  ROOM_TYPES[roomId].id    = roomId;
  ROOM_TYPES[roomId].name  = t('room.' + roomId + '.name');
  ROOM_TYPES[roomId].blurb = t('room.' + roomId + '.blurb');
}
const ROOM_TYPE_IDS = Object.keys(ROOM_TYPES);
function roomName(id){ return (ROOM_TYPES[id] && ROOM_TYPES[id].name) || id; }
function roomBlurb(id){ return (ROOM_TYPES[id] && ROOM_TYPES[id].blurb) || ''; }
/** The ceiling line, with whatever state the caller has to hand. Vars per room
    are listed above STR.en.room; a missing one is caught by ui.js, not here. */
function roomCeilingText(id, vars){ return ROOM_TYPES[id] ? t('room.' + id + '.ceiling', vars) : ''; }
function roomZeroText(id){ return ROOM_TYPES[id] ? t('room.' + id + '.zero') : ''; }
/** The data join, content-side, so no simulation or interface code ever tests
    the literal string 'radio'. Pass segmentOf(st.segment).medium. */
function roomsForMedium(medium){
  const m = medium || 'radio';
  return ROOM_TYPE_IDS.filter(id => ROOM_TYPES[id].serves.indexOf(m) >= 0);
}

/* One line per bay bought, same rule as STATION_MILESTONES: describe the world
   and the mechanic, never the player. Keyed by the resulting bay count; six is
   the length of BAY_LEASE and MAX_BAYS in sim.js both. */
const BAY_MILESTONES = {
  1: 'One bay. It bills tomorrow morning whether you put anything in it or not.',
  2: 'Two bays. Three kinds of room exist and every one of them works for the whole group.',
  3: 'Three bays. Three rooms to fill, against the same two or three names a week.',
  4: 'Four bays. Each one bills whether there is anything in this market for the room to work on.',
  5: 'Five bays. The building has a corridor, and people have started leaving mugs in it.',
  6: 'Six bays, which is the whole programme. Everything left to change is on the air, not in the building.'
};
function bayMilestoneFor(n){ return BAY_MILESTONES[n] || null; }

/* ============================================================
   CHEM_TAGS — the on-air chemistry behind chem() (producer condition #5)
   ============================================================
   This is the system the retired portfolio card claimed the game already had.
   makePerson() in sim.js gives everyone one tag from this table
   (`tags: [pick(chemTags())]`), and chem(slot) scores every PAIR in the crew:
   a `likes` hit lifts the crew term, a `clashes` hit drags it, and a solo host
   returns exactly 1.00. Chemistry then multiplies crewSkill inside

       djTerm(i) = 0.58 + 0.052 · crewSkill(i) · chem(i) · fatigue

   so it SCALES skill and never replaces it. Two 3s with perfect chemistry still
   lose to a 9 working alone. That is deliberate: if chemistry could beat skill,
   the scarce resource — qualified person-hours — would stop being scarce.

   THE TABLE IS STRICTLY SYMMETRIC, and that is a correctness requirement, not a
   nicety. sim.js's chem() reads `likes`/`clashes` off the FIRST member of each
   pair in crew order only. If A liked B but B did not like A, then promoting a
   co-host to lead would silently change the slot's chemistry, and nothing would
   error. Every edge below appears on both ends. A tag never lists itself, so
   two hosts with the same style score neutral — an echo, not a fight.

   THE GRAPH, in words, so the design is readable without tracing arrays:
     - Motormouth + Deadpan is the classic morning two-hander: one talks, one
       anchors. It is the pairing real radio actually runs.
     - Hot-Clock is the connective tissue. It likes four of the other seven and
       clashes with none — the board-disciplined pro who makes anyone sound
       tighter, and who nobody notices until the week they leave.
     - Crate Digger + Pitchman is the worst working relationship in the table.
       One is protecting the music; the other is selling through it. They are
       arguing about the same three minutes of every hour.
     - Confessional + Firebrand: a three-in-the-morning voice and a man
       shouting. Nothing survives in that room.
     - Deadpan + Roadshow: the news anchor and the guy broadcasting from a
       parking lot. Neither is wrong, and they cannot share an hour.
     - Firebrand + Motormouth: two people who both need the last word.

   Tolerant by construction: an unknown or missing tag reads neutral rather than
   throwing, because this table and makePerson() live in different files owned by
   different builders. */
const CHEM_TAGS = {
  motormouth: {
    name: 'Drive-Time Motormouth', icon: '🎤',
    blurb: 'Talks over the ramp and is out clean by the vocal, every time. Needs a crowd on the other end to be worth anything.',
    likes: ['deadpan', 'hotclock'], clashes: ['firebrand', 'confessional']
  },
  confessional: {
    name: 'Overnight Confessional', icon: '🌙',
    blurb: 'Takes the three-in-the-morning calls and does not rush them. Put this on morning drive and you have wasted it.',
    likes: ['deadpan', 'cratedigger'], clashes: ['firebrand', 'motormouth']
  },
  deadpan: {
    name: 'News-Desk Deadpan', icon: '📰',
    blurb: 'Reads a fatality and a school closure in the same voice. That is not coldness, that is the job.',
    likes: ['motormouth', 'confessional', 'hotclock'], clashes: ['cratedigger', 'roadshow']
  },
  cratedigger: {
    name: 'Crate Digger', icon: '💿',
    blurb: 'Owns the deep cut and the story behind it, and will fight the log to play it.',
    likes: ['confessional', 'hotclock', 'roadshow'], clashes: ['pitchman', 'deadpan']
  },
  hotclock: {
    name: 'Hot-Clock Metronome', icon: '⏱️',
    blurb: 'Hits the post, hits the network join, never runs long. Dull, and you will miss them the week they leave.',
    likes: ['motormouth', 'deadpan', 'cratedigger', 'pitchman'], clashes: []
  },
  pitchman: {
    name: 'Live-Read Pitchman', icon: '💵',
    blurb: 'Makes a carpet-warehouse spot sound like a favour to you. Sponsors ask for them by name.',
    likes: ['hotclock', 'roadshow'], clashes: ['cratedigger']
  },
  firebrand: {
    name: 'Call-In Firebrand', icon: '🔥',
    blurb: 'The phone lines light up all hour. So does the other line, the one the manager answers.',
    likes: ['roadshow'], clashes: ['motormouth', 'confessional']
  },
  roadshow: {
    name: 'Remote Truck Regular', icon: '📡',
    blurb: 'Happiest broadcasting from a parking lot in the rain. Half the personality lives outdoors.',
    likes: ['cratedigger', 'pitchman', 'firebrand'], clashes: ['deadpan']
  }
};
const CHEM_TAG_IDS = Object.keys(CHEM_TAGS);

/* A quirk per hire, so a payroll row is a person rather than a salary.
   FLAVOR ONLY. Nothing in sim.js reads these, and they are written as habits
   rather than as effects on purpose — the moment one of them reads like a bonus
   it is a lie the simulation will not back.

   makePerson() hands every hire an on-air style tag regardless of role (an
   engineer's is inert, by its own comment), and "Live-Read Pitchman" on a
   transmitter engineer reads as a bug. So engineers and sales agents get their
   quirk from here instead, chosen deterministically from the person's id: it is
   stable across renders, stable across a save/load, and costs no state. */
const ENG_QUIRKS = [
  { name: 'Tower Climber',     icon: '🗼', blurb: 'Free-climbs to the beacon and comes back down annoyed about the bolts.' },
  { name: 'Bench Solderer',    icon: '🔌', blurb: 'Works standing up. Labels every cable in the rack, including the ones you added.' },
  { name: 'Proof Filer',       icon: '📐', blurb: 'Runs the annual proof on a Sunday and files it a month early.' },
  { name: 'Two-A.M. Callout',  icon: '🔦', blurb: 'Sleeps with the pager on the pillow and has strong opinions about your generator.' },
  { name: 'Parts Scrounger',   icon: '🧰', blurb: 'Keeps a spare exciter in the trunk. Will not say where it came from.' },
  { name: 'Link Whisperer',    icon: '📡', blurb: 'Hears the studio link drifting a full day before the meter will admit it.' }
];
const SALES_QUIRKS = [
  { name: 'Direct-Bill Grinder',  icon: '📇', blurb: 'Skips the agencies. Walks into the shop and asks for the owner by name.' },
  { name: 'Co-Op Specialist',     icon: '🧾', blurb: 'Knows which manufacturers reimburse the spend, and does the paperwork unasked.' },
  { name: 'Rate-Card Hardliner',  icon: '💳', blurb: 'Will lose the buy before discounting the morning hour.' },
  { name: 'Remote Broker',        icon: '🎪', blurb: 'Sells the parking-lot broadcast, the banner and the sno-cone machine as one line item.' },
  { name: 'Trade Dealer',         icon: '🔁', blurb: 'Half the studio furniture arrived as trade for spots.' },
  { name: 'Long-Lunch Closer',    icon: '🍽️', blurb: 'Every deal happens somewhere other than the desk. The expense line reflects it.' }
];
/** Stable index from a person id. Not cryptography — it only has to be the same
    number every time it is asked, including after a reload. */
function quirkIndex(id, n){
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
  return n ? h % n : 0;
}
function quirkFor(p){
  if (!p) return null;
  if (p.role === 'eng')   return ENG_QUIRKS[quirkIndex(p.id, ENG_QUIRKS.length)];
  if (p.role === 'sales') return SALES_QUIRKS[quirkIndex(p.id, SALES_QUIRKS.length)];
  return null;
}
/** One call for ui.js: the display record for whatever this person is known
    for. DJs show their on-air style (which is real and feeds chem); everyone
    else shows a quirk (which is flavor). Returns null rather than throwing on a
    person with no tags array. */
function tagInfo(p){
  if (!p) return null;
  if (p.role === 'dj') {
    const id = (Array.isArray(p.tags) && typeof p.tags[0] === 'string') ? p.tags[0] : null;
    return (id && CHEM_TAGS[id]) || null;
  }
  return quirkFor(p);
}

const FIRST = ['Ray','Dot','Cleo','Miles','Junie','Hollis','Sable','Ike','Marnie','Cass','Ozzie','Wren',
  'Deke','Lula','Frankie','Nova','Bud','Reva','Sonny','Tess','Arlo','Vega','Moe','Birdie','Rex','Opal'];
const LAST = ['Vance','Okoye','Ramirez','Kwan','Delacroix','Boone','Ferraro','Njoku','Sharpe','Ellis',
  'Bright','Castellano','Mbeki','Duvall','Tran','Sorrentino','Fairbanks','Achebe','Lyle','Moreau'];

/* Rival stations. Invented callsigns and invented station names — no real
   broadcaster, no real format brand, no real network. They exist so that losing
   a share point has a face on it instead of being a number going down.
   Three deliberate details worth keeping:
     - WFTH and WCMP sit at 89.7 and 89.1, inside the reserved 88.1-91.9
       non-commercial band, because that is where a listener-funded station and
       a campus station legally live. Every commercial rival is at 92.1 or
       above, matching the constraint on the player's own frequency.
     - KBUY is the joke, and it only lands because the other nine are straight.
       Leave it at exactly one entry.
     - KOLD's line is the only one that implicates the player. It is doing more
       work than the rest of the list put together. */
const RIVALS = [
  { call: 'KVLT', freq: '103.5', name: 'The Vault',
    line: 'Classic rock, the same forty records since the Nixon administration, and an owner who will die before he sells.' },
  { call: 'WQBN', freq: '99.3',  name: 'Bulletin 99',
    line: 'Seven reporters and a traffic plane. They break it; you re-read it forty minutes later.' },
  { call: 'KZAP', freq: '96.7',  name: 'La Zapote',
    line: 'Regional Mexican, and the only station in the market with a waiting list for spots.' },
  { call: 'WFTH', freq: '89.7',  name: 'Faith and Family',
    line: 'Reserved band, listener-funded, two pledge drives a year, and both of them work.' },
  { call: 'KDRT', freq: '105.1', name: 'Dirt Road 105',
    line: 'Country. Their morning guy has done a live remote from every feed store in three counties.' },
  { call: 'WHUM', freq: '107.3', name: 'Hum FM',
    line: 'Rhythmic hits out of a glass storefront downtown. Their jocks are twenty-three and they never sleep.' },
  { call: 'KOLD', freq: '93.7',  name: 'Cold Open',
    line: 'Talk. Their afternoon host used to be your afternoon host.' },
  { call: 'WPTR', freq: '92.5',  name: 'Porter Sports',
    line: 'Two men arguing about a bullpen for four hours a day. It rates.' },
  { call: 'WCMP', freq: '89.1',  name: 'Campus 89',
    line: 'Student-run, board op learning live on the air, and the best Thursday-night specialty show in the market.' },
  { call: 'KBUY', freq: '106.9', name: 'The Barter Channel',
    line: 'Twenty-four hours of paid programming. No jocks, no music, no listener anybody has ever met — and it out-billed you last quarter.' }
];

/* Months, as texture only. There is NO seasonality in the simulation, so not
   one of these lines may claim an effect — no "listening is up", no "ad money
   comes back". They are about weather, crew and the building. If a seasonal
   multiplier ever lands, rewrite them then; until it does, a line here that
   sounds like a mechanic is copy that lies, which is this vault's single most
   repeated defect. 30-day months, twelve to a year. */
const MONTHS = [
  { name: 'January',   line: 'Ice on the guy wires. Your engineer would like it noted that he mentioned this in November.' },
  { name: 'February',  line: 'The request line stays lit all afternoon and nobody in the building wants to go home.' },
  { name: 'March',     line: 'Mud season. The remote truck comes back filthy from every single appearance.' },
  { name: 'April',     line: 'Somebody finally called about the lobby carpet. The whole floor smells like cleaner.' },
  { name: 'May',       line: 'Three schools have asked whether you would carry their graduation live.' },
  { name: 'June',      line: 'Windows down all over town, and the same song requested from the same pay phone.' },
  { name: 'July',      line: 'Heat on the transmitter and half the sales staff out at the lake.' },
  { name: 'August',    line: 'Cicadas in the studio link dish. Nobody believes you until they hear it.' },
  { name: 'September', line: 'Everyone is back in the car at six, and the station lot fills before you get there.' },
  { name: 'October',   line: 'Political spots in the log. They pay on time and the listeners let you know about it.' },
  { name: 'November',  line: 'The sales board has more red marker on it than the whole summer did.' },
  { name: 'December',  line: 'Holiday music somewhere on the dial since October. Overnight is down to one person.' }
];
function monthOf(day){ return Math.floor((Math.max(1, day) - 1) / 30) % 12; }
function monthName(day){ return MONTHS[monthOf(day)].name; }
function monthLine(day){ return MONTHS[monthOf(day)].line; }

/* Milestones, keyed by exact day so ui.js is a lookup and not a ladder of ifs.
   Same rule as MONTHS: these describe the world, never the player. Nothing here
   congratulates anybody — the player already knows whether the day went well,
   and the Daily Brief has the number. */
const MILESTONES = {
  1:    'Day one. The licence is in a frame that nobody has hung yet.',
  10:   'Ten days. The overnight automation has developed a personality you did not program.',
  25:   'Twenty-five days. Someone at a red light recognised the sounder.',
  50:   'Fifty days on the air. First piece of listener mail, and it is a complaint about a song.',
  100:  'One hundred days. The tower light burned out and three separate people called it in.',
  250:  'Two hundred and fifty days. A rival programmer has started listening to your midday on purpose.',
  500:  'Five hundred days. Somebody put the callsign on a bumper sticker without being asked to.',
  1000: 'A thousand days. There are people driving to work who have never known this frequency as anything else.'
};
function milestoneFor(day){ return MILESTONES[day] || null; }

/* Signing on a new signal. These DO teach the mechanic, because the mechanic is
   what the player is about to get wrong. Keyed by the resulting station count;
   four is MAX_STATIONS in sim.js. */
const STATION_MILESTONES = {
  2: 'Two signals. Morning drive is now 6 AM in two places at once, and you are one person.',
  3: 'Three signals. Your engineer covers one daypart on one of them. Pick which.',
  4: 'Four signals, which is the cap. Everything left to buy is a person.'
};

/* Events that move the audience write to s.buzz, never to s.listeners:
   simulateDay() recomputes listeners from scratch every day, so a direct
   listener poke used to survive exactly one render and then vanish. Buzz
   multiplies potential and bleeds back to 1.0 over about six days.
   Cash events scale off the previous day's revenue so a sponsor cheque is
   still worth noticing at plateau instead of becoming decoration.

   Three rules the v3 pool follows, and the reason for each:

   1. Every apply() touches only s.cash, s.rep and s.buzz. Those three fields
      exist in the v2 and the v3 state shapes both, so an event cannot break on
      a save that has not migrated yet, and cannot break on a branch where the
      shape commit has not landed.

   2. No event claims a persistent change the simulation has no field for. A
      tower landlord cannot raise your lease, because lease is derived from
      TX_LEASE/ANT_LEASE and nothing writes to it — so the landlord back-bills
      you instead, which is a cash hit, which is real. A rival cannot
      permanently take share, because comp is day-indexed data — so the rival
      takes your momentum, which is buzz, which is real.

   3. The copy names a physical thing before it names a number. Not "signal
      quality dropped" but "ice loaded the array and the pattern went to
      pieces." The mechanic is the punchline; the trade detail is the setup. */
const EVENTS = [
  /* ---- audience and reputation ---- */
  { id:'viral',    minDay:4,  w:10, type:'good',
    msg:'A forty-second clip from your {part} show is on every phone in town. The request line has not stopped since.',
    apply:s=>{ setBuzz(s, s.buzz*1.28); s.rep=clamp(s.rep+3,0,100); } },
  { id:'guest',    minDay:10, w:7,  type:'good',
    msg:'A touring act walked in off the street with a guitar and no publicist. {name} put them straight on.',
    apply:s=>{ s.rep=clamp(s.rep+4,0,100); setBuzz(s, s.buzz*1.12); } },
  { id:'ratings',  minDay:12, w:8,  type:'good',
    msg:'The new book came in. {part} held its number and the daypart above it moved up.',
    apply:s=>{ s.rep=clamp(s.rep+3.5,0,100); } },
  { id:'offnight', minDay:5,  w:9,  type:'bad',
    msg:'{name} had a rough one. Dead air twice, and the second time it ran nine seconds.',
    apply:s=>{ s.rep=clamp(s.rep-2.5,0,100); setBuzz(s, s.buzz*0.93); } },
  { id:'storm',    minDay:8,  w:7,  type:'bad',
    msg:'Ice loaded the array and the pattern went to pieces for most of the afternoon.',
    apply:s=>{ setBuzz(s, s.buzz*0.85); } },

  /* ---- co-host chemistry: reads on the crews the player actually built ---- */
  { id:'clicked',  minDay:9,  w:8,  type:'good',
    msg:'{name} and {co} found a bit in the second hour and rode it to the top of the clock. Nobody wanted the record.',
    apply:s=>{ setBuzz(s, s.buzz*1.15); s.rep=clamp(s.rep+1.5,0,100); } },
  { id:'clashed',  minDay:9,  w:7,  type:'bad',
    msg:'{name} and {co} spent the whole break not speaking, then did an hour of it live.',
    apply:s=>{ s.rep=clamp(s.rep-2,0,100); setBuzz(s, s.buzz*0.92); } },
  { id:'twoshift', minDay:11, w:6,  type:'bad',
    msg:'{name} pulled a double and it was audible by the third hour. The board op stopped waking them for the joins.',
    apply:s=>{ s.rep=clamp(s.rep-1.8,0,100); setBuzz(s, s.buzz*0.95); } },
  { id:'thirdmic', minDay:15, w:5,  type:'bad',
    msg:'Three voices on one mic and none of them willing to yield. {name} and {co} were still arguing over the outro.',
    apply:s=>{ s.rep=clamp(s.rep-1.5,0,100); setBuzz(s, s.buzz*0.94); } },

  /* ---- the rack. Real faults have their own path in simulateDay; these are
         the near-misses and the bills that live around them. ---- */
  { id:'exciter',  minDay:9,  w:7,  type:'bad',
    msg:'The exciter has been running hot since Tuesday. {eng} wants it off the air for two hours and a replacement module ordered.',
    apply:s=>{ s.cash-=Math.round(150+s.rep*12+(s.lastDay.revenue||0)*0.30); } },
  { id:'stldrop',  minDay:12, w:6,  type:'bad',
    msg:'The studio link dropped mid-sentence and the transmitter fell to its backup feed. Eleven minutes of a loop nobody had checked in a year.',
    apply:s=>{ s.rep=clamp(s.rep-2.2,0,100); setBuzz(s, s.buzz*0.94); } },
  { id:'caught',   minDay:8,  w:6,  type:'good',
    msg:'{eng} found a corroded connector on a routine walk-through. It would have taken the array off at the worst possible hour.',
    apply:s=>{ s.rep=clamp(s.rep+1.2,0,100); } },
  { id:'generator',minDay:18, w:5,  type:'bad',
    msg:'Power dipped at the site and the generator would not pick up the load. {eng} spent the day at the transmitter building waiting on a fuel truck.',
    apply:s=>{ s.cash-=Math.round(200+s.rep*16+(s.lastDay.revenue||0)*0.35); setBuzz(s, s.buzz*0.95); } },

  /* ---- rivals. They take momentum, never share: comp is day-indexed data and
         no event may write to it. ---- */
  { id:'rivalstunt', minDay:10, w:8, type:'bad',
    msg:'{rival} is giving away a truck. Every hour, all week, and their promo is louder than your music.',
    apply:s=>{ setBuzz(s, s.buzz*0.88); } },
  { id:'rivalflip',  minDay:16, w:6, type:'bad',
    msg:'{rival} flipped formats overnight with no warning and came up pointed straight at your best daypart.',
    apply:s=>{ setBuzz(s, s.buzz*0.86); s.rep=clamp(s.rep-1,0,100); } },
  { id:'rivaldark',  minDay:20, w:4, type:'good',
    msg:'{rival} went dark at noon. Their tower rent went unpaid one month too many, and an audience has to go somewhere.',
    apply:s=>{ setBuzz(s, s.buzz*1.22); s.rep=clamp(s.rep+2,0,100); } },
  { id:'poached',    minDay:14, w:5, type:'bad',
    msg:'{rival} has been calling your people at home. {name} did not say no fast enough for anybody\'s comfort.',
    apply:s=>{ s.rep=clamp(s.rep-2,0,100); } },

  /* ---- money, the lease, and the regulator ---- */
  { id:'sponsor',  minDay:6,  w:9,  type:'good',
    msg:'A furniture showroom out on the county road bought a full schedule and paid the whole thing up front.',
    apply:s=>{ s.cash+=Math.round(120+s.rep*22+(s.lastDay.revenue||0)*0.80); } },
  { id:'backbill', minDay:15, w:6,  type:'bad',
    msg:'The tower owner had the site reappraised and back-billed you for the quarter. The escalator was in the lease all along.',
    apply:s=>{ s.cash-=Math.round(180+s.rep*18+(s.lastDay.revenue||0)*0.45); } },
  { id:'fine',     minDay:16, w:4,  type:'bad',
    msg:'A regulator took issue with an ad read on {part} — a claim the sponsor could not back. Small fine, filed publicly.',
    apply:s=>{ s.cash-=Math.round(80+s.rep*14+(s.lastDay.revenue||0)*0.35); s.rep=clamp(s.rep-1,0,100); } },
  { id:'remotepay',minDay:13, w:7,  type:'good',
    msg:'A dealership on Halsted paid for a four-hour remote, the banner and the sno-cone machine. {name} broadcast from a folding table in the rain.',
    apply:s=>{ s.cash+=Math.round(90+s.rep*16+(s.lastDay.revenue||0)*0.55); setBuzz(s, s.buzz*1.06); } }
];

/** The variable bag the event copy above is written against. rollEvent() in
    sim.js supplies {part} and {name} today; merging this gives it the rest.

    Built defensively on purpose: it reads a v3 state (S.stations) and a v2 one
    (S.call) alike, every field is optional, and the whole thing is wrapped —
    a decorative variable is never worth throwing a broadcast day for. If
    rollEvent() never calls it, t2's EVENT_FALLBACKS still keeps a raw brace off
    the screen. This is a cross-file addition; it is named in the content
    writer's 75% report so the integrator wires it rather than discovering it. */
function eventVars(s){
  const v = {};
  try {
    const rival = RIVALS[Math.floor(Math.random() * RIVALS.length)];
    v.rival = rival.call + ' ' + rival.name;
    v.rivalCall = rival.call;
    const st = (s && s.stations && s.stations.length)
      ? s.stations[Math.floor(Math.random() * s.stations.length)] : null;
    v.call = st ? st.call : ((s && s.call) || 'your signal');
    v.seg = (st && st.segment) ? segName(st.segment) : 'the market';
    const staff = (s && s.staff) || [];
    const djs = staff.filter(p => p.role === 'dj');
    const engs = staff.filter(p => p.role === 'eng');
    if (djs.length > 1) v.co = djs[1].name;
    if (engs.length) v.eng = engs[0].name;
    const tx  = TX[(st ? st.tx : (s && s.tx)) || 0]  || TX[0];
    const ant = ANT[(st ? st.ant : (s && s.ant)) || 0] || ANT[0];
    v.gear = (Math.random() < 0.5 ? tx : ant).name;
  } catch (e) { /* a var bag is never worth a thrown day */ }
  return v;
}

// Economy scale. LISTENER_BASE sets how many people one "reach unit" of a
// perfect slot pulls; AD_VALUE is revenue per listener per ad-rate point.
// These two dominate balance — retune here, not in the formula.
// (v3 note: sim.js's finite-pool share model replaces LISTENER_BASE with its
// own PULL_SCALE. LISTENER_BASE stays declared because the 50%-era ui.js and
// any un-migrated code path still read it; it is the systems-engineer's call
// when it comes out, not this file's.)
const LISTENER_BASE = 260;
const AD_VALUE      = 0.42;

/* Expansion gates and the buildout curve.

   Rebalanced for the empire economy — DESIGN.md's deferred list puts
   "rebalance of every constant ... UNLOCK gates, SECOND_STATION_COST curve" at
   the 75% build, verified by the harness. v2 gated its ONE expansion at $60,000
   and rep 70 because expansion was the last thing in the game. In v3 the second
   signal is where the game's actual problem STARTS, so it has to arrive while
   there is still a run left to ruin: around the Class B1 transmitter (rep 24,
   $7,200), not after Class C.

   The original invariant is preserved deliberately: UNLOCK_CASH sits BELOW the
   first buildout cost, so expansion unlocks while you still have to save for
   it. An unlock that arrives with the money already banked contains no decision.

   STATION_COSTS is the rising curve replacing the single SECOND_STATION_COST
   (collision #9): index 0 buys station 2, index 1 station 3, index 2 station 4.
   Each step is roughly 3x the last, so the fourth signal competes with the
   Class C transmitter ($105,000) for the same money — which is exactly the fork
   DESIGN.md wants at the top of the ladder.

   DISAGREEMENT ON RECORD, for the integrator and balance-scientist: sim.js
   carries STATION_COSTS_FALLBACK = [120000, 260000, 520000], reasoned from v2's
   $120,000 so that a player mid-way through saving is not moved. content.js is
   the declared owner of this table (CONTRACT.md, "content.js provides"), so
   these values are the ones that take effect — and lowering a price never
   strands a saver, it only arrives sooner. But the two files disagree by an
   order of magnitude and the harness should settle it rather than either
   builder. */
const UNLOCK_CASH   = 9000;
const UNLOCK_REP    = 32;
const STATION_COSTS = [12000, 40000, 115000];

const SAVE_KEY    = 'callsigns.save';
// Settings live outside the save so the main-menu Settings screen works with
// no station loaded (and so wiping a save doesn't reset your preferences).
const OPTS_KEY    = 'callsigns.opts';
// STILL 2, AND THAT IS CORRECT, NOT AN OVERSIGHT. sim.js owns the payload's
// schema version as its own STATE_VER (3) and migrate() checks that field —
// the version has to live with the code that owns the shape. SAVE_VER here is
// the localStorage key generation, which has not changed. Bumping this line
// alone would migrate nothing; it would just orphan every existing save.
const SAVE_VER    = 2;
const SPEEDS      = { 1: 5000, 2: 2600, 3: 1400 };

// Offline catch-up. Deliberately pinned to the 1x day length: reading
// S.opts.speed here would let a player set 3x, close the tab, and come back to
// 3.5x the payout for the same wall-clock absence.
//
// The cap that binds is in broadcast days, not wall-clock hours. A day is five
// seconds, so the "8 hours" this used to advertise would credit 5,760 days and
// hand back millions — the modal copy was describing a cap the code never had
// (OFFLINE_CAP_MS was unreachable behind OFFLINE_MAX_DAYS). 96 days of
// half-rate net IS the reward; it tops out after about eight minutes away, and
// no longer absence pays more. Derive the millisecond clamp from the day cap so
// the two can never disagree again, and quote the day figure to the player.
const OFFLINE_MS_PER_DAY = SPEEDS[1];
const OFFLINE_MAX_DAYS   = 96;
const OFFLINE_CAP_MS     = OFFLINE_MAX_DAYS * OFFLINE_MS_PER_DAY;
const OFFLINE_RATE       = 0.50;

/* SECOND_STATION_COST lived here as a v2 alias (= STATION_COSTS[0]) so the
   50%-baseline ui.js kept working while the founding flow was rebuilt. That
   flow landed with foundStation(), the merged ui.js reads the curve directly,
   and nothing referenced the alias but its own definition — so it is gone,
   exactly where the integration checklist said to retire it. Two names for
   one number is how they drift apart later. */
const BANKRUPTCY_FLOOR = -4000;
