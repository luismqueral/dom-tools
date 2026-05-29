# RFC 004: "Add" Functionality — Insert Elements into the DOM

## Problem

Currently DOM-Tools lets you select, annotate, move, and style existing elements — but there's no way to say "I want to add something here." Users need to express insertion intent: a new paragraph between two sections, a button inside a card, a divider between blocks. Without this, the tool can only describe changes to what already exists.

---

## Proposed Behavior

### Activation

1. **Add mode** — A new toolbar mode (or sub-mode of Select) that changes the cursor to an insertion indicator.

2. **Insertion point detection** — As the user hovers, DOM-Tools highlights valid insertion points:
   - Between sibling elements (horizontal line/caret between blocks)
   - Inside empty containers
   - Before/after the hovered element (top/bottom edge proximity)

3. **Click to place** — Clicking an insertion point opens a small palette or prompt:
   - Quick-add options: paragraph, heading, image placeholder, divider, button
   - Freeform: type what you want (natural language → captured as intent in the copy output)

### Copy Output

The insertion is recorded in the change queue as:
```
[ADD] After <section.hero>:
  "Add a call-to-action button with text 'Get Started'"
```

### Constraints

- No actual DOM mutation required (this is about capturing *intent*)
- Should work with the copy queue so the intent is communicated to an LLM or developer
- Edge cases: deeply nested elements, tables, flex/grid containers need clear affordances for where "between" means

---

## Open Questions

- Should Add mode allow dragging a bounding box to indicate size/area?
- Should there be preset "component" templates (card, nav item, list entry)?
- How does this interact with Canvas mode zoom levels?
- Should the natural language input have autocomplete or suggestions?

---

## Out of Scope

- Actually rendering the new element in the DOM (that's the LLM's job)
- Complex multi-element insertion (e.g., "add an entire form here")
