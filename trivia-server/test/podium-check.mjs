// Drives a full 10-round game to the final screen and inspects the podium.
// The e2e harness proves the game still works; this proves the medal treatment
// is actually APPLIED — computed styles, not just CSS text sitting in the file.
// Also captures console errors, which is how a broken SFX call would surface.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import WS from 'ws';

const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || 'POD1';
const SHOTS = (process.env.LS_OUT || '/tmp/late-signal') + '/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

class Tab {
  constructor(name) { this.name = name; this.id = 0; this.pending = new Map(); this.errors = []; }
  async open() {
    const r = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' });
    const t = await r.json();
    this.target = t;
    this.ws = new WS(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(m.params?.exceptionDetails?.exception?.description || 'exception');
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push((m.params.args || []).map((a) => a.value).join(' '));
      }
    });
    await this.cmd('Runtime.enable');
    await this.cmd('Page.enable');
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(this.name + ' timeout ' + method)), 40000);
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
  async shot(name) {
    const r = await this.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64'));
  }
  async close() { try { await fetch(CDP + '/json/close/' + this.target.id); } catch {} }
}

// Three players, not two: with only two there is no third place, so the
// bronze row correctly never renders and the medal cannot be tested at all.
const A = new Tab('A'), B = new Tab('B'), C = new Tab('C');

async function join(tab, name) {
  await tab.cmd('Page.navigate', { url: PAGE });
  await sleep(1300);
    // Pin the language. localStorage persists in the shared Chrome profile, so
    // a previous run that chose Spanish would otherwise silently make this one
    // a Spanish game — which then gets correctly REFUSED on a genre with no
    // Spanish, and looks like the game is broken. Same class of bug as reusing
    // room codes: shared persistent state leaking between runs.
    await tab.ev("try{localStorage.setItem('ls:lang','en')}catch(e){} return true;");
    await tab.cmd('Page.reload');
    await sleep(900);
  await tab.ev(`
    document.getElementById('nameInput').value = ${JSON.stringify(name)};
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click();
    return true;
  `);
  await sleep(900);
}

try {
  await A.open(); await B.open(); await C.open();
  await join(A, 'Ada');
  await join(B, 'Bo');
  await join(C, 'Cy');
  // Turn sound ON in A so every SFX path actually executes — a broken sound
  // call only throws when it runs.
  await A.ev("if (document.getElementById('soundBtn').getAttribute('aria-pressed') !== 'true') document.getElementById('soundBtn').click(); return true;");
  await A.cmd('Page.bringToFront');
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(2500);

  // Play all ten rounds. Fixed sleeps do not work here: the reveal holds for
  // DWELL_MS (4s) before the scoreboard, so a guessed interval drifts out of
  // sync within a couple of rounds and the run silently never finishes. Poll
  // for the state we are waiting on instead.
  const visible = (id) => `var e=document.getElementById('${id}'); return !!(e && e.offsetParent !== null);`;
  const waitFor = async (tab, body, what, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await tab.ev(body)) return true;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  for (let round = 0; round < 10; round++) {
    await waitFor(A, "return !!document.querySelector('.tile[data-i=\"0\"]:not([disabled])');", `tiles r${round + 1}`);
    // A picks 0 and B picks 1 so the scores diverge and the podium has a
    // genuine order rather than an eight-way tie.
    await A.ev("var t=document.querySelector('.tile[data-i=\"0\"]'); if(t) t.click(); return true;");
    await B.ev("var t=document.querySelector('.tile[data-i=\"1\"]'); if(t) t.click(); return true;");
    // C answers last every round, so even when it guesses right it earns fewer
    // speed points — that reliably separates second from third.
    await sleep(600);
    await C.ev("var t=document.querySelector('.tile[data-i=\"1\"]'); if(t) t.click(); return true;");

    if (round === 9) break;   // the last advance lands on the final screen
    await waitFor(A, "return !!document.querySelector('#boardActions button:not([disabled])');", `board r${round + 1}`);
    await A.ev("var b=document.querySelector('#boardActions button'); if(b) b.click(); return true;");
  }

  await waitFor(A, "return !!document.querySelector('#boardActions button:not([disabled])');", 'final board');
  await A.ev("var b=document.querySelector('#boardActions button'); if(b) b.click(); return true;");
  await waitFor(A, visible('s-final'), 'the final screen');
  // Let the podium sequence finish: bronze 300ms, silver 560ms, winner 820ms,
  // the rest from 1600ms, plus the count-up.
  await sleep(3200);

  await A.cmd('Page.bringToFront');
  await sleep(400);
  await A.shot('podium-final');

  const podium = await A.ev(`
    var out = { screen: null, rows: [] };
    var fin = document.getElementById('s-final');
    out.screen = fin ? getComputedStyle(fin).display : 'missing';
    out.winner = (document.getElementById('winnerName') || {}).textContent;
    var rows = document.querySelectorAll('#finalRest .row');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], cs = getComputedStyle(r);
      var rank = r.querySelector('.row-rank');
      var av = r.querySelector('.avatar');
      out.rows.push({
        cls: r.className,
        rank: rank ? rank.textContent : '',
        minHeight: cs.minHeight,
        boxShadow: cs.boxShadow,
        bgImage: cs.backgroundImage.slice(0, 60),
        rankSize: rank ? getComputedStyle(rank).fontSize : '',
        avShadow: av ? getComputedStyle(av).boxShadow : '',
        score: (r.querySelector('.row-score') || {}).textContent,
      });
    }
    out.scrollX = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    return out;
  `);

  const silver = podium.rows.find((r) => /\br2\b/.test(r.cls));
  const bronze = podium.rows.find((r) => /\br3\b/.test(r.cls));
  const plain = podium.rows.find((r) => !/\br[123]\b/.test(r.cls));

  ok(!!silver, 'a silver (r2) row rendered on the podium');
  ok(!!bronze, 'a bronze (r3) row rendered on the podium');

  if (silver) {
    ok(silver.boxShadow.includes('inset'), 'silver has the inset medal edge', silver.boxShadow);
    ok(silver.bgImage.includes('gradient'), 'silver has the medal wash', silver.bgImage);
    ok(parseFloat(silver.minHeight) >= 74, 'silver row is taller than a plain row', silver.minHeight);
    ok(parseFloat(silver.rankSize) >= 24, 'silver rank numeral is enlarged', silver.rankSize);
    ok(silver.avShadow && silver.avShadow !== 'none', 'silver avatar carries the medal ring', silver.avShadow);
  }
  if (bronze) {
    ok(bronze.boxShadow.includes('inset'), 'bronze has the inset medal edge', bronze.boxShadow);
    ok(bronze.boxShadow !== (silver || {}).boxShadow, 'bronze is a different metal from silver',
       { bronze: bronze.boxShadow, silver: silver && silver.boxShadow });
    ok(parseFloat(bronze.minHeight) < parseFloat(silver.minHeight),
       'the podium steps down: silver taller than bronze', { s: silver.minHeight, b: bronze.minHeight });
  }
  if (plain && silver) {
    ok(plain.boxShadow !== silver.boxShadow, 'a non-medal row is visibly distinct from silver', plain.boxShadow);
    ok(parseFloat(plain.minHeight) < parseFloat(silver.minHeight),
       'a non-medal row is shorter than silver', { plain: plain.minHeight, silver: silver.minHeight });
  }
  ok(!podium.scrollX, 'final screen still has no horizontal scroll');
  ok(silver && silver.score && silver.score !== '0', 'the silver score counted up past zero', silver && silver.score);

  const errs = [...A.errors, ...B.errors, ...C.errors].filter((e) => !/favicon|net::ERR/i.test(e));
  ok(errs.length === 0, 'no console errors with sound ON through a full game', errs.slice(0, 4));

  console.log('\nrows on the final screen:');
  for (const r of podium.rows) {
    console.log(`  ${(r.cls || '').padEnd(12)} rank ${r.rank.padEnd(3)} h=${r.minHeight.padEnd(7)} score=${r.score}`);
  }
} catch (e) {
  fails.push('FAIL  threw :: ' + e.message);
}

await A.close(); await B.close(); await C.close();
console.log('');
for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
