import * as THREE from "three";
import { BaseTrap } from "./BaseTrap.js";
import { getAudioManager } from "../../systems/AudioManager.js";

/**
 * Hyper-Realistic Spike Trap 3D
 * Adapted from user provided HTML demo
 */
export class SpikeTrap extends BaseTrap {
  constructor(scene, physicsSystem, player, position) {
    super(scene, physicsSystem, player, position);

    this.state = "IDLE"; // IDLE, TRIGGERED, HOLD, RETRACTING
    this.trapTimer = 0;
    this.checkInterval = 50; // Use tighter loop for sensor accuracy

    // Config from user demo (SCALED)
    this.config = {
      triggerDistance: 2.0, // Trigger slightly before stepping on it (Sensitivity)
      spikeHeight: 1.2, // Reduced height (Waist high)
      spikeSpeedUp: 0.8, // Match Reference (Very Fast)
      spikeSpeedDown: 0.05, // Match Reference
      damageRadius: 1.5, // On the plate (2.5m wide = 1.25 radius + margin)
      damage: 10,
    };

    this.spikes = [];
    this.lastOuchTime = 0; // Cooldown for ouch sound
    this._createAssetsAndMesh();
  }

  // --- ASSET GENERATION (Procedural Textures from Demo) ---
  // --- ASSET GENERATION (Static Cache) ---
  static assets = null;

  static _getAssets() {
    if (SpikeTrap.assets) return SpikeTrap.assets;

    const createNoiseTexture = (width, height, type) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      // Fill background
      if (type === "concrete") ctx.fillStyle = "#333";
      if (type === "metal") ctx.fillStyle = "#556";
      if (type === "rust") ctx.fillStyle = "#4a2c22";
      ctx.fillRect(0, 0, width, height);

      // Add Noise
      const idata = ctx.getImageData(0, 0, width, height);
      const buffer32 = new Uint32Array(idata.data.buffer);

      for (let i = 0; i < buffer32.length; i++) {
        if (Math.random() < 0.5) continue;

        let shade;
        if (type === "concrete") shade = Math.random() * 50;
        if (type === "metal") shade = Math.random() * 30 + 50;
        if (type === "rust") shade = Math.random() * 40;

        // Simple noise blending
        const val = 0xff000000 | (shade << 16) | (shade << 8) | shade;
        buffer32[i] = val;
      }

      // Add scratches/details for metal
      if (type === "metal") {
        ctx.putImageData(idata, 0, 0);
        ctx.strokeStyle = "#778";
        ctx.lineWidth = 1;
        for (let i = 0; i < 50; i++) {
          ctx.beginPath();
          ctx.moveTo(Math.random() * width, Math.random() * height);
          ctx.lineTo(Math.random() * width, Math.random() * height);
          ctx.stroke();
        }
      } else {
        ctx.putImageData(idata, 0, 0);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
    };

    SpikeTrap.assets = {
      plateTex: createNoiseTexture(256, 256, "rust"),
      spikeTex: createNoiseTexture(256, 256, "metal"),
    };

    return SpikeTrap.assets;
  }

  _createAssetsAndMesh() {
    const assets = SpikeTrap._getAssets();
    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.group.position.y = 0.05;

    // Materials - Reuse textures
    const plateMat = new THREE.MeshStandardMaterial({
      map: assets.plateTex,
      roughness: 0.6,
      metalness: 0.6,
      bumpMap: assets.plateTex,
      bumpScale: 0.05,
    });

    const spikeMat = new THREE.MeshStandardMaterial({
      map: assets.spikeTex,
      color: 0xaaaaaa,
      roughness: 0.2,
      metalness: 0.9,
    });

    // Trap Base Plate (Reverted to standard size)
    const plateGeo = new THREE.BoxGeometry(2.5, 0.1, 2.5);
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.castShadow = true;
    plate.receiveShadow = true;
    this.group.add(plate);

    // Spikes (Reverted grid)
    const spikeGeo = new THREE.ConeGeometry(0.08, this.config.spikeHeight, 16);
    spikeGeo.translate(0, this.config.spikeHeight / 2, 0);
    const spread = 0.6;

    for (let x = -0.9; x <= 0.9; x += spread) {
      for (let z = -0.9; z <= 0.9; z += spread) {
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        spike.position.set(x, 0, z);
        spike.castShadow = true;
        spike.receiveShadow = true;
        spike.position.y = -this.config.spikeHeight - 0.2;
        this.group.add(spike);
        this.spikes.push(spike);

        const hole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16),
          new THREE.MeshBasicMaterial({ color: 0x110000 }),
        );
        hole.position.set(x, 0.06, z);
        this.group.add(hole);
      }
    }

    this.scene.add(this.group);
    this.mesh = this.group;
  }

  update(deltaTime, currentTime) {
    if (!this.player || !this.player.mesh) return;

    // Don't deal damage or play sounds if player is dead/captured/respawning
    const playerDead =
      this.player.isDead ||
      this.player.injuryState === "dead" ||
      this.player.injuryState === "captured" ||
      this.player.health <= 0;

    // Use Reference-Style Logic (Sensitivity + Distance)
    const pPos = this.player.mesh.position;
    // Simple 2D Distance check is often more reliable/forgiving than strict AABB
    const distSq =
      (pPos.x - this.position.x) ** 2 + (pPos.z - this.position.z) ** 2;
    const dist = Math.sqrt(distSq);

    // Check Trigger
    const isTriggerZone = dist < this.config.triggerDistance;
    // Check Damage Zone
    const isDamageZone = dist < this.config.damageRadius;
    const nearGround = pPos.y < 2.0; // Reference uses < 2

    // State Machine
    switch (this.state) {
      case "IDLE":
        if (isTriggerZone && nearGround) {
          this.state = "TRIGGERED";
          this._playSound("trigger");
          // Instant damage if close enough (only if player is alive)
          if (isDamageZone && !playerDead) {
            this.player.takeDamage(this.config.damage);
            // Play ouch sound with cooldown
            this._playOuchWithCooldown();
            // Show spike trap dialogue
            if (window.dialogueManager?.show) {
              window.dialogueManager.show("spikeTrap");
            }
          }
        }
        break;

      case "TRIGGERED":
        let allUp = true;
        this.spikes.forEach((spike) => {
          // Reference speed (0.8)
          if (spike.position.y < 0.2) {
            spike.position.y += this.config.spikeSpeedUp + Math.random() * 0.1;
            allUp = false;
          } else {
            spike.position.y = 0.2 + Math.random() * 0.05;
          }
        });

        // Reference-style damage check (only if player is alive)
        if (isDamageZone && nearGround && !playerDead) {
          if (Math.random() > 0.8) {
            // Staggered damage with ouch sound (cooldown prevents spam)
            this.player.takeDamage(this.config.damage / 2);
            this._playOuchWithCooldown();
          }
        }

        if (allUp) {
          this.trapTimer = 0;
          this.state = "HOLD";
        }
        break;

      case "HOLD":
        this.trapTimer += deltaTime * 1000;
        // Only deal damage if player is alive
        if (isDamageZone && nearGround && !playerDead && Math.random() > 0.8) {
          this.player.takeDamage(this.config.damage / 2);
          // Play ouch with cooldown to prevent spam
          this._playOuchWithCooldown();
        }

        if (this.trapTimer > 1500) {
          this.state = "RETRACTING";
          this._playSound("retract");
        }
        break;

      case "RETRACTING":
        let allDown = true;
        this.spikes.forEach((spike) => {
          if (spike.position.y > -this.config.spikeHeight) {
            spike.position.y -= this.config.spikeSpeedDown;
            allDown = false;
          }
        });

        if (allDown) {
          this.spikes.forEach(
            (s) => (s.position.y = -this.config.spikeHeight - 0.2),
          );
          this.state = "IDLE";
        }
        break;
    }
  }

  _playSound(type) {
    const audio = getAudioManager();
    // Map abstract types to actual sound methods if available,
    // or generic impacts
    if (type === "trigger") {
      // Sharp metallic clank
      audio.playWallHit(); // Fallback
    } else if (type === "retract") {
      // Grinding sound - maybe we don't have one, silent for now or quiet thud
    }
  }

  /**
   * Play ouch sound with cooldown to prevent spam
   */
  _playOuchWithCooldown() {
    const now = performance.now();
    const cooldown = 500; // 500ms cooldown between ouch sounds

    if (now - this.lastOuchTime >= cooldown) {
      this.lastOuchTime = now;
      getAudioManager().playOuch?.();
    }
  }
}
