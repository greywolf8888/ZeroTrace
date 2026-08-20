import { describe, expect, it, vi } from 'vitest';

import {
  canonicalizeEntityRelationshipInput,
  resolveEntityRelationship,
} from '@zerotrace/entity-engine';
import { createEvidence } from '@zerotrace/evidence';
import { EntityRelationshipReportSchema, type EntityRelationshipReport } from '@zerotrace/schemas';

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

const capturedAt = '2026-08-14T00:00:00.000Z';
const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '101',
  blockHash: `0x${'b'.repeat(64)}`,
  parentBlockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt,
  providerVersions: { rpc: 'test' },
  adapterVersions: { evm: 'test' },
  configHash: 'c'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-empty-v1',
};

function storedRelationshipReport() {
  const source = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'CONTRACT_STATE',
    source: 'test-rpc',
    locator: 'authority:wallet-a:wallet-b@101',
    payload: { authority: 'shared' },
    blockOrSlot: '101',
    finality: 'finalized',
    observedAt: capturedAt,
    summary: 'Shared on-chain authority observation.',
  });
  const input = canonicalizeEntityRelationshipInput({
    subjectA: 'wallet-b',
    subjectB: 'wallet-a',
    features: [
      {
        kind: 'SHARED_ONCHAIN_AUTHORITY',
        strength: 1,
        reliability: 1,
        evidenceId: source.id,
      },
    ],
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: capturedAt,
      sourceSet: [source.source],
      modelVersion: 'test-feature-extractor-v1',
      confidence: 1,
      evidenceIds: [source.id],
    },
  });
  const result = resolveEntityRelationship(input);
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:entity-v0.1.0',
    locator: `entity-relationship:${input.subjectA}:${input.subjectB}`,
    payload: { input, result },
    blockOrSlot: '101',
    finality: 'finalized',
    observedAt: capturedAt,
    summary: 'Evidence-weighted relationship inference.',
    sourceEvidenceIds: [source.id],
  });
  return EntityRelationshipReportSchema.parse({
    schemaVersion: 'entity-relationship-report-v1',
    automaticOwnershipMergeAllowed: false,
    input,
    result: {
      ...result,
      metadata: {
        ...result.metadata,
        evidenceIds: [...result.metadata.evidenceIds, terminal.id].sort(),
      },
    },
    terminalEvidenceId: terminal.id,
    evidence: [source, terminal].sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function reportRow(values: readonly unknown[]) {
  return {
    id: values[0],
    ledger: values[1],
    chain_id: values[2],
    subject_a: values[3],
    subject_b: values[4],
    snapshot_position: values[5],
    snapshot_hash: values[6],
    result_hash: values[7],
    report: values[8],
    terminal_evidence_id: values[9],
    evidence_ids: values[10],
    source_set: values[11],
    model_version: values[12],
    captured_at: values[13],
    created_at: values[13],
  };
}

describe('PostgreSQL entity relationship report writes', () => {
  it('writes, replays, lists latest and bounded history without inventing missing rows', async () => {
    const report = storedRelationshipReport();
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO entity_relationship_reports')) {
        row ??= reportRow(values);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM entity_relationship_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresEntityRelationshipReportRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });
    const first = await repository.put(report);
    await expect(repository.put(report)).resolves.toMatchObject({ id: first.id });
    await expect(repository.get(first.id)).resolves.toMatchObject({ id: first.id });
    await expect(
      repository.latest({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectA: 'wallet-b',
        subjectB: 'wallet-a',
      }),
    ).resolves.toMatchObject({ id: first.id });
    await expect(
      repository.history({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        fromPosition: '1',
        toPosition: '200',
        limit: 10,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: first.id })]);
    await repository.close();
  });

  it('keeps missing reports undefined and maps unavailable storage honestly', async () => {
    const report = storedRelationshipReport();
    const empty = PostgresEntityRelationshipReportRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(empty.get(`erh_${'a'.repeat(24)}`)).resolves.toBeUndefined();
    await expect(
      empty.latest({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
      }),
    ).resolves.toBeUndefined();

    const down = PostgresEntityRelationshipReportRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      end: vi.fn(),
    });
    await expect(down.put(report)).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
    });
    await expect(down.get(`erh_${'a'.repeat(24)}`)).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
    });
    await expect(
      down.latest({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
      }),
    ).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
    });
    await expect(
      down.history({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
      }),
    ).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
    });
    await expect(down.health()).resolves.toMatchObject({
      errorCode: 'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
    });
  });
});
