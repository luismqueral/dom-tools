/**
 * Text tool — minimal, distraction-free inline text editor.
 *
 * Hover a text element to see a dashed border + "click to edit" label.
 * Click to drop a caret — the element goes completely naked (no border,
 * no label, no wash). Edits are tracked through the annotation system
 * and roll into the "copy all changes" output silently.
 */

import { state, inspectorUI } from '../core/state.js';
import { COLORS, Z } from '../core/constants.js';
import { showToast, isInspectorUI } from '../core/helpers.js';
import { getSelectionColor, withAlpha } from '../core/theme.js';
import {
  setElementText, evaluateAnnotation, queueRepositionAll,
  ensureOrig, applyAnnotationStyle, getOrigBackground,
} from './annotations.js';

const BLUE = COLORS.selector;
const TEXT_TAGS = [
  'P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI',
  'BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL','TD','TH',
  'DIV',
];

let activeMode = false;
let hoveredEl = null;
const editableEls = new Set();
const inputHandlers = new WeakMap();

// Shared hover label element
let hoverLabel = null;

function isTextElement(el) {
  if (!el || el.nodeType !== 1) return false;
  if (TEXT_TAGS.includes(el.tagName)) return true;
  // Also allow divs/other elements that contain direct text
  if (el.tagName === 'DIV' && el.textContent && el.textContent.trim()) return true;
  return false;
}

// --- Hover label -----------------------------------------------------------

function ensureHoverLabel() {
  if (hoverLabel) return;
  hoverLabel = document.createElement('div');
  hoverLabel.textContent = 'click to edit';
  Object.assign(hoverLabel.style, {
    position: 'fixed',
    zIndex: String(Z.tooltip),
    background: 'rgba(0,0,0,0.45)',
    color: 'rgba(255,255,255,0.8)',
    fontSize: '9px',
    fontFamily: 'system-ui, sans-serif',
    fontWeight: '400',
    padding: '2px 6px',
    borderRadius: '3px',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    opacity: '0',
    transition: 'opacity 0.12s',
    letterSpacing: '0.1px',
  });
  document.body.appendChild(hoverLabel);
  inspectorUI.add(hoverLabel);
}

function positionLabel(el) {
  if (!hoverLabel) return;
  const rect = el.getBoundingClientRect();
  hoverLabel.style.top = (rect.top - 22) + 'px';
  hoverLabel.style.left = (rect.right - hoverLabel.offsetWidth) + 'px';
  // If label would go offscreen top, put it below
  if (rect.top - 22 < 4) {
    hoverLabel.style.top = (rect.bottom + 4) + 'px';
  }
  // Clamp left
  const labelRect = hoverLabel.getBoundingClientRect();
  if (labelRect.left < 4) hoverLabel.style.left = '4px';
  hoverLabel.style.opacity = '1';
}

function hideLabel() {
  if (hoverLabel) hoverLabel.style.opacity = '0';
}

function destroyLabel() {
  if (hoverLabel) {
    inspectorUI.delete(hoverLabel);
    hoverLabel.remove();
    hoverLabel = null;
  }
}

// --- Hover border ----------------------------------------------------------

function applyHoverBorder(el) {
  ensureOrig(el);
  el.style.outline = '1px dashed rgba(150,150,150,0.5)';
  el.style.outlineOffset = '2px';
}

function clearHoverBorder(el) {
  if (!el) return;
  if (editableEls.has(el)) {
    el.style.outline = '';
    el.style.outlineOffset = '';
  } else {
    applyAnnotationStyle(el);
    el.style.outlineOffset = '';
  }
}

// --- Hover logic -----------------------------------------------------------

function clearHover() {
  if (!hoveredEl) return;
  clearHoverBorder(hoveredEl);
  hideLabel();
  hoveredEl = null;
}

function onMove(e) {
  if (!activeMode) return;
  // Suppress all hover states while actively editing
  if (editableEls.size > 0) { clearHover(); return; }
  const el = e.target;
  if (isInspectorUI(el) || !isTextElement(el)) {
    clearHover();
    return;
  }
  if (el === hoveredEl) return;
  clearHover();
  hoveredEl = el;
  applyHoverBorder(el);
  ensureHoverLabel();
  positionLabel(el);
}

// --- Caret placement -------------------------------------------------------

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

// --- Editable lifecycle ----------------------------------------------------

function makeEditable(el) {
  if (editableEls.has(el)) return;
  editableEls.add(el);
  ensureOrig(el);
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.setAttribute('data-gramm', 'false');
  el.setAttribute('data-gramm_editor', 'false');
  el.setAttribute('data-enable-grammarly', 'false');
  el.setAttribute('data-lt-tmp-id', '');
  el.setAttribute('data-dt-text-editing', '');
  el.style.cursor = 'text';
  // Naked — no border, no wash, just plain text + caret
  el.style.outline = 'none';
  el.style.outlineOffset = '';
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
  el.removeAttribute('data-dt-text-editing');
  el.contentEditable = 'false';
  el.style.cursor = '';
  el.style.outline = '';
  el.style.outlineOffset = '';
  const h = inputHandlers.get(el);
  if (h) {
    el.removeEventListener('input', h);
    inputHandlers.delete(el);
  }
  editableEls.delete(el);
  applyAnnotationStyle(el);
}

// --- Click handler ---------------------------------------------------------

function onClick(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el) || !isTextElement(el)) return;
  if (editableEls.has(el)) return;

  e.preventDefault();
  e.stopPropagation();
  clearHover();

  makeEditable(el);

  const x = e.clientX, y = e.clientY;
  setTimeout(() => {
    el.focus();
    placeCaretFromPoint(x, y);
  }, 0);
}

// --- Module spec -----------------------------------------------------------

export default {
  id: 'edit-mode',
  label: 'Edit Text',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7C4 6.06812 4 5.60218 4.15224 5.23463C4.35523 4.74458 4.74458 4.35523 5.23463 4.15224C5.60218 4 6.06812 4 7 4H17C17.9319 4 18.3978 4 18.7654 4.15224C19.2554 4.35523 19.6448 4.74458 19.8478 5.23463C20 5.60218 20 6.06812 20 7M9 20H15M12 4V20" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tooltip: 'Edit Text',
    color: BLUE,
    order: 8,
  },

  shortcuts: [],

  init() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove, true);
  },

  activate() {
    activeMode = true;
    state.editMode = true;
    showToast('Edit Text — click any text to edit it inline');
  },

  deactivate() {
    activeMode = false;
    state.editMode = false;
    clearHover();
    destroyLabel();
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
