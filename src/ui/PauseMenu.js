/**
 * PauseMenu - Handles in-game pause menu with audio and graphics settings
 */
import { getAudioManager } from "../systems/AudioManager.js";

export class PauseMenu {
  constructor(game) {
    this.game = game;
    this.isPaused = false;
    this.isMultiplayer = false; // Will be set based on game mode

    // Cache DOM elements
    this.elements = {
      pauseMenu: document.getElementById("pause-menu"),
      pauseButton: document.getElementById("pause-button"),

      // Audio controls
      musicVolume: document.getElementById("pause-music-volume"),
      musicValue: document.getElementById("pause-music-value"),
      sfxVolume: document.getElementById("pause-sfx-volume"),
      sfxValue: document.getElementById("pause-sfx-value"),
      musicToggle: document.getElementById("pause-music-toggle"),

      // Graphics controls
      qualityButtons: document.querySelectorAll("[data-pause-quality]"),
      shadowsToggle: document.getElementById("pause-shadows-toggle"),
      sensitivitySlider: document.getElementById("pause-sensitivity-slider"),
      sensitivityValue: document.getElementById("pause-sensitivity-value"),

      // Buttons
      resumeBtn: document.getElementById("btn-resume"),
      quitBtn: document.getElementById("btn-quit-game"),
    };

    // Settings state
    this.settings = {
      musicVolume: 50,
      sfxVolume: 80,
      musicEnabled: true,
      graphicsQuality: "medium",
      shadowsEnabled: true,
      lookSensitivity: 100,
    };

    // Load saved settings
    this.loadSettings();

    // Bind events
    this._bindEvents();

    // Apply initial settings
    this._applySettings();

    console.log("PauseMenu: Initialized");
  }

  _bindEvents() {
    // Pause button click
    if (this.elements.pauseButton) {
      this.elements.pauseButton.addEventListener("click", () => this.toggle());
      this.elements.pauseButton.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this.toggle();
      });
    }

    // ESC key to toggle pause
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        this.toggle();
      }
    });

    // Resume button
    if (this.elements.resumeBtn) {
      this.elements.resumeBtn.addEventListener("click", () => this.resume());
      this.elements.resumeBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this.resume();
      });
    }

    // Quit button
    if (this.elements.quitBtn) {
      this.elements.quitBtn.addEventListener("click", () => this.quitToMenu());
      this.elements.quitBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this.quitToMenu();
      });
    }

    // Reset Campaign button
    const resetBtn = document.getElementById("btn-reset-campaign");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (
          confirm(
            "Are you sure? This will delete your progress and restart from Stage 1."
          )
        ) {
          this.game.resetCampaign();
        }
      });
    }

    // Music volume slider
    if (this.elements.musicVolume) {
      this.elements.musicVolume.addEventListener("input", (e) => {
        this.settings.musicVolume = parseInt(e.target.value);
        this.elements.musicValue.textContent = `${this.settings.musicVolume}%`;
        getAudioManager().setMusicVolume(this.settings.musicVolume / 100);
        this.saveSettings();
      });
    }

    // SFX volume slider
    if (this.elements.sfxVolume) {
      this.elements.sfxVolume.addEventListener("input", (e) => {
        this.settings.sfxVolume = parseInt(e.target.value);
        this.elements.sfxValue.textContent = `${this.settings.sfxVolume}%`;
        getAudioManager().setSfxVolume(this.settings.sfxVolume / 100);
        this.saveSettings();
      });
    }

    // Music toggle
    if (this.elements.musicToggle) {
      const handler = (e) => {
        e.preventDefault();
        this.settings.musicEnabled = !this.settings.musicEnabled;
        this._updateMusicToggle();

        if (this.settings.musicEnabled) {
          getAudioManager().resumeMusic();
        } else {
          getAudioManager().pauseMusic();
        }
        this.saveSettings();
      };
      this.elements.musicToggle.addEventListener("click", handler);
      this.elements.musicToggle.addEventListener("touchstart", handler);
    }

    // Quality buttons
    this.elements.qualityButtons.forEach((btn) => {
      const handler = (e) => {
        e.preventDefault();
        this.setQuality(btn.dataset.pauseQuality);
      };
      btn.addEventListener("click", handler);
      btn.addEventListener("touchstart", handler);
    });

    // Shadows toggle
    if (this.elements.shadowsToggle) {
      const handler = (e) => {
        e.preventDefault();
        this.settings.shadowsEnabled = !this.settings.shadowsEnabled;
        this._updateShadowsToggle();
        this._applyShadowsSetting();
        this.saveSettings();
      };
      this.elements.shadowsToggle.addEventListener("click", handler);
      this.elements.shadowsToggle.addEventListener("touchstart", handler);
    }

    // Sensitivity slider
    if (this.elements.sensitivitySlider) {
      this.elements.sensitivitySlider.addEventListener("input", (e) => {
        this.settings.lookSensitivity = parseInt(e.target.value);
        this.elements.sensitivityValue.textContent = `${this.settings.lookSensitivity}%`;
        this._applySensitivitySetting();
        this.saveSettings();
      });
    }
  }

  toggle() {
    // Don't allow pausing in multiplayer mode
    if (this.isMultiplayer) {
      console.log("PauseMenu: Cannot pause in multiplayer mode");
      return;
    }

    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  pause() {
    // Don't allow pausing in multiplayer mode
    if (this.isMultiplayer) {
      console.log("PauseMenu: Cannot pause in multiplayer mode");
      return;
    }

    if (this.isPaused) return;

    this.isPaused = true;

    // Show pause menu
    this.elements.pauseMenu?.classList.remove("hidden");

    // Exit pointer lock
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Pause audio
    getAudioManager().pauseMusic();

    // Notify game to pause (optional - freeze physics, etc)
    if (this.game && typeof this.game.onPause === "function") {
      this.game.onPause();
    }

    console.log("Game paused");
  }

  resume() {
    if (!this.isPaused) return;

    this.isPaused = false;

    // Hide pause menu
    this.elements.pauseMenu?.classList.add("hidden");

    // Resume audio if enabled
    if (this.settings.musicEnabled) {
      getAudioManager().resumeMusic();
    }

    // Re-request pointer lock
    // Request pointer lock
    if (!this.game.touchControls || !this.game.touchControls.isMobile()) {
      document.body.requestPointerLock();
    }

    // Show touch controls if active
    if (
      this.game &&
      this.game.touchControls &&
      this.game.touchControls.isMobile()
    ) {
      this.game.touchControls.setVisible(true);
    }

    // Notify game to resume
    if (this.game && typeof this.game.onResume === "function") {
      this.game.onResume();
    }

    console.log("Game resumed");
  }

  quitToMenu() {
    this.isPaused = false;
    this.elements.pauseMenu?.classList.add("hidden");

    // Stop all audio
    getAudioManager().stopMusic();
    getAudioManager().stopHeartbeat();

    // Hide pause button
    this.elements.pauseButton?.classList.add("hidden");

    // Exit pointer lock
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Reload page to return to menu (simplest approach)
    // In a more complex setup, you'd destroy the game instance and show menu
    location.reload();
  }

  setQuality(quality) {
    this.settings.graphicsQuality = quality;

    // Update UI
    this.elements.qualityButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.pauseQuality === quality);
    });

    // Apply quality settings to renderer
    this._applyQualitySetting();
    this.saveSettings();
  }

  _applySettings() {
    const audio = getAudioManager();

    // Audio settings
    audio.setMusicVolume(this.settings.musicVolume / 100);
    audio.setSfxVolume(this.settings.sfxVolume / 100);

    if (!this.settings.musicEnabled) {
      audio.pauseMusic();
    }

    // Update UI
    if (this.elements.musicVolume) {
      this.elements.musicVolume.value = this.settings.musicVolume;
      this.elements.musicValue.textContent = `${this.settings.musicVolume}%`;
    }
    if (this.elements.sfxVolume) {
      this.elements.sfxVolume.value = this.settings.sfxVolume;
      this.elements.sfxValue.textContent = `${this.settings.sfxVolume}%`;
    }

    this._updateMusicToggle();
    this._updateShadowsToggle();

    // Update quality buttons
    this.elements.qualityButtons.forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.pauseQuality === this.settings.graphicsQuality
      );
    });

    // Apply graphics settings (with delay to ensure game is loaded)
    setTimeout(() => {
      this._applyQualitySetting();
      this._applyShadowsSetting();
      this._applySensitivitySetting();
    }, 100);
  }

  _updateMusicToggle() {
    if (this.elements.musicToggle) {
      this.elements.musicToggle.classList.toggle(
        "active",
        this.settings.musicEnabled
      );
      const label = this.elements.musicToggle.querySelector(".toggle-label");
      if (label) label.textContent = this.settings.musicEnabled ? "ON" : "OFF";
    }
  }

  _updateShadowsToggle() {
    if (this.elements.shadowsToggle) {
      this.elements.shadowsToggle.classList.toggle(
        "active",
        this.settings.shadowsEnabled
      );
      const label = this.elements.shadowsToggle.querySelector(".toggle-label");
      if (label)
        label.textContent = this.settings.shadowsEnabled ? "ON" : "OFF";
    }
  }

  _applyQualitySetting() {
    if (!this.game || !this.game.renderer) return;

    // Access the actual THREE.WebGLRenderer instance
    const rendererInstance = this.game.renderer.instance;
    const quality = this.settings.graphicsQuality;

    // Note: Renderer wrapper handles pixel ratio internally,
    // but we allow overriding here.

    switch (quality) {
      case "low":
        rendererInstance.setPixelRatio(1);
        if (rendererInstance.shadowMap) {
          rendererInstance.shadowMap.enabled = false;
        }
        break;

      case "medium":
        // Safe cap for medium
        rendererInstance.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        if (rendererInstance.shadowMap) {
          rendererInstance.shadowMap.enabled = true;
        }
        break;

      case "high":
        // Safe cap for high
        rendererInstance.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        if (rendererInstance.shadowMap) {
          rendererInstance.shadowMap.enabled = true;
        }
        break;
    }

    // Force resize to apply pixel ratio change
    if (this.game.scene && this.game.renderer.sizes) {
      const { width, height } = this.game.renderer.sizes;
      rendererInstance.setSize(width, height);
    }

    console.log("Graphics quality set to:", quality);
  }

  _applyShadowsSetting() {
    if (!this.game || !this.game.renderer) return;

    const rendererInstance = this.game.renderer.instance;
    const sceneInstance = this.game.scene.instance;

    rendererInstance.shadowMap.enabled = this.settings.shadowsEnabled;

    // Update all lights
    if (sceneInstance) {
      sceneInstance.traverse((object) => {
        if (object.isLight && object.shadow) {
          // Verify if this is a generic light or our specific ones
          // We can force enable/disable
          object.castShadow = this.settings.shadowsEnabled;
        }
      });
    }

    console.log("Shadows:", this.settings.shadowsEnabled ? "ON" : "OFF");
  }

  _applySensitivitySetting() {
    // Update the UI
    if (this.elements.sensitivitySlider) {
      this.elements.sensitivitySlider.value = this.settings.lookSensitivity;
      this.elements.sensitivityValue.textContent = `${this.settings.lookSensitivity}%`;
    }

    // Apply to TouchControls if available
    if (this.game && this.game.touchControls) {
      this.game.touchControls.setSensitivity(
        this.settings.lookSensitivity / 100
      );
    }

    // Also store on window for global access
    if (window.touchControls) {
      window.touchControls.setSensitivity(this.settings.lookSensitivity / 100);
    }

    console.log(
      "Look sensitivity set to:",
      this.settings.lookSensitivity + "%"
    );
  }

  saveSettings() {
    try {
      localStorage.setItem(
        "shadowMazePauseSettings",
        JSON.stringify(this.settings)
      );
    } catch (e) {
      console.warn("Could not save pause menu settings:", e);
    }
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem("shadowMazePauseSettings");
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = { ...this.settings, ...parsed };
      }
    } catch (e) {
      console.warn("Could not load pause menu settings:", e);
    }
  }

  show() {
    this.elements.pauseButton?.classList.remove("hidden");
  }

  hide() {
    this.elements.pauseButton?.classList.add("hidden");
    this.elements.pauseMenu?.classList.add("hidden");
    this.isPaused = false;
  }

  /**
   * Set multiplayer mode - disables pause functionality
   * @param {boolean} isMultiplayer - Whether the game is in multiplayer mode
   */
  setMultiplayerMode(isMultiplayer) {
    this.isMultiplayer = isMultiplayer;

    if (isMultiplayer) {
      // Hide pause button in multiplayer
      this.elements.pauseButton?.classList.add("hidden");
      console.log("PauseMenu: Multiplayer mode - pause disabled");
    } else {
      // Show pause button in solo mode
      this.elements.pauseButton?.classList.remove("hidden");
      console.log("PauseMenu: Solo mode - pause enabled");
    }
  }

  dispose() {
    // Cleanup if needed
    this.hide();
  }
}
