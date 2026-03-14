/**
 * TextureEngine - Centralized PBR Texture & Material Management System
 *
 * Features:
 * - PBR texture loading (Albedo, Normal, Roughness, Metallic, AO, Height)
 * - Texture caching to avoid duplicate loads
 * - Material factory with presets
 * - Automatic optimization (anisotropic filtering, mipmaps)
 * - Seamless integration with Three.js
 *
 * Usage:
 *   const textureEngine = getTextureEngine();
 *   await textureEngine.init(renderer);
 *   const material = await textureEngine.loadPBRMaterial('wall', config);
 */

import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

// PBR Map types
const PBRMapType = {
  ALBEDO: "albedo",
  NORMAL: "normal",
  ROUGHNESS: "roughness",
  METALLIC: "metallic",
  AO: "ao",
  HEIGHT: "height",
  EMISSIVE: "emissive",
};

export class TextureEngine {
  constructor() {
    // Three.js loaders
    this.textureLoader = new THREE.TextureLoader();
    this.ktx2Loader = null; // Initialized in init() when renderer is available

    // Caches
    this.textureCache = new Map(); // path -> THREE.Texture
    this.materialCache = new Map(); // name -> THREE.Material

    // Renderer reference for anisotropy
    this.renderer = null;
    this.maxAnisotropy = 16;

    // State
    this.initialized = false;
    this.ktx2Supported = false; // True if KTX2Loader initialized successfully

    // Default texture settings
    this.defaultTextureSettings = {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      flipY: true, // Fixed: enable flipY to correct upside-down textures
    };

    // Material presets - define common materials used in the game
    this.presets = {
      wall: {
        // Full PBR texture set from ChatGPT folder
        // Pointing to textures-ktx2 folder allows engine to try KTX2 first
        albedo: "./assets/textures-ktx2/ChatGPT/Albedo.png",
        normal: "./assets/textures-ktx2/ChatGPT/Normal.png",
        roughnessMap: "./assets/textures-ktx2/ChatGPT/Roughness.png",
        metallicMap: "./assets/textures-ktx2/ChatGPT/Metallic.png",
        roughness: 1.0, // Use map values
        metalness: 1.0, // Use map values
        normalScale: 1.2, // Slightly stronger for more depth
        // Walls are cellSize(4) wide x wallHeight(3) tall
        // Repeat proportionally to avoid stretching
        repeat: { x: 1, y: 0.75 }, // 4:3 ratio matches wall dimensions
        mirroredWrap: true, // Anti-tiling
        side: 2, // THREE.DoubleSide for better visibility
      },
      floor: {
        // Full PBR texture set from Ground folder
        albedo: "./assets/textures-ktx2/Ground/Albedo.png",
        normal: "./assets/textures-ktx2/Ground/Normal.png",
        roughnessMap: "./assets/textures-ktx2/Ground/Roughness.png",
        metallicMap: "./assets/textures-ktx2/Ground/Metallic.png",
        heightMap: "./assets/textures-ktx2/Ground/Height.png",
        roughness: 1.0, // Use map values
        metalness: 1.0, // Use map values
        normalScale: 0.8,
        heightScale: 0.15, // Visible displacement (requires subdivided geometry)
        heightBias: -0.075, // Center the displacement (half of heightScale, negative)
        repeat: { x: 0.1, y: 0.1 },
        // Anti-tiling: Use mirrored wrapping to break up visible repetition
        mirroredWrap: true,
      },
      boundary: {
        color: 0x111111,
        roughness: 0.9,
        metalness: 0.1,
      },
      monster: {
        roughness: 0.6,
        metalness: 0.2,
        emissive: 0x330000,
        emissiveIntensity: 0.1,
      },
      start_marker: {
        color: 0x48bb78,
        roughness: 0.3,
        metalness: 0.4,
        emissive: 0x48bb78,
        emissiveIntensity: 0.15,
      },
      end_marker: {
        color: 0xf56565,
        roughness: 0.3,
        metalness: 0.4,
        emissive: 0xf56565,
        emissiveIntensity: 0.15,
      },
    };

    // State
    this.initialized = false;

    // Middleware/Modifiers
    this.materialModifiers = [];

    console.log("[TextureEngine] Created");
  }

  /**
   * Register a function to modify materials after creation
   * @param {Function} modifier - Function(material) => void
   */
  registerMaterialModifier(modifier) {
    this.materialModifiers.push(modifier);
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /**
   * Initialize the texture engine
   * @param {THREE.WebGLRenderer} renderer - The renderer for anisotropy detection
   */
  init(renderer) {
    if (this.initialized) return;

    this.renderer = renderer;

    // Detect max anisotropy for quality filtering
    if (renderer && renderer.capabilities) {
      this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    }

    // Initialize KTX2Loader for GPU-compressed textures
    try {
      this.ktx2Loader = new KTX2Loader();
      this.ktx2Loader.setTranscoderPath("/basis/");
      this.ktx2Loader.detectSupport(renderer);
      this.ktx2Supported = true;
      console.log("[TextureEngine] KTX2 support enabled");
    } catch (error) {
      console.warn(
        "[TextureEngine] KTX2 not available, using standard textures:",
        error,
      );
      this.ktx2Supported = false;
    }

    this.initialized = true;
    console.log(
      `[TextureEngine] Initialized (maxAnisotropy: ${this.maxAnisotropy}, ktx2: ${this.ktx2Supported})`,
    );
  }

  // ============================================================
  // TEXTURE LOADING
  // ============================================================

  /**
   * Load a single texture with caching and optimization
   * @param {string} path - Path to the texture file
   * @param {object} options - Optional texture settings override
   * @returns {Promise<THREE.Texture>}
   */
  async loadTexture(path, options = {}) {
    // Check cache first
    if (this.textureCache.has(path)) {
      console.log(`[TextureEngine] Cache hit: ${path}`);
      return this.textureCache.get(path);
    }

    // Try KTX2 version first if supported
    const ktx2Path = path.replace(/\.(png|jpg|jpeg)$/i, ".ktx2");
    if (this.ktx2Supported && ktx2Path !== path) {
      try {
        const texture = await this._loadKTX2Texture(ktx2Path, options);
        if (texture) {
          // Apply options
          this._applyTextureOptions(texture, options);
          this.textureCache.set(path, texture);
          console.log(`[TextureEngine] Loaded KTX2: ${ktx2Path}`);
          return texture;
        }
      } catch (error) {
        // KTX2 not found, fall back to original format
        console.log(`[TextureEngine] KTX2 not found, falling back: ${path}`);
      }
    }

    // Load standard texture (PNG/JPG)
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        path,
        (texture) => {
          this._applyTextureOptions(texture, options);
          this.textureCache.set(path, texture);
          console.log(`[TextureEngine] Loaded: ${path}`);
          resolve(texture);
        },
        undefined,
        (error) => {
          console.warn(`[TextureEngine] Failed to load: ${path}`, error);
          resolve(this._createPlaceholderTexture());
        },
      );
    });
  }

  /**
   * Apply texture options (shared between KTX2 and standard textures)
   * @private
   */
  _applyTextureOptions(texture, options) {
    if (options.mirroredWrap) {
      texture.wrapS = THREE.MirroredRepeatWrapping;
      texture.wrapT = THREE.MirroredRepeatWrapping;
    } else {
      texture.wrapS = options.wrapS ?? this.defaultTextureSettings.wrapS;
      texture.wrapT = options.wrapT ?? this.defaultTextureSettings.wrapT;
    }

    texture.minFilter =
      options.minFilter ?? this.defaultTextureSettings.minFilter;
    texture.magFilter =
      options.magFilter ?? this.defaultTextureSettings.magFilter;

    // KTX2 textures already have mipmaps, don't regenerate
    if (!texture.isCompressedTexture) {
      texture.generateMipmaps =
        options.generateMipmaps ?? this.defaultTextureSettings.generateMipmaps;
      texture.flipY = options.flipY ?? this.defaultTextureSettings.flipY;
    }

    texture.anisotropy = this.maxAnisotropy;

    if (options.repeat) {
      texture.repeat.set(options.repeat.x, options.repeat.y);
    }
  }

  /**
   * Load a KTX2 texture
   * @private
   */
  _loadKTX2Texture(path, options) {
    return new Promise((resolve, reject) => {
      this.ktx2Loader.load(
        path,
        (texture) => resolve(texture),
        undefined,
        (error) => reject(error),
      );
    });
  }

  /**
   * Load multiple textures in parallel
   * @param {string[]} paths - Array of texture paths
   * @returns {Promise<THREE.Texture[]>}
   */
  async loadTextures(paths) {
    return Promise.all(paths.map((path) => this.loadTexture(path)));
  }

  // ============================================================
  // PBR MATERIAL CREATION
  // ============================================================

  /**
   * Load a complete PBR material with all map types
   * @param {string} name - Unique name for caching
   * @param {object} config - PBR configuration
   * @returns {Promise<THREE.MeshStandardMaterial>}
   */
  async loadPBRMaterial(name, config = {}) {
    // Check cache first
    if (this.materialCache.has(name)) {
      console.log(`[TextureEngine] Material cache hit: ${name}`);
      return this.materialCache.get(name);
    }

    const materialOptions = {
      side: config.side ?? THREE.FrontSide,
      transparent: config.transparent ?? false,
    };

    // Load texture maps in parallel
    const loadPromises = [];

    // Shared texture options for all maps in this material
    const textureOptions = {
      repeat: config.repeat,
      mirroredWrap: config.mirroredWrap || false, // Anti-tiling option
    };

    // Albedo/Diffuse map
    if (config.albedo) {
      loadPromises.push(
        this.loadTexture(config.albedo, textureOptions).then((tex) => {
          materialOptions.map = tex;
        }),
      );
    } else if (config.color !== undefined) {
      materialOptions.color = config.color;
    }

    // Normal map
    if (config.normal) {
      loadPromises.push(
        this.loadTexture(config.normal, textureOptions).then((tex) => {
          materialOptions.normalMap = tex;
          if (config.normalScale) {
            materialOptions.normalScale = new THREE.Vector2(
              config.normalScale,
              config.normalScale,
            );
          }
        }),
      );
    }

    // Roughness map
    if (config.roughnessMap) {
      loadPromises.push(
        this.loadTexture(config.roughnessMap, textureOptions).then((tex) => {
          materialOptions.roughnessMap = tex;
        }),
      );
    }
    // Roughness value fallback
    materialOptions.roughness = config.roughness ?? 0.5;

    // Metallic map
    if (config.metallicMap) {
      loadPromises.push(
        this.loadTexture(config.metallicMap, textureOptions).then((tex) => {
          materialOptions.metalnessMap = tex;
        }),
      );
    }
    // Metalness value fallback
    materialOptions.metalness = config.metalness ?? 0.0;

    // AO (Ambient Occlusion) map
    if (config.aoMap) {
      loadPromises.push(
        this.loadTexture(config.aoMap, textureOptions).then((tex) => {
          materialOptions.aoMap = tex;
          materialOptions.aoMapIntensity = config.aoIntensity ?? 1.0;
        }),
      );
    }

    // Height/Displacement map
    if (config.heightMap) {
      loadPromises.push(
        this.loadTexture(config.heightMap, textureOptions).then((tex) => {
          materialOptions.displacementMap = tex;
          materialOptions.displacementScale = config.heightScale ?? 0.1;
          // Displacement bias centers the effect (negative = push down baseline)
          materialOptions.displacementBias = config.heightBias ?? 0;
        }),
      );
    }

    // Emissive map
    if (config.emissiveMap) {
      loadPromises.push(
        this.loadTexture(config.emissiveMap, textureOptions).then((tex) => {
          materialOptions.emissiveMap = tex;
        }),
      );
    }
    if (config.emissive !== undefined) {
      materialOptions.emissive = new THREE.Color(config.emissive);
      materialOptions.emissiveIntensity = config.emissiveIntensity ?? 1.0;
    }

    // Wait for all textures to load
    await Promise.all(loadPromises);

    // Create the material
    const material = new THREE.MeshStandardMaterial(materialOptions);

    // Cache the material
    this.materialCache.set(name, material);

    // Apply modifiers
    this.materialModifiers.forEach((modifier) => modifier(material));

    console.log(`[TextureEngine] Created PBR material: ${name}`);

    return material;
  }

  // ============================================================
  // PRESET MATERIALS
  // ============================================================

  /**
   * Get a preset material by name
   * @param {string} presetName - Name of the preset
   * @param {object} overrides - Optional overrides for the preset
   * @returns {Promise<THREE.MeshStandardMaterial>}
   */
  async getPreset(presetName, overrides = {}) {
    const preset = this.presets[presetName];
    if (!preset) {
      console.warn(`[TextureEngine] Unknown preset: ${presetName}`);
      return this._createFallbackMaterial();
    }

    // Merge preset with overrides
    const config = { ...preset, ...overrides };

    // Use preset name + overrides hash as cache key
    const cacheKey = `preset_${presetName}_${JSON.stringify(overrides)}`;

    return this.loadPBRMaterial(cacheKey, config);
  }

  /**
   * Register a new preset
   * @param {string} name - Preset name
   * @param {object} config - PBR configuration
   */
  registerPreset(name, config) {
    this.presets[name] = config;
    console.log(`[TextureEngine] Registered preset: ${name}`);
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================

  /**
   * Get a cached texture by path
   * @param {string} path - Texture path
   * @returns {THREE.Texture|null}
   */
  getTexture(path) {
    return this.textureCache.get(path) || null;
  }

  /**
   * Get a cached material by name
   * @param {string} name - Material name
   * @returns {THREE.Material|null}
   */
  getMaterial(name) {
    return this.materialCache.get(name) || null;
  }

  /**
   * Update texture repeat for a cached material
   * @param {string} name - Material name
   * @param {number} x - Repeat X
   * @param {number} y - Repeat Y
   */
  updateTextureRepeat(name, x, y) {
    const material = this.materialCache.get(name);
    if (material && material.map) {
      material.map.repeat.set(x, y);
      material.map.needsUpdate = true;
    }
  }

  /**
   * Create a placeholder texture for missing textures
   * @private
   */
  _createPlaceholderTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    // Checkerboard pattern
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillRect(32, 32, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  /**
   * Create a fallback material
   * @private
   */
  _createFallbackMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xff00ff, // Magenta = error
      roughness: 0.5,
      metalness: 0.0,
    });
  }

  /**
   * Preload all preset materials
   * @returns {Promise<void>}
   */
  async preloadPresets() {
    console.log("[TextureEngine] Preloading all presets...");
    const presetNames = Object.keys(this.presets);
    await Promise.all(presetNames.map((name) => this.getPreset(name)));
    console.log(`[TextureEngine] Preloaded ${presetNames.length} presets`);
  }

  /**
   * Get statistics about cached textures and materials
   */
  getStats() {
    return {
      textures: this.textureCache.size,
      materials: this.materialCache.size,
      presets: Object.keys(this.presets).length,
    };
  }

  /**
   * Dispose all cached textures and materials
   */
  dispose() {
    console.log("[TextureEngine] Disposing...");

    // Dispose textures
    for (const [path, texture] of this.textureCache) {
      texture.dispose();
    }
    this.textureCache.clear();

    // Dispose materials
    for (const [name, material] of this.materialCache) {
      material.dispose();
    }
    this.materialCache.clear();

    this.initialized = false;
    console.log("[TextureEngine] Disposed");
  }
}

// ============================================================
// SINGLETON
// ============================================================

let textureEngineInstance = null;

export function getTextureEngine() {
  if (!textureEngineInstance) {
    textureEngineInstance = new TextureEngine();
  }
  return textureEngineInstance;
}

export { PBRMapType };
