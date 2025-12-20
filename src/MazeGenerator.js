import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class MazeGenerator {
  constructor(world, scene, materials, renderer, options = {}) {
    this.world = world;
    this.scene = scene;
    this.materials = materials;
    this.renderer = renderer; // Need for anisotropy capabilities
    
    this.config = {
      width: options.width || 25,
      height: options.height || 25,
      cellSize: options.cellSize || 4,
      wallHeight: options.wallHeight || 3,
      wallThickness: options.wallThickness || 0.1,
      complexity: options.complexity || 0.75,
      seed: options.seed || null,
    };
    
    this.config.width = this.config.width % 2 === 0 ? this.config.width + 1 : this.config.width;
    this.config.height = this.config.height % 2 === 0 ? this.config.height + 1 : this.config.height;
    
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
    
    this.readyPromise = Promise.all([
      this._loadWallTexture(),
      this._loadFloorTexture()
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
  
  _loadWallTexture() {
    return new Promise((resolve) => {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(
        './assets/wall.png',
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          
          // GRAPHICS UPGRADE: Anisotropic filtering to fix distance glitches
          const maxAnisotropy = (this.renderer && this.renderer.capabilities) ? this.renderer.capabilities.getMaxAnisotropy() : 16;
          texture.anisotropy = maxAnisotropy;
          
          texture.generateMipmaps = true;
          texture.flipY = false;
          texture.repeat.set(1, 1);
          
          this.wallMaterial = new THREE.MeshStandardMaterial({
            map: texture,
            metalness: 0.1, // Reduced for less artificial shine
            roughness: 0.8, // Increased for stone/brick realism
            flatShading: false,
            side: THREE.DoubleSide,
          });
          
          this.wallTexture = texture;
          resolve();
        },
        undefined,
        () => resolve()
      );
    });
  }
  
  _loadFloorTexture() {
    return new Promise((resolve) => {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(
        './assets/ground.png',
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          
          // GRAPHICS UPGRADE
          const maxAnisotropy = (this.renderer && this.renderer.capabilities) ? this.renderer.capabilities.getMaxAnisotropy() : 16;
          texture.anisotropy = maxAnisotropy;
          
          texture.generateMipmaps = true;
          texture.flipY = false;
          
          const floorSize = this.config.width * this.config.cellSize;
          texture.repeat.set(floorSize / 2, floorSize / 2);
          
          this.floorMaterial = new THREE.MeshStandardMaterial({
            map: texture,
            metalness: 0.1,
            roughness: 0.9,
            side: THREE.DoubleSide,
          });
          
          this.floorTexture = texture;
          resolve();
        },
        undefined,
        () => resolve()
      );
    });
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
    this.maze = Array(this.config.height).fill().map(() => 
      Array(this.config.width).fill(1)
    );
    
    this.visited = Array(this.config.height).fill().map(() => 
      Array(this.config.width).fill(false)
    );
    
    for (let y = 1; y < this.config.height - 1; y += 2) {
      for (let x = 1; x < this.config.width - 1; x += 2) {
        this.maze[y][x] = 0;
      }
    }
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
    
    this.maze[0][1] = 0;
    this.maze[this.config.height - 1][this.config.width - 2] = 0;
    
    this._addStrategicOpenings();
  }
  
  _getUnvisitedNeighbors(x, y) {
    const neighbors = [];
    const directions = [
      { dx: 0, dy: -2, name: 'north' },
      { dx: 2, dy: 0, name: 'east' },
      { dx: 0, dy: 2, name: 'south' },
      { dx: -2, dy: 0, name: 'west' },
    ];
    
    for (const dir of directions) {
      const newX = x + dir.dx;
      const newY = y + dir.dy;
      
      if (newX > 0 && newX < this.config.width - 1 &&
          newY > 0 && newY < this.config.height - 1 &&
          !this.visited[newY][newX]) {
        neighbors.push({ x: newX, y: newY, direction: dir.name });
      }
    }
    
    return neighbors;
  }
  
  _chooseNeighbor(neighbors) {
    return neighbors[Math.floor(this._random() * neighbors.length)];
  }
  
  _addStrategicOpenings() {
    const openings = Math.floor((1 - this.config.complexity) * 10);
    
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
      
      if (newX >= 0 && newX < this.config.width &&
          newY >= 0 && newY < this.config.height &&
          this.maze[newY][newX] === 0) {
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
          if (this.maze[y][x] === 0 && 
              this._countAdjacentPaths(x, y) === 1 &&
              !(x === this.startPos.x && y === this.startPos.y) &&
              !(x === this.endPos.x && y === this.endPos.y)) {
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
    this._createBoundaryWalls(); // Invisible walls to prevent escaping
    this._createStartMarker();
    this._createEndMarker();
    this._addAmbientLighting();
  }
  
  _createBoundaryWalls() {
    // Create invisible physics walls around the entire maze perimeter
    const mazeWidth = this.config.width * this.config.cellSize;
    const mazeHeight = this.config.height * this.config.cellSize;
    const wallHeight = this.config.wallHeight * 3; // Extra tall to prevent jumping over
    const wallThickness = 2; // Thick enough to be solid
    
    // North wall (z = 0)
    const northWallShape = new CANNON.Box(new CANNON.Vec3(mazeWidth / 2, wallHeight / 2, wallThickness / 2));
    const northWallBody = new CANNON.Body({ mass: 0, shape: northWallShape, material: this.materials.default });
    northWallBody.position.set(mazeWidth / 2, wallHeight / 2, -wallThickness / 2);
    this.world.addBody(northWallBody);
    this.wallBodies.push(northWallBody);
    
    // South wall (z = mazeHeight)
    const southWallShape = new CANNON.Box(new CANNON.Vec3(mazeWidth / 2, wallHeight / 2, wallThickness / 2));
    const southWallBody = new CANNON.Body({ mass: 0, shape: southWallShape, material: this.materials.default });
    southWallBody.position.set(mazeWidth / 2, wallHeight / 2, mazeHeight + wallThickness / 2);
    this.world.addBody(southWallBody);
    this.wallBodies.push(southWallBody);
    
    // West wall (x = 0)
    const westWallShape = new CANNON.Box(new CANNON.Vec3(wallThickness / 2, wallHeight / 2, mazeHeight / 2));
    const westWallBody = new CANNON.Body({ mass: 0, shape: westWallShape, material: this.materials.default });
    westWallBody.position.set(-wallThickness / 2, wallHeight / 2, mazeHeight / 2);
    this.world.addBody(westWallBody);
    this.wallBodies.push(westWallBody);
    
    // East wall (x = mazeWidth)
    const eastWallShape = new CANNON.Box(new CANNON.Vec3(wallThickness / 2, wallHeight / 2, mazeHeight / 2));
    const eastWallBody = new CANNON.Body({ mass: 0, shape: eastWallShape, material: this.materials.default });
    eastWallBody.position.set(mazeWidth + wallThickness / 2, wallHeight / 2, mazeHeight / 2);
    this.world.addBody(eastWallBody);
    this.wallBodies.push(eastWallBody);
  }
  
  _createFloor() {
    const floorSize = this.config.width * this.config.cellSize;
    const floorGeometry = new THREE.PlaneGeometry(floorSize, floorSize, 10, 10);
    
    const floorMaterial = this.floorMaterial || new THREE.MeshStandardMaterial({
      color: this.colors.floor,
      metalness: 0.1,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    
    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(
      (this.config.width * this.config.cellSize) / 2,
      0,
      (this.config.height * this.config.cellSize) / 2
    );
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    this.floorMesh = floorMesh;
    
    const floorShape = new CANNON.Plane();
    const floorBody = new CANNON.Body({
      mass: 0,
      shape: floorShape,
      material: this.materials.floor,
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floorBody.position.set(
      (this.config.width * this.config.cellSize) / 2,
      0,
      (this.config.height * this.config.cellSize) / 2
    );
    this.world.addBody(floorBody);
    this.floorBody = floorBody;
  }
  
  _createWallsOptimized() {
    const cellSize = this.config.cellSize;
    const wallHeight = this.config.wallHeight;
    const wallThickness = this.config.wallThickness;
    
    const verticalWalls = [];
    const horizontalWalls = [];
    
    for (let y = 0; y < this.config.height; y++) {
      for (let x = 0; x < this.config.width; x++) {
        if (x < this.config.width - 1 && 
            (this.maze[y][x] === 1 || this.maze[y][x + 1] === 1) &&
            !(this.maze[y][x] === 1 && this.maze[y][x + 1] === 1)) {
          verticalWalls.push({ x, y });
        }
        
        if (y < this.config.height - 1 && 
            (this.maze[y][x] === 1 || this.maze[y + 1][x] === 1) &&
            !(this.maze[y][x] === 1 && this.maze[y + 1][x] === 1)) {
          horizontalWalls.push({ x, y });
        }
      }
    }
    
    this._createMergedWalls(verticalWalls, horizontalWalls, cellSize, wallHeight, wallThickness);
  }
  
  _createMergedWalls(verticalWalls, horizontalWalls, cellSize, wallHeight, wallThickness) {
    if (verticalWalls.length > 0) {
      const mergedVerticalGeometry = new THREE.BufferGeometry();
      const verticalPositions = [];
      const verticalNormals = [];
      const verticalUvs = [];
      const verticalIndices = [];
      
      const boxGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, cellSize);
      
      let vertexOffset = 0;
      
      for (const wall of verticalWalls) {
        const position = new THREE.Vector3(
          (wall.x + 1) * cellSize,
          wallHeight / 2,
          wall.y * cellSize + cellSize / 2
        );
        
        const positions = boxGeometry.attributes.position.array;
        const normals = boxGeometry.attributes.normal.array;
        const uvs = boxGeometry.attributes.uv.array;
        const indices = boxGeometry.index.array;
        
        for (let i = 0; i < positions.length; i += 3) {
          verticalPositions.push(
            positions[i] + position.x,
            positions[i + 1] + position.y,
            positions[i + 2] + position.z
          );
        }
        
        for (let i = 0; i < normals.length; i++) verticalNormals.push(normals[i]);
        for (let i = 0; i < uvs.length; i++) verticalUvs.push(uvs[i]);
        for (let i = 0; i < indices.length; i++) verticalIndices.push(indices[i] + vertexOffset);
        
        vertexOffset += positions.length / 3;
      }
      
      mergedVerticalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(verticalPositions, 3));
      mergedVerticalGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(verticalNormals, 3));
      mergedVerticalGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(verticalUvs, 2));
      mergedVerticalGeometry.setIndex(verticalIndices);
      
      const wallMaterial = this.wallMaterial || new THREE.MeshStandardMaterial({
        color: this.colors.wall,
        metalness: 0.2,
        roughness: 0.7,
        flatShading: false,
      });
      
      const verticalWallsMesh = new THREE.Mesh(mergedVerticalGeometry, wallMaterial);
      verticalWallsMesh.castShadow = true;
      verticalWallsMesh.receiveShadow = true;
      this.scene.add(verticalWallsMesh);
      this.wallMeshes.push(verticalWallsMesh);
      
      boxGeometry.dispose();
    }
    
    if (horizontalWalls.length > 0) {
      const mergedHorizontalGeometry = new THREE.BufferGeometry();
      const horizontalPositions = [];
      const horizontalNormals = [];
      const horizontalUvs = [];
      const horizontalIndices = [];
      
      const boxGeometry = new THREE.BoxGeometry(cellSize, wallHeight, wallThickness);
      
      let vertexOffset = 0;
      
      for (const wall of horizontalWalls) {
        const position = new THREE.Vector3(
          wall.x * cellSize + cellSize / 2,
          wallHeight / 2,
          (wall.y + 1) * cellSize
        );
        
        const positions = boxGeometry.attributes.position.array;
        const normals = boxGeometry.attributes.normal.array;
        const uvs = boxGeometry.attributes.uv.array;
        const indices = boxGeometry.index.array;
        
        for (let i = 0; i < positions.length; i += 3) {
          horizontalPositions.push(
            positions[i] + position.x,
            positions[i + 1] + position.y,
            positions[i + 2] + position.z
          );
        }
        
        for (let i = 0; i < normals.length; i++) horizontalNormals.push(normals[i]);
        for (let i = 0; i < uvs.length; i++) horizontalUvs.push(uvs[i]);
        for (let i = 0; i < indices.length; i++) horizontalIndices.push(indices[i] + vertexOffset);
        
        vertexOffset += positions.length / 3;
      }
      
      mergedHorizontalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(horizontalPositions, 3));
      mergedHorizontalGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(horizontalNormals, 3));
      mergedHorizontalGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(horizontalUvs, 2));
      mergedHorizontalGeometry.setIndex(horizontalIndices);
      
      const wallMaterial = this.wallMaterial || new THREE.MeshStandardMaterial({
        color: this.colors.wall,
        metalness: 0.2,
        roughness: 0.7,
        flatShading: false,
      });
      
      const horizontalWallsMesh = new THREE.Mesh(mergedHorizontalGeometry, wallMaterial);
      horizontalWallsMesh.castShadow = true;
      horizontalWallsMesh.receiveShadow = true;
      this.scene.add(horizontalWallsMesh);
      this.wallMeshes.push(horizontalWallsMesh);
      
      boxGeometry.dispose();
    }
    
    this._createOptimizedPhysicsWalls(verticalWalls, horizontalWalls, cellSize, wallHeight, wallThickness);
  }
  
  _createOptimizedPhysicsWalls(verticalWalls, horizontalWalls, cellSize, wallHeight, wallThickness) {
    const groupedVerticalWalls = this._groupAdjacentWalls(verticalWalls, 'vertical');
    const groupedHorizontalWalls = this._groupAdjacentWalls(horizontalWalls, 'horizontal');
    
    for (const group of groupedVerticalWalls) {
      const wallShape = new CANNON.Box(
        new CANNON.Vec3(wallThickness / 2, wallHeight / 2, (group.length * cellSize) / 2)
      );
      const wallBody = new CANNON.Body({
        mass: 0,
        shape: wallShape,
        material: this.materials.default,
      });
      wallBody.position.set(
        (group.x + 1) * cellSize,
        wallHeight / 2,
        group.y * cellSize + (group.length * cellSize) / 2
      );
      this.world.addBody(wallBody);
      this.wallBodies.push(wallBody);
    }
    
    for (const group of groupedHorizontalWalls) {
      const wallShape = new CANNON.Box(
        new CANNON.Vec3((group.length * cellSize) / 2, wallHeight / 2, wallThickness / 2)
      );
      const wallBody = new CANNON.Body({
        mass: 0,
        shape: wallShape,
        material: this.materials.default,
      });
      wallBody.position.set(
        group.x * cellSize + (group.length * cellSize) / 2,
        wallHeight / 2,
        (group.y + 1) * cellSize
      );
      this.world.addBody(wallBody);
      this.wallBodies.push(wallBody);
    }
  }
  
  _groupAdjacentWalls(walls, orientation) {
    if (walls.length === 0) return [];
    
    walls.sort((a, b) => {
      if (orientation === 'vertical') {
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
      
      const isAdjacent = orientation === 'vertical' 
        ? (wall.x === prevWall.x && wall.y === prevWall.y + 1)
        : (wall.y === prevWall.y && wall.x === prevWall.x + 1);
      
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
      this.startPos.y * this.config.cellSize + this.config.cellSize / 2
    );
    startMarker.castShadow = true;
    this.scene.add(startMarker);
    this.markers.push(startMarker);
  }
  
  _createEndMarker() {
    const markerGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 32);
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: this.colors.end,
      metalness: 0.4,
      roughness: 0.3,
      emissive: this.colors.end,
      emissiveIntensity: 0.15,
    });
    
    const endMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    endMarker.position.set(
      this.endPos.x * this.config.cellSize + this.config.cellSize / 2,
      0.1,
      this.endPos.y * this.config.cellSize + this.config.cellSize / 2
    );
    endMarker.castShadow = true;
    this.scene.add(endMarker);
    this.markers.push(endMarker);
  }
  
  _addAmbientLighting() {
    const startLight = new THREE.PointLight(this.colors.start, 0.2, 8);
    startLight.position.set(
      this.startPos.x * this.config.cellSize + this.config.cellSize / 2,
      1,
      this.startPos.y * this.config.cellSize + this.config.cellSize / 2
    );
    startLight.decay = 2;
    this.scene.add(startLight);
    
    const endLight = new THREE.PointLight(this.colors.end, 0.2, 8);
    endLight.position.set(
      this.endPos.x * this.config.cellSize + this.config.cellSize / 2,
      1,
      this.endPos.y * this.config.cellSize + this.config.cellSize / 2
    );
    endLight.decay = 2;
    this.scene.add(endLight);
  }
  
  getWorldPosition(mazeX, mazeY) {
    return {
      x: mazeX * this.config.cellSize + this.config.cellSize / 2,
      y: 1.8,
      z: mazeY * this.config.cellSize + this.config.cellSize / 2
    };
  }
  
  getMazeCoordinates(worldX, worldZ) {
    return {
      x: Math.floor(worldX / this.config.cellSize),
      y: Math.floor(worldZ / this.config.cellSize)
    };
  }
  
  isValidPosition(mazeX, mazeY) {
    if (mazeX < 0 || mazeX >= this.config.width ||
        mazeY < 0 || mazeY >= this.config.height) {
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
      colors: this.colors
    };
  }
  
  getStartPosition() {
    return this.getWorldPosition(this.startPos.x, this.startPos.y);
  }

  getEndPosition() {
    return this.getWorldPosition(this.endPos.x, this.endPos.y);
  }

  getRandomOpenCell() {
    const openCells = [];
    const minDistFromStart = 5; // Minimum cell distance from start position
    
    for (let y = 0; y < this.config.height; y++) {
      for (let x = 0; x < this.config.width; x++) {
        if (this.maze[y][x] === 0) {
          // Calculate distance from start position
          const distFromStart = Math.sqrt(
            Math.pow(x - this.startPos.x, 2) + Math.pow(y - this.startPos.y, 2)
          );
          // Only add cells that are far enough from start
          if (distFromStart >= minDistFromStart) {
            openCells.push({ x, y });
          }
        }
      }
    }

    // Fallback: if no cells far enough, use any open cell except start
    if (openCells.length === 0) {
      for (let y = 0; y < this.config.height; y++) {
        for (let x = 0; x < this.config.width; x++) {
          if (this.maze[y][x] === 0 && !(x === this.startPos.x && y === this.startPos.y)) {
            openCells.push({ x, y });
          }
        }
      }
    }
    
    if (openCells.length === 0) {
      return this.getWorldPosition(this.endPos.x, this.endPos.y);
    }
    
    // FEATURE: Use Math.random() so each player gets different random spots
    // This creates "hallucinations" where players see different things
    const cell = openCells[Math.floor(Math.random() * openCells.length)];
    return this.getWorldPosition(cell.x, cell.y);
  }
  
  // Expose seeded RNG for external use (e.g. selecting trap types)
  random() {
    return this._random();
  }
  
  regenerate(options = {}) {
    // Clear existing geometry
    this._clearGeometry();
    
    // Update config
    if (options.width) this.config.width = options.width % 2 === 0 ? options.width + 1 : options.width;
    if (options.height) this.config.height = options.height % 2 === 0 ? options.height + 1 : options.height;
    if (options.complexity !== undefined) this.config.complexity = options.complexity;
    
    // Update end position
    this.endPos = { x: this.config.width - 2, y: this.config.height - 2 };
    
    // Regenerate
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
    this.maze = Array(this.config.height).fill().map((_, y) => 
      Array(this.config.width).fill().map((_, x) => {
        // Outer boundary is walls
        if (y === 0 || y === this.config.height - 1 || x === 0 || x === this.config.width - 1) {
          return 1;
        }
        // Everything else is open space
        return 0;
      })
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
    
    // Remove wall bodies
    for (const body of this.wallBodies) {
      this.world.removeBody(body);
    }
    this.wallBodies = [];
    
    // Remove floor
    if (this.floorMesh) {
      this.scene.remove(this.floorMesh);
      if (this.floorMesh.geometry) this.floorMesh.geometry.dispose();
    }
    if (this.floorBody) {
      this.world.removeBody(this.floorBody);
    }
    
    // Remove markers
    for (const marker of this.markers) {
      this.scene.remove(marker);
      if (marker.geometry) marker.geometry.dispose();
    }
    this.markers = [];
  }
}
