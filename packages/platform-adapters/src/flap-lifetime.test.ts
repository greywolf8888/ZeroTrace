import { describe, expect, it } from 'vitest';

import {
  EvmLedgerAdapter,
  type EvmContractCreationReader,
  type EvmLogReader,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  ChainAnchorReadSchema,
  FlapEventHistoryProjectionSchema,
  FlapTokenOriginSchema,
  knownValue,
  unknownValue,
  type ChainAnchorRead,
  type Evidence,
  type FlapEventHistoryProjection,
  type FlapTokenOrigin,
  type JsonValue,
} from '@zerotrace/schemas';

import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  FLAP_HISTORY_PROJECTION_MODEL_VERSION,
  FLAP_TOKEN_ORIGIN_MODEL_VERSION,
  extendFlapLifetimeRestartSafe,
  materializeFlapLifetimeRestartSafe,
  type FlapEventHistoryProjectionRun,
  type FlapEvidenceWriter,
  type FlapHistoryProjectionStore,
  type FlapOriginCheckpointRun,
  type FlapOriginCheckpointStore,
  type FlapTokenOriginRun,
} from './index.js';

const token = `0x${'a'.repeat(40)}`;
const creator = `0x${'c'.repeat(40)}`;
const transactionHash = `0x${'3'.repeat(64)}`;
const originScanId = '11111111-1111-4111-8111-111111111111';
const historyScanId = '22222222-2222-4222-8222-222222222222';
const materializationScanId = '33333333-3333-4333-8333-333333333333';
const extensionScanId = '44444444-4444-4444-8444-444444444444';

class NoNetworkTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-lifetime-fixture';

  request<T>(_method: string, _params: readonly unknown[] = []): Promise<T> {
    throw new Error('lifetime fixture reached the network adapter');
  }

  requestSourced<T>(
    _method: string,
    _params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    throw new Error('lifetime fixture reached the sourced network adapter');
  }
}

class MemoryCheckpointStore implements FlapOriginCheckpointStore {
  run: FlapOriginCheckpointRun | undefined;
  readonly failures: string[] = [];
  readonly advances: number[] = [];
  failNextFinish = false;

  constructor(readonly scanId = materializationScanId) {}

  async begin(input: {
    fromBlock: number;
    initialState: JsonValue;
  }): Promise<FlapOriginCheckpointRun> {
    this.run ??= {
      id: this.scanId,
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
    if (this.failNextFinish) {
      this.failNextFinish = false;
      const error = new Error('fixture finish outage') as Error & { code: string };
      error.code = 'SEMANTIC_CHECKPOINT_UNAVAILABLE';
      throw error;
    }
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

function targetAnchor(blockNumber = '103'): ChainAnchorRead {
  const numeric = BigInt(blockNumber);
  const blockHash = `0x${numeric.toString(16).padStart(64, '0')}`;
  const parentBlockHash = `0x${(numeric - 1n).toString(16).padStart(64, '0')}`;
  return ChainAnchorReadSchema.parse({
    anchor: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      position: blockNumber,
      hash: blockHash,
      parentPosition: (numeric - 1n).toString(),
      parentHash: parentBlockHash,
      finality: 'finalized',
      source: 'bsc-lifetime-fixture',
      observedAt: '2026-08-10T00:00:00.000Z',
    },
    snapshot: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      blockNumber,
      blockHash,
      parentBlockHash,
      finality: 'finalized',
      capturedAt: '2026-08-10T00:00:00.000Z',
      providerVersions: {
        'bsc-lifetime-fixture': 'fixture-v1',
        'sqd:binance-mainnet': 'fixture-v1',
      },
      adapterVersions: { evm: 'fixture-v1' },
      configHash: '1'.repeat(64),
      entityModelVersion: 'entity-v1',
      labelSnapshot: 'labels-v1',
    },
    payload: {
      number: `0x${numeric.toString(16)}`,
      hash: blockHash,
      parentHash: parentBlockHash,
    },
  });
}

function originEvidence(anchor: ChainAnchorRead): Evidence[] {
  const observation = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'PROVIDER_OBSERVATION',
    source: 'sqd:binance-mainnet',
    locator: `fixture-origin:${token}`,
    payload: { token },
    observedAt: anchor.snapshot.capturedAt,
    blockOrSlot: anchor.anchor.position,
    finality: 'finalized',
    summary: 'Fixture contract creation observation.',
  });
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${FLAP_TOKEN_ORIGIN_MODEL_VERSION}`,
    locator: `flap-token-origin:${token}:100-${anchor.anchor.position}`,
    payload: { token, origin: 'known' },
    observedAt: anchor.snapshot.capturedAt,
    blockOrSlot: anchor.anchor.position,
    finality: 'finalized',
    summary: 'Fixture unique Flap token origin.',
    sourceEvidenceIds: [observation.id],
  });
  return [observation, terminal];
}

function originRun(
  anchor: ChainAnchorRead,
  known: boolean,
  fromBlock = '100',
  toBlock = anchor.anchor.position,
  snapshotAnchor = anchor,
): FlapTokenOriginRun {
  const evidence = originEvidence(snapshotAnchor);
  const result: FlapTokenOrigin = FlapTokenOriginSchema.parse({
    platform: 'flap',
    token,
    searchedRange: {
      fromBlock,
      toBlock,
      chunkSize: 2,
      chunkCount: Math.ceil((Number(toBlock) - Number(fromBlock) + 1) / 2),
    },
    searchedRangeCoverage: 1,
    origin: known
      ? knownValue({
          contractCreator: FLAP_BSC_MAINNET_DEPLOYMENT.portal.toLowerCase(),
          launchCreator: creator,
          bytecodeFingerprint: '4'.repeat(64),
          creationTrace: {
            transactionHash,
            blockNumber: '100',
            blockHash: `0x${'5'.repeat(64)}`,
            transactionIndex: '1',
            traceAddress: [0, 1],
          },
          tokenCreatedPosition: {
            transactionHash,
            blockNumber: '100',
            blockHash: `0x${'5'.repeat(64)}`,
            transactionIndex: '1',
            logIndex: '0',
          },
          evidenceIds: evidence.map((item) => item.id),
        })
      : unknownValue('INSUFFICIENT_DATA', 'No unique creation was proven in the dataset range.'),
    lifetimeCoverage: unknownValue(
      'INSUFFICIENT_DATA',
      'Origin inspection alone cannot claim lifetime event coverage.',
    ),
    observedCreationCount: known ? 1 : 0,
    metadata: AnalysisMetadataSchema.parse({
      snapshot: snapshotAnchor.snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: snapshotAnchor.snapshot.capturedAt,
      sourceSet: ['sqd:binance-mainnet', 'bsc-lifetime-fixture'],
      modelVersion: FLAP_TOKEN_ORIGIN_MODEL_VERSION,
      confidence: known ? 0.99 : 0.7,
      evidenceIds: evidence.map((item) => item.id),
    }),
    evidence,
  });
  return { scanId: originScanId, result };
}

function historyRun(anchor: ChainAnchorRead, fromBlock = '100'): FlapEventHistoryProjectionRun {
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${FLAP_HISTORY_PROJECTION_MODEL_VERSION}`,
    locator: `flap-event-history-projection:${token}:${fromBlock}-${anchor.anchor.position}`,
    payload: { token, fromBlock, toBlock: anchor.anchor.position },
    observedAt: anchor.snapshot.capturedAt,
    blockOrSlot: anchor.anchor.position,
    finality: 'finalized',
    summary: 'Fixture complete origin-to-target Flap history projection.',
    sourceEvidenceIds: ['ev_000000000000000000000000'],
  });
  const result: FlapEventHistoryProjection = FlapEventHistoryProjectionSchema.parse({
    platform: 'flap',
    token,
    requestedRange: {
      fromBlock,
      toBlock: anchor.anchor.position,
      segmentSize: 2,
      segmentCount: 2,
    },
    requestedRangeCoverage: 1,
    lifetimeCoverage: unknownValue(
      'INSUFFICIENT_DATA',
      'A bounded child projection does not independently prove lifetime coverage.',
    ),
    segments: [
      {
        id: `fhs_${'1'.repeat(24)}`,
        fromBlock,
        toBlock: anchor.anchor.position,
        terminalEvidenceId: terminal.id,
        transactionCount: 3,
        unrecognizedPortalLogCount: 0,
      },
    ],
    transactionCount: 3,
    unrecognizedPortalLogCount: 0,
    terminalEvidenceId: terminal.id,
    metadata: AnalysisMetadataSchema.parse({
      snapshot: anchor.snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: anchor.snapshot.capturedAt,
      sourceSet: ['sqd:binance-mainnet', 'bsc-lifetime-fixture'],
      modelVersion: FLAP_HISTORY_PROJECTION_MODEL_VERSION,
      confidence: 0.98,
      evidenceIds: [terminal.id],
    }),
    evidence: [terminal],
  });
  return { scanId: historyScanId, result };
}

function fixture() {
  const checkpoints = new MemoryCheckpointStore();
  const anchor = targetAnchor();
  const adapter = new EvmLedgerAdapter(
    {
      id: 'bsc-lifetime-fixture',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    new NoNetworkTransport(),
  );
  const written: Evidence[] = [];
  const writeEvidence: FlapEvidenceWriter = async (item) => {
    written.push(item);
    return item;
  };
  const creationReader: EvmContractCreationReader = {
    getContractCreationsObservation: () => {
      throw new Error('fixture origin executor did not intercept creation reads');
    },
  };
  const logReader: EvmLogReader & { readonly endpointId: string } = {
    endpointId: 'sqd:binance-mainnet',
    getLogsObservation: () => {
      throw new Error('fixture history executor did not intercept log reads');
    },
  };
  const projection: FlapHistoryProjectionStore = {
    putSegment: () => {
      throw new Error('fixture history executor did not intercept projection writes');
    },
    listSegments: () => {
      throw new Error('fixture history executor did not intercept projection reads');
    },
  };
  return {
    anchor,
    checkpoints,
    written,
    options: {
      adapter,
      creationReader,
      logReader,
      token,
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      checkpoints,
      projection,
      writeEvidence,
      readDatasetMetadata: async () => ({
        dataset: 'binance-mainnet' as const,
        aliases: ['bsc-mainnet'],
        realTime: true,
        startBlock: 100,
      }),
      targetAnchor: anchor,
    },
  };
}

describe('restart-safe Flap lifetime materialization', () => {
  it('proves lifetime coverage only from dataset start through one exact finalized target', async () => {
    const context = fixture();
    const origins: string[] = [];
    const histories: string[] = [];
    const result = await materializeFlapLifetimeRestartSafe({
      ...context.options,
      executeOrigin: async (options) => {
        origins.push(`${options.fromBlock}-${options.toBlock}`);
        return originRun(context.anchor, true);
      },
      executeHistory: async (options) => {
        histories.push(`${options.fromBlock}-${options.toBlock}`);
        return historyRun(context.anchor);
      },
    });

    expect(result.scanId).toBe(materializationScanId);
    expect(result.result).toMatchObject({
      datasetStartBlock: '100',
      targetBlock: '103',
      originScanId,
      originSearchCoverage: 1,
      lifetimeCoverage: { state: 'known', value: true },
      historyProjection: {
        scanId: historyScanId,
        fromBlock: '100',
        toBlock: '103',
        requestedRangeCoverage: 1,
      },
      metadata: { dataCoverage: 1, historyCoverage: 1, confidence: 0.98 },
    });
    expect(origins).toEqual(['100-103']);
    expect(histories).toEqual(['100-103']);
    expect(context.checkpoints).toMatchObject({ advances: [104], failures: [] });
    expect(context.checkpoints.run).toMatchObject({
      status: 'REQUESTED_RANGE_COMPLETE',
      nextBlock: 104,
    });
    expect(context.written.map((item) => item.kind)).toEqual([
      'PROVIDER_OBSERVATION',
      'BLOCK',
      'DERIVED_FEATURE',
    ]);
  });

  it('keeps lifetime coverage Unknown and skips history when no unique origin is proven', async () => {
    const context = fixture();
    let historyCalls = 0;
    const result = await materializeFlapLifetimeRestartSafe({
      ...context.options,
      executeOrigin: async () => originRun(context.anchor, false),
      executeHistory: async () => {
        historyCalls += 1;
        return historyRun(context.anchor);
      },
    });

    expect(result.result.origin).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(result.result.lifetimeCoverage).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(result.result.historyProjection).toBeNull();
    expect(result.result.metadata.historyCoverage).toBe(0);
    expect(historyCalls).toBe(0);
  });

  it('records a verified origin hint without promoting it to full lifetime coverage', async () => {
    const context = fixture();
    const origins: string[] = [];
    const histories: string[] = [];
    const result = await materializeFlapLifetimeRestartSafe({
      ...context.options,
      originHintBlock: 100,
      executeOrigin: async (options) => {
        origins.push(`${options.fromBlock}-${options.toBlock}`);
        return originRun(context.anchor, true, '100', '100', targetAnchor('100'));
      },
      executeHistory: async (options) => {
        histories.push(`${options.fromBlock}-${options.toBlock}`);
        return historyRun(context.anchor);
      },
    });

    expect(result.result).toMatchObject({
      originSearchMode: 'VERIFIED_HINT',
      originSearchCoverage: 1,
      origin: { state: 'known' },
      lifetimeCoverage: {
        state: 'unknown',
        reason: 'INSUFFICIENT_DATA',
      },
      historyProjection: { requestedRangeCoverage: 1 },
      metadata: { historyCoverage: 1 },
    });
    expect(origins).toEqual(['100-100']);
    expect(histories).toEqual(['100-103']);
    expect(context.written.at(-1)?.summary).toContain(
      'verified at an explicit finalized hint block',
    );
  });

  it('fails closed when child history is not bound to the exact target Snapshot', async () => {
    const context = fixture();
    await expect(
      materializeFlapLifetimeRestartSafe({
        ...context.options,
        executeOrigin: async () => originRun(context.anchor, true),
        executeHistory: async () => {
          const history = historyRun(targetAnchor('102'));
          return {
            ...history,
            result: FlapEventHistoryProjectionSchema.parse({
              ...history.result,
              requestedRange: { ...history.result.requestedRange, toBlock: '103' },
            }),
          };
        },
      }),
    ).rejects.toThrow('Flap event history does not prove exact origin-to-target coverage.');
    expect(context.checkpoints.failures).toEqual(['FLAP_LIFETIME_MATERIALIZATION_FAILED']);
    expect(context.checkpoints.run).toMatchObject({ status: 'RUNNING', nextBlock: 100 });
  });

  it('finishes an advanced result after a checkpoint outage without repeating child work', async () => {
    const context = fixture();
    context.checkpoints.failNextFinish = true;
    let originCalls = 0;
    let historyCalls = 0;
    const firstOptions = {
      ...context.options,
      executeOrigin: async () => {
        originCalls += 1;
        return originRun(context.anchor, true);
      },
      executeHistory: async () => {
        historyCalls += 1;
        return historyRun(context.anchor);
      },
    };

    await expect(materializeFlapLifetimeRestartSafe(firstOptions)).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_UNAVAILABLE',
    });
    expect(context.checkpoints.run).toMatchObject({ status: 'RUNNING', nextBlock: 104 });
    expect(context.checkpoints.failures).toEqual(['SEMANTIC_CHECKPOINT_UNAVAILABLE']);

    const replay = await materializeFlapLifetimeRestartSafe({
      ...context.options,
      executeOrigin: async () => {
        throw new Error('advanced replay repeated origin work');
      },
      executeHistory: async () => {
        throw new Error('advanced replay repeated history work');
      },
      writeEvidence: async () => {
        throw new Error('advanced replay repeated Evidence writes');
      },
    });
    expect(replay.result.lifetimeCoverage).toEqual(knownValue(true));
    expect(originCalls).toBe(1);
    expect(historyCalls).toBe(1);
    expect(context.checkpoints.run?.status).toBe('REQUESTED_RANGE_COMPLETE');
  });
});

describe('restart-safe incremental Flap lifetime extension', () => {
  async function predecessor() {
    const context = fixture();
    return materializeFlapLifetimeRestartSafe({
      ...context.options,
      executeOrigin: async () => originRun(context.anchor, true),
      executeHistory: async () => historyRun(context.anchor),
    });
  }

  function continuity() {
    const previous = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'BLOCK',
      source: 'bsc-lifetime-fixture',
      locator: 'anchor:103',
      payload: { block: '103' },
      blockOrSlot: '103',
      finality: 'finalized',
      observedAt: '2026-08-10T00:00:00.000Z',
      summary: 'Fixture predecessor anchor.',
    });
    const current = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'BLOCK',
      source: 'bsc-lifetime-fixture',
      locator: 'anchor:105',
      payload: { block: '105' },
      blockOrSlot: '105',
      finality: 'finalized',
      observedAt: '2026-08-10T00:01:00.000Z',
      summary: 'Fixture current anchor.',
    });
    const terminal = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace-data-quality',
      locator: 'anchor-continuity:bsc-lifetime-fixture:103:105',
      payload: { status: 'HISTORICAL_MATCH' },
      blockOrSlot: '105',
      finality: 'finalized',
      observedAt: '2026-08-10T00:01:00.000Z',
      summary: 'Fixture finalized anchor continuity.',
      sourceEvidenceIds: [previous.id, current.id],
    });
    return {
      status: 'HISTORICAL_MATCH' as const,
      continuous: knownValue(true),
      evidenceIds: [previous.id, current.id, terminal.id].sort(),
      terminalEvidenceId: terminal.id,
    };
  }

  it('extends a Known predecessor with only the continuous target delta', async () => {
    const prior = await predecessor();
    const context = fixture();
    const anchor = targetAnchor('105');
    const checkpoints = new MemoryCheckpointStore(extensionScanId);
    const historyCalls: string[] = [];
    const extension = await extendFlapLifetimeRestartSafe({
      adapter: context.options.adapter,
      logReader: context.options.logReader,
      token,
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      predecessor: prior,
      continuity: continuity(),
      targetAnchor: anchor,
      checkpoints,
      projection: context.options.projection,
      writeEvidence: context.options.writeEvidence,
      executeHistory: async (options) => {
        historyCalls.push(`${options.fromBlock}-${options.toBlock}`);
        return historyRun(anchor, options.fromBlock);
      },
    });

    expect(extension.scanId).toBe(extensionScanId);
    expect(historyCalls).toEqual(['104-105']);
    expect(extension.result).toMatchObject({
      targetBlock: '105',
      predecessor: {
        scanId: materializationScanId,
        targetBlock: '103',
        terminalEvidenceId: prior.result.terminalEvidenceId,
      },
      originScanId,
      continuity: { status: 'HISTORICAL_MATCH', continuous: { state: 'known', value: true } },
      historyProjection: { fromBlock: '104', toBlock: '105', requestedRangeCoverage: 1 },
      lifetimeCoverage: { state: 'known', value: true },
      metadata: { dataCoverage: 1, historyCoverage: 1, confidence: 0.98 },
    });
    expect(checkpoints).toMatchObject({ advances: [106], failures: [] });
  });

  it('rejects non-Known continuity before creating an extension checkpoint', async () => {
    const prior = await predecessor();
    const context = fixture();
    const checkpoints = new MemoryCheckpointStore(extensionScanId);
    await expect(
      extendFlapLifetimeRestartSafe({
        adapter: context.options.adapter,
        logReader: context.options.logReader,
        token,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        predecessor: prior,
        continuity: {
          ...continuity(),
          continuous: unknownValue('INSUFFICIENT_DATA', 'Continuity check is incomplete.'),
        },
        targetAnchor: targetAnchor('105'),
        checkpoints,
        projection: context.options.projection,
        writeEvidence: context.options.writeEvidence,
      }),
    ).rejects.toThrow('Flap lifetime extension requires Known target-chain continuity.');
    expect(checkpoints.run).toBeUndefined();
  });
});
