/**
 * Comment tool — minimal click-to-leave-feedback mode.
 *
 * Click an element to select it; the pink note bubble that appears IS
 * the editor — type directly into it. Shift+click another element to
 * add it to the current selection — typing then attaches the same note
 * to every selected element as a group annotation. Each selected
 * element gets its own pink-bordered outline while the group is
 * active; once you select something else, those previously-selected
 * (still annotated) elements drop back to a translucent pink scrim
 * instead of a hard border.
 *
 * Comment mode is read-only as far as page text is concerned — inline
 * text editing is the Edit Text tool's job, not ours.
 */

import { state, inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { showToast, isInspectorUI, nudge } from '../core/helpers.js';
import { setActiveButton } from '../toolbar.js';
import { activateModule } from '../core/registry.js';
import { getSelectionColor, withAlpha, onColorChange } from '../core/theme.js';
import { ensurePlexMono } from '../core/fonts.js';
// NOTE: circular import with annotations.js is intentional and safe — both
// only call each other from runtime event handlers, never at module eval.
import {
  setEditorTarget, closeEditor,
  ensureOrig, applyAnnotationStyle, getOrigBackground, getOrigOutline,
  findNoteAnnotationByEl,
  setElementText, evaluateAnnotation, queueRepositionAll,
} from './annotations.js';

// Tags treated as "text" for hover purposes — they get a soft highlight
// instead of the dashed border + scale that block-level elements get.
const TEXT_TAGS = [
  'P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI',
  'BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL','TD','TH'
];
function isTextElement(el) {
  return el && el.nodeType === 1 && TEXT_TAGS.includes(el.tagName);
}

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
  // Text-tag selector kept in lockstep with TEXT_TAGS so hover cursor
  // and hover background-only treatment apply to the same set.
  const textSelector = TEXT_TAGS
    .map(t => `html.dt-comment-active ${t.toLowerCase()}`)
    .join(', ');
  // Anything matching this lives in our own UI and should NOT pick up
  // the page-wide Comment-mode cursor / user-select overrides.
  // :where() has zero specificity, so wrapping it inside the :not()
  // keeps the page rule's specificity manageable.
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
      cursor: default !important;
    }
    html.dt-comment-active [contenteditable="true"],
    html.dt-comment-active [contenteditable="true"] *,
    html.dt-comment-active [data-dt-allow-select],
    html.dt-comment-active [data-dt-allow-select] * {
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    ${textSelector} {
      cursor: text !important;
    }
    html.dt-comment-active [contenteditable="true"],
    html.dt-comment-active [contenteditable="true"] *,
    html.dt-comment-active [data-dt-bubble] textarea {
      cursor: text !important;
    }
    html.dt-comment-active [data-dt-bubble] [aria-label="Drag to move"] {
      cursor: grab !important;
    }
    /* Native text-selection highlight follows the theme color across
       any surface dom-tools is responsible for: the bubble's
       textarea, contentEditable elements we promoted, and (when
       Comment mode is live) the page itself for visual consistency. */
    [data-dt-bubble] textarea::selection,
    [data-dt-bubble] textarea::-moz-selection,
    [contenteditable="true"]::selection,
    [contenteditable="true"] *::selection,
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

// Position the label at the element's top-left corner. For elements
// big enough we tuck it INSIDE the corner (top + 2px); for small
// inline things (a <span>, an <a>, etc.) we float it OUTSIDE just
// above the element so it doesn't sit on top of the text.
//
// flipped=true → flip to the bottom-left equivalent (cursor avoidance).
function positionTagLabel(lbl, el, flipped) {
  const r = el.getBoundingClientRect();
  const labelH = lbl.offsetHeight || 14;
  const useOutside = r.height < labelH * 3;
  const left = r.left + window.scrollX;
  let top;
  if (useOutside) {
    top = flipped
      ? r.top + window.scrollY + r.height + 2          // outside below
      : r.top + window.scrollY - labelH - 2;           // outside above
  } else {
    top = flipped
      ? r.top + window.scrollY + r.height - labelH - 2 // inside bottom
      : r.top + window.scrollY + 2;                    // inside top
  }
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
// text-edited. Text-tag elements are intentionally excluded — labels
// on every paragraph/heading/span feel noisy, and the colored backdrop
// is enough of a "you're touching this" cue for prose. Labels are
// reserved for containers (div, section, etc.) where structure matters.
function desiredLabelEls() {
  const set = new Set();
  if (hoveredEl && !isTextElement(hoveredEl)) set.add(hoveredEl);
  selected.forEach(s => { if (!isTextElement(s.el)) set.add(s.el); });
  editableEls.forEach(el => { if (!isTextElement(el)) set.add(el); });
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
// inside any label's bounding rect and flip its corner if so.
function avoidLabelsUnderCursor(mx, my) {
  tagLabels.forEach((entry, el) => {
    const r = entry.lbl.getBoundingClientRect();
    const margin = 6;
    const overlap = mx >= r.left - margin && mx <= r.right + margin &&
                    my >= r.top  - margin && my <= r.bottom + margin;
    if (overlap !== entry.flipped) {
      entry.flipped = overlap;
      positionTagLabel(entry.lbl, el, overlap);
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
const HOVER_TRANSFORMS = new WeakMap();

function clearHover() {
  if (!hoveredEl) return;
  const orig = HOVER_TRANSFORMS.get(hoveredEl);
  if (orig) {
    hoveredEl.style.transform = orig.transform;
    hoveredEl.style.transition = orig.transition;
    HOVER_TRANSFORMS.delete(hoveredEl);
  }
  applyOutline(hoveredEl);
  hoveredEl = null;
  refreshTagLabels();
}

function onMove(e) {
  if (!activeMode) return;
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
  // Don't hover-paint elements that are already in a "live" state —
  // selected for commenting, or being text-edited.
  if (selected.find(s => s.el === el)) return;
  if (editableEls.has(el)) return;
  hoveredEl = el;
  ensureOrig(el);

  const color = getSelectionColor();
  el.style.outline = getOrigOutline(el);

  HOVER_TRANSFORMS.set(el, {
    transform: el.style.transform || '',
    transition: el.style.transition || '',
  });
  el.style.transition = 'transform 0.12s ease-out';

  if (isTextElement(el)) {
    // Text: lighter wash + a stronger scale so the words feel like
    // they're stepping toward you. transform: scale doesn't reflow,
    // so neighbors don't shift.
    el.style.backgroundColor = withAlpha(color, 0.10);
    el.style.transform = 'scale(1.04)';
  } else {
    // Container: deeper wash (it's a region, not a single line of
    // copy) + a near-imperceptible lift.
    el.style.backgroundColor = withAlpha(color, 0.22);
    el.style.transform = 'scale(1.008)';
  }
  refreshTagLabels();
}

// --- Inline text editing (experiment) -----------------------------------
// Comment mode used to be read-only; the dedicated Edit Text tool was
// the only way to retype copy. Now we also allow inline editing on
// text-tag elements directly from Comment mode — clicking a paragraph
// places a caret AND opens the comment bubble, so the user can either
// type new text or click into the bubble to leave a note. Text edits
// roll into the same annotation tracker, so copy-all picks them up
// regardless of which tool produced them.
const editableEls = new Set();
const inputHandlers = new WeakMap();

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

function makeTextEditable(el) {
  if (editableEls.has(el)) return;
  editableEls.add(el);
  ensureOrig(el);
  el.contentEditable = 'true';
  // Spellcheck draws a red wavy underline under "misspelled" words —
  // for design-tool text edits that's almost always noise. Off.
  el.spellcheck = false;
  // Opt out of editor-injecting browser extensions (Grammarly,
  // LanguageTool, etc.). They add their own colored outlines / icons
  // into any contentEditable they find, which fights our chrome.
  el.setAttribute('data-gramm', 'false');
  el.setAttribute('data-gramm_editor', 'false');
  el.setAttribute('data-enable-grammarly', 'false');
  el.setAttribute('data-lt-tmp-id', '');
  el.style.outline = '2px solid ' + getSelectionColor();
  el.style.backgroundColor = withAlpha(getSelectionColor(), 0.15);
  const originalText = el.innerText;
  const originalClasses = el.className;
  const handler = () => {
    setElementText(el, originalText, originalClasses);
    evaluateAnnotation(el);
    queueRepositionAll();
  };
  el.addEventListener('input', handler);
  inputHandlers.set(el, handler);
  refreshTagLabels();
}

function revertTextEditable(el) {
  if (!editableEls.has(el)) return;
  el.contentEditable = 'false';
  const h = inputHandlers.get(el);
  if (h) {
    el.removeEventListener('input', h);
    inputHandlers.delete(el);
  }
  editableEls.delete(el);
  // Drop our outline; let the shared annotation tracker decide the
  // resting state (scrim if a text edit was made, otherwise pristine).
  applyAnnotationStyle(el);
  refreshTagLabels();
}

function revertAllEditable() {
  Array.from(editableEls).forEach(revertTextEditable);
}

// Intent-aware click router.
//
// The cursor over the click target tells us what the user wanted:
//   - I-beam over a text-tag element → "edit this text". Drop the
//     comment bubble + selection group, flip the element editable,
//     place the caret. No bubble appears — typing IS the action.
//   - Pointer over a container → "comment on this layout". Run the
//     normal selection/group flow, the pink bubble shows up, type a
//     note about it.
//
// Two carve-outs:
//   - Shift+click is always group-select intent (works on text and
//     container alike) — useful when the user actually wants to
//     comment on a paragraph rather than retype it.
//   - Clicking a text-tag element that's already part of a saved
//     comment re-opens the comment instead of trampling it with a
//     fresh text-edit session.
function onClick(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el)) return;
  // <body> / <html> aren't real "elements you'd want to comment on" —
  // they're the canvas. Letting them be selected outlines the whole
  // viewport in theme color and is almost never the user's intent.
  if (el === document.body || el === document.documentElement) return;

  // Re-clicking inside an already-editable text element should just
  // move the caret natively. Don't preventDefault, don't re-copy
  // markup (would spam the clipboard), don't re-trigger selection.
  if (editableEls.has(el)) return;

  e.preventDefault();
  e.stopPropagation();
  clearHover();
  nudge(el);

  // Text-edit intent. The user is doing two related things at once
  // here: rewriting the words on the page AND (potentially) leaving a
  // note about why. Both UIs come up — a caret in the element so they
  // can type, and the comment bubble so they can describe the change.
  // The text element keeps focus by default; clicking the bubble
  // shifts focus to the textarea.
  if (isTextElement(el) && !e.shiftKey) {
    // If the user already has a saved comment on this text, treat the
    // click as "open my note" instead of "retype the words".
    if (findNoteAnnotationByEl(el)) {
      revertAllEditable();
      selectElement(el, false);
      return;
    }
    revertAllEditable();
    const x = e.clientX, y = e.clientY;
    // Bubble first (queues its own focus on the textarea), then make
    // the element editable; our setTimeout below runs LAST and steals
    // focus back to the page text. Net result: caret on text, bubble
    // visible alongside.
    selectElement(el, false);
    makeTextEditable(el);
    setTimeout(() => {
      el.focus();
      placeCaretFromPoint(x, y);
    }, 0);
    return;
  }

  // Container/comment intent (and shift+click). Switching back to
  // commenting flushes any open text-edit so the visual state is
  // unambiguous about what the user is currently doing.
  revertAllEditable();
  selectElement(el, e.shiftKey);
}

// --- Module spec ---------------------------------------------------------
const moduleSpec = {
  id: 'style-modifier',
  label: 'Comment',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>',
    tooltip: 'Comment (shift+click for group)',
    get color() { return getSelectionColor(); },
    order: 5,
  },

  shortcuts: [],

  init() {
    ensureSelectionStyles();
    ensurePlexMono();
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove, true);
    window.addEventListener('scroll', repositionAllTagLabels, true);
    window.addEventListener('resize', repositionAllTagLabels);

    // Live theme updates: re-paint selected outlines, editable-text
    // backgrounds, tag-label backgrounds, and the toolbar button
    // (when active) so a color swap from settings takes effect
    // everywhere.
    onColorChange((color) => {
      selected.forEach(s => applyOutline(s.el));
      editableEls.forEach(el => {
        el.style.outline = '2px solid ' + color;
        el.style.backgroundColor = withAlpha(color, 0.15);
      });
      tagLabels.forEach((entry) => { entry.lbl.style.background = color; });
      if (activeMode) setActiveButton('style-modifier');
    });
  },

  activate() {
    activeMode = true;
    state.styleModActive = true;
    document.body.style.cursor = '';
    document.documentElement.classList.add('dt-comment-active');
    showToast('Click to comment, shift+click to group');
  },

  deactivate() {
    activeMode = false;
    state.styleModActive = false;
    document.body.style.cursor = '';
    document.documentElement.classList.remove('dt-comment-active');
    clearHover();
    clearSelection();
    revertAllEditable();
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
