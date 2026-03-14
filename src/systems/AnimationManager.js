import * as THREE from "three";

/**
 * AnimationManager - Centralized animation state machine
 *
 * Handles all character animation loading, state transitions, and timing.
 * Designed to be reusable for Player, Ghost, and NPC entities.
 */
export class AnimationManager {
  constructor(mixer) {
    this.mixer = mixer;
    this.actions = {}; // { 'idle': AnimationAction, 'walk': ... }
    this.currentState = null;
    this.currentAction = null;

    // Timing for jump detection
    this.lastGroundedTime = 0;
    this.groundedBufferDuration = 0.05; // Reduced from 0.15s for snappier jumps

    // State machine config
    this.config = {
      walkThreshold: 0.5, // Speed to start walking
      idleThreshold: 0.2, // Speed to stop (hysteresis)
      fadeDuration: 0.25, // Default crossfade duration
      jumpFadeDuration: 0.1, // Faster fade for jump
      // Animation playback speeds
      animSpeeds: {
        idle: 1.0,
        walk: 1.5, // Faster walk animation
        run: 1.0,
        jump: 1.0,
      },
    };

    // Event callbacks
    this.onStateChange = null;
  }

  /**
   * Register an animation clip as a named action
   * @param {string} name - Animation name ('idle', 'walk', 'run', 'jump')
   * @param {THREE.AnimationClip} clip - The animation clip
   * @param {object} options - Loop mode, clamp, etc.
   */
  addAnimation(name, clip, options = {}) {
    if (!this.mixer || !clip) return;

    // Strip position tracks to prevent root motion issues
    clip.tracks = clip.tracks.filter(
      (track) => !track.name.endsWith(".position")
    );

    const action = this.mixer.clipAction(clip);

    // Configure loop mode
    if (options.loop === "once") {
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat);
    }

    this.actions[name] = action;

    // Auto-start with idle if this is the first animation
    if (!this.currentAction && name === "idle") {
      this.setState("idle");
    }
  }

  /**
   * Force transition to a specific state
   * @param {string} state - Target state name
   */
  setState(state) {
    if (!this.actions[state]) {
      console.warn(`[AnimationManager] Unknown state: ${state}`);
      return;
    }

    if (state === this.currentState) return;

    const newAction = this.actions[state];
    const oldAction = this.currentAction;

    if (newAction && newAction !== oldAction) {
      newAction.reset();
      newAction.setEffectiveWeight(1);

      const fadeDuration =
        state === "jump"
          ? this.config.jumpFadeDuration
          : this.config.fadeDuration;

      if (oldAction) {
        newAction.crossFadeFrom(oldAction, fadeDuration, true);
      }

      newAction.play();

      // Apply custom animation speed AFTER play to ensure it takes effect
      const speed = this.config.animSpeeds[state] || 1.0;
      newAction.setEffectiveTimeScale(speed);

      this.currentAction = newAction;
      this.currentState = state;

      // Callback
      if (this.onStateChange) {
        this.onStateChange(state);
      }
    }
  }

  /**
   * Update the animation mixer and determine state based on context
   * @param {number} deltaTime - Frame delta
   * @param {object} context - { velocity, grounded, isSprinting }
   */
  update(deltaTime, context) {
    if (!this.mixer) return;

    // Always update the mixer
    this.mixer.update(deltaTime);

    if (!context) return;

    const { velocity, grounded, isSprinting } = context;
    const now = performance.now() / 1000;

    // Track grounded time
    if (grounded) {
      this.lastGroundedTime = now;
    }

    // Calculate horizontal speed
    const horizontalSpeed = Math.sqrt(
      velocity.x * velocity.x + velocity.z * velocity.z
    );

    // Determine target state
    let targetState = this.currentState || "idle";

    // Airborne check with buffer
    const timeSinceGrounded = now - this.lastGroundedTime;
    const isAirborne =
      !grounded && timeSinceGrounded > this.groundedBufferDuration;

    if (isAirborne) {
      targetState = "jump";
    } else if (grounded) {
      // On ground - determine movement state
      if (this.currentState === "jump") {
        // Just landed - pick appropriate movement state
        targetState =
          horizontalSpeed > 0.1 ? (isSprinting ? "run" : "walk") : "idle";

        // FIX: Force smooth transition when landing
        if (this.actions[targetState]) {
          const action = this.actions[targetState];
          action.reset();
          action.setEffectiveWeight(1);
          action.crossFadeFrom(this.actions["jump"], 0.2, true); // 0.2s blend
          action.play();
          this.currentState = targetState;
          this.currentAction = action;
          return; // Skip standard update to avoid overriding
        }
      } else if (this.currentState === "idle") {
        // Currently idle - need higher threshold to start moving (hysteresis)
        if (horizontalSpeed > this.config.walkThreshold) {
          targetState = isSprinting ? "run" : "walk";
        }
      } else {
        // Currently moving - use lower threshold to stop (hysteresis)
        if (horizontalSpeed < this.config.idleThreshold) {
          targetState = "idle";
        } else {
          targetState = isSprinting ? "run" : "walk";
        }
      }
    }

    // Fallback if animation doesn't exist
    if (!this.actions[targetState]) {
      if (targetState === "jump") {
        targetState =
          horizontalSpeed > 0.5 ? (isSprinting ? "run" : "walk") : "idle";
      } else if (targetState === "run" && !this.actions.run) {
        targetState = "walk";
      }
    }

    // Apply state change
    if (targetState !== this.currentState && this.actions[targetState]) {
      this.setState(targetState);
    }
  }

  /**
   * Get current animation state
   */
  getState() {
    return this.currentState;
  }

  /**
   * Dispose of resources
   */
  dispose() {
    Object.values(this.actions).forEach((action) => {
      action.stop();
    });
    this.actions = {};
    this.currentAction = null;
    this.currentState = null;
  }
}
