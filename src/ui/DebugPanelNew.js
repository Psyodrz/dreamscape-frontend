/**
 * DebugPanelNew.js
 * Replaces the old lil-gui DebugPanel with a deeply integrated One-Inspector UI.
 * Uses the LegacyInspector's "Parameters" system.
 */
export class DebugPanelNew {
  constructor(game) {
    this.game = game;
    this.inspector = game.inspector;

    if (!this.inspector) {
      console.warn("DebugPanelNew: Inspector not found!");
      return;
    }

    console.log("DebugPanelNew: Initializing Inspector Parameters...");

    this._setupWorldPanel();
    this._setupPlayerPanel();
    this._setupGhostPanel();
    this._setupEnvironmentPanel();
    this._setupAudioPanel();
    this._setupTorchPanel();
    this._setupFogPanel();
    this._setupExportPanel();
  }

  // --- Helper to mimic lil-gui syntax ---
  _add(folder, obj, prop, ...args) {
    let item = null;
    const value = obj[prop];

    // Polyfill: Parameters.js doesn't support strings directly.
    // Convert strings to a single-option Select to make them visible (read-only-ish)
    if (typeof value === "string" && args.length === 0) {
      const options = {};
      options[value] = value;
      item = folder.add(obj, prop, options);
    } else {
      item = folder.add(obj, prop, ...args);
    }

    // Wrapper to allow chaining .name() and .onChange()
    const wrapper = {
      name: (n) => {
        if (item && item.name) item.name(n);
        return wrapper;
      },
      onChange: (fn) => {
        if (item) item.addEventListener("change", (e) => fn(e.value));
        return wrapper;
      },
      listen: () => {
        if (item && item.listen) item.listen();
        return wrapper;
      },
      disable: () => {
        if (item && item.domElement) {
          item.domElement.style.opacity = "0.5";
          item.domElement.style.pointerEvents = "none";
        }
        return wrapper;
      },
      item: item,
    };
    return wrapper;
  }

  _addColor(folder, obj, prop) {
    // Manual call for color if auto-detection fails, but folder.add usually handles it
    // if value is hex or object. Parameters.js has addColor() method.
    const item = folder.addColor(obj, prop);
    const wrapper = {
      name: (n) => {
        if (item.name) item.name(n);
        return wrapper;
      },
      onChange: (fn) => {
        item.addEventListener("change", (e) => fn(e.value));
        return wrapper;
      },
    };
    return wrapper;
  }

  _addFolder(parent, name) {
    return parent.addFolder(name);
  }

  // ===================================
  // Panels
  // ===================================

  _setupWorldPanel() {
    const folder = this.inspector.createParameters("World / Maze");

    // Persisted Sandbox Mode
    const savedSandbox = localStorage.getItem("devSandboxMode");
    const isSandbox = savedSandbox === "true" || this.game.sandboxMode;

    const params = {
      sandboxMode: isSandbox,
      mazeVisible: true,
      mazeInfo: this.game.mazeGenerator ? "Maze Active" : "Sandbox Active",
    };

    // Info (Disabled Text)
    this._add(folder, params, "mazeInfo").name("Current Mode").disable();

    this._add(folder, params, "sandboxMode")
      .name("Sandbox Mode")
      .onChange((v) => {
        localStorage.setItem("devSandboxMode", v);
        this.game.sandboxMode = v;
        if (confirm("Mode changed. Reload page to apply?")) location.reload();
      });

    this._add(folder, params, "mazeVisible")
      .name("Show Maze Walls")
      .onChange((v) => {
        this.game.setMazeVisible(v);
      });
  }

  _setupPlayerPanel() {
    if (!this.game.player) return;
    const folder = this.inspector.createParameters("Player Physics");

    const config = this.game.player.config;
    const params = {
      radius: config.radius,
      height: config.height,
      mass: config.mass,
      moveSpeed: config.speed,
      jumpHeight: config.jumpHeight || 2.0,
      rebuild: () => {
        this.game.player.config.radius = params.radius;
        this.game.player.config.height = params.height;
        this.game.player.config.mass = params.mass;
        this.game.player.rebuildPhysics();
      },
    };

    this._add(folder, params, "radius", 0.1, 1.0)
      .name("Radius")
      .onChange(params.rebuild);
    this._add(folder, params, "height", 1.0, 3.0)
      .name("Height")
      .onChange(params.rebuild);
    this._add(folder, params, "mass", 10, 200)
      .name("Mass")
      .onChange(params.rebuild);

    // Direct manipulation
    this._add(folder, params, "moveSpeed", 1, 20)
      .name("Speed")
      .onChange((v) => (this.game.player.config.speed = v));
    this._add(folder, params, "jumpHeight", 0.5, 10.0)
      .name("Jump Height")
      .onChange((v) => (this.game.player.config.jumpHeight = v));

    this._add(folder, params, "rebuild").name("⚠️ Force Rebuild Body");

    // Visuals
    const sub = folder.addFolder("Visual Adjustments");
    const visParams = {
      offsetY: this.game.player.visualOffset.y,
      invincible: this.game.player.isInvincible || false,
    };
    this._add(sub, visParams, "offsetY", -2, 2)
      .name("Y Offset")
      .onChange((v) => (this.game.player.visualOffset.y = v));
    this._add(sub, visParams, "invincible")
      .name("God Mode")
      .onChange((v) => (this.game.player.isInvincible = v));
  }

  _setupGhostPanel() {
    const folder = this.inspector.createParameters("Ghost Control");

    // Helper to get first ghost
    const getGhost = () =>
      this.game.ghosts.length > 0 ? this.game.ghosts[0] : null;
    const ghost = getGhost();

    const params = {
      radius: ghost ? ghost.radius || 0.5 : 0.5,
      height: ghost ? ghost.height || 2.0 : 2.0,
      rebuild: () => {
        const g = getGhost();
        if (g) {
          g.radius = params.radius;
          g.height = params.height;
          g.rebuildPhysics();
        }
      },
    };

    this._add(folder, params, "radius", 0.1, 1.5)
      .name("Radius")
      .onChange(params.rebuild);
    this._add(folder, params, "height", 1.0, 4.0)
      .name("Height")
      .onChange(params.rebuild);

    // Animations
    const animFolder = folder.addFolder("Animations");
    const animParams = {
      idle: () => getGhost()?._playAnimation("idle"),
      walk: () => getGhost()?._playAnimation("walk"),
      run: () => getGhost()?._playAnimation("run"),
      attack: () => getGhost()?._playAnimation("attack"),
    };

    this._add(animFolder, animParams, "idle").name("Play Idle");
    this._add(animFolder, animParams, "walk").name("Play Walk");
    this._add(animFolder, animParams, "run").name("Play Run");
    this._add(animFolder, animParams, "attack").name("Play Attack");

    // AI Debug
    this._setupMonsterAIPanel(folder);
  }

  _setupMonsterAIPanel(parentFolder) {
    const folder = parentFolder.addFolder("AI Debug");

    const aiInfo = {
      state: "N/A",
      canSee: false,
      pathLen: 0,
      memory: 0,
      noise: 0,
      speed: 0,
    };

    this._add(folder, aiInfo, "state").name("State").disable();
    this._add(folder, aiInfo, "canSee").name("Can See Player").disable();
    this._add(folder, aiInfo, "pathLen").name("Path Length").disable();
    this._add(folder, aiInfo, "memory").name("Memory Count").disable();
    this._add(folder, aiInfo, "noise").name("Noise Level").disable();
    this._add(folder, aiInfo, "speed").name("Speed").disable();

    // Update Loop
    const updateAI = () => {
      const g = (this.game.ghosts && this.game.ghosts[0]) || null;
      const m = (this.game.monsters && this.game.monsters[0]) || g;

      if (m && m.ai) {
        const info = m.getAIDebugInfo
          ? m.getAIDebugInfo()
          : { state: m.ai.currentState };
        aiInfo.state = info.state || "N/A";
        aiInfo.canSee = info.canSeeTarget || false;
        aiInfo.pathLen = info.pathLength || 0;
        aiInfo.memory = info.memoryCount || 0;
        aiInfo.noise = parseFloat(info.noiseAlert || 0).toFixed(2);
        aiInfo.speed = parseFloat(info.speed || 0).toFixed(2);
      }
      requestAnimationFrame(updateAI);
    };
    requestAnimationFrame(updateAI);

    // Manual Controls
    const controls = {
      forceChase: () => {
        const m = this.game.ghosts[0];
        if (m?.ai) m.ai._changeState("chase");
      },
      forcePatrol: () => {
        const m = this.game.ghosts[0];
        if (m?.ai) m.ai._changeState("patrol");
      },
      forceEnraged: () => {
        const m = this.game.ghosts[0];
        if (m?.ai) m.ai._changeState("enraged");
      },
    };
    this._add(folder, controls, "forceChase").name("⚡ Force Chase");
    this._add(folder, controls, "forcePatrol").name("🚶 Force Patrol");
    this._add(folder, controls, "forceEnraged").name("😡 Force Enraged");
  }

  _setupEnvironmentPanel() {
    const folder = this.inspector.createParameters("Environment");

    // Camera
    const camFolder = folder.addFolder("Camera");
    const camParams = {
      fov: this.game.scene.camera.fov,
      far: 2000,
    };
    this._add(camFolder, camParams, "fov", 30, 120)
      .name("FOV")
      .onChange((v) => {
        this.game.scene.camera.fov = v;
        this.game.scene.camera.updateProjectionMatrix();
      });

    // Lighting
    const lightFolder = folder.addFolder("Lighting System");
    const lightParams = {
      sunIntensity: this.game.lighting.dirLight
        ? this.game.lighting.dirLight.intensity
        : 1.5,
      hemiIntensity: this.game.lighting.hemiLight
        ? this.game.lighting.hemiLight.intensity
        : 0.6,
      sunX: 50,
      sunY: 100,
      sunZ: 50,
    };

    this._add(lightFolder, lightParams, "sunIntensity", 0, 5)
      .name("Sun Intensity")
      .onChange((v) => {
        if (this.game.lighting.dirLight)
          this.game.lighting.dirLight.intensity = v;
      });
    this._add(lightFolder, lightParams, "hemiIntensity", 0, 2)
      .name("Ambient Intensity")
      .onChange((v) => {
        if (this.game.lighting.hemiLight)
          this.game.lighting.hemiLight.intensity = v;
      });

    const updateSun = () => {
      if (this.game.lighting.dirLight) {
        this.game.lighting.dirLight.position.set(
          lightParams.sunX,
          lightParams.sunY,
          lightParams.sunZ,
        );
      }
    };
    this._add(lightFolder, lightParams, "sunY", 0, 200)
      .name("Sun Height (Y)")
      .onChange(updateSun);
    // Extra controls user might want since "Sun Position" was requested
    this._add(lightFolder, lightParams, "sunX", -100, 100)
      .name("Sun X")
      .onChange(updateSun);
    this._add(lightFolder, lightParams, "sunZ", -100, 100)
      .name("Sun Z")
      .onChange(updateSun);

    // Renderer
    const renderFolder = folder.addFolder("Renderer");
    const renderParams = {
      exposure: this.game.renderer.instance.toneMappingExposure,
      bgColor: "#ffffff",
    };

    this._add(renderFolder, renderParams, "exposure", 0.1, 5.0)
      .name("Exposure")
      .onChange((v) => {
        this.game.renderer.instance.toneMappingExposure = v;
      });

    this._addColor(renderFolder, renderParams, "bgColor")
      .name("Background Color")
      .onChange((v) => {
        if (this.game.scene.instance)
          this.game.scene.instance.background = new THREE.Color(v);
      });
  }

  _setupAudioPanel() {
    const folder = this.inspector.createParameters("Audio");

    const params = {
      spatialAudioEnabled: this.game.spatialAudio
        ? this.game.spatialAudio.isEnabled()
        : true,
      master: 0.8,
      sfx: 1.0,
      music: 0.5,
    };

    if (this.game.spatialAudio) {
      params.master = this.game.spatialAudio.masterVolume;
      params.sfx = this.game.spatialAudio.sfxVolume;
      params.music = this.game.spatialAudio.musicVolume;
    }

    this._add(folder, params, "spatialAudioEnabled")
      .name("🔊 Spatial Audio")
      .onChange((v) => {
        if (this.game.spatialAudio)
          v
            ? this.game.spatialAudio.enable()
            : this.game.spatialAudio.disable();
      });

    this._add(folder, params, "master", 0, 1)
      .name("Master Volume")
      .onChange((v) => this.game.spatialAudio?.setMasterVolume(v));
    this._add(folder, params, "sfx", 0, 1)
      .name("SFX Volume")
      .onChange((v) => this.game.spatialAudio?.setSfxVolume(v));
    this._add(folder, params, "music", 0, 1)
      .name("Music Volume")
      .onChange((v) => this.game.spatialAudio?.setMusicVolume(v));

    const actions = {
      testStep: () => this.game.spatialAudio?.playFootstep(),
      testClick: () => this.game.spatialAudio?.playClick(),
      initAudio: () => document.dispatchEvent(new MouseEvent("click")), // Hack trigger
      startMusic: () => this.game.spatialAudio?.startAmbientMusic(),
      testMoan: () => this.game.spatialAudio?.playSound("moan", 1.0),
    };

    const testFolder = folder.addFolder("Test Actions");
    this._add(testFolder, actions, "initAudio").name("🔧 Init Audio");
    this._add(testFolder, actions, "testStep").name("Test Footstep");
    this._add(testFolder, actions, "testClick").name("Test Click");
    this._add(testFolder, actions, "testMoan").name("Test Ghost Moan");
    this._add(testFolder, actions, "startMusic").name("Start Music");
  }

  _setupTorchPanel() {
    const folder = this.inspector.createParameters("Torch / Light");

    // Light Mode
    const modeParams = { lightMode: this.game.lightMode || "flashlight" };
    // Parameters.js doesn't built-in support dropdown from array like lil-gui.
    // But we can use our Polyfill for strings if we pass options object.
    // Or explicitly use options object: { 'Flashlight': 'flashlight', ... }
    const modeOptions = { Flashlight: "flashlight", Torch: "torch" };

    this._add(folder, modeParams, "lightMode", modeOptions)
      .name("Light Mode")
      .onChange((v) => this.game.switchLightMode(v));

    if (!this.game.torch) return;
    const torch = this.game.torch;
    const config = torch.config;

    const subFolder = folder.addFolder("Torch Settings");

    // Position
    const posParams = {
      x: config.offsetX,
      y: config.offsetY,
      z: config.offsetZ,
      tilt: config.tiltX,
    };
    const posFolder = subFolder.addFolder("Position");
    this._add(posFolder, posParams, "x", -1.5, 1.5)
      .name("Left/Right")
      .onChange((v) => {
        config.offsetX = v;
        torch.torchGroup.position.x = v;
      });
    this._add(posFolder, posParams, "y", -1.5, 0.5)
      .name("Up/Down")
      .onChange((v) => {
        config.offsetY = v;
        torch.torchGroup.position.y = v;
      });
    this._add(posFolder, posParams, "z", -2.0, 0.5)
      .name("Fwd/Back")
      .onChange((v) => {
        config.offsetZ = v;
        torch.torchGroup.position.z = v;
      });
    this._add(posFolder, posParams, "tilt", -1.5, 1.5)
      .name("Tilt")
      .onChange((v) => {
        config.tiltX = v;
        torch.torchGroup.rotation.x = v;
      });

    // Light Props
    const lightFolder = subFolder.addFolder("Light Props");
    const lightParams = {
      intensity: config.lightBaseIntensity,
      flicker: config.lightFlickerAmp,
      range: config.lightDistance,
      color: config.lightColor,
    };
    this._add(lightFolder, lightParams, "intensity", 0, 100)
      .name("Intensity")
      .onChange((v) => (config.lightBaseIntensity = v));
    this._add(lightFolder, lightParams, "flicker", 0, 30)
      .name("Flicker Amp")
      .onChange((v) => (config.lightFlickerAmp = v));
    this._add(lightFolder, lightParams, "range", 5, 30)
      .name("Range")
      .onChange((v) => {
        config.lightDistance = v;
        if (torch.light) torch.light.distance = v;
      });
    this._addColor(lightFolder, lightParams, "color")
      .name("Color")
      .onChange((v) => {
        config.lightColor = v;
        if (torch.light) torch.light.color.set(v);
      });

    // Physics
    const physFolder = subFolder.addFolder("Physics");
    const physParams = {
      sway: config.swayAmount,
      drag: config.fireDragStrength,
    };
    this._add(physFolder, physParams, "sway", 0, 0.5)
      .name("Sway Amount")
      .onChange((v) => (config.swayAmount = v));
    this._add(physFolder, physParams, "drag", 0, 3.0)
      .name("Fire Drag")
      .onChange((v) => (config.fireDragStrength = v));
  }

  _setupFogPanel() {
    if (!this.game.fogSystem) return;
    const folder = this.inspector.createParameters("Ground Smoke");
    const fog = this.game.fogSystem;
    const config = fog.getConfig();

    const params = {
      enabled: fog.enabled,
      opacity: config.opacity,
      rotation: config.rotationSpeed,
      wind: config.windSpeed,
      color: "#" + config.smokeColor.getHexString(),
    };

    this._add(folder, params, "enabled")
      .name("Enable")
      .onChange((v) => {
        if (v !== fog.enabled) fog.toggle();
      });
    this._add(folder, params, "opacity", 0, 1)
      .name("Opacity")
      .onChange((v) => fog.setOpacity(v));
    this._add(folder, params, "rotation", 0, 1)
      .name("Rotation Spd")
      .onChange((v) => fog.setRotationSpeed(v));
    this._add(folder, params, "wind", 0, 5)
      .name("Wind Speed")
      .onChange((v) => fog.setSpeed(v));
    this._addColor(folder, params, "color")
      .name("Color")
      .onChange((v) => fog.setColor(v));
  }

  _setupExportPanel() {
    const folder = this.inspector.createParameters("Export Config");
    const actions = {
      copy: () => {
        const data = {
          player: { ...this.game.player.config },
          ghost: { ...this.game.ghosts[0]?.radius }, // Simplified
        };
        const json = JSON.stringify(data, null, 2);
        if (navigator.clipboard) {
          navigator.clipboard
            .writeText(json)
            .then(() => alert("Copied to clipboard!"));
        } else {
          console.log(json);
          alert("Logged to console");
        }
      },
    };
    this._add(folder, actions, "copy").name("Copy Config JSON");
  }
}
