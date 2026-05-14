# RFC 001: Send changes to Claude Code via Cmd+Enter

**Status:** Draft
**Author:** Luis Queral
**Date:** 2026-05-14

## Summary

Add a keyboard shortcut (Cmd+Enter / Ctrl+Enter) that sends all active DOM-Tools annotations directly to a running Claude Code session, bypassing the manual copy-paste step.

## Motivation

The current workflow is:

1. Annotate elements in DOM-Tools
2. Press Shift+C to copy Markdown to clipboard
3. Switch to terminal / Claude Code
4. Paste the Markdown
5. Wait for Claude to apply changes
6. Refresh the page to see results

Steps 2–4 are friction. If DOM-Tools could push directly to Claude Code, the loop becomes:

1. Annotate elements
2. Press Cmd+Enter
3. See changes applied on refresh

This makes the feedback loop feel closer to direct manipulation — you describe what you want while looking at the page, and it happens.

## User experience

### Happy path

1. User has Claude Code running in a terminal (or the desktop app) with the project open
2. User opens the page with DOM-Tools active
3. User annotates: selects elements, writes notes, edits text, draws
4. User presses **Cmd+Enter** (or clicks a "Send" button in the toolbar)
5. DOM-Tools shows a toast: "Sent to Claude Code"
6. Claude Code receives the Markdown payload as a new prompt and begins working
7. User sees a second toast or indicator when Claude Code has finished (optional, stretch)

### Edge cases

- **No Claude Code session running:** Toast with "Claude Code not detected — changes copied to clipboard instead" (graceful fallback to current behavior)
- **Multiple sessions:** Send to the most recently active session, or the one whose working directory matches the page's project
- **Large payload:** DOM-Tools already truncates selectors and keeps output lean. No change needed.
- **Mid-flight interruption:** User presses Cmd+Enter again while Claude is working — queue or ignore? (Open question)

## Technical approach

### Option A: Claude Code CLI pipe

Claude Code accepts prompts via stdin:

```bash
echo "your prompt here" | claude
```

Or with the `--print` flag for non-interactive use:

```bash
claude -p "your prompt here"
```

DOM-Tools runs in a browser — it can't invoke CLI commands directly. But if the user is running a local dev server, we could:

1. Expose a tiny local endpoint (e.g., via a Vite/Webpack plugin, or a standalone companion server) that accepts POST requests and pipes them to `claude`
2. DOM-Tools sends a fetch to `localhost:<port>/send` with the Markdown body

**Pros:** Simple, works today, no Claude Code changes needed
**Cons:** Requires a companion process; doesn't work on remote/hosted pages

### Option B: Claude Code MCP server (custom tool)

Claude Code supports MCP servers. We could build a "DOM-Tools" MCP server that:

1. Runs alongside Claude Code
2. Exposes a resource or receives tool calls
3. Listens on a local WebSocket/HTTP port for incoming payloads from the browser

When DOM-Tools sends changes, the MCP server surfaces them as a notification or resource update that Claude Code can act on.

**Pros:** Deep integration, could enable two-way communication (Claude Code → DOM-Tools feedback)
**Cons:** More complex setup; requires MCP server installation

### Option C: Native messaging / browser extension bridge

A lightweight browser extension acts as a bridge:

1. DOM-Tools dispatches a CustomEvent with the payload
2. The extension's content script catches it
3. Extension sends it via native messaging to a small binary that pipes to `claude`

**Pros:** No local server needed; works on any page
**Cons:** Requires extension installation; platform-specific native host

### Option D: Clipboard + AppleScript/automation (Mac only)

1. DOM-Tools copies to clipboard (same as today)
2. Then triggers an automation (via a `dom-tools://` protocol handler or AppleScript URL) that:
   - Focuses the Claude Code terminal
   - Pastes and submits

**Pros:** Zero infrastructure
**Cons:** Mac only; brittle; feels hacky

## Recommended approach

**Start with Option A** (local companion endpoint) as a plugin/experiment, with the CLI pipe method. It's the simplest to prototype and doesn't require any changes to Claude Code itself.

The companion could be as small as:

```js
// companion.mjs — run alongside your dev server
import { execSync } from 'child_process';
import http from 'http';

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/send-to-claude') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      try {
        execSync(`claude -p "${body.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
        res.writeHead(200).end('ok');
      } catch (e) {
        res.writeHead(500).end(e.message);
      }
    });
  } else {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.writeHead(204).end();
  }
}).listen(9877, () => console.log('DOM-Tools bridge on :9877'));
```

Then in DOM-Tools:

```js
async function sendToClaude(markdown) {
  try {
    const res = await fetch('http://localhost:9877/send-to-claude', {
      method: 'POST',
      body: markdown,
    });
    if (res.ok) toast('Sent to Claude Code');
    else throw new Error();
  } catch {
    // Fallback: copy to clipboard
    await navigator.clipboard.writeText(markdown);
    toast('Claude Code not detected — copied to clipboard');
  }
}
```

**Long-term,** explore Option B (MCP server) for richer integration — e.g., Claude Code could push back "done" status, or DOM-Tools could show a diff preview before sending.

## Open questions

1. **Prompt framing:** Should DOM-Tools prepend context like "Apply these changes to the file at [path]"? How does it know which file the page corresponds to? (Could be configured, or inferred from dev server metadata.)
2. **Confirmation step:** Should Cmd+Enter send immediately, or show a preview first? (Leaning toward immediate — the annotations *are* the preview.)
3. **Streaming feedback:** Can we show Claude Code's progress in a DOM-Tools panel? (Stretch goal, requires bidirectional communication.)
4. **Security:** The local endpoint must only accept connections from localhost. Should it require a token?
5. **Non-Claude LLMs:** Should this be generic ("send to LLM") with Claude Code as the default, or Claude-specific?

## Milestones

| Phase | Scope | Effort |
|-------|-------|--------|
| 0 | Cmd+Enter shortcut that copies + shows "send" toast (placeholder) | 1 day |
| 1 | Companion server + fetch integration (Option A) | 2–3 days |
| 2 | Package as `npx dom-tools-bridge` for easy install | 1 day |
| 3 | Explore MCP server for bidirectional (Option B) | 1 week |

## Prior art

- Figma → Cursor/Copilot plugins (screenshot-based, no structured output)
- Browser extension AI assistants (operate on page DOM, not design annotations)
- Visual Copilot (Builder.io) — converts designs to code, different mental model

DOM-Tools is unique in that the *user* articulates intent rather than an AI inferring it from pixels. The Cmd+Enter feature closes the last gap in that loop.
