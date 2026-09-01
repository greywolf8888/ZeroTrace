import { defineConfig, devices } from '@playwright/test';

const inCi = process.env.CI === 'true';
const configuredWorkers = Number.parseInt(process.env.ZEROTRACE_E2E_WORKERS ?? '', 10);
const e2eWorkers =
  Number.isInteger(configuredWorkers) && configuredWorkers > 0
    ? configuredWorkers
    : inCi || process.platform === 'win32'
      ? 2
      : undefined;
const configuredWebPort = Number.parseInt(process.env.ZEROTRACE_E2E_WEB_PORT ?? '', 10);
const e2eWebPort =
  Number.isInteger(configuredWebPort) && configuredWebPort >= 1024 && configuredWebPort <= 65_535
    ? configuredWebPort
    : 14_173;
const e2eApiUrl = 'http://127.0.0.1:18081';
const e2eWebUrl = `http://127.0.0.1:${e2eWebPort}`;
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const isolatedApiEnv = {
  ...inheritedEnv,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  ALCHEMY_API_KEY: '',
  ETH_RPC_URL: '',
  EVM_ETHEREUM_RPC_URL: '',
  EVM_ETHEREUM_RPC_URLS: '',
  BSC_RPC_URL: '',
  EVM_BSC_RPC_URL: '',
  EVM_BSC_RPC_URLS: '',
  BTC_ESPLORA_URL: '',
  BITCOIN_ESPLORA_URL: '',
  BITCOIN_ESPLORA_URLS: '',
  SOLANA_RPC_URL: '',
  SOLANA_RPC_URLS: '',
  POSTGRES_URL: '',
  CLICKHOUSE_URL: '',
  CLICKHOUSE_USERNAME: '',
  CLICKHOUSE_PASSWORD: '',
  OBJECT_STORE_ENDPOINT: '',
  OBJECT_STORE_ACCESS_KEY: '',
  OBJECT_STORE_SECRET_KEY: '',
  OBJECT_STORE_BUCKET: '',
};

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './output/playwright/test-results',
  fullyParallel: true,
  forbidOnly: inCi,
  retries: inCi ? 1 : 0,
  // Chromium context teardown becomes unreliable when Playwright expands to the host CPU count on
  // Windows (24 logical CPUs produced 12 concurrent browsers and widespread timeout-only failures).
  // Keep local Windows runs aligned with CI while allowing an explicit, evidence-backed override.
  workers: e2eWorkers,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  snapshotPathTemplate: '{testDir}/visual-golden/{arg}{ext}',
  reporter: [['list'], ['html', { outputFolder: './output/playwright/report', open: 'never' }]],
  use: {
    baseURL: e2eWebUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/src/server.js',
      url: `${e2eApiUrl}/health/live`,
      env: { ...isolatedApiEnv, API_PORT: '18081' },
      reuseExistingServer: !inCi,
      timeout: 60_000,
    },
    {
      command: `node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${e2eWebPort}`,
      url: e2eWebUrl,
      env: { ...inheritedEnv, ZEROTRACE_API_PROXY_TARGET: e2eApiUrl },
      reuseExistingServer: !inCi,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'chromium-desktop',
      testIgnore: /visual-golden\.spec\.ts/u,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'chromium-mobile',
      testIgnore: /visual-golden\.spec\.ts/u,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'chromium-visual',
      testMatch: /visual-golden\.spec\.ts/u,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
