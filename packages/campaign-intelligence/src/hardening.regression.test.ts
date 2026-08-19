import { describe, expect, it } from 'vitest';

import { buildCampaignIntelligence, detectChangePoints } from './index.js';
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
    end: pos(String(BigInt(block) + 1n)),
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

describe('campaign intelligence hardening', () => {
  it('keeps change-point scores finite when net token exceeds MAX_SAFE_INTEGER', () => {
    const huge = (2n ** 53n + 99n).toString();
    const points = detectChangePoints([
      { position: pos('1'), value: huge },
      { position: pos('2'), value: huge },
      { position: pos('3'), value: '1' },
      { position: pos('4'), value: '1' },
      { position: pos('5'), value: huge },
      { position: pos('6'), value: huge },
    ]);
    expect(points.every((point) => Number.isFinite(Number(point.value)))).toBe(true);
  });

  it('partitions windows exactly once and keeps the pre-change preparation episode', () => {
    const windows = [
      ...Array.from({ length: 8 }, (_, i) => windowAt(String(i), '1')),
      ...Array.from({ length: 8 }, (_, i) => windowAt(String(i + 8), '80')),
      ...Array.from({ length: 8 }, (_, i) => windowAt(String(i + 16), '2')),
    ];
    const payload = buildCampaignIntelligence({
      token: { ledger: 'EVM', chainId: 'eip155:56', token: `0x${'c'.repeat(40)}` },
      snapshot,
      registryEvidenceId: `ev_${'2'.repeat(24)}`,
      terminalEvidenceId: `ev_${'3'.repeat(24)}`,
      originComplete: true,
      controllerEntityIds: ['controller'],
      windows,
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
    const assigned = payload.campaigns.flatMap((campaign) =>
      campaign.episodes.map((episode) => episode.featureWindow.start.blockOrSlot),
    );
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(payload.campaigns[0]?.boundary.start.blockOrSlot).toBe('0');
    expect(
      payload.campaigns.every((campaign) =>
        campaign.episodes.every((episode) => episode.finding.assertionClass === 'MODEL_HYPOTHESIS'),
      ),
    ).toBe(true);
    expect(payload.tactics).toHaveLength(1);
    expect(payload.campaigns.some((campaign) => campaign.tacticFindingIds.length > 0)).toBe(true);
  });
});
