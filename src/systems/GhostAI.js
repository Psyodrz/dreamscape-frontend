/**
 * GhostAI - Simple AI Controller based on Working Reference
 *
 * Features:
 * - Simple state machine (PATROL, SUSPICIOUS, CHASE, SEARCH, AMBUSH)
 * - Direct steering toward target
 * - 3-ray wall avoidance (angles: 0, ±30°) with 3x force multiplier
 * - Grid-based vision with FOV check
 * - Hearing system for player footsteps
 */

// AI States
const AIState = {
  PATROL: "patrol",
  SUSPICIOUS: "suspicious",
  CHASE: "chase",
  SEARCH: "search",
  AMBUSH: "ambush",
};

export class GhostAI {
  constructor(mazeData, config = {}) {
    // Maze reference
    this.maze = mazeData.maze;
    this.mazeWidth = mazeData.width;
    this.mazeHeight = mazeData.height;
    this.cellSize = mazeData.cellSize || 4;

    // Configuration (matching reference CONFIG.AI)
    this.config = {
      fov: config.fov || 80, // degrees
      viewDist: config.viewDist || 35,
      walkSpeed: config.walkSpeed || 3.5,
      runSpeed: config.runSpeed || 7.2,
      // Base speeds for escalation system (preserve original values)
      baseWalkSpeed: config.walkSpeed || 3.5,
      baseRunSpeed: config.runSpeed || 7.2,
      hearingThreshold: config.hearingThreshold || 18.0,
      patrolWait: config.patrolWait || 2000, // ms
      searchTime: config.searchTime || 8000, // ms
      ...config,
    };

    // State
    this.state = AIState.PATROL;
    this.stateTimer = 0;

    // Position & facing (set by entity)
    this.position = { x: 0, z: 0 };
    this.facingAngle = 0; // radians

    // Target tracking
    this.target = null;
    this.targetPos = null;
    this.lastKnownPlayerPos = null;
    this.canSeeTarget = false;

    // Patrol waypoints (floor cells from maze)
    this.floorCells = [];
    this._collectFloorCells();

    // Output movement
    this.outputMovement = { x: 0, z: 0, speed: 0, animation: "idle" };

    // Physics system for raycasting (optional)
    this.physicsSystem = null;

    // HEAD SCANNING SYSTEM - 180° sweep when idle
    this.headScanAngle = 0; // Current scan offset from facing (-90° to +90°)
    this.headScanDirection = 1; // 1 = sweeping right, -1 = sweeping left
    this.headScanSpeed = 1.5; // radians per second (~90° per second)
    this.isScanning = false; // True when actively scanning

    // PLAYER LOCK SYSTEM - persistent chase once spotted
    this.playerLocked = false; // True when player is locked for chase
    this.lockLostTimer = 0; // Timer tracking how long since we lost sight while locked
    this.lockLostTimeout = 5000; // ms - time before lock breaks if can't see player
    this.lockBreakDistance = 50; // Distance at which lock breaks regardless
    this.lockAcquireDistance = 35; // Distance at which lock can be acquired

    // Debug
    this.debugInfo = {
      state: AIState.PATROL,
      distance: 0,
      lastNoise: "None",
      scanning: false,
      playerLocked: false,
    };
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  setTarget(target) {
    this.target = target;
  }

  setPosition(x, z) {
    this.position.x = x;
    this.position.z = z;
  }

  setFacing(angleRadians) {
    this.facingAngle = angleRadians;
  }

  setPhysicsSystem(physicsSystem) {
    this.physicsSystem = physicsSystem;
  }

  /**
   * Update AI logic - call every frame
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    if (!this.target) return;

    // Convert deltaTime to milliseconds for timers
    const dtMs = deltaTime * 1000;

    // Check normal forward vision first
    this.canSeeTarget = this._checkVision();

    // HEAD SCANNING: When idle, patrol, search, or ambush - sweep 180° to find player
    const shouldScan =
      this.state === AIState.PATROL ||
      this.state === AIState.SEARCH ||
      this.state === AIState.AMBUSH ||
      this.state === AIState.SUSPICIOUS;

    if (shouldScan && !this.canSeeTarget) {
      this.isScanning = true;
      const scannedPlayer = this._performHeadScan(deltaTime);
      if (scannedPlayer) {
        this.canSeeTarget = true;
      }
    } else {
      this.isScanning = false;
      this.headScanAngle = 0; // Reset scan when chasing
    }

    // If we see player (either forward or scanned), immediately chase
    if (this.canSeeTarget) {
      const targetPos = this._getTargetPosition();
      const distToTarget = this._distanceToTarget(targetPos);

      // PLAYER LOCK SYSTEM: Acquire lock when player is spotted within range
      if (!this.playerLocked && distToTarget <= this.lockAcquireDistance) {
        this.playerLocked = true;
        this.lockLostTimer = 0;
        console.log("[GhostAI] PLAYER LOCKED - Chase initiated!");
      }

      // Reset lock lost timer when we can see the player
      if (this.playerLocked) {
        this.lockLostTimer = 0;
      }

      this.state = AIState.CHASE;
      this.lastKnownPlayerPos = { x: targetPos.x, z: targetPos.z };
      this.targetPos = { x: targetPos.x, z: targetPos.z };
      this.headScanAngle = 0; // Stop scanning
    } else if (this.playerLocked) {
      // PLAYER LOCK SYSTEM: Continue chasing even without sight (for a while)
      this.lockLostTimer += dtMs;

      const targetPos = this._getTargetPosition();
      const distToTarget = this._distanceToTarget(targetPos);

      // Check if lock should break
      if (distToTarget > this.lockBreakDistance) {
        // Player too far - break lock
        this.playerLocked = false;
        this.state = AIState.SEARCH;
        this.stateTimer = this.config.searchTime;
        console.log(
          "[GhostAI] LOCK BROKEN - Player too far (",
          distToTarget.toFixed(1),
          "m)"
        );
      } else if (this.lockLostTimer >= this.lockLostTimeout) {
        // Lost sight for too long - break lock
        this.playerLocked = false;
        this.state = AIState.SEARCH;
        this.stateTimer = this.config.searchTime;
        console.log("[GhostAI] LOCK BROKEN - Lost sight for too long");
      } else {
        // Still locked - keep chasing toward last known position
        this.state = AIState.CHASE;
        // Update target to current player position even without sight
        // This makes the AI "predictive" - it goes where player IS, not where they WERE
        this.targetPos = { x: targetPos.x, z: targetPos.z };
      }
    }

    // Calculate desired velocity based on state
    let desiredVelocity = { x: 0, z: 0 };
    let speed = this.config.walkSpeed;

    switch (this.state) {
      case AIState.PATROL:
        this._updatePatrol(dtMs);
        desiredVelocity = this._steerTowards(this.targetPos);
        speed = this.config.walkSpeed;
        this.outputMovement.animation = "walk";
        break;

      case AIState.SUSPICIOUS:
        speed = this.config.walkSpeed * 0.5;
        if (this.targetPos && this._distanceTo(this.targetPos) > 1.5) {
          desiredVelocity = this._steerTowards(this.targetPos);
        } else {
          this.stateTimer -= dtMs;
          desiredVelocity = {
            x: (Math.random() - 0.5) * 0.5,
            z: (Math.random() - 0.5) * 0.5,
          };
          if (this.stateTimer <= 0) {
            this.state = AIState.PATROL;
          }
        }
        this.outputMovement.animation = "walk";
        break;

      case AIState.CHASE:
        speed = this.config.runSpeed;
        if (this.canSeeTarget) {
          const targetPos = this._getTargetPosition();
          this.targetPos = { x: targetPos.x, z: targetPos.z };
        } else {
          // Lost sight - switch to search
          this.state = AIState.SEARCH;
          this.stateTimer = this.config.searchTime;
        }
        desiredVelocity = this._steerTowards(this.targetPos);
        this.outputMovement.animation = "run";
        break;

      case AIState.SEARCH:
        this.stateTimer -= dtMs;
        speed = this.config.walkSpeed;

        // Reached search point - pick new random offset
        if (this.targetPos && this._distanceTo(this.targetPos) < 1.0) {
          this.targetPos = {
            x: this.targetPos.x + (Math.random() - 0.5) * 10,
            z: this.targetPos.z + (Math.random() - 0.5) * 10,
          };
        }
        desiredVelocity = this._steerTowards(this.targetPos);

        if (this.stateTimer <= 0) {
          this.state = Math.random() > 0.5 ? AIState.AMBUSH : AIState.PATROL;
          this.stateTimer = 5000;
        }
        this.outputMovement.animation = "walk";
        break;

      case AIState.AMBUSH:
        this.stateTimer -= dtMs;
        speed = 0;
        if (this.stateTimer <= 0) {
          this.state = AIState.PATROL;
        }
        this.outputMovement.animation = "idle";
        break;
    }

    // Apply wall avoidance (THE KEY REFERENCE PATTERN)
    if (desiredVelocity.x !== 0 || desiredVelocity.z !== 0) {
      // Normalize desired velocity
      const len = Math.sqrt(
        desiredVelocity.x * desiredVelocity.x +
          desiredVelocity.z * desiredVelocity.z
      );
      if (len > 0.001) {
        desiredVelocity.x /= len;
        desiredVelocity.z /= len;
      }

      // Apply speed
      desiredVelocity.x *= speed;
      desiredVelocity.z *= speed;

      // Get wall avoidance force (using 3 rays)
      const avoidance = this._getWallAvoidance(desiredVelocity);

      // Add avoidance MULTIPLIED BY 3.0 (reference pattern!)
      desiredVelocity.x += avoidance.x * 3.0;
      desiredVelocity.z += avoidance.z * 3.0;

      // Clamp to max speed
      const finalLen = Math.sqrt(
        desiredVelocity.x * desiredVelocity.x +
          desiredVelocity.z * desiredVelocity.z
      );
      if (finalLen > speed) {
        desiredVelocity.x = (desiredVelocity.x / finalLen) * speed;
        desiredVelocity.z = (desiredVelocity.z / finalLen) * speed;
      }
    }

    // Set output
    this.outputMovement.x = desiredVelocity.x;
    this.outputMovement.z = desiredVelocity.z;
    this.outputMovement.speed = speed;

    // Update debug info
    this.debugInfo.state = this.state;
    const targetPos = this._getTargetPosition();
    this.debugInfo.distance = this._distanceToTarget(targetPos);
  }

  /**
   * Get computed movement for this frame
   */
  getMovement() {
    return this.outputMovement;
  }

  /**
   * Get current AI state
   */
  getState() {
    return this.state;
  }

  /**
   * Report noise from player (footsteps, running)
   */
  hear(worldX, worldZ, intensity) {
    const dist = Math.sqrt(
      Math.pow(worldX - this.position.x, 2) +
        Math.pow(worldZ - this.position.z, 2)
    );

    const volume =
      intensity *
      Math.max(
        0,
        (this.config.hearingThreshold - dist) / this.config.hearingThreshold
      );

    if (volume > 0.1) {
      this.debugInfo.lastNoise = `Heard @ ${Math.floor(dist)}m`;

      if (this.state !== AIState.CHASE) {
        this.state = AIState.SUSPICIOUS;
        this.targetPos = { x: worldX, z: worldZ };
        this.stateTimer = 3000;
      }
    }
  }

  /**
   * Report noise (alias for compatibility)
   */
  reportNoise(worldX, worldZ, intensity) {
    this.hear(worldX, worldZ, intensity);
  }

  /**
   * Get debug info for panel
   */
  getDebugInfo() {
    return {
      state: this.state,
      stateTimer: (this.stateTimer / 1000).toFixed(1),
      canSeeTarget: this.canSeeTarget,
      distance: this.debugInfo.distance.toFixed(1),
      lastNoise: this.debugInfo.lastNoise,
      speed: this.outputMovement.speed.toFixed(1),
      animation: this.outputMovement.animation,
      playerLocked: this.playerLocked,
      lockLostTimer: (this.lockLostTimer / 1000).toFixed(1),
    };
  }

  /**
   * Get debug path (for visualization)
   */
  getDebugPath() {
    if (this.targetPos) {
      return [this.position, this.targetPos];
    }
    return [];
  }

  /**
   * Generate patrol waypoints (compatibility method)
   */
  generatePatrolFromMaze() {
    // Already done in constructor
    if (this.floorCells.length > 0 && !this.targetPos) {
      this._pickRandomPatrolTarget();
    }
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  _collectFloorCells() {
    for (let y = 0; y < this.mazeHeight; y++) {
      for (let x = 0; x < this.mazeWidth; x++) {
        if (this.maze[y][x] === 0) {
          this.floorCells.push({
            x: x * this.cellSize + this.cellSize / 2,
            z: y * this.cellSize + this.cellSize / 2,
          });
        }
      }
    }
  }

  _updatePatrol(dtMs) {
    // Pick new patrol target if needed
    if (!this.targetPos || this._distanceTo(this.targetPos) < 2.0) {
      this._pickRandomPatrolTarget();
    }
  }

  _pickRandomPatrolTarget() {
    if (this.floorCells.length > 0) {
      const idx = Math.floor(Math.random() * this.floorCells.length);
      const cell = this.floorCells[idx];
      this.targetPos = { x: cell.x, z: cell.z };
    }
  }

  /**
   * HEAD SCANNING: Sweep vision 180° to detect player when idle
   * Oscillates scan angle from -90° to +90° relative to facing
   * Returns true if player detected during scan
   */
  _performHeadScan(deltaTime) {
    // Update scan angle (oscillate between -90° and +90°)
    const maxScanAngle = Math.PI / 2; // 90 degrees

    this.headScanAngle +=
      this.headScanDirection * this.headScanSpeed * deltaTime;

    // Reverse direction at limits
    if (this.headScanAngle >= maxScanAngle) {
      this.headScanAngle = maxScanAngle;
      this.headScanDirection = -1;
    } else if (this.headScanAngle <= -maxScanAngle) {
      this.headScanAngle = -maxScanAngle;
      this.headScanDirection = 1;
    }

    // Update debug
    this.debugInfo.scanning = true;

    // Check vision at the current scan angle
    return this._checkVisionAtAngle(this.headScanAngle);
  }

  /**
   * Check vision at a specific angle offset from facing
   * Used by head scanning system
   */
  _checkVisionAtAngle(angleOffset) {
    if (!this.target) return false;

    const targetPos = this._getTargetPosition();
    const dx = targetPos.x - this.position.x;
    const dz = targetPos.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Beyond view distance
    if (dist > this.config.viewDist) return false;

    // Calculate angle to target
    const toTargetAngle = Math.atan2(dx, dz);

    // Calculate the scan direction (facing + offset)
    const scanFacingAngle = this.facingAngle + angleOffset;

    // Check if target is within FOV of the scan direction
    let angleDiff = toTargetAngle - scanFacingAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const halfFOV = (this.config.fov / 2) * (Math.PI / 180);
    if (Math.abs(angleDiff) > halfFOV) return false;

    // Line of sight check
    return this._hasLineOfSight(targetPos);
  }

  /**
   * Simple steer towards target (from reference)
   */
  _steerTowards(target) {
    if (!target) return { x: 0, z: 0 };
    return {
      x: target.x - this.position.x,
      z: target.z - this.position.z,
    };
  }

  /**
   * Wall avoidance with 3 rays (THE REFERENCE PATTERN)
   * Rays at angles: 0, +0.5rad (~30°), -0.5rad (~-30°)
   */
  _getWallAvoidance(moveDir) {
    const avoidanceForce = { x: 0, z: 0 };
    const rayLen = 2.5;
    const angles = [0, 0.5, -0.5]; // radians

    // Normalize moveDir for ray direction
    const len = Math.sqrt(moveDir.x * moveDir.x + moveDir.z * moveDir.z);
    if (len < 0.001) return avoidanceForce;

    const dirX = moveDir.x / len;
    const dirZ = moveDir.z / len;

    for (const angle of angles) {
      // Rotate direction by angle
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rayDirX = dirX * cos - dirZ * sin;
      const rayDirZ = dirX * sin + dirZ * cos;

      // Check for wall using grid
      const hitDist = this._raycastGrid(rayDirX, rayDirZ, rayLen);

      if (hitDist < rayLen) {
        // Wall detected - push away
        // Weight increases as wall gets closer (1/distance)
        const weight = 1.0 / Math.max(0.1, hitDist);

        // Push in opposite direction of ray
        avoidanceForce.x -= rayDirX * weight;
        avoidanceForce.z -= rayDirZ * weight;
      }
    }

    return avoidanceForce;
  }

  /**
   * Simple grid-based raycast
   */
  _raycastGrid(dirX, dirZ, maxDist) {
    const steps = 5;
    const stepSize = maxDist / steps;

    for (let i = 1; i <= steps; i++) {
      const checkX = this.position.x + dirX * stepSize * i;
      const checkZ = this.position.z + dirZ * stepSize * i;

      const cellX = Math.floor(checkX / this.cellSize);
      const cellZ = Math.floor(checkZ / this.cellSize);

      // Check bounds and wall
      if (
        cellX < 0 ||
        cellX >= this.mazeWidth ||
        cellZ < 0 ||
        cellZ >= this.mazeHeight ||
        this.maze[cellZ]?.[cellX] === 1
      ) {
        return stepSize * i;
      }
    }

    return maxDist;
  }

  /**
   * Check if we can see the target (from reference checkVision)
   */
  _checkVision() {
    if (!this.target) return false;

    const targetPos = this._getTargetPosition();
    const dx = targetPos.x - this.position.x;
    const dz = targetPos.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Beyond view distance
    if (dist > this.config.viewDist) return false;

    // Check FOV
    const toTargetAngle = Math.atan2(dx, dz);
    let angleDiff = toTargetAngle - this.facingAngle;

    // Normalize angle
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const halfFOV = (this.config.fov / 2) * (Math.PI / 180);
    if (Math.abs(angleDiff) > halfFOV) return false;

    // Line of sight check (grid-based Bresenham)
    return this._hasLineOfSight(targetPos);
  }

  /**
   * Grid-based line of sight
   */
  _hasLineOfSight(targetPos) {
    const x0 = Math.floor(this.position.x / this.cellSize);
    const y0 = Math.floor(this.position.z / this.cellSize);
    const x1 = Math.floor(targetPos.x / this.cellSize);
    const y1 = Math.floor(targetPos.z / this.cellSize);

    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;

    while (true) {
      // Check if wall
      if (
        x < 0 ||
        x >= this.mazeWidth ||
        y < 0 ||
        y >= this.mazeHeight ||
        this.maze[y]?.[x] === 1
      ) {
        return false;
      }

      if (x === x1 && y === y1) return true;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  _getTargetPosition() {
    if (!this.target) return { x: 0, z: 0 };

    if (typeof this.target.getPosition === "function") {
      const pos = this.target.getPosition();
      return { x: pos.x, z: pos.z };
    }

    if (this.target.position) {
      return { x: this.target.position.x, z: this.target.position.z };
    }

    return { x: 0, z: 0 };
  }

  _distanceToTarget(targetPos) {
    return Math.sqrt(
      Math.pow(targetPos.x - this.position.x, 2) +
        Math.pow(targetPos.z - this.position.z, 2)
    );
  }

  _distanceTo(pos) {
    if (!pos) return Infinity;
    return Math.sqrt(
      Math.pow(pos.x - this.position.x, 2) +
        Math.pow(pos.z - this.position.z, 2)
    );
  }
}

export { AIState };
