import { describe, expect, it } from 'vitest';

import { hashPayload } from '@zerotrace/evidence';
import {
  TokenHistoryDiscoveryReportSchema,
  type TokenHistoryDiscoveryReport,
} from '@zerotrace/schemas';

import { PostgresTokenHistoryDiscoveryReportRepository } from './token-history-discovery-reports.js';

class FakePool {
  row: Record<string, unknown> | undefined;

  async query(text: string, values: readonly unknown[] = []) {
    if (text.includes('to_regclass')) {
      return {
        rows: [{ table_name: 'token_history_discovery_reports', migration_applied: true }],
        rowCount: 1,
      };
    }
    if (text.includes('INSERT INTO')) {
      this.row = {
        id: values[0],
        report: values[10],
        created_at: new Date('2026-08-14T00:00:00.000Z'),
      };
      return { rows: [], rowCount: 1 };
    }
    return {
      rows: this.row === undefined ? [] : [this.row],
      rowCount: this.row === undefined ? 0 : 1,
    };
  }

  async end(): Promise<void> {}
}

function report(): TokenHistoryDiscoveryReport {
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:1',
    blockNumber: '1',
    blockHash: `0x${'a'.repeat(64)}`,
    parentBlockHash: `0x${'b'.repeat(64)}`,
    finality: 'finalized' as const,
    capturedAt: '2026-08-14T00:00:00.000Z',
    providerVersions: { 'sqd:ethereum-mainnet': 'sqd-finalized' },
    adapterVersions: { ingestion: 'v1' },
    configHash: hashPayload('config'),
    entityModelVersion: 'entity-model-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
  const core = {
    schemaVersion: 'token-history-discovery-v1' as const,
    id: `thd_${'c'.repeat(24)}`,
    ledger: 'EVM' as const,
    chainId: 'eip155:1',
    token: `0x${'d'.repeat(40)}`,
    fromBlock: '1',
    toBlock: '1',
    status: 'COMPLETE' as const,
    origin: { state: 'unknown' as const, reason: 'NOT_QUERIED' as const },
    observations: [],
    relevantTransactionHashes: [],
    actionSemanticsBindings: [],
    sourceHead: { state: 'known' as const, value: '1' },
    checkpoint: {
      runId: 'run-1',
      nextBlock: '2',
      status: 'REQUESTED_RANGE_COMPLETE' as const,
      lastBlock: '1',
      finalizedHead: '1',
      queryHash: hashPayload('query'),
    },
    providerTelemetry: {
      requests: 1,
      retries: 0,
      rateLimitEvents: 0,
      rangeAdjustments: 0,
    },
    providerCapabilityDeclarations: [
      {
        id: 'exact-rpc:eip155:1',
        ledger: 'EVM' as const,
        chainId: 'eip155:1',
        capabilities: ['BLOCK', 'RECEIPT', 'TRANSACTION'],
        configured: false,
        version: 'token-history-exact-rpc-v1.0.0',
      },
      {
        id: 'sqd:ethereum-mainnet',
        ledger: 'EVM' as const,
        chainId: 'eip155:1',
        capabilities: ['BLOCK', 'LOG', 'TRACE', 'TRANSACTION'],
        configured: true,
        version: 'sqd-finalized-ingestion-v4',
      },
    ],
    snapshot,
    rangeEvidenceIds: ['ev:block'],
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    freshness: snapshot.capturedAt,
    sourceSet: ['sqd:ethereum-mainnet'],
    modelVersion: 'token-history-discovery-v1.0.0' as const,
    policyVersion: 'token-history-policy-v1.0.0' as const,
    evidenceIds: ['ev:block'],
  };
  return TokenHistoryDiscoveryReportSchema.parse({
    ...core,
    resultHash: hashPayload({ schema: 'token-history-discovery-result-v1', reportCore: core }),
  });
}

describe('PostgresTokenHistoryDiscoveryReportRepository', () => {
  it('validates, writes, and replays an immutable report', async () => {
    const pool = new FakePool();
    const repository = PostgresTokenHistoryDiscoveryReportRepository.fromPool(pool);
    const expected = report();

    await expect(repository.put(expected)).resolves.toEqual(expected);
    await expect(repository.get(expected.id)).resolves.toEqual(expected);
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await repository.close();
  });

  it('rejects an altered result hash before touching the database', async () => {
    const pool = new FakePool();
    const repository = PostgresTokenHistoryDiscoveryReportRepository.fromPool(pool);
    const invalid = { ...report(), resultHash: 'f'.repeat(64) };
    await expect(repository.put(invalid)).rejects.toMatchObject({
      code: 'TOKEN_HISTORY_REPORT_INVALID',
    });
    expect(pool.row).toBeUndefined();
  });
});
