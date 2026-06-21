const SAVE_KEY_PREFIX = 'scrapyard_derby_empire_slot_';
const SAVE_VERSION = 1;
const SLOT_COUNT = 3;
let activeSlot = 0;

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
            { id: 'driver_01', name: 'Rookie Rex', assignedCar: 'starter_01' }
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
        repoAvailable: false
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
