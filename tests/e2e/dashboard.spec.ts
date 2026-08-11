import { expect, test } from '@playwright/test';

const checksummedEvmAddress = '0x52908400098527886E0F7030069857D2E4169EE7';
const solanaSignature =
  '4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9';
const bscTokenAddress = `0x${'a'.repeat(40)}`;
const bscFlapCreationTransaction = `0x${'7'.repeat(64)}`;
const bscFlapHistoryScan = '00000000-0000-4000-8000-000000000001';
const unavailableFlapHistoryScan = '00000000-0000-4000-8000-000000000002';
const bscFlapLifetimeScan = '00000000-0000-4000-8000-000000000003';
const bitcoinAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const bitcoinTransactionId = 'c'.repeat(64);

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

test('replays an immutable Entity relationship hypothesis without enabling ownership merge', async ({
  page,
}) => {
  const reportId = `erh_${'a'.repeat(24)}`;
  const sourceEvidenceId = `ev_${'b'.repeat(24)}`;
  const terminalEvidenceId = `ev_${'c'.repeat(24)}`;
  const subjectA = `0x${'1'.repeat(40)}`;
  const subjectB = `0x${'2'.repeat(40)}`;
  const snapshot = {
    ledger: 'EVM',
    chainId: 'eip155:56',
    blockNumber: '115279243',
    blockHash: `0x${'d'.repeat(64)}`,
    finality: 'finalized',
    capturedAt: '2026-08-11T08:17:11.381Z',
  };
  const metadata = {
    snapshot,
    dataCoverage: 0.8,
    sourceCoverage: 0.5,
    historyCoverage: 0.7,
    simulationCoverage: 0,
    freshness: '2026-08-11T08:17:11.381Z',
    sourceSet: ['sqd:binance-mainnet'],
    modelVersion: 'entity-v0.1.0',
    confidence: 0.75,
    evidenceIds: [sourceEvidenceId, terminalEvidenceId].sort(),
  };
  const evidence = [
    {
      id: sourceEvidenceId,
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'TRANSACTION',
      source: 'sqd:binance-mainnet',
      locator: 'funding-path@115279243',
      payloadHash: 'e'.repeat(64),
      observedAt: '2026-08-11T08:17:11.381Z',
      blockOrSlot: '115279243',
      finality: 'finalized',
      summary: 'Observed a common funding path at the report Snapshot.',
    },
    {
      id: terminalEvidenceId,
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:entity-v0.1.0',
      locator: `entity-relationship:${subjectA}:${subjectB}`,
      payloadHash: 'f'.repeat(64),
      observedAt: '2026-08-11T08:17:12.000Z',
      blockOrSlot: '115279243',
      finality: 'finalized',
      summary: 'Evidence-weighted controller, coordination, and independence inference.',
    },
  ].sort((left, right) => left.id.localeCompare(right.id));
  const result = {
    subjectA,
    subjectB,
    classification: 'COORDINATED_BUT_INDEPENDENT',
    sameControllerProbability: { state: 'known', value: 0.31 },
    coordinationProbability: { state: 'known', value: 0.96 },
    independenceProbability: { state: 'known', value: 0.62 },
    positiveEvidenceIds: [sourceEvidenceId],
    negativeEvidenceIds: [],
    serviceSuppressionApplied: false,
    metadata,
  };
  const report = {
    schemaVersion: 'entity-relationship-report-v1',
    automaticOwnershipMergeAllowed: false,
    input: {
      subjectA,
      subjectB,
      features: [
        {
          kind: 'COMMON_FUNDER',
          strength: 0.9,
          reliability: 0.8,
          evidenceId: sourceEvidenceId,
        },
      ],
      metadata: { ...metadata, modelVersion: 'entity-feature-extractor-v1' },
    },
    result,
    terminalEvidenceId,
    evidence,
  };
  const record = {
    id: reportId,
    ledger: 'EVM',
    chainId: 'eip155:56',
    subjectA,
    subjectB,
    snapshotPosition: '115279243',
    snapshotHash: snapshot.blockHash,
    resultHash: '1'.repeat(64),
    report,
    terminalEvidenceId,
    evidenceIds: metadata.evidenceIds,
    sourceSet: metadata.sourceSet,
    modelVersion: 'entity-v0.1.0',
    capturedAt: snapshot.capturedAt,
    createdAt: '2026-08-11T08:17:13.000Z',
  };
  const revisedReportId = `erh_${'2'.repeat(24)}`;
  const revisedTerminalEvidenceId = `ev_${'3'.repeat(24)}`;
  const timelineTerminalEvidenceId = `ev_${'4'.repeat(24)}`;
  const timelineId = `ert_${'5'.repeat(24)}`;
  const timelineEvidence = [
    evidence.find((item) => item.id === terminalEvidenceId),
    {
      ...evidence.find((item) => item.id === terminalEvidenceId),
      id: revisedTerminalEvidenceId,
      payloadHash: '2'.repeat(64),
      summary: 'Same-Snapshot recomputation terminal Evidence.',
    },
    {
      ...evidence.find((item) => item.id === terminalEvidenceId),
      id: timelineTerminalEvidenceId,
      source: 'zerotrace:entity-timeline-v0.1.0',
      locator: `entity-relationship-timeline:${subjectA}:${subjectB}:115279243:115279243`,
      payloadHash: '3'.repeat(64),
      summary: 'Durable relationship timeline Evidence.',
    },
  ].sort((left, right) => (left?.id ?? '').localeCompare(right?.id ?? ''));
  const timelineRecord = {
    id: timelineId,
    ledger: 'EVM',
    chainId: 'eip155:56',
    subjectA,
    subjectB,
    fromPosition: '115279243',
    toPosition: '115279243',
    resultHash: '4'.repeat(64),
    terminalEvidenceId: timelineTerminalEvidenceId,
    reportIds: [reportId, revisedReportId].sort(),
    evidenceIds: [terminalEvidenceId, revisedTerminalEvidenceId, timelineTerminalEvidenceId].sort(),
    sourceSet: ['sqd:binance-mainnet'],
    modelVersion: 'entity-timeline-v0.1.0',
    capturedAt: snapshot.capturedAt,
    createdAt: '2026-08-11T08:17:14.000Z',
    report: {
      schemaVersion: 'entity-relationship-timeline-report-v1',
      automaticOwnershipMergeAllowed: false,
      timeline: {
        request: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          subjectA,
          subjectB,
          fromPosition: '115279243',
          toPosition: '115279243',
        },
        observations: [
          {
            reportId,
            resultHash: '1'.repeat(64),
            snapshot,
            classification: 'COORDINATED_BUT_INDEPENDENT',
            sameControllerProbability: { state: 'known', value: 0.31 },
            coordinationProbability: { state: 'known', value: 0.96 },
            independenceProbability: { state: 'known', value: 0.62 },
            serviceSuppressionApplied: false,
            terminalEvidenceId,
            capturedAt: snapshot.capturedAt,
          },
          {
            reportId: revisedReportId,
            resultHash: '2'.repeat(64),
            snapshot,
            classification: 'PROBABLE_SAME_CONTROLLER',
            sameControllerProbability: { state: 'known', value: 0.91 },
            coordinationProbability: { state: 'known', value: 0.72 },
            independenceProbability: { state: 'known', value: 0.12 },
            serviceSuppressionApplied: false,
            terminalEvidenceId: revisedTerminalEvidenceId,
            capturedAt: snapshot.capturedAt,
          },
        ],
        transitions: [
          {
            fromReportId: reportId,
            toReportId: revisedReportId,
            fromPosition: '115279243',
            toPosition: '115279243',
            kind: 'REVISION',
            unobservedPositionCount: '0',
            classificationBefore: 'COORDINATED_BUT_INDEPENDENT',
            classificationAfter: 'PROBABLE_SAME_CONTROLLER',
            classificationChanged: true,
            serviceSuppressionBefore: false,
            serviceSuppressionAfter: false,
            serviceSuppressionChanged: false,
            sameControllerDelta: { state: 'known', value: 0.6 },
            coordinationDelta: { state: 'known', value: -0.24 },
            independenceDelta: { state: 'known', value: -0.5 },
            evidenceIds: [terminalEvidenceId, revisedTerminalEvidenceId].sort(),
          },
        ],
        summary: {
          observationCount: 2,
          transitionCount: 1,
          classificationChangeCount: 1,
          serviceSuppressionChangeCount: 0,
          currentClassification: 'PROBABLE_SAME_CONTROLLER',
          currentSameControllerProbability: { state: 'known', value: 0.91 },
          currentCoordinationProbability: { state: 'known', value: 0.72 },
          currentIndependenceProbability: { state: 'known', value: 0.12 },
          completePersistedReportSet: true,
          chainObservationContinuity: {
            state: 'unknown',
            reason: 'INSUFFICIENT_DATA',
            detail: 'Persisted reports do not prove every chain position was observed.',
          },
        },
        metadata: {
          ...metadata,
          modelVersion: 'entity-timeline-v0.1.0',
          evidenceIds: [terminalEvidenceId, revisedTerminalEvidenceId].sort(),
        },
      },
      terminalEvidenceId: timelineTerminalEvidenceId,
      evidence: timelineEvidence,
    },
  };
  await page.route('**/api/v1/entities/relationships/reports/latest?*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ replayed: true, record }),
    });
  });
  await page.route('**/api/v1/entities/relationships/timelines/latest?*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ replayed: true, record: timelineRecord }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Entity Intelligence' }).click();
  await page.getByLabel('Subject A').fill(subjectB);
  await page.getByLabel('Subject B').fill(subjectA);
  await page
    .getByTestId('entity-report-replay')
    .getByRole('button', { name: 'Load latest' })
    .click();

  const resultPanel = page.getByTestId('entity-report-result');
  await expect(resultPanel).toContainText('Coordinated But Independent');
  await expect(resultPanel).toContainText('Automatic ownership merge');
  await expect(resultPanel).toContainText('Blocked');
  await expect(resultPanel).toContainText(reportId);
  await expect(page.getByRole('heading', { name: 'Entity relationship Evidence' })).toBeVisible();
  await expect(page.getByText('No labels-to-merge path')).toBeVisible();

  await page
    .getByTestId('entity-timeline-controls')
    .getByRole('button', { name: 'Load latest' })
    .click();
  const timelinePanel = page.getByTestId('entity-timeline-result');
  await expect(timelinePanel).toContainText('Probable Same Controller');
  await expect(timelinePanel).toContainText('Automatic merge blocked');
  await expect(page.getByRole('heading', { name: 'Relationship evolution' })).toBeVisible();
  await expect(page.getByText(/^115279243 → 115279243 · Revision$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Timeline Evidence' })).toBeVisible();

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
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
          feePayer: { state: 'known', value: '11111111111111111111111111111111' },
          signerCount: { state: 'known', value: 1 },
          outerInstructionCount: { state: 'known', value: 1 },
          cpiCount: { state: 'known', value: 1 },
          accountResolutionComplete: { state: 'known', value: true },
          tokenBalanceChangeCount: { state: 'known', value: 2 },
          coreAssetFlowCount: { state: 'known', value: 1 },
          transactionSemantics: {
            state: 'known',
            value: {
              version: '0',
              recentBlockhash: '11111111111111111111111111111111',
              execution: 'SUCCESS',
              executionError: { state: 'unknown', reason: 'NOT_APPLICABLE' },
              feePayer: { state: 'known', value: '11111111111111111111111111111111' },
              signers: ['11111111111111111111111111111111'],
              requiredSignatureCount: 1,
              staticAccountCount: 2,
              loadedWritableAccountCount: 1,
              loadedReadonlyAccountCount: 1,
              accountResolutionComplete: { state: 'known', value: true },
              accountCoverage: 1,
              recordingCoverage: 1,
              accounts: [
                {
                  index: 0,
                  address: '11111111111111111111111111111111',
                  source: 'STATIC',
                  signer: true,
                  writable: true,
                  feePayer: true,
                  balanceDeltaLamports: { state: 'known', value: '-5000' },
                },
                {
                  index: 1,
                  address: 'Vote111111111111111111111111111111111111111',
                  source: 'STATIC',
                  signer: false,
                  writable: false,
                  feePayer: false,
                  balanceDeltaLamports: { state: 'known', value: '0' },
                },
                {
                  index: 2,
                  address: 'SysvarRent111111111111111111111111111111111',
                  source: 'LOOKUP_WRITABLE',
                  signer: false,
                  writable: true,
                  feePayer: false,
                  balanceDeltaLamports: { state: 'known', value: '0' },
                },
                {
                  index: 3,
                  address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                  source: 'LOOKUP_READONLY',
                  signer: false,
                  writable: false,
                  feePayer: false,
                  balanceDeltaLamports: { state: 'known', value: '0' },
                },
              ],
              addressTableLookups: [
                {
                  accountKey: 'AddressLookupTab1e1111111111111111111111111',
                  writableIndexes: [0],
                  readonlyIndexes: [1],
                },
              ],
              outerInstructions: [
                {
                  path: 'outer:0',
                  stackHeight: { state: 'known', value: 1 },
                  programId: {
                    state: 'known',
                    value: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                  },
                  accountIndexes: [2, 1, 0],
                  accounts: {
                    state: 'known',
                    value: [
                      'SysvarRent111111111111111111111111111111111',
                      'Vote111111111111111111111111111111111111111',
                      '11111111111111111111111111111111',
                    ],
                  },
                  programSemantic: {
                    state: 'known',
                    value: {
                      programFamily: 'SPL_TOKEN',
                      instructionName: 'Transfer',
                      category: 'ASSET_TRANSFER',
                      application: 'APPLIED',
                    },
                  },
                },
              ],
              innerInstructionRecording: { state: 'known', value: true },
              innerInstructions: [
                {
                  path: 'outer:0/inner:0',
                  stackHeight: { state: 'known', value: 2 },
                  programId: {
                    state: 'known',
                    value: 'Vote111111111111111111111111111111111111111',
                  },
                  accountIndexes: [2],
                  accounts: {
                    state: 'known',
                    value: ['SysvarRent111111111111111111111111111111111'],
                  },
                  programSemantic: {
                    state: 'unknown',
                    reason: 'UNSUPPORTED',
                  },
                },
              ],
              cpiCount: { state: 'known', value: 1 },
              programIds: [
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                'Vote111111111111111111111111111111111111111',
              ],
              officialProgramInstructionCount: 1,
              identifiedOfficialProgramInstructionCount: 1,
              officialProgramIdentificationCoverage: { state: 'known', value: 1 },
              assetFlowCandidateCount: 1,
              assetFlowDecodeCoverage: { state: 'known', value: 1 },
              assetFlowCoverage: { state: 'known', value: 1 },
              assetFlows: [
                {
                  id: 'outer:0:flow:0',
                  instructionPath: 'outer:0',
                  programFamily: 'SPL_TOKEN',
                  instructionName: 'Transfer',
                  application: 'APPLIED',
                  flowKind: 'TRANSFER',
                  assetKind: 'WRAPPED_SOL',
                  sourceAccount: {
                    state: 'known',
                    value: 'SysvarRent111111111111111111111111111111111',
                  },
                  destinationAccount: {
                    state: 'known',
                    value: 'Vote111111111111111111111111111111111111111',
                  },
                  sourceOwner: {
                    state: 'known',
                    value: '11111111111111111111111111111111',
                  },
                  destinationOwner: {
                    state: 'known',
                    value: 'Stake11111111111111111111111111111111111111',
                  },
                  mint: {
                    state: 'known',
                    value: 'So11111111111111111111111111111111111111112',
                  },
                  authority: {
                    state: 'known',
                    value: '11111111111111111111111111111111',
                  },
                  amount: { state: 'known', value: '30' },
                  decimals: { state: 'known', value: 9 },
                  expectedFeeAmount: { state: 'known', value: '0' },
                  expectedRecipientAmount: { state: 'known', value: '30' },
                },
              ],
              tokenFlowReconciliation: {
                status: 'MATCHED',
                expectedIdentityCount: 2,
                observedIdentityCount: 2,
                matchedIdentityCount: 2,
                conflictingIdentityCount: 0,
                unknownIdentityCount: 0,
                unmodeledTokenInstructionCount: 0,
                coverage: 1,
                recommendedMaxRelativeError: 0,
                observedRelativeError: { state: 'known', value: 0 },
                detail:
                  'Every modeled token-account atomic delta matched exactly; integer accounting tolerance is zero.',
              },
              tokenBalanceRecording: { state: 'known', value: true },
              tokenBalanceChanges: [
                {
                  accountIndex: 2,
                  account: {
                    state: 'known',
                    value: 'SysvarRent111111111111111111111111111111111',
                  },
                  mint: 'So11111111111111111111111111111111111111112',
                  preAmount: { state: 'known', value: '100' },
                  postAmount: { state: 'known', value: '70' },
                  deltaAmount: { state: 'known', value: '-30' },
                },
                {
                  accountIndex: 1,
                  account: {
                    state: 'known',
                    value: 'Vote111111111111111111111111111111111111111',
                  },
                  mint: 'So11111111111111111111111111111111111111112',
                  preAmount: { state: 'known', value: '10' },
                  postAmount: { state: 'known', value: '40' },
                  deltaAmount: { state: 'known', value: '30' },
                },
              ],
              computeUnitsConsumed: { state: 'known', value: '2300' },
              logRecording: { state: 'known', value: true },
              logCount: { state: 'known', value: 3 },
            },
          },
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
          modelVersion: 'solana-transaction-query-v1.1.0',
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
        durableReport: {
          id: 'str_111111111111111111111111',
          resultHash: 'f'.repeat(64),
          createdAt: '2026-08-10T00:00:02.000Z',
          capturedAt: '2026-08-10T00:00:00.000Z',
          replayed: true,
          liveRefresh: {
            state: 'unavailable',
            reason: 'PROVIDER_DOWN',
            detail: 'The immutable report was replayed after a provider failure.',
          },
        },
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

  const semantics = page.getByTestId('solana-transaction-semantics');
  await expect(
    semantics.getByRole('heading', { name: 'Solana transaction semantics' }),
  ).toBeVisible();
  await expect(semantics.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(semantics.getByText('Lookup Writable', { exact: true })).toBeVisible();
  await expect(semantics.getByText('outer:0/inner:0', { exact: true })).toBeVisible();
  await expect(semantics.getByText('-30', { exact: true })).toBeVisible();
  const reportProvenance = page.getByTestId('solana-report-provenance');
  await expect(reportProvenance.getByText('str_111111111111111111111111')).toBeVisible();
  await expect(reportProvenance.getByText('Replayed', { exact: true })).toBeVisible();
  await expect(reportProvenance.getByText('Provider Down', { exact: true })).toBeVisible();
  const assetFlowAudit = page.getByTestId('solana-asset-flow-audit');
  await expect(
    assetFlowAudit.getByRole('heading', { name: 'Core asset-flow audit' }),
  ).toBeVisible();
  await expect(assetFlowAudit.getByText('Matched', { exact: true })).toBeVisible();
  await expect(assetFlowAudit.getByText('0.000000%', { exact: true })).toBeVisible();
  await expect(semantics.getByText('Transfer', { exact: true }).first()).toBeVisible();
  await expect(semantics.getByText('Stake11111111111111111111111111111111111111')).toBeVisible();
  await expect(semantics.getByText(/never coerced to an atomic zero/)).toBeVisible();
  await expect(page.getByText('Snapshot-bound ledger record')).toBeVisible();
  await expect(page.getByText('Fee Lamports')).toBeVisible();
  await expect(page.getByText('5000', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence ledger' })).toBeVisible();
  await expect(
    page.getByText('Solana transaction bound to its committed slot Snapshot.'),
  ).toBeVisible();
});

test('renders reconciled Bitcoin UTXOs and keeps node policy Unknown', async ({ page }) => {
  await page.route('**/api/v1/subjects/BITCOIN/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        subject: {
          ledger: 'BITCOIN',
          chainId: 'bitcoin-mainnet',
          type: 'ADDRESS',
          id: bitcoinAddress,
          normalizedId: bitcoinAddress,
          validation: 'STRUCTURALLY_VALID',
          confidence: 1,
        },
        facts: {
          confirmedBalanceSats: { state: 'known', value: '300' },
          mempoolDeltaSats: { state: 'known', value: '-10' },
          transactionCount: { state: 'known', value: '3' },
          totalUtxoValueSats: { state: 'known', value: '290' },
          balanceAgreement: { state: 'known', value: true },
          effectiveRbfPolicy: {
            state: 'unknown',
            reason: 'UNSUPPORTED',
            detail: 'Esplora does not expose active Bitcoin Core replacement policy.',
          },
          cpfpPackageState: {
            state: 'unknown',
            reason: 'UNSUPPORTED',
            detail: 'Esplora does not expose ancestor/descendant package state.',
          },
          utxoSet: {
            state: 'known',
            value: {
              address: bitcoinAddress,
              confirmedUtxoCount: 1,
              mempoolUtxoCount: 0,
              totalValueSats: '290',
              statsNetValueSats: '290',
              balanceAgreement: { state: 'known', value: true },
              modelVersion: 'bitcoin-address-utxo-v1.0.0',
              utxos: [
                {
                  outpoint: `${'e'.repeat(64)}:1`,
                  txid: 'e'.repeat(64),
                  vout: '1',
                  valueSats: '290',
                  confirmed: true,
                  blockHeight: { state: 'known', value: '839999' },
                  blockHash: { state: 'known', value: 'd'.repeat(64) },
                },
              ],
            },
          },
        },
        metadata: {
          snapshot: {
            ledger: 'BITCOIN',
            chainId: 'bitcoin-mainnet',
            height: '840000',
            blockHash: 'b'.repeat(64),
            finality: 'best-chain',
            mempoolSnapshot: `sha256:${'a'.repeat(64)}`,
          },
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: '2026-08-11T00:00:00.000Z',
          sourceSet: ['bitcoin-esplora'],
          modelVersion: 'bitcoin-address-utxo-v1.0.0',
          confidence: 0.95,
          evidenceIds: [],
        },
        evidence: [],
      }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Address or transaction identifier').fill(bitcoinAddress);
  await page.getByLabel('Network').selectOption('bitcoin');
  await page.getByRole('button', { name: 'Trace' }).click();
  await page
    .locator('.candidate-card')
    .filter({ hasText: 'BITCOIN' })
    .filter({ has: page.getByText('ADDRESS', { exact: true }) })
    .getByRole('button', { name: 'Inspect' })
    .click();

  const panel = page.getByTestId('bitcoin-address-intelligence');
  await expect(panel.getByRole('heading', { name: 'Bitcoin UTXO reconciliation' })).toBeVisible();
  await expect(panel.getByText('290 sats', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText('1 confirmed · 0 mempool', { exact: true })).toBeVisible();
  await expect(panel.getByText('Policy boundary', { exact: true })).toBeVisible();
  await expect(
    panel.getByText(/RBF effectiveness and CPFP package state remain Unknown/),
  ).toBeVisible();
  await expect(panel.getByText('839999', { exact: true })).toBeVisible();
});

test('screens Bitcoin transaction clustering without merging CoinJoin inputs', async ({ page }) => {
  await page.route('**/api/v1/ledger/BITCOIN/TRANSACTION/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        subject: {
          ledger: 'BITCOIN',
          chainId: 'bitcoin-mainnet',
          type: 'TRANSACTION',
          id: bitcoinTransactionId,
          normalizedId: bitcoinTransactionId,
          validation: 'STRUCTURALLY_VALID',
          confidence: 1,
        },
        facts: {
          status: { state: 'known', value: 'CONFIRMED' },
          feeSats: { state: 'known', value: '3000' },
          structuralPattern: { state: 'known', value: 'EQUAL_OUTPUT_COINJOIN_LIKE' },
          automaticOwnershipMergeAllowed: { state: 'known', value: false },
          transactionEntityAnalysis: {
            state: 'known',
            value: {
              txid: bitcoinTransactionId,
              coinbase: false,
              inputCount: 3,
              outputCount: 3,
              inputAddressCoverage: 1,
              inputAddresses: ['bc1qparticipant1', 'bc1qparticipant2', 'bc1qparticipant3'],
              outputAddresses: ['bc1qoutput1', 'bc1qoutput2', 'bc1qoutput3'],
              inputValueSats: { state: 'known', value: '30000' },
              outputValueSats: '27000',
              feeSats: '3000',
              feeReconciles: { state: 'known', value: true },
              virtualSizeBytes: '300',
              feeRateSatPerVbyte: { state: 'known', value: '10' },
              equalOutputGroups: [{ valueSats: '9000', outputCount: 3, vouts: [0, 1, 2] }],
              structuralPattern: 'EQUAL_OUTPUT_COINJOIN_LIKE',
              payjoinContaminationRisk: {
                state: 'unknown',
                reason: 'INSUFFICIENT_DATA',
                detail: 'Final transaction does not expose Payjoin negotiation.',
              },
              serviceClusterRisk: { state: 'unknown', reason: 'NOT_QUERIED' },
              addressReuseOutputVouts: [],
              commonInputHeuristic: { state: 'known', value: true },
              commonInputOwnershipCandidate: {
                state: 'known',
                value: ['bc1qparticipant1', 'bc1qparticipant2', 'bc1qparticipant3'],
              },
              automaticOwnershipMergeAllowed: false,
              suppressionReasons: [
                'COINJOIN_EQUAL_OUTPUT_PATTERN',
                'PAYJOIN_NOT_EXCLUDABLE',
                'SERVICE_ATTRIBUTION_UNQUERIED',
              ],
              changeCandidates: [],
              selectedChangeOutput: { state: 'unknown', reason: 'PRECISION_UNSAFE' },
              ownershipConclusion: { state: 'unknown', reason: 'PRECISION_UNSAFE' },
              externalAttribution: { state: 'unknown', reason: 'NOT_QUERIED' },
              modelVersion: 'bitcoin-transaction-entity-v1.0.0',
            },
          },
        },
        metadata: {
          snapshot: {
            ledger: 'BITCOIN',
            chainId: 'bitcoin-mainnet',
            height: '840000',
            blockHash: 'b'.repeat(64),
            finality: 'best-chain',
          },
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 1,
          simulationCoverage: 0,
          freshness: '2026-08-11T00:00:00.000Z',
          sourceSet: ['bitcoin-esplora'],
          modelVersion: 'bitcoin-transaction-query-v1.0.0',
          confidence: 0.95,
          evidenceIds: [],
        },
        evidence: [],
      }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Address or transaction identifier').fill(bitcoinTransactionId);
  await page.getByLabel('Network').selectOption('bitcoin');
  await page.getByRole('button', { name: 'Trace' }).click();
  await page
    .locator('.candidate-card')
    .filter({ hasText: 'BITCOIN' })
    .filter({ has: page.getByText('TRANSACTION', { exact: true }) })
    .getByRole('button', { name: 'Inspect' })
    .click();

  const panel = page.getByTestId('bitcoin-transaction-entity');
  await expect(
    panel.getByRole('heading', { name: 'Bitcoin transaction entity screening' }),
  ).toBeVisible();
  await expect(panel.getByText('Equal Output Coinjoin Like', { exact: true })).toBeVisible();
  await expect(panel.getByText('Blocked', { exact: true })).toBeVisible();
  await expect(
    panel
      .locator('.bitcoin-entity-boundaries > div')
      .filter({ hasText: 'Ownership conclusion' })
      .getByText('Precision Unsafe', { exact: true }),
  ).toBeVisible();
  await expect(
    panel
      .locator('.bitcoin-entity-boundaries > div')
      .filter({ hasText: 'Selected change output' })
      .getByText('Precision Unsafe', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('Coinjoin Equal Output Pattern', { exact: true })).toBeVisible();
  await expect(panel.getByText(/never directly merge entities/)).toBeVisible();
  await expect(
    panel.getByText('No bounded change candidate survived the structural filter.'),
  ).toBeVisible();
});

test('renders Bitcoin script conditions without converting keys into controller identity', async ({
  page,
}) => {
  await page.route('**/api/v1/ledger/BITCOIN/OUTPOINT/**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        subject: {
          ledger: 'BITCOIN',
          chainId: 'bitcoin-mainnet',
          type: 'OUTPOINT',
          id: `${bitcoinTransactionId}:0`,
          normalizedId: `${bitcoinTransactionId}:0`,
          validation: 'STRUCTURALLY_VALID',
          confidence: 1,
        },
        facts: {
          valueSats: { state: 'known', value: '100000' },
          spent: { state: 'known', value: true },
          controllerIdentity: {
            state: 'unknown',
            reason: 'INSUFFICIENT_DATA',
            detail: 'Script keys do not prove a real-world entity.',
          },
          effectiveSpendingTransactionRbf: {
            state: 'unknown',
            reason: 'INSUFFICIENT_DATA',
            detail: 'Active node policy is unavailable.',
          },
          spendingTransactionCpfpPackage: {
            state: 'unknown',
            reason: 'UNSUPPORTED',
            detail: 'Ancestor and descendant state is unavailable.',
          },
          scriptControl: {
            state: 'known',
            value: {
              scriptClass: 'P2WSH',
              spendConditionVisibility: 'REVEALED_AND_COMMITMENT_VERIFIED',
              signatureRequirement: { state: 'known', value: 'MULTISIG' },
              multisig: {
                state: 'known',
                value: { threshold: 2, signerCount: 3, publicKeyFingerprints: [] },
              },
              absoluteTimelocks: [
                {
                  kind: 'ABSOLUTE_HEIGHT',
                  value: '840000',
                  encodedValue: '840000',
                  detail: 'CHECKLOCKTIMEVERIFY block-height threshold.',
                },
              ],
              relativeTimelocks: [],
              hashPredicatePresent: { state: 'known', value: false },
              taprootSpendPath: { state: 'unknown', reason: 'NOT_APPLICABLE' },
              controllerIdentity: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
              scriptConditionsComplete: { state: 'known', value: true },
            },
          },
        },
        metadata: {
          snapshot: {
            ledger: 'BITCOIN',
            chainId: 'bitcoin-mainnet',
            height: '840000',
            blockHash: 'b'.repeat(64),
            finality: 'best-chain',
            mempoolSnapshot: `sha256:${'a'.repeat(64)}`,
          },
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 1,
          simulationCoverage: 0,
          freshness: '2026-08-11T00:00:00.000Z',
          sourceSet: ['bitcoin-esplora'],
          modelVersion: 'bitcoin-outpoint-query-v1.0.0',
          confidence: 0.95,
          evidenceIds: [],
        },
        evidence: [],
      }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Address or transaction identifier').fill(`${bitcoinTransactionId}:0`);
  await page.getByLabel('Network').selectOption('bitcoin');
  await page.getByRole('button', { name: 'Trace' }).click();
  await page.getByRole('button', { name: 'Inspect' }).click();

  const panel = page.getByTestId('bitcoin-outpoint-intelligence');
  await expect(panel.getByRole('heading', { name: 'Bitcoin script control' })).toBeVisible();
  await expect(panel.getByText('P2WSH', { exact: true })).toBeVisible();
  await expect(panel.getByText('2-of-3', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Absolute Height · 840000/)).toBeVisible();
  await expect(panel.getByText('Insufficient Data', { exact: true }).first()).toBeVisible();
  await expect(
    panel.getByText(/public key, hash, or script is not an entity identity/i),
  ).toBeVisible();
  await expect(panel.getByText('Unsupported', { exact: true })).toBeVisible();
});

test('shows versioned Flap state and preserves unqueried values as Unknown', async ({ page }) => {
  const claimAddress = '0x8d50a68b4f9ada119d198d6472eaf0cb6db302d9';
  const claimTerminalEvidenceId = 'ev_a6a115563867c6dfcbcca54b';
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
          spotPrice: { state: 'known', value: '0.0025' },
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
  await page.route('**/api/v1/launches/EVM/**/history/projections/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/${unavailableFlapHistoryScan}`)) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'DURABLE_STORAGE_UNAVAILABLE',
            message: 'Durable history projection storage is unavailable.',
          },
        }),
      });
      return;
    }
    const afterBlock = url.searchParams.get('afterBlock');
    const secondPage = afterBlock === '100000';
    const snapshot = {
      ledger: 'EVM',
      chainId: 'eip155:56',
      blockNumber: secondPage ? '199999' : '149999',
      blockHash: `0x${secondPage ? '9'.repeat(64) : '8'.repeat(64)}`,
      finality: 'finalized',
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        scan: {
          id: bscFlapHistoryScan,
          status: secondPage ? 'REQUESTED_RANGE_COMPLETE' : 'RUNNING',
          source: 'sqd:binance-mainnet',
          chainId: 'eip155:56',
          token: bscTokenAddress,
          requestedRange: {
            fromBlock: '100000',
            toBlock: '199999',
            segmentSize: 50000,
          },
          nextBlock: secondPage ? '200000' : '150000',
          requestedRangeCoverage: secondPage ? 1 : 0.5,
          evidenceIds: ['ev_projection_terminal'],
          lastErrorCode: null,
          startedAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:01:00.000Z',
          completedAt: secondPage ? '2026-08-10T00:01:00.000Z' : null,
          terminalResult: secondPage
            ? {
                requestedRangeCoverage: 1,
                lifetimeCoverage: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
                terminalEvidenceId: 'ev_projection_terminal',
                metadata: {
                  snapshot,
                  dataCoverage: 1,
                  sourceCoverage: 1,
                  historyCoverage: 0,
                  simulationCoverage: 0,
                  freshness: '2026-08-10T00:01:00.000Z',
                  sourceSet: ['sqd:binance-mainnet', 'bsc-rpc-fixture'],
                  modelVersion: 'flap-event-history-projection-v1',
                  confidence: 0.95,
                  evidenceIds: ['ev_projection_terminal'],
                },
              }
            : null,
        },
        page: {
          afterBlock: afterBlock === null ? null : Number(afterBlock),
          limit: 10,
          hasMore: !secondPage,
          nextAfterBlock: secondPage ? null : 100000,
        },
        segments: [
          {
            id: secondPage ? 'fhs_second_segment' : 'fhs_first_segment',
            scanId: bscFlapHistoryScan,
            fromBlock: secondPage ? '150000' : '100000',
            toBlock: secondPage ? '199999' : '149999',
            transactionCount: secondPage ? 1 : 0,
            unrecognizedPortalLogCount: 0,
            terminalEvidenceId: secondPage ? 'ev_segment_second' : 'ev_segment_first',
            createdAt: '2026-08-10T00:00:00.000Z',
            result: {},
          },
        ],
      }),
    });
  });
  await page.route(
    '**/api/v1/launches/EVM/**/history/lifetime/materializations/**',
    async (route) => {
      const capturedAt = '2026-08-10T00:02:00.000Z';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          scan: {
            id: bscFlapLifetimeScan,
            status: 'REQUESTED_RANGE_COMPLETE',
            source: 'zerotrace:flap-lifetime-materialization-v1',
            chainId: 'eip155:56',
            token: bscTokenAddress,
            dataset: 'binance-mainnet',
            datasetStartBlock: '0',
            targetBlock: '50000103',
            nextBlock: '50000104',
            requestedRangeCoverage: 1,
            evidenceIds: ['ev_lifetime_terminal'],
            lastErrorCode: null,
            startedAt: '2026-08-10T00:00:00.000Z',
            updatedAt: capturedAt,
            completedAt: capturedAt,
            terminalResult: {
              originScanId: '11111111-1111-4111-8111-111111111111',
              originSearchCoverage: 1,
              origin: {
                state: 'known',
                value: {
                  contractCreator: `0x${'b'.repeat(40)}`,
                  launchCreator: `0x${'c'.repeat(40)}`,
                  creationTrace: {
                    blockNumber: '50000000',
                    transactionHash: `0x${'6'.repeat(64)}`,
                  },
                },
              },
              historyProjection: {
                scanId: '22222222-2222-4222-8222-222222222222',
                fromBlock: '50000000',
                toBlock: '50000103',
                segmentCount: 1,
                transactionCount: 2,
                unrecognizedPortalLogCount: 0,
                requestedRangeCoverage: 1,
                terminalEvidenceId: 'ev_history_terminal',
              },
              lifetimeCoverage: { state: 'known', value: true },
              terminalEvidenceId: 'ev_lifetime_terminal',
              metadata: {
                snapshot: {
                  ledger: 'EVM',
                  chainId: 'eip155:56',
                  blockNumber: '50000103',
                  blockHash: `0x${'a'.repeat(64)}`,
                  finality: 'finalized',
                },
                dataCoverage: 1,
                sourceCoverage: 1,
                historyCoverage: 1,
                simulationCoverage: 0,
                freshness: capturedAt,
                sourceSet: ['bsc-rpc-fixture', 'sqd:binance-mainnet'],
                modelVersion: 'flap-lifetime-materialization-v1',
                confidence: 0.97,
                evidenceIds: ['ev_history_terminal', 'ev_lifetime_terminal'],
              },
              evidence: [
                {
                  id: 'ev_lifetime_terminal',
                  ledger: 'EVM',
                  chainId: 'eip155:56',
                  kind: 'DERIVED_FEATURE',
                  source: 'zerotrace:flap-lifetime-materialization-v1',
                  locator: `flap-lifetime:${bscTokenAddress}@50000103`,
                  payloadHash: 'b'.repeat(64),
                  observedAt: capturedAt,
                  blockOrSlot: '50000103',
                  finality: 'finalized',
                  summary:
                    'Flap deployment origin and every supported Portal event are materialized through one finalized target Snapshot.',
                },
              ],
            },
          },
        }),
      });
    },
  );
  await page.route('**/api/v1/launches/EVM/**/history/lifetime/heads/latest*', async (route) => {
    const capturedAt = '2026-08-10T00:03:00.000Z';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        head: {
          id: `flh_${'1'.repeat(24)}`,
          chainId: 'eip155:56',
          token: bscTokenAddress,
          sequence: 3,
          scanId: '44444444-4444-4444-8444-444444444444',
          headType: 'EXTENSION',
          predecessorId: `flh_${'2'.repeat(24)}`,
          targetBlock: 50000105,
          targetHash: `0x${'d'.repeat(64)}`,
          terminalEvidenceId: 'ev_lifetime_head_terminal',
          createdAt: capturedAt,
          result: {
            platform: 'flap',
            token: bscTokenAddress,
            dataset: 'binance-mainnet',
            datasetStartBlock: '0',
            targetBlock: '50000105',
            predecessor: {
              scanId: bscFlapLifetimeScan,
              targetBlock: '50000103',
              targetHash: `0x${'a'.repeat(64)}`,
              terminalEvidenceId: 'ev_lifetime_terminal',
            },
            originScanId: '11111111-1111-4111-8111-111111111111',
            origin: {
              state: 'known',
              value: {
                contractCreator: `0x${'b'.repeat(40)}`,
                launchCreator: `0x${'c'.repeat(40)}`,
                creationTrace: { blockNumber: '50000000', transactionHash: `0x${'6'.repeat(64)}` },
              },
            },
            continuity: {
              status: 'HISTORICAL_MATCH',
              continuous: { state: 'known', value: true },
              evidenceIds: ['ev_lifetime_continuity'],
              terminalEvidenceId: 'ev_lifetime_continuity',
            },
            historyProjection: {
              scanId: '55555555-5555-4555-8555-555555555555',
              fromBlock: '50000104',
              toBlock: '50000105',
              segmentCount: 1,
              transactionCount: 1,
              unrecognizedPortalLogCount: 0,
              requestedRangeCoverage: 1,
              terminalEvidenceId: 'ev_lifetime_delta',
            },
            lifetimeCoverage: { state: 'known', value: true },
            terminalEvidenceId: 'ev_lifetime_head_terminal',
            metadata: {
              snapshot: {
                ledger: 'EVM',
                chainId: 'eip155:56',
                blockNumber: '50000105',
                blockHash: `0x${'d'.repeat(64)}`,
                finality: 'finalized',
              },
              dataCoverage: 1,
              sourceCoverage: 1,
              historyCoverage: 1,
              simulationCoverage: 0,
              freshness: capturedAt,
              sourceSet: ['bsc-rpc-a', 'bsc-rpc-b', 'sqd:binance-mainnet'],
              modelVersion: 'flap-lifetime-extension-v1',
              confidence: 0.97,
              evidenceIds: ['ev_lifetime_head_terminal'],
            },
            evidence: [
              {
                id: 'ev_lifetime_head_terminal',
                ledger: 'EVM',
                chainId: 'eip155:56',
                kind: 'DERIVED_FEATURE',
                source: 'zerotrace:flap-lifetime-extension-v1',
                locator: `flap-lifetime-extension:${bscTokenAddress}:50000103-50000105`,
                payloadHash: 'e'.repeat(64),
                observedAt: capturedAt,
                blockOrSlot: '50000105',
                finality: 'finalized',
                summary: 'Accepted Flap lifetime head extends exact finalized coverage.',
              },
            ],
          },
        },
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
  await page.route('**/api/v1/claims/EVM/**/reports/**', async (route) => {
    const capturedAt = '2026-08-10T12:00:01.404Z';
    const terminalEvidenceId = claimTerminalEvidenceId;
    const metadata = {
      snapshot: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        blockNumber: '115117033',
        blockHash: `0x${'7'.repeat(64)}`,
        finality: 'finalized',
        blockTimestamp: '2026-08-10T12:00:02.000Z',
        capturedAt,
      },
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: '2026-08-10T12:00:02.000Z',
      sourceSet: ['bsc-official-1', 'sqd:binance-mainnet'],
      modelVersion: 'evm-claim-address-observation-v1.0.0',
      confidence: 0.95,
      evidenceIds: [terminalEvidenceId],
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        record: {
          id: `ecr_${'1'.repeat(24)}`,
          chainId: 'eip155:56',
          tokenAddress: bscTokenAddress,
          address: claimAddress,
          fromBlock: '113485950',
          toBlock: '115117033',
          snapshotBlock: '115117033',
          snapshotHash: `0x${'7'.repeat(64)}`,
          resultHash: '8'.repeat(64),
          terminalEvidenceId,
          evidenceIds: [terminalEvidenceId],
          sourceSet: ['bsc-official-1', 'sqd:binance-mainnet'],
          modelVersion: 'evm-claim-address-observation-v1.0.0',
          capturedAt,
          createdAt: capturedAt,
          report: {
            window: {
              from: '2026-08-02T00:00:00.000Z',
              to: '2026-08-10T12:00:02.000Z',
            },
            custody: {
              kind: 'SAFE_MULTISIG',
              canMoveFunds: { state: 'known', value: true },
              threshold: 4,
              ownerCount: 6,
              executedTransactions: 11,
              implementationVersion: '1.3.0',
              evidenceIds: ['ev_373de48c776eebea7c51996e'],
            },
            flow: {
              inflow: {
                observedAmount: '176000010000000000000000000',
                actualAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
                transferCount: 123,
                uniqueCounterparties: 109,
                firstObservedAt: { state: 'known', value: '2026-08-03T09:36:09.000Z' },
                lastObservedAt: { state: 'known', value: '2026-08-10T07:00:48.000Z' },
                evidenceIds: [],
              },
              outflow: {
                observedAmount: '24507000000000000000000000',
                actualAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
                transferCount: 10,
                uniqueCounterparties: 1,
                firstObservedAt: { state: 'known', value: '2026-08-04T11:20:42.000Z' },
                lastObservedAt: { state: 'known', value: '2026-08-10T10:17:50.000Z' },
                evidenceIds: [],
              },
              shareUnitAssessment: {
                unit: '1000000000000000000000000',
                observedDeposits: 123,
                exactUnitDeposits: 71,
                exactMultipleDeposits: 107,
                nonMultipleDeposits: 16,
                observedWholeShares: '176',
                nonMultipleObservedAmount: '10',
                exactMultipleCoverage: { state: 'known', value: 0.8699186991869918 },
              },
              selfTransferCount: 0,
              selfTransferObservedAmount: '0',
              topCounterparties: [
                {
                  direction: 'OUTFLOW',
                  address: '0x343e8a70b212816a5582a880b9cd4c3278c4f360',
                  observedAmount: '24507000000000000000000000',
                  transferCount: 10,
                  firstObservedAt: '2026-08-04T11:20:42.000Z',
                  lastObservedAt: '2026-08-10T10:17:50.000Z',
                  evidenceIds: [],
                },
              ],
              metadata,
            },
            terminalEvidenceId,
            metadata,
          },
        },
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

  await expect(page.getByRole('heading', { name: 'Claim Report' })).toBeVisible();
  await page.getByLabel('Claim wallet address').fill(claimAddress);
  await page.getByRole('button', { name: 'Load latest report' }).click();
  const claimPanel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Claim Report' }),
  });
  await expect(claimPanel).toContainText('Safe Multisig');
  await expect(claimPanel).toContainText('4-of-6 threshold');
  await expect(claimPanel).toContainText('176000010000000000000000000');
  await expect(claimPanel).toContainText('Insufficient Data');
  await expect(claimPanel.getByText('Observed whole shares')).toBeVisible();
  await expect(claimPanel.getByText('176', { exact: true })).toBeVisible();
  await expect(claimPanel.getByText('Non-multiple deposits')).toBeVisible();
  await expect(claimPanel.getByText('16', { exact: true })).toBeVisible();
  await expect(claimPanel).toContainText(claimTerminalEvidenceId);

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
  await expect(
    page.locator('.event-panel .snapshot-strip').filter({ hasText: 'Classification' }),
  ).toContainText('History coverage');
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
  const historyPanel = page.locator('.event-history-panel').filter({
    has: page.getByRole('heading', { name: 'Flap bounded event history' }),
  });
  await expect(historyPanel).toContainText('Range coverage 100%');
  await expect(historyPanel).toContainText('Lifetime coverage Insufficient Data');
  await expect(historyPanel).toContainText('Block 49900000 · Creation Configuration');
  await expect(page.getByRole('heading', { name: 'Flap history evidence ledger' })).toBeVisible();
  await expect(
    page.getByText('Flap event transactions discovered in the requested bounded range.'),
  ).toBeVisible();

  await expect(
    page.getByRole('heading', { name: 'Flap durable history projection' }),
  ).toBeVisible();
  await page.getByLabel('Worker scan ID').fill(bscFlapHistoryScan);
  await page.getByRole('button', { name: 'Replay projection' }).click();
  const projectionPanel = page.locator('.event-history-panel').filter({
    has: page.getByRole('heading', { name: 'Flap durable history projection' }),
  });
  await expect(projectionPanel).toContainText('Range coverage 50%');
  await expect(projectionPanel).toContainText('Blocks 100000–149999 · 0 transactions');
  await page.getByRole('button', { name: 'Next stored page' }).click();
  await expect(projectionPanel).toContainText('Range coverage 100%');
  await expect(projectionPanel).toContainText('Lifetime coverage Insufficient Data');
  await expect(projectionPanel).toContainText('Blocks 150000–199999 · 1 transactions');

  await page.getByLabel('Worker scan ID').fill(unavailableFlapHistoryScan);
  await page.getByRole('button', { name: 'Replay projection' }).click();
  await expect(page.getByText('Projection replay unavailable')).toBeVisible();
  await expect(page.getByText('Durable history projection storage is unavailable.')).toBeVisible();

  await expect(
    page.getByRole('heading', { name: 'Flap exact lifetime materialization' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load latest accepted head' }).click();
  const lifetimePanel = page.locator('.event-history-panel').filter({
    has: page.getByRole('heading', { name: 'Flap exact lifetime materialization' }),
  });
  await expect(lifetimePanel).toContainText('Accepted sequence 3');
  await expect(lifetimePanel).toContainText('Head type Extension');
  await expect(lifetimePanel).toContainText('Historical Match · 50000103 → 50000105');
  await expect(
    page.getByRole('heading', { name: 'Latest Flap lifetime head Evidence root' }),
  ).toBeVisible();
  await expect(
    page.getByText('Accepted Flap lifetime head extends exact finalized coverage.'),
  ).toBeVisible();
  await page.getByLabel('Lifetime materialization scan ID').fill(bscFlapLifetimeScan);
  await page.getByRole('button', { name: 'Replay lifetime proof' }).click();
  await expect(lifetimePanel).toContainText('Materialization coverage 100%');
  await expect(lifetimePanel).toContainText('Lifetime coverage true');
  await expect(lifetimePanel).toContainText('Block 50000000');
  await expect(lifetimePanel).toContainText('1 segments · 2 transactions');
  await expect(page.getByRole('heading', { name: 'Flap lifetime Evidence root' })).toBeVisible();
  await expect(
    page.getByText(
      'Flap deployment origin and every supported Portal event are materialized through one finalized target Snapshot.',
    ),
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

test('renders migrated Flap buy and exit scenarios without calling custody a burn or RV complete', async ({
  page,
}) => {
  const quoteAsset = '0x55d398326f99059ff775485246999027b3197955';
  const pool = '0xe374af9818c4359374996f86a734fc39eb04d949';
  const terminalEvidenceId = 'ev_1234567890abcdef12345678';
  const sellTerminalEvidenceId = 'ev_abcdef1234567890abcdef12';
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
          nativeBalanceWei: { state: 'known', value: '0' },
          bytecodePresent: { state: 'known', value: true },
        },
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            blockNumber: '115128697',
            blockHash: `0x${'8'.repeat(64)}`,
            finality: 'finalized',
          },
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: '2026-08-10T13:00:00.000Z',
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
          lifecycle: 'DEX_TRADING',
          quoteAsset: { state: 'known', value: quoteAsset },
          spotPrice: {
            state: 'unknown',
            reason: 'NOT_APPLICABLE',
            detail: 'Portal price is not the DEX market price.',
          },
          curveType: { state: 'known', value: 'FLAP_VIRTUAL_CONSTANT_PRODUCT' },
          realQuoteReserve: { state: 'known', value: '0' },
          virtualBaseReserve: { state: 'known', value: '107036752000000000000000000' },
          virtualQuoteReserve: { state: 'known', value: '3837000000000000000000' },
          circulatingSupply: { state: 'known', value: '1000000000000000000000000000' },
          remainingSupply: { state: 'known', value: '0' },
          progress: { state: 'known', value: '1' },
          graduationThreshold: { state: 'known', value: '800000000000000000000000000' },
          currentSellCapacity: { state: 'unknown', reason: 'NOT_QUERIED' },
          taxModel: { state: 'known', value: 'FLAP_TAX_V3' },
          buyTaxBps: { state: 'known', value: '300' },
          sellTaxBps: { state: 'known', value: '300' },
          migrationPool: { state: 'known', value: pool },
          lpLocked: { state: 'unknown', reason: 'NOT_QUERIED' },
          lpBurned: { state: 'unknown', reason: 'NOT_QUERIED' },
          sourceBlockOrSlot: '115128697',
          sourceVersion: 'flap:getTokenV8Safe:flap-sh/FlapVaultExample@0a6ad1b',
          evidenceIds: ['ev_flap_dex'],
        },
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            blockNumber: '115128697',
            blockHash: `0x${'8'.repeat(64)}`,
            finality: 'finalized',
          },
          dataCoverage: 0.7,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: '2026-08-10T13:00:00.000Z',
          sourceSet: ['bsc-rpc-fixture'],
          modelVersion: 'flap-inspector-getTokenV8Safe-v0.1.0',
          confidence: 0.95,
          evidenceIds: ['ev_flap_dex'],
        },
        evidence: [
          {
            id: 'ev_flap_dex',
            ledger: 'EVM',
            chainId: 'eip155:56',
            kind: 'DERIVED_FEATURE',
            source: 'zerotrace:flap-inspector',
            locator: `flap:${bscTokenAddress}@115128697`,
            payloadHash: '8'.repeat(64),
            observedAt: '2026-08-10T13:00:00.000Z',
            blockOrSlot: '115128697',
            finality: 'finalized',
            summary: 'Migrated Flap launch mechanism normalized from Portal state.',
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/rv/flap-pancake-v2-buy-scenarios', async (route) => {
    const point = (
      quoteInput: string,
      gross: string,
      net: string,
      average: string,
      postPrice: string,
      priceMove: string,
    ) => ({
      quoteInput: { atomic: `${quoteInput}000000000000000000`, decimal: quoteInput },
      officialRouterGrossTokenOutput: { atomic: gross.replace('.', ''), decimal: gross },
      deterministicPoolGrossTokenOutput: { atomic: gross.replace('.', ''), decimal: gross },
      configuredTaxNetTokenOutput: {
        state: 'known',
        value: { atomic: net.replace('.', ''), decimal: net },
      },
      executionNetTokenOutput: {
        state: 'unknown',
        reason: 'NOT_QUERIED',
        detail: 'Pinned-fork execution has not run.',
      },
      averageGrossBuyPrice: { state: 'known', value: average },
      averageConfiguredTaxBuyPrice: { state: 'known', value: average },
      modeledPostBuySpotPrice: postPrice,
      modeledPriceChangeBps: priceMove,
      deterministicQuoteErrorBps: '0',
      deterministicToleranceBps: '10',
      withinDeterministicTolerance: true,
      assumption: 'Pool-only exact-input model.',
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        platform: 'flap',
        token: bscTokenAddress,
        market: {
          state: 'known',
          value: {
            venue: 'PANCAKESWAP_V2',
            chainId: 'eip155:56',
            pool,
            factory: '0xca143ce32fe78f1f7019d7d551a6402fc5350c73',
            router: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
            token: bscTokenAddress,
            quoteAsset,
            token0: quoteAsset,
            token1: bscTokenAddress,
            tokenDecimals: 18,
            quoteDecimals: 18,
            tokenReserve: {
              atomic: '73899426572496252333612006',
              decimal: '73899426.572496252333612006',
            },
            quoteReserve: {
              atomic: '30546942096796964000250',
              decimal: '30546.94209679696400025',
            },
            currentSpotPriceWad: '413358773223814',
            currentSpotPrice: '0.000413358773223814',
            dexFeeBps: '25',
            configuredBuyTaxBps: { state: 'known', value: '300' },
            configuredSellTaxBps: { state: 'known', value: '300' },
            pairTimestampLast: '1786366800',
            sourceRevision: 'pancakeswap-v2-bsc-registry-and-fee@2026-08-10',
          },
        },
        scenarios: [
          point(
            '100',
            '240530.618355934388100371',
            '233314.699805256356457359',
            '0.000428605675',
            '0.000416057',
            '65.28',
          ),
          point(
            '1000',
            '2336851.537264944410055320',
            '2266745.991147',
            '0.00044116',
            '0.00044075',
            '662.6',
          ),
          point(
            '10000',
            '18191299.377995940224635248',
            '17645560.396656',
            '0.00056675',
            '0.000721',
            '7444.2',
          ),
        ],
        validation: {
          status: 'PASS',
          deterministicToleranceBps: '10',
          evaluatedScenarioCount: 3,
          failedScenarioCount: 0,
        },
        pensionSinkTreatment: {
          state: 'unknown',
          reason: 'INSUFFICIENT_DATA',
          detail:
            'A transfer to the pension wallet is movable custody, not supply burn. The displayed post-buy price counts only the pool trade and no extra sink effect.',
        },
        terminalEvidenceId,
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            blockNumber: '115128697',
            blockHash: `0x${'8'.repeat(64)}`,
            finality: 'finalized',
          },
          dataCoverage: 0.85,
          sourceCoverage: 0.67,
          historyCoverage: 0,
          simulationCoverage: 0.5,
          freshness: '2026-08-10T13:00:00.000Z',
          sourceSet: ['bsc-rpc-fixture', 'pancakeswap-official-v2-registry@2026-08-10'],
          modelVersion: 'flap-pancake-v2-pool-buy-scenarios-v0.1.0',
          confidence: 0.96,
          evidenceIds: [terminalEvidenceId],
        },
        evidence: [
          {
            id: terminalEvidenceId,
            ledger: 'EVM',
            chainId: 'eip155:56',
            kind: 'DERIVED_FEATURE',
            source: 'zerotrace:flap-pancake-v2-pool-buy-scenarios-v0.1.0',
            locator: `rv:flap-pancake-v2-buy:${bscTokenAddress}@115128697`,
            payloadHash: '9'.repeat(64),
            observedAt: '2026-08-10T13:00:00.000Z',
            blockOrSlot: '115128697',
            finality: 'finalized',
            summary:
              'Pancake V2 spot price and buy-size scenarios derived from same-Snapshot state.',
          },
        ],
      }),
    });
  });
  let pensionEntryResult: Record<string, unknown> | undefined;
  await page.route('**/api/v1/rv/flap-pancake-v2-pension-entry-scenarios', async (route) => {
    const pensionWallet = '0x8d50a68b4f9ada119d198d6472eaf0cb6db302d9';
    const pensionTerminalEvidenceId = 'ev_2468ace02468ace02468ace0';
    const candidateEvidenceId = 'ev_fd1eaba3374aa73bf4eb1230';
    const reportTerminalEvidenceId = 'ev_dda9728dd1f05d64175d9f4d';
    const entry = (
      quoteInput: string,
      netToken: string,
      shareEquivalent: string,
      wholeShares: string,
      averageCost: string,
      committed: string,
      remainder: string,
      postPrice: string,
    ) => ({
      buyScenario: {
        quoteInput: { atomic: `${quoteInput}000000000000000000`, decimal: quoteInput },
        officialRouterGrossTokenOutput: { atomic: netToken.replace('.', ''), decimal: netToken },
        deterministicPoolGrossTokenOutput: { atomic: netToken.replace('.', ''), decimal: netToken },
        configuredTaxNetTokenOutput: {
          state: 'known',
          value: { atomic: netToken.replace('.', ''), decimal: netToken },
        },
        executionNetTokenOutput: { state: 'unknown', reason: 'NOT_QUERIED' },
        averageGrossBuyPrice: { state: 'known', value: averageCost },
        averageConfiguredTaxBuyPrice: { state: 'known', value: averageCost },
        modeledPostBuySpotPrice: postPrice,
        modeledPriceChangeBps: '10',
        deterministicQuoteErrorBps: '0',
        deterministicToleranceBps: '10',
        withinDeterministicTolerance: true,
        assumption: 'Pool-only exact-input model.',
      },
      modeledNetTokenOutput: {
        state: 'known',
        value: { atomic: netToken.replace('.', ''), decimal: netToken },
      },
      modeledShareEquivalent: { state: 'known', value: shareEquivalent },
      modeledWholeShares: { state: 'known', value: wholeShares },
      modeledCommittedTokenAmount: {
        state: 'known',
        value: { atomic: committed.replace('.', ''), decimal: committed },
      },
      modeledRemainderTokenAmount: {
        state: 'known',
        value: { atomic: remainder.replace('.', ''), decimal: remainder },
      },
      modeledQuoteCostForCommittedShares: {
        state: 'known',
        value: { atomic: quoteInput, decimal: quoteInput },
      },
      modeledAverageQuoteCostPerShare: {
        state: 'known',
        value: { atomic: averageCost.replace('.', ''), decimal: averageCost },
      },
      modeledPostDepositSpotPrice: { state: 'known', value: postPrice },
      executionNetTokenOutput: { state: 'unknown', reason: 'NOT_QUERIED' },
      executionWholeShares: { state: 'unknown', reason: 'NOT_QUERIED' },
      executionPostDepositSpotPrice: { state: 'unknown', reason: 'NOT_QUERIED' },
      assumption: 'Custody-only modeled deposit.',
    });
    pensionEntryResult = {
      platform: 'flap',
      token: bscTokenAddress,
      behavior: {
        reportId: 'pcr_ff8cd2b24f23d71758cf3e63',
        resultHash: '4'.repeat(64),
        wallet: pensionWallet,
        shareUnit: {
          atomic: '1000000000000000000000000',
          decimal: '1000000',
        },
        fromBlock: '113485950',
        toBlock: '115257276',
        snapshotHash: `0x${'7'.repeat(64)}`,
        observedWholeShares: '164',
        candidateEvidenceId,
        reportTerminalEvidenceId,
        roleAttribution: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        participantExitPolicy: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        dividendExecution: { state: 'unknown', reason: 'NOT_QUERIED' },
      },
      market: { state: 'known', value: { token: bscTokenAddress } },
      entries: [
        entry(
          '100',
          '233314.699805256356457359',
          '0.233314699805256356',
          '0',
          '428.605675',
          '0',
          '233314.699805256356457359',
          '0.000416057',
        ),
        entry(
          '1000',
          '2266745.991147',
          '2.266745991147',
          '2',
          '441.16',
          '2000000',
          '266745.991147',
          '0.00044075',
        ),
        entry(
          '10000',
          '17645560.396656',
          '17.645560396656',
          '17',
          '566.75',
          '17000000',
          '645560.396656',
          '0.000721',
        ),
      ],
      validation: {
        status: 'PASS',
        deterministicToleranceBps: '10',
        evaluatedScenarioCount: 3,
        failedScenarioCount: 0,
      },
      destinationTreatment: 'NON_ZERO_CUSTODY_ADDRESS',
      totalSupplyReduction: { state: 'unknown', reason: 'NOT_QUERIED' },
      custodyIrreversible: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      terminalEvidenceId: pensionTerminalEvidenceId,
      metadata: {
        snapshot: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          blockNumber: '115257276',
          blockHash: `0x${'7'.repeat(64)}`,
          finality: 'finalized',
        },
        dataCoverage: 0.85,
        sourceCoverage: 0.5,
        historyCoverage: 1,
        simulationCoverage: 0.5,
        freshness: '2026-08-11T05:32:07.000Z',
        sourceSet: ['bsc-rpc-fixture', 'sqd:binance-mainnet'],
        modelVersion: 'flap-pension-entry-economics-v0.1.0',
        confidence: 0.8,
        evidenceIds: [candidateEvidenceId, reportTerminalEvidenceId, pensionTerminalEvidenceId],
      },
      evidence: [
        {
          id: candidateEvidenceId,
          ledger: 'EVM',
          chainId: 'eip155:56',
          kind: 'DERIVED_FEATURE',
          source: 'zerotrace:evm-pension-candidate-discovery-v1.0.0',
          locator: `pension-behavior-candidate:${pensionWallet}`,
          payloadHash: '1'.repeat(64),
          observedAt: '2026-08-11T05:32:07.000Z',
          blockOrSlot: '115257276',
          finality: 'finalized',
          summary: 'Repeated exact-unit deposit behavior candidate.',
        },
        {
          id: reportTerminalEvidenceId,
          ledger: 'EVM',
          chainId: 'eip155:56',
          kind: 'DERIVED_FEATURE',
          source: 'zerotrace:evm-pension-candidate-discovery-v1.0.0',
          locator: `pension-behavior-discovery:${bscTokenAddress}`,
          payloadHash: '2'.repeat(64),
          observedAt: '2026-08-11T05:32:07.000Z',
          blockOrSlot: '115257276',
          finality: 'finalized',
          summary: 'Complete FFT pension behavior range.',
        },
        {
          id: pensionTerminalEvidenceId,
          ledger: 'EVM',
          chainId: 'eip155:56',
          kind: 'DERIVED_FEATURE',
          source: 'zerotrace:flap-pension-entry-economics-v0.1.0',
          locator: `rv:flap-pension-entry:${bscTokenAddress}@115257276`,
          payloadHash: '3'.repeat(64),
          observedAt: '2026-08-11T05:32:07.000Z',
          blockOrSlot: '115257276',
          finality: 'finalized',
          summary: 'Pension-entry share capacity and average acquisition cost derived.',
        },
      ],
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...pensionEntryResult,
        durableReport: {
          id: 'per_13579bdf13579bdf13579bdf',
          resultHash: '5'.repeat(64),
          createdAt: '2026-08-11T05:33:07.000Z',
        },
      }),
    });
  });
  await page.route(
    '**/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/latest?*',
    async (route) => {
      if (pensionEntryResult === undefined) {
        await route.fulfill({ status: 404, body: 'Scenario Report not created.' });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          replayed: true,
          record: {
            id: 'per_13579bdf13579bdf13579bdf',
            chainId: 'eip155:56',
            tokenAddress: bscTokenAddress,
            pensionReportId: 'pcr_ff8cd2b24f23d71758cf3e63',
            pensionWallet: '0x8d50a68b4f9ada119d198d6472eaf0cb6db302d9',
            blockNumber: '115257276',
            snapshotHash: `0x${'7'.repeat(64)}`,
            resultHash: '5'.repeat(64),
            report: pensionEntryResult,
            terminalEvidenceId: 'ev_2468ace02468ace02468ace0',
            evidenceIds: [
              'ev_fd1eaba3374aa73bf4eb1230',
              'ev_dda9728dd1f05d64175d9f4d',
              'ev_2468ace02468ace02468ace0',
            ],
            sourceSet: ['bsc-rpc-fixture', 'sqd:binance-mainnet'],
            modelVersion: 'flap-pension-entry-economics-v0.1.0',
            capturedAt: '2026-08-11T05:32:07.000Z',
            createdAt: '2026-08-11T05:33:07.000Z',
          },
        }),
      });
    },
  );
  await page.route('**/api/v1/rv/flap-pancake-v2-sell-scenarios', async (route) => {
    const point = (
      tokenInput: string,
      nominal: string,
      gross: string,
      configuredNet: string,
      average: string,
      postPrice: string,
      impact: string,
      reserveUsed: string,
    ) => ({
      tokenInput: { atomic: tokenInput.replace('.', ''), decimal: tokenInput },
      nominalSpotQuoteValue: { atomic: nominal.replace('.', ''), decimal: nominal },
      officialRouterGrossQuoteOutput: { atomic: gross.replace('.', ''), decimal: gross },
      deterministicPoolGrossQuoteOutput: { atomic: gross.replace('.', ''), decimal: gross },
      configuredTaxTokenInputToPool: {
        state: 'known',
        value: {
          atomic: `${Math.trunc(Number(tokenInput) * 0.97)}000000000000000000`,
          decimal: String(Number(tokenInput) * 0.97),
        },
      },
      configuredTaxNetQuoteOutput: {
        state: 'known',
        value: { atomic: configuredNet.replace('.', ''), decimal: configuredNet },
      },
      executionNetQuoteOutput: {
        state: 'unknown',
        reason: 'NOT_QUERIED',
        detail: 'Pinned-fork settlement balance delta has not run.',
      },
      averageGrossExitPrice: { state: 'known', value: average },
      averageConfiguredTaxExitPrice: { state: 'known', value: average },
      modeledGrossPostSellSpotPrice: postPrice,
      modeledConfiguredTaxPostSellSpotPrice: { state: 'known', value: postPrice },
      grossPriceImpactBps: impact,
      configuredTotalExitHaircutBps: { state: 'known', value: impact },
      grossQuoteReserveConsumedBps: reserveUsed,
      configuredTaxQuoteReserveConsumedBps: { state: 'known', value: reserveUsed },
      deterministicQuoteErrorBps: '0',
      deterministicToleranceBps: '10',
      withinDeterministicTolerance: true,
      assumption: 'Configured-tax pool-only sell estimate.',
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        platform: 'flap',
        token: bscTokenAddress,
        market: {
          state: 'known',
          value: {
            venue: 'PANCAKESWAP_V2',
            chainId: 'eip155:56',
            pool,
            factory: '0xca143ce32fe78f1f7019d7d551a6402fc5350c73',
            router: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
            token: bscTokenAddress,
            quoteAsset,
            token0: quoteAsset,
            token1: bscTokenAddress,
            tokenDecimals: 18,
            quoteDecimals: 18,
            tokenReserve: {
              atomic: '73899426572496252333612006',
              decimal: '73899426.572496252333612006',
            },
            quoteReserve: {
              atomic: '30546942096796964000250',
              decimal: '30546.94209679696400025',
            },
            currentSpotPriceWad: '413358773223814',
            currentSpotPrice: '0.000413358773223814',
            dexFeeBps: '25',
            configuredBuyTaxBps: { state: 'known', value: '300' },
            configuredSellTaxBps: { state: 'known', value: '300' },
            pairTimestampLast: '1786366800',
            sourceRevision: 'pancakeswap-v2-bsc-registry-and-fee@2026-08-10',
          },
        },
        scenarios: [
          point(
            '1000000',
            '413.358773223814',
            '407.366',
            '395.312',
            '0.000395312',
            '0.00040277',
            '437.1',
            '129.41',
          ),
          point(
            '5000000',
            '2066.79386611907',
            '1936.82',
            '1882.11',
            '0.000376422',
            '0.0003632',
            '893.5',
            '616.12',
          ),
          point(
            '10000000',
            '4133.58773223814',
            '3631.44',
            '3534.21',
            '0.000353421',
            '0.0003198',
            '1450.2',
            '1157.0',
          ),
        ],
        validation: {
          status: 'PASS',
          deterministicToleranceBps: '10',
          evaluatedScenarioCount: 3,
          failedScenarioCount: 0,
        },
        executionCapacity: {
          state: 'unknown',
          reason: 'NOT_QUERIED',
          detail:
            'Pool reserve consumption is modeled, but executable max-sell and revert capacity require a pinned-fork execution.',
        },
        terminalEvidenceId: sellTerminalEvidenceId,
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            blockNumber: '115128697',
            blockHash: `0x${'8'.repeat(64)}`,
            finality: 'finalized',
          },
          dataCoverage: 0.9,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0.5,
          freshness: '2026-08-10T13:00:00.000Z',
          sourceSet: ['bsc-rpc-fixture', 'pancakeswap-official-v2-registry@2026-08-10'],
          modelVersion: 'flap-pancake-v2-pool-sell-scenarios-v0.1.0',
          confidence: 0.94,
          evidenceIds: [sellTerminalEvidenceId],
        },
        evidence: [
          {
            id: sellTerminalEvidenceId,
            ledger: 'EVM',
            chainId: 'eip155:56',
            kind: 'DERIVED_FEATURE',
            source: 'zerotrace:flap-pancake-v2-pool-sell-scenarios-v0.1.0',
            locator: `rv:flap-pancake-v2-sell:${bscTokenAddress}@115128697`,
            payloadHash: '7'.repeat(64),
            observedAt: '2026-08-10T13:00:00.000Z',
            blockOrSlot: '115128697',
            finality: 'finalized',
            summary:
              'Pancake V2 nominal, gross and configured-tax sell scenarios derived from certified same-Snapshot market state.',
          },
        ],
      }),
    });
  });

  await page.route('**/api/v1/rv/flap-pancake-v2-reconciliation', async (route) => {
    const snapshot = {
      ledger: 'EVM',
      chainId: 'eip155:56',
      blockNumber: '115128697',
      blockHash: `0x${'8'.repeat(64)}`,
      finality: 'finalized',
      capturedAt: '2026-08-10T13:00:00.000Z',
    };
    const market = {
      venue: 'PANCAKESWAP_V2',
      chainId: 'eip155:56',
      pool,
      factory: '0xca143ce32fe78f1f7019d7d551a6402fc5350c73',
      router: '0x10ed43c718714eb63d5aa57b78b54704e256024e',
      token: bscTokenAddress,
      quoteAsset,
      token0: quoteAsset,
      token1: bscTokenAddress,
      tokenDecimals: 18,
      quoteDecimals: 18,
      tokenReserve: {
        atomic: '73899426572496252333612006',
        decimal: '73899426.572496252333612006',
      },
      quoteReserve: {
        atomic: '30546942096796964000250',
        decimal: '30546.94209679696400025',
      },
      currentSpotPriceWad: '413358773223814',
      currentSpotPrice: '0.000413358773223814',
      dexFeeBps: '25',
      configuredBuyTaxBps: { state: 'known', value: '300' },
      configuredSellTaxBps: { state: 'known', value: '300' },
      pairTimestampLast: '1786366800',
      sourceRevision: 'pancakeswap-v2-bsc-registry-and-fee@2026-08-10',
    };
    const childMetadata = (sourceId: string, evidenceId: string, modelVersion: string) => ({
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 0,
      simulationCoverage: 0.5,
      freshness: snapshot.capturedAt,
      sourceSet: [sourceId],
      modelVersion,
      confidence: 0.98,
      evidenceIds: [evidenceId],
    });
    const reconciliationSource = (sourceId: string, operatorId: string, suffix: string) => ({
      sourceId,
      operatorId: { state: 'known', value: operatorId },
      buy: {
        platform: 'flap',
        token: bscTokenAddress,
        market: { state: 'known', value: market },
        scenarios: [],
        validation: {
          status: 'PASS',
          deterministicToleranceBps: '10',
          evaluatedScenarioCount: 3,
          failedScenarioCount: 0,
        },
        pensionSinkTreatment: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        terminalEvidenceId: `ev_${suffix.repeat(24).slice(0, 24)}`,
        metadata: childMetadata(
          sourceId,
          `ev_${suffix.repeat(24).slice(0, 24)}`,
          'flap-pancake-v2-pool-buy-scenarios-v0.1.0',
        ),
        evidence: [],
      },
      sell: {
        platform: 'flap',
        token: bscTokenAddress,
        market: { state: 'known', value: market },
        scenarios: [],
        validation: {
          status: 'PASS',
          deterministicToleranceBps: '10',
          evaluatedScenarioCount: 3,
          failedScenarioCount: 0,
        },
        executionCapacity: { state: 'unknown', reason: 'NOT_QUERIED' },
        terminalEvidenceId: `ev_${suffix.repeat(12).slice(0, 12)}${'f'.repeat(12)}`,
        metadata: childMetadata(
          sourceId,
          `ev_${suffix.repeat(12).slice(0, 12)}${'f'.repeat(12)}`,
          'flap-pancake-v2-pool-sell-scenarios-v0.1.0',
        ),
        evidence: [],
      },
    });
    const comparisonCheck = (
      id: string,
      fieldPath: string,
      comparisonClass: 'EXACT_IDENTITY_STATE' | 'INDEPENDENT_MARKET_QUOTE_RV',
      passThresholdPct: string,
    ) => ({
      id,
      fieldPath,
      comparisonClass,
      disposition: 'PASS',
      severity: comparisonClass === 'EXACT_IDENTITY_STATE' ? 'CRITICAL' : 'HIGH',
      actual: { state: 'known', value: '30546942096796964000250' },
      reference: { state: 'known', value: '30546942096796964000250' },
      absoluteError: { state: 'known', value: '0' },
      relativeErrorPct: { state: 'known', value: '0' },
      passThresholdPct: { state: 'known', value: passThresholdPct },
      warningThresholdPct: { state: 'known', value: passThresholdPct },
      coverage: 1,
      requiredCoverage: 1,
      sourceIndependence: { state: 'known', value: true },
      sourceIndependenceEvidenceIds: ['ev_333333333333333333333333'],
      numericDenominatorIncluded: comparisonClass !== 'EXACT_IDENTITY_STATE',
      sourceSet: ['bsc-rpc@bnb-mainnet.g.alchemy.com#1', 'bsc-rpc@bsc-dataseed.bnbchain.org#2'],
      evidenceIds: ['ev_444444444444444444444444'],
      explanationEvidenceIds: [],
      message: 'Both source observations agree within the configured comparison budget.',
    });
    const evidence = [
      {
        id: 'ev_111111111111111111111111',
        ledger: 'EVM',
        chainId: 'eip155:56',
        kind: 'ANALYST_OBSERVATION',
        source: 'zerotrace:source-operator-registry-v1',
        locator: 'source-operator-registry:fixture',
        payloadHash: '1'.repeat(64),
        observedAt: '2026-08-10T00:00:00.000Z',
        finality: 'versioned-registry',
        summary: 'Versioned source-operator registry compiled from official endpoint documents.',
      },
      {
        id: 'ev_555555555555555555555555',
        ledger: 'EVM',
        chainId: 'eip155:56',
        kind: 'DERIVED_FEATURE',
        source: 'zerotrace:flap-pancake-v2-multi-source-reconciliation-v1.0.0',
        locator: `flap-market-reconciliation:${bscTokenAddress}@115128697`,
        payloadHash: '5'.repeat(64),
        observedAt: snapshot.capturedAt,
        blockOrSlot: snapshot.blockNumber,
        finality: snapshot.finality,
        summary: 'Independent market and realizable-value observations reconcile at one Snapshot.',
      },
    ];
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        platform: 'flap',
        token: bscTokenAddress,
        status: 'PASS',
        blockNumber: snapshot.blockNumber,
        blockHash: snapshot.blockHash,
        anchorReconciliation: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          status: 'AGREEMENT',
          requiredSources: 2,
          configuredSources: 2,
          observedSources: 2,
          comparisonPosition: { state: 'known', value: snapshot.blockNumber },
          canonicalAnchor: {
            state: 'known',
            value: {
              position: snapshot.blockNumber,
              hash: snapshot.blockHash,
              finality: snapshot.finality,
            },
          },
          sourceIndependence: { state: 'unknown', reason: 'NOT_QUERIED' },
          sources: [],
          alerts: [],
          metadata: childMetadata('bsc-anchor-reconciler', 'ev_222222222222222222222222', 'x'),
        },
        sourceIndependence: {
          status: 'VERIFIED_INDEPENDENT',
          independence: { state: 'known', value: true },
          requiredOperators: 2,
          observedSources: 2,
          operatorCount: 2,
          unresolvedSources: [],
          attestations: [
            {
              sourceId: 'bsc-rpc@bnb-mainnet.g.alchemy.com#1',
              hostname: 'bnb-mainnet.g.alchemy.com',
              operatorId: 'alchemy',
              operatorName: 'Alchemy',
              officialSource: 'https://www.alchemy.com/docs/reference/node-supported-chains',
              registryObservedAt: '2026-08-10T00:00:00.000Z',
              registryRevision: 'alchemy-bnb-chain-api@2026-08-10',
              evidenceId: 'ev_666666666666666666666666',
            },
            {
              sourceId: 'bsc-rpc@bsc-dataseed.bnbchain.org#2',
              hostname: 'bsc-dataseed.bnbchain.org',
              operatorId: 'bnb-chain',
              operatorName: 'BNB Chain',
              officialSource:
                'https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/',
              registryObservedAt: '2026-08-10T00:00:00.000Z',
              registryRevision: 'bnb-chain-bsc-json-rpc-endpoints@2026-08-10',
              evidenceId: 'ev_777777777777777777777777',
            },
          ],
          registryEvidenceId: 'ev_111111111111111111111111',
          terminalEvidenceId: 'ev_333333333333333333333333',
          evidenceIds: [
            'ev_111111111111111111111111',
            'ev_666666666666666666666666',
            'ev_777777777777777777777777',
            'ev_333333333333333333333333',
          ],
          modelVersion: 'source-operator-registry-v1',
        },
        sources: [
          reconciliationSource('bsc-rpc@bnb-mainnet.g.alchemy.com#1', 'alchemy', 'a'),
          reconciliationSource('bsc-rpc@bsc-dataseed.bnbchain.org#2', 'bnb-chain', 'b'),
        ],
        audit: {
          status: 'PASS',
          checks: [
            comparisonCheck(
              'dq_111111111111111111111111',
              'sources[1].market.quoteReserve.atomic',
              'EXACT_IDENTITY_STATE',
              '0',
            ),
            comparisonCheck(
              'dq_222222222222222222222222',
              'sources[1].buy.scenarios[100].officialRouterGrossTokenOutput.atomic',
              'INDEPENDENT_MARKET_QUOTE_RV',
              '0.5',
            ),
          ],
          summary: {
            total: 2,
            passed: 2,
            warnings: 0,
            failed: 0,
            inconclusive: 0,
            numericDenominator: 1,
            coverageGaps: 0,
          },
          metadata: childMetadata(
            'bsc-reconciliation',
            'ev_444444444444444444444444',
            'typed-discrepancy-engine-v1.0.0',
          ),
        },
        terminalEvidenceId: 'ev_555555555555555555555555',
        metadata: {
          ...childMetadata(
            'bsc-reconciliation',
            'ev_555555555555555555555555',
            'flap-pancake-v2-multi-source-reconciliation-v1.0.0',
          ),
          sourceSet: ['bsc-rpc@bnb-mainnet.g.alchemy.com#1', 'bsc-rpc@bsc-dataseed.bnbchain.org#2'],
        },
        evidence,
      }),
    });
  });

  await page.route('**/api/v1/claims/declarations/parse', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        parserVersion: 'claim-declaration-parser-v1.0.0',
        documentHash: '9'.repeat(64),
        assetId: `eip155:56:erc20:${bscTokenAddress}`,
        evidence: {
          id: 'ev_9876543210abcdef98765432',
          ledger: 'EVM',
          chainId: 'eip155:56',
          kind: 'ANALYST_OBSERVATION',
          source: 'api:user-submitted-claim-declaration',
          locator: `claim-declaration:${'9'.repeat(64)}`,
          payloadHash: 'a'.repeat(64),
          observedAt: '2026-08-10T15:00:00.000Z',
          summary: 'Off-chain claim declaration; it is not a chain fact.',
        },
        drafts: [
          {
            id: 'cld_1234567890abcdef12345678',
            assetId: `eip155:56:erc20:${bscTokenAddress}`,
            role: 'COMMUNITY_FUND',
            expectedAction: 'DISTRIBUTE',
            sourceAddress: {
              state: 'known',
              value: '0x8231bb4e2891e85e79f28f0816ede7aeaab06af1',
            },
            destinationAddress: {
              state: 'known',
              value: '0x412dfd5ac528c05ab78cd005385bc51759e29e46',
            },
            expectedShareBps: { state: 'known', value: '2000' },
            shareUnitTokens: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            noExit: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            cadenceSeconds: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            window: {
              state: 'known',
              value: {
                from: '2026-08-02T00:00:00.000Z',
                to: '2026-08-10T00:00:00.000Z',
              },
            },
            matchedText: '社区建设基金（20%）\n0x412DFD5Ac528C05ab78cd005385bC51759e29e46',
            missingFields: [],
            chainVerifyReadiness: 'READY_FOR_REVIEW',
            requiresHumanReview: true,
            claimEvidenceIds: ['ev_9876543210abcdef98765432'],
          },
        ],
        unmatchedAddresses: [],
        warnings: [],
      }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Address or transaction identifier').fill(bscTokenAddress);
  await page.getByLabel('Network').selectOption('bsc');
  await page.getByRole('button', { name: 'Trace' }).click();
  await page.getByRole('button', { name: 'Inspect' }).click();

  await expect(page.getByText('Dex Trading')).toBeVisible();
  await expect(page.getByText('Spot Price')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Flap realizable sell preview' })).toHaveCount(0);
  const declarationPanel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Claim Declaration Review' }),
  });
  await expect(declarationPanel).toContainText('Declaration ≠ chain fact');
  await declarationPanel
    .getByLabel('Announcement text')
    .fill(
      '税费接收总钱包（100%）\n0x8231Bb4E2891e85E79f28f0816EDE7AeAab06af1\n' +
        '社区建设基金（20%）\n0x412DFD5Ac528C05ab78cd005385bC51759e29e46',
    );
  await declarationPanel
    .getByLabel('Audit window start (optional, ISO 8601 with timezone)')
    .fill('2026-08-02T00:00:00.000Z');
  await declarationPanel
    .getByLabel('Audit window end (optional, ISO 8601 with timezone)')
    .fill('2026-08-10T00:00:00.000Z');
  await declarationPanel.getByRole('button', { name: 'Compile review drafts' }).click();
  await expect(declarationPanel).toContainText('Community Fund');
  await expect(declarationPanel).toContainText('Ready For Review');
  await expect(declarationPanel).toContainText('Human review required');
  await expect(declarationPanel).toContainText('ev_9876543210abcdef98765432');
  const reconciliationPanel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Independent market and RV reconciliation' }),
  });
  await expect(reconciliationPanel).toBeVisible();
  await reconciliationPanel.getByRole('button', { name: 'Run independent check' }).click();
  await expect(reconciliationPanel.getByText('Pass', { exact: true }).first()).toBeVisible();
  await expect(reconciliationPanel).toContainText('Verified Independent');
  await expect(reconciliationPanel).toContainText('2 / 2');
  await expect(reconciliationPanel).toContainText('bsc-rpc@bnb-mainnet.g.alchemy.com#1');
  await expect(reconciliationPanel).toContainText('bsc-rpc@bsc-dataseed.bnbchain.org#2');
  await expect(reconciliationPanel).toContainText('0.000413358773223814');
  await expect(
    page.getByRole('heading', { name: 'Multi-source reconciliation Evidence' }),
  ).toBeVisible();
  const scenarioPanel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Pancake V2 buy-size scenarios' }),
  });
  await expect(scenarioPanel).toBeVisible();
  await page.getByRole('button', { name: 'Run buy scenarios' }).click();
  await expect(scenarioPanel).toContainText('0.000413358773223814');
  await expect(scenarioPanel).toContainText('240530.618355934388100371');
  await expect(scenarioPanel).toContainText('Pass · 0 Failed');
  await expect(scenarioPanel).toContainText('Not Queried');
  await expect(scenarioPanel).toContainText('movable custody, not supply burn');
  await expect(scenarioPanel.getByText(/Pass 0 Bps/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pancake V2 scenario Evidence' })).toBeVisible();

  const pensionEntryPanel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Pension entry economics' }),
  });
  await expect(pensionEntryPanel).toBeVisible();
  await pensionEntryPanel.getByRole('button', { name: 'Calculate pension entry' }).click();
  await expect(pensionEntryPanel).toContainText('1000000');
  await expect(pensionEntryPanel).toContainText('0.233314699805256356');
  await expect(pensionEntryPanel).toContainText('2.266745991147');
  await expect(pensionEntryPanel).toContainText('441.16');
  await expect(pensionEntryPanel).toContainText('Custody is not supply burn');
  await expect(pensionEntryPanel).toContainText('Not Queried');
  await expect(pensionEntryPanel).toContainText('Insufficient Data');
  await expect(pensionEntryPanel).toContainText('Persisted live result');
  await pensionEntryPanel.getByRole('button', { name: 'Load latest Scenario Report' }).click();
  await expect(pensionEntryPanel).toContainText('Provider-free replay');
  await expect(pensionEntryPanel).toContainText('441.16');
  await expect(page.getByRole('heading', { name: 'Pension entry Evidence' })).toBeVisible();

  const exitPanel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Pancake V2 exit-size scenarios' }),
  });
  await expect(exitPanel).toBeVisible();
  await page.getByRole('button', { name: 'Run exit scenarios' }).click();
  await expect(exitPanel).toContainText('Configured sell tax bps');
  await expect(exitPanel).toContainText('413.358773223814');
  await expect(exitPanel).toContainText('395.312');
  await expect(exitPanel).toContainText('Not Queried');
  await expect(exitPanel).toContainText('Execution capacity remains Unknown');
  await expect(exitPanel.getByText(/Pass 0 Bps/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pancake V2 exit Evidence' })).toBeVisible();

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test('compiles a public pension statement as a human-review draft without inventing an address', async ({
  page,
}) => {
  await page.route('**/api/v1/claims/declarations/parse', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        parserVersion: 'claim-declaration-parser-v1.0.0',
        documentHash: 'b'.repeat(64),
        assetId: `eip155:56:erc20:${bscTokenAddress}`,
        evidence: {
          id: 'ev_abcdefabcdefabcdefabcdef',
          ledger: 'EVM',
          chainId: 'eip155:56',
          kind: 'ANALYST_OBSERVATION',
          source: 'api:user-submitted-claim-declaration',
          locator: `claim-declaration:${'b'.repeat(64)}`,
          payloadHash: 'c'.repeat(64),
          observedAt: '2026-08-10T15:00:00.000Z',
          summary: 'Off-chain claim declaration; it is not a chain fact.',
        },
        drafts: [
          {
            id: 'cld_abcdefabcdefabcdefabcdef',
            assetId: `eip155:56:erc20:${bscTokenAddress}`,
            role: 'PENSION_VAULT',
            expectedAction: 'LOCK',
            sourceAddress: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
            destinationAddress: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
            expectedShareBps: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            shareUnitTokens: { state: 'known', value: '1000000' },
            noExit: { state: 'known', value: true },
            cadenceSeconds: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            window: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
            matchedText: '养老钱包打入100w币为1股，不可退出，每周分红，8月2号开始。',
            missingFields: ['sourceAddress', 'destinationAddress', 'window'],
            chainVerifyReadiness: 'INCOMPLETE',
            requiresHumanReview: true,
            claimEvidenceIds: ['ev_abcdefabcdefabcdefabcdef'],
          },
        ],
        unmatchedAddresses: [],
        warnings: [
          'A month/day fragment was not converted into an audit boundary without an explicit year and timezone.',
        ],
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Claim Audit' }).click();
  await expect(page.getByRole('heading', { name: 'Claim Audit' })).toBeVisible();
  await page.getByLabel('BSC token address').fill(bscTokenAddress);
  await page
    .getByLabel('Announcement text')
    .fill('养老钱包打入100w币为1股，不可退出，每周分红，8月2号开始。');
  await page.getByRole('button', { name: 'Compile review drafts' }).click();
  const declarationPanel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Claim Declaration Review' }),
  });
  await expect(page.getByText('Declaration ≠ chain fact')).toBeVisible();
  await expect(page.getByText('Pension Vault', { exact: true })).toBeVisible();
  await expect(declarationPanel.getByText('1,000,000')).toHaveCount(0);
  await expect(page.getByText('1000000', { exact: true })).toBeVisible();
  await expect(page.getByText('Incomplete', { exact: true })).toBeVisible();
  await expect(page.getByText('Insufficient Data').first()).toBeVisible();
  await expect(page.getByText('Human review required', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/month\/day fragment was not converted into an audit boundary/i),
  ).toBeVisible();

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test('shows durable pension behavior candidates on mobile without inventing social attribution', async ({
  page,
}) => {
  const fftToken = '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777';
  const candidate = '0x8d50a68b4f9ada119d198d6472eaf0cb6db302d9';
  const reportId = `pcr_${'1'.repeat(24)}`;
  const terminalEvidenceId = `ev_${'2'.repeat(24)}`;
  const candidateEvidenceId = `ev_${'3'.repeat(24)}`;
  const report = {
    tokenAddress: fftToken,
    fromBlock: '113485950',
    toBlock: '115154970',
    policy: {
      shareUnitAtomic: '1000000000000000000000000',
      minimumExactUnitDeposits: 5,
      minimumUniqueExactUnitDepositors: 5,
      maximumCandidates: 20,
    },
    scannedTransferCount: 13621,
    candidates: [
      {
        address: candidate,
        inflowTransferCount: 123,
        outflowTransferCount: 10,
        exactUnitDepositCount: 71,
        exactMultipleDepositCount: 107,
        nonMultipleDepositCount: 16,
        uniqueExactUnitDepositorCount: 109,
        uniqueOutflowDestinationCount: 1,
        observedInflowAmount: '176000010000000000000000000',
        observedOutflowAmount: '24507000000000000000000000',
        observedNetAmount: '151493010000000000000000000',
        observedWholeShares: '176',
        firstInflowAt: '2026-08-03T09:36:09.000Z',
        lastInflowAt: '2026-08-10T07:00:48.000Z',
        firstOutflowAt: { state: 'known', value: '2026-08-04T11:20:42.000Z' },
        lastOutflowAt: { state: 'known', value: '2026-08-10T10:17:50.000Z' },
        criteria: ['EXACT_SHARE_UNIT_DEPOSITS', 'UNIQUE_DEPOSITOR_THRESHOLD'],
        transferEvidenceIds: [`ev_${'4'.repeat(24)}`],
        evidenceId: candidateEvidenceId,
        roleAttribution: {
          state: 'unknown',
          reason: 'INSUFFICIENT_DATA',
          detail: 'Behavioral Evidence does not establish an official pension-vault role.',
        },
        participantExitPolicy: {
          state: 'unknown',
          reason: 'INSUFFICIENT_DATA',
          detail: 'Wallet history does not prove participant exit policy.',
        },
        dividendExecution: {
          state: 'unknown',
          reason: 'NOT_QUERIED',
          detail: 'Outflows have not been classified as weekly dividends.',
        },
      },
    ],
    coverageEvidenceIds: [`ev_${'5'.repeat(24)}`],
    terminalEvidenceId,
    metadata: {
      snapshot: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        blockNumber: '115154970',
        blockHash: `0x${'6'.repeat(64)}`,
        finality: 'finalized',
      },
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: '2026-08-10T16:44:39.000Z',
      sourceSet: ['sqd:binance-mainnet'],
      modelVersion: 'evm-pension-candidate-discovery-v1.0.0',
      confidence: 0.75,
      evidenceIds: [candidateEvidenceId, terminalEvidenceId, `ev_${'5'.repeat(24)}`],
    },
  };
  await page.route('**/api/v1/claims/EVM/*/pension-candidates', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        report,
        durableReport: {
          id: reportId,
          chainId: 'eip155:56',
          tokenAddress: fftToken,
          fromBlock: report.fromBlock,
          toBlock: report.toBlock,
          snapshotHash: `0x${'6'.repeat(64)}`,
          resultHash: '7'.repeat(64),
          report,
          terminalEvidenceId,
          evidenceIds: report.metadata.evidenceIds,
          sourceSet: report.metadata.sourceSet,
          modelVersion: report.metadata.modelVersion,
          capturedAt: '2026-08-10T16:44:40.000Z',
          createdAt: '2026-08-10T16:44:41.000Z',
        },
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claim Audit' }).click();
  const panel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Pension Vault Candidates' }),
  });
  await expect(panel).toContainText('Behavior is not identity');
  await panel.getByLabel('BSC token').fill(fftToken);
  await panel.getByLabel('From block').fill('113485950');
  await panel.getByLabel('Share unit (atomic)').fill('1000000000000000000000000');
  await expect(panel.getByLabel('BSC token')).toHaveValue(fftToken);
  await expect(panel.getByLabel('From block')).toHaveValue('113485950');
  await panel.getByLabel('Finalized to block').fill('115154970');
  await panel.getByRole('button', { name: 'Discover candidates' }).click();

  await expect(panel.getByTestId('pension-candidate-result')).toContainText(
    'Complete requested range',
  );
  await expect(panel).toContainText('13621');
  await expect(panel).toContainText('176');
  await expect(panel).toContainText('71');
  await expect(panel).toContainText('109');
  await expect(panel).toContainText('Role Unknown');
  await expect(panel).toContainText('Insufficient Data');
  await expect(panel).toContainText('Not Queried');
  await expect(panel).toContainText(reportId);
  await expect(panel).toContainText(terminalEvidenceId);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test('shows a supply-conserved burn action without treating the zero address as proof by itself', async ({
  page,
}) => {
  const burner = `0x${'2'.repeat(40)}`;
  const zeroAddress = `0x${'0'.repeat(40)}`;
  const transferId = 'ctr_1234567890abcdef12345678';
  const actionId = 'cba_1234567890abcdef12345678';
  const terminalEvidenceId = 'ev_1234567890abcdef12345678';
  await page.route('**/api/v1/claims/EVM/*/burn-conservation', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        report: {
          tokenAddress: bscTokenAddress,
          blockNumber: '115128700',
          blockHash: `0x${'8'.repeat(64)}`,
          parentBlockNumber: '115128699',
          parentBlockHash: `0x${'7'.repeat(64)}`,
          totalSupplyBefore: '1000000000000000000000',
          totalSupplyAfter: '900000000000000000000',
          mintedAmount: '0',
          burnedAmount: '100000000000000000000',
          supplyDelta: '-100000000000000000000',
          eventNetSupplyDelta: '-100000000000000000000',
          expectedSupplyAfter: '900000000000000000000',
          status: 'VERIFIED',
          candidateBurnTransferIds: [transferId],
          actions: [
            {
              id: actionId,
              type: 'BURN',
              actor: burner,
              amount: '100000000000000000000',
              observedAt: '2026-08-10T15:00:00.000Z',
              transferIds: [transferId],
              path: [burner, zeroAddress],
              evidenceIds: [terminalEvidenceId],
            },
          ],
          terminalEvidenceId,
          metadata: {
            snapshot: {
              ledger: 'EVM',
              chainId: 'eip155:56',
              blockNumber: '115128700',
              blockHash: `0x${'8'.repeat(64)}`,
              parentBlockHash: `0x${'7'.repeat(64)}`,
              finality: 'finalized',
            },
            dataCoverage: 1,
            sourceCoverage: 0.5,
            historyCoverage: 1,
            simulationCoverage: 0,
            freshness: '2026-08-10T15:00:00.000Z',
            sourceSet: ['bsc-rpc-fixture'],
            modelVersion: 'erc20-burn-conservation-v1.0.0',
            confidence: 0.98,
            evidenceIds: [terminalEvidenceId],
          },
        },
        evidence: [],
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claim Audit' }).click();
  const panel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Burn Supply Conservation' }),
  });
  await expect(panel).toContainText('Zero address alone is insufficient');
  await panel.getByLabel('Burn token address').fill(bscTokenAddress);
  await panel.getByLabel('Finalized burn block').fill('115128700');
  await panel.getByRole('button', { name: 'Verify burn conservation' }).click();

  await expect(panel.getByText('Verified', { exact: true })).toBeVisible();
  await expect(panel).toContainText('Supply/event conservation verified');
  await expect(panel).toContainText('1000000000000000000000');
  await expect(panel).toContainText('900000000000000000000');
  await expect(panel).toContainText(terminalEvidenceId);
  await expect(panel.getByText('Action generated', { exact: true })).toBeVisible();
  await expect(panel).toContainText(burner);
  await expect(panel).toContainText(`${burner} → ${zeroAddress}`);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test('keeps a complete burn-event range distinct from silent supply-change coverage', async ({
  page,
}) => {
  const terminalEvidenceId = 'ev_abcdefabcdefabcdefabcdef';
  await page.route('**/api/v1/claims/EVM/*/burn-candidates', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        report: {
          tokenAddress: bscTokenAddress,
          fromBlock: '113485950',
          toBlock: '115154970',
          coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS',
          status: 'NO_EVENT_CANDIDATES',
          zeroAddressEventCount: 0,
          burnCandidateCount: 0,
          candidates: [],
          silentSupplyChangeDetection: {
            state: 'unknown',
            reason: 'NOT_QUERIED',
            detail:
              'This run covers zero-address Transfer events only. Storage-level or silent totalSupply changes require a separate all-block state analysis.',
          },
          terminalEvidenceId,
          metadata: {
            snapshot: null,
            dataCoverage: 1,
            sourceCoverage: 0.5,
            historyCoverage: 1,
            simulationCoverage: 0,
            freshness: '2026-08-10T16:44:39.000Z',
            sourceSet: ['sqd:binance-mainnet'],
            modelVersion: 'erc20-burn-candidate-discovery-v1.0.0',
            confidence: 0.98,
            evidenceIds: [terminalEvidenceId],
          },
        },
        evidence: [],
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claim Audit' }).click();
  const panel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Burn Candidate Range' }),
  });
  await panel.getByLabel('Candidate token address').fill(bscTokenAddress);
  await panel.getByLabel('From block').fill('113485950');
  await panel.getByLabel('To block').fill('115154970');
  await panel.getByRole('button', { name: 'Discover burn candidates' }).click();

  await expect(panel).toContainText('No Event Candidates');
  await expect(panel).toContainText('ERC20_ZERO_ADDRESS_TRANSFER_EVENTS');
  await expect(panel).toContainText('Unknown');
  await expect(panel).toContainText('This is not proof that totalSupply never changed silently');
  await expect(panel).toContainText(terminalEvidenceId);
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test('replays a durable burn promotion without converting scoped coverage into silent proof', async ({
  page,
}) => {
  const scanId = '77777777-7777-4777-8777-777777777777';
  const discoveryEvidenceId = 'ev_000000000000000000000071';
  const terminalEvidenceId = 'ev_000000000000000000000072';
  const snapshot = {
    ledger: 'EVM',
    chainId: 'eip155:56',
    blockNumber: '115154970',
    blockHash: `0x${'3'.repeat(64)}`,
    parentBlockHash: `0x${'2'.repeat(64)}`,
    finality: 'finalized',
    capturedAt: '2026-08-11T01:00:00.000Z',
    blockTimestamp: '2026-08-11T00:59:57.000Z',
    providerVersions: { 'bsc-rpc@example': 'evm-ledger-v0.1.0' },
    adapterVersions: { evm: 'evm-ledger-v0.1.0' },
    configHash: '4'.repeat(64),
    entityModelVersion: 'entity-model-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
  await page.route('**/api/v1/claims/EVM/*/burn-promotions/*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        scan: {
          id: scanId,
          status: 'REQUESTED_RANGE_COMPLETE',
          token: bscTokenAddress,
          requestedRange: {
            fromBlock: '113485950',
            toBlock: '115154970',
            segmentSize: 1000000,
          },
          nextBlock: '115154971',
          requestedRangeCoverage: 1,
          lastErrorCode: null,
          updatedAt: '2026-08-11T01:01:00.000Z',
        },
        terminalResult: {
          tokenAddress: bscTokenAddress,
          fromBlock: '113485950',
          toBlock: '115154970',
          coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION',
          status: 'REQUESTED_RANGE_COMPLETE',
          segmentCount: 1,
          zeroAddressEventCount: 0,
          burnCandidateCount: 0,
          verifiedCandidateCount: 0,
          contradictedCandidateCount: 0,
          verifiedActionCount: 0,
          segments: [
            {
              fromBlock: '113485950',
              toBlock: '115154970',
              zeroAddressEventCount: 0,
              burnCandidateCount: 0,
              discoveryTerminalEvidenceId: discoveryEvidenceId,
              certificates: [],
              snapshot,
              sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
            },
          ],
          silentSupplyChangeDetection: {
            state: 'unknown',
            reason: 'NOT_QUERIED',
            detail:
              'This durable run proves zero-address event coverage and exact candidate-block conservation only. Silent totalSupply changes require an all-block state analysis.',
          },
          terminalEvidenceId,
          metadata: {
            snapshot,
            dataCoverage: 1,
            sourceCoverage: 0.5,
            historyCoverage: 1,
            simulationCoverage: 0,
            freshness: snapshot.blockTimestamp,
            sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
            modelVersion: 'erc20-burn-candidate-promotion-v1.0.0',
            confidence: 0.98,
            evidenceIds: [discoveryEvidenceId, terminalEvidenceId],
          },
        },
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claim Audit' }).click();
  const panel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'Burn Promotion Certificate' }),
  });
  await panel.getByLabel('Promoted token address').fill(bscTokenAddress);
  await panel.getByLabel('Promotion scan ID').fill(scanId);
  await panel.getByRole('button', { name: 'Replay promotion' }).click();

  await expect(panel).toContainText('Requested Range Complete');
  await expect(panel).toContainText('100.00%');
  await expect(panel.getByText('Unknown', { exact: true })).toBeVisible();
  await expect(panel).toContainText(
    'Silent totalSupply changes require an all-block state analysis',
  );
  await expect(panel).toContainText(terminalEvidenceId);
  await expect(panel).toContainText(discoveryEvidenceId);
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test('replays independently verified all-block supply continuity without extending its range', async ({
  page,
}) => {
  const scanId = '99999999-9999-4999-8999-999999999999';
  const segmentEvidenceId = 'ev_000000000000000000000085';
  const terminalEvidenceId = 'ev_000000000000000000000086';
  const sourceSet = ['bsc-rpc@bnb-mainnet.g.alchemy.com#1', 'bsc-rpc@bsc-dataseed.bnbchain.org#2'];
  await page.route('**/api/v1/claims/EVM/*/supply-continuity/*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        scan: {
          id: scanId,
          status: 'REQUESTED_RANGE_COMPLETE',
          token: bscTokenAddress,
          requestedRange: { fromBlock: '115180000', toBlock: '115180255', segmentSize: 256 },
          nextBlock: '115180256',
          requestedRangeCoverage: 1,
          lastErrorCode: null,
          updatedAt: '2026-08-11T02:01:00.000Z',
        },
        terminalResult: {
          tokenAddress: bscTokenAddress,
          fromBlock: '115180000',
          toBlock: '115180255',
          coverageScope: 'ERC20_TOTAL_SUPPLY_EVERY_FINALIZED_BLOCK_WITH_EVENT_RECONCILIATION',
          status: 'VERIFIED_NO_CHANGE',
          segmentCount: 1,
          scannedBlockCount: 256,
          supplySampleCount: 257,
          initialTotalSupply: '1000000000000000000000000000',
          finalTotalSupply: '1000000000000000000000000000',
          netSupplyDelta: '0',
          supplyChangeCount: 0,
          eventConservedChangeCount: 0,
          unexplainedChangeCount: 0,
          segments: [
            {
              fromBlock: '115180000',
              toBlock: '115180255',
              sampleCount: 257,
              startTotalSupply: '1000000000000000000000000000',
              endTotalSupply: '1000000000000000000000000000',
              supplyChangeCount: 0,
              eventConservedChangeCount: 0,
              unexplainedChangeCount: 0,
              changes: [],
              terminalEvidenceId: segmentEvidenceId,
              snapshot: {},
              sourceSet,
            },
          ],
          sourceIndependence: {
            status: 'VERIFIED_INDEPENDENT',
            independence: { state: 'known', value: true },
            requiredOperators: 2,
            observedSources: 2,
            operatorCount: 2,
            unresolvedSources: [],
            attestations: [
              {
                sourceId: sourceSet[0],
                hostname: 'bnb-mainnet.g.alchemy.com',
                operatorId: 'alchemy',
                operatorName: 'Alchemy',
                officialSource: 'https://www.alchemy.com/docs/reference/node-supported-chains',
                registryObservedAt: '2026-08-11T00:00:00.000Z',
                registryRevision: 'alchemy-bnb-chain-api@2026-08-11',
                evidenceId: 'ev_000000000000000000000082',
              },
              {
                sourceId: sourceSet[1],
                hostname: 'bsc-dataseed.bnbchain.org',
                operatorId: 'bnb-chain',
                operatorName: 'BNB Chain',
                officialSource:
                  'https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/',
                registryObservedAt: '2026-08-11T00:00:00.000Z',
                registryRevision: 'bnb-chain-bsc-json-rpc-endpoints@2026-08-11',
                evidenceId: 'ev_000000000000000000000083',
              },
            ],
            registryEvidenceId: 'ev_000000000000000000000081',
            terminalEvidenceId: 'ev_000000000000000000000084',
            evidenceIds: [],
            modelVersion: 'source-operator-registry-v1',
          },
          terminalEvidenceId,
          metadata: {
            snapshot: null,
            dataCoverage: 1,
            sourceCoverage: 1,
            historyCoverage: 1,
            simulationCoverage: 0,
            freshness: '2026-08-11T01:59:57.000Z',
            sourceSet,
            modelVersion: 'erc20-supply-continuity-v1.0.0',
            confidence: 1,
            evidenceIds: [segmentEvidenceId, terminalEvidenceId],
          },
        },
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Claim Audit' }).click();
  const panel = page.locator('.quote-panel').filter({
    has: page.getByRole('heading', { name: 'All-block Supply Continuity' }),
  });
  await panel.getByLabel('Supply token address').fill(bscTokenAddress);
  await panel.getByLabel('Supply scan ID').fill(scanId);
  await panel.getByRole('button', { name: 'Replay supply proof' }).click();

  await expect(panel.getByText('Verified No Change', { exact: true }).first()).toBeVisible();
  await expect(panel).toContainText('256');
  await expect(panel).toContainText('257');
  await expect(panel).toContainText(
    'No totalSupply change occurred inside this exact fully sampled range',
  );
  await expect(panel).toContainText('This does not describe blocks outside the range');
  await expect(panel).toContainText('Alchemy');
  await expect(panel).toContainText('BNB Chain');
  await expect(panel).toContainText(segmentEvidenceId);
  await expect(panel).toContainText(terminalEvidenceId);
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
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

test('renders an Evidence-bound FFT ERC-1167 control surface without hiding Unknown roles', async ({
  page,
}) => {
  const subject = '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777';
  const implementation = '0x024f18294970b5c76c0691b87f138a0317156422';
  const terminalEvidenceId = 'ev_000000000000000000000099';
  const domains = [
    'CONTRACT_CODE',
    'LOGIC_CODE',
    'ERC1167_IMPLEMENTATION',
    'EIP1967_IMPLEMENTATION',
    'EIP1967_ADMIN',
    'EIP1967_BEACON',
    'ERC173_OWNER',
    'SAFE_OWNERS_THRESHOLD',
    'SAFE_MODULES',
    'SAFE_GUARD',
    'SAFE_FALLBACK_HANDLER',
    'UPGRADE_AUTHORIZATION',
    'MINT',
    'BURN',
    'TAX_CHANGE',
    'BLACKLIST',
    'WHITELIST',
    'TRADING_SWITCH',
    'MAX_TX',
    'MAX_WALLET',
    'FEE_EXEMPTION',
    'ROUTER_CHANGE',
    'TREASURY',
    'LP_POSITION',
    'MIGRATION',
  ];
  await page.route('**/api/v1/control-rights/EVM/**/inspect', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        record: {
          id: 'ecs_000000000000000000000001',
          chainId: 'eip155:56',
          subject,
          snapshotBlock: '115192882',
          snapshotHash: `0x${'a'.repeat(64)}`,
          resultHash: 'b'.repeat(64),
          terminalEvidenceId,
          evidenceIds: [terminalEvidenceId],
          sourceSet: [
            'bsc-rpc@bnb-mainnet.g.alchemy.com',
            'bsc-rpc@bsc-dataseed.bnbchain.org',
            'sourcify-v2@sourcify.dev',
          ],
          modelVersion: 'evm-control-surface-v1.1.0',
          capturedAt: '2026-08-11T05:00:00.000Z',
          createdAt: '2026-08-11T05:00:01.000Z',
          report: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            subject,
            contractKind: { state: 'known', value: 'ERC1167_MINIMAL_PROXY' },
            implementationAddress: { state: 'known', value: implementation },
            proxyAdminAddress: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            beaconAddress: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            ownerAddress: {
              state: 'known',
              value: '0x0000000000000000000000000000000000000000',
            },
            safe: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            logicCode: {
              state: 'known',
              value: {
                address: implementation,
                relation: 'ERC1167_IMPLEMENTATION',
                runtimeBytecodeHash: `0x${'c'.repeat(64)}`,
                runtimeBytecodeBytes: 19331,
              },
            },
            verifiedSource: {
              state: 'known',
              value: {
                sourceId: 'sourcify-v2@sourcify.dev',
                sourceUri: `https://sourcify.dev/server/v2/contract/56/${implementation}`,
                address: implementation,
                matchType: 'exact_match',
                runtimeBytecodeHash: `0x${'c'.repeat(64)}`,
                runtimeBytecodeBytes: 19331,
                contractName: 'FlapTaxTokenV3',
                fullyQualifiedName: 'src/Tax/FlapTaxTokenV3.sol:FlapTaxTokenV3',
                language: 'Solidity',
                compilerVersion: '0.8.24+commit.e11b9ed9',
                verifiedAt: '2026-06-03T00:24:59.393Z',
                deployment: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
                abiFunctionCount: 43,
                mutatingFunctionSignatures: [
                  'finalizeMigration()',
                  'startMigration()',
                  'transferOwnership(address)',
                ],
              },
            },
            declaredCapabilities: [
              {
                rightType: 'MIGRATION',
                functionSignatures: ['finalizeMigration()', 'startMigration()'],
                detail: 'Declared only; current authorization is unresolved.',
                evidenceIds: ['ev_000000000000000000000098'],
              },
              {
                rightType: 'OWNER',
                functionSignatures: ['transferOwnership(address)'],
                detail: 'Declared only; current authorization is unresolved.',
                evidenceIds: ['ev_000000000000000000000098'],
              },
            ],
            sourceAgreement: { state: 'known', value: true },
            sourceIndependence: { state: 'known', value: true },
            rights: [],
            coverage: domains.map((domain) => ({
              domain,
              observed: [
                'CONTRACT_CODE',
                'LOGIC_CODE',
                'ERC1167_IMPLEMENTATION',
                'EIP1967_IMPLEMENTATION',
                'EIP1967_ADMIN',
                'EIP1967_BEACON',
                'ERC173_OWNER',
                'SAFE_OWNERS_THRESHOLD',
              ].includes(domain)
                ? {
                    state: 'known',
                    value: ['CONTRACT_CODE', 'LOGIC_CODE', 'ERC1167_IMPLEMENTATION'].includes(
                      domain,
                    ),
                  }
                : {
                    state: 'unknown',
                    reason: domain === 'MIGRATION' ? 'INSUFFICIENT_DATA' : 'NOT_QUERIED',
                  },
              detail: `${domain} coverage boundary.`,
              evidenceIds: domain === 'CONTRACT_CODE' ? [terminalEvidenceId] : [],
            })),
            terminalEvidenceId,
            metadata: {
              snapshot: { ledger: 'EVM', chainId: 'eip155:56', blockNumber: '115192882' },
              dataCoverage: 8 / 25,
              sourceCoverage: 1,
              historyCoverage: 0,
              simulationCoverage: 0,
              freshness: '2026-08-11T04:59:57.000Z',
              sourceSet: [
                'bsc-rpc@bnb-mainnet.g.alchemy.com',
                'bsc-rpc@bsc-dataseed.bnbchain.org',
                'sourcify-v2@sourcify.dev',
              ],
              modelVersion: 'evm-control-surface-v1.1.0',
              confidence: 0.99,
              evidenceIds: [terminalEvidenceId],
            },
            evidence: [],
          },
        },
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Control Rights' }).click();
  await expect(page.getByRole('heading', { name: 'EVM Control Rights' })).toBeVisible();
  await page.getByLabel('Contract address').fill(subject);
  await page.getByRole('button', { name: 'Inspect and persist' }).click();

  await expect(page.getByText('Erc1167 Minimal Proxy')).toBeVisible();
  await expect(page.getByText(implementation)).toBeVisible();
  await expect(page.getByText('owner() returned the zero address')).toBeVisible();
  await expect(page.getByText('No direct right was positively established')).toBeVisible();
  await expect(page.getByRole('link', { name: 'FlapTaxTokenV3' })).toBeVisible();
  await expect(page.getByText('Exact Bytecode Match')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Declared mutation surface' })).toBeVisible();
  const coverage = page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: 'Coverage matrix' }),
  });
  await expect(coverage).toContainText('Tax Change');
  await expect(coverage).toContainText('Not Queried');
  await expect(page.getByText(terminalEvidenceId)).toBeVisible();
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test('renders finalized Solana Token-2022 authority and explicit pending domains', async ({
  page,
}) => {
  const subject = 'So11111111111111111111111111111111111111112';
  const controller = '8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR';
  const terminalEvidenceId = 'ev_000000000000000000000199';
  await page.route(`**/api/v1/control-rights/SOLANA/${subject}/inspect`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        record: {
          id: 'scs_000000000000000000000001',
          chainId: 'solana-mainnet',
          subject,
          snapshotSlot: '360000000',
          snapshotHash: '3ySAYPQqMfpyZL6QhH4RzgT68HWpV72G2JAa2XWrpHEi',
          resultHash: 'f'.repeat(64),
          terminalEvidenceId,
          evidenceIds: [terminalEvidenceId],
          sourceSet: ['solana-rpc@api.mainnet-beta.solana.com'],
          modelVersion: 'solana-control-surface-v1.0.0',
          capturedAt: '2026-08-11T06:00:01.000Z',
          createdAt: '2026-08-11T06:00:02.000Z',
          report: {
            ledger: 'SOLANA',
            chainId: 'solana-mainnet',
            subject,
            accountKind: { state: 'known', value: 'TOKEN_2022_MINT' },
            ownerProgram: {
              state: 'known',
              value: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
            },
            executable: { state: 'known', value: false },
            mint: {
              state: 'known',
              value: {
                tokenProgram: 'TOKEN_2022',
                supply: '1000000000',
                decimals: 9,
                initialized: true,
                mintAuthority: { state: 'unknown', reason: 'NOT_APPLICABLE' },
                freezeAuthority: { state: 'unknown', reason: 'NOT_APPLICABLE' },
              },
            },
            tokenAccount: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            multisig: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            program: { state: 'unknown', reason: 'NOT_APPLICABLE' },
            extensions: [
              {
                extensionType: 'PermanentDelegate',
                authorities: [{ role: 'PERMANENT_DELEGATE', address: controller }],
                relatedAddresses: [],
                settings: {},
                evidenceIds: [terminalEvidenceId],
              },
            ],
            sourceAgreement: {
              state: 'unknown',
              reason: 'INSUFFICIENT_DATA',
              detail: 'Only one Solana RPC observation source was used.',
            },
            sourceIndependence: {
              state: 'unknown',
              reason: 'INSUFFICIENT_DATA',
              detail: 'No independent Solana operator registry is configured.',
            },
            rights: [
              {
                id: 'cr_000000000000000000000001',
                chainId: 'solana-mainnet',
                subject,
                controller,
                rightType: 'PERMANENT_DELEGATE',
                scope: 'Control Token-2022 PermanentDelegate.',
                threshold: {
                  state: 'unknown',
                  reason: 'INSUFFICIENT_DATA',
                  detail: 'Controller threshold was not established.',
                },
                constraints: ['Controller account shape is unresolved; threshold remains Unknown.'],
                evidenceIds: [terminalEvidenceId],
                activeFrom: { state: 'unknown', reason: 'NOT_QUERIED' },
                activeTo: { state: 'unknown', reason: 'NOT_QUERIED' },
              },
            ],
            coverage: [
              {
                domain: 'PERMANENT_DELEGATE',
                observed: { state: 'known', value: true },
                detail: 'Permanent delegate extension state is present and decoded.',
                evidenceIds: [terminalEvidenceId],
              },
              {
                domain: 'SQUADS_CONFIGURATION',
                observed: { state: 'unknown', reason: 'NOT_IMPLEMENTED' },
                detail: 'Squads configuration was not inferred by this point-in-time adapter.',
                evidenceIds: [],
              },
              {
                domain: 'AUTHORITY_HISTORY',
                observed: { state: 'unknown', reason: 'NOT_IMPLEMENTED' },
                detail: 'Authority history remains an explicit pending boundary.',
                evidenceIds: [],
              },
            ],
            terminalEvidenceId,
            metadata: {
              snapshot: {
                ledger: 'SOLANA',
                chainId: 'solana-mainnet',
                slot: '360000000',
                blockhash: '3ySAYPQqMfpyZL6QhH4RzgT68HWpV72G2JAa2XWrpHEi',
                commitment: 'finalized',
              },
              dataCoverage: 1 / 38,
              sourceCoverage: 0.5,
              historyCoverage: 0,
              simulationCoverage: 0,
              freshness: '2026-08-11T06:00:00.000Z',
              sourceSet: ['solana-rpc@api.mainnet-beta.solana.com'],
              modelVersion: 'solana-control-surface-v1.0.0',
              confidence: 0.82,
              evidenceIds: [terminalEvidenceId],
            },
            evidence: [],
          },
        },
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Control Rights' }).click();
  await page.getByLabel('Ledger').selectOption('SOLANA');
  await expect(page.getByRole('heading', { name: 'Solana Control Rights' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect and persist' }).click();

  await expect(page.getByText('Token 2022 Mint')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decoded extensions' })).toBeVisible();
  await expect(page.getByText('Permanent Delegate').first()).toBeVisible();
  await expect(page.getByText(controller)).toBeVisible();
  const coverage = page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: 'Coverage matrix' }),
  });
  await expect(coverage).toContainText('Squads Configuration');
  await expect(coverage).toContainText('Not Implemented');
  await expect(page.getByText(terminalEvidenceId)).toBeVisible();
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});
