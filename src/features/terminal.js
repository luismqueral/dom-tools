/**
 * Mock Terminal experiment.
 *
 * Toggled from Settings → Experiments. When enabled, a toolbar button
 * appears; clicking it opens a draggable, resizable terminal overlay
 * with a fake shell prompt that echoes commands. Pure UI experiment —
 * nothing actually executes.
 */

import { inspectorUI } from '../core/state.js';
import { Z } from '../core/constants.js';
import { showToast } from '../core/helpers.js';
import { getSelectionColor, withAlpha } from '../core/theme.js';

let termEl = null;
let inputEl = null;
let outputEl = null;
let visible = false;
let history = [];
let historyIdx = -1;

const PROMPT = '<span style="color:#10b981">guest@dom-tools</span><span style="color:#888">:</span><span style="color:#3b82f6">~</span><span style="color:#888">$</span> ';

const MOCK_FS = {
  '/': ['home', 'usr', 'etc', 'var', 'tmp'],
  '/home': ['guest'],
  '/home/guest': ['notes.txt', 'projects', '.bashrc'],
  '/home/guest/projects': ['dom-tools', 'sketches'],
};

const MOCK_FILES = {
  '/home/guest/notes.txt': 'Remember to ship the annotation feature.\nAlso: fix that z-index bug.',
  '/home/guest/.bashrc': '# .bashrc\nexport PATH="$PATH:/usr/local/bin"\nalias ll="ls -la"',
};

let cwd = '/home/guest';

function resolvePath(p) {
  if (!p || p === '~') return '/home/guest';
  if (p.startsWith('~/')) p = '/home/guest/' + p.slice(2);
  if (!p.startsWith('/')) {
    p = cwd === '/' ? '/' + p : cwd + '/' + p;
  }
  const parts = p.split('/').filter(Boolean);
  const resolved = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  return '/' + resolved.join('/');
}

function runCommand(cmd) {
  const parts = cmd.trim().split(/\s+/);
  const bin = parts[0];
  const args = parts.slice(1);

  if (!bin) return '';

  switch (bin) {
    case 'help':
      return 'Available commands: help, echo, pwd, cd, ls, cat, clear, whoami, date, uname';
    case 'echo':
      return args.join(' ');
    case 'pwd':
      return cwd;
    case 'whoami':
      return 'guest';
    case 'uname':
      return 'DomToolsOS 1.0.0 mock-kernel';
    case 'date':
      return new Date().toString();
    case 'cd': {
      const target = resolvePath(args[0]);
      if (MOCK_FS[target]) { cwd = target; return ''; }
      return `cd: ${args[0] || ''}: No such file or directory`;
    }
    case 'ls': {
      const target = args[0] ? resolvePath(args[0]) : cwd;
      const entries = MOCK_FS[target];
      if (!entries) return `ls: cannot access '${args[0] || target}': No such file or directory`;
      return entries.join('  ');
    }
    case 'cat': {
      if (!args[0]) return 'cat: missing operand';
      const target = resolvePath(args[0]);
      if (MOCK_FILES[target]) return MOCK_FILES[target];
      return `cat: ${args[0]}: No such file or directory`;
    }
    case 'clear':
      return '\x00CLEAR';
    default:
      return `${bin}: command not found`;
  }
}

function appendOutput(html) {
  outputEl.innerHTML += html;
  outputEl.scrollTop = outputEl.scrollHeight;
}

function handleInput(cmd) {
  appendOutput(`<div style="white-space:pre-wrap">${PROMPT}<span style="color:#e2e8f0">${escapeHtml(cmd)}</span></div>`);
  const result = runCommand(cmd);
  if (result === '\x00CLEAR') {
    outputEl.innerHTML = '';
  } else if (result) {
    appendOutput(`<div style="white-space:pre-wrap;color:#cbd5e1">${escapeHtml(result)}</div>`);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createTerminal() {
  termEl = document.createElement('div');
  Object.assign(termEl.style, {
    position: 'fixed',
    bottom: '80px',
    right: '20px',
    width: '480px',
    height: '320px',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '8px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    zIndex: String(Z.toolbar + 2),
    display: 'none',
    flexDirection: 'column',
    fontFamily: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    fontSize: '12px',
    overflow: 'hidden',
    resize: 'both',
    minWidth: '320px',
    minHeight: '200px',
  });

  const titleBar = document.createElement('div');
  Object.assign(titleBar.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    background: '#161b22',
    borderBottom: '1px solid #30363d',
    cursor: 'grab',
    userSelect: 'none',
    gap: '8px',
  });

  const dots = document.createElement('div');
  dots.innerHTML = '<span style="width:10px;height:10px;border-radius:50%;background:#ff5f57;display:inline-block;margin-right:6px"></span>'
    + '<span style="width:10px;height:10px;border-radius:50%;background:#febc2e;display:inline-block;margin-right:6px"></span>'
    + '<span style="width:10px;height:10px;border-radius:50%;background:#28c840;display:inline-block"></span>';

  const titleText = document.createElement('span');
  titleText.textContent = 'terminal — guest@dom-tools:~';
  Object.assign(titleText.style, { color: '#8b949e', fontSize: '11px', flex: '1', textAlign: 'center' });

  const closeBtn = document.createElement('span');
  closeBtn.textContent = '×';
  Object.assign(closeBtn.style, { color: '#8b949e', fontSize: '16px', cursor: 'pointer', lineHeight: '1' });
  closeBtn.addEventListener('click', () => hideTerminal());

  titleBar.appendChild(dots);
  titleBar.appendChild(titleText);
  titleBar.appendChild(closeBtn);

  outputEl = document.createElement('div');
  Object.assign(outputEl.style, {
    flex: '1',
    overflow: 'auto',
    padding: '8px 12px',
    color: '#c9d1d9',
    lineHeight: '1.5',
  });
  outputEl.innerHTML = '<div style="color:#8b949e;margin-bottom:8px">Welcome to dom-tools mock terminal. Type "help" for commands.</div>';

  const inputRow = document.createElement('div');
  Object.assign(inputRow.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px 10px',
    borderTop: '1px solid #21262d',
    gap: '0',
  });

  const promptLabel = document.createElement('span');
  promptLabel.innerHTML = PROMPT;
  Object.assign(promptLabel.style, { flexShrink: '0', whiteSpace: 'nowrap' });

  inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.setAttribute('data-dt-allow-select', '');
  Object.assign(inputEl.style, {
    flex: '1',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#e2e8f0',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    caretColor: getSelectionColor(),
  });

  inputEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const cmd = inputEl.value;
      if (cmd.trim()) {
        history.push(cmd);
        historyIdx = history.length;
      }
      handleInput(cmd);
      inputEl.value = '';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIdx > 0) {
        historyIdx--;
        inputEl.value = history[historyIdx];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx < history.length - 1) {
        historyIdx++;
        inputEl.value = history[historyIdx];
      } else {
        historyIdx = history.length;
        inputEl.value = '';
      }
    }
  });

  inputRow.appendChild(promptLabel);
  inputRow.appendChild(inputEl);

  termEl.appendChild(titleBar);
  termEl.appendChild(outputEl);
  termEl.appendChild(inputRow);

  // Drag by title bar
  let dragging = false, dx = 0, dy = 0;
  titleBar.addEventListener('mousedown', (e) => {
    if (e.target === closeBtn) return;
    dragging = true;
    const rect = termEl.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;
    titleBar.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    termEl.style.left = (e.clientX - dx) + 'px';
    termEl.style.top = (e.clientY - dy) + 'px';
    termEl.style.right = 'auto';
    termEl.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    titleBar.style.cursor = 'grab';
  });

  // Click inside terminal focuses input
  termEl.addEventListener('click', (e) => {
    if (e.target !== closeBtn) inputEl.focus();
  });

  document.body.appendChild(termEl);
  inspectorUI.add(termEl);
}

function showTerminal() {
  if (!termEl) createTerminal();
  termEl.style.display = 'flex';
  visible = true;
  setTimeout(() => inputEl.focus(), 0);
}

function hideTerminal() {
  if (termEl) termEl.style.display = 'none';
  visible = false;
}

export function toggleTerminal() {
  if (visible) hideTerminal();
  else showTerminal();
}

export default {
  id: 'terminal',
  label: 'Terminal',
  experiment: true,
  enabledByDefault: true,

  button: {
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v12zM7 10l4 3-4 3v-6zm5 5h5v2h-5v-2z"/></svg>',
    tooltip: 'Terminal',
    color: '#10b981',
    order: 12,
  },

  init() {},
  activate() { showTerminal(); },
  deactivate() {},
  toggle() { toggleTerminal(); return visible; },
  enable() {},
  disable() { hideTerminal(); },
};
