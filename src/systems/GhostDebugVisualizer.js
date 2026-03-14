/**
 * GhostDebugVisualizer - Advanced AI Debug System
 *
 * A comprehensive real-time debugging tool for the Ghost AI system.
 * Features:
 * - Dynamic 3D visualization of AI state
 * - Real-time pathfinding display
 * - Vision cone with raycast indicators
 * - Proximity zones with pulsing effects
 * - Floating HUD panel with live metrics
 * - Color-coded state indicators
 *
 * Toggle: Press 'M' key
 */
import * as THREE from "three";

export class GhostDebugVisualizer {
  constructor(scene) {
    this.scene = scene;
    this.enabled = false;
    this.lastUpdateTime = 0;
    this.updateInterval = 50; // ms between visual updates for performance

    // Proximity zones (meters)
    this.DANGER_ZONE = 5;
    this.CHASE_ZONE = 15;
    this.AWARE_ZONE = 30;

    // Color palette
    this.colors = {
      danger: 0xff2244,
      chase: 0xffaa00,
      aware: 0x44ff88,
      path: 0x00ffff,
      pathNode: 0xff00ff,
      los: { clear: 0x00ff00, blocked: 0xff0000 },
      vision: { active: 0xff4444, inactive: 0xffff44 },
      states: {
        patrol: 0x00ff88,
        suspicious: 0xffff00,
        chase: 0xff4400,
        search: 0xff8800,
        ambush: 0x8800ff,
        stalk: 0x0088ff,
        enraged: 0xff0088,
        idle: 0x888888,
        wander: 0x00aa44,
      },
    };

    // 3D Elements
    this.elements = {
      dangerZone: null,
      chaseZone: null,
      awareZone: null,
      visionCone: null,
      visionRays: [],
      pathLine: null,
      pathNodes: [],
      losLine: null,
      stateOrb: null,
      directionArrow: null,
      targetMarker: null,
    };

    // HUD
    this.hudPanel = null;
    this.hudElements = {};

    this._init();
  }

  _init() {
    this._createZones();
    this._createVisionSystem();
    this._createPathVisualization();
    this._createIndicators();
    this._createHUD();
    this._setVisibility(false);
  }

  // ============================================================
  // ZONE CREATION
  // ============================================================

  _createZones() {
    // Danger zone (pulsing inner ring)
    this.elements.dangerZone = this._createPulsingRing(
      this.DANGER_ZONE,
      this.colors.danger,
      0.5
    );

    // Chase zone
    this.elements.chaseZone = this._createRing(
      this.CHASE_ZONE,
      this.colors.chase,
      0.3
    );

    // Awareness zone
    this.elements.awareZone = this._createRing(
      this.AWARE_ZONE,
      this.colors.aware,
      0.15
    );

    [
      this.elements.dangerZone,
      this.elements.chaseZone,
      this.elements.awareZone,
    ].forEach((z) => {
      if (z) this.scene.add(z);
    });
  }

  _createRing(radius, color, opacity) {
    const geo = new THREE.RingGeometry(radius - 0.15, radius + 0.15, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    return new THREE.Mesh(geo, mat);
  }

  _createPulsingRing(radius, color, opacity) {
    const group = new THREE.Group();

    // Outer glow
    const outerGeo = new THREE.RingGeometry(radius - 0.3, radius + 0.3, 64);
    outerGeo.rotateX(-Math.PI / 2);
    const outerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: opacity * 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(outerGeo, outerMat));

    // Core ring
    const coreGeo = new THREE.RingGeometry(radius - 0.1, radius + 0.1, 64);
    coreGeo.rotateX(-Math.PI / 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.userData.pulseCore = true;
    group.add(core);

    return group;
  }

  // ============================================================
  // VISION SYSTEM
  // ============================================================

  _createVisionSystem() {
    // Create multiple raycast lines
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: this.colors.vision.inactive,
        transparent: true,
        opacity: 0.6,
      });
      const geo = new THREE.BufferGeometry();
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.elements.visionRays.push(line);
      this.scene.add(line);
    }
  }

  _updateVisionCone(ghostPos, ghostAngle, fov, canSee) {
    if (!ghostPos) return;

    const rayLength = 15;
    const halfFov = ((fov || 120) * Math.PI) / 180 / 2;
    const numRays = this.elements.visionRays.length;

    for (let i = 0; i < numRays; i++) {
      const ray = this.elements.visionRays[i];
      const offset = ((i / (numRays - 1)) * 2 - 1) * halfFov;
      const angle = ghostAngle + offset;

      const endX = ghostPos.x + Math.sin(angle) * rayLength;
      const endZ = ghostPos.z + Math.cos(angle) * rayLength;

      const points = [
        new THREE.Vector3(ghostPos.x, 1.2, ghostPos.z),
        new THREE.Vector3(endX, 1.2, endZ),
      ];

      ray.geometry.dispose();
      ray.geometry = new THREE.BufferGeometry().setFromPoints(points);
      ray.material.color.setHex(
        canSee ? this.colors.vision.active : this.colors.vision.inactive
      );
      ray.material.opacity = canSee ? 0.8 : 0.4;
    }
  }

  // ============================================================
  // PATH VISUALIZATION
  // ============================================================

  _createPathVisualization() {
    // Path line
    const pathMat = new THREE.LineBasicMaterial({
      color: this.colors.path,
      transparent: true,
      opacity: 0.8,
      linewidth: 3,
    });
    this.elements.pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      pathMat
    );
    this.elements.pathLine.frustumCulled = false;
    this.scene.add(this.elements.pathLine);

    // LOS line
    const losMat = new THREE.LineBasicMaterial({
      color: this.colors.los.clear,
      transparent: true,
      opacity: 0.9,
    });
    this.elements.losLine = new THREE.Line(new THREE.BufferGeometry(), losMat);
    this.elements.losLine.frustumCulled = false;
    this.scene.add(this.elements.losLine);
  }

  _updatePath(ghostPos, path) {
    // Clear old path nodes
    this.elements.pathNodes.forEach((node) => {
      this.scene.remove(node);
      node.geometry?.dispose();
      node.material?.dispose();
    });
    this.elements.pathNodes = [];

    if (!path || path.length === 0) {
      this.elements.pathLine.visible = false;
      return;
    }

    // Create path line
    const points = [new THREE.Vector3(ghostPos.x, 0.3, ghostPos.z)];
    path.forEach((p) => points.push(new THREE.Vector3(p.x, 0.3, p.z)));

    this.elements.pathLine.geometry.dispose();
    this.elements.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(
      points
    );
    this.elements.pathLine.visible = true;

    // Create waypoint markers
    path.forEach((p, i) => {
      const size = i === path.length - 1 ? 0.4 : 0.25;
      const geo = new THREE.SphereGeometry(size, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: i === path.length - 1 ? this.colors.pathNode : this.colors.path,
        transparent: true,
        opacity: 0.7,
      });
      const marker = new THREE.Mesh(geo, mat);
      marker.position.set(p.x, 0.5, p.z);
      this.elements.pathNodes.push(marker);
      this.scene.add(marker);
    });
  }

  // ============================================================
  // INDICATORS
  // ============================================================

  _createIndicators() {
    // State orb (floating above ghost)
    const orbGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const orbMat = new THREE.MeshBasicMaterial({
      color: this.colors.states.patrol,
      transparent: true,
      opacity: 0.9,
    });
    this.elements.stateOrb = new THREE.Mesh(orbGeo, orbMat);
    this.scene.add(this.elements.stateOrb);

    // Direction arrow
    const arrowGeo = new THREE.ConeGeometry(0.2, 0.8, 8);
    arrowGeo.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });
    this.elements.directionArrow = new THREE.Mesh(arrowGeo, arrowMat);
    this.scene.add(this.elements.directionArrow);

    // Target marker
    const targetGeo = new THREE.TorusGeometry(0.5, 0.1, 8, 16);
    targetGeo.rotateX(Math.PI / 2);
    const targetMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.7,
    });
    this.elements.targetMarker = new THREE.Mesh(targetGeo, targetMat);
    this.scene.add(this.elements.targetMarker);
  }

  // ============================================================
  // HUD PANEL
  // ============================================================

  _createHUD() {
    this.hudPanel = document.createElement("div");
    this.hudPanel.id = "ghost-debug-hud";
    this.hudPanel.innerHTML = `
      <style>
        #ghost-debug-hud {
          position: fixed;
          top: 10px;
          left: 10px;
          background: linear-gradient(135deg, rgba(10, 15, 30, 0.95) 0%, rgba(20, 25, 45, 0.95) 100%);
          color: #fff;
          padding: 16px 20px;
          border-radius: 12px;
          font-family: 'JetBrains Mono', 'Consolas', monospace;
          font-size: 12px;
          z-index: 10000;
          min-width: 280px;
          border: 1px solid rgba(100, 150, 255, 0.3);
          box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 20px rgba(100, 150, 255, 0.1);
          backdrop-filter: blur(10px);
          display: none;
        }
        .debug-header {
          font-size: 14px;
          font-weight: 700;
          color: #6af;
          margin-bottom: 14px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(100, 150, 255, 0.3);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .debug-header::before {
          content: "👻";
          font-size: 18px;
        }
        .debug-row {
          display: flex;
          justify-content: space-between;
          margin: 6px 0;
          align-items: center;
        }
        .debug-label {
          color: #8899aa;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .debug-value {
          font-weight: 600;
          font-size: 13px;
        }
        .debug-state {
          padding: 4px 10px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .debug-bar {
          width: 120px;
          height: 10px;
          background: rgba(255,255,255,0.1);
          border-radius: 5px;
          overflow: hidden;
        }
        .debug-bar-fill {
          height: 100%;
          border-radius: 5px;
          transition: width 0.2s ease;
        }
        .debug-divider {
          height: 1px;
          background: rgba(100, 150, 255, 0.2);
          margin: 12px 0;
        }
        .debug-footer {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid rgba(100, 150, 255, 0.2);
          font-size: 10px;
          color: #556;
          text-align: center;
        }
      </style>
      <div class="debug-header">GHOST AI DEBUG</div>
      <div class="debug-row">
        <span class="debug-label">State</span>
        <span class="debug-state debug-value" id="debug-state">PATROL</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Distance</span>
        <span class="debug-value" id="debug-distance">0.0m</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Can See</span>
        <span class="debug-value" id="debug-los">NO</span>
      </div>
      <div class="debug-divider"></div>
      <div class="debug-row">
        <span class="debug-label">Rage</span>
        <div class="debug-bar">
          <div class="debug-bar-fill" id="debug-rage-bar" style="width: 0%; background: linear-gradient(90deg, #4f4, #ff0, #f44);"></div>
        </div>
        <span class="debug-value" id="debug-rage">0%</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">FOV</span>
        <span class="debug-value" id="debug-fov">120°</span>
      </div>
      <div class="debug-divider"></div>
      <div class="debug-row">
        <span class="debug-label">Animation</span>
        <span class="debug-value" id="debug-anim">idle</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Path Length</span>
        <span class="debug-value" id="debug-path">0</span>
      </div>
      <div class="debug-footer">Press M to toggle • Zones: Red=5m Yellow=15m Green=30m</div>
    `;
    document.body.appendChild(this.hudPanel);
  }

  _updateHUD(ghost, ai, distance) {
    if (!this.hudPanel) return;

    const state = ghost?.currentState || "unknown";
    const stateEl = document.getElementById("debug-state");
    if (stateEl) {
      stateEl.textContent = state.toUpperCase();
      const stateColor = this.colors.states[state] || 0x888888;
      stateEl.style.background = `#${stateColor.toString(16).padStart(6, "0")}`;
      stateEl.style.color = stateColor > 0x888888 ? "#000" : "#fff";
    }

    const distEl = document.getElementById("debug-distance");
    if (distEl) {
      distEl.textContent = `${distance.toFixed(1)}m`;
      distEl.style.color =
        distance < 5 ? "#f44" : distance < 15 ? "#fa0" : "#4f8";
    }

    const losEl = document.getElementById("debug-los");
    if (losEl) {
      const canSee = ai?.canSeeTarget || false;
      losEl.textContent = canSee ? "YES" : "NO";
      losEl.style.color = canSee ? "#4f4" : "#f44";
    }

    const rageBar = document.getElementById("debug-rage-bar");
    const rageVal = document.getElementById("debug-rage");
    const rage = ai?.rageMeter || 0;
    if (rageBar) rageBar.style.width = `${rage}%`;
    if (rageVal) {
      rageVal.textContent = `${Math.round(rage)}%`;
      rageVal.style.color = rage > 60 ? "#f44" : rage > 30 ? "#fa0" : "#fff";
    }

    const fovEl = document.getElementById("debug-fov");
    if (fovEl)
      fovEl.textContent = `${ai?.debugInfo?.currentFOV?.toFixed(0) || 120}°`;

    const animEl = document.getElementById("debug-anim");
    if (animEl) animEl.textContent = ai?.outputMovement?.animation || "idle";

    const pathEl = document.getElementById("debug-path");
    if (pathEl) pathEl.textContent = `${ai?.currentPath?.length || 0} nodes`;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  toggle() {
    this.enabled = !this.enabled;
    this._setVisibility(this.enabled);
    console.log(`Ghost Debug: ${this.enabled ? "ON" : "OFF"}`);
    return this.enabled;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this._setVisibility(enabled);
  }

  update(ghost, player) {
    if (!this.enabled || !ghost) return;

    // Throttle updates for performance
    const now = performance.now();
    if (now - this.lastUpdateTime < this.updateInterval) return;
    this.lastUpdateTime = now;

    const ghostPos = ghost.bodyPosition || ghost.mesh?.position;
    if (!ghostPos) return;

    const playerPos = player?.getPosition() || { x: 0, y: 0, z: 0 };
    const ai = ghost.ai;
    const y = 0.15;

    // Calculate distance
    const dx = playerPos.x - ghostPos.x;
    const dz = playerPos.z - ghostPos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Update zones position
    const zoneY = y;
    this.elements.dangerZone?.position.set(ghostPos.x, zoneY, ghostPos.z);
    this.elements.chaseZone?.position.set(ghostPos.x, zoneY, ghostPos.z);
    this.elements.awareZone?.position.set(ghostPos.x, zoneY, ghostPos.z);

    // Pulse danger zone
    if (this.elements.dangerZone) {
      const pulseScale = 1 + Math.sin(now * 0.005) * 0.1;
      this.elements.dangerZone.scale.set(pulseScale, 1, pulseScale);

      // Make it more intense when player is close
      if (distance < this.DANGER_ZONE) {
        this.elements.dangerZone.children.forEach((c) => {
          if (c.material) c.material.opacity = 0.8;
        });
      }
    }

    // Update vision rays
    const ghostAngle = ghost.mesh?.rotation?.y || 0;
    const fov = ai?.debugInfo?.currentFOV || 120;
    const canSee = ai?.canSeeTarget || false;
    this._updateVisionCone(ghostPos, ghostAngle, fov, canSee);

    // Update path
    if (ghost.getAIPath) {
      this._updatePath(ghostPos, ghost.getAIPath());
    }

    // Update LOS line
    const losColor = canSee ? this.colors.los.clear : this.colors.los.blocked;
    this.elements.losLine.material.color.setHex(losColor);
    const losPoints = [
      new THREE.Vector3(ghostPos.x, 1.5, ghostPos.z),
      new THREE.Vector3(playerPos.x, 1.5, playerPos.z),
    ];
    this.elements.losLine.geometry.dispose();
    this.elements.losLine.geometry = new THREE.BufferGeometry().setFromPoints(
      losPoints
    );

    // Update state orb
    const stateColor =
      this.colors.states[ghost.currentState] || this.colors.states.idle;
    this.elements.stateOrb.material.color.setHex(stateColor);
    this.elements.stateOrb.position.set(
      ghostPos.x,
      (ghost.height || 2.5) + 1.2,
      ghostPos.z
    );

    // Update direction arrow
    const moveDir = ai?.outputMovement || { x: 0, z: 1 };
    this.elements.directionArrow.position.set(
      ghostPos.x + (moveDir.x || 0) * 1.5,
      0.5,
      ghostPos.z + (moveDir.z || 0) * 1.5
    );
    this.elements.directionArrow.rotation.y = ghostAngle;

    // Update target marker
    if (ai?.lastKnownTargetPos) {
      this.elements.targetMarker.visible = true;
      this.elements.targetMarker.position.set(
        ai.lastKnownTargetPos.x,
        0.3,
        ai.lastKnownTargetPos.z
      );
      this.elements.targetMarker.rotation.z += 0.02; // Spin
    } else {
      this.elements.targetMarker.visible = false;
    }

    // Update HUD
    this._updateHUD(ghost, ai, distance);
  }

  _setVisibility(visible) {
    Object.values(this.elements).forEach((el) => {
      if (Array.isArray(el)) {
        el.forEach((e) => {
          if (e) e.visible = visible;
        });
      } else if (el) {
        el.visible = visible;
      }
    });

    this.elements.pathNodes.forEach((n) => (n.visible = visible));

    if (this.hudPanel) {
      this.hudPanel.style.display = visible ? "block" : "none";
    }
  }

  dispose() {
    Object.values(this.elements).forEach((el) => {
      if (Array.isArray(el)) {
        el.forEach((e) => {
          if (e) {
            this.scene.remove(e);
            e.geometry?.dispose();
            e.material?.dispose();
          }
        });
      } else if (el) {
        this.scene.remove(el);
        el.geometry?.dispose();
        el.material?.dispose();
      }
    });

    this.elements.pathNodes.forEach((n) => {
      this.scene.remove(n);
      n.geometry?.dispose();
      n.material?.dispose();
    });

    if (this.hudPanel?.parentNode) {
      this.hudPanel.parentNode.removeChild(this.hudPanel);
    }
  }
}
