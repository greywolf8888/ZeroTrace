import { describe, expect, it } from 'vitest';

import type { EntityRelationshipInput } from '@zerotrace/schemas';

import { resolveEntityRelationship } from './index.js';

const metadata: EntityRelationshipInput['metadata'] = {
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
        { kind: 'SERVICE_HUB', strength: 1, reliability: 1, evidenceId: 'ev_service' },
        { kind: 'COMMON_FUNDER', strength: 1, reliability: 0.9, evidenceId: 'ev_cex' },
        { kind: 'TIMING_SYNCHRONY', strength: 1, reliability: 0.9, evidenceId: 'ev_time' },
      ],
    });
    expect(result.classification).toBe('SERVICE_INFRASTRUCTURE');
    expect(result.sameControllerProbability.state).toBe('known');
    if (result.sameControllerProbability.state === 'known') {
      expect(result.sameControllerProbability.value).toBeLessThanOrEqual(0.01);
    }
  });

  it('does not let an ungrounded service flag suppress ownership', () => {
    const result = resolveEntityRelationship({
      subjectA: 'user-a',
      subjectB: 'user-b',
      metadata,
      subjectAIsService: true,
      features: [{ kind: 'COMMON_FUNDER', strength: 1, reliability: 1, evidenceId: 'ev_funder' }],
    });
    expect(result.serviceSuppressionApplied).toBe(false);
    expect(result.classification).not.toBe('SERVICE_INFRASTRUCTURE');
  });

  it('canonicalizes pair and feature order without double-scoring duplicate Evidence', () => {
    const result = resolveEntityRelationship({
      subjectA: 'z-wallet',
      subjectB: 'a-wallet',
      metadata,
      features: [
        { kind: 'TIMING_SYNCHRONY', strength: 1, reliability: 1, evidenceId: 'ev_timing' },
        { kind: 'COMMON_FUNDER', strength: 1, reliability: 1, evidenceId: 'ev_funder' },
        { kind: 'COMMON_FUNDER', strength: 1, reliability: 1, evidenceId: 'ev_funder' },
      ],
    });
    expect(result).toMatchObject({
      subjectA: 'a-wallet',
      subjectB: 'z-wallet',
      positiveEvidenceIds: ['ev_funder', 'ev_timing'],
    });
  });

  it('classifies grounded common bot infrastructure without merging controllers', () => {
    const result = resolveEntityRelationship({
      subjectA: 'bot-a',
      subjectB: 'bot-b',
      metadata,
      features: [
        {
          kind: 'BOT_COMMON_INFRASTRUCTURE',
          strength: 1,
          reliability: 1,
          evidenceId: 'ev_bot',
        },
      ],
    });
    expect(result.classification).toBe('BOT_MM_ARBITRAGE');
    expect(result.sameControllerProbability).toMatchObject({ state: 'known' });
  });

  it('reports suppression only when it changes a non-deterministic conclusion', () => {
    const result = resolveEntityRelationship({
      subjectA: 'controller-a',
      subjectB: 'controller-b',
      metadata,
      features: [
        { kind: 'SERVICE_HUB', strength: 1, reliability: 1, evidenceId: 'ev_service' },
        {
          kind: 'SHARED_ONCHAIN_AUTHORITY',
          strength: 1,
          reliability: 1,
          evidenceId: 'ev_authority',
        },
      ],
    });
    expect(result.classification).toBe('CONFIRMED_SAME_CONTROLLER');
    expect(result.serviceSuppressionApplied).toBe(false);
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
