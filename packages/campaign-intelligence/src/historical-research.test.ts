import { describe, expect, it } from 'vitest';

import { knownValue } from '@zerotrace/schemas';

import {
  classifyMarketEnvironment,
  compareHistoricalFingerprints,
  type HistoricalFingerprint,
  type MarketEnvironmentObservation,
} from './historical-research.js';

const evidenceA = `ev_${'1'.repeat(24)}`;
const evidenceB = `ev_${'2'.repeat(24)}`;
const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-01T00:00:00.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-empty-v1',
};

function fingerprint(
  token: string,
  value: number,
  visibleAt = '2026-08-01T00:00:00.000Z',
): HistoricalFingerprint {
  return {
    ledger: 'EVM',
    chainId: 'eip155:56',
    token,
    mechanismVersion: 'pancake-v2@1',
    stage: 'DISTRIBUTION',
    asOf: '2026-08-01T00:00:00.000Z',
    snapshot,
    features: [
      {
        id: 'independent-demand',
        group: 'BEHAVIOR',
        value: knownValue(value),
        visibleAt,
        evidenceIds: [evidenceA],
      },
    ],
    sourceSet: ['operator-a'],
    evidenceIds: [evidenceA],
    dataCoverage: 1,
    historyCoverage: 1,
  };
}

describe('历史指纹与市场环境', () => {
  it('分开行为相似、共同控制和条件收益，并标记为未校准', () => {
    const report = compareHistoricalFingerprints({
      query: fingerprint(`0x${'1'.repeat(40)}`, 0.8),
      reference: fingerprint(`0x${'2'.repeat(40)}`, 0.7),
      decisionAsOf: '2026-08-02T00:00:00.000Z',
      policy: {
        version: 'fingerprint-policy-v1',
        minimumComparableWeight: 0.5,
        missingFeaturePenalty: 0.5,
        features: [{ id: 'independent-demand', weight: 1, minimum: 0, maximum: 1 }],
      },
    });

    expect(report.status).toBe('COMPARABLE');
    expect(report.behaviorSimilarity.state).toBe('known');
    if (report.behaviorSimilarity.state === 'known') {
      expect(report.behaviorSimilarity.value).toBeCloseTo(0.9);
    }
    expect(report.commonControl.state).toBe('unknown');
    expect(report.conditionalOutcome.state).toBe('unknown');
    expect(report.calibrationStatus).toBe('UNCALIBRATED');
  });

  it('排除决策时点之后才可见的标签或特征', () => {
    const report = compareHistoricalFingerprints({
      query: fingerprint(`0x${'1'.repeat(40)}`, 1, '2026-08-03T00:00:00.000Z'),
      reference: fingerprint(`0x${'2'.repeat(40)}`, 1),
      decisionAsOf: '2026-08-02T00:00:00.000Z',
      policy: {
        version: 'fingerprint-policy-v1',
        minimumComparableWeight: 0.5,
        missingFeaturePenalty: 0.5,
        features: [{ id: 'independent-demand', weight: 1, minimum: 0, maximum: 1 }],
      },
    });

    expect(report.status).toBe('UNKNOWN');
    expect(report.behaviorSimilarity.state).toBe('unknown');
    expect(report.differences).toEqual([
      { featureId: 'independent-demand', state: 'POST_DECISION_EXCLUDED' },
    ]);
  });

  it('只用同链同题材且当时可见的样本识别环境，零候选保持未知', () => {
    const observation = (
      overrides: Partial<MarketEnvironmentObservation> = {},
    ): MarketEnvironmentObservation => ({
      ledger: 'EVM',
      chainId: 'eip155:56',
      theme: 'MEME',
      observedAt: '2026-08-01T12:00:00.000Z',
      availableAt: '2026-08-01T12:00:00.000Z',
      activeCandidateCount: 10,
      executableEntryCount: 6,
      realizableExitCount: 5,
      dataCoverage: 1,
      source: 'operator-a',
      evidenceIds: [evidenceA],
      snapshot,
      ...overrides,
    });
    const policy = {
      version: 'market-environment-policy-v1',
      lookbackSeconds: 86_400,
      minimumObservations: 2,
      minimumSources: 2,
      selectiveEntryBreadth: 0.2,
      broadEntryBreadth: 0.5,
      broadRealizableShare: 0.5,
    };
    const broad = classifyMarketEnvironment({
      ledger: 'EVM',
      chainId: 'eip155:56',
      theme: 'MEME',
      asOf: '2026-08-02T00:00:00.000Z',
      observations: [
        observation(),
        observation({ source: 'operator-b', evidenceIds: [evidenceB] }),
        observation({ chainId: 'solana-mainnet', source: 'wrong-chain' }),
        observation({ availableAt: '2026-08-03T00:00:00.000Z', source: 'future' }),
      ],
      policy,
    });
    expect(broad.status).toBe('BROAD');
    expect(broad.sourceSet).toEqual(['operator-a', 'operator-b']);

    const unknown = classifyMarketEnvironment({
      ledger: 'EVM',
      chainId: 'eip155:56',
      theme: 'MEME',
      asOf: '2026-08-02T00:00:00.000Z',
      observations: [
        observation({ activeCandidateCount: 0, executableEntryCount: 0, realizableExitCount: 0 }),
      ],
      policy: { ...policy, minimumObservations: 1, minimumSources: 1 },
    });
    expect(unknown.status).toBe('UNKNOWN');
    expect(unknown.entryBreadth.state).toBe('unknown');
  });
});
