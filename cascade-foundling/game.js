/* ============================================================
   CASCADE FOUNDLING — a first-person farm defense
   Babylon.js + Havok physics · WASD/mouse + Xbox gamepad
   Mason County, Washington. The visitors just want their baby.
   ============================================================ */
'use strict';

/* ---------------- Config & persistence ---------------- */
const SAVE_KEY = 'cascade-foundling-save';
const store = (() => {
  let d = { best: 0, bestWave: 0, wins: 0, quality: 'high', muted: false };
  try { Object.assign(d, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) {}
  return {
    get: () => d,
    save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) {} }
  };
})();

const CFG = {
  waves: 8,
  playerHp: 100,
  ammoClip: 8,
  ammoReserve: 24,
  reloadTime: 1.6,
  pellets: 5,
  spreadDeg: 4.5,
  shotRange: 60,
  runSpeed: 10.5,
  walkSpeed: 5.8,
  truckTopSpeed: 16,
  truckReverse: -6,
  alienBaseSpeed: 2.3,
  alienCarrySpeed: 1.7,
  swipeRange: 2.4,
  swipeDmg: 6,
  repelScore: 100,
};

/* ---------------- Procedural audio ---------------- */
const AudioFX = (() => {
  let ctx = null, master = null, engineNodes = null, cricketNodes = null;
  let muted = store.get().muted;
  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  function noiseBuf(len) {
    const b = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
    const ch = b.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    return b;
  }
  return {
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.55; },
    unlock() { ensure(); },
    shotgun() {
      ensure(); const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf(0.4);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.32);
      const g = ctx.createGain(); env(g, t, 0.004, 0.9, 0.34);
      src.connect(lp).connect(g).connect(master); src.start(t); src.stop(t + 0.42);
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const g2 = ctx.createGain(); env(g2, t, 0.002, 0.5, 0.13);
      o.connect(g2).connect(master); o.start(t); o.stop(t + 0.16);
    },
    reload() {
      ensure(); const t = ctx.currentTime;
      [0, 0.32, 0.9].forEach((dt, i) => {
        const o = ctx.createOscillator(); o.type = 'square';
        o.frequency.value = i === 2 ? 1600 : 900 + i * 250;
        const g = ctx.createGain(); env(g, t + dt, 0.002, 0.18, 0.05);
        o.connect(g).connect(master); o.start(t + dt); o.stop(t + dt + 0.07);
      });
    },
    dryFire() {
      ensure(); const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1300;
      const g = ctx.createGain(); env(g, t, 0.001, 0.12, 0.04);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.05);
    },
    repel() {
      ensure(); const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.28);
      const o2 = ctx.createOscillator(); o2.type = 'triangle';
      o2.frequency.setValueAtTime(2300, t); o2.frequency.exponentialRampToValueAtTime(330, t + 0.22);
      const g = ctx.createGain(); env(g, t, 0.005, 0.4, 0.3);
      o.connect(g); o2.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.32); o2.start(t); o2.stop(t + 0.26);
    },
    chitter() {
      ensure(); const t = ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.value = 900 + Math.random() * 900;
        const g = ctx.createGain(); env(g, t + i * 0.055, 0.004, 0.07, 0.045);
        o.connect(g).connect(master); o.start(t + i * 0.055); o.stop(t + i * 0.055 + 0.06);
      }
    },
    coo() {
      ensure(); const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(760, t + 0.18);
      o.frequency.linearRampToValueAtTime(600, t + 0.4);
      const g = ctx.createGain(); env(g, t, 0.05, 0.16, 0.42);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.5);
    },
    hurt() {
      ensure(); const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
      const g = ctx.createGain(); env(g, t, 0.004, 0.35, 0.22);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.25);
    },
    waveHorn() {
      ensure(); const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(180, t); o.frequency.linearRampToValueAtTime(240, t + 0.5);
      const g = ctx.createGain(); env(g, t, 0.1, 0.25, 0.9);
      o.connect(g).connect(master); o.start(t); o.stop(t + 1.1);
    },
    radioBlip() {
      ensure(); const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf(0.15);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 4;
      const g = ctx.createGain(); env(g, t, 0.01, 0.1, 0.14);
      src.connect(bp).connect(g).connect(master); src.start(t); src.stop(t + 0.16);
    },
    stinger(win) {
      ensure(); const t = ctx.currentTime;
      const notes = win ? [392, 494, 587, 784] : [330, 262, 208, 165];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const g = ctx.createGain(); env(g, t + i * 0.22, 0.02, 0.22, win ? 0.9 : 0.7);
        o.connect(g).connect(master); o.start(t + i * 0.22); o.stop(t + i * 0.22 + 1.0);
      });
    },
    engineStart() {
      ensure();
      if (engineNodes) return;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 42;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 21;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o.connect(lp); o2.connect(lp); lp.connect(g).connect(master);
      o.start(); o2.start();
      g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.4);
      engineNodes = { o, o2, g, lp };
    },
    engineUpdate(speedFrac) {
      if (!engineNodes) return;
      const f = 42 + speedFrac * 75;
      engineNodes.o.frequency.setTargetAtTime(f, ctx.currentTime, 0.1);
      engineNodes.o2.frequency.setTargetAtTime(f / 2, ctx.currentTime, 0.1);
      engineNodes.lp.frequency.setTargetAtTime(260 + speedFrac * 700, ctx.currentTime, 0.1);
    },
    engineStop() {
      if (!engineNodes) return;
      const { o, o2, g } = engineNodes;
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      setTimeout(() => { try { o.stop(); o2.stop(); } catch (e) {} }, 450);
      engineNodes = null;
    },
    cricketsStart() {
      ensure();
      if (cricketNodes) return;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4300;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.012;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      lfo.connect(lfoG).connect(g.gain);
      o.connect(g).connect(master);
      o.start(); lfo.start();
      g.gain.setTargetAtTime(0.012, ctx.currentTime, 1.5);
      cricketNodes = { o, lfo, g };
    },
    cricketsStop() {
      if (!cricketNodes) return;
      const { o, lfo, g } = cricketNodes;
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
      setTimeout(() => { try { o.stop(); lfo.stop(); } catch (e) {} }, 1500);
      cricketNodes = null;
    },
  };
})();

/* ---------------- DOM refs ---------------- */
const $ = id => document.getElementById(id);
const dom = {
  intro: $('introScreen'), loading: $('loadingScreen'), loadFill: $('loadingFill'),
  loadMsg: $('loadingMsg'), hud: $('hud'), end: $('endScreen'),
  wave: $('hudWave'), waveState: $('hudWaveState'), score: $('hudScore'),
  baby: $('hudBaby'), hp: $('hudHp'), hpFill: $('hpFill'),
  ammo: $('hudAmmo'), reload: $('hudReload'), prompt: $('hudPrompt'),
  radio: $('radioTicker'), vignette: $('damageVignette'), hitmarker: $('hitmarker'),
  endTitle: $('endTitle'), endText: $('endText'), endStats: $('endStats'),
  bestLine: $('bestLine'), qualityBtn: $('qualityBtn'), muteBtn: $('muteBtn'),
};

/* ---------------- Game state ---------------- */
const G = {
  running: false, over: false,
  hp: CFG.playerHp, score: 0, wave: 0, repels: 0,
  ammo: CFG.ammoClip, reserve: CFG.ammoReserve, reloading: false, reloadT: 0,
  inTruck: false, aliens: [], waveState: 'calm', waveTimer: 0, spawnQueue: 0, spawnTimer: 0,
  babyState: 'safe', // safe | carried | returning | dropped
  quality: store.get().quality,
  lastSwipe: 0, chitterT: 0, cooT: 8,
};

const RADIO_LINES = [
  '📻 "...Mason County dispatch, we\'ve got a dozen more calls about the lights..."',
  '📻 "...caller says something walked out of the tree line near Tahuya... hold on..."',
  '📻 "...do NOT approach the ridge, units are staging at Belfair..."',
  '📻 "...whatever they are, they keep circling that farm off the old logging road..."',
  '📻 "...National Guard says four hours out. Four HOURS?..."',
  '📻 "...they\'re not attacking the town. They\'re all headed one direction..."',
  '📻 "...sky\'s starting to gray out east. Longest night of my life..."',
];

/* ============================================================
   ENGINE BOOT
   ============================================================ */
let engine, scene, camera, havok;
let world = {}; // meshes & nodes we need later

async function boot() {
  const canvas = $('renderCanvas');
  engine = new BABYLON.Engine(canvas, true, { stencil: true, adaptToDeviceRatio: false });
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.008, 0.012, 0.03, 1);

  setLoad(10, 'Spinning up physics...');
  havok = await HavokPhysics();
  const plugin = new BABYLON.HavokPlugin(true, havok);
  scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), plugin);
  scene.collisionsEnabled = true;
  scene.gravity = new BABYLON.Vector3(0, -0.55, 0);

  setLoad(25, 'Raising the farmhouse...');
  buildLighting();
  buildTerrain();
  buildFarm();
  setLoad(45, 'Planting the tree line...');
  buildTrees();
  buildSky();
  setLoad(60, 'Rolling out the deuce and a half...');
  buildTruck();
  setLoad(75, 'Tuning the shotgun...');
  buildPlayer(canvas);
  buildBaby();
  buildMothership();
  setLoad(90, 'Listening to the dark...');
  applyQuality();
  wireInput(canvas);

  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    if (G.running && !G.over) update(dt);
    else if (G.running && G.over) { updateShip(dt); updateBaby(dt); } // keep the departure cinematic alive
    scene.render();
  });
  window.addEventListener('resize', () => engine.resize());
  setLoad(100, 'Ready.');
}

function setLoad(pct, msg) {
  dom.loadFill.style.width = pct + '%';
  dom.loadMsg.textContent = msg;
}

/* ============================================================
   WORLD BUILDING
   ============================================================ */
function mat(name, r, g, b, opts = {}) {
  const m = new BABYLON.PBRMaterial(name, scene);
  m.albedoColor = new BABYLON.Color3(r, g, b);
  m.metallic = opts.metallic ?? 0;
  m.roughness = opts.roughness ?? 0.9;
  if (opts.emissive) m.emissiveColor = opts.emissive;
  return m;
}

function buildLighting() {
  // cold ambient
  const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.22;
  hemi.diffuse = new BABYLON.Color3(0.45, 0.55, 0.8);
  hemi.groundColor = new BABYLON.Color3(0.05, 0.06, 0.1);
  // moonlight
  const moon = new BABYLON.DirectionalLight('moon', new BABYLON.Vector3(-0.45, -0.8, 0.35), scene);
  moon.intensity = 0.8;
  moon.diffuse = new BABYLON.Color3(0.55, 0.65, 0.95);
  moon.position = new BABYLON.Vector3(40, 60, -30);
  // porch light — warm anchor
  const porch = new BABYLON.PointLight('porch', new BABYLON.Vector3(-14, 3.4, -8.2), scene);
  porch.diffuse = new BABYLON.Color3(1.0, 0.75, 0.4);
  porch.intensity = 12; porch.range = 22;
  world.hemi = hemi; world.moon = moon; world.porch = porch;
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.008;
  scene.fogColor = new BABYLON.Color3(0.02, 0.03, 0.06);
}

function staticBox(node, w, h, d, cx = 0, cy = 0, cz = 0) {
  // LESSON (V1): never PhysicsAggregate a TransformNode — build the shape by hand.
  const body = new BABYLON.PhysicsBody(node, BABYLON.PhysicsMotionType.STATIC, false, scene);
  body.shape = new BABYLON.PhysicsShapeBox(
    new BABYLON.Vector3(cx, cy, cz), BABYLON.Quaternion.Identity(),
    new BABYLON.Vector3(w, h, d), scene);
  return body;
}

function buildTerrain() {
  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 220, height: 220, subdivisions: 24 }, scene);
  const gm = mat('groundMat', 0.09, 0.12, 0.07, { roughness: 1 });
  ground.material = gm;
  ground.receiveShadows = true;
  ground.checkCollisions = true;
  staticBox(ground, 220, 1, 220, 0, -0.5, 0);
  // dirt driveway
  const drive = BABYLON.MeshBuilder.CreateGround('drive', { width: 6, height: 60 }, scene);
  drive.position = new BABYLON.Vector3(2, 0.02, -20);
  drive.material = mat('driveMat', 0.16, 0.13, 0.1, { roughness: 1 });
  world.ground = ground;
}

function buildFarm() {
  const casters = [];
  // ---- farmhouse (west side) ----
  const houseRoot = new BABYLON.TransformNode('house', scene);
  const hBody = BABYLON.MeshBuilder.CreateBox('houseBody', { width: 10, height: 5, depth: 8 }, scene);
  hBody.position.y = 2.5; hBody.parent = houseRoot;
  hBody.material = mat('houseMat', 0.42, 0.4, 0.36);
  const roof = BABYLON.MeshBuilder.CreateCylinder('houseRoof', { diameter: 11.5, height: 8.4, tessellation: 3 }, scene);
  roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2;
  roof.position.y = 6.4; roof.scaling.y = 0.62; roof.parent = houseRoot;
  roof.material = mat('roofMat', 0.2, 0.12, 0.1);
  // lit window
  const win = BABYLON.MeshBuilder.CreatePlane('window', { width: 1.4, height: 1.7 }, scene);
  win.position.set(5.01, 2.6, -1.5); win.rotation.y = -Math.PI / 2; win.parent = houseRoot;
  win.material = mat('winMat', 1, 0.8, 0.4, { emissive: new BABYLON.Color3(1, 0.72, 0.3) });
  houseRoot.position.set(-16, 0, -8);
  hBody.checkCollisions = true;
  staticBox(houseRoot, 10, 5, 8, 0, 2.5, 0);
  casters.push(hBody, roof);

  // ---- barn (east side) ----
  const barnRoot = new BABYLON.TransformNode('barn', scene);
  const bBody = BABYLON.MeshBuilder.CreateBox('barnBody', { width: 12, height: 6.5, depth: 9 }, scene);
  bBody.position.y = 3.25; bBody.parent = barnRoot;
  bBody.material = mat('barnMat', 0.4, 0.1, 0.08);
  const bRoof = BABYLON.MeshBuilder.CreateCylinder('barnRoof', { diameter: 13.5, height: 9.4, tessellation: 3 }, scene);
  bRoof.rotation.z = Math.PI / 2; bRoof.rotation.y = Math.PI / 2;
  bRoof.position.y = 8.1; bRoof.scaling.y = 0.7; bRoof.parent = barnRoot;
  bRoof.material = mat('barnRoofMat', 0.16, 0.15, 0.14);
  const doorTrim = BABYLON.MeshBuilder.CreatePlane('barnDoor', { width: 3.4, height: 4.2 }, scene);
  doorTrim.position.set(0, 2.1, 4.51); doorTrim.parent = barnRoot;
  doorTrim.material = mat('barnDoorMat', 0.5, 0.42, 0.3);
  barnRoot.position.set(18, 0, -4);
  bBody.checkCollisions = true;
  staticBox(barnRoot, 12, 6.5, 9, 0, 3.25, 0);
  casters.push(bBody, bRoof);

  // ---- silo ----
  const silo = BABYLON.MeshBuilder.CreateCylinder('silo', { diameter: 4.4, height: 12 }, scene);
  silo.position.set(26, 6, 2);
  silo.material = mat('siloMat', 0.55, 0.56, 0.6, { metallic: 0.6, roughness: 0.5 });
  const siloCap = BABYLON.MeshBuilder.CreateSphere('siloCap', { diameter: 4.4, slice: 0.5 }, scene);
  siloCap.position.set(26, 12, 2);
  siloCap.material = silo.material;
  silo.checkCollisions = true;
  staticBox(silo, 4.4, 12, 4.4, 0, 0, 0);
  casters.push(silo, siloCap);

  // ---- fences around the yard ----
  const fenceMat = mat('fenceMat', 0.3, 0.24, 0.17);
  const mkFence = (x, z, len, rotY) => {
    const rail = BABYLON.MeshBuilder.CreateBox('fence', { width: len, height: 0.14, depth: 0.14 }, scene);
    rail.position.set(x, 1.0, z); rail.rotation.y = rotY; rail.material = fenceMat;
    const rail2 = rail.clone('fence2'); rail2.position.y = 0.55;
    for (let i = -len / 2 + 1; i < len / 2; i += 2.4) {
      const post = BABYLON.MeshBuilder.CreateBox('post', { width: 0.16, height: 1.3, depth: 0.16 }, scene);
      const off = new BABYLON.Vector3(i, 0, 0);
      const rot = BABYLON.Matrix.RotationY(rotY);
      const p = BABYLON.Vector3.TransformCoordinates(off, rot);
      post.position.set(x + p.x, 0.65, z + p.z);
      post.material = fenceMat;
    }
  };
  mkFence(0, 14, 40, 0);
  mkFence(-21, 4, 22, Math.PI / 2);
  mkFence(30, 8, 14, Math.PI / 2);

  // hay bales
  const hayMat = mat('hayMat', 0.55, 0.45, 0.2);
  [[8, 10], [10, 11], [9, 10.8]].forEach(([x, z], i) => {
    const hay = BABYLON.MeshBuilder.CreateCylinder('hay' + i, { diameter: 1.6, height: 1.4 }, scene);
    hay.rotation.z = Math.PI / 2;
    hay.position.set(x, 0.8 + (i === 2 ? 1.5 : 0), z);
    hay.material = hayMat; hay.checkCollisions = true;
    casters.push(hay);
  });
  world.casters = casters;
}

function buildTrees() {
  // Ring of firs around the perimeter — the visitors emerge from these.
  const trunkMat = mat('trunkMat', 0.2, 0.13, 0.08);
  const leafMat = mat('leafMat', 0.03, 0.1, 0.05);
  const protoTrunk = BABYLON.MeshBuilder.CreateCylinder('protoTrunk', { diameterTop: 0.4, diameterBottom: 0.7, height: 5 }, scene);
  protoTrunk.material = trunkMat; protoTrunk.setEnabled(false);
  const protoLeaf = BABYLON.MeshBuilder.CreateCylinder('protoLeaf', { diameterTop: 0.05, diameterBottom: 4.4, height: 9 }, scene);
  protoLeaf.material = leafMat; protoLeaf.setEnabled(false);
  const count = G.quality === 'high' ? 80 : 42;
  world.treeMeshes = [];
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + (Math.sin(i * 7.7) * 0.06);
    const rad = 58 + (Math.sin(i * 3.1) * 0.5 + 0.5) * 22;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const s = 0.8 + (Math.sin(i * 13.7) * 0.5 + 0.5) * 0.7;
    const t = protoTrunk.createInstance('t' + i);
    t.position.set(x, 2.5 * s, z); t.scaling.setAll(s);
    const l = protoLeaf.createInstance('l' + i);
    l.position.set(x, (5 + 4.5) * s, z); l.scaling.setAll(s);
    if (i % 4 === 0) world.treeMeshes.push(t, l);
  }
  world.protoTrunk = protoTrunk; world.protoLeaf = protoLeaf;
}

function buildSky() {
  // Star dome via point cloud
  const pcs = new BABYLON.PointsCloudSystem('stars', 2, scene);
  pcs.addPoints(G.quality === 'high' ? 450 : 220, (p) => {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.42;
    const r = 190;
    p.position = new BABYLON.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi) + 5,
      r * Math.sin(phi) * Math.sin(theta));
    const b = 0.4 + Math.random() * 0.6;
    p.color = new BABYLON.Color4(b * 0.85, b * 0.9, b, 1);
  });
  pcs.buildMeshAsync().then(m => {
    m.material.pointSize = 2;
    m.applyFog = false;
    world.starMesh = m;
  });
  // Moon
  const moonDisc = BABYLON.MeshBuilder.CreateDisc('moonDisc', { radius: 7 }, scene);
  moonDisc.position.set(80, 95, -60);
  moonDisc.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  const mm = new BABYLON.StandardMaterial('moonMat', scene);
  mm.emissiveColor = new BABYLON.Color3(0.9, 0.93, 1);
  mm.disableLighting = true;
  moonDisc.material = mm; moonDisc.applyFog = false;
  world.moonDisc = moonDisc;
}

/* ---------------- The deuce and a half ---------------- */
function buildTruck() {
  const root = new BABYLON.TransformNode('truckRoot', scene);
  const olive = mat('olive', 0.18, 0.21, 0.12, { roughness: 0.8 });
  const oliveDark = mat('oliveDark', 0.12, 0.14, 0.08);
  const canvas = mat('canvasMat', 0.25, 0.24, 0.18);
  const rubber = mat('rubber', 0.05, 0.05, 0.05);

  // chassis + boxy cab + long bed w/ canvas top — M35 silhouette
  const chassis = BABYLON.MeshBuilder.CreateBox('chassis', { width: 2.4, height: 0.5, depth: 7.2 }, scene);
  chassis.position.y = 1.0; chassis.parent = root; chassis.material = oliveDark;
  const cab = BABYLON.MeshBuilder.CreateBox('cab', { width: 2.4, height: 1.5, depth: 1.7 }, scene);
  cab.position.set(0, 2.0, 2.0); cab.parent = root; cab.material = olive;
  const hood = BABYLON.MeshBuilder.CreateBox('hood', { width: 2.0, height: 0.9, depth: 1.6 }, scene);
  hood.position.set(0, 1.7, 3.6); hood.parent = root; hood.material = olive;
  const grill = BABYLON.MeshBuilder.CreateBox('grill', { width: 1.9, height: 0.8, depth: 0.1 }, scene);
  grill.position.set(0, 1.65, 4.45); grill.parent = root; grill.material = oliveDark;
  const bedFloor = BABYLON.MeshBuilder.CreateBox('bedFloor', { width: 2.4, height: 0.3, depth: 4.4 }, scene);
  bedFloor.position.set(0, 1.4, -1.6); bedFloor.parent = root; bedFloor.material = oliveDark;
  const canvasTop = BABYLON.MeshBuilder.CreateCylinder('canvasTop', { diameter: 2.5, height: 4.4, tessellation: 12, arc: 0.5 }, scene);
  canvasTop.rotation.z = Math.PI / 2; canvasTop.rotation.y = Math.PI / 2;
  canvasTop.position.set(0, 2.35, -1.6); canvasTop.parent = root; canvasTop.material = canvas;
  // windows
  const windshield = BABYLON.MeshBuilder.CreatePlane('windshield', { width: 1.9, height: 0.8 }, scene);
  windshield.position.set(0, 2.35, 2.86); windshield.rotation.x = -0.15; windshield.parent = root;
  windshield.material = mat('glassMat', 0.1, 0.15, 0.2, { metallic: 0.9, roughness: 0.15 });
  // headlights (emissive, off at night start... actually ON, it's a defense)
  const hlMat = mat('hlMat', 1, 0.95, 0.7, { emissive: new BABYLON.Color3(1, 0.9, 0.55) });
  [[-0.75], [0.75]].forEach(([x], i) => {
    const hl = BABYLON.MeshBuilder.CreateDisc('hl' + i, { radius: 0.16 }, scene);
    hl.position.set(x, 1.65, 4.51); hl.parent = root; hl.material = hlMat;
  });
  const headLight = new BABYLON.SpotLight('headLight', new BABYLON.Vector3(0, 1.7, 4.6),
    new BABYLON.Vector3(0, -0.12, 1), Math.PI / 2.6, 8, scene);
  headLight.diffuse = new BABYLON.Color3(1, 0.9, 0.6);
  headLight.intensity = 40; headLight.range = 40; headLight.parent = root;
  // six wheels — dual rear axle
  const wheels = [];
  const wheelPos = [
    [-1.15, 0.6, 3.0], [1.15, 0.6, 3.0],
    [-1.15, 0.6, -0.6], [1.15, 0.6, -0.6],
    [-1.15, 0.6, -2.4], [1.15, 0.6, -2.4],
  ];
  wheelPos.forEach((p, i) => {
    const w = BABYLON.MeshBuilder.CreateCylinder('wheel' + i, { diameter: 1.2, height: 0.5, tessellation: 14 }, scene);
    w.rotation.z = Math.PI / 2;
    w.position.set(p[0], p[1], p[2]); w.parent = root; w.material = rubber;
    wheels.push(w);
  });
  root.position.set(6, 0.05, -14);
  root.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, -0.4, 0);

  // Physics — dynamic box body.
  // LESSON (V1): zero inertia on ANY axis makes Havok freeze angular velocity → dead steering.
  const body = new BABYLON.PhysicsBody(root, BABYLON.PhysicsMotionType.DYNAMIC, false, scene);
  body.shape = new BABYLON.PhysicsShapeBox(
    new BABYLON.Vector3(0, 1.3, 0), BABYLON.Quaternion.Identity(),
    new BABYLON.Vector3(2.5, 2.6, 7.4), scene); // bottom flush with wheel contact
  body.setMassProperties({
    mass: 3200,
    inertia: new BABYLON.Vector3(9000, 9000, 9000),
    centerOfMass: new BABYLON.Vector3(0, 0.7, 0),
  });
  body.setLinearDamping(0.6);
  body.setAngularDamping(2.5);
  // collision blockers for on-foot player
  const truckCollider = BABYLON.MeshBuilder.CreateBox('truckCol', { width: 2.7, height: 2.8, depth: 7.6 }, scene);
  truckCollider.position.y = 1.6; truckCollider.parent = root;
  truckCollider.isVisible = false; truckCollider.checkCollisions = true;

  world.truck = { root, body, wheels, headLight, speed: 0 };
  world.casters.push(cab, hood, canvasTop, bedFloor);
}

/* ---------------- Player ---------------- */
function buildPlayer(canvas) {
  camera = new BABYLON.UniversalCamera('cam', new BABYLON.Vector3(0, 1.8, -24), scene);
  camera.minZ = 0.15; camera.maxZ = 400;
  camera.fov = 1.05;
  camera.attachControl(canvas, true);
  // strip built-in keyboard control — we drive movement ourselves (run/gamepad support)
  camera.inputs.removeByType('FreeCameraKeyboardMoveInput');
  camera.angularSensibility = 1400;
  // Flat farm — no built-in gravity (its per-frame ellipsoid resolution drifts);
  // we hard-lock eye height each frame instead and keep collisions for walls.
  camera.applyGravity = false;
  camera.checkCollisions = true;
  camera.ellipsoid = new BABYLON.Vector3(0.55, 0.85, 0.55);
  camera.setTarget(new BABYLON.Vector3(0, 1.8, 0));
  // shotgun viewmodel
  const gunRoot = new BABYLON.TransformNode('gunRoot', scene);
  gunRoot.parent = camera;
  gunRoot.position.set(0.32, -0.28, 0.9);
  const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { diameter: 0.055, height: 0.85 }, scene);
  barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.3;
  barrel.parent = gunRoot;
  barrel.material = mat('gunMetal', 0.12, 0.12, 0.14, { metallic: 0.85, roughness: 0.35 });
  const barrel2 = barrel.clone('barrel2'); barrel2.position.x = -0.06;
  const stock = BABYLON.MeshBuilder.CreateBox('stock', { width: 0.09, height: 0.14, depth: 0.5 }, scene);
  stock.position.set(-0.03, -0.05, -0.25); stock.rotation.x = -0.12; stock.parent = gunRoot;
  stock.material = mat('stockMat', 0.3, 0.18, 0.09);
  [barrel, barrel2, stock].forEach(m => { m.renderingGroupId = 1; });
  world.gunRoot = gunRoot;
  world.muzzleNode = new BABYLON.TransformNode('muzzle', scene);
  world.muzzleNode.parent = gunRoot;
  world.muzzleNode.position.set(-0.03, 0, 0.75);
}

/* ---------------- The foundling ---------------- */
function buildBaby() {
  const root = new BABYLON.TransformNode('babyRoot', scene);
  const skin = mat('babySkin', 0.55, 0.75, 0.8, { roughness: 0.4 });
  skin.emissiveColor = new BABYLON.Color3(0.05, 0.14, 0.16);
  const bodyM = BABYLON.MeshBuilder.CreateCapsule('babyBody', { radius: 0.22, height: 0.7 }, scene);
  bodyM.position.y = 0.42; bodyM.parent = root; bodyM.material = skin;
  const head = BABYLON.MeshBuilder.CreateSphere('babyHead', { diameterX: 0.5, diameterY: 0.55, diameterZ: 0.45 }, scene);
  head.position.y = 0.95; head.parent = root; head.material = skin;
  const eyeMat = mat('babyEye', 0.1, 1, 1, { emissive: new BABYLON.Color3(0.35, 1, 1) });
  [[-0.11], [0.11]].forEach(([x], i) => {
    const eye = BABYLON.MeshBuilder.CreateSphere('babyEye' + i, { diameter: 0.14 }, scene);
    eye.position.set(x, 0.98, 0.18); eye.parent = root; eye.material = eyeMat;
  });
  const glow = new BABYLON.PointLight('babyGlow', new BABYLON.Vector3(0, 1, 0), scene);
  glow.diffuse = new BABYLON.Color3(0.3, 0.9, 1);
  glow.intensity = 2.5; glow.range = 6; glow.parent = root;
  // safe spot: porch of the farmhouse — a hay nest
  const nest = BABYLON.MeshBuilder.CreateTorus('nest', { diameter: 1.5, thickness: 0.35 }, scene);
  nest.position.set(-9.5, 0.18, -3);
  nest.material = mat('nestMat', 0.5, 0.4, 0.18);
  root.position.set(-9.5, 0.05, -3);
  world.baby = { root, home: new BABYLON.Vector3(-9.5, 0.05, -3), bob: 0 };
}

/* ---------------- Mothership ---------------- */
function buildMothership() {
  const root = new BABYLON.TransformNode('shipRoot', scene);
  const hullMat = mat('hullMat', 0.1, 0.12, 0.16, { metallic: 0.9, roughness: 0.3 });
  const hull = BABYLON.MeshBuilder.CreateCylinder('hull', { diameterTop: 8, diameterBottom: 16, height: 3, tessellation: 24 }, scene);
  hull.parent = root; hull.material = hullMat;
  const dome = BABYLON.MeshBuilder.CreateSphere('dome', { diameter: 7, slice: 0.55 }, scene);
  dome.position.y = 1.6; dome.parent = root;
  const domeMat = mat('domeMat', 0.2, 0.5, 0.6, { metallic: 0.2, roughness: 0.1 });
  domeMat.alpha = 0.75; domeMat.emissiveColor = new BABYLON.Color3(0.1, 0.4, 0.5);
  dome.material = domeMat;
  // rim lights
  world.rimMats = [];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    const lightBall = BABYLON.MeshBuilder.CreateSphere('rim' + i, { diameter: 0.9 }, scene);
    lightBall.position.set(Math.cos(ang) * 7.4, -0.9, Math.sin(ang) * 7.4);
    lightBall.parent = root;
    const rm = new BABYLON.StandardMaterial('rimMat' + i, scene);
    rm.emissiveColor = new BABYLON.Color3(0.4, 1, 1);
    rm.disableLighting = true;
    lightBall.material = rm;
    world.rimMats.push(rm);
  }
  // beam
  const beam = BABYLON.MeshBuilder.CreateCylinder('beam', { diameterTop: 3, diameterBottom: 7, height: 42, tessellation: 20 }, scene);
  beam.position.y = -22.5; beam.parent = root;
  const beamMat = new BABYLON.StandardMaterial('beamMat', scene);
  beamMat.emissiveColor = new BABYLON.Color3(0.35, 0.9, 1);
  beamMat.alpha = 0.09; beamMat.disableLighting = true;
  beamMat.backFaceCulling = false;
  beam.material = beamMat;
  root.position.set(-30, 46, 52);
  world.ship = { root, beamMat, baseY: 46, t: 0, departing: false, departT: 0 };
}

/* ============================================================
   QUALITY / POST
   ============================================================ */
function applyQuality() {
  const high = G.quality === 'high';
  engine.setHardwareScalingLevel(high ? 1 : 1.4);
  if (world.shadowGen) { world.shadowGen.dispose(); world.shadowGen = null; }
  if (high) {
    const sg = new BABYLON.ShadowGenerator(1024, world.moon);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = BABYLON.ShadowGenerator.QUALITY_LOW;
    // LESSON (V1): only real Meshes go in the caster list — never TransformNodes.
    world.casters.forEach(m => { if (m instanceof BABYLON.Mesh) sg.addShadowCaster(m); });
    world.treeMeshes.forEach(m => sg.addShadowCaster(m));
    world.ground.receiveShadows = true;
    world.shadowGen = sg;
  }
  if (world.pipeline) { world.pipeline.dispose(); world.pipeline = null; }
  if (high) {
    const pp = new BABYLON.DefaultRenderingPipeline('pp', true, scene, [camera]);
    pp.bloomEnabled = true; pp.bloomThreshold = 0.7; pp.bloomWeight = 0.25; pp.bloomKernel = 32;
    pp.imageProcessing.vignetteEnabled = true;
    pp.imageProcessing.vignetteWeight = 1.6;
    pp.imageProcessing.contrast = 1.15;
    pp.imageProcessing.exposure = 1.05;
    world.pipeline = pp;
  }
}

/* ============================================================
   INPUT — keyboard, mouse, Xbox gamepad
   ============================================================ */
const input = { f: 0, b: 0, l: 0, r: 0, run: 0, fire: 0, brake: 0, interactEdge: false, reloadEdge: false };
let padIndex = -1;

function wireInput(canvas) {
  const keys = {};
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    keys[e.code] = 1;
    if (e.code === 'KeyE') input.interactEdge = true;
    if (e.code === 'KeyR') input.reloadEdge = true;
  });
  window.addEventListener('keyup', e => { keys[e.code] = 0; });
  scene.onPointerDown = (evt) => {
    if (!G.running || G.over) return;
    if (!document.pointerLockElement) {
      try { canvas.requestPointerLock(); } catch (e) { /* automation / iframe contexts */ }
      return;
    }
    if (evt.button === 0) input.fire = 1;
  };
  scene.onPointerUp = (evt) => { if (evt.button === 0) input.fire = 0; };
  window.addEventListener('gamepadconnected', e => { padIndex = e.gamepad.index; });
  window.addEventListener('gamepaddisconnected', e => { if (padIndex === e.gamepad.index) padIndex = -1; });
  input.poll = () => {
    input.f = keys['KeyW'] ? 1 : 0;
    input.b = keys['KeyS'] ? 1 : 0;
    input.l = keys['KeyA'] ? 1 : 0;
    input.r = keys['KeyD'] ? 1 : 0;
    input.run = (keys['ShiftLeft'] || keys['ShiftRight']) ? 1 : 0;
    input.brake = keys['Space'] ? 1 : 0;
    // ---- gamepad overlay (untested with physical hardware — code path is safe without one) ----
    if (padIndex >= 0) {
      const gp = navigator.getGamepads()[padIndex];
      if (gp) {
        const dz = v => Math.abs(v) > 0.18 ? v : 0;
        const ly = dz(gp.axes[1]), lx = dz(gp.axes[0]);
        if (ly < 0) input.f = Math.max(input.f, -ly);
        if (ly > 0) input.b = Math.max(input.b, ly);
        if (lx < 0) input.l = Math.max(input.l, -lx);
        if (lx > 0) input.r = Math.max(input.r, lx);
        const rx = dz(gp.axes[2]), ry = dz(gp.axes[3]);
        camera.rotation.y += rx * 0.045;
        camera.rotation.x = Math.max(-1.4, Math.min(1.4, camera.rotation.x + ry * 0.035));
        if (gp.buttons[7] && gp.buttons[7].value > 0.4) input.fire = 1;
        else if (input.padFire) input.fire = 0;
        input.padFire = gp.buttons[7] && gp.buttons[7].value > 0.4;
        if (gp.buttons[6] && gp.buttons[6].value > 0.4) input.brake = 1;
        if (gp.buttons[10] && gp.buttons[10].pressed) input.run = 1;
        if (gp.buttons[2] && gp.buttons[2].pressed && !input.padX) input.reloadEdge = true;
        input.padX = gp.buttons[2] && gp.buttons[2].pressed;
        if (gp.buttons[3] && gp.buttons[3].pressed && !input.padY) input.interactEdge = true;
        input.padY = gp.buttons[3] && gp.buttons[3].pressed;
      }
    }
  };
}

/* ============================================================
   ALIENS
   ============================================================ */
function makeAlienTemplate() {
  const skin = mat('alienSkin', 0.35, 0.5, 0.55, { roughness: 0.45 });
  skin.emissiveColor = new BABYLON.Color3(0.02, 0.06, 0.07);
  const eyeMat = mat('alienEyeMat', 0.1, 1, 1, { emissive: new BABYLON.Color3(0.3, 0.95, 1) });
  world.alienMats = { skin, eyeMat };
}

function spawnAlien() {
  const ang = Math.random() * Math.PI * 2;
  const rad = 52 + Math.random() * 8;
  const pos = new BABYLON.Vector3(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
  const root = new BABYLON.TransformNode('alien', scene);
  root.position.copyFrom(pos);
  const { skin, eyeMat } = world.alienMats;
  const bodyM = BABYLON.MeshBuilder.CreateCapsule('aBody', { radius: 0.4, height: 1.9 }, scene);
  bodyM.position.y = 1.15; bodyM.parent = root; bodyM.material = skin;
  const head = BABYLON.MeshBuilder.CreateSphere('aHead', { diameterX: 0.85, diameterY: 1.0, diameterZ: 0.75 }, scene);
  head.position.y = 2.25; head.parent = root; head.material = skin;
  const eL = BABYLON.MeshBuilder.CreateSphere('aEyeL', { diameterX: 0.22, diameterY: 0.3, diameterZ: 0.12 }, scene);
  eL.position.set(-0.18, 2.3, 0.32); eL.parent = root; eL.material = eyeMat;
  const eR = eL.clone('aEyeR'); eR.position.x = 0.18; eR.parent = root;
  const armL = BABYLON.MeshBuilder.CreateCapsule('aArmL', { radius: 0.09, height: 1.1 }, scene);
  armL.position.set(-0.5, 1.35, 0); armL.rotation.z = 0.35; armL.parent = root; armL.material = skin;
  const armR = armL.clone('aArmR'); armR.position.x = 0.5; armR.rotation.z = -0.35; armR.parent = root;
  const alien = {
    root, state: 'advance',
    // resolve = how many repels before it gives up and heads back to the trees
    resolve: 1 + Math.floor((G.wave - 1) / 3) + (Math.random() < 0.25 ? 1 : 0),
    speed: CFG.alienBaseSpeed * (0.85 + Math.random() * 0.4) * (1 + G.wave * 0.06),
    knockV: null, knockT: 0, stunT: 0, bobPhase: Math.random() * 6,
    swipeCd: 0,
  };
  [bodyM, head, eL, eR, armL, armR].forEach(m => { m.metadata = { alien }; });
  G.aliens.push(alien);
  return alien;
}

function repelAlien(alien, fromPos, scored) {
  if (alien.state === 'fleeing') return;
  if (alien.state === 'carrying') dropBaby(alien);
  const away = alien.root.position.subtract(fromPos); away.y = 0;
  const dir = away.normalize();
  alien.knockV = dir.scale(14).add(new BABYLON.Vector3(0, 5.5, 0));
  alien.knockT = 0.65;
  alien.resolve--;
  if (alien.resolve <= 0) {
    alien.state = 'fleeing'; // it gives up — back to the tree line
  } else {
    alien.state = 'stunned';
    alien.stunT = 1.4 + Math.random() * 0.8;
  }
  AudioFX.repel();
  burstParticles(alien.root.position.add(new BABYLON.Vector3(0, 1.4, 0)),
    new BABYLON.Color4(0.3, 0.95, 1, 1), 26);
  const flash = new BABYLON.PointLight('repelFlash', alien.root.position.add(new BABYLON.Vector3(0, 1.5, 0)), scene);
  flash.diffuse = new BABYLON.Color3(0.3, 0.9, 1); flash.intensity = 18; flash.range = 9;
  setTimeout(() => flash.dispose(), 130);
  if (scored) {
    G.repels++;
    G.score += CFG.repelScore * G.wave;
    updateHud();
  }
}

function dropBaby(alien) {
  const b = world.baby;
  b.root.parent = null;
  b.root.position.copyFrom(alien.root.position);
  b.root.position.y = 0.05;
  G.babyState = 'returning';
  dom.baby.textContent = 'RETURNING'; dom.baby.className = '';
}

/* ============================================================
   PARTICLES & TRACERS
   ============================================================ */
function burstParticles(pos, color, count) {
  const ps = new BABYLON.ParticleSystem('burst', count, scene);
  ps.particleTexture = getFlareTex();
  ps.emitter = pos.clone();
  ps.minEmitBox = new BABYLON.Vector3(-0.1, -0.1, -0.1);
  ps.maxEmitBox = new BABYLON.Vector3(0.1, 0.1, 0.1);
  ps.color1 = color; ps.color2 = color.scale(0.7);
  ps.colorDead = new BABYLON.Color4(0, 0, 0, 0);
  ps.minSize = 0.08; ps.maxSize = 0.28;
  ps.minLifeTime = 0.15; ps.maxLifeTime = 0.4;
  ps.emitRate = 0;
  ps.manualEmitCount = count;
  ps.minEmitPower = 3; ps.maxEmitPower = 8;
  ps.direction1 = new BABYLON.Vector3(-1, -0.4, -1);
  ps.direction2 = new BABYLON.Vector3(1, 1.2, 1);
  ps.gravity = new BABYLON.Vector3(0, -6, 0);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
  ps.disposeOnStop = true;
  ps.start();
  // LESSON (V1): targetStopDuration does NOT stop manual bursts — stop explicitly or leak systems forever.
  setTimeout(() => { try { ps.stop(); } catch (e) {} }, 80);
  // belt-and-suspenders: hard dispose well after max particle lifetime
  setTimeout(() => { try { ps.dispose(); } catch (e) {} }, 1400);
}

let flareTex = null;
function getFlareTex() {
  if (flareTex) return flareTex;
  const size = 64;
  const dyn = new BABYLON.DynamicTexture('flare', size, scene, false);
  const c = dyn.getContext();
  const grad = c.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = grad; c.fillRect(0, 0, size, size);
  dyn.update();
  dyn.hasAlpha = true;
  flareTex = dyn;
  return dyn;
}

function spawnTracer(from, to) {
  const line = BABYLON.MeshBuilder.CreateLines('tracer', { points: [from, to] }, scene);
  line.color = new BABYLON.Color3(1, 0.85, 0.5);
  line.alpha = 0.9;
  const born = performance.now();
  const obs = scene.onBeforeRenderObservable.add(() => {
    const age = (performance.now() - born) / 110;
    line.alpha = Math.max(0, 0.9 * (1 - age));
    if (age >= 1) { scene.onBeforeRenderObservable.remove(obs); line.dispose(); }
  });
}

/* ============================================================
   SHOOTING
   ============================================================ */
let fireCd = 0;
function tryFire() {
  if (!G.running || G.over || G.reloading || fireCd > 0 || G.inTruck) return;
  if (G.ammo <= 0) { AudioFX.dryFire(); input.fire = 0; return; }
  G.ammo--; fireCd = 0.55;
  AudioFX.shotgun();
  // muzzle flash
  const mPos = world.muzzleNode.getAbsolutePosition();
  burstParticles(mPos, new BABYLON.Color4(1, 0.8, 0.35, 1), 14);
  const flash = new BABYLON.PointLight('mFlash', mPos, scene);
  flash.diffuse = new BABYLON.Color3(1, 0.8, 0.4); flash.intensity = 25; flash.range = 12;
  setTimeout(() => flash.dispose(), 70);
  // gun kick
  world.gunRoot.position.z = 0.78;
  setTimeout(() => { if (world.gunRoot) world.gunRoot.position.z = 0.9; }, 90);
  // pellets
  const origin = camera.globalPosition.clone();
  const hitAliens = new Set();
  for (let i = 0; i < CFG.pellets; i++) {
    const spread = CFG.spreadDeg * Math.PI / 180;
    const rx = (Math.random() - 0.5) * spread * 2;
    const ry = (Math.random() - 0.5) * spread * 2;
    const dir = camera.getDirection(new BABYLON.Vector3(Math.sin(ry), Math.sin(rx), 1)).normalize();
    const ray = new BABYLON.Ray(origin, dir, CFG.shotRange);
    const pick = scene.pickWithRay(ray, m => !!(m.metadata && m.metadata.alien) || m === world.ground || m.name.startsWith('house') || m.name.startsWith('barn'));
    const end = pick && pick.hit ? pick.pickedPoint : origin.add(dir.scale(CFG.shotRange));
    spawnTracer(mPos.add(dir.scale(0.3)), end);
    if (pick && pick.hit && pick.pickedMesh.metadata && pick.pickedMesh.metadata.alien) {
      hitAliens.add(pick.pickedMesh.metadata.alien);
    }
  }
  hitAliens.forEach(a => repelAlien(a, camera.globalPosition, true));
  if (hitAliens.size > 0) {
    dom.hitmarker.classList.add('show');
    setTimeout(() => dom.hitmarker.classList.remove('show'), 120);
  }
  updateHud();
  if (G.ammo === 0 && G.reserve > 0) startReload();
}

function startReload() {
  if (G.reloading || G.reserve <= 0 || G.ammo >= CFG.ammoClip) return;
  G.reloading = true; G.reloadT = CFG.reloadTime;
  AudioFX.reload();
  dom.reload.textContent = 'RELOADING...';
}

/* ============================================================
   WAVES
   ============================================================ */
function startWave(n) {
  G.wave = n;
  G.waveState = 'active';
  G.spawnQueue = 3 + n * 2;
  G.spawnTimer = 0.5;
  AudioFX.waveHorn();
  dom.wave.textContent = n;
  dom.waveState.textContent = 'visitors in the trees…';
  showRadio(RADIO_LINES[(n - 1) % RADIO_LINES.length]);
  updateDawn();
}

function updateDawn() {
  // by wave 8 the sky warms toward dawn
  const t = Math.min(1, (G.wave - 1) / 7);
  const nightFog = new BABYLON.Color3(0.02, 0.03, 0.06);
  const dawnFog = new BABYLON.Color3(0.18, 0.12, 0.14);
  scene.fogColor = BABYLON.Color3.Lerp(nightFog, dawnFog, t);
  scene.clearColor = new BABYLON.Color4(0.008 + t * 0.1, 0.012 + t * 0.05, 0.03 + t * 0.08, 1);
  world.hemi.intensity = 0.22 + t * 0.25;
  world.hemi.diffuse = BABYLON.Color3.Lerp(
    new BABYLON.Color3(0.45, 0.55, 0.8), new BABYLON.Color3(0.9, 0.6, 0.5), t);
  world.moon.intensity = 0.8 - t * 0.3;
  if (world.starMesh) world.starMesh.visibility = 1 - t * 0.85;
}

function showRadio(text) {
  AudioFX.radioBlip();
  dom.radio.textContent = text;
  dom.radio.classList.add('show');
  clearTimeout(showRadio._t);
  showRadio._t = setTimeout(() => dom.radio.classList.remove('show'), 6500);
}

/* ============================================================
   GAME FLOW
   ============================================================ */
function startGame() {
  G.running = true; G.over = false;
  G.hp = CFG.playerHp; G.score = 0; G.repels = 0;
  G.ammo = CFG.ammoClip; G.reserve = CFG.ammoReserve;
  G.reloading = false; G.wave = 0; G.aliens = [];
  G.babyState = 'safe';
  dom.hud.style.display = 'block';
  makeAlienTemplate();
  AudioFX.unlock();
  AudioFX.cricketsStart();
  G.waveState = 'calm'; G.waveTimer = 4;
  dom.waveState.textContent = 'something moves out there…';
  showRadio('📻 "...if anyone can hear this — the lights are converging on the Hartley farm..."');
  updateHud();
}

function triggerEnd(result) {
  // result: 'win' | 'dead' | 'taken'
  G.over = true;
  AudioFX.engineStop(); AudioFX.cricketsStop();
  AudioFX.stinger(result === 'win');
  document.exitPointerLock && document.exitPointerLock();
  const s = store.get();
  const newBest = G.score > s.best;
  if (newBest) { s.best = G.score; s.bestWave = Math.max(s.bestWave, G.wave); }
  s.bestWave = Math.max(s.bestWave, G.wave);
  if (result === 'win') s.wins++;
  store.save();
  const delay = result === 'win' ? 3500 : 1400;
  if (result === 'win') departShip();
  setTimeout(() => {
    dom.hud.style.display = 'none';
    dom.end.style.display = 'flex';
    if (result === 'win') {
      dom.endTitle.textContent = 'DAWN';
      dom.endText.innerHTML =
        '<p>As the sun crests the Cascades, the big ship finally comes low over the pasture. ' +
        'The little one squeezes your hand once — then walks into the light, laughing.</p>' +
        '<p>They were never invaders. They were parents.</p>' +
        '<p class="radio-line">📻 <em>"...all stations, the lights are gone. Whatever happened out there... it\'s over."</em></p>';
    } else if (result === 'dead') {
      dom.endTitle.textContent = 'THE FARM GOES QUIET';
      dom.endText.innerHTML =
        '<p>Your grip loosens. The last thing you see is the little one\'s cyan eyes, wide with worry, ' +
        'as gentle three-fingered hands lift you onto the porch.</p>' +
        '<p>They never wanted this. Neither did you.</p>';
    } else {
      dom.endTitle.textContent = 'TAKEN INTO THE TREES';
      dom.endText.innerHTML =
        '<p>The tall ones carry the child into the fir shadow, glancing back at you — not in triumph, ' +
        'but something closer to apology. The lights over the ridge fade one by one.</p>' +
        '<p>Maybe they were only ever here for one thing.</p>';
    }
    const bs = store.get();
    dom.endStats.innerHTML =
      `<div class="end-stat${newBest ? ' newbest' : ''}"><b>${G.score.toLocaleString()}</b><span>${newBest ? 'NEW BEST!' : 'Score'}</span></div>` +
      `<div class="end-stat"><b>${G.wave}</b><span>Wave</span></div>` +
      `<div class="end-stat"><b>${G.repels}</b><span>Repelled</span></div>` +
      `<div class="end-stat"><b>${bs.best.toLocaleString()}</b><span>Best Score</span></div>` +
      `<div class="end-stat"><b>${bs.wins}</b><span>Dawns Seen</span></div>`;
  }, delay);
}

function departShip() {
  const ship = world.ship;
  ship.departing = true; ship.departT = 0;
  // baby runs toward the beam
  G.babyState = 'ascending';
  const b = world.baby;
  b.root.parent = null;
}

/* ============================================================
   PER-FRAME UPDATE
   ============================================================ */
function update(dt) {
  input.poll();
  fireCd = Math.max(0, fireCd - dt);

  /* ---- reload ---- */
  if (G.reloading) {
    G.reloadT -= dt;
    if (G.reloadT <= 0) {
      const need = CFG.ammoClip - G.ammo;
      const take = Math.min(need, G.reserve);
      G.ammo += take; G.reserve -= take;
      G.reloading = false;
      dom.reload.textContent = '';
      updateHud();
    }
  }
  if (input.reloadEdge) { input.reloadEdge = false; startReload(); }
  if (input.fire) tryFire();

  /* ---- truck vs on-foot ---- */
  const truck = world.truck;
  const truckPos = truck.root.position;
  const distToTruck = BABYLON.Vector3.Distance(camera.globalPosition, truckPos.add(new BABYLON.Vector3(0, 1.5, 0)));
  if (input.interactEdge) {
    input.interactEdge = false;
    if (!G.inTruck && distToTruck < 5) enterTruck();
    else if (G.inTruck) exitTruck();
  }
  if (!G.inTruck) {
    updateOnFoot(dt);
    dom.prompt.className = distToTruck < 5 ? 'show' : '';
    dom.prompt.textContent = 'E — climb into the truck';
  } else {
    updateTruck(dt);
    dom.prompt.className = 'show';
    dom.prompt.textContent = 'E — hop out';
  }

  /* ---- waves ---- */
  if (G.waveState === 'calm') {
    G.waveTimer -= dt;
    if (G.waveTimer <= 0) startWave(G.wave + 1);
  } else {
    if (G.spawnQueue > 0) {
      G.spawnTimer -= dt;
      if (G.spawnTimer <= 0) {
        spawnAlien();
        G.spawnQueue--;
        G.spawnTimer = Math.max(0.5, 2.2 - G.wave * 0.18);
      }
    }
    if (G.spawnQueue === 0 && G.aliens.every(a => a.state === 'fleeing')) {
      // wave cleared once all fleeing aliens despawn
      if (G.aliens.length === 0) {
        G.score += 250 * G.wave;
        if (G.wave >= CFG.waves) { triggerEnd('win'); return; }
        G.waveState = 'calm'; G.waveTimer = 9;
        dom.waveState.textContent = 'the woods go still… (breather)';
        showRadio('📻 "...they pulled back. Reload while you can, whoever you are..."');
        if (G.reserve < CFG.ammoClip * 2) G.reserve += CFG.ammoClip; // resupply mercy
        updateHud();
      }
    }
  }

  updateAliens(dt);
  updateBaby(dt);
  updateShip(dt);

  /* ---- ambient chitter/coo ---- */
  G.chitterT -= dt;
  if (G.chitterT <= 0 && G.aliens.length > 0) { AudioFX.chitter(); G.chitterT = 3 + Math.random() * 5; }
  G.cooT -= dt;
  if (G.cooT <= 0 && G.babyState === 'safe') { AudioFX.coo(); G.cooT = 10 + Math.random() * 14; }
}

function updateOnFoot(dt) {
  const speed = (input.run ? CFG.runSpeed : CFG.walkSpeed) * dt;
  const fwd = camera.getDirection(BABYLON.Vector3.Forward()); fwd.y = 0; fwd.normalize();
  const right = camera.getDirection(BABYLON.Vector3.Right()); right.y = 0; right.normalize();
  const move = fwd.scale((input.f - input.b) * speed).add(right.scale((input.r - input.l) * speed));
  camera.cameraDirection.addInPlace(move);
  camera.position.y = 1.75; // flat ground, fixed eye height
  // subtle viewbob
  if (move.lengthSquared() > 0.0001 && world.gunRoot) {
    world._bob = (world._bob || 0) + dt * (input.run ? 11 : 7);
    world.gunRoot.position.y = -0.28 + Math.sin(world._bob) * 0.012;
  }
}

function enterTruck() {
  G.inTruck = true;
  AudioFX.engineStart();
  camera.checkCollisions = false;
  if (world.gunRoot) world.gunRoot.setEnabled(false);
}

function exitTruck() {
  G.inTruck = false;
  AudioFX.engineStop();
  const truck = world.truck;
  const side = truck.root.getDirection(new BABYLON.Vector3(1, 0, 0));
  camera.position = truck.root.position.add(side.scale(2.6)).add(new BABYLON.Vector3(0, 1.75, 0));
  camera.checkCollisions = true;
  truck.body.setLinearVelocity(new BABYLON.Vector3(0, truck.body.getLinearVelocity().y, 0));
  if (world.gunRoot) world.gunRoot.setEnabled(true);
}

function updateTruck(dt) {
  const truck = world.truck;
  const body = truck.body;
  const fwd = truck.root.getDirection(new BABYLON.Vector3(0, 0, 1)); fwd.y = 0; fwd.normalize();
  const vel = body.getLinearVelocity();
  const planar = new BABYLON.Vector3(vel.x, 0, vel.z);
  let speed = BABYLON.Vector3.Dot(planar, fwd);

  const throttle = input.f - input.b;
  const target = throttle > 0 ? CFG.truckTopSpeed * throttle
    : throttle < 0 ? CFG.truckReverse * -throttle : 0;
  // heavy-diesel feel: strong low-end pull, eases off near top speed
  speed += (target - speed) * Math.min(1, dt * 1.7);
  if (input.brake) speed *= Math.max(0, 1 - 3.2 * dt);

  const newPlanar = fwd.scale(speed);
  body.setLinearVelocity(new BABYLON.Vector3(newPlanar.x, vel.y, newPlanar.z));

  // steering scales with speed; sign flips in reverse like a real vehicle
  const steer = (input.l - input.r);
  const steerRate = steer * 1.5 * Math.min(1, Math.abs(speed) / 5) * (speed >= 0 ? 1 : -1);
  const av = body.getAngularVelocity();
  body.setAngularVelocity(new BABYLON.Vector3(av.x * 0.2, steerRate, av.z * 0.2));

  // camera rides the cab
  const camPos = truck.root.position
    .add(truck.root.getDirection(new BABYLON.Vector3(0, 0, 1)).scale(1.9))
    .add(new BABYLON.Vector3(0, 2.6, 0));
  camera.position.copyFrom(camPos);

  // wheels spin
  truck.wheels.forEach(w => { w.rotation.x += speed * dt * 0.9; });
  truck.speed = speed;
  AudioFX.engineUpdate(Math.min(1, Math.abs(speed) / CFG.truckTopSpeed));

  // ramming = repel (gentle, remember — they're parents)
  if (Math.abs(speed) > 5) {
    G.aliens.forEach(a => {
      if (a.state === 'fleeing' || a.state === 'stunned') return;
      if (BABYLON.Vector3.Distance(a.root.position, truck.root.position) < 3.4) {
        repelAlien(a, truck.root.position, true);
      }
    });
  }
}

function updateAliens(dt) {
  const baby = world.baby;
  const playerPos = camera.globalPosition;
  for (let i = G.aliens.length - 1; i >= 0; i--) {
    const a = G.aliens[i];
    const p = a.root.position;
    a.bobPhase += dt * 4;

    if (a.knockT > 0) {
      a.knockT -= dt;
      a.knockV.y -= 22 * dt;
      p.addInPlace(a.knockV.scale(dt));
      if (p.y < 0) { p.y = 0; a.knockV.y = 0; }
      continue;
    }
    if (a.state === 'stunned') {
      a.stunT -= dt;
      p.y = Math.abs(Math.sin(a.bobPhase * 2)) * 0.05;
      if (a.stunT <= 0) a.state = 'advance';
      continue;
    }
    if (a.state === 'fleeing') {
      const out = p.clone(); out.y = 0;
      const dir = out.normalize();
      p.addInPlace(dir.scale(a.speed * 2.2 * dt));
      if (p.length() > 68) {
        a.root.dispose();
        G.aliens.splice(i, 1);
      }
      continue;
    }
    if (a.state === 'carrying') {
      // head for the tree line with the baby
      const out = p.clone(); out.y = 0;
      const dir = out.normalize();
      p.addInPlace(dir.scale(CFG.alienCarrySpeed * dt));
      a.root.lookAt(p.add(dir), Math.PI);
      p.y = Math.abs(Math.sin(a.bobPhase)) * 0.12;
      if (p.length() > 56) { triggerEnd('taken'); return; }
      continue;
    }
    // advance toward the baby wherever it is — if it's being carried the
    // others naturally cluster around the carrier like an escort
    const targetPos = baby.root.getAbsolutePosition();
    const to = targetPos.subtract(p); to.y = 0;
    const d = to.length();
    if (d > 0.01) {
      const dir = to.normalize();
      p.addInPlace(dir.scale(a.speed * dt));
      a.root.lookAt(new BABYLON.Vector3(targetPos.x, p.y, targetPos.z), Math.PI);
    }
    p.y = Math.abs(Math.sin(a.bobPhase)) * 0.12;

    // reach the baby → scoop it up
    if (G.babyState === 'safe' || G.babyState === 'returning') {
      if (BABYLON.Vector3.Distance(p, baby.root.getAbsolutePosition()) < 1.2) {
        G.babyState = 'carried';
        baby.root.parent = a.root;
        baby.root.position.set(0, 1.5, 0.45);
        a.state = 'carrying';
        dom.baby.textContent = 'BEING CARRIED OFF!';
        dom.baby.className = 'danger';
        showRadio('📻 "...one of them has something! It\'s carrying something small!..."');
      }
    }
    // swipe the player if close
    a.swipeCd -= dt;
    if (a.swipeCd <= 0 && BABYLON.Vector3.Distance(p, playerPos) < CFG.swipeRange && !G.inTruck) {
      a.swipeCd = 1.6;
      damagePlayer(CFG.swipeDmg + Math.floor(Math.random() * 4) + Math.floor(G.wave / 2));
    }
  }
}

function damagePlayer(amt) {
  G.hp -= amt;
  AudioFX.hurt();
  dom.vignette.classList.add('hurt');
  setTimeout(() => dom.vignette.classList.remove('hurt'), 220);
  updateHud();
  if (G.hp <= 0) { G.hp = 0; triggerEnd('dead'); }
}

function updateBaby(dt) {
  const b = world.baby;
  b.bob += dt * 2.2;
  if (G.babyState === 'safe') {
    b.root.position.y = 0.05 + Math.abs(Math.sin(b.bob)) * 0.06;
  } else if (G.babyState === 'returning') {
    const to = b.home.subtract(b.root.position); to.y = 0;
    if (to.length() < 0.4) {
      G.babyState = 'safe';
      dom.baby.textContent = 'SAFE'; dom.baby.className = '';
      AudioFX.coo();
    } else {
      b.root.position.addInPlace(to.normalize().scale(1.3 * dt));
      b.root.position.y = 0.05 + Math.abs(Math.sin(b.bob * 2)) * 0.09;
    }
  } else if (G.babyState === 'ascending') {
    // drift toward a point under the ship, then float up
    const ship = world.ship;
    const under = new BABYLON.Vector3(ship.root.position.x, 0, ship.root.position.z);
    const to = under.subtract(b.root.position); to.y = 0;
    if (to.length() > 1.5) {
      b.root.position.addInPlace(to.normalize().scale(9 * dt)); // running to the light
    } else {
      b.root.position.y += 7 * dt;
    }
  }
}

function updateShip(dt) {
  const ship = world.ship;
  ship.t += dt;
  const root = ship.root;
  if (!ship.departing) {
    root.position.y = ship.baseY + Math.sin(ship.t * 0.5) * 1.6;
    root.rotation.y += dt * 0.12;
    const pulse = 0.5 + 0.5 * Math.sin(ship.t * 2.2);
    world.rimMats.forEach((rm, i) => {
      const phase = 0.5 + 0.5 * Math.sin(ship.t * 2.2 + i * 0.63);
      rm.emissiveColor.set(0.15 + phase * 0.35, 0.5 + phase * 0.5, 0.6 + phase * 0.4);
    });
    ship.beamMat.alpha = 0.06 + pulse * 0.05;
  } else {
    ship.departT += dt;
    const k = ship.departT / 4;
    root.position.y = ship.baseY + ship.departT * 14;
    root.rotation.y += dt * (0.12 + k * 1.2);
    ship.beamMat.alpha = Math.max(0, 0.12 - k * 0.12);
    const fade = Math.max(0, 1 - k);
    root.getChildMeshes().forEach(m => { m.visibility = fade; });
  }
}

function updateHud() {
  dom.score.textContent = G.score.toLocaleString();
  dom.ammo.textContent = `${G.ammo} / ${G.reserve}`;
  dom.hp.textContent = Math.ceil(G.hp);
  dom.hpFill.style.width = Math.max(0, G.hp) + '%';
  dom.hpFill.className = G.hp <= 30 ? 'low' : '';
}

/* ============================================================
   MENU WIRING
   ============================================================ */
function refreshMenuButtons() {
  dom.qualityBtn.textContent = 'Quality: ' + G.quality.toUpperCase();
  dom.muteBtn.textContent = 'Sound: ' + (store.get().muted ? 'OFF' : 'ON');
  const s = store.get();
  dom.bestLine.textContent = s.best > 0
    ? `Best score ${s.best.toLocaleString()} · reached wave ${s.bestWave} · ${s.wins} dawn${s.wins === 1 ? '' : 's'} seen`
    : 'No stand has been made yet.';
}

dom.qualityBtn.addEventListener('click', () => {
  G.quality = G.quality === 'high' ? 'low' : 'high';
  store.get().quality = G.quality; store.save();
  refreshMenuButtons();
});
dom.muteBtn.addEventListener('click', () => {
  const s = store.get(); s.muted = !s.muted; store.save();
  AudioFX.setMuted(s.muted);
  refreshMenuButtons();
});
$('startBtn').addEventListener('click', async () => {
  dom.intro.style.display = 'none';
  dom.loading.style.display = 'flex';
  try {
    await boot();
    dom.loading.style.display = 'none';
    startGame();
    try { $('renderCanvas').requestPointerLock(); } catch (e) { /* needs a fresh user gesture — next click grabs it */ }
  } catch (err) {
    dom.loadMsg.textContent = '⚠ ' + (err.message || err);
    console.error('[CascadeFoundling] boot failed:', err);
  }
});
$('restartBtn').addEventListener('click', () => location.reload());

refreshMenuButtons();
console.log('[CascadeFoundling] menu ready');
