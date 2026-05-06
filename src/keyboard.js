import { state } from './core/state.js';
import { getModules, isEnabled, activateModule } from './core/registry.js';
import { setActiveButton } from './rail.js';

let lastEsc = 0;

export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Alt key for slot mode
    if (e.key === 'Alt') {
      e.preventDefault();
      state.altHeld = true;
      return;
    }

    // Check module shortcuts
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
              setActiveButton(mod.id);
            } else {
              const selectorMod = modules.find(m => m.id === 'selector');
              if (selectorMod && selectorMod.activate) selectorMod.activate();
              setActiveButton('selector');
            }
          } else if (sc.action && mod[sc.action]) {
            mod[sc.action]();
          }
          return;
        }
      }
    }


    // Escape handling
    if (e.key === 'Escape') {
      if (state.annotateMode) {
        e.preventDefault();
        const selectorMod = modules.find(m => m.id === 'selector');
        if (selectorMod) { selectorMod.activate(); setActiveButton('selector'); }
        modules.filter(m => m.id === 'draw' || m.id === 'annotations').forEach(m => m.deactivate?.());
        state.annotateMode = false;
        return;
      }
      if (state.editMode) {
        e.preventDefault();
        const editMod = modules.find(m => m.id === 'edit-mode');
        if (editMod && editMod.toggle) {
          editMod.toggle();
          const selectorMod = modules.find(m => m.id === 'selector');
          if (selectorMod) selectorMod.activate();
          setActiveButton('selector');
        }
        return;
      }
      if (state.cameraMode) {
        e.preventDefault();
        const cameraMod = modules.find(m => m.id === 'camera');
        if (cameraMod) cameraMod.deactivate();
        const selectorMod = modules.find(m => m.id === 'selector');
        if (selectorMod) selectorMod.activate();
        setActiveButton('selector');
        return;
      }
      // Double-tap escape toggles selector
      const now = Date.now();
      if (now - lastEsc < 400) {
        const selectorMod = modules.find(m => m.id === 'selector');
        if (selectorMod && selectorMod.toggle) {
          const stayed = selectorMod.toggle();
          setActiveButton(stayed ? 'selector' : '');
        }
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
