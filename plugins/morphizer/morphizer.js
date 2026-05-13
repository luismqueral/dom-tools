/**
 * DOM-Tools Plugin: Morphizer
 * A real-time video synth that captures the page via getDisplayMedia and processes
 * it through a WebGL feedback loop with displacement, color, and visual effects.
 * GPU-accelerated, no dependencies. Load after dom-tools.js.
 */
(function() {
  'use strict';

  // --- Shader sources ---
  const VERT_SRC = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAG_SRC = `
    precision highp float;
    varying vec2 v_uv;

    uniform sampler2D u_texture;     // live page capture
    uniform sampler2D u_feedback;    // previous frame (FBO)
    uniform vec2 u_resolution;
    uniform vec2 u_mouse;
    uniform float u_time;

    // Displacement
    uniform int u_displace;          // 0=wave,1=ripple,2=melt,3=tunnel,4=vortex
    uniform float u_intensity;
    uniform float u_frequency;
    uniform float u_speed;

    // Feedback
    uniform float u_feedbackMix;     // 0–1, how much previous frame bleeds in
    uniform float u_feedbackZoom;    // subtle zoom per frame (1.0 = none)
    uniform float u_feedbackRotate;  // radians per frame

    // Color
    uniform float u_hueShift;        // 0–1 maps to 0–2PI
    uniform float u_saturation;      // multiplier
    uniform float u_rgbSplit;        // chromatic aberration amount
    uniform float u_brightness;      // multiplier

    // Visual
    uniform int u_kaleidoscope;      // segments (0=off)
    uniform float u_pixelate;        // grid size (0=off)
    uniform float u_scanlines;       // intensity (0=off)
    uniform float u_glitch;          // glitch intensity
    uniform float u_mirror;          // 0=off, 1=horizontal, 2=vertical, 3=both

    // Blend mode: 0=mix, 1=add, 2=multiply, 3=difference, 4=screen
    uniform int u_blendMode;

    #define PI 3.14159265
    #define TAU 6.28318530

    // --- HSV helpers ---
    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    // --- Displacement effects ---
    vec2 displace_wave(vec2 uv) {
      float amp = u_intensity * 0.06;
      float freq = u_frequency * 12.0;
      float t = u_time * u_speed;
      uv.x += sin(uv.y * freq + t) * amp;
      uv.y += cos(uv.x * freq * 0.8 + t * 0.7) * amp * 0.6;
      return uv;
    }

    vec2 displace_ripple(vec2 uv) {
      vec2 center = u_mouse;
      float dist = distance(uv, center);
      float amp = u_intensity * 0.05;
      float freq = u_frequency * 40.0;
      float t = u_time * u_speed;
      float w = sin(dist * freq - t * 5.0) * amp;
      w *= smoothstep(0.7, 0.0, dist);
      vec2 dir = normalize(uv - center + 0.0001);
      return uv + dir * w;
    }

    vec2 displace_melt(vec2 uv) {
      float amt = u_intensity * 0.12;
      float t = u_time * u_speed;
      float drip = sin(uv.x * u_frequency * 20.0 + t * 0.4) * amt;
      drip *= smoothstep(0.0, 1.0, uv.y);
      uv.y += drip;
      uv.x += cos(uv.y * 10.0 + t * 0.6) * amt * 0.4;
      return uv;
    }

    vec2 displace_tunnel(vec2 uv) {
      vec2 c = uv - 0.5;
      float r = length(c);
      float a = atan(c.y, c.x);
      float t = u_time * u_speed;
      r += sin(a * u_frequency * 6.0 + t) * u_intensity * 0.08;
      r += sin(r * 20.0 - t * 2.0) * u_intensity * 0.03;
      return vec2(cos(a), sin(a)) * r + 0.5;
    }

    vec2 displace_vortex(vec2 uv) {
      vec2 c = uv - u_mouse;
      float r = length(c);
      float a = atan(c.y, c.x);
      float twist = u_intensity * 4.0 * smoothstep(0.5, 0.0, r);
      a += twist * sin(u_time * u_speed + r * u_frequency * 10.0);
      return vec2(cos(a), sin(a)) * r + u_mouse;
    }

    // --- Kaleidoscope ---
    vec2 kaleidoscope(vec2 uv, int segs) {
      vec2 c = uv - 0.5;
      float a = atan(c.y, c.x);
      float r = length(c);
      float segAngle = TAU / float(segs);
      a = mod(a, segAngle);
      a = abs(a - segAngle * 0.5);
      return vec2(cos(a), sin(a)) * r + 0.5;
    }

    // --- Glitch ---
    vec2 glitchOffset(vec2 uv, float t) {
      float line = floor(uv.y * 40.0);
      float jitter = fract(sin(line * 43.17 + floor(t * 12.0) * 7.13) * 9381.7);
      if (jitter > 1.0 - u_glitch * 0.3) {
        uv.x += (jitter - 0.5) * u_glitch * 0.15;
      }
      return uv;
    }

    void main() {
      vec2 uv = v_uv;

      // Mirror
      if (u_mirror >= 0.5 && u_mirror < 1.5) uv.x = abs(uv.x - 0.5) + 0.5; // horiz
      if (u_mirror >= 1.5 && u_mirror < 2.5) uv.y = abs(uv.y - 0.5) + 0.5; // vert
      if (u_mirror >= 2.5) { uv.x = abs(uv.x - 0.5) + 0.5; uv.y = abs(uv.y - 0.5) + 0.5; }

      // Kaleidoscope
      if (u_kaleidoscope > 1) uv = kaleidoscope(uv, u_kaleidoscope);

      // Pixelate
      if (u_pixelate > 1.0) {
        vec2 grid = u_resolution / u_pixelate;
        uv = floor(uv * grid) / grid;
      }

      // Displacement
      if (u_displace == 0) uv = displace_wave(uv);
      else if (u_displace == 1) uv = displace_ripple(uv);
      else if (u_displace == 2) uv = displace_melt(uv);
      else if (u_displace == 3) uv = displace_tunnel(uv);
      else if (u_displace == 4) uv = displace_vortex(uv);

      // Glitch
      if (u_glitch > 0.0) uv = glitchOffset(uv, u_time);

      uv = clamp(uv, 0.0, 1.0);

      // Sample live texture with RGB split
      vec4 color;
      if (u_rgbSplit > 0.001) {
        float off = u_rgbSplit * 0.025;
        float angle = u_time * 0.5;
        vec2 rOff = vec2(cos(angle), sin(angle)) * off;
        vec2 bOff = vec2(cos(angle + 2.094), sin(angle + 2.094)) * off;
        color.r = texture2D(u_texture, uv + rOff).r;
        color.g = texture2D(u_texture, uv).g;
        color.b = texture2D(u_texture, uv + bOff).b;
        color.a = 1.0;
      } else {
        color = texture2D(u_texture, uv);
      }

      // Feedback: sample previous frame with zoom + rotate
      if (u_feedbackMix > 0.001) {
        vec2 fbUv = (uv - 0.5) / u_feedbackZoom;
        if (abs(u_feedbackRotate) > 0.0001) {
          float ca = cos(u_feedbackRotate);
          float sa = sin(u_feedbackRotate);
          fbUv = mat2(ca, -sa, sa, ca) * fbUv;
        }
        fbUv += 0.5;
        vec4 fb = texture2D(u_feedback, clamp(fbUv, 0.0, 1.0));

        // Blend modes
        vec4 blended;
        if (u_blendMode == 0) blended = mix(color, fb, u_feedbackMix);            // mix
        else if (u_blendMode == 1) blended = color + fb * u_feedbackMix;           // add
        else if (u_blendMode == 2) blended = mix(color, color * fb, u_feedbackMix);// multiply
        else if (u_blendMode == 3) blended = mix(color, abs(color - fb), u_feedbackMix); // difference
        else blended = mix(color, color + fb - color * fb, u_feedbackMix);         // screen
        color = blended;
      }

      // Hue shift + saturation
      if (abs(u_hueShift) > 0.001 || abs(u_saturation - 1.0) > 0.01) {
        vec3 hsv = rgb2hsv(color.rgb);
        hsv.x = fract(hsv.x + u_hueShift);
        hsv.y *= u_saturation;
        color.rgb = hsv2rgb(hsv);
      }

      // Brightness
      color.rgb *= u_brightness;

      // Scanlines
      if (u_scanlines > 0.0) {
        float sl = sin(v_uv.y * u_resolution.y * 0.5) * 0.5 + 0.5;
        color.rgb *= 1.0 - u_scanlines * 0.4 * sl;
      }

      gl_FragColor = clamp(color, 0.0, 1.0);
    }
  `;

  // --- WebGL helpers ---
  function compileShader(gl, src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Morphizer shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function createProgram(gl) {
    const vs = compileShader(gl, VERT_SRC, gl.VERTEX_SHADER);
    const fs = compileShader(gl, FRAG_SRC, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Morphizer link:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  // --- FBO for feedback ---
  function createFBO(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture: tex, framebuffer: fb, width: w, height: h };
  }

  // --- Plugin state ---
  let api = null;
  let canvas = null;
  let gl = null;
  let program = null;
  let liveTexture = null;
  let snapshotCanvas = null; // offscreen canvas holding the captured frame
  let video = null;
  let stream = null;
  let animFrame = null;
  let panel = null;
  let startTime = 0;
  let mouseX = 0.5, mouseY = 0.5;
  let frozen = false;
  let hasTexture = false; // true once we've captured at least one frame

  // FBO ping-pong
  let fboA = null, fboB = null;
  let pingPong = 0; // alternates 0/1

  // Uniforms cache
  let U = {};

  // --- Parameters ---
  const P = {
    displace: 0,          // 0=wave,1=ripple,2=melt,3=tunnel,4=vortex
    intensity: 0.4,
    frequency: 0.5,
    speed: 1.0,
    feedbackMix: 0.0,
    feedbackZoom: 1.002,
    feedbackRotate: 0.0,
    hueShift: 0.0,
    saturation: 1.0,
    rgbSplit: 0.0,
    brightness: 1.0,
    kaleidoscope: 0,
    pixelate: 0,
    scanlines: 0.0,
    glitch: 0.0,
    mirror: 0,
    blendMode: 0,
  };

  // LFO state
  const LFOs = {
    intensity: { active: false, speed: 1.0, depth: 0.5 },
    hueShift: { active: false, speed: 0.5, depth: 1.0 },
    frequency: { active: false, speed: 0.8, depth: 0.4 },
    rgbSplit: { active: false, speed: 1.2, depth: 0.6 },
  };

  const DISPLACE_NAMES = ['wave', 'ripple', 'melt', 'tunnel', 'vortex'];
  const BLEND_NAMES = ['mix', 'add', 'multiply', 'diff', 'screen'];

  // Presets
  const PRESETS = {
    clean: { displace: 0, intensity: 0.3, frequency: 0.4, speed: 1, feedbackMix: 0, feedbackZoom: 1, feedbackRotate: 0, hueShift: 0, saturation: 1, rgbSplit: 0, brightness: 1, kaleidoscope: 0, pixelate: 0, scanlines: 0, glitch: 0, mirror: 0, blendMode: 0 },
    acid: { displace: 0, intensity: 0.7, frequency: 0.6, speed: 1.5, feedbackMix: 0.6, feedbackZoom: 1.005, feedbackRotate: 0.01, hueShift: 0, saturation: 1.5, rgbSplit: 0.3, brightness: 1.1, kaleidoscope: 0, pixelate: 0, scanlines: 0, glitch: 0, mirror: 0, blendMode: 1 },
    crt: { displace: 0, intensity: 0.1, frequency: 0.3, speed: 0.5, feedbackMix: 0.15, feedbackZoom: 1, feedbackRotate: 0, hueShift: 0, saturation: 0.8, rgbSplit: 0.4, brightness: 0.95, kaleidoscope: 0, pixelate: 3, scanlines: 0.7, glitch: 0.1, mirror: 0, blendMode: 0 },
    kaleid: { displace: 4, intensity: 0.3, frequency: 0.5, speed: 0.8, feedbackMix: 0.4, feedbackZoom: 1.003, feedbackRotate: 0.02, hueShift: 0, saturation: 1.3, rgbSplit: 0.1, brightness: 1, kaleidoscope: 6, pixelate: 0, scanlines: 0, glitch: 0, mirror: 0, blendMode: 0 },
    datamosh: { displace: 2, intensity: 0.8, frequency: 0.7, speed: 2, feedbackMix: 0.85, feedbackZoom: 1.001, feedbackRotate: 0, hueShift: 0, saturation: 1, rgbSplit: 0.5, brightness: 1, kaleidoscope: 0, pixelate: 0, scanlines: 0, glitch: 0.6, mirror: 0, blendMode: 3 },
    pixel: { displace: 0, intensity: 0.2, frequency: 0.4, speed: 0.7, feedbackMix: 0.2, feedbackZoom: 1, feedbackRotate: 0, hueShift: 0, saturation: 1.2, rgbSplit: 0, brightness: 1, kaleidoscope: 0, pixelate: 12, scanlines: 0, glitch: 0, mirror: 0, blendMode: 0 },
    void: { displace: 3, intensity: 0.9, frequency: 0.8, speed: 0.4, feedbackMix: 0.92, feedbackZoom: 0.998, feedbackRotate: -0.005, hueShift: 0, saturation: 0.5, rgbSplit: 0.2, brightness: 0.8, kaleidoscope: 0, pixelate: 0, scanlines: 0.3, glitch: 0, mirror: 0, blendMode: 4 },
    mirror: { displace: 1, intensity: 0.4, frequency: 0.5, speed: 1, feedbackMix: 0.3, feedbackZoom: 1, feedbackRotate: 0, hueShift: 0, saturation: 1, rgbSplit: 0.15, brightness: 1, kaleidoscope: 0, pixelate: 0, scanlines: 0, glitch: 0, mirror: 3, blendMode: 0 },
  };

  // --- Capture sources ---
  // 'thispage' = getDisplayMedia with preferCurrentTab (one-click share of current tab)
  // 'pick' = standard getDisplayMedia (full picker — any window/tab/screen)
  let captureSource = 'thispage';

  async function captureFrame() {
    const opts = { video: { displaySurface: 'browser' } };
    if (captureSource === 'thispage') {
      opts.preferCurrentTab = true;
      opts.selfBrowserSurface = 'include';
    }

    try {
      stream = await navigator.mediaDevices.getDisplayMedia(opts);
    } catch (e) {
      api.showToast('Morphizer: capture denied');
      return false;
    }

    video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    // Wait for a valid frame
    await new Promise(resolve => {
      const check = () => {
        if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });

    // Copy frame to offscreen canvas
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!snapshotCanvas) snapshotCanvas = document.createElement('canvas');
    snapshotCanvas.width = w;
    snapshotCanvas.height = h;
    const ctx = snapshotCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    // Stop stream — we only need one frame
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
    video = null;

    hasTexture = true;
    return true;
  }

  // Upload the snapshot to the live texture
  function uploadSnapshot() {
    if (!snapshotCanvas || !gl) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, liveTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snapshotCanvas);
  }

  // Recapture: hide canvas, grab new frame, resume
  async function recapture() {
    if (canvas) canvas.style.display = 'none';
    // Give the browser a frame to render without our canvas
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ok = await captureFrame();
    if (ok) {
      uploadSnapshot();
      api.showToast('Recaptured');
    }
    if (canvas) canvas.style.display = 'block';
  }

  // --- WebGL ---
  function initGL() {
    canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0',
      width: '100vw', height: '100vh',
      pointerEvents: 'none',
      zIndex: String((api.Z.overlay || 99998) + 1),
    });
    const dpr = Math.min(devicePixelRatio, 2); // cap for perf
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) { api.showToast('Morphizer: no WebGL'); return false; }

    program = createProgram(gl);
    if (!program) return false;
    gl.useProgram(program);

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    // Live texture
    liveTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, liveTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // FBOs for feedback ping-pong
    fboA = createFBO(gl, canvas.width, canvas.height);
    fboB = createFBO(gl, canvas.width, canvas.height);

    // Cache uniforms
    const names = [
      'u_texture','u_feedback','u_resolution','u_mouse','u_time',
      'u_displace','u_intensity','u_frequency','u_speed',
      'u_feedbackMix','u_feedbackZoom','u_feedbackRotate',
      'u_hueShift','u_saturation','u_rgbSplit','u_brightness',
      'u_kaleidoscope','u_pixelate','u_scanlines','u_glitch','u_mirror',
      'u_blendMode',
    ];
    U = {};
    names.forEach(n => { U[n] = gl.getUniformLocation(program, n); });

    document.body.appendChild(canvas);
    api.inspectorUI.add(canvas);
    return true;
  }

  function resizeFBOs() {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = window.innerWidth * dpr;
    const h = window.innerHeight * dpr;
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    // Recreate FBOs
    gl.deleteTexture(fboA.texture); gl.deleteFramebuffer(fboA.framebuffer);
    gl.deleteTexture(fboB.texture); gl.deleteFramebuffer(fboB.framebuffer);
    fboA = createFBO(gl, w, h);
    fboB = createFBO(gl, w, h);
  }

  // --- Render ---
  function render() {
    if (!gl || !hasTexture) {
      animFrame = requestAnimationFrame(render);
      return;
    }
    resizeFBOs();

    const TAU = 6.28318;

    // Apply LFOs
    const t = (performance.now() - startTime) / 1000;
    const lfoVals = {};
    Object.entries(LFOs).forEach(([key, lfo]) => {
      if (lfo.active) {
        lfoVals[key] = (Math.sin(t * lfo.speed * TAU) * 0.5 + 0.5) * lfo.depth;
      }
    });

    // Effective params with LFO modulation
    const eIntensity = P.intensity + (lfoVals.intensity || 0);
    const eHueShift = P.hueShift + (lfoVals.hueShift || 0);
    const eFrequency = P.frequency + (lfoVals.frequency || 0);
    const eRgbSplit = P.rgbSplit + (lfoVals.rgbSplit || 0);

    // The live texture is already uploaded from the snapshot — no per-frame upload needed.
    // Bind it for the shader.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, liveTexture);

    // Bind feedback texture (read from previous frame)
    const readFBO = pingPong === 0 ? fboA : fboB;
    const writeFBO = pingPong === 0 ? fboB : fboA;

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readFBO.texture);

    // Render to writeFBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Set all uniforms
    gl.uniform1i(U.u_texture, 0);
    gl.uniform1i(U.u_feedback, 1);
    gl.uniform2f(U.u_resolution, canvas.width, canvas.height);
    gl.uniform2f(U.u_mouse, mouseX, 1.0 - mouseY);
    gl.uniform1f(U.u_time, t);
    gl.uniform1i(U.u_displace, P.displace);
    gl.uniform1f(U.u_intensity, Math.min(eIntensity, 1.5));
    gl.uniform1f(U.u_frequency, Math.min(eFrequency, 1.5));
    gl.uniform1f(U.u_speed, P.speed);
    gl.uniform1f(U.u_feedbackMix, P.feedbackMix);
    gl.uniform1f(U.u_feedbackZoom, P.feedbackZoom);
    gl.uniform1f(U.u_feedbackRotate, P.feedbackRotate);
    gl.uniform1f(U.u_hueShift, eHueShift);
    gl.uniform1f(U.u_saturation, P.saturation);
    gl.uniform1f(U.u_rgbSplit, Math.min(eRgbSplit, 1.5));
    gl.uniform1f(U.u_brightness, P.brightness);
    gl.uniform1i(U.u_kaleidoscope, P.kaleidoscope);
    gl.uniform1f(U.u_pixelate, P.pixelate);
    gl.uniform1f(U.u_scanlines, P.scanlines);
    gl.uniform1f(U.u_glitch, P.glitch);
    gl.uniform1f(U.u_mirror, P.mirror);
    gl.uniform1i(U.u_blendMode, P.blendMode);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Copy to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Use writeFBO texture as source, render with no effects (pass-through)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, writeFBO.texture);
    // Set minimal uniforms for pass-through
    gl.uniform1i(U.u_texture, 0);
    gl.uniform1f(U.u_feedbackMix, 0.0); // no feedback on screen pass
    gl.uniform1f(U.u_intensity, 0.0);   // no displacement
    gl.uniform1f(U.u_rgbSplit, 0.0);
    gl.uniform1f(U.u_hueShift, 0.0);
    gl.uniform1f(U.u_saturation, 1.0);
    gl.uniform1f(U.u_brightness, 1.0);
    gl.uniform1i(U.u_kaleidoscope, 0);
    gl.uniform1f(U.u_pixelate, 0.0);
    gl.uniform1f(U.u_scanlines, 0.0);
    gl.uniform1f(U.u_glitch, 0.0);
    gl.uniform1f(U.u_mirror, 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    pingPong = 1 - pingPong;
    animFrame = requestAnimationFrame(render);
  }

  // --- Panel UI ---
  function buildPanel() {
    panel = api.createPanel({ title: 'Morphizer', position: { top: '16px', right: '16px' }, width: '260px' });
    const C = panel._content;
    C.style.maxHeight = '70vh';
    C.style.overflowY = 'auto';

    // --- Source selector ---
    addSection(C, 'source', true);
    const srcRow = el('div', { display: 'flex', gap: '4px', marginBottom: '12px', alignItems: 'center' });
    const srcButtons = {};
    ['thispage', 'pick'].forEach(src => {
      const btn = el('button', {
        padding: '3px 8px', fontSize: '9px', fontWeight: '600',
        border: 'none', borderRadius: '3px', cursor: 'pointer',
        background: src === captureSource ? '#8b5cf6' : '#333',
        color: '#fff', fontFamily: 'inherit',
      });
      btn.textContent = src === 'thispage' ? 'this page' : 'pick source';
      btn.addEventListener('click', () => {
        captureSource = src;
        Object.entries(srcButtons).forEach(([k, b]) => {
          b.style.background = k === src ? '#8b5cf6' : '#333';
        });
      });
      srcButtons[src] = btn;
      srcRow.appendChild(btn);
    });
    const recapBtn = el('button', {
      padding: '3px 8px', fontSize: '9px', fontWeight: '600',
      border: 'none', borderRadius: '3px', cursor: 'pointer',
      background: '#555', color: '#fff', fontFamily: 'inherit', marginLeft: 'auto',
    });
    recapBtn.textContent = '⟳ recapture';
    recapBtn.addEventListener('click', recapture);
    recapBtn.addEventListener('mouseenter', () => { recapBtn.style.background = '#8b5cf6'; });
    recapBtn.addEventListener('mouseleave', () => { recapBtn.style.background = '#555'; });
    srcRow.appendChild(recapBtn);
    C.appendChild(srcRow);

    // --- Presets ---
    addSection(C, 'presets');
    const presetRow = el('div', { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' });
    Object.keys(PRESETS).forEach(name => {
      const btn = el('button', {
        padding: '3px 7px', fontSize: '9px', fontWeight: '600',
        border: 'none', borderRadius: '3px', cursor: 'pointer',
        background: '#333', color: '#ccc', fontFamily: 'inherit',
        textTransform: 'uppercase', letterSpacing: '0.3px',
      });
      btn.textContent = name;
      btn.addEventListener('click', () => applyPreset(name));
      btn.addEventListener('mouseenter', () => { btn.style.background = '#8b5cf6'; btn.style.color = '#fff'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#333'; btn.style.color = '#ccc'; });
      presetRow.appendChild(btn);
    });
    C.appendChild(presetRow);

    // --- Displacement ---
    addSection(C, 'displacement');
    const displaceRow = el('div', { display: 'flex', gap: '3px', marginBottom: '8px' });
    DISPLACE_NAMES.forEach((name, i) => {
      const btn = el('button', {
        padding: '3px 6px', fontSize: '9px', fontWeight: '600',
        border: 'none', borderRadius: '3px', cursor: 'pointer',
        background: i === P.displace ? '#8b5cf6' : '#333',
        color: '#fff', fontFamily: 'inherit',
      });
      btn.textContent = name;
      btn.addEventListener('click', () => {
        P.displace = i;
        displaceRow.querySelectorAll('button').forEach((b, j) => {
          b.style.background = j === i ? '#8b5cf6' : '#333';
        });
      });
      displaceRow.appendChild(btn);
    });
    C.appendChild(displaceRow);
    addSlider(C, 'intensity', P.intensity, 0, 1, v => { P.intensity = v; });
    addSlider(C, 'frequency', P.frequency, 0, 1, v => { P.frequency = v; });
    addSlider(C, 'speed', P.speed, 0, 4, v => { P.speed = v; });

    // --- Feedback ---
    addSection(C, 'feedback');
    addSlider(C, 'mix', P.feedbackMix, 0, 0.98, v => { P.feedbackMix = v; });
    addSlider(C, 'zoom', P.feedbackZoom, 0.99, 1.02, v => { P.feedbackZoom = v; }, 0.001);
    addSlider(C, 'rotate', P.feedbackRotate, -0.05, 0.05, v => { P.feedbackRotate = v; }, 0.001);
    addBlendRow(C);

    // --- Color ---
    addSection(C, 'color');
    addSlider(C, 'hue shift', P.hueShift, 0, 1, v => { P.hueShift = v; });
    addSlider(C, 'saturation', P.saturation, 0, 3, v => { P.saturation = v; });
    addSlider(C, 'RGB split', P.rgbSplit, 0, 1, v => { P.rgbSplit = v; });
    addSlider(C, 'brightness', P.brightness, 0.2, 2, v => { P.brightness = v; });

    // --- Visual ---
    addSection(C, 'visual');
    addSlider(C, 'kaleidoscope', P.kaleidoscope, 0, 12, v => { P.kaleidoscope = Math.round(v); }, 1);
    addSlider(C, 'pixelate', P.pixelate, 0, 30, v => { P.pixelate = v; }, 1);
    addSlider(C, 'scanlines', P.scanlines, 0, 1, v => { P.scanlines = v; });
    addSlider(C, 'glitch', P.glitch, 0, 1, v => { P.glitch = v; });
    addMirrorRow(C);

    // --- LFOs ---
    addSection(C, 'LFOs');
    Object.keys(LFOs).forEach(key => {
      addLFORow(C, key);
    });

    // --- Actions ---
    addSection(C, 'actions');
    const actRow = el('div', { display: 'flex', gap: '6px', flexWrap: 'wrap' });
    actRow.appendChild(makeActionBtn('Recapture', recapture));
    actRow.appendChild(makeActionBtn('Save PNG', () => {
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = 'morphizer-' + Date.now() + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      api.showToast('Saved');
    }));
    actRow.appendChild(makeActionBtn('Reset', () => applyPreset('clean')));
    C.appendChild(actRow);
  }

  // --- UI helpers ---
  function el(tag, styles) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    return e;
  }

  function addSection(parent, text, first) {
    const s = el('div', {
      fontSize: '9px', fontWeight: '700', textTransform: 'uppercase',
      letterSpacing: '1px', color: '#666', marginBottom: '6px',
      marginTop: first ? '0' : '14px',
      paddingTop: first ? '0' : '10px',
      borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.06)',
    });
    s.textContent = text;
    parent.appendChild(s);
  }

  const _sliderEls = {};
  function addSlider(parent, label, value, min, max, onChange, step) {
    const row = el('div', { marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' });
    const lbl = el('div', { fontSize: '10px', color: '#999', width: '70px', flexShrink: '0' });
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max;
    input.step = step || ((max - min) / 100).toFixed(4);
    input.value = value;
    Object.assign(input.style, { flex: '1', height: '3px', accentColor: '#8b5cf6' });
    input.addEventListener('input', () => onChange(parseFloat(input.value)));
    row.appendChild(lbl);
    row.appendChild(input);
    parent.appendChild(row);
    _sliderEls[label] = input;
    return input;
  }

  function addBlendRow(parent) {
    const row = el('div', { display: 'flex', gap: '3px', marginTop: '6px' });
    BLEND_NAMES.forEach((name, i) => {
      const btn = el('button', {
        padding: '2px 5px', fontSize: '9px', border: 'none', borderRadius: '3px',
        cursor: 'pointer', background: i === P.blendMode ? '#8b5cf6' : '#333',
        color: '#fff', fontFamily: 'inherit',
      });
      btn.textContent = name;
      btn.addEventListener('click', () => {
        P.blendMode = i;
        row.querySelectorAll('button').forEach((b, j) => {
          b.style.background = j === i ? '#8b5cf6' : '#333';
        });
      });
      row.appendChild(btn);
    });
    parent.appendChild(row);
  }

  function addMirrorRow(parent) {
    const names = ['off', 'H', 'V', 'both'];
    const row = el('div', { display: 'flex', gap: '3px', alignItems: 'center', marginTop: '4px' });
    const lbl = el('div', { fontSize: '10px', color: '#999', width: '70px', flexShrink: '0' });
    lbl.textContent = 'mirror';
    row.appendChild(lbl);
    names.forEach((name, i) => {
      const btn = el('button', {
        padding: '2px 6px', fontSize: '9px', border: 'none', borderRadius: '3px',
        cursor: 'pointer', background: i === P.mirror ? '#8b5cf6' : '#333',
        color: '#fff', fontFamily: 'inherit',
      });
      btn.textContent = name;
      btn.addEventListener('click', () => {
        P.mirror = i;
        row.querySelectorAll('button').forEach((b, j) => {
          if (j === 0) return; // skip label
          b.style.background = (j - 1) === i ? '#8b5cf6' : '#333';
        });
      });
      row.appendChild(btn);
    });
    parent.appendChild(row);
  }

  function addLFORow(parent, key) {
    const lfo = LFOs[key];
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' });
    const toggle = el('button', {
      width: '14px', height: '14px', borderRadius: '50%', border: 'none',
      background: lfo.active ? '#8b5cf6' : '#444', cursor: 'pointer', padding: '0', flexShrink: '0',
    });
    toggle.addEventListener('click', () => {
      lfo.active = !lfo.active;
      toggle.style.background = lfo.active ? '#8b5cf6' : '#444';
    });
    const lbl = el('span', { fontSize: '10px', color: '#bbb', width: '60px' });
    lbl.textContent = key;
    row.appendChild(toggle);
    row.appendChild(lbl);
    parent.appendChild(row);
  }

  function makeActionBtn(text, onClick) {
    const btn = el('button', {
      padding: '4px 10px', fontSize: '10px', fontWeight: '600',
      border: 'none', borderRadius: '4px', cursor: 'pointer',
      background: '#333', color: '#fff', fontFamily: 'inherit',
    });
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => { btn.style.background = '#555'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#333'; });
    return btn;
  }

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(P, p);
    // Update sliders
    const map = {
      'intensity': P.intensity, 'frequency': P.frequency, 'speed': P.speed,
      'mix': P.feedbackMix, 'zoom': P.feedbackZoom, 'rotate': P.feedbackRotate,
      'hue shift': P.hueShift, 'saturation': P.saturation, 'RGB split': P.rgbSplit,
      'brightness': P.brightness, 'kaleidoscope': P.kaleidoscope,
      'pixelate': P.pixelate, 'scanlines': P.scanlines, 'glitch': P.glitch,
    };
    Object.entries(map).forEach(([label, val]) => {
      if (_sliderEls[label]) _sliderEls[label].value = val;
    });
    api.showToast('Preset: ' + name);
  }

  // --- Mouse ---
  function onMouseMove(e) {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  }

  // --- Plugin definition ---
  const plugin = {
    id: 'morphizer',
    label: 'Morphizer',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3c2 3 3 6 3 9s-1 6-3 9"/><path d="M12 3c-2 3-3 6-3 9s1 6 3 9"/><path d="M3 12h18"/></svg>',
      tooltip: 'Morphizer',
      color: '#8b5cf6',
      order: 50,
    },

    init(pluginApi) { api = pluginApi; },

    async activate() {
      if (!panel) buildPanel();
      panel.style.display = 'block';

      // Init WebGL first (but don't show canvas yet)
      if (!gl) {
        if (!initGL()) { panel.style.display = 'none'; return; }
      }
      canvas.style.display = 'none'; // hidden during capture

      // Capture a single clean frame
      const ok = await captureFrame();
      if (!ok) { panel.style.display = 'none'; return; }

      // Upload snapshot and show canvas
      uploadSnapshot();
      canvas.style.display = 'block';

      startTime = performance.now();
      document.addEventListener('mousemove', onMouseMove);
      animFrame = requestAnimationFrame(render);
    },

    deactivate() {
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      document.removeEventListener('mousemove', onMouseMove);
      if (canvas) canvas.style.display = 'none';
      if (panel) panel.style.display = 'none';
      frozen = false;
    },

    toggle() {
      if (canvas && canvas.style.display !== 'none') { this.deactivate(); return false; }
      this.activate();
      return true;
    },
  };

  // Register
  const dt = window.DomTools || (window.DomTools = { _pendingPlugins: [] });
  if (dt.registerPlugin) dt.registerPlugin(plugin);
  else dt._pendingPlugins.push(plugin);
})();
