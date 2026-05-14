/**
 * Spacing Debugger Plugin
 * Page-wide margin (orange) and padding (green) overlays for all visible elements.
 * No hover required — global X-ray for spacing consistency.
 */
(function () {
  const MARGIN_COLOR = 'rgba(255, 165, 0, 0.25)';
  const PADDING_COLOR = 'rgba(144, 238, 144, 0.3)';
  const LABEL_BG = 'rgba(0,0,0,0.7)';
  const MAX_ELEMENTS = 120;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BR', 'HR', 'LINK', 'META', 'HEAD', 'HTML']);

  let container = null;
  let panel = null;
  let active = false;
  let api = null;
  let rafId = null;
  let showLabels = false;
  let mode = 'both'; // 'both' | 'margin' | 'padding'

  function createContainer() {
    container = document.createElement('div');
    container.id = 'dt-spacing-overlays';
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483639;';
    document.body.appendChild(container);
  }

  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'dt-spacing-panel';
    panel.setAttribute('data-dt-ignore', '');
    panel.style.cssText = `
      position:fixed;bottom:60px;right:16px;z-index:2147483641;
      background:rgba(20,20,30,0.92);color:#e0e0e0;
      font:11px/1.6 'SF Mono',Menlo,monospace;
      padding:10px 14px;border-radius:8px;
      box-shadow:0 4px 16px rgba(0,0,0,0.3);
      pointer-events:auto;user-select:none;
    `;
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);
    bindPanel();
  }

  function buildPanelHTML() {
    return `
      <div style="margin-bottom:6px;font-weight:600;font-size:12px;">Spacing Debugger</div>
      <label style="display:block;cursor:pointer;margin:3px 0;">
        <input type="checkbox" id="dt-sp-labels" ${showLabels ? 'checked' : ''}> Show labels
      </label>
      <div style="margin:6px 0 3px;">
        <label style="cursor:pointer;margin-right:8px;"><input type="radio" name="dt-sp-mode" value="both" ${mode === 'both' ? 'checked' : ''}> Both</label>
        <label style="cursor:pointer;margin-right:8px;"><input type="radio" name="dt-sp-mode" value="margin" ${mode === 'margin' ? 'checked' : ''}> Margin</label>
        <label style="cursor:pointer;"><input type="radio" name="dt-sp-mode" value="padding" ${mode === 'padding' ? 'checked' : ''}> Padding</label>
      </div>
      <div id="dt-sp-count" style="margin-top:6px;color:#888;font-size:10px;"></div>
    `;
  }

  function bindPanel() {
    panel.querySelector('#dt-sp-labels').addEventListener('change', (e) => {
      showLabels = e.target.checked;
      refresh();
    });
    panel.querySelectorAll('input[name="dt-sp-mode"]').forEach(r => {
      r.addEventListener('change', (e) => {
        mode = e.target.value;
        refresh();
      });
    });
  }

  function getVisibleElements() {
    const all = document.body.querySelectorAll('*');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const results = [];

    for (let i = 0; i < all.length && results.length < MAX_ELEMENTS; i++) {
      const el = all[i];
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.closest('#dt-spacing-overlays, #dt-spacing-panel, #dom-tools-toolbar, [data-dt-ignore]')) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) continue;
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;

      const cs = getComputedStyle(el);
      const mt = parseFloat(cs.marginTop) || 0;
      const mr = parseFloat(cs.marginRight) || 0;
      const mb = parseFloat(cs.marginBottom) || 0;
      const ml = parseFloat(cs.marginLeft) || 0;
      const pt = parseFloat(cs.paddingTop) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0;

      const hasMargin = mt || mr || mb || ml;
      const hasPadding = pt || pr || pb || pl;
      if (!hasMargin && !hasPadding) continue;

      results.push({
        rect, el,
        margin: { top: mt, right: mr, bottom: mb, left: ml },
        padding: { top: pt, right: pr, bottom: pb, left: pl },
        bt: parseFloat(cs.borderTopWidth) || 0,
        br: parseFloat(cs.borderRightWidth) || 0,
        bb: parseFloat(cs.borderBottomWidth) || 0,
        bl: parseFloat(cs.borderLeftWidth) || 0,
      });
    }
    return results;
  }

  function renderSpacingOverlays() {
    container.innerHTML = '';
    const elements = getVisibleElements();

    elements.forEach(({ rect, margin, padding, bt, br, bb, bl }) => {
      if (mode === 'both' || mode === 'margin') {
        // Top margin
        if (margin.top) addBox(rect.left, rect.top - margin.top, rect.width, margin.top, MARGIN_COLOR, showLabels ? margin.top : null);
        // Bottom margin
        if (margin.bottom) addBox(rect.left, rect.bottom, rect.width, margin.bottom, MARGIN_COLOR, showLabels ? margin.bottom : null);
        // Left margin
        if (margin.left) addBox(rect.left - margin.left, rect.top, margin.left, rect.height, MARGIN_COLOR, showLabels ? margin.left : null);
        // Right margin
        if (margin.right) addBox(rect.right, rect.top, margin.right, rect.height, MARGIN_COLOR, showLabels ? margin.right : null);
      }

      if (mode === 'both' || mode === 'padding') {
        const innerTop = rect.top + bt;
        const innerLeft = rect.left + bl;
        const innerW = rect.width - bl - br;
        const innerH = rect.height - bt - bb;

        // Top padding
        if (padding.top) addBox(innerLeft, innerTop, innerW, padding.top, PADDING_COLOR, showLabels ? padding.top : null);
        // Bottom padding
        if (padding.bottom) addBox(innerLeft, innerTop + innerH - padding.bottom, innerW, padding.bottom, PADDING_COLOR, showLabels ? padding.bottom : null);
        // Left padding
        if (padding.left) addBox(innerLeft, innerTop, padding.left, innerH, PADDING_COLOR, showLabels ? padding.left : null);
        // Right padding
        if (padding.right) addBox(innerLeft + innerW - padding.right, innerTop, padding.right, innerH, PADDING_COLOR, showLabels ? padding.right : null);
      }
    });

    const countEl = panel && panel.querySelector('#dt-sp-count');
    if (countEl) countEl.textContent = `${elements.length} elements`;
  }

  function addBox(x, y, w, h, color, label) {
    if (w <= 0 || h <= 0) return;
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;top:${y}px;left:${x}px;width:${w}px;height:${h}px;background:${color};`;

    if (label !== null && (w >= 18 || h >= 18)) {
      const lbl = document.createElement('span');
      lbl.textContent = Math.round(label);
      lbl.style.cssText = `
        position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        font:9px/1 'SF Mono',Menlo,monospace;color:#fff;
        background:${LABEL_BG};padding:1px 3px;border-radius:2px;
      `;
      d.appendChild(lbl);
    }
    container.appendChild(d);
  }

  function refresh() {
    if (!active) return;
    renderSpacingOverlays();
  }

  function onScrollOrResize() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      refresh();
    });
  }

  // --- Plugin interface ---
  const plugin = {
    id: 'spacing-debugger',
    label: 'Spacing',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3H3v18h18V3z"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>`,

    toggle() {
      if (active) { this.deactivate(); return false; }
      else { this.activate(this._api); return true; }
    },

    activate(_api) {
      if (_api) api = _api;
      active = true;
      createContainer();
      createPanel();
      renderSpacingOverlays();
      window.addEventListener('scroll', onScrollOrResize, true);
      window.addEventListener('resize', onScrollOrResize);
    },

    deactivate() {
      active = false;
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (container) { container.remove(); container = null; }
      if (panel) { panel.remove(); panel = null; }
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  }
})();
