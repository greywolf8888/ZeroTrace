import { describe, expect, it } from 'vitest';

import { buildLabelIntelligenceCore } from './index.js';
import { LabelIntelligenceCoreSchema, unknownValue } from '@zerotrace/schemas';
import type {
  LabelIntelligenceRequest,
  LabelIntelligenceSubject,
  LabelObservation,
} from '@zerotrace/schemas';

const subject: LabelIntelligenceSubject = {
  id: '10000000-0000-4000-8000-000000000001',
  ledger: 'EVM',
  chainId: 'eip155:56',
  subjectType: 'ADDRESS',
  normalizedIdentifier: '0x1111111111111111111111111111111111111111',
};

const request: LabelIntelligenceRequest = {
  ledger: subject.ledger,
  chainId: subject.chainId,
  subjectType: subject.subjectType,
  normalizedIdentifier: subject.normalizedIdentifier,
  asOf: '2026-08-12T00:00:00.000Z',
  staleAfterSeconds: 86_400,
};

function observation(index: number, overrides: Partial<LabelObservation> = {}): LabelObservation {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    subjectId: subject.id,
    ledger: subject.ledger,
    chainId: subject.chainId,
    subjectType: subject.subjectType,
    normalizedIdentifier: subject.normalizedIdentifier,
    source: `source-${index}`,
    sourceClass: 'CURATED',
    label: 'Example Protocol',
    category: 'identity',
    actorCandidate: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    sourceConfidence: 0.8,
    evidenceIds: [`ev_${String(index).padStart(24, '0')}`],
    observedAt: '2026-08-11T12:00:00.000Z',
    validFrom: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    validTo: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    deterministic: false,
    licensePolicy: 'MIT-compatible observation metadata',
    rawPayloadHash: String(index).padStart(64, '0'),
    ...overrides,
  };
}

describe('Label Intelligence', () => {
  it('preserves conflicting labels while ranking deterministic evidence first', () => {
    const report = buildLabelIntelligenceCore({
      subject,
      request,
      observations: [
        observation(1),
        observation(2, {
          sourceClass: 'DETERMINISTIC',
          deterministic: true,
          label: 'Different Protocol',
          sourceConfidence: 0.99,
        }),
      ],
    });

    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.disposition).toBe('PRESERVED');
    expect(report.rankedObservationIds[0]).toBe('10000000-0000-4000-8000-000000000002');
    expect(report.metadata.conclusionConfidence).toMatchObject({
      state: 'unknown',
      reason: 'CONFLICTING_SOURCES',
    });
    expect(report.automaticEntityMergeAllowed).toBe(false);
  });

  it('keeps future, stale, expired and active states distinct', () => {
    const report = buildLabelIntelligenceCore({
      subject,
      request,
      observations: [
        observation(1),
        observation(2, { observedAt: '2026-08-10T00:00:00.000Z' }),
        observation(3, { validTo: { state: 'known', value: '2026-08-11T00:00:00.000Z' } }),
        observation(4, { observedAt: '2026-08-13T00:00:00.000Z' }),
      ],
    });

    expect(report.summary).toMatchObject({
      activeCount: 1,
      staleCount: 1,
      expiredCount: 1,
      futureCount: 1,
    });
  });

  it('applies conservative Service Hub suppression without making an Entity conclusion', () => {
    const report = buildLabelIntelligenceCore({
      subject,
      request,
      observations: [observation(1, { category: 'CEX' })],
    });

    expect(report.serviceHubSuppression).toMatchObject({
      applied: true,
      reason: { state: 'known', value: 'SERVICE_HUB_OBSERVATION' },
    });
    expect(report.serviceHubSuppression.evidenceIds).toEqual(['ev_000000000000000000000001']);
    expect(report.automaticEntityMergeAllowed).toBe(false);
  });

  it('rejects a suppression decision whose reason is not Evidence-consistent', () => {
    const report = buildLabelIntelligenceCore({
      subject,
      request,
      observations: [observation(1, { category: 'CEX' })],
    });

    expect(() =>
      LabelIntelligenceCoreSchema.parse({
        ...report,
        serviceHubSuppression: {
          ...report.serviceHubSuppression,
          reason: unknownValue('INSUFFICIENT_DATA', 'Tampered suppression reason.'),
        },
      }),
    ).toThrow();
  });

  it('marks inference and risk labels without allowing ownership inference', () => {
    const report = buildLabelIntelligenceCore({
      subject,
      request,
      observations: [
        observation(1, {
          category: 'SCAM',
          sourceClass: 'INFERENCE',
          deterministic: false,
        }),
      ],
    });

    expect(report.observations[0]).toMatchObject({ riskLabel: true, inferenceLabel: true });
    expect(report.riskLabelOwnershipInferenceAllowed).toBe(false);
    expect(report.crossChainSameLabelMergeAllowed).toBe(false);
  });

  it('rejects cross-subject observations instead of merging same labels', () => {
    expect(() =>
      buildLabelIntelligenceCore({
        subject,
        request,
        observations: [
          observation(1, {
            chainId: 'eip155:1',
          }),
        ],
      }),
    ).toThrow(/requested ledger-scoped Subject/);
  });
});
