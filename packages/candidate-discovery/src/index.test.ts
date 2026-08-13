import { describe, expect, it } from 'vitest';

import { createTokenFlowEdge } from '@zerotrace/token-flow-engine';
import { discoverCandidateWallets } from './index.js';

function edge(logIndex: string, from: string, to: string) {
  return createTokenFlowEdge({
    ledger: 'EVM',
    chainId: 'eip155:56',
    token: '0xtoken',
    blockNumber: '10',
    blockHash: '0xblock',
    transactionHash: `0xtx${logIndex}`,
    transactionIndex: '0',
    logIndex,
    from,
    to,
    amountRaw: '10',
    kind: 'TRANSFER',
    execution: 'SUCCESS',
    finality: 'FINAL',
    evidenceId: `ev_${logIndex.padStart(24, '0')}`,
    observedAt: '2026-08-13T00:00:00Z',
  });
}

describe('candidate discovery', () => {
  it('discovers token-centric candidates but excludes known service endpoints', () => {
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '20',
      blockHash: `0x${'ab'.repeat(32)}`,
      finality: 'finalized' as const,
      capturedAt: '2026-08-13T00:00:00.000Z',
      providerVersions: { rpc: 'test' },
      adapterVersions: { evm: 'test' },
      configHash: 'cd'.repeat(32),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-test-v1',
    };
    const result = discoverCandidateWallets({
      ledger: 'EVM',
      chainId: 'eip155:56',
      token: '0xtoken',
      fromBlock: '1',
      toBlock: '20',
      edges: [
        edge('1', '0xfunder', '0xa'),
        edge('2', '0xfunder', '0xb'),
        edge('3', '0xfunder', '0xc'),
        edge('4', '0xrouter', '0xd'),
      ],
      snapshot,
      serviceWalletIds: ['0xrouter'],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      sourceSet: ['test-rpc'],
    });
    expect(result.candidates.map((item) => item.walletId)).toEqual(
      expect.arrayContaining(['0xa', '0xb', '0xc']),
    );
    expect(result.candidates.map((item) => item.walletId)).not.toContain('0xrouter');
    expect(result.excludedServiceWalletIds).toEqual(['0xrouter']);
    expect(result.automaticEntityMembershipAllowed).toBe(false);
    expect(result.candidates.every((item) => item.reasons.includes('EARLY_TOKEN_ACTIVITY'))).toBe(
      true,
    );
  });
});
