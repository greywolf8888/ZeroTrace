import { describe, expect, it } from 'vitest';

import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  ControlCampaignBundleSchema,
  ControlCampaignSchema,
  ControlClusterVersionSchema,
  unknownValue,
} from '@zerotrace/schemas';
import {
  buildForensicCaseBundle,
  buildForensicEvidenceLine,
  createCampaignEvidenceItem,
  verifyForensicCaseBundle,
} from './index.js';

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

function fixtureBundle() {
  const evidence = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'LOG',
    source: 'test-rpc',
    locator: `0x${'11'.repeat(32)}`,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    payload: { token: '0xtoken', amount: '100' },
    rawArtifactRef: `s3://forensic/raw.json#sha256=${'ef'.repeat(32)}`,
    summary: 'Observed token transfer log.',
    observedAt: snapshot.capturedAt,
  });
  const clusterWithoutIdentity = {
    schemaVersion: 'control-cluster-version-v1' as const,
    ledger: 'EVM' as const,
    chainId: snapshot.chainId,
    token: '0xtoken',
    version: '1',
    validFromBlock: '1',
    validToBlock: unknownValue('NOT_APPLICABLE'),
    memberWalletIds: ['0xa'],
    coreWalletIds: ['0xa'],
    satelliteWalletIds: [],
    fundingRootIds: [],
    settlementRootIds: [],
    membershipEvidenceIds: [evidence.id],
    modelVersion: 'control-cluster-v1.0.0' as const,
    snapshot,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    freshness: snapshot.capturedAt,
    sourceSet: ['test-rpc'],
    confidence: unknownValue('NOT_QUERIED'),
    automaticEntityMembershipAllowed: false as const,
  };
  const cluster = ControlClusterVersionSchema.parse({
    ...clusterWithoutIdentity,
    id: `clv_${hashPayload({ schema: 'control-cluster-version-v1', value: clusterWithoutIdentity }).slice(0, 24)}`,
    resultHash: hashPayload(clusterWithoutIdentity),
  });
  const endBlock = unknownValue('NOT_QUERIED');
  const campaignIdentity = {
    ledger: 'EVM',
    chainId: snapshot.chainId,
    token: cluster.token,
    originBlock: '1',
    startBlock: '1',
    endBlock,
    clusterVersionId: cluster.id,
  };
  const campaignId = `cc_${hashPayload({ schema: 'control-campaign-v1', input: campaignIdentity }).slice(0, 24)}`;
  const campaignWithoutItem = {
    schemaVersion: 'control-campaign-v1' as const,
    id: campaignId,
    ledger: 'EVM' as const,
    chainId: snapshot.chainId,
    token: cluster.token,
    originBlock: '1',
    startBlock: '1',
    endBlock,
    status: 'ACTIVE' as const,
    currentStage: 'DISCOVERY' as const,
    primaryClusterId: cluster.id,
    clusterVersionId: cluster.id,
    coreWalletIds: cluster.coreWalletIds,
    satelliteWalletIds: cluster.satelliteWalletIds,
    fundingRootIds: [],
    settlementRootIds: [],
    controlledSupply: unknownValue('NOT_QUERIED'),
    controlConfidence: unknownValue('NOT_QUERIED'),
    coordinationConfidence: unknownValue('NOT_QUERIED'),
    campaignConfidence: unknownValue('NOT_QUERIED'),
    evidenceScore: 0,
    evidenceCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    dataCoverage: 1,
    behaviorEventIds: [],
    cexBoundaryIds: [],
    snapshotStart: snapshot,
    snapshotEnd: snapshot,
    ruleVersion: 'campaign-v1.0.0' as const,
    entityModelVersion: 'entity-v0.1.0',
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      freshness: snapshot.capturedAt,
      sourceSet: ['test-rpc'],
      modelVersion: 'campaign-v1.0.0',
      confidence: unknownValue('NOT_QUERIED'),
      evidenceIds: [evidence.id],
      calibrationStatus: 'UNCALIBRATED' as const,
    },
    automaticOwnershipMergeAllowed: false as const,
    automaticEntityMembershipMutationAllowed: false as const,
    calibrationStatus: 'UNCALIBRATED' as const,
    evidenceLineItemIds: [],
  };
  const campaignSeed = ControlCampaignSchema.parse({
    ...campaignWithoutItem,
    resultHash: hashPayload(campaignWithoutItem),
  });
  const item = createCampaignEvidenceItem({
    evidence,
    campaignId: campaignSeed.id,
    phase: 'TOKEN_CONTROL',
    role: 'DIRECT',
    polarity: 'SUPPORT',
    snapshot,
    featureKind: 'TOKEN_TRANSFER',
    strength: 1,
    reliability: 1,
    explanation: 'The canonical log supports the token control observation.',
  });
  const campaignWithoutIdentity = { ...campaignWithoutItem, evidenceLineItemIds: [item.id] };
  const campaign = ControlCampaignSchema.parse({
    ...campaignWithoutIdentity,
    resultHash: hashPayload(campaignWithoutIdentity),
  });
  const evidenceLine = buildForensicEvidenceLine({
    campaignId: campaign.id,
    items: [item],
    snapshotStart: snapshot,
    snapshotEnd: snapshot,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    sourceSet: ['test-rpc'],
  });
  const bundleWithoutIdentity = {
    schemaVersion: 'control-campaign-bundle-v1' as const,
    campaign,
    clusterVersion: cluster,
    memberships: [],
    positions: [],
    behaviorEvents: [],
    evidenceItems: [item],
    evidenceLine,
  };
  const bundle = ControlCampaignBundleSchema.parse({
    ...bundleWithoutIdentity,
    resultHash: hashPayload(bundleWithoutIdentity),
  });
  return {
    bundle,
    evidenceNode: { evidence, sourceEvidenceIds: [], snapshot },
  };
}

describe('forensic case bundle', () => {
  it('exports a closed, replayable bundle with manifest and artifact hashes', () => {
    const fixture = fixtureBundle();
    const bundle = buildForensicCaseBundle({
      campaign: fixture.bundle,
      evidenceNodes: [fixture.evidenceNode],
      gitCommit: '6f501e1',
    });

    expect(bundle.caseId).toBe(`fcb_${fixture.bundle.campaign.id}`);
    expect(bundle.evidenceClosure.map((node) => node.evidence.id)).toEqual([
      fixture.evidenceNode.evidence.id,
    ]);
    expect(bundle.manifest.evidenceCount).toBe(1);
    expect(bundle.manifest.rawArtifactHashes).toEqual(['ef'.repeat(32)]);
    expect(bundle.manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.resultHash).toMatch(/^[0-9a-f]{64}$/);

    const verified = verifyForensicCaseBundle(bundle);
    expect(verified).toMatchObject({ valid: true });
  });

  it('rejects incomplete closure and tampered bundle content', () => {
    const fixture = fixtureBundle();
    expect(() =>
      buildForensicCaseBundle({ campaign: fixture.bundle, evidenceNodes: [] }),
    ).toThrowError(expect.objectContaining({ code: 'CASE_EVIDENCE_CLOSURE_INCOMPLETE' }));

    const bundle = buildForensicCaseBundle({
      campaign: fixture.bundle,
      evidenceNodes: [fixture.evidenceNode],
    });
    const tampered = structuredClone(bundle);
    tampered.resultHash = '00'.repeat(32);
    expect(verifyForensicCaseBundle(tampered)).toMatchObject({
      valid: false,
      code: 'CASE_BUNDLE_HASH_MISMATCH',
    });
  });
});
