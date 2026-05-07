import { state } from './core/state.js';
import { getModules, isEnabled } from './core/registry.js';
import { setActiveButton } from './toolbar.js';

const HOME_MOD_ID = 'style-modifier';

function activateHome(modules) {
  const home = modules.find(m => m.id === HOME_MOD_ID);
  if (home && home.activate) home.activate();
  setActiveButton(HOME_MOD_ID);
}

let lastEsc = 0;

export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
      e.preventDefault();
      state.altHeld = true;
      return;
    }

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
            if (stayed) setActiveButton(mod.id);
            else activateHome(modules);
          } else if (sc.action && mod[sc.action]) {
            mod[sc.action]();
          }
          return;
        }
      }
    }

    if (e.key === 'Escape') {
      if (state.annotateMode) {
        e.preventDefault();
        modules.filter(m => m.id === 'draw').forEach(m => m.deactivate?.());
        state.annotateMode = false;
        activateHome(modules);
        return;
      }
      if (state.editMode) {
        e.preventDefault();
        const editMod = modules.find(m => m.id === 'edit-mode');
        if (editMod && editMod.toggle) editMod.toggle();
        activateHome(modules);
        return;
      }
      if (state.cameraMode) {
        e.preventDefault();
        const cameraMod = modules.find(m => m.id === 'camera');
        if (cameraMod) cameraMod.deactivate();
        activateHome(modules);
        return;
      }
      // Double-tap Escape: re-focus the home tool (Design). Always activates;
      // there's no "off" state for the home mode.
      const now = Date.now();
      if (now - lastEsc < 400) {
        activateHome(modules);
        lastEsc = 0;
      } else {
        lastEsc = now;
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') {
      state.altHeld = false;
      state.slotType = null;
    }
  });
}
