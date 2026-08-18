// Bay-identity probe. file:// only, same reason as cutprobe: the sandbox
// blocks the browser from reaching a local HTTP server.
//
// rooms.mjs proves sim puts a room on the floor it was handed. This proves
// the FLOOR THE PLAYER TAPPED is the floor sim gets — the whole defect lived
// in the wiring between them, where bayIdx was taken from the player, printed
// in the picker heading, and then dropped. So this drives real clicks: the
// "+" on a chosen floor, then the row in the modal that opens, and compares
// what was QUOTED against what was BUILT.
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
    const out = { steps: [] };
    try {
      S = sanitize(newState('KBAY'));
      refreshCandidates(); enterGame();
      S.cash = 4000000; S.rep = 80; S.bays = 4; S.rooms = [];
      S.unlockedExpansion = true;
      Object.keys(SEGMENTS).slice(1,4).forEach(sg => { try { foundStation(sg); } catch(e){} });
      ['eng','dj','sales'].forEach(r => S.staff.push(makePerson(r, 60)));
      S.cash = 4000000;
      setTab('build'); render();

      // ---- 1. tap the "+" on the TOP floor, whatever floor that is.
      const opens = Array.from(document.querySelectorAll('.cut-cell.open[data-buildroom]'));
      const want = Math.max.apply(null, opens.map(b => +b.dataset.buildroom));
      const btn = opens.find(b => +b.dataset.buildroom === want);
      out.tappedBay = want;
      out.leaseQuotedByFloor = simBayLease(want);
      btn.click();
      out.steps.push('clicked +');

      // ---- 2. read what the PICKER says it is about to do.
      const heading = document.querySelector('.modal .readout-note');
      out.pickerHeading = heading ? heading.textContent : null;
      const rows = Array.from(document.querySelectorAll('[data-pickroom]'));
      out.rowCount = rows.length;
      const prodRow = rows.find(r => (r.dataset.pickroom || '').split('|')[2] === 'prod');
      if (!prodRow) { out.fatal = 'no production row offered'; return out; }
      const bits = prodRow.dataset.pickroom.split('|');
      out.rowBay = +bits[0];
      out.rowStation = +bits[1];
      out.viewedStation = curIndex();
      out.bestProdStation = uiBestProdStation();
      // The ceiling text on the row is measured at rowStation; capture it so a
      // mismatch shows as prose, not just as an index.
      const ceilEl = prodRow.querySelector('.row-sub:nth-of-type(3)');
      out.rowCeilingText = ceilEl ? ceilEl.textContent : null;

      // ---- 3. click it, and see where the room actually went.
      prodRow.click();
      out.steps.push('clicked production row');
      const built = simRoomList().filter(Boolean).find(r => r.type === 'prod');
      out.builtBay = built ? simRoomBay(built) : null;
      out.builtStation = built ? built.station : null;
      out.leaseActuallyBilled = built ? simBayLease(simRoomBay(built)) : null;

      // ---- 4. re-point it and check it does not climb the building.
      if (built && S.stations.length > 1) {
        const to = (built.station + 1) % S.stations.length;
        doMoveRoom(built.id, to);
        const after = simRoomList().filter(Boolean).find(r => r.type === 'prod');
        out.afterMoveBay = after ? simRoomBay(after) : null;
        out.afterMoveStation = after ? after.station : null;
      }
      closeModal(); render();
      out.floorsDrawn = document.querySelectorAll('.cut-floor').length;
      out.filledCells = document.querySelectorAll('.cut-cell.filled').length;
    } catch(e){ out.fatal = String(e && e.message || e); }
    return out;
  })()`);
  const r = report;
  let bad = 0;
  const ok = (name, cond, detail) => {
    if (cond) console.log('  ok  ' + name);
    else { bad++; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + detail : '')); }
  };
  if (r.fatal) { console.error('probe fault in page:', r.fatal); process.exit(2); }
  ok('the room is built on the floor whose "+" was tapped',
    r.builtBay === r.tappedBay, 'tapped ' + r.tappedBay + ', built on ' + r.builtBay);
  ok('the lease quoted for that floor is the lease actually billed',
    r.leaseQuotedByFloor === r.leaseActuallyBilled,
    'quoted $' + r.leaseQuotedByFloor + ', billed $' + r.leaseActuallyBilled);
  ok('the row builds pointed at the station its own numbers were measured on',
    r.rowStation === r.builtStation && r.rowStation === r.bestProdStation,
    'row ' + r.rowStation + ', built ' + r.builtStation + ', best ' + r.bestProdStation + ', viewed ' + r.viewedStation);
  ok('re-pointing the room does not move it to another floor',
    r.afterMoveBay === r.builtBay && r.afterMoveStation !== r.builtStation,
    'bay ' + r.builtBay + ' -> ' + r.afterMoveBay + ', station ' + r.builtStation + ' -> ' + r.afterMoveStation);
  console.log('\n' + JSON.stringify(r, null, 2));
  console.log('consoleErrors:', consoleErrors.length ? consoleErrors : 'none');
  try { ws.close(); } catch {}
  browser.kill();
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error('probe fault:', e.message); process.exit(2); });
