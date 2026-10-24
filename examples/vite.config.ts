import vue from '@vitejs/plugin-vue';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  // A base path when the examples are served from a folder.
  base: process.env.EXAMPLES_BASE ?? '/',
  plugins: [vue()],
  resolve: {
    conditions: ['@kumochart-sdk/source', ...defaultClientConditions]
  },
  build: {
    rolldownOptions: {
      input: ['index.html', 'vanilla.html', 'vue.html', 'react.html', 'test.html', 'bench.html']
    }
  },
  server: {
    port: 5180
  }
});
