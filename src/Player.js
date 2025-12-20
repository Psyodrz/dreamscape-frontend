import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { getAudioManager } from './AudioManager.js';

// Helper for angle interpolation supporting wraparound
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

export class Player {
  constructor(world, scene, camera, config = {}) {
    // Configuration with defaults
    this.config = {
      radius: config.radius || 0.4465, // User requested specific radius
      height: config.height || 3.0,    // User requested height 3
      mass: config.mass || 70,
      speed: config.speed || 4,        // Reduced from 7 to 4 for better gameplay
      sprintMultiplier: config.sprintMultiplier || 1.3, // Reduced from 1.5
      acceleration: config.acceleration || 30,
      jumpSpeed: config.jumpSpeed || 7,
      airControl: config.airControl || 0.15,
      coyoteTime: config.coyoteTime || 0.1,
      startPosition: config.startPosition || new THREE.Vector3(0, 3, 0),
      groundCheckDistance: config.groundCheckDistance || 0.15,
      characterType: config.characterType || 'male', // 'male' or 'female'
    };

    this.world = world;
    this.scene = scene;
    this.camera = camera;

    // State
    this.grounded = false;
    this.groundCheckTimer = 0;
    this.lastGroundedTime = -Infinity;
    this.jumpedThisPress = false;
    this.jumpCooldown = 0;
    this.jumpRequested = false;
    this.wasJumpPressed = false;
    this.isSprinting = false;
    this.currentSpeed = this.config.speed;
    this.wasGroundedLastFrame = false;
    this.debugGroundDetection = false;

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
    this.isFlashlightOn = true; // Track flashlight state for stealth
    this.controlsInverted = false; // Confusion trap effect
    // User requested offset 0 to prevent ground clipping
    this.visualOffset = { x: 0, y: 0, z: 0 };

    // Touch input state (from TouchControls)
    this.touchInput = {
      moveForward: 0,
      moveRight: 0,
      lookDeltaX: 0,
      lookDeltaY: 0,
      sprint: false,
      jump: false
    };
    this.useTouchControls = false;

    // Camera state
    this.firstPerson = true;
    this.cameraDistance = 0.2;
    this.cameraPitch = THREE.MathUtils.degToRad(0);
    this.cameraYaw = Math.PI;
    this.targetCameraDistance = 0.2;
    this.targetCameraPitch = THREE.MathUtils.degToRad(0);
    
    // Head bobbing state
    this.headBobTime = 0;
    this.headBobIntensity = 0;
    this.headBobTargetIntensity = 0;

    // Animation state
    this.mixer = null;
    this.animations = { idle: null, walk: null, run: null };
    this.currentAction = null;
    this.currentAnimState = 'idle';
    this.modelLoaded = false;

    // Reusable vectors
    this.tempVec3 = new THREE.Vector3();
    this.tempVec3_2 = new THREE.Vector3();
    this.tempCannonVec = new CANNON.Vec3();

    // Create physics material
    this.material = new CANNON.Material('player');

    // Initialize
    this.isLowEndDevice = this._detectLowEndDevice();
    this._createPhysicsBody();
    this._createVisualMesh();
    this._setupInput();
  }

  _createPhysicsBody() {
    this.rebuildPhysics();
  }

  rebuildPhysics() {
    if (this.body) {
      this.world.removeBody(this.body);
    }

    const radius = this.config.radius;
    const height = this.config.height; 
    
    // CANNON.Capsule takes (radius, height) where height is the distance between sphere centers.
    // Total physical height = height + 2 * radius.
    // So we need to calculate the inner height.
    const cylinderHeight = Math.max(0.1, height - 2 * radius);

    this.body = new CANNON.Body({
      mass: this.config.mass,
      material: this.material,
      position: this.body ? this.body.position : new CANNON.Vec3(
        this.config.startPosition.x,
        this.config.startPosition.y,
        this.config.startPosition.z
      ),
      linearDamping: 0.9,
      angularDamping: 1.0,
      fixedRotation: true,
      allowSleep: false,
    });

    // Use CANNON.Capsule if available
    if (typeof CANNON.Capsule !== 'undefined') {
      try {
        const shape = new CANNON.Capsule(radius, cylinderHeight);
        this.body.addShape(shape);
      } catch (e) {
        this._fallbackPhysicsShape(radius, cylinderHeight);
      }
    } else {
      this._fallbackPhysicsShape(radius, cylinderHeight);
    }

    this.body.updateMassProperties();
    this.world.addBody(this.body);
  }

  _fallbackPhysicsShape(radius, cylinderHeight) {
      console.warn('Using physics fallback: Cylinder + Espheres');
      const shape = new CANNON.Cylinder(radius, radius, cylinderHeight, 8);
      const q = new CANNON.Quaternion();
      q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); 
      this.body.addShape(shape, new CANNON.Vec3(0, 0, 0), q);
      
      const sphere = new CANNON.Sphere(radius);
      this.body.addShape(sphere, new CANNON.Vec3(0, cylinderHeight/2, 0));
      this.body.addShape(sphere, new CANNON.Vec3(0, -cylinderHeight/2, 0));
  }

  toggleFlashlight() {
    this.isFlashlightOn = !this.isFlashlightOn;
    console.log('Flashlight toggled:', this.isFlashlightOn ? 'ON' : 'OFF');
    getAudioManager().playButtonClick(); 
  }

  _createVisualMesh() {
    // Create a group to hold the character model
    this.mesh = new THREE.Group();
    
    // Create fallback capsule (shown until FBX loads or in first person)
    const bodyHeight = this.config.height - 2 * this.config.radius;
    const geometry = new THREE.CylinderGeometry(
      this.config.radius,
      this.config.radius,
      bodyHeight,
      16
    );
    
    const topSphere = new THREE.SphereGeometry(
      this.config.radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2
    );
    const bottomSphere = new THREE.SphereGeometry(
      this.config.radius, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2
    );
    
    const material = new THREE.MeshStandardMaterial({
      color: 0x4cc9f0,
      metalness: 0.1,
      roughness: 0.6,
    });

    this.fallbackMesh = new THREE.Group();
    
    const bodyMesh = new THREE.Mesh(geometry, material);
    const topMesh = new THREE.Mesh(topSphere, material);
    const bottomMesh = new THREE.Mesh(bottomSphere, material);
    
    topMesh.position.y = bodyHeight / 2;
    bottomMesh.position.y = -bodyHeight / 2;
    
    this.fallbackMesh.add(bodyMesh);
    this.fallbackMesh.add(topMesh);
    this.fallbackMesh.add(bottomMesh);
    
    bodyMesh.castShadow = true;
    topMesh.castShadow = true;
    bottomMesh.castShadow = true;

    this.mesh.add(this.fallbackMesh);
    this.scene.add(this.mesh);
    
    // Load the FBX character model
    this._loadCharacterModel();
  }

  async _loadCharacterModel() {
    const loader = new FBXLoader();
    console.log(`[Player Model Debug] Starting load for type: ${this.config.characterType}`);
    const basePath = `./assets/${this.config.characterType}/`;
    
    try {
      // Load the main model
      const model = await loader.loadAsync(basePath + `model/${this.config.characterType}.fbx`);
      
      // Scale and position the model
      // FBX models often come in cm requiring 0.01 scale, or mixed units.
      // If the model is 46MB, it might be high fidelity and standard scale (1.0) or very small/large.
      const scale = this.config.characterType === 'female' ? 0.014 : 1.44; // Try 100x smaller if it was giant, or adjust as needed.
      // Wait, let's stick to a safer logic:
      // If it's the new female model, let's try a standard adjustment or 1.0 if it's huge. 
      // Actually, standard Mixamo/Asset store models are often in meters (1.0) or cm (0.01).
      // The previous male model was 1.44 (likely small).
      
      let finalScale = 1.0; // Reduced from 1.44
      if (this.config.characterType === 'female') {
           finalScale = 0.01; 
      }
      
      model.scale.setScalar(finalScale); 
      model.position.y = -this.config.height / 2; // Align feet with physics body bottom
      
      // Define solid colors for different body parts
      const clothingColors = {
        // Skin tone - check these first (higher priority)
        skin: 0xe8c4a0,
        body: 0xe8c4a0,
        face: 0xe8c4a0,
        head: 0xe8c4a0,
        hand: 0xe8c4a0,
        arm: 0xe8c4a0,
        neck: 0xe8c4a0,
        cc_base_body: 0xe8c4a0,  // Common in CC/Mixamo models
        genesis: 0xe8c4a0,
        // Hoodie/jacket - dark charcoal grey
        hoodie: 0x2d2d2d,
        jacket: 0x2d2d2d,
        top: 0x2d2d2d,
        shirt: 0x2d2d2d,
        torso: 0x2d2d2d,
        sweater: 0x2d2d2d,
        // Pants/jeans - dark blue
        pants: 0x1a2744,
        jeans: 0x1a2744,
        trousers: 0x1a2744,
        legs: 0x1a2744,
        bottom: 0x1a2744,
        // Shoes - black
        shoes: 0x1a1a1a,
        shoe: 0x1a1a1a,
        feet: 0x1a1a1a,
        boot: 0x1a1a1a,
        // Hair - dark brown
        hair: 0x2a1a0a,
        // Default for unrecognized parts
        default: 0x3a3a3a
      };
      
      // Priority list for skin detection (check these keywords first)
      const skinKeywords = ['body', 'skin', 'face', 'head', 'hand', 'arm', 'neck', 'cc_base', 'genesis', 'girl', 'woman', 'female'];
      
      // Update clothing colors with specific female items if needed
      clothingColors.bra = 0x2d2d2d;
      clothingColors.underwear = 0x2d2d2d;
      clothingColors.dress = 0x1a2744;
      
      // Default for unrecognized parts - Make it visible (Light Grey) to debug geometry issues
      clothingColors.default = 0x888888;
      
      // Apply materials to all meshes with solid colors
      let meshIndex = 0;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.castShadow = true;
          child.receiveShadow = true;
          
          // CHECK FOR EXISTING TEXTURE FIRST
          // If the model comes with textures (diffuse map), preserve them!
          if (child.material && (child.material.map || (Array.isArray(child.material) && child.material.some(m => m.map)))) {
               console.log(`[Player Model] Preserving texture for mesh: "${child.name}"`);
               
               // FORCE CONVERSION TO MESH STANDARD MATERIAL
               // FBX sometimes loads materials that don't work well (like ShininessExponent issues)
               // We create a FRESH material using the existing texture.
               
               const createStandardMat = (oldMat) => {
                   if (!oldMat) return new THREE.MeshStandardMaterial({ color: 0xff00ff }); // Magenta error
                   
                   const newMat = new THREE.MeshStandardMaterial({
                       map: oldMat.map || null,
                       color: 0xffffff, // White to show texture
                       roughness: 0.6,
                       metalness: 0.1,
                       side: THREE.DoubleSide
                   });
                   
                   // Copy other maps if they exist
                   if (oldMat.normalMap) newMat.normalMap = oldMat.normalMap;
                   
                   return newMat;
               };

               if (Array.isArray(child.material)) {
                   child.material = child.material.map(m => createStandardMat(m));
               } else {
                   child.material = createStandardMat(child.material);
               }
               
               meshIndex++;
               return; // SKIP solid color overwrite
          }
          
          const meshName = (child.name || '').toLowerCase();
          const matName = child.material ? (child.material.name || '').toLowerCase() : '';
          const combinedName = meshName + ' ' + matName;
          // Log mesh names to help debug
          console.log(`[Player Model Debug] Mesh ${meshIndex}: "${child.name}" (Material: "${child.material?.name || 'none'}")`);
          
          // Determine color based on mesh or material name
          let chosenColor = clothingColors.default;
          let isSkin = false;
          
          // First priority: check if it's a skin/body mesh
          for (const keyword of skinKeywords) {
            if (combinedName.includes(keyword)) {
              chosenColor = 0xe8c4a0; // Skin tone
              isSkin = true;
              break;
            }
          }
          
          // If not skin, check clothing
          if (!isSkin) {
            for (const [part, color] of Object.entries(clothingColors)) {
              if (part !== 'default' && !skinKeywords.includes(part) && combinedName.includes(part)) {
                chosenColor = color;
                break;
              }
            }
          }
          
          // Create a solid color material
          child.material = new THREE.MeshStandardMaterial({
            color: chosenColor,
            roughness: isSkin ? 0.5 : 0.7,
            metalness: 0.1,
            side: THREE.DoubleSide,
          });
          
          meshIndex++;
        }
      });
      
      // Remove fallback mesh and add the model
      if (this.fallbackMesh) {
        this.mesh.remove(this.fallbackMesh);
        this.fallbackMesh.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
        this.fallbackMesh = null;
      }
      
      this.mesh.add(model);
      this.loadedModel = model;
      
      // Setup animation mixer
      this.mixer = new THREE.AnimationMixer(model);
      
      // Load animations
      // Load animations
      const animPaths = ['idle', 'walk', 'run', 'jump'];
      for (const animName of animPaths) {
        try {
          const anim = await loader.loadAsync(basePath + `animations/${animName}.fbx`);
          if (anim.animations && anim.animations.length > 0) {
            const clip = anim.animations[0];
            
            // --- ROOT MOTION FIX ---
            // Strip position tracks from the animation to prevent the model 
            // from moving away from the physics collider.
            // We only keep Quaternion (rotation) tracks for hips/spine.
            clip.tracks = clip.tracks.filter(track => !track.name.endsWith('.position'));
            
            this.animations[animName] = this.mixer.clipAction(clip);
            
            // Configure animation properties
            if (animName === 'jump') {
                this.animations[animName].setLoop(THREE.LoopOnce);
                this.animations[animName].clampWhenFinished = true;
            } else {
                this.animations[animName].setLoop(THREE.LoopRepeat);
            }
          }
        } catch (animError) {
          console.warn(`Player: Could not load ${animName} animation:`, animError);
        }
      }
      
      // Start with idle animation
      if (this.animations.idle) {
        this.currentAction = this.animations.idle;
        this.currentAction.play();
        this.currentAnimState = 'idle';
      }
      
      this.modelLoaded = true;
      console.log(`Player: ${this.config.characterType} model loaded successfully`);
      
    } catch (error) {
      console.error('[Player Model Debug] CRITICAL ERROR loading model:', error);
      console.warn('Player: Failed to load character model, using fallback capsule:', error);
      // Keep the fallback capsule
    }
  }

  _updateAnimation(deltaTime) {
    // Update animation mixer
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }
    
    if (!this.modelLoaded || !this.mixer) return;
    
    // Determine target animation state
    const horizontalSpeed = Math.sqrt(
      this.body.velocity.x * this.body.velocity.x +
      this.body.velocity.z * this.body.velocity.z
    );
    
    let targetState = 'idle';
    
    // Priority 1: Jig (Airborne)
    // Use a small threshold for grounded check to avoid flickering on ramps
    if (!this.grounded && this.body.velocity.y > -20) { // Simple check for being in air
        targetState = 'jump';
    } 
    // Priority 2: Moving
    else if (horizontalSpeed > 0.5) {
      targetState = this.isSprinting ? 'run' : 'walk';
    }
    
    // SAFETY CHECK: If target animation is missing, fallback to valid state
    if (!this.animations[targetState]) {
        if (targetState === 'jump') {
            // If jump missing, fallback to run/walk/idle based on movement
            targetState = (horizontalSpeed > 0.5) ? (this.isSprinting ? 'run' : 'walk') : 'idle';
        } else if (targetState === 'run' && !this.animations.run) {
            targetState = 'walk'; // Fallback run -> walk
        }
        
        // Final safety: if fallback is also missing, stick to idle or don't switch
        if (!this.animations[targetState]) {
            return; // Abort transition if we can't play the target (or its fallback)
        }
    }
    
    // Transition to new animation if state changed
    if (targetState !== this.currentAnimState && this.animations[targetState]) {
      const newAction = this.animations[targetState];
      const oldAction = this.currentAction;
      
      if (newAction && newAction !== oldAction) {
        // Crossfade to new animation
        newAction.reset();
        newAction.setEffectiveTimeScale(1);
        newAction.setEffectiveWeight(1);
        
        // Smoother Transition Settings
        const fadeDuration = (targetState === 'jump') ? 0.1 : 0.25; // Quick into jump, smooth others
        
        if (oldAction) {
          newAction.crossFadeFrom(oldAction, fadeDuration, true);
        }
        
        newAction.play();
        this.currentAction = newAction;
        this.currentAnimState = targetState;
      }
    }
  }

  _setupInput() {
    const keyMap = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'backward', ArrowDown: 'backward',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      Space: 'jump',
      ShiftLeft: 'sprint', ShiftRight: 'sprint',
    };

    this._onKeyDown = (e) => {
      const action = keyMap[e.code];
      if (action) {
        e.preventDefault();
        this.keys[action] = true;
      }
      if (e.code === 'KeyV') this.toggleFirstPerson();
      if (e.code === 'KeyR') this.reset();
      if (e.code === 'KeyG') {
        this.debugGroundDetection = !this.debugGroundDetection;
        console.log(`Ground detection debug: ${this.debugGroundDetection ? 'ON' : 'OFF'}`);
      }
      if (e.code === 'KeyP') this.debugPhysicsWorld();
    };

    this._onKeyUp = (e) => {
      const action = keyMap[e.code];
      if (action) {
        this.keys[action] = false;
        if (action === 'jump') {
          this.jumpRequested = false;
          if (this.grounded) this.jumpedThisPress = false;
        }
      }
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    this._onPointerLockClick = () => {
      if (!document.pointerLockElement) document.body.requestPointerLock();
    };

    this._onPointerLockChange = () => {
      this.mouse.enabled = document.pointerLockElement === document.body;
    };

    window.addEventListener('click', this._onPointerLockClick);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    this._onMouseMove = (e) => {
      if (!this.mouse.enabled) return;
      this.cameraYaw -= e.movementX * this.mouse.sensitivity;
      this.cameraPitch -= e.movementY * this.mouse.sensitivity;
      this.cameraPitch = THREE.MathUtils.clamp(
        this.cameraPitch,
        THREE.MathUtils.degToRad(10),
        THREE.MathUtils.degToRad(85)
      );
    };

    window.addEventListener('mousemove', this._onMouseMove);

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

    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  _checkGrounded() {
    const halfHeight = (this.config.height - 2 * this.config.radius) / 2;
    const bottomOffset = this.config.radius + halfHeight;
    
    const isLowEndDevice = this.isLowEndDevice;
    const positions = isLowEndDevice ? [
      { x: 0, z: 0 },
      { x: this.config.radius * 0.4, z: 0 },
      { x: 0, z: this.config.radius * 0.4 },
    ] : [
      { x: 0, z: 0 },
      { x: this.config.radius * 0.3, z: 0 },
      { x: -this.config.radius * 0.3, z: 0 },
      { x: 0, z: this.config.radius * 0.3 },
      { x: 0, z: -this.config.radius * 0.3 },
      { x: this.config.radius * 0.2, z: this.config.radius * 0.2 },
      { x: -this.config.radius * 0.2, z: -this.config.radius * 0.2 },
    ];

    let hitCount = 0;
    
    for (const pos of positions) {
      const from = new CANNON.Vec3(
        this.body.position.x + pos.x,
        this.body.position.y - bottomOffset,
        this.body.position.z + pos.z
      );
      const checkDistance = isLowEndDevice ? 
        this.config.groundCheckDistance * 1.5 : 
        this.config.groundCheckDistance * 2;
      
      const to = new CANNON.Vec3(
        this.body.position.x + pos.x,
        this.body.position.y - bottomOffset - checkDistance,
        this.body.position.z + pos.z
      );

      const result = new CANNON.RaycastResult();
      const hit = this.world.raycastClosest(from, to, { skipBackfaces: false }, result);
      
      if (hit) {
        const hitNormal = result.hitNormalWorld;
        const normalThreshold = isLowEndDevice ? 0.2 : 0.3;
        if (hitNormal.y >= normalThreshold) hitCount++;
      }
    }
    
    const bottomY = this.body.position.y - bottomOffset;
    const fallbackGrounded = bottomY <= 0.1 && Math.abs(this.body.velocity.y) < 0.5;
    const slowVerticalMovement = Math.abs(this.body.velocity.y) < 0.1;
    const extendedFallback = slowVerticalMovement && hitCount === 0;
    
    return hitCount > 0 || fallbackGrounded || extendedFallback;
  }

  _getMovementInput() {
    this.camera.getWorldDirection(this.tempVec3);
    this.tempVec3.y = 0;
    this.tempVec3.normalize();

    this.tempVec3_2.crossVectors(this.tempVec3, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3(0, 0, 0);
    
    // Use touch input if enabled, otherwise use keyboard
    if (this.useTouchControls && (Math.abs(this.touchInput.moveForward) > 0.01 || Math.abs(this.touchInput.moveRight) > 0.01)) {
      // Touch input: forward/right are normalized -1 to 1
      move.addScaledVector(this.tempVec3, this.touchInput.moveForward);
      move.addScaledVector(this.tempVec3_2, this.touchInput.moveRight);
    } else {
      // Keyboard input
      if (this.keys.forward) move.add(this.tempVec3);
      if (this.keys.backward) move.sub(this.tempVec3);
      if (this.keys.right) move.add(this.tempVec3_2);
      if (this.keys.left) move.sub(this.tempVec3_2);
    }

    if (move.lengthSq() > 0) move.normalize();
    return move;
  }

  update(deltaTime, currentTime) {
    // Update character animation
    this._updateAnimation(deltaTime);
    
    const isCurrentlyGrounded = this._checkGrounded();
    
    if (isCurrentlyGrounded) {
      this.grounded = true;
      this.lastGroundedTime = currentTime;
      this.groundCheckTimer = 0;
    } else {
      this.groundCheckTimer += deltaTime;
      if (this.groundCheckTimer > 0.01) this.grounded = false;
    }

    if (this.grounded && !this.wasGroundedLastFrame) {
      this.jumpedThisPress = false;
      this.jumpRequested = false;
    }
    this.wasGroundedLastFrame = this.grounded;

    const moveDir = this._getMovementInput();
    
    // Apply confusion effect - invert controls if active
    if (this.controlsInverted) {
      moveDir.x = -moveDir.x;
      moveDir.z = -moveDir.z;
    }
    
    // Check sprint from keys OR touch
    const isSprintInput = this.keys.sprint || (this.useTouchControls && this.touchInput.sprint);
    this.isSprinting = isSprintInput && this.grounded && moveDir.lengthSq() > 0;
    const speedMultiplier = this.isSprinting ? this.config.sprintMultiplier : 1.0;
    this.currentSpeed = this.config.speed * speedMultiplier;

    const controlFactor = this.grounded ? 1.0 : this.config.airControl;
    
    if (moveDir.lengthSq() > 0) {
      const targetVX = moveDir.x * this.currentSpeed;
      const targetVZ = moveDir.z * this.currentSpeed;
      
      const currentVX = this.body.velocity.x;
      const currentVZ = this.body.velocity.z;
      
      const accelRate = this.config.acceleration * controlFactor;
      
      const deltaVX = (targetVX - currentVX) * accelRate * deltaTime;
      const deltaVZ = (targetVZ - currentVZ) * accelRate * deltaTime;
      
      this.body.velocity.x += deltaVX;
      this.body.velocity.z += deltaVZ;
    } else if (this.grounded) {
      const frictionFactor = Math.exp(-15 * deltaTime);
      this.body.velocity.x *= frictionFactor;
      this.body.velocity.z *= frictionFactor;
    }

    const isJumpInput = this.keys.jump || (this.useTouchControls && this.touchInput.jump);
    const jumpPressedThisFrame = isJumpInput && !this.wasJumpPressed;
    this.wasJumpPressed = isJumpInput;
    
    const canRequestJump = (this.grounded || 
      (currentTime - this.lastGroundedTime) <= this.config.coyoteTime) &&
      !this.jumpedThisPress &&
      this.jumpCooldown <= 0;
    
    if (jumpPressedThisFrame && canRequestJump) this.jumpRequested = true;
    if (!this.grounded && this.jumpedThisPress) this.jumpRequested = false;

    const canJump = canRequestJump && this.jumpRequested;
    
    if (canJump) {
      this.body.velocity.y = this.config.jumpSpeed;
      this.jumpedThisPress = true;
      this.jumpRequested = false;
      this.jumpCooldown = 0.2;
      this.grounded = false;
      this.lastGroundedTime = -Infinity;
    }
    
    if (this.grounded && !this.keys.jump) this.jumpRequested = false;
    if (this.jumpCooldown > 0) this.jumpCooldown -= deltaTime;

    // Play footstep sounds when moving on ground
    if (this.grounded && moveDir.lengthSq() > 0.01) {
      const horizontalSpeed = Math.sqrt(
        this.body.velocity.x * this.body.velocity.x +
        this.body.velocity.z * this.body.velocity.z
      );
      if (horizontalSpeed > 0.5) {
        getAudioManager().playFootstep(this.isSprinting);
      }
    }

    this._updateHeadBobbing(deltaTime, moveDir);

    // Sync visual mesh to physics body
    // use configurable visualOffset
    this.mesh.position.set(
      this.body.position.x + this.visualOffset.x,
      this.body.position.y + this.visualOffset.y,
      this.body.position.z + this.visualOffset.z
    );
    
    // Sync rotation only if we want usage of camera/input direction
    // For now, mesh rotation is handled by _updateRotation or camera look

    this._updateCharacterRotation(deltaTime, moveDir);
    this._updateCamera(deltaTime, moveDir);

    this.mesh.visible = !this.firstPerson;
  }

  onGhostAttack() {
      if (this.isInvincible) {
          console.log('Player attacked but is INVINCIBLE!');
          return;
      }
      
      console.log('Player killed by Ghost!');
      // Trigger death logic - ideally via callback to main game
      // For now, simpler reset
      const start = new CANNON.Vec3(
        this.config.startPosition.x,
        this.config.startPosition.y, 
        this.config.startPosition.z
      );
      this.resetToStart(start);
  }

  _updateCharacterRotation(deltaTime, moveDir) {
    if (this.mouse.holdRotate) {
      this.camera.getWorldDirection(this.tempVec3);
      this.tempVec3.y = 0;
      this.tempVec3.normalize();
      
      const targetYaw = Math.atan2(this.tempVec3.x, this.tempVec3.z);
      this.mesh.rotation.y = lerpAngle(this.mesh.rotation.y, targetYaw, Math.min(1, 8 * deltaTime));
    } else if (moveDir.lengthSq() > 0.01) {
      const targetYaw = Math.atan2(moveDir.x, moveDir.z);
      this.mesh.rotation.y = lerpAngle(this.mesh.rotation.y, targetYaw, Math.min(1, 8 * deltaTime));
    }
  }

  _updateHeadBobbing(deltaTime, moveDir) {
    const horizontalSpeed = Math.sqrt(
      this.body.velocity.x * this.body.velocity.x +
      this.body.velocity.z * this.body.velocity.z
    );
    
    const isMoving = horizontalSpeed > 0.1 && moveDir.lengthSq() > 0.01;
    
    if (isMoving && this.grounded && this.firstPerson) {
      const baseSpeed = this.config.speed;
      const currentSpeedMultiplier = horizontalSpeed / baseSpeed;
      const sprintMultiplier = this.isSprinting ? 1.5 : 1.0;
      
      this.headBobTargetIntensity = Math.min(1.0, currentSpeedMultiplier * sprintMultiplier);
      
      const bobSpeed = 12 + (horizontalSpeed / baseSpeed) * 4;
      this.headBobTime += deltaTime * bobSpeed;
    } else {
      this.headBobTargetIntensity = 0;
    }
    
    const smoothFactor = 1 - Math.exp(-15 * deltaTime);
    this.headBobIntensity = THREE.MathUtils.lerp(
      this.headBobIntensity,
      this.headBobTargetIntensity,
      smoothFactor
    );
  }
  
  _updateCamera(deltaTime, moveDir) {
    if (this.firstPerson) {
      this.targetCameraDistance = 0.2;
      this.targetCameraPitch = THREE.MathUtils.degToRad(10);
    } else {
      this.targetCameraDistance = 6.0;
      this.targetCameraPitch = THREE.MathUtils.degToRad(55);
    }

    const smoothFactor = 1 - Math.exp(-8 * deltaTime);
    this.cameraDistance = THREE.MathUtils.lerp(this.cameraDistance, this.targetCameraDistance, smoothFactor);
    
    if (!this.mouse.enabled) {
      this.cameraPitch = THREE.MathUtils.lerp(this.cameraPitch, this.targetCameraPitch, smoothFactor);
    }

    if (moveDir.lengthSq() > 0.01 && !this.firstPerson && !this.mouse.enabled) {
      const targetYaw = Math.atan2(moveDir.x, moveDir.z) + Math.PI;
      const yawDiff = THREE.MathUtils.euclideanModulo(targetYaw - this.cameraYaw + Math.PI, Math.PI * 2) - Math.PI;
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
      this.mesh.position.z
    );

    const camOffset = this.tempVec3_2.set(
      this.cameraDistance * Math.sin(this.cameraPitch) * Math.sin(this.cameraYaw),
      this.cameraDistance * Math.cos(this.cameraPitch),
      this.cameraDistance * Math.sin(this.cameraPitch) * Math.cos(this.cameraYaw)
    );

    const desiredPos = new CANNON.Vec3(
      targetPos.x + camOffset.x,
      targetPos.y + camOffset.y,
      targetPos.z + camOffset.z
    );

    const from = new CANNON.Vec3(targetPos.x, targetPos.y, targetPos.z);
    const result = new CANNON.RaycastResult();
    const hit = this.world.raycastClosest(from, desiredPos, { skipBackfaces: true }, result);

    if (hit) {
      const hitPoint = result.hitPointWorld;
      const safeOffset = 0.2;
      
      const dir = new THREE.Vector3(
        desiredPos.x - targetPos.x,
        desiredPos.y - targetPos.y,
        desiredPos.z - targetPos.z
      ).normalize();
      
      this.camera.position.set(
        hitPoint.x - dir.x * safeOffset,
        hitPoint.y - dir.y * safeOffset,
        hitPoint.z - dir.z * safeOffset
      );
    } else {
      this.camera.position.set(desiredPos.x, desiredPos.y, desiredPos.z);
    }

    this.camera.lookAt(targetPos);
  }

  toggleFirstPerson() {
    this.firstPerson = !this.firstPerson;
  }

  reset() {
    this.body.position.set(
      this.config.startPosition.x,
      this.config.startPosition.y,
      this.config.startPosition.z
    );
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.quaternion.set(0, 0, 0, 1);
    this.body.wakeUp();
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
    this.body.position.copy(position);
    this.body.velocity.set(0, 0, 0);
  }

  getPosition() {
    return new THREE.Vector3(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z
    );
  }

  getVelocity() {
    return new THREE.Vector3(
      this.body.velocity.x,
      this.body.velocity.y,
      this.body.velocity.z
    );
  }

  getGroundDetectionInfo() {
    const halfHeight = (this.config.height - 2 * this.config.radius) / 2;
    const bottomOffset = this.config.radius + halfHeight;
    
    return {
      grounded: this.grounded,
      groundCheckTimer: this.groundCheckTimer,
      lastGroundedTime: this.lastGroundedTime,
      playerY: this.body.position.y,
      bottomY: this.body.position.y - bottomOffset,
      groundCheckDistance: this.config.groundCheckDistance,
      jumpedThisPress: this.jumpedThisPress,
      jumpCooldown: this.jumpCooldown,
      worldBodies: this.world.bodies.length
    };
  }

  debugPhysicsWorld() {
    console.log(`Physics world has ${this.world.bodies.length} bodies:`);
    this.world.bodies.forEach((body, index) => {
      console.log(`Body ${index}: pos(${body.position.x.toFixed(2)}, ${body.position.y.toFixed(2)}, ${body.position.z.toFixed(2)}) mass: ${body.mass}`);
    });
  }
  
  _detectLowEndDevice() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!gl) return true;
    
    const loseContext = gl.getExtension('WEBGL_lose_context');
    if (loseContext) loseContext.loseContext();
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency || 2;
    const memory = navigator.deviceMemory || 4;
    
    return isMobile || cores < 4 || memory < 4;
  }

  _wouldCollideAtPosition(x, z) {
    return false; // Simplified - rely on physics engine
  }

  // ==================== TOUCH CONTROLS ====================

  /**
   * Enable/disable touch controls
   */
  setUseTouchControls(enabled) {
    this.useTouchControls = enabled;
    if (enabled) {
      // On mobile, always enable first person and "enable" mouse look
      this.firstPerson = true;
      this.mouse.enabled = true;
      
      // Set camera to horizontal view (90 degrees = looking straight ahead)
      this.cameraPitch = THREE.MathUtils.degToRad(90);
    }
  }

  /**
   * Set touch movement input (from joystick)
   * @param {number} forward - Forward/backward input (-1 to 1)
   * @param {number} right - Right/left input (-1 to 1)
   */
  setTouchMovement(forward, right) {
    this.touchInput.moveForward = forward;
    this.touchInput.moveRight = right;
  }

  /**
   * Apply touch look delta to camera
   * @param {number} deltaX - Horizontal look delta
   * @param {number} deltaY - Vertical look delta
   */
  applyTouchLook(deltaX, deltaY) {
    if (!this.useTouchControls) return;
    
    // Apply yaw (horizontal rotation)
    this.cameraYaw -= deltaX * 0.01;
    
    // Apply pitch (vertical) - for first person, we need different handling
    // cameraPitch in this system: 0 = up, PI/2 = horizontal, PI = down
    // For first person: we want ~10-170 degrees (0.17 to 2.97 radians)
    // Apply pitch (vertical) - Inverted Y axis as requested by user
    this.cameraPitch -= deltaY * 0.01;
    this.cameraPitch = THREE.MathUtils.clamp(
      this.cameraPitch,
      THREE.MathUtils.degToRad(10),  // Looking up limit
      THREE.MathUtils.degToRad(170)  // Looking down limit
    );
  }

  /**
   * Set touch button states
   * @param {boolean} sprint
   * @param {boolean} jump
   */
  setTouchButtons(sprint, jump) {
    if (this.useTouchControls) {
      this.touchInput.sprint = sprint;
      this.touchInput.jump = jump;
      
      // Also update keys state for compatibility
      this.keys.sprint = sprint;
      if (jump && !this.keys.jump) {
        this.keys.jump = true;
      } else if (!jump) {
        this.keys.jump = false;
      }
    }
  }
}
