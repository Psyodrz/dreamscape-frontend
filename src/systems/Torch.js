/**
 * Torch - Procedural Fire Torch with Shader-Based Flames
 *
 * Features:
 * - Procedural fire using GLSL shaders with simplex noise
 * - Ember particle system
 * - 3D torch mesh (handle, rags, binding ring)
 * - Physics-based sway responding to player movement
 * - Flickering point light
 * - Same interface as Flashlight for easy swap
 */

import * as THREE from "three";

// ============================================================
// GLSL SHADER CODE
// ============================================================

// Simplex 3D Noise (shared by all shaders)
const commonNoise = `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i); 
    vec4 p = permute( permute( permute( 
            i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
            + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }
`;

const fireVertexShader = `
  uniform float uTime;
  uniform vec2 uPhysicsLag;
  varying vec2 vUv;
  varying float vNoise;
  
  ${commonNoise}

  void main() {
    vUv = uv;
    
    // Displacement Noise
    float time = uTime * 2.0;
    time += length(uPhysicsLag) * 2.0;
    
    float displacement = snoise(vec3(position.x * 2.0, position.y * 1.5 - time, position.z * 2.0));
    vNoise = displacement;

    vec3 newPos = position;
    
    // Base pinch and top taper for flame shape
    float basePinch = smoothstep(0.0, 0.2, uv.y);
    float topTaper = 1.0 - smoothstep(0.5, 1.2, uv.y);
    float shapeProfile = mix(0.35, 1.0, basePinch) * topTaper;
    
    newPos.x *= shapeProfile;
    newPos.z *= shapeProfile;
    
    // Physics Lag (flame bends opposite to movement)
    float heightFactor = pow(uv.y, 1.8);
    newPos.x += uPhysicsLag.x * heightFactor;
    newPos.z += uPhysicsLag.y * heightFactor;
    
    // Wind/Chaos at top of flame
    float chaos = smoothstep(0.1, 1.0, uv.y);
    newPos.x += displacement * 0.2 * chaos;
    newPos.z += snoise(vec3(position.x, position.y - time * 0.8, position.z)) * 0.2 * chaos;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
  }
`;

const fireFragmentShader = `
  uniform float uTime;
  uniform vec3 uColorCore;
  uniform vec3 uColorMid;
  uniform vec3 uColorEdge;
  
  varying vec2 vUv;
  varying float vNoise;

  ${commonNoise}

  float fbm(vec3 x) {
    float v = 0.0;
    float a = 0.5;
    vec3 shift = vec3(100.0);
    for (int i = 0; i < 4; ++i) {
      v += a * snoise(x);
      x = x * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float h = vUv.y;
    float fireStructure = fbm(vec3(vUv.x * 4.0, vUv.y * 2.0 - uTime * 3.0, uTime * 0.5));
    
    // Circular Gradient (Map Property)
    float distFromCenter = length(vUv.x - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.0, 0.8, distFromCenter);
    
    float alpha = core;
    alpha += fireStructure * 0.4;
    
    // Smooth Top Dissipation
    float topFade = 1.0 - smoothstep(0.6, 1.0, h);
    alpha *= topFade;
    
    // Base fade for connection
    alpha *= smoothstep(0.0, 0.1, h);

    float edgeAlpha = smoothstep(0.2, 0.5, alpha);
    
    // Color Transition Red->Orange->Yellow
    float temp = alpha + (1.0 - h) * 0.3;
    temp += fireStructure * 0.2;

    vec3 col = mix(uColorEdge, uColorMid, smoothstep(0.2, 0.5, temp));
    col = mix(col, uColorCore, smoothstep(0.5, 0.9, temp));
    
    col *= 1.5; 

    if (edgeAlpha < 0.01) discard;

    gl_FragColor = vec4(col, edgeAlpha);
  }
`;

const emberVertexShader = `
  uniform float uTime;
  attribute float aOffset;
  attribute float aSpeed;
  varying float vLife;

  void main() {
    // Particle age/life cycle
    float life = mod(uTime * aSpeed + aOffset, 1.0);
    vLife = life;

    vec3 pos = position;
    pos.y += life * 1.5;
    
    // Drift horizontally
    pos.x += sin(uTime * 2.0 + aOffset * 10.0) * 0.1 * life;
    pos.z += cos(uTime * 1.5 + aOffset * 20.0) * 0.1 * life;
    pos.x += (aOffset - 0.5) * 0.5 * life;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    
    // Shrink as particle ages
    float size = 40.0 * (1.0 - life);
    
    gl_PointSize = size / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const emberFragmentShader = `
  varying float vLife;
  
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;
    
    // Soft gradient texture
    float strength = 1.0 - (dist * 2.0);
    strength = pow(strength, 2.0);
    
    vec3 col = mix(vec3(0.8, 0.2, 0.0), vec3(1.0, 0.8, 0.0), strength);
    // Reduced brightness for softer embers
    
    // Fade out as life ends
    float alpha = strength * (1.0 - vLife);
    
    gl_FragColor = vec4(col, alpha);
  }
`;

// ============================================================
// HELPER: Convert hex color + intensity to Vector3 for shader
// ============================================================
function getHDRColor(hex, intensity) {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b).multiplyScalar(intensity);
}

// ============================================================
// TORCH CLASS
// ============================================================

export class Torch {
  constructor(camera, options = {}) {
    this.camera = camera;

    // Configuration
    this.config = {
      // ==========================================
      // TORCH POSITION SETTINGS
      // ==========================================
      // X: positive = right, negative = left
      offsetX: options.offsetX ?? 0.65,
      // Y: positive = up, negative = down
      offsetY: options.offsetY ?? -0.15,
      // Z: negative = forward (in front), positive = back
      offsetZ: options.offsetZ ?? -1.4,
      // Tilt: negative = tilt forward, positive = tilt back
      tiltX: options.tiltX ?? -0.4,

      // ==========================================
      // MOVEMENT/SWAY SETTINGS (Reduced & Reversed)
      // ==========================================
      swayAmount: options.swayAmount ?? 0.05,
      fireDragStrength: options.fireDragStrength ?? 0.4,
      rotationalDrag: options.rotationalDrag ?? 0.5,

      // ==========================================
      // LIGHT SETTINGS
      // ==========================================
      lightBaseIntensity: options.lightBaseIntensity ?? 80.0,
      lightFlickerSpeed: options.lightFlickerSpeed ?? 1.0,
      lightFlickerAmp: options.lightFlickerAmp ?? 20.0,
      lightColor: options.lightColor ?? "#ff7700",
      lightDistance: options.lightDistance ?? 15,

      // ==========================================
      // FIRE COLOR SETTINGS (From reference)
      // ==========================================
      fireCoreColor: options.fireCoreColor ?? "#ffddaa",
      fireCoreIntensity: options.fireCoreIntensity ?? 4.0,
      fireMidColor: options.fireMidColor ?? "#ff9900",
      fireMidIntensity: options.fireMidIntensity ?? 2.5,
      fireEdgeColor: options.fireEdgeColor ?? "#cc3300",
      fireEdgeIntensity: options.fireEdgeIntensity ?? 0.8,
    };

    // Callbacks
    this.onToggle = options.onToggle || null;

    // State
    this.isOn = true; // Starts ON (always lit)
    this.time = 0;

    // Physics state
    this.velocity = new THREE.Vector2(0, 0);
    this.lastRotY = 0;
    this.rotVelocity = 0;
    this.swayPosition = new THREE.Vector2(0, 0);

    // Three.js objects
    this.torchGroup = null;
    this.light = null;
    this.flameMesh = null;
    this.coreMesh = null;
    this.embers = null;
    this.fireUniforms = null;

    this._createTorch();
  }

  _createTorch() {
    // Main torch group attached to camera
    this.torchGroup = new THREE.Group();
    this.torchGroup.position.set(
      this.config.offsetX,
      this.config.offsetY,
      this.config.offsetZ
    );
    this.camera.add(this.torchGroup);

    // Create components
    this._createHandle();
    this._createRags();
    this._createBindingRing();
    this._createFlame();
    this._createEmbers();
    this._createLight();

    console.log("[Torch] Created - procedural fire torch ready");
  }

  // --- HANDLE (Wooden stick) ---
  _createHandle() {
    const handleGeo = new THREE.CylinderGeometry(0.04, 0.03, 0.45, 12, 10);

    // Add vertex noise for gnarly wood effect
    const posAttr = handleGeo.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      vertex.fromBufferAttribute(posAttr, i);
      vertex.x += (Math.random() - 0.5) * 0.008;
      vertex.z += (Math.random() - 0.5) * 0.008;
      if (Math.abs(vertex.y) < 0.2) {
        vertex.x *= 1.05;
        vertex.z *= 1.05;
      }
      posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    handleGeo.computeVertexNormals();

    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x664422,
      roughness: 1.0,
    });

    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = -0.25;
    handle.castShadow = true;
    this.torchGroup.add(handle);
  }

  // --- RAGS (Fuel/wrapped cloth) ---
  _createRags() {
    const ragGeo = new THREE.CylinderGeometry(0.065, 0.05, 0.15, 16, 5);

    // Deform to look like wrapped cloth
    const ragPos = ragGeo.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < ragPos.count; i++) {
      vertex.fromBufferAttribute(ragPos, i);
      const noise = Math.sin(vertex.y * 30.0 + vertex.x * 10.0) * 0.005;
      vertex.x += noise + (Math.random() - 0.5) * 0.005;
      vertex.z += noise + (Math.random() - 0.5) * 0.005;

      const distY = Math.abs(vertex.y);
      if (distY < 0.06) {
        const bulge = (0.06 - distY) * 0.2;
        vertex.x *= 1.0 + bulge;
        vertex.z *= 1.0 + bulge;
      }
      ragPos.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    ragGeo.computeVertexNormals();

    const ragMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 1.0,
      side: THREE.DoubleSide,
    });

    const rags = new THREE.Mesh(ragGeo, ragMat);
    rags.position.y = -0.05;
    rags.castShadow = true;
    this.torchGroup.add(rags);
  }

  // --- BINDING RING (Metal band) ---
  _createBindingRing() {
    const ringGeo = new THREE.TorusGeometry(0.052, 0.008, 6, 12);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.6,
      metalness: 0.8,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.14;
    this.torchGroup.add(ring);
  }

  // --- FLAME (Shader-based procedural fire) ---
  _createFlame() {
    this.fireUniforms = {
      uTime: { value: 0 },
      uPhysicsLag: { value: new THREE.Vector2(0, 0) },
      uColorCore: {
        value: getHDRColor(
          this.config.fireCoreColor,
          this.config.fireCoreIntensity
        ),
      },
      uColorMid: {
        value: getHDRColor(
          this.config.fireMidColor,
          this.config.fireMidIntensity
        ),
      },
      uColorEdge: {
        value: getHDRColor(
          this.config.fireEdgeColor,
          this.config.fireEdgeIntensity
        ),
      },
    };

    const fireMat = new THREE.ShaderMaterial({
      uniforms: this.fireUniforms,
      vertexShader: fireVertexShader,
      fragmentShader: fireFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Main flame body
    const flameGeo = new THREE.CylinderGeometry(0.05, 0.12, 0.6, 16, 12, true);
    flameGeo.translate(0, 0.3, 0); // Origin at bottom

    this.flameMesh = new THREE.Mesh(flameGeo, fireMat);
    this.flameMesh.position.y = 0.02; // Just inside top of rags
    this.torchGroup.add(this.flameMesh);

    // Inner core (brighter, smaller)
    const coreGeo = new THREE.CylinderGeometry(0.02, 0.08, 0.4, 8, 1, true);
    coreGeo.translate(0, 0.2, 0);

    this.coreMesh = new THREE.Mesh(coreGeo, fireMat);
    this.coreMesh.scale.set(0.8, 0.8, 0.8);
    this.coreMesh.position.y = 0.05;
    this.torchGroup.add(this.coreMesh);
  }

  // --- EMBERS (Rising particles) ---
  _createEmbers() {
    const emberCount = 30;
    const emberGeo = new THREE.BufferGeometry();
    const emberPos = new Float32Array(emberCount * 3);
    const emberOffset = new Float32Array(emberCount);
    const emberSpeed = new Float32Array(emberCount);

    for (let i = 0; i < emberCount; i++) {
      emberPos[i * 3] = 0;
      emberPos[i * 3 + 1] = 0;
      emberPos[i * 3 + 2] = 0;
      emberOffset[i] = Math.random();
      emberSpeed[i] = 0.5 + Math.random() * 0.5;
    }

    emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
    emberGeo.setAttribute("aOffset", new THREE.BufferAttribute(emberOffset, 1));
    emberGeo.setAttribute("aSpeed", new THREE.BufferAttribute(emberSpeed, 1));

    const emberMat = new THREE.ShaderMaterial({
      uniforms: this.fireUniforms,
      vertexShader: emberVertexShader,
      fragmentShader: emberFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.embers = new THREE.Points(emberGeo, emberMat);
    this.embers.position.y = 0.1;
    this.torchGroup.add(this.embers);
  }

  // --- POINT LIGHT ---
  _createLight() {
    // OPTIMIZATION: Use SpotLight instead of PointLight
    // PointLight requires 6 shadow maps (cube). SpotLight requires 1.
    // We use a very wide angle to simulate point light behavior in front of player.
    this.light = new THREE.SpotLight(
      this.config.lightColor,
      this.config.lightBaseIntensity,
      this.config.lightDistance,
      Math.PI / 2.5, // ~140 degrees cone
      0.5, // Penumbra (soft edges)
      1.5 // Decay
    );
    this.light.position.set(0, 0.1, 0); // Relative to torch group

    // SpotLight requires a target. We place it slightly in front of the torch.
    this.light.target.position.set(0, 0, -1);
    this.torchGroup.add(this.light);
    this.torchGroup.add(this.light.target); // Target must be in scene/group

    this.light.castShadow = this.config.castShadow !== false;
    this.light.shadow.bias = -0.0001;
    // Lower resolution shadow map is acceptable for diffuse torch
    this.light.shadow.mapSize.set(512, 512);
  }

  // ============================================================
  // HELPER: Update fire shader colors from config
  // ============================================================
  _updateFireColors() {
    if (this.fireUniforms) {
      this.fireUniforms.uColorCore.value = getHDRColor(
        this.config.fireCoreColor,
        this.config.fireCoreIntensity
      );
      this.fireUniforms.uColorMid.value = getHDRColor(
        this.config.fireMidColor,
        this.config.fireMidIntensity
      );
      this.fireUniforms.uColorEdge.value = getHDRColor(
        this.config.fireEdgeColor,
        this.config.fireEdgeIntensity
      );
    }
  }

  // ============================================================
  // PUBLIC API (Same interface as Flashlight)
  // ============================================================

  /**
   * Toggle torch on/off
   */
  toggle() {
    this.isOn = !this.isOn;
    this.torchGroup.visible = this.isOn;
    console.log(`[Torch] ${this.isOn ? "ON" : "OFF"}`);

    if (this.onToggle) this.onToggle(this.isOn);
    return this.isOn;
  }

  /**
   * Update torch animation (call each frame)
   * @param {number} deltaTime - Frame delta
   * @param {boolean} isMoving - Whether player is moving
   * @param {boolean} isSprinting - Whether player is sprinting
   * @param {THREE.Vector3} playerVelocity - Player movement velocity (optional)
   */
  update(
    deltaTime,
    isMoving = false,
    isSprinting = false,
    playerVelocity = null
  ) {
    if (!this.isOn) return;

    this.time += deltaTime;

    // Update shader time
    if (this.fireUniforms) {
      this.fireUniforms.uTime.value = this.time;
    }

    const t = this.time;

    // ==========================================
    // SWAY CALCULATION (Exact from reference)
    // ==========================================

    // Get speed magnitude from velocity
    let speedMag = 0;
    if (playerVelocity) {
      speedMag = Math.sqrt(playerVelocity.x ** 2 + playerVelocity.z ** 2);
    }

    // Bob animation (subtle bounce when moving)
    const bobY = Math.sin(t * 10) * speedMag * 0.002 * this.config.swayAmount;
    const bobX = Math.cos(t * 10) * speedMag * 0.002 * this.config.swayAmount;

    // Torch sway - torch tilts IN the direction of movement (natural arm movement)
    // When you move left, your arm (and torch) naturally tilts left
    if (playerVelocity) {
      this.swayPosition.x +=
        (playerVelocity.x * 0.003 - this.swayPosition.x) * deltaTime * 4;
      this.swayPosition.y +=
        (playerVelocity.z * 0.003 - this.swayPosition.y) * deltaTime * 4;
    } else {
      // Decay when no velocity
      this.swayPosition.x *= 0.92;
      this.swayPosition.y *= 0.92;
    }

    // ==========================================
    // APPLY TORCH TRANSFORMS
    // ==========================================
    this.torchGroup.position.x =
      this.config.offsetX + this.swayPosition.x * this.config.swayAmount + bobX;

    this.torchGroup.position.y = this.config.offsetY + bobY;

    this.torchGroup.position.z = this.config.offsetZ;

    // Rotation follows movement direction
    this.torchGroup.rotation.z =
      this.swayPosition.x * 2.0 * this.config.swayAmount;
    this.torchGroup.rotation.x =
      this.config.tiltX + this.swayPosition.y * 1.0 * this.config.swayAmount;

    // ==========================================
    // FLAME PHYSICS - Realistic Inertia
    // Fire bends OPPOSITE to movement (like a real flame lagging behind)
    // Move LEFT → flame bends RIGHT (inertia)
    // ==========================================
    if (this.fireUniforms) {
      let dragX = 0;
      let dragZ = 0;

      if (playerVelocity) {
        // Negative = flame bends opposite to movement direction (realistic inertia)
        dragX = -playerVelocity.x * 0.03 * this.config.fireDragStrength;
        dragZ = -playerVelocity.z * 0.03 * this.config.fireDragStrength;
      }

      // Rotational Inertia (when looking around, fire lags behind)
      const currentRotY = this.camera.rotation.y;
      const rotDelta = currentRotY - this.lastRotY;
      this.lastRotY = currentRotY;

      // Smooth interpolation for natural feel
      this.rotVelocity += (rotDelta - this.rotVelocity) * 8.0 * deltaTime;
      dragX += this.rotVelocity * this.config.rotationalDrag * 3.0;

      // Smooth the physics values for natural movement
      this.fireUniforms.uPhysicsLag.value.x +=
        (dragX - this.fireUniforms.uPhysicsLag.value.x) * deltaTime * 6;
      this.fireUniforms.uPhysicsLag.value.y +=
        (dragZ - this.fireUniforms.uPhysicsLag.value.y) * deltaTime * 6;
    }

    // ==========================================
    // LIGHT FLICKER
    // ==========================================
    const noiseVal =
      Math.sin(this.time * 10 * this.config.lightFlickerSpeed) *
        Math.sin(this.time * 40 * this.config.lightFlickerSpeed) +
      Math.random() * 0.1;

    this.light.intensity =
      this.config.lightBaseIntensity + noiseVal * this.config.lightFlickerAmp;

    // Subtle light position wobble
    this.light.position.x = Math.sin(this.time * 8) * 0.06;
    this.light.position.z = Math.cos(this.time * 12) * 0.06;
  }

  /**
   * Set torch on or off
   */
  setEnabled(enabled) {
    this.isOn = enabled;
    this.torchGroup.visible = enabled;
    if (this.onToggle) this.onToggle(this.isOn);
  }

  /**
   * Set light intensity
   */
  setIntensity(intensity) {
    this.config.lightBaseIntensity = intensity;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isOn: this.isOn,
      intensity: this.config.lightBaseIntensity,
      position: {
        x: this.config.offsetX,
        y: this.config.offsetY,
        z: this.config.offsetZ,
        tilt: this.config.tiltX,
      },
    };
  }

  /**
   * Set torch position (for adjusting placement)
   * @param {number} x - X offset (positive = right, negative = left)
   * @param {number} y - Y offset (positive = up, negative = down)
   * @param {number} z - Z offset (negative = forward, positive = back)
   * @param {number} tilt - Tilt angle in radians (negative = forward)
   */
  setPosition(x, y, z, tilt) {
    if (x !== undefined) this.config.offsetX = x;
    if (y !== undefined) this.config.offsetY = y;
    if (z !== undefined) this.config.offsetZ = z;
    if (tilt !== undefined) this.config.tiltX = tilt;

    // Apply immediately
    this.torchGroup.position.set(
      this.config.offsetX,
      this.config.offsetY,
      this.config.offsetZ
    );
    this.torchGroup.rotation.x = this.config.tiltX;

    console.log(
      `[Torch] Position set: X=${this.config.offsetX}, Y=${this.config.offsetY}, Z=${this.config.offsetZ}, Tilt=${this.config.tiltX}`
    );
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.torchGroup) {
      this.camera.remove(this.torchGroup);

      // Dispose geometries and materials
      this.torchGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });

      if (this.light?.shadow?.map) {
        this.light.shadow.map.dispose();
      }

      this.torchGroup = null;
      this.light = null;
      this.flameMesh = null;
      this.coreMesh = null;
      this.embers = null;
    }
  }
}
