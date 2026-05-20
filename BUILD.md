# Build System

DOM-Tools compiles from ES modules into a single self-executing script. The entire tool — toolbar, drawing canvas, text editor, zoom engine, annotation system — ships as one `<script>` tag with zero runtime dependencies.

## Output

| File | Size | Purpose |
|------|------|---------|
| `dist/dom-tools.js` | ~106 KB | Production. Minified via terser, single line of code. |
| `dist/dom-tools.dev.js` | ~228 KB | Development. Readable, unminified, same code. |

Only `dom-tools.js` ships to production (deployed to `queral.studio/dom-tools.js`).

## Toolchain

- **Bundler:** Rollup 4 — chosen for its tree-shaking and clean IIFE output. No Webpack, no Vite.
- **Minifier:** @rollup/plugin-terser — runs only on the production output.
- **Format:** IIFE (Immediately Invoked Function Expression) — no module loader needed. The script self-executes on load.
- **Dependencies:** Zero runtime deps. The only npm packages are build tools (`rollup`, `@rollup/plugin-terser`). `ws` exists for the optional dev bridge server, not the build.

## Commands

```bash
npm run build    # One-shot production + dev build
npm run dev      # Watch mode — rebuilds on source change
```

## Source Structure

```
src/
├── index.js              Entry point. Boots the tool, registers modules.
├── toolbar.js            Pill-shaped floating toolbar renderer.
├── keyboard.js           Global keyboard shortcut dispatcher.
├── settings.js           Experiment flags, settings panel UI.
├── core/
│   ├── state.js          Shared mutable state (active tool, zoom level, etc.)
│   ├── constants.js      Colors, z-index layers.
│   ├── helpers.js        getSelector, showToast, copyText, DOM utilities.
│   ├── registry.js       Module activation/deactivation lifecycle.
│   ├── theme.js          Selection color system.
│   ├── fonts.js          Dynamic font loader (IBM Plex Mono).
│   ├── lifecycle.js      beforeunload guard for unsaved changes.
│   └── plugin-api.js     Public API exposed to external plugins.
└── features/
    ├── style-modifier.js Select tool — click/drag to select, leave notes.
    ├── edit-mode.js       Text Edit tool — click to edit inline.
    ├── markdown-live.js   Live Markdown parser/renderer for text editing.
    ├── annotations.js     Annotation data model, bubbles, badges.
    ├── draw.js            Freehand drawing canvas.
    ├── canvas-zoom.js     Figma-style zoom & pan (CSS transforms).
    ├── camera.js          Screenshot tool (html2canvas).
    ├── copy-all.js        "Copy All Changes" serializer.
    ├── copy-selector.js   Quick CSS selector copy.
    ├── move.js            Cmd+drag element reordering.
    ├── duplicate.js       Shift+drag element duplication.
    ├── sticky-notes.js    Floating sticky note tool.
    └── terminal.js        Dev terminal overlay.
```

7,300 lines of source → 106 KB minified. No CSS files, no HTML templates, no assets. All styles are inline JS objects. All SVG icons are inline strings.

## How Rollup processes it

1. Starts at `src/index.js`
2. Follows all `import` statements, pulling in every module
3. Tree-shakes unused exports (though most modules are side-effect-heavy, so shaking is minimal)
4. Wraps everything in an IIFE: `(function() { ... })()`
5. For production: terser minifies variable names, removes whitespace, collapses code to ~24 lines
6. Prepends the banner comment (version, build timestamp, URL)

The terser config preserves comments matching `DOM-Tools`, `@preserve`, `@license`, or `!` — so the banner survives minification but internal JSDoc does not.

## CI/CD Pipeline

On every push to `main` that touches `src/`, `build/`, or `package.json`:

1. GitHub Action runs (`publish-build.yml`)
2. `npm ci` installs build tools
3. `npm run build` produces fresh `dist/dom-tools.js`
4. Action pushes `dist/dom-tools.js` → `luismqueral/studio-queral` repo's `public/` folder
5. Vercel auto-deploys studio-queral, making the new build live at `queral.studio/dom-tools.js`

The action can also be triggered manually via `workflow_dispatch`.

**dist files are not committed to branches.** The build only runs in CI. This eliminates merge conflicts on `dist/` between feature branches.

## Why this setup

- **One file, no loader.** Users add a single `<script>` tag. No import maps, no bundler config on their end, no CORS issues with multiple chunks.
- **No framework.** Everything is vanilla DOM manipulation. No React, no virtual DOM, no reactivity system. This keeps the output small and the boot instant.
- **IIFE isolation.** The tool injects into arbitrary pages. IIFE ensures nothing leaks to global scope except the explicit `window.DomTools` API and `window.bootDomTools`.
- **Terser only.** No Babel, no polyfills, no source maps in production. The tool targets modern browsers only (Chrome/Edge/Safari/Firefox, last 2 versions).

## Adding a new feature module

1. Create `src/features/my-feature.js`
2. Export a module spec: `{ id, label, button, init(), activate(), deactivate() }`
3. Import and `register()` it in `src/index.js`
4. Run `npm run build` to verify
5. Push to main — CI handles the rest
