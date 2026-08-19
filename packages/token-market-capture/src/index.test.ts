import { describe, expect, it } from 'vitest';

import { operatorFromEndpoint } from '@zerotrace/source-registry';

import { captureTokenMarket } from './capture.js';
import { extractAddressFeatures } from './features.js';
import { TRANSFER_TOPIC, ZERO_ADDRESS, type RpcResult, type RpcTransport } from './types.js';
import { MemoryLocalIndex } from '@zerotrace/local-index';

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEPLOYER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BUYER = '0xcccccccccccccccccccccccccccccccccccccccc';
const TX = '0x' + '11'.repeat(32);
const LEFT = 'https://bsc-dataseed.bnbchain.org';
const RIGHT = 'https://bsc.nodereal.io';

function padTopic(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

function log(from: string, to: string, value: bigint, block: number, index: number) {
  return {
    address: TOKEN,
    topics: [TRANSFER_TOPIC, padTopic(from), padTopic(to)],
    data: `0x${value.toString(16).padStart(64, '0')}`,
    blockNumber: `0x${block.toString(16)}`,
    transactionHash: TX,
    logIndex: `0x${index.toString(16)}`,
    removed: false,
  };
}

class MemoryTransport implements RpcTransport {
  constructor(private readonly results: Map<string, unknown>) {}

  async call(endpointId: string, method: string, params: unknown[]): Promise<RpcResult> {
    const key = `${endpointId}|${method}|${JSON.stringify(params)}`;
    const shared = `${method}|${JSON.stringify(params)}`;
    const result = this.results.get(key) ?? this.results.get(shared);
    const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, result: result ?? null });
    if (result === undefined) {
      return { ok: false, result: null, raw, error: `missing ${shared}` };
    }
    return { ok: true, result, raw };
  }
}

function baseResults(): Map<string, unknown> {
  const map = new Map<string, unknown>();
  map.set('eth_blockNumber|[]', '0x200');
  map.set(`eth_getTransactionByHash|${JSON.stringify([TX])}`, {
    hash: TX,
    from: DEPLOYER,
    to: null,
    blockNumber: '0x10',
  });
  map.set(`eth_getTransactionReceipt|${JSON.stringify([TX])}`, {
    status: '0x1',
    contractAddress: TOKEN,
    blockNumber: '0x10',
    transactionHash: TX,
  });
  map.set(`eth_getCode|${JSON.stringify([TOKEN, 'latest'])}`, '0x60016000');
  const logs = [
    log(ZERO_ADDRESS, BUYER, 1000n, 16, 0),
    log(BUYER, '0xdddddddddddddddddddddddddddddddddddddddd', 100n, 20, 1),
  ];
  map.set(
    `eth_getLogs|${JSON.stringify([
      {
        fromBlock: '0x10',
        toBlock: '0xd7',
        address: TOKEN,
        topics: [TRANSFER_TOPIC],
      },
    ])}`,
    logs,
  );
  return map;
}

describe('token market capture', () => {
  it('closes origin from dual-operator creation tx and keeps history partial without full coverage', async () => {
    const transport = new MemoryTransport(baseResults());
    const report = await captureTokenMarket(
      {
        transport,
        operators: [
          operatorFromEndpoint({ endpointId: LEFT, chainId: 'eip155:56' }),
          operatorFromEndpoint({ endpointId: RIGHT, chainId: 'eip155:56' }),
        ],
        index: new MemoryLocalIndex(),
        logBudgetChunks: 1,
      },
      { chainId: 'eip155:56', token: TOKEN, creationTx: TX, chunkBlocks: 200n },
    );
    expect(report.origin.status).toBe('COMPLETE');
    expect(report.origin.deployer).toBe(DEPLOYER);
    expect(report.history.status).toBe('PARTIAL');
    expect(report.holders.some((item) => item.address === BUYER)).toBe(true);
    expect(report.stages.find((item) => item.name === 'RV')?.status).toBe('UNSUPPORTED');
    expect(
      report.stages.every(
        (item) =>
          item.status !== 'COMPLETE' || item.name === 'CAPABILITY' || item.name === 'ORIGIN',
      ),
    ).toBe(true);
    expect(report.roles.every((item) => !item.hiddenConfirmed)).toBe(true);
  });

  it('treats log-set disagreement as truncation, not the shorter list', async () => {
    const results = baseResults();
    results.set(
      `${LEFT}|eth_getLogs|${JSON.stringify([
        {
          fromBlock: '0x10',
          toBlock: '0xd7',
          address: TOKEN,
          topics: [TRANSFER_TOPIC],
        },
      ])}`,
      [log(ZERO_ADDRESS, BUYER, 1000n, 16, 0)],
    );
    results.set(
      `${RIGHT}|eth_getLogs|${JSON.stringify([
        {
          fromBlock: '0x10',
          toBlock: '0xd7',
          address: TOKEN,
          topics: [TRANSFER_TOPIC],
        },
      ])}`,
      [log(ZERO_ADDRESS, BUYER, 1000n, 16, 0), log(BUYER, DEPLOYER, 1n, 17, 1)],
    );
    const report = await captureTokenMarket(
      {
        transport: new MemoryTransport(results),
        operators: [
          operatorFromEndpoint({ endpointId: LEFT, chainId: 'eip155:56' }),
          operatorFromEndpoint({ endpointId: RIGHT, chainId: 'eip155:56' }),
        ],
        index: new MemoryLocalIndex(),
        logBudgetChunks: 1,
      },
      { chainId: 'eip155:56', token: TOKEN, creationTx: TX, chunkBlocks: 200n },
    );
    expect(report.history.status).toBe('FAILED');
    expect(report.history.limitation).toMatch(/截断|冲突/);
  });

  it('does not confirm hidden affiliate from early buying alone', () => {
    const features = extractAddressFeatures({
      address: BUYER,
      originBlock: 16n,
      transfers: [
        {
          chainId: 'eip155:56',
          token: TOKEN,
          blockNumber: 16n,
          logIndex: 0,
          transactionHash: TX,
          from: ZERO_ADDRESS,
          to: BUYER,
          valueAtomic: '1000',
        },
      ],
    });
    expect(features.forbiddenSingleFactors).toContain('early');
    expect(features.insiderAccessScore).toBeLessThan(40);
  });
});
