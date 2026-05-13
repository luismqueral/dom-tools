const STORAGE_KEY = 'dom-tools-features';
const modules = [];
let featureState = {};

try { featureState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) {}

export function register(mod) {
  modules.push(mod);
}

export function getModules() {
  return modules;
}

export function isEnabled(id) {
  if (id in featureState) return featureState[id];
  const mod = modules.find(m => m.id === id);
  return mod ? mod.enabledByDefault !== false : true;
}

export function setEnabled(id, on) {
  featureState[id] = on;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(featureState));
  const mod = modules.find(m => m.id === id);
  if (!mod) return;
  if (on) {
    if (mod.enable) mod.enable();
  } else {
    if (mod.deactivate) mod.deactivate();
    if (mod.disable) mod.disable();
  }
}

export function activateModule(id) {
  modules.forEach(m => {
    if (!isEnabled(m.id)) return;
    if (m.id === id) { if (m.activate) m.activate(); }
    else { if (m.deactivate) m.deactivate(); }
  });
}

export function boot() {
  modules.forEach(m => {
    if (isEnabled(m.id) && m.init) m.init();
  });
}

// Register a module after boot (for plugins loaded late).
// Calls init() immediately and notifies toolbar to add button.
let _lateCallback = null;
export function onLateRegister(fn) { _lateCallback = fn; }

export function registerLate(mod, api) {
  modules.push(mod);
  if (isEnabled(mod.id) && mod.init) mod.init(api);
  if (_lateCallback) _lateCallback(mod);
}
