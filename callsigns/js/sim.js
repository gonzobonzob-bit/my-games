// Callsigns — sim: helpers, game state, the daily simulation and economy, the tick
// clock and timers, save/load/migrate/sanitize, offline catch-up.
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing one top-level scope; load order: content, sim, fx, ui.
//
// v3 (the empire overhaul, 75% build) against callsigns/CONTRACT.md. The three
// accepted mechanics all live in this file:
//   1. marketShare() — finite audience pools, a share denominator that contains
//      YOUR OWN stations' pull, and rival pull that is day-indexed plus a
//      bounded response to your share. Never revenue- or payroll-derived: that
//      self-reference is the Purr & Power trap the design gate exists to catch,
//      and the v2 `network = revenue * 0.32` block was exactly it. It is gone.
//   2. Multi-DJ crews — slot.djs is an ordered array, lead first, and the
//      second co-host is a real decision because they come off another slot on
//      another station and they raise the slot's technical load.
//   3. Engineer assignment — risk is driven by player-set load, fault reputation
//      damage is proportional to LOAD rather than to revenue, and one engineer
//      covers exactly one daypart across the WHOLE empire.
// Per-station daily leases are the failure state: they are charged whether or
// not the station performs, which is what makes over-expansion lose.
'use strict';

/* ---------------- helpers ---------------- */

const $  = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const pick  = a => a[Math.floor(Math.random()*a.length)];
const randInt = (a,b) => a + Math.floor(Math.random()*(b-a+1));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** `in` and a bare property read both walk the prototype chain, and a save is
    untrusted input: JSON.parse produces a REAL own '__proto__' key, so any
    Object.assign / spread of parsed data reparents the target through [[Set]].
    Every read out of a save in this file goes through these four, which is why
    migrate() copies field by field instead of merging. */
const own     = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const readNum = (o, k, d) => (own(o, k) && o[k] !== null && o[k] !== '' && Number.isFinite(+o[k])) ? +o[k] : d;
const readStr = (o, k, d) => (own(o, k) && typeof o[k] === 'string') ? o[k] : d;
const readBool= (o, k, d) => own(o, k) ? !!o[k] : d;

/** t() with an inline English fallback. sim.js needs copy for lines content.js
    has not keyed yet (the four builders work in parallel); t() returns the key
    itself when it misses, which would print "leaseLine" at the player. Once STR
    carries the key the fallback goes dead on its own — content-writer owns the
    final wording, not this file. */
function tOr(key, fallback, vars){
  const s = t(key, vars);
  return s === key ? t2(fallback, vars || {}) : s;
}

// Buzz is a bounded multiplier, and every write to it has to respect the same
// bounds. Events used to write `s.buzz *= 0.85` raw, which parked it under the
// floor until the next simulateDay() re-clamped it — a whole broadcast day of
// out-of-range buzz, with the Daily Brief tile reporting 47% on a stat whose
// own floor is 55%. One helper so a new event can't reintroduce that.
const BUZZ_MIN = 0.55, BUZZ_MAX = 1.85;
const setBuzz = (s, v) => { s.buzz = clamp(v, BUZZ_MIN, BUZZ_MAX); };

/** Drop the decimal once the value would round up to `whole` or beyond, so the
    two sides of a unit boundary never disagree about how many digits to show. */
function unit(v, whole){
  return (+v.toFixed(1) >= whole) ? v.toFixed(0) : v.toFixed(1);
}
function money(n){
  // A partial save (or a stat a future field forgot to seed) must never
  // render as "$NaN" in the HUD.
  if (!Number.isFinite(n)) n = 0;
  // The SIGN comes off the rounded figure, not the raw one: -$0.40 rounds to
  // zero and used to render "-$0".
  n = Math.round(n);
  const neg = n < 0; n = Math.abs(n);
  let s;
  // The UNIT is chosen from the rounded figure, not the raw one, so a value that
  // rounds up out of its unit promotes instead of widening: $999,999 is under
  // 1e6, so testing the raw number printed a four-digit "$1000k" while
  // $1,000,000 one dollar later printed "$1.0M". Rounded thousands hitting 1000
  // is exactly the case the k branch cannot spell, so hand those to M — and no
  // sooner, or $950k would read as "$1.0M". unit() applies the same rule to the
  // decimals inside a branch (the $99,999 / $100,000 hand-off, and 1e7).
  if (Math.round(n / 1e3) >= 1e3) s = '$' + unit(n / 1e6, 10) + 'M';
  // One decimal below $100k: rounding to whole thousands made "$23k" mean
  // anything from $22,500 to $23,499, which is on both sides of the $23,500
  // Panel Array — the player couldn't tell whether the buy button was live.
  else if (n >= 1e4) s = '$' + unit(n / 1e3, 100) + 'k';
  else s = '$' + n.toLocaleString('en-US');
  return (neg ? '-' : '') + s;
}
function num(n){
  if (!Number.isFinite(n)) n = 0;
  n = Math.round(n);
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e4) return (n/1e3).toFixed(1) + 'k';
  return n.toLocaleString('en-US');
}
function randomCall(){
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return pick(['K','W']) + pick(L.split('')) + pick(L.split('')) + pick(L.split(''));
}
/** Stable small hash for a string id — used only to give each segment and
    daypart its own fixed phase in the rival wave, so the competition cycle is
    not four stations peaking in lockstep. Never used for anything the player
    can see as randomness. */
function hashPhase(str){
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100003;
  return (h / 100003) * Math.PI * 2;
}
/** Salary must stay well under the revenue a hire unlocks, or hiring is a
    trap and the whole staff pillar is dead weight. Tuned against balance.js. */
function salaryFor(role, skill){
  return Math.round(ROLES[role].baseSalary * (0.50 + skill * 0.18));
}
function hireFee(p){ return p.salary * 8; }
/** Steeper than it looks: the 1->10 ladder runs about $39,600, so the late
    game still has something worth saving for. The first step stays cheap. */
function trainCostFor(skill){ return Math.round(200 * Math.pow(1.62, skill)); }

/* ---------------- content bridge ----------------

   content.js owns the v3 data tables (CONTRACT.md "content.js provides"):
   SEGMENTS, TX_LEASE, ANT_LEASE, SHOW_TECH, STATION_COSTS, CHEM_TAGS. The four
   builders work in parallel on one file each, so sim.js cannot assume those
   symbols exist yet — and a ReferenceError at load would take the whole game
   down, not just the new mechanic.

   Every table is therefore read through a resolver that prefers the content.js
   value and falls back to a sim-local scaffold with the SAME shape and the
   arithmetic DESIGN.md specifies. `typeof X === 'undefined'` is safe on a
   never-declared identifier; a plain read is not. Deliberately NOT declared
   under the content-owned names — a `var SEGMENTS` here would be a hard
   SyntaxError the moment content.js declares `const SEGMENTS`, and it would
   throw at parse time, before a single line of either file ran.

   These scaffolds are balance placeholders for the harness to tune, not
   authored content. The numbers below are derived, not guessed — see
   PULL_SCALE for the day-one calibration. */

// DESIGN.md, verbatim: TX_LEASE = [0,40,120,340,900]. The TX3->TX4 step is
// +$560/day, which is the "only pays above $918/day revenue" threshold the
// design proof uses to show the top transmitter is not a strictly dominant buy.
const TX_LEASE_FALLBACK  = [0, 40, 120, 340, 900];
// Antennas lease at roughly half the transmitter line — they are a smaller
// site footprint and no power bill. Provisional; the harness owns the retune.
const ANT_LEASE_FALLBACK = [0, 20, 60, 170, 450];
const SHOW_TECH_FALLBACK = { music: 0.00, ads: 0.10, talk: 0.35, news: 0.55 };
// Rising buildout curve replacing v2's single SECOND_STATION_COST (collision
// #9). The first step is v2's $120,000 exactly, so a save that was saving for
// the second station is not moved under the player.
const STATION_COSTS_FALLBACK = [120000, 260000, 520000];

/* Segment scaffolds. `pop` is the finite audience POP(p) per daypart, `comp`
   is the rival pull C — base plus a day-indexed amplitude, and NOTHING in
   either is derived from the player's revenue, costs or payroll.

   Scale: DESIGN.md's founding-crossover arithmetic uses M_A=6000 / C_A=2000 for
   the flagship and M_B=2000 / C_B=400 for a niche. That whole inequality is
   invariant under scaling POP, comp and pull together, so these keep DESIGN's
   figures and PULL_SCALE carries the calibration instead.

   `fit` is a per-show multiplier on pull — a segment is an audience with a
   taste, and it is the second live decision the design proof asks for (which
   segment you found into changes which show wins which daypart). Absent from
   the CONTRACT sketch of the SEGMENTS row; flagged for the integrator. Default
   1.00 everywhere, so a content row that omits `fit` behaves exactly like the
   flagship.

   TV/film runway: a segment is the game's channel abstraction. Nothing in this
   file branches on "radio" — a TV row would be pop/comp/leaseMul/fit/staffRules
   plus a `medium` tag and flow through the same share equation. Zero TV content
   ships this pass; adding a row here would be the scope breach. */
const SEG_FALLBACK = {
  citywide: {
    name: 'Citywide AC', icon: '🏙️', medium: 'radio',
    // v2's daypart weights (1.35 / 0.85 / 1.15 / 0.55) as a population split,
    // anchored so morning = DESIGN's M_A = 6000.
    pop:  { morning: 6000, midday: 3780, evening: 5110, night: 2440 },
    comp: { base: 2000, dayAmp: 0.18 },
    leaseMul: 1.00,
    fit:  { music: 1.00, talk: 1.00, news: 1.00, ads: 1.00 },
    staffRules: {}
  },
  college: {
    // DESIGN's worked niche: M_B = 2000, C_B = 400. Night-heavy, cheap to hold,
    // and it likes music — this is where an under-gunned second signal pays.
    name: 'Late Alternative', icon: '🎸', medium: 'radio',
    pop:  { morning: 1200, midday: 1600, evening: 2000, night: 2400 },
    comp: { base: 400, dayAmp: 0.30 },
    leaseMul: 0.85,
    fit:  { music: 1.15, talk: 0.95, news: 0.85, ads: 0.75 },
    staffRules: {}
  },
  talkband: {
    // Contested and expensive, and it wants an engineer on the desk: news and
    // talk carry the highest SHOW_TECH load in the game, so this is the segment
    // where the one-engineer-per-daypart constraint bites hardest.
    name: 'News & Talk', icon: '🎙️', medium: 'radio',
    pop:  { morning: 4200, midday: 3000, evening: 3400, night: 1200 },
    comp: { base: 1500, dayAmp: 0.15 },
    leaseMul: 1.10,
    fit:  { music: 0.80, talk: 1.20, news: 1.25, ads: 0.95 },
    // Advisory, never a hard block: a segment that CANNOT be operated without a
    // role you might not have would be the "unwinnable and invisible to code
    // review" class of defect CLAUDE.md rule 2 exists for. It is a risk
    // multiplier, so the answer to "no engineer" is worse odds, not a wall.
    staffRules: { wantsEng: true, riskMul: 1.15 }
  },
  border: {
    name: 'Regional Border', icon: '🌾', medium: 'radio',
    pop:  { morning: 3000, midday: 2600, evening: 2800, night: 1600 },
    comp: { base: 700, dayAmp: 0.22 },
    leaseMul: 0.95,
    fit:  { music: 1.05, talk: 1.00, news: 1.00, ads: 1.10 },
    staffRules: {}
  }
};

/* On-air chemistry. One style tag per person; a pair either lifts or drags the
   crew term. This is what makes the portfolio card's old "DJs with slots that
   suit them" claim true (producer condition #5) and it is why a skill-6 second
   host is not simply additive. content.js owns the real table and its copy. */
const CHEM_FALLBACK = {
  warm:       { name: 'Warm',       likes: ['manic', 'streetwise'], clashes: ['dry'] },
  manic:      { name: 'Manic',      likes: ['warm', 'musical'],     clashes: ['bookish'] },
  dry:        { name: 'Dry',        likes: ['bookish', 'musical'],  clashes: ['warm'] },
  streetwise: { name: 'Streetwise', likes: ['warm', 'manic'],       clashes: ['bookish'] },
  bookish:    { name: 'Bookish',    likes: ['dry', 'musical'],      clashes: ['manic', 'streetwise'] },
  musical:    { name: 'Musical',    likes: ['manic', 'dry', 'bookish'], clashes: [] }
};

function segTable(){
  const t0 = (typeof SEGMENTS !== 'undefined') ? SEGMENTS : null;
  return (t0 && typeof t0 === 'object' && Object.keys(t0).length) ? t0 : SEG_FALLBACK;
}
/** Never returns undefined: an unknown id (hand-edited save, a content row
    deleted between builds) resolves to the flagship segment rather than
    dividing by an undefined pool three lines later. */
function segmentOf(id){
  const tbl = segTable();
  if (own(tbl, id) && tbl[id] && typeof tbl[id] === 'object') return tbl[id];
  return tbl[DEFAULT_SEGMENT] || SEG_FALLBACK.citywide;
}
function segmentIds(){ return Object.keys(segTable()); }
function isSegment(id){ return typeof id === 'string' && own(segTable(), id); }
function segPop(seg, partId){ return Math.max(1, readNum(seg.pop, partId, 1000)); }
function segFit(seg, showKey){ return seg.fit ? readNum(seg.fit, showKey, 1) : 1; }
function segLeaseMul(seg){ return clamp(readNum(seg, 'leaseMul', 1), 0.25, 4); }
function segRiskMul(seg){ return seg.staffRules ? clamp(readNum(seg.staffRules, 'riskMul', 1), 0.5, 3) : 1; }

function txLease(i){
  const tbl = (typeof TX_LEASE !== 'undefined' && Array.isArray(TX_LEASE)) ? TX_LEASE : TX_LEASE_FALLBACK;
  return Number.isFinite(tbl[i]) ? tbl[i] : 0;
}
function antLease(i){
  const tbl = (typeof ANT_LEASE !== 'undefined' && Array.isArray(ANT_LEASE)) ? ANT_LEASE : ANT_LEASE_FALLBACK;
  return Number.isFinite(tbl[i]) ? tbl[i] : 0;
}
function showTech(showKey){
  const tbl = (typeof SHOW_TECH !== 'undefined' && SHOW_TECH) ? SHOW_TECH : SHOW_TECH_FALLBACK;
  return readNum(tbl, showKey, readNum(SHOW_TECH_FALLBACK, showKey, 0));
}
function stationCosts(){
  const tbl = (typeof STATION_COSTS !== 'undefined' && Array.isArray(STATION_COSTS) && STATION_COSTS.length)
    ? STATION_COSTS : STATION_COSTS_FALLBACK;
  return tbl;
}
function chemTable(){
  const tbl = (typeof CHEM_TAGS !== 'undefined') ? CHEM_TAGS : null;
  return (tbl && typeof tbl === 'object' && Object.keys(tbl).length) ? tbl : CHEM_FALLBACK;
}
function chemTags(){ return Object.keys(chemTable()); }

/* ---------------- v3 constants ----------------
   Everything here is a balance number the harness may move. What it may NOT
   move is the SHAPE: pull never reads revenue, rival response stays bounded,
   and fault reputation damage stays proportional to load. */

// The schema version lives with the code that owns the shape, not with the
// content tables. content.js still exports SAVE_VER (2) for the key name it
// was bumped alongside; the payload's `v` field is this one, and migrate()
// checks it. Embedding the version IN the payload is the rule — a key-name
// bump alone does not migrate anything, it just crashes older saves.
// v4: a slot carries `engs` (up to MAX_ENG ids) instead of a single `eng`.
// migrate() lifts a v3 `eng` string into a one-element array; see loadSlots.
// v5: S.rivalNets holds per-segment, per-network rival capacity. A v4 save has
// none, and rivalK() seeds each network at its opening size on first read — so
// an in-flight run resumes with exactly the competition it had.
/* v6 adds station.cond (signal condition). A v<=5 station migrates in at 1.00 —
   pristine — so nobody's live run is retroactively punished for days played
   before the mechanic existed. */
const STATE_VER = 6;

// Producer condition #2: the assignment surface has to stay sub-linear in
// stations. Four is the accepted hard cap for this overhaul.
const MAX_STATIONS = 4;
const DEFAULT_SEGMENT = 'citywide';

/* Audience scale. POP(p) now says how many people exist in a daypart, and
   PULL_SCALE says how hard one unit of quality x reach x fidelity pulls at
   them. It replaces v2's LISTENER_BASE, which multiplied listeners directly
   and cannot survive a finite pool.

   Calibrated, not guessed: at 92, a day-one station (Part 15 rig, whip
   antenna, no staff, rep 5, the default schedule) grosses $60.9/day against a
   $60/day lease — which is DESIGN.md's minute-5 pressure curve to the dime,
   and reproduces v2's day-one listener counts per slot within one listener.
   Move this and the whole opening changes. */
const PULL_SCALE = 92;

// Rival pull: day-indexed, plus a bounded response to the share you actually
// took off them. Bounded is load-bearing — an unbounded response is a death
// spiral, and a revenue-derived one is the self-reference trap. Pressure is a
// dimensionless audience ratio in [0,1], so rival pull tops out at 1.9x base
// no matter how big the empire gets, while YOUR pull keeps climbing with gear
// and talent. That asymmetry is the counterbalance.
const RIVAL_GAIN   = 0.90;   // v4 and earlier; retained for save migration only
const RIVAL_ADAPT  = 0.06;   // ~17-day memory; slow enough to out-run briefly
const RIVAL_PERIOD = 34;     // days per competition cycle

/* ── v5: rivals own capacity ─────────────────────────────────────────────
   Through v4 the rival denominator was a wave times a bounded response to the
   share you were CURRENTLY taking. That is a negative feedback loop pointed
   the wrong way: stop competing and takenShare -> 0, so pressure -> 0, so C
   falls to its floor. The competition got weaker the less you played, which is
   the mechanical reason `LOSABLE: doing nothing eventually goes broke` failed
   and an idle run finished ~$33k up over 540 days.

   Now each rival network owns a persistent capacity K per segment. K compounds
   into markets you leave empty and erodes in markets you hold, so absence is
   punished and presence pays. Nothing in K reads revenue, cash or payroll —
   the day the denominator learns what the player earns, the game is solved.

   Rates are the ones the design proof's arithmetic used (docs/DESIGN_PROOF_RIVALS.md):
   at GROWTH a fully vacant segment's rival roughly doubles in ~70 days, which
   is slow enough to notice and fast enough to matter inside one run.
   ONE rate and ONE target, deliberately, because the obvious two-rate form
   (grow by A*(1-h), shrink by B*h) couples speed to balance point: its
   equilibrium is A/(A+B), so pinning the balance where it belongs forces the
   speed to be glacial.

       K <- K * (1 + RATE * (1 - h/TARGET))

   RATE is how fast a market moves, TARGET is the share you must hold to keep
   it still, and they are independent.

   TARGET is MEASURED, not guessed. One station takes 1.85% of its segment pool
   running on automation and 5.25% competently staffed — the whole live range is
   a couple of percent, because a segment pool is four dayparts wide and the
   rivals are most of it. The first two tunings used 30% and 18%, which put
   every possible player below the threshold, so rivals grew at the same rate
   for an idle station and a well-run one and the harness reported idle and
   careful finishing within $340 of each other. 3.2% sits between the two
   measured figures: automation drifts backwards, a staffed schedule pushes
   forward. */
const RIVAL_RATE   = 0.006;   // per day at zero share; ~116 days to double
const RIVAL_TARGET = 0.032;   // the held share at which a market stops moving
const RIVAL_K_MIN  = 0.30;    // floor, as a multiple of the network's opening size
const RIVAL_K_MAX  = 2.20;    // ceiling, so a runaway cannot lock you out forever

/* Fallback roster, same contract as SEG_FALLBACK: content.js owns the real
   table and this keeps sim runnable on its own. `w` is the network's share of
   a segment's opening comp base, so the sum of w across a segment is 1.0 and
   day-one competition is IDENTICAL to v4 — the minute-5 founding arithmetic in
   DESIGN.md must not move, and it does not. */
const RIVAL_NETS_FALLBACK = [
  { id: 'sunbelt',  name: 'Sunbelt Media',   icon: '📡', w: 0.45 },
  { id: 'lantern',  name: 'Lantern Group',   icon: '🏮', w: 0.35 },
  { id: 'ridgeway', name: 'Ridgeway Family', icon: '🌾', w: 0.20 },
];
function rivalNets(){
  const t = (typeof RIVAL_NETS !== 'undefined' && Array.isArray(RIVAL_NETS) && RIVAL_NETS.length)
    ? RIVAL_NETS : RIVAL_NETS_FALLBACK;
  return t;
}

/* ---------------- Mechanic 5: signal condition ----------------

   The second lever, and the one that finally gives the lease a clock.

   THE PROBLEM IT SOLVES. The rival-capacity term (v5) is bounded by
   RIVAL_K_MAX, so the worst drag it can ever apply to an unattended station is
   about -$4/day. Measured: an idle run peaks near $10,800 around day 378 and
   still ends 540 days up. No value of RIVAL_TARGET fixes that — the whole live
   share range is a couple of percent wide, and the two tunings that tried
   (3.5%, 4.2%) collapsed the economy for everyone else before they touched
   idle. A second lever was the only way out.

   WHAT IT IS. Every station carries `cond` in [COND_MIN, 1], multiplying its
   pull. Transmitters WEAR — bigger plant wears faster — and people TEND. So:

       cond <- clamp(cond + COND_GAIN*attn*(1 - cond) - wear, COND_MIN, 1)

   which has a closed-form fixed point, and that is the point of this shape:

       c* = 1 - wear / (COND_GAIN * attn)          (floored at COND_MIN)

   A destination the UI can show beats a slope the player has to integrate in
   their head. An invisible mechanic that drains you is indistinguishable from
   a bug, so condition is rendered with its wear, its attention and its c*.

   WHY IT IS NOT ANTI-EXPANSION — the property RIVAL_TARGET 4.2% did not have.
   Wear is charged against WATTS, not callsigns. One Class C station on four
   slots needs four engineers to sit at 0.91; four small stations hold the same
   0.91 on one engineer each. Same four engineers either way, so the lever is
   neutral between concentrating and spreading. What it does punish is running
   signals nobody tends, which is precisely the reckless-expansion line.

   WHY THE GEAR LADDER STOPS BEING AUTOMATIC. A transmitter step now costs cash,
   lease AND wear, and the candidate stream is flat forever — so the real price
   of TX4 is the DJ you did not hire. Before this, TX4 was an automatic buy for
   anyone who could afford it.

   THE SPIRAL GUARD, load-bearing: `cond` enters slotPull() and NOTHING else.
   It must never reach the `quality` that feeds avgQuality/repPressure in
   simulateDay(). Reputation is proportional-recovery with additive damage;
   a multiplicative rep term driven by condition would close a rep->pull->
   share->rep loop with no floor. Keep it out of the reputation path. */
const COND_MIN     = 0.35;   // floor: bounds the drag, and sets the idle end-state
const COND_WEAR    = 0.0025; // per day at TX0/ANT0 — (1-COND_MIN)/this = 260 days to floor
const WEAR_PER_TX  = 0.55;   // TX4 wears 3.2x a Part 15 rig
const WEAR_PER_ANT = 0.30;   // half the transmitter line, mirroring ANT_LEASE ~ 1/2 TX_LEASE
const COND_GAIN    = 0.030;  // per attention-unit per day
const ENG_TEND     = 1.00;   // an engineer tends the plant
const DJ_TEND      = 0.25;   // a host notices the audio is wrong; they do not climb the tower

/** Daily wear for a station, driven by the size of its plant. */
function stationWear(st){
  return COND_WEAR * (1 + WEAR_PER_TX * (st.tx || 0) + WEAR_PER_ANT * (st.ant || 0));
}
/** How many slots each person covers across the whole empire.

    Load-bearing, and the thing this mechanic is actually about. A DJ may work
    one daypart empire-wide, but that still lets FOUR people cover all sixteen
    slots of a four-station empire — morning at one callsign, midday at the
    next, and so on. Counting covered slots therefore reports a skeleton crew
    stretched across four signals as fully tended: measured, the reckless
    policy held 92% condition on four staff and no engineers, a better figure
    than the careful single-station line managed with five staff and an
    engineer. Attention is PERSON-HOURS, not slot coverage, and a person spread
    over four slots brings a quarter of themselves to each. */
function staffSlotLoad(){
  const load = Object.create(null);
  for (const st of S.stations) {
    for (const part of DAYPARTS) {
      const slot = st.schedule && st.schedule[part.id];
      if (!slot) continue;
      for (const id of engIdsOf(slot)) load[id] = (load[id] || 0) + 1;
      if (Array.isArray(slot.djs)) for (const id of slot.djs) if (id) load[id] = (load[id] || 0) + 1;
    }
  }
  return load;
}
/** Person-hours pointed at one station today. An engineer tends the plant, a
    host only notices the audio is wrong, and a dark slot brings nobody — which
    is what makes an unattended signal decay and a thinly-spread empire decay
    everywhere at once.

    `load` is optional so the daily tick can build the map once for the whole
    empire instead of once per station. */
function stationAttn(st, load){
  const l = load || staffSlotLoad();
  let a = 0;
  for (const part of DAYPARTS) {
    const slot = st.schedule && st.schedule[part.id];
    if (!slot) continue;
    const engs = engIdsOf(slot);
    if (engs.length) {
      for (const id of engs) a += ENG_TEND / Math.max(1, l[id] || 1);
    } else if (Array.isArray(slot.djs) && slot.djs.length) {
      for (const id of slot.djs) if (id) a += DJ_TEND / Math.max(1, l[id] || 1);
    }
  }
  return a;
}
/** Where this station's condition is heading under today's staffing — the
    closed-form fixed point. The UI shows this so the decision is legible. */
function condTarget(st, load){
  const attn = stationAttn(st, load);
  if (attn <= 0) return COND_MIN;
  return clamp(1 - stationWear(st) / (COND_GAIN * attn), COND_MIN, 1);
}
/** Advance one station's condition by `days` days. Shared by the daily tick and
    by catchUp(), which must NOT be able to freeze decay by closing the tab. */
function stepCondition(st, days, load){
  const n = Math.max(0, Math.floor(days || 0));
  const wear = stationWear(st), attn = stationAttn(st, load);
  let c = typeof st.cond === 'number' && isFinite(st.cond) ? st.cond : 1;
  for (let i = 0; i < n; i++) c = clamp(c + COND_GAIN * attn * (1 - c) - wear, COND_MIN, 1);
  st.cond = c;
  return c;
}
/** Read a station's condition defensively — every consumer goes through this so
    a save that predates v6 reads as pristine rather than as zero. */
function condOf(st){
  const c = st && st.cond;
  return (typeof c === 'number' && isFinite(c)) ? clamp(c, COND_MIN, 1) : 1;
}

// Mechanic 2: crewSkill = s1 + 0.55*s2 + 0.30*s3, cap three to a slot.
const CREW_WEIGHTS = [1, 0.55, 0.30];
const MAX_CREW = CREW_WEIGHTS.length;

/* Engineers per slot. v3 allowed exactly one; v4 allows two, at the owner's
   direction, and stops there deliberately.

   The weights are the whole design. A flat second engineer would make the
   answer "put two on everything and stop thinking" — the same solved-loop
   failure the design gate exists to catch. At 0.45 the second engineer is
   worth less than the first, so the real question stays "is this slot's LOAD
   worth a second body, or does that body cover a bare slot somewhere else?"
   which is a comparison against the rest of the empire rather than a local
   yes.

   Three is not a slider we left off: with ENG_WEIGHTS[2] small enough to be
   honest it would never beat covering a third slot, and with it large enough
   to matter the one-engineer-per-daypart scarcity stops binding at all. */
const ENG_WEIGHTS = [1, 0.45];
const MAX_ENG = ENG_WEIGHTS.length;
const CHEM_LIKE = 0.10, CHEM_CLASH = 0.12, CHEM_MIN = 0.76, CHEM_MAX = 1.24;

// Mechanic 3. BASE_RISK is pinned by DESIGN's own arithmetic and is not free:
// the design proof states that a second co-host (load 1.00 -> 1.45) raises
// fault risk by +0.027 on an unengineered slot, which is 0.45 * BASE_RISK, so
// BASE_RISK = 0.06. The same number produces the negative-feedback check's
// equilibrium of 3.6 rep below target at three stations
// (3 stations * 4 slots * 0.06 * 0.25 load / 0.05 recovery = 3.6). Retuning it
// invalidates both, and balance-scientist has to re-verify the spiral check.
const BASE_RISK        = 0.06;
const LOAD_PER_COHOST  = 0.45;
const ENG_RISK_DIVISOR = 0.30;
const FAULT_REV_MUL    = 0.55;
const FAULT_REP_PER_LOAD = 0.25;

// The lease floor every licensee pays before a single watt goes out: tower
// site, studio, line charges. lease(s) = (60 + TX_LEASE + ANT_LEASE) * leaseMul.
const BASE_LEASE = 60;

function makePerson(role, repLevel){
  const spread = 2 + Math.floor(repLevel / 22);
  const skill = clamp(randInt(1, 3 + spread), 1, 10);
  return {
    id: 'p' + Math.random().toString(36).slice(2, 9),
    name: pick(FIRST) + ' ' + pick(LAST),
    role, skill,
    // One style tag per person. Everyone carries one (an engineer's tag is
    // inert today) so the roster shape does not fork by role — a per-role
    // shape is exactly the kind of thing sanitize() then has to special-case.
    tags: [pick(chemTags())],
    salary: salaryFor(role, skill)
  };
}

/* ---------------- state ---------------- */

let S = null;
// CLAUDE.md "Interval hygiene": every setInterval handle lives here and is
// cleared by stopAllTimers(), so cycling Menu -> Start Game can never stack a
// second tick or autosave loop on top of the first.
let timer = null;
let autosaveTimer = null;
// Set once the first time localStorage refuses a write (private browsing,
// quota) so we warn the player once instead of every 30 seconds.
let saveBroken = false;

const DEFAULT_OPTS = { speed: 1, autosave: true, eventPopups: true, reducedMotion: false, sound: true };

/** Settings are their own localStorage entry, so the main-menu Settings screen
    is live with no station loaded. A running game keeps its own copy in
    S.opts (so it saves with the run); gOpts is the menu-side mirror. */
function readOpts(){
  // Field by field against DEFAULT_OPTS, not Object.assign: this is parsed
  // localStorage like any other, and an own '__proto__' in it would reparent
  // the options object through [[Set]].
  const out = Object.assign({}, DEFAULT_OPTS);
  try {
    const raw = JSON.parse(localStorage.getItem(OPTS_KEY));
    if (raw && typeof raw === 'object') {
      out.speed = SPEEDS[readNum(raw, 'speed', 1)] ? readNum(raw, 'speed', 1) : 1;
      for (const k of ['autosave', 'eventPopups', 'reducedMotion', 'sound']) {
        out[k] = readBool(raw, k, DEFAULT_OPTS[k]);
      }
    }
  } catch (e) {}
  return out;
}
function writeOpts(o){ try { localStorage.setItem(OPTS_KEY, JSON.stringify(o)); } catch (e) {} }

let gOpts = readOpts();

/** The v2 default schedule, unchanged — it is what a v2 save's founded second
    station inherits under the migration policy, so it has to stay a function
    rather than an inline literal in two places that can drift apart. */
function defaultSchedule(){
  return {
    morning: { show: 'music', djs: [], engs: [] },
    midday:  { show: 'music', djs: [], engs: [] },
    evening: { show: 'talk',  djs: [], engs: [] },
    night:   { show: 'music', djs: [], engs: [] }
  };
}

/** A station is the whole unit of expansion: its own callsign, dial position,
    segment, gear and schedule. Staff are deliberately NOT here — the global
    pool is the scarce resource, and a per-station staff array would be a
    design breach (CONTRACT.md). */
function newStation(call, segment, day){
  return {
    call: call || randomCall(),
    // Commercial band only, on legal odd tenths: 88.1-91.9 is the reserved
    // non-commercial band a licensee like this could never hold.
    freq: (92.1 + randInt(0, 79) * 0.2).toFixed(1),
    segment: isSegment(segment) ? segment : DEFAULT_SEGMENT,
    tx: 0, ant: 0,
    // v6: signal condition, 1.00 = freshly signed on. Day-one arithmetic in
    // DESIGN.md is untouched precisely because a new station starts pristine.
    cond: 1,
    // Yesterday's lease bill, for display only — simulateDay() recomputes it
    // from the gear every single day, so a stale value can never be charged.
    lease: 0,
    foundedDay: Math.max(1, Math.floor(day || 1)),
    totalEarned: 0,
    schedule: defaultSchedule()
  };
}

function newState(call){
  return {
    v: STATE_VER,
    stations: [ newStation(call, DEFAULT_SEGMENT, 1) ],
    // Which station the Studio/Gear tabs are looking at. Not in the CONTRACT
    // sketch; the station switcher needs somewhere to keep it and it belongs
    // in the save, or switching station and reloading snaps you back to the
    // flagship. Flagged for the integrator.
    active: 0,
    day: 1,
    cash: 800,
    listeners: 40,
    rep: 5,
    // Audience momentum. Random events push this around; simulateDay() decays
    // it back toward 1.0 so a viral clip is a spike, not a permanent tier.
    buzz: 1,
    staff: [],
    // The hiring pool is part of the run, not a free reroll: it used to be a
    // module global, so Pause -> Main Menu -> Continue re-rolled talent until
    // a 10-skill DJ turned up.
    candidates: [],
    nextHireDay: 7,
    // Per-segment rival pressure in [0,1] — how much of that pool you have
    // been taking, which is what the rivals respond to. An audience ratio, not
    // money: the moment this reads revenue it is the P&P self-reference trap.
    rivals: {},
    rivalNets: {},
    log: [],
    unlockedExpansion: false,
    // Acknowledgement flags. Without seenExpansion the Empire tab badge stayed
    // lit forever, including long after the second station was founded; without
    // seenIntro, Continue would replay the onboarding modal every load.
    seenExpansion: false,
    seenIntro: false,
    lastDay: {
      listeners: 0, revenue: 0, costs: 0, net: 0, quality: 0,
      royalties: 0, payroll: 0, leases: 0, repTarget: 0, faults: 0
    },
    // The ledger. Every dollar of cash movement lands on one of these lines,
    // and closing must equal opening + revenue + events + offline − payroll −
    // royalties − leases − capex on every single day (CLAUDE.md rule 2). capex
    // is in there because a capital purchase is a cash outflow: leaving it out
    // is how a P&L reports profit on a month that emptied the bank.
    book: {
      day: 1, opening: 800, revenue: 0, payroll: 0, royalties: 0,
      leases: 0, capex: 0, events: 0, offline: 0, closing: 800
    },
    opts: Object.assign({}, gOpts),
    stats: { totalEarned: 0, totalCosts: 0, peakListeners: 40, daysOnAir: 0, stationsFounded: 1 },
    // Wall-clock stamp for offline catch-up (CLAUDE.md: idle/tycoon games).
    lastTick: Date.now()
  };
}

/* ---------------- station access ---------------- */

function stationCount(){ return S && Array.isArray(S.stations) ? S.stations.length : 0; }
function activeIndex(){ return clamp(Math.floor(S.active || 0), 0, Math.max(0, stationCount() - 1)); }
function activeStation(){ return S.stations[activeIndex()]; }
function setActiveStation(i){
  if (!S) return;
  S.active = clamp(Math.floor(i), 0, Math.max(0, stationCount() - 1));
}
function stationAt(i){ return S.stations[clamp(Math.floor(i || 0), 0, Math.max(0, stationCount() - 1))]; }

/* ---------------- legacy view bridge ----------------

   TRANSITIONAL, and it is meant to be deleted. ui.js and fx.js are being
   rewritten for v3 in parallel worktrees; until those land they still read
   S.call / S.freq / S.tx / S.ant / S.schedule as flat scalars, and
   `TX[S.tx].spec` on the render path throws on an undefined index rather than
   degrading. These accessors point those five names at the ACTIVE station so
   the game boots, renders and is playable at every commit in between.

   Non-enumerable on purpose: JSON.stringify skips them, so a v3 save carries
   exactly one copy of the callsign (inside stations[0]) and there is never a
   second source of truth to drift. Defined here rather than in newState() so
   they are installed on every load path too — sanitize() is the single funnel.

   Integrator: delete installLegacyViews() and its call in sanitize() once
   ui.js/fx.js read stations[]. Nothing in sim.js uses them. */
function installLegacyViews(s){
  const view = (key) => ({
    configurable: true,
    enumerable: false,
    get(){ const st = s.stations && s.stations[clamp(Math.floor(s.active || 0), 0, s.stations.length - 1)]; return st ? st[key] : undefined; },
    set(v){ const st = s.stations && s.stations[clamp(Math.floor(s.active || 0), 0, s.stations.length - 1)]; if (st) st[key] = v; }
  });
  for (const key of ['call', 'freq', 'tx', 'ant', 'schedule', 'segment']) {
    try { Object.defineProperty(s, key, view(key)); } catch (e) {}
  }
  return s;
}

/* ---------------- staff ---------------- */

function staffOf(role){ return S.staff.filter(p => p.role === role); }
function personById(id){ return S.staff.find(p => p.id === id) || null; }
function bestSkill(role){
  const list = staffOf(role);
  return list.length ? Math.max(...list.map(p => p.skill)) : 0;
}
/** Best hire leads; each additional one in the role adds sharply less.
    Without this, a second engineer is pure salary with zero benefit. */
function roleStrength(role){
  return staffOf(role)
    .map(p => p.skill).sort((a, b) => b - a)
    .reduce((sum, s, i) => sum + s * Math.pow(0.40, i), 0);
}
/** DEAD to the simulation as of v3 (collision #5): engineers are assigned per
    slot now and they act on slotRisk(), not on reach or fidelity — an
    empire-wide engineer scalar quietly made the per-slot decision free.
    Retained only because the v2 Station Effects card still calls it; ui.js's
    v3 rebuild should drop that line and then this function. */
function engBonus(){ return Math.min(0.42, roleStrength('eng') * 0.035); }
/* Sales, and the ceiling that makes it a decision.

   A half-full log is the floor, not a third: the old 0.30 baseline made the
   first two weeks a dead zone, and the old ceiling made sales a ~5.5x
   multiplier that dwarfed the entire transmitter ladder. Cutting it to ~2.7x
   fixed the SIZE and left the real problem untouched.

   THE REAL PROBLEM. A salesperson is the only hire in this game with no
   opportunity cost. They occupy no slot, contribute no attention (so they never
   touch signal condition), carry no fatigue and take no loadFactor risk. Two
   skill-10 hires reach roleStrength 14.0 and take fill 0.50 -> 0.95 and price
   1.00 -> 1.42 — measured 2.70x on the revenue terms, for about $166/day of
   salary. There is no state in which that is the wrong purchase, so it is not a
   decision, it is a tax on knowing about it. And because tests/harness.mjs only
   ever calls hireBest() with 'dj' and 'eng', NO POLICY HAS EVER BOUGHT ONE:
   every balance number this project has published describes a game with its
   single largest lever unpulled. Same shape as the salaryFor() defect — the
   numbers were not wrong, they were about a game nobody plays.

   THE FIX IS A CEILING, NOT A SMALLER NUMBER. Reputation caps how much
   inventory you can sell and what you can charge for it: an unknown station
   cannot sell premium airtime however good its sellers are. Points above the
   cap are worth EXACTLY ZERO, so "hire another seller" stops being universally
   right and starts depending on rep — which faults damage and good programming
   repairs. That converts an unbounded purchase into a bounded one whose ceiling
   is set by play.

   Reads reputation only. No cash, revenue or payroll term enters here, and it
   must stay that way — the day the ad rate learns what the player earns, the
   game is solved (see the Purr & Power note in CLAUDE.md).

   Deliberately empire-wide for now because S.rep is. DESIGN_PROOF_ROOMS.md
   makes both per-station when the Sales Floor lands; these are the same two
   formulas, so that change is a re-siting rather than a retune. */
const FILL_CAP_BASE = 0.55, FILL_CAP_PER_REP = 0.0040, FILL_CAP_MAX = 0.95;
const PRICE_CAP_BASE = 1.00, PRICE_CAP_PER_REP = 0.0045, PRICE_CAP_MAX = 1.45;
/** Most inventory a station of this reputation can actually move. */
function fillCap(){ return clamp(FILL_CAP_BASE + FILL_CAP_PER_REP * S.rep, FILL_CAP_BASE, FILL_CAP_MAX); }
/** Most a station of this reputation can charge for it. */
function priceCap(){ return clamp(PRICE_CAP_BASE + PRICE_CAP_PER_REP * S.rep, PRICE_CAP_BASE, PRICE_CAP_MAX); }
function salesFill(){ return clamp(0.50 + roleStrength('sales') * 0.040, 0.50, fillCap()); }
function salesPrice(){ return clamp(1 + roleStrength('sales') * 0.030, 1, priceCap()); }
/** Sales points beyond what reputation can carry — the number the UI has to
    show, because a seller earning nothing looks identical to one earning. */
function salesWasted(){
  const need = Math.max((fillCap() - 0.50) / 0.040, (priceCap() - 1) / 0.030);
  return Math.max(0, roleStrength('sales') - need);
}

/** How many slots a DJ is booked on across the WHOLE empire — working every
    morning drive in the network wears one person down exactly as hard as
    working four slots on one station did in v2. */
function djLoad(id){
  let n = 0;
  for (const st of S.stations) {
    for (const p of DAYPARTS) {
      const slot = st.schedule[p.id];
      if (slot && slot.djs.indexOf(id) >= 0) n++;
    }
  }
  return n;
}
function djFatigue(id){ return clamp(1 - 0.18 * (djLoad(id) - 1), 0.40, 1); }

/** The people actually on a slot, lead first, orphan ids skipped. */
function crewOf(slot){
  const out = [];
  if (!slot || !Array.isArray(slot.djs)) return out;
  for (const id of slot.djs) {
    const p = personById(id);
    if (p) out.push(p);
  }
  return out;
}
/** crewSkill = s1 + 0.55*s2 + 0.30*s3 (DESIGN mechanic 2). The ORDER of
    slot.djs is the lead order and is load-bearing arithmetic, not decoration —
    ui must keep it stable when it adds or removes a co-host. */
function crewSkill(slot){
  const crew = crewOf(slot);
  let sum = 0;
  for (let i = 0; i < crew.length && i < MAX_CREW; i++) sum += CREW_WEIGHTS[i] * crew[i].skill;
  return sum;
}
/** Fatigue for a crew is the same weighted mean as their skill, so a rested
    lead is not cancelled by a co-host pulling a triple shift and vice versa.
    With one DJ this reduces exactly to v2's djFatigue(), which is what the
    design proof's single-host arithmetic assumes. */
function crewFatigue(slot){
  const crew = crewOf(slot);
  if (!crew.length) return 1;
  let wsum = 0, fsum = 0;
  for (let i = 0; i < crew.length && i < MAX_CREW; i++) {
    wsum += CREW_WEIGHTS[i];
    fsum += CREW_WEIGHTS[i] * djFatigue(crew[i].id);
  }
  return wsum ? fsum / wsum : 1;
}
/** On-air chemistry over every pair in the crew. Solo is exactly 1.00, so a
    lone host is never penalised for having nobody to bounce off. Bounded both
    ways — chemistry moves the co-host decision, it does not decide it. */
function chem(slot){
  const crew = crewOf(slot);
  if (crew.length < 2) return 1;
  const tbl = chemTable();
  const tagOf = p => (Array.isArray(p.tags) && typeof p.tags[0] === 'string') ? p.tags[0] : null;
  let v = 1;
  for (let i = 0; i < crew.length; i++) {
    for (let j = i + 1; j < crew.length; j++) {
      const a = tagOf(crew[i]), b = tagOf(crew[j]);
      if (!a || !b) continue;
      const ra = own(tbl, a) ? tbl[a] : null;
      if (!ra) continue;
      if (Array.isArray(ra.likes)   && ra.likes.indexOf(b)   >= 0) v += CHEM_LIKE;
      if (Array.isArray(ra.clashes) && ra.clashes.indexOf(b) >= 0) v -= CHEM_CLASH;
    }
  }
  return clamp(v, CHEM_MIN, CHEM_MAX);
}
/** The DJ term of slot quality. No crew is a real penalty, not a zero —
    automation still airs something. */
function djTerm(slot){
  const crew = crewOf(slot);
  if (!crew.length) return 0.32;
  return 0.58 + 0.052 * crewSkill(slot) * chem(slot) * crewFatigue(slot);
}

/** Kept for the v2 slot renderer: the lead DJ, or null. Reads djs[0] now. */
function djFor(slot){
  if (!slot || !Array.isArray(slot.djs) || !slot.djs.length) return null;
  return personById(slot.djs[0]);
}

/* ---------------- per-station values ---------------- */

/** Reach and fidelity are per-STATION now (collision #3), and neither carries
    an engineer term any more (collision #5) — an empire-wide engineer scalar
    quietly paid for itself on every station at once, which is precisely the
    "overstaffing is free" failure the per-slot engineer mechanic exists to
    remove. `st` defaults to the active station so the v2 call sites that pass
    nothing still resolve to something real. */
function reachValue(st){ return TX[(st || activeStation()).tx].reach; }
/** In v2 fidelity was a RETENTION multiplier applied after listeners were
    computed. Under a finite pool that is unsound: retention above 1.0 would
    let one station win more of a segment than the segment contains. Fidelity
    is part of pull now, where it competes for share and saturates like
    everything else — the antenna ladder still matters, it just cannot mint
    listeners out of nothing. */
function fidelityValue(st){ return ANT[(st || activeStation()).ant].fid; }

/** The failure state, in one line. Charged per station per day, performing or
    not — DESIGN.md's whole loss condition is that payroll plus leases outrun
    share-limited revenue. */
function leaseFor(st){
  return Math.round((BASE_LEASE + txLease(st.tx) + antLease(st.ant)) * segLeaseMul(segmentOf(st.segment)));
}
function totalLeases(){ return S.stations.reduce((a, st) => a + leaseFor(st), 0); }
function payrollTotal(){ return S.staff.reduce((a, p) => a + p.salary, 0); }

/* ---------------- mechanic 3: load and risk ---------------- */

/** loadFactor = 1 + 0.45*(djCount − 1) + SHOW_TECH[show].
    djCount is floored at 1: DESIGN writes the formula for a staffed slot, and
    letting an EMPTY slot score below 1.00 would make "fire everyone" a risk
    dodge instead of a quality decision. Both inputs are player-set, per slot,
    per turn — that is the entire point of the mechanic. */
function loadFactor(slot){
  const n = Math.max(1, crewOf(slot).length);
  return 1 + LOAD_PER_COHOST * (n - 1) + showTech(slot.show);
}
/** slotRisk = BASE_RISK * load / (1 + 0.30*engSkill), times the segment's own
    risk multiplier. An engineer divides the risk down; nothing removes it. */
/** The engineer ids on a slot, tolerant of a v3 `eng` string that has not been
    through migrate() yet (a live save loaded by an older tab, a fixture written
    by hand). Always returns an array, never null. */
function engIdsOf(slot){
  if (!slot) return [];
  if (Array.isArray(slot.engs)) {
    // Filter before testing length: a malformed save (or a caller writing
    // `engs: [null]` for "nobody") would otherwise report an engineer that is
    // not there, which silently suppresses the no-engineer post-mortem and the
    // uncovered-slots strip — a wrong ANSWER, not a crash, so nothing catches it.
    const ids = slot.engs.filter(id => typeof id === 'string' && id);
    if (ids.length) return ids.slice(0, MAX_ENG);
  }
  // Fall through to the v3 field when `engs` is absent OR present-but-empty. A
  // v4-shaped slot starts life as `engs: []`, so preferring the array whenever
  // it merely EXISTS would silently swallow any `slot.eng = id` write — which
  // is exactly what a v3-era caller, an old save loaded by a stale tab, or a
  // test that pokes state directly still does.
  return (typeof slot.eng === 'string' && slot.eng) ? [slot.eng] : [];
}

/** Combined engineer skill on a slot: best engineer at full weight, second at
    ENG_WEIGHTS[1]. Mirrors crewSkill()'s shape so the two staffing decisions
    read the same way. */
function engSkill(slot){
  const people = engIdsOf(slot)
    .map(id => personById(id))
    .filter(p => p && p.role === 'eng')
    .sort((a, b) => b.skill - a.skill);
  let sum = 0;
  for (let i = 0; i < people.length && i < MAX_ENG; i++) sum += ENG_WEIGHTS[i] * people[i].skill;
  return sum;
}

function slotRisk(slot, seg){
  const skill = engSkill(slot);
  const mul = seg ? segRiskMul(seg) : 1;
  return clamp(BASE_RISK * loadFactor(slot) * mul / (1 + ENG_RISK_DIVISOR * skill), 0.002, 0.45);
}

/* ---------------- mechanic 1: market share ---------------- */

/** The capacity a rival network currently holds in a segment, in pull units.
    Lazily seeded from the segment's opening comp base so a save that predates
    v5 — or a segment founded later — starts exactly where v4 had it. */
function rivalK(segId, netId){
  const seg = segmentOf(segId);
  const base = Math.max(1, readNum(seg.comp, 'base', 1000));
  const net = rivalNets().find(n => n.id === netId);
  const open = base * (net ? readNum(net, 'w', 0) : 0);
  if (!S.rivalNets || typeof S.rivalNets !== 'object') S.rivalNets = {};
  if (!S.rivalNets[segId] || typeof S.rivalNets[segId] !== 'object') S.rivalNets[segId] = {};
  const cur = S.rivalNets[segId][netId];
  if (typeof cur !== 'number' || !isFinite(cur)) { S.rivalNets[segId][netId] = open; return open; }
  return cur;
}

/** Read-only view of who holds a segment right now, for the UI.

    The founding card used to print seg.comp.base — the STATIC opening constant
    — as "Incumbents". Measured on a real day-139 run, that read 2000 while the
    live networks held 1049 between them: the player had squeezed the rivals to
    half their opening size and the only rival number in the game was telling
    them nothing had changed. A number that is 2x wrong in the direction that
    hides the entire v5 mechanic is worse than no number.

    Deliberately does NOT call rivalK(), which lazily seeds S.rivalNets and so
    would mutate state from a render path. Falls back to each network's opening
    size for a segment that has never been simulated, which is exactly right:
    that IS its current capacity. */
function rivalSnapshot(segId){
  const seg = segmentOf(segId);
  const base = Math.max(1, readNum(seg.comp, 'base', 1000));
  const held = (S && S.rivalNets && S.rivalNets[segId]) || {};
  const nets = rivalNets().map(net => {
    const open = base * readNum(net, 'w', 0);
    const cur = held[net.id];
    const k = (typeof cur === 'number' && isFinite(cur)) ? cur : open;
    return { id: net.id, name: net.name, icon: net.icon, k: k, open: open };
  });
  const total = nets.reduce((a, n) => a + n.k, 0);
  const open = nets.reduce((a, n) => a + n.open, 0);
  return { total: total, open: open, nets: nets };
}

/** Rival pull for a segment/daypart: the sum of what the networks in that
    market actually hold, each riding the same day-indexed wave v4 used so the
    competition still has a rhythm you can read rather than dice.

    The v4 term this replaces responded to the share you were CURRENTLY taking,
    which meant idling relaxed the competition. Capacity is remembered instead,
    so a market you walk away from is a market someone else compounds into.

    Reads nothing about revenue, cash or payroll — unchanged and load-bearing. */
function rivalPull(segId, partId){
  const seg = segmentOf(segId);
  const amp  = clamp(readNum(seg.comp, 'dayAmp', 0.2), 0, 0.6);
  let sum = 0;
  for (const net of rivalNets()) {
    // Per-network phase, so the networks do not all peak on the same day and
    // a market has a texture rather than one shared sine.
    const phase = hashPhase(segId) + hashPhase(partId) + hashPhase(net.id);
    const wave = 1 + amp * Math.sin((S.day / RIVAL_PERIOD) * Math.PI * 2 + phase);
    sum += rivalK(segId, net.id) * wave;
  }
  return Math.max(1, sum);
}

/** Move every network's capacity one day. Growth is scaled by how VACANT the
    segment is and erosion by how much of it you actually hold, which is what
    turns absence into a cost. Bounded both ways: the floor stops a market you
    dominate from becoming free forever, and the ceiling stops a market you
    ignored from locking you out permanently. */
function tickRivalCapacity(sharesBySeg){
  for (const segId of segmentIds()) {
    const held = clamp(readNum(sharesBySeg, segId, 0), 0, 1);
    const seg = segmentOf(segId);
    const base = Math.max(1, readNum(seg.comp, 'base', 1000));
    for (const net of rivalNets()) {
      const open = base * readNum(net, 'w', 0);
      if (open <= 0) continue;
      const k = rivalK(segId, net.id);
      // Clamped drift: a market you have utterly abandoned should not move
      // faster than one you merely under-serve, and a runaway share should not
      // collapse a rival in a fortnight.
      const drift = clamp(1 - held / RIVAL_TARGET, -1.5, 1);
      const next = k * (1 + RIVAL_RATE * drift);
      S.rivalNets[segId][net.id] = clamp(next, open * RIVAL_K_MIN, open * RIVAL_K_MAX);
    }
  }
}

/** pull(s,p) = PULL_SCALE · quality · reach · fidelity · segmentFit · rep · buzz.
    Audience pull only. Reputation and buzz belong here because they are why a
    listener picks you over the station one notch up the dial; cost does not
    appear anywhere in this function and must never be added to it. */
function slotPull(st, partId){
  const slot = st.schedule[partId];
  const show = SHOWS[slot.show];
  const seg = segmentOf(st.segment);
  const quality = show.appeal * djTerm(slot) * ((show.parts && show.parts[partId]) || 1);
  /* condOf(st) is the ONLY place signal condition enters the economy. It is
     deliberately applied here and not folded into `quality`, because `quality`
     is what simulateDay() averages into repPressure — see the spiral guard on
     the condition block above. */
  return PULL_SCALE * quality * reachValue(st) * fidelityValue(st) *
         segFit(seg, slot.show) * (1 + S.rep / 62) * S.buzz * condOf(st);
}

/** audience(s,p) = POP(p) · pull(s,p) / (C(p) + Σ_all_your_stations_in_segment pull).
    Your OWN stations are in that denominator, which is the whole reason
    founding can be the wrong move: two identical signals in one segment split
    one pool, leaving total audience unchanged while doubling the lease and the
    payroll. `pulls` is the pre-computed per-station pull map for this daypart
    so a four-station day is one pass, not sixteen.

    Exposed with a (station, part) signature per CONTRACT.md; the internal
    daily loop calls shareFrom() with the map it already built. */
function marketShare(st, partId){
  const pulls = new Map();
  for (const other of S.stations) if (other.segment === st.segment) pulls.set(other, slotPull(other, partId));
  return shareFrom(st, partId, pulls);
}
function shareFrom(st, partId, pulls){
  const seg = segmentOf(st.segment);
  const mine = pulls.get(st) || 0;
  let ownSum = 0;
  for (const [other, p] of pulls) if (other.segment === st.segment) ownSum += p;
  const denom = rivalPull(st.segment, partId) + ownSum;
  const share = denom > 0 ? mine / denom : 0;
  return { share, audience: segPop(seg, partId) * share, pop: segPop(seg, partId) };
}

/* ---------------- the ledger ---------------- */

/** Book a cash movement that is not one of simulateDay's own lines, and move
    the cash in the same call so the two can never disagree. `kind` is one of
    the book's line names. Every non-simulateDay spend in this file goes
    through here; ui.js's spends (gear, hire, train) do not, and do not need
    to — simulateDay reconciles any unbooked drift into capex at the open of
    the next day, so the ledger cannot silently fail to add up. */
function bookCash(delta, kind){
  if (!S || !Number.isFinite(delta)) return;
  S.cash += delta;
  const k = own(S.book, kind) ? kind : 'events';
  // Outflow lines are stored positive (they are subtracted in the identity);
  // inflow lines are stored signed.
  if (k === 'capex') {
    S.book[k] += -delta;
    // A capital purchase is a cash outflow and belongs in the expense total.
    // Leaving capex out of the statement is how a P&L reports a profitable
    // month on a month that emptied the bank (CLAUDE.md rule 2).
    S.stats.totalCosts = (S.stats.totalCosts || 0) + Math.max(0, -delta);
  }
  else S.book[k] += delta;
  S.book.closing = S.cash;
}
/** The reconciliation identity, as a number that must be ~0. The balance
    harness asserts this every simulated day; it is also the cheapest possible
    tripwire for "a new feature moved cash without telling the ledger".
    It is a WITHIN-DAY identity: simulateDay() opens a fresh book each day and
    reconciles the previous day's close against live cash, so check it after a
    simulated day, not in the middle of one. */
function ledgerDrift(){
  const b = S.book;
  return (b.opening + b.revenue + b.events + b.offline
          - b.payroll - b.royalties - b.leases - b.capex) - b.closing;
}

/* ---------------- simulation ---------------- */

/** One broadcast day across the whole empire. Returns a report object. */
function simulateDay(){
  // Anything that moved cash since yesterday's close and did not book itself
  // is player action between ticks — gear, hires, training. Capital purchases
  // ARE cash outflows and belong in the expense total; leaving them out is how
  // a statement reports profit on a day that drained the bank.
  const opening = S.book.closing;
  const drift = opening - S.cash;          // positive = money left the bank
  S.book = {
    day: S.day, opening,
    revenue: 0, payroll: 0, royalties: 0, leases: 0,
    capex: Number.isFinite(drift) ? drift : 0,
    events: 0, offline: 0, closing: S.cash
  };
  if (S.book.capex > 0) S.stats.totalCosts = (S.stats.totalCosts || 0) + S.book.capex;

  const fill = salesFill();
  const price = salesPrice();
  const repRevMul = 1 + S.rep / 140;

  let totalAudience = 0, revenue = 0, qualitySum = 0, repPressure = 0, slotCount = 0;
  let musicSlots = 0, faultCount = 0, faultRep = 0;
  let firstFault = null;
  // Per-segment audience taken, for the rival response. An audience ratio —
  // never money.
  const takenBySeg = {}, poolBySeg = {};

  for (const part of DAYPARTS) {
    // One pull pass per daypart, shared by every station in it.
    const pulls = new Map();
    for (const st of S.stations) pulls.set(st, slotPull(st, part.id));

    for (const st of S.stations) {
      const slot = st.schedule[part.id];
      const show = SHOWS[slot.show];
      const seg = segmentOf(st.segment);
      const { audience } = shareFrom(st, part.id, pulls);

      let slotRev = audience * show.adRate * AD_VALUE * fill * price * repRevMul;

      // Mechanic 3: the fault roll is per slot, and the reputation damage is
      // proportional to the LOAD the player chose, not to the revenue lost.
      // That asymmetry is the mechanic — a cheap overnight slot running three
      // co-hosts on news is where the engineer earns their salary, not the
      // expensive morning drive with one host on music.
      const load = loadFactor(slot);
      if (Math.random() < slotRisk(slot, seg)) {
        slotRev *= FAULT_REV_MUL;
        faultRep += FAULT_REP_PER_LOAD * load;
        faultCount++;
        if (!firstFault) firstFault = { call: st.call, part: part.id, load };
      }

      const quality = show.appeal * djTerm(slot) * ((show.parts && show.parts[part.id]) || 1);
      qualitySum += quality;
      repPressure += show.rep * (crewOf(slot).length ? 1 + crewSkill(slot) * 0.05 : 0.6);
      slotCount++;
      if (slot.show === 'music') musicSlots++;

      totalAudience += audience;
      revenue += slotRev;
      st.totalEarned += slotRev;

      takenBySeg[st.segment] = (takenBySeg[st.segment] || 0) + audience;
      poolBySeg[st.segment]  = (poolBySeg[st.segment]  || 0) + segPop(seg, part.id);
    }
  }

  const avgQuality = slotCount ? qualitySum / slotCount : 0;
  const avgPressure = slotCount ? repPressure / slotCount : 0;

  // v5: rivals now own capacity that remembers. S.rivals is still maintained
  // as the smoothed share you hold — the UI and the old save shape both read
  // it — but it no longer drives the denominator; tickRivalCapacity() does.
  const heldBySeg = {};
  for (const segId of segmentIds()) {
    const taken = poolBySeg[segId] ? clamp(takenBySeg[segId] / poolBySeg[segId], 0, 1) : 0;
    const cur = clamp(readNum(S.rivals, segId, 0), 0, 1);
    S.rivals[segId] = clamp(cur + (taken - cur) * RIVAL_ADAPT, 0, 1);
    heldBySeg[segId] = taken;
  }
  // Fed the RAW share, not the smoothed one: capacity is already slow, and
  // stacking a 17-day EMA in front of it would make a market you abandoned take
  // most of a month to notice.
  tickRivalCapacity(heldBySeg);

  /* Signal condition, AFTER the day's revenue is banked and after the rival
     tick. Order matters twice over: today's audience was earned at today's
     opening condition, and tickRivalCapacity() reads the shares that pull
     produced, so moving condition first would apply tomorrow's decay to
     today's market. Condition moves no cash directly — it only changes pull —
     so the ledger identity is untouched by construction. */
  const condLoad = staffSlotLoad();          // one map for the whole empire
  for (const st of S.stations) stepCondition(st, 1, condLoad);

  // Performing-rights royalties: the recurring bill every music station pays.
  // It scales with revenue and with how much of the empire's day is music,
  // which is what gives Talk and News an economic identity instead of a purely
  // reputational one.
  const musicShare = slotCount ? musicSlots / slotCount : 0;
  const royalties = revenue * 0.045 * musicShare;
  const payroll = payrollTotal();
  // Per-station leases, stamped onto the station for display and summed here.
  let leases = 0;
  for (const st of S.stations) { st.lease = leaseFor(st); leases += st.lease; }

  const costs = payroll + royalties + leases;
  const net = revenue - costs;

  S.cash += net;
  S.book.revenue = revenue;
  S.book.payroll = payroll;
  S.book.royalties = royalties;
  S.book.leases = leases;
  S.book.closing = S.cash;

  // The empire's average listeners in a daypart — the same figure v2's HUD
  // showed for one station, so the number does not silently change meaning the
  // day a second signal lights up; it just gets bigger, because there are more
  // slots on air.
  S.listeners = Math.round(totalAudience / DAYPARTS.length);

  // Reputation drifts toward what you actually put on air — no free upward
  // creep, or an unstaffed all-music station would coast into every rep gate.
  const repTarget = clamp(avgQuality * 78 + avgPressure * 14, 0, 100);
  // Recovery is PROPORTIONAL (5%/day toward target) and fault damage is
  // ADDITIVE, so the two meet at a finite gap instead of ratcheting to zero:
  // 3.6 rep below target at three stations, 12 below at ten. Bounded, checked
  // in DESIGN.md, and it must be re-verified if BASE_RISK or FAULT_REP_PER_LOAD
  // ever move.
  S.rep = clamp(S.rep + (repTarget - S.rep) * 0.05 - faultRep, 0, 100);
  // Buzz bleeds back to neutral — roughly a six-day return from a viral spike.
  S.buzz = clamp(S.buzz + (1 - S.buzz) * 0.12, BUZZ_MIN, BUZZ_MAX);
  S.day++;
  S.stats.daysOnAir++;
  // Net, not gross: the Empire tab used to report millions "earned" on a
  // station that was quietly going broke.
  S.stats.totalEarned += net;
  S.stats.totalCosts = (S.stats.totalCosts || 0) + costs;
  S.stats.peakListeners = Math.max(S.stats.peakListeners, S.listeners);
  S.lastDay = {
    listeners: S.listeners, revenue, costs, net, quality: avgQuality,
    royalties, payroll, leases, repTarget, faults: faultCount
  };

  return { fault: firstFault, faults: faultCount, net, revenue, costs };
}

function rollEvent(){
  if (S.day < 4 || Math.random() > 0.17) return null;
  const pool = EVENTS.filter(e => S.day >= e.minDay);
  if (!pool.length) return null;
  const total = pool.reduce((a, e) => a + e.w, 0);
  let r = Math.random() * total;
  const ev = pool.find(e => (r -= e.w) <= 0) || pool[0];

  const djs = staffOf('dj');
  /* content.js owns the event copy, so it owns most of the variables in it:
     {rival} {rivalCall} {co} {eng} {gear} {call} {seg} all come out of
     eventVars(S). That is a deliberate cross-file seam — the content writer
     flagged it for the integrator instead of wiring it, because a content
     file reaching into sim's roll is how the two ends drift apart.

     Worth knowing how this fails: unwired, EVENT_FALLBACKS still keeps raw
     braces off the screen, so the symptom is not a crash or a visible {brace}
     — it is every event quietly reading as generic filler forever. Nothing
     looks broken. Hence the explicit wiring and the smoke assertion.

     sim's own two are applied LAST and win: {part} and {name} are computed
     from live daypart and roster state here, and must beat anything the
     variable bag guessed independently. */
  const vars = Object.assign(
    (typeof eventVars === 'function' ? eventVars(S) : {}),
    {
      // Short form: this lands mid-sentence, not in the schedule grid.
      part: partShort(pick(DAYPARTS).id),
      name: djs.length ? pick(djs).name : 'Your overnight host'
    }
  );
  // Events write cash directly (content.js owns their bodies), so book the
  // delta by measurement rather than by asking every event to cooperate — an
  // event added later cannot forget to.
  const before = S.cash;
  ev.apply(S);
  const delta = S.cash - before;
  if (delta) { S.book.events += delta; S.book.closing = S.cash; }
  return { id: ev.id, type: ev.type, msg: t2(ev.msg, vars) };
}

function addLog(msg, kind){
  S.log.unshift({ day: S.day, msg, kind: kind || '' });
  if (S.log.length > 60) S.log.length = 60;
}

/* ---------------- expansion ---------------- */

/** The rising buildout curve (collision #9). stations.length is 1-based, so
    the cost of station N is STATION_COSTS[N-2]; past the table it keeps
    doubling rather than returning undefined and letting `cash >= undefined`
    decide a six-figure spend. */
function nextStationCost(){
  const tbl = stationCosts();
  const i = stationCount() - 1;
  if (i < 0) return tbl[0];
  if (i < tbl.length) return tbl[i];
  return tbl[tbl.length - 1] * Math.pow(2, i - tbl.length + 1);
}
function canFoundStation(){
  return !!S && S.unlockedExpansion && stationCount() < MAX_STATIONS && S.cash >= nextStationCost();
}

/** Sign on a new callsign in `segmentId`. Owns the state half of founding;
    ui.js keeps the confirm flow and calls this. Returns a result object rather
    than a bare boolean so the caller can say WHY it refused instead of a
    button that silently does nothing. */
function foundStation(segmentId){
  if (!S) return { ok: false, reason: 'nostate' };
  if (!S.unlockedExpansion) return { ok: false, reason: 'locked' };
  if (stationCount() >= MAX_STATIONS) return { ok: false, reason: 'cap' };
  if (!isSegment(segmentId)) return { ok: false, reason: 'segment' };
  const cost = nextStationCost();
  if (S.cash < cost) return { ok: false, reason: 'cash', short: cost - S.cash };

  // A dial position nobody else in the empire is already on. Bounded retry —
  // 80 legal frequencies against at most 4 stations, but an unbounded while
  // loop over a random pick is a hang waiting for a future cap change.
  const st = newStation(randomCall(), segmentId, S.day);
  for (let i = 0; i < 40 && S.stations.some(x => x.freq === st.freq); i++) {
    st.freq = (92.1 + randInt(0, 79) * 0.2).toFixed(1);
  }
  for (let i = 0; i < 40 && S.stations.some(x => x.call === st.call); i++) st.call = randomCall();

  bookCash(-cost, 'capex');
  S.stations.push(st);
  S.stats.stationsFounded = stationCount();
  S.active = stationCount() - 1;
  // Deliberately NOT the v2 'foundedMsg' key: that string says the new station
  // is "feeding the network", which described the 32%-of-your-own-revenue block
  // this overhaul deleted. Reusing the key would have printed a sentence that
  // is now false. New key, new sentence — content-writer owns the wording.
  addLog(tOr('foundedStationMsg', 'You signed on {call} in {seg}.',
    { call: st.call, seg: segmentOf(segmentId).name }), 'big');
  return { ok: true, station: st, cost };
}

function checkUnlock(){
  if (!S.unlockedExpansion && S.cash >= UNLOCK_CASH && S.rep >= UNLOCK_REP) {
    S.unlockedExpansion = true;
    addLog('Expansion unlocked — you can found a second station.', 'big');
    toast('🏆 ' + t('unlockedTitle'), 'good');
    sfxOnAir();
    // Honour the Event popups setting exactly like the random-event branch —
    // the log line, the sting and the Empire tab badge already tell a
    // popup-off player that the expansion landed.
    if (S.opts.eventPopups) {
      modalPause();
      openModal(
        t('unlockedTitle'),
        t('unlockedSub', { cost: money(nextStationCost()) }),
        '<p style="font-size:13px;color:var(--muted);margin-top:10px">' + esc(t('foundStationNote', { amt: money(nextStationCost()) })) + '</p>',
        [{ label: t('close'), cls: 'buy', act: dismissAutoModal }]
      );
    }
    return true;
  }
  return false;
}

// Lives with the sim, not the Staff tab that displays it: tick() calls this
// on the weekly hire refresh, and the design gate's scarce resource depends on
// candidate throughput NOT scaling with station count — the harness asserts
// exactly that against this function. Two to three a week, forever, whether
// you run one signal or four. That flatness IS the scarcity: person-hours per
// daypart do not grow when the empire does.
function refreshCandidates(){
  const n = randInt(2, 3);
  S.candidates = [];
  const roles = ['dj', 'eng', 'sales'];
  for (let i = 0; i < n; i++) S.candidates.push(makePerson(pick(roles), S.rep));
  // Always keep a DJ available early — the game is unreadable without one.
  if (S.day < 12 && !S.candidates.some(c => c.role === 'dj')) S.candidates[0] = makePerson('dj', S.rep);
  // And an engineer has to be REACHABLE, not merely possible: the whole third
  // mechanic (and the news segment) is dead without one, and "the starting
  // roster lacked the one role required to finish a job" is the exact
  // unwinnable-by-omission bug CLAUDE.md rule 2 was written for. By day 21 a
  // player with no engineer on payroll is guaranteed one on the board.
  if (S.day >= 14 && !staffOf('eng').length && !S.candidates.some(c => c.role === 'eng')) {
    S.candidates[S.candidates.length - 1] = makePerson('eng', S.rep);
  }
}

/* ---------------- assignment (sim owns the invariants) ----------------

   Two hard constraints, both empire-wide, both enforced here rather than in
   ui.js — a rule that lives in the renderer is a rule the next renderer
   forgets:
     - ONE engineer covers ONE daypart across the WHOLE empire. E engineers
       cover at most E of your S same-daypart slots.
     - A DJ appears on at most one station per daypart. Same person, same hour,
       one place. Fatigue still counts their total daily load.
   Both mutators return the slot they STOLE from, so ui can say "assigning
   them here takes them off KXYZ morning" instead of silently moving someone. */

function slotAt(stationIdx, partId){
  const st = S.stations[stationIdx];
  if (!st || !st.schedule[partId]) return null;
  return st.schedule[partId];
}

function setSlotShow(stationIdx, partId, showKey){
  const slot = slotAt(stationIdx, partId);
  if (!slot || !SHOWS[showKey]) return false;
  slot.show = showKey;
  return true;
}

/** Add a DJ to a slot, lead first, cap three. Returns { ok, stole } where
    stole is { call, part } if they were pulled off another station's slot in
    the same daypart. */
function addDj(stationIdx, partId, staffId){
  const slot = slotAt(stationIdx, partId);
  const p = personById(staffId);
  if (!slot || !p || p.role !== 'dj') return { ok: false, reason: 'role' };
  if (slot.djs.indexOf(staffId) >= 0) return { ok: false, reason: 'already' };
  if (slot.djs.length >= MAX_CREW) return { ok: false, reason: 'full' };
  let stole = null;
  for (let i = 0; i < S.stations.length; i++) {
    if (i === stationIdx) continue;
    const other = S.stations[i].schedule[partId];
    const at = other ? other.djs.indexOf(staffId) : -1;
    if (at >= 0) { other.djs.splice(at, 1); stole = { call: S.stations[i].call, part: partId }; }
  }
  slot.djs.push(staffId);
  return { ok: true, stole };
}
function removeDj(stationIdx, partId, staffId){
  const slot = slotAt(stationIdx, partId);
  if (!slot) return false;
  const at = slot.djs.indexOf(staffId);
  if (at < 0) return false;
  slot.djs.splice(at, 1);
  return true;
}
/** Add an engineer to a slot, up to MAX_ENG. Returns { ok, stole } where stole
    is { call, part } if they were pulled off another station's slot in the same
    daypart — the one-person-one-daypart rule is unchanged by v4, only the
    number of engineers a single slot may hold. */
function addEngineer(stationIdx, partId, staffId){
  const slot = slotAt(stationIdx, partId);
  const p = personById(staffId);
  if (!slot) return { ok: false, reason: 'slot' };
  if (!p || p.role !== 'eng') return { ok: false, reason: 'role' };
  if (!Array.isArray(slot.engs)) slot.engs = engIdsOf(slot);
  if (slot.engs.indexOf(staffId) >= 0) return { ok: false, reason: 'already' };
  if (slot.engs.length >= MAX_ENG) return { ok: false, reason: 'full' };
  let stole = null;
  for (let i = 0; i < S.stations.length; i++) {
    if (i === stationIdx) continue;
    const other = S.stations[i].schedule[partId];
    if (!other) continue;
    if (!Array.isArray(other.engs)) other.engs = engIdsOf(other);
    const at = other.engs.indexOf(staffId);
    if (at >= 0) { other.engs.splice(at, 1); stole = { call: S.stations[i].call, part: partId }; }
  }
  slot.engs.push(staffId);
  return { ok: true, stole };
}

/** Remove one engineer from a slot. */
function removeEngineer(stationIdx, partId, staffId){
  const slot = slotAt(stationIdx, partId);
  if (!slot) return false;
  if (!Array.isArray(slot.engs)) slot.engs = engIdsOf(slot);
  const at = slot.engs.indexOf(staffId);
  if (at < 0) return false;
  slot.engs.splice(at, 1);
  return true;
}

/** v3 entry point, kept so an older ui.js cannot silently no-op: passing null
    clears the slot, passing an id makes them the ONLY engineer on it. */
function setSlotEngineer(stationIdx, partId, staffId){
  const slot = slotAt(stationIdx, partId);
  if (!slot) return { ok: false, reason: 'slot' };
  if (!staffId) { slot.engs = []; return { ok: true, stole: null }; }
  slot.engs = [];
  return addEngineer(stationIdx, partId, staffId);
}
/** Scrub someone off every schedule in the empire. firePerson() in ui.js must
    call this — a v2-shaped scrub over one station leaves a fired DJ counting
    toward crewSkill on the other three. */
function scrubStaffFromSchedules(id){
  for (const st of S.stations) {
    for (const part of DAYPARTS) {
      const slot = st.schedule[part.id];
      const at = slot.djs.indexOf(id);
      if (at >= 0) slot.djs.splice(at, 1);
      if (!Array.isArray(slot.engs)) slot.engs = engIdsOf(slot);
      const ea = slot.engs.indexOf(id);
      if (ea >= 0) slot.engs.splice(ea, 1);
    }
  }
}
/** Every slot in the empire with no engineer on it, for the "uncovered slots
    today" strip — the one empire-wide view that keeps the assignment surface
    sub-linear in stations (producer condition #2). */
function uncoveredSlots(){
  const out = [];
  for (let i = 0; i < S.stations.length; i++) {
    const st = S.stations[i];
    for (const part of DAYPARTS) {
      const slot = st.schedule[part.id];
      if (!engIdsOf(slot).length) out.push({ station: i, call: st.call, part: part.id, load: loadFactor(slot), risk: slotRisk(slot, segmentOf(st.segment)) });
    }
  }
  // Worst exposure first — that is the decision the strip exists to inform.
  return out.sort((a, b) => b.risk - a.risk);
}

/* ---------------- game loop ---------------- */

let running = false;

function tick(){
  if (!S) return;
  // One bad day of arithmetic used to leave a dead interval firing forever.
  // Any throw in here stops the clock and tells the player, rather than
  // spamming the console and looking like a frozen station.
  try {
    const rep = simulateDay();

    // Hard cash floor — payroll and leases outrunning revenue can no longer
    // spiral into arbitrary negative numbers forever. Check this before
    // anything else this tick so a bankrupting day can't also open an
    // event/unlock modal under it.
    if (S.cash <= BANKRUPTCY_FLOOR) {
      render();
      triggerBankruptcy();
      return;
    }

    if (rep.fault) {
      const msg = tOr('faultMsg', 'A fault hit {call} {part} — the load was {load}x and nobody was on the desk.', {
        call: rep.fault.call, part: partShort(rep.fault.part), load: rep.fault.load.toFixed(2)
      });
      addLog(msg, 'bad');
      toast('⚠️ ' + msg, 'bad');
      if (typeof sfxFault === 'function') sfxFault(); else sfxDeadAir();
    }

    const ev = rollEvent();
    if (ev) {
      addLog(ev.msg, ev.type);
      if (ev.type === 'good') sfxOnAir(); else sfxTrouble();
      // Only bad news (or anything in the tutorial stretch) is worth stopping
      // the clock for. Good news past day 30 toasts instead, so a long run
      // isn't a sequence of "click OK to continue earning".
      if (S.opts.eventPopups && (ev.type === 'bad' || S.day < 30)) {
        modalPause();
        openModal(
          ev.type === 'good' ? '📻 Good news' : '📻 Trouble',
          ev.msg, '',
          [{ label: t('resume'), cls: 'buy', act: dismissAutoModal }]
        );
      } else {
        toast((ev.type === 'good' ? '📈 ' : '📉 ') + ev.msg, ev.type);
      }
    }

    // Day-stamped rather than modulo-7, so an offline catch-up that jumps the
    // day counter past a multiple of 7 can't silently skip a talent refresh.
    if (S.day >= S.nextHireDay) { refreshCandidates(); S.nextHireDay = S.day + 7; }
    // Autosave is wall-clock now (see startAllTimers), not day-counted.
    // checkUnlock() may itself open a modal (queued behind the event modal
    // above, if one is already open — see openModal/dismissAutoModal).
    checkUnlock();
    // Snapshot yesterday's HUD numbers so render() can chip the change.
    noteHudDeltas();
    render();
    S.lastTick = Date.now();
  } catch (err) {
    console.error('Callsigns tick failed:', err);
    stopAllTimers();
    // Blocking, and it takes the screen: stopAllTimers() has just killed the
    // clock for good, so Escape or a backdrop click on a dismissable fault
    // modal left the player looking at a game screen that would never tick
    // again. Its one button is the only way out. `replace` (plus clearing the
    // queue) is what puts it in front of an event modal that was already up
    // when the tick threw, instead of behind it.
    modalQueue.length = 0;
    openModal('Broadcast fault', 'Something went wrong in the simulation.', '',
      [{ label: t('mainMenu'), cls: 'danger', act: () => {
          // Deliberately neither saves nor wipes — the last good autosave is
          // the player's way back in, and this state is the one that threw.
          returnToMenu();
        } }],
      { blocking: true, replace: true }
    );
  }
}

/** Why the run actually ended.

    content.js authors six post-mortems — causeOverExpanded, causeTalentThin,
    causeGearHeavy, causeAdsOnly, causeNoEngineer, causeQuiet — and until this
    existed not one of them reached a screen. They were not broken; nothing
    called them. A bankrupt player got "you ran out of money", which they had
    worked out, and none of the diagnosis the copy was written to deliver.

    Read the corpse rather than keep a running tally: a counter maintained
    across the run is one more thing that can drift out of step with the
    station, and the state at the moment of death is exactly the evidence.

    Order is most-specific-first, and it is a judgement, not an accident: a
    losing run usually fits two or three of these at once, so the one that
    fires should be the one the player could most directly have changed. The
    last is unconditional, so this always names something. */
function bankruptCause(){
  const sts = S.stations || [];
  const slots = sts.length * DAYPARTS.length;
  let adsSlots = 0, engAssigned = 0, maxTx = 0;
  const staffedPerStation = sts.map(st => {
    let n = 0;
    DAYPARTS.forEach(p => {
      const sl = st.schedule && st.schedule[p.id];
      if (!sl) return;
      if (sl.djs && sl.djs.length) n++;
      engAssigned += engIdsOf(sl).length;
      if (sl.show === 'ads') adsSlots++;
    });
    maxTx = Math.max(maxTx, st.tx || 0);
    return n;
  });
  const djs = (S.staff || []).filter(p => p.role === 'dj').length;

  // Paying rent on a signal that aired nothing is the most expensive mistake
  // available, and the easiest to have not made.
  if (sts.length >= 2 && staffedPerStation.some(n => n === 0))
    return { key: 'causeOverExpanded', vars: { n: sts.length } };
  // ads pays today and burns the rep the ad rate multiplies by.
  if (slots > 0 && adsSlots / slots >= 0.5)
    return { key: 'causeAdsOnly', vars: {} };
  /* Signal rot, ahead of the no-engineer line and ahead of causeQuiet. When a
     run dies with its transmitters near the floor, that IS the cause — naming
     "you never hired an engineer" or "you went quiet" instead would point the
     player at a symptom. Sited after over-expansion and all-ads because those
     are more specific mistakes that also produce rot. */
  const worstCond = sts.length ? Math.min.apply(null, sts.map(condOf)) : 1;
  if (worstCond <= COND_MIN + 0.05)
    return { key: 'causeSignalRot', vars: { pct: Math.round(worstCond * 100) } };
  if (slots > 0 && engAssigned === 0)
    return { key: 'causeNoEngineer', vars: {} };
  // Reach you cannot sell is just a bigger lease.
  if (maxTx >= 3 && S.rep < 40)
    return { key: 'causeGearHeavy', vars: {} };
  if (slots > 0 && djs < slots * 0.5)
    return { key: 'causeTalentThin', vars: { n: djs, slots: slots } };
  return { key: 'causeQuiet', vars: {} };
}

/** Cash has run dry for good. Ends the run: the save is cleared so a fresh
    station starts clean rather than reloading straight back into the same
    unrecoverable spiral. */
function triggerBankruptcy(){
  pauseTick();
  // The run is over: mark it dead so no autosave/unload path can write the
  // corpse back to disk, and clear anything queued so a stray event modal
  // can't pop up on top of the ending.
  S.dead = true;
  modalQueue.length = 0;
  sfxBankrupt();
  addLog(t('bankruptSub', { call: S.stations[0].call }), 'bad');
  const why = bankruptCause();
  openModal(
    '📉 ' + t('bankruptTitle'),
    t('bankruptSub', { call: S.stations[0].call }),
    // The diagnosis reads as body text, not as a footnote — it is the part
    // the player did not already know.
    '<p style="font-size:13px;margin-top:10px">' + esc(t(why.key, why.vars)) + '</p>' +
    '<p style="font-size:13px;color:var(--muted);margin-top:10px">' + esc(t('bankruptNote')) + '</p>',
    [{ label: t('mainMenu'), cls: 'danger', act: () => returnToMenu({ wipe: true }) }],
    { blocking: true }
  );
}

/* One dispatcher for the sim clock plus one for the 30s wall-clock autosave —
   both handles live at the top of the file and both are cleared together, per
   CLAUDE.md's interval-hygiene rule. pauseTick/resumeTick deliberately touch
   only the sim clock, so a modal being up never costs you an autosave. */
function stopAllTimers(){
  stopTick();
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = null;
  running = false;
  setPausedUI();
}
/** The ONE way back to the main menu. Five call sites used to inline this
    sequence by hand — the tick-failure fault, bankruptcy, the capstone, the
    pause menu and Delete save — and the pause menu's copy had drifted: it
    forgot `S = null`. That left the abandoned run installed, so the Settings
    screen kept writing to the dead run's S.opts and then mirrored it over the
    persisted globals (toggling Sound silently flipped eventPopups on disk).
    opts: { save } writes the run out first, { wipe } deletes it instead. */
function returnToMenu(opts){
  const o = opts || {};
  if (o.save) saveGame(true);
  if (o.wipe) wipeSave();
  closeAllModals();
  stopAllTimers();
  S = null;
  showScreen('menu');
  refreshMenu();
}
function startAllTimers(){
  stopAllTimers();
  if (!S) return;
  running = true;
  timer = setInterval(tick, SPEEDS[S.opts.speed] || SPEEDS[1]);
  autosaveTimer = setInterval(() => { if (S && !S.dead && S.opts.autosave) saveGame(true); }, 30000);
  setPausedUI();
}

function startTick(){
  if (!S) return;
  // The sim starts advancing NOW, so the stretch that just ended — a modal, the
  // pause menu, a gamepad-X pause — is not offline time. Without this stamp a
  // game left paused in a *visible* tab kept its hours-old lastTick: closing the
  // tab before the first tick() could refresh it saved that stale stamp, and the
  // next Continue paid out for time the player spent staring at a paused screen.
  // (saveGame() covers the still-paused case; this covers the resumed one.)
  S.lastTick = Date.now();
  stopTick();
  running = true;
  timer = setInterval(tick, SPEEDS[S.opts.speed] || SPEEDS[1]);
  setPausedUI();
}
function stopTick(){ if (timer) clearInterval(timer); timer = null; }
function pauseTick(){ running = false; stopTick(); setPausedUI(); }
function resumeTick(){ if (!running) startTick(); setPausedUI(); }

/** Stop the clock for a modal, but only claim the resume if the clock was
    actually running: autoPaused means "this modal owes the sim a restart".
    Setting it unconditionally made every modal hand back a clock it never
    took — pause with gamepad X, open a slot editor or a confirm dialog, close
    it, and the game was quietly running again with the paused badge gone.

    RAISE the flag, never lower it. Two modals routinely land on one tick — a
    random event popup, then checkUnlock()'s expansion popup queued behind it —
    and the second call runs with the clock already stopped by the first, so
    wasRunning is false there. Assigning cleared the first modal's claim: the
    player drained the whole queue and closeModal saw autoPaused===false, so the
    station sat on the game screen with the ⏸ chip up and no clock, with no way
    back short of the main menu (the pause menu's own Resume captures the same
    already-false `running`). */
function modalPause(){
  const wasRunning = running;
  pauseTick();
  if (wasRunning) autoPaused = true;
}

/** The only paused indicator in the game — a stopped clock has to look
    stopped, or a frozen sim reads as a working one. */
function setPausedUI(){
  const el = $('hud-paused');
  if (el) el.hidden = !!running;
}


/* ---------------- save / load ---------------- */

function saveGame(silent){
  // A bankrupt station is a finished run — never let an autosave or an
  // unload handler write it back and reload the player into the corpse.
  if (!S || S.dead) return false;
  try {
    // S.lastTick means "when the SIM last advanced", never "when we last
    // saved". Stamping it here neutered offline catch-up entirely: the 30s
    // autosave keeps firing behind a hidden tab, so four hours backgrounded
    // plus one autosave granted $0 on return and only a hard tab close ever
    // paid out (CLAUDE.md line 16). tick() owns the stamp now.
    //
    // The one exception, and it is the same rule read the other way: a *paused*
    // game isn't accruing offline time either, so while the clock is stopped
    // under the player's control keep the stamp fresh. Otherwise sitting in the
    // pause menu for an hour and then hitting Main Menu would bank an hour of
    // unattended pay. Backgrounding deliberately leaves `running` true (see the
    // visibilitychange handler), so a hidden tab still accrues.
    if (!running) S.lastTick = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
    if (!silent) toast('💾 ' + t('saved'), 'good');
    return true;
  } catch (e) {
    // Private browsing / full quota: say it once. The old code raised a raw
    // QuotaExceededError toast every 30 seconds and again on every unload.
    if (!saveBroken) {
      saveBroken = true;
      toast("Progress can't be saved in this browser mode — your station will be lost when you close the tab.", 'bad');
    }
    return false;
  }
}
function loadGame(){
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return migrate(data);
  } catch (e) { return null; }
}

/** Rebuild a live state from a saved one, whatever version it claims, and run
    on EVERY load rather than once: a save written before a field existed comes
    back without it, and a bare read is undefined.

    The old version did `Object.assign({}, base, data)`. That is the exact
    footgun CLAUDE.md's settings section documents on the trivia server: a
    JSON-parsed own '__proto__' passes straight through [[Set]] and reparents
    the state object, and every nested merge inherited the same hole. Nothing
    below merges — every field is named, read through own(), coerced, and
    written into a fresh object. Unknown keys in the save simply do not appear
    in the result. */
function migrate(data){
  const v = readNum(data, 'v', 1);
  // A save from a newer build: degrade to "no save" rather than half-load it.
  if (v > STATE_VER) return null;

  const s = newState(readStr(data, 'call', undefined));

  s.day       = readNum(data, 'day', 1);
  s.cash      = readNum(data, 'cash', 800);
  s.listeners = readNum(data, 'listeners', 40);
  s.rep       = readNum(data, 'rep', 5);
  s.buzz      = readNum(data, 'buzz', 1);
  s.nextHireDay = readNum(data, 'nextHireDay', s.day + 7);
  s.lastTick  = readNum(data, 'lastTick', Date.now());
  s.unlockedExpansion = readBool(data, 'unlockedExpansion', false);
  s.seenExpansion     = readBool(data, 'seenExpansion', false);
  s.seenIntro         = readBool(data, 'seenIntro', false);
  s.active            = readNum(data, 'active', 0);

  // Arrays are forced with Array.isArray — a save carrying `staff: {}` used to
  // reach .filter() and throw on the load path, which reads to the player as
  // "Continue does nothing".
  s.staff      = Array.isArray(data.staff) ? data.staff.slice() : [];
  s.candidates = Array.isArray(data.candidates) ? data.candidates.slice() : [];
  s.log        = Array.isArray(data.log) ? data.log.slice(0, 60) : [];

  for (const k of ['speed', 'autosave', 'eventPopups', 'reducedMotion', 'sound']) {
    if (own(data.opts, k)) s.opts[k] = (k === 'speed') ? readNum(data.opts, k, 1) : readBool(data.opts, k, true);
  }
  for (const k of ['totalEarned', 'totalCosts', 'peakListeners', 'daysOnAir', 'stationsFounded']) {
    s.stats[k] = readNum(data.stats, k, s.stats[k]);
  }
  for (const k in s.lastDay) s.lastDay[k] = readNum(data.lastDay, k, 0);
  for (const k in s.book) s.book[k] = readNum(data.book, k, 0);

  // Rival pressure is a dictionary keyed by segment id — drop every key that
  // is not a segment we know about, rather than carrying a stale content row
  // into a divisor.
  s.rivals = {};
  for (const id of segmentIds()) s.rivals[id] = clamp(readNum(data.rivals, id, 0), 0, 1);
  // Rival CAPACITY (v5): known segments and known networks only, each clamped
  // into the band its opening size defines. A stale content row or a
  // hand-edited save must not be able to plant an unbounded divisor — that is
  // the same class of hole the [0,1] clamp closes for pressure.
  {
    const src = (data.rivalNets && typeof data.rivalNets === 'object') ? data.rivalNets : {};
    const out = {};
    for (const id of segmentIds()) {
      const seg = segmentOf(id);
      const base = Math.max(1, readNum(seg.comp, 'base', 1000));
      const row = (src[id] && typeof src[id] === 'object') ? src[id] : {};
      out[id] = {};
      for (const net of rivalNets()) {
        const open = base * readNum(net, 'w', 0);
        if (open <= 0) continue;
        const raw = row[net.id];
        out[id][net.id] = (typeof raw === 'number' && isFinite(raw))
          ? clamp(raw, open * RIVAL_K_MIN, open * RIVAL_K_MAX) : open;
      }
    }
    s.rivalNets = out;
  }

  if (v >= 3) {
    // v3 -> v3: read the stations array field by field.
    const list = Array.isArray(data.stations) ? data.stations : [];
    s.stations = [];
    for (const raw of list.slice(0, MAX_STATIONS)) {
      s.stations.push(readStation(raw, s.day));
    }
    if (!s.stations.length) s.stations = [ newStation(undefined, DEFAULT_SEGMENT, 1) ];
  } else {
    /* v2 -> v3, the policy decided in DESIGN.md rather than in code review:

       - the run wraps into stations[0] unchanged: call, freq, tx, ant and the
         schedule carry over, and each slot's single `dj` string becomes
         djs:[id] with eng:null. Nobody loses a station, a callsign or a tier
         of gear.
       - a founded v2 `secondStation` becomes a REAL stations[1] in the
         flagship's segment, with the v2 default schedule and NO staff of its
         own — staff stay exactly where they were, global — on Part 15/whip
         gear. Its revenue was always fiction (a flat 32% cut of the flagship's
         own take, the self-reference the overhaul exists to delete), so it
         restarts as a real signal rather than inheriting invented gear it
         never had. It keeps its callsign and its founding day.

       v1 saves wrap through the same path: v1 had no secondStation and the
       same flat schedule, so there is nothing extra to do for them. */
    const st0 = newStation(readStr(data, 'call', undefined), DEFAULT_SEGMENT, 1);
    st0.freq = readStr(data, 'freq', st0.freq);
    st0.tx = readNum(data, 'tx', 0);
    st0.ant = readNum(data, 'ant', 0);
    st0.schedule = {};
    for (const p of DAYPARTS) {
      const src = own(data.schedule, p.id) ? data.schedule[p.id] : null;
      const dj = readStr(src, 'dj', null);
      st0.schedule[p.id] = {
        show: SHOWS[readStr(src, 'show', '')] ? src.show : defaultSchedule()[p.id].show,
        djs: dj ? [dj] : [],
        eng: null
      };
    }
    st0.totalEarned = readNum(data.stats, 'totalEarned', 0);
    s.stations = [st0];

    if (data.secondStation && typeof data.secondStation === 'object') {
      const st1 = newStation(readStr(data.secondStation, 'call', undefined), DEFAULT_SEGMENT,
        readNum(data.secondStation, 'foundedDay', 1));
      st1.totalEarned = readNum(data.secondStation, 'totalEarned', 0);
      s.stations.push(st1);
      s.stats.stationsFounded = 2;
    }
  }

  s.v = STATE_VER;
  return sanitize(s);
}

/** Read one station out of untrusted data. Never returns a partial object:
    everything the sim divides by or indexes with is coerced here, so
    sanitize() below is a second belt rather than the only one. */
function readStation(rawIn, day){
  // A null or a string in the stations array is valid JSON and would throw on
  // the first property read; it degrades to a default station instead.
  const raw = (rawIn && typeof rawIn === 'object') ? rawIn : {};
  const st = newStation(readStr(raw, 'call', undefined), readStr(raw, 'segment', DEFAULT_SEGMENT), readNum(raw, 'foundedDay', day || 1));
  st.freq = readStr(raw, 'freq', st.freq);
  st.tx = readNum(raw, 'tx', 0);
  st.ant = readNum(raw, 'ant', 0);
  // v6. A v<=5 save has no `cond`; readNum's default hands it a pristine 1.00
  // rather than a 0, which would have read as a dead transmitter on load.
  st.cond = clamp(readNum(raw, 'cond', 1), COND_MIN, 1);
  st.lease = readNum(raw, 'lease', 0);
  st.totalEarned = readNum(raw, 'totalEarned', 0);
  const base = defaultSchedule();
  st.schedule = {};
  for (const p of DAYPARTS) {
    const src = own(raw.schedule, p.id) ? raw.schedule[p.id] : null;
    const djs = (src && Array.isArray(src.djs)) ? src.djs.filter(x => typeof x === 'string').slice(0, MAX_CREW) : [];
    // A v2-shaped slot that somehow claims v3: take the single dj too rather
    // than dropping the assignment on the floor.
    const legacyDj = readStr(src, 'dj', null);
    if (!djs.length && legacyDj) djs.push(legacyDj);
    /* v4+: a slot carries `engs` (up to MAX_ENG ids). This read ONLY the v3
       `eng` field and dropped `engs` on the floor, so every engineer in the
       empire was silently unassigned on every single load — the save was
       written correctly and thrown away by the reader. sanitize() has the
       correct v3->v4 widening below, but it ran on the wreckage and found
       neither field. The tell was that a v3 save survived and a current one did
       not, because v3 is the exact shape this line reads.

       Carry the array through and let sanitize() do the validation (staff
       existence, per-slot dedupe, same-daypart uniqueness, MAX_ENG). */
    const rawEngs = Array.isArray(src && src.engs)
      ? src.engs.filter(x => typeof x === 'string' && x).slice(0, MAX_ENG)
      : [];
    const legacyEng = readStr(src, 'eng', null);
    if (!rawEngs.length && legacyEng) rawEngs.push(legacyEng);
    st.schedule[p.id] = {
      show: SHOWS[readStr(src, 'show', '')] ? src.show : base[p.id].show,
      djs,
      engs: rawEngs
    };
  }
  return st;
}

/* Ceiling on a single day's net when it comes off disk. Not a balance number —
   a defensive bound, and deliberately far above anything reachable: the empire
   policy's p90 run averages roughly $4k/day across 540 days, so $1,000,000
   leaves three orders of magnitude of headroom for any future economy while
   still bounding catchUp()'s offline payout to a finite figure. Lives here
   rather than in content.js because it guards the load path, not the design. */
const LASTDAY_NET_MAX = 1e6;

/** Coerce every field the sim divides, compares or renders. Runs on both the
    load path and the new-game path so there is exactly one shape of state.
    Clamps ranges, not just types: a well-typed `cash: -500000` or a
    `stations: []` is valid JSON and would still be an unplayable run. */
function sanitize(s){
  // null and '' both coerce to 0 through unary +, which would silently turn a
  // missing field into a real zero (a null cash became $0, not the default).
  const n = (x, d) => (x === null || x === '' || !Number.isFinite(+x)) ? d : +x;

  s.v         = STATE_VER;
  s.cash      = clamp(n(s.cash, 800), -1e12, 1e15);
  s.listeners = Math.max(0, Math.round(n(s.listeners, 40)));
  s.rep       = clamp(n(s.rep, 5), 0, 100);
  s.buzz      = clamp(n(s.buzz, 1), BUZZ_MIN, BUZZ_MAX);
  s.day       = Math.max(1, Math.floor(n(s.day, 1)));
  // Never more than a week out, or a junk value could stall hiring forever.
  s.nextHireDay = clamp(Math.floor(n(s.nextHireDay, s.day + 7)), 1, s.day + 7);
  s.opts.speed = SPEEDS[s.opts.speed] ? +s.opts.speed : 1;
  s.seenExpansion = !!s.seenExpansion;
  s.seenIntro     = !!s.seenIntro;
  // The gate flag every Empire branch and sceneTier()'s floor read. A truthy
  // string here used to survive as a string; harmless by accident, not by rule.
  s.unlockedExpansion = !!s.unlockedExpansion;
  // Forced false, not coerced: triggerBankruptcy() wipes the save and saveGame()
  // refuses to write a dead run, so `dead` can only reach a load path through
  // corruption or hand-editing — and a truthy one lands the player on the game
  // screen with no clock, no autosave and nothing that will ever resume it.
  s.dead = false;

  s.staff = Array.isArray(s.staff) ? s.staff.filter(p =>
      p && typeof p.id === 'string' && ROLES[p.role] && Number.isFinite(+p.skill)
    ).map(p => {
      const skill = clamp(Math.round(+p.skill), 1, 10);
      const tags = (Array.isArray(p.tags) ? p.tags : []).filter(x => typeof x === 'string' && own(chemTable(), x)).slice(0, 1);
      return {
        id: String(p.id), name: String(p.name || 'Unknown'),
        role: p.role, skill,
        // A person saved before chemistry existed gets a tag on load rather
        // than a missing one the pairing code then has to null-check forever.
        tags: tags.length ? tags : [pick(chemTags())],
        salary: Number.isFinite(+p.salary) ? clamp(+p.salary, 0, 1e6) : salaryFor(p.role, skill)
      };
    }) : [];
  // Duplicate ids would make firing one person leave the other behind, and
  // crewSkill would count them twice.
  const seenIds = new Set();
  s.staff = s.staff.filter(p => (seenIds.has(p.id) ? false : (seenIds.add(p.id), true)));

  s.log        = Array.isArray(s.log) ? s.log.slice(0, 60).filter(e => e && typeof e === 'object').map(e => ({
    day: Math.max(1, Math.floor(n(e.day, 1))), msg: String(e.msg || ''), kind: String(e.kind || '')
  })) : [];
  s.candidates = Array.isArray(s.candidates)
    ? s.candidates.filter(p => p && ROLES[p.role] && typeof p.id === 'string' && Number.isFinite(+p.skill))
        .map(p => Object.assign({}, p, {
          skill: clamp(Math.round(+p.skill), 1, 10),
          tags: (Array.isArray(p.tags) && typeof p.tags[0] === 'string' && own(chemTable(), p.tags[0])) ? [p.tags[0]] : [pick(chemTags())]
        }))
    : [];

  s.stats = s.stats && typeof s.stats === 'object' ? s.stats : {};
  s.stats.totalEarned   = n(s.stats.totalEarned, 0);
  s.stats.totalCosts    = Math.max(0, n(s.stats.totalCosts, 0));
  s.stats.daysOnAir     = Math.max(0, Math.floor(n(s.stats.daysOnAir, 0)));
  s.stats.peakListeners = Math.max(s.listeners, Math.round(n(s.stats.peakListeners, s.listeners)));
  s.stats.stationsFounded = Math.max(1, Math.floor(n(s.stats.stationsFounded, 1)));

  // Every lastDay field is divided, compared or rendered somewhere, and one of
  // them decides money: catchUp() multiplies the offline payout by lastDay.net,
  // so a string "120" from a truncated save banked NaN cash and a NaN day
  // counter. Rebuilt from a fixed key list rather than coerced in place, so a
  // junk key can't ride along.
  /* Typed is not enough for net: it is the ONLY lastDay field that mints cash.
     n() rejects NaN and strings but happily passes a well-typed 1e300, which
     catchUp() then multiplies by up to OFFLINE_MAX_DAYS — a hostile save
     reached $4.8e301 in live cash that way. Clamp it to a day's worth of money
     the game could actually produce; every other field is display-only. */
  const ld = (s.lastDay && typeof s.lastDay === 'object') ? s.lastDay : {};
  s.lastDay = {};
  for (const k of ['listeners','revenue','costs','net','quality','royalties','payroll','leases','repTarget','faults']) {
    s.lastDay[k] = n(ld[k], 0);
  }
  s.lastDay.net = clamp(s.lastDay.net, -LASTDAY_NET_MAX, LASTDAY_NET_MAX);
  const bk = (s.book && typeof s.book === 'object') ? s.book : {};
  s.book = {};
  for (const k of ['day','opening','revenue','payroll','royalties','leases','capex','events','offline','closing']) {
    s.book[k] = n(bk[k], 0);
  }
  // The ledger anchors on cash, not the other way round: a hand-edited or
  // half-written book must never be able to invent money on the next day's
  // drift calculation.
  s.book.closing = s.cash;
  s.book.day = s.day;

  // Rival pressure: known segment keys only, clamped into the bound the whole
  // no-death-spiral argument rests on.
  const rv = (s.rivals && typeof s.rivals === 'object') ? s.rivals : {};
  s.rivals = {};
  for (const id of segmentIds()) s.rivals[id] = clamp(n(rv[id], 0), 0, 1);
  // Rival CAPACITY (v5): known segments and known networks only, each clamped
  // into the band its opening size defines. A stale content row or a
  // hand-edited save must not be able to plant an unbounded divisor — that is
  // the same class of hole the [0,1] clamp closes for pressure.
  {
    const src = (s.rivalNets && typeof s.rivalNets === 'object') ? s.rivalNets : {};
    const out = {};
    for (const id of segmentIds()) {
      const seg = segmentOf(id);
      const base = Math.max(1, readNum(seg.comp, 'base', 1000));
      const row = (src[id] && typeof src[id] === 'object') ? src[id] : {};
      out[id] = {};
      for (const net of rivalNets()) {
        const open = base * readNum(net, 'w', 0);
        if (open <= 0) continue;
        const raw = row[net.id];
        out[id][net.id] = (typeof raw === 'number' && isFinite(raw))
          ? clamp(raw, open * RIVAL_K_MIN, open * RIVAL_K_MAX) : open;
      }
    }
    s.rivalNets = out;
  }

  /* ---- stations ---- */
  if (!Array.isArray(s.stations) || !s.stations.length) s.stations = [ newStation(undefined, DEFAULT_SEGMENT, s.day) ];
  if (s.stations.length > MAX_STATIONS) s.stations.length = MAX_STATIONS;
  const engIds = new Set(s.staff.filter(p => p.role === 'eng').map(p => p.id));
  const djIds  = new Set(s.staff.filter(p => p.role === 'dj').map(p => p.id));
  // Empire-wide, per daypart: an engineer covers ONE slot and a DJ appears in
  // ONE crew. Enforced on load as well as on assignment, because a hand-edited
  // save is exactly where an engineer covering four morning drives at once
  // would come from — and that single edit would delete the entire third
  // mechanic without erroring.
  const engUsed = {}, djUsed = {};
  for (const p of DAYPARTS) { engUsed[p.id] = new Set(); djUsed[p.id] = new Set(); }

  s.stations = s.stations.map((st, i) => {
    const out = (st && typeof st === 'object') ? st : {};
    out.call = String(out.call || randomCall()).replace(/[^A-Z]/g, '').slice(0, 4) || randomCall();
    const f = n(out.freq, 0);
    out.freq = (f >= 88.1 && f <= 107.9) ? (+f).toFixed(1) : (92.1 + randInt(0, 79) * 0.2).toFixed(1);
    out.segment = isSegment(out.segment) ? out.segment : DEFAULT_SEGMENT;
    out.tx  = clamp(Math.floor(n(out.tx, 0)), 0, TX.length - 1);
    out.ant = clamp(Math.floor(n(out.ant, 0)), 0, ANT.length - 1);
    out.foundedDay = clamp(Math.floor(n(out.foundedDay, 1)), 1, s.day);
    out.totalEarned = n(out.totalEarned, 0);
    const base = defaultSchedule();
    const sched = (out.schedule && typeof out.schedule === 'object') ? out.schedule : {};
    out.schedule = {};
    for (const p of DAYPARTS) {
      const src = (sched[p.id] && typeof sched[p.id] === 'object') ? sched[p.id] : {};
      const djs = [];
      const rawDjs = Array.isArray(src.djs) ? src.djs : (typeof src.dj === 'string' ? [src.dj] : []);
      for (const id of rawDjs) {
        // A DJ id pointing at someone who is no longer on staff would make the
        // slot render blank while still counting toward crewSkill and djLoad.
        if (typeof id !== 'string' || !djIds.has(id)) continue;
        if (djs.indexOf(id) >= 0) continue;      // same person twice on one slot
        if (djUsed[p.id].has(id)) continue;      // same person, same hour, elsewhere
        if (djs.length >= MAX_CREW) break;
        djUsed[p.id].add(id);
        djs.push(id);
      }
      /* v3 -> v4: `eng` was a single id, `engs` is up to MAX_ENG of them.
         Accept either shape so a save written before the bump still loads, and
         apply the same same-daypart uniqueness the DJ list gets — a v3 save
         cannot hold a duplicate, but a hand-edited or future one can. */
      const rawEngs = Array.isArray(src.engs) ? src.engs
                    : (typeof src.eng === 'string' ? [src.eng] : []);
      const engs = [];
      for (const id of rawEngs) {
        if (typeof id !== 'string' || !engIds.has(id)) continue;
        if (engs.indexOf(id) >= 0) continue;       // same person twice on one slot
        if (engUsed[p.id].has(id)) continue;       // same person, same hour, elsewhere
        if (engs.length >= MAX_ENG) break;
        engUsed[p.id].add(id);
        engs.push(id);
      }
      out.schedule[p.id] = { show: SHOWS[src.show] ? src.show : base[p.id].show, djs, engs };
    }
    out.lease = 0;   // recomputed by simulateDay before it is ever charged
    /* v6 signal condition. A well-typed 0, a NaN or a missing field all become
       1.00 — pristine — because the only saves without it predate the mechanic
       and must not be punished for that. Clamped, so a hand-edited 12 cannot
       hand a station 12x pull. */
    out.cond = clamp(n(out.cond, 1), COND_MIN, 1);
    return out;
  });
  // Unique callsigns and dial positions across the empire — two KXYZs is a
  // rendering bug in every list in the game and a real confusion in the
  // station switcher.
  const usedCalls = new Set(), usedFreqs = new Set();
  for (const st of s.stations) {
    while (usedCalls.has(st.call)) st.call = randomCall();
    usedCalls.add(st.call);
    let guard = 0;
    while (usedFreqs.has(st.freq) && guard++ < 200) st.freq = (92.1 + randInt(0, 79) * 0.2).toFixed(1);
    usedFreqs.add(st.freq);
  }
  s.active = clamp(Math.floor(n(s.active, 0)), 0, s.stations.length - 1);
  s.stats.stationsFounded = Math.max(s.stats.stationsFounded, s.stations.length);

  // A clock stamp from the future (system time moved back) would make the
  // catch-up window negative; treat it as "just now".
  if (!Number.isFinite(s.lastTick) || s.lastTick > Date.now()) s.lastTick = Date.now();

  return installLegacyViews(s);
}

/** Truth-testing the raw string used to leave a corrupt entry enabling
    Continue forever with no way to clear it. Accepts both shapes: a v2 save
    carries a top-level `call`, a v3 save carries it inside stations[0], and
    this runs before migrate() has had a chance to normalise either. */
function hasSave(){
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  if (!raw) return false;
  let d;
  try { d = JSON.parse(raw); }
  catch (e) { wipeSave(); return false; }
  if (!d || typeof d !== 'object' || !Number.isFinite(readNum(d, 'day', NaN))) return false;
  /* A save claiming a version this build cannot read is not a save this build
     has. Without this, Continue rendered enabled and correctly labelled
     ("Continue · KREP · Day 123") and then failed silently on every press —
     loadGame() bailed, the failed-load branch toasted, and nothing wiped the
     save, so the button stayed permanently dead with no way forward. Better to
     show a clean New Game than a button that lies. */
  if (readNum(d, 'v', 0) > STATE_VER) return false;
  if (typeof readStr(d, 'call', null) === 'string') return true;
  return Array.isArray(d.stations) && d.stations.length > 0 &&
         typeof readStr(d.stations[0], 'call', null) === 'string';
}
function wipeSave(){ try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
/** The callsign to print next to Continue, for a save that has not been loaded
    into S yet (the menu button and the menu backdrop). One place, because the
    field moved in v3 and every caller that reaches for `d.call` by hand is a
    "Continue · undefined" waiting to happen. */
function saveHeadline(){
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!d || typeof d !== 'object') return null;
    const call = readStr(d, 'call', null) ||
      (Array.isArray(d.stations) && d.stations[0] ? readStr(d.stations[0], 'call', null) : null);
    const day = readNum(d, 'day', NaN);
    if (!call || !Number.isFinite(day)) return null;
    return { call, day: Math.floor(day), stations: Array.isArray(d.stations) ? d.stations.length : 1 };
  } catch (e) { return null; }
}

/** Grant a capped lump sum for time the tab was closed (CLAUDE.md line 16).
    Deliberately NOT a simulateDay() loop: that would fire fault rolls, event
    modals and unlock modals against an unrendered UI, and could cross
    BANKRUPTCY_FLOOR with nothing on screen.

    v3 closes the tab-dodge loophole (collision #7). v2 gated the whole payout
    on `S.lastDay.net > 0`, which was harmless when the only recurring cost was
    payroll you could fire your way out of — but leases are charged whether or
    not the station performs, so "close the tab while you are losing money" was
    about to become the strongest play in the game. Losing days now apply, and
    they apply at FULL rate while winning days still pay half: an absence can
    never be more profitable than being at the desk. The loss is floored at the
    bankruptcy line rather than through it, so the run ends on the next tick
    through the normal ending instead of inside a modal with no clock. */
function catchUp(){
  const now = Date.now();
  const dt = clamp(now - (S.lastTick || now), 0, OFFLINE_CAP_MS);
  S.lastTick = now;
  if (dt < 60000) return;
  const days = Math.min(Math.floor(dt / OFFLINE_MS_PER_DAY), OFFLINE_MAX_DAYS);
  if (days < 1) return;

  /* Signal condition decays while the tab is shut, BEFORE the offline payout is
     sized. Without this, closing the tab froze the mechanic: leave at cond 1.00,
     come back 96 days later at cond 1.00, and collect 96 days of full-condition
     net — the same tab-dodge class as collision #7, and it would have made
     "close the tab" the correct way to run an unattended station.

     The payout is then scaled by how far condition actually fell over the
     absence. Using the midpoint of the fall rather than the end value is the
     honest reading: the station did not spend all 96 days at its final
     condition, it slid there, so the average day is worth about the average of
     the two ends. */
  const condBefore = S.stations.reduce((a, st) => a + condOf(st), 0) / Math.max(1, S.stations.length);
  const offlineLoad = staffSlotLoad();
  for (const st of S.stations) stepCondition(st, days, offlineLoad);
  const condAfter = S.stations.reduce((a, st) => a + condOf(st), 0) / Math.max(1, S.stations.length);
  const condScale = condBefore > 0 ? clamp(((condBefore + condAfter) / 2) / condBefore, 0, 1) : 1;

  const daily = Number.isFinite(S.lastDay.net) ? S.lastDay.net : 0;
  const rate = daily >= 0 ? OFFLINE_RATE : 1;
  // Only scale the WINNING case: a decaying station earns less, but its lease
  // and payroll do not shrink because nobody was watching. Scaling a loss by
  // condition would pay the player for neglect.
  let delta = daily >= 0 ? daily * days * rate * condScale : daily * days * rate;
  // Do not punch through the floor while the player is looking at a modal.
  if (delta < 0) delta = Math.max(delta, BANKRUPTCY_FLOOR - S.cash);

  // Offline time is its own book page. Without rebasing, the identity would be
  // measured against the opening of whatever day the tab closed on and read as
  // a drift of exactly the lump sum — a tripwire that fires on its own feature.
  S.book = {
    day: S.day, opening: S.cash, revenue: 0, payroll: 0, royalties: 0,
    leases: 0, capex: 0, events: 0, offline: 0, closing: S.cash
  };
  bookCash(delta, 'offline');
  S.day += days;
  S.stats.daysOnAir += days;
  S.stats.totalEarned += delta;
  if (delta < 0) S.stats.totalCosts += -delta;

  addLog(delta >= 0
    ? 'Automated broadcasting covered ' + days + ' days while you were away.'
    : 'Automation kept the lights on for ' + days + ' days — leases and payroll came due anyway.',
    delta >= 0 ? 'big' : 'bad');
  // Paint the lump sum before the dialog goes up, or the HUD sits on the
  // pre-absence numbers for as long as the player reads it.
  render();
  // This was the only modal in the game that left the clock running, so days
  // advanced (and event modals stacked up) behind "While you were away".
  modalPause();
  openModal('📻 While you were away',
    days + ' days of automated broadcasting',
    '<p style="font-size:13px;color:var(--muted);margin-top:10px">' +
      esc(delta >= 0
        ? 'Unattended days pay half rate, and catch-up is capped at ' + OFFLINE_MAX_DAYS +
          ' broadcast days. Listeners and reputation pick up where the live schedule left them.'
        : 'Your leases and payroll do not stop when the tab does. Unattended losses are charged in full — ' +
          money(delta) + ' over ' + days + ' days — while unattended profits pay half.') +
    '</p>',
    [{ label: t('close'), cls: 'buy', act: dismissAutoModal }]);
}
