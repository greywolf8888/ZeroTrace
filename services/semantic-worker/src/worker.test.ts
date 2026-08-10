import { describe, expect, it, vi } from 'vitest';

import type {
  PostgresEvidenceRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';
import type { inspectFlapTokenOriginRestartSafe } from '@zerotrace/platform-adapters';

import type { FlapOriginWorkerConfig } from './config.js';
import { runFlapOriginWorker, type FlapOriginWorkerResources } from './worker.js';

const config = {
  token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
} as FlapOriginWorkerConfig;

describe('Flap origin semantic worker', () => {
  it('fails closed before provider access when durable Evidence is unavailable', async () => {
    const evidenceHealth = vi.fn().mockResolvedValue({
      status: 'DOWN',
      errorCode: 'STORAGE_NOT_INITIALIZED',
    });
    const checkpointHealth = vi.fn().mockResolvedValue({ status: 'UP' });
    const resources = {
      evidence: { health: evidenceHealth } as unknown as PostgresEvidenceRepository,
      checkpoints: {
        health: checkpointHealth,
      } as unknown as PostgresSemanticScanCheckpointRepository,
      close: vi.fn(),
    } satisfies FlapOriginWorkerResources;

    await expect(runFlapOriginWorker(config, resources)).rejects.toMatchObject({
      code: 'STORAGE_NOT_INITIALIZED',
      retryable: true,
    });
    expect(evidenceHealth).toHaveBeenCalledOnce();
    expect(checkpointHealth).toHaveBeenCalledOnce();
  });

  it('emits only the bounded terminal summary after healthy storage', async () => {
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '999999',
      blockHash: `0x${'2'.repeat(64)}`,
      finality: 'finalized' as const,
      capturedAt: '2026-08-10T00:00:00.000Z',
      providerVersions: { 'bsc-rpc@example': 'evm-ledger-v0.1.0' },
      adapterVersions: { evm: 'evm-ledger-v0.1.0' },
      configHash: '3'.repeat(64),
      entityModelVersion: 'entity-model-unapplied',
      labelSnapshot: 'labels-unapplied',
    };
    const resources = {
      evidence: {
        health: vi.fn().mockResolvedValue({ status: 'UP' }),
      } as unknown as PostgresEvidenceRepository,
      checkpoints: {
        health: vi.fn().mockResolvedValue({ status: 'UP' }),
      } as unknown as PostgresSemanticScanCheckpointRepository,
      close: vi.fn(),
    } satisfies FlapOriginWorkerResources;
    const execute = vi.fn().mockResolvedValue({
      token: config.token,
      searchedRange: {
        fromBlock: '0',
        toBlock: '999999',
        chunkSize: 1_000_000,
        chunkCount: 1,
      },
      searchedRangeCoverage: 1,
      origin: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      lifetimeCoverage: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      observedCreationCount: 0,
      metadata: {
        snapshot,
        dataCoverage: 1,
        sourceCoverage: 1,
        historyCoverage: 0,
        simulationCoverage: 0,
        freshness: '2026-08-10T00:00:00.000Z',
        sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
        modelVersion: 'flap-token-origin-v1',
        confidence: 0,
        evidenceIds: ['ev_000000000000000000000001', 'ev_000000000000000000000002'],
      },
      evidence: [
        {
          id: 'ev_000000000000000000000001',
          ledger: 'EVM',
          chainId: 'eip155:56',
          kind: 'TRACE',
          source: 'sqd:binance-mainnet',
          locator: 'bounded-range:0-999999',
          payloadHash: `sha256:${'0'.repeat(64)}`,
          observedAt: '2026-08-10T00:00:00.000Z',
          summary: 'Bounded source observation.',
        },
        {
          id: 'ev_000000000000000000000002',
          ledger: 'EVM',
          chainId: 'eip155:56',
          kind: 'NEGATIVE_EVIDENCE',
          source: 'zerotrace:flap-token-origin-v1',
          locator: 'flap-token-origin:bounded-range',
          payloadHash: `sha256:${'1'.repeat(64)}`,
          observedAt: '2026-08-10T00:00:00.000Z',
          summary: 'No unique creation was proven inside the bounded range.',
        },
      ],
    } satisfies Partial<Awaited<ReturnType<typeof inspectFlapTokenOriginRestartSafe>>>);

    await expect(runFlapOriginWorker(config, resources, execute)).resolves.toEqual({
      event: 'flap_origin_scan_complete',
      token: config.token,
      searchedRange: {
        fromBlock: '0',
        toBlock: '999999',
        chunkSize: 1_000_000,
        chunkCount: 1,
      },
      coverage: 1,
      originState: 'unknown',
      observedCreationCount: 0,
      terminalEvidenceId: 'ev_000000000000000000000002',
      evidenceIds: ['ev_000000000000000000000001', 'ev_000000000000000000000002'],
      snapshot,
      freshness: '2026-08-10T00:00:00.000Z',
      sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
      modelVersion: 'flap-token-origin-v1',
      confidence: 0,
      lifetimeCoverage: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(execute).toHaveBeenCalledWith(config, resources);
  });
});
