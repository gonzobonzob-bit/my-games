// Grimoire Siege — ui: DOM, input, menus, HUD, game flow
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing top-level scope; load order: content, sim, fx, ui.

(function initSplash(){
  try{
    const save=loadSave();
    const bwEl=document.getElementById('best-wave-disp');
    const hsEl=document.getElementById('high-score-disp');
    if(bwEl)bwEl.textContent=save.bestWave;
    if(hsEl)hsEl.textContent=save.highScore;
    const statsEl=document.getElementById('splash-stats');
    if(statsEl&&(save.bestWave>0||save.highScore>0))statsEl.style.display='block';
    const contBtn=document.getElementById('continue-btn');
    if(contBtn&&save.checkpoint)contBtn.style.display='inline-block';
    // Drifting rune motes behind the title.
    const runes=['✦','✧','⚝','☾','✶','❍','⟁','◈'];
    const holder=document.getElementById('sp-runes');
    if(holder){
      let html='';
      for(let i=0;i<16;i++){
        const dur=(9+Math.random()*11).toFixed(1);
        html+=`<i style="left:${(Math.random()*100).toFixed(1)}%;animation-duration:${dur}s;animation-delay:${(-Math.random()*dur).toFixed(1)}s;font-size:${(9+Math.random()*10).toFixed(0)}px">${runes[i%runes.length]}</i>`;
      }
      holder.innerHTML=html;
    }
  }catch(e){ console.warn('Grimoire Siege: splash init failed',e); }
})();

// Backgrounding the tab stops requestAnimationFrame but NOT the spawn
// setInterval, so without this the wave keeps spawning into a frozen world
// and you return to a heap of enemies stacked on the portal. Auto-pausing
// halts the spawn timer too.
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&gameStarted){
    saveCheckpoint();
    pauseGame();
  }
});
window.addEventListener('pagehide',()=>{ if(gameStarted)saveCheckpoint(); });
document.addEventListener('keydown',(e)=>{
  if(!gameStarted||lives<=0)return;
  if(e.key==='Escape'){ if(paused)resumeGame();else pauseGame(); return; }
  if(paused)return;
  // 1-9 then 0 select the shop slots in order.
  if(e.key>='0'&&e.key<='9'){
    const idx=e.key==='0'?9:parseInt(e.key,10)-1;
    if(TOWERS[idx])selectTower(TOWERS[idx].id);
  }
});

// ---------------- Canvas sizing ----------------
function resizeCanvas(){
  dpr=Math.min(window.devicePixelRatio||1,2);
  W=gameWrapEl.offsetWidth;
  H=gameWrapEl.offsetHeight;
  canvas.width=Math.round(W*dpr);
  canvas.height=Math.round(H*dpr);
  canvas.style.width=W+'px';
  canvas.style.height=H+'px';
  ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
}

function onResize(){
  if(!gameStarted)return;
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    const oldW=W,oldH=H;
    resizeCanvas();
    if(oldW>0&&oldH>0){
      const sx=W/oldW,sy=H/oldH;
      towers.forEach(t=>{t.x*=sx;t.y*=sy;});
      enemies.forEach(e=>{e.x*=sx;e.y*=sy;});
      projectiles.forEach(p=>{p.x*=sx;p.y*=sy;p.trail.forEach(pt=>{pt.x*=sx;pt.y*=sy;});});
    }
    path=buildPath(W,H);
    computePathCum();
    buildBackground();
    seedEmbers();
    if(selectedPlacedTower)openTowerActionPanel(selectedPlacedTower);
  },150);
}
window.addEventListener('resize',onResize);
window.addEventListener('orientationchange',onResize);

function startGame(continueRun){
  document.getElementById('splash').style.display='none';
  const app=document.getElementById('app');
  app.style.display='flex';
  canvas=document.getElementById('main-canvas');
  gameWrapEl=document.getElementById('game-wrap');
  resizeCanvas();
  path=buildPath(W,H);
  computePathCum();

  gold=START_GOLD;lives=START_LIVES;wave=0;kills=0;waveActive=false;
  towers=[];enemies=[];projectiles=[];particles=[];floaters=[];
  selectedTower=null;selectedPlacedTower=null;waveState=null;
  shake=0;damageFlash=0;crystalHit=0;
  gameSpeed=1;
  const speedBtn=document.getElementById('speed-btn');
  if(speedBtn)speedBtn.textContent='1x';

  let resumeWave=0;
  if(continueRun){
    try{
      const save=loadSave();
      if(save.checkpoint){
        const cp=save.checkpoint;
        if(typeof cp.gold==='number')gold=cp.gold;
        if(typeof cp.lives==='number')lives=cp.lives;
        if(typeof cp.kills==='number')kills=cp.kills;
        resumeWave=Math.max(0,(cp.wave||1)-1);
        if(Array.isArray(cp.towers)){
          towers=cp.towers.map(ct=>{
            const base=TOWERS.find(t=>t.id===ct.id);
            if(!base)return null;
            // Older saves stored absolute pixels; newer ones store 0-1 fractions.
            const x=typeof ct.nx==='number'?ct.nx*W:ct.x;
            const y=typeof ct.ny==='number'?ct.ny*H:ct.y;
            if(typeof x!=='number'||typeof y!=='number')return null;
            return {...base,x,y,cd:0,level:ct.level||0,invested:ct.invested||base.cost,
              aim:-Math.PI/2,aimTo:-Math.PI/2,recoil:0,flash:0,phase:Math.random()*Math.PI*2};
          }).filter(Boolean);
        }
      }
    }catch(e){ console.warn('Grimoire Siege: continue load failed, starting fresh',e); }
  }
  wave=resumeWave;

  buildBackground();
  seedEmbers();
  buildTowerPanel();
  canvas.addEventListener('click',onCanvasClick);
  canvas.addEventListener('mousemove',onCanvasHover);
  canvas.addEventListener('mouseleave',()=>{hoverX=hoverY=null;});
  canvas.addEventListener('touchstart',onCanvasTouchHover,{passive:true});
  canvas.addEventListener('touchmove',onCanvasTouchHover,{passive:true});

  gameStarted=true;
  paused=false;
  lastT=performance.now();
  requestAnimationFrame(gameLoop);
  scheduleWave(PREP_TIME);
  showMsg('🛡️ FORTIFY');

  if(autosaveIntervalId)clearInterval(autosaveIntervalId);
  autosaveIntervalId=setInterval(saveCheckpoint,30000);

  updateHUD();
}

// ---------------- Pause / speed ----------------
function pauseGame(){
  if(paused||!gameStarted||lives<=0)return;
  paused=true;
  if(waveState&&waveState.intervalId){
    clearInterval(waveState.intervalId);
    waveState.intervalId=null;
    waveState.pausedSpawning=true;
  }
  if(pendingWaveTimer){clearTimeout(pendingWaveTimer);pendingWaveTimer=null;wavePendingOnResume=true;}
  document.getElementById('pause-overlay').classList.add('show');
}

function resumeGame(){
  if(!paused)return;
  paused=false;
  document.getElementById('pause-overlay').classList.remove('show');
  if(waveState&&waveState.pausedSpawning){
    waveState.pausedSpawning=false;
    startSpawning();
  }
  if(wavePendingOnResume){wavePendingOnResume=false;scheduleWave(WAVE_GAP);}
  lastT=performance.now();
  requestAnimationFrame(gameLoop);
}

function saveAndExit(){
  saveCheckpoint();
  location.reload();
}
function exitNoSave(){
  location.reload();
}

function toggleSpeed(){
  gameSpeed=gameSpeed>=3?1:gameSpeed+1;
  document.getElementById('speed-btn').textContent=gameSpeed+'x';
}

// ---------------- Tower panel / placement ----------------
function buildTowerPanel(){
  const panel=document.getElementById('tower-panel');
  panel.innerHTML=TOWERS.map((t)=>`
    <div class="tower-btn ${gold<t.cost?'cant':''} ${selectedTower&&selectedTower.id===t.id?'selected':''}" id="tbtn-${t.id}" style="--tcol:${t.color}" onclick="selectTower('${t.id}')">
      <span class="tb-icon">${t.icon}</span>
      <span class="tb-name">${t.name}</span>
      <span class="tb-stats">${t.dmg}dmg · ${t.range}r</span>
      <span class="tb-cost">${t.cost}🪙</span>
    </div>`).join('');
}

function refreshGoldUI(){
  buildTowerPanel();
  if(selectedPlacedTower)openTowerActionPanel(selectedPlacedTower);
}

// Kills arrive in bursts, and each one changes the gold total. Rebuilding the
// shop's DOM per kill thrashes layout for no benefit, so kills just raise a
// flag and the panel is rebuilt at most once per rendered frame.
let uiDirty=false;
function flushGoldUI(){
  if(!uiDirty)return;
  uiDirty=false;
  refreshGoldUI();
}

function selectTower(id){
  closeTowerActionPanel();
  selectedTower=TOWERS.find(t=>t.id===id);
  document.querySelectorAll('.tower-btn').forEach(b=>b.classList.remove('selected'));
  const btn=document.getElementById('tbtn-'+id);
  if(btn)btn.classList.add('selected');
}

function onCanvasHover(e){
  if(paused)return;
  const rect=canvas.getBoundingClientRect();
  hoverX=e.clientX-rect.left;hoverY=e.clientY-rect.top;
}
function onCanvasTouchHover(e){
  if(paused||!e.touches||!e.touches[0])return;
  const rect=canvas.getBoundingClientRect();
  hoverX=e.touches[0].clientX-rect.left;hoverY=e.touches[0].clientY-rect.top;
}

function onCanvasClick(e){
  if(paused)return;
  const rect=canvas.getBoundingClientRect();
  const x=e.clientX-rect.left,y=e.clientY-rect.top;
  hoverX=x;hoverY=y;

  // Tap on an existing tower selects it for upgrade/sell instead of placing.
  const tapped=towers.find(t=>Math.hypot(t.x-x,t.y-y)<24);
  if(tapped){
    selectedTower=null;
    document.querySelectorAll('.tower-btn').forEach(b=>b.classList.remove('selected'));
    openTowerActionPanel(tapped);
    return;
  }
  closeTowerActionPanel();

  if(!selectedTower||gold<selectedTower.cost)return;
  if(!isValidPlacement(x,y))return;
  towers.push({...selectedTower,x,y,cd:0,level:0,invested:selectedTower.cost,
    aim:-Math.PI/2,aimTo:-Math.PI/2,recoil:0,flash:0,phase:Math.random()*Math.PI*2});
  gold-=selectedTower.cost;
  sfx('place');
  ring(x,y,selectedTower.color,46,0.55);
  updateHUD();
  refreshGoldUI();
}

function openTowerActionPanel(t){
  selectedPlacedTower=t;
  const panel=document.getElementById('tower-action-panel');
  const stats=towerStats(t);
  const maxed=(t.level||0)>=MAX_TOWER_LEVEL;
  document.getElementById('tap-name').textContent=`${t.icon} ${t.name} Lv.${(t.level||0)+1}`;
  document.getElementById('tap-stats').innerHTML=
    `DMG <b>${stats.dmg}</b> · RNG <b>${stats.range}</b><br>Rate <b>${(60/stats.rate).toFixed(1)}/s</b> · Sell <b>${sellValue(t)}🪙</b>`;
  const upBtn=document.getElementById('tap-upgrade-btn');
  if(maxed){
    upBtn.textContent='MAX LEVEL';
    upBtn.disabled=true;
  }else{
    const cost=upgradeCost(t);
    upBtn.textContent=`Upgrade (${cost}🪙)`;
    upBtn.disabled=gold<cost;
  }
  const maxLeft=Math.max(6,(gameWrapEl?gameWrapEl.offsetWidth:W)-166);
  const maxTop=Math.max(6,(gameWrapEl?gameWrapEl.offsetHeight:H)-124);
  panel.style.left=Math.max(6,Math.min(t.x-78,maxLeft))+'px';
  panel.style.top=Math.max(6,Math.min(t.y+20,maxTop))+'px';
  panel.classList.add('show');
}

function closeTowerActionPanel(){
  selectedPlacedTower=null;
  const panel=document.getElementById('tower-action-panel');
  if(panel)panel.classList.remove('show');
}

function upgradeSelectedTower(){
  const t=selectedPlacedTower;
  if(!t||(t.level||0)>=MAX_TOWER_LEVEL)return;
  const cost=upgradeCost(t);
  if(gold<cost)return;
  gold-=cost;
  t.level=(t.level||0)+1;
  t.invested=(t.invested||t.cost)+cost;
  sfx('place');
  ring(t.x,t.y,'#fbbf24',52,0.7);
  for(let i=0;i<14;i++)spark(t.x,t.y,'#fbbf24',3.2);
  floater(t.x,t.y-24,'LV '+(t.level+1),'#fbbf24');
  updateHUD();
  refreshGoldUI();
}

function sellSelectedTower(){
  const t=selectedPlacedTower;
  if(!t)return;
  const val=sellValue(t);
  gold+=val;
  towers=towers.filter(x=>x!==t);
  for(let i=0;i<12;i++)spark(t.x,t.y,'#6b7280',2.6);
  floater(t.x,t.y-20,'+'+val+'🪙','#fbbf24');
  closeTowerActionPanel();
  sfx('sell');
  updateHUD();
  refreshGoldUI();
}

function showMsg(txt){
  const el=document.getElementById('msg-overlay');
  el.innerHTML=`<div class="wave-msg">${txt}</div>`;
  setTimeout(()=>el.innerHTML='',2000);
}

// ---------------- HUD ----------------
function updateHUD(){
  document.getElementById('hud-lives').textContent=lives;
  document.getElementById('hud-gold').textContent=gold;
  document.getElementById('hud-wave').textContent=wave;
  document.getElementById('hud-kills').textContent=kills;
  const lb=document.getElementById('hud-lives-box');
  if(lb)lb.classList.toggle('critical',lives<=5);
  const fill=document.getElementById('wave-bar-fill');
  if(fill){
    if(waveState&&waveState.total>0){
      const remaining=(waveState.total-waveState.spawned)+enemies.length;
      fill.style.width=Math.max(0,Math.min(100,(1-remaining/waveState.total)*100))+'%';
    }else{
      fill.style.width='0%';
    }
  }
}

function showGameOver(win){
  sfx(win?'win':'lose');
  waveActive=false;
  clearTimeout(pendingWaveTimer);pendingWaveTimer=null;wavePendingOnResume=false;
  if(waveState&&waveState.intervalId){clearInterval(waveState.intervalId);waveState.intervalId=null;}
  if(autosaveIntervalId){clearInterval(autosaveIntervalId);autosaveIntervalId=null;}
  gameStarted=false;
  const {bestWave,highScore}=recordRunEnd();
  const go=document.getElementById('gameover');
  go.classList.add('show');
  document.getElementById('go-title').textContent=win?'🏆 VICTORY!':'☠️ DEFEATED';
  document.getElementById('go-score').innerHTML=
    `Wave ${wave}/12 &nbsp;|&nbsp; ${kills} kills &nbsp;|&nbsp; ${gold}🪙<br>Best Wave ${bestWave} &nbsp;|&nbsp; High Score ${highScore}`;
}
