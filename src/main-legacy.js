import { Game } from "./core/Game.js";
import { SceneManager } from "./core/SceneManager.js"; // UI State Manager
import { MenuManager } from "./ui/MenuManager.js";
import { MultiplayerManager } from "./network/MultiplayerManager.js";
import { MultiplayerUI } from "./ui/MultiplayerUI.js";
import { DevManager } from "./ui/DevManager.js";

// Initialize app with menu system
if (!window._mazeGameStarted) {
  window._mazeGameStarted = true;

  const initApp = () => {
    // Create UI scene manager (Home vs Game state)
    const uiSceneManager = new SceneManager();
    let gameInstance = null;

    // --- DEV MANAGER ---
    // Dynamic import to avoid circular dependencies if any, but standard import is fine here
    // We'll trust the class created above
    // Note: We need to import it at the top level really, but let's try inline for now or better, replace the top imports
    const devManager = new DevManager();

    if (devManager.isDevEnabled()) {
      console.log("!!! DEV MODE ACTIVE - BYPASSING MENU !!!");
      const devProfile = { name: "Dev", character: "male" };

      // Start immediately
      setTimeout(() => {
        // Hide Splash/Menu just in case styles leak
        const splash = document.getElementById("startup-splash");
        if (splash) splash.style.display = "none";
        const menu = document.getElementById("menu-overlay");
        if (menu) menu.classList.add("hidden");

        gameInstance = new Game();
        // Dev mode: read sandbox preference from localStorage (default: false = maze)
        const savedSandbox = localStorage.getItem("devSandboxMode");
        gameInstance.sandboxMode = savedSandbox === "true";
        // Audio enabled in dev mode (was previously muted)
        // gameInstance.audioManager.setMasterVolume(0);

        uiSceneManager.setState("game");
        gameInstance.init(devProfile).then(() => {
          document.getElementById("loading-screen")?.classList.add("hidden");
          gameInstance.start();

          // --- DEBUG PANEL INTEGRATION ---
          // Ensure the game is ready before attaching debug panel
          import("./ui/DebugPanel.js").then(({ DebugPanel }) => {
            new DebugPanel(gameInstance);
          });

          // Focus for controls (but don't auto-lock to avoid SecurityError)
          // User must click to play
          setTimeout(() => {
            // Optional: visual cue to click?
          }, 500);
        });
      }, 100);

      // SKIP the rest of init logic (MenuManager setup etc)
      return;
    }
    // -------------------

    // Create menu manager with play callback
    const menuManager = new MenuManager((playerProfile) => {
      // Transition to game state with player profile
      uiSceneManager.setState("game");

      // Initialize Game
      if (!gameInstance) {
        gameInstance = new Game();
      }
      // Start the game with the profile
      gameInstance.init(playerProfile).then(() => {
        // Hide loading screen once ready
        const loadingScreen = document.getElementById("loading-screen");
        if (loadingScreen) {
          loadingScreen.classList.add("hidden");
        }
      });
    });

    // Handle multiplayer button from main menu
    const btnMultiplayer = document.getElementById("btn-multiplayer");
    if (btnMultiplayer) {
      const showMultiplayer = () => {
        document.getElementById("menu-overlay").classList.add("hidden");
        document
          .getElementById("multiplayer-overlay")
          .classList.remove("hidden");

        // Initialize multiplayer if not already
        if (!window._multiplayerManager) {
          // Initialize Manager without game instance first
          window._multiplayerManager = new MultiplayerManager(null);
          window._multiplayerUI = new MultiplayerUI(window._multiplayerManager);

          window._multiplayerUI.onGameStart = (isMultiplayer) => {
            // When host starts game
            uiSceneManager.setState("game");

            if (!gameInstance) {
              gameInstance = new Game();
            }

            // Link game to manager
            window._multiplayerManager.game = gameInstance;

            gameInstance.isMultiplayer = true;
            gameInstance.init(menuManager.getPlayerProfile()).then(() => {
              const loadingScreen = document.getElementById("loading-screen");
              if (loadingScreen) loadingScreen.classList.add("hidden");
            });
          };
        }
      };
      btnMultiplayer.addEventListener("click", showMultiplayer);

      // Handle touch
      btnMultiplayer.addEventListener("touchstart", (e) => {
        e.preventDefault();
        showMultiplayer();
      });
    }

    // Handle UI state changes
    uiSceneManager.on("home", () => {
      // MenuManager handles overlay visibility (Splash -> Headphone -> Menu)
      // document.getElementById("menu-overlay").classList.remove("hidden");
      document.querySelector("canvas.webgl").style.display = "none";
      if (gameInstance) {
        // Dispose game?
        // For now, reload page to be safe as full cleanup is hard
        location.reload();
      }
    });

    uiSceneManager.on("game", () => {
      document.getElementById("menu-overlay").classList.add("hidden");
      const canvas = document.querySelector("canvas.webgl");
      canvas.style.display = "block";

      // Force resize to ensure renderer picks up dimensions correctly
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 50);
    });

    // Start in home state
    uiSceneManager.setState("home");

    // Splash screen is handled by MenuManager
  };

  // Wait for DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
}
