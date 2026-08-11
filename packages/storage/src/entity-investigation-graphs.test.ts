import { describe, expect, it, vi } from 'vitest';

import type { EntityInvestigationGraphReport } from '@zerotrace/schemas';

import { PostgresEntityInvestigationGraphRepository } from './entity-investigation-graphs.js';

describe('PostgreSQL Entity investigation graph repository', () => {
  it('rejects invalid reports and identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresEntityInvestigationGraphRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as EntityInvestigationGraphReport)).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_INVALID',
    });
    await expect(
      repository.latest({ ledger: 'EVM', chainId: '', subjectId: 'subject' }),
    ).rejects.toMatchObject({ code: 'ENTITY_INVESTIGATION_GRAPH_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks both the immutable graph table and migration marker', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ table_name: 'entity_investigation_graph_reports', migration_applied: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresEntityInvestigationGraphRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'ENTITY_INVESTIGATION_GRAPH_NOT_INITIALIZED',
    });
  });
});
