import { describe, expect, it, vi } from 'vitest';

import { buildEntityRelationshipTimeline } from '@zerotrace/entity-engine';
import { createEvidence } from '@zerotrace/evidence';
import {
  EntityRelationshipTimelineReportSchema,
  knownValue,
  unknownValue,
  type EntityRelationshipTimelineObservation,
  type EntityRelationshipTimelineReport,
} from '@zerotrace/schemas';

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

const capturedAt = '2026-08-14T00:00:00.000Z';

function snapshotAt(position: string) {
  return {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: position,
    blockHash: `0x${position.padStart(64, 'b')}`,
    finality: 'finalized' as const,
    capturedAt,
    providerVersions: { rpc: 'test' },
    adapterVersions: { evm: 'test' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-empty-v1',
  };
}

function relationshipObservation(
  position: string,
  reportId: string,
  evidenceId: string,
  classification: EntityRelationshipTimelineObservation['classification'],
) {
  const snapshot = snapshotAt(position);
  return {
    observation: {
      reportId,
      resultHash: reportId.replace('erh_', '').padEnd(64, '0'),
      snapshot,
      classification,
      sameControllerProbability:
        classification === 'UNKNOWN' ? unknownValue('INSUFFICIENT_DATA') : knownValue(0.9),
      coordinationProbability:
        classification === 'UNKNOWN' ? unknownValue('INSUFFICIENT_DATA') : knownValue(0.2),
      independenceProbability:
        classification === 'UNKNOWN' ? unknownValue('INSUFFICIENT_DATA') : knownValue(0.1),
      serviceSuppressionApplied: false,
      terminalEvidenceId: evidenceId,
      capturedAt,
    },
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: capturedAt,
      sourceSet: ['test-rpc'],
      modelVersion: 'entity-v0.1.0',
      confidence: 0.9,
      evidenceIds: [evidenceId],
    },
  };
}

function storedTimelineReport() {
  const firstEvidence = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:entity-v0.1.0',
    locator: 'entity-relationship:wallet-a:wallet-b:100',
    payload: { position: '100' },
    blockOrSlot: '100',
    finality: 'finalized',
    observedAt: capturedAt,
    summary: 'First relationship observation terminal Evidence.',
  });
  const latestEvidence = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:entity-v0.1.0',
    locator: 'entity-relationship:wallet-a:wallet-b:101',
    payload: { position: '101' },
    blockOrSlot: '101',
    finality: 'finalized',
    observedAt: capturedAt,
    summary: 'Latest relationship observation terminal Evidence.',
  });
  const timeline = buildEntityRelationshipTimeline({
    ledger: 'EVM',
    chainId: 'eip155:56',
    subjectA: 'wallet-a',
    subjectB: 'wallet-b',
    reports: [
      relationshipObservation('100', `erh_${'1'.repeat(24)}`, firstEvidence.id, 'UNKNOWN'),
      relationshipObservation(
        '101',
        `erh_${'2'.repeat(24)}`,
        latestEvidence.id,
        'PROBABLE_SAME_CONTROLLER',
      ),
    ],
  });
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:entity-timeline-v0.1.0',
    locator: `entity-relationship-timeline:${timeline.request.subjectA}:${timeline.request.subjectB}:${timeline.request.fromPosition}:${timeline.request.toPosition}`,
    payload: { timeline },
    blockOrSlot: timeline.request.toPosition,
    finality: 'finalized',
    observedAt: capturedAt,
    summary: 'Relationship timeline terminal Evidence.',
    sourceEvidenceIds: timeline.metadata.evidenceIds,
  });
  const report = EntityRelationshipTimelineReportSchema.parse({
    schemaVersion: 'entity-relationship-timeline-report-v1',
    automaticOwnershipMergeAllowed: false,
    timeline,
    terminalEvidenceId: terminal.id,
    evidence: [firstEvidence, latestEvidence, terminal].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  });
  return report;
}

function timelineRow(values: readonly unknown[]) {
  return {
    id: values[0],
    ledger: values[1],
    chain_id: values[2],
    subject_a: values[3],
    subject_b: values[4],
    from_position: values[5],
    to_position: values[6],
    result_hash: values[7],
    report: values[8],
    terminal_evidence_id: values[9],
    report_ids: values[10],
    evidence_ids: values[11],
    source_set: values[12],
    model_version: values[13],
    captured_at: values[14],
    created_at: values[14],
  };
}

describe('PostgreSQL entity relationship timeline writes', () => {
  it('writes, replays, and lists the latest timeline without inventing missing rows', async () => {
    const report = storedTimelineReport();
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO entity_relationship_timeline_reports')) {
        row ??= timelineRow(values);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM entity_relationship_timeline_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresEntityRelationshipTimelineRepository.fromPool({
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
    await repository.close();
  });

  it('keeps missing timelines undefined and maps unavailable storage honestly', async () => {
    const report = storedTimelineReport();
    const empty = PostgresEntityRelationshipTimelineRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(empty.get(`ert_${'a'.repeat(24)}`)).resolves.toBeUndefined();
    await expect(
      empty.latest({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
      }),
    ).resolves.toBeUndefined();

    const down = PostgresEntityRelationshipTimelineRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      end: vi.fn(),
    });
    await expect(down.put(report)).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
    });
    await expect(down.get(`ert_${'a'.repeat(24)}`)).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
    });
    await expect(
      down.latest({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
      }),
    ).rejects.toMatchObject({
      code: 'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
    });
    await expect(down.health()).resolves.toMatchObject({
      errorCode: 'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
    });
  });
});
