import { describe, expect, it } from 'vitest';

import {
  executeConstantProduct,
  isolatedRvSumIsIllegal,
  reproducibleDistribution,
  simulateMarketWideExit,
} from './index.js';
import type { AnalysisMetadata, ExitCohort, VenueSnapshot } from '@zerotrace/schemas';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '9',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-19T00:00:00.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unapplied',
};

const token = { ledger: 'EVM' as const, chainId: 'eip155:56', token: `0x${'c'.repeat(40)}` };
const quote = { ledger: 'EVM' as const, chainId: 'eip155:56', token: `0x${'d'.repeat(40)}` };
const metadata: AnalysisMetadata = {
  snapshot,
  dataCoverage: 1,
  sourceCoverage: 0.5,
  historyCoverage: 1,
  simulationCoverage: 1,
  freshness: '2026-08-19T00:00:00.000Z',
  sourceSet: ['fixture'],
  modelVersion: 'market-reality-v1.0.0',
  confidence: 0.5,
  evidenceIds: [`ev_${'1'.repeat(24)}`],
};

const venue: VenueSnapshot = {
  id: 'v2-pool',
  kind: 'CONSTANT_PRODUCT_V2',
  baseToken: token,
  quoteToken: quote,
  feeBps: '25',
  sellEnabled: true,
  reserves: { baseAtomic: '1000000', quoteAtomic: '1000000' },
  evidenceIds: [`ev_${'1'.repeat(24)}`],
};

const cohorts: ExitCohort[] = [
  { id: 'controller', role: 'CONTROLLER', executableAmountAtomic: '200000' },
  { id: 'retail', role: 'RETAIL', executableAmountAtomic: '200000' },
];

describe('market reality', () => {
  it('rejects summing isolated RV quotes', () => {
    expect(() => isolatedRvSumIsIllegal([1n, 2n])).toThrow(/must not be summed/);
  });

  it('shared-liquidity exit is strictly less than the sum of isolated quotes', () => {
    const isolated = cohorts.map(
      (cohort) =>
        executeConstantProduct({
          baseReserve: 1_000_000n,
          quoteReserve: 1_000_000n,
          amountIn: BigInt(cohort.executableAmountAtomic),
          feeBps: 25n,
        }).amountOut,
    );
    const isolatedSum = isolated.reduce((acc, value) => acc + value, 0n);
    const shared = simulateMarketWideExit({
      token,
      snapshot,
      venues: [venue],
      cohorts,
      strategy: 'CONTROLLER_FIRST',
      seed: 7,
      metadata,
    });
    expect(BigInt(shared.totalRealizedU) < isolatedSum).toBe(true);
    expect(shared.isolatedRvSumRejected).toBe(true);
  });

  it('LP-removal adversarial scenario reduces remaining executable quote', () => {
    const withLp = simulateMarketWideExit({
      token,
      snapshot,
      venues: [venue],
      cohorts: [
        {
          id: 'controller',
          role: 'CONTROLLER',
          executableAmountAtomic: '100000',
          lpTokenAmountAtomic: '200000',
        },
        { id: 'retail', role: 'RETAIL', executableAmountAtomic: '100000' },
      ],
      strategy: 'ADVERSARIAL_LP_REMOVAL',
      seed: 1,
      metadata,
      removeLpFirst: true,
    });
    const without = simulateMarketWideExit({
      token,
      snapshot,
      venues: [venue],
      cohorts: [
        { id: 'controller', role: 'CONTROLLER', executableAmountAtomic: '100000' },
        { id: 'retail', role: 'RETAIL', executableAmountAtomic: '100000' },
      ],
      strategy: 'PRO_RATA',
      seed: 1,
      metadata,
    });
    expect(BigInt(withLp.totalRealizedU) < BigInt(without.totalRealizedU)).toBe(true);
  });

  it('reproduces P10/P50/P90 for a fixed seed', () => {
    const runs = Array.from({ length: 16 }, (_, index) =>
      simulateMarketWideExit({
        token,
        snapshot,
        venues: [venue],
        cohorts,
        strategy: 'SEEDED_RANDOM',
        seed: 42 + index,
        metadata,
      }),
    );
    const first = reproducibleDistribution(runs, 42);
    const second = reproducibleDistribution(runs, 42);
    expect(first).toEqual(second);
    expect(BigInt(first.p10) <= BigInt(first.p50)).toBe(true);
    expect(BigInt(first.p50) <= BigInt(first.p90)).toBe(true);
  });
});
