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

  it('does not treat Solana mint and burn sentinels as wallet candidates', () => {
    const solanaMint = 'So11111111111111111111111111111111111111112';
    const owner = '11111111111111111111111111111111';
    const synthetic = `solana:mint:${solanaMint}`;
    const snapshot = {
      ledger: 'SOLANA' as const,
      chainId: 'solana-mainnet' as const,
      slot: '20',
      blockhash: '3ySAYPQqMfpyZL6QhH4RzgT68HWpV72G2JAa2XWrpHEi',
      parentSlot: '19',
      previousBlockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
      commitment: 'finalized' as const,
      capturedAt: '2026-08-13T00:00:00.000Z',
      providerVersions: { rpc: 'test' },
      adapterVersions: { solana: 'test' },
      configHash: 'ef'.repeat(32),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-test-v1',
    };
    const result = discoverCandidateWallets({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      token: solanaMint,
      fromBlock: '1',
      toBlock: '20',
      edges: [
        createTokenFlowEdge({
          ledger: 'SOLANA',
          chainId: 'solana-mainnet',
          token: solanaMint,
          blockNumber: '10',
          blockHash: snapshot.blockhash,
          transactionHash: '1'.repeat(64),
          transactionIndex: '0',
          logIndex: '0',
          from: synthetic,
          to: owner,
          amountRaw: '10',
          kind: 'MINT',
          execution: 'SUCCESS',
          finality: 'FINAL',
          evidenceId: `ev_${'1'.repeat(24)}`,
          observedAt: snapshot.capturedAt,
        }),
        createTokenFlowEdge({
          ledger: 'SOLANA',
          chainId: 'solana-mainnet',
          token: solanaMint,
          blockNumber: '11',
          blockHash: snapshot.blockhash,
          transactionHash: '2'.repeat(64),
          transactionIndex: '0',
          logIndex: '0',
          from: owner,
          to: synthetic,
          amountRaw: '2',
          kind: 'BURN',
          execution: 'SUCCESS',
          finality: 'FINAL',
          evidenceId: `ev_${'2'.repeat(24)}`,
          observedAt: snapshot.capturedAt,
        }),
      ],
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 0,
      sourceSet: ['test-rpc'],
    });
    expect(result.candidates.map((item) => item.walletId)).toEqual([owner]);
  });
});
