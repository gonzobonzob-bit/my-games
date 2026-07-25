const Controls = {
    tiltX: 0,
    tiltZ: 0,
    jumpRequested: false,
    keys: {},
    isMobile: false,
    joystickActive: false,
    joystickStartX: 0,
    joystickStartY: 0,

    init() {
        this.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code === 'Space') {
                e.preventDefault();
                this.jumpRequested = true;
            }
        });
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

        if (this.isMobile) {
            this.initJoystick();
        }
    },

    initJoystick() {
        const joystick = document.getElementById('joystick');
        const knob = document.getElementById('joystickKnob');
        const radius = 50;

        const handleMove = (clientX, clientY) => {
            const rect = joystick.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            let dx = clientX - centerX;
            let dy = clientY - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > radius) {
                dx = (dx / dist) * radius;
                dy = (dy / dist) * radius;
            }
            knob.style.left = `calc(50% + ${dx}px)`;
            knob.style.top = `calc(50% + ${dy}px)`;
            this.tiltX = dx / radius;
            this.tiltZ = dy / radius;
        };

        const handleEnd = () => {
            this.joystickActive = false;
            knob.style.left = '50%';
            knob.style.top = '50%';
            this.tiltX = 0;
            this.tiltZ = 0;
        };

        joystick.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.joystickActive = true;
            const touch = e.touches[0];
            handleMove(touch.clientX, touch.clientY);
        });

        joystick.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!this.joystickActive) return;
            const touch = e.touches[0];
            handleMove(touch.clientX, touch.clientY);
        });

        joystick.addEventListener('touchend', handleEnd);
        joystick.addEventListener('touchcancel', handleEnd);
    },

    update() {
        if (this.isMobile) return;

        let tx = 0, tz = 0;
        if (this.keys['ArrowLeft'] || this.keys['KeyA']) tx = -1;
        if (this.keys['ArrowRight'] || this.keys['KeyD']) tx = 1;
        if (this.keys['ArrowUp'] || this.keys['KeyW']) tz = -1;
        if (this.keys['ArrowDown'] || this.keys['KeyS']) tz = 1;

        const lerp = 0.15;
        this.tiltX += (tx - this.tiltX) * lerp;
        this.tiltZ += (tz - this.tiltZ) * lerp;
    },

    showJoystick(show) {
        const el = document.getElementById('joystick');
        const jumpBtn = document.getElementById('jumpBtn');
        if (this.isMobile && show) {
            el.classList.add('active');
            jumpBtn.classList.add('active');
        } else {
            el.classList.remove('active');
            jumpBtn.classList.remove('active');
        }
    }
};
