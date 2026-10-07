import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/arc-task-ledger', open: 'never' }],
  ],
  use: { baseURL: 'http://127.0.0.1:5178', trace: 'retain-on-failure' },
  projects: [
    { name: 'arc-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'arc-mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      cwd,
      command: 'node --import tsx tests/arc-task-ledger/e2e/server.ts',
      url: 'http://127.0.0.1:8088/readyz',
      reuseExistingServer: false,
      timeout: 60000,
      env: { ARC_PUBLIC_ORIGIN: 'http://127.0.0.1:5178' },
    },
    {
      cwd,
      command:
        'node node_modules/vite/bin/vite.js apps/arc-task-ledger-web --host 127.0.0.1 --port 5178',
      url: 'http://127.0.0.1:5178',
      reuseExistingServer: false,
      timeout: 60000,
      env: { ARC_API_PROXY: 'http://127.0.0.1:8088' },
    },
  ],
});
