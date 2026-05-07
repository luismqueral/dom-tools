/**
 * Comment tool — minimal click-to-leave-feedback mode.
 *
 * Click any element on the page → it gets a pink outline and a small dark
 * popover floats near it with a textarea. Type your note; it's saved live to
 * the annotation store and shows up as a persistent on-page bubble (handled by
 * annotations.js). Esc or blur closes the popover. Text-tagged elements are
 * also editable inline; edits are tracked and surfaced through copy-all.
 *
 * Replaces the old Tailwind-driven Design mode for the minimal build.
 */

import { state } from '../core/state.js';
import { Z } from '../core/constants.js';
import { showToast, isInspectorUI, addTooltip } from '../core/helpers.js';
import { setActiveButton } from '../toolbar.js';
import { activateModule } from '../core/registry.js';
// NOTE: circular import with annotations.js is intentional and safe — both
// only call each other from runtime event handlers, never at module eval.
import { setElementNote, getElementNote, queueRepositionAll, setElementText, evaluateAnnotation } from './annotations.js';

const TEXT_TAGS = ['P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI','BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL'];
const PINK = '#ec4899';

let activeMode = false;
let selected = [];

export function getSelected() { return selected; }

// --- Floating popover (the input itself) ---------------------------------
let popover = null;
let popoverTextarea = null;
let popoverEl = null;

function buildPopover() {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'absolute',
    width: '260px',
    padding: '8px',
    background: 'rgba(24,24,24,0.96)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    zIndex: String(Z.toolbar),
    fontFamily: 'system-ui, sans-serif',
    boxSizing: 'border-box',
  });

  const ta = document.createElement('textarea');
  ta.placeholder = 'Describe the change…';
  Object.assign(ta.style, {
    width: '100%', minHeight: '60px', padding: '7px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff', fontSize: '12px', lineHeight: '1.4',
    fontFamily: 'system-ui, sans-serif', resize: 'vertical',
    outline: 'none', boxSizing: 'border-box', borderRadius: '4px'
  });
  wrap.appendChild(ta);

  // Stop click/mousedown from bubbling so the doc-level handlers below
  // (which clear selection on outside-click) don't fire on our own UI.
  ['mousedown','click','mouseup'].forEach(t => {
    wrap.addEventListener(t, (e) => e.stopPropagation());
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { hidePopover(); }
  });
  ta.addEventListener('blur', () => {
    setTimeout(() => {
      if (popoverTextarea && document.activeElement !== popoverTextarea) hidePopover();
    }, 120);
  });

  popoverTextarea = ta;
  popoverEl = wrap;
  return wrap;
}

function positionPopover(el) {
  if (!popoverEl) return;
  const r = el.getBoundingClientRect();
  const popH = popoverEl.offsetHeight || 100;
  const popW = popoverEl.offsetWidth || 260;
  // Prefer above, anchored to the element's left edge
  let top = r.top + window.scrollY - popH - 8;
  if (top < window.scrollY + 8) top = r.bottom + window.scrollY + 8;
  let left = r.left + window.scrollX;
  left = Math.max(window.scrollX + 8, Math.min(left, window.scrollX + window.innerWidth - popW - 8));
  popoverEl.style.left = left + 'px';
  popoverEl.style.top = top + 'px';
}

function showPopover(entry) {
  hidePopover();
  popover = buildPopover();
  document.body.appendChild(popover);
  popoverTextarea.value = getElementNote(entry.el) || '';
  positionPopover(entry.el);
  popoverTextarea.addEventListener('input', () => {
    setElementNote(entry.el, popoverTextarea.value, entry.originalClasses);
  });
  setTimeout(() => {
    if (popoverTextarea) {
      popoverTextarea.focus();
      const end = popoverTextarea.value.length;
      try { popoverTextarea.setSelectionRange(end, end); } catch (_) {}
    }
  }, 0);
}

function hidePopover() {
  if (popover) { popover.remove(); popover = null; popoverEl = null; popoverTextarea = null; }
}

function repositionPopover() {
  if (popoverEl && selected.length) positionPopover(selected[0].el);
}
window.addEventListener('scroll', repositionPopover, true);
window.addEventListener('resize', repositionPopover);

// --- Selection -----------------------------------------------------------
function teardownEntry(s) {
  s.el.style.outline = s.origOutline;
  if (s.madeEditable) { s.el.contentEditable = 'false'; s.el.style.cursor = ''; }
  if (s.onTextInput) { s.el.removeEventListener('input', s.onTextInput); s.onTextInput = null; }
}

function selectElement(el) {
  selected.forEach(teardownEntry);
  selected = [];

  const entry = {
    el,
    originalClasses: el.className,
    origOutline: el.style.outline,
    madeEditable: false,
  };

  if (TEXT_TAGS.includes(el.tagName)) {
    el.contentEditable = 'true';
    el.style.cursor = 'text';
    entry.madeEditable = true;
    entry.originalText = el.innerText;
    entry.onTextInput = () => {
      setElementText(el, entry.originalText, entry.originalClasses);
      evaluateAnnotation(el);
      queueRepositionAll();
    };
    el.addEventListener('input', entry.onTextInput);
  }

  el.style.outline = '2px solid ' + PINK;
  selected.push(entry);
  showPopover(entry);
}

function clearSelection() {
  selected.forEach(teardownEntry);
  selected = [];
  hidePopover();
}

// Public: activate from outside (annotation bubble click)
export function focusElement(el) {
  if (!activeMode) {
    activateModule('style-modifier');
    setActiveButton('style-modifier');
  }
  selectElement(el);
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// --- Hover highlight -----------------------------------------------------
let hoveredEl = null;

function clearHover() {
  if (hoveredEl) {
    hoveredEl.style.outline = hoveredEl._smHoverOutline || '';
    hoveredEl.style.backgroundColor = hoveredEl._smHoverBg || '';
    delete hoveredEl._smHoverOutline;
    delete hoveredEl._smHoverBg;
    hoveredEl = null;
  }
}

function onMove(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el) || el === document.body || el === document.documentElement) {
    clearHover();
    return;
  }
  if (el === hoveredEl) return;
  clearHover();
  if (selected.find(s => s.el === el)) return;
  hoveredEl = el;
  hoveredEl._smHoverOutline = hoveredEl.style.outline;
  hoveredEl._smHoverBg = hoveredEl.style.backgroundColor;
  hoveredEl.style.outline = '2px solid rgba(236,72,153,0.5)';
  hoveredEl.style.backgroundColor = 'rgba(236,72,153,0.04)';
}

// --- Click handler -------------------------------------------------------
function onClick(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el)) return;

  // Click on already-selected text element → drop into the inline editor
  // instead of re-opening the popover (so caret lands on the clicked word).
  const alreadySelected = selected.find(s => s.el === el || s.el.contains(el));
  if (alreadySelected && alreadySelected.madeEditable) {
    e.stopPropagation();
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  clearHover();
  selectElement(el);
}

// --- Module spec ---------------------------------------------------------
export default {
  id: 'style-modifier',
  label: 'Comment',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>',
    tooltip: 'Comment',
    color: PINK,
    order: 5,
  },

  shortcuts: [],

  init() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove, true);
  },

  activate() {
    activeMode = true;
    state.styleModActive = true;
    showToast('Click an element to leave a comment');
  },

  deactivate() {
    activeMode = false;
    state.styleModActive = false;
    clearHover();
    clearSelection();
  },

  // Home mode: clicking the button always activates, never toggles off.
  // Other tools fall back to this module when they deactivate.
  toggle() {
    this.activate();
    return true;
  },

  enable() {},
  disable() { this.deactivate(); },
};
