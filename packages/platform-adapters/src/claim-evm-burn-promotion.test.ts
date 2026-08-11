import { describe, expect, it, vi } from 'vitest';

import {
  EvmLedgerAdapter,
  type EvmSnapshot,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import {
  AnalysisMetadataSchema,
  EvmClaimBurnCandidateDiscoverySchema,
  EvmClaimBurnConservationSchema,
  EvmClaimBurnPromotionSchema,
  unknownValue,
  type JsonValue,
} from '@zerotrace/schemas';

import {
  ERC20_BURN_PROMOTION_SOURCE,
  runErc20BurnPromotionRestartSafe,
  type Erc20BurnPromotionCheckpointRun,
  type Erc20BurnPromotionCheckpointStore,
} from './index.js';

const token = `0x${'a'.repeat(40)}`;
const actor = `0x${'b'.repeat(40)}`;
const zeroAddress = `0x${'0'.repeat(40)}`;
const scanId = '44444444-4444-4444-8444-444444444444';

function blockHash(blockNumber: number): `0x${string}` {
  return `0x${blockNumber.toString(16).padStart(64, '0')}`;
}

function evidenceId(value: number): string {
  return `ev_${value.toString(16).padStart(24, '0')}`;
}

class BlockTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-fixture';
  readonly calls: Array<{ method: string; params: readonly unknown[] }> = [];

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    this.calls.push({ method, params });
    if (method !== 'eth_getBlockByNumber') throw new Error(`Unexpected fixture method ${method}`);
    const raw = params[0];
    if (typeof raw !== 'string' || !/^0x[0-9a-f]+$/i.test(raw)) {
      throw new Error('Invalid fixture block request');
    }
    const block = Number(BigInt(raw));
    return {
      number: raw,
      hash: blockHash(block),
      parentHash: blockHash(block - 1),
      timestamp: `0x${(1_700_000_000 + block).toString(16)}`,
    } as T;
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    return { value: await this.request<T>(method, params), endpointId: this.endpointId };
  }
}

class MemoryCheckpointStore implements Erc20BurnPromotionCheckpointStore {
  run: Erc20BurnPromotionCheckpointRun | undefined;
  readonly advances: number[] = [];
  readonly failures: string[] = [];

  async begin(input: {
    fromBlock: number;
    initialState: JsonValue;
  }): Promise<Erc20BurnPromotionCheckpointRun> {
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
  ): Promise<Erc20BurnPromotionCheckpointRun> {
    if (this.run?.id !== id || this.run.nextBlock !== input.expectedNextBlock) {
      throw new Error('stale fixture checkpoint');
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
  ): Promise<Erc20BurnPromotionCheckpointRun> {
    if (this.run?.id !== id) throw new Error('missing fixture checkpoint');
    if (this.run.status === 'REQUESTED_RANGE_COMPLETE') return this.run;
    this.run = {
      ...this.run,
      status: 'REQUESTED_RANGE_COMPLETE',
      state: input.state,
      evidenceIds: [...input.evidenceIds],
    };
    return this.run;
  }

  async recordFailure(id: string, errorCode: string): Promise<Erc20BurnPromotionCheckpointRun> {
    if (this.run?.id !== id) throw new Error('missing fixture checkpoint');
    this.failures.push(errorCode);
    return this.run;
  }
}

function adapter(transport: BlockTransport): EvmLedgerAdapter {
  return new EvmLedgerAdapter(
    {
      id: 'bsc',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    transport,
  );
}

function discovery(snapshot: EvmSnapshot, fromBlock: string, withCandidate: boolean) {
  const block = Number(fromBlock);
  const terminalEvidenceId = evidenceId(1000 + Number(snapshot.blockNumber));
  const candidates = withCandidate
    ? [
        {
          blockNumber: fromBlock,
          blockHash: blockHash(block),
          burnTransferIds: [`transfer:${block}`],
          mintedEventAmount: '10',
          burnedEventAmount: '20',
        },
      ]
    : [];
  return EvmClaimBurnCandidateDiscoverySchema.parse({
    tokenAddress: token,
    fromBlock,
    toBlock: snapshot.blockNumber,
    coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS',
    status: withCandidate ? 'CANDIDATES_DISCOVERED' : 'NO_EVENT_CANDIDATES',
    zeroAddressEventCount: withCandidate ? 2 : 0,
    burnCandidateCount: candidates.length,
    candidates,
    silentSupplyChangeDetection: unknownValue('NOT_QUERIED'),
    terminalEvidenceId,
    metadata: AnalysisMetadataSchema.parse({
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: [ERC20_BURN_PROMOTION_SOURCE],
      modelVersion: 'erc20-burn-candidate-discovery-v1.0.0',
      confidence: 0.98,
      evidenceIds: [terminalEvidenceId],
    }),
  });
}

function certificate(snapshot: EvmSnapshot) {
  const block = Number(snapshot.blockNumber);
  const sourceEvidenceId = evidenceId(2000 + block);
  const terminalEvidenceId = evidenceId(3000 + block);
  return EvmClaimBurnConservationSchema.parse({
    tokenAddress: token,
    blockNumber: snapshot.blockNumber,
    blockHash: snapshot.blockHash,
    parentBlockNumber: String(block - 1),
    parentBlockHash: snapshot.parentBlockHash,
    totalSupplyBefore: '1000',
    totalSupplyAfter: '990',
    mintedAmount: '10',
    burnedAmount: '20',
    supplyDelta: '-10',
    eventNetSupplyDelta: '-10',
    expectedSupplyAfter: '990',
    status: 'VERIFIED',
    candidateBurnTransferIds: [`transfer:${block}`],
    actions: [
      {
        id: `action:${block}`,
        type: 'BURN',
        actor,
        amount: '20',
        observedAt: snapshot.blockTimestamp,
        transferIds: [`transfer:${block}`],
        path: [actor, zeroAddress],
        evidenceIds: [sourceEvidenceId],
      },
    ],
    terminalEvidenceId,
    metadata: AnalysisMetadataSchema.parse({
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: ['bsc-fixture', ERC20_BURN_PROMOTION_SOURCE],
      modelVersion: 'erc20-burn-conservation-v1.0.0',
      confidence: 0.98,
      evidenceIds: [sourceEvidenceId, terminalEvidenceId],
    }),
  });
}

function options(
  checkpoints: MemoryCheckpointStore,
  transport: BlockTransport,
  overrides: Record<string, unknown> = {},
) {
  return {
    adapter: adapter(transport),
    logReader: { endpointId: ERC20_BURN_PROMOTION_SOURCE } as never,
    tokenAddress: token,
    fromBlock: '100',
    toBlock: '103',
    segmentSize: 2,
    checkpoints,
    writeEvidence: vi.fn(async (evidence) => evidence),
    discoverSegment: vi.fn(async (input) => ({
      report: discovery(input.snapshot, input.fromBlock, input.fromBlock === '100'),
      evidence: [],
    })),
    certifyCandidate: vi.fn(async (input) => ({
      report: certificate(input.snapshot),
      evidence: [],
    })),
    ...overrides,
  };
}

describe('restart-safe ERC-20 burn candidate promotion', () => {
  it('advances only complete segments and persists an evidence-linked terminal result', async () => {
    const checkpoints = new MemoryCheckpointStore();
    const transport = new BlockTransport();
    const request = options(checkpoints, transport);

    const run = await runErc20BurnPromotionRestartSafe(request);

    expect(checkpoints.advances).toEqual([102, 104]);
    expect(run.scanId).toBe(scanId);
    expect(run.result).toMatchObject({
      status: 'REQUESTED_RANGE_COMPLETE',
      segmentCount: 2,
      zeroAddressEventCount: 2,
      burnCandidateCount: 1,
      verifiedCandidateCount: 1,
      contradictedCandidateCount: 0,
      verifiedActionCount: 1,
      silentSupplyChangeDetection: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(run.result.metadata.evidenceIds).toHaveLength(4);
    expect(request.writeEvidence).toHaveBeenCalledOnce();
    expect(vi.mocked(request.writeEvidence).mock.calls[0]?.[0].observedAt).toBe(
      run.result.metadata.snapshot?.capturedAt,
    );
    expect(request.discoverSegment).toHaveBeenCalledWith(
      expect.objectContaining({ maxBlocksPerRequest: 2, maxRequests: 2 }),
    );
    const discoveryOptions = vi.mocked(request.discoverSegment).mock.calls[0]?.[0];
    expect(discoveryOptions?.now?.()).toBe(discoveryOptions?.snapshot.capturedAt);
    const certificateOptions = vi.mocked(request.certifyCandidate).mock.calls[0]?.[0];
    expect(certificateOptions?.now?.()).toBe(certificateOptions?.snapshot.capturedAt);

    const missingSnapshotSource = structuredClone(run.result);
    const firstSegment = missingSnapshotSource.segments[0];
    if (firstSegment === undefined) throw new Error('fixture segment vanished');
    firstSegment.sourceSet = [ERC20_BURN_PROMOTION_SOURCE];
    expect(() => EvmClaimBurnPromotionSchema.parse(missingSnapshotSource)).toThrow();
  });

  it('replays a completed checkpoint without touching providers', async () => {
    const checkpoints = new MemoryCheckpointStore();
    const transport = new BlockTransport();
    const request = options(checkpoints, transport);
    const first = await runErc20BurnPromotionRestartSafe(request);
    transport.calls.length = 0;
    vi.mocked(request.discoverSegment).mockClear();
    vi.mocked(request.certifyCandidate).mockClear();

    const replay = await runErc20BurnPromotionRestartSafe(request);

    expect(replay).toEqual(first);
    expect(transport.calls).toEqual([]);
    expect(request.discoverSegment).not.toHaveBeenCalled();
    expect(request.certifyCandidate).not.toHaveBeenCalled();
  });

  it('records a bounded failure and resumes at the first incomplete segment', async () => {
    const checkpoints = new MemoryCheckpointStore();
    const transport = new BlockTransport();
    let failSecond = true;
    const discoverSegment = vi.fn(async (input: { snapshot: EvmSnapshot; fromBlock: string }) => {
      if (input.fromBlock === '102' && failSecond) {
        failSecond = false;
        throw Object.assign(new Error('SQD fixture unavailable'), { code: 'NETWORK' });
      }
      return {
        report: discovery(input.snapshot, input.fromBlock, input.fromBlock === '100'),
        evidence: [],
      };
    });
    const request = options(checkpoints, transport, { discoverSegment });

    await expect(runErc20BurnPromotionRestartSafe(request)).rejects.toMatchObject({
      code: 'NETWORK',
    });
    expect(checkpoints.run?.nextBlock).toBe(102);
    expect(checkpoints.failures).toEqual(['NETWORK']);

    const resumed = await runErc20BurnPromotionRestartSafe(request);
    expect(resumed.result.segmentCount).toBe(2);
    expect(discoverSegment.mock.calls.map((call) => call[0].fromBlock)).toEqual([
      '100',
      '102',
      '102',
    ]);
  });

  it('rejects corrupted checkpoint state before executing a provider segment', async () => {
    const checkpoints = new MemoryCheckpointStore();
    const transport = new BlockTransport();
    const request = options(checkpoints, transport);
    await runErc20BurnPromotionRestartSafe(request);
    if (checkpoints.run === undefined) throw new Error('fixture checkpoint vanished');
    checkpoints.run = {
      ...checkpoints.run,
      state: { version: 'tampered', segments: [], snapshot: null, sourceSet: [], result: null },
    };
    vi.mocked(request.discoverSegment).mockClear();

    await expect(runErc20BurnPromotionRestartSafe(request)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(request.discoverSegment).not.toHaveBeenCalled();
  });
});
