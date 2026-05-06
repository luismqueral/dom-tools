import terser from '@rollup/plugin-terser';

export default {
  input: 'src/index.js',
  output: [
    {
      file: 'dist/dom-tools.js',
      format: 'iife',
    },
    {
      file: 'dist/dom-tools.min.js',
      format: 'iife',
      plugins: [terser()],
    },
  ],
};
