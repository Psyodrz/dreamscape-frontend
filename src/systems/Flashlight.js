/**
 * Flashlight - Player's handheld light source
 *
 * Features:
 * - SpotLight attached to camera/player
 * - Realistic cone with penumbra
 * - Toggle on/off with F key
 * - Subtle bob/sway with player movement
 * - Battery system (optional)
 */

import * as THREE from "three";

export class Flashlight {
  constructor(camera, options = {}) {
    this.camera = camera;

    // Configuration
    this.config = {
      color: options.color || 0xffeedd, // Warm white
      intensity: options.intensity || 5.0,
      distance: options.distance || 30, // Light reach
      angle: options.angle || Math.PI / 6, // 30 degree cone
      penumbra: options.penumbra || 0.3, // Soft edge
      decay: options.decay || 2, // Realistic falloff
      castShadow: options.castShadow !== undefined ? options.castShadow : true,
      offsetY: options.offsetY || -0.3, // Slight offset below camera center
      offsetZ: options.offsetZ || 0.5, // Forward offset
    };

    // Callbacks
    this.onToggle = options.onToggle || null;

    // State
    this.isOn = false;
    this.light = null;
    this.target = null;

    // Animation
    this.time = 0;
    this.bobAmount = 0;

    // Flickering
    this.baseIntensity = this.config.intensity;
    this.flickerTimer = 0;
    this.flickerState = 0; // 0 = normal, 1 = dim/off

    this._createLight();
  }

  _createLight() {
    // Create the spotlight
    this.light = new THREE.SpotLight(
      this.config.color,
      this.config.intensity,
      this.config.distance,
      this.config.angle,
      this.config.penumbra,
      this.config.decay
    );

    // Create light target (where the spotlight points)
    this.target = new THREE.Object3D();

    // Configure shadows
    if (this.config.castShadow) {
      this.light.castShadow = true;
      this.light.shadow.mapSize.width = 512;
      this.light.shadow.mapSize.height = 512;
      this.light.shadow.camera.near = 0.5;
      this.light.shadow.camera.far = this.config.distance;
      this.light.shadow.bias = -0.002;
    }

    // Set the target
    this.light.target = this.target;

    // Initially off
    this.light.visible = false;
    this.target.visible = false;

    // Add to camera so it moves with player view
    this.camera.add(this.light);
    this.camera.add(this.target);

    // Position light slightly below and in front of camera
    this.light.position.set(0.2, this.config.offsetY, this.config.offsetZ);

    // Target in front of light
    this.target.position.set(0, 0, -10);

    console.log("[Flashlight] Created - press F to toggle");
  }

  /**
   * Toggle flashlight on/off
   * @returns {boolean} New state
   */
  toggle() {
    this.isOn = !this.isOn;
    this.light.visible = this.isOn;
    console.log(`[Flashlight] ${this.isOn ? "ON" : "OFF"}`);

    // Play sound callback
    if (this.onToggle) this.onToggle(this.isOn);

    return this.isOn;
  }

  /**
   * Update flashlight (call each frame)
   * @param {number} deltaTime - Frame delta
   * @param {boolean} isMoving - Whether player is moving
   * @param {boolean} isSprinting - Whether player is sprinting
   * @param {number} ghostDistance - Distance to nearest ghost (Infinity if none)
   */
  update(
    deltaTime,
    isMoving = false,
    isSprinting = false,
    ghostDistance = Infinity
  ) {
    if (!this.isOn) return;

    this.time += deltaTime;

    // --- MOVEMENT BOB ---
    const targetBob = isMoving ? (isSprinting ? 0.04 : 0.02) : 0;
    this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, targetBob, 0.1);

    if (this.bobAmount > 0.001) {
      const bobSpeed = isSprinting ? 12 : 8;
      const offsetX = Math.sin(this.time * bobSpeed) * this.bobAmount;
      const offsetY = Math.cos(this.time * bobSpeed * 2) * this.bobAmount * 0.5;

      this.light.position.x = 0.2 + offsetX;
      this.light.position.y = this.config.offsetY + offsetY;
    }

    // --- FLICKERING LOGIC ---
    this._updateFlicker(deltaTime, ghostDistance);
  }

  _updateFlicker(deltaTime, ghostDistance) {
    // Proximity factor: 0 (far) to 1 (very close < 5m)
    // Starts flickering at 15m
    const flickerStartDist = 15;
    const maxFlickerDist = 5;

    let proximityFactor = 0;
    if (ghostDistance < flickerStartDist) {
      proximityFactor =
        1.0 -
        Math.max(
          0,
          (ghostDistance - maxFlickerDist) / (flickerStartDist - maxFlickerDist)
        );
    }

    // Base random flicker (rare)
    const baseFlickerChance = 0.005; // 0.5% chance per frame at 60fps
    // Proximity flicker (increases with closeness)
    const proximityFlickerChance = proximityFactor * 0.15; // Up to 15% chance per frame!

    // Check if we should start a flicker event
    if (this.flickerTimer <= 0) {
      // We are currently stable
      this.light.intensity = this.config.intensity;

      if (Math.random() < baseFlickerChance + proximityFlickerChance) {
        // Trigger flicker!
        // Duration depends on proximity (longer/more chaotic when close)
        this.flickerTimer =
          0.05 + Math.random() * (0.1 + proximityFactor * 0.2);
      }
    } else {
      // We are flickering
      this.flickerTimer -= deltaTime;

      // Random intensity during flicker
      // Can drop to 0 (off) or just dim
      const minIntensity = proximityFactor > 0.5 ? 0 : 0.2; // Can go full black if close
      const flickerIntensity = minIntensity + Math.random() * 0.5;

      this.light.intensity = this.config.intensity * flickerIntensity;
    }
  }

  /**
   * Set flashlight on or off
   */
  setEnabled(enabled) {
    this.isOn = enabled;
    this.light.visible = enabled;
    if (this.onToggle) this.onToggle(this.isOn);
  }

  /**
   * Set light intensity
   */
  setIntensity(intensity) {
    this.config.intensity = intensity;
    // Only update if not currently flickering
    if (this.flickerTimer <= 0) {
      this.light.intensity = intensity;
    }
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isOn: this.isOn,
      intensity: this.config.intensity,
    };
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.light) {
      this.camera.remove(this.light);
      this.camera.remove(this.target);
      if (this.light.shadow?.map) {
        this.light.shadow.map.dispose();
      }
      this.light = null;
      this.target = null;
    }
  }
}
