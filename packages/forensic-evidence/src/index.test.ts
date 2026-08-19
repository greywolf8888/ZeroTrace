import { describe, expect, it } from 'vitest';

import { createEvidence } from '@zerotrace/evidence';
import { buildForensicEvidenceLine, createCampaignEvidenceItem } from './index.js';

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

describe('forensic evidence', () => {
  it('wraps canonical Evidence without creating a second raw source of truth', () => {
    const evidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'LOG',
      source: 'test-rpc',
      locator: `0x${'11'.repeat(32)}`,
      blockOrSlot: '100',
      finality: 'finalized',
      payload: { token: '0xtoken', amount: '100' },
      summary: 'Observed token transfer log.',
      observedAt: snapshot.capturedAt,
    });
    const item = createCampaignEvidenceItem({
      evidence,
      campaignId: 'cc_0123456789abcdef01234567',
      phase: 'TOKEN_CONTROL',
      role: 'DIRECT',
      polarity: 'SUPPORT',
      snapshot,
      featureKind: 'CLUSTER_NET_TOKEN_INFLOW',
      strength: 1,
      reliability: 1,
      explanation: 'The canonical log directly supports the token inflow observation.',
    });
    expect(item.evidenceId).toBe(evidence.id);
    expect(item.parentEvidenceIds).toEqual([]);
    const line = buildForensicEvidenceLine({
      campaignId: item.campaignId,
      items: [item],
      snapshotStart: snapshot,
      snapshotEnd: snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-rpc'],
    });
    expect(line.phases[0]?.phase).toBe('TOKEN_CONTROL');
    expect(line.evidenceIds).toEqual([evidence.id]);
    expect(line.terminalBoundary).toBe('NONE_OBSERVED');
  });
});
