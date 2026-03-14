/**
 * MazeDebugPanel - A debug overlay that renders a top-down view of the maze
 * with insightful statistics for debugging maze generation.
 *
 * Toggle with: Press 'B' key
 */
export class MazeDebugPanel {
  constructor() {
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.statsDiv = null;
    this.isVisible = false;
    this.mazeData = null;
    this.rooms = [];
    this.connectivityFixed = false;
    this.cellsCarved = 0;

    this._createUI();
    this._setupKeyboard();
  }

  _createUI() {
    // Main container
    this.container = document.createElement("div");
    this.container.id = "maze-debug-panel";
    this.container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 420px;
      background: rgba(0, 0, 0, 0.95);
      border: 2px solid #ff4444;
      border-radius: 8px;
      padding: 15px;
      z-index: 10000;
      font-family: 'Courier New', monospace;
      color: #fff;
      display: none;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 0 30px rgba(255, 0, 0, 0.3);
    `;

    // Header
    const header = document.createElement("div");
    header.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h3 style="margin: 0; color: #ff4444; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">
          🔍 MAZE DEBUG
        </h3>
        <span style="color: #666; font-size: 11px;">Press B to close</span>
      </div>
    `;
    this.container.appendChild(header);

    // Canvas for maze visualization
    this.canvas = document.createElement("canvas");
    this.canvas.width = 390;
    this.canvas.height = 390;
    this.canvas.style.cssText = `
      border: 1px solid #333;
      border-radius: 4px;
      background: #111;
      display: block;
      margin-bottom: 15px;
    `;
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    // Legend
    const legend = document.createElement("div");
    legend.style.cssText = `
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
      margin-bottom: 15px;
      font-size: 10px;
    `;
    legend.innerHTML = `
      <div><span style="display:inline-block;width:12px;height:12px;background:#222;border:1px solid #444;margin-right:4px;vertical-align:middle;"></span>Wall</div>
      <div><span style="display:inline-block;width:12px;height:12px;background:#4a5568;margin-right:4px;vertical-align:middle;"></span>Path</div>
      <div><span style="display:inline-block;width:12px;height:12px;background:#48bb78;margin-right:4px;vertical-align:middle;"></span>Start</div>
      <div><span style="display:inline-block;width:12px;height:12px;background:#f56565;margin-right:4px;vertical-align:middle;"></span>End</div>
      <div><span style="display:inline-block;width:12px;height:12px;background:#805ad5;margin-right:4px;vertical-align:middle;"></span>Room</div>
      <div><span style="display:inline-block;width:12px;height:12px;background:#ed8936;margin-right:4px;vertical-align:middle;"></span>Portal</div>
    `;
    this.container.appendChild(legend);

    // Stats container
    this.statsDiv = document.createElement("div");
    this.statsDiv.style.cssText = `
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      padding: 10px;
      font-size: 11px;
      line-height: 1.6;
    `;
    this.container.appendChild(this.statsDiv);

    // Action buttons
    const actions = document.createElement("div");
    actions.style.cssText = `
      display: flex;
      gap: 10px;
      margin-top: 15px;
    `;
    actions.innerHTML = `
      <button id="maze-debug-export" style="
        flex: 1;
        padding: 8px;
        background: #333;
        color: #fff;
        border: 1px solid #555;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
      ">📥 Export PNG</button>
      <button id="maze-debug-copy" style="
        flex: 1;
        padding: 8px;
        background: #333;
        color: #fff;
        border: 1px solid #555;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
      ">📋 Copy Stats</button>
    `;
    this.container.appendChild(actions);

    document.body.appendChild(this.container);

    // Event listeners
    document
      .getElementById("maze-debug-export")
      ?.addEventListener("click", () => {
        this._exportPNG();
      });
    document
      .getElementById("maze-debug-copy")
      ?.addEventListener("click", () => {
        this._copyStats();
      });
  }

  _setupKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyB") {
        this.toggle();
      }
    });
  }

  toggle() {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? "block" : "none";
    if (this.isVisible && this.mazeData) {
      this._render();
    }
  }

  show() {
    this.isVisible = true;
    this.container.style.display = "block";
    if (this.mazeData) {
      this._render();
    }
  }

  hide() {
    this.isVisible = false;
    this.container.style.display = "none";
  }

  /**
   * Update the panel with maze data
   * @param {MazeGenerator} mazeGenerator - The maze generator instance
   */
  update(mazeGenerator) {
    if (!mazeGenerator) return;

    const data = mazeGenerator.getMazeData();
    this.mazeData = data;
    this.rooms = mazeGenerator.rooms || [];
    this.seed = mazeGenerator.seed;
    this.complexity = mazeGenerator.config?.complexity || 0.75;

    // Read connectivity status from generator
    this.connectivityFixed = mazeGenerator.connectivityFixed || false;
    this.cellsCarved = mazeGenerator.cellsCarvedForConnectivity || 0;

    if (this.isVisible) {
      this._render();
    }
  }

  _render() {
    if (!this.mazeData) return;

    const { maze, width, height, startPos, endPos, cellSize } = this.mazeData;

    // Calculate cell size for canvas
    const canvasSize = 390;
    const cellPixels = Math.floor(canvasSize / Math.max(width, height));
    const offsetX = Math.floor((canvasSize - width * cellPixels) / 2);
    const offsetY = Math.floor((canvasSize - height * cellPixels) / 2);

    // Clear canvas
    this.ctx.fillStyle = "#111";
    this.ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Draw grid
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = offsetX + x * cellPixels;
        const py = offsetY + y * cellPixels;

        // Determine cell color
        let color;
        if (x === startPos.x && y === startPos.y) {
          color = "#48bb78"; // Start - Green
        } else if (x === endPos.x && y === endPos.y) {
          color = "#f56565"; // End - Red
        } else if (this._isInRoom(x, y)) {
          color = "#805ad5"; // Room - Purple
        } else if (maze[y][x] === 0) {
          color = "#4a5568"; // Path - Gray
        } else {
          color = "#1a1a2e"; // Wall - Dark
        }

        this.ctx.fillStyle = color;
        this.ctx.fillRect(px, py, cellPixels - 1, cellPixels - 1);
      }
    }

    // Draw portal indicator at end position
    const portalX = offsetX + endPos.x * cellPixels;
    const portalY = offsetY + endPos.y * cellPixels;
    this.ctx.strokeStyle = "#ed8936";
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(
      portalX - 2,
      portalY - 2,
      cellPixels + 2,
      cellPixels + 2,
    );

    // Calculate stats
    const totalCells = width * height;
    const pathCells = maze.flat().filter((c) => c === 0).length;
    const wallCells = totalCells - pathCells;
    const pathRatio = ((pathCells / totalCells) * 100).toFixed(1);

    // Update stats display
    this.statsDiv.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div>
          <div style="color: #888; font-size: 10px;">DIMENSIONS</div>
          <div style="color: #fff;">${width} × ${height}</div>
        </div>
        <div>
          <div style="color: #888; font-size: 10px;">CELL SIZE</div>
          <div style="color: #fff;">${cellSize} units</div>
        </div>
        <div>
          <div style="color: #888; font-size: 10px;">SEED</div>
          <div style="color: #4299e1; font-family: monospace;">${
            this.seed || "N/A"
          }</div>
        </div>
        <div>
          <div style="color: #888; font-size: 10px;">COMPLEXITY</div>
          <div style="color: #fff;">${(this.complexity * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div style="color: #888; font-size: 10px;">TOTAL CELLS</div>
          <div style="color: #fff;">${totalCells.toLocaleString()}</div>
        </div>
        <div>
          <div style="color: #888; font-size: 10px;">PATH RATIO</div>
          <div style="color: #48bb78;">${pathRatio}%</div>
        </div>
        <div>
          <div style="color: #888; font-size: 10px;">ROOMS</div>
          <div style="color: #805ad5;">${this.rooms.length}</div>
        </div>
        <div>
          <div style="color: #888; font-size: 10px;">START → END</div>
          <div style="color: #fff;">(${startPos.x},${startPos.y}) → (${
      endPos.x
    },${endPos.y})</div>
        </div>
      </div>
      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #333;">
        <div style="color: #888; font-size: 10px;">CONNECTIVITY</div>
        <div style="color: ${this.connectivityFixed ? "#ed8936" : "#48bb78"};">
          ${
            this.connectivityFixed
              ? `⚠️ Fixed (carved ${this.cellsCarved} cells)`
              : "✓ Natural path exists"
          }
        </div>
      </div>
    `;
  }

  _isInRoom(x, y) {
    for (const room of this.rooms) {
      const halfSize = Math.floor(room.size / 2);
      if (
        x >= room.x - halfSize &&
        x <= room.x + halfSize &&
        y >= room.y - halfSize &&
        y <= room.y + halfSize
      ) {
        return true;
      }
    }
    return false;
  }

  _exportPNG() {
    const link = document.createElement("a");
    link.download = `maze_${this.seed || "unknown"}_${Date.now()}.png`;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  _copyStats() {
    if (!this.mazeData) return;

    const { width, height, startPos, endPos, cellSize } = this.mazeData;
    const totalCells = width * height;
    const pathCells = this.mazeData.maze.flat().filter((c) => c === 0).length;

    const stats = `
MAZE DEBUG EXPORT
=================
Seed: ${this.seed}
Dimensions: ${width} × ${height}
Cell Size: ${cellSize} units
Complexity: ${(this.complexity * 100).toFixed(0)}%
Total Cells: ${totalCells}
Path Cells: ${pathCells} (${((pathCells / totalCells) * 100).toFixed(1)}%)
Rooms: ${this.rooms.length}
Start: (${startPos.x}, ${startPos.y})
End: (${endPos.x}, ${endPos.y})
Connectivity: ${
      this.connectivityFixed
        ? `Fixed (${this.cellsCarved} cells carved)`
        : "Natural"
    }
Exported: ${new Date().toISOString()}
    `.trim();

    navigator.clipboard.writeText(stats).then(() => {
      const btn = document.getElementById("maze-debug-copy");
      if (btn) {
        const original = btn.textContent;
        btn.textContent = "✓ Copied!";
        setTimeout(() => {
          btn.textContent = original;
        }, 1500);
      }
    });
  }

  dispose() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}

// Singleton instance
let debugPanelInstance = null;

export function getMazeDebugPanel() {
  if (!debugPanelInstance) {
    debugPanelInstance = new MazeDebugPanel();
  }
  return debugPanelInstance;
}
