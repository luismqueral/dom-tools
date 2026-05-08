import { state } from './core/state.js';
import { getModules, isEnabled, activateModule } from './core/registry.js';
import { setActiveButton } from './toolbar.js';
import { copyAllChanges } from './features/copy-all.js';
import { isToolsEnabled, toggleToolsEnabled, clearAllChanges } from './core/lifecycle.js';

const HOME_MOD_ID = 'style-modifier';

function activateHome() {
  activateModule(HOME_MOD_ID);
  setActiveButton(HOME_MOD_ID);
}

// Skip global letter shortcuts (Shift+T etc.) while the user is typing
// into a real text field; they still want to type a literal "T". Esc
// bypasses this so they can always exit a tool / disable.
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function activateModuleById(id) {
  const mod = getModules().find(m => m.id === id);
  if (!mod) return;
  if (mod.toggle) {
    const stayed = mod.toggle();
    if (stayed) {
      getModules().forEach(m => {
        if (m.id !== id && m.deactivate) m.deactivate();
      });
      setActiveButton(id);
    } else {
      activateHome();
    }
  } else {
    activateModule(id);
    setActiveButton(id);
  }
}

let lastEsc = 0;

export function initKeyboard() {
  // Capture-phase so global keys (Escape especially) are seen BEFORE
  // any typing widget — note bubbles, sticky notes, the terminal —
  // calls e.stopPropagation() on its own keydown. Without this, Esc+Esc
  // typed inside a focused textarea would never reach the toggler.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
      e.preventDefault();
      state.altHeld = true;
      return;
    }

    // --- Escape family ---------------------------------------------------
    // Always-available regardless of typing target or enabled state.
    //   Shift+Esc   → clear every tracked change (notes, text, drawings)
    //   Esc        → first tap drops back to home; double-tap toggles
    //                DOM-Tools entirely on/off.
    if (e.key === 'Escape') {
      if (e.shiftKey) {
        e.preventDefault();
        clearAllChanges();
        lastEsc = 0;
        return;
      }

      e.preventDefault();
      const now = Date.now();
      if (now - lastEsc < 400) {
        toggleToolsEnabled();
        lastEsc = 0;
        return;
      }
      lastEsc = now;

      // Single tap: if a non-home tool is active, fall back to home.
      if (!isToolsEnabled()) return;
      if (state.annotateMode) {
        getModules().filter(m => m.id === 'draw').forEach(m => m.deactivate?.());
        state.annotateMode = false;
        activateHome();
      } else if (state.editMode || state.cameraMode) {
        activateHome();
      }
      return;
    }

    // Tool/action shortcuts below this line don't fire while typing or
    // while DOM-Tools is fully disabled.
    if (!isToolsEnabled()) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;

    // --- Top-level keyboard map -----------------------------------------
    //   Shift+T → Edit Text tool
    //   Shift+C → Copy all changes
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 't') {
        e.preventDefault();
        activateModuleById('edit-mode');
        return;
      }
      if (k === 'c') {
        e.preventDefault();
        copyAllChanges();
        return;
      }
    }

    // --- Per-module shortcuts (e.g. camera's Cmd+Shift+S) ---------------
    const modules = getModules();
    for (const mod of modules) {
      if (!isEnabled(mod.id) || !mod.shortcuts) continue;
      for (const sc of mod.shortcuts) {
        if (sc.when && !sc.when()) continue;
        const keyMatch = e.key.toLowerCase() === sc.key.toLowerCase();
        const metaMatch = sc.meta ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
        const shiftMatch = sc.shift ? e.shiftKey : !e.shiftKey;
        if (keyMatch && metaMatch && shiftMatch) {
          e.preventDefault();
          if (sc.action === 'toggle' && mod.toggle) {
            const stayed = mod.toggle();
            if (stayed) {
              modules.forEach(m => {
                if (m.id !== mod.id && m.deactivate) m.deactivate();
              });
              setActiveButton(mod.id);
            } else {
              activateHome();
            }
          } else if (sc.action && mod[sc.action]) {
            mod[sc.action]();
          }
          return;
        }
      }
    }
  }, true);

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') {
      state.altHeld = false;
      state.slotType = null;
    }
  });
}
