/* ================================================================
   Scrapyard D-Derby Empire  —  V1 Game Logic
   ================================================================ */

// ── Strings (i18next-style swap ready) ──
const S = {
    title: 'Scrapyard D-Derby Empire',
    subtitle: 'Demolition Derby Tycoon',
    newGame: 'New Game',
    continueGame: 'Continue',
    settings: 'Settings',
    garage: 'Garage HQ',
    cash: 'Cash',
    health: 'Health',
    engine: 'Engine',
    armor: 'Armor',
    paint: 'Paint',
    upgrade: 'Upgrade',
    lvl: 'Lvl',
    startDerby: 'Start Derby',
    junkyard: 'Junkyard',
    driver: 'Driver',
    derbyArena: 'Derby Arena',
    timeLeft: 'Time',
    skip: 'Skip >>',
    youWon: 'Victory!',
    youLost: 'Defeated',
    placement: 'Placement',
    payout: 'Payout',
    backToGarage: 'Back to Garage',
    scrap: 'Scrap',
    repair: 'Repair',
    repoJob: 'Repo Job',
    repoDesc: 'Pay a fee to tow in a mystery junker',
    repoFee: 'Fee',
    emptyYard: 'The junkyard is empty. Win some derbies!',
    resume: 'Resume',
    mainMenu: 'Main Menu',
    menu: 'Menu',
    settingsStub: 'Settings coming soon...',
    back: 'Back',
    noCar: 'No usable car! Visit the junkyard.',
    scrapped: 'Scrapped for',
    repaired: 'Repaired!',
    repoGot: 'Towed in a new junker!',
    destroyed: 'WRECKED',
    selectCar: 'Select Car'
};

// ── Config ──
const UPGRADE_COSTS = [0, 200, 500, 1000, 2000];
const MAX_LEVEL = 5;
const PAINT_OPTIONS = [
    { id: 'rust',      name: 'Rust',      cost: 0,   color: '#8B4513', img: 'assets/img/livery-rust.png' },
    { id: 'primer',    name: 'Primer',    cost: 100, color: '#808080', img: 'assets/img/livery-primer.png' },
    { id: 'scratched', name: 'Scratched', cost: 150, color: '#696960', img: 'assets/img/livery-scratched.png' },
    { id: 'flame',     name: 'Flame',     cost: 300, color: '#C83214', img: 'assets/img/livery-flame.png' }
];
const DERBY_DURATION = 40;
const DERBY_PAYOUTS = [300, 150, 75, 25];
const REPO_FEE = 75;
const AI_CAR_NAMES = [
    'Iron Maiden', 'Scrap Heap', 'Dumpster Fire', 'Junkyard Dog',
    'Steel Thunder', 'Tin Can', 'Metal Masher', 'Road Rage',
    'Pile Driver', 'Crash Test', 'Fender Bender', 'Bumper Basher',
    'Rusty Nail', 'Wreck Machine'
];
const AI_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c'];

// ── State ──
let state = null;
let currentScreen = null;
let derbyEngine = null;
let derbyScene = null;
let derbyCars = [];
let derbyTimer = 0;
let derbyRunning = false;
let havokInstance = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
    initHavok();
    showScreen('menu');
    const btnContinue = document.getElementById('btn-continue');
    if (btnContinue) btnContinue.disabled = !hasSave();
});

async function initHavok() {
    try {
        if (typeof HavokPhysics === 'function') {
            havokInstance = await HavokPhysics();
        }
    } catch (e) {
        console.warn('Havok init failed:', e);
    }
}

// ── Screen Management ──
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + id);
    if (el) {
        el.classList.add('active');
        currentScreen = id;
    }
    if (id === 'garage') renderGarage();
    if (id === 'junkyard') renderJunkyard();
    if (id === 'settings') renderSettings();
}

// ── Main Menu ──
function newGame() {
    state = createNewSave();
    saveGame(state);
    showScreen('garage');
}

function continueGame() {
    state = loadGame();
    if (!state) {
        state = createNewSave();
        saveGame(state);
    }
    showScreen('garage');
}

function openSettings() {
    showScreen('settings');
}

function renderSettings() {
    // stub — screen already has static content
}

// ── Toast ──
function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => toast.classList.remove('visible'), 2000);
}

// ── Garage ──
function getActiveCar() {
    return state.cars.find(c => c.id === state.activeCar);
}

function renderGarage() {
    const container = document.getElementById('garage-content');
    const cashEl = document.getElementById('garage-cash');
    cashEl.textContent = '$' + state.cash;

    const car = getActiveCar();
    if (!car) {
        container.innerHTML = '<div class="junk-empty">' + S.noCar + '</div>';
        document.getElementById('btn-start-derby').disabled = true;
        return;
    }

    const hpPct = Math.max(0, (car.health / car.maxHealth) * 100);
    const hpClass = hpPct > 50 ? '' : hpPct > 25 ? 'damaged' : 'critical';
    const engineCost = car.engine < MAX_LEVEL ? UPGRADE_COSTS[car.engine] : null;
    const armorCost = car.armor < MAX_LEVEL ? UPGRADE_COSTS[car.armor] : null;
    const currentPaint = PAINT_OPTIONS.find(p => p.id === car.paint) || PAINT_OPTIONS[0];

    let carSelectHtml = '';
    if (state.cars.length > 1) {
        carSelectHtml = '<div class="car-select">';
        for (const c of state.cars) {
            const cls = c.id === state.activeCar ? 'car-select-btn active' : 'car-select-btn';
            const hp = c.health > 0 ? '' : ' [WRECKED]';
            carSelectHtml += `<button class="${cls}" onclick="selectCar('${c.id}')">${c.name}${hp}</button>`;
        }
        carSelectHtml += '</div>';
    }

    let paintHtml = '<div class="paint-row">';
    for (const p of PAINT_OPTIONS) {
        const sel = p.id === car.paint ? 'paint-swatch selected' : 'paint-swatch';
        const owned = p.cost === 0 || p.id === car.paint;
        const onclick = owned
            ? `setPaint('${p.id}')`
            : `buyPaint('${p.id}')`;
        const title = owned ? p.name : `${p.name} — $${p.cost}`;
        paintHtml += `<img class="${sel}" src="${p.img}" title="${title}" onclick="${onclick}">`;
    }
    paintHtml += '</div>';

    container.innerHTML = `
        ${carSelectHtml}
        <div class="car-card">
            <div class="car-card-header">
                <span class="car-name">${car.name}</span>
                <span style="color:var(--muted);font-size:12px">${S.health}: ${Math.round(car.health)}/${car.maxHealth}</span>
            </div>
            <div class="car-health-bar"><div class="car-health-fill ${hpClass}" style="width:${hpPct}%"></div></div>
            <div class="car-stats">
                <div class="stat-box">
                    <div class="stat-label">${S.engine}</div>
                    <div class="stat-value">${S.lvl} ${car.engine}</div>
                    ${engineCost !== null
                        ? `<button class="upgrade-btn" onclick="upgradeEngine()" ${state.cash < engineCost ? 'disabled' : ''}>${S.upgrade} — $${engineCost}</button>`
                        : '<button class="upgrade-btn" disabled>MAX</button>'}
                </div>
                <div class="stat-box">
                    <div class="stat-label">${S.armor}</div>
                    <div class="stat-value">${S.lvl} ${car.armor}</div>
                    ${armorCost !== null
                        ? `<button class="upgrade-btn" onclick="upgradeArmor()" ${state.cash < armorCost ? 'disabled' : ''}>${S.upgrade} — $${armorCost}</button>`
                        : '<button class="upgrade-btn" disabled>MAX</button>'}
                </div>
                <div class="stat-box">
                    <div class="stat-label">${S.paint}</div>
                    <div class="stat-value">${currentPaint.name}</div>
                </div>
            </div>
            ${paintHtml}
        </div>
        <div class="driver-card">
            <img src="assets/icons/helmet.png" alt="driver">
            <div>
                <div class="driver-name">${state.drivers[0].name}</div>
                <div class="driver-role">${S.driver}</div>
            </div>
        </div>
    `;

    document.getElementById('btn-start-derby').disabled = car.health <= 0;
}

function selectCar(id) {
    state.activeCar = id;
    saveGame(state);
    renderGarage();
}

function upgradeEngine() {
    const car = getActiveCar();
    if (!car || car.engine >= MAX_LEVEL) return;
    const cost = UPGRADE_COSTS[car.engine];
    if (state.cash < cost) return;
    state.cash -= cost;
    car.engine++;
    saveGame(state);
    renderGarage();
    showToast(`${S.engine} upgraded to ${S.lvl} ${car.engine}!`);
}

function upgradeArmor() {
    const car = getActiveCar();
    if (!car || car.armor >= MAX_LEVEL) return;
    const cost = UPGRADE_COSTS[car.armor];
    if (state.cash < cost) return;
    state.cash -= cost;
    car.armor++;
    saveGame(state);
    renderGarage();
    showToast(`${S.armor} upgraded to ${S.lvl} ${car.armor}!`);
}

function setPaint(id) {
    const car = getActiveCar();
    if (!car) return;
    car.paint = id;
    saveGame(state);
    renderGarage();
}

function buyPaint(id) {
    const car = getActiveCar();
    const p = PAINT_OPTIONS.find(o => o.id === id);
    if (!car || !p || state.cash < p.cost) return;
    state.cash -= p.cost;
    car.paint = id;
    saveGame(state);
    renderGarage();
    showToast(`${p.name} livery applied!`);
}

// ── In-Game Menu ──
function toggleIGM() {
    const overlay = document.getElementById('overlay-igm');
    overlay.classList.toggle('active');
}

function igmResume() {
    document.getElementById('overlay-igm').classList.remove('active');
}

function igmMainMenu() {
    document.getElementById('overlay-igm').classList.remove('active');
    cleanupDerby();
    showScreen('menu');
    document.getElementById('btn-continue').disabled = !hasSave();
}

// ── Derby ──
function startDerby() {
    const car = getActiveCar();
    if (!car || car.health <= 0) return;
    showScreen('derby');
    document.getElementById('overlay-results').classList.remove('active');
    initDerby();
}

async function initDerby() {
    const canvas = document.getElementById('derby-canvas');
    derbyEngine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    derbyScene = new BABYLON.Scene(derbyEngine);
    derbyScene.clearColor = new BABYLON.Color4(0.15, 0.12, 0.1, 1);

    // Physics
    if (havokInstance) {
        const havokPlugin = new BABYLON.HavokPlugin(true, havokInstance);
        derbyScene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), havokPlugin);
    } else {
        console.warn('No Havok — derby runs without physics collisions');
    }

    // Camera
    const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 3.5, 35, BABYLON.Vector3.Zero(), derbyScene);
    camera.lowerRadiusLimit = 20;
    camera.upperRadiusLimit = 50;
    camera.attachControl(canvas, false);

    // Lights
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), derbyScene);
    hemi.intensity = 0.7;
    const dir = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, 1), derbyScene);
    dir.intensity = 0.5;

    // Arena ground
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 40, height: 40 }, derbyScene);
    const groundMat = new BABYLON.StandardMaterial('groundMat', derbyScene);
    groundMat.diffuseColor = new BABYLON.Color3(0.35, 0.28, 0.2);
    groundMat.specularColor = BABYLON.Color3.Black();
    ground.material = groundMat;
    if (derbyScene.getPhysicsEngine()) {
        new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, derbyScene);
    }

    // Arena walls
    const wallPositions = [
        { x: 0, z: 20, rx: 0, ry: 0, w: 42, h: 4, d: 1 },
        { x: 0, z: -20, rx: 0, ry: 0, w: 42, h: 4, d: 1 },
        { x: 20, z: 0, rx: 0, ry: Math.PI / 2, w: 42, h: 4, d: 1 },
        { x: -20, z: 0, rx: 0, ry: Math.PI / 2, w: 42, h: 4, d: 1 }
    ];
    const wallMat = new BABYLON.StandardMaterial('wallMat', derbyScene);
    wallMat.diffuseColor = new BABYLON.Color3(0.4, 0.35, 0.3);
    wallMat.specularColor = BABYLON.Color3.Black();

    wallPositions.forEach((wp, i) => {
        const wall = BABYLON.MeshBuilder.CreateBox('wall' + i, { width: wp.w, height: wp.h, depth: wp.d }, derbyScene);
        wall.position = new BABYLON.Vector3(wp.x, 2, wp.z);
        wall.rotation.y = wp.ry;
        wall.material = wallMat;
        if (derbyScene.getPhysicsEngine()) {
            new BABYLON.PhysicsAggregate(wall, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.5, restitution: 0.4 }, derbyScene);
        }
    });

    // Debris props (small boxes scattered)
    const debrisMat = new BABYLON.StandardMaterial('debrisMat', derbyScene);
    debrisMat.diffuseColor = new BABYLON.Color3(0.3, 0.25, 0.2);
    for (let i = 0; i < 6; i++) {
        const d = BABYLON.MeshBuilder.CreateBox('debris' + i, {
            width: 0.5 + Math.random() * 1,
            height: 0.3 + Math.random() * 0.5,
            depth: 0.5 + Math.random() * 1
        }, derbyScene);
        d.position = new BABYLON.Vector3(
            (Math.random() - 0.5) * 30,
            0.2,
            (Math.random() - 0.5) * 30
        );
        d.rotation.y = Math.random() * Math.PI;
        d.material = debrisMat;
    }

    // Create cars
    derbyCars = [];
    const playerCar = getActiveCar();
    const playerPaint = PAINT_OPTIONS.find(p => p.id === playerCar.paint) || PAINT_OPTIONS[0];
    const spawns = [
        new BABYLON.Vector3(-8, 1, -8),
        new BABYLON.Vector3(8, 1, -8),
        new BABYLON.Vector3(-8, 1, 8),
        new BABYLON.Vector3(8, 1, 8)
    ];

    // Player car
    derbyCars.push(createDerbyCar(derbyScene, {
        name: playerCar.name,
        position: spawns[0],
        color: playerPaint.color,
        engine: playerCar.engine,
        armor: playerCar.armor,
        isPlayer: true,
        maxHealth: playerCar.maxHealth
    }));

    // AI cars
    const usedNames = new Set([playerCar.name]);
    for (let i = 1; i < 4; i++) {
        let name;
        do { name = AI_CAR_NAMES[Math.floor(Math.random() * AI_CAR_NAMES.length)]; } while (usedNames.has(name));
        usedNames.add(name);
        const eng = 1 + Math.floor(Math.random() * 2);
        const arm = 1 + Math.floor(Math.random() * 2);
        derbyCars.push(createDerbyCar(derbyScene, {
            name: name,
            position: spawns[i],
            color: AI_COLORS[i % AI_COLORS.length],
            engine: eng,
            armor: arm,
            isPlayer: false,
            maxHealth: 100
        }));
    }

    // HUD
    renderDerbyHUD();

    // Timer
    derbyTimer = DERBY_DURATION;
    derbyRunning = true;

    // Game loop
    derbyScene.registerBeforeRender(() => {
        if (!derbyRunning) return;
        const dt = derbyEngine.getDeltaTime() / 1000;
        derbyTimer -= dt;
        updateDerbyTimer();

        // AI movement
        const alive = derbyCars.filter(c => c.health > 0);
        for (const car of alive) {
            updateCarAI(car, alive, dt);
        }

        // Collision damage
        checkCollisionDamage(alive, dt);

        // Update HUD
        updateDerbyHUD();

        // Check end conditions
        if (alive.length <= 1 || derbyTimer <= 0) {
            endDerby();
        }
    });

    // Camera auto-rotate
    derbyScene.registerAfterRender(() => {
        if (derbyRunning) {
            camera.alpha += 0.001;
        }
    });

    derbyEngine.runRenderLoop(() => {
        if (derbyScene) derbyScene.render();
    });

    window.addEventListener('resize', () => {
        if (derbyEngine) derbyEngine.resize();
    });
}

function createDerbyCar(scene, opts) {
    const mesh = BABYLON.MeshBuilder.CreateBox(opts.name, { width: 2, height: 0.8, depth: 3 }, scene);
    mesh.position = opts.position.clone();
    const mat = new BABYLON.StandardMaterial(opts.name + 'Mat', scene);
    mat.diffuseColor = BABYLON.Color3.FromHexString(opts.color);
    mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    mesh.material = mat;

    let aggregate = null;
    if (scene.getPhysicsEngine()) {
        aggregate = new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.BOX, {
            mass: 800 + opts.engine * 100,
            friction: 0.6,
            restitution: 0.35
        }, scene);
        aggregate.body.setAngularDamping(3);
        aggregate.body.setLinearDamping(0.3);
    }

    return {
        mesh,
        aggregate,
        name: opts.name,
        isPlayer: opts.isPlayer,
        engine: opts.engine,
        armor: opts.armor,
        health: opts.maxHealth,
        maxHealth: opts.maxHealth,
        color: opts.color,
        totalDamageDealt: 0,
        damageCooldown: 0,
        aiTarget: null,
        aiTimer: 0,
        velocity: new BABYLON.Vector3(0, 0, 0)
    };
}

function updateCarAI(car, aliveCars, dt) {
    car.aiTimer -= dt;
    if (car.aiTimer <= 0 || !car.aiTarget || car.aiTarget.health <= 0) {
        // Pick new target
        let nearest = null;
        let minDist = Infinity;
        for (const other of aliveCars) {
            if (other === car) continue;
            const dist = BABYLON.Vector3.Distance(car.mesh.position, other.mesh.position);
            if (dist < minDist) {
                minDist = dist;
                nearest = other;
            }
        }
        car.aiTarget = nearest;
        car.aiTimer = 1.5 + Math.random() * 2;
    }

    if (!car.aiTarget) return;

    const dir = car.aiTarget.mesh.position.subtract(car.mesh.position);
    dir.y = 0;
    if (dir.length() < 0.01) return;
    dir.normalize();

    // Add some randomness
    dir.x += (Math.random() - 0.5) * 0.3;
    dir.z += (Math.random() - 0.5) * 0.3;
    dir.normalize();

    const forceMag = (500 + car.engine * 200);

    if (car.aggregate) {
        const force = dir.scale(forceMag);
        car.aggregate.body.applyForce(force, car.mesh.getAbsolutePosition());

        // Clamp speed
        const vel = car.aggregate.body.getLinearVelocity();
        const maxSpeed = 4 + car.engine * 1.5;
        const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        if (speed > maxSpeed) {
            const ratio = maxSpeed / speed;
            car.aggregate.body.setLinearVelocity(new BABYLON.Vector3(vel.x * ratio, vel.y, vel.z * ratio));
        }
    } else {
        // Fallback: direct position movement
        const speed = (2 + car.engine) * dt;
        car.mesh.position.addInPlace(dir.scale(speed));
        // Clamp to arena
        car.mesh.position.x = Math.max(-18, Math.min(18, car.mesh.position.x));
        car.mesh.position.z = Math.max(-18, Math.min(18, car.mesh.position.z));
    }
}

function checkCollisionDamage(aliveCars, dt) {
    for (const car of aliveCars) {
        if (car.damageCooldown > 0) car.damageCooldown -= dt;
    }

    for (let i = 0; i < aliveCars.length; i++) {
        for (let j = i + 1; j < aliveCars.length; j++) {
            const a = aliveCars[i], b = aliveCars[j];
            const dist = BABYLON.Vector3.Distance(a.mesh.position, b.mesh.position);
            if (dist > 3.5) continue;

            if (a.damageCooldown > 0 && b.damageCooldown > 0) continue;

            let relSpeed = 3;
            if (a.aggregate && b.aggregate) {
                const va = a.aggregate.body.getLinearVelocity();
                const vb = b.aggregate.body.getLinearVelocity();
                relSpeed = Math.sqrt(
                    (va.x - vb.x) ** 2 + (va.y - vb.y) ** 2 + (va.z - vb.z) ** 2
                );
            }

            if (relSpeed < 1.5) continue;

            const baseDmg = relSpeed * 2.5;
            const dmgToA = Math.max(1, baseDmg * (1 - (b.armor - 1) * 0.1));
            const dmgToB = Math.max(1, baseDmg * (1 - (a.armor - 1) * 0.1));

            a.health = Math.max(0, a.health - dmgToA);
            b.health = Math.max(0, b.health - dmgToB);
            a.totalDamageDealt += dmgToB;
            b.totalDamageDealt += dmgToA;

            a.damageCooldown = 0.5;
            b.damageCooldown = 0.5;

            // Visual feedback — flash
            flashCar(a);
            flashCar(b);

            // Handle destroyed
            if (a.health <= 0) destroyCar(a);
            if (b.health <= 0) destroyCar(b);
        }
    }
}

function flashCar(car) {
    if (!car.mesh.material) return;
    const orig = car.mesh.material.emissiveColor.clone();
    car.mesh.material.emissiveColor = new BABYLON.Color3(1, 0.5, 0);
    setTimeout(() => {
        if (car.mesh.material) car.mesh.material.emissiveColor = orig;
    }, 150);
}

function destroyCar(car) {
    if (car.mesh.material) {
        car.mesh.material.diffuseColor = new BABYLON.Color3(0.15, 0.12, 0.1);
        car.mesh.material.emissiveColor = BABYLON.Color3.Black();
    }
    if (car.aggregate) {
        car.aggregate.body.setLinearVelocity(BABYLON.Vector3.Zero());
        car.aggregate.body.setAngularVelocity(BABYLON.Vector3.Zero());
    }
}

function renderDerbyHUD() {
    const barsEl = document.getElementById('derby-health-bars');
    barsEl.innerHTML = '';
    for (const car of derbyCars) {
        const div = document.createElement('div');
        div.className = 'derby-car-hp' + (car.isPlayer ? ' player' : '');
        div.id = 'hp-' + car.name.replace(/\s/g, '-');
        div.innerHTML = `
            <div class="derby-car-name ${car.isPlayer ? 'player-name' : ''}">${car.isPlayer ? '★ ' : ''}${car.name}</div>
            <div class="derby-hp-track"><div class="derby-hp-fill" style="width:100%;background:${car.color}"></div></div>
        `;
        barsEl.appendChild(div);
    }
}

function updateDerbyHUD() {
    for (const car of derbyCars) {
        const el = document.getElementById('hp-' + car.name.replace(/\s/g, '-'));
        if (!el) continue;
        const pct = Math.max(0, (car.health / car.maxHealth) * 100);
        const fill = el.querySelector('.derby-hp-fill');
        if (fill) fill.style.width = pct + '%';
        if (car.health <= 0 && !el.classList.contains('destroyed')) {
            el.classList.add('destroyed');
        }
    }
}

function updateDerbyTimer() {
    const el = document.getElementById('derby-timer');
    if (el) el.textContent = S.timeLeft + ': ' + Math.max(0, Math.ceil(derbyTimer)) + 's';
}

function skipDerby() {
    if (derbyRunning) endDerby();
}

function endDerby() {
    derbyRunning = false;

    // Rank by: alive first, then by health, then by damage dealt
    const ranked = [...derbyCars].sort((a, b) => {
        if (a.health > 0 && b.health <= 0) return -1;
        if (a.health <= 0 && b.health > 0) return 1;
        if (a.health !== b.health) return b.health - a.health;
        return b.totalDamageDealt - a.totalDamageDealt;
    });

    const playerIdx = ranked.findIndex(c => c.isPlayer);
    const placement = playerIdx + 1;
    const payout = DERBY_PAYOUTS[playerIdx] || 0;

    // Apply payout
    state.cash += payout;
    state.stats.totalEarnings += payout;
    state.stats.derbiesPlayed++;
    if (placement === 1) state.stats.derbiesWon++;

    // Damage player car
    const playerDerby = derbyCars.find(c => c.isPlayer);
    const playerCar = getActiveCar();
    if (playerCar && playerDerby) {
        playerCar.health = Math.max(0, playerDerby.health);
    }

    // Add wrecked AI cars to junkyard
    for (const dc of derbyCars) {
        if (dc.isPlayer) continue;
        if (dc.health <= 0) {
            state.junkyardCars.push({
                id: 'junk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: dc.name,
                engine: dc.engine,
                armor: dc.armor,
                paint: 'rust',
                health: 0,
                maxHealth: 100,
                scrapValue: 50 + Math.floor(Math.random() * 100),
                repairCost: 100 + Math.floor(Math.random() * 200)
            });
        }
    }

    // Random repo availability
    state.repoAvailable = Math.random() < 0.5;

    saveGame(state);

    // Show results
    const overlay = document.getElementById('overlay-results');
    const titleEl = document.getElementById('results-title');
    const placementEl = document.getElementById('results-placement');
    const tableEl = document.getElementById('results-table');
    const payoutEl = document.getElementById('results-payout');

    titleEl.textContent = placement === 1 ? S.youWon : S.youLost;
    titleEl.className = 'results-title ' + (placement === 1 ? 'win' : 'lose');
    placementEl.textContent = S.placement + ': #' + placement;
    payoutEl.textContent = S.payout + ': $' + payout;

    tableEl.innerHTML = '';
    ranked.forEach((c, i) => {
        const row = document.createElement('div');
        row.className = 'results-row' + (c.isPlayer ? ' player' : '');
        row.innerHTML = `<span>#${i + 1} ${c.name}</span><span>${c.health > 0 ? Math.round(c.health) + ' HP' : S.destroyed}</span>`;
        tableEl.appendChild(row);
    });

    overlay.classList.add('active');
}

function derbyBackToGarage() {
    document.getElementById('overlay-results').classList.remove('active');
    cleanupDerby();
    showScreen('garage');
}

function cleanupDerby() {
    derbyRunning = false;
    if (derbyEngine) {
        derbyEngine.stopRenderLoop();
        derbyEngine.dispose();
        derbyEngine = null;
    }
    derbyScene = null;
    derbyCars = [];
}

// ── Junkyard ──
function renderJunkyard() {
    const container = document.getElementById('junkyard-content');
    const cashEl = document.getElementById('junkyard-cash');
    cashEl.textContent = '$' + state.cash;

    let html = '';

    if (state.junkyardCars.length === 0 && !state.repoAvailable) {
        html = '<div class="junk-empty">' + S.emptyYard + '</div>';
    }

    for (const jc of state.junkyardCars) {
        html += `
        <div class="junk-car">
            <div class="junk-car-info">
                <div class="junk-car-name">${jc.name}</div>
                <div class="junk-car-detail">${S.engine} ${S.lvl} ${jc.engine} · ${S.armor} ${S.lvl} ${jc.armor}</div>
            </div>
            <div class="junk-actions">
                <button class="junk-btn scrap" onclick="scrapCar('${jc.id}')">${S.scrap} ($${jc.scrapValue})</button>
                <button class="junk-btn repair" onclick="repairCar('${jc.id}')" ${state.cash < jc.repairCost ? 'disabled' : ''}>${S.repair} ($${jc.repairCost})</button>
            </div>
        </div>`;
    }

    if (state.repoAvailable) {
        html += `
        <div class="repo-card">
            <div class="repo-title">${S.repoJob}</div>
            <div class="repo-desc">${S.repoDesc} · ${S.repoFee}: $${REPO_FEE}</div>
            <button class="repo-btn" onclick="doRepoJob()" ${state.cash < REPO_FEE ? 'disabled' : ''}>${S.repoJob} — $${REPO_FEE}</button>
        </div>`;
    }

    container.innerHTML = html;
}

function scrapCar(id) {
    const idx = state.junkyardCars.findIndex(c => c.id === id);
    if (idx === -1) return;
    const jc = state.junkyardCars[idx];
    state.cash += jc.scrapValue;
    state.stats.carsScraped++;
    state.junkyardCars.splice(idx, 1);
    saveGame(state);
    renderJunkyard();
    showToast(S.scrapped + ' $' + jc.scrapValue + '!');
}

function repairCar(id) {
    const idx = state.junkyardCars.findIndex(c => c.id === id);
    if (idx === -1) return;
    const jc = state.junkyardCars[idx];
    if (state.cash < jc.repairCost) return;
    state.cash -= jc.repairCost;
    state.stats.carsRepaired++;

    state.cars.push({
        id: jc.id,
        name: jc.name,
        engine: jc.engine,
        armor: jc.armor,
        paint: jc.paint || 'rust',
        health: jc.maxHealth,
        maxHealth: jc.maxHealth
    });

    state.junkyardCars.splice(idx, 1);
    saveGame(state);
    renderJunkyard();
    showToast(S.repaired);
}

function doRepoJob() {
    if (state.cash < REPO_FEE || !state.repoAvailable) return;
    state.cash -= REPO_FEE;
    state.repoAvailable = false;

    const name = AI_CAR_NAMES[Math.floor(Math.random() * AI_CAR_NAMES.length)];
    state.junkyardCars.push({
        id: 'repo_' + Date.now(),
        name: name,
        engine: 1,
        armor: 1,
        paint: 'rust',
        health: 0,
        maxHealth: 100,
        scrapValue: 30 + Math.floor(Math.random() * 70),
        repairCost: 80 + Math.floor(Math.random() * 150)
    });

    saveGame(state);
    renderJunkyard();
    showToast(S.repoGot);
}
