import { state, inspectorUI } from '../core/state.js';
import { COLORS, CAM_OUTLINE, CAM_BG, Z } from '../core/constants.js';
import { showToast, nudge, flashElement, isInspectorUI, clearHover } from '../core/helpers.js';

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
  try {
    const blobPromise = new Promise(r => canvas.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
    showToast('Copied to clipboard');
  } catch (err) {
    try {
      const link = document.createElement('a');
      link.download = filename || 'screenshot.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('Downloaded screenshot');
    } catch (e2) {
      showToast('Clipboard failed — requires HTTPS or localhost');
    }
  }
}

async function captureElement(el) {
  await loadH2C();
  const oo = el.style.outline, ob = el.style.backgroundColor;
  el.style.outline = el._origOutline || '';
  el.style.backgroundColor = el._origBg || '';
  showToast('Capturing...');
  try {
    const canvas = await html2canvas(el, { backgroundColor: null, scale: 2, logging: false });
    await saveCapture(canvas, el);
  } catch (e) { showToast('Capture failed'); }
  el.style.outline = oo;
  el.style.backgroundColor = ob;
}

async function captureRegion(x, y, w, h) {
  await loadH2C();
  showToast('Capturing...');
  try {
    const scale = 2;
    const full = await html2canvas(document.documentElement, {
      backgroundColor: '#fff', scale, logging: false,
      scrollX: 0, scrollY: 0,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight
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

async function captureFullPage() {
  await loadH2C();
  showToast('Capturing full page...');
  try {
    const canvas = await html2canvas(document.documentElement, {
      backgroundColor: '#fff', scale: 2, logging: false,
      scrollX: 0, scrollY: 0,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      ignoreElements: (el) => inspectorUI.has(el)
    });
    await saveCapture(canvas, 'full-page-screenshot.png');
  } catch (e) { showToast('Full page capture failed'); }
}

export default {
  id: 'camera',
  label: 'Screenshots',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="12" r="3.2"/><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>',
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
      if (e.shiftKey) {
        e.preventDefault();
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
  },

  captureFullPage,

  enable() {},
  disable() { this.deactivate(); },
};
