import { describe, expect, it } from 'vitest';

import { createEvidence, EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  TokenFlowObservationSchema,
  TokenHistoryDiscoveryReportSchema,
  unknownValue,
  type AnalysisSnapshot,
  type TokenFlowObservation,
  type TokenHistoryDiscoveryReport,
} from '@zerotrace/schemas';
import { buildForensicCampaignAlerts, buildProviderBackedControlCampaign } from './index.js';

const chainId = 'eip155:56';
const token = `0x${'1'.repeat(40)}`;
const external = `0x${'2'.repeat(40)}`;
const walletOne = `0x${'3'.repeat(40)}`;
const walletTwo = `0x${'4'.repeat(40)}`;
const pool = `0x${'5'.repeat(40)}`;
const timestamp = '2026-08-14T00:00:00.000Z';

function snapshot(blockNumber: string, blockHash: string): AnalysisSnapshot {
  return {
    ledger: 'EVM',
    chainId,
    blockNumber,
    blockHash: `0x${blockHash.repeat(64)}`,
    finality: 'finalized',
    capturedAt: timestamp,
    providerVersions: { fixture: 'provider-fixture-v1' },
    adapterVersions: { evm: 'adapter-fixture-v1' },
    configHash: 'ab'.repeat(32),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-unqueried-v1',
  };
}

function legacyRpcSnapshot(blockNumber: string, blockHash: string): AnalysisSnapshot {
  return {
    ...snapshot(blockNumber, blockHash),
    chainId: '56',
  } as Extract<AnalysisSnapshot, { ledger: 'EVM' }>;
}

function evidenceFor(
  ledger: EvidenceLedger,
  blockNumber: string,
  blockHash: string,
  transactionHash: string,
): string {
  const item = createEvidence({
    ledger: 'EVM',
    chainId: '56',
    kind: 'LOG',
    source: 'fixture:provider',
    locator: transactionHash,
    blockOrSlot: blockNumber,
    finality: 'finalized',
    observedAt: timestamp,
    payload: { blockHash, transactionHash },
    summary: 'Fixture finalized token Transfer log.',
  });
  ledger.add(item, [], legacyRpcSnapshot(blockNumber, blockHash.slice(2, 3)));
  return item.id;
}

function rangeEvidenceFor(ledger: EvidenceLedger, blockNumber: string, blockHash: string): string {
  const item = createEvidence({
    ledger: 'EVM',
    chainId: '56',
    kind: 'BLOCK',
    source: 'fixture:provider',
    locator: `block:${blockNumber}`,
    blockOrSlot: blockNumber,
    finality: 'finalized',
    observedAt: timestamp,
    payload: { blockHash },
    summary: 'Fixture finalized block range anchor.',
  });
  ledger.add(item, [], legacyRpcSnapshot(blockNumber, blockHash.slice(2, 3)));
  return item.id;
}

function observation(input: {
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  from: string;
  to: string;
  amountRaw: string;
  kind: TokenFlowObservation['kind'];
  evidenceId: string;
}): TokenFlowObservation {
  const exactSnapshot = snapshot(input.blockNumber, input.blockHash.slice(2, 3));
  const content = {
    schemaVersion: 'token-flow-observation-v1' as const,
    ledger: 'EVM' as const,
    chainId,
    token,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    transactionHash: input.transactionHash,
    transactionIndex: input.transactionIndex,
    logIndex: input.logIndex,
    from: input.from,
    to: input.to,
    amountRaw: input.amountRaw,
    kind: input.kind,
    application: 'SUCCESS' as const,
    finality: 'FINAL' as const,
    observedAt: timestamp,
    snapshot: exactSnapshot,
    actionSemanticsIds: [],
    evidenceIds: [input.evidenceId],
  };
  const id = `tfo_${hashPayload({ schema: 'token-flow-observation-id-v1', content }).slice(0, 24)}`;
  return TokenFlowObservationSchema.parse({
    ...content,
    id,
    resultHash: hashPayload({
      schema: 'token-flow-observation-result-v1',
      content: { ...content, id },
    }),
  });
}

function makeInput(): { history: TokenHistoryDiscoveryReport; evidenceLedger: EvidenceLedger } {
  const ledger = new EvidenceLedger();
  const blockHashes = {
    '100': `0x${'a'.repeat(64)}`,
    '120': `0x${'b'.repeat(64)}`,
    '140': `0x${'c'.repeat(64)}`,
    '160': `0x${'d'.repeat(64)}`,
  };
  const transactionHashes = ['1', '2', '3', '4'].map((value) => `0x${value.repeat(64)}`);
  const observations = [
    observation({
      blockNumber: '100',
      blockHash: blockHashes['100'],
      transactionHash: transactionHashes[0]!,
      transactionIndex: '0',
      logIndex: '0',
      from: external,
      to: walletOne,
      amountRaw: '100',
      kind: 'DEX_BUY',
      evidenceId: evidenceFor(ledger, '100', blockHashes['100']!, transactionHashes[0]!),
    }),
    observation({
      blockNumber: '120',
      blockHash: blockHashes['120'],
      transactionHash: transactionHashes[1]!,
      transactionIndex: '0',
      logIndex: '0',
      from: external,
      to: walletTwo,
      amountRaw: '80',
      kind: 'DEX_BUY',
      evidenceId: evidenceFor(ledger, '120', blockHashes['120']!, transactionHashes[1]!),
    }),
    observation({
      blockNumber: '140',
      blockHash: blockHashes['140'],
      transactionHash: transactionHashes[2]!,
      transactionIndex: '0',
      logIndex: '0',
      from: walletOne,
      to: walletTwo,
      amountRaw: '20',
      kind: 'TRANSFER',
      evidenceId: evidenceFor(ledger, '140', blockHashes['140']!, transactionHashes[2]!),
    }),
    observation({
      blockNumber: '160',
      blockHash: blockHashes['160'],
      transactionHash: transactionHashes[3]!,
      transactionIndex: '0',
      logIndex: '0',
      from: walletOne,
      to: pool,
      amountRaw: '40',
      kind: 'DEX_SELL',
      evidenceId: evidenceFor(ledger, '160', blockHashes['160']!, transactionHashes[3]!),
    }),
  ];
  const rangeEvidenceIds = [
    rangeEvidenceFor(ledger, '100', blockHashes['100']!),
    rangeEvidenceFor(ledger, '160', blockHashes['160']!),
  ].sort();
  const reportCore = {
    schemaVersion: 'token-history-discovery-v1' as const,
    id: 'thd_aaaaaaaaaaaaaaaaaaaaaaaa',
    ledger: 'EVM' as const,
    chainId,
    token,
    fromBlock: '100',
    toBlock: '160',
    status: 'COMPLETE' as const,
    origin: unknownValue('NOT_QUERIED'),
    observations,
    relevantTransactionHashes: transactionHashes.slice().sort(),
    actionSemanticsBindings: [],
    sourceHead: knownValue('160'),
    checkpoint: {
      runId: 'token-history-test-run',
      nextBlock: '161',
      status: 'REQUESTED_RANGE_COMPLETE' as const,
      lastBlock: '160',
      finalizedHead: '160',
      queryHash: hashPayload({ query: 'token-history-test' }),
    },
    providerTelemetry: {
      requests: 4,
      retries: 0,
      rateLimitEvents: 0,
      rangeAdjustments: 0,
    },
    providerCapabilityDeclarations: [
      {
        id: 'fixture-provider',
        ledger: 'EVM' as const,
        chainId,
        capabilities: ['BLOCK', 'LOG', 'RECEIPT', 'TRANSACTION'] as const,
        configured: true,
        version: 'fixture-v1',
      },
    ],
    snapshot: snapshot('160', 'd'),
    rangeEvidenceIds,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    freshness: timestamp,
    sourceSet: ['fixture:provider'],
    modelVersion: 'token-history-discovery-v1.0.0' as const,
    policyVersion: 'token-history-policy-v1.0.0' as const,
    evidenceIds: [
      ...new Set([...observations.flatMap((item) => item.evidenceIds), ...rangeEvidenceIds]),
    ].sort(),
  };
  const history = TokenHistoryDiscoveryReportSchema.parse({
    ...reportCore,
    resultHash: hashPayload({ schema: 'token-history-discovery-result-v1', reportCore }),
  });
  return { history, evidenceLedger: ledger };
}

describe('provider-backed campaign reconstruction', () => {
  it('reconstructs and replays a conserved multi-stage campaign from exact observations', () => {
    const first = makeInput();
    const result = buildProviderBackedControlCampaign({
      history: first.history,
      evidenceLedger: first.evidenceLedger,
      maxMembers: 2,
      maxStageSnapshots: 8,
    });
    const second = makeInput();
    const replay = buildProviderBackedControlCampaign({
      history: second.history,
      evidenceLedger: second.evidenceLedger,
      maxMembers: 2,
      maxStageSnapshots: 8,
    });

    expect(result.bundle.resultHash).toBe(replay.bundle.resultHash);
    expect(result.bundle.campaign.calibrationStatus).toBe('UNCALIBRATED');
    const campaignStart = result.bundle.campaign.snapshotStart;
    const campaignEnd = result.bundle.campaign.snapshotEnd;
    expect(campaignStart.ledger).toBe('EVM');
    expect(campaignEnd.ledger).toBe('EVM');
    if (campaignStart.ledger !== 'EVM' || campaignEnd.ledger !== 'EVM') {
      throw new Error('Provider campaign test expected EVM Snapshots.');
    }
    expect(campaignStart.blockNumber).toBe('100');
    expect(campaignEnd.blockNumber).toBe('160');
    expect(result.bundle.positions.every((position) => position.tokenBalanceRaw !== '0')).toBe(
      true,
    );
    expect(result.bundle.positions.map((position) => position.atBlock)).toEqual([
      '100',
      '120',
      '140',
      '160',
    ]);
    expect(result.bundle.behaviorEvents.map((event) => event.type)).toEqual([
      'ACCUMULATION',
      'CAMPAIGN_DORMANCY',
      'COORDINATED_SELLING',
    ]);
    expect(result.bundle.evidenceLine.phases.length).toBeGreaterThan(0);
    expect(result.bundle.evidenceLine.itemIds).toEqual(
      [...result.bundle.evidenceItems.map((item) => item.id)].sort(),
    );
    expect(result.openingBalanceUnknownWalletIds).toEqual([]);
    expect(result.derivedEvidence.length).toBe(result.bundle.evidenceItems.length);

    const alerts = buildForensicCampaignAlerts(result.bundle);
    const replayAlerts = buildForensicCampaignAlerts(replay.bundle);
    expect(alerts.map((alert) => [alert.classification, alert.severity]).sort()).toEqual(
      [
        ['ACCUMULATION_OBSERVED', 'WATCH'],
        ['CAMPAIGN_DORMANCY_OBSERVED', 'INFO'],
        ['COORDINATED_SELLING_OBSERVED', 'HIGH'],
      ].sort(),
    );
    expect(alerts.map((alert) => alert.resultHash)).toEqual(
      replayAlerts.map((alert) => alert.resultHash),
    );
    expect(
      alerts.every(
        (alert) =>
          alert.evidenceIds.length > 0 &&
          alert.evidenceIds.every(
            (evidenceId, index) => evidenceId === [...alert.evidenceIds].sort()[index],
          ),
      ),
    ).toBe(true);
  });
});
