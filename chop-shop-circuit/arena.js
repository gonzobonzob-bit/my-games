/* ============================================================
   CHOP SHOP CIRCUIT — 3D arena, physics bots, AI, camera, VFX
   Babylon.js + Havok physics. The player never drives — this
   module runs a full auto-resolved battle and reports the result.
   ============================================================ */
'use strict';

const Arena = (() => {
  let engine, scene, camera, havok;
  const world = {}; // static arena meshes/lights/pipeline/shadowGen
  let quality = 'high';

  const B = {}; // { player: botObj, enemy: botObj } — current battle combatants
  let battleActive = false;
  let battleT = 0;
  const MATCH_TIME = 120; // clock runs down to a judges' decision, as in the real sport
  let slowmoT = 0;
  let onDone = null;

  const PIT_RADIUS = 3.4;
  const ARENA_RADIUS = 15;
  let paused = false;

  /* ============================================================
     AUDIO — synthesized oscillator/noise SFX, no external files.
     Everything routes through masterGain so the mute flag (and the
     quality-menu-style toggle in game.js) is a single gain ramp,
     not a scattered set of early-returns.
     ============================================================ */
  let audioCtx = null;
  let masterGain = null;
  let muted = false;
  let crowdNodes = null;

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = muted ? 0 : 1;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function setMuted(m) {
    muted = m;
    if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(muted ? 0 : 1, audioCtx.currentTime, 0.05);
  }

  function noiseBuffer(ctx, seconds) {
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    return buf;
  }

  /* Per-weapon-type impact stings — distinct enough to read by ear which
     archetype just landed a hit, without looking at the HUD. */
  function sfxHit(weaponType, big) {
    if (muted) return;
    const ctx = ensureAudioCtx();
    const t = ctx.currentTime;
    const vol = big ? 0.5 : 0.32;
    if (weaponType === 'hspinner' || weaponType === 'vspinner') {
      const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator(), gain = ctx.createGain();
      osc1.type = 'triangle'; osc1.frequency.setValueAtTime(1400, t); osc1.frequency.exponentialRampToValueAtTime(220, t + 0.28);
      osc2.type = 'square'; osc2.frequency.setValueAtTime(2000, t); osc2.frequency.exponentialRampToValueAtTime(300, t + 0.2);
      gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc1.connect(gain); osc2.connect(gain); gain.connect(masterGain);
      osc1.start(t); osc2.start(t); osc1.stop(t + 0.3); osc2.stop(t + 0.3);
    } else if (weaponType === 'flipper') {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(160, t); osc.frequency.exponentialRampToValueAtTime(60, t + 0.22);
      gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain).connect(masterGain); osc.start(t); osc.stop(t + 0.24);
      const hiss = ctx.createBufferSource(); hiss.buffer = noiseBuffer(ctx, 0.15);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const hissGain = ctx.createGain();
      hissGain.gain.setValueAtTime(vol * 0.4, t); hissGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      hiss.connect(hp).connect(hissGain).connect(masterGain); hiss.start(t);
    } else if (weaponType === 'crusher') {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.4);
      gain.gain.setValueAtTime(vol * 1.1, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.connect(gain).connect(masterGain); osc.start(t); osc.stop(t + 0.42);
      const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx, 0.2);
      const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 500;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(vol * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      noise.connect(bp).connect(ng).connect(masterGain); noise.start(t);
    } else { // drum — quick stubby metallic clank
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.setValueAtTime(900, t); osc.frequency.exponentialRampToValueAtTime(200, t + 0.1);
      gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain).connect(masterGain); osc.start(t); osc.stop(t + 0.12);
    }
  }

  function sfxFlip() {
    if (muted) return;
    const ctx = ensureAudioCtx(); const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(900, t + 0.15);
    osc.frequency.linearRampToValueAtTime(150, t + 0.35);
    gain.gain.setValueAtTime(0.28, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    osc.connect(gain).connect(masterGain); osc.start(t); osc.stop(t + 0.38);
  }

  function sfxKO() {
    if (muted) return;
    const ctx = ensureAudioCtx(); const t = ctx.currentTime;
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx, 0.5);
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass';
    bp.frequency.setValueAtTime(1200, t); bp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    noise.connect(bp).connect(ng).connect(masterGain); noise.start(t);
    const osc = ctx.createOscillator(), og = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(90, t); osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(og).connect(masterGain); osc.start(t); osc.stop(t + 0.55);
  }

  /* Throttled edge-triggered zap — called once per pit "tick" from
     updateBotAI rather than every physics frame, see bot.hazardSoundT. */
  function sfxPitHazard() {
    if (muted) return;
    const ctx = ensureAudioCtx(); const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(80, t);
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.type = 'square'; lfo.frequency.value = 40; lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.22, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(gain).connect(masterGain);
    osc.start(t); lfo.start(t); osc.stop(t + 0.25); lfo.stop(t + 0.25);
  }

  function sfxVictory() {
    if (muted) return;
    const ctx = ensureAudioCtx();
    [523.25, 659.25, 784, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.3, start); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain).connect(masterGain); osc.start(start); osc.stop(start + 0.35);
    });
  }

  function sfxDefeat() {
    if (muted) return;
    const ctx = ensureAudioCtx();
    [392, 329.63, 261.63].forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.26, start); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.connect(gain).connect(masterGain); osc.start(start); osc.stop(start + 0.4);
    });
  }

  /* Mutual destruction gets its own dissonant sting — deliberately NOT
     the plain defeat jingle, so a double KO reads as a distinct, fair
     outcome rather than an ordinary loss. */
  function sfxDoubleKo() {
    if (muted) return;
    const ctx = ensureAudioCtx(); const t = ctx.currentTime;
    [370, 392].forEach(freq => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.22, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(gain).connect(masterGain); osc.start(t); osc.stop(t + 0.6);
    });
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx, 0.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    noise.connect(bp).connect(ng).connect(masterGain); noise.start(t);
  }

  function sfxUiClick() {
    if (muted) return;
    const ctx = ensureAudioCtx(); const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(500, t);
    gain.gain.setValueAtTime(0.12, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(masterGain); osc.start(t); osc.stop(t + 0.08);
  }

  function sfxPurchase() {
    if (muted) return;
    const ctx = ensureAudioCtx(); const t = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t); osc.frequency.linearRampToValueAtTime(900, t + 0.18);
    gain.gain.setValueAtTime(0.22, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain).connect(masterGain); osc.start(t); osc.stop(t + 0.22);
  }

  /* Ambient crowd/arena bed — filtered noise loop with a slow amplitude
     LFO so it reads as a murmuring crowd rather than a flat hiss. Runs
     for the duration of a battle; stopped on resetToIdle(). */
  function startCrowdAmbience() {
    if (crowdNodes) return;
    const ctx = ensureAudioCtx();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 550; bp.Q.value = 0.7;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.025;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.2);
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(bp).connect(gain).connect(masterGain);
    src.start(); lfo.start();
    crowdNodes = { src, lfo, gain };
  }

  function stopCrowdAmbience() {
    if (!crowdNodes || !audioCtx) { crowdNodes = null; return; }
    const ctx = audioCtx;
    const { src, lfo, gain } = crowdNodes;
    try {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => { try { src.stop(); lfo.stop(); } catch (e) {} }, 900);
    } catch (e) {}
    crowdNodes = null;
  }

  /* ---------------- boot ---------------- */
  async function boot(canvasId) {
    const canvas = document.getElementById(canvasId);
    engine = new BABYLON.Engine(canvas, true, { stencil: true, adaptToDeviceRatio: false });
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.01, 0.01, 0.015, 1);

    havok = await HavokPhysics();
    const plugin = new BABYLON.HavokPlugin(true, havok);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), plugin);

    buildLighting();
    buildFloor();
    buildWalls();
    buildCamera(canvas);
    applyQuality(quality);

    engine.runRenderLoop(() => {
      if (!paused) {
        const raw = Math.min(engine.getDeltaTime() / 1000, 0.05);
        const dt = slowmoT > 0 ? raw * 0.18 : raw;
        if (slowmoT > 0) slowmoT -= raw;
        if (battleActive) stepBattle(dt);
        stepCamera(dt);
      }
      scene.render();
    });
    window.addEventListener('resize', () => engine.resize());
  }

  function mat(name, r, g, b, opts = {}) {
    const m = new BABYLON.PBRMaterial(name, scene);
    m.albedoColor = new BABYLON.Color3(r, g, b);
    m.metallic = opts.metallic ?? 0.3;
    m.roughness = opts.roughness ?? 0.6;
    if (opts.emissive) m.emissiveColor = opts.emissive;
    return m;
  }

  /* procedurally painted grime/scratch detail — no external image assets */
  function grimeTexture(baseColor) {
    const size = 256;
    const dyn = new BABYLON.DynamicTexture('grime', size, scene, false);
    const c = dyn.getContext();
    c.fillStyle = baseColor; c.fillRect(0, 0, size, size);
    for (let i = 0; i < 340; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const len = 4 + Math.random() * 26;
      const ang = Math.random() * Math.PI * 2;
      c.strokeStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)';
      c.lineWidth = 0.6 + Math.random() * 1.6;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      c.stroke();
    }
    for (let i = 0; i < 30; i++) {
      c.fillStyle = 'rgba(120,60,20,0.08)';
      c.beginPath();
      c.arc(Math.random() * size, Math.random() * size, 4 + Math.random() * 10, 0, Math.PI * 2);
      c.fill();
    }
    dyn.update();
    return dyn;
  }

  function staticBox(node, w, h, d, cx = 0, cy = 0, cz = 0) {
    const body = new BABYLON.PhysicsBody(node, BABYLON.PhysicsMotionType.STATIC, false, scene);
    body.shape = new BABYLON.PhysicsShapeBox(
      new BABYLON.Vector3(cx, cy, cz), BABYLON.Quaternion.Identity(),
      new BABYLON.Vector3(w, h, d), scene);
    return body;
  }

  /* ---------------- static arena ---------------- */
  function buildLighting() {
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.55;
    hemi.diffuse = new BABYLON.Color3(0.55, 0.6, 0.75);
    hemi.groundColor = new BABYLON.Color3(0.08, 0.08, 0.12);
    const key = new BABYLON.DirectionalLight('key', new BABYLON.Vector3(-0.4, -0.9, 0.3), scene);
    key.position = new BABYLON.Vector3(20, 30, -20);
    key.intensity = 2.2;
    key.diffuse = new BABYLON.Color3(1, 0.97, 0.9);
    // overhead house light so the arena floor reads as a lit broadcast set
    const house = new BABYLON.PointLight('house', new BABYLON.Vector3(0, 16, 0), scene);
    house.diffuse = new BABYLON.Color3(0.95, 0.95, 1);
    house.intensity = 340; house.range = 46;
    world.house = house;
    // broadcast-arena colored rim spots at four corners
    const rim = [];
    const rimColors = [new BABYLON.Color3(0.2, 0.5, 1), new BABYLON.Color3(1, 0.25, 0.2), new BABYLON.Color3(0.2, 0.5, 1), new BABYLON.Color3(1, 0.25, 0.2)];
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const sp = new BABYLON.SpotLight('rim' + i, new BABYLON.Vector3(Math.cos(ang) * 20, 14, Math.sin(ang) * 20),
        new BABYLON.Vector3(-Math.cos(ang), -0.7, -Math.sin(ang)), Math.PI / 3, 4, scene);
      sp.diffuse = rimColors[i]; sp.intensity = 120; sp.range = 44;
      rim.push(sp);
    }
    world.hemi = hemi; world.key = key; world.rim = rim;
  }

  function buildFloor() {
    const floor = BABYLON.MeshBuilder.CreateDisc('floor', { radius: ARENA_RADIUS, tessellation: 48 }, scene);
    floor.rotation.x = Math.PI / 2;
    const fm = mat('floorMat', 0.08, 0.08, 0.1, { metallic: 0.75, roughness: 0.28 });
    fm.albedoTexture = grimeTexture('#141418');
    floor.material = fm;
    floor.receiveShadows = true;
    world.floor = floor;

    /* The visual disc is rotated 90° on X to lie flat, and a physics shape
       attached to it would inherit that rotation — turning the floor collider
       into a vertical slab that bots fall straight past. The collider therefore
       lives on its own unrotated, invisible node. */
    const floorCol = BABYLON.MeshBuilder.CreateBox('floorCollider',
      { width: ARENA_RADIUS * 2.4, height: 1, depth: ARENA_RADIUS * 2.4 }, scene);
    floorCol.position.y = -0.5;
    floorCol.isVisible = false;
    staticBox(floorCol, ARENA_RADIUS * 2.4, 1, ARENA_RADIUS * 2.4);
    world.floorCol = floorCol;

    // hazard warning ring around the center pit
    const ring = BABYLON.MeshBuilder.CreateTorus('pitRing', { diameter: PIT_RADIUS * 2, thickness: 0.15, tessellation: 32 }, scene);
    ring.position.y = 0.02;
    const ringMat = mat('ringMat', 0.9, 0.7, 0.05, { emissive: new BABYLON.Color3(0.9, 0.6, 0), roughness: 0.4 });
    ring.material = ringMat;
    // center pit — dark recessed disc, not a true hole (kept flat for stable physics)
    const pit = BABYLON.MeshBuilder.CreateDisc('pit', { radius: PIT_RADIUS - 0.2, tessellation: 32 }, scene);
    pit.rotation.x = Math.PI / 2; pit.position.y = -0.35;
    pit.material = mat('pitMat', 0.02, 0.01, 0.01, { roughness: 1, metallic: 0 });
    world.pit = pit; world.ring = ringMat;
  }

  function buildWalls() {
    const wallMat = mat('wallMat', 0.15, 0.16, 0.2, { metallic: 0.4, roughness: 0.5 });
    const segs = 24;
    const casters = [];
    for (let i = 0; i < segs; i++) {
      const ang = (i / segs) * Math.PI * 2;
      const seg = BABYLON.MeshBuilder.CreateBox('wallSeg' + i, { width: (2 * Math.PI * ARENA_RADIUS / segs) * 1.05, height: 1.6, depth: 0.4 }, scene);
      seg.position.set(Math.cos(ang) * ARENA_RADIUS, 0.8, Math.sin(ang) * ARENA_RADIUS);
      seg.rotation.y = -ang;
      seg.material = wallMat;
      staticBox(seg, (2 * Math.PI * ARENA_RADIUS / segs) * 1.05, 1.6, 0.4);
      casters.push(seg);
    }
    world.wallCasters = casters;
  }

  function buildCamera(canvas) {
    camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 2, 1.15, 22, new BABYLON.Vector3(0, 1, 0), scene);
    camera.minZ = 0.1; camera.lowerRadiusLimit = 6; camera.upperRadiusLimit = 34;
    camera.attachControl(canvas, false); // spectator only — no user drag
    camera.inputs.clear();
    world.camTarget = new BABYLON.Vector3(0, 1, 0);
    world.camGoal = { alpha: -Math.PI / 2, beta: 1.15, radius: 22 };
    world.camCutT = 0;
  }

  /* ============================================================
     QUALITY / POST — Low / Medium / High.
     High deliberately pushes past this vault's previous ceiling
     (Cascade Foundling's "high"): bigger shadow map, glow layer,
     chromatic aberration on impact, reflective floor kept at full
     roughness detail. Low/Medium stay as the safety net.
     ============================================================ */
  function applyQuality(level) {
    quality = level;
    const tier = level === 'high' ? 2 : level === 'medium' ? 1 : 0;
    engine.setHardwareScalingLevel(tier === 0 ? 1.5 : tier === 1 ? 1.2 : 1);

    if (world.shadowGen) { world.shadowGen.dispose(); world.shadowGen = null; }
    if (tier >= 1) {
      const sg = new BABYLON.ShadowGenerator(tier === 2 ? 2048 : 1024, world.key);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = tier === 2 ? BABYLON.ShadowGenerator.QUALITY_HIGH : BABYLON.ShadowGenerator.QUALITY_LOW;
      world.shadowGen = sg;
      if (world.floor) world.floor.receiveShadows = true;
    }

    if (world.pipeline) { world.pipeline.dispose(); world.pipeline = null; }
    if (tier >= 1) {
      const pp = new BABYLON.DefaultRenderingPipeline('pp', true, scene, [camera]);
      pp.bloomEnabled = true; pp.bloomThreshold = 0.65; pp.bloomWeight = tier === 2 ? 0.45 : 0.25; pp.bloomKernel = 48;
      pp.imageProcessing.vignetteEnabled = true;
      pp.imageProcessing.vignetteWeight = 1.8;
      pp.imageProcessing.contrast = 1.2;
      pp.imageProcessing.exposure = 1.08;
      if (tier === 2) {
        pp.chromaticAberrationEnabled = true;
        pp.chromaticAberration.aberrationAmount = 0;
        pp.sharpenEnabled = true; pp.sharpen.edgeAmount = 0.3;
        pp.fxaaEnabled = true;
      }
      world.pipeline = pp;
    }

    if (world.glow) { world.glow.dispose(); world.glow = null; }
    if (tier === 2) {
      const glow = new BABYLON.GlowLayer('glow', scene, { blurKernelSize: 32 });
      glow.intensity = 0.6;
      world.glow = glow;
    }

    world.ring.emissiveColor = tier === 0 ? new BABYLON.Color3(0.5, 0.35, 0) : new BABYLON.Color3(0.9, 0.6, 0);
  }

  function pulseAberration(amount) {
    if (world.pipeline && world.pipeline.chromaticAberrationEnabled) {
      world.pipeline.chromaticAberration.aberrationAmount = amount;
      setTimeout(() => { if (world.pipeline) world.pipeline.chromaticAberration.aberrationAmount = 0; }, 160);
    }
  }

  /* ============================================================
     BOT CONSTRUCTION
     ============================================================ */
  const WEAPON_COLORS = {
    drum: new BABYLON.Color4(0.8, 0.8, 0.85, 1),
    hspinner: new BABYLON.Color4(0.9, 0.9, 0.3, 1),
    flipper: new BABYLON.Color4(1, 0.5, 0.1, 1),
    vspinner: new BABYLON.Color4(0.6, 0.85, 1, 1),
    crusher: new BABYLON.Color4(1, 0.15, 0.1, 1),
  };

  /* Weapon meshes mirror the real robot-combat silhouettes: a horizontal
     spinner is a wide flat bar, a vertical spinner is an upright disc, a
     flipper is a low front spatula, a crusher is a raised beak. */
  function buildWeaponMesh(root, type) {
    let m, spin = null;
    switch (type) {
      case 'hspinner': // wide horizontal bar — huge reach
        m = BABYLON.MeshBuilder.CreateBox('weapon', { width: 3.0, height: 0.16, depth: 0.34 }, scene);
        m.position.set(0, 0.95, 0.35);
        m.material = mat('hspinMat', 0.72, 0.72, 0.75, { metallic: 0.95, roughness: 0.18 });
        spin = 'y';
        break;
      case 'flipper': // low pneumatic spatula at the front
        m = BABYLON.MeshBuilder.CreateBox('weapon', { width: 1.3, height: 0.12, depth: 0.8 }, scene);
        m.position.set(0, 0.28, 1.05); m.rotation.x = -0.3;
        m.material = mat('flipMat', 0.55, 0.35, 0.12, { metallic: 0.75, roughness: 0.3 });
        break;
      case 'vspinner': // upright disc, braces on the floor and launches upward
        m = BABYLON.MeshBuilder.CreateCylinder('weapon', { diameter: 1.5, height: 0.18, tessellation: 26 }, scene);
        m.rotation.z = Math.PI / 2; m.position.set(0, 0.6, 1.0);
        m.material = mat('vspinMat', 0.75, 0.78, 0.85, { metallic: 0.95, roughness: 0.15 });
        spin = 'x';
        break;
      case 'crusher': // hydraulic beak arm
        m = BABYLON.MeshBuilder.CreateCylinder('weapon', { diameterTop: 0.08, diameterBottom: 0.42, height: 1.4, tessellation: 10 }, scene);
        m.rotation.x = 1.05; m.position.set(0, 1.0, 0.85);
        m.material = mat('crushMat', 0.4, 0.06, 0.06, { metallic: 0.9, roughness: 0.15 });
        break;
      default: // drum — stubby horizontal roller at the front
        m = BABYLON.MeshBuilder.CreateCylinder('weapon', { diameter: 0.65, height: 1.2, tessellation: 18 }, scene);
        m.rotation.z = Math.PI / 2; m.position.set(0, 0.42, 1.15);
        m.material = mat('drumMat', 0.6, 0.6, 0.65, { metallic: 0.9, roughness: 0.25 });
        spin = 'x';
    }
    m.parent = root;
    m.metadata = { spinAxis: spin };
    return m;
  }

  function buildBot(stats, side, spawnPos, facing) {
    const root = new BABYLON.TransformNode('bot-' + side, scene);
    const teamColor = side === 'player' ? new BABYLON.Color3(0.15, 0.45, 0.95) : new BABYLON.Color3(0.85, 0.15, 0.1);
    const bodyMat = mat('botBody-' + side, teamColor.r, teamColor.g, teamColor.b, { metallic: 0.6, roughness: 0.45 });
    bodyMat.albedoTexture = grimeTexture(side === 'player' ? '#1c4d80' : '#7a1c14');

    const body = BABYLON.MeshBuilder.CreateBox('botMesh-' + side, { width: 1.6, height: 0.7, depth: 2.2 }, scene);
    body.position.y = 0.5; body.parent = root; body.material = bodyMat;
    const canopy = BABYLON.MeshBuilder.CreateBox('botCanopy-' + side, { width: 0.8, height: 0.4, depth: 0.9 }, scene);
    canopy.position.set(0, 0.9, -0.2); canopy.parent = root;
    canopy.material = mat('canopyMat-' + side, 0.05, 0.05, 0.06, { metallic: 0.9, roughness: 0.1 });
    const weaponMesh = buildWeaponMesh(root, stats.weaponType);
    // wheels/treads
    const wheelMat = mat('wheelMat-' + side, 0.03, 0.03, 0.03, { roughness: 0.9 });
    [[-0.85, 0.75], [0.85, 0.75], [-0.85, -0.75], [0.85, -0.75]].forEach(([x, z], i) => {
      const w = BABYLON.MeshBuilder.CreateCylinder('wheel' + side + i, { diameter: 0.5, height: 0.3 }, scene);
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.25, z); w.parent = root; w.material = wheelMat;
    });

    root.position.copyFrom(spawnPos);
    root.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, facing, 0);

    const physBody = new BABYLON.PhysicsBody(root, BABYLON.PhysicsMotionType.DYNAMIC, false, scene);
    physBody.shape = new BABYLON.PhysicsShapeBox(
      new BABYLON.Vector3(0, 0.5, 0), BABYLON.Quaternion.Identity(),
      new BABYLON.Vector3(1.7, 0.9, 2.3), scene);
    physBody.setMassProperties({ mass: 260, inertia: new BABYLON.Vector3(300, 300, 300), centerOfMass: new BABYLON.Vector3(0, 0.3, 0) });
    physBody.setLinearDamping(1.2);
    physBody.setAngularDamping(4);

    if (world.shadowGen) world.shadowGen.addShadowCaster(body);
    if (world.shadowGen) world.shadowGen.addShadowCaster(weaponMesh);

    return {
      side, root, body: physBody, weaponMesh, stats,
      hp: stats.maxHp, maxHp: stats.maxHp,
      state: 'seek', stateT: 0, cooldown: 0, knockedT: 0,
      shieldLeft: stats.specialKind === 'shield' ? 25 : 0,
      overdriveUsed: false, overdriveT: 0,
      empUsed: false, invertedT: 0,
      circleDir: side === 'player' ? 1 : -1,
      // judges' scorecard tallies — see judgeDecision()
      dmgDealt: 0, hitsLanded: 0, attacksMade: 0, controlT: 0, hazardT: 0,
      hazardSoundT: 0,
    };
  }

  function disposeBots() {
    ['player', 'enemy'].forEach(k => {
      if (B[k]) {
        B[k].body.dispose();
        B[k].root.dispose();
        delete B[k];
      }
    });
  }

  /* ============================================================
     PARTICLES
     ============================================================ */
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
    dyn.update(); dyn.hasAlpha = true;
    flareTex = dyn;
    return dyn;
  }

  function sparkBurst(pos, color, count) {
    const ps = new BABYLON.ParticleSystem('spark', count, scene);
    ps.particleTexture = getFlareTex();
    ps.emitter = pos.clone();
    ps.minEmitBox = new BABYLON.Vector3(-0.15, -0.15, -0.15);
    ps.maxEmitBox = new BABYLON.Vector3(0.15, 0.15, 0.15);
    ps.color1 = color; ps.color2 = color.scale(0.6);
    ps.colorDead = new BABYLON.Color4(0, 0, 0, 0);
    ps.minSize = 0.06; ps.maxSize = 0.3;
    ps.minLifeTime = 0.2; ps.maxLifeTime = 0.55;
    ps.emitRate = 0; ps.manualEmitCount = count;
    ps.minEmitPower = 4; ps.maxEmitPower = 10;
    ps.direction1 = new BABYLON.Vector3(-1, 0.2, -1);
    ps.direction2 = new BABYLON.Vector3(1, 1.6, 1);
    ps.gravity = new BABYLON.Vector3(0, -9, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    ps.disposeOnStop = true;
    ps.start();
    setTimeout(() => { try { ps.stop(); } catch (e) {} }, 90);
    setTimeout(() => { try { ps.dispose(); } catch (e) {} }, 1600);
  }

  function debrisChunks(pos, n) {
    for (let i = 0; i < n; i++) {
      const chunk = BABYLON.MeshBuilder.CreateBox('debris', { size: 0.12 + Math.random() * 0.14 }, scene);
      chunk.position.copyFrom(pos);
      chunk.material = mat('debrisMat', 0.2, 0.2, 0.22, { metallic: 0.7, roughness: 0.5 });
      const cb = new BABYLON.PhysicsBody(chunk, BABYLON.PhysicsMotionType.DYNAMIC, false, scene);
      cb.shape = new BABYLON.PhysicsShapeBox(BABYLON.Vector3.Zero(), BABYLON.Quaternion.Identity(),
        new BABYLON.Vector3(0.12, 0.12, 0.12), scene);
      cb.setMassProperties({ mass: 2, inertia: new BABYLON.Vector3(1, 1, 1) });
      const dir = new BABYLON.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6);
      cb.setLinearVelocity(dir);
      cb.setAngularVelocity(new BABYLON.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8));
      setTimeout(() => { try { cb.dispose(); chunk.dispose(); } catch (e) {} }, 2200);
    }
  }

  /* ============================================================
     BATTLE SIMULATION
     ============================================================ */
  function startBattle(playerStats, enemyStats, callback) {
    disposeBots();
    onDone = callback;
    /* Spawns are deliberately asymmetric — a straight line between them passes
       just clear of the pit rim. Perfectly opposed spawns put the hazard exactly
       between the bots and make both mirror each other into a stalemate. */
    B.player = buildBot(playerStats, 'player', new BABYLON.Vector3(-8, 0.3, -5), Math.PI / 2);
    B.enemy = buildBot(enemyStats, 'enemy', new BABYLON.Vector3(8, 0.3, -2), -Math.PI / 2);
    battleT = 0; slowmoT = 0; battleActive = true;
    world.camGoal = { alpha: -Math.PI / 2.3, beta: 1.05, radius: 20 };
    startCrowdAmbience();
  }

  function forward(root) {
    const q = root.rotationQuaternion;
    const f = new BABYLON.Vector3(0, 0, 1);
    return f.applyRotationQuaternion(q);
  }

  function steerToward(bot, dirTarget, dt, speedMult) {
    const fwd = forward(bot.root);
    const flatDir = new BABYLON.Vector3(dirTarget.x, 0, dirTarget.z);
    if (flatDir.lengthSquared() < 0.0001) return;
    flatDir.normalize();
    /* Babylon is left-handed: +Y rotation carries +Z toward +X, so the signed
       heading error is sin(Δ) = d.x*fwd.z - d.z*fwd.x. Getting this backwards
       makes every bot steer away from its target and spin in place forever. */
    const cross = flatDir.x * fwd.z - flatDir.z * fwd.x;
    const dot = Math.max(-1, Math.min(1, fwd.x * flatDir.x + fwd.z * flatDir.z));
    const angleDiff = Math.atan2(cross, dot);
    const turnRate = Math.max(-bot.stats.turn, Math.min(bot.stats.turn, angleDiff * 3));
    bot.body.setAngularVelocity(new BABYLON.Vector3(0, turnRate, 0));
    const facingFactor = Math.max(0.25, dot); // slow down while turning sharply, like a real chassis
    const speed = bot.stats.speed * speedMult * facingFactor * (bot.overdriveT > 0 ? 1.4 : 1);
    const vel = fwd.scale(speed);
    const cur = bot.body.getLinearVelocity();
    bot.body.setLinearVelocity(new BABYLON.Vector3(vel.x, cur.y, vel.z));
  }

  function applyDamage(attacker, defender, dmg) {
    let d = dmg;
    if (attacker.overdriveT > 0) d *= 1.4; // Overdrive Core: +40% damage while burning
    // A crusher's beak punches through plating — Shield Capacitor can't soak it.
    if (defender.shieldLeft > 0 && !attacker.stats.pierce) {
      const absorbed = Math.min(defender.shieldLeft, d);
      defender.shieldLeft -= absorbed; d -= absorbed;
    }
    defender.hp = Math.max(0, defender.hp - d);
    attacker.dmgDealt += d;
    attacker.hitsLanded++;
    if (attacker.stats.specialKind === 'emp' && !attacker.empUsed) {
      attacker.empUsed = true;
      defender.knockedT = Math.max(defender.knockedT, 1.0);
    }
    const dir = defender.root.position.subtract(attacker.root.position); dir.y = 0;
    if (dir.lengthSquared() > 0.0001) {
      dir.normalize();
      const lift = attacker.stats.flip ? 7 : attacker.stats.knockback > 10 ? 3 : 0.5;
      defender.body.setLinearVelocity(dir.scale(attacker.stats.knockback).add(new BABYLON.Vector3(0, lift, 0)));
      // A pneumatic flipper's real damage is leaving you upside-down and helpless.
      if (attacker.stats.flip) {
        defender.body.setAngularVelocity(new BABYLON.Vector3(dir.z * 9, 0, -dir.x * 9));
        const gyro = defender.stats.specialKind === 'gyro';
        defender.invertedT = gyro ? 0.7 : 2.2; // Gyro Stabilizer self-rights fast
        defender.knockedT = Math.max(defender.knockedT, defender.invertedT);
        sfxFlip();
      }
      // Horizontal spinners throw themselves back just as hard as the target.
      if (attacker.stats.recoil) {
        attacker.body.setLinearVelocity(dir.scale(-attacker.stats.knockback * 0.55));
      }
    }
    const pos = defender.root.position.add(new BABYLON.Vector3(0, 0.6, 0));
    sparkBurst(pos, WEAPON_COLORS[attacker.stats.weaponType] || WEAPON_COLORS.drum, d > 18 ? 30 : 16);
    if (d >= 18) { debrisChunks(pos, 4); pulseAberration(0.35); triggerCameraCut(); }
    sfxHit(attacker.stats.weaponType, d >= 18);
    if (!defender.hp) killFlash(defender);
  }

  function killFlash(bot) {
    const flash = new BABYLON.PointLight('kill', bot.root.position.add(new BABYLON.Vector3(0, 1, 0)), scene);
    flash.diffuse = new BABYLON.Color3(1, 0.6, 0.2); flash.intensity = 30; flash.range = 10;
    setTimeout(() => flash.dispose(), 200);
    debrisChunks(bot.root.position.add(new BABYLON.Vector3(0, 0.6, 0)), 8);
    sfxKO();
  }

  /* Blend an outward push into the desired heading when the bot is near the
     center pit, so bots arc AROUND the hazard instead of ploughing through it.
     Without this, both spawns sit on a straight line through the pit and every
     match turns into "both bots cook themselves in the middle". */
  function avoidPit(bot, desired) {
    const px = bot.root.position.x, pz = bot.root.position.z;
    const distFromCenter = Math.sqrt(px * px + pz * pz);
    const dangerZone = PIT_RADIUS + 1.3;
    if (distFromCenter > dangerZone) return desired;

    const want = desired.clone(); want.y = 0;
    if (want.lengthSquared() < 0.0001) return desired;
    want.normalize();

    const outward = new BABYLON.Vector3(px, 0, pz);
    if (outward.lengthSquared() < 0.0001) outward.set(1, 0, 0); // dead center — pick a side
    outward.normalize();

    /* Steer TANGENTIALLY around the pit, not straight back out of it. A purely
       radial push points directly against "toward the foe", so the two cancel
       and the bot just oscillates on the rim, dipping in and cooking itself.
       Pick whichever tangent still carries it closest to where it wanted to go. */
    const tanA = new BABYLON.Vector3(-outward.z, 0, outward.x);
    const tanB = new BABYLON.Vector3(outward.z, 0, -outward.x);
    const tangent = BABYLON.Vector3.Dot(tanA, want) >= BABYLON.Vector3.Dot(tanB, want) ? tanA : tanB;

    const closeness = 1 - Math.max(0, (distFromCenter - PIT_RADIUS) / (dangerZone - PIT_RADIUS));
    if (distFromCenter < PIT_RADIUS) {
      // already in the trap — get out the shortest way, hazard beats target
      return outward.scale(2.2).add(tangent.scale(0.8));
    }
    /* Pursuit must stay dominant: if the tangent outweighs it, both bots just
       orbit the pit in lockstep and the match never happens. */
    return want.scale(1.0).add(tangent.scale(0.9 * closeness)).add(outward.scale(0.35 * closeness));
  }

  function updateBotAI(bot, foe, dt) {
    if (bot.invertedT > 0) bot.invertedT -= dt;
    if (bot.knockedT > 0) { bot.knockedT -= dt; return; }
    if (bot.stats.specialKind === 'overdrive' && !bot.overdriveUsed && bot.hp / bot.maxHp < 0.3) {
      bot.overdriveUsed = true; bot.overdriveT = 5;
    }
    if (bot.overdriveT > 0) bot.overdriveT -= dt;

    const toFoe = foe.root.position.subtract(bot.root.position);
    const dist = Math.sqrt(toFoe.x * toFoe.x + toFoe.z * toFoe.z);
    const engageRange = bot.stats.range * 1.7;
    const hpFrac = bot.hp / bot.maxHp;

    if (bot.state !== 'flee' && hpFrac < 0.22 && bot.stateT > 2 && !(bot.stats.specialKind === 'overdrive' && bot.overdriveT > 0)) {
      bot.state = 'flee'; bot.stateT = 0;
    }
    bot.stateT += dt;

    if (bot.state === 'seek') {
      steerToward(bot, avoidPit(bot, toFoe), dt, 1);
      if (dist < engageRange) { bot.state = 'engage'; bot.stateT = 0; }
    } else if (bot.state === 'engage') {
      // strafe around the foe rather than driving straight through it
      const tangent = new BABYLON.Vector3(-toFoe.z, 0, toFoe.x).normalize().scale(bot.circleDir);
      const desired = toFoe.normalize().scale(0.6).add(tangent.scale(0.8));
      steerToward(bot, avoidPit(bot, desired), dt, 0.85);
      if (dist > engageRange * 1.6) { bot.state = 'seek'; bot.stateT = 0; }
      bot.controlT += dt; // holding the fight at your preferred range reads as control
      if (bot.cooldown <= 0 && dist <= bot.stats.range) {
        bot.attacksMade++;
        applyDamage(bot, foe, bot.stats.dmg);
        bot.cooldown = bot.stats.cooldown;
      }
    } else if (bot.state === 'flee') {
      steerToward(bot, avoidPit(bot, toFoe.scale(-1)), dt, 1);
      if (bot.stateT > 2.2 || dist > engageRange * 2.2) { bot.state = 'seek'; bot.stateT = 0; }
    }
    if (bot.cooldown > 0) bot.cooldown -= dt;

    // pit hazard — center of the arena is a slow, damaging trap
    const distFromCenter = Math.sqrt(bot.root.position.x ** 2 + bot.root.position.z ** 2);
    if (distFromCenter < PIT_RADIUS) {
      bot.hp = Math.max(0, bot.hp - 9 * dt);
      bot.hazardT += dt; // taking hazard damage counts against your control score
      const cur = bot.body.getLinearVelocity();
      bot.body.setLinearVelocity(cur.scale(0.4));
      // edge-triggered zap, re-armed every ~0.5s instead of firing every physics frame
      if (bot.hazardSoundT <= 0) { sfxPitHazard(); bot.hazardSoundT = 0.5; }
      else bot.hazardSoundT -= dt;
    } else if (bot.hazardSoundT > 0) {
      bot.hazardSoundT = 0;
    }
    // keep bots inside the ring — only right at the wall, so it can't fight the chase
    if (distFromCenter > ARENA_RADIUS - 1.0) {
      const inward = bot.root.position.scale(-1); inward.y = 0;
      steerToward(bot, avoidPit(bot, inward), dt, 0.6);
    }
  }

  /* Judges' decision, scored the way real robot-combat bouts are: up to
     5 points for damage, 3 for aggression, 3 for control. Each category is
     split between the two bots by their share of that category's activity. */
  function judgeDecision(a, b) {
    function split(av, bv, points) {
      const total = av + bv;
      if (total <= 0) return [points / 2, points / 2];
      const aShare = av / total;
      return [+(points * aShare).toFixed(2), +(points * (1 - aShare)).toFixed(2)];
    }
    // Damage — share of damage dealt, weighted by how much of the foe it removed.
    const [aDmg, bDmg] = split(a.dmgDealt / b.maxHp, b.dmgDealt / a.maxHp, 5);
    // Aggression — how often you actually committed to attacking.
    const [aAgg, bAgg] = split(a.attacksMade, b.attacksMade, 3);
    // Control — time dictating the engagement, minus time cooking in the pit.
    const [aCtl, bCtl] = split(Math.max(0, a.controlT - a.hazardT * 2),
                               Math.max(0, b.controlT - b.hazardT * 2), 3);
    const aTotal = aDmg + aAgg + aCtl;
    const bTotal = bDmg + bAgg + bCtl;
    return {
      player: { damage: aDmg, aggression: aAgg, control: aCtl, total: +aTotal.toFixed(2) },
      enemy: { damage: bDmg, aggression: bAgg, control: bCtl, total: +bTotal.toFixed(2) },
      winner: aTotal >= bTotal ? 'player' : 'enemy',
    };
  }

  function stepBattle(dt) {
    battleT += dt;
    updateBotAI(B.player, B.enemy, dt);
    updateBotAI(B.enemy, B.player, dt);
    spinWeapons(dt);

    const pDead = B.player.hp <= 0;
    const eDead = B.enemy.hp <= 0;
    const timeUp = battleT >= MATCH_TIME;
    if (pDead || eDead || timeUp) {
      battleActive = false;
      let win, byKo = true, scorecard = null, doubleKo = false;
      if (eDead && !pDead) win = true;
      else if (pDead && !eDead) win = false;
      else if (pDead && eDead) { win = false; doubleKo = true; } // mutual destruction — distinct result, not a plain loss
      else {
        byKo = false;                          // clock ran out — go to the judges
        scorecard = judgeDecision(B.player, B.enemy);
        win = scorecard.winner === 'player';
      }
      if (doubleKo) sfxDoubleKo();
      else if (win) sfxVictory();
      else sfxDefeat();
      slowmoT = 1.6;
      world.camGoal = { alpha: camera.alpha, beta: 0.9, radius: 9 };
      const resultHp = B.player.hp / B.player.maxHp;
      setTimeout(() => { if (onDone) onDone({ win, byKo, doubleKo, scorecard, playerHpFrac: resultHp }); }, 1500);
    }
  }

  /* Spin the spinner-class weapons so they read as live and dangerous. */
  function spinWeapons(dt) {
    ['player', 'enemy'].forEach(k => {
      const bot = B[k];
      if (!bot || !bot.weaponMesh || !bot.weaponMesh.metadata) return;
      const axis = bot.weaponMesh.metadata.spinAxis;
      if (!axis) return;
      const rate = dt * 26;
      if (axis === 'y') bot.weaponMesh.rotation.y += rate;
      else bot.weaponMesh.rotation.x += rate;
    });
  }

  /* ============================================================
     CAMERA CHOREOGRAPHY — broadcast-style cuts + slow-mo finish
     ============================================================ */
  const CAM_PRESETS = [
    { alpha: -Math.PI / 2.3, beta: 1.05, radius: 20 },
    { alpha: -Math.PI / 6, beta: 1.2, radius: 15 },
    { alpha: Math.PI / 2.5, beta: 1.35, radius: 12 },
    { alpha: Math.PI, beta: 0.95, radius: 24 },
  ];
  let camCutCooldown = 5;

  function triggerCameraCut() {
    if (camCutCooldown > 0) return;
    world.camGoal = CAM_PRESETS[Math.floor(Math.random() * CAM_PRESETS.length)];
    camCutCooldown = 3.5;
  }

  function stepCamera(dt) {
    camCutCooldown -= dt;
    if (battleActive && camCutCooldown <= 0 && Math.random() < 0.003) triggerCameraCut();
    let midX = 0, midZ = 0, midY = 1;
    if (B.player && B.enemy) {
      midX = (B.player.root.position.x + B.enemy.root.position.x) / 2;
      midZ = (B.player.root.position.z + B.enemy.root.position.z) / 2;
    }
    world.camTarget.x += (midX - world.camTarget.x) * Math.min(1, dt * 2);
    world.camTarget.z += (midZ - world.camTarget.z) * Math.min(1, dt * 2);
    camera.target.copyFrom(world.camTarget);
    const g = world.camGoal;
    camera.alpha += angleLerpDelta(camera.alpha, g.alpha, dt * 1.4);
    camera.beta += (g.beta - camera.beta) * Math.min(1, dt * 1.4);
    camera.radius += (g.radius - camera.radius) * Math.min(1, dt * 1.4);
  }

  function angleLerpDelta(cur, target, t) {
    let diff = target - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return diff * Math.min(1, t);
  }

  function resetToIdle() {
    disposeBots();
    battleActive = false;
    world.camGoal = { alpha: -Math.PI / 2, beta: 1.15, radius: 22 };
    stopCrowdAmbience();
  }

  function setPaused(p) { paused = p; }

  function getHudState() {
    if (!B.player || !B.enemy) return null;
    return {
      playerHp: B.player.hp / B.player.maxHp,
      enemyHp: B.enemy.hp / B.enemy.maxHp,
      timeLeft: Math.max(0, MATCH_TIME - battleT),
      active: battleActive,
    };
  }

  return { boot, applyQuality, startBattle, resetToIdle, setPaused, getHudState, setMuted, sfxUiClick, sfxPurchase };
})();
