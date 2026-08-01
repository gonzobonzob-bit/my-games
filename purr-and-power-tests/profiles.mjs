import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const GAME_FILE=path.join(HERE,'..','purr-and-power.html');
const FILE=GAME_FILE;
const js=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
function makeGame(){
  const fakeEl=()=>{const el={innerHTML:'',textContent:'',className:'',title:'',
    style:new Proxy({},{get:()=>'',set:()=>true}),classList:{add(){},remove(){},toggle(){},contains:()=>true},
    offsetWidth:340,offsetHeight:190,parentNode:null,children:[],
    appendChild(c){el.children.push(c);c.parentNode=el;return c;},
    removeChild(c){el.children=el.children.filter(x=>x!==c);},remove(){},
    getBoundingClientRect:()=>({left:0,top:0,width:10,height:10}),
    set onclick(v){},get firstChild(){return el.children[0];}};return el;};
  const ctx={document:{getElementById:fakeEl,querySelectorAll:()=>[],createElement:fakeEl,
      createElementNS:fakeEl,addEventListener(){},hidden:false,body:fakeEl(),head:fakeEl()},
    window:{addEventListener(){},innerWidth:380,innerHeight:700},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    setInterval:()=>0,clearInterval:()=>{},setTimeout:()=>0,
    console:{log(){}},Math,Date,JSON,Object,Array,String,Number,parseInt,parseFloat,isNaN};
  ctx.globalThis=ctx;
  return new Function(...Object.keys(ctx), js+`;return {S_ref:()=>S,reallyNewGame,advanceDay,costBasis,
    winChance,crewCount,jobCap,hire,buyInvest,upgradeOffice,materialCost,buyStock,borrow,adoptCat,catCap};`
  )(...Object.values(ctx));
}
function play(years,P){
  const G=makeGame(); G.reallyNewGame(); const S=G.S_ref(); S.speed=0;
  let capexDay=-99;
  for(let d=0;d<30*12*years;d++){
    const burn=S.staff.reduce((a,s)=>a+s.wage,0)+[2400,5200,9500][S.office]+S.trucks*640+S.marketing;
    const want=['designer','permit','rep','installer','lead','electric','coord','consult','service','warehouse','officemgr'];
    const tg={designer:2,permit:2,rep:3,installer:6,lead:3,electric:3,coord:2,consult:2,service:1,warehouse:1,officemgr:1};
    for(const r of want){
      if(S.staff.filter(s=>s.role===r).length<tg[r] && S.cash>burn*(P.cushion) &&
         S.staff.length<[6,12,20][S.office]){ G.hire(r); break; } }
    if(d-capexDay>30 && S.cash>burn*5){
      if(S.office<2&&S.cash>burn*9){G.upgradeOffice();capexDay=d;}
      else if(!S.invest.cert){G.buyInvest('cert');capexDay=d;}
      else if(S.trucks<4&&G.crewCount()>=S.trucks){G.buyInvest('truck');capexDay=d;}
      else if(!S.invest.exped){G.buyInvest('exped');capexDay=d;}
      else if(!S.invest.wh){G.buyInvest('wh');capexDay=d;}
      else if(!S.invest.lic){G.buyInvest('lic');capexDay=d;} }
    if(P.cats && S.cash>burn*2 && S.cats.length<G.catCap()) G.adoptCat();
    if(P.credit && S.cash<burn*1.2 && S.loan<40000) G.borrow(25000);
    if(P.stock && S.cash>burn*3 && S.inv.panel<80){G.buyStock('panel',50);G.buyStock('opt',50);G.buyStock('rail',50);}
    for(const l of [...S.leads]){
      if(S.jobs.length+S.bids.length>=G.jobCap())break;
      const basis=G.costBasis(l.panels).total;
      let bid;
      if(P.lowball) bid={p:Math.round(basis*1.20),w:G.winChance(l,Math.round(basis*1.20))};
      else { let best=null;
        for(let m=15;m<=85;m+=5){const p=Math.round(basis*(1+m/100)),w=G.winChance(l,p),ev=w*(p-basis);
          if(!best||ev>best.ev)best={p,w,ev};} bid=best; }
      if(P.wc){ const mats=G.materialCost(l.panels)*1.18;
        const com=S.jobs.filter(j=>!j.matsPaid).reduce((a,j)=>a+G.materialCost(j.panels)*1.18,0);
        if(S.cash+bid.p*0.35-mats-com<20000) continue; }
      S.bids.push({leadId:l.id,client:l.client,type:l.type,icon:l.icon,panels:l.panels,
                   price:bid.p,chance:bid.w,wait:3});
      S.leads=S.leads.filter(x=>x!==l); }
    try{ G.advanceDay(); }catch(e){ return {err:e.message}; }
    if(S.bankrupt) return {dead:true,m:(S.year-1)*12+S.month};
  }
  return {dead:false,cash:S.cash,jobs:S.jobsDone};
}
const PROFILES={
  'competent (prices to EV, checks working capital, uses credit)':{cushion:1.8,cats:1,credit:1,stock:1,wc:1},
  'lowballer  (always bids 20% margin to win everything)'        :{cushion:1.8,cats:1,credit:1,stock:1,wc:1,lowball:1},
  'reckless   (no working-capital check, no credit line)'        :{cushion:1.1,cats:1,stock:0,wc:0},
  'neglectful (never adopts a cat, thin cash cushion)'           :{cushion:1.1,cats:0,credit:1,stock:1,wc:1},
};
const N=30;
for(const [name,P] of Object.entries(PROFILES)){
  const r=[]; for(let i=0;i<N;i++)r.push(play(4,P));
  const errs=r.filter(x=>x.err);
  const dead=r.filter(x=>x.dead);
  const alive=r.filter(x=>!x.dead&&!x.err);
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]??0;};
  console.log(`${name}`);
  console.log(`   survive ${alive.length}/${N} (${Math.round(alive.length/N*100)}%)`+
    (alive.length?`  median end cash $${Math.round(med(alive.map(x=>x.cash))).toLocaleString()}  jobs ${med(alive.map(x=>x.jobs))}`:'')+
    (dead.length?`  median death month ${med(dead.map(x=>x.m))}`:'')+
    (errs.length?`  ERRORS ${errs.length}: ${errs[0].err}`:''));
}
