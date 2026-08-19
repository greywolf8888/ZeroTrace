import { describe, expect, it } from 'vitest';

import { simulateMarketWideExit } from './index.js';
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

const evidenceIds = [`ev_${'1'.repeat(24)}`];

function v2(id: string, reserves: { baseAtomic: string; quoteAtomic: string }): VenueSnapshot {
  return {
    id,
    kind: 'CONSTANT_PRODUCT_V2',
    baseToken: token,
    quoteToken: quote,
    feeBps: '25',
    sellEnabled: true,
    quoteSettlesInU: true,
    reserves,
    evidenceIds,
  };
}

describe('market reality hardening', () => {
  it('routes inventory across every venue instead of venues[0] only', () => {
    const thin = v2('thin', { baseAtomic: '100', quoteAtomic: '100' });
    const deep = v2('deep', { baseAtomic: '1000000', quoteAtomic: '1000000' });
    const cohorts: ExitCohort[] = [
      { id: 'seller', role: 'CONTROLLER', executableAmountAtomic: '200000' },
    ];
    const onlyFirst = simulateMarketWideExit({
      token,
      snapshot,
      venues: [thin],
      cohorts,
      strategy: 'CONTROLLER_FIRST',
      seed: 1,
      metadata,
    });
    const both = simulateMarketWideExit({
      token,
      snapshot,
      venues: [thin, deep],
      cohorts,
      strategy: 'CONTROLLER_FIRST',
      seed: 1,
      metadata,
    });
    expect(BigInt(both.totalRealizedU) > BigInt(onlyFirst.totalRealizedU)).toBe(true);
  });

  it('PRO_RATA sells the same fraction of each remaining cohort against shared liquidity', () => {
    const shared = v2('pool', { baseAtomic: '1000000', quoteAtomic: '1000000' });
    const result = simulateMarketWideExit({
      token,
      snapshot,
      venues: [shared],
      cohorts: [
        { id: 'controller', role: 'CONTROLLER', executableAmountAtomic: '300000' },
        { id: 'retail', role: 'RETAIL', executableAmountAtomic: '100000' },
      ],
      strategy: 'PRO_RATA',
      seed: 1,
      metadata,
    });
    const controller = result.cohortResults.find((item) => item.cohortId === 'controller');
    const retail = result.cohortResults.find((item) => item.cohortId === 'retail');
    expect(controller?.soldAtomic).toBe('300000');
    expect(retail?.soldAtomic).toBe('100000');
    expect(BigInt(controller?.realizedU ?? '0') * 100n).toBeGreaterThan(
      BigInt(retail?.realizedU ?? '0') * 250n,
    );
    expect(BigInt(controller?.realizedU ?? '0') * 100n).toBeLessThan(
      BigInt(retail?.realizedU ?? '0') * 350n,
    );
  });

  it('fails closed for V3 Exact without tick/range/liquidityNet', () => {
    const result = simulateMarketWideExit({
      token,
      snapshot,
      venues: [
        {
          id: 'v3',
          kind: 'CONCENTRATED_V3',
          baseToken: token,
          quoteToken: quote,
          feeBps: '5',
          sellEnabled: true,
          quoteSettlesInU: true,
          reserves: { baseAtomic: '1000000', quoteAtomic: '1000000' },
          evidenceIds,
        },
      ],
      cohorts: [{ id: 'seller', role: 'CONTROLLER', executableAmountAtomic: '1000' }],
      strategy: 'CONTROLLER_FIRST',
      seed: 1,
      metadata,
    });
    expect(result.totalRealizedU).toBe('0');
    expect(result.failedAmountAtomic).toBe('1000');
    expect(result.cohortResults[0]?.failed[0]?.reason).toBe('UNKNOWN_CONSTRAINT');
  });
});
