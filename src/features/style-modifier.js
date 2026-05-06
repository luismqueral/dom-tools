import { state, inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { showToast, isInspectorUI, getSelector, addTooltip } from '../core/helpers.js';
import { isExperimentEnabled } from '../settings.js';
import { toolbar } from '../toolbar.js';

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
let panel = null;
let selected = []; // { el, originalClasses }[]
let activeMode = false;
let panelManuallyMoved = false;

// --- Copy button group in toolbar (shown only when changes exist) ---
let copyGroup = null; // container: divider + button + divider
let _toolbar = null;

function createCopyGroup(toolbar) {
  _toolbar = toolbar;
  copyGroup = document.createElement('div');
  Object.assign(copyGroup.style, {
    display: 'none', alignItems: 'center', gap: '6px'
  });

  const divL = document.createElement('div');
  Object.assign(divL.style, { width: '1px', height: '24px', background: 'rgba(255,255,255,0.15)' });

  const btn = document.createElement('div');
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
  Object.assign(btn.style, {
    width: '40px', height: '40px', background: '#222', color: '#fff',
    borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', userSelect: 'none', flexShrink: '0'
  });
  btn.addEventListener('mouseenter', () => { btn.style.background = '#333'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = '#222'; });
  btn.addEventListener('click', (e) => { e.stopPropagation(); copyChanges(); });
  addTooltip(btn, 'Copy Changes');

  const divR = document.createElement('div');
  Object.assign(divR.style, { width: '1px', height: '24px', background: 'rgba(255,255,255,0.15)' });

  copyGroup.appendChild(divL);
  copyGroup.appendChild(btn);
  copyGroup.appendChild(divR);
  toolbar.appendChild(copyGroup);
  inspectorUI.add(copyGroup);
  inspectorUI.add(btn);
}

function hasChanges() {
  return selected.some(({ el, originalClasses }) => el.className !== originalClasses);
}

function updateCopyButton() {
  if (!copyGroup) return;
  copyGroup.style.display = hasChanges() ? 'flex' : 'none';
}

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
  updateCopyButton();
}

function removeFromAll(cls) {
  selected.forEach(({ el }) => el.classList.remove(cls));
  updateCopyButton();
}

function resetAll() {
  selected.forEach(({ el, originalClasses }) => { el.className = originalClasses; });
  renderPanel();
  updateCopyButton();
  showToast('Reset');
}

// --- Panel ---
function createPanel() {
  panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', zIndex: String(Z.toolbar + 2),
    background: 'rgba(24,24,24,0.96)', borderRadius: '10px', padding: '0 14px 12px',
    width: '300px', maxHeight: '75vh', overflowY: 'auto',
    backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif',
    display: 'none', fontSize: '11px', color: '#eee'
  });

  // Drag handle
  const dragHandle = document.createElement('div');
  Object.assign(dragHandle.style, {
    height: '28px', cursor: 'grab', display: 'flex', alignItems: 'center',
    justifyContent: 'center', userSelect: 'none', marginBottom: '2px'
  });
  const dragDots = document.createElement('div');
  dragDots.textContent = '⠿';
  Object.assign(dragDots.style, { color: 'rgba(255,255,255,0.25)', fontSize: '12px', letterSpacing: '1px' });
  dragHandle.appendChild(dragDots);
  panel.appendChild(dragHandle);

  // Content area (gets rebuilt on each render)
  const content = document.createElement('div');
  content.className = 'dt-panel-content';
  panel.appendChild(content);

  // Snap indicator for panel
  const snapPreview = document.createElement('div');
  Object.assign(snapPreview.style, {
    position: 'fixed', background: 'rgba(236,72,153,0.08)', border: '2px dashed rgba(236,72,153,0.35)',
    borderRadius: '8px', zIndex: String(Z.toolbar + 1), display: 'none', pointerEvents: 'none',
    transition: 'all 0.15s ease'
  });
  document.body.appendChild(snapPreview);

  const SNAP = 100;
  let panelDocked = null; // null | 'left' | 'right'

  function getPanelSnapEdge(x) {
    if (x < SNAP) return 'left';
    if (x > window.innerWidth - SNAP) return 'right';
    return null;
  }

  function showPanelSnapPreview(edge) {
    snapPreview.style.display = 'block';
    if (edge === 'left') {
      Object.assign(snapPreview.style, { left: '0', right: '', top: '0', bottom: '0', width: '300px', height: '', borderRadius: '0' });
    } else {
      Object.assign(snapPreview.style, { right: '0', left: '', top: '0', bottom: '0', width: '300px', height: '', borderRadius: '0' });
    }
  }

  let panelWidth = 300;
  const PANEL_MIN_W = 240;
  const PANEL_MAX_W = 400;

  function applyPanelDock(edge) {
    panelDocked = edge;
    panelManuallyMoved = true;
    panel.style.top = '0px';
    panel.style.borderRadius = '0';
    panel.style.maxHeight = '100vh';
    panel.style.height = '100vh';
    panel.style.width = panelWidth + 'px';
    if (edge === 'left') { panel.style.left = '0px'; panel.style.right = ''; }
    else { panel.style.left = ''; panel.style.right = '0px'; }
    // Push page content
    document.documentElement.style.overflowX = 'hidden';
    if (edge === 'right') document.body.style.marginRight = panelWidth + 'px';
    else document.body.style.marginLeft = panelWidth + 'px';
    // Show resize handle
    resizeHandle.style.display = 'block';
    resizeHandle.style[edge === 'left' ? 'right' : 'left'] = '-4px';
    resizeHandle.style[edge === 'left' ? 'left' : 'right'] = '';
  }

  function undockPanel() {
    if (panelDocked === 'right') document.body.style.marginRight = '';
    else if (panelDocked === 'left') document.body.style.marginLeft = '';
    document.documentElement.style.overflowX = '';
    panelDocked = null;
    panel.style.right = '';
    panel.style.borderRadius = '10px';
    panel.style.maxHeight = '75vh';
    panel.style.height = '';
    panel.style.width = '300px';
    resizeHandle.style.display = 'none';
  }

  // Resize handle (only visible when docked)
  const resizeHandle = document.createElement('div');
  Object.assign(resizeHandle.style, {
    position: 'absolute', top: '0', width: '6px', height: '100%',
    cursor: 'col-resize', display: 'none', zIndex: '1'
  });
  panel.appendChild(resizeHandle);

  let resizing = false;
  resizeHandle.addEventListener('mousedown', (e) => {
    resizing = true;
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('mousemove', (e) => {
    if (!resizing || !panelDocked) return;
    let newW;
    if (panelDocked === 'right') newW = window.innerWidth - e.clientX;
    else newW = e.clientX;
    newW = Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, newW));
    panelWidth = newW;
    panel.style.width = newW + 'px';
    if (panelDocked === 'right') document.body.style.marginRight = newW + 'px';
    else document.body.style.marginLeft = newW + 'px';
  });
  document.addEventListener('mouseup', () => { resizing = false; });

  // Drag behavior
  let dragging = false, dx = 0, dy = 0;
  dragHandle.addEventListener('mousedown', (e) => {
    dragging = true;
    dx = e.clientX - panel.offsetLeft;
    dy = e.clientY - panel.offsetTop;
    dragHandle.style.cursor = 'grabbing';
    if (panelDocked) undockPanel();
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panelManuallyMoved = true;
    panel.style.left = (e.clientX - dx) + 'px';
    panel.style.top = (e.clientY - dy) + 'px';
    panel.style.right = '';

    const edge = getPanelSnapEdge(e.clientX);
    if (edge) showPanelSnapPreview(edge);
    else snapPreview.style.display = 'none';
  });
  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    dragHandle.style.cursor = 'grab';
    snapPreview.style.display = 'none';

    const edge = getPanelSnapEdge(e.clientX);
    if (edge) applyPanelDock(edge);
  });

  panel.addEventListener('mousedown', (e) => { if (e.target.type !== 'range') e.preventDefault(); e.stopPropagation(); });
  panel.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('keydown', (e) => e.stopPropagation());

  document.body.appendChild(panel);
  inspectorUI.add(panel);
}

let activeTab = null; // track selected tab

function renderPanel() {
  if (!panel) createPanel();
  const content = panel.querySelector('.dt-panel-content');
  content.innerHTML = '';
  if (!selected.length) { panel.style.display = 'none'; return; }

  const type = getMixedType(selected);
  const primary = selected[0].el;

  // Determine available tabs
  const tabs = [];
  if (type === 'text' || type === 'mixed' || type === 'interactive') tabs.push({ id: 'type', label: 'Type' });
  if (type === 'container' || type === 'mixed' || type === 'interactive') tabs.push({ id: 'layout', label: 'Layout' });
  if (type === 'media') tabs.push({ id: 'media', label: 'Media' });
  tabs.push({ id: 'style', label: 'Style' });
  tabs.push({ id: 'classes', label: 'Classes' });

  // Default to first tab if current doesn't exist
  if (!activeTab || !tabs.find(t => t.id === activeTab)) activeTab = tabs[0].id;

  // Header row: element tag + reset
  const header = document.createElement('div');
  Object.assign(header.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' });
  const title = document.createElement('span');
  title.textContent = selected.length > 1 ? `${selected.length} elements` : `<${primary.tagName.toLowerCase()}>`;
  Object.assign(title.style, { fontWeight: '600', fontSize: '11px', color: '#666' });
  const resetBtn = makeBtn('Reset', () => resetAll());
  header.appendChild(title);
  header.appendChild(resetBtn);
  content.appendChild(header);

  // Tab bar
  const tabBar = document.createElement('div');
  Object.assign(tabBar.style, { display: 'flex', gap: '2px', marginBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' });
  tabs.forEach(tab => {
    const t = document.createElement('div');
    t.textContent = tab.label;
    const isActive = tab.id === activeTab;
    Object.assign(t.style, {
      padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: '600',
      color: isActive ? '#ec4899' : '#888',
      background: isActive ? 'rgba(236,72,153,0.12)' : 'transparent'
    });
    t.addEventListener('mouseenter', () => { if (!isActive) t.style.background = 'rgba(255,255,255,0.06)'; });
    t.addEventListener('mouseleave', () => { if (!isActive) t.style.background = 'transparent'; });
    t.addEventListener('click', (e) => { e.stopPropagation(); activeTab = tab.id; renderPanel(); });
    tabBar.appendChild(t);
  });
  content.appendChild(tabBar);

  // Tab content
  const tabContent = document.createElement('div');
  if (activeTab === 'type') renderTextControls(tabContent, primary);
  else if (activeTab === 'layout') renderLayoutControls(tabContent, primary);
  else if (activeTab === 'media') renderMediaControls(tabContent, primary);
  else if (activeTab === 'style') {
    renderSection(tabContent, 'Background', (sec) => renderColorSwatches(sec, BG_COLORS, primary));
    renderSection(tabContent, 'Border & Effects', (sec) => {
      sec.appendChild(makeSlider('Rounded', ['rounded-none','rounded-sm','rounded','rounded-md','rounded-lg','rounded-xl','rounded-2xl','rounded-full'], primary));
      sec.appendChild(makeSlider('Shadow', ['shadow-none','shadow-sm','shadow','shadow-md','shadow-lg','shadow-xl','shadow-2xl'], primary));
      sec.appendChild(makeSlider('Opacity', ['opacity-0','opacity-25','opacity-50','opacity-75','opacity-100'], primary));
    });
  }
  else if (activeTab === 'classes') renderClassEditor(tabContent, primary);
  content.appendChild(tabContent);

  // Footer: copy button
  const footer = document.createElement('div');
  Object.assign(footer.style, { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' });
  const copyBtn = makeBtn('Copy Classes', () => {
    const classes = selected.map(s => s.el.className).join('\n');
    navigator.clipboard.writeText(classes).then(() => showToast('Copied'));
  }, true);
  footer.appendChild(copyBtn);
  content.appendChild(footer);

  panel.style.display = 'block';
  positionPanel();
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
    // Font family quick-pick
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

    // Sliders
    TYPO_SLIDERS.forEach(s => sec.appendChild(makeSlider(s.label, s.options, el)));

    // Toggles row
    const toggleRow = makeRow();
    toggleRow.appendChild(makeToggle('B', 'font-bold', ['font-thin','font-light','font-normal','font-medium','font-semibold','font-bold','font-extrabold','font-black'], el));
    toggleRow.appendChild(makeToggle('I', 'italic', ['italic','not-italic'], el));
    toggleRow.appendChild(makeToggle('U', 'underline', ['underline','no-underline'], el));
    toggleRow.appendChild(makeToggle('TT', 'uppercase', ['uppercase','lowercase','capitalize','normal-case'], el));
    // Spacer
    const spacer = document.createElement('div'); spacer.style.flex = '1'; toggleRow.appendChild(spacer);
    // Alignment
    ALIGN_OPTIONS.forEach(cls => {
      const icon = cls === 'text-left' ? '\u2190' : cls === 'text-center' ? '\u2194' : cls === 'text-right' ? '\u2192' : '\u2261';
      toggleRow.appendChild(makeToggle(icon, cls, ALIGN_OPTIONS, el));
    });
    sec.appendChild(toggleRow);

    // Color swatches
    sec.appendChild(makeColorRow('Color', TEXT_COLORS, el));
  });
}

// --- Layout controls ---
function renderLayoutControls(parent, el) {
  renderSection(parent, 'Layout', (sec) => {
    // Display quick-pick
    const dispRow = makeRow();
    DISPLAY_OPTIONS.forEach(cls => {
      dispRow.appendChild(makePillBtn(cls, el.classList.contains(cls), () => {
        applyToAll(cls, DISPLAY_OPTIONS);
        renderPanel();
      }));
    });
    sec.appendChild(dispRow);

    // Justify + Align (only if flex/grid)
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

    // Spacing sliders
    LAYOUT_SLIDERS.forEach(s => sec.appendChild(makeSlider(s.label, s.options, el)));
  });
}

// --- Media controls ---
function renderMediaControls(parent, el) {
  renderSection(parent, 'Media', (sec) => {
    // Object fit
    const fitRow = makeRow();
    fitRow.appendChild(makeLabel('Fit'));
    OBJECT_FIT_OPTIONS.forEach(cls => {
      fitRow.appendChild(makePillBtn(cls.replace('object-', ''), el.classList.contains(cls), () => {
        applyToAll(cls, OBJECT_FIT_OPTIONS);
        renderPanel();
      }));
    });
    sec.appendChild(fitRow);

    // Size/visual sliders
    MEDIA_SLIDERS.forEach(s => sec.appendChild(makeSlider(s.label, s.options, el)));
  });
}

// --- Class editor (always shown) ---
function renderClassEditor(parent, el) {
  renderSection(parent, 'Classes', (sec) => {
    // Chips
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

    // Input + autocomplete
    const inputWrap = document.createElement('div');
    Object.assign(inputWrap.style, { position: 'relative' });
    const input = document.createElement('input');
    input.placeholder = '+ Add class...';
    Object.assign(input.style, {
      width: '100%', padding: '5px 7px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.12)',
      background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '11px', outline: 'none',
      fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace'
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

  // Find current index
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

// All color classes for autocomplete
const ALL_COLOR_CLASSES = CLASSES.filter(c => c.startsWith('text-') || c.startsWith('bg-') || c.startsWith('border-'));

function makeColorRow(label, colors, el) {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { marginTop: '6px' });

  // Swatch row
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

  // Color input with autocomplete
  const inputWrap = document.createElement('div');
  Object.assign(inputWrap.style, { position: 'relative', marginTop: '5px', marginLeft: '48px' });
  const input = document.createElement('input');
  input.placeholder = label === 'Fill' ? 'bg-...' : 'text-...';
  Object.assign(input.style, {
    width: '100%', padding: '4px 6px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '10px', outline: 'none',
    fontFamily: 'SF Mono, SFMono-Regular, Menlo, monospace'
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

// --- Positioning ---
function positionPanel() {
  if (!panel || !selected.length) return;
  // If user dragged the panel, keep their position
  if (panelManuallyMoved) return;

  const el = selected[0].el;
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const panelH = panel.offsetHeight || 300;
  const panelW = 300;

  let top, left;
  if (rect.bottom + panelH + 12 < vh) top = rect.bottom + 8;
  else top = Math.max(8, rect.top - panelH - 8);
  left = rect.left + rect.width / 2 - panelW / 2;
  left = Math.max(8, Math.min(left, vw - panelW - 8));

  panel.style.top = top + 'px';
  panel.style.left = left + 'px';
}

// --- Selection + highlight ---
const TEXT_TAGS = ['P','H1','H2','H3','H4','H5','H6','SPAN','A','LABEL','LI','BLOCKQUOTE','FIGCAPTION','DT','DD','EM','STRONG','SMALL'];

function selectElement(el, additive) {
  if (!additive) {
    // Clear previous selection
    selected.forEach(s => {
      s.el.style.outline = s.origOutline;
      if (s.madeEditable) { s.el.contentEditable = 'false'; s.el.style.cursor = ''; }
    });
    selected = [];
  }
  // Toggle if already selected
  const idx = selected.findIndex(s => s.el === el);
  if (idx !== -1) {
    el.style.outline = selected[idx].origOutline;
    if (selected[idx].madeEditable) { el.contentEditable = 'false'; el.style.cursor = ''; }
    selected.splice(idx, 1);
  } else {
    const isText = TEXT_TAGS.includes(el.tagName);
    const entry = { el, originalClasses: el.className, origOutline: el.style.outline, madeEditable: false };
    if (isText) {
      el.contentEditable = 'true';
      el.style.cursor = 'text';
      entry.madeEditable = true;
    }
    selected.push(entry);
    el.style.outline = '2px solid #ec4899';
  }
  renderPanel();
}

function clearSelection() {
  selected.forEach(s => {
    s.el.style.outline = s.origOutline;
    if (s.madeEditable) { s.el.contentEditable = 'false'; s.el.style.cursor = ''; }
  });
  selected = [];
  if (panel) { panel.style.display = 'none'; panel.querySelector('.dt-panel-content').innerHTML = ''; }
  // Restore page margins if docked
  document.body.style.marginLeft = '';
  document.body.style.marginRight = '';
  document.documentElement.style.overflowX = '';
}

// --- Copy all changes ---
function copyChanges() {
  if (!selected.length) { showToast('No elements selected'); return; }
  const diffs = selected.map(({ el, originalClasses }) => {
    const origSet = new Set(originalClasses.trim().split(/\s+/).filter(Boolean));
    const currSet = new Set(el.className.trim().split(/\s+/).filter(Boolean));
    const added = [...currSet].filter(c => !origSet.has(c));
    const removed = [...origSet].filter(c => !currSet.has(c));
    const selector = getSelector(el);
    let out = selector;
    if (added.length) out += '\n  + ' + added.join(' ');
    if (removed.length) out += '\n  - ' + removed.join(' ');
    if (!added.length && !removed.length) out += '\n  (no changes)';
    return out;
  }).join('\n\n');
  navigator.clipboard.writeText(diffs).then(() => showToast('Changes copied'));
}

// --- Click handler ---
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
  // Don't highlight already-selected elements
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

  // If clicking inside an already-selected text element, let the caret through
  const alreadySelected = selected.find(s => s.el === el || s.el.contains(el));
  if (alreadySelected && alreadySelected.madeEditable) {
    e.stopPropagation();
    return; // don't preventDefault — let the caret land
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
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0112 22zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5a.54.54 0 00-.14-.35c-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 012.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7z"/><circle cx="6.5" cy="11.5" r="1.5"/><circle cx="9.5" cy="7.5" r="1.5"/><circle cx="14.5" cy="7.5" r="1.5"/><circle cx="17.5" cy="11.5" r="1.5"/></svg>',
    tooltip: 'Design',
    color: '#ec4899',
    order: 35,
  },

  shortcuts: [],

  init() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove, true);
    createCopyGroup(toolbar);
  },

  activate() {
    activeMode = true;
    state.styleModActive = true;
    showToast('Design — click to style, shift+click multi-select');
  },

  deactivate() {
    activeMode = false;
    state.styleModActive = false;
    clearHoverHighlight();
    clearSelection();
    if (copyGroup) copyGroup.style.display = 'none';
  },

  toggle() {
    if (activeMode) { this.deactivate(); return false; }
    else { this.activate(); return true; }
  },

  enable() {},
  disable() { this.deactivate(); },
};
