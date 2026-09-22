# DOM-Tools Claude Code plugin

Adds `/dom-tools:incorporate`, a guided workflow for integrating
[DOM-Tools](https://github.com/luismqueral/dom-tools) into a web project.

The skill:

- detects the target project's framework and document entry point;
- installs DOM-Tools using the project's existing development conventions;
- keeps the integration out of production by default;
- accounts for Content Security Policy and externally hosted script risks;
- verifies activation and explains the annotation-to-agent workflow.

## Local development

From the DOM-Tools repository root:

```bash
claude --plugin-dir editors/claude-code
```

Then run:

```text
/dom-tools:incorporate
```

Run the command from the web project you want to modify. Optional requirements
can follow the command, for example:

```text
/dom-tools:incorporate add it to the Vite app, development only
```

## Marketplace installation

Once registered in the NYT Claude Code Marketplace:

```text
/plugin marketplace update nytimes-claude-code-marketplace
/plugin install dom-tools@nytimes-claude-code-marketplace
/reload-plugins
```

The marketplace registration belongs in
`.claude-plugin/marketplace-externals.json` in
`nytimes/claude-code-marketplace`:

```json
{
  "name": "dom-tools",
  "description": "Integrate DOM-Tools into web projects for in-browser design annotation and structured UI feedback.",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/luismqueral/dom-tools.git",
    "path": "editors/claude-code",
    "ref": "main"
  },
  "category": "development"
}
```

Use the NYT Self Service release of Claude Code and update it before testing;
older releases may not support `git-subdir` marketplace sources. After adding
the entry, run `make prep` in the marketplace repository and commit both
`marketplace-externals.json` and the generated `marketplace.json`.

## Security

The default hosted build, `https://queral.studio/dom-tools.js`, is mutable,
unpinned JavaScript that executes with the host page's origin privileges. Do
not load it in an NYT application unless that source and deployment model have
been approved. Projects that require a pinned dependency should use an
approved, vendored artifact built from a reviewed commit or an internally
hosted equivalent.

DOM-Tools can copy selected page text, selectors, edits, and annotations to the
clipboard. Review the copied Markdown before pasting it into an agent, and do
not include restricted, personal, unpublished, or production data.

## Maintenance

Changes to this plugin must bump the version in
`.claude-plugin/plugin.json`.
