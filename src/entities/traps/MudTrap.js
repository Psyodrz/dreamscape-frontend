import * as THREE from "three";
import { BaseTrap } from "./BaseTrap.js";

/**
 * Mud Trap - Slows the player down
 */
export class MudTrap extends BaseTrap {
  constructor(scene, physicsSystem, player, position) {
    super(scene, physicsSystem, player, position);
    this.uniforms = null;
    this.triggerRadius = 1.5; // Match the circle geometry radius
    this.maxTriggerHeight = 0.6; // Player must be within 0.6m of trap to trigger
    this._createMesh();
  }

  // Override parent's _checkTrigger to add height check
  _checkTrigger() {
    if (!this.player.mesh) return;

    const playerPos = this.player.mesh.position;

    // Check horizontal distance (2D)
    const distSq =
      (playerPos.x - this.position.x) ** 2 +
      (playerPos.z - this.position.z) ** 2;

    // Player must be grounded (feet on floor) to be affected by mud
    // If grounded property isn't available, check if player is near ground level
    const isGrounded =
      this.player.grounded !== undefined
        ? this.player.grounded
        : playerPos.y < this.position.y + 1.5; // Fallback: within 1.5m of trap

    // Only trigger if within horizontal radius AND on ground
    if (distSq < this.triggerRadius * this.triggerRadius && isGrounded) {
      this.onTrigger(this.player);
    }
  }

  _createMesh() {
    const geometry = new THREE.CircleGeometry(1.5, 32); // Increased segments for displacement
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, // Driven by shader
      roughness: 1.0,
      metalness: 0.1,
      side: THREE.DoubleSide, // Render both sides to prevent backface culling artifacts
      transparent: true,
      depthWrite: true, // Ensure proper depth buffer writes
    });

    // Procedural Shader Injection
    material.onBeforeCompile = (shader) => {
      // Configuration matching scene theme
      const CONFIG = {
        mudScale: 2.5,
        mudDetail: 4.0,
        waterLevel: 0.5,
        edgeSoftness: 0.15,
        dryColor: new THREE.Color(0x4a3b32), // Desaturated dark brown
        wetColor: new THREE.Color(0x1a120b), // Nearly black wet mud
        bumpStrength: 1.2,
        roughnessDry: 0.9,
        roughnessWet: 0.05,
      };

      this.uniforms = {
        uTime: { value: 0 },
        uScale: { value: CONFIG.mudScale },
        uDetail: { value: CONFIG.mudDetail },
        uWaterLevel: { value: CONFIG.waterLevel },
        uEdgeSoftness: { value: CONFIG.edgeSoftness },
        uColorDry: { value: CONFIG.dryColor },
        uColorWet: { value: CONFIG.wetColor },
        uBumpStrength: { value: CONFIG.bumpStrength },
        uRoughnessDry: { value: CONFIG.roughnessDry },
        uRoughnessWet: { value: CONFIG.roughnessWet },
        // Fade out edges of the trap circle
        uOpacity: { value: 0.9 },
      };

      shader.uniforms = { ...shader.uniforms, ...this.uniforms };

      // 1. Inject Noise Functions and pass UVs
      shader.vertexShader = `
          varying vec3 vPos;
          varying vec2 vUv;
          ${shader.vertexShader}
      `.replace(
        "#include <begin_vertex>",
        `
          #include <begin_vertex>
          vPos = position;
          vUv = uv; // Pass UV for radial mask (interpolates correctly on triangulated geometry)
        `,
      );

      shader.fragmentShader = `
          uniform float uTime;
          uniform float uScale;
          uniform float uWaterLevel;
          uniform float uEdgeSoftness;
          uniform vec3 uColorDry;
          uniform vec3 uColorWet;
          uniform float uBumpStrength;
          uniform float uRoughnessDry;
          uniform float uRoughnessWet;
          uniform float uOpacity;
          varying vec3 vPos;
          varying vec2 vUv;

          // Simplex 3D Noise 
          vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
          vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
          float snoise(vec3 v){ 
              const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
              const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
              vec3 i  = floor(v + dot(v, C.yyy) );
              vec3 x0 = v - i + dot(i, C.xxx) ;
              vec3 g = step(x0.yzx, x0.xyz);
              vec3 l = 1.0 - g;
              vec3 i1 = min( g.xyz, l.zxy );
              vec3 i2 = max( g.xyz, l.zxy );
              vec3 x1 = x0 - i1 + 1.0 * C.xxx;
              vec3 x2 = x0 - i2 + 2.0 * C.xxx;
              vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
              i = mod(i, 289.0 ); 
              vec4 p = permute( permute( permute( 
                          i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                      + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                      + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
              float n_ = 1.0/7.0; 
              vec3  ns = n_ * D.wyz - D.xzx;
              vec4 j = p - 49.0 * floor(p * ns.z *ns.z); 
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
              p0 *= norm.x;
              p1 *= norm.y;
              p2 *= norm.z;
              p3 *= norm.w;
              vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
              m = m * m;
              return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
          }

          float fbm(vec3 x, int octaves) {
              float v = 0.0;
              float a = 0.5;
              vec3 shift = vec3(100.0);
              for (int i = 0; i < 5; ++i) { 
                  if(i >= octaves) break;
                  v += a * snoise(x);
                  x = x * 2.0 + shift;
                  a *= 0.5;
              }
              return v;
          }
          
          ${shader.fragmentShader}
      `;

      // 2. Inject Logic into Color Map
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `
          // --- PROCEDURAL MUD LOGIC ---
          // Use UVs for radial mask - UVs interpolate radially on CircleGeometry
          vec2 centeredUV = vUv - 0.5;
          
          // Create uneven, organic edges using noise distortion
          // We use the angle to sample noise for consistent edge wobbling
          float angle = atan(centeredUV.y, centeredUV.x);
          vec3 noisePos = vec3(vUv.x * 2.0, 0.0, vUv.y * 2.0) * uScale;
          float distortion = snoise(noisePos + vec3(0.0, 0.0, uTime * 0.1)) * 0.15;
          
          float distFromCenter = length(centeredUV) * 2.0 + distortion; // 0 at center, ~1 at edge
          
          // Only fade alpha at the outer edge, which is now wobbly
          float alphaFade = 1.0 - smoothstep(0.7, 1.0, distFromCenter);
          
          float n = fbm(noisePos, 5);
          float height = n * 0.5 + 0.5; 

          float wetFactor = smoothstep(uWaterLevel - uEdgeSoftness, uWaterLevel + uEdgeSoftness, height);
          vec3 mudColor = mix(uColorWet, uColorDry, wetFactor);
          
          float grain = snoise(noisePos * 10.0) * 0.05;
          if(wetFactor > 0.5) mudColor += vec3(grain);

          // ASSIGN color directly instead of multiply to prevent dark artifacts
          diffuseColor.rgb = mudColor;
          // Apply alpha fade only at edges, full opacity in center
          diffuseColor.a = alphaFade * uOpacity;
        `,
      );

      // 3. Inject Logic into Roughness
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `
          float roughnessFactor = roughness;
          float proceduralRoughness = mix(uRoughnessWet, uRoughnessDry, wetFactor);
          roughnessFactor = proceduralRoughness;
        `,
      );

      // 4. Inject Logic into Normal/Bump
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        `
          #include <normal_fragment_begin>
          float epsilon = 0.001;
          vec3 dPos = vPos * uScale;
          float hCenter = fbm(dPos, 5);
          float hX = fbm(dPos + vec3(epsilon, 0.0, 0.0), 5);
          float hY = fbm(dPos + vec3(0.0, epsilon, 0.0), 5);
          float hZ = fbm(dPos + vec3(0.0, 0.0, epsilon), 5);
          vec3 grad = vec3(hX - hCenter, hY - hCenter, hZ - hCenter) / epsilon;
          float bumpMod = mix(0.1, 1.0, wetFactor); 
          vec3 bumpNormal = normalize(normal + grad * uBumpStrength * bumpMod * -1.0);
          normal = bumpNormal; 
        `,
      );
    };

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(this.position);
    this.mesh.position.y += 0.05; // Higher offset to prevent Z-fighting with floor
    this.mesh.renderOrder = 1; // Render after floor
    this.scene.add(this.mesh);
  }

  update(deltaTime, currentTime) {
    super.update(deltaTime, currentTime);
    // Animate mud (subtle movement)
    if (this.uniforms) {
      this.uniforms.uTime.value += deltaTime * 0.2;
    }
  }

  onTrigger(player) {
    // Apply heavy slow effect - very sticky mud
    // Only apply if not already slowed (prevents resetting timer)
    if (player.applySlow && (!player.slowTimer || player.slowTimer <= 0)) {
      player.applySlow(0.2, 2.0); // Reduce speed to 20% for 2 seconds

      // Show mud trap dialogue only when first entering
      if (window.dialogueManager?.show) {
        window.dialogueManager.show("mudTrap");
      }
    }

    // Lower player slightly (sinking into mud)
    if (player.mesh && !this._sinkApplied) {
      this._sinkApplied = true;
      player.mesh.position.y -= 0.15;

      // Restore after delay
      setTimeout(() => {
        if (player.mesh) {
          player.mesh.position.y += 0.15;
        }
        this._sinkApplied = false;
      }, 2000);
    }
  }
}
