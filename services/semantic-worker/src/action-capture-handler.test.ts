import { actionSemanticsReportId, type ActionSemanticsReport } from '@zerotrace/action-semantics';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type CaptureRun,
} from '@zerotrace/schemas';
import { createRawChainFact } from '@zerotrace/storage';
import { describe, expect, it, vi } from 'vitest';

import {
  createActionSemanticsTransactionCaptureHandler,
  type ActionSemanticsCaptureResources,
} from './action-capture-handler.js';

const transactionId = `0x${'1'.repeat(64)}`;
const capturedAt = '2026-08-12T00:00:00.000Z';
const snapshot: AnalysisSnapshot = {
  ledger: 'EVM',
  chainId: '56',
  blockNumber: '42',
  blockHash: `0x${'2'.repeat(64)}`,
  parentBlockHash: `0x${'3'.repeat(64)}`,
  finality: 'finalized',
  blockTimestamp: capturedAt,
  capturedAt,
  providerVersions: { 'sqd:binance-mainnet': 'sqd-portal-finalized-http-v1' },
  adapterVersions: { 'sqd-finalized-ingestion-v4': '0.1.0' },
  configHash: '4'.repeat(64),
  entityModelVersion: 'entity-model-unapplied',
  labelSnapshot: 'labels-unapplied',
};
const payload = {
  hash: transactionId,
  transactionIndex: 3,
  status: 1,
  from: `0x${'5'.repeat(40)}`,
  to: `0x${'6'.repeat(40)}`,
  input: '0x1234',
  value: '0',
};
const evidence = createEvidence({
  ledger: 'EVM',
  chainId: '56',
  kind: 'TRANSACTION',
  source: 'sqd:binance-mainnet',
  locator: `transaction:${transactionId}`,
  payload,
  observedAt: capturedAt,
  blockOrSlot: '42',
  finality: 'finalized',
  rawArtifactRef: `s3://zerotrace-raw/test.json#sha256=${'7'.repeat(64)}`,
  summary: 'Finalized test transaction.',
});
const fact = createRawChainFact({
  ledger: 'EVM',
  chainId: '56',
  blockOrSlot: '42',
  blockHash: snapshot.ledger === 'EVM' ? snapshot.blockHash : '',
  factType: 'TRANSACTION',
  subject: transactionId,
  provider: 'sqd:binance-mainnet',
  finality: 'finalized',
  payload,
  evidenceId: evidence.id,
  rawArtifactRef: evidence.rawArtifactRef as string,
  observedAt: capturedAt,
});

function run(dataset = 'binance-mainnet'): CaptureRun {
  return {
    schemaVersion: 'capture-run-v1',
    id: `cpr_${'1'.repeat(24)}`,
    scheduleId: `cps_${'2'.repeat(24)}`,
    captureKind: 'TRANSACTION',
    operation: 'READ_ONLY_CAPTURE',
    target: {
      ledger: 'EVM',
      chainId: '56',
      subjectType: 'TRANSACTION',
      normalizedIdentifier: transactionId,
    },
    parameters: {
      schemaVersion: 'action-semantics-transaction-capture-v1',
      dataset,
      profile: 'ledger-records',
      blockOrSlot: '42',
      adapterVersion: 'raw-ledger-action-adapter-v0.1.0',
    },
    scheduledFor: capturedAt,
    status: 'LEASED',
    attempt: 1,
    maxAttempts: 3,
    availableAt: capturedAt,
    lease: knownValue({ owner: 'test-worker', token: 'a'.repeat(32), expiresAt: capturedAt }),
    result: unknownValue('NOT_QUERIED'),
    failure: unknownValue('NOT_APPLICABLE'),
    createdAt: capturedAt,
    updatedAt: capturedAt,
    completedAt: unknownValue('NOT_APPLICABLE'),
  };
}

function completeQuery() {
  return {
    schema: 'sqd-finalized-ingestion-v4',
    dataset: 'binance-mainnet',
    includeAllBlocks: true,
    materialize: {
      blocks: true,
      transactions: true,
      logs: true,
      traces: true,
      stateDiffs: true,
    },
    fields: { transaction: { transactionIndex: true } },
  };
}

function resources(options: { coverage?: boolean; completeProfile?: boolean } = {}) {
  const putReport = vi.fn(async (report: ActionSemanticsReport) => ({
    id: actionSemanticsReportId(report.resultHash),
    ledger: report.snapshot.ledger,
    chainId: report.snapshot.chainId,
    snapshotPosition: '42',
    snapshotHash:
      report.snapshot.ledger === 'SOLANA' ? report.snapshot.blockhash : report.snapshot.blockHash,
    transactionIds: [transactionId],
    resultHash: report.resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds: report.metadata.evidenceIds,
    sourceSet: report.metadata.sourceSet,
    modelVersion: report.metadata.modelVersion as 'action-semantics-v0.2.0',
    classificationCoverage: report.classificationCoverage,
    capturedAt: report.snapshot.capturedAt,
    createdAt: report.snapshot.capturedAt,
  }));
  const value = {
    facts: { listTransactionFacts: vi.fn(async () => [fact]) },
    ingestion: {
      findCompletedCoverage: vi.fn(async () =>
        options.coverage === false
          ? undefined
          : {
              id: '11111111-1111-4111-8111-111111111111',
              source: 'sqd:binance-mainnet',
              dataset: 'binance-mainnet',
              ledger: 'EVM' as const,
              chainId: '56',
              fromBlock: 42,
              toBlock: 42,
              queryHash: snapshot.configHash,
              query:
                options.completeProfile === false
                  ? { ...completeQuery(), materialize: {} }
                  : completeQuery(),
              status: 'REQUESTED_RANGE_COMPLETE' as const,
              nextBlock: 43,
              lastBlock: 42,
              lastErrorCode: null,
              startedAt: capturedAt,
              updatedAt: capturedAt,
              completedAt: capturedAt,
            },
      ),
    },
    evidence: {
      get: vi.fn(async () => ({ evidence, sourceEvidenceIds: [], snapshot })),
      put: vi.fn(async (item, sourceEvidenceIds, storedSnapshot) => ({
        evidence: item,
        sourceEvidenceIds: [...(sourceEvidenceIds ?? [])],
        ...(storedSnapshot === undefined ? {} : { snapshot: storedSnapshot }),
      })),
    },
    reports: { put: putReport },
  } satisfies ActionSemanticsCaptureResources;
  return value;
}

describe('Action Semantics transaction capture handler', () => {
  it('binds completed ingestion, raw facts, Evidence and immutable report persistence', async () => {
    const stores = resources();
    const result = await createActionSemanticsTransactionCaptureHandler(stores)(run());

    expect(result).toMatchObject({
      resultRef: expect.stringMatching(/^asr_[0-9a-f]{24}$/),
      snapshot,
      sourceSet: ['sqd:binance-mainnet'],
      modelVersion: 'action-semantics-v0.2.0',
      coverage: 1,
      confidence: 1,
    });
    expect(result.evidenceIds).toContain(evidence.id);
    expect(stores.evidence.put).toHaveBeenCalledOnce();
    expect(stores.reports.put).toHaveBeenCalledOnce();
    expect(hashPayload(stores.reports.put.mock.calls[0]?.[0]?.snapshot)).toBe(
      hashPayload(snapshot),
    );
  });

  it('retries when ingestion coverage is not terminal yet', async () => {
    const stores = resources({ coverage: false });
    await expect(
      createActionSemanticsTransactionCaptureHandler(stores)(run()),
    ).rejects.toMatchObject({ code: 'ACTION_CAPTURE_INGESTION_PENDING', sourceRetryable: true });
    expect(stores.reports.put).not.toHaveBeenCalled();
  });

  it('fails terminally when a completed run lacks the ledger-record profile', async () => {
    const stores = resources({ completeProfile: false });
    await expect(
      createActionSemanticsTransactionCaptureHandler(stores)(run()),
    ).rejects.toMatchObject({ code: 'ACTION_CAPTURE_COVERAGE_INCOMPLETE', sourceRetryable: false });
    expect(stores.reports.put).not.toHaveBeenCalled();
  });

  it('rejects a dataset that conflicts with the scheduled chain before storage access', async () => {
    const stores = resources();
    await expect(
      createActionSemanticsTransactionCaptureHandler(stores)(run('ethereum-mainnet')),
    ).rejects.toMatchObject({ code: 'ACTION_CAPTURE_DATASET_MISMATCH', sourceRetryable: false });
    expect(stores.facts.listTransactionFacts).not.toHaveBeenCalled();
  });
});
