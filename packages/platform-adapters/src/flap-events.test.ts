import { describe, expect, it } from 'vitest';

import {
  EvmLedgerAdapter,
  ProviderError,
  type EvmContractCreationReader,
  type EvmLogReader,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import type { JsonValue } from '@zerotrace/schemas';
import { encodeAbiParameters, toEventSelector, type AbiParameter } from 'viem';

import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  discoverFlapEventHistory,
  type FlapOriginCheckpointRun,
  type FlapOriginCheckpointStore,
  inspectFlapEventTransaction,
  inspectFlapTokenOrigin,
  inspectFlapTokenOriginRestartSafe,
} from './index.js';

const token = `0x${'a'.repeat(40)}`;
const creator = `0x${'c'.repeat(40)}`;
const pool = `0x${'b'.repeat(40)}`;
const transactionHash = `0x${'3'.repeat(64)}`;
const blockHash = `0x${'1'.repeat(64)}`;
const parentHash = `0x${'2'.repeat(64)}`;
const unknownTopic = `0x${'9'.repeat(64)}` as const;

interface EventFixture {
  signature: string;
  parameters: readonly AbiParameter[];
  values: readonly unknown[];
}

function eventLog(event: EventFixture, logIndex: number, overrides: Record<string, unknown> = {}) {
  return {
    address: FLAP_BSC_MAINNET_DEPLOYMENT.portal,
    blockHash,
    blockNumber: '0x10',
    transactionHash,
    transactionIndex: '0x1',
    logIndex: `0x${logIndex.toString(16)}`,
    data: encodeAbiParameters(event.parameters, event.values),
    topics: [toEventSelector(event.signature)],
    removed: false,
    ...overrides,
  };
}

function tokenCreated(overrides: Partial<{ name: string; symbol: string; meta: string }> = {}) {
  return {
    signature: 'TokenCreated(uint256,address,uint256,address,string,string,string)',
    parameters: [
      { type: 'uint256' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'string' },
      { type: 'string' },
      { type: 'string' },
    ],
    values: [
      1_700_000_000n,
      creator,
      7n,
      token,
      overrides.name ?? 'Fixture Token',
      overrides.symbol ?? 'FIX',
      overrides.meta ?? 'ipfs://fixture',
    ],
  } satisfies EventFixture;
}

function event(signature: string, parameters: readonly AbiParameter[], values: readonly unknown[]) {
  return { signature, parameters, values } satisfies EventFixture;
}

function receipt(logs: readonly unknown[]) {
  return {
    transactionHash,
    blockHash,
    blockNumber: '0x10',
    transactionIndex: '0x1',
    from: creator,
    to: FLAP_BSC_MAINNET_DEPLOYMENT.portal,
    contractAddress: null,
    cumulativeGasUsed: '0x100',
    gasUsed: '0x80',
    status: '0x1',
    logs,
  };
}

class EventJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-event-fixture';
  readonly calls: Array<{ method: string; params: readonly unknown[] }> = [];

  constructor(
    readonly receiptValue: unknown,
    readonly returnedBlockHash = blockHash,
  ) {}

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    this.calls.push({ method, params });
    if (method === 'eth_getTransactionReceipt') return this.receiptValue as T;
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === '0x11') {
        return {
          number: '0x11',
          hash: `0x${'4'.repeat(64)}`,
          parentHash: blockHash,
          timestamp: '0x66',
        } as T;
      }
      return {
        number: '0x10',
        hash: this.returnedBlockHash,
        parentHash,
        timestamp: '0x65',
      } as T;
    }
    throw new Error(`Unexpected method ${method}`);
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    return { value: await this.request<T>(method, params), endpointId: this.endpointId };
  }
}

class HistoryJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-history-fixture';
  readonly calls: Array<{ method: string; params: readonly unknown[] }> = [];

  constructor(
    readonly includeCreation = true,
    readonly includeCreationInEveryChunk = false,
  ) {}

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    return (await this.requestSourced<T>(method, params)).value;
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    this.calls.push({ method, params });
    if (method === 'eth_getBlockByNumber') {
      const tag = params[0];
      if (tag !== '0x10' && tag !== '0x11') throw new Error(`Unexpected block tag ${String(tag)}`);
      return {
        value: {
          number: tag,
          hash: tag === '0x10' ? blockHash : `0x${'4'.repeat(64)}`,
          parentHash: tag === '0x10' ? parentHash : blockHash,
          timestamp: '0x65',
        } as T,
        endpointId: 'bsc-history-anchor',
      };
    }
    if (method === 'eth_getLogs') {
      const filter = params[0] as { fromBlock: string };
      return {
        value: (this.includeCreation &&
        (this.includeCreationInEveryChunk || filter.fromBlock === '0x10')
          ? [eventLog(tokenCreated(), 0)]
          : []) as T,
        endpointId: 'bsc-history-logs',
      };
    }
    if (method === 'eth_getTransactionReceipt') {
      return {
        value: receipt([eventLog(tokenCreated(), 0)]) as T,
        endpointId: 'bsc-history-receipt',
      };
    }
    throw new Error(`Unexpected history fixture method ${method}`);
  }
}

function fixture(logs: readonly unknown[], returnedBlockHash = blockHash) {
  const transport = new EventJsonRpcTransport(receipt(logs), returnedBlockHash);
  const adapter = new EvmLedgerAdapter(
    {
      id: 'bsc-rpc',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    transport,
  );
  const ledger = new EvidenceLedger();
  const writeEvidence = async (
    item: Parameters<EvidenceLedger['add']>[0],
    sources: readonly string[] = [],
    snapshot?: Parameters<EvidenceLedger['add']>[2],
  ) => ledger.add(item, sources, snapshot).evidence;
  return {
    adapter,
    ledger,
    transport,
    writeEvidence,
    inspect: () =>
      inspectFlapEventTransaction({
        adapter,
        token,
        transactionHash,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence,
      }),
  };
}

class MemoryFlapOriginCheckpointStore implements FlapOriginCheckpointStore {
  run: FlapOriginCheckpointRun | undefined;
  readonly failures: string[] = [];
  readonly advances: number[] = [];

  async begin(input: {
    fromBlock: number;
    initialState: JsonValue;
  }): Promise<FlapOriginCheckpointRun> {
    this.run ??= {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'RUNNING',
      nextBlock: input.fromBlock,
      state: input.initialState,
      evidenceIds: [],
    };
    return this.run;
  }

  async advance(
    id: string,
    input: {
      expectedNextBlock: number;
      completedToBlock: number;
      state: JsonValue;
      evidenceIds: readonly string[];
    },
  ): Promise<FlapOriginCheckpointRun> {
    if (this.run?.id !== id || this.run.status !== 'RUNNING') throw new Error('missing run');
    if (this.run.nextBlock !== input.expectedNextBlock) throw new Error('stale cursor');
    this.run = {
      ...this.run,
      nextBlock: input.completedToBlock + 1,
      state: input.state,
      evidenceIds: [...input.evidenceIds],
    };
    this.advances.push(this.run.nextBlock);
    return this.run;
  }

  async finish(
    id: string,
    input: { state: JsonValue; evidenceIds: readonly string[] },
  ): Promise<FlapOriginCheckpointRun> {
    if (this.run?.id !== id) throw new Error('missing run');
    if (this.run.status === 'REQUESTED_RANGE_COMPLETE') return this.run;
    this.run = {
      ...this.run,
      status: 'REQUESTED_RANGE_COMPLETE',
      state: input.state,
      evidenceIds: [...input.evidenceIds],
    };
    return this.run;
  }

  async recordFailure(id: string, errorCode: string): Promise<FlapOriginCheckpointRun> {
    if (this.run?.id !== id) throw new Error('missing run');
    this.failures.push(errorCode);
    return this.run;
  }
}

describe('Flap transaction-local event inspection', () => {
  it('normalizes creation and explicit configuration from one pinned receipt', async () => {
    const curve = `0x${'d'.repeat(40)}`;
    const logs = [
      eventLog(tokenCreated(), 0),
      eventLog(
        event(
          'TokenCurveSetV2(address,uint256,uint256,uint256)',
          [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
          [token, 10n, 20n, 300n],
        ),
        2,
      ),
      eventLog(
        event(
          'TokenCurveSet(address,address,uint256)',
          [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
          [token, curve, 18n],
        ),
        1,
      ),
      eventLog(
        event(
          'FlapTokenAsymmetricTaxSet(address,uint256,uint256)',
          [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
          [token, 300n, 700n],
        ),
        3,
      ),
      eventLog(
        event(
          'TokenDexPreferenceSet(address,uint8,uint8)',
          [{ type: 'address' }, { type: 'uint8' }, { type: 'uint8' }],
          [token, 2, 1],
        ),
        4,
      ),
    ];
    const result = await fixture(logs).inspect();

    expect(result.transactionKind).toBe('CREATION_CONFIGURATION');
    expect(result.creation).toMatchObject({
      creator,
      token,
      name: 'Fixture Token',
      symbol: 'FIX',
      metadataUri: 'ipfs://fixture',
      position: { blockNumber: '16', logIndex: '0' },
    });
    expect(result.configuration).toMatchObject({
      curveAddress: { value: { state: 'known', value: curve }, source: 'EVENT' },
      curveParameter: { value: { state: 'known', value: '18' }, source: 'EVENT' },
      virtualQuoteReserve: { value: { state: 'known', value: '10' }, source: 'EVENT' },
      virtualBaseReserve: { value: { state: 'known', value: '20' }, source: 'EVENT' },
      virtualLiquiditySquared: { value: { state: 'known', value: '300' }, source: 'EVENT' },
      buyTaxBps: { value: { state: 'known', value: '300' }, source: 'EVENT' },
      sellTaxBps: { value: { state: 'known', value: '700' }, source: 'EVENT' },
      dexId: { value: { state: 'known', value: 'DEX2' }, source: 'EVENT' },
      lpFeeProfile: { value: { state: 'known', value: 'LOW' }, source: 'EVENT' },
    });
    expect(result.decodedEventNames).toEqual([
      'TokenCreated',
      'TokenCurveSet',
      'TokenCurveSetV2',
      'FlapTokenAsymmetricTaxSet',
      'TokenDexPreferenceSet',
    ]);
    expect(result.evidence.at(-1)?.kind).toBe('DERIVED_FEATURE');
    expect(result.metadata.snapshot).toMatchObject({ ledger: 'EVM', blockHash });
  });

  it('applies versioned official defaults without fabricating unavailable curve state', async () => {
    const result = await fixture([eventLog(tokenCreated(), 0)]).inspect();

    expect(result.configuration).toMatchObject({
      curveAddress: {
        value: { state: 'unknown', reason: 'NOT_QUERIED' },
        source: 'OFFICIAL_DEFAULT',
      },
      curveParameter: {
        value: { state: 'known', value: '16000000000000000000' },
        source: 'OFFICIAL_DEFAULT',
      },
      virtualQuoteReserve: {
        value: { state: 'unknown', reason: 'NOT_QUERIED' },
        source: 'OFFICIAL_DEFAULT',
      },
      dexSupplyThreshold: {
        value: { state: 'known', value: '667000000000000000000000000' },
        source: 'OFFICIAL_DEFAULT',
      },
      buyTaxBps: { value: { state: 'known', value: '0' }, source: 'OFFICIAL_DEFAULT' },
      sellTaxBps: { value: { state: 'known', value: '0' }, source: 'OFFICIAL_DEFAULT' },
      dexId: { value: { state: 'known', value: 'DEX0' }, source: 'OFFICIAL_DEFAULT' },
    });
    expect(result.evidence.some((item) => item.sourceUri?.includes('docs.flap.sh'))).toBe(true);
  });

  it('marks legacy curve fields not applicable when V2 reserves are explicitly configured', async () => {
    const result = await fixture([
      eventLog(tokenCreated(), 0),
      eventLog(
        event(
          'TokenCurveSetV2(address,uint256,uint256,uint256)',
          [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
          [token, 10n, 20n, 300n],
        ),
        1,
      ),
    ]).inspect();

    expect(result.configuration).toMatchObject({
      curveAddress: {
        value: { state: 'unknown', reason: 'NOT_APPLICABLE' },
        source: 'NOT_APPLICABLE',
      },
      curveParameter: {
        value: { state: 'unknown', reason: 'NOT_APPLICABLE' },
        source: 'NOT_APPLICABLE',
      },
      virtualQuoteReserve: { value: { state: 'known', value: '10' }, source: 'EVENT' },
    });
  });

  it('captures launch and pool migration facts without inferring missing counterparts', async () => {
    const logs = [
      eventLog(
        event(
          'LaunchedToDEX(address,address,uint256,uint256)',
          [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
          [token, pool, 500n, 25n],
        ),
        0,
      ),
      eventLog(
        event(
          'TokenPoolInfoUpdated(address,(address,uint24,uint8,uint64))',
          [
            { type: 'address' },
            {
              type: 'tuple',
              components: [
                { name: 'pool', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'poolType', type: 'uint8' },
                { name: 'unused', type: 'uint64' },
              ],
            },
          ],
          [token, { pool, fee: 2_500, poolType: 1, unused: 0n }],
        ),
        1,
      ),
    ];
    const result = await fixture(logs).inspect();

    expect(result.transactionKind).toBe('MIGRATION');
    expect(result.configuration).toBeNull();
    expect(result.migration).toMatchObject({
      launchedToDex: { pool, tokenAmount: '500', quoteAmount: '25' },
      poolConfiguration: { pool, fee: '2500', poolTypeCode: '1' },
    });
  });

  it('returns negative Evidence when the receipt has no supported event for the token', async () => {
    const result = await fixture([
      {
        ...eventLog(tokenCreated(), 0),
        topics: [unknownTopic],
        data: '0x',
      },
    ]).inspect();

    expect(result.platformMatch).toEqual({ state: 'known', value: false });
    expect(result.transactionKind).toBe('UNRECOGNIZED');
    expect(result.unrecognizedPortalLogCount).toBe(1);
    expect(result.evidence.map((item) => item.kind)).toEqual(['RECEIPT', 'NEGATIVE_EVIDENCE']);
  });

  it('keeps future enumerations Unknown while retaining their event Evidence', async () => {
    const logs = [
      eventLog(tokenCreated(), 0),
      eventLog(
        event(
          'TokenMigratorSet(address,uint8)',
          [{ type: 'address' }, { type: 'uint8' }],
          [token, 99],
        ),
        1,
      ),
      eventLog(
        event(
          'TokenVersionSet(address,uint8)',
          [{ type: 'address' }, { type: 'uint8' }],
          [token, 99],
        ),
        2,
      ),
    ];
    const result = await fixture(logs).inspect();

    expect(result.configuration?.migratorType.value).toMatchObject({
      state: 'unknown',
      reason: 'UNSUPPORTED',
    });
    expect(result.configuration?.tokenVersion.value).toMatchObject({
      state: 'unknown',
      reason: 'UNSUPPORTED',
    });
    expect(result.configuration?.migratorType.evidenceIds).toHaveLength(1);
  });

  it('rejects duplicate creation facts and inconsistent replay placement', async () => {
    await expect(
      fixture([eventLog(tokenCreated(), 0), eventLog(tokenCreated(), 1)]).inspect(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      fixture([eventLog(tokenCreated(), 0, { blockHash: `0x${'8'.repeat(64)}` })]).inspect(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      fixture([eventLog(tokenCreated(), 0, { data: '0x' })]).inspect(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      fixture([eventLog(tokenCreated(), 0, { removed: true })]).inspect(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      fixture([eventLog(tokenCreated(), 0)], `0x${'7'.repeat(64)}`).inspect(),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

describe('Flap token contract origin', () => {
  function creationReader(
    value: Awaited<
      ReturnType<EvmContractCreationReader['getContractCreationsObservation']>
    >['value'],
  ): EvmContractCreationReader {
    return {
      getContractCreationsObservation: async (query) => ({
        endpointId: 'sqd:binance-mainnet',
        value,
        coverage: {
          fromBlock: query.fromBlock,
          toBlock: query.toBlock,
          nextBlock: (BigInt(query.toBlock) + 1n).toString(),
          finalizedHead: query.toBlock,
          responseBlockCount: value.length,
          requestCount: 1,
          completion: 'REQUESTED_RANGE_COMPLETE',
        },
      }),
    };
  }

  function creation(overrides: Record<string, unknown> = {}) {
    return {
      address: token,
      creator: FLAP_BSC_MAINNET_DEPLOYMENT.portal.toLowerCase(),
      bytecode: '0x60006000',
      blockHash,
      blockNumber: '0x10',
      transactionHash,
      transactionIndex: '0x1',
      traceAddress: [0, 1],
      raw: {},
      ...overrides,
    };
  }

  it('binds a unique creation trace to the exact Flap receipt and Snapshot', async () => {
    const context = fixture([eventLog(tokenCreated(), 0)]);
    const queries: Array<{ fromBlock: string; toBlock: string }> = [];
    const reader: EvmContractCreationReader = {
      getContractCreationsObservation: async (query) => {
        queries.push({ fromBlock: query.fromBlock, toBlock: query.toBlock });
        return {
          endpointId: 'sqd:binance-mainnet',
          value: query.fromBlock === '16' ? [creation()] : [],
          coverage: {
            fromBlock: query.fromBlock,
            toBlock: query.toBlock,
            nextBlock: (BigInt(query.toBlock) + 1n).toString(),
            finalizedHead: query.toBlock,
            responseBlockCount: 1,
            requestCount: 1,
            completion: 'REQUESTED_RANGE_COMPLETE',
          },
        };
      },
    };
    const result = await inspectFlapTokenOrigin({
      adapter: context.adapter,
      creationReader: reader,
      token,
      fromBlock: '16',
      toBlock: '17',
      chunkSize: 1,
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      writeEvidence: context.writeEvidence,
    });

    expect(result.origin).toMatchObject({
      state: 'known',
      value: {
        contractCreator: FLAP_BSC_MAINNET_DEPLOYMENT.portal.toLowerCase(),
        launchCreator: creator,
        creationTrace: {
          blockNumber: '16',
          transactionIndex: '1',
          traceAddress: [0, 1],
        },
        tokenCreatedPosition: { blockNumber: '16', logIndex: '0' },
      },
    });
    expect(result.lifetimeCoverage).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(result.metadata.historyCoverage).toBe(0);
    expect(result.metadata.snapshot).toMatchObject({
      blockNumber: '17',
      blockHash: `0x${'4'.repeat(64)}`,
    });
    expect(result.searchedRange).toEqual({
      fromBlock: '16',
      toBlock: '17',
      chunkSize: 1,
      chunkCount: 2,
    });
    expect(queries).toEqual([
      { fromBlock: '16', toBlock: '16' },
      { fromBlock: '17', toBlock: '17' },
    ]);
    expect(result.evidence.at(-1)?.kind).toBe('DERIVED_FEATURE');
    expect(context.ledger.drilldown(result.evidence.at(-1)?.id ?? '')).toHaveLength(8);
  });

  it('resumes a failed multi-chunk origin scan and replays a terminal checkpoint without providers', async () => {
    const context = fixture([eventLog(tokenCreated(), 0)]);
    const checkpoints = new MemoryFlapOriginCheckpointStore();
    const queries: Array<{ fromBlock: string; toBlock: string }> = [];
    let secondChunkAttempts = 0;
    const reader: EvmContractCreationReader = {
      getContractCreationsObservation: async (query) => {
        queries.push({ fromBlock: query.fromBlock, toBlock: query.toBlock });
        if (query.fromBlock === '17' && secondChunkAttempts++ === 0) {
          throw new ProviderError('HTTP_ERROR', 'Transient SQD fixture outage.');
        }
        const value = query.fromBlock === '16' ? [creation()] : [];
        return {
          endpointId: 'sqd:binance-mainnet',
          value,
          coverage: {
            fromBlock: query.fromBlock,
            toBlock: query.toBlock,
            nextBlock: (BigInt(query.toBlock) + 1n).toString(),
            finalizedHead: '17',
            responseBlockCount: value.length,
            requestCount: 1,
            completion: 'REQUESTED_RANGE_COMPLETE',
          },
        };
      },
    };
    const options = {
      adapter: context.adapter,
      creationReader: reader,
      token,
      fromBlock: '16',
      toBlock: '17',
      chunkSize: 1,
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      writeEvidence: context.writeEvidence,
      checkpoints,
    };

    await expect(inspectFlapTokenOriginRestartSafe(options)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    });
    expect(checkpoints.run).toMatchObject({ status: 'RUNNING', nextBlock: 17 });
    expect(checkpoints.failures).toEqual(['HTTP_ERROR']);
    expect(checkpoints.advances).toEqual([17]);

    const resumed = await inspectFlapTokenOriginRestartSafe(options);
    expect(resumed.origin).toMatchObject({
      state: 'known',
      value: { creationTrace: { blockNumber: '16', traceAddress: [0, 1] } },
    });
    expect(checkpoints.run).toMatchObject({
      status: 'REQUESTED_RANGE_COMPLETE',
      nextBlock: 18,
    });
    expect(checkpoints.advances).toEqual([17, 18]);
    expect(queries).toEqual([
      { fromBlock: '16', toBlock: '16' },
      { fromBlock: '17', toBlock: '17' },
      { fromBlock: '17', toBlock: '17' },
    ]);

    const providerCallCount = context.transport.calls.length;
    const terminalReplay = await inspectFlapTokenOriginRestartSafe({
      ...options,
      creationReader: {
        getContractCreationsObservation: () => {
          throw new Error('terminal replay reached provider');
        },
      },
      writeEvidence: async () => {
        throw new Error('terminal replay attempted Evidence write');
      },
    });
    expect(terminalReplay).toEqual(resumed);
    expect(context.transport.calls).toHaveLength(providerCallCount);
    expect(queries).toHaveLength(3);
  });

  it('returns bounded negative Evidence without claiming the token has no origin', async () => {
    const context = fixture([eventLog(tokenCreated(), 0)]);
    const result = await inspectFlapTokenOrigin({
      adapter: context.adapter,
      creationReader: creationReader([]),
      token,
      fromBlock: '16',
      toBlock: '16',
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      writeEvidence: context.writeEvidence,
    });

    expect(result.origin).toMatchObject({ state: 'unknown', reason: 'INSUFFICIENT_DATA' });
    expect(result.observedCreationCount).toBe(0);
    expect(result.evidence.at(-1)?.kind).toBe('NEGATIVE_EVIDENCE');
    expect(result.metadata.historyCoverage).toBe(0);
    expect(
      context.transport.calls.some((call) => call.method === 'eth_getTransactionReceipt'),
    ).toBe(false);
  });

  it('keeps an ambiguous bounded origin Unknown without selecting a trace', async () => {
    const context = fixture([eventLog(tokenCreated(), 0)]);
    const result = await inspectFlapTokenOrigin({
      adapter: context.adapter,
      creationReader: creationReader([
        creation({ traceAddress: [0, 1] }),
        creation({ traceAddress: [0, 2] }),
      ]),
      token,
      fromBlock: '16',
      toBlock: '16',
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      writeEvidence: context.writeEvidence,
    });

    expect(result.origin).toMatchObject({ state: 'unknown', reason: 'CONFLICTING_SOURCES' });
    expect(result.observedCreationCount).toBe(2);
    expect(result.evidence.at(-1)?.kind).toBe('DERIVED_FEATURE');
    expect(
      context.transport.calls.some((call) => call.method === 'eth_getTransactionReceipt'),
    ).toBe(false);
  });

  it('rejects a trace whose contract creator is not the official Portal', async () => {
    const context = fixture([eventLog(tokenCreated(), 0)]);
    await expect(
      inspectFlapTokenOrigin({
        adapter: context.adapter,
        creationReader: creationReader([creation({ creator })]),
        token,
        fromBlock: '16',
        toBlock: '16',
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: context.writeEvidence,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a creation source that cannot prove the requested chunk coverage', async () => {
    const context = fixture([eventLog(tokenCreated(), 0)]);
    const reader: EvmContractCreationReader = {
      getContractCreationsObservation: async (query) => ({
        endpointId: 'sqd:binance-mainnet',
        value: [],
        coverage: {
          fromBlock: query.fromBlock,
          toBlock: query.toBlock,
          nextBlock: query.toBlock,
          finalizedHead: query.toBlock,
          responseBlockCount: 0,
          requestCount: 1,
          completion: 'REQUESTED_RANGE_COMPLETE',
        },
      }),
    };
    await expect(
      inspectFlapTokenOrigin({
        adapter: context.adapter,
        creationReader: reader,
        token,
        fromBlock: '16',
        toBlock: '16',
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: context.writeEvidence,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects an operationally unbounded origin request before provider access', async () => {
    const context = fixture([eventLog(tokenCreated(), 0)]);
    const reader = creationReader([]);
    await expect(
      inspectFlapTokenOrigin({
        adapter: context.adapter,
        creationReader: reader,
        token,
        fromBlock: '0',
        toBlock: '250000000',
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: context.writeEvidence,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(context.transport.calls).toHaveLength(0);
  });
});

describe('Flap bounded event-history discovery', () => {
  function historyFixture(includeCreation = true, logReader?: EvmLogReader) {
    const transport = new HistoryJsonRpcTransport(includeCreation);
    const adapter = new EvmLedgerAdapter(
      {
        id: 'bsc-rpc',
        chainId: 56,
        chainName: 'BNB Smart Chain',
        snapshotBlockTag: 'finalized',
      },
      transport,
    );
    const ledger = new EvidenceLedger();
    return {
      transport,
      ledger,
      discover: (fromBlock = '16', toBlock = '17') =>
        discoverFlapEventHistory({
          adapter,
          ...(logReader === undefined ? {} : { logReader }),
          token,
          fromBlock,
          toBlock,
          chunkSize: 1,
          deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
          writeEvidence: async (item, sources = [], snapshot) =>
            ledger.add(item, sources, snapshot).evidence,
        }),
    };
  }

  it('discovers, receipt-replays, and orders token events in a complete requested range', async () => {
    const fixture = historyFixture();
    const result = await fixture.discover();

    expect(result.requestedRange).toEqual({
      fromBlock: '16',
      toBlock: '17',
      chunkSize: 1,
      chunkCount: 2,
    });
    expect(result.requestedRangeCoverage).toBe(1);
    expect(result.lifetimeCoverage).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(result.metadata.historyCoverage).toBe(0);
    expect(result.chronology).toEqual([
      expect.objectContaining({
        transactionHash,
        blockNumber: '16',
        transactionKind: 'CREATION_CONFIGURATION',
        decodedEventNames: ['TokenCreated'],
      }),
    ]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.creation?.symbol).toBe('FIX');
    expect(result.evidence.map((item) => item.kind)).toEqual([
      'PROVIDER_OBSERVATION',
      'PROVIDER_OBSERVATION',
      'DERIVED_FEATURE',
    ]);
    expect(fixture.ledger.drilldown(result.evidence.at(-1)?.id ?? '')).toHaveLength(7);
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_getLogs')).toHaveLength(2);
  });

  it('returns bounded negative Evidence without claiming token-lifetime absence', async () => {
    const fixture = historyFixture(false);
    const result = await fixture.discover();

    expect(result.chronology).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.evidence.at(-1)).toMatchObject({
      kind: 'NEGATIVE_EVIDENCE',
      summary: expect.stringContaining('requested bounded range'),
    });
    expect(result.lifetimeCoverage.state).toBe('unknown');
    expect(result.metadata.historyCoverage).toBe(0);
  });

  it('rejects a discovery log that the exact RPC receipt cannot reproduce', async () => {
    const mismatchedLog = eventLog(tokenCreated(), 1) as ReturnType<typeof eventLog>;
    const logReader: EvmLogReader = {
      getLogsObservation: async () => ({
        endpointId: 'sqd:binance-mainnet',
        value: [
          {
            address: mismatchedLog.address,
            blockHash: mismatchedLog.blockHash,
            blockNumber: mismatchedLog.blockNumber,
            transactionHash: mismatchedLog.transactionHash,
            transactionIndex: mismatchedLog.transactionIndex,
            logIndex: mismatchedLog.logIndex,
            data: mismatchedLog.data,
            topics: mismatchedLog.topics,
            removed: false,
            raw: mismatchedLog,
          },
        ],
      }),
    };

    await expect(historyFixture(true, logReader).discover('16', '16')).rejects.toThrow(
      'could not be reproduced exactly',
    );
  });

  it('rejects invalid or operationally unbounded history requests before network access', async () => {
    const fixture = historyFixture();
    await expect(fixture.discover('17', '16')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(fixture.discover('0', '50000')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(fixture.transport.calls).toHaveLength(0);

    const overflowTransport = new HistoryJsonRpcTransport(true, true);
    const overflowAdapter = new EvmLedgerAdapter(
      { id: 'bsc-rpc', chainId: 56, chainName: 'BNB Smart Chain' },
      overflowTransport,
    );
    await expect(
      discoverFlapEventHistory({
        adapter: overflowAdapter,
        token,
        fromBlock: '16',
        toBlock: '17',
        chunkSize: 1,
        maxLogs: 1,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: async (item) => item,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
