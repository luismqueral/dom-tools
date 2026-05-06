import { state, inspectorUI } from '../core/state.js';
import { OUTLINE, BG, SEL_OUTLINE, SEL_BG, SLOT_OUTLINE, SLOT_BG, Z } from '../core/constants.js';
import { showToast, nudge, getSelector, getContext, isInspectorUI, clearHover, clearSelection, addBadge, refreshBadges } from '../core/helpers.js';
import { getModules } from '../core/registry.js';

// Slot indicator line (created in init)
let slotLine = null;

function getSlotType(el, mouseX, mouseY) {
  const rect = el.getBoundingClientRect();
  const relX = (mouseX - rect.left) / rect.width;
  const relY = (mouseY - rect.top) / rect.height;
  const edge = 0.25;
  const inXCenter = relX >= edge && relX <= (1 - edge);
  const inYCenter = relY >= edge && relY <= (1 - edge);
  if (inXCenter && inYCenter) return 'inside';
  const dTop = relY, dBottom = 1 - relY, dLeft = relX, dRight = 1 - relX;
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min === dTop) return 'before';
  if (min === dBottom) return 'after';
  if (min === dLeft) return 'left';
  return 'right';
}

function updateSlotLine(el, type) {
  const rect = el.getBoundingClientRect();
  if (type === 'inside') { slotLine.style.display = 'none'; return; }
  if (type === 'before' || type === 'after') {
    const y = type === 'before' ? rect.top : rect.bottom;
    Object.assign(slotLine.style, { display: 'block', top: (y - 1) + 'px', left: rect.left + 'px', width: rect.width + 'px', height: '3px' });
  } else {
    const x = type === 'left' ? rect.left : rect.right;
    Object.assign(slotLine.style, { display: 'block', top: rect.top + 'px', left: (x - 1) + 'px', width: '3px', height: rect.height + 'px' });
  }
}

function getSlotDescription(el, type) {
  const sel = getSelector(el);
  const text = el.textContent.trim().substring(0, 60);
  const textPreview = text ? ' | "' + text + (el.textContent.trim().length > 60 ? '...' : '') + '"' : '';
  if (type === 'before') return 'Insert before: ' + sel + textPreview;
  if (type === 'after') return 'Insert after: ' + sel + textPreview;
  if (type === 'left') return 'Insert to the left of: ' + sel + textPreview;
  if (type === 'right') return 'Insert to the right of: ' + sel + textPreview;
  return 'Insert inside: ' + sel + ' (as child)' + textPreview;
}

function onMove(e) {
  if (!state.active || state.editMode || state.cameraMode || state.annotateMode || state.styleModActive) return;
  const el = e.target;
  if (isInspectorUI(el) || el === document.body || el === document.documentElement) return;
  if (el.closest && el.closest('.copy-box')) { clearHover(); return; }
  if (state.hovered && state.hovered !== el) clearHover();
  if (el !== state.hovered) {
    el._origOutline = el._origOutline ?? el.style.outline;
    el._origBg = el._origBg ?? el.style.backgroundColor;
  }
  if (state.altHeld) {
    state.slotType = getSlotType(el, e.clientX, e.clientY);
    el.style.outline = SLOT_OUTLINE;
    el.style.backgroundColor = state.slotType === 'inside' ? SLOT_BG : (el._origBg || '');
    updateSlotLine(el, state.slotType);
  } else {
    slotLine.style.display = 'none';
    el.style.outline = OUTLINE;
    el.style.backgroundColor = BG;
  }
  state.hovered = el;
}

function onClick(e) {
  if ((!state.active && !state.annotateMode) || state.editMode || state.styleModActive) return;
  const el = e.target;
  if (isInspectorUI(el)) return;
  if (el.closest && el.closest('.copy-box')) return;

  // Delegate to sticky notes if in sticky mode
  if (state.annotateMode && state.annotateSub === 'sticky') {
    const stickyMod = getModules().find(m => m.id === 'sticky-notes');
    if (stickyMod && stickyMod.handleClick) { stickyMod.handleClick(e); return; }
  }
  if (state.annotateMode) return; // pen mode handles its own events
  if (state.cameraMode) return;

  e.preventDefault();
  e.stopPropagation();
  nudge(el);

  if (e.altKey && state.slotType) {
    const slotDesc = getSlotDescription(el, state.slotType);
    slotLine.style.display = 'none';
    navigator.clipboard.writeText(slotDesc).then(() => {
      showToast('Slot copied: ' + slotDesc);
    }).catch(() => showToast(slotDesc));
  } else if (e.shiftKey) {
    const desc = getContext(el);
    const idx = state.selected.findIndex(s => s.el === el);
    if (idx !== -1) {
      el.style.outline = el._origOutline || '';
      el.style.backgroundColor = el._origBg || '';
      if (state.selected[idx].badge) state.selected[idx].badge.remove();
      state.selected.splice(idx, 1);
      refreshBadges();
    } else {
      el.style.outline = SEL_OUTLINE;
      el.style.backgroundColor = SEL_BG;
      const badge = addBadge(el, state.selected.length + 1);
      state.selected.push({ el, desc, badge });
    }
    if (state.selected.length) {
      const combined = state.selected.map((s, i) => `[${i + 1}] ${s.desc}`).join('\n');
      navigator.clipboard.writeText(combined).then(() => {
        showToast(`Copied ${state.selected.length} selection${state.selected.length > 1 ? 's' : ''}`);
      }).catch(() => showToast(combined));
    } else {
      showToast('Selection cleared');
    }
  } else {
    const desc = getContext(el);
    clearSelection();
    navigator.clipboard.writeText(desc).then(() => {
      showToast('Copied: ' + desc);
    }).catch(() => showToast(desc));
  }
}

export default {
  id: 'selector',
  label: 'Selector',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>',
    tooltip: 'Selector',
    color: '#0066ff',
    order: 50,
  },

  shortcuts: [
    { key: 'K', meta: true, shift: true, action: 'toggle' }
  ],

  init() {
    slotLine = document.createElement('div');
    Object.assign(slotLine.style, {
      position: 'fixed', left: '0', top: '0', height: '3px', width: '0',
      background: '#00a651', zIndex: String(Z.tooltip), pointerEvents: 'none',
      display: 'none', borderRadius: '2px',
      boxShadow: '0 0 6px rgba(0, 166, 81, 0.5)'
    });
    document.body.appendChild(slotLine);
    inspectorUI.add(slotLine);

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseleave', clearHover, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', (e) => {
      if (!state.active) return;
      if (e.shiftKey || e.altKey) e.preventDefault();
    }, true);
  },

  activate() {
    state.active = true;
    document.body.style.cursor = 'crosshair';
    showToast('Inspector ON — click to copy, Shift multi-select, Alt for slots');
  },

  deactivate() {
    state.active = false;
    clearHover();
    clearSelection();
    slotLine.style.display = 'none';
  },

  toggle() {
    if (state.active && !state.editMode && !state.cameraMode) {
      this.deactivate();
      document.body.style.cursor = 'crosshair';
      showToast('Inspector OFF');
      return false;
    } else {
      this.activate();
      return true;
    }
  },

  enable() {},
  disable() { this.deactivate(); },
};
