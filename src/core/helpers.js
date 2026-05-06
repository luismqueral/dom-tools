import { state, inspectorUI } from './state.js';
import { OUTLINE, BG, SEL_OUTLINE, SEL_BG, Z } from './constants.js';

// --- Toast ---
let toast = null;

export function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.style.display = 'none', 200); }, 2000);
}

// --- Tooltip ---
let tooltip = null;
let _tipTimer = null;

export function addTooltip(el, label) {
  el.addEventListener('mouseenter', () => {
    if (!tooltip) return;
    clearTimeout(_tipTimer);
    _tipTimer = setTimeout(() => {
      const r = el.getBoundingClientRect();
      tooltip.textContent = label;
      tooltip.style.display = 'block';
      const tw = tooltip.offsetWidth;
      tooltip.style.left = (r.left + r.width / 2 - tw / 2) + 'px';
      tooltip.style.top = (r.top - 28) + 'px';
      tooltip.style.opacity = '1';
    }, 400);
  });
  el.addEventListener('mouseleave', () => {
    if (!tooltip) return;
    clearTimeout(_tipTimer);
    tooltip.style.opacity = '0';
    setTimeout(() => { tooltip.style.display = 'none'; }, 150);
  });
}

// --- Init DOM elements (called once on boot) ---
export function initHelpers() {
  toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
    background: '#222', color: '#fff', padding: '8px 16px', borderRadius: '6px',
    fontSize: '13px', fontFamily: 'monospace', zIndex: String(Z.toolbar), display: 'none',
    transition: 'opacity 0.2s', whiteSpace: 'nowrap', maxWidth: '90vw', overflow: 'hidden', textOverflow: 'ellipsis'
  });
  document.body.appendChild(toast);
  inspectorUI.add(toast);

  tooltip = document.createElement('div');
  Object.assign(tooltip.style, {
    position: 'fixed', background: '#222', color: '#fff', padding: '4px 8px',
    borderRadius: '4px', fontSize: '11px', fontFamily: 'system-ui, sans-serif',
    fontWeight: '500', zIndex: String(Z.tooltip), pointerEvents: 'none', display: 'none',
    whiteSpace: 'nowrap', opacity: '0', transition: 'opacity 0.15s', letterSpacing: '0.2px'
  });
  document.body.appendChild(tooltip);
  inspectorUI.add(tooltip);

  const nudgeStyle = document.createElement('style');
  nudgeStyle.textContent = `
    @keyframes inspector-nudge {
      0% { transform: translateY(0); }
      30% { transform: translateY(3px); }
      100% { transform: translateY(0); }
    }
    .inspector-nudge { animation: inspector-nudge 0.2s ease-out; }
  `;
  document.head.appendChild(nudgeStyle);
}

export function nudge(el) {
  el.classList.remove('inspector-nudge');
  void el.offsetWidth;
  el.classList.add('inspector-nudge');
  el.addEventListener('animationend', () => el.classList.remove('inspector-nudge'), { once: true });
}

// --- Flash screen ---
export function flashElement(el) {
  const rect = el.getBoundingClientRect();
  const flash = document.createElement('div');
  Object.assign(flash.style, {
    position: 'fixed', top: rect.top + 'px', left: rect.left + 'px',
    width: rect.width + 'px', height: rect.height + 'px',
    background: '#fff', zIndex: String(Z.flash),
    opacity: '0.7', pointerEvents: 'none', transition: 'opacity 0.3s',
    borderRadius: getComputedStyle(el).borderRadius
  });
  document.body.appendChild(flash);
  requestAnimationFrame(() => {
    flash.style.opacity = '0';
    setTimeout(() => flash.remove(), 300);
  });
}

// --- Selector utilities ---
export function getSelector(el) {
  if (el.id) return '#' + el.id;
  let path = [];
  while (el && el !== document.body) {
    let seg = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      seg += '.' + el.className.trim().split(/\s+/).join('.');
    }
    path.unshift(seg);
    el = el.parentElement;
  }
  return path.join(' > ');
}

export function getContext(el) {
  const sel = getSelector(el);
  const text = el.textContent.trim().substring(0, 80);
  let desc = sel;
  if (text) desc += ' | "' + text + (el.textContent.trim().length > 80 ? '...' : '') + '"';
  return desc;
}

export function isInspectorUI(el) {
  let node = el;
  while (node) {
    if (inspectorUI.has(node)) return true;
    node = node.parentElement;
  }
  return false;
}

export function clearHover() {
  if (state.hovered) {
    const idx = state.selected.findIndex(s => s.el === state.hovered);
    if (idx !== -1) {
      state.hovered.style.outline = SEL_OUTLINE;
      state.hovered.style.backgroundColor = SEL_BG;
    } else {
      state.hovered.style.outline = state.hovered._origOutline || '';
      state.hovered.style.backgroundColor = state.hovered._origBg || '';
    }
    state.hovered = null;
  }
}

export function clearSelection() {
  state.selected.forEach(s => {
    s.el.style.outline = s.el._origOutline || '';
    s.el.style.backgroundColor = s.el._origBg || '';
    if (s.badge) s.badge.remove();
  });
  state.selected = [];
}

export function addBadge(el, num) {
  const badge = document.createElement('div');
  badge.textContent = num;
  Object.assign(badge.style, {
    position: 'absolute', top: '-6px', left: '-6px', width: '18px', height: '18px',
    background: '#0066ff', color: '#fff', borderRadius: '50%', fontSize: '11px',
    fontWeight: '700', fontFamily: 'system-ui, sans-serif', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: String(Z.badge),
    boxShadow: '0 1px 4px rgba(0,0,0,0.25)', pointerEvents: 'none'
  });
  const pos = getComputedStyle(el).position;
  if (pos === 'static') el.style.position = 'relative';
  el.appendChild(badge);
  return badge;
}

export function refreshBadges() {
  state.selected.forEach((s, i) => {
    if (s.badge) s.badge.textContent = i + 1;
  });
}
