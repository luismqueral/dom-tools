import { showToast, getSelector } from '../core/helpers.js';
import { getAnnotations } from './annotations.js';
import { getSelected } from './style-modifier.js';
import { getCopyButton, updateCopyBadge } from '../rail.js';

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

  // From annotations: includes notes, class diffs, and text edits.
  const annotations = getAnnotations();
  annotations.forEach(ann => {
    annotatedEls.add(ann.el);
    const { added, removed } = getClassDiff(ann.el, ann.originalClasses);
    const hasNote = ann.note && ann.note.trim().length > 0;
    const hasClassChanges = added.length > 0 || removed.length > 0;
    const hasTextChange = ann.originalText != null
      && ann.el.innerText !== ann.originalText;

    if (!hasNote && !hasClassChanges && !hasTextChange) return;

    let section = `### ${ann.selector}`;
    if (hasNote) section += `\nNote: "${ann.note.trim()}"`;
    if (hasTextChange) {
      const before = ann.originalText.replace(/\n/g, '\\n');
      const after = ann.el.innerText.replace(/\n/g, '\\n');
      section += `\nText: "${before}" → "${after}"`;
    }
    if (hasClassChanges) {
      section += '\nClasses:';
      if (added.length) section += `\n  + ${added.join(' ')}`;
      if (removed.length) section += `\n  - ${removed.join(' ')}`;
    }
    sections.push(section);
  });

  // From design-mode changes (elements without annotations)
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

function copyAllChanges() {
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
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.08)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
  }
}
