import { describe, expect, it } from 'vitest';

import { EvmLedgerAdapter, type JsonRpcTransport } from '@zerotrace/chain-adapters';
import { evidenceIdFor } from '@zerotrace/evidence';

import { observeErc20Decimals } from './erc20-metadata.js';

const token = `0x${'a'.repeat(40)}`;

function adapter(result = `0x${'12'.padStart(64, '0')}`) {
  async function response<T>(method: string): Promise<T> {
    if (method === 'eth_getBlockByNumber') {
      return {
        number: '0x10',
        hash: `0x${'1'.repeat(64)}`,
        parentHash: `0x${'2'.repeat(64)}`,
        timestamp: '0x65',
      } as T;
    }
    if (method === 'eth_call') return result as T;
    throw new Error(`Unexpected ${method}`);
  }
  const transport: JsonRpcTransport = {
    endpointId: 'rpc:bsc-fixture',
    request: response,
    async requestSourced<T>(method: string) {
      return { value: await response<T>(method), endpointId: 'rpc:bsc-fixture' };
    },
  };
  return new EvmLedgerAdapter(
    {
      id: 'bsc-rpc',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    transport,
  );
}

describe('ERC-20 metadata observation', () => {
  it('binds decimals to a finalized Snapshot and canonical contract-state Evidence', async () => {
    const result = await observeErc20Decimals(adapter(), token);

    expect(result).toMatchObject({
      assetId: `eip155:56:erc20:${token}`,
      decimals: 18,
      snapshot: { ledger: 'EVM', chainId: 'eip155:56', finality: 'finalized' },
      evidence: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        kind: 'CONTRACT_STATE',
        source: 'rpc:bsc-fixture',
        locator: `token-decimals:eip155:56:erc20:${token}`,
        blockOrSlot: '16',
        finality: 'finalized',
      },
    });
    expect(result.evidence.id).toBe(evidenceIdFor(result.evidence));
  });

  it('fails closed on malformed contract output', async () => {
    await expect(observeErc20Decimals(adapter('0x'), token)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
