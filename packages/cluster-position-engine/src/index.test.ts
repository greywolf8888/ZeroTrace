import { describe, expect, it } from 'vitest';

import { buildClusterPosition } from './index.js';
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

function flow(
  logIndex: string,
  from: string,
  to: string,
  amountRaw: string,
  kind: 'TRANSFER' | 'MINT' | 'BURN' | 'DEX_BUY' | 'DEX_SELL' = 'TRANSFER',
) {
  return createTokenFlowEdge({
    ledger: 'EVM',
    chainId: 'eip155:56',
    token: '0xtoken',
    blockNumber: '100',
    blockHash: snapshot.blockHash,
    transactionHash: `0xtx${logIndex}`,
    transactionIndex: '0',
    logIndex,
    from,
    to,
    amountRaw,
    kind,
    execution: 'SUCCESS',
    finality: 'FINAL',
    evidenceId: `ev_${logIndex.padStart(24, '0')}`,
    observedAt: snapshot.capturedAt,
  });
}

describe('cluster position engine', () => {
  it('passes exact raw-unit conservation while excluding internal transfers', () => {
    const position = buildClusterPosition({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      campaignId: 'cc_0123456789abcdef01234567',
      clusterVersionId: 'clv_0123456789abcdef01234567',
      memberWalletIds: ['0xa', '0xb'],
      initialTokenBalanceRaw: '0',
      initialWalletBalances: { '0xa': '0', '0xb': '0' },
      circulatingSupplyRaw: '1000',
      snapshot,
      edges: [
        flow('1', '0xexternal', '0xa', '100', 'DEX_BUY'),
        flow('2', '0xa', '0xb', '20'),
        flow('3', '0xa', '0xpool', '30', 'DEX_SELL'),
        flow('4', '0x0000000000000000000000000000000000000000', '0xa', '5', 'MINT'),
        flow('5', '0xb', '0x0000000000000000000000000000000000000000', '2', 'BURN'),
      ],
      membershipEvidenceIds: ['ev_000000000000000000000001'],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-rpc'],
    });
    expect(position.tokenBalanceRaw).toBe('73');
    expect(position.controlledSupplyRatio).toEqual({ state: 'known', value: '0.073' });
    expect(position.internalTransferRaw).toBe('20');
    expect(position.resultHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not coerce missing supply or realizable value to zero', () => {
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
      membershipEvidenceIds: ['ev_000000000000000000000001'],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-rpc'],
    });
    expect(position.controlledSupplyRatio.state).toBe('unknown');
    expect(position.realizableQuoteValue.state).toBe('unknown');
  });
});
