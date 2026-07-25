// All sound is generated procedurally via the Web Audio API (oscillators + filtered noise) -
// no external audio files or CDN dependencies needed.
const SFX = {
    ctx: null,
    supported: true,
    muted: false,
    masterGain: null,

    rollNoise: null,
    rollFilter: null,
    rollGain: null,
    rollStarted: false,

    init() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) {
                this.supported = false;
                return;
            }
            this.ctx = new AC();
            this.masterGain = this.ctx.createGain();

            let storedMute = null;
            try { storedMute = localStorage.getItem('marble_descent_muted'); } catch (e) { /* ignore */ }
            this.muted = storedMute === '1';
            this.masterGain.gain.value = this.muted ? 0 : 0.55;
            this.masterGain.connect(this.ctx.destination);
        } catch (e) {
            this.supported = false;
        }
    },

    // Browsers require a user gesture before audio can play; call this from a click/tap handler.
    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
    },

    suspend() {
        if (this.ctx && this.ctx.state === 'running') {
            this.ctx.suspend().catch(() => {});
        }
    },

    toggleMute() {
        if (!this.supported) return this.muted;
        this.muted = !this.muted;
        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
        }
        try { localStorage.setItem('marble_descent_muted', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
        return this.muted;
    },

    _tone(freq, duration, type, peakGain, startOffset) {
        if (!this.supported || !this.ctx) return;
        try {
            const t0 = this.ctx.currentTime + (startOffset || 0);
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freq, t0);
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t0);
            osc.stop(t0 + duration + 0.05);
        } catch (e) { /* audio is best-effort, never let it crash gameplay */ }
    },

    playJump() {
        this._tone(440, 0.18, 'triangle', 0.35, 0);
        this._tone(660, 0.14, 'triangle', 0.22, 0.03);
    },

    playCheckpoint() {
        this._tone(523.25, 0.12, 'sine', 0.3, 0);
        this._tone(659.25, 0.14, 'sine', 0.3, 0.09);
        this._tone(783.99, 0.22, 'sine', 0.3, 0.18);
    },

    playFinish() {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
            this._tone(f, 0.35, 'triangle', 0.32, i * 0.12);
        });
    },

    playCrash() {
        if (!this.supported || !this.ctx) return;
        try {
            const t0 = this.ctx.currentTime;
            const bufferSize = Math.floor(this.ctx.sampleRate * 0.3);
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
            }
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(900, t0);
            filter.frequency.exponentialRampToValueAtTime(120, t0 + 0.3);
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.5, t0);
            gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            noise.start(t0);
            noise.stop(t0 + 0.32);
        } catch (e) { /* best-effort */ }
    },

    startRoll() {
        if (!this.supported || !this.ctx || this.rollStarted) return;
        try {
            const bufferSize = 2 * this.ctx.sampleRate;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

            this.rollNoise = this.ctx.createBufferSource();
            this.rollNoise.buffer = buffer;
            this.rollNoise.loop = true;

            this.rollFilter = this.ctx.createBiquadFilter();
            this.rollFilter.type = 'lowpass';
            this.rollFilter.frequency.value = 150;

            this.rollGain = this.ctx.createGain();
            this.rollGain.gain.value = 0;

            this.rollNoise.connect(this.rollFilter);
            this.rollFilter.connect(this.rollGain);
            this.rollGain.connect(this.masterGain);
            this.rollNoise.start();
            this.rollStarted = true;
        } catch (e) {
            this.rollStarted = false;
        }
    },

    updateRoll(speed) {
        if (!this.supported || !this.rollStarted || !this.rollGain || !this.rollFilter) return;
        try {
            const t = this.ctx.currentTime;
            const norm = Math.min(speed / 12, 1);
            this.rollGain.gain.setTargetAtTime(norm * 0.22, t, 0.08);
            this.rollFilter.frequency.setTargetAtTime(150 + norm * 500, t, 0.08);
        } catch (e) { /* best-effort */ }
    },

    stopRoll() {
        if (!this.rollStarted) return;
        try {
            this.rollGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
            const noise = this.rollNoise;
            setTimeout(() => { try { noise.stop(); } catch (e) { /* ignore */ } }, 250);
        } catch (e) { /* ignore */ }
        this.rollStarted = false;
        this.rollNoise = null;
        this.rollFilter = null;
        this.rollGain = null;
    }
};
