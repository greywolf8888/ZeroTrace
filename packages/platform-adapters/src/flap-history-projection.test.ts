import { describe, expect, it } from 'vitest';

import {
  EvmLedgerAdapter,
  type EvmSnapshot,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import { createEvidence, EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  FlapEventHistorySchema,
  unknownValue,
  type FlapEventHistory,
  type JsonValue,
} from '@zerotrace/schemas';

import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  FLAP_HISTORY_MODEL_VERSION,
  projectFlapEventHistoryRestartSafe,
  type FlapEvidenceWriter,
  type FlapHistoryProjectionCheckpointRun,
  type FlapHistoryProjectionCheckpointStore,
  type FlapHistoryProjectionStore,
  type FlapHistoryProjectionStoredSegment,
  type FlapHistorySegmentExecutor,
} from './index.js';

const token = `0x${'a'.repeat(40)}`;
const scanId = '22222222-2222-4222-8222-222222222222';

class NoNetworkTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-projection-fixture';

  request<T>(_method: string, _params: readonly unknown[] = []): Promise<T> {
    throw new Error('projection fixture reached the network adapter');
  }

  requestSourced<T>(
    _method: string,
    _params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    throw new Error('projection fixture reached the sourced network adapter');
  }
}

class MemoryCheckpointStore implements FlapHistoryProjectionCheckpointStore {
  run: FlapHistoryProjectionCheckpointRun | undefined;
  readonly failures: string[] = [];
  readonly advances: number[] = [];
  failNextAdvance = false;

  async begin(input: {
    fromBlock: number;
    initialState: JsonValue;
  }): Promise<FlapHistoryProjectionCheckpointRun> {
    this.run ??= {
      id: scanId,
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
  ): Promise<FlapHistoryProjectionCheckpointRun> {
    if (this.run?.id !== id || this.run.status !== 'RUNNING') throw new Error('missing run');
    if (this.run.nextBlock !== input.expectedNextBlock) throw new Error('stale cursor');
    if (this.failNextAdvance) {
      this.failNextAdvance = false;
      const error = new Error('fixture checkpoint outage') as Error & { code: string };
      error.code = 'SEMANTIC_CHECKPOINT_UNAVAILABLE';
      throw error;
    }
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
  ): Promise<FlapHistoryProjectionCheckpointRun> {
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

  async recordFailure(id: string, errorCode: string): Promise<FlapHistoryProjectionCheckpointRun> {
    if (this.run?.id !== id) throw new Error('missing run');
    this.failures.push(errorCode);
    return this.run;
  }
}

class MemoryProjectionStore implements FlapHistoryProjectionStore {
  readonly segments: FlapHistoryProjectionStoredSegment[] = [];
  putCalls = 0;
  listCalls = 0;

  async putSegment(input: {
    scanId: string;
    result: FlapEventHistory;
  }): Promise<FlapHistoryProjectionStoredSegment> {
    this.putCalls += 1;
    const result = FlapEventHistorySchema.parse(input.result);
    const fromBlock = Number(result.requestedRange.fromBlock);
    const toBlock = Number(result.requestedRange.toBlock);
    const terminal = result.evidence.at(-1);
    if (terminal === undefined) throw new Error('fixture terminal Evidence vanished');
    const stored: FlapHistoryProjectionStoredSegment = {
      id: `fhs_${hashPayload({ scanId: input.scanId, result }).slice(0, 24)}`,
      scanId: input.scanId,
      chainId: 'eip155:56',
      token: result.token,
      fromBlock,
      toBlock,
      result,
      terminalEvidenceId: terminal.id,
      sourceSet: result.metadata.sourceSet,
      transactionCount: result.transactions.length,
      unrecognizedPortalLogCount: result.unrecognizedPortalLogCount,
    };
    this.segments.push(stored);
    return stored;
  }

  async listSegments(
    _scanId: string,
    options: { afterBlock?: number; limit?: number } = {},
  ): Promise<FlapHistoryProjectionStoredSegment[]> {
    this.listCalls += 1;
    return this.segments
      .filter(
        (segment) => options.afterBlock === undefined || segment.fromBlock > options.afterBlock,
      )
      .slice(0, options.limit ?? 100);
  }
}

function snapshot(blockNumber: string): EvmSnapshot {
  const blockHex = BigInt(blockNumber).toString(16).padStart(64, '0');
  const parentHex = (BigInt(blockNumber) - 1n).toString(16).padStart(64, '0');
  return {
    ledger: 'EVM',
    chainId: 'eip155:56',
    blockNumber,
    blockHash: `0x${blockHex}`,
    parentBlockHash: `0x${parentHex}`,
    finality: 'finalized',
    capturedAt: '2026-08-10T00:00:00.000Z',
    providerVersions: {
      'bsc-projection-fixture': 'fixture-v1',
      'sqd:binance-mainnet': 'fixture-v1',
    },
    adapterVersions: { evm: 'fixture-v1' },
    configHash: '1'.repeat(64),
    entityModelVersion: 'entity-v1',
    labelSnapshot: 'labels-v1',
  };
}

function segmentExecutor(ledger: EvidenceLedger, calls: string[]): FlapHistorySegmentExecutor {
  return async (options) => {
    calls.push(`${options.fromBlock}-${options.toBlock}`);
    const segmentSnapshot = snapshot(options.toBlock);
    const observation = await options.writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: 'eip155:56',
        kind: 'PROVIDER_OBSERVATION',
        source: 'sqd:binance-mainnet',
        locator: `fixture-flap-logs:${options.fromBlock}-${options.toBlock}`,
        payload: { fromBlock: options.fromBlock, toBlock: options.toBlock, logs: [] },
        observedAt: segmentSnapshot.capturedAt,
        blockOrSlot: options.toBlock,
        finality: segmentSnapshot.finality,
        summary: 'Fixture bounded Flap log observation.',
      }),
      [],
      segmentSnapshot,
    );
    const terminal = await options.writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: 'eip155:56',
        kind: 'NEGATIVE_EVIDENCE',
        source: `zerotrace:${FLAP_HISTORY_MODEL_VERSION}`,
        locator: `flap-event-history:${options.token}:${options.fromBlock}-${options.toBlock}`,
        payload: {
          token: options.token,
          requestedRange: { fromBlock: options.fromBlock, toBlock: options.toBlock },
          chronology: [],
        },
        observedAt: segmentSnapshot.capturedAt,
        blockOrSlot: options.toBlock,
        finality: segmentSnapshot.finality,
        summary: 'Fixture contains no supported Flap event in the bounded range.',
        sourceEvidenceIds: [observation.id],
      }),
      [observation.id],
      segmentSnapshot,
    );
    const evidenceIds = [observation.id, terminal.id].sort();
    return FlapEventHistorySchema.parse({
      platform: 'flap',
      token: options.token,
      requestedRange: {
        fromBlock: options.fromBlock,
        toBlock: options.toBlock,
        chunkSize: options.chunkSize,
        chunkCount: Math.ceil(
          (Number(options.toBlock) - Number(options.fromBlock) + 1) / options.chunkSize,
        ),
      },
      requestedRangeCoverage: 1,
      lifetimeCoverage: unknownValue(
        'INSUFFICIENT_DATA',
        'Fixture bounded coverage is not lifetime coverage.',
      ),
      chronology: [],
      transactions: [],
      unrecognizedPortalLogCount: 0,
      metadata: AnalysisMetadataSchema.parse({
        snapshot: segmentSnapshot,
        dataCoverage: 1,
        sourceCoverage: 1,
        historyCoverage: 0,
        simulationCoverage: 0,
        freshness: segmentSnapshot.capturedAt,
        sourceSet: ['bsc-projection-fixture', 'sqd:binance-mainnet'],
        modelVersion: FLAP_HISTORY_MODEL_VERSION,
        confidence: 0.95,
        evidenceIds,
      }),
      evidence: [observation, terminal],
    });
  };
}

function fixture() {
  const ledger = new EvidenceLedger();
  const checkpoints = new MemoryCheckpointStore();
  const projection = new MemoryProjectionStore();
  const calls: string[] = [];
  const adapter = new EvmLedgerAdapter(
    {
      id: 'bsc-projection-fixture',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    new NoNetworkTransport(),
  );
  const writeEvidence: FlapEvidenceWriter = async (item, sources = [], boundSnapshot) =>
    ledger.add(item, sources, boundSnapshot).evidence;
  return {
    ledger,
    checkpoints,
    projection,
    calls,
    options: {
      adapter,
      logReader: {
        endpointId: 'sqd:binance-mainnet' as const,
        getLogsObservation: () => {
          throw new Error('fixture segment executor did not intercept log reads');
        },
      },
      token,
      fromBlock: '100',
      toBlock: '103',
      segmentSize: 2,
      chunkSize: 1,
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      writeEvidence,
      checkpoints,
      projection,
      executeSegment: segmentExecutor(ledger, calls),
    },
  };
}

describe('restart-safe Flap event-history projection', () => {
  it('projects complete bounded segments and replays a terminal checkpoint without I/O', async () => {
    const context = fixture();
    const result = await projectFlapEventHistoryRestartSafe(context.options);

    expect(result.requestedRange).toEqual({
      fromBlock: '100',
      toBlock: '103',
      segmentSize: 2,
      segmentCount: 2,
    });
    expect(result.requestedRangeCoverage).toBe(1);
    expect(result.lifetimeCoverage).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(result.metadata).toMatchObject({
      dataCoverage: 1,
      historyCoverage: 0,
      confidence: 0.95,
    });
    expect(result.evidence[0]?.kind).toBe('NEGATIVE_EVIDENCE');
    expect(result.segments.map((segment) => [segment.fromBlock, segment.toBlock])).toEqual([
      ['100', '101'],
      ['102', '103'],
    ]);
    expect(context.calls).toEqual(['100-101', '102-103']);
    expect(context.projection.putCalls).toBe(2);
    expect(context.ledger.drilldown(result.terminalEvidenceId)).toHaveLength(5);

    const terminalReplay = await projectFlapEventHistoryRestartSafe({
      ...context.options,
      projection: {
        putSegment: () => {
          throw new Error('terminal replay attempted projection write');
        },
        listSegments: () => {
          throw new Error('terminal replay attempted projection read');
        },
      },
      executeSegment: () => {
        throw new Error('terminal replay attempted segment execution');
      },
      writeEvidence: () => {
        throw new Error('terminal replay attempted Evidence write');
      },
    });
    expect(terminalReplay).toEqual(result);
  });

  it('adopts a segment written before a failed cursor advance without re-executing it', async () => {
    const context = fixture();
    context.checkpoints.failNextAdvance = true;

    await expect(projectFlapEventHistoryRestartSafe(context.options)).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_UNAVAILABLE',
    });
    expect(context.calls).toEqual(['100-101']);
    expect(context.projection.segments).toHaveLength(1);
    expect(context.checkpoints.run).toMatchObject({ nextBlock: 100, status: 'RUNNING' });
    expect(context.checkpoints.failures).toEqual(['SEMANTIC_CHECKPOINT_UNAVAILABLE']);

    const resumed = await projectFlapEventHistoryRestartSafe(context.options);
    expect(resumed.requestedRangeCoverage).toBe(1);
    expect(context.calls).toEqual(['100-101', '102-103']);
    expect(context.projection.putCalls).toBe(2);
    expect(context.checkpoints.advances).toEqual([102, 104]);
  });

  it('rejects a non-canonical discovery source before creating a checkpoint', async () => {
    const context = fixture();
    await expect(
      projectFlapEventHistoryRestartSafe({
        ...context.options,
        logReader: {
          ...context.options.logReader,
          endpointId: 'untrusted-history-source',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(context.checkpoints.run).toBeUndefined();
  });
});
