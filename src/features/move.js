/**
 * Move elements experiment.
 *
 * Hold Cmd (Meta) to put the page into "grab" mode. Click-drag any
 * element to move it. Two modes (toggle in Settings → Experiments →
 * Move elements → Type):
 *
 *   - DOM reorder: a colored insertion line shows between siblings
 *     while dragging. Drop = the element is `insertBefore`'d at that
 *     position. Result is a clean structural rearrangement.
 *
 *   - Free position: ghost follows the cursor freely. Drop = the
 *     element gets `position: relative` + `top`/`left` offsets so it
 *     stays put visually without altering DOM order.
 *
 * Cmd up or Esc during drag = cancel and restore. Inspector UI (the
 * toolbar, bubbles, tag labels, terminal, etc.) is never grabbable.
 */

import { inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { isInspectorUI, showToast } from '../core/helpers.js';
import { getSelectionColor, withAlpha } from '../core/theme.js';
import { getExperimentOption } from '../settings.js';

let active = false;     // module enabled (registered)
let cmdHeld = false;
let dragging = false;
let dragEl = null;
let ghostEl = null;
let indicator = null;
let dropTarget = null;  // { parent, before } for DOM-reorder mode
let startX = 0, startY = 0;
let startOffsetDx = 0, startOffsetDy = 0;

// Page-wide cursor override via an `!important` stylesheet rule. We
// can't just set `document.body.style.cursor = 'grab'` because the
// Comment tool injects a `cursor: pointer !important` rule on
// `html.dt-comment-active body *`, which beats inline styles. A class
// on <html> + a matching !important rule wins on specificity.
function ensureCursorStyles() {
  if (document.getElementById('dt-move-cursor-styles')) return;
  const style = document.createElement('style');
  style.id = 'dt-move-cursor-styles';
  style.textContent = `
    html.dt-grab-active, html.dt-grab-active body, html.dt-grab-active body * {
      cursor: grab !important;
    }
    html.dt-grabbing, html.dt-grabbing body, html.dt-grabbing body * {
      cursor: grabbing !important;
    }
  `;
  document.head.appendChild(style);
}

function setGrabState(state) {
  const html = document.documentElement;
  html.classList.remove('dt-grab-active', 'dt-grabbing');
  if (state === 'grab') html.classList.add('dt-grab-active');
  else if (state === 'grabbing') html.classList.add('dt-grabbing');
}

// Per-element saved offsets so repeated free-position drags accumulate
// instead of resetting each time the user grabs.
const offsets = new WeakMap(); // el → { dx, dy, origPosition, origTop, origLeft }

function getMode() {
  return getExperimentOption('move', 'moveType') || 'dom-reorder';
}

function isGrabbable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el === document.body || el === document.documentElement) return false;
  if (isInspectorUI(el)) return false;
  return true;
}

// Bright dashed outline + soft tint so the user knows what they're
// about to grab when Cmd is held and the cursor is over an element.
let hoverPreview = null;
function setHoverPreview(el) {
  if (hoverPreview === el) return;
  clearHoverPreview();
  if (!el) return;
  hoverPreview = el;
  hoverPreview._dt_move_origOutline = el.style.outline || '';
  hoverPreview._dt_move_origOutlineOffset = el.style.outlineOffset || '';
  el.style.outline = '2px dashed ' + getSelectionColor();
  el.style.outlineOffset = '2px';
}
function clearHoverPreview() {
  if (!hoverPreview) return;
  hoverPreview.style.outline = hoverPreview._dt_move_origOutline || '';
  hoverPreview.style.outlineOffset = hoverPreview._dt_move_origOutlineOffset || '';
  delete hoverPreview._dt_move_origOutline;
  delete hoverPreview._dt_move_origOutlineOffset;
  hoverPreview = null;
}


function createGhost(el) {
  const r = el.getBoundingClientRect();
  const clone = el.cloneNode(true);
  // Strip ids on the clone so we don't duplicate id="x" in the DOM
  clone.removeAttribute('id');
  Object.assign(clone.style, {
    position: 'fixed',
    left: r.left + 'px',
    top: r.top + 'px',
    width: r.width + 'px',
    height: r.height + 'px',
    margin: '0',
    pointerEvents: 'none',
    opacity: '0.55',
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

// Find the candidate sibling under the cursor and decide whether to
// insert the dragged element BEFORE that sibling or after it (i.e.,
// before its nextSibling). Also figures out flex-row-ish layouts so
// the indicator is horizontal vs. vertical.
function pickDropTarget(clientX, clientY) {
  // Briefly hide the ghost so elementFromPoint hits real elements.
  if (ghostEl) ghostEl.style.display = 'none';
  const under = document.elementFromPoint(clientX, clientY);
  if (ghostEl) ghostEl.style.display = '';

  if (!under || isInspectorUI(under)) return null;
  // Don't allow dropping into the dragged element's own subtree.
  if (under === dragEl || (dragEl && dragEl.contains(under))) return null;

  // Walk up to find a sibling of dragEl, OR a child of a container
  // that's a valid drop site. Simple heuristic: the candidate sibling
  // is the topmost descendant of `under`'s parent that contains the
  // cursor.
  let candidate = under;
  while (candidate && candidate.parentElement) {
    if (candidate === dragEl) return null;
    if (candidate.parentElement === dragEl.parentElement) break;
    candidate = candidate.parentElement;
  }
  if (!candidate || candidate.parentElement !== dragEl.parentElement) {
    // Different parent → allow moving INTO that parent at the
    // candidate's position.
    candidate = under;
    while (candidate && candidate.parentElement && candidate.parentElement.contains(dragEl)) {
      candidate = candidate.parentElement;
    }
    if (!candidate || !candidate.parentElement) return null;
    if (candidate === dragEl || candidate.contains(dragEl)) return null;
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
  // Insertion line position: at the leading edge of `before` (or
  // trailing edge of refRect if before is null/refRect's nextSibling).
  if (target.horizontal) {
    const x = (before === null || before !== document.body.childNodes[0])
      ? (target.parent.lastElementChild === null
          ? r.right
          : (before ? before.getBoundingClientRect().left : r.right))
      : r.left;
    indicator.style.left = (x + window.scrollX - 1) + 'px';
    indicator.style.top = (r.top + window.scrollY) + 'px';
    indicator.style.width = '2px';
    indicator.style.height = r.height + 'px';
  } else {
    const y = before
      ? before.getBoundingClientRect().top
      : (r.bottom);
    indicator.style.left = (r.left + window.scrollX) + 'px';
    indicator.style.top = (y + window.scrollY - 1) + 'px';
    indicator.style.width = r.width + 'px';
    indicator.style.height = '2px';
  }
  indicator.style.display = 'block';
}

function startDrag(e) {
  const el = e.target;
  if (!isGrabbable(el)) return;

  dragging = true;
  dragEl = el;
  startX = e.clientX;
  startY = e.clientY;

  const saved = offsets.get(el);
  startOffsetDx = saved ? saved.dx : 0;
  startOffsetDy = saved ? saved.dy : 0;

  ghostEl = createGhost(el);
  setGrabState('grabbing');
  // Dim the original so the ghost reads as "the moved one".
  el._dt_move_savedOpacity = el.style.opacity || '';
  el.style.opacity = '0.3';

  e.preventDefault();
  e.stopPropagation();
}

function updateDrag(e) {
  if (!dragging || !ghostEl) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  // Keep the ghost following the cursor.
  const r = dragEl.getBoundingClientRect();
  // We snapshotted ghost's left/top at drag start; just translate.
  ghostEl.style.transform = `translate(${dx}px, ${dy}px)`;

  if (getMode() === 'dom-reorder') {
    dropTarget = pickDropTarget(e.clientX, e.clientY);
    showIndicator(dropTarget);
  }
}

function commitDrag(e) {
  if (!dragging) return;
  dragging = false;

  const mode = getMode();
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  if (mode === 'dom-reorder') {
    if (dropTarget && dropTarget.parent && dropTarget.parent !== dragEl) {
      try {
        dropTarget.parent.insertBefore(dragEl, dropTarget.before);
        showToast('Element moved');
      } catch (_) {}
    }
  } else {
    // free-position: accumulate offset
    const newDx = startOffsetDx + dx;
    const newDy = startOffsetDy + dy;
    let saved = offsets.get(dragEl);
    if (!saved) {
      saved = {
        dx: 0,
        dy: 0,
        origPosition: dragEl.style.position || '',
        origTop: dragEl.style.top || '',
        origLeft: dragEl.style.left || '',
      };
      offsets.set(dragEl, saved);
    }
    saved.dx = newDx;
    saved.dy = newDy;
    if (getComputedStyle(dragEl).position === 'static') {
      dragEl.style.position = 'relative';
    }
    dragEl.style.left = newDx + 'px';
    dragEl.style.top = newDy + 'px';
    showToast('Element repositioned');
  }

  finishDrag();
}

function cancelDrag() {
  if (!dragging) return;
  dragging = false;
  finishDrag();
}

function finishDrag() {
  if (dragEl) {
    dragEl.style.opacity = dragEl._dt_move_savedOpacity || '';
    delete dragEl._dt_move_savedOpacity;
  }
  destroyGhost();
  destroyIndicator();
  dropTarget = null;
  dragEl = null;
  setGrabState(cmdHeld ? 'grab' : null);
}

function onKeyDown(e) {
  if (!active) return;
  if (e.key === 'Meta' || e.key === 'Control') {
    cmdHeld = true;
    if (!dragging) setGrabState('grab');
  } else if (e.key === 'Escape' && dragging) {
    cancelDrag();
  }
}

function onKeyUp(e) {
  if (!active) return;
  if (e.key === 'Meta' || e.key === 'Control') {
    cmdHeld = false;
    if (dragging) {
      cancelDrag();
    } else {
      setGrabState(null);
      clearHoverPreview();
    }
  }
}

function onMouseMove(e) {
  if (!active) return;
  if (dragging) {
    updateDrag(e);
    return;
  }
  if (!cmdHeld) return;
  const el = e.target;
  if (isGrabbable(el)) {
    setHoverPreview(el);
    setGrabState('grab');
  } else {
    clearHoverPreview();
  }
}

function onMouseDown(e) {
  if (!active || !cmdHeld) return;
  // Only respond to primary button.
  if (e.button !== 0) return;
  if (!isGrabbable(e.target)) return;
  clearHoverPreview();
  startDrag(e);
}

function onMouseUp(e) {
  if (!active) return;
  if (dragging) commitDrag(e);
}

function onWindowBlur() {
  cmdHeld = false;
  if (dragging) cancelDrag();
  else { setGrabState(null); clearHoverPreview(); }
}

export default {
  id: 'move',
  label: 'Move',
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
    setGrabState(null);
  },
};
