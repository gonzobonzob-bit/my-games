const SAVE_KEY_PREFIX = 'scrapyard_derby_empire_slot_';
const SAVE_VERSION = 1;
const SLOT_COUNT = 3;
const PREFS_KEY = 'scrapyard_derby_empire_prefs_v1';
let activeSlot = 0;

// ── Player prefs (global, independent of save slot) ──
function defaultPrefs() {
    return {
        sfxEnabled: true,
        graphicsQuality: 'medium' // 'low' | 'medium' | 'high'
    };
}

function loadPrefs() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return defaultPrefs();
        const data = JSON.parse(raw);
        const prefs = defaultPrefs();
        if (typeof data.sfxEnabled === 'boolean') prefs.sfxEnabled = data.sfxEnabled;
        if (['low', 'medium', 'high'].includes(data.graphicsQuality)) prefs.graphicsQuality = data.graphicsQuality;
        return prefs;
    } catch (e) {
        console.warn('Prefs load failed:', e);
        return defaultPrefs();
    }
}

function savePrefs(prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
        console.warn('Prefs save failed:', e);
    }
}

function slotKey(index) {
    return SAVE_KEY_PREFIX + index;
}

function createNewSave() {
    return {
        version: SAVE_VERSION,
        cash: 500,
        cars: [
            {
                id: 'starter_01',
                name: 'Rust Bucket',
                engine: 1,
                armor: 1,
                paint: 'rust',
                health: 100,
                maxHealth: 100
            }
        ],
        drivers: [
            { id: 'driver_01', name: 'Rookie Rex', skill: 1, assignedCar: 'starter_01' }
        ],
        junkyardCars: [],
        activeCar: 'starter_01',
        stats: {
            derbiesPlayed: 0,
            derbiesWon: 0,
            totalEarnings: 0,
            carsScraped: 0,
            carsRepaired: 0
        },
        repoAvailable: false,
        usedParts: [],
        privateSeller: null,
        walkIns: [],
        derbyLineup: [],
        derbyMode: 'standard',
        unlockedCosmetics: [],
        season: 1,
        prestigeMultiplier: 1.0,
        seasonWins: 0,
        seasonTarget: 5,
        league: 1
    };
}

function saveGame(state) {
    try {
        localStorage.setItem(slotKey(activeSlot), JSON.stringify(state));
    } catch (e) {
        console.warn('Save failed:', e);
    }
}

function loadSlot(index) {
    try {
        const raw = localStorage.getItem(slotKey(index));
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data.version !== SAVE_VERSION) return null;
        // Backward compat: add prestige/season fields if missing
        if (data.season === undefined) data.season = 1;
        if (data.prestigeMultiplier === undefined) data.prestigeMultiplier = 1.0;
        if (data.seasonWins === undefined) data.seasonWins = 0;
        if (data.seasonTarget === undefined) data.seasonTarget = 5;
        if (data.walkIns === undefined) data.walkIns = [];
        if (data.derbyLineup === undefined) data.derbyLineup = [];
        if (data.usedParts === undefined) data.usedParts = [];
        if (data.privateSeller === undefined) data.privateSeller = null;
        if (data.league === undefined) data.league = 1;
        if (data.derbyMode === undefined) data.derbyMode = 'standard';
        if (data.unlockedCosmetics === undefined) data.unlockedCosmetics = [];
        if (data.cars) {
            for (const c of data.cars) {
                if (c.engineQuality === undefined) c.engineQuality = 1.0;
                if (c.armorQuality === undefined) c.armorQuality = 1.0;
            }
        }
        // Backward compat: add skill to drivers missing it
        if (data.drivers) {
            for (const d of data.drivers) {
                if (d.skill === undefined) d.skill = 1;
            }
        }
        return data;
    } catch (e) {
        console.warn('Load failed:', e);
        return null;
    }
}

function hasSlot(index) {
    return localStorage.getItem(slotKey(index)) !== null;
}

function deleteSlotData(index) {
    localStorage.removeItem(slotKey(index));
}

function getSlotSummary(index) {
    const data = loadSlot(index);
    if (!data) return null;
    return {
        cash: data.cash,
        derbiesPlayed: data.stats.derbiesPlayed,
        carsOwned: data.cars.length
    };
}
