import { state, inspectorUI } from '../core/state.js';
import { COLORS, PEN_WIDTH, Z } from '../core/constants.js';
import { showToast } from '../core/helpers.js';

let drawCanvas = null;
let isDrawing = false;

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
  ctx.strokeStyle = COLORS.pen;
  ctx.lineWidth = PEN_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

export default {
  id: 'draw',
  label: 'Draw',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
    tooltip: 'Draw',
    color: COLORS.annotate,
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

    drawCanvas.addEventListener('mousedown', (e) => {
      if (!state.annotateMode || state.annotateSub !== 'pen') return;
      isDrawing = true;
      const ctx = drawCanvas.getContext('2d');
      ctx.beginPath();
      ctx.moveTo(e.clientX + window.scrollX, e.clientY + window.scrollY);
    });
    drawCanvas.addEventListener('mousemove', (e) => {
      if (!isDrawing) return;
      const ctx = drawCanvas.getContext('2d');
      ctx.lineTo(e.clientX + window.scrollX, e.clientY + window.scrollY);
      ctx.stroke();
    });
    drawCanvas.addEventListener('mouseup', () => { isDrawing = false; });
    drawCanvas.addEventListener('mouseleave', () => { isDrawing = false; });
  },

  activate() {
    state.annotateMode = true;
    state.annotateSub = 'pen';
    drawCanvas.style.pointerEvents = 'auto';
    document.body.style.cursor = 'crosshair';
    showToast('Draw mode (X=clear)');
  },

  deactivate() {
    if (state.annotateSub === 'pen') {
      state.annotateMode = false;
    }
    isDrawing = false;
    if (drawCanvas) drawCanvas.style.pointerEvents = 'none';
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
