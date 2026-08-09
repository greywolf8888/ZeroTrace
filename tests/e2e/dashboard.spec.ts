import { expect, test } from '@playwright/test';

const checksummedEvmAddress = '0x52908400098527886E0F7030069857D2E4169EE7';
const solanaSignature =
  '4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9';
const bscTokenAddress = `0x${'a'.repeat(40)}`;
const bscFlapCreationTransaction = `0x${'7'.repeat(64)}`;

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
      /Evidence-grounded same-Snapshot comparisons enforce zero mismatch for exact state/,
    ),
  ).toBeVisible();
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

test('shows versioned Flap state and preserves unqueried values as Unknown', async ({ page }) => {
  await page.route('**/api/v1/subjects/EVM/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        subject: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          type: 'ADDRESS',
          id: bscTokenAddress,
          normalizedId: bscTokenAddress,
          validation: 'STRUCTURALLY_VALID',
          confidence: 1,
        },
        facts: {
          nativeBalanceWei: { state: 'known', value: '1000000000000000' },
          bytecodePresent: { state: 'known', value: true },
        },
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            blockNumber: '50000000',
            blockHash: `0x${'1'.repeat(64)}`,
            finality: 'finalized',
          },
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: '2026-08-10T00:00:00.000Z',
          sourceSet: ['bsc-rpc-fixture'],
          modelVersion: 'evm-subject-query-v0.1.0',
          confidence: 1,
          evidenceIds: [],
        },
        evidence: [],
      }),
    });
  });
  await page.route('**/api/v1/launches/EVM/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        platform: 'flap',
        token: bscTokenAddress,
        deployment: {
          portal: '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0',
          documentedVersion: 'v5.14.16',
          sourceRevision: 'flap-sh/FlapVaultExample@0a6ad1b',
        },
        platformMatch: { state: 'known', value: true },
        launch: {
          platform: 'flap',
          platformVersion: { state: 'known', value: 'v5.14.16' },
          deploymentId: { state: 'known', value: 'eip155:56:portal' },
          factoryOrProgram: {
            state: 'known',
            value: '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0',
          },
          lifecycle: 'PRIMARY_MARKET',
          quoteAsset: { state: 'known', value: 'eip155:56:native' },
          curveType: { state: 'known', value: 'FLAP_VIRTUAL_CONSTANT_PRODUCT' },
          realQuoteReserve: { state: 'known', value: '1250000000000000000' },
          virtualBaseReserve: { state: 'known', value: '100000000000000000000' },
          virtualQuoteReserve: { state: 'known', value: '2500000000000000000' },
          circulatingSupply: { state: 'known', value: '500000000000000000000' },
          remainingSupply: { state: 'known', value: '500000000000000000000' },
          progress: { state: 'known', value: '0.5' },
          graduationThreshold: { state: 'known', value: '1000000000000000000000' },
          currentSellCapacity: {
            state: 'unknown',
            reason: 'NOT_QUERIED',
            detail: 'Sell capacity requires a bounded curve quote.',
          },
          taxModel: { state: 'known', value: 'SYMMETRIC_TOKEN_TAX' },
          buyTaxBps: { state: 'known', value: '500' },
          sellTaxBps: { state: 'known', value: '500' },
          migrationPool: { state: 'unknown', reason: 'NOT_APPLICABLE' },
          lpLocked: { state: 'unknown', reason: 'NOT_QUERIED' },
          lpBurned: { state: 'unknown', reason: 'NOT_QUERIED' },
          sourceBlockOrSlot: '50000000',
          sourceVersion: 'flap:getTokenV8Safe:flap-sh/FlapVaultExample@0a6ad1b',
          evidenceIds: ['ev_flap_derived'],
        },
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            blockNumber: '50000000',
            blockHash: `0x${'1'.repeat(64)}`,
            finality: 'finalized',
          },
          dataCoverage: 0.7,
          sourceCoverage: 1,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: '2026-08-10T00:00:00.000Z',
          sourceSet: ['flap-official-docs', 'bsc-rpc-fixture'],
          modelVersion: 'flap-inspector-getTokenV8Safe-v0.1.0',
          confidence: 0.95,
          evidenceIds: ['ev_flap_derived'],
        },
        evidence: [
          {
            id: 'ev_flap_derived',
            ledger: 'EVM',
            chainId: 'eip155:56',
            kind: 'DERIVED_FEATURE',
            source: 'zerotrace:flap-inspector',
            locator: `flap:${bscTokenAddress}@50000000`,
            payloadHash: '2'.repeat(64),
            observedAt: '2026-08-10T00:00:00.000Z',
            blockOrSlot: '50000000',
            finality: 'finalized',
            summary: 'Flap launch mechanism normalized from versioned Portal state.',
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/launches/EVM/**/events/**', async (route) => {
    const officialDefault = (value: unknown) => ({
      value,
      source: 'OFFICIAL_DEFAULT',
      evidenceIds: ['ev_flap_defaults'],
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        platform: 'flap',
        token: bscTokenAddress,
        transactionHash: bscFlapCreationTransaction,
        platformMatch: { state: 'known', value: true },
        transactionKind: 'CREATION_CONFIGURATION',
        creation: {
          timestampUnix: '1700000000',
          creator: `0x${'c'.repeat(40)}`,
          nonce: '7',
          token: bscTokenAddress,
          name: 'Fixture Token',
          symbol: 'FIX',
          metadataUri: 'ipfs://fixture',
        },
        staged: null,
        configuration: {
          curveAddress: officialDefault({ state: 'unknown', reason: 'NOT_QUERIED' }),
          curveParameter: officialDefault({ state: 'known', value: '16000000000000000000' }),
          virtualQuoteReserve: officialDefault({ state: 'unknown', reason: 'NOT_QUERIED' }),
          virtualBaseReserve: officialDefault({ state: 'unknown', reason: 'NOT_QUERIED' }),
          virtualLiquiditySquared: officialDefault({ state: 'unknown', reason: 'NOT_QUERIED' }),
          dexSupplyThreshold: officialDefault({
            state: 'known',
            value: '667000000000000000000000000',
          }),
          quoteTokenAddress: officialDefault({
            state: 'known',
            value: `0x${'0'.repeat(40)}`,
          }),
          migratorType: officialDefault({ state: 'known', value: 'V3_MIGRATOR' }),
          tokenVersion: officialDefault({ state: 'known', value: 'TOKEN_LEGACY' }),
          buyTaxBps: officialDefault({ state: 'known', value: '0' }),
          sellTaxBps: officialDefault({ state: 'known', value: '0' }),
          dexId: officialDefault({ state: 'known', value: 'DEX0' }),
          lpFeeProfile: officialDefault({ state: 'known', value: 'STANDARD' }),
          extensions: [],
          rawConfigHash: '4'.repeat(64),
        },
        migration: null,
        decodedEventNames: ['TokenCreated'],
        unrecognizedPortalLogCount: 0,
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            blockNumber: '49900000',
            blockHash: `0x${'4'.repeat(64)}`,
            finality: 'finalized',
          },
          dataCoverage: 1,
          sourceCoverage: 1,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: '2026-08-10T00:00:00.000Z',
          sourceSet: ['bsc-rpc-fixture', 'flap-official-event-guide'],
          modelVersion: 'flap-event-transaction-v1',
          confidence: 0.99,
          evidenceIds: ['ev_flap_event'],
        },
        evidence: [
          {
            id: 'ev_flap_event',
            ledger: 'EVM',
            chainId: 'eip155:56',
            kind: 'DERIVED_FEATURE',
            source: 'zerotrace:flap-event-transaction-v1',
            locator: `flap-event-transaction:${bscTokenAddress}:${bscFlapCreationTransaction}`,
            payloadHash: '5'.repeat(64),
            observedAt: '2026-08-10T00:00:00.000Z',
            blockOrSlot: '49900000',
            finality: 'finalized',
            summary: 'Flap transaction-local creation and configuration events normalized.',
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/launches/EVM/**/history*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        platform: 'flap',
        token: bscTokenAddress,
        requestedRange: {
          fromBlock: '49900000',
          toBlock: '49900000',
          chunkSize: 2000,
          chunkCount: 1,
        },
        requestedRangeCoverage: 1,
        lifetimeCoverage: {
          state: 'unknown',
          reason: 'INSUFFICIENT_DATA',
          detail: 'The bounded range is complete; lifetime indexing is not.',
        },
        chronology: [
          {
            transactionHash: bscFlapCreationTransaction,
            blockNumber: '49900000',
            blockHash: `0x${'4'.repeat(64)}`,
            transactionIndex: '1',
            transactionKind: 'CREATION_CONFIGURATION',
            decodedEventNames: ['TokenCreated'],
            evidenceIds: ['ev_flap_event'],
          },
        ],
        transactions: [],
        unrecognizedPortalLogCount: 0,
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            blockNumber: '49900000',
            blockHash: `0x${'4'.repeat(64)}`,
            finality: 'finalized',
          },
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: '2026-08-10T00:00:00.000Z',
          sourceSet: ['bsc-rpc-fixture'],
          modelVersion: 'flap-bounded-event-history-v1',
          confidence: 0.95,
          evidenceIds: ['ev_flap_history'],
        },
        evidence: [
          {
            id: 'ev_flap_history',
            ledger: 'EVM',
            chainId: 'eip155:56',
            kind: 'DERIVED_FEATURE',
            source: 'zerotrace:flap-bounded-event-history-v1',
            locator: `flap-event-history:${bscTokenAddress}:49900000-49900000`,
            payloadHash: '6'.repeat(64),
            observedAt: '2026-08-10T00:00:00.000Z',
            blockOrSlot: '49900000',
            finality: 'finalized',
            summary: 'Flap event transactions discovered in the requested bounded range.',
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/rv/flap-sell', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        platform: 'flap',
        token: bscTokenAddress,
        quoteAsset: { state: 'known', value: 'eip155:56:native' },
        quote: {
          inputQuantity: '1000000000000000000',
          nominalValue: { state: 'unknown', reason: 'NOT_QUERIED' },
          realizableValue: { state: 'known', value: '2500000000000000' },
          averageExitPrice: { state: 'unknown', reason: 'NOT_QUERIED' },
          priceImpactBps: { state: 'unknown', reason: 'NOT_QUERIED' },
          totalFeeBps: { state: 'unknown', reason: 'NOT_QUERIED' },
          route: ['eip155:56:portal:previewSell'],
          metadata: {
            snapshot: {
              ledger: 'EVM',
              chainId: 'eip155:56',
              blockNumber: '50000000',
              blockHash: `0x${'1'.repeat(64)}`,
              finality: 'finalized',
            },
            dataCoverage: 0.6,
            sourceCoverage: 1,
            historyCoverage: 0,
            simulationCoverage: 0,
            freshness: '2026-08-10T00:00:00.000Z',
            sourceSet: ['flap-official-docs', 'bsc-rpc-fixture'],
            modelVersion: 'flap-preview-sell-v0.1.0',
            confidence: 0.95,
            evidenceIds: ['ev_flap_quote'],
          },
        },
        evidence: [
          {
            id: 'ev_flap_quote',
            ledger: 'EVM',
            chainId: 'eip155:56',
            kind: 'DERIVED_FEATURE',
            source: 'zerotrace:flap-preview-sell:v0.1.0',
            locator: `rv:flap-preview-sell:${bscTokenAddress}:1000000000000000000@50000000`,
            payloadHash: '3'.repeat(64),
            observedAt: '2026-08-10T00:00:00.000Z',
            blockOrSlot: '50000000',
            finality: 'finalized',
            summary: 'Flap sell preview normalized into a realizable-value observation.',
          },
        ],
      }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Address or transaction identifier').fill(bscTokenAddress);
  await page.getByLabel('Network').selectOption('bsc');
  await page.getByRole('button', { name: 'Trace' }).click();
  await page.getByRole('button', { name: 'Inspect' }).click();

  await expect(page.getByRole('heading', { name: 'Flap launch mechanism' })).toBeVisible();
  await expect(page.getByText('Primary Market')).toBeVisible();
  await expect(page.getByText('Current Sell Capacity')).toBeVisible();
  await expect(page.getByText('Not Queried').first()).toBeVisible();
  await expect(page.getByText('Snapshot block')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flap evidence ledger' })).toBeVisible();
  await expect(
    page.getByText('Flap launch mechanism normalized from versioned Portal state.'),
  ).toBeVisible();

  await expect(
    page.getByRole('heading', { name: 'Flap creation / migration transaction' }),
  ).toBeVisible();
  await page.getByLabel('Creation or migration transaction hash').fill(bscFlapCreationTransaction);
  await page.getByRole('button', { name: 'Inspect events' }).click();
  await expect(page.locator('.event-panel .snapshot-strip')).toContainText(
    'Classification Creation Configuration',
  );
  await expect(page.getByText('Fixture Token', { exact: true })).toBeVisible();
  await expect(page.getByText('Official Default').first()).toBeVisible();
  await expect(page.getByText('History coverage')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Flap transaction evidence ledger' }),
  ).toBeVisible();
  await expect(
    page.getByText('Flap transaction-local creation and configuration events normalized.'),
  ).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Flap bounded event history' })).toBeVisible();
  await page.getByLabel('From block').fill('49900000');
  await page.getByLabel('To block').fill('49900000');
  await page.getByRole('button', { name: 'Scan range' }).click();
  const historyPanel = page.locator('.event-history-panel');
  await expect(historyPanel).toContainText('Range coverage 100%');
  await expect(historyPanel).toContainText('Lifetime coverage Insufficient Data');
  await expect(historyPanel).toContainText('Block 49900000 · Creation Configuration');
  await expect(page.getByRole('heading', { name: 'Flap history evidence ledger' })).toBeVisible();
  await expect(
    page.getByText('Flap event transactions discovered in the requested bounded range.'),
  ).toBeVisible();

  await page.getByLabel('Sell amount (atomic units)').fill('1000000000000000000');
  await page.getByRole('button', { name: 'Preview sell' }).click();
  await expect(page.getByRole('heading', { name: 'Flap realizable sell preview' })).toBeVisible();
  await expect(page.getByText('2500000000000000', { exact: true })).toBeVisible();
  await expect(page.getByText('Price Impact Bps')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sell quote evidence ledger' })).toBeVisible();
  await expect(
    page.getByText('Flap sell preview normalized into a realizable-value observation.'),
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
