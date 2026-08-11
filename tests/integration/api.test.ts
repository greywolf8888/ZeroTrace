import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TOKEN_PROGRAM_ADDRESS,
  getTransferCheckedInstructionDataEncoder,
} from '@solana-program/token';
import bs58 from 'bs58';

import {
  BitcoinUtxoLedgerAdapter,
  EvmLedgerAdapter,
  ProviderError,
  ProviderRegistry,
  SolanaLedgerAdapter,
  type EvmLogQuery,
  type EvmLogRecord,
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
import {
  createEvidence,
  EvidenceLedger,
  hashPayload,
  type EvidenceNode,
} from '@zerotrace/evidence';
import {
  ERC20_TRANSFER_TOPIC,
  PANCAKE_V2_BSC_DEPLOYMENT,
  type FlapOriginCheckpointRun,
  type FlapOriginCheckpointStore,
} from '@zerotrace/platform-adapters';
import {
  knownValue,
  unknownValue,
  type ChainAnchorRead,
  type ComparisonObservation,
  type EntityRelationshipReport,
} from '@zerotrace/schemas';
import {
  StorageError,
  type EvidenceRepository,
  type StoredEntityRelationshipReport,
} from '@zerotrace/storage';
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
  sourcifyRequestsPerSecond: 0,
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
  readonly #blockNumber: bigint;
  readonly #blockHash: string;
  readonly #parentBlockHash: string;
  readonly #timestamp: string;

  constructor(
    callResults: unknown[],
    anchor: {
      blockNumber?: bigint;
      blockHash?: string;
      parentBlockHash?: string;
      timestamp?: string;
    } = {},
  ) {
    this.#callResults = [...callResults];
    this.#blockNumber = anchor.blockNumber ?? 16n;
    this.#blockHash = anchor.blockHash ?? `0x${'6'.repeat(64)}`;
    this.#parentBlockHash = anchor.parentBlockHash ?? `0x${'5'.repeat(64)}`;
    this.#timestamp = anchor.timestamp ?? '0x65';
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
          number: `0x${this.#blockNumber.toString(16)}`,
          hash: this.#blockHash,
          parentHash: this.#parentBlockHash,
          timestamp: this.#timestamp,
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

class ReconciledFlapQuoteTransport implements JsonRpcTransport {
  readonly endpointId: string;
  readonly #callResults: unknown[];
  readonly #blockHash: string;

  constructor(endpointId: string, callResults: unknown[], blockHash = `0x${'6'.repeat(64)}`) {
    this.endpointId = endpointId;
    this.#callResults = [...callResults];
    this.#blockHash = blockHash;
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
          hash: this.#blockHash,
          parentHash: `0x${'5'.repeat(64)}`,
          timestamp: '0x65',
        } as T,
        endpointId: this.endpointId,
      };
    }
    if (method === 'eth_getCode') {
      return { value: '0x6000' as T, endpointId: this.endpointId };
    }
    if (method === 'eth_call') {
      const value = this.#callResults.shift();
      if (value === undefined) throw new Error('Reconciliation fixture exhausted call results.');
      return { value: value as T, endpointId: this.endpointId };
    }
    throw new Error(`Unexpected reconciliation fixture method ${method}`);
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

class BurnConservationTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-burn-fixture';

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    return (await this.requestSourced<T>(method, params)).value;
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    if (method === 'eth_getBlockByNumber') {
      const tag = params[0];
      const parent = tag === '0x63';
      return {
        value: {
          number: parent ? '0x63' : '0x64',
          hash: `0x${(parent ? 'b' : 'a').repeat(64)}`,
          parentHash: `0x${(parent ? 'd' : 'b').repeat(64)}`,
          timestamp: parent ? '0x65c95a7d' : '0x65c95a80',
        } as T,
        endpointId: 'bsc-burn-anchor',
      };
    }
    if (method === 'eth_call') {
      const tag = params[1];
      return {
        value: encodeAbiParameters([{ type: 'uint256' }], [tag === '0x63' ? 1_000n : 900n]) as T,
        endpointId: 'bsc-burn-state',
      };
    }
    if (method === 'eth_getLogs') {
      const burner = `0x${'2'.repeat(40)}`;
      return {
        value: [
          {
            address: fixtureFlapToken,
            blockHash: `0x${'a'.repeat(64)}`,
            blockNumber: '0x64',
            transactionHash: `0x${'3'.repeat(64)}`,
            transactionIndex: '0x1',
            logIndex: '0x2',
            data: `0x${100n.toString(16).padStart(64, '0')}`,
            topics: [
              ERC20_TRANSFER_TOPIC,
              `0x${'0'.repeat(24)}${burner.slice(2)}`,
              `0x${'0'.repeat(64)}`,
            ],
            removed: false,
          },
        ] as T,
        endpointId: 'bsc-burn-logs',
      };
    }
    throw new Error(`Unexpected burn-conservation fixture method ${method}`);
  }
}

class BurnDiscoveryAnchorTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-burn-discovery-anchor';

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    return (await this.requestSourced<T>(method, params)).value;
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    if (method !== 'eth_getBlockByNumber' || params[0] !== '0x6e') {
      throw new Error(`Unexpected burn-discovery anchor method ${method}`);
    }
    return {
      value: {
        number: '0x6e',
        hash: `0x${'f'.repeat(64)}`,
        parentHash: `0x${'e'.repeat(64)}`,
        timestamp: '0x65c95abc',
      } as T,
      endpointId: this.endpointId,
    };
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

class ChangingBitcoinTipRestTransport extends FakeRestTransport {
  #tipReads = 0;

  override async getTextSourced(path: string): Promise<TransportObservation<string>> {
    if (path !== '/blocks/tip/height') return super.getTextSourced(path);
    this.#tipReads += 1;
    return {
      value: this.#tipReads === 1 ? '840000' : '840001',
      endpointId: 'bitcoin-changing-tip',
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
const fixtureFlapPool = `0x${'b'.repeat(40)}`;
const fixtureFlapQuoteAsset = `0x${'c'.repeat(40)}`;
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

function fixtureFlapV8SafeResult(overrides: Record<string, unknown> = {}) {
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
        ...overrides,
      },
    ],
  );
}

function fixtureAddressResult(value: string) {
  return encodeAbiParameters([{ type: 'address' }], [value as `0x${string}`]);
}

function fixtureDecimalsResult(value: number) {
  return encodeAbiParameters([{ type: 'uint8' }], [value]);
}

function fixtureReservesResult(reserve0: bigint, reserve1: bigint) {
  return encodeAbiParameters(
    [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }],
    [reserve0, reserve1, 123],
  );
}

function fixturePancakeAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint) {
  const amountInWithFee = amountIn * 9_975n;
  return (amountInWithFee * reserveOut) / (reserveIn * 10_000n + amountInWithFee);
}

function fixtureAmountsOutResult(input: bigint, output: bigint) {
  return encodeAbiParameters([{ type: 'uint256[]' }], [[input, output]]);
}

function reconciliationMarketCalls(
  quoteReserve: bigint,
  tokenReserve: bigint,
  quoteInput: bigint,
  tokenInput: bigint,
) {
  const marketReads = () => [
    fixtureFlapV8SafeResult({
      status: 4,
      quoteTokenAddress: fixtureFlapQuoteAsset,
      pool: fixtureFlapPool,
      dexId: 0,
    }),
    fixtureAddressResult(PANCAKE_V2_BSC_DEPLOYMENT.factory),
    fixtureAddressResult(fixtureFlapQuoteAsset),
    fixtureAddressResult(fixtureFlapToken),
    fixtureReservesResult(quoteReserve, tokenReserve),
    fixtureAddressResult(fixtureFlapPool),
    fixtureAddressResult(PANCAKE_V2_BSC_DEPLOYMENT.factory),
    fixtureDecimalsResult(18),
    fixtureDecimalsResult(18),
  ];
  const sellCertificationInput = 1n * 10n ** 18n;
  return [
    ...marketReads(),
    fixtureAmountsOutResult(
      quoteInput,
      fixturePancakeAmountOut(quoteInput, quoteReserve, tokenReserve),
    ),
    ...marketReads(),
    fixtureAmountsOutResult(
      sellCertificationInput,
      fixturePancakeAmountOut(sellCertificationInput, quoteReserve, tokenReserve),
    ),
    fixtureAmountsOutResult(
      tokenInput,
      fixturePancakeAmountOut(tokenInput, tokenReserve, quoteReserve),
    ),
  ];
}

function configureReconciliationRuntime(
  runtime: AppRuntime,
  options: {
    sourceIds: readonly string[];
    quoteReserve: bigint;
    tokenReserves: readonly bigint[];
    quoteInput: bigint;
    tokenInput: bigint;
    blockHashes?: readonly string[];
  },
): EvmLedgerAdapter[] {
  const adapters = options.sourceIds.map((sourceId, index) => {
    const tokenReserve = options.tokenReserves[index];
    if (tokenReserve === undefined) throw new Error('Each reconciliation source needs reserves.');
    return new EvmLedgerAdapter(
      {
        id: 'bsc-rpc',
        chainId: 56,
        chainName: 'BNB Smart Chain',
        snapshotBlockTag: 'finalized',
      },
      new ReconciledFlapQuoteTransport(
        sourceId,
        reconciliationMarketCalls(
          options.quoteReserve,
          tokenReserve,
          options.quoteInput,
          options.tokenInput,
        ),
        options.blockHashes?.[index],
      ),
    );
  });
  runtime.evmAdapters.set(56, adapters[0] as EvmLedgerAdapter);
  runtime.evmSourceAdapters = new Map([[56, adapters]]);
  runtime.dataQuality = testDataQuality(runtime.evidenceLedger, [
    { ledger: 'EVM', chainId: 'eip155:1', readers: [] },
    {
      ledger: 'EVM',
      chainId: 'eip155:56',
      readers: adapters.map((adapter) => ({
        sourceId: adapter.sourceId,
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        readHead: () => adapter.readHeadAnchor(),
        readAt: (position: string) => adapter.readAnchorAt(position),
      })),
    },
    { ledger: 'BITCOIN', chainId: 'bitcoin-mainnet', readers: [] },
    { ledger: 'SOLANA', chainId: 'solana-mainnet', readers: [] },
  ]);
  return adapters;
}

function runtimeWithAllLedgers(solanaAccountValue: unknown = defaultSolanaAccount): AppRuntime {
  const bitcoinAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const bitcoinOutput = {
    scriptpubkey: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
    scriptpubkey_type: 'v0_p2wpkh',
    scriptpubkey_address: bitcoinAddress,
    value: 100,
  };
  const bitcoinTaprootOutput = {
    scriptpubkey: '5120c4469d1aab486965aec49d16d73210fb8228368958c69a9479f5341fc665ee75',
    scriptpubkey_type: 'v1_p2tr',
    scriptpubkey_address: 'bc1pc3rf6x4tfp5kttkyn5tdwvsslwpzsd5ftrrf49re756pl3n9ae6shr8qka',
    value: 13_628,
  };
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
        [`/address/${bitcoinAddress}`]: {
          address: bitcoinAddress,
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
        [`/address/${bitcoinAddress}/utxo`]: [
          {
            txid: 'e'.repeat(64),
            vout: 1,
            value: 290,
            status: {
              confirmed: true,
              block_height: 839999,
              block_hash: 'c'.repeat(64),
              block_time: 1_699_999_000,
            },
          },
        ],
        [`/tx/${fixtureBitcoinTransactionId}`]: {
          txid: fixtureBitcoinTransactionId,
          version: 2,
          locktime: 0,
          size: 120,
          weight: 480,
          fee: 200,
          vin: [
            {
              is_coinbase: true,
              sequence: 4_294_967_295,
              scriptsig: '03',
              scriptsig_asm: 'OP_PUSHBYTES_1 03',
              witness: [],
            },
          ],
          vout: [bitcoinOutput, bitcoinTaprootOutput],
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
        [`/tx/${fixtureBitcoinTransactionId}/outspend/1`]: { spent: false },
        [`/tx/${'d'.repeat(64)}`]: {
          txid: 'd'.repeat(64),
          version: 2,
          locktime: 0,
          size: 110,
          weight: 440,
          fee: 100,
          vin: [
            {
              txid: fixtureBitcoinTransactionId,
              vout: 0,
              prevout: bitcoinOutput,
              is_coinbase: false,
              sequence: 4_294_967_293,
              scriptsig: '',
              scriptsig_asm: '',
              witness: ['30', `02${'4'.repeat(64)}`],
            },
          ],
          vout: [
            {
              scriptpubkey: '6a',
              scriptpubkey_type: 'op_return',
              value: 0,
            },
          ],
          status: { confirmed: false },
        },
      },
      {
        '/blocks/tip/height': 'bitcoin-anchor-a',
        '/block-height/840000': 'bitcoin-anchor-b',
        [`/block/${'b'.repeat(64)}`]: 'bitcoin-anchor-b',
        [`/address/${bitcoinAddress}`]: 'bitcoin-state',
        [`/address/${bitcoinAddress}/utxo`]: 'bitcoin-utxo',
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
        getMultipleAccounts: {
          context: { slot: 300_000_000 },
          value: [solanaAccountValue],
        },
        getTransaction: {
          slot: 300_000_000,
          blockTime: 1_700_000_000,
          version: 0,
          transaction: {
            signatures: [fixtureSolanaSignature],
            message: {
              accountKeys: [
                '11111111111111111111111111111111',
                'Vote111111111111111111111111111111111111111',
              ],
              addressTableLookups: [],
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 1,
              },
              instructions: [{ accounts: [0], data: '', programIdIndex: 1, stackHeight: 1 }],
              recentBlockhash: '11111111111111111111111111111111',
            },
          },
          meta: {
            err: null,
            fee: 5000,
            loadedAddresses: { writable: [], readonly: [] },
            innerInstructions: [],
            preBalances: [10000, 1],
            postBalances: [5000, 1],
            preTokenBalances: [],
            postTokenBalances: [],
            logMessages: [],
            computeUnitsConsumed: 2100,
          },
        },
      },
      {
        getSlot: 'solana-anchor-a',
        getBlock: 'solana-anchor-b',
        getAccountInfo: 'solana-state',
        getMultipleAccounts: 'solana-state',
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

function attachEntityReportDurability(runtime: AppRuntime) {
  const records = new Map<string, StoredEntityRelationshipReport>();
  const durableEvidence = new Map<string, EvidenceNode>();
  const evidenceRepository: EvidenceRepository = {
    put: async (evidence, sourceEvidenceIds = [], snapshot) => {
      const node: EvidenceNode = {
        evidence,
        sourceEvidenceIds: [...new Set(sourceEvidenceIds)].sort(),
        ...(snapshot === undefined ? {} : { snapshot }),
      };
      durableEvidence.set(evidence.id, node);
      return node;
    },
    get: async (id) => durableEvidence.get(id) ?? runtime.evidenceLedger.get(id),
    drilldown: async (id) => runtime.evidenceLedger.drilldown(id),
    health: async () => ({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
      checkedAt: '2026-08-09T00:00:01.000Z',
    }),
    close: async () => undefined,
  };
  runtime.evidenceRepository = evidenceRepository;
  runtime.entityRelationshipReports = {
    put: async (report: EntityRelationshipReport) => {
      const snapshot = report.result.metadata.snapshot;
      const snapshotPosition =
        snapshot.ledger === 'EVM'
          ? snapshot.blockNumber
          : snapshot.ledger === 'BITCOIN'
            ? snapshot.height
            : snapshot.slot;
      const snapshotHash = snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
      const resultHash = hashPayload(report);
      const record: StoredEntityRelationshipReport = {
        id: `erh_${hashPayload({ schema: 'zerotrace-entity-relationship-report-v1', resultHash }).slice(0, 24)}`,
        ledger: snapshot.ledger,
        chainId: snapshot.chainId,
        subjectA: report.result.subjectA,
        subjectB: report.result.subjectB,
        snapshotPosition,
        snapshotHash,
        resultHash,
        report,
        terminalEvidenceId: report.terminalEvidenceId,
        evidenceIds: report.result.metadata.evidenceIds,
        sourceSet: report.result.metadata.sourceSet,
        modelVersion: 'entity-v0.1.0',
        capturedAt: snapshot.capturedAt,
        createdAt: '2026-08-09T00:00:02.000Z',
      };
      records.set(record.id, record);
      return record;
    },
    get: async (id: string) => records.get(id),
    latest: async ({ ledger, chainId, subjectA, subjectB }) =>
      [...records.values()].find(
        (record) =>
          record.ledger === ledger &&
          record.chainId === chainId &&
          record.subjectA === subjectA &&
          record.subjectB === subjectB,
      ),
    health: async () => ({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
      checkedAt: '2026-08-09T00:00:01.000Z',
    }),
    close: async () => undefined,
  } as NonNullable<AppRuntime['entityRelationshipReports']>;
  return records;
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

  it('allows configured browser origins and rejects other origins without a 500', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const allowed = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'http://localhost:5173' },
    });
    const denied = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'https://untrusted.example' },
    });

    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json()).toMatchObject({
      error: { code: 'CORS_ORIGIN_DENIED', retryable: false },
    });
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
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'erc20-burn-candidate-promotion',
        status: 'DURABLE_STORAGE_REQUIRED',
      }),
    );
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'erc20-supply-continuity',
        status: 'DURABLE_STORAGE_REQUIRED',
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

  it('remains ready for provider-free replay while reporting upstreams as degraded', async () => {
    const runtime = runtimeWithEvm();
    runtime.providerRegistry = new ProviderRegistry([]);
    runtime.evmAdapters = new Map();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: 'DEGRADED',
      readOnly: true,
      providers: [],
      storage: { status: 'EPHEMERAL' },
    });
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

  it('fails readiness when durable semantic checkpoints are not initialized', async () => {
    const runtime = runtimeWithEvm();
    runtime.evidenceRepository = repository({
      health: vi.fn(async () => ({
        status: 'UP',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
      })),
    });
    runtime.semanticCheckpoints = {
      health: vi.fn(async () => ({
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
        errorCode: 'SEMANTIC_CHECKPOINT_NOT_INITIALIZED',
      })),
    } as unknown as NonNullable<AppRuntime['semanticCheckpoints']>;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      status: 'DEGRADED',
      storage: {
        status: 'DOWN',
        durable: true,
        errorCode: 'SEMANTIC_CHECKPOINT_NOT_INITIALIZED',
      },
    });
  });

  it('fails readiness when immutable Flap history projection storage is not initialized', async () => {
    const runtime = runtimeWithEvm();
    runtime.evidenceRepository = repository({
      health: vi.fn(async () => ({
        status: 'UP',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
      })),
    });
    runtime.semanticCheckpoints = {
      health: vi.fn(async () => ({
        status: 'UP',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
      })),
    } as unknown as NonNullable<AppRuntime['semanticCheckpoints']>;
    runtime.flapHistoryProjection = {
      health: vi.fn(async () => ({
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
        errorCode: 'FLAP_HISTORY_PROJECTION_NOT_INITIALIZED',
      })),
    } as unknown as NonNullable<AppRuntime['flapHistoryProjection']>;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      status: 'DEGRADED',
      storage: {
        status: 'DOWN',
        durable: true,
        errorCode: 'FLAP_HISTORY_PROJECTION_NOT_INITIALIZED',
      },
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
      totalUtxoValueSats: { state: 'known', value: '290' },
      confirmedUtxoCount: { state: 'known', value: '1' },
      balanceAgreement: { state: 'known', value: true },
      effectiveRbfPolicy: { state: 'unknown', reason: 'UNSUPPORTED' },
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
      'bitcoin-utxo',
    ]);
    expect(bitcoin.json().evidence[0].source).toBe('bitcoin-state');
    expect(bitcoin.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'ACCOUNT_STATE',
      'UTXO',
      'DERIVED_FEATURE',
    ]);

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

  it('fails closed when the Bitcoin tip changes across an address UTXO observation', async () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    const runtime = runtimeWithAllLedgers();
    runtime.bitcoinAdapter = new BitcoinUtxoLedgerAdapter(
      { id: 'bitcoin-changing-tip' },
      new ChangingBitcoinTipRestTransport({
        '/block-height/840000': 'b'.repeat(64),
        [`/block/${'b'.repeat(64)}`]: {
          id: 'b'.repeat(64),
          height: 840000,
          previousblockhash: 'a'.repeat(64),
        },
        '/block-height/840001': 'd'.repeat(64),
        [`/block/${'d'.repeat(64)}`]: {
          id: 'd'.repeat(64),
          height: 840001,
          previousblockhash: 'b'.repeat(64),
        },
        [`/address/${address}`]: {
          address,
          chain_stats: {
            funded_txo_count: 0,
            funded_txo_sum: 0,
            spent_txo_count: 0,
            spent_txo_sum: 0,
            tx_count: 0,
          },
          mempool_stats: {
            funded_txo_count: 0,
            funded_txo_sum: 0,
            spent_txo_count: 0,
            spent_txo_sum: 0,
            tx_count: 0,
          },
        },
        [`/address/${address}/utxo`]: [],
      }),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/subjects/BITCOIN/${address}`,
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringMatching(/tip changed/),
    });
  });

  it('keeps conflicting Bitcoin address statistics and UTXO value Unknown', async () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    const runtime = runtimeWithAllLedgers();
    runtime.bitcoinAdapter = new BitcoinUtxoLedgerAdapter(
      { id: 'bitcoin-conflict' },
      new FakeRestTransport({
        '/blocks/tip/height': '840000',
        '/block-height/840000': 'b'.repeat(64),
        [`/block/${'b'.repeat(64)}`]: {
          id: 'b'.repeat(64),
          height: 840000,
          previousblockhash: 'a'.repeat(64),
        },
        [`/address/${address}`]: {
          address,
          chain_stats: {
            funded_txo_count: 1,
            funded_txo_sum: 1,
            spent_txo_count: 0,
            spent_txo_sum: 0,
            tx_count: 1,
          },
          mempool_stats: {
            funded_txo_count: 0,
            funded_txo_sum: 0,
            spent_txo_count: 0,
            spent_txo_sum: 0,
            tx_count: 0,
          },
        },
        [`/address/${address}/utxo`]: [
          {
            txid: 'e'.repeat(64),
            vout: 0,
            value: 2,
            status: { confirmed: false },
          },
        ],
      }),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/subjects/BITCOIN/${address}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      facts: {
        confirmedBalanceSats: { state: 'known', value: '1' },
        totalUtxoValueSats: { state: 'known', value: '2' },
        balanceAgreement: { state: 'unknown', reason: 'CONFLICTING_SOURCES' },
      },
      metadata: { confidence: 0.5 },
      evidence: [
        { kind: 'ACCOUNT_STATE' },
        { kind: 'UTXO' },
        { kind: 'DERIVED_FEATURE', summary: expect.stringMatching(/conflict/) },
      ],
    });
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
      outputCount: { state: 'known', value: '2' },
      transactionEntityAnalysis: {
        state: 'known',
        value: {
          coinbase: true,
          structuralPattern: 'NOT_APPLICABLE',
          automaticOwnershipMergeAllowed: false,
          ownershipConclusion: { state: 'unknown', reason: 'NOT_APPLICABLE' },
        },
      },
    });
    expect(bitcoin.json().metadata.snapshot).toMatchObject({
      ledger: 'BITCOIN',
      height: '840000',
      blockHash: 'b'.repeat(64),
    });
    expect(bitcoin.json().evidence).toEqual([
      expect.objectContaining({ kind: 'TRANSACTION', blockOrSlot: '840000' }),
      expect.objectContaining({ kind: 'OFFICIAL_DOCUMENT', source: 'bitcoin-bips' }),
      expect.objectContaining({
        kind: 'DERIVED_FEATURE',
        source: 'zerotrace:bitcoin-transaction-entity-v1.0.0',
      }),
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
      feePayer: { state: 'known', value: '11111111111111111111111111111111' },
      signerCount: { state: 'known', value: 1 },
      outerInstructionCount: { state: 'known', value: 1 },
      cpiCount: { state: 'known', value: 0 },
      accountResolutionComplete: { state: 'known', value: true },
      tokenBalanceChangeCount: { state: 'known', value: 0 },
      transactionSemantics: {
        state: 'known',
        value: {
          version: '0',
          accountCoverage: 1,
          accounts: [
            expect.objectContaining({
              address: '11111111111111111111111111111111',
              signer: true,
              writable: true,
              feePayer: true,
              balanceDeltaLamports: { state: 'known', value: '-5000' },
            }),
            expect.objectContaining({
              address: 'Vote111111111111111111111111111111111111111',
              signer: false,
              writable: false,
            }),
          ],
          outerInstructions: [
            expect.objectContaining({
              path: 'outer:0',
              programId: {
                state: 'known',
                value: 'Vote111111111111111111111111111111111111111',
              },
            }),
          ],
          modelVersion: 'solana-transaction-semantics-v1.1.0',
        },
      },
    });
    expect(solana.json().metadata.snapshot).toMatchObject({
      ledger: 'SOLANA',
      slot: '300000000',
      commitment: 'finalized',
    });
    const solanaEvidence = solana.json().evidence;
    expect(solanaEvidence).toEqual([
      expect.objectContaining({ kind: 'TRANSACTION', blockOrSlot: '300000000' }),
      expect.objectContaining({
        kind: 'DERIVED_FEATURE',
        locator: expect.stringContaining(':outer:0@300000000'),
      }),
      expect.objectContaining({
        kind: 'DERIVED_FEATURE',
        source: 'zerotrace:solana-transaction-semantics-v1.1.0',
      }),
    ]);
    expect(runtime.evidenceLedger.get(solanaEvidence[1].id)?.sourceEvidenceIds).toEqual([
      solanaEvidence[0].id,
    ]);
    expect(runtime.evidenceLedger.get(solanaEvidence[2].id)?.sourceEvidenceIds).toEqual(
      [solanaEvidence[0].id, solanaEvidence[1].id].sort(),
    );
  });

  it('persists and replays immutable Solana transaction intelligence without a provider', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.evidenceRepository = repository();
    let storedRecord: Record<string, unknown> | undefined;
    const put = vi.fn(async (report: Record<string, unknown>) => {
      storedRecord = {
        id: `str_${'3'.repeat(24)}`,
        chainId: 'solana-mainnet' as const,
        signature: fixtureSolanaSignature,
        snapshotSlot: '300000000',
        snapshotHash: '11111111111111111111111111111111',
        resultHash: 'f'.repeat(64),
        report,
        terminalEvidenceId: report.terminalEvidenceId,
        evidenceIds: (report.metadata as { evidenceIds: string[] }).evidenceIds.slice().sort(),
        sourceSet: (report.metadata as { sourceSet: string[] }).sourceSet,
        modelVersion: 'solana-transaction-query-v1.1.0' as const,
        capturedAt: '2026-08-11T00:00:00.000Z',
        createdAt: '2026-08-11T00:00:02.000Z',
      };
      return storedRecord;
    });
    const latest = vi.fn(async (input: string) =>
      input === fixtureSolanaSignature ? storedRecord : undefined,
    );
    const get = vi.fn(async (input: string) =>
      input === `str_${'3'.repeat(24)}` ? storedRecord : undefined,
    );
    runtime.solanaTransactionReports = { put, latest, get } as unknown as NonNullable<
      AppRuntime['solanaTransactionReports']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const live = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/SOLANA/TRANSACTION/${fixtureSolanaSignature}`,
    });
    expect(live.statusCode, live.body).toBe(200);
    expect(live.json()).toMatchObject({
      ledger: 'SOLANA',
      signature: fixtureSolanaSignature,
      terminalEvidenceId: expect.stringMatching(/^ev_/),
      durableReport: {
        id: `str_${'3'.repeat(24)}`,
        resultHash: 'f'.repeat(64),
        replayed: false,
        liveRefresh: { state: 'known', value: true },
      },
    });
    expect(put).toHaveBeenCalledTimes(1);

    vi.spyOn(
      runtime.solanaAdapter as SolanaLedgerAdapter,
      'getTransactionObservation',
    ).mockRejectedValueOnce(
      new ProviderError('RATE_LIMITED', 'Fixture provider quota exhausted.', {
        retryable: true,
      }),
    );
    const degradedReplay = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/SOLANA/TRANSACTION/${fixtureSolanaSignature}`,
    });
    expect(degradedReplay.statusCode, degradedReplay.body).toBe(200);
    expect(degradedReplay.json()).toMatchObject({
      durableReport: {
        id: `str_${'3'.repeat(24)}`,
        replayed: true,
        liveRefresh: { state: 'unavailable', reason: 'RATE_LIMITED' },
      },
    });

    runtime.solanaAdapter = undefined;
    const replay = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/SOLANA/TRANSACTION/${fixtureSolanaSignature}`,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({
      signature: fixtureSolanaSignature,
      durableReport: {
        id: `str_${'3'.repeat(24)}`,
        replayed: true,
        liveRefresh: { state: 'unavailable', reason: 'PROVIDER_UNCONFIGURED' },
      },
    });

    const latestReplay = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/SOLANA/TRANSACTION/${fixtureSolanaSignature}/reports/latest`,
    });
    expect(latestReplay.statusCode, latestReplay.body).toBe(200);
    expect(latestReplay.json()).toEqual({ record: storedRecord });

    const exactReplay = await app.inject({
      method: 'GET',
      url:
        `/api/v1/ledger/SOLANA/TRANSACTION/${fixtureSolanaSignature}/reports/` +
        `str_${'3'.repeat(24)}`,
    });
    expect(exactReplay.statusCode, exactReplay.body).toBe(200);
    expect(exactReplay.json()).toEqual({ record: storedRecord });
    expect(latest).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledWith(`str_${'3'.repeat(24)}`);
  });

  it('normalizes Solana v0 loaded accounts, CPI and token effects without hiding coverage', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.solanaAdapter = new SolanaLedgerAdapter(
      { id: 'solana-rpc', commitment: 'finalized' },
      new FakeTransport({
        getTransaction: {
          slot: 300_000_000,
          blockTime: 1_700_000_000,
          version: 0,
          transaction: {
            signatures: [fixtureSolanaSignature],
            message: {
              accountKeys: [
                '11111111111111111111111111111111',
                'So11111111111111111111111111111111111111112',
                'Vote111111111111111111111111111111111111111',
                String(TOKEN_PROGRAM_ADDRESS),
              ],
              addressTableLookups: [
                {
                  accountKey: 'AddressLookupTab1e1111111111111111111111111',
                  writableIndexes: [0, 1],
                  readonlyIndexes: [2],
                },
              ],
              header: {
                numRequiredSignatures: 1,
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 3,
              },
              instructions: [
                {
                  accounts: [4, 1, 5, 2],
                  data: bs58.encode(
                    Uint8Array.from(
                      getTransferCheckedInstructionDataEncoder().encode({
                        amount: 30n,
                        decimals: 9,
                      }),
                    ),
                  ),
                  programIdIndex: 3,
                  stackHeight: 1,
                },
              ],
              recentBlockhash: '11111111111111111111111111111111',
            },
          },
          meta: {
            err: null,
            fee: 5000,
            loadedAddresses: {
              writable: [
                'SysvarRent111111111111111111111111111111111',
                'Stake11111111111111111111111111111111111111',
              ],
              readonly: ['ComputeBudget111111111111111111111111111111'],
            },
            innerInstructions: [
              {
                index: 0,
                instructions: [{ accounts: [4], data: '1', programIdIndex: 6, stackHeight: 2 }],
              },
            ],
            preBalances: [10000, 1461600, 1, 1, 2039280, 2039280, 1],
            postBalances: [5000, 1461600, 1, 1, 2039280, 2039280, 1],
            preTokenBalances: [
              {
                accountIndex: 4,
                mint: 'So11111111111111111111111111111111111111112',
                owner: '11111111111111111111111111111111',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '100',
                  decimals: 9,
                  uiAmount: null,
                  uiAmountString: '0.0000001',
                },
              },
              {
                accountIndex: 5,
                mint: 'So11111111111111111111111111111111111111112',
                owner: 'Vote111111111111111111111111111111111111111',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '10',
                  decimals: 9,
                  uiAmount: null,
                  uiAmountString: '0.00000001',
                },
              },
            ],
            postTokenBalances: [
              {
                accountIndex: 4,
                mint: 'So11111111111111111111111111111111111111112',
                owner: '11111111111111111111111111111111',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '70',
                  decimals: 9,
                  uiAmount: null,
                  uiAmountString: '0.00000007',
                },
              },
              {
                accountIndex: 5,
                mint: 'So11111111111111111111111111111111111111112',
                owner: 'Vote111111111111111111111111111111111111111',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '40',
                  decimals: 9,
                  uiAmount: null,
                  uiAmountString: '0.00000004',
                },
              },
            ],
            logMessages: ['Program invoke [1]', 'Program invoke [2]', 'Program success'],
            computeUnitsConsumed: 2300,
          },
        },
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

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/SOLANA/TRANSACTION/${fixtureSolanaSignature}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      facts: {
        cpiCount: { state: 'known', value: 1 },
        accountResolutionComplete: { state: 'known', value: true },
        tokenBalanceChangeCount: { state: 'known', value: 2 },
        coreAssetFlowCount: { state: 'known', value: 1 },
        tokenFlowReconciliation: {
          state: 'known',
          value: {
            status: 'MATCHED',
            recommendedMaxRelativeError: 0,
            observedRelativeError: { state: 'known', value: 0 },
          },
        },
        transactionSemantics: {
          state: 'known',
          value: {
            assetFlows: [
              expect.objectContaining({
                instructionName: 'TransferChecked',
                assetKind: 'WRAPPED_SOL',
                amount: { state: 'known', value: '30' },
                sourceOwner: {
                  state: 'known',
                  value: '11111111111111111111111111111111',
                },
                destinationOwner: {
                  state: 'known',
                  value: 'Vote111111111111111111111111111111111111111',
                },
              }),
            ],
            tokenFlowReconciliation: expect.objectContaining({ status: 'MATCHED' }),
            loadedWritableAccountCount: 2,
            loadedReadonlyAccountCount: 1,
            accountCoverage: 1,
            recordingCoverage: 1,
            innerInstructions: [
              expect.objectContaining({
                path: 'outer:0/inner:0',
                programId: {
                  state: 'known',
                  value: 'ComputeBudget111111111111111111111111111111',
                },
              }),
            ],
            tokenBalanceChanges: [
              expect.objectContaining({
                account: expect.objectContaining({ state: 'known' }),
              }),
              expect.objectContaining({
                account: expect.objectContaining({ state: 'known' }),
              }),
            ],
          },
        },
      },
      metadata: {
        dataCoverage: 1,
        modelVersion: 'solana-transaction-query-v1.1.0',
      },
    });
    const evidence = response.json().evidence;
    expect(evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'TRANSACTION',
      'DERIVED_FEATURE',
      'DERIVED_FEATURE',
      'DERIVED_FEATURE',
      'DERIVED_FEATURE',
    ]);
    expect(evidence[3]).toMatchObject({
      source: 'zerotrace:solana-asset-flow-v1.0.0',
      locator: expect.stringContaining('asset-flow:'),
    });
    expect(runtime.evidenceLedger.get(evidence[3].id)?.sourceEvidenceIds).toEqual(
      [evidence[0].id, evidence[1].id].sort(),
    );
    expect(runtime.evidenceLedger.get(evidence[4].id)?.sourceEvidenceIds).toEqual(
      [evidence[0].id, evidence[1].id, evidence[2].id, evidence[3].id].sort(),
    );
  });

  it('suppresses automatic Bitcoin ownership merges for CoinJoin-like transaction structure', async () => {
    const runtime = runtimeWithAllLedgers();
    const txid = '9'.repeat(64);
    const vin = Array.from({ length: 3 }, (_, index) => ({
      txid: String(index + 1).padStart(64, '0'),
      vout: 0,
      prevout: {
        scriptpubkey: `0014${String(index + 1).repeat(40)}`,
        scriptpubkey_type: 'v0_p2wpkh',
        scriptpubkey_address: `bc1qparticipant${index + 1}`,
        value: 10_000,
      },
      is_coinbase: false,
      sequence: 4_294_967_295,
      scriptsig: '',
      scriptsig_asm: '',
      witness: ['30', `02${String(index + 4).repeat(64)}`],
    }));
    const vout = Array.from({ length: 3 }, (_, index) => ({
      scriptpubkey: `0014${String(index + 7).repeat(40)}`,
      scriptpubkey_type: 'v0_p2wpkh',
      scriptpubkey_address: `bc1qoutput${index + 1}`,
      value: 9_000,
    }));
    runtime.bitcoinAdapter = new BitcoinUtxoLedgerAdapter(
      { id: 'bitcoin-coinjoin-screening' },
      new FakeRestTransport({
        '/block-height/840000': 'b'.repeat(64),
        [`/block/${'b'.repeat(64)}`]: {
          id: 'b'.repeat(64),
          height: 840000,
          previousblockhash: 'a'.repeat(64),
        },
        [`/tx/${txid}`]: {
          txid,
          version: 2,
          locktime: 0,
          size: 300,
          weight: 1_200,
          fee: 3_000,
          vin,
          vout,
          status: {
            confirmed: true,
            block_height: 840000,
            block_hash: 'b'.repeat(64),
            block_time: 1_700_000_000,
          },
        },
      }),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/BITCOIN/TRANSACTION/${txid}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().facts).toMatchObject({
      feeReconciles: { state: 'known', value: true },
      structuralPattern: { state: 'known', value: 'EQUAL_OUTPUT_COINJOIN_LIKE' },
      commonInputHeuristic: { state: 'known', value: true },
      automaticOwnershipMergeAllowed: { state: 'known', value: false },
      ownershipConclusion: { state: 'unknown', reason: 'PRECISION_UNSAFE' },
      transactionEntityAnalysis: {
        state: 'known',
        value: {
          inputAddressCoverage: 1,
          equalOutputGroups: [{ valueSats: '9000', outputCount: 3, vouts: [0, 1, 2] }],
          structuralPattern: 'EQUAL_OUTPUT_COINJOIN_LIKE',
          automaticOwnershipMergeAllowed: false,
          suppressionReasons: expect.arrayContaining([
            'COINJOIN_EQUAL_OUTPUT_PATTERN',
            'PAYJOIN_NOT_EXCLUDABLE',
            'SERVICE_ATTRIBUTION_UNQUERIED',
          ]),
          changeCandidates: [],
          ownershipConclusion: { state: 'unknown', reason: 'PRECISION_UNSAFE' },
        },
      },
    });
    expect(response.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'TRANSACTION',
      'OFFICIAL_DOCUMENT',
      'DERIVED_FEATURE',
    ]);
    expect(runtime.evidenceLedger.get(response.json().evidence[2].id)?.sourceEvidenceIds).toEqual(
      [response.json().evidence[0].id, response.json().evidence[1].id].sort(),
    );
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
          vin: [
            {
              txid: 'f'.repeat(64),
              vout: 1,
              prevout: {
                scriptpubkey: `0014${'2'.repeat(40)}`,
                scriptpubkey_type: 'v0_p2wpkh',
                value: 300,
              },
              is_coinbase: false,
              sequence: 4_294_967_293,
              scriptsig: '',
              scriptsig_asm: '',
              witness: ['30', `02${'3'.repeat(64)}`],
            },
          ],
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
      optInRbfSignal: { state: 'known', value: true },
      effectiveMempoolReplaceability: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      cpfpPackageState: { state: 'unknown', reason: 'UNSUPPORTED' },
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
      scriptControl: {
        state: 'known',
        value: {
          scriptClass: 'P2WPKH',
          addressMatch: { state: 'known', value: true },
          hashPredicatePresent: { state: 'known', value: true },
          controllerIdentity: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        },
      },
      effectiveSpendingTransactionRbf: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      spendingTransactionCpfpPackage: { state: 'unknown', reason: 'UNSUPPORTED' },
    });
    expect(response.json().metadata.snapshot).toMatchObject({
      ledger: 'BITCOIN',
      height: '840000',
      mempoolSnapshot: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(response.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'TRANSACTION',
      'TRANSACTION',
      'UTXO',
      'DERIVED_FEATURE',
    ]);
    expect(runtime.evidenceLedger.get(response.json().evidence[0].id)).toBeDefined();
    expect(runtime.evidenceLedger.get(response.json().evidence[1].id)).toBeDefined();
  });

  it('keeps an unspent Taproot script tree and controller identity Unknown', async () => {
    const runtime = runtimeWithAllLedgers();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/BITCOIN/OUTPOINT/${fixtureBitcoinTransactionId}:1`,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().facts).toMatchObject({
      valueSats: { state: 'known', value: '13628' },
      spent: { state: 'known', value: false },
      spendingTxid: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      scriptControl: {
        state: 'known',
        value: {
          scriptClass: 'P2TR',
          addressMatch: { state: 'known', value: true },
          spendConditionVisibility: 'TAPROOT_OUTPUT_KEY_ONLY',
          taprootSpendPath: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
          controllerIdentity: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
          scriptConditionsComplete: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        },
      },
      effectiveSpendingTransactionRbf: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    });
    expect(response.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'TRANSACTION',
      'UTXO',
      'DERIVED_FEATURE',
    ]);
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
        spotPrice: { state: 'known', value: '0.000000000000002' },
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
      'OFFICIAL_DOCUMENT',
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

  it('paginates a durable Flap history projection by scan ID without provider access', async () => {
    const runtime = runtimeWithAllLedgers();
    const scanId = '44444444-4444-4444-8444-444444444444';
    const now = '2026-08-10T03:00:00.000Z';
    const get = vi.fn(async () => ({
      id: scanId,
      scanType: 'FLAP_EVENT_HISTORY',
      source: 'sqd:binance-mainnet',
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      subject: fixtureFlapToken,
      fromBlock: 100,
      toBlock: 103,
      chunkSize: 2,
      identityHash: '1'.repeat(64),
      identity: {},
      status: 'RUNNING' as const,
      nextBlock: 102,
      stateHash: '2'.repeat(64),
      state: {},
      evidenceIds: ['ev_000000000000000000000001'],
      lastErrorCode: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    }));
    const storedSegments = [
      {
        id: 'fhs_000000000000000000000001',
        scanId,
        chainId: 'eip155:56',
        token: fixtureFlapToken,
        fromBlock: 100,
        toBlock: 101,
        resultHash: '3'.repeat(64),
        result: { platform: 'flap', requestedRangeCoverage: 1 },
        snapshotHash: '4'.repeat(64),
        terminalEvidenceId: 'ev_000000000000000000000001',
        evidenceIds: ['ev_000000000000000000000001'],
        sourceSet: ['sqd:binance-mainnet'],
        modelVersion: 'flap-bounded-event-history-v1',
        transactionCount: 0,
        unrecognizedPortalLogCount: 0,
        createdAt: now,
      },
      {
        id: 'fhs_000000000000000000000002',
        scanId,
        chainId: 'eip155:56',
        token: fixtureFlapToken,
        fromBlock: 102,
        toBlock: 103,
        resultHash: '5'.repeat(64),
        result: { platform: 'flap', requestedRangeCoverage: 1 },
        snapshotHash: '6'.repeat(64),
        terminalEvidenceId: 'ev_000000000000000000000002',
        evidenceIds: ['ev_000000000000000000000002'],
        sourceSet: ['sqd:binance-mainnet'],
        modelVersion: 'flap-bounded-event-history-v1',
        transactionCount: 1,
        unrecognizedPortalLogCount: 0,
        createdAt: now,
      },
    ];
    const listSegments = vi.fn(async () => storedSegments);
    runtime.semanticCheckpoints = { get } as unknown as NonNullable<
      AppRuntime['semanticCheckpoints']
    >;
    runtime.flapHistoryProjection = { listSegments } as unknown as NonNullable<
      AppRuntime['flapHistoryProjection']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url:
        `/api/v1/launches/EVM/${fixtureFlapToken}/history/projections/${scanId}` +
        '?chainId=eip155:56&platform=flap&limit=1',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      scan: {
        id: scanId,
        status: 'RUNNING',
        token: fixtureFlapToken,
        requestedRange: { fromBlock: '100', toBlock: '103', segmentSize: 2 },
        nextBlock: '102',
        requestedRangeCoverage: 0.5,
        terminalResult: null,
      },
      page: { afterBlock: null, limit: 1, hasMore: true, nextAfterBlock: 100 },
      segments: [expect.objectContaining({ id: 'fhs_000000000000000000000001' })],
    });
    expect(get).toHaveBeenCalledWith(scanId);
    expect(listSegments).toHaveBeenCalledWith(scanId, { limit: 2 });

    const wrongToken = await app.inject({
      method: 'GET',
      url:
        `/api/v1/launches/EVM/0x${'b'.repeat(40)}/history/projections/${scanId}` +
        '?chainId=eip155:56',
    });
    expect(wrongToken.statusCode).toBe(404);
    expect(wrongToken.json().error.code).toBe('FLAP_HISTORY_PROJECTION_NOT_FOUND');
  });

  it('reports durable Flap history replay as unavailable without PostgreSQL', async () => {
    const runtime = runtimeWithAllLedgers();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url:
        `/api/v1/launches/EVM/${fixtureFlapToken}/history/projections/` +
        '44444444-4444-4444-8444-444444444444?chainId=eip155:56',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('FLAP_HISTORY_PROJECTION_UNAVAILABLE');
  });

  it('fails closed before segment reads when a completed Flap projection is corrupt', async () => {
    const runtime = runtimeWithAllLedgers();
    const scanId = '55555555-5555-4555-8555-555555555555';
    const listSegments = vi.fn();
    runtime.semanticCheckpoints = {
      get: vi.fn(async () => ({
        id: scanId,
        scanType: 'FLAP_EVENT_HISTORY',
        source: 'sqd:binance-mainnet',
        ledger: 'EVM',
        chainId: 'eip155:56',
        subject: fixtureFlapToken,
        status: 'REQUESTED_RANGE_COMPLETE',
        state: { result: { requestedRangeCoverage: 1 } },
      })),
    } as unknown as NonNullable<AppRuntime['semanticCheckpoints']>;
    runtime.flapHistoryProjection = { listSegments } as unknown as NonNullable<
      AppRuntime['flapHistoryProjection']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url:
        `/api/v1/launches/EVM/${fixtureFlapToken}/history/projections/${scanId}` +
        '?chainId=eip155:56&platform=flap',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('FLAP_HISTORY_PROJECTION_CONFLICT');
    expect(listSegments).not.toHaveBeenCalled();
  });

  it('replays an exact completed Flap lifetime materialization without provider access', async () => {
    const runtime = runtimeWithAllLedgers();
    const scanId = '66666666-6666-4666-8666-666666666666';
    const now = '2026-08-10T03:30:00.000Z';
    const historyEvidenceId = 'ev_000000000000000000000002';
    const terminalEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:flap-lifetime-materialization-v1',
      locator: `flap-lifetime:${fixtureFlapToken}@103`,
      payload: { token: fixtureFlapToken, lifetimeCoverage: true },
      observedAt: now,
      blockOrSlot: '103',
      finality: 'finalized',
      summary: 'Fixture exact Flap lifetime materialization.',
    });
    const result = {
      platform: 'flap',
      token: fixtureFlapToken,
      dataset: 'binance-mainnet',
      datasetStartBlock: '0',
      targetBlock: '103',
      originScanId: '11111111-1111-4111-8111-111111111111',
      originSearchCoverage: 1,
      origin: knownValue({
        contractCreator: `0x${'b'.repeat(40)}`,
        launchCreator: `0x${'c'.repeat(40)}`,
        bytecodeFingerprint: '4'.repeat(64),
        creationTrace: {
          transactionHash: `0x${'5'.repeat(64)}`,
          blockNumber: '100',
          blockHash: `0x${'6'.repeat(64)}`,
          transactionIndex: '1',
          traceAddress: [0],
        },
        tokenCreatedPosition: {
          transactionHash: `0x${'5'.repeat(64)}`,
          blockNumber: '100',
          blockHash: `0x${'6'.repeat(64)}`,
          transactionIndex: '1',
          logIndex: '0',
        },
        evidenceIds: ['ev_000000000000000000000001', 'ev_000000000000000000000004'],
      }),
      historyProjection: {
        scanId: '22222222-2222-4222-8222-222222222222',
        fromBlock: '100',
        toBlock: '103',
        segmentCount: 1,
        transactionCount: 1,
        unrecognizedPortalLogCount: 0,
        requestedRangeCoverage: 1,
        terminalEvidenceId: historyEvidenceId,
      },
      lifetimeCoverage: knownValue(true),
      terminalEvidenceId: terminalEvidence.id,
      metadata: {
        snapshot: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          blockNumber: '103',
          blockHash: `0x${'7'.repeat(64)}`,
          parentBlockHash: `0x${'8'.repeat(64)}`,
          finality: 'finalized',
          capturedAt: now,
          providerVersions: { 'bsc-rpc': 'json-rpc' },
          adapterVersions: { evm: '0.1.0' },
          configHash: '9'.repeat(64),
          entityModelVersion: 'entity-unapplied',
          labelSnapshot: 'labels-unapplied',
        },
        dataCoverage: 1,
        sourceCoverage: 1,
        historyCoverage: 1,
        simulationCoverage: 0,
        freshness: now,
        sourceSet: ['bsc-rpc', 'sqd:binance-mainnet'],
        modelVersion: 'flap-lifetime-materialization-v1',
        confidence: 0.97,
        evidenceIds: [historyEvidenceId, terminalEvidence.id],
      },
      evidence: [terminalEvidence],
    };
    const get = vi.fn(async () => ({
      id: scanId,
      scanType: 'FLAP_LIFETIME_MATERIALIZATION',
      source: 'zerotrace:flap-lifetime-materialization-v1',
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      subject: fixtureFlapToken,
      fromBlock: 0,
      toBlock: 103,
      chunkSize: 104,
      identityHash: '1'.repeat(64),
      identity: {},
      status: 'REQUESTED_RANGE_COMPLETE' as const,
      nextBlock: 104,
      stateHash: '2'.repeat(64),
      state: { version: 'flap-lifetime-materialization-checkpoint-v1', result },
      evidenceIds: [terminalEvidence.id],
      lastErrorCode: null,
      startedAt: now,
      updatedAt: now,
      completedAt: now,
    }));
    runtime.semanticCheckpoints = { get } as unknown as NonNullable<
      AppRuntime['semanticCheckpoints']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url:
        `/api/v1/launches/EVM/${fixtureFlapToken}/history/lifetime/materializations/${scanId}` +
        '?chainId=eip155:56&platform=flap',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      scan: {
        id: scanId,
        status: 'REQUESTED_RANGE_COMPLETE',
        dataset: 'binance-mainnet',
        datasetStartBlock: '0',
        targetBlock: '103',
        nextBlock: '104',
        requestedRangeCoverage: 1,
        terminalResult: {
          originScanId: '11111111-1111-4111-8111-111111111111',
          origin: { state: 'known' },
          historyProjection: {
            scanId: '22222222-2222-4222-8222-222222222222',
            requestedRangeCoverage: 1,
          },
          lifetimeCoverage: { state: 'known', value: true },
          terminalEvidenceId: terminalEvidence.id,
          metadata: { historyCoverage: 1, confidence: 0.97 },
        },
      },
    });
    expect(get).toHaveBeenCalledWith(scanId);
  });

  it('fails closed when a completed Flap lifetime checkpoint is corrupt', async () => {
    const runtime = runtimeWithAllLedgers();
    const scanId = '77777777-7777-4777-8777-777777777777';
    runtime.semanticCheckpoints = {
      get: vi.fn(async () => ({
        id: scanId,
        scanType: 'FLAP_LIFETIME_MATERIALIZATION',
        source: 'zerotrace:flap-lifetime-materialization-v1',
        ledger: 'EVM',
        chainId: 'eip155:56',
        subject: fixtureFlapToken,
        status: 'REQUESTED_RANGE_COMPLETE',
        state: { result: { lifetimeCoverage: { state: 'known', value: true } } },
      })),
    } as unknown as NonNullable<AppRuntime['semanticCheckpoints']>;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url:
        `/api/v1/launches/EVM/${fixtureFlapToken}/history/lifetime/materializations/${scanId}` +
        '?chainId=eip155:56',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SEMANTIC_CHECKPOINT_CONFLICT');
  });

  it('replays the latest accepted Flap lifetime head without provider access', async () => {
    const runtime = runtimeWithAllLedgers();
    const latestHead = vi.fn(async () => ({
      id: `flh_${'1'.repeat(24)}`,
      chainId: 'eip155:56' as const,
      token: fixtureFlapToken,
      sequence: 4,
      scanId: '88888888-8888-4888-8888-888888888888',
      headType: 'EXTENSION' as const,
      predecessorId: `flh_${'2'.repeat(24)}`,
      targetBlock: 105,
      targetHash: `0x${'7'.repeat(64)}`,
      resultHash: '3'.repeat(64),
      result: {
        platform: 'flap',
        token: fixtureFlapToken,
        targetBlock: '105',
        lifetimeCoverage: { state: 'known', value: true },
        terminalEvidenceId: `ev_${'4'.repeat(24)}`,
        metadata: {
          freshness: '2026-08-10T00:00:00.000Z',
          modelVersion: 'flap-lifetime-extension-v1',
        },
      },
      snapshotHash: '5'.repeat(64),
      terminalEvidenceId: `ev_${'4'.repeat(24)}`,
      createdAt: '2026-08-10T00:00:01.000Z',
    }));
    runtime.flapLifetimeHeads = { latestHead } as unknown as NonNullable<
      AppRuntime['flapLifetimeHeads']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url:
        `/api/v1/launches/EVM/${fixtureFlapToken}/history/lifetime/heads/latest` +
        '?chainId=eip155:56&platform=flap',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      head: {
        sequence: 4,
        headType: 'EXTENSION',
        targetBlock: 105,
        result: {
          lifetimeCoverage: { state: 'known', value: true },
          metadata: { modelVersion: 'flap-lifetime-extension-v1' },
        },
      },
    });
    expect(latestHead).toHaveBeenCalledWith('eip155:56', fixtureFlapToken);
  });

  it('distinguishes unconfigured and absent Flap lifetime heads', async () => {
    const unconfiguredRuntime = runtimeWithAllLedgers();
    const unconfiguredApp = await createApp({
      config,
      runtime: unconfiguredRuntime,
      logger: false,
    });
    apps.push(unconfiguredApp);
    const url =
      `/api/v1/launches/EVM/${fixtureFlapToken}/history/lifetime/heads/latest` +
      '?chainId=eip155:56';
    const unconfigured = await unconfiguredApp.inject({ method: 'GET', url });
    expect(unconfigured.statusCode).toBe(503);
    expect(unconfigured.json().error.code).toBe('FLAP_LIFETIME_HEAD_UNAVAILABLE');

    const emptyRuntime = runtimeWithAllLedgers();
    emptyRuntime.flapLifetimeHeads = {
      latestHead: vi.fn(async () => undefined),
    } as unknown as NonNullable<AppRuntime['flapLifetimeHeads']>;
    const emptyApp = await createApp({ config, runtime: emptyRuntime, logger: false });
    apps.push(emptyApp);
    const absent = await emptyApp.inject({ method: 'GET', url });
    expect(absent.statusCode).toBe(404);
    expect(absent.json().error.code).toBe('FLAP_LIFETIME_HEAD_NOT_FOUND');
  });

  it('resolves a bounded Flap contract origin from SQD and exact BSC receipt Evidence', async () => {
    const runtime = runtimeWithAllLedgers();
    let checkpointRun: FlapOriginCheckpointRun | undefined;
    const semanticCheckpoints: FlapOriginCheckpointStore = {
      begin: async (input) => {
        checkpointRun ??= {
          id: '11111111-1111-4111-8111-111111111111',
          status: 'RUNNING',
          nextBlock: input.fromBlock,
          state: input.initialState,
          evidenceIds: [],
        };
        return checkpointRun;
      },
      advance: async (id, input) => {
        if (checkpointRun?.id !== id || checkpointRun.nextBlock !== input.expectedNextBlock) {
          throw new Error('stale test checkpoint');
        }
        checkpointRun = {
          ...checkpointRun,
          nextBlock: input.completedToBlock + 1,
          state: input.state,
          evidenceIds: [...input.evidenceIds],
        };
        return checkpointRun;
      },
      finish: async (id, input) => {
        if (checkpointRun?.id !== id) throw new Error('missing test checkpoint');
        checkpointRun = {
          ...checkpointRun,
          status: 'REQUESTED_RANGE_COMPLETE',
          state: input.state,
          evidenceIds: [...input.evidenceIds],
        };
        return checkpointRun;
      },
      recordFailure: async () => {
        if (checkpointRun === undefined) throw new Error('missing test checkpoint');
        return checkpointRun;
      },
    };
    runtime.semanticCheckpoints = semanticCheckpoints as unknown as NonNullable<
      AppRuntime['semanticCheckpoints']
    >;
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
    const sqdCreations = vi.fn(async (query: { fromBlock: string; toBlock: string }) => ({
      endpointId: 'sqd:binance-mainnet',
      value: [
        {
          address: fixtureFlapToken,
          creator: '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0',
          bytecode: '0x60006000',
          blockHash: `0x${'6'.repeat(64)}`,
          blockNumber: '0x10',
          transactionHash: fixtureFlapEventTransactionHash,
          transactionIndex: '0x1',
          traceAddress: [0, 1],
          raw: {},
        },
      ],
      coverage: {
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
        nextBlock: (BigInt(query.toBlock) + 1n).toString(),
        finalizedHead: query.toBlock,
        responseBlockCount: 1,
        requestCount: 1,
        completion: 'REQUESTED_RANGE_COMPLETE' as const,
      },
    }));
    runtime.sqdBscCreationReader = { getContractCreationsObservation: sqdCreations };
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}/origin?chainId=eip155:56&platform=flap&fromBlock=16&toBlock=16`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      platform: 'flap',
      token: fixtureFlapToken,
      searchedRange: { fromBlock: '16', toBlock: '16' },
      searchedRangeCoverage: 1,
      origin: {
        state: 'known',
        value: {
          contractCreator: '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0',
          launchCreator: `0x${'c'.repeat(40)}`,
          creationTrace: { blockNumber: '16', transactionIndex: '1', traceAddress: [0, 1] },
          tokenCreatedPosition: { blockNumber: '16', logIndex: '0' },
        },
      },
      lifetimeCoverage: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      metadata: { historyCoverage: 0, modelVersion: 'flap-token-origin-v1' },
    });
    expect(response.json().evidence.map((item: { kind: string }) => item.kind)).toEqual([
      'PROVIDER_OBSERVATION',
      'RECEIPT',
      'LOG',
      'PROVIDER_OBSERVATION',
      'DERIVED_FEATURE',
      'TRACE',
      'DERIVED_FEATURE',
    ]);
    expect(sqdCreations).toHaveBeenCalledWith({
      address: fixtureFlapToken,
      fromBlock: '16',
      toBlock: '16',
    });
    const derivedId = response.json().evidence.at(-1).id;
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${derivedId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(drilldown.json().nodes).toHaveLength(7);

    const terminalReplay = await app.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}/origin?chainId=eip155:56&platform=flap&fromBlock=16&toBlock=16`,
    });
    expect(terminalReplay.statusCode, terminalReplay.body).toBe(200);
    expect(terminalReplay.json()).toEqual(response.json());
    expect(sqdCreations).toHaveBeenCalledOnce();
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
      'OFFICIAL_DOCUMENT',
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

  it('returns same-Snapshot Pancake V2 spot and multi-size buy scenarios for migrated Flap tokens', async () => {
    const runtime = runtimeWithAllLedgers();
    const quoteReserve = 1_000n * 10n ** 18n;
    const tokenReserve = 1_000_000n * 10n ** 18n;
    const quoteInputs = [100n * 10n ** 18n, 1_000n * 10n ** 18n];
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
          fixtureFlapV8SafeResult({
            status: 4,
            quoteTokenAddress: fixtureFlapQuoteAsset,
            pool: fixtureFlapPool,
            dexId: 0,
          }),
          fixtureAddressResult(PANCAKE_V2_BSC_DEPLOYMENT.factory),
          fixtureAddressResult(fixtureFlapQuoteAsset),
          fixtureAddressResult(fixtureFlapToken),
          fixtureReservesResult(quoteReserve, tokenReserve),
          fixtureAddressResult(fixtureFlapPool),
          fixtureAddressResult(PANCAKE_V2_BSC_DEPLOYMENT.factory),
          fixtureDecimalsResult(18),
          fixtureDecimalsResult(18),
          ...quoteInputs.map((input) =>
            fixtureAmountsOutResult(
              input,
              fixturePancakeAmountOut(input, quoteReserve, tokenReserve),
            ),
          ),
        ]),
      ),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-buy-scenarios',
      payload: {
        chainId: 'eip155:56',
        platform: 'flap',
        token: fixtureFlapToken,
        quoteInputs: ['100', '1000'],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      platform: 'flap',
      token: fixtureFlapToken,
      market: {
        state: 'known',
        value: {
          pool: fixtureFlapPool,
          quoteAsset: fixtureFlapQuoteAsset,
          currentSpotPrice: '0.001',
          dexFeeBps: '25',
        },
      },
      scenarios: [
        {
          quoteInput: { decimal: '100' },
          deterministicQuoteErrorBps: '0',
          withinDeterministicTolerance: true,
          executionNetTokenOutput: { state: 'unknown', reason: 'NOT_QUERIED' },
        },
        { quoteInput: { decimal: '1000' } },
      ],
      validation: { status: 'PASS', evaluatedScenarioCount: 2, failedScenarioCount: 0 },
      pensionSinkTreatment: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      metadata: {
        snapshot: { chainId: 'eip155:56', blockNumber: '16' },
        modelVersion: 'flap-pancake-v2-pool-buy-scenarios-v0.1.0',
        sourceCoverage: 0.5,
        simulationCoverage: 0.5,
      },
    });
    const terminalId = response.json().terminalEvidenceId;
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${terminalId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(drilldown.json().nodes.length).toBeGreaterThan(15);
  });

  it('keeps Flap Pancake V2 scenarios explicitly unavailable without a BSC provider', async () => {
    const app = await createApp({ config, runtime: runtimeWithAllLedgers(), logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-buy-scenarios',
      payload: {
        chainId: 'eip155:56',
        platform: 'flap',
        token: fixtureFlapToken,
        quoteInputs: ['100'],
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      market: { state: 'unavailable', reason: 'PROVIDER_UNCONFIGURED' },
      scenarios: [],
      validation: { status: 'NOT_RUN', evaluatedScenarioCount: 0, failedScenarioCount: 0 },
      terminalEvidenceId: null,
      evidence: [],
    });
  });

  it('returns same-Snapshot Pancake V2 sell RV layers without presenting estimates as execution', async () => {
    const runtime = runtimeWithAllLedgers();
    const quoteReserve = 1_000n * 10n ** 18n;
    const tokenReserve = 1_000_000n * 10n ** 18n;
    const certificationInput = 1n * 10n ** 18n;
    const tokenInputs = [1_000n * 10n ** 18n, 10_000n * 10n ** 18n];
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
          fixtureFlapV8SafeResult({
            status: 4,
            quoteTokenAddress: fixtureFlapQuoteAsset,
            pool: fixtureFlapPool,
            dexId: 0,
          }),
          fixtureAddressResult(PANCAKE_V2_BSC_DEPLOYMENT.factory),
          fixtureAddressResult(fixtureFlapQuoteAsset),
          fixtureAddressResult(fixtureFlapToken),
          fixtureReservesResult(quoteReserve, tokenReserve),
          fixtureAddressResult(fixtureFlapPool),
          fixtureAddressResult(PANCAKE_V2_BSC_DEPLOYMENT.factory),
          fixtureDecimalsResult(18),
          fixtureDecimalsResult(18),
          fixtureAmountsOutResult(
            certificationInput,
            fixturePancakeAmountOut(certificationInput, quoteReserve, tokenReserve),
          ),
          ...tokenInputs.map((input) =>
            fixtureAmountsOutResult(
              input,
              fixturePancakeAmountOut(input, tokenReserve, quoteReserve),
            ),
          ),
        ]),
      ),
    );
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-sell-scenarios',
      payload: {
        chainId: 'eip155:56',
        platform: 'flap',
        token: fixtureFlapToken,
        tokenInputs: ['1000', '10000'],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      market: {
        state: 'known',
        value: {
          currentSpotPrice: '0.001',
          configuredSellTaxBps: { state: 'known', value: '700' },
        },
      },
      scenarios: [
        {
          tokenInput: { decimal: '1000' },
          nominalSpotQuoteValue: { decimal: '1' },
          withinDeterministicTolerance: true,
          configuredTaxTokenInputToPool: { state: 'known', value: { decimal: '930' } },
          configuredTaxNetQuoteOutput: { state: 'known' },
          executionNetQuoteOutput: { state: 'unknown', reason: 'NOT_QUERIED' },
        },
        { tokenInput: { decimal: '10000' } },
      ],
      validation: { status: 'PASS', evaluatedScenarioCount: 2, failedScenarioCount: 0 },
      executionCapacity: { state: 'unknown', reason: 'NOT_QUERIED' },
      metadata: {
        snapshot: { chainId: 'eip155:56', blockNumber: '16' },
        modelVersion: 'flap-pancake-v2-pool-sell-scenarios-v0.1.0',
        sourceCoverage: 0.5,
        simulationCoverage: 0.5,
      },
    });
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${response.json().terminalEvidenceId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(drilldown.json().nodes.length).toBeGreaterThan(18);
  });

  it('keeps Flap Pancake V2 sell scenarios unavailable without a BSC provider', async () => {
    const app = await createApp({ config, runtime: runtimeWithAllLedgers(), logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-sell-scenarios',
      payload: {
        chainId: 'eip155:56',
        platform: 'flap',
        token: fixtureFlapToken,
        tokenInputs: ['1000'],
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      market: { state: 'unavailable', reason: 'PROVIDER_UNCONFIGURED' },
      scenarios: [],
      validation: { status: 'NOT_RUN' },
      executionCapacity: { state: 'unknown', reason: 'NOT_QUERIED' },
      terminalEvidenceId: null,
      evidence: [],
    });
  });

  it('reconciles complete Flap market, buy and sell certificates across documented operators', async () => {
    const runtime = runtimeWithAllLedgers();
    const quoteReserve = 1_000n * 10n ** 18n;
    const tokenReserve = 1_000_000n * 10n ** 18n;
    const quoteInput = 100n * 10n ** 18n;
    const tokenInput = 1_000n * 10n ** 18n;
    const sourceIds = [
      'bsc-rpc@bnb-mainnet.g.alchemy.com#1',
      'bsc-rpc@bsc-dataseed.bnbchain.org#2',
    ];
    configureReconciliationRuntime(runtime, {
      sourceIds,
      quoteReserve,
      tokenReserves: [tokenReserve, tokenReserve],
      quoteInput,
      tokenInput,
    });
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'flap-pancake-v2-multi-source-reconciliation',
        status: 'IMPLEMENTED_OPERATOR_INDEPENDENCE_CONFIGURED',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-reconciliation',
      payload: {
        chainId: 'eip155:56',
        platform: 'flap',
        token: fixtureFlapToken,
        quoteInputs: ['100'],
        tokenInputs: ['1000'],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      platform: 'flap',
      token: fixtureFlapToken,
      status: 'PASS',
      blockNumber: '16',
      sourceIndependence: {
        status: 'VERIFIED_INDEPENDENT',
        independence: { state: 'known', value: true },
        observedSources: 2,
        operatorCount: 2,
      },
      sources: [
        { sourceId: sourceIds[0], operatorId: { state: 'known', value: 'alchemy' } },
        { sourceId: sourceIds[1], operatorId: { state: 'known', value: 'bnb-chain' } },
      ],
      audit: {
        status: 'PASS',
        summary: { failed: 0, inconclusive: 0 },
      },
      metadata: { sourceCoverage: 1 },
    });
    expect(
      response
        .json()
        .audit.checks.filter(
          (check: { comparisonClass: string }) =>
            check.comparisonClass === 'INDEPENDENT_MARKET_QUOTE_RV',
        ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: 'PASS',
          sourceIndependence: { state: 'known', value: true },
          relativeErrorPct: { state: 'known', value: '0' },
        }),
      ]),
    );
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${response.json().terminalEvidenceId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(drilldown.json().nodes.length).toBeGreaterThan(40);
  });

  it('keeps repeated endpoints from one documented operator inconclusive', async () => {
    const runtime = runtimeWithAllLedgers();
    const sourceIds = [
      'bsc-rpc@bsc-dataseed.bnbchain.org#1',
      'bsc-rpc@bsc-dataseed-public.bnbchain.org#2',
    ];
    configureReconciliationRuntime(runtime, {
      sourceIds,
      quoteReserve: 1_000n * 10n ** 18n,
      tokenReserves: [1_000_000n * 10n ** 18n, 1_000_000n * 10n ** 18n],
      quoteInput: 100n * 10n ** 18n,
      tokenInput: 1_000n * 10n ** 18n,
    });
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'flap-pancake-v2-multi-source-reconciliation',
        status: 'IMPLEMENTED_SAME_OPERATOR_INCONCLUSIVE',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-reconciliation',
      payload: {
        chainId: 'eip155:56',
        token: fixtureFlapToken,
        quoteInputs: ['100'],
        tokenInputs: ['1000'],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'INCONCLUSIVE',
      sourceIndependence: {
        status: 'SAME_OPERATOR',
        independence: { state: 'known', value: false },
        operatorCount: 1,
      },
      audit: { status: 'INCONCLUSIVE', summary: { failed: 0, inconclusive: 2 } },
      metadata: { sourceCoverage: 0.5 },
    });
  });

  it('keeps unregistered endpoint operators unknown with replayable registry Evidence', async () => {
    const runtime = runtimeWithAllLedgers();
    configureReconciliationRuntime(runtime, {
      sourceIds: ['bsc-rpc@rpc-one.example#1', 'bsc-rpc@rpc-two.example#2'],
      quoteReserve: 1_000n * 10n ** 18n,
      tokenReserves: [1_000_000n * 10n ** 18n, 1_000_000n * 10n ** 18n],
      quoteInput: 100n * 10n ** 18n,
      tokenInput: 1_000n * 10n ** 18n,
    });
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'flap-pancake-v2-multi-source-reconciliation',
        status: 'IMPLEMENTED_OPERATOR_REGISTRY_INCOMPLETE',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-reconciliation',
      payload: {
        chainId: 'eip155:56',
        token: fixtureFlapToken,
        quoteInputs: ['100'],
        tokenInputs: ['1000'],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'INCONCLUSIVE',
      sourceIndependence: {
        status: 'INCONCLUSIVE',
        independence: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
        operatorCount: 0,
        unresolvedSources: ['bsc-rpc@rpc-one.example#1', 'bsc-rpc@rpc-two.example#2'],
        attestations: [],
      },
      audit: { status: 'INCONCLUSIVE', summary: { failed: 0, inconclusive: 2 } },
      metadata: { sourceCoverage: 0.5 },
    });
    const drilldown = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${response.json().sourceIndependence.terminalEvidenceId}/drilldown`,
    });
    expect(drilldown.statusCode, drilldown.body).toBe(200);
    expect(
      drilldown
        .json()
        .nodes.some(
          (node: { evidence: { id: string } }) =>
            node.evidence.id === response.json().sourceIndependence.registryEvidenceId,
        ),
    ).toBe(true);
  });

  it('fails exact market state when agreed providers return conflicting reserves', async () => {
    const runtime = runtimeWithAllLedgers();
    configureReconciliationRuntime(runtime, {
      sourceIds: ['bsc-rpc@bnb-mainnet.g.alchemy.com#1', 'bsc-rpc@bsc-dataseed.bnbchain.org#2'],
      quoteReserve: 1_000n * 10n ** 18n,
      tokenReserves: [1_000_000n * 10n ** 18n, 1_000_001n * 10n ** 18n],
      quoteInput: 100n * 10n ** 18n,
      tokenInput: 1_000n * 10n ** 18n,
    });
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-reconciliation',
      payload: {
        chainId: 'eip155:56',
        token: fixtureFlapToken,
        quoteInputs: ['100'],
        tokenInputs: ['1000'],
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'FAIL',
      sourceIndependence: { status: 'VERIFIED_INDEPENDENT' },
      audit: { status: 'FAIL' },
    });
    expect(
      response
        .json()
        .audit.checks.find((check: { fieldPath: string }) =>
          check.fieldPath.endsWith('.market.tokenReserve.atomic'),
        ),
    ).toMatchObject({ disposition: 'FAIL', severity: 'CRITICAL' });
  });

  it('refuses market reads when BSC anchors disagree', async () => {
    const runtime = runtimeWithAllLedgers();
    configureReconciliationRuntime(runtime, {
      sourceIds: ['bsc-rpc@bnb-mainnet.g.alchemy.com#1', 'bsc-rpc@bsc-dataseed.bnbchain.org#2'],
      quoteReserve: 1_000n * 10n ** 18n,
      tokenReserves: [1_000_000n * 10n ** 18n, 1_000_000n * 10n ** 18n],
      quoteInput: 100n * 10n ** 18n,
      tokenInput: 1_000n * 10n ** 18n,
      blockHashes: [`0x${'6'.repeat(64)}`, `0x${'7'.repeat(64)}`],
    });
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-reconciliation',
      payload: {
        chainId: 'eip155:56',
        token: fixtureFlapToken,
        quoteInputs: ['100'],
        tokenInputs: ['1000'],
      },
    });

    expect(response.statusCode, response.body).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'ANCHOR_DISAGREEMENT', retryable: false },
      anchorReconciliation: { status: 'DISAGREEMENT' },
    });
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

    const oversizedOriginRange = await app.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}/origin?chainId=eip155:56&fromBlock=0&toBlock=1000000`,
    });
    expect(oversizedOriginRange.statusCode).toBe(400);
    expect(oversizedOriginRange.json().error.code).toBe('INVALID_REQUEST');

    const excessiveOriginChunks = await app.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}/origin?chainId=eip155:56&fromBlock=0&toBlock=1000&chunkSize=1`,
    });
    expect(excessiveOriginChunks.statusCode).toBe(400);
    expect(excessiveOriginChunks.json().error.code).toBe('INVALID_REQUEST');

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
    const unavailableFlapOrigin = await degraded.inject({
      method: 'GET',
      url: `/api/v1/launches/EVM/${fixtureFlapToken}/origin?chainId=eip155:56&fromBlock=16&toBlock=17`,
    });
    expect(unavailableFlapOrigin.statusCode).toBe(503);
    expect(unavailableFlapOrigin.json()).toMatchObject({
      searchedRangeCoverage: 0,
      origin: { state: 'unavailable', reason: 'PROVIDER_UNCONFIGURED' },
      lifetimeCoverage: { state: 'unavailable', reason: 'PROVIDER_UNCONFIGURED' },
      observedCreationCount: 0,
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
    attachEntityReportDurability(runtime);
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
    expect(entity.statusCode, entity.body).toBe(200);
    expect(entity.json()).toMatchObject({
      classification: 'CONFIRMED_SAME_CONTROLLER',
      automaticOwnershipMergeAllowed: false,
      terminalEvidenceId: expect.stringMatching(/^ev_[0-9a-f]{24}$/),
      evidence: expect.arrayContaining([expect.objectContaining({ kind: 'DERIVED_FEATURE' })]),
      durableReport: {
        id: expect.stringMatching(/^erh_[0-9a-f]{24}$/),
        resultHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        replayed: false,
      },
    });
    const reportId = entity.json().durableReport.id as string;
    runtime.providerRegistry = new ProviderRegistry([]);
    runtime.evmAdapters = new Map();
    const latest = await app.inject({
      method: 'GET',
      url: '/api/v1/entities/relationships/reports/latest?ledger=EVM&chainId=eip155%3A1&subjectA=module&subjectB=controller',
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({
      replayed: true,
      record: {
        id: reportId,
        report: { automaticOwnershipMergeAllowed: false },
      },
    });
    const exact = await app.inject({
      method: 'GET',
      url: `/api/v1/entities/relationships/reports/${reportId}?ledger=EVM&chainId=eip155%3A1&subjectA=controller&subjectB=module`,
    });
    expect(exact.statusCode).toBe(200);
    expect(exact.json()).toEqual(latest.json());

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

  it('fails featureful Entity inference closed without durability and rejects ungrounded merge hints', async () => {
    const runtime = runtimeWithEvm();
    const source = addFixtureEvidence(runtime);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const basePayload = {
      subjectA: 'controller',
      subjectB: 'module',
      features: [
        {
          kind: 'COMMON_FUNDER',
          strength: 0.8,
          reliability: 0.9,
          evidenceId: source.id,
        },
      ],
      metadata: fixtureMetadata(source.id),
    };

    const unavailable = await app.inject({
      method: 'POST',
      url: '/api/v1/entities/resolve',
      payload: basePayload,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ error: { code: 'DURABLE_STORAGE_REQUIRED' } });

    const serviceWithoutEvidence = await app.inject({
      method: 'POST',
      url: '/api/v1/entities/resolve',
      payload: { ...basePayload, subjectAIsService: true },
    });
    expect(serviceWithoutEvidence.statusCode).toBe(400);

    const duplicateFeature = await app.inject({
      method: 'POST',
      url: '/api/v1/entities/resolve',
      payload: { ...basePayload, features: [basePayload.features[0], basePayload.features[0]] },
    });
    expect(duplicateFeature.statusCode).toBe(400);

    const labelMergeHint = await app.inject({
      method: 'POST',
      url: '/api/v1/entities/resolve',
      payload: { ...basePayload, features: [], riskLabel: 'SCAM' },
    });
    expect(labelMergeHint.statusCode).toBe(400);
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

  it('parses user-supplied claim declarations into persisted Analyst Evidence and review drafts', async () => {
    const runtime = runtimeWithEvm();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/claims/declarations/parse',
      payload: {
        chainId: 'eip155:56',
        assetId: 'eip155:56:erc20:0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
        text:
          '税费接收总钱包（100%）\n0x8231Bb4E2891e85E79f28f0816EDE7AeAab06af1\n' +
          '社区建设基金（20%）\n0x412DFD5Ac528C05ab78cd005385bC51759e29e46',
        auditWindow: {
          from: '2026-08-02T00:00:00.000Z',
          to: '2026-08-10T00:00:00.000Z',
        },
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.evidence).toMatchObject({
      kind: 'ANALYST_OBSERVATION',
      source: 'api:user-submitted-claim-declaration',
      chainId: 'eip155:56',
    });
    expect(body.drafts).toHaveLength(2);
    expect(body.drafts[1]).toMatchObject({
      role: 'COMMUNITY_FUND',
      sourceAddress: {
        state: 'known',
        value: '0x8231bb4e2891e85e79f28f0816ede7aeaab06af1',
      },
      destinationAddress: {
        state: 'known',
        value: '0x412dfd5ac528c05ab78cd005385bc51759e29e46',
      },
      expectedShareBps: { state: 'known', value: '2000' },
      chainVerifyReadiness: 'READY_FOR_REVIEW',
      requiresHumanReview: true,
    });

    const evidence = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${body.evidence.id}`,
    });
    expect(evidence.statusCode, evidence.body).toBe(200);
    expect(evidence.json()).toMatchObject({
      evidence: { id: body.evidence.id, kind: 'ANALYST_OBSERVATION' },
      sourceEvidenceIds: [],
    });

    const wrongChain = await app.inject({
      method: 'POST',
      url: '/api/v1/claims/declarations/parse',
      payload: {
        chainId: 'eip155:56',
        assetId: 'eip155:1:erc20:token',
        text: '社区建设基金（20%）',
      },
    });
    expect(wrongChain.statusCode).toBe(400);
    expect(wrongChain.json().error.code).toBe('INVALID_REQUEST');

    const unsafeSource = await app.inject({
      method: 'POST',
      url: '/api/v1/claims/declarations/parse',
      payload: {
        chainId: 'eip155:56',
        assetId: 'eip155:56:erc20:0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
        text: '社区建设基金（20%）',
        sourceUri: 'javascript:alert(1)',
      },
    });
    expect(unsafeSource.statusCode).toBe(400);
    expect(unsafeSource.json().error.code).toBe('INVALID_REQUEST');

    const invalidAsset = await app.inject({
      method: 'POST',
      url: '/api/v1/claims/declarations/parse',
      payload: {
        chainId: 'eip155:56',
        assetId: 'eip155:56:erc20:not-an-address',
        text: '社区建设基金（20%）',
      },
    });
    expect(invalidAsset.statusCode).toBe(400);
    expect(invalidAsset.json().error.code).toBe('INVALID_REQUEST');
  });

  it('derives a persisted burn action only from exact block supply/event conservation', async () => {
    const evm = new EvmLedgerAdapter(
      {
        id: 'bsc-rpc',
        chainId: 56,
        chainName: 'BNB Smart Chain',
        snapshotBlockTag: 'finalized',
      },
      new BurnConservationTransport(),
    );
    const evidenceLedger = new EvidenceLedger();
    const runtime: AppRuntime = {
      providerRegistry: new ProviderRegistry([evm]),
      evmAdapters: new Map([[56, evm]]),
      evidenceLedger,
      dataQuality: testDataQuality(evidenceLedger),
      ingestionStorage: {},
    };
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/burn-conservation`,
      payload: { chainId: 'eip155:56', blockNumber: '100' },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.report).toMatchObject({
      tokenAddress: fixtureFlapToken,
      blockNumber: '100',
      parentBlockNumber: '99',
      totalSupplyBefore: '1000',
      totalSupplyAfter: '900',
      burnedAmount: '100',
      status: 'VERIFIED',
      actions: [
        {
          type: 'BURN',
          actor: `0x${'2'.repeat(40)}`,
          amount: '100',
          path: [`0x${'2'.repeat(40)}`, `0x${'0'.repeat(40)}`],
        },
      ],
    });
    expect(body.evidence).toHaveLength(5);
    const terminal = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${body.report.terminalEvidenceId}`,
    });
    expect(terminal.statusCode, terminal.body).toBe(200);
    expect(terminal.json()).toMatchObject({
      evidence: { kind: 'DERIVED_FEATURE', blockOrSlot: '100' },
    });
    expect(terminal.json().sourceEvidenceIds).toHaveLength(4);

    const invalidGenesis = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/burn-conservation`,
      payload: { chainId: 'eip155:56', blockNumber: '0' },
    });
    expect(invalidGenesis.statusCode).toBe(400);
    expect(invalidGenesis.json().error.code).toBe('INVALID_REQUEST');
  });

  it('discovers long-range zero-address burn candidates without claiming silent supply coverage', async () => {
    const evm = new EvmLedgerAdapter(
      {
        id: 'bsc-rpc',
        chainId: 56,
        chainName: 'BNB Smart Chain',
        snapshotBlockTag: 'finalized',
      },
      new BurnDiscoveryAnchorTransport(),
    );
    const evidenceLedger = new EvidenceLedger();
    const burner = `0x${'2'.repeat(40)}`;
    const sqdBscLogReader = {
      endpointId: 'sqd:binance-mainnet',
      getLogsObservation: vi.fn().mockImplementation((query) => {
        const toZero = query.topics?.[2] === `0x${'0'.repeat(64)}`;
        return Promise.resolve({
          endpointId: 'sqd:binance-mainnet',
          value: toZero
            ? [
                {
                  address: fixtureFlapToken,
                  blockHash: `0x${105n.toString(16).padStart(64, '0')}`,
                  blockNumber: '0x69',
                  blockTimestamp: '2026-08-10T00:00:15.000Z',
                  transactionHash: `0x${'5'.repeat(64)}`,
                  transactionIndex: '0x1',
                  logIndex: '0x2',
                  data: `0x${100n.toString(16).padStart(64, '0')}`,
                  topics: [
                    ERC20_TRANSFER_TOPIC,
                    `0x${'0'.repeat(24)}${burner.slice(2)}`,
                    `0x${'0'.repeat(64)}`,
                  ],
                  removed: false,
                  raw: { fixture: true },
                },
              ]
            : [],
        });
      }),
    };
    const runtime: AppRuntime = {
      providerRegistry: new ProviderRegistry([evm]),
      evmAdapters: new Map([[56, evm]]),
      sqdBscLogReader,
      evidenceLedger,
      dataQuality: testDataQuality(evidenceLedger),
      ingestionStorage: {},
    };
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/burn-candidates`,
      payload: { chainId: 'eip155:56', fromBlock: '100', toBlock: '110' },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.report).toMatchObject({
      status: 'CANDIDATES_DISCOVERED',
      coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS',
      zeroAddressEventCount: 1,
      burnCandidateCount: 1,
      silentSupplyChangeDetection: { state: 'unknown', reason: 'NOT_QUERIED' },
      candidates: [{ blockNumber: '105', burnedEventAmount: '100' }],
    });
    expect(body.evidence).toHaveLength(4);
    const terminal = await app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${body.report.terminalEvidenceId}`,
    });
    expect(terminal.statusCode, terminal.body).toBe(200);
    expect(terminal.json().sourceEvidenceIds).toHaveLength(3);

    const invalidRange = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/burn-candidates`,
      payload: { chainId: 'eip155:56', fromBlock: '111', toBlock: '110' },
    });
    expect(invalidRange.statusCode).toBe(400);
    expect(invalidRange.json().error.code).toBe('INVALID_REQUEST');

    const oversizedRange = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/burn-candidates`,
      payload: { chainId: 'eip155:56', fromBlock: '0', toBlock: '5000000' },
    });
    expect(oversizedRange.statusCode).toBe(400);
    expect(oversizedRange.json().error.code).toBe('INVALID_REQUEST');
  });

  it('replays a completed durable burn promotion without provider access', async () => {
    const runtime = runtimeWithAllLedgers();
    const scanId = '77777777-7777-4777-8777-777777777777';
    const discoveryEvidenceId = 'ev_000000000000000000000071';
    const terminalEvidenceId = 'ev_000000000000000000000072';
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '103',
      blockHash: `0x${'3'.repeat(64)}`,
      parentBlockHash: `0x${'2'.repeat(64)}`,
      finality: 'finalized' as const,
      capturedAt: '2026-08-11T01:00:00.000Z',
      blockTimestamp: '2026-08-11T00:59:57.000Z',
      providerVersions: { 'bsc-rpc@example': 'evm-ledger-v0.1.0' },
      adapterVersions: { evm: 'evm-ledger-v0.1.0' },
      configHash: '4'.repeat(64),
      entityModelVersion: 'entity-model-unapplied',
      labelSnapshot: 'labels-unapplied',
    };
    const segment = {
      fromBlock: '100',
      toBlock: '103',
      zeroAddressEventCount: 0,
      burnCandidateCount: 0,
      discoveryTerminalEvidenceId: discoveryEvidenceId,
      certificates: [],
      snapshot,
      sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
    };
    const result = {
      tokenAddress: fixtureFlapToken,
      fromBlock: '100',
      toBlock: '103',
      coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION',
      status: 'REQUESTED_RANGE_COMPLETE',
      segmentCount: 1,
      zeroAddressEventCount: 0,
      burnCandidateCount: 0,
      verifiedCandidateCount: 0,
      contradictedCandidateCount: 0,
      verifiedActionCount: 0,
      segments: [segment],
      silentSupplyChangeDetection: { state: 'unknown', reason: 'NOT_QUERIED' },
      terminalEvidenceId,
      metadata: {
        snapshot,
        dataCoverage: 1,
        sourceCoverage: 0.5,
        historyCoverage: 1,
        simulationCoverage: 0,
        freshness: snapshot.blockTimestamp,
        sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
        modelVersion: 'erc20-burn-candidate-promotion-v1.0.0',
        confidence: 0.98,
        evidenceIds: [discoveryEvidenceId, terminalEvidenceId],
      },
    };
    const now = '2026-08-11T01:01:00.000Z';
    const get = vi.fn(async () => ({
      id: scanId,
      scanType: 'ERC20_BURN_CANDIDATE_PROMOTION',
      source: 'sqd:binance-mainnet',
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      subject: fixtureFlapToken,
      fromBlock: 100,
      toBlock: 103,
      chunkSize: 4,
      identityHash: '5'.repeat(64),
      identity: {},
      status: 'REQUESTED_RANGE_COMPLETE' as const,
      nextBlock: 104,
      stateHash: '6'.repeat(64),
      state: {
        version: 'erc20-burn-candidate-promotion-checkpoint-v1',
        segments: [segment],
        snapshot,
        sourceSet: ['bsc-rpc@example', 'sqd:binance-mainnet'],
        result,
      },
      evidenceIds: [discoveryEvidenceId, terminalEvidenceId],
      lastErrorCode: null,
      startedAt: now,
      updatedAt: now,
      completedAt: now,
    }));
    runtime.semanticCheckpoints = { get } as unknown as NonNullable<
      AppRuntime['semanticCheckpoints']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/burn-promotions/${scanId}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      scan: {
        id: scanId,
        status: 'REQUESTED_RANGE_COMPLETE',
        requestedRangeCoverage: 1,
        nextBlock: '104',
      },
      terminalResult: {
        status: 'REQUESTED_RANGE_COMPLETE',
        burnCandidateCount: 0,
        silentSupplyChangeDetection: { state: 'unknown', reason: 'NOT_QUERIED' },
        terminalEvidenceId,
      },
    });
    expect(get).toHaveBeenCalledWith(scanId);

    const wrongToken = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/EVM/0x${'b'.repeat(40)}/burn-promotions/${scanId}`,
    });
    expect(wrongToken.statusCode).toBe(404);
    expect(wrongToken.json().error.code).toBe('BURN_PROMOTION_NOT_FOUND');
  });

  it('reports durable burn promotion replay as unavailable without PostgreSQL', async () => {
    const runtime = runtimeWithAllLedgers();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url:
        `/api/v1/claims/EVM/${fixtureFlapToken}/burn-promotions/` +
        '88888888-8888-4888-8888-888888888888',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('BURN_PROMOTION_REPLAY_UNAVAILABLE');
  });

  it('replays a completed all-block ERC-20 supply-continuity result without providers', async () => {
    const runtime = runtimeWithAllLedgers();
    const scanId = '99999999-9999-4999-8999-999999999999';
    const sourceSet = [
      'bsc-rpc@bnb-mainnet.g.alchemy.com#1',
      'bsc-rpc@bsc-dataseed.bnbchain.org#2',
    ];
    const registryEvidenceId = 'ev_000000000000000000000081';
    const firstAttestationId = 'ev_000000000000000000000082';
    const secondAttestationId = 'ev_000000000000000000000083';
    const independenceEvidenceId = 'ev_000000000000000000000084';
    const segmentEvidenceId = 'ev_000000000000000000000085';
    const terminalEvidenceId = 'ev_000000000000000000000086';
    const evidenceIds = [
      registryEvidenceId,
      firstAttestationId,
      secondAttestationId,
      independenceEvidenceId,
      segmentEvidenceId,
      terminalEvidenceId,
    ];
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '102',
      blockHash: `0x${'3'.repeat(64)}`,
      parentBlockHash: `0x${'2'.repeat(64)}`,
      finality: 'finalized' as const,
      capturedAt: '2026-08-11T02:00:00.000Z',
      blockTimestamp: '2026-08-11T01:59:57.000Z',
      providerVersions: Object.fromEntries(sourceSet.map((source) => [source, 'json-rpc'])),
      adapterVersions: { evm: '0.1.0' },
      configHash: '4'.repeat(64),
      entityModelVersion: 'entity-model-unapplied',
      labelSnapshot: 'labels-unapplied',
    };
    const sourceIndependence = {
      status: 'VERIFIED_INDEPENDENT',
      independence: { state: 'known', value: true },
      requiredOperators: 2,
      observedSources: 2,
      operatorCount: 2,
      unresolvedSources: [],
      attestations: [
        {
          sourceId: sourceSet[0],
          hostname: 'bnb-mainnet.g.alchemy.com',
          operatorId: 'alchemy',
          operatorName: 'Alchemy',
          officialSource: 'https://www.alchemy.com/docs/reference/node-supported-chains',
          registryObservedAt: '2026-08-11T00:00:00.000Z',
          registryRevision: 'alchemy-bnb-chain-api@2026-08-11',
          evidenceId: firstAttestationId,
        },
        {
          sourceId: sourceSet[1],
          hostname: 'bsc-dataseed.bnbchain.org',
          operatorId: 'bnb-chain',
          operatorName: 'BNB Chain',
          officialSource:
            'https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/',
          registryObservedAt: '2026-08-11T00:00:00.000Z',
          registryRevision: 'bnb-chain-bsc-json-rpc-endpoints@2026-08-11',
          evidenceId: secondAttestationId,
        },
      ],
      registryEvidenceId,
      terminalEvidenceId: independenceEvidenceId,
      evidenceIds: [
        registryEvidenceId,
        firstAttestationId,
        secondAttestationId,
        independenceEvidenceId,
      ],
      modelVersion: 'source-operator-registry-v1',
    };
    const segment = {
      fromBlock: '100',
      toBlock: '102',
      sampleCount: 4,
      startTotalSupply: '1000000000',
      endTotalSupply: '1000000000',
      supplyChangeCount: 0,
      eventConservedChangeCount: 0,
      unexplainedChangeCount: 0,
      changes: [],
      terminalEvidenceId: segmentEvidenceId,
      snapshot,
      sourceSet,
    };
    const result = {
      tokenAddress: fixtureFlapToken,
      fromBlock: '100',
      toBlock: '102',
      coverageScope: 'ERC20_TOTAL_SUPPLY_EVERY_FINALIZED_BLOCK_WITH_EVENT_RECONCILIATION',
      status: 'VERIFIED_NO_CHANGE',
      segmentCount: 1,
      scannedBlockCount: 3,
      supplySampleCount: 4,
      initialTotalSupply: '1000000000',
      finalTotalSupply: '1000000000',
      netSupplyDelta: '0',
      supplyChangeCount: 0,
      eventConservedChangeCount: 0,
      unexplainedChangeCount: 0,
      segments: [segment],
      sourceIndependence,
      terminalEvidenceId,
      metadata: {
        snapshot,
        dataCoverage: 1,
        sourceCoverage: 1,
        historyCoverage: 1,
        simulationCoverage: 0,
        freshness: snapshot.blockTimestamp,
        sourceSet,
        modelVersion: 'erc20-supply-continuity-v1.0.0',
        confidence: 1,
        evidenceIds,
      },
    };
    const now = '2026-08-11T02:01:00.000Z';
    const get = vi.fn(async () => ({
      id: scanId,
      scanType: 'ERC20_SUPPLY_CONTINUITY',
      source: 'multi-source:bsc-rpc+sqd',
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      subject: fixtureFlapToken,
      fromBlock: 100,
      toBlock: 102,
      chunkSize: 3,
      identityHash: '5'.repeat(64),
      identity: {},
      status: 'REQUESTED_RANGE_COMPLETE' as const,
      nextBlock: 103,
      stateHash: '6'.repeat(64),
      state: {
        version: 'erc20-supply-continuity-checkpoint-v1',
        segments: [segment],
        snapshot,
        sourceSet,
        result,
      },
      evidenceIds,
      lastErrorCode: null,
      startedAt: now,
      updatedAt: now,
      completedAt: now,
    }));
    runtime.semanticCheckpoints = { get } as unknown as NonNullable<
      AppRuntime['semanticCheckpoints']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/supply-continuity/${scanId}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      scan: { id: scanId, requestedRangeCoverage: 1, nextBlock: '103' },
      terminalResult: {
        status: 'VERIFIED_NO_CHANGE',
        scannedBlockCount: 3,
        supplySampleCount: 4,
        sourceIndependence: { status: 'VERIFIED_INDEPENDENT' },
        terminalEvidenceId,
      },
    });
    expect(get).toHaveBeenCalledWith(scanId);

    const wrongToken = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/EVM/0x${'b'.repeat(40)}/supply-continuity/${scanId}`,
    });
    expect(wrongToken.statusCode).toBe(404);
    expect(wrongToken.json().error.code).toBe('SUPPLY_CONTINUITY_NOT_FOUND');
  });

  it('reports supply-continuity replay as unavailable without PostgreSQL', async () => {
    const runtime = runtimeWithAllLedgers();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url:
        `/api/v1/claims/EVM/${fixtureFlapToken}/supply-continuity/` +
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SUPPLY_CONTINUITY_REPLAY_UNAVAILABLE');
  });

  it('returns durable supply-continuity progress without inventing a terminal result', async () => {
    const runtime = runtimeWithAllLedgers();
    const scanId = 'abababab-abab-4bab-8bab-abababababab';
    runtime.semanticCheckpoints = {
      get: vi.fn(async () => ({
        id: scanId,
        scanType: 'ERC20_SUPPLY_CONTINUITY',
        source: 'multi-source:bsc-rpc+sqd',
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        subject: fixtureFlapToken,
        fromBlock: 100,
        toBlock: 102,
        chunkSize: 2,
        identityHash: '5'.repeat(64),
        identity: {},
        status: 'RUNNING' as const,
        nextBlock: 100,
        stateHash: '6'.repeat(64),
        state: {
          version: 'erc20-supply-continuity-checkpoint-v1',
          segments: [],
          snapshot: null,
          sourceSet: [],
          result: null,
        },
        evidenceIds: [],
        lastErrorCode: 'RPC_ERROR',
        startedAt: '2026-08-11T02:01:00.000Z',
        updatedAt: '2026-08-11T02:02:00.000Z',
        completedAt: null,
      })),
    } as unknown as NonNullable<AppRuntime['semanticCheckpoints']>;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/supply-continuity/${scanId}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      scan: {
        id: scanId,
        status: 'RUNNING',
        requestedRangeCoverage: 0,
        nextBlock: '100',
        lastErrorCode: 'RPC_ERROR',
      },
      terminalResult: null,
    });
  });

  it('discovers and replays durable BSC pension behavior candidates without promoting a role', async () => {
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
        new BurnDiscoveryAnchorTransport(),
      ),
    );
    const candidate = `0x${'d'.repeat(40)}`;
    const shareUnit = 1_000_000n * 10n ** 18n;
    const indexed = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
    const logs: EvmLogRecord[] = [2, 3, 4].map((digit, index) => ({
      address: fixtureFlapToken,
      blockHash: `0x${String(digit).repeat(64)}`,
      blockNumber: `0x${(101 + index).toString(16)}`,
      blockTimestamp: `2024-02-0${index + 2}T00:00:00.000Z`,
      transactionHash: `0x${String(digit).repeat(64)}`,
      transactionIndex: '0x0',
      logIndex: '0x0',
      data: `0x${shareUnit.toString(16).padStart(64, '0')}`,
      topics: [ERC20_TRANSFER_TOPIC, indexed(`0x${String(digit).repeat(40)}`), indexed(candidate)],
      removed: false,
      raw: { fixture: true },
    }));
    const getLogsObservation = vi.fn(async (query: EvmLogQuery) => {
      expect(query).toMatchObject({
        address: fixtureFlapToken,
        fromBlock: '100',
        toBlock: '110',
        topics: [ERC20_TRANSFER_TOPIC],
      });
      return { endpointId: 'sqd:binance-mainnet', value: logs };
    });
    runtime.sqdBscLogReader = { getLogsObservation };
    const durableEvidence = new Map<string, EvidenceNode>();
    runtime.evidenceRepository = repository({
      put: vi.fn(async (evidence, sourceEvidenceIds = [], snapshot) => {
        const node: EvidenceNode = {
          evidence,
          sourceEvidenceIds: [...sourceEvidenceIds].sort(),
          ...(snapshot === undefined ? {} : { snapshot }),
        };
        durableEvidence.set(evidence.id, node);
        return node;
      }),
      get: vi.fn(async (evidenceId) => durableEvidence.get(evidenceId)),
    });
    let storedRecord: Record<string, unknown> | undefined;
    const put = vi.fn(async (report: Record<string, unknown>) => {
      storedRecord = {
        id: `pcr_${'3'.repeat(24)}`,
        chainId: 'eip155:56',
        tokenAddress: fixtureFlapToken,
        fromBlock: '100',
        toBlock: '110',
        snapshotHash: `0x${'f'.repeat(64)}`,
        resultHash: '4'.repeat(64),
        report,
        terminalEvidenceId: report.terminalEvidenceId,
        evidenceIds: (report.metadata as { evidenceIds: string[] }).evidenceIds,
        sourceSet: (report.metadata as { sourceSet: string[] }).sourceSet,
        modelVersion: 'evm-pension-candidate-discovery-v1.0.0',
        capturedAt: '2024-02-12T21:00:12.000Z',
        createdAt: '2026-08-11T05:00:02.000Z',
      };
      return storedRecord;
    });
    const latest = vi.fn(async () => storedRecord);
    const get = vi.fn(async () => storedRecord);
    runtime.pensionCandidateReports = { put, latest, get } as unknown as NonNullable<
      AppRuntime['pensionCandidateReports']
    >;
    let storedEntryRecord: Record<string, unknown> | undefined;
    const putEntry = vi.fn(async (report: Record<string, unknown>) => {
      const metadata = report.metadata as {
        snapshot: { blockNumber: string; blockHash: string; capturedAt: string };
        evidenceIds: string[];
        sourceSet: string[];
      };
      const behavior = report.behavior as { reportId: string; wallet: string };
      storedEntryRecord = {
        id: `per_${'5'.repeat(24)}`,
        chainId: 'eip155:56',
        tokenAddress: fixtureFlapToken,
        pensionReportId: behavior.reportId,
        pensionWallet: behavior.wallet,
        blockNumber: metadata.snapshot.blockNumber,
        snapshotHash: metadata.snapshot.blockHash,
        resultHash: '6'.repeat(64),
        report,
        terminalEvidenceId: report.terminalEvidenceId,
        evidenceIds: metadata.evidenceIds,
        sourceSet: metadata.sourceSet,
        modelVersion: 'flap-pension-entry-economics-v0.1.0',
        capturedAt: metadata.snapshot.capturedAt,
        createdAt: '2026-08-11T07:30:00.000Z',
      };
      return storedEntryRecord;
    });
    const latestEntry = vi.fn(async () => storedEntryRecord);
    const getEntry = vi.fn(async () => storedEntryRecord);
    runtime.pensionEntryReports = {
      put: putEntry,
      latest: latestEntry,
      get: getEntry,
    } as unknown as NonNullable<AppRuntime['pensionEntryReports']>;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const live = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/pension-candidates`,
      payload: {
        chainId: 'eip155:56',
        fromBlock: '100',
        toBlock: '110',
        shareUnitAtomic: shareUnit.toString(),
        minimumExactUnitDeposits: 3,
        minimumUniqueExactUnitDepositors: 3,
        maximumCandidates: 20,
      },
    });
    expect(live.statusCode, live.body).toBe(200);
    expect(live.json()).toMatchObject({
      report: {
        tokenAddress: fixtureFlapToken,
        scannedTransferCount: 3,
        candidates: [
          {
            address: candidate,
            exactUnitDepositCount: 3,
            uniqueExactUnitDepositorCount: 3,
            roleAttribution: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
            participantExitPolicy: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
            dividendExecution: { state: 'unknown', reason: 'NOT_QUERIED' },
          },
        ],
      },
      durableReport: { id: `pcr_${'3'.repeat(24)}`, resultHash: '4'.repeat(64) },
    });
    expect(put).toHaveBeenCalledTimes(1);

    const latestReplay = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/pension-candidates/reports/latest`,
    });
    expect(latestReplay.statusCode, latestReplay.body).toBe(200);
    expect(latestReplay.json()).toEqual({ record: storedRecord });

    const exactReplay = await app.inject({
      method: 'GET',
      url:
        `/api/v1/claims/EVM/${fixtureFlapToken}/pension-candidates/reports/` +
        `pcr_${'3'.repeat(24)}`,
    });
    expect(exactReplay.statusCode, exactReplay.body).toBe(200);
    expect(exactReplay.json()).toEqual({ record: storedRecord });
    expect(latest).toHaveBeenCalledWith(fixtureFlapToken);
    expect(get).toHaveBeenCalledWith(`pcr_${'3'.repeat(24)}`);

    const quoteReserve = 1_000n * 10n ** 18n;
    const tokenReserve = 1_000_000_000n * 10n ** 18n;
    const quoteInputs = [100n * 10n ** 18n, 1_000n * 10n ** 18n];
    runtime.evmAdapters.set(
      56,
      new EvmLedgerAdapter(
        {
          id: 'bsc-rpc',
          chainId: 56,
          chainName: 'BNB Smart Chain',
          snapshotBlockTag: 'finalized',
        },
        new FlapQuoteTransport(
          [
            fixtureFlapV8SafeResult({
              status: 4,
              quoteTokenAddress: fixtureFlapQuoteAsset,
              pool: fixtureFlapPool,
              dexId: 0,
            }),
            fixtureAddressResult(PANCAKE_V2_BSC_DEPLOYMENT.factory),
            fixtureAddressResult(fixtureFlapQuoteAsset),
            fixtureAddressResult(fixtureFlapToken),
            fixtureReservesResult(quoteReserve, tokenReserve),
            fixtureAddressResult(fixtureFlapPool),
            fixtureAddressResult(PANCAKE_V2_BSC_DEPLOYMENT.factory),
            fixtureDecimalsResult(18),
            fixtureDecimalsResult(18),
            ...quoteInputs.map((input) =>
              fixtureAmountsOutResult(
                input,
                fixturePancakeAmountOut(input, quoteReserve, tokenReserve),
              ),
            ),
          ],
          {
            blockNumber: 110n,
            blockHash: `0x${'f'.repeat(64)}`,
            parentBlockHash: `0x${'e'.repeat(64)}`,
            timestamp: '0x65c95abc',
          },
        ),
      ),
    );
    const entry = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios',
      payload: {
        chainId: 'eip155:56',
        platform: 'flap',
        token: fixtureFlapToken,
        pensionReportId: `pcr_${'3'.repeat(24)}`,
        pensionWallet: candidate,
        quoteInputs: ['100', '1000'],
        blockNumber: '110',
      },
    });
    expect(entry.statusCode, entry.body).toBe(200);
    expect(entry.json()).toMatchObject({
      behavior: {
        reportId: `pcr_${'3'.repeat(24)}`,
        wallet: candidate,
        shareUnit: { decimal: '1000000' },
        roleAttribution: { state: 'unknown' },
        participantExitPolicy: { state: 'unknown' },
        dividendExecution: { state: 'unknown' },
      },
      entries: [
        {
          buyScenario: { quoteInput: { decimal: '100' } },
          modeledWholeShares: { state: 'known' },
          executionWholeShares: { state: 'unknown', reason: 'NOT_QUERIED' },
          modeledPostDepositSpotPrice: { state: 'known' },
          executionPostDepositSpotPrice: { state: 'unknown', reason: 'NOT_QUERIED' },
        },
        { buyScenario: { quoteInput: { decimal: '1000' } } },
      ],
      destinationTreatment: 'NON_ZERO_CUSTODY_ADDRESS',
      totalSupplyReduction: { state: 'unknown', reason: 'NOT_QUERIED' },
      custodyIrreversible: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      metadata: {
        snapshot: { blockNumber: '110', blockHash: `0x${'f'.repeat(64)}` },
        modelVersion: 'flap-pension-entry-economics-v0.1.0',
      },
      durableReport: { id: `per_${'5'.repeat(24)}`, resultHash: '6'.repeat(64) },
    });
    const entryTerminal = durableEvidence.get(entry.json().terminalEvidenceId);
    expect(entryTerminal?.sourceEvidenceIds).toHaveLength(3);
    expect(putEntry).toHaveBeenCalledTimes(1);

    runtime.evmAdapters.delete(56);
    const latestEntryReplay = await app.inject({
      method: 'GET',
      url:
        '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/latest?' +
        `chainId=eip155%3A56&platform=flap&token=${fixtureFlapToken}`,
    });
    expect(latestEntryReplay.statusCode, latestEntryReplay.body).toBe(200);
    expect(latestEntryReplay.json()).toEqual({ replayed: true, record: storedEntryRecord });

    const mismatchedLatestEntryReplay = await app.inject({
      method: 'GET',
      url:
        '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/latest?' +
        `chainId=eip155%3A56&platform=flap&token=0x${'b'.repeat(40)}`,
    });
    expect(mismatchedLatestEntryReplay.statusCode).toBe(404);

    const exactEntryReplay = await app.inject({
      method: 'GET',
      url:
        '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/' +
        `per_${'5'.repeat(24)}?chainId=eip155%3A56&platform=flap&token=${fixtureFlapToken}`,
    });
    expect(exactEntryReplay.statusCode, exactEntryReplay.body).toBe(200);
    expect(exactEntryReplay.json()).toEqual({ replayed: true, record: storedEntryRecord });
    expect(latestEntry).toHaveBeenCalledWith(fixtureFlapToken);
    expect(getEntry).toHaveBeenCalledWith(`per_${'5'.repeat(24)}`);
  });

  it('requires durable storage for live pension candidate discovery', async () => {
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
        new BurnDiscoveryAnchorTransport(),
      ),
    );
    runtime.sqdBscLogReader = {
      getLogsObservation: vi.fn(async () => ({ endpointId: 'sqd:binance-mainnet', value: [] })),
    };
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/claims/EVM/${fixtureFlapToken}/pension-candidates`,
      payload: {
        chainId: 'eip155:56',
        fromBlock: '100',
        toBlock: '110',
        shareUnitAtomic: '1000000',
        minimumExactUnitDeposits: 3,
        minimumUniqueExactUnitDepositors: 3,
        maximumCandidates: 20,
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('DURABLE_STORAGE_REQUIRED');
  });

  it('replays latest and exact durable Claim Reports without provider access', async () => {
    const runtime = runtimeWithAllLedgers();
    const token = fixtureFlapToken;
    const address = `0x${'d'.repeat(40)}`;
    const reportId = `ecr_${'1'.repeat(24)}`;
    const record = {
      id: reportId,
      chainId: 'eip155:56',
      tokenAddress: token,
      address,
      fromBlock: '90',
      toBlock: '100',
      snapshotBlock: '100',
      snapshotHash: `0x${'e'.repeat(64)}`,
      resultHash: 'f'.repeat(64),
      report: { terminalEvidenceId: `ev_${'2'.repeat(24)}` },
      terminalEvidenceId: `ev_${'2'.repeat(24)}`,
      evidenceIds: [`ev_${'2'.repeat(24)}`],
      sourceSet: ['sqd:bsc'],
      modelVersion: 'evm-claim-address-observation-v1.0.0',
      capturedAt: '2026-08-10T00:00:01.000Z',
      createdAt: '2026-08-10T00:00:02.000Z',
    };
    const latest = vi.fn(async () => record);
    const get = vi.fn(async () => record);
    runtime.claimReports = { latest, get } as unknown as NonNullable<AppRuntime['claimReports']>;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const latestResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/claims/EVM/${token}/addresses/${address}/reports/latest` + '?chainId=eip155:56',
    });
    expect(latestResponse.statusCode, latestResponse.body).toBe(200);
    expect(latestResponse.json()).toEqual({ record });
    expect(latest).toHaveBeenCalledWith('eip155:56', token, address);

    const exactResponse = await app.inject({
      method: 'GET',
      url:
        `/api/v1/claims/EVM/${token}/addresses/${address}/reports/${reportId}` +
        '?chainId=eip155:56',
    });
    expect(exactResponse.statusCode, exactResponse.body).toBe(200);
    expect(exactResponse.json()).toEqual({ record });
    expect(get).toHaveBeenCalledWith(reportId);

    const wrongSubject = await app.inject({
      method: 'GET',
      url:
        `/api/v1/claims/EVM/${token}/addresses/0x${'c'.repeat(40)}/reports/${reportId}` +
        '?chainId=eip155:56',
    });
    expect(wrongSubject.statusCode).toBe(404);
    expect(wrongSubject.json().error.code).toBe('CLAIM_REPORT_NOT_FOUND');
  });

  it('reports durable Claim Report replay as unavailable or not found explicitly', async () => {
    const unconfigured = await createApp({
      config,
      runtime: runtimeWithAllLedgers(),
      logger: false,
    });
    apps.push(unconfigured);
    const token = fixtureFlapToken;
    const address = `0x${'d'.repeat(40)}`;
    const unavailable = await unconfigured.inject({
      method: 'GET',
      url: `/api/v1/claims/EVM/${token}/addresses/${address}/reports/latest` + '?chainId=eip155:56',
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe('CLAIM_REPORT_UNAVAILABLE');

    const runtime = runtimeWithAllLedgers();
    runtime.claimReports = { latest: vi.fn(async () => undefined) } as unknown as NonNullable<
      AppRuntime['claimReports']
    >;
    const empty = await createApp({ config, runtime, logger: false });
    apps.push(empty);
    const missing = await empty.inject({
      method: 'GET',
      url: `/api/v1/claims/EVM/${token}/addresses/${address}/reports/latest` + '?chainId=eip155:56',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('CLAIM_REPORT_NOT_FOUND');
  });

  it('replays latest, exact, and generic EVM control surface records without providers', async () => {
    const runtime = runtimeWithAllLedgers();
    const subject = `0x${'d'.repeat(40)}`;
    const reportId = `ecs_${'1'.repeat(24)}`;
    const record = {
      id: reportId,
      chainId: 'eip155:56',
      subject,
      snapshotBlock: '100',
      snapshotHash: `0x${'e'.repeat(64)}`,
      resultHash: 'f'.repeat(64),
      report: { terminalEvidenceId: `ev_${'2'.repeat(24)}` },
      terminalEvidenceId: `ev_${'2'.repeat(24)}`,
      evidenceIds: [`ev_${'2'.repeat(24)}`],
      sourceSet: ['bsc-rpc'],
      modelVersion: 'evm-control-surface-v1.0.0',
      capturedAt: '2026-08-11T00:00:01.000Z',
      createdAt: '2026-08-11T00:00:02.000Z',
    };
    const latest = vi.fn(async () => record);
    const get = vi.fn(async () => record);
    runtime.controlSurfaces = { latest, get } as unknown as NonNullable<
      AppRuntime['controlSurfaces']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const latestResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/control-rights/EVM/${subject}/reports/latest?chainId=eip155:56`,
    });
    expect(latestResponse.statusCode, latestResponse.body).toBe(200);
    expect(latestResponse.json()).toEqual({ record });

    const exactResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/control-rights/EVM/${subject}/reports/${reportId}?chainId=eip155:56`,
    });
    expect(exactResponse.statusCode, exactResponse.body).toBe(200);
    expect(exactResponse.json()).toEqual({ record });

    const genericResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/control-rights?ledger=EVM&chainId=eip155:56&subject=${subject}`,
    });
    expect(genericResponse.statusCode, genericResponse.body).toBe(200);
    expect(genericResponse.json()).toEqual({ records: [record] });
    expect(latest).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith(reportId);

    const wrongSubject = await app.inject({
      method: 'GET',
      url:
        `/api/v1/control-rights/EVM/0x${'c'.repeat(40)}/reports/${reportId}` + '?chainId=eip155:56',
    });
    expect(wrongSubject.statusCode).toBe(404);
    expect(wrongSubject.json().error.code).toBe('CONTROL_SURFACE_NOT_FOUND');
  });

  it('inspects and durably replays a finalized Solana control surface', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.evidenceRepository = repository();
    const subject = 'So11111111111111111111111111111111111111112';
    let storedReport: unknown;
    const put = vi.fn(
      async (report: { terminalEvidenceId: string; metadata: { snapshot: unknown } }) => {
        storedReport = report;
        return {
          id: `scs_${'1'.repeat(24)}`,
          chainId: 'solana-mainnet' as const,
          subject,
          snapshotSlot: '300000000',
          snapshotHash: '11111111111111111111111111111111',
          resultHash: 'f'.repeat(64),
          report,
          terminalEvidenceId: report.terminalEvidenceId,
          evidenceIds: [`ev_${'2'.repeat(24)}`],
          sourceSet: ['solana-state'],
          modelVersion: 'solana-control-surface-v1.0.0',
          capturedAt: '2026-08-11T00:00:01.000Z',
          createdAt: '2026-08-11T00:00:02.000Z',
        };
      },
    );
    runtime.solanaControlSurfaces = { put } as unknown as NonNullable<
      AppRuntime['solanaControlSurfaces']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/control-rights/SOLANA/${subject}/inspect`,
      payload: { chainId: 'solana-mainnet' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().record).toMatchObject({
      id: `scs_${'1'.repeat(24)}`,
      chainId: 'solana-mainnet',
      subject,
      snapshotSlot: '300000000',
      report: {
        ledger: 'SOLANA',
        accountKind: { state: 'known', value: 'SYSTEM_ACCOUNT' },
        rights: [],
        sourceAgreement: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      },
    });
    expect(storedReport).toBeDefined();
    expect(put).toHaveBeenCalledTimes(1);
    expect(runtime.evidenceRepository.put).toHaveBeenCalledTimes(2);

    const historical = await app.inject({
      method: 'POST',
      url: `/api/v1/control-rights/SOLANA/${subject}/inspect`,
      payload: { chainId: 'solana-mainnet', blockNumber: '299999999' },
    });
    expect(historical.statusCode).toBe(400);
    expect(historical.json().error.code).toBe('HISTORICAL_STATE_UNSUPPORTED');
  });

  it('replays latest, exact, and generic Solana control reports without a provider', async () => {
    const runtime = runtimeWithAllLedgers();
    const subject = 'So11111111111111111111111111111111111111112';
    const reportId = `scs_${'3'.repeat(24)}`;
    const record = {
      id: reportId,
      chainId: 'solana-mainnet' as const,
      subject,
      snapshotSlot: '300000000',
      snapshotHash: '11111111111111111111111111111111',
      resultHash: 'f'.repeat(64),
      report: { ledger: 'SOLANA', terminalEvidenceId: `ev_${'4'.repeat(24)}` },
      terminalEvidenceId: `ev_${'4'.repeat(24)}`,
      evidenceIds: [`ev_${'4'.repeat(24)}`],
      sourceSet: ['solana-rpc'],
      modelVersion: 'solana-control-surface-v1.0.0',
      capturedAt: '2026-08-11T00:00:01.000Z',
      createdAt: '2026-08-11T00:00:02.000Z',
    };
    const latest = vi.fn(async () => record);
    const get = vi.fn(async () => record);
    runtime.solanaControlSurfaces = { latest, get } as unknown as NonNullable<
      AppRuntime['solanaControlSurfaces']
    >;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const latestResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/control-rights/SOLANA/${subject}/reports/latest?chainId=solana-mainnet`,
    });
    expect(latestResponse.statusCode, latestResponse.body).toBe(200);
    expect(latestResponse.json()).toEqual({ record });

    const exactResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/control-rights/SOLANA/${subject}/reports/${reportId}?chainId=solana-mainnet`,
    });
    expect(exactResponse.statusCode, exactResponse.body).toBe(200);
    expect(exactResponse.json()).toEqual({ record });

    const genericResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/control-rights?ledger=SOLANA&chainId=solana-mainnet&subject=${subject}`,
    });
    expect(genericResponse.statusCode, genericResponse.body).toBe(200);
    expect(genericResponse.json()).toEqual({ records: [record] });
    expect(latest).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith(reportId);

    const mismatchedChain = await app.inject({
      method: 'GET',
      url: `/api/v1/control-rights/SOLANA/${subject}/reports/latest?chainId=eip155:56`,
    });
    expect(mismatchedChain.statusCode).toBe(400);
    expect(mismatchedChain.json().error.code).toBe('INVALID_CHAIN_ID');
  });

  it('keeps control surface inspection and replay explicitly unavailable without durable storage', async () => {
    const runtime = runtimeWithAllLedgers();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const subject = `0x${'d'.repeat(40)}`;

    const inspection = await app.inject({
      method: 'POST',
      url: `/api/v1/control-rights/EVM/${subject}/inspect`,
      payload: { chainId: 'eip155:56' },
    });
    expect(inspection.statusCode).toBe(503);
    expect(inspection.json().error.code).toBe('CONTROL_SURFACE_UNAVAILABLE');

    const replay = await app.inject({
      method: 'GET',
      url: `/api/v1/control-rights/EVM/${subject}/reports/latest?chainId=eip155:56`,
    });
    expect(replay.statusCode).toBe(503);
    expect(replay.json().error.code).toBe('CONTROL_SURFACE_UNAVAILABLE');
  });
});
