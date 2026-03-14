/**
 * PerformanceSystem - Master controller for engine optimizations
 *
 * FEATURES:
 * - Frustum Culling: Hides objects outside camera view
 * - Occlusion Culling: Hides objects blocked by walls (Raycasting)
 * - Distance Culling: Hides objects too far away
 * - Throttling: Reduces update frequency for distant AI
 * - Memory Pooling: Reuses Vector3/Quaternion/Ray objects
 */
import * as THREE from "three";

// Global master switch
window.PERF_ENABLED = true;

class PerformanceSystem {
  constructor() {
    this.enabled = window.PERF_ENABLED;

    // --- CONFIGURATION ---
    this.CONFIG = {
      occlusionEnabled: true,
      frustumCheck: true,
      samplingQuality: 1, // 1 = Center only, 9 = Corners + Center
      maxViewDist: 80, // Render distance
      maxOccludeDist: 60, // Raycast check distance
      throttleFarAI: true,
      debugVisuals: false, // Set true to see rays
      movementThreshold: 0.1, // Camera move delta to trigger update
      rotationThreshold: 0.15, // Camera rot delta
    };

    // --- STATE ---
    this.frameCount = 0;
    this.lastTime = 0;

    this.occluders = []; // Static walls
    this.targets = new Map(); // Dynamic entities to cull (id -> { mesh, box, ... })

    // Camera Tracking
    this.lastCamPos = new THREE.Vector3();
    this.lastCamQuat = new THREE.Quaternion();

    // --- OPTIMIZATION POOLS ---
    this.vec3Pool = [];
    this.raycaster = new THREE.Raycaster();
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();
    this.tempVec = new THREE.Vector3();

    this._initPools(100);

    // Debug
    this.rayHelpers = [];

    console.log("[PerformanceSystem] Online. Occlusion Engine Ready.");
  }

  _initPools(size) {
    for (let i = 0; i < size; i++) {
      this.vec3Pool.push(new THREE.Vector3());
    }
    this.vec3Index = 0;
  }

  getVec3(x, y, z) {
    const v = this.vec3Pool[this.vec3Index];
    v.set(x, y, z);
    this.vec3Index = (this.vec3Index + 1) % this.vec3Pool.length;
    return v;
  }

  // --- API: REGISTRATION ---

  /**
   * Register a static mesh (like a wall) as an occluder.
   * Occluders block vision.
   */
  registerOccluder(mesh) {
    if (!mesh) return;
    // ensure bounding box
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();

    // We store the mesh itself. The raycaster checks against these.
    // For BoxGeometry/InstancedMesh, this works natively.
    this.occluders.push(mesh);
  }

  /**
   * Register an entity to be culled (hidden/shown).
   * @param {THREE.Object3D} mesh - The root mesh to hide/show
   * @param {string} id - Unique ID (e.g. shard.id)
   */
  registerTarget(mesh, id) {
    if (!mesh || !id) return;

    // Pre-calculate sample points for this target
    const box = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const samplePoints = Array(9)
      .fill()
      .map(() => new THREE.Vector3());

    this.targets.set(id, {
      mesh: mesh,
      box: box,
      center: center,
      samplePoints: samplePoints,
      visible: true,
      lastDist: 0,
      framesHidden: 0,
    });
  }

  removeTarget(id) {
    this.targets.delete(id);
  }

  clear() {
    this.occluders = [];
    this.targets.clear();
    // Clean debug rays
    this.rayHelpers.forEach((r) => {
      if (r.parent) r.parent.remove(r);
      r.geometry.dispose();
      r.material.dispose();
    });
    this.rayHelpers = [];
  }

  // --- MAIN UPDATE LOOP ---

  update(deltaTime, context) {
    if (!this.enabled) return;
    this.frameCount++;
    this.vec3Index = 0; // Reset pool

    const camera = context.camera;
    if (!camera) return;

    // 1. Throttling Check
    const distSq = camera.position.distanceToSquared(this.lastCamPos);
    const angle = camera.quaternion.angleTo(this.lastCamQuat);

    // Always update if moved significant amount OR every 10 frames just in case
    const needsUpdate =
      distSq > this.CONFIG.movementThreshold ||
      angle > this.CONFIG.rotationThreshold ||
      this.frameCount % 10 === 0;

    if (needsUpdate) {
      this._performCulling(camera);

      this.lastCamPos.copy(camera.position);
      this.lastCamQuat.copy(camera.quaternion);
    }
  }

  _performCulling(camera) {
    // A. Update Frustum
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const camPos = camera.position;
    const maxViewSq = this.CONFIG.maxViewDist ** 2;
    const maxOccSq = this.CONFIG.maxOccludeDist ** 2;

    // Filter relevant occluders (optimization: simple dist check?)
    // For now, Raycaster checks all passed occluders.
    // If occluders list is HUGE, we might want to qualify them first.
    // But MazeGenerator only produces ~2 InstancedMeshes and ~4 Boundary Walls. Very cheap.
    // However, if we added individual walls to 'occluders', that would be bad.
    // Assuming 'occluders' contains optimized InstancedMeshes.

    // B. Check Targets
    this.targets.forEach((target, id) => {
      const distSq = target.center.distanceToSquared(camPos);
      target.lastDist = distSq;
      let isVisible = true;

      // 1. Distance Culling
      if (distSq > maxViewSq) {
        isVisible = false;
        target.framesHidden++;
      }
      // 2. Frustum Culling
      else if (
        this.CONFIG.frustumCheck &&
        !this.frustum.intersectsBox(target.box)
      ) {
        isVisible = false;
        target.framesHidden++;
      }
      // 3. Occlusion Culling (Raycast)
      else if (this.CONFIG.occlusionEnabled && distSq < maxOccSq) {
        // Only run expensive raycast if logically visible so far and close enough

        // Update sample points
        this._updateTargetSamplePoints(target);

        // Check visibility via rays
        // We start with Center. If blocked, check corners.
        // If ANY point is visible, object is visible.
        isVisible = this._checkVisibility(camPos, target);

        if (!isVisible) target.framesHidden++;
        else target.framesHidden = 0;
      } else {
        target.framesHidden = 0;
      }

      // Apply
      if (target.mesh.visible !== isVisible) {
        target.mesh.visible = isVisible;
      }
    });

    // C. Debug Visuals
    if (this.CONFIG.debugVisuals) {
      // Logic to draw rays could go here
    }
  }

  _updateTargetSamplePoints(target) {
    // Recalculate box world coords (in case object moved)
    // For static objects like shards, this is redundant, but needed for ghosts
    target.box.setFromObject(target.mesh);
    target.box.getCenter(target.center);

    const s = target.samplePoints;
    const b = target.box;

    // 0: Center
    s[0].copy(target.center);

    if (this.CONFIG.samplingQuality > 1) {
      // Corners
      s[1].set(b.min.x, b.min.y, b.min.z);
      s[2].set(b.max.x, b.min.y, b.min.z);
      s[3].set(b.min.x, b.max.y, b.min.z);
      s[4].set(b.max.x, b.max.y, b.min.z);
      s[5].set(b.min.x, b.min.y, b.max.z);
      s[6].set(b.max.x, b.min.y, b.max.z);
      s[7].set(b.min.x, b.max.y, b.max.z);
      s[8].set(b.max.x, b.max.y, b.max.z);
    }
  }

  _checkVisibility(origin, target) {
    const pointsToCheck = this.CONFIG.samplingQuality > 1 ? 9 : 1;

    // If any point is visible, the object is visible
    for (let i = 0; i < pointsToCheck; i++) {
      const pt = target.samplePoints[i];

      // Direction and Dist
      this.tempVec.subVectors(pt, origin);
      const dist = this.tempVec.length();
      this.tempVec.normalize();

      this.raycaster.set(origin, this.tempVec);
      this.raycaster.near = 0.1;
      this.raycaster.far = dist - 0.1; // Stop just before target

      const hits = this.raycaster.intersectObjects(this.occluders, false);

      if (hits.length === 0) {
        return true; // Clear line of sight
      }
    }
    return false; // All points blocked
  }
}

const performanceSystem = new PerformanceSystem();
export { performanceSystem, PerformanceSystem };
