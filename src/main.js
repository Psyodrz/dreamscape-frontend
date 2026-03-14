/**
 * Application Entry Point (Modular Architecture - Legacy Flow)
 */

import appContext from "./core/AppContext.js";
import events from "./core/EventBus.js";
import screenManager from "./ui/ScreenManager.js";
import { DevManager } from "./ui/DevManager.js";

// Screens
import splashScreen from "./ui/screens/Splash/splash.js";
import menuScreen from "./ui/screens/Menu/menu.js";
// We might not need a separate loading screen if Splash handles it in Stage 4
// But let's keep it registered just in case we need generic loading later
import loadingScreen from "./ui/screens/Loading/loading.js";

import { getAssetLoader } from "./systems/AssetLoader.js"; // Assuming this exists or will exist

async function initApp() {
  // --- SPAM FILTER ---
  // Filter out Three.js texture unit warnings that cause lag
  const originalWarn = console.warn;
  console.warn = function (...args) {
    if (
      args[0] &&
      typeof args[0] === "string" &&
      args[0].includes("THREE.WebGLTextures: Trying to use")
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };

  console.log("[App] Initializing modular UI system (Legacy Flow)...");

  // --- DEV MODE CHECK ---
  const devManager = new DevManager();

  if (devManager.isDevEnabled()) {
    console.log("!!! DEV MODE ACTIVE - BYPASSING SPLASH/MENU !!!");

    // Hide screen root since we're going straight to game
    const root = document.getElementById("screen-root");
    if (root) root.style.display = "none";

    // Show canvas
    const canvas = document.querySelector("canvas.webgl");
    if (canvas) {
      canvas.style.display = "block";
      canvas.style.zIndex = "1";
    }

    // Start game directly
    try {
      const { Game } = await import("./core/Game.js");
      const gameInstance = new Game();
      window.game = gameInstance;

      // Read sandbox preference from localStorage (default: false = maze)
      const savedSandbox = localStorage.getItem("devSandboxMode");
      gameInstance.sandboxMode = savedSandbox === "true";

      const devProfile = { name: "Dev", character: "male" };
      await gameInstance.init(devProfile);

      console.log("[Dev Mode] Game started directly!");

      // --- DEBUG PANEL INTEGRATION ---
      // Ensure the game is ready before attaching debug panel
      // --- DEBUG PANEL INTEGRATION (NEW INSPECTOR) ---
      // Ensure the game is ready before attaching debug panel
      Promise.all([
        import("./ui/LegacyInspector.js"),
        import("./ui/DebugPanelNew.js"),
      ])
        .then(([{ LegacyInspector }, { DebugPanelNew }]) => {
          // Initialize The Inspector (Visual + Stats + Parameters)
          gameInstance.inspector = new LegacyInspector(
            gameInstance.renderer.instance,
            gameInstance.scene.instance,
            gameInstance.scene.camera,
          );

          // Initialize The Debug Controls using Inspector Parameters
          new DebugPanelNew(gameInstance);

          console.log("[Dev Mode] Inspector & DebugPanelNew initialized!");
        })
        .catch((err) => {
          console.warn("[Dev Mode] Debug system failed to load:", err);
        });

      // Trigger resize
      setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
    } catch (err) {
      console.error("[Dev Mode] Failed to start game:", err);
      alert("Dev Mode: Game failed to load. Check console.");
    }

    return; // Skip normal flow
  }
  // --- END DEV MODE ---

  // 1. Initialize Context
  // Mock asset loader if real one isn't ready
  const mockAssetLoader = {
    preloadAll: (onProgress, onComplete) => {
      let p = 0;
      const int = setInterval(() => {
        p += 2;
        onProgress(p);
        if (p >= 100) {
          clearInterval(int);
          onComplete();
        }
      }, 50);
    },
  };

  appContext.init({
    assetLoader: mockAssetLoader, // Replace with getAssetLoader() when integrating real game
  });

  // 2. Register Screens
  screenManager.register("splash", splashScreen);
  screenManager.register("menu", menuScreen);
  screenManager.register("loading", loadingScreen);

  // 3. Setup Flow
  setupTransitions();

  // 4. Start
  await screenManager.goto("splash");
}

function setupTransitions() {
  // Splash Logic:
  // Splash plays Intro -> emits 'splash:introComplete'
  // Then we start loading assets.
  // When assets done -> go to Menu.

  events.on("splash:introComplete", () => {
    console.log("[App] Splash Intro Done. Starting Asset Load...");

    // Start loading assets.
    // The Splash screen is LISTENING to 'asset:progress' to update its own bar (Stage 4).
    // So we don't switch screens yet.

    appContext.assetLoader.preloadAll(
      (progress) => appContext.setLoadProgress(progress),
      () => events.emit("asset:complete"),
    );
  });

  let assetsLoadedHandled = false;
  events.on("asset:complete", () => {
    if (assetsLoadedHandled) return;
    assetsLoadedHandled = true;

    console.log("[App] Assets Loaded. Going to Menu.");
    // Add a small delay for effect
    setTimeout(() => {
      // Ensure we are not already there or transitioning
      screenManager
        .goto("menu")
        .catch((err) => console.error("Menu transition failed:", err));
    }, 500);
  });

  // Menu Actions
  events.on("menu:play", async () => {
    console.log("START GAME COMMAND RECEIVED");

    // 1. Force Canvas Visibility
    const canvas = document.querySelector("canvas.webgl");
    if (canvas) {
      canvas.style.display = "block";
      canvas.style.zIndex = "1";
    }

    // 2. Hide Menu (Using cleaned up API)
    // The ScreenManager now handles hiding the root container automatically
    await screenManager.unmount("menu");

    // Hide app container if it interferes
    const appDiv = document.getElementById("app");
    if (appDiv) appDiv.style.display = "none";

    // 3. Initialize Legacy Game
    try {
      const { Game } = await import("./core/Game.js");
      const gameInstance = new Game();
      window.game = gameInstance;

      const playerProfile = { name: "Player", character: "male" };
      await gameInstance.init(playerProfile);

      // Ensure loading screen is gone
      await screenManager.unmount("loading");

      console.log("Game Initialized & Started");

      // Fix potential aspect ratio issues
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 100);
    } catch (err) {
      console.error("FAILED TO START GAME:", err);
      if (err.name === "SecurityError") {
        console.warn(
          "Pointer Lock failed - Game will continue but click to capture.",
        );
      } else {
        alert("Error starting game engine. Check console.");
      }
    }
  });
}

// Bootstrap
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
