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

}

// Bounce animation used to confirm "we just did a thing" on an
// element (right-click copy, click-to-select, etc). Implemented via
// the Web Animations API rather than a CSS class — adding/removing a
// class would (and used to) pollute getSelector() output and the
// originalClasses snapshot that copy-all uses to compute class
// diffs. Web Animations API doesn't touch className or inline style,
// so the user-visible effect is the same and the selectors stay clean.
export function nudge(el) {
  if (!el || typeof el.animate !== 'function') return;
  el.animate(
    [
      { transform: 'translateY(0)' },
      { transform: 'translateY(3px)', offset: 0.3 },
      { transform: 'translateY(0)' },
    ],
    { duration: 200, easing: 'ease-out' }
  );
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

// --- Clipboard ---
// navigator.clipboard.writeText is the modern path but it rejects in
// several real-world cases: insecure context (http://, file://), pages
// that block the clipboard via Permissions-Policy, or some browsers
// when the document isn't focused. Fall back to a hidden textarea +
// document.execCommand('copy') so right-click on a plain http page
// still works. Returns true on success.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through to legacy path */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    Object.assign(ta.style, {
      position: 'fixed',
      top: '0',
      left: '-9999px',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.body.appendChild(ta);
    const prevActive = document.activeElement;
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    if (prevActive && typeof prevActive.focus === 'function') {
      try { prevActive.focus(); } catch (_) {}
    }
    return !!ok;
  } catch (_) {
    return false;
  }
}

// --- Selector utilities ---
// Build a CSS selector that's actually findable on the page. Strategy:
//   1. If the element has an id, '#id' wins (and we stop).
//   2. Walk up the DOM, building each segment as tag(.class)* and only
//      adding :nth-of-type(N) when the parent has more than one same-tag
//      child (otherwise the segment is already unique among siblings).
//   3. Stop the moment we hit an ancestor with an id — that anchors the
//      whole selector and there's no point walking further up.
//   4. Skip <html> / <body>; they're implicit in any selector that
//      reaches them and only add noise.
function describeSegment(el) {
  let seg = el.tagName.toLowerCase();
  if (el.classList && el.classList.length) {
    // Up to two classes — enough for human readability without dragging
    // along a wall of utility classes (tw-, css module hashes, etc.).
    seg += '.' + Array.from(el.classList).slice(0, 2).join('.');
  }
  const parent = el.parentElement;
  if (parent) {
    const sameTag = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (sameTag.length > 1) {
      seg += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
    }
  }
  return seg;
}

export function getSelector(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el.id) return '#' + el.id;
  const path = [];
  let cur = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (cur.id) {
      path.unshift('#' + cur.id);
      break;
    }
    path.unshift(describeSegment(cur));
    cur = cur.parentElement;
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

// Elements dom-tools should leave alone. Two ways in:
//   - inspectorUI Set: every internal widget (toolbar, bubble,
//     toast…) is added programmatically.
//   - data-dt-ignore attribute: pages embedding dom-tools can opt
//     specific UI out (e.g. an install/Copy button on the demo page)
//     without coordinating with the inspector's runtime state.
// Either match anywhere up the ancestor chain wins.
export function isInspectorUI(el) {
  let node = el;
  while (node) {
    if (inspectorUI.has(node)) return true;
    if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-dt-ignore')) return true;
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
