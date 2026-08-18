// Cutaway render probe. file:// only — the sandbox blocks the browser from
// reaching a local HTTP server, which is what wedges tests/smoke.mjs.
// Measures the rendered Building tab instead of screenshotting it.
import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GAME = process.argv[2] || '/home/gonzobonzob/projects/my-games/callsigns';
const BROWSER = process.env.SMOKE_BROWSER || 'microsoft-edge';
let ws, sessionId, msgId = 0;
const pending = new Map();
const consoleErrors = [];

function send(method, params, sid){
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 15000);
    ws.send(JSON.stringify({ id, method, params: params || {}, ...(sid ? { sessionId: sid } : {}) }));
  });
}
function onMessage(raw){
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('exception: ' + JSON.stringify(m.params.exceptionDetails?.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    consoleErrors.push('console.error: ' + (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
}
async function evaluate(expr){
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

async function main(){
  const profile = await mkdtemp(join(tmpdir(), 'cutprobe-'));
  const browser = spawn(BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--allow-file-access-from-files','--user-data-dir=' + profile,'--remote-debugging-port=0','about:blank'], { stdio: 'ignore' });
  let port = null;
  for (let i = 0; i < 120 && !port; i++) {
    try { port = parseInt((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0], 10) || null; }
    catch { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!port) throw new Error('browser never wrote DevToolsActivePort');
  let ver = null;
  for (let i = 0; i < 100 && !ver; i++) {
    try { ver = await (await fetch('http://127.0.0.1:'+port+'/json/version')).json(); } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => onMessage(e.data);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: true }, sessionId);

  if (process.env.REDUCED) await send('Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
  await send('Page.navigate', { url: 'file://' + join(GAME, 'index.html') }, sessionId);
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`typeof newState === 'function' && typeof render === 'function' && typeof enterGame === 'function'`)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const report = await evaluate(`(function(){
    try {
      S = sanitize(newState('KTST'));
      refreshCandidates(); enterGame();
      S.cash = 4000000; S.rep = 80; S.bays = 6; S.rooms = [];
      S.unlockedExpansion = true;
      Object.keys(SEGMENTS).slice(1,4).forEach(sg => { try { foundStation(sg); } catch(e){} });
      // A roster to seat: one of each role, so all three figures render.
      ['eng','dj','sales','dj','eng','sales'].forEach(r => S.staff.push(makePerson(r, 60)));
      S.cash = 4000000;
      buildRoom(0,'rack'); buildRoom(0,'traffic');
      for (let i=0;i<3;i++) buildRoom(i,'prod');
      // Floor 1 gets two of three seats filled -> two figures and one ghost.
      let k = 0;
      S.rooms.forEach(r => { for (let j=0;j<3;j++){ const p = S.staff[k++ % S.staff.length]; if (p) seatInRoom(r.id, p.id); } });
      // leave the LAST room's seats empty so ghosts are still exercised
      if (S.rooms.length) S.rooms[S.rooms.length-1].staff = [];
      setTab('build'); render();
    } catch(e){ return { fatal: String(e && e.message || e) }; }
    const floors = Array.from(document.querySelectorAll('.cut-floor'));
    const cells  = Array.from(document.querySelectorAll('.cut-cell'));
    const figs   = Array.from(document.querySelectorAll('.cut-fig'));
    const marks  = Array.from(document.querySelectorAll('.cut-mark svg'));
    const rects  = floors.map(f => f.getBoundingClientRect());
    const nums   = floors.map(f => (f.querySelector('.cut-num')||{}).textContent || '');
    const anim   = figs.filter(f => getComputedStyle(f).animationName !== 'none').length;
    const card   = document.querySelector('#pane-build');
    return {
      floors: floors.length, cells: cells.length, figures: figs.length, marks: marks.length,
      ghosts: document.querySelectorAll('.cut-fig.ghost').length,
      animating: anim,
      domOrderNums: nums,
      topToBottom: rects.map(r => Math.round(r.top)),
      pitch: rects.length > 1 ? Math.round(rects[1].top - rects[0].top) : null,
      stackHeight: rects.length ? Math.round(rects[rects.length-1].bottom - rects[0].top) : 0,
      paneScrollW: card ? card.scrollWidth : null,
      viewportW: window.innerWidth,
      legacyRows: document.querySelectorAll('.bay-row').length,
      ariaSample: (cells[0]||{}).getAttribute ? cells[0].getAttribute('aria-label') : null,
      emojiInPane: (card ? (card.textContent.match(/[\\u{1F300}-\\u{1FAFF}]/gu)||[]) : []).join('')
    };
  })()`);
  console.log(JSON.stringify(report, null, 2));
  console.log('consoleErrors:', consoleErrors.length ? consoleErrors : 'none');
  try { ws.close(); } catch {}
  browser.kill();
  process.exit(0);
}
main().catch(e => { console.error('probe fault:', e.message); process.exit(2); });
