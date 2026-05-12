/**
 * Select tool — point-and-click element selection for leaving feedback.
 *
 * Click an element to select it; the note bubble that appears IS the
 * editor — type directly into it. Shift+click another element to add
 * it to the current selection (group annotation). Each selected element
 * gets its own outlined highlight while the group is active.
 *
 * This tool is read-only as far as page text is concerned — inline text
 * editing is exclusively the Edit Text tool's job.
 */

import { state, inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { showToast, isInspectorUI, nudge } from '../core/helpers.js';
import { setActiveButton } from '../toolbar.js';
import { activateModule } from '../core/registry.js';
import { isExperimentEnabled } from '../settings.js';
import { getSelectionColor, withAlpha, onColorChange } from '../core/theme.js';
import { ensurePlexMono } from '../core/fonts.js';
// NOTE: circular import with annotations.js is intentional and safe — both
// only call each other from runtime event handlers, never at module eval.
import {
  setEditorTarget, closeEditor,
  ensureOrig, applyAnnotationStyle, getOrigBackground, getOrigOutline,
  findNoteAnnotationByEl, isActiveNoteEmpty,
  setClickOrigin,
  setElementText, evaluateAnnotation,
} from './annotations.js';


let activeMode = false;
let selected = [];

export function getSelected() { return selected; }

// --- One-time stylesheet: kills native text selection page-wide while
//     Comment mode is active so click-drag doesn't grab text instead of
//     dropping a comment. The bubble (and any element made
//     contentEditable for inline text editing) re-enables selection so
//     typing/editing still works. ---
function ensureSelectionStyles() {
  if (document.getElementById('dt-comment-styles')) return;
  const inspectorUiSelector = ':where(' + [
    '[data-dt-toolbar]', '[data-dt-toolbar] *',
    '[data-dt-bubble]', '[data-dt-bubble] *',
    '[data-dt-tag-label]',
    '[data-dt-settings]', '[data-dt-settings] *',
  ].join(', ') + ')';
  const style = document.createElement('style');
  style.id = 'dt-comment-styles';
  style.textContent = `
    html.dt-comment-active body,
    html.dt-comment-active body *:not(${inspectorUiSelector}) {
      user-select: none !important;
      -webkit-user-select: none !important;
      cursor: pointer !important;
    }
    html.dt-comment-active [data-dt-allow-select],
    html.dt-comment-active [data-dt-allow-select] * {
      user-select: text !important;
      -webkit-user-select: text !important;
      cursor: text !important;
    }
    html.dt-comment-active.dt-inline-editing body *:not([data-dt-allow-select]):not([data-dt-allow-select] *) {
      cursor: default !important;
    }
    html.dt-comment-active [data-dt-bubble] textarea {
      cursor: text !important;
    }
    html.dt-comment-active [data-dt-bubble] [aria-label="Drag to move"] {
      cursor: grab !important;
    }
    [data-dt-bubble] textarea::selection,
    [data-dt-bubble] textarea::-moz-selection,
    html.dt-comment-active ::selection {
      background: var(--dt-color-scrim);
      color: inherit;
    }
  `;
  document.head.appendChild(style);
}

// --- Visual state --------------------------------------------------------
// Border for currently selected elements; otherwise the shared annotations
// module decides whether to apply the at-rest pink scrim (annotated) or
// restore the original outline+background (clean).
function applyOutline(el) {
  if (selected.some(s => s.el === el)) {
    el.style.outline = '2px solid ' + getSelectionColor();
    // Selection wins over scrim — drop the annotation tint while active.
    el.style.backgroundColor = getOrigBackground(el);
  } else {
    applyAnnotationStyle(el);
  }
}

// --- Selection -----------------------------------------------------------
// Selection is purely visual + annotation-bound. We never mutate the
// element's editability here — that lives in the Edit Text tool. Keeping
// originalClasses lets copy-all surface live class diffs even before
// the user deselects.
function buildEntry(el) {
  ensureOrig(el);
  return { el, originalClasses: el.className };
}

function teardownEntry(_s) {
  // Nothing to tear down — Comment mode never flips contentEditable.
}

function deselectAll() {
  const old = selected;
  selected = [];
  old.forEach(teardownEntry);
  old.forEach(s => applyOutline(s.el));
}

// Push the current selection through to the annotations editor. Called
// after every selection mutation so the active editor's els (and any
// transient/persistent annotation behind it) always match what's
// visually selected.
function syncEditor() {
  if (selected.length) {
    setEditorTarget(selected.map(s => s.el));
  } else {
    closeEditor();
  }
  refreshTagLabels();
}

// --- Tag labels ---------------------------------------------------------
// A small "div.card" / "h1.hero" pill is shown for every element the
// user is currently engaged with — hovered, selected, or being
// text-edited. Two fonts in rotation:
//   - Headings (h1–h6) get Pixelfraktur — a touch of "old-book-style"
//     identity so heading hover/select reads like a real heading.
//   - Everything else gets IBM Plex Mono — clean monospace for tags,
//     ids, classes.
// Labels are absolute-positioned siblings of <body> and live in
// inspectorUI so our own click/hover handlers ignore them.

const tagLabels = new Map(); // el → { lbl, flipped }

function elementLabelText(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  if (el.classList && el.classList.length) return `${tag}.${el.classList[0]}`;
  return tag;
}

function createTagLabel(el) {
  const lbl = document.createElement('div');
  lbl.setAttribute('data-dt-tag-label', '');
  Object.assign(lbl.style, {
    position: 'absolute',
    background: getSelectionColor(),
    color: '#fff',
    fontFamily: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: '9px',
    fontWeight: '500',
    padding: '1px 4px',
    borderRadius: '2px',
    pointerEvents: 'none',
    zIndex: String(Z.badge - 2),
    whiteSpace: 'nowrap',
    transition: 'top 0.12s ease, opacity 0.12s ease',
    opacity: '1',
    letterSpacing: '0.2px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  });
  document.body.appendChild(lbl);
  inspectorUI.add(lbl);
  return lbl;
}

// Position the label just above the element's top-left corner —
// always OUTSIDE the element bounds so the label never overlaps page
// content. flipped=true flips to just below the bottom-left (cursor
// avoidance, sticky once flipped — see avoidLabelsUnderCursor).
function positionTagLabel(lbl, el, flipped) {
  const r = el.getBoundingClientRect();
  const labelH = lbl.offsetHeight || 14;
  const left = r.left + window.scrollX;
  const top = flipped
    ? r.top + window.scrollY + r.height + 2  // outside below
    : r.top + window.scrollY - labelH - 2;   // outside above
  lbl.style.left = left + 'px';
  lbl.style.top = top + 'px';
}

function removeTagLabel(el) {
  const entry = tagLabels.get(el);
  if (!entry) return;
  inspectorUI.delete(entry.lbl);
  entry.lbl.remove();
  tagLabels.delete(el);
}

function hideTagLabels() {
  Array.from(tagLabels.keys()).forEach(removeTagLabel);
}

// Compute the set of elements that should currently be labeled —
// anything the user is actively engaged with: the hovered element,
// every selected element (group or single), and every element being
// text-edited. Text-tag elements are included too (p, h1, span, …)
// so every kind of element you can touch surfaces its tag.
function desiredLabelEls() {
  const set = new Set();
  if (hoveredEl) set.add(hoveredEl);
  selected.forEach(s => set.add(s.el));
  return set;
}

function refreshTagLabels() {
  const want = desiredLabelEls();
  Array.from(tagLabels.keys()).forEach(el => {
    if (!want.has(el)) removeTagLabel(el);
  });
  const color = getSelectionColor();
  want.forEach(el => {
    let entry = tagLabels.get(el);
    if (!entry) {
      entry = { lbl: createTagLabel(el), flipped: false };
      tagLabels.set(el, entry);
    }
    entry.lbl.textContent = elementLabelText(el);
    entry.lbl.style.background = color;
    positionTagLabel(entry.lbl, el, entry.flipped);
  });
}

function repositionAllTagLabels() {
  tagLabels.forEach((entry, el) => positionTagLabel(entry.lbl, el, entry.flipped));
}

// On every mousemove in Comment mode, check whether the cursor is
// inside any label's bounding rect and shove it out of the way if so.
// Sticky: once a label has flipped, it stays flipped for the lifetime
// of the entry. Snapping it back as soon as the cursor cleared the
// flipped position caused a springy ping-pong, since the cursor would
// then overlap the original (top) position and trigger another flip.
// A new label (created next time the element gains a label) starts
// fresh at flipped=false.
function avoidLabelsUnderCursor(mx, my) {
  tagLabels.forEach((entry, el) => {
    if (entry.flipped) return;
    const r = entry.lbl.getBoundingClientRect();
    const margin = 6;
    const overlap = mx >= r.left - margin && mx <= r.right + margin &&
                    my >= r.top  - margin && my <= r.bottom + margin;
    if (overlap) {
      entry.flipped = true;
      positionTagLabel(entry.lbl, el, true);
    }
  });
}

// Plain click → reset selection to just `el` (or expand to its whole
// group if it's part of one). Shift+click → toggle `el` in/out of the
// existing selection (group-annotation mode).
function selectElement(el, additive) {
  if (additive) {
    const idx = selected.findIndex(s => s.el === el);
    if (idx !== -1) {
      // Toggle off — drop the el from the selection AND from the saved
      // group (when there's still a selection to commit against).
      const removed = selected[idx];
      selected.splice(idx, 1);
      teardownEntry(removed);
      applyOutline(removed.el);
      syncEditor();
      return;
    }
    // Toggle on — extend the group.
    selected.push(buildEntry(el));
    applyOutline(el);
    syncEditor();
    return;
  }

  // Plain click on an element that already belongs to a group annotation
  // re-opens the WHOLE group, not just this one. Otherwise typing would
  // immediately replace the group's annotation with a single-element
  // one and silently strip the note from the other members.
  const ann = findNoteAnnotationByEl(el);
  if (ann) {
    deselectAll();
    ann.els.forEach(groupEl => {
      selected.push(buildEntry(groupEl));
      applyOutline(groupEl);
    });
    syncEditor();
    return;
  }

  deselectAll();
  selected.push(buildEntry(el));
  applyOutline(el);
  syncEditor();
}

function clearSelection() {
  deselectAll();
  closeEditor();
}

// Public: re-select a previously-saved group from outside (annotation
// bubble click). Delegates to selectElement which auto-expands to the
// whole group when the clicked element is a member.
export function focusGroup(els) {
  if (!els || !els.length) return;
  if (!activeMode) {
    activateModule('style-modifier');
    setActiveButton('style-modifier');
  }
  selectElement(els[0], false);
  els[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// --- Hover highlight -----------------------------------------------------
// Two flavors:
//   - block-ish (containers, images, etc): a soft tinted background +
//     a barely-there scale-up so the element feels "lifted" before
//     clicking.
//   - text (P, H1–H6, SPAN, LI, …): a much lighter background tint
//     (text is meant to be read, not painted over) + a more visible
//     scale-up so it pops a touch when hovered.
// We snapshot transform/transition before modifying so unhover
// restores the element exactly (covers pages that rely on their own
// inline transforms).
let hoveredEl = null;

function clearHover() {
  if (!hoveredEl) return;
  applyOutline(hoveredEl);
  hoveredEl = null;
  refreshTagLabels();
}

function onMove(e) {
  if (!activeMode) return;
  // Suppress hover while hand tool or inline editing is active
  if (state.handToolActive || editingEl) {
    if (hoveredEl) clearHover();
    return;
  }
  // Tag labels react to the cursor regardless of which element is
  // currently the hover target — even hovering inside a non-selected
  // child of a labeled selection should still hide the corner pill.
  avoidLabelsUnderCursor(e.clientX, e.clientY);
  const el = e.target;
  if (isInspectorUI(el) || el === document.body || el === document.documentElement) {
    clearHover();
    return;
  }
  if (el === hoveredEl) return;
  clearHover();
  // Don't hover-paint elements that are already selected.
  if (selected.find(s => s.el === el)) return;
  hoveredEl = el;
  ensureOrig(el);

  const color = getSelectionColor();
  el.style.outline = '2.5px solid ' + withAlpha(color, 0.55);
  el.style.backgroundColor = getOrigBackground(el);
  refreshTagLabels();
}

// --- Click handler -------------------------------------------------------
function onClick(e) {
  if (!activeMode) return;
  if (state.handToolActive) return;
  const el = e.target;
  if (isInspectorUI(el)) return;

  // Don't interfere with inline editing
  if (editingEl && (el === editingEl || editingEl.contains(el))) return;

  if (el === document.body || el === document.documentElement) {
    if (isActiveNoteEmpty() && selected.length) {
      clearSelection();
    }
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  clearHover();
  nudge(el);
  setClickOrigin(e.clientX, e.clientY);
  selectElement(el, e.shiftKey);
}

// --- Double-click to edit (experiment-gated) -----------------------------
// Tags that should NOT be made contentEditable (structural/interactive)
const NON_EDITABLE_TAGS = new Set([
  'HTML','BODY','SCRIPT','STYLE','LINK','META','HEAD',
  'IFRAME','OBJECT','EMBED','VIDEO','AUDIO','CANVAS',
  'INPUT','TEXTAREA','SELECT','BUTTON','FORM',
  'SVG','PATH','IMG','BR','HR',
]);

let editingEl = null;

function onDblClick(e) {
  if (!activeMode) return;
  if (!isExperimentEnabled('dblclick-edit')) return;
  if (state.handToolActive) return;
  const el = e.target;
  if (isInspectorUI(el)) return;
  if (!el || !el.tagName || NON_EDITABLE_TAGS.has(el.tagName)) return;
  if (!el.textContent || !el.textContent.trim()) return;

  e.preventDefault();
  e.stopPropagation();

  // Close the bubble that single-click opened — dblclick means "edit text"
  closeEditor();
  deselectAll();

  // Make element editable inline
  editingEl = el;
  ensureOrig(el);
  const originalText = el.innerText;
  const originalClasses = el.className;
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.setAttribute('data-dt-allow-select', '');

  // Visual feedback — text cursor + highlight
  const color = getSelectionColor();
  el.style.outline = '2px solid ' + color;
  el.style.backgroundColor = withAlpha(color, 0.08);
  el.style.cursor = 'text';
  document.documentElement.classList.add('dt-inline-editing');

  // Focus, select all text, and place caret after a tick (let the bubble close first)
  setTimeout(() => {
    el.focus();
    // Select all text so the user sees what they're editing
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }, 0);

  // Track text changes for copy-all output (register once on first input,
  // then re-apply our editing outline since setElementText triggers
  // applyAnnotationStyle which would overwrite it).
  function onInput() {
    setElementText(el, originalText, originalClasses);
    // Restore editing visual — applyAnnotationStyle resets outline/bg
    el.style.outline = '2px solid ' + color;
    el.style.backgroundColor = withAlpha(color, 0.08);
  }
  el.addEventListener('input', onInput);

  // Exit edit on blur or Escape
  function exitEdit() {
    el.removeEventListener('blur', exitEdit);
    el.removeEventListener('keydown', onEditKey);
    el.removeEventListener('input', onInput);
    el.contentEditable = 'false';
    el.removeAttribute('data-dt-allow-select');
    el.style.cursor = '';
    document.documentElement.classList.remove('dt-inline-editing');
    editingEl = null;
    evaluateAnnotation(el);
    applyOutline(el);
  }
  function onEditKey(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      el.blur();
    }
  }
  el.addEventListener('blur', exitEdit);
  el.addEventListener('keydown', onEditKey);
}

// --- Module spec ---------------------------------------------------------
const moduleSpec = {
  id: 'style-modifier',
  label: 'Select',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>',
    tooltip: 'Select (shift+click for group)',
    get color() { return getSelectionColor(); },
    order: 5,
  },

  shortcuts: [],

  init() {
    ensureSelectionStyles();
    ensurePlexMono();
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('mousemove', onMove, true);
    window.addEventListener('scroll', repositionAllTagLabels, true);
    window.addEventListener('resize', repositionAllTagLabels);

    // Live theme updates: re-paint selected outlines, editable-text
    // backgrounds, tag-label backgrounds, and the toolbar button
    // (when active) so a color swap from settings takes effect
    // everywhere.
    onColorChange((color) => {
      selected.forEach(s => applyOutline(s.el));
      tagLabels.forEach((entry) => { entry.lbl.style.background = color; });
      if (activeMode) setActiveButton('style-modifier');
    });
  },

  activate() {
    activeMode = true;
    state.styleModActive = true;
    document.body.style.cursor = '';
    document.documentElement.classList.add('dt-comment-active');
    showToast('Click to select, shift+click to group');
  },

  deactivate() {
    activeMode = false;
    state.styleModActive = false;
    document.body.style.cursor = '';
    document.documentElement.classList.remove('dt-comment-active');
    clearHover();
    clearSelection();
    hideTagLabels();
  },

  toggle() {
    this.activate();
    return true;
  },

  enable() {},
  disable() { this.deactivate(); },
};

export default moduleSpec;
