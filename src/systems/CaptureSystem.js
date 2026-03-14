/**
 * CaptureSystem - Orchestrates the ghost capture death sequence
 *
 * NEW DESIGN:
 * - Camera locks onto ghost's face throughout the sequence
 * - Cinematic blur, vignette, and desaturation effect (no eyelid closing)
 * - Ghost approaches menacingly while player is helpless
 *
 * Phases:
 * 1. GRAB (0-0.8s) - Camera snaps to ghost, slight zoom, player frozen
 * 2. APPROACH (0.8-2.5s) - Ghost moves closer, camera tracks face, vignette intensifies
 * 3. CONSUME (2.5-4.0s) - Screen distorts, desaturates, blur increases
 * 4. FADE (4.0-5.5s) - Fade to black with final heartbeat
 * 5. DEAD - Show death menu
 */

import * as THREE from "three";

const CapturePhase = {
  NONE: "none",
  GRAB: "grab",
  APPROACH: "approach",
  CONSUME: "consume",
  FADE: "fade",
  DEAD: "dead",
};

// Phase timing (seconds)
const PHASE_TIMING = {
  GRAB: { start: 0, end: 0.8 },
  APPROACH: { start: 0.8, end: 2.5 },
  CONSUME: { start: 2.5, end: 4.0 },
  FADE: { start: 4.0, end: 5.5 },
};

export class CaptureSystem {
  constructor(player, camera, hud) {
    this.player = player;
    this.camera = camera;
    this.hud = hud;

    this.isActive = false;
    this.currentPhase = CapturePhase.NONE;
    this.elapsedTime = 0;
    this.capturingGhost = null;

    // Camera state before capture
    this.originalCameraState = null;

    // Ghost tracking
    this.targetLookPosition = new THREE.Vector3();
    this.currentLookPosition = new THREE.Vector3();
    this.ghostFaceHeight = 2.5; // Height of ghost's face

    // Create overlay effects
    this._createOverlays();

    // Audio state
    this.audioMuffled = false;

    // Callbacks
    this.onDeathComplete = null;
  }

  _createOverlays() {
    // Vignette overlay - edges darken dramatically
    this.vignetteOverlay = document.createElement("div");
    this.vignetteOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 998;
      opacity: 0;
      background: radial-gradient(ellipse at center, 
        transparent 0%, 
        transparent 20%,
        rgba(0, 0, 0, 0.3) 50%,
        rgba(0, 0, 0, 0.7) 75%,
        rgba(0, 0, 0, 0.95) 100%);
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(this.vignetteOverlay);

    // Red tint overlay - blood/danger effect
    this.redOverlay = document.createElement("div");
    this.redOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 997;
      opacity: 0;
      background: radial-gradient(ellipse at center,
        rgba(80, 0, 0, 0.0) 0%,
        rgba(60, 0, 0, 0.2) 50%,
        rgba(40, 0, 0, 0.5) 100%);
      mix-blend-mode: multiply;
      transition: opacity 0.2s ease;
    `;
    document.body.appendChild(this.redOverlay);

    // Blur overlay container
    this.blurOverlay = document.createElement("div");
    this.blurOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 996;
      backdrop-filter: blur(0px);
      -webkit-backdrop-filter: blur(0px);
      transition: backdrop-filter 0.5s ease;
    `;
    document.body.appendChild(this.blurOverlay);

    // Final fade to black
    this.fadeOverlay = document.createElement("div");
    this.fadeOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 999;
      opacity: 0;
      background: #000000;
      transition: opacity 0.5s ease;
    `;
    document.body.appendChild(this.fadeOverlay);

    // Desaturation filter (applied to canvas)
    this.desaturationStyle = document.createElement("style");
    this.desaturationStyle.textContent = `
      .death-desaturate {
        filter: saturate(1) !important;
        transition: filter 1s ease !important;
      }
      .death-desaturate.active {
        filter: saturate(0.2) contrast(1.1) !important;
      }
    `;
    document.head.appendChild(this.desaturationStyle);
  }

  startCapture(ghost) {
    if (this.isActive) return;

    console.log(
      "[CaptureSystem] CAPTURE SEQUENCE INITIATED - Camera locking to ghost"
    );

    this.isActive = true;
    this.currentPhase = CapturePhase.GRAB;
    this.elapsedTime = 0;
    this.capturingGhost = ghost;

    // Store original camera state
    this.originalCameraState = {
      fov: this.camera.fov,
      position: this.camera.position.clone(),
      rotation: this.camera.rotation.clone(),
    };

    // Initialize look target at ghost position
    if (ghost && ghost.bodyPosition) {
      this.targetLookPosition.set(
        ghost.bodyPosition.x,
        ghost.bodyPosition.y + this.ghostFaceHeight,
        ghost.bodyPosition.z
      );
      this.currentLookPosition.copy(this.targetLookPosition);
    }

    // Disable player controls immediately
    if (this.player) {
      this.player.controlsDisabled = true;
      this.player.injuryState = "captured";
    }

    // Apply desaturation class to canvas
    const canvas = document.querySelector("canvas");
    if (canvas) {
      canvas.classList.add("death-desaturate");
    }

    // Start vignette immediately
    this.vignetteOverlay.style.opacity = "0.5";
    this.redOverlay.style.opacity = "0.3";

    // Trigger grab audio
    this._playGrabAudio();
  }

  update(deltaTime) {
    if (!this.isActive) return;

    this.elapsedTime += deltaTime;

    // Always update camera to face ghost
    this._updateCameraLock(deltaTime);

    // Determine current phase based on elapsed time
    if (this.elapsedTime < PHASE_TIMING.GRAB.end) {
      this._executeGrab(deltaTime);
    } else if (this.elapsedTime < PHASE_TIMING.APPROACH.end) {
      if (this.currentPhase !== CapturePhase.APPROACH) {
        this.currentPhase = CapturePhase.APPROACH;
        console.log("[CaptureSystem] Phase: APPROACH");
      }
      this._executeApproach(deltaTime);
    } else if (this.elapsedTime < PHASE_TIMING.CONSUME.end) {
      if (this.currentPhase !== CapturePhase.CONSUME) {
        this.currentPhase = CapturePhase.CONSUME;
        console.log("[CaptureSystem] Phase: CONSUME");
        this._startAudioMuffle();
      }
      this._executeConsume(deltaTime);
    } else if (this.elapsedTime < PHASE_TIMING.FADE.end) {
      if (this.currentPhase !== CapturePhase.FADE) {
        this.currentPhase = CapturePhase.FADE;
        console.log("[CaptureSystem] Phase: FADE");
      }
      this._executeFade(deltaTime);
    } else {
      // Death complete
      if (this.currentPhase !== CapturePhase.DEAD) {
        this.currentPhase = CapturePhase.DEAD;
        console.log("[CaptureSystem] Phase: DEAD");
        this._onDeathComplete();
      }
    }
  }

  _updateCameraLock(deltaTime) {
    if (!this.capturingGhost || !this.capturingGhost.bodyPosition) return;

    // Update target position to ghost's face
    this.targetLookPosition.set(
      this.capturingGhost.bodyPosition.x,
      this.capturingGhost.bodyPosition.y + this.ghostFaceHeight,
      this.capturingGhost.bodyPosition.z
    );

    // Smooth interpolation to target (slower = more cinematic)
    const lerpFactor = 1 - Math.exp(-3 * deltaTime);
    this.currentLookPosition.lerp(this.targetLookPosition, lerpFactor);

    // Make camera look at ghost face
    this.camera.lookAt(this.currentLookPosition);

    // Add subtle camera shake during intense phases
    if (
      this.currentPhase === CapturePhase.CONSUME ||
      this.currentPhase === CapturePhase.APPROACH
    ) {
      const shakeIntensity =
        this.currentPhase === CapturePhase.CONSUME ? 0.03 : 0.01;
      this.camera.position.x += (Math.random() - 0.5) * shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * shakeIntensity * 0.5;
    }
  }

  _executeGrab(deltaTime) {
    // Phase 1: Initial Grab (0-0.8s)
    // - Snap camera to face the ghost
    // - Zoom in slightly (FOV decrease)
    // - Initial vignette

    const phaseProgress = this.elapsedTime / PHASE_TIMING.GRAB.end;

    // Zoom in (decrease FOV)
    const targetFOV = this.originalCameraState.fov - 15;
    this.camera.fov = THREE.MathUtils.lerp(
      this.originalCameraState.fov,
      targetFOV,
      phaseProgress
    );
    this.camera.updateProjectionMatrix();

    // Intensify vignette
    this.vignetteOverlay.style.opacity = `${0.5 + phaseProgress * 0.3}`;

    // Strong initial shake (being grabbed)
    const shakeIntensity = 0.08 * (1 - phaseProgress);
    this.camera.position.x += (Math.random() - 0.5) * shakeIntensity;
    this.camera.position.y += (Math.random() - 0.5) * shakeIntensity;
  }

  _executeApproach(deltaTime) {
    // Phase 2: Ghost Approaches (0.8-2.5s)
    // - Ghost moves closer to player
    // - Camera stays locked on ghost face
    // - Vignette intensifies, red tint appears

    const phaseProgress =
      (this.elapsedTime - PHASE_TIMING.APPROACH.start) /
      (PHASE_TIMING.APPROACH.end - PHASE_TIMING.APPROACH.start);

    // Continue zoom
    const targetFOV = this.originalCameraState.fov - 25;
    this.camera.fov = THREE.MathUtils.lerp(
      this.originalCameraState.fov - 15,
      targetFOV,
      phaseProgress
    );
    this.camera.updateProjectionMatrix();

    // Vignette gets more intense
    this.vignetteOverlay.style.opacity = `${0.8 + phaseProgress * 0.2}`;

    // Red tint increases
    this.redOverlay.style.opacity = `${0.3 + phaseProgress * 0.4}`;

    // Move ghost closer (if ghost has body)
    if (this.capturingGhost && this.capturingGhost.body && this.player) {
      const playerPos = this.player.getPosition();
      const ghostPos = this.capturingGhost.bodyPosition;

      // Direction from ghost to player
      const dx = playerPos.x - ghostPos.x;
      const dz = playerPos.z - ghostPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Move ghost closer if not already very close
      if (dist > 1.5) {
        const moveSpeed = 2 * deltaTime;
        const nx = dx / dist;
        const nz = dz / dist;

        if (this.capturingGhost.body.setTranslation) {
          this.capturingGhost.body.setTranslation(
            {
              x: ghostPos.x + nx * moveSpeed,
              y: ghostPos.y,
              z: ghostPos.z + nz * moveSpeed,
            },
            true
          );
        }
      }
    }
  }

  _executeConsume(deltaTime) {
    // Phase 3: Consume (2.5-4.0s)
    // - Heavy visual distortion
    // - Desaturation activates
    // - Blur increases

    const phaseProgress =
      (this.elapsedTime - PHASE_TIMING.CONSUME.start) /
      (PHASE_TIMING.CONSUME.end - PHASE_TIMING.CONSUME.start);

    // Full vignette
    this.vignetteOverlay.style.opacity = "1";

    // Pulsing red (heartbeat effect)
    const pulse = Math.sin(this.elapsedTime * 8) * 0.15 + 0.85;
    this.redOverlay.style.opacity = `${0.7 * pulse}`;

    // Apply blur
    const blurAmount = phaseProgress * 8;
    this.blurOverlay.style.backdropFilter = `blur(${blurAmount}px)`;
    this.blurOverlay.style.webkitBackdropFilter = `blur(${blurAmount}px)`;

    // Activate desaturation
    const canvas = document.querySelector("canvas");
    if (canvas && !canvas.classList.contains("active")) {
      canvas.classList.add("active");
    }

    // FOV continues to narrow
    this.camera.fov = THREE.MathUtils.lerp(
      this.originalCameraState.fov - 25,
      this.originalCameraState.fov - 35,
      phaseProgress
    );
    this.camera.updateProjectionMatrix();

    // Set player HP to 0
    if (this.player && this.player.health > 0) {
      this.player.health = 0;
      this.player.injuryState = "dead";
    }
  }

  _executeFade(deltaTime) {
    // Phase 4: Fade to Black (4.0-5.5s)
    // - Screen fades to complete black
    // - All effects at maximum

    const phaseProgress =
      (this.elapsedTime - PHASE_TIMING.FADE.start) /
      (PHASE_TIMING.FADE.end - PHASE_TIMING.FADE.start);

    // Smooth fade to black
    const eased = phaseProgress * phaseProgress * (3 - 2 * phaseProgress); // Smoothstep
    this.fadeOverlay.style.opacity = `${eased}`;

    // Maximum blur
    this.blurOverlay.style.backdropFilter = "blur(15px)";
    this.blurOverlay.style.webkitBackdropFilter = "blur(15px)";
  }

  _onDeathComplete() {
    console.log("[CaptureSystem] DEATH SEQUENCE COMPLETE");

    // Ensure overlays are at final state
    this.fadeOverlay.style.opacity = "1";
    this.vignetteOverlay.style.opacity = "1";

    // Mark player as dead
    if (this.player) {
      this.player.isDead = true;
      this.player.injuryState = "dead";
    }

    // Trigger death menu after brief pause
    setTimeout(() => {
      if (this.onDeathComplete) {
        this.onDeathComplete();
      }
      // Dispatch event for Game.js to handle
      window.dispatchEvent(
        new CustomEvent("playerDeath", {
          detail: { captureSystem: this },
        })
      );
    }, 500);
  }

  _playGrabAudio() {
    // Play grab/attack sound
    console.log("[CaptureSystem] Audio: Grab sting");
    // Could integrate with AudioManager here
  }

  _startAudioMuffle() {
    this.audioMuffled = true;
    console.log("[CaptureSystem] Audio: Muffling started");
  }

  reset() {
    // Reset for respawn
    this.isActive = false;
    this.currentPhase = CapturePhase.NONE;
    this.elapsedTime = 0;
    this.capturingGhost = null;
    this.audioMuffled = false;

    // Reset all overlays
    if (this.vignetteOverlay) this.vignetteOverlay.style.opacity = "0";
    if (this.redOverlay) this.redOverlay.style.opacity = "0";
    if (this.blurOverlay) {
      this.blurOverlay.style.backdropFilter = "blur(0px)";
      this.blurOverlay.style.webkitBackdropFilter = "blur(0px)";
    }
    if (this.fadeOverlay) this.fadeOverlay.style.opacity = "0";

    // Remove desaturation
    const canvas = document.querySelector("canvas");
    if (canvas) {
      canvas.classList.remove("death-desaturate", "active");
    }

    // Restore camera
    if (this.originalCameraState) {
      this.camera.fov = this.originalCameraState.fov;
      this.camera.updateProjectionMatrix();
    }

    // Re-enable player
    if (this.player) {
      this.player.controlsDisabled = false;
      this.player.isDead = false;
    }
  }

  dispose() {
    if (this.vignetteOverlay && this.vignetteOverlay.parentNode) {
      this.vignetteOverlay.parentNode.removeChild(this.vignetteOverlay);
    }
    if (this.redOverlay && this.redOverlay.parentNode) {
      this.redOverlay.parentNode.removeChild(this.redOverlay);
    }
    if (this.blurOverlay && this.blurOverlay.parentNode) {
      this.blurOverlay.parentNode.removeChild(this.blurOverlay);
    }
    if (this.fadeOverlay && this.fadeOverlay.parentNode) {
      this.fadeOverlay.parentNode.removeChild(this.fadeOverlay);
    }
    if (this.desaturationStyle && this.desaturationStyle.parentNode) {
      this.desaturationStyle.parentNode.removeChild(this.desaturationStyle);
    }
  }
}

export { CapturePhase, PHASE_TIMING };
