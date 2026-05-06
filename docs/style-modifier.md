# Style Modifier

## The Idea

The Style Modifier closes the gap between *describing* a UI change and *making* one.

Today, when working with an LLM on interface design, the loop looks like:

1. You describe what you want ("make this heading larger, add more padding")
2. The LLM writes CSS or utility classes
3. You refresh, check, describe corrections
4. Repeat

The Style Modifier collapses steps 1-3 into a single interaction: you click an element, tweak its classes live, see the result immediately, then hand the final class list to the LLM (or commit it directly). You become the designer *and* the implementer in one gesture.

---

## How It Works

### Activation
Click the pink paintbrush button in the toolbar (or activate via the Settings panel). The tool enters a mode where clicking any element opens its class editor.

### The Panel

When you click an element, a floating panel appears anchored to it:

- **Class chips** — every class on the element displayed as a removable tag. Click `×` to strip a class instantly.
- **Autocomplete input** — type any substring to search ~500 built-in Tailwind utilities plus custom NYT design tokens. Arrow keys navigate, Enter adds. The class applies live.
- **Reset** — restores the element's classes to whatever they were when you first clicked it.
- **Copy** — puts the current class string on your clipboard, ready to paste into code or hand to an LLM.

### Live Preview

Every addition or removal is applied to the DOM immediately. There's no "apply" step. You see the layout shift, color change, or spacing adjustment the instant you act. This is the core value: **you iterate at the speed of thought**, not the speed of a build pipeline.

### No Tailwind Required

The modifier doesn't depend on Tailwind CSS being loaded on the page. It manipulates class *strings* on elements. If Tailwind (or any utility framework) is loaded, you'll see visual results. If not, you're still building the correct class list for when it is.

This means you can use it on:
- A static HTML page with no CSS framework (prep classes for later)
- A page with Tailwind loaded (full live preview)
- A page with custom utility classes (add your own tokens)

---

## The Class Library

The built-in autocomplete includes:

| Category | Examples |
|----------|----------|
| Layout | `flex`, `grid`, `block`, `hidden`, `relative`, `absolute`, `sticky` |
| Spacing | `p-4`, `mx-auto`, `mt-8`, `gap-6` |
| Sizing | `w-full`, `h-screen`, `max-w-xl`, `min-h-0` |
| Typography | `text-xl`, `font-bold`, `leading-tight`, `tracking-wide` |
| Color | `text-gray-700`, `bg-blue-50`, `border-red-500` |
| Borders | `rounded-lg`, `border-2`, `border-dashed` |
| Effects | `shadow-md`, `opacity-50`, `blur` |
| Transforms | `scale-105`, `rotate-3`, `translate-y-2` |
| **NYT Tokens** | `font-franklin`, `font-cheltenham`, `text-nyt-dim`, `bg-nyt-alt`, `border-nyt-rule` |

The list is intentionally curated to the ~500 most-used utilities. It's not the full Tailwind config (which has 10,000+ variants). The goal is fast recall, not exhaustive coverage.

---

## Extending the Class List

The class library lives as a `CLASSES` array at the top of `src/features/style-modifier.js`. To add your own tokens:

```js
const CLASSES = [
  // ... existing utilities ...

  // Your custom design system tokens
  'your-custom-class',
  'another-token',
];
```

Rebuild with `npm run build` and they're available in autocomplete.

---

## Where This Goes Next

The Style Modifier is a foundation. Some directions it can evolve:

### 1. Computed Style Inspector
Show not just classes but the *resolved* CSS properties. "This element is `16px` font-size, `24px` line-height, `#333` color" — bridging the gap between utility classes and actual rendered values.

### 2. Class Diffing
When you click "Copy", instead of the full class list, output a *diff* from the original: `+ p-8 + text-xl - p-4 - text-sm`. This is more useful as an LLM prompt — it shows intent, not just final state.

### 3. Multi-Element Batch
Select multiple elements (shift-click, like the existing multi-select), then apply the same class additions/removals to all of them at once. Useful for "make all these cards have the same padding."

### 4. Variant Support
Add responsive and state prefixes: type `sm:` or `hover:` before a class. The modifier would add `sm:text-lg` or `hover:bg-gray-100` as the full class string.

### 5. Design Token Discovery
Instead of a static array, scan the page's loaded stylesheets for custom properties and utility classes. Auto-populate the autocomplete with what's *actually available* in this project.

### 6. Undo Stack
Track every change as a reversible operation. Cmd+Z steps back one class addition/removal at a time, rather than resetting everything.

### 7. Export as Patch
Instead of copying a class string, generate a code patch: "In `src/components/Header.jsx`, line 12, change `className="p-4 text-sm"` to `className="p-8 text-xl"`." This makes the LLM handoff zero-friction.

### 8. Visual Property Controls
For common properties (padding, margin, font-size, color), show sliders or swatches instead of requiring you to know the exact class name. Click a color swatch → applies `bg-blue-500`. Drag a slider → cycles through `p-1` to `p-12`.

---

## Philosophy

The Style Modifier is built on a belief: **designers should be able to touch the material directly**.

Utility-first CSS (Tailwind, Tachyons, etc.) already moved styling closer to the markup. The Style Modifier moves it one step further — into the browser, into the live page, into the designer's hands. No file-switching, no rebuild, no "can you make it a little more..." feedback loops.

The copy-to-clipboard output is designed to feed back into an LLM workflow. You modify, you copy, you paste into Claude: "Apply these classes to the header component." The LLM doesn't need to guess what you want — you've already shown it.
