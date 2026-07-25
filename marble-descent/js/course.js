const Course = {
    platforms: [],
    walls: [],
    obstacles: [],
    checkpoints: [],
    finishZone: null,
    hazardY: -10,
    rotatingBlocker: null,

    build(scene) {
        this.platforms = [];
        this.walls = [];
        this.obstacles = [];
        this.checkpoints = [];

        const matFloor = new BABYLON.StandardMaterial('matFloor', scene);
        matFloor.diffuseColor = new BABYLON.Color3(0.25, 0.3, 0.4);
        matFloor.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

        const matRamp = new BABYLON.StandardMaterial('matRamp', scene);
        matRamp.diffuseColor = new BABYLON.Color3(0.3, 0.35, 0.5);

        const matBridge = new BABYLON.StandardMaterial('matBridge', scene);
        matBridge.diffuseColor = new BABYLON.Color3(0.5, 0.4, 0.2);

        const matWall = new BABYLON.StandardMaterial('matWall', scene);
        matWall.diffuseColor = new BABYLON.Color3(0.15, 0.2, 0.3);

        const matCheckpoint = new BABYLON.StandardMaterial('matCheckpoint', scene);
        matCheckpoint.diffuseColor = new BABYLON.Color3(0.1, 0.8, 0.3);
        matCheckpoint.emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.1);

        const matFinish = new BABYLON.StandardMaterial('matFinish', scene);
        matFinish.diffuseColor = new BABYLON.Color3(1, 0.8, 0);
        matFinish.emissiveColor = new BABYLON.Color3(0.4, 0.3, 0);

        const matObstacle = new BABYLON.StandardMaterial('matObstacle', scene);
        matObstacle.diffuseColor = new BABYLON.Color3(0.8, 0.15, 0.15);
        matObstacle.emissiveColor = new BABYLON.Color3(0.3, 0.05, 0.05);

        // Section 1: Start platform
        this.createBox('startPlatform', scene, { x: 0, y: -0.5, z: 0 }, { w: 8, h: 1, d: 10 }, matFloor, true);
        this.addWalls(scene, { x: 0, z: 0 }, 8, 10, matWall);
        this.addCheckpoint(scene, { x: 0, y: 0.1, z: 0 }, matCheckpoint, 0);

        // Section 2: Downhill ramp
        const ramp1 = this.createBox('ramp1', scene, { x: 0, y: -1.5, z: -12 }, { w: 8, h: 1, d: 14 }, matRamp, true);
        ramp1.rotation.x = Math.PI * 0.06;
        ramp1.physicsImpostor = new BABYLON.PhysicsImpostor(ramp1, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.6, restitution: 0.2 }, scene);
        this.addRampWalls(scene, { x: 0, z: -12 }, 8, 14, 0.06, matWall);

        // Section 3: Flat corridor with walls
        this.createBox('corridor', scene, { x: 0, y: -2.5, z: -26 }, { w: 8, h: 1, d: 12 }, matFloor, true);
        this.addWalls(scene, { x: 0, z: -26 }, 8, 12, matWall, -2.5);
        this.addCheckpoint(scene, { x: 0, y: -1.9, z: -24 }, matCheckpoint, 1);

        // Section 4: Narrow bridge over chasm
        this.createBox('bridge', scene, { x: 0, y: -2.5, z: -40 }, { w: 2.5, h: 0.5, d: 16 }, matBridge, true);

        // Section 5: Post-bridge platform
        this.createBox('postBridge', scene, { x: 0, y: -2.5, z: -54 }, { w: 8, h: 1, d: 10 }, matFloor, true);
        this.addWalls(scene, { x: 0, z: -54 }, 8, 10, matWall, -2.5);
        this.addCheckpoint(scene, { x: 0, y: -1.9, z: -52 }, matCheckpoint, 2);

        // Section 6: Rotating blocker area
        this.createBox('blockerArea', scene, { x: 0, y: -2.5, z: -68 }, { w: 10, h: 1, d: 14 }, matFloor, true);
        this.addWalls(scene, { x: 0, z: -68 }, 10, 14, matWall, -2.5);
        this.createRotatingBlocker(scene, { x: 0, y: -1.2, z: -68 }, matObstacle);

        // Section 7: Final ramp up to finish
        const ramp2 = this.createBox('ramp2', scene, { x: 0, y: -1.5, z: -82 }, { w: 8, h: 1, d: 12 }, matRamp, true);
        ramp2.rotation.x = -Math.PI * 0.06;
        ramp2.physicsImpostor = new BABYLON.PhysicsImpostor(ramp2, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.6, restitution: 0.2 }, scene);

        // Section 8: Finish platform
        this.createBox('finishPlatform', scene, { x: 0, y: -0.5, z: -92 }, { w: 8, h: 1, d: 6 }, matFloor, true);
        this.addWalls(scene, { x: 0, z: -92 }, 8, 6, matWall);

        // Finish marker
        const finish = BABYLON.MeshBuilder.CreateBox('finishMarker', { width: 6, height: 0.2, depth: 2 }, scene);
        finish.position = new BABYLON.Vector3(0, 0.1, -92);
        finish.material = matFinish;
        this.finishZone = { x: 0, z: -92, radius: 3 };
    },

    createBox(name, scene, pos, size, material, physics) {
        const box = BABYLON.MeshBuilder.CreateBox(name, { width: size.w, height: size.h, depth: size.d }, scene);
        box.position = new BABYLON.Vector3(pos.x, pos.y, pos.z);
        box.material = material;
        if (physics) {
            box.physicsImpostor = new BABYLON.PhysicsImpostor(box, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.6, restitution: 0.2 }, scene);
        }
        this.platforms.push(box);
        return box;
    },

    addWalls(scene, center, width, depth, material, baseY) {
        const y = (baseY || -0.5) + 1;
        const hw = width / 2;
        const hd = depth / 2;
        const wallH = 1.5;

        const left = BABYLON.MeshBuilder.CreateBox('wall_' + this.walls.length, { width: 0.5, height: wallH, depth: depth }, scene);
        left.position = new BABYLON.Vector3(center.x - hw - 0.25, y, center.z);
        left.material = material;
        left.physicsImpostor = new BABYLON.PhysicsImpostor(left, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.3, restitution: 0.5 }, scene);
        this.walls.push(left);

        const right = BABYLON.MeshBuilder.CreateBox('wall_' + this.walls.length, { width: 0.5, height: wallH, depth: depth }, scene);
        right.position = new BABYLON.Vector3(center.x + hw + 0.25, y, center.z);
        right.material = material;
        right.physicsImpostor = new BABYLON.PhysicsImpostor(right, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.3, restitution: 0.5 }, scene);
        this.walls.push(right);
    },

    addRampWalls(scene, center, width, depth, angle, material) {
        const hw = width / 2;
        const wallH = 1.5;

        const left = BABYLON.MeshBuilder.CreateBox('rampWall_' + this.walls.length, { width: 0.5, height: wallH, depth: depth }, scene);
        left.position = new BABYLON.Vector3(center.x - hw - 0.25, -1, center.z);
        left.rotation.x = angle;
        left.material = material;
        left.physicsImpostor = new BABYLON.PhysicsImpostor(left, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.3, restitution: 0.5 }, scene);
        this.walls.push(left);

        const right = BABYLON.MeshBuilder.CreateBox('rampWall_' + this.walls.length, { width: 0.5, height: wallH, depth: depth }, scene);
        right.position = new BABYLON.Vector3(center.x + hw + 0.25, -1, center.z);
        right.rotation.x = angle;
        right.material = material;
        right.physicsImpostor = new BABYLON.PhysicsImpostor(right, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.3, restitution: 0.5 }, scene);
        this.walls.push(right);
    },

    addCheckpoint(scene, pos, material, index) {
        const cp = BABYLON.MeshBuilder.CreateDisc('checkpoint_' + index, { radius: 1.5, tessellation: 32 }, scene);
        cp.position = new BABYLON.Vector3(pos.x, pos.y, pos.z);
        cp.rotation.x = Math.PI / 2;
        cp.material = material;
        this.checkpoints.push({ mesh: cp, position: new BABYLON.Vector3(pos.x, pos.y + 1, pos.z), index: index });
    },

    createRotatingBlocker(scene, pos, material) {
        const blocker = BABYLON.MeshBuilder.CreateBox('blocker', { width: 8, height: 1.5, depth: 1 }, scene);
        blocker.position = new BABYLON.Vector3(pos.x, pos.y, pos.z);
        blocker.material = material;
        blocker.physicsImpostor = new BABYLON.PhysicsImpostor(blocker, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, friction: 0.3, restitution: 0.8 }, scene);
        this.rotatingBlocker = blocker;
        this.obstacles.push(blocker);
    },

    update(deltaTime) {
        if (this.rotatingBlocker) {
            this.rotatingBlocker.rotation.y += deltaTime * 1.5;
            this.rotatingBlocker.physicsImpostor.setAngularVelocity(new BABYLON.Vector3(0, 1.5, 0));
        }
    },

    getSpawnPosition(checkpointIndex) {
        if (checkpointIndex >= 0 && checkpointIndex < this.checkpoints.length) {
            return this.checkpoints[checkpointIndex].position.clone();
        }
        return new BABYLON.Vector3(0, 1.5, 0);
    },

    checkFinish(marblePos) {
        if (!this.finishZone) return false;
        const dx = marblePos.x - this.finishZone.x;
        const dz = marblePos.z - this.finishZone.z;
        return Math.sqrt(dx * dx + dz * dz) < this.finishZone.radius;
    },

    getNearestCheckpoint(marblePos) {
        let best = 0;
        for (let i = this.checkpoints.length - 1; i >= 0; i--) {
            const cp = this.checkpoints[i];
            const dz = marblePos.z - cp.position.z;
            if (dz <= 2) {
                best = i;
                break;
            }
        }
        return best;
    },

    dispose() {
        this.platforms.forEach(m => m.dispose());
        this.walls.forEach(m => m.dispose());
        this.obstacles.forEach(m => m.dispose());
        this.checkpoints.forEach(cp => cp.mesh.dispose());
        this.platforms = [];
        this.walls = [];
        this.obstacles = [];
        this.checkpoints = [];
        this.rotatingBlocker = null;
    }
};
