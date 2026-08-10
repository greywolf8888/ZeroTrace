import { describe, expect, it, vi } from 'vitest';

import type {
  PostgresEvidenceRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import type { BurnPromotionWorkerConfig } from './burn-promotion-config.js';
import {
  runBurnPromotionWorker,
  type BurnPromotionWorkerResources,
} from './burn-promotion-worker.js';

const config = { token: `0x${'a'.repeat(40)}` } as BurnPromotionWorkerConfig;

function resources(
  health: { evidence?: object; checkpoints?: object } = {},
): BurnPromotionWorkerResources {
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

describe('burn promotion semantic worker', () => {
  it('fails closed before providers when durable checkpoints are unavailable', async () => {
    const workerResources = resources({
      checkpoints: { status: 'DOWN', errorCode: 'SEMANTIC_CHECKPOINT_NOT_INITIALIZED' },
    });
    const execute = vi.fn();
    await expect(runBurnPromotionWorker(config, workerResources, execute)).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_NOT_INITIALIZED',
      retryable: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('emits a credential-free replay summary without weakening Unknown semantics', async () => {
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '1099999',
      blockHash: `0x${'2'.repeat(64)}`,
      parentBlockHash: `0x${'1'.repeat(64)}`,
      finality: 'finalized' as const,
      capturedAt: '2026-08-11T00:00:00.000Z',
      blockTimestamp: '2026-08-10T23:59:57.000Z',
      providerVersions: { 'bsc-rpc@example': 'evm-ledger-v0.1.0' },
      adapterVersions: { evm: 'evm-ledger-v0.1.0' },
      configHash: '3'.repeat(64),
      entityModelVersion: 'entity-model-unapplied',
      labelSnapshot: 'labels-unapplied',
    };
    const evidenceIds = [
      'ev_000000000000000000000001',
      'ev_000000000000000000000002',
      'ev_000000000000000000000003',
    ];
    const execute = vi.fn().mockResolvedValue({
      scanId: '55555555-5555-4555-8555-555555555555',
      result: {
        tokenAddress: config.token,
        fromBlock: '100000',
        toBlock: '1099999',
        coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION',
        status: 'REQUESTED_RANGE_COMPLETE',
        segmentCount: 1,
        zeroAddressEventCount: 3,
        burnCandidateCount: 1,
        verifiedCandidateCount: 1,
        contradictedCandidateCount: 0,
        verifiedActionCount: 1,
        segments: [],
        silentSupplyChangeDetection: { state: 'unknown', reason: 'NOT_QUERIED' },
        terminalEvidenceId: evidenceIds[2],
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
          evidenceIds,
        },
      },
    });
    const workerResources = resources();

    await expect(runBurnPromotionWorker(config, workerResources, execute)).resolves.toEqual({
      event: 'erc20_burn_promotion_complete',
      scanId: '55555555-5555-4555-8555-555555555555',
      token: config.token,
      requestedRange: { fromBlock: '100000', toBlock: '1099999' },
      coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION',
      segmentCount: 1,
      zeroAddressEventCount: 3,
      burnCandidateCount: 1,
      verifiedCandidateCount: 1,
      contradictedCandidateCount: 0,
      verifiedActionCount: 1,
      silentSupplyChangeDetection: { state: 'unknown', reason: 'NOT_QUERIED' },
      terminalEvidenceId: evidenceIds[2],
      evidenceIds,
      snapshot,
      freshness: snapshot.blockTimestamp,
      sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
      modelVersion: 'erc20-burn-candidate-promotion-v1.0.0',
      confidence: 0.98,
    });
    expect(execute).toHaveBeenCalledWith(config, workerResources);
  });
});
