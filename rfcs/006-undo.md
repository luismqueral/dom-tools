# RFC 006: Undo Functionality Across All Modes

## Problem

DOM-Tools currently has no undo. Once you move an element, draw a stroke, place a sticky, or edit text — the only way back is to refresh the page (losing everything) or manually reverse the change. This makes experimentation risky and the tool less forgiving.

---

## Proposed Behavior

### Core Mechanic

1. **Cmd+Z / Ctrl+Z** — Universal undo shortcut, works in all modes.

2. **Action stack** — Every mutation is pushed onto a per-session undo stack:
   - Select mode: style changes, text edits, element moves
   - Draw mode: pen strokes, sticky placements
   - Annotate mode: bubble creation/deletion, text edits within bubbles
   - Camera mode: (nothing to undo — captures are non-destructive)

3. **Redo** — Cmd+Shift+Z pops from a redo stack (cleared on any new action).

### What Constitutes an "Action"

| Mode | Undoable action |
|------|----------------|
| Select | Select/deselect, move element, style change, text edit commit |
| Draw | Single stroke (mousedown → mouseup), sticky placement, eraser stroke |
| Annotate | Bubble creation, bubble deletion, bubble text change |
| Move | DOM reorder, freeform position change |
| Canvas | Zoom/pan are NOT undoable (they're navigation, not mutation) |

### Implementation Considerations

- **DOM mutations** — Need to capture before/after state. For moves: store original `parentNode` + `nextSibling`. For style changes: store previous inline styles. For text: store previous `textContent`/`innerHTML`.
- **Draw strokes** — Each stroke is a canvas layer or SVG path. Undo = remove last path.
- **Stack limit** — Cap at ~50 actions to avoid memory bloat on long sessions.
- **Visual feedback** — Brief toast "Undid: moved <div.card>" to confirm what was reversed.

---

## Open Questions

- Should undo cross mode boundaries? (e.g., you're in Draw mode but undo a Select-mode move)
- How does undo interact with the copy queue? If you undo a text edit, does it leave the queue?
- Should there be a "history panel" showing the action stack?
- Does Kid Pix clear (Shift+Esc) push the entire state onto undo, or is it a point-of-no-return?

---

## Out of Scope

- Persistent undo across page refreshes (would require serializing full DOM diffs)
- Collaborative undo (multi-user scenarios)
- Selective undo (undo one specific action out of order)
