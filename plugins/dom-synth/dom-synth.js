/**
 * DOM-Tools Plugin: DOM Synth
 * Turns the page into a musical instrument. Hover elements to hear them,
 * click to lock into a sequence, or let it auto-scan and drone.
 * Immediate, interactive, playful. Web Audio API, zero deps.
 */
(function() {
  'use strict';

  let api = null;
  let panel = null;
  let audioCtx = null;
  let masterGain = null;
  let compressor = null;
  let reverbNode = null;
  let active = false;

  // Modes
  const MODES = ['hover', 'sequence', 'drone', 'theremin'];
  let mode = 'hover'; // default: instant sound on hover

  // Musical scales (semitone offsets from root)
  const SCALES = {
    chromatic: [0,1,2,3,4,5,6,7,8,9,10,11],
    major: [0,2,4,5,7,9,11],
    minor: [0,2,3,5,7,8,10],
    pentatonic: [0,2,4,7,9],
    blues: [0,3,5,6,7,10],
    dorian: [0,2,3,5,7,9,10],
    japanese: [0,1,5,7,8],
    whole: [0,2,4,6,8,10],
  };
  let scaleName = 'pentatonic';
  let rootNote = 220; // A3

  // Sequencer
  let playing = false;
  let clockInterval = null;
  let currentStep = 0;
  let nextStepTime = 0;
  let bpm = 120;
  let stepCount = 16;
  let volume = 0.7;
  const tracks = []; // { el, steps[], muted, sound }

  // Drone
  let droneOscs = [];
  let droneGain = null;

  // Theremin
  let thereminOsc = null;
  let thereminGain = null;
  let thereminFilter = null;

  // Hover
  let lastHoverEl = null;
  let hoverTimeout = null;

  // --- Audio setup ---
  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 10;
    compressor.connect(audioCtx.destination);

    // Simple convolver reverb (generated noise impulse)
    reverbNode = audioCtx.createConvolver();
    const len = audioCtx.sampleRate * 1.5;
    const impulse = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
    }
    reverbNode.buffer = impulse;

    masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;

    // Dry + wet mix
    const dryGain = audioCtx.createGain();
    dryGain.gain.value = 0.7;
    const wetGain = audioCtx.createGain();
    wetGain.gain.value = 0.3;

    masterGain.connect(dryGain);
    masterGain.connect(reverbNode);
    reverbNode.connect(wetGain);
    dryGain.connect(compressor);
    wetGain.connect(compressor);
  }

  // --- Scale quantization ---
  function quantizeToScale(freq) {
    const scale = SCALES[scaleName];
    // Find nearest note in scale
    const semitones = 12 * Math.log2(freq / rootNote);
    const octave = Math.floor(semitones / 12);
    const remainder = ((semitones % 12) + 12) % 12;
    // Snap to nearest scale degree
    let closest = scale[0];
    let minDist = 999;
    for (const degree of scale) {
      const dist = Math.abs(remainder - degree);
      if (dist < minDist) { minDist = dist; closest = degree; }
    }
    return rootNote * Math.pow(2, octave + closest / 12);
  }

  // --- DOM-to-sound mapping ---
  function mapElement(el) {
    const rect = el.getBoundingClientRect();
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;

    // Pitch: vertical position (top=high, bottom=low)
    const normalY = 1 - Math.min(1, Math.max(0, rect.top / viewH));
    const rawFreq = 100 + normalY * 1400;
    const freq = quantizeToScale(rawFreq);

    // Duration from width
    const normalW = Math.min(1, rect.width / viewW);
    const duration = 0.08 + normalW * 0.4;

    // Filter from height
    const normalH = Math.min(1, rect.height / viewH);
    const cutoff = 300 + normalH * 6000;

    // Osc type from color
    const bg = getComputedStyle(el).backgroundColor;
    const hue = colorToHue(bg);
    const oscTypes = ['sine', 'triangle', 'square', 'sawtooth'];
    const oscType = oscTypes[Math.floor(hue / 90) % 4];

    // Velocity from element area
    const area = (rect.width * rect.height) / (viewW * viewH);
    const velocity = Math.min(1, Math.max(0.15, area * 4 + 0.2));

    // Detune from horizontal position
    const normalX = rect.left / viewW;
    const detune = (normalX - 0.5) * 30; // ±15 cents for stereo width

    return { freq, duration, cutoff, oscType, velocity, detune };
  }

  function colorToHue(color) {
    const m = color.match(/\d+/g);
    if (!m || m.length < 3) return 0;
    const r = +m[0] / 255, g = +m[1] / 255, b = +m[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return h * 360;
  }

  // --- Play a note ---
  function playNote(sound, time) {
    if (!audioCtx) return;
    time = time || audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    osc.type = sound.oscType;
    osc.frequency.setValueAtTime(sound.freq, time);
    osc.detune.setValueAtTime(sound.detune || 0, time);

    // Sub oscillator for body
    const sub = audioCtx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(sound.freq * 0.5, time);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(sound.cutoff, time);
    filter.frequency.exponentialRampToValueAtTime(300, time + sound.duration);
    filter.Q.value = 4;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(sound.velocity * 0.35, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, time + sound.duration);

    const subGain = audioCtx.createGain();
    subGain.gain.setValueAtTime(sound.velocity * 0.15, time);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + sound.duration * 0.8);

    osc.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(env);
    env.connect(masterGain);

    osc.start(time);
    sub.start(time);
    osc.stop(time + sound.duration + 0.05);
    sub.stop(time + sound.duration + 0.05);
  }

  // --- Visual feedback ---
  function pulseElement(el, color) {
    if (!el || typeof el.animate !== 'function') return;
    const c = color || '#10b981';
    el.animate([
      { boxShadow: `0 0 0 0px ${c}00`, transform: 'scale(1)' },
      { boxShadow: `0 0 20px 6px ${c}99`, transform: 'scale(1.015)', offset: 0.2 },
      { boxShadow: `0 0 0 0px ${c}00`, transform: 'scale(1)' },
    ], { duration: 300, easing: 'ease-out' });
  }

  // ===== HOVER MODE =====
  function onHoverMove(e) {
    if (mode !== 'hover' || !active) return;
    const el = e.target;
    if (api.isInspectorUI(el)) return;
    if (el === lastHoverEl) return;
    lastHoverEl = el;

    // Debounce to avoid rapid-fire
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      ensureAudio();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const sound = mapElement(el);
      playNote(sound);
      pulseElement(el);
    }, 30);
  }

  // ===== SEQUENCE MODE =====
  const LOOKAHEAD = 0.1;
  const INTERVAL = 25;

  function getStepDuration() { return 60 / bpm / 4; }

  function scheduler() {
    while (nextStepTime < audioCtx.currentTime + LOOKAHEAD) {
      tracks.forEach(track => {
        if (track.muted || !track.steps[currentStep]) return;
        const sound = mapElement(track.el);
        playNote(sound, nextStepTime);
        const delay = Math.max(0, (nextStepTime - audioCtx.currentTime) * 1000);
        setTimeout(() => pulseElement(track.el), delay);
      });
      updateStepHighlight(currentStep);
      nextStepTime += getStepDuration();
      currentStep = (currentStep + 1) % stepCount;
    }
  }

  function startPlayback() {
    ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playing = true;
    currentStep = 0;
    nextStepTime = audioCtx.currentTime + 0.05;
    clockInterval = setInterval(scheduler, INTERVAL);
    refreshUI();
  }

  function stopPlayback() {
    playing = false;
    if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
    currentStep = 0;
    updateStepHighlight(-1);
    refreshUI();
  }

  function onSequenceClick(e) {
    if (mode !== 'sequence' || !active) return;
    const el = e.target;
    if (api.isInspectorUI(el)) return;
    e.preventDefault();
    e.stopPropagation();

    const idx = tracks.findIndex(t => t.el === el);
    if (idx !== -1) {
      tracks.splice(idx, 1);
    } else {
      const depth = getDepth(el);
      const interval = Math.max(2, Math.min(8, depth + 1));
      const steps = Array.from({ length: stepCount }, (_, i) => i % interval === 0);
      tracks.push({ el, steps, muted: false });
      // Preview the sound
      ensureAudio();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      playNote(mapElement(el));
      pulseElement(el);
    }
    renderGrid();
  }

  function getDepth(el) {
    let d = 0, n = el;
    while (n && n !== document.body) { d++; n = n.parentElement; }
    return d;
  }

  // ===== DRONE MODE =====
  function startDrone() {
    ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    stopDrone();

    // Scan visible elements and pick up to 6 for a chord
    const els = Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,img,div'))
      .filter(el => {
        if (api.isInspectorUI(el)) return false;
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0 && r.width > 20;
      })
      .slice(0, 6);

    droneGain = audioCtx.createGain();
    droneGain.gain.value = 0;
    droneGain.connect(masterGain);

    // Fade in
    droneGain.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 1.5);

    droneOscs = els.map(el => {
      const sound = mapElement(el);
      const osc = audioCtx.createOscillator();
      osc.type = sound.oscType;
      osc.frequency.value = sound.freq;
      osc.detune.value = (Math.random() - 0.5) * 10; // slight detune for richness

      // Slow LFO on frequency
      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 0.1 + Math.random() * 0.3;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = sound.freq * 0.01;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = sound.cutoff * 0.5;
      filter.Q.value = 1;

      osc.connect(filter);
      filter.connect(droneGain);
      osc.start();

      // Pulse the element slowly
      const pulseInterval = setInterval(() => {
        if (!active || mode !== 'drone') { clearInterval(pulseInterval); return; }
        pulseElement(el, '#10b981');
      }, 2000 + Math.random() * 3000);

      return { osc, lfo, filter, el, pulseInterval };
    });
  }

  function stopDrone() {
    if (droneGain) {
      try { droneGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5); } catch(e) {}
    }
    droneOscs.forEach(d => {
      try { d.osc.stop(audioCtx.currentTime + 0.6); } catch(e) {}
      try { d.lfo.stop(audioCtx.currentTime + 0.6); } catch(e) {}
      clearInterval(d.pulseInterval);
    });
    droneOscs = [];
    setTimeout(() => { if (droneGain) { droneGain.disconnect(); droneGain = null; } }, 700);
  }

  // ===== THEREMIN MODE =====
  function startTheremin() {
    ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    stopTheremin();

    thereminOsc = audioCtx.createOscillator();
    thereminOsc.type = 'sawtooth';
    thereminOsc.frequency.value = 440;

    thereminFilter = audioCtx.createBiquadFilter();
    thereminFilter.type = 'lowpass';
    thereminFilter.frequency.value = 2000;
    thereminFilter.Q.value = 5;

    thereminGain = audioCtx.createGain();
    thereminGain.gain.value = 0;

    thereminOsc.connect(thereminFilter);
    thereminFilter.connect(thereminGain);
    thereminGain.connect(masterGain);
    thereminOsc.start();

    document.addEventListener('mousemove', onThereminMove);
    document.addEventListener('mousedown', onThereminDown);
    document.addEventListener('mouseup', onThereminUp);
  }

  function stopTheremin() {
    document.removeEventListener('mousemove', onThereminMove);
    document.removeEventListener('mousedown', onThereminDown);
    document.removeEventListener('mouseup', onThereminUp);
    if (thereminOsc) { try { thereminOsc.stop(); } catch(e) {} thereminOsc = null; }
    if (thereminGain) { thereminGain.disconnect(); thereminGain = null; }
    thereminFilter = null;
  }

  function onThereminMove(e) {
    if (!thereminOsc) return;
    const x = e.clientX / window.innerWidth;
    const y = 1 - (e.clientY / window.innerHeight);
    const rawFreq = 80 + y * 1500;
    const freq = quantizeToScale(rawFreq);
    thereminOsc.frequency.exponentialRampToValueAtTime(
      Math.max(20, freq), audioCtx.currentTime + 0.05
    );
    thereminFilter.frequency.value = 400 + x * 6000;
  }

  function onThereminDown() {
    if (thereminGain) thereminGain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
  }

  function onThereminUp() {
    if (thereminGain) thereminGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
  }

  // ===== AUTO-SCAN =====
  function autoScan() {
    tracks.length = 0;
    const els = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,a,button,img,li,span,section,article'))
      .filter(el => {
        if (api.isInspectorUI(el)) return false;
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0 && r.width > 30 && r.height > 10;
      });
    // Pick up to 8 diverse elements
    const picked = [];
    const stride = Math.max(1, Math.floor(els.length / 8));
    for (let i = 0; i < els.length && picked.length < 8; i += stride) {
      picked.push(els[i]);
    }
    picked.forEach((el, i) => {
      const steps = Array.from({ length: stepCount }, (_, s) => {
        // Euclidean-ish distribution
        const hits = Math.max(1, Math.min(8, 3 + i));
        return (s * hits) % stepCount < hits;
      });
      tracks.push({ el, steps, muted: false });
    });
    renderGrid();
    api.showToast(`Scanned ${picked.length} elements`);
  }

  // ===== PANEL UI =====
  let gridContainer = null;
  let _playBtn = null;
  let _modeButtons = {};
  let _stepCells = [];

  function buildPanel() {
    panel = api.createPanel({ title: 'DOM Synth', position: { top: '16px', right: '16px' }, width: '340px' });
    const C = panel._content;
    C.style.maxHeight = '70vh';
    C.style.overflowY = 'auto';

    // --- Mode selector ---
    addSection(C, 'mode', true);
    const modeRow = mkEl('div', { display: 'flex', gap: '4px', marginBottom: '10px' });
    MODES.forEach(m => {
      const btn = mkEl('button', {
        padding: '4px 8px', fontSize: '10px', fontWeight: '600',
        border: 'none', borderRadius: '4px', cursor: 'pointer',
        background: m === mode ? '#10b981' : '#333', color: '#fff', fontFamily: 'inherit',
        textTransform: 'capitalize',
      });
      btn.textContent = m;
      btn.addEventListener('click', () => setMode(m));
      _modeButtons[m] = btn;
      modeRow.appendChild(btn);
    });
    C.appendChild(modeRow);

    // --- Scale + Root ---
    addSection(C, 'tuning');
    const tuneRow = mkEl('div', { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' });
    const scaleSelect = mkEl('select', {
      fontSize: '10px', background: '#333', color: '#fff', border: 'none',
      borderRadius: '3px', padding: '3px 6px',
    });
    Object.keys(SCALES).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      if (name === scaleName) opt.selected = true;
      scaleSelect.appendChild(opt);
    });
    scaleSelect.addEventListener('change', () => { scaleName = scaleSelect.value; });
    tuneRow.appendChild(scaleSelect);

    const rootSelect = mkEl('select', {
      fontSize: '10px', background: '#333', color: '#fff', border: 'none',
      borderRadius: '3px', padding: '3px 6px',
    });
    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const rootFreqs = { C: 130.81, 'C#': 138.59, D: 146.83, 'D#': 155.56, E: 164.81, F: 174.61, 'F#': 185.0, G: 196.0, 'G#': 207.65, A: 220.0, 'A#': 233.08, B: 246.94 };
    noteNames.forEach(n => {
      const opt = document.createElement('option');
      opt.value = rootFreqs[n]; opt.textContent = n + '3';
      if (rootFreqs[n] === rootNote) opt.selected = true;
      rootSelect.appendChild(opt);
    });
    rootSelect.addEventListener('change', () => { rootNote = parseFloat(rootSelect.value); });
    tuneRow.appendChild(rootSelect);
    C.appendChild(tuneRow);

    // --- Transport (sequence mode) ---
    addSection(C, 'transport');
    const transport = mkEl('div', { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' });
    _playBtn = mkBtn(playing ? '⏸' : '▶', () => { playing ? stopPlayback() : startPlayback(); });
    _playBtn.style.width = '28px';
    transport.appendChild(_playBtn);
    transport.appendChild(mkBtn('■', stopPlayback));
    transport.appendChild(mkBtn('Scan', autoScan));
    transport.appendChild(mkBtn('Rnd', randomize));

    const bpmInput = document.createElement('input');
    bpmInput.type = 'range'; bpmInput.min = '60'; bpmInput.max = '200'; bpmInput.value = bpm;
    Object.assign(bpmInput.style, { width: '50px', height: '3px', accentColor: '#10b981', marginLeft: 'auto' });
    const bpmLbl = mkEl('span', { fontSize: '9px', color: '#888' });
    bpmLbl.textContent = bpm + '';
    bpmInput.addEventListener('input', () => { bpm = +bpmInput.value; bpmLbl.textContent = bpm + ''; });
    transport.appendChild(bpmInput);
    transport.appendChild(bpmLbl);
    C.appendChild(transport);

    // Volume
    const volRow = mkEl('div', { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '10px' });
    const volLbl = mkEl('span', { fontSize: '9px', color: '#888' });
    volLbl.textContent = 'vol';
    const volInput = document.createElement('input');
    volInput.type = 'range'; volInput.min = '0'; volInput.max = '1'; volInput.step = '0.05'; volInput.value = volume;
    Object.assign(volInput.style, { width: '80px', height: '3px', accentColor: '#10b981' });
    volInput.addEventListener('input', () => {
      volume = +volInput.value;
      if (masterGain) masterGain.gain.value = volume;
    });
    volRow.appendChild(volLbl);
    volRow.appendChild(volInput);
    C.appendChild(volRow);

    // Grid
    gridContainer = mkEl('div', { maxHeight: '180px', overflowY: 'auto' });
    C.appendChild(gridContainer);
    renderGrid();
  }

  function setMode(m) {
    // Cleanup previous mode
    if (mode === 'drone') stopDrone();
    if (mode === 'theremin') stopTheremin();
    if (mode === 'sequence' && playing) stopPlayback();

    mode = m;

    // Activate new mode
    if (mode === 'drone') startDrone();
    if (mode === 'theremin') startTheremin();

    // Update UI
    Object.entries(_modeButtons).forEach(([key, btn]) => {
      btn.style.background = key === m ? '#10b981' : '#333';
    });

    const hints = {
      hover: 'Hover elements to hear them',
      sequence: 'Click elements to build a pattern',
      drone: 'Page elements sustain as a chord',
      theremin: 'Click + drag to play (Y=pitch, X=filter)',
    };
    api.showToast(hints[m] || '');
  }

  // --- Grid rendering ---
  function renderGrid() {
    if (!gridContainer) return;
    gridContainer.innerHTML = '';
    _stepCells = [];

    if (tracks.length === 0) {
      const empty = mkEl('div', { color: '#555', fontSize: '9px', textAlign: 'center', padding: '12px 0' });
      empty.textContent = mode === 'sequence' ? 'click elements to add • or hit Scan' : 'switch to sequence mode for the grid';
      gridContainer.appendChild(empty);
      return;
    }

    tracks.forEach((track, ti) => {
      const row = mkEl('div', { display: 'flex', alignItems: 'center', gap: '1px', marginBottom: '3px' });

      // Label
      const lbl = mkEl('div', {
        fontSize: '8px', color: track.muted ? '#555' : '#aaa', width: '55px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: '0',
        cursor: 'pointer',
      });
      const sel = api.getSelector(track.el);
      lbl.textContent = sel.length > 12 ? sel.slice(0, 12) + '…' : sel;
      lbl.title = sel;
      lbl.addEventListener('click', () => {
        // Preview sound + highlight element
        ensureAudio();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        playNote(mapElement(track.el));
        pulseElement(track.el);
      });
      row.appendChild(lbl);

      // Step cells
      const cells = [];
      for (let s = 0; s < stepCount; s++) {
        const cell = mkEl('div', {
          width: '10px', height: '10px', borderRadius: '2px', cursor: 'pointer',
          background: track.steps[s] ? '#10b981' : '#282828',
          border: '1px solid ' + (track.steps[s] ? '#10b981' : '#3a3a3a'),
          flexShrink: '0', transition: 'background 0.1s',
        });
        cell.addEventListener('click', () => {
          track.steps[s] = !track.steps[s];
          cell.style.background = track.steps[s] ? '#10b981' : '#282828';
          cell.style.borderColor = track.steps[s] ? '#10b981' : '#3a3a3a';
        });
        row.appendChild(cell);
        cells.push(cell);
      }
      _stepCells.push(cells);

      // Mute
      const muteBtn = mkEl('div', {
        width: '14px', height: '14px', fontSize: '8px', fontWeight: '700',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '2px', cursor: 'pointer', marginLeft: '3px',
        background: track.muted ? '#ef4444' : '#333', color: '#fff', flexShrink: '0',
      });
      muteBtn.textContent = 'M';
      muteBtn.addEventListener('click', () => {
        track.muted = !track.muted;
        muteBtn.style.background = track.muted ? '#ef4444' : '#333';
        lbl.style.color = track.muted ? '#555' : '#aaa';
      });
      row.appendChild(muteBtn);

      // Remove
      const rmBtn = mkEl('div', {
        width: '14px', height: '14px', fontSize: '11px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '2px', cursor: 'pointer', marginLeft: '1px',
        background: '#333', color: '#777', flexShrink: '0',
      });
      rmBtn.textContent = '×';
      rmBtn.addEventListener('click', () => { tracks.splice(ti, 1); renderGrid(); });
      row.appendChild(rmBtn);

      gridContainer.appendChild(row);
    });
  }

  function updateStepHighlight(step) {
    _stepCells.forEach((cells, ti) => {
      cells.forEach((cell, s) => {
        cell.style.boxShadow = s === step ? '0 0 4px #10b981' : 'none';
      });
    });
  }

  function randomize() {
    tracks.forEach(track => {
      const density = 0.2 + Math.random() * 0.35;
      track.steps = Array.from({ length: stepCount }, () => Math.random() < density);
    });
    renderGrid();
  }

  function refreshUI() {
    if (_playBtn) {
      _playBtn.textContent = playing ? '⏸' : '▶';
      _playBtn.style.background = playing ? '#10b981' : '#333';
    }
  }

  // --- UI helpers ---
  function mkEl(tag, styles) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    return e;
  }

  function mkBtn(text, onClick) {
    const btn = mkEl('button', {
      padding: '3px 7px', fontSize: '10px', fontWeight: '600',
      border: 'none', borderRadius: '3px', cursor: 'pointer',
      background: '#333', color: '#fff', fontFamily: 'inherit',
    });
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => { btn.style.background = '#444'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#333'; });
    return btn;
  }

  function addSection(parent, text, first) {
    const s = mkEl('div', {
      fontSize: '9px', fontWeight: '700', textTransform: 'uppercase',
      letterSpacing: '1px', color: '#555', marginBottom: '6px',
      marginTop: first ? '0' : '12px',
      paddingTop: first ? '0' : '8px',
      borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.05)',
    });
    s.textContent = text;
    parent.appendChild(s);
  }

  // --- Plugin definition ---
  const plugin = {
    id: 'dom-synth',
    label: 'DOM Synth',
    enabledByDefault: true,

    button: {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
      tooltip: 'DOM Synth',
      color: '#10b981',
      order: 51,
    },

    init(pluginApi) { api = pluginApi; },

    activate() {
      active = true;
      if (!panel) buildPanel();
      panel.style.display = 'block';
      document.addEventListener('mousemove', onHoverMove);
      document.addEventListener('click', onSequenceClick, true);
      setMode(mode);
    },

    deactivate() {
      active = false;
      if (mode === 'drone') stopDrone();
      if (mode === 'theremin') stopTheremin();
      if (playing) stopPlayback();
      document.removeEventListener('mousemove', onHoverMove);
      document.removeEventListener('click', onSequenceClick, true);
      if (panel) panel.style.display = 'none';
      lastHoverEl = null;
    },

    toggle() {
      if (active) { this.deactivate(); return false; }
      this.activate();
      return true;
    },
  };

  // Register
  const dt = window.DomTools || (window.DomTools = { _pendingPlugins: [] });
  if (dt.registerPlugin) dt.registerPlugin(plugin);
  else dt._pendingPlugins.push(plugin);
})();
