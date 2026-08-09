import { describe, expect, it } from 'vitest';

import type { AnalysisMetadata } from '@zerotrace/schemas';

import { resolveEntityRelationship } from './index.js';

const metadata: AnalysisMetadata = {
  snapshot: null,
  dataCoverage: 0.8,
  sourceCoverage: 0.7,
  historyCoverage: 0.6,
  simulationCoverage: 0,
  freshness: null,
  sourceSet: ['fixture'],
  modelVersion: 'entity-v0.1.0',
  confidence: 0.8,
  evidenceIds: [],
};

describe('entity resolution', () => {
  it('returns explicit unknown probabilities when no evidence exists', () => {
    const result = resolveEntityRelationship({
      subjectA: 'a',
      subjectB: 'b',
      features: [],
      metadata,
    });
    expect(result.classification).toBe('UNKNOWN');
    expect(result.sameControllerProbability).toEqual({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
  });

  it('allows a deterministic on-chain authority to confirm common control', () => {
    const result = resolveEntityRelationship({
      subjectA: 'safe',
      subjectB: 'module',
      metadata,
      features: [
        {
          kind: 'SHARED_ONCHAIN_AUTHORITY',
          strength: 1,
          reliability: 1,
          evidenceId: 'ev_authority',
        },
      ],
    });
    expect(result.classification).toBe('CONFIRMED_SAME_CONTROLLER');
  });

  it('suppresses ownership propagation through a service hub', () => {
    const result = resolveEntityRelationship({
      subjectA: 'user-a',
      subjectB: 'user-b',
      metadata,
      subjectAIsService: true,
      features: [
        { kind: 'COMMON_FUNDER', strength: 1, reliability: 0.9, evidenceId: 'ev_cex' },
        { kind: 'TIMING_SYNCHRONY', strength: 1, reliability: 0.9, evidenceId: 'ev_time' },
      ],
    });
    expect(result.classification).toBe('SERVICE_INFRASTRUCTURE');
    expect(result.sameControllerProbability).toEqual({ state: 'known', value: 0.01 });
  });

  it('never merges a CoinJoin pair in the golden suppression case', () => {
    const result = resolveEntityRelationship({
      subjectA: 'btc-a',
      subjectB: 'btc-b',
      metadata,
      features: [
        { kind: 'COMMON_FUNDER', strength: 1, reliability: 1, evidenceId: 'ev_common_input' },
        { kind: 'COINJOIN', strength: 1, reliability: 1, evidenceId: 'ev_coinjoin' },
      ],
    });
    expect(result.classification).not.toMatch(/SAME_CONTROLLER/);
    expect(result.sameControllerProbability.state).toBe('known');
    if (result.sameControllerProbability.state === 'known') {
      expect(result.sameControllerProbability.value).toBeLessThanOrEqual(0.001);
    }
  });
});
