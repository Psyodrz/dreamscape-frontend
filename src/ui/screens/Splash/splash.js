/**
 * Splash Screen Module (Legacy Logic)
 *
 * Implements the same 4-stage sequence as the original index.html script
 */

class SplashScreen {
  constructor() {
    this.id = "splash";
    this.html = "src/ui/screens/Splash/splash.html";
    this.root = null;
    this.context = null;
    this.timers = [];
    this.skipped = false;
  }

  /**
   * Mount the splash screen
   */
  async mount(root, context) {
    this.root = root;
    this.context = context;
    this.skipped = false;

    // Inject CSS
    this.injectStyles();

    // Start the sequence logic
    this.runLegacySequence();
  }

  injectStyles() {
    if (document.getElementById("splash-styles")) return;
    const link = document.createElement("link");
    link.id = "splash-styles";
    link.rel = "stylesheet";
    link.href = "src/ui/screens/Splash/splash.css";
    document.head.appendChild(link);
  }

  async runLegacySequence() {
    // Element references
    const stage1 = this.root.querySelector("#splash-stage-1");
    const stage2 = this.root.querySelector("#splash-stage-2");
    const stage3 = this.root.querySelector("#splash-stage-3");
    const stage4 = this.root.querySelector("#splash-stage-4");

    const preloader = this.root.querySelector("#splash-preloader");
    const logo = this.root.querySelector(".splash-agx-logo");

    // Helper to show/hide
    const show = (el) => {
      if (!el) return;
      el.classList.remove("hidden");
      // Force reflow
      void el.offsetWidth;
      el.classList.add("visible");
    };
    const hide = (el) => {
      if (!el) return;
      el.classList.remove("visible");
      // Delay adding hidden until fade out finishes (0.5s match CSS)
      setTimeout(() => el.classList.add("hidden"), 500);
    };

    // --- Sequence Start ---

    // Stage 1: Studio (Preload logo first)
    // Ensure stage container is ready
    if (stage1) stage1.classList.remove("hidden");

    // Legacy logic: Show preloader first
    if (preloader) {
      preloader.classList.remove("hidden");
      preloader.style.display = "block"; // Ensure it's not overridden
    }

    // Simulate image load delay (legacy behavior)
    await this.wait(500);

    // Hide preloader
    if (preloader) preloader.classList.add("hidden");

    // Show actual logo
    if (logo) {
      logo.classList.remove("hidden");
      logo.style.display = "block";
    }

    // Trigger Stage 1 visibility (starts animations)
    show(stage1);

    await this.wait(3500); // Wait on studio logo

    // Stage 2: Presents
    hide(stage1);
    await this.wait(500);
    show(stage2);
    await this.wait(2500);

    // Stage 3: Developers
    hide(stage2);
    await this.wait(500);
    show(stage3);
    await this.wait(3000);

    // Stage 4: Game Title
    hide(stage3);
    await this.wait(500);
    show(stage4);

    // Trigger asset loading event
    this.context.events.emit("splash:introComplete");

    // Subscribe to progress events directly here
    const bar = this.root.querySelector(".splash-loading-bar");
    const loadingText = this.root.querySelector(".splash-loading-text");

    const progressUnsub = this.context.events.on(
      "asset:progress",
      ({ progress }) => {
        if (bar) bar.style.width = `${progress}%`;
        if (loadingText)
          loadingText.textContent = `LOADING... ${Math.floor(progress)}%`;
      },
    );
    this.unsubscribers = [progressUnsub];
  }

  wait(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.timers.push(timer);
    });
  }

  unmount() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.unsubscribers) this.unsubscribers.forEach((u) => u());
    this.root = null;
    this.context = null;
  }
}

const splashScreen = new SplashScreen();
export default splashScreen;
