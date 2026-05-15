import { state, inspectorUI } from '../core/state.js';
import { COLORS, CAM_OUTLINE, CAM_BG, Z } from '../core/constants.js';
import { showToast, nudge, flashElement, isInspectorUI, clearHover } from '../core/helpers.js';
import { getExperimentOption } from '../settings.js';

let selBox = null;
function playShutter() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Click 1 — shutter open (short burst of noise)
    const buf1 = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate);
    const data1 = buf1.getChannelData(0);
    for (let i = 0; i < data1.length; i++) data1[i] = (Math.random() * 2 - 1) * (1 - i / data1.length);
    const click1 = ctx.createBufferSource();
    click1.buffer = buf1;
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.3, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    click1.connect(g1);
    g1.connect(ctx.destination);
    click1.start(t);

    // Click 2 — shutter close (slightly delayed, lower)
    const buf2 = ctx.createBuffer(1, ctx.sampleRate * 0.015, ctx.sampleRate);
    const data2 = buf2.getChannelData(0);
    for (let i = 0; i < data2.length; i++) data2[i] = (Math.random() * 2 - 1) * (1 - i / data2.length);
    const click2 = ctx.createBufferSource();
    click2.buffer = buf2;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.2, t + 0.06);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    click2.connect(g2);
    g2.connect(ctx.destination);
    click2.start(t + 0.06);
  } catch (e) {}
}

let camDragging = false, camStartX = 0, camStartY = 0, camDidDrag = false;

async function loadH2C() {
  if (!window.html2canvas) {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    document.head.appendChild(s);
    await new Promise(r => s.onload = r);
  }
}

async function saveCapture(canvas, el, filename) {
  playShutter();
  flashElement(el || document.documentElement);

  // Get blob first — toDataURL fails on large canvases
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (!blob) { showToast('Capture failed — canvas too large'); return; }

  // Try clipboard (requires secure context + user gesture may have expired)
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast('Copied to clipboard');
    return;
  } catch (_) {}

  // Fallback: download via object URL
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename || 'screenshot.png';
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Downloaded screenshot');
  } catch (_) {
    showToast('Capture failed');
  }
}

async function captureElement(el) {
  await loadH2C();
  const oo = el.style.outline, ob = el.style.backgroundColor;
  el.style.outline = el._origOutline || '';
  el.style.backgroundColor = el._origBg || '';
  showToast('Capturing...');
  try {
    const canvas = await html2canvas(el, { backgroundColor: null, scale: getIdealScale(), logging: false });
    await saveCapture(canvas, el);
  } catch (e) { showToast('Capture failed'); }
  el.style.outline = oo;
  el.style.backgroundColor = ob;
}

async function captureRegion(x, y, w, h) {
  await loadH2C();
  showToast('Capturing...');
  try {
    const pageW = document.documentElement.scrollWidth;
    const pageH = document.documentElement.scrollHeight;
    const scale = safeScale(pageW, pageH);
    const full = await html2canvas(document.documentElement, {
      backgroundColor: '#fff', scale, logging: false,
      scrollX: 0, scrollY: 0,
      windowWidth: pageW,
      windowHeight: pageH
    });
    const sx = (x + window.scrollX) * scale;
    const sy = (y + window.scrollY) * scale;
    const sw = w * scale;
    const sh = h * scale;
    const crop = document.createElement('canvas');
    crop.width = sw; crop.height = sh;
    crop.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    await saveCapture(crop);
  } catch (e) { showToast('Capture failed'); }
}

// Browsers cap canvas dimensions (16384px in Chrome/Safari, 32767 in Firefox).
// Use 16384 as the safe cross-browser limit.
const MAX_CANVAS_DIM = 16384;

function getIdealScale() {
  const setting = getExperimentOption('camera', 'resolution') || '3';
  if (setting === 'auto') return window.devicePixelRatio || 2;
  return Number(setting);
}

function safeScale(width, height) {
  const ideal = getIdealScale();
  const maxByWidth = MAX_CANVAS_DIM / width;
  const maxByHeight = MAX_CANVAS_DIM / height;
  return Math.min(ideal, maxByWidth, maxByHeight);
}

async function captureFullPage() {
  const w = document.documentElement.scrollWidth;
  const h = document.documentElement.scrollHeight;
  const scale = getIdealScale();

  // Delegate to HD Capture plugin if page exceeds single-canvas limits
  console.log(`[camera] captureFullPage: ${w}x${h} @ ${scale}x, hdCapture=${!!window.DomTools?._hdCapture}, needed=${window.DomTools?._hdCaptureNeeded?.(w, h, scale)}`);
  if (window.DomTools && window.DomTools._hdCapture && window.DomTools._hdCaptureNeeded &&
      window.DomTools._hdCaptureNeeded(w, h, scale)) {
    showToast('HD capture...');
    try {
      await window.DomTools._hdCapture(w, h, scale);
    } catch (e) { showToast('HD capture failed'); }
    return;
  }

  // Standard single-canvas path (with safe scale)
  await loadH2C();
  showToast('Capturing full page...');
  try {
    const cappedScale = safeScale(w, h);
    const canvas = await html2canvas(document.documentElement, {
      backgroundColor: '#fff', scale: cappedScale, logging: false,
      scrollX: 0, scrollY: 0,
      windowWidth: w,
      windowHeight: h,
      width: w,
      height: h,
      ignoreElements: (el) => inspectorUI.has(el)
    });
    await saveCapture(canvas, null, 'full-page-screenshot.png');
  } catch (e) { showToast('Full page capture failed'); }
}

export default {
  id: 'camera',
  label: 'Screenshots',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M2 8.37722C2 8.0269 2 7.85174 2.01462 7.70421C2.1556 6.28127 3.28127 5.1556 4.70421 5.01462C4.85174 5 5.03636 5 5.40558 5C5.54785 5 5.61899 5 5.67939 4.99634C6.45061 4.94963 7.12595 4.46288 7.41414 3.746C7.43671 3.68986 7.45781 3.62657 7.5 3.5C7.54219 3.37343 7.56329 3.31014 7.58586 3.254C7.87405 2.53712 8.54939 2.05037 9.32061 2.00366C9.38101 2 9.44772 2 9.58114 2H14.4189C14.5523 2 14.619 2 14.6794 2.00366C15.4506 2.05037 16.126 2.53712 16.4141 3.254C16.4367 3.31014 16.4578 3.37343 16.5 3.5C16.5422 3.62657 16.5633 3.68986 16.5859 3.746C16.874 4.46288 17.5494 4.94963 18.3206 4.99634C18.381 5 18.4521 5 18.5944 5C18.9636 5 19.1483 5 19.2958 5.01462C20.7187 5.1556 21.8444 6.28127 21.9854 7.70421C22 7.85174 22 8.0269 22 8.37722V16.2C22 17.8802 22 18.7202 21.673 19.362C21.3854 19.9265 20.9265 20.3854 20.362 20.673C19.7202 21 18.8802 21 17.2 21H6.8C5.11984 21 4.27976 21 3.63803 20.673C3.07354 20.3854 2.6146 19.9265 2.32698 19.362C2 18.7202 2 17.8802 2 16.2V8.37722Z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 16.5C14.2091 16.5 16 14.7091 16 12.5C16 10.2909 14.2091 8.5 12 8.5C9.79086 8.5 8 10.2909 8 12.5C8 14.7091 9.79086 16.5 12 16.5Z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tooltip: 'Screenshot',
    color: COLORS.camera,
    order: 30,
  },


  shortcuts: [
    { key: 'S', meta: true, shift: true, action: 'captureFullPage' }
  ],

  init() {
    selBox = document.createElement('div');
    Object.assign(selBox.style, {
      position: 'fixed', border: '2px dashed ' + COLORS.camera, background: 'rgba(204, 51, 0, 0.08)',
      zIndex: String(Z.tooltip), pointerEvents: 'none', display: 'none', borderRadius: '2px'
    });
    document.body.appendChild(selBox);
    inspectorUI.add(selBox);


    // Camera mousedown — shift+click = full page, otherwise start drag
    document.addEventListener('mousedown', (e) => {
      if (!state.cameraMode || isInspectorUI(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) {
        captureFullPage();
        return;
      }
      camDragging = true;
      camDidDrag = false;
      camStartX = e.clientX;
      camStartY = e.clientY;
    }, true);

    // Full-page highlight when shift held in camera mode
    let fullPageHighlight = false;
    function showFullPageHighlight() {
      if (fullPageHighlight) return;
      fullPageHighlight = true;
      clearHover();
      document.documentElement.style.outline = CAM_OUTLINE;
      document.documentElement.style.backgroundColor = CAM_BG;
    }
    function hideFullPageHighlight() {
      if (!fullPageHighlight) return;
      fullPageHighlight = false;
      document.documentElement.style.outline = '';
      document.documentElement.style.backgroundColor = '';
    }

    document.addEventListener('keydown', (e) => {
      if (state.cameraMode && e.key === 'Shift') showFullPageHighlight();
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') hideFullPageHighlight();
    });

    // Camera mousemove — drag or hover
    document.addEventListener('mousemove', (e) => {
      if (!state.cameraMode) return;
      if (e.shiftKey) { showFullPageHighlight(); return; }
      else { hideFullPageHighlight(); }
      if (camDragging) {
        const dx = Math.abs(e.clientX - camStartX);
        const dy = Math.abs(e.clientY - camStartY);
        if (dx > 4 || dy > 4) {
          camDidDrag = true;
          clearHover();
          const x = Math.min(e.clientX, camStartX);
          const y = Math.min(e.clientY, camStartY);
          Object.assign(selBox.style, {
            display: 'block', left: x + 'px', top: y + 'px', width: dx + 'px', height: dy + 'px'
          });
        }
        return;
      }
      // Not dragging — show red hover
      const el = e.target;
      if (isInspectorUI(el) || el === document.body || el === document.documentElement) return;
      if (state.hovered && state.hovered !== el) {
        state.hovered.style.outline = state.hovered._origOutline || '';
        state.hovered.style.backgroundColor = state.hovered._origBg || '';
      }
      if (el !== state.hovered) {
        el._origOutline = el._origOutline ?? el.style.outline;
        el._origBg = el._origBg ?? el.style.backgroundColor;
      }
      el.style.outline = CAM_OUTLINE;
      el.style.backgroundColor = CAM_BG;
      state.hovered = el;
    }, true);

    // Camera mouseup — capture
    document.addEventListener('mouseup', (e) => {
      if (!state.cameraMode || !camDragging) return;
      camDragging = false;
      if (camDidDrag) {
        const x = Math.min(e.clientX, camStartX);
        const y = Math.min(e.clientY, camStartY);
        const w = Math.abs(e.clientX - camStartX);
        const h = Math.abs(e.clientY - camStartY);
        selBox.style.display = 'none';
        if (w > 4 && h > 4) captureRegion(x, y, w, h);
      } else {
        const el = e.target;
        if (!isInspectorUI(el) && el !== document.body && el !== document.documentElement) {
          nudge(el);
          captureElement(el);
        }
      }
      camDidDrag = false;
    }, true);
  },

  activate() {
    state.cameraMode = true;
    state.active = true;
    document.body.style.cursor = 'crosshair';
    showToast('Camera ON — click element, drag area, or Cmd+Shift+S full page');
  },

  deactivate() {
    state.cameraMode = false;
    camDragging = false;
    if (selBox) selBox.style.display = 'none';
    // Clear any hovered element highlight from camera mode
    if (state.hovered) {
      state.hovered.style.outline = state.hovered._origOutline || '';
      state.hovered.style.backgroundColor = state.hovered._origBg || '';
      state.hovered = null;
    }
    // Clear full-page highlight if shift was held
    document.documentElement.style.outline = '';
    document.documentElement.style.backgroundColor = '';
    // Restore body cursor (set to crosshair in activate).
    document.body.style.cursor = '';
  },

  captureFullPage,

  enable() {},
  disable() { this.deactivate(); },
};
