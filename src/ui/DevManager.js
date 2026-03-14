export class DevManager {
  constructor(gameInitCallback) {
    this.gameInitCallback = gameInitCallback;
    // Default to TRUE if not set, checks string "false" explicitly to disable
    const stored = localStorage.getItem("dreamscape_dev_mode");
    this.isDevMode = stored === null ? true : stored === "true";
    this._createUI();
  }

  isDevEnabled() {
    return this.isDevMode;
  }

  _createUI() {
    // Bare minimum container
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.top = "10px";
    container.style.left = "10px";
    container.style.zIndex = "2147483647"; // MAX INT
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.gap = "5px";
    container.id = "dev-mode-ui";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.isDevMode;
    checkbox.id = "dev-mode-cb";
    checkbox.style.cursor = "pointer";
    checkbox.style.width = "20px";
    checkbox.style.height = "20px";

    const label = document.createElement("label");
    label.innerText = "DEV MODE";
    label.htmlFor = "dev-mode-cb";
    label.style.fontWeight = "bold";
    label.style.fontFamily = "sans-serif";
    label.style.color = "white"; // Visible on most backgrounds
    label.style.textShadow = "1px 1px 2px black"; // Readable on white
    label.style.cursor = "pointer";

    checkbox.addEventListener("change", (e) => {
      this.isDevMode = e.target.checked;
      localStorage.setItem("dreamscape_dev_mode", this.isDevMode);
      location.reload();
    });

    container.appendChild(checkbox);
    container.appendChild(label);
    document.body.appendChild(container);
  }
}
