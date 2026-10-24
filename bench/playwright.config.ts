import { defineConfig, devices } from '@playwright/test';

const url = 'http://127.0.0.1:4180';

/** Benchmarks in a real browser: `npm run bench`. */
export default defineConfig({
  testDir: '.',
  testMatch: '*.bench.ts',
  timeout: 300_000,
  reporter: 'list',
  use: { baseURL: url, ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
  webServer: {
    command:
      'npm run build:examples && npm run preview -w examples -- --host 127.0.0.1 --port 4180 --strictPort',
    url,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
