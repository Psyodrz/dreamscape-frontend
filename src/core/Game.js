import * as THREE from "three";
import { Renderer } from "../systems/Renderer.js";
import { GameScene } from "../world/GameScene.js";
import { Lighting } from "../systems/Lighting.js";
import { PhysicsSystem } from "../systems/PhysicsSystem.js";
import { MazeGenerator } from "../world/MazeGenerator.js";
import { Player } from "../entities/Player.js";
import { Minimap } from "../world/Minimap.js";
import { Ghost } from "../entities/Ghost.js";
// Monster.js removed - functionality merged into Ghost.js with GhostAI
import { TouchControls } from "../ui/TouchControls.js";
import { UpdateManager } from "./UpdateManager.js";
import { getAudioManager } from "../systems/AudioManager.js";
import { PauseMenu } from "../ui/PauseMenu.js";
import { MultiplayerManager } from "../network/MultiplayerManager.js";
import { MultiplayerUI } from "../ui/MultiplayerUI.js";
import { RemotePlayer } from "../entities/RemotePlayer.js";
import { GhostDebugVisualizer } from "../systems/GhostDebugVisualizer.js";
import { SpatialAudioEngine } from "../systems/SpatialAudioEngine.js";
import { getTextureEngine } from "../systems/TextureEngine.js";
import { DustParticleSystem } from "../systems/DustParticleSystem.js";
import { ProceduralSky } from "../systems/ProceduralSky.js";
import { Torch } from "../systems/Torch.js";
import { Flashlight } from "../systems/Flashlight.js";
import { Shard } from "../entities/Shard.js";
import { HorrorPortal } from "../entities/HorrorPortal.js";
import { SpikeTrap } from "../entities/traps/SpikeTrap.js";
import { MudTrap } from "../entities/traps/MudTrap.js";
import { HUD } from "../ui/HUD.js";
import { CaptureSystem } from "../systems/CaptureSystem.js";
import { getDialogueManager } from "../systems/DialogueManager.js";
import { getMazeDebugPanel } from "../ui/MazeDebugPanel.js";

import {
  PerformanceSystem,
  performanceSystem,
} from "../systems/PerformanceSystem.js";

// Global update manager
const updateManager = new UpdateManager();

export class Game {
  constructor() {
    // 1. Core Systems
    this.renderer = new Renderer();
    this.scene = new GameScene(
      this.renderer.sizes.width,
      this.renderer.sizes.height,
      this.renderer.instance,
    );
    this.loopId = null;
    this.isRunning = false;
    this.lighting = new Lighting(
      this.scene.instance,
      this.renderer.isLowEndDevice,
    );

    // Connect Resize Event
    this.renderer.onResize((w, h) => this.scene.resize(w, h));

    // 2. Physics & Logic
    this.clock = new THREE.Clock();
    this.physicsSystem = new PhysicsSystem(this.scene.instance);

    // 3. Game State
    const savedStage = localStorage.getItem("shadowMazeStage");
    this.currentStage = savedStage ? parseInt(savedStage) : 1;
    this.lives = 3;
    this.maxLives = 3;
    this.stageConfig = {
      1: {
        width: 40,
        height: 40,
        ghosts: 2,
        shardsRequired: 3,
        trapCount: 30,
        timeLimit: 300,
      },
      2: {
        width: 60,
        height: 60,
        ghosts: 4,
        shardsRequired: 5,
        trapCount: 50,
        timeLimit: 300,
      },
      3: {
        width: 80,
        height: 80,
        ghosts: 6,
        shardsRequired: 7,
        trapCount: 80,
        timeLimit: null,
      },
    };

    this.shards = [];
    this.shardsCollected = 0;
    this.shardsRequired = 0;

    // Mode flags
    this.sandboxMode = false; // Set to true for sandbox, false for maze
    this.mazeGroup = null; // Reference for toggling visibility

    // 4. Managers
    this.audioManager = getAudioManager();
    this.spatialAudio = new SpatialAudioEngine();
    this.initMultiplayer();

    // Performance System
    this.performanceSystem = performanceSystem;

    // Multiplayer State
    this.remotePlayers = new Map();

    // Expose for debugging
    this.ghosts = [];
    this.ghostDebugVisualizer = null; // Initialized after scene is ready
    window.game = this;

    // Bind debug keys for removal
    this._onKeyDownDebug = this._onKeyDownDebug.bind(this);
    window.addEventListener("keydown", this._onKeyDownDebug);
  }

  _onKeyDownDebug(e) {
    this._setupDebugKeyboard(e);
  }

  _setupDebugKeyboard(e) {
    // M key toggles ghost AI debug visualizer
    if (e.key === "m" || e.key === "M") {
      // ... logic moved down ...
      if (e.key === "m" || e.key === "M") {
        if (this.ghostDebugVisualizer) {
          const enabled = this.ghostDebugVisualizer.toggle();
          console.log(
            `Ghost AI Debug: ${enabled ? "ENABLED" : "DISABLED"} (M to toggle)`,
          );
        }
      }

      // U key toggles spatial audio (for debug testing)
      if (e.key === "u" || e.key === "U") {
        if (this.spatialAudio) {
          const enabled = this.spatialAudio.toggleEnabled();
          console.log(
            `Spatial Audio: ${enabled ? "ENABLED" : "DISABLED"} (U to toggle)`,
          );
        }
      }

      // N key toggles audio debug visualization
      if (e.key === "n" || e.key === "N") {
        if (this.spatialAudio) {
          const enabled = this.spatialAudio.toggleAudioDebug();
          console.log(
            `Audio Debug Visualization: ${
              enabled ? "ENABLED" : "DISABLED"
            } (N to toggle)`,
          );
        }
      }

      // P key toggles dust particles
      if (e.key === "p" || e.key === "P") {
        if (this.dustParticles) {
          const enabled = this.dustParticles.toggle();
          console.log(
            `Dust Particles: ${enabled ? "ENABLED" : "DISABLED"} (P to toggle)`,
          );
        }
      }

      // O key toggles fog system
      if (this.fogSystem) {
        const enabled = this.fogSystem.toggle();
        console.log(
          `Fog System: ${enabled ? "ENABLED" : "DISABLED"} (O to toggle)`,
        );
      }
    }
  }

  initMultiplayer() {
    if (window._multiplayerManager) {
      this.multiplayerManager = window._multiplayerManager;
      this.multiplayerManager.game = this;
      this.multiplayerUI = window._multiplayerUI;
    } else {
      this.multiplayerManager = new MultiplayerManager(this);
      this.multiplayerUI = new MultiplayerUI(this.multiplayerManager);
      this.multiplayerUI.onGameStart = (isMultiplayer) => {
        this.isMultiplayer = isMultiplayer;
        // Start logic...
      };
    }
  }

  async init(playerProfile) {
    if (this.physicsSystem.world) {
      this.dispose();
      // Re-create core systems after dispose if they were nulled out?
      // dispose() doesn't null physicsSystem, just calls its dispose.
      // But if I want true "Restart", I should probably just ensure physics is clean.
      // PhysicsSystem.init() checks internally? No, it throws error if init'd again?
      // Actually RAPIER.init() might throw if called twice.
    }

    this.playerProfile = playerProfile;

    // Initialize Physics
    await this.physicsSystem.init();

    // TextureEngine (initialize before level creation)
    this.textureEngine = getTextureEngine();
    this.textureEngine.init(this.renderer.instance);

    // Audio - await for Web Audio API buffers to load
    await this.audioManager.init();
    await this.spatialAudio.init(this.scene.camera, this.scene.instance);

    // Start Logic
    await this._createLevel();
    this.start();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Warm-up frame: Render once to upload textures to GPU and compile shaders
    // This prevents the first visible frame from having a stutter
    this._renderWarmupFrame();
  }

  /**
   * Render a single warm-up frame to trigger GPU uploads and shader compilation
   * before starting the actual game loop
   */
  _renderWarmupFrame() {
    // Render one frame to trigger texture uploads and shader compilation
    this.renderer.render(this.scene.instance, this.scene.camera);

    // Start the actual game loop after the warm-up frame
    requestAnimationFrame((time) => {
      this._startLoop(time);
    });
  }

  stop() {
    this.isRunning = false;
    if (this.loopId) {
      cancelAnimationFrame(this.loopId);
      this.loopId = null;
    }
  }

  dispose() {
    this.stop();

    // Dispose systems
    if (this.physicsSystem) this.physicsSystem.dispose();
    if (this.renderer) {
      if (this.renderer.dispose) this.renderer.dispose();
      else console.warn("Renderer missing dispose!");
    }
    if (this.scene) this.scene.dispose(); // Assuming GameScene has dispose

    // Clean up event listeners
    window.removeEventListener("keydown", this._onKeyDownDebug);
    if (this.audioManager) this.audioManager.stopMusic();
    if (this.spatialAudio) this.spatialAudio.dispose();
    if (this.controls) this.controls.dispose(); // If controls exist
    if (this.player) this.player.dispose();
    for (const ghost of this.ghosts) {
      if (ghost.dispose) ghost.dispose();
    }

    // Cleanup global ref
    if (window.game === this) window.game = null;

    if (this.hud) this.hud.dispose();
    this.shards.forEach((s) => s.dispose());
    this.shards = [];

    if (this.exitMarker) {
      this.exitMarker.dispose();
      this.exitMarker = null;
    }

    if (this.fogSystem) {
      this.fogSystem.dispose();
      this.fogSystem = null;
    }
  }

  async _createLevel() {
    const config = this.stageConfig[this.currentStage];

    // Destroy old maze if exists
    if (this.mazeGenerator) {
      this.mazeGenerator._clearGeometry();
    }
    if (this.mazeGroup) {
      this.scene.remove(this.mazeGroup);
      this.mazeGroup = null;
    }

    if (this.sandboxMode) {
      // --- SANDBOX MODE: Simple Ground ---
      await this._createSandboxLevel();
    } else {
      // --- MAZE MODE: Full maze generation ---
      await this._createMazeLevel(config);
    }

    // Player
    this._initPlayer();

    // Position player at valid Maze Start if available
    // (Fixes issue where default 2,1,2 is inside the (0,0) wall block)
    if (!this.sandboxMode && this.mazeGenerator && this.player) {
      const startPos = this.mazeGenerator.getStartPosition();
      console.log(
        `[Game] Moving player to maze start: ${startPos.x}, ${startPos.y}, ${startPos.z}`,
      );

      this.player.mesh.position.set(startPos.x, startPos.y, startPos.z);
      if (this.player.body) {
        this.player.body.setTranslation(startPos, true);
      }
      this.player.bodyPosition = startPos;
    }

    // Minimap (only for maze mode)
    if (!this.sandboxMode && this.mazeGenerator) {
      this.minimap = new Minimap(
        this.scene.instance,
        this.scene.camera,
        this.mazeGenerator.getMazeData(),
      );
    }

    // UI
    // UI
    this.pauseMenu = new PauseMenu(this);
    this.pauseMenu.setMultiplayerMode(this.isMultiplayer);
    this.touchControls = new TouchControls();

    // HUD
    if (!this.hud) this.hud = new HUD();
    this.shardsRequired = config.shardsRequired || 3;
    this.shardsCollected = 0;
    this.hud.updateShards(this.shardsCollected, this.shardsRequired);
    this.hud.updateStage(this.currentStage);
    this.hud.showPersistentMessage(
      "Collect all memory shards to open the portal.",
    );

    // Spawn Shards (The Ritual)
    this._spawnShards(this.shardsRequired);

    // Spawn Traps (Synergizes with Ghost AI)
    this._spawnTraps(config.trapCount || 5);

    // Update HUD with monster/trap counts
    this.hud.updateMonsters(config.ghosts || 2);
    this.hud.updateTraps(config.trapCount || 5);

    // Update HUD with lives and health
    this.hud.updateLives(this.lives, this.maxLives);
    if (this.player) {
      this.hud.updateHealth(this.player.health, this.player.maxHealth);
    }

    // Initialize DialogueManager
    this.dialogueManager = getDialogueManager();
    this.dialogueManager.setHUD(this.hud);
    window.dialogueManager = this.dialogueManager;

    // Show level start message with tutorial sequence
    this._startTutorialSequence();

    // Initialize Capture System (death sequence handler)
    if (!this.captureSystem) {
      this.captureSystem = new CaptureSystem(
        this.player,
        this.scene.camera,
        this.hud,
      );

      // Listen for capture events from Player
      window.addEventListener("playerCaptured", (e) => {
        if (this.captureSystem && e.detail.ghost) {
          this.captureSystem.startCapture(e.detail.ghost);
        }
      });

      // Listen for death complete to show retry menu
      window.addEventListener("playerDeath", () => {
        this._onPlayerDeath();
      });
    } else {
      // Update references for new level
      this.captureSystem.player = this.player;
      this.captureSystem.camera = this.scene.camera;
      this.captureSystem.reset();
    }

    // Spawn Horror Portal at maze end
    if (!this.sandboxMode && this.mazeGenerator) {
      const endPos = this.mazeGenerator.getEndPosition();
      const mazeData = this.mazeGenerator.getMazeData();
      this.exitMarker = new HorrorPortal(this.scene.instance, endPos, {
        physicsSystem: this.physicsSystem,
        portalHeight: 3.0, // Match maze wall height
        cellSize: mazeData.cellSize,
        mazeHeight: mazeData.height,
      });

      // Update Maze Debug Panel (toggle with B key)
      const mazeDebug = getMazeDebugPanel();
      mazeDebug.update(this.mazeGenerator);
      console.log("[Game] Maze Debug Panel ready - press B to toggle");
    }

    // Debug Mode Toggle (K key)
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyK") {
        // Setup debug mesh first if not created
        if (!this.physicsSystem.debugMesh) {
          this.physicsSystem.setupDebug(this.scene.instance);
        }
        // Use proper toggle which handles visibility
        this.physicsSystem.toggleDebug();
      }
      // Minimap toggle (M key)
      if (e.code === "KeyM" && this.minimap) {
        this.minimap.toggleVisibility();
      }
      // Player Light toggle (F key)
      if (e.code === "KeyF" && this.playerLight) {
        this.playerLight.toggle();
      }
      // Inspector toggle (I key)
      if (e.code === "KeyI" && e.altKey) {
        if (!this.inspector) {
          import("../ui/LegacyInspector.js").then(({ LegacyInspector }) => {
            this.inspector = new LegacyInspector(
              this.renderer.instance,
              this.scene.instance,
              this.scene.camera,
            );
          });
        }
      }
    });

    // Audio - defer to after first render frames to prevent startup stutter
    // Use requestAnimationFrame to wait for stable rendering before starting audio
    this.audioManager.playGameStart();

    // Defer music start until after initial rendering is stable (after a few frames)
    let frameCount = 0;
    const deferMusicStart = () => {
      frameCount++;
      if (frameCount < 30) {
        // Wait ~30 frames (~500ms at 60fps) for stable rendering
        requestAnimationFrame(deferMusicStart);
      } else {
        // Safe to start audio now
        this.audioManager.startMusic();
        if (this.spatialAudio && this.spatialAudio.initialized) {
          this.spatialAudio.startAmbientMusic();
        }
      }
    };
    requestAnimationFrame(deferMusicStart);

    // Ghosts - spawn based on stage config for proper difficulty curve
    this.ghosts = [];
    const monsterCount = config.ghosts || 2;
    for (let i = 0; i < monsterCount; i++) {
      this._spawnGhostWithAI(i);
    }
    console.log(
      `Stage ${this.currentStage}: Spawned ${monsterCount} ghosts, ${
        config.trapCount || 5
      } traps`,
    );

    // Initialize ghost debug visualizer (press V to toggle)
    this.ghostDebugVisualizer = new GhostDebugVisualizer(this.scene.instance);
    console.log("Ghost AI Debug Visualizer ready - press V to toggle");

    // Initialize dust particles scattered across entire maze
    // Maze is typically width*cellSize x height*cellSize (e.g., 15*4=60 units)
    const mazeData = this.mazeGenerator
      ? this.mazeGenerator.getMazeData()
      : null;
    const mapSize = mazeData ? mazeData.width * (mazeData.cellSize || 4) : 80;

    this.dustParticles = new DustParticleSystem(this.scene.instance, {
      particleCount: 6000, // Dense coverage
      mapWidth: mapSize, // Cover entire maze width
      mapHeight: mapSize, // Cover entire maze depth
      minHeight: 0.5, // Just above floor
      maxHeight: 3.5, // Below ceiling
      particleSize: 0.08, // Small particles
    });
    console.log(
      `Dust particles scattered across ${mapSize}x${mapSize} map - press P to toggle`,
    );

    // Initialize procedural midnight sky
    this.proceduralSky = new ProceduralSky(this.scene.instance, {
      // Midnight Ocean preset - horror atmosphere
      skyTop: new THREE.Color(0.0, 0.005, 0.02),
      skyBottom: new THREE.Color(0.001, 0.002, 0.005),
      cloudColor1: new THREE.Color(0.02, 0.02, 0.05),
      cloudColor2: new THREE.Color(0.05, 0.08, 0.15),
      cloudScale: 3.0,
      cloudDensity: 0.6,
      starDensity: 1.0,
      moonVisible: true,
      moonColor: new THREE.Color(1.5, 1.5, 1.5), // HDR bright moon
      moonSize: 0.05,
    });
    console.log("Procedural midnight sky initialized");
  }

  async _createSandboxLevel() {
    console.log("Game: Creating sandbox level...");
    const groundSize = 200;

    // Ground
    const groundGeo = new THREE.BoxGeometry(groundSize, 1, groundSize);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.2,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.set(0, -0.5, 0);
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // Physics Ground
    this.physicsSystem.createStaticBox(
      { x: 0, y: -0.5, z: 0 },
      { x: groundSize / 2, y: 0.5, z: groundSize / 2 },
    );

    // Boundary Walls
    const wallHeight = 5;
    const wallThickness = 1;
    const wallOffset = groundSize / 2 + wallThickness / 2;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
    });

    const walls = [
      {
        pos: [0, wallHeight / 2, -wallOffset],
        dim: [groundSize, wallHeight, wallThickness],
      },
      {
        pos: [0, wallHeight / 2, wallOffset],
        dim: [groundSize, wallHeight, wallThickness],
      },
      {
        pos: [-wallOffset, wallHeight / 2, 0],
        dim: [wallThickness, wallHeight, groundSize],
      },
      {
        pos: [wallOffset, wallHeight / 2, 0],
        dim: [wallThickness, wallHeight, groundSize],
      },
    ];

    walls.forEach((w) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...w.dim), wallMat);
      mesh.position.set(...w.pos);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);

      this.physicsSystem.createStaticBox(
        { x: w.pos[0], y: w.pos[1], z: w.pos[2] },
        { x: w.dim[0] / 2, y: w.dim[1] / 2, z: w.dim[2] / 2 },
      );
    });
  }

  async _createMazeLevel(config) {
    console.log("Game: Creating maze level...", config);

    // Create maze generator
    this.mazeGenerator = new MazeGenerator(
      this.physicsSystem,
      this.scene.instance,
      this.renderer.instance,
      {
        width: config.width,
        height: config.height,
        cellSize: 4,
        wallHeight: 4,
        seed: Date.now(), // Random seed each time
      },
    );

    // Wait for maze to be ready (textures loaded)
    await this.mazeGenerator.ready();

    // Store reference to maze meshes for visibility toggle
    // The MazeGenerator adds meshes directly to scene, we'll track via mazeGenerator
    console.log("Game: Maze generated successfully!");
  }

  // Toggle maze visibility (for debug mode)
  setMazeVisible(visible) {
    if (this.mazeGenerator) {
      // Wall meshes
      if (this.mazeGenerator.wallMeshes) {
        this.mazeGenerator.wallMeshes.forEach((mesh) => {
          mesh.visible = visible;
        });
      }
      // Boundary wall meshes
      if (this.mazeGenerator.boundaryWalls) {
        this.mazeGenerator.boundaryWalls.forEach((mesh) => {
          mesh.visible = visible;
        });
      }
      // Floor mesh
      if (this.mazeGenerator.floorMesh) {
        this.mazeGenerator.floorMesh.visible = visible;
      }
      // Markers (start/end)
      if (this.mazeGenerator.markers) {
        this.mazeGenerator.markers.forEach((marker) => {
          marker.visible = visible;
        });
      }
      this.mazeVisible = visible;
      console.log("Maze visibility:", visible);
    } else {
      console.log("No maze generator to toggle visibility");
    }
  }

  _spawnGhostWithAI(index = 0) {
    // Get spawn position based on mode - distribute monsters across maze
    let spawnPos = { x: 40, y: 0, z: 40 };

    if (this.mazeGenerator) {
      const mazeData = this.mazeGenerator.getMazeData();
      const cellSize = mazeData.cellSize || 4;
      const mazeWidth = mazeData.width * cellSize;
      const mazeHeight = mazeData.height * cellSize;
      const playerStart = this.mazeGenerator.getStartPosition();
      const minDistFromPlayer = 30; // Minimum distance from player spawn

      // Try to get a random open cell that's far enough from player
      let attempts = 0;
      const maxAttempts = 50;

      while (attempts < maxAttempts) {
        const randomCell = this.mazeGenerator.getRandomOpenCell();
        if (randomCell) {
          const distFromPlayer = Math.sqrt(
            (randomCell.x - playerStart.x) ** 2 +
              (randomCell.z - playerStart.z) ** 2,
          );

          // Also check distance from other already-spawned ghosts
          let tooCloseToOther = false;
          for (const existingGhost of this.ghosts) {
            const distFromOther = Math.sqrt(
              (randomCell.x - existingGhost.bodyPosition.x) ** 2 +
                (randomCell.z - existingGhost.bodyPosition.z) ** 2,
            );
            if (distFromOther < 20) {
              // Min distance between monsters
              tooCloseToOther = true;
              break;
            }
          }

          if (distFromPlayer >= minDistFromPlayer && !tooCloseToOther) {
            spawnPos = { x: randomCell.x, y: 0, z: randomCell.z };
            break;
          }
        }
        attempts++;
      }

      // Fallback: if couldn't find good spot, use quadrant-based positioning
      if (attempts >= maxAttempts) {
        const quadrantOffsets = [
          { x: 0.7, z: 0.7 }, // Far corner
          { x: 0.3, z: 0.7 }, // Top left area
          { x: 0.7, z: 0.3 }, // Bottom right area
          { x: 0.5, z: 0.8 }, // Middle top
          { x: 0.8, z: 0.5 }, // Right middle
        ];
        const offset = quadrantOffsets[index % quadrantOffsets.length];
        spawnPos = {
          x: mazeWidth * offset.x,
          y: 0,
          z: mazeHeight * offset.z,
        };
      }
    }

    const ghost = new Ghost(
      this.scene.instance,
      this.physicsSystem,
      this.player,
      this.mazeGenerator,
      this.spatialAudio,
    );

    // Set spawn position
    if (ghost.body) {
      ghost.body.setTranslation({ x: spawnPos.x, y: 2, z: spawnPos.z }, true);
    }
    ghost.bodyPosition.set(spawnPos.x, 2, spawnPos.z);
    ghost.mesh.position.set(spawnPos.x, 2, spawnPos.z);

    // Initialize AI with maze data if available
    if (this.mazeGenerator) {
      const mazeData = this.mazeGenerator.getMazeData();
      ghost.initAI(mazeData, {
        patrolSpeed: 2.5 + index * 0.2, // Slight speed variation
        chaseSpeed: 5.5 + index * 0.3,
        enragedSpeed: 7.5,
        visionRange: 10,
        hearingRange: 6,
      });
    }

    this.ghosts.push(ghost);
    console.log(
      `Ghost #${index + 1} spawned at (${spawnPos.x.toFixed(
        1,
      )}, ${spawnPos.z.toFixed(1)})`,
    );
  }

  // Legacy method kept for compatibility - now uses unified Ghost
  _spawnMonster() {
    this._spawnGhostWithAI();
  }

  _spawnSandboxGhost() {
    // Create a ghost for sandbox testing without maze dependency
    const g = new Ghost(
      this.scene.instance,
      this.physicsSystem,
      this.player,
      null, // No maze generator in sandbox
    );

    // Spawn at a fixed position away from player start
    const spawnPos = { x: 20, y: 2, z: 20 };
    if (g.body) {
      g.body.setTranslation(spawnPos, true);
    }
    g.mesh.position.set(spawnPos.x, spawnPos.y, spawnPos.z);

    // Make ghost a bit slower for testing
    g.chaseSpeed = 5.0;
    g.wanderSpeed = 3.0;

    this.ghosts.push(g);
    console.log("Sandbox Ghost spawned at", spawnPos);
  }

  _initPlayer() {
    // Get start position based on mode
    let startPos;
    if (this.mazeGenerator) {
      // Maze mode: spawn at green start marker
      startPos = this.mazeGenerator.getStartPosition();
    } else {
      // Sandbox mode: spawn at origin
      startPos = { x: 0, y: 2, z: 0 };
    }

    this.player = new Player(
      this.physicsSystem,
      this.scene.instance,
      this.scene.camera,
      {
        radius: 0.35,
        height: 2.0,
        speed: 6.0, // Walk speed
        sprintMultiplier: 1.33, // Run speed = 6 * 1.33 ≈ 8
        jumpHeight: 2.0,
      },
    );
    this.player.touchControls = this.touchControls;

    // Connect touch controls if available
    if (this.touchControls) {
      this.player.setUseTouchControls(true);
    }

    this.player.setProfile(this.playerProfile);

    // Reset position to start
    this.player.resetToStart(
      new THREE.Vector3(startPos.x, startPos.y, startPos.z),
    );

    // Initialize Player Light (Flashlight by default, can switch to Torch)
    // Dispose old one if exists
    if (this.playerLight) {
      this.playerLight.dispose();
    }

    // Default to Flashlight mode
    this.lightMode = "flashlight"; // "flashlight" or "torch"
    this.flashlight = new Flashlight(this.scene.camera, {
      intensity: 10,
      color: 0xffeedd,
      distance: 80,
      penumbra: 0,
      castShadow: !this.renderer.isLowEndDevice,
      onToggle: (isOn) => {
        if (this.audioManager) {
          this.audioManager.playButtonClick();
        }
      },
    });
    this.playerLight = this.flashlight; // Active light

    // Also create torch (hidden initially) for quick switching
    this.torch = new Torch(this.scene.camera, {
      lightBaseIntensity: 80,
      lightDistance: 20,
      castShadow: !this.renderer.isLowEndDevice,
      onToggle: (isOn) => {
        if (this.audioManager) {
          this.audioManager.playButtonClick();
        }
      },
    });
    this.torch.setEnabled(false); // Hide torch initially

    // Hook to Lighting System
    // Expose for console: window.game.switchLightMode("torch") or window.game.switchLightMode("flashlight")
    if (typeof window !== "undefined") {
      window.torch = this.torch;
      window.game = this;
      console.log(
        "[Game] Light mode: flashlight (default). Switch with: window.game.switchLightMode('torch')",
      );
    }
  }

  /**
   * Switch between Flashlight and Torch modes
   * @param {string} mode - "flashlight" or "torch"
   */
  switchLightMode(mode) {
    if (mode === this.lightMode) return;

    const wasOn = this.playerLight?.isOn ?? true;

    // Disable current light
    if (this.playerLight) {
      this.playerLight.setEnabled(false);
    }

    // Switch mode
    this.lightMode = mode;

    if (mode === "torch") {
      this.playerLight = this.torch;
      this.torch.setEnabled(wasOn);
      console.log("[Game] Switched to TORCH mode 🔥");
    } else {
      // Recreate flashlight if needed
      if (!this.flashlight || this.flashlight.disposed) {
        this.flashlight = new Flashlight(this.scene.camera, {
          intensity: 10,
          color: 0xffeedd,
          distance: 80,
          penumbra: 0,
          castShadow: !this.isMobile,
          onToggle: (isOn) => {
            if (this.audioManager) {
              this.audioManager.playButtonClick();
            }
          },
        });
      }
      this.playerLight = this.flashlight;
      this.flashlight.setEnabled(wasOn);
      this.torch.setEnabled(false);
      console.log("[Game] Switched to FLASHLIGHT mode 🔦");
    }
  }

  _addLamps() {
    // Reuse the logic from the previous main.js or implement scanning
    // For brevity, let's assume we can scan the maze data from MazeGenerator
    // This is "Game" logic so it's fine here.

    const mazeData = this.mazeGenerator.getMazeData();
    const maze = mazeData.maze;
    const cellSize = mazeData.cellSize;
    const wallPositions = [];

    // Scan maze (Simplified version of logic in main.js)
    for (let y = 1; y < mazeData.height - 1; y++) {
      for (let x = 1; x < mazeData.width - 1; x++) {
        if (maze[y][x] === 1) {
          const wallCenterX = x * cellSize + cellSize / 2;
          const wallCenterZ = y * cellSize + cellSize / 2;
          const wallThickness = 0.3; // Approx

          if (maze[y - 1] && maze[y - 1][x] === 0)
            wallPositions.push({
              x: wallCenterX,
              y: 2,
              z: y * cellSize + wallThickness,
              rotY: Math.PI,
            });
          if (maze[y + 1] && maze[y + 1][x] === 0)
            wallPositions.push({
              x: wallCenterX,
              y: 2,
              z: (y + 1) * cellSize - wallThickness,
              rotY: 0,
            });
          if (maze[y][x - 1] === 0)
            wallPositions.push({
              x: x * cellSize + wallThickness,
              y: 2,
              z: wallCenterZ,
              rotY: -Math.PI / 2,
            });
          if (maze[y][x + 1] === 0)
            wallPositions.push({
              x: (x + 1) * cellSize - wallThickness,
              y: 2,
              z: wallCenterZ,
              rotY: Math.PI / 2,
            });
        }
      }
    }

    // Randomize and Limit
    const shuffled = wallPositions.sort(() => Math.random() - 0.5);
    const limit = this.renderer.isLowEndDevice ? 5 : 10;
    this.lighting.addLamps(shuffled.slice(0, limit));
  }

  _spawnGhosts(count) {
    this.ghosts = [];
    for (let i = 0; i < count; i++) {
      const g = new Ghost(
        this.scene.instance,
        this.physicsSystem,
        this.player,
        this.mazeGenerator,
      );
      g.chaseSpeed = 2.5 + this.currentStage;

      const spawnPos = this.mazeGenerator.getRandomOpenCell();
      if (spawnPos && g.body) {
        g.body.setTranslation({ x: spawnPos.x, y: 2, z: spawnPos.z }, true);
        g.mesh.position.set(spawnPos.x, 2, spawnPos.z);
      }
      this.ghosts.push(g);
    }
  }

  _spawnTraps(count) {
    // Clear existing traps
    if (this.traps) {
      this.traps.forEach((t) => t.dispose());
    }
    this.traps = [];

    if (!this.mazeGenerator) return;

    const trapPositions = this.mazeGenerator.getMultipleRandomOpenCells(count);

    console.log(`Spawning ${trapPositions.length} traps...`);

    trapPositions.forEach((pos) => {
      // Randomly choose trap type
      const isSpike = Math.random() > 0.5;
      const position = new THREE.Vector3(pos.x, 0, pos.z);

      let trap;
      if (isSpike) {
        trap = new SpikeTrap(
          this.scene.instance,
          this.physicsSystem,
          this.player,
          position,
        );
      } else {
        trap = new MudTrap(
          this.scene.instance,
          this.physicsSystem,
          this.player,
          position,
        );
      }

      this.traps.push(trap);
    });
  }

  _spawnShards(count) {
    this.shards.forEach((s) => s.dispose());
    this.shards = [];

    // Maze not ready?
    if (!this.mazeGenerator) return;

    // Spawn Traps (alongside shards for now, arbitrary count)
    this._spawnTraps(10 + this.currentStage * 5);

    const shardPositions = this.mazeGenerator.getMultipleRandomOpenCells(count);

    shardPositions.forEach((cell) => {
      const shard = new Shard(
        this.scene.instance,
        new THREE.Vector3(cell.x, 1.5, cell.z),
      );
      this.shards.push(shard);
    });
    console.log(`Spawned ${this.shards.length} shards.`);
  }

  _startLoop() {
    const animate = () => {
      if (!this.isRunning) return;

      this.loopId = requestAnimationFrame(animate);

      const deltaTime = this.clock.getDelta();
      const elapsedTime = this.clock.getElapsedTime();

      // Physics
      this.physicsSystem.step();
      this.physicsSystem.updateDebug();

      // Update Performance System (Throttling)
      if (this.performanceSystem) {
        this.performanceSystem.update(deltaTime, {
          ghosts: this.ghosts,
          player: this.player,
          camera: this.scene.camera,
        });
      }

      // Scene Update (Sky, etc)
      if (this.scene) this.scene.update(deltaTime);

      // Traps Update
      if (this.traps) {
        this.traps.forEach((t) => t.update(deltaTime, elapsedTime * 1000));
      }

      // Heartbeat System
      if (this.ghosts.length > 0 && this.player && this.player.body) {
        let minDistance = Infinity;
        const pPos = this.player.body.translation();

        for (const ghost of this.ghosts) {
          if (ghost.body) {
            const gPos = ghost.body.translation();
            const dist = Math.sqrt(
              (pPos.x - gPos.x) ** 2 + (pPos.z - gPos.z) ** 2,
            );
            if (dist < minDistance) minDistance = dist;
          }
        }

        if (minDistance < 20) {
          if (!this.audioManager.heartbeatPlaying)
            this.audioManager.startHeartbeat();
          this.audioManager.updateHeartbeatIntensity(minDistance);
        } else {
          if (this.audioManager.heartbeatPlaying)
            this.audioManager.stopHeartbeat();
        }
      }

      // Player
      if (this.player) {
        this.player.update(deltaTime);

        // Update Capture System (death sequence)
        if (this.captureSystem) {
          this.captureSystem.update(deltaTime);
        }

        // Update HUD health bar in real-time
        if (this.hud && this.player) {
          this.hud.updateHealth(this.player.health, this.player.maxHealth);

          // Death check - vitality depleted
          if (
            this.player.health <= 0 &&
            !this.player.isDead &&
            !this.captureSystem?.isActive
          ) {
            console.log("[Game] Health depleted - triggering death");
            this.player.isDead = true;
            this.player.controlsDisabled = true;

            // Use simple fade death (no ghost capture sequence)
            this._fadeToBlack(800, () => {
              this._onPlayerDeath();
            });
          }

          // Low health warning (DialogueManager handles cooldown)
          if (
            this.player.health <= 25 &&
            this.player.health > 0 &&
            this.dialogueManager
          ) {
            this.dialogueManager.show("lowHealth");
          }
        }

        // Ghost proximity warnings
        if (this.dialogueManager && this.ghosts && this.player) {
          const pPos = this.player.bodyPosition;
          let minDist = Infinity;

          for (const ghost of this.ghosts) {
            const gPos = ghost.bodyPosition;
            const dist = Math.sqrt(
              (pPos.x - gPos.x) ** 2 + (pPos.z - gPos.z) ** 2,
            );
            if (dist < minDist) minDist = dist;
          }

          // Warning based on distance (DialogueManager handles cooldown)
          if (minDist < 6) {
            this.dialogueManager.show("ghostVeryClose", true);
          } else if (minDist < 12) {
            this.dialogueManager.show("ghostNear");
          }
        }

        // Update player light (flashlight or torch)
        if (this.playerLight) {
          const isMoving =
            this.player.currentAnimState === "walk" ||
            this.player.currentAnimState === "run";
          const isSprinting = this.player.currentAnimState === "run";

          // Find nearest ghost for flickering effect
          let nearestGhostDist = Infinity;
          if (this.ghosts) {
            const pPos = this.player.bodyPosition;
            for (const ghost of this.ghosts) {
              const gPos = ghost.bodyPosition;
              const dist = Math.sqrt(
                (pPos.x - gPos.x) ** 2 + (pPos.z - gPos.z) ** 2,
              );
              if (dist < nearestGhostDist) nearestGhostDist = dist;
            }
          }

          // Update light with player movement
          this.playerLight.update(
            deltaTime,
            isMoving,
            isSprinting,
            this.player.velocity,
          );
        }

        // Sync Light with Lighting System
        this.lighting.setFlashlightState(this.playerLight?.isOn || false);
      }

      // Lighting Effects (Follow Player)
      const pPos = this.player ? this.player.getPosition() : null;
      this.lighting.update(elapsedTime, pPos);

      // Ghosts (unified entity with AI)
      this.ghosts.forEach((g) => g.update(deltaTime));

      // Update ghost debug visualizer
      if (this.ghostDebugVisualizer && this.ghosts.length > 0) {
        this.ghostDebugVisualizer.update(this.ghosts[0], this.player);
      }

      // Update 3D Spatial Audio
      if (this.spatialAudio && this.player) {
        const playerPos = this.player.getPosition();
        const ghostPos =
          this.ghosts.length > 0 ? this.ghosts[0].bodyPosition : null;
        this.spatialAudio.update(deltaTime, playerPos, ghostPos);
      }

      // Update dust particles (fixed in world space)
      if (this.dustParticles) {
        this.dustParticles.update(deltaTime);
      }

      // Update procedural sky (animated stars/clouds)
      if (this.proceduralSky) {
        this.proceduralSky.update(deltaTime);
      }

      // Multiplayer Remote Players
      this._updateRemotePlayers(deltaTime);

      // Minimap
      if (this.minimap && this.player) {
        const pPos = this.player.getPosition();
        // Add PI to fix 180 degree inversion (Backwards view)
        const pRot = this.player.getRotation() + Math.PI;

        const ghostPositions = this.ghosts.map((g) => {
          const pos = g.bodyPosition || g.mesh?.position;
          return pos ? { x: pos.x, z: pos.z } : { x: 0, z: 0 };
        });

        const shardPositions = this.shards
          .filter((s) => !s.isCollected)
          .map((s) => s.position);

        const exitPos = this.exitMarker ? this.exitMarker.position : null;

        const trapPositions = (this.traps || []).map((t) => ({
          x: t.position.x,
          z: t.position.z,
          type: t.constructor.name, // "SpikeTrap" or "MudTrap"
        }));

        this.minimap.update({
          playerPos: pPos,
          playerRot: pRot,
          ghosts: ghostPositions,
          shards: shardPositions,
          exitPos: exitPos,
          isLightOn: this.playerLight?.isOn || false,
          traps: trapPositions,
        });
      }

      // Update Shards
      this.shards.forEach((s) => s.update(deltaTime));
      this._checkShardCollection();

      // Update Exit Marker
      if (this.exitMarker) {
        this.exitMarker.update(deltaTime);
      }

      // Check Win Condition
      this._checkWinCondition();

      // Render
      this.renderer.render(this.scene.instance, this.scene.camera);
    };

    this.clock.start();
    animate();
  }

  _checkShardCollection() {
    if (!this.player) return;

    const pPos = this.player.getPosition();
    const pickupRadius = 1.5;

    for (const shard of this.shards) {
      if (shard.isCollected) continue;

      const dist = Math.sqrt(
        (pPos.x - shard.position.x) ** 2 + (pPos.z - shard.position.z) ** 2,
      );
      if (dist < pickupRadius) {
        shard.isCollected = true;
        shard.dispose(); // Remove visual
        this.shardsCollected++;
        this.hud.updateShards(this.shardsCollected, this.shardsRequired);

        if (this.audioManager) {
          // Play pickup sound (using button click as placeholder or specific sound if available)
          this.audioManager.playButtonClick();
        }

        // Shard collection dialogue
        if (this.dialogueManager) {
          this.dialogueManager.show("shardCollect");
        }

        if (this.shardsCollected === this.shardsRequired) {
          if (this.dialogueManager) {
            this.dialogueManager.show("portalOpen", true);
          }
          if (this.audioManager) {
            // Play unlock sound
          }
        } else {
          // Ghost escalation - each shard makes ghosts faster and more aggressive
          const escalationPercent = Math.floor(
            (this.shardsCollected / this.shardsRequired) * 100,
          );
          this.ghosts.forEach((ghost) => {
            if (ghost.ai) {
              // Increase speed by 15% per shard collected
              const speedMultiplier = 1 + this.shardsCollected * 0.15;
              ghost.ai.config.runSpeed =
                ghost.ai.config.baseRunSpeed * speedMultiplier;
              ghost.ai.config.walkSpeed =
                ghost.ai.config.baseWalkSpeed * speedMultiplier;
            }
          });

          if (escalationPercent >= 50) {
            this.hud.showMessage(
              `Shard ${this.shardsCollected}/${this.shardsRequired} - GHOSTS ENRAGED!`,
              2500,
            );
          } else {
            this.hud.showMessage("Shard Collected!", 2000);
          }
        }
      }
    }
  }

  _checkWinCondition() {
    if (!this.exitMarker || !this.player) return;

    // Use portal's core position for accurate detection
    const portalPos = this.exitMarker.getCorePosition();
    const playerPos = this.player.getPosition();
    const detectionRadius = this.exitMarker.getDetectionRadius();

    // Calculate distance to portal core (ignore Y)
    const distSq =
      (playerPos.x - portalPos.x) ** 2 + (playerPos.z - portalPos.z) ** 2;

    // Use portal's detection radius (squared) - player must be very close to core
    const thresholdSq = detectionRadius * detectionRadius;

    if (distSq < thresholdSq) {
      console.log(
        `[WIN CHECK] Touching portal core! Shards: ${this.shardsCollected}/${this.shardsRequired}`,
      );

      if (this.shardsCollected >= this.shardsRequired) {
        console.log("[WIN CHECK] Conditions met! Completing level...");
        this._completeLevel();
      } else {
        // Notify user they need more shards (debounce with HUD message)
        if (!this._exitLockedMessageShown) {
          this.hud.showMessage("LOCKED! COLLECT ALL SHARDS FIRST!", 3000);
          this._exitLockedMessageShown = true;
          setTimeout(() => (this._exitLockedMessageShown = false), 3000);
        }
      }
    }
  }

  _completeLevel() {
    if (this.levelComplete) return; // Debounce
    this.levelComplete = true;

    console.log("Level Complete!");

    // Show HUD message
    if (this.hud) {
      this.hud.showPersistentMessage(`STAGE ${this.currentStage} COMPLETE!`);
    }

    if (this.audioManager && this.audioManager.playLevelComplete) {
      this.audioManager.playLevelComplete();
    }

    // Next stage
    this.currentStage++;
    localStorage.setItem("shadowMazeStage", this.currentStage);

    // Check for victory (Stage 4 = after Stage 3)
    if (this.currentStage > 3) {
      console.log("GAME WON! All stages complete!");
      if (this.hud) {
        this.hud.showPersistentMessage("🎉 YOU ESCAPED THE NIGHTMARE! 🎉");
      }
      // Could show credits, reset game, etc.
      return;
    }

    // Reload level after a delay
    setTimeout(() => {
      if (this.multiplayerManager && this.multiplayerManager.isHost) {
        this.multiplayerManager.sendGameEvent("stageStart", {
          stage: this.currentStage,
        });
      }
      this.levelComplete = false;
      this._createLevel();
    }, 2500);
  }

  _onPlayerDeath() {
    console.log("[Game] PLAYER DEATH - reducing lives and respawning");

    // Reduce lives
    this.lives = Math.max(0, this.lives - 1);
    if (this.hud) {
      this.hud.updateLives(this.lives, this.maxLives);
    }

    // Check for game over (0 lives)
    if (this.lives <= 0) {
      this._showGameOver();
      return;
    }

    // Show death subtitle
    if (this.dialogueManager) {
      this.dialogueManager.showText(
        "The darkness claims you... but not yet.",
        3000,
        true,
      );
    }

    // Respawn after short delay with fade effect
    this._fadeToBlack(1000, () => {
      // Reset capture system
      if (this.captureSystem) {
        this.captureSystem.reset();
      }

      // Reset player health and state
      if (this.player) {
        this.player.health = this.player.maxHealth;
        this.player.injuryState = "healthy";
        this.player.isDead = false;
        this.player.controlsDisabled = false;

        // Respawn at start position
        const startPos = this.player.config?.startPosition || {
          x: 2,
          y: 1,
          z: 2,
        };
        if (this.player.body) {
          this.player.body.setTranslation(
            { x: startPos.x, y: startPos.y + 0.5, z: startPos.z },
            true,
          );
          this.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        if (this.player.mesh) {
          this.player.mesh.position.set(startPos.x, startPos.y, startPos.z);
        }
        this.player.bodyPosition = {
          x: startPos.x,
          y: startPos.y,
          z: startPos.z,
        };
      }

      // Move ghosts away from spawn
      if (this.ghosts) {
        const spawnX = this.player?.bodyPosition?.x || 2;
        const spawnZ = this.player?.bodyPosition?.z || 2;

        this.ghosts.forEach((ghost) => {
          ghost.killCooldown = 5; // 5 second grace period
          ghost.currentState = "wander";
          if (ghost.ai) {
            ghost.ai.currentState = "wander";
            ghost.ai.canSeeTarget = false;
          }

          // Calculate new position away from player
          let spawnPos = null;

          if (this.mazeGenerator) {
            // Try 10 times to find a valid spot
            for (let i = 0; i < 10; i++) {
              const cell = this.mazeGenerator.getRandomOpenCell();
              if (cell) {
                const dx = cell.x - spawnX;
                const dz = cell.z - spawnZ;
                const distSq = dx * dx + dz * dz;

                // Ensure at least 15 units away (15^2 = 225)
                if (distSq > 225) {
                  spawnPos = { x: cell.x, y: 2, z: cell.z };
                  break;
                }
              }
            }
          }

          // Fallback if no valid cell found or no maze generator
          if (!spawnPos) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 15 + Math.random() * 10;
            spawnPos = {
              x: spawnX + Math.cos(angle) * dist,
              y: 2, // FORCE RESET Y to prevent falling through world
              z: spawnZ + Math.sin(angle) * dist,
            };
          }

          // Update through the proxy (triggers sync)
          if (ghost.bodyPosition) {
            ghost.bodyPosition.x = spawnPos.x;
            ghost.bodyPosition.y = spawnPos.y; // Important: Update Y
            ghost.bodyPosition.z = spawnPos.z;
          }

          // Also directly set body if available (backup)
          if (ghost.body) {
            // Reset velocity to zero when teleporting
            ghost.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            ghost.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            ghost.body.setTranslation(
              { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
              true,
            );
          }

          // Sync mesh position
          if (ghost.mesh) {
            ghost.mesh.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
          }

          console.log(
            `[Game] Ghost teleported to (${spawnPos.x.toFixed(
              1,
            )}, ${spawnPos.z.toFixed(1)})`,
          );
        });
      }

      // Update HUD
      if (this.hud) {
        this.hud.updateHealth(this.player.health, this.player.maxHealth);
      }

      // Fade back in
      this._fadeFromBlack(1000);
    });
  }

  _fadeToBlack(duration, callback) {
    // Create fade overlay if not exists
    if (!this._fadeOverlay) {
      this._fadeOverlay = document.createElement("div");
      this._fadeOverlay.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: #000;
        opacity: 0;
        pointer-events: none;
        z-index: 9999;
        transition: opacity ${duration}ms ease-in;
      `;
      document.body.appendChild(this._fadeOverlay);
    }

    // Start fade
    this._fadeOverlay.style.transition = `opacity ${duration}ms ease-in`;
    this._fadeOverlay.style.opacity = "1";

    setTimeout(() => {
      if (callback) callback();
    }, duration);
  }

  _fadeFromBlack(duration) {
    if (this._fadeOverlay) {
      this._fadeOverlay.style.transition = `opacity ${duration}ms ease-out`;
      this._fadeOverlay.style.opacity = "0";
    }
  }

  _showGameOver() {
    console.log("[Game] GAME OVER - all lives lost");

    // Pause game
    this.isRunning = false;
    if (this.loopId) {
      cancelAnimationFrame(this.loopId);
    }

    // Stop audio
    if (this.audioManager) {
      this.audioManager.stopHeartbeat();
      this.audioManager.stopMusic();
    }

    // Show game over screen (from index.html)
    const gameOverScreen = document.getElementById("game-over-screen");
    if (gameOverScreen) {
      gameOverScreen.classList.remove("hidden");
    } else {
      // Fallback if no game over screen
      const retry = confirm(
        "GAME OVER - You ran out of lives.\\n\\nTry again?",
      );
      if (retry) {
        this.lives = this.maxLives;
        this._createLevel();
      } else {
        location.reload();
      }
    }
  }

  _startTutorialSequence() {
    if (!this.dialogueManager) return;

    // Tutorial sequence with timed messages
    const sequence = [
      {
        delay: 1500,
        action: () => this.dialogueManager.show("levelStart", true, 5000),
      },
      {
        delay: 7000,
        action: () => this.dialogueManager.show("torchHint", false, 4000),
      },
      {
        delay: 12000,
        action: () =>
          this.dialogueManager.showText(
            "WASD to move... SHIFT to run... Stay alive.",
            4000,
          ),
      },
      {
        delay: 18000,
        action: () => this.dialogueManager.show("exploration", false, 4000),
      },
      {
        delay: 25000,
        action: () => this.dialogueManager.show("terror", false, 3500),
      },
    ];

    sequence.forEach((item) => {
      setTimeout(() => {
        if (this.isRunning && this.dialogueManager) {
          item.action();
        }
      }, item.delay);
    });
  }

  resetCampaign() {
    console.log("Resetting campaign...");
    // Clear save
    localStorage.removeItem("shadowMazeStage");
    // Reload safely
    location.reload();
  }

  _updateRemotePlayers(dt) {
    if (!this.multiplayerManager) return;

    // Get latest data from manager
    const remoteData = this.multiplayerManager.getRemotePlayers();
    const activeIds = new Set();

    remoteData.forEach((data) => {
      activeIds.add(data.id);

      let rp = this.remotePlayers.get(data.id);

      // Spawn if new
      if (!rp) {
        console.log(`Creating Remote Player: ${data.name}`);
        rp = new RemotePlayer(
          this.scene.instance, // Needs direct scene reference
          data.id,
          data.name,
          data.gender || "male",
        );
        this.remotePlayers.set(data.id, rp);
      }

      // Update State
      if (data.position) {
        // Gender sync
        if (data.gender && rp.playerGender !== data.gender) {
          rp.setGender(data.gender);
        }

        rp.setNetworkState(
          data.position,
          data.rotation || 0,
          data.animState || "idle",
        );

        // Snap if too far (teleport)
        if (rp.currentPosition.distanceTo(data.position) > 10) {
          rp.setPosition(data.position.x, data.position.y, data.position.z);
        }
      }

      rp.update(dt);
    });

    // Cleanup disconnected
    for (const [id, rp] of this.remotePlayers) {
      if (!activeIds.has(id)) {
        rp.dispose();
        this.remotePlayers.delete(id);
      }
    }
  }
}
