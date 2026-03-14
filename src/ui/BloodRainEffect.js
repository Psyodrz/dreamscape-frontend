/**
 * BloodRainEffect - WebGL Blood Rain Simulation
 * Adapted from "Heartfelt Rain Shader" for Agx Studios
 */
export class BloodRainEffect {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2");
    this.isRunning = false;
    this.startTime = 0;
    this.animationFrameId = null;

    if (!this.gl) {
      console.warn("WebGL 2 not supported for Blood Rain effect");
      return;
    }

    this._initShaders();
    this._initBuffers();
    this._initUniforms();
    this._loadTexture();

    // Default Configuration for "Blood Rain"
    this.config = {
      rainAmount: 1.0, // Heavy rain
      speed: 0.2, // Viscous flow (blood)
      blurStrength: 2.0, // Dreamy/Nightmare blur
      normalStrength: 1.5, // Refraction
      zoom: 1.0,
      tint: [0.8, 0.05, 0.05], // Deep Arterial Red
      glassTint: [0.2, 0.0, 0.0], // Dark Red Glass
    };

    // Bind resize
    this.resize = this.resize.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();
  }

  start() {
    if (this.isRunning || !this.gl) return;
    this.isRunning = true;
    this.startTime = performance.now();
    this.canvas.classList.remove("hidden");
    this._render();
    console.log("Blood Rain Effect Started");
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.canvas.classList.add("hidden");
  }

  dispose() {
    this.stop();
    window.removeEventListener("resize", this.resize);
    // Cleanup GL resources if needed (program, buffers, textures)
  }

  resize() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _render() {
    if (!this.isRunning) return;

    const time = (performance.now() - this.startTime) * 0.001;
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Update Uniforms
    gl.uniform2f(
      this.uniforms.iResolution,
      this.canvas.width,
      this.canvas.height,
    );
    gl.uniform1f(this.uniforms.iTime, time);
    gl.uniform1i(this.uniforms.iChannel0, 0);

    gl.uniform1f(this.uniforms.uRainAmount, this.config.rainAmount);
    gl.uniform1f(this.uniforms.uSpeed, this.config.speed);
    gl.uniform1f(this.uniforms.uBlurStrength, this.config.blurStrength);
    gl.uniform1f(this.uniforms.uNormalStrength, this.config.normalStrength);
    gl.uniform1f(this.uniforms.uZoom, this.config.zoom);

    gl.uniform3fv(this.uniforms.uTint, this.config.tint);
    gl.uniform3fv(this.uniforms.uGlassTint, this.config.glassTint);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.animationFrameId = requestAnimationFrame(this._render.bind(this));
  }

  _initShaders() {
    const vsSource = `#version 300 es
        in vec4 position;
        void main() {
            gl_Position = position;
        }
    `;

    const fsSource = `#version 300 es
        precision highp float;

        uniform vec2 iResolution;
        uniform float iTime;
        uniform sampler2D iChannel0;
        
        uniform float uRainAmount;
        uniform float uSpeed;
        uniform float uBlurStrength;
        uniform float uNormalStrength;
        uniform float uZoom;
        uniform vec3 uTint;
        uniform vec3 uGlassTint;

        out vec4 fragColor;

        #define S(a, b, t) smoothstep(a, b, t)

        // Random functions
        vec3 N13(float p) {
            vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
            p3 += dot(p3, p3.yzx + 19.19);
            return fract(vec3((p3.x + p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x));
        }

        float N(float t) {
            return fract(sin(t*12345.564)*7658.76);
        }

        float Saw(float b, float t) {
            return S(0., b, t)*S(1., b, t);
        }

        vec2 DropLayer2(vec2 uv, float t) {
            vec2 UV = uv;
            
            uv.y += t*0.75;
            vec2 a = vec2(6., 1.);
            vec2 grid = a*2.;
            vec2 id = floor(uv*grid);
            
            float colShift = N(id.x); 
            uv.y += colShift;
            
            id = floor(uv*grid);
            vec3 n = N13(id.x*35.2+id.y*2376.1);
            vec2 st = fract(uv*grid)-vec2(.5, 0);
            
            float x = n.x-.5;
            
            float y = UV.y*20.;
            float wiggle = sin(y+sin(y));
            x += wiggle*(.5-abs(x))*(n.z-.5);
            x *= .7;
            float ti = fract(t+n.z);
            y = (Saw(.85, ti)-.5)*.9+.5;
            vec2 p = vec2(x, y);
            
            float d = length((st-p)*a.yx);
            
            float mainDrop = S(.4, .0, d);
            
            float r = sqrt(S(1., y, st.y));
            float cd = abs(st.x-x);
            float trail = S(.23*r, .15*r*r, cd);
            float trailFront = S(-.02, .02, st.y-y);
            trail *= trailFront*r*r;
            
            y = UV.y;
            float trail2 = S(.2*r, .0, cd);
            float droplets = max(0., (sin(y*(1.-y)*120.)-st.y))*trail2*trailFront*n.z;
            y = fract(y*10.)+(st.y-.5);
            float dd = length(st-vec2(x, y));
            droplets = S(.3, 0., dd);
            float m = mainDrop+droplets*r*trailFront;
            
            return vec2(m, trail);
        }

        float StaticDrops(vec2 uv, float t) {
            uv *= 40.;
            
            vec2 id = floor(uv);
            uv = fract(uv)-.5;
            vec3 n = N13(id.x*107.45+id.y*3543.654);
            vec2 p = (n.xy-.5)*.7;
            float d = length(uv-p);
            
            float fade = Saw(.025, fract(t+n.z));
            float c = S(.3, 0., d)*fract(n.z*10.)*fade;
            return c;
        }

        vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
            float s = StaticDrops(uv, t)*l0; 
            vec2 m1 = DropLayer2(uv, t)*l1;
            vec2 m2 = DropLayer2(uv*1.85, t)*l2;
            
            float c = s + m1.x + m2.x;
            float trail = max(m1.y*l0, m2.y*l1);
            
            if(uRainAmount > 0.4) {
                 float l3 = S(0.4, 0.9, uRainAmount);
                 vec2 m3 = DropLayer2(uv*0.5, t) * l3; 
                 c += m3.x;
                 trail = max(trail, m3.y*l3);
            }
            
            if(uRainAmount > 0.7) {
                 float l4 = S(0.7, 1.0, uRainAmount);
                 vec2 m4 = DropLayer2(uv*3.0, t) * l4; 
                 c += m4.x;
                 trail = max(trail, m4.y*l4);
            }
            
            c = S(.3, 1., c);
            
            return vec2(c, trail);
        }

        void main() {
            vec2 uv = (gl_FragCoord.xy-.5*iResolution.xy) / iResolution.y;
            vec2 UV = gl_FragCoord.xy/iResolution.xy;
            
            // Time logic
            float T = iTime * uSpeed;
            float t = T * .2;
            
            float rainAmount = uRainAmount;
            
            float maxBlur = uBlurStrength;
            float minBlur = 0.5 + S(0.5, 1.0, rainAmount) * 1.5; 
            
            float zoom = -cos(T*.2);
            uv *= uZoom;
            
            UV = (UV-.5)* uZoom + .5;
            
            float staticDrops = S(0.0, 1.0, rainAmount)*3.0;
            float layer1 = S(.25, .75, rainAmount);
            float layer2 = S(.0, .5, rainAmount);
            
            vec2 c = Drops(uv, t, staticDrops, layer1, layer2);
            
            vec2 e = vec2(.001, 0.);
            float cx = Drops(uv+e, t, staticDrops, layer1, layer2).x;
            float cy = Drops(uv+e.yx, t, staticDrops, layer1, layer2).x;
            vec2 n = vec2(cx-c.x, cy-c.x);
            
            n *= uNormalStrength;
            
            float dropAlpha = S(.1, .2, c.x);
            // float focus = mix(maxBlur-c.y, minBlur, dropAlpha);
            
            // Simple texture fetch (no LOD support in basic WebGL2 contexts without mipmaps generated carefully, 
            // but we'll try basic texture mapping first)
            vec3 col = texture(iChannel0, UV+n).rgb;
            
            // Apply Tint
            col = mix(col * uGlassTint, col * uTint, dropAlpha);
            col *= 1.-dot(UV-=.5, UV); 

            fragColor = vec4(col, 1.);
        }
    `;

    const gl = this.gl;
    const vertexShader = this._createShader(gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this._createShader(gl.FRAGMENT_SHADER, fsSource);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(this.program));
    }
  }

  _createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  _initBuffers() {
    const gl = this.gl;
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    const positionAttributeLocation = gl.getAttribLocation(
      this.program,
      "position",
    );
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
  }

  _initUniforms() {
    const gl = this.gl;
    this.uniforms = {
      iResolution: gl.getUniformLocation(this.program, "iResolution"),
      iTime: gl.getUniformLocation(this.program, "iTime"),
      iChannel0: gl.getUniformLocation(this.program, "iChannel0"),
      uRainAmount: gl.getUniformLocation(this.program, "uRainAmount"),
      uSpeed: gl.getUniformLocation(this.program, "uSpeed"),
      uBlurStrength: gl.getUniformLocation(this.program, "uBlurStrength"),
      uNormalStrength: gl.getUniformLocation(this.program, "uNormalStrength"),
      uZoom: gl.getUniformLocation(this.program, "uZoom"),
      uTint: gl.getUniformLocation(this.program, "uTint"),
      uGlassTint: gl.getUniformLocation(this.program, "uGlassTint"),
    };
  }

  _loadTexture() {
    // Generate a noise texture instead of loading an image to avoid CORS/Load issues
    // or utilize the noise inherent in the shader.
    // Here we'll create a basic noise texture to give the "glass" some texture behind the blood.

    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    const size = 512;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size * 4; i += 4) {
      const val = Math.random() * 255;
      data[i] = val; // R
      data[i + 1] = val; // G
      data[i + 2] = val; // B
      data[i + 3] = 255; // A
    }

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      size,
      size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }
}
