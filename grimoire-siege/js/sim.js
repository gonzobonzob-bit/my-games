// Grimoire Siege — sim: game state, path, saves, waves, economy, combat update
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing top-level scope; load order: content, sim, fx, ui.
//
// Squad-1 overhaul (CONTRACT.md): generateWave + resist profiles, nextWaveDef
// preview, resistance-reduced damage (direct/chain/DoT), per-kind leak costs,
// invested-gold score, branch upgrades, endless mode, settings, save schema v2.

let canvas,ctx,W,H,gameWrapEl,dpr=1;
let bgCanvas,bgCtx;
let towers=[],enemies=[],projectiles=[],particles=[],floaters=[],embers=[];
let gold=START_GOLD,lives=START_LIVES,wave=0,kills=0,waveActive=false;
let selectedTower=null,selectedPlacedTower=null,frame=0,now=0;
let path=[],pathCum=[],pathTotal=0;
let paused=false,gameSpeed=1;
let waveState=null;
let hoverX=null,hoverY=null;
let autosaveIntervalId=null;
let gameStarted=false;
let shake=0,damageFlash=0,crystalHit=0;
let resizeTimer=null;

// --- New run-scoped state (overhaul) ---
// investedGold: lifetime gold spent on placements + upgrades this run. The old
// score used *raw* gold, which rewarded hoarding; invested gold rewards building.
let investedGold=0;
// nextWaveDef: generated at *schedule* time so the ui preview panel exists for
// the whole gap (the read-and-react moment the design hangs on).
let nextWaveDef=null;
// Endless flow: after the scripted waves clear, sim stops scheduling and offers
// the choice; ui calls beginEndless() or claimVictory().
let endlessOffered=false,endlessMode=false;
// settings global: sim owns persistence, ui owns the widgets, fx reads values.
let settings={volume:1,shake:true};
// Internal: marks that run-scoped globals were (re)initialised for this run.
let simRunActive=false;

// Save keys. v2 is ours; the v1 key is hardcoded here as the legacy migration
// source so a content.js rename of its old SAVE_KEY const cannot break migration.
const SAVE_KEY_V2='grimoireSiege_save_v2';
const SAVE_KEY_V1_LEGACY='grimoireSiege_save_v1';

// DoT damage per tick derives from the firing tower's scaled damage (replaces
// flat DOT_DAMAGE). Tick every DOT_INTERVAL (0.5s) at dmg*0.5 per tick means a
// single un-stacked DoT deals the tower's displayed dmg per second, pre-resist.
const DOT_FROM_DMG=0.5;

// The first and last waypoints are inset from the canvas edge so the spawn
// portal and the crystal are drawn whole rather than clipped in half.
function buildPath(W,H){
  return [
    {x:20,y:H*0.25},{x:W*0.2,y:H*0.25},{x:W*0.2,y:H*0.6},
    {x:W*0.5,y:H*0.6},{x:W*0.5,y:H*0.2},{x:W*0.75,y:H*0.2},
    {x:W*0.75,y:H*0.75},{x:W-26,y:H*0.75}
  ];
}

function computePathCum(){
  pathCum=[0];
  for(let i=1;i<path.length;i++){
    pathCum.push(pathCum[i-1]+Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y));
  }
  pathTotal=pathCum[pathCum.length-1]||1;
}

// Distance already travelled along the path — used to target the enemy
// that is furthest along (closest to the crystal) instead of array order.
function enemyProgress(e){
  const idx=Math.min(e.pathIdx,pathCum.length-1);
  return pathCum[idx]+Math.hypot(e.x-path[idx].x,e.y-path[idx].y);
}

// ---------------- Save / persistence ----------------
// Saves are untrusted input: every field is validated individually, every
// number clamped, nothing is spread/Object.assign-ed from JSON.parse (a parsed
// own __proto__ must never reparent state), and any failure degrades to a
// fresh start.
function hasOwn(o,k){ return Object.prototype.hasOwnProperty.call(o,k); }
function numClamp(v,def,min,max){
  // Number(null) is 0, not NaN — without this guard a nulled field clamps to
  // the range floor instead of falling back to its default.
  if(v===null||v===undefined)return def;
  const n=Number(v);
  if(!Number.isFinite(n))return def;
  return Math.min(max,Math.max(min,n));
}

function defaultSettings(){ return {volume:1,shake:true}; }
function sanitizeSettings(raw){
  const out=defaultSettings();
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
    out.volume=numClamp(raw.volume,out.volume,0,1);
    if(typeof raw.shake==='boolean')out.shake=raw.shake;
  }
  return out;
}

// Shared checkpoint sanitizer for v1 and v2 payloads. Keeps the legacy-pixel
// tower coordinate path (ct.x/ct.y) alive alongside normalised nx/ny.
function sanitizeCheckpoint(raw){
  try{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const towersOut=[];
    if(Array.isArray(raw.towers)){
      const lim=Math.min(raw.towers.length,200);
      for(let i=0;i<lim;i++){
        const ct=raw.towers[i];
        if(!ct||typeof ct!=='object'||Array.isArray(ct))continue;
        if(typeof ct.id!=='string'||ct.id.length===0||ct.id.length>40)continue;
        const entry={
          id:ct.id,
          level:Math.round(numClamp(ct.level,0,0,10)),
          invested:Math.round(numClamp(ct.invested,0,0,1e7)),
          branch:(ct.branch==='a'||ct.branch==='b')?ct.branch:null
        };
        const nx=Number(ct.nx),ny=Number(ct.ny);
        if(Number.isFinite(nx)&&Number.isFinite(ny)){
          entry.nx=Math.min(1,Math.max(0,nx));
          entry.ny=Math.min(1,Math.max(0,ny));
        }else{
          // Older saves stored absolute pixels; keep that migration path.
          const x=Number(ct.x),y=Number(ct.y);
          if(!Number.isFinite(x)||!Number.isFinite(y))continue;
          entry.x=Math.min(8192,Math.max(0,x));
          entry.y=Math.min(8192,Math.max(0,y));
        }
        towersOut.push(entry);
      }
    }
    // A checkpoint carrying no usable run at all (no numeric core fields, no
    // towers) is hostile or corrupt, not old — reject it so Continue offers a
    // fresh start instead of a 0-gold ghost run.
    const hasCore=[raw.gold,raw.lives,raw.wave,raw.kills].some(v=>Number.isFinite(Number(v))&&v!==null);
    if(!hasCore&&towersOut.length===0)return null;
    // Tolerate missing investedGold (v1 checkpoints): derive a lower bound
    // from the surviving towers' invested totals.
    let inv=hasOwn(raw,'investedGold')?numClamp(raw.investedGold,-1,0,1e9):-1;
    if(inv<0)inv=towersOut.reduce((a,t)=>a+(t.invested||0),0);
    return {
      gold:Math.round(numClamp(raw.gold,START_GOLD,0,1e7)),
      lives:Math.round(numClamp(raw.lives,START_LIVES,1,999)),
      kills:Math.round(numClamp(raw.kills,0,0,1e6)),
      wave:Math.round(numClamp(raw.wave,1,1,9999)),
      investedGold:Math.round(Math.min(1e9,Math.max(0,inv))),
      endless:raw.endless===true,
      towers:towersOut
    };
  }catch(e){
    return null;
  }
}

function freshSave(){
  return {version:2,bestWave:0,highScore:0,settings:defaultSettings(),checkpoint:null};
}

// Field-by-field build of a v2 save from any parsed payload.
function sanitizeSaveV2(data){
  const out=freshSave();
  if(!data||typeof data!=='object'||Array.isArray(data))return out;
  out.bestWave=Math.round(numClamp(data.bestWave,0,0,9999));
  out.highScore=Math.round(numClamp(data.highScore,0,0,1e9));
  out.settings=sanitizeSettings(hasOwn(data,'settings')?data.settings:null);
  out.checkpoint=hasOwn(data,'checkpoint')?sanitizeCheckpoint(data.checkpoint):null;
  return out;
}

function loadSave(){
  try{
    const raw=localStorage.getItem(SAVE_KEY_V2);
    if(raw){
      const data=JSON.parse(raw);
      return sanitizeSaveV2(data);
    }
    // --- v1 migration: read the old key, map field by field, keep
    // bestWave/highScore, default the fields v1 never had. ---
    const rawV1=localStorage.getItem(SAVE_KEY_V1_LEGACY);
    if(rawV1){
      const old=JSON.parse(rawV1);
      const migrated=sanitizeSaveV2(old); // same shape minus the new fields, all defaulted
      try{ localStorage.setItem(SAVE_KEY_V2,JSON.stringify(migrated)); }catch(e){}
      return migrated;
    }
    return freshSave();
  }catch(e){
    console.warn('Grimoire Siege: save load failed, starting fresh',e);
    return freshSave();
  }
}

function writeSave(patch){
  try{
    const cur=loadSave();
    const p=(patch&&typeof patch==='object')?patch:{};
    const next={
      version:2,
      bestWave:Math.round(numClamp(hasOwn(p,'bestWave')?p.bestWave:cur.bestWave,0,0,9999)),
      highScore:Math.round(numClamp(hasOwn(p,'highScore')?p.highScore:cur.highScore,0,0,1e9)),
      settings:sanitizeSettings(hasOwn(p,'settings')?p.settings:cur.settings),
      checkpoint:hasOwn(p,'checkpoint')?sanitizeCheckpoint(p.checkpoint):cur.checkpoint
    };
    localStorage.setItem(SAVE_KEY_V2,JSON.stringify(next));
  }catch(e){
    console.warn('Grimoire Siege: save write failed',e);
  }
}

// ui writes the `settings` global from its widgets, then calls this.
function saveSettings(){
  writeSave({settings:{volume:settings.volume,shake:settings.shake}});
}

// Checkpoints capture the run at the last wave boundary (not mid-wave):
// resuming always restarts the in-progress wave fresh rather than trying
// to reconstruct exact enemy/projectile state. Tower positions are stored
// normalised (0-1) so a checkpoint survives a different window size.
function saveCheckpoint(){
  if(!gameStarted||lives<=0)return;
  try{
    let resumeWave=waveActive?wave:wave+1;
    if(!endlessMode)resumeWave=Math.min(resumeWave,baseWaveCount());
    const checkpoint={
      gold,lives,kills,wave:resumeWave,
      investedGold,
      endless:endlessMode,
      towers:towers.map(t=>({id:t.id,nx:t.x/W,ny:t.y/H,level:t.level||0,invested:t.invested||t.cost,branch:t.branch||null}))
    };
    writeSave({checkpoint});
  }catch(e){
    console.warn('Grimoire Siege: autosave failed',e);
  }
}

function clearCheckpoint(){ writeSave({checkpoint:null}); }

// ui.js only restores gold/lives/kills/wave/towers from a checkpoint; the
// run-scoped globals the overhaul added (investedGold, endlessMode) are
// re-adopted here, on the first scheduleWave of a run. A fresh run resets
// them; a continued run (wave>0 at first schedule) re-reads the checkpoint.
function beginRunStateIfNeeded(){
  if(simRunActive)return;
  simRunActive=true;
  investedGold=0;endlessMode=false;endlessOffered=false;nextWaveDef=null;
  try{
    if(wave>0){
      const s=loadSave();
      if(s.checkpoint){
        investedGold=s.checkpoint.investedGold||0;
        endlessMode=s.checkpoint.endless===true&&wave>=baseWaveCount();
      }
    }
    // Floor: never let a continued run score less than what its standing
    // towers demonstrably cost.
    const towerInvested=towers.reduce((a,t)=>a+(t.invested||t.cost||0),0);
    investedGold=Math.max(investedGold,towerInvested);
  }catch(e){}
}

// ui spends gold on placements and plain upgrades; it reports the spend here
// so investedGold stays a true lifetime total (sold towers still count).
function recordInvestment(amount){
  const a=Number(amount);
  if(Number.isFinite(a)&&a>0)investedGold=Math.min(1e9,investedGold+Math.floor(a));
}

function recordRunEnd(){
  const save=loadSave();
  const bestWave=Math.max(save.bestWave,wave);
  // Score = kills*10 + wave*50 + investedGold. The old raw-gold term rewarded
  // hoarding; invested gold rewards actually building. The live-tower sum is a
  // defensive floor in case a placement path missed recordInvestment.
  const towerInvested=towers.reduce((a,t)=>a+(t.invested||t.cost||0),0);
  const invested=Math.max(investedGold,towerInvested);
  const score=kills*10+wave*50+invested;
  const highScore=Math.max(save.highScore,score);
  simRunActive=false;
  writeSave({bestWave,highScore,checkpoint:null});
  return {bestWave,highScore};
}

function isBlockedByPath(x,y){
  for(let i=0;i<path.length-1;i++){
    const A=path[i],B=path[i+1];
    const dx=B.x-A.x,dy=B.y-A.y;
    const len=Math.sqrt(dx*dx+dy*dy);
    if(len===0)continue;
    const nx=-dy/len,ny=dx/len;
    const px=x-A.x,py=y-A.y;
    const proj=(px*dx+py*dy)/(dx*dx+dy*dy);
    if(proj>=0&&proj<=1){
      const perpDist=Math.abs(px*nx+py*ny);
      if(perpDist<28)return true;
    }
  }
  return false;
}

function isValidPlacement(x,y){
  if(x<16||y<16||x>W-16||y>H-16)return false;
  if(isBlockedByPath(x,y))return false;
  if(towers.some(t=>Math.hypot(t.x-x,t.y-y)<35))return false;
  return true;
}

// ---------------- Tower upgrade / sell / branches ----------------
// Branch mods (BRANCHES[t.id][t.branch].mods) are pure multipliers applied on
// top of the level curve. Multipliers are validated per field: only finite,
// positive numbers on own properties are honoured.
function branchMods(t){
  const m={dmg:1,range:1,rate:1,aoe:1,chain:1,slowFactor:1,dotDamage:1,dotStacks:1};
  if(!t.branch)return m;
  if(typeof BRANCHES==='undefined'||!BRANCHES)return m;
  const spec=BRANCHES[t.id];
  const br=spec&&(t.branch==='a'||t.branch==='b')?spec[t.branch]:null;
  const mods=br&&br.mods&&typeof br.mods==='object'?br.mods:null;
  if(!mods)return m;
  for(const k in m){
    if(hasOwn(mods,k)){
      const v=Number(mods[k]);
      if(Number.isFinite(v)&&v>0)m[k]=v;
    }
  }
  return m;
}

function towerStats(t){
  const lvl=t.level||0;
  const m=branchMods(t);
  const dmg=Math.max(1,Math.round(t.dmg*(1+0.45*lvl)*m.dmg));
  return {
    dmg,
    range:Math.round(t.range*(1+0.12*lvl)*m.range),
    rate:Math.max(20,Math.round(t.rate*(1-0.15*lvl)*m.rate)),
    aoe:Math.round((t.aoe||0)*m.aoe),
    chain:Math.max(0,Math.round((t.chain||0)*m.chain)),
    slow:!!t.slow,
    // slowFactor is the speed multiplier applied while slowed — lower = stronger.
    slowFactor:t.slow?Math.min(1,Math.max(0.1,SLOW_FACTOR*m.slowFactor)):1,
    // DoT per-tick damage derives from the tower's *scaled* damage (level and
    // branch included), so Venom scales instead of dying at flat DOT_DAMAGE.
    dotDamage:t.dot?Math.max(1,Math.round(dmg*DOT_FROM_DMG*m.dotDamage)):0,
    dotStacks:t.dot?Math.max(1,Math.round(m.dotStacks)):0,
    dmgClass:(typeof t.dmgClass==='string'&&t.dmgClass)?t.dmgClass:'arcane'
  };
}
// `rate` is authored in 60ths of a second; convert to real seconds so fire
// rate no longer depends on the display's refresh rate.
function fireCooldown(t){ return towerStats(t).rate/60; }
function upgradeCost(t){ return Math.floor(t.cost*0.55*((t.level||0)+1)); }
function sellValue(t){ return Math.floor((t.invested||t.cost)*0.6); }

// The L1->L2 upgrade IS the branch pick: this performs the upgrade (charges
// upgradeCost, bumps level) and locks the branch in one action. Called by ui.
function chooseBranch(t,which){
  if(!t||!towers.includes(t))return false;
  if(which!=='a'&&which!=='b')return false;
  if(t.branch)return false;
  const lvl=t.level||0;
  if(lvl<1||lvl>=MAX_TOWER_LEVEL)return false;
  const spec=(typeof BRANCHES!=='undefined'&&BRANCHES&&BRANCHES[t.id])?BRANCHES[t.id][which]:null;
  if(!spec)return false;
  const cost=upgradeCost(t);
  if(gold<cost)return false;
  gold-=cost;
  t.level=lvl+1;
  t.branch=which;
  t.invested=(t.invested||t.cost)+cost;
  recordInvestment(cost);
  sfx('branch');
  ring(t.x,t.y,'#fbbf24',52,0.7);
  for(let i=0;i<14;i++)spark(t.x,t.y,t.color,3.2);
  floater(t.x,t.y-24,String(spec.name||'LV '+(t.level+1)),'#fbbf24');
  updateHUD();
  refreshGoldUI();
  saveCheckpoint();
  return true;
}

// ---------------- Wave generation ----------------
// A resist profile that resists nothing — the universal fallback so a missing
// or malformed RESIST_PROFILES entry can never crash spawning.
const FALLBACK_PROFILE={id:'none',name:'Unwarded',icon:'○',resists:{}};

function baseWaveCount(){
  if(typeof WAVE_SCRIPT!=='undefined'&&Array.isArray(WAVE_SCRIPT)&&WAVE_SCRIPT.length>0)return WAVE_SCRIPT.length;
  if(typeof WAVE_DEFS!=='undefined'&&Array.isArray(WAVE_DEFS)&&WAVE_DEFS.length>0)return WAVE_DEFS.length;
  return 12;
}

function waveScriptRows(){
  if(typeof WAVE_SCRIPT!=='undefined'&&Array.isArray(WAVE_SCRIPT)&&WAVE_SCRIPT.length>0)return WAVE_SCRIPT;
  // Load-order / integration safety: fall back to the legacy table so the sim
  // still runs (with no-resist waves) if content.js hasn't landed WAVE_SCRIPT.
  if(typeof WAVE_DEFS!=='undefined'&&Array.isArray(WAVE_DEFS)&&WAVE_DEFS.length>0)return WAVE_DEFS;
  return [];
}

// Resolve a profile id to a validated {id,name,icon,resists} object; resist
// fractions are clamped to 0..0.9 per damage class.
function resolveProfile(id){
  const list=(typeof RESIST_PROFILES!=='undefined'&&Array.isArray(RESIST_PROFILES))?RESIST_PROFILES:[];
  const p=list.find(x=>x&&typeof x==='object'&&x.id===id);
  if(!p)return FALLBACK_PROFILE;
  const classes=(typeof DAMAGE_CLASSES!=='undefined'&&Array.isArray(DAMAGE_CLASSES))?DAMAGE_CLASSES:['pierce','blast','arcane'];
  const resists={};
  for(const c of classes){
    if(typeof c!=='string')continue;
    const v=Number(p.resists&&typeof p.resists==='object'?p.resists[c]:0);
    resists[c]=Number.isFinite(v)?Math.min(0.9,Math.max(0,v)):0;
  }
  return {id:String(p.id),name:String(p.name||p.id),icon:String(p.icon||'◆'),resists};
}

// Pick `count` distinct profile ids from the pool (RNG at generation time —
// this is the roll the preview shows and the player reacts to).
function pickProfiles(pool,count){
  const ids=Array.isArray(pool)?pool.slice():[];
  const n=Math.max(1,Math.min(3,Math.round(Number(count))||1));
  const picked=[];
  while(picked.length<n&&ids.length>0){
    const i=Math.floor(Math.random()*ids.length);
    picked.push(ids.splice(i,1)[0]);
  }
  if(picked.length===0)return [FALLBACK_PROFILE];
  return picked.map(resolveProfile);
}

// generateWave(n): WAVE_SCRIPT rows for the scripted waves, ENDLESS scaling
// beyond. Returns {n,count,hp,spd,boss,fast,profiles:[profile,...]}.
function generateWave(n){
  try{
    const script=waveScriptRows();
    if(script.length>0&&n<=script.length){
      const row=script[n-1]||{};
      return {
        n,
        count:Math.max(1,Math.round(Number(row.count)||8)),
        hp:Math.max(1,Math.round(Number(row.hp)||60)),
        spd:Math.max(0.2,Number(row.spd)||1),
        boss:Math.max(0,Math.round(Number(row.boss)||0)),
        fast:Math.max(0,Math.round(Number(row.fast)||0)),
        profiles:pickProfiles(row.profilePool,row.profileCount)
      };
    }
    // ---- Endless scaling (waves past the script) ----
    // Anchored on the last scripted row; `over` = waves past the script.
    //   hp    = last.hp    * hpGrowth^over        (exponential — the clock)
    //   count = last.count * countGrowth^over     (capped at 60 for perf)
    //   spd   = last.spd + 0.03*over, capped at ENDLESS.spdCap
    //   boss  = last.boss + 1 per 3 endless waves (capped at 8)
    //   fast  = 15% of the wave runs fast
    // Counterbalance: bounty (12 + maxHp/16) scales with the same hp curve, so
    // income keeps pace with the difficulty ramp instead of starving the player.
    const E=(typeof ENDLESS!=='undefined'&&ENDLESS&&typeof ENDLESS==='object')?ENDLESS:{};
    const hpGrowth=numClamp(E.hpGrowth,1.14,1.01,2);
    const countGrowth=numClamp(E.countGrowth,1.04,1,1.5);
    const spdCap=numClamp(E.spdCap,1.9,1,4);
    const profileCountFrom=Math.round(numClamp(E.profileCountFrom,script.length+1,1,9999));
    const last=script[script.length-1]||{count:30,hp:400,spd:1.5,boss:3,fast:0};
    const over=Math.max(1,n-script.length);
    const hp=Math.max(1,Math.round((Number(last.hp)||400)*Math.pow(hpGrowth,over)));
    const count=Math.max(1,Math.min(60,Math.round((Number(last.count)||30)*Math.pow(countGrowth,over))));
    const spd=Math.min(spdCap,(Number(last.spd)||1.5)+0.03*over);
    const boss=Math.min(8,Math.max(0,Math.round(Number(last.boss)||3))+Math.floor(over/3));
    const fast=Math.floor(count*0.15);
    const list=(typeof RESIST_PROFILES!=='undefined'&&Array.isArray(RESIST_PROFILES))?RESIST_PROFILES:[];
    const pool=list.map(p=>p&&typeof p==='object'?p.id:null).filter(id=>typeof id==='string');
    const pc=n>=profileCountFrom?2:1;
    return {n,count,hp,spd,boss,fast,profiles:pickProfiles(pool,pc)};
  }catch(err){
    console.warn('Grimoire Siege: generateWave('+n+') failed, using fallback',err);
    return {n,count:Math.min(60,10+n),hp:60+n*30,spd:Math.min(1.9,1+n*0.04),
      boss:n%3===0?1:0,fast:0,profiles:[FALLBACK_PROFILE]};
  }
}

// ---------------- Waves ----------------
// Wave state tracks spawn progress explicitly: a wave is only "complete"
// once every enemy for it has been spawned (spawned>=total) AND the
// board is clear (enemies.length===0). The spawn setInterval handle is
// always stored and cleared before a new one is created, so waves can
// never overlap or stack spawn timers.
// The between-wave timer must be pause-aware: an untracked setTimeout(startWave)
// that fired while paused was swallowed by the guard and nothing rescheduled it —
// pausing (or alt-tabbing, which auto-pauses) during prep or a wave gap wedged
// the run permanently.
let pendingWaveTimer=null,wavePendingOnResume=false;
function scheduleWave(delay){
  beginRunStateIfNeeded();
  clearTimeout(pendingWaveTimer);
  // Generate the next wave's def NOW so the preview exists during the whole
  // gap. Guard against regenerating (rerolling profiles) on pause/resume:
  // resumeGame calls scheduleWave again for the same upcoming wave.
  if(!nextWaveDef||nextWaveDef.n!==wave+1){
    nextWaveDef=generateWave(wave+1);
  }
  // Gap timers are wall-clock too; scale at creation so 3x actually shortens
  // the between-wave wait. A speed toggle mid-gap keeps the old deadline —
  // rescaling a live timeout isn't worth the bookkeeping for a <=6s window.
  pendingWaveTimer=setTimeout(()=>{pendingWaveTimer=null;startWave();},delay/gameSpeed);
}

function startWave(){
  if(!gameStarted)return;
  if(paused){wavePendingOnResume=true;return;}
  // Past the scripted waves without endless engaged: hold and offer the choice
  // instead of the old hard showGameOver(true). (Safety net — the normal offer
  // happens at wave-clear in update(); this covers stray timers/odd resumes.)
  if(wave>=baseWaveCount()&&!endlessMode){
    endlessOffered=true;
    updateHUD();
    return;
  }
  wave++;
  const def=(nextWaveDef&&nextWaveDef.n===wave)?nextWaveDef:generateWave(wave);
  nextWaveDef=null; // consumed — the preview clears while the wave runs
  waveActive=true;
  sfx('wave');
  showMsg('⚔️ WAVE '+wave);
  const total=def.count+(def.boss||0)+(def.fast||0);
  waveState={def,total,spawned:0,intervalId:null,pausedSpawning:false};
  startSpawning();
  updateHUD();
}

function startSpawning(){
  if(!waveState)return;
  if(waveState.intervalId){clearInterval(waveState.intervalId);waveState.intervalId=null;}
  waveState.intervalId=setInterval(()=>{
    if(!waveState||waveState.spawned>=waveState.total){
      if(waveState&&waveState.intervalId){clearInterval(waveState.intervalId);waveState.intervalId=null;}
      return;
    }
    const def=waveState.def;
    const spawned=waveState.spawned;
    const isBoss=def.boss&&spawned<(def.boss||0);
    const isFast=def.fast&&spawned>=(def.boss||0)&&spawned<(def.boss||0)+(def.fast||0);
    const hp=isBoss?def.hp*BOSS_HP_MULT:def.hp;
    const spd=def.spd*(isBoss?BOSS_MULT:isFast?FAST_MULT:1);
    const kind=isBoss?'boss':isFast?'fast':'grunt';
    // Each spawn draws its resist profile from the wave's rolled profile set.
    const profiles=(def.profiles&&def.profiles.length)?def.profiles:[FALLBACK_PROFILE];
    const prof=profiles[Math.floor(Math.random()*profiles.length)];
    enemies.push({
      x:path[0].x,y:path[0].y,hp,maxHp:hp,spd,pathIdx:0,kind,
      profile:prof,resists:prof.resists||{},
      color:isBoss?'#d97706':isFast?'#a855f7':'#dc2626',
      size:isBoss?22:isFast?13:17,
      slow:0,slowFactor:1,dot:0,dotT:0,dotDmg:0,dotStacks:0,
      flash:0,phase:Math.random()*Math.PI*2,
      id:(frame<<8)^Math.floor(Math.random()*1e6)
    });
    portalBurst();
    waveState.spawned++;
    if(waveState.spawned>=waveState.total){
      clearInterval(waveState.intervalId);
      waveState.intervalId=null;
    }
  // Wall-clock timer, so it must scale with gameSpeed by hand — the rAF
  // loop's speed multiplier only covers update(), not these timers.
  // toggleSpeed() re-arms this interval when speed changes mid-wave.
  },SPAWN_INTERVAL/gameSpeed);
}

function onWaveCleared(){
  const bonus=35+wave*10;
  gold+=bonus;
  showMsg(`✅ Wave ${wave} Cleared! +${bonus}🪙`);
  updateHUD();
  refreshGoldUI();
  saveCheckpoint();
}

// ---------------- Endless flow ----------------
// Called by ui from the wave-12-clear prompt. Only valid while the offer
// stands — guards against double-scheduling a wave mid-run.
function beginEndless(){
  if(!endlessOffered||!gameStarted)return;
  endlessOffered=false;
  endlessMode=true;
  sfx('endless');
  showMsg('♾️ ENDLESS SIEGE');
  saveCheckpoint();
  scheduleWave(WAVE_GAP);
  updateHUD();
}

function claimVictory(){
  if(!endlessOffered)return;
  endlessOffered=false;
  showGameOver(true);
}

// ---------------- Main loop ----------------
let lastT=0;
// Exactly one rAF chain may exist. pause() drops the chain (gameLoop returns
// without re-arming) and resume() starts a new one — but a pause/resume inside
// a single frame leaves the old chain's queued callback alive, and each such
// cycle stacks another loop (measured 60 -> 300+ updates/s). Every request
// goes through this handle so starters can cancel before they arm.
let rafId=0;
// gameSpeed runs update() multiple times per rendered frame so every
// subsystem (movement, cooldowns, projectiles, dot ticks) scales together
// instead of hand-tuning a dt multiplier per system.
function gameLoop(t){
  if(paused)return;
  const dt=Math.min((t-lastT)/1000,0.05);
  lastT=t;
  now=t/1000;
  // The tick loop must never die to an unguarded throw — a single bad frame
  // logs and the next frame proceeds.
  for(let i=0;i<gameSpeed;i++){
    try{ update(dt); }catch(err){ console.error('Grimoire Siege: update error',err); }
  }
  try{ flushGoldUI(); render(dt); }catch(err){ console.error('Grimoire Siege: render error',err); }
  // gameStarted goes false in showGameOver — without checking it the loop kept
  // rendering (and burning CPU) behind the victory overlay forever.
  if(gameStarted&&lives>0)rafId=requestAnimationFrame(gameLoop);
}

function update(dt){
  frame++;
  // Move enemies
  enemies=enemies.filter(e=>{
    const spd=e.spd*(e.slow>0?(e.slowFactor||SLOW_FACTOR):1)*ENEMY_BASE_SPEED;
    e.slow=Math.max(0,e.slow-dt);
    e.flash=Math.max(0,e.flash-dt*4);
    if(e.dot>0){
      e.dot=Math.max(0,e.dot-dt);
      e.dotT+=dt;
      if(e.dotT>=DOT_INTERVAL){
        e.dotT-=DOT_INTERVAL;
        // DoT tick: per-tick damage was resist-reduced when applied; stacks
        // multiply it (Venom's stacking branch).
        e.hp-=(e.dotDmg||0)*Math.max(1,e.dotStacks||1);
        if(particles.length<MAX_PARTICLES)particles.push({x:e.x+(Math.random()-0.5)*e.size,y:e.y,vx:0,vy:-0.7,life:1,decay:0.05,col:'#84cc16',r:1.8});
        if(e.hp<=0){killEnemy(e);return false;}
      }
      if(e.dot<=0){e.dotStacks=0;e.dotDmg=0;}
    }
    // Move along path
    const target=path[e.pathIdx+1];
    if(!target){
      // Leak cost by enemy kind (LEAK_COST from content) — a boss leak has to
      // hurt more than a grunt leak or the failure state is toothless.
      const lc=(typeof LEAK_COST!=='undefined'&&LEAK_COST&&Number.isFinite(Number(LEAK_COST[e.kind])))?Math.max(1,Math.round(Number(LEAK_COST[e.kind]))):1;
      lives=Math.max(0,lives-lc);
      sfx('hit');
      shake=Math.max(shake,9);
      damageFlash=1;
      crystalHit=1;
      for(let i=0;i<16;i++)spark(e.x,e.y,'#ef4444',4);
      if(lives<=0)showGameOver(false);
      return false;
    }
    const dx=target.x-e.x,dy=target.y-e.y;
    const dist=Math.sqrt(dx*dx+dy*dy);
    const move=spd*dt;
    if(move>=dist){e.x=target.x;e.y=target.y;e.pathIdx++;}
    else{e.x+=dx/dist*move;e.y+=dy/dist*move;e.dir=Math.atan2(dy,dx);}
    return true;
  });

  // Tower shooting — targets the enemy furthest along the path (closest
  // to the crystal) among those in range, not simply array order.
  towers.forEach(t=>{
    t.cd=Math.max(0,(t.cd||0)-dt);
    t.recoil=Math.max(0,(t.recoil||0)-dt*5);
    t.flash=Math.max(0,(t.flash||0)-dt*7);
    const stats=towerStats(t);
    let target=null,bestProgress=-Infinity;
    for(const e of enemies){
      if(Math.hypot(e.x-t.x,e.y-t.y)<=stats.range){
        const p=enemyProgress(e);
        if(p>bestProgress){bestProgress=p;target=e;}
      }
    }
    if(target){
      // Smoothly swing the turret toward whatever it is tracking.
      t.aimTo=Math.atan2(target.y-t.y,target.x-t.x);
      let diff=((t.aimTo-t.aim+Math.PI*3)%(Math.PI*2))-Math.PI;
      t.aim+=diff*Math.min(1,dt*11);
    }
    if(t.cd>0||!target)return;
    t.cd=fireCooldown(t);
    t.recoil=1;t.flash=1;
    const tune=PROJ_TUNE[t.proj]||{speed:400,turn:6};
    const ang=t.aim;
    const muzzle=16;
    projectiles.push({
      x:t.x+Math.cos(ang)*muzzle,y:t.y+Math.sin(ang)*muzzle,
      vx:Math.cos(ang)*tune.speed,vy:Math.sin(ang)*tune.speed,
      speed:tune.speed,turn:tune.turn,
      dmg:stats.dmg,dmgClass:stats.dmgClass,color:t.color,r:4.5,
      aoe:stats.aoe,slow:stats.slow?1:0,slowFactor:stats.slowFactor,
      dot:stats.dotDamage,dotStacks:stats.dotStacks,chain:stats.chain,
      targetId:target.id,proj:t.proj,life:2.6,spin:0,trail:[]
    });
    for(let i=0;i<3;i++)spark(t.x+Math.cos(ang)*muzzle,t.y+Math.sin(ang)*muzzle,t.color,1.8);
  });

  // Move projectiles — they now steer toward the enemy they were fired at,
  // which is what `targetId` was always for.
  projectiles=projectiles.filter(p=>{
    p.life-=dt;
    if(p.life<=0)return false;
    p.spin+=dt*9;
    const tgt=p.targetId!==undefined?enemies.find(e=>e.id===p.targetId):null;
    if(tgt){
      const desired=Math.atan2(tgt.y-p.y,tgt.x-p.x);
      let cur=Math.atan2(p.vy,p.vx);
      let diff=((desired-cur+Math.PI*3)%(Math.PI*2))-Math.PI;
      const maxTurn=p.turn*dt;
      cur+=Math.max(-maxTurn,Math.min(maxTurn,diff));
      p.vx=Math.cos(cur)*p.speed;p.vy=Math.sin(cur)*p.speed;
    }
    p.trail.push({x:p.x,y:p.y});
    if(p.trail.length>7)p.trail.shift();
    p.x+=p.vx*dt;p.y+=p.vy*dt;
    if(p.x<-60||p.x>W+60||p.y<-60||p.y>H+60)return false;
    for(let e of enemies){
      if(Math.hypot(e.x-p.x,e.y-p.y)<e.size+5){
        if(p.aoe>0){
          enemies.slice().forEach(e2=>{if(Math.hypot(e2.x-e.x,e2.y-e.y)<p.aoe){hitEnemy(e2,p.dmg,p);}});
          ring(e.x,e.y,p.color,p.aoe,1);
          if(p.aoe>=45)shake=Math.max(shake,3);
        }
        else hitEnemy(e,p.dmg,p);
        for(let i=0;i<7;i++)spark(p.x,p.y,p.color,3.2);
        return false;
      }
    }
    return true;
  });

  // Particles
  particles=particles.filter(p=>{
    if(p.type==='ring'){p.r+=(p.maxR-p.r)*0.22;p.life-=p.decay;return p.life>0;}
    p.x+=p.vx;p.y+=p.vy;
    p.vy+=0.06;              // a touch of gravity so debris settles
    p.vx*=0.96;p.vy*=0.96;
    p.life-=p.decay;p.r*=0.965;
    return p.life>0&&p.r>0.4;
  });
  floaters=floaters.filter(f=>{f.y-=0.55;f.life-=0.016;return f.life>0;});

  // Ambient embers drifting across the battlefield
  for(const em of embers){
    em.x+=em.vx*dt;em.y+=em.vy*dt;
    if(em.y<-8){em.y=H+8;em.x=Math.random()*W;}
    if(em.x<-8)em.x=W+8; else if(em.x>W+8)em.x=-8;
  }

  shake=Math.max(0,shake-dt*22);
  damageFlash=Math.max(0,damageFlash-dt*2.2);
  crystalHit=Math.max(0,crystalHit-dt*1.6);

  // Wave end — only once spawning has finished AND the board is clear.
  if(waveActive&&waveState&&waveState.spawned>=waveState.total&&!waveState.intervalId&&enemies.length===0){
    waveActive=false;
    onWaveCleared();
    if(wave>=baseWaveCount()&&!endlessMode){
      // Final scripted wave down: pause scheduling and offer the choice.
      // ui watches `endlessOffered` and calls beginEndless()/claimVictory().
      endlessOffered=true;
    }else{
      scheduleWave(WAVE_GAP);
    }
  }
  updateHUD();
}

// ---------------- Combat ----------------
// Damage reduction by resist profile: dmg * (1 - resists[dmgClass]).
// Direct hits, chain jumps and DoT ticks all pass through this — chain and
// DoT use each *victim's own* resists, not the primary target's.
function reducedDamage(e,dmg,cls){
  const raw=(e.resists&&typeof e.resists==='object')?Number(e.resists[cls]):0;
  const r=Number.isFinite(raw)?Math.min(0.9,Math.max(0,raw)):0;
  return dmg*(1-r);
}

function applySlow(e,p){
  const f=Number.isFinite(p.slowFactor)?Math.min(1,Math.max(0.1,p.slowFactor)):SLOW_FACTOR;
  // Two frost sources: the stronger (lower) factor wins rather than the latest.
  e.slowFactor=(e.slow>0&&Number.isFinite(e.slowFactor)&&e.slowFactor<1)?Math.min(e.slowFactor,f):f;
  e.slow=SLOW_DURATION;
}

function applyDot(e,p){
  // Resist is applied once, at application time — the enemy's resists are
  // immutable, so this equals reducing every tick.
  const tick=reducedDamage(e,p.dot,p.dmgClass);
  const maxStacks=Math.max(1,Math.round(Number(p.dotStacks))||1);
  if(e.dot>0){
    e.dotStacks=Math.min(maxStacks,(e.dotStacks||1)+1);
    e.dotDmg=Math.max(e.dotDmg||0,tick);
  }else{
    e.dotStacks=1;
    e.dotDmg=tick;
  }
  e.dot=DOT_DURATION;
}

function hitEnemy(e,dmg,p){
  const dealt=reducedDamage(e,dmg,p.dmgClass);
  e.hp-=dealt;
  e.flash=1;
  if(p.slow)applySlow(e,p);
  if(p.dot>0)applyDot(e,p);
  // Check for the kill but chain FIRST — the old early-return here meant a
  // killing blow never chained, so Storm underperformed exactly when clearing.
  const killed=e.hp<=0;
  // Lightning chain: jump to up to p.chain additional nearby enemies
  if(p.chain>0){
    let chainDmg=dmg*0.6;
    let hit=[e];
    let src=e;
    for(let c=0;c<p.chain;c++){
      let next=null,bestDist=Infinity;
      for(let en of enemies){
        if(hit.includes(en))continue;
        const d=Math.hypot(en.x-src.x,en.y-src.y);
        if(d<90&&d<bestDist){bestDist=d;next=en;}
      }
      if(!next)break;
      hit.push(next);
      next.hp-=reducedDamage(next,chainDmg,p.dmgClass);
      next.flash=1;
      if(p.slow)applySlow(next,p);
      if(p.dot>0)applyDot(next,p);
      particles.push({type:'bolt',x:src.x,y:src.y,x2:next.x,y2:next.y,life:1,decay:0.12,col:'#fde047',seed:Math.random()*99});
      if(next.hp<=0)killEnemy(next);
      src=next;
      chainDmg*=0.6;
    }
  }
  if(killed)killEnemy(e);
}

function killEnemy(e){
  if(e.dead)return;
  e.dead=true;
  enemies=enemies.filter(x=>x!==e);
  // Bounty derives from the enemy's HP — never from the player's own costs.
  const reward=Math.floor(12+e.maxHp/16);
  gold+=reward;kills++;
  sfx('kill');
  const n=e.kind==='boss'?26:12;
  for(let i=0;i<n;i++)spark(e.x,e.y,e.color,e.kind==='boss'?5.5:3.6);
  ring(e.x,e.y,e.color,e.kind==='boss'?60:26,e.kind==='boss'?1.2:0.6);
  floater(e.x,e.y-e.size-4,'+'+reward,'#fbbf24');
  if(e.kind==='boss')shake=Math.max(shake,7);
  uiDirty=true;
}

// ---------------- Settings bootstrap ----------------
// Load persisted settings at script load so fx (gain/shake) and the ui widgets
// read real values from the first frame. loadSave() already validates them.
(function initSettingsFromSave(){
  try{
    const s=loadSave();
    settings.volume=s.settings.volume;
    settings.shake=s.settings.shake;
  }catch(e){
    console.warn('Grimoire Siege: settings load failed, using defaults',e);
  }
})();
