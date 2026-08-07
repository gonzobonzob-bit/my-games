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
// Hotkeys are accelerators only — every one of these actions also has an
// on-screen button/route (phones have no Esc key).
function overlayShown(id){const el=document.getElementById(id);return !!el&&el.classList.contains('show');}
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape'){
    // Innermost layer first, matching the visual stacking order.
    if(overlayShown('settings-overlay')){closeSettings();return;}
    if(overlayShown('branch-overlay')){closeBranchPicker();return;}
    if(overlayShown('endless-overlay'))return; // must choose a button
    if(!gameStarted||lives<=0)return;
    if(paused)resumeGame();else pauseGame();
    return;
  }
  if(!gameStarted||lives<=0||paused)return;
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
  endlessPromptShown=false;
  hideEndlessPrompt();
  closeBranchPicker();
  lastPreviewDef=null;
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
            // branch must survive the restore: branchMods() reads it at fire
            // time, and the picker gates on !t.branch — dropping it here both
            // weakened restored towers and let the player re-pay for a path
            // they already owned.
            return {...base,x,y,cd:0,level:ct.level||0,invested:ct.invested||base.cost,
              branch:(ct.branch==='a'||ct.branch==='b')?ct.branch:null,
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
  if(rafId)cancelAnimationFrame(rafId);
  rafId=requestAnimationFrame(gameLoop);
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
  if(rafId)cancelAnimationFrame(rafId);
  rafId=requestAnimationFrame(gameLoop);
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
  // The spawn interval is wall-clock and was armed at the old speed — re-arm
  // it at the new cadence, but only while actively spawning (never during
  // pause, and never in a way that could resurrect a finished wave's timer).
  if(!paused&&waveState&&waveState.intervalId&&waveState.spawned<waveState.total)startSpawning();
}

// ---------------- Tower panel / placement ----------------
// Damage-class glyphs. content.js may ship its own DMG_CLASS_ICONS const;
// prefer it so ui/fx/preview all show the same glyph per class.
function dmgClassIcon(c){
  if(typeof DMG_CLASS_ICONS!=='undefined'&&DMG_CLASS_ICONS[c])return DMG_CLASS_ICONS[c];
  return ({pierce:'🗡️',blast:'💥',arcane:'🔮'})[c]||'';
}

function buildTowerPanel(){
  const panel=document.getElementById('tower-panel');
  panel.innerHTML=TOWERS.map((t)=>`
    <div class="tower-btn ${gold<t.cost?'cant':''} ${selectedTower&&selectedTower.id===t.id?'selected':''}" id="tbtn-${t.id}" style="--tcol:${t.color}" onclick="selectTower('${t.id}')">
      ${t.dmgClass?`<span class="tb-class ${t.dmgClass}" title="${t.dmgClass}">${dmgClassIcon(t.dmgClass)}</span>`:''}
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
  const spec=(typeof BRANCHES!=='undefined')?BRANCHES[t.id]:null;
  const branchName=(t.branch&&spec&&spec[t.branch])?` · ${spec[t.branch].name}`:'';
  document.getElementById('tap-name').textContent=`${t.icon} ${t.name} Lv.${(t.level||0)+1}${branchName}`;
  document.getElementById('tap-stats').innerHTML=
    `DMG <b>${stats.dmg}</b> · RNG <b>${stats.range}</b><br>Rate <b>${(60/stats.rate).toFixed(1)}/s</b> · Sell <b>${sellValue(t)}🪙</b>`;
  const upBtn=document.getElementById('tap-upgrade-btn');
  if(maxed){
    upBtn.textContent='MAX LEVEL';
    upBtn.disabled=true;
  }else{
    const cost=upgradeCost(t);
    // Past L1 the upgrade IS the branch choice — label it as one.
    upBtn.textContent=(!t.branch&&(t.level||0)>=1&&spec)?`Choose Path (${cost}🪙)`:`Upgrade (${cost}🪙)`;
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
  // Contract: upgrading past L1 opens the two-branch choice instead of a
  // bare upgrade. Falls back to the plain upgrade if BRANCHES/chooseBranch
  // haven't landed (parallel build safety).
  if(!t.branch&&(t.level||0)>=1&&typeof BRANCHES!=='undefined'&&BRANCHES[t.id]&&typeof chooseBranch==='function'){
    openBranchPicker(t);
    return;
  }
  doPlainUpgrade(t);
}

function doPlainUpgrade(t){
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

// ---------------- Branch picker ----------------
let branchTarget=null;
function openBranchPicker(t){
  const spec=(typeof BRANCHES!=='undefined')?BRANCHES[t.id]:null;
  if(!spec){doPlainUpgrade(t);return;}
  branchTarget=t;
  const cost=upgradeCost(t);
  document.getElementById('br-title').textContent=`${t.icon} ${t.name} — Choose a Path`;
  document.getElementById('br-cost').textContent=`Cost ${cost}🪙 · you have ${gold}🪙`;
  document.getElementById('br-opts').innerHTML=['a','b'].map(k=>`
    <button class="br-opt" ${gold<cost?'disabled':''} onclick="pickBranch('${k}')">
      <span class="br-opt-name">${spec[k].name}</span>
      <span class="br-opt-blurb">${spec[k].blurb}</span>
    </button>`).join('');
  document.getElementById('branch-overlay').classList.add('show');
}

function closeBranchPicker(){
  branchTarget=null;
  const el=document.getElementById('branch-overlay');
  if(el)el.classList.remove('show');
}

function pickBranch(which){
  const t=branchTarget;
  closeBranchPicker();
  if(!t)return;
  if(typeof chooseBranch!=='function'){doPlainUpgrade(t);return;}
  const before=gold;
  chooseBranch(t,which); // sim: sets t.branch, charges upgradeCost
  if(gold===before&&!t.branch)return; // choice rejected (e.g. can't afford)
  try{sfx('branch');}catch(err){}
  ring(t.x,t.y,'#f0abfc',56,0.8);
  for(let i=0;i<16;i++)spark(t.x,t.y,'#f0abfc',3.4);
  const spec=(typeof BRANCHES!=='undefined')?BRANCHES[t.id]:null;
  floater(t.x,t.y-24,(spec&&spec[which])?spec[which].name.toUpperCase():'PATH CHOSEN','#f0abfc');
  updateHUD();
  refreshGoldUI(); // reopens the action panel with the new branch shown
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
// updateHUD runs every tick, and unconditional writes cost ~59 forced
// layouts/s even with nothing changing (measured; change-guarding was proven
// ~0/s). Route every per-tick DOM write through this cache.
const hudCache={};
function hudWrite(key,val,write){
  if(hudCache[key]===val)return;
  hudCache[key]=val;
  write(val);
}
function updateHUD(){
  hudWrite('lives',lives,v=>{document.getElementById('hud-lives').textContent=v;});
  hudWrite('gold',gold,v=>{document.getElementById('hud-gold').textContent=v;});
  hudWrite('wave',wave,v=>{document.getElementById('hud-wave').textContent=v;});
  hudWrite('kills',kills,v=>{document.getElementById('hud-kills').textContent=v;});
  // Endless: past wave 12 the /12 cap is meaningless — drop it, and tint the
  // counter gold (non-textual signal that the run has gone endless).
  const cap=document.getElementById('hud-wave-cap');
  if(cap)hudWrite('waveCap',wave>12?'none':'',v=>{cap.style.display=v;});
  const wb=document.getElementById('hud-wave-box');
  if(wb)wb.classList.toggle('endless',wave>12);
  const lb=document.getElementById('hud-lives-box');
  if(lb)lb.classList.toggle('critical',lives<=5);
  updateWavePreview();
  // sim raises endlessOffered after wave 12 clears and holds scheduling
  // until the player answers; poll it here (updateHUD runs every tick).
  if(typeof endlessOffered!=='undefined'){
    if(endlessOffered&&gameStarted&&lives>0)showEndlessPrompt();
    else if(!endlessOffered)endlessPromptShown=false;
  }
  const fill=document.getElementById('wave-bar-fill');
  if(fill){
    let w='0%';
    if(waveState&&waveState.total>0){
      const remaining=(waveState.total-waveState.spawned)+enemies.length;
      w=Math.max(0,Math.min(100,(1-remaining/waveState.total)*100)).toFixed(1)+'%';
    }
    hudWrite('waveBar',w,v=>{fill.style.width=v;});
  }
}

function showGameOver(win){
  sfx(win?'win':'lose');
  waveActive=false;
  clearTimeout(pendingWaveTimer);pendingWaveTimer=null;wavePendingOnResume=false;
  if(waveState&&waveState.intervalId){clearInterval(waveState.intervalId);waveState.intervalId=null;}
  if(autosaveIntervalId){clearInterval(autosaveIntervalId);autosaveIntervalId=null;}
  gameStarted=false;
  // Retire mid-game layers so nothing lingers beneath the game-over screen.
  closeBranchPicker();
  hideEndlessPrompt();
  const wp=document.getElementById('wave-preview');
  if(wp){wp.classList.remove('show');previewVisible=false;}
  const {bestWave,highScore}=recordRunEnd();
  const go=document.getElementById('gameover');
  go.classList.add('show');
  document.getElementById('go-title').textContent=win?'🏆 VICTORY!':'☠️ DEFEATED';
  document.getElementById('go-score').innerHTML=
    `Wave ${wave}${wave>12?'':'/12'} &nbsp;|&nbsp; ${kills} kills &nbsp;|&nbsp; ${gold}🪙<br>Best Wave ${bestWave} &nbsp;|&nbsp; High Score ${highScore}`;
}

// ---------------- Wave preview panel ----------------
// The read-and-react moment the redesign hangs on: during prep and every wave
// gap, show what's coming (count, kinds, resist profiles) so the next
// purchase is a reaction, not a script. sim generates nextWaveDef at
// scheduleWave() time, so it exists for the entire gap. DOM is rebuilt only
// when the def object changes; visibility is a cheap class toggle per tick.
let lastPreviewDef=null,previewVisible=false;
function updateWavePreview(){
  const el=document.getElementById('wave-preview');
  if(!el)return;
  const def=(typeof nextWaveDef!=='undefined')?nextWaveDef:null;
  const offered=(typeof endlessOffered!=='undefined')&&endlessOffered;
  const show=gameStarted&&lives>0&&!waveActive&&!offered&&!!def;
  if(!show){
    if(previewVisible){el.classList.remove('show');previewVisible=false;}
    return;
  }
  if(def!==lastPreviewDef){
    lastPreviewDef=def;
    el.innerHTML=buildWavePreviewHTML(def);
  }
  if(!previewVisible){el.classList.add('show');previewVisible=true;}
}

function buildWavePreviewHTML(def){
  const n=def.n||wave+1;
  const total=(def.count||0)+(def.boss||0)+(def.fast||0);
  // Leak costs come from LEAK_COST so the preview can never drift from the sim.
  const lc=k=>(typeof LEAK_COST!=='undefined'&&LEAK_COST[k]>1)?` −${LEAK_COST[k]}♥`:'';
  let kinds=`<span class="wp-kind grunt">👹 ×${def.count||0}${lc('grunt')}</span>`;
  if(def.fast)kinds+=`<span class="wp-kind fast">💨 FAST ×${def.fast}${lc('fast')}</span>`;
  if(def.boss)kinds+=`<span class="wp-kind boss">👑 BOSS ×${def.boss}${lc('boss')} each</span>`;
  const profs=(def.profiles||[]).map(p=>{
    const entries=Object.entries(p.resists||{}).filter(([,v])=>v>0);
    const chips=entries.length
      ?entries.map(([c,v])=>`<span class="wp-chip ${c}">${dmgClassIcon(c)} ${c} −${Math.round(v*100)}%</span>`).join('')
      :'<span class="wp-chip none">no resistances</span>';
    return `<div class="wp-prof"><span class="wp-prof-icon">${p.icon||'❔'}</span><span class="wp-prof-name">${p.name||p.id||'?'}</span><span class="wp-chips">${chips}</span></div>`;
  }).join('');
  return `<div class="wp-head"><span class="wp-title">NEXT — WAVE ${n}</span><span class="wp-total">${total} foes</span></div><div class="wp-kinds">${kinds}</div>${profs}`;
}

// ---------------- Endless prompt ----------------
let endlessPromptShown=false;
function showEndlessPrompt(){
  if(endlessPromptShown)return;
  endlessPromptShown=true;
  const el=document.getElementById('endless-overlay');
  if(el)el.classList.add('show');
}
function hideEndlessPrompt(){
  const el=document.getElementById('endless-overlay');
  if(el)el.classList.remove('show');
}
function uiBeginEndless(){
  hideEndlessPrompt();
  if(typeof beginEndless==='function')beginEndless();
  try{sfx('endless');}catch(err){}
  showMsg('♾️ ENDLESS SIEGE');
  updateHUD();
}
function uiClaimVictory(){
  hideEndlessPrompt();
  if(typeof claimVictory==='function')claimVictory();
  else showGameOver(true); // parallel-build fallback until sim lands
}

// ---------------- Settings ----------------
// sim owns the settings global + persistence (save schema v2); ui owns the
// widgets. Guarded fallback keeps the menu working if loaded against an
// older sim.
function getSettings(){
  if(typeof settings==='undefined'||!settings)window.settings={volume:0.8,shake:true};
  return settings;
}
function persistSettings(){
  try{
    if(typeof saveSettings==='function')saveSettings();
    else if(typeof writeSave==='function')writeSave({settings:getSettings()});
  }catch(err){console.warn('Grimoire Siege: settings persist failed',err);}
}
function syncSettingsUI(){
  const s=getSettings();
  const vol=document.getElementById('set-volume');
  const val=document.getElementById('set-volume-val');
  const pct=Math.round((typeof s.volume==='number'?s.volume:0.8)*100);
  if(vol)vol.value=pct;
  if(val)val.textContent=pct+'%';
  const tog=document.getElementById('set-shake');
  const lab=document.getElementById('set-shake-label');
  if(tog)tog.classList.toggle('on',!!s.shake);
  if(lab)lab.textContent='Screen Shake: '+(s.shake?'ON':'OFF');
}
function openSettings(){
  syncSettingsUI();
  document.getElementById('settings-overlay').classList.add('show');
}
function closeSettings(){
  document.getElementById('settings-overlay').classList.remove('show');
  persistSettings();
}
function toggleShakeSetting(){
  const s=getSettings();
  s.shake=!s.shake;
  syncSettingsUI();
  persistSettings();
}
(function initSettingsWidgets(){
  const vol=document.getElementById('set-volume');
  if(!vol)return;
  vol.addEventListener('input',()=>{
    const s=getSettings();
    s.volume=vol.value/100;
    const val=document.getElementById('set-volume-val');
    if(val)val.textContent=vol.value+'%';
  });
  // Persist on release, not per-notch, and blip so the level is audible.
  vol.addEventListener('change',()=>{
    persistSettings();
    try{if(typeof sfx==='function')sfx('place');}catch(err){}
  });
})();
