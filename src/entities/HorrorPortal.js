import * as THREE from "three";

/**
 * HorrorPortal - A shader-based portal effect with HDR emissive core,
 * frame geometry, and pulsing environmental lighting.
 *
 * Positioned against the south perimeter wall at the maze end.
 */
export class HorrorPortal {
  constructor(scene, position, options = {}) {
    this.scene = scene;
    this.position = position;
    this.physicsSystem = options.physicsSystem || null;
    this.group = null;
    this.time = 0;
    this.physicsBodies = [];

    // Maze data for wall positioning
    const cellSize = options.cellSize || 4;
    const mazeHeight = options.mazeHeight || 25;

    // Configuration - match maze wall height (default 3)
    this.config = {
      portalWidth: options.portalWidth || 2.5,
      portalHeight: options.portalHeight || 3.0, // Match maze wall height
      frameWidth: options.frameWidth || 0.2,
      frameDepth: options.frameDepth || 0.3,
      coreIntensity: options.coreIntensity || 4.0,
      lightIntensity: options.lightIntensity || 6.0,
      pulseSpeed: options.pulseSpeed || 2.0,
      // Calculate wall Z position for South Wall (Row height-1)
      // Inner face is at (height - 1) * cellSize
      wallZ: (mazeHeight - 1) * cellSize,
      ...options,
    };

    this._initShaders();
    this._initVisuals();
  }

  _initShaders() {
    // Portal Core Shader - HDR Emissive Swirl
    this.portalShader = {
      vertex: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragment: `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        
        // Simplex noise functions
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
        
        float snoise(vec2 v) {
          const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
          vec2 i = floor(v + dot(v, C.yy));
          vec2 x0 = v - i + dot(i, C.xx);
          vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod289(i);
          vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
          vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
          m = m*m; m = m*m;
          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 ox = floor(x + 0.5);
          vec3 a0 = x - ox;
          m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
          vec3 g;
          g.x = a0.x * x0.x + h.x * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 6; i++) {
            value += amplitude * snoise(p);
            p *= 2.0;
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          p.x *= 0.8; // Adjust aspect for new dimensions
          float r = length(p);
          float a = atan(p.y, p.x);
          
          // Swirl effect
          float swirl = a + 5.0 * snoise(vec2(r - uTime * 0.4, 0.0));
          vec2 uvSpiral = vec2(cos(swirl), sin(swirl)) * r;
          
          // Noise layers
          float n1 = fbm(uvSpiral * 3.0 - uTime * 0.5);
          float n2 = fbm(uvSpiral * 10.0 + uTime * 0.2);
          float fire = n1 + n2 * 0.4;
          
          // Core glow
          float core = 1.0 / (r * 2.5 + 0.1);
          fire *= core;
          
          // HDR Color palette
          vec3 black = vec3(0.02, 0.0, 0.0);
          vec3 darkRed = vec3(0.6, 0.0, 0.0);
          vec3 brightRed = vec3(2.0, 0.1, 0.0);
          vec3 hot = vec3(4.0, 1.5, 0.5);
          
          vec3 color = mix(black, darkRed, smoothstep(-0.2, 0.3, fire));
          color = mix(color, brightRed, smoothstep(0.3, 1.0, fire));
          color = mix(color, hot, smoothstep(1.0, 3.0, fire));
          
          // Soft edges
          float edgeX = smoothstep(0.98, 0.8, abs(vUv.x * 2.0 - 1.0));
          float edgeY = smoothstep(0.98, 0.8, abs(vUv.y * 2.0 - 1.0));
          float alpha = edgeX * edgeY;
          
          gl_FragColor = vec4(color * uIntensity, alpha * 0.98);
        }
      `,
    };
  }

  _initVisuals() {
    this.group = new THREE.Group();

    // Position portal AGAINST the south perimeter wall
    // The wall is at z = wallZ, portal should be slightly in front of it
    // Face towards the player (coming from inside the maze)
    // Increased offset to 0.4 to ensure core doesn't clip into the wall
    const portalZ = this.config.wallZ - this.config.frameDepth / 2 - 0.4;

    this.group.position.set(this.position.x, 0, portalZ);
    // No rotation needed - portal plane faces +Z by default (towards player)

    // Need to define dimensions first!
    const pw = this.config.portalWidth;
    const ph = this.config.portalHeight;
    const fw = this.config.frameWidth;
    const fd = this.config.frameDepth;

    // --- Reuse/Cache Geometries ---
    // We cache geometries to avoid re-creation
    let frameMat, pillarGeo, lintelGeo, portalGeo;

    if (window.PERF_ENABLED) {
      if (!HorrorPortal.cache) {
        HorrorPortal.cache = {
          pillarGeo: new THREE.BoxGeometry(fw, ph, fd),
          lintelGeo: new THREE.BoxGeometry(pw + fw * 2, fw, fd),
          portalGeo: new THREE.PlaneGeometry(pw, ph),
          frameMat: new THREE.MeshStandardMaterial({
            color: 0x1a1815,
            roughness: 0.9,
            metalness: 0.0,
          }),
        };
      }
      pillarGeo = HorrorPortal.cache.pillarGeo;
      lintelGeo = HorrorPortal.cache.lintelGeo;
      portalGeo = HorrorPortal.cache.portalGeo;
      frameMat = HorrorPortal.cache.frameMat;
    } else {
      frameMat = new THREE.MeshStandardMaterial({
        color: 0x1a1815,
        roughness: 0.9,
        metalness: 0.0,
      });
      pillarGeo = new THREE.BoxGeometry(fw, ph, fd);
      lintelGeo = new THREE.BoxGeometry(pw + fw * 2, fw, fd);
      portalGeo = new THREE.PlaneGeometry(pw, ph);
    }

    // Left Pillar
    const leftPillar = new THREE.Mesh(pillarGeo, frameMat);
    leftPillar.position.set(-(pw / 2 + fw / 2), ph / 2, 0);
    leftPillar.castShadow = true;
    leftPillar.receiveShadow = true;
    this.group.add(leftPillar);

    // Right Pillar
    const rightPillar = new THREE.Mesh(pillarGeo, frameMat);
    rightPillar.position.set(pw / 2 + fw / 2, ph / 2, 0);
    rightPillar.castShadow = true;
    rightPillar.receiveShadow = true;
    this.group.add(rightPillar);

    // Top Lintel
    const topLintel = new THREE.Mesh(lintelGeo, frameMat);
    topLintel.position.set(0, ph + fw / 2, 0);
    topLintel.castShadow = true;
    topLintel.receiveShadow = true;
    this.group.add(topLintel);

    // --- Portal Core (Shader Plane) ---
    // Material must be unique per instance because uTime is updated per instance
    this.portalMat = new THREE.ShaderMaterial({
      vertexShader: this.portalShader.vertex,
      fragmentShader: this.portalShader.fragment,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: this.config.coreIntensity },
      },
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.portalMesh = new THREE.Mesh(portalGeo, this.portalMat);
    this.portalMesh.position.set(0, ph / 2, 0);
    this.group.add(this.portalMesh);

    // --- Environmental Lighting (Pulsing) ---
    // Front Light (towards player - inside the maze)
    this.lightFront = new THREE.PointLight(
      0xff0000,
      this.config.lightIntensity,
      20,
      2,
    );
    this.lightFront.position.set(0, ph / 2, -2); // In front of portal (towards maze)
    this.lightFront.castShadow = true;
    this.group.add(this.lightFront);

    // Back Light (behind portal - in the wall)
    this.lightBack = new THREE.PointLight(
      0xff0000,
      this.config.lightIntensity * 0.3,
      10,
      2,
    );
    this.lightBack.position.set(0, ph / 2, 1);
    this.group.add(this.lightBack);

    // Store materials/geometries for disposal (ONLY if they are NOT cached)
    // If cached, we should NOT dispose them when a single Level unloads,
    // unless we are unloading the whole game?
    // Actually, Level unload calls dispose().
    // If we dispose the cached geometry, the next level/portal will crash.
    // So we must track ownership.

    if (window.PERF_ENABLED) {
      this.materials = [this.portalMat]; // Only dispose the unique shader mat
      this.geometries = []; // Don't dispose cached geometries
    } else {
      this.materials = [frameMat, this.portalMat];
      this.geometries = [pillarGeo, lintelGeo, portalGeo];
    }

    this.scene.add(this.group);

    // --- Add Physics Colliders for Frame ---
    this._createPhysics(pw, ph, fw, fd);

    console.log(
      `[HorrorPortal] Created at (${this.position.x.toFixed(
        1,
      )}, ${portalZ.toFixed(1)}) against wall at z=${this.config.wallZ}`,
    );
  }

  _createPhysics(pw, ph, fw, fd) {
    if (!this.physicsSystem) return;

    const worldPos = this.group.position;

    // Left pillar physics
    const leftBody = this.physicsSystem.createStaticBox(
      {
        x: worldPos.x - (pw / 2 + fw / 2),
        y: ph / 2,
        z: worldPos.z,
      },
      { x: fw / 2, y: ph / 2, z: fd / 2 },
    );
    if (leftBody) this.physicsBodies.push(leftBody.body);

    // Right pillar physics
    const rightBody = this.physicsSystem.createStaticBox(
      {
        x: worldPos.x + (pw / 2 + fw / 2),
        y: ph / 2,
        z: worldPos.z,
      },
      { x: fw / 2, y: ph / 2, z: fd / 2 },
    );
    if (rightBody) this.physicsBodies.push(rightBody.body);

    // Top lintel physics
    const topBody = this.physicsSystem.createStaticBox(
      {
        x: worldPos.x,
        y: ph + fw / 2,
        z: worldPos.z,
      },
      { x: (pw + fw * 2) / 2, y: fw / 2, z: fd / 2 },
    );
    if (topBody) this.physicsBodies.push(topBody.body);

    console.log("[HorrorPortal] Physics colliders created for frame");
  }

  /**
   * Get the center position of the portal core for detection
   */
  getCorePosition() {
    return {
      x: this.group.position.x,
      y: this.config.portalHeight / 2,
      z: this.group.position.z,
    };
  }

  /**
   * Get the detection radius for win condition
   */
  getDetectionRadius() {
    return this.config.portalWidth * 0.5; // ~1.25 unit radius
  }

  update(deltaTime) {
    if (!this.group) return;
    this.time += deltaTime;

    // Update shader time
    this.portalMat.uniforms.uTime.value = this.time;

    // Pulse environmental lighting synced with portal
    const pulse = Math.sin(this.time * this.config.pulseSpeed);
    const modulation = 1.0 + pulse * 0.2;

    this.lightFront.intensity = this.config.lightIntensity * modulation;
    this.lightBack.intensity = this.config.lightIntensity * 0.3 * modulation;
  }

  dispose() {
    if (this.group) {
      this.scene.remove(this.group);

      // Dispose geometries
      this.geometries.forEach((geo) => geo.dispose());

      // Dispose materials
      this.materials.forEach((mat) => mat.dispose());

      // Remove physics bodies
      if (this.physicsSystem) {
        this.physicsBodies.forEach((body) => {
          this.physicsSystem.removeBody(body);
        });
      }

      this.group = null;
    }
  }
}

// Static Cache for Geometries
HorrorPortal.cache = null;
