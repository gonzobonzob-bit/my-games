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

/* ------------------------------------------------------------------ *
 * Terrain. Purely decorative — nothing here collides, blocks or costs
 * anything, so none of the balance measurements are affected. Baked
 * once per (rift, size) into its own canvas and blitted, exactly like
 * the hex lattice, so it costs one drawImage per frame rather than a
 * few hundred path ops.
 *
 * Seeded off the rift id so a resize re-bakes the SAME ground rather
 * than randomly redecorating the arena under the player.
 * ------------------------------------------------------------------ */
var terrCanvas = null, terrCtx = null, terrKey = '', curRift = '';

function terrRng(seedStr) {
  var h = 2166136261;
  for (var i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i); h = (h * 16777619) >>> 0;
  }
  return function () {
    h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

function buildTerrain(riftId, pal) {
  if (!doc) return;
  if (!terrCanvas) { terrCanvas = doc.createElement('canvas'); terrCtx = terrCanvas.getContext('2d'); }
  var tw = Math.max(1, Math.round(W * DPR)), th = Math.max(1, Math.round(H * DPR));
  if (terrCanvas.width !== tw || terrCanvas.height !== th) { terrCanvas.width = tw; terrCanvas.height = th; }
  var c = terrCtx, i, j, x, y, r;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, W, H);
  var rnd = terrRng((riftId || 'rift_hollow') + ':' + Math.round(W) + 'x' + Math.round(H));
  var ink = pal.grid || 'rgba(160,140,220,0.2)';

  /* --- flagstones: every rift stands on something --- */
  var cell = riftId === 'rift_press' ? 46 : 74;
  c.lineWidth = 1;
  for (y = -cell; y < H + cell; y += cell) {
    for (x = -cell; x < W + cell; x += cell) {
      var ox = (Math.round(y / cell) % 2) * cell * 0.5;
      var jx = (rnd() - 0.5) * 5, jy = (rnd() - 0.5) * 5;
      c.strokeStyle = rgba(ink, 0.14 + rnd() * 0.12);
      c.strokeRect(x + ox + jx, y + jy, cell - 2, cell - 2);
      if (rnd() < 0.22) {                       // a few stones sit darker
        c.fillStyle = 'rgba(0,0,0,' + (0.10 + rnd() * 0.16).toFixed(3) + ')';
        c.fillRect(x + ox + jx, y + jy, cell - 2, cell - 2);
      }
    }
  }

  /* --- cracks --- */
  var cracks = riftId === 'rift_press' ? 26 : riftId === 'rift_famine' ? 22 : 14;
  c.lineCap = 'round';
  for (i = 0; i < cracks; i++) {
    x = rnd() * W; y = rnd() * H;
    var ang = rnd() * 6.2832, len = 24 + rnd() * 90;
    c.strokeStyle = 'rgba(0,0,0,' + (0.22 + rnd() * 0.26).toFixed(3) + ')';
    c.lineWidth = 0.6 + rnd() * 1.5;
    c.beginPath(); c.moveTo(x, y);
    for (j = 0; j < 4; j++) {
      ang += (rnd() - 0.5) * 1.1;
      x += Math.cos(ang) * len / 4; y += Math.sin(ang) * len / 4;
      c.lineTo(x, y);
    }
    c.stroke();
  }

  /* --- per-rift character --- */
  if (riftId === 'rift_crowd') {
    for (i = 0; i < 60; i++) {                  // rubble field
      x = rnd() * W; y = rnd() * H; r = 1.5 + rnd() * 5;
      c.fillStyle = 'rgba(0,0,0,' + (0.26 + rnd() * 0.24).toFixed(3) + ')';
      c.beginPath(); c.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, 6.2832); c.fill();
      c.fillStyle = rgba(ink, 0.14 + rnd() * 0.14);
      c.beginPath(); c.ellipse(x - r * 0.3, y - r * 0.3, r * 0.6, r * 0.4, 0, 0, 6.2832); c.fill();
    }
  } else if (riftId === 'rift_famine') {
    for (i = 0; i < 16; i++) {                  // ash drifts
      x = rnd() * W; y = rnd() * H;
      c.fillStyle = 'rgba(220,215,200,' + (0.045 + rnd() * 0.055).toFixed(3) + ')';
      c.beginPath();
      c.ellipse(x, y, 30 + rnd() * 70, 10 + rnd() * 22, rnd() * 3.14, 0, 6.2832);
      c.fill();
    }
    for (i = 0; i < 14; i++) {                  // bone shards
      x = rnd() * W; y = rnd() * H;
      c.strokeStyle = 'rgba(226,222,205,' + (0.22 + rnd() * 0.24).toFixed(3) + ')';
      c.lineWidth = 1.5 + rnd() * 1.5;
      var a2 = rnd() * 6.2832, l2 = 5 + rnd() * 12;
      c.beginPath();
      c.moveTo(x, y); c.lineTo(x + Math.cos(a2) * l2, y + Math.sin(a2) * l2);
      c.stroke();
    }
  } else if (riftId === 'rift_press') {
    for (i = 0; i < 10; i++) {                  // scorch marks
      x = rnd() * W; y = rnd() * H; r = 16 + rnd() * 40;
      try {
        var g2 = c.createRadialGradient(x, y, 1, x, y, r);
        g2.addColorStop(0, 'rgba(0,0,0,0.38)');
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g2;
      } catch (e) { c.fillStyle = 'rgba(0,0,0,0.10)'; }
      c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
    }
  } else {
    for (i = 0; i < 22; i++) {                  // hollow: worn patches
      x = rnd() * W; y = rnd() * H; r = 10 + rnd() * 34;
      c.fillStyle = 'rgba(0,0,0,' + (0.12 + rnd() * 0.14).toFixed(3) + ')';
      c.beginPath(); c.ellipse(x, y, r, r * 0.62, rnd() * 3.14, 0, 6.2832); c.fill();
    }
  }
}

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
  for (i = 0; i < CO.length; i++) CO[i].on = 0;
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
   8. CREATURES — the full 12-shape enum, drawn as figures rather than blobs.

   Three ideas hold this together:

   1. A creature is a small DISPLAY LIST (the op buffer below), not a pile of
      inline canvas calls. That buys a proper two-pass render: everything is
      stroked once in ink at +outline width, then filled in colour. A hard
      dark contour is what keeps a 26px creature readable against a lit
      background — detail does not survive that size, contrast does.

   2. Silhouette carries the archetype, colour only confirms it. The twelve
      forms are deliberately spread across silhouette classes — upright biped,
      comet, stacked stack, wide low hulk, faceted pod, back-swept flyer,
      lance, robed hourglass, holed torso, crowned column, lantern, caged
      core. Two of them may never be told apart by hue alone.

   3. Bodies are BAKED. Each (shape, size, colour, wraith) gets one offscreen
      strip of gait frames, blitted with a single drawImage per enemy. That
      removes the per-enemy createRadialGradient the old drawEnemy did every
      frame, and it is what pays for this much detail at 43 enemies. Bosses
      and anything mid-telegraph are drawn live instead — there are never more
      than a handful, and their pose has to be continuous.
   =========================================================================== */

var TAU = 6.28318531;

/* --- op buffer. Reused; only ever filled inside one paintCreature call. --- */
var OPS = [], OPN = 0;
function opClear() { OPN = 0; }
function opNext() { var o = OPS[OPN]; if (!o) o = OPS[OPN] = { t: 0, pts: null }; OPN++; return o; }
function LN(x0, y0, x1, y1, w, ci) {
  var o = opNext(); o.t = 1; o.a = x0; o.b = y0; o.c = x1; o.d = y1; o.w = w; o.ci = ci; o.qx = null; return o;
}
function CV(x0, y0, cx, cy, x1, y1, w, ci) {
  var o = LN(x0, y0, x1, y1, w, ci); o.qx = cx; o.qy = cy; return o;
}
function EL(x, y, rx, ry, rot, ci) {
  var o = opNext(); o.t = 2; o.a = x; o.b = y; o.c = rx; o.d = ry; o.w = rot; o.ci = ci; return o;
}
function PY(pts, ci) { var o = opNext(); o.t = 3; o.pts = pts; o.ci = ci; return o; }
function RN(x, y, ro, ri, ci) { var o = opNext(); o.t = 4; o.a = x; o.b = y; o.c = ro; o.d = ri; o.ci = ci; return o; }
function AR(x, y, r, a0, a1, w, ci) {
  var o = opNext(); o.t = 5; o.a = x; o.b = y; o.c = r; o.d = a0; o.qx = a1; o.w = w; o.ci = ci; return o;
}
/* rotated rectangle -> 8 numbers, for slabs and plates */
function slab(cx, cy, hw, hh, rot) {
  var co = Math.cos(rot), si = Math.sin(rot);
  return [cx - hw * co + hh * si, cy - hw * si - hh * co,
          cx + hw * co + hh * si, cy + hw * si - hh * co,
          cx + hw * co - hh * si, cy + hw * si + hh * co,
          cx - hw * co - hh * si, cy - hw * si + hh * co];
}

function opPath(c, o) {
  c.beginPath();
  if (o.t === 1) {
    c.moveTo(o.a, o.b);
    if (o.qx != null) c.quadraticCurveTo(o.qx, o.qy, o.c, o.d); else c.lineTo(o.c, o.d);
  } else if (o.t === 2) {
    c.ellipse(o.a, o.b, Math.max(0.05, o.c), Math.max(0.05, o.d), o.w, 0, TAU);
  } else if (o.t === 3) {
    var p = o.pts; c.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
    c.closePath();
  } else if (o.t === 4) {
    c.arc(o.a, o.b, Math.max(0.05, o.c), 0, TAU);
    c.arc(o.a, o.b, Math.max(0.03, o.d), 0, TAU, true);
  } else {
    c.arc(o.a, o.b, Math.max(0.05, o.c), o.d, o.qx);
  }
}
/* ci 0..5 index K.c; ci+10 means "no ink outline" (glowing bits, voids). */
function paintOps(c, K, ow) {
  var i, o, stroked;
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = K.ink; c.fillStyle = K.ink;
  for (i = 0; i < OPN; i++) {
    o = OPS[i]; if (o.ci >= 10) continue;
    stroked = (o.t === 1 || o.t === 5);
    opPath(c, o);
    if (stroked) { c.lineWidth = o.w + ow * 2; c.stroke(); }
    else { c.lineWidth = ow * 2; c.stroke(); c.fill(); }
  }
  for (i = 0; i < OPN; i++) {
    o = OPS[i];
    var st = K.c[(o.ci >= 10 ? o.ci - 10 : o.ci) % 6];
    c.fillStyle = st; c.strokeStyle = st;
    stroked = (o.t === 1 || o.t === 5);
    opPath(c, o);
    if (stroked) { c.lineWidth = o.w; c.stroke(); } else c.fill();
  }
}

/* --- colour kits. K.c = [dark, bodyGradient, highlight, glow, void, flat] --- */
function makeKit(c, col, wraith, S) {
  var base = wraith ? desat(col, 0.8, C_WRAITH) : col;
  var hi = lighten(base, 52), dk = mixCol(base, '#080410', 0.74);
  var glow = wraith ? '#eef5ff' : lighten(base, 165);
  var vd = wraith ? 'rgba(206,226,248,0.5)' : 'rgba(9,4,18,0.9)';
  var ink = wraith ? 'rgba(150,178,208,0.55)' : 'rgba(6,3,13,0.94)';
  var grad;
  try {
    grad = c.createLinearGradient(0, -S * 1.25, 0, S * 1.15);
    grad.addColorStop(0, lighten(base, 34)); grad.addColorStop(0.34, base); grad.addColorStop(1, dk);
  } catch (e) { grad = base; }
  return { c: [dk, grad, hi, glow, vd, base], ink: ink, base: base, glow: glow, hi: hi, dk: dk };
}
var liveKits = {}, liveKitN = 0;
function liveKit(col, wraith, S) {
  var key = col + '|' + (wraith ? 1 : 0) + '|' + (S | 0);
  var k = liveKits[key];
  if (k) return k;
  k = makeKit(ctx, col, wraith, S);
  if (liveKitN > 40) { liveKits = {}; liveKitN = 0; }
  liveKits[key] = k; liveKitN++;
  return k;
}

/* --- per-shape form data. ext = sprite box side in units of S. --- */
var FORM = {
  husk:    { or: 1, hov: 0.00, fr: 8, ext: 3.4 },
  wisp:    { or: 2, hov: 0.10, fr: 8, ext: 3.6 },
  block:   { or: 1, hov: 0.00, fr: 6, ext: 3.2 },
  hex:     { or: 1, hov: 0.00, fr: 6, ext: 3.2 },
  diamond: { or: 1, hov: 0.09, fr: 6, ext: 3.2 },
  shard:   { or: 2, hov: 0.07, fr: 8, ext: 3.4 },
  spike:   { or: 1, hov: 0.00, fr: 8, ext: 4.4 },
  star:    { or: 1, hov: 0.10, fr: 8, ext: 3.4 },
  ring:    { or: 1, hov: 0.07, fr: 6, ext: 3.2 },
  crown:   { or: 1, hov: 0.00, fr: 5, ext: 3.4 },
  orb:     { or: 1, hov: 0.06, fr: 5, ext: 3.6 },
  core:    { or: 2, hov: 0.07, fr: 5, ext: 3.6 }
};                                      /* or: 1 = flip on facing, 2 = rotate */

/* ---------------------------------------------------------------------------
   paintCreature — builds the display list for one figure, centred on 0,0,
   facing +x, with a body radius of S and feet on y = +S. `u` is the gait
   phase 0..1. Nothing here touches the canvas; paintOps does the drawing.
   --------------------------------------------------------------------------- */
function paintCreature(shape, S, u) {
  var i, a, sw, sw2, bob, pulse, mx, my;
  opClear();
  sw = Math.sin(u * TAU); sw2 = -sw;

  switch (shape) {

    /* HUSK — a shambling biped. The only walker among the small enemies, so
       "two legs, arms swinging" is the whole read at 30px. */
    case 'husk': {
      bob = -Math.abs(sw) * S * 0.10;
      LN(-S * 0.06, S * 0.22 + bob, -S * 0.10 + sw2 * S * 0.5, S * 1.02, S * 0.20, 0);
      CV(-S * 0.02, -S * 0.42 + bob, -S * 0.40, -S * 0.02 + bob, -S * 0.28 - sw * S * 0.3, S * 0.54 + bob, S * 0.15, 0);
      PY([-S * 0.34, S * 0.30 + bob, -S * 0.42, -S * 0.34 + bob, -S * 0.18, -S * 0.78 + bob,
           S * 0.28, -S * 0.72 + bob, S * 0.40, -S * 0.10 + bob, S * 0.30, S * 0.32 + bob], 1);
      LN(S * 0.08, S * 0.22 + bob, S * 0.14 + sw * S * 0.5, S * 1.02, S * 0.22, 5);
      CV(S * 0.14, -S * 0.44 + bob, S * 0.48, -S * 0.02 + bob, S * 0.34 - sw2 * S * 0.3, S * 0.58 + bob, S * 0.17, 5);
      PY([S * 0.02, -S * 0.74 + bob, S * 0.46, -S * 0.92 + bob, S * 0.54, -S * 1.24 + bob,
          S * 0.08, -S * 1.32 + bob, -S * 0.18, -S * 1.00 + bob], 2);
      LN(-S * 0.02, -S * 1.16 + bob, S * 0.16, -S * 0.86 + bob, S * 0.07, 14);   /* the crack */
      EL(S * 0.36, -S * 1.04 + bob, S * 0.14, S * 0.09, -0.22, 3);
      break;
    }

    /* WISP — a comet: burning head, streaming tail. Drawn along +x and
       rotated to velocity, because a flame has no up. */
    case 'wisp': {
      var fl = Math.sin(u * TAU), fl2 = Math.sin(u * TAU * 2 + 1.1);
      EL(-S * 1.42 + fl * S * 0.10, fl2 * S * 0.18, S * 0.22, S * 0.15, 0, 10);
      EL(-S * 0.88, fl * S * 0.14, S * 0.38, S * 0.26, 0, 0);
      PY([S * 1.08, 0, S * 0.30, -S * 0.70, -S * 0.50, -S * 0.44 + fl * S * 0.12,
          -S * 1.10, fl * S * 0.22, -S * 0.50, S * 0.44 + fl * S * 0.12, S * 0.30, S * 0.70], 1);
      PY([S * 0.30, -S * 0.62, S * 0.10, -S * 1.20 - fl * S * 0.2, -S * 0.10, -S * 0.58], 2);
      PY([-S * 0.16, -S * 0.52, -S * 0.44, -S * 0.98 + fl2 * S * 0.18, -S * 0.56, -S * 0.40], 2);
      EL(-S * 0.05, 0, S * 0.36, S * 0.28, 0, 13);
      EL(S * 0.46, 0, S * 0.22, S * 0.15, 0, 3);
      break;
    }

    /* BLOCK — the Cairnbound: three stacked slabs on stub legs, rune-lit at
       the seams. Tall, rectangular, lurching. The par clock walking. */
    case 'block': {
      var lean = sw * 0.05;
      bob = -Math.abs(sw) * S * 0.05;
      LN(-S * 0.34, S * 0.55 + bob, -S * 0.40 + sw2 * S * 0.14, S * 1.08, S * 0.30, 0);
      LN(S * 0.34, S * 0.55 + bob, S * 0.40 + sw * S * 0.14, S * 1.08, S * 0.32, 0);
      PY(slab(0, S * 0.40 + bob, S * 0.92, S * 0.28, lean * 0.5), 1);
      PY(slab(sw * S * 0.05, -S * 0.18 + bob, S * 0.76, S * 0.30, -lean), 1);
      PY(slab(sw2 * S * 0.04, -S * 0.80 + bob, S * 0.56, S * 0.32, lean * 1.4), 2);
      EL(0, S * 0.10 + bob, S * 0.74, S * 0.05, lean * 0.5, 13);
      EL(0, -S * 0.48 + bob, S * 0.60, S * 0.045, -lean, 13);
      EL(-S * 0.22, -S * 0.82 + bob, S * 0.11, S * 0.13, lean, 3);
      EL(S * 0.22, -S * 0.82 + bob, S * 0.11, S * 0.13, lean, 3);
      LN(-S * 0.55, S * 0.44 + bob, -S * 0.30, S * 0.34 + bob, S * 0.05, 10);
      break;
    }

    /* HEX — the Slagbrute: wide, low, crusted, cracked with magma. Reads
       against the Cairnbound by proportion alone: broad where that is tall. */
    case 'hex': {
      pulse = 0.5 + 0.5 * Math.sin(u * TAU);
      bob = -Math.abs(sw) * S * 0.05;
      LN(-S * 0.52, S * 0.42 + bob, -S * 0.62 + sw2 * S * 0.14, S * 1.00, S * 0.32, 0);
      LN(S * 0.52, S * 0.42 + bob, S * 0.62 + sw * S * 0.14, S * 1.00, S * 0.34, 0);
      CV(-S * 0.62, -S * 0.22 + bob, -S * 1.16, -S * 0.05 + bob, -S * 0.94, S * 0.56 + bob, S * 0.24, 0);
      PY([-S * 1.12, -S * 0.05 + bob, -S * 0.62, -S * 0.74 + bob, S * 0.60, -S * 0.74 + bob,
          S * 1.10, -S * 0.05 + bob, S * 0.66, S * 0.52 + bob, -S * 0.66, S * 0.52 + bob], 1);
      PY([-S * 0.92, -S * 0.34 + bob, -S * 0.52, -S * 0.98 + bob, -S * 0.12, -S * 0.44 + bob], 0);
      PY([-S * 0.20, -S * 0.50 + bob, S * 0.20, -S * 1.08 + bob, S * 0.52, -S * 0.50 + bob], 0);
      LN(-S * 0.60, -S * 0.30 + bob, -S * 0.34, S * 0.12 + bob, S * 0.075 * (0.6 + pulse * 0.8), 13);
      LN(-S * 0.18, S * 0.24 + bob, S * 0.04, -S * 0.20 + bob, S * 0.09 * (0.6 + pulse * 0.8), 13);
      LN(S * 0.24, -S * 0.06 + bob, S * 0.50, S * 0.30 + bob, S * 0.065 * (0.6 + pulse * 0.8), 13);
      EL(S * 0.86, S * 0.16 + bob, S * 0.30, S * 0.24, -0.2, 2);
      EL(S * 0.97, S * 0.12 + bob, S * 0.11, S * 0.08, 0, 3);
      CV(S * 0.62, -S * 0.20 + bob, S * 1.20, -S * 0.02 + bob, S * 1.00, S * 0.60 + bob, S * 0.26, 5);
      break;
    }

    /* DIAMOND — the Motherglass: a faceted pod with three lit embryos visibly
       circling inside it. The count is the mechanic; you can read the split
       off the body before it ever dies. */
    case 'diamond': {
      var sp = u * TAU;
      CV(-S * 0.30, S * 0.92, -S * 0.44, S * 1.24, -S * 0.18, S * 1.38, S * 0.08, 0);
      CV(S * 0.30, S * 0.92, S * 0.44, S * 1.24, S * 0.18, S * 1.38, S * 0.08, 0);
      PY([0, -S * 1.30, S * 0.86, -S * 0.14, S * 0.50, S * 0.96, -S * 0.50, S * 0.96, -S * 0.86, -S * 0.14], 1);
      PY([0, -S * 0.88, S * 0.58, -S * 0.10, S * 0.34, S * 0.62, -S * 0.34, S * 0.62, -S * 0.58, -S * 0.10], 14);
      for (i = 0; i < 3; i++) {
        a = sp + i * 2.0944;
        EL(Math.cos(a) * S * 0.30, Math.sin(a) * S * 0.30 - S * 0.06, S * 0.17, S * 0.14, 0, 3);
      }
      LN(-S * 0.48, -S * 0.36, -S * 0.04, -S * 1.06, S * 0.07, 12);
      break;
    }

    /* SHARD — the Nettle: a back-swept blade-flyer with a stinger. Rotated to
       velocity, so its darts read as a body turning, not a sprite sliding. */
    case 'shard': {
      var beat = Math.sin(u * TAU * 2);
      PY([S * 0.05, -S * 0.16, -S * 1.05, -S * 0.86 - beat * S * 0.34,
          -S * 0.85, -S * 0.28, -S * 0.50, -S * 0.06], 2);
      PY([S * 0.05, S * 0.16, -S * 1.05, S * 0.86 + beat * S * 0.34,
          -S * 0.85, S * 0.28, -S * 0.50, S * 0.06], 2);
      LN(-S * 0.5, 0, -S * 1.50, beat * S * 0.08, S * 0.13, 0);
      EL(0, 0, S * 0.88, S * 0.34, 0, 1);
      LN(S * 0.30, -S * 0.14, S * 1.30, -S * 0.52, S * 0.12, 5);
      LN(S * 0.30, S * 0.14, S * 1.30, S * 0.52, S * 0.12, 5);
      EL(S * 0.54, 0, S * 0.24, S * 0.17, 0, 3);
      break;
    }

    /* SPIKE — the Lancer: a jouster. The lance is 1.9S of straight line out
       of the body and it is the only thing you need to see. */
    case 'spike': {
      bob = -Math.abs(sw) * S * 0.07;
      LN(-S * 0.10, S * 0.28 + bob, -S * 0.22 + sw2 * S * 0.42, S * 1.00, S * 0.15, 0);
      CV(-S * 0.05, -S * 0.40 + bob, -S * 0.42, -S * 0.10 + bob, -S * 0.30, S * 0.42 + bob, S * 0.13, 0);
      PY([-S * 0.30, S * 0.30 + bob, -S * 0.34, -S * 0.34 + bob, -S * 0.05, -S * 0.72 + bob,
          S * 0.30, -S * 0.62 + bob, S * 0.34, -S * 0.05 + bob, S * 0.24, S * 0.32 + bob], 1);
      LN(S * 0.06, S * 0.28 + bob, S * 0.18 + sw * S * 0.42, S * 1.00, S * 0.17, 5);
      EL(-S * 0.12, -S * 0.46 + bob, S * 0.30, S * 0.20, -0.3, 0);
      PY([0, -S * 0.68 + bob, S * 0.46, -S * 0.86 + bob, S * 0.58, -S * 1.06 + bob,
          S * 0.06, -S * 1.20 + bob, -S * 0.20, -S * 0.92 + bob], 2);
      EL(S * 0.34, -S * 0.96 + bob, S * 0.13, S * 0.07, -0.2, 3);
      LN(-S * 0.38, S * 0.04 + bob, S * 1.68, -S * 0.28 + bob, S * 0.11, 5);
      EL(S * 0.40, -S * 0.10 + bob, S * 0.19, S * 0.16, -0.15, 5);
      PY([S * 1.52, -S * 0.44 + bob, S * 1.98, -S * 0.28 + bob, S * 1.52, -S * 0.12 + bob], 3);
      break;
    }

    /* STAR — the Ashcaster: a robed conjurer with a charge held out front.
       No legs, tattered hem: it hovers where the walkers walk. */
    case 'star': {
      bob = sw * S * 0.06;
      var hem = Math.sin(u * TAU + 1.0);
      CV(-S * 0.40, -S * 0.30 + bob, -S * 0.88, -S * 0.20 + bob, -S * 0.62, S * 0.36 + bob, S * 0.20, 0);
      PY([-S * 0.46, -S * 0.40 + bob, S * 0.46, -S * 0.40 + bob, S * 0.90, S * 1.02 + bob,
          S * 0.58, S * 0.80 + bob, S * 0.28, S * 1.14 + bob + hem * S * 0.08, 0, S * 0.84 + bob,
          -S * 0.30, S * 1.16 + bob - hem * S * 0.08, -S * 0.60, S * 0.82 + bob, -S * 0.90, S * 1.00 + bob], 1);
      PY([-S * 0.44, -S * 0.34 + bob, -S * 0.32, -S * 1.00 + bob, S * 0.12, -S * 1.26 + bob,
          S * 0.52, -S * 0.88 + bob, S * 0.46, -S * 0.32 + bob], 2);
      PY([-S * 0.18, -S * 0.48 + bob, -S * 0.10, -S * 0.94 + bob, S * 0.32, -S * 0.88 + bob,
          S * 0.32, -S * 0.46 + bob], 14);
      EL(S * 0.04, -S * 0.68 + bob, S * 0.08, S * 0.06, 0, 13);
      EL(S * 0.22, -S * 0.70 + bob, S * 0.08, S * 0.06, 0, 13);
      CV(S * 0.38, -S * 0.28 + bob, S * 0.92, -S * 0.48 + bob, S * 0.88, -S * 0.78 + bob, S * 0.21, 5);
      EL(S * 0.96, -S * 0.98 + bob, S * 0.24 + Math.abs(sw) * S * 0.07, S * 0.24 + Math.abs(sw) * S * 0.07, 0, 3);
      break;
    }

    /* RING — the Hollow Warden: the hole through its chest is the silhouette.
       Arms held out; three ward-runes orbit. Its aura is drawn separately. */
    case 'ring': {
      var rot = u * TAU;
      bob = sw * S * 0.05;
      CV(-S * 0.62, -S * 0.12 + bob, -S * 1.28, -S * 0.34 + bob, -S * 1.16, S * 0.36 + bob, S * 0.17, 0);
      CV(S * 0.62, -S * 0.12 + bob, S * 1.28, -S * 0.34 + bob, S * 1.16, S * 0.36 + bob, S * 0.17, 0);
      RN(0, S * 0.14 + bob, S * 0.86, S * 0.37, 1);
      PY([-S * 0.80, -S * 0.42 + bob, -S * 0.36, -S * 0.76 + bob, S * 0.36, -S * 0.76 + bob,
          S * 0.80, -S * 0.42 + bob, S * 0.50, -S * 0.18 + bob, -S * 0.50, -S * 0.18 + bob], 2);
      PY([-S * 0.26, -S * 0.70 + bob, -S * 0.20, -S * 1.12 + bob, S * 0.20, -S * 1.12 + bob,
          S * 0.26, -S * 0.70 + bob], 2);
      EL(0, -S * 0.94 + bob, S * 0.17, S * 0.07, 0, 13);
      for (i = 0; i < 3; i++) {
        a = rot + i * 2.0944;
        EL(Math.cos(a) * S * 1.18, Math.sin(a) * S * 0.5 + S * 0.14 + bob, S * 0.13, S * 0.13, 0.7854, 3);
      }
      break;
    }

    /* CROWN — the Toll Collector: a crowned column with one hand always out.
       Tallest silhouette in the game and the only one with a lit crown. */
    case 'crown': {
      bob = -Math.abs(sw) * S * 0.04;
      PY([-S * 0.52, -S * 0.30 + bob, S * 0.52, -S * 0.30 + bob, S * 0.96, S * 1.10,
          S * 0.56, S * 0.90, S * 0.16, S * 1.16, -S * 0.26, S * 0.90, -S * 0.72, S * 1.12], 1);
      CV(-S * 0.46, -S * 0.46 + bob, -S * 0.98, -S * 0.20 + bob, -S * 0.84, S * 0.30 + bob, S * 0.16, 0);
      PY(slab(-S * 0.88, S * 0.44 + bob, S * 0.20, S * 0.26, 0.22), 0);
      PY([-S * 0.72, -S * 0.34 + bob, -S * 0.46, -S * 0.80 + bob, S * 0.46, -S * 0.80 + bob,
          S * 0.72, -S * 0.34 + bob, S * 0.42, -S * 0.14 + bob, -S * 0.42, -S * 0.14 + bob], 2);
      LN(-S * 0.34, -S * 0.20 + bob, -S * 0.20, S * 0.34 + bob, S * 0.05, 10);
      LN(S * 0.30, -S * 0.20 + bob, S * 0.18, S * 0.30 + bob, S * 0.05, 10);
      PY([-S * 0.20, -S * 0.74 + bob, -S * 0.24, -S * 1.08 + bob, S * 0.24, -S * 1.08 + bob,
          S * 0.20, -S * 0.74 + bob], 2);
      PY([-S * 0.16, -S * 0.98 + bob, S * 0.16, -S * 0.98 + bob, S * 0.14, -S * 0.80 + bob,
          -S * 0.14, -S * 0.80 + bob], 14);
      EL(-S * 0.07, -S * 0.90 + bob, S * 0.05, S * 0.045, 0, 13);
      EL(S * 0.09, -S * 0.90 + bob, S * 0.05, S * 0.045, 0, 13);
      PY([-S * 0.32, -S * 1.04 + bob, -S * 0.36, -S * 1.34 + bob, -S * 0.14, -S * 1.18 + bob,
          0, -S * 1.52 + bob, S * 0.14, -S * 1.18 + bob, S * 0.36, -S * 1.34 + bob,
          S * 0.32, -S * 1.04 + bob], 3);
      CV(S * 0.52, -S * 0.50 + bob, S * 1.02, -S * 0.42 + bob, S * 1.06, -S * 0.04 + bob, S * 0.15, 5);
      EL(S * 1.14, S * 0.06 + bob, S * 0.15, S * 0.11, 0, 3);
      break;
    }

    /* ORB — the Lamplighter: a cowled bearer holding a caged lamp. The lamp
       is the biggest bright mass on screen; the shield dome hangs off it. */
    case 'orb': {
      var fl3 = Math.sin(u * TAU * 2);
      bob = sw * S * 0.05;
      PY([-S * 0.52, -S * 0.10 + bob, S * 0.48, -S * 0.10 + bob, S * 0.84, S * 1.14 + bob,
          S * 0.38, S * 0.94 + bob, 0, S * 1.20 + bob, -S * 0.42, S * 0.94 + bob, -S * 0.84, S * 1.14 + bob], 1);
      CV(-S * 0.40, -S * 0.30 + bob, -S * 0.90, -S * 0.10 + bob, -S * 0.76, S * 0.38 + bob, S * 0.16, 0);
      PY([-S * 0.62, -S * 0.16 + bob, -S * 0.34, -S * 0.52 + bob, S * 0.34, -S * 0.52 + bob,
          S * 0.62, -S * 0.16 + bob, S * 0.34, -S * 0.02 + bob, -S * 0.34, -S * 0.02 + bob], 2);
      PY([-S * 0.28, -S * 0.44 + bob, -S * 0.22, -S * 0.92 + bob, S * 0.06, -S * 1.16 + bob,
          S * 0.32, -S * 0.78 + bob, S * 0.30, -S * 0.40 + bob], 2);
      PY([-S * 0.13, -S * 0.56 + bob, -S * 0.07, -S * 0.90 + bob, S * 0.22, -S * 0.84 + bob,
          S * 0.22, -S * 0.52 + bob], 14);
      EL(0, -S * 0.72 + bob, S * 0.06, S * 0.05, 0, 13);
      EL(S * 0.16, -S * 0.74 + bob, S * 0.06, S * 0.05, 0, 13);
      CV(S * 0.50, -S * 0.26 + bob, S * 0.90, -S * 0.30 + bob, S * 0.96, -S * 0.58 + bob, S * 0.17, 5);
      LN(S * 0.96, -S * 0.60 + bob, S * 0.96, -S * 0.44 + bob, S * 0.05, 0);
      PY(slab(S * 0.96, -S * 0.40 + bob, S * 0.25, S * 0.07, 0), 0);
      EL(S * 0.96, S * 0.10 + bob, S * 0.46, S * 0.50, 0, 14);
      EL(S * 0.96, S * 0.10 + bob, S * 0.28 + fl3 * S * 0.05, S * 0.32, 0, 3);
      AR(S * 0.96, S * 0.10 + bob, S * 0.46, -2.5, -0.65, S * 0.055, 12);
      AR(S * 0.96, S * 0.10 + bob, S * 0.46, 0.65, 2.5, S * 0.055, 12);
      LN(S * 0.52, S * 0.10 + bob, S * 1.40, S * 0.10 + bob, S * 0.05, 12);
      PY(slab(S * 0.96, S * 0.62 + bob, S * 0.23, S * 0.07, 0), 0);
      break;
    }

    /* CORE — the Reckoner: a nucleus in a cage of counter-turning brackets
       with four claw limbs. The only shape whose centre is brighter than
       its edge, which is the warning that it detonates. */
    case 'core': {
      var b1 = u * TAU;
      pulse = 0.5 + 0.5 * Math.sin(u * TAU * 2);
      for (i = 0; i < 4; i++) {
        a = b1 * 0.35 + i * 1.5708 + 0.4;
        mx = Math.cos(a) * S * 0.95; my = Math.sin(a) * S * 0.95;
        CV(Math.cos(a) * S * 0.34, Math.sin(a) * S * 0.34, mx, my,
           Math.cos(a + 0.55) * S * 1.52, Math.sin(a + 0.55) * S * 1.52, S * 0.11, 0);
      }
      AR(0, 0, S * 0.92, b1, b1 + 1.5, S * 0.16, 5);
      AR(0, 0, S * 0.92, b1 + 3.1416, b1 + 4.64, S * 0.16, 5);
      AR(0, 0, S * 1.24, -b1 * 0.7, -b1 * 0.7 + 0.9, S * 0.10, 0);
      AR(0, 0, S * 1.24, -b1 * 0.7 + 3.1416, -b1 * 0.7 + 4.04, S * 0.10, 0);
      EL(0, 0, S * 0.54, S * 0.54, 0, 1);
      EL(0, 0, S * 0.34 * (0.86 + pulse * 0.3), S * 0.34 * (0.86 + pulse * 0.3), 0, 3);
      EL(0, 0, S * 0.10, S * 0.26, 0, 14);
      break;
    }

    default:
      return paintCreature('orb', S, u);
  }
}

/* ---------------------------------------------------------------------------
   Baked gait strips. One canvas per (shape, size, colour, wraith) holding
   FORM.fr frames side by side. LRU-capped; a wave's roster is 5-7 sheets.
   --------------------------------------------------------------------------- */
/* Sheets are LRU-evicted, not FIFO. A wave's roster is small (the real game
   only ever needs 9 body sheets plus one wraith), but evicting a sheet that
   is still on screen re-bakes it immediately and the churn shows up as a GC
   spike, so least-recently-DRAWN is the only safe policy here. */
var sheets = {}, sheetKeys = [], bakeQ = [], SHEET_MAX = 24;
var DASH_AURA = [7, 10], DASH_OFF = [];

function inkWidth(S) { return Math.max(0.85, Math.min(2.9, S * 0.078)); }

function sheetFor(shape, S, col, wraith) {
  var F = FORM[shape] || FORM.orb;
  var key = shape + '|' + (S | 0) + '|' + col + '|' + (wraith ? 1 : 0);
  var sh = sheets[key];
  if (sh) { sh.used = t; return sh.ready ? sh : null; }
  if (!doc) return null;
  var ext = F.ext * S;
  var dprc = Math.min(DPR || 1, 2);
  var ss = Math.round(Math.max(40, Math.min(288, ext * dprc)));
  var cv, c;
  try {
    cv = doc.createElement('canvas');
    cv.width = ss * F.fr; cv.height = ss;
    c = cv.getContext('2d');
    if (!c) return null;
  } catch (e) { return null; }
  sh = { cv: cv, cx: c, ss: ss, n: F.fr, ext: ext, shape: shape, S: S,
         K: makeKit(c, col, wraith, S), f: 0, ready: 0, key: key };
  sheets[key] = sh; sheetKeys.push(key);
  bakeQ.push(sh);
  while (sheetKeys.length > SHEET_MAX) {
    var old = sheetKeys.shift();
    if (old !== key && sheets[old] && sheets[old].ready) delete sheets[old];
  }
  return null;                                   /* live-drawn until it is ready */
}

/* Bake at most two gait frames per rendered frame. A whole boss strip in one
   go is a visible 16ms hitch on the frame the boss walks in; two frames is
   under a millisecond and the figure is live-drawn in the meantime. */
function pumpBakes() {
  var budget = 2, sh, sc, ow;
  while (bakeQ.length && budget-- > 0) {
    sh = bakeQ[0];
    sc = sh.ss / sh.ext; ow = inkWidth(sh.S);
    try {
      sh.cx.setTransform(sc, 0, 0, sc, (sh.f + 0.5) * sh.ss, sh.ss * 0.5);
      paintCreature(sh.shape, sh.S, sh.f / sh.n);
      paintOps(sh.cx, sh.K, ow);
    } catch (e) { }
    sh.f++;
    if (sh.f >= sh.n) {
      try { sh.cx.setTransform(1, 0, 0, 1, 0, 0); } catch (e2) { }
      sh.ready = 1; bakeQ.shift();
    }
  }
}

/* --- CONTENT lookups (read-only): behaviour class + aura radius per
   archetype, so a telegraph can look like what it is about to do. --- */
var behCache = {}, shapeSizeMap = null;
function behOf(id) {
  if (!id) return null;
  var b = behCache[id];
  if (b !== undefined) return b;
  b = null;
  try {
    var T = g.CONTENT && g.CONTENT.ENEMY_TYPES, i, j;
    for (i = 0; T && i < T.length; i++) {
      if (T[i].id !== id) continue;
      b = { charge: 0, bomb: 0, ranged: 0, aura: 0 };
      for (j = 0; j < (T[i].behaviors || []).length; j++) {
        var d = T[i].behaviors[j];
        if (d.type === 'charger') b.charge = 1;
        else if (d.type === 'bomber') b.bomb = +d.radius || 0;
        else if (d.type === 'ranged') b.ranged = +d.range || 0;
        else if (d.type === 'shielder') b.aura = +d.radius || 0;
      }
      break;
    }
  } catch (e) { b = null; }
  behCache[id] = b;
  return b;
}
function shapeSize(shape) {
  if (!shapeSizeMap) {
    shapeSizeMap = {};
    try {
      var T = g.CONTENT && g.CONTENT.ENEMY_TYPES;
      for (var i = 0; T && i < T.length; i++)
        if (shapeSizeMap[T[i].shape] == null) shapeSizeMap[T[i].shape] = T[i].size;
    } catch (e) { }
  }
  var s = shapeSizeMap[shape];
  return (s && isFinite(s)) ? s : 16;
}

/* --- per-enemy animation state, held weakly off the enemy object --- */
var anim = (typeof g.WeakMap === 'function') ? new g.WeakMap() : null;
var animFallback = { u: 0, face: 1, hp: -1, hit: 0, tt: 0 };
function animOf(e) {
  if (!anim) return animFallback;
  var r = anim.get(e);
  if (!r) {
    var seed = ((e.uid | 0) * 0.61803399) % 1;
    r = { u: seed, face: (e.vx || 0) < 0 ? -1 : 1, hp: e.hp, hit: 0, ph: seed * TAU, tt: -1 };
    anim.set(e, r);
  }
  return r;
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

/* blit one gait frame of a baked sheet, in the caller's local transform */
function blitSheet(sh, fi, a, comp) {
  var h = sh.ext * 0.5;
  if (comp) ctx.globalCompositeOperation = 'lighter';
  if (a !== 1) ctx.globalAlpha = a;
  ctx.drawImage(sh.cv, ((fi % sh.n) + sh.n) % sh.n * sh.ss, 0, sh.ss, sh.ss, -h, -h, h * 2, h * 2);
  if (a !== 1) ctx.globalAlpha = 1;
  if (comp) ctx.globalCompositeOperation = 'source-over';
}

/* ---------------------------------------------------------------------------
   drawEnemy — one figure, one frame.

   Cheap path (every ordinary enemy): shadow ellipse + one drawImage of the
   baked gait frame, under a translate/scale that carries facing, hover, the
   hit pop and the telegraph crouch. Everything else is opt-in.

   Live path (bosses, and anything mid-telegraph): the same paintCreature
   display list drawn straight to the arena, so the pose can be continuous
   and the windup can lean, stretch and aim.
   --------------------------------------------------------------------------- */
function drawEnemy(e, pal, ptx, pty) {
  var S = e.size || 12, x = e.x, y = e.y;
  var wraith = !!e.isWraith, boss = !!e.isBoss;
  var col = e.color || pal.accent;
  var shape = FORM[e.shape] ? e.shape : 'orb';
  var F = FORM[shape];
  var r = animOf(e);
  var c = ctx, i;

  var vx = e.vx || 0, vy = e.vy || 0;
  var sp = Math.sqrt(vx * vx + vy * vy);

  /* gait: rate follows real speed, with a floor so an idle creature breathes */
  r.u += (0.7 + Math.min(3.4, sp / 62)) * dt;
  if (r.u >= 1 || r.u < 0) r.u -= Math.floor(r.u);

  /* facing: eased through zero, so a turn reads as a turn */
  if (F.or === 1) {
    var want = vx < -5 ? -1 : vx > 5 ? 1 : (r.face >= 0 ? 1 : -1);
    r.face += (want - r.face) * Math.min(1, dt * 11);
    if (r.face > -0.09 && r.face < 0.09) r.face = r.face < 0 ? -0.09 : 0.09;
  }

  /* hit reaction: hp falling is the only signal sim gives, and it is enough */
  if (r.hp >= 0 && e.hp < r.hp - 0.01) r.hit = 1;
  r.hp = e.hp;
  if (r.hit > 0) { r.hit -= dt * 5.2; if (r.hit < 0) r.hit = 0; }

  /* telegraph: 0 at the start of the windup, 1 at the moment it lands */
  var tmax = e.telegraphMax > 0 ? e.telegraphMax : 0;
  var tleft = e.telegraph > 0 ? e.telegraph : 0;
  var winding = tleft > 0.0001;
  var k = (winding && tmax > 0) ? Math.max(0, Math.min(1, 1 - tleft / tmax)) : 0;
  if (winding && tmax <= 0) k = 0.5;

  var kit = liveKit(col, wraith, S);
  var hov = F.hov ? Math.sin(t * 2.6 + r.ph) * S * F.hov : 0;

  /* --- wraith echoes: the same body, dragged behind the true position --- */
  if (wraith) {
    var tr = trailOf(e), gmax = lowFx() ? 2 : 4, gx, gy, idx;
    var gsh = sheetFor(shape, S, col, 1);
    if (gsh) {
      for (i = gmax; i >= 1; i--) {
        if (tr.n > i && tr.x) { idx = (tr.i - i + 8) % 8; gx = tr.x[idx]; gy = tr.y[idx]; }
        else { gx = x - vx * 0.035 * i; gy = y - vy * 0.035 * i; }
        c.save();
        c.translate(gx + Math.sin(t * 11 + i) * 1.2, gy + hov);
        if (F.or === 2) c.rotate(Math.atan2(vy, vx || 0.0001)); else c.scale(r.face || 1, 1);
        blitSheet(gsh, (r.u * gsh.n | 0) - i, 0.26 - i * 0.05, 0);
        c.restore();
      }
    }
  }

  /* --- ground contact. A wraith's shadow falls the wrong way, upward. --- */
  c.fillStyle = wraith ? 'rgba(150,180,220,0.13)' : 'rgba(0,0,0,0.34)';
  c.beginPath();
  if (wraith) c.ellipse(x, y - S * 0.95, S * 0.6, S * 0.17, 0, 0, TAU);
  else c.ellipse(x, y + S * (F.hov ? 1.15 : 1.0), S * (0.62 - hov * 0.006), S * 0.19, 0, 0, TAU);
  c.fill();

  /* --- slowed: a frost bracket at the feet. Shape, not just colour. --- */
  if (e.slowMult != null && e.slowMult < 0.99) {
    c.strokeStyle = 'rgba(147,220,255,0.75)'; c.lineWidth = Math.max(1.2, S * 0.09);
    c.beginPath(); c.arc(x, y + S * 0.55, S * 0.85, 0.55, 2.59); c.stroke();
  }

  /* --- shielder aura: the radius is the fight, so draw the radius --- */
  var beh = behOf(e.archetypeId);
  if (beh && beh.aura > 0 && !lowFx()) {
    c.strokeStyle = rgba(kit.base, 0.16 + 0.06 * Math.sin(t * 1.8 + r.ph));
    c.lineWidth = 1.5;
    c.setLineDash([7, 10]);
    c.beginPath(); c.arc(x, y, beh.aura, t * 0.18, t * 0.18 + TAU); c.stroke();
    c.setLineDash([]);
  }

  /* --- the body --- */
  var live = boss || winding;
  var sh = live ? null : sheetFor(shape, S, col, wraith ? 1 : 0);
  if (!sh) live = true;

  /* squash & stretch. Hits pop; a windup crouches then throws itself forward. */
  var anticip = winding ? Math.sin(k * 3.14159) : 0;
  var release = winding ? Math.pow(k, 7) : 0;
  var sx = 1 + r.hit * 0.13 - anticip * 0.14 + release * 0.26;
  var sy = 1 + r.hit * 0.13 + anticip * 0.11 - release * 0.16;
  var breathe = boss ? 1 + 0.03 * Math.sin(t * 2.4) : 1;
  sx *= breathe; sy *= breathe;

  c.save();
  c.translate(x + (winding && !lowFx() ? (Math.random() - 0.5) * k * S * 0.09 : 0), y + hov);
  if (F.or === 2) c.rotate(Math.atan2(vy, vx || 0.0001));
  else c.scale(r.face || 1, 1);
  c.scale(sx, sy);

  if (live) {
    var lw = inkWidth(S);
    opClear();
    paintCreature(shape, S, r.u);
    paintOps(c, kit, lw);
    if (r.hit > 0.02) { c.globalAlpha = r.hit * 0.45; paintOps(c, HITKIT, lw * 0.5); c.globalAlpha = 1; }
  } else {
    blitSheet(sh, r.u * sh.n | 0, 1, 0);
    if (r.hit > 0.02) blitSheet(sh, r.u * sh.n | 0, r.hit * 0.85, 1);   /* additive flash */
  }
  c.restore();

  /* --- what the windup is FOR. Reads before the hit lands, every time. --- */
  if (winding) {
    var aim = Math.atan2((pty == null ? y : pty) - y, (ptx == null ? x : ptx) - x);
    var ca = Math.cos(aim), sa = Math.sin(aim);
    if (!beh || beh.charge) {
      /* charge lane: step sideways, not back */
      var lane = 210 + S * 2, hw = S * (0.5 + k * 0.35);
      c.globalAlpha = 0.08 + k * 0.24;
      c.fillStyle = kit.glow;
      c.beginPath();
      c.moveTo(x - sa * hw, y + ca * hw);
      c.lineTo(x + sa * hw, y - ca * hw);
      c.lineTo(x + ca * lane + sa * hw * 0.25, y + sa * lane - ca * hw * 0.25);
      c.lineTo(x + ca * lane - sa * hw * 0.25, y + sa * lane + ca * hw * 0.25);
      c.closePath(); c.fill();
      c.globalAlpha = 1;
      /* the lance itself, aimed at the player rather than at its facing */
      if (shape === 'spike' || shape === 'crown') {
        var reach = S * (1.5 + k * 1.1);
        c.strokeStyle = kit.glow; c.lineWidth = Math.max(2, S * 0.16);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x + ca * S * 0.2, y + sa * S * 0.2);
        c.lineTo(x + ca * reach, y + sa * reach);
        c.stroke(); c.lineCap = 'butt';
      }
    } else if (beh.bomb) {
      c.strokeStyle = rgba(C_DANGER, 0.35 + k * 0.5);
      c.lineWidth = 2 + k * 3;
      c.beginPath(); c.arc(x, y, beh.bomb * (0.3 + k * 0.7), 0, TAU); c.stroke();
    } else {
      c.strokeStyle = rgba(kit.glow, 0.3 + k * 0.55);
      c.lineWidth = 1.5 + k * 2.5;
      c.beginPath(); c.arc(x, y, S * (2.0 - k * 0.9), 0, TAU); c.stroke();
      if (beh.ranged) {
        c.globalAlpha = 0.16 + k * 0.3;
        c.beginPath(); c.moveTo(x, y);
        c.lineTo(x + ca * beh.ranged, y + sa * beh.ranged); c.lineWidth = 1.5; c.stroke();
        c.globalAlpha = 1;
      }
    }
  }

  /* --- boss regalia: tick ring + counter-rotating arc --- */
  if (boss) {
    var ba = t * 0.55, aa;
    c.strokeStyle = rgba(lighten(col, 40), 0.5); c.lineWidth = 2;
    for (i = 0; i < 8; i++) {
      aa = ba + i * 0.7854;
      c.beginPath();
      c.moveTo(x + Math.cos(aa) * S * 1.42, y + Math.sin(aa) * S * 1.42);
      c.lineTo(x + Math.cos(aa) * S * 1.62, y + Math.sin(aa) * S * 1.62);
      c.stroke();
    }
    c.strokeStyle = rgba(C_GOLD, 0.3); c.lineWidth = 1.5;
    c.beginPath(); c.arc(x, y, S * 1.76, -t * 0.4, -t * 0.4 + 4.6); c.stroke();
  }

  /* --- HP bar: only when damaged (always for bosses). Never colour alone —
         the bar shortens, and bosses get a wider, gold-framed bar. --- */
  var hp = e.hp, mx = e.maxHp || e.hp || 1;
  if (hp != null && mx > 0 && (hp < mx - 0.001 || boss)) {
    var bw2 = boss ? 56 : 40, frac = Math.max(0, Math.min(1, hp / mx));
    var byy = y - S * (boss ? 1.6 : 1.45) - (boss ? 14 : 8), bh3 = boss ? 5 : 4;
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

/* flat white kit, used to flash a live-drawn body on a hit */
var HITKIT = { c: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'],
               ink: '#ffffff', base: '#ffffff', glow: '#ffffff', hi: '#ffffff', dk: '#ffffff' };

/* ---------------------------------------------------------------------------
   Death beat. A kill flashes the creature's own silhouette white, then
   collapses it — so a death is legible as "that thing, gone" without reading
   the number that floated off it.
   --------------------------------------------------------------------------- */
var CO = new Array(10);
for (var ci0 = 0; ci0 < 10; ci0++) CO[ci0] = { on: 0, x: 0, y: 0, shape: 'orb', S: 16, col: '#fff', life: 0, max: 1, face: 1 };
function corpse(x, y, shape, col, face) {
  var e = null, i, worst = null;
  for (i = 0; i < 10; i++) {
    if (!CO[i].on) { e = CO[i]; break; }
    if (!worst || CO[i].life < worst.life) worst = CO[i];
  }
  if (!e) e = worst;
  e.on = 1; e.x = x; e.y = y;
  e.shape = FORM[shape] ? shape : 'orb';
  e.S = shapeSize(shape); e.col = col || '#c4b5fd';
  e.life = e.max = 0.42; e.face = face || 1;
}
function drawCorpses() {
  var i, e, c = ctx, f, sh;
  for (i = 0; i < 10; i++) {
    e = CO[i]; if (!e.on) continue;
    f = e.life / e.max;
    sh = sheets[e.shape + '|' + (e.S | 0) + '|' + e.col + '|0'];
    if (!sh) continue;
    c.save();
    c.translate(e.x, e.y);
    c.scale(e.face * (1 + (1 - f) * 0.5), Math.max(0.06, f * 0.85 + 0.15));
    blitSheet(sh, 0, f * 0.9, f > 0.72 ? 1 : 0);
    c.restore();
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
      corpse(kx, ky, ev.shape, kc, kx < px ? 1 : -1);
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
  for (i = 0; i < 10; i++) { if (CO[i].on) { CO[i].life -= dt; if (CO[i].life <= 0) CO[i].on = 0; } }
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

/* comet sprite cache — the tail gradient is baked once per colour instead of
   being rebuilt per projectile per frame (which is what this used to do). */
var cometCache = {}, cometN = 0;
function cometSprite(col) {
  var s = cometCache[col];
  if (s) return s;
  if (!doc) return null;
  var CW = 96, CH = 32, cv = doc.createElement('canvas');
  cv.width = CW; cv.height = CH;
  var c = cv.getContext('2d');
  try {
    var gr = c.createLinearGradient(0, 0, CW, 0);
    gr.addColorStop(0, rgba(col, 0));
    gr.addColorStop(0.72, rgba(col, 0.75));
    gr.addColorStop(1, col);
    c.fillStyle = gr;
  } catch (e) { c.fillStyle = col; }
  c.beginPath(); c.ellipse(CW * 0.72, CH / 2, CW * 0.72, CH * 0.34, 0, 0, TAU); c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath(); c.arc(CW * 0.78, CH / 2, CH * 0.24, 0, TAU); c.fill();
  if (cometN > 14) { cometCache = {}; cometN = 0; }
  cometCache[col] = cv; cometN++;
  return cv;
}
function drawProjectiles(list) {
  var c = ctx, i, p;
  for (i = 0; i < list.length; i++) {
    p = list[i];
    if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
    var vx = p.vx || 0, vy = p.vy || 0;
    var sp = Math.sqrt(vx * vx + vy * vy);
    var r = p.r || 4;
    var len = Math.min(sp * 0.05, 22) + r * 2.4;
    var col = p.col || '#c4b5fd';
    var s = cometSprite(col);
    drawGlowAdd(col, p.x, p.y, r * 4.2, 0.45);
    if (!s) continue;
    c.save();
    c.translate(p.x, p.y); c.rotate(Math.atan2(vy, vx));
    c.globalCompositeOperation = 'lighter';
    c.drawImage(s, -len * 1.39 + r * 0.55, -r * 1.3, len * 1.39, r * 2.6);
    c.globalCompositeOperation = 'source-over';
    c.restore();
  }
}

/* ---------------------------------------------------------------- *
 * Familiar. Drawn under the player so it never hides the thing you
 * are actually steering, and animated off its own `bob` clock so it
 * reads as alive while hovering.
 * ---------------------------------------------------------------- */
function drawPet(pet, pal) {
  if (!pet || !isFinite(pet.x) || !isFinite(pet.y)) return;
  var c = ctx, px = pet.x, py = pet.y;
  var col = pet.color || '#fbbf24';
  var bob = Math.sin((pet.bob || 0) * 3.4) * 3;
  var facing = (pet.vx || 0) < -6 ? -1 : 1;
  var moving = Math.abs(pet.vx || 0) + Math.abs(pet.vy || 0) > 20;

  /* collect radius: faint, and only while there is something to collect */
  if (pet.collectR > 0) {
    c.beginPath(); c.arc(px, py, pet.collectR, 0, 6.2832);
    c.strokeStyle = rgba(col, 0.10 + 0.05 * Math.sin((pet.bob || 0) * 2));
    c.lineWidth = 1;
    c.setLineDash([4, 7]);
    c.stroke();
    c.setLineDash([]);
  }

  c.fillStyle = 'rgba(0,0,0,0.32)';
  c.beginPath(); c.ellipse(px, py + 13, 8, 3, 0, 0, 6.2832); c.fill();
  drawGlowAdd(col, px, py + bob, 26, 0.42);

  c.save();
  c.translate(px, py + bob);
  c.scale(facing, 1);

  if (pet.shape === 'hound') {
    /* low four-legged body, head forward, tail up */
    var gait = moving ? Math.sin((pet.bob || 0) * 14) : 0;
    c.strokeStyle = col; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath();                                   // legs
    c.moveTo(-4, 3); c.lineTo(-6 + gait * 2, 9);
    c.moveTo(3, 3); c.lineTo(5 - gait * 2, 9);
    c.stroke();
    c.fillStyle = col;
    c.beginPath(); c.ellipse(0, 0, 9, 5, 0, 0, 6.2832); c.fill();   // body
    c.beginPath(); c.ellipse(8, -3, 4.5, 3.5, 0, 0, 6.2832); c.fill(); // head
    c.beginPath();                                   // ears + tail
    c.moveTo(7, -6); c.lineTo(9, -10); c.lineTo(10.5, -6); c.closePath(); c.fill();
    c.strokeStyle = col; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-8, -1); c.quadraticCurveTo(-13, -4 + gait * 2, -12, -8); c.stroke();
    c.fillStyle = '#1a0030';                          // eye
    c.beginPath(); c.arc(9.5, -3.5, 1.1, 0, 6.2832); c.fill();

  } else if (pet.shape === 'lantern') {
    /* hanging lamp with a slow swing and a live flame */
    var sway = Math.sin((pet.bob || 0) * 2.2) * 0.22;
    c.rotate(sway);
    c.strokeStyle = rgba(col, 0.8); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -14); c.lineTo(0, -8); c.stroke();
    c.beginPath(); c.arc(0, -15, 3, 0.9, 2.3); c.stroke();          // hook
    c.fillStyle = rgba(col, 0.30);
    c.beginPath();                                                  // glass body
    c.moveTo(-6, -8); c.lineTo(6, -8); c.lineTo(7, 6); c.lineTo(-7, 6); c.closePath();
    c.fill();
    c.strokeStyle = col; c.lineWidth = 1.6; c.stroke();
    var fl = 3 + Math.sin((pet.bob || 0) * 11) * 1.1;               // flame
    c.fillStyle = lighten(col, 70);
    c.beginPath(); c.ellipse(0, 1, 2.2, fl, 0, 0, 6.2832); c.fill();

  } else {
    /* moth: two wing pairs beating, furred body */
    var beat = Math.sin((pet.bob || 0) * (moving ? 19 : 9));
    var span = 8 + beat * 4;
    c.fillStyle = rgba(col, 0.85);
    c.beginPath(); c.ellipse(-span * 0.7, -2, span, 5.5, -0.5, 0, 6.2832); c.fill();
    c.beginPath(); c.ellipse(span * 0.7, -2, span, 5.5, 0.5, 0, 6.2832); c.fill();
    c.fillStyle = rgba(col, 0.55);
    c.beginPath(); c.ellipse(-span * 0.55, 3, span * 0.7, 3.5, -0.3, 0, 6.2832); c.fill();
    c.beginPath(); c.ellipse(span * 0.55, 3, span * 0.7, 3.5, 0.3, 0, 6.2832); c.fill();
    c.fillStyle = lighten(col, 40);
    c.beginPath(); c.ellipse(0, 0, 2.6, 6, 0, 0, 6.2832); c.fill();  // body
    c.strokeStyle = col; c.lineWidth = 1;
    c.beginPath();                                                   // antennae
    c.moveTo(-1, -5); c.lineTo(-3.5, -9);
    c.moveTo(1, -5); c.lineTo(3.5, -9);
    c.stroke();
  }
  c.restore();
}

/* ---------------------------------------------------------------------------
   The player: a hooded delver, not a disc with an emoji on it.

   Drawn live every frame — there is exactly one — so the run cycle, the
   cloak drag and the weapon hand can all follow real velocity. Body radius
   stays 16 (= Sim T.PLAYER_R), so what you see is what collides.
   --------------------------------------------------------------------------- */
var plGait = 0, plFace = 1, plLean = 0, plKit = null, plKitCol = '';

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

  var vx = pl.vx || 0, vy = pl.vy || 0;
  var sp = Math.sqrt(vx * vx + vy * vy);
  var run = Math.min(1, sp / 190);
  var S = 16;

  /* gait + eased facing + a lean into the run */
  plGait += (0.9 + run * 4.6) * dt;
  if (plGait >= 1) plGait -= Math.floor(plGait);
  var want = vx < -6 ? -1 : vx > 6 ? 1 : (plFace >= 0 ? 1 : -1);
  plFace += (want - plFace) * Math.min(1, dt * 13);
  if (plFace > -0.1 && plFace < 0.1) plFace = plFace < 0 ? -0.1 : 0.1;
  plLean += ((run * 0.16) - plLean) * Math.min(1, dt * 8);

  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.beginPath(); c.ellipse(px, py + S * 1.15, S * 0.82, S * 0.24, 0, 0, TAU); c.fill();

  drawGlowAdd(col, px, py, 40, 0.42);

  if (plKitCol !== col) { plKit = makeKit(c, col, false, S); plKitCol = col; }
  var K = plKit;
  var u = plGait, swg = Math.sin(u * TAU), swg2 = -swg;
  var bob = -Math.abs(swg) * S * 0.09 * (0.4 + run);
  var drag = -plFace * (0.1 + run * 0.55);          /* cloak trails the run */

  opClear();
  /* back leg + back arm */
  LN(-S * 0.06, S * 0.24 + bob, -S * 0.10 + swg2 * S * 0.5 * (0.35 + run), S * 1.02, S * 0.19, 0);
  CV(-S * 0.04, -S * 0.36 + bob, -S * 0.38, -S * 0.02 + bob,
     -S * 0.26 - swg * S * 0.26 * run, S * 0.5 + bob, S * 0.14, 0);
  /* cloak, dragged opposite to travel and rippling on the run */
  PY([-S * 0.30, -S * 0.62 + bob, S * 0.26, -S * 0.60 + bob,
      S * 0.10 + drag * S * 1.2, S * 0.34 + bob,
      S * 0.30 + drag * S * 2.1, S * 1.06 + swg * S * 0.12,
      -S * 0.12 + drag * S * 1.5, S * 0.86 + bob,
      -S * 0.44 + drag * S * 0.5, S * 0.30 + bob], 0);
  /* torso */
  PY([-S * 0.30, S * 0.28 + bob, -S * 0.34, -S * 0.32 + bob, -S * 0.10, -S * 0.70 + bob,
      S * 0.26, -S * 0.66 + bob, S * 0.36, -S * 0.06 + bob, S * 0.26, S * 0.30 + bob], 1);
  /* front leg */
  LN(S * 0.08, S * 0.24 + bob, S * 0.14 + swg * S * 0.5 * (0.35 + run), S * 1.02, S * 0.21, 5);
  /* hood */
  PY([-S * 0.34, -S * 0.34 + bob, -S * 0.26, -S * 0.94 + bob, S * 0.12, -S * 1.22 + bob,
      S * 0.46, -S * 0.86 + bob, S * 0.42, -S * 0.30 + bob], 2);
  PY([-S * 0.10, -S * 0.50 + bob, -S * 0.04, -S * 0.88 + bob, S * 0.34, -S * 0.82 + bob,
      S * 0.34, -S * 0.46 + bob], 14);
  EL(S * 0.10, -S * 0.66 + bob, S * 0.07, S * 0.055, 0, 13);
  EL(S * 0.26, -S * 0.68 + bob, S * 0.07, S * 0.055, 0, 13);
  /* weapon arm, held forward, carrying the Focus light */
  CV(S * 0.24, -S * 0.34 + bob, S * 0.72, -S * 0.30 + bob, S * 0.82, S * 0.02 + bob, S * 0.16, 5);
  EL(S * 0.94, S * 0.06 + bob, S * 0.19, S * 0.19, 0, 3);

  c.save();
  c.translate(px, py);
  c.rotate(plLean * (plFace >= 0 ? 1 : -1) * 0.5);
  c.scale(plFace, 1);
  paintOps(c, K, 1.25);
  c.restore();

  /* the Focus light itself, additive so it sits on top of the veil tint */
  var ha = Math.atan2(vy, vx || 0.0001);
  drawGlowAdd(lighten(col, 120), px + plFace * S * 0.94, py + S * 0.06 + bob, 13,
              0.4 + 0.16 * Math.sin(t * 5));

  /* heading tick — direction stays readable even when facing is only ±1 */
  if (sp > 12) {
    c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(px + Math.cos(ha) * 20, py + Math.sin(ha) * 20);
    c.lineTo(px + Math.cos(ha) * 27, py + Math.sin(ha) * 27);
    c.stroke(); c.lineCap = 'butt';
  }
}

/* --- background: gradient + baked hex grid + dust --- */
function drawBackground(pal) {
  var c = ctx, i;
  ensureGradients(pal);
  c.fillStyle = bgGrad;
  c.fillRect(-30, -30, W + 60, H + 60);

  /* terrain sits under the lattice; re-baked only when the rift or size moves */
  var tk = curRift + ':' + Math.round(W) + 'x' + Math.round(H) + ':' + DPR;
  if (tk !== terrKey) { terrKey = tk; buildTerrain(curRift, pal); }
  if (terrCanvas && terrCanvas.width > 1) {
    c.globalAlpha = lowFx() ? 0.5 : 0.85;
    c.drawImage(terrCanvas, 0, 0, W, H);
    c.globalAlpha = 1;
  }

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
  curRift = typeof st.riftId === 'string' ? st.riftId : '';
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
  pumpBakes();                        /* creature sheets, two gait frames a go */
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

  /* enemy backlight — one additive blit each, no shadowBlur anywhere. Kept
     tight so it separates a figure from the ground without eating its
     contour; the creatures carry their own read now. */
  var glowBudget = lowFx() ? 26 : 60;
  c.globalCompositeOperation = 'lighter';
  for (i = 0; i < enemies.length && i < glowBudget; i++) {
    var en = enemies[i];
    if (!en || !isFinite(en.x) || !isFinite(en.y)) continue;
    if (en.x < -60 || en.y < -60 || en.x > W + 60 || en.y > H + 60) continue;
    drawGlow(en.isWraith ? C_WRAITH : (en.color || pal.accent), en.x, en.y,
             (en.size || 12) * (en.isBoss ? 3.0 : 1.9), en.isBoss ? 0.6 : 0.38);
  }
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;

  drawCorpses();

  /* enemy bodies */
  var ptx = (st.player && isFinite(st.player.x)) ? st.player.x : W / 2;
  var pty = (st.player && isFinite(st.player.y)) ? st.player.y : H / 2;
  for (i = 0; i < enemies.length; i++) {
    var e3 = enemies[i];
    if (!e3 || !isFinite(e3.x) || !isFinite(e3.y)) continue;
    if (e3.x < -110 || e3.y < -110 || e3.x > W + 110 || e3.y > H + 110) continue;
    try { drawEnemy(e3, pal, ptx, pty); } catch (err) { }
  }

  drawParticles();
  drawProjectiles(projectiles);
  try { drawPet(st.pet, pal); } catch (err) { }
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
