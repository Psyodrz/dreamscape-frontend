import * as THREE from "three";

export class Shard {
  constructor(scene, position) {
    this.scene = scene;
    this.position = position;
    this.mesh = null;
    this.ring = null;
    this.light = null;
    this.time = Math.random() * 100; // Random offset for animation
    this.isCollected = false;

    this._initMesh();
  }

  _initMesh() {
    this.group = new THREE.Group();
    this.group.position.set(this.position.x, this.position.y, this.position.z);

    // --- PROCEDURAL TEXTURES ---
    // Use cached maps if available and optimization is enabled
    let maps;
    if (window.PERF_ENABLED && Shard.cachedMaps) {
      maps = Shard.cachedMaps;
    } else {
      maps = this._createTextureMaps();
      if (window.PERF_ENABLED && !Shard.cachedMaps) {
        Shard.cachedMaps = maps;
      }
    }

    // 1. HERO SHARD GEOMETRY (Organic Icosahedron - OLD SHAPE PRESERVED)
    // We use radius 0.4 to match the game's world scale
    const geometry = new THREE.IcosahedronGeometry(0.4, 4);
    const pos = geometry.attributes.position;
    const v = new THREE.Vector3();

    // Seeded random for consistent organic shape per shard instance
    let seed = this.position.x + this.position.z + this.time;
    const random = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);

      // Asymmetry (OLD SHAPE LOGIC)
      if (v.x > 0.4 * 0.4) v.x = 0.16 + (v.x - 0.16) * 0.2;
      if (v.y > 0 && v.x < 0) v.y *= 1.3;

      // Organic Lumps (OLD SHAPE LOGIC)
      const freq = 6.0;
      const amp = 0.05;
      const noise =
        Math.sin(v.x * freq) * Math.cos(v.y * freq) * Math.sin(v.z * freq);
      v.addScalar(noise * amp);

      // Jitter
      v.x += (random() - 0.5) * 0.01;
      v.y += (random() - 0.5) * 0.01;
      v.z += (random() - 0.5) * 0.01;

      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    // UV2 is required for some AO/lightmap features in PhysicalMaterial
    geometry.attributes.uv2 = geometry.attributes.uv;

    // 2. MATERIAL: PERFECT DEEP FISSURE GLASS (Matches user logic exactly)
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      emissive: 0x002266,
      emissiveMap: maps.emission,
      roughness: 0.7,
      roughnessMap: maps.roughness,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      displacementMap: maps.height,
      displacementScale: 0.1,
      displacementBias: -0.05,

      metalness: 0.1,
      transmission: 0.75,
      thickness: 3.0,
      ior: 1.18,
      attenuationColor: new THREE.Color(0x0066cc),
      attenuationDistance: 0.7,

      envMapIntensity: 1.0,
      clearcoat: 0.1,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // 3. INTERNAL CORE: FRAGMENTED FRAGMENTS (14 pieces)
    this.coreGroup = new THREE.Group();
    this.group.add(this.coreGroup);

    this.fragments = [];
    const fragmentCount = 14;

    const coreFragMat = new THREE.MeshBasicMaterial({
      color: 0x66ccff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const coreHotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (let i = 0; i < fragmentCount; i++) {
      // Radius scaled for 0.4 parent (original was 0.04-0.12 for 1.0 parent)
      const radius = 0.015 + Math.random() * 0.045;
      const type = Math.random() > 0.5;
      const geo = type
        ? new THREE.TetrahedronGeometry(radius, 0)
        : new THREE.OctahedronGeometry(radius, 0);

      const fPos = geo.attributes.position;
      const fV = new THREE.Vector3();
      for (let k = 0; k < fPos.count; k++) {
        fV.fromBufferAttribute(fPos, k);
        fV.x *= 0.6 + Math.random();
        fV.y *= 1.2 + Math.random() * 1.5;
        fV.z *= 0.6 + Math.random();
        fPos.setXYZ(k, fV.x, fV.y, fV.z);
      }
      geo.computeVertexNormals();

      const mat = Math.random() > 0.35 ? coreFragMat : coreHotMat;
      const mesh = new THREE.Mesh(geo, mat);

      // Position spread scaled (original was 0.25 / 2.0 / 0.25)
      mesh.position.set(
        (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.1,
      );

      mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );

      mesh.userData = {
        rotSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4,
        ),
        floatSpeed: 0.5 + Math.random() * 0.8,
        floatOffset: Math.random() * Math.PI * 2,
        initialY: mesh.position.y,
      };

      this.coreGroup.add(mesh);
      this.fragments.push(mesh);
    }

    // 4. POINT LIGHT (RE-ENABLED for proper core glow through frosted glass)
    this.light = new THREE.PointLight(0x0088ff, 0, 3);
    this.light.decay = 2;
    this.group.add(this.light);

    // 5. PARTICLES (100 count, spread scaled)
    const pGeo = new THREE.BufferGeometry();
    const pCount = 100;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 4.0;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 4.0;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 4.0;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 0.015,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(pGeo, pMat);
    this.group.add(this.particles);

    this.scene.add(this.group);

    // 6. GLOW SPRITE (Fake Bloom)
    const glowMap = this._createGlowTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: glowMap,
      color: 0x0088ff, // Match light color
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.6,
    });
    this.glowSprite = new THREE.Sprite(glowMat);
    this.glowSprite.scale.set(1.5, 1.5, 1.5); // Initial scale
    this.group.add(this.glowSprite);
  }

  _createGlowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.2)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  _createTextureMaps() {
    const size = 1024;

    const rCanvas = document.createElement("canvas"); // Roughness
    rCanvas.width = size;
    rCanvas.height = size;
    const rCtx = rCanvas.getContext("2d");

    const eCanvas = document.createElement("canvas"); // Emission
    eCanvas.width = size;
    eCanvas.height = size;
    const eCtx = eCanvas.getContext("2d");

    const hCanvas = document.createElement("canvas"); // Height
    hCanvas.width = size;
    hCanvas.height = size;
    const hCtx = hCanvas.getContext("2d");

    const nCanvas = document.createElement("canvas"); // Normal
    nCanvas.width = size;
    nCanvas.height = size;
    const nCtx = nCanvas.getContext("2d");

    // 1. BASE LAYERS
    rCtx.fillStyle = "#2a2a2a";
    rCtx.fillRect(0, 0, size, size);

    hCtx.fillStyle = "#808080";
    hCtx.fillRect(0, 0, size, size);

    eCtx.fillStyle = "#000000";
    eCtx.fillRect(0, 0, size, size);

    nCtx.fillStyle = "rgb(128, 128, 255)";
    nCtx.fillRect(0, 0, size, size);

    // 2. LAYERED NOISE: Low-Frequency "Cloud" Imperfections (60 count)
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const radius = 50 + Math.random() * 200;

      const grad = rCtx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, `rgba(255, 255, 255, ${Math.random() * 0.15})`);
      grad.addColorStop(1, "rgba(255, 255, 255, 0)");
      rCtx.fillStyle = grad;
      rCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    // 3. PHYSICAL SCRATCHES (800 count)
    const drawScratch = (ctx, isNormal) => {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const len = 10 + Math.random() * 80;
      const angle = Math.random() * Math.PI * 2;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);

      if (isNormal) {
        const col = Math.random() > 0.5 ? 150 : 100;
        ctx.strokeStyle = `rgba(${col}, ${col}, 255, 0.4)`;
      } else {
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + Math.random() * 0.3})`;
      }
      ctx.lineWidth = 0.5 + Math.random() * 0.5;
      ctx.stroke();
    };

    for (let i = 0; i < 800; i++) {
      drawScratch(rCtx, false);
      drawScratch(nCtx, true);
    }

    // 4. VERTICAL STRIATIONS (Geological Stress - 15,000 count)
    for (let i = 0; i < 15000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const h = 5 + Math.random() * 30;

      const bias = (Math.random() - 0.5) * 30;
      nCtx.fillStyle = `rgb(${128 + bias}, 128, 255)`;
      nCtx.fillRect(x, y, 1, h);

      rCtx.fillStyle = "rgba(255,255,255,0.05)";
      rCtx.fillRect(x, y, 1, h);
    }

    // 5. DEEP FRACTURES (Center-biased as per HTML)
    const numCracks = 15;
    function drawJaggedPath(ctx, startX, startY, width, color, blur) {
      let x = startX;
      let y = startY;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = Math.floor(Math.random() * 8) + 5;
      for (let j = 0; j < steps; j++) {
        x += (Math.random() - 0.5) * 180;
        y += (Math.random() - 0.5) * 180;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (blur > 0) {
        ctx.shadowBlur = blur;
        ctx.shadowColor = color;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
    }

    for (let i = 0; i < numCracks; i++) {
      let sx, sy;
      if (Math.random() > 0.5) {
        sx = size / 2 + (Math.random() - 0.5) * 100;
        sy = Math.random() * size;
      } else {
        sy = size / 2 + (Math.random() - 0.5) * 100;
        sx = Math.random() * size;
      }

      drawJaggedPath(hCtx, sx, sy, 10, "#000000", 5);
    }

    return {
      roughness: new THREE.CanvasTexture(rCanvas),
      emission: new THREE.CanvasTexture(eCanvas),
      height: new THREE.CanvasTexture(hCanvas),
      normal: new THREE.CanvasTexture(nCanvas),
    };
  }

  update(deltaTime) {
    if (this.isCollected || !this.group) return;

    this.time += deltaTime;

    // Bobbing & Group Movement (Matched to user's heavier float)
    const bobHeight = Math.sin(this.time * 0.3) * 0.15;
    this.group.position.y = this.position.y + bobHeight;
    this.group.rotation.y += deltaTime * 0.04;
    this.group.rotation.z = Math.sin(this.time * 0.2) * 0.05;

    // ANIMATE CORE FRAGMENTS
    const pulse = Math.sin(this.time * 1.2) * 0.5 + 0.5;
    const flicker =
      Math.sin(this.time * 17.3 + Math.sin(this.time * 3.1)) * 0.04;

    if (this.fragments) {
      this.fragments.forEach((frag) => {
        const u = frag.userData;
        frag.rotation.x += u.rotSpeed.x * 0.02;
        frag.rotation.y += u.rotSpeed.y * 0.02;
        frag.rotation.z += u.rotSpeed.z * 0.02;

        frag.position.y =
          u.initialY +
          Math.sin(this.time * u.floatSpeed + u.floatOffset) * 0.08;

        const fragPulse = 1.0 + pulse * 0.1 + flicker * 3.0;
        frag.scale.setScalar(fragPulse);
      });
    }

    // Material & Light Pulsing
    if (this.material) {
      this.material.emissiveIntensity = 1.2 + pulse * 2.0 + flicker;
    }
    if (this.light) {
      this.light.intensity = 1.0 + pulse * 3.0 + flicker * 3.0;
    }

    // Glow Sprite Animation
    if (this.glowSprite) {
      this.glowSprite.material.opacity = 0.4 + pulse * 0.3 + flicker * 0.5;
      const s = 1.5 + pulse * 0.5 + flicker;
      this.glowSprite.scale.set(s, s, s);
    }

    // Particle Rotation
    if (this.particles) {
      this.particles.rotation.y = this.time * 0.01;
    }
  }

  dispose() {
    if (this.group) {
      this.scene.remove(this.group);

      if (this.mesh) {
        this.mesh.geometry.dispose();

        // Only dispose material if it's not sharing cached textures
        // OR if the textures themselves are unique per shard (which they aren't anymore).
        // However, Three.js materials are unique instances per mesh here.
        // We should check if maps are cached before disposing them.

        if (!Shard.cachedMaps || !window.PERF_ENABLED) {
          if (this.mesh.material.emissiveMap)
            this.mesh.material.emissiveMap.dispose();
          if (this.mesh.material.roughnessMap)
            this.mesh.material.roughnessMap.dispose();
          if (this.mesh.material.normalMap)
            this.mesh.material.normalMap.dispose();
          if (this.mesh.material.displacementMap)
            this.mesh.material.displacementMap.dispose();
        }

        this.mesh.material.dispose();
      }

      if (this.fragments) {
        this.fragments.forEach((frag) => {
          frag.geometry.dispose();
          frag.material.dispose();
        });
      }

      if (this.light) {
        this.light.dispose();
      }

      if (this.particles) {
        this.particles.geometry.dispose();
        this.particles.material.dispose();
      }

      if (this.glowSprite) {
        this.glowSprite.material.map.dispose();
        this.glowSprite.material.dispose();
      }

      this.group = null;
    }
  }
}

// Static Cache
Shard.cachedMaps = null;
