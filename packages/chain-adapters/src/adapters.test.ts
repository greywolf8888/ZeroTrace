import { describe, expect, it } from 'vitest';

import { BitcoinUtxoLedgerAdapter } from './bitcoin.js';
import { ProviderError } from './errors.js';
import { EvmLedgerAdapter } from './evm.js';
import { ProviderRegistry } from './registry.js';
import { SolanaLedgerAdapter } from './solana.js';
import type { JsonRpcTransport, RestTransport } from './transport.js';

class FakeJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId = 'fake';
  readonly calls: Array<{ method: string; params: readonly unknown[] }> = [];
  readonly #responses: Record<string, unknown>;

  constructor(responses: Record<string, unknown>) {
    this.#responses = responses;
  }

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    this.calls.push({ method, params });
    const response = this.#responses[method];
    if (response instanceof Error) throw response;
    return response as T;
  }
}

class FakeRestTransport implements RestTransport {
  readonly endpointId = 'fake-esplora';
  readonly responses: Record<string, unknown>;

  constructor(responses: Record<string, unknown>) {
    this.responses = responses;
  }

  async getText(path: string): Promise<string> {
    return String(this.responses[path]);
  }

  async getJson<T>(path: string): Promise<T> {
    return this.responses[path] as T;
  }
}

describe('read-only adapter boundary', () => {
  it('blocks all EVM broadcasting before reaching the transport', async () => {
    const transport = new FakeJsonRpcTransport({});
    const adapter = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum' },
      transport,
    );
    await expect(adapter.read('eth_sendRawTransaction', ['0xdeadbeef'])).rejects.toMatchObject({
      code: 'METHOD_NOT_ALLOWED',
    });
    expect(transport.calls).toHaveLength(0);
  });

  it('blocks Solana sendTransaction while retaining simulateTransaction', async () => {
    const transport = new FakeJsonRpcTransport({ simulateTransaction: { value: { err: null } } });
    const adapter = new SolanaLedgerAdapter({ id: 'solana', commitment: 'finalized' }, transport);
    await expect(adapter.read('sendTransaction', ['signed-payload'])).rejects.toMatchObject({
      code: 'METHOD_NOT_ALLOWED',
    });
    await expect(adapter.read('simulateTransaction', ['unsigned-message'])).resolves.toEqual({
      value: { err: null },
    });
  });
});

describe('capability probes and snapshots', () => {
  it('probes an EVM chain and detects its head without numeric precision loss', async () => {
    const transport = new FakeJsonRpcTransport({
      eth_chainId: '0x1',
      eth_blockNumber: '0x20000000000001',
    });
    const adapter = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum' },
      transport,
    );
    const health = await adapter.probe();
    expect(health.status).toBe('UP');
    expect(health.head).toEqual({ state: 'known', value: '9007199254740993' });
  });

  it('creates a replayable Bitcoin snapshot from two independent tip endpoints', async () => {
    const adapter = new BitcoinUtxoLedgerAdapter(
      { id: 'esplora' },
      new FakeRestTransport({
        '/blocks/tip/height': '840000',
        '/blocks/tip/hash': 'a'.repeat(64),
      }),
    );
    await expect(adapter.createSnapshot()).resolves.toMatchObject({
      ledger: 'BITCOIN',
      height: '840000',
      blockHash: 'a'.repeat(64),
    });
  });

  it('creates a finalized Solana snapshot', async () => {
    const adapter = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({
        getSlot: 300_000_000,
        getLatestBlockhash: { value: { blockhash: '11111111111111111111111111111111' } },
      }),
    );
    await expect(adapter.createSnapshot()).resolves.toMatchObject({
      ledger: 'SOLANA',
      slot: '300000000',
      commitment: 'finalized',
    });
  });

  it('creates a replayable EVM snapshot and forwards block-pinned reads', async () => {
    const transport = new FakeJsonRpcTransport({
      eth_getBlockByNumber: {
        number: '0x10',
        hash: '0x' + 'a'.repeat(64),
        timestamp: '0x65',
      },
      eth_getBalance: '0x2a',
      eth_getCode: '0x6000',
    });
    const adapter = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum', adapterVersion: 'fixture' },
      transport,
    );
    await expect(adapter.createSnapshot()).resolves.toMatchObject({
      ledger: 'EVM',
      chainId: 'eip155:1',
      blockNumber: '16',
      blockHash: '0x' + 'a'.repeat(64),
      adapterVersions: { evm: 'fixture' },
    });
    await expect(adapter.getBalance('0xabc', '0x10')).resolves.toBe('0x2a');
    await expect(adapter.getCode('0xabc', '0x10')).resolves.toBe('0x6000');
    expect(transport.calls.at(-1)).toEqual({
      method: 'eth_getCode',
      params: ['0xabc', '0x10'],
    });
  });

  it('reports EVM chain mismatches and provider rate limiting explicitly', async () => {
    const mismatch = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum' },
      new FakeJsonRpcTransport({ eth_chainId: '0x38', eth_blockNumber: '0x10' }),
    );
    await expect(mismatch.probe()).resolves.toMatchObject({
      status: 'DEGRADED',
      errorCode: 'CHAIN_MISMATCH',
    });

    const limited = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum' },
      new FakeJsonRpcTransport({
        eth_chainId: new ProviderError('RATE_LIMITED', 'quota', { retryable: true }),
        eth_blockNumber: '0x10',
      }),
    );
    await expect(limited.probe()).resolves.toMatchObject({
      status: 'RATE_LIMITED',
      head: { state: 'unavailable', reason: 'RATE_LIMITED' },
    });
  });

  it('rejects malformed EVM snapshot fields', async () => {
    const adapter = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum' },
      new FakeJsonRpcTransport({
        eth_getBlockByNumber: { number: '16', hash: 'bad', timestamp: '0x1' },
      }),
    );
    await expect(adapter.createSnapshot()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reads Bitcoin address, transaction, and output-spend resources safely', async () => {
    const address = { address: 'bc1qtest', chain_stats: {}, mempool_stats: {} };
    const transaction = { txid: 'abc' };
    const outspend = { spent: false };
    const transport = new FakeRestTransport({
      '/address/bc1qtest': address,
      '/tx/abc': transaction,
      '/tx/abc/outspend/0': outspend,
    });
    const adapter = new BitcoinUtxoLedgerAdapter({ id: 'esplora' }, transport);
    await expect(adapter.getAddress('bc1qtest')).resolves.toBe(address);
    await expect(adapter.getTransaction('abc')).resolves.toBe(transaction);
    await expect(adapter.getOutspend('abc', 0)).resolves.toBe(outspend);
    expect(() => adapter.getOutspend('abc', -1)).toThrow(ProviderError);
    expect(() => adapter.getOutspend('abc', Number.MAX_SAFE_INTEGER + 1)).toThrow(ProviderError);
  });

  it('reports Bitcoin provider health and malformed tip data', async () => {
    const healthy = new BitcoinUtxoLedgerAdapter(
      { id: 'esplora' },
      new FakeRestTransport({ '/blocks/tip/height': ' 840000 ' }),
    );
    await expect(healthy.probe()).resolves.toMatchObject({
      status: 'UP',
      head: { state: 'known', value: '840000' },
    });

    const invalid = new BitcoinUtxoLedgerAdapter(
      { id: 'esplora' },
      new FakeRestTransport({
        '/blocks/tip/height': '-1',
        '/blocks/tip/hash': 'bad',
      }),
    );
    await expect(invalid.probe()).resolves.toMatchObject({
      status: 'DOWN',
      head: { state: 'unavailable', reason: 'PROVIDER_DOWN' },
    });
    await expect(invalid.createSnapshot()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const invalidHash = new BitcoinUtxoLedgerAdapter(
      { id: 'esplora' },
      new FakeRestTransport({
        '/blocks/tip/height': '840000',
        '/blocks/tip/hash': 'bad',
      }),
    );
    await expect(invalidHash.createSnapshot()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('adds minimum context to Solana reads and reports health failures', async () => {
    const transport = new FakeJsonRpcTransport({
      getAccountInfo: { context: { slot: 10 }, value: null },
      getHealth: 'ok',
      getSlot: 10,
    });
    const adapter = new SolanaLedgerAdapter({ id: 'solana', commitment: 'finalized' }, transport);
    await expect(adapter.getAccountInfo('11111111111111111111111111111111', 9)).resolves.toEqual({
      context: { slot: 10 },
      value: null,
    });
    expect(transport.calls[0]?.params).toEqual([
      '11111111111111111111111111111111',
      { encoding: 'base64', commitment: 'finalized', minContextSlot: 9 },
    ]);
    await expect(adapter.probe()).resolves.toMatchObject({
      status: 'UP',
      head: { state: 'known', value: '10' },
    });

    const unhealthy = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({ getHealth: 'behind', getSlot: -1 }),
    );
    await expect(unhealthy.probe()).resolves.toMatchObject({
      status: 'DOWN',
      head: { state: 'unavailable', reason: 'PROVIDER_DOWN' },
    });
  });

  it('rejects malformed Solana snapshot state', async () => {
    const invalidSlot = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({
        getSlot: Number.MAX_SAFE_INTEGER + 1,
        getLatestBlockhash: { value: { blockhash: '1'.repeat(32) } },
      }),
    );
    await expect(invalidSlot.createSnapshot()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const invalidHash = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({
        getSlot: 10,
        getLatestBlockhash: { value: { blockhash: 'short' } },
      }),
    );
    await expect(invalidHash.createSnapshot()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('combines configured and unconfigured health in stable id order', async () => {
    const adapter = new EvmLedgerAdapter(
      { id: 'z-configured', chainId: 1, chainName: 'Ethereum' },
      new FakeJsonRpcTransport({ eth_chainId: '0x1', eth_blockNumber: '0x10' }),
    );
    const registry = new ProviderRegistry(
      [adapter],
      [{ id: 'a-unconfigured', ledger: 'BITCOIN', capabilities: ['CURRENT_STATE'] }],
    );
    const health = await registry.health();
    expect(health.map((item) => item.id)).toEqual(['a-unconfigured', 'z-configured']);
    expect(health[0]).toMatchObject({
      status: 'UNCONFIGURED',
      head: { state: 'unavailable', reason: 'PROVIDER_UNCONFIGURED' },
    });
  });
});
