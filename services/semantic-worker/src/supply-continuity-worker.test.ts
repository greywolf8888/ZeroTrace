import { describe, expect, it, vi } from 'vitest';

import type {
  PostgresEvidenceRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import type { SupplyContinuityWorkerConfig } from './supply-continuity-config.js';
import {
  runSupplyContinuityWorker,
  type SupplyContinuityWorkerResources,
} from './supply-continuity-worker.js';

const config = { token: `0x${'a'.repeat(40)}` } as SupplyContinuityWorkerConfig;

function resources(
  health: { evidence?: object; checkpoints?: object } = {},
): SupplyContinuityWorkerResources {
  return {
    evidence: {
      health: vi.fn().mockResolvedValue(health.evidence ?? { status: 'UP' }),
    } as unknown as PostgresEvidenceRepository,
    checkpoints: {
      health: vi.fn().mockResolvedValue(health.checkpoints ?? { status: 'UP' }),
    } as unknown as PostgresSemanticScanCheckpointRepository,
    close: vi.fn(),
  };
}

describe('supply-continuity semantic worker', () => {
  it('fails closed before providers when durable Evidence is unavailable', async () => {
    const workerResources = resources({
      evidence: { status: 'DOWN', errorCode: 'STORAGE_NOT_INITIALIZED' },
    });
    const execute = vi.fn();
    await expect(runSupplyContinuityWorker(config, workerResources, execute)).rejects.toMatchObject(
      { code: 'STORAGE_NOT_INITIALIZED', retryable: true },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('emits a credential-free replay summary with exact coverage and independence', async () => {
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '100255',
      blockHash: `0x${'2'.repeat(64)}`,
      parentBlockHash: `0x${'1'.repeat(64)}`,
      finality: 'finalized' as const,
      capturedAt: '2026-08-11T00:00:00.000Z',
      blockTimestamp: '2026-08-10T23:59:57.000Z',
      providerVersions: { 'bsc-rpc@example': 'json-rpc' },
      adapterVersions: { evm: '0.1.0' },
      configHash: '3'.repeat(64),
      entityModelVersion: 'entity-model-unapplied',
      labelSnapshot: 'labels-unapplied',
    };
    const evidenceIds = ['ev_000000000000000000000001'];
    const sourceIndependence = { status: 'VERIFIED_INDEPENDENT' };
    const execute = vi.fn().mockResolvedValue({
      scanId: '55555555-5555-4555-8555-555555555555',
      result: {
        tokenAddress: config.token,
        fromBlock: '100000',
        toBlock: '100255',
        coverageScope: 'ERC20_TOTAL_SUPPLY_EVERY_FINALIZED_BLOCK_WITH_EVENT_RECONCILIATION',
        status: 'VERIFIED_NO_CHANGE',
        segmentCount: 2,
        scannedBlockCount: 256,
        supplySampleCount: 257,
        initialTotalSupply: '1000000000',
        finalTotalSupply: '1000000000',
        netSupplyDelta: '0',
        supplyChangeCount: 0,
        eventConservedChangeCount: 0,
        unexplainedChangeCount: 0,
        sourceIndependence,
        terminalEvidenceId: evidenceIds[0],
        metadata: {
          snapshot,
          freshness: snapshot.blockTimestamp,
          sourceSet: ['bsc-rpc@example'],
          modelVersion: 'erc20-supply-continuity-v1.0.0',
          confidence: 1,
          evidenceIds,
        },
      },
    });
    const workerResources = resources();

    await expect(runSupplyContinuityWorker(config, workerResources, execute)).resolves.toEqual({
      event: 'erc20_supply_continuity_complete',
      scanId: '55555555-5555-4555-8555-555555555555',
      token: config.token,
      requestedRange: { fromBlock: '100000', toBlock: '100255' },
      coverageScope: 'ERC20_TOTAL_SUPPLY_EVERY_FINALIZED_BLOCK_WITH_EVENT_RECONCILIATION',
      status: 'VERIFIED_NO_CHANGE',
      segmentCount: 2,
      scannedBlockCount: 256,
      supplySampleCount: 257,
      initialTotalSupply: '1000000000',
      finalTotalSupply: '1000000000',
      netSupplyDelta: '0',
      supplyChangeCount: 0,
      eventConservedChangeCount: 0,
      unexplainedChangeCount: 0,
      sourceIndependence,
      terminalEvidenceId: evidenceIds[0],
      evidenceIds,
      snapshot,
      freshness: snapshot.blockTimestamp,
      sourceSet: ['bsc-rpc@example'],
      modelVersion: 'erc20-supply-continuity-v1.0.0',
      confidence: 1,
    });
  });
});
