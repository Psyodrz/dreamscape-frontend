/**
 * DustParticleSystem - Volumetric Dust Particles (Fixed in World Space)
 *
 * Based on volumetric horror algorithm:
 * - Particles are FIXED in world space, not following player
 * - GPU shader handles smooth floating motion
 * - Sharp, glowing particles with additive blending
 * - Optional volumetric lighting interaction
 */

import * as THREE from "three";

export class DustParticleSystem {
  constructor(scene, options = {}) {
    this.scene = scene;

    // Configuration
    this.config = {
      particleCount: options.particleCount || 15000,
      mapWidth: options.mapWidth || 100, // Entire maze width
      mapHeight: options.mapHeight || 100, // Entire maze depth
      minHeight: options.minHeight || 0.5, // Inside maze
      maxHeight: options.maxHeight || 3.5, // Wall height
      particleSize: options.particleSize || 0.04, // Very small particles
      baseColor: options.baseColor || new THREE.Color(0.9, 0.9, 0.95),
      glowColor: options.glowColor || new THREE.Color(1.0, 1.0, 1.0),
    };

    // State
    this.enabled = true;
    this.particles = null;
    this.playerPosition = new THREE.Vector3();
    this.material = null;

    this._createParticles();
    console.log(
      `[DustParticles] Created ${this.config.particleCount} volumetric particles (fixed in world)`
    );
  }

  _createParticles() {
    const count = this.config.particleCount;
    const mapW = this.config.mapWidth;
    const mapH = this.config.mapHeight;
    const minH = this.config.minHeight;
    const maxH = this.config.maxHeight;

    // Create geometry with custom attributes
    const geometry = new THREE.BufferGeometry();

    // Position buffer - scattered across entire map
    const positions = new Float32Array(count * 3);
    // Random seed for each particle (vec3 for turbulence)
    const randoms = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Random position across entire map (rectangular distribution)
      positions[i3] = Math.random() * mapW; // 0 to mapWidth
      positions[i3 + 1] = minH + Math.random() * (maxH - minH); // Inside maze height
      positions[i3 + 2] = Math.random() * mapH; // 0 to mapHeight

      // Random seeds for turbulence
      randoms[i3] = Math.random();
      randoms[i3 + 1] = Math.random();
      randoms[i3 + 2] = Math.random();
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 3));

    // Custom shader material - sharp glowing particles
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color: { value: this.config.baseColor },
        glowColor: { value: this.config.glowColor },
        particleSize: { value: this.config.particleSize },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        uniform float time;
        uniform float particleSize;
        attribute vec3 aRandom;
        varying float vAlpha;
        
        void main() {
          vec3 pos = position;
          
          // Smooth floating motion using sine/cosine waves
          float t = time * 0.2;
          pos.x += sin(t + aRandom.y * 10.0) * 0.15;
          pos.y += cos(t * 0.8 + aRandom.x * 10.0) * 0.1;
          pos.z += sin(t * 0.5 + aRandom.z * 10.0) * 0.15;
          
          // Base intensity
          float intensity = 0.5;
          
          // Slight fade near floor
          intensity *= smoothstep(0.0, 0.8, pos.y);
          
          vAlpha = intensity;
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          
          // Small particle size (0.08)
          gl_PointSize = particleSize * (300.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 6.0);
          
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform vec3 glowColor;
        varying float vAlpha;
        
        void main() {
          // Sharp circular particle with glow
          vec2 uv = gl_PointCoord - vec2(0.5);
          float dist = length(uv);
          
          // Discard outside circle
          if (dist > 0.5) discard;
          
          // Sharp edge with glow falloff
          float alpha = (1.0 - smoothstep(0.1, 0.5, dist)) * vAlpha;
          
          // Core is brighter (glow effect)
          float core = 1.0 - smoothstep(0.0, 0.3, dist);
          vec3 finalColor = mix(color, glowColor, core * 0.6);
          
          // Boost alpha for visibility
          alpha = alpha * 2.0;
          
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
    });

    // Create points mesh - NO frustumCulled since it's world-fixed
    this.particles = new THREE.Points(geometry, this.material);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  /**
   * Update particle system
   * @param {number} deltaTime - Frame delta
   */
  update(deltaTime) {
    if (!this.enabled || !this.particles) return;

    // Update time uniform for shader animation
    this.material.uniforms.time.value += deltaTime;
  }

  /**
   * Toggle particle visibility
   */
  toggle() {
    this.enabled = !this.enabled;
    if (this.particles) {
      this.particles.visible = this.enabled;
    }
    console.log(`[DustParticles] ${this.enabled ? "ENABLED" : "DISABLED"}`);
    return this.enabled;
  }

  /**
   * Set base color
   */
  setColor(color) {
    if (this.material) {
      this.material.uniforms.color.value = new THREE.Color(color);
    }
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      this.material.dispose();
      this.particles = null;
    }
  }
}
