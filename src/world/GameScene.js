import * as THREE from "three";

export class GameScene {
  constructor(width, height, renderer) {
    this.width = width;
    this.height = height;
    this.renderer = renderer;

    this._initScene();
    this._initCamera();
    // Star field removed - now using ProceduralSky for background
  }

  _initScene() {
    this.instance = new THREE.Scene();
    // No background - ProceduralSky sphere provides the background
    this.instance.background = null;
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.width / this.height,
      0.1,
      1000 // Increased far plane for sky sphere
    );
    this.camera.position.set(0, 3, 0);
    this.instance.add(this.camera);
  }

  // Star field removed - ProceduralSky handles stars now
  update(deltaTime) {}

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  add(object) {
    this.instance.add(object);
  }

  remove(object) {
    this.instance.remove(object);
  }
}
