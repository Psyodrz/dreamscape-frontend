/**
 * ScreenManager - Single authority for screen lifecycle management
 *
 * Responsibilities:
 * - Dynamically load screen HTML
 * - Call mount(root, context) on screen activation
 * - Call unmount() on screen deactivation
 * - Manage transitions between screens
 *
 * @fileoverview Core screen routing and lifecycle controller
 */

import appContext from "../core/AppContext.js";
import events from "../core/EventBus.js";

class ScreenManager {
  constructor(rootSelector = "#screen-root") {
    /** @type {HTMLElement|null} */
    this.root = document.querySelector(rootSelector);

    /** @type {Object|null} Currently active screen module */
    this.currentScreen = null;

    /** @type {string|null} Current screen ID */
    this.currentScreenId = null;

    /** @type {Map<string, Object>} Screen registry */
    this.screens = new Map();

    /** @type {boolean} Is a transition in progress */
    this.transitioning = false;

    if (!this.root) {
      console.error(
        `[ScreenManager] Root element "${rootSelector}" not found!`,
      );
    }
  }

  /**
   * Register a screen module
   * @param {string} id - Unique screen identifier
   * @param {Object} screenModule - Screen module with mount/unmount methods
   */
  register(id, screenModule) {
    if (!screenModule.mount || !screenModule.unmount) {
      console.error(
        `[ScreenManager] Screen "${id}" must implement mount() and unmount()`,
      );
      return;
    }
    this.screens.set(id, screenModule);
  }

  /**
   * Unmount a screen and hide root if empty
   * @param {string} screenId - Screen ID to unmount
   */
  async unmount(screenId) {
    const screen = this.screens.get(screenId);
    if (!screen) {
      console.warn(
        `[ScreenManager] Warning: Screen "${screenId}" not registered.`,
      );
      return;
    }

    // If it's the current screen, unmount it and clean up
    if (this.currentScreen === screen) {
      if (screen.unmount) {
        await screen.unmount();
      }
      this.currentScreen = null;
      this.currentScreenId = null;

      // Logic Fix: Hide the root container when no screen is active
      this.root.style.display = "none";
      this.root.innerHTML = "";
      this.root.removeAttribute("data-screen");
    }
  }

  /**
   * Unmount a screen and hide root if empty
   * @param {string} screenId - Screen ID to unmount
   */
  async unmount(screenId) {
    const screen = this.screens.get(screenId);
    if (!screen) {
      console.warn(
        `[ScreenManager] Warning: Screen "${screenId}" not registered.`,
      );
      return;
    }

    // If it's the current screen, unmount it and clean up
    if (this.currentScreen === screen) {
      if (screen.unmount) {
        await screen.unmount();
      }
      this.currentScreen = null;
      this.currentScreenId = null;

      // Logic Fix: Hide the root container when no screen is active
      this.root.style.display = "none";
      this.root.innerHTML = "";
      this.root.removeAttribute("data-screen");
    }
  }

  /**
   * Navigate to a screen
   * @param {string} screenId - Target screen ID
   * @param {Object} [options] - Transition options
   * @param {boolean} [options.skipTransition=false] - Skip fade animation
   * @returns {Promise<void>}
   */
  async goto(screenId, options = {}) {
    if (this.transitioning) {
      console.warn(
        `[ScreenManager] Transition in progress, ignoring goto("${screenId}")`,
      );
      return;
    }

    const nextScreen = this.screens.get(screenId);
    if (!nextScreen) {
      console.error(`[ScreenManager] Screen "${screenId}" not registered`);
      return;
    }

    this.transitioning = true;
    const previousId = this.currentScreenId;

    try {
      // Logic Fix: Ensure root is visible before mounting
      this.root.style.display = "flex";

      // Emit pre-transition event
      events.emit("screen:beforeChange", { from: previousId, to: screenId });

      // Unmount current screen
      if (this.currentScreen) {
        await this.currentScreen.unmount();
      }

      // Clear root
      this.root.innerHTML = "";
      this.root.removeAttribute("data-screen");

      // Load screen HTML if provided
      if (nextScreen.html) {
        await this.loadHTML(nextScreen.html);
      }

      // Set screen identifier for CSS scoping
      this.root.setAttribute("data-screen", screenId);

      // Mount new screen
      await nextScreen.mount(this.root, appContext);
      this.currentScreen = nextScreen;
      this.currentScreenId = screenId;
    } catch (error) {
      console.error(
        `[ScreenManager] Failed to transition to "${screenId}":`,
        error,
      );
      this.root.innerHTML = `<div class="error">Error loading screen: ${error.message}</div>`;
    } finally {
      this.transitioning = false;
      // Emit post-transition event
      events.emit("screen:changed", { from: previousId, to: screenId });
    }
  }

  /**
   * Load HTML file and inject into root
   * @param {string} htmlPath - Path to HTML file
   * @returns {Promise<void>}
   */
  async loadHTML(htmlPath) {
    try {
      const response = await fetch(htmlPath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      this.root.innerHTML = html;
    } catch (e) {
      console.error(`[ScreenManager] Failed to load HTML "${htmlPath}":`, e);
    }
  }

  /**
   * Get current screen ID
   * @returns {string|null}
   */
  getCurrentScreenId() {
    return this.currentScreenId;
  }
}

// Singleton instance
const screenManager = new ScreenManager("#screen-root");

export { ScreenManager, screenManager };
export default screenManager;
