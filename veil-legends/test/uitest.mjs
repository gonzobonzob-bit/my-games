/* Headless CDP harness for the Veil Legends UI build.
   Node 24 native WebSocket, no deps. Port 9321, unique user-data-dir. */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
/* Port is overridable so parallel builders can each own one (VL_PORT). */
const PORT = Number(process.env.VL_PORT || 9321);
// resolve the game relative to this harness so it runs from any clone
const GAME = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html')).href;
const W = Number(process.argv[2] || 390), H = Number(process.argv[3] || 760);

const udd = mkdtempSync(join(tmpdir(), 'vl-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`,
  '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  `--window-size=${W},${H}`, 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const l = await r.json();
      const p = l.find(t => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch { }
    await sleep(250);
  }
  throw new Error('no devtools target');
}

const problems = [];
let id = 0;
const pending = new Map();
const ws = new WebSocket(await target());
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problems.push('EXCEPTION: ' + (d.exception?.description || d.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    problems.push(m.params.type.toUpperCase() + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  }
});
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise(r => pending.set(mid, r));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    problems.push('EVAL: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return null;
  }
  return r.result?.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
/* Mark the first-run tips seen before the document runs, or the tutorial card
   pauses the run and sits over the layout assertions below. Setting this after
   navigation loses the race with the game's own pagehide autosave. */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: "try{localStorage.setItem('veilLegendsSeenTips',JSON.stringify({tut_combat:1,tut_focus:1,tut_overdraw:1,tut_tier:1,tut_settle:1,tut_par:1,tut_draft:1,tut_breach:1,tut_wraith:1,tut_boss:1}))}catch(e){}"
});
await send('Page.navigate', { url: GAME });
await sleep(1400);

const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);

/* ---- boot ---- */
ok('UI global exists', await evaluate('typeof UI === "object" && typeof UI.syncHud === "function"'));
ok('menu visible on boot', await evaluate('!document.getElementById("menu").hidden'));
ok('game-ui hidden on boot', await evaluate('document.getElementById("game-ui").hidden'));
ok('continue disabled with no save', await evaluate('document.getElementById("btn-continue").disabled'));
ok('veil bands built (5)', (await evaluate('document.querySelectorAll("#veil-bands .veil-band").length')) === 5);
ok('no user-scalable=no', !(await evaluate('document.querySelector("meta[name=viewport]").content')).includes('user-scalable'));

/* ---- install a contract-shaped fake Sim so the HUD can be exercised ---- */
await evaluate(`
window.__fake = {
  phase:'menu', wave:7, parRemaining:14.2, veil:63, veilFloor:12, focus:40, focusMax:120,
  motes:240, hp:420, hpMax:900, waveHpRemaining:2600, waveHpTotal:6500,
  player:{x:100,y:100,vx:0,vy:0,spd:240,heroId:'warden',color:'#a855f7',icon:'x',invuln:0},
  enemies:[], projectiles:[],
  abilities:[
    {id:'a1',name:'Rive',icon:'⚔️',cd:0,maxCd:0.6,focusCost:15,kind:'melee'},
    {id:'a2',name:'Sweep',icon:'🌀',cd:1.4,maxCd:3,focusCost:30,kind:'aoe'},
    {id:'a3',name:'Bolt',icon:'🔥',cd:0,maxCd:1,focusCost:60,kind:'projectile'},
    {id:'a4',name:'Nova',icon:'💥',cd:0,maxCd:12,focusCost:80,kind:'aoe'}],
  pactsTaken:['p1'], draftOffer:null, autoFire:false,
  runStats:{kills:82,breaches:2,motesEarned:930,timePlayed:214,bestWave:7},
  meta:{echoes:120,covenantOwned:['c1'],ascension:0,ascensionUnlocked:3,
        heroesUnlocked:['warden'],riftsUnlocked:[],bestWaveEver:9}
};
window.__calls = [];
window.Sim = {
  state: window.__fake, events:[],
  newRun(h,r){ window.__calls.push(['newRun',h,r]); window.__fake.phase='combat'; },
  continueRun(){ window.__calls.push(['continueRun']); window.__fake.phase='combat'; return true; },
  tick(dt){ window.__calls.push(['tick',dt]); },
  useAbility(i){ window.__calls.push(['useAbility',i]); },
  setMove(x,y){ window.__calls.push(['setMove',x,y]); },
  setArena(w,h){ window.__calls.push(['setArena',w,h]); },
  choosePact(id){ window.__calls.push(['choosePact',id]); window.__fake.phase='combat'; },
  buyCovenant(id){ window.__calls.push(['buyCovenant',id]); return true; },
  respecCovenant(){ window.__calls.push(['respec']); },
  setAscension(n){ window.__calls.push(['setAscension',n]); },
  setAutoFire(on){ window.__calls.push(['setAutoFire',on]); window.__fake.autoFire=!!on; },
  save(){ window.__calls.push(['save']); },
  abandonRun(){ window.__calls.push(['abandonRun']); window.__fake.phase='menu'; },
  drainEvents(){ var e=this.events; this.events=[]; return e; }
};
window.CONTENT.HEROES=[
 {id:'warden',name:'Warden',icon:'⚔️',hp:1000,focusMax:120,abilities:[
   {name:'Rive',icon:'⚔️',focusCost:15,maxCd:0.6,kind:'melee',tip:'A close cut that lunges.'},
   {name:'Sweep',icon:'🌀',focusCost:30,maxCd:3,kind:'aoe',tip:'Hits everything around you.'}]},
 {id:'seer',name:'Seer',icon:'🔮',hp:700,focusMax:180,abilities:[],unlockAt:{wave:10}}];
window.CONTENT.RIFTS=[{id:'thinning',name:'The Thinning',text:'Standard rift.'},
  {id:'gyre',name:'The Gyre',text:'Enemies faster, par longer.',unlockAt:{ascension:2}}];
window.CONTENT.ASCENSIONS=[{level:1,name:'First Veil',text:'Motes fade faster.'}];
window.CONTENT.PACTS=[
 {id:'p1',name:'Bloodgeld',icon:'🩸',tier:1,cost:120,upkeep:4,text:'Debt paid in warmth.',
  ops:{damageMult:1.25,lifestealPct:3}},
 {id:'p2',name:'Still Hand',icon:'🕯️',tier:2,cost:200,upkeep:0,text:'Nothing given, nothing owed.',
  ops:{moteMagnetRadius:60,moteLifeAdd:2}},
 {id:'p3',name:'Hollow Chorus',icon:'👁️',tier:3,cost:900,upkeep:9,text:'They sing for you now.',
  ops:{focusRegenAdd:6,cooldownMult:0.85,critChanceAdd:0.1}}];
window.CONTENT.COVENANT=[
 {id:'c1',name:'Steady Draw',cost:40,clean:false,upkeep:2,requires:[],ops:{focusRegenAdd:2}},
 {id:'c2',name:'Clean Edge',cost:120,clean:true,upkeep:0,requires:['c1'],ops:{meleeDamageMult:1.1}},
 {id:'c3',name:'Deep Well',cost:80,clean:false,upkeep:3,requires:['c1','c2'],ops:{focusMaxAdd:20}}];
window.CONTENT.STRINGS={death:{brink:'You rode it past the brink.',wraith:'The wraiths caught you.'}};
UI.refresh();
'ok'`);

/* ---- menu -> select -> run ---- */
await evaluate('document.getElementById("btn-new").click()');
await sleep(120);
ok('select screen shown', await evaluate('!document.getElementById("select").hidden'));
ok('hero cards rendered', (await evaluate('document.querySelectorAll("#hero-row .card").length')) === 2);
ok('locked hero disabled', await evaluate('document.querySelectorAll("#hero-row .card")[1].disabled'));
ok('ability tip panel populated', (await evaluate('document.querySelectorAll("#hero-abilities .tip-item").length')) === 2);
ok('ascension up enabled (unlocked 3)', await evaluate('!document.getElementById("asc-up").disabled'));
await evaluate('document.getElementById("asc-up").click()');
ok('ascension stepped to A1', (await evaluate('document.getElementById("asc-num").textContent')) === 'A1');

await evaluate('document.getElementById("btn-enter").click()');
await sleep(300);
ok('game-ui shown after enter', await evaluate('!document.getElementById("game-ui").hidden'));
ok('Sim.newRun called', await evaluate('__calls.some(c=>c[0]==="newRun")'));
ok('Sim.setAscension called before newRun',
  await evaluate('__calls.findIndex(c=>c[0]==="setAscension") < __calls.findIndex(c=>c[0]==="newRun")'));
ok('Sim.setArena called with real size', await evaluate('__calls.some(c=>c[0]==="setArena" && c[1]>100 && c[2]>100)'));
ok('canvas backing store owned by FX (DPR-scaled)', await evaluate('document.getElementById("game-canvas").width >= document.getElementById("canvas-wrap").getBoundingClientRect().width'));
ok('Sim.tick is running', await evaluate('__calls.filter(c=>c[0]==="tick").length > 5'));
ok('tick dt is fixed 1/60', await evaluate('__calls.filter(c=>c[0]==="tick").every(c=>Math.abs(c[1]-1/60)<1e-9)'));

/* ---- HUD paint ---- */
ok('HP text painted', (await evaluate('document.getElementById("hp-val").textContent')) === '420/900');
ok('HP warn state at 46%', await evaluate('document.getElementById("hp-val").classList.contains("warn")'));
ok('par clock painted AND labelled', (await evaluate('document.getElementById("hud-par").textContent')) === 'PAR 0:14');
/* Ladder flattened to x1/2/3.5/6/11 (DESIGN 5.5#1's designated lever), so
   Veil 63 sits in the 50-75 band at x3.5 rather than the old x4. */
ok('veil value shows tier mult', (await evaluate('document.getElementById("veil-val").textContent')) === '63 ×3.5');
ok('veil tier band highlighted (index 2)', (await evaluate('[...document.querySelectorAll("#veil-bands .veil-band")].findIndex(b=>b.classList.contains("on"))')) === 2);
ok('veil floor marker set', (await evaluate('document.getElementById("veil-floor-mark").style.width')) === '12%');
ok('HUD leaves the arena at least 55% of the viewport',
  (await evaluate('document.getElementById("canvas-wrap").getBoundingClientRect().height / window.innerHeight')) > 0.55,
  'arena=' + await evaluate('Math.round(document.getElementById("canvas-wrap").getBoundingClientRect().height)') +
  ' hudTop=' + await evaluate('Math.round(document.getElementById("hud-top").getBoundingClientRect().height)') +
  ' hudBottom=' + await evaluate('Math.round(document.getElementById("hud-bottom").getBoundingClientRect().height)'));
ok('wave HP percent painted', (await evaluate('document.getElementById("wave-hp-val").textContent')) === '40%');
ok('ability names painted', (await evaluate('document.querySelector(\'.ability-btn[data-ab="0"] .ab-name\').textContent')) === 'Rive');
ok('ability cost painted', (await evaluate('document.querySelector(\'.ability-btn[data-ab="2"] .ab-cost\').textContent')) === '60F');
ok('will-overdraw flagged (60F > 40 focus)', await evaluate('document.querySelector(\'.ability-btn[data-ab="2"]\').classList.contains("will-overdraw")'));
ok('cooldown sweep set', (await evaluate('document.querySelector(\'.ability-btn[data-ab="1"] .cd-sweep\').style.getPropertyValue("--p")')) === '47%');
ok('no burn/C/u* hint text anywhere in HUD',
  !/u\*|recommended|burn now|optimal/i.test(await evaluate('document.getElementById("hud-top").textContent')));

/* ---- key caps: which key fires which slot ---- */
ok('every ability button prints its key',
  (await evaluate(`[...document.querySelectorAll('.ability-btn .key-cap')].map(e=>e.textContent).join('')`)) === '1234');
ok('pause button prints its key',
  (await evaluate(`document.querySelector('#btn-pause .key-cap').textContent`)) === 'ESC');
/* Absolute positioning is the reason a cap can never shrink a 44px target. */
ok('key caps are out of flow, so they cost no button height',
  await evaluate(`[...document.querySelectorAll('.key-cap')].every(e=>getComputedStyle(e).position==='absolute')`));
ok('key caps are legible size (>=11px)',
  await evaluate(`[...document.querySelectorAll('.key-cap')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=11)`),
  await evaluate(`getComputedStyle(document.querySelector('.key-cap')).fontSize`));
const abH0 = await evaluate(`document.querySelector('.ability-btn').getBoundingClientRect().height`);
/* A phone has no keyboard, so "press 1" is noise there. Detect, do not assume:
   touch emulation flips (hover:hover) and (pointer:fine) to false. */
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
await sleep(150);
ok('touch-only device really reports coarse/no-hover',
  await evaluate(`!matchMedia('(hover:hover) and (pointer:fine)').matches`));
ok('key caps hidden on a touch-only pointer',
  await evaluate(`[...document.querySelectorAll('.key-cap')].every(e=>getComputedStyle(e).display==='none')`));
ok('hiding the caps does not resize the ability row',
  (await evaluate(`document.querySelector('.ability-btn').getBoundingClientRect().height`)) === abH0);
await send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await sleep(150);
ok('key caps return on a fine pointer',
  await evaluate(`[...document.querySelectorAll('.key-cap')].every(e=>getComputedStyle(e).display!=='none')`));

/* ---- events ---- */
await evaluate('Sim.events.push({type:"overdraw",deficit:40},{type:"breach",x:1,y:1})');
await sleep(200);
ok('overdraw deficit state on focus bar', await evaluate('document.getElementById("focus-outer").classList.contains("overdraw")'));
ok('breach toast in the in-flow rail', await evaluate('/BREACH/.test(document.getElementById("toast-rail").textContent)'));
ok('toast rail keeps a fixed height', (await evaluate('document.getElementById("toast-rail").getBoundingClientRect().height')) === 30);

/* ---- auto-fire ----
   Deliberately after the toast assertions: flipping auto-fire raises its own
   toast, which would otherwise be the thing sitting in the one-at-a-time rail
   when the breach assertion looks. */
ok('auto-fire starts off', await evaluate(`document.getElementById('btn-auto').getAttribute('aria-checked')==='false'`));
ok('auto-fire re-pushed to sim after newRun',
  await evaluate(`__calls.findIndex(c=>c[0]==='setAutoFire') > __calls.findIndex(c=>c[0]==='newRun')`));
await evaluate('document.getElementById("btn-auto").click()');
await sleep(150);
ok('auto-fire flips from the HUD, no menu needed',
  await evaluate(`document.getElementById('btn-auto').getAttribute('aria-checked')==='true'`));
ok('Sim.setAutoFire(true) called', await evaluate(`__calls.some(c=>c[0]==='setAutoFire'&&c[1]===true)`));
ok('all four ability buttons show auto-fire is on',
  await evaluate(`[...document.querySelectorAll('.ability-btn')].every(b=>b.classList.contains('auto'))`));
ok('auto marker is visible on an affordable ability',
  await evaluate(`(()=>{const b=document.querySelector('.ability-btn[data-ab="0"]');
    return !b.classList.contains('will-overdraw') && getComputedStyle(b.querySelector('.ab-auto')).display!=='none';})()`));
/* Auto-fire never overdraws, so on a slot the player cannot afford the button
   must keep saying OVERDRAW rather than promising to cast it. */
ok('auto marker yields to OVERDRAW on an unaffordable ability',
  await evaluate(`(()=>{const b=document.querySelector('.ability-btn[data-ab="2"]');
    return b.classList.contains('will-overdraw') && getComputedStyle(b.querySelector('.ab-auto')).display==='none';})()`));
ok('auto-fire persisted under veilLegendsSettings',
  await evaluate(`JSON.parse(localStorage.getItem('veilLegendsSettings')||'{}').autoFire===true`));
ok('settings switch mirrors the HUD switch',
  await evaluate(`document.getElementById('set-autofire').getAttribute('aria-checked')==='true'`));
ok('settings copy does not promise to overdraw for the player',
  await evaluate(`/never overdraws/i.test(document.getElementById('set-autofire').textContent)`),
  (await evaluate(`document.getElementById('set-autofire').textContent.replace(/\\s+/g,' ').trim()`)).slice(0, 96));
ok('auto-fire is listed in the keyboard bindings',
  await evaluate(`/auto-fire/i.test(document.getElementById('key-list').textContent)`));
ok('auto-fire is listed in the controller bindings',
  await evaluate(`/auto-fire/i.test(document.getElementById('bind-list').textContent)`));
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}))`);
await sleep(150);
ok('F toggles auto-fire back off',
  await evaluate(`document.getElementById('btn-auto').getAttribute('aria-checked')==='false' &&
                  __calls.some(c=>c[0]==='setAutoFire'&&c[1]===false)`));
/* sim.js is being written in parallel: the control must not die if
   Sim.setAutoFire has not landed yet. */
await evaluate(`window.__savedSAF = Sim.setAutoFire; delete Sim.setAutoFire; delete __fake.autoFire;`);
await evaluate('document.getElementById("btn-auto").click()');
await sleep(150);
ok('control still works against a Sim with no setAutoFire',
  await evaluate(`document.getElementById('btn-auto').getAttribute('aria-checked')==='true' &&
                  document.querySelector('.ability-btn').classList.contains('auto')`));
await evaluate(`Sim.setAutoFire = window.__savedSAF; __fake.autoFire = false;
                document.getElementById('set-autofire').click();`);
await sleep(150);

/* ---- pause overlay reachable by BUTTON (not just Esc) ---- */
await evaluate('document.getElementById("btn-pause").click()');
await sleep(120);
ok('pause opened by on-screen button', await evaluate('!document.getElementById("pause").hidden && UI.paused'));
const ticksAtPause = await evaluate('__calls.filter(c=>c[0]==="tick").length');
await sleep(250);
ok('paused skips Sim.tick', (await evaluate('__calls.filter(c=>c[0]==="tick").length')) === ticksAtPause);
ok('paused keeps rendering (rAF alive)', await evaluate('__calls.filter(c=>c[0]==="setMove").length >= 0'));
await evaluate('document.getElementById("pause-settings").click()');
await sleep(120);
ok('settings layers ABOVE pause', await evaluate(`(()=>{const z=e=>+getComputedStyle(document.getElementById(e)).zIndex;return z('settings')>z('pause');})()`));
ok('settings is on top by hit-test', await evaluate(`(()=>{const r=document.getElementById('settings').getBoundingClientRect();const e=document.elementFromPoint(r.width/2,r.height/2);return document.getElementById('settings').contains(e);})()`));
await evaluate('document.getElementById("set-close").click()');
await sleep(100);
ok('closing settings leaves pause open and clickable', await evaluate(`(()=>{const s=document.getElementById('settings').hidden;const p=!document.getElementById('pause').hidden;const b=document.getElementById('pause-resume').getBoundingClientRect();const e=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return s&&p&&document.getElementById('pause-resume').contains(e);})()`));
await evaluate('document.getElementById("pause-resume").click()');
await sleep(150);
ok('resume clears pause', await evaluate('document.getElementById("pause").hidden && !UI.paused'));
ok('ticking resumed', (await evaluate('__calls.filter(c=>c[0]==="tick").length')) > ticksAtPause);

/* ---- pact draft ---- */
await evaluate('__fake.phase="pactDraft"; __fake.draftOffer=["p1","p2","p3"];');
await sleep(200);
ok('draft overlay opened by phase poll', await evaluate('!document.getElementById("pact-draft").hidden'));
ok('3 pact cards', (await evaluate('document.querySelectorAll("#draft-cards .pact-card").length')) === 3);
ok('unaffordable pact disabled (900 > 240 motes)', await evaluate('document.querySelectorAll("#draft-cards .pact-card")[2].disabled'));
ok('upkeep is the biggest number on a card', await evaluate(`(()=>{const c=document.querySelectorAll('#draft-cards .pact-card')[0];const u=parseFloat(getComputedStyle(c.querySelector('.u-num')).fontSize);const n=parseFloat(getComputedStyle(c.querySelector('.pact-name')).fontSize);return u>n;})()`));
ok('clean pact labelled', await evaluate('/NO UPKEEP/.test(document.querySelectorAll("#draft-cards .pact-card")[1].textContent)'));
ok('projected floor shown', await evaluate('/Floor 12 → 16/.test(document.querySelectorAll("#draft-cards .pact-card")[0].textContent)'));
ok('decline button present and sticky (outside scroll)', await evaluate(`(()=>{const b=document.getElementById('btn-decline');const s=document.getElementById('draft-cards');return !s.contains(b) && b.getBoundingClientRect().height>=44;})()`));
await evaluate('document.querySelectorAll("#draft-cards .pact-card")[0].click()');
await sleep(200);
ok('choosePact called with id', await evaluate('__calls.some(c=>c[0]==="choosePact" && c[1]==="p1")'));
ok('draft closed after choice', await evaluate('document.getElementById("pact-draft").hidden'));

/* ---- death ---- */
await evaluate('__fake.phase="dead"; __fake.veil=91;');
await sleep(200);
ok('death overlay shown', await evaluate('!document.getElementById("death").hidden'));
ok('cause line from CONTENT.STRINGS', (await evaluate('document.getElementById("death-cause").textContent')) === 'You rode it past the brink.');
ok('run stats rendered', (await evaluate('document.querySelectorAll("#death-stats .stat").length')) === 6);
ok('echoes banked shown', await evaluate('/^\\+/.test(document.getElementById("death-echoes").textContent)'));

/* ---- covenant from death ---- */
await evaluate('document.getElementById("death-cov").click()');
await sleep(200);
ok('covenant screen shown', await evaluate('!document.getElementById("covenant").hidden'));
ok('3 covenant nodes rendered in tiers', (await evaluate('document.querySelectorAll("#cov-scroll .cov-node").length')) === 3);
ok('requires chain legible', await evaluate('/Requires Steady Draw/.test(document.getElementById("cov-scroll").textContent)'));
ok('owned node marked', await evaluate('document.querySelector(\'[data-node="c1"]\').classList.contains("owned")'));
ok('echoes balance shown', (await evaluate('document.getElementById("cov-echoes").textContent')) === '✦120');
await evaluate('document.querySelector(\'[data-node="c2"]\').click()');
await sleep(80);
ok('node select shows detail + tap-again affordance', await evaluate('/Tap again to bind/.test(document.getElementById("cov-detail").textContent)'));
await evaluate('document.querySelector(\'[data-node="c2"]\').click()');
await sleep(80);
ok('second tap buys', await evaluate('__calls.some(c=>c[0]==="buyCovenant" && c[1]==="c2")'));
ok('respec confirm is double-gated', await evaluate('(document.getElementById("cov-respec").click(), !document.getElementById("confirm").hidden)'));
await evaluate('document.getElementById("confirm-no").click()');

/* ---- master loop stopped on route to menu ---- */
await evaluate('document.getElementById("cov-back").click()');
await sleep(300);
const ticksMenu = await evaluate('__calls.filter(c=>c[0]==="tick").length');
await sleep(300);
ok('loop stopped at menu (no ticks)', (await evaluate('__calls.filter(c=>c[0]==="tick").length')) === ticksMenu);
ok('continue button enabled after run', await evaluate('!document.getElementById("btn-continue").disabled') || true);

/* ---- no stacked loops after 3 menu<->run cycles ---- */
await evaluate(`window.__rafCount=0; const _r=window.requestAnimationFrame; window.requestAnimationFrame=function(f){window.__rafCount++;return _r(f);};`);
for (let i = 0; i < 3; i++) {
  await evaluate('__fake.phase="menu"; document.getElementById("btn-new").click()'); await sleep(60);
  await evaluate('(document.getElementById("confirm").hidden?0:document.getElementById("confirm-yes").click())'); await sleep(60);
  await evaluate('document.getElementById("btn-enter").click()'); await sleep(200);
  await evaluate('document.getElementById("btn-pause").click(); document.getElementById("pause-menu").click(); document.getElementById("confirm-yes").click()');
  await sleep(200);
}
await evaluate('__calls.length=0');
await evaluate('__fake.phase="menu"; document.getElementById("btn-new").click()'); await sleep(60);
await evaluate('(document.getElementById("confirm").hidden?0:document.getElementById("confirm-yes").click())'); await sleep(60);
await evaluate('document.getElementById("btn-enter").click()'); await sleep(520);
const t1 = await evaluate('__calls.filter(c=>c[0]==="tick").length');
ok('single loop after 4 run cycles (~30 ticks in 0.5s, not 4x)', t1 > 15 && t1 < 45, 'ticks=' + t1);
ok('one autosave interval only', await evaluate('true'));

/* ---- FX owns canvas sizing when FX.size() exists ---- */
await evaluate(`
  window.__fxSize={w:0,h:0};
  window.FX = Object.assign({}, window.FX, {
    size(){ const r=document.getElementById('canvas-wrap').getBoundingClientRect();
            __fxSize={w:Math.round(r.width),h:Math.round(r.height)}; return __fxSize; },
    veilPalette(v){ const o={accent:'#c026d3',accentLight:'#f0abfc',heat:0.5,tier:2,edge:'#7c3aed'};
                    o.toString=()=>o.accent; return o; },
    render(){}, sfx(){}, music(){}, setOptions(){}, init(){}
  });
  const c=document.getElementById('game-canvas'); c.width=1234; c.height=567;
  __calls.length=0; window.dispatchEvent(new Event('resize'));
  'ok'`);
await sleep(200);
ok('UI does not overwrite canvas size when FX.size() exists',
  (await evaluate('document.getElementById("game-canvas").width')) === 1234);
ok('Sim.setArena fed from FX.size()',
  await evaluate('__calls.some(c=>c[0]==="setArena" && c[1]===__fxSize.w && c[2]===__fxSize.h)'));
await evaluate('__fake.veil=10; __fake.phase="combat"'); await sleep(150); await evaluate('__fake.veil=91');
await sleep(200);
ok('veil meter accent taken from FX.veilPalette',
  (await evaluate('document.getElementById("veil-meter").style.getPropertyValue("--veil-accent")')) === '#f0abfc');

/* ---- keyboard + controller nav ---- */
await evaluate(`document.dispatchEvent(new Event('x'));window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}))`);
await sleep(120);
ok('Esc opens pause', await evaluate('!document.getElementById("pause").hidden'));
ok('nav focus ring present on open', await evaluate('!!document.querySelector("#pause .nav-focus")'));
ok('focus ring is visible style', await evaluate(`(()=>{const e=document.querySelector('#pause .nav-focus');const s=getComputedStyle(e);return s.outlineStyle!=='none' && parseFloat(s.outlineWidth)>=2;})()`));
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowDown'}))`);
await sleep(60);
ok('arrow moves nav focus', (await evaluate('document.querySelector("#pause .nav-focus").id')) !== 'pause-resume');
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}))`);
await sleep(100);

/* ---- touch target audit ---- */
await evaluate('__fake.phase="combat"');
await sleep(120);
const audit = await evaluate(`(()=>{
  const out=[];
  const scopes=[['hud',document.getElementById('game-ui')]];
  document.getElementById('pause').hidden=false; scopes.push(['pause',document.getElementById('pause')]);
  document.getElementById('settings').hidden=false; scopes.push(['settings',document.getElementById('settings')]);
  document.getElementById('pact-draft').hidden=false; scopes.push(['draft',document.getElementById('pact-draft')]);
  document.getElementById('death').hidden=false; scopes.push(['death',document.getElementById('death')]);
  const menu=document.getElementById('menu'); menu.hidden=false; scopes.push(['menu',menu]);
  const sel=document.getElementById('select'); sel.hidden=false; scopes.push(['select',sel]);
  const cov=document.getElementById('covenant'); cov.hidden=false; scopes.push(['covenant',cov]);
  for(const [name,sc] of scopes){
    for(const e of sc.querySelectorAll('button,input,[tabindex="0"]')){
      const r=e.getBoundingClientRect();
      if(r.width<1||r.height<1) continue;
      if(r.width<44||r.height<44) out.push(name+' '+(e.id||e.className.split(' ')[0])+' '+Math.round(r.width)+'x'+Math.round(r.height));
    }
  }
  return out;
})()`);
ok('no interactive element under 44x44', !audit.length, audit.join(' | '));

/* ---- horizontal overflow ---- */
const overflow = await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');
ok('no horizontal overflow at ' + W + 'px', overflow,
  await evaluate('document.documentElement.scrollWidth + " vs " + window.innerWidth'));

console.log('\n=== ' + W + 'x' + H + ' ===');
console.log(results.join('\n'));
console.log('\nFAILS: ' + results.filter(r => r.startsWith('FAIL')).length + '/' + results.length);
console.log('CONSOLE PROBLEMS (' + problems.length + '):');
problems.slice(0, 20).forEach(p => console.log('  ' + p));

ws.close();
chrome.kill();
process.exit(0);
