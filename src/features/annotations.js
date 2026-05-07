/**
 * Annotations service.
 *
 * Used to be a standalone "Annotate" rail tool. Design mode now owns the
 * note-leaving UX (textarea + on-page bubble), so this file is just the
 * shared store + bubble layer it depends on. No rail button, no mode
 * lifecycle — it registers only to install scroll/resize listeners that
 * keep bubbles anchored to their elements.
 *
 * Public API consumed by Design mode (style-modifier.js):
 *   setElementNote(el, text, originalClasses) → create/update/remove an
 *     annotation for `el` based on `text`. The on-page bubble auto-syncs.
 *   getElementNote(el) → string note for an element (or '').
 *   queueRepositionAll() → request a rAF-batched bubble reposition (call
 *     after class changes that may affect element bounds).
 *   getAnnotations() → annotation list (used by copy-all to build output).
 */

import { inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { getSelector } from '../core/helpers.js';
import { updateCopyBadge } from '../rail.js';
// NOTE: circular import with style-modifier.js is intentional and safe — both
// only call each other from runtime event handlers, never at module eval.
import { focusElement } from './style-modifier.js';

// --- Annotation store ---
// Each annotation tracks up to three kinds of change for one element:
//   - note (free-form prose, shown as on-page bubble)
//   - originalClasses (compared to el.className → class diff)
//   - originalText (compared to el.innerText → text diff, shown as a small
//     emerald pencil marker; visually distinct from the amber note bubble)
const annotations = []; // { id, el, selector, note, originalClasses, originalText, bubbleEl, textMarkerEl }
let nextId = 1;

export function getAnnotations() { return annotations; }
export function findAnnotationByEl(el) { return annotations.find(a => a.el === el) || null; }
export function getElementNote(el) {
  const a = findAnnotationByEl(el);
  return a ? a.note : '';
}

function hasTextDiff(annotation) {
  return annotation.originalText != null
    && annotation.el.innerText !== annotation.originalText;
}

function hasClassDiff(annotation) {
  return annotation.el.className !== annotation.originalClasses;
}

function hasNote(annotation) {
  return !!(annotation.note && annotation.note.trim().length);
}

function isAnnotationEmpty(annotation) {
  return !hasNote(annotation)
    && !hasClassDiff(annotation)
    && !hasTextDiff(annotation);
}

// --- Persistent on-page note bubble ---
// Anchored via getBoundingClientRect so it can extend outside the element's
// bounds (avoids clipping by overflow:hidden ancestors). Repositions on
// scroll/resize via rAF-batched listener installed on registry init().
function createBubble(annotation) {
  const bubble = document.createElement('div');
  Object.assign(bubble.style, {
    position: 'absolute',
    background: '#ec4899',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 9px',
    fontSize: '11px', lineHeight: '1.4',
    fontFamily: 'system-ui, sans-serif', color: '#fff',
    maxWidth: '220px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    cursor: 'pointer', zIndex: String(Z.badge - 1),
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    pointerEvents: 'auto',
    transition: 'transform 0.1s'
  });
  bubble.addEventListener('mouseenter', () => { bubble.style.transform = 'scale(1.03)'; });
  bubble.addEventListener('mouseleave', () => { bubble.style.transform = 'scale(1)'; });
  bubble.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    focusElement(annotation.el);
  });
  document.body.appendChild(bubble);
  inspectorUI.add(bubble);
  return bubble;
}

// Always anchored to the element's top-left: bubble's bottom-left sits at
// the element's top-left corner with a small 6px gap. No flipping to below
// the element regardless of viewport — predictable, consistent placement.
function positionBubble(bubble, el) {
  const r = el.getBoundingClientRect();
  const bubbleH = bubble.offsetHeight || 32;
  bubble.style.left = (r.left + window.scrollX) + 'px';
  bubble.style.top = (r.top + window.scrollY - bubbleH - 6) + 'px';
}

let _repositionQueued = false;
export function queueRepositionAll() {
  if (_repositionQueued) return;
  _repositionQueued = true;
  requestAnimationFrame(() => {
    _repositionQueued = false;
    annotations.forEach(a => {
      if (a.bubbleEl) positionBubble(a.bubbleEl, a.el);
      if (a.textMarkerEl) positionTextMarker(a.textMarkerEl, a.el);
    });
  });
}

function removeBubble(annotation) {
  if (!annotation.bubbleEl) return;
  inspectorUI.delete(annotation.bubbleEl);
  annotation.bubbleEl.remove();
  annotation.bubbleEl = null;
}

function syncBubble(annotation) {
  if (hasNote(annotation)) {
    if (!annotation.bubbleEl) annotation.bubbleEl = createBubble(annotation);
    annotation.bubbleEl.textContent = annotation.note;
    positionBubble(annotation.bubbleEl, annotation.el);
  } else {
    removeBubble(annotation);
  }
}

// --- Text-edit marker (emerald pencil, top-right of element) ---
function createTextMarker(annotation) {
  const marker = document.createElement('div');
  marker.textContent = '\u270E'; // ✎
  Object.assign(marker.style, {
    position: 'absolute',
    width: '20px', height: '20px',
    background: '#10b981',
    color: '#fff',
    borderRadius: '4px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '12px', fontWeight: '700',
    fontFamily: 'system-ui, sans-serif',
    cursor: 'pointer', zIndex: String(Z.badge - 1),
    boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
    pointerEvents: 'auto',
    transition: 'transform 0.1s'
  });
  marker.title = 'Text edited (click to view)';
  marker.addEventListener('mouseenter', () => { marker.style.transform = 'scale(1.15)'; });
  marker.addEventListener('mouseleave', () => { marker.style.transform = 'scale(1)'; });
  marker.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    focusElement(annotation.el);
  });
  document.body.appendChild(marker);
  inspectorUI.add(marker);
  return marker;
}

function positionTextMarker(marker, el) {
  const r = el.getBoundingClientRect();
  // Top-right, slightly outside the element to not overlap content. Falls
  // back inside the right edge if the element is up against the viewport.
  const x = Math.min(r.right + 4, window.innerWidth - 24) + window.scrollX;
  marker.style.left = (x - 20) + 'px';
  marker.style.top = (r.top + window.scrollY + 4) + 'px';
}

function removeTextMarker(annotation) {
  if (!annotation.textMarkerEl) return;
  inspectorUI.delete(annotation.textMarkerEl);
  annotation.textMarkerEl.remove();
  annotation.textMarkerEl = null;
}

function syncTextMarker(annotation) {
  if (hasTextDiff(annotation)) {
    if (!annotation.textMarkerEl) annotation.textMarkerEl = createTextMarker(annotation);
    positionTextMarker(annotation.textMarkerEl, annotation.el);
  } else {
    removeTextMarker(annotation);
  }
}

function removeAnnotation(annotation) {
  removeBubble(annotation);
  removeTextMarker(annotation);
  // Restore class state. Text is intentionally NOT restored — clearing the
  // tracking entry shouldn't undo what the user typed. (If they want a
  // text revert, they'd type the original back manually.)
  annotation.el.className = annotation.originalClasses;
  const idx = annotations.indexOf(annotation);
  if (idx !== -1) annotations.splice(idx, 1);
  updateBadgeCount();
}

function updateBadgeCount() {
  const count = annotations.filter(a =>
    hasNote(a) || hasClassDiff(a) || hasTextDiff(a)
  ).length;
  updateCopyBadge(count);
}

// Build a fresh annotation object. Caller is responsible for pushing it onto
// the store and calling evaluateAnnotation afterward.
function newAnnotation(el, opts) {
  return {
    id: nextId++,
    el,
    selector: getSelector(el),
    note: opts.note != null ? opts.note : '',
    originalClasses: opts.originalClasses != null ? opts.originalClasses : el.className,
    originalText: opts.originalText != null ? opts.originalText : null,
    bubbleEl: null,
    textMarkerEl: null,
  };
}

// --- Public: re-sync all on-page indicators for an element's annotation
//     and prune the annotation if it has no remaining changes. Used by
//     style-modifier after class or text mutations. ---
export function evaluateAnnotation(el) {
  const a = findAnnotationByEl(el);
  if (!a) return;
  syncBubble(a);
  syncTextMarker(a);
  updateBadgeCount();
  if (isAnnotationEmpty(a)) removeAnnotation(a);
}

// --- Public: set/clear a note for an element. Lazily creates the
//     annotation; auto-removes when no note, no class diff, and no text
//     diff remain. ---
export function setElementNote(el, text, originalClasses) {
  let a = findAnnotationByEl(el);
  const trimmed = (text || '').trim();

  if (!a) {
    if (!trimmed) return null;
    a = newAnnotation(el, { note: text, originalClasses });
    annotations.push(a);
  } else {
    a.note = text;
  }

  syncBubble(a);
  updateBadgeCount();

  if (isAnnotationEmpty(a)) {
    removeAnnotation(a);
    return null;
  }

  return a;
}

// --- Public: capture the original text of an element (idempotent — only
//     sets it the first time). Call once when the element becomes editable
//     in Design mode. Pair with evaluateAnnotation(el) on text input to
//     keep the marker + badge count up to date. ---
export function setElementText(el, originalText, originalClasses) {
  let a = findAnnotationByEl(el);
  if (!a) {
    // No existing annotation: create one solely to track text. Marker + badge
    // appear lazily once the user actually changes the text.
    a = newAnnotation(el, { originalClasses, originalText });
    annotations.push(a);
  } else if (a.originalText == null) {
    a.originalText = originalText;
  }
  evaluateAnnotation(el);
  return a;
}

// --- Module shell: registered with the rail registry only so init() runs at
//     boot. No `button` — won't appear in the rail UI. ---
export default {
  id: 'annotations',
  enabledByDefault: true,

  init() {
    window.addEventListener('scroll', queueRepositionAll, true);
    window.addEventListener('resize', queueRepositionAll);
  },
};
