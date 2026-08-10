import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BitcoinUtxoLedgerAdapter,
  EvmLedgerAdapter,
  ProviderRegistry,
  SolanaLedgerAdapter,
  type JsonRpcTransport,
  type RestTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import {
  AnchorDataQualityService,
  MemoryDataQualityRepository,
  type AnchorReconciliationTarget,
  type ChainAnchorReader,
} from '@zerotrace/data-quality';
import { createEvidence, EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type ChainAnchorRead,
  type ComparisonObservation,
} from '@zerotrace/schemas';
import { StorageError, type EvidenceRepository } from '@zerotrace/storage';
import { encodeAbiParameters, toEventSelector } from 'viem';

import { createApp } from '../../apps/api/src/app.js';
import type { AppConfig } from '../../apps/api/src/config.js';
import type { AppRuntime } from '../../apps/api/src/runtime.js';

const config: AppConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 8080,
  corsOrigins: ['http://localhost:5173'],
  logLevel: 'silent',
  requestTimeoutMs: 1_000,
  healthCacheTtlMs: 0,
  dataQualityMinSources: 2,
  providerAllowedHosts: [],
  allowPrivateProviderUrls: false,
  providerResilience: {
    maxAttempts: 3,
    retryBaseDelayMs: 0,
    retryMaxDelayMs: 0,
    circuitFailureThreshold: 5,
    circuitResetMs: 30_000,
    cacheTtlMs: 0,
    cacheMaxEntries: 100,
  },
  ethereumRpcUrls: [],
  ethereumChainId: 1,
  ethereumSnapshotTag: 'finalized',
  ethereumRequestsPerSecond: 0,
  bscRpcUrls: [],
  bscChainId: 56,
  bscSnapshotTag: 'finalized',
  bscRequestsPerSecond: 0,
  bitcoinEsploraUrls: [],
  bitcoinEsploraRequestsPerSecond: 0,
  solanaRpcUrls: [],
  solanaRequestsPerSecond: 0,
  solanaCommitment: 'finalized',
  gmgnConfigured: false,
  jupiterConfigured: false,
  etherscanConfigured: false,
  duneConfigured: false,
  nansenConfigured: false,
  arkhamConfigured: false,
};

function testDataQuality(
  evidenceLedger: EvidenceLedger,
  targets: readonly AnchorReconciliationTarget[] = [
    { ledger: 'EVM', chainId: 'eip155:1', readers: [] },
    { ledger: 'EVM', chainId: 'eip155:56', readers: [] },
    { ledger: 'BITCOIN', chainId: 'bitcoin-mainnet', readers: [] },
    { ledger: 'SOLANA', chainId: 'solana-mainnet', readers: [] },
  ],
): AnchorDataQualityService {
  return new AnchorDataQualityService({
    targets,
    repository: new MemoryDataQualityRepository(),
    evidence: {
      put: async (evidence, sourceEvidenceIds = [], snapshot) =>
        evidenceLedger.get(evidence.id) ??
        evidenceLedger.add(evidence, sourceEvidenceIds, snapshot),
    },
    requiredSources: config.dataQualityMinSources,
  });
}

class FakeTransport implements JsonRpcTransport {
  readonly endpointId = 'ethereum-rpc';
  readonly #responses: Record<string, unknown>;
  readonly #sourceIds: Record<string, string>;

  constructor(responses: Record<string, unknown>, sourceIds: Record<string, string> = {}) {
    this.#responses = responses;
    this.#sourceIds = sourceIds;
  }

  async request<T>(method: string): Promise<T> {
    return this.#responses[method] as T;
  }

  async requestSourced<T>(
    method: string,
    _params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    return {
      value: this.#responses[method] as T,
      endpointId: this.#sourceIds[method] ?? this.endpointId,
    };
  }
}

class FlapQuoteTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-quote-fixture';
  readonly #callResults: unknown[];

  constructor(callResults: unknown[]) {
    this.#callResults = [...callResults];
  }

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    return (await this.requestSourced<T>(method, params)).value;
  }

  async requestSourced<T>(
    method: string,
    _params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    if (method === 'eth_getBlockByNumber') {
      return {
        value: {
          number: '0x10',
          hash: `0x${'6'.repeat(64)}`,
          parentHash: `0x${'5'.repeat(64)}`,
          timestamp: '0x65',
        } as T,
        endpointId: 'bsc-anchor',
      };
    }
    if (method === 'eth_getCode') {
      return { value: '0x6000' as T, endpointId: 'bsc-code' };
    }
    if (method === 'eth_call') {
      return { value: this.#callResults.shift() as T, endpointId: 'bsc-call' };
    }
    throw new Error(`Unexpected Flap quote fixture method ${method}`);
  }
}

class FlapEventTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-event-fixture';

  constructor(readonly receiptValue: unknown) {}

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    return (await this.requestSourced<T>(method, params)).value;
  }

  async requestSourced<T>(
    method: string,
    _params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    if (method === 'eth_getTransactionReceipt') {
      return { value: this.receiptValue as T, endpointId: 'bsc-receipt' };
    }
    if (method === 'eth_getLogs') {
      const receipt = this.receiptValue as { logs: unknown[] };
      return { value: receipt.logs as T, endpointId: 'bsc-logs' };
    }
    if (method === 'eth_getBlockByNumber') {
      return {
        value: {
          number: '0x10',
          hash: `0x${'6'.repeat(64)}`,
          parentHash: `0x${'5'.repeat(64)}`,
          timestamp: '0x65',
        } as T,
        endpointId: 'bsc-anchor',
      };
    }
    throw new Error(`Unexpected Flap event fixture method ${method}`);
  }
}

class FakeRestTransport implements RestTransport {
  readonly endpointId = 'bitcoin-esplora';
  readonly #responses: Record<string, unknown>;
  readonly #sourceIds: Record<string, string>;

  constructor(responses: Record<string, unknown>, sourceIds: Record<string, string> = {}) {
    this.#responses = responses;
    this.#sourceIds = sourceIds;
  }

  async getText(path: string): Promise<string> {
    return String(this.#responses[path]);
  }

  async getJson<T>(path: string): Promise<T> {
    return this.#responses[path] as T;
  }

  async getTextSourced(path: string): Promise<TransportObservation<string>> {
    return {
      value: String(this.#responses[path]),
      endpointId: this.#sourceIds[path] ?? this.endpointId,
    };
  }

  async getJsonSourced<T>(path: string): Promise<TransportObservation<T>> {
    return {
      value: this.#responses[path] as T,
      endpointId: this.#sourceIds[path] ?? this.endpointId,
    };
  }
}

function runtimeWithEvm(): AppRuntime {
  const evm = new EvmLedgerAdapter(
    { id: 'ethereum-rpc', chainId: 1, chainName: 'Ethereum' },
    new FakeTransport(
      {
        eth_chainId: '0x1',
        eth_blockNumber: '0x10',
        eth_getBlockByNumber: {
          number: '0x10',
          hash: '0x' + 'a'.repeat(64),
          parentHash: '0x' + '9'.repeat(64),
          timestamp: '0x65',
        },
        eth_getBalance: '0x0',
        eth_getCode: '0x',
      },
      {
        eth_getBlockByNumber: 'ethereum-anchor',
        eth_getBalance: 'ethereum-state-a',
        eth_getCode: 'ethereum-state-b',
      },
    ),
  );
  const evidenceLedger = new EvidenceLedger();
  return {
    providerRegistry: new ProviderRegistry([evm]),
    evmAdapters: new Map([[1, evm]]),
    evidenceLedger,
    dataQuality: testDataQuality(evidenceLedger),
    ingestionStorage: {},
  };
}

const defaultSolanaAccount = {
  data: ['', 'base64'],
  lamports: 123,
  owner: '11111111111111111111111111111111',
  executable: false,
  rentEpoch: 0,
  space: 0,
};

const fixtureEvmTransactionHash = `0x${'1'.repeat(64)}`;
const fixtureBitcoinTransactionId = 'c'.repeat(64);
const fixtureSolanaSignature =
  '4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9';
const fixtureFlapToken = `0x${'a'.repeat(40)}`;
const fixtureFlapEventTransactionHash = `0x${'7'.repeat(64)}`;

function fixtureFlapCreationReceipt() {
  const portal = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0';
  const data = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'string' },
      { type: 'string' },
      { type: 'string' },
    ],
    [
      1_700_000_000n,
      `0x${'c'.repeat(40)}`,
      7n,
      fixtureFlapToken,
      'Fixture Token',
      'FIX',
      'ipfs://fixture',
    ],
  );
  return {
    transactionHash: fixtureFlapEventTransactionHash,
    blockHash: `0x${'6'.repeat(64)}`,
    blockNumber: '0x10',
    transactionIndex: '0x1',
    from: `0x${'c'.repeat(40)}`,
    to: portal,
    contractAddress: null,
    cumulativeGasUsed: '0x100',
    gasUsed: '0x80',
    status: '0x1',
    logs: [
      {
        address: portal,
        blockHash: `0x${'6'.repeat(64)}`,
        blockNumber: '0x10',
        transactionHash: fixtureFlapEventTransactionHash,
        transactionIndex: '0x1',
        logIndex: '0x0',
        data,
        topics: [
          toEventSelector('TokenCreated(uint256,address,uint256,address,string,string,string)'),
        ],
        removed: false,
      },
    ],
  };
}

function fixtureFlapV8SafeResult() {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'status', type: 'uint8' },
          { name: 'reserve', type: 'uint256' },
          { name: 'circulatingSupply', type: 'uint256' },
          { name: 'price', type: 'uint256' },
          { name: 'tokenVersion', type: 'uint8' },
          { name: 'r', type: 'uint256' },
          { name: 'h', type: 'uint256' },
          { name: 'k', type: 'uint256' },
          { name: 'dexSupplyThresh', type: 'uint256' },
          { name: 'quoteTokenAddress', type: 'address' },
          { name: 'nativeToQuoteSwapEnabled', type: 'bool' },
          { name: 'extensionID', type: 'bytes32' },
          { name: 'buyTaxRate', type: 'uint256' },
          { name: 'sellTaxRate', type: 'uint256' },
          { name: 'pool', type: 'address' },
          { name: 'progress', type: 'uint256' },
          { name: 'lpFeeProfile', type: 'uint8' },
          { name: 'dexId', type: 'uint8' },
        ],
      },
    ],
    [
      {
        status: 1,
        reserve: 1_000n,
        circulatingSupply: 750n,
        price: 2_000n,
        tokenVersion: 6,
        r: 100n,
        h: 200n,
        k: 300n,
        dexSupplyThresh: 1_000n,
        quoteTokenAddress: `0x${'0'.repeat(40)}`,
        nativeToQuoteSwapEnabled: true,
        extensionID: `0x${'0'.repeat(64)}`,
        buyTaxRate: 300n,
        sellTaxRate: 700n,
        pool: `0x${'0'.repeat(40)}`,
        progress: 750_000_000_000_000_000n,
        lpFeeProfile: 0,
        dexId: 0,
      },
    ],
  );
}

function runtimeWithAllLedgers(solanaAccountValue: unknown = defaultSolanaAccount): AppRuntime {
  const evm = new EvmLedgerAdapter(
    { id: 'ethereum-rpc', chainId: 1, chainName: 'Ethereum' },
    new FakeTransport({
      eth_chainId: '0x1',
      eth_blockNumber: '0x10',
      eth_getBlockByNumber: {
        number: '0x10',
        hash: '0x' + 'a'.repeat(64),
        parentHash: '0x' + '9'.repeat(64),
        timestamp: '0x65',
      },
      eth_getBalance: '0x0',
      eth_getCode: '0x6000',
      eth_getTransactionByHash: {
        hash: fixtureEvmTransactionHash,
        blockHash: '0x' + 'a'.repeat(64),
        blockNumber: '0x10',
        transactionIndex: '0x2',
        from: `0x${'3'.repeat(40)}`,
        to: `0x${'4'.repeat(40)}`,
        value: '0x2a',
        nonce: '0x1',
        gas: '0x5208',
        input: '0x',
      },
      eth_getTransactionReceipt: {
        transactionHash: fixtureEvmTransactionHash,
        blockHash: '0x' + 'a'.repeat(64),
        blockNumber: '0x10',
        transactionIndex: '0x2',
        from: `0x${'3'.repeat(40)}`,
        to: `0x${'4'.repeat(40)}`,
        contractAddress: null,
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        status: '0x1',
        logs: [],
      },
    }),
  );
  const bitcoin = new BitcoinUtxoLedgerAdapter(
    { id: 'bitcoin-esplora' },
    new FakeRestTransport(
      {
        '/blocks/tip/height': '840000',
        '/block-height/840000': 'b'.repeat(64),
        [`/block/${'b'.repeat(64)}`]: {
          id: 'b'.repeat(64),
          height: 840000,
          previousblockhash: 'a'.repeat(64),
        },
        '/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4': {
          address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
          chain_stats: {
            funded_txo_count: 2,
            funded_txo_sum: 500,
            spent_txo_count: 1,
            spent_txo_sum: 200,
            tx_count: 3,
          },
          mempool_stats: {
            funded_txo_count: 1,
            funded_txo_sum: 10,
            spent_txo_count: 1,
            spent_txo_sum: 20,
            tx_count: 2,
          },
        },
        [`/tx/${fixtureBitcoinTransactionId}`]: {
          txid: fixtureBitcoinTransactionId,
          version: 2,
          locktime: 0,
          size: 120,
          weight: 480,
          fee: 200,
          vin: [{}],
          vout: [
            {
              scriptpubkey: '0014' + '1'.repeat(40),
              scriptpubkey_type: 'v0_p2wpkh',
              scriptpubkey_address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
              value: 100,
            },
          ],
          status: {
            confirmed: true,
            block_height: 840000,
            block_hash: 'b'.repeat(64),
            block_time: 1_700_000_000,
          },
        },
        [`/tx/${fixtureBitcoinTransactionId}/outspend/0`]: {
          spent: true,
          txid: 'd'.repeat(64),
          vin: 0,
          status: { confirmed: false },
        },
      },
      {
        '/blocks/tip/height': 'bitcoin-anchor-a',
        '/block-height/840000': 'bitcoin-anchor-b',
        [`/block/${'b'.repeat(64)}`]: 'bitcoin-anchor-b',
        '/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4': 'bitcoin-state',
      },
    ),
  );
  const solana = new SolanaLedgerAdapter(
    { id: 'solana-rpc', commitment: 'finalized' },
    new FakeTransport(
      {
        getHealth: 'ok',
        getSlot: 300_000_000,
        getBlock: {
          blockhash: '11111111111111111111111111111111',
          previousBlockhash: '22222222222222222222222222222222',
          parentSlot: 299_999_999,
          blockTime: 1_700_000_000,
        },
        getAccountInfo: {
          context: { slot: 300_000_000 },
          value: solanaAccountValue,
        },
        getTransaction: {
          slot: 300_000_000,
          blockTime: 1_700_000_000,
          version: 0,
          transaction: {
            signatures: [fixtureSolanaSignature],
            message: { accountKeys: [], instructions: [], recentBlockhash: '1'.repeat(32) },
          },
          meta: { err: null, fee: 5000 },
        },
      },
      {
        getSlot: 'solana-anchor-a',
        getBlock: 'solana-anchor-b',
        getAccountInfo: 'solana-state',
      },
    ),
  );
  const evidenceLedger = new EvidenceLedger();
  return {
    providerRegistry: new ProviderRegistry([evm, bitcoin, solana]),
    evmAdapters: new Map([[1, evm]]),
    bitcoinAdapter: bitcoin,
    solanaAdapter: solana,
    evidenceLedger,
    dataQuality: testDataQuality(evidenceLedger),
    ingestionStorage: {},
  };
}

function repository(overrides: Partial<EvidenceRepository> = {}): EvidenceRepository {
  return {
    put: vi.fn(async (evidence, sourceEvidenceIds = [], snapshot) => ({
      evidence,
      sourceEvidenceIds: [...sourceEvidenceIds].sort(),
      ...(snapshot === undefined ? {} : { snapshot }),
    })),
    get: vi.fn(async () => undefined),
    drilldown: vi.fn(async () => []),
    health: vi.fn(async () => ({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
      checkedAt: new Date().toISOString(),
    })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

const fixtureSnapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:1',
  blockNumber: '16',
  blockHash: '0x' + 'a'.repeat(64),
  finality: 'finalized' as const,
  capturedAt: '2026-08-09T00:00:00.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { evm: '0.1.0' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'none',
};

function fixtureMetadata(evidenceId: string) {
  return {
    snapshot: fixtureSnapshot,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 0,
    simulationCoverage: 1,
    freshness: '2026-08-09T00:00:00.000Z',
    sourceSet: ['fixture'],
    modelVersion: 'fixture-v0.1.0',
    confidence: 1,
    evidenceIds: [evidenceId],
  };
}

function evmAnchorReader(source: string, blockHash: string): ChainAnchorReader {
  const observedAt = '2026-08-10T01:00:00.000Z';
  const parentHash = '0x' + '9'.repeat(64);
  const read: ChainAnchorRead = {
    anchor: {
      ledger: 'EVM',
      chainId: 'eip155:1',
      position: '100',
      hash: blockHash,
      parentPosition: '99',
      parentHash,
      finality: 'finalized',
      source,
      observedAt,
    },
    snapshot: {
      ...fixtureSnapshot,
      blockNumber: '100',
      blockHash,
      parentBlockHash: parentHash,
      capturedAt: observedAt,
      providerVersions: { [source]: 'json-rpc' },
      configHash: hashPayload({ source }),
    },
    payload: { number: '0x64', hash: blockHash, parentHash },
  };
  return {
    sourceId: source,
    ledger: 'EVM',
    chainId: 'eip155:1',
    readHead: async () => read,
    readAt: async () => read,
  };
}

function addFixtureEvidence(runtime: AppRuntime, blockOrSlot = '16') {
  const evidence = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:1',
    kind: 'CONTRACT_STATE',
    source: 'fixture',
    locator: 'pool:pool-1@' + blockOrSlot,
    payload: { baseReserve: '1000', quoteReserve: '1000', feeBps: '0', blockOrSlot },
    blockOrSlot,
    finality: 'finalized',
    summary: 'Pool reserves at fixture block.',
  });
  runtime.evidenceLedger.add(evidence, [], { ...fixtureSnapshot, blockNumber: blockOrSlot });
  return evidence;
}

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('ZeroTrace API contract', () => {
  it('advertises the read-only runtime boundary', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: 'UP', readOnly: true });
  });

  it('classifies identifiers without doing a network lookup', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=0x52908400098527886e0f7030069857d2e4169ee7',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().candidates[0]).toMatchObject({ ledger: 'EVM', type: 'ADDRESS' });
  });

  it('binds a subject fact to a snapshot and evidence record', async () => {
    const runtime = runtimeWithEvm();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/0x52908400098527886e0f7030069857d2e4169ee7?chainId=eip155:1',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.facts.nativeBalanceAtomic).toEqual({ state: 'known', value: '0' });
    expect(body.metadata.snapshot).toMatchObject({
      ledger: 'EVM',
      blockNumber: '16',
      finality: 'finalized',
      providerVersions: { 'ethereum-anchor': 'json-rpc' },
    });
    expect(body.metadata.sourceSet).toEqual([
      'ethereum-anchor',
      'ethereum-state-a',
      'ethereum-state-b',
    ]);
    expect(body.evidence[0]).toMatchObject({
      finality: 'finalized',
      source: 'ethereum-state-a|ethereum-state-b',
    });
    expect(body.evidence).toHaveLength(1);
    expect(runtime.evidenceLedger.get(body.evidence[0].id)).toBeDefined();
  });

  it('persists subject Evidence with its replayable Snapshot when durable storage is configured', async () => {
    const runtime = runtimeWithEvm();
    const durable = repository();
    runtime.evidenceRepository = durable;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/0x52908400098527886e0f7030069857d2e4169ee7?chainId=eip155:1',
    });

    expect(response.statusCode).toBe(200);
    expect(durable.put).toHaveBeenCalledOnce();
    expect(vi.mocked(durable.put).mock.calls[0]?.[2]).toMatchObject({
      ledger: 'EVM',
      blockNumber: '16',
    });
  });

  it('returns explicit unknowns for an engine with no evidence', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/entities/resolve',
      payload: {
        subjectA: 'a',
        subjectB: 'b',
        features: [],
        metadata: {
          snapshot: null,
          dataCoverage: 0,
          sourceCoverage: 0,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: null,
          sourceSet: [],
          modelVersion: 'entity-v0.1.0',
          confidence: 0,
          evidenceIds: [],
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().sameControllerProbability).toEqual({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
  });

  it('marks unfinished capabilities as 501 instead of returning placeholders', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/claims' });
    expect(response.statusCode).toBe(501);
    expect(response.json().status).toMatchObject({ state: 'unknown', reason: 'NOT_IMPLEMENTED' });
  });

  it('rejects an RV calculation without a snapshot and ledger-backed evidence', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: ['ev_missing'],
        },
        inputQuantity: '100',
        metadata: {
          snapshot: null,
          dataCoverage: 1,
          sourceCoverage: 1,
          historyCoverage: 0,
          simulationCoverage: 1,
          freshness: null,
          sourceSet: ['fixture'],
          modelVersion: 'rv-v0.1.0',
          confidence: 1,
          evidenceIds: ['ev_missing'],
        },
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNGROUNDED_ANALYSIS');
  });

  it('persists derived RV evidence and supports source drilldown', async () => {
    const runtime = runtimeWithEvm();
    const sourceEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'CONTRACT_STATE',
      source: 'fixture',
      locator: 'pool:pool-1@16',
      payload: { baseReserve: '1000', quoteReserve: '1000', feeBps: '0' },
      blockOrSlot: '16',
      finality: 'finalized',
      summary: 'Pool reserves at fixture block.',
    });
    runtime.evidenceLedger.add(sourceEvidence, [], fixtureSnapshot);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: [sourceEvidence.id],
        },
        inputQuantity: '100',
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:1',
            blockNumber: '16',
            blockHash: '0x' + 'a'.repeat(64),
            finality: 'finalized',
            capturedAt: '2026-08-09T00:00:00.000Z',
            providerVersions: { fixture: '1' },
            adapterVersions: { evm: '0.1.0' },
            configHash: 'b'.repeat(64),
            entityModelVersion: 'entity-v0.1.0',
            labelSnapshot: 'none',
          },
          dataCoverage: 1,
          sourceCoverage: 1,
          historyCoverage: 0,
          simulationCoverage: 1,
          freshness: '2026-08-09T00:00:00.000Z',
          sourceSet: ['fixture'],
          modelVersion: 'rv-v0.1.0',
          confidence: 1,
          evidenceIds: [sourceEvidence.id],
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.realizableValue).toEqual({ state: 'known', value: '91' });
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0]).toMatchObject({ kind: 'DERIVED_FEATURE', ledger: 'EVM' });
    expect(runtime.evidenceLedger.drilldown(body.evidence[0].id)).toHaveLength(2);
  });

  it('reports system, chain, platform, metrics, and provider capability truth', async () => {
    const app = await createApp({ config, runtime: runtimeWithAllLedgers(), logger: false });
    apps.push(app);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'UP', readOnly: true });
    expect(ready.json().providers).toHaveLength(3);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({
      status: 'UP',
      readOnly: true,
      ingestionStorage: { status: 'UNCONFIGURED', configured: 0, required: 3 },
    });

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().boundaries).toEqual({
      transactionSigning: 'FORBIDDEN',
      transactionBroadcasting: 'FORBIDDEN',
      privateKeyStorage: 'FORBIDDEN',
    });
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'finalized-historical-ingestion',
        status: 'STORAGE_REQUIRED',
      }),
    );

    const chains = await app.inject({ method: 'GET', url: '/api/v1/chains' });
    expect(chains.json().chains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chainId: 'eip155:1', configured: true }),
        expect.objectContaining({ chainId: 'bitcoin-mainnet', configured: true }),
        expect.objectContaining({ chainId: 'solana-mainnet', configured: true }),
      ]),
    );

    const platforms = await app.inject({ method: 'GET', url: '/api/v1/platforms' });
    expect(platforms.json()).toMatchObject({ gmgnConfigured: false });
    expect(platforms.json().platforms.length).toBeGreaterThan(5);

    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain('zerotrace_http_requests_total');
  });

  it('surfaces cross-source anchor disagreement as Unknown with Evidence-linked alerts', async () => {
    const runtime = runtimeWithEvm();
    runtime.dataQuality = testDataQuality(runtime.evidenceLedger, [
      {
        ledger: 'EVM',
        chainId: 'eip155:1',
        readers: [
          evmAnchorReader('ethereum-a', '0x' + 'a'.repeat(64)),
          evmAnchorReader('ethereum-b', '0x' + 'b'.repeat(64)),
        ],
      },
    ]);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/data-quality/anchors' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'DEGRADED',
      durable: false,
      configuredSources: { 'eip155:1': 2 },
      storage: { status: 'EPHEMERAL', backend: 'MEMORY', durable: false },
      results: [
        {
          status: 'DISAGREEMENT',
          comparisonPosition: { state: 'known', value: '100' },
          canonicalAnchor: { state: 'unknown', reason: 'CONFLICTING_SOURCES' },
          sourceIndependence: { state: 'unknown', reason: 'NOT_QUERIED' },
          metadata: { snapshot: null, sourceCoverage: 1, confidence: 1 },
          alerts: [{ kind: 'CROSS_SOURCE_DISAGREEMENT', severity: 'CRITICAL' }],
        },
      ],
    });
    const result = response.json().results[0];
    expect(result.metadata.evidenceIds.length).toBeGreaterThanOrEqual(3);
    expect(
      result.metadata.evidenceIds.every(
        (evidenceId: string) => runtime.evidenceLedger.get(evidenceId) !== undefined,
      ),
    ).toBe(true);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({
      status: 'DEGRADED',
      dataQuality: { status: 'DEGRADED' },
    });
    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'cross-source-anchor-reconciliation',
        status: 'IMPLEMENTED_EPHEMERAL_PENDING_INDEPENDENT_VALIDATION',
      }),
    );
  });

  it('reports each durable ingestion backend and degrades aggregate health on failure', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.ingestionStorage = {
      rawFacts: {
        health: vi.fn(async () => ({
          status: 'UP' as const,
          backend: 'CLICKHOUSE' as const,
          durable: true as const,
          checkedAt: new Date().toISOString(),
          table: 'zerotrace.raw_chain_facts' as const,
          logicalDeduplication: 'REPLACING_MERGE_TREE' as const,
        })),
      },
      checkpoints: {
        health: vi.fn(async () => ({
          status: 'UP' as const,
          backend: 'POSTGRES' as const,
          durable: true as const,
          checkedAt: new Date().toISOString(),
        })),
      },
      artifacts: {
        health: vi.fn(async () => ({
          status: 'DOWN' as const,
          backend: 'S3_COMPATIBLE' as const,
          durable: true as const,
          checkedAt: new Date().toISOString(),
          bucket: 'zerotrace-raw',
          versioning: true as const,
          errorCode: 'OBJECT_STORE_UNAVAILABLE' as const,
        })),
      },
    };
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'UP' });
    expect(ready.json()).not.toHaveProperty('ingestionStorage');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({
      status: 'DEGRADED',
      ingestionStorage: {
        status: 'DOWN',
        configured: 3,
        required: 3,
        rawFacts: { status: 'UP', backend: 'CLICKHOUSE' },
        checkpoints: { status: 'UP', backend: 'POSTGRES' },
        artifacts: {
          status: 'DOWN',
          backend: 'S3_COMPATIBLE',
          errorCode: 'OBJECT_STORE_UNAVAILABLE',
        },
      },
    });

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'finalized-historical-ingestion',
        status: 'IMPLEMENTED_DURABLE',
        detail: expect.stringContaining('EVM logs/traces/state diffs'),
      }),
    );
  });

  it('fails readiness explicitly when configured durable storage is down', async () => {
    const runtime = runtimeWithEvm();
    runtime.evidenceRepository = repository({
      health: vi.fn(async () => ({
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
        errorCode: 'STORAGE_UNAVAILABLE',
      })),
      put: vi.fn(async () => {
        throw new StorageError('STORAGE_UNAVAILABLE', 'Durable Evidence storage is unavailable.', {
          retryable: true,
        });
      }),
    });
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      status: 'DEGRADED',
      storage: { status: 'DOWN', durable: true, errorCode: 'STORAGE_UNAVAILABLE' },
    });
    const subject = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/0x52908400098527886e0f7030069857d2e4169ee7?chainId=eip155:1',
    });
    expect(subject.statusCode).toBe(503);
    expect(subject.json().error).toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      retryable: true,
    });
  });

  it('normalizes Bitcoin and Solana subject state with evidence', async () => {
    const runtime = runtimeWithAllLedgers();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const bitcoin = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/BITCOIN/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    });
    expect(bitcoin.statusCode).toBe(200);
    expect(bitcoin.json().facts).toMatchObject({
      confirmedBalanceSats: { state: 'known', value: '300' },
      mempoolDeltaSats: { state: 'known', value: '-10' },
      transactionCount: { state: 'known', value: '3' },
    });
    expect(bitcoin.json().metadata.snapshot).toMatchObject({
      height: '840000',
      blockHash: 'b'.repeat(64),
      finality: 'best-chain',
      providerVersions: {
        'bitcoin-anchor-a': 'esplora-http',
        'bitcoin-anchor-b': 'esplora-http',
      },
    });
    expect(bitcoin.json().metadata.sourceSet).toEqual([
      'bitcoin-anchor-a',
      'bitcoin-anchor-b',
      'bitcoin-state',
    ]);
    expect(bitcoin.json().evidence[0].source).toBe('bitcoin-state');

    const bitcoinEvidenceId = bitcoin.json().evidence[0].id;
    const evidence = await app.inject({
      method: 'GET',
      url: '/api/v1/evidence/' + bitcoinEvidenceId,
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().evidence.ledger).toBe('BITCOIN');

    const drilldown = await app.inject({
      method: 'GET',
      url: '/api/v1/evidence/' + bitcoinEvidenceId + '/drilldown',
    });
    expect(drilldown.json().nodes).toHaveLength(1);

    const solana = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/SOLANA/11111111111111111111111111111111',
    });
    expect(solana.statusCode).toBe(200);
    expect(solana.json().facts).toMatchObject({
      exists: { state: 'known', value: true },
      lamports: { state: 'known', value: '123' },
      owner: { state: 'known', value: '11111111111111111111111111111111' },
      executable: { state: 'known', value: false },
    });
    expect(solana.json().metadata.snapshot).toMatchObject({
      slot: '300000000',
      blockhash: '11111111111111111111111111111111',
      commitment: 'finalized',
      providerVersions: {
        'solana-anchor-a': 'solana-json-rpc',
        'solana-anchor-b': 'solana-json-rpc',
      },
    });
    expect(solana.json().metadata.sourceSet).toEqual([
      'solana-anchor-a',
      'solana-anchor-b',
      'solana-state',
    ]);
    expect(solana.json().evidence[0].source).toBe('solana-state');
  });

  it('queries confirmed EVM, Bitcoin, and Solana transactions with replayable Evidence', async () => {
    const runtime = runtimeWithAllLedgers();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const evm = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/EVM/TRANSACTION/${fixtureEvmTransactionHash}?chainId=eip155:1`,
    });
    expect(evm.statusCode).toBe(200);
    expect(evm.json().facts).toMatchObject({
      status: { state: 'known', value: 'CONFIRMED' },
      blockNumber: { state: 'known', value: '16' },
      valueAtomic: { state: 'known', value: '42' },
      execution: { state: 'known', value: 'SUCCESS' },
    });
    expect(evm.json().metadata.snapshot).toMatchObject({
      ledger: 'EVM',
      blockNumber: '16',
      blockHash: `0x${'a'.repeat(64)}`,
    });
    expect(evm.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'TRANSACTION',
      'RECEIPT',
    ]);

    const bitcoin = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/BITCOIN/TRANSACTION/${fixtureBitcoinTransactionId}`,
    });
    expect(bitcoin.statusCode).toBe(200);
    expect(bitcoin.json().facts).toMatchObject({
      status: { state: 'known', value: 'CONFIRMED' },
      blockHeight: { state: 'known', value: '840000' },
      feeSats: { state: 'known', value: '200' },
      outputCount: { state: 'known', value: '1' },
    });
    expect(bitcoin.json().metadata.snapshot).toMatchObject({
      ledger: 'BITCOIN',
      height: '840000',
      blockHash: 'b'.repeat(64),
    });
    expect(bitcoin.json().evidence).toEqual([
      expect.objectContaining({ kind: 'TRANSACTION', blockOrSlot: '840000' }),
    ]);

    const solana = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/SOLANA/TRANSACTION/${fixtureSolanaSignature}`,
    });
    expect(solana.statusCode).toBe(200);
    expect(solana.json().facts).toMatchObject({
      status: { state: 'known', value: 'CONFIRMED' },
      slot: { state: 'known', value: '300000000' },
      feeLamports: { state: 'known', value: '5000' },
      execution: { state: 'known', value: 'SUCCESS' },
    });
    expect(solana.json().metadata.snapshot).toMatchObject({
      ledger: 'SOLANA',
      slot: '300000000',
      commitment: 'finalized',
    });
    expect(solana.json().evidence).toEqual([
      expect.objectContaining({ kind: 'TRANSACTION', blockOrSlot: '300000000' }),
    ]);
  });

  it('keeps a confirmed EVM transaction known when its receipt remains unavailable', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.evmAdapters.set(
      1,
      new EvmLedgerAdapter(
        { id: 'ethereum-rpc', chainId: 1, chainName: 'Ethereum' },
        new FakeTransport({
          eth_getBlockByNumber: {
            number: '0x10',
            hash: `0x${'a'.repeat(64)}`,
            parentHash: `0x${'9'.repeat(64)}`,
            timestamp: '0x65',
          },
          eth_getTransactionByHash: {
            hash: fixtureEvmTransactionHash,
            blockHash: `0x${'a'.repeat(64)}`,
            blockNumber: '0x10',
            transactionIndex: '0x2',
            from: `0x${'3'.repeat(40)}`,
            to: `0x${'4'.repeat(40)}`,
            value: '0x2a',
            nonce: '0x1',
            gas: '0x5208',
            input: '0x',
          },
          eth_getTransactionReceipt: null,
        }),
      ),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/EVM/TRANSACTION/${fixtureEvmTransactionHash}?chainId=eip155:1`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().facts).toMatchObject({
      status: { state: 'known', value: 'CONFIRMED' },
      execution: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      gasUsed: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      logCount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(response.json().evidence).toEqual([expect.objectContaining({ kind: 'TRANSACTION' })]);
  });

  it('keeps pending, mempool, and null transaction observations distinct from confirmed facts', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.evmAdapters.set(
      1,
      new EvmLedgerAdapter(
        { id: 'ethereum-rpc', chainId: 1, chainName: 'Ethereum' },
        new FakeTransport({
          eth_getBlockByNumber: {
            number: '0x10',
            hash: `0x${'a'.repeat(64)}`,
            parentHash: `0x${'9'.repeat(64)}`,
            timestamp: '0x65',
          },
          eth_getTransactionByHash: {
            hash: fixtureEvmTransactionHash,
            blockHash: null,
            blockNumber: null,
            transactionIndex: null,
            from: `0x${'3'.repeat(40)}`,
            to: null,
            value: '0x0',
            nonce: '0x1',
            gas: '0x5208',
            input: '0x',
          },
        }),
      ),
    );
    runtime.bitcoinAdapter = new BitcoinUtxoLedgerAdapter(
      { id: 'bitcoin-esplora' },
      new FakeRestTransport({
        '/blocks/tip/height': '840000',
        '/block-height/840000': 'b'.repeat(64),
        [`/block/${'b'.repeat(64)}`]: {
          id: 'b'.repeat(64),
          height: 840000,
          previousblockhash: 'a'.repeat(64),
        },
        [`/tx/${fixtureBitcoinTransactionId}`]: {
          txid: fixtureBitcoinTransactionId,
          version: 2,
          locktime: 0,
          size: 120,
          weight: 480,
          fee: 200,
          vin: [{}],
          vout: [
            {
              scriptpubkey: '0014' + '1'.repeat(40),
              scriptpubkey_type: 'v0_p2wpkh',
              value: 100,
            },
          ],
          status: { confirmed: false },
        },
      }),
    );
    runtime.solanaAdapter = new SolanaLedgerAdapter(
      { id: 'solana-rpc', commitment: 'finalized' },
      new FakeTransport({
        getTransaction: null,
        getSlot: 300_000_000,
        getBlock: {
          blockhash: '11111111111111111111111111111111',
          previousBlockhash: '22222222222222222222222222222222',
          parentSlot: 299_999_999,
          blockTime: 1_700_000_000,
        },
      }),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const evm = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/EVM/TRANSACTION/${fixtureEvmTransactionHash}?chainId=eip155:1`,
    });
    expect(evm.statusCode).toBe(200);
    expect(evm.json().facts).toMatchObject({
      status: { state: 'known', value: 'PENDING' },
      blockNumber: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      execution: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(evm.json().consistency).toBe('PENDING_OBSERVATION_AT_FINALIZED_HEAD');

    const bitcoin = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/BITCOIN/TRANSACTION/${fixtureBitcoinTransactionId}`,
    });
    expect(bitcoin.statusCode).toBe(200);
    expect(bitcoin.json().facts).toMatchObject({
      status: { state: 'known', value: 'MEMPOOL' },
      blockHeight: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(bitcoin.json().metadata.snapshot.mempoolSnapshot).toMatch(/^sha256:[0-9a-f]{64}$/);

    const solana = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/SOLANA/TRANSACTION/${fixtureSolanaSignature}`,
    });
    expect(solana.statusCode).toBe(200);
    expect(solana.json().facts.status).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(solana.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'PROVIDER_OBSERVATION',
      'NEGATIVE_EVIDENCE',
    ]);
    expect(runtime.evidenceLedger.get(solana.json().evidence[1].id)?.sourceEvidenceIds).toEqual([
      solana.json().evidence[0].id,
    ]);
  });

  it('queries Bitcoin outpoints at a tip plus mempool digest without coercing missing fields', async () => {
    const runtime = runtimeWithAllLedgers();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/BITCOIN/OUTPOINT/${fixtureBitcoinTransactionId}:0`,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().facts).toMatchObject({
      valueSats: { state: 'known', value: '100' },
      spent: { state: 'known', value: true },
      spendingTxid: { state: 'known', value: 'd'.repeat(64) },
      spendingVin: { state: 'known', value: '0' },
      spendingStatus: { state: 'known', value: 'MEMPOOL' },
    });
    expect(response.json().metadata.snapshot).toMatchObject({
      ledger: 'BITCOIN',
      height: '840000',
      mempoolSnapshot: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(response.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'TRANSACTION',
      'UTXO',
    ]);
    expect(runtime.evidenceLedger.get(response.json().evidence[0].id)).toBeDefined();
    expect(runtime.evidenceLedger.get(response.json().evidence[1].id)).toBeDefined();
  });

  it('queries EVM, Bitcoin, and Solana blocks through position or hash identifiers', async () => {
    const app = await createApp({ config, runtime: runtimeWithAllLedgers(), logger: false });
    apps.push(app);

    const fixtures = [
      {
        url: '/api/v1/ledger/EVM/BLOCK/16?chainId=eip155:1',
        expected: { ledger: 'EVM', position: '16', hash: `0x${'a'.repeat(64)}` },
      },
      {
        url: `/api/v1/ledger/BITCOIN/BLOCK/${'b'.repeat(64)}`,
        expected: { ledger: 'BITCOIN', position: '840000', hash: 'b'.repeat(64) },
      },
      {
        url: '/api/v1/ledger/SOLANA/BLOCK/300000000',
        expected: {
          ledger: 'SOLANA',
          position: '300000000',
          hash: '11111111111111111111111111111111',
        },
      },
    ];
    for (const fixture of fixtures) {
      const response = await app.inject({ method: 'GET', url: fixture.url });
      expect(response.statusCode).toBe(200);
      expect(response.json().subject).toMatchObject({
        ledger: fixture.expected.ledger,
        type: 'BLOCK',
      });
      expect(response.json().facts).toMatchObject({
        position: { state: 'known', value: fixture.expected.position },
        hash: { state: 'known', value: fixture.expected.hash },
      });
      expect(response.json().evidence).toEqual([expect.objectContaining({ kind: 'BLOCK' })]);
    }
  });

  it('inspects a Flap BSC token through versioned Portal state and replayable Evidence', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.evmAdapters.set(
      56,
      new EvmLedgerAdapter(
        {
          id: 'bsc-rpc',
          chainId: 56,
          chainName: 'BNB Smart Chain',
          snapshotBlockTag: 'finalized',
        },
        new FakeTransport(
          {
            eth_getBlockByNumber: {
              number: '0x10',
              hash: `0x${'6'.repeat(64)}`,
              parentHash: `0x${'5'.repeat(64)}`,
              timestamp: '0x65',
            },
            eth_getCode: '0x6000',
            eth_call: fixtureFlapV8SafeResult(),
          },
          {
            eth_getBlockByNumber: 'bsc-anchor',
            eth_getCode: 'bsc-code',
            eth_call: 'bsc-call',
          },
        ),
      ),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}?chainId=eip155:56&platform=flap`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      platform: 'flap',
      token: fixtureFlapToken,
      platformMatch: { state: 'known', value: true },
      state: {
        inspectionMethod: 'getTokenV8Safe',
        status: { state: 'known', value: 'TRADABLE' },
        tokenVersion: { state: 'known', value: 'TOKEN_TAXED_V3' },
      },
      launch: {
        lifecycle: 'PRIMARY_MARKET',
        circulatingSupply: { state: 'known', value: '750' },
        remainingSupply: { state: 'known', value: '250' },
        progress: { state: 'known', value: '0.75' },
        taxModel: { state: 'known', value: 'FLAP_TAX_V3' },
        currentSellCapacity: { state: 'unknown', reason: 'NOT_QUERIED' },
      },
      metadata: {
        snapshot: { chainId: 'eip155:56', blockNumber: '16' },
        sourceSet: expect.arrayContaining(['bsc-anchor', 'bsc-call', 'bsc-code']),
      },
    });
    expect(response.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'PROVIDER_OBSERVATION',
      'CONTRACT_STATE',
      'CONTRACT_STATE',
      'CONTRACT_STATE',
      'DERIVED_FEATURE',
    ]);
    const derivedId = response.json().evidence.at(-1).id;
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${derivedId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(drilldown.json().nodes).toHaveLength(5);
  });

  it('decodes a caller-supplied Flap creation transaction with explicit default provenance', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.evmAdapters.set(
      56,
      new EvmLedgerAdapter(
        {
          id: 'bsc-rpc',
          chainId: 56,
          chainName: 'BNB Smart Chain',
          snapshotBlockTag: 'finalized',
        },
        new FlapEventTransport(fixtureFlapCreationReceipt()),
      ),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}/events/${fixtureFlapEventTransactionHash}?chainId=eip155:56&platform=flap`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      platform: 'flap',
      token: fixtureFlapToken,
      transactionHash: fixtureFlapEventTransactionHash,
      platformMatch: { state: 'known', value: true },
      transactionKind: 'CREATION_CONFIGURATION',
      creation: {
        creator: `0x${'c'.repeat(40)}`,
        name: 'Fixture Token',
        symbol: 'FIX',
      },
      configuration: {
        curveAddress: {
          value: { state: 'unknown', reason: 'NOT_QUERIED' },
          source: 'OFFICIAL_DEFAULT',
        },
        curveParameter: {
          value: { state: 'known', value: '16000000000000000000' },
          source: 'OFFICIAL_DEFAULT',
        },
      },
      metadata: {
        snapshot: { chainId: 'eip155:56', blockNumber: '16' },
        modelVersion: 'flap-event-transaction-v1',
      },
    });
    expect(response.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'RECEIPT',
      'LOG',
      'PROVIDER_OBSERVATION',
      'DERIVED_FEATURE',
    ]);
    const derivedId = response.json().evidence.at(-1).id;
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${derivedId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(drilldown.json().nodes).toHaveLength(4);
  });

  it('discovers Flap events in a bounded range and keeps lifetime coverage Unknown', async () => {
    const runtime = runtimeWithAllLedgers();
    const receipt = fixtureFlapCreationReceipt();
    runtime.evmAdapters.set(
      56,
      new EvmLedgerAdapter(
        {
          id: 'bsc-rpc',
          chainId: 56,
          chainName: 'BNB Smart Chain',
          snapshotBlockTag: 'finalized',
        },
        new FlapEventTransport(receipt),
      ),
    );
    const sourceLog = receipt.logs[0];
    const sqdLogs = vi.fn(async () => ({
      endpointId: 'sqd:binance-mainnet',
      value: [
        {
          address: sourceLog.address.toLowerCase(),
          blockHash: sourceLog.blockHash,
          blockNumber: sourceLog.blockNumber,
          transactionHash: sourceLog.transactionHash,
          transactionIndex: sourceLog.transactionIndex,
          logIndex: sourceLog.logIndex,
          data: sourceLog.data,
          topics: sourceLog.topics,
          removed: false as const,
          raw: sourceLog,
        },
      ],
    }));
    runtime.sqdBscLogReader = { getLogsObservation: sqdLogs };
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}/history?chainId=eip155:56&platform=flap&fromBlock=16&toBlock=16&chunkSize=1`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      platform: 'flap',
      token: fixtureFlapToken,
      requestedRange: { fromBlock: '16', toBlock: '16', chunkSize: 1, chunkCount: 1 },
      requestedRangeCoverage: 1,
      lifetimeCoverage: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      chronology: [
        {
          transactionHash: fixtureFlapEventTransactionHash,
          blockNumber: '16',
          transactionKind: 'CREATION_CONFIGURATION',
        },
      ],
      transactions: [{ creation: { symbol: 'FIX' } }],
      metadata: { historyCoverage: 0, modelVersion: 'flap-bounded-event-history-v1' },
    });
    expect(response.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'PROVIDER_OBSERVATION',
      'DERIVED_FEATURE',
    ]);
    expect(response.json().evidence[0].source).toBe('sqd:binance-mainnet');
    expect(sqdLogs).toHaveBeenCalledOnce();
    const derivedId = response.json().evidence.at(-1).id;
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${derivedId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(drilldown.json().nodes).toHaveLength(6);
  });

  it('returns a fixed-block Flap previewSell quote without inventing fee or impact fields', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.evmAdapters.set(
      56,
      new EvmLedgerAdapter(
        {
          id: 'bsc-rpc',
          chainId: 56,
          chainName: 'BNB Smart Chain',
          snapshotBlockTag: 'finalized',
        },
        new FlapQuoteTransport([
          fixtureFlapV8SafeResult(),
          encodeAbiParameters([{ type: 'uint256' }], [250n]),
        ]),
      ),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-sell',
      payload: {
        chainId: 'eip155:56',
        platform: 'flap',
        token: fixtureFlapToken,
        inputQuantity: '100',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      platform: 'flap',
      token: fixtureFlapToken,
      quoteAsset: { state: 'known', value: 'eip155:56:native' },
      quote: {
        inputQuantity: '100',
        realizableValue: { state: 'known', value: '250' },
        nominalValue: { state: 'unknown', reason: 'NOT_QUERIED' },
        priceImpactBps: { state: 'unknown', reason: 'NOT_QUERIED' },
        totalFeeBps: { state: 'unknown', reason: 'NOT_QUERIED' },
        metadata: {
          snapshot: { chainId: 'eip155:56', blockNumber: '16' },
          modelVersion: 'flap-preview-sell-v0.1.0',
        },
      },
    });
    expect(response.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'PROVIDER_OBSERVATION',
      'CONTRACT_STATE',
      'CONTRACT_STATE',
      'CONTRACT_STATE',
      'DERIVED_FEATURE',
      'CONTRACT_STATE',
      'DERIVED_FEATURE',
    ]);
    const derivedId = response.json().evidence.at(-1).id;
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${derivedId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(drilldown.json().nodes).toHaveLength(7);
  });

  it('keeps Solana account absence known without coercing unavailable fields to zero', async () => {
    const app = await createApp({ config, runtime: runtimeWithAllLedgers(null), logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/SOLANA/11111111111111111111111111111111',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().facts).toEqual({
      exists: { state: 'known', value: false },
      lamports: {
        state: 'unknown',
        reason: 'INSUFFICIENT_DATA',
        detail: 'The account does not exist at this Snapshot.',
      },
      owner: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      executable: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
  });

  it('returns explicit validation, lookup, and unconfigured-provider errors', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);

    const invalidSearch = await app.inject({ method: 'GET', url: '/api/v1/search?q=' });
    expect(invalidSearch.statusCode).toBe(400);
    expect(invalidSearch.json().error.code).toBe('INVALID_REQUEST');
    expect(invalidSearch.json().issues.length).toBeGreaterThan(0);

    const invalidLedger = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/DOGE/not-an-address',
    });
    expect(invalidLedger.statusCode).toBe(400);
    expect(invalidLedger.json().error.code).toBe('INVALID_LEDGER');

    const invalidIdentifier = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/not-an-address',
    });
    expect(invalidIdentifier.statusCode).toBe(400);
    expect(invalidIdentifier.json().error.code).toBe('INVALID_IDENTIFIER');

    const unsupportedOutpoint = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/EVM/OUTPOINT/${fixtureBitcoinTransactionId}:0`,
    });
    expect(unsupportedOutpoint.statusCode).toBe(400);
    expect(unsupportedOutpoint.json().error.code).toBe('UNSUPPORTED_IDENTIFIER_TYPE');

    const wrongChain = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/BITCOIN/TRANSACTION/${fixtureBitcoinTransactionId}?chainId=eip155:1`,
    });
    expect(wrongChain.statusCode).toBe(400);
    expect(wrongChain.json().error.code).toBe('INVALID_CHAIN_ID');

    const malformedProviderResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/EVM/TRANSACTION/${fixtureEvmTransactionHash}?chainId=eip155:1`,
    });
    expect(malformedProviderResponse.statusCode).toBe(502);
    expect(malformedProviderResponse.json().error.code).toBe('INVALID_RESPONSE');

    const missingEvidence = await app.inject({
      method: 'GET',
      url: '/api/v1/evidence/ev_missing',
    });
    expect(missingEvidence.statusCode).toBe(404);
    const missingDrilldown = await app.inject({
      method: 'GET',
      url: '/api/v1/evidence/ev_missing/drilldown',
    });
    expect(missingDrilldown.statusCode).toBe(404);

    const evidenceLedger = new EvidenceLedger();
    const noProviders: AppRuntime = {
      providerRegistry: new ProviderRegistry([]),
      evmAdapters: new Map(),
      evidenceLedger,
      dataQuality: testDataQuality(evidenceLedger),
      ingestionStorage: {},
    };
    const degraded = await createApp({ config, runtime: noProviders, logger: false });
    apps.push(degraded);
    const unavailable = await degraded.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/0x52908400098527886e0f7030069857d2e4169ee7?chainId=eip155:1',
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().facts).toMatchObject({
      state: 'unavailable',
      reason: 'PROVIDER_UNCONFIGURED',
    });
    const unavailableLedgerRecord = await degraded.inject({
      method: 'GET',
      url: `/api/v1/ledger/EVM/TRANSACTION/${fixtureEvmTransactionHash}?chainId=eip155:1`,
    });
    expect(unavailableLedgerRecord.statusCode).toBe(503);
    expect(unavailableLedgerRecord.json().facts).toMatchObject({
      state: 'unavailable',
      reason: 'PROVIDER_UNCONFIGURED',
    });
    const unavailableLaunch = await degraded.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}?chainId=eip155:56`,
    });
    expect(unavailableLaunch.statusCode).toBe(503);
    expect(unavailableLaunch.json().platformMatch).toMatchObject({
      state: 'unavailable',
      reason: 'PROVIDER_UNCONFIGURED',
    });
    const unavailableFlapEvent = await degraded.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}/events/${fixtureFlapEventTransactionHash}?chainId=eip155:56`,
    });
    expect(unavailableFlapEvent.statusCode).toBe(503);
    expect(unavailableFlapEvent.json()).toMatchObject({
      platformMatch: { state: 'unavailable', reason: 'PROVIDER_UNCONFIGURED' },
      transactionKind: null,
      evidence: [],
    });
    const unavailableFlapHistory = await degraded.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}/history?chainId=eip155:56&fromBlock=16&toBlock=17`,
    });
    expect(unavailableFlapHistory.statusCode).toBe(503);
    expect(unavailableFlapHistory.json()).toMatchObject({
      requestedRangeCoverage: 0,
      lifetimeCoverage: { state: 'unavailable', reason: 'PROVIDER_UNCONFIGURED' },
      chronology: [],
      transactions: [],
      evidence: [],
    });
    const unavailableFlapQuote = await degraded.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-sell',
      payload: {
        chainId: 'eip155:56',
        token: fixtureFlapToken,
        inputQuantity: '100',
      },
    });
    expect(unavailableFlapQuote.statusCode).toBe(503);
    expect(unavailableFlapQuote.json().quote.realizableValue).toMatchObject({
      state: 'unavailable',
      reason: 'PROVIDER_UNCONFIGURED',
    });
  });

  it('grounds entity and exit-race derivations in snapshot-compatible evidence', async () => {
    const runtime = runtimeWithEvm();
    const source = addFixtureEvidence(runtime);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const entity = await app.inject({
      method: 'POST',
      url: '/api/v1/entities/resolve',
      payload: {
        subjectA: 'controller',
        subjectB: 'module',
        features: [
          {
            kind: 'SHARED_ONCHAIN_AUTHORITY',
            strength: 1,
            reliability: 1,
            evidenceId: source.id,
          },
        ],
        metadata: fixtureMetadata(source.id),
      },
    });
    expect(entity.statusCode).toBe(200);
    expect(entity.json()).toMatchObject({
      classification: 'CONFIRMED_SAME_CONTROLLER',
      evidence: [expect.objectContaining({ kind: 'DERIVED_FEATURE' })],
    });

    const scenario = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios/exit-race',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: [source.id],
        },
        participants: [
          { id: 'first', inputQuantity: '100' },
          { id: 'second', inputQuantity: '100' },
        ],
        order: 'SEQUENTIAL',
        seed: 42,
        metadata: fixtureMetadata(source.id),
      },
    });
    expect(scenario.statusCode).toBe(200);
    expect(scenario.json()).toMatchObject({
      iterations: 1,
      evidence: [expect.objectContaining({ kind: 'DERIVED_FEATURE' })],
    });
  });

  it('runs an Evidence-grounded typed discrepancy audit with exact, warning, and Unknown states', async () => {
    const runtime = runtimeWithEvm();
    const actualEvidence = addFixtureEvidence(runtime);
    const referenceEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'CONTRACT_STATE',
      source: 'reference-fixture',
      locator: 'pool:pool-reference@16',
      payload: { quote: '100', blockOrSlot: '16' },
      blockOrSlot: '16',
      finality: 'finalized',
      summary: 'Independent reference fixture at the same Snapshot.',
    });
    runtime.evidenceLedger.add(referenceEvidence, [], fixtureSnapshot);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const compared = (
      value: ComparisonObservation['value'],
      evidenceId: string,
      source: string,
    ) => ({
      value,
      snapshot: fixtureSnapshot,
      evidenceIds: [evidenceId],
      sourceSet: [source],
      modelVersion: `${source}-v1`,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/discrepancies',
      payload: {
        checks: [
          {
            fieldPath: 'identity.chainId',
            comparisonClass: 'EXACT_IDENTITY_STATE',
            actual: compared(knownValue('eip155:56'), actualEvidence.id, 'actual-fixture'),
            reference: compared(knownValue('eip155:1'), referenceEvidence.id, 'reference-fixture'),
          },
          {
            fieldPath: 'rv.previewSell',
            comparisonClass: 'INDEPENDENT_MARKET_QUOTE_RV',
            sourceIndependence: knownValue(true),
            sourceIndependenceEvidenceIds: [referenceEvidence.id],
            actual: compared(knownValue('100.75'), actualEvidence.id, 'actual-fixture'),
            reference: compared(knownValue('100'), referenceEvidence.id, 'reference-fixture'),
          },
          {
            fieldPath: 'rv.secondaryProvider',
            comparisonClass: 'INDEPENDENT_MARKET_QUOTE_RV',
            actual: compared(unknownValue('PROVIDER_DOWN'), actualEvidence.id, 'actual-fixture'),
            reference: compared(knownValue('100'), referenceEvidence.id, 'reference-fixture'),
          },
        ],
        metadata: fixtureMetadata(actualEvidence.id),
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'FAIL',
      summary: {
        total: 3,
        warnings: 1,
        failed: 1,
        inconclusive: 1,
        numericDenominator: 1,
        coverageGaps: 1,
      },
      checks: [
        { disposition: 'FAIL', severity: 'CRITICAL' },
        {
          disposition: 'WARNING',
          relativeErrorPct: { state: 'known', value: '0.75' },
          passThresholdPct: { state: 'known', value: '0.5' },
          warningThresholdPct: { state: 'known', value: '1' },
        },
        {
          disposition: 'INCONCLUSIVE',
          numericDenominatorIncluded: false,
        },
      ],
      evidence: [expect.objectContaining({ kind: 'DERIVED_FEATURE' })],
    });
    const derivedId = response.json().evidence[0].id;
    expect(
      response
        .json()
        .checks.every((check: { evidenceIds: string[] }) => check.evidenceIds.includes(derivedId)),
    ).toBe(true);
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${derivedId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(drilldown.json().nodes).toHaveLength(3);
  });

  it('keeps an empty discrepancy audit inconclusive and rejects missing comparison Evidence', async () => {
    const runtime = runtimeWithEvm();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/discrepancies',
      payload: { checks: [], metadata: { ...fixtureMetadata('ev_unused'), evidenceIds: [] } },
    });
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json()).toMatchObject({
      status: 'INCONCLUSIVE',
      summary: { total: 0, numericDenominator: 0 },
    });
    expect(empty.json().evidence).toBeUndefined();

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/discrepancies',
      payload: {
        checks: [
          {
            fieldPath: 'rv.previewSell',
            comparisonClass: 'INDEPENDENT_MARKET_QUOTE_RV',
            actual: {
              value: knownValue('100'),
              snapshot: fixtureSnapshot,
              evidenceIds: ['ev_missing_actual'],
              sourceSet: ['actual'],
              modelVersion: 'actual-v1',
            },
            reference: {
              value: knownValue('100'),
              snapshot: fixtureSnapshot,
              evidenceIds: ['ev_missing_reference'],
              sourceSet: ['reference'],
              modelVersion: 'reference-v1',
            },
          },
        ],
        metadata: { ...fixtureMetadata('ev_unused'), evidenceIds: [] },
      },
    });
    expect(missing.statusCode, missing.body).toBe(422);
    expect(missing.json()).toMatchObject({
      error: { code: 'UNGROUNDED_ANALYSIS' },
      evidenceIssue: {
        kind: 'MISSING',
        evidenceIds: ['ev_missing_actual', 'ev_missing_reference'],
      },
    });

    const ungrounded = await app.inject({
      method: 'POST',
      url: '/api/v1/data-quality/discrepancies',
      payload: {
        checks: [
          {
            fieldPath: 'rv.unqueried',
            comparisonClass: 'INDEPENDENT_MARKET_QUOTE_RV',
            actual: {
              value: unknownValue('NOT_QUERIED'),
              snapshot: fixtureSnapshot,
              evidenceIds: [],
              sourceSet: ['actual'],
              modelVersion: 'actual-v1',
            },
            reference: {
              value: unknownValue('NOT_QUERIED'),
              snapshot: fixtureSnapshot,
              evidenceIds: [],
              sourceSet: ['reference'],
              modelVersion: 'reference-v1',
            },
          },
        ],
        metadata: { ...fixtureMetadata('ev_unused'), evidenceIds: [] },
      },
    });
    expect(ungrounded.statusCode, ungrounded.body).toBe(422);
    expect(ungrounded.json()).toMatchObject({
      error: {
        code: 'UNGROUNDED_ANALYSIS',
        message: 'A non-empty discrepancy audit requires at least one source Evidence node.',
      },
    });
  });

  it('rejects missing or snapshot-incompatible analysis evidence', async () => {
    const runtime = runtimeWithEvm();
    const wrongBlock = addFixtureEvidence(runtime, '15');
    const wrongHash = addFixtureEvidence(runtime);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: ['ev_missing'],
        },
        inputQuantity: '100',
        metadata: fixtureMetadata('ev_missing'),
      },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().evidenceIssue).toEqual({
      kind: 'MISSING',
      evidenceIds: ['ev_missing'],
    });

    const incompatible = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: [wrongBlock.id],
        },
        inputQuantity: '100',
        metadata: fixtureMetadata(wrongBlock.id),
      },
    });
    expect(incompatible.statusCode).toBe(422);
    expect(incompatible.json().evidenceIssue).toEqual({
      kind: 'SNAPSHOT_INCOMPATIBLE',
      evidenceIds: [wrongBlock.id],
    });

    const conflictingAnchor = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: [wrongHash.id],
        },
        inputQuantity: '100',
        metadata: {
          ...fixtureMetadata(wrongHash.id),
          snapshot: { ...fixtureSnapshot, blockHash: '0x' + 'c'.repeat(64) },
        },
      },
    });
    expect(conflictingAnchor.statusCode).toBe(422);
    expect(conflictingAnchor.json().evidenceIssue).toEqual({
      kind: 'SNAPSHOT_INCOMPATIBLE',
      evidenceIds: [wrongHash.id],
    });
  });
});
