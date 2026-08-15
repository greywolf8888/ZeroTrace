import { describe, expect, it, vi } from 'vitest';

import { hashPayload } from '@zerotrace/evidence';
import {
  TokenFlowObservationSchema,
  TokenHistoryDiscoveryReportSchema,
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type RawChainFact,
  type TokenHistoryDiscoveryReport,
} from '@zerotrace/schemas';
import { createEvmAssetTransferObservation } from './index.js';
import { buildFundingSettlementFromTokenHistory } from './token-history-provider.js';

const chainId = 'eip155:56';
const token = `0x${'1'.repeat(40)}`;
const sender = `0x${'2'.repeat(40)}`;
const destination = `0x${'3'.repeat(40)}`;
const transactionHash = `0x${'4'.repeat(64)}`;
const blockHash = `0x${'a'.repeat(64)}`;
const timestamp = '2026-08-14T00:00:00.000Z';
const transferTopic = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const snapshot: AnalysisSnapshot = {
  ledger: 'EVM',
  chainId,
  blockNumber: '100',
  blockHash,
  finality: 'finalized',
  capturedAt: timestamp,
  providerVersions: { rpc: 'fixture-v1' },
  adapterVersions: { evm: 'fixture-v1' },
  configHash: 'ab'.repeat(32),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unqueried-v1',
};

function report(withObservation: boolean): TokenHistoryDiscoveryReport {
  const evidenceId = 'ev_aaaaaaaaaaaaaaaaaaaaaaaa';
  const content = {
    schemaVersion: 'token-flow-observation-v1' as const,
    ledger: 'EVM' as const,
    chainId,
    token,
    blockNumber: '100',
    blockHash,
    transactionHash,
    transactionIndex: '0',
    logIndex: '0',
    from: sender,
    to: destination,
    amountRaw: '5',
    kind: 'TRANSFER' as const,
    application: 'SUCCESS' as const,
    finality: 'FINAL' as const,
    observedAt: timestamp,
    snapshot,
    actionSemanticsIds: [],
    evidenceIds: [evidenceId],
  };
  const id = `tfo_${hashPayload({ schema: 'token-flow-observation-id-v1', content }).slice(0, 24)}`;
  const observation = TokenFlowObservationSchema.parse({
    ...content,
    id,
    resultHash: hashPayload({
      schema: 'token-flow-observation-result-v1',
      content: { ...content, id },
    }),
  });
  const observations = withObservation ? [observation] : [];
  const rangeEvidenceIds = ['ev_bbbbbbbbbbbbbbbbbbbbbbbb'];
  const reportCore = {
    schemaVersion: 'token-history-discovery-v1' as const,
    id: 'thd_bbbbbbbbbbbbbbbbbbbbbbbb',
    ledger: 'EVM' as const,
    chainId,
    token,
    fromBlock: '100',
    toBlock: '100',
    status: 'COMPLETE' as const,
    origin: unknownValue('NOT_QUERIED'),
    observations,
    relevantTransactionHashes: withObservation ? [transactionHash] : [],
    actionSemanticsBindings: [],
    sourceHead: knownValue('100'),
    checkpoint: {
      runId: 'provider-helper-test',
      nextBlock: '101',
      status: 'REQUESTED_RANGE_COMPLETE' as const,
      lastBlock: '100',
      finalizedHead: '100',
      queryHash: hashPayload({ query: 'provider-helper-test' }),
    },
    providerTelemetry: {
      requests: 1,
      retries: 0,
      rateLimitEvents: 0,
      rangeAdjustments: 0,
    },
    providerCapabilityDeclarations: [
      {
        id: 'fixture-rpc',
        ledger: 'EVM' as const,
        chainId,
        capabilities: ['BLOCK', 'LOG', 'RECEIPT', 'TRANSACTION'] as const,
        configured: true,
        version: 'fixture-v1',
      },
    ],
    snapshot,
    rangeEvidenceIds,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    freshness: timestamp,
    sourceSet: ['fixture:history'],
    modelVersion: 'token-history-discovery-v1.0.0' as const,
    policyVersion: 'token-history-policy-v1.0.0' as const,
    evidenceIds: [
      ...new Set([...observations.flatMap((item) => item.evidenceIds), ...rangeEvidenceIds]),
    ].sort(),
  };
  return TokenHistoryDiscoveryReportSchema.parse({
    ...reportCore,
    resultHash: hashPayload({ schema: 'token-history-discovery-result-v1', reportCore }),
  });
}

function transactionFact(): RawChainFact {
  return {
    id: 'a'.repeat(64),
    schemaVersion: 'zerotrace-raw-fact-v1',
    ledger: 'EVM',
    chainId,
    blockOrSlot: '100',
    blockHash,
    factType: 'TRANSACTION',
    subject: transactionHash,
    provider: 'fixture:rpc',
    finality: 'finalized',
    payload: {},
    payloadHash: hashPayload({}),
    evidenceId: 'ev_cccccccccccccccccccccccc',
    rawArtifactRef: 's3://fixture/fact.json#sha256=' + 'b'.repeat(64),
    observedAt: timestamp,
  };
}

function exactReader(options: {
  code: string | ((address: string) => string);
  logs: readonly Record<string, unknown>[];
  transactionFrom?: string;
  value?: string;
}) {
  const transactionFrom = options.transactionFrom ?? sender;
  return {
    sourceId: 'fixture:rpc',
    getCodeObservationAtBlockHash: vi.fn(async (address: string) => ({
      value: typeof options.code === 'function' ? options.code(address) : options.code,
    })),
    getTransactionObservation: vi.fn(async () => ({
      value: {
        hash: transactionHash,
        blockHash,
        blockNumber: '0x64',
        transactionIndex: '0x0',
        from: transactionFrom,
        to: destination,
        value: options.value ?? '0x0',
        nonce: '0x0',
        gas: '0x1',
        input: '0x',
        raw: {},
      },
    })),
    getTransactionReceiptObservation: vi.fn(async () => ({
      value: {
        transactionHash,
        blockHash,
        blockNumber: '0x64',
        transactionIndex: '0x0',
        from: transactionFrom,
        to: destination,
        contractAddress: null,
        cumulativeGasUsed: '0x1',
        gasUsed: '0x1',
        status: '0x1' as const,
        logCount: options.logs.length,
        raw: { logs: options.logs },
      },
    })),
  };
}

const transferLog = {
  address: token,
  blockHash,
  blockNumber: '0x64',
  transactionHash,
  transactionIndex: '0x0',
  logIndex: '0x0',
  data: `0x${'0'.repeat(63)}5`,
  topics: [
    `0x${transferTopic}`,
    `0x${'0'.repeat(24)}${sender.slice(2)}`,
    `0x${'0'.repeat(24)}${destination.slice(2)}`,
  ],
};

describe('Token History Funding/Settlement provider composition', () => {
  it('derives a bounded report and produces the same replay hash', async () => {
    const capture = exactReader({
      code: (address) => (address === destination ? '0x' : '0x1'),
      logs: [transferLog],
      transactionFrom: `0x${'9'.repeat(40)}`,
      value: '0x5',
    });
    const result = await buildFundingSettlementFromTokenHistory({
      report: report(true),
      facts: [transactionFact()],
      exactReader: capture as never,
      token,
      fromBlock: 100,
      toBlock: 100,
      probeHistoricalCode: true,
    });
    expect(result.status).toBe('DERIVED');
    if (result.status !== 'DERIVED') throw new Error('Expected a derived report.');
    expect(result.report.status).toBe('PARTIAL');
    expect(result.report.fundingEdges.length).toBeGreaterThan(0);
    expect(result.report.resultHash).toBe(result.replayResultHash);
    expect(result.focusSelection.codeConfirmed).toEqual([destination]);
    expect(result.codeProbeFailures).toEqual([]);
  });

  it('keeps an exact-code failure and missing transfers explicit as UNKNOWN', async () => {
    const result = await buildFundingSettlementFromTokenHistory({
      report: report(true),
      facts: [transactionFact()],
      exactReader: exactReader({ code: '0x', logs: [] }) as never,
      token,
      fromBlock: 100,
      toBlock: 100,
      probeHistoricalCode: true,
    });
    expect(result).toMatchObject({
      status: 'UNKNOWN',
      reason: 'NO_EXACT_ASSET_TRANSFERS_IN_RELEVANT_RECEIPTS',
    });
  });

  it('uses the transaction sender fallback when historical code is unavailable', async () => {
    const reader = exactReader({ code: '0x1', logs: [transferLog] });
    reader.getCodeObservationAtBlockHash.mockRejectedValue(new Error('missing trie node'));
    const result = await buildFundingSettlementFromTokenHistory({
      report: report(true),
      facts: [transactionFact()],
      exactReader: reader as never,
      token,
      fromBlock: 100,
      toBlock: 100,
      probeHistoricalCode: true,
    });
    expect(result.status).toBe('DERIVED');
    if (result.status !== 'DERIVED') throw new Error('Expected a derived report.');
    expect(result.focusSelection.codeConfirmed).toEqual([]);
    expect(result.focusSelection.transactionSenderFallback).toEqual([sender]);
    expect(result.codeProbeFailures[0]).toContain('missing trie node');
  });

  it('adds candidate-scoped archival transfers without relabeling them as transaction-local', async () => {
    const historicalTransfer = createEvmAssetTransferObservation({
      chainId,
      asset: 'NATIVE',
      source: `0x${'5'.repeat(40)}`,
      destination: sender,
      amountAtomic: '100',
      blockNumber: '100',
      blockHash,
      transactionHash: `0x${'6'.repeat(64)}`,
      transactionIndex: '1',
      observedAt: timestamp,
      execution: 'SUCCESS',
      finality: 'FINAL',
      evidenceIds: ['ev_dddddddddddddddddddddddd'],
      rawArtifactRef: 's3://fixture/candidate.json#sha256=' + 'c'.repeat(64),
    });
    const result = await buildFundingSettlementFromTokenHistory({
      report: report(true),
      facts: [transactionFact()],
      exactReader: exactReader({ code: '0x1', logs: [] }) as never,
      token,
      fromBlock: 100,
      toBlock: 100,
      probeHistoricalCode: true,
      historicalTransfers: [historicalTransfer],
      historicalHistoryCoverage: 1,
      historicalCoverageScope: 'BOUNDED_RANGE',
      historicalSourceSet: ['sqd:fixture'],
    });
    expect(result.status).toBe('DERIVED');
    if (result.status !== 'DERIVED') throw new Error('Expected a derived report.');
    expect(result.report.coverageScope).toBe('BOUNDED_RANGE');
    expect(result.report.historyCoverage).toBe(1);
    expect(result.report.fundingEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: `0x${'5'.repeat(40)}`,
          destination: sender,
          relation: 'FIRST_FUNDER',
        }),
      ]),
    );
    expect(result.report.resultHash).toBe(result.replayResultHash);
  });

  it('preserves coverage returned by a candidate expansion when no legacy override is supplied', async () => {
    const historicalTransfer = createEvmAssetTransferObservation({
      chainId,
      asset: 'NATIVE',
      source: `0x${'5'.repeat(40)}`,
      destination: sender,
      amountAtomic: '100',
      blockNumber: '100',
      blockHash,
      transactionHash: `0x${'6'.repeat(64)}`,
      transactionIndex: '1',
      observedAt: timestamp,
      execution: 'SUCCESS',
      finality: 'FINAL',
      evidenceIds: ['ev_eeeeeeeeeeeeeeeeeeeeeeee'],
      rawArtifactRef: 's3://fixture/candidate-expansion.json#sha256=' + 'd'.repeat(64),
    });
    const result = await buildFundingSettlementFromTokenHistory({
      report: report(true),
      facts: [transactionFact()],
      exactReader: exactReader({ code: '0x1', logs: [] }) as never,
      token,
      fromBlock: 100,
      toBlock: 100,
      probeHistoricalCode: true,
      historicalExpansion: async () => ({
        transfers: [historicalTransfer],
        historyCoverage: 1,
        coverageScope: 'BOUNDED_RANGE' as const,
        sourceSet: ['sqd:fixture'],
      }),
    });
    expect(result.status).toBe('DERIVED');
    if (result.status !== 'DERIVED') throw new Error('Expected a derived report.');
    expect(result.report.historyCoverage).toBe(1);
    expect(result.report.coverageScope).toBe('BOUNDED_RANGE');
  });

  it('deduplicates one chain event when exact and archival Evidence IDs differ', async () => {
    const duplicateTransfer = createEvmAssetTransferObservation({
      chainId,
      asset: token,
      source: sender,
      destination,
      amountAtomic: '5',
      blockNumber: '100',
      blockHash,
      transactionHash,
      transactionIndex: '0',
      eventIndex: '0',
      observedAt: timestamp,
      execution: 'SUCCESS',
      finality: 'FINAL',
      evidenceIds: ['ev_ffffffffffffffffffffffff'],
      rawArtifactRef: 's3://fixture/archival.json#sha256=' + 'e'.repeat(64),
    });
    const baseInput = {
      report: report(true),
      facts: [transactionFact()],
      exactReader: exactReader({
        code: (address) => (address === destination ? '0x' : '0x1'),
        logs: [transferLog],
      }) as never,
      token,
      fromBlock: 100,
      toBlock: 100,
      probeHistoricalCode: true,
      historicalTransfers: [duplicateTransfer],
      historicalHistoryCoverage: 1,
      historicalCoverageScope: 'BOUNDED_RANGE' as const,
    };
    const withoutExpansion = await buildFundingSettlementFromTokenHistory(baseInput);
    const withExpansion = await buildFundingSettlementFromTokenHistory({
      ...baseInput,
      exactReader: exactReader({
        code: (address) => (address === destination ? '0x' : '0x1'),
        logs: [transferLog],
      }) as never,
      historicalExpansion: async () => ({
        transfers: [duplicateTransfer],
        historyCoverage: 1,
        coverageScope: 'BOUNDED_RANGE' as const,
        sourceSet: [],
      }),
    });
    expect(withoutExpansion.status).toBe('DERIVED');
    expect(withExpansion.status).toBe('DERIVED');
    if (withoutExpansion.status !== 'DERIVED' || withExpansion.status !== 'DERIVED') {
      throw new Error('Expected derived reports.');
    }
    expect(withExpansion.report.resultHash).toBe(withoutExpansion.report.resultHash);
    expect(withExpansion.report.fundingEdges).toHaveLength(
      withoutExpansion.report.fundingEdges.length,
    );
    expect(withExpansion.report.settlementEdges).toHaveLength(
      withoutExpansion.report.settlementEdges.length,
    );
  });
});
