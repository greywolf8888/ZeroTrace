import { describe, expect, it } from 'vitest';

import { operatorFromEndpoint } from '@zerotrace/source-registry';

import { campaignWindowsFromTransfers, captureTokenMarket } from './capture.js';
import { extractAddressFeatures } from './features.js';
import { traceCreatesToken } from './trace.js';
import { TRANSFER_TOPIC, ZERO_ADDRESS, type RpcResult, type RpcTransport } from './types.js';
import { MemoryLocalIndex } from '@zerotrace/local-index';

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEPLOYER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BUYER = '0xcccccccccccccccccccccccccccccccccccccccc';
const TX = '0x' + '11'.repeat(32);
const LEFT = 'https://bsc.nodereal.io';
const RIGHT = 'https://rpc.ankr.com/bsc';
const PUBLIC_LEFT = 'https://bsc-dataseed.bnbchain.org';
const PUBLIC_RIGHT = 'https://bsc.nodereal.io';

function keyedOperator(endpointId: string) {
  return operatorFromEndpoint({
    endpointId,
    chainId: 'eip155:56',
    forensicGrade: 'FREE_KEYED',
    logsCapability: 'allowed',
    deniedMethods: [],
  });
}

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
        operators: [keyedOperator(LEFT), keyedOperator(RIGHT)],
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
        operators: [keyedOperator(LEFT), keyedOperator(RIGHT)],
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

  it('keeps factory-internal origin PARTIAL with TRACE_UNAVAILABLE', async () => {
    const results = baseResults();
    results.set(`eth_getTransactionReceipt|${JSON.stringify([TX])}`, {
      status: '0x1',
      contractAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
      blockNumber: '0x10',
      transactionHash: TX,
    });
    const report = await captureTokenMarket(
      {
        transport: new MemoryTransport(results),
        operators: [keyedOperator(LEFT), keyedOperator(RIGHT)],
        index: new MemoryLocalIndex(),
        logBudgetChunks: 1,
      },
      { chainId: 'eip155:56', token: TOKEN, creationTx: TX, chunkBlocks: 200n },
    );
    expect(report.origin.status).toBe('PARTIAL');
    expect(report.origin.limitationCode).toBe('TRACE_UNAVAILABLE');
    expect(report.origin.limitation).toMatch(/TRACE_UNAVAILABLE/);
  });

  it('closes factory-internal origin when a generic TRACE slot matches CREATE', async () => {
    const results = baseResults();
    results.set(`eth_getTransactionReceipt|${JSON.stringify([TX])}`, {
      status: '0x1',
      contractAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
      blockNumber: '0x10',
      transactionHash: TX,
    });
    results.set(`debug_traceTransaction|${JSON.stringify([TX, { tracer: 'callTracer' }])}`, {
      type: 'CALL',
      from: DEPLOYER,
      to: '0xdddddddddddddddddddddddddddddddddddddddd',
      calls: [{ type: 'CREATE', from: DEPLOYER, to: TOKEN, input: '0x', output: '0x60' }],
    });
    const report = await captureTokenMarket(
      {
        transport: new MemoryTransport(results),
        operators: [keyedOperator(LEFT), keyedOperator(RIGHT)],
        index: new MemoryLocalIndex(),
        logBudgetChunks: 1,
        traceAvailable: true,
        traceEndpointId: LEFT,
      },
      { chainId: 'eip155:56', token: TOKEN, creationTx: TX, chunkBlocks: 200n },
    );
    expect(report.origin.status).toBe('COMPLETE');
    expect(report.origin.limitationCode).toBeUndefined();
    expect(report.origin.deployer).toBe(DEPLOYER);
    expect(
      report.artifacts.some((item) => item.path.includes('trace-debug_traceTransaction')),
    ).toBe(true);
  });

  it('keeps factory-internal origin PARTIAL when traces do not create the token', async () => {
    const results = baseResults();
    results.set(`eth_getTransactionReceipt|${JSON.stringify([TX])}`, {
      status: '0x1',
      contractAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
      blockNumber: '0x10',
      transactionHash: TX,
    });
    results.set(`debug_traceTransaction|${JSON.stringify([TX, { tracer: 'callTracer' }])}`, {
      type: 'CALL',
      from: DEPLOYER,
      to: '0xdddddddddddddddddddddddddddddddddddddddd',
      calls: [],
    });
    const report = await captureTokenMarket(
      {
        transport: new MemoryTransport(results),
        operators: [keyedOperator(LEFT), keyedOperator(RIGHT)],
        index: new MemoryLocalIndex(),
        logBudgetChunks: 1,
        traceAvailable: true,
        traceEndpointId: LEFT,
      },
      { chainId: 'eip155:56', token: TOKEN, creationTx: TX, chunkBlocks: 200n },
    );
    expect(report.origin.status).toBe('PARTIAL');
    expect(report.origin.limitationCode).toBe('TRACE_NO_MATCH');
  });

  it('closes factory-internal origin from bulk CREATE traces when TRACE RPC is absent', async () => {
    const results = baseResults();
    results.set(`eth_getTransactionReceipt|${JSON.stringify([TX])}`, {
      status: '0x1',
      contractAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
      blockNumber: '0x10',
      transactionHash: TX,
    });
    const report = await captureTokenMarket(
      {
        transport: new MemoryTransport(results),
        operators: [keyedOperator(LEFT), keyedOperator(RIGHT)],
        index: new MemoryLocalIndex(),
        logBudgetChunks: 1,
        creationTraceSource: {
          async getCreations() {
            const value = [{ address: TOKEN, transactionHash: TX }];
            return { ok: true, result: value, raw: JSON.stringify(value) };
          },
        },
      },
      { chainId: 'eip155:56', token: TOKEN, creationTx: TX, chunkBlocks: 200n },
    );
    expect(report.origin.status).toBe('COMPLETE');
    expect(report.artifacts.some((item) => item.path.includes('bulk-creation-traces'))).toBe(true);
  });

  it('does not scan eth_getLogs when origin block is unknown', async () => {
    const methods: string[] = [];
    const inner = new MemoryTransport(baseResults());
    const transport: RpcTransport = {
      async call(endpointId, method, params) {
        methods.push(method);
        return inner.call(endpointId, method, params);
      },
    };
    const report = await captureTokenMarket(
      {
        transport,
        operators: [keyedOperator(LEFT), keyedOperator(RIGHT)],
        index: new MemoryLocalIndex(),
        logBudgetChunks: 1,
      },
      { chainId: 'eip155:56', token: TOKEN, chunkBlocks: 200n },
    );
    expect(methods).not.toContain('eth_getLogs');
    expect(report.origin.status).toBe('PARTIAL');
    expect(report.history.limitation).toMatch(/起源区块未知/);
  });

  it('matches CREATE and Parity create traces to the token address', () => {
    expect(
      traceCreatesToken(
        {
          type: 'CALL',
          calls: [{ type: 'CREATE2', to: TOKEN }],
        },
        TOKEN,
      ),
    ).toBe(true);
    expect(traceCreatesToken([{ type: 'create', result: { address: TOKEN } }], TOKEN)).toBe(true);
    expect(traceCreatesToken({ type: 'CALL', calls: [] }, TOKEN)).toBe(false);
  });

  it('does not scan eth_getLogs on the public no-SLA pool', async () => {
    const methods: string[] = [];
    const inner = new MemoryTransport(baseResults());
    const transport: RpcTransport = {
      async call(endpointId, method, params) {
        methods.push(method);
        return inner.call(endpointId, method, params);
      },
    };
    const report = await captureTokenMarket(
      {
        transport,
        operators: [
          operatorFromEndpoint({ endpointId: PUBLIC_LEFT, chainId: 'eip155:56' }),
          operatorFromEndpoint({ endpointId: PUBLIC_RIGHT, chainId: 'eip155:56' }),
        ],
        index: new MemoryLocalIndex(),
        logBudgetChunks: 1,
      },
      { chainId: 'eip155:56', token: TOKEN, creationTx: TX, chunkBlocks: 200n },
    );
    expect(methods).not.toContain('eth_getLogs');
    expect(report.history.status).toBe('PARTIAL');
    expect(report.history.limitation).toMatch(/LOGS_REQUIRE_BULK_OR_KEYED/);
  });

  it('does not issue historical eth_getLogs when coverage is already complete', async () => {
    const methods: string[] = [];
    const inner = new MemoryTransport(baseResults());
    const transport: RpcTransport = {
      async call(endpointId, method, params) {
        methods.push(method);
        return inner.call(endpointId, method, params);
      },
    };
    const index = new MemoryLocalIndex();
    index.putCoverage('eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
      startBlock: 16n,
      endBlock: 0x200n,
    });
    const report = await captureTokenMarket(
      {
        transport,
        operators: [keyedOperator(LEFT), keyedOperator(RIGHT)],
        index,
        logBudgetChunks: 4,
      },
      { chainId: 'eip155:56', token: TOKEN, creationTx: TX, chunkBlocks: 200n },
    );
    expect(methods).not.toContain('eth_getLogs');
    expect(report.history.status).toBe('COMPLETE');
    expect(report.rpcStats.historical).toBeGreaterThan(0);
  });

  it('skips origin RPC on a cached COMPLETE origin and counts no historical calls for history-complete replay', async () => {
    const methods: string[] = [];
    const inner = new MemoryTransport(baseResults());
    const transport: RpcTransport = {
      async call(endpointId, method, params) {
        methods.push(method);
        return inner.call(endpointId, method, params);
      },
    };
    const index = new MemoryLocalIndex();
    index.putCoverage('eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
      startBlock: 16n,
      endBlock: 0x200n,
    });
    const cachedOrigins = new Map([
      [
        TOKEN,
        {
          status: 'COMPLETE' as const,
          creationTx: TX,
          deployer: DEPLOYER,
          createdBlock: '16',
        },
      ],
    ]);
    const report = await captureTokenMarket(
      {
        transport,
        operators: [keyedOperator(LEFT), keyedOperator(RIGHT)],
        index,
        logBudgetChunks: 4,
        cachedOrigins,
      },
      { chainId: 'eip155:56', token: TOKEN, creationTx: TX, chunkBlocks: 200n },
    );
    expect(methods).toEqual(['eth_blockNumber', 'eth_blockNumber']);
    expect(report.origin.status).toBe('COMPLETE');
    expect(report.rpcStats.historical).toBe(0);
    expect(report.history.status).toBe('COMPLETE');
  });

  it('returns no campaign windows until four transfers exist, then splits on volume change points', () => {
    const transfer = (block: bigint, value: string) => ({
      chainId: 'eip155:56',
      token: TOKEN,
      blockNumber: block,
      logIndex: 0,
      transactionHash: TX,
      from: ZERO_ADDRESS,
      to: BUYER,
      valueAtomic: value,
    });
    expect(campaignWindowsFromTransfers([transfer(10n, '1'), transfer(11n, '1')])).toEqual([]);
    const windows = campaignWindowsFromTransfers([
      transfer(10n, '1'),
      transfer(20n, '1'),
      transfer(30n, '1000000000'),
      transfer(40n, '1'),
      transfer(50n, '1'),
      transfer(60n, '1'),
    ]);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]?.start).toBe(10);
    expect(windows.at(-1)?.end).toBe(60);
  });
});
