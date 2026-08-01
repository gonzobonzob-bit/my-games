// Run the real simulation N times with a competent autoplayer and report the
// distribution. A tycoon should be losable but not a coin flip.
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const GAME_FILE=path.join(HERE,'..','purr-and-power.html');
const FILE=GAME_FILE;
const js=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');

function makeGame(){
  const fakeEl=()=>{const el={innerHTML:'',textContent:'',className:'',title:'',
    style:new Proxy({},{get:()=>'',set:()=>true}),
    classList:{add(){},remove(){},toggle(){},contains(){return true}},
    offsetWidth:340,offsetHeight:190,parentNode:null,children:[],
    appendChild(c){el.children.push(c);c.parentNode=el;return c;},
    removeChild(c){el.children=el.children.filter(x=>x!==c);},
    remove(){},getBoundingClientRect:()=>({left:0,top:0,width:10,height:10}),
    set onclick(v){},get firstChild(){return el.children[0];}};return el;};
  const ctx={
    document:{getElementById:fakeEl,querySelectorAll:()=>[],createElement:fakeEl,
      createElementNS:fakeEl,addEventListener(){},hidden:false,body:fakeEl(),head:fakeEl()},
    window:{addEventListener(){},innerWidth:380,innerHeight:700},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    setInterval:()=>0,clearInterval:()=>{},setTimeout:()=>0,
    console:{log(){}},Math,Date,JSON,Object,Array,String,Number,parseInt,parseFloat,isNaN,
  };
  ctx.globalThis=ctx;
  return new Function(...Object.keys(ctx), js+`
    ;return {S_ref:()=>S,reallyNewGame,advanceDay,costBasis,winChance,crewCount,jobCap,
      hire,buyInvest,upgradeOffice,materialCost,buyStock,borrow,adoptCat,catCap,MONTHS,money0,reallyNewGame};`
  )(...Object.values(ctx));
}

function play(years){
  const G=makeGame(); G.reallyNewGame(); const S=G.S_ref(); S.speed=0;
  let peak=0, capexDay=-99;
  for(let d=0;d<30*12*years;d++){
    const burn=S.staff.reduce((a,s)=>a+s.wage,0)+[2400,5200,9500][S.office]+S.trucks*640+S.marketing;
    // hire toward a balanced org
    const want=['designer','permit','rep','installer','lead','electric','coord','consult','service','warehouse','officemgr'];
    const target={designer:2,permit:2,rep:3,installer:6,lead:3,electric:3,coord:2,consult:2,service:1,warehouse:1,officemgr:1};
    for(const r of want){
      if(S.staff.filter(s=>s.role===r).length<target[r] && S.cash>burn*1.8
         && S.staff.length<[6,12,20][S.office]){ G.hire(r); break; }
    }
    // capex at most monthly, out of surplus
    if(d-capexDay>30 && S.cash>burn*5){
      if(S.office<2 && S.cash>burn*9) {G.upgradeOffice();capexDay=d;}
      else if(!S.invest.cert){G.buyInvest('cert');capexDay=d;}
      else if(S.trucks<4 && G.crewCount()>=S.trucks){G.buyInvest('truck');capexDay=d;}
      else if(!S.invest.exped){G.buyInvest('exped');capexDay=d;}
      else if(!S.invest.cad){G.buyInvest('cad');capexDay=d;}
      else if(!S.invest.wh){G.buyInvest('wh');capexDay=d;}
      else if(!S.invest.lic){G.buyInvest('lic');capexDay=d;}
      else if(!S.invest.batt){G.buyInvest('batt');capexDay=d;}
    }
    if(S.cash>burn*2 && S.cats.length<G.catCap()) G.adoptCat();
    if(S.cash<burn*1.2 && S.loan<40000) G.borrow(25000);
    // keep a little stock on hand
    if(S.cash>burn*3 && S.inv.panel<80) G.buyStock('panel',50),G.buyStock('opt',50),G.buyStock('rail',50);
    // bid within working capital
    for(const l of [...S.leads]){
      if(S.jobs.length+S.bids.length>=G.jobCap())break;
      const basis=G.costBasis(l.panels).total;
      let best=null;
      for(let m=15;m<=85;m+=5){
        const p=Math.round(basis*(1+m/100)), w=G.winChance(l,p), ev=w*(p-basis);
        if(!best||ev>best.ev)best={p,w};
      }
      const mats=G.materialCost(l.panels)*1.18;
      const committed=S.jobs.filter(j=>!j.matsPaid).reduce((a,j)=>a+G.materialCost(j.panels)*1.18,0);
      if(S.cash+best.p*0.35-mats-committed<20000) continue;
      S.bids.push({leadId:l.id,client:l.client,type:l.type,icon:l.icon,panels:l.panels,
                   price:best.p,chance:best.w,wait:3});
      S.leads=S.leads.filter(x=>x!==l);
    }
    try{ G.advanceDay(); }catch(e){ return {err:e.message}; }
    peak=Math.max(peak,S.cash);
    if(S.bankrupt) return {bankrupt:true,months:(S.year-1)*12+S.month,jobs:S.jobsDone,peak,cash:S.cash,
      rep:Math.round(S.rep),morale:Math.round(S.morale),staff:S.staff.length,crews:G.crewCount(),
      office:S.office,payroll:S.staff.reduce((a,s)=>a+s.wage,0),late:S.jobsLate,
      inflight:S.jobs.length,blocked:S.jobs.filter(j=>j.blocked).map(j=>j.blocked),
      lastMonths:S.history.slice(0,3).map(h=>`${h.label}:${Math.round(h.net/1000)}k`),
      loan:Math.round(S.loan)};
  }
  return {bankrupt:false,months:12*years,jobs:S.jobsDone,late:S.jobsLate,peak,
          cash:S.cash,rep:Math.round(S.rep),rev:S.totalRevenue,staff:S.staff.length};
}

const N=40, YEARS=4;
const res=[]; let errs=[];
for(let i=0;i<N;i++){ const r=play(YEARS); if(r.err){errs.push(r.err);} else res.push(r); }
const survived=res.filter(r=>!r.bankrupt);
const died=res.filter(r=>r.bankrupt);
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]??0;};

console.log(`runs ${N} × ${YEARS} years`);
console.log(`errors            : ${errs.length?errs.slice(0,3):'none'}`);
console.log(`survived 4 years  : ${survived.length}/${res.length}  (${Math.round(survived.length/res.length*100)}%)`);
console.log(`went bankrupt     : ${died.length}  median month of death: ${med(died.map(d=>d.months))}`);
if(survived.length){
  console.log(`  median end cash : ${survived[0]&&med(survived.map(r=>r.cash)).toLocaleString()}`);
  console.log(`  median jobs done: ${med(survived.map(r=>r.jobs))}   late: ${med(survived.map(r=>r.late))}`);
  console.log(`  median revenue  : $${med(survived.map(r=>Math.round(r.rev))).toLocaleString()}`);
  console.log(`  median rep      : ${med(survived.map(r=>r.rep))}   median staff: ${med(survived.map(r=>r.staff))}`);
}
if(died.length){
  console.log(`  bankrupt runs peaked at median $${med(died.map(d=>Math.round(d.peak))).toLocaleString()} before dying`);
  console.log(`  at death — median staff ${med(died.map(d=>d.staff))}, crews ${med(died.map(d=>d.crews))}, `+
    `payroll $${med(died.map(d=>d.payroll)).toLocaleString()}/mo, office tier ${med(died.map(d=>d.office))+1}`);
  console.log(`  at death — median rep ${med(died.map(d=>d.rep))}, morale ${med(died.map(d=>d.morale))}, `+
    `in-flight ${med(died.map(d=>d.inflight))}, done ${med(died.map(d=>d.jobs))}, late ${med(died.map(d=>d.late))}`);
  const allBlocked=died.flatMap(d=>d.blocked);
  const tally={}; allBlocked.forEach(b=>tally[b]=(tally[b]||0)+1);
  console.log(`  blockers at death :`,tally);
  console.log(`  sample last months:`,died.slice(0,4).map(d=>d.lastMonths.join(' ')));
}
