const Marble = {
    mesh: null,
    impostor: null,
    radius: 0.5,
    tiltForce: 12,
    maxSpeed: 15,
    jumpForce: 7,
    canJump: false,
    jumpCooldown: 0,

    create(scene, position) {
        if (this.mesh) this.mesh.dispose();

        this.mesh = BABYLON.MeshBuilder.CreateSphere('marble', { diameter: this.radius * 2, segments: 24 }, scene);
        this.mesh.position = position.clone();

        const mat = new BABYLON.StandardMaterial('marbleMat', scene);
        mat.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.9);
        mat.specularColor = new BABYLON.Color3(0.8, 0.8, 1.0);
        mat.specularPower = 64;
        const fresnelParams = new BABYLON.FresnelParameters();
        fresnelParams.bias = 0.1;
        fresnelParams.power = 2;
        fresnelParams.leftColor = new BABYLON.Color3(1, 1, 1);
        fresnelParams.rightColor = new BABYLON.Color3(0.2, 0.5, 0.9);
        mat.reflectionFresnelParameters = fresnelParams;
        this.mesh.material = mat;

        this.impostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.SphereImpostor,
            { mass: 1, friction: 0.6, restitution: 0.3 },
            scene
        );

        return this.mesh;
    },

    applyTilt(tiltX, tiltZ, cameraAlpha) {
        if (!this.impostor) return;

        const cos = Math.cos(cameraAlpha);
        const sin = Math.sin(cameraAlpha);
        const worldX = tiltX * cos + tiltZ * sin;
        const worldZ = -tiltX * sin + tiltZ * cos;

        const vel = this.impostor.getLinearVelocity();
        const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

        if (speed < this.maxSpeed || (worldX * vel.x + worldZ * vel.z) < 0) {
            const force = new BABYLON.Vector3(
                worldX * this.tiltForce,
                0,
                worldZ * this.tiltForce
            );
            this.impostor.applyForce(force, this.mesh.getAbsolutePosition());
        }
    },

    tryJump(scene) {
        if (!this.impostor || !this.mesh) return;
        if (this.jumpCooldown > 0) return;

        var vel = this.impostor.getLinearVelocity();
        var isGrounded = Math.abs(vel.y) < 1.2;

        if (!isGrounded) {
            var ray = new BABYLON.Ray(
                this.mesh.position.clone(),
                new BABYLON.Vector3(0, -1, 0),
                this.radius + 0.3
            );
            var hit = scene.pickWithRay(ray, function(m) { return m.name !== 'marble'; });
            if (hit && hit.hit) isGrounded = true;
        }

        if (isGrounded) {
            this.impostor.setLinearVelocity(new BABYLON.Vector3(vel.x, 0, vel.z));
            this.impostor.applyImpulse(
                new BABYLON.Vector3(0, this.jumpForce, 0),
                this.mesh.getAbsolutePosition()
            );
            this.jumpCooldown = 0.35;
        }
    },

    updateCooldowns(dt) {
        if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    },

    getPosition() {
        return this.mesh ? this.mesh.position : BABYLON.Vector3.Zero();
    },

    reset(position) {
        if (!this.mesh || !this.impostor) return;
        this.mesh.position = position.clone();
        this.impostor.setLinearVelocity(BABYLON.Vector3.Zero());
        this.impostor.setAngularVelocity(BABYLON.Vector3.Zero());
    },

    isFallen(hazardY) {
        return this.mesh && this.mesh.position.y < hazardY;
    },

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
            this.impostor = null;
        }
    }
};
