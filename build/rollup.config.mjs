import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const now = new Date().toISOString();
const banner = `/**
 * DOM-Tools v1.1.0
 * Built: ${now}
 * Drop-in design toolbar for any webpage.
 * https://github.com/luismqueral/dom-tools
 */`;

// Collect all plugin files from plugins/*/
function loadPlugins() {
  const pluginsDir = 'plugins';
  const dirs = readdirSync(pluginsDir).filter(d =>
    statSync(join(pluginsDir, d)).isDirectory()
  );
  return dirs.map(d => {
    const file = join(pluginsDir, d, `${d}.js`);
    try {
      return readFileSync(file, 'utf8');
    } catch { return null; }
  }).filter(Boolean);
}

// Rollup plugin that appends bundled plugins after the main IIFE
function appendPlugins() {
  const plugins = loadPlugins();
  return {
    name: 'append-plugins',
    renderChunk(code) {
      if (!plugins.length) return null;
      return code + '\n' + plugins.join('\n');
    },
  };
}

export default {
  input: 'src/index.js',
  plugins: [
    replace({ __BUILD_DATE__: JSON.stringify(now), preventAssignment: true }),
  ],
  output: [
    {
      file: 'dist/dom-tools.js',
      format: 'iife',
      banner,
      plugins: [appendPlugins(), terser({ format: { comments: /^!|@preserve|@license|DOM-Tools/ } })],
    },
    {
      file: 'dist/dom-tools.dev.js',
      format: 'iife',
      banner,
      plugins: [appendPlugins()],
    },
  ],
};
