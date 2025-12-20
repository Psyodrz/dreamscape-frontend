import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { Player } from './Player.js';
import { MazeGenerator } from './MazeGenerator.js';
import { Minimap } from './Minimap.js';
import { Ghost } from './Ghost.js';
import { SceneManager } from './SceneManager.js';
import { MenuManager } from './MenuManager.js';
import { TouchControls } from './TouchControls.js';
import { MultiplayerManager } from './MultiplayerManager.js';
import { MultiplayerUI } from './MultiplayerUI.js';
import { RemotePlayer } from './RemotePlayer.js';
import { getAudioManager } from './AudioManager.js';
import { PauseMenu } from './PauseMenu.js';
import { getAssetLoader } from './AssetLoader.js';
import updateManager from './UpdateManager.js';

import CannonDebugger from 'cannon-es-debugger';

// 📱 AUTO LANDSCAPE: Lock screen orientation to landscape mode
const lockToLandscape = async () => {
  try {
    // Method 1: Screen Orientation API (modern browsers)
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
      console.log('Screen locked to landscape mode');
    }
    // Method 2: Legacy screen.lockOrientation (older browsers)
    else if (screen.lockOrientation) {
      screen.lockOrientation('landscape');
      console.log('Screen locked to landscape (legacy)');
    }
    // Method 3: Mozilla prefix
    else if (screen.mozLockOrientation) {
      screen.mozLockOrientation('landscape');
      console.log('Screen locked to landscape (moz)');
    }
    // Method 4: MS prefix
    else if (screen.msLockOrientation) {
      screen.msLockOrientation('landscape');
      console.log('Screen locked to landscape (ms)');
    } else {
      console.log('Screen orientation lock not supported');
    }
  } catch (e) {
    console.log('Could not lock orientation:', e.message);
  }
};

// Attempt lock on page load (requires fullscreen on some browsers)
lockToLandscape();

// Also try on first user interaction (required by some browsers)
document.addEventListener('click', () => lockToLandscape(), { once: true });
document.addEventListener('touchstart', () => lockToLandscape(), { once: true });


export class Game {
  constructor() {
    this.container = document.getElementById('game-container');
    
    // Flags
    this.isMultiplayer = false;
    this.debugPhysics = false; // Physics debug flag
    
    // Performance Settings
    this.graphicsQuality = 'high';
    this.targetFPS = 60;
    this._targetFrameInterval = 1000 / 60;
    this._lastFrameTime = 0;
    
    this.sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    // 🚀 PERFORMANCE: Detect device capabilities once and cache result
    this.isLowEndDevice = this._detectLowEndDevice();

    this.clock = new THREE.Clock();
    this.lastTime = 0;
    this.deltaTime = 0;
    
    // Game state
    const savedStage = localStorage.getItem('shadowMazeStage');
    this.currentStage = savedStage ? parseInt(savedStage) : 1;
    console.log('Loaded saved stage:', this.currentStage);
    this.ghostsFrozen = false;
    this.baseGhostSpeed = 2.5;
    this.ghosts = [];
    this._catchCooldown = 0;
    this._ghostLogTimer = 0;
    
    // Lives system
    this.lives = 3;
    this.maxLives = 3;
    
    // Timer system
    this.stageTimer = 0;
    this.stageTimeLimit = 300; // 5 minutes = 300 seconds (for stages 1 & 2)
    this.timerRunning = false;
    
    // Stage configuration: maze size and ghost count per stage
    this.stageConfig = {
      1: { width: 40, height: 40, ghosts: 1, timeLimit: 300 },  // Stage 1: Basic
      2: { width: 60, height: 60, ghosts: 2, timeLimit: 300 },  // Stage 2: Larger
      3: { width: 80, height: 80, ghosts: 4, timeLimit: null }, // Stage 3: Largest, no timer
    };
    
    // Audio Manager
    this.audioManager = getAudioManager();
    
    // Dynamic ghost spawning
    this.ghostSpawnTimer = 0;
    this.ghostSpawnInterval = 5000;
    this.maxGhosts = 1;
    
    // Multiplayer - use global manager if exists (from lobby), otherwise create new
    this.isMultiplayer = false;
    if (window._multiplayerManager) {
      // Use the existing manager from the lobby
      this.multiplayerManager = window._multiplayerManager;
      this.multiplayerManager.game = this; // Update game reference
      this.multiplayerUI = window._multiplayerUI;
      console.log('Game: Using existing multiplayer manager from lobby');
    } else {
      // Create new manager (for solo play or direct start)
      this.multiplayerManager = new MultiplayerManager(this);
      this.multiplayerUI = new MultiplayerUI(this.multiplayerManager);
      this.multiplayerUI.onGameStart = (isMultiplayer) => {
        this.isMultiplayer = isMultiplayer;
        this._startMultiplayerGame();
      };
    }
    
    // Setup multiplayer event listener
    if (this.multiplayerManager) {
      this.multiplayerManager.onGameEvent = (event, data) => {
        this._handleMultiplayerEvent(event, data);
      };
    }
    
    // Remote players map (peerId -> RemotePlayer instance)
    this.remotePlayers = new Map();

    this._initScene();
    this._initPhysics();
    this._initLighting();
    
    // Create maze and then init player/minimap
    this._createMaze().then(() => {
      this._initPlayer();
      this._initMinimap();
      this._setupEventListeners();
      this._initCatchOverlay();
      this._initPlayerFlashlight();
      
      // Start background music and game start sound
      this.audioManager.init();
      this.audioManager.playGameStart();
      setTimeout(() => {
        this.audioManager.startMusic();
      }, 1500);
      
      // Initialize pause menu
      this.pauseMenu = new PauseMenu(this);
      this.pauseMenu.setMultiplayerMode(this.isMultiplayer);
      this.pauseMenu.show();
      
      // Initialize lives UI
      this._updateLivesUI();
      
      // Initialize Touch Controls
      this.touchControls = new TouchControls();
      if (this.touchControls.isMobile()) {
          console.log('Mobile device detected - Touch Controls Enabled');
      }

      // Initialize Update Manager
      updateManager.init();
      // Auto-check for updates on startup (after a slight delay to ensure network)
      setTimeout(() => {
        updateManager.checkForUpdate(false);
      }, 5000);
      
      // Start the game loop
      // Listen for ghost attacks
    // Listen for ghost attack events (handled by _initCatchOverlay via _onGhostAttack)
    // Removed duplicate listener that was causing instant Game Over

    this._animate();
      
      // Start correct stage (synced, saved, or 1)
      const startStage = this.multiplayerManager?.initialStage || this.currentStage || 1;
      this.startStage(startStage);
    });
  }
  
  _startMultiplayerGame() {
    console.log('Starting multiplayer game...');
    // Hide menu and loading screens
    document.getElementById('menu-overlay')?.classList.add('hidden');
    document.getElementById('loading-screen')?.classList.add('hidden');
    
    // Show voice controls in multiplayer
    document.getElementById('voice-controls')?.classList.remove('hidden');
  }

  _detectLowEndDevice() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    if (!gl) return true; // No WebGL = definitely low-end

    // Check available memory
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';

    // Detect mobile devices
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // Check hardware concurrency (CPU cores)
    const cores = navigator.hardwareConcurrency || 2;

    // Check memory (if available)
    const memory = navigator.deviceMemory || 4;

    // Clean up context to avoid "Too many active WebGL contexts" warning
    const loseContext = gl.getExtension('WEBGL_lose_context');
    if (loseContext) {
      loseContext.loseContext();
    }

    // Determine if device is low-end
    const isLowEnd = isMobile ||
                     cores < 4 ||
                     memory < 4 ||
                     renderer.toLowerCase().includes('intel') ||
                     renderer.toLowerCase().includes('adreno 3') ||
                     renderer.toLowerCase().includes('mali-4');

    console.log(`Device Detection: ${isLowEnd ? 'Low-end' : 'High-end'} (Mobile: ${isMobile}, Cores: ${cores}, Memory: ${memory}GB)`);

    return isLowEnd;
  }

  _initScene() {
    // Canvas
    const canvas = document.querySelector('canvas.webgl');

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x050505, 0.12); // Dense fog for limited visibility

    // 🌌 SKY SPHERE: High quality night sky HDRI
    const textureLoader = new THREE.TextureLoader();
    const skyTexture = textureLoader.load('./assets/NightSkyHDRI003_8K/NightSkyHDRI003.png', (texture) => {
      // Ensure seamless wrapping for endless loop effect
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
    });
    
    // Create a large sky sphere that surrounds the entire scene
    const skyGeometry = new THREE.SphereGeometry(500, 64, 32); // Larger sphere for better immersion
    const skyMaterial = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide, // Render inside of the sphere
      fog: false // Sky should not be affected by fog
    });
    this.skySphere = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(this.skySphere);

    // 🚀 RENDERER OPTIMIZATION: Adaptive quality settings
    const isLowEndDevice = this.isLowEndDevice;
    const app = document.getElementById('app');
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !isLowEndDevice, // Disable AA on low-end devices
      powerPreference: 'high-performance',
      stencil: false,
      depth: true
    });
    
    this.renderer.setSize(this.sizes.width, this.sizes.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowEndDevice ? 1.5 : 2));
    // GRAPHICS UPGRADE: High Quality Settings
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer, nicer shadows
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; // Correct color space
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // Cinematic lighting
    this.renderer.toneMappingExposure = 1.2; // Slightly brighter to compensate for Filmic
    
    this.renderer.setSize(this.sizes.width, this.sizes.height);
    // OPTIMIZATION: Cap pixel ratio to 2 (User doesn't need 3x/4x on mobile)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    // Camera
    this.camera = new THREE.PerspectiveCamera(75, this.sizes.width / this.sizes.height, 0.1, 100);
    this.camera.position.set(0, 3, 0);
    this.scene.add(this.camera);
  }

  _initPhysics() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, -9.82, 0);
    
    // Adaptive physics quality based on device performance
    const isLowEndDevice = this.isLowEndDevice;
    this.world.solver.iterations = isLowEndDevice ? 8 : 12; // Reduced from 15
    this.world.solver.tolerance = isLowEndDevice ? 0.001 : 0.0005; // Relaxed tolerance
    
    // Materials
    this.materials = {
      default: new CANNON.Material('default'),
      player: new CANNON.Material('player'),
      floor: new CANNON.Material('floor'),
      wall: new CANNON.Material('wall'),
    };
    
    const defaultContactMaterial = new CANNON.ContactMaterial(
      this.materials.default,
      this.materials.default,
      {
        friction: 0.1,
        restitution: 0.7,
      }
    );
    this.world.addContactMaterial(defaultContactMaterial);
  }

  _initLighting() {
    // 🚀 LIGHTING OPTIMIZATION: Adaptive quality based on device capability
    const isLowEndDevice = this.isLowEndDevice;

    // Minimal ambient light for horror atmosphere
    this.ambientLight = new THREE.AmbientLight(0x1a1a2e, 0.15); // Very dark blue-purple tint
    this.scene.add(this.ambientLight);

    this.dynamicLights = [];
    this.flickerTime = 0;
    this.maxDynamicLights = isLowEndDevice ? 2 : 4; // Reduce lights on low-end devices
    
    this.maxDynamicLights = isLowEndDevice ? 2 : 4; // Reduce lights on low-end devices
    
    // LAMP LOADING MOVED TO _createMaze() to ensure walls exist first!
    
    // Very dim directional light from above (moonlight effect)
    this.dirLight = new THREE.DirectionalLight(0x4a4a6e, 0.3); // Dim blue-purple
    this.dirLight.position.set(0, 20, 0);
    this.dirLight.castShadow = true;
    
    // 🚀 SHADOW OPTIMIZATION: Adaptive shadow quality
    const shadowMapSize = isLowEndDevice ? 512 : 1024; // Reduced from 2048
    this.dirLight.shadow.mapSize.width = shadowMapSize;
    this.dirLight.shadow.mapSize.height = shadowMapSize;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 100;
    this.dirLight.shadow.camera.left = -50;
    this.dirLight.shadow.camera.right = 50;
    this.dirLight.shadow.camera.top = 50;
    this.dirLight.shadow.camera.bottom = -50;
    this.dirLight.shadow.bias = -0.001;
    this.dirLight.shadow.radius = isLowEndDevice ? 4 : 8; // Reduce shadow softness on low-end

    this.scene.add(this.dirLight);
    
    // 🔦 PLAYER FLASHLIGHT: Spotlight attached to camera
    this.flashlight = new THREE.SpotLight(0xffffff, 2.0);
    this.flashlight.angle = Math.PI / 6; // 30 degree cone
    this.flashlight.penumbra = 0.3; // Soft edges
    this.flashlight.decay = 1.5;
    this.flashlight.distance = 30; // Range
    this.flashlight.castShadow = !isLowEndDevice;
    if (this.flashlight.castShadow) {
      this.flashlight.shadow.mapSize.width = 512;
      this.flashlight.shadow.mapSize.height = 512;
    }
    // Will be attached to camera in _updatePlayerFlashlight
    this.camera.add(this.flashlight);
    this.flashlight.position.set(0, 0, 0); // At camera position
    this.flashlight.target.position.set(0, 0, -1); // Pointing forward
    this.camera.add(this.flashlight.target);
    
    console.log('Flashlight initialized');
  }
  
  _updatePlayerFlashlight() {
    if (!this.flashlight || !this.player) return;
    
    const isOn = this.player.isFlashlightOn;
    
    // Sync flashlight visibility with player state
    this.flashlight.visible = isOn;
    
    // COMPLETE DARKNESS: When flashlight is off, disable ALL lights
    if (this.ambientLight) {
      this.ambientLight.intensity = isOn ? 0.15 : 0; // ZERO ambient when off
    }
    if (this.dirLight) {
      this.dirLight.intensity = isOn ? 0.3 : 0; // ZERO directional when off
    }
    // Disable lamp lights completely when flashlight is off
    if (this.dynamicLights) {
      for (const light of this.dynamicLights) {
        light.intensity = isOn ? light.userData.originalIntensity || 1.2 : 0; // ZERO
      }
    }
    
    // EXTREME FOG: Increase fog density when flashlight off for pitch black
    if (this.scene && this.scene.fog) {
      this.scene.fog.density = isOn ? 0.12 : 0.5; // Very thick fog when off
    }
  }
  
  _addDynamicLights() {
    // Add flickering point lights at strategic locations with lamp models
    const allLightPositions = [
      { x: 5, y: 0, z: 5, color: 0xffaa44, intensity: 1.5 },
      { x: 15, y: 0, z: 15, color: 0xffaa44, intensity: 1.2 },
      { x: 25, y: 0, z: 10, color: 0xffaa44, intensity: 1.2 },
      { x: 35, y: 0, z: 30, color: 0xffaa44, intensity: 1.5 },
    ];
    
    // 🚀 LIGHTING OPTIMIZATION: Limit lights based on device capability
    const lightPositions = allLightPositions.slice(0, this.maxDynamicLights);
    
    // Store lamp meshes for position updates
    this.lampMeshes = [];
    
    // Function to find wall positions adjacent to corridors
    const findWallMountPositions = () => {
      if (!this.mazeGenerator) {
        console.log('No maze generator available for lamp placement');
        return [];
      }
      
      const mazeData = this.mazeGenerator.getMazeData();
      const maze = mazeData.maze;
      const cellSize = mazeData.cellSize;
      const wallThickness = 0.3;
      const wallPositions = [];
      
      // Scan the maze for walls adjacent to corridors
      for (let y = 1; y < mazeData.height - 1; y++) {
        for (let x = 1; x < mazeData.width - 1; x++) {
          if (maze[y][x] === 1) {
            const wallCenterX = x * cellSize + cellSize / 2;
            const wallCenterZ = y * cellSize + cellSize / 2;
            
            // Check all 4 directions for adjacent corridors
            if (maze[y - 1] && maze[y - 1][x] === 0) {
              wallPositions.push({
                x: wallCenterX, y: 2.0,
                z: y * cellSize + wallThickness,
                rotY: Math.PI,
              });
            }
            if (maze[y + 1] && maze[y + 1][x] === 0) {
              wallPositions.push({
                x: wallCenterX, y: 2.0,
                z: (y + 1) * cellSize - wallThickness,
                rotY: 0,
              });
            }
            if (maze[y][x - 1] === 0) {
              wallPositions.push({
                x: x * cellSize + wallThickness, y: 2.0,
                z: wallCenterZ,
                rotY: -Math.PI / 2,
              });
            }
            if (maze[y][x + 1] === 0) {
              wallPositions.push({
                x: (x + 1) * cellSize - wallThickness, y: 2.0,
                z: wallCenterZ,
                rotY: Math.PI / 2,
              });
            }
          }
        }
      }
      
      // Shuffle and limit lamps for performance
      const shuffled = wallPositions.sort(() => Math.random() - 0.5);
      return shuffled.slice(0, 10); // Only 10 lamps for good performance
    };

    // Get wall mount positions from maze
    const wallMounts = findWallMountPositions();
    console.log(`Placing ${wallMounts.length} lamps on walls`);
    
    // LOAD REAL LAMP ASSET
    const loadLampAsset = () => {
      const objLoader = new OBJLoader();
      const textureLoader = new THREE.TextureLoader();
      
      console.log('Loading lamp assets from ./assets/lamp/');
      
      Promise.all([
        new Promise((resolve, reject) => {
          objLoader.load(
            './assets/lamp/1.obj',
            (obj) => {
              console.log('Lamp OBJ loaded successfully');
              resolve(obj);
            },
            (progress) => {
              // Progress callback (optional)
            },
            (error) => {
              console.error('Failed to load lamp OBJ:', error);
              reject(error);
            }
          );
        }),
        new Promise((resolve, reject) => {
          textureLoader.load(
            './assets/lamp/18.jpg',
            (tex) => {
              console.log('Lamp texture loaded successfully');
              resolve(tex);
            },
            undefined,
            (error) => {
              console.error('Failed to load lamp texture:', error);
              reject(error);
            }
          );
        })
      ]).then(([object, texture]) => {
        console.log('Lamp asset loaded');
        
        // Prepare base model
        object.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              map: texture,
              metalness: 0.5,
              roughness: 0.5,
              side: THREE.DoubleSide
            });
            child.castShadow = true;
          }
        });
        
        // normalize scale - 27MB obj is likely huge or tiny. 
        // Heuristic: Set to reasonable size (e.g. 0.5m tall?)
        // Let's rely on manual tuning or a safe default. 
        // 1.obj usually implies raw export.
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 0.5; // 50cm tall/wide
        const scaleFactor = targetSize / maxDim;
        object.scale.setScalar(scaleFactor);
        
        // Place instances
        wallMounts.forEach((mount, index) => {
          const lamp = object.clone();
          
          // Position lamp on wall
          // Adjust position to account for pivot not being at wall-mount point
          // We might need to offset it. Assuming center pivot for now.
          lamp.position.set(mount.x, mount.y, mount.z);
          lamp.rotation.y = mount.rotY;
          
          this.scene.add(lamp);
          this.lampMeshes.push({ mesh: lamp, position: mount });
          
          // Add point light - user wants GLOW
          // Always add light to visible lamps
          if (index < this.maxDynamicLights * 2) { // Increase limit
            const light = new THREE.PointLight(0xffaa44, 2.0, 8);
            light.position.set(mount.x, mount.y, mount.z);
            // Move light slightly away from wall to avoid self-shadow artifacts
            const offset = 0.2;
            light.position.x += Math.sin(mount.rotY) * offset;
            light.position.z += Math.cos(mount.rotY) * offset;
            
            light.castShadow = !this.isLowEndDevice; 
            this.scene.add(light);
            
            // Add a small emissive sphere/sprite to simulate the bulb look if not in model
            const bulbGeo = new THREE.SphereGeometry(0.05, 8, 8);
            const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.copy(light.position);
            this.scene.add(bulb);
          }
        });
        
      }).catch(err => {
        console.error('Failed to load lamp asset:', err);
        // Fallback or explicit error
      });
    };
    
    loadLampAsset();

    // Update positions when maze is ready (legacy function kept for compatibility if needed)
    this._updateDynamicLightPositions = () => {};
    
    // Legacy procedural lights (removed to prevent conflicts with new asset lights)
    // lightPositions.forEach(...)
  }
  
  _updateDynamicLights(currentTime) {
    // Create flickering effect for horror atmosphere
    this.flickerTime = currentTime;
    
    this.dynamicLights.forEach((lightData) => {
      const time = this.flickerTime + lightData.flickerOffset;
      
      // Create random flickering effect
      const flicker = Math.sin(time * 8) * 0.15 + // Fast flicker
                     Math.sin(time * 3) * 0.25 + // Medium flicker
                     Math.sin(time * 0.5) * 0.4; // Slow pulse
      
      // Random intensity variation for more realistic flicker
      const randomFlicker = (Math.random() - 0.5) * 0.3;
      const intensity = Math.max(0.1, lightData.baseIntensity + flicker + randomFlicker);
      
      // Slight color variation
      const colorShift = Math.sin(time * 2) * 0.1;
      const colorIntensity = 1.0 + colorShift;
      
      lightData.light.intensity = intensity;
      
      // Apply color variation
      const baseColor = new THREE.Color(lightData.baseColor);
      baseColor.multiplyScalar(colorIntensity);
      lightData.light.color.copy(baseColor);
    });
  }
  
  _initPlayerFlashlight() {
    // Add a spotlight attached to player for flashlight effect
    if (!this.player) return;
    
    this.flashlight = new THREE.SpotLight(0xffeecc, 5.0, 40, Math.PI / 5, 0.4, 1);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.width = 1024;
    this.flashlight.shadow.mapSize.height = 1024;
    this.flashlight.shadow.radius = 8;
    this.flashlight.decay = 1.5;
    
    this.scene.add(this.flashlight);
    this.scene.add(this.flashlight.target);
  }
  
  _updatePlayerFlashlight() {
    // Update flashlight to follow player camera
    if (!this.flashlight || !this.player) return;
    
    // Sync Stealth State
    this.player.isFlashlightOn = this.flashlight.visible;
    
    // Get camera position and direction
    const cameraPos = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPos);
    const cameraDir = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDir);
    
    // Position flashlight slightly in front of camera
    this.flashlight.position.copy(cameraPos);
    const offsetDir = cameraDir.clone();
    offsetDir.multiplyScalar(0.5);
    this.flashlight.position.add(offsetDir);
    
    // Point flashlight in camera direction
    this.flashlight.target.position.copy(cameraPos);
    const targetDir = cameraDir.clone();
    targetDir.multiplyScalar(10);
    this.flashlight.target.position.add(targetDir);
    
    // Add slight flicker to flashlight for horror effect
    const flicker = 1.0 + (Math.random() - 0.5) * 0.1;
    this.flashlight.intensity = 5.0 * flicker;
  }

  _createMaze() {
    // Get maze seed from multiplayer manager if available (ensures all players get same maze)
    const mazeSeed = this.multiplayerManager?.mazeSeed || null;
    
    if (mazeSeed) {
      console.log('Game: Using shared maze seed:', mazeSeed);
    }
    
    // Create maze generator with larger initial size
    this.mazeGenerator = new MazeGenerator(this.world, this.scene, this.materials, this.renderer, {
      width: 40,
      height: 40,
      seed: mazeSeed, // Pass seed for deterministic generation
    });
    // Return promise that resolves when maze is ready
    return this.mazeGenerator.ready();
  }


  _initPlayer() {
    // Get start position from maze
    const startPos = this.mazeGenerator.getStartPosition();
    
    // Get selected character from menu
    let characterType = 'male';
    if (window.menuManager) {
        const profile = window.menuManager.getPlayerProfile();
        if (profile && profile.characterGender) {
            characterType = profile.characterGender;
            console.log('Game: Initializing player with character type:', characterType);
        }
    }
    
    // Create player with custom configuration
    this.player = new Player(this.world, this.scene, this.camera, {
      radius: 0.4465, // Precise radius
      height: 3.0,    // Taller player
      mass: 70,
      speed: 7,
      sprintMultiplier: 1.6,
      acceleration: 25,
      jumpSpeed: 7,
      airControl: 0.2,
      coyoteTime: 0.1,
      startPosition: new THREE.Vector3(startPos.x, startPos.y, startPos.z),
      groundCheckDistance: 0.1,
      characterType: characterType, // Pass selected character type
    });

    // Setup contact material between player and floor
    const playerFloorContact = new CANNON.ContactMaterial(
      this.player.material,
      this.materials.floor,
      {
        friction: 0.0, // No friction for smooth movement
        restitution: 0.0, // No bounce
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3,
      }
    );
    this.world.addContactMaterial(playerFloorContact);

    // Player vs default material
    const playerDefaultContact = new CANNON.ContactMaterial(
      this.player.material,
      this.materials.default,
      {
        friction: 0.0,
        restitution: 0.0,
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3,
      }
    );
    this.world.addContactMaterial(playerDefaultContact);
  }

  _initMinimap() {
    // Create minimap with maze data
    this.minimap = new Minimap(this.scene, this.camera, this.mazeGenerator.getMazeData());
  }

  _initGhost() {
    // Deprecated: ghosts are created via startStage
  }

  startStage(stage) {
    // Clear existing ghosts
    this._clearGhosts();
    
    // Get stage configuration
    const config = this.stageConfig[stage] || this.stageConfig[1];
    console.log(`Starting Stage ${stage}:`, config);
    
    // Set timer based on stage
    if (config.timeLimit) {
      this.stageTimer = config.timeLimit;
      this.timerRunning = true;
    } else {
      this.stageTimer = 0;
      this.timerRunning = false;
    }
    
    // Update UI
    this._updateTimerUI();
    this._updateStageUI(stage);

    // Regenerate maze with stage-specific size
    const complexity = Math.min(0.7 + stage * 0.1, 0.95);
    
    this.mazeGenerator.regenerate({ 
      width: config.width, 
      height: config.height, 
      complexity: complexity 
    }).then(() => {
      // Recreate minimap with new maze data
      if (this.minimap) this.minimap.dispose();
      this.minimap = new Minimap(this.scene, this.camera, this.mazeGenerator.getMazeData());

      // Reset player to new start position
      if (this.player) {
        const startPos = this.mazeGenerator.getStartPosition();
        this.player.config.startPosition.set(startPos.x, startPos.y, startPos.z);
        this.player.resetToStart(new CANNON.Vec3(startPos.x, startPos.y, startPos.z));
      }

      // Spawn ghosts based on stage config after 5 seconds
      this.ghosts = [];
      const ghostCount = config.ghosts;
      console.log(`Stage ${stage}: Spawning ${ghostCount} ghosts in 5 seconds...`);
      
      setTimeout(() => {
        for (let i = 0; i < ghostCount; i++) {
          const g = new Ghost(this.scene, this.world, this.player, this.mazeGenerator);
          g.chaseSpeed = this.baseGhostSpeed + stage;
          
          const spawnPos = this.mazeGenerator.getRandomOpenCell();
          if (spawnPos) {
            g.body.position.set(spawnPos.x, 2, spawnPos.z);
            g.mesh.position.set(spawnPos.x, 2, spawnPos.z);
            console.log(`Ghost ${i + 1} spawned at:`, spawnPos.x.toFixed(1), spawnPos.z.toFixed(1));
          }
          
          this.ghosts.push(g);
        }
        console.log(`Stage ${stage}: ${ghostCount} ghosts spawned!`);
      }, 5000);

      this.currentStage = stage;
      this.ghostsFrozen = false;
      
      // Broadcast to other players if Host
      if (this.isMultiplayer && this.multiplayerManager && this.multiplayerManager.isHost) {
        console.log('Host broadcasting stage start:', stage);
        this.multiplayerManager.sendGameEvent('stageStart', { stage: stage });
      }
      
      // SAVE PROGRESS
      try {
          localStorage.setItem('shadowMazeStage', stage.toString());
          console.log('Progress saved: Stage ' + stage);
      } catch (e) {
          console.warn('Failed to save progress:', e);
      }
      
      // Spawn MORE traps in the maze - increased quantity for horror
      this._spawnTraps(15 + stage * 10); // Stage 1: 25, Stage 2: 35, Stage 3: 45 traps
    });
  }
  
  _spawnTraps(count) {
    // Clear existing traps
    if (this.traps) {
      for (const trap of this.traps) {
        this.scene.remove(trap.mesh);
      }
    }
    this.traps = [];
    
    // Get player start position to avoid spawning traps there
    const playerStart = this.player?.config?.startPosition || { x: 0, z: 0 };
    
    // Trap types with weights for random selection
    const trapTypes = [
      { type: 'spike', weight: 20 },       // Classic spike trap - instant damage
      { type: 'pit', weight: 15 },         // Pit trap - deep dark hole
      { type: 'poison', weight: 15 },      // Poison trap - green gas
      { type: 'web', weight: 10 },         // Web trap - slows player
      { type: 'shadow', weight: 10 },      // Shadow trap - disables flashlight
      { type: 'fire', weight: 10 },        // Fire trap - burning damage over time
      { type: 'ice', weight: 8 },          // Ice trap - freezes and slows
      { type: 'teleport', weight: 5 },     // Teleport trap - sends player to random location
      { type: 'bear', weight: 4 },         // Bear trap - immobilizes briefly
      { type: 'confusion', weight: 3 },    // Confusion trap - inverts controls
    ];
    
    const totalWeight = trapTypes.reduce((sum, t) => sum + t.weight, 0);
    
    const getRandomTrapType = () => {
      // FEATURE: Use Math.random() so each player gets different traps
      // Multiplayer "Hallucination" Mode
      let random = Math.random() * totalWeight;
      for (const trapType of trapTypes) {
        random -= trapType.weight;
        if (random <= 0) return trapType.type;
      }
      return 'spike';
    };
    
    for (let i = 0; i < count; i++) {
      const pos = this.mazeGenerator.getRandomOpenCell();
      if (!pos) continue;
      
      // Don't spawn too close to player start
      const distFromStart = Math.sqrt((pos.x - playerStart.x) ** 2 + (pos.z - playerStart.z) ** 2);
      if (distFromStart < 10) continue;
      
      const trapType = getRandomTrapType();
      const trap = this._createTrap(trapType, pos);
      
      if (trap) {
        this.traps.push(trap);
      }
    }
    
    console.log(`Spawned ${this.traps.length} traps in maze (mixed types)`);
  }
  
  _createTrap(type, pos) {
    const trapGroup = new THREE.Group();
    let trapData = {
      mesh: trapGroup,
      position: { x: pos.x, z: pos.z },
      radius: 1.0,
      triggered: false,
      type: type,
      effect: null,
    };
    
    switch (type) {
      case 'spike':
        this._createSpikeTrap(trapGroup);
        trapData.radius = 1.0;
        break;
        
      case 'pit':
        this._createPitTrap(trapGroup);
        trapData.radius = 0.8;
        break;
        
      case 'poison':
        this._createPoisonTrap(trapGroup);
        trapData.radius = 1.5;
        break;
        
      case 'web':
        this._createWebTrap(trapGroup);
        trapData.radius = 1.2;
        break;
        
      case 'shadow':
        this._createShadowTrap(trapGroup);
        trapData.radius = 1.0;
        break;
        
      case 'fire':
        this._createFireTrap(trapGroup);
        trapData.radius = 1.3;
        break;
        
      case 'ice':
        this._createIceTrap(trapGroup);
        trapData.radius = 1.2;
        break;
        
      case 'teleport':
        this._createTeleportTrap(trapGroup);
        trapData.radius = 0.9;
        break;
        
      case 'bear':
        this._createBearTrap(trapGroup);
        trapData.radius = 0.7;
        break;
        
      case 'confusion':
        this._createConfusionTrap(trapGroup);
        trapData.radius = 1.0;
        break;
        
      default:
        this._createSpikeTrap(trapGroup);
    }
    
    trapGroup.position.set(pos.x, 0, pos.z);
    this.scene.add(trapGroup);
    
    return trapData;
  }
  
  _createSpikeTrap(group) {
    // Base plate (dark metal)
    const baseGeo = new THREE.BoxGeometry(2, 0.1, 2);
    const baseMat = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      metalness: 0.8, 
      roughness: 0.3 
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.05;
    group.add(base);
    
    // Semi-hidden spikes
    const spikeGeo = new THREE.ConeGeometry(0.1, 0.4, 4);
    const spikeMat = new THREE.MeshStandardMaterial({ 
      color: 0x666666, 
      metalness: 0.9, 
      roughness: 0.1 
    });
    
    for (let sx = -0.6; sx <= 0.6; sx += 0.4) {
      for (let sz = -0.6; sz <= 0.6; sz += 0.4) {
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        spike.position.set(sx, 0.1, sz);
        group.add(spike);
      }
    }
  }
  
  _createPitTrap(group) {
    // Dark hole in floor (looks like void)
    const pitGeo = new THREE.CylinderGeometry(0.8, 0.6, 0.3, 16);
    const pitMat = new THREE.MeshStandardMaterial({ 
      color: 0x000000, 
      emissive: 0x110011,
      emissiveIntensity: 0.2,
      roughness: 1,
      metalness: 0
    });
    const pit = new THREE.Mesh(pitGeo, pitMat);
    pit.position.y = -0.1;
    group.add(pit);
    
    // Cracked edges
    const edgeGeo = new THREE.RingGeometry(0.7, 1.0, 16);
    const edgeMat = new THREE.MeshStandardMaterial({ 
      color: 0x1a1a1a, 
      roughness: 0.9,
      side: THREE.DoubleSide
    });
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.02;
    group.add(edge);
  }
  
  _createPoisonTrap(group) {
    // Cracked floor tile
    const tileGeo = new THREE.BoxGeometry(1.5, 0.08, 1.5);
    const tileMat = new THREE.MeshStandardMaterial({ 
      color: 0x2a3a2a, 
      roughness: 0.7 
    });
    const tile = new THREE.Mesh(tileGeo, tileMat);
    tile.position.y = 0.04;
    group.add(tile);
    
    // Green poison vents
    for (let i = 0; i < 4; i++) {
      const ventGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.1, 8);
      const ventMat = new THREE.MeshStandardMaterial({ 
        color: 0x003300, 
        emissive: 0x00ff00,
        emissiveIntensity: 0.3
      });
      const vent = new THREE.Mesh(ventGeo, ventMat);
      const angle = (i / 4) * Math.PI * 2;
      vent.position.set(Math.cos(angle) * 0.5, 0.1, Math.sin(angle) * 0.5);
      group.add(vent);
    }
  }
  
  _createWebTrap(group) {
    // Spider web on floor (white/grey threads)
    const webMat = new THREE.MeshStandardMaterial({ 
      color: 0xcccccc, 
      transparent: true,
      opacity: 0.6,
      roughness: 0.8
    });
    
    // Radial web strands
    for (let i = 0; i < 8; i++) {
      const strandGeo = new THREE.BoxGeometry(0.02, 0.01, 1.2);
      const strand = new THREE.Mesh(strandGeo, webMat);
      strand.rotation.y = (i / 8) * Math.PI;
      strand.position.y = 0.01;
      group.add(strand);
    }
    
    // Circular rings
    for (let r = 0.2; r <= 0.6; r += 0.2) {
      const ringGeo = new THREE.TorusGeometry(r, 0.01, 4, 16);
      const ring = new THREE.Mesh(ringGeo, webMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.01;
      group.add(ring);
    }
  }
  
  _createShadowTrap(group) {
    // Dark rune circle (magic trap)
    const circleGeo = new THREE.RingGeometry(0.5, 0.8, 6);
    const circleMat = new THREE.MeshStandardMaterial({ 
      color: 0x1a0033, 
      emissive: 0x440066,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide
    });
    const circle = new THREE.Mesh(circleGeo, circleMat);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.02;
    group.add(circle);
    
    // Inner pentagram-like shape
    const innerGeo = new THREE.RingGeometry(0.2, 0.4, 5);
    const innerMat = new THREE.MeshStandardMaterial({ 
      color: 0x220044, 
      emissive: 0x6600aa,
      emissiveIntensity: 0.8,
      side: THREE.DoubleSide
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.03;
    group.add(inner);
  }
  
  _createFireTrap(group) {
    // Glowing coal bed
    const coalGeo = new THREE.CylinderGeometry(0.8, 1.0, 0.15, 12);
    const coalMat = new THREE.MeshStandardMaterial({ 
      color: 0x1a0a00, 
      emissive: 0xff3300,
      emissiveIntensity: 0.6,
      roughness: 0.8
    });
    const coal = new THREE.Mesh(coalGeo, coalMat);
    coal.position.y = 0.08;
    group.add(coal);
    
    // Flames (glowing cone shapes)
    const flameMat = new THREE.MeshBasicMaterial({ 
      color: 0xff6600, 
      transparent: true, 
      opacity: 0.8 
    });
    
    for (let i = 0; i < 6; i++) {
      const flameGeo = new THREE.ConeGeometry(0.15, 0.5 + Math.random() * 0.3, 6);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      const angle = (i / 6) * Math.PI * 2;
      flame.position.set(Math.cos(angle) * 0.4, 0.3, Math.sin(angle) * 0.4);
      flame.rotation.x = (Math.random() - 0.5) * 0.3;
      group.add(flame);
    }
    
    // Center flame
    const centerFlameGeo = new THREE.ConeGeometry(0.2, 0.8, 6);
    const centerFlame = new THREE.Mesh(centerFlameGeo, new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.9
    }));
    centerFlame.position.y = 0.45;
    group.add(centerFlame);
    
    // Add point light for glow effect
    const fireLight = new THREE.PointLight(0xff4400, 2, 5);
    fireLight.position.y = 0.5;
    group.add(fireLight);
  }
  
  _createIceTrap(group) {
    // Frozen floor patch
    const iceGeo = new THREE.CylinderGeometry(1.0, 1.2, 0.08, 8);
    const iceMat = new THREE.MeshStandardMaterial({ 
      color: 0x88ddff,
      emissive: 0x4488ff,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.8,
      metalness: 0.9,
      roughness: 0.1
    });
    const ice = new THREE.Mesh(iceGeo, iceMat);
    ice.position.y = 0.04;
    group.add(ice);
    
    // Ice crystals
    const crystalMat = new THREE.MeshStandardMaterial({ 
      color: 0xaaeeff,
      emissive: 0x66ccff,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.7
    });
    
    for (let i = 0; i < 5; i++) {
      const crystalGeo = new THREE.ConeGeometry(0.08, 0.3 + Math.random() * 0.4, 5);
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);
      const angle = (i / 5) * Math.PI * 2;
      const dist = 0.3 + Math.random() * 0.4;
      crystal.position.set(Math.cos(angle) * dist, 0.2, Math.sin(angle) * dist);
      crystal.rotation.x = (Math.random() - 0.5) * 0.4;
      crystal.rotation.z = (Math.random() - 0.5) * 0.4;
      group.add(crystal);
    }
  }
  
  _createTeleportTrap(group) {
    // Swirling portal circle
    const portalGeo = new THREE.RingGeometry(0.3, 0.8, 24);
    const portalMat = new THREE.MeshBasicMaterial({ 
      color: 0x9900ff, 
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });
    const portal = new THREE.Mesh(portalGeo, portalMat);
    portal.rotation.x = -Math.PI / 2;
    portal.position.y = 0.02;
    group.add(portal);
    
    // Inner portal void
    const voidGeo = new THREE.CircleGeometry(0.3, 16);
    const voidMat = new THREE.MeshBasicMaterial({ 
      color: 0x220044,
      side: THREE.DoubleSide 
    });
    const voidMesh = new THREE.Mesh(voidGeo, voidMat);
    voidMesh.rotation.x = -Math.PI / 2;
    voidMesh.position.y = 0.03;
    group.add(voidMesh);
    
    // Glowing particles around portal
    for (let i = 0; i < 8; i++) {
      const particleGeo = new THREE.SphereGeometry(0.05, 6, 6);
      const particleMat = new THREE.MeshBasicMaterial({ 
        color: 0xcc66ff 
      });
      const particle = new THREE.Mesh(particleGeo, particleMat);
      const angle = (i / 8) * Math.PI * 2;
      particle.position.set(Math.cos(angle) * 0.5, 0.15, Math.sin(angle) * 0.5);
      group.add(particle);
    }
    
    // Add light
    const portalLight = new THREE.PointLight(0x9900ff, 1.5, 4);
    portalLight.position.y = 0.3;
    group.add(portalLight);
  }
  
  _createBearTrap(group) {
    // Metal base
    const baseGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 8);
    const baseMat = new THREE.MeshStandardMaterial({ 
      color: 0x555555,
      metalness: 0.9,
      roughness: 0.2
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.05;
    group.add(base);
    
    // Jaw teeth (left and right)
    const toothMat = new THREE.MeshStandardMaterial({ 
      color: 0x444444,
      metalness: 0.95,
      roughness: 0.1
    });
    
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 5; i++) {
        const toothGeo = new THREE.ConeGeometry(0.04, 0.2, 4);
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        const xPos = side * 0.25;
        const zPos = -0.2 + i * 0.1;
        tooth.position.set(xPos, 0.15, zPos);
        tooth.rotation.z = side * Math.PI / 6; // Tilt inward
        group.add(tooth);
      }
    }
    
    // Trigger plate in center
    const triggerGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.05, 8);
    const triggerMat = new THREE.MeshStandardMaterial({ 
      color: 0x884400,
      metalness: 0.5,
      roughness: 0.3
    });
    const trigger = new THREE.Mesh(triggerGeo, triggerMat);
    trigger.position.y = 0.12;
    group.add(trigger);
  }
  
  _createConfusionTrap(group) {
    // Hypnotic spiral pattern
    const spiralMat = new THREE.MeshBasicMaterial({ 
      color: 0xffff00,
      transparent: true,
      opacity: 0.8
    });
    
    // Create spiral rings
    for (let i = 0; i < 4; i++) {
      const ringGeo = new THREE.TorusGeometry(0.2 + i * 0.2, 0.05, 4, 24);
      const ring = new THREE.Mesh(ringGeo, i % 2 === 0 ? spiralMat : 
        new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.8 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.05 + i * 0.03;
      group.add(ring);
    }
    
    // Center eye
    const eyeGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const eyeMat = new THREE.MeshBasicMaterial({ 
      color: 0xff0088 
    });
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.y = 0.15;
    group.add(eye);
    
    // Pupil
    const pupilGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(0, 0.22, 0);
    group.add(pupil);
    
    // Add pulsing light
    const confuseLight = new THREE.PointLight(0xff00ff, 1, 4);
    confuseLight.position.y = 0.3;
    group.add(confuseLight);
  }
  
  _checkTrapCollisions() {
    if (!this.player || !this.traps || this._isDying) return;
    
    const playerPos = this.player.getPosition();
    
    for (const trap of this.traps) {
      if (trap.triggered) continue;
      
      const dist = Math.sqrt(
        (playerPos.x - trap.position.x) ** 2 + 
        (playerPos.z - trap.position.z) ** 2
      );
      
      if (dist < trap.radius) {
        trap.triggered = true;
        
        // Apply trap-specific effects
        this._applyTrapEffect(trap);
        
        break; // Only process one trap at a time
      }
    }
  }
  
  _applyTrapEffect(trap) {
    const trapType = trap.type || 'spike';
    console.log(`Player hit ${trapType} trap!`);
    
    switch (trapType) {
      case 'spike':
      case 'pit':
        // Instant damage traps - cause death
        window.dispatchEvent(new CustomEvent('ghostAttack', { detail: { type: 'trap', trapType } }));
        // Reset trap after 10 seconds
        setTimeout(() => { trap.triggered = false; }, 10000);
        break;
        
      case 'poison':
        // Poison trap - green screen effect and damage over time
        this._showPoisonEffect();
        this.audioManager.playDamage?.();
        // Slowed movement for 5 seconds
        if (this.player) {
          const originalSpeed = this.player.config.speed;
          this.player.config.speed = originalSpeed * 0.5;
          setTimeout(() => {
            if (this.player) this.player.config.speed = originalSpeed;
          }, 5000);
        }
        // Damage after delay
        setTimeout(() => {
          if (!this._isDying) {
            window.dispatchEvent(new CustomEvent('ghostAttack', { detail: { type: 'trap', trapType: 'poison' } }));
          }
        }, 1500);
        setTimeout(() => { trap.triggered = false; }, 15000);
        break;
        
      case 'web':
        // Web trap - slows player significantly for 8 seconds
        this._showWebEffect();
        if (this.player) {
          const originalSpeed = this.player.config.speed;
          const originalSprint = this.player.config.sprintMultiplier;
          this.player.config.speed = originalSpeed * 0.3;
          this.player.config.sprintMultiplier = 1.0; // Can't sprint in web
          
          console.log('Player caught in web! Movement slowed.');
          
          setTimeout(() => {
            if (this.player) {
              this.player.config.speed = originalSpeed;
              this.player.config.sprintMultiplier = originalSprint;
              console.log('Player broke free from web!');
            }
          }, 8000);
        }
        setTimeout(() => { trap.triggered = false; }, 20000);
        break;
        
      case 'shadow':
        // Shadow trap - disables flashlight for 10 seconds
        this._showShadowEffect();
        if (this.flashlight) {
          const wasOn = this.flashlight.visible;
          this.flashlight.visible = false;
          
          console.log('Shadow trap disabled flashlight!');
          
          setTimeout(() => {
            if (this.flashlight && wasOn) {
              this.flashlight.visible = true;
              console.log('Flashlight recovered!');
            }
          }, 10000);
        }
        setTimeout(() => { trap.triggered = false; }, 25000);
        break;
        
      case 'fire':
        // Fire trap - burning damage over time
        this._showFireEffect();
        this.audioManager.playDamage?.();
        console.log('Player stepped in fire!');
        
        // Burn damage: 3 ticks over 3 seconds
        let burnTicks = 0;
        const burnInterval = setInterval(() => {
          burnTicks++;
          if (burnTicks >= 3 || this._isDying) {
            clearInterval(burnInterval);
            return;
          }
          // Small damage tick (visual effect only, no death)
          this._showFireEffect();
        }, 1000);
        
        // Final burn causes death if still alive
        setTimeout(() => {
          if (!this._isDying) {
            window.dispatchEvent(new CustomEvent('ghostAttack', { detail: { type: 'trap', trapType: 'fire' } }));
          }
        }, 2500);
        setTimeout(() => { trap.triggered = false; }, 12000);
        break;
        
      case 'ice':
        // Ice trap - freezes player and slows for 6 seconds
        this._showIceEffect();
        console.log('Player frozen by ice trap!');
        
        if (this.player) {
          const originalSpeed = this.player.config.speed;
          const originalSprint = this.player.config.sprintMultiplier;
          
          // Complete freeze for 1.5 seconds
          this.player.config.speed = 0;
          this.player.config.sprintMultiplier = 1.0;
          
          setTimeout(() => {
            // Then slow movement for remaining time
            if (this.player) {
              this.player.config.speed = originalSpeed * 0.4;
            }
          }, 1500);
          
          setTimeout(() => {
            if (this.player) {
              this.player.config.speed = originalSpeed;
              this.player.config.sprintMultiplier = originalSprint;
              console.log('Ice thawed!');
            }
          }, 6000);
        }
        setTimeout(() => { trap.triggered = false; }, 18000);
        break;
        
      case 'teleport':
        // Teleport trap - sends player to random location
        this._showTeleportEffect();
        console.log('Player teleported!');
        
        if (this.player && this.mazeGenerator) {
          const randomPos = this.mazeGenerator.getRandomOpenCell();
          if (randomPos) {
            // Teleport player
            this.player.body.position.set(randomPos.x, 2, randomPos.z);
            this.player.body.velocity.set(0, 0, 0);
          }
        }
        setTimeout(() => { trap.triggered = false; }, 30000);
        break;
        
      case 'bear':
        // Bear trap - immobilizes player completely for 3 seconds
        this._showBearEffect();
        this.audioManager.playDamage?.();
        console.log('Player caught in bear trap!');
        
        if (this.player) {
          const originalSpeed = this.player.config.speed;
          this.player.config.speed = 0; // Can't move at all
          
          setTimeout(() => {
            if (this.player) {
              this.player.config.speed = originalSpeed;
              console.log('Player escaped bear trap!');
            }
          }, 3000);
        }
        
        // Small damage chance
        if (Math.random() < 0.3) {
          setTimeout(() => {
            if (!this._isDying) {
              window.dispatchEvent(new CustomEvent('ghostAttack', { detail: { type: 'trap', trapType: 'bear' } }));
            }
          }, 2000);
        }
        setTimeout(() => { trap.triggered = false; }, 15000);
        break;
        
      case 'confusion':
        // Confusion trap - inverts player controls for 8 seconds
        this._showConfusionEffect();
        console.log('Player confused! Controls inverted!');
        
        if (this.player) {
          this.player.controlsInverted = true;
          
          setTimeout(() => {
            if (this.player) {
              this.player.controlsInverted = false;
              console.log('Confusion wore off!');
            }
          }, 8000);
        }
        setTimeout(() => { trap.triggered = false; }, 20000);
        break;
        
      default:
        // Default to damage
        window.dispatchEvent(new CustomEvent('ghostAttack', { detail: { type: 'trap' } }));
        setTimeout(() => { trap.triggered = false; }, 10000);
    }
  }
  
  _showPoisonEffect() {
    // Green screen overlay effect
    const overlay = document.createElement('div');
    overlay.id = 'poison-effect';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 80, 0, 0.4);
      pointer-events: none;
      z-index: 999;
      animation: poisonPulse 0.5s ease-in-out 3;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes poisonPulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 0.7; }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 1500);
  }
  
  _showWebEffect() {
    // White thread overlay effect
    const overlay = document.createElement('div');
    overlay.id = 'web-effect';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle, transparent 30%, rgba(255, 255, 255, 0.1) 70%);
      border: 3px solid rgba(255, 255, 255, 0.3);
      pointer-events: none;
      z-index: 999;
    `;
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      overlay.remove();
    }, 8000);
  }
  
  _showShadowEffect() {
    // Dark purple flash effect
    const overlay = document.createElement('div');
    overlay.id = 'shadow-effect';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(30, 0, 50, 0.6);
      pointer-events: none;
      z-index: 999;
      animation: shadowFlash 0.3s ease-out;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes shadowFlash {
        0% { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 300);
  }
  
  _showFireEffect() {
    // Red/orange burning screen effect
    const overlay = document.createElement('div');
    overlay.id = 'fire-effect';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle, rgba(255, 100, 0, 0.5) 0%, rgba(255, 50, 0, 0.3) 100%);
      pointer-events: none;
      z-index: 999;
      animation: firePulse 0.3s ease-in-out 2;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes firePulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 0.9; }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 600);
  }
  
  _showIceEffect() {
    // Cyan freeze screen effect
    const overlay = document.createElement('div');
    overlay.id = 'ice-effect';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle, rgba(100, 200, 255, 0.6) 0%, rgba(50, 150, 255, 0.3) 100%);
      border: 8px solid rgba(200, 230, 255, 0.8);
      pointer-events: none;
      z-index: 999;
      animation: iceFreeze 0.5s ease-out;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes iceFreeze {
        0% { opacity: 0; transform: scale(1.2); }
        100% { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 6000);
  }
  
  _showTeleportEffect() {
    // Purple swirl teleport effect
    const overlay = document.createElement('div');
    overlay.id = 'teleport-effect';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle, rgba(150, 0, 255, 0.9) 0%, rgba(100, 0, 200, 0.6) 50%, transparent 100%);
      pointer-events: none;
      z-index: 999;
      animation: teleportSwirl 0.5s ease-in-out;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes teleportSwirl {
        0% { opacity: 0; transform: scale(0.5) rotate(0deg); }
        50% { opacity: 1; transform: scale(1.5) rotate(180deg); }
        100% { opacity: 0; transform: scale(2) rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 500);
  }
  
  _showBearEffect() {
    // Metal clamp flash effect
    const overlay = document.createElement('div');
    overlay.id = 'bear-effect';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(80, 60, 50, 0.6);
      border: 10px solid rgba(100, 100, 100, 0.8);
      pointer-events: none;
      z-index: 999;
      animation: bearClamp 0.2s ease-out 2;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes bearClamp {
        0% { transform: scale(1); }
        50% { transform: scale(0.95); border-color: rgba(200, 50, 50, 0.9); }
        100% { transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 400);
  }
  
  _showConfusionEffect() {
    // Rainbow spinning confusion effect
    const overlay = document.createElement('div');
    overlay.id = 'confusion-effect';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: conic-gradient(
        from 0deg,
        rgba(255, 0, 0, 0.3),
        rgba(255, 255, 0, 0.3),
        rgba(0, 255, 0, 0.3),
        rgba(0, 255, 255, 0.3),
        rgba(0, 0, 255, 0.3),
        rgba(255, 0, 255, 0.3),
        rgba(255, 0, 0, 0.3)
      );
      pointer-events: none;
      z-index: 999;
      animation: confusionSpin 3s linear infinite;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes confusionSpin {
        0% { transform: rotate(0deg); opacity: 0.4; }
        50% { opacity: 0.6; }
        100% { transform: rotate(360deg); opacity: 0.4; }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 8000);
  }
  
  startDebugRoom() {
    console.log('Entering Debug Room...');
    
    // Clear ghosts
    this._clearGhosts();
    
    // Generate open room
    this.mazeGenerator.generateOpenRoom(50, 50).then(async () => {
        // Init Debug Panel (Lazy load)
        if (!this.debugPanel) {
           const { DebugPanel } = await import('./DebugPanel.js');
           this.debugPanel = new DebugPanel(this);
        }

        // Enable Physics Debugger (Re-init to be sure)
        if (!this.cannonDebugger) {
           this.cannonDebugger = new CannonDebugger(this.scene, this.world, {
             color: 0x00ff00,
             scale: 1.0,
           });
        }
        this.debugPhysics = true;
        
        // Disable dynamic spawning
        this.maxGhosts = 1; // Only the passive one
        
        // Reset player
        if (this.player) {
           // Center of 50x50 room (cellSize 4) -> 25*4 = 100 -> center is 100, 100
           // Start somewhat near center
           const centerX = 25 * 4;
           const centerZ = 25 * 4;
           this.player.resetToStart(new CANNON.Vec3(centerX, 2, centerZ));
        }
        
        // Lighting - Bright Mode
        this.scene.fog = new THREE.FogExp2(0xaaaaaa, 0.002); // Very light fog
        this.ambientLight.intensity = 1.5;
        this.dirLight.intensity = 1.0;
        
        // Spawn Passive Ghost in front of player
        // Player is at (centerX, centerZ) facing ? 
        // Let's spawn ghost at Z-5
        const ghostX = 25 * 4; 
        const ghostZ = 25 * 4 - 5;
        
        const g = new Ghost(this.scene, this.world, this.player, this.mazeGenerator);
        g.body.position.set(ghostX, 1.2, ghostZ);
        g.mesh.position.set(ghostX, 1.2, ghostZ);
        g.setPassive(true); // Ensure ghost is passive
        
        // Debug Mode Settings
        this.player.isInvincible = true; // God mode ON
        if (this.debugPanel) {
            // Update GUI if it exists
            // This is tricky as GUI might not be synced, but the value is what matters
        }
        
        this.ghosts.push(g);
        
        console.log('Debug Room Ready: 50x50 Open, Full Light, Passive Monster');
        
        // If multiplayer, broadcast this "stage" as special debug stage?
        // Or just let them sync the maze geometry if we implemented that (we didn't, we only synced seed)
        // Since we only sync SEED, clients won't see the open room unless we send a special event.
        if (this.isMultiplayer && this.multiplayerManager && this.multiplayerManager.isHost) {
           this.multiplayerManager.sendGameEvent('debugRoom', { width: 50, height: 50 });
        }
    });
  }
  
  _handleMultiplayerEvent(event, data) {
    console.log('Received multiplayer event:', event, data);
    
    switch (event) {
      case 'stageStart':
        if (data.stage && data.stage !== this.currentStage) {
          console.log('Syncing stage from host:', data.stage);
          // Directly call startStage (but avoid re-broadcasting via isHost check)
          // We need to bypass the "isHost" check in startStage or trust the recursion breaker
          // Actually, startStage checks isHost before broadcasting, so as a Client we won't loop.
          this.startStage(data.stage);
        }
        break;
        
      case 'gameState':
         // Handled in MultiplayerManager usually, but we might need to react if full state sent
         break;
         
      case 'debugRoom':
         console.log('Host entered debug room');
         this.startDebugRoom();
         break;
    }
  }

  _clearGhosts() {
    if (!this.ghosts) return;
    for (const g of this.ghosts) {
      if (g && g.body) this.world.removeBody(g.body);
      if (g && g.mesh) this.scene.remove(g.mesh);
    }
    this.ghosts = [];
  }

  _showWinMessage() {
    this.timerRunning = false;
    
    // Hide touch controls if active
    const touchControls = document.getElementById('touch-controls');
    if (touchControls) touchControls.classList.add('hidden');

    // Create Victory Overlay
    const winContainer = document.createElement('div');
    winContainer.id = 'victory-screen';
    winContainer.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #fff;
        z-index: 12000; /* Above everything */
        font-family: 'Courier New', monospace;
        opacity: 0;
        transition: opacity 1s ease-in;
    `;
    
    const title = document.createElement('h1');
    title.textContent = 'YOU SURVIVED';
    title.style.cssText = `
        font-size: clamp(2rem, 8vw, 4rem);
        color: #4CAF50;
        text-shadow: 0 0 20px rgba(76, 175, 80, 0.5);
        margin-bottom: 20px;
        text-align: center;
    `;
    
    const message = document.createElement('p');
    message.textContent = 'The nightmare is over... for now.';
    message.style.cssText = `
        font-size: clamp(1rem, 4vw, 1.5rem);
        color: #ccc;
        margin-bottom: 40px;
        text-align: center;
    `;
    
    const restartBtn = document.createElement('button');
    restartBtn.textContent = 'PLAY AGAIN';
    restartBtn.style.cssText = `
        padding: 15px 40px;
        font-size: 1.2rem;
        background: transparent;
        border: 2px solid #4CAF50;
        color: #4CAF50;
        cursor: pointer;
        transition: all 0.3s;
        border-radius: 5px;
        text-transform: uppercase;
        letter-spacing: 2px;
    `;
    
    // Mobile touch support for button
    const highlight = () => { restartBtn.style.background = '#4CAF50'; restartBtn.style.color = '#000'; };
    const reset = () => { restartBtn.style.background = 'transparent'; restartBtn.style.color = '#4CAF50'; };
    
    restartBtn.onmouseover = highlight;
    restartBtn.onmouseout = reset;
    restartBtn.ontouchstart = highlight;
    restartBtn.ontouchend = reset;
    
    restartBtn.onclick = () => {
        window.location.reload();
    };
    
    winContainer.appendChild(title);
    winContainer.appendChild(message);
    winContainer.appendChild(restartBtn);
    document.body.appendChild(winContainer);
    
    // Fade in
    requestAnimationFrame(() => winContainer.style.opacity = '1');
  }

  _initCatchOverlay() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.background = 'rgba(255,0,0,0)';
    overlay.style.transition = 'background 200ms ease';
    overlay.style.zIndex = '2000';
    document.body.appendChild(overlay);
    this._catchOverlay = overlay;
    
    // Death message element
    const deathMessage = document.createElement('div');
    deathMessage.style.position = 'fixed';
    deathMessage.style.top = '50%';
    deathMessage.style.left = '50%';
    deathMessage.style.transform = 'translate(-50%, -50%)';
    deathMessage.style.color = '#ff0000';
    deathMessage.style.fontSize = '72px';
    deathMessage.style.fontFamily = 'sans-serif';
    deathMessage.style.fontWeight = 'bold';
    deathMessage.style.textShadow = '0 0 20px rgba(255,0,0,0.8), 0 0 40px rgba(255,0,0,0.5)';
    deathMessage.style.opacity = '0';
    deathMessage.style.transition = 'opacity 0.3s ease';
    deathMessage.style.zIndex = '2001';
    deathMessage.style.pointerEvents = 'none';
    deathMessage.textContent = 'YOU DIED';
    document.body.appendChild(deathMessage);
    this._deathMessage = deathMessage;
    
    // Listen for ghost attack events
    window.addEventListener('ghostAttack', (e) => this._onGhostAttack(e));
  }
  
  _onGhostAttack(event) {
    if (this._isDying) return; // Prevent multiple deaths
    this._isDying = true;
    
    // Deduct a life
    this.lives--;
    console.log('Death! Lives remaining:', this.lives);
    this._updateLivesUI();
    
    // Play death sounds
    this.audioManager.stopHeartbeat();
    this.audioManager.playImpact();
    // Pass gender for specific scream
    this.audioManager.playDeathScream(this.characterType);
    
    // Show death overlay
    if (this._catchOverlay) {
      this._catchOverlay.style.transition = 'background 0.5s ease';
      this._catchOverlay.style.background = 'rgba(100,0,0,0.8)';
    }
    
    // Show death message
    if (this._deathMessage) {
      this._deathMessage.textContent = this.lives > 0 
        ? `YOU DIED - ${this.lives} ${this.lives === 1 ? 'LIFE' : 'LIVES'} LEFT` 
        : 'GAME OVER';
      this._deathMessage.style.opacity = '1';
    }
    
    // Freeze player movement (if possible)
    if (this.player) {
      this.player.body.velocity.set(0, 0, 0);
    }
    
    // Wait 3 seconds then respawn or game over
    setTimeout(() => {
      // Fade out death effects
      if (this._catchOverlay) {
        this._catchOverlay.style.transition = 'background 0.5s ease';
        this._catchOverlay.style.background = 'rgba(255,0,0,0)';
      }
      if (this._deathMessage) {
        this._deathMessage.style.opacity = '0';
      }
      
      if (this.lives <= 0) {
        // Game over - return to menu
        console.log('GAME OVER - No lives remaining');
        if (window.menuManager) {
          window.menuManager.showGameOver();
        } else {
          setTimeout(() => location.reload(), 1000);
        }
      } else {
        // MAZE REGENERATION: Restart the current stage to generate new layout
        console.log('Life lost! Regenerating maze...');
        this.startStage(this.currentStage);
      }
      
      this._isDying = false;
    }, 3000);
  }
  
  _updateLivesUI() {
    if (!this._livesDisplay) {
      // Create lives UI if it doesn't exist
      this._livesDisplay = document.createElement('div');
      const isMobile = window.innerWidth < 768;
      this._livesDisplay.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        color: #ff4444;
        font-size: ${isMobile ? '18px' : '24px'};
        font-family: 'Arial', sans-serif;
        font-weight: bold;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
        z-index: 1000;
        pointer-events: none;
      `;
      document.body.appendChild(this._livesDisplay);
    }
    
    // Show hearts for lives
    const hearts = '❤️'.repeat(this.lives) + '🖤'.repeat(this.maxLives - this.lives);
    this._livesDisplay.textContent = hearts;
  }

  // Cleanup method to prevent WebGL context leaks
  dispose() {
      // Stop loop
      if (this.animationId) {
          cancelAnimationFrame(this.animationId);
          this.animationId = null;
      }
      
      // Dispose Renderer
      if (this.renderer) {
          this.renderer.dispose();
          this.renderer.forceContextLoss();
          this.renderer.domElement.remove();
          this.renderer = null;
      }
      
      // Dispose Scene
      if (this.scene) {
          this.scene.traverse((object) => {
              if (object.geometry) object.geometry.dispose();
              if (object.material) {
                  if (Array.isArray(object.material)) {
                      object.material.forEach(m => m.dispose());
                  } else {
                      object.material.dispose();
                  }
              }
          });
          this.scene = null;
      }
      
      // Dispose Controls
      if (this.controls) {
          this.controls.dispose(); // PointerLockControls dispose
      }
      
      // Dispose Debuggers
      if (this.cannonDebugger) {
          // Cannon debugger doesn't have a standardized dispose, but we can null it
          this.cannonDebugger = null;
      }
      if (this.debugPanel) {
          this.debugPanel.dispose();
          this.debugPanel = null;
      }
      
      // Clean up event listeners
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
  }
  
  destroy() {
    this.dispose();
  }

  _setupEventListeners() {
    // Handle window resize
    // Handle window resize
    this.onWindowResize = () => {
      this.sizes.width = window.innerWidth;
      this.sizes.height = window.innerHeight;

      this.camera.aspect = this.sizes.width / this.sizes.height;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(this.sizes.width, this.sizes.height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };

    window.addEventListener('resize', this.onWindowResize);
    
    // PWA: Force resize on resume (handles address bar toggle)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        setTimeout(this.onWindowResize, 100);
      }
    });
    
    // FULLSCREEN SUPPORT with LANDSCAPE LOCK
    this.toggleFullscreen = async () => {
      if (!document.fullscreenElement && 
          !document.webkitFullscreenElement && 
          !document.mozFullScreenElement) {
        // Enter fullscreen
        const elem = document.documentElement;
        try {
          if (elem.requestFullscreen) {
            await elem.requestFullscreen();
          } else if (elem.webkitRequestFullscreen) {
            await elem.webkitRequestFullscreen();
          } else if (elem.mozRequestFullScreen) {
            await elem.mozRequestFullScreen();
          }
          
          // LOCK ORIENTATION TO LANDSCAPE after entering fullscreen
          if (screen.orientation && screen.orientation.lock) {
            try {
              await screen.orientation.lock('landscape');
              console.log('Screen orientation locked to landscape');
              // Hide portrait warning since we auto-rotate
              const portraitWarning = document.getElementById('portrait-warning');
              if (portraitWarning) portraitWarning.style.display = 'none';
            } catch (e) {
              console.log('Could not lock orientation:', e.message);
            }
          }
        } catch (e) {
          console.log('Fullscreen request failed:', e);
        }
      } else {
        // Exit fullscreen - unlock orientation
        try {
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
        } catch (e) {}
        
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        }
      }
    };
    
    // Handle fullscreen change to update renderer and manage orientation
    const onFullscreenChange = () => {
      setTimeout(this.onWindowResize, 100);
      
      // Hide portrait warning when in fullscreen (orientation should be locked)
      const portraitWarning = document.getElementById('portrait-warning');
      if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement) {
        if (portraitWarning) portraitWarning.style.display = 'none';
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    document.addEventListener('mozfullscreenchange', onFullscreenChange);
    
    // Double-tap/double-click to toggle fullscreen
    let lastTapTime = 0;
    document.addEventListener('dblclick', (e) => {
      const now = Date.now();
      if (now - lastTapTime < 600) {
        this.toggleFullscreen();
      }
      lastTapTime = now;
    });
    
    // Listen for fullscreen toggle from touch button
    window.addEventListener('toggleFullscreen', () => {
      this.toggleFullscreen();
    });

    // Debug info toggle
    let showDebug = false;
    const debugDiv = document.createElement('div');
    debugDiv.style.position = 'fixed';
    debugDiv.style.top = '10px';
    debugDiv.style.left = '10px';
    debugDiv.style.color = 'white';
    debugDiv.style.fontFamily = 'monospace';
    debugDiv.style.fontSize = '12px';
    debugDiv.style.backgroundColor = 'rgba(0,0,0,0.5)';
    debugDiv.style.padding = '10px';
    debugDiv.style.display = 'none';
    debugDiv.style.zIndex = '1000';
    document.body.appendChild(debugDiv);
    this.debugDiv = debugDiv;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF') {
        showDebug = !showDebug;
        debugDiv.style.display = showDebug ? 'block' : 'none';
      }
      
      // Toggle minimap
      if (e.code === 'KeyM') {
        this.minimap.toggleVisibility();
      }
      
      // Debug Room Shortcut
      if (e.code === 'KeyK') { // K for "Kill/Debug"
         this.startDebugRoom();
      }

      // Pointer Lock Toggle
      if (e.code === 'KeyP') {
        if (this.controls.isLocked) {
          this.controls.unlock();
          console.log('[Controls] Pointer Lock OFF');
        } else {
          this.controls.lock();
          console.log('[Controls] Pointer Lock ON');
        }
      }
    });


    // Desktop instructions removed - not needed for mobile-first app
  }

  _updateDebugInfo() {
    if (this.debugDiv && this.debugDiv.style.display === 'block') {
      if (!this.player) {
        this.debugDiv.innerHTML = `
          <div>FPS: ${Math.round(1 / this.deltaTime)}</div>
          <div>Loading game...</div>
        `;
        return;
      }
      
      const pos = this.player.getPosition();
      const vel = this.player.getVelocity();
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      const groundInfo = this.player.getGroundDetectionInfo();
      
      this.debugDiv.innerHTML = `
        <div>FPS: ${Math.round(1 / this.deltaTime)}</div>
        <div>Position: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}</div>
        <div>Velocity: ${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)}</div>
        <div>Speed: ${speed.toFixed(2)} m/s</div>
        <div>Grounded: ${this.player.grounded ? 'Yes' : 'No'}</div>
        <div>Ground Timer: ${groundInfo.groundCheckTimer.toFixed(3)}s</div>
        <div>Bottom Y: ${groundInfo.bottomY.toFixed(2)}</div>
        <div>Jump State: ${groundInfo.jumpedThisPress ? 'Used' : 'Available'}</div>
        <div>Jump Cooldown: ${groundInfo.jumpCooldown.toFixed(2)}s</div>
        <div>Physics Bodies: ${groundInfo.worldBodies}</div>
        <div>Sprinting: ${this.player.isSprinting ? 'Yes' : 'No'}</div>
        <div>Camera Mode: ${this.player.firstPerson ? 'First Person' : 'Third Person'}</div>
        <div>Mouse Locked: ${this.player.mouse.enabled ? 'Yes' : 'No'}</div>
        <div style="margin-top: 10px; font-size: 10px; color: #888;">
          Press G to toggle ground detection debug | Press P to debug physics world
        </div>
      `;
    }
  }

  _animate() {
    const currentTime = this.clock.getElapsedTime();
    this.deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Cap delta time to prevent physics explosions
    const dt = Math.min(this.deltaTime, 1 / 30);

    // Update physics with fixed timestep
    this.world.step(1 / 60, dt, 3);

    // Update dynamic lights with flickering effect
    this._updateDynamicLights(currentTime);

    // Update physics
    this.world.step(1 / 60, dt, 3);
    
    // Update Debuggers
    if (this.debugPhysics && this.cannonDebugger) {
       this.cannonDebugger.update();
    }
    
    // Update player flashlight
    this._updatePlayerFlashlight();

    // Update player if it exists
    if (this.player) {
      this.player.update(dt, currentTime);

      // TOUCH CONTROLS UPDATE
      if (this.touchControls) {
        // Sync movement
        const move = this.touchControls.getMovement();
        this.player.touchInput.moveForward = move.forward;
        this.player.touchInput.moveRight = move.right;
        
        // Sync buttons
        const buttons = this.touchControls.getButtons();
        this.player.touchInput.sprint = buttons.sprint;
        this.player.touchInput.jump = buttons.jump;
        
        // Sync flashlight (toggle)
        if (this.player.isFlashlightOn !== buttons.flashlight) {
             this.player.toggleFlashlight(); 
        }

        // Sync look
        const look = this.touchControls.consumeLookDelta();
        if (look.x !== 0 || look.y !== 0) {
            this.player.touchInput.lookDeltaX = look.x;
            this.player.touchInput.lookDeltaY = look.y;
            // Apply directly to camera for responsiveness
            this.player.cameraYaw -= look.x * 0.005; // Scaling factor
            this.player.cameraPitch -= look.y * 0.005;
            this.player.cameraPitch = THREE.MathUtils.clamp(
                this.player.cameraPitch,
                THREE.MathUtils.degToRad(10),
                THREE.MathUtils.degToRad(85)
            );
            // Enable touch usage flag
            this.player.useTouchControls = true;
        } else if (Math.abs(move.forward) > 0.01 || Math.abs(move.right) > 0.01) {
             this.player.useTouchControls = true;
        }
      }

      // Update minimap with player position if it exists
      if (this.minimap) {
        const playerPos = this.player.getPosition();
        this.minimap.updatePlayerPosition(playerPos.x, playerPos.z, this.player.mesh.rotation.y);

        // Update ghosts and collect positions for minimap
        const ghostPositions = [];
        if (this.ghosts && !this.ghostsFrozen) {
          let nearest = Infinity;
          for (const g of this.ghosts) {
            g.update(dt);
            
            // Collect ghost positions for minimap
            if (g.body && g.body.position) {
              ghostPositions.push({
                x: g.body.position.x,
                z: g.body.position.z
              });
            }
            
            const dx = g.body.position.x - playerPos.x;
            const dz = g.body.position.z - playerPos.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < nearest) nearest = d;
          }
          
          // Update minimap with ghost positions
          this.minimap.updateGhostPositions(ghostPositions);
          
          // Audio: Heartbeat based on ghost proximity
          if (nearest < 20) {
            this.audioManager.startHeartbeat();
            this.audioManager.updateHeartbeatIntensity(nearest);
          } else {
            this.audioManager.stopHeartbeat();
          }
          
          this._ghostLogTimer -= dt;
          if (this._ghostLogTimer <= 0 && nearest < Infinity) {
            console.log(`[Ghost] Nearest distance to player: ${nearest.toFixed(2)}m`);
            this._ghostLogTimer = 1.0;
          }
        } else if (this.ghosts && this.ghostsFrozen) {
          // Still show ghost positions even when frozen
          for (const g of this.ghosts) {
            if (g.body && g.body.position) {
              ghostPositions.push({
                x: g.body.position.x,
                z: g.body.position.z
              });
            }
          }
          this.minimap.updateGhostPositions(ghostPositions);
        }

        // Player-Ghost collision detection
        // Note: Killing is now handled via the 'ghostAttack' event from Ghost.js
        // responding to actual attack hits. This loop just monitors proximity.
        if (this.ghosts && !this.ghostsFrozen) {
           // Optional: Just for debugging proximity
        }
        
        // Check trap collisions
        this._checkTrapCollisions();

        // Stage progression: detect end marker reach
        if (this.mazeGenerator) {
          const playerPos = this.player.getPosition();
          const endPos = this.mazeGenerator.getEndPosition();
          const ex = endPos.x - playerPos.x;
          const ez = endPos.z - playerPos.z;
          if (Math.sqrt(ex * ex + ez * ez) < 1) {
            if (this.currentStage < 3) {
              this.startStage(this.currentStage + 1);
            } else if (!this.ghostsFrozen) {
              this.ghostsFrozen = true;
              this._showWinMessage();
            }
          }
        }
      }

      // Update debug info
      this._updateDebugInfo();
    }
    
    // Update remote players from multiplayer data
    this._updateRemotePlayers(dt);
    
    // Timer Logic
  if (this.timerRunning && this.lives > 0 && !this.ghostsFrozen) {
    this.stageTimer -= dt;
    if (this.stageTimer <= 0) {
      this.stageTimer = 0;
      this.timerRunning = false;
      this._updateTimerUI(); // Show 00:00
      
      // Timer ran out in stage 1 or 2 - INSTANT GAME OVER (no lives given)
      if (this.currentStage === 1 || this.currentStage === 2) {
        console.log('Time ran out in Stage ' + this.currentStage + '! GAME OVER - No second chances.');
        this.lives = 0; // Force all lives to 0
        this._updateLivesUI();
        
        // Show game over
        if (window.menuManager && window.menuManager.showGameOver) {
          window.menuManager.showGameOver();
        } else {
          setTimeout(() => location.reload(), 2000);
        }
      } else {
        // Stage 3 or other - use normal death logic (shouldn't happen, stage 3 is survival)
        console.log('Time ran out! Player eliminated.');
        this._onGhostAttack({ type: 'timeout' });
      }
    } else {
      // Update UI every second to avoid DOM thrashing
      if (Math.floor(this.stageTimer) !== Math.floor(this.stageTimer + dt)) {
        this._updateTimerUI();
      }
    }
  }

    this.ghostSpawnTimer += dt;
    /* 
    if (this.ghostSpawnTimer > this.ghostSpawnInterval && this.ghosts.length < this.maxGhosts && !this.ghostsFrozen && this.mazeGenerator && !this.debugPhysics) {
      this.ghostSpawnTimer = 0;
      this._maybeSpawnGhost();
    }
    */

    // Render
    this.renderer.render(this.scene, this.camera);

    // Continue animation loop
    requestAnimationFrame(() => this._animate());

    // FPS Limiter Logic
    const now = performance.now();
    const elapsed = now - (this._lastFrameTime || 0);
    const interval = this._targetFrameInterval || (1000 / 60);
    
    // If not enough time has passed (and we are not just starting), skip frame
    if (elapsed < interval && this._lastFrameTime !== 0) return;
    
    // Latch time
    this._lastFrameTime = now - (elapsed % interval);
  }
  
  _updateTimerUI() {
    if (!this._timerDisplay) {
      this._timerDisplay = document.createElement('div');
      const isMobile = window.innerWidth < 768;
      this._timerDisplay.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        color: #ffffff;
        font-size: ${isMobile ? '20px' : '32px'};
        font-family: 'Courier New', monospace;
        font-weight: bold;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
        z-index: 1000;
        pointer-events: none;
      `;
      document.body.appendChild(this._timerDisplay);
    }
    
    if (this.timerRunning) {
      const minutes = Math.floor(this.stageTimer / 60);
      const seconds = Math.floor(this.stageTimer % 60);
      const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      
      // Turn red when low time
      if (this.stageTimer < 30) {
        this._timerDisplay.style.color = '#ff4444';
        this._timerDisplay.classList.add('pulse'); // Assume css pulse animation exists or add it
      } else {
        this._timerDisplay.style.color = '#ffffff';
      }
      
      this._timerDisplay.textContent = `TIME: ${timeStr}`;
    } else if (this.currentStage === 3) {
       this._timerDisplay.textContent = "SURVIVE";
       this._timerDisplay.style.color = '#ff0000';
    } else {
       this._timerDisplay.textContent = "";
    }
  }
  
  _updateStageUI(stage) {
    if (!this._stageDisplay) {
      this._stageDisplay = document.createElement('div');
      const isMobile = window.innerWidth < 768;
      this._stageDisplay.style.cssText = `
        position: fixed;
        top: ${isMobile ? '50px' : '60px'};
        left: 50%;
        transform: translateX(-50%);
        color: #cccccc;
        font-size: ${isMobile ? '16px' : '24px'};
        font-family: 'Arial', sans-serif;
        font-weight: bold;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
        z-index: 1000;
        pointer-events: none;
      `;
      document.body.appendChild(this._stageDisplay);
    }
    this._stageDisplay.textContent = `STAGE ${stage}`;
  }

  _maybeSpawnGhost() {
     // Disabled for now
     return;

    const playerPos = this.player.getPosition();
    const playerDir = this.player.getForwardDirection ? this.player.getForwardDirection() : { x: 1, z: 0 };
    const minDist = 16;
    const maxDist = 40;
    const maxAttempts = 30;
    const mazeData = this.mazeGenerator.getMazeData();
    let bestSpawn = null;
    for(let i=0;i<maxAttempts;i++){
      // FIX: getRandomOpenCell returns WORLD position, not grid cell!
      const spawnPos = this.mazeGenerator.getRandomOpenCell?.();
      if (!spawnPos) continue;
      
      const world = spawnPos; // It is already in world coordinates
      const dx = world.x - playerPos.x;
      const dz = world.z - playerPos.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      // Vector from player to candidate
      if(dist < minDist || dist > maxDist) continue;
      // Check if in LOS (naive: behind playerDir)
      const dot = (dx * playerDir.x + dz * playerDir.z) / (Math.max(0.01, Math.sqrt(dx*dx+dz*dz)));
      if(dot > 0.4) continue; // Spawn only at sides/behind
      // TODO: Advanced: add true LOS check with maze walls
      bestSpawn = world;
      break;
    }
    if (bestSpawn) {
      const g = new Ghost(this.scene, this.world, this.player, this.mazeGenerator);
      g.body.position.set(bestSpawn.x, 1.2, bestSpawn.z);
      g.mesh.position.set(bestSpawn.x, 1.2, bestSpawn.z);
      this.ghosts.push(g);
    }
  }

  _checkStaleGhosts() {
    const playerPos = this.player?.getPosition?.();
    for (let i = 0; i < this.ghosts.length; ++i) {
      const g = this.ghosts[i];
      if (!g || !g.body) continue;
      // If ghost is very far away, hasn't chased for a while, or is stuck, teleport
      const gp = g.body.position;
      const dist = playerPos ? Math.sqrt((gp.x - playerPos.x) **2 + (gp.z - playerPos.z) **2) : 9999;
      if ((dist > 50 || (g.currentState === 'wander' && Math.random() < 0.05))) {
        if (typeof g.respawnRandomly === 'function') {
          g.respawnRandomly();
        } else {
          // fallback: just move
          const world = this.mazeGenerator.getRandomOpenCell?.();
          if (world) {
            g.body.position.set(world.x, 1.2, world.z);
            g.mesh.position.set(world.x, 1.2, world.z);
          }
        }
      }
    }
  }
  
  /**
   * Update remote players from multiplayer network data
   */
  _updateRemotePlayers(dt) {
    // Skip if not in multiplayer or multiplayerManager not ready
    if (!this.multiplayerManager || !this.multiplayerManager.players) return;
    
    const remotePlayers = this.multiplayerManager.getRemotePlayers();
    const currentRemoteIds = new Set();
    
    // Update or create remote players
    for (const playerData of remotePlayers) {
      currentRemoteIds.add(playerData.id);
      
      let remotePlayer = this.remotePlayers.get(playerData.id);
      
      // Create new remote player if doesn't exist
      if (!remotePlayer) {
        console.log('Creating remote player:', playerData.name, playerData.id, 'gender:', playerData.gender);
        remotePlayer = new RemotePlayer(this.scene, playerData.id, playerData.name, playerData.gender || 'male');
        this.remotePlayers.set(playerData.id, remotePlayer);
      }
      
      // Update position from network data
      if (playerData.position) {
        // Check for gender change (e.g. late arrival of metadata)
        if (playerData.gender && remotePlayer.playerGender !== playerData.gender) {
          remotePlayer.setGender(playerData.gender);
        }

        remotePlayer.setNetworkState(
          playerData.position,
          playerData.rotation || 0,
          playerData.animState || 'idle'
        );
        
        // If distance is huge (teleport/initial spawn), snap to position
        const dist = remotePlayer.currentPosition.distanceTo(
          new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z)
        );
        if (dist > 10) {
          remotePlayer.setPosition(playerData.position.x, playerData.position.y, playerData.position.z);
        }
      }
      
      // Update interpolation
      remotePlayer.update(dt);
    }
    
    // Remove disconnected players
    for (const [id, remotePlayer] of this.remotePlayers) {
      if (!currentRemoteIds.has(id)) {
        console.log('Removing disconnected player:', id);
        remotePlayer.dispose();
        this.remotePlayers.delete(id);
      }
    }
  }
}

// Initialize app with menu system
if (!window._mazeGameStarted) {
  window._mazeGameStarted = true;
  
  const initApp = () => {
    // Create scene manager
    const sceneManager = new SceneManager();
    let game = null;
    let touchControls = null;
    
    // Create menu manager with play callback
    const menuManager = new MenuManager((playerProfile) => {
      // Transition to game state with player profile
      sceneManager.setState('game');
    });
    
    // Handle multiplayer button from main menu
    const btnMultiplayer = document.getElementById('btn-multiplayer');
    if (btnMultiplayer) {
      const showMultiplayer = () => {
        // Import and create MultiplayerManager/UI only when needed
        import('./MultiplayerManager.js').then(({ MultiplayerManager }) => {
          import('./MultiplayerUI.js').then(({ MultiplayerUI }) => {
            if (!window._multiplayerManager) {
              window._multiplayerManager = new MultiplayerManager(null);
              window._multiplayerUI = new MultiplayerUI(window._multiplayerManager);
              window._multiplayerUI.onGameStart = (isMultiplayer) => {
                console.log('Multiplayer onGameStart triggered, isMultiplayer:', isMultiplayer);
                
                // Hide all overlays
                document.getElementById('multiplayer-overlay')?.classList.add('hidden');
                document.getElementById('menu-overlay')?.classList.add('hidden');
                document.getElementById('loading-screen')?.classList.remove('hidden');
                
                console.log('Setting sceneManager state to game...');
                sceneManager.setState('game');
              };
            }
            window._multiplayerUI.show();
          });
        });
      };
      
      btnMultiplayer.addEventListener('click', showMultiplayer);
      btnMultiplayer.addEventListener('touchstart', (e) => {
        e.preventDefault();
        showMultiplayer();
      });
      console.log('Multiplayer button initialized');
    }
    
    // Listen for custom event from MultiplayerUI as fallback
    window.addEventListener('startMultiplayerGame', (e) => {
      console.log('startMultiplayerGame event received:', e.detail);
      sceneManager.setState('game');
    });
    
    // Handle game state transition
    sceneManager.on('game', () => {
      if (!game) {
        // Create game instance (this starts the maze generation)
        game = new Game();
        
        // Initialize touch controls for mobile
        touchControls = new TouchControls();
        game.touchControls = touchControls; // Allow access from other components (PauseMenu)
        
        if (touchControls.isMobile()) {
          console.log('Mobile device detected - touch controls enabled');
          
          // Wait for player to be ready, then enable touch controls
          const enableTouchControls = () => {
            if (game.player) {
              game.player.setUseTouchControls(true);
              touchControls.setVisible(true);
              
              // Set up touch control update loop
              const updateTouchControls = () => {
                if (game.player && touchControls.isMobile()) {
                  // Movement
                  const movement = touchControls.getMovement();
                  game.player.setTouchMovement(movement.forward, movement.right);
                  
                  // Look
                  const lookDelta = touchControls.consumeLookDelta();
                  if (lookDelta.x !== 0 || lookDelta.y !== 0) {
                    game.player.applyTouchLook(lookDelta.x, lookDelta.y);
                  }
                  
                  // Buttons
                  const buttons = touchControls.getButtons();
                  game.player.setTouchButtons(buttons.sprint, buttons.jump);
                  
                  // Flashlight toggle
                  if (game.flashlight) {
                    game.flashlight.visible = buttons.flashlight;
                  }
                }
                requestAnimationFrame(updateTouchControls);
              };
              updateTouchControls();
            } else {
              setTimeout(enableTouchControls, 100);
            }
          };
          enableTouchControls();
        }
        
        // Hide loading screen when maze is ready
        setTimeout(() => {
          menuManager.hideLoadingScreen();
        }, 2000);
      }
    });
    
    // Expose for debugging
    window.sceneManager = sceneManager;
    window.menuManager = menuManager;
    window.touchControls = touchControls;
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}