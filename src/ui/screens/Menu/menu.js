/**
 * Menu Screen Module (Legacy Logic)
 */

class MenuScreen {
  constructor() {
    this.id = "menu";
    this.html = "src/ui/screens/Menu/menu.html";
    this.root = null;
    this.context = null;
    this.cleanupFns = [];
  }

  async mount(root, context) {
    this.root = root;
    this.context = context;
    this.injectStyles();
    this.setupButtons();
  }

  injectStyles() {
    if (document.getElementById("menu-styles")) return;
    const link = document.createElement("link");
    link.id = "menu-styles";
    link.rel = "stylesheet";
    link.href = "src/ui/screens/Menu/menu.css";
    document.head.appendChild(link);
  }

  setupButtons() {
    const buttons = this.root.querySelectorAll(".btn[data-action]");
    buttons.forEach((btn) => {
      const action = btn.dataset.action;
      const handler = (e) => {
        e.preventDefault();

        // Legacy sound effect hook
        if (this.context.audioManager) {
          // this.context.audioManager.playClick();
        }

        this.context.events.emit(`menu:${action}`);
      };

      btn.addEventListener("click", handler);
      btn.addEventListener("touchstart", handler, { passive: false });
      this.cleanupFns.push(() => {
        btn.removeEventListener("click", handler);
        btn.removeEventListener("touchstart", handler);
      });
    });
  }

  unmount() {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    this.root = null;
    this.context = null;
  }
}

const menuScreen = new MenuScreen();
export default menuScreen;
