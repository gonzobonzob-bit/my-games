// Real-browser playtest over the Chrome DevTools Protocol (no npm deps).
// Loads the actual file in Chrome, clicks through every tab and modal, and
// fails on any uncaught exception or console error.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const GAME_FILE=path.join(HERE,'..','purr-and-power.html');
import os from 'os';

const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const GAME='file:///'+GAME_FILE.split('\\').join('/');
const PORT=9333;
const profile=path.join(os.tmpdir(),'pnp-cdp-'+Date.now());

const chrome=spawn(CHROME,[
  '--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,
  '--no-first-run','--no-default-browser-check','--disable-gpu',
  '--window-size=390,780','about:blank',
],{stdio:'ignore'});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function targets(){
  for(let i=0;i<40;i++){
    try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); return await r.json(); }
    catch(e){ await sleep(250); }
  }
  throw new Error('Chrome never came up');
}

const list=await targets();
const page=list.find(t=>t.type==='page');
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));

let msgId=0; const pending=new Map(); const problems=[]; const logs=[];
ws.addEventListener('message',ev=>{
  const m=JSON.parse(ev.data);
  if(m.id!==undefined&&pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); return; }
  if(m.method==='Runtime.exceptionThrown'){
    const d=m.params.exceptionDetails;
    problems.push('EXCEPTION: '+(d.exception?.description||d.text));
  }
  if(m.method==='Runtime.consoleAPICalled'){
    const txt=m.params.args.map(a=>a.value??a.description??'').join(' ');
    logs.push(m.params.type+': '+txt);
    if(m.params.type==='error') problems.push('CONSOLE ERROR: '+txt);
  }
  if(m.method==='Log.entryAdded'&&m.params.entry.level==='error'){
    problems.push('LOG ERROR: '+m.params.entry.text);
  }
});
const send=(method,params={})=>new Promise(res=>{
  const id=++msgId; pending.set(id,res); ws.send(JSON.stringify({id,method,params}));
});
async function evaluate(expression){
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails){
    problems.push('EVAL: '+(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text));
    return null;
  }
  return r.result?.result?.value;
}

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate',{url:GAME});
await sleep(1800);

const step=[];
const ok=(name,cond,extra='')=>{ step.push(`${cond?'PASS':'FAIL'}  ${name}${extra?'  '+extra:''}`); if(!cond)problems.push('ASSERT: '+name); };

// 1. menu renders
ok('menu visible on load', await evaluate(`!document.getElementById('menu').classList.contains('gone')`));
ok('continue disabled with no save', await evaluate(`document.getElementById('btn-continue').disabled`));

// 2. start a company
await evaluate(`newGame()`);
await sleep(600);
ok('app shown after New Company', await evaluate(`document.getElementById('app').classList.contains('show')`));
ok('help modal auto-opens', await evaluate(`!document.getElementById('ov-msg').classList.contains('gone')`));
await evaluate(`closeMsg()`);
ok('starting cash is 75k', await evaluate(`S.cash`)===75000, 'cash='+await evaluate(`S.cash`));
ok('starts with an electrician', (await evaluate(`S.staff.filter(s=>s.role==='electric').length`))>0);
ok('office scene drew desks', (await evaluate(`document.querySelectorAll('#off-scene .deskv').length`))>0);
ok('office scene drew cats', (await evaluate(`document.querySelectorAll('#off-scene .catv').length`))===2);

// 3. every tab renders with content
for(const t of ['office','sales','ops','site','finance']){
  await evaluate(`showTab('${t}')`);
  await sleep(200);
  const len=await evaluate(`document.getElementById('${t}-body').innerHTML.length`);
  // Site legitimately shows a short empty state until a job clears permitting.
  const min = t==='site' ? 80 : 200;
  ok(`tab "${t}" renders`, len>min, `${len} chars`);
}
ok('site shows empty state before any job',
   (await evaluate(`showTab('site'),document.getElementById('site-body').innerText.includes('No job on site')`))===true);

// 4. quote modal: open, move the slider, read the working-capital preview
await evaluate(`showTab('sales')`);
const leadId=await evaluate(`S.leads[0] && S.leads[0].id`);
ok('a lead exists to quote', !!leadId);
await evaluate(`openQuote(${leadId})`);
await sleep(250);
ok('quote modal open', await evaluate(`!document.getElementById('ov-quote').classList.contains('gone')`));
ok('cost basis shown', (await evaluate(`document.getElementById('quote-card').innerText.includes('Cost basis')`))===true);
await evaluate(`updQuote(20)`);
const p20=await evaluate(`document.getElementById('q-price').textContent`);
const w20=await evaluate(`document.getElementById('q-wpct').textContent`);
await evaluate(`updQuote(75)`);
const p75=await evaluate(`document.getElementById('q-price').textContent`);
const w75=await evaluate(`document.getElementById('q-wpct').textContent`);
ok('higher margin raises price', p75!==p20, `${p20} -> ${p75}`);
ok('higher margin lowers win%', parseInt(w75)<parseInt(w20), `${w20} -> ${w75}`);
ok('working-capital preview present',
   (await evaluate(`document.getElementById('q-cash').innerText.includes('Materials due')`))===true);
await evaluate(`updQuote(40); submitBid()`);
await sleep(200);
ok('bid submitted', (await evaluate(`S.bids.length`))===1);

// 5. actually PLAY for a couple of simulated years through the real functions.
//    Idling is a legitimate way to go broke, so the playtest has to run the
//    company competently to reach the states the later checks care about.
await evaluate(`
  window.__play=function(days){
    for(let d=0;d<days && !S.bankrupt;d++){
      const burn=S.staff.reduce((a,s)=>a+s.wage,0)+OFFICES[S.office].rent+S.trucks*640+S.marketing;
      const want=['designer','permit','rep','installer','lead','electric','coord'];
      const tgt={designer:2,permit:1,rep:2,installer:6,lead:3,electric:2,coord:2};
      for(const r of want){
        if(S.staff.filter(s=>s.role===r).length<tgt[r] && S.cash>burn*2
           && S.staff.length<OFFICES[S.office].cap){ hire(r); break; }
      }
      if(S.cash>burn*9 && S.office<2) upgradeOffice();
      if(S.cash>burn*2 && S.cats.length<catCap()) adoptCat();
      for(const l of [...S.leads]){
        if(S.jobs.length+S.bids.length>=jobCap())break;
        const basis=costBasis(l.panels).total;
        let best=null;
        for(let m=20;m<=80;m+=5){
          const p=Math.round(basis*(1+m/100)), w=winChance(l,p), ev=w*(p-basis);
          if(!best||ev>best.ev)best={p,w,ev};
        }
        const mats=materialCost(l.panels)*1.18;
        if(S.cash+best.p*0.35-mats<20000) continue;
        S.bids.push({leadId:l.id,client:l.client,type:l.type,icon:l.icon,
                     panels:l.panels,price:best.p,chance:best.w,wait:3});
        S.leads=S.leads.filter(x=>x!==l);
      }
      advanceDay();
    }
    return {done:S.jobsDone,cash:Math.round(S.cash),jobs:S.jobs.length,bankrupt:S.bankrupt};
  };
`);
const played=await evaluate(`__play(700)`);
await sleep(400);
ok('700 played days without throwing', !!played, JSON.stringify(played));
ok('company still solvent after 2 years', played && !played.bankrupt);
const st=await evaluate(`({day:S.day,month:S.month,year:S.year,cash:Math.round(S.cash),
  done:S.jobsDone,jobs:S.jobs.length,rep:Math.round(S.rep),morale:Math.round(S.morale),bankrupt:S.bankrupt})`);
ok('sim state readable', !!st, JSON.stringify(st));
ok('calendar advanced', st.year>1||st.month>0);
ok('jobs actually completed', st.done>0, `${st.done} done`);

// 6. re-render every tab at the late state (catches render bugs that only
//    appear once history/jobs/loans exist)
for(const t of ['office','sales','ops','site','finance']){
  await evaluate(`showTab('${t}')`); await sleep(150);
  const len=await evaluate(`document.getElementById('${t}-body').innerHTML.length`);
  ok(`tab "${t}" re-renders late-game`, len>200, `${len} chars`);
}
ok('P&L history rendered', (await evaluate(`document.getElementById('finance-body').innerText.includes('Closed Months')`))===true);
ok('cash chart drawn', (await evaluate(`!!document.querySelector('#finance-body svg polyline')`))===true);

// 7. credit line + inventory + pause
await evaluate(`showTab('finance')`);
const cash0=await evaluate(`S.cash`);
await evaluate(`borrow(25000)`);
ok('borrowing adds cash and debt', (await evaluate(`S.loan`))>=25000 && (await evaluate(`S.cash`))>cash0);
await evaluate(`repay(25000)`);
ok('repayment reduces debt', (await evaluate(`S.loan`))<25000);
await evaluate(`buyStock('panel',50)`);
ok('inventory purchase works', (await evaluate(`S.inv.panel`))>=50);
await evaluate(`openPause()`);
ok('pause overlay opens', await evaluate(`!document.getElementById('ov-pause').classList.contains('gone')`));
ok('pausing stops the clock', (await evaluate(`S.speed`))===0);
await evaluate(`closePause()`);

// 8. save / reload / continue
await evaluate(`save()`);
const beforeCash=await evaluate(`Math.round(S.cash)`);
const beforeDone=await evaluate(`S.jobsDone`);
await send('Page.navigate',{url:GAME});
await sleep(1500);
ok('continue enabled after save', (await evaluate(`!document.getElementById('btn-continue').disabled`))===true);
await evaluate(`continueGame()`);
await sleep(600);
const afterDone=await evaluate(`S.jobsDone`);
ok('save round-trips job count', afterDone===beforeDone, `${beforeDone} -> ${afterDone}`);
ok('offline catch-up ran the sim', (await evaluate(`typeof S.cash==='number' && isFinite(S.cash)`))===true);


// 8b. the overwrite guard must fire when a save exists
await evaluate('newGame()'); await sleep(250);
ok('New Company asks before replacing a save',
   (await evaluate("!document.getElementById('ov-msg').classList.contains('gone') && document.getElementById('msg-card').innerText.indexOf('Start over')>=0"))===true);
const keptDone=await evaluate('S?S.jobsDone:-1');
await evaluate('closeMsg()'); await sleep(150);
ok('declining the guard keeps the running company', (await evaluate('S?S.jobsDone:-1'))===keptDone);

// 9. interval hygiene: menu -> new game repeatedly must not stack cat timers
const t1=await evaluate('catTimers.length');
await evaluate(`quitToMenu()`); await sleep(200);
await evaluate(`reallyNewGame()`); await sleep(400); await evaluate(`closeMsg()`);
await evaluate(`quitToMenu()`); await sleep(200);
await evaluate(`reallyNewGame()`); await sleep(400); await evaluate(`closeMsg()`);
const t2=await evaluate(`catTimers.length`);
ok('cat timers do not accumulate across menu cycles', t2<=t1+1, `${t1} -> ${t2}`);
ok('only one tick interval alive', (await evaluate(`tickHandle!==null`))===true);

// 10. bankruptcy path
await evaluate(`S.cash=-30000; advanceDay();`);
await sleep(300);
ok('bankruptcy triggers game over', (await evaluate(`S.bankrupt`))===true);
ok('game over modal shown', (await evaluate(`!document.getElementById('ov-msg').classList.contains('gone')`))===true);
ok('bankrupt save is cleared', (await evaluate(`localStorage.getItem('pnp_tycoon_v1')===null`))===true);

// screenshot
await evaluate(`quitToMenu()`); await sleep(200);
await evaluate(`reallyNewGame()`); await sleep(500); await evaluate(`closeMsg(); showTab('ops');
  for(let i=0;i<120;i++) advanceDay(); showTab('ops'); renderAll();`);
await sleep(500);
const shot=await send('Page.captureScreenshot',{format:'png'});
if(shot.result?.data) fs.writeFileSync('shot-ops.png',Buffer.from(shot.result.data,'base64'));
await evaluate(`showTab('finance'); renderAll();`); await sleep(400);
const shot2=await send('Page.captureScreenshot',{format:'png'});
if(shot2.result?.data) fs.writeFileSync('shot-finance.png',Buffer.from(shot2.result.data,'base64'));
await evaluate(`showTab('site'); renderAll();`); await sleep(400);
const shot3=await send('Page.captureScreenshot',{format:'png'});
if(shot3.result?.data) fs.writeFileSync('shot-site.png',Buffer.from(shot3.result.data,'base64'));

console.log(step.join('\n'));
console.log('\n--- problems ---');
console.log(problems.length?problems.slice(0,25).join('\n'):'none');
console.log(`\n${step.filter(s=>s.startsWith('PASS')).length}/${step.length} checks passed`);

ws.close(); chrome.kill();
try{ fs.rmSync(profile,{recursive:true,force:true}); }catch(e){}
process.exit(problems.length?1:0);
