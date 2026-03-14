import { Profiler } from "three/addons/inspector/ui/Profiler.js";
import { Performance } from "three/addons/inspector/tabs/Performance.js";
import { Console } from "three/addons/inspector/tabs/Console.js";
import { Graph } from "three/addons/inspector/ui/Graph.js"; // Import Graph
import { Parameters } from "three/addons/inspector/tabs/Parameters.js"; // Import Parameters
import { setText } from "three/addons/inspector/ui/utils.js";

/**
 * LegacyInspector
 * ...
 */
export class LegacyInspector {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // --- Core UI Components from the official Inspector ---
    this.profiler = new Profiler();
    this.domElement = this.profiler.domElement;

    // 0. Parameters Tab (Generic inputs)
    this.parameters = new Parameters({
      builtin: true,
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M4 6l8 0" /><path d="M16 6l4 0" /><path d="M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M4 12l2 0" /><path d="M10 12l10 0" /><path d="M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M4 18l11 0" /><path d="M19 18l1 0" /></svg>',
    });
    this.parameters.hide(); // Hide until createParameters is called
    this.profiler.addTab(this.parameters);

    // 1. Performance Tab
    this.performanceTab = new Performance();
    this.profiler.addTab(this.performanceTab);
    this.profiler.setActiveTab(this.performanceTab.id);

    // --- CUSTOM GRAPHS ---
    const graphContainer =
      this.performanceTab.content.querySelector(".graph-container");
    if (graphContainer) {
      // Helper to create labelled graph
      const createGraph = (id, colorVar, label) => {
        const wrapper = document.createElement("div");
        wrapper.style.position = "relative";
        wrapper.style.marginTop = "4px";
        wrapper.style.height = "40px";
        wrapper.style.background = "#111";
        wrapper.style.borderRadius = "3px";

        const graph = new Graph();
        graph.addLine(id, colorVar);
        graph.domElement.style.position = "absolute";
        graph.domElement.style.top = "0";
        graph.domElement.style.left = "0";
        graph.domElement.style.width = "100%";
        graph.domElement.style.height = "100%";
        // Restore default fill opacity
        graph.domElement.style.opacity = "0.8";

        const text = document.createElement("div");
        text.style.position = "absolute";
        text.style.top = "2px";
        text.style.left = "4px";
        text.style.fontSize = "10px";
        text.style.fontFamily = "monospace";
        text.style.color = `var(${colorVar})`;
        text.style.textShadow = "0 1px 2px #000";
        text.style.pointerEvents = "none";
        text.textContent = label;

        wrapper.appendChild(graph.domElement);
        wrapper.appendChild(text);
        graphContainer.appendChild(wrapper);

        return { graph, text };
      };

      // 1. MS Graph (Latency) - Green
      const msData = createGraph("ms", "--color-green", "0 MS");
      this.msGraph = msData.graph;
      this.msLabel = msData.text;

      // 2. Memory Graph (MB) - Blue
      const memData = createGraph("mem", "--color-blue", "0 MB");
      this.memGraph = memData.graph;
      this.memLabel = memData.text;

      // Inject Styles (Updated)
      // We removed the 'fill: none' rule to allow filled area graphs (standard Inspector style)
      // Added some tweaks for graph-svg to ensure it fits the new container
      const style = document.createElement("style");
      style.textContent = `
            .graph-svg { display: block; width: 100%; height: 100%; }
            .graph-path { vector-effect: non-scaling-stroke; stroke-width: 1; }
        `;
      this.domElement.appendChild(style);
    }

    // 2. Console Tab (for logs)
    this.consoleTab = new Console();
    this.profiler.addTab(this.consoleTab);

    // Hook console to capture logs
    this._hookConsole();

    // Attachment
    this.domElement = this.profiler.domElement;
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.appendChild(this.domElement);
    } else {
      document.body.appendChild(this.domElement);
    }

    // --- State ---
    this.fps = 60;
    this.lastTime = performance.now();
    this.frameCount = 0;

    // Mock data structures expected by Performance.js
    this.statsData = new Map();

    // Custom Update Loop (since we don't have renderer.backend hooks)
    this._updateLoop();

    this.consoleTab.addMessage(
      "info",
      "LegacyInspector initialized for WebGLRenderer.",
    );
  }

  _hookConsole() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    // Filter patterns to ignore in Inspector UI
    const IGNORE_PATTERNS = [
      "THREE.WebGLTextures",
      "Trying to use",
      "[TextureEngine] Cache hit", // Too verbose
      "render", // Generic render loops
    ];

    const shouldLog = (args) => {
      const str = args.map(String).join(" ");
      return !IGNORE_PATTERNS.some((pattern) => str.includes(pattern));
    };

    console.log = (...args) => {
      if (shouldLog(args))
        this.consoleTab.addMessage("info", args.map(String).join(" "));
      originalLog.apply(console, args);
    };
    console.warn = (...args) => {
      if (shouldLog(args))
        this.consoleTab.addMessage("warn", args.map(String).join(" "));
      originalWarn.apply(console, args);
    };
    console.error = (...args) => {
      if (shouldLog(args))
        this.consoleTab.addMessage("error", args.map(String).join(" "));
      originalError.apply(console, args);
    };
  }

  _updateLoop() {
    requestAnimationFrame(() => this._updateLoop());

    const now = performance.now();
    const delta = now - this.lastTime;

    if (delta >= 1000) {
      this.fps = (this.frameCount * 1000) / delta;
      this.frameCount = 0;
      this.lastTime = now;

      // Update FPS Text in Shell
      const fpsEl = this.domElement.querySelector("#fps-counter");
      if (fpsEl) {
        setText(fpsEl, Math.round(this.fps));
      }
    }
    this.frameCount++;

    // Update Performance Graph
    this.performanceTab.updateGraph(this);

    // Update Custom Graphs
    if (this.msGraph && this.lastTime > 0) {
      // Latency
      const latency = this.fps > 0 ? 1000 / this.fps : 0;
      this.msGraph.addPoint("ms", latency);
      this.msGraph.update();
      if (this.msLabel) this.msLabel.textContent = latency.toFixed(1) + " MS";
    }

    if (this.memGraph && performance && performance.memory) {
      // Memory
      const mb = performance.memory.usedJSHeapSize / 1048576;
      this.memGraph.addPoint("mb", mb);
      this.memGraph.update();
      if (this.memLabel) this.memLabel.textContent = Math.round(mb) + " MB";
    }

    // Update Stats List
    this._updateStatsUI();
  }

  _updateStatsUI() {
    // Mock a "Frame" object
    // IMPORTANT: 'children' must be empty initially, populated below
    const frame = {
      cpu: 0, // Global CPU time (not really tracked for WebGL, can use frame start/end)
      gpu: 0,
      total: 0,
      miscellaneous: 16.6,
      children: [],
    };

    // Extract Info from WebGLRenderer
    const info = this.renderer.info;
    if (info) {
      // We must pass 'frame' as the parent so that Performance.js
      // can do frame.children.indexOf(stat) successfully.

      frame.children.push(
        this._createStatItem("calls", "Draw Calls", info.render.calls, frame),
      );
      frame.children.push(
        this._createStatItem(
          "triangles",
          "Triangles",
          info.render.triangles,
          frame,
        ),
      );
      frame.children.push(
        this._createStatItem(
          "geometries",
          "Geometries",
          info.memory.geometries,
          frame,
        ),
      );
      frame.children.push(
        this._createStatItem(
          "textures",
          "Textures",
          info.memory.textures,
          frame,
        ),
      );

      // --- NEW STATS ---
      // Frame Latency (ms)
      const latency = this.fps > 0 ? (1000 / this.fps).toFixed(1) : 0;
      frame.children.push(
        this._createStatItem(
          "latency",
          "Frame Time (ms)",
          parseFloat(latency),
          frame,
        ),
      );

      // JS Memory (Chrome Only)
      if (performance && performance.memory) {
        const memObj = performance.memory;
        const usedMB = (memObj.usedJSHeapSize / 1048576).toFixed(1);
        frame.children.push(
          this._createStatItem(
            "memory",
            "JS Heap (MB)",
            parseFloat(usedMB),
            frame,
          ),
        );
      }

      // Scene Objects
      if (this.scene) {
        let objCount = 0;
        let lightCount = 0;
        this.scene.traverse((obj) => {
          objCount++;
          if (obj.isLight) lightCount++;
        });

        frame.children.push(
          this._createStatItem("objects", "Total Objects", objCount, frame),
        );
        frame.children.push(
          this._createStatItem("lights", "Lights", lightCount, frame),
        );
      }
    }

    // Update persistent data for these stats so the UI has numbers to show
    this._resolveFrameData(frame);

    // Update UI
    this.performanceTab.updateText(this, frame);
  }

  _resolveFrameData(frame) {
    // Performance.js UI reads from 'data' returned by getStatsData(cid).
    // We need to push current frame values into that data object.

    for (const stat of frame.children) {
      const data = this.getStatsData(stat.cid);

      // Simple direct assignment for legacy view (no smoothing for now)
      data.cpu = stat.cpu;
      data.gpu = stat.gpu;
      data.total = stat.total;
    }
  }

  _createStatItem(id, name, value, parent) {
    // We use the 'value' (e.g. 100 draw calls) as the 'cpu' metric just to display it
    // Performance.js displays cpu/gpu/total columns.
    // We will put the Value in the "Total" column (mapped from cpu+gpu).
    // Actually, let's put it in CPU column and leave GPU empty.

    return {
      cid: "stat_" + id,
      name: name,
      cpu: value, // Hack: Display value in CPU column
      gpu: 0,
      total: value,
      children: [],
      parent: parent,
    };
  }

  // Interface expected by Performance.js
  getStatsData(cid) {
    // It caches stats data. We need to return an object that holds 'item' (the DOM element).
    if (!this.statsData.has(cid)) {
      this.statsData.set(cid, {});
    }
    return this.statsData.get(cid);
  }

  /**
   * Create a Parameters panel (API match for Official Inspector)
   * @param {string} name - Name of the panel group
   * @returns {ParametersGroup}
   */
  createParameters(name) {
    if (this.parameters.isVisible === false) {
      this.parameters.show();
      if (this.parameters.isDetached === false) {
        this.profiler.setActiveTab(this.parameters.id);
      }
    }
    return this.parameters.createGroup(name);
  }

  toggle() {
    if (this.domElement.style.display === "none") {
      this.domElement.style.display = "";
    } else {
      this.domElement.style.display = "none";
    }
  }
}
