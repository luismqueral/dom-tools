/**
 * Copy-all-changes serializer.
 *
 * Produces a Markdown summary of every tracked change on the page,
 * structured so it pastes cleanly into Slack / Linear / a PR comment.
 * Two top-level shapes:
 *   - Group note: one note attached to 2+ elements. Lists every
 *     selector under a "Group of N" header.
 *   - Per-element block: one heading per element, with all of that
 *     element's changes (note, text diff, class diff) merged
 *     together so the reader sees a single coherent edit per item
 *     instead of the same selector duplicated three times.
 */

import { showToast, getSelector, copyText } from '../core/helpers.js';
import { getAnnotations } from './annotations.js';
import { getSelected } from './style-modifier.js';
import { getCopyButton } from '../toolbar.js';

// --- Diff helpers --------------------------------------------------------

function classDiff(currentClasses, originalClasses) {
  const origSet = new Set((originalClasses || '').trim().split(/\s+/).filter(Boolean));
  const currSet = new Set((currentClasses || '').trim().split(/\s+/).filter(Boolean));
  const added = [...currSet].filter(c => !origSet.has(c));
  const removed = [...origSet].filter(c => !currSet.has(c));
  return { added, removed };
}

// Decide between an inline diff ("a" → "b") and a multi-line block
// based on whether either side has a newline or is long enough that
// inline becomes unreadable.
function isShortText(s) {
  return !s.includes('\n') && s.length <= 80;
}

function formatTextDiff(before, after) {
  if (isShortText(before) && isShortText(after)) {
    return `Text: "${before}" → "${after}"`;
  }
  // Multi-line: indent each line by 2 spaces so it nests under the
  // section header in Markdown without becoming a code block.
  const indent = (s) => s.split('\n').map(l => '  ' + l).join('\n');
  return `Text:\n  Before:\n${indent(before)}\n  After:\n${indent(after)}`;
}

function formatClassDiff(added, removed) {
  const lines = ['Classes:'];
  if (added.length) lines.push('  + ' + added.join(' '));
  if (removed.length) lines.push('  - ' + removed.join(' '));
  return lines.join('\n');
}

// --- Build per-element + group-note views over getAnnotations() -----

function buildOutput() {
  const annotations = getAnnotations();
  const selected = getSelected();

  // Per-element accumulator. Single-element notes, text edits, and
  // class diffs all collapse into one entry per element so the
  // reader doesn't see the same selector three times.
  const perEl = new Map(); // el → { selector, note?, textDiff?, classDiff? }
  const groupNotes = [];   // { selectors, note }

  function ensureEntry(el) {
    let e = perEl.get(el);
    if (!e) {
      e = { el, selector: getSelector(el) };
      perEl.set(el, e);
    }
    return e;
  }

  annotations.forEach(item => {
    if (item.kind === 'note') {
      const note = (item.note || '').trim();
      if (!note) return;
      if (item.els.length > 1) {
        groupNotes.push({ selectors: item.selectors, note });
      } else {
        ensureEntry(item.els[0]).note = note;
      }
    } else if (item.kind === 'text') {
      const el = item.el;
      const before = item.originalText;
      const after = el.innerText;
      const textChanged = after !== before;
      const { added, removed } = classDiff(el.className, item.originalClasses);
      const classesChanged = added.length || removed.length;
      if (!textChanged && !classesChanged) return;
      const entry = ensureEntry(el);
      if (textChanged) entry.textDiff = { before, after };
      if (classesChanged) entry.classDiff = { added, removed };
    }
  });

  // Live class diffs for elements currently selected by the Comment
  // tool — picked up so a user can copy mid-edit without first
  // clicking away. Skip elements already covered by a text annotation
  // (they already have a classDiff entry).
  selected.forEach(({ el, originalClasses }) => {
    if (el.className === originalClasses) return;
    const { added, removed } = classDiff(el.className, originalClasses);
    if (!added.length && !removed.length) return;
    const entry = ensureEntry(el);
    if (!entry.classDiff) entry.classDiff = { added, removed };
  });

  // --- Render ----------------------------------------------------------
  const sections = [];

  groupNotes.forEach(g => {
    const lines = [`### Group of ${g.selectors.length}`];
    g.selectors.forEach(s => lines.push(`- ${s}`));
    lines.push(`Note: ${g.note}`);
    sections.push(lines.join('\n'));
  });

  perEl.forEach(entry => {
    const lines = [`### ${entry.selector || '(no selector)'}`];
    if (entry.note) lines.push(`Note: ${entry.note}`);
    if (entry.textDiff) lines.push(formatTextDiff(entry.textDiff.before, entry.textDiff.after));
    if (entry.classDiff) lines.push(formatClassDiff(entry.classDiff.added, entry.classDiff.removed));
    if (lines.length === 1) return; // selector with nothing to say — skip
    sections.push(lines.join('\n'));
  });

  if (!sections.length) return null;
  return '## DOM Changes\n\n' + sections.join('\n\n');
}

// --- Public ---------------------------------------------------------------

export async function copyAllChanges() {
  const output = buildOutput();
  if (!output) {
    showToast('No changes to copy');
    return;
  }
  const ok = await copyText(output);
  showToast(ok ? 'All changes copied' : 'Could not copy changes');
}

export function initCopyAll() {
  const btn = getCopyButton();
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyAllChanges();
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#333'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#222'; });
  }
}
