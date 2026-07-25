const TILT = {
    canvas: null,
    engine: null,
    scene: null,
    camera: null,
    state: 'menu',
    lives: 3,
    time: 0,
    paused: false,
    currentCheckpoint: 0,
    autosaveInterval: null,

    init() {
        this.canvas = document.getElementById('renderCanvas');
        this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
        Controls.init();
        this.updateBestTimeDisplay();

        window.addEventListener('resize', () => this.engine.resize());

        this.engine.runRenderLoop(() => {
            if (this.scene && this.state === 'playing' && !this.paused) {
                this.update();
            }
            if (this.scene) this.scene.render();
        });
    },

    createScene() {
        if (this.scene) this.scene.dispose();

        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.08, 1);
        this.scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), new BABYLON.CannonJSPlugin());

        // Fixed isometric-style camera
        this.camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 4, Math.PI / 3.2, 35, new BABYLON.Vector3(0, 0, 0), this.scene);
        this.camera.lowerRadiusLimit = 20;
        this.camera.upperRadiusLimit = 50;
        this.camera.attachControl(this.canvas, false);
        this.camera.inputs.clear();

        // Lighting
        const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), this.scene);
        hemi.intensity = 0.5;
        hemi.groundColor = new BABYLON.Color3(0.1, 0.1, 0.2);

        const dir = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, -1), this.scene);
        dir.intensity = 0.8;
        dir.position = new BABYLON.Vector3(10, 20, 10);

        const shadowGen = new BABYLON.ShadowGenerator(1024, dir);
        shadowGen.useBlurExponentialShadowMap = true;
        shadowGen.blurKernel = 16;

        // Build course
        Course.build(this.scene);

        // Enable shadows on platforms
        Course.platforms.forEach(p => p.receiveShadows = true);

        // Create marble
        const spawnPos = Course.getSpawnPosition(this.currentCheckpoint);
        Marble.create(this.scene, spawnPos);
        shadowGen.addShadowCaster(Marble.mesh);

        // Fog for depth
        this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
        this.scene.fogDensity = 0.008;
        this.scene.fogColor = new BABYLON.Color3(0.02, 0.02, 0.08);
    },

    startGame() {
        this.state = 'playing';
        this.lives = 3;
        this.time = 0;
        this.paused = false;
        this.currentCheckpoint = 0;

        this.hideAllMenus();
        document.getElementById('hud').classList.add('active');
        document.getElementById('pauseBtn').classList.add('active');
        Controls.showJoystick(true);

        this.createScene();
        this.updateHUD();
        this.startAutosave();
    },

    update() {
        const dt = this.engine.getDeltaTime() / 1000;
        this.time += dt;

        Controls.update();
        Marble.applyTilt(Controls.tiltX, Controls.tiltZ, this.camera.alpha);
        Marble.updateCooldowns(dt);

        if (Controls.jumpRequested) {
            Marble.tryJump(this.scene);
            Controls.jumpRequested = false;
        }

        Course.update(dt);

        // Camera follows marble
        const marblePos = Marble.getPosition();
        this.camera.target = new BABYLON.Vector3(
            marblePos.x,
            marblePos.y + 2,
            marblePos.z
        );

        // Check fall
        if (Marble.isFallen(Course.hazardY)) {
            this.loseLife();
        }

        // Check finish
        if (Course.checkFinish(marblePos)) {
            this.finishRun();
        }

        // Update checkpoint
        const cp = Course.getNearestCheckpoint(marblePos);
        if (cp > this.currentCheckpoint) {
            this.currentCheckpoint = cp;
        }

        this.updateHUD();
    },

    loseLife() {
        this.lives--;
        if (this.lives <= 0) {
            this.gameOver(false);
        } else {
            const spawnPos = Course.getSpawnPosition(this.currentCheckpoint);
            Marble.reset(spawnPos);
            this.updateHUD();
        }
    },

    finishRun() {
        this.state = 'finished';
        const isNewBest = Storage.saveBestTime(this.time);
        Storage.clearProgress();
        this.stopAutosave();

        const title = document.getElementById('gameOverTitle');
        const msg = document.getElementById('gameOverMsg');
        title.textContent = 'Course Complete!';
        msg.textContent = `Time: ${this.time.toFixed(2)}s` + (isNewBest ? ' — New Best!' : '');

        this.hideAllMenus();
        document.getElementById('gameOver').classList.remove('hidden');
        document.getElementById('gameOver').classList.add('active');
        document.getElementById('hud').classList.remove('active');
        document.getElementById('pauseBtn').classList.remove('active');
        Controls.showJoystick(false);

        this.updateBestTimeDisplay();
    },

    gameOver(won) {
        this.state = 'gameover';
        Storage.clearProgress();
        this.stopAutosave();

        const title = document.getElementById('gameOverTitle');
        const msg = document.getElementById('gameOverMsg');
        title.textContent = 'Game Over';
        msg.textContent = 'Out of lives! Try again.';

        this.hideAllMenus();
        document.getElementById('gameOver').classList.remove('hidden');
        document.getElementById('gameOver').classList.add('active');
        document.getElementById('hud').classList.remove('active');
        document.getElementById('pauseBtn').classList.remove('active');
        Controls.showJoystick(false);
    },

    togglePause() {
        if (this.state !== 'playing' && this.state !== 'paused') return;

        this.paused = !this.paused;
        this.state = this.paused ? 'paused' : 'playing';

        if (this.paused) {
            document.getElementById('pauseMenu').classList.remove('hidden');
            document.getElementById('pauseMenu').classList.add('active');
        } else {
            document.getElementById('pauseMenu').classList.add('hidden');
            document.getElementById('pauseMenu').classList.remove('active');
        }
    },

    quitToMenu() {
        this.paused = false;
        this.state = 'menu';
        this.stopAutosave();
        Storage.clearProgress();

        if (this.scene) {
            Marble.dispose();
            Course.dispose();
            this.scene.dispose();
            this.scene = null;
        }

        this.hideAllMenus();
        this.showMainMenu();
    },

    showMainMenu() {
        this.state = 'menu';
        this.hideAllMenus();
        document.getElementById('mainMenu').classList.remove('hidden');
        document.getElementById('mainMenu').classList.add('active');
        document.getElementById('hud').classList.remove('active');
        document.getElementById('pauseBtn').classList.remove('active');
        Controls.showJoystick(false);
        this.updateBestTimeDisplay();
    },

    showInstructions() {
        this.hideAllMenus();
        document.getElementById('instructions').classList.remove('hidden');
        document.getElementById('instructions').classList.add('active');
    },

    hideAllMenus() {
        ['mainMenu', 'instructions', 'pauseMenu', 'gameOver'].forEach(id => {
            document.getElementById(id).classList.add('hidden');
            document.getElementById(id).classList.remove('active');
        });
    },

    updateHUD() {
        document.getElementById('hudLives').textContent = `Lives: ${'●'.repeat(this.lives)}${'○'.repeat(3 - this.lives)}`;
        document.getElementById('hudTime').textContent = this.time.toFixed(2) + 's';
    },

    updateBestTimeDisplay() {
        const best = Storage.getBestTime();
        document.getElementById('bestTimeDisplay').textContent = best ? `Best Time: ${best}s` : 'Best Time: --';
    },

    startAutosave() {
        this.stopAutosave();
        this.autosaveInterval = setInterval(() => {
            if (this.state === 'playing') {
                Storage.saveProgress({
                    saveVersion: 1,
                    lives: this.lives,
                    time: this.time,
                    checkpoint: this.currentCheckpoint
                });
            }
        }, 5000);
    },

    stopAutosave() {
        if (this.autosaveInterval) {
            clearInterval(this.autosaveInterval);
            this.autosaveInterval = null;
        }
    }
};

window.addEventListener('DOMContentLoaded', () => TILT.init());

window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
        if (TILT.state === 'playing' || TILT.state === 'paused') {
            TILT.togglePause();
        }
    }
});
