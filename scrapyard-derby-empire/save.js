const SAVE_KEY = 'scrapyard_derby_empire';
const SAVE_VERSION = 1;

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
        localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('Save failed:', e);
    }
}

function loadGame() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data.version !== SAVE_VERSION) return null;
        return data;
    } catch (e) {
        console.warn('Load failed:', e);
        return null;
    }
}

function hasSave() {
    return localStorage.getItem(SAVE_KEY) !== null;
}

function deleteSave() {
    localStorage.removeItem(SAVE_KEY);
}
