import * as THREE from "three";

/**
 * Base Trap Class
 */
export class BaseTrap {
  constructor(scene, physicsSystem, player, position) {
    this.scene = scene;
    this.physicsSystem = physicsSystem;
    this.player = player;
    this.position = position;

    this.mesh = null;
    this.body = null;
    this.active = true;

    this.checkInterval = 100; // Check collision every 100ms
    this.lastCheckTime = 0;
  }

  update(deltaTime, currentTime) {
    if (!this.active || !this.player) return;

    if (currentTime - this.lastCheckTime > this.checkInterval) {
      this.lastCheckTime = currentTime;
      // Derived classes can optimize this check
      this._checkTrigger();
    }
  }

  _checkTrigger() {
    if (!this.player.mesh) return;

    // Simple distance check first for performance
    const distSq =
      (this.player.mesh.position.x - this.position.x) ** 2 +
      (this.player.mesh.position.z - this.position.z) ** 2;

    if (distSq < 2.0) {
      // Slightly larger trigger radius for base
      this.onTrigger(this.player);
    }
  }

  onTrigger(player) {
    // Override in subclass
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      if (this.mesh.geometry) this.mesh.geometry.dispose();
      if (this.mesh.material) this.mesh.material.dispose();
    }
    // Physics cleanup if needed
  }
}
