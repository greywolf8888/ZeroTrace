import { describe, expect, it, vi } from 'vitest';

import { PostgresBitcoinForensicGraphReportRepository } from './bitcoin-forensic-graph-reports.js';

function poolWith(rows: Array<Record<string, unknown>>) {
  return {
    async query(text: string) {
      if (text.includes('to_regclass')) {
        return {
          rows: [
            {
              table_name: 'bitcoin_forensic_graph_reports',
              migration_applied: true,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows, rowCount: rows.length };
    },
    async end() {},
  };
}

describe('Bitcoin forensic graph report storage', () => {
  it('reports durable readiness and validates IDs before querying', async () => {
    const repository = PostgresBitcoinForensicGraphReportRepository.fromPool(poolWith([]));
    await expect(repository.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
    });
    await expect(repository.get('not-a-report')).rejects.toMatchObject({
      code: 'BITCOIN_FORENSIC_GRAPH_INVALID',
    });
  });

  it('keeps provider/storage failures typed instead of returning an empty report', async () => {
    const repository = PostgresBitcoinForensicGraphReportRepository.fromPool({
      async query() {
        throw new Error('database offline');
      },
      async end() {},
    });
    await expect(repository.list()).rejects.toMatchObject({
      code: 'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
      retryable: true,
    });
  });

  it('keeps initialization and stored-payload conflicts explicit', async () => {
    const reportId = `bfg_${'1'.repeat(24)}`;
    const notInitialized = PostgresBitcoinForensicGraphReportRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      })),
      end: vi.fn(),
    });
    await expect(notInitialized.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'BITCOIN_FORENSIC_GRAPH_NOT_INITIALIZED',
    });

    const invalidRoot = PostgresBitcoinForensicGraphReportRepository.fromPool({
      query: vi.fn(),
      end: vi.fn(),
    });
    await expect(invalidRoot.list({ rootTxid: 'invalid' })).rejects.toMatchObject({
      code: 'BITCOIN_FORENSIC_GRAPH_INVALID',
    });

    const invalidJson = PostgresBitcoinForensicGraphReportRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [
          {
            id: reportId,
            report: '{not-json',
          },
        ],
        rowCount: 1,
      })),
      end: vi.fn(),
    });
    await expect(invalidJson.get(reportId)).rejects.toMatchObject({
      code: 'BITCOIN_FORENSIC_GRAPH_CONFLICT',
    });

    const unavailable = PostgresBitcoinForensicGraphReportRepository.fromPool({
      query: vi.fn().mockRejectedValue(new Error('offline')),
      end: vi.fn(),
    });
    await expect(unavailable.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
    });
    await expect(unavailable.list()).rejects.toMatchObject({
      code: 'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
      retryable: true,
    });
  });
});
