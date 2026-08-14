import { describe, expect, it } from 'vitest';

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
});
