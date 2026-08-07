// Grimoire Siege — fx: audio, particles, scenery pre-render, all drawing
// Part of the modular layout (vault rule 3): index.html + js/{content,sim,fx,ui}.js
// Classic scripts sharing top-level scope; load order: content, sim, fx, ui.

// Deterministic PRNG so the pre-rendered scenery is identical every redraw
// (a resize must not reshuffle the cobblestones underfoot).
function mulberry32(a){
  return function(){
    a|=0;a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return((t^t>>>14)>>>0)/4294967296;
  };
}

// ---------------- Sprite caches ----------------
// Radial-gradient glow sprites are pre-rendered once per (colour,radius) and
// blitted, because per-draw shadowBlur is the single most expensive thing you
// can ask a 2D canvas for and this game draws a lot of glowing things.
const glowCache=new Map();
function glowSprite(color,radius){
  const key=color+'|'+radius;
  let c=glowCache.get(key);
  if(c)return c;
  c=document.createElement('canvas');
  const s=radius*2;
  c.width=c.height=s;
  const g=c.getContext('2d');
  const grd=g.createRadialGradient(radius,radius,0,radius,radius,radius);
  grd.addColorStop(0,hexA(color,0.85));
  grd.addColorStop(0.4,hexA(color,0.32));
  grd.addColorStop(1,hexA(color,0));
  g.fillStyle=grd;g.fillRect(0,0,s,s);
  glowCache.set(key,c);
  return c;
}
function drawGlow(color,x,y,radius,alpha){
  const s=glowSprite(color,Math.round(radius));
  ctx.globalAlpha=alpha===undefined?1:alpha;
  ctx.drawImage(s,x-s.width/2,y-s.height/2);
  ctx.globalAlpha=1;
}
function hexA(hex,a){
  const h=hex.replace('#','');
  const full=h.length===3?h.split('').map(c=>c+c).join(''):h;
  const n=parseInt(full,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}
function shade(hex,amt){
  const h=hex.replace('#','');
  const full=h.length===3?h.split('').map(c=>c+c).join(''):h;
  const n=parseInt(full,16);
  const cl=v=>Math.max(0,Math.min(255,Math.round(v)));
  const r=cl(((n>>16)&255)*(1+amt)),g=cl(((n>>8)&255)*(1+amt)),b=cl((n&255)*(1+amt));
  return `rgb(${r},${g},${b})`;
}

// ---------------- Settings reads (sim owns the `settings` global) ----------------
// fx never assumes the global exists: pre-overhaul saves / partial merges must
// not crash the render loop. Missing settings mean full volume, shake on.
function fxVolume(){
  if(typeof settings==='object'&&settings&&typeof settings.volume==='number'){
    return Math.max(0,Math.min(1,settings.volume));
  }
  return 1;
}
const _reducedMotion=(typeof matchMedia==='function')&&matchMedia('(prefers-reduced-motion: reduce)').matches;
function fxShakeEnabled(){
  if(_reducedMotion)return false;
  if(typeof settings==='object'&&settings)return settings.shake!==false;
  return true;
}

// ---------------- Damage-class visual language ----------------
// Every resist cue pairs a COLOUR with a SHAPE (vault accessibility rule:
// never colour alone): pierce = lime arrowhead, blast = orange starburst,
// arcane = violet diamond. Shared by enemy badges, rims, and the portal stir.
const FX_CLASS_LIST=(typeof DAMAGE_CLASSES!=='undefined')?DAMAGE_CLASSES:['pierce','blast','arcane'];
const FX_CLASS={
  pierce:{col:'#a3e635'},
  blast:{col:'#fb923c'},
  arcane:{col:'#c084fc'},
};
function fxClassCol(cls){ return (FX_CLASS[cls]&&FX_CLASS[cls].col)||'#e5e7eb'; }
// Draws the class shape centred at (x,y) with "radius" r into context g.
function drawClassShape(g,cls,x,y,r){
  g.beginPath();
  if(cls==='pierce'){          // arrowhead, point up
    g.moveTo(x,y-r);g.lineTo(x+r*0.85,y+r*0.8);g.lineTo(x,y+r*0.3);g.lineTo(x-r*0.85,y+r*0.8);
  }else if(cls==='blast'){     // 4-point starburst
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4-Math.PI/2,rr=i%2===0?r:r*0.38;
      i===0?g.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr):g.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);
    }
  }else{                       // arcane (and fallback): diamond
    g.moveTo(x,y-r);g.lineTo(x+r*0.72,y);g.lineTo(x,y+r);g.lineTo(x-r*0.72,y);
  }
  g.closePath();
}

let _audioCtx;
function sfx(name){
  const vol=fxVolume();
  if(vol<=0)return; // muted — skip node creation entirely
  if(!_audioCtx) try{_audioCtx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){return;}
  if(_audioCtx.state==='suspended')try{_audioCtx.resume();}catch(e){}
  const o=_audioCtx.createOscillator(),g=_audioCtx.createGain();
  // Per-sound envelope stays authored at its original level; the master gain
  // applies settings.volume so every sfx respects the slider uniformly.
  const master=_audioCtx.createGain();master.gain.value=vol;
  o.connect(g);g.connect(master);master.connect(_audioCtx.destination);
  const t=_audioCtx.currentTime; g.gain.setValueAtTime(0.07,t);
  if(name==='place'){o.type='sine';o.frequency.setValueAtTime(440,t);o.frequency.setValueAtTime(660,t+0.06);g.gain.exponentialRampToValueAtTime(0.001,t+0.12);o.start(t);o.stop(t+0.12);}
  else if(name==='kill'){o.type='square';o.frequency.setValueAtTime(300,t);o.frequency.setValueAtTime(150,t+0.08);g.gain.exponentialRampToValueAtTime(0.001,t+0.1);o.start(t);o.stop(t+0.1);}
  else if(name==='wave'){o.type='sine';o.frequency.setValueAtTime(330,t);o.frequency.setValueAtTime(440,t+0.15);o.frequency.setValueAtTime(660,t+0.3);g.gain.exponentialRampToValueAtTime(0.001,t+0.45);o.start(t);o.stop(t+0.45);}
  else if(name==='hit'){o.type='sawtooth';o.frequency.setValueAtTime(100,t);g.gain.setValueAtTime(0.05,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.06);o.start(t);o.stop(t+0.06);}
  else if(name==='sell'){o.type='triangle';o.frequency.setValueAtTime(500,t);o.frequency.setValueAtTime(320,t+0.08);g.gain.exponentialRampToValueAtTime(0.001,t+0.14);o.start(t);o.stop(t+0.14);}
  else if(name==='lose'){o.type='sawtooth';o.frequency.setValueAtTime(300,t);o.frequency.setValueAtTime(100,t+0.3);g.gain.exponentialRampToValueAtTime(0.001,t+0.5);o.start(t);o.stop(t+0.5);}
  else if(name==='win'){o.type='sine';o.frequency.setValueAtTime(523,t);o.frequency.setValueAtTime(659,t+0.12);o.frequency.setValueAtTime(784,t+0.24);o.frequency.setValueAtTime(1047,t+0.36);g.gain.exponentialRampToValueAtTime(0.001,t+0.7);o.start(t);o.stop(t+0.7);}
  // A branch pick is a decisive stamp: short major arpeggio, done in a quarter second.
  else if(name==='branch'){o.type='triangle';g.gain.setValueAtTime(0.09,t);o.frequency.setValueAtTime(392,t);o.frequency.setValueAtTime(523,t+0.05);o.frequency.setValueAtTime(659,t+0.1);g.gain.exponentialRampToValueAtTime(0.001,t+0.24);o.start(t);o.stop(t+0.24);}
  // Crossing into endless: a long rise from the depths, with a detuned twin
  // oscillator beating against the fundamental so the swell carries menace.
  else if(name==='endless'){
    o.type='sawtooth';
    o.frequency.setValueAtTime(82,t);
    o.frequency.exponentialRampToValueAtTime(392,t+0.85);
    g.gain.setValueAtTime(0.045,t);
    g.gain.linearRampToValueAtTime(0.085,t+0.6);
    g.gain.exponentialRampToValueAtTime(0.001,t+1.05);
    const o2=_audioCtx.createOscillator();
    o2.type='sawtooth';
    o2.frequency.setValueAtTime(82*1.06,t);
    o2.frequency.exponentialRampToValueAtTime(392*1.06,t+0.85);
    o2.connect(g);
    o.start(t);o.stop(t+1.05);o2.start(t);o2.stop(t+1.05);
  }
  else{o.disconnect();}
}

// ---------------- Effect helpers ----------------
function spark(x,y,col,spread){
  if(particles.length>MAX_PARTICLES)return;
  const a=Math.random()*Math.PI*2,s=Math.random()*(spread||3);
  particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,decay:0.045+Math.random()*0.03,col,r:1.6+Math.random()*2.4});
}
function ring(x,y,col,maxR,strength){
  particles.push({type:'ring',x,y,r:2,maxR,life:1,decay:0.055,col,w:2.5*(strength||1)});
}
function floater(x,y,text,col){
  floaters.push({x,y,text,col,life:1});
}
function portalBurst(){
  for(let i=0;i<5;i++)spark(path[0].x,path[0].y,'#a855f7',2.2);
}
function seedEmbers(){
  embers=[];
  const n=Math.round(Math.min(46,(W*H)/16000));
  for(let i=0;i<n;i++){
    embers.push({x:Math.random()*W,y:Math.random()*H,r:0.6+Math.random()*1.6,
      vy:-(4+Math.random()*11),vx:(Math.random()-0.5)*7,
      a:0.12+Math.random()*0.4,ph:Math.random()*Math.PI*2});
  }
}

// ---------------- Static scenery pre-render ----------------
// The ground, the road and every fixed decoration are painted once into an
// offscreen canvas and blitted each frame. Only living things are redrawn.
function buildBackground(){
  if(!bgCanvas){bgCanvas=document.createElement('canvas');}
  bgCanvas.width=Math.round(W*dpr);
  bgCanvas.height=Math.round(H*dpr);
  bgCtx=bgCanvas.getContext('2d');
  const g=bgCtx;
  g.setTransform(dpr,0,0,dpr,0,0);
  const rnd=mulberry32(1337);

  // Base ground
  const base=g.createLinearGradient(0,0,0,H);
  base.addColorStop(0,'#120a26');
  base.addColorStop(0.55,'#0b0719');
  base.addColorStop(1,'#06040f');
  g.fillStyle=base;g.fillRect(0,0,W,H);

  // Distant moon-glow from the upper left
  const moon=g.createRadialGradient(W*0.18,-H*0.15,0,W*0.18,-H*0.15,Math.max(W,H)*0.85);
  moon.addColorStop(0,'rgba(139,92,246,0.16)');
  moon.addColorStop(0.5,'rgba(88,28,187,0.06)');
  moon.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=moon;g.fillRect(0,0,W,H);

  // Mossy ground blotches
  for(let i=0;i<70;i++){
    const x=rnd()*W,y=rnd()*H,r=14+rnd()*60;
    g.fillStyle=rnd()>0.5?'rgba(56,30,110,0.055)':'rgba(20,55,45,0.05)';
    g.beginPath();g.ellipse(x,y,r,r*(0.45+rnd()*0.35),rnd()*Math.PI,0,Math.PI*2);g.fill();
  }

  // Faint arcane grid
  g.strokeStyle='rgba(124,58,237,0.045)';g.lineWidth=1;
  for(let x=0;x<W;x+=44){g.beginPath();g.moveTo(x+0.5,0);g.lineTo(x+0.5,H);g.stroke();}
  for(let y=0;y<H;y+=44){g.beginPath();g.moveTo(0,y+0.5);g.lineTo(W,y+0.5);g.stroke();}

  // Scattered rocks and dead brush off-path
  for(let i=0;i<44;i++){
    const x=rnd()*W,y=rnd()*H;
    if(isBlockedByPath(x,y))continue;
    if(rnd()>0.45){
      const r=2.5+rnd()*5;
      g.fillStyle='rgba(90,80,120,0.22)';
      g.beginPath();g.ellipse(x,y,r,r*0.72,rnd()*3,0,Math.PI*2);g.fill();
      g.fillStyle='rgba(150,140,190,0.10)';
      g.beginPath();g.ellipse(x-r*0.2,y-r*0.25,r*0.55,r*0.36,0,0,Math.PI*2);g.fill();
    }else{
      g.strokeStyle='rgba(70,55,40,0.28)';g.lineWidth=1.1;
      for(let b=0;b<3;b++){
        const a=-Math.PI/2+(rnd()-0.5)*1.5,len=4+rnd()*8;
        g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.cos(a)*len,y+Math.sin(a)*len);g.stroke();
      }
    }
  }

  drawRoad(g,rnd);

  // Vignette
  const vg=g.createRadialGradient(W/2,H/2,Math.min(W,H)*0.32,W/2,H/2,Math.max(W,H)*0.78);
  vg.addColorStop(0,'rgba(0,0,0,0)');
  vg.addColorStop(1,'rgba(0,0,0,0.62)');
  g.fillStyle=vg;g.fillRect(0,0,W,H);
}

function drawRoad(g,rnd){
  const trace=()=>{g.beginPath();g.moveTo(path[0].x,path[0].y);for(let i=1;i<path.length;i++)g.lineTo(path[i].x,path[i].y);};
  g.lineCap='round';g.lineJoin='round';

  // Soft ground shadow under the road
  trace();g.strokeStyle='rgba(0,0,0,0.5)';g.lineWidth=42;g.stroke();
  // Earth verge
  trace();g.strokeStyle='#181128';g.lineWidth=36;g.stroke();
  // Road bed
  trace();g.strokeStyle='#241a3d';g.lineWidth=28;g.stroke();
  // Inner darker rut
  trace();g.strokeStyle='#1b1330';g.lineWidth=22;g.stroke();

  // Cobblestones laid along the polyline
  for(let i=0;i<path.length-1;i++){
    const A=path[i],B=path[i+1];
    const dx=B.x-A.x,dy=B.y-A.y;
    const len=Math.hypot(dx,dy);
    if(len===0)continue;
    const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
    for(let d=6;d<len-4;d+=11){
      for(let lane=-1;lane<=1;lane++){
        const off=lane*7.5+(rnd()-0.5)*2.4;
        const jitter=(rnd()-0.5)*3;
        const cx=A.x+ux*(d+jitter)+nx*off;
        const cy=A.y+uy*(d+jitter)+ny*off;
        const w=3.6+rnd()*2.2,h=3.0+rnd()*1.8;
        const lum=rnd();
        g.save();
        g.translate(cx,cy);
        g.rotate(Math.atan2(uy,ux)+(rnd()-0.5)*0.5);
        g.fillStyle=lum>0.82?'rgba(126,106,175,0.34)':lum>0.5?'rgba(88,72,132,0.28)':'rgba(56,44,90,0.3)';
        g.beginPath();
        if(g.roundRect)g.roundRect(-w/2,-h/2,w,h,1.4);
        else g.rect(-w/2,-h/2,w,h);
        g.fill();
        g.restore();
      }
    }
  }

  // Glowing rune kerbstones on both edges
  for(let i=0;i<path.length-1;i++){
    const A=path[i],B=path[i+1];
    const dx=B.x-A.x,dy=B.y-A.y;
    const len=Math.hypot(dx,dy);
    if(len===0)continue;
    const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
    for(let d=10;d<len-6;d+=34){
      for(const side of [-1,1]){
        const cx=A.x+ux*d+nx*side*14.5;
        const cy=A.y+uy*d+ny*side*14.5;
        g.fillStyle='rgba(167,139,250,0.30)';
        g.beginPath();g.arc(cx,cy,1.7,0,Math.PI*2);g.fill();
        g.fillStyle='rgba(167,139,250,0.09)';
        g.beginPath();g.arc(cx,cy,4.4,0,Math.PI*2);g.fill();
      }
    }
  }

  // Road edge lines
  g.strokeStyle='rgba(167,139,250,0.13)';g.lineWidth=1.2;
  for(const side of [-1,1]){
    g.beginPath();
    for(let i=0;i<path.length;i++){
      const prev=path[Math.max(0,i-1)],next=path[Math.min(path.length-1,i+1)];
      const dx=next.x-prev.x,dy=next.y-prev.y;
      const l=Math.hypot(dx,dy)||1;
      const nx=-dy/l*13.5*side,ny=dx/l*13.5*side;
      if(i===0)g.moveTo(path[i].x+nx,path[i].y+ny);
      else g.lineTo(path[i].x+nx,path[i].y+ny);
    }
    g.stroke();
  }
}

// ---------------- Rendering ----------------
function render(dt){
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.save();
  // Shake is gated on settings.shake and on prefers-reduced-motion; the sim
  // still decays the `shake` value either way so re-enabling is seamless.
  if(shake>0.05&&fxShakeEnabled()){
    ctx.translate((Math.random()-0.5)*shake,(Math.random()-0.5)*shake);
  }

  // Static scenery
  if(bgCanvas)ctx.drawImage(bgCanvas,0,0,W,H);

  drawEmbers();
  drawPathFlow();
  drawPortal();
  drawWavePreviewStir();
  drawCrystal();

  // Ground-level effects first so units read on top of them
  particles.forEach(p=>{if(p.type==='ring')drawRingParticle(p);});

  // Range rings sit under the units
  if(selectedPlacedTower&&towers.includes(selectedPlacedTower)){
    const stats=towerStats(selectedPlacedTower);
    drawRangeRing(selectedPlacedTower.x,selectedPlacedTower.y,stats.range,'#fbbf24',0.5);
  }
  if(selectedTower&&hoverX!==null&&hoverY!==null){
    const valid=isValidPlacement(hoverX,hoverY);
    drawPlacementPreview(hoverX,hoverY,valid);
  }

  // Depth sort so nearer (lower) sprites overlap farther ones
  const units=towers.map(t=>({y:t.y,kind:'t',o:t})).concat(enemies.map(e=>({y:e.y,kind:'e',o:e})));
  units.sort((a,b)=>a.y-b.y);
  units.forEach(u=>{u.kind==='t'?drawTower(u.o):drawEnemy(u.o);});

  projectiles.forEach(drawProjectile);
  particles.forEach(p=>{
    if(p.type==='ring')return;
    if(p.type==='bolt')drawBolt(p);
    else{
      ctx.globalAlpha=Math.max(0,p.life);
      ctx.fillStyle=p.col;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;
    }
  });
  drawFloaters();

  ctx.restore();

  // Full-screen damage flash when the crystal is struck
  if(damageFlash>0.01){
    const gd=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.25,W/2,H/2,Math.max(W,H)*0.7);
    gd.addColorStop(0,'rgba(220,38,38,0)');
    gd.addColorStop(1,`rgba(220,38,38,${(damageFlash*0.42).toFixed(3)})`);
    ctx.fillStyle=gd;ctx.fillRect(0,0,W,H);
  }
}

function drawEmbers(){
  for(const em of embers){
    const tw=0.6+0.4*Math.sin(now*2+em.ph);
    ctx.globalAlpha=em.a*tw;
    ctx.fillStyle='#c4b5fd';
    ctx.beginPath();ctx.arc(em.x,em.y,em.r,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
}

// Motes of energy streaming along the road toward the crystal.
function drawPathFlow(){
  const COUNT=13;
  for(let i=0;i<COUNT;i++){
    const d=((now*46+i*(pathTotal/COUNT))%pathTotal);
    const pt=pointAtDistance(d);
    if(!pt)continue;
    const fade=0.25+0.25*Math.sin(now*3+i);
    ctx.globalAlpha=fade;
    ctx.fillStyle='#a78bfa';
    ctx.beginPath();ctx.arc(pt.x,pt.y,1.9,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=fade*0.35;
    ctx.beginPath();ctx.arc(pt.x,pt.y,5.5,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
}

function pointAtDistance(d){
  for(let i=1;i<pathCum.length;i++){
    if(d<=pathCum[i]){
      const seg=pathCum[i]-pathCum[i-1];
      const t=seg===0?0:(d-pathCum[i-1])/seg;
      return {x:path[i-1].x+(path[i].x-path[i-1].x)*t,y:path[i-1].y+(path[i].y-path[i-1].y)*t};
    }
  }
  return path[path.length-1];
}

// Spawn portal at the road's mouth.
function drawPortal(){
  const p=path[0];
  ctx.save();
  ctx.translate(p.x,p.y);
  drawGlow('#7c3aed',0,0,34,0.5);
  for(let i=0;i<3;i++){
    const rot=now*(0.8+i*0.45)*(i%2?-1:1);
    const rx=8+i*5.5,ry=15+i*7;
    ctx.strokeStyle=hexA('#a855f7',0.42-i*0.1);
    ctx.lineWidth=2-i*0.4;
    ctx.save();ctx.rotate(rot);
    ctx.beginPath();ctx.ellipse(0,0,rx,ry,0,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle='rgba(10,2,26,0.85)';
  ctx.beginPath();ctx.ellipse(0,0,7,14,0,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ---------------- Wave-preview portal stir ----------------
// While `nextWaveDef` exists and no wave is running (the read-and-react gap),
// the portal churns in the resist-class colours of what is about to come
// through: rotating arcs plus motes sucked inward. The preview panel is ui's;
// this is the on-board presence for the same moment, coordinated purely via
// the existing `nextWaveDef` / `waveActive` globals. Cost: <=3 arcs per frame
// and at most one particle every 6th frame, MAX_PARTICLES-gated.
let _stirDef=null,_stirCols=null;
function previewStirCols(){
  if(typeof nextWaveDef==='undefined'||!nextWaveDef)return null;
  if(nextWaveDef===_stirDef)return _stirCols;
  _stirDef=nextWaveDef;
  const cols=[];
  const profs=nextWaveDef.profiles;
  if(Array.isArray(profs)){
    for(const pr of profs){
      if(!pr||!pr.resists)continue;
      let best=null,bestV=0.15; // ignore token resists
      for(const cls of FX_CLASS_LIST){
        const v=pr.resists[cls]||0;
        if(v>bestV){bestV=v;best=cls;}
      }
      if(best)cols.push(fxClassCol(best));
    }
  }
  // A no-resist wave still stirs, in the portal's own violet.
  if(!cols.length)cols.push('#a855f7');
  _stirCols=cols.slice(0,3);
  return _stirCols;
}
function drawWavePreviewStir(){
  if(!gameStarted||waveActive)return;
  const cols=previewStirCols();
  if(!cols)return;
  const p=path[0];
  // Reduced motion: the stir carries information (the incoming wave's resist
  // colours), so it doesn't vanish — it holds still. Fixed angles, fixed
  // alpha, no inward motes.
  const still=_reducedMotion;
  ctx.save();
  ctx.translate(p.x,p.y);
  drawGlow(cols[0],0,0,40,still?0.22:0.22+0.1*Math.sin(now*3));
  for(let i=0;i<cols.length;i++){
    const dirn=i%2?-1:1;
    const a=still?(i*2.1):(now*(1.5+i*0.4)*dirn);
    ctx.strokeStyle=hexA(cols[i],still?0.45:0.38+0.18*Math.sin(now*4+i*2.1));
    ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(0,0,23+i*5,a,a+1.7);ctx.stroke();
  }
  ctx.restore();
  // Motes drawn into the maw — spawned sparingly, budget-gated.
  if(!still&&frame%6===0&&particles.length<MAX_PARTICLES-20){
    const col=cols[(frame/6|0)%cols.length];
    const a=Math.random()*Math.PI*2,r=22+Math.random()*16;
    particles.push({
      x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r,
      vx:-Math.cos(a)*1.1,vy:-Math.sin(a)*1.1-0.3,
      life:1,decay:0.04,col,r:1.3+Math.random()*1.4
    });
  }
}

// The crystal you are defending — pulses, spins, and reddens as lives drop.
function drawCrystal(){
  const p=path[path.length-1];
  const health=Math.max(0,Math.min(1,lives/START_LIVES));
  const hue=health;   // 1 = healthy cyan/violet, 0 = angry red
  const core=hue>0.5?'#a78bfa':hue>0.25?'#f0abfc':'#f87171';
  const edge=hue>0.5?'#c4b5fd':hue>0.25?'#f5d0fe':'#fca5a5';
  const pulse=1+0.07*Math.sin(now*2.6)+crystalHit*0.28;

  ctx.save();
  ctx.translate(p.x,p.y);

  // Ground halo
  drawGlow(core,0,0,46*pulse,0.55+crystalHit*0.35);

  // Orbiting shards
  for(let i=0;i<3;i++){
    const a=now*0.9+i*(Math.PI*2/3);
    const ox=Math.cos(a)*24,oy=Math.sin(a)*10;
    ctx.globalAlpha=0.55;
    ctx.fillStyle=edge;
    ctx.save();ctx.translate(ox,oy);ctx.rotate(a*2);
    ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(2.4,0);ctx.lineTo(0,4);ctx.lineTo(-2.4,0);ctx.closePath();ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha=1;

  // Pedestal
  ctx.fillStyle='rgba(0,0,0,0.45)';
  ctx.beginPath();ctx.ellipse(0,15,17,6,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#2a2044';
  ctx.beginPath();ctx.moveTo(-14,14);ctx.lineTo(14,14);ctx.lineTo(10,7);ctx.lineTo(-10,7);ctx.closePath();ctx.fill();
  ctx.fillStyle='#3b2d60';
  ctx.beginPath();ctx.ellipse(0,7,10,3.4,0,0,Math.PI*2);ctx.fill();

  // Crystal body (facetted hexagon)
  ctx.save();
  ctx.scale(pulse,pulse);
  const grd=ctx.createLinearGradient(-10,-20,10,10);
  grd.addColorStop(0,edge);
  grd.addColorStop(0.5,core);
  grd.addColorStop(1,shade(core,-0.55));
  ctx.fillStyle=grd;
  ctx.beginPath();
  ctx.moveTo(0,-22);ctx.lineTo(10,-8);ctx.lineTo(7,8);ctx.lineTo(0,14);
  ctx.lineTo(-7,8);ctx.lineTo(-10,-8);ctx.closePath();
  ctx.fill();
  // Facet highlight
  ctx.fillStyle=hexA('#ffffff',0.3);
  ctx.beginPath();ctx.moveTo(0,-22);ctx.lineTo(10,-8);ctx.lineTo(0,-2);ctx.closePath();ctx.fill();
  ctx.fillStyle=hexA('#000000',0.22);
  ctx.beginPath();ctx.moveTo(0,-2);ctx.lineTo(7,8);ctx.lineTo(0,14);ctx.closePath();ctx.fill();
  ctx.strokeStyle=hexA(edge,0.75);ctx.lineWidth=1.1;
  ctx.beginPath();
  ctx.moveTo(0,-22);ctx.lineTo(10,-8);ctx.lineTo(7,8);ctx.lineTo(0,14);
  ctx.lineTo(-7,8);ctx.lineTo(-10,-8);ctx.closePath();
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawRangeRing(x,y,r,col,alpha){
  ctx.strokeStyle=hexA(col,alpha);
  ctx.lineWidth=1.6;
  ctx.setLineDash([]);
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle=hexA(col,0.05);
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  // Rotating tick marks so the ring reads as active
  ctx.strokeStyle=hexA(col,alpha*0.8);
  ctx.lineWidth=2;
  for(let i=0;i<8;i++){
    const a=now*0.5+i*Math.PI/4;
    ctx.beginPath();
    ctx.arc(x,y,r,a,a+0.09);
    ctx.stroke();
  }
}

function drawPlacementPreview(x,y,valid){
  const col=valid?'#4ade80':'#f87171';
  ctx.setLineDash([6,6]);
  ctx.lineDashOffset=-now*18;
  ctx.lineWidth=2;
  ctx.strokeStyle=hexA(col,0.65);
  ctx.beginPath();ctx.arc(x,y,selectedTower.range,0,Math.PI*2);ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset=0;
  ctx.fillStyle=hexA(col,0.08);
  ctx.beginPath();ctx.arc(x,y,selectedTower.range,0,Math.PI*2);ctx.fill();
  // Footprint
  ctx.fillStyle=hexA(col,0.22);
  ctx.beginPath();ctx.ellipse(x,y+6,16,7,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=hexA(col,0.8);ctx.lineWidth=1.4;
  ctx.beginPath();ctx.ellipse(x,y+6,16,7,0,0,Math.PI*2);ctx.stroke();
  if(!valid){
    ctx.strokeStyle=hexA(col,0.9);ctx.lineWidth=2.4;
    ctx.beginPath();ctx.moveTo(x-8,y-8);ctx.lineTo(x+8,y+8);ctx.moveTo(x+8,y-8);ctx.lineTo(x-8,y+8);ctx.stroke();
  }
}

// ---------------- Tower art ----------------
function drawTower(t){
  const lvl=t.level||0;
  const bob=Math.sin(now*1.8+t.phase)*1.1;
  const recoil=(t.recoil||0)*4;
  ctx.save();
  ctx.translate(t.x,t.y);

  // Cast shadow
  ctx.fillStyle='rgba(0,0,0,0.42)';
  ctx.beginPath();ctx.ellipse(2,14,15,6,0,0,Math.PI*2);ctx.fill();

  // Stone plinth
  ctx.fillStyle='#221a38';
  ctx.beginPath();
  if(ctx.roundRect)ctx.roundRect(-14,4,28,11,3.5);else ctx.rect(-14,4,28,11);
  ctx.fill();
  ctx.fillStyle='#332853';
  ctx.beginPath();ctx.ellipse(0,4.5,13.5,5,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#191230';
  ctx.beginPath();ctx.ellipse(0,4.5,9.5,3.4,0,0,Math.PI*2);ctx.fill();

  // Elemental rune ring on the plinth, colour-keyed to the tower
  ctx.strokeStyle=hexA(t.color,0.45+0.2*Math.sin(now*3+t.phase));
  ctx.lineWidth=1.4;
  ctx.beginPath();ctx.ellipse(0,4.5,11.5,4.2,0,0,Math.PI*2);ctx.stroke();

  // Tower shaft
  const shaft=ctx.createLinearGradient(-9,-14,9,6);
  shaft.addColorStop(0,'#463a6e');
  shaft.addColorStop(0.5,'#2e2450');
  shaft.addColorStop(1,'#1b1436');
  ctx.fillStyle=shaft;
  ctx.beginPath();
  ctx.moveTo(-8.5,5);ctx.lineTo(-6.5,-9+bob);ctx.lineTo(6.5,-9+bob);ctx.lineTo(8.5,5);
  ctx.closePath();ctx.fill();
  ctx.strokeStyle=hexA(t.color,0.22);ctx.lineWidth=1;ctx.stroke();

  // Battlement lip
  ctx.fillStyle='#3d3161';
  ctx.beginPath();
  if(ctx.roundRect)ctx.roundRect(-9.5,-13+bob,19,5,1.8);else ctx.rect(-9.5,-13+bob,19,5);
  ctx.fill();

  // Branch crest: a chosen specialization flies its colours. Colour AND shape
  // differ per branch — 'a' is a gold triangular pennant, 'b' a cyan
  // swallowtail — plus a matching stripe on the battlement lip, so the pick
  // reads at a glance without hover text.
  if(t.branch==='a'||t.branch==='b'){
    const isA=t.branch==='a';
    const bcol=isA?'#fbbf24':'#22d3ee';
    const px=-11,py=-13+bob;         // pole foot on the battlement's left edge
    ctx.strokeStyle='#0f0a20';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px,py-11);ctx.stroke();
    const flut=Math.sin(now*6+t.phase)*1.1; // gentle flutter at the tip
    ctx.fillStyle=bcol;
    ctx.beginPath();
    if(isA){ // triangular pennant
      ctx.moveTo(px,py-11);ctx.lineTo(px+9+flut,py-9);ctx.lineTo(px,py-6.5);
    }else{   // swallowtail
      ctx.moveTo(px,py-11);ctx.lineTo(px+9+flut,py-10);ctx.lineTo(px+5.5,py-8.6);
      ctx.lineTo(px+9+flut,py-7);ctx.lineTo(px,py-6.5);
    }
    ctx.closePath();ctx.fill();
    ctx.strokeStyle=hexA('#000000',0.35);ctx.lineWidth=0.8;ctx.stroke();
    // Lip stripe in the branch colour
    ctx.fillStyle=hexA(bcol,0.4);
    ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(-9.5,-13+bob,19,1.6,0.8);else ctx.rect(-9.5,-13+bob,19,1.6);
    ctx.fill();
  }

  // Level pips
  for(let i=0;i<MAX_TOWER_LEVEL;i++){
    ctx.fillStyle=i<lvl?'#fbbf24':'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.arc(-6+i*6,10.5,1.7,0,Math.PI*2);
    ctx.fill();
  }

  // Floating focus orb (channels the element) — glow sprite instead of blur
  const orbY=-20+bob-recoil*0.5;
  const orbR=6+lvl*0.7;
  drawGlow(t.color,0,orbY,20+lvl*3,0.75);
  const og=ctx.createRadialGradient(-orbR*0.35,orbY-orbR*0.4,orbR*0.15,0,orbY,orbR);
  og.addColorStop(0,'#ffffff');
  og.addColorStop(0.35,shade(t.color,0.35));
  og.addColorStop(1,shade(t.color,-0.4));
  ctx.fillStyle=og;
  ctx.beginPath();ctx.arc(0,orbY,orbR,0,Math.PI*2);ctx.fill();

  // Orbiting motes, one per upgrade level
  for(let i=0;i<lvl;i++){
    const a=now*2.2+i*(Math.PI*2/Math.max(1,lvl));
    ctx.fillStyle=hexA('#fde68a',0.85);
    ctx.beginPath();ctx.arc(Math.cos(a)*(orbR+5),orbY+Math.sin(a)*(orbR+5)*0.6,1.5,0,Math.PI*2);ctx.fill();
  }

  // Emitter barrel, swung to face the current target
  ctx.save();
  ctx.rotate(t.aim||0);
  ctx.translate(-recoil,0);
  ctx.fillStyle='#4a3d72';
  ctx.beginPath();
  if(ctx.roundRect)ctx.roundRect(2,-3,14,6,2.4);else ctx.rect(2,-3,14,6);
  ctx.fill();
  ctx.fillStyle=hexA(t.color,0.85);
  ctx.beginPath();
  if(ctx.roundRect)ctx.roundRect(12,-2.2,4.5,4.4,1.6);else ctx.rect(12,-2.2,4.5,4.4);
  ctx.fill();
  if((t.flash||0)>0.02){
    ctx.globalAlpha=t.flash;
    drawGlow(t.color,18,0,15,1);
    ctx.globalAlpha=1;
  }
  ctx.restore();

  // Element sigil rides on the orb
  ctx.font='11px serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.globalAlpha=0.95;
  ctx.fillText(t.icon,0,orbY);
  ctx.globalAlpha=1;

  ctx.restore();
}

// ---------------- Resist badges ----------------
// Each resist profile gets a small plaque — profile icon + one shape-pip per
// resisted damage class (shape AND colour per class, pip size scales with the
// resist fraction) — pre-rendered ONCE per profile into an offscreen canvas
// (same idiom as glowSprite) and blitted above each enemy. Per enemy per
// frame this costs one drawImage plus one stroked rim arc; no text, no
// shadowBlur, no gradients on the hot path.
const _badgeCache=new Map();
const BADGE_SCALE=3; // sprites rendered at 3x so the glyphs stay crisp under dpr
function resistBadge(e){
  const rz=e.resists;
  if(!rz)return null;
  const classes=[];
  for(const cls of FX_CLASS_LIST){ if((rz[cls]||0)>=0.15)classes.push(cls); }
  if(!classes.length)return null; // no-resist profile: clean board, no badge
  const prof=e.profile||null;
  const key=(prof&&prof.id)||classes.map(c=>c+((rz[c]*10)|0)).join('|');
  let entry=_badgeCache.get(key);
  if(!entry){
    entry=renderResistBadge((prof&&prof.icon)||'',classes,rz);
    _badgeCache.set(key,entry);
  }
  return entry;
}
function renderResistBadge(icon,classes,rz){
  const S=BADGE_SCALE;
  // Dominant class tints the plaque border — the same colour used for the
  // enemy's rim, so badge and body read as one statement.
  let dom=classes[0];
  for(const cls of classes){ if((rz[cls]||0)>(rz[dom]||0))dom=cls; }
  const iconW=icon?11:0;
  const w=(5+iconW+classes.length*9+3),h=13;
  const c=document.createElement('canvas');
  c.width=w*S;c.height=h*S;
  const g=c.getContext('2d');
  g.scale(S,S);
  g.fillStyle='rgba(8,4,18,0.8)';
  g.strokeStyle=hexA(fxClassCol(dom),0.85);
  g.lineWidth=0.8;
  g.beginPath();
  if(g.roundRect)g.roundRect(0.6,0.6,w-1.2,h-1.2,3);else g.rect(0.6,0.6,w-1.2,h-1.2);
  g.fill();g.stroke();
  if(icon){
    g.font='8px serif';g.textAlign='center';g.textBaseline='middle';
    g.fillStyle='#e5e7eb';
    g.fillText(icon,4+iconW/2,h/2+0.5);
  }
  let x=5+iconW+4;
  for(const cls of classes){
    const v=rz[cls]||0;
    g.fillStyle=fxClassCol(cls);
    drawClassShape(g,cls,x,h/2,2.4+v*2.6); // heavier resist = bigger pip
    g.fill();
    if(v>=0.5){ // severe resist gets a white keyline on top of size
      g.strokeStyle='rgba(255,255,255,0.85)';g.lineWidth=0.6;g.stroke();
    }
    x+=9;
  }
  return {c,domCol:fxClassCol(dom)};
}

// ---------------- Enemy art ----------------
function drawEnemy(e){
  const s=e.size;
  const badge=resistBadge(e); // cached sprite lookup — cheap map get per frame
  const walk=now*(e.kind==='fast'?11:6)+e.phase;
  const bob=Math.sin(walk)*(e.kind==='boss'?1.4:2.1);
  const lean=Math.sin(walk*0.5)*0.07;
  ctx.save();
  ctx.translate(e.x,e.y+bob);

  // Shadow stays on the ground while the body bobs
  ctx.fillStyle='rgba(0,0,0,0.4)';
  ctx.beginPath();ctx.ellipse(0,s*0.82-bob,s*0.7,s*0.26,0,0,Math.PI*2);ctx.fill();

  // Speed streaks behind fast runners
  if(e.kind==='fast'&&e.dir!==undefined){
    ctx.strokeStyle=hexA('#c084fc',0.35);
    ctx.lineWidth=1.6;
    for(let i=1;i<=3;i++){
      const d=i*6;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(e.dir)*d,-Math.sin(e.dir)*d);
      ctx.lineTo(-Math.cos(e.dir)*(d+5),-Math.sin(e.dir)*(d+5));
      ctx.stroke();
    }
  }

  ctx.rotate(lean);

  const body=e.kind==='boss'?'#8b3a0c':e.kind==='fast'?'#5b21b6':'#7f1d1d';
  const bodyLit=e.kind==='boss'?'#f59e0b':e.kind==='fast'?'#c084fc':'#ef4444';

  // Legs
  ctx.strokeStyle=shade(body,-0.3);
  ctx.lineWidth=e.kind==='boss'?3.4:2.3;
  ctx.lineCap='round';
  for(const side of [-1,1]){
    const swing=Math.sin(walk+(side>0?0:Math.PI))*s*0.28;
    ctx.beginPath();
    ctx.moveTo(side*s*0.3,s*0.45);
    ctx.lineTo(side*s*0.34+swing,s*0.85);
    ctx.stroke();
  }

  // Cloaked body
  const bg=ctx.createLinearGradient(0,-s,0,s*0.9);
  bg.addColorStop(0,bodyLit);
  bg.addColorStop(0.45,body);
  bg.addColorStop(1,shade(body,-0.45));
  ctx.fillStyle=bg;
  const flare=s*0.62+Math.sin(walk*2)*s*0.06;
  ctx.beginPath();
  ctx.moveTo(0,-s*0.98);
  ctx.quadraticCurveTo(s*0.88,-s*0.42,flare,s*0.62);
  ctx.quadraticCurveTo(0,s*0.34,-flare,s*0.62);
  ctx.quadraticCurveTo(-s*0.88,-s*0.42,0,-s*0.98);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle=hexA(bodyLit,0.55);ctx.lineWidth=1.1;ctx.stroke();

  // Ragged hem
  ctx.fillStyle=shade(body,-0.5);
  ctx.beginPath();
  ctx.moveTo(-flare,s*0.6);
  for(let i=0;i<=6;i++){
    const fx=-flare+(flare*2)*(i/6);
    ctx.lineTo(fx,s*0.6+(i%2?s*0.16:0));
  }
  ctx.lineTo(flare,s*0.6);
  ctx.closePath();ctx.fill();

  // Hood void
  ctx.fillStyle='rgba(6,2,12,0.82)';
  ctx.beginPath();ctx.ellipse(0,-s*0.42,s*0.46,s*0.4,0,0,Math.PI*2);ctx.fill();

  // Eyes
  const eyeCol=e.kind==='boss'?'#fde047':e.kind==='fast'?'#e9d5ff':'#fca5a5';
  drawGlow(eyeCol,0,-s*0.42,s*0.75,0.55);
  ctx.fillStyle=eyeCol;
  for(const side of [-1,1]){
    ctx.beginPath();
    ctx.ellipse(side*s*0.19,-s*0.44,s*0.1,s*0.13,side*0.3,0,Math.PI*2);
    ctx.fill();
  }

  // Resist rim: a slow-pulsing ward circle in the dominant resisted class's
  // colour. The shape half of the pairing lives in the badge overhead.
  if(badge){
    ctx.strokeStyle=hexA(badge.domCol,0.3+0.14*Math.sin(now*2.5+e.phase));
    ctx.lineWidth=1.4;
    ctx.beginPath();ctx.arc(0,-s*0.15,s*1.02,0,Math.PI*2);ctx.stroke();
  }

  // Boss crown of horns
  if(e.kind==='boss'){
    ctx.fillStyle='#fbbf24';
    for(const side of [-1,1]){
      ctx.beginPath();
      ctx.moveTo(side*s*0.36,-s*0.7);
      ctx.quadraticCurveTo(side*s*0.72,-s*1.16,side*s*0.44,-s*1.34);
      ctx.quadraticCurveTo(side*s*0.42,-s*0.94,side*s*0.24,-s*0.78);
      ctx.closePath();ctx.fill();
    }
    // Aura
    ctx.strokeStyle=hexA('#f59e0b',0.3+0.16*Math.sin(now*4));
    ctx.lineWidth=1.6;
    ctx.beginPath();ctx.arc(0,-s*0.15,s*1.18,0,Math.PI*2);ctx.stroke();
  }

  // Status overlays
  if(e.slow>0){
    ctx.fillStyle='rgba(56,189,248,0.28)';
    ctx.beginPath();ctx.arc(0,-s*0.15,s*0.98,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=hexA('#7dd3fc',0.8);ctx.lineWidth=1.2;
    for(let i=0;i<5;i++){
      const a=now*0.6+i*(Math.PI*2/5);
      const rx=Math.cos(a)*s*0.85,ry=Math.sin(a)*s*0.85-s*0.15;
      ctx.beginPath();
      ctx.moveTo(rx,ry-2.6);ctx.lineTo(rx+2.2,ry);ctx.lineTo(rx,ry+2.6);ctx.lineTo(rx-2.2,ry);
      ctx.closePath();ctx.stroke();
    }
  }
  if(e.dot>0){
    ctx.fillStyle=hexA('#84cc16',0.5);
    for(let i=0;i<3;i++){
      const a=now*2.4+i*2.1;
      ctx.beginPath();
      ctx.arc(Math.sin(a)*s*0.5,-s*0.5-((now*22+i*13)%26),1.5+Math.sin(a)*0.6,0,Math.PI*2);
      ctx.fill();
    }
  }
  // White flash on impact
  if(e.flash>0.02){
    ctx.globalAlpha=e.flash*0.65;
    ctx.fillStyle='#ffffff';
    ctx.beginPath();
    ctx.moveTo(0,-s*0.98);
    ctx.quadraticCurveTo(s*0.88,-s*0.42,flare,s*0.62);
    ctx.quadraticCurveTo(0,s*0.34,-flare,s*0.62);
    ctx.quadraticCurveTo(-s*0.88,-s*0.42,0,-s*0.98);
    ctx.closePath();ctx.fill();
    ctx.globalAlpha=1;
  }

  ctx.restore();

  // Resist badge floats above the health-bar slot: profile icon + class pips.
  // One drawImage of a pre-rendered sprite; sits at a fixed offset so it does
  // not jump when the health bar appears below it.
  if(badge){
    const bw=badge.c.width/BADGE_SCALE,bh=badge.c.height/BADGE_SCALE;
    ctx.drawImage(badge.c,e.x-bw/2,e.y-s-14-bh,bw,bh);
  }

  // Health bar (only once wounded — keeps the board clean)
  if(e.hp<e.maxHp){
    const ratio=Math.max(0,e.hp/e.maxHp);
    const bw=s*2.1,bh=e.kind==='boss'?5:3.5;
    const bx=e.x-bw/2,by=e.y-s-11;
    ctx.fillStyle='rgba(0,0,0,0.65)';
    ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(bx-1,by-1,bw+2,bh+2,2.5);else ctx.rect(bx-1,by-1,bw+2,bh+2);
    ctx.fill();
    const hg=ctx.createLinearGradient(bx,0,bx+bw,0);
    const hcol=ratio>0.55?'#22c55e':ratio>0.28?'#fbbf24':'#ef4444';
    hg.addColorStop(0,shade(hcol,-0.2));
    hg.addColorStop(1,shade(hcol,0.3));
    ctx.fillStyle=hg;
    ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(bx,by,bw*ratio,bh,1.8);else ctx.rect(bx,by,bw*ratio,bh);
    ctx.fill();
    if(e.kind==='boss'){
      ctx.strokeStyle=hexA('#fbbf24',0.75);ctx.lineWidth=1;
      ctx.beginPath();
      if(ctx.roundRect)ctx.roundRect(bx-1,by-1,bw+2,bh+2,2.5);else ctx.rect(bx-1,by-1,bw+2,bh+2);
      ctx.stroke();
    }
  }
}

// ---------------- Projectile art ----------------
function drawProjectile(p){
  const ang=Math.atan2(p.vy,p.vx);
  // Tapered trail shared by every projectile type
  if(p.trail.length>1){
    for(let i=1;i<p.trail.length;i++){
      const a=(i/p.trail.length);
      ctx.strokeStyle=hexA(p.color,a*0.42);
      ctx.lineWidth=p.r*a*1.5;
      ctx.lineCap='round';
      ctx.beginPath();
      ctx.moveTo(p.trail[i-1].x,p.trail[i-1].y);
      ctx.lineTo(p.trail[i].x,p.trail[i].y);
      ctx.stroke();
    }
  }
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.rotate(ang);
  switch(p.proj){
    case 'arrow':
      ctx.fillStyle='#d9f99d';
      ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(-1,2.4);ctx.lineTo(-1,-2.4);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#65a30d';ctx.lineWidth=1.8;
      ctx.beginPath();ctx.moveTo(-1,0);ctx.lineTo(-10,0);ctx.stroke();
      ctx.strokeStyle='#a3e635';ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(-10,0);ctx.lineTo(-13,2.6);ctx.moveTo(-10,0);ctx.lineTo(-13,-2.6);ctx.stroke();
      break;
    case 'fire':{
      drawGlow('#f97316',0,0,15,0.85);
      const flick=1+Math.sin(p.spin*3)*0.16;
      ctx.fillStyle='#f97316';
      ctx.beginPath();ctx.ellipse(0,0,6.5*flick,4.6,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fde047';
      ctx.beginPath();ctx.ellipse(1.4,0,3.4*flick,2.4,0,0,Math.PI*2);ctx.fill();
      break;
    }
    case 'ice':
      ctx.rotate(p.spin);
      drawGlow('#38bdf8',0,0,13,0.6);
      ctx.fillStyle='#e0f2fe';
      ctx.beginPath();ctx.moveTo(0,-6.5);ctx.lineTo(3.4,0);ctx.lineTo(0,6.5);ctx.lineTo(-3.4,0);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#38bdf8';ctx.lineWidth=1;ctx.stroke();
      break;
    case 'lightning':{
      drawGlow('#fde047',0,0,15,0.75);
      ctx.strokeStyle='#fef9c3';ctx.lineWidth=2.2;ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(-9,0);
      for(let i=-6;i<=9;i+=3.5)ctx.lineTo(i,(Math.random()-0.5)*5);
      ctx.stroke();
      break;
    }
    case 'poison':
      drawGlow('#84cc16',0,0,12,0.6);
      ctx.fillStyle='#4d7c0f';
      ctx.beginPath();ctx.arc(0,0,5.2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#a3e635';
      ctx.beginPath();ctx.arc(-1.4,-1.4,2.4,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(2,1.6,1.4,0,Math.PI*2);ctx.fill();
      break;
    case 'cannon':
      ctx.fillStyle='#111827';
      ctx.beginPath();ctx.arc(0,0,6.2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba(209,213,219,0.6)';
      ctx.beginPath();ctx.arc(-2,-2.2,2.1,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(156,163,175,0.35)';ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(0,0,6.2,0,Math.PI*2);ctx.stroke();
      break;
    case 'magic':
      drawGlow('#a855f7',0,0,16,0.8);
      ctx.fillStyle='#e9d5ff';
      ctx.beginPath();ctx.arc(0,0,4.4,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=hexA('#c084fc',0.85);ctx.lineWidth=1.3;
      ctx.save();ctx.rotate(p.spin);
      ctx.beginPath();ctx.ellipse(0,0,8.5,3.2,0,0,Math.PI*2);ctx.stroke();
      ctx.restore();
      break;
    case 'dark':
      drawGlow('#7c3aed',0,0,16,0.55);
      ctx.fillStyle='#0b0714';
      ctx.beginPath();ctx.arc(0,0,6,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=hexA('#a78bfa',0.9);ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(0,0,6,p.spin,p.spin+Math.PI*1.4);ctx.stroke();
      break;
    case 'holy':
      drawGlow('#fde047',0,0,18,0.85);
      ctx.rotate(p.spin*0.5);
      ctx.fillStyle='#fffbeb';
      ctx.beginPath();
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4,r=i%2===0?8:3;
        i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
      }
      ctx.closePath();ctx.fill();
      break;
    case 'dragon':{
      drawGlow('#f97316',0,0,20,0.9);
      const fl=1+Math.sin(p.spin*4)*0.2;
      ctx.fillStyle='#7c2d12';
      ctx.beginPath();ctx.ellipse(0,0,8.5*fl,5.5,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#f97316';
      ctx.beginPath();ctx.ellipse(1,0,6*fl,3.8,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fef08a';
      ctx.beginPath();ctx.ellipse(2.6,0,3*fl,2,0,0,Math.PI*2);ctx.fill();
      break;
    }
    default:
      drawGlow(p.color,0,0,12,0.7);
      ctx.fillStyle=p.color;
      ctx.beginPath();ctx.arc(0,0,p.r,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

function drawRingParticle(p){
  ctx.globalAlpha=Math.max(0,p.life)*0.7;
  ctx.strokeStyle=p.col;
  ctx.lineWidth=p.w*p.life;
  ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.stroke();
  ctx.globalAlpha=Math.max(0,p.life)*0.14;
  ctx.fillStyle=p.col;
  ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=1;
}

function drawBolt(p){
  ctx.globalAlpha=Math.max(0,p.life);
  ctx.strokeStyle=p.col;
  ctx.lineWidth=2.2;
  ctx.lineJoin='round';
  const segs=6;
  ctx.beginPath();
  ctx.moveTo(p.x,p.y);
  for(let i=1;i<segs;i++){
    const t=i/segs;
    const jx=Math.sin(p.seed+i*2.7)*7*(1-Math.abs(t-0.5)*2);
    const jy=Math.cos(p.seed+i*1.9)*7*(1-Math.abs(t-0.5)*2);
    ctx.lineTo(p.x+(p.x2-p.x)*t+jx,p.y+(p.y2-p.y)*t+jy);
  }
  ctx.lineTo(p.x2,p.y2);
  ctx.stroke();
  ctx.globalAlpha=Math.max(0,p.life)*0.35;
  ctx.lineWidth=5;
  ctx.stroke();
  ctx.globalAlpha=1;
}

function drawFloaters(){
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='800 11px Nunito, sans-serif';
  floaters.forEach(f=>{
    ctx.globalAlpha=Math.max(0,Math.min(1,f.life*1.4));
    ctx.fillStyle='rgba(0,0,0,0.65)';
    ctx.fillText(f.text,f.x+1,f.y+1);
    ctx.fillStyle=f.col;
    ctx.fillText(f.text,f.x,f.y);
  });
  ctx.globalAlpha=1;
}
