// Callsigns — ui: screens/tabs, render + the five tab views, modals and toasts,
// player actions, flows, options, main menu, event wiring, gamepad, boot.
// Loads last; boot() at the bottom is the entry point for the whole game.
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing one top-level scope; load order: content, sim, fx, ui.
//
// v3 (75% Build): rebuilt for the empire shape in CONTRACT.md — up to four
// stations, `slot.djs` crews, an engineer per slot, per-station gear and
// leases. The three things this file has to make legible, in priority order:
//   1. which slots are exposed across the WHOLE empire (morning drive happens
//      at 6 AM on every station at once — that is the game);
//   2. what a co-host or a show change does to a slot's LOAD, and what load
//      does to fault risk, because DESIGN.md requires the engineer crossover
//      to be discoverable rather than hidden math;
//   3. the lease you are signing up for, BEFORE the buildout money leaves.
'use strict';

/* ============================================================
   v3 SIM SEAM — READ THIS FIRST IF YOU ARE INTEGRATING
   ============================================================
   Reconciled against the LANDED sim.js / content.js / fx.js (branches
   callsigns-75-sim, -content, -fx). Everything below is a thin wrapper on a
   real function in one of those files; the wrappers exist so that if a name
   moves again it moves in one place rather than in forty view expressions.
   Each one still degrades and warns once instead of throwing, because a bare
   call to a function that got renamed is a white screen, which is a much
   worse way to find out.

   Called straight through to sim.js: activeStation, activeIndex,
   setActiveStation, stationCount, stationAt, slotAt, crewOf, crewSkill, chem,
   djTerm, crewFatigue, djFatigue, loadFactor, slotRisk(slot, seg),
   marketShare -> {share, audience, pop}, reachValue(st), fidelityValue(st),
   leaseFor(st), totalLeases, payrollTotal, personById, staffOf, uncoveredSlots,
   addDj/removeDj/setSlotEngineer/setSlotShow -> {ok, stole},
   scrubStaffFromSchedules, foundStation -> {ok, station, cost, reason, short},
   canFoundStation, nextStationCost, saveHeadline, hasSave.
   To content.js: SEGMENTS, SHOW_TECH, TX_LEASE, ANT_LEASE, STATION_COSTS,
   CHEM_TAGS, tagInfo(p), segName/segBlurb/segTaste/segRuleText.
   To fx.js: fxSceneKey(idx), renderScene(idx), fxBrandArt(html, save, idx),
   fxFly(fromEl, toEl, text, kind), sfxChem(multiplier), sfxSignOn, sfxLeaseDue.

   THE ONE THING SIM DOES NOT PROVIDE: a per-slot revenue estimate for a
   hypothetical crew. Everything the slot editor says about whether a second
   co-host earns its load, and everything the engineer advice says about which
   slot is worth covering, is a difference of two of those. sim exposes the
   pieces but not the composition, so uiSlotRevenue() below composes them from
   the REAL functions — marketShare().audience x the same ad terms
   simulateDay() uses — and prices a hypothetical by swapping the slot's fields
   in, measuring, and swapping them back. It is not an approximation of the
   sim; it IS the sim's arithmetic, called from outside. If sim ever exports
   slotRevenue(st, partId, override) this whole section collapses to one line.

   COLLISION NOTE, PAID FOR ONCE ALREADY. These four files share one top-level
   scope and ui.js loads LAST. A function declaration that collides silently
   wins and breaks the sim; a `const` that collides is a SyntaxError that kills
   the entire page before boot(). This file previously declared stationCount,
   activeStation, segmentOf, showTech, txLease, antLease, stationCosts,
   nextStationCost and `const uiMaxCrew()` — every one of which sim.js also
   declares, and uiMaxCrew() would have been fatal. They are all gone; sim's are
   used. The ui-only names left are deliberately unlike sim's: allStations (not
   stations), staffById (not personById), segOfStation (not segmentOf),
   slotCrew (not crewOf), stSlot (not slotAt), uiTotalLease (not totalLeases).
   Diff any new global you add here against sim.js before you add it.
   ============================================================ */

const _bridgeWarned = {};
function bridgeMiss(name){
  if (_bridgeWarned[name]) return;
  _bridgeWarned[name] = true;
  console.warn('Callsigns/ui: sim/content/fx has no `' + name + '` — using the UI-side ' +
    'fallback from the seam block in ui.js. Not balance-bearing.');
}

// DESIGN.md mechanic #3: the worked engineer crossover sits at L* = 1.616,
// between "2 co-hosts on music" (1.45) and "2 co-hosts on news" (2.00). The
// slot editor draws this as a tick on the load bar — it is the one number in
// the game that tells you WHY the engineer belongs on the overnight news slot
// instead of the morning show, and it was never going to be discovered from a
// revenue figure alone.
const LOAD_CROSSOVER = 1.616;
// Heaviest slot the rules allow: three co-hosts on news = 1 + 0.45*2 + 0.55.
// Only used to scale the load bar, so it is a display bound, not a rule.
const LOAD_BAR_MAX = 2.55;

function uiMaxCrew(){ return (typeof MAX_CREW !== 'undefined') ? MAX_CREW : 3; }
/** v4: a slot may carry two engineers. Mirrors sim's MAX_ENG so a bridge miss
    degrades to the old single-engineer behaviour rather than throwing. */
function uiMaxEng(){ return (typeof MAX_ENG !== 'undefined') ? MAX_ENG : 1; }
function uiMaxStations(){ return (typeof MAX_STATIONS !== 'undefined') ? MAX_STATIONS : 4; }
function uiShowTech(showKey){
  if (typeof showTech === 'function') return showTech(showKey);
  bridgeMiss('showTech');
  return ({ music: 0, ads: 0.10, talk: 0.35, news: 0.55 })[showKey] || 0;
}
function uiTxLease(i){
  if (typeof txLease === 'function') return txLease(i);
  bridgeMiss('txLease');
  return 0;
}
function uiAntLease(i){
  if (typeof antLease === 'function') return antLease(i);
  bridgeMiss('antLease');
  return 0;
}
function segTable(){
  return (typeof SEGMENTS !== 'undefined' && SEGMENTS) ? SEGMENTS : null;
}
/** sim.js owns `segmentOf(segmentId)`. This is the station-shaped sibling the
    views actually want, and it is named differently on purpose. */
function segOfStation(st){
  const all = segTable();
  if (!all || !st) return null;
  return all[st.segment] || null;
}
/** content.js's one call for "what is this person known for" — a DJ's on-air
    style (which is real and feeds chem) or an engineer's/agent's quirk (which
    is flavour). Returns null rather than throwing on a person with no tags. */
function uiTagInfo(p){
  if (typeof tagInfo === 'function') return tagInfo(p);
  bridgeMiss('tagInfo');
  return null;
}

function simLoadFactor(slot){
  if (typeof loadFactor === 'function') return loadFactor(slot);
  bridgeMiss('loadFactor');
  return 1 + 0.45 * Math.max(0, slotDjs(slot).length - 1) + uiShowTech(slot.show);
}
/** sim's slotRisk takes the SEGMENT as its second argument — it carries a
    per-segment risk multiplier. Passing the station lets every caller here
    stay station-shaped and forget that detail. */
function simSlotRisk(st, slot){
  if (typeof slotRisk === 'function') {
    return slotRisk(slot, (typeof segmentOf === 'function' && st) ? segmentOf(st.segment) : null);
  }
  bridgeMiss('slotRisk');
  const w = (typeof ENG_WEIGHTS !== 'undefined') ? ENG_WEIGHTS : [1, 0.45];
  const skill = slotEngs(slot).map(staffById).filter(Boolean)
    .sort((a, b) => b.skill - a.skill)
    .reduce((sum, p, i) => sum + (w[i] || 0) * p.skill, 0);
  return 0.06 * simLoadFactor(slot) / (1 + 0.30 * skill);
}
function simCrewSkill(slot){
  if (typeof crewSkill === 'function') return crewSkill(slot);
  bridgeMiss('crewSkill');
  const w = [1, 0.55, 0.30];
  return slotCrew(slot).slice(0, uiMaxCrew())
    .reduce((sum, p, i) => sum + p.skill * (w[i] || 0), 0);
}
function simChem(slot){
  if (typeof chem === 'function') return chem(slot);
  bridgeMiss('chem');
  return 1;
}
function simFatigue(id){
  if (typeof djFatigue === 'function') return djFatigue(id);
  bridgeMiss('djFatigue');
  return 1;
}
function simReach(st){
  if (typeof reachValue === 'function') return reachValue(st);
  bridgeMiss('reachValue');
  return (typeof TX !== 'undefined' && TX[st.tx]) ? TX[st.tx].reach : 1;
}
function simFidelity(st){
  if (typeof fidelityValue === 'function') return fidelityValue(st);
  bridgeMiss('fidelityValue');
  return (typeof ANT !== 'undefined' && ANT[st.ant]) ? ANT[st.ant].fid : 1;
}
function simSalesFill(){ return typeof salesFill === 'function' ? salesFill() : 0.5; }
function simSalesPrice(){ return typeof salesPrice === 'function' ? salesPrice() : 1; }
/** { share, audience, pop } — NOT a bare number. v3's pool is finite, so the
    interesting figure is the share of it you hold, and the audience is what
    that share is worth in people. */
function simShare(st, partId){
  if (typeof marketShare === 'function') return marketShare(st, partId);
  bridgeMiss('marketShare');
  return null;
}
function simLease(st){
  if (typeof leaseFor === 'function') return leaseFor(st);
  bridgeMiss('leaseFor');
  if (!st) return 0;
  const seg = segOfStation(st);
  return (60 + uiTxLease(st.tx || 0) + uiAntLease(st.ant || 0)) * ((seg && seg.leaseMul) || 1);
}
function uiTotalLease(){
  if (typeof totalLeases === 'function') return totalLeases();
  return allStations().reduce((a, st) => a + simLease(st), 0);
}

/** Run `fn` with a slot temporarily wearing `ov`, then put it back exactly as
    it was. This is how the editor prices a co-host the player has not added:
    sim's slotPull() reads st.schedule[part] directly and has no override hook,
    so the only way to ask it a hypothetical is to make it true for the length
    of one synchronous call. Nothing can interleave — the clock is a
    setInterval and modalPause() has stopped it anyway — and the restore is in
    a finally, so a throw inside sim cannot leave the schedule rewritten. */
function withSlot(st, partId, ov, fn){
  const slot = stSlot(st, partId);
  if (!ov || !st || !st.schedule || !st.schedule[partId]) return fn(slot);
  const keep = { show: slot.show, djs: slot.djs, eng: slot.eng, engs: slot.engs };
  try {
    if (ov.show !== undefined) slot.show = ov.show;
    if (ov.djs  !== undefined) slot.djs  = ov.djs.slice();
    if (ov.eng  !== undefined) slot.eng  = ov.eng;
    if (ov.engs !== undefined) slot.engs = ov.engs.slice();
    return fn(slot);
  } finally {
    slot.show = keep.show; slot.djs = keep.djs; slot.eng = keep.eng; slot.engs = keep.engs;
  }
}

/** One slot's gross ad revenue for a day, in the sim's own arithmetic:
      audience = marketShare(st, part).audience
      revenue  = audience x adRate x AD_VALUE x fill x price x (1 + rep/140)
    which is simulateDay()'s slot line with the fault roll left out (the fault
    is priced separately, and as an expectation rather than a coin flip, by
    slotNet below). */
function simSlotRevenue(st, partId, ov){
  if (typeof slotRevenue === 'function') return slotRevenue(st, partId, ov);
  return withSlot(st, partId, ov, () => uiSlotRevenue(st, partId));
}
function uiSlotRevenue(st, partId){
  if (!st || !S) return 0;
  const slot = stSlot(st, partId);
  const show = SHOWS[slot.show] || SHOWS.music;
  const ms = simShare(st, partId);
  const audience = ms && Number.isFinite(ms.audience) ? ms.audience : 0;
  const adv = (typeof AD_VALUE !== 'undefined' ? AD_VALUE : 0.42);
  return audience * show.adRate * adv * simSalesFill() * simSalesPrice() * (1 + S.rep / 140);
}

/* ---------------- UI-side copy fallbacks ----------------
   CONTRACT.md gives every new player-facing string to content.js's STR. These
   are the strings this file asks for, with the copy it was written against,
   so the interface renders real sentences instead of raw keys while the two
   files are still on separate branches. STR always wins: tt() only reaches in
   here when t() hands the key straight back. Delete an entry the day its STR
   key lands — a second copy of a sentence is a second copy to keep true. */
const UI_STR = {
  // Station switcher / HUD
  stationsLbl: 'Stations',
  addStation: 'Found',
  exposedShort: '{n} exposed',
  allCovered: 'All covered',
  runwayDays: '{n}d left',
  runwayLots: 'healthy',
  warnRunway: '{n} days of cash left at this burn — cut costs or cover a better slot.',
  warnBroke: 'Closing on the floor at {floor}. A few more days like this and the run ends.',
  warnRed: 'In the red — {amt} of room before the floor at {floor}.',
  warnExposed: '{n} slots are on air with nobody in the booth.',
  warnLoad: '{n} high-load slots have no engineer. Faults cost revenue AND reputation.',
  warnLease: 'Leases cost {amt}/day before a single ad sells.',

  // Coverage
  coverageTitle: 'Empire Coverage — Today',
  coverageNote: 'Every station, every daypart. Tap a cell to program it.',
  covCovered: 'Covered', covRisky: 'At risk', covExposed: 'Exposed',
  covNobody: 'none',
  emptyEmpire: 'No stations in this save.',

  // Slot editor
  slotTitle: '{call} · {part}',
  slotSub: 'Crew, show and engineer for this slot.',
  loadLbl: 'Load', roRisk: 'Fault risk', roRev: 'Slot revenue',
  loadLow: 'light', loadHigh: 'heavy',
  crossoverMark: 'engineer crossover',
  engHereNote: 'Your engineer is worth <b>{amt}/day</b> here, and <b>{best}/day</b> on {bestSlot}. Load, not revenue, is what pays them.',
  engHereBest: 'This is the best slot in the empire for an engineer right now: <b>{amt}/day</b>.',
  noEngNote: 'No engineer on this slot. A fault costs 45% of the slot\'s revenue and <b>{rep} reputation</b> — the reputation hit scales with load, not with money.',
  pickCrew: 'Crew', pickCrewSub: 'Lead first. The second host counts 55%, the third 30% — and each one adds 0.45 to the load.',
  engTitle: 'Engineer', pickEngSub: 'One engineer covers one daypart across the whole empire.',
  leadTag: 'LEAD', coHost: 'Co-host',
  addCoHost: 'Add', dropCrew: 'Remove', makeLead: 'Make lead',
  crewFull: 'Three is the maximum crew.',
  engNone: 'No engineer',
  engSteal: 'Putting {name} here pulls them off {call} {part}. One engineer, one daypart, whole empire.',
  onSlots: 'On {n} other slots today',
  onSlotsNamed: 'Also on {list}',
  chemGood: 'good chemistry', chemBad: 'clashes',
  netDelta: '{amt}/day net',
  addWorth: 'Worth it here', addNotWorth: 'Costs more than it makes',

  // Founding
  foundTitle: 'Found a station',
  foundSub: 'Pick a segment. Two stations chasing one audience split it — the second signal can be the wrong buy.',
  foundCapNote: 'Four stations is the cap. Depth beats width.',
  segPop: 'Audience by daypart', segComp: 'Rivals', segLease: 'Lease premium',
  reviewCommit: 'Review the commitment',
  foundPickFirst: 'Pick a segment first',
  foundCapped: 'Four callsigns. That is the whole file.',
  foundRefused: 'The licence did not issue. Nothing was spent.',
  commitTitle: 'Before you sign',
  commitSub: '{seg} · the buildout is one payment. The lease is forever.',
  commitBuild: 'Buildout, today', commitLease: 'Lease, every day',
  commitNow: 'Your net yesterday', commitAfter: 'Net after this lease',
  commitRunway: 'Cash runway', commitTalent: 'People per slot',
  commitTalentVal: '{staff} on payroll for {slots} slots',
  commitWarn: 'You do not have the people to cover this. Slots you cannot staff still pay their lease.',
  confirmFound: 'Sign on in {seg}',
  foundedMsg2: '{call} is on the air in {seg}.',

  // Coach (progressive onboarding — replaces the intro modal)
  coachStep: 'First days · {n}',
  coachGot: 'Got it',
  coach1: 'You are on the air, but nobody is in the booth. Automation fills the hours; a host makes them worth selling ads against. Two or three people are looking for work each week — that is the whole talent supply, forever.',
  coach1Btn: 'See who is available',
  coach2: '{name} is on payroll and not on the air. Morning drive is the biggest audience of the day — start there.',
  coach2Btn: 'Program morning drive',
  coach3: 'The lease is {amt} a day, paid whether you broadcast or not. That is the clock you are racing. The bar at the top of the screen tells you when it starts winning.',
  coach4: 'Extra co-hosts, and talk or news instead of music, raise a slot\'s LOAD. Load is what breaks transmitters, and a fault costs reputation in proportion to the load — not to the money. One engineer covers one daypart, across the whole empire.',
  coach4Btn: 'Hire an engineer',
  coach4BtnAssign: 'Put an engineer on it',
  coach5: '{name} is on payroll but not assigned. Put them on the slot carrying the most load, which is usually not the slot making the most money.',
  coach5Btn: 'Open that slot',
  coach6: 'Morning drive happens at 6 AM on every station at once, and your people are one pool. The coverage grid is the only place you can see all of it.',
  coach6Btn: 'Show me the grid',

  // Goals (long tail, after the coach is finished)
  goalCover: 'Cover {n} exposed slots — tap a red cell',
  goalEngineer: 'Put an engineer on your heaviest slot',
  goalFound2: 'You can afford a second callsign',

  // Brief / empire
  leaseTitle: 'Leases', empireLease: 'Lease/day', empireShare: 'Share',
  perStation: 'By station', switchTo: 'Switch',
  stationSub: '{freq} FM · {seg}',
  noSegment: 'Unassigned segment',
  briefShare: 'Audience share',
  welcomeToast: 'You are on the air. Look for the amber card below the dial.'
};
/** t() with a UI-side default. t() returns the key itself when it misses, so
    that is the signal to fall back. */
function tt(key, vars){
  const got = t(key, vars);
  if (got !== key) return got;
  let s = UI_STR[key];
  if (s === undefined) return key;
  if (vars) for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
  return s;
}

/* ---------------- state accessors ----------------
   Nothing in the view code reaches into S.stations directly, and NOTHING here
   keeps its own idea of which station is selected. That index lives in
   S.active, sim.js owns it, and it rides in the save — which is right: coming
   back to Continue and landing on the station you left is the correct
   behaviour, and a ui-side module variable could not have done it.
   curStation()/activeIndex()/setActiveStation() are sim's and already clamp,
   so a save that comes back with fewer stations than the last session cannot
   leave the camera pointing at nothing. */

function allStations(){ return (S && Array.isArray(S.stations)) ? S.stations : []; }
/** sim's curStation() dereferences S.stations without a length guard; every
    view in this file can be reached (briefly) with no stations at all — during
    boot, and on a save that failed to migrate — so this is the guarded form
    the views call. */
function curStation(){
  const list = allStations();
  if (!list.length) return null;
  if (typeof activeStation === 'function') return activeStation() || list[0];
  return list[0];
}
function curIndex(){
  if (!allStations().length) return 0;
  if (typeof activeIndex === 'function') return activeIndex();
  return 0;
}
function stSlot(st, partId){
  if (st && st.schedule && st.schedule[partId]) return st.schedule[partId];
  return { show: 'music', djs: [], engs: [] };
}
function slotDjs(slot){
  return (slot && Array.isArray(slot.djs)) ? slot.djs.filter(Boolean) : [];
}
/** Engineer ids on a slot. Reads the v4 `engs` array, falling back to a v3
    `eng` string — same tolerance as sim's engIdsOf(), and for the same reason:
    a save written before the bump, or a stale tab, must not render as an empty
    booth when someone is actually on it. */
function slotEngs(slot){
  if (!slot) return [];
  if (Array.isArray(slot.engs)) {
    const ids = slot.engs.filter(id => typeof id === 'string' && id);
    if (ids.length) return ids.slice(0, uiMaxEng());
  }
  return (typeof slot.eng === 'string' && slot.eng) ? [slot.eng] : [];
}
function staffById(id){
  if (!S || !id) return null;
  return S.staff.find(p => p.id === id) || null;
}
function slotCrew(slot){ return slotDjs(slot).map(id => staffById(id)).filter(Boolean); }
function stationCall(st){ return (st && st.call) || '—'; }
function partIcon(id){
  const p = DAYPARTS.find(x => x.id === id);
  return p ? p.icon : '•';
}
/** Reference string for a slot, so a delegated click knows which station's
    morning drive it just changed. Four stations x four dayparts and one
    shared modal is exactly how you end up editing the wrong station. */
function slotRef(stIdx, partId){ return stIdx + '|' + partId; }
function parseRef(ref){
  const bits = String(ref || '').split('|');
  return { idx: +bits[0] || 0, part: bits[1] || 'morning' };
}

/* ---------------- the shared valuation ----------------
   Used by the slot editor, the coverage grid and the engineer advice, so all
   three can never disagree about which slot is worth what.

   V is DESIGN.md mechanic #3's reputation price:
     V = 20 · R_total · (1/(62+rep) + 1/(140+rep))
   R_total is the empire's daily revenue, so the same fault costs more once
   there is more riding on the brand. */
function repValue(){
  if (!S) return 0;
  let total = 0;
  for (const st of allStations()) for (const p of DAYPARTS) total += simSlotRevenue(st, p.id);
  return 20 * total * (1 / (62 + S.rep) + 1 / (140 + S.rep));
}
/** Expected daily value of a slot after the cost of the faults it will have.
    Fault cost = risk x (45% of the slot's revenue + the reputation hit priced
    through V), exactly the two halves DESIGN.md's fault applies. */
function slotNet(st, partId, ov, V){
  const v = (V === undefined) ? repValue() : V;
  // One withSlot() for all three reads, so revenue, load and risk are every
  // one of them measured against the SAME hypothetical. Composing them from
  // three separate overrides is how you get a readout that prices a co-host's
  // revenue against the load of a crew that does not include them.
  return withSlot(st, partId, ov, slot => {
    const rev = uiSlotRevenue(st, partId);
    const load = simLoadFactor(slot);
    const risk = simSlotRisk(st, slot);
    return rev - risk * (0.45 * rev + 0.25 * v * load);
  });
}
/** What an engineer of this skill is worth on this slot, per day. This is the
    crossover: it is quadratic in load and only linear in revenue, which is
    why the answer moves to the overnight news slot as the player loads it. */
/** What this engineer is worth ON THIS SLOT, at the margin.

    This compared { eng: null } against { eng: engId } — the v3 single-engineer
    field. v4 moved to `engs`, and engIdsOf() prefers a non-empty `engs` array
    over `eng`, so on any slot that ALREADY had an engineer both branches
    evaluated identically and every engineer priced at exactly $0. A playtest
    reported the whole bench labelled "−$0" and the second seat never justified
    before the decision; this is why. It worked only on an empty slot, which is
    the one case where the fallback to `eng` still fires.

    Marginal against whoever is already on the booth, so the second seat is
    priced as what it ADDS (ENG_WEIGHTS[1] = 0.45 of the first, by design)
    rather than as a repeat of the first. bestEngineerSlot() reads this too, so
    while it was broken every slot scored 0 and "the best home in the empire"
    was simply the first slot it looked at. */
function engineerWorth(st, partId, engId, V){
  const slot = stSlot(st, partId);
  const others = engIdsOf(slot).filter(id => id !== engId);
  const v = (V === undefined) ? repValue() : V;
  const withOut = slotNet(st, partId, { engs: others }, v);
  const withEng = slotNet(st, partId, { engs: others.concat([engId]).slice(0, uiMaxEng()) }, v);
  return withEng - withOut;
}
/** Best home in the WHOLE empire for a given engineer — the cross-station
    comparison the player cannot do in their head once there are 16 slots. */
function bestEngineerSlot(engId){
  const V = repValue();
  let best = null;
  allStations().forEach((st, i) => {
    for (const p of DAYPARTS) {
      const worth = engineerWorth(st, p.id, engId, V);
      if (!best || worth > best.worth) best = { idx: i, part: p.id, worth, st };
    }
  });
  return best;
}

/* ---------------- coverage ----------------
   The core decision surface. `level` is the only thing the grid, the switcher
   badge and the schedule tile agree to speak, so a slot cannot look exposed
   in one place and fine in another. */

function slotState(st, partId){
  const slot = stSlot(st, partId);
  const crew = slotCrew(slot);
  const engPeople = slotEngs(slot).map(staffById).filter(Boolean);
  const eng = engPeople[0] || null;
  const load = simLoadFactor(slot);
  const risk = simSlotRisk(st, slot);
  let level = 'covered';
  // Exposed means nobody is in the booth: automation airs at about a third of
  // a hosted slot and the lease is due either way, so it is the worst state a
  // slot can be in and it gets the loudest colour. Risky means it is staffed
  // but carrying load without an engineer — 1.45 is "two co-hosts on music",
  // the first step above baseline, and BASE_RISK is sim's own per-slot floor.
  if (!crew.length) level = 'exposed';
  else if (!eng && load >= 1.45) level = 'risky';
  else if (typeof BASE_RISK !== 'undefined' && risk >= BASE_RISK) level = 'risky';
  return { slot, crew, eng, engs: engPeople, load, risk, level };
}
/** Empire-wide roll-up: per-station counts plus the totals the HUD warns on. */
function empireExposure(){
  const per = [];
  let exposed = 0, risky = 0, unengineered = 0;
  allStations().forEach(st => {
    let e = 0, r = 0;
    for (const p of DAYPARTS) {
      const s = slotState(st, p.id);
      if (s.level === 'exposed') { e++; exposed++; }
      else if (s.level === 'risky') { r++; risky++; if (!s.eng) unengineered++; }
    }
    per.push({ exposed: e, risky: r });
  });
  return { per, exposed, risky, unengineered };
}
function uiTotalLease(){
  return allStations().reduce((a, st) => a + simLease(st), 0);
}
/** Days before cash reaches the bankruptcy floor at yesterday's burn.
    Infinity when the station is profitable. The floor, not zero, because the
    floor is where the run actually ends. */
function runwayDays(){
  if (!S) return Infinity;
  const net = (S.lastDay && S.lastDay.net) || 0;
  if (net >= 0) return Infinity;
  const floor = (typeof BANKRUPTCY_FLOOR !== 'undefined') ? BANKRUPTCY_FLOOR : -4000;
  return Math.max(0, (S.cash - floor) / -net);
}

/* ---------------- UI: shell ---------------- */

const TABS = [
  { id: 'studio', icon: '🎚️', lbl: 'tabStudio' },
  { id: 'gear',   icon: '📡', lbl: 'tabGear' },
  { id: 'staff',  icon: '👥', lbl: 'tabStaff' },
  { id: 'empire', icon: '🏙️', lbl: 'tabEmpire' },
  { id: 'log',    icon: '📋', lbl: 'tabLog' }
];
let activeTab = 'studio';
/* Which station the Studio and Gear tabs are showing USED to be a module
   variable here. It is S.active now — sim.js owns it and it rides in the save,
   which is the right answer twice over: Continue lands you back on the station
   you were looking at, and there is exactly one clamp (sim's) instead of two
   that can disagree. Read it with curIndex(), write it with setStation(). */

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
  // Only the game screen has a tab bar for toasts to clear.
  document.body.classList.toggle('in-game', id === 'game');
}

/** Built exactly once per run, from enterGame(). render() only toggles classes
    on it — rebuilding the bar every tick threw away its :active/transition
    state and re-injected the badge span sixty times a minute. */
function buildTabs(){
  $('tabbar').innerHTML = TABS.map(tb =>
    '<button class="tab' + (tb.id === activeTab ? ' active' : '') + '" data-tab="' + tb.id + '">' +
      '<span class="tab-icon">' + tb.icon + '</span>' +
      '<span class="tab-lbl">' + esc(t(tb.lbl)) + '</span>' +
    '</button>'
  ).join('');
}

/** Class-only refresh of the already-built tab bar. */
function paintTabs(){
  const exp = S ? empireExposure() : { exposed: 0 };
  document.querySelectorAll('#tabbar .tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === activeTab);
    if (b.dataset.tab === 'empire') {
      // Two reasons the Empire tab wants attention now: an expansion the
      // player has not looked at, and — the one that actually matters
      // day to day — slots on air with nobody in the booth.
      b.classList.toggle('has-badge',
        !!(S && ((S.unlockedExpansion && !S.seenExpansion && canFound()) || exp.exposed > 0)));
    }
  });
}

function setTab(id){
  activeTab = id;
  // Visiting Empire is the acknowledgement — otherwise the badge stayed lit
  // for the rest of the run, second station or not.
  if (id === 'empire' && S) S.seenExpansion = true;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + id));
  $('game-content').scrollTop = 0;
  render();
}

/** Switch which station the Studio/Gear tabs are pointed at. The write goes
    through sim's setActiveStation() so S.active stays the single source of
    truth (and gets sim's clamp), and the scene key is dropped because the
    Studio banner is that station's art. */
function setStation(i){
  const list = allStations();
  if (!list.length) return;
  const next = clamp(i, 0, list.length - 1);
  if (next === curIndex()) return;
  if (typeof setActiveStation === 'function') setActiveStation(next);
  else if (S) S.active = next;
  sceneKey = '';
  $('game-content').scrollTop = 0;
  render();
}

/* ---------------- UI: render ---------------- */

/* Assign innerHTML only when it would actually change. Every pane in this
   file is rebuilt from a string on every tick, and re-writing a container
   whose HTML is byte-identical still destroys the tap that was in flight
   inside it, drops :active, and resets any nested scroll. The string compare
   is far cheaper than the parse it avoids. */
function setPane(el, html){
  if (!el) return;
  if (el._uiHtml === html) return;
  el._uiHtml = html;
  el.innerHTML = html;
}

/* The scene is ~40 nodes running twelve infinite CSS animations, and it used
   to be rebuilt on every tick — the 26s satellite never got past 19% of its
   orbit and the 4.2s wave rings never emitted a complete ring. It only ever
   changes when the tier, the callsign or the frequency does, so key it on
   exactly that and leave the DOM alone the rest of the time. The active
   station is part of the key now: the Studio tab shows the selected station's
   art, so switching stations is a scene change like any other. */
let sceneKey = '';
function updateScene(){
  const st = curStation();
  if (!st) return;
  // fx.js owns the key. It has to: the v3 scene paints every callsign in the
  // empire onto the city's billboards and drops a sibling mast per station, so
  // "tier|call|freq" — which is what this used to assemble by hand — would not
  // change when a FOURTH station was founded, and the new mast simply would
  // not appear until something unrelated moved the tier.
  const k = (typeof fxSceneKey === 'function')
    ? fxSceneKey(curIndex())
    : (sceneTier() + '|' + curIndex() + '|' + st.call + '|' + st.freq);
  if (k === sceneKey) return;
  sceneKey = k;
  $('scene-host').innerHTML = renderScene(curIndex());
}

/* Day-over-day change chips on the three HUD stats. Stamped once per tick,
   wiped a couple of seconds later so the HUD isn't permanently noisy. */
let prevHud = null;
let hudDeltaHtml = { cash: '', listeners: '', rep: '' };
let hudDeltaTimer = null;

function hudDelta(cur, prev, fmt){
  const d = cur - prev;
  if (!Number.isFinite(d) || Math.abs(d) < 0.5) return '';
  return '<span class="delta ' + (d > 0 ? 'up' : 'down') + '">' +
    (d > 0 ? '+' : '−') + esc(fmt(Math.abs(d))) + '</span>';
}
function noteHudDeltas(){
  if (prevHud) hudDeltaHtml = {
    cash:      hudDelta(S.cash, prevHud.cash, money),
    listeners: hudDelta(S.listeners, prevHud.listeners, num),
    rep:       hudDelta(Math.round(S.rep), Math.round(prevHud.rep), n => String(Math.round(n)))
  };
  prevHud = { cash: S.cash, listeners: S.listeners, rep: S.rep };
  clearTimeout(hudDeltaTimer);
  hudDeltaTimer = setTimeout(() => {
    hudDeltaHtml = { cash: '', listeners: '', rep: '' };
    if (S) paintHudStats();
  }, 2500);
}
function resetHudDeltas(){
  clearTimeout(hudDeltaTimer);
  prevHud = null;
  hudDeltaHtml = { cash: '', listeners: '', rep: '' };
}
function paintHudStats(){
  const days = runwayDays();
  // Cash is the decision-relevant number, so it is the one that changes
  // colour — and it changes on RUNWAY, well before the balance goes negative.
  // Amber at ten days is early enough to fire a co-host or drop a lease;
  // red at four is the last point where anything can still be done.
  const cls = !Number.isFinite(days) ? '' : days <= 4 ? 'bad' : days <= 10 ? 'warn' : '';
  const cashEl = $('stat-cash');
  cashEl.innerHTML = esc(money(S.cash)) + hudDeltaHtml.cash;
  cashEl.className = 'stat-val' + (cls ? ' ' + cls : '');
  $('lbl-cash').innerHTML = esc(t('cash')) +
    (Number.isFinite(days)
      ? ' <span class="runway ' + cls + '">' + esc(tt('runwayDays', { n: Math.floor(days) })) + '</span>'
      : '');
  $('stat-listeners').innerHTML = esc(num(S.listeners)) + hudDeltaHtml.listeners;
  $('stat-rep').innerHTML       = String(Math.round(S.rep)) + hudDeltaHtml.rep;
}

/** The always-visible answer to "am I about to run out of money" and "what is
    blocking me". Ordered by how soon the player loses if they ignore it, and
    it is a button that goes to the place the answer lives. */
function hudWarning(){
  const el = $('hud-warn');
  if (!S) { el.hidden = true; return; }
  const days = runwayDays();
  const exp = empireExposure();
  let w = null;
  /* Two bands, because there is real distance between them. This fired the
     run-is-ending warning at -$1 while the bankruptcy floor is -$4,000: a
     playtest hit it, panicked, and recovered without doing anything. Crying
     wolf at the top of a $4,000 runway teaches the player to ignore the one
     warning that matters. Show the remaining room instead of a verdict. */
  if (S.cash <= BANKRUPTCY_FLOOR / 2) {
    w = { cls: 'bad', ico: '🩸', txt: tt('warnBroke', { floor: money(BANKRUPTCY_FLOOR) }), tab: 'studio' };
  } else if (S.cash < 0) {
    w = { cls: 'warn', ico: '🩸',
          txt: tt('warnRed', { amt: money(S.cash - BANKRUPTCY_FLOOR), floor: money(BANKRUPTCY_FLOOR) }),
          tab: 'studio' };
  } else if (Number.isFinite(days) && days <= 4) {
    w = { cls: 'bad', ico: '⚠️', txt: tt('warnRunway', { n: Math.floor(days) }), tab: 'studio' };
  } else if (exp.exposed > 0) {
    w = { cls: 'bad', ico: '🎙️', txt: tt('warnExposed', { n: exp.exposed }), tab: 'empire' };
  } else if (Number.isFinite(days) && days <= 10) {
    w = { cls: 'warn', ico: '⚠️', txt: tt('warnRunway', { n: Math.floor(days) }), tab: 'studio' };
  } else if (exp.unengineered > 0) {
    w = { cls: 'warn', ico: '🔧', txt: tt('warnLoad', { n: exp.unengineered }), tab: 'empire' };
  }
  if (!w) { el.hidden = true; el.className = 'hud-warn'; return; }
  el.hidden = false;
  el.className = 'hud-warn ' + w.cls;
  el.dataset.tab = w.tab;
  const html = '<span class="hw-ico">' + w.ico + '</span><span class="hw-txt">' + esc(w.txt) + '</span>';
  if (el._uiHtml !== html) { el._uiHtml = html; el.innerHTML = html; }
}

/** Rebuilt only when the callsigns, the exposure counts or the selection
    change — this sits in the HUD and is on screen on every tab, so churning
    it every tick would be churning the top of the screen every 1.4 seconds. */
let stationBarKey = '';
function paintStationBar(){
  const bar = $('station-bar');
  const list = allStations();
  const exp = empireExposure();
  const canAdd = canFound();
  // One station and nothing to expand into is the tutorial state — no strip
  // at all, so a fresh run is not asked to understand a switcher first.
  if (list.length <= 1 && !canAdd) {
    if (stationBarKey !== 'none') { stationBarKey = 'none'; bar.innerHTML = ''; }
    return;
  }
  const key = list.map((st, i) => st.call + ':' + exp.per[i].exposed + ':' + exp.per[i].risky).join(',') +
    '|' + curIndex() + '|' + (canAdd ? '+' : '');
  if (key === stationBarKey) return;
  stationBarKey = key;

  let h = list.map((st, i) => {
    const e = exp.per[i];
    const badge = e.exposed
      ? '<span class="st-chip-dot exposed">' + e.exposed + '</span>'
      : e.risky
        ? '<span class="st-chip-dot risk">' + e.risky + '</span>'
        : '<span class="st-chip-dot ok">✓</span>';
    const seg = segOfStation(st);
    return '<button class="st-chip' + (i === curIndex() ? ' on' : '') + '" data-station="' + i + '" ' +
      'role="tab" aria-selected="' + (i === curIndex()) + '" ' +
      'aria-label="' + esc(st.call + ' — ' + (e.exposed ? tt('exposedShort', { n: e.exposed }) : tt('allCovered'))) + '">' +
      badge +
      '<span class="st-chip-call">' + esc(st.call) + '</span>' +
      '<span class="st-chip-sub">' + esc(seg ? seg.name : st.freq) + '</span>' +
    '</button>';
  }).join('');

  if (canAdd) {
    h += '<button class="st-chip add" data-tab="empire" aria-label="' + esc(tt('foundTitle')) + '">' +
      '<span class="st-chip-call">+</span>' +
      '<span class="st-chip-sub">' + esc(tt('addStation')) + '</span>' +
    '</button>';
  }
  bar.innerHTML = h;
}

function render(){
  if (!S) return;
  const st = curStation();
  $('hud-call').textContent = st ? st.call : '—';
  // Callsign plus frequency is a station's actual public identity; the gear
  // spec this used to repeat is the entire content of the Gear tab. The
  // segment replaced it, because with four stations "which market am I
  // looking at" is the question the header has to answer.
  if (st) {
    const seg = segOfStation(st);
    $('hud-sub').textContent = tt('stationSub', {
      freq: st.freq, seg: seg ? seg.name : tt('noSegment')
    });
  } else $('hud-sub').textContent = '';
  $('hud-day').textContent = t('dayShort', { n: S.day });
  paintHudStats();
  paintStationBar();
  hudWarning();

  if (activeTab === 'studio') {
    updateScene();
    setPane($('studio-coach'), viewCoach());
    // The brief is the only part of Studio whose numbers move every tick, so
    // it is the only part allowed to churn. The grid below it owns the taps.
    $('studio-brief').innerHTML = viewBrief();
    setPane($('studio-grid'), viewSchedule());
  }
  if (activeTab === 'gear')   setPane($('pane-gear'),   viewGear());
  if (activeTab === 'staff')  setPane($('pane-staff'),  viewStaff());
  if (activeTab === 'empire') setPane($('pane-empire'), viewEmpire());
  if (activeTab === 'log')    setPane($('pane-log'),    viewLog());
  paintTabs();
  setPausedUI();
  // The pane we just replaced took the gamepad cursor's node with it —
  // paintFocus() was decorating an element render() discarded a tick later.
  if (padOn) setFocus(padIdx);
}

/** The first unmet item on an ordered checklist, as {text, tab}. Rewritten for
    the empire arc: it used to read S.tx/S.ant, which are per-station now, and
    it used to finish at "found your second station", which is no longer the
    end of anything. Coverage comes before gear on purpose — an exposed slot
    costs more than a transmitter tier buys. Null once there is genuinely
    nothing gated, which is a real state in a four-station empire. */
function nextGoal(){
  const st = curStation();
  if (!st) return null;
  if (!S.staff.length) return { text: t('goalHire'), tab: 'staff' };
  const exp = empireExposure();
  if (exp.exposed) return { text: tt('goalCover', { n: exp.exposed }), tab: 'empire' };
  if (exp.unengineered && staffOf('eng').length) return { text: tt('goalEngineer'), tab: 'studio' };
  const nexts = [TX[st.tx + 1], ANT[st.ant + 1]].filter(Boolean);
  for (const g of nexts) {
    if (S.cash >= g.cost && S.rep >= g.rep) return { text: t('goalBuy', { name: g.name }), tab: 'gear' };
  }
  const gated = nexts.filter(g => S.rep < g.rep);
  if (gated.length) {
    return { text: t('goalRep', { n: Math.min.apply(null, gated.map(g => g.rep)) }), tab: 'studio' };
  }
  if (canFound()) return { text: tt('goalFound2'), tab: 'empire' };
  return null;
}

/* ---------------- onboarding: the first-days coach ----------------
   Producer condition #7: onboarding is not a modal. What was here was three
   paragraphs behind one OK button, on day one, with the clock stopped — every
   fact the game had, delivered at the only moment none of them had a referent
   yet, and never shown again. It is now a card in the content flow directly
   above the schedule, saying exactly one thing, whose button performs the
   decision it is describing. Steps advance when the player does the thing, so
   reading is optional and playing is the tutorial.
   Each step's `when` reads real state — nothing here is a counter that can
   drift out of step with the station. Only the two steps that are pure
   explanation need an acknowledgement.

   WHERE THE ACKNOWLEDGEMENTS LIVE, and why not in the save. The first draft
   put them on S.coachDone. sim.js's sanitize() rebuilds the state object field
   by field through readNum/readStr/readBool — which is the right way to treat
   untrusted persisted input, and it means any field ui.js invents is silently
   dropped on the next load. Rather than ask for a state field, they live in
   their own localStorage key, owned entirely by this file: onboarding is a
   property of the PLAYER, not of the save. Someone who has already learned
   what a lease is does not need re-teaching because they started a second
   station. Deleting the save clears it, so a genuine fresh start is a genuine
   fresh start. try/catch throughout — private browsing must cost you a
   tutorial, not the game. */
const COACH_KEY = 'callsigns.coach';
let coachDone = {};
function loadCoach(){
  try {
    const raw = localStorage.getItem(COACH_KEY);
    const d = raw ? JSON.parse(raw) : null;
    coachDone = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  } catch (e) { coachDone = {}; }
}
function saveCoach(){
  try { localStorage.setItem(COACH_KEY, JSON.stringify(coachDone)); } catch (e) {}
}
function resetCoach(){ coachDone = {}; try { localStorage.removeItem(COACH_KEY); } catch (e) {} }
const COACH = [
  {
    id: 'hire',
    when: () => !S.staff.length,
    text: () => tt('coach1'),
    btn:  () => ({ label: tt('coach1Btn'), run: () => setTab('staff') })
  },
  {
    id: 'assign',
    when: () => staffOf('dj').length &&
                !allStations().some(st => DAYPARTS.some(p => slotDjs(stSlot(st, p.id)).length)),
    text: () => tt('coach2', { name: (staffOf('dj')[0] || {}).name || 'Your host' }),
    btn:  () => ({ label: tt('coach2Btn'), run: () => openSlotEditor(curIndex(), 'morning') })
  },
  {
    id: 'lease',
    ack: true,
    when: () => S.staff.length > 0,
    text: () => tt('coach3', { amt: money(uiTotalLease()) })
  },
  {
    id: 'load',
    /* Fires on an UNCOVERED heavy slot, not on an empty payroll.

       This used to require `!staffOf('eng').length`, so a player who hired an
       engineer early could never see it — and this is the only place in the
       game that explains load -> fault -> reputation -> ad rate. A blind
       playtest hired one on day 16, spent 120 days taking four-figure fault
       hits with no idea why, and was finally told on the death screen.

       The lesson is about the SLOT, so the trigger is a heavy slot with nobody
       on the rack. That fires whether or not anyone is on payroll, and stops
       the moment the slot is actually covered. */
    when: () => allStations().some(st => DAYPARTS.some(p => {
                  const sl = stSlot(st, p.id);
                  const heavy = slotDjs(sl).length > 1 || showTech(sl.show) >= 0.35;
                  return heavy && !slotEngs(sl).length;
                })),
    text: () => tt('coach4'),
    // Hiring is only the answer when there is nobody to assign. With an
    // engineer already on payroll the fix is a slot away, so send them there.
    btn:  () => {
      const eng = staffOf('eng')[0];
      if (!eng) return { label: tt('coach4Btn'), run: () => setTab('staff') };
      const best = bestEngineerSlot(eng.id);
      return {
        label: tt('coach4BtnAssign'),
        run: () => { if (best) { setStation(best.idx); openSlotEditor(best.idx, best.part); } else setTab('staff'); }
      };
    }
  },
  {
    id: 'engineer',
    when: () => staffOf('eng').length &&
                !allStations().some(st => DAYPARTS.some(p => slotEngs(stSlot(st, p.id)).length)),
    text: () => tt('coach5', { name: (staffOf('eng')[0] || {}).name || 'Your engineer' }),
    btn:  () => {
      const eng = staffOf('eng')[0];
      const best = eng ? bestEngineerSlot(eng.id) : null;
      return {
        label: tt('coach5Btn'),
        run: () => { if (best) { setStation(best.idx); openSlotEditor(best.idx, best.part); } }
      };
    }
  },
  {
    id: 'empire',
    ack: true,
    when: () => stationCount() > 1,
    text: () => tt('coach6'),
    btn:  () => ({ label: tt('coach6Btn'), run: () => setTab('empire') })
  }
];

/* An acknowledge-only step must never BLOCK the ones behind it.

   This returned the first ready step in order, and step 3 ('lease') is
   `ack: true` with `when: S.staff.length > 0` — permanently true the moment the
   player hires anybody. So it sat on screen until clicked and every later step
   queued behind it: a blind playtest carried it from day 26 to day 139 and was
   never taught load, engineer assignment or the empire tab. The steps that
   TEACH AN ACTION are the ones with a deadline; a standing note about the lease
   can wait for a quiet moment.

   So: show the first ready actionable step if there is one, and let the
   informational steps fill the gaps. They stay pending, in order, and still get
   their turn — just never in front of something the player needs now. */
function coachStep(){
  if (!S) return null;
  let firstAck = null;
  for (let i = 0; i < COACH.length; i++) {
    const c = COACH[i];
    if (coachDone[c.id]) continue;
    let on = false;
    try { on = !!c.when(); } catch (e) { on = false; }
    if (!on) continue;
    if (c.ack) { if (!firstAck) firstAck = { c, n: i + 1 }; continue; }
    return { c, n: i + 1 };
  }
  return firstAck;
}
/** Acknowledge-only steps are dismissed by the player; the rest disappear on
    their own the moment the state they describe changes. Both write the same
    flag, so a step can never come back and re-teach something. */
function coachAck(id){
  coachDone[id] = true;
  saveCoach();
  render();
}

function viewCoach(){
  if (!S) return '';
  const step = coachStep();
  if (step) {
    const c = step.c;
    const btn = c.btn ? c.btn() : null;
    let h = '<div class="coach"><div class="coach-ico">📻</div><div class="coach-body">' +
      '<div class="coach-step">' + esc(tt('coachStep', { n: step.n })) + '</div>' +
      '<div class="coach-txt">' + esc(c.text()) + '</div>' +
      '<div class="coach-btns">';
    if (btn) h += '<button class="btn buy" data-coach="' + esc(c.id) + '">' + esc(btn.label) + '</button>';
    // Every step is dismissable. A tutorial the player cannot get out of is a
    // tutorial they resent by step three.
    h += '<button class="btn ghost" data-coachack="' + esc(c.id) + '">' + esc(tt('coachGot')) + '</button>';
    return h + '</div></div></div>';
  }
  // Once the coach is finished, the same slot carries the long-tail goal.
  const goal = nextGoal();
  if (!goal) return '';
  // A button, not a div: the whole row is a jump to the tab the goal lives on.
  return '<button type="button" class="hint" data-tab="' + goal.tab + '" ' +
    'style="display:block;width:100%;text-align:left;cursor:pointer;' +
    'background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.34);' +
    'color:var(--amber);font-weight:700;min-height:44px">' +
    '▸ ' + esc(goal.text) + '</button>';
}

/* ---------------- Studio: brief + schedule ---------------- */

function brief(label, val, color){
  return '<div style="text-align:center;padding:6px 2px">' +
    '<div style="font-size:17px;font-weight:800;color:var(--' + color + ')">' + esc(val) + '</div>' +
    '<div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.9px">' + esc(label) + '</div>' +
  '</div>';
}

/** Outputs. Deliberately ABOVE the schedule grid: the grid is the control the
    player's thumb is on, and printing the numbers they are changing it for
    underneath it means their hand covers the answer. */
function viewBrief(){
  const st = curStation();
  if (!st) return '';
  const d = S.lastDay || {};
  const netCls = (d.net || 0) >= 0 ? 'up' : 'down';
  const payroll = S.staff.reduce((a, p) => a + p.salary, 0);
  const leases = uiTotalLease();
  const share = simShare(st, 'morning');

  let h = '<div class="card"><div class="card-head">' +
    '<span class="card-title">' + esc(t('dailyBrief')) + '</span>' +
    '<span class="card-note">' + esc(t('payroll', { amt: money(payroll) })) + '</span>' +
    '</div><div class="sched">' +
      // Listeners lived here as an exact duplicate of the HUD (reading 0 under
      // a HUD reading 40 on day one). Quality and Buzz are the two numbers the
      // sim computes every day and never showed anyone. Share replaced Reach
      // in v3: with a finite pool and rivals in the denominator, "what
      // fraction of this market is mine" is the number that moved.
      brief(t('briefQuality'), Math.round((d.quality || 0) * 100) + '%', 'cyan') +
      // marketShare returns { share, audience, pop } — the SHARE is the number
      // that describes the decision, because the pool is finite and a second
      // station of your own is in the denominator.
      (!share || !Number.isFinite(share.share)
        ? brief(t('reach'), simReach(st).toFixed(1) + '×', 'magenta')
        : brief(tt('briefShare'), Math.round(share.share * 100) + '%', 'magenta')) +
      brief(t('fidelity'), simFidelity(st).toFixed(2) + '×', 'amber') +
      brief(t('briefBuzz'), Math.round((S.buzz || 1) * 100) + '%', (S.buzz || 1) >= 1 ? 'green' : 'red') +
    '</div>' +
    // Reputation drives three multipliers and two gate families, and nothing
    // in the game told the player which way it was heading.
    '<div style="margin-top:11px;text-align:center;font-size:12px;color:var(--muted)">' +
      esc(t('rep')) + ' <span style="color:var(--amber);font-weight:700">' +
      esc(t('repTrend', { now: Math.round(S.rep), target: Math.round(d.repTarget || 0) })) + '</span>' +
    '</div>' +
    '<div style="margin-top:7px;text-align:center;font-size:13px">';

  if (S.day > 1) {
    const takeIn = d.revenue || 0;
    h += '<span style="color:var(--muted)">Yesterday: </span>' +
      '<span style="color:var(--green);font-weight:700">' + money(takeIn) + '</span>' +
      '<span style="color:var(--muted)"> in · </span>' +
      '<span style="color:var(--red);font-weight:700">' + money(d.costs || 0) + '</span>' +
      '<span style="color:var(--muted)"> out · </span>' +
      '<span class="delta ' + netCls + '" style="font-size:13px">' + ((d.net || 0) >= 0 ? '+' : '') + money(d.net || 0) + '</span>' +
      // The lease is the failure state (DESIGN.md), so it gets its own line
      // in the cost breakdown rather than disappearing into "out".
      '<div style="margin-top:3px;font-size:11px;color:var(--dim)">' +
        esc(t('payroll', { amt: money(payroll) })) +
        ' · ' + esc(tt('leaseTitle')) + ' ' + money(leases) + '/day' +
        ' · ' + esc(t('royaltiesLbl')) + ' ' + money(d.royalties || 0) + '/day' +
      '</div>';
    // Per-station lease lines once there is more than one signal to compare.
    if (stationCount() > 1) {
      h += '<div style="margin-top:5px;font-size:11px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 12px;justify-content:center">' +
        allStations().map(s2 =>
          '<span>' + esc(s2.call) + ' <span style="color:var(--red);font-weight:700">−' +
          money(simLease(s2)) + '</span></span>'
        ).join('') + '</div>';
    }
  } else {
    h += '<span style="color:var(--muted)">' + esc(t('firstDay')) + '</span>';
  }
  return h + '</div></div>';
}

/** The active station's schedule, with the empire coverage strip above it.
    The strip is above on purpose: with four stations the question "is anything
    uncovered" is never about the station you happen to be looking at. */
/* Signal condition, shown with its cause and its destination.

   The mechanic is a slow multiplier on everything this station pulls, so a
   player who cannot see it experiences an unexplained revenue sag — which is
   indistinguishable from a bug, and is exactly the failure the rivals system
   already shipped with (its only on-screen number was a static constant that
   never moved). A gauge alone would not fix that: a falling number with no
   stated cause is still a mystery. So this shows three things — where it is,
   what is pushing it each way, and where it settles if nothing changes.

   c* is closed-form (see js/sim.js), which is the whole reason this can name a
   destination rather than a slope. That is what turns it into a decision. */
function conditionCard(st){
  const c = condOf(st);
  const target = condTarget(st);
  const wear = stationWear(st);
  const attn = stationAttn(st);
  const gain = COND_GAIN * attn * (1 - c);
  const net = gain - wear;
  const pct = Math.round(c * 100);
  const cls = c >= 0.85 ? 'ok' : c >= 0.60 ? 'warn' : 'bad';
  const arrow = net > 0.00005 ? '▲' : net < -0.00005 ? '▼' : '•';
  // Drift is per-day and tiny; show it per WEEK, which is the timescale a
  // player actually feels and avoids a row of zeroes.
  const perWeek = (net * 700).toFixed(1);
  const engSlots = DAYPARTS.filter(p => engIdsOf(st.schedule[p.id]).length).length;
  const djOnly = DAYPARTS.filter(p => !engIdsOf(st.schedule[p.id]).length &&
                                      (st.schedule[p.id].djs || []).length).length;
  return '<div class="card"><div class="card-head">' +
      '<span class="card-title">' + esc(tt('condTitle')) + '</span>' +
      '<span class="card-note">' + esc(tt('condSettling', { pct: Math.round(target * 100) })) + '</span>' +
    '</div>' +
    '<div class="row"><div class="row-icon">📡</div><div class="row-body">' +
      '<div class="row-title">' + pct + '% ' + arrow +
        ' <span class="row-sub" style="display:inline">' +
        (net >= 0 ? '+' : '') + perWeek + esc(tt('condPerWeek')) + '</span></div>' +
      '<div class="meter"><div class="meter-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
      '<div class="row-sub" style="margin-top:5px">' +
        esc(tt('condWear', { pct: (wear * 100).toFixed(2), tx: TX[st.tx].name, ant: ANT[st.ant].name })) +
      '</div>' +
      '<div class="row-sub">' +
        esc(tt('condTend', { pct: (gain * 100).toFixed(2), eng: engSlots, dj: djOnly })) +
      '</div>' +
    '</div></div>' +
    (c <= COND_MIN + 0.02
      ? '<div class="row-sub" style="margin-top:4px;color:var(--bad)">' + esc(tt('condFloor')) + '</div>'
      : '') +
  '</div>';
}

function viewSchedule(){
  const st = curStation();
  if (!st) return '<div class="card"><div class="empty">' + esc(tt('emptyEmpire')) + '</div></div>';
  let h = '';
  if (stationCount() > 1) h += coverageCard(true);
  h += conditionCard(st);

  h += '<div class="card"><div class="card-head">' +
    '<span class="card-title">' + esc(t('schedule')) + ' · ' + esc(st.call) + '</span>' +
    '<span class="card-note">' + esc(t('scheduleNote')) + '</span></div><div class="sched">';

  for (const part of DAYPARTS) {
    const s = slotState(st, part.id);
    const show = SHOWS[s.slot.show] || SHOWS.music;
    const lead = s.crew[0];
    const loadCls = s.load < 1.2 ? 'ok' : s.load < LOAD_CROSSOVER ? 'warn' : 'bad';
    const badge = s.level === 'exposed' ? '🔴' : s.level === 'risky' ? '🟠' : '';
    // <button>, not <div>: programming the schedule is the core mechanic and
    // it used to be unreachable without a mouse or a gamepad.
    h += '<button type="button" class="slot ' + (s.level === 'covered' ? '' : s.level) + '" ' +
      'data-openslot="' + slotRef(curIndex(), part.id) + '">' +
      (badge ? '<span class="slot-badge">' + badge + '</span>' : '') +
      '<span class="slot-part">' + part.icon + ' ' + esc(partLabel(part.id)) + '</span>' +
      '<span class="slot-icon">' + show.icon + '</span>' +
      '<span class="slot-show">' + esc(t('show' + s.slot.show.charAt(0).toUpperCase() + s.slot.show.slice(1))) + '</span>' +
      (lead
        ? '<span class="slot-dj">🎧 ' + esc(lead.name.split(' ')[0]) +
            (s.crew.length > 1 ? ' +' + (s.crew.length - 1) : '') + ' · ' + s.crew.length + '</span>'
        : '<span class="slot-meta" style="color:var(--red)">' + esc(t('noDj')) + '</span>') +
      // Load and engineer on the tile itself: the whole engineer decision is
      // invisible if you have to open four slots to find out which is heavy.
      '<span class="slot-load ' + loadCls + '">' +
        (s.eng ? '🔧' : '⚠') + ' ×' + s.load.toFixed(2) + ' · ' + (s.risk * 100).toFixed(1) + '%' +
      '</span>' +
    '</button>';
  }
  h += '</div>';

  // Where the engineer should be, in one line, on the tab the player lives on.
  const engs = staffOf('eng');
  if (engs.length) {
    const best = bestEngineerSlot(engs[0].id);
    if (best) {
      h += '<div style="margin-top:10px;font-size:11px;color:var(--muted);text-align:center">' +
        '🔧 ' + esc(engs[0].name.split(' ')[0]) + ' → <b style="color:var(--amber)">' +
        esc(best.st.call + ' ' + partShort(best.part)) + '</b> · ' +
        esc(money(best.worth)) + '/day</div>';
    }
  }
  return h + '</div>';
}

/* ---------------- coverage grid ---------------- */

/** compact=true trims the legend for the Studio tab, where it sits above the
    schedule the player is about to use; the Empire tab gets the full card. */
function coverageCard(compact){
  const list = allStations();
  if (!list.length) return '';
  let h = '<div class="card"><div class="card-head">' +
    '<span class="card-title">' + esc(tt('coverageTitle')) + '</span>' +
    (compact ? '' : '<span class="card-note">' + esc(tt('coverageNote')) + '</span>') +
    '</div><div class="cov">';

  h += '<div class="cov-head"><span></span>' +
    DAYPARTS.map(p => '<span>' + p.icon + '</span>').join('') + '</div>';

  list.forEach((st, i) => {
    h += '<div class="cov-row' + (i === curIndex() ? ' on' : '') + '">' +
      '<span class="cov-call">' + esc(st.call) + '</span>';
    for (const p of DAYPARTS) {
      const s = slotState(st, p.id);
      const lead = s.crew[0];
      h += '<button type="button" class="cov-cell ' + s.level + '" ' +
        'data-openslot="' + slotRef(i, p.id) + '" ' +
        'aria-label="' + esc(st.call + ' ' + partShort(p.id) + ' — ' +
          tt(s.level === 'exposed' ? 'covExposed' : s.level === 'risky' ? 'covRisky' : 'covCovered')) + '">' +
        '<span class="cc-ico">' + (SHOWS[s.slot.show] || SHOWS.music).icon + '</span>' +
        '<span class="cc-sub">' + esc(lead ? lead.name.split(' ')[0].slice(0, 5) : tt('covNobody')) + '</span>' +
      '</button>';
    }
    h += '</div>';
  });
  h += '</div>';
  if (!compact) {
    h += '<div class="cov-legend">' +
      '<span><i class="covered"></i>' + esc(tt('covCovered')) + '</span>' +
      '<span><i class="risky"></i>' + esc(tt('covRisky')) + '</span>' +
      '<span><i class="exposed"></i>' + esc(tt('covExposed')) + '</span>' +
    '</div>';
  }
  return h + '</div>';
}

/* ---------------- Gear ---------------- */

function viewGear(){
  const st = curStation();
  if (!st) return '<div class="card"><div class="empty">' + esc(tt('emptyEmpire')) + '</div></div>';
  // Gear is per-station in v3 (CONTRACT collision #3), so the header has to
  // say whose transmitter this is or the player upgrades the wrong signal.
  let h = '<div class="card"><div class="card-head">' +
    '<span class="card-title">📻 ' + esc(st.call) + '</span>' +
    '<span class="card-note">' + esc(tt('empireLease')) + ' ' + money(simLease(st)) + '</span>' +
  '</div></div>';
  return h + '<div class="two-col">' +
    gearCard('tx', TX, st.tx, t('transmitter'), '📡', 'reach') +
    gearCard('ant', ANT, st.ant, t('antenna'), '🗼', 'fid') +
  '</div>';
}

function gearCard(key, arr, idx, title, icon, statKey){
  const cur = arr[idx];
  const next = arr[idx + 1];
  const maxed = !next;
  const affordable = next && S.cash >= next.cost;
  const repOk = next && S.rep >= next.rep;

  let h = '<div class="card"><div class="card-head">' +
    '<span class="card-title">' + icon + ' ' + esc(title) + '</span>' +
    '<span class="card-note">' + esc(maxed ? t('maxTier') : t('tierOf', { a: idx + 1, b: arr.length })) + '</span>' +
    '</div>';

  h += '<div class="row"><div class="row-icon">' + icon + '</div><div class="row-body">' +
    '<div class="row-title">' + esc(cur.name) + '</div>' +
    '<div class="row-sub">' + esc(cur.spec) + ' · ' +
      (statKey === 'reach' ? t('reach') + ' ' + cur.reach.toFixed(2) + '×' : t('fidelity') + ' ' + cur.fid.toFixed(2) + '×') +
    '</div>' +
    '<div class="meter"><div class="meter-fill ' + (statKey === 'reach' ? 'magenta' : 'cyan') + '" style="width:' + ((idx + 1) / arr.length * 100) + '%"></div></div>' +
  '</div></div>';

  if (maxed) {
    h += '<div style="text-align:center;padding:10px"><span class="pill max">' + esc(t('maxTier')) + '</span></div>';
  } else {
    const gain = statKey === 'reach'
      ? t('boostReach', { n: Math.round((next.reach / cur.reach - 1) * 100) })
      : t('boostFid',   { n: Math.round((next.fid   / cur.fid   - 1) * 100) });
    // The lease step is the half of the upgrade that used to be invisible: a
    // transmitter tier is a permanent daily bill as well as a one-off price,
    // and DESIGN.md makes TX3->TX4 a threshold rather than a dominant buy.
    const leaseStep = (key === 'tx' ? txLease(idx + 1) - txLease(idx) : antLease(idx + 1) - antLease(idx));
    h += '<div class="row" style="margin-top:8px">' +
      '<div class="row-icon">⬆️</div>' +
      '<div class="row-body">' +
        '<div class="row-title">' + esc(next.name) + '</div>' +
        '<div class="row-sub" style="color:var(--green)">' + esc(gain) + ' · ' + esc(next.spec) + '</div>' +
        (leaseStep > 0
          ? '<div class="row-sub" style="color:var(--red)">+' + money(leaseStep) + '/day lease, permanently</div>'
          : '') +
        (!repOk ? '<div class="row-sub" style="color:var(--red)">' + esc(t('needRep', { n: next.rep })) + '</div>' : '') +
      '</div>' +
      '<div class="row-act">' +
        // A naked "$23.5k" under a "$29,000" spec line reads as a price tag,
        // not a control — and a disabled one has to say why it's disabled.
        '<button class="btn buy" data-buy="' + key + '"' + (affordable && repOk ? '' : ' disabled') + '>' +
          (repOk && !affordable
            ? esc(t('short', { amt: money(next.cost - S.cash) }))
            : esc(t('upgrade')) + ' · ' + money(next.cost)) +
        '</button>' +
      '</div>' +
    '</div>';
  }
  return h + '</div>';
}

/* ---------------- Staff ---------------- */

/** One line of the Station Effects card. */
function fxLine(label, val, color){
  return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0">' +
    '<span style="font-size:12px;color:var(--muted)">' + esc(label) + '</span>' +
    '<span style="font-size:13px;font-weight:800;color:var(--' + color + ')">' + esc(val) + '</span>' +
  '</div>';
}

function viewStaff(){
  let h = '';
  if (!S.staff.length) h += '<div class="hint">' + esc(t('noStaff')) + '</div>';

  // salesFill/salesPrice do real work that appeared nowhere on screen, so a
  // $36/day sales agent looked like paying for nothing. engBonus is gone in
  // v3 (CONTRACT collision #5 — engineers are per-slot now), so the old
  // breakdown-risk and fidelity lines were replaced by the two figures that
  // describe the empire's actual exposure.
  const exp = empireExposure();
  const slotsTotal = stationCount() * DAYPARTS.length;
  h += '<div class="card"><div class="card-head">' +
    '<span class="card-title">📊 ' + esc(t('effectsTitle')) + '</span></div>' +
    fxLine(t('fxAdFill'), Math.round(simSalesFill() * 100) + '%', 'green') +
    fxLine(t('fxAdRate'), simSalesPrice().toFixed(2) + '×', 'green') +
    fxLine(tt('covExposed'), exp.exposed + ' / ' + slotsTotal, exp.exposed ? 'red' : 'green') +
    fxLine(tt('covRisky'), exp.risky + ' / ' + slotsTotal, exp.risky ? 'amber' : 'green') +
  '</div>';

  h += '<div class="two-col">';

  h += '<div class="card"><div class="card-head">' +
    '<span class="card-title">' + esc(t('staffTitle')) + '</span>' +
    '<span class="card-note">' + esc(t('payroll', { amt: money(S.staff.reduce((a,p)=>a+p.salary,0)) })) + '</span></div>';

  if (!S.staff.length) {
    h += '<div class="empty"><div style="font-size:30px;opacity:.55;margin-bottom:6px">🎧</div>' +
      '<div style="font-weight:700;color:var(--muted)">' + esc(t('noPayroll')) + '</div>' +
      '<div style="margin-top:3px">' + esc(t('noPayrollNote')) + '</div></div>';
  } else {
    for (const p of S.staff) {
      const trainCost = trainCostFor(p.skill);
      const maxed = p.skill >= 10;
      const booked = bookingsOf(p.id);
      h += '<div class="row">' +
        '<div class="row-icon">' + ROLES[p.role].icon + '</div>' +
        '<div class="row-body">' +
          '<div class="row-title">' + esc(p.name) + '</div>' +
          '<div class="row-sub">' + esc(roleName(p.role)) + ' · ' + esc(t('skill', { n: p.skill })) + ' · ' + esc(t('salary', { amt: money(p.salary) })) + '</div>' +
          // Where this person actually is, across the whole empire. Without it
          // a four-station roster is a list of names with no schedule attached.
          '<div class="row-sub" style="color:var(--' + (booked.length ? 'cyan' : 'red') + ')">' +
            (booked.length
              ? esc(booked.map(b => b.call + ' ' + partShort(b.part)).join(' · '))
              : esc(t('unstaffed'))) +
          '</div>' +
          '<div class="meter"><div class="meter-fill amber" style="width:' + (p.skill * 10) + '%"></div></div>' +
        '</div>' +
        '<div class="row-act">' +
          (maxed
            ? '<span class="pill max">' + esc(t('maxSkill')) + '</span>'
            : '<button class="btn sm" data-train="' + p.id + '"' + (S.cash >= trainCost ? '' : ' disabled') + '>' + esc(t('trainCost', { amt: money(trainCost) })) + '</button>') +
          '<button class="btn sm danger" data-fire="' + p.id + '">' + esc(t('fire')) + '</button>' +
        '</div>' +
      '</div>';
    }
  }
  h += '</div>';

  h += '<div class="card"><div class="card-head"><span class="card-title">' + esc(t('hireTitle')) + '</span></div>';
  if (!S.candidates.length) {
    h += '<div class="empty">' + esc(t('noCandidates')) + '</div>';
  } else {
    for (const p of S.candidates) {
      const fee = hireFee(p);
      h += '<div class="row">' +
        '<div class="row-icon">' + ROLES[p.role].icon + '</div>' +
        '<div class="row-body">' +
          '<div class="row-title">' + esc(p.name) + '</div>' +
          '<div class="row-sub">' + esc(roleName(p.role)) + ' · ' + esc(t('skill', { n: p.skill })) + ' · ' + esc(t('salary', { amt: money(p.salary) })) + '</div>' +
          '<div class="row-sub" style="color:var(--dim)">' + esc(roleDesc(p.role)) + '</div>' +
          // The fee and the salary are two different numbers; the button used
          // to show only the first, directly under a line showing only the second.
          '<div class="row-sub" style="color:var(--dim)">' + esc(t('hireTerms', { amt: money(p.salary) })) + '</div>' +
        '</div>' +
        '<div class="row-act">' +
          '<button class="btn buy" data-hire="' + p.id + '"' + (S.cash >= fee ? '' : ' disabled') + '>' +
            (S.cash >= fee
              ? esc(t('hire')) + ' · ' + money(fee)
              : esc(t('short', { amt: money(fee - S.cash) }))) +
          '</button>' +
        '</div>' +
      '</div>';
    }
  }
  return h + '</div></div>';
}

/** Every slot this person is booked on, across every station. The v2 version
    of this counted one station's schedule and called it "elsewhere". */
/** Fly the price from the button that spent it to the cash readout. fx.js owns
    the animation (and its own reduced-motion gate); ui.js owns the two
    elements, so ui.js makes the call. Discrete events only — never a per-tick
    path, because it costs two getBoundingClientRect reads. It exists because
    a $12,000 buildout and a $310 hire both looked identical: a number in the
    HUD quietly becoming a different number. */
function flySpend(fromSel, amount){
  if (typeof fxFly !== 'function') return;
  const from = typeof fromSel === 'string' ? document.querySelector(fromSel) : fromSel;
  const to = $('stat-cash');
  if (from && to) fxFly(from, to, '−' + money(amount), 'spend');
}

/** Where else this person is working today, BY NAME.

    The slot editor printed "On 3 other slots today" — a count, from a list that
    has always carried the callsign and the daypart (see bookingsOf below). The
    player's actual question is "which ones, so I can decide what to move", and
    the string that answers it, coHostElsewhere, was authored in content.js in v3
    and never had a call site. One booking gets the full sentence; several get a
    compact list, because four clauses in a row is worse than a count. */
function bookingSummary(others){
  if (!others.length) return '';
  if (others.length === 1) {
    return tt('coHostElsewhere', { call: others[0].call, part: partLabel(others[0].part) });
  }
  return tt('onSlotsNamed', {
    list: others.map(b => b.call + ' ' + partLabel(b.part)).join(', ')
  });
}

function bookingsOf(id){
  const out = [];
  allStations().forEach((st, i) => {
    for (const p of DAYPARTS) {
      const sl = stSlot(st, p.id);
      const asEng = slotEngs(sl).indexOf(id) >= 0;
      if (slotDjs(sl).indexOf(id) >= 0 || asEng) {
        out.push({ idx: i, call: st.call, part: p.id, asEng });
      }
    }
  });
  return out;
}

function roleName(r){ return t(r === 'dj' ? 'roleDj' : r === 'eng' ? 'roleEng' : 'roleSales'); }
function roleDesc(r){ return t(r === 'dj' ? 'roleDjDesc' : r === 'eng' ? 'roleEngDesc' : 'roleSalesDesc'); }

/* ---------------- Empire ---------------- */

/** "Should the founding surface be visible at all" — unlocked and under the
    cap. Deliberately NOT sim's canFoundStation(), which also requires the cash
    to be in the bank: the panel has to show while you are still saving for it,
    or the price is a secret until the moment you can already pay it. The
    affordability gate is on the button, with the shortfall on its face. */
function canFound(){
  if (!S) return false;
  if (!S.unlockedExpansion) return false;
  if (stationCount() >= uiMaxStations()) return false;
  return true;
}
/** sim.js owns nextStationCost() (the rising buildout curve, including the
    doubling past the end of the table). */
function stationCost(){
  return (typeof nextStationCost === 'function') ? nextStationCost() : 0;
}

let pendingSegment = null;

function viewEmpire(){
  let h = '';

  // Roll-up first: this tab is the one-glance answer, so the numbers that
  // describe the whole empire go above the per-station detail.
  const leases = uiTotalLease();
  const d = S.lastDay || {};
  const earnCls = S.stats.totalEarned >= 0 ? 'green' : 'red';
  h += '<div class="card"><div class="card-head">' +
    '<span class="card-title">' + esc(t('empireTitle')) + '</span>' +
    '<span class="card-note">' + stationCount() + ' / ' + uiMaxStations() + '</span></div>' +
    '<div class="sched">' +
      brief(t('listeners'), num(S.listeners), 'cyan') +
      brief(tt('empireLease'), money(leases), 'red') +
      brief(t('empireNet'), money(S.stats.totalEarned), earnCls) +
      brief(t('day', { n: '' }).trim() || 'Day', String(S.day), 'amber') +
    '</div>' +
    '<div style="margin-top:9px;text-align:center;font-size:12px;color:var(--muted)">' +
      esc(t('empireCosts')) + ' <span style="color:var(--red);font-weight:700">' + money(S.stats.totalCosts) + '</span>' +
      ' · ' + esc(t('empirePeak')) + ' <span style="color:var(--cyan);font-weight:700">' + num(S.stats.peakListeners) + '</span>' +
    '</div>' +
  '</div>';

  h += coverageCard(false);

  // Per-station detail. There is no lastDay.stations[] breakdown in v3 — sim
  // stamps st.lease and accumulates st.totalEarned per station instead, and
  // today's take is derivable from the same slot arithmetic the editor uses.
  // Both are better than a snapshot: totalEarned is the number that answers
  // "has this signal ever paid for itself".
  h += '<div class="card"><div class="card-head">' +
    '<span class="card-title">' + esc(tt('perStation')) + '</span></div>';
  const exp = empireExposure();
  allStations().forEach((st, i) => {
    const seg = segOfStation(st);
    const today = DAYPARTS.reduce((a, p) => a + simSlotRevenue(st, p.id), 0);
    const lease = simLease(st);
    const e = exp.per[i];
    h += '<div class="row' + (i === curIndex() ? ' on' : '') + '">' +
      '<div class="row-icon">' + esc(seg && seg.icon ? seg.icon : '📻') + '</div>' +
      '<div class="row-body">' +
        '<div class="row-title">' + esc(st.call) + ' ' +
          (e.exposed ? '<span class="pill locked">' + esc(tt('exposedShort', { n: e.exposed })) + '</span>'
           : e.risky ? '<span class="pill warn">' + e.risky + ' ' + esc(tt('covRisky')) + '</span>'
           : '<span class="pill max">' + esc(tt('allCovered')) + '</span>') +
        '</div>' +
        '<div class="row-sub">' + esc(tt('stationSub', { freq: st.freq, seg: seg ? seg.name : tt('noSegment') })) + '</div>' +
        // Today's take against today's lease, on one line, per signal — this
        // is the "should this station exist" number and it is the whole reason
        // founding can be the wrong move.
        '<div class="row-sub">' +
          '<span style="color:var(--green)">' + money(today) + '</span> in · ' +
          '<span style="color:var(--red)">−' + money(lease) + '</span> ' + esc(tt('empireLease')) +
          ' · <span style="color:var(--' + (today - lease >= 0 ? 'green' : 'red') + ');font-weight:700">' +
            (today - lease >= 0 ? '+' : '') + money(today - lease) + '</span>' +
        '</div>' +
        (Number.isFinite(st.totalEarned)
          ? '<div class="row-sub" style="color:var(--dim)">' +
              esc(t('empireNet')) + ' ' + money(st.totalEarned) + '</div>'
          : '') +
      '</div>' +
      '<div class="row-act">' +
        '<button class="btn sm" data-station="' + i + '">' + esc(tt('switchStation')) + '</button>' +
      '</div>' +
    '</div>';
  });
  h += '</div>';

  h += viewFounding();
  return h;
}

/** The founding flow. Segment choice is browsable in the tab (it is a real
    decision — DESIGN.md's crossover moves with M_B/C_B), and the COMMITMENT
    is the modal, because the lease is the part that used to be invisible
    until it started arriving. */
function viewFounding(){
  if (stationCount() >= uiMaxStations()) {
    return '<div class="card"><div class="locked-panel" style="padding:18px 10px">' +
      '<div class="locked-icon">🏙️</div>' +
      '<div style="font-size:13px;color:var(--muted)">' + esc(tt('foundCapNote')) + '</div>' +
    '</div></div>';
  }

  if (!S.unlockedExpansion) {
    const cashPct = clamp(S.cash / UNLOCK_CASH * 100, 0, 100);
    const repPct  = clamp(S.rep / UNLOCK_REP * 100, 0, 100);
    return '<div class="card"><div class="card-head"><span class="card-title">' + esc(t('progressTo')) + '</span></div>' +
      '<div class="locked-panel" style="padding:14px 6px">' +
        '<div class="locked-icon">🔒</div>' +
        '<div style="font-size:13px;color:var(--muted)">' +
          esc(t('lockedSub', { cash: money(UNLOCK_CASH), rep: UNLOCK_REP, cost: money(stationCost()) })) + '</div>' +
      '</div>' +
      '<div class="row"><div class="row-icon">💵</div><div class="row-body">' +
        '<div class="row-title">' + money(S.cash) + ' / ' + money(UNLOCK_CASH) + '</div>' +
        '<div class="meter"><div class="meter-fill amber" style="width:' + cashPct + '%"></div></div>' +
      '</div></div>' +
      '<div class="row"><div class="row-icon">⭐</div><div class="row-body">' +
        '<div class="row-title">' + Math.round(S.rep) + ' / ' + UNLOCK_REP + ' ' + esc(t('rep')) + '</div>' +
        '<div class="meter"><div class="meter-fill magenta" style="width:' + repPct + '%"></div></div>' +
      '</div></div>' +
    '</div>';
  }

  const all = segTable();
  const cost = stationCost();
  let h = '<div class="card"><div class="card-head">' +
    '<span class="card-title">🏙️ ' + esc(tt('foundTitle')) + '</span>' +
    '<span class="card-note">' + money(cost) + '</span></div>' +
    '<div class="pick-sub">' + esc(tt('foundSub')) + '</div>';

  if (!all) {
    // SEGMENTS is content.js's table (CONTRACT). No invented rows here — a
    // fabricated segment is a balance lie and, if it were a TV row, a scope
    // breach. Say so plainly instead.
    return h + '<div class="empty">Segment data unavailable.</div></div>';
  }

  h += '<div class="seg-grid">';
  for (const id in all) {
    const seg = all[id];
    const on = pendingSegment === id;
    const pops = DAYPARTS.map(p => (seg.pop && seg.pop[p.id]) || 0);
    const peak = Math.max(1, Math.max.apply(null, pops));
    const mine = allStations().filter(s2 => s2.segment === id).length;
    h += '<button type="button" class="seg-card' + (on ? ' on' : '') + '" data-seg="' + esc(id) + '">' +
      '<div class="seg-card-top">' +
        '<span style="font-size:20px">' + esc(seg.icon || '📻') + '</span>' +
        '<span class="seg-card-name">' + esc(seg.name) + (on ? ' ✓' : '') + '</span>' +
        (mine ? '<span class="pill warn">' + mine + ' of yours</span>' : '') +
      '</div>' +
      '<div class="seg-pops">' + DAYPARTS.map((p, i) =>
        '<div class="seg-pop"><div class="seg-pop-bar"><i style="height:' +
          Math.max(3, Math.round(pops[i] / peak * 26)) + 'px"></i></div>' +
        '<div class="seg-pop-lbl">' + p.icon + '</div></div>').join('') + '</div>' +
      /* LIVE incumbent capacity, not seg.comp.base — that static constant read
         2000 against a real held total of 1049, hiding the whole rivals system
         behind a number that never moved. Name the networks and show which way
         the market is going, so "rivals grow into signals you leave empty" is
         something the player can watch rather than infer. */
      (function(){
        // `id` is the loop key; the SEGMENTS value does not carry its own id.
        const snap = rivalSnapshot(id);
        const d = snap.open > 0 ? snap.total / snap.open : 1;
        const arrow = d > 1.04 ? ' <span class="pill warn">▲ gaining</span>'
                    : d < 0.96 ? ' <span class="pill good">▼ losing ground</span>' : '';
        return '<div class="row-sub" style="margin-top:7px;color:var(--muted)">' +
          esc(tt('segComp')) + ' ' + Math.round(snap.total) + arrow +
          ' · ' + esc(tt('segLease')) + ' ×' + ((seg.leaseMul || 1).toFixed(2)) +
        '</div>' +
        '<div class="row-sub" style="margin-top:3px;color:var(--muted);font-size:11px">' +
          snap.nets.map(n => esc(n.icon + ' ' + n.name) + ' ' + Math.round(n.k)).join(' · ') +
        '</div>' +
        // segCompSub has been authored in content.js since v3 and never had a
        // call site. It is the one line that explains what the number means.
        '<div class="row-sub" style="margin-top:3px;color:var(--muted);font-size:11px">' +
          esc(tt('segCompSub')) +
        '</div>';
      })() +
    '</button>';
  }
  h += '</div>';

  // A disabled button has to say why it is disabled — the v2 version showed a
  // bare price on a dead control and left the player guessing between "too
  // expensive" and "you have not picked anything yet".
  const afford = S.cash >= cost;
  h += '<div style="margin-top:12px">' +
    '<button class="btn buy" id="btn-found-review" style="width:100%"' +
      (pendingSegment && afford ? '' : ' disabled') + '>' +
      (!afford ? esc(t('short', { amt: money(cost - S.cash) }))
       : !pendingSegment ? esc(tt('foundPickFirst'))
       : esc(tt('reviewCommit'))) +
    '</button></div>';
  return h + '</div>';
}

function viewLog(){
  let h = '<div class="card"><div class="card-head"><span class="card-title">' + esc(t('logTitle')) + '</span></div>';
  if (!S.log.length) return h + '<div class="empty">' + esc(t('noLog')) + '</div></div>';
  for (const e of S.log) {
    h += '<div class="log-item ' + e.kind + '">' +
      '<div class="log-day">' + esc(t('dayShort', { n: e.day })) + '</div>' + esc(e.msg) +
    '</div>';
  }
  return h + '</div>';
}

/* ---------------- modals & toasts ---------------- */

let modalActions = [];
// Modals queue instead of last-write-wins: if a random event's modal and the
// expansion-unlock modal (or any two modals) fire on the same tick, the
// second call queues behind the first rather than overwriting it before the
// player has read it.
// This queue is also why there is exactly ONE modal host in index.html and
// one --z-modal layer: two overlays cannot both be open, so DOM order can
// never decide which of them the player is actually looking at.
let modalQueue = [];
// Options for the modal currently on screen: { replace, autoPause, blocking }.
let modalOpts = {};
// True while the sim was stopped *by* a modal rather than by the player, so
// closeModal() knows it owns the resume. Without this, dismissing an
// auto-paused modal with Esc or a backdrop click froze the station for good.
let autoPaused = false;

function openModal(title, sub, bodyHtml, actions, opts){
  // opts.replace redraws the open modal in place (the slot editor re-opens
  // itself on every pick) instead of queueing a duplicate behind itself.
  if (!opts || !opts.replace) {
    if ($('modal-back').classList.contains('open')) {
      modalQueue.push({ title, sub, bodyHtml, actions, opts });
      return;
    }
  }
  showModalNow(title, sub, bodyHtml, actions, opts);
}
function showModalNow(title, sub, bodyHtml, actions, opts){
  modalActions = actions || [];
  modalOpts = opts || {};
  // The scroll position is preserved across a `replace` redraw: the slot
  // editor rebuilds itself on every pick, and without this, choosing an
  // engineer three-quarters of the way down the sheet threw the player back
  // to the top of the show list on every single tap.
  const keepScroll = (opts && opts.replace) ? $('modal').scrollTop : 0;
  $('modal').innerHTML =
    '<div class="modal-title">' + esc(title) + '</div>' +
    (sub ? '<div class="modal-sub">' + esc(sub) + '</div>' : '') +
    (bodyHtml || '') +
    '<div class="modal-btns">' + modalActions.map((a, i) =>
      '<button class="btn ' + (a.cls || '') + '" data-modal-act="' + i + '">' + esc(a.label) + '</button>'
    ).join('') + '</div>';
  $('modal-back').classList.add('open');
  if (keepScroll) $('modal').scrollTop = keepScroll;
}
function closeModal(){
  // Read this BEFORE the shift below — once we've popped the next modal off,
  // the queue looks empty even though something is about to take the screen.
  const chaining = modalQueue.length > 0;
  $('modal-back').classList.remove('open');
  modalActions = [];
  modalOpts = {};
  if (chaining) {
    const next = modalQueue.shift();
    setTimeout(() => showModalNow(next.title, next.sub, next.bodyHtml, next.actions, next.opts), 30);
  }
  // Single convergence point for resuming: however the modal went away —
  // a button, Esc, or a backdrop click — the clock comes back, but only once
  // the whole queue is drained.
  if (!chaining && autoPaused) {
    autoPaused = false;
    if (S && !S.dead && $('screen-game').classList.contains('active')) resumeTick();
  }
}
/** Kept as a name because several modals reference it directly; the resume
    logic it used to own now lives in closeModal(). */
function dismissAutoModal(){ closeModal(); }
/** Hard teardown for returning to the main menu. Anything still queued would
    otherwise materialise 30ms later over the menu, holding closures that
    reference a state object we just nulled. */
function closeAllModals(){
  modalQueue.length = 0;
  modalActions = [];
  modalOpts = {};
  autoPaused = false;
  $('modal-back').classList.remove('open');
  $('modal').innerHTML = '';
}

/** In game, toasts go into the in-flow rail so a full stack shrinks the
    content area instead of covering the bottom of the schedule grid. Off the
    game screen there is nothing behind them, so the floating host is fine. */
function toastHost(){
  const inGame = $('screen-game').classList.contains('active');
  return (inGame && $('toasts-game')) ? $('toasts-game') : $('toasts');
}
function toast(msg, kind){
  const box = toastHost();
  // Cap the stack — a bad day can queue a breakdown, an event and a save
  // failure at once, and four is already the whole screen on a phone. Three
  // in the in-flow rail, because those are now taking real layout height away
  // from the game rather than floating over it — and ONE in landscape, where
  // three of them measured 47px out of a 360px viewport that also has to hold
  // four HUD strips, the schedule and a tab bar. In flow is the right answer
  // (a toast must never cover the control it is telling you about); the price
  // of that is that the stack has to be short when the screen is.
  const shortScreen = typeof matchMedia === 'function' &&
    matchMedia('(max-height:520px) and (orientation:landscape)').matches;
  const cap = box.id === 'toasts-game' ? (shortScreen ? 1 : 3) : 4;
  while (box.children.length >= cap) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

/* ---------------- actions ---------------- */

function buyGear(key){
  const st = curStation();
  if (!st) return;
  const arr = key === 'tx' ? TX : ANT;
  const idx = key === 'tx' ? st.tx : st.ant;
  const next = arr[idx + 1];
  if (!next || S.cash < next.cost || S.rep < next.rep) return;
  S.cash -= next.cost;
  // Per-station now (CONTRACT collision #3): S.tx/S.ant are gone.
  if (key === 'tx') st.tx++; else st.ant++;
  addLog('Upgraded ' + st.call + ' to ' + next.name + '.', 'big');
  toast('📡 ' + next.name + ' installed on ' + st.call, 'good');
  flySpend('[data-buy="' + key + '"]', next.cost);
  sfxBuy();
  sceneKey = '';
  saveGame(true);
  render();
}

function hirePerson(id){
  const p = S.candidates.find(c => c.id === id);
  if (!p) return;
  const fee = hireFee(p);
  if (S.cash < fee) return;
  S.cash -= fee;
  S.staff.push(p);
  S.candidates = S.candidates.filter(c => c.id !== id);
  addLog(t('hiredMsg', { name: p.name, role: roleName(p.role) }), 'good');
  toast(ROLES[p.role].icon + ' ' + t('hiredMsg', { name: p.name, role: roleName(p.role) }), 'good');
  flySpend('[data-hire="' + id + '"]', fee);
  sfxBuy();
  saveGame(true);
  render();
}

function firePerson(id){
  const p = S.staff.find(x => x.id === id);
  if (!p) return;
  // Stop the clock while the player decides — days shouldn't tick by (and
  // event modals shouldn't stack up) behind a confirmation dialog.
  modalPause();
  const booked = bookingsOf(id);
  const body = booked.length
    ? '<p style="font-size:12px;color:var(--red);margin-top:8px">' +
        esc(booked.map(b => b.call + ' ' + partShort(b.part)).join(' · ')) +
        ' — ' + esc(tt('covExposed').toLowerCase()) + '</p>'
    : '';
  openModal(t('fireConfirm', { name: p.name }), t('fireConfirmSub'), body, [
    { label: t('cancel'), cls: 'ghost', act: closeModal },
    { label: t('fire'), cls: 'danger', act: () => {
        S.staff = S.staff.filter(x => x.id !== id);
        // Scrub EVERY station's schedule (CONTRACT collision #2). The v2
        // version walked one schedule, so firing someone left them silently
        // booked on the other three stations and the sim kept counting them
        // toward crewSkill for a person who had left the building. sim.js owns
        // the scrub now — it wrote scrubStaffFromSchedules() for this exact
        // call site, and a second copy of the loop here is a second copy to
        // keep correct.
        if (typeof scrubStaffFromSchedules === 'function') scrubStaffFromSchedules(id);
        else {
          bridgeMiss('scrubStaffFromSchedules');
          for (const st of allStations()) {
            for (const k in st.schedule) {
              const sl = st.schedule[k];
              if (Array.isArray(sl.djs)) sl.djs = sl.djs.filter(x => x !== id);
              if (Array.isArray(sl.engs)) { const ea = sl.engs.indexOf(id); if (ea >= 0) sl.engs.splice(ea, 1); }
              if (sl.eng === id) sl.eng = null;
            }
          }
        }
        addLog(t('firedMsg', { name: p.name }), 'bad');
        closeModal(); saveGame(true); render();
      } }
  ]);
}

function trainPerson(id){
  const p = S.staff.find(x => x.id === id);
  if (!p || p.skill >= 10) return;
  const cost = trainCostFor(p.skill);
  if (S.cash < cost) return;
  S.cash -= cost;
  p.skill++;
  p.salary = salaryFor(p.role, p.skill);
  addLog(t('trainedMsg', { name: p.name, n: p.skill }), 'good');
  toast('📈 ' + t('trainedMsg', { name: p.name, n: p.skill }), 'good');
  flySpend('[data-train="' + id + '"]', cost);
  sfxBuy();
  saveGame(true);
  render();
}

/* ---------------- founding ---------------- */

/** Firing a $33/day DJ already asks for confirmation; a six-figure buildout
    fired by one unconfirmed click was the biggest unguarded spend in the game.
    In v3 the confirmation carries more weight than a price: the buildout is
    one payment and the LEASE IS FOREVER, which is the whole failure state in
    DESIGN.md. So the sheet shows what the empire's daily net looks like the
    day after, and how much runway that leaves — before the money moves. */
function reviewFounding(){
  if (!canFound() || !pendingSegment) return;
  const all = segTable();
  const seg = all && all[pendingSegment];
  if (!seg) return;
  const cost = stationCost();
  if (S.cash < cost) return;
  modalPause();

  // Price the station that does not exist yet: cheapest gear, its segment's
  // lease multiplier. Anything else would understate the bill.
  const hypothetical = { segment: pendingSegment, tx: 0, ant: 0 };
  const newLease = simLease(hypothetical);
  const netNow = (S.lastDay && S.lastDay.net) || 0;
  const netAfter = netNow - newLease;
  const floor = (typeof BANKRUPTCY_FLOOR !== 'undefined') ? BANKRUPTCY_FLOOR : -4000;
  const cashAfter = S.cash - cost;
  const runwayAfter = netAfter >= 0 ? Infinity : Math.max(0, (cashAfter - floor) / -netAfter);

  const slotsAfter = (stationCount() + 1) * DAYPARTS.length;
  const djs = staffOf('dj').length;
  const thin = djs < slotsAfter / 2;

  const row = (lbl, val, cls) =>
    '<div class="commit-row' + (cls === 'total' ? ' total' : '') + '">' +
      '<span>' + esc(lbl) + '</span>' +
      '<span' + (cls && cls !== 'total' ? ' style="color:var(--' + cls + ')"' : '') + '>' + esc(val) + '</span>' +
    '</div>';

  const body =
    '<div class="commit">' +
      row(tt('commitBuild'), '−' + money(cost), 'red') +
      row(tt('commitLease'), '−' + money(newLease) + '/day', 'red') +
      row(tt('commitNow'), (netNow >= 0 ? '+' : '') + money(netNow) + '/day', netNow >= 0 ? 'green' : 'red') +
      row(tt('commitAfter'), (netAfter >= 0 ? '+' : '') + money(netAfter) + '/day', netAfter >= 0 ? 'green' : 'red', 'total') +
      row(tt('commitRunway'),
        Number.isFinite(runwayAfter) ? Math.floor(runwayAfter) + ' days' : tt('runwayLots'),
        Number.isFinite(runwayAfter) && runwayAfter < 20 ? 'red' : 'green') +
      row(tt('commitTalent'), tt('commitTalentVal', { staff: djs, slots: slotsAfter }), thin ? 'red' : 'green') +
    '</div>' +
    (thin ? '<p style="font-size:12px;color:var(--red);margin-top:10px">⚠️ ' + esc(tt('commitWarn')) + '</p>' : '') +
    '<p style="font-size:12px;color:var(--muted);margin-top:10px">' + esc(tt('foundSub')) + '</p>';

  openModal(tt('commitTitle'), tt('commitSub', { seg: seg.name }), body, [
    { label: t('cancel'), cls: 'ghost', act: closeModal },
    { label: tt('confirmFound', { seg: seg.name }), cls: 'buy',
      act: () => { closeModal(); doFoundStation(pendingSegment); } }
  ]);
}

function doFoundStation(segId){
  if (!segId) return;
  if (typeof foundStation !== 'function') {
    bridgeMiss('foundStation');
    toast('Founding is unavailable in this build.', 'bad');
    return;
  }
  // sim.js owns every rule here — the cap, the unlock, the price, the cash
  // movement through its own ledger, the unique callsign and frequency, the
  // log line, and pointing S.active at the new signal. It returns
  // { ok, station, cost } or { ok:false, reason, short }, deliberately not a
  // bare boolean, so a refusal can SAY something instead of being a button
  // that quietly does nothing. Days can pass behind the confirm sheet if the
  // player un-paused, so this really can come back false.
  const res = foundStation(segId);
  if (!res || !res.ok) {
    const why = res && res.reason;
    toast(why === 'cash' ? t('short', { amt: money(res.short || 0) })
        : why === 'cap'  ? tt('foundCapped')
        : tt('foundRefused'), 'bad');
    render();
    return;
  }
  pendingSegment = null;
  const seg = segTable() && segTable()[segId];
  toast('🏙️ ' + tt('foundedMsg2', {
    call: stationCall(res.station), seg: seg ? seg.name : segId
  }), 'good');
  // A new callsign on the air is one of the four moments fx.js reserves a
  // sting for; sfxOnAir() is the generic good-news chime and this is not that.
  if (typeof sfxSignOn === 'function') sfxSignOn(); else sfxOnAir();
  sceneKey = '';
  stationBarKey = '';
  saveGame(true);
  render();
}

/* ---------------- slot editor ----------------
   The one screen where DESIGN.md's second and third mechanics have to be
   legible. Layout order is deliberate and is the opposite of the v2 version:
     1. READOUT — load, fault risk, slot revenue, and the crossover tick.
     2. Show picker (changing the show moves the load).
     3. Crew (each addition priced as a net-per-day delta, not a vibe).
     4. Engineer (with the cross-station steal spelled out).
   Outputs sit above the controls because the controls are where the thumb is.
   `redraw` means we are re-opening on top of ourselves after a pick, so the
   modal is replaced in place and the pause state is left alone. */
function openSlotEditor(stIdx, partId, redraw){
  const list = allStations();
  if (!list.length) return;
  const idx = clamp(stIdx, 0, list.length - 1);
  const st = list[idx];
  if (!st || !st.schedule || !st.schedule[partId]) return;
  const slot = st.schedule[partId];
  const ref = slotRef(idx, partId);
  if (!redraw) modalPause();

  const V = repValue();
  const load = simLoadFactor(slot);
  const risk = simSlotRisk(st, slot);
  const rev  = simSlotRevenue(st, partId);
  const engPeople = slotEngs(slot).map(staffById).filter(Boolean);
  const eng  = engPeople[0] || null;
  const crew = slotCrew(slot);

  const loadCls = load < 1.2 ? 'ok' : load < LOAD_CROSSOVER ? 'warn' : 'bad';
  const riskCls = risk < 0.03 ? 'ok' : risk < 0.06 ? 'warn' : 'bad';

  /* --- readout: outputs, above the controls, sticky --- */
  // The bar's full scale is 2.55 = the heaviest slot the rules allow
  // (3 co-hosts on news: 1 + 0.45x2 + 0.55). The tick is L*.
  const LOAD_MAX = 2.55;
  let body = '<div class="readout"><div class="readout-grid">' +
    '<div class="ro ' + loadCls + '"><div class="ro-val">×' + load.toFixed(2) + '</div>' +
      '<div class="ro-lbl">' + esc(tt('loadLbl')) + '</div></div>' +
    '<div class="ro ' + riskCls + '"><div class="ro-val">' + (risk * 100).toFixed(1) + '%</div>' +
      '<div class="ro-lbl">' + esc(tt('roRisk')) + '</div></div>' +
    '<div class="ro neutral"><div class="ro-val">' + esc(money(rev)) + '</div>' +
      '<div class="ro-lbl">' + esc(tt('roRev')) + '</div></div>' +
    '</div>' +
    '<div class="loadbar">' +
      '<div class="loadbar-fill" style="width:' + clamp(load / LOAD_MAX * 100, 4, 100) + '%"></div>' +
      '<div class="loadbar-mark" style="left:' + (LOAD_CROSSOVER / LOAD_MAX * 100) + '%"></div>' +
    '</div>' +
    '<div class="loadbar-lbl"><span>' + esc(tt('loadLow')) + '</span>' +
      '<span style="color:var(--cyan)">▲ ' + esc(tt('crossoverMark')) + '</span>' +
      '<span>' + esc(tt('loadHigh')) + '</span></div>';

  // The engineer sentence: what they are worth HERE against what they are
  // worth on their best slot anywhere in the empire. This is the crossover,
  // said in money, on the screen where the player can act on it.
  const anyEng = staffOf('eng')[0];
  if (anyEng) {
    const here = engineerWorth(st, partId, anyEng.id, V);
    const best = bestEngineerSlot(anyEng.id);
    if (best && best.idx === idx && best.part === partId) {
      body += '<div class="readout-note">' + tt('engHereBest', { amt: esc(money(here)) }) + '</div>';
    } else if (best) {
      body += '<div class="readout-note">' + tt('engHereNote', {
        amt: esc(money(here)),
        best: esc(money(best.worth)),
        bestSlot: esc(best.st.call + ' ' + partShort(best.part))
      }) + '</div>';
    }
  } else if (!eng) {
    body += '<div class="readout-note">' +
      tt('noEngNote', { rep: (0.25 * load).toFixed(2) }) + '</div>';
  }
  body += '</div>';

  /* --- show picker --- */
  const hdrCls = 'pick-head';
  body += '<div class="' + hdrCls + '">' + esc(t('pickShow')) + '</div>';
  for (const key in SHOWS) {
    const sh = SHOWS[key];
    const on = slot.show === key;
    const tech = uiShowTech(key);
    // What this show does to the load, on the row that changes it — otherwise
    // switching to News is a quality decision with an invisible risk attached.
    const techTag = tech > 0
      ? ' · <span style="color:var(--' + (tech >= 0.35 ? 'red' : 'amber') + ')">+' + tech.toFixed(2) + ' load</span>'
      : ' · <span style="color:var(--green)">no extra load</span>';
    body += '<button type="button" class="row' + (on ? ' on' : '') + '" data-setshow="' + key + '" data-slotref="' + ref + '" style="cursor:pointer">' +
      '<div class="row-icon">' + sh.icon + '</div>' +
      '<div class="row-body">' +
        '<div class="row-title">' + esc(t('show' + key.charAt(0).toUpperCase() + key.slice(1))) + (on ? ' ✓' : '') + '</div>' +
        '<div class="row-sub">' + esc(t('show' + key.charAt(0).toUpperCase() + key.slice(1) + 'Desc')) + techTag + '</div>' +
      '</div></button>';
  }

  /* --- crew --- */
  body += '<div class="' + hdrCls + '">' + esc(tt('pickCrew')) + ' · ' + crew.length + '/' + uiMaxCrew() + '</div>' +
    '<div class="pick-sub">' + esc(tt('coHostNote')) + '</div>';

  if (!crew.length) {
    body += '<div class="empty" style="padding:14px;color:var(--red)">' + esc(t('unstaffed')) + '</div>';
  } else {
    crew.forEach((p, i) => {
      const fat = simFatigue(p.id);
      const others = bookingsOf(p.id).filter(b => !(b.idx === idx && b.part === partId));
      body += '<div class="row">' +
        '<div class="row-icon">🎧</div>' +
        '<div class="row-body">' +
          '<div class="row-title">' + esc(p.name) + ' ' +
            (i === 0 ? '<span class="pill lead">' + esc(tt('leadTag')) + '</span>'
                     : '<span class="pill new">' + esc(tt('coHost')) + ' ' + (i + 1) + '</span>') +
          '</div>' +
          '<div class="row-sub">' + esc(t('skill', { n: p.skill })) +
            (fat < 0.999 ? ' · <span style="color:var(--red);font-weight:700">' +
               esc(t('tired', { n: Math.round((1 - fat) * 100) })) + '</span>' : '') +
            (others.length ? ' · ' + esc(bookingSummary(others)) : '') +
          '</div>' +
        '</div>' +
        '<div class="row-act" style="flex-direction:row;align-items:center">' +
          (i > 0 ? '<button class="btn icon" data-leadcrew="' + p.id + '" data-slotref="' + ref + '" ' +
              'aria-label="' + esc(tt('makeLead')) + '" title="' + esc(tt('makeLead')) + '">▲</button>' : '') +
          '<button class="btn icon danger" data-dropcrew="' + p.id + '" data-slotref="' + ref + '" ' +
            'aria-label="' + esc(tt('dropCrew')) + '" title="' + esc(tt('dropCrew')) + '">✕</button>' +
        '</div>' +
      '</div>';
    });
  }

  // Available DJs, each priced as the net change to this slot. DESIGN.md's
  // whole point about the second co-host is that the answer flips with the
  // slot's revenue — so print the answer, per candidate, per slot.
  const cur = slotDjs(slot);
  const bench = staffOf('dj').filter(p => cur.indexOf(p.id) < 0);
  // A full crew used to hide the bench entirely, so at the exact moment you
  // are deciding WHO to swap out you could no longer see who was available.
  // The bench now always renders; a full crew greys it and says why.
  const crewFull = crew.length >= uiMaxCrew();
  if (crewFull) {
    body += '<div class="pick-sub" style="margin-top:8px">' + esc(tt('crewFull')) + '</div>';
  }
  if (crewFull && bench.length) {
    body += '<div class="pick-sub" style="margin-top:2px">' +
      esc(cur.length + ' / ' + uiMaxCrew() + ' on air · drop someone above to free a seat') + '</div>';
  }
  if (!bench.length) {
    body += '<div class="empty" style="padding:12px">' + esc(t('noCandidates')) + '</div>';
  } else {
    const baseNet = slotNet(st, partId, null, V);
    for (const p of bench) {
      const withNet = slotNet(st, partId, { djs: cur.concat([p.id]) }, V);
      const d = withNet - baseNet;
      const good = d > 0;
      // Chemistry preview, asked of sim's own chem() rather than of a lookup
      // table copied over here: put the person on the slot for the length of
      // one call and see what the crew multiplier becomes. content.js's
      // CHEM_TAGS likes/clashes are the data behind it, so the tag the player
      // sees and the number the sim uses can never drift apart.
      const pair = crew.length
        ? withSlot(st, partId, { djs: cur.concat([p.id]) }, sl => simChem(sl)) / (simChem(slot) || 1)
        : 1;
      const style = uiTagInfo(p);
      const chemTag = pair > 1.02 ? ' · <span style="color:var(--green)">' + esc(tt('chemGood')) + '</span>'
        : pair < 0.98 ? ' · <span style="color:var(--red)">' + esc(tt('chemBad')) + '</span>' : '';
      const others = bookingsOf(p.id);
      // The SAME-DAYPART booking is the one that matters: adding them here
      // silently pulls them off that station. Engineers have named the station
      // and daypart on the row for a while; DJs only said "on 2 slots", which
      // does not tell you what you are about to break. Now they match.
      const clash = others.find(b => b.part === partId && b.idx !== idx) || null;
      body += '<button type="button" class="row' + (clash ? ' warnrow' : good ? '' : ' warnrow') + '" ' +
        'data-addcrew="' + p.id + '" data-slotref="' + ref + '" style="cursor:pointer' +
        (crewFull ? ';opacity:0.55' : '') + '">' +
        '<div class="row-icon">' + (style && style.icon ? esc(style.icon) : '🎧') + '</div>' +
        '<div class="row-body">' +
          '<div class="row-title">' + esc(p.name) + '</div>' +
          '<div class="row-sub">' + esc(t('skill', { n: p.skill })) + chemTag +
            (others.length ? ' · ' + esc(bookingSummary(others)) : '') + '</div>' +
          // The on-air style, from content.js's tagInfo(). It is the reason
          // two skill-6 hosts are not interchangeable, so it belongs on the
          // row where you choose between them.
          (style ? '<div class="row-sub" style="color:var(--cyan)">' + esc(style.name) + '</div>' : '') +
          (clash ? '<div class="row-sub" style="color:var(--amber)">⚠️ ' +
            esc('takes ' + p.name.split(' ')[0] + ' off ' + clash.call + ' ' + partShort(clash.part)) + '</div>' : '') +
          (crewFull ? '<div class="row-sub" style="color:var(--muted)">' +
            esc('crew full — drop someone above first') + '</div>' : '') +
          '<div class="row-sub" style="color:var(--' + (good ? 'green' : 'red') + ')">' +
            esc(good ? tt('addWorth') : tt('addNotWorth')) + '</div>' +
        '</div>' +
        '<div class="row-act">' +
          '<span class="delta-tag ' + (good ? 'up' : 'down') + '">' +
            (good ? '+' : '−') + esc(money(Math.abs(d))) + '</span>' +
        '</div>' +
      '</button>';
    }
  }

  /* --- engineer --- */
  body += '<div class="' + hdrCls + '">' + esc(tt('engTitle')) + '</div>' +
    '<div class="pick-sub">' + esc(tt('roleEngDesc')) + '</div>';

  const engs = staffOf('eng');
  if (!engs.length) {
    body += '<div class="empty" style="padding:14px">' + esc(t('roleEngDesc')) + '</div>';
  } else {
    const engOn = slotEngs(slot);
    const engFull = engOn.length >= uiMaxEng();
    // Say how many of how many are on this booth. Without this the second seat
    // is invisible — you cannot tell "one assigned" from "at the cap".
    body += '<div class="pick-sub" style="margin-top:6px">' +
      esc(engOn.length + ' / ' + uiMaxEng() + ' assigned') +
      (engFull ? ' · ' + esc('tap an assigned engineer to remove them') : '') + '</div>';
    body += '<button type="button" class="row' + (!engOn.length ? ' on' : '') + '" data-seteng="" data-slotref="' + ref + '" style="cursor:pointer">' +
      '<div class="row-icon">🚫</div><div class="row-body">' +
      '<div class="row-title">' + esc(tt('engNone')) + (!engOn.length ? ' ✓' : '') + '</div>' +
      '<div class="row-sub">' + esc(t('unstaffed')) + '</div></div></button>';
    for (const p of engs) {
      const on = engOn.indexOf(p.id) >= 0;
      // At the cap, an unassigned engineer stays VISIBLE but is marked as
      // blocked rather than hidden — the owner's note was that you cannot see
      // who is available, and hiding the bench the moment it matters is exactly
      // how that happens.
      const blocked = !on && engFull;
      const worth = engineerWorth(st, partId, p.id, V);
      // The steal. CONTRACT: one engineer covers one daypart empire-wide, so
      // assigning here silently strips them off another station's slot at the
      // same hour. Silently is exactly how a player loses a station without
      // knowing why, so it is spelled out on the row that would do it.
      let steal = null;
      allStations().forEach((s2, j) => {
        if (j === idx) return;
        if (slotEngs(stSlot(s2, partId)).indexOf(p.id) >= 0) steal = { call: s2.call, part: partId };
      });
      body += '<button type="button" class="row' + (on ? ' on' : steal ? ' warnrow' : '') + '" ' +
        'data-seteng="' + p.id + '" data-slotref="' + ref + '" style="cursor:pointer' +
        (blocked ? ';opacity:0.55' : '') + '">' +
        '<div class="row-icon">🔧</div><div class="row-body">' +
          '<div class="row-title">' + esc(p.name) + (on ? ' ✓' : '') + '</div>' +
          '<div class="row-sub">' + esc(t('skill', { n: p.skill })) +
            (on && engOn.length > 1 && engOn.indexOf(p.id) > 0
              ? ' · ' + esc('second engineer — counts at ' + Math.round((typeof ENG_WEIGHTS !== 'undefined' ? ENG_WEIGHTS[1] : 0.45) * 100) + '%')
              : '') + '</div>' +
          (steal ? '<div class="row-sub" style="color:var(--amber)">⚠️ ' +
            esc(tt('engSteal', { name: p.name.split(' ')[0], call: steal.call, part: partShort(steal.part) })) + '</div>' : '') +
          (blocked ? '<div class="row-sub" style="color:var(--muted)">' +
            esc('booth full — remove one to add them') + '</div>' : '') +
          (on ? '<div class="row-sub" style="color:var(--muted)">' + esc('tap to remove') + '</div>' : '') +
        '</div>' +
        '<div class="row-act"><span class="delta-tag ' + (worth > 0 ? 'up' : 'down') + '">' +
          (worth > 0 ? '+' : '−') + esc(money(Math.abs(worth))) + '</span></div>' +
      '</button>';
    }
  }

  openModal(
    tt('slotTitle', { call: st.call, part: partLabel(partId) }),
    tt('slotSub'),
    body,
    [{ label: t('close'), cls: 'buy', act: () => { closeModal(); saveGame(true); render(); } }],
    { replace: !!redraw }
  );
}

/* --- slot mutations ---------------------------------------------------
   sim.js owns every one of these rules — the three-crew cap, the role check,
   and the "same person, same hour, one place" steal that has to reach across
   every other station. ui.js used to walk S.stations and splice the arrays
   itself, which duplicated the rule in two files and would have gone stale
   the first time sim changed it. All that is left here is: call it, say what
   happened, redraw.
   Every one re-opens the editor in place so the readout at the top updates
   under the same thumb that made the change. */
function afterSlotChange(ref){
  const { idx, part } = parseRef(ref);
  openSlotEditor(idx, part, true);
}
/** The steal is a fact the player has to be told about — they just took an
    engineer off another station's morning drive, on a screen that is not
    showing that station. The row warned them it would happen; this confirms
    it did. */
function noteSteal(stole, id){
  if (!stole) return;
  const p = staffById(id);
  toast('⚠️ ' + (p ? p.name.split(' ')[0] : 'They') + ' pulled off ' +
    stole.call + ' ' + partShort(stole.part), 'bad');
}
function addCrew(ref, id){
  const { idx, part } = parseRef(ref);
  if (typeof addDj !== 'function') { bridgeMiss('addDj'); return; }
  const res = addDj(idx, part, id);
  if (res && res.ok) {
    noteSteal(res.stole, id);
    // sfxChem takes the crew's chemistry MULTIPLIER, not a boolean — it pitches
    // the chime by how well the pair actually works, so a clash sounds like a
    // clash. Read it after the add, from sim's own chem().
    const st = allStations()[idx];
    if (typeof sfxChem === 'function' && st) sfxChem(simChem(stSlot(st, part)));
    else sfxClick();
  } else if (res && res.reason === 'full') {
    toast(tt('crewFull'), 'bad');
  }
  afterSlotChange(ref);
}
function dropCrew(ref, id){
  const { idx, part } = parseRef(ref);
  if (typeof removeDj === 'function') removeDj(idx, part, id);
  else bridgeMiss('removeDj');
  afterSlotChange(ref);
}
/** crewSkill reads the array lead-first (1 / 0.55 / 0.30), so "make lead" is a
    move to index 0 and nothing else. Expressed as a remove-then-add so the
    cap and the cross-station rules stay sim's, not a splice of my own. */
function makeLead(ref, id){
  const { idx, part } = parseRef(ref);
  const st = allStations()[idx];
  if (!st) return;
  const slot = stSlot(st, part);
  const order = slotDjs(slot);
  if (order.indexOf(id) < 0) return;
  const next = [id].concat(order.filter(x => x !== id));
  if (typeof removeDj === 'function' && typeof addDj === 'function') {
    for (const x of order) removeDj(idx, part, x);
    for (const x of next) addDj(idx, part, x);
  } else {
    bridgeMiss('addDj');
    slot.djs = next;
  }
  afterSlotChange(ref);
}
/** v4: the engineer rows are a TOGGLE, not a radio group. Empty id clears the
    booth; an id already on the slot removes that one; otherwise add, up to
    MAX_ENG. Falls back to the v3 single-engineer call if sim is older than the
    renderer, so a half-updated pair degrades instead of throwing. */
function setEng(ref, id){
  const { idx, part } = parseRef(ref);
  if (!id) {
    if (typeof setSlotEngineer !== 'function') { bridgeMiss('setSlotEngineer'); return; }
    setSlotEngineer(idx, part, null);
    afterSlotChange(ref);
    return;
  }
  if (typeof addEngineer !== 'function' || typeof removeEngineer !== 'function') {
    if (typeof setSlotEngineer !== 'function') { bridgeMiss('addEngineer'); return; }
    const res = setSlotEngineer(idx, part, id);
    if (res && res.ok) noteSteal(res.stole, id);
    afterSlotChange(ref);
    return;
  }
  const st = allStations()[idx];
  const on = slotEngs(stSlot(st, part)).indexOf(id) >= 0;
  if (on) {
    removeEngineer(idx, part, id);
  } else {
    const res = addEngineer(idx, part, id);
    if (res && res.ok) noteSteal(res.stole, id);
    else if (res && res.reason === 'full') toast('🔧 ' + esc('Booth full — remove an engineer first'), 'bad');
  }
  afterSlotChange(ref);
}
function setShow(ref, key){
  const { idx, part } = parseRef(ref);
  if (typeof setSlotShow === 'function') setSlotShow(idx, part, key);
  else bridgeMiss('setSlotShow');
  afterSlotChange(ref);
}

/* ---------------- flows ---------------- */

function promptNewGame(){
  const start = () => {
    const input = document.querySelector('#modal input');
    let call = ((input && input.value) || '').trim().toUpperCase();
    // Enforce what newStationSub actually promises. The old rule accepted
    // 'ZZZZ' and even a single letter, and a one-character callsign renders
    // into the scene billboards and vehicle wraps looking broken.
    call = call.replace(/[^A-Z]/g, '');
    if (!/^[KW][A-Z]{3}$/.test(call)) call = randomCall();
    // Same sanitize() the load path runs, so a new run and a resumed run are
    // byte-for-byte the same shape of state.
    S = sanitize(newState(call));
    refreshCandidates();
    addLog('You signed on the air as ' + call + '.', 'big');
    closeModal();
    enterGame();
    // No intro modal. The coach card is already on screen under the dial by
    // the time this toast fades — see viewCoach().
    toast('📻 ' + tt('welcomeToast'), 'good');
  };

  // Pre-filled rather than placeholder: what you see is what you get if you
  // just hit Start.
  const body = '<input id="call-input" maxlength="4" value="' + randomCall() + '" ' +
    'style="width:100%;padding:14px;border-radius:10px;background:var(--panel2);border:1px solid var(--border-lit);' +
    'color:var(--text);font-size:22px;font-weight:900;letter-spacing:5px;text-align:center;text-transform:uppercase;font-family:inherit">';

  openModal(t('newStationTitle'), t('newStationSub'), body, [
    { label: t('randomize'), cls: 'ghost', act: () => { const i = document.querySelector('#modal input'); if (i) i.value = randomCall(); } },
    { label: t('start'), cls: 'buy', act: start }
  ]);
  setTimeout(() => {
    const i = document.querySelector('#modal input');
    if (!i) return;
    i.focus();
    i.select();
    // Live filtering, so the field can only ever hold letters — and Enter
    // signs on rather than doing nothing.
    i.addEventListener('input', () => {
      const clean = i.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (clean !== i.value) i.value = clean;
    });
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); start(); } });
  }, 60);
}

function enterGame(){
  if (!S.candidates.length) refreshCandidates();
  loadCoach();
  applyMotionPref();
  showScreen('game');
  activeTab = 'studio';
  // NOT reset to 0: S.active came out of the save, and landing back on the
  // station you were looking at is the whole reason it lives there.
  // Force the cached scene, the switcher and every pane to rebuild for this
  // run, and drop any HUD deltas left over from the previous one.
  sceneKey = '';
  stationBarKey = '';
  pendingSegment = null;
  ['studio-coach', 'studio-grid', 'pane-gear', 'pane-staff', 'pane-empire', 'pane-log', 'hud-warn']
    .forEach(id => { const el = $(id); if (el) el._uiHtml = null; });
  resetHudDeltas();
  // Once per run — render() only toggles classes on the bar from here on.
  buildTabs();
  setTab('studio');
  startAllTimers();
}

function openPauseMenu(){
  // Single guard for every way in here — Escape, the HUD button, gamepad B and
  // gamepad Start. The Escape handler had this rule inline; Start did not, so a
  // pad could queue a pause menu behind the blocking bankruptcy ending (and set
  // autoPaused on a run that no longer has a clock to resume). The mouse was
  // safe only because .modal-back covers the screen when it is open.
  if (!S || $('modal-back').classList.contains('open')) return;
  // Only claim the resume if the clock was actually running. autoPaused means
  // "this modal stopped the sim and owes it a restart", and setting it
  // unconditionally made the menu hand back a clock it never took: pause with
  // gamepad X, open the menu, close it, and the game was quietly running again
  // with the paused badge gone. The Options hand-off below relies on the same
  // flag, so it has to mean what it says.
  const wasRunning = running;
  const st = curStation();
  /* RAISE the flag, never lower it — the same rule modalPause() in sim.js
     documents and follows. Assigning it here meant that opening the pause menu
     over an ALREADY-stopped clock (an event modal drained a moment earlier, or
     a gamepad-X pause) cleared the earlier modal's claim, so Resume closed the
     dialog and restarted nothing. The paused chip is a span, not a button, so
     the only escape was Main Menu. That is a soft-lock, and sim.js:1546 names
     this exact pause-menu case in its comment. */
  pauseTick();
  if (wasRunning) autoPaused = true;
  openModal(t('paused'), (st ? st.call + ' · ' : '') + t('day', { n: S.day }), '', [
    /* Resume means RUN, unconditionally. Leaving this to closeModal()'s
       autoPaused convergence made it a no-op whenever the pause menu was opened
       over an already-stopped clock: the button was pressed, the dialog closed,
       and the game stayed frozen with no other way out. An explicit command
       from the player must not depend on which modal happens to hold the
       resume claim. */
    { label: t('resume'), cls: 'buy', act: () => { autoPaused = false; closeModal(); resumeTick(); } },
    { label: t('save'), cls: '', act: () => { saveGame(); } },
    // Hand the pause off to the Options screen: btn-opt-back resumes on the
    // way out, so closeModal() must NOT resume underneath it.
    { label: t('options'), cls: '', act: () => { autoPaused = false; closeModal(); openOptions('game', wasRunning); } },
    { label: t('mainMenu'), cls: 'danger', act: () => returnToMenu({ save: true }) }
  ]);
}

/* ---------------- options ---------------- */

let optionsReturn = 'menu';
/** Whether backing out of Options owes the sim a restart. The pause menu is the
    only caller that can be over a live game, and it may itself have been opened
    over a clock the player had already stopped with gamepad X — in which case
    Back has to leave it stopped, same rule as autoPaused. */
let optionsResume = false;

function openOptions(from, resumeOnExit){
  optionsReturn = from || 'menu';
  optionsResume = !!resumeOnExit;
  $('opt-title').textContent = t('optTitle');
  renderOptions();
  showScreen('options');
}

function renderOptions(){
  // With a station loaded the run owns its settings; from the main menu the
  // standalone gOpts copy is the live one.
  const o = S ? S.opts : gOpts;
  let h = '';
  h += '<div class="opt-row"><div><div class="opt-lbl">' + esc(t('optSpeed')) + '</div><div class="opt-desc">' + esc(t('optSpeedDesc')) + '</div></div>' +
    '<div class="seg">' + [1,2,3].map(v =>
      '<button class="seg-btn' + (o.speed === v ? ' on' : '') + '" data-speed="' + v + '">' + v + '×</button>'
    ).join('') + '</div></div>';

  h += optToggle('autosave', o.autosave, t('optAutosave'), t('optAutosaveDesc'));
  h += optToggle('eventPopups', o.eventPopups, t('optEvents'), t('optEventsDesc'));
  h += optToggle('reducedMotion', o.reducedMotion, t('optMotion'), t('optMotionDesc'));
  h += optToggle('sound', o.sound, t('optSound'), t('optSoundDesc'));

  h += '<div class="opt-row"><div><div class="opt-lbl">' + esc(t('optWipe')) + '</div><div class="opt-desc">' + esc(t('optWipeDesc')) + '</div></div>' +
    '<button class="btn danger" id="btn-wipe">' + esc(t('wipe')) + '</button></div>';

  $('options-body').innerHTML = h;
}

function optToggle(key, val, label, desc){
  return '<div class="opt-row"><div><div class="opt-lbl">' + esc(label) + '</div><div class="opt-desc">' + esc(desc) + '</div></div>' +
    '<button class="switch' + (val ? ' on' : '') + '" data-opt="' + key + '" ' +
    'aria-label="' + esc(label) + '" aria-pressed="' + !!val + '"></button></div>';
}

function applyMotionPref(){
  const o = S ? S.opts : gOpts;
  document.body.classList.toggle('no-motion', !!o.reducedMotion);
}

/* ---------------- menu ---------------- */

function refreshMenu(){
  $('menu-tagline').textContent = t('tagline');
  $('menu-badge').textContent = t('onair');
  $('menu-foot').textContent = t('foot');
  $('btn-new').textContent = t('newGame');
  $('btn-continue').textContent = t('continueGame');
  $('btn-options').textContent = t('options');
  $('btn-quit').textContent = t('quit');
  $('lbl-cash').textContent = t('cash');
  $('lbl-listeners').textContent = t('listeners');
  $('lbl-rep').textContent = t('rep');

  // Rebuilt here rather than once at boot so it follows the save: wiping,
  // starting over or upgrading the transmitter all change what the menu shows.
  buildMenuScene();

  const save = hasSave();
  $('btn-continue').disabled = !save;
  if (save) {
    // sim.js's saveHeadline() reads the raw save for us. This used to dig
    // `d.call` out of the JSON by hand, which is precisely the read that broke
    // when the callsign moved into stations[0] — one function, one place, and
    // it already handles both shapes plus the try/catch.
    const head = (typeof saveHeadline === 'function') ? saveHeadline() : null;
    if (head) {
      $('btn-continue').textContent = t('continueGame') + ' · ' + head.call +
        (head.stations > 1 ? ' +' + (head.stations - 1) : '') +
        ' · ' + t('day', { n: head.day });
    }
  }
}

/* ---------------- events ---------------- */

function wire(){
  $('btn-new').onclick = () => {
    if (hasSave()) {
      openModal(t('newGame'), 'Starting fresh overwrites your current station.', '', [
        { label: t('cancel'), cls: 'ghost', act: closeModal },
        { label: t('newGame'), cls: 'danger', act: () => { closeModal(); promptNewGame(); } }
      ]);
    } else promptNewGame();
  };
  $('btn-continue').onclick = () => {
    const s = loadGame();
    if (!s) { toast(t('loadFail'), 'bad'); refreshMenu(); return; }
    // Belt and braces for saves written before the bankruptcy guard landed:
    // a dead station would otherwise load straight back into its own ending.
    if (s.dead || s.cash <= BANKRUPTCY_FLOOR) {
      wipeSave(); toast(t('loadFail'), 'bad'); refreshMenu(); return;
    }
    S = s;
    // AFTER enterGame(), because enterGame() ends in startAllTimers() and would
    // undo the pause catchUp() takes behind its modal. Nothing is lost by the
    // reorder: setInterval never fires synchronously, so the lump sum still
    // lands before the first tick can, and the game screen exists for the
    // render() catchUp() does.
    enterGame();
    catchUp();
  };
  $('btn-options').onclick = () => openOptions('menu');
  $('btn-quit').onclick = () => {
    if (S) saveGame(true);
    openModal(t('quit'), 'Your station is saved. You can close this tab.', '', [
      { label: t('close'), cls: 'buy', act: closeModal }
    ]);
  };
  $('btn-pause').onclick = openPauseMenu;
  $('btn-opt-back').onclick = () => {
    if (S) saveGame(true);
    applyMotionPref();
    if (optionsReturn === 'game') {
      showScreen('game'); render();
      // setPausedUI() in the else branch, not nothing: the badge has to still
      // be there for a game we are deliberately leaving stopped.
      if (optionsResume) resumeTick(); else setPausedUI();
    }
    else { showScreen('menu'); refreshMenu(); }
  };

  // Delegated clicks — the whole UI is re-rendered HTML, so nothing binds directly.
  document.addEventListener('click', e => {
    // One shared click blip for any interactive control; buy/hire/train get
    // their own richer sfxBuy() on top of this further down.
    if (e.target.closest('.btn:not(:disabled), .mbtn:not(:disabled), .tab, .hud-btn, .seg-btn, .switch, .slot, .st-chip, .cov-cell, .seg-card')) sfxClick();

    // Station switching comes first: the chips carry data-station and nothing
    // else in the file does, and the Empire tab's "Switch" buttons reuse it.
    const stBtn = e.target.closest('[data-station]');
    if (stBtn) { setStation(+stBtn.dataset.station); return; }

    const tab = e.target.closest('[data-tab]');
    if (tab) return setTab(tab.dataset.tab);

    const act = e.target.closest('[data-modal-act]');
    if (act) { const a = modalActions[+act.dataset.modalAct]; if (a && a.act) a.act(); return; }

    const coachB = e.target.closest('[data-coach]');
    if (coachB) {
      const step = COACH.find(c => c.id === coachB.dataset.coach);
      const btn = step && step.btn ? step.btn() : null;
      if (btn && btn.run) btn.run();
      return;
    }
    const coachAckB = e.target.closest('[data-coachack]');
    if (coachAckB) return coachAck(coachAckB.dataset.coachack);

    const buy = e.target.closest('[data-buy]');
    if (buy && !buy.disabled) return buyGear(buy.dataset.buy);

    const hireB = e.target.closest('[data-hire]');
    if (hireB && !hireB.disabled) return hirePerson(hireB.dataset.hire);

    const fireB = e.target.closest('[data-fire]');
    if (fireB) return firePerson(fireB.dataset.fire);

    const trainB = e.target.closest('[data-train]');
    if (trainB && !trainB.disabled) return trainPerson(trainB.dataset.train);

    const segB = e.target.closest('[data-seg]');
    if (segB) {
      pendingSegment = pendingSegment === segB.dataset.seg ? null : segB.dataset.seg;
      $('pane-empire')._uiHtml = null;
      render();
      return;
    }
    const reviewB = e.target.closest('#btn-found-review');
    if (reviewB && !reviewB.disabled) return reviewFounding();

    // The picker rows live inside the slot editor's modal, so they must be
    // tested BEFORE the studio slot that opened it — and each row carries its
    // own station+daypart reference rather than reading it back off the modal
    // element. With four stations sharing one editor, a modal that remembered
    // which slot it was for in a module variable is a bug waiting for the
    // first player who opens two in a row.
    const setShowB = e.target.closest('[data-setshow]');
    if (setShowB) return setShow(setShowB.dataset.slotref, setShowB.dataset.setshow);

    const addB = e.target.closest('[data-addcrew]');
    if (addB) return addCrew(addB.dataset.slotref, addB.dataset.addcrew);

    const dropB = e.target.closest('[data-dropcrew]');
    if (dropB) return dropCrew(dropB.dataset.slotref, dropB.dataset.dropcrew);

    const leadB = e.target.closest('[data-leadcrew]');
    if (leadB) return makeLead(leadB.dataset.slotref, leadB.dataset.leadcrew);

    const engB = e.target.closest('[data-seteng]');
    if (engB) return setEng(engB.dataset.slotref, engB.dataset.seteng);

    const slotEl = e.target.closest('[data-openslot]');
    if (slotEl) {
      const r = parseRef(slotEl.dataset.openslot);
      // Opening another station's cell from the coverage grid moves the camera
      // too, so closing the editor does not leave the player looking at a
      // schedule that is not the one they just edited.
      if (r.idx !== curIndex()) setStation(r.idx);
      return openSlotEditor(r.idx, r.part);
    }

    // Both of these used to be gated on a live game, so every control on the
    // main-menu Settings screen was dead and renderOptions() visibly snapped
    // the switch back. They now always write, to S.opts or to gOpts.
    const sp = e.target.closest('[data-speed]');
    if (sp) {
      const tgt = S ? S.opts : gOpts;
      tgt.speed = +sp.dataset.speed;
      if (S) { gOpts = Object.assign({}, S.opts); if (running) startAllTimers(); }
      writeOpts(gOpts);
      renderOptions();
      return;
    }
    const op = e.target.closest('[data-opt]');
    if (op) {
      const tgt = S ? S.opts : gOpts;
      tgt[op.dataset.opt] = !tgt[op.dataset.opt];
      if (S) gOpts = Object.assign({}, S.opts);
      writeOpts(gOpts);
      applyMotionPref();
      renderOptions();
      return;
    }
    if (e.target.closest('#btn-wipe')) {
      openModal(t('wipeConfirm'), t('wipeConfirmSub'), '', [
        { label: t('cancel'), cls: 'ghost', act: closeModal },
        // resetCoach() too: deleting the save is the one place a player has
        // said "start me over", and the first-days guidance is part of what
        // they are starting over. Everywhere else it deliberately persists.
        { label: t('wipe'), cls: 'danger', act: () => { resetCoach(); returnToMenu({ wipe: true }); } }
      ]);
      return;
    }
    // A blocking modal (the bankruptcy ending) can't be dismissed into a
    // zombie run — its own button is the only way out.
    if (e.target === $('modal-back') && !modalOpts.blocking) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('modal-back').classList.contains('open')) {
        // Same rule as the backdrop: a blocking modal ignores Escape.
        if (modalOpts.blocking) return;
        closeModal();
      } else if ($('screen-game').classList.contains('active')) openPauseMenu();
      return;
    }
    // Everything below is a bare-key shortcut, so it must never fire while the
    // callsign field has focus — typing "W" into it would otherwise also try
    // to switch to a station that does not exist.
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$('screen-game').classList.contains('active')) return;
    if ($('modal-back').classList.contains('open')) return;
    // Keyboard parity with the pad: number keys are tabs, brackets are
    // stations, P is the clock. None of these is the ONLY route to anything —
    // every one of them has a button on screen.
    if (e.key >= '1' && e.key <= String(TABS.length)) { setTab(TABS[+e.key - 1].id); return; }
    if (e.key === '[') { setStation(curIndex() - 1); return; }
    if (e.key === ']') { setStation(curIndex() + 1); return; }
    if (e.key === 'p' || e.key === 'P') {
      if (S) { running ? pauseTick() : resumeTick(); toast(running ? '▶️ Running' : '⏸️ Paused'); }
    }
  });

  // Don't keep simulating in a hidden tab — and save on the way out, because
  // a backgrounded mobile tab is often never coming back.
  // Invariant: `running` means "the player wants the sim advancing"; `timer`
  // means "it currently is". Backgrounding clears the timer but deliberately
  // leaves running true, so returning to the tab resumes rather than
  // un-pausing a game the player had paused on purpose.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Pin the offline window at the moment we go dark, not at the last tick
      // (up to a whole day-length earlier), and write that stamp to disk so a
      // tab the OS evicts and never wakes still pays out on the next Continue.
      // saveGame() will not overwrite it while `running` is true.
      if (S) { S.lastTick = Date.now(); saveGame(true); }
      if (running) { stopTick(); running = true; }
    } else if (S) {
      if (running) {
        // catchUp() stops the clock behind its own modal, like every other modal
        // in the game — so only restart the tick if it didn't, or we'd be racing
        // the resume that closeModal() already owns.
        catchUp();
        render();
        if (running) startTick();
      } else {
        // A paused absence earns nothing — the same rule saveGame()'s
        // `if (!running)` stamp already encodes. Without this, a game paused
        // behind a modal (or by gamepad X) with autosave off kept the stale
        // hidden-branch stamp: nothing refreshed lastTick while the sim was
        // stopped, so resuming and then closing the tab wrote hours-old time to
        // disk and the next Continue paid out the full offline cap for an
        // absence the station spent silent. Void the window instead.
        S.lastTick = Date.now();
      }
    }
  });
  // pagehide fires where beforeunload doesn't (iOS Safari, Android tab
  // eviction); beforeunload stays for desktop.
  window.addEventListener('pagehide', () => { if (S) saveGame(true); });
  window.addEventListener('beforeunload', () => { if (S) saveGame(true); });
}

/* ---------------- gamepad (Xbox / standard mapping) ----------------
   The whole UI is DOM, so the pad drives a focus cursor rather than a
   character. Spatial nav (nearest element in the pressed direction) keeps
   the 2x2 schedule grid — and the 4x4 coverage matrix — feeling right instead
   of a flat list walk.
   A=activate  B=back  X=pause/resume  Y=save  LB/RB=tabs  LT/RT=station
   Start=menu                                                             */

const PAD = { A:0, B:1, X:2, Y:3, LB:4, RB:5, LT:6, RT:7, BACK:8, START:9, UP:12, DOWN:13, LEFT:14, RIGHT:15 };
// Every interactive class in the file. Anything added to the UI that is not
// in here is a control a pad player cannot reach — which, in a game whose
// pause menu, save and main menu all live behind one button, is the same bug
// as not shipping the button.
const FOCUS_SEL = '.mbtn:not(:disabled), .tab, .btn:not(:disabled), .slot, .switch, .seg-btn, ' +
  '.hud-btn, .st-chip, .cov-cell, .seg-card, .hint, .hud-warn:not([hidden]), ' +
  '[data-setshow], [data-addcrew], [data-dropcrew], [data-leadcrew], [data-seteng]';

let padOn = false;
let padIdx = -1;
let prevBtn = {};
let repeatAt = 0;
// With no controller attached the loop still called getGamepads() and
// allocated an array 60x a second, forever, on a menu that is otherwise
// event-driven. 4Hz detection latency is imperceptible when you plug one in.
let lastPoll = 0;

function padScope(){
  if ($('modal-back').classList.contains('open')) return $('modal');
  if ($('screen-menu').classList.contains('active')) return $('screen-menu');
  if ($('screen-options').classList.contains('active')) return $('screen-options');
  return $('screen-game');
}
function focusables(){
  return Array.from(padScope().querySelectorAll(FOCUS_SEL))
    .filter(el => el.offsetParent !== null && !el.disabled);
}
function currentFocus(){
  const list = focusables();
  return { list, el: list[padIdx] || null };
}
function paintFocus(el){
  document.querySelectorAll('.gp-focus').forEach(n => n.classList.remove('gp-focus'));
  if (!el) return;
  el.classList.add('gp-focus');
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function setFocus(i){
  const list = focusables();
  if (!list.length) { padIdx = -1; paintFocus(null); return; }
  padIdx = clamp(i, 0, list.length - 1);
  paintFocus(list[padIdx]);
}

/** Nearest focusable in a direction, weighting cross-axis drift heavily so
    "down" prefers the thing below rather than something far to the side. */
function moveFocus(dx, dy){
  const { list, el } = currentFocus();
  if (!list.length) return;
  if (!el) return setFocus(0);
  const a = el.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  list.forEach((n, i) => {
    if (n === el) return;
    const r = n.getBoundingClientRect();
    const bx = r.left + r.width / 2, by = r.top + r.height / 2;
    const along = (bx - ax) * dx + (by - ay) * dy;
    if (along <= 4) return;                       // not in the pressed direction
    const cross = Math.abs((bx - ax) * dy - (by - ay) * dx);
    const score = along + cross * 3;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  if (best !== null) setFocus(best);
}

function padActivate(){
  const { el } = currentFocus();
  if (!el) return setFocus(0);
  el.click();
  // The click almost always re-renders; re-anchor onto the same position.
  setTimeout(() => setFocus(padIdx), 30);
}
function padBack(){
  if ($('modal-back').classList.contains('open')) {
    // Same rule as Escape and the backdrop click: a blocking modal (the
    // bankruptcy ending) is only leavable through its own button. B used to
    // fall through the cancel/close/resume match to a bare closeModal(), which
    // dismissed the terminal ending and dropped the player back onto a live
    // game screen with S.dead === true and the pre-death autosave still on
    // disk — Continue then reloaded the corpse.
    if (modalOpts.blocking) return;
    // Prefer the modal's own cancel/close so its side effects still run.
    const btns = Array.from($('modal').querySelectorAll('[data-modal-act]'));
    const cancel = btns.find(b => /cancel|close|resume/i.test(b.textContent));
    if (cancel) cancel.click(); else closeModal();
  } else if ($('screen-options').classList.contains('active')) {
    $('btn-opt-back').click();
  } else if ($('screen-game').classList.contains('active')) {
    openPauseMenu();
  }
  setTimeout(() => setFocus(0), 40);
}
function cycleTab(dir){
  if (!$('screen-game').classList.contains('active')) return;
  if ($('modal-back').classList.contains('open')) return;
  const i = TABS.findIndex(x => x.id === activeTab);
  setTab(TABS[(i + dir + TABS.length) % TABS.length].id);
  setTimeout(() => setFocus(0), 40);
}
/** Triggers walk the empire. Without this a pad player can reach every
    control on one station and has to steer the cursor into the switcher strip
    to see any of the others — which is exactly the "playable with a
    controller, navigable only with a mouse" half-ship. */
function cycleStation(dir){
  if (!$('screen-game').classList.contains('active')) return;
  if ($('modal-back').classList.contains('open')) return;
  const n = stationCount();
  if (n < 2) return;
  setStation((curIndex() + dir + n) % n);
  const st = curStation();
  if (st) toast('📻 ' + st.call);
  setTimeout(() => setFocus(0), 40);
}

/* Frame loop only while a controller is actually in use.

   pollPad() used to end with an unconditional requestAnimationFrame(pollPad),
   so a frame callback stayed permanently pending whether or not a pad was
   connected, the tab was visible, or the game was paused. Measured: 1.43% CPU
   on a PAUSED game with no controller attached and reduced motion on — 48x the
   0.03% idle floor, and the single largest power cost in the game. An idle
   tycoon gets left open for hours on a phone, so this is a battery bug.

   With no pad we probe on a 500ms handle-tracked interval instead, which is far
   more often than a human can plug one in unnoticed and ~30x cheaper than a
   frame loop. The rAF loop starts the moment a pad appears. Handles are tracked
   and cleared per the vault's interval-hygiene rule. */
let padRaf = null, padProbe = null;
function padStopProbe(){ if (padProbe !== null) { clearInterval(padProbe); padProbe = null; } }
function padStartProbe(){ if (padProbe === null) padProbe = setInterval(pollPad, 500); }
/** Decide how pollPad() gets its next tick. The single exit point of the loop. */
function padNext(){
  padRaf = null;
  if (padOn && !document.hidden) { padStopProbe(); padRaf = requestAnimationFrame(pollPad); }
  else padStartProbe();
}
/** Drop every pad timer — menu transitions and teardown. */
function padStop(){
  if (padRaf !== null) { cancelAnimationFrame(padRaf); padRaf = null; }
  padStopProbe();
}
function pollPad(){
  const now = performance.now();
  if (!padOn && now - lastPoll < 250) { padNext(); return; }
  lastPoll = now;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = Array.from(pads).find(p => p && p.connected);
  if (gp) {
    if (!padOn) {
      padOn = true;
      document.body.classList.add('pad-on');
      toast('🎮 Controller connected — A select, B back, LB/RB tabs, LT/RT stations', 'good');
      setFocus(0);
    }
    const down = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const hit = i => { const d = down(i); const was = prevBtn[i]; prevBtn[i] = d; return d && !was; };

    // Stick + d-pad share a repeat timer so held input scrolls at a sane rate.
    // 0.55, not the 0.15 movement deadzone: this cursor takes a DISCRETE step
    // per push, and at 0.15 a worn stick's resting drift walks the focus ring
    // across the screen on its own. The 0.15 figure is for analog movement,
    // which this game does not have.
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const DZ = 0.55;
    let dx = 0, dy = 0;
    if (down(PAD.LEFT) || ax < -DZ) dx = -1;
    else if (down(PAD.RIGHT) || ax > DZ) dx = 1;
    else if (down(PAD.UP) || ay < -DZ) dy = -1;
    else if (down(PAD.DOWN) || ay > DZ) dy = 1;

    if (dx || dy) {
      if (now >= repeatAt) { moveFocus(dx, dy); repeatAt = now + (repeatAt ? 140 : 340); }
    } else repeatAt = 0;

    if (hit(PAD.A)) padActivate();
    if (hit(PAD.B)) padBack();
    if (hit(PAD.LB)) cycleTab(-1);
    if (hit(PAD.RB)) cycleTab(1);
    if (hit(PAD.LT)) cycleStation(-1);
    if (hit(PAD.RT)) cycleStation(1);
    // openPauseMenu() itself refuses while any modal is up, blocking or not.
    if (hit(PAD.START)) { if ($('screen-game').classList.contains('active')) openPauseMenu(); }
    if (hit(PAD.X)) {
      // No state means no clock to toggle — and never return out of pollPad
      // here, or the rAF loop at the bottom stops rescheduling itself.
      if (S && $('screen-game').classList.contains('active') && !$('modal-back').classList.contains('open')) {
        // resumeTick(), not startAllTimers(): pauseTick() never touched
        // autosaveTimer so there is nothing to restore, and going through
        // startTick() gives the gamepad resume the same lastTick stamp every
        // other resume gets.
        running ? pauseTick() : resumeTick();
        toast(running ? '▶️ Running' : '⏸️ Paused');
      }
    }
    if (hit(PAD.Y)) { if (S) saveGame(); }
  } else if (padOn) {
    padOn = false;
    document.body.classList.remove('pad-on');
    paintFocus(null);
  }
  padNext();
}

function initPad(){
  // padOn=false so the next poll re-runs the connect branch and re-toasts.
  window.addEventListener('gamepadconnected', () => { padOn = false; padStop(); padRaf = requestAnimationFrame(pollPad); });
  window.addEventListener('gamepaddisconnected', () => { padOn = false; padStop(); padStartProbe(); });
  // A hidden tab gets no frames anyway; drop to the probe so we are not holding
  // a pending callback the browser will fire in a burst on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { padStop(); padStartProbe(); }
    else if (padOn) { padStop(); padRaf = requestAnimationFrame(pollPad); }
  });
  padStartProbe();
}

/* ---------------- boot ---------------- */

/** The menu used to be four buttons on a flat gradient while the game shipped
    a six-tier CSS station scene it never touched. Decorative only: no pointer
    events, no focus stops, and it inherits the body.no-motion gate. */
function buildMenuScene(){
  if (typeof SCENE_TIERS === 'undefined' || !SCENE_TIERS[2]) return;
  // Broadcast Tower reads best at menu scale; with a save on disk, show the
  // player their own city instead so Continue previews where they left off.
  let tier = 2, save = null;
  if (hasSave()) {
    save = loadGame();
    // sceneTier() takes the save it was handed — this runs with S still null,
    // so it cannot be allowed to fall back to the running station.
    if (save) { try { tier = sceneTier(save, 0); } catch (e) { tier = 2; } }
  }
  const art = SCENE_TIERS[tier] || SCENE_TIERS[2];
  let html = art.html;
  // fx.js's fxBrandArt() does the branding, and it does more than the three
  // string replacements this used to do by hand: the art has several signs in
  // it and it names a DIFFERENT station on each one, so a four-station empire
  // advertises four callsigns instead of the same one four times.
  if (save) {
    if (typeof fxBrandArt === 'function') html = fxBrandArt(html, save, 0);
    else {
      bridgeMiss('fxBrandArt');
      const st0 = Array.isArray(save.stations) ? save.stations[0] : null;
      const call = (st0 && st0.call) || save.call;
      const freq = (st0 && st0.freq) || save.freq;
      if (call) {
        html = html.replace(/CALLSIGNS/g, esc(call))
                   .replace(/98\.6 FM/g, esc(freq + ' FM'))
                   .replace(/98\.6/g, esc(freq));
      }
    }
  }
  const old = $('screen-menu').querySelector('.menu-scene');
  if (old) old.remove();
  const host = document.createElement('div');
  host.className = 'menu-scene';
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = '<div class="menu-scene-art">' + html + '</div>';
  $('screen-menu').insertBefore(host, $('screen-menu').firstChild);
}

function boot(){
  if (typeof SCENE_CSS !== 'undefined' && SCENE_CSS) {
    const st = document.createElement('style');
    st.textContent = SCENE_CSS;
    document.head.appendChild(st);
  }
  wire();
  // Apply the stored motion preference to the menu too, not just to a run.
  applyMotionPref();
  initPad();
  refreshMenu();
  showScreen('menu');
}
boot();
