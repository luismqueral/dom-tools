import { state, inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { showToast, isInspectorUI, getSelector, addTooltip } from '../core/helpers.js';
import { showRailPanel, hideRailPanel, setActiveButton } from '../rail.js';
import { activateModule } from '../core/registry.js';
import { loadTailwind } from '../core/tailwind.js';
// NOTE: circular import with annotations.js is intentional and safe — both
// only call each other from runtime event handlers, never at module eval.
import { setElementNote, getElementNote, queueRepositionAll, setElementText, evaluateAnnotation } from './annotations.js';

// --- Tailwind class database ---
const CLASSES = [
  'block','inline-block','inline','flex','inline-flex','grid','inline-grid','hidden','contents',
  'static','fixed','absolute','relative','sticky',
  'flex-row','flex-row-reverse','flex-col','flex-col-reverse',
  'flex-wrap','flex-nowrap','flex-1','flex-auto','flex-none','grow','grow-0','shrink','shrink-0',
  'justify-start','justify-end','justify-center','justify-between','justify-around','justify-evenly',
  'items-start','items-end','items-center','items-baseline','items-stretch',
  'grid-cols-1','grid-cols-2','grid-cols-3','grid-cols-4','grid-cols-6','grid-cols-12',
  'gap-0','gap-1','gap-2','gap-3','gap-4','gap-5','gap-6','gap-8','gap-10','gap-12',
  'p-0','p-1','p-2','p-3','p-4','p-5','p-6','p-8','p-10','p-12','p-16','p-20',
  'px-0','px-1','px-2','px-3','px-4','px-6','px-8','px-12',
  'py-0','py-1','py-2','py-3','py-4','py-6','py-8','py-12',
  'm-0','m-1','m-2','m-3','m-4','m-6','m-8','m-auto',
  'mx-0','mx-1','mx-2','mx-4','mx-6','mx-8','mx-auto',
  'my-0','my-1','my-2','my-4','my-6','my-8',
  'mt-0','mt-1','mt-2','mt-4','mt-6','mt-8','mt-12',
  'mb-0','mb-1','mb-2','mb-4','mb-6','mb-8','mb-12',
  'w-auto','w-full','w-screen','w-fit','w-1/2','w-1/3','w-2/3','w-1/4','w-3/4',
  'h-auto','h-full','h-screen','h-fit',
  'max-w-none','max-w-xs','max-w-sm','max-w-md','max-w-lg','max-w-xl','max-w-2xl','max-w-4xl','max-w-full','max-w-prose',
  'text-xs','text-sm','text-base','text-lg','text-xl','text-2xl','text-3xl','text-4xl','text-5xl',
  'font-thin','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black',
  'italic','not-italic','underline','no-underline','uppercase','lowercase','normal-case',
  'text-left','text-center','text-right','text-justify',
  'leading-none','leading-tight','leading-snug','leading-normal','leading-relaxed','leading-loose',
  'tracking-tighter','tracking-tight','tracking-normal','tracking-wide','tracking-wider','tracking-widest',
  'text-transparent','text-black','text-white','text-gray-500','text-gray-700','text-gray-900',
  'text-red-600','text-blue-600','text-green-600','text-nyt-fg','text-nyt-dim','text-nyt-accent',
  'bg-transparent','bg-black','bg-white','bg-gray-50','bg-gray-100','bg-gray-200','bg-gray-500','bg-gray-800','bg-gray-900',
  'bg-red-50','bg-blue-50','bg-green-50','bg-nyt-bg-alt',
  'border','border-0','border-2','border-4',
  'border-solid','border-dashed','border-none',
  'border-gray-200','border-gray-300','border-gray-500','border-nyt-border',
  'rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full',
  'shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl',
  'opacity-0','opacity-25','opacity-50','opacity-75','opacity-100',
  'overflow-hidden','overflow-auto','overflow-visible',
  'object-contain','object-cover','object-fill','object-none',
  'font-franklin','font-cheltenham','font-karnak',
  'transition','transition-all','transition-colors','transition-opacity',
  'duration-150','duration-200','duration-300','duration-500',
];

// --- Slider configurations per context ---
const TYPO_SLIDERS = [
  { label: 'Size', options: ['text-xs','text-sm','text-base','text-lg','text-xl','text-2xl','text-3xl','text-4xl','text-5xl'] },
  { label: 'Weight', options: ['font-thin','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black'] },
  { label: 'Leading', options: ['leading-none','leading-tight','leading-snug','leading-normal','leading-relaxed','leading-loose'] },
  { label: 'Tracking', options: ['tracking-tighter','tracking-tight','tracking-normal','tracking-wide','tracking-wider','tracking-widest'] },
];

const LAYOUT_SLIDERS = [
  { label: 'Padding', options: ['p-0','p-1','p-2','p-3','p-4','p-5','p-6','p-8','p-10','p-12','p-16','p-20'] },
  { label: 'Pad X', options: ['px-0','px-1','px-2','px-3','px-4','px-6','px-8','px-12'] },
  { label: 'Pad Y', options: ['py-0','py-1','py-2','py-3','py-4','py-6','py-8','py-12'] },
  { label: 'Gap', options: ['gap-0','gap-1','gap-2','gap-3','gap-4','gap-5','gap-6','gap-8','gap-10','gap-12'] },
  { label: 'Rounded', options: ['rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full'] },
  { label: 'Shadow', options: ['shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl'] },
];

const MEDIA_SLIDERS = [
  { label: 'Rounded', options: ['rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full'] },
  { label: 'Shadow', options: ['shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl'] },
  { label: 'Opacity', options: ['opacity-0','opacity-25','opacity-50','opacity-75','opacity-100'] },
];

const TEXT_COLORS = [
  { cls: 'text-black', color: '#000' },
  { cls: 'text-gray-900', color: '#111827' },
  { cls: 'text-gray-700', color: '#374151' },
  { cls: 'text-gray-500', color: '#6b7280' },
  { cls: 'text-white', color: '#fff' },
  { cls: 'text-red-600', color: '#dc2626' },
  { cls: 'text-blue-600', color: '#2563eb' },
  { cls: 'text-green-600', color: '#16a34a' },
  { cls: 'text-nyt-fg', color: '#121212' },
  { cls: 'text-nyt-dim', color: '#5a5a5a' },
  { cls: 'text-nyt-accent', color: '#326891' },
];

const BG_COLORS = [
  { cls: 'bg-transparent', color: 'transparent' },
  { cls: 'bg-white', color: '#fff' },
  { cls: 'bg-gray-50', color: '#f9fafb' },
  { cls: 'bg-gray-100', color: '#f3f4f6' },
  { cls: 'bg-gray-200', color: '#e5e7eb' },
  { cls: 'bg-gray-800', color: '#1f2937' },
  { cls: 'bg-gray-900', color: '#111827' },
  { cls: 'bg-black', color: '#000' },
  { cls: 'bg-blue-50', color: '#eff6ff' },
  { cls: 'bg-red-50', color: '#fef2f2' },
  { cls: 'bg-nyt-bg-alt', color: '#f5f5f2' },
];

const ALIGN_OPTIONS = ['text-left','text-center','text-right','text-justify'];
const DISPLAY_OPTIONS = ['block','flex','grid','inline','inline-flex','hidden'];
const JUSTIFY_OPTIONS = ['justify-start','justify-center','justify-end','justify-between','justify-around'];
const ITEMS_OPTIONS = ['items-start','items-center','items-end','items-stretch','items-baseline'];
const OBJECT_FIT_OPTIONS = ['object-contain','object-cover','object-fill','object-none'];

// --- State ---
let selected = []; // { el, originalClasses }[]
let activeMode = false;

// --- Export for copy-all and annotations ---
export function getSelected() { return selected; }
export { CLASSES };

// --- Element type detection ---
function getElType(el) {
  const tag = el.tagName;
  if (['IMG','VIDEO','SVG','PICTURE','CANVAS'].includes(tag)) return 'media';
  if (['P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI','BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL'].includes(tag)) return 'text';
  if (['BUTTON','INPUT','SELECT','TEXTAREA'].includes(tag)) return 'interactive';
  return 'container';
}

function getMixedType(elements) {
  const types = new Set(elements.map(s => getElType(s.el)));
  if (types.size === 1) return [...types][0];
  return 'mixed';
}

// --- Apply class to all selected ---
function applyToAll(addCls, groupOptions) {
  selected.forEach(({ el }) => {
    if (groupOptions) groupOptions.forEach(c => el.classList.remove(c));
    if (addCls) el.classList.add(addCls);
  });
  queueRepositionAll();
}

function removeFromAll(cls) {
  selected.forEach(({ el }) => el.classList.remove(cls));
  queueRepositionAll();
}

function resetAll() {
  selected.forEach(({ el, originalClasses }) => { el.className = originalClasses; });
  // Re-run setElementNote so any annotation that's now empty (no note, no
  // class diff after the reset) gets cleaned up automatically.
  selected.forEach(({ el, originalClasses }) => {
    setElementNote(el, getElementNote(el), originalClasses);
  });
  queueRepositionAll();
  renderPanel();
  showToast('Reset');
}

// --- Render all design controls vertically into a container.
//     Section visibility:
//       - single selection → conditional on element type (text vs container vs media)
//       - multi-selection → show Type + Layout + Style + Classes always, plus
//         Media if any media element is in the selection. Class changes apply
//         to every selection via applyToAll. ---
function renderAllSections(container, primaryEl) {
  const isMulti = selected.length > 1;
  const types = new Set(selected.map(s => getElType(s.el)));
  const type = types.size === 1 ? [...types][0] : 'mixed';

  const showText = isMulti || type === 'text' || type === 'mixed' || type === 'interactive';
  const showLayout = isMulti || type === 'container' || type === 'mixed' || type === 'interactive';
  const showMedia = isMulti ? types.has('media') : type === 'media';

  if (showText) renderTextControls(container, primaryEl);
  if (showLayout) renderLayoutControls(container, primaryEl);
  if (showMedia) renderMediaControls(container, primaryEl);

  renderSection(container, 'Background', (sec) => renderColorSwatches(sec, BG_COLORS, primaryEl));
  renderSection(container, 'Border & Effects', (sec) => {
    sec.appendChild(makeSlider('Rounded', ['rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full'], primaryEl));
    sec.appendChild(makeSlider('Shadow', ['shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl'], primaryEl));
    sec.appendChild(makeSlider('Opacity', ['opacity-0','opacity-25','opacity-50','opacity-75','opacity-100'], primaryEl));
  });

  renderClassEditor(container, primaryEl);
}

// --- Note section: surfaces annotations.setElementNote in design view so the
//     user can leave on-page feedback without leaving Design mode. Works for
//     single OR multi-selection — when multi, typing applies the same note to
//     every selected element (each gets its own bubble, anchored to itself).
//     If the selected elements have differing existing notes, the textarea
//     starts empty so a fresh edit doesn't clobber any one of them silently. ---
function renderNoteSection(container) {
  const sec = document.createElement('div');
  Object.assign(sec.style, { marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)' });

  const label = document.createElement('div');
  label.textContent = selected.length > 1 ? `NOTE (${selected.length} elements)` : 'NOTE';
  Object.assign(label.style, { fontSize: '9px', fontWeight: '700', color: '#666', marginBottom: '4px', letterSpacing: '0.5px' });
  sec.appendChild(label);

  const existing = selected.map(s => getElementNote(s.el));
  const allMatch = existing.every(n => n === existing[0]);

  const ta = document.createElement('textarea');
  ta.value = allMatch ? existing[0] : '';
  ta.placeholder = selected.length > 1
    ? `Leave feedback for ${selected.length} elements (visible on the page)…`
    : 'Leave feedback (visible on the page)…';
  Object.assign(ta.style, {
    width: '100%', minHeight: '48px', padding: '7px', borderRadius: '5px',
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
    color: '#fff', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
    resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: '1.4'
  });
  ta.addEventListener('input', () => {
    selected.forEach(s => setElementNote(s.el, ta.value, s.originalClasses));
  });
  ta.addEventListener('mousedown', (e) => e.stopPropagation());
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  sec.appendChild(ta);

  container.appendChild(sec);
}

// --- Render panel into rail content area ---
// `focusNote` is set to true on fresh element selection so the user can just
// start typing — most common interaction. Re-renders triggered by class
// tweaks, slider drags, etc. pass false so they don't steal focus mid-edit.
function renderPanel(focusNote = false) {
  if (!selected.length) { hideRailPanel(); return; }
  const primary = selected[0].el;

  const container = document.createElement('div');

  const header = document.createElement('div');
  Object.assign(header.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' });
  const title = document.createElement('span');
  title.textContent = selected.length > 1 ? `${selected.length} elements` : `<${primary.tagName.toLowerCase()}>`;
  Object.assign(title.style, { fontWeight: '600', fontSize: '11px', color: '#666' });
  const resetBtn = makeBtn('Reset', () => resetAll());
  header.appendChild(title);
  header.appendChild(resetBtn);
  container.appendChild(header);

  renderNoteSection(container);
  renderAllSections(container, primary);
  showRailPanel(container);

  if (focusNote) {
    const ta = container.querySelector('textarea');
    if (ta) {
      ta.focus();
      const end = ta.value.length;
      try { ta.setSelectionRange(end, end); } catch (_) {}
    }
  }
}

// --- Exported: render Tailwind controls into a given container (used by annotations) ---
export function renderDesignControls(container, elements, onChangeCallback) {
  const origSelected = selected;
  selected = elements;
  const primary = selected[0].el;

  renderAllSections(container, primary);

  selected = origSelected;
  if (onChangeCallback) onChangeCallback();
}

function renderSection(parent, label, renderFn) {
  const sec = document.createElement('div');
  Object.assign(sec.style, { marginBottom: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' });
  const heading = document.createElement('div');
  heading.textContent = label;
  Object.assign(heading.style, { fontSize: '10px', fontWeight: '600', color: '#666', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' });
  sec.appendChild(heading);
  parent.appendChild(sec);
  renderFn(sec);
}

// --- Text controls ---
function renderTextControls(parent, el) {
  renderSection(parent, 'Typography', (sec) => {
    const fontRow = makeRow();
    ['font-franklin','font-cheltenham','font-karnak'].forEach(cls => {
      const name = cls.replace('font-', '');
      const btn = makePillBtn(name, el.classList.contains(cls), () => {
        applyToAll(cls, ['font-franklin','font-cheltenham','font-karnak']);
        renderPanel();
      });
      fontRow.appendChild(btn);
    });
    sec.appendChild(fontRow);

    TYPO_SLIDERS.forEach(s => sec.appendChild(makeSlider(s.label, s.options, el)));

    const toggleRow = makeRow();
    toggleRow.appendChild(makeToggle('B', 'font-bold', ['font-thin','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black'], el));
    toggleRow.appendChild(makeToggle('I', 'italic', ['italic','not-italic'], el));
    toggleRow.appendChild(makeToggle('U', 'underline', ['underline','no-underline'], el));
    toggleRow.appendChild(makeToggle('TT', 'uppercase', ['uppercase','lowercase','capitalize','normal-case'], el));
    const spacer = document.createElement('div'); spacer.style.flex = '1'; toggleRow.appendChild(spacer);
    ALIGN_OPTIONS.forEach(cls => {
      const icon = cls === 'text-left' ? '\u2190' : cls === 'text-center' ? '\u2194' : cls === 'text-right' ? '\u2192' : '\u2261';
      toggleRow.appendChild(makeToggle(icon, cls, ALIGN_OPTIONS, el));
    });
    sec.appendChild(toggleRow);

    sec.appendChild(makeColorRow('Color', TEXT_COLORS, el));
  });
}

// --- Layout controls ---
function renderLayoutControls(parent, el) {
  renderSection(parent, 'Layout', (sec) => {
    const dispRow = makeRow();
    DISPLAY_OPTIONS.forEach(cls => {
      dispRow.appendChild(makePillBtn(cls, el.classList.contains(cls), () => {
        applyToAll(cls, DISPLAY_OPTIONS);
        renderPanel();
      }));
    });
    sec.appendChild(dispRow);

    const cs = getComputedStyle(el);
    if (cs.display === 'flex' || cs.display === 'grid' || el.classList.contains('flex') || el.classList.contains('grid')) {
      const flexRow = makeRow();
      flexRow.appendChild(makeLabel('Justify'));
      JUSTIFY_OPTIONS.forEach(cls => {
        const short = cls.replace('justify-', '')[0].toUpperCase();
        flexRow.appendChild(makeToggle(short, cls, JUSTIFY_OPTIONS, el));
      });
      sec.appendChild(flexRow);

      const itemsRow = makeRow();
      itemsRow.appendChild(makeLabel('Items'));
      ITEMS_OPTIONS.forEach(cls => {
        const short = cls.replace('items-', '')[0].toUpperCase();
        itemsRow.appendChild(makeToggle(short, cls, ITEMS_OPTIONS, el));
      });
      sec.appendChild(itemsRow);
    }

    LAYOUT_SLIDERS.forEach(s => sec.appendChild(makeSlider(s.label, s.options, el)));
  });
}

// --- Media controls ---
function renderMediaControls(parent, el) {
  renderSection(parent, 'Media', (sec) => {
    const fitRow = makeRow();
    fitRow.appendChild(makeLabel('Fit'));
    OBJECT_FIT_OPTIONS.forEach(cls => {
      fitRow.appendChild(makePillBtn(cls.replace('object-', ''), el.classList.contains(cls), () => {
        applyToAll(cls, OBJECT_FIT_OPTIONS);
        renderPanel();
      }));
    });
    sec.appendChild(fitRow);

    MEDIA_SLIDERS.forEach(s => sec.appendChild(makeSlider(s.label, s.options, el)));
  });
}

// --- Class editor ---
function renderClassEditor(parent, el) {
  renderSection(parent, 'Classes', (sec) => {
    const chips = document.createElement('div');
    Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '8px', maxHeight: '80px', overflowY: 'auto' });
    const classes = el.className.trim().split(/\s+/).filter(Boolean);
    classes.forEach(cls => {
      const chip = document.createElement('span');
      Object.assign(chip.style, {
        display: 'inline-flex', alignItems: 'center', gap: '2px',
        background: 'rgba(255,255,255,0.08)', borderRadius: '3px', padding: '2px 5px',
        fontSize: '10px', fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace', color: '#ccc'
      });
      chip.textContent = cls;
      const x = document.createElement('span');
      x.textContent = '\u00d7';
      Object.assign(x.style, { cursor: 'pointer', color: '#888', marginLeft: '2px', fontSize: '12px' });
      x.addEventListener('click', () => { removeFromAll(cls); renderPanel(); });
      x.addEventListener('mouseenter', () => { x.style.color = '#fff'; });
      x.addEventListener('mouseleave', () => { x.style.color = '#888'; });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
    sec.appendChild(chips);

    const inputWrap = document.createElement('div');
    Object.assign(inputWrap.style, { position: 'relative' });
    const input = document.createElement('input');
    input.placeholder = '+ Add class...';
    Object.assign(input.style, {
      width: '100%', padding: '5px 7px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.12)',
      background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '11px', outline: 'none',
      fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace', boxSizing: 'border-box'
    });
    const dropdown = document.createElement('div');
    Object.assign(dropdown.style, {
      position: 'absolute', left: '0', right: '0', top: '100%', marginTop: '3px',
      background: 'rgba(35,35,35,0.98)', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.1)',
      maxHeight: '120px', overflowY: 'auto', display: 'none', zIndex: '1'
    });
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { dropdown.style.display = 'none'; return; }
      const matches = CLASSES.filter(c => c.startsWith(q)).concat(CLASSES.filter(c => !c.startsWith(q) && c.includes(q))).slice(0, 8);
      dropdown.innerHTML = '';
      matches.forEach(cls => {
        const item = document.createElement('div');
        item.textContent = cls;
        Object.assign(item.style, { padding: '4px 8px', cursor: 'pointer', fontSize: '10px', color: '#ccc', fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace' });
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.06)'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('mousedown', (e) => { e.preventDefault(); applyToAll(cls, null); input.value = ''; dropdown.style.display = 'none'; renderPanel(); });
        dropdown.appendChild(item);
      });
      dropdown.style.display = matches.length ? 'block' : 'none';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); applyToAll(input.value.trim(), null); input.value = ''; dropdown.style.display = 'none'; renderPanel(); }
      if (e.key === 'Escape') { dropdown.style.display = 'none'; input.value = ''; }
    });
    inputWrap.appendChild(input);
    inputWrap.appendChild(dropdown);
    sec.appendChild(inputWrap);
  });
}

// --- UI helpers ---
function makeRow() {
  const r = document.createElement('div');
  Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '5px', flexWrap: 'wrap' });
  return r;
}

function makeLabel(text) {
  const l = document.createElement('span');
  l.textContent = text;
  Object.assign(l.style, { fontSize: '10px', color: '#888', width: '40px', flexShrink: '0' });
  return l;
}

function makeBtn(text, onClick, primary) {
  const btn = document.createElement('button');
  btn.textContent = text;
  Object.assign(btn.style, {
    background: primary ? '#ec4899' : 'rgba(255,255,255,0.08)', border: 'none',
    color: primary ? '#fff' : '#ccc', padding: '3px 10px', borderRadius: '4px',
    fontSize: '10px', fontWeight: '600', cursor: 'pointer'
  });
  btn.addEventListener('click', onClick);
  return btn;
}

function makePillBtn(text, isActive, onClick) {
  const btn = document.createElement('div');
  btn.textContent = text;
  Object.assign(btn.style, {
    padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
    fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace',
    background: isActive ? 'rgba(236,72,153,0.25)' : 'rgba(255,255,255,0.06)',
    color: isActive ? '#ec4899' : '#aaa', fontWeight: isActive ? '600' : '400'
  });
  btn.addEventListener('mouseenter', () => { if (!isActive) btn.style.background = 'rgba(255,255,255,0.1)'; });
  btn.addEventListener('mouseleave', () => { if (!isActive) btn.style.background = 'rgba(255,255,255,0.06)'; });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

function makeToggle(label, activeClass, group, el) {
  const isActive = el.classList.contains(activeClass);
  const btn = document.createElement('div');
  btn.textContent = label;
  Object.assign(btn.style, {
    width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '3px', cursor: 'pointer', fontSize: label.length > 1 ? '8px' : '11px',
    fontWeight: '700', color: isActive ? '#ec4899' : '#999',
    background: isActive ? 'rgba(236,72,153,0.2)' : 'rgba(255,255,255,0.04)',
    fontStyle: label === 'I' ? 'italic' : 'normal',
    textDecoration: label === 'U' ? 'underline' : 'none'
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const has = selected[0].el.classList.contains(activeClass);
    if (has) { applyToAll(null, [activeClass]); }
    else { applyToAll(activeClass, group); }
    renderPanel();
  });
  return btn;
}

function makeSlider(label, options, el) {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' });

  const lbl = document.createElement('span');
  lbl.textContent = label;
  Object.assign(lbl.style, { fontSize: '10px', color: '#888', width: '48px', flexShrink: '0' });

  let currentIdx = 0;
  for (let i = 0; i < options.length; i++) {
    if (el.classList.contains(options[i])) { currentIdx = i; break; }
  }

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(options.length - 1);
  slider.value = String(currentIdx);
  Object.assign(slider.style, { flex: '1', height: '4px', accentColor: '#ec4899', cursor: 'pointer' });

  const val = document.createElement('span');
  val.textContent = options[currentIdx];
  Object.assign(val.style, {
    fontSize: '9px', color: '#aaa', width: '56px', textAlign: 'right', flexShrink: '0',
    fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  });

  slider.addEventListener('input', () => {
    const cls = options[parseInt(slider.value)];
    val.textContent = cls;
    applyToAll(cls, options);
  });

  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(val);
  return row;
}

const ALL_COLOR_CLASSES = CLASSES.filter(c => c.startsWith('text-') || c.startsWith('bg-') || c.startsWith('border-'));

function makeColorRow(label, colors, el) {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { marginTop: '6px' });

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' });
  const lbl = document.createElement('span');
  lbl.textContent = label;
  Object.assign(lbl.style, { fontSize: '10px', color: '#888', width: '48px', flexShrink: '0' });
  row.appendChild(lbl);

  const allCls = colors.map(c => c.cls);
  colors.forEach(({ cls, color }) => {
    const isActive = el.classList.contains(cls);
    const swatch = document.createElement('div');
    Object.assign(swatch.style, {
      width: '14px', height: '14px', borderRadius: '50%', cursor: 'pointer',
      background: color === 'transparent' ? 'repeating-conic-gradient(#666 0% 25%, #444 0% 50%) 50%/8px 8px' : color,
      border: isActive ? '2px solid #ec4899' : '2px solid rgba(255,255,255,0.1)',
      boxSizing: 'border-box'
    });
    swatch.title = cls;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      applyToAll(cls, allCls);
      renderPanel();
    });
    row.appendChild(swatch);
  });
  wrap.appendChild(row);

  const inputWrap = document.createElement('div');
  Object.assign(inputWrap.style, { position: 'relative', marginTop: '5px', marginLeft: '48px' });
  const input = document.createElement('input');
  input.placeholder = label === 'Fill' ? 'bg-...' : 'text-...';
  Object.assign(input.style, {
    width: '100%', padding: '4px 6px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '10px', outline: 'none',
    fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace', boxSizing: 'border-box'
  });
  const dropdown = document.createElement('div');
  Object.assign(dropdown.style, {
    position: 'absolute', left: '0', right: '0', top: '100%', marginTop: '2px',
    background: 'rgba(35,35,35,0.98)', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.1)',
    maxHeight: '100px', overflowY: 'auto', display: 'none', zIndex: '1'
  });

  const prefix = label === 'Fill' ? 'bg-' : label === 'Color' ? 'text-' : 'border-';
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { dropdown.style.display = 'none'; return; }
    const matches = ALL_COLOR_CLASSES.filter(c => c.startsWith(prefix) && c.includes(q)).slice(0, 8);
    dropdown.innerHTML = '';
    matches.forEach(cls => {
      const item = document.createElement('div');
      item.textContent = cls;
      Object.assign(item.style, { padding: '3px 7px', cursor: 'pointer', fontSize: '10px', color: '#ccc', fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace' });
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.06)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applyToAll(cls, allCls);
        input.value = '';
        dropdown.style.display = 'none';
        renderPanel();
      });
      dropdown.appendChild(item);
    });
    dropdown.style.display = matches.length ? 'block' : 'none';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      e.preventDefault();
      applyToAll(input.value.trim(), allCls);
      input.value = '';
      dropdown.style.display = 'none';
      renderPanel();
    }
    if (e.key === 'Escape') { dropdown.style.display = 'none'; input.value = ''; }
  });
  inputWrap.appendChild(input);
  inputWrap.appendChild(dropdown);
  wrap.appendChild(inputWrap);

  return wrap;
}

function renderColorSwatches(parent, colors, el) {
  parent.appendChild(makeColorRow('Fill', colors, el));
}

// --- Selection + highlight ---
const TEXT_TAGS = ['P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI','BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL'];

function teardownEntry(s) {
  s.el.style.outline = s.origOutline;
  if (s.madeEditable) { s.el.contentEditable = 'false'; s.el.style.cursor = ''; }
  if (s.onTextInput) { s.el.removeEventListener('input', s.onTextInput); s.onTextInput = null; }
}

function selectElement(el, additive) {
  if (!additive) {
    selected.forEach(teardownEntry);
    selected = [];
  }
  const idx = selected.findIndex(s => s.el === el);
  let added = false;
  if (idx !== -1) {
    teardownEntry(selected[idx]);
    selected.splice(idx, 1);
  } else {
    const isText = TEXT_TAGS.includes(el.tagName);
    const entry = { el, originalClasses: el.className, origOutline: el.style.outline, madeEditable: false };
    if (isText) {
      el.contentEditable = 'true';
      el.style.cursor = 'text';
      entry.madeEditable = true;
      entry.originalText = el.innerText;
      // Lazy registration: only register with the annotation system once
      // the user actually types. Keeps the store clean for plain selections.
      entry.onTextInput = () => {
        setElementText(el, entry.originalText, entry.originalClasses);
        evaluateAnnotation(el);
        queueRepositionAll();
      };
      el.addEventListener('input', entry.onTextInput);
    }
    selected.push(entry);
    el.style.outline = '2px solid #ec4899';
    added = true;
  }
  renderPanel(added);
}

function clearSelection() {
  selected.forEach(teardownEntry);
  selected = [];
  hideRailPanel();
}

// --- Public: activate Design mode (if needed) and single-select an element.
//     Used by annotation bubbles so clicking one drops you into Design mode
//     editing that element — same panel as everywhere else. ---
export function focusElement(el) {
  if (!activeMode) {
    activateModule('style-modifier');
    setActiveButton('style-modifier');
  }
  selectElement(el, false);
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// --- Hover highlight ---
let hoveredEl = null;

function onMove(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el) || el === document.body || el === document.documentElement) {
    clearHoverHighlight();
    return;
  }
  if (el === hoveredEl) return;
  clearHoverHighlight();
  if (selected.find(s => s.el === el)) return;
  hoveredEl = el;
  hoveredEl._smHoverOutline = hoveredEl.style.outline;
  hoveredEl._smHoverBg = hoveredEl.style.backgroundColor;
  hoveredEl.style.outline = '2px solid rgba(236,72,153,0.5)';
  hoveredEl.style.backgroundColor = 'rgba(236,72,153,0.04)';
}

function clearHoverHighlight() {
  if (hoveredEl) {
    hoveredEl.style.outline = hoveredEl._smHoverOutline || '';
    hoveredEl.style.backgroundColor = hoveredEl._smHoverBg || '';
    delete hoveredEl._smHoverOutline;
    delete hoveredEl._smHoverBg;
    hoveredEl = null;
  }
}

// --- Click handler ---
function onClick(e) {
  if (!activeMode) return;
  const el = e.target;
  if (isInspectorUI(el)) return;
  if (el.closest && el.closest('.copy-box')) return;

  const alreadySelected = selected.find(s => s.el === el || s.el.contains(el));
  if (alreadySelected && alreadySelected.madeEditable) {
    e.stopPropagation();
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  clearHoverHighlight();
  selectElement(el, e.shiftKey);
}

export default {
  id: 'style-modifier',
  label: 'Design',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>',
    tooltip: 'Design',
    color: '#ec4899',
    order: 5,
  },

  shortcuts: [],

  init() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove, true);
  },

  activate() {
    loadTailwind();
    activeMode = true;
    state.styleModActive = true;
    showToast('Design — click to style, shift+click multi-select');
  },

  deactivate() {
    activeMode = false;
    state.styleModActive = false;
    clearHoverHighlight();
    clearSelection();
  },

  // Design is the home mode — clicking its button or hitting its shortcut
  // always activates (no-op if already on). Other tools toggle off back to
  // Design via the rail's fallback path.
  toggle() {
    this.activate();
    return true;
  },

  enable() {},
  disable() { this.deactivate(); },
};
