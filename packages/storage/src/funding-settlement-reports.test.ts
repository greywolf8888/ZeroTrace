import { describe, expect, it, vi } from 'vitest';

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

  it('replays the report that exactly matches a selected campaign range', async () => {
    const expected = report();
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('to_regclass')) {
        return {
          rows: [{ table_name: 'funding_settlement_reports', migration_applied: true }],
          rowCount: 1,
        };
      }
      expect(text).toContain('from_block = $3::numeric AND to_block = $4::numeric');
      expect(values).toEqual([expected.chainId, expected.token, '1', '200']);
      return {
        rows: [{ id: expected.id, report: expected, created_at: expected.freshness }],
        rowCount: 1,
      };
    });
    const repository = PostgresFundingSettlementReportRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });

    await expect(
      repository.forRange(expected.chainId, expected.token, '1', '200'),
    ).resolves.toEqual(expected);
  });

  it('keeps an absent or reversed range explicit', async () => {
    const expected = report();
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = PostgresFundingSettlementReportRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });

    await expect(
      repository.forRange(expected.chainId, expected.token, '201', '200'),
    ).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
    await expect(
      repository.forRange(expected.chainId, expected.token, '201', '202'),
    ).resolves.toBeUndefined();
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

  it('keeps malformed replay rows and unavailable durable reads explicit', async () => {
    const expected = report();
    const jsonRepository = PostgresFundingSettlementReportRepository.fromPool({
      query: vi.fn(async (text: string) =>
        text.includes('to_regclass')
          ? {
              rows: [{ table_name: 'funding_settlement_reports', migration_applied: false }],
              rowCount: 1,
            }
          : {
              rows: [
                {
                  id: expected.id,
                  report: JSON.stringify(expected),
                  created_at: expected.freshness,
                },
              ],
              rowCount: 1,
            },
      ),
      end: vi.fn(async () => undefined),
    });
    await expect(jsonRepository.get(expected.id)).resolves.toEqual(expected);
    await expect(jsonRepository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'FUNDING_SETTLEMENT_REPORT_NOT_INITIALIZED',
    });
    await expect(jsonRepository.latest('invalid', expected.token)).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_INVALID',
    });

    const mismatch = PostgresFundingSettlementReportRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ id: `fsr_${'f'.repeat(24)}`, report: expected, created_at: expected.freshness }],
        rowCount: 1,
      })),
      end: vi.fn(async () => undefined),
    });
    await expect(mismatch.get(expected.id)).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_CONFLICT',
    });

    const malformed = PostgresFundingSettlementReportRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ id: expected.id, report: '{not-json', created_at: expected.freshness }],
        rowCount: 1,
      })),
      end: vi.fn(async () => undefined),
    });
    await expect(malformed.get(expected.id)).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_CONFLICT',
    });

    const unavailable = PostgresFundingSettlementReportRepository.fromPool({
      query: vi.fn().mockRejectedValue(new Error('offline')),
      end: vi.fn(async () => undefined),
    });
    await expect(unavailable.get(expected.id)).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
      retryable: true,
    });
    await expect(unavailable.latest(expected.chainId, expected.token)).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
      retryable: true,
    });
    await expect(unavailable.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
    });
  });

  it('maps PostgreSQL integrity failures to conflicts and other writes to retryable outages', async () => {
    const expected = report();
    const integrity = PostgresFundingSettlementReportRepository.fromPool({
      query: vi.fn(async (text: string) => {
        if (text.includes('INSERT INTO')) {
          throw Object.assign(new Error('constraint'), { code: '23505' });
        }
        return { rows: [], rowCount: 0 };
      }),
      end: vi.fn(async () => undefined),
    });
    await expect(integrity.put(expected)).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_CONFLICT',
      retryable: false,
    });

    const unavailable = PostgresFundingSettlementReportRepository.fromPool({
      query: vi.fn(async (text: string) => {
        if (text.includes('INSERT INTO')) throw new Error('database offline');
        return { rows: [], rowCount: 0 };
      }),
      end: vi.fn(async () => undefined),
    });
    await expect(unavailable.put(expected)).rejects.toMatchObject({
      code: 'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
      retryable: true,
    });
  });
});
