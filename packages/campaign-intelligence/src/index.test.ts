import { describe, expect, it } from 'vitest';

import { buildCampaignIntelligence, detectChangePoints, evaluateTactic } from './index.js';
import type { CampaignFeatureWindow, ChainPosition } from '@zerotrace/schemas';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '500',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-19T00:00:00.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unapplied',
};

function pos(block: string): ChainPosition {
  return { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: block };
}

function windowAt(
  block: string,
  net: string,
  extras: Partial<CampaignFeatureWindow> = {},
): CampaignFeatureWindow {
  return {
    start: pos(block),
    end: pos(String(Number(block) + 9)),
    controllerNetToken: net,
    controllerNetQuoteU: { state: 'unknown', reason: 'NOT_QUERIED' },
    controlledSupplyAtomic: '100',
    hiddenAffiliateSupplyAtomic: '0',
    independentSupplyAtomic: '20',
    unknownSupplyAtomic: '0',
    newEntities: 1,
    exitedEntities: 0,
    fanOut: 1,
    fanIn: 1,
    dexBuyAtomic: '0',
    dexSellAtomic: '0',
    organicVolumeAtomic: { state: 'unknown', reason: 'NOT_QUERIED' },
    cyclicVolumeAtomic: { state: 'unknown', reason: 'NOT_QUERIED' },
    lpAddCount: 0,
    lpRemoveCount: 0,
    mintAtomic: '0',
    burnAtomic: '0',
    evidenceIds: [`ev_${'1'.repeat(24)}`],
    ...extras,
  };
}

describe('campaign intelligence', () => {
  it('detects multiple change points instead of assuming a single campaign', () => {
    const series = [
      ...Array.from({ length: 8 }, (_, i) => ({ position: pos(String(i)), value: 1 })),
      ...Array.from({ length: 8 }, (_, i) => ({ position: pos(String(i + 8)), value: 80 })),
      ...Array.from({ length: 8 }, (_, i) => ({ position: pos(String(i + 16)), value: 2 })),
    ];
    expect(detectChangePoints(series).length).toBeGreaterThanOrEqual(1);
  });

  it('rejects single-factor tactics and emits bounded observation without origin', () => {
    expect(
      evaluateTactic({
        tacticType: 'EARLY_BATCH_ACCUMULATION',
        stages: ['INVENTORY_BUILD'],
        subjects: ['0x1'],
        evidenceFor: [`ev_${'1'.repeat(24)}`],
        evidenceAgainst: [],
        families: 1,
        alternativesExcluded: false,
        singleFactorOnly: true,
      }),
    ).toBe(false);
    const payload = buildCampaignIntelligence({
      token: { ledger: 'EVM', chainId: 'eip155:56', token: `0x${'c'.repeat(40)}` },
      snapshot,
      registryEvidenceId: `ev_${'2'.repeat(24)}`,
      terminalEvidenceId: `ev_${'3'.repeat(24)}`,
      originComplete: false,
      controllerEntityIds: ['controller'],
      windows: [windowAt('100', '10'), windowAt('200', '-4', { lpRemoveCount: 1 })],
      tactics: [
        {
          tacticType: 'REMOVE_LP_THEN_SELL',
          stages: ['LIQUIDITY_EXIT'],
          subjects: ['controller'],
          evidenceFor: [`ev_${'1'.repeat(24)}`, `ev_${'4'.repeat(24)}`],
          evidenceAgainst: [`ev_${'5'.repeat(24)}`],
          families: 2,
          alternativesExcluded: true,
          singleFactorOnly: false,
        },
      ],
    });
    expect(payload.campaigns.length).toBeGreaterThanOrEqual(1);
    expect(payload.campaigns.every((item) => item.status === 'BOUNDED_OBSERVATION')).toBe(true);
    expect(payload.tactics).toHaveLength(1);
    expect(payload.tactics[0]?.finding.assertionClass).toBe('MODEL_HYPOTHESIS');
  });
});
