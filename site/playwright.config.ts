import { defineConfig, devices } from '@playwright/test';

/** The site of the test pages, built and previewed on this port. */
const port = Number(process.env.DOCS_E2E_PORT ?? 4188);
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: url,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run preview -- --outDir .cache/e2e --host 127.0.0.1 --port ${port} --strictPort`,
    env: { DOCS_DIR: 'site/test/fixtures/docs', DOCS_OUT_DIR: '.cache/e2e' },
    url: `${url}/zh-CN/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
