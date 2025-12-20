/**
 * AudioManager - Handles all game audio including music, SFX, and ambient sounds
 */
export class AudioManager {
  constructor() {
    // Audio context for advanced audio handling
    this.audioContext = null;
    
    // Volume settings (0-1)
    this.masterVolume = 0.7;
    this.musicVolume = 0.5;
    this.sfxVolume = 0.8;
    
    // Audio elements cache
    this.sounds = {};
    this.music = null;
    this.musicBuffer = null; // For seamless looping
    
    // State
    this.initialized = false;
    this.muted = false;
    this.isInBackground = false;
    this.wasPlayingBeforeBackground = false;
    
    // Audio paths
    this.audioPaths = {
      // Music
      background: './assets/audio/background.mp3',
      
      // UI Sounds
      buttonClick: './assets/audio/button_click.mp3',
      gameStart: './assets/audio/game_start.mp3',
      
      // Player Sounds
      footstep: './assets/audio/footstep.mp3',
      deathScream: './assets/audio/death_scream.mp3',
      deathScreamFemale: './assets/audio/death_scream_female.mp3',
      wallHit: './assets/audio/wall_hit.mp3',
      
      // Ghost/Horror Sounds
      ghostMoan: './assets/audio/ghost_moan.mp3',
      ghostWhisper: './assets/audio/ghost_whisper.mp3',
      heartbeat: './assets/audio/heartbeat.mp3',
      impact: './assets/audio/impact.mp3',
    };
    
    // Footstep timing
    this.lastFootstepTime = 0;
    this.footstepInterval = 400; // ms between footsteps
    
    // Heartbeat state
    this.heartbeatPlaying = false;
    this.heartbeatAudio = null;
    
    // Preload all sounds
    this._preloadSounds();
    
    // Setup visibility change listener for background pause
    this._setupVisibilityHandler();
  }

  /**
   * Play death scream
   * @param {string} gender - 'male' or 'female'
   */
  playDeathScream(gender = 'male') {
    if (gender === 'female') {
      this.play('deathScreamFemale', { volume: 1.0 });
    } else {
      this.play('deathScream', { volume: 1.0 });
    }
  }
  
  /**
   * Setup visibility change handler to pause audio when app goes to background
   */
  _setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // App went to background - pause all audio
        console.log('AudioManager: App in background, pausing audio');
        this.isInBackground = true;
        this.wasPlayingBeforeBackground = this.music && !this.music.paused;
        this._pauseAllAudio();
      } else {
        // App came to foreground - resume audio if it was playing
        console.log('AudioManager: App in foreground, resuming audio');
        this.isInBackground = false;
        if (this.wasPlayingBeforeBackground && !this.muted) {
          this._resumeAllAudio();
        }
      }
    });
    
    // Also handle page blur/focus for better mobile support
    window.addEventListener('blur', () => {
      if (!this.isInBackground) {
        this.isInBackground = true;
        this.wasPlayingBeforeBackground = this.music && !this.music.paused;
        this._pauseAllAudio();
      }
    });
    
    window.addEventListener('focus', () => {
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
    if (this.music && !this.music.paused) {
      this.music.pause();
    }
    if (this.heartbeatAudio && !this.heartbeatAudio.paused) {
      this.heartbeatAudio.pause();
    }
  }
  
  /**
   * Resume audio that was playing before background
   */
  _resumeAllAudio() {
    if (this.music) {
      this.music.play().catch(() => {});
    }
    if (this.heartbeatPlaying && this.heartbeatAudio) {
      this.heartbeatAudio.play().catch(() => {});
    }
  }
  
  /**
   * Initialize audio context (must be called after user interaction)
   */
  init() {
    if (this.initialized) return;
    
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();
      this.initialized = true;
      console.log('AudioManager: Initialized with state:', this.audioContext.state);
    } catch (e) {
      console.warn('AudioManager: Could not create AudioContext', e);
    }
  }

  /**
   * Unlock audio context (iOS requirement) - must be called on user interaction
   */
  unlockAudio() {
    if (!this.initialized) this.init();
    
    const ctx = this.audioContext;
    if (!ctx) return;
    
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        console.log('AudioManager: AudioContext resumed successfully');
      }).catch(e => console.warn('AudioManager: Resume failed', e));
    }
    
    // Play silent buffer to force unlock
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      console.log('AudioManager: Silent buffer played to unlock audio');
    } catch (e) {
      // Ignore
    }
  }
  
  /**
   * Preload all sound files
   */
  _preloadSounds() {
    for (const [name, path] of Object.entries(this.audioPaths)) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = path;
      
      // Set default volumes
      if (name === 'background') {
        audio.loop = true;
        audio.volume = this.musicVolume * this.masterVolume;
      } else {
        audio.volume = this.sfxVolume * this.masterVolume;
      }
      
      this.sounds[name] = audio;
    }
    
    console.log('AudioManager: Sounds preloaded');
  }
  
  /**
   * Play a sound effect
   */
  play(soundName, options = {}) {
    if (this.muted) return;
    
    const sound = this.sounds[soundName];
    if (!sound) {
      console.warn(`AudioManager: Sound "${soundName}" not found`);
      return;
    }
    
    // Initialize on first user interaction
    if (!this.initialized) {
      this.init();
    }
    
    // Clone audio for overlapping sounds
    const audio = options.overlap ? sound.cloneNode() : sound;
    
    // Set volume
    const volume = options.volume !== undefined ? options.volume : 1;
    audio.volume = volume * this.sfxVolume * this.masterVolume;
    
    // Set loop
    audio.loop = options.loop || false;
    
    // Reset and play
    audio.currentTime = 0;
    audio.play().catch(e => {
      // Ignore autoplay errors - user hasn't interacted yet
      if (e.name !== 'NotAllowedError') {
        console.warn(`AudioManager: Could not play "${soundName}":`, e);
      }
    });
    
    return audio;
  }
  
  /**
   * Stop a sound
   */
  stop(soundName) {
    const sound = this.sounds[soundName];
    if (sound) {
      sound.pause();
      sound.currentTime = 0;
    }
  }
  
  /**
   * Start background music with seamless looping
   */
  startMusic() {
    if (this.muted || this.isInBackground) return;
    
    if (!this.initialized) {
      this.init();
    }
    
    const music = this.sounds.background;
    if (music) {
      music.volume = this.musicVolume * this.masterVolume;
      music.loop = true;
      
      music.play().catch(e => {
        if (e.name !== 'NotAllowedError') {
          console.warn('AudioManager: Could not start music:', e);
        }
      });
      this.music = music;
      console.log('AudioManager: Music started');
    }
  }
  
  /**
   * Setup seamless looping with crossfade to eliminate the gap
   */
  _setupSeamlessLoop(audio) {
    // Clear any previous listener
    audio.removeEventListener('timeupdate', audio._loopHandler);
    
    // Crossfade duration
    const crossfadeDuration = 2.0; // seconds
    
    audio._loopHandler = () => {
      const timeRemaining = audio.duration - audio.currentTime;
      
      // Start fading out near the end
      if (timeRemaining <= crossfadeDuration && timeRemaining > 0) {
        const fadeProgress = timeRemaining / crossfadeDuration;
        audio.volume = fadeProgress * this.musicVolume * this.masterVolume;
        
        // Reset to beginning with fade in when very close to end
        if (timeRemaining <= 0.1) {
          audio.currentTime = 0;
          audio.volume = this.musicVolume * this.masterVolume;
        }
      }
    };
    
    audio.addEventListener('timeupdate', audio._loopHandler);
  }
  
  /**
   * Stop background music
   */
  stopMusic() {
    if (this.music) {
      this.music.pause();
      this.music.currentTime = 0;
      console.log('AudioManager: Music stopped');
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
    this.play('buttonClick', { volume: 0.6 });
  }
  
  /**
   * Play game start sound
   */
  playGameStart() {
    this.play('gameStart', { volume: 0.8 });
  }
  
  /**
   * Play footstep sound (with rate limiting)
   */
  playFootstep(isRunning = false) {
    const now = Date.now();
    const interval = isRunning ? this.footstepInterval * 0.6 : this.footstepInterval;
    
    if (now - this.lastFootstepTime >= interval) {
      this.lastFootstepTime = now;
      this.play('footstep', { 
        volume: isRunning ? 0.5 : 0.3,
        overlap: true 
      });
    }
  }
  

  
  /**
   * Play wall hit sound
   */
  playWallHit() {
    this.play('wallHit', { volume: 0.4, overlap: true });
  }
  
  /**
   * Play ghost moan
   */
  playGhostMoan() {
    this.play('ghostMoan', { volume: 0.6 });
  }
  
  /**
   * Play ghost whisper (when ghost spots player)
   */
  playGhostWhisper() {
    this.play('ghostWhisper', { volume: 0.8 });
  }
  
  /**
   * Start heartbeat (when ghost is near)
   */
  startHeartbeat() {
    if (this.heartbeatPlaying || this.muted) return;
    
    this.heartbeatAudio = this.play('heartbeat', { loop: true, volume: 0.7 });
    this.heartbeatPlaying = true;
    console.log('AudioManager: Heartbeat started');
  }
  
  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (!this.heartbeatPlaying) return;
    
    if (this.heartbeatAudio) {
      this.heartbeatAudio.pause();
      this.heartbeatAudio.currentTime = 0;
    }
    this.stop('heartbeat');
    this.heartbeatPlaying = false;
    console.log('AudioManager: Heartbeat stopped');
  }
  
  /**
   * Adjust heartbeat intensity based on distance
   */
  updateHeartbeatIntensity(distance) {
    if (!this.heartbeatAudio || !this.heartbeatPlaying) return;
    
    // Closer = louder, max volume at distance 5 or less
    const maxDistance = 20;
    const minDistance = 5;
    const normalizedDistance = Math.max(minDistance, Math.min(maxDistance, distance));
    const intensity = 1 - ((normalizedDistance - minDistance) / (maxDistance - minDistance));
    
    this.heartbeatAudio.volume = intensity * 0.8 * this.sfxVolume * this.masterVolume;
    
    // Speed up playback when very close (experimental)
    // this.heartbeatAudio.playbackRate = 1 + (intensity * 0.5);
  }
  
  /**
   * Play impact sound (ghost attack)
   */
  playImpact() {
    this.play('impact', { volume: 0.9 });
  }
  
  /**
   * Set master volume
   */
  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this._updateAllVolumes();
  }
  
  /**
   * Set music volume
   */
  setMusicVolume(volume) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.music) {
      this.music.volume = this.musicVolume * this.masterVolume;
    }
  }
  
  /**
   * Set SFX volume
   */
  setSfxVolume(volume) {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
  }
  
  /**
   * Update all sound volumes
   */
  _updateAllVolumes() {
    for (const [name, audio] of Object.entries(this.sounds)) {
      if (name === 'background') {
        audio.volume = this.musicVolume * this.masterVolume;
      } else {
        audio.volume = this.sfxVolume * this.masterVolume;
      }
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
    } else {
      this.resumeMusic();
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
    } else {
      this.resumeMusic();
    }
  }
  
  /**
   * Cleanup
   */
  dispose() {
    this.stopMusic();
    this.stopHeartbeat();
    
    for (const audio of Object.values(this.sounds)) {
      audio.pause();
      audio.src = '';
    }
    
    this.sounds = {};
    
    if (this.audioContext) {
      this.audioContext.close();
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
