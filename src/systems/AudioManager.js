/**
 * AudioManager - High-performance game audio using Web Audio API
 * Features: Low-latency playback, simultaneous sounds, audio pooling
 */
export class AudioManager {
  constructor() {
    // Web Audio API context
    this.audioContext = null;

    // Master gain node for global volume control
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;

    // Volume settings (0-1)
    this.masterVolume = 0.7;
    this.musicVolume = 0.5;
    this.sfxVolume = 0.8;

    // Audio buffers cache (decoded audio data for instant playback)
    this.buffers = {};

    // Currently playing sources for looping sounds
    this.activeSources = {};

    // HTML5 Audio fallback for music (better for long audio)
    this.music = null;

    // State
    this.initialized = false;
    this.muted = false;
    this.isInBackground = false;
    this.wasPlayingBeforeBackground = false;
    this.buffersLoaded = false;

    // Audio paths
    this.audioPaths = {
      // Music (uses HTML5 Audio for streaming)
      background: "./assets/audio/ambient.mp3",

      // UI Sounds
      buttonClick: "./assets/audio/click.mp3",
      gameStart: "./assets/audio/start.mp3",

      // Player Sounds
      footstep: "./assets/audio/footstep.mp3",
      run: "./assets/audio/run.wav",
      deathScream: "./assets/audio/death.mp3",
      deathScreamFemale: "./assets/audio/scream.mp3",
      wallHit: "./assets/audio/bump.mp3",
      ouch: "./assets/audio/ouch.mp3",

      // Ghost/Horror Sounds
      ghostMoan: "./assets/audio/moan.mp3",
      ghostWhisper: "./assets/audio/whisper.mp3",
      heartbeat: "./assets/audio/heart.mp3",
      impact: "./assets/audio/hit.mp3",
    };

    // Footstep timing
    this.lastFootstepTime = 0;
    this.footstepInterval = 500; // ms between footsteps
    this.footstepHandle = null;
    this.currentFootstepType = null;

    // Heartbeat state
    this.heartbeatSource = null;
    this.heartbeatGain = null;
    this.heartbeatPlaying = false;

    // Setup visibility change listener for background pause
    this._setupVisibilityHandler();
  }

  /**
   * Initialize Web Audio API context (must be called after user interaction)
   */
  init() {
    if (this.initialized) return Promise.resolve();

    return new Promise((resolve) => {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();

        // Create gain nodes for volume control
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.masterVolume;
        this.masterGain.connect(this.audioContext.destination);

        this.musicGain = this.audioContext.createGain();
        this.musicGain.gain.value = this.musicVolume;
        this.musicGain.connect(this.masterGain);

        this.sfxGain = this.audioContext.createGain();
        this.sfxGain.gain.value = this.sfxVolume;
        this.sfxGain.connect(this.masterGain);

        this.initialized = true;

        // Auto-resume on user interaction to handle browser policy
        const resumeAudio = () => {
          if (this.audioContext && this.audioContext.state === "suspended") {
            this.audioContext.resume().then(() => {
              console.log("AudioManager: Context resumed by user interaction");
            });
          }
          document.removeEventListener("click", resumeAudio);
          document.removeEventListener("keydown", resumeAudio);
        };
        document.addEventListener("click", resumeAudio);
        document.addEventListener("keydown", resumeAudio);

        console.log(
          "AudioManager: Web Audio API initialized, state:",
          this.audioContext.state,
        );

        // Preload all sound buffers
        this._preloadBuffers().then(() => {
          this.buffersLoaded = true;
          console.log("AudioManager: All audio buffers loaded");
          resolve();
        });
      } catch (e) {
        console.warn("AudioManager: Could not create AudioContext", e);
        resolve();
      }
    });
  }

  /**
   * Unlock audio context (iOS/mobile requirement)
   */
  unlockAudio() {
    if (!this.initialized) {
      this.init();
      return;
    }

    const ctx = this.audioContext;
    if (!ctx) return;

    if (ctx.state === "suspended") {
      ctx
        .resume()
        .then(() => {
          console.log("AudioManager: AudioContext resumed successfully");
        })
        .catch((e) => console.warn("AudioManager: Resume failed", e));
    }

    // Play silent buffer to force unlock
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Preload all audio files as decoded buffers for instant playback
   */
  async _preloadBuffers() {
    const loadPromises = [];

    for (const [name, path] of Object.entries(this.audioPaths)) {
      // Skip background music - it uses HTML5 Audio for streaming
      if (name === "background") continue;

      const promise = this._loadBuffer(name, path);
      loadPromises.push(promise);
    }

    await Promise.all(loadPromises);
  }

  /**
   * Load a single audio file into a buffer
   */
  async _loadBuffer(name, path) {
    try {
      const response = await fetch(path);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.buffers[name] = audioBuffer;
    } catch (e) {
      console.warn(`AudioManager: Failed to load "${name}" from ${path}:`, e);
    }
  }

  /**
   * Play a sound effect using Web Audio API (instant, low-latency)
   */
  play(soundName, options = {}) {
    if (this.muted) return null;
    if (!this.audioContext) {
      this.init();
      return null;
    }

    // Resume context if suspended
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }

    const buffer = this.buffers[soundName];
    if (!buffer) {
      console.warn(`AudioManager: Buffer "${soundName}" not loaded yet`);
      return null;
    }

    // Create source node (cheap, can create many)
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    // Create individual gain for this sound
    const gainNode = this.audioContext.createGain();
    const volume = options.volume !== undefined ? options.volume : 1;
    gainNode.gain.value = volume;

    // Connect: source -> gain -> sfxGain -> masterGain -> destination
    source.connect(gainNode);
    gainNode.connect(this.sfxGain);

    // Set loop
    source.loop = options.loop || false;

    // Start immediately
    source.start(0);

    // Return handle for control
    return { source, gainNode };
  }

  /**
   * Stop a looping sound
   */
  stopSource(handle) {
    if (handle && handle.source) {
      try {
        handle.source.stop();
      } catch (e) {
        // Already stopped
      }
    }
  }

  /**
   * Setup visibility change handler to pause audio when app goes to background
   */
  _setupVisibilityHandler() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        console.log("AudioManager: App in background, pausing audio");
        this.isInBackground = true;
        this.wasPlayingBeforeBackground = this.music && !this.music.paused;
        this._pauseAllAudio();
      } else {
        console.log("AudioManager: App in foreground, resuming audio");
        this.isInBackground = false;
        if (this.wasPlayingBeforeBackground && !this.muted) {
          this._resumeAllAudio();
        }
      }
    });

    window.addEventListener("blur", () => {
      if (!this.isInBackground) {
        this.isInBackground = true;
        this.wasPlayingBeforeBackground = this.music && !this.music.paused;
        this._pauseAllAudio();
      }
    });

    window.addEventListener("focus", () => {
      if (this.isInBackground) {
        this.isInBackground = false;
        if (this.wasPlayingBeforeBackground && !this.muted) {
          this._resumeAllAudio();
        }
      }
    });
  }

  /**
   * Pause all playing audio
   */
  _pauseAllAudio() {
    if (this.audioContext && this.audioContext.state === "running") {
      this.audioContext.suspend();
    }
    if (this.music && !this.music.paused) {
      this.music.pause();
    }
  }

  /**
   * Resume audio that was playing before background
   */
  _resumeAllAudio() {
    if (this.audioContext && this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
    if (this.music) {
      this.music.play().catch(() => {});
    }
  }

  /**
   * Play death scream
   */
  playDeathScream(gender = "male") {
    if (gender === "female") {
      this.play("deathScreamFemale", { volume: 1.0 });
    } else {
      this.play("deathScream", { volume: 1.0 });
    }
  }

  /**
   * Start background music (uses HTML5 Audio for efficient streaming)
   */
  startMusic() {
    if (this.muted || this.isInBackground) return;

    if (!this.music) {
      this.music = new Audio(this.audioPaths.background);
      this.music.loop = true;
    }

    this.music.volume = this.musicVolume * this.masterVolume;
    this.music.play().catch((e) => {
      if (e.name !== "NotAllowedError") {
        console.warn("AudioManager: Could not start music:", e);
      }
    });
    console.log("AudioManager: Music started");
  }

  /**
   * Stop background music
   */
  stopMusic() {
    if (this.music) {
      this.music.pause();
      this.music.currentTime = 0;
      console.log("AudioManager: Music stopped");
    }
  }

  /**
   * Pause background music
   */
  pauseMusic() {
    if (this.music) {
      this.music.pause();
    }
  }

  /**
   * Resume background music
   */
  resumeMusic() {
    if (this.music && !this.muted) {
      this.music.play().catch(() => {});
    }
  }

  /**
   * Play button click sound
   */
  playButtonClick() {
    this.play("buttonClick", { volume: 0.6 });
  }

  /**
   * Play game start sound
   */
  playGameStart() {
    this.play("gameStart", { volume: 0.8 });
  }

  /**
   * Play footstep sound (with rate limiting)
   */
  playFootstep(isRunning = false) {
    const soundKey = isRunning ? "run" : "footstep";

    // If already playing the correct sound, just return
    if (this.footstepHandle && this.currentFootstepType === soundKey) {
      return;
    }

    // If playing the wrong sound, stop it first
    if (this.footstepHandle) {
      this.stopFootstep();
    }

    // Start the new sound in a loop
    this.currentFootstepType = soundKey;
    this.footstepHandle = this.play(soundKey, {
      volume: isRunning ? 0.6 : 0.4,
      loop: true,
    });
  }

  /**
   * Stop footstep sound
   */
  stopFootstep() {
    if (this.footstepHandle) {
      this.stopSource(this.footstepHandle);
      this.footstepHandle = null;
      this.currentFootstepType = null;
    }
  }

  /**
   * Play wall hit sound
   */
  playWallHit() {
    this.play("wallHit", { volume: 0.4 });
  }

  /**
   * Play ghost moan
   */
  playGhostMoan() {
    this.play("ghostMoan", { volume: 0.6 });
  }

  /**
   * Play ghost whisper
   */
  playGhostWhisper() {
    this.play("ghostWhisper", { volume: 0.8 });
  }

  /**
   * Start heartbeat (when ghost is near)
   */
  startHeartbeat() {
    if (this.heartbeatPlaying || this.muted) return;
    if (!this.audioContext || !this.buffers.heartbeat) return;

    const buffer = this.buffers.heartbeat;

    // Create source
    this.heartbeatSource = this.audioContext.createBufferSource();
    this.heartbeatSource.buffer = buffer;
    this.heartbeatSource.loop = true;

    // Create dedicated gain for intensity control
    this.heartbeatGain = this.audioContext.createGain();
    this.heartbeatGain.gain.value = 0.7;

    this.heartbeatSource.connect(this.heartbeatGain);
    this.heartbeatGain.connect(this.sfxGain);

    this.heartbeatSource.start(0);
    this.heartbeatPlaying = true;
    console.log("AudioManager: Heartbeat started");
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (!this.heartbeatPlaying) return;

    if (this.heartbeatSource) {
      try {
        this.heartbeatSource.stop();
      } catch (e) {
        // Already stopped
      }
      this.heartbeatSource = null;
    }
    this.heartbeatGain = null;
    this.heartbeatPlaying = false;
    console.log("AudioManager: Heartbeat stopped");
  }

  /**
   * Adjust heartbeat intensity based on distance
   */
  updateHeartbeatIntensity(distance) {
    if (!this.heartbeatGain || !this.heartbeatPlaying) return;

    const maxDistance = 20;
    const minDistance = 5;
    const normalizedDistance = Math.max(
      minDistance,
      Math.min(maxDistance, distance),
    );
    const intensity =
      1 - (normalizedDistance - minDistance) / (maxDistance - minDistance);

    // Update gain
    this.heartbeatGain.gain.value = intensity * 0.8;

    // Speed up playback when very close
    if (this.heartbeatSource) {
      this.heartbeatSource.playbackRate.value = 1 + intensity * 0.8;
    }
  }

  /**
   * Play impact sound (ghost attack)
   */
  playImpact() {
    this.play("impact", { volume: 0.9 });
  }

  /**
   * Play ouch sound (trap damage) - instant via Web Audio API
   */
  playOuch() {
    this.play("ouch", { volume: 0.8 });
  }

  /**
   * Set master volume
   */
  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.masterVolume;
    }
    if (this.music) {
      this.music.volume = this.musicVolume * this.masterVolume;
    }
  }

  /**
   * Set music volume
   */
  setMusicVolume(volume) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.musicGain) {
      this.musicGain.gain.value = this.musicVolume;
    }
    if (this.music) {
      this.music.volume = this.musicVolume * this.masterVolume;
    }
  }

  /**
   * Set SFX volume
   */
  setSfxVolume(volume) {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    if (this.sfxGain) {
      this.sfxGain.gain.value = this.sfxVolume;
    }
  }

  /**
   * Toggle mute
   */
  toggleMute() {
    this.muted = !this.muted;

    if (this.muted) {
      this.pauseMusic();
      this.stopHeartbeat();
      if (this.masterGain) {
        this.masterGain.gain.value = 0;
      }
    } else {
      this.resumeMusic();
      if (this.masterGain) {
        this.masterGain.gain.value = this.masterVolume;
      }
    }

    return this.muted;
  }

  /**
   * Set muted state
   */
  setMuted(muted) {
    this.muted = muted;

    if (this.muted) {
      this.pauseMusic();
      this.stopHeartbeat();
      if (this.masterGain) {
        this.masterGain.gain.value = 0;
      }
    } else {
      this.resumeMusic();
      if (this.masterGain) {
        this.masterGain.gain.value = this.masterVolume;
      }
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    this.stopMusic();
    this.stopHeartbeat();

    if (this.music) {
      this.music.pause();
      this.music.src = "";
      this.music = null;
    }

    this.buffers = {};

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Global singleton for easy access
let audioManagerInstance = null;

export function getAudioManager() {
  if (!audioManagerInstance) {
    audioManagerInstance = new AudioManager();
  }
  return audioManagerInstance;
}
