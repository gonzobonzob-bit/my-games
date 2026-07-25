const Storage = {
    KEYS: { BEST_TIME: 'marble_descent_best_time', AUTOSAVE: 'marble_descent_autosave_v1' },
    SAVE_VERSION: 1,

    getBestTime() {
        try {
            const t = localStorage.getItem(this.KEYS.BEST_TIME);
            return t ? parseFloat(t) : null;
        } catch (e) {
            return null;
        }
    },

    saveBestTime(time) {
        try {
            const current = this.getBestTime();
            if (!current || time < current) {
                localStorage.setItem(this.KEYS.BEST_TIME, time.toFixed(2));
                return true;
            }
        } catch (e) {
            // localStorage unavailable/full - best time tracking is non-critical, fail silently
        }
        return false;
    },

    saveProgress(data) {
        try {
            const payload = Object.assign({ saveVersion: this.SAVE_VERSION, savedAt: Date.now() }, data);
            localStorage.setItem(this.KEYS.AUTOSAVE, JSON.stringify(payload));
        } catch (e) {
            // storage full/unavailable - autosave is best-effort, never crash the game over it
        }
    },

    loadProgress() {
        try {
            const raw = localStorage.getItem(this.KEYS.AUTOSAVE);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.saveVersion !== this.SAVE_VERSION) {
                this.clearProgress();
                return null;
            }
            if (typeof parsed.lives !== 'number' || typeof parsed.time !== 'number' || typeof parsed.checkpoint !== 'number') {
                this.clearProgress();
                return null;
            }
            return parsed;
        } catch (e) {
            // corrupt save - degrade gracefully instead of crashing
            this.clearProgress();
            return null;
        }
    },

    clearProgress() {
        try {
            localStorage.removeItem(this.KEYS.AUTOSAVE);
        } catch (e) {
            // ignore
        }
    }
};
