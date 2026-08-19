import { describe, expect, it } from 'vitest';

import { materializeSupplyReality } from '@zerotrace/supply-reality-engine';
import { assessRoles } from '@zerotrace/identity-intelligence';
import { buildCampaignIntelligence } from '@zerotrace/campaign-intelligence';
import {
  createLot,
  recordCexBoundary,
  recordInternalTransfer,
  realizeProfit,
} from '@zerotrace/capital-intelligence';
import { isolatedRvSumIsIllegal, simulateMarketWideExit } from '@zerotrace/market-reality-engine';
import type { CampaignFeatureWindow, RoleFeatureVector } from '@zerotrace/schemas';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '42',
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

describe('market-structure golden case', () => {
  it('reconcilies supply, roles, campaign, capital and shared-liquidity exit together', () => {
    const supply = materializeSupplyReality({
      token,
      protocolSupplyAtomic: '1000',
      historicalMintAtomic: '1000',
      historicalBurnAtomic: '0',
      burnAlreadyReflectedInSupply: false,
      originCoverageComplete: true,
      cells: [
        {
          id: 'cel_aaaaaaaaaaaaaaaaaaaaaaaa',
          token,
          snapshot,
          amountAtomic: '700',
          owner: 'controller',
          custodyType: 'WALLET',
          economicController: 'CONFIRMED_CONTROLLER',
          liquidityStatus: 'SELLABLE_NOW',
          roleAssessmentIds: [],
          lotIds: [],
          evidenceIds: [`ev_${'1'.repeat(24)}`],
        },
        {
          id: 'cel_bbbbbbbbbbbbbbbbbbbbbbbb',
          token,
          snapshot,
          amountAtomic: '300',
          owner: 'pool',
          custodyType: 'POOL_RESERVE',
          economicController: 'SERVICE',
          liquidityStatus: 'LP_WITHDRAWAL_REQUIRED',
          roleAssessmentIds: [],
          lotIds: [],
          evidenceIds: [`ev_${'1'.repeat(24)}`],
        },
      ],
    });
    expect(supply.conservation.identityHolds).toBe(true);

    const features = (overrides: Partial<RoleFeatureVector> = {}): RoleFeatureVector => ({
      insiderAccessScore: 0,
      commonControlScore: 0,
      coordinationScore: 0,
      benefitReturnScore: 0,
      independenceScore: 0,
      serviceHubScore: 0,
      marketMakerScore: 0,
      botScore: 0,
      forbiddenSingleFactors: [],
      positiveIndependenceEvidence: false,
      ...overrides,
    });
    const roles = assessRoles({
      snapshot,
      registryEvidenceId: `ev_${'2'.repeat(24)}`,
      terminalEvidenceId: `ev_${'3'.repeat(24)}`,
      protocolSupplyAtomic: '1000',
      executableSellableAtomic: '700',
      nonServiceNonPoolAtomic: '700',
      marketWideExitU: '1',
      candidates: [
        {
          subject: {
            ledger: 'EVM',
            chainId: 'eip155:56',
            subjectType: 'ADDRESS',
            identifier: '0xcontroller',
          },
          proposedRole: 'CONFIRMED_ONCHAIN_CONTROLLER',
          features: features({ insiderAccessScore: 90, commonControlScore: 90 }),
          amountAtomic: '700',
          executableAtomic: '700',
          evidenceFor: [`ev_${'1'.repeat(24)}`],
          evidenceAgainst: [],
          coverageShrink: 1,
          historyCoverage: 1,
          serviceHub: false,
          disclosedTeam: true,
          publicAirdrop: false,
          publicVesting: false,
          onchainPrivilegeEvidence: true,
        },
      ],
    });
    expect(roles.assessments[0]?.role).toBe('CONFIRMED_ONCHAIN_CONTROLLER');

    const window = (block: string, net: string): CampaignFeatureWindow => ({
      start: { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: block },
      end: { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: String(Number(block) + 9) },
      controllerNetToken: net,
      controllerNetQuoteU: { state: 'unknown', reason: 'NOT_QUERIED' },
      controlledSupplyAtomic: '700',
      hiddenAffiliateSupplyAtomic: '0',
      independentSupplyAtomic: '0',
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
    });
    const campaigns = buildCampaignIntelligence({
      token,
      snapshot,
      registryEvidenceId: `ev_${'2'.repeat(24)}`,
      terminalEvidenceId: `ev_${'3'.repeat(24)}`,
      originComplete: true,
      controllerEntityIds: ['controller'],
      windows: [window('10', '10'), window('40', '-4')],
      tactics: [],
    });
    expect(campaigns.campaigns.length).toBeGreaterThan(0);

    const lot = createLot({
      asset: token,
      economicOwnerEntityId: 'controller',
      originType: 'MINT',
      originPosition: { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: '10' },
      amountAtomic: '700',
      acquisitionCostU: { state: 'known', value: '0' },
      evidenceIds: [`ev_${'1'.repeat(24)}`],
      campaignId: `mcc_${'a'.repeat(24)}`,
    });
    const internal = recordInternalTransfer({
      campaignId: `mcc_${'a'.repeat(24)}`,
      asset: token,
      amountAtomic: '10',
      evidenceIds: [`ev_${'1'.repeat(24)}`],
    });
    const cex = recordCexBoundary({
      campaignId: `mcc_${'a'.repeat(24)}`,
      amountU: '5',
      evidenceIds: [`ev_${'1'.repeat(24)}`],
    });
    const profit = realizeProfit({ campaignId: `mcc_${'a'.repeat(24)}`, entries: [internal, cex] });
    expect(lot.remainingAmountAtomic).toBe('700');
    expect(profit.realizedNetProfitU).toEqual({ state: 'known', value: '0' });
    expect(() => isolatedRvSumIsIllegal([1n, 2n])).toThrow();

    const exit = simulateMarketWideExit({
      token,
      snapshot,
      venues: [
        {
          id: 'v2',
          kind: 'CONSTANT_PRODUCT_V2',
          baseToken: token,
          quoteToken: { ledger: 'EVM', chainId: 'eip155:56', token: `0x${'d'.repeat(40)}` },
          feeBps: '25',
          sellEnabled: true,
          quoteSettlesInU: true,
          reserves: { baseAtomic: '1000000', quoteAtomic: '1000000' },
          evidenceIds: [`ev_${'1'.repeat(24)}`],
        },
      ],
      cohorts: [{ id: 'controller', role: 'CONTROLLER', executableAmountAtomic: '700' }],
      strategy: 'CONTROLLER_FIRST',
      seed: 7,
      metadata: {
        snapshot,
        dataCoverage: 1,
        sourceCoverage: 0.5,
        historyCoverage: 1,
        simulationCoverage: 1,
        freshness: '2026-08-19T00:00:00.000Z',
        sourceSet: ['golden'],
        modelVersion: 'market-reality-v1.0.0',
        confidence: 0.5,
        evidenceIds: [`ev_${'1'.repeat(24)}`],
      },
    });
    expect(exit.isolatedRvSumRejected).toBe(true);
    expect(BigInt(exit.totalRealizedU) > 0n).toBe(true);
  });
});
