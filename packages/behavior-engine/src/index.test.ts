import { describe, expect, it } from 'vitest';

import { buildClusterPosition } from '@zerotrace/cluster-position-engine';
import { createTokenFlowEdge } from '@zerotrace/token-flow-engine';
import { detectBehaviorEvent } from './index.js';

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

describe('behavior engine', () => {
  it('emits an evidence-backed accumulation hypothesis with uncalibrated score semantics', () => {
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
      evidenceId: 'ev_000000000000000000000001',
      observedAt: snapshot.capturedAt,
    });
    const position = buildClusterPosition({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      campaignId: 'cc_0123456789abcdef01234567',
      clusterVersionId: 'clv_0123456789abcdef01234567',
      memberWalletIds: ['0xa'],
      initialTokenBalanceRaw: '0',
      initialWalletBalances: { '0xa': '0' },
      circulatingSupplyRaw: '1000',
      snapshot,
      edges: [edge],
      membershipEvidenceIds: ['ev_000000000000000000000002'],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-rpc'],
    });
    const event = detectBehaviorEvent({
      campaignId: 'cc_0123456789abcdef01234567',
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      clusterVersionId: 'clv_0123456789abcdef01234567',
      snapshot,
      afterPosition: position,
      edges: [edge],
      actors: ['0xa'],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-rpc'],
    });
    expect(event.type).toBe('ACCUMULATION');
    expect(event.confidence.state).toBe('known');
    expect(event.evidenceScore).toBeGreaterThan(0.5);
    expect(event.explanation).toContain('uncalibrated');
    expect(event.supportingEvidenceIds).toContain(edge.evidenceId);
  });

  it('hard-suppresses attribution through a service or CEX boundary', () => {
    const position = buildClusterPosition({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      campaignId: 'cc_0123456789abcdef01234567',
      clusterVersionId: 'clv_0123456789abcdef01234567',
      memberWalletIds: ['0xa'],
      initialTokenBalanceRaw: '1',
      initialWalletBalances: { '0xa': '1' },
      snapshot,
      edges: [],
      membershipEvidenceIds: ['ev_000000000000000000000002'],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-rpc'],
    });
    const event = detectBehaviorEvent({
      campaignId: 'cc_0123456789abcdef01234567',
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      clusterVersionId: 'clv_0123456789abcdef01234567',
      snapshot,
      afterPosition: position,
      edges: [],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-rpc'],
      suppressionReasons: ['CEX_PATH_BREAK'],
      contradictingEvidenceIds: ['ev_000000000000000000000003'],
    });
    expect(event.attributionStopped).toBe(true);
    expect(event.confidence).toMatchObject({ state: 'unknown', reason: 'NOT_APPLICABLE' });
    expect(event.suppressionReasons).toEqual(['CEX_PATH_BREAK']);
  });
});
