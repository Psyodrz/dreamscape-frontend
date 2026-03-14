import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export class Lighting {
  constructor(scene, isLowEndDevice) {
    this.scene = scene;
    this.isLowEndDevice = isLowEndDevice;
    this.dynamicLights = [];
    this.lampMeshes = [];

    // Limits
    this.maxDynamicLights = isLowEndDevice ? 2 : 4;

    this._initGlobalLighting();
  }

  _initGlobalLighting() {
    // Hemisphere: Ambient matching user settings
    // Sky color: Dark Brown-Grey, Ground color: Black
    this.hemiLight = new THREE.HemisphereLight(0x1a1510, 0x000000, 0.566);
    this.hemiLight.position.set(0, 50, 0);
    this.scene.add(this.hemiLight);

    // Directional Light (Moon) - DYNAMIC
    // Dark brown/rusty moonlight for horror vibe
    this.dirLight = new THREE.DirectionalLight(0x8b5a2b, 2.5);
    this.dirLight.position.set(50, 34.6, 50);
    this.dirLight.castShadow = true;

    // Shadow Props
    const shadowMapSize = this.isLowEndDevice ? 512 : 1024;
    this.dirLight.shadow.mapSize.width = shadowMapSize;
    this.dirLight.shadow.mapSize.height = shadowMapSize;

    // Tiled Coverage: We only cover a refined area around the player (e.g. 20m radius)
    // allowing for crisp shadows even in a huge world.
    const d = 20;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;

    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 100;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.radius = 2;

    this.scene.add(this.dirLight);

    // Create target if not exists
    if (!this.dirLight.target) {
      this.dirLight.target = new THREE.Object3D();
      this.scene.add(this.dirLight.target);
    } else {
      this.scene.add(this.dirLight.target);
    }
  }

  update(currTime, playerPos) {
    // Dynamic Light Follow
    if (this.dirLight && playerPos) {
      // Snap to grid to prevent "shadow swimming" artifacts
      const snap = 5;
      const targetX = Math.floor(playerPos.x / snap) * snap;
      const targetZ = Math.floor(playerPos.z / snap) * snap;

      // Offset light relative to player
      // Light is at +50, +100, +50 relative to target
      this.dirLight.position.set(targetX + 50, 100, targetZ + 50);
      this.dirLight.target.position.set(targetX, 0, targetZ);
      this.dirLight.target.updateMatrixWorld();
    }
  }

  // Load and place lamps at given positions
  addLamps(positions) {
    // Clear existing
    this.clearLamps();

    const objLoader = new OBJLoader();
    const textureLoader = new THREE.TextureLoader();

    Promise.all([
      new Promise((resolve) => objLoader.load("./assets/lamp/1.obj", resolve)),
      new Promise((resolve) =>
        textureLoader.load("./assets/lamp/18.jpg", resolve),
      ),
    ])
      .then(([object, texture]) => {
        console.log("Lamp asset loaded");

        // Prepare base model
        object.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              map: texture,
              metalness: 0.5,
              roughness: 0.5,
              side: THREE.DoubleSide,
            });
            child.castShadow = true; // Mesh casts shadow
          }
        });

        // Normalize size to ~0.5m
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scaleFactor = 0.5 / maxDim;
        object.scale.setScalar(scaleFactor);

        // Place instances
        positions.forEach((mount, index) => {
          const lamp = object.clone();
          lamp.position.set(mount.x, mount.y, mount.z);
          lamp.rotation.y = mount.rotY;

          this.scene.add(lamp);
          this.lampMeshes.push(lamp);

          // Add PointLight (Capped count)
          if (index < this.maxDynamicLights * 2) {
            const light = new THREE.PointLight(0xffaa44, 2.0, 8);
            light.position.set(mount.x, mount.y, mount.z);

            // Slight offset
            const offset = 0.2;
            light.position.x += Math.sin(mount.rotY) * offset;
            light.position.z += Math.cos(mount.rotY) * offset;

            // VISUAL FIX: Disable shadows on lamps to prevent shader error
            light.castShadow = false;

            light.userData = {
              originalIntensity: 2.0,
              flickerOffset: Math.random() * 100,
            };

            this.scene.add(light);
            this.dynamicLights.push(light);

            // Emissive bulb sprite/sphere
            const bulbGeo = new THREE.SphereGeometry(0.05, 8, 8);
            const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.copy(light.position);
            this.scene.add(bulb);
            light.userData.bulb = bulb; // Track bulb to remove it later
          }
        });
      })
      .catch((err) => console.error("Failed to load lamp:", err));
  }

  clearLamps() {
    // Remove lights
    this.dynamicLights.forEach((light) => {
      this.scene.remove(light);
      if (light.userData.bulb) this.scene.remove(light.userData.bulb);
    });
    this.dynamicLights = [];

    // Remove meshes
    this.lampMeshes.forEach((mesh) => this.scene.remove(mesh));
    this.lampMeshes = [];
  }

  // Helper to toggle lights based on flashlight state
  setFlashlightState(isOn) {
    // Only boost ambient slightly when flashlight is ON to see immediate surroundings better?
    // Actually, keep it consistent for horror
    // Just slight ambient boost
    if (this.hemiLight) {
      this.hemiLight.intensity = isOn ? 0.15 : 0.05;
    }
  }
}
