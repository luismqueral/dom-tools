import { state, inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { showToast } from '../core/helpers.js';
import { getSelectionColor, onColorChange } from '../core/theme.js';

let drawCanvas = null;
let isDrawing = false;
let drawPanel = null;

// --- Draw settings (user-selectable via panel) ---
const DRAW_COLORS = [
  { id: 'theme', value: null, label: 'Theme' },  // uses getSelectionColor()
  { id: 'black', value: '#1e1e1e', label: 'Black' },
  { id: 'red', value: '#e03131', label: 'Red' },
  { id: 'orange', value: '#f76707', label: 'Orange' },
  { id: 'green', value: '#2f9e44', label: 'Green' },
  { id: 'blue', value: '#1971c2', label: 'Blue' },
  { id: 'violet', value: '#7048e8', label: 'Violet' },
];
const DRAW_SIZES = [
  { id: 'S', width: 1.5 },
  { id: 'M', width: 3 },
  { id: 'L', width: 5 },
  { id: 'XL', width: 8 },
];
let activeColorId = 'theme';
let activeSizeId = 'M';

function getDrawColor() {
  const opt = DRAW_COLORS.find(c => c.id === activeColorId);
  return (opt && opt.value) || getSelectionColor();
}
function getDrawWidth() {
  return (DRAW_SIZES.find(s => s.id === activeSizeId) || DRAW_SIZES[1]).width;
}

function applyPenStyle() {
  if (!drawCanvas) return;
  const ctx = drawCanvas.getContext('2d');
  ctx.strokeStyle = getDrawColor();
  ctx.lineWidth = getDrawWidth();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

// --- Floating draw panel (top-right, tldraw-style) ---
function createDrawPanel() {
  const panel = document.createElement('div');
  panel.setAttribute('data-dt-ignore', '');
  Object.assign(panel.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: String(Z.toolbar + 1),
    background: '#fff', borderRadius: '12px', padding: '12px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.06)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '11px', userSelect: 'none', WebkitUserSelect: 'none',
    display: 'none', minWidth: '148px',
  });
  inspectorUI.add(panel);

  // Color swatches
  const colorLabel = document.createElement('div');
  colorLabel.textContent = 'Color';
  Object.assign(colorLabel.style, { fontSize: '10px', fontWeight: '600', color: '#6b7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' });
  panel.appendChild(colorLabel);

  const colorRow = document.createElement('div');
  Object.assign(colorRow.style, { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' });
  panel.appendChild(colorRow);

  DRAW_COLORS.forEach(c => {
    const swatch = document.createElement('button');
    swatch.dataset.colorId = c.id;
    const fill = c.value || getSelectionColor();
    Object.assign(swatch.style, {
      width: '22px', height: '22px', borderRadius: '50%', border: '2px solid transparent',
      background: fill, cursor: 'pointer', padding: '0', transition: 'border-color 0.1s, transform 0.1s',
    });
    if (c.id === 'theme') {
      // Gradient ring to indicate "theme" swatch
      swatch.style.background = getSelectionColor();
    }
    swatch.addEventListener('click', () => {
      activeColorId = c.id;
      applyPenStyle();
      renderPanelState();
    });
    colorRow.appendChild(swatch);
  });

  // Size options
  const sizeLabel = document.createElement('div');
  sizeLabel.textContent = 'Size';
  Object.assign(sizeLabel.style, { fontSize: '10px', fontWeight: '600', color: '#6b7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' });
  panel.appendChild(sizeLabel);

  const sizeRow = document.createElement('div');
  Object.assign(sizeRow.style, { display: 'flex', gap: '6px', alignItems: 'center' });
  panel.appendChild(sizeRow);

  DRAW_SIZES.forEach(s => {
    const btn = document.createElement('button');
    btn.dataset.sizeId = s.id;
    const dotSize = Math.max(6, s.width * 2.2);
    Object.assign(btn.style, {
      width: '32px', height: '28px', borderRadius: '6px', border: '1.5px solid #e5e7eb',
      background: '#fff', cursor: 'pointer', padding: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.1s, background 0.1s',
    });
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width: dotSize + 'px', height: dotSize + 'px', borderRadius: '50%', background: '#374151', display: 'block',
    });
    btn.appendChild(dot);
    btn.addEventListener('click', () => {
      activeSizeId = s.id;
      applyPenStyle();
      renderPanelState();
    });
    sizeRow.appendChild(btn);
  });

  document.body.appendChild(panel);
  return panel;
}

function renderPanelState() {
  if (!drawPanel) return;
  // Update color swatches
  drawPanel.querySelectorAll('[data-color-id]').forEach(swatch => {
    const isActive = swatch.dataset.colorId === activeColorId;
    swatch.style.borderColor = isActive ? getSelectionColor() : 'transparent';
    swatch.style.transform = isActive ? 'scale(1.15)' : 'scale(1)';
    // Keep theme swatch synced with current theme color
    if (swatch.dataset.colorId === 'theme') {
      swatch.style.background = getSelectionColor();
    }
  });
  // Update size buttons
  drawPanel.querySelectorAll('[data-size-id]').forEach(btn => {
    const isActive = btn.dataset.sizeId === activeSizeId;
    btn.style.borderColor = isActive ? getSelectionColor() : '#e5e7eb';
    btn.style.background = isActive ? getSelectionColor() + '12' : '#fff';
  });
}

function resizeDrawCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const pageW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const oldData = drawCanvas.width > 0 ? drawCanvas.getContext('2d').getImageData(0, 0, drawCanvas.width, drawCanvas.height) : null;
  drawCanvas.width = pageW * dpr;
  drawCanvas.height = pageH * dpr;
  drawCanvas.style.width = pageW + 'px';
  drawCanvas.style.height = pageH + 'px';
  const ctx = drawCanvas.getContext('2d');
  ctx.scale(dpr, dpr);
  if (oldData) ctx.putImageData(oldData, 0, 0);
  applyPenStyle();
}

export default {
  id: 'draw',
  label: 'Draw',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
    tooltip: 'Draw',
    color: '#3b82f6',
    order: 10,
  },

  shortcuts: [],

  init() {
    drawCanvas = document.createElement('canvas');
    Object.assign(drawCanvas.style, {
      position: 'absolute', top: '0', left: '0', zIndex: String(Z.overlay), pointerEvents: 'none'
    });
    document.body.appendChild(drawCanvas);
    inspectorUI.add(drawCanvas);
    resizeDrawCanvas();
    window.addEventListener('resize', resizeDrawCanvas);
    // Theme swap → re-arm the context so the next stroke uses the new
    // color. (Existing strokes stay as-is; we don't keep a vector log.)
    onColorChange(() => { applyPenStyle(); renderPanelState(); });

    // Eraser cursor (follows mouse during right-click erase)
    const ERASER_SIZE = 20;
    const eraserCursor = document.createElement('div');
    Object.assign(eraserCursor.style, {
      position: 'fixed', width: ERASER_SIZE + 'px', height: ERASER_SIZE + 'px',
      border: '2px solid #666', borderRadius: '50%', pointerEvents: 'none',
      display: 'none', zIndex: '100003', background: 'rgba(255,255,255,0.3)'
    });
    document.body.appendChild(eraserCursor);
    let isErasing = false;

    // Prevent context menu on canvas
    drawCanvas.addEventListener('contextmenu', (e) => {
      if (state.annotateMode && state.annotateSub === 'pen') e.preventDefault();
    });

    drawCanvas.addEventListener('mousedown', (e) => {
      if (!state.annotateMode || state.annotateSub !== 'pen') return;
      if (e.button === 2) {
        // Right-click: erase mode
        isErasing = true;
        eraserCursor.style.display = 'block';
        const ctx = drawCanvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const x = (e.clientX + window.scrollX) * dpr;
        const y = (e.clientY + window.scrollY) * dpr;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x / dpr, y / dpr, ERASER_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        eraserCursor.style.left = (e.clientX - ERASER_SIZE / 2) + 'px';
        eraserCursor.style.top = (e.clientY - ERASER_SIZE / 2) + 'px';
        return;
      }
      isDrawing = true;
      const ctx = drawCanvas.getContext('2d');
      ctx.beginPath();
      ctx.moveTo(e.clientX + window.scrollX, e.clientY + window.scrollY);
    });
    drawCanvas.addEventListener('mousemove', (e) => {
      if (isErasing) {
        eraserCursor.style.left = (e.clientX - ERASER_SIZE / 2) + 'px';
        eraserCursor.style.top = (e.clientY - ERASER_SIZE / 2) + 'px';
        const ctx = drawCanvas.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(e.clientX + window.scrollX, e.clientY + window.scrollY, ERASER_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      if (!isDrawing) return;
      const ctx = drawCanvas.getContext('2d');
      ctx.lineTo(e.clientX + window.scrollX, e.clientY + window.scrollY);
      ctx.stroke();
    });
    drawCanvas.addEventListener('mouseup', () => { isDrawing = false; isErasing = false; eraserCursor.style.display = 'none'; });
    drawCanvas.addEventListener('mouseleave', () => { isDrawing = false; isErasing = false; eraserCursor.style.display = 'none'; });
  },

  activate() {
    state.annotateMode = true;
    state.annotateSub = 'pen';
    drawCanvas.style.pointerEvents = 'auto';
    document.body.style.cursor = 'crosshair';
    drawCanvas.style.cursor = 'crosshair';
    if (!drawPanel) drawPanel = createDrawPanel();
    drawPanel.style.display = 'block';
    renderPanelState();
    showToast('Draw mode');
  },

  deactivate() {
    if (state.annotateSub === 'pen') {
      state.annotateMode = false;
    }
    isDrawing = false;
    if (drawCanvas) {
      drawCanvas.style.pointerEvents = 'none';
      drawCanvas.style.cursor = '';
    }
    if (drawPanel) drawPanel.style.display = 'none';
    document.body.style.cursor = '';
  },

  clear() {
    if (!drawCanvas) return;
    const ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    showToast('Drawing cleared');
  },

  enable() {},
  disable() { this.deactivate(); },
};
