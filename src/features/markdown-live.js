/**
 * Live Markdown rendering for Text Edit mode.
 *
 * Obsidian-style "live preview": Markdown is always parsed and rendered,
 * but the token around the cursor reveals its raw syntax for editing.
 * No toggle, no animations — instant transitions.
 *
 * Supported syntax: **bold**, *italic*, ~~strike~~, `code`, [text](url)
 */

const mdStates = new WeakMap();

// --- State management --------------------------------------------------------

export function initMarkdownState(el, initialText) {
  const state = {
    source: initialText,
    tokens: [],
    renderedHTML: '',
    cursorOffset: initialText.length,
  };
  state.tokens = parse(state.source);
  mdStates.set(el, state);
  return state;
}

export function getMarkdownState(el) {
  return mdStates.get(el);
}

export function clearMarkdownState(el) {
  mdStates.delete(el);
}

export function getCurrentText(el) {
  const s = mdStates.get(el);
  return s ? s.source : el.innerText;
}

// --- Parser ------------------------------------------------------------------
// Single-pass inline tokenizer. Priority: code > bold > italic > strike > link > text

export function parse(source) {
  const tokens = [];
  let i = 0;
  let textStart = 0;

  function pushText() {
    if (i > textStart) {
      tokens.push({ type: 'text', raw: source.slice(textStart, i), content: source.slice(textStart, i), start: textStart, end: i });
    }
  }

  while (i < source.length) {
    // Inline code: `...`
    if (source[i] === '`') {
      const close = source.indexOf('`', i + 1);
      if (close !== -1) {
        pushText();
        const raw = source.slice(i, close + 1);
        tokens.push({ type: 'code', raw, content: source.slice(i + 1, close), start: i, end: close + 1 });
        i = close + 1;
        textStart = i;
        continue;
      }
    }

    // Bold: **...**
    if (source[i] === '*' && source[i + 1] === '*') {
      const close = source.indexOf('**', i + 2);
      if (close !== -1) {
        pushText();
        const raw = source.slice(i, close + 2);
        tokens.push({ type: 'bold', raw, content: source.slice(i + 2, close), start: i, end: close + 2 });
        i = close + 2;
        textStart = i;
        continue;
      }
    }

    // Strikethrough: ~~...~~
    if (source[i] === '~' && source[i + 1] === '~') {
      const close = source.indexOf('~~', i + 2);
      if (close !== -1) {
        pushText();
        const raw = source.slice(i, close + 2);
        tokens.push({ type: 'strike', raw, content: source.slice(i + 2, close), start: i, end: close + 2 });
        i = close + 2;
        textStart = i;
        continue;
      }
    }

    // Italic: *...* (but not **)
    if (source[i] === '*' && source[i + 1] !== '*') {
      const close = source.indexOf('*', i + 1);
      if (close !== -1 && source[close + 1] !== '*') {
        pushText();
        const raw = source.slice(i, close + 1);
        tokens.push({ type: 'italic', raw, content: source.slice(i + 1, close), start: i, end: close + 1 });
        i = close + 1;
        textStart = i;
        continue;
      }
    }

    // Link: [text](url)
    if (source[i] === '[') {
      const closeBracket = source.indexOf(']', i + 1);
      if (closeBracket !== -1 && source[closeBracket + 1] === '(') {
        const closeParen = source.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          pushText();
          const raw = source.slice(i, closeParen + 1);
          const content = source.slice(i + 1, closeBracket);
          const href = source.slice(closeBracket + 2, closeParen);
          tokens.push({ type: 'link', raw, content, href, start: i, end: closeParen + 1 });
          i = closeParen + 1;
          textStart = i;
          continue;
        }
      }
    }

    i++;
  }

  // Trailing text
  pushText();
  return tokens;
}

// --- Renderer ----------------------------------------------------------------

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

const SYN = 'color:rgba(130,140,155,0.7);font-weight:normal;font-style:normal';

function renderToken(t, index) {
  const c = escapeHTML(t.content);
  const attr = ` data-md-idx="${index}"`;
  switch (t.type) {
    case 'bold': return `<strong${attr}>${c}</strong>`;
    case 'italic': return `<em${attr}>${c}</em>`;
    case 'strike': return `<s${attr}>${c}</s>`;
    case 'code': return `<code${attr} style="background:rgba(0,0,0,0.06);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.9em">${c}</code>`;
    case 'link': return `<a${attr} href="${escapeHTML(t.href)}" style="color:inherit;text-decoration:underline">${c}</a>`;
    default: return escapeHTML(t.raw);
  }
}

// Render a revealed token with dimmed syntax delimiters
function renderRevealed(t) {
  const s = `<span style="${SYN}">`;
  const e = '</span>';
  const c = escapeHTML(t.content);
  switch (t.type) {
    case 'bold': return `${s}**${e}${c}${s}**${e}`;
    case 'italic': return `${s}*${e}${c}${s}*${e}`;
    case 'strike': return `${s}~~${e}${c}${s}~~${e}`;
    case 'code': return `${s}\`${e}${c}${s}\`${e}`;
    case 'link': return `${s}[${e}${c}${s}](${e}${escapeHTML(t.href)}${s})${e}`;
    default: return escapeHTML(t.raw);
  }
}

export function render(tokens, cursorOffset) {
  let html = '';
  let cursorTokenIndex = -1;

  // Find which token contains the cursor
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (cursorOffset >= t.start && cursorOffset < t.end) {
      cursorTokenIndex = i;
      break;
    }
  }
  // If cursor is at end and last token ends there, reveal it
  if (cursorTokenIndex === -1 && tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (cursorOffset === last.end && last.type !== 'text') {
      cursorTokenIndex = tokens.length - 1;
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'text') {
      html += escapeHTML(t.raw);
    } else if (i === cursorTokenIndex) {
      html += renderRevealed(t);
    } else {
      html += renderToken(t, i);
    }
  }

  return { html, cursorTokenIndex };
}

// --- Cursor mapping ----------------------------------------------------------

// Convert DOM cursor position to source offset.
// Strategy: get a flat "DOM text offset" by walking text nodes, then
// convert it to source offset using the token map (rendered tokens
// contribute content.length in DOM but raw.length in source).
export function sourceOffsetFromDOM(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const nodeOffset = range.startOffset;

  const mdState = mdStates.get(el);
  if (!mdState) return 0;

  // Step 1: compute flat DOM text offset (counting <br> as 1 char each)
  let domOffset = 0;

  if (node === el) {
    // Selection on element itself — child index
    for (let i = 0; i < nodeOffset && i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeName === 'BR') domOffset += 1;
      else domOffset += (child.textContent || '').length;
    }
  } else {
    // Walk all nodes (text + elements) in tree order to count offset
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
    let current = walker.nextNode();
    while (current) {
      if (current === node) {
        domOffset += nodeOffset;
        break;
      }
      if (current.nodeName === 'BR') {
        domOffset += 1;
      } else if (current.nodeType === 3) {
        domOffset += current.textContent.length;
      }
      // Skip element nodes themselves (only count their text children)
      if (current.nodeType === 1 && current.nodeName !== 'BR') {
        // Don't count — we'll count its children as we descend
      }
      current = walker.nextNode();
    }
  }

  // Step 2: convert DOM offset to source offset using tokens
  return domOffsetToSource(domOffset, mdState.tokens, mdState.cursorOffset);
}

// Map a flat DOM text offset to a source offset.
// In the rendered DOM:
//   - Revealed token (cursor inside): shows raw text → maps 1:1
//   - Rendered token: shows only content → occupies content.length in DOM
//     but raw.length in source
//   - Text tokens: map 1:1
function domOffsetToSource(domOffset, tokens, cursorOffset) {
  let domPos = 0;
  let sourcePos = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Must match render() reveal logic: cursorOffset >= start && < end
    const isRevealed = t.type !== 'text' &&
      cursorOffset >= t.start && cursorOffset < t.end;
    // DOM length of this token
    const domLen = (t.type === 'text' || isRevealed) ? t.raw.length : t.content.length;

    if (domOffset < domPos + domLen) {
      // Cursor is within this token
      const localOffset = domOffset - domPos;
      if (t.type === 'text' || isRevealed) {
        return t.start + localOffset;
      } else {
        // Inside rendered content — map to after opening delimiter
        const delimLen = t.raw.indexOf(t.content);
        return t.start + delimLen + localOffset;
      }
    }

    domPos += domLen;
    sourcePos = t.end;
  }

  return sourcePos;
}

// Place cursor at a given source offset, accounting for rendered HTML
export function placeCursorAtSourceOffset(el, sourceOffset, tokens) {
  // Convert source offset to DOM text offset
  const targetDOMOffset = sourceToDomOffset(sourceOffset, tokens);

  // Walk all nodes (text + BR) to place the cursor
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
  let accumulated = 0;
  let current = walker.nextNode();
  while (current) {
    if (current.nodeName === 'BR') {
      if (accumulated === targetDOMOffset) {
        // Place cursor right before the BR
        const sel = window.getSelection();
        const range = document.createRange();
        const parent = current.parentNode;
        const idx = Array.from(parent.childNodes).indexOf(current);
        range.setStart(parent, idx + 1);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      accumulated += 1;
    } else if (current.nodeType === 3) {
      const len = current.textContent.length;
      if (accumulated + len >= targetDOMOffset) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.setStart(current, targetDOMOffset - accumulated);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      accumulated += len;
    }
    current = walker.nextNode();
  }

  // Fallback: place at end
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// Convert source offset to the flat DOM text offset.
// The render was done with `sourceOffset` as the cursorOffset,
// so the token containing sourceOffset is revealed (shown raw in DOM).
// Must match the render function's reveal logic: cursorOffset >= start && < end.
function sourceToDomOffset(sourceOffset, tokens) {
  let domOffset = 0;

  for (const t of tokens) {
    // Is this token revealed? Must match render() logic exactly.
    const isRevealed = t.type !== 'text' &&
      sourceOffset >= t.start && sourceOffset < t.end;

    if (sourceOffset >= t.start && sourceOffset < t.end) {
      // Cursor is within this token — add local offset
      domOffset += (sourceOffset - t.start);
      return domOffset;
    }

    // Past this token — add its full DOM contribution
    const domLen = (t.type === 'text' || isRevealed) ? t.raw.length : t.content.length;
    domOffset += domLen;
  }

  return domOffset;
}

// --- Source mutation from InputEvent ------------------------------------------

export function applyInputToSource(state, inputType, data, cursorOffset, event, selLength = 0) {
  const src = state.source;
  // End of selection range — for insert operations, selected text gets replaced
  const selEnd = cursorOffset + selLength;

  switch (inputType) {
    case 'insertText':
      state.source = src.slice(0, cursorOffset) + (data || '') + src.slice(selEnd);
      state.cursorOffset = cursorOffset + (data || '').length;
      break;
    case 'insertParagraph':
    case 'insertLineBreak':
      state.source = src.slice(0, cursorOffset) + '\n' + src.slice(selEnd);
      state.cursorOffset = cursorOffset + 1;
      break;
    case 'deleteContentBackward':
      if (selLength > 0) {
        state.source = src.slice(0, cursorOffset) + src.slice(selEnd);
        state.cursorOffset = cursorOffset;
      } else if (cursorOffset > 0) {
        state.source = src.slice(0, cursorOffset - 1) + src.slice(cursorOffset);
        state.cursorOffset = cursorOffset - 1;
      }
      break;
    case 'deleteContentForward':
      if (selLength > 0) {
        state.source = src.slice(0, cursorOffset) + src.slice(selEnd);
        state.cursorOffset = cursorOffset;
      } else if (cursorOffset < src.length) {
        state.source = src.slice(0, cursorOffset) + src.slice(cursorOffset + 1);
        state.cursorOffset = cursorOffset;
      }
      break;
    case 'deleteWordBackward': {
      if (selLength > 0) {
        state.source = src.slice(0, cursorOffset) + src.slice(selEnd);
        state.cursorOffset = cursorOffset;
      } else {
        let pos = cursorOffset - 1;
        while (pos > 0 && src[pos - 1] === ' ') pos--;
        while (pos > 0 && src[pos - 1] !== ' ') pos--;
        state.source = src.slice(0, pos) + src.slice(cursorOffset);
        state.cursorOffset = pos;
      }
      break;
    }
    case 'deleteWordForward': {
      if (selLength > 0) {
        state.source = src.slice(0, cursorOffset) + src.slice(selEnd);
        state.cursorOffset = cursorOffset;
      } else {
        let pos = cursorOffset;
        while (pos < src.length && src[pos] !== ' ') pos++;
        while (pos < src.length && src[pos] === ' ') pos++;
        state.source = src.slice(0, cursorOffset) + src.slice(pos);
        state.cursorOffset = cursorOffset;
      }
      break;
    }
    case 'insertFromPaste':
    case 'insertFromDrop': {
      const text = event && event.dataTransfer
        ? event.dataTransfer.getData('text/plain')
        : (data || '');
      state.source = src.slice(0, cursorOffset) + text + src.slice(selEnd);
      state.cursorOffset = cursorOffset + text.length;
      break;
    }
    case 'deleteByCut': {
      // For cut with selection, we need the selection bounds.
      // The cursorOffset represents the start; we estimate end from
      // the selected text length via the event's target ranges.
      const sel = window.getSelection();
      if (sel.rangeCount && !sel.isCollapsed) {
        const selText = sel.toString();
        // Find the selection in source near the cursor
        const idx = src.indexOf(selText, Math.max(0, cursorOffset - selText.length));
        if (idx !== -1) {
          state.source = src.slice(0, idx) + src.slice(idx + selText.length);
          state.cursorOffset = idx;
          break;
        }
      }
      state.cursorOffset = cursorOffset;
      break;
    }
    case 'historyUndo':
    case 'historyRedo':
      // Let browser handle or ignore — we don't support undo yet
      state.cursorOffset = cursorOffset;
      break;
    default:
      state.cursorOffset = cursorOffset;
      break;
  }
}
