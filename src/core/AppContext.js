/**
 * AppContext - Centralized application context container
 *
 * Holds shared references that screens need:
 * - EventBus instance
 * - Asset loader reference
 * - Settings
 * - Any other cross-cutting concerns
 *
 * @fileoverview Single source of truth for app-wide dependencies
 */

import events from "./EventBus.js";

class AppContext {
  constructor() {
    /** @type {import('./EventBus.js').EventBus} */
    this.events = events;

    /** @type {Object} User settings */
    this.settings = {
      soundVolume: 70,
      graphicsQuality: "high",
      vibrationEnabled: true,
      lookSensitivity: 100,
    };

    /** @type {Object|null} Asset loader reference (set during init) */
    this.assetLoader = null;

    /** @type {Object|null} Audio manager reference */
    this.audioManager = null;

    /** @type {boolean} Whether assets have finished loading */
    this.assetsReady = false;

    /** @type {number} Current asset loading progress (0-100) */
    this.loadProgress = 0;
  }

  /**
   * Initialize context with external systems
   * Called once during app bootstrap
   * @param {Object} options
   * @param {Object} [options.assetLoader] - Asset loader instance
   * @param {Object} [options.audioManager] - Audio manager instance
   */
  init({ assetLoader, audioManager } = {}) {
    if (assetLoader) {
      this.assetLoader = assetLoader;
    }
    if (audioManager) {
      this.audioManager = audioManager;
    }

    // Load persisted settings
    this.loadSettings();
  }

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    try {
      const saved = localStorage.getItem("dreamscape_settings");
      if (saved) {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn("[AppContext] Could not load settings:", e);
    }
  }

  /**
   * Save settings to localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem(
        "dreamscape_settings",
        JSON.stringify(this.settings),
      );
    } catch (e) {
      console.warn("[AppContext] Could not save settings:", e);
    }
  }

  /**
   * Update a setting and persist
   * @param {string} key - Setting key
   * @param {*} value - New value
   */
  setSetting(key, value) {
    this.settings[key] = value;
    this.saveSettings();
    this.events.emit("settings:changed", { key, value });
  }

  /**
   * Mark assets as loaded
   * @param {number} progress - 0-100
   */
  setLoadProgress(progress) {
    this.loadProgress = progress;
    this.events.emit("asset:progress", { progress });

    if (progress >= 100) {
      this.assetsReady = true;
      this.events.emit("asset:complete");
    }
  }
}

// Singleton instance
const appContext = new AppContext();

export { AppContext, appContext };
export default appContext;
