/**
 * SpatialAudioEngine - 3D Positional Audio System for DreamScape
 *
 * Features:
 * - True 3D positional audio using Three.js AudioListener
 * - Distance-based volume falloff
 * - Proximity-based fear system (heartbeat)
 * - Ambient state management (calm/chase/danger)
 * - Audio pools for overlapping sounds
 */

import * as THREE from "three";

// Audio states for ambient music/effects
const AudioState = {
  CALM: "calm",
  TENSE: "tense",
  CHASE: "chase",
  DANGER: "danger",
};

export class SpatialAudioEngine {
  constructor() {
    // Three.js audio components
    this.listener = null;
    this.audioLoader = new THREE.AudioLoader();

    // Scene reference (required for 3D positioning)
    this.scene = null;

    // Audio buffers cache
    this.buffers = {};

    // Active audio sources (for cleanup and debug visualization)
    this.activeAudioSources = [];

    // Active audio sources
    this.ambientMusic = null;
    this.heartbeatSound = null;
    this.ghostSounds = new Map(); // ghost entity -> PositionalAudio[]

    // Audio pools for one-shot sounds
    this.soundPools = {};

    // State
    this.initialized = false;
    this.currentState = AudioState.CALM;
    this.masterVolume = 0.8;
    this.sfxVolume = 1.0;
    this.musicVolume = 0.5;
    this.muted = false;

    // Fear/proximity system
    this.fearLevel = 0; // 0 to 1
    this.heartbeatPlaying = false;

    // Audio file paths (using new simple names)
    this.audioPaths = {
      // Ambient/Music
      ambient: "./assets/audio/ambient.mp3",

      // UI
      click: "./assets/audio/click.mp3",
      start: "./assets/audio/start.mp3",

      // Player
      step: "./assets/audio/step.mp3",
      death: "./assets/audio/death.mp3",
      scream: "./assets/audio/scream.mp3",
      bump: "./assets/audio/bump.mp3",

      // Ghost (3D positional)
      moan: "./assets/audio/moan.mp3",
      whisper: "./assets/audio/whisper.mp3",
      hit: "./assets/audio/hit.mp3",
      killRoar: "./assets/audio/killRoar.mp3",

      // Fear
      heart: "./assets/audio/heart.mp3",
    };

    // Distance settings for 3D audio
    this.distanceSettings = {
      refDistance: 5, // Distance at which volume is 100%
      maxDistance: 50, // Beyond this, sound is at minimum
      rolloffFactor: 1.5, // How quickly sound fades with distance
    };

    // Enabled flag for debug mode toggle
    this.enabled = true;

    // Audio debug visualization
    this.audioDebugEnabled = false;
    this.debugMarkers = [];
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /**
   * Initialize the audio engine - stores camera and scene reference for later use
   * Actual audio context creation happens on first user interaction
   * @param {THREE.Camera} camera - The player camera to attach listener to
   * @param {THREE.Scene} scene - The scene to add audio sources to (required for 3D positioning)
   */
  async init(camera, scene = null) {
    if (this.initialized) return;

    console.log("[SpatialAudio] Preparing (waiting for user interaction)...");

    // Store camera and scene for later - listener will be created on user interaction
    this.camera = camera;
    this.scene = scene;

    // Set up user interaction handler to actually initialize audio
    const initOnInteraction = async () => {
      if (this.listener) return; // Already initialized

      console.log(
        "[SpatialAudio] User interaction detected, initializing audio..."
      );

      // Create and attach AudioListener to camera
      this.listener = new THREE.AudioListener();
      this.camera.add(this.listener);

      // Resume audio context if suspended (required by browsers)
      if (this.listener.context.state === "suspended") {
        try {
          await this.listener.context.resume();
        } catch (e) {
          console.warn("[SpatialAudio] Could not resume audio context:", e);
        }
      }

      // Preload essential audio buffers
      await this._preloadAudio();

      this.initialized = true;
      console.log(
        "[SpatialAudio] Initialized successfully",
        this.scene ? "(with scene)" : "(no scene - 3D audio may not work!)"
      );

      // Remove listeners
      document.removeEventListener("click", initOnInteraction);
      document.removeEventListener("keydown", initOnInteraction);
      document.removeEventListener("touchstart", initOnInteraction);
    };

    document.addEventListener("click", initOnInteraction, { once: true });
    document.addEventListener("keydown", initOnInteraction, { once: true });
    document.addEventListener("touchstart", initOnInteraction, { once: true });
  }

  /**
   * Preload all audio files into buffers
   */
  async _preloadAudio() {
    const loadPromises = [];

    for (const [name, path] of Object.entries(this.audioPaths)) {
      loadPromises.push(
        this._loadBuffer(name, path).catch((err) => {
          console.warn(`[SpatialAudio] Could not load ${name}:`, err.message);
        })
      );
    }

    await Promise.all(loadPromises);
    console.log("[SpatialAudio] Audio buffers loaded");
  }

  /**
   * Load a single audio buffer
   */
  _loadBuffer(name, path) {
    return new Promise((resolve, reject) => {
      this.audioLoader.load(
        path,
        (buffer) => {
          this.buffers[name] = buffer;
          resolve(buffer);
        },
        undefined,
        reject
      );
    });
  }

  // ============================================================
  // AMBIENT / MUSIC
  // ============================================================

  /**
   * Start ambient background music
   */
  startAmbientMusic() {
    if (!this.initialized || this.muted) return;

    if (this.ambientMusic) {
      if (this.ambientMusic.isPlaying) return;
      this.ambientMusic.play();
      return;
    }

    const buffer = this.buffers.ambient;
    if (!buffer) return;

    this.ambientMusic = new THREE.Audio(this.listener);
    this.ambientMusic.setBuffer(buffer);
    this.ambientMusic.setLoop(true);
    this.ambientMusic.setVolume(this.musicVolume * this.masterVolume);
    this.ambientMusic.play();

    console.log("[SpatialAudio] Ambient music started");
  }

  /**
   * Stop ambient music
   */
  stopAmbientMusic() {
    if (this.ambientMusic && this.ambientMusic.isPlaying) {
      this.ambientMusic.stop();
    }
  }

  /**
   * Set ambient audio state (changes music/ambience based on game state)
   */
  setAudioState(state) {
    if (this.currentState === state) return;

    this.currentState = state;

    // Adjust music properties based on state
    if (this.ambientMusic) {
      switch (state) {
        case AudioState.CALM:
          this.ambientMusic.setVolume(this.musicVolume * this.masterVolume);
          // Could switch to calm track here
          break;
        case AudioState.TENSE:
          this.ambientMusic.setVolume(
            this.musicVolume * this.masterVolume * 0.7
          );
          break;
        case AudioState.CHASE:
          this.ambientMusic.setVolume(
            this.musicVolume * this.masterVolume * 0.5
          );
          // Could switch to chase music here
          break;
        case AudioState.DANGER:
          this.ambientMusic.setVolume(
            this.musicVolume * this.masterVolume * 0.3
          );
          break;
      }
    }

    console.log(`[SpatialAudio] Audio state: ${state}`);
  }

  // ============================================================
  // 3D POSITIONAL AUDIO (GHOST)
  // ============================================================

  /**
   * Create positional audio sources for a ghost entity
   * @param {THREE.Object3D} ghostMesh - The ghost's mesh to attach sounds to
   * @returns {Object} Audio controls for the ghost
   */
  createGhostAudio(ghostMesh) {
    if (!this.initialized) return null;

    const ghostAudio = {
      moan: this._createPositionalSound("moan", ghostMesh),
      whisper: this._createPositionalSound("whisper", ghostMesh),
      attack: this._createPositionalSound("hit", ghostMesh),
    };

    // Configure distance models
    for (const sound of Object.values(ghostAudio)) {
      if (sound) {
        sound.setRefDistance(this.distanceSettings.refDistance);
        sound.setMaxDistance(this.distanceSettings.maxDistance);
        sound.setRolloffFactor(this.distanceSettings.rolloffFactor);
        sound.setDistanceModel("exponential");
      }
    }

    this.ghostSounds.set(ghostMesh, ghostAudio);

    console.log("[SpatialAudio] Ghost audio created");
    return ghostAudio;
  }

  /**
   * Create a positional audio source attached to an object
   */
  _createPositionalSound(soundName, parent) {
    const buffer = this.buffers[soundName];
    if (!buffer) return null;

    const sound = new THREE.PositionalAudio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(this.sfxVolume * this.masterVolume);

    if (parent) {
      parent.add(sound);
    }

    return sound;
  }

  /**
   * Play ghost moan (3D positional)
   */
  playGhostMoan(ghostMesh) {
    const sounds = this.ghostSounds.get(ghostMesh);
    if (sounds?.moan && !sounds.moan.isPlaying) {
      sounds.moan.play();
    }
  }

  /**
   * Play ghost whisper (3D positional)
   */
  playGhostWhisper(ghostMesh) {
    const sounds = this.ghostSounds.get(ghostMesh);
    if (sounds?.whisper && !sounds.whisper.isPlaying) {
      sounds.whisper.play();
    }
  }

  /**
   * Play ghost attack sound (3D positional)
   */
  playGhostAttack(ghostMesh) {
    const sounds = this.ghostSounds.get(ghostMesh);
    if (sounds?.attack) {
      sounds.attack.stop();
      sounds.attack.play();
    }
  }

  // ============================================================
  // NON-POSITIONAL SOUNDS (UI, PLAYER)
  // ============================================================

  /**
   * Play a one-shot sound (non-positional)
   */
  playSound(soundName, volume = 1.0) {
    if (!this.initialized || this.muted) return;

    const buffer = this.buffers[soundName];
    if (!buffer) {
      console.warn(`[SpatialAudio] Sound not found: ${soundName}`);
      return;
    }

    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(volume * this.sfxVolume * this.masterVolume);
    sound.play();

    // Auto-cleanup when finished
    sound.onEnded = () => {
      sound.disconnect();
    };

    return sound;
  }

  /**
   * Play UI click sound
   */
  playClick() {
    this.playSound("click", 0.5);
  }

  /**
   * Play game start sound
   */
  playStart() {
    this.playSound("start", 0.7);
  }

  /**
   * Play footstep (rate-limited internally by caller)
   */
  playFootstep(isRunning = false) {
    const volume = isRunning ? 0.4 : 0.25;
    this.playSound("step", volume);
  }

  /**
   * Play wall bump sound
   */
  playBump() {
    this.playSound("bump", 0.3);
  }

  /**
   * Play death scream
   * @param {string} gender - 'male' or 'female'
   */
  playDeath(gender = "male") {
    const soundName = gender === "female" ? "scream" : "death";
    this.playSound(soundName, 1.0);
  }

  /**
   * Play impact/attack sound
   */
  playImpact() {
    this.playSound("hit", 0.9);
  }

  // ============================================================
  // PROXIMITY / FEAR SYSTEM
  // ============================================================

  /**
   * Update proximity-based audio (heartbeat, fear effects)
   * Call every frame with distance to nearest ghost
   * @param {number} distanceToGhost - Distance to nearest ghost in world units
   */
  updateProximity(distanceToGhost) {
    if (!this.initialized) return;

    // Calculate fear level (0 = calm, 1 = maximum fear)
    const dangerDistance = 20; // Start fear at this distance
    const panicDistance = 5; // Maximum fear at this distance

    if (distanceToGhost > dangerDistance) {
      this.fearLevel = 0;
    } else if (distanceToGhost < panicDistance) {
      this.fearLevel = 1;
    } else {
      this.fearLevel =
        1 -
        (distanceToGhost - panicDistance) / (dangerDistance - panicDistance);
    }

    // Update heartbeat based on fear
    this._updateHeartbeat();

    // Update audio state based on fear
    if (this.fearLevel > 0.8) {
      this.setAudioState(AudioState.DANGER);
    } else if (this.fearLevel > 0.5) {
      this.setAudioState(AudioState.CHASE);
    } else if (this.fearLevel > 0.2) {
      this.setAudioState(AudioState.TENSE);
    } else {
      this.setAudioState(AudioState.CALM);
    }
  }

  /**
   * Update heartbeat sound based on fear level
   */
  _updateHeartbeat() {
    // Start heartbeat if fear is high enough
    if (this.fearLevel > 0.3 && !this.heartbeatPlaying) {
      this._startHeartbeat();
    } else if (this.fearLevel < 0.2 && this.heartbeatPlaying) {
      this._stopHeartbeat();
    }

    // Adjust heartbeat volume and speed
    if (this.heartbeatSound && this.heartbeatPlaying) {
      // Volume scales with fear
      this.heartbeatSound.setVolume(
        this.fearLevel * 0.8 * this.sfxVolume * this.masterVolume
      );

      // Playback rate speeds up with fear (1.0 to 1.5)
      this.heartbeatSound.setPlaybackRate(1.0 + this.fearLevel * 0.5);
    }
  }

  /**
   * Start heartbeat loop
   */
  _startHeartbeat() {
    if (this.heartbeatPlaying) return;

    const buffer = this.buffers.heart;
    if (!buffer) return;

    if (!this.heartbeatSound) {
      this.heartbeatSound = new THREE.Audio(this.listener);
      this.heartbeatSound.setBuffer(buffer);
      this.heartbeatSound.setLoop(true);
    }

    this.heartbeatSound.setVolume(0.3 * this.sfxVolume * this.masterVolume);
    this.heartbeatSound.play();
    this.heartbeatPlaying = true;

    console.log("[SpatialAudio] Heartbeat started");
  }

  /**
   * Stop heartbeat loop
   */
  _stopHeartbeat() {
    if (!this.heartbeatPlaying) return;

    if (this.heartbeatSound && this.heartbeatSound.isPlaying) {
      this.heartbeatSound.stop();
    }
    this.heartbeatPlaying = false;

    console.log("[SpatialAudio] Heartbeat stopped");
  }

  // ============================================================
  // VOLUME CONTROLS
  // ============================================================

  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this._updateAllVolumes();
  }

  setMusicVolume(volume) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.ambientMusic) {
      this.ambientMusic.setVolume(this.musicVolume * this.masterVolume);
    }
  }

  setSfxVolume(volume) {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
  }

  _updateAllVolumes() {
    if (this.ambientMusic) {
      this.ambientMusic.setVolume(this.musicVolume * this.masterVolume);
    }
    if (this.heartbeatSound) {
      this.heartbeatSound.setVolume(
        this.fearLevel * 0.8 * this.sfxVolume * this.masterVolume
      );
    }
  }

  toggleMute() {
    this.muted = !this.muted;

    if (this.muted) {
      this.stopAmbientMusic();
      this._stopHeartbeat();
    } else {
      this.startAmbientMusic();
    }

    return this.muted;
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) {
      this.stopAmbientMusic();
      this._stopHeartbeat();
    }
  }

  // ============================================================
  // UTILITY
  // ============================================================

  /**
   * Play a 3D sound at a specific world position (one-shot)
   * FIXED: Now adds temp object to scene so Three.js can calculate world position
   * @param {string} soundName - Name of the sound to play
   * @param {THREE.Vector3} position - World position
   * @param {number} volume - Volume multiplier
   */
  playAtPosition(soundName, position, volume = 1.0) {
    if (!this.initialized || this.muted) return;

    const buffer = this.buffers[soundName];
    if (!buffer) {
      console.warn(`[SpatialAudio] Buffer not found: ${soundName}`);
      return;
    }

    // Create a temporary object at position
    const tempObject = new THREE.Object3D();
    tempObject.position.set(
      position.x || 0,
      position.y || 1.5, // Default height if not specified
      position.z || 0
    );
    tempObject.name = `audio_${soundName}_${Date.now()}`;

    // CRITICAL FIX: Add to scene so Three.js can calculate world position!
    if (this.scene) {
      this.scene.add(tempObject);
      tempObject.updateMatrixWorld(true); // Force matrix update
    } else {
      console.warn(
        "[SpatialAudio] No scene reference - 3D audio position may not work!"
      );
    }

    const sound = new THREE.PositionalAudio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(volume * this.sfxVolume * this.masterVolume);
    sound.setRefDistance(this.distanceSettings.refDistance);
    sound.setMaxDistance(this.distanceSettings.maxDistance);
    sound.setRolloffFactor(this.distanceSettings.rolloffFactor);
    sound.setDistanceModel("exponential"); // More realistic falloff

    tempObject.add(sound);

    // Track active audio source for cleanup
    if (!this.temporaryAudioObjects) {
      this.temporaryAudioObjects = new Set();
    }
    this.temporaryAudioObjects.add(tempObject);

    // Track active audio source for debug visualization
    const audioSource = {
      object: tempObject,
      sound: sound,
      soundName: soundName,
      startTime: Date.now(),
    };
    this.activeAudioSources.push(audioSource);

    // Create debug visualization marker if enabled
    if (this.audioDebugEnabled && this.scene) {
      this._createDebugMarker(tempObject, soundName);
    }

    sound.play();
    console.log(
      `[SpatialAudio] Playing 3D: ${soundName} at (${position.x?.toFixed(
        1
      )}, ${position.z?.toFixed(1)})`
    );

    // Cleanup when done
    sound.onEnded = () => {
      sound.disconnect();
      tempObject.remove(sound);

      // Remove from scene
      if (this.scene) {
        this.scene.remove(tempObject);
      }

      // Stop tracking
      if (this.temporaryAudioObjects) {
        this.temporaryAudioObjects.delete(tempObject);
      }

      // Remove from active sources
      const idx = this.activeAudioSources.indexOf(audioSource);
      if (idx > -1) {
        this.activeAudioSources.splice(idx, 1);
      }
    };

    return sound;
  }

  /**
   * Create a debug visualization marker at audio source position
   * @private
   */
  _createDebugMarker(parentObject, soundName) {
    // Color based on sound type
    const colors = {
      whisper: 0x4488ff, // Blue
      moan: 0x44ff88, // Green
      killRoar: 0xff4444, // Red
      hit: 0xffaa44, // Orange
      attack: 0xffaa44, // Orange
    };
    const color = colors[soundName] || 0xffffff;

    // Create glowing sphere
    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.7,
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.name = `debug_audio_${soundName}`;

    // Add pulsing ring
    const ringGeo = new THREE.RingGeometry(0.6, 0.8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2; // Lay flat
    marker.add(ring);

    parentObject.add(marker);
    this.debugMarkers.push({ marker, ring, startTime: Date.now() });

    // Animate and remove after 2 seconds
    const animate = () => {
      const elapsed =
        (Date.now() -
          this.debugMarkers[this.debugMarkers.length - 1]?.startTime) /
        1000;
      if (elapsed < 2) {
        // Pulse effect
        const scale = 1 + Math.sin(elapsed * 10) * 0.2;
        marker.scale.setScalar(scale);
        ring.scale.setScalar(1 + elapsed);
        ring.material.opacity = 0.5 * (1 - elapsed / 2);
        requestAnimationFrame(animate);
      } else {
        // Cleanup
        parentObject.remove(marker);
        geometry.dispose();
        material.dispose();
        ringGeo.dispose();
        ringMat.dispose();
      }
    };
    animate();
  }

  /**
   * Toggle audio debug visualization
   */
  toggleAudioDebug() {
    this.audioDebugEnabled = !this.audioDebugEnabled;
    console.log(
      `[SpatialAudio] Audio debug visualization: ${
        this.audioDebugEnabled ? "ON" : "OFF"
      }`
    );
    return this.audioDebugEnabled;
  }

  /**
   * Get current fear level (for UI/effects)
   */
  getFearLevel() {
    return this.fearLevel;
  }

  /**
   * Get current audio state
   */
  getAudioState() {
    return this.currentState;
  }

  /**
   * Resume audio context (call on user interaction)
   */
  async resume() {
    if (this.listener && this.listener.context.state === "suspended") {
      await this.listener.context.resume();
      console.log("[SpatialAudio] Audio context resumed");
    }
  }

  /**
   * Cleanup and dispose all audio resources
   */
  dispose() {
    this.stopAmbientMusic();
    this._stopHeartbeat();

    // Dispose ghost sounds
    for (const sounds of this.ghostSounds.values()) {
      for (const sound of Object.values(sounds)) {
        if (sound) {
          sound.stop();
          sound.disconnect();
        }
      }
    }
    this.ghostSounds.clear();

    // Clear buffers
    this.buffers = {};

    // Remove temporary objects
    if (this.temporaryAudioObjects) {
      this.temporaryAudioObjects.forEach((obj) => {
        if (this.scene) this.scene.remove(obj);
      });
      this.temporaryAudioObjects.clear();
    }

    // Remove listener from camera
    if (this.listener && this.listener.parent) {
      this.listener.parent.remove(this.listener);
    }

    this.initialized = false;
    console.log("[SpatialAudio] Disposed");
  }

  // ============================================================
  // MAIN UPDATE (called each frame from Game.js)
  // ============================================================

  /**
   * Main update method - call each frame with player and ghost positions
   * @param {number} deltaTime - Time since last frame
   * @param {THREE.Vector3} playerPos - Player position
   * @param {THREE.Vector3|null} ghostPos - Ghost position (or null if no ghost)
   */
  update(deltaTime, playerPos, ghostPos) {
    if (!this.initialized || !this.enabled) return;

    // Calculate distance to ghost for proximity effects
    if (playerPos && ghostPos) {
      const dx = playerPos.x - ghostPos.x;
      const dz = playerPos.z - ghostPos.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      this.updateProximity(distance);
    } else {
      // No ghost nearby, calm state
      this.updateProximity(100);
    }
  }

  /**
   * Play a ghost sound at a specific position (for Ghost.js integration)
   * @param {string} soundType - 'moan', 'whisper', or 'attack'
   * @param {THREE.Vector3|Object} position - Position with x, y, z
   */
  playGhostSound(soundType, position) {
    if (!this.initialized || !this.enabled || this.muted) return;

    // Map sound type to buffer name
    const soundMap = {
      moan: "moan",
      whisper: "whisper",
      attack: "hit",
      killRoar: "killRoar",
    };

    const soundName = soundMap[soundType] || soundType;

    // Convert position to Vector3 if needed
    const pos =
      position instanceof THREE.Vector3
        ? position
        : new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0);

    this.playAtPosition(soundName, pos, soundType === "attack" ? 1.0 : 0.6);
  }

  /**
   * Enable audio (for debug mode toggle)
   */
  enable() {
    this.enabled = true;
    console.log("[SpatialAudio] Enabled");
  }

  /**
   * Disable audio (for debug mode toggle)
   */
  disable() {
    this.enabled = false;
    this.stopAmbientMusic();
    this._stopHeartbeat();
    console.log("[SpatialAudio] Disabled");
  }

  /**
   * Toggle enabled state
   * @returns {boolean} New enabled state
   */
  toggleEnabled() {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.enabled;
  }

  /**
   * Check if audio is enabled
   */
  isEnabled() {
    return this.enabled;
  }
}

// Export audio states for external use
export { AudioState };

// Singleton instance
let spatialAudioInstance = null;

export function getSpatialAudioEngine() {
  if (!spatialAudioInstance) {
    spatialAudioInstance = new SpatialAudioEngine();
  }
  return spatialAudioInstance;
}
