import * as THREE from "three";

export class Minimap {
  constructor(scene, camera, mazeData) {
    this.mazeData = mazeData;
    this.visible = true;

    // Config
    this.size = 200; // Widget size (px)
    this.zoom = 2; // Pixels per world unit (Scale)
    this.rotateMap = true; // GTA Style = Rotating Map

    this._createUI();
  }

  _createUI() {
    const isMobile = window.innerWidth < 768;

    // Container
    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.bottom = isMobile ? "20px" : "30px"; // Move to Bottom-Right for GPS feel?
    // Actually typically GPS is Bottom-Left or Bottom-Right. Let's keep Top-Right or move to Bottom-Right?
    // User didn't specify pos, just "2.5d". Top-Right is fine but maybe obstructed.
    // Let's keep existing Top-Right but tilted.
    this.container.style.top = isMobile ? "60px" : "30px";
    this.container.style.right = "20px";
    this.container.style.width = `${this.size}px`;
    this.container.style.height = `${this.size}px`;
    // 3D Transform
    this.container.style.transform = "perspective(600px) rotateX(40deg)";
    this.container.style.transformStyle = "preserve-3d";

    this.container.style.borderRadius = "50%";
    this.container.style.border = "4px solid rgba(200, 200, 200, 0.5)"; // Thicker rim for depth
    this.container.style.backgroundColor = "#000";
    this.container.style.overflow = "hidden";
    this.container.style.zIndex = "900";
    this.container.style.boxShadow = "0 10px 20px rgba(0,0,0,0.5)"; // Deep shadow
    document.body.appendChild(this.container);

    // Canvas
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    // Player is now drawn directly on canvas for better scaling accuracy
    // No more DOM overlay elements needed
  }

  update(params) {
    if (!this.visible) return;

    const { playerPos, playerRot, ghosts, shards, exitPos, isFlashlightOn } =
      params;
    const ctx = this.ctx;
    const cx = this.size / 2;
    const cy = this.size / 2;

    // Update Flashlight Visibility
    if (this.flashlightCone) {
      this.flashlightCone.style.display = isFlashlightOn ? "block" : "none";
    }

    // Clear
    ctx.fillStyle = "#000000"; // Pure black background (Corridors)
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.save();

    // 1. Center Canvas
    ctx.translate(cx, cy);

    // 2. Rotate Map (Limit: If we want Player-Up, we rotate map opposite to player)
    if (this.rotateMap) {
      ctx.rotate(playerRot); // Standard ThreeJS rotation is CCW? Check calibration.
      // Usually playerRot is mesh.rotation.y.
    }

    // 3. Translate to Player World Pos (Negative, because we move the world away)
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-playerPos.x, -playerPos.z);

    // --- DRAW WORLD START ---

    // Optimization: Calculate visible bounds in "Grid Units"
    // Viewport width in world units = size / zoom
    const viewWorldSize = this.size / this.zoom;
    const halfView = (viewWorldSize / 2) * 1.5; // Mult 1.5 for rotation safety coverage

    // Bounds
    const minX = playerPos.x - halfView;
    const maxX = playerPos.x + halfView;
    const minZ = playerPos.z - halfView;
    const maxZ = playerPos.z + halfView;

    const { maze, cellSize, width, height } = this.mazeData;

    // Convert to grid coords
    const gridMinX = Math.max(0, Math.floor(minX / cellSize));
    const gridMaxX = Math.min(width - 1, Math.ceil(maxX / cellSize));
    const gridMinY = Math.max(0, Math.floor(minZ / cellSize));
    const gridMaxY = Math.min(height - 1, Math.ceil(maxZ / cellSize));

    // Draw Walls - Thin & Connected (Maze Style)
    ctx.fillStyle = "#FFFFFF";

    // Wall thickness setup
    const wallThickness = Math.max(1, cellSize * 0.3); // 30% of cell size
    const centerOffset = (cellSize - wallThickness) / 2;

    // Helper to check if a cell is a wall (with boundary safety)
    const isWall = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return maze[y][x] === 1;
    };

    for (let y = gridMinY; y <= gridMaxY; y++) {
      for (let x = gridMinX; x <= gridMaxX; x++) {
        if (maze[y][x] === 1) {
          const px = x * cellSize;
          const py = y * cellSize;

          // 1. Draw central hub
          ctx.fillRect(
            px + centerOffset,
            py + centerOffset,
            wallThickness,
            wallThickness,
          );

          // 2. Connect to neighbors
          // North
          if (isWall(x, y - 1)) {
            ctx.fillRect(
              px + centerOffset,
              py,
              wallThickness,
              centerOffset + 1,
            );
          }
          // South
          if (isWall(x, y + 1)) {
            ctx.fillRect(
              px + centerOffset,
              py + centerOffset,
              wallThickness,
              centerOffset + 1,
            );
          }
          // West
          if (isWall(x - 1, y)) {
            ctx.fillRect(
              px,
              py + centerOffset,
              centerOffset + 1,
              wallThickness,
            );
          }
          // East
          if (isWall(x + 1, y)) {
            ctx.fillRect(
              px + centerOffset,
              py + centerOffset,
              centerOffset + 1,
              wallThickness,
            );
          }
        }
      }
    }

    // Draw Floor (just bg) or specific tiles if needed?
    // We already filled BG with dark gray.

    // Draw Start Marker (Green)
    if (this.mazeData.startPos) {
      const s = this.mazeData.startPos;
      this._drawDot(
        ctx,
        s.x * cellSize + cellSize / 2,
        s.y * cellSize + cellSize / 2,
        1.5,
        "#00ff00",
      );
    }

    // Draw Traps (New)
    if (params.traps) {
      for (const trap of params.traps) {
        if (trap.type === "SpikeTrap") {
          // Orange for Spikes
          this._drawDot(ctx, trap.x, trap.z, 1.2, "#ffa500");
        } else {
          // Brown for Mud
          this._drawDot(ctx, trap.x, trap.z, 1.2, "#8b4513");
        }
      }
    }

    // Draw Exit Marker (Red Beacon)
    if (exitPos) {
      // Pulse effect
      const pulse = 1.0 + Math.sin(Date.now() * 0.005) * 0.3;
      this._drawDot(ctx, exitPos.x, exitPos.z, 2.0 * pulse, "#ff0000");
    }

    // Draw Shards cyan
    ctx.fillStyle = "#00ffff";
    for (const pos of shards) {
      ctx.beginPath();
      // Diamond shape
      ctx.moveTo(pos.x, pos.z - 1);
      ctx.lineTo(pos.x + 1, pos.z);
      ctx.lineTo(pos.x, pos.z + 1);
      ctx.lineTo(pos.x - 1, pos.z);
      ctx.fill();
    }

    // Draw Ghosts (Red Skulls/Dots)
    ctx.fillStyle = "#ff4444";
    for (const ghost of ghosts) {
      // Use ghost.x/z from parameter
      this._drawDot(ctx, ghost.x, ghost.z, 1.2, "#ff4444");
      // Vision cone for ghost?
      // ctx.beginPath(); ...
    }

    // --- DRAW WORLD END ---

    // Draw Player (Last, on top of everything)
    // Drawn in WORLD coordinates so it rotates/scales with the map

    ctx.save();
    ctx.translate(playerPos.x, playerPos.z);

    // Counter-rotate the player icon if we want it to point "Up" relative to the map?
    // Current setup: Map rotates so world-forward is Up.
    // So Player is technically always facing Up relative to the canvas frame if Map rotates.
    // BUT, player might be looking left/right relative to movement.
    // If Map rotates with Player (Player-Up), then Player icon is static Up.
    // BUT we are drawing inside the rotated world context.
    // So we need to rotate the player icon to match its world rotation relative to the world.
    // Wait.
    // World is rotated by -PlayerRot.
    // If we draw player at 0 rotation in world, it points North in World.
    // Player IS rotated by PlayerRot in World.
    // So we rotate by playerRot (standard).

    // However, for "Player Up" map:
    // We rotated the whole Context by -playerRot (or +playerRot depending on sign).
    // If we draw the player with rotation `playerRot`, it will appear effectively static UP.
    // Let's verify:
    // Context Rot = -P.
    // Player Rot = P.
    // Net Rot = 0 (Up).
    // EXCEPT we want to show the arrow accurately.
    // Yes.

    // Let's use specific color for high viz
    // Counter-rotate by playerRot so the arrow stays pointing "Up" (Forward) relative to the screen,
    // effectively cancelling the map's rotation.
    // If we want it to point North, we wouldn't rotate (but map rotates).
    // For "Player Up" view, arrow is static Up.
    // Context is rotated by R. We rotate by -R to be static.

    ctx.rotate(-playerRot);

    // Draw Arrow
    const arrowSize = cellSize * 0.6; // Scale relative to corridor width (60%)

    ctx.shadowBlur = 10;
    ctx.shadowColor = "#FFFF00"; // Yellow Glow
    ctx.fillStyle = "#FFFF00";

    ctx.beginPath();
    ctx.moveTo(0, -arrowSize); // Tip (Forward is -Z in 2D canvas usually? No Y is down. -Y is Up.)
    // In Canvas:
    // 0,0 is current pos.
    // -Y is Up.
    // If 3D World -Z is Forward.
    // Our map maps World Z to Canvas Y.
    // So World -Z is Canvas -Y. Correct.

    ctx.lineTo(arrowSize * 0.7, arrowSize * 0.8); // Right Back
    ctx.lineTo(0, arrowSize * 0.5); // Notch
    ctx.lineTo(-arrowSize * 0.7, arrowSize * 0.8); // Left Back
    ctx.closePath();
    ctx.fill();

    // Flashlight Cone (Canvas version)
    if (isFlashlightOn) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255, 255, 200, 0.2)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-arrowSize * 3, -arrowSize * 8); // 8 units forward, 3 units wide left
      ctx.lineTo(arrowSize * 3, -arrowSize * 8); // 8 units forward, 3 units wide right
      ctx.fill();
    }

    ctx.restore();

    ctx.restore();
  }

  _drawDot(ctx, x, z, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, z, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  toggleVisibility() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? "block" : "none";
  }

  dispose() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
