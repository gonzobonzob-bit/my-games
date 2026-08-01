/* ===========================================================================
   Veil Legends — js/fx.js
   Owner: art-and-feel. Rendering, audio, juice.

   Public API (CONTRACT.md):
     FX.init(canvas, floatLayerEl)
     FX.render(state, events)
     FX.setOptions({volume, muted, screenShake, reducedFx})
     FX.sfx(name [, opts])
     FX.music(on)
     FX.veilPalette(v)   -> palette object; String(p) === p.accent

   Rules honoured here:
     - Never mutates Sim state. Reads `state`; UI passes the drained events.
     - Unknown event types are ignored.
     - No DOM outside #game-canvas and #fx-layer.
     - Zero network requests. All audio synthesised, all art procedural.
     - Everything dt-based in seconds. No frame%n.
     - Every particle pooled and capped. No DOM node churn.
   =========================================================================== */
(function (g) {
'use strict';

var doc = g.document;
var now = (g.performance && g.performance.now) ? function () { return g.performance.now(); }
                                               : function () { return Date.now(); };

/* ===========================================================================
   1. PALETTE  —  the Veil is the game's central feedback channel.
   V=0 : cold violet void.  V=100 : hot red-violet, the arena bleeding through.
   =========================================================================== */

var COOL = { inner: '#0d0525', mid: '#080318', outer: '#030110',
             accent: '#7c3aed', grid: '#7c3aed', edge: '#7c3aed' };
var WARM = { inner: '#280a2b', mid: '#160518', outer: '#08020a',
             accent: '#c026d3', grid: '#d946ef', edge: '#c026d3' };
var HOT  = { inner: '#3d0718', mid: '#20040d', outer: '#0c0104',
             accent: '#ff2d55', grid: '#ff5470', edge: '#ff2d55' };

/* semantic colours — never spent on decoration */
var C_DANGER  = '#dc2626';
var C_SUCCESS = '#16a34a';
var C_GOLD    = '#d97706';
var C_MOTE    = '#fbbf24';
var C_TEXT    = '#e2d9f3';
var C_WRAITH  = '#9fb4d0';

var DEFAULT_TIERS = [{ min: 0, mult: 1 }, { min: 25, mult: 2 }, { min: 50, mult: 4 },
                     { min: 75, mult: 8 }, { min: 90, mult: 16 }];

function tiers() {
  var C = g.CONTENT;
  if (C && C.VEIL_TIERS && C.VEIL_TIERS.length) return C.VEIL_TIERS;
  return DEFAULT_TIERS;
}
function tierOf(v) {
  var T = tiers(), i, r = 0;
  for (i = 0; i < T.length; i++) if (v >= T[i].min) r = i;
  return r;
}

/* --- colour helpers (lightenColor ported from the old file, generalised) --- */
function parseCol(c) {
  if (!c) return [124, 58, 237];
  if (c.charCodeAt(0) === 35) {                      /* #rgb / #rrggbb */
    if (c.length === 4) return [parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16), parseInt(c[3] + c[3], 16)];
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }
  var m = /(-?[\d.]+)\D+(-?[\d.]+)\D+(-?[\d.]+)/.exec(c);
  if (m) return [+m[1] | 0, +m[2] | 0, +m[3] | 0];
  return [124, 58, 237];
}
function clamp255(n) { return n < 0 ? 0 : n > 255 ? 255 : n | 0; }
function lighten(col, amt) {
  var p = parseCol(col);
  return 'rgb(' + clamp255(p[0] + amt) + ',' + clamp255(p[1] + amt) + ',' + clamp255(p[2] + amt) + ')';
}
function rgba(col, a) { var p = parseCol(col); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }
function mixCol(a, b, k) {
  var A = parseCol(a), B = parseCol(b);
  return 'rgb(' + clamp255(A[0] + (B[0] - A[0]) * k) + ',' + clamp255(A[1] + (B[1] - A[1]) * k) + ',' +
         clamp255(A[2] + (B[2] - A[2]) * k) + ')';
}
/* pull a colour toward its own luminance, then tint — the wraith "wrong" look */
function desat(col, amt, tint) {
  var p = parseCol(col);
  var l = p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114;
  var r = p[0] + (l - p[0]) * amt, gg = p[1] + (l - p[1]) * amt, b = p[2] + (l - p[2]) * amt;
  if (tint) { var q = parseCol(tint); r = r * 0.55 + q[0] * 0.45; gg = gg * 0.55 + q[1] * 0.45; b = b * 0.6 + q[2] * 0.4; }
  return 'rgb(' + clamp255(r) + ',' + clamp255(gg) + ',' + clamp255(b) + ')';
}

var palCache = {}, palCacheN = 0;
function veilPalette(v) {
  v = (typeof v === 'number' && isFinite(v)) ? (v < 0 ? 0 : v > 100 ? 100 : v) : 0;
  var key = (v * 2) | 0;                              /* quantise to 0.5 Veil */
  var hit = palCache[key];
  if (hit) return hit;

  var heat = Math.pow(v / 100, 0.85);
  var a, b, k;
  if (heat < 0.55) { a = COOL; b = WARM; k = heat / 0.55; }
  else { a = WARM; b = HOT; k = (heat - 0.55) / 0.45; }

  var accent = mixCol(a.accent, b.accent, k);
  var p = {
    v: v, heat: heat, tier: tierOf(v),
    inner: mixCol(a.inner, b.inner, k),
    mid: mixCol(a.mid, b.mid, k),
    outer: mixCol(a.outer, b.outer, k),
    accent: accent,
    accentLight: lighten(accent, 70),
    grid: mixCol(a.grid, b.grid, k),
    edge: mixCol(a.edge, b.edge, k),
    gridAlpha: 0.07 + heat * 0.11,
    vignette: 0.6 + heat * 0.12,
    warp: heat < 0.72 ? 0 : (heat - 0.72) / 0.28,      /* kicks in around V=75 */
    edgeGlow: heat < 0.86 ? 0 : (heat - 0.86) / 0.14,  /* top tier only */
    toString: function () { return this.accent; }
  };
  palCache[key] = p; palCacheN++;
  if (palCacheN > 260) { palCache = {}; palCacheN = 0; palCache[key] = p; }
  return p;
}

/* ===========================================================================
   2. OPTIONS + reduced motion
   =========================================================================== */

var opt = { volume: 0.7, muted: false, screenShake: true, reducedFx: false, haptics: true };
var prefersReduced = false;
try {
  if (g.matchMedia) {
    var mq = g.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReduced = !!mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', function (e) { prefersReduced = !!e.matches; });
    else if (mq.addListener) mq.addListener(function (e) { prefersReduced = !!e.matches; });
  }
} catch (e) { }
function lowFx() { return opt.reducedFx || prefersReduced; }

function buzz(pattern) {
  if (!opt.haptics || lowFx()) return;
  try { if (g.navigator && g.navigator.vibrate) g.navigator.vibrate(pattern); } catch (e) { }
}

/* ===========================================================================
   3. CANVAS / LAYER STATE
   =========================================================================== */

var canvas = null, ctx = null, layer = null;
var flashEl = null, edgeEl = null;
var W = 0, H = 0, DPR = 1, ro = null, resizeBound = false;
var t = 0, lastT = 0, dt = 0.016;

var shakeMag = 0, shakeX = 0, shakeY = 0;
var flashA = 0, flashCol = '#ffffff', flashDecay = 3.2;
var slam = 0;                                          /* world zoom punch 0..1 */
var hurtA = 0;
var fadeA = 0, fadeTarget = 0;
var lastPhase = '';
var lastFlashStyle = '', lastEdgeStyle = '';
var wraithCount = 0;

function ensureSize() {
  if (!canvas) return false;
  var cw = canvas.clientWidth | 0, ch = canvas.clientHeight | 0;
  if (!cw || !ch) {
    cw = W || ((canvas.width / DPR) | 0); ch = H || ((canvas.height / DPR) | 0);
    if (!cw || !ch) return false;
  }
  var d = Math.min(g.devicePixelRatio || 1, 2);
  if (cw === W && ch === H && d === DPR) return true;
  W = cw; H = ch; DPR = d;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  gridDirty = true; gradKey = '';
  return true;
}

/* ===========================================================================
   4. PRECOMPUTED BACKGROUND — hex grid baked and blitted, gradients cached.
   The old build re-stroked every hexagon every frame; this bakes the whole
   lattice into one offscreen canvas per (size, heat band) and draws one image.
   =========================================================================== */

var gridCanvas = null, gridCtx = null, gridDirty = true, gridBand = -1;
var HEX = 30, GPAD = 40;

function buildGrid(pal) {
  if (!doc) return;
  if (!gridCanvas) { gridCanvas = doc.createElement('canvas'); gridCtx = gridCanvas.getContext('2d'); }
  var gw = Math.max(1, Math.round((W + GPAD * 2) * DPR)), gh = Math.max(1, Math.round((H + GPAD * 2) * DPR));
  if (gridCanvas.width !== gw || gridCanvas.height !== gh) { gridCanvas.width = gw; gridCanvas.height = gh; }
  var c = gridCtx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, W + GPAD * 2, H + GPAD * 2);
  c.strokeStyle = pal.grid;
  c.lineWidth = 1;
  c.beginPath();
  var rows = (H + GPAD * 2) / (HEX * 1.5) + 2;
  var cols = (W + GPAD * 2) / (HEX * 1.732) + 2;
  for (var row = -1; row < rows; row++) {
    for (var col = -1; col < cols; col++) {
      var hx = col * HEX * 1.732 + (row % 2 === 0 ? 0 : HEX * 0.866);
      var hy = row * HEX * 1.5;
      for (var i = 0; i < 6; i++) {
        var ang = (Math.PI / 3) * i - Math.PI / 6;
        var px = hx + HEX * 0.9 * Math.cos(ang);
        var py = hy + HEX * 0.9 * Math.sin(ang);
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.closePath();
    }
  }
  c.stroke();                                            /* one stroke call */
  gridDirty = false;
}

var bgGrad = null, vigGrad = null, gradKey = '';
function ensureGradients(pal) {
  var key = W + 'x' + H + '|' + ((pal.heat * 12) | 0);
  if (key === gradKey && bgGrad) return;
  gradKey = key;
  var cx = W / 2, cy = H * 0.46, R = Math.max(W, H) * 0.7;
  bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  bgGrad.addColorStop(0, pal.inner);
  bgGrad.addColorStop(0.5, pal.mid);
  bgGrad.addColorStop(1, pal.outer);
  vigGrad = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.35, cx, cy, R);
  vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vigGrad.addColorStop(0.75, 'rgba(0,0,0,' + (pal.vignette * 0.45).toFixed(3) + ')');
  vigGrad.addColorStop(1, 'rgba(' + (pal.heat > 0.5 ? '22,0,7' : '0,0,0') + ',' + pal.vignette.toFixed(3) + ')');
}

/* additive glow sprite cache — replaces per-enemy shadowBlur, which was the
   old build's single largest per-frame cost at high enemy counts. */
var glowCache = {}, glowN = 0;
function glowSprite(col) {
  var s = glowCache[col];
  if (s) return s;
  if (!doc) return null;
  var S = 64, cv = doc.createElement('canvas'); cv.width = S; cv.height = S;
  var c = cv.getContext('2d');
  var gr = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, rgba(col, 0.85));
  gr.addColorStop(0.35, rgba(col, 0.32));
  gr.addColorStop(1, rgba(col, 0));
  c.fillStyle = gr; c.fillRect(0, 0, S, S);
  if (glowN > 28) { glowCache = {}; glowN = 0; }
  glowCache[col] = cv; glowN++;
  return cv;
}
function drawGlow(col, x, y, r, a) {
  var s = glowSprite(col); if (!s) return;
  ctx.globalAlpha = a;
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
}
function drawGlowAdd(col, x, y, r, a) {
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(col, x, y, r, a);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/* ===========================================================================
   5. POOLS — particles, floats, telegraphs, cosmetic motes, ambient dust.
   Fixed capacity, allocated once, never a DOM node.
   =========================================================================== */

var PMAX = 240, FMAX = 24, TMAX = 10, MMAX = 40, DUST = 26;

var P = new Array(PMAX), pHead = 0;
for (var pi0 = 0; pi0 < PMAX; pi0++) {
  P[pi0] = { on: 0, k: 0, x: 0, y: 0, vx: 0, vy: 0, r: 0, r2: 0, life: 0, max: 1,
             col: '#fff', a: 1, sp: 0, rot: 0, drag: 0.92 };
}
/* kinds: 0 spark  1 ring  2 glint  3 shockwave  4 streak  5 implode */
function pop() {
  var i, p;
  for (i = 0; i < PMAX; i++) {
    p = P[pHead]; pHead = (pHead + 1) % PMAX;
    if (!p.on) return p;
  }
  p = P[pHead]; pHead = (pHead + 1) % PMAX;             /* steal the oldest slot */
  return p;
}
function spark(x, y, col, spd, r, life) {
  var p = pop(), a = Math.random() * 6.2832, s = spd * (0.45 + Math.random() * 0.75);
  p.on = 1; p.k = 0; p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
  p.r = r; p.col = col; p.life = p.max = life; p.drag = 0.90;
  return p;
}
function ringFx(x, y, col, r0, r1, life, w) {
  var p = pop();
  p.on = 1; p.k = 1; p.x = x; p.y = y; p.r = r0; p.r2 = r1; p.col = col;
  p.life = p.max = life; p.sp = w || 2;
  return p;
}
function glint(x, y, col, r, life) {
  var p = pop();
  p.on = 1; p.k = 2; p.x = x; p.y = y; p.r = r; p.col = col; p.life = p.max = life;
  p.rot = Math.random() * 3.14; p.vy = -14;
  return p;
}
function shock(x, y, col, r1, life) {
  var p = pop();
  p.on = 1; p.k = 3; p.x = x; p.y = y; p.r = 6; p.r2 = r1; p.col = col; p.life = p.max = life;
  return p;
}
function streak(x, y, x2, y2, col, life, w) {
  var p = pop();
  p.on = 1; p.k = 4; p.x = x; p.y = y; p.vx = x2; p.vy = y2; p.col = col;
  p.life = p.max = life; p.sp = w || 4;
  return p;
}
function implode(x, y, col, r, life) {
  var p = pop(), a = Math.random() * 6.2832;
  p.on = 1; p.k = 5; p.x = x + Math.cos(a) * r; p.y = y + Math.sin(a) * r;
  p.vx = x; p.vy = y; p.r = 2.4; p.col = col; p.life = p.max = life;
  return p;
}
function burst(x, y, col, n, spd, r, life) {
  if (lowFx()) n = Math.ceil(n / 2);
  for (var i = 0; i < n; i++) spark(x, y, col, spd, r * (0.6 + Math.random() * 0.8), life * (0.7 + Math.random() * 0.6));
}

/* --- damage floats: pooled, hard cap 24, drawn on-canvas (no DOM churn) --- */
var FL = new Array(FMAX), flHead = 0;
for (var fi0 = 0; fi0 < FMAX; fi0++) {
  FL[fi0] = { on: 0, x: 0, y: 0, vy: 0, life: 0, max: 1, text: '', col: '#fff', size: 14, big: 0, serif: 0 };
}
var DUMMY_FLOAT = { on: 0, x: 0, y: 0, vy: 0, life: 0, max: 1, text: '', col: '#fff', size: 14, big: 0, serif: 0 };
function makeFloat(x, y, text, col, big, serif) {
  var f = null, i;
  /* a float with no text is a sim bug, not a reason to paint "undefined" */
  if (text == null || text === '' || !isFinite(x) || !isFinite(y)) return DUMMY_FLOAT;
  for (i = 0; i < FMAX; i++) {
    if (!FL[flHead].on) { f = FL[flHead]; break; }
    flHead = (flHead + 1) % FMAX;
  }
  if (!f) { f = FL[flHead]; flHead = (flHead + 1) % FMAX; }   /* recycle oldest */
  f.on = 1; f.x = x; f.y = y; f.text = String(text); f.col = col || C_TEXT;
  f.big = big ? 1 : 0; f.serif = serif ? 1 : 0;
  f.size = big ? 21 : 14; f.vy = big ? -46 : -34; f.life = f.max = big ? 1.05 : 0.8;
  return f;
}

/* --- ability telegraphs --- */
var TG = new Array(TMAX);
for (var ti0 = 0; ti0 < TMAX; ti0++) {
  TG[ti0] = { on: 0, kind: 0, x: 0, y: 0, x2: 0, y2: 0, r: 0, life: 0, max: 1, col: '#fff' };
}
function telegraph(kind, x, y, r, life, col, x2, y2) {
  var e = null, i;
  for (i = 0; i < TMAX; i++) if (!TG[i].on) { e = TG[i]; break; }
  if (!e) e = TG[0];
  e.on = 1; e.kind = kind; e.x = x; e.y = y; e.r = r; e.life = e.max = life;
  e.col = col; e.x2 = (x2 == null ? x : x2); e.y2 = (y2 == null ? y : y2);
  return e;
}
function clearTelegraphs() { for (var i = 0; i < TMAX; i++) TG[i].on = 0; }

/* --- ground motes. Sim publishes the authoritative array as
   state.motesOnGround; syncMotes() mirrors it into this pool every frame
   (life, expiry and A3 halving all come from sim). The event-driven
   drop/pickup path below remains as a fallback for a sim without the array. --- */
var MO = new Array(MMAX);
for (var mi0 = 0; mi0 < MMAX; mi0++) MO[mi0] = { on: 0, x: 0, y: 0, tier: 0, life: 0, ph: 0 };
function moteDrop(x, y, tier) {
  var e = null, i, oldest = null;
  for (i = 0; i < MMAX; i++) {
    if (!MO[i].on) { e = MO[i]; break; }
    if (!oldest || MO[i].life < oldest.life) oldest = MO[i];
  }
  if (!e) e = oldest;
  e.on = 1; e.x = x; e.y = y; e.tier = tier | 0; e.life = 6; e.ph = Math.random() * 6.28;
}
function motePick(x, y) {
  var best = null, bd = 1e9, i, d;
  for (i = 0; i < MMAX; i++) {
    if (!MO[i].on) continue;
    d = (MO[i].x - x) * (MO[i].x - x) + (MO[i].y - y) * (MO[i].y - y);
    if (d < bd) { bd = d; best = MO[i]; }
  }
  if (best && bd < 8100) { best.on = 0; return best.tier; }   /* within 90px */
  return -1;
}
function syncMotes(st) {
  var arr = st.motesOnGround || st.drops;
  if (!arr || !arr.length) {
    /* array present but empty -> clear; absent -> keep event-driven pool */
    if (arr) for (var j = 0; j < MMAX; j++) MO[j].on = 0;
    return;
  }
  var i, m, e;
  for (i = 0; i < MMAX; i++) MO[i].on = 0;
  for (i = 0; i < arr.length && i < MMAX; i++) {
    m = arr[i];
    if (!m || !isFinite(m.x) || !isFinite(m.y)) continue;
    e = MO[i];
    e.on = 1; e.x = m.x; e.y = m.y; e.tier = m.tier | 0;
    e.life = isFinite(m.life) ? m.life : 6;
    e.ph = ((m.x * 7 + m.y * 13) % 6.2832 + 6.2832) % 6.2832;  /* stable per mote */
  }
}

/* --- idle life: ambient veil dust, always drifting --- */
var D = new Array(DUST);
for (var di0 = 0; di0 < DUST; di0++) {
  D[di0] = { x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.7,
             s: 0.15 + Math.random() * 0.5, ph: Math.random() * 6.28 };
}

function clearPools() {
  var i;
  for (i = 0; i < PMAX; i++) P[i].on = 0;
  for (i = 0; i < FMAX; i++) FL[i].on = 0;
  for (i = 0; i < TMAX; i++) TG[i].on = 0;
  for (i = 0; i < MMAX; i++) MO[i].on = 0;
  shakeMag = 0; flashA = 0; hurtA = 0; slam = 0;
}

/* ===========================================================================
   6. AUDIO — lazy context, resume-on-gesture, everything synthesised.
   =========================================================================== */

var A = null, master = null, sfxBus = null, musicBus = null, comp = null;
var noiseBuf = null, audioFailed = false, gestureBound = false;
var lastSfxAt = {}, sfxBudget = 0, sfxBudgetT = 0;

function bindGesture() {
  if (gestureBound || !g.addEventListener) return;
  gestureBound = true;
  var fn = function () {
    try { if (A && A.state === 'suspended') A.resume(); } catch (e) { }
    if (!A || A.state === 'running') {
      g.removeEventListener('pointerdown', fn, true);
      g.removeEventListener('touchend', fn, true);
      g.removeEventListener('keydown', fn, true);
      gestureBound = A ? true : false;
    }
  };
  g.addEventListener('pointerdown', fn, true);
  g.addEventListener('touchend', fn, true);
  g.addEventListener('keydown', fn, true);
}

function ensureAudio() {
  if (A) {
    if (A.state === 'suspended') { try { A.resume(); } catch (e) { } }
    return A;
  }
  if (audioFailed) return null;
  var Ctor = g.AudioContext || g.webkitAudioContext;
  if (!Ctor) { audioFailed = true; return null; }
  try { A = new Ctor(); } catch (e) { audioFailed = true; return null; }
  try {
    comp = A.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 6;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    master = A.createGain();
    sfxBus = A.createGain(); musicBus = A.createGain();
    sfxBus.gain.value = 1.8; musicBus.gain.value = 0.42;   /* bed sits under the hits */
    sfxBus.connect(master); musicBus.connect(master);
    master.connect(comp); comp.connect(A.destination);
    master.gain.value = opt.muted ? 0.0001 : opt.volume * 0.85;
  } catch (e2) { audioFailed = true; A = null; return null; }
  bindGesture();
  if (A.state === 'suspended') { try { A.resume(); } catch (e3) { } }
  return A;
}

function getNoise() {
  if (noiseBuf || !A) return noiseBuf;
  var n = Math.floor(A.sampleRate * 1.0);
  noiseBuf = A.createBuffer(1, n, A.sampleRate);
  var d = noiseBuf.getChannelData(0);
  for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/* one oscillator voice with an envelope */
function tone(o) {
  if (!ensureAudio()) return;
  var t0 = A.currentTime + (o.delay || 0);
  var dur = o.dur || 0.12;
  var osc, gn, node;
  try {
    osc = A.createOscillator(); gn = A.createGain(); node = osc;
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f0), t0);
    if (o.f1 != null) {
      if (o.sweep === 'lin') osc.frequency.linearRampToValueAtTime(Math.max(0.01, o.f1), t0 + dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + dur);
    }
    if (o.steps) for (var i = 0; i < o.steps.length; i++) {
      osc.frequency.setValueAtTime(Math.max(1, o.steps[i][1]), t0 + o.steps[i][0]);
    }
    if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
    if (o.filter) {
      var f = A.createBiquadFilter();
      f.type = o.filter; f.frequency.setValueAtTime(Math.max(20, o.fFreq || 900), t0);
      if (o.fFreq1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.fFreq1), t0 + dur);
      if (o.q) f.Q.value = o.q;
      node.connect(f); node = f;
    }
    var peak = Math.max(0.0002, o.gain == null ? 0.06 : o.gain);
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.006));
    if (o.hold) gn.gain.setValueAtTime(peak, t0 + Math.min(dur * 0.9, o.hold));
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(gn); gn.connect(o.bus || sfxBus);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  } catch (e) { }
}

/* filtered noise burst */
function nz(o) {
  if (!ensureAudio()) return;
  var buf = getNoise(); if (!buf) return;
  try {
    var t0 = A.currentTime + (o.delay || 0), dur = o.dur || 0.15;
    var src = A.createBufferSource(); src.buffer = buf; src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    var f = A.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(Math.max(20, o.f0 || 900), t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + dur);
    f.Q.value = o.q == null ? 1.1 : o.q;
    var gn = A.createGain();
    var peak = Math.max(0.0002, o.gain == null ? 0.05 : o.gain);
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.005));
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(gn); gn.connect(o.bus || sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.03);
  } catch (e) { }
}

/* Rate limiter: the sim can emit dozens of hits in one frame at 50 enemies.
   This keeps the mix legible and the node count bounded. */
function budgetOk(name, minGap) {
  var n = now();
  if (n - sfxBudgetT > 100) { sfxBudgetT = n; sfxBudget = 0; }
  if (sfxBudget > 7) return false;
  var l = lastSfxAt[name] || 0;
  if (n - l < (minGap || 0)) return false;
  lastSfxAt[name] = n; sfxBudget++;
  return true;
}

var SEMI = Math.pow(2, 1 / 12);

function sfx(name, o) {
  if (opt.muted || !name) return;
  if (!ensureAudio()) return;
  o = o || {};
  switch (name) {

    /* --- ported from the old bank (same character, tightened) --- */
    case 'attack':
      if (!budgetOk('attack', 30)) return;
      tone({ type: 'square', f0: 200, steps: [[0.04, 120]], dur: 0.07, gain: 0.055 });
      nz({ f0: 1400, f1: 500, dur: 0.06, gain: 0.03 });
      break;
    case 'ability':
      tone({ type: 'sine', f0: 440, steps: [[0.08, 880]], dur: 0.15, gain: 0.06 });
      break;
    case 'kill':
      if (!budgetOk('kill', 22)) return;
      tone({ type: 'sine', f0: 523, steps: [[0.06, 784]], dur: 0.1, gain: 0.05 });
      break;
    case 'levelup':
      tone({ type: 'sine', f0: 523, steps: [[0.1, 659], [0.2, 784], [0.3, 1047]], dur: 0.4, gain: 0.06 });
      break;
    case 'hit':
      if (!budgetOk('hit', 26)) return;
      tone({ type: 'sawtooth', f0: 150, f1: 90, dur: 0.05, gain: 0.038 });
      nz({ f0: 2200, f1: 700, dur: 0.045, gain: 0.022, q: 0.8 });
      break;
    case 'buy':
      tone({ type: 'sine', f0: 440, steps: [[0.06, 660]], dur: 0.12, gain: 0.06 });
      break;

    /* --- extensions --- */
    case 'crit':
      if (!budgetOk('crit', 40)) return;
      tone({ type: 'sawtooth', f0: 300, f1: 110, dur: 0.09, gain: 0.05 });
      tone({ type: 'square', f0: 1320, f1: 660, dur: 0.07, gain: 0.028, delay: 0.01 });
      nz({ f0: 3200, f1: 900, dur: 0.09, gain: 0.03, q: 0.6 });
      break;

    /* UI */
    case 'ui': case 'click':
      tone({ type: 'triangle', f0: 660, f1: 880, dur: 0.045, gain: 0.035 });
      break;
    case 'tick':
      if (!budgetOk('tick', 24)) return;
      tone({ type: 'square', f0: 1200, dur: 0.022, gain: 0.017 });
      break;
    case 'back':
      tone({ type: 'triangle', f0: 520, f1: 300, dur: 0.08, gain: 0.035 });
      break;
    case 'denied': case 'nofocus':
      tone({ type: 'square', f0: 180, f1: 120, dur: 0.11, gain: 0.04 });
      tone({ type: 'square', f0: 176, f1: 116, dur: 0.11, gain: 0.03, detune: -22 });
      break;
    case 'pad': case 'controller':
      tone({ type: 'square', f0: 620, dur: 0.05, gain: 0.032 });
      tone({ type: 'square', f0: 930, dur: 0.07, gain: 0.032, delay: 0.06 });
      break;

    /* the Veil economy */
    case 'overdraw': {
      var d1 = o.deficit ? Math.min(1, o.deficit / 40) : 0.4;
      tone({ type: 'sawtooth', f0: 110, f1: 340 + 260 * d1, dur: 0.26, gain: 0.05, filter: 'lowpass', fFreq: 700, fFreq1: 2600 });
      tone({ type: 'sawtooth', f0: 110, f1: 336 + 260 * d1, dur: 0.26, gain: 0.045, detune: 19, filter: 'lowpass', fFreq: 700, fFreq1: 2200 });
      nz({ f0: 400, f1: 3000, dur: 0.22, gain: 0.026, q: 0.7 });
      break;
    }
    case 'breach':
      tone({ type: 'sine', f0: 180, f1: 26, dur: 1.1, gain: 0.15, attack: 0.004 });
      tone({ type: 'square', f0: 90, f1: 20, dur: 0.7, gain: 0.05, filter: 'lowpass', fFreq: 900, fFreq1: 120 });
      nz({ f0: 120, f1: 5200, dur: 0.38, gain: 0.07, q: 0.5 });
      nz({ f0: 5200, f1: 200, dur: 0.9, gain: 0.05, q: 0.4, delay: 0.05 });
      tone({ type: 'triangle', f0: 1244, f1: 622, dur: 1.3, gain: 0.04, delay: 0.04 });
      tone({ type: 'triangle', f0: 1318, f1: 659, dur: 1.2, gain: 0.03, delay: 0.06, detune: 14 });
      break;
    case 'tierUp':
      tone({ type: 'triangle', f0: 330 * Math.pow(SEMI, (o.tier || 1) * 3), f1: 660 * Math.pow(SEMI, (o.tier || 1) * 3),
             dur: 0.5, gain: 0.055, filter: 'lowpass', fFreq: 800, fFreq1: 3200 });
      nz({ f0: 300, f1: 4000, dur: 0.4, gain: 0.03, q: 0.5 });
      break;
    case 'tierDown':
      tone({ type: 'triangle', f0: 520, f1: 240, dur: 0.42, gain: 0.04, filter: 'lowpass', fFreq: 2400, fFreq1: 500 });
      break;
    case 'mote': {
      var tr = Math.max(0, Math.min(4, o.tier == null ? 0 : o.tier | 0));
      if (!budgetOk('mote', 18)) return;
      var base = 784 * Math.pow(SEMI, tr * 4);            /* +major-3rd per tier */
      tone({ type: 'triangle', f0: base, f1: base * 1.5, dur: 0.1 + tr * 0.02, gain: 0.038 });
      if (tr >= 2) tone({ type: 'sine', f0: base * 2, f1: base * 3, dur: 0.12, gain: 0.022, delay: 0.03 });
      if (tr >= 4) tone({ type: 'sine', f0: base * 3, f1: base * 4, dur: 0.14, gain: 0.02, delay: 0.06 });
      break;
    }
    case 'moteDrop':
      if (!budgetOk('moteDrop', 30)) return;
      tone({ type: 'sine', f0: 1400 + (o.tier || 0) * 220, dur: 0.05, gain: 0.018 });
      break;
    case 'pact':
      tone({ type: 'triangle', f0: 146.8, dur: 1.1, gain: 0.06, attack: 0.09 });
      tone({ type: 'triangle', f0: 220, dur: 1.0, gain: 0.05, attack: 0.12, delay: 0.06 });
      tone({ type: 'sine', f0: 880, f1: 1760, dur: 0.7, gain: 0.026, delay: 0.16 });
      nz({ f0: 900, f1: 5000, dur: 0.8, gain: 0.02, q: 0.4, delay: 0.1 });
      break;
    case 'wraith':
      tone({ type: 'sawtooth', f0: 320, f1: 116, dur: 1.5, gain: 0.05, filter: 'lowpass', fFreq: 1800, fFreq1: 300 });
      tone({ type: 'sawtooth', f0: 320, f1: 110, dur: 1.5, gain: 0.045, detune: -46, filter: 'lowpass', fFreq: 1500, fFreq1: 260 });
      tone({ type: 'sine', f0: 58, dur: 1.7, gain: 0.07, attack: 0.25 });
      nz({ f0: 2400, f1: 300, dur: 1.4, gain: 0.032, q: 0.35, rate: 0.6 });
      break;

    /* combat */
    case 'castAoe':
      tone({ type: 'triangle', f0: 180, f1: 420, dur: 0.3, gain: 0.05, filter: 'lowpass', fFreq: 600, fFreq1: 2400 });
      break;
    case 'castDash':
      nz({ f0: 600, f1: 4200, dur: 0.16, gain: 0.045, q: 0.5 });
      tone({ type: 'sine', f0: 300, f1: 900, dur: 0.16, gain: 0.03 });
      break;
    case 'castMelee':
      nz({ f0: 2600, f1: 500, dur: 0.11, gain: 0.04, q: 0.7 });
      tone({ type: 'square', f0: 260, f1: 130, dur: 0.09, gain: 0.035 });
      break;
    case 'castProjectile':
      tone({ type: 'sawtooth', f0: 700, f1: 260, dur: 0.11, gain: 0.036, filter: 'lowpass', fFreq: 3000, fFreq1: 700 });
      break;
    case 'castExecute':
      tone({ type: 'sine', f0: 1200, f1: 200, dur: 0.28, gain: 0.05 });
      nz({ f0: 300, f1: 60, dur: 0.3, gain: 0.04, q: 0.6 });
      break;
    case 'aoeHit':
      tone({ type: 'sine', f0: 140, f1: 50, dur: 0.35, gain: 0.08 });
      nz({ f0: 800, f1: 120, dur: 0.3, gain: 0.05, q: 0.5 });
      break;
    case 'hurt':
      tone({ type: 'sawtooth', f0: 260, f1: 80, dur: 0.22, gain: 0.07, filter: 'lowpass', fFreq: 1600, fFreq1: 260 });
      nz({ f0: 300, f1: 90, dur: 0.2, gain: 0.045, q: 0.6 });
      break;
    case 'death':
      tone({ type: 'sine', f0: 220, f1: 27, dur: 2.2, gain: 0.12, attack: 0.02 });
      tone({ type: 'triangle', f0: 330, f1: 41, dur: 1.9, gain: 0.06, delay: 0.05 });
      nz({ f0: 1800, f1: 60, dur: 2.0, gain: 0.045, q: 0.4 });
      break;
    case 'waveStart':
      tone({ type: 'triangle', f0: 196, dur: 0.5, gain: 0.05, attack: 0.02 });
      tone({ type: 'triangle', f0: 293.7, dur: 0.55, gain: 0.045, delay: 0.09 });
      nz({ f0: 200, f1: 2400, dur: 0.5, gain: 0.025, q: 0.5 });
      break;
    case 'waveClear':
      tone({ type: 'sine', f0: 523, dur: 0.18, gain: 0.05 });
      tone({ type: 'sine', f0: 659, dur: 0.2, gain: 0.05, delay: 0.1 });
      tone({ type: 'sine', f0: 880, dur: 0.5, gain: 0.05, delay: 0.2 });
      break;
    case 'overPar':
      tone({ type: 'square', f0: 220, f1: 165, dur: 0.4, gain: 0.04, filter: 'lowpass', fFreq: 900, fFreq1: 300 });
      break;
    case 'spawn':
      if (!budgetOk('spawn', 60)) return;
      tone({ type: 'sine', f0: 90, f1: 240, dur: 0.18, gain: 0.03 });
      break;

    default:
      return;                                    /* unknown names are ignored */
  }
}

/* ===========================================================================
   7. MUSIC BED — procedural layered drone; intensity is driven by the Veil.
     L0 root drone            always
     L1 fifth pad             heat > 0.10
     L2 pulse / heartbeat      heat > 0.38   (combat only)
     L3 dissonant shimmer      heat > 0.62   (minor 2nd against the root)
     L4 siren                  heat > 0.84   (top tier)
     LW wraith growl           driven by the live wraith count, not by V
   Master lowpass opens 380 -> 2680 Hz with heat. All gains move by
   setTargetAtTime, so intensity slides rather than steps.
   =========================================================================== */

var mus = null, musicOn = false, musHeat = 0;

function startMusic() {
  if (!ensureAudio() || mus) return;
  try {
    var t0 = A.currentTime;
    var out = A.createGain(); out.gain.value = 0.0001; out.connect(musicBus);
    var filt = A.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 0.8;
    filt.connect(out);

    function osc(type, f, det, target, gv) {
      var o = A.createOscillator(), gn = A.createGain();
      o.type = type; o.frequency.value = f; if (det) o.detune.value = det;
      gn.gain.value = gv == null ? 1 : gv;
      o.connect(gn); gn.connect(target); o.start(t0);
      return { o: o, g: gn };
    }
    function lfo(rate, depth, param, base) {
      var o = A.createOscillator(), gn = A.createGain();
      o.type = 'sine'; o.frequency.value = rate; gn.gain.value = depth;
      if (base != null) param.value = base;
      o.connect(gn); gn.connect(param); o.start(t0);
      return { o: o, g: gn };
    }
    function layer(nodes, gain) { return { nodes: nodes, g: gain, cur: -1 }; }

    /* L0 — root drone (D1), two detuned saws + an octave sub */
    var g0 = A.createGain(); g0.gain.value = 0.0001; g0.connect(filt);
    var l0 = [osc('sawtooth', 36.71, 0, g0, 0.5), osc('sawtooth', 36.71, 11, g0, 0.45),
              osc('sine', 73.42, 0, g0, 0.4), lfo(0.055, 130, filt.frequency, 420)];

    /* L1 — fifth pad (A2 + D3) with a slow tremolo */
    var g1 = A.createGain(); g1.gain.value = 0.0001; g1.connect(filt);
    var trem = A.createGain(); trem.gain.value = 0.7; trem.connect(g1);
    var l1 = [osc('triangle', 110, -6, trem, 0.5), osc('triangle', 146.83, 5, trem, 0.4),
              lfo(0.19, 0.28, trem.gain, 0.7)];

    /* L2 — pulse: a gated low sine. The arena's heartbeat once you're in debt. */
    var g2 = A.createGain(); g2.gain.value = 0.0001; g2.connect(out);
    var gate = A.createGain(); gate.gain.value = 0.5; gate.connect(g2);
    var l2 = [osc('sine', 55, 0, gate, 0.9), osc('triangle', 82.41, 0, gate, 0.3),
              lfo(1.35, 0.5, gate.gain, 0.5)];

    /* L3 — shimmer: a minor 2nd above the pad root, highpassed. Wrong on purpose. */
    var hp = A.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 520;
    var g3 = A.createGain(); g3.gain.value = 0.0001; hp.connect(g3); g3.connect(out);
    var l3 = [osc('sawtooth', 220, 0, hp, 0.16), osc('sawtooth', 233.08, 7, hp, 0.16),
              osc('sine', 466.16, -9, hp, 0.1), lfo(0.42, 60, hp.frequency, 520)];

    /* L4 — siren: a slow swept sine; the top-tier "you are past the line" voice */
    var g4 = A.createGain(); g4.gain.value = 0.0001; g4.connect(out);
    var sir = osc('sine', 1046, 0, g4, 0.16);
    var l4 = [sir, lfo(0.13, 240, sir.o.frequency, 1046), osc('sine', 1568, 4, g4, 0.06)];

    /* LW — wraith presence: subharmonic growl + a breath of filtered noise */
    var gw = A.createGain(); gw.gain.value = 0.0001; gw.connect(out);
    var wf = A.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 320; wf.Q.value = 3.2;
    wf.connect(gw);
    var lw = [osc('sawtooth', 41.2, -14, wf, 0.5), osc('sawtooth', 43.65, 22, wf, 0.4),
              lfo(0.31, 190, wf.frequency, 320)];
    var wn = null, nb = getNoise();
    if (nb) {
      var ns = A.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.playbackRate.value = 0.28;
      var nf = A.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1100; nf.Q.value = 1.4;
      var ng = A.createGain(); ng.gain.value = 0.25;
      ns.connect(nf); nf.connect(ng); ng.connect(gw); ns.start(t0);
      wn = ns;
    }

    mus = {
      out: out, filt: filt, noise: wn, curCut: -1,
      L: [layer(l0, g0), layer(l1, g1), layer(l2, g2), layer(l3, g3), layer(l4, g4), layer(lw, gw)]
    };
    out.gain.setTargetAtTime(0.9, t0, 1.4);
    /* Seed the idle bed here rather than waiting for render(): the menu and
       the Covenant screen may never call FX.render, and a music bed that only
       exists during combat would be silent exactly where it sets the tone. */
    setLayer(mus.L[0], 0.145);
    setLayer(mus.L[1], 0.05);
  } catch (e) { mus = null; }
}

function stopMusic(fade) {
  if (!mus || !A) { mus = null; return; }
  var m = mus, t0 = A.currentTime, f = (fade == null ? 0.9 : fade);
  mus = null;
  try { m.out.gain.cancelScheduledValues(t0); m.out.gain.setTargetAtTime(0.0001, t0, Math.max(0.05, f / 3)); } catch (e) { }
  g.setTimeout(function () {
    try {
      for (var i = 0; i < m.L.length; i++) {
        var nodes = m.L[i].nodes;
        for (var j = 0; j < nodes.length; j++) {
          try { nodes[j].o.stop(); } catch (e2) { }
          try { nodes[j].o.disconnect(); } catch (e3) { }
        }
      }
      if (m.noise) { try { m.noise.stop(); } catch (e4) { } }
      m.out.disconnect();
    } catch (e5) { }
  }, (f + 0.3) * 1000);
}

function setLayer(L, target) {
  if (!A || Math.abs(L.cur - target) < 0.008) return;
  L.cur = target;
  try { L.g.gain.setTargetAtTime(Math.max(0.0001, target), A.currentTime, 0.45); } catch (e) { }
}

function musicUpdate(heat, phase, wraiths) {
  if (!mus || !A) return;
  musHeat += (heat - musHeat) * Math.min(1, dt * 2.2);
  var h = musHeat;
  var combat = phase === 'combat';
  var duck = combat ? 1 : 0.42;                        /* menus and drafts sit back */
  var L = mus.L;
  setLayer(L[0], 0.34 * duck + h * 0.10);
  setLayer(L[1], h > 0.10 ? (0.05 + Math.min(0.26, (h - 0.10) * 0.75)) * duck : 0.0001);
  setLayer(L[2], combat && h > 0.38 ? 0.04 + Math.min(0.22, (h - 0.38) * 0.62) : 0.0001);
  setLayer(L[3], h > 0.62 ? 0.03 + Math.min(0.20, (h - 0.62) * 0.62) : 0.0001);
  setLayer(L[4], h > 0.84 ? 0.02 + Math.min(0.12, (h - 0.84) * 0.7) : 0.0001);
  setLayer(L[5], wraiths > 0 ? Math.min(0.30, 0.12 + wraiths * 0.07) : 0.0001);
  var cut = 380 + h * 2300;
  if (Math.abs(mus.curCut - cut) > 60) {
    mus.curCut = cut;
    try { mus.filt.frequency.setTargetAtTime(cut, A.currentTime, 0.6); } catch (e) { }
  }
}

function music(on) {
  musicOn = !!on;
  if (musicOn) { if (!opt.muted) startMusic(); }
  else stopMusic(0.8);
}

function setOptions(o) {
  if (!o) return;
  if (typeof o.volume === 'number' && isFinite(o.volume)) opt.volume = Math.max(0, Math.min(1, o.volume));
  if (typeof o.muted === 'boolean') opt.muted = o.muted;
  if (typeof o.screenShake === 'boolean') opt.screenShake = o.screenShake;
  if (typeof o.reducedFx === 'boolean') opt.reducedFx = o.reducedFx;
  if (typeof o.haptics === 'boolean') opt.haptics = o.haptics;
  if (A && master) {
    try { master.gain.setTargetAtTime(opt.muted ? 0.0001 : opt.volume * 0.85, A.currentTime, 0.05); } catch (e) { }
  }
  if (opt.muted) { if (mus) stopMusic(0.3); }
  else if (musicOn && !mus) startMusic();
  if (!opt.screenShake || lowFx()) shakeMag = 0;
}

/* ===========================================================================
   8. ENEMY SILHOUETTES — the full 12-shape enum.
   Every shape gets the same treatment (cast shadow, additive glow, radial
   gradient body, light rim); each is chosen to be told apart in one glance
   at 360px width. shapeBody() lays down the path and returns its gradient
   geometry plus an optional decoration pass.
   =========================================================================== */

function shapeBody(x, y, s, shape, col, ph, ang) {
  var c = ctx, i, a, r, px, py;
  switch (shape) {

    case 'block': {                      /* BRUTE — heavy rounded slab */
      var bw = s * 1.2, bh = s * 1.5, br = s * 0.3, bx = x - bw / 2, by = y - bh / 2;
      c.beginPath();
      c.moveTo(bx + br, by);
      c.lineTo(bx + bw - br, by); c.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
      c.lineTo(bx + bw, by + bh - br); c.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
      c.lineTo(bx + br, by + bh); c.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
      c.lineTo(bx, by + br); c.quadraticCurveTo(bx, by, bx + br, by);
      c.closePath();
      return { grad: [x, y - s * 0.3, 2, x, y, s * 1.1], rim: 1.5 };
    }

    case 'hex': {                        /* CASTER — hexagon with an orbiting mote */
      c.beginPath();
      for (i = 0; i < 6; i++) {
        a = (Math.PI / 3) * i - Math.PI / 6;
        px = x + s * Math.cos(a); py = y + s * Math.sin(a);
        i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.closePath();
      return { grad: [x, y, 1, x, y, s], rim: 1, after: function () {
        var oa = t * 4.2 + ph, orb = s * 1.3;
        c.beginPath(); c.arc(x + orb * Math.cos(oa), y + orb * Math.sin(oa), s * 0.18, 0, 6.2832);
        c.fillStyle = lighten(col, 80); c.fill();
      } };
    }

    case 'star': {                       /* 8-point star — the old boss silhouette */
      var outer = s, inner = s * 0.45, pts = 8;
      c.beginPath();
      for (i = 0; i < pts * 2; i++) {
        a = (Math.PI / pts) * i - Math.PI / 2 + t * 0.35;
        r = (i % 2 === 0) ? outer : inner;
        px = x + r * Math.cos(a); py = y + r * Math.sin(a);
        i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.closePath();
      return { grad: [x, y, 2, x, y, s * 1.2], rim: 2, rimCol: 'rgba(255,200,0,0.4)' };
    }

    case 'orb': {                        /* smooth sphere — the baseline body */
      c.beginPath(); c.arc(x, y, s, 0, 6.2832); c.closePath();
      return { grad: [x - s * 0.3, y - s * 0.3, 1, x, y, s], rim: 1 };
    }

    case 'wisp': {                       /* teardrop with a wavering tail */
      var hd = ang + Math.PI;                          /* the tail trails behind */
      var wob = Math.sin(t * 7 + ph) * 0.35;
      c.save(); c.translate(x, y); c.rotate(hd + wob * 0.25);
      c.beginPath();
      c.moveTo(s * 2.0, 0);
      c.quadraticCurveTo(s * 0.7, s * 0.85 + wob * s * 0.3, 0, s * 0.72);
      c.arc(0, 0, s * 0.72, Math.PI / 2, -Math.PI / 2, false);
      c.quadraticCurveTo(s * 0.7, -s * 0.85 + wob * s * 0.3, s * 2.0, 0);
      c.closePath(); c.restore();
      return { grad: [x, y, 1, x, y, s * 1.3], rim: 1, alpha: 0.85 };
    }

    case 'shard': {                      /* narrow blade, slow spin, hard edges */
      c.save(); c.translate(x, y); c.rotate(t * 1.6 + ph);
      c.beginPath();
      c.moveTo(0, -s * 1.35); c.lineTo(s * 0.5, s * 0.2);
      c.lineTo(0, s * 0.62); c.lineTo(-s * 0.5, s * 0.2);
      c.closePath(); c.restore();
      return { grad: [x, y - s * 0.4, 1, x, y, s], rim: 1.2, rimCol: 'rgba(255,255,255,0.45)' };
    }

    case 'ring': {                       /* hollow annulus — the hole is the read */
      c.beginPath();
      c.arc(x, y, s, 0, 6.2832);
      c.arc(x, y, s * 0.52, 0, 6.2832, true);
      c.closePath();
      return { grad: [x, y, s * 0.45, x, y, s], rim: 1, after: function () {
        var ra = -t * 1.1 + ph;
        c.strokeStyle = rgba(col, 0.55); c.lineWidth = 2;
        for (i = 0; i < 6; i++) {
          a = ra + i * 1.047;
          c.beginPath();
          c.moveTo(x + Math.cos(a) * s * 1.18, y + Math.sin(a) * s * 1.18);
          c.lineTo(x + Math.cos(a) * s * 1.42, y + Math.sin(a) * s * 1.42);
          c.stroke();
        }
      } };
    }

    case 'crown': {                      /* squat base + three prongs — authority */
      var cw = s * 1.15, bh2 = s * 0.62;
      c.beginPath();
      c.moveTo(x - cw, y + bh2);
      c.lineTo(x + cw, y + bh2);
      c.lineTo(x + cw, y - bh2 * 0.1);
      c.lineTo(x + cw * 0.62, y - s * 0.55);
      c.lineTo(x + cw * 0.32, y - bh2 * 0.05);
      c.lineTo(x, y - s * 1.15);
      c.lineTo(x - cw * 0.32, y - bh2 * 0.05);
      c.lineTo(x - cw * 0.62, y - s * 0.55);
      c.lineTo(x - cw, y - bh2 * 0.1);
      c.closePath();
      return { grad: [x, y + bh2 * 0.4, 2, x, y, s * 1.3], rim: 1.6, rimCol: 'rgba(255,225,160,0.42)' };
    }

    case 'spike': {
      /* four long needles from a small hub — a caltrop. Deliberately sparser
         and longer-armed than `star`, which is a dense 8-point sunburst. */
      var ka = t * 0.9 + ph;
      c.beginPath();
      for (i = 0; i < 4; i++) {
        a = ka + i * 1.5708;
        var a1 = a - 0.30, a2 = a + 0.30;
        if (i === 0) c.moveTo(x + Math.cos(a1) * s * 0.30, y + Math.sin(a1) * s * 0.30);
        else c.lineTo(x + Math.cos(a1) * s * 0.30, y + Math.sin(a1) * s * 0.30);
        c.lineTo(x + Math.cos(a) * s * 1.55, y + Math.sin(a) * s * 1.55);
        c.lineTo(x + Math.cos(a2) * s * 0.30, y + Math.sin(a2) * s * 0.30);
      }
      c.closePath();
      return { grad: [x, y, 1, x, y, s * 1.1], rim: 1, rimCol: 'rgba(255,255,255,0.35)', after: function () {
        c.fillStyle = 'rgba(10,6,18,0.75)';
        c.beginPath(); c.arc(x, y, s * 0.26, 0, 6.2832); c.fill();
      } };
    }

    case 'husk': {                       /* cracked shell, dim, about to split */
      c.beginPath();
      c.moveTo(x, y - s);
      c.quadraticCurveTo(x + s * 0.98, y - s * 0.72, x + s * 0.86, y + s * 0.14);
      c.quadraticCurveTo(x + s * 0.62, y + s * 1.02, x, y + s * 0.94);
      c.quadraticCurveTo(x - s * 0.66, y + s * 1.02, x - s * 0.88, y + s * 0.1);
      c.quadraticCurveTo(x - s * 0.96, y - s * 0.74, x, y - s);
      c.closePath();
      return { grad: [x - s * 0.2, y - s * 0.3, 1, x, y, s * 1.05], rim: 1, after: function () {
        c.strokeStyle = 'rgba(0,0,0,0.62)'; c.lineWidth = Math.max(1.4, s * 0.13);
        c.beginPath();
        c.moveTo(x - s * 0.42, y - s * 0.8);
        c.lineTo(x - s * 0.06, y - s * 0.16);
        c.lineTo(x - s * 0.34, y + s * 0.16);
        c.lineTo(x + s * 0.16, y + s * 0.88);
        c.stroke();
        var e = 0.35 + 0.3 * Math.sin(t * 3 + ph);
        c.fillStyle = rgba(lighten(col, 90), e);
        c.beginPath(); c.arc(x - s * 0.06, y - s * 0.16, s * 0.16, 0, 6.2832); c.fill();
      } };
    }

    case 'core': {                       /* nucleus inside counter-rotating brackets */
      c.beginPath(); c.arc(x, y, s * 0.52, 0, 6.2832); c.closePath();
      return { grad: [x, y, 0.5, x, y, s * 0.62], rim: 1.2, rimCol: 'rgba(255,255,255,0.55)', after: function () {
        var b1 = t * 1.5 + ph, b2 = -t * 1.05 + ph;
        c.lineWidth = Math.max(1.5, s * 0.15);
        c.strokeStyle = rgba(col, 0.85);
        for (i = 0; i < 2; i++) { c.beginPath(); c.arc(x, y, s * 0.95, b1 + i * Math.PI, b1 + i * Math.PI + 1.15); c.stroke(); }
        c.strokeStyle = rgba(lighten(col, 60), 0.55);
        c.lineWidth = Math.max(1, s * 0.1);
        for (i = 0; i < 2; i++) { c.beginPath(); c.arc(x, y, s * 1.3, b2 + i * Math.PI, b2 + i * Math.PI + 0.75); c.stroke(); }
      } };
    }

    case 'diamond':                      /* MINION — ported verbatim */
    default: {
      c.beginPath();
      c.moveTo(x, y - s); c.lineTo(x + s * 0.7, y);
      c.lineTo(x, y + s); c.lineTo(x - s * 0.7, y);
      c.closePath();
      return { grad: [x - s * 0.2, y - s * 0.2, 1, x, y, s], rim: 1 };
    }
  }
}

/* short position history for wraith trails, held weakly off the enemy object.
   If sim rebuilds enemy objects every tick the history simply stays shallow
   and the velocity fallback below takes over — no leak either way. */
var trails = (typeof g.WeakMap === 'function') ? new g.WeakMap() : null;
function trailOf(e) {
  if (!trails) return { n: 0, i: 0, x: null, y: null };
  var r = trails.get(e);
  if (!r) { r = { n: 0, i: 0, x: new Float32Array(8), y: new Float32Array(8), tt: 0 }; trails.set(e, r); }
  if (t - r.tt > 0.032) { r.tt = t; r.i = (r.i + 1) % 8; r.x[r.i] = e.x; r.y[r.i] = e.y; if (r.n < 8) r.n++; }
  return r;
}

function drawEnemy(e, pal) {
  var s = e.size || 12;
  var x = e.x, y = e.y;
  var wraith = !!e.isWraith, boss = !!e.isBoss;
  var col = e.color || pal.accent;
  var ph = Math.abs(((e.x * 0.37 + e.y * 0.11) | 0) % 628) / 100;
  var ang = Math.atan2(e.vy || 0, e.vx || 0.0001);
  var shape = e.shape || 'orb';
  var c = ctx, i;

  if (wraith) col = desat(col, 0.85, C_WRAITH);

  /* --- wraith trails: ghost copies dragged behind the true position --- */
  if (wraith) {
    var tr = trailOf(e), gmax = lowFx() ? 2 : 4, gx, gy, idx;
    for (i = 1; i <= gmax; i++) {
      if (tr.n > i && tr.x) { idx = (tr.i - i + 8) % 8; gx = tr.x[idx]; gy = tr.y[idx]; }
      else { gx = x - (e.vx || 0) * 0.035 * i; gy = y - (e.vy || 0) * 0.035 * i; }
      c.save();
      c.globalAlpha = 0.30 - i * 0.055;
      c.translate(Math.sin(t * 11 + i) * 1.2, 0);
      shapeBody(gx, gy, s * (1 - i * 0.06), shape, col, ph, ang);
      c.fillStyle = rgba(C_WRAITH, 0.5); c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
  }

  /* --- cast shadow. Wraiths cast theirs the wrong way: upward. --- */
  c.fillStyle = wraith ? 'rgba(150,180,220,0.13)' : 'rgba(0,0,0,0.35)';
  c.beginPath();
  if (wraith) c.ellipse(x, y - s * 0.9, s * 0.62, s * 0.18, 0, 0, 6.2832);
  else c.ellipse(x, y + s * 0.8, s * 0.7, s * 0.2, 0, 0, 6.2832);
  c.fill();

  /* --- shiver: a wraith never sits still --- */
  var jx = 0, jy = 0;
  if (wraith && !lowFx()) { jx = Math.sin(t * 27 + ph * 3) * 1.1; jy = Math.cos(t * 31 + ph * 5) * 1.1; }
  if (jx || jy) { c.save(); c.translate(jx, jy); }

  var sz = s * (boss ? 1 + 0.035 * Math.sin(t * 2.4) : 1);
  var info = shapeBody(x, y, sz, shape, col, ph, ang);
  var gr;
  try {
    gr = c.createRadialGradient(info.grad[0], info.grad[1], info.grad[2],
                                info.grad[3], info.grad[4], Math.max(0.1, info.grad[5]));
    if (wraith) {
      gr.addColorStop(0, 'rgba(226,236,248,0.92)');
      gr.addColorStop(0.55, col);
      gr.addColorStop(1, 'rgba(24,30,44,0.75)');
    } else if (boss) {
      gr.addColorStop(0, lighten(col, 90));
      gr.addColorStop(0.5, col);
      gr.addColorStop(1, mixCol(col, '#160006', 0.72));
    } else {
      gr.addColorStop(0, lighten(col, 60));
      gr.addColorStop(1, col);
    }
  } catch (err) { gr = col; }
  if (info.alpha) c.globalAlpha = info.alpha;
  c.fillStyle = gr;
  c.fill();
  c.globalAlpha = 1;
  c.strokeStyle = wraith ? 'rgba(220,235,255,0.55)' : (info.rimCol || 'rgba(255,255,255,0.2)');
  c.lineWidth = info.rim || 1;
  c.stroke();
  if (info.after) info.after();

  if (jx || jy) c.restore();

  /* --- boss regalia: tick ring + counter-rotating arc --- */
  if (boss) {
    var ba = t * 0.55, aa;
    c.strokeStyle = rgba(lighten(col, 40), 0.5); c.lineWidth = 2;
    for (i = 0; i < 8; i++) {
      aa = ba + i * 0.7854;
      c.beginPath();
      c.moveTo(x + Math.cos(aa) * sz * 1.45, y + Math.sin(aa) * sz * 1.45);
      c.lineTo(x + Math.cos(aa) * sz * 1.72, y + Math.sin(aa) * sz * 1.72);
      c.stroke();
    }
    c.strokeStyle = rgba(C_GOLD, 0.34); c.lineWidth = 1.5;
    c.beginPath(); c.arc(x, y, sz * 1.9, -t * 0.4, -t * 0.4 + 4.6); c.stroke();
  }

  /* --- HP bar: only when damaged (always for bosses). Never colour alone —
         the bar shortens, and bosses get a wider, gold-framed bar. --- */
  var hp = e.hp, mx = e.maxHp || e.hp || 1;
  if (hp != null && mx > 0 && (hp < mx - 0.001 || boss)) {
    var bw2 = boss ? 56 : 40, frac = Math.max(0, Math.min(1, hp / mx));
    var byy = y - sz - (boss ? 16 : 10), bh3 = boss ? 5 : 4;
    c.fillStyle = 'rgba(15,12,24,0.85)';
    c.fillRect(x - bw2 / 2, byy, bw2, bh3);
    c.fillStyle = wraith ? '#dbe7f5' : col;
    c.fillRect(x - bw2 / 2, byy, bw2 * frac, bh3);
    if (boss) {
      c.strokeStyle = rgba(C_GOLD, 0.6); c.lineWidth = 1;
      c.strokeRect(x - bw2 / 2 - 0.5, byy - 0.5, bw2 + 1, bh3 + 1);
    }
  }
}

/* ===========================================================================
   9. EVENTS -> JUICE
   =========================================================================== */

function shakeBy(m) {
  if (!opt.screenShake || lowFx()) return;
  shakeMag = Math.min(26, shakeMag + m);
}
function flash(col, a, decay) {
  if (lowFx()) a *= 0.45;
  if (a > flashA) { flashA = a; flashCol = col; flashDecay = decay || 3.2; }
}
var lastTier = 0;
function tierMinV(i) { var T = tiers(); return (T[i] && T[i].min != null) ? Math.min(99, T[i].min + 6) : 0; }
function valueTier(v) {
  v = v || 1;
  return Math.max(0, Math.min(4, Math.round(Math.log(v) / Math.LN2) - 1));
}
function moteCol(tier) {
  switch (tier | 0) {
    case 0: return '#fbbf24';
    case 1: return '#fcd34d';
    case 2: return '#a3e635';
    case 3: return '#22d3ee';
    default: return '#f0abfc';
  }
}

function handleEvent(ev, st, pal) {
  if (!ev || typeof ev.type !== 'string') return;
  var px = (st.player && isFinite(st.player.x)) ? st.player.x : W / 2;
  var py = (st.player && isFinite(st.player.y)) ? st.player.y : H / 2;
  var i;

  switch (ev.type) {

    case 'hit': {
      var amt = ev.amount || 0, crit = !!ev.crit;
      var hx = ev.x == null ? px : ev.x, hy = ev.y == null ? py : ev.y;
      burst(hx, hy, crit ? '#fff3c4' : '#ffe9d6', crit ? 9 : 5, crit ? 200 : 130, crit ? 2.6 : 1.9, 0.3);
      ringFx(hx, hy, crit ? C_MOTE : '#ffffff', crit ? 4 : 2, crit ? 30 : 17, crit ? 0.26 : 0.17, crit ? 2.5 : 1.6);
      if (amt >= 1) makeFloat(hx, hy - 8, Math.round(amt), crit ? C_MOTE : '#fca5a5', crit, crit);
      sfx(crit ? 'crit' : 'hit');
      if (crit) shakeBy(1.6);
      break;
    }

    case 'kill': {
      var kc = ev.color || pal.accent;
      var kx = ev.x == null ? px : ev.x, ky = ev.y == null ? py : ev.y;
      burst(kx, ky, kc, 14, 230, 3.2, 0.5);
      burst(kx, ky, lighten(kc, 90), 5, 90, 2.0, 0.36);
      ringFx(kx, ky, kc, 3, 46, 0.36, 3);
      ringFx(kx, ky, lighten(kc, 110), 2, 22, 0.2, 2);
      sfx('kill');
      shakeBy(0.9);
      break;
    }

    case 'overdraw': {
      var d = ev.deficit || 0;
      ringFx(px, py, pal.accentLight, 8, 74 + Math.min(60, d * 1.6), 0.42, 4);
      ringFx(px, py, '#ffffff', 6, 40, 0.26, 2.5);
      burst(px, py, pal.accent, 12, 190, 2.6, 0.5);
      makeFloat(px, py - 34, 'OVERDRAW', pal.accentLight, 1, 1);
      if (d >= 1) makeFloat(px + 10, py - 10, '+' + Math.round(d * 0.8) + ' VEIL', pal.accent, 0, 0);
      flash(pal.accent, 0.24, 4.4);
      shakeBy(3.2);
      buzz(18);
      sfx('overdraw', { deficit: d });
      break;
    }

    case 'breach': {
      var bx = ev.x == null ? px : ev.x, by = ev.y == null ? py : ev.y;
      shock(bx, by, HOT.accent, Math.max(W, H) * 0.95, 0.85);
      shock(bx, by, '#ffffff', Math.max(W, H) * 0.55, 0.55);
      ringFx(bx, by, HOT.grid, 10, 220, 0.7, 6);
      burst(bx, by, HOT.accent, 26, 420, 4, 0.9);
      burst(bx, by, '#ffd9e2', 10, 260, 2.6, 0.7);
      flash(HOT.accent, 0.62, 2.0);
      shakeBy(20);
      slam = 1;
      makeFloat(bx, by - 46, 'BREACH', '#ffffff', 1, 1);
      buzz([30, 40, 70]);
      sfx('breach');
      break;
    }

    case 'wraith_spawn': {
      var wx = ev.x == null ? W / 2 : ev.x, wy = ev.y == null ? H / 2 : ev.y;
      for (i = 0; i < (lowFx() ? 10 : 20); i++) implode(wx, wy, C_WRAITH, 60 + Math.random() * 90, 0.55 + Math.random() * 0.35);
      ringFx(wx, wy, C_WRAITH, 90, 6, 0.7, 3);        /* contracting, not expanding */
      ringFx(wx, wy, '#0b1220', 70, 4, 0.5, 8);
      flash('#7c8fa8', 0.3, 2.4);
      shakeBy(9);
      makeFloat(wx, wy - 40, 'VEILWRAITH', C_WRAITH, 1, 1);
      buzz([16, 60, 16]);
      sfx('wraith');
      break;
    }

    case 'player_hurt': {
      var a = Math.min(0.5, 0.16 + (ev.amount || 0) / 220);
      if (a > hurtA) hurtA = a;
      burst(px, py, C_DANGER, 8, 150, 2.4, 0.34);
      ringFx(px, py, C_DANGER, 20, 40, 0.24, 3);
      if (ev.amount >= 1) makeFloat(px, py - 26, '-' + Math.round(ev.amount), '#ff8a8a', 0, 0);
      shakeBy(4 + Math.min(7, (ev.amount || 0) / 12));
      buzz(15);
      sfx('hurt');
      break;
    }

    case 'death':
      fadeTarget = 0.82;
      flash('#000000', 0.2, 1.2);
      shakeBy(12);
      burst(px, py, '#e2d9f3', 24, 200, 3, 1.2);
      ringFx(px, py, '#ffffff', 4, 160, 1.0, 3);
      buzz([40, 90, 140]);
      sfx('death');
      if (mus) stopMusic(2.2);
      break;

    case 'wave_start':
      clearTelegraphs();
      fadeTarget = 0; fadeA = 0;
      ringFx(px, py, pal.accent, 10, 150, 0.6, 3);
      makeFloat(W / 2, H * 0.34, 'WAVE ' + (ev.wave == null ? '' : ev.wave), pal.accentLight, 1, 1);
      sfx('waveStart');
      break;

    case 'wave_clear': {
      var over = !!ev.overPar;
      ringFx(px, py, over ? C_DANGER : C_SUCCESS, 8, 190, 0.7, 4);
      makeFloat(W / 2, H * 0.34, over ? 'CLEARED — OVER PAR' : 'WAVE CLEAR', over ? '#f59e0b' : C_SUCCESS, 1, 1);
      if (!over) for (i = 0; i < 12; i++) glint(W * (0.15 + Math.random() * 0.7), H * (0.2 + Math.random() * 0.5), C_MOTE, 5, 0.8);
      sfx(over ? 'overPar' : 'waveClear');
      buzz(over ? 12 : [12, 40, 12]);
      break;
    }

    case 'pact_taken':
      ringFx(px, py, C_GOLD, 6, 96, 0.8, 3);
      ringFx(px, py, '#fde68a', 4, 60, 0.55, 2);
      for (i = 0; i < 8; i++) glint(px + (Math.random() - 0.5) * 90, py + (Math.random() - 0.5) * 90, C_GOLD, 6, 0.9);
      makeFloat(px, py - 40, 'PACT SEALED', C_GOLD, 1, 1);
      buzz([20, 30, 20]);
      sfx('pact');
      break;

    case 'mote_drop':
      moteDrop(ev.x, ev.y, ev.tier || 0);
      glint(ev.x, ev.y, moteCol(ev.tier || 0), 5 + (ev.tier || 0), 0.4);
      sfx('moteDrop', { tier: ev.tier || 0 });
      break;

    case 'mote_pickup': {
      var mt = motePick(ev.x, ev.y);
      if (mt < 0) mt = valueTier(ev.value);
      var mc = moteCol(mt);
      glint(ev.x, ev.y, mc, 7 + mt * 1.5, 0.45);
      burst(ev.x, ev.y, mc, 4 + mt, 90, 1.8, 0.32);
      /* the number flies up from where it was earned toward the HUD */
      var f = makeFloat(ev.x, ev.y - 6, '+' + (ev.value == null ? 1 : ev.value), mc, mt >= 2, mt >= 3);
      f.vy = -70 - mt * 12; f.life = f.max = 0.7;
      sfx('mote', { tier: mt });
      break;
    }

    case 'tier_change': {
      var tn = ev.tier | 0, up = tn > lastTier;
      lastTier = tn;
      var tc = veilPalette(tierMinV(tn)).accent;
      ringFx(px, py, tc, 12, Math.max(W, H) * 0.62, 0.55, 3);
      flash(tc, up ? 0.22 : 0.12, 3.4);
      makeFloat(px, py - 52, (up ? 'VEIL ▲ T' : 'VEIL ▼ T') + (tn + 1), tc, 1, 1);
      if (up) { shakeBy(4); buzz(22); }
      sfx(up ? 'tierUp' : 'tierDown', { tier: tn });
      break;
    }

    case 'cast': {
      var kind = ev.kind || 'melee';
      var cx = ev.x == null ? px : ev.x, cy = ev.y == null ? py : ev.y;
      var tx = ev.targetX == null ? cx : ev.targetX, ty = ev.targetY == null ? cy : ev.targetY;
      var rng = ev.range || 60;
      if (kind === 'aoe') {
        telegraph(1, tx, ty, rng, 0.5, pal.accentLight);
        sfx('castAoe');
      } else if (kind === 'dash') {
        streak(cx, cy, tx, ty, pal.accentLight, 0.28, 7);
        burst(cx, cy, pal.accent, 8, 160, 2.2, 0.3);
        sfx('castDash');
      } else if (kind === 'melee') {
        telegraph(2, cx, cy, rng, 0.2, '#ffffff', tx, ty);
        sfx('castMelee');
      } else if (kind === 'execute') {
        telegraph(3, tx, ty, rng * 0.5 + 26, 0.34, C_GOLD);
        sfx('castExecute');
      } else {
        var ang2 = Math.atan2(ty - cy, tx - cx);
        for (i = 0; i < 5; i++) {
          var p2 = spark(cx + Math.cos(ang2) * 14, cy + Math.sin(ang2) * 14, pal.accentLight, 120, 1.8, 0.22);
          p2.vx = Math.cos(ang2) * (90 + Math.random() * 70) + p2.vx * 0.3;
          p2.vy = Math.sin(ang2) * (90 + Math.random() * 70) + p2.vy * 0.3;
        }
        sfx('castProjectile');
      }
      break;
    }

    case 'float':
      makeFloat(ev.x == null ? px : ev.x, ev.y == null ? py : ev.y, ev.text, ev.color || C_TEXT, 0, 0);
      break;

    default:
      return;                                   /* unknown types MUST be ignored */
  }
}

/* ===========================================================================
   10. FX INTEGRATION + DRAW PASSES
   =========================================================================== */

function stepPools() {
  var i, p, k, f, dg;
  for (i = 0; i < PMAX; i++) {
    p = P[i]; if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) { p.on = 0; continue; }
    k = p.k;
    if (k === 0) {                                    /* spark */
      p.x += p.vx * dt; p.y += p.vy * dt;
      dg = Math.pow(p.drag, dt * 60);
      p.vx *= dg; p.vy *= dg; p.vy += 60 * dt;
    } else if (k === 2) {                             /* glint */
      p.y += p.vy * dt; p.vy *= Math.pow(0.9, dt * 60);
    } else if (k === 5) {                             /* implode: fly to centre */
      var prog = 1 - p.life / p.max;
      p.x += (p.vx - p.x) * Math.min(1, dt * (2 + prog * 14));
      p.y += (p.vy - p.y) * Math.min(1, dt * (2 + prog * 14));
    }
  }
  for (i = 0; i < FMAX; i++) {
    f = FL[i]; if (!f.on) continue;
    f.life -= dt;
    if (f.life <= 0) { f.on = 0; continue; }
    f.y += f.vy * dt; f.vy *= Math.pow(0.955, dt * 60);
  }
  for (i = 0; i < TMAX; i++) { if (TG[i].on) { TG[i].life -= dt; if (TG[i].life <= 0) TG[i].on = 0; } }
  for (i = 0; i < MMAX; i++) { if (MO[i].on) { MO[i].life -= dt; if (MO[i].life <= 0) MO[i].on = 0; } }
}

function drawParticles() {
  var i, p, c = ctx, f;
  c.globalCompositeOperation = 'lighter';
  for (i = 0; i < PMAX; i++) {
    p = P[i]; if (!p.on) continue;
    f = p.life / p.max;
    if (f < 0) f = 0;
    if (p.k === 0 || p.k === 5) {
      c.globalAlpha = f * 0.95;
      c.fillStyle = p.col;
      c.beginPath(); c.arc(p.x, p.y, Math.max(0.4, p.r * (0.35 + f * 0.75)), 0, 6.2832); c.fill();
    } else if (p.k === 1) {                            /* ring */
      var rr = p.r + (p.r2 - p.r) * (1 - f) * (1 - f * 0.35);
      c.globalAlpha = f * 0.9;
      c.strokeStyle = p.col; c.lineWidth = Math.max(0.5, p.sp * f);
      c.beginPath(); c.arc(p.x, p.y, Math.max(0.5, rr), 0, 6.2832); c.stroke();
    } else if (p.k === 2) {                            /* glint: 4-point star */
      var gr2 = p.r * (0.5 + f * 0.9);
      c.globalAlpha = f;
      c.strokeStyle = p.col; c.lineWidth = 1.6;
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
      c.beginPath();
      c.moveTo(-gr2, 0); c.lineTo(gr2, 0); c.moveTo(0, -gr2); c.lineTo(0, gr2);
      c.stroke();
      c.fillStyle = p.col;
      c.beginPath(); c.arc(0, 0, Math.max(0.5, gr2 * 0.26), 0, 6.2832); c.fill();
      c.restore();
    } else if (p.k === 3) {                            /* shockwave */
      var e2 = 1 - f, rr2 = p.r + (p.r2 - p.r) * (1 - Math.pow(1 - e2, 2.4));
      c.globalAlpha = f * 0.8;
      c.strokeStyle = p.col; c.lineWidth = Math.max(1, 12 * f);
      c.beginPath(); c.arc(p.x, p.y, Math.max(1, rr2), 0, 6.2832); c.stroke();
    } else if (p.k === 4) {                            /* streak */
      c.globalAlpha = f * 0.85;
      c.strokeStyle = p.col; c.lineWidth = Math.max(0.5, p.sp * f);
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.vx, p.vy); c.stroke();
      c.lineCap = 'butt';
    }
  }
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
}

function drawTelegraphs() {
  var i, e, c = ctx, f, prog, q;
  for (i = 0; i < TMAX; i++) {
    e = TG[i]; if (!e.on) continue;
    f = e.life / e.max; prog = 1 - f;
    if (e.kind === 1) {                                /* aoe: a filling disc */
      /* Alpha falls off with radius: a 200px nuke telegraph at the same alpha
         as a 60px one whites out the whole arena (seen in integration). */
      var big = e.r > 90 ? 90 / e.r : 1;
      c.globalAlpha = (0.13 + (lowFx() ? 0.04 : 0.1 * Math.sin(t * 14) * 0.5 + 0.05)) * (0.45 + 0.55 * big);
      c.fillStyle = e.col;
      c.beginPath(); c.moveTo(e.x, e.y);
      c.arc(e.x, e.y, e.r, -1.5708, -1.5708 + 6.2832 * prog); c.closePath(); c.fill();
      c.globalAlpha = 0.75;
      c.strokeStyle = e.col; c.lineWidth = 2;
      c.beginPath(); c.arc(e.x, e.y, e.r, 0, 6.2832); c.stroke();
      c.globalAlpha = 0.45; c.lineWidth = 1;
      c.beginPath();
      c.moveTo(e.x - e.r * 0.28, e.y); c.lineTo(e.x + e.r * 0.28, e.y);
      c.moveTo(e.x, e.y - e.r * 0.28); c.lineTo(e.x, e.y + e.r * 0.28);
      c.stroke();
      if (prog > 0.94) {                               /* the impact pop */
        c.globalAlpha = (prog - 0.94) / 0.06 * 0.34 * (0.4 + 0.6 * big);
        c.fillStyle = e.col;
        c.beginPath(); c.arc(e.x, e.y, e.r, 0, 6.2832); c.fill();
      }
    } else if (e.kind === 2) {                         /* melee: sweeping arc */
      var a0 = Math.atan2(e.y2 - e.y, e.x2 - e.x);
      c.globalAlpha = f * 0.8;
      c.strokeStyle = e.col; c.lineWidth = 4 * f + 1;
      c.beginPath(); c.arc(e.x, e.y, e.r * 0.9, a0 - 0.85 + prog * 1.7, a0 - 0.5 + prog * 1.7); c.stroke();
    } else if (e.kind === 3) {                         /* execute: closing brackets */
      var d2 = e.r * (0.2 + f * 1.1), bl = e.r * 0.34;
      c.globalAlpha = 0.9 * (0.35 + f * 0.65);
      c.strokeStyle = e.col; c.lineWidth = 2.4;
      for (q = 0; q < 4; q++) {
        var sx2 = q < 2 ? -1 : 1, sy2 = (q % 2) ? 1 : -1;
        c.beginPath();
        c.moveTo(e.x + sx2 * d2, e.y + sy2 * d2 - sy2 * bl);
        c.lineTo(e.x + sx2 * d2, e.y + sy2 * d2);
        c.lineTo(e.x + sx2 * d2 - sx2 * bl, e.y + sy2 * d2);
        c.stroke();
      }
    }
  }
  c.globalAlpha = 1;
}

function drawFloats() {
  var i, f, c = ctx;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (i = 0; i < FMAX; i++) {
    f = FL[i]; if (!f.on) continue;
    var age = f.max - f.life, prog = age / f.max;
    var a = prog > 0.6 ? 1 - (prog - 0.6) / 0.4 : 1;
    var sc = 1;
    /* anticipation + settle: a brief overshoot on appear */
    if (!lowFx() && age < 0.16) { var u = age / 0.16; sc = 1 + 0.42 * (1 - u) * Math.sin(u * 3.14159); }
    c.globalAlpha = a < 0 ? 0 : a;
    c.font = (f.big ? '900 ' : '800 ') + (f.size * sc).toFixed(1) + 'px ' +
             (f.serif ? "'Cinzel',Georgia,serif" : "'Nunito',system-ui,sans-serif");
    c.lineWidth = f.big ? 4 : 3;
    c.strokeStyle = 'rgba(4,2,10,0.85)';
    c.strokeText(f.text, f.x, f.y);
    c.fillStyle = f.col;
    c.fillText(f.text, f.x, f.y);
  }
  c.globalAlpha = 1;
}

function drawMotes() {
  var i, m, c = ctx, k;
  c.globalCompositeOperation = 'lighter';
  for (i = 0; i < MMAX; i++) {
    m = MO[i]; if (!m.on) continue;
    var col = moteCol(m.tier);
    var r = 3.4 + m.tier * 1.0;
    var pu = 0.72 + 0.28 * Math.sin(t * 5 + m.ph);
    var dying = m.life < 1.6 ? (0.35 + 0.65 * Math.abs(Math.sin(t * 9))) : 1;   /* blinks out */
    drawGlow(col, m.x, m.y, r * 3.4, 0.5 * pu * dying);
    c.globalAlpha = pu * dying;
    c.fillStyle = col;
    c.beginPath();
    /* tiers 0-1 are dots; 2+ gain facets, so tier is never colour-only */
    if (m.tier < 2) c.arc(m.x, m.y, r, 0, 6.2832);
    else {
      var n = 3 + m.tier;
      for (k = 0; k < n; k++) {
        var a2 = t * 0.8 + m.ph + k * 6.2832 / n;
        var xx = m.x + Math.cos(a2) * r * 1.25, yy = m.y + Math.sin(a2) * r * 1.25;
        k === 0 ? c.moveTo(xx, yy) : c.lineTo(xx, yy);
      }
      c.closePath();
    }
    c.fill();
  }
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
}

function drawProjectiles(list) {
  var c = ctx, i, p;
  for (i = 0; i < list.length; i++) {
    p = list[i];
    if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
    var vx = p.vx || 0, vy = p.vy || 0;
    var sp = Math.sqrt(vx * vx + vy * vy);
    var ang = Math.atan2(vy, vx);
    var r = p.r || 4;
    var len = Math.min(sp * 0.05, 22) + r;
    var col = p.col || '#c4b5fd';
    c.save();
    c.translate(p.x, p.y); c.rotate(ang);
    c.globalCompositeOperation = 'lighter';
    var tg2;
    try {
      tg2 = c.createLinearGradient(-len, 0, r, 0);
      tg2.addColorStop(0, rgba(col, 0)); tg2.addColorStop(1, col);
    } catch (e) { tg2 = col; }
    c.fillStyle = tg2;
    c.beginPath(); c.ellipse(0, 0, len, r * 0.55, 0, 0, 6.2832); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(0, 0, r * 0.7, 0, 6.2832); c.fill();
    c.restore();
    drawGlowAdd(col, p.x, p.y, r * 4.5, 0.5);
  }
}

function drawPlayer(pl, pal) {
  if (!pl || !isFinite(pl.x) || !isFinite(pl.y)) return;
  var c = ctx, px = pl.x, py = pl.y, i;
  var col = pl.color || '#7c3aed';
  /* i-frames: a time-based blink, not a frame-count one */
  if (pl.invuln > 0 && Math.sin(t * 34) < -0.15) return;

  /* pulsing aura — idle life even when standing still */
  c.beginPath(); c.arc(px, py, 26, 0, 6.2832);
  c.strokeStyle = col; c.lineWidth = 2;
  c.globalAlpha = 0.15 + 0.1 * Math.sin(t * 6);
  c.stroke();
  c.globalAlpha = 1;

  /* veil tether: a hotter second ring that only exists while you are in debt */
  if (pal.heat > 0.02) {
    var seg = 5, ra = t * (0.6 + pal.heat * 3.4);
    c.strokeStyle = rgba(pal.accent, 0.25 + pal.heat * 0.6);
    c.lineWidth = 1.5 + pal.heat * 2;
    for (i = 0; i < seg; i++) {
      var a0 = ra + i * 6.2832 / seg;
      c.beginPath();
      c.arc(px, py, 31 + Math.sin(t * 8 + i) * pal.heat * 2.5, a0, a0 + 0.55 + pal.heat * 0.45);
      c.stroke();
    }
  }

  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.beginPath(); c.ellipse(px, py + 22, 16, 5, 0, 0, 6.2832); c.fill();

  drawGlowAdd(col, px, py, 44, 0.55);

  var gr;
  try {
    gr = c.createRadialGradient(px - 5, py - 5, 2, px, py, 18);
    gr.addColorStop(0, lighten(col, 80));
    gr.addColorStop(0.5, col);
    gr.addColorStop(1, '#1a0030');
  } catch (e) { gr = col; }
  c.beginPath(); c.arc(px, py, 18, 0, 6.2832);
  c.fillStyle = gr; c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5; c.stroke();

  if (pl.icon) {
    c.font = '14px serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(pl.icon, px, py);
  }

  /* facing tick — heading stays readable without motion blur */
  var vx = pl.vx || 0, vy = pl.vy || 0;
  if (vx * vx + vy * vy > 4) {
    var ang = Math.atan2(vy, vx);
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 2.5; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(px + Math.cos(ang) * 15, py + Math.sin(ang) * 15);
    c.lineTo(px + Math.cos(ang) * 23, py + Math.sin(ang) * 23);
    c.stroke(); c.lineCap = 'butt';
  }
}

/* --- background: gradient + baked hex grid + dust --- */
function drawBackground(pal) {
  var c = ctx, i;
  ensureGradients(pal);
  c.fillStyle = bgGrad;
  c.fillRect(-30, -30, W + 60, H + 60);

  var band = Math.round(pal.heat * 8);
  if (gridDirty || band !== gridBand) { gridBand = band; buildGrid(pal); }

  if (gridCanvas && gridCanvas.width > 1) {
    var breathe = lowFx() ? 0 : Math.sin(t * 0.55) * 2 + pal.heat * Math.sin(t * 2.1) * 2;
    var wobX = lowFx() ? 0 : Math.sin(t * 0.31) * 3;
    c.globalAlpha = pal.gridAlpha * (0.85 + 0.15 * Math.sin(t * 1.3));
    c.drawImage(gridCanvas, -GPAD + wobX, -GPAD + breathe, W + GPAD * 2, H + GPAD * 2);
    /* warp/tear from V~75 up: the lattice ghosts against itself */
    if (pal.warp > 0 && !lowFx()) {
      var off = 1.5 + pal.warp * 4.5 * (0.6 + 0.4 * Math.sin(t * 3.3));
      c.globalAlpha = pal.gridAlpha * pal.warp * 0.85;
      c.globalCompositeOperation = 'lighter';
      c.drawImage(gridCanvas, -GPAD + off + wobX, -GPAD + breathe, W + GPAD * 2, H + GPAD * 2);
      c.drawImage(gridCanvas, -GPAD - off + wobX, -GPAD + breathe - off * 0.5, W + GPAD * 2, H + GPAD * 2);
      c.globalCompositeOperation = 'source-over';
    }
    c.globalAlpha = 1;
  }

  /* idle life: drifting veil dust, faster and hotter as V climbs */
  var spd = 10 + pal.heat * 46;
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = pal.accentLight;
  for (i = 0; i < DUST; i++) {
    var d = D[i];
    d.y -= (d.s * spd * dt) / Math.max(1, H);
    d.x += Math.sin(t * 0.4 + d.ph) * 0.00035;
    if (d.y < -0.02) { d.y = 1.02; d.x = Math.random(); }
    if (d.x < -0.02) d.x = 1.02; else if (d.x > 1.02) d.x = -0.02;
    c.globalAlpha = 0.10 + 0.22 * pal.heat + 0.08 * Math.sin(t * 2 + d.ph);
    c.beginPath(); c.arc(d.x * W, d.y * H, d.r, 0, 6.2832); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
}

/* ===========================================================================
   11. #fx-layer overlays — hurt vignette + top-tier edge glow.
   Two divs created once; only opacity changes per frame (and only when the
   value actually moves), so this never touches layout.
   =========================================================================== */

function ensureLayer() {
  if (!layer || flashEl || !doc) return;
  try {
    var cs = g.getComputedStyle ? g.getComputedStyle(layer) : null;
    if (cs && cs.position === 'static') {
      layer.style.position = 'absolute';
      layer.style.left = '0'; layer.style.top = '0'; layer.style.right = '0'; layer.style.bottom = '0';
    }
    layer.style.pointerEvents = 'none';
    flashEl = doc.createElement('div');
    flashEl.setAttribute('data-fx', 'hurt');
    flashEl.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;opacity:0;' +
      'will-change:opacity;background:radial-gradient(ellipse at center,rgba(220,38,38,0) 42%,' +
      'rgba(190,18,40,0.55) 78%,rgba(150,10,30,0.95) 100%);';
    edgeEl = doc.createElement('div');
    edgeEl.setAttribute('data-fx', 'edge');
    edgeEl.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;opacity:0;will-change:opacity;';
    layer.appendChild(flashEl);
    layer.appendChild(edgeEl);
  } catch (e) { flashEl = edgeEl = null; }
}

function syncOverlays(pal) {
  if (!flashEl) return;
  var want = hurtA > 0.002 ? hurtA.toFixed(3) : '0';
  if (want !== lastFlashStyle) { lastFlashStyle = want; flashEl.style.opacity = want; }

  var eg = pal.edgeGlow;
  var pulse = eg > 0 ? eg * (0.62 + 0.38 * Math.sin(t * 4.2)) : 0;
  var wantE = pulse > 0.004 ? pulse.toFixed(3) : '0';
  if (wantE !== lastEdgeStyle) {
    lastEdgeStyle = wantE;
    if (wantE !== '0' && edgeEl._c !== pal.edge) {
      edgeEl._c = pal.edge;
      edgeEl.style.boxShadow = 'inset 0 0 40px ' + rgba(pal.edge, 0.8) + ', inset 0 0 110px ' + rgba(pal.edge, 0.45);
    }
    edgeEl.style.opacity = wantE;
  }
}

/* ===========================================================================
   12. RENDER
   =========================================================================== */

var EMPTY = [];

function render(state, events) {
  if (!ctx) return;
  var n = now();
  dt = lastT ? Math.min((n - lastT) / 1000, 0.05) : 0.016;
  lastT = n; t += dt;

  if (!ensureSize()) return;

  var st = state || {};
  var pal = veilPalette(typeof st.veil === 'number' ? st.veil : 0);
  var enemies = (st.enemies && st.enemies.length) ? st.enemies : EMPTY;
  var projectiles = (st.projectiles && st.projectiles.length) ? st.projectiles : EMPTY;
  var phase = st.phase || 'menu';
  var i;

  /* phase transitions: clear transient FX on the way back to the menu */
  if (phase !== lastPhase) {
    if (phase === 'menu') { clearPools(); fadeTarget = 0; fadeA = 0; lastTier = 0; }
    if (phase === 'combat' && lastPhase === 'dead') { clearPools(); fadeTarget = 0; fadeA = 0; }
    lastPhase = phase;
  }

  /* --- events --- */
  var evs = (events && events.length) ? events : EMPTY;
  for (i = 0; i < evs.length; i++) {
    try { handleEvent(evs[i], st, pal); }
    catch (e) { /* an FX failure must never take the game down */ }
  }

  /* --- integrate --- */
  stepPools();
  shakeMag *= Math.pow(0.0009, dt);
  if (shakeMag < 0.05) shakeMag = 0;
  flashA -= flashDecay * dt; if (flashA < 0) flashA = 0;
  hurtA -= 1.6 * dt; if (hurtA < 0) hurtA = 0;
  slam -= dt * 3.2; if (slam < 0) slam = 0;
  if (phase === 'dead' && fadeTarget === 0) fadeTarget = 0.82;
  fadeA += (fadeTarget - fadeA) * Math.min(1, dt * 1.6);

  /* wraith census drives the music's wraith layer */
  wraithCount = 0;
  for (i = 0; i < enemies.length; i++) if (enemies[i] && enemies[i].isWraith) wraithCount++;
  musicUpdate(pal.heat, phase, wraithCount);

  /* --- draw --- */
  var c = ctx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, W, H);

  var doShake = shakeMag > 0.05 && opt.screenShake && !lowFx();
  if (doShake || slam > 0.001) {
    shakeX = doShake ? (Math.random() - 0.5) * shakeMag * 2 : 0;
    shakeY = doShake ? (Math.random() - 0.5) * shakeMag * 2 : 0;
    var z = 1 + (lowFx() ? 0 : slam * 0.035);
    c.translate(W / 2, H / 2); c.scale(z, z); c.translate(-W / 2, -H / 2);
    c.translate(shakeX, shakeY);
  }

  drawBackground(pal);

  /* telegraphs sit under the actors so they never hide a threat */
  drawTelegraphs();
  syncMotes(st);
  drawMotes();

  /* enemy glow pass — one additive blit each, no shadowBlur anywhere */
  var glowBudget = lowFx() ? 26 : 60;
  c.globalCompositeOperation = 'lighter';
  for (i = 0; i < enemies.length && i < glowBudget; i++) {
    var en = enemies[i];
    if (!en || !isFinite(en.x) || !isFinite(en.y)) continue;
    if (en.x < -60 || en.y < -60 || en.x > W + 60 || en.y > H + 60) continue;
    drawGlow(en.isWraith ? C_WRAITH : (en.color || pal.accent), en.x, en.y,
             (en.size || 12) * (en.isBoss ? 3.4 : 2.2), en.isBoss ? 0.75 : 0.5);
  }
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;

  /* enemy bodies */
  for (i = 0; i < enemies.length; i++) {
    var e3 = enemies[i];
    if (!e3 || !isFinite(e3.x) || !isFinite(e3.y)) continue;
    if (e3.x < -80 || e3.y < -80 || e3.x > W + 80 || e3.y > H + 80) continue;
    try { drawEnemy(e3, pal); } catch (err) { }
  }

  drawParticles();
  drawProjectiles(projectiles);
  drawPlayer(st.player, pal);
  drawFloats();

  /* vignette last, so every actor sits inside the arena */
  if (vigGrad) { c.fillStyle = vigGrad; c.fillRect(-30, -30, W + 60, H + 60); }

  c.setTransform(DPR, 0, 0, DPR, 0, 0);

  /* screen-level punctuation — reserved for breach / overdraw / tier / death */
  if (flashA > 0.002) {
    c.globalAlpha = Math.min(0.85, flashA);
    c.fillStyle = flashCol;
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 1;
  }
  if (fadeA > 0.002) {
    c.globalAlpha = Math.min(1, fadeA);
    c.fillStyle = '#04010a';
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 1;
  }

  syncOverlays(pal);
}

/* ===========================================================================
   13. INIT / TEARDOWN
   =========================================================================== */

function onResize() { gridDirty = true; ensureSize(); }

function init(cv, floatLayer) {
  canvas = cv || (doc && doc.getElementById('game-canvas'));
  layer = floatLayer || (doc && doc.getElementById('fx-layer'));
  if (!canvas || !canvas.getContext) return;
  try { ctx = canvas.getContext('2d', { alpha: true, desynchronized: true }); } catch (e) { ctx = null; }
  if (!ctx) ctx = canvas.getContext('2d');
  ensureLayer();
  W = 0; H = 0; DPR = 1;
  ensureSize();
  lastT = 0; t = 0; lastPhase = '';
  clearPools();
  gridDirty = true; gradKey = ''; gridBand = -1;

  if (!resizeBound) {
    resizeBound = true;
    if (g.ResizeObserver) {
      try { ro = new g.ResizeObserver(onResize); ro.observe(canvas); } catch (e2) { ro = null; }
    }
    if (!ro && g.addEventListener) g.addEventListener('resize', onResize);
  }
  bindGesture();
}

function destroy() {
  if (ro) { try { ro.disconnect(); } catch (e) { } ro = null; }
  else if (g.removeEventListener) g.removeEventListener('resize', onResize);
  resizeBound = false;
  stopMusic(0.2);
  clearPools();
}

/* ===========================================================================
   14. EXPORT
   =========================================================================== */

g.FX = {
  init: init,
  render: render,
  setOptions: setOptions,
  sfx: sfx,
  music: music,
  veilPalette: veilPalette,

  /* extras — safe for UI to use, not required by the contract */
  clear: clearPools,
  destroy: destroy,
  size: function () { return { w: W, h: H }; },
  options: function () { var o = {}, k; for (k in opt) o[k] = opt[k]; o.reducedMotion = prefersReduced; return o; },
  shake: shakeBy,
  flash: flash,
  floatText: function (x, y, text, col, big) { makeFloat(x, y, text, col, big, big); },
  audioState: function () { return A ? A.state : (audioFailed ? 'failed' : 'none'); },
  _tierOf: tierOf
};

})(typeof window !== 'undefined' ? window : globalThis);
