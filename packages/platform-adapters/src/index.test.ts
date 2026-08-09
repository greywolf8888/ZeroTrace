import { describe, expect, it } from 'vitest';

import { PLATFORM_REGISTRY, inferGenericLaunchMechanism } from './index.js';

describe('platform registry', () => {
  it('models GMGN as execution/labels rather than a launchpad', () => {
    const gmgn = PLATFORM_REGISTRY.find((platform) => platform.id === 'gmgn');
    expect(gmgn?.roles).toEqual(['EXECUTION_PLATFORM', 'LABEL_PROVIDER']);
  });

  it('does not invent a platform name when only generic mechanism evidence exists', () => {
    const detection = inferGenericLaunchMechanism({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      factoryOrProgram: 'program',
      quoteReserve: '100',
      virtualReserve: '1000',
      buySellEvents: 10,
      migrationEvents: 1,
      liquidityEvents: 1,
      feeTransferEvents: 3,
      evidenceIds: ['ev_raw'],
    });
    expect(detection.platform).toBe('UNKNOWN_LAUNCHPAD');
    expect(detection.mechanism).toEqual({ state: 'known', value: 'BONDING_CURVE_LIKE' });
  });

  it('requires evidence before scoring generic launch behavior', () => {
    const detection = inferGenericLaunchMechanism({
      ledger: 'EVM',
      chainId: 'eip155:56',
      buySellEvents: 10,
      migrationEvents: 1,
      liquidityEvents: 1,
      feeTransferEvents: 1,
      evidenceIds: [],
    });
    expect(detection.mechanismConfidence).toBe(0);
    expect(detection.mechanism).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
  });

  it('reports a low-confidence generic mechanism without inventing certainty', () => {
    const detection = inferGenericLaunchMechanism({
      ledger: 'EVM',
      chainId: 'eip155:1',
      factoryOrProgram: 'factory',
      buySellEvents: 1,
      migrationEvents: 1,
      liquidityEvents: 0,
      feeTransferEvents: 0,
      evidenceIds: ['ev_one', 'ev_one'],
    });
    expect(detection.mechanismConfidence).toBe(0.2);
    expect(detection.evidenceIds).toEqual(['ev_one']);
    expect(detection.mechanism).toMatchObject({ state: 'unknown' });
  });
});
