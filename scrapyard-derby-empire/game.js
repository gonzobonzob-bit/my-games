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
    repoDesc: 'Free tow — mystery junker for the yard',
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
    selectCar: 'Select Car',
    slot: 'Slot',
    empty: 'Empty',
    derbies: 'Derbies',
    cars: 'Cars',
    deleteSlot: 'Delete',
    confirmDelete: 'Delete this save?',
    drivers: 'Drivers',
    skill: 'Skill',
    unassigned: 'Unassigned',
    assign: 'Assign',
    unassign: 'Unassign',
    hireDriver: 'Hire Driver',
    hired: 'Hired',
    walkIns: 'Walk-ins',
    walkInTap: 'Tap to reveal',
    walkInEmpty: 'No walk-ins right now. Win a derby!',
    walkInHire: 'Hire',
    walkInPass: 'Pass',
    walkInMystery: '?',
    assignedTo: 'Assigned to',
    notEnoughCash: 'Not enough cash!',
    alreadyAssigned: 'Car already has a driver',
    driverAssigned: 'Driver assigned!',
    driverUnassigned: 'Driver unassigned',
    carCount: 'cars',
    season: 'Season',
    seasonProgress: '{current}/{target} wins',
    seasonComplete: 'Season Complete!',
    seasonCompleteMsg: 'You conquered Season {season}!',
    prestige: 'Prestige',
    prestigeDesc: 'Reset your empire for a permanent {mult}x earnings multiplier. New target: {target} wins.',
    prestigeMultLabel: '{mult}x',
    payoutMultLabel: '({mult}x)',
    lineup: 'Derby Lineup',
    lineupDesc: 'Select team entries (up to {max})',
    lineupNoCar: 'No car',
    lineupWrecked: 'Wrecked',
    lineupEnter: 'Enter Derby',
    lineupBack: 'Back to Garage',
    lineupSlots: '{team} team + {ai} AI',
    teamPayout: 'Team Payout',
    teamResults: 'Your Team',
    dmgDealt: 'Dmg',
    repairFleet: 'Repair',
    fullHealth: 'Full HP',
    fireDriver: 'Fire',
    fireConfirm: 'Confirm?',
    fastForward: '2x',
    partsShop: 'Parts Shop',
    newPart: 'New',
    usedPart: 'Used',
    quality: 'Quality',
    install: 'Install',
    usedPartsInv: 'Used Parts',
    noUsedParts: 'No used parts. Scrap junkyard cars!',
    usedPartFound: 'Found a used part!',
    partInstalled: 'Part installed!',
    privateSeller: 'Private Seller',
    privateSellerDesc: 'Selling a car — needs work',
    buyFromSeller: 'Buy',
    sellerBought: 'Car bought!'
};

// ── Config ──
const UPGRADE_COSTS = [0, 200, 500, 1000, 2000];
const MAX_LEVEL = 5;
const PAINT_OPTIONS = [
    { id: 'rust',      name: 'Rust',      cost: 0, color: '#8B4513', img: 'assets/img/livery-rust.png' },
    { id: 'primer',    name: 'Primer',    cost: 0, color: '#808080', img: 'assets/img/livery-primer.png' },
    { id: 'scratched', name: 'Scratched', cost: 0, color: '#696960', img: 'assets/img/livery-scratched.png' },
    { id: 'flame',     name: 'Flame',     cost: 0, color: '#C83214', img: 'assets/img/livery-flame.png' }
];
const DERBY_DURATION = 45;
const DERBY_TOTAL_CARS = 8;
const MAX_TEAM_ENTRIES = 3;
const DERBY_PAYOUTS = [500, 350, 250, 175, 100, 60, 30, 10];
const USED_PART_CHANCE = 0.5;
const USED_QUALITY_MIN = 0.65;
const USED_QUALITY_MAX = 0.75;
const PRIVATE_SELLER_CHANCE = 0.3;
const AI_CAR_NAMES = [
    'Iron Maiden', 'Scrap Heap', 'Dumpster Fire', 'Junkyard Dog',
    'Steel Thunder', 'Tin Can', 'Metal Masher', 'Road Rage',
    'Pile Driver', 'Crash Test', 'Fender Bender', 'Bumper Basher',
    'Rusty Nail', 'Wreck Machine'
];
const AI_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c'];
const DRIVER_NAMES = [
    'Mad Max', 'Turbo Tina', 'Diesel Dan', 'Wrench Wendy',
    'Nitro Nick', 'Axle Rose', 'Chrome Charlie', 'Burnout Betty',
    'Torque Tony', 'Skid Sally', 'Piston Pete', 'Fumes Fiona'
];
const HIRE_DRIVER_COSTS = [150, 300, 600, 1200];

// ── Sound (Web Audio synthesis — no external files) ──
let audioCtx = null;
let sfxEnabled = true;
let lastCrashTime = 0;

function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function sfxCrash() {
    if (!sfxEnabled) return;
    const now = performance.now();
    if (now - lastCrashTime < 300) return;
    lastCrashTime = now;
    const ctx = ensureAudioCtx();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 1.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    src.connect(bp).connect(gain).connect(ctx.destination);
    src.start(); src.stop(ctx.currentTime + 0.15);
}

function sfxUpgrade() {
    if (!sfxEnabled) return;
    const ctx = ensureAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.25);
}

function sfxScrap() {
    if (!sfxEnabled) return;
    const ctx = ensureAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.12);
}

function sfxEngine() {
    if (!sfxEnabled) return;
    const ctx = ensureAudioCtx();
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = 55;
    lfo.type = 'sine'; lfo.frequency.value = 6;
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); lfo.start(); osc.stop(ctx.currentTime + 0.5); lfo.stop(ctx.currentTime + 0.5);
}

function sfxWin() {
    if (!sfxEnabled) return;
    const ctx = ensureAudioCtx();
    [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.12); osc.stop(ctx.currentTime + i * 0.12 + 0.2);
    });
}

function sfxLose() {
    if (!sfxEnabled) return;
    const ctx = ensureAudioCtx();
    [400, 280].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.2 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.2); osc.stop(ctx.currentTime + i * 0.2 + 0.3);
    });
}

// ── State ──
let state = null;
let currentScreen = null;
let derbyEngine = null;
let derbyScene = null;
let derbyCars = [];
let derbyTimer = 0;
let derbyRunning = false;
let havokInstance = null;
let derbyTimeScale = 1;
let derbySlowMoTimer = 0;
let derbyFastForward = false;
let lastImpactPos = null;
let lastImpactTime = 0;

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
    initHavok();
    showScreen('menu');
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
    if (id === 'menu') renderMainMenu();
    if (id === 'garage') renderGarage();
    if (id === 'shop') renderPartsShop();
    if (id === 'lineup') renderLineup();
    if (id === 'junkyard') renderJunkyard();
    if (id === 'settings') renderSettings();
}

// ── Main Menu ──
function renderMainMenu() {
    const container = document.getElementById('menu-slots');
    if (!container) return;
    let html = '';
    for (let i = 0; i < SLOT_COUNT; i++) {
        const summary = getSlotSummary(i);
        if (summary) {
            html += `
            <div class="slot-card">
                <div class="slot-header">${S.slot} ${i + 1}</div>
                <div class="slot-summary">$${summary.cash} · ${summary.derbiesPlayed} ${S.derbies} · ${summary.carsOwned} ${S.cars}</div>
                <div class="slot-actions">
                    <button class="menu-btn primary" onclick="slotContinue(${i})">${S.continueGame}</button>
                    <button class="menu-btn slot-delete" onclick="slotDelete(${i})">${S.deleteSlot}</button>
                </div>
            </div>`;
        } else {
            html += `
            <div class="slot-card">
                <div class="slot-header">${S.slot} ${i + 1}</div>
                <div class="slot-empty-label">${S.empty}</div>
                <div class="slot-actions">
                    <button class="menu-btn primary" onclick="slotNewGame(${i})">${S.newGame}</button>
                </div>
            </div>`;
        }
    }
    container.innerHTML = html;
}

function slotNewGame(index) {
    activeSlot = index;
    state = createNewSave();
    generateWalkIns();
    saveGame(state);
    showScreen('garage');
}

function slotContinue(index) {
    activeSlot = index;
    state = loadSlot(index);
    if (!state) {
        state = createNewSave();
        saveGame(state);
    }
    showScreen('garage');
}

function slotDelete(index) {
    if (!confirm(S.confirmDelete)) return;
    deleteSlotData(index);
    renderMainMenu();
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
    if (!state) return;
    const container = document.getElementById('garage-content');
    const cashEl = document.getElementById('garage-cash');
    cashEl.textContent = '$' + state.cash;

    // Update season bar
    updateSeasonBar();

    // Update car count indicator
    const healthyCount = state.cars.filter(c => c.health > 0).length;
    const carCountEl = document.getElementById('garage-car-count');
    if (carCountEl) carCountEl.textContent = healthyCount + ' ' + S.carCount;

    // Auto-select first healthy car if active car is wrecked (only if a healthy option exists)
    const activeCar = getActiveCar();
    if (activeCar && activeCar.health <= 0) {
        const firstHealthy = state.cars.find(c => c.health > 0);
        if (firstHealthy) {
            state.activeCar = firstHealthy.id;
            saveGame(state);
        }
    }

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
            const wrecked = c.health <= 0;
            const hp = wrecked ? ' [WRECKED]' : '';
            const dis = wrecked ? ' disabled' : '';
            carSelectHtml += `<button class="${cls}" onclick="selectCar('${c.id}')"${dis}>${c.name}${hp}</button>`;
        }
        carSelectHtml += '</div>';
    }

    let paintHtml = '<div class="paint-row">';
    for (const p of PAINT_OPTIONS) {
        const sel = p.id === car.paint ? 'paint-swatch selected' : 'paint-swatch';
        paintHtml += `<img class="${sel}" src="${p.img}" title="${p.name}" onclick="setPaint('${p.id}')">`;
    }
    paintHtml += '</div>';

    // Build drivers roster HTML
    const currentDriver = state.drivers.find(d => d.assignedCar === car.id);
    const hireCostIdx = Math.min(state.drivers.length - 1, HIRE_DRIVER_COSTS.length - 1);
    const hireCost = HIRE_DRIVER_COSTS[hireCostIdx];
    let driversHtml = '<div class="drivers-section">' +
        '<div class="drivers-section-title">' + S.drivers + '</div>';
    for (const d of state.drivers) {
        const assignedCarObj = d.assignedCar ? state.cars.find(c => c.id === d.assignedCar) : null;
        const assignedLabel = assignedCarObj ? S.assignedTo + ': ' + assignedCarObj.name : S.unassigned;
        const isAssignedHere = d.assignedCar === car.id;
        let actionBtn = '';
        if (isAssignedHere) {
            actionBtn = '<button class="driver-action-btn unassign" onclick="unassignDriver(\'' + d.id + '\')">' + S.unassign + '</button>';
        } else if (!currentDriver) {
            actionBtn = '<button class="driver-action-btn assign" onclick="assignDriver(\'' + d.id + '\')">' + S.assign + '</button>';
        }
        const fireBtn = state.drivers.length > 1
            ? '<button class="driver-action-btn fire" onclick="fireDriver(\'' + d.id + '\', this)">' + S.fireDriver + '</button>'
            : '';
        const skillDots = '★'.repeat(d.skill) + '☆'.repeat(5 - d.skill);
        driversHtml += '<div class="driver-roster-card' + (isAssignedHere ? ' active-driver' : '') + '">' +
            '<img src="assets/icons/helmet.png" alt="driver">' +
            '<div class="driver-roster-info">' +
                '<div class="driver-name">' + d.name + '</div>' +
                '<div class="driver-skill">' + S.skill + ': ' + skillDots + '</div>' +
                '<div class="driver-role">' + assignedLabel + '</div>' +
            '</div>' +
            '<div class="driver-actions">' + actionBtn + fireBtn + '</div>' +
        '</div>';
    }
    // Walk-in cards
    if (state.walkIns && state.walkIns.length > 0) {
        driversHtml += '<div class="walkin-title">' + S.walkIns + '</div>';
        driversHtml += '<div class="walkin-row">';
        state.walkIns.forEach((wi, idx) => {
            if (wi.revealed) {
                const skillDots = '★'.repeat(wi.skill) + '☆'.repeat(5 - wi.skill);
                driversHtml += '<div class="walkin-card flipped">' +
                    '<div class="walkin-card-inner">' +
                        '<div class="walkin-card-back"><span>' + S.walkInMystery + '</span></div>' +
                        '<div class="walkin-card-front">' +
                            '<div class="walkin-front-info">' +
                                '<div class="walkin-front-name">' + wi.name + '</div>' +
                                '<div class="walkin-front-skill">' + skillDots + '</div>' +
                                '<div class="walkin-front-cost">$' + wi.cost + '</div>' +
                            '</div>' +
                            '<div class="walkin-front-actions">' +
                                '<button class="walkin-btn hire" onclick="hireWalkIn(' + idx + ')" ' +
                                    (state.cash < wi.cost ? 'disabled' : '') + '>' + S.walkInHire + '</button>' +
                                '<button class="walkin-btn pass" onclick="passWalkIn(' + idx + ')">' + S.walkInPass + '</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            } else {
                driversHtml += '<div class="walkin-card" onclick="revealWalkIn(' + idx + ')">' +
                    '<div class="walkin-card-inner">' +
                        '<div class="walkin-card-back"><span>' + S.walkInMystery + '</span><div class="walkin-tap">' + S.walkInTap + '</div></div>' +
                        '<div class="walkin-card-front"></div>' +
                    '</div>' +
                '</div>';
            }
        });
        driversHtml += '</div>';
    } else {
        driversHtml += '<div class="walkin-empty">' + S.walkInEmpty + '</div>';
    }
    driversHtml += '</div>';

    container.innerHTML = `
        ${carSelectHtml}
        <div class="car-card">
            <div class="car-card-header">
                <span class="car-name">${car.name}</span>
                <span style="color:var(--muted);font-size:12px">${S.health}: ${Math.round(car.health)}/${car.maxHealth}</span>
            </div>
            <div class="car-health-bar"><div class="car-health-fill ${hpClass}" style="width:${hpPct}%"></div></div>
            ${car.health < car.maxHealth ? (() => {
                const missing = car.maxHealth - car.health;
                const repCost = Math.ceil(missing * 2);
                return `<button class="upgrade-btn repair-fleet-btn" onclick="repairFleetCar()" ${state.cash < repCost ? 'disabled' : ''}>${S.repairFleet} — $${repCost}</button>`;
            })() : `<div class="repair-full">${S.fullHealth}</div>`}
            <div class="car-stats">
                <div class="stat-box">
                    <div class="stat-label">${S.engine}</div>
                    <div class="stat-value">${S.lvl} ${car.engine}</div>
                    ${(car.engineQuality || 1) < 1 ? `<div class="stat-quality">${Math.round((car.engineQuality || 1) * 100)}%</div>` : ''}
                </div>
                <div class="stat-box">
                    <div class="stat-label">${S.armor}</div>
                    <div class="stat-value">${S.lvl} ${car.armor}</div>
                    ${(car.armorQuality || 1) < 1 ? `<div class="stat-quality">${Math.round((car.armorQuality || 1) * 100)}%</div>` : ''}
                </div>
                <div class="stat-box">
                    <div class="stat-label">${S.paint}</div>
                    <div class="stat-value">${currentPaint.name}</div>
                </div>
            </div>
            ${paintHtml}
        </div>
        ${renderUsedPartsHtml(car)}
        ${driversHtml}
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
    sfxUpgrade();
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
    sfxUpgrade();
}

function repairFleetCar() {
    const car = getActiveCar();
    if (!car || car.health >= car.maxHealth) return;
    const cost = Math.ceil((car.maxHealth - car.health) * 2);
    if (state.cash < cost) return;
    state.cash -= cost;
    car.health = car.maxHealth;
    saveGame(state);
    renderGarage();
    showToast(S.repairFleet + ': ' + car.name + '!');
    sfxUpgrade();
}

// ── Parts Shop ──
function renderPartsShop() {
    if (!state) return;
    const container = document.getElementById('shop-content');
    const cashEl = document.getElementById('shop-cash');
    cashEl.textContent = '$' + state.cash;

    let html = '';
    for (const car of state.cars) {
        const engCost = car.engine < MAX_LEVEL ? UPGRADE_COSTS[car.engine] : null;
        const armCost = car.armor < MAX_LEVEL ? UPGRADE_COSTS[car.armor] : null;
        html += `<div class="shop-car-card">
            <div class="shop-car-name">${car.name}</div>
            <div class="shop-row">
                <span>${S.engine} ${S.lvl} ${car.engine}</span>
                ${engCost !== null
                    ? `<button class="upgrade-btn" onclick="shopUpgrade('${car.id}','engine')" ${state.cash < engCost ? 'disabled' : ''}>${S.newPart} — $${engCost}</button>`
                    : '<button class="upgrade-btn" disabled>MAX</button>'}
            </div>
            <div class="shop-row">
                <span>${S.armor} ${S.lvl} ${car.armor}</span>
                ${armCost !== null
                    ? `<button class="upgrade-btn" onclick="shopUpgrade('${car.id}','armor')" ${state.cash < armCost ? 'disabled' : ''}>${S.newPart} — $${armCost}</button>`
                    : '<button class="upgrade-btn" disabled>MAX</button>'}
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

function shopUpgrade(carId, type) {
    const car = state.cars.find(c => c.id === carId);
    if (!car) return;
    const lvl = type === 'engine' ? car.engine : car.armor;
    if (lvl >= MAX_LEVEL) return;
    const cost = UPGRADE_COSTS[lvl];
    if (state.cash < cost) return;
    state.cash -= cost;
    if (type === 'engine') { car.engine++; car.engineQuality = 1.0; }
    else { car.armor++; car.armorQuality = 1.0; }
    saveGame(state);
    renderPartsShop();
    showToast(`${type === 'engine' ? S.engine : S.armor} ${S.lvl} ${type === 'engine' ? car.engine : car.armor}!`);
    sfxUpgrade();
}

// ── Used Parts ──
function renderUsedPartsHtml(car) {
    if (!state.usedParts || state.usedParts.length === 0) return '';
    let html = '<div class="used-parts-section"><div class="drivers-section-title">' + S.usedPartsInv + '</div>';
    state.usedParts.forEach((p, idx) => {
        const label = p.type === 'engine' ? S.engine : S.armor;
        const qPct = Math.round(p.quality * 100);
        const curLvl = p.type === 'engine' ? car.engine : car.armor;
        const canInstall = curLvl < MAX_LEVEL;
        html += `<div class="used-part-item">
            <span>${label} +1 <span class="stat-quality">(${qPct}%)</span></span>
            <button class="upgrade-btn used-part-btn" onclick="installUsedPart(${idx})" ${canInstall ? '' : 'disabled'}>${S.install}</button>
        </div>`;
    });
    return html + '</div>';
}

function installUsedPart(idx) {
    const part = state.usedParts[idx];
    if (!part) return;
    const car = getActiveCar();
    if (!car) return;
    const curLvl = part.type === 'engine' ? car.engine : car.armor;
    if (curLvl >= MAX_LEVEL) return;
    if (part.type === 'engine') { car.engine++; car.engineQuality = part.quality; }
    else { car.armor++; car.armorQuality = part.quality; }
    state.usedParts.splice(idx, 1);
    saveGame(state);
    renderGarage();
    showToast(S.partInstalled);
    sfxUpgrade();
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

// ── Driver Management ──
function generateWalkIns() {
    const usedNames = new Set(state.drivers.map(d => d.name));
    const wiNames = state.walkIns ? state.walkIns.map(w => w.name) : [];
    usedNames.forEach(n => wiNames.push(n));
    const pool = DRIVER_NAMES.filter(n => !usedNames.has(n));
    if (pool.length === 0) { state.walkIns = []; return; }
    const count = Math.min(2 + (Math.random() < 0.4 ? 1 : 0), pool.length);
    const picks = [];
    const used = new Set();
    for (let i = 0; i < count; i++) {
        const avail = pool.filter(n => !used.has(n));
        if (avail.length === 0) break;
        const name = avail[Math.floor(Math.random() * avail.length)];
        used.add(name);
        const roll = Math.random();
        const skill = roll < 0.55 ? 1 : roll < 0.85 ? 2 : 3;
        const cost = [0, 150, 350, 600][skill] + Math.floor(Math.random() * 100);
        picks.push({ name, skill, cost, revealed: false });
    }
    state.walkIns = picks;
}

function revealWalkIn(idx) {
    if (!state.walkIns || !state.walkIns[idx]) return;
    state.walkIns[idx].revealed = true;
    saveGame(state);
    renderGarage();
    sfxUpgrade();
}

function hireWalkIn(idx) {
    const wi = state.walkIns[idx];
    if (!wi || state.cash < wi.cost) { showToast(S.notEnoughCash); return; }
    state.cash -= wi.cost;
    state.drivers.push({
        id: 'driver_' + Date.now(),
        name: wi.name,
        skill: wi.skill,
        assignedCar: null
    });
    state.walkIns.splice(idx, 1);
    saveGame(state);
    renderGarage();
    showToast(S.hired + ': ' + wi.name + '!');
}

function passWalkIn(idx) {
    if (!state.walkIns) return;
    state.walkIns.splice(idx, 1);
    saveGame(state);
    renderGarage();
}

function assignDriver(driverId) {
    const car = getActiveCar();
    if (!car) return;
    // Check if car already has a driver
    const existing = state.drivers.find(d => d.assignedCar === car.id);
    if (existing) {
        showToast(S.alreadyAssigned);
        return;
    }
    const driver = state.drivers.find(d => d.id === driverId);
    if (!driver) return;
    // Unassign from previous car if any
    driver.assignedCar = car.id;
    saveGame(state);
    renderGarage();
    showToast(S.driverAssigned);
}

function unassignDriver(driverId) {
    const driver = state.drivers.find(d => d.id === driverId);
    if (!driver) return;
    driver.assignedCar = null;
    saveGame(state);
    renderGarage();
    showToast(S.driverUnassigned);
}

function fireDriver(driverId, btnEl) {
    if (state.drivers.length <= 1) return;
    if (btnEl && !btnEl.dataset.confirm) {
        btnEl.dataset.confirm = '1';
        btnEl.textContent = S.fireConfirm;
        btnEl.classList.add('confirming');
        setTimeout(() => { if (btnEl) { delete btnEl.dataset.confirm; btnEl.textContent = S.fireDriver; btnEl.classList.remove('confirming'); } }, 2000);
        return;
    }
    const idx = state.drivers.findIndex(d => d.id === driverId);
    if (idx === -1) return;
    state.drivers.splice(idx, 1);
    state.derbyLineup = state.derbyLineup.filter(e => e.driverId !== driverId);
    saveGame(state);
    renderGarage();
}

function getDriverForCar(carId) {
    if (!state || !state.drivers) return null;
    return state.drivers.find(d => d.assignedCar === carId) || null;
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
}

// ── Derby Lineup ──
function startDerby() {
    showScreen('lineup');
}

function renderLineup() {
    const container = document.getElementById('lineup-content');
    if (!container || !state) return;

    // Auto-build lineup from drivers with assigned healthy cars
    const eligible = [];
    for (const d of state.drivers) {
        const car = d.assignedCar ? state.cars.find(c => c.id === d.assignedCar) : null;
        const healthy = car && car.health > 0;
        const inLineup = state.derbyLineup.some(e => e.driverId === d.id);
        eligible.push({ driver: d, car, healthy, inLineup });
    }

    // Clean stale lineup entries
    state.derbyLineup = state.derbyLineup.filter(e =>
        eligible.some(el => el.driver.id === e.driverId && el.healthy)
    );

    const teamCount = state.derbyLineup.length;
    const aiCount = DERBY_TOTAL_CARS - teamCount;

    let html = '<div class="lineup-header">' +
        '<div class="lineup-title">' + S.lineup + '</div>' +
        '<div class="lineup-desc">' + S.lineupDesc.replace('{max}', MAX_TEAM_ENTRIES) + '</div>' +
        '<div class="lineup-counts">' + S.lineupSlots.replace('{team}', teamCount).replace('{ai}', aiCount) + '</div>' +
    '</div>';

    for (const el of eligible) {
        const d = el.driver;
        const skillDots = '★'.repeat(d.skill) + '☆'.repeat(5 - d.skill);
        let status = '';
        let canToggle = false;

        if (!el.car) {
            status = '<span class="lineup-status unavail">' + S.lineupNoCar + '</span>';
        } else if (!el.healthy) {
            status = '<span class="lineup-status unavail">' + S.lineupWrecked + '</span>';
        } else {
            const hpPct = Math.round((el.car.health / el.car.maxHealth) * 100);
            status = '<span class="lineup-status avail">' + el.car.name + ' (' + hpPct + '%)</span>';
            canToggle = true;
        }

        const checked = el.inLineup;
        const disabledClass = !canToggle ? ' disabled' : '';
        const activeClass = checked ? ' active' : '';
        const atCap = teamCount >= MAX_TEAM_ENTRIES && !checked;
        const clickable = canToggle && !atCap;

        html += '<div class="lineup-entry' + activeClass + disabledClass + '"' +
            (clickable || checked ? ' onclick="toggleLineupEntry(\'' + d.id + '\')"' : '') + '>' +
            '<div class="lineup-check">' + (checked ? '✓' : '') + '</div>' +
            '<div class="lineup-info">' +
                '<div class="lineup-driver-name">' + d.name + '</div>' +
                '<div class="lineup-driver-skill">' + skillDots + '</div>' +
                status +
            '</div>' +
        '</div>';
    }

    container.innerHTML = html;

    const enterBtn = document.getElementById('btn-enter-derby');
    enterBtn.disabled = teamCount === 0;
}

function toggleLineupEntry(driverId) {
    const idx = state.derbyLineup.findIndex(e => e.driverId === driverId);
    if (idx >= 0) {
        state.derbyLineup.splice(idx, 1);
    } else {
        if (state.derbyLineup.length >= MAX_TEAM_ENTRIES) return;
        const driver = state.drivers.find(d => d.id === driverId);
        if (!driver || !driver.assignedCar) return;
        const car = state.cars.find(c => c.id === driver.assignedCar);
        if (!car || car.health <= 0) return;
        state.derbyLineup.push({ driverId: driver.id, carId: car.id });
    }
    saveGame(state);
    renderLineup();
}

function confirmLineup() {
    if (state.derbyLineup.length === 0) return;
    showScreen('derby');
    document.getElementById('overlay-results').classList.remove('active');
    initDerby();
}

// ── Derby ──

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
        new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.3, restitution: 0.1 }, derbyScene);
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
            new BABYLON.PhysicsAggregate(wall, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.2, restitution: 0.7 }, derbyScene);
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

    // Spawn positions: two rows of 4 facing each other
    const spawns = [
        new BABYLON.Vector3(-12, 0.5, -10),
        new BABYLON.Vector3(-4, 0.5, -10),
        new BABYLON.Vector3(4, 0.5, -10),
        new BABYLON.Vector3(12, 0.5, -10),
        new BABYLON.Vector3(-12, 0.5, 10),
        new BABYLON.Vector3(-4, 0.5, 10),
        new BABYLON.Vector3(4, 0.5, 10),
        new BABYLON.Vector3(12, 0.5, 10)
    ];

    // Create team cars from lineup
    derbyCars = [];
    const usedNames = new Set();
    let spawnIdx = 0;

    for (const entry of state.derbyLineup) {
        const car = state.cars.find(c => c.id === entry.carId);
        const driver = state.drivers.find(d => d.id === entry.driverId);
        if (!car || !driver || car.health <= 0) continue;
        const paint = PAINT_OPTIONS.find(p => p.id === car.paint) || PAINT_OPTIONS[0];
        usedNames.add(car.name);
        derbyCars.push(createDerbyCar(derbyScene, {
            name: car.name,
            position: spawns[spawnIdx++],
            color: paint.color,
            engine: car.engine,
            armor: car.armor,
            isPlayer: true,
            isTeam: true,
            teamCarId: car.id,
            teamDriverId: driver.id,
            teamDriverName: driver.name,
            maxHealth: car.maxHealth,
            driverSkill: driver.skill,
            engineQuality: car.engineQuality || 1,
            armorQuality: car.armorQuality || 1
        }));
    }

    // Fill remaining slots with AI
    while (spawnIdx < DERBY_TOTAL_CARS) {
        let name;
        do { name = AI_CAR_NAMES[Math.floor(Math.random() * AI_CAR_NAMES.length)]; } while (usedNames.has(name));
        usedNames.add(name);
        const eng = 1 + Math.floor(Math.random() * 2);
        const arm = 1 + Math.floor(Math.random() * 2);
        derbyCars.push(createDerbyCar(derbyScene, {
            name: name,
            position: spawns[spawnIdx++],
            color: AI_COLORS[spawnIdx % AI_COLORS.length],
            engine: eng,
            armor: arm,
            isPlayer: false,
            isTeam: false,
            maxHealth: 100
        }));
    }

    // HUD
    renderDerbyHUD();

    // Timer
    derbyTimer = DERBY_DURATION;
    derbyRunning = true;
    derbyTimeScale = 1;
    derbySlowMoTimer = 0;
    derbyFastForward = false;
    lastImpactPos = null;
    lastImpactTime = 0;
    sfxEngine();

    // Game loop
    derbyScene.registerBeforeRender(() => {
        if (!derbyRunning) return;
        const rawDt = derbyEngine.getDeltaTime() / 1000;

        // Slow-mo countdown (uses real time so the effect has consistent duration)
        if (derbySlowMoTimer > 0) {
            derbySlowMoTimer -= rawDt;
            if (derbySlowMoTimer <= 0) {
                derbyTimeScale = derbyFastForward ? 2 : 1;
            }
        }

        const baseMult = derbyFastForward && derbySlowMoTimer <= 0 ? 2 : 1;
        if (derbySlowMoTimer <= 0) derbyTimeScale = baseMult;
        const dt = rawDt * derbyTimeScale;
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

        // Dynamic zoom — average distance between alive cars
        if (alive.length >= 2) {
            let totalDist = 0;
            let pairCount = 0;
            for (let i = 0; i < alive.length; i++) {
                for (let j = i + 1; j < alive.length; j++) {
                    totalDist += BABYLON.Vector3.Distance(alive[i].mesh.position, alive[j].mesh.position);
                    pairCount++;
                }
            }
            const avgDist = totalDist / pairCount;
            // Map: avgDist <= 10 → radius 25, avgDist >= 20 → radius 40
            const t = Math.max(0, Math.min(1, (avgDist - 10) / 10));
            const targetRadius = 25 + t * 15;
            camera.radius += (targetRadius - camera.radius) * 0.03;
        }

        // Check end conditions
        if (alive.length <= 1 || derbyTimer <= 0) {
            endDerby();
        }
    });

    // Camera: follow action + react to impacts
    derbyScene.registerAfterRender(() => {
        if (!derbyRunning) return;
        camera.alpha += 0.0015;

        const pc = derbyCars.find(c => c.isTeam && c.health > 0);
        let camGoal = pc && pc.health > 0 ? pc.mesh.position.clone() : camera.target.clone();

        // Bias toward impact location
        if (lastImpactPos) {
            const elapsed = performance.now() - lastImpactTime;
            if (elapsed < 1500) {
                const w = Math.max(0, 1 - elapsed / 1500) * 0.45;
                camGoal = BABYLON.Vector3.Lerp(camGoal, lastImpactPos, w);
                camera.radius += (22 - camera.radius) * 0.04 * (1 - elapsed / 1500);
            }
        }
        camera.target = BABYLON.Vector3.Lerp(camera.target, camGoal, 0.06);
    });

    derbyEngine.runRenderLoop(() => {
        if (derbyScene) derbyScene.render();
    });

    window.addEventListener('resize', () => {
        if (derbyEngine) derbyEngine.resize();
    });
}

function createDerbyCar(scene, opts) {
    const bodyColor = BABYLON.Color3.FromHexString(opts.color);
    const mat = new BABYLON.StandardMaterial(opts.name + 'Mat', scene);
    mat.diffuseColor = bodyColor;
    mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

    const darkMat = new BABYLON.StandardMaterial(opts.name + 'DkMat', scene);
    darkMat.diffuseColor = bodyColor.scale(0.55);
    darkMat.specularColor = BABYLON.Color3.Black();

    const wheelMat = new BABYLON.StandardMaterial(opts.name + 'WhlMat', scene);
    wheelMat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.12);

    // Body (physics root)
    const body = BABYLON.MeshBuilder.CreateBox(opts.name, { width: 2.0, height: 0.5, depth: 3.2 }, scene);
    body.position = opts.position.clone();
    body.material = mat;

    // Cabin
    const cab = BABYLON.MeshBuilder.CreateBox(opts.name + '_cab', { width: 1.5, height: 0.4, depth: 1.2 }, scene);
    cab.position = new BABYLON.Vector3(0, 0.44, -0.15);
    cab.parent = body;
    cab.material = darkMat;

    // Hood (front)
    const hood = BABYLON.MeshBuilder.CreateBox(opts.name + '_hood', { width: 1.8, height: 0.18, depth: 0.9 }, scene);
    hood.position = new BABYLON.Vector3(0, 0.08, 1.1);
    hood.parent = body;
    hood.material = mat;

    // Trunk (rear)
    const trunk = BABYLON.MeshBuilder.CreateBox(opts.name + '_trunk', { width: 1.8, height: 0.14, depth: 0.6 }, scene);
    trunk.position = new BABYLON.Vector3(0, 0.06, -1.3);
    trunk.parent = body;
    trunk.material = mat;

    // Bumpers
    const bMat = new BABYLON.StandardMaterial(opts.name + 'BmpMat', scene);
    bMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    const frontBumper = BABYLON.MeshBuilder.CreateBox(opts.name + '_fb', { width: 2.1, height: 0.25, depth: 0.2 }, scene);
    frontBumper.position = new BABYLON.Vector3(0, -0.1, 1.6);
    frontBumper.parent = body;
    frontBumper.material = bMat;
    const rearBumper = BABYLON.MeshBuilder.CreateBox(opts.name + '_rb', { width: 2.1, height: 0.25, depth: 0.2 }, scene);
    rearBumper.position = new BABYLON.Vector3(0, -0.1, -1.6);
    rearBumper.parent = body;
    rearBumper.material = bMat;

    // Wheels
    const wPos = [
        { x: -1.05, z: 1.0 }, { x: 1.05, z: 1.0 },
        { x: -1.05, z: -1.0 }, { x: 1.05, z: -1.0 }
    ];
    wPos.forEach((wp, i) => {
        const w = BABYLON.MeshBuilder.CreateCylinder(opts.name + '_w' + i, { diameter: 0.55, height: 0.22 }, scene);
        w.rotation.z = Math.PI / 2;
        w.position = new BABYLON.Vector3(wp.x, -0.2, wp.z);
        w.parent = body;
        w.material = wheelMat;
    });

    let aggregate = null;
    if (scene.getPhysicsEngine()) {
        aggregate = new BABYLON.PhysicsAggregate(body, BABYLON.PhysicsShapeType.BOX, {
            mass: 1000 + opts.engine * 150,
            friction: 0.2,
            restitution: 0.85
        }, scene);
        aggregate.body.setAngularDamping(1.0);
        aggregate.body.setLinearDamping(0.05);
    }

    return {
        mesh: body,
        aggregate,
        name: opts.name,
        isPlayer: opts.isPlayer || opts.isTeam || false,
        isTeam: opts.isTeam || false,
        teamCarId: opts.teamCarId || null,
        teamDriverId: opts.teamDriverId || null,
        teamDriverName: opts.teamDriverName || null,
        engine: opts.engine,
        armor: opts.armor,
        health: opts.maxHealth,
        maxHealth: opts.maxHealth,
        color: opts.color,
        driverSkill: opts.driverSkill || 0,
        engineQuality: opts.engineQuality || 1,
        armorQuality: opts.armorQuality || 1,
        totalDamageDealt: 0,
        damageCooldown: 0,
        staggerTimer: 0,
        aiTarget: null,
        aiTimer: 0
    };
}

function updateCarAI(car, aliveCars, dt) {
    if (car.staggerTimer > 0) { car.staggerTimer -= dt; return; }

    car.aiTimer -= dt;
    if (car.aiTimer <= 0 || !car.aiTarget || car.aiTarget.health <= 0) {
        let nearest = null, minDist = Infinity;
        for (const other of aliveCars) {
            if (other === car) continue;
            const d = BABYLON.Vector3.Distance(car.mesh.position, other.mesh.position);
            if (d < minDist) { minDist = d; nearest = other; }
        }
        car.aiTarget = nearest;
        car.aiTimer = 0.4 + Math.random() * 0.8;
    }
    if (!car.aiTarget) return;

    // Forward direction from mesh world transform
    const fwd = BABYLON.Vector3.TransformNormal(BABYLON.Axis.Z, car.mesh.getWorldMatrix());
    fwd.y = 0;
    const fwdLen = fwd.length();
    if (fwdLen < 0.001) return;
    fwd.scaleInPlace(1 / fwdLen);

    const toTarget = car.aiTarget.mesh.position.subtract(car.mesh.position);
    toTarget.y = 0;
    if (toTarget.length() < 0.5) return;
    toTarget.normalize();

    const dot = BABYLON.Vector3.Dot(fwd, toTarget);
    const crossY = fwd.x * toTarget.z - fwd.z * toTarget.x;

    if (car.aggregate && car.aggregate.body) {
        // Aggressive steering
        const steerStrength = 1200 + car.engine * 300;
        const steerMag = Math.min(1.0, Math.abs(crossY)) * steerStrength;
        car.aggregate.body.applyAngularImpulse(new BABYLON.Vector3(0, Math.sign(crossY) * steerMag * dt, 0));

        // Aggressive throttle: always pushing forward hard, brief reverse only when totally backwards
        let throttle = 0;
        if (dot > 0.3) throttle = 1.0;
        else if (dot > -0.2) throttle = 0.7;
        else throttle = -0.5;

        const skillMult = 1 + car.driverSkill * 0.05;
        const maxSpd = (16 + car.engine * 3 * (car.engineQuality || 1)) * skillMult;
        const desiredVel = fwd.scale(throttle * maxSpd);
        const curVel = car.aggregate.body.getLinearVelocity();
        const blend = Math.min(1, dt * 4);
        const nx = curVel.x + (desiredVel.x - curVel.x) * blend;
        const nz = curVel.z + (desiredVel.z - curVel.z) * blend;
        car.aggregate.body.setLinearVelocity(new BABYLON.Vector3(nx, curVel.y, nz));
    } else {
        const speed = (5 + car.engine * 2) * dt;
        car.mesh.position.addInPlace(toTarget.scale(speed));
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

            if (relSpeed < 3.0) continue;

            const baseDmg = relSpeed * 1.5;
            const dmgToA = Math.max(1, baseDmg * (1 - (b.armor - 1) * 0.1 * (b.armorQuality || 1)));
            const dmgToB = Math.max(1, baseDmg * (1 - (a.armor - 1) * 0.1 * (a.armorQuality || 1)));

            a.health = Math.max(0, a.health - dmgToA);
            b.health = Math.max(0, b.health - dmgToB);
            a.totalDamageDealt += dmgToB;
            b.totalDamageDealt += dmgToA;

            a.damageCooldown = 0.6;
            b.damageCooldown = 0.6;

            // Stagger on heavy hits
            if (relSpeed > 5.0) {
                const stag = 0.3 + relSpeed * 0.04;
                a.staggerTimer = Math.max(a.staggerTimer || 0, stag);
                b.staggerTimer = Math.max(b.staggerTimer || 0, stag);
            }

            // Track impact for camera + hit-stop on big hits
            if (relSpeed > 4.0) {
                lastImpactPos = a.mesh.position.add(b.mesh.position).scale(0.5);
                lastImpactTime = performance.now();
            }
            if (relSpeed > 8.0) {
                derbyTimeScale = 0.15;
                derbySlowMoTimer = 0.12;
            }

            // Visual feedback — flash
            flashCar(a);
            flashCar(b);
            sfxCrash();

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

    // Slow-mo on final wreck: if only 1 car remains after this destruction
    const aliveAfter = derbyCars.filter(c => c.health > 0).length;
    if (aliveAfter <= 1 && derbyRunning) {
        derbySlowMoTimer = 1.5;
        derbyTimeScale = 0.3;
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

function toggleFastForward() {
    derbyFastForward = !derbyFastForward;
    if (derbySlowMoTimer <= 0) derbyTimeScale = derbyFastForward ? 2 : 1;
    const btn = document.getElementById('btn-fast-forward');
    if (btn) btn.classList.toggle('active', derbyFastForward);
}

function endDerby() {
    derbyRunning = false;

    const ranked = [...derbyCars].sort((a, b) => {
        if (a.health > 0 && b.health <= 0) return -1;
        if (a.health <= 0 && b.health > 0) return 1;
        if (a.health !== b.health) return b.health - a.health;
        return b.totalDamageDealt - a.totalDamageDealt;
    });

    // Per-team-car payouts
    let totalPayout = 0;
    const teamResults = [];
    const bestTeamPlacement = ranked.findIndex(c => c.isTeam) + 1;

    ranked.forEach((c, i) => {
        if (!c.isTeam) return;
        const placement = i + 1;
        const base = DERBY_PAYOUTS[i] || 0;
        const payout = Math.round(base * state.prestigeMultiplier);
        totalPayout += payout;
        teamResults.push({ name: c.name, driverName: c.teamDriverName, placement, payout, hp: c.health, dmg: Math.round(c.totalDamageDealt), teamCarId: c.teamCarId });
    });

    state.cash += totalPayout;
    state.stats.totalEarnings += totalPayout;
    state.stats.derbiesPlayed++;
    if (bestTeamPlacement === 1) {
        state.stats.derbiesWon++;
        state.seasonWins++;
    }

    // Apply damage back to fleet cars + handle wrecks
    for (const dc of derbyCars) {
        if (dc.isTeam && dc.teamCarId) {
            const savedCar = state.cars.find(c => c.id === dc.teamCarId);
            if (savedCar) savedCar.health = Math.max(0, dc.health);
        }
        if (!dc.isTeam && dc.health <= 0) {
            state.junkyardCars.push({
                id: 'junk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: dc.name, engine: dc.engine, armor: dc.armor, paint: 'rust',
                health: 0, maxHealth: 100,
                scrapValue: 50 + Math.floor(Math.random() * 100),
                repairCost: 100 + Math.floor(Math.random() * 200)
            });
        }
    }

    state.repoAvailable = Math.random() < 0.5;
    generateWalkIns();
    generatePrivateSeller();
    saveGame(state);

    // Build results UI
    const overlay = document.getElementById('overlay-results');
    const titleEl = document.getElementById('results-title');
    const placementEl = document.getElementById('results-placement');
    const tableEl = document.getElementById('results-table');
    const payoutEl = document.getElementById('results-payout');

    const won = bestTeamPlacement === 1;
    titleEl.textContent = won ? S.youWon : S.youLost;
    titleEl.className = 'results-title ' + (won ? 'win' : 'lose');
    if (won) sfxWin(); else sfxLose();
    placementEl.textContent = S.teamResults;

    // Team results section
    let teamHtml = '';
    teamResults.forEach(tr => {
        teamHtml += `<div class="results-row player">
            <span>#${tr.placement} ${tr.name}</span>
            <span>${tr.hp > 0 ? Math.round(tr.hp) + ' HP' : S.destroyed} · ${S.dmgDealt}: ${tr.dmg} · $${tr.payout}</span>
        </div>`;
    });

    // Full standings
    let standingsHtml = '';
    ranked.forEach((c, i) => {
        const cls = c.isTeam ? ' player' : '';
        standingsHtml += `<div class="results-row${cls}">
            <span>#${i + 1} ${c.name}</span>
            <span>${c.health > 0 ? Math.round(c.health) + ' HP' : S.destroyed}</span>
        </div>`;
    });

    tableEl.innerHTML = teamHtml +
        '<div class="results-divider"></div>' +
        standingsHtml;

    const multText = state.prestigeMultiplier > 1 ? ' ' + S.payoutMultLabel.replace('{mult}', state.prestigeMultiplier.toFixed(2)) : '';
    payoutEl.textContent = S.teamPayout + ': $' + totalPayout + multText;
    overlay.classList.add('active');
}

function derbyBackToGarage() {
    document.getElementById('overlay-results').classList.remove('active');
    // Check if season is complete before leaving derby screen
    if (state.seasonWins >= state.seasonTarget) {
        showPrestigeOverlay();
    } else {
        cleanupDerby();
        showScreen('garage');
    }
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
    if (!state) return;
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
            <div class="repo-desc">${S.repoDesc}</div>
            <button class="repo-btn" onclick="doRepoJob()">${S.repoJob} — Free</button>
        </div>`;
    }

    if (state.privateSeller) {
        const ps = state.privateSeller;
        html += `
        <div class="repo-card" style="border-color:var(--accent2)">
            <div class="repo-title">${S.privateSeller}</div>
            <div class="repo-desc">${S.privateSellerDesc} · ${S.engine} ${S.lvl} ${ps.engine} · ${S.armor} ${S.lvl} ${ps.armor}</div>
            <button class="repo-btn" onclick="buyFromSeller()" ${state.cash < ps.price ? 'disabled' : ''}>${S.buyFromSeller} — $${ps.price}</button>
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
    let partMsg = '';
    if (Math.random() < USED_PART_CHANCE) {
        const type = Math.random() < 0.5 ? 'engine' : 'armor';
        const quality = USED_QUALITY_MIN + Math.random() * (USED_QUALITY_MAX - USED_QUALITY_MIN);
        state.usedParts.push({ type, quality: Math.round(quality * 100) / 100 });
        partMsg = ' + ' + S.usedPartFound;
    }
    saveGame(state);
    renderJunkyard();
    showToast(S.scrapped + ' $' + jc.scrapValue + '!' + partMsg);
    sfxScrap();
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
    if (!state.repoAvailable) return;
    state.repoAvailable = false;
    const name = AI_CAR_NAMES[Math.floor(Math.random() * AI_CAR_NAMES.length)];
    state.junkyardCars.push({
        id: 'repo_' + Date.now(),
        name: name, engine: 1, armor: 1, paint: 'rust',
        health: 0, maxHealth: 100,
        scrapValue: 30 + Math.floor(Math.random() * 70),
        repairCost: 80 + Math.floor(Math.random() * 150)
    });
    saveGame(state);
    renderJunkyard();
    showToast(S.repoGot);
}

function generatePrivateSeller() {
    if (Math.random() < PRIVATE_SELLER_CHANCE) {
        const name = AI_CAR_NAMES[Math.floor(Math.random() * AI_CAR_NAMES.length)];
        const eng = 1 + Math.floor(Math.random() * 3);
        const arm = 1 + Math.floor(Math.random() * 3);
        state.privateSeller = {
            name, engine: eng, armor: arm,
            price: 150 + (eng + arm - 2) * 75 + Math.floor(Math.random() * 100),
            maxHealth: 100
        };
    } else {
        state.privateSeller = null;
    }
}

function buyFromSeller() {
    const ps = state.privateSeller;
    if (!ps || state.cash < ps.price) return;
    state.cash -= ps.price;
    state.junkyardCars.push({
        id: 'seller_' + Date.now(),
        name: ps.name, engine: ps.engine, armor: ps.armor, paint: 'rust',
        health: 0, maxHealth: ps.maxHealth,
        scrapValue: 40 + Math.floor(Math.random() * 80),
        repairCost: 80 + Math.floor(Math.random() * 150)
    });
    state.privateSeller = null;
    saveGame(state);
    renderJunkyard();
    showToast(S.sellerBought);
}

// ── Season / Prestige ──
function updateSeasonBar() {
    const labelEl = document.getElementById('season-label');
    const fillEl = document.getElementById('season-progress-fill');
    const winsEl = document.getElementById('season-wins');
    if (!labelEl || !fillEl || !winsEl) return;

    labelEl.textContent = S.season + ' ' + state.season;
    const pct = Math.min(100, (state.seasonWins / state.seasonTarget) * 100);
    fillEl.style.width = pct + '%';
    winsEl.textContent = S.seasonProgress
        .replace('{current}', state.seasonWins)
        .replace('{target}', state.seasonTarget);
}

function showPrestigeOverlay() {
    const titleEl = document.getElementById('prestige-title');
    const msgEl = document.getElementById('prestige-msg');
    const descEl = document.getElementById('prestige-desc');
    const overlay = document.getElementById('overlay-prestige');

    titleEl.textContent = S.seasonComplete;
    msgEl.textContent = S.seasonCompleteMsg.replace('{season}', state.season);
    const newMult = (state.prestigeMultiplier + 0.15).toFixed(2);
    const newTarget = state.seasonTarget + 2;
    descEl.textContent = S.prestigeDesc
        .replace('{mult}', newMult)
        .replace('{target}', newTarget);
    overlay.classList.add('active');
}

function doPrestige() {
    document.getElementById('overlay-prestige').classList.remove('active');

    // Increment season and multiplier
    state.season++;
    state.prestigeMultiplier = parseFloat((state.prestigeMultiplier + 0.15).toFixed(2));
    state.seasonTarget += 2;
    state.seasonWins = 0;

    // Reset empire but keep season, multiplier, stats
    state.cash = 500;
    state.cars = [
        {
            id: 'starter_01',
            name: 'Rust Bucket',
            engine: 1,
            armor: 1,
            paint: 'rust',
            health: 100,
            maxHealth: 100
        }
    ];
    state.drivers = [
        { id: 'driver_01', name: 'Rookie Rex', skill: 1, assignedCar: 'starter_01' }
    ];
    state.junkyardCars = [];
    state.activeCar = 'starter_01';
    state.repoAvailable = false;

    saveGame(state);
    cleanupDerby();
    showScreen('garage');
}

function dismissPrestige() {
    document.getElementById('overlay-prestige').classList.remove('active');
    cleanupDerby();
    showScreen('garage');
}
