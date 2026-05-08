/**
 * Duplicate element experiment.
 *
 * Hold Shift and click-drag any element to spawn a clone that follows
 * the cursor. On mouseup the clone gets dropped into the DOM:
 *   - DOM reorder mode (if Move is also enabled): clone is inserted at
 *     the nearest sibling boundary under the cursor, just like Move.
 *   - Otherwise: clone is appended to the original's parent at the end.
 *
 * Keep it independent of Move so you can run either or both. Shift is
 * the modifier so it doesn't collide with Cmd (Move) or right-click
 * (copy selector).
 */

import { inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { isInspectorUI, showToast } from '../core/helpers.js';
import { getSelectionColor, withAlpha } from '../core/theme.js';

let active = false;
let shiftHeld = false;
let dragging = false;
let sourceEl = null;     // the original element being duplicated
let cloneEl = null;      // the live DOM clone we're dropping
let ghostEl = null;      // the floating preview that follows the cursor
let indicator = null;
let dropTarget = null;
let startX = 0, startY = 0;

function ensureCursorStyles() {
  if (document.getElementById('dt-dup-cursor-styles')) return;
  const style = document.createElement('style');
  style.id = 'dt-dup-cursor-styles';
  style.textContent = `
    html.dt-dup-active, html.dt-dup-active body, html.dt-dup-active body * {
      cursor: copy !important;
    }
    html.dt-dup-dragging, html.dt-dup-dragging body, html.dt-dup-dragging body * {
      cursor: copy !important;
    }
  `;
  document.head.appendChild(style);
}

function setDupState(state) {
  const html = document.documentElement;
  html.classList.remove('dt-dup-active', 'dt-dup-dragging');
  if (state === 'active') html.classList.add('dt-dup-active');
  else if (state === 'dragging') html.classList.add('dt-dup-dragging');
}

function isDuplicable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el === document.body || el === document.documentElement) return false;
  if (isInspectorUI(el)) return false;
  return true;
}

let hoverPreview = null;
function setHoverPreview(el) {
  if (hoverPreview === el) return;
  clearHoverPreview();
  if (!el) return;
  hoverPreview = el;
  hoverPreview._dt_dup_origOutline = el.style.outline || '';
  hoverPreview._dt_dup_origOutlineOffset = el.style.outlineOffset || '';
  el.style.outline = '2px dashed ' + getSelectionColor();
  el.style.outlineOffset = '2px';
}
function clearHoverPreview() {
  if (!hoverPreview) return;
  hoverPreview.style.outline = hoverPreview._dt_dup_origOutline || '';
  hoverPreview.style.outlineOffset = hoverPreview._dt_dup_origOutlineOffset || '';
  delete hoverPreview._dt_dup_origOutline;
  delete hoverPreview._dt_dup_origOutlineOffset;
  hoverPreview = null;
}

function createGhost(el) {
  const r = el.getBoundingClientRect();
  const clone = el.cloneNode(true);
  clone.removeAttribute('id');
  Object.assign(clone.style, {
    position: 'fixed',
    left: r.left + 'px',
    top: r.top + 'px',
    width: r.width + 'px',
    height: r.height + 'px',
    margin: '0',
    pointerEvents: 'none',
    opacity: '0.7',
    zIndex: String(Z.toolbar + 5),
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
    outline: '2px solid ' + getSelectionColor(),
    transition: 'none',
  });
  document.body.appendChild(clone);
  inspectorUI.add(clone);
  return clone;
}

function destroyGhost() {
  if (!ghostEl) return;
  inspectorUI.delete(ghostEl);
  ghostEl.remove();
  ghostEl = null;
}

function createIndicator() {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute',
    background: getSelectionColor(),
    boxShadow: '0 0 0 2px ' + withAlpha(getSelectionColor(), 0.3),
    borderRadius: '2px',
    zIndex: String(Z.toolbar + 4),
    pointerEvents: 'none',
    display: 'none',
  });
  document.body.appendChild(el);
  inspectorUI.add(el);
  return el;
}

function destroyIndicator() {
  if (!indicator) return;
  inspectorUI.delete(indicator);
  indicator.remove();
  indicator = null;
}

// Pick a sibling-of-source landing spot under the cursor. Mirrors the
// approach used in move.js but operates relative to `sourceEl` so the
// clone naturally appears near the original by default.
function pickDropTarget(clientX, clientY) {
  if (ghostEl) ghostEl.style.display = 'none';
  const under = document.elementFromPoint(clientX, clientY);
  if (ghostEl) ghostEl.style.display = '';

  if (!under || isInspectorUI(under)) return null;
  if (under === sourceEl || (sourceEl && sourceEl.contains(under))) {
    // Hovering over the original — drop right after it.
    return { parent: sourceEl.parentElement, before: sourceEl.nextSibling, refRect: sourceEl.getBoundingClientRect(), horizontal: false };
  }

  let candidate = under;
  while (candidate && candidate.parentElement) {
    if (candidate.parentElement === sourceEl.parentElement) break;
    candidate = candidate.parentElement;
  }
  if (!candidate || candidate.parentElement !== sourceEl.parentElement) {
    candidate = under;
    while (candidate && candidate.parentElement) {
      if (!candidate.parentElement.contains(sourceEl)) break;
      candidate = candidate.parentElement;
    }
    if (!candidate || !candidate.parentElement) return null;
  }

  const parent = candidate.parentElement;
  const r = candidate.getBoundingClientRect();
  const parentStyle = getComputedStyle(parent);
  const horizontal = parentStyle.display.includes('flex')
    && (parentStyle.flexDirection === 'row' || parentStyle.flexDirection === 'row-reverse');

  let before;
  if (horizontal) {
    const mid = r.left + r.width / 2;
    before = clientX < mid ? candidate : candidate.nextSibling;
  } else {
    const mid = r.top + r.height / 2;
    before = clientY < mid ? candidate : candidate.nextSibling;
  }

  return { parent, before, refRect: r, horizontal };
}

function showIndicator(target) {
  if (!indicator) indicator = createIndicator();
  if (!target) {
    indicator.style.display = 'none';
    return;
  }
  const r = target.refRect;
  const before = target.before;
  if (target.horizontal) {
    const x = before ? before.getBoundingClientRect().left : r.right;
    indicator.style.left = (x + window.scrollX - 1) + 'px';
    indicator.style.top = (r.top + window.scrollY) + 'px';
    indicator.style.width = '2px';
    indicator.style.height = r.height + 'px';
  } else {
    const y = before ? before.getBoundingClientRect().top : r.bottom;
    indicator.style.left = (r.left + window.scrollX) + 'px';
    indicator.style.top = (y + window.scrollY - 1) + 'px';
    indicator.style.width = r.width + 'px';
    indicator.style.height = '2px';
  }
  indicator.style.display = 'block';
}

function startDrag(e) {
  const el = e.target;
  if (!isDuplicable(el)) return;
  dragging = true;
  sourceEl = el;
  startX = e.clientX;
  startY = e.clientY;
  ghostEl = createGhost(el);
  setDupState('dragging');
  e.preventDefault();
  e.stopPropagation();
}

function updateDrag(e) {
  if (!dragging || !ghostEl) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  ghostEl.style.transform = `translate(${dx}px, ${dy}px)`;
  dropTarget = pickDropTarget(e.clientX, e.clientY);
  showIndicator(dropTarget);
}

function commitDrag() {
  if (!dragging) return;
  dragging = false;

  if (sourceEl) {
    cloneEl = sourceEl.cloneNode(true);
    // Strip ids on the clone so we don't end up with two same-id els.
    if (cloneEl.id) cloneEl.removeAttribute('id');
    cloneEl.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));

    let placed = false;
    if (dropTarget && dropTarget.parent) {
      try {
        dropTarget.parent.insertBefore(cloneEl, dropTarget.before);
        placed = true;
      } catch (_) {}
    }
    if (!placed) {
      // Fallback: drop the clone right after the original.
      sourceEl.parentNode.insertBefore(cloneEl, sourceEl.nextSibling);
    }
    // Brief flash on the new clone so the user sees where it landed.
    flashElement(cloneEl);
    showToast('Element duplicated');
  }
  finishDrag();
}

function flashElement(el) {
  const orig = el.style.outline || '';
  el.style.outline = '2px solid ' + getSelectionColor();
  setTimeout(() => { el.style.outline = orig; }, 600);
}

function cancelDrag() {
  if (!dragging) return;
  dragging = false;
  finishDrag();
}

function finishDrag() {
  destroyGhost();
  destroyIndicator();
  dropTarget = null;
  sourceEl = null;
  setDupState(shiftHeld ? 'active' : null);
}

function onKeyDown(e) {
  if (!active) return;
  if (e.key === 'Shift') {
    shiftHeld = true;
    if (!dragging) setDupState('active');
  } else if (e.key === 'Escape' && dragging) {
    cancelDrag();
  }
}

function onKeyUp(e) {
  if (!active) return;
  if (e.key === 'Shift') {
    shiftHeld = false;
    if (dragging) cancelDrag();
    else { setDupState(null); clearHoverPreview(); }
  }
}

function onMouseMove(e) {
  if (!active) return;
  if (dragging) { updateDrag(e); return; }
  if (!shiftHeld) return;
  const el = e.target;
  if (isDuplicable(el)) {
    setHoverPreview(el);
    setDupState('active');
  } else {
    clearHoverPreview();
  }
}

function onMouseDown(e) {
  if (!active || !shiftHeld) return;
  if (e.button !== 0) return;
  if (!isDuplicable(e.target)) return;
  clearHoverPreview();
  startDrag(e);
}

function onMouseUp(e) {
  if (!active) return;
  if (dragging) commitDrag(e);
}

function onWindowBlur() {
  shiftHeld = false;
  if (dragging) cancelDrag();
  else { setDupState(null); clearHoverPreview(); }
}

export default {
  id: 'duplicate',
  label: 'Duplicate',
  experiment: true,
  enabledByDefault: true,

  init() {
    active = true;
    ensureCursorStyles();
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('blur', onWindowBlur);
  },

  enable() { active = true; },
  disable() {
    active = false;
    cancelDrag();
    clearHoverPreview();
    setDupState(null);
  },
};
