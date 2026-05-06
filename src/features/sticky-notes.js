import { state, inspectorUI } from '../core/state.js';
import { COLORS, Z } from '../core/constants.js';
import { showToast } from '../core/helpers.js';

const stickyNotes = [];
let _justPlacedNote = false;

function deleteStickyNote(note) {
  const idx = stickyNotes.indexOf(note);
  if (idx !== -1) stickyNotes.splice(idx, 1);
  inspectorUI.delete(note);
  note.remove();
}

function createStickyNote(x, y, initialText) {
  const pageX = x + window.scrollX;
  const pageY = y + window.scrollY;
  const note = document.createElement('div');

  const topBar = document.createElement('div');
  Object.assign(topBar.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    height: '18px', background: COLORS.stickyBorder, borderRadius: '3px 3px 0 0',
    padding: '0 2px 0 0'
  });
  const handle = document.createElement('div');
  Object.assign(handle.style, { flex: '1', height: '100%', cursor: 'grab', userSelect: 'none' });
  const deleteBtn = document.createElement('div');
  deleteBtn.textContent = '\u00d7';
  Object.assign(deleteBtn.style, {
    width: '16px', height: '16px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', fontSize: '13px',
    fontFamily: 'system-ui, sans-serif', color: '#666', borderRadius: '2px',
    lineHeight: '1', flexShrink: '0'
  });
  deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.background = 'rgba(0,0,0,0.1)'; deleteBtn.style.color = '#333'; });
  deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.background = ''; deleteBtn.style.color = '#666'; });
  deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteStickyNote(note); });
  topBar.appendChild(handle);
  topBar.appendChild(deleteBtn);

  const body = document.createElement('div');
  body.contentEditable = 'true';
  body.textContent = initialText || 'Note';
  Object.assign(body.style, {
    padding: '6px 8px', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
    color: '#333', outline: 'none', minHeight: '24px', lineHeight: '1.4'
  });
  note.appendChild(topBar);
  note.appendChild(body);
  Object.assign(note.style, {
    position: 'absolute', left: pageX + 'px', top: pageY + 'px', width: '160px',
    background: COLORS.stickyBg, border: '1px solid ' + COLORS.stickyBorder,
    borderRadius: '4px', zIndex: String(Z.badge),
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)', cursor: 'default'
  });
  document.body.appendChild(note);
  stickyNotes.push(note);
  inspectorUI.add(note);
  _justPlacedNote = true;
  setTimeout(() => { body.focus(); document.execCommand('selectAll'); }, 0);

  // Drag
  let dragging = false, dx = 0, dy = 0;
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    dragging = true;
    dx = (e.clientX + window.scrollX) - note.offsetLeft;
    dy = (e.clientY + window.scrollY) - note.offsetTop;
    handle.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    note.style.left = (e.clientX + window.scrollX - dx) + 'px';
    note.style.top = (e.clientY + window.scrollY - dy) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; handle.style.cursor = 'grab'; }
  });
  note.addEventListener('mousedown', (e) => {
    // Option/Alt + click to duplicate
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const noteBody = note.querySelector('div[contenteditable]');
      const text = noteBody ? noteBody.textContent : 'Note';
      const offsetX = parseInt(note.style.left) + 20 - window.scrollX;
      const offsetY = parseInt(note.style.top) + 20 - window.scrollY;
      createStickyNote(offsetX, offsetY, text);
      return;
    }
    e.stopPropagation();
  });
  note.addEventListener('click', (e) => { e.stopPropagation(); _justPlacedNote = false; });
  note.addEventListener('keydown', (e) => e.stopPropagation());
}

export default {
  id: 'sticky-notes',
  label: 'Sticky Notes',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M19 3H4.99c-1.1 0-1.98.9-1.98 2L3 19c0 1.1.89 2 1.99 2H15l6-6V5c0-1.1-.9-2-2-2zm-7 8H7v-2h5v2zm5-4H7V5h10v2zm-1 10v-4h4l-4 4z"/></svg>',
    tooltip: 'Sticky Note',
    color: COLORS.annotate,
    order: 20,
  },

  shortcuts: [],

  init() {
    // Ghost note that follows cursor
    const ghost = document.createElement('div');
    Object.assign(ghost.style, {
      position: 'fixed', width: '160px', pointerEvents: 'none',
      background: COLORS.stickyBg, border: '1px solid ' + COLORS.stickyBorder,
      borderRadius: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      opacity: '0.5', display: 'none', zIndex: String(Z.badge),
      padding: '20px 8px 8px', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
      color: '#999'
    });
    ghost.textContent = 'Note';
    // Yellow top bar
    const ghostBar = document.createElement('div');
    Object.assign(ghostBar.style, {
      position: 'absolute', top: '0', left: '0', right: '0', height: '18px',
      background: COLORS.stickyBorder, borderRadius: '3px 3px 0 0'
    });
    ghost.appendChild(ghostBar);
    document.body.appendChild(ghost);
    inspectorUI.add(ghost);

    document.addEventListener('mousemove', (e) => {
      if (!state.stickyMode) { ghost.style.display = 'none'; return; }
      ghost.style.display = 'block';
      ghost.style.left = (e.clientX + 8) + 'px';
      ghost.style.top = (e.clientY + 8) + 'px';
    });

    this._ghost = ghost;
  },

  activate() {
    state.annotateMode = true;
    state.annotateSub = 'sticky';
    state.stickyMode = true;
    document.body.style.cursor = 'crosshair';
    showToast('Click to place a note');
  },

  deactivate() {
    if (state.annotateSub === 'sticky') {
      state.annotateMode = false;
    }
    state.stickyMode = false;
    if (this._ghost) this._ghost.style.display = 'none';
  },

  handleClick(e) {
    if (!state.annotateMode || state.annotateSub !== 'sticky') return false;
    e.preventDefault();
    e.stopPropagation();
    if (_justPlacedNote) {
      _justPlacedNote = false;
      if (document.activeElement && document.activeElement.isContentEditable) {
        document.activeElement.blur();
      }
      return true;
    }
    createStickyNote(e.clientX, e.clientY);
    // Exit sticky mode after placing — user must click button again for next note
    this.deactivate();
    return true;
  },

  clear() {
    stickyNotes.forEach(n => { inspectorUI.delete(n); n.remove(); });
    stickyNotes.length = 0;
    showToast('Notes cleared');
  },

  enable() {},
  disable() { this.deactivate(); },
};
