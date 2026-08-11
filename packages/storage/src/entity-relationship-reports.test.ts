import { describe, expect, it, vi } from 'vitest';

import type { EntityRelationshipReport } from '@zerotrace/schemas';

import { PostgresEntityRelationshipReportRepository } from './entity-relationship-reports.js';

describe('PostgreSQL Entity relationship hypothesis report repository', () => {
  it('rejects invalid reports and lookup identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresEntityRelationshipReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as EntityRelationshipReport)).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_REPORT_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_REPORT_INVALID',
    });
    await expect(
      repository.latest({
        ledger: 'EVM',
        chainId: 'eip155:1',
        subjectA: 'same',
        subjectB: 'same',
      }),
    ).rejects.toMatchObject({ code: 'ENTITY_RELATIONSHIP_REPORT_INVALID' });
    await expect(
      repository.history({
        ledger: 'EVM',
        chainId: 'eip155:1',
        subjectA: 'a',
        subjectB: 'b',
        fromPosition: '2',
        toPosition: '1',
      }),
    ).rejects.toMatchObject({ code: 'ENTITY_RELATIONSHIP_REPORT_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('queries a canonical bounded history in chronological order', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = PostgresEntityRelationshipReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(
      repository.history({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectA: 'z',
        subjectB: 'a',
        fromPosition: '10',
        toPosition: '20',
        limit: 100,
      }),
    ).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY snapshot_position ASC'), [
      'EVM',
      'eip155:56',
      'a',
      'z',
      '10',
      '20',
      100,
    ]);
  });

  it('checks both the immutable report table and migration marker', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ table_name: 'entity_relationship_reports', migration_applied: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresEntityRelationshipReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'ENTITY_RELATIONSHIP_REPORT_NOT_INITIALIZED',
    });
  });
});
