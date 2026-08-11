import { describe, expect, it, vi } from 'vitest';

import type { EntityRelationshipTimelineReport } from '@zerotrace/schemas';

import { PostgresEntityRelationshipTimelineRepository } from './entity-relationship-timelines.js';

describe('PostgreSQL Entity relationship timeline repository', () => {
  it('rejects invalid reports and identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresEntityRelationshipTimelineRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as EntityRelationshipTimelineReport)).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_TIMELINE_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_TIMELINE_INVALID',
    });
    await expect(
      repository.latest({
        ledger: 'EVM',
        chainId: 'eip155:1',
        subjectA: 'same',
        subjectB: 'same',
      }),
    ).rejects.toMatchObject({ code: 'ENTITY_RELATIONSHIP_TIMELINE_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks both the immutable timeline table and migration marker', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ table_name: 'entity_relationship_timeline_reports', migration_applied: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresEntityRelationshipTimelineRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'ENTITY_RELATIONSHIP_TIMELINE_NOT_INITIALIZED',
    });
  });
});
