import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

/**
 * PhysicsSystem - Rapier WASM physics wrapper
 * Provides a clean API for the game's physics needs
 */
export class PhysicsSystem {
  constructor() {
    this.world = null;
    this.RAPIER = null;
    this.eventQueue = null;

    // Debug visualization
    this.debugMesh = null;
    this.debugEnabled = false;

    // Track bodies for cleanup
    this.bodies = new Map();
    this.colliders = new Map();
  }

  /**
   * Initialize Rapier WASM and create physics world
   * @param {Object} gravity - Gravity vector {x, y, z}
   */
  dispose() {
    if (this.world) {
      console.log("[PhysicsSystem] Disposing Rapier world...");
      try {
        this.world.free();
      } catch (e) {
        /* ignore already freed */
      }
      this.world = null;
    }
    if (this.eventQueue) {
      try {
        this.eventQueue.free();
      } catch (e) {}
      this.eventQueue = null;
    }
  }

  async init(gravity = { x: 0, y: -25.0, z: 0 }) {
    if (this.RAPIER) {
      console.log(
        "[PhysicsSystem] Rapier already initialized, resetting world",
      );
      if (this.world) {
        try {
          this.world.free();
        } catch (e) {}
      }
      this.world = new this.RAPIER.World(gravity);
      this.eventQueue = new this.RAPIER.EventQueue(true);
      return this;
    }

    console.log("[PhysicsSystem] Initializing Rapier WASM...");

    try {
      await RAPIER.init();
      this.RAPIER = RAPIER;
      this.world = new RAPIER.World(gravity);
      this.eventQueue = new RAPIER.EventQueue(true);

      console.log("[PhysicsSystem] Rapier initialized successfully");
      console.log("[PhysicsSystem] World created with gravity:", gravity);

      return this;
    } catch (e) {
      console.error("[PhysicsSystem] Failed to initialize Rapier:", e);
      throw new Error("Failed to load Rapier Physics (WASM)");
    }
  }

  /**
   * Step the physics simulation
   */
  step() {
    if (this.world) {
      this.world.step(this.eventQueue);
    }
  }

  /**
   * Create a static box collider (for walls, floor, etc.)
   * @param {Object} pos - Position {x, y, z}
   * @param {Object} halfExtents - Half-extents {x, y, z} - Rapier native format
   * @param {Object} quat - Optional rotation quaternion {x, y, z, w}
   */
  createStaticBox(pos, halfExtents, quat = { x: 0, y: 0, z: 0, w: 1 }) {
    if (!this.world) return null;

    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(quat);

    const body = this.world.createRigidBody(bodyDesc);

    // Use half-extents directly (callers pass half-extents)
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z,
    );

    const collider = this.world.createCollider(colliderDesc, body);

    return { body, collider };
  }

  /**
   * Create a dynamic capsule body (for ghosts, NPCs)
   * @param {Object} pos - Position {x, y, z}
   * @param {number} radius - Capsule radius
   * @param {number} height - Total height
   * @param {number} mass - Body mass
   */
  createDynamicCapsule(pos, radius, height, mass = 80) {
    if (!this.world) return null;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0.5)
      .setAngularDamping(1.0);

    const body = this.world.createRigidBody(bodyDesc);

    // Lock rotation to prevent tipping
    body.setEnabledRotations(false, false, false, true);

    // Capsule: halfHeight is the distance from center to sphere centers
    const halfHeight = height / 2 - radius;
    const colliderDesc = RAPIER.ColliderDesc.capsule(
      Math.max(0.1, halfHeight),
      radius,
    ).setMass(mass);

    const collider = this.world.createCollider(colliderDesc, body);

    return { body, collider };
  }

  /**
   * Create a kinematic player with CharacterController
   * This is the recommended approach for first/third person controllers
   * @param {Object} pos - Starting position {x, y, z}
   * @param {number} radius - Player capsule radius
   * @param {number} height - Player total height
   * @param {Object} options - Controller options
   */
  createKinematicPlayer(pos, radius, height, options = {}) {
    if (!this.world) return null;

    const {
      maxSlope = (45 * Math.PI) / 180,
      stepHeight = 0.4,
      snapToGround = 0.5,
    } = options;

    // Kinematic position-based body
    const bodyDesc =
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        pos.x,
        pos.y,
        pos.z,
      );

    const body = this.world.createRigidBody(bodyDesc);

    // Capsule collider
    const halfHeight = height / 2 - radius;
    const colliderDesc = RAPIER.ColliderDesc.capsule(
      Math.max(0.1, halfHeight),
      radius,
    );

    const collider = this.world.createCollider(colliderDesc, body);

    // Character Controller - the brain for slope/stair handling
    const characterController = this.world.createCharacterController(0.01);
    characterController.setMaxSlopeClimbAngle(maxSlope);
    characterController.setMinSlopeSlideAngle(maxSlope);
    characterController.enableAutostep(stepHeight, stepHeight, true);
    characterController.setApplyImpulsesToDynamicBodies(true);
    characterController.enableSnapToGround(snapToGround);

    console.log("[PhysicsSystem] Created kinematic player at", pos);

    return { body, collider, characterController };
  }

  /**
   * Perform a raycast
   * @param {Object} origin - Ray origin {x, y, z}
   * @param {THREE.Vector3|Object} direction - Ray direction (normalized)
   * @param {number} maxDistance - Maximum ray distance
   * @param {Object} excludeCollider - Optional collider to exclude
   */
  raycast(origin, direction, maxDistance, excludeCollider = null) {
    if (!this.world) return null;

    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: direction.x, y: direction.y, z: direction.z },
    );

    const hit = this.world.castRay(ray, maxDistance, true);

    if (hit) {
      return {
        collider: hit.collider,
        distance: hit.toi,
        point: {
          x: origin.x + direction.x * hit.toi,
          y: origin.y + direction.y * hit.toi,
          z: origin.z + direction.z * hit.toi,
        },
      };
    }

    return null;
  }

  /**
   * Remove a rigid body from the world
   * @param {RigidBody} body - The body to remove
   */
  removeBody(body) {
    if (this.world && body) {
      try {
        this.world.removeRigidBody(body);
      } catch (e) {
        console.warn("[PhysicsSystem] Error removing body:", e);
      }
    }
  }

  /**
   * Remove a collider from the world
   * @param {Collider} collider - The collider to remove
   */
  removeCollider(collider) {
    if (this.world && collider) {
      try {
        this.world.removeCollider(collider, true);
      } catch (e) {
        console.warn("[PhysicsSystem] Error removing collider:", e);
      }
    }
  }

  /**
   * Setup debug visualization
   * @param {THREE.Scene} scene - Three.js scene
   */
  setupDebug(scene) {
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      vertexColors: true,
      depthTest: false,
      transparent: true,
      opacity: 0.6,
    });

    const geometry = new THREE.BufferGeometry();
    this.debugMesh = new THREE.LineSegments(geometry, material);
    this.debugMesh.renderOrder = 999;
    this.debugMesh.visible = this.debugEnabled;
    this.debugMesh.frustumCulled = false;

    scene.add(this.debugMesh);
    console.log("[PhysicsSystem] Debug renderer initialized");
  }

  /**
   * Toggle debug visualization
   */
  toggleDebug() {
    if (!this.debugMesh) return;
    this.debugEnabled = !this.debugEnabled;
    this.debugMesh.visible = this.debugEnabled;
    console.log("[PhysicsSystem] Debug:", this.debugEnabled ? "ON" : "OFF");
  }

  /**
   * Enable/disable debug visualization
   * @param {boolean} enabled
   * @param {THREE.Scene} scene - Scene to add debug mesh to (if not already added)
   */
  setDebugEnabled(enabled, scene = null) {
    if (!this.debugMesh && scene) {
      this.setupDebug(scene);
    }

    this.debugEnabled = enabled;
    if (this.debugMesh) {
      this.debugMesh.visible = enabled;
    }
  }

  /**
   * Update debug visualization (call each frame)
   */
  /**
   * Update debug visualization (call each frame)
   * Optimized to reduce GC by reusing buffers
   */
  updateDebug() {
    if (!this.debugEnabled || !this.world || !this.debugMesh) return;

    if (window.PERF_ENABLED) {
      // Optimized path: Reuse geometry attributes if size allows
      const buffers = this.world.debugRender();
      const vertices = buffers.vertices;
      const colors = buffers.colors;

      const geometry = this.debugMesh.geometry;

      // Position Attribute
      if (
        !geometry.attributes.position ||
        geometry.attributes.position.count < vertices.length / 3
      ) {
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(vertices, 3),
        );
      } else {
        const posAttr = geometry.attributes.position;
        posAttr.array.set(vertices);
        posAttr.count = vertices.length / 3;
        posAttr.needsUpdate = true;
      }

      // Color Attribute
      if (
        !geometry.attributes.color ||
        geometry.attributes.color.count < colors.length / 4
      ) {
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
      } else {
        const colAttr = geometry.attributes.color;
        colAttr.array.set(colors);
        colAttr.count = colors.length / 4;
        colAttr.needsUpdate = true;
      }

      // Hide unused parts if buffer is larger?
      // drawRange is the proper way for reuse
      geometry.setDrawRange(0, vertices.length / 3);
    } else {
      // Original Path (High Allocation)
      const buffers = this.world.debugRender();
      const vertices = buffers.vertices;
      const colors = buffers.colors;

      this.debugMesh.geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(vertices, 3),
      );
      this.debugMesh.geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(colors, 4),
      );
    }
  }

  /**
   * Cleanup and dispose of physics world
   */
  dispose() {
    if (this.debugMesh) {
      this.debugMesh.geometry.dispose();
      this.debugMesh.material.dispose();
    }

    this.world = null;
    this.RAPIER = null;
    console.log("[PhysicsSystem] Disposed");
  }
}
