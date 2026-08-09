import { defineConfig, devices } from '@playwright/test';

const inCi = process.env.CI === 'true';
const e2eApiUrl = 'http://127.0.0.1:18081';
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
  workers: inCi ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { outputFolder: './output/playwright/report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
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
      command: 'node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      env: { ...inheritedEnv, ZEROTRACE_API_PROXY_TARGET: e2eApiUrl },
      reuseExistingServer: !inCi,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
