import { showToast, getSelector } from '../core/helpers.js';
import { getAnnotations } from './annotations.js';
import { getSelected } from './style-modifier.js';
import { getCopyButton, updateCopyBadge } from '../toolbar.js';

// Compute class diffs between original and current
function getClassDiff(el, originalClasses) {
  const origSet = new Set(originalClasses.trim().split(/\s+/).filter(Boolean));
  const currSet = new Set(el.className.trim().split(/\s+/).filter(Boolean));
  const added = [...currSet].filter(c => !origSet.has(c));
  const removed = [...origSet].filter(c => !currSet.has(c));
  return { added, removed };
}

function buildOutput() {
  const sections = [];
  const annotatedEls = new Set();

  // Annotations from the store come in two kinds:
  //   - 'note': a group of 1+ elements sharing one note
  //   - 'text': a single-element text edit (silent on-page; only here)
  // A single element may appear in both (e.g. you grouped it AND edited
  // its text); we render them as separate sections for clarity.
  const annotations = getAnnotations();
  annotations.forEach(item => {
    if (item.kind === 'note') {
      if (!item.note || !item.note.trim()) return;
      const header = item.selectors.length > 1
        ? `### Group of ${item.selectors.length}\n${item.selectors.map(s => `  - ${s}`).join('\n')}`
        : `### ${item.selectors[0]}`;
      let section = header;
      section += `\nNote: "${item.note.trim()}"`;
      sections.push(section);
      item.els.forEach(el => annotatedEls.add(el));
    } else if (item.kind === 'text') {
      const el = item.el;
      const hasTextChange = el.innerText !== item.originalText;
      const { added, removed } = getClassDiff(el, item.originalClasses);
      const hasClassChanges = added.length > 0 || removed.length > 0;
      if (!hasTextChange && !hasClassChanges) return;

      let section = `### ${item.selector}`;
      if (hasTextChange) {
        const before = item.originalText.replace(/\n/g, '\\n');
        const after = el.innerText.replace(/\n/g, '\\n');
        section += `\nText: "${before}" → "${after}"`;
      }
      if (hasClassChanges) {
        section += '\nClasses:';
        if (added.length) section += `\n  + ${added.join(' ')}`;
        if (removed.length) section += `\n  - ${removed.join(' ')}`;
      }
      sections.push(section);
      annotatedEls.add(el);
    }
  });

  // Live class diffs from the current selection — picked up so a user
  // who's mid-edit can copy without first deselecting.
  const selected = getSelected();
  selected.forEach(({ el, originalClasses }) => {
    if (annotatedEls.has(el)) return;
    if (el.className === originalClasses) return;

    const { added, removed } = getClassDiff(el, originalClasses);
    if (!added.length && !removed.length) return;

    const selector = getSelector(el);
    let section = `### ${selector}`;
    section += '\nClasses:';
    if (added.length) section += `\n  + ${added.join(' ')}`;
    if (removed.length) section += `\n  - ${removed.join(' ')}`;
    sections.push(section);
  });

  if (!sections.length) return null;
  return '## DOM Changes\n\n' + sections.join('\n\n');
}

export function copyAllChanges() {
  const output = buildOutput();
  if (!output) {
    showToast('No changes to copy');
    return;
  }
  navigator.clipboard.writeText(output).then(() => {
    showToast('All changes copied');
  }).catch(() => {
    showToast(output.substring(0, 100) + '...');
  });
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
