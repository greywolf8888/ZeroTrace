import { expect, test } from '@playwright/test';

const checksummedEvmAddress = '0x52908400098527886E0F7030069857D2E4169EE7';

test('renders capability truth and unknown values without fake market data', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');

  await expect(page.getByAltText('ZeroTrace company icon')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'See control, liquidity, and realizable value as chain facts—not assumptions.',
    }),
  ).toBeVisible();
  await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
  await expect(page.getByText('0 transaction write methods')).toBeVisible();
  await expect(page.getByText('Unknown · select an asset')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Capability ledger' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Platform adapter boundaries' })).toBeVisible();
  await expect(page.getByText('API unavailable')).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    panels: [...document.querySelectorAll<HTMLElement>('.main-content .panel')].map((panel) => ({
      left: panel.getBoundingClientRect().left,
      right: panel.getBoundingClientRect().right,
    })),
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(
    layout.panels.every(({ left, right }) => left >= -1 && right <= layout.clientWidth + 1),
  ).toBe(true);
  expect(browserErrors).toEqual([]);
});

test('classifies a checksummed EVM address without claiming provider facts', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Address or transaction identifier').fill(checksummedEvmAddress);
  await page.getByLabel('Network').selectOption('ethereum');
  await page.getByRole('button', { name: 'Trace' }).click();

  await expect(page.getByRole('heading', { name: 'Trace an on-chain subject' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 candidate' })).toBeVisible();
  await expect(page.getByText('Checksum Valid')).toBeVisible();
  await expect(page.getByText('eip155:1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Evidence ledger' })).toHaveCount(0);
});

test('keeps scenario execution gated and exposes provider availability', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Scenario Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Shared-liquidity Exit Race' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Analysis gate is closed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run scenario' })).toBeDisabled();

  await page.getByRole('button', { name: 'Data Health' }).click();
  await expect(page.getByRole('heading', { name: 'Data Health' })).toBeVisible();
  await expect(
    page.getByText(
      'A failed or unconfigured provider becomes an availability state—never a business value of zero.',
    ),
  ).toBeVisible();
  const storageCard = page.locator('.storage-card');
  await expect(storageCard.getByRole('heading', { name: 'Evidence storage' })).toBeVisible();
  await expect(storageCard).toContainText('Memory');
  await expect(storageCard).toContainText('Process-local');
  await expect(storageCard).toContainText('Ephemeral');
  await expect(page.getByRole('button', { name: 'Refresh providers' })).toBeEnabled();
});
