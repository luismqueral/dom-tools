/**
 * Inspector Panel (NYT-CSS) — token audit variant with hardcoded NYT token families.
 *
 * Knows which CSS properties SHOULD use NYT design tokens, so it can flag
 * raw values even on pages that don't define :root custom properties.
 * Extends the same keyboard-first editing UX as the universal inspector.
 */
(function () {
  'use strict';

  const TOKEN_RE = /var\((--[\w-]+)/;

  // --- NYT Token Definitions ---

  const NYT_TOKENS = {
    sp: [
      { name: '--sp-0', value: '0' },
      { name: '--sp-1', value: '0.25rem' },
      { name: '--sp-2', value: '0.5rem' },
      { name: '--sp-3', value: '0.75rem' },
      { name: '--sp-4', value: '1rem' },
      { name: '--sp-5', value: '1.5rem' },
      { name: '--sp-6', value: '2rem' },
      { name: '--sp-7', value: '3rem' },
      { name: '--sp-8', value: '4rem' },
      { name: '--sp-10', value: '5rem' },
      { name: '--sp-12', value: '6rem' },
      { name: '--sp-16', value: '8rem' },
    ],
    ts: [
      { name: '--ts-xs', value: '11px' },
      { name: '--ts-sm', value: '13px' },
      { name: '--ts-base', value: '15px' },
      { name: '--ts-md', value: '17px' },
      { name: '--ts-lg', value: '20px' },
      { name: '--ts-xl', value: '26px' },
      { name: '--ts-2xl', value: '34px' },
      { name: '--ts-3xl', value: '42px' },
      { name: '--ts-4xl', value: '52px' },
      { name: '--ts-5xl', value: '64px' },
      { name: '--ts-6xl', value: '80px' },
    ],
    lh: [
      { name: '--lh-solid', value: '1' },
      { name: '--lh-title', value: '1.2' },
      { name: '--lh-heading', value: '1.3' },
      { name: '--lh-copy', value: '1.55' },
      { name: '--lh-loose', value: '1.8' },
    ],
    ls: [
      { name: '--ls-tight', value: '-0.02em' },
      { name: '--ls-none', value: '0' },
      { name: '--ls-tracked', value: '0.05em' },
      { name: '--ls-mega', value: '0.15em' },
    ],
    br: [
      { name: '--br-0', value: '0' },
      { name: '--br-1', value: '2px' },
      { name: '--br-2', value: '4px' },
      { name: '--br-3', value: '8px' },
      { name: '--br-4', value: '12px' },
      { name: '--br-5', value: '16px' },
      { name: '--br-pill', value: '9999px' },
      { name: '--br-full', value: '100%' },
    ],
    bw: [
      { name: '--bw-0', value: '0' },
      { name: '--bw-1', value: '1px' },
      { name: '--bw-2', value: '2px' },
      { name: '--bw-3', value: '4px' },
      { name: '--bw-4', value: '8px' },
    ],
    shadow: [
      { name: '--shadow-1', value: '0 1px 2px rgba(0, 0, 0, 0.08)' },
      { name: '--shadow-2', value: '0 2px 4px rgba(0, 0, 0, 0.1)' },
      { name: '--shadow-3', value: '0 4px 8px rgba(0, 0, 0, 0.12)' },
      { name: '--shadow-4', value: '0 8px 16px rgba(0, 0, 0, 0.14)' },
      { name: '--shadow-5', value: '0 16px 32px rgba(0, 0, 0, 0.16)' },
    ],
    ease: [
      { name: '--ease-fast', value: '0.1s ease' },
      { name: '--ease-normal', value: '0.2s ease' },
      { name: '--ease-slow', value: '0.4s ease' },
    ],
    mw: [
      { name: '--mw-narrow', value: '560px' },
      { name: '--mw-container', value: '760px' },
      { name: '--mw-wide', value: '960px' },
      { name: '--mw-full', value: '1200px' },
    ],
    'nyt-fg': [
      { name: '--nyt-fg', value: '#121212' },
      { name: '--nyt-fg-dim', value: '#5a5a5a' },
      { name: '--nyt-fg-faint', value: '#8b8b8b' },
    ],
    'nyt-bg': [
      { name: '--nyt-bg', value: '#ffffff' },
      { name: '--nyt-bg-alt', value: '#f5f5f2' },
    ],
    'nyt-border': [
      { name: '--nyt-border', value: '#ececec' },
      { name: '--nyt-border-strong', value: '#c7c7c7' },
    ],
    'nyt-accent': [
      { name: '--nyt-accent', value: '#326891' },
      { name: '--nyt-red', value: '#c13b2a' },
      { name: '--nyt-orange', value: '#b87a00' },
      { name: '--nyt-green', value: '#3f7f63' },
    ],
    viz: [
      { name: '--viz-1', value: '#2A6586' },
      { name: '--viz-2', value: '#6CBAAB' },
      { name: '--viz-3', value: '#B2A5E7' },
      { name: '--viz-4', value: '#F66043' },
      { name: '--viz-5', value: '#D2E463' },
      { name: '--viz-6', value: '#F1A05B' },
      { name: '--viz-7', value: '#657D53' },
      { name: '--viz-8', value: '#BD5D91' },
    ],
    'viz-blue': [
      { name: '--viz-blue-1', value: '#242b40' },
      { name: '--viz-blue-2', value: '#1f497d' },
      { name: '--viz-blue-3', value: '#00577e' },
      { name: '--viz-blue-4', value: '#80b0c1' },
    ],
    'viz-green': [
      { name: '--viz-green-1', value: '#437661' },
      { name: '--viz-green-2', value: '#6a9b87' },
      { name: '--viz-green-3', value: '#a8ddc7' },
      { name: '--viz-green-4', value: '#e2eceb' },
    ],
    'viz-product': [
      { name: '--viz-core', value: '#2F3E7A' },
      { name: '--viz-cooking', value: '#f9351a' },
      { name: '--viz-games', value: '#F8CD0F' },
      { name: '--viz-athletic', value: '#30522D' },
      { name: '--viz-wirecutter', value: '#6085ff' },
      { name: '--viz-audio', value: '#357a8a' },
    ],
    'nyt-font': [
      { name: '--nyt-sans', value: "'nyt-franklin', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" },
      { name: '--nyt-sans-small', value: "'nyt-franklin-small', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" },
      { name: '--nyt-serif', value: "'nyt-cheltenham', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-serif-cond', value: "'nyt-cheltenham-cond', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-serif-wide', value: "'nyt-cheltenham-wide', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-serif-small', value: "'nyt-cheltenham-small', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-serif-scaps', value: "'nyt-cheltenham-scaps', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-imperial', value: "'nyt-imperial', Georgia, 'Times New Roman', serif" },
      { name: '--nyt-display', value: "'nyt-karnak', Georgia, serif" },
      { name: '--nyt-display-cond', value: "'nyt-karnak-cond', Georgia, serif" },
      { name: '--nyt-display-small', value: "'nyt-karnak-small', Georgia, serif" },
      { name: '--nyt-mag', value: "'nyt-kippenberger', Georgia, serif" },
      { name: '--nyt-mag-cond', value: "'nyt-kippenberger-condensed', Georgia, serif" },
      { name: '--nyt-mag-poster', value: "'nyt-kippenberger-poster', Georgia, serif" },
      { name: '--nyt-mag-sans', value: "'nyt-magsans', -apple-system, BlinkMacSystemFont, sans-serif" },
      { name: '--nyt-mag-serif', value: "'nyt-magserif', Georgia, serif" },
      { name: '--nyt-mag-slab', value: "'nyt-magslab', Georgia, serif" },
      { name: '--nyt-fact', value: "'nyt-fact', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" },
      { name: '--nyt-fact-display', value: "'nyt-fact-display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" },
      { name: '--nyt-athletic', value: "'nyt-athletic-slab', Georgia, serif" },
      { name: '--nyt-schnyder', value: "'nyt-schnyder-s', Georgia, serif" },
      { name: '--nyt-mono', value: "'nyt-ibm-plex', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" },
      { name: '--nyt-prototype', value: "'Comic Sans MS', 'Comic Sans', cursive" },
    ],
  };

  // Maps CSS properties to their expected NYT token family
  const PROP_FAMILY_MAP = {
    'padding-top': 'sp', 'padding-right': 'sp', 'padding-bottom': 'sp', 'padding-left': 'sp',
    'margin-top': 'sp', 'margin-right': 'sp', 'margin-bottom': 'sp', 'margin-left': 'sp',
    'gap': 'sp',
    'font-size': 'ts',
    'line-height': 'lh',
    'letter-spacing': 'ls',
    'border-radius': 'br',
    'border-top-left-radius': 'br', 'border-top-right-radius': 'br',
    'border-bottom-left-radius': 'br', 'border-bottom-right-radius': 'br',
    'border-width': 'bw',
    'border-top-width': 'bw', 'border-right-width': 'bw',
    'border-bottom-width': 'bw', 'border-left-width': 'bw',
    'color': 'nyt-fg',
    'background-color': 'nyt-bg',
    'border-color': 'nyt-border',
    'border-top-color': 'nyt-border', 'border-right-color': 'nyt-border',
    'border-bottom-color': 'nyt-border', 'border-left-color': 'nyt-border',
    'font-family': 'nyt-font',
    'box-shadow': 'shadow',
    'max-width': 'mw',
    'transition': 'ease',
  };

  // --- Inject token CSS vars into page (so var() resolves on any page) ---

  let injectedStyleEl = null;

  function injectTokenStyles() {
    if (injectedStyleEl) return;
    const rules = [':root {'];
    for (const family of Object.values(NYT_TOKENS)) {
      for (const tok of family) {
        rules.push(`  ${tok.name}: ${tok.value};`);
      }
    }
    rules.push('}');
    injectedStyleEl = document.createElement('style');
    injectedStyleEl.id = 'dt-nyt-injected-tokens';
    injectedStyleEl.textContent = rules.join('\n');
    document.head.appendChild(injectedStyleEl);
  }

  function removeTokenStyles() {
    if (injectedStyleEl) { injectedStyleEl.remove(); injectedStyleEl = null; }
  }

  // --- Token resolution ---

  function extractToken(value) {
    if (!value) return null;
    const m = value.match(TOKEN_RE);
    return m ? m[1] : null;
  }

  function splitShorthandValue(value) {
    const parts = [];
    let current = '', depth = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === '(') { depth++; current += ch; }
      else if (ch === ')') { depth--; current += ch; }
      else if (/\s/.test(ch) && depth === 0) {
        if (current) { parts.push(current); current = ''; }
      } else { current += ch; }
    }
    if (current) parts.push(current);
    return parts;
  }

  function expandBoxShorthand(value) {
    const parts = splitShorthandValue(value);
    let top, right, bottom, left;
    if (parts.length === 1) { top = right = bottom = left = parts[0]; }
    else if (parts.length === 2) { top = bottom = parts[0]; right = left = parts[1]; }
    else if (parts.length === 3) { top = parts[0]; right = left = parts[1]; bottom = parts[2]; }
    else { top = parts[0]; right = parts[1]; bottom = parts[2]; left = parts[3]; }
    return { top, right, bottom, left };
  }

  // --- Token discovery (uses hardcoded NYT tokens) ---

  function getFamily(tokenName) {
    // Check if token belongs to any known family
    for (const [familyName, tokens] of Object.entries(NYT_TOKENS)) {
      if (tokens.some(t => t.name === tokenName)) return familyName;
    }
    // Fallback: split by last dash
    const bare = tokenName.replace(/^--/, '');
    const parts = bare.split('-');
    if (parts.length <= 1) return bare;
    return parts.slice(0, -1).join('-');
  }

  function getFamilyTokens(tokenName) {
    const family = getFamily(tokenName);
    return NYT_TOKENS[family] || [];
  }

  function getFamilyByName(familyName) {
    return NYT_TOKENS[familyName] || [];
  }

  function getExpectedFamily(cssProp) {
    return PROP_FAMILY_MAP[cssProp] || null;
  }

  function resolveTokenColor(tokenName) {
    // Try computed style first, fall back to hardcoded
    const rootStyles = getComputedStyle(document.documentElement);
    const computed = rootStyles.getPropertyValue(tokenName).trim();
    if (computed) return computed;
    // Look up in NYT_TOKENS
    for (const family of Object.values(NYT_TOKENS)) {
      const t = family.find(tok => tok.name === tokenName);
      if (t) return t.value;
    }
    return '';
  }

  // --- Token resolution for an element ---

  function resolveAllTokens(el) {
    const tokens = {};
    for (let s = 0; s < document.styleSheets.length; s++) {
      let rules;
      try { rules = document.styleSheets[s].cssRules; } catch (_) { continue; }
      if (!rules) continue;
      processRules(rules, el, tokens);
    }
    if (el.style && el.style.length) {
      for (let i = 0; i < el.style.length; i++) {
        const prop = el.style[i];
        const raw = el.style.getPropertyValue(prop);
        if (raw && TOKEN_RE.test(raw)) {
          tokens[prop] = extractToken(raw);
        }
      }
    }
    return tokens;
  }

  function processRules(rules, el, tokens) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.conditionText).matches) {
          processRules(rule.cssRules, el, tokens);
        }
      } else if (rule instanceof CSSStyleRule) {
        try { if (!el.matches(rule.selectorText)) continue; } catch (_) { continue; }
        collectTokens(rule.style, tokens);
      }
    }
  }

  function collectTokens(style, tokens) {
    for (const prop of ['padding', 'margin']) {
      const raw = style.getPropertyValue(prop);
      if (raw && TOKEN_RE.test(raw)) {
        const expanded = expandBoxShorthand(raw);
        tokens[prop + '-top'] = extractToken(expanded.top);
        tokens[prop + '-right'] = extractToken(expanded.right);
        tokens[prop + '-bottom'] = extractToken(expanded.bottom);
        tokens[prop + '-left'] = extractToken(expanded.left);
      }
    }
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      const raw = style.getPropertyValue(prop);
      if (raw && TOKEN_RE.test(raw)) {
        tokens[prop] = extractToken(raw);
      }
    }
  }

  // --- Token usage indicators ---

  const INDICATOR_TOKEN = '#4ade80';  // green-400
  const INDICATOR_RAW = '#f59e0b';    // amber-500

  function indicatorDot(isToken) {
    const dot = mkEl('span', {
      color: isToken ? INDICATOR_TOKEN : INDICATOR_RAW,
      fontSize: '7px',
      marginRight: '5px',
      flexShrink: '0',
      lineHeight: '1',
    });
    dot.textContent = '\u25CF';
    return dot;
  }

  // --- Change tracking ---

  const changes = [];

  function applyToken(el, cssProp, newToken, oldToken) {
    if (!el._dtOrigStyles) el._dtOrigStyles = {};
    if (!(cssProp in el._dtOrigStyles)) {
      el._dtOrigStyles[cssProp] = el.style.getPropertyValue(cssProp) || '';
    }
    // Set resolved value directly for immediate visual feedback,
    // then layer var() on top. If var() resolves, it wins; if not, the raw value holds.
    const resolved = resolveTokenColor(newToken);
    if (resolved) {
      el.style.setProperty(cssProp, resolved);
    }
    // Also set via var() so it stays linked to the token if defined
    el.style.setProperty(cssProp, `var(${newToken}, ${resolved || ''})`);
    const existing = changes.find(c => c.el === el && c.prop === cssProp);
    if (existing) {
      existing.to = newToken;
    } else {
      changes.push({
        el, prop: cssProp,
        from: oldToken || el._dtOrigStyles[cssProp],
        to: newToken,
        selector: api.getSelector(el),
      });
    }
    window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
  }

  function applyRawValue(el, cssProp, value) {
    if (!el._dtOrigStyles) el._dtOrigStyles = {};
    if (!(cssProp in el._dtOrigStyles)) {
      el._dtOrigStyles[cssProp] = el.style.getPropertyValue(cssProp) || '';
    }
    el.style.setProperty(cssProp, value);
    const existing = changes.find(c => c.el === el && c.prop === cssProp);
    if (existing) {
      existing.to = value;
    } else {
      changes.push({
        el, prop: cssProp,
        from: el._dtOrigStyles[cssProp],
        to: value,
        selector: api.getSelector(el),
      });
    }
    window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
  }

  function resetProp(el, cssProp) {
    el.style.removeProperty(cssProp);
    const idx = changes.findIndex(c => c.el === el && c.prop === cssProp);
    if (idx >= 0) changes.splice(idx, 1);
    window.DomTools._inspectorChanges = changes;
    if (api.updateBadgeCount) api.updateBadgeCount();
  }

  // --- Spacing overlay ---

  const PAD_COLOR = 'rgba(144, 238, 144, 0.4)';
  const PAD_BRIGHT = 'rgba(144, 238, 144, 0.6)';
  const PAD_LABEL_BG = 'rgba(30, 90, 50, 0.9)';
  const MAR_COLOR = 'rgba(255, 165, 0, 0.35)';
  const MAR_BRIGHT = 'rgba(255, 165, 0, 0.55)';
  const MAR_LABEL_BG = 'rgba(140, 70, 0, 0.9)';

  let overlayEl = null;

  function clearOverlay() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  }

  function showSpacingOverlay(prop, el) {
    clearOverlay();
    if (!el) return;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const p = (v) => parseFloat(v) || 0;
    const isPadding = prop.startsWith('padding');
    const color = isPadding ? PAD_COLOR : MAR_COLOR;
    const brightColor = isPadding ? PAD_BRIGHT : MAR_BRIGHT;
    const labelBg = isPadding ? PAD_LABEL_BG : MAR_LABEL_BG;

    // Resolve tokens for this element so overlay labels can show token names
    const elTokens = resolveAllTokens(el);

    const sides = (prop === 'padding' || prop === 'margin')
      ? ['top', 'right', 'bottom', 'left']
      : [prop.split('-').pop()];

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '99998',
    });

    sides.forEach(side => {
      const fullProp = (isPadding ? 'padding-' : 'margin-') + side;
      const val = p(cs.getPropertyValue(fullProp));
      if (val <= 0) return;

      let x, y, w, h;
      if (isPadding) {
        const pt = p(cs.paddingTop), pr = p(cs.paddingRight), pb = p(cs.paddingBottom), pl = p(cs.paddingLeft);
        if (side === 'top') { x = rect.left; y = rect.top; w = rect.width; h = pt; }
        else if (side === 'bottom') { x = rect.left; y = rect.bottom - pb; w = rect.width; h = pb; }
        else if (side === 'left') { x = rect.left; y = rect.top + pt; w = pl; h = rect.height - pt - pb; }
        else { x = rect.right - pr; y = rect.top + pt; w = pr; h = rect.height - pt - pb; }
      } else {
        const mt = p(cs.marginTop), mr = p(cs.marginRight), mb = p(cs.marginBottom), ml = p(cs.marginLeft);
        if (side === 'top') { x = rect.left; y = rect.top - mt; w = rect.width; h = mt; }
        else if (side === 'bottom') { x = rect.left; y = rect.bottom; w = rect.width; h = mb; }
        else if (side === 'left') { x = rect.left - ml; y = rect.top - mt; w = ml; h = rect.height + mt + mb; }
        else { x = rect.right; y = rect.top - mt; w = mr; h = rect.height + mt + mb; }
      }

      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed', top: y + 'px', left: x + 'px',
        width: w + 'px', height: h + 'px',
        background: sides.length === 1 ? brightColor : color,
      });
      container.appendChild(box);

      if (w >= 14 || h >= 14) {
        const token = elTokens[fullProp] || null;
        const lbl = document.createElement('span');
        Object.assign(lbl.style, {
          position: 'fixed',
          top: (y + h / 2) + 'px', left: (x + w / 2) + 'px',
          transform: 'translate(-50%, -50%)',
          font: '9px/1 ui-monospace, Menlo, monospace',
          color: token ? '#fbbf24' : '#fff',
          background: labelBg,
          padding: '2px 5px', borderRadius: '2px',
          whiteSpace: 'nowrap',
        });
        lbl.textContent = token ? token + ' (' + Math.round(val) + 'px)' : Math.round(val) + 'px';
        container.appendChild(lbl);
      }
    });

    document.body.appendChild(container);
    overlayEl = container;
  }

  // --- Property overlay (non-spacing) ---

  function showPropertyOverlay(prop, el) {
    clearOverlay();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const val = cs.getPropertyValue(prop);
    if (!val) return;

    const elTokens = resolveAllTokens(el);
    const token = elTokens[prop] || null;
    const expectedFamily = getExpectedFamily(prop);

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '99998',
    });

    // Highlight outline on the element
    const outline = document.createElement('div');
    Object.assign(outline.style, {
      position: 'fixed',
      top: rect.top + 'px', left: rect.left + 'px',
      width: rect.width + 'px', height: rect.height + 'px',
      border: token ? '1.5px solid rgba(74,222,128,0.6)' : '1.5px dashed rgba(245,158,11,0.6)',
      borderRadius: '2px',
      pointerEvents: 'none',
    });
    container.appendChild(outline);

    // Label badge positioned above element
    const lbl = document.createElement('div');
    const labelY = Math.max(4, rect.top - 22);
    Object.assign(lbl.style, {
      position: 'fixed',
      top: labelY + 'px', left: rect.left + 'px',
      font: '9px/1 ui-monospace, Menlo, monospace',
      color: token ? '#fbbf24' : '#fff',
      background: 'rgba(20,20,30,0.92)',
      padding: '3px 6px', borderRadius: '3px',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    });

    let labelText = prop + ': ';
    if (token) {
      labelText += token;
    } else if (expectedFamily) {
      labelText += val + ' (no token)';
    } else {
      labelText += val;
    }
    lbl.textContent = labelText;
    container.appendChild(lbl);

    document.body.appendChild(container);
    overlayEl = container;
  }

  // --- DOM helpers ---

  function mkEl(tag, styles, attrs) {
    const node = document.createElement(tag);
    if (styles) Object.assign(node.style, styles);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  // --- Panel rendering ---

  let panel = null;
  let content = null;
  let api = null;
  let lastEl = null;

  function renderPanel(targetEl) {
    if (!targetEl || !content) return;
    lastEl = targetEl;
    content.innerHTML = '';

    const computed = getComputedStyle(targetEl);
    const tokens = resolveAllTokens(targetEl);
    const selector = api.getSelector(targetEl);

    // --- Selector header ---
    const headerDiv = mkEl('div', { marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)' });
    const selectorLabel = mkEl('div', { fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' });
    selectorLabel.textContent = 'SELECTOR';
    const selectorCode = mkEl('code', { fontSize: '11px', color: '#7dd3fc', wordBreak: 'break-all' });
    selectorCode.textContent = selector;
    // NYT badge
    const nytBadge = mkEl('span', {
      fontSize: '9px', fontWeight: '700', color: '#000',
      background: '#fff', padding: '1px 5px', borderRadius: '3px',
      marginLeft: '8px', verticalAlign: 'middle',
    });
    nytBadge.textContent = 'NYT';
    headerDiv.appendChild(selectorLabel);
    headerDiv.appendChild(selectorCode);
    headerDiv.appendChild(nytBadge);
    content.appendChild(headerDiv);

    // --- SPACING section ---
    content.appendChild(sectionLabel('SPACING'));
    content.appendChild(buildCross('padding', targetEl, tokens, computed));
    content.appendChild(buildCross('margin', targetEl, tokens, computed));

    // Gap — always use token step (sp family)
    const gapToken = tokens['gap'] || null;
    const gapVal = computed.getPropertyValue('gap');
    content.appendChild(buildPropRow('gap', gapToken, gapVal || '0', targetEl, 'sp'));

    // --- TYPOGRAPHY section ---
    content.appendChild(sectionLabel('TYPOGRAPHY'));

    const typProps = [
      { prop: 'font-family', family: 'nyt-font', isValue: false },
      { prop: 'font-size', family: 'ts', isValue: false },
      { prop: 'font-weight', family: null, isValue: true, step: 100 },
      { prop: 'line-height', family: 'lh', isValue: false },
      { prop: 'letter-spacing', family: 'ls', isValue: false },
      { prop: 'color', family: 'nyt-fg', isValue: false, hasColor: true },
    ];
    for (const def of typProps) {
      const token = tokens[def.prop] || null;
      const val = computed.getPropertyValue(def.prop);
      if (!val) continue;
      if (def.isValue) {
        content.appendChild(buildValueRow(def.prop, val, targetEl, def.step || 1));
      } else if (token || def.family) {
        // Has token, or has an expected family — use token step (allows scrolling through scale)
        content.appendChild(buildPropRow(def.prop, token, val, targetEl, def.family, def.hasColor));
      } else {
        content.appendChild(buildStaticRow(def.prop, val));
      }
    }

    // --- APPEARANCE section ---
    content.appendChild(sectionLabel('APPEARANCE'));

    const appProps = [
      { prop: 'background-color', label: 'background', family: 'nyt-bg', isValue: false, hasColor: true },
      { prop: 'border-radius', family: 'br', isValue: false },
      { prop: 'border-color', family: 'nyt-border', isValue: false, hasColor: true },
      { prop: 'border-width', family: 'bw', isValue: true, step: 1 },
    ];
    for (const def of appProps) {
      const token = tokens[def.prop] || null;
      const val = computed.getPropertyValue(def.prop);
      if (!val) continue;
      if (def.isValue) {
        content.appendChild(buildValueRow(def.label || def.prop, val, targetEl, def.step || 1));
      } else if (token || def.family) {
        content.appendChild(buildPropRow(def.label || def.prop, token, val, targetEl, def.family, def.hasColor));
      } else {
        content.appendChild(buildStaticRow(def.label || def.prop, truncate(val, 30)));
      }
    }

    wireTabCycling();
  }

  // --- Section label ---

  function sectionLabel(text) {
    const lbl = mkEl('div', {
      fontSize: '9px', fontWeight: '700',
      color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px',
      marginBottom: '4px', marginTop: '10px',
    });
    lbl.textContent = text;
    return lbl;
  }

  // --- Cross/Plus grid for padding/margin ---

  function buildCross(type, targetEl, tokens, computed) {
    const isPadding = type === 'padding';
    const accentColor = isPadding ? 'rgba(80,200,120,' : 'rgba(255,165,0,';

    const sides = ['top', 'right', 'bottom', 'left'];
    const tokenCount = sides.filter(s => !!tokens[`${type}-${s}`]).length;

    const wrapper = mkEl('div', { marginBottom: '10px' });

    // Label with token count
    const label = mkEl('div', {
      fontSize: '9px', fontWeight: '600', letterSpacing: '0.3px',
      color: accentColor + '0.7)', marginBottom: '4px', textAlign: 'center',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    });
    const labelText = mkEl('span');
    labelText.textContent = type;
    label.appendChild(labelText);
    const countBadge = mkEl('span', {
      fontSize: '8px', fontWeight: '600',
      color: tokenCount === 4 ? INDICATOR_TOKEN : tokenCount > 0 ? INDICATOR_RAW : 'rgba(255,255,255,0.3)',
    });
    countBadge.textContent = `${tokenCount}/4`;
    label.appendChild(countBadge);
    wrapper.appendChild(label);

    // Grid
    const grid = mkEl('div', {
      display: 'grid',
      gridTemplateColumns: '1fr auto 1fr',
      gridTemplateRows: 'auto auto auto',
      gap: '2px',
      alignItems: 'center',
      justifyItems: 'center',
      maxWidth: '220px',
      margin: '0 auto',
    });

    const positions = {
      top: { gridColumn: '2', gridRow: '1' },
      left: { gridColumn: '1', gridRow: '2' },
      right: { gridColumn: '3', gridRow: '2' },
      bottom: { gridColumn: '2', gridRow: '3' },
    };

    const stepSpans = [];

    sides.forEach(side => {
      const prop = `${type}-${side}`;
      const token = tokens[prop] || null;

      const cell = mkEl('div', positions[side]);
      const span = createTokenStep(token, prop, targetEl, 'sp', isPadding);
      stepSpans.push(span);
      cell.appendChild(span);
      grid.appendChild(cell);
    });

    // "All" center cell
    const centerCell = mkEl('div', { gridColumn: '2', gridRow: '2' });
    const allSpan = mkEl('span', {
      fontSize: '10px', minWidth: '50px', padding: '3px 6px',
      borderRadius: '4px', textAlign: 'center', cursor: 'pointer',
      outline: 'none', whiteSpace: 'nowrap',
      background: accentColor + '0.15)',
      color: accentColor + '0.9)',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0' });
    allSpan.textContent = 'all';
    allSpan.classList.add('dt-token-step', 'dt-cross-all');
    allSpan.dataset.prop = type;
    allSpan.dataset.family = 'sp';

    attachAllControl(allSpan, stepSpans, type, targetEl);
    centerCell.appendChild(allSpan);
    grid.appendChild(centerCell);

    wrapper.appendChild(grid);
    return wrapper;
  }

  function createTokenStep(token, prop, targetEl, defaultFamily, isPadding) {
    const hasToken = !!token;
    const family = hasToken ? getFamily(token) : defaultFamily;

    const span = mkEl('span', {
      fontSize: '10px', minWidth: '70px', padding: '3px 6px',
      borderRadius: '4px', textAlign: 'center', cursor: 'pointer',
      outline: 'none', whiteSpace: 'nowrap',
      color: hasToken ? '#fbbf24' : 'rgba(255,255,255,0.4)',
      background: 'rgba(251,191,36,0.08)',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0' });
    span.textContent = hasToken ? token : '0';
    span.classList.add('dt-token-step');
    span.dataset.prop = prop;
    span.dataset.token = token || '';
    span.dataset.family = family || '';

    attachTokenStepHandlers(span, targetEl);
    return span;
  }

  // --- Token step keyboard handlers ---

  function attachTokenStepHandlers(span, targetEl) {
    const prop = span.dataset.prop;

    span.addEventListener('click', (e) => { e.stopPropagation(); span.focus(); });

    span.addEventListener('focus', () => {
      span.style.background = 'rgba(251,191,36,0.22)';
      span.style.boxShadow = '0 0 0 2px rgba(251,191,36,0.6)';
      if (prop.startsWith('padding') || prop.startsWith('margin')) {
        showSpacingOverlay(prop, targetEl);
      } else {
        showPropertyOverlay(prop, targetEl);
      }
    });

    span.addEventListener('blur', () => {
      span.style.background = 'rgba(251,191,36,0.08)';
      span.style.boxShadow = '';
      clearOverlay();
    });

    span.addEventListener('mouseenter', () => {
      if (document.activeElement !== span) {
        span.style.background = 'rgba(251,191,36,0.18)';
        span.style.boxShadow = '0 0 0 1px rgba(251,191,36,0.3)';
      }
      if (prop.startsWith('padding') || prop.startsWith('margin')) {
        showSpacingOverlay(prop, targetEl);
      } else {
        showPropertyOverlay(prop, targetEl);
      }
    });

    span.addEventListener('mouseleave', () => {
      if (document.activeElement !== span) {
        span.style.background = 'rgba(251,191,36,0.08)';
        span.style.boxShadow = '';
        clearOverlay();
      }
    });

    span.addEventListener('keydown', (e) => {
      const family = span.dataset.family;
      const scale = getFamilyByName(family);

      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (scale && scale.length) {
          stepToken(span, scale, 1, targetEl);
        } else {
          stepRawPx(span, 1, targetEl, e.shiftKey);
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (scale && scale.length) {
          stepToken(span, scale, -1, targetEl);
        } else {
          stepRawPx(span, -1, targetEl, e.shiftKey);
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        resetProp(targetEl, prop);
        span.textContent = '0';
        span.style.color = 'rgba(255,255,255,0.4)';
        span.dataset.token = '';
      } else if (e.key === 'Escape') {
        span.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleControl(span, e.shiftKey);
      }
    });
  }

  function stepRawPx(span, dir, targetEl, shiftKey) {
    const prop = span.dataset.prop;
    const current = parseFloat(span.textContent) || 0;
    const step = shiftKey ? 10 : 1;
    const next = Math.max(0, current + dir * step);
    const val = next + 'px';
    span.textContent = val;
    span.style.color = '#7dd3fc';
    applyRawValue(targetEl, prop, val);
    if (prop.startsWith('padding') || prop.startsWith('margin')) {
      showSpacingOverlay(prop, targetEl);
    }
  }

  function stepToken(span, scale, dir, targetEl) {
    const currentToken = span.dataset.token;
    let idx = scale.findIndex(t => t.name === currentToken);
    if (idx < 0) idx = 0;
    idx = Math.max(0, Math.min(scale.length - 1, idx + dir));

    const token = scale[idx];
    span.dataset.token = token.name;
    span.textContent = token.name;
    span.style.color = '#fbbf24';

    const prop = span.dataset.prop;
    applyToken(targetEl, prop, token.name, currentToken);

    if (prop.startsWith('padding') || prop.startsWith('margin')) {
      showSpacingOverlay(prop, targetEl);
    }

    const row = span.closest('.dt-prop-row');
    if (row) {
      const swatch = row.querySelector('.dt-color-swatch');
      if (swatch) {
        swatch.style.background = resolveTokenColor(token.name);
      }
    }
  }

  // --- "All" center control ---

  function attachAllControl(allSpan, sideSpans, type, targetEl) {
    allSpan.addEventListener('click', (e) => { e.stopPropagation(); allSpan.focus(); });

    allSpan.addEventListener('focus', () => {
      const isPadding = type === 'padding';
      const accent = isPadding ? 'rgba(80,200,120,' : 'rgba(255,165,0,';
      allSpan.style.boxShadow = '0 0 0 2px ' + accent + '0.6)';
      showSpacingOverlay(type, targetEl);
    });

    allSpan.addEventListener('blur', () => {
      allSpan.style.boxShadow = '';
      clearOverlay();
    });

    allSpan.addEventListener('keydown', (e) => {
      const family = allSpan.dataset.family;
      const scale = getFamilyByName(family);
      if (!scale || !scale.length) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        stepAll(allSpan, sideSpans, scale, 1, type, targetEl);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        stepAll(allSpan, sideSpans, scale, -1, type, targetEl);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        ['top', 'right', 'bottom', 'left'].forEach(side => {
          resetProp(targetEl, `${type}-${side}`);
        });
        sideSpans.forEach(s => {
          s.textContent = '\u2014';
          s.style.color = 'rgba(255,255,255,0.3)';
          s.dataset.token = '';
        });
        allSpan.textContent = '\u2014';
      } else if (e.key === 'Escape') {
        allSpan.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleControl(allSpan, e.shiftKey);
      }
    });
  }

  function stepAll(allSpan, sideSpans, scale, dir, type, targetEl) {
    const refToken = sideSpans[0].dataset.token;
    let idx = scale.findIndex(t => t.name === refToken);
    if (idx < 0) idx = 0;
    idx = Math.max(0, Math.min(scale.length - 1, idx + dir));

    const token = scale[idx];
    allSpan.textContent = token.name;
    allSpan.dataset.token = token.name;

    const sides = ['top', 'right', 'bottom', 'left'];
    sideSpans.forEach((span, i) => {
      span.dataset.token = token.name;
      span.textContent = token.name;
      span.style.color = '#fbbf24';
      applyToken(targetEl, `${type}-${sides[i]}`, token.name, span.dataset.token);
    });

    showSpacingOverlay(type, targetEl);
  }

  // --- Property row builders ---

  function buildPropRow(label, token, val, targetEl, defaultFamily, hasColor) {
    const hasToken = !!token;
    const row = mkEl('div', {
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '2px 0', fontSize: '11px',
    });
    row.classList.add('dt-prop-row');

    row.appendChild(indicatorDot(hasToken));
    const nameSpan = mkEl('span', { color: 'rgba(255,255,255,0.6)', minWidth: '70px', flexShrink: '0' });
    nameSpan.textContent = label;
    row.appendChild(nameSpan);

    // Color swatch
    if (hasColor && token) {
      const swatch = mkEl('span', {
        width: '12px', height: '12px', borderRadius: '3px',
        border: '1px solid rgba(255,255,255,0.2)',
        marginLeft: 'auto', flexShrink: '0',
        background: resolveTokenColor(token),
      });
      swatch.classList.add('dt-color-swatch');
      row.appendChild(swatch);
    }

    // Token step — always steppable through the family scale
    const family = hasToken ? getFamily(token) : defaultFamily;
    const span = mkEl('span', {
      color: hasToken ? '#fbbf24' : 'rgba(255,255,255,0.5)',
      fontSize: '11px', whiteSpace: 'nowrap',
      cursor: 'pointer', padding: '4px 10px', borderRadius: '4px',
      background: 'rgba(251,191,36,0.08)', minWidth: '100px',
      textAlign: 'center', outline: 'none',
      marginLeft: hasColor ? '0' : 'auto',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0' });
    span.textContent = hasToken ? token : truncate(val, 20);
    span.classList.add('dt-token-step');
    span.dataset.token = token || '';
    span.dataset.family = family || '';

    const cssProp = label === 'background' ? 'background-color' : label;
    span.dataset.prop = cssProp;

    attachTokenStepHandlers(span, targetEl);
    row.appendChild(span);
    return row;
  }

  function buildValueRow(prop, val, targetEl, step) {
    const row = mkEl('div', {
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '2px 0', fontSize: '11px',
    });
    row.classList.add('dt-prop-row');

    row.appendChild(indicatorDot(false));
    const nameSpan = mkEl('span', { color: 'rgba(255,255,255,0.6)', minWidth: '70px', flexShrink: '0' });
    nameSpan.textContent = prop;
    row.appendChild(nameSpan);

    const input = mkEl('span', {
      color: '#7dd3fc', fontSize: '11px', whiteSpace: 'nowrap',
      cursor: 'text', padding: '4px 10px', borderRadius: '4px',
      background: 'rgba(125,211,252,0.08)', minWidth: '60px',
      textAlign: 'center', outline: 'none', marginLeft: 'auto',
      transition: 'background 0.12s, box-shadow 0.12s',
    }, { tabindex: '0', contenteditable: 'true' });
    const numVal = parseFloat(val);
    input.textContent = isNaN(numVal) ? val : numVal.toString();
    input.classList.add('dt-value-input');
    input.dataset.prop = prop;

    attachValueInputHandlers(input, targetEl, step);
    row.appendChild(input);
    return row;
  }

  function buildStaticRow(label, val) {
    const row = mkEl('div', {
      display: 'flex', gap: '6px', alignItems: 'center',
      padding: '2px 0', fontSize: '11px',
    });
    row.appendChild(indicatorDot(false));
    const nameSpan = mkEl('span', { color: 'rgba(255,255,255,0.6)', minWidth: '70px', flexShrink: '0' });
    nameSpan.textContent = label;
    const valSpan = mkEl('span', { color: 'rgba(255,255,255,0.8)', marginLeft: 'auto' });
    valSpan.textContent = truncate(val, 30);
    row.appendChild(nameSpan);
    row.appendChild(valSpan);
    return row;
  }

  // --- Value input handlers ---

  function attachValueInputHandlers(input, targetEl, step) {
    const prop = input.dataset.prop;

    input.addEventListener('focus', () => {
      input.style.background = 'rgba(125,211,252,0.18)';
      input.style.boxShadow = '0 0 0 2px rgba(125,211,252,0.6)';
      const range = document.createRange();
      range.selectNodeContents(input);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      if (!prop.startsWith('padding') && !prop.startsWith('margin')) {
        showPropertyOverlay(prop, targetEl);
      }
    });

    input.addEventListener('blur', () => {
      input.style.background = 'rgba(125,211,252,0.08)';
      input.style.boxShadow = '';
      clearOverlay();
      const val = input.textContent.trim();
      if (!val || val === '\u2014') {
        input.textContent = '\u2014';
        input.style.color = 'rgba(255,255,255,0.3)';
        resetProp(targetEl, prop);
      } else {
        input.style.color = '#7dd3fc';
        applyRawValue(targetEl, prop, val);
      }
    });

    input.addEventListener('mouseenter', () => {
      if (document.activeElement !== input) {
        input.style.background = 'rgba(125,211,252,0.15)';
        if (!prop.startsWith('padding') && !prop.startsWith('margin')) {
          showPropertyOverlay(prop, targetEl);
        }
        input.style.boxShadow = '0 0 0 1px rgba(125,211,252,0.3)';
      }
    });

    input.addEventListener('mouseleave', () => {
      if (document.activeElement !== input) {
        input.style.background = 'rgba(125,211,252,0.08)';
        input.style.boxShadow = '';
        clearOverlay();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.blur();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const val = input.textContent.trim();
        if (val && val !== '\u2014') applyRawValue(targetEl, prop, val);
        cycleControl(input, e.shiftKey);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const num = parseFloat(input.textContent);
        if (!isNaN(num)) {
          const s = e.shiftKey && step === 1 ? 10 : step;
          input.textContent = parseFloat((num + s).toFixed(2)).toString();
          applyRawValue(targetEl, prop, input.textContent);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const num = parseFloat(input.textContent);
        if (!isNaN(num)) {
          const s = e.shiftKey && step === 1 ? 10 : step;
          input.textContent = parseFloat(Math.max(0, num - s).toFixed(2)).toString();
          applyRawValue(targetEl, prop, input.textContent);
        }
      }
    });
  }

  // --- Tab cycling ---

  function wireTabCycling() {}

  function cycleControl(current, reverse) {
    const all = [...content.querySelectorAll('.dt-token-step, .dt-value-input')];
    const i = all.indexOf(current);
    if (i < 0) return;
    const next = reverse
      ? all[(i - 1 + all.length) % all.length]
      : all[(i + 1) % all.length];
    next.focus();
  }

  // --- Utility ---

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '\u2026' : str;
  }

  // --- Selection tracking ---

  function onSelectionChange() {
    const sel = api.getSelected();
    if (sel.length > 0) {
      const last = sel[sel.length - 1];
      renderPanel(last.el);
      panel.style.display = '';
    } else {
      panel.style.display = 'none';
    }
  }

  let pollInterval = null;
  let lastSelCount = 0;
  let lastSelEl = null;

  function startPolling() {
    pollInterval = setInterval(() => {
      const sel = api.getSelected();
      const curEl = sel.length > 0 ? sel[sel.length - 1].el : null;
      if (sel.length !== lastSelCount || curEl !== lastSelEl) {
        lastSelCount = sel.length;
        lastSelEl = curEl;
        onSelectionChange();
      }
    }, 150);
  }

  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  // --- Plugin registration ---

  const plugin = {
    id: 'inspector-panel-nyt',
    label: 'Inspector (NYT)',

    init(_api) {
      api = _api;
      panel = api.createPanel({
        title: 'Inspector (NYT)',
        position: { top: '80px', right: '16px' },
        width: '320px',
      });
      content = panel._content;
      Object.assign(content.style, {
        maxHeight: '60vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'none',
      });
      panel.style.display = 'none';
      injectTokenStyles();
      startPolling();
      window.DomTools._inspectorChanges = changes;
      if (api.updateBadgeCount) api.updateBadgeCount();
    },

    enable() {
      injectTokenStyles();
      startPolling();
    },

    disable() {
      stopPolling();
      clearOverlay();
      removeTokenStyles();
      if (panel) panel.style.display = 'none';
    },
  };

  if (window.DomTools) {
    window.DomTools.registerPlugin(plugin);
  } else {
    window.DomTools = window.DomTools || {};
    window.DomTools._pendingPlugins = window.DomTools._pendingPlugins || [];
    window.DomTools._pendingPlugins.push(plugin);
  }
})();
