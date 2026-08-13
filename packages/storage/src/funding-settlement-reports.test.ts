import { describe, expect, it } from 'vitest';

import {
  createEvmAssetTransferObservation,
  deriveFundingSettlementReport,
} from '@zerotrace/funding-settlement-engine';

import { PostgresFundingSettlementReportRepository } from './funding-settlement-reports.js';

class FakePool {
  row: Record<string, unknown> | undefined;

  async query(text: string, values: readonly unknown[] = []) {
    if (text.includes('to_regclass')) {
      return {
        rows: [{ table_name: 'funding_settlement_reports', migration_applied: true }],
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

function hashFor(value: number): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function report() {
  const token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const wallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const funder = '0xcccccccccccccccccccccccccccccccccccccccc';
  const asset = '0xdddddddddddddddddddddddddddddddddddddddd';
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '200',
    blockHash: hashFor(200),
    finality: 'finalized' as const,
    capturedAt: '2026-08-14T00:00:00.000Z',
    providerVersions: { rpc: 'test-v1' },
    adapterVersions: { engine: 'test-v1' },
    configHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    entityModelVersion: 'entity-test-v1',
    labelSnapshot: 'labels-test-v1',
  };
  const transfers = [
    createEvmAssetTransferObservation({
      chainId: 'eip155:56',
      asset,
      source: funder,
      destination: wallet,
      amountAtomic: '10',
      blockNumber: '100',
      blockHash: hashFor(100),
      transactionHash: hashFor(1),
      transactionIndex: '0',
      eventIndex: '0',
      observedAt: snapshot.capturedAt,
      execution: 'SUCCESS',
      finality: 'FINAL',
      evidenceIds: ['ev_000000000000000000000001'],
    }),
    createEvmAssetTransferObservation({
      chainId: 'eip155:56',
      asset: token,
      source: funder,
      destination: wallet,
      amountAtomic: '20',
      blockNumber: '150',
      blockHash: hashFor(150),
      transactionHash: hashFor(2),
      transactionIndex: '0',
      eventIndex: '0',
      observedAt: snapshot.capturedAt,
      execution: 'SUCCESS',
      finality: 'FINAL',
      evidenceIds: ['ev_000000000000000000000002'],
    }),
  ];
  return deriveFundingSettlementReport({
    token,
    fromBlock: '1',
    toBlock: '200',
    snapshot,
    transfers,
    focusWalletIds: [wallet],
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    coverageScope: 'RANGE_COMPLETE',
    sourceSet: ['exact-rpc:test'],
  });
}

describe('PostgresFundingSettlementReportRepository', () => {
  it('validates, writes, and replays an immutable graph report', async () => {
    const pool = new FakePool();
    const repository = PostgresFundingSettlementReportRepository.fromPool(pool);
    const expected = report();

    await expect(repository.put(expected)).resolves.toEqual(expected);
    await expect(repository.get(expected.id)).resolves.toEqual(expected);
    await expect(repository.latest(expected.chainId, expected.token)).resolves.toEqual(expected);
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await repository.close();
  });

  it('rejects an altered result hash before touching the database', async () => {
    const pool = new FakePool();
    const repository = PostgresFundingSettlementReportRepository.fromPool(pool);
    const invalid = { ...report(), resultHash: 'f'.repeat(64) };
    await expect(repository.put(invalid)).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_INVALID',
    });
    expect(pool.row).toBeUndefined();
  });

  it('rejects a nested observation outside the declared report range', async () => {
    const pool = new FakePool();
    const repository = PostgresFundingSettlementReportRepository.fromPool(pool);
    const valid = report();
    const invalid = {
      ...valid,
      fundingEdges: valid.fundingEdges.map((edge) => ({ ...edge, blockNumber: '201' })),
    };
    await expect(repository.put(invalid)).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_INVALID',
    });
    expect(pool.row).toBeUndefined();
  });
});
