/**
 * Loading Screen (Legacy Logic)
 */

class LoadingScreen {
  constructor() {
    this.id = "loading";
    this.html = "src/ui/screens/Loading/loading.html";
    this.root = null;
    this.context = null;
    this.unsubscribers = [];
  }

  async mount(root, context) {
    this.root = root;
    this.context = context;
    this.injectStyles();

    // Subscribe to progress
    const bar = this.root.querySelector("#loading-progress-bar");
    const txt = this.root.querySelector("#loading-percent");

    const u1 = this.context.events.on("asset:progress", ({ progress }) => {
      if (bar) bar.style.width = `${progress}%`;
      if (txt) txt.textContent = `${Math.floor(progress)}%`;
    });
    this.unsubscribers.push(u1);
  }

  injectStyles() {
    if (document.getElementById("loading-styles")) return;
    const link = document.createElement("link");
    link.id = "loading-styles";
    link.rel = "stylesheet";
    link.href = "src/ui/screens/Loading/loading.css";
    document.head.appendChild(link);
  }

  unmount() {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    this.root = null;
    this.context = null;
  }
}

const loadingScreen = new LoadingScreen();
export default loadingScreen;
