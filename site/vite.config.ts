import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { defaultClientConditions, defineConfig } from 'vite';
import { docsPlugin } from './build/plugin';

const examples = resolve(import.meta.dirname, 'src/examples');

export default defineConfig({
  root: import.meta.dirname,
  appType: 'mpa',
  plugins: [
    // The documentation, or the pages of the tests with DOCS_DIR=site/test/fixtures/docs.
    docsPlugin({ docsDir: process.env.DOCS_DIR ?? 'docs' }),
    vue()
  ],
  resolve: {
    conditions: ['@kumochart-sdk/source', ...defaultClientConditions],
    alias: [
      { find: '@docs/data', replacement: resolve(examples, 'data.ts') },
      // In the live examples a chart created without a theme follows the site's theme.
      { find: /^@kumochart-sdk\/core$/, replacement: resolve(examples, 'core.ts') }
    ]
  },
  build: {
    outDir: process.env.DOCS_OUT_DIR ?? 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5186
  },
  preview: {
    port: 4186
  }
});
