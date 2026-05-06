import { state, inspectorUI } from '../core/state.js';
import { COLORS, Z } from '../core/constants.js';
import { showToast } from '../core/helpers.js';
import { isExperimentEnabled } from '../settings.js';

const editHighlightStyle = document.createElement('style');
editHighlightStyle.textContent = `
  .inspector-edit-active p,
  .inspector-edit-active h1, .inspector-edit-active h2,
  .inspector-edit-active h3, .inspector-edit-active h4,
  .inspector-edit-active h5, .inspector-edit-active h6,
  .inspector-edit-active span, .inspector-edit-active a,
  .inspector-edit-active li, .inspector-edit-active td,
  .inspector-edit-active th, .inspector-edit-active label,
  .inspector-edit-active blockquote, .inspector-edit-active figcaption,
  .inspector-edit-active dt, .inspector-edit-active dd {
    background-color: rgba(230, 126, 0, 0.08) !important;
    outline: 1px dashed rgba(230, 126, 0, 0.25) !important;
    border-radius: 2px;
  }
  .inspector-edit-active p:hover,
  .inspector-edit-active h1:hover, .inspector-edit-active h2:hover,
  .inspector-edit-active h3:hover, .inspector-edit-active h4:hover,
  .inspector-edit-active h5:hover, .inspector-edit-active h6:hover,
  .inspector-edit-active span:hover, .inspector-edit-active a:hover,
  .inspector-edit-active li:hover, .inspector-edit-active td:hover,
  .inspector-edit-active th:hover, .inspector-edit-active label:hover,
  .inspector-edit-active blockquote:hover, .inspector-edit-active figcaption:hover,
  .inspector-edit-active dt:hover, .inspector-edit-active dd:hover {
    background-color: rgba(230, 126, 0, 0.15) !important;
    outline: 1px dashed rgba(230, 126, 0, 0.5) !important;
  }
`;

// --- Typography floating toolbar ---
let typoBar = null;
let typoTarget = null;

const FONT_SIZES = ['text-xs','text-sm','text-base','text-lg','text-xl','text-2xl','text-3xl','text-4xl','text-5xl'];
const FONT_WEIGHTS = ['font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black'];
const TEXT_ALIGNS = ['text-left','text-center','text-right','text-justify'];
const LINE_HEIGHTS = ['leading-none','leading-tight','leading-snug','leading-normal','leading-relaxed','leading-loose'];
const LETTER_SPACINGS = ['tracking-tighter','tracking-tight','tracking-normal','tracking-wide','tracking-wider','tracking-widest'];
const TEXT_COLORS_MAP = [
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
  { cls: 'text-nyt-red', color: '#c13b2a' },
];
const FONT_FAMILIES = ['font-franklin','font-cheltenham','font-karnak'];

function createTypoBar() {
  typoBar = document.createElement('div');
  Object.assign(typoBar.style, {
    position: 'fixed', zIndex: String(Z.toolbar + 3),
    background: 'rgba(24,24,24,0.96)', borderRadius: '10px', padding: '10px 12px',
    backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif',
    fontSize: '11px', color: '#eee', display: 'none',
    flexDirection: 'column', gap: '8px', width: '280px'
  });

  // Row 1: Font family + toggles
  const row1 = makeRow();
  row1.appendChild(makeDropdownBtn('F', FONT_FAMILIES, 'Font', true));
  row1.appendChild(makeToggleBtn('B', FONT_WEIGHTS.slice(3), 'font-bold', 'Bold'));
  row1.appendChild(makeToggleBtn('I', ['italic','not-italic'], 'italic', 'Italic'));
  row1.appendChild(makeToggleBtn('TT', ['uppercase','lowercase','capitalize','normal-case'], 'uppercase', 'Caps'));
  row1.appendChild(makeAlignBtns());
  typoBar.appendChild(row1);

  // Row 2: Font size slider
  typoBar.appendChild(makeSliderRow('Size', FONT_SIZES));

  // Row 3: Weight slider
  typoBar.appendChild(makeSliderRow('Weight', FONT_WEIGHTS));

  // Row 4: Line height slider
  typoBar.appendChild(makeSliderRow('Leading', LINE_HEIGHTS));

  // Row 5: Letter spacing slider
  typoBar.appendChild(makeSliderRow('Tracking', LETTER_SPACINGS));

  // Row 6: Color swatches
  typoBar.appendChild(makeColorRow());

  typoBar.addEventListener('mousedown', (e) => {
    // Allow range inputs to work natively, prevent everything else from collapsing selection
    if (e.target.type !== 'range') e.preventDefault();
    e.stopPropagation();
    _typoLocked = true;
  });
  typoBar.addEventListener('mouseup', () => { setTimeout(() => { _typoLocked = false; }, 100); });
  typoBar.addEventListener('click', (e) => e.stopPropagation());

  document.body.appendChild(typoBar);
  inspectorUI.add(typoBar);
}

function makeRow() {
  const r = document.createElement('div');
  Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '3px' });
  return r;
}

function makeSliderRow(label, options) {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });

  const lbl = document.createElement('span');
  lbl.textContent = label;
  Object.assign(lbl.style, { fontSize: '10px', color: '#888', width: '48px', flexShrink: '0' });

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(options.length - 1);
  slider.value = '0';
  Object.assign(slider.style, {
    flex: '1', height: '4px', accentColor: '#ec4899', cursor: 'pointer'
  });

  const val = document.createElement('span');
  Object.assign(val.style, {
    fontSize: '9px', color: '#aaa', width: '60px', textAlign: 'right', flexShrink: '0',
    fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  });
  val.textContent = options[0];

  // Set initial position based on current target
  slider._options = options;
  slider._label = val;

  slider.addEventListener('input', () => {
    const cls = options[parseInt(slider.value)];
    val.textContent = cls;
    if (!typoTarget) return;
    options.forEach(c => typoTarget.classList.remove(c));
    typoTarget.classList.add(cls);
  });

  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(val);
  row._slider = slider;
  row._options = options;
  return row;
}

function makeToggleBtn(label, groupClasses, activeClass, tooltip) {
  const btn = document.createElement('div');
  btn.textContent = label;
  btn.title = tooltip;
  Object.assign(btn.style, {
    width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '4px', cursor: 'pointer', fontSize: label.length > 1 ? '9px' : '12px',
    fontWeight: '700', color: '#ccc', fontStyle: label === 'I' ? 'italic' : 'normal',
    background: 'rgba(255,255,255,0.06)'
  });
  btn.addEventListener('mouseenter', () => { if (btn.style.background !== 'rgba(236,72,153,0.25)') btn.style.background = 'rgba(255,255,255,0.1)'; });
  btn.addEventListener('mouseleave', () => {
    const active = typoTarget && typoTarget.classList.contains(activeClass);
    btn.style.background = active ? 'rgba(236,72,153,0.25)' : 'rgba(255,255,255,0.06)';
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!typoTarget) return;
    const has = typoTarget.classList.contains(activeClass);
    groupClasses.forEach(c => typoTarget.classList.remove(c));
    if (!has) { typoTarget.classList.add(activeClass); btn.style.background = 'rgba(236,72,153,0.25)'; }
    else { btn.style.background = 'rgba(255,255,255,0.06)'; }
  });
  btn._activeClass = activeClass;
  return btn;
}

function makeAlignBtns() {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'flex', gap: '1px', marginLeft: 'auto' });
  const aligns = [
    { cls: 'text-left', icon: '\u2190' },
    { cls: 'text-center', icon: '\u2194' },
    { cls: 'text-right', icon: '\u2192' },
  ];
  aligns.forEach(({ cls, icon }) => {
    const btn = document.createElement('div');
    btn.textContent = icon;
    Object.assign(btn.style, {
      width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '3px', cursor: 'pointer', fontSize: '11px', color: '#aaa',
      background: 'rgba(255,255,255,0.04)'
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.1)'; });
    btn.addEventListener('mouseleave', () => {
      const active = typoTarget && typoTarget.classList.contains(cls);
      btn.style.background = active ? 'rgba(236,72,153,0.2)' : 'rgba(255,255,255,0.04)';
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!typoTarget) return;
      TEXT_ALIGNS.forEach(c => typoTarget.classList.remove(c));
      typoTarget.classList.add(cls);
      wrap.querySelectorAll('div').forEach(b => { b.style.background = 'rgba(255,255,255,0.04)'; });
      btn.style.background = 'rgba(236,72,153,0.2)';
    });
    btn._cls = cls;
    wrap.appendChild(btn);
  });
  return wrap;
}

function makeColorRow() {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' });
  const lbl = document.createElement('span');
  lbl.textContent = 'Color';
  Object.assign(lbl.style, { fontSize: '10px', color: '#888', width: '48px', flexShrink: '0' });
  row.appendChild(lbl);

  TEXT_COLORS_MAP.forEach(({ cls, color }) => {
    const swatch = document.createElement('div');
    Object.assign(swatch.style, {
      width: '16px', height: '16px', borderRadius: '50%', cursor: 'pointer',
      background: color, border: '2px solid rgba(255,255,255,0.08)',
      transition: 'transform 0.1s'
    });
    swatch.title = cls;
    swatch.addEventListener('mouseenter', () => { swatch.style.transform = 'scale(1.3)'; });
    swatch.addEventListener('mouseleave', () => { swatch.style.transform = ''; });
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!typoTarget) return;
      TEXT_COLORS_MAP.forEach(c => typoTarget.classList.remove(c.cls));
      typoTarget.classList.add(cls);
      // Update borders
      row.querySelectorAll('div').forEach(s => { if (s.style.borderRadius === '50%') s.style.border = '2px solid rgba(255,255,255,0.08)'; });
      swatch.style.border = '2px solid #ec4899';
    });
    swatch._cls = cls;
    row.appendChild(swatch);
  });
  return row;
}

function makeDropdownBtn(label, options, tooltip, wide) {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'relative', display: 'inline-block' });

  const btn = document.createElement('div');
  btn.textContent = label;
  btn.title = tooltip;
  Object.assign(btn.style, {
    height: '24px', padding: wide ? '0 8px' : '0', width: wide ? 'auto' : '24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: '600', color: '#ccc',
    background: 'rgba(255,255,255,0.06)', gap: '3px'
  });
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.1)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.06)'; });

  let dd = null;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dd) { dd.remove(); dd = null; return; }
    typoBar.querySelectorAll('.dt-typo-dd').forEach(d => d.remove());
    dd = document.createElement('div');
    dd.className = 'dt-typo-dd';
    Object.assign(dd.style, {
      position: 'absolute', bottom: '100%', left: '0', marginBottom: '4px',
      background: 'rgba(35,35,35,0.98)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
      maxHeight: '180px', overflowY: 'auto', minWidth: '120px', padding: '4px 0', zIndex: '10'
    });
    options.forEach(cls => {
      const item = document.createElement('div');
      item.textContent = cls;
      Object.assign(item.style, {
        padding: '4px 10px', cursor: 'pointer', fontSize: '11px', color: '#ddd',
        fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace'
      });
      if (typoTarget && typoTarget.classList.contains(cls)) {
        item.style.color = '#ec4899'; item.style.fontWeight = '600';
      }
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.08)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (!typoTarget) return;
        options.forEach(c => typoTarget.classList.remove(c));
        typoTarget.classList.add(cls);
        btn.textContent = cls.replace(/^font-/, '').substring(0, 8);
        dd.remove(); dd = null;
      });
      dd.appendChild(item);
    });
    wrap.appendChild(dd);
  });

  wrap.appendChild(btn);
  return wrap;
}

function syncSlidersToTarget() {
  if (!typoBar || !typoTarget) return;
  // Sync each slider row to current element state
  typoBar.querySelectorAll('div').forEach(row => {
    if (!row._slider || !row._options) return;
    const opts = row._options;
    let idx = 0;
    for (let i = 0; i < opts.length; i++) {
      if (typoTarget.classList.contains(opts[i])) { idx = i; break; }
    }
    row._slider.value = String(idx);
    row._slider._label.textContent = opts[idx];
  });
}

function showTypoBar() {
  if (!isExperimentEnabled('wysiwyg')) { hideTypoBar(); return; }
  if (!typoBar) createTypoBar();
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !state.editMode) { hideTypoBar(); return; }

  // Find the block-level parent of the selection
  let node = sel.anchorNode;
  if (node.nodeType === 3) node = node.parentElement;
  const blockTags = ['P','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','FIGCAPTION','DIV','TD','TH','DT','DD','LABEL','A','SPAN'];
  while (node && !blockTags.includes(node.tagName)) node = node.parentElement;
  if (!node || inspectorUI.has(node)) { hideTypoBar(); return; }

  typoTarget = node;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0) { hideTypoBar(); return; }

  typoBar.style.display = 'flex';
  syncSlidersToTarget();
  const barW = typoBar.offsetWidth || 280;
  const barH = typoBar.offsetHeight || 200;
  let left = rect.left + rect.width / 2 - barW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - barW - 8));
  let top = rect.top - barH - 12;
  if (top < 8) top = rect.bottom + 8;
  typoBar.style.left = left + 'px';
  typoBar.style.top = top + 'px';
}

let _typoLocked = false; // prevent hide while interacting

function hideTypoBar() {
  if (_typoLocked) return;
  if (typoBar) {
    typoBar.style.display = 'none';
    typoBar.querySelectorAll('.dt-typo-dd').forEach(d => d.remove());
  }
  typoTarget = null;
}

export default {
  id: 'edit-mode',
  label: 'Edit Text',
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg>',
    tooltip: 'Edit Text',
    color: COLORS.edit,
    order: 40,
  },

  shortcuts: [],

  init() {
    document.head.appendChild(editHighlightStyle);
    // Show typography bar on text selection in edit mode
    document.addEventListener('selectionchange', () => {
      if (state.editMode) showTypoBar();
    });
    document.addEventListener('mouseup', () => {
      if (state.editMode) setTimeout(showTypoBar, 10);
    });
  },

  activate() {
    state.editMode = true;
    document.designMode = 'on';
    document.documentElement.classList.add('inspector-edit-active');
    document.body.style.cursor = 'text';
    showToast('Edit mode ON — select text for typography tools');
  },

  deactivate() {
    state.editMode = false;
    document.designMode = 'off';
    document.documentElement.classList.remove('inspector-edit-active');
    document.body.style.cursor = '';
    hideTypoBar();
  },

  toggle() {
    if (state.editMode) {
      this.deactivate();
      return false;
    } else {
      this.activate();
      return true;
    }
  },

  enable() {},
  disable() {
    this.deactivate();
  },
};
