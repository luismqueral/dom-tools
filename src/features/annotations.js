import { state, inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { showToast, isInspectorUI, getSelector } from '../core/helpers.js';
import { showRailPanel, hideRailPanel, updateCopyBadge } from '../rail.js';
import { renderDesignControls, CLASSES } from './style-modifier.js';
import { loadTailwind } from '../core/tailwind.js';

// --- Annotation store ---
let annotations = []; // { id, el, selector, note, originalClasses, labelEl }
let nextId = 1;
let activeMode = false;
let activeAnnotation = null; // currently editing

export function getAnnotations() { return annotations; }

// --- Label anchored to element ---
function createLabel(annotation, num) {
  const label = document.createElement('div');
  label.textContent = num;
  Object.assign(label.style, {
    position: 'absolute', top: '-4px', right: '-4px',
    width: '18px', height: '18px', borderRadius: '50%',
    background: '#f59e0b', color: '#000', fontSize: '10px', fontWeight: '700',
    fontFamily: 'system-ui, sans-serif',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', zIndex: String(Z.badge),
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)', pointerEvents: 'auto',
    transition: 'transform 0.1s'
  });

  // Ensure element can hold absolute children
  const pos = getComputedStyle(annotation.el).position;
  if (pos === 'static') annotation.el.style.position = 'relative';

  label.addEventListener('mouseenter', () => { label.style.transform = 'scale(1.2)'; });
  label.addEventListener('mouseleave', () => { label.style.transform = 'scale(1)'; });
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    openAnnotation(annotation);
  });

  annotation.el.appendChild(label);
  inspectorUI.add(label);
  return label;
}

function renumberLabels() {
  annotations.forEach((ann, i) => {
    if (ann.labelEl) ann.labelEl.textContent = i + 1;
  });
}

// --- Open annotation editor in rail panel ---
function openAnnotation(annotation) {
  activeAnnotation = annotation;
  const container = document.createElement('div');

  // Header: element info
  const header = document.createElement('div');
  Object.assign(header.style, { marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)' });
  const tag = document.createElement('div');
  tag.textContent = `<${annotation.el.tagName.toLowerCase()}>`;
  Object.assign(tag.style, { fontSize: '11px', fontWeight: '600', color: '#f59e0b', marginBottom: '2px' });
  const sel = document.createElement('div');
  sel.textContent = annotation.selector;
  Object.assign(sel.style, {
    fontSize: '9px', color: '#888', fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  });
  header.appendChild(tag);
  header.appendChild(sel);
  container.appendChild(header);

  // Prose note textarea
  const noteLabel = document.createElement('div');
  noteLabel.textContent = 'NOTE';
  Object.assign(noteLabel.style, { fontSize: '9px', fontWeight: '700', color: '#666', marginBottom: '4px', letterSpacing: '0.5px' });
  container.appendChild(noteLabel);

  const textarea = document.createElement('textarea');
  textarea.value = annotation.note || '';
  textarea.placeholder = 'Describe what you want changed...';
  Object.assign(textarea.style, {
    width: '100%', minHeight: '60px', padding: '8px', borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
    color: '#fff', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
    resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: '1.4'
  });
  textarea.addEventListener('input', () => {
    annotation.note = textarea.value;
    updateBadgeCount();
  });
  textarea.addEventListener('mousedown', (e) => e.stopPropagation());
  textarea.addEventListener('keydown', (e) => e.stopPropagation());
  container.appendChild(textarea);

  // Divider
  const divider = document.createElement('div');
  Object.assign(divider.style, { height: '1px', background: 'rgba(255,255,255,0.08)', margin: '12px 0' });
  container.appendChild(divider);

  // Tailwind controls section
  const twLabel = document.createElement('div');
  twLabel.textContent = 'TAILWIND CLASSES';
  Object.assign(twLabel.style, { fontSize: '9px', fontWeight: '700', color: '#666', marginBottom: '8px', letterSpacing: '0.5px' });
  container.appendChild(twLabel);

  const controlsContainer = document.createElement('div');
  container.appendChild(controlsContainer);

  // Render Tailwind design controls for this annotation's element
  const elements = [{ el: annotation.el, originalClasses: annotation.originalClasses }];
  renderDesignControls(controlsContainer, elements, () => {
    updateBadgeCount();
  });

  // Delete annotation button
  const deleteSection = document.createElement('div');
  Object.assign(deleteSection.style, { marginTop: '14px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' });
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Remove Annotation';
  Object.assign(deleteBtn.style, {
    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
    color: '#ef4444', padding: '5px 12px', borderRadius: '4px',
    fontSize: '10px', fontWeight: '600', cursor: 'pointer', width: '100%'
  });
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeAnnotation(annotation);
  });
  deleteSection.appendChild(deleteBtn);
  container.appendChild(deleteSection);

  showRailPanel(container);

  // Highlight the annotated element
  annotation.el.style.outline = '2px solid #f59e0b';
}

function removeAnnotation(annotation) {
  // Remove label from DOM
  if (annotation.labelEl) {
    annotation.labelEl.remove();
  }
  // Restore element state
  annotation.el.style.outline = '';
  annotation.el.className = annotation.originalClasses;

  // Remove from store
  const idx = annotations.indexOf(annotation);
  if (idx !== -1) annotations.splice(idx, 1);

  renumberLabels();
  updateBadgeCount();
  activeAnnotation = null;
  hideRailPanel();
  showToast('Annotation removed');
}

function updateBadgeCount() {
  const count = annotations.filter(a => {
    const hasNote = a.note && a.note.trim().length > 0;
    const hasClassChanges = a.el.className !== a.originalClasses;
    return hasNote || hasClassChanges;
  }).length;
  updateCopyBadge(count);
}

// --- Hover highlight ---
let hoveredEl = null;

function onMove(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el) || el === document.body || el === document.documentElement) {
    clearHoverHighlight();
    return;
  }
  if (el === hoveredEl) return;
  clearHoverHighlight();
  hoveredEl = el;
  hoveredEl._annHoverOutline = hoveredEl.style.outline;
  hoveredEl.style.outline = '2px solid rgba(245,158,11,0.5)';
}

function clearHoverHighlight() {
  if (hoveredEl) {
    hoveredEl.style.outline = hoveredEl._annHoverOutline || '';
    delete hoveredEl._annHoverOutline;
    hoveredEl = null;
  }
}

// --- Click handler ---
function onClick(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el)) return;

  e.preventDefault();
  e.stopPropagation();
  clearHoverHighlight();

  // If element already has an annotation, open it
  const existing = annotations.find(a => a.el === el);
  if (existing) {
    openAnnotation(existing);
    return;
  }

  // Create new annotation
  const annotation = {
    id: nextId++,
    el,
    selector: getSelector(el),
    note: '',
    originalClasses: el.className,
    labelEl: null
  };

  annotations.push(annotation);
  annotation.labelEl = createLabel(annotation, annotations.length);
  openAnnotation(annotation);
  updateBadgeCount();
}

export default {
  id: 'annotations',
  label: 'Annotate',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/></svg>',
    tooltip: 'Annotate',
    color: '#f59e0b',
    order: 25,
  },

  shortcuts: [],

  init() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove, true);
  },

  activate() {
    loadTailwind();
    activeMode = true;
    showToast('Annotate — click elements to add notes + class changes');
  },

  deactivate() {
    activeMode = false;
    clearHoverHighlight();
    if (activeAnnotation) {
      activeAnnotation.el.style.outline = '';
      activeAnnotation = null;
    }
    hideRailPanel();
  },

  toggle() {
    if (activeMode) { this.deactivate(); return false; }
    else { this.activate(); return true; }
  },

  enable() {},
  disable() { this.deactivate(); },
};
