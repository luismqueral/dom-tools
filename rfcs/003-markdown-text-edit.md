# RFC 003: Markdown Support in Text Edit Mode

## Problem

Text Edit mode currently treats all input as plain text. When a user types Markdown syntax (e.g. `**bold**`, `_italic_`, `## Heading`), it's stored and displayed verbatim. There's no way to express rich formatting intent without manually writing HTML tags — which is clunky and error-prone for non-developers.

The copied prompt output also lacks any indication of formatting intent, so the receiving LLM can't distinguish between "I literally want asterisks around this word" and "I want this word bold."

---

## Proposed Behavior

### Editing Experience

1. **Live preview toggle** — A small button (e.g. `M↓` or a Markdown icon) appears in the editing toolbar/bubble when a text element is active in Edit Text mode. Clicking it enables Markdown interpretation for that element.

2. **Inline rendering** — While Markdown mode is active for an element:
   - As the user types, recognized Markdown syntax renders in real-time (bold, italic, links, headings, lists, inline code).
   - The element's `innerHTML` is updated with the rendered HTML.
   - A faint monospace "source" indicator (or subtle syntax highlighting in the raw chars) helps the user see they're in Markdown mode vs. plain text.

3. **Source/preview toggle** — The user can switch between seeing the raw Markdown source and the rendered preview. This avoids the "can't edit what I can't see" problem once syntax is converted.

4. **Scoped to block elements** — Markdown mode is available only on block-level text elements (`p`, `h1`–`h6`, `li`, `blockquote`, `div` with only text content). Inline elements (`span`, `a`, `strong`) stay plain-text only — they're too small/contextual for full Markdown.

5. **Exit behavior** — When the user clicks away or deactivates Edit Text mode:
   - The final rendered HTML is committed to the DOM (same as current behavior for plain edits).
   - The raw Markdown source is stored alongside in the `textEdits` map for the copy output.

---

### Data Model Changes

Extend the `textEdits` Map entry:

```javascript
// Current
textEdits: Map<Element, { originalText, originalClasses }>

// Proposed
textEdits: Map<Element, {
  originalText,
  originalClasses,
  markdown: string | null,  // raw Markdown source (null = plain text edit)
}>
```

When `markdown` is non-null, the copy output uses it instead of diffing `innerText`.

---

### Copy Output Format

#### Plain text edit (unchanged)
```
### main > section > p:nth-of-type(3)
Text: "Hello world" → "Hello everyone"
```

#### Markdown edit (new)
```
### main > section > p:nth-of-type(3)
Text (Markdown):
  Before: "Hello world"
  After (raw): "Hello **everyone**, welcome to the _new_ site"
  Rendered: "Hello <strong>everyone</strong>, welcome to the <em>new</em> site"
```

This gives the receiving LLM both the intent (Markdown source) and the result (rendered HTML), so it can reproduce the change in whatever templating system the project uses.

---

### Supported Syntax (v1)

Keep scope tight — support only the subset that makes sense for inline content editing:

| Syntax | Renders as |
|--------|-----------|
| `**bold**` or `__bold__` | `<strong>bold</strong>` |
| `*italic*` or `_italic_` | `<em>italic</em>` |
| `~~strikethrough~~` | `<del>strikethrough</del>` |
| `` `code` `` | `<code>code</code>` |
| `[text](url)` | `<a href="url">text</a>` |
| `# Heading` (only if element is a heading tag) | Adjusts heading level |
| `- item` or `1. item` (only if element is a list) | `<li>` within existing list |

**Explicitly excluded from v1:**
- Images (`![]()`) — use the existing annotation workflow
- Tables — too complex for inline editing
- Code blocks (triple backtick) — not relevant to most text elements
- Horizontal rules — structural, not text

---

## Interaction Details

### Activation

```
User clicks text element in Edit Text mode
  → Element becomes contentEditable (existing behavior)
  → Markdown toggle button appears (floating near element or in a mini-toolbar)
  → Default: plain text mode (no change from today)
  → User clicks toggle → Markdown mode activates for this element
```

### While Editing (Markdown active)

- **Keystroke flow**: `input` event → parse raw text as Markdown → update `innerHTML` with rendered output → preserve cursor position.
- **Cursor preservation**: After replacing innerHTML, restore the caret to the equivalent text offset. This is the hardest UX challenge — use a character-offset approach (count characters from start of text content, reapply after render).
- **Escaping**: If the user wants literal asterisks, they can use backslash escaping (`\*not bold\*`) — standard Markdown behavior.

### Switching Between Source and Preview

Two modes within Markdown editing:

1. **Source mode** (default when first activated): Element shows raw Markdown text, monospace font, with subtle syntax coloring. User types freely.
2. **Preview mode**: Element shows rendered HTML. User can still type — keystrokes go into the source buffer and re-render.

Toggle via a small `</>` button next to the Markdown toggle. Source mode is recommended for editing; preview mode for checking the result before committing.

### Deactivation

```
User clicks away or switches tools
  → If Markdown mode was active:
    1. Final render pass: source → HTML
    2. Store { markdown: rawSource } in textEdits entry
    3. Set element innerHTML to rendered HTML
    4. Remove Markdown toggle UI
  → If plain text mode: existing behavior unchanged
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| User enables Markdown on element that already has rich HTML | Parse existing HTML back to Markdown (best-effort via turndown or similar), populate source buffer |
| User disables Markdown mid-edit | Keep current innerHTML as-is, clear `markdown` field from tracking — treat as plain text edit going forward |
| Element is too small for Markdown (single word, `<span>`) | Toggle button doesn't appear |
| User pastes Markdown-formatted text | If Markdown mode is active, parse and render. If plain text mode, paste as-is (current behavior) |
| Undo (Cmd+Z) | Undo should work on the source buffer, not the rendered output. May require custom undo stack |

---

## Implementation Plan

### Phase 1: Parser Integration
- Add a lightweight Markdown parser. Options:
  - **marked** (~7kb min+gz) — full-featured, well-maintained
  - **micromark** (~14kb) — spec-compliant, modular
  - **Custom minimal parser** (~2kb) — only handles the v1 subset above
- Recommendation: custom minimal parser for bundle size. DOM-Tools is a single-file bookmarklet-style tool — adding 7-14kb of Markdown parser is proportionally large. The v1 syntax subset is simple enough to handle with regex.

### Phase 2: Editing UX
- Build the source/preview toggle UI
- Implement cursor preservation after re-render
- Handle the Markdown toggle button appearance/disappearance

### Phase 3: Data Flow
- Extend `textEdits` map entries with `markdown` field
- Update `setElementText()` to accept markdown source
- Update `evaluateAnnotation()` to compare against markdown source

### Phase 4: Copy Output
- Update `copy-all.js` `formatTextDiff()` to handle markdown entries
- Include both raw source and rendered HTML in output
- Add "(Markdown)" label to the section heading

### Phase 5: Polish
- Keyboard shortcut to toggle Markdown mode (e.g. `Cmd+M` while editing)
- Visual indicator when Markdown mode is active (subtle border color change or icon)
- Undo/redo support for source buffer

---

## Open Questions

1. **Should Markdown mode be the default?** Current proposal has it opt-in per element. Could also be a global setting in the Settings panel ("Always use Markdown in Text Edit").

2. **Live render vs. commit-on-blur?** Live rendering is more impressive but harder (cursor preservation). Commit-on-blur is simpler — user types raw Markdown, sees rendered result only after clicking away. Tradeoff: less immediate feedback vs. much simpler implementation.

3. **How to handle existing rich HTML?** If a paragraph already has `<strong>` and `<em>` tags, should enabling Markdown mode reverse-parse them to `**` and `*`? This requires an HTML-to-Markdown converter (turndown, ~5kb).

4. **Bundle size budget?** DOM-Tools is currently loaded as a single script. How much additional weight is acceptable for this feature?

5. **Should the copy output include the full rendered HTML, or just the Markdown source with a note?** Full HTML is more explicit but verbose. Just the source is cleaner but requires the LLM to know Markdown.
