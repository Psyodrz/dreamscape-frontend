/**
 * MenuManager - Handles menu UI interactions and settings
 */
import { getAudioManager } from "../systems/AudioManager.js";
import { AssetLoader, getAssetLoader } from "../systems/AssetLoader.js";
import { BloodRainEffect } from "./BloodRainEffect.js";
import updateManager from "../core/UpdateManager.js";

export class MenuManager {
  constructor(onPlay) {
    this.onPlay = onPlay;

    // Default settings
    this.settings = {
      graphicsQuality: "high",
      soundVolume: 70,
      micEnabled: false,
      vibrationEnabled: true,
      lookSensitivity: 100,
    };

    // Player profile (separate from settings)
    this.playerProfile = {
      playerName: "",
      characterGender: "male",
    };

    // Load saved data
    this.loadSettings();
    this.loadPlayerProfile();

    // Cache DOM elements
    this.elements = {
      menuOverlay: document.getElementById("menu-overlay"),
      settingsPanel: document.getElementById("settings-panel"),
      controlsPanel: document.getElementById("controls-panel"),
      loadingScreen: document.getElementById("loading-screen"),
      characterSelect: document.getElementById("character-select"),
      startupSplash: document.getElementById("startup-splash"),
      splashLoadingBar: document.querySelector(".splash-loading-bar"),
      splashLoadingText: document.querySelector(".splash-loading-text"),

      btnPlay: document.getElementById("btn-play"),
      btnSettings: document.getElementById("btn-settings"),
      btnControls: document.getElementById("btn-controls"),
      btnSettingsBack: document.getElementById("btn-settings-back"),
      btnControlsBack: document.getElementById("btn-controls-back"),

      // Game Over Screen
      gameOverScreen: document.getElementById("game-over-screen"),
      btnRestart: document.getElementById("btn-restart"),
      btnGameOverQuit: document.getElementById("btn-game-over-quit"),

      // Character selection
      playerNameInput: document.getElementById("player-name-input"),
      genderButtons: document.querySelectorAll("[data-gender]"),
      btnStartGame: document.getElementById("btn-start-game"),
      btnCharBack: document.getElementById("btn-char-back"),

      volumeSlider: document.getElementById("volume-slider"),
      volumeValue: document.getElementById("volume-value"),
      sensitivitySlider: document.getElementById("sensitivity-slider"),
      sensitivityValue: document.getElementById("sensitivity-value"),
      micToggle: document.getElementById("mic-toggle"),
      vibrationToggle: document.getElementById("vibration-toggle"),
      qualityButtons: document.querySelectorAll("[data-quality]"),

      // Update UI
      btnCheckUpdate: document.getElementById("btn-check-update"),
      versionText: document.getElementById("app-version"),
    };

    // Set version text immediately
    if (this.elements.versionText) {
      this.elements.versionText.textContent = `v${updateManager.getCurrentVersion()}`;
    }

    // Hide menu initially (splash is shown first)
    if (this.elements.menuOverlay) {
      this.elements.menuOverlay.classList.add("hidden");
    }

    this.bindEvents();
    this.applySettings();
    this.applyPlayerProfile();

    // Initialize Blood Rain Effect
    const rainCanvas = document.getElementById("blood-rain-canvas");
    if (rainCanvas) {
      this.bloodRainEffect = new BloodRainEffect(rainCanvas);
    }

    // Start splash screen and asset preloading
    this._initSplashScreen();
  }

  _initSplashScreen() {
    const splash = this.elements.startupSplash;
    // Cache stage elements
    const stages = [
      document.getElementById("splash-stage-1"),
      document.getElementById("splash-stage-2"),
      document.getElementById("splash-stage-3"),
      document.getElementById("splash-stage-4"),
    ];

    if (!splash) {
      this.elements.menuOverlay?.classList.remove("hidden");
      return;
    }

    // Asset Loading Logic
    let assetsLoaded = false;
    const loadingBar = this.elements.splashLoadingBar;
    const loadingText = this.elements.splashLoadingText;

    // Sequence Logic
    const runSequence = async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const preloader = document.getElementById("splash-preloader");
      const studioLogo = document.querySelector(".splash-agx-logo");

      // PRE-STAGE: Load critical logo
      if (preloader && studioLogo) {
        // Create a promise that resolves when the image loads
        await new Promise((resolve) => {
          const img = new Image();
          img.src = "assets/AGS.ico";
          if (img.complete) {
            resolve();
          } else {
            img.onload = resolve;
            img.onerror = resolve; // Proceed even on error
          }
        });

        // Hide preloader and SHOW logo
        preloader.classList.add("hidden");
        studioLogo.classList.remove("hidden");
      }

      // Helper to show a stage
      const showStage = async (index, duration) => {
        // Hide others (crossfade out)
        stages.forEach((s, i) => {
          if (i !== index && s) {
            s.classList.remove("visible");
            // We don't add 'hidden' yet to allow fade out transition
          }
        });

        // Show current
        if (stages[index]) {
          stages[index].classList.remove("hidden"); // Ensure it's in flow
          // Force reflow
          void stages[index].offsetWidth;
          stages[index].classList.add("visible");
        }

        await wait(duration);
      };

      // STAGE 1: AGX STUDIOS (4s - Slower, heavier slam)
      await showStage(0, 4000);

      // STAGE 2: PRESENTS (3s - Slow eerie fade)
      await showStage(1, 3000);

      // STAGE 3: CREATORS (4s - glitched out)
      await showStage(2, 4000);

      // STAGE 4: MAIN TITLE (Wait for assets)
      // Show Stage 4
      stages.forEach((s, i) => {
        if (i !== 3 && s) s.classList.remove("visible");
      });

      if (stages[3]) {
        stages[3].classList.remove("hidden");
        void stages[3].offsetWidth;
        void stages[3].offsetWidth;
        stages[3].classList.add("visible");

        // Start Blood Rain Effect
        if (this.bloodRainEffect) {
          this.bloodRainEffect.start();
          // Fade in canvas
          const canvas = document.getElementById("blood-rain-canvas");
          if (canvas) canvas.classList.add("visible");
        }
      }

      // --- START ASSET LOADING NOW (Stage 4) ---
      // This prevents lag during the first 3 stages
      const assetLoader = getAssetLoader();
      assetLoader.preloadAll(
        (progress) => {
          if (loadingBar) loadingBar.style.width = `${progress}%`;
          if (loadingText)
            loadingText.textContent = `Loading... ${Math.round(progress)}%`;
        },
        () => {
          console.log("Splash: Assets loaded");
          assetsLoaded = true;
          if (loadingText)
            loadingText.textContent = "Entering the Nightmare...";
          if (loadingBar) loadingBar.style.width = "100%";
        },
        (error) => {
          console.warn("Splash: Asset load error", error);
          assetsLoaded = true; // Proceed anyway
        },
      );

      // Wait for assets to finish if they haven't yet
      // Minimum time for title screen even if assets are fast: 2s
      const titleStartTime = Date.now();

      const checkLoad = () => {
        const elapsed = Date.now() - titleStartTime;
        if (assetsLoaded && elapsed > 2000) {
          finishSplash();
        } else {
          requestAnimationFrame(checkLoad);
        }
      };
      checkLoad();
    };

    const finishSplash = () => {
      splash.classList.add("fade-out");

      // Stop Blood Rain Effect
      if (this.bloodRainEffect) {
        const canvas = document.getElementById("blood-rain-canvas");
        if (canvas) canvas.classList.remove("visible");

        setTimeout(() => {
          this.bloodRainEffect.stop();
        }, 1000); // Wait for fade out
      }

      setTimeout(() => {
        splash.style.display = "none";
        // removed headphone screen
        this.elements.menuOverlay?.classList.remove("hidden");
      }, 1000);
    };

    // Begin sequence
    runSequence();
  }

  bindEvents() {
    // Main menu buttons - now opens character select instead of playing directly
    if (this.elements.btnPlay) {
      this.elements.btnPlay.addEventListener("touchstart", (e) => {
        e.preventDefault();
        getAudioManager().unlockAudio();
        this._playClickSound();
        this.showCharacterSelect();
      });
      this.elements.btnPlay.addEventListener("click", () => {
        this._playClickSound();
        this.showCharacterSelect();
      });
    }

    if (this.elements.btnSettings) {
      this.elements.btnSettings.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this._playClickSound();
        this.showPanel("settings");
      });
      this.elements.btnSettings.addEventListener("click", () => {
        this._playClickSound();
        this.showPanel("settings");
      });
    }

    if (this.elements.btnControls) {
      this.elements.btnControls.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this._playClickSound();
        this.showPanel("controls");
      });
      this.elements.btnControls.addEventListener("click", () => {
        this._playClickSound();
        this.showPanel("controls");
      });
    }

    // Back buttons
    if (this.elements.btnSettingsBack) {
      this.elements.btnSettingsBack.addEventListener("click", () => {
        this.hidePanel("settings");
      });
    }

    if (this.elements.btnControlsBack) {
      this.elements.btnControlsBack.addEventListener("click", () => {
        this.hidePanel("controls");
      });
    }

    // Character selection events
    if (this.elements.btnCharBack) {
      // Use click only to avoid mobile touch conflicts
      this.elements.btnCharBack.addEventListener("click", () => {
        console.log("Character Back clicked");
        this.hideCharacterSelect();
      });
    }

    if (this.elements.btnStartGame) {
      this.elements.btnStartGame.addEventListener("click", () => {
        this._playClickSound();
        this.startGameWithCharacter();
      });
    }

    // Gender selection buttons
    this.elements.genderButtons.forEach((btn) => {
      const handler = (e) => {
        e.preventDefault();
        this.selectGender(btn.dataset.gender);
      };
      btn.addEventListener("touchstart", handler);
      btn.addEventListener("click", handler);
    });

    // Player name input
    if (this.elements.playerNameInput) {
      this.elements.playerNameInput.addEventListener("input", (e) => {
        this.playerProfile.playerName = e.target.value.trim();
      });
    }

    // Graphics quality buttons
    this.elements.qualityButtons.forEach((btn) => {
      const handler = (e) => {
        e.preventDefault();
        this.setQuality(btn.dataset.quality);
      };
      btn.addEventListener("touchstart", handler);
      btn.addEventListener("click", handler);
    });

    // Volume slider
    if (this.elements.volumeSlider) {
      this.elements.volumeSlider.addEventListener("input", (e) => {
        this.setVolume(parseInt(e.target.value));
      });
    }

    // Sensitivity slider
    if (this.elements.sensitivitySlider) {
      this.elements.sensitivitySlider.addEventListener("input", (e) => {
        this.setSensitivity(parseInt(e.target.value));
      });
    }

    // Game Over Buttons
    if (this.elements.btnRestart) {
      this.elements.btnRestart.addEventListener("click", () => {
        this._playClickSound();
        window.location.reload();
      });
      this.elements.btnRestart.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this._playClickSound();
        window.location.reload();
      });
    }

    if (this.elements.btnGameOverQuit) {
      this.elements.btnGameOverQuit.addEventListener("click", () => {
        this._playClickSound();
        window.location.reload(); // Simplest way to return to menu state
      });
      this.elements.btnGameOverQuit.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this._playClickSound();
        window.location.reload();
      });
    }

    // Mic toggle
    if (this.elements.micToggle) {
      const micHandler = (e) => {
        e.preventDefault();
        this.toggleMic();
      };
      this.elements.micToggle.addEventListener("touchstart", micHandler);
      this.elements.micToggle.addEventListener("click", micHandler);
    }

    // Vibration toggle
    if (this.elements.vibrationToggle) {
      const vibHandler = (e) => {
        e.preventDefault();
        this.toggleVibration();
      };
      this.elements.vibrationToggle.addEventListener("touchstart", vibHandler);
      this.elements.vibrationToggle.addEventListener("click", vibHandler);
    }

    // Update check button
    if (this.elements.btnCheckUpdate) {
      this.elements.btnCheckUpdate.addEventListener("click", () => {
        this._playClickSound();
        updateManager.checkForUpdate(true);
      });
      this.elements.btnCheckUpdate.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this._playClickSound();
        updateManager.checkForUpdate(true);
      });
    }
  }

  // Character selection methods
  showCharacterSelect() {
    this.elements.menuOverlay.classList.add("hidden");
    this.elements.characterSelect?.classList.remove("hidden");

    // Focus name input
    setTimeout(() => {
      this.elements.playerNameInput?.focus();
    }, 100);
  }

  hideCharacterSelect() {
    this.elements.characterSelect?.classList.add("hidden");
    this.elements.menuOverlay.classList.remove("hidden");
  }

  selectGender(gender) {
    this.playerProfile.characterGender = gender;

    // Update UI
    this.elements.genderButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.gender === gender);
    });
  }

  startGameWithCharacter() {
    // AUTO-FULLSCREEN: Enter fullscreen and lock landscape on game start
    (async () => {
      try {
        const elem = document.documentElement;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          if (elem.requestFullscreen) {
            await elem.requestFullscreen();
          } else if (elem.webkitRequestFullscreen) {
            await elem.webkitRequestFullscreen();
          }

          // Lock to landscape after entering fullscreen
          if (screen.orientation && screen.orientation.lock) {
            try {
              await screen.orientation.lock("landscape");
              console.log("Auto-locked to landscape mode");
            } catch (e) {
              console.log("Could not lock orientation:", e.message);
            }
          }

          // Hide portrait warning
          const portraitWarning = document.getElementById("portrait-warning");
          if (portraitWarning) portraitWarning.style.display = "none";
        }
      } catch (e) {
        console.log("Auto-fullscreen failed:", e.message);
      }
    })();

    // Unlock audio as backup
    getAudioManager().unlockAudio();

    // Validate name
    if (!this.playerProfile.playerName) {
      this.playerProfile.playerName =
        "Player" + Math.floor(Math.random() * 9999);
      if (this.elements.playerNameInput) {
        this.elements.playerNameInput.value = this.playerProfile.playerName;
      }
    }

    // Save profile
    this.savePlayerProfile();

    // Hide character select, show loading
    this.elements.characterSelect?.classList.add("hidden");
    this.elements.loadingScreen?.classList.remove("hidden");

    // Trigger vibration feedback
    if (this.settings.vibrationEnabled && navigator.vibrate) {
      try {
        navigator.vibrate(50);
      } catch (e) {
        // Ignore
      }
    }

    console.log(
      "Starting game as:",
      this.playerProfile.playerName,
      "-",
      this.playerProfile.characterGender,
    );

    // Update loading text
    const loadingText = document.getElementById("loading-text");
    const loadingProgressBar = document.getElementById("loading-progress-bar");
    const loadingPercent = document.getElementById("loading-percent");

    if (loadingText) loadingText.textContent = "Generating maze...";
    if (loadingProgressBar) loadingProgressBar.style.width = "100%";
    if (loadingPercent) loadingPercent.textContent = "100%";

    // Assets are already preloaded during splash screen, start game directly
    setTimeout(() => {
      if (this.onPlay) {
        this.onPlay(this.playerProfile);
      }
    }, 300);
  }

  playGame() {
    // Legacy method - redirect to character select
    this.showCharacterSelect();
  }

  showPanel(panel) {
    // Hide main menu to prevent overlap
    this.elements.menuOverlay?.classList.add("hidden");

    if (panel === "settings") {
      this.elements.settingsPanel.classList.remove("hidden");
    } else if (panel === "controls") {
      this.elements.controlsPanel.classList.remove("hidden");
    }

    // Vibration feedback
    if (this.settings.vibrationEnabled && navigator.vibrate) {
      try {
        navigator.vibrate(30);
      } catch (e) {
        // Ignore vibration errors (e.g. user hasn't interacted yet)
      }
    }
  }

  hidePanel(panel) {
    if (panel === "settings") {
      this.elements.settingsPanel?.classList.add("hidden");
    } else if (panel === "controls") {
      this.elements.controlsPanel?.classList.add("hidden");
    }

    // Restore main menu
    this.elements.menuOverlay?.classList.remove("hidden");
  }

  setQuality(quality) {
    this.settings.graphicsQuality = quality;

    // Update UI
    this.elements.qualityButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.quality === quality);
    });

    this.saveSettings();
  }

  setVolume(volume) {
    this.settings.soundVolume = volume;
    if (this.elements.volumeValue) {
      this.elements.volumeValue.textContent = `${volume}%`;
    }

    // Update AudioManager volume
    const audioManager = getAudioManager();
    audioManager.setMasterVolume(volume / 100);

    this.saveSettings();
  }

  setSensitivity(sensitivity) {
    this.settings.lookSensitivity = sensitivity;
    if (this.elements.sensitivityValue) {
      this.elements.sensitivityValue.textContent = `${sensitivity}%`;
    }

    // Notify any active touch controls
    if (window.touchControls) {
      window.touchControls.setSensitivity(sensitivity / 100);
    }

    this.saveSettings();
  }

  _playClickSound() {
    getAudioManager().playButtonClick();
  }

  toggleMic() {
    this.settings.micEnabled = !this.settings.micEnabled;
    const toggle = this.elements.micToggle;
    if (toggle) {
      toggle.classList.toggle("active", this.settings.micEnabled);
      const label = toggle.querySelector(".toggle-label");
      if (label) label.textContent = this.settings.micEnabled ? "ON" : "OFF";
      toggle.dataset.enabled = this.settings.micEnabled;
    }
    this.saveSettings();
  }

  toggleVibration() {
    this.settings.vibrationEnabled = !this.settings.vibrationEnabled;
    const toggle = this.elements.vibrationToggle;
    if (toggle) {
      toggle.classList.toggle("active", this.settings.vibrationEnabled);
      const label = toggle.querySelector(".toggle-label");
      if (label)
        label.textContent = this.settings.vibrationEnabled ? "ON" : "OFF";
      toggle.dataset.enabled = this.settings.vibrationEnabled;
    }

    // Test vibration
    // Test vibration
    if (this.settings.vibrationEnabled && navigator.vibrate) {
      try {
        navigator.vibrate(100);
      } catch (e) {
        // Ignore
      }
    }

    this.saveSettings();
  }

  applySettings() {
    // Apply quality
    this.elements.qualityButtons?.forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.quality === this.settings.graphicsQuality,
      );
    });

    // Apply volume
    if (this.elements.volumeSlider) {
      this.elements.volumeSlider.value = this.settings.soundVolume;
    }
    if (this.elements.volumeValue) {
      this.elements.volumeValue.textContent = `${this.settings.soundVolume}%`;
    }

    // Apply mic
    if (this.elements.micToggle) {
      this.elements.micToggle.classList.toggle(
        "active",
        this.settings.micEnabled,
      );
      const micLabel = this.elements.micToggle.querySelector(".toggle-label");
      if (micLabel)
        micLabel.textContent = this.settings.micEnabled ? "ON" : "OFF";
    }

    // Apply vibration
    if (this.elements.vibrationToggle) {
      this.elements.vibrationToggle.classList.toggle(
        "active",
        this.settings.vibrationEnabled,
      );
      const vibLabel =
        this.elements.vibrationToggle.querySelector(".toggle-label");
      if (vibLabel)
        vibLabel.textContent = this.settings.vibrationEnabled ? "ON" : "OFF";
    }

    // Apply sensitivity
    if (this.elements.sensitivitySlider) {
      this.elements.sensitivitySlider.value = this.settings.lookSensitivity;
    }
    if (this.elements.sensitivityValue) {
      this.elements.sensitivityValue.textContent = `${this.settings.lookSensitivity}%`;
    }
  }

  applyPlayerProfile() {
    // Apply saved name and gender to UI
    if (this.elements.playerNameInput && this.playerProfile.playerName) {
      this.elements.playerNameInput.value = this.playerProfile.playerName;
    }

    this.elements.genderButtons.forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.gender === this.playerProfile.characterGender,
      );
    });
  }

  saveSettings() {
    try {
      localStorage.setItem("shadowMazeSettings", JSON.stringify(this.settings));
    } catch (e) {
      console.warn("Could not save settings:", e);
    }
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem("shadowMazeSettings");
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = { ...this.settings, ...parsed };
      }
    } catch (e) {
      console.warn("Could not load settings:", e);
    }
  }

  savePlayerProfile() {
    try {
      localStorage.setItem(
        "shadowMazePlayer",
        JSON.stringify(this.playerProfile),
      );
    } catch (e) {
      console.warn("Could not save player profile:", e);
    }
  }

  loadPlayerProfile() {
    try {
      const saved = localStorage.getItem("shadowMazePlayer");
      if (saved) {
        const parsed = JSON.parse(saved);
        this.playerProfile = { ...this.playerProfile, ...parsed };
      }
    } catch (e) {
      console.warn("Could not load player profile:", e);
    }
  }

  showGameOver() {
    console.log("Showing Game Over Screen");
    if (this.elements.gameOverScreen) {
      this.elements.gameOverScreen.classList.remove("hidden");

      // Play death sound
      getAudioManager().playDeathScream();

      // Ensure pointer lock is released
      document.exitPointerLock();

      // Hide other UI
      const touchControls = document.getElementById("touch-controls");
      if (touchControls) touchControls.classList.add("hidden");

      const pauseBtn = document.getElementById("pause-button");
      if (pauseBtn) pauseBtn.classList.add("hidden");
    }
  }

  hideLoadingScreen() {
    this.elements.loadingScreen.classList.add("hidden");
  }

  showMenu() {
    this.elements.menuOverlay.classList.remove("hidden");
    this.elements.loadingScreen.classList.add("hidden");
  }

  getSettings() {
    return { ...this.settings };
  }

  getPlayerProfile() {
    return { ...this.playerProfile };
  }
}
