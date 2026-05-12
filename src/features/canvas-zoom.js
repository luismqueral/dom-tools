/**
 * Canvas Zoom & Pan — Figma-style navigation.
 *
 * - Cmd + Scroll: zoom in/out via transform scale (not browser zoom)
 * - Spacebar + Drag: pan the canvas via transform translate
 *
 * Transforms are applied to a wrapper div that contains all page
 * content. Inspector UI (toolbar, overlays) lives outside the wrapper
 * so it stays fixed and usable at any zoom level.
 */

import { state, inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { isInspectorUI } from '../core/helpers.js';
import { isExperimentEnabled } from '../settings.js';

let active = false;
let wrapper = null;

// Transform state
let scale = 1;
let panX = 0;
let panY = 0;

// Interaction state
let spaceHeld = false;
let panning = false;
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;

// Hold-threshold: if spacebar is held longer than this, activate hand
// tool even inside text inputs. Mimics Figma behavior.
const SPACE_HOLD_MS = 200;
let spaceDownTime = 0;
let spaceHoldTimer = null;
let spaceWasInInput = false;

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_SPEED = 0.002;

// --- Zoom level indicator (tldraw-style) ---
let zoomIndicator = null;
let hideTimeout = null;

function ensureZoomIndicator() {
  if (zoomIndicator) return;
  zoomIndicator = document.createElement('div');
  Object.assign(zoomIndicator.style, {
    position: 'fixed',
    bottom: '72px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(30,30,30,0.85)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '4px 10px',
    borderRadius: '6px',
    zIndex: String(Z.toolbar + 1),
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.15s ease',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  });
  document.body.appendChild(zoomIndicator);
  inspectorUI.add(zoomIndicator);
}

function showZoomLevel() {
  ensureZoomIndicator();
  zoomIndicator.textContent = Math.round(scale * 100) + '%';
  zoomIndicator.style.opacity = '1';
  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    if (zoomIndicator) zoomIndicator.style.opacity = '0';
  }, 1200);
}

// --- Minimap (bottom-right viewport overview with page thumbnail) ---
let minimap = null;
let minimapCanvas = null;
let minimapViewport = null;
let minimapCtx = null;
let thumbnailDirty = true;

const MAP_W = 160;
const MAP_H = 120;
const MAP_PAD = 6;

function ensureMinimap() {
  if (minimap) return;
  minimap = document.createElement('div');
  Object.assign(minimap.style, {
    position: 'fixed',
    bottom: '72px',
    right: '16px',
    width: MAP_W + 'px',
    height: MAP_H + 'px',
    background: 'rgba(30,30,30,0.9)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    zIndex: String(Z.toolbar + 1),
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.2s ease',
    overflow: 'hidden',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  });

  // Canvas for page thumbnail
  minimapCanvas = document.createElement('canvas');
  minimapCanvas.width = MAP_W * 2; // retina
  minimapCanvas.height = MAP_H * 2;
  Object.assign(minimapCanvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
  });
  minimapCtx = minimapCanvas.getContext('2d');
  minimap.appendChild(minimapCanvas);

  // Viewport rectangle overlay
  minimapViewport = document.createElement('div');
  Object.assign(minimapViewport.style, {
    position: 'absolute',
    border: '1.5px solid #60a5fa',
    borderRadius: '2px',
    background: 'rgba(96,165,250,0.1)',
  });
  minimap.appendChild(minimapViewport);

  document.body.appendChild(minimap);
  inspectorUI.add(minimap);
}

// Render a lightweight thumbnail of the page by sampling visible elements
// and drawing colored blocks. Not pixel-perfect, but gives spatial context.
function renderThumbnail() {
  if (!minimapCtx || !wrapper) return;
  thumbnailDirty = false;

  const ctx = minimapCtx;
  const dpr = 2;
  const cW = MAP_W * dpr;
  const cH = MAP_H * dpr;
  const pad = MAP_PAD * dpr;
  const innerW = cW - pad * 2;
  const innerH = cH - pad * 2;

  const docW = wrapper.scrollWidth;
  const docH = wrapper.scrollHeight;

  // Fit document proportionally
  const docAspect = docW / docH;
  const mapAspect = innerW / innerH;
  let drawW, drawH;
  if (docAspect > mapAspect) {
    drawW = innerW;
    drawH = innerW / docAspect;
  } else {
    drawH = innerH;
    drawW = innerH * docAspect;
  }
  const offsetX = pad + (innerW - drawW) / 2;
  const offsetY = pad + (innerH - drawH) / 2;
  const s = drawW / docW;

  // Clear
  ctx.clearRect(0, 0, cW, cH);

  // Document background
  ctx.fillStyle = '#fff';
  ctx.fillRect(offsetX, offsetY, drawW, drawH);

  // Sample visible elements and draw blocks
  const els = wrapper.querySelectorAll('*');
  const wrapperRect = wrapper.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  for (let i = 0; i < els.length && i < 300; i++) {
    const el = els[i];
    if (inspectorUI.has(el)) continue;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) continue;

    const r = el.getBoundingClientRect();
    // Position relative to wrapper's content origin
    const x = (r.left - wrapperRect.left + wrapper.scrollLeft) * s;
    const y = (r.top - wrapperRect.top + wrapper.scrollTop) * s;
    const w = r.width * s;
    const h = r.height * s;

    if (w < 1 || h < 1) continue;

    // Sample the element's color
    const computed = window.getComputedStyle(el);
    const bg = computed.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.fillRect(offsetX + x, offsetY + y, w, h);
    }

    // Draw text-like elements as grey lines
    const tag = el.tagName;
    if (['P','H1','H2','H3','H4','H5','H6','SPAN','A','LI','LABEL'].includes(tag)) {
      ctx.fillStyle = 'rgba(60,60,60,0.25)';
      const lineH = Math.max(1.5, h * 0.4);
      ctx.fillRect(offsetX + x, offsetY + y + (h - lineH) / 2, w * 0.85, lineH);
    }

    // Images get a subtle grey fill
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'SVG') {
      ctx.fillStyle = 'rgba(120,120,120,0.2)';
      ctx.fillRect(offsetX + x, offsetY + y, w, h);
    }
  }
}

function updateMinimap() {
  if (!minimap || !wrapper) return;

  const show = scale !== 1 || panX !== 0 || panY !== 0;
  minimap.style.opacity = show ? '1' : '0';
  if (!show) return;

  // Render thumbnail once and keep it static — only the viewport rect moves
  if (thumbnailDirty) renderThumbnail();

  const dpr = 2;
  const pad = MAP_PAD;
  const innerW = MAP_W - pad * 2;
  const innerH = MAP_H - pad * 2;

  const docW = wrapper.scrollWidth;
  const docH = wrapper.scrollHeight;

  const docAspect = docW / docH;
  const mapAspect = innerW / innerH;
  let drawW, drawH;
  if (docAspect > mapAspect) {
    drawW = innerW;
    drawH = innerW / docAspect;
  } else {
    drawH = innerH;
    drawW = innerH * docAspect;
  }
  const offsetX = pad + (innerW - drawW) / 2;
  const offsetY = pad + (innerH - drawH) / 2;
  const s = drawW / docW;

  // Viewport in document coordinates
  const vpW = window.innerWidth / scale;
  const vpH = window.innerHeight / scale;
  const vpX = -panX / scale;
  const vpY = -panY / scale;

  Object.assign(minimapViewport.style, {
    left: (offsetX + vpX * s) + 'px',
    top: (offsetY + vpY * s) + 'px',
    width: Math.min(vpW * s, drawW) + 'px',
    height: Math.min(vpH * s, drawH) + 'px',
  });
}

function invalidateThumbnail() { thumbnailDirty = true; }

// --- Content wrapper ---
// Wraps all page content so transforms don't affect inspector UI.

function ensureWrapper() {
  if (wrapper) return;
  wrapper = document.createElement('div');
  wrapper.id = 'dt-canvas-wrapper';
  wrapper.style.transformOrigin = '0 0';
  wrapper.style.minHeight = '100vh';

  // Move all existing body children into the wrapper, except
  // elements that belong to the inspector UI.
  const children = Array.from(document.body.childNodes);
  for (const child of children) {
    if (child.nodeType === 1 && inspectorUI.has(child)) continue;
    wrapper.appendChild(child);
  }
  // Insert wrapper as first child of body (before any inspector UI nodes)
  document.body.insertBefore(wrapper, document.body.firstChild);
}

// --- Canvas background with contrast ---
// Parse an rgb/rgba string into [r, g, b]. Returns null if unparseable.
function parseRgb(str) {
  if (!str) return null;
  const m = str.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

// Perceived luminance (0–255 scale, rough)
function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Pick a canvas bg that contrasts with the document's background.
// Light documents get a medium grey canvas; dark documents get a lighter one.
// Mid-tone documents (greys) get a darker canvas for separation.
function computeCanvasBg(docBgStr) {
  const rgb = parseRgb(docBgStr);
  if (!rgb) return '#e5e5e5';
  const lum = luminance(...rgb);
  if (lum > 200) return '#d4d4d4';      // white/light → medium grey
  if (lum > 140) return '#9ca3af';      // mid-light (grey sites) → darker grey
  if (lum > 80)  return '#4b5563';      // mid-dark → dark grey
  return '#374151';                      // dark → slightly lighter dark
}

// --- Transform application ---

// Snapshot the page's original background before we ever touch it.
let originalDocBg = null;

function snapshotDocBg() {
  if (originalDocBg !== null) return;
  const isTransparent = (c) => !c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
  const bodyBg = window.getComputedStyle(document.body).backgroundColor;
  const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
  originalDocBg = !isTransparent(bodyBg) ? bodyBg : !isTransparent(htmlBg) ? htmlBg : '#fff';
}

function applyTransform() {
  if (!wrapper) return;
  wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  ensureMinimap();
  updateMinimap();

  const zoomed = scale !== 1;
  if (zoomed) {
    if (!wrapper.dataset.dtBgSet) {
      snapshotDocBg();
      wrapper.style.background = originalDocBg;
      wrapper.style.padding = '16px';
      wrapper.style.border = '1px solid #d1d5db';
      wrapper.style.borderRadius = '4px';
      wrapper.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)';
      wrapper.dataset.dtBgSet = '1';
    }
    document.body.style.background = computeCanvasBg(originalDocBg);
  } else {
    document.body.style.background = '';
    wrapper.style.background = '';
    wrapper.style.padding = '';
    wrapper.style.border = '';
    wrapper.style.borderRadius = '';
    wrapper.style.boxShadow = '';
    delete wrapper.dataset.dtBgSet;
  }
  showZoomLevel();
}

function resetTransform() {
  scale = 1;
  panX = 0;
  panY = 0;
  if (wrapper) {
    wrapper.style.transform = '';
    wrapper.style.background = '';
    wrapper.style.padding = '';
    wrapper.style.border = '';
    wrapper.style.borderRadius = '';
    wrapper.style.boxShadow = '';
    delete wrapper.dataset.dtBgSet;
  }
  document.body.style.background = '';
  updateMinimap();
  showZoomLevel();
}

// --- Cursor styles ---

function ensureCursorStyles() {
  if (document.getElementById('dt-zoom-cursor-styles')) return;
  const style = document.createElement('style');
  style.id = 'dt-zoom-cursor-styles';
  style.textContent = `
    html.dt-space-grab, html.dt-space-grab body,
    html.dt-space-grab body *,
    html.dt-comment-active.dt-space-grab body,
    html.dt-comment-active.dt-space-grab body * {
      cursor: grab !important;
    }
    html.dt-space-grabbing, html.dt-space-grabbing body,
    html.dt-space-grabbing body *,
    html.dt-comment-active.dt-space-grabbing body,
    html.dt-comment-active.dt-space-grabbing body * {
      cursor: grabbing !important;
    }
    /* Hide all markings and selection outlines while hand tool is active */
    html.dt-space-grab [data-dt-tag-label],
    html.dt-space-grab [data-dt-bubble],
    html.dt-space-grabbing [data-dt-tag-label],
    html.dt-space-grabbing [data-dt-bubble] {
      opacity: 0 !important;
      pointer-events: none !important;
    }
    html.dt-space-grab #dt-canvas-wrapper *,
    html.dt-space-grabbing #dt-canvas-wrapper * {
      outline: transparent !important;
    }
  `;
  document.head.appendChild(style);
  inspectorUI.add(style);
}

function setCursorState(cursorState) {
  const html = document.documentElement;
  html.classList.remove('dt-space-grab', 'dt-space-grabbing');
  if (cursorState === 'grab') html.classList.add('dt-space-grab');
  else if (cursorState === 'grabbing') html.classList.add('dt-space-grabbing');
}

// --- Zoom (Cmd + Scroll) — only when experiment is enabled ---

function onWheel(e) {
  if (!active) return;
  if (!e.metaKey && !e.ctrlKey) return;
  if (!isExperimentEnabled('canvas-zoom')) return;

  e.preventDefault();

  // Cursor position in content coordinates (before transform)
  const cursorX = (e.clientX - panX) / scale;
  const cursorY = (e.clientY - panY) / scale;

  const delta = -e.deltaY * ZOOM_SPEED;
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 + delta)));

  // Adjust pan so the point under the cursor stays fixed
  panX = e.clientX - cursorX * newScale;
  panY = e.clientY - cursorY * newScale;
  scale = newScale;

  applyTransform();
}

// --- Pan (Spacebar + Drag) ---

function activateHandTool() {
  spaceHeld = true;
  state.handToolActive = true;
  document.documentElement.style.userSelect = 'none';
  document.documentElement.style.webkitUserSelect = 'none';
  if (!panning) setCursorState('grab');
  // If we took over from a text input, remove the space character that
  // may have been typed before the threshold fired.
  if (spaceWasInInput) {
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.value.endsWith(' ')) {
      el.value = el.value.slice(0, -1);
    }
    el && el.blur && el.blur();
  }
}

function onKeyDown(e) {
  if (!active) return;
  // Cmd+Esc or Cmd+0 resets zoom & pan to 100%
  if (((e.key === 'Escape' || e.key === '0') && (e.metaKey || e.ctrlKey)) && scale !== 1) {
    e.preventDefault();
    e.stopPropagation();
    resetTransform();
    return;
  }
  // Cmd+- / Cmd+= : reset canvas transform and let browser zoom through
  if ((e.key === '-' || e.key === '=' || e.key === '+') && (e.metaKey || e.ctrlKey) && scale !== 1) {
    resetTransform();
    // Don't preventDefault — let the browser handle its native zoom
    return;
  }
  if (e.key !== ' ') return;
  // Hand tool is gated behind the canvas-zoom experiment
  if (!isExperimentEnabled('canvas-zoom')) return;
  if (e.repeat) {
    // If already in hand mode from threshold, suppress repeats
    if (spaceHeld) { e.preventDefault(); e.stopImmediatePropagation(); }
    return;
  }

  const inInput = isTypingTarget(e.target) || (e.target.closest && e.target.closest('[data-dt-bubble]') && !e.target.readOnly);
  spaceWasInInput = inInput;

  if (!inInput) {
    // Not in a text field — activate immediately
    e.preventDefault();
    e.stopImmediatePropagation();
    activateHandTool();
  } else {
    // In a text field — start a hold timer. If they hold past the
    // threshold, activate hand tool; if they release before, it was
    // just a space character typed.
    spaceDownTime = Date.now();
    spaceHoldTimer = setTimeout(() => {
      spaceHoldTimer = null;
      activateHandTool();
    }, SPACE_HOLD_MS);
  }
}

function onKeyUp(e) {
  if (!active) return;
  if (e.key !== ' ') return;

  // Clear hold timer if it hasn't fired yet (was a quick tap in input)
  if (spaceHoldTimer) {
    clearTimeout(spaceHoldTimer);
    spaceHoldTimer = null;
    // Let the space character stay — it was just a normal keystroke
    return;
  }

  if (!spaceHeld) return;

  e.preventDefault();
  e.stopImmediatePropagation();
  spaceHeld = false;
  state.handToolActive = false;
  spaceWasInInput = false;
  document.documentElement.style.userSelect = '';
  document.documentElement.style.webkitUserSelect = '';
  if (panning) {
    endPan();
  }
  setCursorState(null);
}

function onMouseDown(e) {
  if (!active || !spaceHeld) return;
  if (e.button !== 0) return;

  e.preventDefault();
  e.stopPropagation();

  panning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartPanX = panX;
  panStartPanY = panY;
  setCursorState('grabbing');
}

function onMouseMove(e) {
  if (!active || !panning) return;

  e.preventDefault();
  e.stopPropagation();

  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;

  if (scale === 1) {
    // At 1x zoom, scroll the page (hand-tool feel)
    window.scrollBy(panStartX - e.clientX, panStartY - e.clientY);
    panStartX = e.clientX;
    panStartY = e.clientY;
  } else {
    // When zoomed, pan the canvas via translate
    panX = panStartPanX + dx;
    panY = panStartPanY + dy;
    applyTransform();
  }
}

function onMouseUp(e) {
  if (!active || !panning) return;
  e.preventDefault();
  e.stopPropagation();
  endPan();
}

function endPan() {
  panning = false;
  setCursorState(spaceHeld ? 'grab' : null);
}

function onKeyPress(e) {
  if (!active) return;
  if (spaceHeld && e.key === ' ') {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

function onWindowBlur() {
  spaceHeld = false;
  state.handToolActive = false;
  document.documentElement.style.userSelect = '';
  document.documentElement.style.webkitUserSelect = '';
  if (panning) endPan();
  setCursorState(null);
}

// Don't hijack spacebar when the user is typing
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export default {
  id: 'canvas-zoom',
  label: 'Canvas Zoom',
  enabledByDefault: true,

  init() {
    active = true;
    ensureCursorStyles();
    if (isExperimentEnabled('canvas-zoom')) ensureWrapper();

    // Wheel must be passive:false to allow preventDefault on Cmd+Scroll
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keypress', onKeyPress, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('blur', onWindowBlur);
  },

  enable() { active = true; },
  disable() {
    active = false;
    resetTransform();
    setCursorState(null);
    spaceHeld = false;
    panning = false;
  },

  // Expose for other modules if needed
  getScale() { return scale; },
  reset() { resetTransform(); },
};
