import { describe, expect, it } from 'vitest';

import {
  createTokenFlowEdge,
  materializeTokenFlow,
  reconcileTokenFlowReorg,
  summarizeClusterFlows,
} from './index.js';

const base = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  token: '0xtoken',
  blockHash: '0xblock',
  transactionIndex: '0',
  execution: 'SUCCESS' as const,
  finality: 'FINAL' as const,
  observedAt: '2026-08-13T00:00:00Z',
};

function edge(input: Partial<Parameters<typeof createTokenFlowEdge>[0]> & { logIndex: string }) {
  return createTokenFlowEdge({
    ...base,
    blockNumber: input.blockNumber ?? '100',
    transactionHash: input.transactionHash ?? `0xtx${input.logIndex}`,
    from: input.from ?? '0xexternal',
    to: input.to ?? '0xa',
    amountRaw: input.amountRaw ?? '1',
    kind: input.kind ?? 'TRANSFER',
    evidenceId: input.evidenceId ?? `ev_${input.logIndex.padStart(24, '0')}`,
    ...input,
  });
}

describe('token flow engine', () => {
  it('keeps internal movement out of cluster net position and ignores failed execution', () => {
    const edges = [
      edge({
        logIndex: '1',
        kind: 'DEX_BUY',
        amountRaw: '100',
        from: '0xexternal',
        to: '0xa',
        quoteAsset: '0xusdt',
        quoteAmountRaw: '1000',
      }),
      edge({ logIndex: '2', kind: 'TRANSFER', amountRaw: '20', from: '0xa', to: '0xb' }),
      edge({
        logIndex: '3',
        kind: 'DEX_SELL',
        amountRaw: '30',
        from: '0xa',
        to: '0xpool',
        quoteAsset: '0xusdt',
        quoteAmountRaw: '300',
      }),
      edge({
        logIndex: '4',
        kind: 'MINT',
        amountRaw: '5',
        from: '0x0000000000000000000000000000000000000000',
        to: '0xa',
      }),
      edge({
        logIndex: '5',
        kind: 'BURN',
        amountRaw: '2',
        from: '0xb',
        to: '0x0000000000000000000000000000000000000000',
      }),
      edge({
        logIndex: '6',
        kind: 'TRANSFER',
        amountRaw: '999',
        from: '0xexternal',
        to: '0xa',
        execution: 'FAILED',
        finality: 'PROVISIONAL',
      }),
    ];
    const summary = summarizeClusterFlows(edges, ['0xa', '0xb']);
    expect(summary).toMatchObject({
      externalTokenInflowRaw: '100',
      externalTokenOutflowRaw: '30',
      mintRaw: '5',
      burnRaw: '2',
      internalTransferRaw: '20',
      netPositionDeltaRaw: '73',
    });
    expect(materializeTokenFlow(edges)).toMatchObject({
      successfulCount: 5,
      failedCount: 1,
      walletDeltas: { '0xa': '55', '0xb': '18' },
    });
  });

  it('deduplicates exact logs and exposes reorg replacement instead of hiding it', () => {
    const original = edge({ logIndex: '1', blockHash: '0xold', transactionHash: '0xtx' });
    expect(materializeTokenFlow([original, original]).transferCount).toBe(1);
    const replacement = edge({ logIndex: '1', blockHash: '0xnew', transactionHash: '0xtx' });
    const reconciliation = reconcileTokenFlowReorg([original], [replacement]);
    expect(reconciliation.revokedEdgeIds).toEqual([original.id]);
    expect(reconciliation.replacementEdgeIds).toEqual([replacement.id]);
  });
});
