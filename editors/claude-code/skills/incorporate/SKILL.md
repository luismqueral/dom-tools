---
description: "Integrate DOM-Tools into a web project for in-browser design annotation and structured UI feedback. Use when the user asks to add, install, configure, or incorporate DOM-Tools."
argument-hint: "[target project or integration requirements]"
allowed-tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]
---

# Incorporate DOM-Tools

Integrate DOM-Tools into the current web project while following its existing
framework, dependency, environment, and security conventions.

## Guardrails

- Treat DOM-Tools as development tooling. Keep it out of production unless the
  user explicitly requests production use and the host project's policies allow
  it.
- Do not weaken Content Security Policy, add an external script origin, expose a
  development route, or change deployment configuration without explaining the
  impact and obtaining confirmation.
- The canonical hosted build is
  `https://queral.studio/dom-tools.js`. This is an externally hosted executable
  script. It is mutable and unpinned, and it executes with the host page's
  origin privileges. Check the target project's policy before using it.
- If external scripts are not allowed, prefer an approved vendored artifact or
  internal hosting. Build vendored artifacts from a reviewed commit and retain
  their provenance. Do not invent an internal URL, checksum, or package name.
- Do not configure the experimental Claude bridge. DOM-Tools already copies
  structured Markdown for the user to paste into an agent.
- Warn the user that copied output can contain page text, selectors, edits, and
  annotations. They must review it before pasting and exclude restricted,
  personal, unpublished, or production data.
- Make the smallest coherent change. Do not replace the project's framework,
  bundler, development server, or dependency-management conventions.

## Workflow

### 1. Inspect the target project

Identify:

- the framework and build tool;
- the global HTML or document entry point;
- how the project distinguishes development from production;
- existing patterns for loading development-only scripts;
- Content Security Policy or other script-loading restrictions;
- tests, linting, and build commands relevant to the changed files.

Read only the files needed to establish these facts. If there are multiple
applications or no clear target, ask the user which application to modify.

### 2. Choose an installation strategy

Use this order of preference:

1. The project's existing development-only script-loading convention.
2. A conditional framework component or layout hook that runs only in
   development.
3. A conditional script tag in the global HTML document.
4. An approved vendored build when external scripts are prohibited.

For a plain HTML project, this is the script markup:

```html
<script src="https://queral.studio/dom-tools.js" defer></script>
```

The markup is not development-only by itself. Place it behind the project's
existing development environment guard. Do not add it unconditionally to an
application that produces a production build.

For a single-page application, loading the script is usually sufficient.
DOM-Tools can also be started explicitly after the application mounts:

```js
window.bootDomTools?.();
```

Call this only when automatic activation is unsuitable. The boot function is
idempotent.

### 3. Protect host controls

Add `data-dt-ignore` only to application elements that should not be selected or
included in DOM-Tools output, such as development-only launch controls:

```html
<button data-dt-ignore>Open development tools</button>
```

Do not broadly place the attribute on application roots or content the user
needs to inspect.

### 4. Implement

Before editing, summarize:

- the selected insertion point;
- how production exclusion is enforced;
- whether the hosted script, a vendored artifact, or internal hosting is used;
- any CSP or deployment implication.

If the plan requires a security-sensitive policy change, stop for confirmation.
Otherwise, make the integration and update nearby developer documentation when
the activation path would not be discoverable.

### 5. Verify

Run the narrowest existing checks that cover the modified files, then verify:

1. The production path does not load DOM-Tools by default.
2. The development page loads without console or build errors.
3. DOM-Tools activates with either:
   - `?dom-tools` in the page URL; or
   - two presses of `Escape` within 400 ms.
4. The toolbar appears and page elements can be selected.
5. `Shift+C` or **Copy All Changes** copies structured Markdown.
6. Elements marked `data-dt-ignore` are excluded.
7. Copied Markdown has been reviewed for sensitive page data before it is
   pasted into an agent.

If browser automation is unavailable, report the exact manual checks instead of
claiming they passed.

### 6. Hand off

Report:

- files changed;
- installation strategy and environment guard;
- verification performed;
- any CSP, external-hosting, or deployment follow-up;
- the user workflow:
  1. open the development page;
  2. activate DOM-Tools;
  3. select elements and leave annotations;
  4. press `Shift+C`;
  5. paste the copied Markdown into the coding-agent session.

Arguments supplied with the command:

`$ARGUMENTS`
