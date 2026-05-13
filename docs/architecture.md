# DOM-Tools: How a Browser Toolbar Gets Built

DOM-Tools is about 3,000 lines of JavaScript that run inside any webpage. It's a floating toolbar for pointing at elements, writing down what you'd change, and copying the result as structured text for a language model or a colleague.

This post walks through how the program is structured and why each piece exists. Not as documentation — as a way to show how software gets shaped by decisions you make early, and what happens when you're deliberate about those decisions.

---

## The First Constraint: One File, Any Page

The entire tool ships as a single `<script>` tag. No package manager, no build step for the person installing it, no React, no Tailwind, no dependencies. You paste one line into your HTML and it works.

This constraint sounds small. It's not. It eliminates most of the tools professional engineers reach for — component frameworks, CSS libraries, state management systems. You have to build everything yourself, from scratch, with only what the browser gives you natively.

Why accept that constraint? Because adoption is proportional to how easy the thing is to drop in. Every dependency you add is a reason someone doesn't try your tool. Every build step is a door they have to walk through. A script tag is the lowest possible threshold — lower than an npm install, lower than a browser extension, lower than a bookmarklet.

The tradeoff: you write more code yourself. You own the rendering, the event handling, the layout. But you also *own* all of it. Nothing breaks because a dependency released a bad version. Nothing conflicts with the host page's framework. You're a guest in someone else's DOM, and guests shouldn't rearrange the furniture.

---

## Waking Up: How the Tool Knows When to Start

DOM-Tools sits completely dormant until you ask for it. When the script loads, it doesn't render anything, doesn't attach event listeners to the page, doesn't touch the DOM. It just waits.

Activation happens one of two ways: a `?dom-tools` parameter in the URL, or a double-tap of the Escape key.

Why not just load immediately? Performance. You're a guest on someone else's page. If a designer drops this script into a production site to test something, it can't slow down the page for real users. Dormant means zero overhead — no elements created, no listeners attached, no styles injected.

Why Escape? Because it's the one key that universally means "I want to talk to the system, not the content." It doesn't conflict with typing, doesn't conflict with form inputs, doesn't conflict with other tools. And double-tap is deliberate enough that you won't trigger it by accident.

This is the concept of *listening without interfering*. The script occupies space on the page, but until you wake it up, it doesn't exist from the user's perspective. That's a foundational principle: your tool should be invisible until it's wanted.

---

## Modes: Only One Thing at a Time

The toolbar has several tools: a selector (for clicking elements and writing notes), a draw tool (for sketching), a text editor (for changing copy directly), a screenshot tool. Only one can be active at any moment.

This seems obvious, but it's a critical architectural decision. When you click an element, should the selector handle that click, or should the draw tool? If both are listening, you get chaos — two tools fighting over the same interaction. Bugs from overlapping behaviors are the hardest kind to find because they only appear in specific combinations, and the combinations multiply with every new tool you add.

The rule is called *mutual exclusion*. When you activate a tool, every other tool gets explicitly deactivated. The code is blunt about it:

```
modules.forEach(m => {
  if (m.id !== activeId && m.deactivate) m.deactivate();
});
```

Every module gets told to shut down. No exceptions, no "well maybe this one can stay." Total cleanup.

The tradeoff: you can't have two tools active simultaneously. You can't draw and select at the same time. This feels limiting, but it makes the system *predictable*. A user can always answer the question "what will happen when I click?" — because only one tool is listening.

This is worth internalizing: "simple to use" often requires discipline in the code. The constraint is in the architecture so the user never has to think about it.

---

## Features as Self-Contained Modules

Each tool is its own file. And every file follows the same shape:

```
{
  id: 'draw',
  button: { icon: '...', tooltip: 'Draw', color: '#...', order: 2 },
  init() { ... },
  activate() { ... },
  deactivate() { ... },
  toggle() { ... },
}
```

That's it. `init` runs once at boot (sets up anything persistent). `activate` runs when the user selects the tool. `deactivate` runs when they switch away. The toolbar doesn't need to know what the draw tool does internally — it just calls these methods.

Why this pattern? Isolation. The draw tool doesn't know the annotations tool exists. The annotations tool doesn't know about the screenshot tool. They share no state, no event listeners, no DOM elements. If you change how drawing works, the text editor doesn't break.

This is the concept of a *module boundary*. Each file is a self-contained unit with a defined interface. The interface is the `{ id, init, activate, deactivate }` shape. As long as you implement that shape, your module works with the system.

The practical benefit: multiple people can work on the same project without stepping on each other. One person can rewrite the draw tool completely while another is adding features to annotations. They'll never create a merge conflict because they're never touching the same file.

The tradeoff: modules can't easily share behavior. If two tools need the same helper function, it has to live in a shared utility file. This creates a small amount of extra indirection. But it's a trade worth making — the alternative (tools reaching into each other's internals) creates the kind of tangled dependencies that make a codebase unmaintainable after six months.

---

## The Plugin System: Letting Others Extend Your Work

Some features don't belong in the core build. They're experimental, or niche, or large. The Morphizer (a WebGL video synth) is 900 lines of shader code. Shipping that to everyone would double the file size for a feature most people won't use.

Plugins are separate script files that load after the core:

```html
<script src="dom-tools.js"></script>
<script src="plugins/dom-xray/dom-xray.js"></script>
```

A plugin registers itself by calling `window.DomTools.registerPlugin()` with the same `{ id, init, activate, deactivate }` shape as a core module. The toolbar picks it up, adds a button, and from that point forward it works identically to a built-in feature.

Why separate them? Three reasons:

1. **Size.** The core stays small. Users only download what they use.
2. **Experimentation.** A plugin can be broken, half-finished, or weird without affecting the core. You can try ideas without risk.
3. **Extensibility.** Other people can build on your tool without touching your code. They write a plugin, load it alongside, and it integrates.

The tradeoff: you need a *contract*. The core promises "I'll give you these utilities, I'll call your init and activate methods, I'll add a toolbar button for you." The plugin promises "I'll implement this shape and clean up after myself." If either side breaks the contract, things fail.

This is the concept of an *API as a social agreement*. It's not just a technical interface — it's a promise between the author of the core and the author of the plugin. "Here's what I guarantee. Here's what I expect." The smaller and more stable that contract is, the more people can build on it without coordination.

---

## Settings and Feature Flags

Some features are hidden behind toggles. The Kid Pix clear animation, the camera tool, the experimental move-element tool — these exist in the code but are off by default. You turn them on through the settings panel.

Why not just ship everything visible? Because unfinished work that's visible is worse than unfinished work that's hidden. A half-built feature confuses users. A broken feature destroys trust. A feature that's 80% done but not ready for feedback is a liability.

Feature flags solve this. The code is there, it's deployed, it runs when enabled — but it's invisible until you deliberately flip the switch. This means:

- You can ship incomplete work without blocking other changes.
- You can test features on real pages without exposing them to everyone.
- You can let adventurous users opt-in to experimental behavior.

The implementation is simple. An array of definitions:

```
{ id: 'camera', label: 'Full-page screenshot', default: false }
```

And a single check at registration time:

```
if (isExperimentEnabled('camera')) register(camera);
```

If the flag is off, the module never registers. It never initializes, never gets a button, never exists from the user's perspective. The cost of a disabled feature is zero — not "small," zero.

This is the concept of *progressive disclosure* applied to code, not UI. You reveal capability as it becomes ready, not all at once.

---

## The Output: Structured Markdown

When you hit "Copy All," DOM-Tools collects every annotation, text edit, and class change you've made and formats it as Markdown:

```markdown
## DOM Changes

### #main-header > h1
Note: Make this 48px and bold

### .card:nth-of-type(2) > p
Text: "Learn more" → "Get started today"

### .hero
Classes:
  + py-16 text-center
  - py-8
```

Why Markdown? Because it's the lingua franca of developer tools. It renders in Slack, in GitHub, in Linear, in every LLM interface. It's readable as plain text and structured enough to parse programmatically.

Why structure it this way — one heading per element, changes listed below? Because an LLM (or a colleague) can parse structured text reliably. They can see "this element changed in these ways" without having to interpret free-form prose. Unstructured text — "I think maybe the header should be bigger and oh also that card text should change" — requires interpretation. Interpretation introduces error.

Each element gets identified by its CSS selector (`#main-header > h1`). This is the same language a developer would use to find that element in code. The output bridges the gap between "the thing I pointed at on the page" and "the thing in the codebase."

The tradeoff: selectors can be ugly. `.container > div:nth-of-type(3) > span` isn't beautiful prose. But it's unambiguous. An LLM can take that selector, find the element in the HTML, and apply the change. Ambiguity is the enemy of automation.

---

## What's Deliberately Left Out

DOM-Tools doesn't use React. It doesn't use a CSS framework. It doesn't use a state management library. It doesn't use TypeScript. Each omission is a choice.

**No framework.** Frameworks are designed for applications — complex UIs with many states, lots of user interaction, data flowing between components. DOM-Tools is a *tool*, not an application. It has a toolbar, some floating panels, and overlays. The DOM API handles that fine. Adding React would mean: a build step for plugins (they'd need JSX), a runtime cost (React's reconciler running on every interaction), and a conceptual overhead (every contributor needs to know React). The browser's `document.createElement` is ugly but universal.

**No CSS library.** DOM-Tools styles everything with inline `Object.assign(el.style, {...})`. This looks primitive. But it means the tool can never conflict with the host page's styles. If you use Tailwind classes, and the host page also uses Tailwind, your `.text-white` might not mean what you think it means. Inline styles have the highest specificity — they always win, and they never leak.

**No TypeScript.** TypeScript helps teams of 10+ engineers working on a large application. DOM-Tools is 3,000 lines written by one or two people. The type safety doesn't justify the build pipeline complexity. You'd need a compiler step, a `tsconfig`, source maps for debugging. For a project this size, reading the code is faster than reading the types.

**No state management.** The entire tool's state is one plain object: `{ enabled, altHeld, annotateMode, editMode, cameraMode }`. That's it. Five booleans. You don't need Redux for five booleans.

The principle: fewer dependencies means fewer things that can break, fewer things to update, fewer things the next person needs to learn before they can contribute. Every dependency is a bet that the maintainer will keep it working, that it won't conflict with your other dependencies, that it won't grow in a direction you don't want.

The tradeoff: you write more code yourself. The draw tool implements its own canvas handling. The toolbar implements its own drag logic. The settings panel implements its own toggle switches. But each of these is 30–50 lines of straightforward DOM manipulation. That's the kind of code anyone can read and modify without specialized knowledge.

---

## The Shape of the Whole Thing

Here's how the pieces connect, from the moment you double-tap Escape to the moment you copy your changes:

```
Double-tap Esc
  → bootDomTools()
    → register all modules (annotations, draw, style-modifier, ...)
    → renderToolbar() — create buttons for each registered module
    → boot() — call init() on every enabled module
    → activate style-modifier (the default home tool)

Click a toolbar button
  → deactivate current tool
  → activate new tool
  → update button highlight

Use the active tool (click elements, draw, edit text)
  → tool tracks its own changes internally

Hit "Copy All" (or Shift+C)
  → collect annotations from all tools
  → format as structured Markdown
  → copy to clipboard
```

Data flows in one direction: user action → tool state → output. There's no feedback loop where the output affects the input. There's no event bus where tools broadcast messages to each other. There's no global state that multiple tools read and write simultaneously.

Why does this matter? Because when something goes wrong — and something always goes wrong — you can trace the path. "I clicked an element but nothing happened" → is the tool active? → is it listening for clicks? → is the element excluded? The answer is always somewhere along a single line, not scattered across a web of interconnected systems.

This is the most important architectural principle in this entire project: **make the path from input to output traceable.** A program that's easy to debug is a program that's easy to improve. And a program that's easy to improve is a program that survives contact with the real world.

---

## What You Can Take From This

If you're building something — a prototype, a tool, a plugin — here are the decisions that mattered most:

1. **Choose your constraint early.** "One script tag, any page" shaped every decision downstream. Your constraint might be different ("works offline," "under 10KB," "no login required"), but having one forces clarity.

2. **One thing active at a time.** Mutual exclusion sounds limiting. It's actually liberating — for both the user and the developer.

3. **Same shape, every module.** `init`, `activate`, `deactivate`. When every piece follows the same pattern, adding a new piece is trivial.

4. **Separate the core from the experiments.** Ship what's ready. Gate what's not. Let people opt in.

5. **Structure your output.** Anything that will be read by another system — an LLM, an API, a colleague's script — should be predictable and parseable.

6. **Leave things out on purpose.** The things you don't add are as important as the things you do. Every dependency, every feature, every abstraction has a maintenance cost that compounds over time.

None of these are original ideas. They're just applied consistently, across a small enough codebase that you can see the full picture. That's the advantage of building something small: you can be deliberate about every choice, because there aren't enough choices to overwhelm you.
