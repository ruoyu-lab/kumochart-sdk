import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const sourceConditions = ['@kumo-charts/source'];

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { conditions: sourceConditions },
        test: {
          name: 'core',
          root: 'packages/core',
          environment: 'jsdom',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.node.test.ts'],
          setupFiles: ['test/setup.ts']
        }
      },
      {
        resolve: { conditions: sourceConditions },
        test: {
          name: 'core-node',
          root: 'packages/core',
          environment: 'node',
          include: ['test/**/*.node.test.ts']
        }
      },
      {
        plugins: [vue()],
        resolve: { conditions: sourceConditions },
        test: {
          name: 'vue',
          root: 'packages/vue',
          environment: 'jsdom',
          include: ['test/**/*.test.ts'],
          setupFiles: ['../core/test/setup.ts']
        }
      },
      {
        resolve: { conditions: sourceConditions },
        test: {
          name: 'react',
          root: 'packages/react',
          environment: 'jsdom',
          include: ['test/**/*.test.ts'],
          setupFiles: ['../core/test/setup.ts']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/types.ts', 'packages/*/src/index.ts'],
      thresholds: {
        statements: 80,
        branches: 62,
        functions: 78,
        lines: 80
      }
    }
  }
});
