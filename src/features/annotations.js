/**
 * Annotations service.
 *
 * Two kinds of tracked changes:
 *   1. Note annotations — a single note attached to one or many elements
 *      (a "group"). One note, one bubble. The bubble IS the editor: a
 *      pink rounded box containing a transparent <textarea>. When the
 *      Comment tool selects an element of the group, the textarea
 *      becomes editable and focused; when the selection moves
 *      elsewhere, the textarea goes read-only and the bubble looks
 *      identical to the saved-note state.
 *   2. Text edits — per-element original-text snapshots, no on-page UI;
 *      diffs surface in the copy-all output.
 *
 * Public API for tools (Comment / Edit Text):
 *   setEditorTarget(els)         → make these els the live editor target
 *   closeEditor()                → finalize current editor, drop transient
 *   getElementNote(el)           → '' if untracked, else the group's note
 *   findNoteAnnotationByEl(el)   → the group annotation containing el (or null)
 *   setElementText(el, originalText, originalClasses)
 *   evaluateAnnotation(el)
 *   ensureOrig / applyAnnotationStyle
 *   queueRepositionAll()
 *   getAnnotations()             → unified list for copy-all
 */

import { inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { getSelector } from '../core/helpers.js';
import { updateCopyBadge } from '../toolbar.js';
import { getSelectionColor, withAlpha, onColorChange } from '../core/theme.js';
// NOTE: circular import with style-modifier.js is intentional and safe — both
// only call each other from runtime event handlers, never at module eval.
import { focusGroup } from './style-modifier.js';

// ---- Style state shared across tools ----
const ORIG_OUTLINES = new WeakMap();
const ORIG_BACKGROUNDS = new WeakMap();

// At-rest tint for elements that have a saved note or text edit. Derived
// from the live selection color so theme swaps propagate.
function getScrim() { return withAlpha(getSelectionColor(), 0.15); }
// Faded scrim used on OTHER annotated elements while a bubble is being
// hovered — lighter so the hovered note's own elements visually pop.
function getFadedScrim() { return withAlpha(getSelectionColor(), 0.04); }

// While a bubble is hovered, this points at its annotation. Other
// annotated elements switch to the faded scrim so the connection
// between the hovered note and its own elements stands out.
let hoveredAnnotation = null;

export function ensureOrig(el) {
  if (!ORIG_OUTLINES.has(el)) ORIG_OUTLINES.set(el, el.style.outline || '');
  if (!ORIG_BACKGROUNDS.has(el)) ORIG_BACKGROUNDS.set(el, el.style.backgroundColor || '');
}

export function getOrigOutline(el) { return ORIG_OUTLINES.get(el) || ''; }
export function getOrigBackground(el) { return ORIG_BACKGROUNDS.get(el) || ''; }

export function applyAnnotationStyle(el) {
  if (isAnnotated(el)) {
    const inHoveredGroup = hoveredAnnotation && hoveredAnnotation.els.includes(el);
    const inActiveGroup = activeAnnotation && activeAnnotation.els.includes(el);
    // Solid border when:
    //   - the element belongs to the note currently being edited
    //     (active state — the border tells you "your typing is going to
    //      these elements"), or
    //   - the user is hovering this annotation's bubble.
    // Otherwise the at-rest scrim alone marks the element.
    if (inHoveredGroup || inActiveGroup) {
      el.style.outline = '2px solid ' + getSelectionColor();
    } else {
      el.style.outline = getOrigOutline(el);
    }
    // If we're in "bubble hover" mode and this element isn't part of
    // the hovered annotation, dim it. Otherwise, normal scrim.
    if (hoveredAnnotation && !inHoveredGroup) {
      el.style.backgroundColor = getFadedScrim();
    } else {
      el.style.backgroundColor = getScrim();
    }
  } else {
    el.style.outline = getOrigOutline(el);
    el.style.backgroundColor = getOrigBackground(el);
  }
}

// Repaint every annotated element so the hover state takes effect (or
// is removed). Cheap because we only touch els we already track.
function repaintAllAnnotated() {
  noteAnnotations.forEach(a => a.els.forEach(el => applyAnnotationStyle(el)));
  textEdits.forEach((_, el) => applyAnnotationStyle(el));
}

function setHoveredAnnotation(annotation) {
  if (hoveredAnnotation === annotation) return;
  hoveredAnnotation = annotation;
  repaintAllAnnotated();
}

// ---- Stores ----
// Note annotations: 1+ elements share one note + one bubble.
// `transient` annotations exist only while their bubble is the editor;
// they vanish on closeEditor() if no note text was typed.
const noteAnnotations = []; // { id, els, selectors, note, primaryEl, bubbleEl, customPosition, transient }
const textEdits = new Map(); // el → { originalText, originalClasses }

let nextId = 1;
let activeAnnotation = null; // the bubble currently in edit mode

function isAnnotated(el) {
  return findNoteAnnotationByEl(el) !== null || hasTextDiff(el);
}

function hasTextDiff(el) {
  const e = textEdits.get(el);
  return e != null && el.innerText !== e.originalText;
}

export function findNoteAnnotationByEl(el) {
  return noteAnnotations.find(a => a.els.includes(el)) || null;
}

export function getElementNote(el) {
  const a = findNoteAnnotationByEl(el);
  return a ? a.note : '';
}

// True when the user has the editor open on a note that has no text
// yet — used by the click router to decide whether a body click
// should also drop the current selection.
export function isActiveNoteEmpty() {
  if (!activeAnnotation) return false;
  return !activeAnnotation.note || !activeAnnotation.note.trim();
}

// ---- One-time stylesheet for placeholder color (white-ish on pink) ----
function ensureBubbleStyles() {
  if (document.getElementById('dt-bubble-styles')) return;
  const s = document.createElement('style');
  s.id = 'dt-bubble-styles';
  s.textContent = `
    [data-dt-bubble] textarea::placeholder { color: rgba(255, 255, 255, 0.65); }
    [data-dt-bubble] textarea::-webkit-input-placeholder { color: rgba(255, 255, 255, 0.65); }
  `;
  document.head.appendChild(s);
}

// ---- Bubble (the unified editor + display) ----
// Pink rounded card containing a borderless transparent textarea. In
// edit mode (readOnly=false, focused) the user types; in read mode
// (readOnly=true) it reads as the saved note. Same DOM, same chrome —
// the only visible difference is the blinking caret.
function createBubble(annotation) {
  ensureBubbleStyles();

  const bubble = document.createElement('div');
  bubble.setAttribute('data-dt-bubble', '');
  bubble.setAttribute('data-dt-allow-select', '');
  Object.assign(bubble.style, {
    position: 'absolute',
    background: getSelectionColor(),
    border: 'none',
    borderRadius: '6px',
    padding: '6px 9px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    zIndex: String(Z.badge - 1),
    fontFamily: 'system-ui, sans-serif',
    color: '#fff',
    minWidth: '180px',
    maxWidth: '280px',
    pointerEvents: 'auto',
    transition: 'transform 0.1s',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    boxSizing: 'border-box',
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  });

  // Drag handle: a tiny grid of "grabby" dots on the left edge so the
  // bubble is movable even before any text is typed (where the textarea
  // would otherwise eat almost the entire mousedown target).
  const handle = document.createElement('div');
  handle.setAttribute('aria-label', 'Drag to move');
  handle.title = 'Drag to move';
  handle.innerHTML = '<svg width="6" height="16" viewBox="0 0 6 16" xmlns="http://www.w3.org/2000/svg" fill="rgba(255,255,255,0.7)" aria-hidden="true">'
    + '<circle cx="1.5" cy="3" r="1"/><circle cx="4.5" cy="3" r="1"/>'
    + '<circle cx="1.5" cy="8" r="1"/><circle cx="4.5" cy="8" r="1"/>'
    + '<circle cx="1.5" cy="13" r="1"/><circle cx="4.5" cy="13" r="1"/>'
    + '</svg>';
  Object.assign(handle.style, {
    flex: '0 0 auto',
    width: '8px',
    minHeight: '20px',
    cursor: 'grab',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  });

  const ta = document.createElement('textarea');
  ta.setAttribute('data-dt-allow-select', '');
  ta.readOnly = true;
  Object.assign(ta.style, {
    flex: '1 1 auto',
    minWidth: '0',
    minHeight: '20px',
    padding: '0',
    margin: '0',
    border: 'none',
    background: 'transparent',
    color: '#fff',
    fontSize: '11px',
    lineHeight: '1.4',
    fontFamily: 'system-ui, sans-serif',
    resize: 'none',
    outline: 'none',
    boxSizing: 'border-box',
    display: 'block',
    overflow: 'hidden',
    cursor: 'grab',
  });

  function autoGrow() {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 20) + 'px';
    if (annotation.bubbleEl) {
      positionBubble(annotation.bubbleEl, annotation.primaryEl, annotation.customPosition);
    }
  }

  ta.addEventListener('input', () => {
    annotation.note = ta.value;
    if (annotation.transient && ta.value.trim()) annotation.transient = false;
    autoGrow();
    updateBadgeCount();
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') ta.blur();
  });

  bubble.appendChild(handle);
  bubble.appendChild(ta);
  bubble._textarea = ta;
  bubble._handle = handle;
  bubble._autoGrow = autoGrow;

  // Drag-vs-click.
  //   - mousedown on the textarea while we're the editor → let the
  //     textarea focus normally (caret placement); no drag
  //   - mousedown on the textarea while we're read-only → drag, and on
  //     mouseup with no movement, focusGroup() flips us into the editor
  //   - mousedown anywhere else (handle, padding) → drag, ditto
  let dragging = false, didDrag = false, sx = 0, sy = 0;
  let startDx = 0, startDy = 0;

  bubble.addEventListener('mousedown', (e) => {
    const inTextarea = (e.target === ta);
    const isEditing = (activeAnnotation === annotation);
    if (inTextarea && isEditing) return;

    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    didDrag = false;
    bubble._dragging = true;
    sx = e.clientX; sy = e.clientY;
    startDx = annotation.customPosition ? annotation.customPosition.dx : 0;
    startDy = annotation.customPosition ? annotation.customPosition.dy : 0;
    handle.style.cursor = 'grabbing';
  });

  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!didDrag && Math.abs(dx) + Math.abs(dy) > 3) didDrag = true;
    if (didDrag) {
      annotation.customPosition = { dx: startDx + dx, dy: startDy + dy };
      positionBubble(bubble, annotation.primaryEl, annotation.customPosition);
    }
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    bubble._dragging = false;
    handle.style.cursor = 'grab';
    if (didDrag) return;
    if (activeAnnotation === annotation) return; // already editing, no-op
    // Defer past the synthetic click so Comment's capture click handler
    // still sees the bubble as inspector UI.
    requestAnimationFrame(() => focusGroup(annotation.els));
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp, true);
  bubble._cleanupDrag = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
  };

  // Hovering the bubble dims every OTHER annotated element so the
  // visual line between this note and ITS attached element(s) stands
  // out. Restored on mouseleave.
  bubble.addEventListener('mouseenter', () => setHoveredAnnotation(annotation));
  bubble.addEventListener('mouseleave', () => setHoveredAnnotation(null));

  document.body.appendChild(bubble);
  inspectorUI.add(bubble);
  return bubble;
}

// Default placement: primary element's top-left, bubble sitting just
// above. customPosition (set by drag) is added on top of that so the
// bubble follows its element through scrolls but keeps any user-chosen
// offset.
function positionBubble(bubble, el, custom) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const bubbleH = bubble.offsetHeight || 32;
  let left = r.left + window.scrollX;
  let top = r.top + window.scrollY - bubbleH - 6;
  if (custom) { left += custom.dx; top += custom.dy; }
  bubble.style.left = left + 'px';
  bubble.style.top = top + 'px';
}

let _repositionQueued = false;
export function queueRepositionAll() {
  if (_repositionQueued) return;
  _repositionQueued = true;
  requestAnimationFrame(() => {
    _repositionQueued = false;
    noteAnnotations.forEach(a => {
      if (a.bubbleEl) positionBubble(a.bubbleEl, a.primaryEl, a.customPosition);
    });
    noteAnnotations.forEach(a => a.els.forEach(el => applyAnnotationStyle(el)));
    textEdits.forEach((_, el) => applyAnnotationStyle(el));
  });
}

function removeBubble(annotation) {
  if (!annotation.bubbleEl) return;
  if (annotation.bubbleEl._cleanupDrag) annotation.bubbleEl._cleanupDrag();
  inspectorUI.delete(annotation.bubbleEl);
  annotation.bubbleEl.remove();
  annotation.bubbleEl = null;
}

// Show/refresh the bubble. `editing` decides whether the textarea is
// readonly. The bubble is hidden when there's no note AND the
// annotation isn't the active editor (keeps stale empties off-screen).
function syncBubble(annotation, editing) {
  const hasNote = annotation.note && annotation.note.trim().length > 0;
  if (!hasNote && !editing) {
    removeBubble(annotation);
    return;
  }
  if (!annotation.bubbleEl) annotation.bubbleEl = createBubble(annotation);

  const ta = annotation.bubbleEl._textarea;
  ta.readOnly = !editing;
  ta.style.cursor = editing ? 'text' : 'grab';
  ta.placeholder = editing
    ? (annotation.els.length > 1
      ? `Group note for ${annotation.els.length} elements…`
      : 'Describe the change…')
    : '';
  if (ta.value !== annotation.note) ta.value = annotation.note;
  annotation.bubbleEl._autoGrow();
  positionBubble(annotation.bubbleEl, annotation.primaryEl, annotation.customPosition);

  if (editing) {
    setTimeout(() => {
      if (!annotation.bubbleEl) return;
      ta.focus();
      const end = ta.value.length;
      try { ta.setSelectionRange(end, end); } catch (_) {}
    }, 0);
  }
}

function removeNoteAnnotation(annotation) {
  if (hoveredAnnotation === annotation) hoveredAnnotation = null;
  removeBubble(annotation);
  const idx = noteAnnotations.indexOf(annotation);
  if (idx !== -1) noteAnnotations.splice(idx, 1);
  annotation.els.forEach(el => applyAnnotationStyle(el));
  updateBadgeCount();
}

// ---- Editor lifecycle (the Comment tool drives this) ----
//
// setEditorTarget(els) is called whenever the Comment tool's selection
// changes (or it opens for the first time). It promotes any matching
// existing annotation to be the active editor, or spins up a transient
// one if no annotation involves any of `els`.  Other annotations
// touching any of these elements are merged into the editor — group
// boundaries reflect what's currently selected.

export function setEditorTarget(els) {
  if (!els || !els.length) {
    closeEditor();
    return;
  }

  // Find an existing annotation involving any selected el.
  let ann = noteAnnotations.find(a => a.els.some(el => els.includes(el)));

  // Switching editor target — finalize the current one (commit or drop).
  // Null activeAnnotation BEFORE finalizing so the repaint inside
  // finalize sees the old els as inactive and drops their border.
  if (activeAnnotation && activeAnnotation !== ann) {
    const prev = activeAnnotation;
    activeAnnotation = null;
    finalizeAnnotation(prev);
  }

  if (!ann) {
    // Transient: a placeholder editor so the user can start typing.
    // If they don't, closeEditor will throw it away.
    ann = {
      id: nextId++,
      els: [],
      selectors: [],
      note: '',
      primaryEl: null,
      bubbleEl: null,
      customPosition: null,
      transient: true,
    };
    noteAnnotations.push(ann);
  }

  // Update group composition to match the current selection.
  ann.els = els.slice();
  ann.selectors = els.map(getSelector);
  ann.primaryEl = els[0];

  // Consolidate: any OTHER annotation that overlaps with this group is
  // absorbed (its note text wins if our editor is empty).
  for (let i = noteAnnotations.length - 1; i >= 0; i--) {
    const other = noteAnnotations[i];
    if (other === ann) continue;
    if (!other.els.some(el => els.includes(el))) continue;
    if ((!ann.note || !ann.note.trim()) && other.note) {
      ann.note = other.note;
    }
    if (!ann.customPosition && other.customPosition && other.primaryEl === ann.primaryEl) {
      ann.customPosition = other.customPosition;
    }
    removeNoteAnnotation(other);
  }

  activeAnnotation = ann;
  syncBubble(ann, true);
  els.forEach(el => applyAnnotationStyle(el));
  updateBadgeCount();
}

function finalizeAnnotation(ann) {
  if (ann.transient && (!ann.note || !ann.note.trim())) {
    removeNoteAnnotation(ann);
    return;
  }
  ann.transient = false;
  syncBubble(ann, false);
  ann.els.forEach(el => applyAnnotationStyle(el));
}

export function closeEditor() {
  if (!activeAnnotation) return;
  const a = activeAnnotation;
  activeAnnotation = null;
  finalizeAnnotation(a);
  updateBadgeCount();
}

// Drop everything tracked by this module — bubbles, notes, text edits.
// Element styles return to their pristine pre-tool look. The text the
// user typed inline is intentionally NOT reverted; clearing the
// trackers shouldn't undo their content.
export function clearAnnotations() {
  activeAnnotation = null;
  for (let i = noteAnnotations.length - 1; i >= 0; i--) {
    removeNoteAnnotation(noteAnnotations[i]);
  }
  const trackedEls = Array.from(textEdits.keys());
  textEdits.clear();
  trackedEls.forEach(el => applyAnnotationStyle(el));
  updateBadgeCount();
}

// ---- Text edits ----
export function setElementText(el, originalText, originalClasses) {
  if (!textEdits.has(el)) {
    textEdits.set(el, { originalText, originalClasses });
  }
  applyAnnotationStyle(el);
  updateBadgeCount();
}

export function evaluateAnnotation(el) {
  const e = textEdits.get(el);
  if (e && el.innerText === e.originalText && el.className === e.originalClasses) {
    textEdits.delete(el);
  }
  applyAnnotationStyle(el);
  updateBadgeCount();
}

// ---- Badge ----
function updateBadgeCount() {
  // Each non-transient note + each text edit counts as one change.
  let count = 0;
  noteAnnotations.forEach(a => {
    if (!a.transient && a.note && a.note.trim()) count++;
  });
  textEdits.forEach((e, el) => {
    if (el.innerText !== e.originalText || el.className !== e.originalClasses) count++;
  });
  updateCopyBadge(count);
}

// ---- Unified list for copy-all ----
export function getAnnotations() {
  const items = [];
  noteAnnotations.forEach(a => {
    if (a.transient || !a.note || !a.note.trim()) return;
    items.push({
      kind: 'note',
      els: a.els,
      selectors: a.selectors,
      note: a.note,
    });
  });
  textEdits.forEach((e, el) => {
    if (el.innerText === e.originalText && el.className === e.originalClasses) return;
    items.push({
      kind: 'text',
      el,
      selector: getSelector(el),
      originalText: e.originalText,
      originalClasses: e.originalClasses,
    });
  });
  return items;
}

// Live-update bubbles + tracked element scrims when the selection
// color is swapped from settings.
onColorChange((color) => {
  noteAnnotations.forEach(a => {
    if (a.bubbleEl) a.bubbleEl.style.background = color;
    a.els.forEach(el => applyAnnotationStyle(el));
  });
  textEdits.forEach((_, el) => applyAnnotationStyle(el));
});

// ---- Module shell ----
export default {
  id: 'annotations',
  enabledByDefault: true,

  init() {
    window.addEventListener('scroll', queueRepositionAll, true);
    window.addEventListener('resize', queueRepositionAll);
  },
};
