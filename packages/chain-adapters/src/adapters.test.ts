import { describe, expect, it } from 'vitest';

import { BitcoinUtxoLedgerAdapter } from './bitcoin.js';
import { ProviderError } from './errors.js';
import { EvmLedgerAdapter } from './evm.js';
import { ProviderRegistry } from './registry.js';
import { SolanaLedgerAdapter } from './solana.js';
import type {
  JsonRpcTransport,
  RestTransport,
  TransportObservation,
  TransportReadOptions,
} from './transport.js';

class FakeJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId = 'fake';
  readonly calls: Array<{
    method: string;
    params: readonly unknown[];
    options?: TransportReadOptions;
  }> = [];
  readonly #responses: Record<string, unknown>;
  readonly #sourceIds: Record<string, string>;

  constructor(responses: Record<string, unknown>, sourceIds: Record<string, string> = {}) {
    this.#responses = responses;
    this.#sourceIds = sourceIds;
  }

  async request<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<T> {
    this.calls.push({ method, params, ...(options.cacheMode === undefined ? {} : { options }) });
    const response = this.#responses[method];
    if (response instanceof Error) throw response;
    return response as T;
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    return {
      value: await this.request<T>(method, params, options),
      endpointId: this.#sourceIds[method] ?? this.endpointId,
    };
  }
}

class FakeRestTransport implements RestTransport {
  readonly endpointId = 'fake-esplora';
  readonly responses: Record<string, unknown>;
  readonly calls: Array<{
    kind: 'json' | 'text';
    path: string;
    options?: TransportReadOptions;
  }> = [];
  readonly #sourceIds: Record<string, string>;

  constructor(responses: Record<string, unknown>, sourceIds: Record<string, string> = {}) {
    this.responses = responses;
    this.#sourceIds = sourceIds;
  }

  async getText(path: string, options: TransportReadOptions = {}): Promise<string> {
    this.calls.push({
      kind: 'text',
      path,
      ...(options.cacheMode === undefined ? {} : { options }),
    });
    return String(this.responses[path]);
  }

  async getTextSourced(
    path: string,
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<string>> {
    return {
      value: await this.getText(path, options),
      endpointId: this.#sourceIds[path] ?? this.endpointId,
    };
  }

  async getJson<T>(path: string, options: TransportReadOptions = {}): Promise<T> {
    this.calls.push({
      kind: 'json',
      path,
      ...(options.cacheMode === undefined ? {} : { options }),
    });
    return this.responses[path] as T;
  }

  async getJsonSourced<T>(
    path: string,
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    return {
      value: await this.getJson<T>(path, options),
      endpointId: this.#sourceIds[path] ?? this.endpointId,
    };
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

  it('creates a replayable Bitcoin snapshot from a height-pinned hash endpoint', async () => {
    const blockHash = 'a'.repeat(64);
    const previousBlockHash = 'c'.repeat(64);
    const transport = new FakeRestTransport(
      {
        '/blocks/tip/height': '840000',
        '/block-height/840000': blockHash,
        [`/block/${blockHash}`]: {
          id: blockHash,
          height: 840000,
          previousblockhash: previousBlockHash,
        },
        '/blocks/tip/hash': 'b'.repeat(64),
      },
      {
        '/blocks/tip/height': 'esplora-a',
        '/block-height/840000': 'esplora-b',
        [`/block/${blockHash}`]: 'esplora-c',
      },
    );
    const adapter = new BitcoinUtxoLedgerAdapter({ id: 'esplora' }, transport);
    await expect(adapter.createSnapshot()).resolves.toMatchObject({
      ledger: 'BITCOIN',
      height: '840000',
      blockHash,
      previousBlockHash,
      finality: 'best-chain',
      providerVersions: {
        'esplora-a': 'esplora-http',
        'esplora-b': 'esplora-http',
        'esplora-c': 'esplora-http',
      },
    });
    expect(transport.calls).toEqual([
      {
        kind: 'text',
        path: '/blocks/tip/height',
        options: { cacheMode: 'bypass' },
      },
      {
        kind: 'text',
        path: '/block-height/840000',
        options: { cacheMode: 'bypass' },
      },
      {
        kind: 'json',
        path: `/block/${blockHash}`,
        options: { cacheMode: 'bypass' },
      },
    ]);
  });

  it('creates a finalized Solana snapshot', async () => {
    const transport = new FakeJsonRpcTransport(
      {
        getSlot: 300_000_000,
        getBlock: {
          blockhash: '11111111111111111111111111111111',
          previousBlockhash: '22222222222222222222222222222222',
          parentSlot: 299_999_999,
          blockTime: 1_700_000_000,
        },
      },
      { getSlot: 'solana-a', getBlock: 'solana-b' },
    );
    const adapter = new SolanaLedgerAdapter({ id: 'solana', commitment: 'finalized' }, transport);
    await expect(adapter.createSnapshot()).resolves.toMatchObject({
      ledger: 'SOLANA',
      slot: '300000000',
      commitment: 'finalized',
      blockhash: '11111111111111111111111111111111',
      parentSlot: '299999999',
      previousBlockhash: '22222222222222222222222222222222',
      blockTimestamp: '2023-11-14T22:13:20.000Z',
      providerVersions: {
        'solana-a': 'solana-json-rpc',
        'solana-b': 'solana-json-rpc',
      },
    });
    expect(transport.calls).toEqual([
      {
        method: 'getSlot',
        params: [{ commitment: 'finalized' }],
        options: { cacheMode: 'bypass' },
      },
      {
        method: 'getBlock',
        params: [
          300_000_000,
          {
            commitment: 'finalized',
            transactionDetails: 'none',
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ],
        options: { cacheMode: 'bypass' },
      },
    ]);
  });

  it('creates a replayable EVM snapshot and forwards block-pinned reads', async () => {
    const transport = new FakeJsonRpcTransport(
      {
        eth_getBlockByNumber: {
          number: '0x10',
          hash: '0x' + 'a'.repeat(64),
          parentHash: '0x' + 'b'.repeat(64),
          timestamp: '0x65',
        },
        eth_getBalance: '0x2a',
        eth_getCode: '0x6000',
      },
      {
        eth_getBlockByNumber: 'evm-anchor',
        eth_getBalance: 'evm-balance',
        eth_getCode: 'evm-code',
      },
    );
    const adapter = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum', adapterVersion: 'fixture' },
      transport,
    );
    await expect(adapter.createSnapshot()).resolves.toMatchObject({
      ledger: 'EVM',
      chainId: 'eip155:1',
      blockNumber: '16',
      blockHash: '0x' + 'a'.repeat(64),
      parentBlockHash: '0x' + 'b'.repeat(64),
      finality: 'finalized',
      adapterVersions: { evm: 'fixture' },
      providerVersions: { 'evm-anchor': 'json-rpc' },
    });
    await expect(adapter.getBalanceObservation('0xabc', '0x10')).resolves.toEqual({
      value: '0x2a',
      endpointId: 'evm-balance',
    });
    await expect(adapter.getCodeObservation('0xabc', '0x10')).resolves.toEqual({
      value: '0x6000',
      endpointId: 'evm-code',
    });
    expect(transport.calls.at(-1)).toEqual({
      method: 'eth_getCode',
      params: ['0xabc', '0x10'],
    });
    expect(transport.calls[0]).toEqual({
      method: 'eth_getBlockByNumber',
      params: ['finalized', false],
      options: { cacheMode: 'bypass' },
    });
  });

  it('reads ledger anchors at explicit historical positions', async () => {
    const evmTransport = new FakeJsonRpcTransport({
      eth_getBlockByNumber: {
        number: '0xf',
        hash: `0x${'a'.repeat(64)}`,
        parentHash: `0x${'b'.repeat(64)}`,
        timestamp: '0x65',
      },
    });
    const evm = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum' },
      evmTransport,
    );
    await expect(evm.readAnchorAt('15')).resolves.toMatchObject({
      anchor: {
        position: '15',
        parentPosition: '14',
        hash: `0x${'a'.repeat(64)}`,
      },
    });
    expect(evmTransport.calls[0]).toMatchObject({
      method: 'eth_getBlockByNumber',
      params: ['0xf', false],
      options: { cacheMode: 'bypass' },
    });

    const bitcoinHash = 'c'.repeat(64);
    const bitcoinTransport = new FakeRestTransport({
      '/block-height/42': bitcoinHash,
      [`/block/${bitcoinHash}`]: {
        id: bitcoinHash,
        height: 42,
        previousblockhash: 'd'.repeat(64),
      },
    });
    const bitcoin = new BitcoinUtxoLedgerAdapter({ id: 'esplora' }, bitcoinTransport);
    await expect(bitcoin.readAnchorAt('42')).resolves.toMatchObject({
      anchor: { position: '42', parentPosition: '41', hash: bitcoinHash },
    });

    const solanaTransport = new FakeJsonRpcTransport({
      getBlock: {
        blockhash: '1'.repeat(32),
        previousBlockhash: '2'.repeat(32),
        parentSlot: 40,
        blockTime: null,
      },
    });
    const solana = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      solanaTransport,
    );
    await expect(solana.readAnchorAt('42')).resolves.toMatchObject({
      anchor: { position: '42', parentPosition: '40', hash: '1'.repeat(32) },
    });
    expect(solanaTransport.calls[0]).toMatchObject({
      method: 'getBlock',
      params: [42, expect.objectContaining({ commitment: 'finalized' })],
      options: { cacheMode: 'bypass' },
    });

    await expect(evm.readAnchorAt('-1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(bitcoin.readAnchorAt('-1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(solana.readAnchorAt('-1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects non-canonical EVM quantities and malformed bytecode', async () => {
    const invalidBalance = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum' },
      new FakeJsonRpcTransport({ eth_getBalance: '0x00' }),
    );
    await expect(invalidBalance.getBalance('0xabc', 'finalized')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    const invalidCode = new EvmLedgerAdapter(
      { id: 'ethereum', chainId: 1, chainName: 'Ethereum' },
      new FakeJsonRpcTransport({ eth_getCode: '0x0' }),
    );
    await expect(invalidCode.getCode('0xabc', 'finalized')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
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
        '/block-height/-1': 'bad',
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
        '/block-height/840000': 'bad',
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

  it('normalizes lossless Solana account quantities and rejects stale or incomplete contexts', async () => {
    const response = {
      context: { slot: 12, apiVersion: '3.1.8' },
      value: {
        data: ['', 'base64'],
        executable: false,
        lamports: '18446744073709551615',
        owner: '11111111111111111111111111111111',
        rentEpoch: '18446744073709551615',
        space: 0,
      },
    };
    const adapter = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({ getAccountInfo: response }),
    );
    await expect(adapter.getAccountInfo('11111111111111111111111111111111', 12)).resolves.toEqual(
      response,
    );

    const stale = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({
        getAccountInfo: { context: { slot: 11 }, value: null },
      }),
    );
    await expect(
      stale.getAccountInfo('11111111111111111111111111111111', 12),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const missing = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({ getAccountInfo: { context: { slot: 12 } } }),
    );
    await expect(
      missing.getAccountInfo('11111111111111111111111111111111', 12),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects malformed Solana snapshot state', async () => {
    const invalidSlot = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({
        getSlot: Number.MAX_SAFE_INTEGER + 1,
        getBlock: {
          blockhash: '1'.repeat(32),
          previousBlockhash: '2'.repeat(32),
          parentSlot: 1,
          blockTime: null,
        },
      }),
    );
    await expect(invalidSlot.createSnapshot()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const invalidHash = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({
        getSlot: 10,
        getBlock: {
          blockhash: 'short',
          previousBlockhash: '2'.repeat(32),
          parentSlot: 9,
          blockTime: null,
        },
      }),
    );
    await expect(invalidHash.createSnapshot()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const missingBlock = new SolanaLedgerAdapter(
      { id: 'solana', commitment: 'finalized' },
      new FakeJsonRpcTransport({ getSlot: 10, getBlock: null }),
    );
    await expect(missingBlock.createSnapshot()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
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
