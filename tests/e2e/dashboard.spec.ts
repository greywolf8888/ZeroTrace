import { expect, test } from '@playwright/test';

const checksummedEvmAddress = '0x52908400098527886E0F7030069857D2E4169EE7';
const solanaSignature =
  '4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9';

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
  await expect(
    page.getByText(
      /EVM logs\/traces\/state diffs, Bitcoin inputs\/outputs, and Solana instructions\/logs\/balances\/token balances\/rewards are implemented/,
    ),
  ).toBeVisible();
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

test('opens a typed Solana transaction result with Snapshot and Evidence', async ({ page }) => {
  await page.route('**/api/v1/ledger/SOLANA/TRANSACTION/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        subject: {
          ledger: 'SOLANA',
          chainId: 'solana-mainnet',
          type: 'TRANSACTION',
          id: solanaSignature,
          normalizedId: solanaSignature,
          validation: 'STRUCTURALLY_VALID',
          confidence: 1,
        },
        facts: {
          status: { state: 'known', value: 'CONFIRMED' },
          slot: { state: 'known', value: '300000000' },
          feeLamports: { state: 'known', value: '5000' },
          execution: { state: 'known', value: 'SUCCESS' },
        },
        metadata: {
          snapshot: {
            ledger: 'SOLANA',
            chainId: 'solana-mainnet',
            slot: '300000000',
            blockhash: '11111111111111111111111111111111',
            commitment: 'finalized',
          },
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 1,
          simulationCoverage: 0,
          freshness: '2026-08-10T00:00:00.000Z',
          sourceSet: ['solana-rpc'],
          modelVersion: 'solana-transaction-query-v0.1.0',
          confidence: 1,
          evidenceIds: ['ev_111111111111111111111111'],
        },
        evidence: [
          {
            id: 'ev_111111111111111111111111',
            ledger: 'SOLANA',
            chainId: 'solana-mainnet',
            kind: 'TRANSACTION',
            source: 'solana-rpc',
            locator: `transaction:${solanaSignature}@300000000`,
            payloadHash: '1'.repeat(64),
            observedAt: '2026-08-10T00:00:00.000Z',
            blockOrSlot: '300000000',
            finality: 'finalized',
            summary: 'Solana transaction bound to its committed slot Snapshot.',
          },
        ],
      }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Address or transaction identifier').fill(solanaSignature);
  await page.getByLabel('Network').selectOption('solana');
  await page.getByRole('button', { name: 'Trace' }).click();
  await expect(page.getByRole('heading', { name: '1 candidate' })).toBeVisible();
  await expect(page.getByText('TRANSACTION', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect' }).click();

  await expect(page.getByText('Snapshot-bound ledger record')).toBeVisible();
  await expect(page.getByText('Fee Lamports')).toBeVisible();
  await expect(page.getByText('5000', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence ledger' })).toBeVisible();
  await expect(
    page.getByText('Solana transaction bound to its committed slot Snapshot.'),
  ).toBeVisible();
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
  const anchorPanel = page.locator('.anchor-quality-panel');
  await expect(
    anchorPanel.getByRole('heading', { name: 'Anchor reconciliation and continuity' }),
  ).toBeVisible();
  await expect(anchorPanel).toContainText(
    'Endpoint operator independence remains Unknown until explicitly configured and verified.',
  );
  await expect(anchorPanel.locator('.anchor-quality-card')).toHaveCount(4);
  await expect(anchorPanel.getByText('0/0 observed · 2 required')).toHaveCount(4);
  await expect(anchorPanel).toContainText('Memory · process-local');
  const evidenceStorageCard = page.locator('.storage-card').filter({
    has: page.getByRole('heading', { name: 'Evidence storage' }),
  });
  await expect(evidenceStorageCard).toContainText('Memory');
  await expect(evidenceStorageCard).toContainText('Process-local');
  await expect(evidenceStorageCard).toContainText('Ephemeral');
  const ingestionStorageCard = page.locator('.storage-card').filter({
    has: page.getByRole('heading', { name: 'Finalized ingestion stores' }),
  });
  await expect(ingestionStorageCard).toContainText('Unconfigured');
  await expect(ingestionStorageCard).toContainText('0/3');
  await expect(page.getByRole('button', { name: 'Refresh providers' })).toBeEnabled();
});
