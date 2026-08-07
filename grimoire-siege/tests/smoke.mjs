// Grimoire Siege smoke suite v2 — covers the Squad 1 build (resists, preview,
// branches, endless, settings, save migration) on top of the v1 checks.
// CDP over native WebSocket, no npm deps. Run: node grimoire-smoke-v2.mjs
import {spawn} from 'node:child_process';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const ROOT = '/home/gonzobonzob/projects/my-games';
const PORT = 8378, CDP_PORT = 9232;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  try {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    res.setHeader('Content-Type', p.endsWith('.html') ? 'text/html' : p.endsWith('.css') ? 'text/css' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(readFileSync(p));
  } catch { res.statusCode = 404; res.end('nope'); }
});
await new Promise(r => server.listen(PORT, r));

const edge = spawn('microsoft-edge', [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  '--no-first-run', '--disable-gpu', '--user-data-dir=/tmp/claude-1000/-home-gonzobonzob/2305cbca-8ba3-48d9-8a9e-716a919673c8/scratchpad/edge-profile-v2',
  `http://localhost:${PORT}/grimoire-siege/index.html`,
], {stdio: 'ignore'});

let failures = 0, passes = 0;
const check = (name, ok) => { ok ? passes++ : failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

try {
  let target = null;
  for (let i = 0; i < 30 && !target; i++) {
    await sleep(500);
    try {
      const list = await fetch(`http://localhost:${CDP_PORT}/json/list`).then(r => r.json());
      target = list.find(t => t.type === 'page' && t.url.includes('grimoire'));
    } catch {}
  }
  if (!target) throw new Error('no CDP page target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text || JSON.stringify(m.params.exceptionDetails?.exception?.description || 'exception').slice(0,200));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(String(m.params.args?.[0]?.value).slice(0,200));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); });
  const evaljs = async expr => (await send('Runtime.evaluate', {expression: expr, returnByValue: true})).result?.result?.value;
  await send('Runtime.enable');
  await sleep(1500);

  // ---- v1 regression block ----
  check('page loaded, splash present', await evaljs(`!!document.getElementById('gameover')`) === true);
  check('no console errors on load', errors.length === 0);

  // ---- save migration: plant a v1 save, reload, expect it honored ----
  await evaljs(`localStorage.clear(); localStorage.setItem('grimoireSiege_save_v1', JSON.stringify({version:1,bestWave:7,highScore:1234,checkpoint:null}))`);
  await send('Page.enable'); await send('Page.reload'); await sleep(1800);
  check('v1 save migrated: bestWave survives', await evaljs(`loadSave().bestWave`) === 7);
  check('v1 save migrated: highScore survives', await evaljs(`loadSave().highScore`) === 1234);
  check('v2 key exists after migration', await evaljs(`!!localStorage.getItem('grimoireSiege_save_v2')`) === true);

  // ---- contract surface ----
  check('DAMAGE_CLASSES defined', await evaljs(`Array.isArray(DAMAGE_CLASSES)&&DAMAGE_CLASSES.length===3`) === true);
  check('every tower has a dmgClass', await evaljs(`TOWERS.every(t=>DAMAGE_CLASSES.includes(t.dmgClass))`) === true);
  check('RESIST_PROFILES defined with a no-resist entry', await evaljs(`Array.isArray(RESIST_PROFILES)&&RESIST_PROFILES.some(p=>Object.values(p.resists).every(v=>v===0))`) === true);
  check('WAVE_SCRIPT has 12 rows', await evaljs(`Array.isArray(WAVE_SCRIPT)&&WAVE_SCRIPT.length===12`) === true);
  check('BRANCHES covers all 10 towers', await evaljs(`TOWERS.every(t=>BRANCHES[t.id]&&BRANCHES[t.id].a&&BRANCHES[t.id].b)`) === true);
  check('LEAK_COST boss > grunt', await evaljs(`LEAK_COST.boss>LEAK_COST.grunt`) === true);

  // ---- start + preview ----
  await evaljs('startGame(false)');
  await sleep(400);
  check('game started', await evaljs('gameStarted') === true);
  check('nextWaveDef exists during prep (preview state)', await evaljs('!!nextWaveDef') === true);
  check('preview panel visible in DOM', await evaljs(`(()=>{const el=document.querySelector('[id*="preview" i],[class*="preview" i]');return !!el&&el.offsetParent!==null})()`) === true);

  // ---- pause soft-lock regression (the v1 killer) ----
  await evaljs('pauseGame()'); await sleep(150);
  check('pause cancels pending timer', await evaljs('pendingWaveTimer===null') === true);
  await evaljs('resumeGame()'); await sleep(150);
  check('resume re-arms wave timer', await evaljs('pendingWaveTimer!==null') === true);
  await sleep(5800);
  check('wave 1 started after pause/resume', await evaljs('wave') === 1);

  // ---- resist math ----
  check('resist reduces damage', await evaljs(`(()=>{
    const e={hp:1000,maxHp:1000,flash:0,slow:0,dot:0,resists:{pierce:0.6}};
    const before=e.hp; enemies.push(e);
    hitEnemy(e,100,{dmgClass:'pierce',slow:0,dot:0,chain:0});
    enemies=enemies.filter(x=>x!==e);
    return before-e.hp;
  })()`) === 40);
  check('unresisted damage is full', await evaljs(`(()=>{
    const e={hp:1000,maxHp:1000,flash:0,slow:0,dot:0,resists:{}};
    const before=e.hp; enemies.push(e);
    hitEnemy(e,100,{dmgClass:'arcane',slow:0,dot:0,chain:0});
    enemies=enemies.filter(x=>x!==e);
    return before-e.hp;
  })()`) === 100);

  // ---- branches ----
  check('chooseBranch exists', await evaljs(`typeof chooseBranch==='function'`) === true);
  check('branch mods change towerStats', await evaljs(`(()=>{
    const t={...TOWERS[0],level:2,invested:TOWERS[0].cost};
    const base=towerStats(t).dmg;
    t.branch='a'; const a=towerStats(t).dmg;
    t.branch='b'; const b=towerStats(t).dmg;
    return a!==b || a!==base || b!==base;
  })()`) === true);

  // ---- endless + settings + score surface ----
  check('beginEndless/claimVictory exist', await evaljs(`typeof beginEndless==='function'&&typeof claimVictory==='function'`) === true);
  check('generateWave(15) scales past 12', await evaljs(`(()=>{const w12=generateWave(12),w15=generateWave(15);return w15.hp>w12.hp||w15.count>w12.count})()`) === true);
  check('settings global with volume+shake', await evaljs(`typeof settings==='object'&&'volume' in settings&&'shake' in settings`) === true);
  check('score no longer counts hoarded gold', await evaljs(`!recordRunEnd.toString().match(/[^d]gold/)||recordRunEnd.toString().includes('investedGold')`) === true);
  check('sfx has branch and endless voices', await evaljs(`sfx.toString().includes("'branch'")&&sfx.toString().includes("'endless'")`) === true);

  // ---- settings menu reachable ----
  check('settings control in DOM', await evaljs(`!!document.querySelector('[id*="settings" i],[class*="settings" i]')`) === true);

  // ---- 100%-stage fix regressions ----
  // Save&Continue must carry a paid branch through the restore (data-loss bug:
  // the restore map used to drop ct.branch, weakening towers and letting the
  // player re-buy a path they owned).
  check('checkpoint stores tower branch', await evaljs(`(()=>{
    towers=[{...TOWERS[0],x:100,y:100,cd:0,level:2,invested:500,branch:'a',aim:0,aimTo:0,recoil:0,flash:0,phase:0}];
    gold=333;lives=7;wave=4;kills=9;
    saveCheckpoint();
    return loadSave().checkpoint.towers[0].branch;
  })()`) === 'a');
  await evaljs('startGame(true)'); await sleep(300);
  check('branch survives Save&Continue restore', await evaljs(`towers.length===1&&towers[0].branch`) === 'a');
  check('restored gold matches checkpoint', await evaljs('gold') === 333);
  // An all-null checkpoint must read as corrupt (fresh start), not a playable
  // 0-gold/1-life ghost run (Number(null)===0 wart).
  check('all-null checkpoint rejected', await evaljs(`sanitizeCheckpoint({gold:null,lives:null,wave:null,kills:null,towers:null})`) === null);
  // Rapid pause/resume used to stack rAF chains (60 -> 300+ updates/s).
  await evaljs('for(let i=0;i<5;i++){pauseGame();resumeGame();}');
  const f1 = await evaljs('frame'); await sleep(1000);
  const f2 = await evaljs('frame');
  check(`single rAF chain after rapid pause/resume (${f2 - f1} frames/s)`, (f2 - f1) < 100);

  check('no console errors through the run', errors.length === 0);
  if (errors.length) console.log('errors:', errors.slice(0, 6));
} catch (e) {
  failures++; console.log('FATAL', e.message);
} finally {
  edge.kill('SIGKILL'); server.close();
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
