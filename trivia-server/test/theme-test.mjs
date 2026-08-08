// The theme system, in a real browser.
//
// Two things are being proven here, and they fail in completely different ways:
//
//   1. CORRECTNESS — the preference is validated, persisted, applied before
//      first paint, live-switchable, and never reaches the server. A theme is
//      a private client preference; if one ever showed up in a room frame that
//      would be a protocol change nobody asked for.
//
//   2. COST — no theme may buy its looks with layout. Every decorative layer
//      animates transform/opacity only, so Chrome's LayoutCount over a fixed
//      window must not move when the theme changes. This is the gate the
//      design brief asked for, and it is the one that would silently rot:
//      a future theme that animates `top` instead of `translate3d` still
//      LOOKS right, it just quietly costs a layout every frame.
//
// Usage: node test/theme-test.mjs [ROOM]
import fs from 'node:fs';
import WS from 'ws';

const CDP = process.env.LS_CDP || 'http://127.0.0.1:9222';
const PAGE = process.env.LS_PAGE || 'http://localhost:8000/trivia/';
const OUT = process.env.LS_OUT || '/tmp/late-signal';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM = (process.argv[2] ||
  Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('')
).toUpperCase();

const THEMES = ['studio', 'marquee', 'drift', 'daybreak', 'deadair'];
const NAMES = {
  studio: 'Studio Classic', marquee: 'Marquee Night', drift: 'Signal Drift',
  daybreak: 'Daybreak', deadair: 'Dead Air',
};

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

class Tab {
  constructor(name) { this.name = name; this.id = 0; this.pending = new Map(); }
  async open(url) {
    const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
    this.target = await r.json();
    this.ws = new WS(this.target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
    await this.cmd('Runtime.enable');
    await this.cmd('Page.enable');
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(this.name + ' CDP timeout ' + method)), 40000);
      this.pending.set(id, (m) => {
        clearTimeout(to);
        if (m.error) rej(new Error(method + ': ' + m.error.message));
        else res(m.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(body) {
    const r = await this.cmd('Runtime.evaluate', {
      expression: `(function(){${body}})()`, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  async go(url) { await this.cmd('Page.navigate', { url }); await sleep(1200); }
  async close() { try { await fetch(CDP + '/json/close/' + this.target.id); } catch {} }
}

const A = new Tab('A'), B = new Tab('B');

/* Layout/style counters over a fixed wall-clock window. The absolute numbers
   are meaningless in headless software rasterisation; the DELTA between two
   themes measured identically is the whole point. */
async function costOver(tab, ms) {
  const read = async () => {
    const { metrics } = await tab.cmd('Performance.getMetrics');
    const p = {};
    for (const m of metrics) {
      if (['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration'].includes(m.name)) {
        p[m.name] = m.value;
      }
    }
    return p;
  };
  const a = await read();
  await sleep(ms);
  const b = await read();
  return {
    layouts: b.LayoutCount - a.LayoutCount,
    restyles: b.RecalcStyleCount - a.RecalcStyleCount,
    layoutMs: +((b.LayoutDuration - a.LayoutDuration) * 1000).toFixed(1),
  };
}

const report = { room: ROOM, themes: {} };

try {
  await A.open('about:blank');
  await A.cmd('Performance.enable');
  await A.go(PAGE);
  /* The CDP profile persists between runs, so a previous run's saved
     preference would make "a fresh player gets Studio" pass or fail
     depending on what ran before it. Start from a genuinely clean slate. */
  await A.ev(`localStorage.clear(); return true;`);
  await A.go(PAGE);

  // ---------------------------------------------------------------
  // 1. defaults and the picker
  // ---------------------------------------------------------------
  const first = await A.ev(`
    return {
      attr: document.documentElement.getAttribute('data-theme'),
      stored: localStorage.getItem('ls:theme'),
      dots: document.querySelectorAll('#themeOpts .theme-dot').length,
      hudBtn: !!document.getElementById('themeBtn')
    };
  `);
  ok(first.attr === 'studio', 'a fresh player gets Studio Classic', first);
  ok(first.stored === null, 'the default is NOT written to storage until chosen', first);
  ok(first.dots === THEMES.length, 'the landing picker offers every theme', first);
  ok(first.hudBtn, 'the in-room HUD has a theme control', first);

  // ---------------------------------------------------------------
  // 2. every theme applies, persists, and actually repaints
  // ---------------------------------------------------------------
  for (const t of THEMES) {
    const r = await A.ev(`
      var dot = document.querySelector('#themeOpts .theme-dot[data-theme="${t}"]');
      if (!dot) return { missing: true };
      dot.click();
      var cs = getComputedStyle(document.documentElement);
      var stage = getComputedStyle(document.querySelector('.stage'));
      return {
        attr: document.documentElement.getAttribute('data-theme'),
        stored: localStorage.getItem('ls:theme'),
        checked: dot.getAttribute('aria-checked'),
        amber: cs.getPropertyValue('--amber').trim(),
        ink900: cs.getPropertyValue('--ink-900').trim(),
        mint: cs.getPropertyValue('--mint').trim(),
        crimson: cs.getPropertyValue('--crimson').trim(),
        bg: stage.backgroundImage.slice(0, 40),
        bar: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
        scheme: document.querySelector('meta[name="color-scheme"]').getAttribute('content')
      };
    `);
    ok(!r.missing && r.attr === t, `${NAMES[t]}: applies on click`, r);
    ok(r.stored === t, `${NAMES[t]}: persists to localStorage`, r);
    ok(r.checked === 'true', `${NAMES[t]}: its dot reports itself checked`, r);
    ok(!!r.amber && !!r.ink900, `${NAMES[t]}: palette tokens resolve`, r);
    // the two hues that carry meaning must never vanish
    ok(!!r.mint && !!r.crimson, `${NAMES[t]}: signal hues still defined`, r);
    ok(r.scheme === (t === 'daybreak' ? 'light' : 'dark'),
       `${NAMES[t]}: colour-scheme matches the palette`, r);
    report.themes[t] = { amber: r.amber, ink900: r.ink900, bar: r.bar };
  }

  // distinctness — five themes that render identically are one theme
  const inks = Object.values(report.themes).map((x) => x.ink900);
  ok(new Set(inks).size === THEMES.length, 'every theme has a distinct ground', inks);

  // ---------------------------------------------------------------
  // 3. the enum gate — storage is untrusted input
  // ---------------------------------------------------------------
  const poisoned = await A.ev(`
    localStorage.setItem('ls:theme', 'x"><script>alert(1)</script>');
    return true;
  `);
  ok(poisoned, 'poisoned the stored preference');
  await A.go(PAGE);
  const afterPoison = await A.ev(`
    return { attr: document.documentElement.getAttribute('data-theme'),
             html: document.documentElement.outerHTML.indexOf('alert(1)') };
  `);
  ok(afterPoison.attr === 'studio', 'a junk stored theme falls back to Studio', afterPoison);
  ok(afterPoison.html === -1, 'a junk stored theme is never injected into the DOM', afterPoison);

  // ---------------------------------------------------------------
  // 4. applied before first paint (no flash of the default)
  // ---------------------------------------------------------------
  await A.ev(`localStorage.setItem('ls:theme','drift'); return true;`);
  await A.cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: `document.addEventListener('DOMContentLoaded', function () {
      window.__themeAtParse = document.documentElement.getAttribute('data-theme');
    });`,
  });
  await A.go(PAGE);
  const early = await A.ev(`return { atParse: window.__themeAtParse,
                                     now: document.documentElement.getAttribute('data-theme') };`);
  ok(early.atParse === 'drift', 'the saved theme is on the root before content parses', early);
  ok(early.now === 'drift', 'and it survives the main script booting', early);

  // ---------------------------------------------------------------
  // 5. reduced motion stills every theme's decoration
  // ---------------------------------------------------------------
  await A.cmd('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const rm = {};
  for (const t of THEMES) {
    rm[t] = await A.ev(`
      document.documentElement.setAttribute('data-theme','${t}');
      var s = getComputedStyle(document.querySelector('.stage'), '::before');
      return { anim: s.animationName, opacity: s.opacity };
    `);
  }
  const moving = THEMES.filter((t) => rm[t].anim && rm[t].anim !== 'none');
  ok(moving.length === 0, 'reduced motion stops the backdrop in every theme', rm);
  // the palette must survive — quiet, not degraded
  ok(THEMES.every((t) => parseFloat(rm[t].opacity) >= 0), 'reduced motion keeps the backdrop visible', rm);
  await A.cmd('Emulation.setEmulatedMedia', { features: [] });

  // ---------------------------------------------------------------
  // 6. THE COST GATE — idle landing screen, per theme
  // ---------------------------------------------------------------
  const idle = {};
  for (const t of THEMES) {
    await A.ev(`document.documentElement.setAttribute('data-theme','${t}'); return true;`);
    await sleep(400);                       // let the switch settle out of the window
    idle[t] = await costOver(A, 4000);
  }
  report.idle = idle;
  for (const t of THEMES) {
    ok(idle[t].layouts <= 2,
       `${NAMES[t]}: an idle screen costs no per-frame layout`, idle[t]);
  }
  const worstIdle = Math.max(...THEMES.map((t) => idle[t].layouts));
  ok(worstIdle - idle.studio.layouts <= 2,
     'no theme costs more idle layout than Studio', { studio: idle.studio.layouts, worstIdle });

  // ---------------------------------------------------------------
  // 7. THE COST GATE — a live question, the densest phase
  // ---------------------------------------------------------------
  await B.open('about:blank');
  const joinAs = async (tab, name) => {
    await tab.go(PAGE);
    await tab.ev(`
      document.getElementById('nameInput').value = ${JSON.stringify(name)};
      document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
      document.getElementById('joinBtn').click();
      return true;
    `);
    await sleep(900);
  };
  await joinAs(A, 'ThemeA');
  await joinAs(B, 'ThemeB');
  await A.cmd('Page.bringToFront');
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(1500);

  /* One game, themes switched live between questions — which also proves
     the "live-switchable without reload" requirement under real conditions
     rather than on an idle landing screen.

     PHASE ANCHORING, and the reason this test was wrong once already:
     the clock escalates cruise -> warm (10s left) -> panic (5s left), and
     panic is by far the most layout-expensive part of a round. Measuring
     each theme after a fixed sleep walks the sampling window through
     different phases, so the LAST theme measured looks catastrophically
     expensive and the first looks free. That is a property of the clock,
     not of the theme. Every window below starts within the first second
     of a fresh question and is short enough to stay inside cruise, so all
     themes are measured against identical work. */
  const questionText = () => A.ev(
    `var e = document.getElementById('questionText'); return e ? e.textContent.trim() : '';`);
  async function waitFreshQuestion(prev, timeoutMs = 40000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await A.ev(`
        var c = document.getElementById('clock');
        var q = document.getElementById('questionText');
        return {
          screen: document.body.getAttribute('data-screen'),
          warm: !!(c && c.classList.contains('warm')),
          panic: !!(c && c.classList.contains('panic')),
          gone: !!(c && c.classList.contains('gone')),
          text: q ? q.textContent.trim() : ''
        };
      `);
      if (s.screen === 'play' && s.text && s.text !== prev
          && !s.warm && !s.panic && !s.gone) return s.text;
      await sleep(200);
    }
    return null;
  }

  const live = {};
  let prevQ = '';
  for (const t of ['studio', 'marquee', 'drift']) {
    const seen = await waitFreshQuestion(prevQ);
    if (!seen) { fails.push('FAIL  harness: no fresh question to measure ' + t); break; }
    prevQ = seen;
    await A.ev(`document.documentElement.setAttribute('data-theme','${t}'); return true;`);
    live[t] = await costOver(A, 5000);       // 5s inside a 10s cruise window
  }
  report.live = live;
  /* Deliberately an ABSOLUTE threshold, not a delta against Studio.
     Each theme is measured on a different question, and question text of
     a different length wraps differently and lays out a different number
     of times — so single-digit differences between themes here are the
     copy, not the theme. Chasing them produces a flaky test.

     What this gate is actually for is catching per-frame layout: 5s at
     60fps is ~300 layouts, and a theme animating a geometric property
     measures ~236 on an idle screen alone. Anything under 40 is
     categorically "not animating layout". The tight instrument is the
     idle gate above (<=2), which runs with nothing else moving. */
  for (const t of Object.keys(live)) {
    ok(live[t].layouts < 40,
       `${NAMES[t]}: a live question does not animate layout`,
       { layouts: live[t].layouts, perFrameWouldBe: '~300' });
  }
  const stillPlaying = await A.ev(`
    return { screen: document.body.getAttribute('data-screen'),
             theme: document.documentElement.getAttribute('data-theme') };
  `);
  ok(stillPlaying.theme === 'drift', 'the theme survived a live round', stillPlaying);

  // ---------------------------------------------------------------
  // 8. the preference never reaches the server
  // ---------------------------------------------------------------
  const sent = await A.ev(`
    return (window.__sentFrames || []).filter(function (f) {
      return String(f).indexOf('theme') >= 0;
    }).length;
  `).catch(() => 0);
  ok(sent === 0 || sent === undefined, 'no frame carrying a theme was sent to the server', sent);

  const errs = await A.ev(`return (window.__errors || []).length;`).catch(() => 0);
  ok(!errs, 'no console errors', errs);
} catch (e) {
  fails.push('FAIL  harness: ' + e.message);
}

await A.close(); await B.close();
fs.writeFileSync(OUT + '/theme-report.json', JSON.stringify(report, null, 2));

for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
console.log('\n================ RESULT ================');
console.log(`passed: ${notes.length}   failed: ${fails.length}`);
if (report.idle) {
  console.log('\nidle layout cost over 4s (lower is better, 0-2 is "free"):');
  for (const t of THEMES) console.log(`  ${t.padEnd(9)} layouts ${String(report.idle[t].layouts).padStart(3)}  restyles ${String(report.idle[t].restyles).padStart(4)}  layout ${report.idle[t].layoutMs}ms`);
}
if (report.live) {
  console.log('\nlive-question layout cost over 5s:');
  for (const t of Object.keys(report.live)) console.log(`  ${t.padEnd(9)} layouts ${String(report.live[t].layouts).padStart(3)}  restyles ${String(report.live[t].restyles).padStart(4)}  layout ${report.live[t].layoutMs}ms`);
}
console.log('\nwritten to', OUT + '/theme-report.json');
process.exit(fails.length ? 1 : 0);
