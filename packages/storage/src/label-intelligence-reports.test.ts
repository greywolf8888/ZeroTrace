import { describe, expect, it, vi } from 'vitest';

import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  LabelIntelligenceReportSchema,
  knownValue,
  unknownValue,
  type LabelIntelligenceReport,
  type LabelIntelligenceSubject,
  type LabelObservation,
} from '@zerotrace/schemas';

import { PostgresLabelIntelligenceReportRepository } from './label-intelligence-reports.js';

describe('PostgreSQL Label Intelligence report repository', () => {
  it('rejects invalid reports and lookup identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresLabelIntelligenceReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as LabelIntelligenceReport)).rejects.toMatchObject({
      code: 'LABEL_INTELLIGENCE_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'LABEL_INTELLIGENCE_INVALID',
    });
    await expect(
      repository.latest({
        ledger: 'EVM',
        chainId: '',
        subjectType: 'ADDRESS',
        normalizedIdentifier: '0x1111111111111111111111111111111111111111',
      }),
    ).rejects.toMatchObject({ code: 'LABEL_INTELLIGENCE_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('loads every append-only observation for one canonical EVM Subject', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          subject_id: '10000000-0000-4000-8000-000000000001',
          ledger: 'EVM',
          chain_id: 'eip155:56',
          subject_type: 'ADDRESS',
          normalized_identifier: '0x1111111111111111111111111111111111111111',
          observation_id: '10000000-0000-4000-8000-000000000002',
          source: 'official-registry',
          source_class: 'DETERMINISTIC',
          label: 'Example Exchange',
          category: 'CEX',
          actor_candidate: 'Example Exchange',
          source_confidence: '0.99',
          evidence_id: 'ev_000000000000000000000001',
          observed_at: new Date('2026-08-11T00:00:00.000Z'),
          valid_from: null,
          valid_to: null,
          deterministic: true,
          license_policy: 'official registry attribution only',
          raw_payload_hash: '1'.repeat(64),
        },
      ],
      rowCount: 1,
    });
    const repository = PostgresLabelIntelligenceReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(
      repository.loadObservationSet({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'ADDRESS',
        normalizedIdentifier: '0x1111111111111111111111111111111111111111'.toUpperCase(),
      }),
    ).resolves.toMatchObject({
      subject: { id: '10000000-0000-4000-8000-000000000001' },
      observations: [
        {
          category: 'CEX',
          deterministic: true,
          actorCandidate: { state: 'known', value: 'Example Exchange' },
          validFrom: { state: 'unknown' },
          validTo: { state: 'unknown' },
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM subjects subject'), [
      'EVM',
      'eip155:56',
      'ADDRESS',
      '0x1111111111111111111111111111111111111111',
    ]);
  });

  it('distinguishes initialized Label storage from missing migration state', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            table_name: 'label_intelligence_reports',
            view_name: 'label_intelligence_search_documents_v1',
            migration_applied: true,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, view_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresLabelIntelligenceReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'LABEL_INTELLIGENCE_NOT_INITIALIZED',
    });
  });
});

const subject: LabelIntelligenceSubject = {
  id: '10000000-0000-4000-8000-000000000001',
  ledger: 'EVM',
  chainId: 'eip155:56',
  subjectType: 'ADDRESS',
  normalizedIdentifier: '0x1111111111111111111111111111111111111111',
};

function storedLabelReport() {
  const source = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'ANALYST_OBSERVATION',
    source: 'official-registry',
    locator: 'label:example-exchange',
    payload: { label: 'Example Exchange' },
    observedAt: '2026-08-11T12:00:00.000Z',
    blockOrSlot: '100',
    finality: 'finalized',
    summary: 'Registered label observation.',
  });
  const observation: LabelObservation = {
    id: '10000000-0000-4000-8000-000000000002',
    subjectId: subject.id,
    ledger: subject.ledger,
    chainId: subject.chainId,
    subjectType: subject.subjectType,
    normalizedIdentifier: subject.normalizedIdentifier,
    source: source.source,
    sourceClass: 'CURATED',
    label: 'Example Protocol',
    category: 'identity',
    actorCandidate: unknownValue('INSUFFICIENT_DATA'),
    sourceConfidence: 0.9,
    evidenceIds: [source.id],
    observedAt: '2026-08-11T12:00:00.000Z',
    validFrom: unknownValue('INSUFFICIENT_DATA'),
    validTo: unknownValue('INSUFFICIENT_DATA'),
    deterministic: false,
    licensePolicy: 'official registry attribution only',
    rawPayloadHash: '1'.repeat(64),
  };
  const request = {
    ledger: subject.ledger,
    chainId: subject.chainId,
    subjectType: subject.subjectType,
    normalizedIdentifier: subject.normalizedIdentifier,
    asOf: '2026-08-12T00:00:00.000Z',
    staleAfterSeconds: 86_400,
  };
  const observationSetHash = hashPayload({
    schema: 'zerotrace-label-observation-set-v1',
    subject,
    request,
    observations: [observation],
  });
  const snapshot = {
    id: `lss_${hashPayload({ schema: 'zerotrace-label-snapshot-v1', observationSetHash }).slice(0, 24)}`,
    asOf: request.asOf,
    observationIds: [observation.id],
    observationSetHash,
  };
  const result = {
    subject,
    request,
    snapshot,
    observations: [
      {
        observation,
        temporalStatus: 'ACTIVE' as const,
        sourcePriority: 4,
        serviceHubCandidate: false,
        riskLabel: false,
        inferenceLabel: false,
      },
    ],
    rankedObservationIds: [observation.id],
    conflicts: [],
    serviceHubSuppression: {
      applied: false,
      evidenceIds: [],
      reason: unknownValue(
        'NOT_QUERIED',
        'The requested observation set contains no current Service Hub observation; absence is not proof of non-service status.',
      ),
    },
    summary: {
      observationCount: 1,
      activeCount: 1,
      staleCount: 0,
      expiredCount: 0,
      futureCount: 0,
      deterministicCount: 0,
      inferenceCount: 0,
      conflictCount: 0,
      sourceClassCount: 1,
    },
    metadata: {
      modelVersion: 'label-intelligence-v0.1.0' as const,
      freshness: knownValue(observation.observedAt),
      conclusionConfidence: knownValue(0.9),
      requestedObservationSetCoverage: knownValue(1 as const),
      globalSourceCoverage: unknownValue(
        'NOT_QUERIED',
        'This report covers the complete requested durable observation set, not every external Label source.',
      ),
      historyCoverage: unknownValue(
        'NOT_QUERIED',
        'Append-only observations do not prove complete historical label coverage.',
      ),
      sourceSet: [observation.source],
      evidenceIds: [source.id],
    },
    automaticEntityMergeAllowed: false as const,
    riskLabelOwnershipInferenceAllowed: false as const,
    crossChainSameLabelMergeAllowed: false as const,
  };
  const terminal = createEvidence({
    ledger: result.subject.ledger,
    chainId: result.subject.chainId,
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:label-intelligence-v0.1.0',
    locator: [
      'label-intelligence',
      result.subject.ledger,
      result.subject.chainId,
      result.subject.id,
      result.snapshot.id,
    ].join(':'),
    payload: { request, result },
    observedAt: request.asOf,
    finality: 'label-observation-set',
    summary: 'Label Intelligence report terminal Evidence.',
    sourceEvidenceIds: result.metadata.evidenceIds,
  });
  return LabelIntelligenceReportSchema.parse({
    schemaVersion: 'label-intelligence-report-v1',
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
    subject_id: values[3],
    subject_type: values[4],
    normalized_identifier: values[5],
    label_snapshot_id: values[6],
    observation_set_hash: values[7],
    result_hash: values[8],
    report: values[9],
    terminal_evidence_id: values[10],
    evidence_ids: values[11],
    source_set: values[12],
    model_version: values[13],
    as_of: values[14],
    created_at: values[14],
  };
}

describe('PostgreSQL Label Intelligence report writes', () => {
  it('writes, replays, and lists the latest report without inventing missing rows', async () => {
    const report = storedLabelReport();
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO label_intelligence_reports')) {
        row ??= reportRow(values);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM label_intelligence_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresLabelIntelligenceReportRepository.fromPool({
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
        subjectType: 'ADDRESS',
        normalizedIdentifier: subject.normalizedIdentifier.toUpperCase(),
      }),
    ).resolves.toMatchObject({ id: first.id });
    await repository.close();
  });

  it('returns undefined for a registered subject with no observations and maps unavailable storage honestly', async () => {
    const report = storedLabelReport();
    const empty = PostgresLabelIntelligenceReportRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(empty.get(`lir_${'a'.repeat(24)}`)).resolves.toBeUndefined();
    await expect(
      empty.latest({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'ADDRESS',
        normalizedIdentifier: subject.normalizedIdentifier,
      }),
    ).resolves.toBeUndefined();
    await expect(
      empty.loadObservationSet({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'ADDRESS',
        normalizedIdentifier: subject.normalizedIdentifier,
      }),
    ).resolves.toBeUndefined();

    const down = PostgresLabelIntelligenceReportRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      end: vi.fn(),
    });
    await expect(down.put(report)).rejects.toMatchObject({
      code: 'LABEL_INTELLIGENCE_UNAVAILABLE',
    });
    await expect(down.get(`lir_${'a'.repeat(24)}`)).rejects.toMatchObject({
      code: 'LABEL_INTELLIGENCE_UNAVAILABLE',
    });
    await expect(
      down.latest({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'ADDRESS',
        normalizedIdentifier: subject.normalizedIdentifier,
      }),
    ).rejects.toMatchObject({
      code: 'LABEL_INTELLIGENCE_UNAVAILABLE',
    });
    await expect(
      down.loadObservationSet({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'ADDRESS',
        normalizedIdentifier: subject.normalizedIdentifier,
      }),
    ).rejects.toMatchObject({
      code: 'LABEL_INTELLIGENCE_UNAVAILABLE',
    });
    await expect(down.health()).resolves.toMatchObject({
      errorCode: 'LABEL_INTELLIGENCE_UNAVAILABLE',
    });
  });
});
