import { describe, expect, it } from 'vitest';

import type { AnalysisMetadata } from '@zerotrace/schemas';

import { quoteConstantProductExit, simulateExitRace } from './index.js';

const metadata: AnalysisMetadata = {
  snapshot: null,
  dataCoverage: 1,
  sourceCoverage: 1,
  historyCoverage: 0,
  simulationCoverage: 1,
  freshness: null,
  sourceSet: ['fixture'],
  modelVersion: 'rv-v0.1.0',
  confidence: 1,
  evidenceIds: ['ev_pool_state'],
};

const pool = {
  id: 'pool-1',
  baseReserve: '1000',
  quoteReserve: '1000',
  feeBps: '0',
  sellEnabled: true,
  evidenceIds: ['ev_pool_state'],
};

describe('constant-product realizable value', () => {
  it('calculates actual reserve output rather than balance times spot price', () => {
    const result = quoteConstantProductExit({ pool, inputQuantity: '100', metadata });
    expect(result.nominalValue).toEqual({ state: 'known', value: '100' });
    expect(result.realizableValue).toEqual({ state: 'known', value: '91' });
    expect(result.priceImpactBps).toEqual({ state: 'known', value: '900' });
  });

  it('returns execution blocked rather than zero when selling is disabled', () => {
    const result = quoteConstantProductExit({
      pool: { ...pool, sellEnabled: false },
      inputQuantity: '100',
      metadata,
    });
    expect(result.realizableValue).toEqual({
      state: 'unavailable',
      reason: 'EXECUTION_BLOCKED',
      detail: 'Pool state disables selling.',
    });
  });

  it('enforces max-sell constraints and caps output to real reserves', () => {
    const blocked = quoteConstantProductExit({
      pool: { ...pool, maxSellQuantity: '99' },
      inputQuantity: '100',
      metadata,
    });
    expect(blocked.realizableValue).toMatchObject({
      state: 'unavailable',
      reason: 'EXECUTION_BLOCKED',
    });

    const capped = quoteConstantProductExit({
      pool: {
        ...pool,
        baseReserve: '1',
        quoteReserve: '1',
        virtualQuoteReserve: '1000',
      },
      inputQuantity: '1000',
      metadata,
    });
    expect(capped.realizableValue).toEqual({ state: 'known', value: '1' });
  });

  it('handles zero input in the pure kernel and validates malformed pool math', () => {
    expect(
      quoteConstantProductExit({ pool, inputQuantity: '0', metadata }).realizableValue,
    ).toEqual({ state: 'known', value: '0' });
    expect(() =>
      quoteConstantProductExit({
        pool: { ...pool, feeBps: '10001' },
        inputQuantity: '1',
        metadata,
      }),
    ).toThrow('feeBps');
    expect(() =>
      quoteConstantProductExit({
        pool: { ...pool, baseReserve: '0', quoteReserve: '0' },
        inputQuantity: '1',
        metadata,
      }),
    ).toThrow('positive');
    expect(() => quoteConstantProductExit({ pool, inputQuantity: '-1', metadata })).toThrow(
      'non-negative integer',
    );
  });
});

describe('shared-liquidity exit race', () => {
  it('is deterministic for a fixed snapshot, order, and seed', () => {
    const input = {
      pool,
      participants: [
        { id: 'controller', inputQuantity: '200' },
        { id: 'treasury', inputQuantity: '200' },
        { id: 'foundation', inputQuantity: '200' },
      ],
      order: 'RANDOM' as const,
      seed: 42,
      iterations: 50,
      metadata,
    };
    expect(simulateExitRace(input)).toEqual(simulateExitRace(input));
  });

  it('does not sum independent RV quotes against the original reserve', () => {
    const result = simulateExitRace({
      pool,
      participants: [
        { id: 'first', inputQuantity: '500' },
        { id: 'second', inputQuantity: '500' },
      ],
      order: 'SEQUENTIAL',
      seed: 1,
      metadata,
    });
    const first = result.participantResults.find((item) => item.id === 'first');
    const second = result.participantResults.find((item) => item.id === 'second');
    expect(BigInt(first?.p50 ?? '0')).toBeGreaterThan(BigInt(second?.p50 ?? '0'));
  });

  it('validates exit-race participants, availability, and iteration bounds', () => {
    expect(() =>
      simulateExitRace({
        pool: { ...pool, sellEnabled: false },
        participants: [{ id: 'one', inputQuantity: '1' }],
        order: 'SEQUENTIAL',
        seed: 1,
        metadata,
      }),
    ).toThrow('selling is disabled');
    expect(() =>
      simulateExitRace({
        pool,
        participants: [],
        order: 'SEQUENTIAL',
        seed: 1,
        metadata,
      }),
    ).toThrow('at least one');
    expect(() =>
      simulateExitRace({
        pool,
        participants: [
          { id: 'same', inputQuantity: '1' },
          { id: 'same', inputQuantity: '2' },
        ],
        order: 'SEQUENTIAL',
        seed: 1,
        metadata,
      }),
    ).toThrow('unique');
    expect(() =>
      simulateExitRace({
        pool,
        participants: [{ id: 'one', inputQuantity: '1' }],
        order: 'RANDOM',
        seed: 1,
        iterations: 10_001,
        metadata,
      }),
    ).toThrow('between 1 and 10000');
  });

  it('uses the documented default random iteration count', () => {
    const result = simulateExitRace({
      pool,
      participants: [
        { id: 'one', inputQuantity: '1' },
        { id: 'two', inputQuantity: '2' },
      ],
      order: 'RANDOM',
      seed: 7,
      metadata,
    });
    expect(result.iterations).toBe(100);
  });
});
