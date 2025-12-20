import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { getAudioManager } from './AudioManager.js';

export class Ghost {
  constructor(scene, world, player, mazeGenerator) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.mazeGenerator = mazeGenerator;

    this.radius = 0.4; // Reduced to fit corridors (cellSize 4, walls ~0.1 thick)
    this.height = 4.0;  // Increased height for larger model

    // AGGRESSIVE chase settings
    this.chaseSpeed = 8.0;    // Fast chase speed
    this.wanderSpeed = 4.0;   // Active wandering
    this.wanderDir = new THREE.Vector3(1, 0, 0);
    this.wanderTimer = 0;
    this.wanderInterval = { min: 2.0, max: 4.0 };

    this.detectionRadius = 60.0;  // Large detection range
    this.chaseRadius = 50.0;
    this.loseSightRadius = 70.0;
    this.currentState = 'chase';  // Start in chase mode
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
    this.previousState = 'dormant';
    
    this.raycastResult = new CANNON.RaycastResult();
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
      attack: null
    };
    this.currentAnimState = 'idle';
    this.previousAnimState = 'idle';
    this.animationCrossFadeDuration = 0.2; // Faster crossfade to reduce visible transition
    this.modelLoaded = false;
    
    // Position tracking to prevent animation root motion from affecting movement
    this._lastKnownPosition = new THREE.Vector3();
    this._positionInitialized = false;
    
    // Attack properties - GUARANTEED KILL
    this.attackRange = 4.5;  // Larger attack range for guaranteed kills
    this.isAttacking = false;
    this.attackCooldown = 0;
    this.attackDuration = 1.5; // seconds for attack animation
    this.postKillWaitTime = 2.0; // Brief wait after killing
    
    // Audio state
    this.lastMoanTime = 0;
    this.moanInterval = 8000; // Random moan every 8-15 seconds when nearby
    this.hasPlayedSpotSound = false;

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

    // Visual alignment
    // Fix: Visual offset should place feet (y=0 in mesh) at bottom of physics body
    // Body Y is centered at height/2. Bottom is 0.
    // So we need to lower the mesh by height/2 relative to body center.
    // We'll calculate this dynamically in update or init, but here's a good default
    this.visualOffset = new THREE.Vector3(0, -this.height / 2, 0);

    // Physics body
    this.rebuildPhysics();
    this.isPassive = false;
  }
  
  rebuildPhysics() {
    const wasPassive = this.isPassive;
    
    if (this.body) {
      this.world.removeBody(this.body);
    }
    
    const height = this.height || 2.0; 
    const radius = this.radius || 0.5; // User requested 0.5
    
    // Inner height (between sphere centers)
    const cylinderHeight = Math.max(0.1, height - 2 * radius);
    
    this.body = new CANNON.Body({
      mass: 80, // Dynamic body with mass (was accidentally set to 0 causing static body)
      type: CANNON.Body.DYNAMIC, 
      material: new CANNON.Material('ghost'),
      position: this.body ? this.body.position : new CANNON.Vec3(0, 2, 0)
    });
    
    try {
      const shape = new CANNON.Capsule(radius, cylinderHeight);
      this.body.addShape(shape);
    } catch(e) {
      console.warn('CANNON.Capsule not found, falling back');
       const cylinderShape = new CANNON.Cylinder(radius, radius, cylinderHeight, 8);
       const sphereShape = new CANNON.Sphere(radius);
       // cannon-es Cylinder is Y-aligned by default.
       const q = new CANNON.Quaternion();
       q.set(0, 0, 0, 1);
       this.body.addShape(cylinderShape, new CANNON.Vec3(0, 0, 0), q);
       this.body.addShape(sphereShape, new CANNON.Vec3(0, cylinderHeight / 2, 0));
       this.body.addShape(sphereShape, new CANNON.Vec3(0, -cylinderHeight / 2, 0));
    }
    
    // Calculate height difference to keep feet on ground
    if (this.height && this.body) {
         // Update visual offset to match new height
         this.visualOffset.y = -this.height / 2;
    }

    // Store dimensions
    this.height = height;
    this.radius = radius;
    
    this.world.addBody(this.body);

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
      // Optional: traverse and dispose geometry/materials if we want to be thorough
      // but standard cleanup usually handles this if we drop references
      this.loadedModel = null;
    }

    const loader = new FBXLoader();
    
    try {
      console.log('Ghost: Loading monster model...');
      
      // Load the monster model
      const model = await loader.loadAsync('./assets/monster/model/monster.fbx');
      console.log('Ghost: Model loaded, applying settings...');
      
      // Scale and position the model appropriately
      // Make ghost 2x larger for better visibility
      const modelScale = this.radius * 2.0; // 2x larger
      model.scale.set(modelScale, modelScale, modelScale); 
      model.position.y = 0; // Model feet at body center, will offset in mesh sync
      
      // Apply basic material to all meshes (textures loaded separately)
      model.traverse((child) => {
        if (child.isMesh) {
          // Use existing material or create a basic one
          if (!child.material) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0x444444,
              roughness: 0.8,
              metalness: 0.2,
            });
          }
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      
      // Remove fallback sphere and add the model
      if (this.fallbackMesh) {
        this.mesh.remove(this.fallbackMesh);
        this.fallbackMesh.geometry.dispose();
        this.fallbackMesh.material.dispose();
        this.fallbackMesh = null;
      }
      
      this.mesh.add(model);
      this.loadedModel = model;
      this.modelLoaded = true;
      console.log('Ghost: Monster model added to scene');
      
      // Setup animation mixer
      this.mixer = new THREE.AnimationMixer(model);
      
      // Load all animations
      await this._loadAllAnimations(loader);
      
      // Start with idle animation
      this._playAnimation('idle');
      
      // Load textures asynchronously (non-blocking)
      this._loadTextures(model);
      
    } catch (error) {
      console.error('Ghost: Failed to load monster model:', error);
      // Keep the fallback sphere
    }
  }
  
  async _loadAllAnimations(loader) {
    const animationFiles = {
      idle: './assets/monster/animations/full_low@Breathing Idle.fbx',
      walk: './assets/monster/animations/full_low@Walking.fbx',
      run: './assets/monster/animations/run.fbx',
      attack: './assets/monster/animations/full_low@Zombie Attack.fbx'
    };
    
    for (const [name, path] of Object.entries(animationFiles)) {
      try {
        console.log(`Ghost: Loading ${name} animation...`);
        const anim = await loader.loadAsync(path);
        if (anim.animations && anim.animations.length > 0) {
          const action = this.mixer.clipAction(anim.animations[0]);
          
          // Configure for smooth looping
          action.clampWhenFinished = false;
          action.loop = THREE.LoopRepeat;
          
          // Attack animation should play once when triggered
          if (name === 'attack') {
            action.loop = THREE.LoopOnce;
            action.clampWhenFinished = true;
          }
          
          this.animations[name] = action;
          console.log(`Ghost: ${name} animation loaded`);
        }
      } catch (e) {
        console.warn(`Ghost: Could not load ${name} animation:`, e);
      }
    }
  }
  
  _playAnimation(animName) {
    if (!this.mixer || !this.animations[animName]) return;
    
    const newAction = this.animations[animName];
    const oldAction = this.animations[this.currentAnimState];
    
    // If already playing this animation, just ensure it's running
    if (animName === this.currentAnimState) {
      // Only restart if truly stopped (not just paused or fading)
      if (!newAction.isRunning() && newAction.time === 0) {
        newAction.setEffectiveTimeScale(1);
        newAction.setEffectiveWeight(1);
        newAction.play();
      }
      return;
    }
    
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
    const texturePath = './assets/monster/textures/';
    
    try {
      console.log('Ghost: Loading textures...');
      const baseColorMap = await textureLoader.loadAsync(texturePath + 'BaseColor.png');
      console.log('Ghost: BaseColor loaded');
      
      // Apply textures to model materials
      model.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            map: baseColorMap,
            roughness: 0.8,
            metalness: 0.2,
          });
        }
      });
      console.log('Ghost: Textures applied');
      
      // Load additional maps in background (optional)
      this._loadAdditionalMaps(model, textureLoader, texturePath);
      
    } catch (texError) {
      console.warn('Ghost: Could not load textures:', texError);
    }
  }
  
  async _loadAdditionalMaps(model, textureLoader, texturePath) {
    try {
      const [normalMap, roughnessMap, metallicMap] = await Promise.all([
        textureLoader.loadAsync(texturePath + 'Normal.png').catch(() => null),
        textureLoader.loadAsync(texturePath + 'Roughness.png').catch(() => null),
        textureLoader.loadAsync(texturePath + 'Metallic.png').catch(() => null),
      ]);
      
      model.traverse((child) => {
        if (child.isMesh && child.material) {
          if (normalMap) child.material.normalMap = normalMap;
          if (roughnessMap) child.material.roughnessMap = roughnessMap;
          if (metallicMap) child.material.metalnessMap = metallicMap;
          child.material.needsUpdate = true;
        }
      });
      console.log('Ghost: Additional texture maps applied');
    } catch (e) {
      // Ignore additional map loading errors
    }
  }

  update(deltaTime) {
    if (!this.player) return;
    
    // DEBUG: Log ghost state every 2 seconds
    this._debugTimer = (this._debugTimer || 0) + deltaTime;
    if (this._debugTimer > 2) {
      console.log('Ghost state:', this.currentState, 'pos:', 
        this.body.position.x.toFixed(1), this.body.position.z.toFixed(1),
        'mazeData:', !!this.mazeData, 'active:', this.isActive);
      this._debugTimer = 0;
    }
    
    // Update attack cooldown
    if (this.attackCooldown > 0) {
      this.attackCooldown -= deltaTime;
    }
    
    // Debug Passive Mode - STRICT RETURN
    // If passive, we do NOTHING else. No seeking, no attacking, no state changes.
    if (this.isPassive) {
      this.currentState = 'dormant';
      this._playAnimation('idle');
      
      // Force face player so we can see the model
      const playerPos = this.player.getPosition();
      const angle = Math.atan2(playerPos.x - this.body.position.x, playerPos.z - this.body.position.z);
      this.mesh.rotation.y = angle;
      
      // Ensure zero velocity
      if (this.body) {
          this.body.velocity.set(0, 0, 0);
          this.body.angularVelocity.set(0, 0, 0);
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
        this.currentState = 'dormant';
        this._playAnimation('idle');
        
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
        this.currentState = 'wander';
        console.log('Ghost activated after', this.activationDelay / 1000, 'seconds');
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
      // Ghost is in cooldown after killing - just wander away
      this.currentState = 'wander';
      this._playAnimation('walk');
      this._updateRoaming(deltaTime, new THREE.Vector3(this.body.position.x, 0, this.body.position.z));
      this._updatePosition(deltaTime, this.wanderDir, this.wanderSpeed);
      return;
    }
    
    const playerPos = this.player.getPosition();
    const ghostPos = new THREE.Vector3(this.body.position.x, this.body.position.y, this.body.position.z);
    const toPlayer = new THREE.Vector3().subVectors(playerPos, ghostPos);
    const horizontalDistance = Math.sqrt(toPlayer.x*toPlayer.x+toPlayer.z*toPlayer.z);
    
    // Update spawn zone center from player's start position
    if (!this.spawnZoneCenter && this.player.config && this.player.config.startPosition) {
      this.spawnZoneCenter = {
        x: this.player.config.startPosition.x,
        z: this.player.config.startPosition.z
      };
    }
    
    // Check if player is in spawn safe zone - don't attack if so
    if (this.spawnZoneCenter) {
      const distToSpawn = Math.sqrt(
        (playerPos.x - this.spawnZoneCenter.x) ** 2 +
        (playerPos.z - this.spawnZoneCenter.z) ** 2
      );
      if (distToSpawn < this.spawnZoneRadius) {
        // Player is in safe zone - don't chase or attack
        this.currentState = 'wander';
        this._playAnimation('walk');
        this._updateRoaming(deltaTime, ghostPos);
        this._updatePosition(deltaTime, this.wanderDir, this.wanderSpeed);
        return;
      }
      
      // Also prevent ghost from entering spawn zone
      const ghostDistToSpawn = Math.sqrt(
        (ghostPos.x - this.spawnZoneCenter.x) ** 2 +
        (ghostPos.z - this.spawnZoneCenter.z) ** 2
      );
      if (ghostDistToSpawn < this.spawnZoneRadius) {
        // Ghost is too close to spawn - move away
        const awayDir = new THREE.Vector3(
          ghostPos.x - this.spawnZoneCenter.x,
          0,
          ghostPos.z - this.spawnZoneCenter.z
        ).normalize();
        this._updatePosition(deltaTime, awayDir, this.wanderSpeed);
        return;
      }
    }
    
    // Check for attack range (only if not in cooldown and player not in safe zone)
    /* 
    if (horizontalDistance <= this.attackRange && this.attackCooldown <= 0) {
      this._initiateAttack();
      return;
    }
    */
    
    if (this.isLowEndDevice && horizontalDistance > 30) {
      this.currentState = 'wander';
      this._playAnimation('walk');
      this._updateRoaming(deltaTime, ghostPos);
      this._updatePosition(deltaTime, new THREE.Vector3(), this.wanderSpeed);
      return;
    }
    
    // Occasional ghostly moan when near player
    if (horizontalDistance < 15 && now - this.lastMoanTime > this.moanInterval) {
      if (Math.random() < 0.3) { // 30% chance each interval
        getAudioManager().playGhostMoan();
      }
      this.lastMoanTime = now;
      this.moanInterval = 8000 + Math.random() * 7000; // 8-15 seconds
    }
    
    // Ghost follows maze pathways - respects walls
    const speedMultiplier = this.isLowEndDevice ? 0.85 : 1.0;
    
    // AGGRESSIVE AI: Ghost always chases player when within range
    // No line-of-sight or flashlight requirement - relentless predator
    
    let dir = new THREE.Vector3();
    let speed = this.wanderSpeed * speedMultiplier;
    const canChangeState = now - this.lastStateChange > this.stateChangeCooldown;
    
    // ALWAYS AGGRESSIVE: Ghost chases regardless of flashlight state
    // Detection radius is the same whether light on or off
    const effectiveDetectionRadius = this.detectionRadius; // Always 45 units
    const loseSightThreshold = this.loseSightRadius; // Always 50 units

    let targetState = this.currentState;

    // SIMPLE LOGIC: Chase if within detection range
    if (horizontalDistance <= effectiveDetectionRadius) {
       targetState = 'chase';
    } else if (this.currentState === 'chase' && horizontalDistance > loseSightThreshold) {
       targetState = 'wander';
    }
    
    // Apply state transition
    if (canChangeState && targetState !== this.currentState) {
        this.currentState = targetState;
        this.lastStateChange = now;
        
        if (this.currentState === 'chase' && !this.hasPlayedSpotSound) {
             getAudioManager().playGhostWhisper();
             this.hasPlayedSpotSound = true;
        } else if (this.currentState === 'wander') {
             this.hasPlayedSpotSound = false;
        }
    }
    
    // FORCE CHASE if very close (within 8 units) regardless of state
    if (horizontalDistance < 8.0 && this.currentState !== 'chase') {
      this.currentState = 'chase';
      this.lastStateChange = now;
    }
    
    // EXECUTE STATE BEHAVIOR
    if (this.currentState === 'chase') {
      dir = this._getPathAwareDirection(ghostPos, playerPos);
      speed = this.chaseSpeed * speedMultiplier;
      this._playAnimation('run');
      
    } else {
       this.currentState = 'wander';
       this._updateRoaming(deltaTime, ghostPos);
       
       if (this.roamingTarget) {
         const roamTarget = new THREE.Vector3(this.roamingTarget.x, 0, this.roamingTarget.z);
         dir = this._getPathAwareDirection(ghostPos, roamTarget);
       } else {
         dir = this.wanderDir.clone();
       }
       
       speed = this.wanderSpeed * speedMultiplier;
       this._playAnimation('walk');
    }
    
    // ATTACK CHECK - trigger attack if close enough, regardless of state
    // This ensures ghost attacks even if state logic has issues
    if (horizontalDistance <= this.attackRange && this.attackCooldown <= 0) {
      console.log('Ghost: In attack range!', horizontalDistance.toFixed(2));
      this._initiateAttack();
      return;
    }
    
    // Detect if ghost is stuck - use direction length as indicator
    const dirLength = dir.lengthSq();
    
    if (dirLength < 0.01) {
      // No valid direction found - try direct movement as fallback
      console.log('Ghost: No path found, using direct movement');
      dir = new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize();
      
      this._stuckCounter = (this._stuckCounter || 0) + 1;
      if (this._stuckCounter > 30) { // About 0.5 seconds at 60fps
        console.log('Ghost cornered! Respawning...');
        this._respawnNearPlayer();
        this._stuckCounter = 0;
        return;
      }
    } else {
      this._stuckCounter = 0;
    }
    
    this._updatePosition(deltaTime, dir, speed);
    
    // Update animation mixer AFTER position is set (prevents root motion from moving ghost)
    if (this.mixer) {
      this.mixer.update(deltaTime);
      this._cancelRootMotion(); // Cancel any root motion applied by animation
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
        this.body.position.set(testX, this.height / 2, testZ);
        this.mesh.position.set(testX, this.height / 2, testZ);
        console.log('Ghost respawned near player at:', testX.toFixed(1), testZ.toFixed(1));
        return;
      }
    }
    
    // Fallback to random respawn
    this.respawnRandomly();
  }
  
  _updateAnimationForState() {
    switch (this.currentState) {
      case 'dormant':
        this._playAnimation('idle');
        break;
      case 'wander':
      case 'search':
      case 'searching':
        this._playAnimation('walk');
        break;
      case 'chase':
        this._playAnimation('run');
        break;
      case 'attack':
        this._playAnimation('attack');
        break;
      default:
        this._playAnimation('idle');
    }
  }
  
  _checkAttackHit() {
    if (!this.player) return false;
    
    const playerPos = this.player.getPosition();
    const ghostPos = this.body.position;
    
    // 1. Distance Check - primary criterion
    const dist = Math.sqrt(
      (playerPos.x - ghostPos.x) ** 2 + 
      (playerPos.z - ghostPos.z) ** 2
    );
    
    // Use generous range (attackRange + buffer) - ghost is right next to player during attack
    if (dist > this.attackRange + 1.5) return false;
    
    // 2. Simplified angle check - ghost already faces player during chase
    // Use mesh.rotation.y since that's what we actually set (not quaternion)
    const ghostAngle = this.mesh.rotation.y;
    const ghostForward = new THREE.Vector3(Math.sin(ghostAngle), 0, Math.cos(ghostAngle));
    
    const toPlayer = new THREE.Vector3(
      playerPos.x - ghostPos.x,
      0,
      playerPos.z - ghostPos.z
    ).normalize();
    
    const dot = toPlayer.dot(ghostForward);
    
    // Very forgiving angle - dot > -0.3 means within ~110 degree cone (almost always hits if close)
    // Since ghost faces player during chase, this should almost always pass
    if (dot < -0.3) {
      console.log('Ghost: Attack missed due to angle, dot:', dot.toFixed(2));
      return false;
    }
    
    console.log('Ghost: Attack hit confirmed! Distance:', dist.toFixed(2), 'Angle dot:', dot.toFixed(2));
    return true;
  }

  _initiateAttack() {
    if (this.isAttacking) return;
    
    this.isAttacking = true;
    this.currentState = 'attack';
    this._playAnimation('attack');
    this.attackCooldown = this.attackDuration + 1.0;
    
    // Play ghost moan during attack
    getAudioManager().playGhostMoan();
    
    console.log('Ghost: Attacking player!');
    
    // STORE initial attack data - player position at attack start
    const playerPosAtAttackStart = this.player.getPosition();
    const ghostPosAtAttackStart = { x: this.body.position.x, z: this.body.position.z };
    const distanceAtAttackStart = Math.sqrt(
      (playerPosAtAttackStart.x - ghostPosAtAttackStart.x) ** 2 +
      (playerPosAtAttackStart.z - ghostPosAtAttackStart.z) ** 2
    );
    
    console.log('Ghost: Attack initiated at distance:', distanceAtAttackStart.toFixed(2));
    
    let hitTriggered = false;
    
    // IMMEDIATE HIT: If player was very close when attack started, guaranteed hit
    if (distanceAtAttackStart <= this.attackRange) {
      console.log('Ghost: IMMEDIATE HIT - player was in kill range at attack start!');
      hitTriggered = true;
      
      // Trigger damage immediately
      if (this.player && typeof this.player.onGhostAttack === 'function') {
        this.player.onGhostAttack();
      }
      window.dispatchEvent(new CustomEvent('ghostAttack', { detail: { ghost: this } }));
      
    } else {
      // Schedule delayed hit check for edge cases (player ran into ghost)
      const hitDelay = 400; // Slightly faster hit
      
      setTimeout(() => {
        // Only check if we are still attacking and haven't already hit
        if (this.isAttacking && !hitTriggered && this._checkAttackHit()) {
          console.log('Ghost: Attack LANDED (delayed check)!');
          // Trigger damage
          if (this.player && typeof this.player.onGhostAttack === 'function') {
            this.player.onGhostAttack();
          }
          window.dispatchEvent(new CustomEvent('ghostAttack', { detail: { ghost: this } }));
          hitTriggered = true;
        } else if (!hitTriggered) {
          console.log('Ghost: Attack MISSED (delayed check)!');
        }
      }, hitDelay);
    }
    
    // Function to reset ghost after attack sequence
    const resetAfterAttack = () => {
      this.isAttacking = false;
      this.lastSeenPlayerPos = null;
      
      // If we killed the player, wait longer
      // (This logic is usually handled by the 'death' reset in game, but here for coherence)
      
      if (hitTriggered) {
         this.killCooldown = this.postKillWaitTime;
         this.currentState = 'wander';
         this.hasSeenPlayer = false;
         // Teleport away logic is handled in onGhostAttack handler usually
         // But we can do it here too
         setTimeout(() => this.respawnRandomly(), 1000);
      } else {
         // Missed attack - brief pause then chase again
         this.currentState = 'chase'; 
      }
    };
    
    // Listen for attack animation to finish
    if (this.animations.attack) {
      const onFinished = () => {
        this.mixer.removeEventListener('finished', onFinished);
        resetAfterAttack();
      };
      this.mixer.addEventListener('finished', onFinished);
    } else {
      setTimeout(() => {
        resetAfterAttack();
      }, this.attackDuration * 1000);
    }
  }
  
  _updatePosition(deltaTime, direction, speed) {
    if (direction.lengthSq() > 0.01) {
      const newX = this.body.position.x + direction.x * speed * deltaTime;
      const newZ = this.body.position.z + direction.z * speed * deltaTime;
      
      // Check wall collision - ghost respects maze walls
      const canMoveX = this._isWorldPosWalkable(newX, this.body.position.z);
      const canMoveZ = this._isWorldPosWalkable(this.body.position.x, newZ);
      const canMoveBoth = this._isWorldPosWalkable(newX, newZ);
      
      if (canMoveBoth) {
        this.body.position.x = newX;
        this.body.position.z = newZ;
      } else if (canMoveX) {
        this.body.position.x = newX;
      } else if (canMoveZ) {
        this.body.position.z = newZ;
      }
      // If blocked, stuck timer will handle respawn
      
      // Rotate model to face movement direction
      const targetAngle = Math.atan2(direction.x, direction.z);
      this.mesh.rotation.y = targetAngle;
    }
    
    // Keep ghost grounded
    const groundY = 0;
    const targetY = groundY + this.height / 2;
    this.body.position.y = targetY;
    
    // Sync mesh to body
    this.mesh.position.set(
      this.body.position.x + this.visualOffset.x,
      this.body.position.y + this.visualOffset.y,
      this.body.position.z + this.visualOffset.z
    );
    
    // Store last known position for tracking
    this._lastKnownPosition.set(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z
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
    this.body.position.y = targetY;
    
    this.mesh.position.set(
      this.body.position.x + this.visualOffset.x,
      this.body.position.y + this.visualOffset.y,
      this.body.position.z + this.visualOffset.z
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
        (ghostPos.x - playerPos.x) ** 2 +
        (ghostPos.z - playerPos.z) ** 2
      );
      return distance <= this.detectionRadius;
    }
    
    const from = new CANNON.Vec3(ghostPos.x, ghostPos.y + 0.5, ghostPos.z);
    const to = new CANNON.Vec3(playerPos.x, playerPos.y + 0.5, playerPos.z);
    
    this.world.raycastClosest(from, to, { skipBackfaces: true, collisionFilterMask: -1 }, this.raycastResult);
    
    if (!this.raycastResult.hasHit) return true;
    
    const hitPoint = this.raycastResult.hitPointWorld;
    const distToHit = Math.sqrt(
      (hitPoint.x - playerPos.x) ** 2 +
      (hitPoint.y - playerPos.y) ** 2 +
      (hitPoint.z - playerPos.z) ** 2
    );
    
    return distToHit < 1.0;
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
    let x0 = gx, y0 = gz, x1 = px, y1 = pz;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    while (true) {
      // Check if current cell is a wall
      if (x0 >= 0 && y0 >= 0 && x0 < this.mazeData.width && y0 < this.mazeData.height) {
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
      const dir = new THREE.Vector3(targetPos.x - ghostPos.x, 0, targetPos.z - ghostPos.z);
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
    const targetCellChanged = !this._lastTargetCell || 
                               this._lastTargetCell.x !== targetCell.x || 
                               this._lastTargetCell.z !== targetCell.z;
    
    // RECALCULATE CONDITIONS (with time guard):
    const needsNewPath = canRecalculate && (
      !this._currentPath || 
      this._currentPath.length === 0 ||
      this._pathIndex >= this._currentPath.length ||
      (targetCellChanged && timeSinceLastCalc > 500) // Wait even longer for target changes
    );
    
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
        if (this._currentPath.length > 1 && 
            this._currentPath[0].x === ghostCell.x && 
            this._currentPath[0].z === ghostCell.z) {
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
          const directDir = new THREE.Vector3(targetPos.x - ghostPos.x, 0, targetPos.z - ghostPos.z);
          if (directDir.lengthSq() > 0.001) directDir.normalize();
          return directDir;
        }
        
        // Continue with next waypoint (non-recursive to prevent stack issues)
        const nextWp = this._currentPath[this._pathIndex];
        const nextX = nextWp.x * cellSize + cellSize / 2;
        const nextZ = nextWp.z * cellSize + cellSize / 2;
        const nextDir = new THREE.Vector3(nextX - ghostPos.x, 0, nextZ - ghostPos.z);
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
    const fallbackDir = new THREE.Vector3(targetPos.x - ghostPos.x, 0, targetPos.z - ghostPos.z);
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
      z: Math.floor(z / cellSize)
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
    
    if (this._lastGhostCell && 
        this._lastGhostCell.x === ghostCell.x && 
        this._lastGhostCell.z === ghostCell.z) {
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
      const nearest = this._findNearestWalkable(startX, startZ, maze, width, height);
      if (nearest) { startX = nearest.x; startZ = nearest.z; }
    }
    if (maze[endZ] && maze[endZ][endX] === 1) {
      const nearest = this._findNearestWalkable(endX, endZ, maze, width, height);
      if (nearest) { endX = nearest.x; endZ = nearest.z; }
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
  
  _updateRoaming(deltaTime, ghostPos) {
    this.roamingTimer -= deltaTime;
    
    if (this.roamingTimer <= 0 || !this.roamingTarget || 
        (this.roamingTarget && 
         Math.sqrt((this.roamingTarget.x - ghostPos.x) ** 2 + 
                   (this.roamingTarget.z - ghostPos.z) ** 2) < 2.0)) {
      this._pickNewRoamingTarget(ghostPos);
      const dur = this.roamingInterval.min + 
                  Math.random() * (this.roamingInterval.max - this.roamingInterval.min);
      this.roamingTimer = dur;
    }
    
    if (this.roamingTarget) {
      const toTarget = new THREE.Vector3(
        this.roamingTarget.x - ghostPos.x,
        0,
        this.roamingTarget.z - ghostPos.z
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
            z: playerPos.z + Math.cos(angle) * distance
        };
        // Ensure this point is strictly valid? _getPathAwareDirection handles invalid targets gracefully
        // But let's try to clamp it to maze bounds at least
        if (this.mazeData) {
             const mazeSize = this.mazeData.width * this.mazeData.cellSize;
             const halfSize = mazeSize / 2;
             this.roamingTarget.x = Math.max(-halfSize, Math.min(halfSize, this.roamingTarget.x));
             this.roamingTarget.z = Math.max(-halfSize, Math.min(halfSize, this.roamingTarget.z));
        }
        return;
    }

    if (!this.mazeData) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 5 + Math.random() * 15;
      this.roamingTarget = {
        x: currentPos.x + Math.sin(angle) * distance,
        z: currentPos.z + Math.cos(angle) * distance
      };
      return;
    }
    
    const mazeSize = this.mazeData.width * this.mazeData.cellSize;
    const halfSize = mazeSize / 2;
    
    this.roamingTarget = {
      x: -halfSize + Math.random() * mazeSize,
      z: -halfSize + Math.random() * mazeSize
    };
  }

  respawnRandomly() {
    const spawn = this._getRandomOpenCell();
    const world = (spawn && typeof spawn.z === 'number')
      ? { x: spawn.x, z: spawn.z }
      : this._cellToWorld(spawn.x, spawn.y);
    const y = 2.0; // Raised height for larger model
    this.body.position.set(world.x, y, world.z);
    this.mesh.position.set(world.x, y, world.z);
    this.currentState = 'wander';
    this.lastSeenPlayerPos = null;
    this.searchTimer = 0;
    this._pickNewRoamingTarget({ x: world.x, y: y, z: world.z });
    this._pickNewWanderDir(true);
  }

  _getRandomOpenCell() {
    if (this.mazeGenerator && typeof this.mazeGenerator.getRandomOpenCell === 'function') {
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
    if (this.mazeGenerator && typeof this.mazeGenerator.getWorldPosition === 'function') {
      const p = this.mazeGenerator.getWorldPosition(cx, cy);
      return { x: p.x, z: p.z };
    }
    const cell = this.mazeData?.cellSize || 2;
    return { x: cx * cell + cell / 2, z: cy * cell + cell / 2 };
  }

  _isWorldPosWalkable(x, z) {
    if (!this.mazeData) return true;
    const cellSize = this.mazeData.cellSize || 4;
    
    // Simple center-point check - let physics handle wall collisions
    const mx = Math.floor(x / cellSize);
    const my = Math.floor(z / cellSize);
    
    if (mx < 0 || my < 0 || mx >= this.mazeData.width || my >= this.mazeData.height) {
      return false;
    }
    
    if (this.mazeGenerator && typeof this.mazeGenerator.isValidPosition === 'function') {
      return this.mazeGenerator.isValidPosition(mx, my);
    } else {
      return this.mazeData.maze[my] && this.mazeData.maze[my][mx] === 0;
    }
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
    const dur = this.wanderInterval.min + Math.random() * (this.wanderInterval.max - this.wanderInterval.min);
    this.wanderTimer = resetTimer ? dur : Math.max(this.wanderTimer, dur);
  }
}
