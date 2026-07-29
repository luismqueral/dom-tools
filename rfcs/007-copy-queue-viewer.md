# RFC 007: Copy Queue Viewer

## Problem

DOM-Tools silently accumulates changes (annotations, text edits, style modifications) into a copy queue. The user has no visibility into what's queued, can't review or edit individual items, and can't remove a stale entry without clearing everything. The "Copy All" action is a black box.

---

## Proposed Behavior

### UI Pattern

1. **Expand/collapse panel** — A small arrow or count badge near the Copy button. Clicking it reveals a scrollable list of queued changes.

2. **Queue entries** — Each entry shows:
   - Icon indicating type (annotation, text edit, style change, move, screenshot)
   - Brief summary (e.g., "Annotation on `<h1>`: 'Make this bigger'")
   - Timestamp or order number
   - Delete (×) button to remove individual entries

3. **Collapsed state** — Shows just a count badge: "4 changes queued"

4. **Expanded state** — Slides up from the toolbar or appears as a side panel. Scrollable, max height ~50% viewport.

### Interactions

- **Click an entry** — Scrolls to and highlights the related element on the page
- **Delete entry** — Removes from queue with brief undo toast
- **Drag to reorder** — Optional: let users control output order
- **Clear all** — Button at bottom of panel, with confirmation

### Copy Output Integration

- "Copy All" uses the queue order shown in the viewer
- User can select specific entries to copy (checkbox multi-select)

---

## Open Questions

- Where does the panel live? Attached to toolbar? Floating? Slide-over?
- Should entries be grouped by element or shown chronologically?
- How does this interact with Canvas mode (zoomed out view)?
- Should there be a "preview output" that shows the final Markdown before copying?

---

## Out of Scope

- Editing entry content inline in the viewer (edit at the source element instead)
- Sharing/exporting queue as a file
- Queue persistence across page refreshes
