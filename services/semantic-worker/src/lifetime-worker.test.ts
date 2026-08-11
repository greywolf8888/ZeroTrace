import { describe, expect, it, vi } from 'vitest';

import {
  EvmLedgerAdapter,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import type { materializeFlapLifetimeRestartSafe } from '@zerotrace/platform-adapters';
import type {
  PostgresEvidenceRepository,
  PostgresFlapHistoryProjectionRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import type { FlapLifetimeWorkerConfig } from './lifetime-config.js';
import {
  exactFinalizedTarget,
  runFlapLifetimeWorker,
  type FlapLifetimeWorkerResources,
} from './lifetime-worker.js';

const token = `0x${'a'.repeat(40)}`;
const config = { token } as FlapLifetimeWorkerConfig;

function resources(
  health: { evidence?: object; checkpoints?: object; projection?: object } = {},
): FlapLifetimeWorkerResources {
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

function block(number: number) {
  return {
    number: `0x${number.toString(16)}`,
    hash: `0x${number.toString(16).padStart(64, '0')}`,
    parentHash: `0x${(number - 1).toString(16).padStart(64, '0')}`,
    timestamp: '0x66',
  };
}

class FinalizedTargetTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-target-fixture';

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    return (await this.requestSourced<T>(method, params)).value;
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    if (method !== 'eth_getBlockByNumber') throw new Error(`Unexpected method ${method}`);
    const tag = params[0];
    const value = tag === 'finalized' ? block(103) : tag === '0x66' ? block(102) : null;
    return { value: value as T, endpointId: this.endpointId };
  }
}

function targetAdapter() {
  return new EvmLedgerAdapter(
    {
      id: 'bsc-target-fixture',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    new FinalizedTargetTransport(),
  );
}

describe('Flap lifetime semantic worker', () => {
  it('fails closed before providers when immutable projection storage is unavailable', async () => {
    const workerResources = resources({
      projection: {
        status: 'DOWN',
        errorCode: 'FLAP_HISTORY_PROJECTION_NOT_INITIALIZED',
      },
    });
    const execute = vi.fn();

    await expect(runFlapLifetimeWorker(config, workerResources, execute)).rejects.toMatchObject({
      code: 'FLAP_HISTORY_PROJECTION_NOT_INITIALIZED',
      retryable: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('proves a pinned target against the captured finalized head', async () => {
    const target = await exactFinalizedTarget(targetAdapter(), 102);
    expect(target).toMatchObject({
      anchor: { position: '102', finality: 'finalized' },
      snapshot: { blockNumber: '102', finality: 'finalized' },
      payload: {
        finalizedHeadPosition: '103',
        verification: 'target_at_or_before_finalized_head',
      },
    });
    await expect(exactFinalizedTarget(targetAdapter(), 104)).rejects.toMatchObject({
      code: 'TARGET_NOT_FINALIZED',
      retryable: true,
    });
  });

  it('emits a credential-free terminal summary with composite and child scan IDs', async () => {
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '50000103',
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
        token,
        dataset: 'binance-mainnet',
        datasetStartBlock: '0',
        targetBlock: '50000103',
        originScanId: '11111111-1111-4111-8111-111111111111',
        originSearchCoverage: 1,
        origin: {
          state: 'known',
          value: {
            contractCreator: `0x${'b'.repeat(40)}`,
            launchCreator: `0x${'c'.repeat(40)}`,
            bytecodeFingerprint: '4'.repeat(64),
            creationTrace: {
              transactionHash: `0x${'5'.repeat(64)}`,
              blockNumber: '50000000',
              blockHash: `0x${'6'.repeat(64)}`,
              transactionIndex: '1',
              traceAddress: [0],
            },
            tokenCreatedPosition: {
              transactionHash: `0x${'5'.repeat(64)}`,
              blockNumber: '50000000',
              blockHash: `0x${'6'.repeat(64)}`,
              transactionIndex: '1',
              logIndex: '0',
            },
            evidenceIds: ['ev_000000000000000000000001', 'ev_000000000000000000000002'],
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
          terminalEvidenceId: 'ev_000000000000000000000002',
        },
        lifetimeCoverage: { state: 'known', value: true },
        terminalEvidenceId: 'ev_000000000000000000000003',
        metadata: {
          snapshot,
          dataCoverage: 1,
          sourceCoverage: 1,
          historyCoverage: 1,
          simulationCoverage: 0,
          freshness: snapshot.capturedAt,
          sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
          modelVersion: 'flap-lifetime-materialization-v1',
          confidence: 0.95,
          evidenceIds: [
            'ev_000000000000000000000001',
            'ev_000000000000000000000002',
            'ev_000000000000000000000003',
          ],
        },
        evidence: [],
      },
    } satisfies Partial<Awaited<ReturnType<typeof materializeFlapLifetimeRestartSafe>>>);
    const workerResources = resources();

    await expect(runFlapLifetimeWorker(config, workerResources, execute)).resolves.toEqual({
      event: 'flap_lifetime_materialization_complete',
      scanId: '33333333-3333-4333-8333-333333333333',
      token,
      dataset: 'binance-mainnet',
      datasetStartBlock: '0',
      targetBlock: '50000103',
      originScanId: '11111111-1111-4111-8111-111111111111',
      originState: 'known',
      historyScanId: '22222222-2222-4222-8222-222222222222',
      lifetimeCoverage: { state: 'known', reason: null },
      terminalEvidenceId: 'ev_000000000000000000000003',
      evidenceIds: [
        'ev_000000000000000000000001',
        'ev_000000000000000000000002',
        'ev_000000000000000000000003',
      ],
      snapshot,
      freshness: snapshot.capturedAt,
      sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
      modelVersion: 'flap-lifetime-materialization-v1',
      confidence: 0.95,
    });
    expect(execute).toHaveBeenCalledWith(config, workerResources);
  });
});
