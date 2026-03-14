import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { getAudioManager } from "../systems/AudioManager.js";
import { AnimationManager } from "../systems/AnimationManager.js";
import { getAssetLoader } from "../systems/AssetLoader.js";

// Helper for angle interpolation supporting wraparound
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

/**
 * Player - Rapier Physics based player controller
 * Uses Kinematic Character Controller for proper collision handling
 */
export class Player {
  constructor(physicsSystem, scene, camera, config = {}) {
    // Store reference to physics system (Rapier wrapper)
    this.physicsSystem = physicsSystem;

    // Configuration with defaults (user-tuned values)
    this.config = {
      radius: config.radius || 0.5, // Increased from 0.35 for larger player
      height: config.height || 2.5, // Increased from 2.0 for taller player
      mass: config.mass || 70,
      speed: config.speed || 6.0,
      sprintMultiplier: config.sprintMultiplier || 2.0,
      acceleration: config.acceleration || 60.0,
      jumpHeight: config.jumpHeight || 2.0, // Meters
      airControl: config.airControl || 0.3,
      coyoteTime: config.coyoteTime || 0.1,
      startPosition: config.startPosition || new THREE.Vector3(0, 3, 0),
      stepHeight: config.stepHeight || 0.4,
      maxSlope: config.maxSlope || (45 * Math.PI) / 180,
      gravity: config.gravity || -25.0,
      characterType: config.characterType || "male",
    };

    this.scene = scene;
    this.camera = camera;

    // Physics objects (will be created in _createPhysicsBody)
    this.body = null;
    this.collider = null;
    this.characterController = null;

    // Velocity tracking (kinematic bodies don't have velocity)
    this.velocity = new THREE.Vector3();

    // State
    this.grounded = false;
    this.lastGroundedTime = -Infinity;
    this.jumpedThisPress = false;
    this.jumpCooldown = 0;
    this.jumpRequested = false;
    this.wasJumpPressed = false;
    this.isSprinting = false;
    this.currentSpeed = this.config.speed;
    this.wasGroundedLastFrame = false;

    // Input state
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      sprint: false,
    };

    // Mouse state
    this.mouse = {
      enabled: false,
      sensitivity: 0.002,
      holdRotate: false,
    };

    // State flags
    this.isDead = false;
    this.isInvincible = false;
    this.isFlashlightOn = true;
    this.controlsInverted = false;
    this.controlsDisabled = false; // Set by CaptureSystem
    this.visualOffset = { x: 0, y: 0, z: 0 };

    // Health System (3-tier survivability)
    this.health = 100;
    this.maxHealth = 100;
    this.injuryState = "healthy"; // healthy, injured, critical, captured, dead

    // Camera control (yaw/pitch exposed for CaptureSystem)
    this.yaw = 0;
    this.pitch = 0;

    // Touch input state
    this.touchInput = {
      moveForward: 0,
      moveRight: 0,
      lookDeltaX: 0,
      lookDeltaY: 0,
      sprint: false,
      jump: false,
    };
    this.useTouchControls = false;

    // Camera state
    this.firstPerson = true;
    this.cameraDistance = 0.2;
    // cameraPitch is a spherical polar angle: 0 = straight down, 90° = horizontal, 180° = straight up
    this.cameraPitch = THREE.MathUtils.degToRad(90); // Start horizontal
    this.cameraYaw = Math.PI;
    this.targetCameraDistance = 0.2;
    this.targetCameraPitch = THREE.MathUtils.degToRad(90);

    // Head bobbing state
    this.headBobTime = 0;
    this.headBobIntensity = 0;
    this.headBobTargetIntensity = 0;

    // Animation state
    this.mixer = null;
    this.animations = { idle: null, walk: null, run: null };
    this.currentAction = null;
    this.currentAnimState = "idle";
    this.modelLoaded = false;

    // Reusable vectors (GC optimization)
    this.tempVec3 = new THREE.Vector3();
    this.tempVec3_2 = new THREE.Vector3();
    this._upVector = new THREE.Vector3(0, 1, 0); // Constant up vector
    this._moveVec = new THREE.Vector3(); // Reusable for movement input

    // Player rotation (yaw)
    this.rotationY = 0;

    // Initialize
    this.isLowEndDevice = this._detectLowEndDevice();
    this._createPhysicsBody();
    this._createVisualMesh();
    this._setupInput();

    // Position Proxy for external access (Matches Ghost.js API)
    this._dummyPos = new THREE.Vector3();
    const self = this;
    this.bodyPosition = {
      get x() {
        if (self.body) return self.body.translation().x;
        return self.mesh ? self.mesh.position.x : 0;
      },
      get y() {
        if (self.body) return self.body.translation().y;
        return self.mesh ? self.mesh.position.y : 0;
      },
      get z() {
        if (self.body) return self.body.translation().z;
        return self.mesh ? self.mesh.position.z : 0;
      },
    };
  }

  setUseTouchControls(useTouch) {
    this.useTouchControls = useTouch;
    if (useTouch) {
      console.log("[Player] Touch controls enabled");
    }
  }

  _createPhysicsBody() {
    const pos = this.config.startPosition;
    const radius = this.config.radius;
    const height = this.config.height;

    // Create kinematic player using PhysicsSystem
    const result = this.physicsSystem.createKinematicPlayer(
      { x: pos.x, y: pos.y, z: pos.z },
      radius,
      height,
      {
        maxSlope: this.config.maxSlope,
        stepHeight: this.config.stepHeight,
      },
    );

    if (result) {
      this.body = result.body;
      this.collider = result.collider;
      this.characterController = result.characterController;
      console.log("[Player] Rapier physics body created");
    } else {
      console.error("[Player] Failed to create physics body");
    }
  }

  rebuildPhysics() {
    // Remove old physics objects
    if (this.body) {
      this.physicsSystem.removeBody(this.body);
    }

    // Recreate physics body
    this._createPhysicsBody();
  }

  toggleFlashlight() {
    this.isFlashlightOn = !this.isFlashlightOn;
    console.log("Flashlight toggled:", this.isFlashlightOn ? "ON" : "OFF");
    getAudioManager().playButtonClick();
  }

  _createVisualMesh() {
    // Create a group to hold the character model
    this.mesh = new THREE.Group();

    // Create fallback capsule (shown until FBX loads or in first person)
    const radius = this.config.radius;
    const bodyHeight = this.config.height - 2 * radius;
    const geometry = new THREE.CapsuleGeometry(radius, bodyHeight, 8, 16);

    const material = new THREE.MeshStandardMaterial({
      color: 0x4cc9f0,
      metalness: 0.1,
      roughness: 0.6,
    });

    this.fallbackMesh = new THREE.Mesh(geometry, material);
    this.fallbackMesh.castShadow = true;

    this.mesh.add(this.fallbackMesh);
    this.scene.add(this.mesh);

    // Load the FBX character model
    this._loadCharacterModel();
  }

  async _loadCharacterModel() {
    const charType = this.config.characterType; // "male" or "female"
    const assetLoader = getAssetLoader();

    // Cache key mapping based on character type
    const modelCacheKey = charType === "female" ? "femaleModel" : "maleModel";
    const animCacheMap =
      charType === "female"
        ? {
            idle: "femaleIdle",
            walk: "femaleWalk",
            run: "femaleRun",
            jump: null, // female jump not in manifest
          }
        : {
            idle: "maleIdle",
            walk: "maleWalk",
            run: "maleRun",
            jump: "maleJump",
          };

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

    let fallbackLoader = null; // Lazy-init only if needed

    try {
      // TRY TO USE CACHED MODEL
      let model = null;
      const cachedModel = assetLoader.getModel(modelCacheKey);

      if (cachedModel) {
        // Clone using SkeletonUtils for proper skinned mesh handling
        model = SkeletonUtils.clone(cachedModel);
        console.log(`[Player] Using CACHED ${charType} model (no FBX parsing)`);
      } else {
        // Fallback: load fresh
        console.log(`[Player] Cache miss, loading ${charType} model fresh...`);
        fallbackLoader = new FBXLoader();
        const basePath = `./assets/${charType}/`;
        model = await fallbackLoader.loadAsync(
          basePath + `model/${charType}.fbx`,
        );
      }

      // Scale and position the model
      let finalScale = 1.0;
      if (charType === "female") {
        finalScale = 0.01;
      }

      model.scale.setScalar(finalScale);
      model.position.y = -this.config.height / 2;

      // Apply materials to all meshes
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          // Disable receiveShadow to prevent "16 texture units" error on some GPUs
          // when combined with complex PBR material + multiple shadow casting lights
          child.receiveShadow = false;

          // Preserve existing materials/textures!
          if (child.material) {
            if (child.material.map) {
              child.material.envMapIntensity = 1;
              child.material.needsUpdate = true;
            } else {
              // Fallback Material (Debug Blue)
              child.material = new THREE.MeshStandardMaterial({
                color: 0x2e9afe,
                metalness: 0.1,
                roughness: 0.5,
              });
            }
          }
        }
      });

      // Remove fallback mesh and add the model
      if (this.fallbackMesh) {
        this.mesh.remove(this.fallbackMesh);
        if (this.fallbackMesh.geometry) this.fallbackMesh.geometry.dispose();
        if (this.fallbackMesh.material) this.fallbackMesh.material.dispose();
        this.fallbackMesh = null;
      }

      this.mesh.add(model);
      this.loadedModel = model;

      // Setup animation mixer and manager
      this.mixer = new THREE.AnimationMixer(model);
      this.animationManager = new AnimationManager(this.mixer);

      // Load animations (using cache when available)
      const animConfigs = [
        { name: "idle", loop: "repeat" },
        { name: "walk", loop: "repeat" },
        { name: "run", loop: "repeat" },
        { name: "jump", loop: "once" },
      ];

      for (const animConfig of animConfigs) {
        try {
          const cacheKey = animCacheMap[animConfig.name];
          let animFBX = null;

          if (cacheKey) {
            animFBX = assetLoader.getModel(cacheKey);
          }

          if (animFBX) {
            console.log(`[Player] Using CACHED ${animConfig.name} animation`);
            if (animFBX.animations && animFBX.animations.length > 0) {
              // Clone the clip to avoid modifying cached version
              const clip = animFBX.animations[0].clone();
              this.animationManager.addAnimation(animConfig.name, clip, {
                loop: animConfig.loop,
              });
            }
          } else {
            // Fallback: load fresh
            if (!fallbackLoader) {
              fallbackLoader = new FBXLoader();
            }
            const basePath = `./assets/${charType}/`;
            console.log(
              `[Player] Cache miss, loading ${animConfig.name} animation...`,
            );
            const anim = await fallbackLoader.loadAsync(
              basePath + `animations/${animConfig.name}.fbx`,
            );
            if (anim.animations && anim.animations.length > 0) {
              this.animationManager.addAnimation(
                animConfig.name,
                anim.animations[0],
                { loop: animConfig.loop },
              );
            }
          }
        } catch (animError) {
          console.warn(`Player: Could not load ${animConfig.name} animation`);
        }
      }

      // AnimationManager auto-starts idle if available

      this.modelLoaded = true;
      console.log(`[Player] ${charType} model ready`);
    } catch (error) {
      console.warn("Player: Using fallback capsule mesh", error);
    } finally {
      // Restore warning
      console.warn = originalWarn;
    }
  }

  _updateAnimation(deltaTime) {
    // Delegate entirely to AnimationManager
    if (this.animationManager) {
      this.animationManager.update(deltaTime, {
        velocity: this.velocity,
        grounded: this.grounded,
        isSprinting: this.isSprinting,
      });
    } else if (this.mixer) {
      // Fallback if manager not available
      this.mixer.update(deltaTime);
    }
  }

  _setupInput() {
    const keyMap = {
      KeyW: "forward",
      ArrowUp: "forward",
      KeyS: "backward",
      ArrowDown: "backward",
      KeyA: "left",
      ArrowLeft: "left",
      KeyD: "right",
      ArrowRight: "right",
      Space: "jump",
      ShiftLeft: "sprint",
      ShiftRight: "sprint",
    };

    this._onKeyDown = (e) => {
      const action = keyMap[e.code];
      if (action) {
        e.preventDefault();
        this.keys[action] = true;
      }
      if (e.code === "KeyV") this.toggleFirstPerson();
      if (e.code === "KeyR") this.reset();
    };

    this._onKeyUp = (e) => {
      const action = keyMap[e.code];
      if (action) {
        this.keys[action] = false;
        if (action === "jump") {
          this.jumpRequested = false;
          if (this.grounded) this.jumpedThisPress = false;
        }
      }
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);

    this._onPointerLockClick = () => {
      if (!document.pointerLockElement) document.body.requestPointerLock();
    };

    this._onPointerLockChange = () => {
      this.mouse.enabled = document.pointerLockElement === document.body;
    };

    window.addEventListener("click", this._onPointerLockClick);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);

    this._onMouseMove = (e) => {
      if (!this.mouse.enabled) return;
      this.cameraYaw -= e.movementX * this.mouse.sensitivity;
      this.cameraPitch -= e.movementY * this.mouse.sensitivity;
      // Clamp pitch within safe spherical polar angle range to prevent camera flip
      // Using 10° (looking nearly straight down) to 170° (looking nearly straight up)
      // This matches the spherical coordinate system used in _updateCamera
      this.cameraPitch = THREE.MathUtils.clamp(
        this.cameraPitch,
        THREE.MathUtils.degToRad(10),
        THREE.MathUtils.degToRad(170),
      );
    };

    window.addEventListener("mousemove", this._onMouseMove);

    this._onMouseDown = (e) => {
      if (e.button === 2) {
        e.preventDefault();
        this.mouse.holdRotate = true;
      }
    };

    this._onMouseUp = (e) => {
      if (e.button === 2) this.mouse.holdRotate = false;
    };

    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener("mousedown", this._onMouseDown);
    window.addEventListener("mouseup", this._onMouseUp);
    window.addEventListener("contextmenu", this._onContextMenu);
  }

  _getMovementInput() {
    this.camera.getWorldDirection(this.tempVec3);
    this.tempVec3.y = 0;
    this.tempVec3.normalize();

    this.tempVec3_2.crossVectors(this.tempVec3, this._upVector).normalize();

    const move = this._moveVec.set(0, 0, 0);

    // Use touch input if enabled, otherwise use keyboard
    if (
      this.useTouchControls &&
      (Math.abs(this.touchInput.moveForward) > 0.01 ||
        Math.abs(this.touchInput.moveRight) > 0.01)
    ) {
      move.addScaledVector(this.tempVec3, this.touchInput.moveForward);
      move.addScaledVector(this.tempVec3_2, this.touchInput.moveRight);
    } else {
      if (this.keys.forward) move.add(this.tempVec3);
      if (this.keys.backward) move.sub(this.tempVec3);
      if (this.keys.right) move.add(this.tempVec3_2);
      if (this.keys.left) move.sub(this.tempVec3_2);
    }

    if (move.lengthSq() > 0) move.normalize();
    return move;
  }

  onGhostAttack() {
    if (this.isInvincible) {
      console.log("Player attacked but is INVINCIBLE!");
      return;
    }
    this.isDead = true;
    console.log("Player caught by ghost!");

    // Play player death sound
    getAudioManager().playDeathScream();

    window.dispatchEvent(
      new CustomEvent("ghostAttack", { detail: { player: this } }),
    );
  }

  takeDamage(amount) {
    if (this.isInvincible || this.isDead || this.injuryState === "captured")
      return;

    // Apply damage to HP
    this.health = Math.max(0, this.health - amount);
    console.log(
      `[Player] Took ${amount} damage! HP: ${this.health}/${this.maxHealth}`,
    );

    // Update injury state based on HP thresholds
    this._updateInjuryState();

    // Trigger HUD feedback
    if (window.game && window.game.hud) {
      window.game.hud.triggerDamagePulse();
      window.game.hud.updateHealth?.(this.health, this.maxHealth);
    }

    // Audio feedback based on injury state
    if (this.injuryState === "critical") {
      getAudioManager().playHeavyBreathing?.();
    }
  }

  _updateInjuryState() {
    const prevState = this.injuryState;

    if (this.health >= 60) {
      this.injuryState = "healthy";
    } else if (this.health >= 30) {
      this.injuryState = "injured";
    } else if (this.health > 0) {
      this.injuryState = "critical";
    } else {
      // Health is 0 - mark as dead state but DON'T set isDead=true here
      // Game.js will handle the actual death sequence
      this.injuryState = "dead";
      // Note: isDead is set by Game.js death handler, not here!
    }

    if (prevState !== this.injuryState) {
      console.log(`[Player] Injury state: ${prevState} → ${this.injuryState}`);
      window.dispatchEvent(
        new CustomEvent("playerInjuryChange", {
          detail: { state: this.injuryState, health: this.health },
        }),
      );
    }
  }

  startCapture(ghost) {
    // Called by Ghost when attack lands - initiates capture sequence
    if (this.injuryState === "captured" || this.isDead) return;

    console.log("[Player] CAPTURE INITIATED BY GHOST");
    this.injuryState = "captured";
    this.controlsDisabled = true;

    // Play death scream
    getAudioManager().playDeathScream();

    // Dispatch event for CaptureSystem to handle
    window.dispatchEvent(
      new CustomEvent("playerCaptured", {
        detail: { player: this, ghost: ghost },
      }),
    );
  }

  applySlow(factor, duration) {
    this.slowFactor = factor;
    this.slowTimer = duration;
  }

  update(deltaTime, currentTime) {
    if (!this.body || !this.characterController) return;

    // Capture system disables controls - only update camera during capture
    if (this.controlsDisabled) {
      // Sync exposed yaw/pitch to camera (CaptureSystem controls these)
      this.cameraYaw = this.yaw || this.cameraYaw;
      this.cameraPitch = this.pitch || this.cameraPitch;
      this._updateCamera(deltaTime, new THREE.Vector3());
      return;
    }

    // Handle Slow Timer
    if (this.slowTimer > 0) {
      this.slowTimer -= deltaTime;
      if (this.slowTimer <= 0) {
        this.slowFactor = 1.0;
      }
    } else {
      this.slowFactor = 1.0;
    }

    // Update character animation
    this._updateAnimation(deltaTime);

    // Get grounded state from character controller
    this.grounded = this.characterController.computedGrounded();

    if (this.grounded) {
      this.lastGroundedTime = currentTime;
    }

    if (this.grounded && !this.wasGroundedLastFrame) {
      this.jumpedThisPress = false;
      this.jumpRequested = false;
    }
    this.wasGroundedLastFrame = this.grounded;

    // Get movement input
    const moveDir = this._getMovementInput();

    // Apply confusion effect - invert controls if active
    if (this.controlsInverted) {
      moveDir.x = -moveDir.x;
      moveDir.z = -moveDir.z;
    }

    // Calculate rotation from camera
    this.rotationY = this.cameraYaw;

    // Sprint handling
    const isSprintInput =
      this.keys.sprint || (this.useTouchControls && this.touchInput.sprint);
    this.isSprinting = isSprintInput && this.grounded && moveDir.lengthSq() > 0;
    this.currentSpeed = this.isSprinting
      ? this.config.speed * this.config.sprintMultiplier
      : this.config.speed;

    // Apply Slow Factor
    if (this.slowFactor) {
      this.currentSpeed *= this.slowFactor;
    }

    // Calculate target velocity (using moveDir directly - it's already a reusable vector)
    const targetX = moveDir.x * this.currentSpeed;
    const targetZ = moveDir.z * this.currentSpeed;

    // Adjust acceleration based on grounded state
    const accel = this.grounded
      ? this.config.acceleration
      : this.config.acceleration * this.config.airControl;

    // Move current velocity towards target
    const factor = Math.min(accel * deltaTime, 1.0);
    this.velocity.x += (targetX - this.velocity.x) * factor;
    this.velocity.z += (targetZ - this.velocity.z) * factor;

    // Vertical velocity (gravity & jump)
    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = -0.1; // Stick to ground slightly
    }

    // Jump handling
    const isJumpInput =
      this.keys.jump || (this.useTouchControls && this.touchInput.jump);
    const jumpPressedThisFrame = isJumpInput && !this.wasJumpPressed;
    this.wasJumpPressed = isJumpInput;

    const canRequestJump =
      (this.grounded ||
        currentTime - this.lastGroundedTime <= this.config.coyoteTime) &&
      !this.jumpedThisPress &&
      this.jumpCooldown <= 0;

    if (jumpPressedThisFrame && canRequestJump) this.jumpRequested = true;
    if (!this.grounded && this.jumpedThisPress) this.jumpRequested = false;

    const canJump = canRequestJump && this.jumpRequested;

    if (canJump) {
      // Jump velocity = sqrt(2 * |gravity| * jumpHeight)
      this.velocity.y = Math.sqrt(
        2 * Math.abs(this.config.gravity) * this.config.jumpHeight,
      );
      this.jumpedThisPress = true;
      this.jumpRequested = false;
      this.jumpCooldown = 0.2;
    }

    // Apply gravity
    this.velocity.y += this.config.gravity * deltaTime;

    if (this.jumpCooldown > 0) this.jumpCooldown -= deltaTime;

    // Compute movement using Rapier character controller
    const movement = {
      x: this.velocity.x * deltaTime,
      y: this.velocity.y * deltaTime,
      z: this.velocity.z * deltaTime,
    };

    this.characterController.computeColliderMovement(this.collider, movement);

    // Apply corrected movement
    const correctedMovement = this.characterController.computedMovement();
    const currentPos = this.body.translation();

    const newPos = {
      x: currentPos.x + correctedMovement.x,
      y: currentPos.y + correctedMovement.y,
      z: currentPos.z + correctedMovement.z,
    };

    this.body.setNextKinematicTranslation(newPos);

    // Play/Stop footstep sounds based on movement and ground state
    const horizontalSpeed = Math.sqrt(
      this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z,
    );
    const isMoving = moveDir.lengthSq() > 0.01 && horizontalSpeed > 0.5;

    if (this.grounded && isMoving) {
      getAudioManager().playFootstep(this.isSprinting);
    } else {
      getAudioManager().stopFootstep();
    }

    // Update visual mesh position
    this.mesh.position.set(
      newPos.x + this.visualOffset.x,
      newPos.y + this.visualOffset.y,
      newPos.z + this.visualOffset.z,
    );

    this._updateHeadBobbing(deltaTime, moveDir);
    this._updateCharacterRotation(deltaTime, moveDir);
    this._updateCamera(deltaTime, moveDir);

    this.mesh.visible = !this.firstPerson;
  }

  onGhostAttack() {
    if (this.isInvincible) {
      console.log("Player attacked but is INVINCIBLE!");
      return;
    }
    this.isDead = true;
    console.log("Player caught by ghost!");

    // Play player death sound
    getAudioManager().playDeathScream();

    window.dispatchEvent(
      new CustomEvent("ghostAttack", { detail: { player: this } }),
    );
  }

  _updateCharacterRotation(deltaTime, moveDir) {
    if (!this.mesh) return;

    let targetRotation = this.mesh.rotation.y;

    if (this.firstPerson) {
      targetRotation = this.cameraYaw + Math.PI;
    } else if (moveDir.lengthSq() > 0.01) {
      targetRotation = Math.atan2(moveDir.x, moveDir.z);
    }

    this.mesh.rotation.y = lerpAngle(
      this.mesh.rotation.y,
      targetRotation,
      Math.min(1, 10 * deltaTime),
    );
  }

  _updateHeadBobbing(deltaTime, moveDir) {
    if (this.firstPerson && this.grounded && moveDir.lengthSq() > 0.01) {
      const horizontalSpeed = Math.sqrt(
        this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z,
      );
      this.headBobTargetIntensity = Math.min(
        1,
        horizontalSpeed / this.config.speed,
      );
      const bobSpeed = this.isSprinting ? 14 : 10;
      this.headBobTime += deltaTime * bobSpeed;
    } else {
      this.headBobTargetIntensity = 0;
    }

    const smoothFactor = 1 - Math.exp(-15 * deltaTime);
    this.headBobIntensity = THREE.MathUtils.lerp(
      this.headBobIntensity,
      this.headBobTargetIntensity,
      smoothFactor,
    );
  }

  _updateCamera(deltaTime, moveDir) {
    if (this.firstPerson) {
      this.targetCameraDistance = 0.2;
      // FPP: Slightly looking down (100° from vertical = 10° below horizontal)
      this.targetCameraPitch = THREE.MathUtils.degToRad(100);
    } else {
      this.targetCameraDistance = 6.0;
      // TPP: Looking down at player (55° from horizontal = 55° polar angle)
      this.targetCameraPitch = THREE.MathUtils.degToRad(55);
    }

    // Smoother transition (slower exponential decay)
    const smoothFactor = 1 - Math.exp(-4 * deltaTime); // Reduced from 8 to 4 for cinematic feel
    this.cameraDistance = THREE.MathUtils.lerp(
      this.cameraDistance,
      this.targetCameraDistance,
      smoothFactor,
    );

    // disable auto pitch reset
    // if (!this.mouse.enabled) {
    //   this.cameraPitch = THREE.MathUtils.lerp(
    //     this.cameraPitch,
    //     this.targetCameraPitch,
    //     smoothFactor
    //   );
    // }

    if (moveDir.lengthSq() > 0.01 && !this.firstPerson && !this.mouse.enabled) {
      const targetYaw = Math.atan2(moveDir.x, moveDir.z) + Math.PI;
      const yawDiff =
        THREE.MathUtils.euclideanModulo(
          targetYaw - this.cameraYaw + Math.PI,
          Math.PI * 2,
        ) - Math.PI;
      this.cameraYaw += yawDiff * smoothFactor * 0.5;
    }

    const headHeight = this.config.height * 0.45;

    let bobOffset = 0;
    let bobSway = 0;
    if (this.firstPerson && this.headBobIntensity > 0.01) {
      bobOffset = Math.sin(this.headBobTime) * 0.08 * this.headBobIntensity;
      bobSway = Math.sin(this.headBobTime * 0.5) * 0.03 * this.headBobIntensity;
    }

    const targetPos = this.tempVec3.set(
      this.mesh.position.x + bobSway,
      this.mesh.position.y + headHeight + bobOffset,
      this.mesh.position.z,
    );

    const camOffset = this.tempVec3_2.set(
      this.cameraDistance *
        Math.sin(this.cameraPitch) *
        Math.sin(this.cameraYaw),
      this.cameraDistance * Math.cos(this.cameraPitch),
      this.cameraDistance *
        Math.sin(this.cameraPitch) *
        Math.cos(this.cameraYaw),
    );

    const desiredPos = new THREE.Vector3(
      targetPos.x + camOffset.x,
      targetPos.y + camOffset.y,
      targetPos.z + camOffset.z,
    );

    // === IMPROVED CAMERA COLLISION (Spring Arm) ===
    // Only check collision in third-person mode
    if (!this.firstPerson && this.cameraDistance > 0.5) {
      const direction = new THREE.Vector3()
        .subVectors(desiredPos, targetPos)
        .normalize();
      const distance = desiredPos.distanceTo(targetPos);

      // Cast from slightly behind player head to avoid starting inside geometry
      const castOrigin = targetPos.clone().addScaledVector(direction, 0.3);
      const castDistance = distance - 0.3;

      // Primary raycast
      const hit = this.physicsSystem.raycast(
        castOrigin,
        direction,
        castDistance,
      );

      // Check for wall collision
      let finalDist = distance;
      if (
        hit &&
        hit.collider &&
        hit.collider.handle !== this.collider?.handle
      ) {
        // Wall detected - push camera forward
        const safeOffset = 0.5; // Larger offset for safety
        finalDist = Math.max(0.8, hit.distance + 0.3 - safeOffset);

        // Smooth the transition to prevent jarring camera movement
        if (this._lastCameraDist === undefined)
          this._lastCameraDist = finalDist;
        finalDist = THREE.MathUtils.lerp(this._lastCameraDist, finalDist, 0.3);
        this._lastCameraDist = finalDist;

        this.camera.position
          .copy(targetPos)
          .addScaledVector(direction, finalDist);
      } else {
        // No collision - move to desired position smoothly
        if (this._lastCameraDist !== undefined) {
          const targetDist = distance;
          this._lastCameraDist = THREE.MathUtils.lerp(
            this._lastCameraDist,
            targetDist,
            0.1,
          );
        }
        this.camera.position.copy(desiredPos);
      }
    } else {
      // First person - no collision needed
      this.camera.position.copy(desiredPos);
    }

    this.camera.lookAt(targetPos);

    // --- DYNAMIC FOV ---
    // User requested narrow "non-wide" look. Base = 45. Sprint -> 52.
    const targetFOV = this.isSprinting ? 52 : 45;
    const fovLerpSpeed = 5 * deltaTime;
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      targetFOV,
      fovLerpSpeed,
    );
    this.camera.updateProjectionMatrix();
  }

  toggleFirstPerson() {
    this.firstPerson = !this.firstPerson;
    this.mesh.visible = !this.firstPerson;
  }

  reset() {
    const pos = this.config.startPosition;
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.velocity.set(0, 0, 0);
    this.jumpedThisPress = false;
    this.jumpCooldown = 0;
    this.jumpRequested = false;
    this.wasJumpPressed = false;
    this.grounded = false;
    this.headBobTime = 0;
    this.headBobIntensity = 0;
    this.headBobTargetIntensity = 0;
  }

  resetToStart(position) {
    // Handle both THREE.Vector3 and plain objects
    const pos =
      position.x !== undefined
        ? position
        : { x: position.x, y: position.y, z: position.z };

    // Update the config start position so 'R' key resets to this new spot
    if (this.config.startPosition instanceof THREE.Vector3) {
      this.config.startPosition.set(pos.x, pos.y, pos.z);
    } else {
      this.config.startPosition = new THREE.Vector3(pos.x, pos.y, pos.z);
    }

    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.velocity.set(0, 0, 0);
  }

  getPosition() {
    const pos = this.body.translation();
    return new THREE.Vector3(pos.x, pos.y, pos.z);
  }

  getVelocity() {
    return this.velocity.clone();
  }

  getRotation() {
    return this.mesh ? this.mesh.rotation.y : 0;
  }

  getAnimationState() {
    const speed = Math.sqrt(
      this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z,
    );
    if (speed > 0.5) {
      return this.isSprinting ? "run" : "walk";
    }
    return "idle";
  }

  _detectLowEndDevice() {
    if (typeof navigator !== "undefined") {
      const cores = navigator.hardwareConcurrency || 1;
      const memory = navigator.deviceMemory || 4;
      return cores <= 2 || memory <= 2;
    }
    return false;
  }

  // Touch Controls API
  setUseTouchControls(enabled) {
    this.useTouchControls = enabled;
    if (enabled) {
      this.firstPerson = true;
      this.mouse.enabled = true;
    }
  }

  setTouchMovement(forward, right) {
    this.touchInput.moveForward = forward;
    this.touchInput.moveRight = right;
  }

  applyTouchLook(deltaX, deltaY) {
    if (!this.useTouchControls) return;
    this.cameraYaw -= deltaX * 0.01;
    this.cameraPitch -= deltaY * 0.01;
    this.cameraPitch = THREE.MathUtils.clamp(
      this.cameraPitch,
      THREE.MathUtils.degToRad(10),
      THREE.MathUtils.degToRad(170),
    );
  }

  setTouchButtons(sprint, jump) {
    if (this.useTouchControls) {
      this.touchInput.sprint = sprint;
      this.touchInput.jump = jump;
      this.keys.sprint = sprint;
      if (jump && !this.keys.jump) {
        this.keys.jump = true;
      } else if (!jump) {
        this.keys.jump = false;
      }
    }
  }

  setProfile(profile) {
    if (!profile) return;

    // Update config based on profile
    if (profile.username) {
      this.username = profile.username;
    }

    // Check if character type changed
    if (
      profile.characterType &&
      profile.characterType !== this.config.characterType
    ) {
      console.log(`Player: Switching character to ${profile.characterType}`);
      this.config.characterType = profile.characterType;

      // Reload model
      this._loadCharacterModel();
    }
  }

  dispose() {
    // 1. Remove Event Listeners
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("click", this._onPointerLockClick);
    document.removeEventListener(
      "pointerlockchange",
      this._onPointerLockChange,
    );
    window.removeEventListener("mousemove", this._onMouseMove);
    window.removeEventListener("mousedown", this._onMouseDown);
    window.removeEventListener("mouseup", this._onMouseUp);
    window.removeEventListener("contextmenu", this._onContextMenu);

    // 2. Physics Cleanup
    if (this.body) {
      this.physicsSystem.removeBody(this.body);
      this.body = null;
    }
    // Note: collider is usually removed with body, but explicitly:
    if (this.collider) {
      this.physicsSystem.removeCollider(this.collider);
      this.collider = null;
    }
    // Controller cleanup? Rapier controller disposal handled by World free in PhysicsSystem?
    // Usually yes, but we can null it.
    this.characterController = null;

    // 3. Visuals Cleanup
    if (this.mesh) {
      this.scene.remove(this.mesh);
      // Traverse and dispose geometry/materials
      this.mesh.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material))
              child.material.forEach((m) => m.dispose());
            else child.material.dispose();
          }
        }
      });
      this.mesh = null;
    }

    // 4. Animation Cleanup
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }

    console.log("[Player] Disposed and listeners removed.");
  }
}
