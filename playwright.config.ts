import { defineConfig, devices } from '@playwright/test';

const url = 'http://127.0.0.1:4180';

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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: {
    command:
      'npm run build:examples && npm run preview -w examples -- --host 127.0.0.1 --port 4180 --strictPort',
    url,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
