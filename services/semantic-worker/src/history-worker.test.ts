import { describe, expect, it, vi } from 'vitest';

import type {
  PostgresEvidenceRepository,
  PostgresFlapHistoryProjectionRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';
import type { runFlapEventHistoryProjectionRestartSafe } from '@zerotrace/platform-adapters';

import type { FlapHistoryWorkerConfig } from './history-config.js';
import { runFlapHistoryWorker, type FlapHistoryWorkerResources } from './history-worker.js';

const config = {
  token: `0x${'a'.repeat(40)}`,
} as FlapHistoryWorkerConfig;

function resources(
  health: {
    evidence?: object;
    checkpoints?: object;
    projection?: object;
  } = {},
): FlapHistoryWorkerResources {
  return {
    evidence: {
      health: vi.fn().mockResolvedValue(health.evidence ?? { status: 'UP' }),
    } as unknown as PostgresEvidenceRepository,
    checkpoints: {
      health: vi.fn().mockResolvedValue(health.checkpoints ?? { status: 'UP' }),
    } as unknown as PostgresSemanticScanCheckpointRepository,
    projection: {
      health: vi.fn().mockResolvedValue(health.projection ?? { status: 'UP' }),
    } as unknown as PostgresFlapHistoryProjectionRepository,
    close: vi.fn(),
  };
}

describe('Flap history semantic worker', () => {
  it('fails closed before providers when immutable projection storage is unavailable', async () => {
    const workerResources = resources({
      projection: {
        status: 'DOWN',
        errorCode: 'FLAP_HISTORY_PROJECTION_NOT_INITIALIZED',
      },
    });
    const execute = vi.fn();

    await expect(runFlapHistoryWorker(config, workerResources, execute)).rejects.toMatchObject({
      code: 'FLAP_HISTORY_PROJECTION_NOT_INITIALIZED',
      retryable: true,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(workerResources.evidence.health).toHaveBeenCalledOnce();
    expect(workerResources.checkpoints.health).toHaveBeenCalledOnce();
    expect(workerResources.projection.health).toHaveBeenCalledOnce();
  });

  it('emits a credential-free terminal summary with its replay scan ID', async () => {
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '199999',
      blockHash: `0x${'2'.repeat(64)}`,
      finality: 'finalized' as const,
      capturedAt: '2026-08-10T00:00:00.000Z',
      providerVersions: { 'bsc-rpc@example': 'evm-ledger-v0.1.0' },
      adapterVersions: { evm: 'evm-ledger-v0.1.0' },
      configHash: '3'.repeat(64),
      entityModelVersion: 'entity-model-unapplied',
      labelSnapshot: 'labels-unapplied',
    };
    const execute = vi.fn().mockResolvedValue({
      scanId: '33333333-3333-4333-8333-333333333333',
      result: {
        platform: 'flap',
        token: config.token,
        requestedRange: {
          fromBlock: '100000',
          toBlock: '199999',
          segmentSize: 50_000,
          segmentCount: 2,
        },
        requestedRangeCoverage: 1,
        lifetimeCoverage: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        segments: [
          {
            id: 'fhs_000000000000000000000001',
            fromBlock: '100000',
            toBlock: '149999',
            terminalEvidenceId: 'ev_000000000000000000000001',
            transactionCount: 0,
            unrecognizedPortalLogCount: 0,
          },
          {
            id: 'fhs_000000000000000000000002',
            fromBlock: '150000',
            toBlock: '199999',
            terminalEvidenceId: 'ev_000000000000000000000002',
            transactionCount: 1,
            unrecognizedPortalLogCount: 0,
          },
        ],
        transactionCount: 1,
        unrecognizedPortalLogCount: 0,
        terminalEvidenceId: 'ev_000000000000000000000003',
        metadata: {
          snapshot,
          dataCoverage: 1,
          sourceCoverage: 1,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: snapshot.capturedAt,
          sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
          modelVersion: 'flap-event-history-projection-v1',
          confidence: 0.95,
          evidenceIds: [
            'ev_000000000000000000000001',
            'ev_000000000000000000000002',
            'ev_000000000000000000000003',
          ],
        },
        evidence: [],
      },
    } satisfies Partial<Awaited<ReturnType<typeof runFlapEventHistoryProjectionRestartSafe>>>);
    const workerResources = resources();

    await expect(runFlapHistoryWorker(config, workerResources, execute)).resolves.toEqual({
      event: 'flap_history_projection_complete',
      scanId: '33333333-3333-4333-8333-333333333333',
      token: config.token,
      requestedRange: {
        fromBlock: '100000',
        toBlock: '199999',
        segmentSize: 50_000,
        segmentCount: 2,
      },
      coverage: 1,
      segmentCount: 2,
      transactionCount: 1,
      unrecognizedPortalLogCount: 0,
      terminalEvidenceId: 'ev_000000000000000000000003',
      evidenceIds: [
        'ev_000000000000000000000001',
        'ev_000000000000000000000002',
        'ev_000000000000000000000003',
      ],
      snapshot,
      freshness: snapshot.capturedAt,
      sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
      modelVersion: 'flap-event-history-projection-v1',
      confidence: 0.95,
      lifetimeCoverage: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(execute).toHaveBeenCalledWith(config, workerResources);
  });
});
