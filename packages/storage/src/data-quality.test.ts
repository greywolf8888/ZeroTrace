import { describe, expect, it, vi } from 'vitest';

import { createDataQualityAlert, persistChainAnchorObservation } from '@zerotrace/data-quality';
import { hashPayload } from '@zerotrace/evidence';
import type { ChainAnchorRead } from '@zerotrace/schemas';

import {
  DataQualityStorageError,
  PostgresDataQualityRepository,
  type DataQualityDatabaseClient,
  type DataQualityDatabasePool,
} from './data-quality.js';

function anchorRead(): ChainAnchorRead {
  const source = 'bsc-a';
  const observedAt = '2026-08-10T01:00:00.000Z';
  const hash = `0x${'a'.repeat(64)}`;
  const parentHash = `0x${'b'.repeat(64)}`;
  return {
    anchor: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      position: '100',
      hash,
      parentPosition: '99',
      parentHash,
      finality: 'finalized',
      source,
      observedAt,
    },
    snapshot: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      blockNumber: '100',
      blockHash: hash,
      parentBlockHash: parentHash,
      finality: 'finalized',
      capturedAt: observedAt,
      providerVersions: { [source]: 'json-rpc' },
      adapterVersions: { evm: 'test' },
      configHash: hashPayload({ source }),
      entityModelVersion: 'entity-unapplied',
      labelSnapshot: 'labels-unapplied',
    },
    payload: { number: '0x64', hash, parentHash },
  };
}

const observation = persistChainAnchorObservation(anchorRead(), 'HEAD', `ev_${'c'.repeat(24)}`);

const alert = createDataQualityAlert({
  kind: 'REORG_DETECTED',
  severity: 'CRITICAL',
  ledger: 'EVM',
  chainId: 'eip155:56',
  position: '100',
  summary: 'Finalized anchor changed.',
  details: { previous: 'anchor-old', current: observation.id },
  evidenceIds: [`ev_${'d'.repeat(24)}`, `ev_${'c'.repeat(24)}`],
  observedAt: '2026-08-10T01:00:05.000Z',
  modelVersion: 'anchor-reconciliation-v1',
});

function pool(input: {
  query?: DataQualityDatabasePool['query'];
  connect?: DataQualityDatabasePool['connect'];
  end?: DataQualityDatabasePool['end'];
}): DataQualityDatabasePool {
  return {
    query: input.query ?? vi.fn(),
    connect: input.connect ?? vi.fn(),
    end: input.end ?? vi.fn(),
  };
}

describe('PostgresDataQualityRepository', () => {
  it('writes and read-verifies canonical anchor payloads', async () => {
    const query = vi
      .fn<DataQualityDatabasePool['query']>()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ payload: observation }], rowCount: 1 });
    const repository = PostgresDataQualityRepository.fromPool(pool({ query }));

    await expect(repository.putAnchor(observation)).resolves.toEqual(observation);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO chain_anchor_observations');
    expect(query.mock.calls[0]?.[1]).not.toContain(undefined);
  });

  it('rejects a stored anchor payload that conflicts with its requested identity', async () => {
    const query = vi
      .fn<DataQualityDatabasePool['query']>()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ payload: { ...observation, source: 'different-source' } }],
        rowCount: 1,
      });
    const repository = PostgresDataQualityRepository.fromPool(pool({ query }));

    await expect(repository.putAnchor(observation)).rejects.toMatchObject({
      code: 'DATA_QUALITY_STORAGE_CONFLICT',
    });
  });

  it('returns the latest validated head for one exact source', async () => {
    const query = vi.fn<DataQualityDatabasePool['query']>().mockResolvedValue({
      rows: [{ payload: JSON.stringify(observation) }],
      rowCount: 1,
    });
    const repository = PostgresDataQualityRepository.fromPool(pool({ query }));

    await expect(repository.latestHead('EVM', 'eip155:56', 'bsc-a')).resolves.toEqual(observation);
    expect(query.mock.calls[0]?.[1]).toEqual(['EVM', 'eip155:56', 'bsc-a']);
  });

  it('stores an alert and its Evidence edges in one transaction', async () => {
    const statements: string[] = [];
    const client: DataQualityDatabaseClient = {
      query: vi.fn(async (text) => {
        statements.push(text.trim());
        if (text.includes('INSERT INTO data_quality_alerts')) {
          return { rows: [{ id: alert.id }], rowCount: 1 };
        }
        if (text.includes('FROM data_quality_alerts alert')) {
          return {
            rows: [{ payload: alert, evidence_ids: [...alert.evidenceIds].sort() }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const repository = PostgresDataQualityRepository.fromPool(
      pool({ connect: vi.fn(async () => client) }),
    );

    await expect(repository.putAlert(alert)).resolves.toEqual(alert);
    expect(statements[0]).toBe('BEGIN');
    expect(
      statements.filter((text) => text.startsWith('INSERT INTO data_quality_alert_evidence')),
    ).toHaveLength(alert.evidenceIds.length);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back alert writes when Evidence integrity cannot be verified', async () => {
    const statements: string[] = [];
    const client: DataQualityDatabaseClient = {
      query: vi.fn(async (text) => {
        statements.push(text.trim());
        if (text.includes('INSERT INTO data_quality_alerts')) {
          return { rows: [{ id: alert.id }], rowCount: 1 };
        }
        if (text.includes('FROM data_quality_alerts alert')) {
          return { rows: [{ payload: alert, evidence_ids: [] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    const repository = PostgresDataQualityRepository.fromPool(
      pool({ connect: vi.fn(async () => client) }),
    );

    await expect(repository.putAlert(alert)).rejects.toBeInstanceOf(DataQualityStorageError);
    expect(statements.at(-1)).toBe('ROLLBACK');
  });

  it('reports migration-aware health without exposing connection details', async () => {
    const query = vi.fn<DataQualityDatabasePool['query']>().mockResolvedValue({
      rows: [
        {
          anchor_table: 'chain_anchor_observations',
          alert_table: 'data_quality_alerts',
          alert_evidence_table: 'data_quality_alert_evidence',
          migration_applied: true,
        },
      ],
      rowCount: 1,
    });
    const end = vi.fn(async () => undefined);
    const repository = PostgresDataQualityRepository.fromPool(pool({ query, end }));

    await expect(repository.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
    });
    await repository.close();
    expect(end).toHaveBeenCalledOnce();
  });
});
