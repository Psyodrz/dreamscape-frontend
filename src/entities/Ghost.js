import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { getAudioManager } from "../systems/AudioManager.js";
import { GhostAI, AIState } from "../systems/GhostAI.js";
import { getAssetLoader } from "../systems/AssetLoader.js";

export class Ghost {
  constructor(
    scene,
    physicsSystem,
    player,
    mazeGenerator,
    spatialAudio = null,
  ) {
    this.scene = scene;
    this.physicsSystem = physicsSystem;
    this.player = player;
    this.mazeGenerator = mazeGenerator;
    this.spatialAudio = spatialAudio;

    this.radius = 0.4; // Reduced to fit corridors (cellSize 4, walls ~0.1 thick)
    this.height = 4.0; // Increased height for larger model

    // AGGRESSIVE chase settings
    this.chaseSpeed = 8.0; // Fast chase speed
    this.wanderSpeed = 4.0; // Active wandering
    this.wanderDir = new THREE.Vector3(1, 0, 0);
    this.wanderTimer = 0;
    this.wanderInterval = { min: 2.0, max: 4.0 };

    this.detectionRadius = 60.0; // Large detection range
    this.chaseRadius = 50.0;
    this.loseSightRadius = 70.0;
    this.currentState = "chase"; // Start in chase mode
    this.lastSeenPlayerPos = null;
    this.searchTimer = 0;
    this.searchDuration = 2.0;

    // Spawn zone protection disabled
    this.spawnZoneRadius = 0.0;
    this.spawnZoneCenter = null;
    this.killCooldown = 0;
    this.hasRecentlyKilled = false;

    // Active immediately
    this.isActive = true;
    this.activationDelay = 0;
    this.spawnTime = 0;

    this.isLowEndDevice = this._detectLowEndDevice();
    this.lastStateChange = 0;
    this.stateChangeCooldown = this.isLowEndDevice ? 500 : 200;
    this.previousState = "dormant";

    // Raycast caching for performance
    this.lastRaycastCheck = 0;
    this.raycastInterval = this.isLowEndDevice ? 0.2 : 0.1;

    this.roamingTarget = null;
    this.roamingTimer = 0;
    this.roamingInterval = { min: 3.0, max: 8.0 };

    this.mazeData = this.mazeGenerator?.getMazeData?.() || null;

    // Animation properties
    this.mixer = null;
    this.animations = {
      idle: null,
      walk: null,
      run: null,
      attack: null,
    };
    this.currentAnimState = "idle";
    this.previousAnimState = "idle";
    this.animationCrossFadeDuration = 0.2; // Faster crossfade to reduce visible transition
    this.modelLoaded = false;

    // GhostAI System - for intelligent maze navigation
    this.ai = null;
    this.useAI = false; // Flag to determine if AI system is active

    // Position tracking to prevent animation root motion from affecting movement
    this._lastKnownPosition = new THREE.Vector3();
    this._positionInitialized = false;

    // Character controller for proper physics-based movement (like Player.js)
    this.characterController = null;

    // Movement tracking for physics feedback loop
    this._lastFramePosition = new THREE.Vector3();
    this._actualVelocity = new THREE.Vector3();
    this._intendedVelocity = new THREE.Vector3();
    this._blockedFrames = 0;
    this._blockedThreshold = 10; // Frames before reporting blockage to AI

    // Attack properties - GUARANTEED KILL
    this.attackRange = 2.0; // Attack range in meters
    this.isAttacking = false;
    this.attackCooldown = 0;
    this.attackDuration = 1.5; // seconds for attack animation
    this.postKillWaitTime = 2.0; // Brief wait after killing

    // Audio state
    this.lastMoanTime = 0;
    this.moanInterval = 8000; // Random moan every 8-15 seconds when nearby
    this.hasPlayedSpotSound = false;

    // Search whisper audio - plays 3D positional audio during SEARCH state
    this.lastSearchWhisperTime = 0;
    this.searchWhisperInterval = 3000; // Whisper every 3 seconds while searching

    // Create placeholder mesh (group to hold the model)
    this.mesh = new THREE.Group();
    this.scene.add(this.mesh);

    // Create fallback sphere (shown until model loads)
    const geo = new THREE.SphereGeometry(this.radius, 24, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      metalness: 0.0,
      roughness: 0.9,
      emissive: 0xffffff,
      emissiveIntensity: 0.05,
    });
    this.fallbackMesh = new THREE.Mesh(geo, mat);
    this.fallbackMesh.castShadow = false;
    this.fallbackMesh.receiveShadow = false;
    this.mesh.add(this.fallbackMesh);

    // Visual alignment - FIXED: Set to 0 to prevent sinking
    // The model's feet position is handled by model.position.y in _loadModel
    this.visualOffset = new THREE.Vector3(0, 0, 0);

    // Create bodyPosition proxy for Rapier compatibility
    // This wraps body.translation()/setTranslation() with CANNON-like .position.x/y/z access
    this._bodyPos = { x: 0, y: 2, z: 0 };
    const ghost = this;
    this.bodyPosition = {
      get x() {
        return ghost._bodyPos.x;
      },
      set x(v) {
        ghost._bodyPos.x = v;
        ghost._syncBodyFromCache();
      },
      get y() {
        return ghost._bodyPos.y;
      },
      set y(v) {
        ghost._bodyPos.y = v;
        ghost._syncBodyFromCache();
      },
      get z() {
        return ghost._bodyPos.z;
      },
      set z(v) {
        ghost._bodyPos.z = v;
        ghost._syncBodyFromCache();
      },
      set(x, y, z) {
        ghost._bodyPos.x = x;
        ghost._bodyPos.y = y;
        ghost._bodyPos.z = z;
        ghost._syncBodyFromCache();
      },
    };

    // Physics body
    this.rebuildPhysics();
    this.isPassive = false;
  }

  /**
   * Initialize the GhostAI system for intelligent maze navigation
   * Call this after maze is generated for A* pathfinding and proper state machine
   * @param {object} mazeData - Maze data from MazeGenerator.getMazeData()
   * @param {object} aiConfig - Optional AI configuration overrides
   */
  initAI(mazeData, aiConfig = {}) {
    if (!mazeData || !mazeData.maze) {
      console.warn("Ghost: Cannot init AI without valid maze data");
      return;
    }

    this.mazeData = mazeData;
    this.ai = new GhostAI(mazeData, {
      patrolSpeed: aiConfig.patrolSpeed || this.wanderSpeed,
      chaseSpeed: aiConfig.chaseSpeed || this.chaseSpeed,
      searchSpeed: aiConfig.searchSpeed || 3.5,
      enragedSpeed: aiConfig.enragedSpeed || 7.5,
      visionRange: aiConfig.visionRange || 12,
      visionConeAngle: aiConfig.visionConeAngle || 140,
      hearingRange: aiConfig.hearingRange || 8,
      physicsSystem: this.physicsSystem, // Pass physics for raycast wall detection
      ...aiConfig,
    });

    // Set initial AI position
    this.ai.setPosition(this.bodyPosition.x, this.bodyPosition.z);
    this.ai.setTarget(this.player);
    this.ai.generatePatrolFromMaze();

    this.useAI = true;
    console.log("Ghost: AI system initialized with pathfinding and physics");
  }

  /**
   * Get AI debug info for debug panel
   */
  getAIDebugInfo() {
    if (this.ai) {
      return this.ai.getDebugInfo();
    }
    return { state: "No AI", info: "AI not initialized" };
  }

  /**
   * Get AI path for debug visualization
   */
  getAIPath() {
    if (this.ai) {
      return this.ai.getDebugPath();
    }
    return [];
  }

  /**
   * DEBUG: Play a specific animation in place (freezes ghost movement)
   * @param {string} animName - Animation name: 'idle', 'walk', 'run', 'attack', 'attack1'
   */
  debugPlayAnimation(animName) {
    // Freeze ghost in place
    this.isPassive = true;
    this.currentState = "debug";

    // Play the requested animation
    if (this.animations[animName]) {
      this._playAnimation(animName);
      console.log(`Ghost DEBUG: Playing '${animName}' animation in place`);
      return true;
    } else {
      console.warn(
        `Ghost DEBUG: Animation '${animName}' not found. Available:`,
        Object.keys(this.animations),
      );
      return false;
    }
  }

  /**
   * DEBUG: Stop animation testing and resume normal behavior
   */
  debugResume() {
    this.isPassive = false;
    this.currentState = "wander";
    this._playAnimation("idle");
    console.log("Ghost DEBUG: Resumed normal behavior");
  }

  /**
   * DEBUG: Get list of available animations
   */
  getAvailableAnimations() {
    return Object.keys(this.animations);
  }

  // Sync cached position to Rapier body
  _syncBodyFromCache() {
    if (this.body) {
      this.body.setTranslation(this._bodyPos, true);
    }
  }

  // Sync Rapier body position to cache
  _syncCacheFromBody() {
    if (this.body) {
      const t = this.body.translation();
      this._bodyPos.x = t.x;
      this._bodyPos.y = t.y;
      this._bodyPos.z = t.z;
    }
  }

  rebuildPhysics() {
    const wasPassive = this.isPassive;

    if (this.body) {
      this.physicsSystem.removeBody(this.body);
    }

    const height = this.height || 2.0;
    const radius = this.radius || 0.5;

    // Store position before recreating
    const prevPos = this.body ? this.body.translation() : { x: 0, y: 2, z: 0 };

    // FIX: Use kinematic character controller like Player.js for proper wall sliding
    const result = this.physicsSystem.createKinematicPlayer(
      prevPos,
      radius,
      height,
      {
        maxSlope: (60 * Math.PI) / 180, // Ghost can climb steeper slopes
        stepHeight: 0.3,
        snapToGround: 0.3,
      },
    );

    if (result) {
      this.body = result.body;
      this.collider = result.collider;
      this.characterController = result.characterController;
      console.log("[Ghost] Created kinematic character controller");
    }

    // Update visual offset
    if (this.height && this.body) {
      this.visualOffset.y = -this.height / 2;
    }

    // Store dimensions
    this.height = height;
    this.radius = radius;

    // Initialize position tracking
    this._lastFramePosition.set(prevPos.x, prevPos.y, prevPos.z);

    // Preserve state logic
    // DO NOT call respawnRandomly() here, as it teleports the ghost!
    // DO NOT reset isPassive!

    // If we had a previous passive state, keep it
    if (wasPassive) {
      this.isPassive = true;
    }

    // Load the FBX model ONLY if not already loaded
    if (!this.modelLoaded) {
      this._loadModel();
    } else if (this.loadedModel) {
      // Update scale of existing model - 2x larger
      const modelScale = this.radius * 2.0;
      this.loadedModel.scale.set(modelScale, modelScale, modelScale);
      this.loadedModel.position.y = 0;
    }
  }

  setPassive(passive) {
    this.isPassive = passive;
  }

  async _loadModel() {
    // Cleanup existing model if any
    if (this.loadedModel) {
      this.mesh.remove(this.loadedModel);
      this.loadedModel = null;
    }

    // Suppress FBX warnings
    const originalWarn = console.warn;
    console.warn = (msg, ...args) => {
      if (
        typeof msg === "string" &&
        (msg.includes("skinning weights") || msg.includes("ShininessExponent"))
      ) {
        return;
      }
      originalWarn(msg, ...args);
    };

    try {
      // TRY TO USE CACHED MODEL FROM ASSETLOADER (preloaded during splash screen)
      const assetLoader = getAssetLoader();
      let model = null;
      const cachedModel = assetLoader.getModel("monsterModel");

      if (cachedModel) {
        // Clone the cached model to avoid sharing state between ghost instances
        model = cachedModel.clone();

        // Deep clone is needed for SkinnedMesh to work properly
        // Clone skeleton and bind matrices for each skinned mesh
        const skinnedMeshes = [];
        cachedModel.traverse((child) => {
          if (child.isSkinnedMesh) {
            skinnedMeshes.push(child);
          }
        });

        // If there are skinned meshes, we need to properly clone them with their skeletons
        if (skinnedMeshes.length > 0) {
          model = SkeletonUtils.clone(cachedModel);
        }

        console.log("Ghost: Using CACHED monster model (no FBX parsing)");
      } else {
        // Fallback: Load fresh if cache miss
        console.log("Ghost: Cache miss, loading monster model fresh...");
        const loader = new FBXLoader();
        model = await loader.loadAsync("./assets/monster/model/monster.fbx");
        console.log("Ghost: FBX loaded successfully (fallback)");
      }

      // Calculate bounding box to verify size
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      console.log(
        `Ghost: Model Size: ${size.x.toFixed(2)} x ${size.y.toFixed(
          2,
        )} x ${size.z.toFixed(2)}`,
      );

      // Scale and position
      // Ensure it's roughly 2-3 meters tall
      const targetHeight = this.height || 2.5;
      const scaleFactor = targetHeight / (size.y || 1);

      model.scale.setScalar(scaleFactor);
      // Position model so feet are at Y=0 of the mesh group
      // The mesh group's Y is set by bodyPosition.y which puts center at height/2
      model.position.y = 0; // Let the mesh group handle positioning

      // DIAGNOSTIC: Log skeleton info to debug animations
      let boneNames = [];
      model.traverse((child) => {
        if (child.isBone) boneNames.push(child.name);
      });
      console.log(
        "Ghost: Model bone names:",
        boneNames.slice(0, 10),
        "...(" + boneNames.length + " total)",
      );

      // Apply basic material to all meshes (textures loaded separately)
      model.traverse((child) => {
        if (child.isMesh) {
          // Use existing material or create a basic one
          if (!child.material) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0x444444,
              roughness: 0.8,
              metalness: 0.2,
              side: THREE.DoubleSide, // Render both sides to fix invisible mesh issues
              transparent: false,
              alphaTest: 0.5,
            });
          }
          child.material.side = THREE.DoubleSide; // Force double side on existing materials too
          child.material.transparent = false;

          child.castShadow = true;
          // Disable receiveShadow to prevent "16 texture units" error on some GPUs
          child.receiveShadow = false;

          // Ensure it's visible!
          child.visible = true;
        }
      });

      // Remove fallback sphere and add the model
      if (this.fallbackMesh) {
        this.mesh.remove(this.fallbackMesh);
        // Don't dispose immediately in case we need to fallback again?
        // No, dispose to save memory.
        if (this.fallbackMesh.geometry) this.fallbackMesh.geometry.dispose();
        if (this.fallbackMesh.material) this.fallbackMesh.material.dispose();
        this.fallbackMesh = null;
      }

      this.mesh.add(model);
      this.loadedModel = model;
      this.modelLoaded = true;
      console.log("Ghost: Monster model added to scene");

      // Setup animation mixer
      this.mixer = new THREE.AnimationMixer(model);

      // Load all animations (using cache when available)
      await this._loadAllAnimations();

      // Start with idle animation
      this._playAnimation("idle");

      // Load textures asynchronously
      this._loadTextures(model);
    } catch (error) {
      console.error("Ghost: Failed to load monster model:", error);
      // Keep or restore fallback sphere
      if (!this.fallbackMesh) {
        // Recreate fallback if needed (omitted for brevity, assuming standard fallback logic)
        console.warn("Ghost: Model failed, running without visual model.");
      }
    } finally {
      console.warn = originalWarn;
    }
  }

  async _loadAllAnimations() {
    // Animation cache mapping: animation name -> AssetLoader cache key
    const animationCacheMap = {
      idle: "monsterIdle",
      walk: "monsterWalk",
      run: "monsterRun",
      attack: "monsterAttack",
      attack1: "monsterAttack1",
    };

    // Fallback paths for animations not in cache
    const animationFallbackPaths = {
      idle: "./assets/monster/animations/idle.fbx",
      walk: "./assets/monster/animations/walk.fbx",
      run: "./assets/monster/animations/run.fbx",
      attack: "./assets/monster/animations/attack.fbx",
      attack1: "./assets/monster/animations/attack1.fbx",
    };

    const assetLoader = getAssetLoader();
    let fallbackLoader = null; // Lazy-init FBXLoader only if needed

    // Process each animation
    const loadPromises = Object.entries(animationCacheMap).map(
      async ([name, cacheKey]) => {
        try {
          let animFBX = null;

          // Try to get from cache first
          if (cacheKey) {
            animFBX = assetLoader.getModel(cacheKey);
          }

          if (animFBX) {
            console.log(`Ghost: Using CACHED ${name} animation`);
          } else {
            // Fallback: load fresh
            if (!fallbackLoader) {
              fallbackLoader = new FBXLoader();
            }
            const path = animationFallbackPaths[name];
            console.log(
              `Ghost: Cache miss, loading ${name} animation from ${path}...`,
            );
            animFBX = await fallbackLoader.loadAsync(path);
          }

          if (animFBX && animFBX.animations && animFBX.animations.length > 0) {
            // Clone the clip to avoid modifying the cached version
            const originalClip = animFBX.animations[0];
            const clip = originalClip.clone();

            // FIX BONE NAME MISMATCH: Remap animation track names to match model bones
            // This is critical for Mixamo animations to work with different model exports
            const modelBoneNames = new Set();
            this.loadedModel?.traverse((child) => {
              if (child.isBone) {
                modelBoneNames.add(child.name);
              }
            });

            clip.tracks.forEach((track) => {
              const parts = track.name.split(".");
              const boneName = parts[0];
              const property = parts.slice(1).join(".");

              // Try different name transformations to find matching bone
              let matchedBoneName = null;

              // 1. Direct match
              if (modelBoneNames.has(boneName)) {
                matchedBoneName = boneName;
              }
              // 2. Animation has "mixamorig:" but model doesn't
              else if (boneName.startsWith("mixamorig:")) {
                const stripped = boneName.replace("mixamorig:", "");
                if (modelBoneNames.has(stripped)) {
                  matchedBoneName = stripped;
                }
              }
              // 3. Model has "mixamorig:" but animation doesn't
              else if (modelBoneNames.has("mixamorig:" + boneName)) {
                matchedBoneName = "mixamorig:" + boneName;
              }

              // Apply the fix if we found a match
              if (matchedBoneName && matchedBoneName !== boneName) {
                const newName = matchedBoneName + "." + property;
                track.name = newName;
              }
            });

            const action = this.mixer.clipAction(clip);

            // Configure for smooth looping
            action.clampWhenFinished = false;
            action.loop = THREE.LoopRepeat;

            // Attack animations should play once when triggered
            if (name === "attack" || name === "attack1") {
              action.loop = THREE.LoopOnce;
              action.clampWhenFinished = true;
            }

            this.animations[name] = action;
            console.log(
              `Ghost: ${name} animation ready with ${clip.tracks.length} tracks`,
            );
          } else {
            console.warn(`Ghost: ${name} animation has no animations array!`);
          }
        } catch (e) {
          console.warn(`Ghost: Could not load ${name} animation:`, e);
        }
      },
    );

    // Wait for all animations to load (or fail caught inside)
    await Promise.all(loadPromises);
    console.log("Ghost: All animations loaded.");
  }

  _playAnimation(animName) {
    // Silently skip if mixer or animations not ready yet (model still loading)
    if (!this.mixer || !this.animations[animName]) {
      return;
    }

    const newAction = this.animations[animName];
    const oldAction = this.animations[this.currentAnimState];

    // If already playing this animation, just ensure it's running
    if (animName === this.currentAnimState) {
      // Force ensure it's playing
      if (!newAction.isRunning()) {
        newAction.setEffectiveTimeScale(1);
        newAction.setEffectiveWeight(1);
        newAction.play();
      }
      return;
    }

    // Log only actual state transitions
    console.log(`Ghost: Animation ${this.currentAnimState} → ${animName}`);

    this.previousAnimState = this.currentAnimState;
    this.currentAnimState = animName;

    // Crossfade from old to new action
    if (oldAction && oldAction !== newAction) {
      // Use crossFadeTo for smoother transitions without position reset
      newAction.reset();
      newAction.setEffectiveTimeScale(1);
      newAction.setEffectiveWeight(1);
      oldAction.crossFadeTo(newAction, this.animationCrossFadeDuration, true);
      newAction.play();
    } else {
      // No old action or same action - just play
      newAction.reset();
      newAction.setEffectiveTimeScale(1);
      newAction.setEffectiveWeight(1);
      newAction.fadeIn(this.animationCrossFadeDuration);
      newAction.play();
    }
  }

  async _loadTextures(model) {
    const textureLoader = new THREE.TextureLoader();
    const texturePath = "./assets/monster/textures/";

    try {
      console.log("Ghost: Loading textures...");
      const baseColorMap = await textureLoader.loadAsync(
        texturePath + "BaseColor.png",
      );
      console.log("Ghost: BaseColor loaded");

      // Apply textures to model materials
      model.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            map: baseColorMap,
            roughness: 0.8,
            metalness: 0.2,
            side: THREE.DoubleSide, // Fix visibility
            transparent: false,
            alphaTest: 0.5,
          });
        }
      });
      console.log("Ghost: Textures applied");

      // Load additional maps in background (optional)
      this._loadAdditionalMaps(model, textureLoader, texturePath);
    } catch (texError) {
      console.warn("Ghost: Could not load textures:", texError);
    }
  }

  async _loadAdditionalMaps(model, textureLoader, texturePath) {
    try {
      const [normalMap, roughnessMap, metallicMap] = await Promise.all([
        textureLoader.loadAsync(texturePath + "Normal.png").catch(() => null),
        textureLoader
          .loadAsync(texturePath + "Roughness.png")
          .catch(() => null),
        textureLoader.loadAsync(texturePath + "Metallic.png").catch(() => null),
      ]);

      model.traverse((child) => {
        if (child.isMesh && child.material) {
          if (normalMap) child.material.normalMap = normalMap;
          if (roughnessMap) child.material.roughnessMap = roughnessMap;
          if (metallicMap) child.material.metalnessMap = metallicMap;
          child.material.needsUpdate = true;
        }
      });
      console.log("Ghost: Additional texture maps applied");
    } catch (e) {
      // Ignore additional map loading errors
    }
  }

  update(deltaTime) {
    if (!this.player) return;

    // DEBUG: Log ghost state every 2 seconds
    this._debugTimer = (this._debugTimer || 0) + deltaTime;
    if (this._debugTimer > 2) {
      console.log(
        "Ghost state:",
        this.currentState,
        "pos:",
        this.bodyPosition.x.toFixed(1),
        this.bodyPosition.z.toFixed(1),
        "mazeData:",
        !!this.mazeData,
        "active:",
        this.isActive,
      );
      this._debugTimer = 0;
    }

    // Update attack cooldown
    if (this.attackCooldown > 0) {
      this.attackCooldown -= deltaTime;
    }

    // Play periodic ghost ambient sounds based on distance to player
    this._ghostSoundTimer = (this._ghostSoundTimer || 0) + deltaTime;
    const soundInterval = 4 + Math.random() * 3; // 4-7 seconds between sounds
    if (this._ghostSoundTimer > soundInterval && this.spatialAudio) {
      this._ghostSoundTimer = 0;
      const playerPos = this.player.getPosition();
      const dist = Math.sqrt(
        (playerPos.x - this.bodyPosition.x) ** 2 +
          (playerPos.z - this.bodyPosition.z) ** 2,
      );
      // Play whisper when close, moan when medium distance
      if (dist < 8) {
        this.spatialAudio.playGhostSound("whisper", this.bodyPosition);
      } else if (dist < 20) {
        this.spatialAudio.playGhostSound("moan", this.bodyPosition);
      }
    }

    // Debug Passive Mode - STRICT RETURN
    // If passive, we do NOTHING else. No seeking, no attacking, no state changes.
    if (this.isPassive) {
      this.currentState = "dormant";
      this._playAnimation("idle");

      // Force face player so we can see the model
      const playerPos = this.player.getPosition();
      const angle = Math.atan2(
        playerPos.x - this.bodyPosition.x,
        playerPos.z - this.bodyPosition.z,
      );
      this.mesh.rotation.y = angle;

      // Ensure zero velocity using Rapier API
      if (this.body) {
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }

      // Sync positions BEFORE mixer update to prevent root motion issues
      this._syncMeshToBody();

      // Update animation mixer AFTER position sync
      if (this.mixer) {
        this.mixer.update(deltaTime);
        this._cancelRootMotion(); // Cancel any root motion applied by animation
      }
      return;
    }

    const now = performance.now();

    // Check activation delay - ghost remains dormant for first few seconds
    if (!this.isActive) {
      const timeSinceSpawn = now - this.spawnTime;
      if (timeSinceSpawn < this.activationDelay) {
        // Ghost is dormant - stay COMPLETELY stationary, play idle animation
        this.currentState = "dormant";
        this._playAnimation("idle");

        // Sync positions BEFORE mixer update
        this._syncMeshToBody();

        // Update animation mixer AFTER position sync
        if (this.mixer) {
          this.mixer.update(deltaTime);
          this._cancelRootMotion();
        }
        return;
      } else {
        // Activate the ghost
        this.isActive = true;
        this.currentState = "wander";
        console.log(
          "Ghost activated after",
          this.activationDelay / 1000,
          "seconds",
        );
      }
    }

    // If currently attacking, wait for attack to finish
    if (this.isAttacking) {
      // Don't move during attack, just sync position and update animation
      this._syncMeshToBody();
      if (this.mixer) {
        this.mixer.update(deltaTime);
        this._cancelRootMotion();
      }
      return;
    }

    // Update kill cooldown
    if (this.killCooldown > 0) {
      this.killCooldown -= deltaTime;

      // Respect current state during cooldown - don't override idle
      if (this.currentState === "idle") {
        // Stay in place, just update animation
        this._syncMeshToBody();
        if (this.mixer) {
          this.mixer.update(deltaTime);
          this._cancelRootMotion();
        }
        return;
      }

      // If in wander state during cooldown, walk away slowly
      if (this.currentState === "wander") {
        this._playAnimation("walk");
        this._updateRoaming(
          deltaTime,
          new THREE.Vector3(this.bodyPosition.x, 0, this.bodyPosition.z),
        );
        this._updatePosition(deltaTime, this.wanderDir, this.wanderSpeed * 0.5); // Slower walk
      }
      return;
    }

    // ============ AI-BASED UPDATE (Smart Pathfinding) ============
    // If GhostAI is initialized and model is loaded, use intelligent behavior
    if (this.useAI && this.ai && this.modelLoaded) {
      this._updateWithAI(deltaTime);
      return;
    }

    // If AI is ready but model isn't loaded yet, just wait (don't use legacy)
    if (this.useAI && this.ai && !this.modelLoaded) {
      // Still sync position but don't try to animate
      this._syncMeshToBody();
      return;
    }

    // ============ LEGACY UPDATE (Simple Chase Logic) ============
    // Removed to prevent conflict with GhostAI system
    // Fallback: If AI fails but we have a body, just sync mesh
    if (this.body) {
      this._syncMeshToBody();

      // Simple animation update
      if (this.mixer) {
        this.mixer.update(deltaTime);
      }
    }
  }

  /**
   * AI-based update using GhostAI system for intelligent pathfinding
   * NOW USES CHARACTER CONTROLLER for proper wall sliding and collision
   * Animation is driven by ACTUAL velocity, not AI intent
   */
  _updateWithAI(deltaTime) {
    const now = performance.now();

    // Store position before movement for velocity calculation
    const prevPos = this.body.translation();
    this._lastFramePosition.set(prevPos.x, prevPos.y, prevPos.z);

    // Sync AI position
    this.ai.setPosition(prevPos.x, prevPos.z);
    this.ai.setFacing(this.mesh.rotation.y);

    // Report player noise (running = louder)
    if (this.player.isSprinting) {
      const playerPos = this.player.getPosition();
      this.ai.reportNoise(playerPos.x, playerPos.z, 1.5);
    }

    // Update AI
    this.ai.update(deltaTime);

    // Get AI output
    const movement = this.ai.getMovement();
    const aiState = this.ai.getState();

    // Check attack range
    const playerPos = this.player.getPosition();
    const ghostPos = new THREE.Vector3(prevPos.x, prevPos.y, prevPos.z);
    const toPlayer = new THREE.Vector3().subVectors(playerPos, ghostPos);
    const horizontalDistance = Math.sqrt(
      toPlayer.x * toPlayer.x + toPlayer.z * toPlayer.z,
    );

    // Attack if in range - CRITICAL FIX: attack if VERY close regardless of vision
    // Or attack if in normal range AND can see target
    const veryClose = horizontalDistance <= 2.0; // Within 2 meters = guaranteed attack
    const canAttack =
      horizontalDistance <= this.attackRange &&
      (veryClose || this.ai.canSeeTarget);

    if (canAttack && this.attackCooldown <= 0) {
      console.log(
        "Ghost AI: ATTACKING! Distance:",
        horizontalDistance.toFixed(2),
        "veryClose:",
        veryClose,
      );
      this._initiateAttack();
      return;
    }

    // Occasional ghostly moan when near player
    if (
      horizontalDistance < 15 &&
      now - this.lastMoanTime > this.moanInterval
    ) {
      if (Math.random() < 0.3) {
        getAudioManager().playGhostMoan();
      }
      this.lastMoanTime = now;
      this.moanInterval = 8000 + Math.random() * 7000;
    }

    // Play ROAR sound when monster sees player and starts chasing
    if (aiState === AIState.CHASE && this.currentState !== "chase") {
      // Play 3D roar for chase initiation - player knows monster is coming!
      if (this.spatialAudio) {
        this.spatialAudio.playGhostSound("killRoar", this.bodyPosition);
        console.log("Ghost: Playing 3D chase ROAR - Monster is chasing!");
      } else {
        getAudioManager().playGhostWhisper();
      }
    }

    // 3D SPATIAL WHISPER AUDIO during SEARCH state
    // This gives player directional audio cue to know where monster is searching
    if (aiState === AIState.SEARCH && this.spatialAudio) {
      if (now - this.lastSearchWhisperTime > this.searchWhisperInterval) {
        this.spatialAudio.playGhostSound("whisper", this.bodyPosition);
        this.lastSearchWhisperTime = now;
        console.log(
          "Ghost: Playing 3D search whisper at",
          this.bodyPosition.x.toFixed(1),
          this.bodyPosition.z.toFixed(1),
        );
      }
    }

    // Update state for compatibility
    this.currentState = aiState;

    // Store intended velocity for feedback comparison
    this._intendedVelocity.set(movement.x, 0, movement.z);

    // ============ USE CHARACTER CONTROLLER FOR PROPER PHYSICS ============
    if (this.characterController && this.collider) {
      // Calculate intended movement including gravity (keep grounded)
      const intendedMovement = {
        x: movement.x * deltaTime,
        y: -0.5 * deltaTime, // Small downward force to stay grounded
        z: movement.z * deltaTime,
      };

      // Let Rapier handle collision detection and wall sliding
      this.characterController.computeColliderMovement(
        this.collider,
        intendedMovement,
      );

      // Get physics-corrected movement (includes wall sliding!)
      const correctedMovement = this.characterController.computedMovement();

      // Apply corrected position
      const newPos = {
        x: prevPos.x + correctedMovement.x,
        y: prevPos.y + correctedMovement.y,
        z: prevPos.z + correctedMovement.z,
      };

      // Keep ghost at proper height
      newPos.y = Math.max(this.height / 2, newPos.y);

      this.body.setNextKinematicTranslation(newPos);

      // Update cached position
      this._bodyPos.x = newPos.x;
      this._bodyPos.y = newPos.y;
      this._bodyPos.z = newPos.z;

      // Calculate ACTUAL velocity from physics result
      const actualDx = newPos.x - prevPos.x;
      const actualDz = newPos.z - prevPos.z;
      this._actualVelocity.set(actualDx / deltaTime, 0, actualDz / deltaTime);

      // ============ PHYSICS FEEDBACK LOOP ============
      // Check if ghost is blocked (intended > actual)
      const intendedSpeed = Math.sqrt(
        movement.x * movement.x + movement.z * movement.z,
      );
      const actualSpeed =
        Math.sqrt(actualDx * actualDx + actualDz * actualDz) / deltaTime;

      if (intendedSpeed > 0.5 && actualSpeed < intendedSpeed * 0.3) {
        // Ghost wanted to move but physics blocked it
        this._blockedFrames++;
        if (this._blockedFrames > this._blockedThreshold) {
          // Report blockage to AI - force path recalculation
          if (this.ai) {
            this.ai.pathRecalculateTimer = 0;
            console.log("[Ghost] Blocked - forcing AI path recalc");
          }
          this._blockedFrames = 0;
        }
      } else {
        this._blockedFrames = 0;
      }

      // Rotate to face: player if close/visible, otherwise movement direction
      let targetAngle;
      if (horizontalDistance < 10 || this.ai.canSeeTarget) {
        // Look at player when close or can see them
        const dx = playerPos.x - newPos.x;
        const dz = playerPos.z - newPos.z;
        targetAngle = Math.atan2(dx, dz);
      } else if (Math.abs(actualDx) > 0.01 || Math.abs(actualDz) > 0.01) {
        // Face actual movement direction (not intended - prevents moonwalk)
        targetAngle = Math.atan2(actualDx, actualDz);
      } else {
        targetAngle = this.mesh.rotation.y; // Keep current
      }

      const currentRotation = this.mesh.rotation.y;
      let rotDiff = targetAngle - currentRotation;
      while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
      while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
      this.mesh.rotation.y += rotDiff * Math.min(1, deltaTime * 8);

      // Sync mesh to body with visual offset
      this.mesh.position.set(
        newPos.x + this.visualOffset.x,
        newPos.y + this.visualOffset.y,
        newPos.z + this.visualOffset.z,
      );

      // ============ ANIMATION FROM ACTUAL VELOCITY ============
      // Choose animation based on ACTUAL speed, not AI intent
      this._playAnimationFromActualVelocity(actualSpeed, aiState);
    } else {
      // Fallback: No character controller - use legacy grid-based movement
      this._updateWithAILegacy(
        deltaTime,
        movement,
        aiState,
        horizontalDistance,
        playerPos,
      );
    }

    // Update animation mixer
    if (this.mixer) {
      this.mixer.update(deltaTime);
      this._cancelRootMotion();
    }
  }

  /**
   * Play animation based on ACTUAL velocity, not AI intent
   * This prevents "moonwalk" effect when blocked
   */
  _playAnimationFromActualVelocity(actualSpeed, aiState) {
    // Speed thresholds
    const runThreshold = 4.0;
    const walkThreshold = 0.5;

    if (actualSpeed > runThreshold) {
      this._playAnimation("run");
    } else if (actualSpeed > walkThreshold) {
      this._playAnimation("walk");
    } else {
      // Stopped or nearly stopped
      // Check if AI is in a state that expects idle
      if (aiState === AIState.AMBUSH || actualSpeed < 0.1) {
        this._playAnimation("idle");
      } else {
        // Still trying to move but blocked - play walk to show effort
        this._playAnimation("walk");
      }
    }
  }

  /**
   * Legacy AI update (grid-based collision) - used as fallback
   */
  _updateWithAILegacy(
    deltaTime,
    movement,
    aiState,
    horizontalDistance,
    playerPos,
  ) {
    const dir = new THREE.Vector3(movement.x, 0, movement.z);

    if (dir.lengthSq() > 0.01) {
      let newX = this.bodyPosition.x + movement.x * deltaTime;
      let newZ = this.bodyPosition.z + movement.z * deltaTime;

      const canMoveX = this._isWorldPosWalkable(newX, this.bodyPosition.z);
      const canMoveZ = this._isWorldPosWalkable(this.bodyPosition.x, newZ);
      const canMoveBoth = this._isWorldPosWalkable(newX, newZ);

      if (canMoveBoth) {
        this.bodyPosition.x = newX;
        this.bodyPosition.z = newZ;
      } else if (canMoveX) {
        this.bodyPosition.x = newX;
      } else if (canMoveZ) {
        this.bodyPosition.z = newZ;
      }

      // Rotation
      let targetAngle;
      if (horizontalDistance < 10 || this.ai.canSeeTarget) {
        const dx = playerPos.x - this.bodyPosition.x;
        const dz = playerPos.z - this.bodyPosition.z;
        targetAngle = Math.atan2(dx, dz);
      } else {
        targetAngle = Math.atan2(movement.x, movement.z);
      }
      const rotDiff = targetAngle - this.mesh.rotation.y;
      this.mesh.rotation.y += rotDiff * Math.min(1, deltaTime * 8);
    }

    this.bodyPosition.y = this.height / 2;
    this.mesh.position.set(
      this.bodyPosition.x + this.visualOffset.x,
      this.bodyPosition.y + this.visualOffset.y,
      this.bodyPosition.z + this.visualOffset.z,
    );

    // Use AI-suggested animation for legacy mode
    this._playAnimationForAIState(aiState, movement.animation);
  }

  /**
   * Play animation based on AI state with fallbacks
   */
  _playAnimationForAIState(aiState, suggestedAnim) {
    // Use AI's suggested animation which is based on movement speed
    if (suggestedAnim && this.animations[suggestedAnim]) {
      this._playAnimation(suggestedAnim);
    } else {
      // Fallback based on state
      switch (aiState) {
        case AIState.CHASE:
        case AIState.ENRAGED:
          this._playAnimation("run");
          break;
        case AIState.PATROL:
        case AIState.SUSPICIOUS:
        case AIState.SEARCH:
        case AIState.STALK:
          this._playAnimation("walk");
          break;
        case AIState.AMBUSH:
        default:
          this._playAnimation("idle");
      }
    }
  }

  _respawnNearPlayer() {
    // Find an open cell near the player
    if (!this.player || !this.mazeGenerator) {
      this.respawnRandomly();
      return;
    }

    const playerPos = this.player.getPosition();
    const cellSize = this.mazeData?.cellSize || 4;

    // Try to find a walkable position within 10-20 units of player
    for (let attempts = 0; attempts < 20; attempts++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 10 + Math.random() * 10;
      const testX = playerPos.x + Math.cos(angle) * distance;
      const testZ = playerPos.z + Math.sin(angle) * distance;

      if (this._isWorldPosWalkable(testX, testZ)) {
        this.bodyPosition.set(testX, this.height / 2, testZ);
        this.mesh.position.set(testX, this.height / 2, testZ);
        console.log(
          "Ghost respawned near player at:",
          testX.toFixed(1),
          testZ.toFixed(1),
        );
        return;
      }
    }

    // Fallback to random respawn
    this.respawnRandomly();
  }

  _updateAnimationForState() {
    switch (this.currentState) {
      case "dormant":
        this._playAnimation("idle");
        break;
      case "wander":
      case "search":
      case "searching":
        this._playAnimation("walk");
        break;
      case "chase":
        this._playAnimation("run");
        break;
      case "attack":
        this._playAnimation("attack");
        break;
      default:
        this._playAnimation("idle");
    }
  }

  _checkAttackHit() {
    if (!this.player) return false;

    const playerPos = this.player.getPosition();
    const ghostPos = this.bodyPosition;

    // 1. Distance Check - primary criterion
    const dist = Math.sqrt(
      (playerPos.x - ghostPos.x) ** 2 + (playerPos.z - ghostPos.z) ** 2,
    );

    // Use generous range (attackRange + buffer) - ghost is right next to player during attack
    if (dist > this.attackRange + 1.5) return false;

    // 2. Simplified angle check - ghost already faces player during chase
    // Use mesh.rotation.y since that's what we actually set (not quaternion)
    const ghostAngle = this.mesh.rotation.y;
    const ghostForward = new THREE.Vector3(
      Math.sin(ghostAngle),
      0,
      Math.cos(ghostAngle),
    );

    const toPlayer = new THREE.Vector3(
      playerPos.x - ghostPos.x,
      0,
      playerPos.z - ghostPos.z,
    ).normalize();

    const dot = toPlayer.dot(ghostForward);

    // Very forgiving angle - dot > -0.3 means within ~110 degree cone (almost always hits if close)
    // Since ghost faces player during chase, this should almost always pass
    if (dot < -0.3) {
      console.log("Ghost: Attack missed due to angle, dot:", dot.toFixed(2));
      return false;
    }

    console.log(
      "Ghost: Attack hit confirmed! Distance:",
      dist.toFixed(2),
      "Angle dot:",
      dot.toFixed(2),
    );
    return true;
  }

  _initiateAttack() {
    if (this.isAttacking) return;

    this.isAttacking = true;
    this.currentState = "attack";

    // Randomly select between attack animations for variety
    const attackAnims = ["attack", "attack1"];
    const selectedAttack =
      attackAnims[Math.floor(Math.random() * attackAnims.length)];

    // Use selected attack if available, fallback to primary
    if (this.animations[selectedAttack]) {
      this._playAnimation(selectedAttack);
    } else {
      this._playAnimation("attack");
    }

    this.attackCooldown = this.attackDuration + 1.0;

    // Play ghost moan during attack - use spatial audio if available for 3D positioning
    if (this.spatialAudio) {
      this.spatialAudio.playGhostSound("attack", this.bodyPosition);
    } else {
      getAudioManager().playGhostMoan();
    }

    console.log("Ghost: Attacking player!");

    // STORE initial attack data - player position at attack start
    const playerPosAtAttackStart = this.player.getPosition();
    const ghostPosAtAttackStart = {
      x: this.bodyPosition.x,
      z: this.bodyPosition.z,
    };
    const distanceAtAttackStart = Math.sqrt(
      (playerPosAtAttackStart.x - ghostPosAtAttackStart.x) ** 2 +
        (playerPosAtAttackStart.z - ghostPosAtAttackStart.z) ** 2,
    );

    console.log(
      "Ghost: Attack initiated at distance:",
      distanceAtAttackStart.toFixed(2),
    );

    let hitTriggered = false;

    // IMMEDIATE HIT: If player was very close when attack started, guaranteed hit
    if (distanceAtAttackStart <= this.attackRange) {
      console.log(
        "Ghost: IMMEDIATE HIT - player was in kill range at attack start!",
      );
      hitTriggered = true;

      // Trigger CAPTURE SEQUENCE instead of instant death
      if (this.player && typeof this.player.startCapture === "function") {
        this.player.startCapture(this);
      } else if (
        this.player &&
        typeof this.player.onGhostAttack === "function"
      ) {
        // Fallback to old system if startCapture not available
        this.player.onGhostAttack();
      }
      window.dispatchEvent(
        new CustomEvent("ghostAttack", { detail: { ghost: this } }),
      );
    } else {
      // Schedule delayed hit check for edge cases (player ran into ghost)
      const hitDelay = 400; // Slightly faster hit

      setTimeout(() => {
        // Only check if we are still attacking and haven't already hit
        if (this.isAttacking && !hitTriggered && this._checkAttackHit()) {
          console.log("Ghost: Attack LANDED (delayed check)!");
          // Trigger CAPTURE SEQUENCE instead of instant death
          if (this.player && typeof this.player.startCapture === "function") {
            this.player.startCapture(this);
          } else if (
            this.player &&
            typeof this.player.onGhostAttack === "function"
          ) {
            this.player.onGhostAttack();
          }
          window.dispatchEvent(
            new CustomEvent("ghostAttack", { detail: { ghost: this } }),
          );
          hitTriggered = true;
        } else if (!hitTriggered) {
          console.log("Ghost: Attack MISSED (delayed check)!");
        }
      }, hitDelay);
    }

    // Function to reset ghost after attack sequence
    const resetAfterAttack = () => {
      this.isAttacking = false;
      this.lastSeenPlayerPos = null;

      // Check if player is actually dead
      const playerIsDead = this.player?.isDead || this.player?.health <= 0;

      if (hitTriggered && playerIsDead) {
        // Player died - play kill roar in 3D and idle animation
        console.log("Ghost: Player killed! Playing kill roar.");

        // Play the kill roar sound in 3D at monster's position
        if (this.spatialAudio) {
          this.spatialAudio.playGhostSound("killRoar", this.bodyPosition);
        }

        this.killCooldown = this.postKillWaitTime;
        this.currentState = "idle";
        this._playAnimation("idle");
        this.hasSeenPlayer = false;

        // After brief pause, start wandering
        setTimeout(() => {
          this.currentState = "wander";
          this._playAnimation("walk");
        }, 2000);
      } else if (hitTriggered && !playerIsDead) {
        // HIT but player is still alive (invincible?) - keep attacking!
        console.log("Ghost: Player survived attack! Continuing attack!");
        this.attackCooldown = 0.3; // Short cooldown before next attack
        this.currentState = "chase";
        this._playAnimation("run");
      } else {
        // Missed attack - brief pause then chase again
        this.currentState = "idle";
        this._playAnimation("idle");
        setTimeout(() => {
          this.currentState = "chase";
          this._playAnimation("run");
        }, 300);
      }
    };

    // Listen for attack animation to finish
    if (this.animations.attack) {
      const onFinished = () => {
        this.mixer.removeEventListener("finished", onFinished);
        resetAfterAttack();
      };
      this.mixer.addEventListener("finished", onFinished);
    } else {
      setTimeout(() => {
        resetAfterAttack();
      }, this.attackDuration * 1000);
    }
  }

  _updatePosition(deltaTime, direction, speed) {
    if (direction.lengthSq() > 0.01) {
      const newX = this.bodyPosition.x + direction.x * speed * deltaTime;
      const newZ = this.bodyPosition.z + direction.z * speed * deltaTime;

      // Check wall collision - ghost respects maze walls
      const canMoveX = this._isWorldPosWalkable(newX, this.bodyPosition.z);
      const canMoveZ = this._isWorldPosWalkable(this.bodyPosition.x, newZ);
      const canMoveBoth = this._isWorldPosWalkable(newX, newZ);

      if (canMoveBoth) {
        this.bodyPosition.x = newX;
        this.bodyPosition.z = newZ;
      } else if (canMoveX) {
        this.bodyPosition.x = newX;
      } else if (canMoveZ) {
        this.bodyPosition.z = newZ;
      }
      // If blocked, stuck timer will handle respawn

      // Rotate model to face movement direction
      const targetAngle = Math.atan2(direction.x, direction.z);
      this.mesh.rotation.y = targetAngle;
    }

    // Keep ghost grounded
    const groundY = 0;
    const targetY = groundY + this.height / 2;
    this.bodyPosition.y = targetY;

    // Sync mesh to body
    this.mesh.position.set(
      this.bodyPosition.x + this.visualOffset.x,
      this.bodyPosition.y + this.visualOffset.y,
      this.bodyPosition.z + this.visualOffset.z,
    );

    // Store last known position for tracking
    this._lastKnownPosition.set(
      this.bodyPosition.x,
      this.bodyPosition.y,
      this.bodyPosition.z,
    );
    this._positionInitialized = true;
  }

  /**
   * Sync mesh position to physics body position
   * Used to ensure mesh stays aligned before animation updates
   */
  _syncMeshToBody() {
    if (!this.body) return;

    // Keep ghost grounded
    const groundY = 0;
    const targetY = groundY + this.height / 2;
    this.bodyPosition.y = targetY;

    this.mesh.position.set(
      this.bodyPosition.x + this.visualOffset.x,
      this.bodyPosition.y + this.visualOffset.y,
      this.bodyPosition.z + this.visualOffset.z,
    );
  }

  /**
   * Cancel root motion from animation
   * FBX animations may have position keyframes that move the model,
   * this resets the loaded model's local position to prevent that
   */
  _cancelRootMotion() {
    if (this.loadedModel) {
      // Force the loaded model to stay at origin within the mesh group
      // The mesh group position is what actually controls world position
      this.loadedModel.position.set(0, 0, 0);
    }
  }

  _canSeePlayer(ghostPos, playerPos) {
    if (this.isLowEndDevice) {
      const distance = Math.sqrt(
        (ghostPos.x - playerPos.x) ** 2 + (ghostPos.z - playerPos.z) ** 2,
      );
      return distance <= this.detectionRadius;
    }

    // Use Rapier raycast via PhysicsSystem
    const origin = { x: ghostPos.x, y: ghostPos.y + 0.5, z: ghostPos.z };
    const target = { x: playerPos.x, y: playerPos.y + 0.5, z: playerPos.z };

    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const dz = target.z - origin.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance < 0.01) return true; // Too close, assume visible

    const direction = { x: dx / distance, y: dy / distance, z: dz / distance };

    const hit = this.physicsSystem.raycast(origin, direction, distance);

    if (!hit) return true; // No obstacle, player is visible

    const distToHit = hit.distance;
    const distToPlayer = distance;

    // If hit is close to player position, player is visible
    return distToHit >= distToPlayer - 1.0;
  }

  /**
   * Maze-aware line-of-sight check using Bresenham line algorithm
   * Returns true only if there are no walls between ghost and player
   */
  _canSeePlayerThroughMaze(ghostPos, playerPos) {
    if (!this.mazeData) {
      // Fallback to physics raycast if no maze data
      return this._canSeePlayer(ghostPos, playerPos);
    }

    const cellSize = this.mazeData.cellSize || 4;

    // Convert world positions to maze cell coordinates
    const gx = Math.floor(ghostPos.x / cellSize);
    const gz = Math.floor(ghostPos.z / cellSize);
    const px = Math.floor(playerPos.x / cellSize);
    const pz = Math.floor(playerPos.z / cellSize);

    // Bresenham's line algorithm to check each cell between ghost and player
    let x0 = gx,
      y0 = gz,
      x1 = px,
      y1 = pz;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      // Check if current cell is a wall
      if (
        x0 >= 0 &&
        y0 >= 0 &&
        x0 < this.mazeData.width &&
        y0 < this.mazeData.height
      ) {
        if (this.mazeData.maze[y0] && this.mazeData.maze[y0][x0] === 1) {
          return false; // Wall blocks line of sight
        }
      }

      if (x0 === x1 && y0 === y1) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }

    return true; // Clear line of sight
  }
  /**
   * STABILIZED PATH-FOLLOWING SYSTEM
   *
   * Fixes applied:
   * 1. Time-based cooldown prevents oscillation (min 200ms between recalcs)
   * 2. Direction smoothing prevents jitter
   * 3. Simplified node following without recursive calls
   * 4. Consistent forward motion regardless of animation state
   */
  _getPathAwareDirection(ghostPos, targetPos) {
    if (!this.mazeData) {
      const dir = new THREE.Vector3(
        targetPos.x - ghostPos.x,
        0,
        targetPos.z - ghostPos.z,
      );
      if (dir.lengthSq() > 0.001) dir.normalize();
      return dir;
    }

    const cellSize = this.mazeData.cellSize || 4;
    const now = performance.now();

    // TIME-BASED COOLDOWN: Minimum 300ms between path recalculations
    // This prevents oscillation from constant recalcs
    const timeSinceLastCalc = now - (this._lastPathCalcTime || 0);
    const canRecalculate = timeSinceLastCalc > 300;

    // Track target cell for detecting significant player movement
    const targetCell = this._worldToCell(targetPos.x, targetPos.z, cellSize);
    const targetCellChanged =
      !this._lastTargetCell ||
      this._lastTargetCell.x !== targetCell.x ||
      this._lastTargetCell.z !== targetCell.z;

    // RECALCULATE CONDITIONS (with time guard):
    const needsNewPath =
      canRecalculate &&
      (!this._currentPath ||
        this._currentPath.length === 0 ||
        this._pathIndex >= this._currentPath.length ||
        (targetCellChanged && timeSinceLastCalc > 500)); // Wait even longer for target changes

    if (needsNewPath) {
      const newPath = this._findPath(ghostPos, targetPos);

      // Only accept new path if it's valid
      if (newPath && newPath.length > 0) {
        this._currentPath = newPath;
        this._pathIndex = 0;
        this._lastPathCalcTime = now;
        this._lastTargetCell = { x: targetCell.x, z: targetCell.z };

        // Skip first node if we're already there
        const ghostCell = this._worldToCell(ghostPos.x, ghostPos.z, cellSize);
        if (
          this._currentPath.length > 1 &&
          this._currentPath[0].x === ghostCell.x &&
          this._currentPath[0].z === ghostCell.z
        ) {
          this._pathIndex = 1;
        }
      }
    }

    // STABLE PATH FOLLOWING
    if (this._currentPath && this._pathIndex < this._currentPath.length) {
      const waypoint = this._currentPath[this._pathIndex];

      // World position of waypoint center
      const wpX = waypoint.x * cellSize + cellSize / 2;
      const wpZ = waypoint.z * cellSize + cellSize / 2;

      const dx = wpX - ghostPos.x;
      const dz = wpZ - ghostPos.z;
      const distToWp = Math.sqrt(dx * dx + dz * dz);

      // Reach threshold - tight for accuracy
      const reachThreshold = cellSize * 0.4;

      if (distToWp < reachThreshold) {
        this._pathIndex++;

        // If path complete, direct to target
        if (this._pathIndex >= this._currentPath.length) {
          const directDir = new THREE.Vector3(
            targetPos.x - ghostPos.x,
            0,
            targetPos.z - ghostPos.z,
          );
          if (directDir.lengthSq() > 0.001) directDir.normalize();
          return directDir;
        }

        // Continue with next waypoint (non-recursive to prevent stack issues)
        const nextWp = this._currentPath[this._pathIndex];
        const nextX = nextWp.x * cellSize + cellSize / 2;
        const nextZ = nextWp.z * cellSize + cellSize / 2;
        const nextDir = new THREE.Vector3(
          nextX - ghostPos.x,
          0,
          nextZ - ghostPos.z,
        );
        if (nextDir.lengthSq() > 0.001) nextDir.normalize();
        return nextDir;
      }

      // Direction toward current waypoint
      const dir = new THREE.Vector3(dx, 0, dz);
      dir.normalize();

      // SMOOTH DIRECTION: Blend with previous direction to reduce jitter
      if (this._lastMoveDir) {
        dir.lerp(this._lastMoveDir, 0.3); // 30% previous direction
        dir.normalize();
      }
      this._lastMoveDir = dir.clone();

      return dir;
    }

    // FALLBACK: Direct movement with smoothing
    const fallbackDir = new THREE.Vector3(
      targetPos.x - ghostPos.x,
      0,
      targetPos.z - ghostPos.z,
    );
    if (fallbackDir.lengthSq() > 0.001) {
      fallbackDir.normalize();
      if (this._lastMoveDir) {
        fallbackDir.lerp(this._lastMoveDir, 0.3);
        fallbackDir.normalize();
      }
      this._lastMoveDir = fallbackDir.clone();
    }
    return fallbackDir;
  }

  /**
   * Convert world position to grid cell
   */
  _worldToCell(x, z, cellSize) {
    return {
      x: Math.floor(x / cellSize),
      z: Math.floor(z / cellSize),
    };
  }

  /**
   * Check if current path is invalid
   * Path is invalid if ghost is stuck (not making progress)
   */
  _isPathInvalid(ghostPos, targetPos, cellSize) {
    if (!this._currentPath || this._currentPath.length === 0) return true;

    // Check if we've been stuck at same cell for too long
    const ghostCell = this._worldToCell(ghostPos.x, ghostPos.z, cellSize);

    if (
      this._lastGhostCell &&
      this._lastGhostCell.x === ghostCell.x &&
      this._lastGhostCell.z === ghostCell.z
    ) {
      this._stuckAtCellFrames = (this._stuckAtCellFrames || 0) + 1;

      // If stuck for 30 frames (~0.5 sec), path is invalid
      if (this._stuckAtCellFrames > 30) {
        this._stuckAtCellFrames = 0;
        return true;
      }
    } else {
      this._stuckAtCellFrames = 0;
      this._lastGhostCell = { x: ghostCell.x, z: ghostCell.z };
    }

    return false;
  }

  /**
   * A* Pathfinding with optimized open set (binary heap would be better for production)
   */
  _findPath(startWorld, endWorld) {
    if (!this.mazeData || !this.mazeData.maze) return null;

    const cellSize = this.mazeData.cellSize || 4;
    const maze = this.mazeData.maze;
    const width = this.mazeData.width;
    const height = this.mazeData.height;

    // Convert world to cell coords
    let startX = Math.floor(startWorld.x / cellSize);
    let startZ = Math.floor(startWorld.z / cellSize);
    let endX = Math.floor(endWorld.x / cellSize);
    let endZ = Math.floor(endWorld.z / cellSize);

    // Clamp to bounds
    startX = Math.max(0, Math.min(width - 1, startX));
    startZ = Math.max(0, Math.min(height - 1, startZ));
    endX = Math.max(0, Math.min(width - 1, endX));
    endZ = Math.max(0, Math.min(height - 1, endZ));

    // Quick exit if start == end
    if (startX === endX && startZ === endZ) {
      return [{ x: endX, z: endZ }];
    }

    // If start or end is in a wall, find nearest walkable cell
    if (maze[startZ] && maze[startZ][startX] === 1) {
      const nearest = this._findNearestWalkable(
        startX,
        startZ,
        maze,
        width,
        height,
      );
      if (nearest) {
        startX = nearest.x;
        startZ = nearest.z;
      }
    }
    if (maze[endZ] && maze[endZ][endX] === 1) {
      const nearest = this._findNearestWalkable(
        endX,
        endZ,
        maze,
        width,
        height,
      );
      if (nearest) {
        endX = nearest.x;
        endZ = nearest.z;
      }
    }

    // A* algorithm
    const openSet = [];
    const openSetMap = new Map(); // For O(1) lookup
    const closedSet = new Set();
    const maxIterations = 400; // Reduced for mobile performance

    const startNode = { x: startX, z: startZ, g: 0, h: 0, f: 0, parent: null };
    startNode.h = Math.abs(endX - startX) + Math.abs(endZ - startZ);
    startNode.f = startNode.h;
    openSet.push(startNode);
    openSetMap.set(`${startX},${startZ}`, startNode);

    let iterations = 0;

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // Get node with lowest f (simple linear scan - binary heap better for larger mazes)
      let lowestIdx = 0;
      for (let i = 1; i < openSet.length; i++) {
        if (openSet[i].f < openSet[lowestIdx].f) lowestIdx = i;
      }
      const current = openSet.splice(lowestIdx, 1)[0];
      openSetMap.delete(`${current.x},${current.z}`);

      // Check if reached goal
      if (current.x === endX && current.z === endZ) {
        // Reconstruct path
        const path = [];
        let node = current;
        while (node) {
          path.unshift({ x: node.x, z: node.z });
          node = node.parent;
        }
        return path;
      }

      closedSet.add(`${current.x},${current.z}`);

      // Check 4 neighbors (no diagonals for cleaner corridor navigation)
      const neighbors = [
        { x: current.x + 1, z: current.z },
        { x: current.x - 1, z: current.z },
        { x: current.x, z: current.z + 1 },
        { x: current.x, z: current.z - 1 },
      ];

      for (const n of neighbors) {
        if (n.x < 0 || n.x >= width || n.z < 0 || n.z >= height) continue;
        if (closedSet.has(`${n.x},${n.z}`)) continue;
        if (maze[n.z] && maze[n.z][n.x] === 1) continue; // Wall

        const g = current.g + 1;
        const key = `${n.x},${n.z}`;
        const existing = openSetMap.get(key);

        if (existing) {
          if (g < existing.g) {
            existing.g = g;
            existing.f = g + existing.h;
            existing.parent = current;
          }
        } else {
          const h = Math.abs(endX - n.x) + Math.abs(endZ - n.z);
          const newNode = { x: n.x, z: n.z, g, h, f: g + h, parent: current };
          openSet.push(newNode);
          openSetMap.set(key, newNode);
        }
      }
    }

    return null; // No path found
  }

  /**
   * Find nearest walkable cell to a wall cell
   */
  _findNearestWalkable(x, z, maze, width, height) {
    for (let r = 1; r <= 3; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nx < width && nz >= 0 && nz < height) {
            if (!maze[nz] || maze[nz][nx] !== 1) {
              return { x: nx, z: nz };
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Greedy fallback with wall sliding for when A* fails
   * Now with steering correction to prevent corner snagging
   */
  _getGreedyDirection(ghostPos, targetPos, cellSize) {
    const dx = targetPos.x - ghostPos.x;
    const dz = targetPos.z - ghostPos.z;

    // Primary direction toward target
    const primaryDir = new THREE.Vector3(dx, 0, dz);
    if (primaryDir.lengthSq() < 0.001) return new THREE.Vector3();
    primaryDir.normalize();

    // Check if primary direction is walkable
    const testDist = this.radius * 2;
    const testX = ghostPos.x + primaryDir.x * testDist;
    const testZ = ghostPos.z + primaryDir.z * testDist;

    if (this._isWorldPosWalkable(testX, testZ)) {
      return primaryDir;
    }

    // WALL SLIDING: Try perpendicular directions
    const perp1 = new THREE.Vector3(-primaryDir.z, 0, primaryDir.x);
    const perp2 = new THREE.Vector3(primaryDir.z, 0, -primaryDir.x);

    // Test which perpendicular gets us closer to target
    const test1X = ghostPos.x + perp1.x * testDist;
    const test1Z = ghostPos.z + perp1.z * testDist;
    const test2X = ghostPos.x + perp2.x * testDist;
    const test2Z = ghostPos.z + perp2.z * testDist;

    const walk1 = this._isWorldPosWalkable(test1X, test1Z);
    const walk2 = this._isWorldPosWalkable(test2X, test2Z);

    if (walk1 && walk2) {
      // Both work - pick the one that gets closer to target
      const dist1 = (test1X - targetPos.x) ** 2 + (test1Z - targetPos.z) ** 2;
      const dist2 = (test2X - targetPos.x) ** 2 + (test2Z - targetPos.z) ** 2;
      return dist1 < dist2 ? perp1 : perp2;
    } else if (walk1) {
      return perp1;
    } else if (walk2) {
      return perp2;
    }

    // Try 8 cardinal directions as last resort
    const directions = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0.707, 0, 0.707),
      new THREE.Vector3(-0.707, 0, 0.707),
      new THREE.Vector3(0.707, 0, -0.707),
      new THREE.Vector3(-0.707, 0, -0.707),
    ];

    let bestDir = null;
    let bestDist = Infinity;

    for (const dir of directions) {
      const tX = ghostPos.x + dir.x * testDist;
      const tZ = ghostPos.z + dir.z * testDist;

      if (this._isWorldPosWalkable(tX, tZ)) {
        const dist = (tX - targetPos.x) ** 2 + (tZ - targetPos.z) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          bestDir = dir.clone();
        }
      }
    }

    return bestDir || new THREE.Vector3();
  }

  /**
   * Raycast-style wall detection along a direction
   * Returns distance to nearest wall, or Infinity if clear
   */
  _raycastWallCheck(startX, startZ, dirX, dirZ, maxDist = 2.0) {
    if (!this.mazeData) return Infinity;

    const steps = 5; // Sample 5 points along the ray
    const stepSize = maxDist / steps;

    for (let i = 1; i <= steps; i++) {
      const checkX = startX + dirX * stepSize * i;
      const checkZ = startZ + dirZ * stepSize * i;

      if (!this._isWorldPosWalkable(checkX, checkZ)) {
        return stepSize * i; // Distance to wall
      }
    }

    return Infinity; // No wall detected
  }

  /**
   * Check walls in multiple directions and find best movement direction
   * Used for wall avoidance when direct path is blocked
   */
  _getWallAvoidanceDirection(currentX, currentZ, targetX, targetZ) {
    const toTarget = new THREE.Vector3(
      targetX - currentX,
      0,
      targetZ - currentZ,
    ).normalize();

    // Check direct path first
    const directDist = this._raycastWallCheck(
      currentX,
      currentZ,
      toTarget.x,
      toTarget.z,
    );
    if (directDist > 1.5) {
      return toTarget; // Direct path is clear
    }

    // SYMMETRIC WALL SENSING: Check both perpendicular directions equally
    const perp1 = new THREE.Vector3(-toTarget.z, 0, toTarget.x);
    const perp2 = new THREE.Vector3(toTarget.z, 0, -toTarget.x);

    const dist1 = this._raycastWallCheck(currentX, currentZ, perp1.x, perp1.z);
    const dist2 = this._raycastWallCheck(currentX, currentZ, perp2.x, perp2.z);

    // Calculate wall bias: positive = more room on perp1 side
    const wallBias = dist1 - dist2;

    if (dist1 > 1.5 || dist2 > 1.5) {
      // At least one side is clear
      const check1 = new THREE.Vector3(
        currentX + perp1.x,
        0,
        currentZ + perp1.z,
      );
      const check2 = new THREE.Vector3(
        currentX + perp2.x,
        0,
        currentZ + perp2.z,
      );
      const target = new THREE.Vector3(targetX, 0, targetZ);

      if (dist1 > 1.5 && dist2 > 1.5) {
        // Both sides clear - blend based on wall bias AND target proximity
        const targetDist1 = check1.distanceTo(target);
        const targetDist2 = check2.distanceTo(target);

        // Score each direction: prefer closer to target AND more open space
        const score1 = dist1 / 4.0 - targetDist1 / 20.0; // Normalize scores
        const score2 = dist2 / 4.0 - targetDist2 / 20.0;

        // Blend the two perpendicular directions based on scores
        const totalScore = Math.abs(score1) + Math.abs(score2);
        if (totalScore > 0.01) {
          const weight1 = Math.max(0, score1) / totalScore;
          const weight2 = Math.max(0, score2) / totalScore;

          const blended = new THREE.Vector3(
            perp1.x * weight1 + perp2.x * weight2,
            0,
            perp1.z * weight1 + perp2.z * weight2,
          );

          // Add some forward component toward target
          blended.add(toTarget.clone().multiplyScalar(0.3));
          if (blended.lengthSq() > 0.01) {
            blended.normalize();
          }
          return blended;
        }

        // Fallback: prefer direction closer to target
        return targetDist1 < targetDist2 ? perp1 : perp2;
      }

      // Only one side is clear - use it, but clamp strength
      return dist1 > 1.5 ? perp1 : perp2;
    }

    // Try diagonal directions with symmetric bias consideration
    const diagonals = [
      new THREE.Vector3(0.707, 0, 0.707),
      new THREE.Vector3(-0.707, 0, 0.707),
      new THREE.Vector3(0.707, 0, -0.707),
      new THREE.Vector3(-0.707, 0, -0.707),
    ];

    let bestDir = null;
    let bestScore = -Infinity;

    for (const dir of diagonals) {
      const dist = this._raycastWallCheck(currentX, currentZ, dir.x, dir.z);
      if (dist > 1.5) {
        // Score based on: clearance + target proximity
        const endX = currentX + dir.x * 2;
        const endZ = currentZ + dir.z * 2;
        const targetDist = Math.sqrt(
          (endX - targetX) ** 2 + (endZ - targetZ) ** 2,
        );
        // Clearance bonus (max 0.5) + target proximity score (max 0.5)
        const clearanceScore = Math.min(0.5, dist / 4.0);
        const targetScore = 0.5 - targetDist / 40.0; // Closer to target = higher score
        const score = clearanceScore + targetScore;

        if (score > bestScore) {
          bestScore = score;
          bestDir = dir;
        }
      }
    }

    // Clamp the final avoidance direction strength to prevent wall-magnet
    if (bestDir) {
      // Limit the avoidance vector to prevent over-correction
      const maxAvoidStrength = 0.8;
      if (bestDir.length() > maxAvoidStrength) {
        bestDir.normalize().multiplyScalar(maxAvoidStrength);
      }
      return bestDir;
    }

    return new THREE.Vector3();
  }

  _detectLowEndDevice() {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");

    if (!gl) return true;

    const loseContext = gl.getExtension("WEBGL_lose_context");
    if (loseContext) loseContext.loseContext();

    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
    const cores = navigator.hardwareConcurrency || 2;
    const memory = navigator.deviceMemory || 4;

    return isMobile || cores < 4 || memory < 4;
  }

  _updateRoaming(deltaTime, ghostPos) {
    this.roamingTimer -= deltaTime;

    if (
      this.roamingTimer <= 0 ||
      !this.roamingTarget ||
      (this.roamingTarget &&
        Math.sqrt(
          (this.roamingTarget.x - ghostPos.x) ** 2 +
            (this.roamingTarget.z - ghostPos.z) ** 2,
        ) < 2.0)
    ) {
      this._pickNewRoamingTarget(ghostPos);
      const dur =
        this.roamingInterval.min +
        Math.random() * (this.roamingInterval.max - this.roamingInterval.min);
      this.roamingTimer = dur;
    }

    if (this.roamingTarget) {
      const toTarget = new THREE.Vector3(
        this.roamingTarget.x - ghostPos.x,
        0,
        this.roamingTarget.z - ghostPos.z,
      );

      if (toTarget.lengthSq() > 0.001) {
        this.wanderDir.copy(toTarget.normalize());
      }
    } else {
      this._updateWander(deltaTime, ghostPos);
    }
  }

  _pickNewRoamingTarget(currentPos) {
    // Bias towards player: Stalking behavior
    // 70% chance to roam near player, 30% chance for random roam
    if (this.player && Math.random() < 0.7) {
      const playerPos = this.player.getPosition();
      // Pick a point within 15-25 units of player
      const angle = Math.random() * Math.PI * 2;
      const distance = 15 + Math.random() * 10;

      // Target specifically closer to create tension
      this.roamingTarget = {
        x: playerPos.x + Math.sin(angle) * distance,
        z: playerPos.z + Math.cos(angle) * distance,
      };
      // Ensure this point is strictly valid? _getPathAwareDirection handles invalid targets gracefully
      // But let's try to clamp it to maze bounds at least
      if (this.mazeData) {
        const mazeSize = this.mazeData.width * this.mazeData.cellSize;
        const halfSize = mazeSize / 2;
        this.roamingTarget.x = Math.max(
          -halfSize,
          Math.min(halfSize, this.roamingTarget.x),
        );
        this.roamingTarget.z = Math.max(
          -halfSize,
          Math.min(halfSize, this.roamingTarget.z),
        );
      }
      return;
    }

    if (!this.mazeData) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 5 + Math.random() * 15;
      this.roamingTarget = {
        x: currentPos.x + Math.sin(angle) * distance,
        z: currentPos.z + Math.cos(angle) * distance,
      };
      return;
    }

    const mazeSize = this.mazeData.width * this.mazeData.cellSize;
    const halfSize = mazeSize / 2;

    this.roamingTarget = {
      x: -halfSize + Math.random() * mazeSize,
      z: -halfSize + Math.random() * mazeSize,
    };
  }

  respawnRandomly() {
    const spawn = this._getRandomOpenCell();
    const world =
      spawn && typeof spawn.z === "number"
        ? { x: spawn.x, z: spawn.z }
        : this._cellToWorld(spawn.x, spawn.y);
    const y = 2.0; // Raised height for larger model
    this.bodyPosition.set(world.x, y, world.z);
    this.mesh.position.set(world.x, y, world.z);
    this.currentState = "wander";
    this.lastSeenPlayerPos = null;
    this.searchTimer = 0;
    this._pickNewRoamingTarget({ x: world.x, y: y, z: world.z });
    this._pickNewWanderDir(true);
  }

  _getRandomOpenCell() {
    if (
      this.mazeGenerator &&
      typeof this.mazeGenerator.getRandomOpenCell === "function"
    ) {
      return this.mazeGenerator.getRandomOpenCell();
    }

    if (!this.mazeData || !this.mazeData.maze) return { x: 1, y: 1 };

    const { maze, width, height } = this.mazeData;
    const open = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (maze[y][x] === 0) open.push({ x, y });
      }
    }
    if (open.length === 0) return { x: 1, y: 1 };
    return open[Math.floor(Math.random() * open.length)];
  }

  _cellToWorld(cx, cy) {
    if (
      this.mazeGenerator &&
      typeof this.mazeGenerator.getWorldPosition === "function"
    ) {
      const p = this.mazeGenerator.getWorldPosition(cx, cy);
      return { x: p.x, z: p.z };
    }
    const cell = this.mazeData?.cellSize || 2;
    return { x: cx * cell + cell / 2, z: cy * cell + cell / 2 };
  }

  _isWorldPosWalkable(x, z) {
    if (!this.mazeData) return true;
    const cellSize = this.mazeData.cellSize || 4;
    const ghostRadius = this.radius || 0.4;

    // Check multiple points around ghost body (center + 4 corners)
    const checkPoints = [
      { x: x, z: z }, // Center
      { x: x + ghostRadius, z: z }, // Right
      { x: x - ghostRadius, z: z }, // Left
      { x: x, z: z + ghostRadius }, // Front
      { x: x, z: z - ghostRadius }, // Back
    ];

    for (const point of checkPoints) {
      const mx = Math.floor(point.x / cellSize);
      const my = Math.floor(point.z / cellSize);

      // Bounds check
      if (
        mx < 0 ||
        my < 0 ||
        mx >= this.mazeData.width ||
        my >= this.mazeData.height
      ) {
        return false;
      }

      // Wall check
      if (
        this.mazeGenerator &&
        typeof this.mazeGenerator.isValidPosition === "function"
      ) {
        if (!this.mazeGenerator.isValidPosition(mx, my)) return false;
      } else {
        if (!this.mazeData.maze[my] || this.mazeData.maze[my][mx] !== 0)
          return false;
      }
    }

    return true;
  }

  /**
   * Escape from wall - find nearest walkable cell and teleport there
   */
  _escapeFromWall() {
    if (!this.mazeData) return false;

    const cellSize = this.mazeData.cellSize || 4;
    const currentCellX = Math.floor(this.bodyPosition.x / cellSize);
    const currentCellZ = Math.floor(this.bodyPosition.z / cellSize);

    // Search in expanding rings around current position
    for (let radius = 1; radius <= 5; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue; // Only check ring edges

          const cx = currentCellX + dx;
          const cz = currentCellZ + dz;

          // Check bounds
          if (
            cx < 0 ||
            cz < 0 ||
            cx >= this.mazeData.width ||
            cz >= this.mazeData.height
          )
            continue;

          // Check if walkable
          if (this.mazeData.maze[cz] && this.mazeData.maze[cz][cx] === 0) {
            // Found walkable cell - teleport to center of it
            const newX = (cx + 0.5) * cellSize;
            const newZ = (cz + 0.5) * cellSize;

            console.log(`Ghost: Escaped wall! Moving to cell (${cx}, ${cz})`);
            this.bodyPosition.x = newX;
            this.bodyPosition.z = newZ;
            this.mesh.position.x = newX + this.visualOffset.x;
            this.mesh.position.z = newZ + this.visualOffset.z;
            return true;
          }
        }
      }
    }

    return false; // Could not find escape
  }

  _updateWander(deltaTime, ghostPos) {
    this.wanderTimer -= deltaTime;
    if (this.wanderTimer <= 0) this._pickNewWanderDir();

    const lookAhead = 0.8;
    const nx = ghostPos.x + this.wanderDir.x * lookAhead;
    const nz = ghostPos.z + this.wanderDir.z * lookAhead;
    if (!this._isWorldPosWalkable(nx, nz)) this._pickNewWanderDir();
  }

  _pickNewWanderDir(resetTimer = false) {
    const angle = Math.random() * Math.PI * 2;
    this.wanderDir.set(Math.sin(angle), 0, Math.cos(angle)).normalize();
    const dur =
      this.wanderInterval.min +
      Math.random() * (this.wanderInterval.max - this.wanderInterval.min);
    this.wanderTimer = resetTimer ? dur : Math.max(this.wanderTimer, dur);
  }
  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }
    if (this.body) {
      this.physicsSystem.removeBody(this.body);
    }
  }
}
