/**
 * Text tool — minimal inline text editor.
 *
 * Click any text-tagged element to drop a caret in and start typing.
 * Edits are tracked through the annotation system (originalText vs current
 * innerText). The element gets the same pink scrim other annotated
 * elements get, and the diff rolls into the "copy all changes" output
 * alongside notes — no separate on-page marker.
 *
 * No Tailwind toolbar, no global designMode — each element is made
 * contentEditable on click and reverted on tool deactivate. Sibling tool
 * to the Comment cursor; only one tool is active at a time.
 */

import { state } from '../core/state.js';
import { COLORS } from '../core/constants.js';
import { showToast, isInspectorUI } from '../core/helpers.js';
import { getSelectionColor, withAlpha, onColorChange } from '../core/theme.js';
import {
  setElementText, evaluateAnnotation, queueRepositionAll,
  ensureOrig, applyAnnotationStyle, getOrigBackground,
} from './annotations.js';

// Toolbar button keeps its own identity color so the icon is visually
// distinct from the Comment cursor in the rail. Text mode is
// intentionally chrome-free while you're typing — no border, no scrim,
// no comment bubble. Hover before you click still shows a soft wash so
// you can see what you're about to edit, but the moment you commit to
// editing the surface goes back to looking like plain page text.
const ORANGE = COLORS.edit;
const TEXT_TAGS = [
  'P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI',
  'BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL','TD','TH'
];

let activeMode = false;
let hoveredEl = null;
let highlightActive = false;
const highlightedEls = new Set();
const editableEls = new Set();
const inputHandlers = new WeakMap();

function isTextElement(el) {
  return el && el.nodeType === 1 && TEXT_TAGS.includes(el.tagName);
}

function highlightAllTextElements() {
  if (highlightActive) return;
  highlightActive = true;
  const color = withAlpha(getSelectionColor(), 0.08);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (isTextElement(node) && !isInspectorUI(node)) {
      ensureOrig(node);
      node.style.backgroundColor = color;
      highlightedEls.add(node);
    }
  }
}

function clearAllHighlights() {
  if (!highlightActive) return;
  highlightActive = false;
  highlightedEls.forEach(el => {
    if (!editableEls.has(el)) applyAnnotationStyle(el);
  });
  highlightedEls.clear();
}

function clearHover() {
  if (!hoveredEl) return;
  if (!editableEls.has(hoveredEl)) applyAnnotationStyle(hoveredEl);
  hoveredEl = null;
}

function onMove(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el) || !isTextElement(el)) {
    clearHover();
    return;
  }
  if (el === hoveredEl) return;
  clearHover();
  hoveredEl = el;
  ensureOrig(el);
  if (!editableEls.has(el)) {
    // Light wash on hover — no border, matches the Comment tool's
    // text-hover treatment so the two tools feel the same.
    el.style.backgroundColor = withAlpha(getSelectionColor(), 0.10);
  }
}

// Place a collapsed selection range at the (clientX, clientY) point so
// the caret lands where the user actually clicked, not at the element's
// start. Uses both spec'd APIs for cross-browser support.
function placeCaretFromPoint(clientX, clientY) {
  let range = null;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  } else if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(clientX, clientY);
  }
  if (range) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function makeEditable(el) {
  if (editableEls.has(el)) return;
  editableEls.add(el);
  ensureOrig(el);
  el.contentEditable = 'true';
  el.spellcheck = false;
  // Opt-out for Grammarly / LanguageTool / similar editor extensions.
  el.setAttribute('data-gramm', 'false');
  el.setAttribute('data-gramm_editor', 'false');
  el.setAttribute('data-enable-grammarly', 'false');
  el.setAttribute('data-lt-tmp-id', '');
  el.style.cursor = 'text';
  // While the user is typing the element should look untouched — no
  // border, no scrim, no all-text wash. Just a caret on plain text.
  el.style.outline = '';
  el.style.backgroundColor = getOrigBackground(el);

  const originalText = el.innerText;
  const originalClasses = el.className;
  const handler = () => {
    setElementText(el, originalText, originalClasses);
    evaluateAnnotation(el);
    queueRepositionAll();
  };
  el.addEventListener('input', handler);
  inputHandlers.set(el, handler);
}

function unmakeEditable(el) {
  if (!editableEls.has(el)) return;
  el.contentEditable = 'false';
  el.style.cursor = '';
  el.style.outline = '';
  const h = inputHandlers.get(el);
  if (h) {
    el.removeEventListener('input', h);
    inputHandlers.delete(el);
  }
  editableEls.delete(el);
  applyAnnotationStyle(el);
}

function onClick(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el) || !isTextElement(el)) return;
  if (editableEls.has(el)) return;

  e.preventDefault();
  e.stopPropagation();
  clearAllHighlights();
  clearHover();

  // Text mode is purely about typing — no comment bubble, no border.
  // The diff (originalText vs current innerText) still rolls into
  // copy-all output via setElementText in the input handler.
  makeEditable(el);

  const x = e.clientX, y = e.clientY;
  setTimeout(() => {
    el.focus();
    placeCaretFromPoint(x, y);
  }, 0);
}

export default {
  id: 'edit-mode',
  label: 'Edit Text',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>',
    tooltip: 'Edit Text',
    color: ORANGE,
    order: 8,
  },

  shortcuts: [],

  init() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove, true);

    onColorChange((color) => {
      // Editable elements aren't tinted anymore, so nothing to repaint
      // there. Just refresh the all-text wash and the hover wash.
      if (highlightActive) {
        highlightedEls.forEach(el => {
          if (!editableEls.has(el)) el.style.backgroundColor = withAlpha(color, 0.08);
        });
      }
      if (hoveredEl && !editableEls.has(hoveredEl)) {
        hoveredEl.style.backgroundColor = withAlpha(color, 0.10);
      }
    });
  },

  activate() {
    activeMode = true;
    state.editMode = true;
    highlightAllTextElements();
    showToast('Edit Text — click any text to edit it inline');
  },

  deactivate() {
    activeMode = false;
    state.editMode = false;
    clearAllHighlights();
    clearHover();
    Array.from(editableEls).forEach(unmakeEditable);
  },

  toggle() {
    if (activeMode) { this.deactivate(); return false; }
    this.activate();
    return true;
  },

  enable() {},
  disable() { this.deactivate(); },
};
