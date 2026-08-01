// Replay QA's hostile-save corpus against the hardened loader.
import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path';
import {fileURLToPath} from 'url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const GAME_FILE=path.join(HERE,'..','purr-and-power.html');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const GAME='file:///'+GAME_FILE.split('\\').join('/');
const PORT=9401, profile=path.join(os.tmpdir(),'pnp-host-'+Date.now());
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,
  '--no-first-run','--disable-gpu','--window-size=390,760','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let list; for(let i=0;i<40;i++){ try{ list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break;}catch(e){await sleep(250);} }
const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r));
let id=0; const pend=new Map(); let errs=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;}
  if(m.method==='Runtime.exceptionThrown')errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
});
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return {__err:r.result.exceptionDetails.exception?.description||'?'};
  return r.result?.result?.value;};
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate',{url:GAME}); await sleep(1500);

// build one good save to mutate
await ev('reallyNewGame()'); await sleep(500); await ev('closeMsg()');
await ev('for(let i=0;i<120;i++)advanceDay(); save();');
const good=await ev('localStorage.getItem("pnp_tycoon_v1")');

const CASES={
  'inv:null'          : d=>{d.inv=null;},
  'invest:null'       : d=>{d.invest=null;},
  'staff:null'        : d=>{d.staff=null;},
  'staff:object'      : d=>{d.staff={a:1};},
  'cats:null'         : d=>{d.cats=null;},
  'jobs:"x"'          : d=>{d.jobs="x";},
  'jobs:null'         : d=>{d.jobs=null;},
  'office:9'          : d=>{d.office=9;},
  'office:-1'         : d=>{d.office=-1;},
  'unknown staff role': d=>{d.staff=[{role:'wizard',name:'X',wage:1}];},
  'unknown event id'  : d=>{d.event='nope';d.eventName='Nope';},
  'history:[null]'    : d=>{d.history=[null];},
  'done:[null]'       : d=>{d.done=[null];},
  'inv missing keys'  : d=>{d.inv={panel:5};},
  'marketing:-500000' : d=>{d.marketing=-500000;},
  'trucks:-5'         : d=>{d.trucks=-5;},
  'cash:1e400'        : d=>{d.cash=1e400;},
  'cash:"lots"'       : d=>{d.cash="lots";},
  'loanRate:50'       : d=>{d.loanRate=50;},
  'morale:NaN'        : d=>{d.morale=null;},
  'cashHist junk'     : d=>{d.cashHist=[1,null,3,1e400,5];},
  'job stage 99'      : d=>{d.jobs=[{panels:10,stage:99,left:1,elapsed:1,promised:40}];},
  '10000 jobs'        : d=>{d.jobs=Array.from({length:10000},()=>({panels:10,stage:2,left:1,elapsed:1,promised:40}));},
  'v missing'         : d=>{delete d.v;},
  'v:99'              : d=>{d.v=99;},
};
const results=[];
for(const [name,mut] of Object.entries(CASES)){
  errs=[];
  const d=JSON.parse(good); mut(d);
  await ev(`localStorage.setItem("pnp_tycoon_v1",${JSON.stringify(JSON.stringify(d))})`);
  await send('Page.navigate',{url:GAME}); await sleep(900);
  const r1=await ev('continueGame()');
  await sleep(400);
  // walk every tab
  for(const t of ['office','sales','ops','site','finance']) await ev(`showTab('${t}')`);
  await ev('if(S){for(let i=0;i<20;i++)advanceDay();}');
  await sleep(200);
  const alive=await ev('!!S');
  const menuUp=await ev("!document.getElementById('menu').classList.contains('gone')");
  const cash=await ev('S?Math.round(S.cash):null');
  const finite=await ev('S?Number.isFinite(S.cash):true');
  const blank=await ev("document.getElementById('app').classList.contains('show') && document.getElementById('office-body').innerHTML.length<50");
  const ok = errs.length===0 && !blank && finite && (alive||menuUp);
  results.push({name,ok,alive,menuUp,cash,finite,blank,errs:errs.slice(0,1)});
}
// __proto__ separately (JSON.parse keeps it as an own key only via raw text)
for(const [nm,raw] of [
  ['__proto__ wageIndex', good.replace('{','{"__proto__":{"wageIndex":0.0001},')],
  ['__proto__ null',      good.replace('{','{"__proto__":null,')],
]){
  errs=[];
  await ev(`localStorage.setItem("pnp_tycoon_v1",${JSON.stringify(raw)})`);
  await send('Page.navigate',{url:GAME}); await sleep(900);
  await ev('continueGame()'); await sleep(300);
  const proto=await ev('S?(Object.getPrototypeOf(S)===Object.prototype):true');
  const wi=await ev('S?S.wageIndex:1');
  const wage=await ev("S?goingWage('lead'):-1");
  results.push({name:nm,ok:proto&&wage>0&&errs.length===0,proto,wi,wage,errs:errs.slice(0,1)});
}
// XSS
errs=[];
const x=JSON.parse(good);
x.leads=[{id:1,client:'<img src=zzz onerror="window.__pwned=1">',type:'Residential',icon:'🏠',panels:12,quality:'warm',mkt:1.4,days:9}];
x.staff=[{role:'lead',name:'<img src=q onerror="window.__pwned=2">',wage:3600,id:1}];
await ev(`localStorage.setItem("pnp_tycoon_v1",${JSON.stringify(JSON.stringify(x))})`);
await send('Page.navigate',{url:GAME}); await sleep(900);
await ev('continueGame()'); await sleep(300);
await ev("showTab('sales')"); await ev("showTab('office')"); await sleep(400);
const pwned=await ev('window.__pwned||0');
results.push({name:'XSS via crafted save',ok:!pwned,pwned});

const bad=results.filter(r=>!r.ok);
for(const r of results) console.log((r.ok?'PASS  ':'FAIL  ')+r.name.padEnd(22)+
  (r.ok?'':JSON.stringify(r)));
console.log(`\n${results.length-bad.length}/${results.length} hostile saves handled gracefully`);
ws.close(); chrome.kill(); try{fs.rmSync(profile,{recursive:true,force:true});}catch(e){}
process.exit(bad.length?1:0);
