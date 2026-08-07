// Callsigns — ui: screens/tabs, render + the five tab views, modals and toasts,
// player actions, flows, options, main menu, event wiring, gamepad, boot.
// Loads last; boot() at the bottom is the entry point for the whole game.
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing one top-level scope; load order: content, sim, fx, ui.
// Carved verbatim from the single-file v1 at the 50% checkpoint — refactor
// only: same 'callsigns.save' key, same v2 state shape, identical behavior.
// The v3 empire work builds on this against CONTRACT.md at 75%.
'use strict';

/* ---------------- UI: shell ---------------- */

const TABS = [
  { id: 'studio', icon: '🎚️', lbl: 'tabStudio' },
  { id: 'gear',   icon: '📡', lbl: 'tabGear' },
  { id: 'staff',  icon: '👥', lbl: 'tabStaff' },
  { id: 'empire', icon: '🏙️', lbl: 'tabEmpire' },
  { id: 'log',    icon: '📋', lbl: 'tabLog' }
];
let activeTab = 'studio';

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
  document.querySelectorAll('#tabbar .tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === activeTab);
    if (b.dataset.tab === 'empire') {
      b.classList.toggle('has-badge',
        !!(S && S.unlockedExpansion && !S.seenExpansion && !S.secondStation));
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

/* ---------------- UI: render ---------------- */

/* The scene is ~40 nodes running twelve infinite CSS animations, and it used
   to be rebuilt on every tick — the 26s satellite never got past 19% of its
   orbit and the 4.2s wave rings never emitted a complete ring. It only ever
   changes when the tier, the callsign or the frequency does, so key it on
   exactly that and leave the DOM alone the rest of the time. */
let sceneKey = '';
function updateScene(){
  const k = sceneTier() + '|' + S.call + '|' + S.freq;
  if (k === sceneKey) return;
  sceneKey = k;
  $('scene-host').innerHTML = renderScene();
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
  $('stat-cash').innerHTML      = esc(money(S.cash)) + hudDeltaHtml.cash;
  $('stat-cash').style.color    = S.cash < 0 ? 'var(--red)' : '';
  $('stat-listeners').innerHTML = esc(num(S.listeners)) + hudDeltaHtml.listeners;
  $('stat-rep').innerHTML       = String(Math.round(S.rep)) + hudDeltaHtml.rep;
}

function render(){
  if (!S) return;
  $('hud-call').textContent = S.call;
  // Callsign plus frequency is a station's actual public identity; the gear
  // spec this used to repeat is the entire content of the Gear tab.
  $('hud-sub').textContent = S.freq + ' FM · ' + TX[S.tx].spec;
  $('hud-day').textContent = t('dayShort', { n: S.day });
  paintHudStats();

  if (activeTab === 'studio') { updateScene(); $('studio-body').innerHTML = viewStudio(); }
  if (activeTab === 'gear')   $('pane-gear').innerHTML   = viewGear();
  if (activeTab === 'staff')  $('pane-staff').innerHTML  = viewStaff();
  if (activeTab === 'empire') $('pane-empire').innerHTML = viewEmpire();
  if (activeTab === 'log')    $('pane-log').innerHTML    = viewLog();
  paintTabs();
  setPausedUI();
  // The pane we just replaced took the gamepad cursor's node with it —
  // paintFocus() was decorating an element render() discarded a tick later.
  if (padOn) setFocus(padIdx);
}

/** The first unmet item on an ordered checklist, as {text, tab}. This is the
    only thing in the game that ever tells a new player what to do next; null
    once the second station is signed on and there is nothing left to gate. */
function nextGoal(){
  if (!S.staff.length) return { text: t('goalHire'), tab: 'staff' };
  if (staffOf('dj').length && !DAYPARTS.some(p => S.schedule[p.id].dj)) {
    return { text: t('goalAssign'), tab: 'studio' };
  }
  const nexts = [TX[S.tx + 1], ANT[S.ant + 1]].filter(Boolean);
  for (const g of nexts) {
    if (S.cash >= g.cost && S.rep >= g.rep) return { text: t('goalBuy', { name: g.name }), tab: 'gear' };
  }
  const gated = nexts.filter(g => S.rep < g.rep);
  if (gated.length) {
    return { text: t('goalRep', { n: Math.min.apply(null, gated.map(g => g.rep)) }), tab: 'studio' };
  }
  if (S.unlockedExpansion && !S.secondStation) return { text: t('goalFound'), tab: 'empire' };
  return null;
}

function viewStudio(){
  const d = S.lastDay;
  const netCls = d.net >= 0 ? 'up' : 'down';
  let h = '';

  const goal = nextGoal();
  if (goal) {
    // A button, not a div: the whole row is a jump to the tab the goal lives on.
    h += '<button type="button" class="hint" data-tab="' + goal.tab + '" ' +
      'style="display:block;width:100%;text-align:left;cursor:pointer;' +
      'background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.34);' +
      'color:var(--amber);font-weight:700;min-height:40px">' +
      '▸ ' + esc(goal.text) + '</button>';
  }

  // Fires on runway, not on the sign of the balance: by the time cash is
  // already negative there is usually nothing left to do about it.
  if (S.cash < 0 || (d.costs > 0 && S.cash < d.costs * 5)) {
    h += '<div class="hint" style="background:rgba(248,113,113,.10);border-color:rgba(248,113,113,.32);color:var(--red)">⚠️ ' +
      esc(t('cashWarning')) + '</div>';
  }

  h += '<div class="two-col">';

  h += '<div class="card"><div class="card-head">' +
    '<span class="card-title">' + esc(t('dailyBrief')) + '</span>' +
    '<span class="card-note">' + esc(t('payroll', { amt: money(S.staff.reduce((a,p)=>a+p.salary,0)) })) + '</span>' +
    '</div><div class="sched">' +
      // Listeners lived here as an exact duplicate of the HUD (reading 0 under
      // a HUD reading 40 on day one). Quality and Buzz are the two numbers the
      // sim computes every day and never showed anyone.
      brief(t('briefQuality'), Math.round(d.quality * 100) + '%', 'cyan') +
      brief(t('reach'), reachValue().toFixed(1) + '×', 'magenta') +
      brief(t('fidelity'), fidelityValue().toFixed(2) + '×', 'amber') +
      brief(t('briefBuzz'), Math.round(S.buzz * 100) + '%', S.buzz >= 1 ? 'green' : 'red') +
    '</div>' +
    // Reputation drives three multipliers and two gate families, and nothing
    // in the game told the player which way it was heading.
    '<div style="margin-top:11px;text-align:center;font-size:12px;color:var(--muted)">' +
      esc(t('rep')) + ' <span style="color:var(--amber);font-weight:700">' +
      esc(t('repTrend', { now: Math.round(S.rep), target: Math.round(d.repTarget || 0) })) + '</span>' +
    '</div>' +
    '<div style="margin-top:7px;text-align:center;font-size:13px">';

  if (S.day > 1) {
    // "In" is everything that came in, not just the flagship's ad revenue:
    // simulateDay() folds the second station's contribution into net, so
    // printing bare revenue here made the brief read "196 in · 7 out · +239".
    // With one station network is 0 and this is exactly d.revenue.
    const network = d.network || 0;
    const takeIn = (d.revenue || 0) + network;
    h += '<span style="color:var(--muted)">Yesterday: </span>' +
      '<span style="color:var(--green);font-weight:700">' + money(takeIn) + '</span>' +
      '<span style="color:var(--muted)"> in · </span>' +
      '<span style="color:var(--red);font-weight:700">' + money(d.costs) + '</span>' +
      '<span style="color:var(--muted)"> out · </span>' +
      '<span class="delta ' + netCls + '" style="font-size:13px">' + (d.net >= 0 ? '+' : '') + money(d.net) + '</span>' +
      '<div style="margin-top:3px;font-size:11px;color:var(--dim)">' +
        esc(t('payroll', { amt: money(Math.max(0, (d.costs || 0) - (d.royalties || 0))) })) +
        ' · ' + esc(t('royaltiesLbl')) + ' ' + money(d.royalties || 0) + '/day' +
      '</div>';
    // Its own line once the second callsign is on the air: the network cut was
    // stored in lastDay from the day it was added and rendered nowhere.
    if (S.secondStation) {
      h += '<div style="margin-top:2px;font-size:11px;color:var(--green)">' +
        esc(t('networkLbl', { call: S.secondStation.call })) + ' +' + money(network) + '/day · ' +
        '<span style="color:var(--dim)">' + esc(t('onAirLbl')) + ' ' + money(d.revenue || 0) + '</span>' +
      '</div>';
    }
  } else {
    h += '<span style="color:var(--muted)">' + esc(t('firstDay')) + '</span>';
  }
  h += '</div></div>';

  h += '<div class="card"><div class="card-head">' +
    '<span class="card-title">' + esc(t('schedule')) + '</span>' +
    '<span class="card-note">' + esc(t('scheduleNote')) + '</span></div><div class="sched">';

  for (const part of DAYPARTS) {
    const slot = S.schedule[part.id];
    const show = SHOWS[slot.show];
    const dj = djFor(slot);
    const partName = partLabel(part.id);
    // <button>, not <div>: programming the schedule is the core mechanic and
    // it used to be unreachable without a mouse or a gamepad.
    h += '<button type="button" class="slot" data-openslot="' + part.id + '">' +
      '<span class="slot-part">' + part.icon + ' ' + esc(partName) + '</span>' +
      '<span class="slot-icon">' + show.icon + '</span>' +
      '<span class="slot-show">' + esc(t('show' + slot.show.charAt(0).toUpperCase() + slot.show.slice(1))) + '</span>' +
      '<span class="slot-' + (dj ? 'dj' : 'meta') + '">' + esc(dj ? '🎧 ' + dj.name.split(' ')[0] + ' · ' + dj.skill : t('noDj')) + '</span>' +
    '</button>';
  }
  h += '</div></div>';
  return h + '</div>';
}

function brief(label, val, color){
  return '<div style="text-align:center;padding:6px 2px">' +
    '<div style="font-size:17px;font-weight:800;color:var(--' + color + ')">' + esc(val) + '</div>' +
    '<div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.9px">' + esc(label) + '</div>' +
  '</div>';
}

function viewGear(){
  return '<div class="two-col">' +
    gearCard('tx', TX, S.tx, t('transmitter'), '📡', 'reach') +
    gearCard('ant', ANT, S.ant, t('antenna'), '🗼', 'fid') +
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
    h += '<div class="row" style="margin-top:8px">' +
      '<div class="row-icon">⬆️</div>' +
      '<div class="row-body">' +
        '<div class="row-title">' + esc(next.name) + '</div>' +
        '<div class="row-sub" style="color:var(--green)">' + esc(gain) + ' · ' + esc(next.spec) + '</div>' +
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

  // engBonus/salesFill/salesPrice/djFatigue all do real work that appeared
  // nowhere on screen, so a $36/day sales agent looked like paying for nothing.
  h += '<div class="card"><div class="card-head">' +
    '<span class="card-title">📊 ' + esc(t('effectsTitle')) + '</span></div>' +
    fxLine(t('fxAdFill'), Math.round(salesFill() * 100) + '%', 'green') +
    fxLine(t('fxAdRate'), salesPrice().toFixed(2) + '×', 'green') +
    fxLine(t('fxBreak'), (clamp(0.055 - engBonus() * 0.09, 0.006, 0.055) * 100).toFixed(1) + '%/day', 'red') +
    // *50, not *100: engineers contribute at half weight in fidelityValue().
    fxLine(t('fxFid'), '+' + Math.round(engBonus() * 50) + '%', 'cyan') +
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
      h += '<div class="row">' +
        '<div class="row-icon">' + ROLES[p.role].icon + '</div>' +
        '<div class="row-body">' +
          '<div class="row-title">' + esc(p.name) + '</div>' +
          '<div class="row-sub">' + esc(roleName(p.role)) + ' · ' + esc(t('skill', { n: p.skill })) + ' · ' + esc(t('salary', { amt: money(p.salary) })) + '</div>' +
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

function roleName(r){ return t(r === 'dj' ? 'roleDj' : r === 'eng' ? 'roleEng' : 'roleSales'); }
function roleDesc(r){ return t(r === 'dj' ? 'roleDjDesc' : r === 'eng' ? 'roleEngDesc' : 'roleSalesDesc'); }

function viewEmpire(){
  const cashPct = clamp(S.cash / UNLOCK_CASH * 100, 0, 100);
  const repPct  = clamp(S.rep / UNLOCK_REP * 100, 0, 100);

  let h = '<div class="card"><div class="card-head"><span class="card-title">' + esc(t('empireTitle')) + '</span></div>';
  // totalEarned is NET (see simulateDay) — labelling it "earned" next to a
  // number that already had payroll and licensing taken out read as gross, and
  // the costs stat that would have made the difference obvious was never shown.
  const earnCls = S.stats.totalEarned >= 0 ? 'green' : 'red';
  h += '<div class="row"><div class="row-icon">📻</div><div class="row-body">' +
    '<div class="row-title">' + esc(S.call) + '</div>' +
    '<div class="row-sub">' + esc(t('day', { n: S.day })) + ' · ' + num(S.stats.peakListeners) + ' peak</div>' +
    '<div class="row-sub">' + esc(t('empireNet')) + ' ' +
      '<span style="color:var(--' + earnCls + ');font-weight:700">' + money(S.stats.totalEarned) + '</span>' +
      ' · ' + esc(t('empireCosts')) + ' ' +
      '<span style="color:var(--red);font-weight:700">' + money(S.stats.totalCosts) + '</span></div>' +
  '</div></div></div>';

  if (S.unlockedExpansion && S.secondStation) {
    const ss = S.secondStation;
    h += '<div class="card"><div class="card-head">' +
      '<span class="card-title">📡 ' + esc(t('secondStationTitle')) + '</span></div>' +
      '<div class="row"><div class="row-icon">🏙️</div><div class="row-body">' +
        '<div class="row-title">' + esc(t('secondStationSub', { call: ss.call, day: ss.foundedDay })) + '</div>' +
        '<div class="row-sub">' + esc(t('networkContribution')) + ': ' +
          '<span style="color:var(--green);font-weight:700">' + money(S.lastDay.network || 0) + '</span></div>' +
        '<div class="row-sub">' + esc(t('networkTotal')) + ': ' +
          '<span style="color:var(--amber);font-weight:700">' + money(ss.totalEarned) + '</span></div>' +
      '</div></div></div>';
  } else if (S.unlockedExpansion) {
    const canAfford = S.cash >= SECOND_STATION_COST;
    h += '<div class="card"><div class="locked-panel">' +
      '<div class="locked-icon">🏙️</div>' +
      '<div style="font-size:17px;font-weight:800;color:var(--amber);margin-bottom:5px">' + esc(t('unlockedTitle')) + '</div>' +
      '<div style="font-size:13px;color:var(--muted);margin-bottom:14px">' + esc(t('unlockedSub')) + '</div>' +
      '<button class="btn buy" id="btn-found-station"' + (canAfford ? '' : ' disabled') + '>' +
        esc(t('foundStation')) + ' · ' + money(SECOND_STATION_COST) +
      '</button>' +
      '<div style="font-size:11px;color:var(--dim);margin-top:12px;max-width:340px;margin-left:auto;margin-right:auto">' +
        esc(t('foundStationNote', { amt: money(SECOND_STATION_COST) })) + '</div>' +
    '</div></div>';
  } else {
    h += '<div class="card"><div class="card-head"><span class="card-title">' + esc(t('progressTo')) + '</span></div>' +
      '<div class="locked-panel" style="padding:14px 6px">' +
        '<div class="locked-icon">🔒</div>' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:16px">' +
          esc(t('lockedSub', { cash: money(UNLOCK_CASH), rep: UNLOCK_REP })) + '</div>' +
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
  return h;
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
  $('modal').innerHTML =
    '<div class="modal-title">' + esc(title) + '</div>' +
    (sub ? '<div class="modal-sub">' + esc(sub) + '</div>' : '') +
    (bodyHtml || '') +
    '<div class="modal-btns">' + modalActions.map((a, i) =>
      '<button class="btn ' + (a.cls || '') + '" data-modal-act="' + i + '">' + esc(a.label) + '</button>'
    ).join('') + '</div>';
  $('modal-back').classList.add('open');
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

function toast(msg, kind){
  const box = $('toasts');
  // Cap the stack — a bad day can queue a breakdown, an event and a save
  // failure at once, and four is already the whole screen on a phone.
  while (box.children.length >= 4) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

/* ---------------- actions ---------------- */

function buyGear(key){
  const arr = key === 'tx' ? TX : ANT;
  const idx = key === 'tx' ? S.tx : S.ant;
  const next = arr[idx + 1];
  if (!next || S.cash < next.cost || S.rep < next.rep) return;
  S.cash -= next.cost;
  if (key === 'tx') S.tx++; else S.ant++;
  addLog('Upgraded to ' + next.name + '.', 'big');
  toast('📡 ' + next.name + ' installed', 'good');
  sfxBuy();
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
  openModal(t('fireConfirm', { name: p.name }), t('fireConfirmSub'), '', [
    { label: t('cancel'), cls: 'ghost', act: closeModal },
    { label: t('fire'), cls: 'danger', act: () => {
        S.staff = S.staff.filter(x => x.id !== id);
        for (const k in S.schedule) if (S.schedule[k].dj === id) S.schedule[k].dj = null;
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
  sfxBuy();
  saveGame(true);
  render();
}

/** Firing a $33/day DJ already asks for confirmation; a $120,000 buildout
    fired by one unconfirmed click was the biggest unguarded spend in the game. */
function foundSecondStation(){
  if (!S.unlockedExpansion || S.secondStation || S.cash < SECOND_STATION_COST) return;
  modalPause();
  openModal(t('foundConfirm'), t('foundConfirmSub', { amt: money(SECOND_STATION_COST) }),
    '<p style="font-size:13px;color:var(--muted);margin-top:10px">' +
      esc(t('foundStationNote', { amt: money(SECOND_STATION_COST) })) + '</p>',
    [
      { label: t('cancel'), cls: 'ghost', act: closeModal },
      { label: t('foundStation'), cls: 'buy', act: () => { closeModal(); doFoundSecondStation(); } }
    ]);
}

function doFoundSecondStation(){
  // Re-check: days can pass behind the confirm modal only if the player
  // un-paused, but the guard is free and the spend is not.
  if (!S.unlockedExpansion || S.secondStation || S.cash < SECOND_STATION_COST) return;
  S.cash -= SECOND_STATION_COST;
  const call2 = randomCall();
  S.secondStation = { call: call2, foundedDay: S.day, totalEarned: 0 };
  addLog(t('foundedMsg', { call: call2 }), 'big');
  toast('🏙️ ' + t('foundedMsg', { call: call2 }), 'good');
  sfxOnAir();
  saveGame(true);
  render();

  // The finish line. The run stays playable afterwards — this is a capstone,
  // not a game over — but the arc needs a moment that says "you did the thing",
  // built from stats the game has always tracked and never showed anyone.
  modalPause();
  const line = (lbl, val) =>
    '<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--border)">' +
      '<span style="font-size:12px;color:var(--muted)">' + esc(lbl) + '</span>' +
      '<span style="font-size:13px;font-weight:800;color:var(--amber)">' + esc(val) + '</span>' +
    '</div>';
  openModal(
    t('empireTitle2'),
    t('empireSub', { a: S.call, b: call2 }),
    line(t('empireDays'), String(S.stats.daysOnAir)) +
    line(t('empireNet'), money(S.stats.totalEarned)) +
    line(t('empireCosts'), money(S.stats.totalCosts)) +
    line(t('empirePeak'), num(S.stats.peakListeners)) +
    line(t('empireRep'), String(Math.round(S.rep))) +
    '<p style="font-size:13px;color:var(--muted);margin-top:12px">' + esc(t('empireNote')) + '</p>',
    [
      { label: t('keepPlaying'), cls: 'buy', act: closeModal },
      { label: t('mainMenu'), cls: '', act: () => returnToMenu({ save: true }) }
    ]
  );
}

/** redraw=true means we're re-opening on top of ourselves after a pick, so
    the modal is replaced in place and the pause state is left alone. */
function openSlotEditor(partId, redraw){
  const slot = S.schedule[partId];
  if (!slot) return;
  const partName = partLabel(partId);
  if (!redraw) modalPause();

  const hdr = 'font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;font-weight:700';
  let body = '<div style="margin-bottom:6px;' + hdr + '">' + esc(t('pickShow')) + '</div>';
  for (const key in SHOWS) {
    const sh = SHOWS[key];
    const on = slot.show === key;
    body += '<button type="button" class="row" data-setshow="' + key + '" data-part="' + partId + '" style="cursor:pointer' + (on ? ';border-color:var(--amber)' : '') + '">' +
      '<div class="row-icon">' + sh.icon + '</div>' +
      '<div class="row-body">' +
        '<div class="row-title">' + esc(t('show' + key.charAt(0).toUpperCase() + key.slice(1))) + (on ? ' ✓' : '') + '</div>' +
        '<div class="row-sub">' + esc(t('show' + key.charAt(0).toUpperCase() + key.slice(1) + 'Desc')) + '</div>' +
      '</div></button>';
  }

  const djs = staffOf('dj');
  // pickDjSub was a dead STR key: the Show list explains itself through the
  // modal's own sub line, but the DJ list shipped with a bare "DJ" header and
  // never told the player what putting a DJ on a slot actually buys them —
  // while the string that says exactly that sat unused.
  body += '<div style="margin:14px 0 4px;' + hdr + '">' + esc(t('pickDj')) + '</div>' +
    '<div style="margin:0 0 8px;font-size:11px;color:var(--muted)">' + esc(t('pickDjSub')) + '</div>';
  if (!djs.length) {
    body += '<div class="empty" style="padding:14px">' + esc(t('unstaffed')) + '</div>';
  } else {
    body += '<button type="button" class="row" data-setdj="" data-part="' + partId + '" style="cursor:pointer' + (!slot.dj ? ';border-color:var(--amber)' : '') + '">' +
      '<div class="row-icon">🚫</div><div class="row-body"><div class="row-title">' + esc(t('noDj')) + (!slot.dj ? ' ✓' : '') + '</div>' +
      '<div class="row-sub">' + esc(t('unstaffed')) + '</div></div></button>';
    for (const p of djs) {
      const on = slot.dj === p.id;
      const elsewhere = Object.keys(S.schedule).filter(k => k !== partId && S.schedule[k].dj === p.id).length;
      // Was a neutral "on 2 other slots", which reads as a fact rather than
      // the quality penalty djFatigue() actually applies.
      const tired = elsewhere
        ? ' · <span style="color:var(--red);font-weight:700">' +
            esc(t('tired', { n: Math.round((1 - djFatigue(p.id)) * 100) })) + '</span>'
        : '';
      body += '<button type="button" class="row" data-setdj="' + p.id + '" data-part="' + partId + '" style="cursor:pointer' + (on ? ';border-color:var(--amber)' : '') + '">' +
        '<div class="row-icon">🎧</div><div class="row-body">' +
        '<div class="row-title">' + esc(p.name) + (on ? ' ✓' : '') + '</div>' +
        '<div class="row-sub">' + esc(t('skill', { n: p.skill })) + tired + '</div>' +
        '</div></button>';
    }
  }

  // Short form in the sub: the title directly above it is already the long one,
  // and "Morning Drive · 6-10 AM · what goes out on this slot?" stuttered.
  openModal(partName, t('pickShowSub', { part: partShort(partId) }), body, [
    { label: t('close'), cls: 'buy', act: () => { closeModal(); saveGame(true); render(); } }
  ], { replace: !!redraw });
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
    showIntro();
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
  applyMotionPref();
  showScreen('game');
  activeTab = 'studio';
  // Force the cached scene to rebuild for this station, and drop any HUD
  // deltas left over from the previous run.
  sceneKey = '';
  resetHudDeltas();
  // Once per run — render() only toggles classes on the bar from here on.
  buildTabs();
  setTab('studio');
  startAllTimers();
}

/** Three paragraphs, once, on the first day of a brand new station. Continue
    never replays it because seenIntro rides along in the save. */
function showIntro(){
  if (!S || S.seenIntro) return;
  modalPause();
  const para = s => '<p style="font-size:13px;color:var(--muted);margin-top:10px">' + esc(s) + '</p>';
  openModal(
    t('introTitle'),
    t('introSub', { call: S.call, freq: S.freq }),
    para(t('intro1')) + para(t('intro2')) + para(t('intro3')),
    [{ label: t('introGo'), cls: 'buy', act: () => { S.seenIntro = true; saveGame(true); closeModal(); } }]
  );
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
  pauseTick(); autoPaused = wasRunning;
  openModal(t('paused'), S.call + ' · ' + t('day', { n: S.day }), '', [
    { label: t('resume'), cls: 'buy', act: () => { closeModal(); } },
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
    // hasSave() already proved this parses and carries a call + day, but fall
    // back to the plain label rather than printing "undefined · Day NaN".
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d && typeof d.call === 'string' && Number.isFinite(+d.day)) {
        $('btn-continue').textContent = t('continueGame') + ' · ' + d.call + ' · ' + t('day', { n: Math.floor(+d.day) });
      }
    } catch (e) {}
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
    if (e.target.closest('.btn:not(:disabled), .mbtn:not(:disabled), .tab, .hud-btn, .seg-btn, .switch, .slot')) sfxClick();

    const tab = e.target.closest('[data-tab]');
    if (tab) return setTab(tab.dataset.tab);

    const act = e.target.closest('[data-modal-act]');
    if (act) { const a = modalActions[+act.dataset.modalAct]; if (a && a.act) a.act(); return; }

    const buy = e.target.closest('[data-buy]');
    if (buy && !buy.disabled) return buyGear(buy.dataset.buy);

    const hireB = e.target.closest('[data-hire]');
    if (hireB && !hireB.disabled) return hirePerson(hireB.dataset.hire);

    const fireB = e.target.closest('[data-fire]');
    if (fireB) return firePerson(fireB.dataset.fire);

    const trainB = e.target.closest('[data-train]');
    if (trainB && !trainB.disabled) return trainPerson(trainB.dataset.train);

    const foundB = e.target.closest('#btn-found-station');
    if (foundB && !foundB.disabled) return foundSecondStation();

    // The picker rows live inside the slot editor's modal, so they must be
    // tested BEFORE the studio slot that opened it — and each row carries its
    // own part id rather than reading it back off the modal element.
    const setShow = e.target.closest('[data-setshow]');
    if (setShow) {
      const part = setShow.dataset.part;
      if (!part || !S.schedule[part]) return;
      S.schedule[part].show = setShow.dataset.setshow;
      openSlotEditor(part, true);
      return;
    }
    const setDj = e.target.closest('[data-setdj]');
    if (setDj) {
      const part = setDj.dataset.part;
      if (!part || !S.schedule[part]) return;
      S.schedule[part].dj = setDj.dataset.setdj || null;
      openSlotEditor(part, true);
      return;
    }

    const slotEl = e.target.closest('[data-openslot]');
    if (slotEl) return openSlotEditor(slotEl.dataset.openslot);

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
        { label: t('wipe'), cls: 'danger', act: () => returnToMenu({ wipe: true }) }
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
   the 2x2 schedule grid feeling right instead of a flat list walk.
   A=activate  B=back  X=pause/resume  Y=save  LB/RB=tabs  Start=menu     */

const PAD = { A:0, B:1, X:2, Y:3, LB:4, RB:5, BACK:8, START:9, UP:12, DOWN:13, LEFT:14, RIGHT:15 };
const FOCUS_SEL = '.mbtn:not(:disabled), .tab, .btn:not(:disabled), .slot, .switch, .seg-btn, .hud-btn, [data-setshow], [data-setdj]';

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

function pollPad(){
  const now = performance.now();
  if (!padOn && now - lastPoll < 250) { requestAnimationFrame(pollPad); return; }
  lastPoll = now;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = Array.from(pads).find(p => p && p.connected);
  if (gp) {
    if (!padOn) {
      padOn = true;
      document.body.classList.add('pad-on');
      toast('🎮 Controller connected — A select, B back, LB/RB tabs', 'good');
      setFocus(0);
    }
    const down = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const hit = i => { const d = down(i); const was = prevBtn[i]; prevBtn[i] = d; return d && !was; };

    // Stick + d-pad share a repeat timer so held input scrolls at a sane rate.
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
  requestAnimationFrame(pollPad);
}

function initPad(){
  window.addEventListener('gamepadconnected', () => { padOn = false; });
  requestAnimationFrame(pollPad);
}

/* ---------------- boot ---------------- */

/** The menu used to be four buttons on a flat gradient while the game shipped
    a six-tier CSS station scene it never touched. Decorative only: no pointer
    events, no focus stops, and it inherits the body.no-motion gate. */
function buildMenuScene(){
  if (typeof SCENE_TIERS === 'undefined' || !SCENE_TIERS[2]) return;
  // Broadcast Tower reads best at menu scale; with a save on disk, show the
  // player their own city instead so Continue previews where they left off.
  let tier = 2, call = null, freq = null;
  if (hasSave()) {
    const d = loadGame();
    if (d) { tier = sceneTier(d); call = d.call; freq = d.freq; }
  }
  const art = SCENE_TIERS[tier] || SCENE_TIERS[2];
  let html = art.html;
  if (call) {
    html = html.replace(/CALLSIGNS/g, esc(call))
               .replace(/98\.6 FM/g, esc(freq + ' FM'))
               .replace(/98\.6/g, esc(freq));
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
