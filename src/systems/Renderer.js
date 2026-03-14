import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export class Renderer {
  constructor() {
    this.canvas = document.querySelector("canvas.webgl");
    this.sizes = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    // Detect device capability safely
    this.isLowEndDevice = this._detectLowEndDevice();

    this._initRenderer();
    this._initPostProcessing();

    // Bind handleResize to be able to remove it later
    this._handleResizeBound = this._handleResize.bind(this);
    window.addEventListener("resize", this._handleResizeBound);
  }

  _detectLowEndDevice() {
    // Simple heuristic: reduced limit for mobile or logical cores
    const logicalCores = navigator.hardwareConcurrency || 4;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return isMobile && logicalCores <= 4;
  }

  _initRenderer() {
    this.instance = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // Disabled due to post-processing Bloom handling edge blending
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });

    this.instance.setSize(this.sizes.width, this.sizes.height);
    this.instance.setPixelRatio(
      Math.min(window.devicePixelRatio, this.isLowEndDevice ? 1 : 1.5),
    );

    // High Quality Settings
    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type = THREE.PCFSoftShadowMap;
    this.instance.outputColorSpace = THREE.SRGBColorSpace;

    // Cinematic Lighting (Critical for Horror Atmosphere)
    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 1; // Default exposure
  }

  _initPostProcessing() {
    // Skip post-processing on low-end devices to maintain performance
    if (this.isLowEndDevice) {
      console.log("Renderer: Post-processing disabled for performance");
      return;
    }

    this.composer = new EffectComposer(this.instance);
    this.composer.setSize(this.sizes.width, this.sizes.height);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    // 1. Render Pass (Base Scene)
    this.renderPass = new RenderPass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
    ); // Will be updated in render loop
    this.composer.addPass(this.renderPass);

    // 2. Bloom Pass (HDR Glow for Portal Effect) - Half resolution for performance
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.sizes.width / 2, this.sizes.height / 2),
      0.8, // strength
      0.5, // radius
      0.8, // threshold (only bright HDR values bloom)
    );
    this.composer.addPass(this.bloomPass);

    console.log("Renderer: Post-processing initialized with Bloom Pass");
  }

  _handleResize() {
    // Update sizes
    this.sizes.width = window.innerWidth;
    this.sizes.height = window.innerHeight;

    // Update renderer
    this.instance.setSize(this.sizes.width, this.sizes.height);
    this.instance.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    // Update composer
    if (this.composer) {
      this.composer.setSize(this.sizes.width, this.sizes.height);
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    }

    // Notify listeners if needed (e.g. Camera)
    if (this.onResizeCallback) {
      this.onResizeCallback(this.sizes.width, this.sizes.height);
    }
  }

  onResize(callback) {
    this.onResizeCallback = callback;
  }

  render(scene, camera) {
    if (this.composer) {
      // Update render pass scene/camera in case they changed (dynamic scene switching)
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      this.composer.render();
    } else {
      this.instance.render(scene, camera);
    }
  }

  dispose() {
    window.removeEventListener("resize", this._handleResizeBound);

    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }

    if (this.instance) {
      this.instance.dispose();
      // Also dispose of the dedicated DOM element if it was created by us,
      // but here we used an existing canvas, so we shouldn't remove it, just clean context.
      // But Three.js dispose() cleans up GL state.
      this.instance = null;
    }

    this.renderPass = null;
    this.bloomPass = null;
    console.log("[Renderer] Disposed.");
  }
}
