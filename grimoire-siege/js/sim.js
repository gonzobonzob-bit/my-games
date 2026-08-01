// Grimoire Siege — sim: game state, path, saves, waves, economy, combat update
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing top-level scope; load order: content, sim, fx, ui.

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
function loadSave(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw)return {version:1,bestWave:0,highScore:0,checkpoint:null};
    const data=JSON.parse(raw);
    if(!data||typeof data!=='object')throw new Error('malformed save');
    return {
      version:1,
      bestWave:Number(data.bestWave)||0,
      highScore:Number(data.highScore)||0,
      checkpoint:(data.checkpoint&&typeof data.checkpoint==='object')?data.checkpoint:null
    };
  }catch(e){
    console.warn('Grimoire Siege: save load failed, starting fresh',e);
    return {version:1,bestWave:0,highScore:0,checkpoint:null};
  }
}

function writeSave(patch){
  try{
    const current=loadSave();
    const merged=Object.assign({},current,patch,{version:1});
    localStorage.setItem(SAVE_KEY,JSON.stringify(merged));
  }catch(e){
    console.warn('Grimoire Siege: save write failed',e);
  }
}

// Checkpoints capture the run at the last wave boundary (not mid-wave):
// resuming always restarts the in-progress wave fresh rather than trying
// to reconstruct exact enemy/projectile state. Tower positions are stored
// normalised (0-1) so a checkpoint survives a different window size.
function saveCheckpoint(){
  if(!gameStarted||lives<=0)return;
  try{
    const resumeWave=Math.min(waveActive?wave:wave+1,12);
    const checkpoint={
      gold,lives,kills,wave:resumeWave,
      towers:towers.map(t=>({id:t.id,nx:t.x/W,ny:t.y/H,level:t.level||0,invested:t.invested||t.cost}))
    };
    writeSave({checkpoint});
  }catch(e){
    console.warn('Grimoire Siege: autosave failed',e);
  }
}

function clearCheckpoint(){ writeSave({checkpoint:null}); }

function recordRunEnd(){
  const save=loadSave();
  const bestWave=Math.max(save.bestWave,wave);
  const score=kills*10+wave*50+gold;
  const highScore=Math.max(save.highScore,score);
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

// ---------------- Tower upgrade / sell ----------------
function towerStats(t){
  const lvl=t.level||0;
  return {
    dmg:Math.round(t.dmg*(1+0.45*lvl)),
    range:Math.round(t.range*(1+0.12*lvl)),
    rate:Math.max(20,Math.round(t.rate*(1-0.15*lvl)))
  };
}
// `rate` is authored in 60ths of a second; convert to real seconds so fire
// rate no longer depends on the display's refresh rate.
function fireCooldown(t){ return towerStats(t).rate/60; }
function upgradeCost(t){ return Math.floor(t.cost*0.55*((t.level||0)+1)); }
function sellValue(t){ return Math.floor((t.invested||t.cost)*0.6); }

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
  clearTimeout(pendingWaveTimer);
  pendingWaveTimer=setTimeout(()=>{pendingWaveTimer=null;startWave();},delay);
}
function startWave(){
  if(!gameStarted)return;
  if(paused){wavePendingOnResume=true;return;}
  if(wave>=12){showGameOver(true);return;}
  wave++;
  waveActive=true;
  const def=WAVE_DEFS[wave-1];
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
    enemies.push({
      x:path[0].x,y:path[0].y,hp,maxHp:hp,spd,pathIdx:0,kind,
      color:isBoss?'#d97706':isFast?'#a855f7':'#dc2626',
      size:isBoss?22:isFast?13:17,
      slow:0,dot:0,dotT:0,flash:0,phase:Math.random()*Math.PI*2,
      id:(frame<<8)^Math.floor(Math.random()*1e6)
    });
    portalBurst();
    waveState.spawned++;
    if(waveState.spawned>=waveState.total){
      clearInterval(waveState.intervalId);
      waveState.intervalId=null;
    }
  },SPAWN_INTERVAL);
}

function onWaveCleared(){
  const bonus=35+wave*10;
  gold+=bonus;
  showMsg(`✅ Wave ${wave} Cleared! +${bonus}🪙`);
  updateHUD();
  refreshGoldUI();
  saveCheckpoint();
}

// ---------------- Main loop ----------------
let lastT=0;
// gameSpeed runs update() multiple times per rendered frame so every
// subsystem (movement, cooldowns, projectiles, dot ticks) scales together
// instead of hand-tuning a dt multiplier per system.
function gameLoop(t){
  if(paused)return;
  const dt=Math.min((t-lastT)/1000,0.05);
  lastT=t;
  now=t/1000;
  for(let i=0;i<gameSpeed;i++){
    update(dt);
  }
  flushGoldUI();
  render(dt);
  // gameStarted goes false in showGameOver — without checking it the loop kept
  // rendering (and burning CPU) behind the victory overlay forever.
  if(gameStarted&&lives>0)requestAnimationFrame(gameLoop);
}

function update(dt){
  frame++;
  // Move enemies
  enemies=enemies.filter(e=>{
    const spd=e.spd*(e.slow>0?SLOW_FACTOR:1)*ENEMY_BASE_SPEED;
    e.slow=Math.max(0,e.slow-dt);
    e.flash=Math.max(0,e.flash-dt*4);
    if(e.dot>0){
      e.dot=Math.max(0,e.dot-dt);
      e.dotT+=dt;
      if(e.dotT>=DOT_INTERVAL){
        e.dotT-=DOT_INTERVAL;
        e.hp-=DOT_DAMAGE;
        if(particles.length<MAX_PARTICLES)particles.push({x:e.x+(Math.random()-0.5)*e.size,y:e.y,vx:0,vy:-0.7,life:1,decay:0.05,col:'#84cc16',r:1.8});
        if(e.hp<=0){killEnemy(e);return false;}
      }
    }
    // Move along path
    const target=path[e.pathIdx+1];
    if(!target){
      lives=Math.max(0,lives-1);
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
      dmg:stats.dmg,color:t.color,r:4.5,aoe:t.aoe||0,slow:t.slow||0,dot:t.dot||0,chain:t.chain||0,
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
    scheduleWave(WAVE_GAP);
  }
  updateHUD();
}

function hitEnemy(e,dmg,p){
  e.hp-=dmg;
  e.flash=1;
  if(p.slow)e.slow=SLOW_DURATION;
  if(p.dot){e.dot=DOT_DURATION;}
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
      next.hp-=chainDmg;
      next.flash=1;
      if(p.slow)next.slow=SLOW_DURATION;
      if(p.dot)next.dot=DOT_DURATION;
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
