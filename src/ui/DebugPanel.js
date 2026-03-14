import GUI from "lil-gui";
import * as THREE from "three";

export class DebugPanel {
  constructor(game) {
    this.game = game;

    // Main Panel (Right) - Player & Environment
    this.gui = new GUI({ title: "Maze Debugger", width: 300 });
    this.gui.domElement.style.position = "absolute";
    this.gui.domElement.style.top = "10px";
    this.gui.domElement.style.right = "10px";

    // Ghost Panel (Left) - Ghost Settings & Animations
    this.ghostGui = new GUI({ title: "Ghost Control", width: 300 });
    this.ghostGui.domElement.style.position = "absolute";
    this.ghostGui.domElement.style.top = "10px";
    this.ghostGui.domElement.style.left = "10px";

    this._setupPlayerPanel();
    this._setupGhostPanel(); // Uses ghostGui
    this._setupWorldPanel(); // Maze/Sandbox controls
    this._setupEnvironmentPanel();
    this._setupTorchPanel();
    this._setupExportPanel();
  }

  _setupWorldPanel() {
    const folder = this.gui.addFolder("World / Maze");
    folder.open();

    // Read sandbox mode from localStorage for persistence
    const savedSandbox = localStorage.getItem("devSandboxMode");
    const isSandbox = savedSandbox === "true" || this.game.sandboxMode;

    const params = {
      sandboxMode: isSandbox,
      mazeVisible: true,
      mazeInfo: this.game.mazeGenerator ? "Maze Active" : "Sandbox Active",
    };

    folder.add(params, "mazeInfo").name("Current Mode").disable();

    folder
      .add(params, "sandboxMode")
      .name("Sandbox Mode")
      .onChange((v) => {
        localStorage.setItem("devSandboxMode", v);
        this.game.sandboxMode = v;
        console.log("Sandbox mode:", v);
        // Offer to reload
        if (confirm("Mode changed. Reload page to apply?")) {
          location.reload();
        }
      });

    folder
      .add(params, "mazeVisible")
      .name("Show Maze Walls")
      .onChange((v) => {
        this.game.setMazeVisible(v);
      });
  }

  _setupPlayerPanel() {
    if (!this.game.player) return;

    const folder = this.gui.addFolder("Player Physics");
    const config = this.game.player.config;

    const params = {
      radius: config.radius,
      height: config.height,
      mass: config.mass,
      moveSpeed: config.speed,
      jumpHeight: config.jumpHeight || 2.0,
      rebuild: () => {
        // Update config
        this.game.player.config.radius = params.radius;
        this.game.player.config.height = params.height;
        this.game.player.config.mass = params.mass;
        this.game.player.config.speed = params.moveSpeed;
        this.game.player.config.jumpHeight = params.jumpHeight;

        // Rebuild body
        this.game.player.rebuildPhysics();
      },
    };

    folder
      .add(params, "radius", 0.1, 1.0)
      .name("Radius")
      .onChange(params.rebuild);
    folder
      .add(params, "height", 1.0, 3.0)
      .name("Height")
      .onChange(params.rebuild);
    folder.add(params, "mass", 10, 200).name("Mass").onChange(params.rebuild);
    folder
      .add(params, "moveSpeed", 1, 20)
      .name("Speed")
      .onChange((v) => (this.game.player.config.speed = v));
    folder
      .add(params, "jumpHeight", 0.5, 5.0)
      .name("Jump Height (m)")
      .onChange((v) => (this.game.player.config.jumpHeight = v));
    folder.add(params, "rebuild").name("Force Rebuild");

    const visualFolder = folder.addFolder("Visual Model Adjustment");
    const visParams = {
      offsetY: this.game.player.visualOffset.y,
      invincible: this.game.player.isInvincible,
    };

    visualFolder
      .add(visParams, "offsetY", -5, 5)
      .name("Vertical Offset")
      .onChange((v) => {
        this.game.player.visualOffset.y = v;
      });

    visualFolder
      .add(visParams, "invincible")
      .name("God Mode")
      .onChange((v) => {
        this.game.player.isInvincible = v;
      });
  }

  _setupGhostPanel() {
    // Use ghostGui for this section
    const folder = this.ghostGui.addFolder("Ghost Physics");

    const getGhost = () =>
      this.game.ghosts.length > 0 ? this.game.ghosts[0] : null;

    const params = {
      radius: 0.5,
      height: 2.0,
      rebuild: () => {
        const ghost = getGhost();
        if (ghost && ghost.rebuildPhysics) {
          ghost.radius = params.radius;
          ghost.height = params.height;
          ghost.rebuildPhysics();
        }
      },
    };

    // Update params if ghost exists
    const ghost = getGhost();
    if (ghost) {
      params.radius = ghost.radius || 0.5;
      params.height = ghost.height || 2.0;
    }

    folder
      .add(params, "radius", 0.1, 1.5)
      .name("Radius")
      .onChange(params.rebuild);
    folder
      .add(params, "height", 1.0, 4.0)
      .name("Height")
      .onChange(params.rebuild);
    folder.add(params, "rebuild").name("Force Rebuild");

    // Visual Adjustment
    const visualFolder = this.ghostGui.addFolder("Visual Model Adjustment");
    const visParams = {
      offsetY: -1.0,
    };

    if (ghost && ghost.visualOffset) {
      visParams.offsetY = ghost.visualOffset.y;
    }

    visualFolder
      .add(visParams, "offsetY", -5, 5)
      .name("Vertical Offset")
      .onChange((v) => {
        this.game.ghosts.forEach((g) => {
          if (g.visualOffset) g.visualOffset.y = v;
        });
      });

    // Animation Controls
    const animFolder = this.ghostGui.addFolder("Animation Tester");
    const animParams = {
      playIdle: () => {
        const g = getGhost();
        if (g) g._playAnimation("idle");
      },
      playWalk: () => {
        const g = getGhost();
        if (g) g._playAnimation("walk");
      },
      playRun: () => {
        const g = getGhost();
        if (g) g._playAnimation("run");
      },
      playAttack: () => {
        const g = getGhost();
        if (g) g._playAnimation("attack");
      },
    };

    animFolder.add(animParams, "playIdle").name("Play Idle");
    animFolder.add(animParams, "playWalk").name("Play Walk");
    animFolder.add(animParams, "playRun").name("Play Run");
    animFolder.add(animParams, "playAttack").name("Play Attack");

    // Monster AI Debug
    this._setupMonsterAIPanel();
  }

  _setupMonsterAIPanel() {
    const folder = this.ghostGui.addFolder("Monster AI Debug");
    folder.open();

    const getMonster = () =>
      this.game.monsters && this.game.monsters.length > 0
        ? this.game.monsters[0]
        : null;

    // AI state display (updated in animation frame)
    const aiInfo = {
      state: "N/A",
      canSee: false,
      pathLength: 0,
      memory: 0,
      noiseAlert: 0,
      speed: 0,
    };

    const stateController = folder
      .add(aiInfo, "state")
      .name("AI State")
      .disable();
    const seeController = folder
      .add(aiInfo, "canSee")
      .name("Can See Player")
      .disable();
    const pathController = folder
      .add(aiInfo, "pathLength")
      .name("Path Length")
      .disable();
    const memController = folder
      .add(aiInfo, "memory")
      .name("Memory Count")
      .disable();
    const noiseController = folder
      .add(aiInfo, "noiseAlert")
      .name("Noise Alert")
      .disable();
    const speedController = folder.add(aiInfo, "speed").name("Speed").disable();

    // Update AI info every frame
    const updateAIInfo = () => {
      const monster = getMonster();
      if (monster && monster.ai) {
        const info = monster.getAIDebugInfo();
        aiInfo.state = info.state || "N/A";
        aiInfo.canSee = info.canSeeTarget || false;
        aiInfo.pathLength = info.pathLength || 0;
        aiInfo.memory = info.memoryCount || 0;
        aiInfo.noiseAlert = parseFloat(info.noiseAlert) || 0;
        aiInfo.speed = parseFloat(info.speed) || 0;

        stateController.updateDisplay();
        seeController.updateDisplay();
        pathController.updateDisplay();
        memController.updateDisplay();
        noiseController.updateDisplay();
        speedController.updateDisplay();
      }
      requestAnimationFrame(updateAIInfo);
    };
    requestAnimationFrame(updateAIInfo);

    // Manual controls
    const controls = {
      forceChase: () => {
        const monster = getMonster();
        if (monster && monster.ai) {
          monster.ai._changeState("chase");
        }
      },
      forcePatrol: () => {
        const monster = getMonster();
        if (monster && monster.ai) {
          monster.ai._changeState("patrol");
        }
      },
      forceEnraged: () => {
        const monster = getMonster();
        if (monster && monster.ai) {
          monster.ai._changeState("enraged");
        }
      },
    };

    folder.add(controls, "forceChase").name("⚡ Force Chase");
    folder.add(controls, "forcePatrol").name("🚶 Force Patrol");
    folder.add(controls, "forceEnraged").name("😡 Force Enraged");
  }

  _setupEnvironmentPanel() {
    const folder = this.gui.addFolder("Scene & Renderer");

    // 1. Scene
    const sceneParams = {
      bgColor: "#ffffff",
      bgColor: "#ffffff",
    };

    // Background Color
    folder
      .addColor(sceneParams, "bgColor")
      .name("Background")
      .onChange((v) => {
        if (this.game.scene.instance)
          this.game.scene.instance.background = new THREE.Color(v);
        // Fog removed
      });

    // Fog

    // 2. Renderer
    const renderParams = {
      exposure: this.game.renderer.instance.toneMappingExposure,
      toneMapping: "ACESFilmic",
    };

    folder
      .add(renderParams, "exposure", 0.1, 5.0)
      .name("Exposure")
      .onChange((v) => {
        this.game.renderer.instance.toneMappingExposure = v;
      });

    // 3. Camera
    const camFolder = this.gui.addFolder("Camera");
    const camParams = {
      fov: this.game.scene.camera.fov,
      far: 2000,
    };
    camFolder
      .add(camParams, "fov", 30, 120)
      .name("FOV")
      .onChange((v) => {
        this.game.scene.camera.fov = v;
        this.game.scene.camera.updateProjectionMatrix();
      });

    // 4. Lighting (Detailed)
    const lightFolder = this.gui.addFolder("Lighting System");
    const lightParams = {
      hemiIntensity: this.game.lighting.hemiLight
        ? this.game.lighting.hemiLight.intensity
        : 0.6,
      sunIntensity: this.game.lighting.dirLight
        ? this.game.lighting.dirLight.intensity
        : 1.5,
      sunX: 50,
      sunY: 100,
      sunZ: 50,
      followPlayer: true,
    };

    lightFolder
      .add(lightParams, "hemiIntensity", 0, 2)
      .name("Ambient Intensity")
      .onChange((v) => {
        if (this.game.lighting.hemiLight)
          this.game.lighting.hemiLight.intensity = v;
      });

    lightFolder
      .add(lightParams, "sunIntensity", 0, 5)
      .name("Sun Intensity")
      .onChange((v) => {
        if (this.game.lighting.dirLight)
          this.game.lighting.dirLight.intensity = v;
      });

    // Manual Sun Position (Only works if we disable follow logic, but good for testing)
    const updateSun = () => {
      if (this.game.lighting.dirLight) {
        this.game.lighting.dirLight.position.set(
          lightParams.sunX,
          lightParams.sunY,
          lightParams.sunZ
        );
      }
    };
    lightFolder
      .add(lightParams, "sunY", 0, 200)
      .name("Sun Height")
      .onChange(updateSun);

    // 5. Audio Controls
    const audioFolder = this.gui.addFolder("Audio Controls");
    const audioParams = {
      spatialAudioEnabled: this.game.spatialAudio
        ? this.game.spatialAudio.isEnabled()
        : true,
      masterVolume: this.game.spatialAudio
        ? this.game.spatialAudio.masterVolume
        : 0.8,
      sfxVolume: this.game.spatialAudio
        ? this.game.spatialAudio.sfxVolume
        : 1.0,
      musicVolume: this.game.spatialAudio
        ? this.game.spatialAudio.musicVolume
        : 0.5,
    };

    audioFolder
      .add(audioParams, "spatialAudioEnabled")
      .name("🔊 Spatial Audio")
      .onChange((v) => {
        if (this.game.spatialAudio) {
          if (v) {
            this.game.spatialAudio.enable();
          } else {
            this.game.spatialAudio.disable();
          }
        }
      });

    audioFolder
      .add(audioParams, "masterVolume", 0, 1)
      .name("Master Volume")
      .onChange((v) => {
        if (this.game.spatialAudio) {
          this.game.spatialAudio.setMasterVolume(v);
        }
      });

    audioFolder
      .add(audioParams, "sfxVolume", 0, 1)
      .name("SFX Volume")
      .onChange((v) => {
        if (this.game.spatialAudio) {
          this.game.spatialAudio.setSfxVolume(v);
        }
      });

    audioFolder
      .add(audioParams, "musicVolume", 0, 1)
      .name("Music Volume")
      .onChange((v) => {
        if (this.game.spatialAudio) {
          this.game.spatialAudio.setMusicVolume(v);
        }
      });

    // Test buttons
    const audioActions = {
      initAudio: () => {
        if (this.game.spatialAudio) {
          console.log("[Debug] Manually triggering audio init...");
          // Trigger a fake click to initialize audio
          document.dispatchEvent(new MouseEvent("click"));
        }
      },
      testClick: () => {
        if (this.game.spatialAudio && this.game.spatialAudio.initialized) {
          this.game.spatialAudio.playClick();
          console.log("[Debug] Played click sound");
        } else {
          console.log(
            "[Debug] Audio not initialized yet - click anywhere first"
          );
        }
      },
      testFootstep: () => {
        if (this.game.spatialAudio && this.game.spatialAudio.initialized) {
          this.game.spatialAudio.playFootstep();
          console.log("[Debug] Played footstep sound");
        } else {
          console.log(
            "[Debug] Audio not initialized yet - click anywhere first"
          );
        }
      },
      testGhostMoan: () => {
        if (this.game.spatialAudio && this.game.spatialAudio.initialized) {
          this.game.spatialAudio.playSound("moan", 1.0);
          console.log("[Debug] Played ghost moan");
        } else {
          console.log(
            "[Debug] Audio not initialized yet - click anywhere first"
          );
        }
      },
      startMusic: () => {
        if (this.game.spatialAudio && this.game.spatialAudio.initialized) {
          this.game.spatialAudio.startAmbientMusic();
          console.log("[Debug] Started ambient music");
        } else {
          console.log(
            "[Debug] Audio not initialized yet - click anywhere first"
          );
        }
      },
    };

    audioFolder.add(audioActions, "initAudio").name("🔧 Init Audio");
    audioFolder.add(audioActions, "testClick").name("🔊 Test Click");
    audioFolder.add(audioActions, "testFootstep").name("👣 Test Footstep");
    audioFolder.add(audioActions, "testGhostMoan").name("👻 Test Ghost Moan");
    audioFolder.add(audioActions, "startMusic").name("🎵 Start Music");
  }

  _setupFogPanel() {
    if (!this.game.fogSystem) return;

    const folder = this.gui.addFolder("💨 Ground Smoke");
    folder.open();

    const fog = this.game.fogSystem;
    const config = fog.getConfig();

    // Toggle
    folder
      .add({ enabled: fog.enabled }, "enabled")
      .name("🔘 Enable")
      .onChange((v) => {
        if (v !== fog.enabled) fog.toggle();
      });

    // === APPEARANCE ===
    const appearFolder = folder.addFolder("👁️ Appearance");
    appearFolder
      .add({ opacity: config.opacity }, "opacity", 0.1, 0.8)
      .name("Opacity")
      .step(0.05)
      .onChange((v) => fog.setOpacity(v));

    // === ANIMATION ===
    const animFolder = folder.addFolder("🌀 Animation");
    animFolder
      .add({ rotation: config.rotationSpeed }, "rotation", 0.01, 0.5)
      .name("Rotation Speed")
      .step(0.01)
      .onChange((v) => fog.setRotationSpeed(v));

    animFolder
      .add({ drift: config.windSpeed }, "drift", 0.1, 5.0)
      .name("Wind Speed")
      .step(0.1)
      .onChange((v) => fog.setSpeed(v));

    // === COLOR ===
    folder
      .addColor({ color: "#" + config.smokeColor.getHexString() }, "color")
      .name("🎨 Color")
      .onChange((v) => fog.setColor(v));

    // === INFO ===
    folder
      .add({ particles: config.particleCount }, "particles")
      .name("Particles")
      .disable();

    // === EXPORT ===
    folder
      .add(
        {
          export: () => {
            const c = fog.getConfig();
            console.log("=== SMOKE CONFIG ===");
            console.log(
              JSON.stringify(
                {
                  particleCount: c.particleCount,
                  particleSize: c.particleSize,
                  opacity: c.opacity,
                  rotationSpeed: c.rotationSpeed,
                  driftSpeed: c.driftSpeed,
                  color: "#" + c.smokeColor.getHexString(),
                },
                null,
                2
              )
            );
            alert("Config exported to console!");
          },
        },
        "export"
      )
      .name("📋 Export");
  }

  _setupExportPanel() {
    const folder = this.gui.addFolder("Export Config");
    const params = {
      copyJSON: () => {
        const data = {
          player: {
            radius: this.game.player.config.radius,
            height: this.game.player.config.height,
            mass: this.game.player.config.mass,
            speed: this.game.player.config.speed,
          },
          ghost: {
            radius: this.game.ghosts[0]?.radius,
            height: this.game.ghosts[0]?.height,
          },
        };
        const json = JSON.stringify(data, null, 2);

        // Handle clipboard API with fallback for non-HTTPS
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(json)
            .then(() => {
              alert("Config copied to clipboard!");
            })
            .catch((err) => {
              console.log("Clipboard API failed, logging instead:", json);
              alert(
                "Exported to console (clipboard not available in this context)"
              );
            });
        } else {
          console.log("Exported Config (clipboard not available):", json);
          alert("Config logged to console (clipboard requires HTTPS)");
        }
      },
    };
    folder.add(params, "copyJSON").name("Copy to Clipboard");
  }

  _setupTorchPanel() {
    const folder = this.gui.addFolder("💡 Light System");
    folder.open();

    // ==========================================
    // LIGHT MODE TOGGLE (Flashlight vs Torch)
    // ==========================================
    const modeParams = {
      lightMode: this.game.lightMode || "flashlight",
    };

    folder
      .add(modeParams, "lightMode", ["flashlight", "torch"])
      .name("🔄 Light Mode")
      .onChange((v) => {
        this.game.switchLightMode(v);
      });

    // ==========================================
    // TORCH SETTINGS (Only show if torch exists)
    // ==========================================
    if (!this.game.torch) return;

    const torchFolder = folder.addFolder("🔥 Torch Settings");
    const torch = this.game.torch;
    const config = torch.config;

    // ==========================================
    // POSITION CONTROLS
    // ==========================================
    const posFolder = torchFolder.addFolder("📍 Position");
    posFolder.open();

    const posParams = {
      offsetX: config.offsetX,
      offsetY: config.offsetY,
      offsetZ: config.offsetZ,
      tiltX: config.tiltX,
    };

    posFolder
      .add(posParams, "offsetX", -1.5, 1.5)
      .name("X (Left/Right)")
      .step(0.05)
      .onChange((v) => {
        config.offsetX = v;
        torch.torchGroup.position.x = v;
      });

    posFolder
      .add(posParams, "offsetY", -1.5, 0.5)
      .name("Y (Up/Down)")
      .step(0.05)
      .onChange((v) => {
        config.offsetY = v;
        torch.torchGroup.position.y = v;
      });

    posFolder
      .add(posParams, "offsetZ", -2.0, 0.5)
      .name("Z (Forward/Back)")
      .step(0.05)
      .onChange((v) => {
        config.offsetZ = v;
        torch.torchGroup.position.z = v;
      });

    posFolder
      .add(posParams, "tiltX", -1.5, 1.5)
      .name("Tilt")
      .step(0.05)
      .onChange((v) => {
        config.tiltX = v;
        torch.torchGroup.rotation.x = v;
      });

    // ==========================================
    // LIGHT CONTROLS
    // ==========================================
    const lightFolder = torchFolder.addFolder("💡 Light");

    const lightParams = {
      isOn: torch.isOn,
      intensity: config.lightBaseIntensity,
      flickerSpeed: config.lightFlickerSpeed,
      flickerAmp: config.lightFlickerAmp,
      distance: config.lightDistance,
      color: config.lightColor,
    };

    lightFolder
      .add(lightParams, "isOn")
      .name("Toggle On/Off")
      .onChange((v) => torch.setEnabled(v));

    lightFolder
      .add(lightParams, "intensity", 0, 100)
      .name("Intensity")
      .onChange((v) => {
        config.lightBaseIntensity = v;
      });

    lightFolder
      .add(lightParams, "flickerAmp", 0, 30)
      .name("Flicker Amount")
      .onChange((v) => {
        config.lightFlickerAmp = v;
      });

    lightFolder
      .add(lightParams, "flickerSpeed", 0, 2)
      .name("Flicker Speed")
      .onChange((v) => {
        config.lightFlickerSpeed = v;
      });

    lightFolder
      .add(lightParams, "distance", 5, 30)
      .name("Range")
      .onChange((v) => {
        config.lightDistance = v;
        if (torch.light) torch.light.distance = v;
      });

    lightFolder
      .addColor(lightParams, "color")
      .name("Color")
      .onChange((v) => {
        config.lightColor = v;
        if (torch.light) torch.light.color.set(v);
      });

    // ==========================================
    // FIRE PHYSICS
    // ==========================================
    const physicsFolder = torchFolder.addFolder("🌪️ Fire Physics");

    const physicsParams = {
      swayAmount: config.swayAmount,
      fireDragStrength: config.fireDragStrength,
    };

    physicsFolder
      .add(physicsParams, "swayAmount", 0, 0.5)
      .name("Torch Sway")
      .step(0.01)
      .onChange((v) => {
        config.swayAmount = v;
      });

    physicsFolder
      .add(physicsParams, "fireDragStrength", 0, 3)
      .name("Fire Drag")
      .step(0.1)
      .onChange((v) => {
        config.fireDragStrength = v;
      });

    // ==========================================
    // FIRE COLORS
    // ==========================================
    const colorFolder = torchFolder.addFolder("🎨 Fire Colors");

    const colorParams = {
      coreIntensity: config.fireCoreIntensity,
      midIntensity: config.fireMidIntensity,
      edgeIntensity: config.fireEdgeIntensity,
    };

    colorFolder
      .add(colorParams, "coreIntensity", 0, 5)
      .name("Core Brightness")
      .step(0.1)
      .onChange((v) => {
        config.fireCoreIntensity = v;
        torch._updateFireColors();
      });

    colorFolder
      .add(colorParams, "midIntensity", 0, 5)
      .name("Mid Brightness")
      .step(0.1)
      .onChange((v) => {
        config.fireMidIntensity = v;
        torch._updateFireColors();
      });

    colorFolder
      .add(colorParams, "edgeIntensity", 0, 3)
      .name("Edge Brightness")
      .step(0.1)
      .onChange((v) => {
        config.fireEdgeIntensity = v;
        torch._updateFireColors();
      });

    // ==========================================
    // EXPORT
    // ==========================================
    const exportObj = {
      exportConfig: () => {
        const exportData = {
          offsetX: config.offsetX,
          offsetY: config.offsetY,
          offsetZ: config.offsetZ,
          tiltX: config.tiltX,
          swayAmount: config.swayAmount,
          fireDragStrength: config.fireDragStrength,
          lightBaseIntensity: config.lightBaseIntensity,
          lightFlickerAmp: config.lightFlickerAmp,
          lightDistance: config.lightDistance,
        };
        console.log("=== TORCH CONFIG EXPORT ===");
        console.log(JSON.stringify(exportData, null, 2));
        alert("Torch config exported to console (F12)!");
      },
    };

    torchFolder.add(exportObj, "exportConfig").name("📋 Export to Console");
  }

  dispose() {
    if (this.gui) this.gui.destroy();
    if (this.ghostGui) this.ghostGui.destroy();
  }
}
