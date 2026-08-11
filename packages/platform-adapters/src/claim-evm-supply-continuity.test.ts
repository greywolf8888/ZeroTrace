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
  EvmClaimBurnConservationSchema,
  type Evidence,
  type JsonValue,
} from '@zerotrace/schemas';

import {
  ERC20_SUPPLY_CONTINUITY_CHECKPOINT_VERSION,
  ERC20_SUPPLY_CONTINUITY_SOURCE,
  replayErc20SupplyContinuityResult,
  scanErc20SupplyContinuityRestartSafe,
  type Erc20SupplyContinuityCheckpointRun,
  type Erc20SupplyContinuityCheckpointStore,
  type Erc20SupplyContinuityReplayRun,
} from './index.js';

const token = `0x${'a'.repeat(40)}`;
const actor = `0x${'b'.repeat(40)}`;
const zeroAddress = `0x${'0'.repeat(40)}`;
const sqdSource = 'sqd:binance-mainnet';
const scanId = '55555555-5555-4555-8555-555555555555';

function blockHash(block: number): `0x${string}` {
  return `0x${block.toString(16).padStart(64, '0')}`;
}

function uint256(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function evidenceId(value: number): string {
  return `ev_${value.toString(16).padStart(24, '0')}`;
}

class SupplyTransport implements JsonRpcTransport {
  readonly calls: Array<{ method: string; params: readonly unknown[] }> = [];

  constructor(
    readonly endpointId: string,
    readonly supplyAt: (block: number) => bigint,
  ) {}

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    this.calls.push({ method, params });
    if (method === 'eth_getBlockByNumber') {
      const tag = params[0];
      if (typeof tag !== 'string' || !/^0x[0-9a-f]+$/i.test(tag)) {
        throw new Error('invalid fixture block');
      }
      const block = Number(BigInt(tag));
      return {
        number: tag,
        hash: blockHash(block),
        parentHash: blockHash(block - 1),
        timestamp: `0x${(1_700_000_000 + block).toString(16)}`,
      } as T;
    }
    if (method === 'eth_call') {
      const selector = params[1];
      if (
        typeof selector !== 'object' ||
        selector === null ||
        Array.isArray(selector) ||
        !('blockHash' in selector) ||
        typeof selector.blockHash !== 'string'
      ) {
        throw new Error('fixture requires EIP-1898 block hash');
      }
      const block = Number(BigInt(selector.blockHash));
      return uint256(this.supplyAt(block)) as T;
    }
    throw new Error(`unexpected fixture method ${method}`);
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    return { value: await this.request<T>(method, params), endpointId: this.endpointId };
  }
}

class MemoryCheckpointStore implements Erc20SupplyContinuityCheckpointStore {
  run: Erc20SupplyContinuityCheckpointRun | undefined;
  readonly advances: number[] = [];
  readonly failures: string[] = [];

  async begin(input: {
    fromBlock: number;
    initialState: JsonValue;
  }): Promise<Erc20SupplyContinuityCheckpointRun> {
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
  ): Promise<Erc20SupplyContinuityCheckpointRun> {
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
  ): Promise<Erc20SupplyContinuityCheckpointRun> {
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

  async recordFailure(id: string, errorCode: string): Promise<Erc20SupplyContinuityCheckpointRun> {
    if (this.run?.id !== id) throw new Error('missing fixture checkpoint');
    this.failures.push(errorCode);
    return this.run;
  }
}

function adapter(transport: SupplyTransport): EvmLedgerAdapter {
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

function certificate(snapshot: EvmSnapshot, before: string, after: string) {
  const block = Number(snapshot.blockNumber);
  const burned = (BigInt(before) - BigInt(after)).toString();
  const sourceEvidenceId = evidenceId(2_000 + block);
  const terminalEvidenceId = evidenceId(3_000 + block);
  return EvmClaimBurnConservationSchema.parse({
    tokenAddress: token,
    blockNumber: snapshot.blockNumber,
    blockHash: snapshot.blockHash,
    parentBlockNumber: String(block - 1),
    parentBlockHash: snapshot.parentBlockHash,
    totalSupplyBefore: before,
    totalSupplyAfter: after,
    mintedAmount: '0',
    burnedAmount: burned,
    supplyDelta: (BigInt(after) - BigInt(before)).toString(),
    eventNetSupplyDelta: (-BigInt(burned)).toString(),
    expectedSupplyAfter: after,
    status: 'VERIFIED',
    candidateBurnTransferIds: [`transfer:${block}`],
    actions: [
      {
        id: `action:${block}`,
        type: 'BURN',
        actor,
        amount: burned,
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
      sourceSet: [
        'bsc-rpc@bnb-mainnet.g.alchemy.com#1',
        'bsc-rpc@bsc-dataseed.bnbchain.org#2',
        sqdSource,
      ].sort(),
      modelVersion: 'erc20-burn-conservation-v1.0.0',
      confidence: 0.98,
      evidenceIds: [sourceEvidenceId, terminalEvidenceId],
    }),
  });
}

function setup(
  sourceIds = ['bsc-rpc@bnb-mainnet.g.alchemy.com#1', 'bsc-rpc@bsc-dataseed.bnbchain.org#2'],
) {
  const supply = (block: number) => (block < 101 ? 1_000n : 990n);
  const transports = sourceIds.map((sourceId) => new SupplyTransport(sourceId, supply));
  const checkpoints = new MemoryCheckpointStore();
  const evidence: Evidence[] = [];
  const writeEvidence = vi.fn(async (node: Evidence) => {
    evidence.push(node);
    return node;
  });
  const certifyChange = vi.fn(async (input: { snapshot: EvmSnapshot }) => ({
    report: certificate(input.snapshot, '1000', '990'),
    evidence: [],
  }));
  return { transports, checkpoints, evidence, writeEvidence, certifyChange };
}

function options(fixture: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) {
  return {
    adapters: fixture.transports.map(adapter),
    logReader: { endpointId: sqdSource } as never,
    tokenAddress: token,
    fromBlock: '100',
    toBlock: '102',
    segmentSize: 2,
    checkpoints: fixture.checkpoints,
    writeEvidence: fixture.writeEvidence,
    certifyChange: fixture.certifyChange,
    ...overrides,
  };
}

describe('restart-safe ERC-20 supply continuity', () => {
  it('replays an unstarted durable checkpoint as progress without provider access', () => {
    expect(
      replayErc20SupplyContinuityResult({
        id: 'scan-running',
        status: 'RUNNING',
        nextBlock: 100,
        state: {
          version: ERC20_SUPPLY_CONTINUITY_CHECKPOINT_VERSION,
          segments: [],
          snapshot: null,
          sourceSet: [],
          result: null,
        },
        evidenceIds: [],
        scanType: 'ERC20_SUPPLY_CONTINUITY',
        source: ERC20_SUPPLY_CONTINUITY_SOURCE,
        ledger: 'EVM',
        chainId: 'eip155:56',
        subject: token,
        fromBlock: 100,
        toBlock: 102,
        chunkSize: 2,
      }),
    ).toBeNull();
  });

  it('samples every transition, reconciles a burn change, and verifies operator independence', async () => {
    const fixture = setup();
    const run = await scanErc20SupplyContinuityRestartSafe(options(fixture));

    expect(run.result).toMatchObject({
      status: 'VERIFIED_EVENT_CONSERVED_CHANGES',
      scannedBlockCount: 3,
      supplySampleCount: 4,
      initialTotalSupply: '1000',
      finalTotalSupply: '990',
      netSupplyDelta: '-10',
      supplyChangeCount: 1,
      eventConservedChangeCount: 1,
      unexplainedChangeCount: 0,
      sourceIndependence: { status: 'VERIFIED_INDEPENDENT' },
      metadata: { dataCoverage: 1, sourceCoverage: 1, historyCoverage: 1, confidence: 1 },
    });
    expect(fixture.checkpoints.advances).toEqual([102, 103]);
    expect(fixture.certifyChange).toHaveBeenCalledTimes(1);
    expect(
      fixture.transports.every((transport) =>
        transport.calls
          .filter((call) => call.method === 'eth_call')
          .every(
            (call) =>
              typeof call.params[1] === 'object' &&
              call.params[1] !== null &&
              (call.params[1] as { requireCanonical?: unknown }).requireCanonical === true,
          ),
      ),
    ).toBe(true);
    expect(fixture.evidence.some((item) => item.kind === 'OFFICIAL_DOCUMENT')).toBe(true);

    const callsBeforeReplay = fixture.transports.map((transport) => transport.calls.length);
    await expect(scanErc20SupplyContinuityRestartSafe(options(fixture))).resolves.toEqual(run);
    expect(fixture.transports.map((transport) => transport.calls.length)).toEqual(
      callsBeforeReplay,
    );
    expect(
      replayErc20SupplyContinuityResult({
        ...(fixture.checkpoints.run as Erc20SupplyContinuityCheckpointRun),
        scanType: 'ERC20_SUPPLY_CONTINUITY',
        source: ERC20_SUPPLY_CONTINUITY_SOURCE,
        ledger: 'EVM',
        chainId: 'eip155:56',
        subject: token,
        fromBlock: 100,
        toBlock: 102,
        chunkSize: 2,
      } as Erc20SupplyContinuityReplayRun),
    ).toEqual(run.result);
  });

  it('keeps two endpoints from the same operator inconclusive', async () => {
    const fixture = setup([
      'bsc-rpc@bsc-dataseed.bnbchain.org#1',
      'bsc-rpc@bsc-dataseed-public.bnbchain.org#2',
    ]);
    const run = await scanErc20SupplyContinuityRestartSafe(options(fixture));

    expect(run.result.status).toBe('INCONCLUSIVE_SOURCE_INDEPENDENCE');
    expect(run.result.sourceIndependence.status).toBe('SAME_OPERATOR');
    expect(run.result.metadata).toMatchObject({ sourceCoverage: 0.5, confidence: 0.5 });
  });

  it('fails closed before checkpoint advancement when exact source state disagrees', async () => {
    const fixture = setup();
    fixture.transports[1] = new SupplyTransport('bsc-rpc@bsc-dataseed.bnbchain.org#2', (block) =>
      block === 100 ? 999n : block < 101 ? 1_000n : 990n,
    );

    await expect(scanErc20SupplyContinuityRestartSafe(options(fixture))).rejects.toThrow(
      'source conflict at block 100',
    );
    expect(fixture.checkpoints.advances).toEqual([]);
    expect(fixture.checkpoints.failures).toEqual(['INVALID_RESPONSE']);
    expect(
      fixture.evidence.some((item) => item.locator.startsWith('erc20-supply-source-conflict:')),
    ).toBe(true);
  });
});
