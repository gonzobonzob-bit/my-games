// Callsigns — sim: helpers, game state, the daily simulation and economy, the tick
// clock and timers, save/load/migrate/sanitize, offline catch-up.
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing one top-level scope; load order: content, sim, fx, ui.
// Carved verbatim from the single-file v1 at the 50% checkpoint — refactor
// only: same 'callsigns.save' key, same v2 state shape, identical behavior.
// The v3 empire work builds on this against CONTRACT.md at 75%.
'use strict';

/* ---------------- helpers ---------------- */

const $  = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const pick  = a => a[Math.floor(Math.random()*a.length)];
const randInt = (a,b) => a + Math.floor(Math.random()*(b-a+1));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
  const neg = n < 0; n = Math.abs(Math.round(n));
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
/** Salary must stay well under the revenue a hire unlocks, or hiring is a
    trap and the whole staff pillar is dead weight. Tuned against balance.js. */
function salaryFor(role, skill){
  return Math.round(ROLES[role].baseSalary * (0.50 + skill * 0.18));
}
function hireFee(p){ return p.salary * 8; }
/** Steeper than it looks: the 1->10 ladder runs about $39,600, so the late
    game still has something worth saving for. The first step stays cheap. */
function trainCostFor(skill){ return Math.round(200 * Math.pow(1.62, skill)); }

function makePerson(role, repLevel){
  const spread = 2 + Math.floor(repLevel / 22);
  const skill = clamp(randInt(1, 3 + spread), 1, 10);
  return {
    id: 'p' + Math.random().toString(36).slice(2, 9),
    name: pick(FIRST) + ' ' + pick(LAST),
    role, skill,
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
  try { return Object.assign({}, DEFAULT_OPTS, JSON.parse(localStorage.getItem(OPTS_KEY)) || {}); }
  catch (e) { return Object.assign({}, DEFAULT_OPTS); }
}
function writeOpts(o){ try { localStorage.setItem(OPTS_KEY, JSON.stringify(o)); } catch (e) {} }

let gOpts = readOpts();

function newState(call){
  return {
    v: SAVE_VER,
    call: call || randomCall(),
    // Commercial band only, on legal odd tenths: 88.1-91.9 is the reserved
    // non-commercial band a licensee like this could never hold.
    freq: (92.1 + randInt(0, 79) * 0.2).toFixed(1),
    day: 1,
    cash: 800,
    listeners: 40,
    rep: 5,
    // Audience momentum. Random events push this around; simulateDay() decays
    // it back toward 1.0 so a viral clip is a spike, not a permanent tier.
    buzz: 1,
    tx: 0, ant: 0,
    schedule: {
      morning: { show: 'music', dj: null },
      midday:  { show: 'music', dj: null },
      evening: { show: 'talk',  dj: null },
      night:   { show: 'music', dj: null }
    },
    staff: [],
    // The hiring pool is part of the run, not a free reroll: it used to be a
    // module global, so Pause -> Main Menu -> Continue re-rolled talent until
    // a 10-skill DJ turned up.
    candidates: [],
    nextHireDay: 7,
    log: [],
    unlockedExpansion: false,
    // Acknowledgement flags. Without seenExpansion the Empire tab badge stayed
    // lit forever, including long after the second station was founded; without
    // seenIntro, Continue would replay the onboarding modal every load.
    seenExpansion: false,
    seenIntro: false,
    secondStation: null,
    lastDay: { listeners: 0, revenue: 0, costs: 0, net: 0, quality: 0, network: 0, royalties: 0, repTarget: 0 },
    opts: Object.assign({}, gOpts),
    stats: { totalEarned: 0, totalCosts: 0, peakListeners: 40, daysOnAir: 0 },
    // Wall-clock stamp for offline catch-up (CLAUDE.md: idle/tycoon games).
    lastTick: Date.now()
  };
}

/* ---------------- simulation ---------------- */

function staffOf(role){ return S.staff.filter(p => p.role === role); }
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
function engBonus(){ return Math.min(0.42, roleStrength('eng') * 0.035); }
/** A half-full log is the floor, not a third: the old 0.30 baseline made the
    first two weeks a dead zone, and the old ceiling made sales a ~5.5x
    multiplier that dwarfed the entire transmitter ladder. Now ~2.7x. */
function salesFill(){ return clamp(0.50 + roleStrength('sales') * 0.040, 0.50, 0.95); }
function salesPrice(){ return 1 + roleStrength('sales') * 0.030; }

/** How many slots a DJ is booked on — working the whole day wears them down. */
function djLoad(id){
  return DAYPARTS.reduce((n, p) => n + (S.schedule[p.id].dj === id ? 1 : 0), 0);
}
function djFatigue(id){ return clamp(1 - 0.18 * (djLoad(id) - 1), 0.40, 1); }

function reachValue(){ return TX[S.tx].reach * (1 + engBonus() * 0.5); }
// Engineers contribute at half weight here, matching reachValue(): at full
// weight a single good engineer pinned the retention clamp on ANT[3], which
// made the $88,000 top antenna worth exactly nothing.
function fidelityValue(){ return ANT[S.ant].fid * (1 + engBonus() * 0.5); }

function djFor(slot){
  if (!slot.dj) return null;
  return S.staff.find(p => p.id === slot.dj) || null;
}

/** One broadcast day. Returns a report object. */
function simulateDay(){
  const fid = fidelityValue();
  const reach = reachValue();
  // Headroom above the best reachable fidelity (2.00 * 1.21 = 2.42 -> 1.888),
  // so no antenna tier is ever clamped into being worthless. The old 0.5 floor
  // was unreachable dead code — minimum fid is 1.00.
  const retention = clamp(fid * 0.78, 0.60, 1.95);
  const fill = salesFill();
  const price = salesPrice();

  let totalListeners = 0, revenue = 0, qualitySum = 0, repPressure = 0;

  for (const part of DAYPARTS) {
    const slot = S.schedule[part.id];
    const show = SHOWS[slot.show];
    const dj = djFor(slot);
    // Fatigue makes four dedicated DJs beat one host pulling a double shift.
    const djSkill = dj ? dj.skill * djFatigue(dj.id) : 0;
    // No DJ is a real penalty, not a zero — automation still airs something.
    // The show's daypart multiplier is what makes the four slots four separate
    // decisions instead of the same argmax four times over.
    const quality = show.appeal * (dj ? 0.58 + djSkill * 0.052 : 0.32) *
      ((show.parts && show.parts[part.id]) || 1);

    const potential = LISTENER_BASE * reach * part.weight * (1 + S.rep / 62) * S.buzz;
    const slotListeners = potential * quality * retention;

    totalListeners += slotListeners;
    qualitySum += quality;
    repPressure += show.rep * (dj ? 1 + djSkill * 0.05 : 0.6);
    revenue += slotListeners * show.adRate * AD_VALUE * fill * price * (1 + S.rep / 140);
  }

  const avgListeners = totalListeners / DAYPARTS.length;
  const avgQuality = qualitySum / DAYPARTS.length;

  // Equipment hiccup — engineer both lowers the odds and can catch it.
  let breakdown = null;
  const breakRisk = clamp(0.055 - engBonus() * 0.09, 0.006, 0.055);
  if (Math.random() < breakRisk) {
    const caught = Math.random() < bestSkill('eng') * 0.07;
    if (caught) breakdown = { caught: true };
    else {
      breakdown = { caught: false, gear: Math.random() < 0.5 ? TX[S.tx].name : ANT[S.ant].name };
      revenue *= 0.7;
    }
  }

  // Performing-rights royalties: the recurring bill every music station pays,
  // and payroll's only company as a cost line. It scales with revenue and with
  // how much of the day is music, which is what finally gives Talk and News an
  // economic identity instead of a purely reputational one.
  const musicShare = DAYPARTS.filter(p => S.schedule[p.id].show === 'music').length / DAYPARTS.length;
  const royalties = revenue * 0.045 * musicShare;

  const costs = S.staff.reduce((a, p) => a + p.salary, 0) + royalties;
  let net = revenue - costs;

  // Second station (once founded) runs itself and wires a cut of its own
  // take back to headquarters — scaled by reputation so it's not free money
  // divorced from how well the flagship signal is actually doing.
  let network = 0;
  if (S.secondStation) {
    network = revenue * 0.32 * clamp(S.rep / 100, 0.3, 1);
    net += network;
    S.secondStation.totalEarned += network;
  }

  S.cash += net;
  S.listeners = Math.round(avgListeners * (breakdown && !breakdown.caught ? 0.82 : 1));
  // Reputation drifts toward what you actually put on air — no free upward
  // creep, or an unstaffed all-music station would coast into every rep gate.
  const avgPressure = repPressure / DAYPARTS.length;
  const repTarget = clamp(avgQuality * 78 + avgPressure * 14, 0, 100);
  S.rep = clamp(S.rep + (repTarget - S.rep) * 0.05, 0, 100);
  // Buzz bleeds back to neutral — roughly a six-day return from a viral spike.
  S.buzz = clamp(S.buzz + (1 - S.buzz) * 0.12, BUZZ_MIN, BUZZ_MAX);
  S.day++;
  S.stats.daysOnAir++;
  // Net, not gross: the Empire tab used to report millions "earned" on a
  // station that was quietly going broke.
  S.stats.totalEarned += net;
  S.stats.totalCosts = (S.stats.totalCosts || 0) + costs;
  S.stats.peakListeners = Math.max(S.stats.peakListeners, S.listeners);
  S.lastDay = { listeners: S.listeners, revenue, costs, net, quality: avgQuality, network, royalties, repTarget };

  return { breakdown, net, revenue, costs };
}

function rollEvent(){
  if (S.day < 4 || Math.random() > 0.17) return null;
  const pool = EVENTS.filter(e => S.day >= e.minDay);
  if (!pool.length) return null;
  const total = pool.reduce((a, e) => a + e.w, 0);
  let r = Math.random() * total;
  const ev = pool.find(e => (r -= e.w) <= 0) || pool[0];

  const djs = staffOf('dj');
  const vars = {
    // Short form: this lands mid-sentence, not in the schedule grid.
    part: partShort(pick(DAYPARTS).id),
    name: djs.length ? pick(djs).name : 'Your overnight host'
  };
  ev.apply(S);
  return { id: ev.id, type: ev.type, msg: t2(ev.msg, vars) };
}

function addLog(msg, kind){
  S.log.unshift({ day: S.day, msg, kind: kind || '' });
  if (S.log.length > 60) S.log.length = 60;
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
        t('unlockedSub'),
        '<p style="font-size:13px;color:var(--muted);margin-top:10px">' + esc(t('foundStationNote', { amt: money(SECOND_STATION_COST) })) + '</p>',
        [{ label: t('close'), cls: 'buy', act: dismissAutoModal }]
      );
    }
    return true;
  }
  return false;
}

// Lives with the sim, not the Staff tab that displays it: tick() calls this
// on the weekly hire refresh, and the design gate's scarce resource depends on
// candidate throughput NOT scaling with station count — the 75% harness will
// assert that against this function.
function refreshCandidates(){
  const n = randInt(2, 3);
  S.candidates = [];
  const roles = ['dj', 'eng', 'sales'];
  for (let i = 0; i < n; i++) S.candidates.push(makePerson(pick(roles), S.rep));
  // Always keep a DJ available early — the game is unreadable without one.
  if (S.day < 12 && !S.candidates.some(c => c.role === 'dj')) S.candidates[0] = makePerson('dj', S.rep);
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

    // Hard cash floor — payroll outrunning revenue can no longer spiral into
    // arbitrary negative numbers forever. Check this before anything else this
    // tick so a bankrupting day can't also open an event/unlock modal under it.
    if (S.cash <= BANKRUPTCY_FLOOR) {
      render();
      triggerBankruptcy();
      return;
    }

    if (rep.breakdown) {
      if (rep.breakdown.caught) addLog(t('breakdownFixed'), 'good');
      else {
        addLog(t('breakdownMsg', { gear: rep.breakdown.gear }), 'bad');
        toast('⚠️ ' + t('breakdownMsg', { gear: rep.breakdown.gear }), 'bad');
        sfxDeadAir();
      }
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
  addLog(t('bankruptSub', { call: S.call }), 'bad');
  openModal(
    '📉 ' + t('bankruptTitle'),
    t('bankruptSub', { call: S.call }),
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
/** Fill anything a newer version added so old saves keep loading.
    The old version merged INTO base, which aliased base.opts to data.opts —
    every nested merge was a self-merge that backfilled nothing. Everything
    here now copies into fresh objects, and the result goes through
    sanitize() so a hand-edited or truncated save can't poison the sim. */
function migrate(data){
  const v = +data.v || 1;
  // A save from a newer build: degrade to "no save" rather than half-load it.
  if (v > SAVE_VER) return null;
  const base = newState(data.call);
  const merged = Object.assign({}, base, data);
  merged.opts    = Object.assign({}, base.opts,    data.opts    || {});
  merged.stats   = Object.assign({}, base.stats,   data.stats   || {});
  merged.lastDay = Object.assign({}, base.lastDay, data.lastDay || {});
  merged.schedule = {};
  for (const p of DAYPARTS) {
    const src = (data.schedule && data.schedule[p.id]) || {};
    merged.schedule[p.id] = {
      show: SHOWS[src.show] ? src.show : base.schedule[p.id].show,
      dj: typeof src.dj === 'string' ? src.dj : null
    };
  }
  merged.v = SAVE_VER;
  return sanitize(merged);
}

/** Coerce every field the sim divides, compares or renders. Runs on both the
    load path and the new-game path so there is exactly one shape of state. */
function sanitize(s){
  // null and '' both coerce to 0 through unary +, which would silently turn a
  // missing field into a real zero (a null cash became $0, not the default).
  const n = (x, d) => (x === null || x === '' || !Number.isFinite(+x)) ? d : +x;

  s.call      = String(s.call || randomCall()).replace(/[^A-Z]/g, '').slice(0, 4) || randomCall();
  s.cash      = n(s.cash, 800);
  s.listeners = Math.max(0, Math.round(n(s.listeners, 40)));
  s.rep       = clamp(n(s.rep, 5), 0, 100);
  s.buzz      = clamp(n(s.buzz, 1), BUZZ_MIN, BUZZ_MAX);
  s.day       = Math.max(1, Math.floor(n(s.day, 1)));
  // Never more than a week out, or a junk value could stall hiring forever.
  s.nextHireDay = clamp(Math.floor(n(s.nextHireDay, s.day + 7)), 1, s.day + 7);
  s.tx        = clamp(Math.floor(n(s.tx, 0)), 0, TX.length - 1);
  s.ant       = clamp(Math.floor(n(s.ant, 0)), 0, ANT.length - 1);
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
      return Object.assign({}, p, {
        name: String(p.name || 'Unknown'),
        skill,
        salary: Number.isFinite(+p.salary) ? +p.salary : salaryFor(p.role, skill)
      });
    }) : [];

  s.log        = Array.isArray(s.log) ? s.log.slice(0, 60) : [];
  s.candidates = Array.isArray(s.candidates)
    ? s.candidates.filter(p => p && ROLES[p.role] && typeof p.id === 'string' && Number.isFinite(+p.skill))
    : [];

  s.stats.totalEarned   = n(s.stats.totalEarned, 0);
  s.stats.totalCosts    = Math.max(0, n(s.stats.totalCosts, 0));
  s.stats.daysOnAir     = Math.max(0, Math.floor(n(s.stats.daysOnAir, 0)));
  s.stats.peakListeners = Math.max(s.listeners, Math.round(n(s.stats.peakListeners, s.listeners)));

  // Every lastDay field is divided, compared or rendered somewhere, and one of
  // them decides money: catchUp() gates the whole offline payout on
  // `S.lastDay.net > 0` and then multiplies by it, so a string "120" from a
  // truncated save banked NaN cash and a NaN day counter. Rebuilt from a fixed
  // key list rather than coerced in place, so a junk key can't ride along.
  const ld = (s.lastDay && typeof s.lastDay === 'object') ? s.lastDay : {};
  s.lastDay = {};
  for (const k of ['listeners','revenue','costs','net','quality','network','royalties','repTarget']) {
    s.lastDay[k] = n(ld[k], 0);
  }

  if (s.secondStation) {
    s.secondStation = {
      call: String(s.secondStation.call || randomCall()),
      foundedDay: Math.max(1, Math.floor(n(s.secondStation.foundedDay, 1))),
      totalEarned: n(s.secondStation.totalEarned, 0)
    };
  }

  // A DJ id pointing at someone who is no longer on staff would make the slot
  // render blank while still counting as "assigned" in djLoad().
  const ids = new Set(s.staff.map(p => p.id));
  for (const p of DAYPARTS) {
    if (s.schedule[p.id].dj && !ids.has(s.schedule[p.id].dj)) s.schedule[p.id].dj = null;
  }

  // A clock stamp from the future (system time moved back) would make the
  // catch-up window negative; treat it as "just now".
  if (!Number.isFinite(s.lastTick) || s.lastTick > Date.now()) s.lastTick = Date.now();
  return s;
}

/** Truth-testing the raw string used to leave a corrupt entry enabling
    Continue forever with no way to clear it. */
function hasSave(){
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  if (!raw) return false;
  let d;
  try { d = JSON.parse(raw); }
  catch (e) { wipeSave(); return false; }
  return !!d && typeof d === 'object' && Number.isFinite(+d.day) && typeof d.call === 'string';
}
function wipeSave(){ try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

/** Grant a capped lump sum for time the tab was closed (CLAUDE.md line 16).
    Deliberately NOT a simulateDay() loop: that would fire breakdown rolls,
    event modals and unlock modals against an unrendered UI, and could cross
    BANKRUPTCY_FLOOR with nothing on screen. A positive-only lump sum can't. */
function catchUp(){
  const now = Date.now();
  const dt = clamp(now - (S.lastTick || now), 0, OFFLINE_CAP_MS);
  S.lastTick = now;
  if (dt < 60000) return;
  const days = Math.min(Math.floor(dt / OFFLINE_MS_PER_DAY), OFFLINE_MAX_DAYS);
  if (days < 1 || !(S.lastDay.net > 0)) return;
  const gain = S.lastDay.net * days * OFFLINE_RATE;
  S.cash += gain;
  S.day += days;
  S.stats.daysOnAir += days;
  S.stats.totalEarned += gain;
  addLog('Automated broadcasting covered ' + days + ' days while you were away.', 'big');
  // Paint the lump sum before the dialog goes up, or the HUD sits on the
  // pre-absence numbers for as long as the player reads it.
  render();
  // This was the only modal in the game that left the clock running, so days
  // advanced (and event modals stacked up) behind "While you were away".
  modalPause();
  openModal('📻 While you were away',
    days + ' days of automated broadcasting',
    '<p style="font-size:13px;color:var(--muted);margin-top:10px">Unattended days pay half rate, and catch-up is capped at ' +
      OFFLINE_MAX_DAYS + ' broadcast days. Listeners and reputation pick up where the live schedule left them.</p>',
    [{ label: t('close'), cls: 'buy', act: dismissAutoModal }]);
}
