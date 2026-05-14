import { state, inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { showToast } from '../core/helpers.js';
import { getSelectionColor, onColorChange } from '../core/theme.js';

// Pencil cursor — same icon as the toolbar button, white fill, 20x20 with hotspot at bottom-left tip
const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24'%3E%3Cpath d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' fill='%23fff' stroke='%23000' stroke-width='1.5'/%3E%3C/svg%3E") 2 18, crosshair`;

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

// --- Floating draw panel (draggable window) ---
function createDrawPanel() {
  const panel = document.createElement('div');
  panel.setAttribute('data-dt-ignore', '');
  Object.assign(panel.style, {
    position: 'fixed', top: '16px', right: '16px',
    zIndex: String(Z.toolbar + 1),
    background: 'rgba(30,30,30,0.85)', borderRadius: '10px', padding: '8px 10px',
    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '11px', userSelect: 'none', WebkitUserSelect: 'none',
    display: 'none',
  });
  inspectorUI.add(panel);

  // --- Drag handle header ---
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', gap: '5px',
    marginBottom: '6px', cursor: 'grab',
  });
  const grip = document.createElement('span');
  grip.textContent = '\u283F';
  Object.assign(grip.style, {
    color: 'rgba(255,255,255,0.35)', fontSize: '18px', lineHeight: '1',
  });
  const label = document.createElement('span');
  label.textContent = 'Brush';
  Object.assign(label.style, {
    color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: '600',
    letterSpacing: '0.5px', textTransform: 'uppercase',
  });
  header.appendChild(grip);
  header.appendChild(label);
  panel.appendChild(header);

  // Drag logic
  let dragging = false, dx = 0, dy = 0;
  header.addEventListener('mousedown', (e) => {
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;
    header.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let x = e.clientX - dx;
    let y = e.clientY - dy;
    // Clamp to viewport
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    x = Math.max(0, Math.min(window.innerWidth - pw, x));
    y = Math.max(0, Math.min(window.innerHeight - ph, y));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    header.style.cursor = 'grab';
  });

  // Color swatches
  const colorRow = document.createElement('div');
  Object.assign(colorRow.style, { display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' });
  panel.appendChild(colorRow);

  DRAW_COLORS.forEach(c => {
    const swatch = document.createElement('button');
    swatch.dataset.colorId = c.id;
    const fill = c.value || getSelectionColor();
    Object.assign(swatch.style, {
      width: '20px', height: '20px', borderRadius: '50%', border: '2px solid transparent',
      background: fill, cursor: 'pointer', padding: '0', transition: 'border-color 0.1s, transform 0.1s',
    });
    if (c.id === 'theme') {
      swatch.style.background = getSelectionColor();
    }
    swatch.addEventListener('click', () => {
      activeColorId = c.id;
      applyPenStyle();
      renderPanelState();
    });
    colorRow.appendChild(swatch);
  });

  // Size options (second row)
  const sizeRow = document.createElement('div');
  Object.assign(sizeRow.style, { display: 'flex', gap: '4px', alignItems: 'center', marginTop: '6px' });
  panel.appendChild(sizeRow);

  DRAW_SIZES.forEach(s => {
    const btn = document.createElement('button');
    btn.dataset.sizeId = s.id;
    const dotSize = Math.max(4, s.width * 2);
    Object.assign(btn.style, {
      width: '22px', height: '22px', borderRadius: '50%', border: '2px solid transparent',
      background: 'rgba(255,255,255,0.08)', cursor: 'pointer', padding: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.12s',
    });
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width: dotSize + 'px', height: dotSize + 'px', borderRadius: '50%', background: '#fff', display: 'block',
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
    btn.style.borderColor = isActive ? 'rgba(255,255,255,0.5)' : 'transparent';
    btn.style.background = isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)';
  });
}

// Convert a mouse event to canvas-local coordinates, accounting for
// any CSS transform on the parent wrapper (canvas-zoom).
function canvasCoords(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const scaleX = drawCanvas.clientWidth / rect.width;
  const scaleY = drawCanvas.clientHeight / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function resizeDrawCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const container = drawCanvas.parentElement || document.body;
  const pageW = Math.max(container.scrollWidth, document.documentElement.scrollWidth);
  const pageH = Math.max(container.scrollHeight, document.documentElement.scrollHeight);
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
    drawCanvas.setAttribute('data-dt-ignore', '');
    Object.assign(drawCanvas.style, {
      position: 'absolute', top: '0', left: '0', zIndex: String(Z.overlay), pointerEvents: 'none'
    });
    document.body.appendChild(drawCanvas);
    // NOTE: drawCanvas is intentionally NOT added to inspectorUI so that
    // canvas-zoom's ensureWrapper() moves it into #dt-canvas-wrapper.
    // This makes drawings scale with the page when zooming.
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
    inspectorUI.add(eraserCursor);
    let isErasing = false;

    // Prevent context menu on canvas
    drawCanvas.addEventListener('contextmenu', (e) => {
      if (state.annotateMode && state.annotateSub === 'pen') e.preventDefault();
    });

    drawCanvas.addEventListener('mousedown', (e) => {
      if (!state.annotateMode || state.annotateSub !== 'pen') return;
      const pos = canvasCoords(e);
      if (e.button === 2) {
        // Right-click: erase mode
        isErasing = true;
        eraserCursor.style.display = 'block';
        const ctx = drawCanvas.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ERASER_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        eraserCursor.style.left = (e.clientX - ERASER_SIZE / 2) + 'px';
        eraserCursor.style.top = (e.clientY - ERASER_SIZE / 2) + 'px';
        return;
      }
      isDrawing = true;
      const ctx = drawCanvas.getContext('2d');
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    });
    drawCanvas.addEventListener('mousemove', (e) => {
      if (isErasing) {
        eraserCursor.style.left = (e.clientX - ERASER_SIZE / 2) + 'px';
        eraserCursor.style.top = (e.clientY - ERASER_SIZE / 2) + 'px';
        const pos = canvasCoords(e);
        const ctx = drawCanvas.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ERASER_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      if (!isDrawing) return;
      const pos = canvasCoords(e);
      const ctx = drawCanvas.getContext('2d');
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    });
    drawCanvas.addEventListener('mouseup', () => { isDrawing = false; isErasing = false; eraserCursor.style.display = 'none'; });
    drawCanvas.addEventListener('mouseleave', () => { isDrawing = false; isErasing = false; eraserCursor.style.display = 'none'; });
  },

  activate() {
    state.annotateMode = true;
    state.annotateSub = 'pen';
    drawCanvas.style.pointerEvents = 'auto';
    document.body.style.cursor = PENCIL_CURSOR;
    drawCanvas.style.cursor = PENCIL_CURSOR;
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
