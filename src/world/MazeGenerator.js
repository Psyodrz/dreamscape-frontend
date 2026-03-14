import * as THREE from "three";
import { getTextureEngine } from "../systems/TextureEngine.js";

export class MazeGenerator {
  constructor(physicsSystem, scene, renderer, options = {}) {
    this.physicsSystem = physicsSystem;
    this.scene = scene;
    this.renderer = renderer; // Need for anisotropy capabilities

    this.config = {
      width: options.width || 25,
      height: options.height || 25,
      cellSize: options.cellSize || 4,
      wallHeight: options.wallHeight || 3,
      wallThickness: options.wallThickness || 0.6, // Increased from 0.1 for thicker walls
      complexity: options.complexity || 0.75,
      seed: options.seed || null,
    };

    this.config.width =
      this.config.width % 2 === 0 ? this.config.width + 1 : this.config.width;
    this.config.height =
      this.config.height % 2 === 0
        ? this.config.height + 1
        : this.config.height;

    this.maze = [];
    this.visited = [];
    this.stack = [];

    this.colors = {
      wall: 0x4a5568,
      floor: 0x2d3748,
      start: 0x48bb78,
      end: 0xf56565,
      path: 0x4299e1,
      ceiling: 0x1a202c,
    };

    this.startPos = { x: 1, y: 1 };
    this.endPos = { x: this.config.width - 2, y: this.config.height - 2 };

    this.wallMeshes = [];
    this.wallBodies = [];
    this.floorBody = null;
    this.markers = [];

    this.wallTexture = null;
    this.wallMaterial = null;
    this.floorTexture = null;
    this.floorMaterial = null;
    this.floorMesh = null;

    this._initRNG();

    // Use TextureEngine for material loading
    this.textureEngine = getTextureEngine();
    this.textureEngine.init(renderer);

    this.readyPromise = Promise.all([
      this._loadWallTexture(),
      this._loadFloorTexture(),
    ]).then(() => {
      this._initializeMaze();
      this._generateMaze();
      this._optimizeMaze();
      this._createMazeGeometry();
      return this;
    });
  }

  ready() {
    return this.readyPromise || Promise.resolve(this);
  }

  async _loadWallTexture() {
    try {
      // Use TextureEngine for wall material
      this.wallMaterial = await this.textureEngine.getPreset("wall");
      this.wallTexture = this.wallMaterial.map;
      console.log("[MazeGenerator] Wall material loaded via TextureEngine");
    } catch (error) {
      console.warn(
        "[MazeGenerator] Failed to load wall texture, using fallback",
      );
      this.wallMaterial = new THREE.MeshStandardMaterial({
        color: this.colors.wall,
        metalness: 0.2,
        roughness: 0.7,
      });
    }
  }

  async _loadFloorTexture() {
    try {
      const floorSize = this.config.width * this.config.cellSize;
      // Use TextureEngine for floor material with reduced repeat for less tiling
      // Lower repeat values = larger texture scale = less visible repetition
      this.floorMaterial = await this.textureEngine.getPreset("floor", {
        repeat: { x: floorSize / 4, y: floorSize / 4 }, // Smaller texture scale
      });
      this.floorTexture = this.floorMaterial.map;
      console.log("[MazeGenerator] Floor material loaded via TextureEngine");
    } catch (error) {
      console.warn(
        "[MazeGenerator] Failed to load floor texture, using fallback",
      );
      this.floorMaterial = new THREE.MeshStandardMaterial({
        color: this.colors.floor,
        metalness: 0.1,
        roughness: 0.9,
      });
    }
  }

  /**
   * Fix BoxGeometry UVs to use consistent world-space texture scale
   * This prevents stretching/compression on faces with different dimensions
   * @param {THREE.BoxGeometry} geometry - The box geometry to fix
   * @param {number} width - Box width (X dimension)
   * @param {number} height - Box height (Y dimension)
   * @param {number} depth - Box depth (Z dimension)
   * @param {number} textureScale - Units per texture repeat (default 4 = cellSize)
   */
  _fixBoxGeometryUVs(geometry, width, height, depth, textureScale = 4) {
    const uvAttribute = geometry.attributes.uv;
    const uvArray = uvAttribute.array;

    // BoxGeometry face order (6 faces, 4 vertices each = 24 vertices):
    // 0-3:   +X (right)   - uses depth × height
    // 4-7:   -X (left)    - uses depth × height
    // 8-11:  +Y (top)     - uses width × depth
    // 12-15: -Y (bottom)  - uses width × depth
    // 16-19: +Z (front)   - uses width × height
    // 20-23: -Z (back)    - uses width × height

    // Calculate UV scale for each face based on actual dimensions
    const scales = {
      rightLeft: { u: depth / textureScale, v: height / textureScale },
      topBottom: { u: width / textureScale, v: depth / textureScale },
      frontBack: { u: width / textureScale, v: height / textureScale },
    };

    // Helper to set UV for a vertex (scales 0-1 range to actual scale)
    const setUV = (index, uScale, vScale) => {
      // Get original 0-1 UV and scale it
      const u = uvArray[index * 2];
      const v = uvArray[index * 2 + 1];
      uvArray[index * 2] = u * uScale;
      uvArray[index * 2 + 1] = v * vScale;
    };

    // Apply correct scales to each face
    // Right face (+X): vertices 0-3
    for (let i = 0; i < 4; i++)
      setUV(i, scales.rightLeft.u, scales.rightLeft.v);
    // Left face (-X): vertices 4-7
    for (let i = 4; i < 8; i++)
      setUV(i, scales.rightLeft.u, scales.rightLeft.v);
    // Top face (+Y): vertices 8-11
    for (let i = 8; i < 12; i++)
      setUV(i, scales.topBottom.u, scales.topBottom.v);
    // Bottom face (-Y): vertices 12-15
    for (let i = 12; i < 16; i++)
      setUV(i, scales.topBottom.u, scales.topBottom.v);
    // Front face (+Z): vertices 16-19
    for (let i = 16; i < 20; i++)
      setUV(i, scales.frontBack.u, scales.frontBack.v);
    // Back face (-Z): vertices 20-23
    for (let i = 20; i < 24; i++)
      setUV(i, scales.frontBack.u, scales.frontBack.v);

    uvAttribute.needsUpdate = true;
    return geometry;
  }

  _initRNG() {
    this.seed = this.config.seed || Math.floor(Math.random() * 1000000);
    this.rngState = this.seed;
  }

  _random() {
    this.rngState = (this.rngState * 1664525 + 1013904223) % 4294967296;
    return this.rngState / 4294967296;
  }

  _initializeMaze() {
    this.maze = Array(this.config.height)
      .fill()
      .map(() => Array(this.config.width).fill(1));

    this.visited = Array(this.config.height)
      .fill()
      .map(() => Array(this.config.width).fill(false));

    for (let y = 1; y < this.config.height - 1; y += 2) {
      for (let x = 1; x < this.config.width - 1; x += 2) {
        this.maze[y][x] = 0;
      }
    }

    // Pre-carve rooms before DFS for combat arenas and landmarks
    this._carveRooms();
  }

  _carveRooms() {
    // Calculate number of rooms based on maze size
    const mazeArea = this.config.width * this.config.height;
    const roomCount = Math.floor(mazeArea / 400) + 2; // ~1 room per 400 cells, min 2
    const minRoomSpacing = 10; // Cells between room centers

    this.rooms = []; // Store room info for later use (spawn points, etc.)

    for (let i = 0; i < roomCount; i++) {
      let attempts = 0;
      const maxAttempts = 50;

      while (attempts < maxAttempts) {
        // Random room size (3x3 or 4x4)
        const roomSize = this._random() > 0.5 ? 3 : 4;

        // Random position (avoiding edges)
        const margin = roomSize + 2;
        const rx =
          Math.floor(this._random() * (this.config.width - margin * 2)) +
          margin;
        const ry =
          Math.floor(this._random() * (this.config.height - margin * 2)) +
          margin;

        // Check distance from start/end positions
        const distFromStart = Math.sqrt(
          Math.pow(rx - this.startPos.x, 2) + Math.pow(ry - this.startPos.y, 2),
        );
        const distFromEnd = Math.sqrt(
          Math.pow(rx - this.endPos.x, 2) + Math.pow(ry - this.endPos.y, 2),
        );

        // Check distance from other rooms
        const tooCloseToRoom = this.rooms.some((room) => {
          const dist = Math.sqrt(
            Math.pow(rx - room.x, 2) + Math.pow(ry - room.y, 2),
          );
          return dist < minRoomSpacing;
        });

        if (distFromStart > 5 && distFromEnd > 5 && !tooCloseToRoom) {
          // Carve the room
          for (let dy = 0; dy < roomSize; dy++) {
            for (let dx = 0; dx < roomSize; dx++) {
              const cellX = rx + dx - Math.floor(roomSize / 2);
              const cellY = ry + dy - Math.floor(roomSize / 2);

              if (
                cellX > 0 &&
                cellX < this.config.width - 1 &&
                cellY > 0 &&
                cellY < this.config.height - 1
              ) {
                this.maze[cellY][cellX] = 0;
                this.visited[cellY][cellX] = true; // Mark as visited for DFS
              }
            }
          }

          this.rooms.push({ x: rx, y: ry, size: roomSize });
          break;
        }
        attempts++;
      }
    }

    console.log(`[MazeGenerator] Carved ${this.rooms.length} rooms`);
  }

  _generateMaze() {
    const startX = 1;
    const startY = 1;

    this.stack = [{ x: startX, y: startY }];
    this.visited[startY][startX] = true;

    while (this.stack.length > 0) {
      const current = this.stack[this.stack.length - 1];
      const neighbors = this._getUnvisitedNeighbors(current.x, current.y);

      if (neighbors.length > 0) {
        const next = this._chooseNeighbor(neighbors);

        const wallX = current.x + Math.floor((next.x - current.x) / 2);
        const wallY = current.y + Math.floor((next.y - current.y) / 2);
        this.maze[wallY][wallX] = 0;

        this.visited[next.y][next.x] = true;
        this.stack.push(next);
      } else {
        this.stack.pop();
      }
    }

    this.maze[this.startPos.y][this.startPos.x] = 0;
    this.maze[this.endPos.y][this.endPos.x] = 0;

    this._addStrategicOpenings();
    this._ensureEndConnectivity(); // Guarantee path exists from start to end
  }

  /**
   * Post-generation connectivity enforcement using BFS.
   * If end position is not reachable from start, carve a minimal corridor.
   * This fixes the bug where _carveRooms() marks cells as visited,
   * blocking DFS from reaching the end corner.
   */
  _ensureEndConnectivity() {
    const queue = [{ x: this.startPos.x, y: this.startPos.y }];
    const visited = Array.from({ length: this.config.height }, () =>
      Array(this.config.width).fill(false),
    );

    visited[this.startPos.y][this.startPos.x] = true;

    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    // BFS to find all reachable cells from start
    while (queue.length > 0) {
      const { x, y } = queue.shift();

      // Early exit if we can reach the end
      if (x === this.endPos.x && y === this.endPos.y) {
        console.log(
          "[MazeGenerator] End position is reachable - no fix needed",
        );
        return;
      }

      for (const d of dirs) {
        const nx = x + d.dx;
        const ny = y + d.dy;

        if (
          nx > 0 &&
          nx < this.config.width - 1 &&
          ny > 0 &&
          ny < this.config.height - 1 &&
          !visited[ny][nx] &&
          this.maze[ny][nx] === 0
        ) {
          visited[ny][nx] = true;
          queue.push({ x: nx, y: ny });
        }
      }
    }

    // End not reachable - carve a corridor from end towards nearest reachable cell
    console.log(
      "[MazeGenerator] End position unreachable! Carving connectivity corridor...",
    );

    let cx = this.endPos.x;
    let cy = this.endPos.y;
    let carved = 0;

    // Carve towards start until we hit a reachable cell
    while (
      !visited[cy][cx] &&
      carved < this.config.width + this.config.height
    ) {
      this.maze[cy][cx] = 0;
      carved++;

      // Move towards start, preferring diagonal approach
      if (cx > this.startPos.x && this.maze[cy][cx - 1] !== 0) {
        cx--;
      } else if (cy > this.startPos.y && this.maze[cy - 1][cx] !== 0) {
        cy--;
      } else if (cx > this.startPos.x) {
        cx--;
      } else if (cy > this.startPos.y) {
        cy--;
      } else {
        break;
      }
    }

    // Store connectivity fix status for debug panel
    this.connectivityFixed = true;
    this.cellsCarvedForConnectivity = carved;

    console.log(
      `[MazeGenerator] Carved ${carved} cells to ensure connectivity`,
    );
  }

  _getUnvisitedNeighbors(x, y) {
    const neighbors = [];
    const directions = [
      { dx: 0, dy: -2, name: "north" },
      { dx: 2, dy: 0, name: "east" },
      { dx: 0, dy: 2, name: "south" },
      { dx: -2, dy: 0, name: "west" },
    ];

    for (const dir of directions) {
      const newX = x + dir.dx;
      const newY = y + dir.dy;

      if (
        newX > 0 &&
        newX < this.config.width - 1 &&
        newY > 0 &&
        newY < this.config.height - 1 &&
        !this.visited[newY][newX]
      ) {
        neighbors.push({ x: newX, y: newY, direction: dir.name });
      }
    }

    return neighbors;
  }

  _chooseNeighbor(neighbors) {
    return neighbors[Math.floor(this._random() * neighbors.length)];
  }

  _addStrategicOpenings() {
    // Increased multiplier for more loops and alternate paths (was 10)
    const openings = Math.floor((1 - this.config.complexity) * 30);

    for (let i = 0; i < openings; i++) {
      const x = Math.floor(this._random() * (this.config.width - 4)) + 2;
      const y = Math.floor(this._random() * (this.config.height - 4)) + 2;

      if (this.maze[y][x] === 1) {
        const adjacentPaths = this._countAdjacentPaths(x, y);
        if (adjacentPaths >= 2) {
          this.maze[y][x] = 0;
        }
      }
    }
  }

  _countAdjacentPaths(x, y) {
    let count = 0;
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];

    for (const dir of directions) {
      const newX = x + dir.dx;
      const newY = y + dir.dy;

      if (
        newX >= 0 &&
        newX < this.config.width &&
        newY >= 0 &&
        newY < this.config.height &&
        this.maze[newY][newX] === 0
      ) {
        count++;
      }
    }

    return count;
  }

  _optimizeMaze() {
    if (this.config.complexity < 0.5) {
      this._removeDeadEnds(Math.floor((0.5 - this.config.complexity) * 20));
    }
  }

  _removeDeadEnds(count) {
    for (let i = 0; i < count; i++) {
      for (let y = 1; y < this.config.height - 1; y++) {
        for (let x = 1; x < this.config.width - 1; x++) {
          if (
            this.maze[y][x] === 0 &&
            this._countAdjacentPaths(x, y) === 1 &&
            !(x === this.startPos.x && y === this.startPos.y) &&
            !(x === this.endPos.x && y === this.endPos.y)
          ) {
            this.maze[y][x] = 1;
          }
        }
      }
    }
  }

  _createMazeGeometry() {
    const cellSize = this.config.cellSize;
    const wallHeight = this.config.wallHeight;
    const wallThickness = this.config.wallThickness;

    this._createFloor();
    this._createWallsOptimized();
    this._createPerimeterWalls(); // Added textured perimeter walls
    this._createBoundaryWalls(); // Invisible walls to prevent escaping
    this._createStartMarker();
    this._createEndMarker();
    this._addAmbientLighting();
  }

  _createPerimeterWalls() {
    // Create SOLID BLOCKS for perimeter to fill the "glitch corridors"
    // Instead of thin walls, we fill the entire boundary row/col with solid geometry
    const cellSize = this.config.cellSize;
    const width = this.config.width;
    const height = this.config.height; // Maze height (Z direction)

    const mazePixelWidth = width * cellSize;
    const mazePixelDepth = height * cellSize;

    // Wall height can be standard or taller for perimeter
    const wallHeight = this.config.wallHeight;

    // Use the textured wall material
    const wallMaterial =
      this.wallMaterial ||
      new THREE.MeshStandardMaterial({
        color: this.colors.wall,
        metalness: 0.2,
        roughness: 0.7,
      });

    // We creating 4 solid blocks for the perimeter rings
    // North (Row 0), South (Row height-1), West (Col 0), East (Col width-1)

    const wallConfigs = [
      // North Wall Block (Row 0)
      {
        pos: [mazePixelWidth / 2, wallHeight / 2, cellSize / 2],
        dim: [mazePixelWidth, wallHeight, cellSize],
        uvScale: [mazePixelWidth / 4, wallHeight / 3],
      },
      // South Wall Block (Row height-1)
      {
        pos: [
          mazePixelWidth / 2,
          wallHeight / 2,
          mazePixelDepth - cellSize / 2,
        ],
        dim: [mazePixelWidth, wallHeight, cellSize],
        uvScale: [mazePixelWidth / 4, wallHeight / 3],
      },
      // West Wall Block (Col 0) - shortened to avoid overlap with N/S
      {
        pos: [cellSize / 2, wallHeight / 2, mazePixelDepth / 2],
        dim: [cellSize, wallHeight, mazePixelDepth - 2 * cellSize],
        uvScale: [cellSize / 4, wallHeight / 3],
      },
      // East Wall Block (Col width-1) - shortened to avoid overlap
      {
        pos: [
          mazePixelWidth - cellSize / 2,
          wallHeight / 2,
          mazePixelDepth / 2,
        ],
        dim: [cellSize, wallHeight, mazePixelDepth - 2 * cellSize],
        uvScale: [cellSize / 4, wallHeight / 3],
      },
    ];

    for (const wall of wallConfigs) {
      // Visual mesh
      const geometry = new THREE.BoxGeometry(...wall.dim);
      this._fixBoxGeometryUVs(geometry, wall.dim[0], wall.dim[1], wall.dim[2]);

      const mesh = new THREE.Mesh(geometry, wallMaterial);
      mesh.position.set(...wall.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.wallMeshes.push(mesh);

      // Physics body
      const body = this.physicsSystem.createStaticBox(
        { x: wall.pos[0], y: wall.pos[1], z: wall.pos[2] },
        { x: wall.dim[0] / 2, y: wall.dim[1] / 2, z: wall.dim[2] / 2 },
      );
      if (body) this.wallBodies.push(body.body);
    }
  }

  _createBoundaryWalls() {
    // Create VISIBLE boundary walls around the entire maze perimeter
    const mazeWidth = this.config.width * this.config.cellSize;
    const mazeDepth = this.config.height * this.config.cellSize;
    const wallHeight = this.config.wallHeight * 2;
    const wallThickness = 1;

    // Store boundary wall meshes for visibility toggle
    this.boundaryWalls = [];

    // Black material for boundary walls (no texture)
    const boundaryMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111, // Dark black
      metalness: 0.1,
      roughness: 0.9,
    });

    // Wall configurations: [position, dimensions]
    const wallConfigs = [
      // North wall (z = 0)
      {
        pos: [mazeWidth / 2, wallHeight / 2, -wallThickness / 2],
        dim: [mazeWidth + wallThickness * 2, wallHeight, wallThickness],
      },
      // South wall (z = mazeDepth)
      {
        pos: [mazeWidth / 2, wallHeight / 2, mazeDepth + wallThickness / 2],
        dim: [mazeWidth + wallThickness * 2, wallHeight, wallThickness],
      },
      // West wall (x = 0)
      {
        pos: [-wallThickness / 2, wallHeight / 2, mazeDepth / 2],
        dim: [wallThickness, wallHeight, mazeDepth],
      },
      // East wall (x = mazeWidth)
      {
        pos: [mazeWidth + wallThickness / 2, wallHeight / 2, mazeDepth / 2],
        dim: [wallThickness, wallHeight, mazeDepth],
      },
    ];

    for (const wall of wallConfigs) {
      // Visual mesh
      const geometry = new THREE.BoxGeometry(...wall.dim);
      const mesh = new THREE.Mesh(geometry, boundaryMaterial);
      mesh.position.set(...wall.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.boundaryWalls.push(mesh);

      // Physics body
      const body = this.physicsSystem.createStaticBox(
        { x: wall.pos[0], y: wall.pos[1], z: wall.pos[2] },
        { x: wall.dim[0] / 2, y: wall.dim[1] / 2, z: wall.dim[2] / 2 },
      );
      if (body) this.wallBodies.push(body.body);
    }
  }

  _createFloor() {
    const floorSize = this.config.width * this.config.cellSize;

    // Calculate subdivision count based on floor size
    // More subdivisions = better displacement detail, but higher vertex count
    // Target ~1 segment per world unit for good displacement quality
    const subdivisions = Math.min(128, Math.max(32, Math.floor(floorSize / 2)));

    // Use BoxGeometry WITH SUBDIVISIONS for displacement mapping
    // Without subdivisions, displacementMap has no vertices to displace!
    const floorGeometry = new THREE.BoxGeometry(
      floorSize,
      1,
      floorSize,
      subdivisions, // width segments (X)
      1, // height segments (Y) - sides don't need detail
      subdivisions, // depth segments (Z)
    );

    // Fix UVs for proper texture scaling on the floor
    this._fixBoxGeometryUVs(floorGeometry, floorSize, 1, floorSize);

    const floorMaterial =
      this.floorMaterial ||
      new THREE.MeshStandardMaterial({
        color: this.colors.floor,
        metalness: 0.1,
        roughness: 0.9,
        side: THREE.DoubleSide,
      });

    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.position.set(
      (this.config.width * this.config.cellSize) / 2,
      -0.5, // Top surface at y=0
      (this.config.height * this.config.cellSize) / 2,
    );
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    this.floorMesh = floorMesh;

    console.log(
      `[MazeGenerator] Floor created with ${subdivisions}x${subdivisions} subdivisions for displacement`,
    );

    // Create floor physics
    const floor = this.physicsSystem.createStaticBox(
      {
        x: (this.config.width * this.config.cellSize) / 2,
        y: -0.5,
        z: (this.config.height * this.config.cellSize) / 2,
      },
      { x: floorSize / 2, y: 0.5, z: floorSize / 2 },
    );
    if (floor) this.floorBody = floor.body;
  }

  _createWallsOptimized() {
    const cellSize = this.config.cellSize;
    const wallHeight = this.config.wallHeight;
    const wallThickness = this.config.wallThickness;

    const verticalWalls = [];
    const horizontalWalls = [];

    // Iterate only inner cells to avoid overlapping with _createPerimeterWalls
    for (let y = 1; y < this.config.height - 1; y++) {
      for (let x = 1; x < this.config.width - 1; x++) {
        if (
          x < this.config.width - 1 &&
          (this.maze[y][x] === 1 || this.maze[y][x + 1] === 1) &&
          !(this.maze[y][x] === 1 && this.maze[y][x + 1] === 1)
        ) {
          verticalWalls.push({ x, y });
        }

        if (
          y < this.config.height - 1 &&
          (this.maze[y][x] === 1 || this.maze[y + 1][x] === 1) &&
          !(this.maze[y][x] === 1 && this.maze[y + 1][x] === 1)
        ) {
          horizontalWalls.push({ x, y });
        }
      }
    }

    this._createInstancedWalls(
      verticalWalls,
      horizontalWalls,
      cellSize,
      wallHeight,
      wallThickness,
    );

    this._createCorners(verticalWalls, horizontalWalls);
  }

  /**
   * Create efficient InstancedMesh for walls
   * Reduces draw calls from N to 2 (one for vertical, one for horizontal)
   * Enables Frustum Culling for better FPS
   */
  _createInstancedWalls(
    verticalWalls,
    horizontalWalls,
    cellSize,
    wallHeight,
    wallThickness,
  ) {
    const dummy = new THREE.Object3D();

    // 1. Create Vertical Walls (Instanced)
    if (verticalWalls.length > 0) {
      const geometry = new THREE.BoxGeometry(
        wallThickness,
        wallHeight,
        cellSize,
      );
      // Fix UVs uniformly for the base geometry
      this._fixBoxGeometryUVs(geometry, wallThickness, wallHeight, cellSize);

      const material =
        this.wallMaterial ||
        new THREE.MeshStandardMaterial({
          color: this.colors.wall,
          metalness: 0.2,
          roughness: 0.7,
        });

      const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        verticalWalls.length,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage); // Static walls

      verticalWalls.forEach((wall, i) => {
        dummy.position.set(
          (wall.x + 1) * cellSize,
          wallHeight / 2,
          wall.y * cellSize + cellSize / 2,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });

      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.wallMeshes.push(mesh);
    }

    // 2. Create Horizontal Walls (Instanced)
    if (horizontalWalls.length > 0) {
      const geometry = new THREE.BoxGeometry(
        cellSize,
        wallHeight,
        wallThickness,
      );
      // Fix UVs uniformly for the base geometry
      this._fixBoxGeometryUVs(geometry, cellSize, wallHeight, wallThickness);

      const material =
        this.wallMaterial ||
        new THREE.MeshStandardMaterial({
          color: this.colors.wall,
          metalness: 0.2,
          roughness: 0.7,
        });

      const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        horizontalWalls.length,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

      horizontalWalls.forEach((wall, i) => {
        dummy.position.set(
          wall.x * cellSize + cellSize / 2,
          wallHeight / 2,
          (wall.y + 1) * cellSize,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });

      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.wallMeshes.push(mesh);
    }

    // 3. Create Physics Bodies (Batched/Optimized)
    this._createOptimizedPhysicsWalls(
      verticalWalls,
      horizontalWalls,
      cellSize,
      wallHeight,
      wallThickness,
    );
  }

  _createCorners(verticalWalls, horizontalWalls) {
    const cellSize = this.config.cellSize;
    const wallHeight = this.config.wallHeight;
    const wallThickness = this.config.wallThickness;

    // 1. Create Lookup Maps
    const vMap = new Set();
    verticalWalls.forEach((w) => vMap.add(`${w.x},${w.y}`));

    const hMap = new Set();
    horizontalWalls.forEach((w) => hMap.add(`${w.x},${w.y}`));

    const cornerPositions = [];
    const cornerNormals = [];
    const cornerUvs = [];
    const cornerIndices = [];

    // Corner geometry template
    // Slight overlap (1.01x) to prevent Z-fighting
    const size = wallThickness * 1.01;
    const boxGeometry = new THREE.BoxGeometry(size, wallHeight, size);
    // Fix UVs so corner pillars match wall texture scale
    this._fixBoxGeometryUVs(boxGeometry, size, wallHeight, size);

    let vertexOffset = 0;

    // Scan all potential grid intersection points
    for (let i = 0; i <= this.config.width; i++) {
      for (let j = 0; j <= this.config.height; j++) {
        // Check Vertical Walls neighboring this intersection
        // Vertical wall at index x is positioned at grid line x+1
        // So grid line i matches vertical wall index i-1
        const hasV_up = vMap.has(`${i - 1},${j}`); // Wall extending +Z
        const hasV_down = vMap.has(`${i - 1},${j - 1}`); // Wall extending -Z
        const hasV = hasV_up || hasV_down;

        // Check Horizontal Walls neighboring this intersection
        // Horizontal wall at index y is positioned at grid line y+1
        const hasH_right = hMap.has(`${i},${j - 1}`); // Wall extending +X
        const hasH_left = hMap.has(`${i - 1},${j - 1}`); // Wall extending -X
        const hasH = hasH_right || hasH_left;

        // If both types meet, place a corner filler
        if (hasV && hasH) {
          const px = i * cellSize;
          const py = wallHeight / 2;
          const pz = j * cellSize;

          const positions = boxGeometry.attributes.position.array;
          const normals = boxGeometry.attributes.normal.array;
          const uvs = boxGeometry.attributes.uv.array;
          const indices = boxGeometry.index.array;

          for (let k = 0; k < positions.length; k += 3) {
            cornerPositions.push(
              positions[k] + px,
              positions[k + 1] + py,
              positions[k + 2] + pz,
            );
          }
          for (let k = 0; k < normals.length; k++)
            cornerNormals.push(normals[k]);
          for (let k = 0; k < uvs.length; k++) cornerUvs.push(uvs[k]);
          for (let k = 0; k < indices.length; k++)
            cornerIndices.push(indices[k] + vertexOffset);

          vertexOffset += positions.length / 3;
        }
      }
    }

    boxGeometry.dispose();

    if (cornerPositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(cornerPositions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(cornerNormals, 3),
      );
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(cornerUvs, 2),
      );
      geometry.setIndex(cornerIndices);

      const wallMaterial =
        this.wallMaterial ||
        new THREE.MeshStandardMaterial({
          color: this.colors.wall,
          metalness: 0.2,
          roughness: 0.7,
          flatShading: false,
        });

      const mesh = new THREE.Mesh(geometry, wallMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.wallMeshes.push(mesh);
    }
  }

  _createOptimizedPhysicsWalls(
    verticalWalls,
    horizontalWalls,
    cellSize,
    wallHeight,
    wallThickness,
  ) {
    const groupedVerticalWalls = this._groupAdjacentWalls(
      verticalWalls,
      "vertical",
    );
    const groupedHorizontalWalls = this._groupAdjacentWalls(
      horizontalWalls,
      "horizontal",
    );

    for (const group of groupedVerticalWalls) {
      const halfX = wallThickness / 2;
      const halfY = wallHeight / 2;
      const halfZ = (group.length * cellSize) / 2;
      const posX = (group.x + 1) * cellSize;
      const posY = wallHeight / 2;
      const posZ = group.y * cellSize + (group.length * cellSize) / 2;

      const wall = this.physicsSystem.createStaticBox(
        { x: posX, y: posY, z: posZ },
        { x: halfX, y: halfY, z: halfZ },
      );
      if (wall) this.wallBodies.push(wall.body);
    }

    for (const group of groupedHorizontalWalls) {
      const halfX = (group.length * cellSize) / 2;
      const halfY = wallHeight / 2;
      const halfZ = wallThickness / 2;
      const posX = group.x * cellSize + (group.length * cellSize) / 2;
      const posY = wallHeight / 2;
      const posZ = (group.y + 1) * cellSize;

      const wall = this.physicsSystem.createStaticBox(
        { x: posX, y: posY, z: posZ },
        { x: halfX, y: halfY, z: halfZ },
      );
      if (wall) this.wallBodies.push(wall.body);
    }
  }

  _groupAdjacentWalls(walls, orientation) {
    if (walls.length === 0) return [];

    walls.sort((a, b) => {
      if (orientation === "vertical") {
        return a.x !== b.x ? a.x - b.x : a.y - b.y;
      } else {
        return a.y !== b.y ? a.y - b.y : a.x - b.x;
      }
    });

    const groups = [];
    let currentGroup = { x: walls[0].x, y: walls[0].y, length: 1 };

    for (let i = 1; i < walls.length; i++) {
      const wall = walls[i];
      const prevWall = walls[i - 1];

      const isAdjacent =
        orientation === "vertical"
          ? wall.x === prevWall.x && wall.y === prevWall.y + 1
          : wall.y === prevWall.y && wall.x === prevWall.x + 1;

      if (isAdjacent) {
        currentGroup.length++;
      } else {
        groups.push(currentGroup);
        currentGroup = { x: wall.x, y: wall.y, length: 1 };
      }
    }
    groups.push(currentGroup);

    return groups;
  }

  _createStartMarker() {
    const markerGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 32);
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: this.colors.start,
      metalness: 0.4,
      roughness: 0.3,
      emissive: this.colors.start,
      emissiveIntensity: 0.15,
    });

    const startMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    startMarker.position.set(
      this.startPos.x * this.config.cellSize + this.config.cellSize / 2,
      0.1,
      this.startPos.y * this.config.cellSize + this.config.cellSize / 2,
    );
    startMarker.castShadow = true;
    this.scene.add(startMarker);
    this.markers.push(startMarker);
  }

  _createEndMarker() {
    // End marker is now handled by HorrorPortal in Game.js
    // No cylinder marker needed
  }

  _addAmbientLighting() {
    const startLight = new THREE.PointLight(this.colors.start, 0.2, 8);
    startLight.position.set(
      this.startPos.x * this.config.cellSize + this.config.cellSize / 2,
      1,
      this.startPos.y * this.config.cellSize + this.config.cellSize / 2,
    );
    startLight.decay = 2;
    this.scene.add(startLight);

    const endLight = new THREE.PointLight(this.colors.end, 0.2, 8);
    endLight.position.set(
      this.endPos.x * this.config.cellSize + this.config.cellSize / 2,
      1,
      this.endPos.y * this.config.cellSize + this.config.cellSize / 2,
    );
    endLight.decay = 2;
    this.scene.add(endLight);
  }

  getWorldPosition(mazeX, mazeY) {
    return {
      x: mazeX * this.config.cellSize + this.config.cellSize / 2,
      y: 1.8,
      z: mazeY * this.config.cellSize + this.config.cellSize / 2,
    };
  }

  getMazeCoordinates(worldX, worldZ) {
    return {
      x: Math.floor(worldX / this.config.cellSize),
      y: Math.floor(worldZ / this.config.cellSize),
    };
  }

  isValidPosition(mazeX, mazeY) {
    if (
      mazeX < 0 ||
      mazeX >= this.config.width ||
      mazeY < 0 ||
      mazeY >= this.config.height
    ) {
      return false;
    }
    return this.maze[mazeY][mazeX] === 0;
  }

  getMazeData() {
    return {
      maze: this.maze,
      width: this.config.width,
      height: this.config.height,
      startPos: this.startPos,
      endPos: this.endPos,
      cellSize: this.config.cellSize,
      colors: this.colors,
    };
  }

  getStartPosition() {
    return this.getWorldPosition(this.startPos.x, this.startPos.y);
  }

  getEndPosition() {
    return this.getWorldPosition(this.endPos.x, this.endPos.y);
  }

  getRandomOpenCell() {
    // Single cell wrapper for legacy calls
    const cells = this.getMultipleRandomOpenCells(1);
    if (cells.length > 0) return cells[0];
    return this.getWorldPosition(this.endPos.x, this.endPos.y);
  }

  getMultipleRandomOpenCells(count, minSpacing = 4) {
    const openCells = [];
    const minDistFromStart = 5;

    // 1. Collect ALL valid open cells
    for (let y = 0; y < this.config.height; y++) {
      for (let x = 0; x < this.config.width; x++) {
        if (this.maze[y][x] === 0) {
          const distFromStart = Math.sqrt(
            Math.pow(x - this.startPos.x, 2) + Math.pow(y - this.startPos.y, 2),
          );
          if (distFromStart >= minDistFromStart) {
            openCells.push({ x, y });
          }
        }
      }
    }

    // 2. Fisher-Yates Shuffle using seeded RNG
    for (let i = openCells.length - 1; i > 0; i--) {
      const j = Math.floor(this._random() * (i + 1));
      [openCells[i], openCells[j]] = [openCells[j], openCells[i]];
    }

    // 3. Select cells with minimum spacing to spread across maze
    const selectedCells = [];
    for (const cell of openCells) {
      if (selectedCells.length >= count) break;

      // Check distance from all already selected cells
      const tooClose = selectedCells.some((selected) => {
        const dist = Math.sqrt(
          Math.pow(cell.x - selected.x, 2) + Math.pow(cell.y - selected.y, 2),
        );
        return dist < minSpacing;
      });

      if (!tooClose) {
        selectedCells.push(cell);
      }
    }

    // 4. If we couldn't get enough spaced cells, fill with remaining shuffled cells
    if (selectedCells.length < count) {
      for (const cell of openCells) {
        if (selectedCells.length >= count) break;
        if (!selectedCells.some((s) => s.x === cell.x && s.y === cell.y)) {
          selectedCells.push(cell);
        }
      }
    }

    // 5. Return converted to world pos
    return selectedCells.map((cell) => this.getWorldPosition(cell.x, cell.y));
  }

  // Expose seeded RNG for external use (e.g. selecting trap types)
  random() {
    return this._random();
  }

  regenerate(options = {}) {
    // Clear existing geometry
    this._clearGeometry();

    // Update config - CRITICAL: Must update seed BEFORE _initRNG()
    if (options.seed !== undefined) {
      this.config.seed = options.seed;
      console.log("MazeGenerator: Using provided seed:", options.seed);
    }
    if (options.width)
      this.config.width =
        options.width % 2 === 0 ? options.width + 1 : options.width;
    if (options.height)
      this.config.height =
        options.height % 2 === 0 ? options.height + 1 : options.height;
    if (options.complexity !== undefined)
      this.config.complexity = options.complexity;

    // Update end position
    this.endPos = { x: this.config.width - 2, y: this.config.height - 2 };

    // Regenerate - _initRNG will use this.config.seed if set
    this._initRNG();
    this._initializeMaze();
    this._generateMaze();
    this._optimizeMaze();
    this._createMazeGeometry();

    return Promise.resolve(this);
  }

  generateOpenRoom(width = 50, height = 50) {
    this._clearGeometry();

    this.config.width = width;
    this.config.height = height;

    // Update end position based on new size
    this.endPos = { x: this.config.width - 2, y: this.config.height - 2 };

    // Initialize empty maze (1 = wall, 0 = floor)
    // Create purely empty room with just outer walls
    this.maze = Array(this.config.height)
      .fill()
      .map((_, y) =>
        Array(this.config.width)
          .fill()
          .map((_, x) => {
            // Outer boundary is walls
            if (
              y === 0 ||
              y === this.config.height - 1 ||
              x === 0 ||
              x === this.config.width - 1
            ) {
              return 1;
            }
            // Everything else is open space
            return 0;
          }),
      );

    // Create new geometry
    this._createMazeGeometry();

    return Promise.resolve(this);
  }

  _clearGeometry() {
    // Remove wall meshes
    for (const mesh of this.wallMeshes) {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    }
    this.wallMeshes = [];

    // Remove wall bodies using PhysicsSystem
    for (const body of this.wallBodies) {
      this.physicsSystem.removeBody(body);
    }
    this.wallBodies = [];

    // Remove floor
    if (this.floorMesh) {
      this.scene.remove(this.floorMesh);
      if (this.floorMesh.geometry) this.floorMesh.geometry.dispose();
    }
    if (this.floorBody) {
      this.physicsSystem.removeBody(this.floorBody);
    }

    // Remove markers
    for (const marker of this.markers) {
      this.scene.remove(marker);
      if (marker.geometry) marker.geometry.dispose();
    }
    this.markers = [];
  }
}
