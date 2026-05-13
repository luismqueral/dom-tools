/**
 * Global enable/disable + clear-all for DOM-Tools.
 *
 * Disabled hides the toolbar and any persistent bubbles via a single
 * class on <html> — annotation data is preserved, just visually gone,
 * so re-enabling brings everything back. Tools are deactivated to
 * stop intercepting page interaction.
 *
 * Toggled by double-tapping Escape; clear-all is bound to Shift+Esc.
 */

import { state, inspectorUI } from './state.js';
import { Z } from './constants.js';
import { getModules, activateModule } from './registry.js';
import { setActiveButton } from '../toolbar.js';
import { showToast } from './helpers.js';
import { clearAnnotations, closeEditor } from '../features/annotations.js';
import { isExperimentEnabled } from '../settings.js';

const HOME_ID = 'style-modifier';

function ensureDisabledStyles() {
  if (document.getElementById('dt-disabled-styles')) return;
  const style = document.createElement('style');
  style.id = 'dt-disabled-styles';
  style.textContent = `
    html.dt-disabled [data-dt-bubble],
    html.dt-disabled [data-dt-toolbar] { display: none !important; }
  `;
  document.head.appendChild(style);
}

export function isToolsEnabled() { return state.enabled !== false; }

export function setToolsEnabled(on) {
  ensureDisabledStyles();
  state.enabled = !!on;
  if (state.enabled) {
    document.documentElement.classList.remove('dt-disabled');
    activateModule(HOME_ID);
    setActiveButton(HOME_ID);
    showToast('DOM-Tools on');
  } else {
    closeEditor();
    getModules().forEach(m => { if (m.deactivate) m.deactivate(); });
    document.documentElement.classList.add('dt-disabled');
    showToast('DOM-Tools off');
  }
}

export function toggleToolsEnabled() {
  setToolsEnabled(!isToolsEnabled());
}

export function clearAllChanges() {
  if (isExperimentEnabled('kidpix-clear')) {
    kidPixClear(() => {
      doClear();
    });
  } else {
    doClear();
  }
}

function doClear() {
  clearAnnotations();
  const drawMod = getModules().find(m => m.id === 'draw');
  if (drawMod && drawMod.clear) drawMod.clear();
  showToast('Cleared all changes');
}

// --- Kid Pix clear animation ---
// Picks a random wipe style: dynamite, firecracker, or dissolve.
function kidPixClear(onDone) {
  const effects = [dynamiteWipe, firecrackerWipe, dissolveWipe];
  const effect = effects[Math.floor(Math.random() * effects.length)];
  effect(onDone);
}

function dynamiteWipe(onDone) {
  // Flash white → shake → clear
  const overlay = makeOverlay();
  overlay.style.background = '#fff';
  overlay.style.opacity = '0';

  // Boom sound (short beep via oscillator)
  playBoom();

  // Shake the page
  document.documentElement.animate([
    { transform: 'translate(0,0)' },
    { transform: 'translate(-8px, 4px)' },
    { transform: 'translate(6px, -3px)' },
    { transform: 'translate(-4px, 6px)' },
    { transform: 'translate(5px, -2px)' },
    { transform: 'translate(-3px, 3px)' },
    { transform: 'translate(0,0)' },
  ], { duration: 400, easing: 'ease-out' });

  // Flash
  overlay.animate([
    { opacity: 0 },
    { opacity: 0.9, offset: 0.1 },
    { opacity: 0.9, offset: 0.3 },
    { opacity: 0 },
  ], { duration: 500 }).onfinish = () => {
    overlay.remove();
    inspectorUI.delete(overlay);
    onDone();
  };
}

function firecrackerWipe(onDone) {
  // Sparks flying from random points
  const overlay = makeOverlay();
  overlay.style.background = 'transparent';
  overlay.style.overflow = 'hidden';

  playBoom();

  const count = 40;
  for (let i = 0; i < count; i++) {
    const spark = document.createElement('div');
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const hue = Math.random() * 360;
    const size = 4 + Math.random() * 8;
    Object.assign(spark.style, {
      position: 'absolute',
      left: x + '%', top: y + '%',
      width: size + 'px', height: size + 'px',
      borderRadius: '50%',
      background: `hsl(${hue}, 100%, 60%)`,
      boxShadow: `0 0 6px hsl(${hue}, 100%, 70%)`,
    });
    overlay.appendChild(spark);

    const dx = (Math.random() - 0.5) * 200;
    const dy = (Math.random() - 0.5) * 200;
    spark.animate([
      { transform: 'scale(1) translate(0,0)', opacity: 1 },
      { transform: `scale(0) translate(${dx}px, ${dy}px)`, opacity: 0 },
    ], { duration: 600 + Math.random() * 400, easing: 'ease-out' });
  }

  setTimeout(() => {
    overlay.remove();
    inspectorUI.delete(overlay);
    onDone();
  }, 700);
}

function dissolveWipe(onDone) {
  // Tiles that flip away
  const overlay = makeOverlay();
  overlay.style.background = 'transparent';

  playBoom();

  const cols = 12, rows = 8;
  const w = 100 / cols, h = 100 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = document.createElement('div');
      Object.assign(tile.style, {
        position: 'absolute',
        left: (c * w) + '%', top: (r * h) + '%',
        width: w + '%', height: h + '%',
        background: '#111',
        opacity: '0',
      });
      overlay.appendChild(tile);
      const delay = (r + c) * 30 + Math.random() * 60;
      tile.animate([
        { opacity: 0, transform: 'scale(0.8) rotateX(0deg)' },
        { opacity: 1, transform: 'scale(1) rotateX(0deg)', offset: 0.3 },
        { opacity: 1, transform: 'scale(1) rotateX(0deg)', offset: 0.7 },
        { opacity: 0, transform: 'scale(0.5) rotateX(90deg)' },
      ], { duration: 600, delay, easing: 'ease-in-out' });
    }
  }

  setTimeout(() => {
    overlay.remove();
    inspectorUI.delete(overlay);
    onDone();
  }, 900);
}

function makeOverlay() {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', inset: '0',
    zIndex: String(Z.flash + 1),
    pointerEvents: 'none',
  });
  document.body.appendChild(el);
  inspectorUI.add(el);
  return el;
}

function playBoom() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // White noise burst
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close(), 300);
  } catch (_) {}
}
