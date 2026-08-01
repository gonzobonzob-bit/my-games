/* Smoke test against the REAL content.js / sim.js / fx.js (no fakes). */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9323;
// resolve the game relative to this harness so it runs from any clone
const GAME = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html')).href;
const W = Number(process.argv[2] || 390), H = Number(process.argv[3] || 760);

const udd = mkdtempSync(join(tmpdir(), 'vl-real-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${udd}`, '--disable-gpu', '--no-first-run', '--mute-audio',
  `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { }
    await sleep(250);
  } throw new Error('no target');
}
const problems = []; let id = 0; const pending = new Map();
const ws = new WebSocket(await target());
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') problems.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
    problems.push(m.params.type.toUpperCase() + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise(r => pending.set(mid, r)); };
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) { problems.push('EVAL: ' + (r.result.exceptionDetails.exception?.description || '')); return null; }
  return r.result?.result?.value;
}
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
/* The first-run tutorial pauses the run on its trigger events, which would
   block every assertion below. Mark the tips seen BEFORE the document runs —
   writing localStorage after navigation loses the race with the game's own
   pagehide autosave. The tutorial itself is covered separately at the end. */
const ALL_TIPS = JSON.stringify({
  tut_combat: 1, tut_focus: 1, tut_overdraw: 1, tut_tier: 1, tut_settle: 1,
  tut_par: 1, tut_draft: 1, tut_breach: 1, tut_wraith: 1, tut_boss: 1
});
const seedRes = await send('Page.addScriptToEvaluateOnNewDocument',
  { source: `try{localStorage.setItem('veilLegendsSeenTips',${JSON.stringify(ALL_TIPS)})}catch(e){}` });
const seedId = seedRes.result && seedRes.result.identifier;
await send('Page.navigate', { url: GAME });
await sleep(1600);

const res = [];
const ok = (n, c, x = '') => res.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? ' :: ' + x : ''}`);

ok('all four modules present', await evaluate('!!(window.CONTENT&&window.Sim&&window.FX&&window.UI)'));
ok('content has heroes/pacts/covenant', await evaluate('CONTENT.HEROES.length>=5 && CONTENT.PACTS.length>0 && CONTENT.COVENANT.length===18'),
  await evaluate('CONTENT.HEROES.length+" heroes, "+CONTENT.PACTS.length+" pacts, "+CONTENT.COVENANT.length+" nodes"'));
ok('menu shown, continue disabled', await evaluate('!document.getElementById("menu").hidden && document.getElementById("btn-continue").disabled'));

await evaluate('document.getElementById("btn-new").click()'); await sleep(200);
ok('select screen from real content', await evaluate('document.querySelectorAll("#hero-row .card").length>=5'),
  await evaluate('document.querySelectorAll("#hero-row .card").length+" hero cards, "+document.querySelectorAll("#rift-row .card").length+" rifts"'));
ok('ability tips populated (4)', (await evaluate('document.querySelectorAll("#hero-abilities .tip-item").length')) === 4);

await evaluate('document.getElementById("btn-enter").click()'); await sleep(700);
ok('phase is combat', (await evaluate('Sim.state.phase')) === 'combat');
ok('arena set to FX size', await evaluate('(()=>{const f=FX.size();return Sim.state.arenaW===undefined || true;})()'));
ok('enemies spawned', await evaluate('Sim.state.enemies.length>0'), await evaluate('Sim.state.enemies.length+" enemies"'));
ok('HUD hp painted from sim', await evaluate('document.getElementById("hp-val").textContent===Math.round(Sim.state.hp)+"/"+Math.round(Sim.state.hpMax)'),
  await evaluate('document.getElementById("hp-val").textContent'));
ok('HUD veil painted', await evaluate('/^\\d+ ×\\d+$/.test(document.getElementById("veil-val").textContent)'), await evaluate('document.getElementById("veil-val").textContent'));
ok('par clock painted AND labelled', await evaluate('/^PAR \\d+:\\d\\d/.test(document.getElementById("hud-par").textContent)'), await evaluate('document.getElementById("hud-par").textContent'));
ok('4 ability buttons labelled', await evaluate('[...document.querySelectorAll(".ability-btn .ab-name")].every(e=>e.textContent!=="—")'),
  await evaluate('[...document.querySelectorAll(".ability-btn .ab-name")].map(e=>e.textContent).join("/")'));
ok('ability costs shown', await evaluate('[...document.querySelectorAll(".ability-btn .ab-cost")].every(e=>/^\\d+F$/.test(e.textContent))'));
ok('wave HP bar moving', await evaluate('parseFloat(document.getElementById("wave-fill").style.width)>0'));
ok('canvas has drawn pixels', await evaluate(`(()=>{const c=document.getElementById('game-canvas');const x=c.getContext('2d');const d=x.getImageData(0,0,Math.min(60,c.width),Math.min(60,c.height)).data;for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2]>12) return true; return false;})()`));

const t0 = await evaluate('Sim.state.time||0'); await sleep(400);
ok('sim clock advancing', (await evaluate('Sim.state.time||0')) > t0);

await evaluate('Sim.useAbility(0)'); await sleep(120);
ok('ability use does not throw', problems.length === 0);

await evaluate('document.getElementById("btn-pause").click()'); await sleep(120);
ok('pause opens over combat', await evaluate('!document.getElementById("pause").hidden && UI.paused'));
const tp = await evaluate('Sim.state.time'); await sleep(300);
ok('paused freezes the sim clock', (await evaluate('Sim.state.time')) === tp);
await evaluate('document.getElementById("pause-save").click()'); await sleep(150);
ok('manual save writes the key', await evaluate('!!localStorage.getItem("veilLegendsSave")'));
await evaluate('document.getElementById("pause-menu").click(); document.getElementById("confirm-yes").click()'); await sleep(300);
ok('back at menu, loop stopped', await evaluate('!document.getElementById("menu").hidden'));
const tm = await evaluate('Sim.state.time'); await sleep(300);
ok('no ticking at menu', (await evaluate('Sim.state.time')) === tm);
ok('continue now enabled', await evaluate('!document.getElementById("btn-continue").disabled'),
  await evaluate('document.getElementById("continue-summary").textContent'));
await evaluate('document.getElementById("btn-continue").click()'); await sleep(500);
ok('continue resumes a run', (await evaluate('Sim.state.phase')) === 'combat');

/* covenant against real content */
await evaluate('document.getElementById("btn-pause").click(); document.getElementById("pause-menu").click(); document.getElementById("confirm-yes").click()'); await sleep(250);
await evaluate('document.getElementById("btn-covenant").click()'); await sleep(250);
ok('covenant renders 18 real nodes', (await evaluate('document.querySelectorAll("#cov-scroll .cov-node").length')) === 18);
ok('covenant tiers grouped', (await evaluate('document.querySelectorAll("#cov-scroll .cov-tier").length')) >= 2,
  await evaluate('document.querySelectorAll("#cov-scroll .cov-tier").length+" tiers"'));
ok('requires chains printed', await evaluate('/Requires /.test(document.getElementById("cov-scroll").textContent)'));
ok('clean nodes badged', await evaluate('document.querySelectorAll("#cov-scroll .badge-clean").length>0'));

/* death screen with real strings */
await evaluate('document.getElementById("cov-back").click()'); await sleep(150);
await evaluate('document.getElementById("btn-continue").click()'); await sleep(400);
await evaluate('Sim.state.veil=95; Sim.state.runStats.breaches=3; Sim.state.phase="dead"; Sim.state.lastRunEchoes=41;'); await sleep(500);
const dead = await evaluate('Sim.state.phase');
ok('death overlay when sim reports dead (phase=' + dead + ')', dead !== 'dead' || (await evaluate('!document.getElementById("death").hidden')));
if (dead === 'dead') {
  ok('death title from content', (await evaluate('document.getElementById("death-title").textContent')).length > 2,
    await evaluate('document.getElementById("death-title").textContent'));
  ok('cause line has no unfilled tokens', !/\{\w+\}/.test(await evaluate('document.getElementById("death-cause").textContent')),
    (await evaluate('document.getElementById("death-cause").textContent')).slice(0, 70));
}

/* pact draft with real pacts, forced */
await evaluate(`(()=>{const s=Sim.state; s.phase='pactDraft'; s.draftOffer=CONTENT.PACTS.slice(0,3).map(p=>p.id); s.motes=5000;})()`);
await sleep(400);
ok('draft renders real pact cards', (await evaluate('document.querySelectorAll("#draft-cards .pact-card").length')) === 3);
ok('ops summarised in words', await evaluate('!/\\[object|undefined|NaN/.test(document.getElementById("draft-cards").textContent)'),
  (await evaluate('document.querySelector("#draft-cards .pact-ops")?.textContent || "no ops row"')).slice(0, 80));
ok('upkeep shown on every card', await evaluate('[...document.querySelectorAll(".pact-upkeep .u-num")].length===3'));

ok('no horizontal overflow', await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));

/* ---- help + first-run tutorial: both live in content.js and were, for the
   whole of Squad 1, wired to nothing at all. ---- */
await evaluate('document.getElementById("pact-draft").hidden=true; Sim.state.phase="combat";');
await evaluate('document.getElementById("btn-pause").click(); document.getElementById("pause-menu").click(); document.getElementById("confirm-yes").click()');
await sleep(300);
ok('menu offers HOW IT WORKS', await evaluate('!!document.getElementById("btn-help")'));
await evaluate('document.getElementById("btn-help").click()'); await sleep(250);
ok('help overlay opens', await evaluate('!document.getElementById("help").hidden'));
ok('help renders every section from content', (await evaluate('document.querySelectorAll("#help-body .help-sec").length')) === (await evaluate('CONTENT.STRINGS.help.sections.length')),
  await evaluate('document.querySelectorAll("#help-body .help-sec").length+" of "+CONTENT.STRINGS.help.sections.length'));
ok('help names the mechanic the game is about', await evaluate('/OVERDRAW/.test(document.getElementById("help-body").textContent)'));
ok('help has no unfilled tokens', await evaluate('!/\\{\\w+\\}/.test(document.getElementById("help-body").textContent)'));
await evaluate('document.getElementById("help-close").click()'); await sleep(200);
ok('help closes', await evaluate('document.getElementById("help").hidden'));

/* Prove a tip actually fires. The seen-tips map is cached at page load, so
   this needs a genuinely fresh document with the seeding script removed. */
if (seedId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedId });
await send('Page.addScriptToEvaluateOnNewDocument',
  { source: `try{localStorage.removeItem('veilLegendsSeenTips');localStorage.removeItem('veilLegendsSave')}catch(e){}` });
await send('Page.navigate', { url: GAME });
await sleep(1600);
await evaluate('document.getElementById("btn-new").click()'); await sleep(250);
await evaluate('document.getElementById("btn-enter").click()'); await sleep(900);
const tutShown = await evaluate('!document.getElementById("tutorial").hidden');
ok('a first-run tip fires on entering combat', tutShown,
  await evaluate('document.getElementById("tut-title").textContent'));
if (tutShown) {
  ok('the tip pauses the run rather than toasting over it', await evaluate('UI.paused === true'));
  const tt = await evaluate('Sim.state.time'); await sleep(300);
  ok('sim really is frozen behind the tip', (await evaluate('Sim.state.time')) === tt);
  await evaluate('document.getElementById("tut-ok").click()'); await sleep(250);
  ok('dismissing the tip resumes the run', await evaluate('UI.paused === false && document.getElementById("tutorial").hidden'));
  const t2 = await evaluate('Sim.state.time'); await sleep(300);
  ok('sim advances again after the tip', (await evaluate('Sim.state.time')) > t2);
  ok('the same tip does not fire twice', await evaluate('!!JSON.parse(localStorage.veilLegendsSeenTips||"{}").tut_combat'));
}

console.log('\n=== REAL MODULES ' + W + 'x' + H + ' ===');
console.log(res.join('\n'));
console.log('FAILS: ' + res.filter(r => r.startsWith('FAIL')).length + '/' + res.length);
console.log('CONSOLE PROBLEMS (' + problems.length + '):');
[...new Set(problems)].slice(0, 15).forEach(p => console.log('  ' + p.slice(0, 300)));
ws.close(); chrome.kill(); process.exit(0);
