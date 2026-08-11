import { describe, expect, it, vi } from 'vitest';

import type { EntityInvestigationGraphTimelineReport } from '@zerotrace/schemas';

import { PostgresEntityInvestigationGraphTimelineRepository } from './entity-investigation-graph-timelines.js';

describe('PostgreSQL Entity investigation graph timeline repository', () => {
  it('rejects invalid reports and identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresEntityInvestigationGraphTimelineRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(
      repository.put({} as EntityInvestigationGraphTimelineReport),
    ).rejects.toMatchObject({ code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID' });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID',
    });
    await expect(
      repository.latest({ ledger: 'EVM', chainId: '', subjectId: 'subject' }),
    ).rejects.toMatchObject({ code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks both the immutable timeline table and migration marker', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            table_name: 'entity_investigation_graph_timeline_reports',
            migration_applied: true,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresEntityInvestigationGraphTimelineRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_NOT_INITIALIZED',
    });
  });
});
