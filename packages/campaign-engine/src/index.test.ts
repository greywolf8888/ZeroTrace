import { describe, expect, it } from 'vitest';

import { hashPayload } from '@zerotrace/evidence';
import { buildClusterPosition } from '@zerotrace/cluster-position-engine';
import { detectBehaviorEvent } from '@zerotrace/behavior-engine';
import {
  ControlCampaignBundleSchema,
  ForensicEvidenceLineSchema,
  unknownValue,
} from '@zerotrace/schemas';
import {
  buildControlCampaign,
  buildControlClusterVersion,
  campaignBoundaryDecision,
  controlCampaignIdFor,
} from './index.js';
import { createTokenFlowEdge } from '@zerotrace/token-flow-engine';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'ab'.repeat(32)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-13T00:00:00.000Z',
  providerVersions: { rpc: 'test' },
  adapterVersions: { evm: 'test' },
  configHash: 'cd'.repeat(32),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-test-v1',
};

const unknownEnd = { state: 'unknown' as const, reason: 'NOT_QUERIED' as const };

describe('campaign engine', () => {
  it('builds a deterministic versioned campaign without automatic entity mutation', () => {
    const cluster = buildControlClusterVersion({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      validFromBlock: '1',
      memberWalletIds: ['0xa', '0xb'],
      coreWalletIds: ['0xa'],
      satelliteWalletIds: ['0xb'],
      fundingRootIds: ['0xfunder'],
      settlementRootIds: ['0xsettlement'],
      membershipEvidenceIds: ['ev_000000000000000000000001'],
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-provider'],
    });
    const campaignId = controlCampaignIdFor({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      originBlock: '1',
      startBlock: '1',
      endBlock: unknownEnd,
      clusterVersionId: cluster.id,
    });
    const edge = createTokenFlowEdge({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      blockNumber: '100',
      blockHash: snapshot.blockHash,
      transactionHash: '0xtx',
      transactionIndex: '0',
      logIndex: '0',
      from: '0xexternal',
      to: '0xa',
      amountRaw: '100',
      kind: 'DEX_BUY',
      execution: 'SUCCESS',
      finality: 'FINAL',
      evidenceId: 'ev_000000000000000000000002',
      observedAt: snapshot.capturedAt,
    });
    const position = buildClusterPosition({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      campaignId,
      clusterVersionId: cluster.id,
      memberWalletIds: cluster.memberWalletIds,
      initialTokenBalanceRaw: '0',
      initialWalletBalances: { '0xa': '0', '0xb': '0' },
      circulatingSupplyRaw: '1000',
      snapshot,
      edges: [edge],
      membershipEvidenceIds: cluster.membershipEvidenceIds,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-provider'],
    });
    const event = detectBehaviorEvent({
      campaignId,
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      clusterVersionId: cluster.id,
      snapshot,
      afterPosition: position,
      edges: [edge],
      actors: ['0xa'],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-provider'],
    });
    const campaign = buildControlCampaign({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      originBlock: '1',
      startBlock: '1',
      clusterVersion: cluster,
      snapshotStart: snapshot,
      snapshotEnd: snapshot,
      positions: [position],
      behaviorEvents: [event],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-provider'],
    });
    expect(campaign.id).toBe(campaignId);
    expect(campaign.currentStage).toBe('ACCUMULATION');
    expect(campaign.automaticOwnershipMergeAllowed).toBe(false);
    expect(campaign.automaticEntityMembershipMutationAllowed).toBe(false);
    expect(campaign.campaignConfidence.state).toBe('unknown');
    expect(campaign.resultHash).toMatch(/^[0-9a-f]{64}$/);

    const lineWithoutIdentity = {
      schemaVersion: 'forensic-evidence-line-v1' as const,
      campaignId,
      phases: [],
      terminalBoundary: 'UNKNOWN' as const,
      itemIds: [],
      evidenceIds: [],
      snapshotStart: snapshot,
      snapshotEnd: snapshot,
      dataCoverage: 1,
      freshness: snapshot.capturedAt,
      sourceSet: ['test-provider'],
      modelVersion: 'forensic-evidence-v1.0.0' as const,
      confidence: unknownValue('NOT_QUERIED'),
      sourceCoverage: 1,
      historyCoverage: 1,
    };
    const evidenceLine = ForensicEvidenceLineSchema.parse({
      ...lineWithoutIdentity,
      resultHash: hashPayload(lineWithoutIdentity),
    });
    const bundleWithoutIdentity = {
      schemaVersion: 'control-campaign-bundle-v1' as const,
      campaign,
      clusterVersion: cluster,
      memberships: [],
      positions: [position],
      behaviorEvents: [event],
      evidenceItems: [],
      evidenceLine,
    };
    const bundle = ControlCampaignBundleSchema.parse({
      ...bundleWithoutIdentity,
      resultHash: hashPayload(bundleWithoutIdentity),
    });
    expect(bundle.resultHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires evidence-backed root change for low-overlap campaign splitting', () => {
    const previous = buildControlClusterVersion({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      validFromBlock: '1',
      memberWalletIds: ['0xa', '0xb'],
      coreWalletIds: ['0xa'],
      satelliteWalletIds: ['0xb'],
      fundingRootIds: ['0xfunder-a'],
      settlementRootIds: ['0xsettlement-a'],
      membershipEvidenceIds: ['ev_000000000000000000000001'],
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-provider'],
    });
    const next = buildControlClusterVersion({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      version: '2',
      validFromBlock: '200',
      memberWalletIds: ['0xc', '0xd'],
      coreWalletIds: ['0xc'],
      satelliteWalletIds: ['0xd'],
      fundingRootIds: ['0xfunder-b'],
      settlementRootIds: ['0xsettlement-b'],
      membershipEvidenceIds: ['ev_000000000000000000000002'],
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-provider'],
    });
    const decision = campaignBoundaryDecision(
      {
        clusterVersion: previous,
        startBlock: '1',
        endBlock: '100',
        behaviorEvents: [],
        snapshotStart: snapshot,
        snapshotEnd: snapshot,
      },
      {
        clusterVersion: next,
        startBlock: '200',
        endBlock: '250',
        behaviorEvents: [],
        snapshotStart: snapshot,
        snapshotEnd: snapshot,
      },
    );
    expect(decision.boundary).toBe(true);
    expect(decision.rootChanged).toBe(true);
    expect(decision.reasons).toContain('LOW_CLUSTER_OVERLAP');
  });
});
