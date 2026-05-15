import terser from '@rollup/plugin-terser';

const now = new Date().toISOString();
const banner = `/**
 * DOM-Tools v1.1.0
 * Built: ${now}
 * Drop-in design toolbar for any webpage.
 * https://github.com/luismqueral/dom-tools
 */`;

export default {
  input: 'src/index.js',
  output: [
    {
      file: 'dist/dom-tools.js',
      format: 'iife',
      banner,
      plugins: [terser({ format: { comments: /^!|@preserve|@license|DOM-Tools/ } })],
    },
    {
      file: 'dist/dom-tools.dev.js',
      format: 'iife',
      banner,
    },
  ],
};
