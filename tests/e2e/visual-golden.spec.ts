import { expect, test, type Browser, type Page } from '@playwright/test';

import type {
  HealthResponse,
  ProviderHealth,
  ResearchSourceSettingsResponse,
} from '../../apps/web/src/generated-api/client.js';

const fixedAt = '2026-08-31T00:00:00.000Z';

function provider(index: number): ProviderHealth {
  const ledgers = ['EVM', 'BITCOIN', 'SOLANA'] as const;
  const statuses = ['UP', 'DEGRADED', 'RATE_LIMITED', 'UNCONFIGURED'] as const;
  const status = statuses[index % statuses.length] ?? 'UNCONFIGURED';
  return {
    id: `visual-source-${String(index + 1).padStart(2, '0')}`,
    ledger: ledgers[index % ledgers.length] ?? 'EVM',
    status,
    capabilities: status === 'UNCONFIGURED' ? [] : ['READ_ONLY_HEAD'],
    checkedAt: fixedAt,
    latencyMs: status === 'UP' ? 48 + index : null,
    head:
      status === 'UP'
        ? { state: 'known', value: String(48_000_000 + index) }
        : { state: 'unavailable', reason: 'PROVIDER_DOWN' },
    lag:
      status === 'UP'
        ? { state: 'known', value: index }
        : { state: 'unknown', reason: 'NOT_QUERIED' },
    ...(status === 'UP' ? {} : { errorCode: `VISUAL_${status}` }),
  };
}

const fixedHealth: HealthResponse = {
  status: 'UP',
  service: 'zerotrace-api',
  readOnly: true,
  providers: Array.from({ length: 18 }, (_, index) => provider(index)),
  storage: {
    status: 'UP',
    backend: 'POSTGRES',
    durable: true,
    checkedAt: fixedAt,
  },
  ingestionStorage: {
    status: 'UP',
    configured: 3,
    required: 3,
    checkedAt: fixedAt,
    rawFacts: {
      status: 'UP',
      backend: 'CLICKHOUSE',
      durable: true,
      checkedAt: fixedAt,
    },
    checkpoints: {
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
      checkedAt: fixedAt,
    },
    artifacts: {
      status: 'UP',
      backend: 'S3_COMPATIBLE',
      durable: true,
      checkedAt: fixedAt,
      bucket: 'visual-test-only',
    },
  },
  dataQuality: {
    status: 'UNCONFIGURED',
    durable: true,
    checkedAt: fixedAt,
    configuredSources: {},
    results: [],
    storage: {
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
      checkedAt: fixedAt,
    },
  },
  graphProjection: {
    status: 'UP',
    backend: 'APACHE_AGE',
    durable: true,
    checkedAt: fixedAt,
    graphName: 'zerotrace_investigation',
  },
  checkedAt: fixedAt,
};

const researchSources: ResearchSourceSettingsResponse = {
  policyVersion: 'visual-test-only',
  procurementBudgetMicrousd: '0',
  paidEnabledByDefault: false,
  credentialsAreSpendConsent: false,
  unknownPrice: 'BLOCK',
  autoFailoverToPaid: false,
  procurement: {
    status: 'DURABLE',
    remainingMicrousd: '0',
    paidEnabled: false,
    blocked: false,
    revision: 1,
    updatedAt: fixedAt,
  },
  sources: [],
  xUpstreamEvidenceRule: 'ALL_X_TOOLS_ONE_UPSTREAM_GROUP',
};

async function openState(
  browser: Browser,
  options: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    theme: 'dark' | 'light';
    reducedMotion?: 'reduce';
    providerDown?: boolean;
    diagnostics?: boolean;
  },
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: options.width, height: options.height },
    screen: {
      width: Math.round(options.width * options.deviceScaleFactor),
      height: Math.round(options.height * options.deviceScaleFactor),
    },
    deviceScaleFactor: options.deviceScaleFactor,
    colorScheme: options.theme,
    reducedMotion: options.reducedMotion ?? 'no-preference',
  });
  await context.addInitScript(
    ({ diagnostics, theme }) => {
      if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
      window.localStorage.setItem('zerotrace-theme', theme);
      window.localStorage.setItem('zerotrace-presentation', 'novice');
      if (diagnostics) window.localStorage.setItem('zerotrace-diagnostics', 'enabled');
      else window.localStorage.removeItem('zerotrace-diagnostics');
    },
    { diagnostics: options.diagnostics === true, theme: options.theme },
  );
  const page = await context.newPage();
  if (options.providerDown === true) {
    await page.route('**/health', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'PROVIDER_UNAVAILABLE' } }),
      });
    });
    await page.route('**/api/v1/settings/research-sources', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'SOURCE_POLICY_UNAVAILABLE' } }),
      });
    });
  } else {
    await page.route('**/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixedHealth),
      });
    });
    await page.route('**/api/v1/settings/research-sources', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(researchSources),
      });
    });
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '工作台 / 查询' })).toBeVisible();
  if (options.providerDown === true) {
    await expect(page.getByText('数据服务不可用', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByLabel('数据服务状态 可用')).toBeVisible();
  }
  await page.evaluate(async () => await document.fonts.ready);
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
  });
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  return { page, close: async () => await context.close() };
}

async function screenshotPage(
  browser: Browser,
  name: string,
  options: Parameters<typeof openState>[1],
): Promise<void> {
  const state = await openState(browser, options);
  try {
    await expect(state.page).toHaveScreenshot(`${name}.png`, {
      animations: 'disabled',
      caret: 'hide',
      scale: 'device',
    });
  } finally {
    await state.close();
  }
}

test('captures the dark 1920×1080 workbench', async ({ browser }) => {
  await screenshotPage(browser, 'workbench-dark-1920x1080', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    theme: 'dark',
  });
});

test('captures the light 1366×768 workbench', async ({ browser }) => {
  await screenshotPage(browser, 'workbench-light-1366x768', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    theme: 'light',
  });
});

test('captures the 125% equivalent physical 1920×1080 workbench', async ({ browser }) => {
  await screenshotPage(browser, 'workbench-dark-scale125-physical1920x1080', {
    width: 1536,
    height: 864,
    deviceScaleFactor: 1.25,
    theme: 'dark',
  });
});

test('captures the 150% equivalent physical 1920×1080 workbench', async ({ browser }) => {
  await screenshotPage(browser, 'workbench-light-scale150-physical1920x1080', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1.5,
    theme: 'light',
  });
});

test('captures the narrow reduced-motion navigation', async ({ browser }) => {
  await screenshotPage(browser, 'workbench-dark-narrow-390x844', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    theme: 'dark',
    reducedMotion: 'reduce',
  });
});

test('captures the explicit provider-down state', async ({ browser }) => {
  await screenshotPage(browser, 'provider-down-light-1366x768', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    theme: 'light',
    providerDown: true,
  });
});

test('captures the long provider and storage state without clipping the evidence boundary', async ({
  browser,
}) => {
  const state = await openState(browser, {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    theme: 'dark',
    diagnostics: true,
  });
  try {
    const diagnostics = state.page.locator('details.developer-navigation');
    await diagnostics.locator('summary').click();
    await diagnostics.getByRole('button', { name: '数据源与系统', exact: true }).click();
    await expect(
      state.page.getByRole('heading', { name: '数据源与系统', exact: true }),
    ).toBeVisible();
    await expect(state.page.locator('.provider-card')).toHaveCount(23);
    await expect(state.page.locator('.main-content')).toHaveScreenshot(
      'provider-table-dark-long.png',
      { animations: 'disabled', caret: 'hide', scale: 'css' },
    );
  } finally {
    await state.close();
  }
});
