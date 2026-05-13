/**
 * DOM X-Ray Plugin
 * Box-model visualization: content (blue), padding (green), border (yellow), margin (orange).
 * Hover to inspect, click to lock selection.
 */
(function () {
  const COLORS = {
    margin:  'rgba(255, 165, 0, 0.15)',
    border:  'rgba(255, 215, 0, 0.25)',
    padding: 'rgba(144, 238, 144, 0.2)',
    content: 'rgba(100, 149, 237, 0.15)',
  };

  let container = null;
  let tooltip = null;
  let locked = null;
  let active = false;
  let api = null;

  function createOverlayContainer() {
    container = document.createElement('div');
    container.id = 'dt-xray-overlays';
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483640;';
    document.body.appendChild(container);
  }

  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.id = 'dt-xray-tooltip';
    tooltip.style.cssText = `
      position:fixed;pointer-events:none;z-index:2147483641;
      background:rgba(20,20,30,0.92);color:#e0e0e0;
      font:11px/1.5 'SF Mono',Menlo,monospace;
      padding:8px 10px;border-radius:6px;
      max-width:280px;white-space:pre;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);
      display:none;
    `;
    document.body.appendChild(tooltip);
  }

  function getBoxModel(el) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const parse = (v) => parseFloat(v) || 0;

    const mt = parse(cs.marginTop), mr = parse(cs.marginRight);
    const mb = parse(cs.marginBottom), ml = parse(cs.marginLeft);
    const bt = parse(cs.borderTopWidth), br = parse(cs.borderRightWidth);
    const bb = parse(cs.borderBottomWidth), blw = parse(cs.borderLeftWidth);
    const pt = parse(cs.paddingTop), pr = parse(cs.paddingRight);
    const pb = parse(cs.paddingBottom), pl = parse(cs.paddingLeft);

    return {
      rect, cs,
      margin: { top: mt, right: mr, bottom: mb, left: ml },
      border: { top: bt, right: br, bottom: bb, left: blw },
      padding: { top: pt, right: pr, bottom: pb, left: pl },
    };
  }

  function renderOverlays(el) {
    container.innerHTML = '';
    const { rect, margin, border, padding } = getBoxModel(el);

    // Margin layer (outermost)
    const marginRect = {
      top: rect.top - margin.top,
      left: rect.left - margin.left,
      width: rect.width + margin.left + margin.right,
      height: rect.height + margin.top + margin.bottom,
    };
    addOverlay(marginRect, COLORS.margin);

    // Border layer
    addOverlay({ top: rect.top, left: rect.left, width: rect.width, height: rect.height }, COLORS.border);

    // Padding layer (inside border)
    const paddingRect = {
      top: rect.top + border.top,
      left: rect.left + border.left,
      width: rect.width - border.left - border.right,
      height: rect.height - border.top - border.bottom,
    };
    addOverlay(paddingRect, COLORS.padding);

    // Content layer (innermost)
    const contentRect = {
      top: paddingRect.top + padding.top,
      left: paddingRect.left + padding.left,
      width: paddingRect.width - padding.left - padding.right,
      height: paddingRect.height - padding.top - padding.bottom,
    };
    addOverlay(contentRect, COLORS.content);
  }

  function addOverlay(r, color) {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px;background:${color};`;
    container.appendChild(d);
  }

  function updateTooltip(el, e) {
    const { rect, cs, margin, border, padding } = getBoxModel(el);
    const tag = el.tagName.toLowerCase();
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    const id = el.id ? `#${el.id}` : '';

    const lines = [
      `${tag}${id}${cls}`,
      `${Math.round(rect.width)} x ${Math.round(rect.height)}`,
      `margin: ${fmt(margin)}`,
      `padding: ${fmt(padding)}`,
      `border: ${fmt(border)}`,
      `position: ${cs.position}${cs.zIndex !== 'auto' ? '  z:' + cs.zIndex : ''}`,
    ];

    tooltip.textContent = lines.join('\n');
    tooltip.style.display = 'block';

    // Position near cursor
    let x = e.clientX + 14;
    let y = e.clientY + 14;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 10;
    if (y + th > window.innerHeight - 8) y = e.clientY - th - 10;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function fmt(box) {
    return `${box.top} ${box.right} ${box.bottom} ${box.left}`;
  }

  function isIgnored(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (el.closest('#dt-xray-overlays, #dt-xray-tooltip, #dom-tools-toolbar, [data-dt-ignore]')) return true;
    return false;
  }

  // --- Event handlers ---
  function onMouseMove(e) {
    if (locked) {
      updateTooltip(locked, e);
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isIgnored(el)) {
      container.innerHTML = '';
      tooltip.style.display = 'none';
      return;
    }
    renderOverlays(el);
    updateTooltip(el, e);
  }

  function onClick(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isIgnored(el)) return;
    e.preventDefault();
    e.stopPropagation();

    if (locked === el) {
      locked = null; // unlock
    } else {
      locked = el;
      renderOverlays(el);
      updateTooltip(el, e);
    }
  }

  function onScroll() {
    if (locked) renderOverlays(locked);
  }

  // --- Plugin interface ---
  const plugin = {
    id: 'dom-xray',
    label: 'X-Ray',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/><rect x="10" y="10" width="4" height="4"/></svg>`,

    activate(_api) {
      api = _api;
      active = true;
      createOverlayContainer();
      createTooltip();
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('click', onClick, true);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
    },

    deactivate() {
      active = false;
      locked = null;
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      if (container) { container.remove(); container = null; }
      if (tooltip) { tooltip.remove(); tooltip = null; }
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  }
})();
