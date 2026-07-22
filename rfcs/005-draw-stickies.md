# RFC 005: Stickies in Draw Mode & Drawing as Input

## Problem

Draw mode currently only supports freehand pen strokes. Annotations (stickies) live in a separate Annotate mode. But the natural workflow is: draw a circle around something, slap a sticky next to it, take a screenshot — and use all of that as input for an LLM or collaborator. Splitting drawing and annotation across modes creates friction.

---

## Proposed Behavior

### Stickies in Draw Mode

1. **Sticky tool in brush panel** — Add a sticky-note option alongside pen/color controls in Draw mode. Clicking it switches the draw cursor to a sticky placement cursor.

2. **Place and type** — Click anywhere to drop a sticky. It opens immediately for text input. Stickies placed in Draw mode behave like Annotate stickies but aren't anchored to a specific DOM element — they're positional (x, y on the viewport).

3. **Visual distinction** — Draw-mode stickies could have a slightly different appearance (e.g., no anchor line to an element) to distinguish them from element-bound annotations.

### Drawing + Annotation + Screenshot = Input

4. **Composite capture** — When the user takes a screenshot (Camera mode) while Draw strokes and stickies are visible, the output should include:
   - The screenshot image (with drawings baked in)
   - Structured text of all sticky contents with their approximate positions
   - This becomes a rich input package for LLM consumption

### Copy Output

```
[VISUAL FEEDBACK]
Screenshot: (attached image)
Annotations:
  - Sticky at (top-left area): "This spacing feels too tight"
  - Sticky at (near hero image): "Replace with product photo"
  - Drawing: circle around navigation area
```

---

## Open Questions

- Should stickies in Draw mode support rich text or just plain?
- How do positional stickies interact with Canvas mode zoom?
- Should there be a "capture all as input" one-click action?
- Do draw-mode stickies persist across mode switches or are they ephemeral?

---

## Out of Scope

- Converting freehand drawings to shapes (circles, arrows)
- Handwriting recognition
- Real-time collaboration on drawings
