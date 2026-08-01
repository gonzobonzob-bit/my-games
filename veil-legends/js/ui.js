/* =====================================================================
   VEIL LEGENDS - ui.js   (interface-engineer owns this file)

   Owns: every DOM screen, the HUD, all input binding (bound ONCE at boot),
   settings persistence, autosave cadence, and THE master loop.
   Calls Sim.* and FX.* only; never touches canvas pixels.

   Contract notes / bridges (see the handover report):
   - Master loop is fixed-step 1/60 with a 0.1s dt clamp, handle-tracked,
     and stopped on every route back to the menu.
   - A second, tiny rAF ("pad loop") polls the gamepad while the master loop
     is stopped, because menus must be controller-navigable and the master
     loop does not run there. Exactly one of the two is ever alive.
   - Events are drained once per frame in the loop and passed to FX first;
     UI only *reads* them (overdraw flash, breach/wave toasts).
   - Every optional cross-module call is guarded so the page runs against
     stub modules.
   ===================================================================== */
(function (g) {
  'use strict';

  var doc = g.document;
  var STEP = 1 / 60;
  var SETTINGS_KEY = 'veilLegendsSettings';
  var SAVE_KEY = 'veilLegendsSave';
  var SAFE_CEIL = 85;      // design Part 3: usable headroom ceiling

  /* ------------------------------ helpers ---------------------------- */
  var _m = {};
  function $(id) { var e = _m[id]; if (e === undefined) { e = doc.getElementById(id); _m[id] = e; } return e; }
  function qsa(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function on(t, ev, fn, opt) { if (t) t.addEventListener(ev, fn, opt || false); }
  function setText(el2, v) { if (el2 && el2.textContent !== v) el2.textContent = v; }
  function setCls(el2, n, yes) { if (el2) el2.classList.toggle(n, !!yes); }
  /* Cache on the node: the browser normalises "12.0%" to "12%", so comparing
     against style.width would rewrite the property every single frame. */
  function setW(el2, pct) {
    if (!el2) return;
    var v = clamp(pct, 0, 100).toFixed(1);
    if (el2._vw === v) return;
    el2._vw = v; el2.style.width = v + '%';
  }
  function clamp(v, a, b) { v = +v; if (!isFinite(v)) v = a; return v < a ? a : v > b ? b : v; }
  function num(v, d) { v = +v; return isFinite(v) ? v : (d === undefined ? 0 : d); }
  function r1(v) { return Math.round(num(v) * 10) / 10; }
  function r2(v) { return Math.round(num(v) * 100) / 100; }
  function sgn(v) { return (v > 0 ? '+' : '') + r2(v); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  var _warned = {};
  function call(obj, fn) {
    if (!obj || typeof obj[fn] !== 'function') return undefined;
    try { return obj[fn].apply(obj, Array.prototype.slice.call(arguments, 2)); }
    catch (e) {
      if (!_warned[fn]) { _warned[fn] = 1; console.warn('[ui] ' + fn + ' threw', e); }
      return undefined;
    }
  }
  function mmss(sec) {
    sec = Math.max(0, Math.floor(num(sec)));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }
  function perfNow() { return (g.performance && g.performance.now) ? g.performance.now() : Date.now(); }

  /* ------------------------- content accessors ----------------------- */
  /* All fall back to something renderable so the page works against the
     content stub while content.js is still being written. */
  var FALLBACK_HEROES = [{
    id: 'warden', name: 'Warden', icon: '⚔️', hp: 1000, focusMax: 120,
    spd: 240, color: '#a855f7', abilities: []
  }];
  var FALLBACK_RIFTS = [{ id: 'thinning', name: 'The Thinning', text: 'Standard rift. No modifiers.' }];
  var FALLBACK_TIERS = [{ min: 0, mult: 1 }, { min: 25, mult: 2 }, { min: 50, mult: 3.5 }, { min: 75, mult: 6 }, { min: 90, mult: 11 }];
  var FALLBACK_CAUSE = {
    brink: 'You rode the Veil past the brink. Everything moved faster than you did.',
    wraith: 'The wraiths you left behind finally caught you.',
    attrition: 'The floor rose until there was no headroom left to spend.',
    /* swarm is the catch-all bucket, so this line has to be true of every
       death that lands in it. The old copy asserted "out of Focus" and was
       routinely shown with the Focus bar reading 84/90 six lines above it. */
    swarm: 'Surrounded. Too many bodies, too close, for too long.'
  };

  function CT() { return g.CONTENT || {}; }
  function heroes() { var h = CT().HEROES; return (h && h.length) ? h : FALLBACK_HEROES; }
  function rifts() { var r = CT().RIFTS; return (r && r.length) ? r : FALLBACK_RIFTS; }
  function pets() { var p = CT().PETS; return (p && p.length) ? p : []; }
  function ascensions() { var a = CT().ASCENSIONS; return (a && a.length) ? a : []; }
  function tiers() { var t = CT().VEIL_TIERS; return (t && t.length) ? t : FALLBACK_TIERS; }
  function pacts() { return CT().PACTS || []; }
  function covenant() { return CT().COVENANT || []; }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
  function state() { return (g.Sim && g.Sim.state) || {}; }
  function readSave() {
    try {
      var s = g.localStorage && g.localStorage.getItem(SAVE_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
  function meta() {
    var m = state().meta;
    if (m) return m;
    var raw = readSave();
    return (raw && raw.meta) || {};
  }
  function savedRun() {
    var s = call(g.Sim, 'getSaveSummary');           // optional; not in the contract
    if (s) return s;
    if (g.Sim && typeof g.Sim.hasSave === 'function' && !call(g.Sim, 'hasSave')) return null;
    var raw = readSave();
    return (raw && raw.run) || null;
  }
  function strings() { return CT().STRINGS || {}; }
  /* content.js ships STRINGS.death = { titles:{cause:str}, causes:{cause:[str]} }
     with {wave} {n} {breaches} {floor} placeholders. Older/flat shapes and a
     missing STRINGS both still resolve to something readable. */
  /* Generic {token} filler for the HUD strings, which are keyed to their own
     values rather than to run state. */
  function tok(str, map) {
    var out = String(str);
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), String(map[k]));
    }
    return out;
  }
  function fillTokens(str, s) {
    var st = (s && s.runStats) || {};
    return String(str)
      .replace(/\{wave\}/g, String(num(s && s.wave, 1) | 0))
      .replace(/\{n\}/g, String(Math.max(0, Math.round(num(s && s.hp)))))
      .replace(/\{breaches\}/g, String(num(st.breaches) | 0))
      .replace(/\{floor\}/g, String(r1(s && s.veilFloor)));
  }
  function causeLine(c, s) {
    var S = strings(), d = S.death || S.deaths || S.DEATH || {};
    var pick = (d.causes && d.causes[c]) || d[c] || S['death_' + c];
    if (pick && pick.length && typeof pick !== 'string') pick = pick[Math.floor(Math.random() * pick.length)];
    if (typeof pick !== 'string' || !pick) pick = FALLBACK_CAUSE[c] || FALLBACK_CAUSE.swarm;
    return fillTokens(pick, s);
  }
  function causeTitle(c) {
    var S = strings(), d = S.death || {};
    var t = (d.titles && (d.titles[c] || d.titles['default'])) || S.deathTitle;
    return (typeof t === 'string' && t) ? t : 'THE VEIL TAKES YOU';
  }

  /* ------------------------------ settings --------------------------- */
  var settings = { volume: 0.7, muted: false, shake: true, reducedFx: false };

  function loadSettings() {
    try {
      var raw = g.localStorage && g.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      var o = JSON.parse(raw) || {};
      if (typeof o.volume === 'number') settings.volume = clamp(o.volume, 0, 1);
      if (typeof o.muted === 'boolean') settings.muted = o.muted;
      if (typeof o.shake === 'boolean') settings.shake = o.shake;
      if (typeof o.reducedFx === 'boolean') settings.reducedFx = o.reducedFx;
    } catch (e) { /* corrupt settings: keep defaults */ }
  }
  function persistSettings() {
    try { g.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { }
  }
  /* Music: UI remembers whether a bed is wanted, and mute wins over it, so
     un-muting mid-run restarts the right bed instead of silence. */
  var musicWanted = false;
  function setMusic(on) {
    musicWanted = !!on;
    if (gestured) call(g.FX, 'music', musicWanted && !settings.muted);
  }
  function applySettings() {
    doc.documentElement.classList.toggle('reduced-fx', !!settings.reducedFx);
    call(g.FX, 'setOptions', {
      volume: settings.volume, muted: settings.muted,
      screenShake: settings.shake, reducedFx: settings.reducedFx
    });
    if (gestured) call(g.FX, 'music', musicWanted && !settings.muted);
    paintSettings();
  }
  function paintSettings() {
    var v = Math.round(settings.volume * 100);
    var sl = $('set-volume');
    if (sl && +sl.value !== v) sl.value = v;
    setText($('set-volume-val'), v + '%');
    toggleState($('set-mute'), settings.muted);
    toggleState($('set-shake'), settings.shake);
    toggleState($('set-fx'), settings.reducedFx);
  }
  function toggleState(btn, isOn) { if (btn) btn.setAttribute('aria-checked', isOn ? 'true' : 'false'); }

  /* ------------------------------- toasts ---------------------------- */
  /* One at a time in an in-flow, FIXED-HEIGHT rail: the arena never resizes
     when a toast arrives, and nothing is ever painted over the playfield.
     Overflow queues and is surfaced as a live "+N" count. */
  var toastQ = [], toastCur = null, toastTimer = null;

  function toast(text, kind, icon, hold) {
    toastQ.push({ text: String(text), kind: kind || 'info', icon: icon || '', hold: hold || 0 });
    if (toastQ.length > 6) toastQ.splice(0, toastQ.length - 6);
    if (!toastCur) nextToast(); else paintToast();
  }
  function nextToast() {
    if (toastTimer != null) { clearTimeout(toastTimer); toastTimer = null; }
    toastCur = toastQ.shift() || null;
    paintToast();
    if (toastCur) {
      var hold = toastCur.hold || (toastQ.length ? 900 : 2100);
      toastTimer = setTimeout(nextToast, hold);
    }
  }
  function clearToasts() {
    if (toastTimer != null) { clearTimeout(toastTimer); toastTimer = null; }
    toastQ.length = 0; toastCur = null; paintToast();
  }
  function paintToast() {
    var inGame = route === 'game' && $('game-ui') && !$('game-ui').hidden;
    var host = inGame ? $('toast-rail') : $('toast-float');
    var other = inGame ? $('toast-float') : $('toast-rail');
    if (other && other.innerHTML) other.innerHTML = '';
    if (!host) return;
    if (!toastCur) { if (host.innerHTML) host.innerHTML = ''; return; }
    var html = '<div class="toast t-' + esc(toastCur.kind) + '">' +
      (toastCur.icon ? '<span class="t-ic">' + esc(toastCur.icon) + '</span>' : '') +
      '<span>' + esc(toastCur.text) + '</span></div>';
    if (toastQ.length) html += '<span class="toast-more">+' + toastQ.length + '</span>';
    host.innerHTML = html;
  }

  /* ------------------- navigation (controller/keyboard) --------------- */
  var navEl = null;

  function navScope() {
    if (overlayStack.length) return $(overlayStack[overlayStack.length - 1]);
    if (route === 'game') return null;               // combat: d-pad drives movement
    return $(route);
  }
  function navTargets() {
    var sc = navScope();
    if (!sc || sc.hidden) return [];
    return qsa('button:not([disabled]),input[type=range],[tabindex="0"]', sc).filter(function (e) {
      return !e.hidden && (e.offsetWidth > 0 || e.offsetHeight > 0);
    });
  }
  function setNavFocus(e) {
    if (navEl && navEl !== e) navEl.classList.remove('nav-focus');
    navEl = e || null;
    if (!navEl) return;
    navEl.classList.add('nav-focus');
    try { navEl.focus({ preventScroll: true }); } catch (_) { try { navEl.focus(); } catch (__) { } }
    try { navEl.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) { }
  }
  function navRefresh(reset) {
    var list = navTargets();
    if (!list.length) { if (navEl) { navEl.classList.remove('nav-focus'); navEl = null; } return; }
    if (reset || !navEl || list.indexOf(navEl) < 0) setNavFocus(list[0]);
  }
  function navCurrent(list) {
    if (navEl && list.indexOf(navEl) >= 0) return navEl;
    var a = doc.activeElement;
    return (a && list.indexOf(a) >= 0) ? a : null;
  }
  function navStep(d) {
    var list = navTargets(); if (!list.length) return;
    var cur = navCurrent(list), i = cur ? list.indexOf(cur) : -1;
    setNavFocus(list[(i + d + list.length) % list.length]);
  }
  function navMove(dx, dy) {
    var list = navTargets(); if (!list.length) return;
    var cur = navCurrent(list);
    if (!cur) { setNavFocus(list[0]); return; }
    if (dx && cur.type === 'range') { adjustRange(cur, dx); return; }
    var cr = cur.getBoundingClientRect();
    var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var e = list[i]; if (e === cur) continue;
      var r = e.getBoundingClientRect();
      var vx = r.left + r.width / 2 - cx, vy = r.top + r.height / 2 - cy;
      var along = dx ? vx * dx : vy * dy;
      var perp = dx ? Math.abs(vy) : Math.abs(vx);
      if (along <= 4) continue;
      var score = along + perp * 2.2;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) setNavFocus(best);
    else navStep((dx > 0 || dy > 0) ? 1 : -1);
  }
  function adjustRange(inp, dir) {
    var stp = +inp.step || 1, v = clamp(+inp.value + dir * stp, +inp.min, +inp.max);
    if (v !== +inp.value) {
      inp.value = v;
      var ev;
      try { ev = new Event('input', { bubbles: true }); }
      catch (e) { ev = doc.createEvent('Event'); ev.initEvent('input', true, false); }
      inp.dispatchEvent(ev);
    }
  }
  function navActivate() {
    var list = navTargets(); if (!list.length) return;
    var cur = navCurrent(list) || list[0];
    if (cur.type === 'range') return;
    cur.click();
  }
  function navBack() {
    var top = overlayStack[overlayStack.length - 1];
    if (top === 'confirm') { confirmFn = null; closeOverlay('confirm'); return; }
    if (top === 'settings') { closeOverlay('settings'); return; }
    if (top === 'pause') { resumeGame(); return; }
    if (top === 'death' || top === 'pact-draft') return;   // require an explicit choice
    if (route === 'select' || route === 'covenant') goBackFromScreen();
  }

  /* ------------------------- screens & overlays ---------------------- */
  var route = 'menu';
  var overlayStack = [];
  var openers = {};
  var covReturn = 'menu';

  function routeTo(name) {
    route = name;
    if ($('menu')) $('menu').hidden = name !== 'menu';
    if ($('select')) $('select').hidden = name !== 'select';
    if ($('covenant')) $('covenant').hidden = name !== 'covenant';
    if ($('game-ui')) $('game-ui').hidden = name !== 'game';

    /* Leaving the game stops the loop; coming BACK has to start it again, or
       the arena behind the death overlay is a frozen frame (death -> covenant
       -> back rendered 0 times until reload). */
    if (name !== 'game') { stopLoop(); UI.paused = false; }
    else if (!UI.paused && state().phase) startLoop();
    if (name === 'menu') { closeAllOverlays(); refreshMenu(); }
    if (name === 'select') refreshSelect();
    if (name === 'covenant') renderCovenant();
    if (name === 'game') requestResize();
    paintToast();
    navRefresh(true);
  }
  function goBackFromScreen() {
    if (route === 'covenant' && covReturn === 'death') {
      covReturn = 'menu';
      routeTo('game');
      renderDeath(state());
      openOverlay('death');
      return;
    }
    routeTo('menu');
  }
  /* Pointer input aimed at an overlay is ignored for this long after it opens,
     so a tap meant for the ability underneath cannot activate it. */
  var OVERLAY_ARM_MS = 450;
  var overlayArmedAt = 0;
  function overlayGuard(e) {
    if (!overlayStack.length) return;
    /* Only real input can be "already in flight" — a programmatic .click() is
       not a thumb, and gating on that keeps scripted callers working. */
    if (e.isTrusted === false) return;
    if (perfNow() - overlayArmedAt >= OVERLAY_ARM_MS) return;
    var top = $(overlayStack[overlayStack.length - 1]);
    if (!top || !e.target || !top.contains(e.target)) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }
  function openOverlay(id) {
    var e = $(id); if (!e || overlayStack.indexOf(id) >= 0) return;
    openers[id] = doc.activeElement;
    overlayStack.push(id);
    e.hidden = false;
    overlayArmedAt = perfNow();
    navRefresh(true);
  }
  function closeOverlay(id) {
    var i = overlayStack.indexOf(id); if (i < 0) return;
    overlayStack.splice(i, 1);
    var e = $(id); if (e) e.hidden = true;
    var o = openers[id]; openers[id] = null;
    if (o && o.isConnected && !overlayStack.length && route !== 'game') setNavFocus(o);
    else navRefresh(true);
  }
  function closeAllOverlays() {
    while (overlayStack.length) {
      var id = overlayStack.pop(); var e = $(id); if (e) e.hidden = true;
    }
    navRefresh(true);
  }
  function isOpen(id) { return overlayStack.indexOf(id) >= 0; }

  /* ------------------------- help & tutorial -------------------------
     content.js has always carried STRINGS.help and a ten-step
     STRINGS.tutorial keyed to sim events. Nothing consumed either, so the
     game shipped with its own tutorial switched off and every one of its
     terms — Veil, Focus, motes, par, breach, headroom — undefined on screen.
     ------------------------------------------------------------------ */
  var TUT_KEY = 'veilLegendsSeenTips';
  var seenTips = null;
  function loadSeenTips() {
    if (seenTips) return seenTips;
    seenTips = {};
    try {
      var raw = g.localStorage && g.localStorage.getItem(TUT_KEY);
      var o = raw ? JSON.parse(raw) : null;
      if (o && typeof o === 'object' && !(o instanceof Array)) {
        for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) seenTips[k] = !!o[k];
      }
    } catch (e) { seenTips = {}; }
    return seenTips;
  }
  function markTipSeen(id) {
    loadSeenTips()[id] = true;
    try { g.localStorage.setItem(TUT_KEY, JSON.stringify(seenTips)); } catch (e) { }
  }
  function tips() { var s = strings().tutorial; return (s instanceof Array) ? s : []; }

  function openHelp() {
    var h = strings().help || {};
    var host = $('help-body'); if (!host) return;
    host.innerHTML = '';
    if (h.thesis) {
      var t = el('p', 'help-thesis', h.thesis);
      host.appendChild(t);
    }
    var secs = (h.sections instanceof Array) ? h.sections : [];
    for (var i = 0; i < secs.length; i++) {
      var wrap = el('div', 'help-sec');
      wrap.appendChild(el('h3', 'help-h', String(secs[i].h || '')));
      wrap.appendChild(el('p', 'help-p', String(secs[i].p || '')));
      host.appendChild(wrap);
    }
    if (!secs.length && !h.thesis) host.appendChild(el('p', 'tip-line', 'No help available.'));
    openOverlay('help');
  }

  /* One tip at a time, each shown once ever, and the run is paused behind it —
     a 2.4s toast over live combat is not a teaching moment. */
  var tutPending = null;
  function showTip(tip) {
    if (!tip || loadSeenTips()[tip.id] || isOpen('tutorial')) return;
    markTipSeen(tip.id);
    setText($('tut-title'), String(tip.title || ''));
    setText($('tut-body'), String(tip.body || ''));
    tutPending = tip;
    if (!UI.paused) { UI.paused = true; tutResumeOnClose = true; } else tutResumeOnClose = false;
    openOverlay('tutorial');
  }
  var tutResumeOnClose = false;
  function dismissTutorial() {
    closeOverlay('tutorial');
    tutPending = null;
    if (tutResumeOnClose) { tutResumeOnClose = false; UI.paused = false; }
  }
  function fireTip(when) {
    var list = tips();
    for (var i = 0; i < list.length; i++) if (list[i].when === when) { showTip(list[i]); return; }
  }

  var tutSeenBreaches = 0;
  function tutorialWatch(s, evs) {
    if (!s || !tips().length) return;
    if (route !== 'game') return;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.type === 'wave_start' && s.wave === 1) fireTip('first_combat');
      else if (e.type === 'cast') fireTip('first_cast');
      else if (e.type === 'overdraw') fireTip('first_overdraw');
      else if (e.type === 'tier_change' && num(s.veil) >= 25) fireTip('veil_25');
      else if (e.type === 'breach') {
        tutSeenBreaches++;
        fireTip(tutSeenBreaches >= 2 ? 'second_breach' : 'first_breach');
      } else if (e.type === 'wave_start' && s.wave === 5) fireTip('first_boss');
    }
    if (s.phase === 'pactDraft') fireTip('first_draft');
    /* Settle and par have no event of their own — they are states. */
    if (s.phase === 'combat' && num(s.parRemaining) < 0) fireTip('par_visible');
    if (s.phase === 'combat' && num(s.veil) > 12 && num(s.veil) > num(s.veilFloor) + 8) fireTip('settle_available');
  }

  /* confirm dialog -------------------------------------------------- */
  var confirmFn = null;
  function askConfirm(title, body, yesLabel, fn) {
    setText($('confirm-title'), title);
    setText($('confirm-body'), body);
    setText($('confirm-yes'), yesLabel || 'CONFIRM');
    confirmFn = fn;
    openOverlay('confirm');
  }

  /* ------------------------------ MENU ------------------------------- */
  function refreshMenu() {
    var m = meta(), run = savedRun();
    setText($('menu-echoes'), (num(m.echoes) | 0) + ' echoes banked');
    setText($('menu-best'), 'Best wave ' + (m.bestWaveEver ? m.bestWaveEver : '—') +
      (m.ascension ? ' · Ascension ' + m.ascension : ''));
    var btn = $('btn-continue');
    if (run) {
      var h = byId(heroes(), run.heroId);
      setText($('continue-summary'),
        'Wave ' + (run.wave || 1) + ' · ' + (h ? h.name : (run.heroId || 'champion')) +
        ' · ✦' + (num(run.motes) | 0) +
        ' · ' + ((run.pactsTaken || []).length) + ' pacts');
      btn.disabled = false;
    } else {
      setText($('continue-summary'), 'No saved run');
      btn.disabled = true;
    }
  }

  /* ----------------------- SELECT (hero/rift/asc) --------------------- */
  var selHero = null, selRift = null, selPet = null, selAsc = 0;

  function heroUnlocked(h, m) {
    if (!h.unlockAt) return true;
    return (m.heroesUnlocked || []).indexOf(h.id) >= 0;
  }
  function riftUnlocked(r, m) {
    if (!r.unlockAt) return true;
    return (m.riftsUnlocked || []).indexOf(r.id) >= 0;
  }
  /* Familiars gate straight off bestWaveEver rather than a meta list, so they
     needed no save-schema change and no migration for existing players. */
  function petUnlocked(p, m) {
    if (!p.unlockAt) return true;
    var w = +p.unlockAt.wave;
    if (isFinite(w)) return num(m.bestWaveEver) >= w;
    return false;
  }
  /* A bare "Wave 12" badge reads as a label, not a lock — players tapped these
     cards, got no response and assumed the game was broken. Say the verb. */
  function unlockText(u) {
    if (!u) return '';
    var hs = strings().heroSelect || {};
    if (u.wave) return tok(hs.locked || 'Locked — reach wave {wave} in a single run.', { wave: u.wave });
    if (u.ascension) return 'Locked — reach Ascension ' + u.ascension + '.';
    return 'Locked';
  }
  function refreshSelect() {
    var m = meta(), H = heroes(), R = rifts(), i;
    if (!selHero || !byId(H, selHero)) {
      selHero = null;
      for (i = 0; i < H.length; i++) if (heroUnlocked(H[i], m)) { selHero = H[i].id; break; }
      if (!selHero && H.length) selHero = H[0].id;
    }
    if (!selRift || !byId(R, selRift)) {
      selRift = null;
      for (i = 0; i < R.length; i++) if (riftUnlocked(R[i], m)) { selRift = R[i].id; break; }
      if (!selRift && R.length) selRift = R[0].id;
    }
    selAsc = clamp(selAsc, 0, num(m.ascensionUnlocked));
    setText($('sel-echoes'), '✦' + (num(m.echoes) | 0));

    var hr = $('hero-row'); hr.innerHTML = '';
    H.forEach(function (h) {
      var ok = heroUnlocked(h, m);
      var b = el('button', 'card' + (h.id === selHero ? ' selected' : ''));
      b.type = 'button'; b.disabled = !ok;
      b.setAttribute('aria-pressed', h.id === selHero ? 'true' : 'false');
      /* STRINGS.heroSelect.sub says regen "is the whole difference" — and the
         card used to omit it, so the deciding stat was not on the comparison
         surface. focusLine was written for this and had no consumer. */
      var hs = strings().heroSelect || {};
      var statLine = tok(hs.focusLine || '{regen} Focus/s regen · {max} pool · {hp} HP',
        { regen: r1(h.focusRegen), max: num(h.focusMax) | 0, hp: num(h.hp) | 0 });
      b.innerHTML = '<span class="card-icon">' + esc(h.icon || '⚔️') + '</span>' +
        '<span class="card-name">' + esc(h.name || h.id) + '</span>' +
        '<span class="card-stat">' + esc(statLine) + '</span>' +
        (ok ? '' : '<span class="card-lock">' + esc(unlockText(h.unlockAt)) + '</span>');
      b.onclick = function () { selHero = h.id; refreshSelect(); tapSfx(); };
      hr.appendChild(b);
    });

    var rr = $('rift-row'); rr.innerHTML = '';
    R.forEach(function (r) {
      var ok = riftUnlocked(r, m);
      var b = el('button', 'card rift-card' + (r.id === selRift ? ' selected' : ''));
      b.type = 'button'; b.disabled = !ok;
      b.setAttribute('aria-pressed', r.id === selRift ? 'true' : 'false');
      b.innerHTML = '<span class="card-name">' + esc(r.name || r.id) + '</span>' +
        (ok ? '' : '<span class="card-lock">' + esc(unlockText(r.unlockAt)) + '</span>');
      b.onclick = function () { selRift = r.id; refreshSelect(); tapSfx(); };
      rr.appendChild(b);
    });

    var rift = byId(R, selRift);
    setText($('rift-text'), (rift && (rift.text || rift.desc)) || 'Standard rift.');

    /* Familiars. "None" is a real, selectable option — the familiar is a
       convenience, not a requirement, and hiding that would be a lie. */
    var P = pets(), pr = $('pet-row');
    if (pr) {
      pr.innerHTML = '';
      var none = el('button', 'card rift-card' + (selPet ? '' : ' selected'));
      none.type = 'button';
      none.setAttribute('aria-pressed', selPet ? 'false' : 'true');
      none.innerHTML = '<span class="card-icon">✕</span><span class="card-name">None</span>';
      none.onclick = function () { selPet = null; refreshSelect(); tapSfx(); };
      pr.appendChild(none);
      P.forEach(function (p) {
        var ok = petUnlocked(p, m);
        var b = el('button', 'card' + (p.id === selPet ? ' selected' : ''));
        b.type = 'button'; b.disabled = !ok;
        b.setAttribute('aria-pressed', p.id === selPet ? 'true' : 'false');
        b.innerHTML = '<span class="card-icon">' + esc(p.icon || '✦') + '</span>' +
          '<span class="card-name">' + esc(p.name || p.id) + '</span>' +
          '<span class="card-stat">' + (num(p.collectR) | 0) + 'px reach · ' + r1(p.dps) + ' dps</span>' +
          (ok ? '' : '<span class="card-lock">' + esc(unlockText(p.unlockAt)) + '</span>');
        b.onclick = function () { selPet = p.id; refreshSelect(); tapSfx(); };
        pr.appendChild(b);
      });
    }
    var pet = byId(P, selPet);
    setText($('pet-text'), (pet && pet.text) ||
      'No familiar. Every mote you want, you walk over yourself.');

    renderHeroAbilities(byId(H, selHero));

    var A = ascensions(), a = null;
    for (var k = 0; k < A.length; k++) if (num(A[k].level) === selAsc) a = A[k];
    setText($('asc-num'), 'A' + selAsc);
    setText($('asc-name'), (a && a.name) || (selAsc === 0 ? 'Baseline' : 'Ascension ' + selAsc));
    setText($('asc-text'), (a && a.text) || (selAsc === 0 ? 'Standard rules.' : 'Harder rules apply.'));
    $('asc-down').disabled = selAsc <= 0;
    $('asc-up').disabled = selAsc >= num(m.ascensionUnlocked);
  }
  /* Always-visible ability tip panel - the old splash pattern, reused. */
  function renderHeroAbilities(h) {
    var host = $('hero-abilities'); if (!host) return;
    var list = (h && h.abilities) || [];
    if (!list.length) {
      host.innerHTML = '<p class="tip-text">Ability details appear with the champion roster.</p>';
      return;
    }
    host.innerHTML = list.map(function (a) {
      var bits = [];
      if (a.focusCost != null) bits.push(num(a.focusCost) + ' Focus');
      if (a.maxCd != null) bits.push(r1(a.maxCd) + 's cd');
      if (a.kind) bits.push(a.kind);
      return '<div class="tip-item"><span class="tip-icon">' + esc(a.icon || '•') + '</span>' +
        '<span class="tip-body"><span class="tip-name">' + esc(a.name || '') + '</span>' +
        (bits.length ? '<span class="tip-meta">' + esc(bits.join(' · ')) + '</span>' : '') +
        '<span class="tip-text">' + esc(a.tip || a.text || '') + '</span></span></div>';
    }).join('');
  }

  /* ---------------------------- COVENANT ----------------------------- */
  var covSel = null;

  function nodeDepth(n, all, seen) {
    if (!n || !n.requires || !n.requires.length) return 0;
    seen = seen || {};
    if (seen[n.id]) return 0;
    seen[n.id] = 1;
    var d = 0;
    for (var i = 0; i < n.requires.length; i++) {
      var p = byId(all, n.requires[i]);
      if (p) d = Math.max(d, 1 + nodeDepth(p, all, seen));
    }
    return d;
  }
  function ownedFloor(m) {
    var own = m.covenantOwned || [], all = covenant(), f = 0;
    for (var i = 0; i < own.length; i++) { var n = byId(all, own[i]); if (n) f += num(n.upkeep); }
    return r1(f);
  }
  function renderCovenant() {
    var all = covenant(), m = meta(), own = m.covenantOwned || [];
    setText($('cov-echoes'), '✦' + (num(m.echoes) | 0));
    setText($('cov-floor'), String(ownedFloor(m)));
    setText($('cov-headroom'), String(r1(SAFE_CEIL - ownedFloor(m))));
    setText($('cov-owned'), String(own.length));

    var host = $('cov-scroll'); host.innerHTML = '';
    if (!all.length) {
      host.appendChild(el('p', 'tip-line', 'The Covenant loads with the content module.'));
      setText($('cov-detail'), 'No nodes available yet.');
      return;
    }
    var tiersMap = {};
    all.forEach(function (n) { var d = nodeDepth(n, all); (tiersMap[d] = tiersMap[d] || []).push(n); });
    Object.keys(tiersMap).sort().forEach(function (d) {
      var sec = el('div', 'cov-tier');
      sec.appendChild(el('div', 'cov-tier-label', 'Tier ' + (+d + 1)));
      var grid = el('div', 'cov-grid');
      tiersMap[d].forEach(function (n) { grid.appendChild(covNode(n, all, m, own)); });
      sec.appendChild(grid);
      host.appendChild(sec);
    });
    paintCovDetail(all, m, own);
    if (covSel) { var sel = byId(all, covSel); if (sel) highlightReq(sel, all); }
  }
  function covNode(n, all, m, own) {
    var isOwned = own.indexOf(n.id) >= 0;
    var reqOk = (n.requires || []).every(function (r) { return own.indexOf(r) >= 0; });
    var afford = num(m.echoes) >= num(n.cost);
    var b = el('button', 'cov-node' + (isOwned ? ' owned' : (!reqOk ? ' locked' : (afford ? ' affordable' : ''))));
    b.type = 'button';
    b.setAttribute('data-node', n.id);
    var reqNames = (n.requires || []).map(function (r) { var p = byId(all, r); return p ? p.name : r; });
    b.innerHTML =
      '<span class="n-name">' + esc(n.name || n.id) + '</span>' +
      '<span class="n-cost">' + (isOwned ? 'BOUND' : '✦' + (num(n.cost) | 0)) + '</span>' +
      (n.clean || !num(n.upkeep)
        ? '<span class="badge badge-clean">CLEAN · no upkeep</span>'
        : '<span class="badge badge-upkeep">UPKEEP +' + r1(n.upkeep) + ' floor</span>') +
      (reqNames.length ? '<span class="n-req">Requires ' + esc(reqNames.join(' + ')) + '</span>' : '');
    b.onclick = function () { onCovNode(n, all, m, own, isOwned, reqOk, afford); };
    return b;
  }
  function onCovNode(n, all, m, own, isOwned, reqOk, afford) {
    tapSfx();
    if (covSel !== n.id || isOwned || !reqOk || !afford) {
      covSel = n.id;
      renderCovenant();
      return;
    }
    var ok = call(g.Sim, 'buyCovenant', n.id);
    if (ok) { toast('Bound: ' + (n.name || n.id), 'good', '✦'); call(g.FX, 'sfx', 'buy'); }
    else toast('Could not bind that node', 'warn', '⚠');
    covSel = null;
    renderCovenant();
  }
  function highlightReq(n, all) {
    qsa('.cov-node', $('cov-scroll')).forEach(function (e) {
      e.classList.remove('req-hi'); e.classList.remove('dep-hi');
      var id = e.getAttribute('data-node');
      if ((n.requires || []).indexOf(id) >= 0) e.classList.add('req-hi');
      var other = byId(all, id);
      if (other && (other.requires || []).indexOf(n.id) >= 0) e.classList.add('dep-hi');
    });
  }
  function paintCovDetail(all, m, own) {
    var d = $('cov-detail');
    if (!covSel) { setText(d, 'Select a node to see its cost and requirements.'); return; }
    var n = byId(all, covSel); if (!n) { setText(d, ''); return; }
    var isOwned = own.indexOf(n.id) >= 0;
    var reqOk = (n.requires || []).every(function (r) { return own.indexOf(r) >= 0; });
    var ops = opList(n.ops).map(function (o) { return o.text; }).join(' · ');
    var line = (n.name || n.id) + ' — ' + (ops || 'no effects listed') + '. ';
    if (isOwned) line += 'Already bound.';
    else if (!reqOk) line += 'Locked: bind its requirements first.';
    else if (num(m.echoes) < num(n.cost)) line += 'Costs ✦' + (num(n.cost) | 0) + ' — you have ✦' + (num(m.echoes) | 0) + '.';
    else line += 'Costs ✦' + (num(n.cost) | 0) +
      (num(n.upkeep) ? ', adds +' + r1(n.upkeep) + ' starting Veil floor' : ', adds no upkeep') +
      '. Tap again to bind.';
    setText(d, line);
  }

  /* ---------------------------- ops labels --------------------------- */
  var OP_LABEL = {
    focusRegenAdd: 'Focus regen', focusMaxAdd: 'Max Focus', hpMaxAdd: 'Max HP',
    moveSpeedMult: 'Move speed', damageMult: 'All damage', meleeDamageMult: 'Melee damage',
    projDamageMult: 'Projectile damage', aoeDamageMult: 'AoE damage', cooldownMult: 'Cooldowns',
    lifestealPct: 'Lifesteal', thornsPct: 'Thorns', executeThresholdAdd: 'Execute threshold',
    chainCount: 'Chain targets', pierceCount: 'Pierce', aoeRadiusMult: 'AoE radius',
    moteMagnetRadius: 'Mote magnet', moteLifeAdd: 'Mote lifetime', parAdd: 'Par time',
    veilDecayMult: 'Veil decay', overdrawRateMult: 'Overdraw cost', brinkGuard: 'Brink guard',
    hpRestoreMultBetweenWaves: 'Between-wave heal', critChanceAdd: 'Crit chance',
    critMult: 'Crit damage', wraithDamageMult: 'Wraith damage', settleWindowAdd: 'Settle window'
  };
  var LOWER_BETTER = { cooldownMult: 1, overdrawRateMult: 1 };
  function opList(ops) {
    var out = [];
    if (!ops) return out;
    Object.keys(ops).forEach(function (k) {
      var v = ops[k]; if (v == null || v === 0) return;
      var lab = OP_LABEL[k] || k, text, good;
      if (/Mult$/.test(k)) { text = lab + ' ×' + r2(v); good = LOWER_BETTER[k] ? v < 1 : v > 1; }
      else if (/Pct$/.test(k)) { text = lab + ' ' + sgn(v) + '%'; good = v > 0; }
      else if (k === 'critChanceAdd') { text = lab + ' ' + sgn(v <= 1 ? v * 100 : v) + '%'; good = v > 0; }
      else if (k === 'moteLifeAdd' || k === 'parAdd' || k === 'settleWindowAdd') { text = lab + ' ' + sgn(v) + 's'; good = v > 0; }
      else if (k === 'moteMagnetRadius') { text = lab + ' ' + sgn(v) + 'px'; good = v > 0; }
      else if (k === 'brinkGuard') { text = 'Absorbs ' + (v | 0) + ' breach' + (v === 1 ? '' : 'es'); good = v > 0; }
      else { text = lab + ' ' + sgn(v); good = v > 0; }
      out.push({ text: text, good: good });
    });
    return out;
  }

  /* --------------------------- PACT DRAFT ---------------------------- */
  function renderDraft(s) {
    var offer = s.draftOffer || [];
    var motes = num(s.motes) | 0, floor = r1(s.veilFloor);
    setText($('draft-motes'), '✦' + motes);
    setText($('draft-floor'), String(floor));
    setText($('draft-headroom'), String(r1(SAFE_CEIL - floor)));
    var host = $('draft-cards'); host.innerHTML = '';
    if (!offer.length) {
      host.appendChild(el('p', 'tip-line', 'No pacts on offer.'));
      return;
    }
    offer.forEach(function (pid) {
      var p = byId(pacts(), pid) ||
        { id: pid, name: String(pid), icon: '✦', tier: 1, cost: 0, upkeep: 0, text: '', ops: {} };
      host.appendChild(pactCard(p, motes, floor));
    });
  }
  function pactCard(p, motes, floor) {
    var cost = num(p.cost) | 0, up = r1(p.upkeep), clean = !up;
    var b = el('button', 'pact-card'); b.type = 'button';
    var afford = motes >= cost;
    b.disabled = !afford;
    var ops = opList(p.ops).map(function (o) {
      return '<span class="op ' + (o.good ? 'op-good' : 'op-bad') + '">' + esc(o.text) + '</span>';
    }).join('');
    b.innerHTML =
      '<span class="pact-head">' +
      '<span class="pact-icon">' + esc(p.icon || '✦') + '</span>' +
      '<span class="pact-name">' + esc(p.name || p.id) + '</span>' +
      '<span class="pact-upkeep' + (clean ? ' clean' : '') + '">' +
      '<span class="u-num">' + (clean ? 'CLEAN' : '+' + up) + '</span>' +
      '<span class="u-lab">' + (clean ? 'NO UPKEEP' : 'VEIL FLOOR UPKEEP') + '</span>' +
      '</span>' +
      '</span>' +
      (p.text ? '<span class="pact-flavor">' + esc(p.text) + '</span>' : '') +
      (ops ? '<span class="pact-ops">' + ops + '</span>' : '') +
      '<span class="pact-foot">' +
      '<span class="pact-cost' + (afford ? '' : ' short') + '">✦' + cost +
      (afford ? '' : ' — short by ' + (cost - motes)) + '</span>' +
      '<span class="pact-after">Floor ' + floor + ' → ' + r1(floor + up) +
      ' · headroom ' + r1(SAFE_CEIL - floor - up) + '</span>' +
      '</span>';
    b.onclick = function () { takePact(p.id); };
    return b;
  }
  function takePact(id) {
    firstGesture();
    call(g.FX, 'sfx', 'pact');                   // pact seal
    call(g.Sim, 'choosePact', id);
    closeOverlay('pact-draft');
  }

  /* ------------------------------ DEATH ------------------------------ */
  var echoesAtStart = 0;
  function deathCause(s) {
    if (s.deathCause) return s.deathCause;
    var en = s.enemies || [];
    for (var i = 0; i < en.length; i++) if (en[i] && en[i].isWraith) return 'wraith';
    if (num(s.veil) >= 80) return 'brink';
    if (num(s.veilFloor) >= 25) return 'attrition';
    return 'swarm';
  }
  function renderDeath(s) {
    var st = s.runStats || {}, m = s.meta || meta();
    /* sim.js publishes state.lastRunEchoes on endRun; the others are fallbacks. */
    var banked = num(s.lastRunEchoes, NaN);
    if (!isFinite(banked)) banked = num(st.echoesEarned, NaN);
    if (!isFinite(banked)) banked = num(st.echoesBanked, NaN);
    if (!isFinite(banked)) banked = Math.max(0, num(m.echoes) - echoesAtStart);
    var cause = deathCause(s);
    setText($('death-title'), causeTitle(cause));
    setText($('death-cause'), causeLine(cause, s));
    setText($('death-echoes'), '+' + (banked | 0));
    setText($('death-echoes-total'), (num(m.echoes) | 0) + ' total');
    var stats = [
      ['Wave reached', s.wave || st.bestWave || 1],
      ['Kills', num(st.kills) | 0],
      ['Breaches', num(st.breaches) | 0],
      ['Motes earned', num(st.motesEarned) | 0],
      ['Time', mmss(st.timePlayed)],
      ['Veil floor', r1(s.veilFloor)]
    ];
    $('death-stats').innerHTML = stats.map(function (p) {
      return '<div class="stat"><span class="s-lab">' + esc(p[0]) + '</span>' +
        '<span class="s-val">' + esc(String(p[1])) + '</span></div>';
    }).join('');
  }

  /* ------------------------------ PAUSE ------------------------------ */
  function renderPause() {
    var s = state();
    setText($('pause-sub'), 'Wave ' + (s.wave || 1) + ' · HP ' + (num(s.hp) | 0) + '/' + (num(s.hpMax) | 0) +
      ' · Veil ' + Math.round(num(s.veil)) + ' (floor ' + r1(s.veilFloor) + ')');
    var taken = s.pactsTaken || [];
    $('pause-pacts').innerHTML = taken.length
      ? taken.map(function (id) {
        var p = byId(pacts(), id);
        return '<span class="pact-chip">' + esc((p && ((p.icon || '') + ' ' + p.name)) || id) + '</span>';
      }).join('')
      : '<span class="pact-chip">No pacts taken</span>';
  }
  function openPause() {
    if (route !== 'game' || isOpen('pause')) return;
    UI.paused = true;
    renderPause();
    openOverlay('pause');
    setMusic(false);
  }
  function resumeGame() {
    closeOverlay('settings');
    closeOverlay('pause');
    UI.paused = false;
    setMusic(true);
  }
  function togglePause() { if (isOpen('pause')) resumeGame(); else openPause(); }

  /* ------------------------------- HUD -------------------------------- */
  var last = {};
  var abilitySig = '';
  var overdrawUntil = 0;

  function buildVeilBands() {
    var T = tiers(), bands = $('veil-bands'), legend = $('veil-legend');
    if (!bands) return;
    bands.innerHTML = ''; if (legend) legend.innerHTML = '';
    for (var i = 0; i < T.length; i++) {
      var lo = num(T[i].min), hi = (i + 1 < T.length) ? num(T[i + 1].min) : 100;
      var w = Math.max(0, hi - lo);
      var d = el('div', 'veil-band'); d.style.width = w + '%';
      bands.appendChild(d);
      if (legend) {
        var sp = el('span', null, '×' + num(T[i].mult, 1));
        sp.style.flex = w + ' 0 0%';
        legend.appendChild(sp);
      }
    }
  }
  function tierIndex(v) {
    var T = tiers(), idx = 0;
    for (var i = 0; i < T.length; i++) if (v >= num(T[i].min)) idx = i;
    return idx;
  }
  function abBtn(i) { return doc.querySelector('#hud-bottom .ability-btn[data-ab="' + i + '"]'); }
  function rebuildAbilities(list) {
    for (var i = 0; i < 4; i++) {
      var btn = abBtn(i); if (!btn) continue;
      var a = list[i];
      setText(btn.querySelector('.ab-icon'), (a && a.icon) || '·');
      setText(btn.querySelector('.ab-name'), (a && a.name) || '—');
      btn.setAttribute('aria-label', (a && a.name) ? a.name + ' (key ' + (i + 1) + ')' : 'Empty ability slot');
      btn.disabled = !a;
    }
  }
  function paintHud(s) {
    /* --- meta row --- */
    var wave = num(s.wave, 1) | 0;
    if (last.wave !== wave) { last.wave = wave; setText($('hud-wave'), String(wave)); }
    var motes = num(s.motes) | 0;
    if (last.motes !== motes) { last.motes = motes; setText($('hud-motes'), String(motes)); }

    var par = num(s.parRemaining);
    /* A bare "0:20" taught nobody what the clock was, and going past it
       silently ratchets a permanent Veil floor. STRINGS.hud.par/overPar were
       written for exactly this and had no consumer. */
    var hudS = (strings().hud) || {};
    var parTxt = par >= 0
      ? tok(hudS.par || "PAR {time}", { time: mmss(par) })
      : tok(hudS.overPar || "OVER PAR +{time}", { time: mmss(-par) });
    if (last.parTxt !== parTxt) { last.parTxt = parTxt; setText($('hud-par'), parTxt); }

    /* Wraiths are permanent, stack, and had no counter anywhere on screen. */
    var wr = num(s.wraithCount) | 0;
    if (last.wraiths !== wr) {
      last.wraiths = wr;
      var wt = $('hud-wraiths');
      if (wt) {
        wt.hidden = wr <= 0;
        if (wr > 0) setText(wt, tok(hudS.wraiths || "WRAITHS {n}", { n: String(wr) }));
      }
    }
    /* warning arrives BEFORE the cliff: hot at 6s left, critical past par */
    var parState = par < 0 ? 'crit' : (par <= 6 ? 'warn' : '');
    if (last.parState !== parState) {
      last.parState = parState;
      var pc = $('hud-par');
      setCls(pc, 'warn', parState === 'warn');
      setCls(pc, 'crit', parState === 'crit');
    }

    /* --- HP: the first question the player asks --- */
    var hp = Math.max(0, num(s.hp)), hpMax = Math.max(1, num(s.hpMax, 1));
    var hpPct = hp / hpMax * 100;
    setW($('hp-fill'), hpPct);
    var hpTxt = Math.round(hp) + '/' + Math.round(hpMax);
    if (last.hpTxt !== hpTxt) { last.hpTxt = hpTxt; setText($('hp-val'), hpTxt); }
    var hpState = hpPct <= 25 ? 'crit' : (hpPct <= 50 ? 'warn' : '');
    if (last.hpState !== hpState) {
      last.hpState = hpState;
      var hb = $('hp-fill').parentNode, hv = $('hp-val');
      setCls(hb, 'warn', hpState === 'warn'); setCls(hb, 'crit', hpState === 'crit');
      setCls(hv, 'warn', hpState === 'warn'); setCls(hv, 'crit', hpState === 'crit');
    }

    /* --- Focus + Overdraw --- */
    var f = Math.max(0, num(s.focus)), fMax = Math.max(1, num(s.focusMax, 1));
    setW($('focus-fill'), f / fMax * 100);
    var fTxt = Math.round(f) + '/' + Math.round(fMax);
    if (last.fTxt !== fTxt) { last.fTxt = fTxt; setText($('focus-val'), fTxt); }
    var od = perfNow() < overdrawUntil;
    if (last.od !== od) {
      last.od = od;
      setCls($('focus-outer'), 'overdraw', od);
      setCls($('focus-val'), 'overdraw', od);
      if (!od) setW($('focus-deficit'), 0);
    }

    /* --- Veil meter (bands + tier highlight + floor + brink) --- */
    var v = clamp(num(s.veil), 0, 100), floor = clamp(num(s.veilFloor), 0, 100);
    setW($('veil-fill'), v);
    setW($('veil-floor-mark'), floor);
    var ti = tierIndex(v);
    if (last.tier !== ti) {
      last.tier = ti;
      qsa('.veil-band', $('veil-bands')).forEach(function (b, i) { b.classList.toggle('on', i === ti); });
      qsa('span', $('veil-legend')).forEach(function (b, i) { b.classList.toggle('on', i === ti); });
      /* Tie the meter accent to the arena tint FX is using (tier-step only). */
      var pal = call(g.FX, 'veilPalette', v);
      /* Only the documented accent fields - the bare return value is an arena
         tint (near-black) and would erase the meter's border. */
      var acc = pal && (pal.accentLight || pal.accent);
      if (typeof acc === 'string' && acc) $('veil-meter').style.setProperty('--veil-accent', acc);
    }
    var vTxt = Math.round(v) + ' ×' + num(tiers()[ti] && tiers()[ti].mult, 1);
    if (last.vTxt !== vTxt) { last.vTxt = vTxt; setText($('veil-val'), vTxt); }
    var vState = v >= SAFE_CEIL ? 'crit' : (v >= 70 ? 'hot' : '');
    if (last.vState !== vState) {
      last.vState = vState;
      var vm = $('veil-meter'), vv = $('veil-val');
      setCls(vm, 'hot', vState === 'hot'); setCls(vm, 'crit', vState === 'crit');
      setCls(vv, 'hot', vState === 'hot'); setCls(vv, 'crit', vState === 'crit');
    }

    /* --- wave HP remaining (the other legal input, DESIGN 5.4) --- */
    var wr = Math.max(0, num(s.waveHpRemaining)), wt = Math.max(1, num(s.waveHpTotal, 1));
    var wp = wr / wt * 100;
    setW($('wave-fill'), wp);
    var wTxt = Math.round(wp) + '%';
    if (last.wTxt !== wTxt) { last.wTxt = wTxt; setText($('wave-hp-val'), wTxt); }

    /* --- ability buttons --- */
    var abs = s.abilities || [];
    var sig = abs.map(function (a) { return a && a.id; }).join('|');
    if (sig !== abilitySig) { abilitySig = sig; rebuildAbilities(abs); }
    for (var i = 0; i < 4; i++) {
      var a = abs[i]; if (!a) continue;
      var btn = abBtn(i); if (!btn) continue;
      var cd = Math.max(0, num(a.cd)), maxCd = Math.max(0.0001, num(a.maxCd, 1));
      var pct = Math.round(cd / maxCd * 100);
      var lk = 'ab' + i;
      if (last[lk + 'p'] !== pct) {
        last[lk + 'p'] = pct;
        btn.querySelector('.cd-sweep').style.setProperty('--p', pct + '%');
        setText(btn.querySelector('.ab-cd'), cd > 0.05 ? (cd >= 1 ? String(Math.ceil(cd)) : cd.toFixed(1)) : '');
        btn.classList.toggle('ready', cd <= 0.0001);
        btn.classList.toggle('cooling', cd > 0.0001);
      }
      var cost = num(a.focusCost) | 0;
      if (last[lk + 'c'] !== cost) { last[lk + 'c'] = cost; setText(btn.querySelector('.ab-cost'), cost + 'F'); }
      var wo = cost > f;
      if (last[lk + 'o'] !== wo) { last[lk + 'o'] = wo; btn.classList.toggle('will-overdraw', wo); }
    }
  }

  /* --------------------- events (read-only for UI) ------------------- */
  function readEvents(evs) {
    if (!evs || !evs.length) return;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i]; if (!e) continue;
      switch (e.type) {
        case 'overdraw':
          overdrawUntil = perfNow() + 900;
          setW($('focus-deficit'), clamp(num(e.deficit) / Math.max(1, num(state().focusMax, 1)) * 100, 6, 100));
          setCls($('focus-outer'), 'overdraw', true);
          setCls($('focus-val'), 'overdraw', true);
          last.od = true;
          break;
        case 'breach':
          toast('VEIL BREACH — a wraith walks', 'bad', '☠', 2400);
          break;
        case 'wraith_spawn':
          toast('Wraith spawned', 'bad', '☠');
          break;
        case 'wave_start':
          toast('Wave ' + num(e.wave, 1), 'info', '◆');
          break;
        case 'wave_clear':
          toast('Wave ' + num(e.wave, 1) + ' cleared' + (e.overPar ? ' — over par, floor rose' : ''),
            e.overPar ? 'warn' : 'good', e.overPar ? '⚠' : '✔');
          break;
        case 'pact_taken':
          var p = byId(pacts(), e.pactId);
          toast('Pact bound: ' + ((p && p.name) || e.pactId), 'info', '✦');
          break;
        case 'tier_change':
          var T = tiers();
          toast('Veil tier ×' + num(T[clamp(num(e.tier), 0, T.length - 1)].mult, 1), 'warn', '▲', 1200);
          break;
        default: break;   // unknown event types are ignored, per contract
      }
    }
  }

  /* --------------------------- phase routing -------------------------- */
  var lastPhase = null;
  function handlePhase(s) {
    var p = s.phase || 'menu';
    if (p === lastPhase) return;
    var prev = lastPhase; lastPhase = p;

    if (p === 'pactDraft') { renderDraft(s); openOverlay('pact-draft'); }
    else if (isOpen('pact-draft')) closeOverlay('pact-draft');

    if (p === 'dead') {
      stopAutosave();
      renderDeath(s);
      openOverlay('death');
      setMusic(false);
    } else if (isOpen('death')) closeOverlay('death');

    if (p === 'combat') {
      if (route !== 'game') routeTo('game');
      if (prev !== 'pactDraft') setMusic(true);
    }
    if (p === 'menu' && prev && prev !== 'menu' && route === 'game') routeTo('menu');
  }

  /* ------------------------------ input ------------------------------- */
  var keys = {};
  var joy = { active: false, x: 0, y: 0, id: null };
  var padMove = { x: 0, y: 0 };
  var lastMove = { x: 0, y: 0 };
  var padPrev = [], padSeen = false, navRep = { x: 0, y: 0, next: 0 };
  var lastPointerAb = 0;
  var gestured = false;

  /* First gesture unlocks the AudioContext; FX.music(true) has a menu bed. */
  function firstGesture() {
    if (gestured) return;
    gestured = true;
    call(g.FX, 'sfx', 'ui');
    setMusic(true);
  }
  function tapSfx() { if (gestured) call(g.FX, 'sfx', 'ui'); else firstGesture(); }

  function inCombatInput() {
    return route === 'game' && !overlayStack.length && !UI.paused && state().phase === 'combat';
  }
  function fireAbility(i) {
    if (!inCombatInput()) return;
    firstGesture();
    call(g.Sim, 'useAbility', i);
  }
  function applyMove() {
    var mx = 0, my = 0;
    if (inCombatInput()) {
      if (joy.active) { mx = joy.x; my = joy.y; }
      else if (padMove.x || padMove.y) { mx = padMove.x; my = padMove.y; }
      else {
        if (keys.KeyA || keys.ArrowLeft) mx -= 1;
        if (keys.KeyD || keys.ArrowRight) mx += 1;
        if (keys.KeyW || keys.ArrowUp) my -= 1;
        if (keys.KeyS || keys.ArrowDown) my += 1;
      }
      var m = Math.sqrt(mx * mx + my * my);
      if (m > 1) { mx /= m; my /= m; }
    }
    if (mx !== lastMove.x || my !== lastMove.y) {
      lastMove.x = mx; lastMove.y = my;
      call(g.Sim, 'setMove', mx, my);
    }
  }

  /* Xbox / standard-mapping gamepad. Polled; early-out when absent. */
  function pollGamepad(t) {
    var nav = g.navigator;
    if (!nav || !nav.getGamepads) return;
    var list;
    try { list = nav.getGamepads() || []; } catch (e) { return; }
    var p = null;
    for (var i = 0; i < list.length; i++) { if (list[i] && list[i].connected) { p = list[i]; break; } }
    if (!p) {                                  // early-out: nothing connected
      if (padSeen) { padSeen = false; padPrev = []; padMove.x = 0; padMove.y = 0; }
      return;
    }
    if (!padSeen) { padSeen = true; toast('Controller connected', 'info', '◎', 2400); call(g.FX, 'sfx', 'controller'); }

    var b = p.buttons || [], ax = p.axes || [], now = [], k;
    for (k = 0; k < b.length; k++) {
      var bv = b[k];
      now[k] = !!bv && (typeof bv === 'object' ? bv.pressed : bv > 0.5);
    }
    function hit(idx) { return !!now[idx] && !padPrev[idx]; }

    var dz = 0.15;
    var lx = Math.abs(num(ax[0])) > dz ? num(ax[0]) : 0;
    var ly = Math.abs(num(ax[1])) > dz ? num(ax[1]) : 0;
    var ddx = (now[15] ? 1 : 0) - (now[14] ? 1 : 0);
    var ddy = (now[13] ? 1 : 0) - (now[12] ? 1 : 0);

    var menus = overlayStack.length > 0 || route !== 'game' || UI.paused;

    if (hit(9)) {                              // Start
      if (isOpen('confirm')) { /* explicit choice required */ }
      else if (isOpen('settings')) closeOverlay('settings');
      else if (route === 'game') togglePause();
    }
    if (hit(8)) navBack();                     // View / Back

    if (menus) {
      padMove.x = 0; padMove.y = 0;
      var nx = ddx || (Math.abs(lx) > 0.55 ? (lx > 0 ? 1 : -1) : 0);
      var ny = ddy || (Math.abs(ly) > 0.55 ? (ly > 0 ? 1 : -1) : 0);
      if (nx || ny) {
        if (navRep.x !== nx || navRep.y !== ny) { navRep.x = nx; navRep.y = ny; navRep.next = t + 380; navMove(nx, ny); }
        else if (t >= navRep.next) { navRep.next = t + 150; navMove(nx, ny); }
      } else { navRep.x = 0; navRep.y = 0; }
      if (hit(0)) { firstGesture(); navActivate(); }
      if (hit(1)) navBack();
      if (hit(4)) navStep(-1);                 // LB
      if (hit(5)) navStep(1);                  // RB
    } else {
      navRep.x = 0; navRep.y = 0;
      padMove.x = ddx || lx;
      padMove.y = ddy || ly;
      if (hit(0)) fireAbility(0);              // A
      if (hit(1)) fireAbility(1);              // B
      if (hit(2)) fireAbility(2);              // X
      if (hit(3)) fireAbility(3);              // Y
    }
    padPrev = now;
  }

  function bindJoystick() {
    var zone = $('joystick'), knob = $('joystick-knob');
    if (!zone || !knob) return;
    function apply(e) {
      var r = zone.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var max = r.width * 0.389;               // old game: 35px clamp on a 90px zone
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var d = Math.min(max, Math.sqrt(dx * dx + dy * dy));
      var a = Math.atan2(dy, dx);
      joy.x = Math.cos(a) * d / max;
      joy.y = Math.sin(a) * d / max;
      knob.style.transform = 'translate(calc(-50% + ' + (Math.cos(a) * d).toFixed(1) +
        'px), calc(-50% + ' + (Math.sin(a) * d).toFixed(1) + 'px))';
    }
    on(zone, 'pointerdown', function (e) {
      if (joy.id !== null) return;
      joy.id = e.pointerId; joy.active = true;
      zone.classList.add('active');
      try { zone.setPointerCapture(e.pointerId); } catch (_) { }
      apply(e); e.preventDefault(); firstGesture();
    });
    on(zone, 'pointermove', function (e) {
      if (!joy.active || e.pointerId !== joy.id) return;
      apply(e); e.preventDefault();
    });
    function end(e) {
      if (e.pointerId !== joy.id) return;
      joy.id = null; joy.active = false; joy.x = 0; joy.y = 0;
      zone.classList.remove('active');
      knob.style.transform = 'translate(-50%,-50%)';
    }
    on(zone, 'pointerup', end);
    on(zone, 'pointercancel', end);
    on(zone, 'lostpointercapture', end);
  }

  function onEscape() {
    if (isOpen('confirm')) { confirmFn = null; closeOverlay('confirm'); return; }
    if (isOpen('settings')) { closeOverlay('settings'); return; }
    if (isOpen('pause')) { resumeGame(); return; }
    if (route === 'game') { togglePause(); return; }
    if (route === 'select' || route === 'covenant') goBackFromScreen();
  }

  function bindKeyboard() {
    on(g, 'keydown', function (e) {
      keys[e.code] = true;
      var a = doc.activeElement;
      var inRange = !!(a && a.type === 'range');
      switch (e.code) {
        case 'Escape': e.preventDefault(); onEscape(); break;
        case 'KeyP': if (route === 'game') { e.preventDefault(); togglePause(); } break;
        case 'Digit1': case 'Numpad1': fireAbility(0); break;
        case 'Digit2': case 'Numpad2': fireAbility(1); break;
        case 'Digit3': case 'Numpad3': fireAbility(2); break;
        case 'Digit4': case 'Numpad4': fireAbility(3); break;
        case 'KeyB':
          if (route === 'menu') { covReturn = 'menu'; routeTo('covenant'); }
          break;
        case 'KeyM':
          settings.muted = !settings.muted; applySettings(); persistSettings();
          toast(settings.muted ? 'Muted' : 'Unmuted', 'info', '♪');
          break;
        case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
          if (inRange && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) break;
          if (navTargets().length) {
            e.preventDefault();
            navMove(e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0,
              e.code === 'ArrowUp' ? -1 : e.code === 'ArrowDown' ? 1 : 0);
          } else e.preventDefault();          // no page scroll during combat
          break;
        case 'Space':
          if (!navTargets().length) e.preventDefault();
          break;
        default: break;
      }
    });
    on(g, 'keyup', function (e) { keys[e.code] = false; });
    on(g, 'blur', function () { keys = {}; });
  }

  function bindButtons() {
    /* menu */
    on($('btn-new'), 'click', function () {
      tapSfx();
      if (savedRun()) {
        askConfirm('START A NEW RUN?', 'The saved run is abandoned and its echoes are banked.',
          'START NEW', function () { call(g.Sim, 'abandonRun'); routeTo('select'); });
      } else routeTo('select');
    });
    on($('btn-continue'), 'click', function () {
      tapSfx();
      routeTo('game');
      doResize();
      echoesAtStart = num(meta().echoes);
      lastPhase = null; last = {}; abilitySig = '';
      var ok = call(g.Sim, 'continueRun');
      if (ok === false) { toast('No saved run', 'warn', '⚠'); routeTo('menu'); return; }
      startLoop();
    });
    on($('btn-covenant'), 'click', function () { tapSfx(); covReturn = 'menu'; routeTo('covenant'); });
    on($('btn-settings'), 'click', function () { tapSfx(); openOverlay('settings'); });

    /* select */
    on($('sel-back'), 'click', function () { tapSfx(); routeTo('menu'); });
    on($('asc-down'), 'click', function () { selAsc = Math.max(0, selAsc - 1); refreshSelect(); tapSfx(); });
    on($('asc-up'), 'click', function () { selAsc = Math.min(num(meta().ascensionUnlocked), selAsc + 1); refreshSelect(); tapSfx(); });
    on($('btn-enter'), 'click', function () { tapSfx(); startRun(selHero, selRift, selPet); });

    /* covenant */
    on($('cov-back'), 'click', function () { tapSfx(); goBackFromScreen(); });
    on($('cov-respec'), 'click', function () {
      tapSfx();
      askConfirm('RESPEC THE COVENANT?', 'Bound nodes refund per the Covenant rules (Clean nodes refund 50%).',
        'RESPEC', function () {
          call(g.Sim, 'respecCovenant'); covSel = null; renderCovenant();
          toast('Covenant respecced', 'info', '↺');
        });
    });

    /* hud */
    on($('btn-pause'), 'click', function () { tapSfx(); togglePause(); });
    var bar = $('hud-bottom');
    on(bar, 'pointerdown', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.ability-btn');
      if (!b) return;
      e.preventDefault();
      lastPointerAb = perfNow();
      fireAbility(+b.getAttribute('data-ab'));
    });
    on(bar, 'click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.ability-btn');
      if (!b) return;
      if (perfNow() - lastPointerAb < 500) return;   // pointerdown already fired it
      fireAbility(+b.getAttribute('data-ab'));
    });

    /* pause */
    on($('pause-resume'), 'click', function () { tapSfx(); resumeGame(); });
    on($('pause-save'), 'click', function () { tapSfx(); if (!doSave(false)) toast('Nothing to save yet', 'warn', '⚠'); });
    on($('pause-settings'), 'click', function () { tapSfx(); openOverlay('settings'); });
    on($('pause-menu'), 'click', function () {
      tapSfx();
      askConfirm('RETURN TO THE MENU?', 'Runs save between waves — the current wave restarts when you continue.',
        'MAIN MENU', function () { quitToMenu(); });
    });

    /* help */
    on($('btn-help'), 'click', function () { tapSfx(); openHelp(); });
    on($('pause-help'), 'click', function () { tapSfx(); openHelp(); });
    on($('help-close'), 'click', function () { tapSfx(); closeOverlay('help'); });
    on($('tut-ok'), 'click', function () { tapSfx(); dismissTutorial(); });

    /* draft */
    on($('btn-decline'), 'click', function () { tapSfx(); call(g.Sim, 'choosePact', null); closeOverlay('pact-draft'); });

    /* death */
    on($('death-retry'), 'click', function () {
      tapSfx(); closeOverlay('death');
      startRun(lastRun.heroId || selHero, lastRun.riftId || selRift, lastRun.petId || selPet);
    });
    on($('death-cov'), 'click', function () { tapSfx(); covReturn = 'death'; closeOverlay('death'); routeTo('covenant'); });
    on($('death-menu'), 'click', function () { tapSfx(); quitToMenu(); });

    /* settings */
    on($('set-close'), 'click', function () { tapSfx(); closeOverlay('settings'); });
    on($('set-volume'), 'input', function (e) {
      settings.volume = clamp(+e.target.value / 100, 0, 1);
      applySettings(); persistSettings();
    });
    on($('set-mute'), 'click', function () { settings.muted = !settings.muted; applySettings(); persistSettings(); tapSfx(); });
    on($('set-shake'), 'click', function () { settings.shake = !settings.shake; applySettings(); persistSettings(); tapSfx(); });
    on($('set-fx'), 'click', function () { settings.reducedFx = !settings.reducedFx; applySettings(); persistSettings(); tapSfx(); });
    on($('set-reset'), 'click', function () {
      tapSfx();
      askConfirm('RESET SAVE?', 'This erases echoes, the Covenant, every unlock and any run in progress.',
        'CONTINUE…', function () {
          askConfirm('THIS CANNOT BE UNDONE', 'Last chance. Erase everything and reload?',
            'ERASE EVERYTHING', doResetSave);
        });
    });

    /* confirm */
    on($('confirm-yes'), 'click', function () {
      var fn = confirmFn; confirmFn = null;
      closeOverlay('confirm');
      if (fn) fn();
    });
    on($('confirm-no'), 'click', function () { confirmFn = null; closeOverlay('confirm'); tapSfx(); });

    /* tap the scrim to dismiss - never for draft/death/confirm */
    ['pause', 'settings'].forEach(function (id) {
      on($(id), 'pointerdown', function (e) {
        if (e.target !== $(id)) return;
        if (id === 'pause') resumeGame(); else closeOverlay('settings');
      });
    });
  }

  function doResetSave() {
    var done = call(g.Sim, 'resetSave');
    if (done === undefined) done = call(g.Sim, '_clearSave');
    if (done === undefined) { try { g.localStorage.removeItem(SAVE_KEY); } catch (e) { } }
    try { g.location.reload(); } catch (e) { routeTo('menu'); }
  }

  /* ---------------------------- run control --------------------------- */
  var lastRun = { heroId: null, riftId: null, petId: null };

  function startRun(heroId, riftId, petId) {
    lastRun.heroId = heroId; lastRun.riftId = riftId; lastRun.petId = petId || null;
    closeAllOverlays();
    UI.paused = false;
    lastPhase = null; last = {}; abilitySig = '';
    routeTo('game');
    doResize();                                  // arena size before the first tick
    call(g.Sim, 'setAscension', selAsc);
    echoesAtStart = num(meta().echoes);
    call(g.Sim, 'newRun', heroId, riftId, petId || null);
    clearToasts();
    startLoop();
  }
  /* Leaving to the menu must NOT abandon the run: Sim.abandonRun() banks the
     echoes and deletes the run save, which would silently destroy the run the
     player is only stepping away from. Save and route; the wave restarts. */
  function quitToMenu() {
    doSave(true);
    closeAllOverlays();
    clearToasts();
    lastPhase = null;
    routeTo('menu');                             // routeTo stops the loop
    setMusic(false);
  }

  /* ------------------------------ autosave ---------------------------- */
  var saveHandle = null;
  function startAutosave() { stopAutosave(); saveHandle = setInterval(function () { doSave(true); }, 30000); }
  function stopAutosave() { if (saveHandle != null) { clearInterval(saveHandle); saveHandle = null; } }
  function doSave(quiet) {
    if (!g.Sim || typeof g.Sim.save !== 'function') return false;
    var ph = state().phase;
    if (ph !== 'combat' && ph !== 'pactDraft' && ph !== 'dead') return false;
    try { g.Sim.save(); } catch (e) { return false; }
    if (!quiet) toast('Saved', 'good', '✔');
    return true;
  }

  /* ------------------------------- resize ----------------------------- */
  /* FX owns the canvas backing store (DPR transform + its own observer), so
     UI never writes canvas.width/height when FX.size() exists. UI's job is to
     hand Sim exactly the CSS-pixel arena FX is drawing at. */
  var resizePending = false, resizeRetry = 0;
  function requestResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(function () { resizePending = false; doResize(); });
  }
  function fxSize() {
    var s = call(g.FX, 'size');
    if (!s) return null;
    var w = 0, h = 0;
    if (typeof s.length === 'number' && s.length >= 2) { w = num(s[0]); h = num(s[1]); }
    else { w = num(s.w) || num(s.width); h = num(s.h) || num(s.height); }
    return (w > 1 && h > 1) ? { w: Math.round(w), h: Math.round(h) } : null;
  }
  function doResize() {
    var wrap = $('canvas-wrap'), cv = $('game-canvas');
    if (!wrap || !cv) return;
    var r = wrap.getBoundingClientRect();
    var w = Math.round(r.width), h = Math.round(r.height);
    if (w < 2 || h < 2) return;                  // hidden: nothing meaningful to set

    var fs = fxSize();
    if (fs) {
      /* FX may not have observed the new size yet - retry once next frame. */
      if ((Math.abs(fs.w - w) > 2 || Math.abs(fs.h - h) > 2) && resizeRetry < 3) {
        resizeRetry++; requestResize(); return;
      }
      resizeRetry = 0;
      w = fs.w; h = fs.h;
    } else {
      /* Stub/absent FX: size the canvas ourselves so the page still runs. */
      if (cv.width !== w) cv.width = w;
      if (cv.height !== h) cv.height = h;
    }
    call(g.Sim, 'setArena', w, h);
  }
  /* The arena can change size without a window resize: web-font swap, safe-area
     changes, a HUD row growing. Watch the element itself. */
  function watchArena() {
    if (!g.ResizeObserver) return;
    try {
      new g.ResizeObserver(function () { requestResize(); }).observe($('canvas-wrap'));
    } catch (e) { }
  }

  /* ------------------------------ the loop ---------------------------- */
  var acc = 0, lastT = 0, rafId = null, running = false, padRafId = null;

  function frame(t) {
    if (!running) return;
    if (!lastT) lastT = t;
    acc += Math.min((t - lastT) / 1000, 0.1); lastT = t;

    pollGamepad(t);
    applyMove();

    var s = state();
    if (!UI.paused && s.phase === 'combat') {
      while (acc >= STEP) {
        if (g.Sim && typeof g.Sim.tick === 'function') g.Sim.tick(STEP);
        acc -= STEP;
      }
    } else {
      acc = 0;                                   // paused/menus: keep rendering, never tick
    }

    var evs = (g.Sim && typeof g.Sim.drainEvents === 'function') ? (g.Sim.drainEvents() || []) : [];
    if (g.FX && typeof g.FX.render === 'function') g.FX.render(state(), evs);
    UI.syncHud(state(), evs);
    tutorialWatch(state(), evs);

    rafId = requestAnimationFrame(frame);
  }
  function startLoop() {
    if (running) return;
    running = true; lastT = 0; acc = 0;
    stopPadLoop();
    startAutosave();
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    running = false;
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    stopAutosave();
    if (lastMove.x || lastMove.y) { lastMove.x = 0; lastMove.y = 0; call(g.Sim, 'setMove', 0, 0); }
    startPadLoop();
  }
  /* Menus need controller navigation while the master loop is stopped. */
  function padFrame(t) {
    if (running) { padRafId = null; return; }
    pollGamepad(t);
    padRafId = requestAnimationFrame(padFrame);
  }
  function startPadLoop() { if (padRafId == null && !running) padRafId = requestAnimationFrame(padFrame); }
  function stopPadLoop() { if (padRafId != null) { cancelAnimationFrame(padRafId); padRafId = null; } }

  /* ------------------------------- bindings --------------------------- */
  var BINDS = [
    ['Left stick / D-pad', 'Move (menus: navigate)'],
    ['A', 'Ability 1 (menus: select)'],
    ['B', 'Ability 2 (menus: back)'],
    ['X', 'Ability 3'],
    ['Y', 'Ability 4'],
    ['LB / RB', 'Cycle Pact cards and menu focus'],
    ['Start', 'Pause / resume'],
    ['View', 'Back']
  ];
  var KEYS = [
    ['WASD / Arrows', 'Move'],
    ['1 2 3 4', 'Abilities'],
    ['Esc / P', 'Pause'],
    ['B', 'Covenant (from the menu)'],
    ['M', 'Mute'],
    ['Arrows / Tab', 'Navigate menus'],
    ['Enter / Space', 'Select']
  ];
  function renderBinds() {
    function fill(host, rows) {
      if (!host) return;
      host.innerHTML = rows.map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
      }).join('');
    }
    fill($('bind-list'), BINDS);
    fill($('key-list'), KEYS);
  }

  /* --------------------------------- boot ----------------------------- */
  function bindInput() {
    if (bindInput.done) return;                  // bound ONCE, never per run
    bindInput.done = true;
    bindKeyboard();
    bindJoystick();
    bindButtons();
    /* An overlay opens directly over the ability row, so a tap already in
       flight lands on whatever button appeared under the thumb. That silently
       auto-declined every pact draft (measured: drafts alive ~130ms, pacts
       taken 0) and skipped the death screen. Swallow input aimed at a
       just-opened overlay, in capture, before any handler sees it. */
    on(doc, 'pointerdown', overlayGuard, true);
    on(doc, 'click', overlayGuard, true);
    on(doc, 'pointerdown', firstGesture, { passive: true });
    on(g, 'gamepadconnected', function (e) {
      var id = (e && e.gamepad && e.gamepad.id) || 'Controller';
      toast('Controller connected: ' + String(id).slice(0, 24), 'info', '◎', 2600);
      call(g.FX, 'sfx', 'controller');
      padSeen = true;
    });
    on(g, 'gamepaddisconnected', function () {
      padSeen = false; padPrev = []; padMove.x = 0; padMove.y = 0;
      toast('Controller disconnected', 'warn', '◎');
    });
    on(g, 'resize', requestResize);
    on(g, 'orientationchange', requestResize);
    on(doc, 'visibilitychange', function () {
      if (doc.visibilityState === 'hidden') doSave(true);
    });
    on(g, 'pagehide', function () { doSave(true); });
    on(g, 'contextmenu', function (e) {
      if (e.target && e.target.closest && e.target.closest('#game-ui')) e.preventDefault();
    });
  }

  function boot() {
    loadSettings();
    applySettings();
    renderBinds();
    buildVeilBands();
    bindInput();
    watchArena();

    var v = call(g.CONTENT, 'validatePacts');
    if (v && v.length) console.warn('[ui] CONTENT.validatePacts reported ' + v.length + ' issue(s)');

    call(g.FX, 'init', $('game-canvas'), $('fx-layer'));
    routeTo('menu');
    startPadLoop();                              // controller works on the menu
  }

  /* -------------------------------- public ---------------------------- */
  var UI = {
    paused: false,
    startLoop: startLoop,
    stopLoop: stopLoop,
    bindInput: bindInput,
    syncHud: function (s, evs) {
      s = s || state();
      readEvents(evs);
      handlePhase(s);
      if (route !== 'game' || !$('game-ui') || $('game-ui').hidden) return;
      paintHud(s);
    },
    toast: toast,
    route: function () { return route; },
    openPause: openPause,
    settings: settings,
    refresh: function () {
      if (route === 'menu') refreshMenu();
      else if (route === 'select') refreshSelect();
      else if (route === 'covenant') renderCovenant();
    }
  };
  g.UI = UI;

  if (doc.readyState === 'loading') on(doc, 'DOMContentLoaded', boot);
  else boot();

})(typeof window !== 'undefined' ? window : globalThis);
