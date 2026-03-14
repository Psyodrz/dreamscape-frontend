/**
 * ProceduralSky - Realistic Midnight Sky with Stars, Moon, and Clouds
 *
 * Based on hyper-realistic procedural sky algorithm:
 * - Procedural star field with twinkling
 * - Moon with crater texturing and glow
 * - Volumetric cloud layer using FBM noise
 * - Atmospheric haze near horizon
 *
 * Optimized for horror atmosphere (Midnight Ocean preset)
 */

import * as THREE from "three";

export class ProceduralSky {
  constructor(scene, options = {}) {
    this.scene = scene;

    // Configuration - Midnight Ocean preset (horror atmosphere)
    this.config = {
      skyTop: options.skyTop || new THREE.Color(0.0, 0.005, 0.02),
      skyBottom: options.skyBottom || new THREE.Color(0.001, 0.002, 0.005),
      cloudColor1: options.cloudColor1 || new THREE.Color(0.02, 0.02, 0.05),
      cloudColor2: options.cloudColor2 || new THREE.Color(0.05, 0.08, 0.15),
      cloudScale: options.cloudScale || 3.0,
      cloudDensity: options.cloudDensity || 0.6,
      starDensity: options.starDensity || 1.0,
      moonVisible:
        options.moonVisible !== undefined ? options.moonVisible : true,
      moonColor: options.moonColor || new THREE.Color(1.5, 1.5, 1.5),
      moonSize: options.moonSize || 0.05,
      radius: options.radius || 500, // Sky sphere radius
    };

    this.skyMesh = null;
    this.material = null;
    this.time = 0;

    this._createSky();
    console.log("[ProceduralSky] Midnight sky initialized");
  }

  _createSky() {
    // Sky sphere geometry (large enough to encompass scene)
    const geometry = new THREE.SphereGeometry(this.config.radius, 60, 40);

    // Custom shader material with procedural sky generation
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide, // Render inside of sphere
      uniforms: {
        time: { value: 0 },
        uSkyTop: { value: this.config.skyTop },
        uSkyBottom: { value: this.config.skyBottom },
        uCloudColor1: { value: this.config.cloudColor1 },
        uCloudColor2: { value: this.config.cloudColor2 },
        uCloudScale: { value: this.config.cloudScale },
        uCloudDensity: { value: this.config.cloudDensity },
        uStarDensity: { value: this.config.starDensity },
        uMoonVisible: { value: this.config.moonVisible ? 1.0 : 0.0 },
        uMoonColor: { value: this.config.moonColor },
        uMoonSize: { value: this.config.moonSize },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 uSkyTop;
        uniform vec3 uSkyBottom;
        uniform vec3 uCloudColor1;
        uniform vec3 uCloudColor2;
        uniform float uCloudScale;
        uniform float uCloudDensity;
        uniform float uStarDensity;
        uniform float uMoonVisible;
        uniform vec3 uMoonColor;
        uniform float uMoonSize;
        
        varying vec3 vWorldPosition;

        // --- NOISE FUNCTIONS ---
        // Pseudo-random hash
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        // 3D Value Noise
        float noise(in vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(
              mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y
            ),
            mix(
              mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y
            ), f.z
          );
        }

        // Fractal Brownian Motion
        float fbm(vec3 p) {
          float v = 0.0;
          float a = 0.5;
          // Shift to avoid artifacts
          vec3 shift = vec3(100.0);
          for (int i = 0; i < 5; i++) { // Reduced iterations slightly for performance
            v += a * noise(p);
            p = p * 2.02 + shift;
            a *= 0.5;
          }
          return v;
        }

        // Domain warping for craters
        float craterPattern(vec3 p) {
            float n = fbm(p * 2.0);
            return smoothstep(0.4, 0.7, n);
        }

        // --- STAR FIELD ---
        vec3 getStarField(vec3 dir) {
          if (uStarDensity < 0.01) return vec3(0.0);
          vec3 col = vec3(0.0);
          float scale = 250.0; // Higher = smaller stars
          vec3 p = dir * scale;
          vec3 id = floor(p);
          vec3 local = fract(p) - 0.5;
          float rnd = hash(id);
          
          if(rnd > (1.0 - (0.05 * uStarDensity))) {
            vec3 offset = vec3(hash(id), hash(id+1.0), hash(id+2.0)) - 0.5;
            float dist = length(local - offset * 0.7);
            // Sharp pinpoint stars
            float brightness = 0.0005 / (pow(dist, 2.5) + 0.00001);
            float twinkle = 0.5 + 0.5 * sin(time * 1.5 + rnd * 50.0);
            
            vec3 starColor = vec3(1.0);
            if(rnd > 0.98) starColor = vec3(0.6, 0.8, 1.0); // Blue
            else if(rnd > 0.95) starColor = vec3(1.0, 0.7, 0.5); // Orange
            
            col += starColor * brightness * twinkle;
          }
          return col;
        }

        // --- MOON ---
        vec3 getMoon(vec3 dir) {
          // Define Moon Sphere in 3D space
          // We place it at a distance in the sky direction
          vec3 moonPos = normalize(vec3(0.0, 0.2, -1.0));
          float distToMoon = 20.0;
          vec3 sCenter = moonPos * distToMoon; // Sphere Center
          // Radius: uMoonSize is typically ~0.05 (angular). 
          // At dist 20, radius ~1.0 gives reasonable size.
          // Let's scale it by uMoonSize logic (remapping 0.05 -> ~1.0)
          float sRadius = uMoonSize * 20.0; 
          
          // Ray Interaction
          vec3 ro = vec3(0.0); // Viewer at origin
          vec3 rd = dir;       // View direction
          
          vec3 oc = ro - sCenter;
          float b = dot(oc, rd);
          float c = dot(oc, oc) - sRadius * sRadius;
          float h = b * b - c;
          
          // Light Direction (Static "Sun" for the moon phase)
          // Adjust this to change the phase (Crescent, Gibbous, Full)
          vec3 lightDir = normalize(vec3(1.5, 0.6, 1.0)); 

          vec3 col = vec3(0.0);
          
          if (h < 0.0) {
              // --- Atmospheric Glow (Outer Rim) ---
              // Calculate distance from ray to sphere center
              float distToCenter = length(cross(rd, oc)); // Distance from line to point
              
              // Standard glow
              if (distToCenter > sRadius && distToCenter < sRadius * 2.0) {
                   float glow = smoothstep(sRadius * 1.8, sRadius, distToCenter);
                   // Glow mainly on lit side
                   float angleToLight = dot(rd, normalize(cross(lightDir, moonPos))); // Approximation
                   // REDUCED GLOW: Tightened power (8.0) and reduced multiplier (0.05)
                   col += uMoonColor * 0.05 * pow(glow, 8.0);
              }
          } else {
              // --- Moon Surface ---
              float t = -b - sqrt(h);
              vec3 pos = ro + t * rd;
              vec3 normal = normalize(pos - sCenter);
              
              // Coordinate system for noise (align with moon)
              // We construct a rotation matrix to orient the moon texture towards the viewer
              // Or just use the local normal as the lookup coordinate
              vec3 surfPos = normal;

              // 1. Base Albedo (Color)
              vec3 albedo = vec3(0.75, 0.72, 0.7); // Light grey regolith

              // BLENDING: Tint albedo with sky theme for atmospheric integration
              vec3 themeColor = mix(uSkyBottom, uSkyTop, 0.3);
              albedo = mix(albedo, themeColor, 0.15); // 15% environment tint

              // 2. Maria (Dark Plains)
              float mariaNoise = fbm(surfPos * 1.2 + vec3(5.2));
              float mariaMask = smoothstep(0.45, 0.65, mariaNoise);
              // Tint maria with theme as well
              albedo = mix(albedo, vec3(0.3, 0.28, 0.28) * 0.8 + themeColor * 0.2, mariaMask * 0.8);

              // 3. High detail craters/roughness
              float detail = fbm(surfPos * 12.0);
              albedo *= mix(0.8, 1.2, detail);

              // 4. Moon Rays
              float rayNoise = fbm(surfPos * 20.0);
              if (rayNoise > 0.7 && mariaMask < 0.2) {
                 albedo += 0.1;
              }

              // --- Bump Mapping ---
              vec3 eps = vec3(0.005, 0.0, 0.0);
              // Simple finite difference for bump
              float hC = fbm(surfPos * 4.0);
              
              // Tangent approx
              vec3 t1 = normalize(cross(normal, vec3(0,1,0)));
              vec3 t2 = cross(normal, t1);
              
              float hX = fbm((surfPos + t1*0.01) * 4.0);
              float hY = fbm((surfPos + t2*0.01) * 4.0);
              
              vec3 bump = normalize(vec3(hC - hX, hC - hY, 0.1));
              float bumpStrength = mix(0.5, 0.1, mariaMask);
              
              // We don't have full tangent space, so we just perturb the normal slightly
              // This is a hacky 3D bump in world space
              normal = normalize(normal + bump * bumpStrength * 0.2);

              // --- Lighting Model ---
              float diff = max(dot(normal, lightDir), 0.0);
              diff = smoothstep(-0.05, 1.0, diff);

              float earthShine = max(dot(normal, -lightDir), 0.0) * 0.02;
              float fresnel = pow(1.0 - max(dot(normal, -rd), 0.0), 4.0);
              
              vec3 finalLight = vec3(diff) + vec3(earthShine);
              
              vec3 moonSurfaceCol = albedo * finalLight;

              // Atmosphere scattering on surface
              moonSurfaceCol += uMoonColor * 0.2 * fresnel * diff * 0.5;

              col += moonSurfaceCol * uMoonColor; // Tint with uniform
          }
          
          return col;
        }

        // --- MAIN SKY GENERATOR ---
        vec3 generateSky(vec3 dir) {
          // 1. Background gradient
          float t = 0.5 * (dir.y + 1.0);
          vec3 col = mix(uSkyBottom, uSkyTop, t);
          
          // 2. Stars
          col += getStarField(dir);
          
          // 3. Volumetric clouds
          if (uCloudDensity > 0.01) {
            vec3 q = dir;
            q.x += fbm(dir * uCloudScale + vec3(0.1, time * 0.02, 0.0));
            float cloudShape = fbm(q * uCloudScale);
            float fade = smoothstep(-0.2, 0.2, dir.y); // Fade at horizon
            vec3 clouds = mix(uCloudColor1, uCloudColor2, cloudShape);
            col += clouds * cloudShape * fade * uCloudDensity;
          }

          // 4. Moon (New 3D implementation)
          if (uMoonVisible > 0.5) {
            col += getMoon(dir);
          }
          
          return col;
        }

        void main() {
          vec3 dir = normalize(vWorldPosition);
          vec3 color = generateSky(dir);
          
          // Atmospheric haze near horizon
          float horizon = 1.0 - abs(dir.y);
          horizon = pow(horizon, 10.0);
          color = mix(color, uSkyBottom, horizon * 0.3);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(geometry, this.material);
    this.skyMesh.renderOrder = -1000; // Render first (background)
    this.scene.add(this.skyMesh);
  }

  /**
   * Update sky animation (call each frame)
   * @param {number} deltaTime - Frame delta
   */
  update(deltaTime) {
    this.time += deltaTime;
    if (this.material) {
      this.material.uniforms.time.value = this.time;
    }
  }

  /**
   * Set moon visibility
   */
  setMoonVisible(visible) {
    if (this.material) {
      this.material.uniforms.uMoonVisible.value = visible ? 1.0 : 0.0;
    }
  }

  /**
   * Set star density (0.0 to 2.0)
   */
  setStarDensity(density) {
    if (this.material) {
      this.material.uniforms.uStarDensity.value = density;
    }
  }

  /**
   * Set cloud density (0.0 to 2.0)
   */
  setCloudDensity(density) {
    if (this.material) {
      this.material.uniforms.uCloudDensity.value = density;
    }
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.skyMesh) {
      this.scene.remove(this.skyMesh);
      this.skyMesh.geometry.dispose();
      this.material.dispose();
      this.skyMesh = null;
    }
  }
}
