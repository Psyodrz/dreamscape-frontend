/**
 * AssetLoader - Centralized asset loading system with progress tracking
 * Ensures all game assets are loaded before gameplay starts
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

class AssetLoader {
  constructor() {
    this.loadingManager = new THREE.LoadingManager();
    this.textureLoader = new THREE.TextureLoader(this.loadingManager);
    this.fbxLoader = new FBXLoader(this.loadingManager);
    this.objLoader = new OBJLoader(this.loadingManager);
    
    // Cached assets
    this.textures = {};
    this.models = {};
    this.audio = {};
    
    // Loading state
    this.totalAssets = 0;
    this.loadedAssets = 0;
    this.progress = 0;
    this.isLoading = false;
    this.isLoaded = false;
    
    // Callbacks
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    
    // Setup loading manager callbacks
    this._setupLoadingManager();
  }
  
  _setupLoadingManager() {
    this.loadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
      console.log(`[AssetLoader] Started loading: ${url}`);
      this.totalAssets = itemsTotal;
    };
    
    this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
      this.loadedAssets = itemsLoaded;
      this.totalAssets = itemsTotal;
      this.progress = (itemsLoaded / itemsTotal) * 100;
      
      console.log(`[AssetLoader] Loading ${itemsLoaded}/${itemsTotal}: ${url}`);
      
      if (this.onProgress) {
        this.onProgress(this.progress, url);
      }
    };
    
    this.loadingManager.onLoad = () => {
      console.log('[AssetLoader] All assets loaded!');
      this.isLoading = false;
      this.isLoaded = true;
      this.progress = 100;
      
      if (this.onComplete) {
        this.onComplete();
      }
    };
    
    this.loadingManager.onError = (url) => {
      console.error(`[AssetLoader] Error loading: ${url}`);
      if (this.onError) {
        this.onError(url);
      }
    };
  }
  
  /**
   * Define all assets that need to be preloaded
   */
  getAssetManifest() {
    return {
      textures: [
        // Ground and walls
        { name: 'ground', path: './assets/ground.png' },
        { name: 'wall', path: './assets/wall.png' },
        { name: 'sky', path: './assets/sky.jpg' },
        { name: 'nightSky', path: './assets/NightSkyHDRI003_8K/NightSkyHDRI003.png' },
        
        // Lamp texture
        { name: 'lampTexture', path: './assets/lamp/18.jpg' },
        
        // Monster textures
        { name: 'monsterBaseColor', path: './assets/monster/textures/BaseColor.png' },
      ],
      
      models: [
        // Player models
        { name: 'maleModel', path: './assets/male/model/male.fbx', type: 'fbx' },
        { name: 'femaleModel', path: './assets/female/model/female.fbx', type: 'fbx' },
        
        // Monster model
        { name: 'monsterModel', path: './assets/monster/model/monster.fbx', type: 'fbx' },
        
        // Lamp model
        { name: 'lampModel', path: './assets/lamp/1.obj', type: 'obj' },
      ],
      
      animations: [
        // Player animations (male)
        { name: 'maleIdle', path: './assets/male/animations/idle.fbx' },
        { name: 'maleWalk', path: './assets/male/animations/walk.fbx' },
        { name: 'maleRun', path: './assets/male/animations/run.fbx' },
        { name: 'maleJump', path: './assets/male/animations/jump.fbx' },
        
        // Player animations (female)
        { name: 'femaleIdle', path: './assets/female/animations/idle.fbx' },
        { name: 'femaleWalk', path: './assets/female/animations/walk.fbx' },
        { name: 'femaleRun', path: './assets/female/animations/run.fbx' },
        
        // Monster animations
        { name: 'monsterIdle', path: './assets/monster/animations/full_low@Breathing Idle.fbx' },
        { name: 'monsterWalk', path: './assets/monster/animations/full_low@Walking.fbx' },
        { name: 'monsterRun', path: './assets/monster/animations/run.fbx' },
        { name: 'monsterAttack', path: './assets/monster/animations/full_low@Zombie Attack.fbx' },
      ],
      
      audio: [
        { name: 'background', path: './assets/audio/background.mp3' },
        { name: 'buttonClick', path: './assets/audio/button_click.mp3' },
        { name: 'gameStart', path: './assets/audio/game_start.mp3' },
        { name: 'footstep', path: './assets/audio/footstep.mp3' },
        { name: 'deathScream', path: './assets/audio/death_scream.mp3' },
        { name: 'wallHit', path: './assets/audio/wall_hit.mp3' },
        { name: 'ghostMoan', path: './assets/audio/ghost_moan.mp3' },
        { name: 'ghostWhisper', path: './assets/audio/ghost_whisper.mp3' },
        { name: 'heartbeat', path: './assets/audio/heartbeat.mp3' },
        { name: 'impact', path: './assets/audio/impact.mp3' },
      ]
    };
  }
  
  /**
   * Preload all essential game assets
   * @param {Function} onProgress - Progress callback (0-100)
   * @param {Function} onComplete - Completion callback
   * @param {Function} onError - Error callback
   */
  async preloadAll(onProgress, onComplete, onError) {
    if (this.isLoaded) {
      console.log('[AssetLoader] Assets already loaded');
      if (onComplete) onComplete();
      return;
    }
    
    if (this.isLoading) {
      console.log('[AssetLoader] Already loading...');
      return;
    }
    
    this.isLoading = true;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;
    
    const manifest = this.getAssetManifest();
    
    // Count total assets for progress tracking
    const totalCount = 
      manifest.textures.length + 
      manifest.models.length + 
      manifest.animations.length + 
      manifest.audio.length;
    
    let loadedCount = 0;
    
    const updateProgress = (name) => {
      loadedCount++;
      const progress = (loadedCount / totalCount) * 100;
      this.progress = progress;
      if (onProgress) onProgress(progress, name);
    };
    
    try {
      // Load textures (non-critical, allow failures)
      for (const tex of manifest.textures) {
        try {
          this.textures[tex.name] = await this._loadTexture(tex.path);
        } catch (e) {
          console.warn(`[AssetLoader] Could not load texture ${tex.name}:`, e.message);
        }
        updateProgress(tex.name);
      }
      
      // Load models (critical)
      for (const model of manifest.models) {
        try {
          if (model.type === 'fbx') {
            this.models[model.name] = await this._loadFBX(model.path);
          } else if (model.type === 'obj') {
            this.models[model.name] = await this._loadOBJ(model.path);
          }
        } catch (e) {
          console.warn(`[AssetLoader] Could not load model ${model.name}:`, e.message);
        }
        updateProgress(model.name);
      }
      
      // Load animations (critical for gameplay)
      for (const anim of manifest.animations) {
        try {
          this.models[anim.name] = await this._loadFBX(anim.path);
        } catch (e) {
          console.warn(`[AssetLoader] Could not load animation ${anim.name}:`, e.message);
        }
        updateProgress(anim.name);
      }
      
      // Load audio (preload only, don't block)
      for (const aud of manifest.audio) {
        try {
          this.audio[aud.name] = await this._loadAudio(aud.path);
        } catch (e) {
          console.warn(`[AssetLoader] Could not load audio ${aud.name}:`, e.message);
        }
        updateProgress(aud.name);
      }
      
      console.log('[AssetLoader] All assets loaded successfully!');
      this.isLoading = false;
      this.isLoaded = true;
      if (onComplete) onComplete();
      
    } catch (error) {
      console.error('[AssetLoader] Critical error during loading:', error);
      this.isLoading = false;
      if (onError) onError(error);
    }
  }
  
  /**
   * Load a single texture
   */
  _loadTexture(path) {
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        path,
        (texture) => resolve(texture),
        undefined,
        (error) => reject(error)
      );
    });
  }
  
  /**
   * Load an FBX model
   */
  _loadFBX(path) {
    return new Promise((resolve, reject) => {
      this.fbxLoader.load(
        path,
        (object) => resolve(object),
        undefined,
        (error) => reject(error)
      );
    });
  }
  
  /**
   * Load an OBJ model
   */
  _loadOBJ(path) {
    return new Promise((resolve, reject) => {
      this.objLoader.load(
        path,
        (object) => resolve(object),
        undefined,
        (error) => reject(error)
      );
    });
  }
  
  /**
   * Load an audio file
   */
  _loadAudio(path) {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.preload = 'auto';
      
      audio.oncanplaythrough = () => resolve(audio);
      audio.onerror = (e) => reject(e);
      
      audio.src = path;
    });
  }
  
  /**
   * Get a cached texture by name
   */
  getTexture(name) {
    return this.textures[name] || null;
  }
  
  /**
   * Get a cached model by name
   */
  getModel(name) {
    return this.models[name] || null;
  }
  
  /**
   * Get a cached audio by name
   */
  getAudio(name) {
    return this.audio[name] || null;
  }
  
  /**
   * Dispose all cached assets
   */
  dispose() {
    // Dispose textures
    for (const texture of Object.values(this.textures)) {
      if (texture && texture.dispose) {
        texture.dispose();
      }
    }
    this.textures = {};
    
    // Dispose models (traverse and dispose geometries/materials)
    for (const model of Object.values(this.models)) {
      if (model && model.traverse) {
        model.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      }
    }
    this.models = {};
    
    // Clear audio references
    for (const audio of Object.values(this.audio)) {
      if (audio) {
        audio.src = '';
      }
    }
    this.audio = {};
    
    this.isLoaded = false;
    console.log('[AssetLoader] Disposed all assets');
  }
}

// Singleton instance
let assetLoaderInstance = null;

export function getAssetLoader() {
  if (!assetLoaderInstance) {
    assetLoaderInstance = new AssetLoader();
  }
  return assetLoaderInstance;
}

export { AssetLoader };
