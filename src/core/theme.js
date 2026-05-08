/**
 * Selection color — single source of truth for the brand color that
 * drives selection borders, hover highlights, the persistent bubble
 * background, and the at-rest annotation scrim. Persisted to
 * localStorage so the user's choice survives reloads.
 *
 * Tools subscribe via onColorChange to repaint live UI when the color
 * is swapped from settings.
 */

const KEY = 'dom-tools-selection-color';
const DEFAULT = '#3b82f6'; // blue

export const COLOR_OPTIONS = [
  { id: 'blue',   value: '#3b82f6', label: 'Blue' },
  { id: 'pink',   value: '#ec4899', label: 'Pink' },
  { id: 'purple', value: '#a855f7', label: 'Purple' },
  { id: 'green',  value: '#10b981', label: 'Green' },
  { id: 'orange', value: '#f97316', label: 'Orange' },
];

let current = DEFAULT;
try {
  const stored = localStorage.getItem(KEY);
  if (stored && COLOR_OPTIONS.some(o => o.value === stored)) current = stored;
} catch (e) {}

const subscribers = new Set();

export function getSelectionColor() { return current; }

// Hex → rgba helper. Tolerant of leading "#" and 3- or 6-digit hex.
export function withAlpha(hex, alpha) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

// CSS custom properties on :root so any injected stylesheet can pull
// the live theme color without subscribing imperatively. Also keeps
// the alpha variants (soft / scrim / faint) in sync, so things like
// ::selection or the snap indicator can reference them directly.
function syncCssVars(hex) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--dt-color', hex);
  root.style.setProperty('--dt-color-soft',  withAlpha(hex, 0.4));
  root.style.setProperty('--dt-color-scrim', withAlpha(hex, 0.22));
  root.style.setProperty('--dt-color-faint', withAlpha(hex, 0.15));
  root.style.setProperty('--dt-color-mist',  withAlpha(hex, 0.10));
}
syncCssVars(current);

export function setSelectionColor(hex) {
  current = hex;
  try { localStorage.setItem(KEY, hex); } catch (e) {}
  syncCssVars(hex);
  subscribers.forEach(fn => { try { fn(hex); } catch (_) {} });
}

export function onColorChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
