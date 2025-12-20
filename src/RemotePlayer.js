import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/**
 * RemotePlayer - Represents a remote player in multiplayer
 * Renders their position and animations synced from network
 */
export class RemotePlayer {
  constructor(scene, playerId, playerName = 'Player', playerGender = 'male') {
    this.scene = scene;
    this.playerId = playerId;
    this.playerName = playerName;
    this.playerGender = playerGender;
    
    // Gender-based colors
    this.characterColors = {
      male: {
        primary: 0x2d2d2d,   // Dark charcoal (matches hoodie)
        emissive: 0x000000,
        skin: 0xe8c4a0,
      },
      female: {
        primary: 0xff66aa,   // Pink (kept distinct for fallback)
        emissive: 0x441122,
        skin: 0xf0d0b8,
      }
    };
    
    // Target position (received from network)
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.targetRotation = 0;
    
    // Current interpolated position
    this.currentPosition = new THREE.Vector3(0, 0, 0);
    this.currentRotation = 0;
    
    // Animation state
    this.animState = 'idle';
    this.mixer = null;
    this.animations = { idle: null, walk: null, run: null };
    this.currentAction = null;
    this.modelLoaded = false;
    
    // Interpolation speed
    this.lerpSpeed = 10;
    
    // Player height config
    this.height = 1.8;
    this.radius = 0.4;
    
    // Create visual representation
    this._createMesh();
    this._createNameTag();
  }
  
  _createMesh() {
    // Create a group to hold the player model
    this.mesh = new THREE.Group();
    
    // Create colored capsule as fallback/default
    const bodyHeight = this.height - 2 * this.radius;
    const geometry = new THREE.CylinderGeometry(this.radius, this.radius, bodyHeight, 16);
    
    const topSphere = new THREE.SphereGeometry(this.radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const bottomSphere = new THREE.SphereGeometry(this.radius, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    
    // Use gender-based color
    const colors = this.characterColors[this.playerGender] || this.characterColors.male;
    const material = new THREE.MeshStandardMaterial({
      color: colors.primary,
      metalness: 0.1,
      roughness: 0.6,
      emissive: colors.emissive,
      emissiveIntensity: 0.2,
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
    
    // Offset so feet are at Y=0 (matching physics body center)
    this.fallbackMesh.position.y = 0;
    
    bodyMesh.castShadow = true;
    topMesh.castShadow = true;
    bottomMesh.castShadow = true;
    
    this.mesh.add(this.fallbackMesh);
    this.scene.add(this.mesh);
    
    // Try to load animated character model
    this._loadCharacterModel();
  }
  
  /**
   * Update gender and reload model if changed
   */
  async setGender(gender) {
    if (this.playerGender !== gender) {
      console.log(`RemotePlayer: Gender changed from ${this.playerGender} to ${gender}, reloading model...`);
      this.playerGender = gender;
      
      // Do NOT remove existing model immediately (avoids invisible player)
      // Instead, trigger a load and swap when ready
      await this._loadCharacterModel();
    }
  }

  /**
   * Force set position (no interpolation)
   */
  setPosition(x, y, z) {
    this.targetPosition.set(x, y, z);
    this.currentPosition.set(x, y, z);
    this.mesh.position.set(x, y, z);
  }

  /**
   * Get clothing color palette based on gender
   * Returns different color schemes for variety
   */
  _getClothingPalette() {
    if (this.playerGender === 'female') {
      return {
        skin: 0xf0d0b8,      // Light skin
        hair: 0x4a2912,      // Dark brown hair
        hoodie: 0xcc3366,    // Pink/magenta hoodie
        pants: 0x2d4a6d,     // Dark blue pants
        shoes: 0x1a1a1a,     // Black shoes
        default: 0xcc3366,   // Default to hoodie color
      };
    } else {
      return {
        skin: 0xe8c4a0,      // Warm skin
        hair: 0x2a1a0a,      // Dark brown hair
        hoodie: 0x2d2d2d,    // Dark charcoal (Matches Player.js)
        pants: 0x1a2744,     // Dark navy pants
        shoes: 0x1a1a1a,     // Black shoes
        default: 0x888888,   // Light Grey (Matches Player.js default)
      };
    }
  }
  
  async _loadCharacterModel() {
    // Prevent concurrent loads if one is already in progress for the same gender?
    // Actually, just let the latest one win.
    
    // 1. Ensure fallback is visible if we have NO model yet
    if (!this.loadedModel && !this.fallbackMesh) {
       this._createFallbackMesh(); // Helper (we need to potentially recreate it)
    }

    const loader = new FBXLoader();
    const genderToLoad = this.playerGender; // Capture current gender in closure
    const basePath = `./assets/${genderToLoad}/`;
    
    try {
      console.log(`RemotePlayer: Loading model for ${this.playerName} (${genderToLoad})...`);
      const model = await loader.loadAsync(basePath + `model/${genderToLoad}.fbx`);
      
      // If gender changed while we were loading, abort this stale result
      if (this.playerGender !== genderToLoad) {
         console.log('RemotePlayer: Load aborted, gender changed during load.');
         return; 
      }

      // Scale and position the model
      // MATCH PLAYER.JS SCALING LOGIC
      let finalScale = 1.0; // Reduced from 1.44
      if (genderToLoad === 'female') {
           finalScale = 0.01; 
      }
      model.scale.setScalar(finalScale);
      
      model.scale.setScalar(finalScale);
      
      // Offset logic
      // Female model (at 0.01 scale) might have different origin or pivot.
      // If it looks "in the air", we need to lower it further (more negative Y).
      // Or maybe reset it if it was over-compensated.
      
      let yOffset = -this.height / 2;
      if (genderToLoad === 'female') {
          // If floating, try lowering it completely to align feet.
          // Standard FBX from mixamo usually have pivot at feet (y=0).
          // If pivot is at feet, we should put it at -height/2 relative to capsule center?
          // Capsule center is at height/2 above ground.
          // So feet should be at -height/2 relative to parent.
          // If it's floating, it means it's rendering too high.
          // Let's try pushing it down more.
          yOffset = -this.height / 2 - 0.1; // Slight adjustment or debug
          
          // Actually, if it's "in the air" significantly, maybe the scale made it tiny and hovering?
          // Let's stick to the standard logic first but ensure we calculate strictly.
          yOffset = -0.9; // Hardcode for 1.8m height
      }
      
      model.position.y = yOffset;
      
      // Get gender-based color palette
      const palette = this._getClothingPalette();
      
      // Apply detailed clothing colors
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
          // CHECK FOR EXISTING TEXTURE FIRST
          // If the model comes with textures (diffuse map), preserve them!
          if (child.material && (child.material.map || (Array.isArray(child.material) && child.material.some(m => m.map)))) {
               // FORCE CONVERSION TO MESH STANDARD MATERIAL
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
               
               return; // SKIP solid color overwrite
          }
          
          const meshName = (child.name || '').toLowerCase();
          const matName = child.material ? (child.material.name || '').toLowerCase() : '';
          const combinedName = meshName + ' ' + matName;
          
          let chosenColor = palette.default;
          let isSkin = false;
          
          const skinKeywords = ['body', 'skin', 'face', 'head', 'hand', 'arm', 'neck', 'cc_base', 'genesis'];
          for (const keyword of skinKeywords) {
            if (combinedName.includes(keyword)) {
              chosenColor = palette.skin;
              isSkin = true;
              break;
            }
          }
          
          if (!isSkin) {
            if (combinedName.includes('hair')) {
              chosenColor = palette.hair;
            } else if (combinedName.includes('hoodie') || combinedName.includes('jacket') || 
                       combinedName.includes('top') || combinedName.includes('shirt') || 
                       combinedName.includes('torso') || combinedName.includes('sweater')) {
              chosenColor = palette.hoodie;
            } else if (combinedName.includes('pants') || combinedName.includes('jeans') || 
                       combinedName.includes('trousers') || combinedName.includes('legs') || 
                       combinedName.includes('bottom')) {
              chosenColor = palette.pants;
            } else if (combinedName.includes('shoe') || combinedName.includes('feet') || 
                       combinedName.includes('boot')) {
              chosenColor = palette.shoes;
            }
          }
          
          child.material = new THREE.MeshStandardMaterial({
            color: chosenColor,
            roughness: isSkin ? 0.5 : 0.7,
            metalness: 0.1,
            side: THREE.DoubleSide,
          });
        }
      });
      
      // SWAP: Remove old logic and add new model
      
      // 1. Remove previous model if exists
      if (this.loadedModel) {
        this.mesh.remove(this.loadedModel);
        // clean up stored mixer/actions?
        if (this.mixer) this.mixer.stopAllAction();
      }
      
      // 2. Remove fallback (if currently showing)
      if (this.fallbackMesh) {
        this.mesh.remove(this.fallbackMesh);
        // We keep the object ref but remove it from scene graph
        // actually, we might want to dispose of it if we are confident?
        // Let's just remove it from parent.
      }
      
      // 3. Add new model
      this.mesh.add(model);
      this.loadedModel = model;
      
      // 4. Setup animations
      this.mixer = new THREE.AnimationMixer(model);
      this.animations = { idle: null, walk: null, run: null }; 
      
      // Load animations (parallel)
      const animPromises = ['idle', 'walk', 'run'].map(async (animName) => {
         try {
           const anim = await loader.loadAsync(basePath + `animations/${animName}.fbx`);
           if (anim.animations && anim.animations.length > 0) {
             const action = this.mixer.clipAction(anim.animations[0]);
             action.setLoop(THREE.LoopRepeat);
             this.animations[animName] = action;
           }
         } catch (e) { console.warn(`RemotePlayer: Failed to load ${animName}`); }
      });
      
      await Promise.all(animPromises);
      
      // 5. Restore animation state
      this.modelLoaded = true;
      if (this.animations[this.animState]) {
        this.currentAction = this.animations[this.animState];
        this.currentAction.play();
      } else if (this.animations.idle) {
         this.animations.idle.play();
         this.currentAction = this.animations.idle;
      }
      
      console.log('RemotePlayer: Model loaded/swapped for', this.playerName);
      
    } catch (error) {
      console.error('RemotePlayer: Failed to load model:', error);
      // On failure, ensure fallback is visible
      if (!this.loadedModel && !this.fallbackMesh) {
         this._createFallbackMesh(); 
      }
      if (!this.loadedModel && this.fallbackMesh && !this.fallbackMesh.parent) {
         this.mesh.add(this.fallbackMesh);
      }
    }
  }

  _createFallbackMesh() {
    if (this.fallbackMesh) return; // Already exists

    const bodyHeight = this.height - 2 * this.radius;
    const geometry = new THREE.CylinderGeometry(this.radius, this.radius, bodyHeight, 16);
    const topSphere = new THREE.SphereGeometry(this.radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const bottomSphere = new THREE.SphereGeometry(this.radius, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);

    const colors = this.characterColors[this.playerGender] || this.characterColors.male;
    const material = new THREE.MeshStandardMaterial({
      color: colors.primary,
      metalness: 0.1,
      roughness: 0.6,
      emissive: colors.emissive,
      emissiveIntensity: 0.2,
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
    this.fallbackMesh.position.y = 0;
    
    // Add to main mesh group
    this.mesh.add(this.fallbackMesh);
  }
  
  _createNameTag() {
    // Create a canvas for the name tag
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Draw background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    if (ctx.roundRect) {
      ctx.roundRect(0, 0, 256, 64, 10);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, 256, 64);
    }
    
    // Draw name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.playerName, 128, 32);
    
    // Create sprite
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ 
      map: texture,
      transparent: true,
      depthTest: false,
    });
    
    this.nameTag = new THREE.Sprite(spriteMaterial);
    this.nameTag.scale.set(2, 0.5, 1);
    this.nameTag.position.y = this.height + 0.5;
    
    this.mesh.add(this.nameTag);
  }
  
  /**
   * Update target position from network data
   */
  setNetworkState(position, rotation, animState) {
    this.targetPosition.set(position.x, position.y, position.z);
    this.targetRotation = rotation;
    this.animState = animState || 'idle';
  }
  
  /**
   * Update interpolation and animations
   */
  update(deltaTime) {
    // Interpolate position
    this.currentPosition.lerp(this.targetPosition, Math.min(1, this.lerpSpeed * deltaTime));
    
    // Interpolate rotation
    let rotDiff = this.targetRotation - this.currentRotation;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    this.currentRotation += rotDiff * Math.min(1, this.lerpSpeed * deltaTime);
    
    // Apply to mesh
    this.mesh.position.copy(this.currentPosition);
    this.mesh.rotation.y = this.currentRotation;
    
    // Update animation
    if (this.mixer) {
      this.mixer.update(deltaTime);
    }
    
    // Switch animation based on state
    if (this.modelLoaded && this.animations[this.animState]) {
      const targetAction = this.animations[this.animState];
      if (targetAction !== this.currentAction && targetAction) {
        targetAction.reset();
        targetAction.setEffectiveTimeScale(1);
        targetAction.setEffectiveWeight(1);
        
        if (this.currentAction) {
          targetAction.crossFadeFrom(this.currentAction, 0.25, true);
        }
        
        targetAction.play();
        this.currentAction = targetAction;
      }
    }
    
    // Make name tag face camera (billboard effect)
    // This is handled automatically by THREE.Sprite
  }
  
  /**
   * Cleanup
   */
  dispose() {
    // Remove from scene
    this.scene.remove(this.mesh);
    
    // Dispose geometries and materials
    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    
    // Stop animations
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
  }
}
