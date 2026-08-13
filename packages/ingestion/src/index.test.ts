import { describe, expect, it, vi } from 'vitest';

import type {
  SqdDataset,
  SqdDatasetMetadata,
  SqdFinalizedBlock,
  SqdFinalizedRangeRequest,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import type { Ledger, RawChainFact } from '@zerotrace/schemas';
import type { IngestionRun } from '@zerotrace/storage';

import {
  createSqdProfileRequest,
  IngestionPipelineError,
  SqdFinalizedIngestionPipeline,
  sqdIngestionQuery,
  type EvidenceWriter,
  type IngestionCheckpointWriter,
  type RawArtifactWriter,
  type RawFactWriter,
  type SqdFinalizedSource,
} from './index.js';

const evmBlocks: SqdFinalizedBlock[] = [
  {
    header: {
      number: 0,
      hash: '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
      parentHash: `0x${'0'.repeat(64)}`,
      timestamp: 0,
    },
  },
  {
    header: {
      number: 1,
      hash: `0x${'1'.repeat(64)}`,
      parentHash: '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
      timestamp: 1_438_269_988,
    },
  },
];

class FakeSource implements SqdFinalizedSource {
  readonly metadata = vi.fn<() => Promise<SqdDatasetMetadata>>(async () => ({
    dataset: this.dataset,
    aliases: [],
    realTime: true,
    startBlock: 0,
  }));
  readonly readFinalizedRange = vi.fn(
    async (
      request: SqdFinalizedRangeRequest,
      onBlock: (block: SqdFinalizedBlock) => void | Promise<void>,
    ) => {
      const selected = this.blocks.filter(
        (block) =>
          block.header.number >= request.fromBlock && block.header.number <= request.toBlock,
      );
      for (const block of selected) await onBlock(block);
      const lastBlock = selected.at(-1)?.header.number ?? null;
      return {
        dataset: this.dataset,
        completion: 'REQUESTED_RANGE_COMPLETE' as const,
        requestedFrom: request.fromBlock,
        requestedTo: request.toBlock,
        lastBlock,
        nextBlock: request.toBlock + 1,
        finalizedHead: request.toBlock + 100,
        blocks: selected.length,
        requests: 1,
        retries: 0,
      };
    },
  );

  constructor(
    readonly dataset: SqdDataset,
    readonly ledger: Ledger,
    readonly chainId: string,
    readonly blocks: readonly SqdFinalizedBlock[],
  ) {}
}

class FakeCheckpoints implements IngestionCheckpointWriter {
  run: IngestionRun | undefined;
  readonly failures: string[] = [];

  constructor(
    readonly events: string[],
    initial?: IngestionRun,
  ) {
    this.run = initial;
  }

  async begin(input: Parameters<IngestionCheckpointWriter['begin']>[0]): Promise<IngestionRun> {
    this.run ??= {
      id: '00000000-0000-4000-8000-000000000001',
      source: input.source,
      dataset: input.dataset,
      ledger: input.ledger,
      chainId: input.chainId,
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
      queryHash: hashPayload(input.query),
      query: input.query,
      status: 'RUNNING',
      nextBlock: input.fromBlock,
      lastBlock: null,
      lastErrorCode: null,
      startedAt: input.startedAt ?? '2026-08-09T13:00:00.000Z',
      updatedAt: input.startedAt ?? '2026-08-09T13:00:00.000Z',
      completedAt: null,
    };
    return this.run;
  }

  async advance(_id: string, block: number): Promise<IngestionRun> {
    this.events.push(`checkpoint:${block}`);
    this.run = {
      ...this.requireRun(),
      nextBlock: block + 1,
      lastBlock: block,
      lastErrorCode: null,
    };
    return this.run;
  }

  async finish(
    _id: string,
    status: 'REQUESTED_RANGE_COMPLETE' | 'SOURCE_HEAD_REACHED',
    nextBlock: number,
  ): Promise<IngestionRun> {
    this.events.push(`finish:${status}`);
    this.run = {
      ...this.requireRun(),
      status,
      nextBlock,
      completedAt: '2026-08-09T13:01:00.000Z',
    };
    return this.run;
  }

  async recordFailure(_id: string, errorCode: string): Promise<IngestionRun> {
    this.failures.push(errorCode);
    this.run = { ...this.requireRun(), lastErrorCode: errorCode };
    return this.run;
  }

  private requireRun(): IngestionRun {
    if (this.run === undefined) throw new Error('run missing');
    return this.run;
  }
}

function createStores(events: string[]) {
  const ledger = new EvidenceLedger();
  const facts: RawChainFact[] = [];
  const artifacts: RawArtifactWriter = {
    put: vi.fn(async (input) => {
      events.push(`artifact:${input.blockOrSlot}`);
      const artifactHash = hashPayload({ schema: 'artifact-test', ...input });
      return {
        ref: `s3://zerotrace-raw/v1/item-${input.blockOrSlot}.json#sha256=${artifactHash}`,
        bucket: 'zerotrace-raw',
        key: `v1/item-${input.blockOrSlot}.json`,
        artifactHash,
        payloadHash: hashPayload(input.payload),
        size: 1,
        created: true,
      };
    }),
  };
  const evidence: EvidenceWriter = {
    put: vi.fn(async (item, sources = [], snapshot) => {
      events.push(`evidence:${item.blockOrSlot}`);
      return ledger.add(item, sources, snapshot);
    }),
  };
  const factWriter: RawFactWriter = {
    put: vi.fn(async (fact) => {
      events.push(`fact:${fact.blockOrSlot}`);
      facts.push(fact);
      return fact;
    }),
  };
  return { artifacts, evidence, factWriter, ledger, facts };
}

function terminalRun(): IngestionRun {
  const request = { fromBlock: 0, toBlock: 1 };
  const query = sqdIngestionQuery('ethereum-mainnet', request);
  return {
    id: '00000000-0000-4000-8000-000000000001',
    source: 'sqd:ethereum-mainnet',
    dataset: 'ethereum-mainnet',
    ledger: 'EVM',
    chainId: '1',
    fromBlock: 0,
    toBlock: 1,
    queryHash: hashPayload(query),
    query,
    status: 'REQUESTED_RANGE_COMPLETE',
    nextBlock: 2,
    lastBlock: 1,
    lastErrorCode: null,
    startedAt: '2026-08-09T13:00:00.000Z',
    updatedAt: '2026-08-09T13:01:00.000Z',
    completedAt: '2026-08-09T13:01:00.000Z',
  };
}

describe('SqdFinalizedIngestionPipeline', () => {
  it('writes artifact, Evidence, Raw Fact, then checkpoint for each finalized block', async () => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events);
    const stores = createStores(events);
    const source = new FakeSource('ethereum-mainnet', 'EVM', '1', evmBlocks);
    const pipeline = new SqdFinalizedIngestionPipeline({
      source,
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
      nowImplementation: () => new Date('2026-08-09T13:00:00.000Z'),
    });

    const result = await pipeline.run({ fromBlock: 0, toBlock: 1 });

    expect(events).toEqual([
      'artifact:0',
      'evidence:0',
      'fact:0',
      'checkpoint:0',
      'artifact:1',
      'evidence:1',
      'fact:1',
      'checkpoint:1',
      'finish:REQUESTED_RANGE_COMPLETE',
    ]);
    expect(result).toMatchObject({
      processedBlocks: 2,
      recordCoverage: {
        transactions: { state: 'NOT_QUERIED', processed: null },
        logs: { state: 'NOT_QUERIED', processed: null },
        inputs: { state: 'NOT_APPLICABLE', processed: null },
        outputs: { state: 'NOT_APPLICABLE', processed: null },
        instructions: { state: 'NOT_APPLICABLE', processed: null },
        traces: { state: 'NOT_QUERIED', processed: null },
        stateDiffs: { state: 'NOT_QUERIED', processed: null },
        balances: { state: 'NOT_APPLICABLE', processed: null },
        tokenBalances: { state: 'NOT_APPLICABLE', processed: null },
        rewards: { state: 'NOT_APPLICABLE', processed: null },
      },
      transactionCoverage: 'NOT_QUERIED',
      processedTransactions: null,
      resumedFrom: 0,
      alreadyTerminal: false,
      run: { status: 'REQUESTED_RANGE_COMPLETE', nextBlock: 2 },
    });
    expect(stores.facts).toHaveLength(2);
    expect(stores.ledger.values()).toHaveLength(2);
    expect(stores.ledger.values()[0]?.snapshot).toMatchObject({
      ledger: 'EVM',
      blockNumber: '0',
      finality: 'finalized',
      blockTimestamp: '1970-01-01T00:00:00.000Z',
    });
  });

  it('runs the pre-finish callback before terminal checkpoint advancement', async () => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events);
    const stores = createStores(events);
    const pipeline = new SqdFinalizedIngestionPipeline({
      source: new FakeSource('ethereum-mainnet', 'EVM', '1', evmBlocks),
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
      onBeforeFinish: async ({ run, sourceSummary }) => {
        events.push(`before-finish:${run.status}:${sourceSummary.nextBlock}`);
      },
    });

    await pipeline.run({ fromBlock: 0, toBlock: 1 });

    expect(events.at(-2)).toBe('before-finish:RUNNING:2');
    expect(events.at(-1)).toBe('finish:REQUESTED_RANGE_COMPLETE');
  });

  it('keeps unqueried Solana tables distinct from records that do not apply', async () => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events);
    const stores = createStores(events);
    const slot = 105_368;
    const pipeline = new SqdFinalizedIngestionPipeline({
      source: new FakeSource('solana-mainnet', 'SOLANA', 'solana-mainnet', [
        {
          header: {
            number: slot,
            hash: '1'.repeat(44),
            parentHash: '2'.repeat(44),
            timestamp: 1_234_567_890,
          },
        },
      ]),
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
    });

    await expect(pipeline.run({ fromBlock: slot, toBlock: slot })).resolves.toMatchObject({
      recordCoverage: {
        transactions: { state: 'NOT_QUERIED', processed: null },
        logs: { state: 'NOT_QUERIED', processed: null },
        inputs: { state: 'NOT_APPLICABLE', processed: null },
        outputs: { state: 'NOT_APPLICABLE', processed: null },
        instructions: { state: 'NOT_QUERIED', processed: null },
        traces: { state: 'NOT_APPLICABLE', processed: null },
        stateDiffs: { state: 'NOT_APPLICABLE', processed: null },
        balances: { state: 'NOT_QUERIED', processed: null },
        tokenBalances: { state: 'NOT_QUERIED', processed: null },
        rewards: { state: 'NOT_QUERIED', processed: null },
      },
    });
  });

  it('materializes strict transaction Evidence and Raw Facts before advancing the block cursor', async () => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events);
    const stores = createStores(events);
    const transactions = [
      { hash: `0x${'a'.repeat(64)}`, from: `0x${'1'.repeat(40)}`, value: '1' },
      { hash: `0x${'b'.repeat(64)}`, from: `0x${'2'.repeat(40)}`, value: '2' },
    ];
    const source = new FakeSource('ethereum-mainnet', 'EVM', '1', [
      { ...evmBlocks[0]!, transactions },
    ]);
    const pipeline = new SqdFinalizedIngestionPipeline({
      source,
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
      nowImplementation: () => new Date('2026-08-09T13:00:00.000Z'),
    });
    const request = createSqdProfileRequest({
      dataset: 'ethereum-mainnet',
      profile: 'transactions',
      fromBlock: 0,
      toBlock: 0,
    });

    const result = await pipeline.run(request);

    expect(events).toEqual([
      'artifact:0',
      'evidence:0',
      'fact:0',
      'evidence:0',
      'fact:0',
      'evidence:0',
      'fact:0',
      'checkpoint:0',
      'finish:REQUESTED_RANGE_COMPLETE',
    ]);
    expect(result).toMatchObject({
      processedBlocks: 1,
      transactionCoverage: 'MATERIALIZED',
      processedTransactions: 2,
    });
    expect(stores.facts.map((fact) => [fact.factType, fact.subject])).toEqual([
      ['BLOCK', evmBlocks[0]!.header.hash],
      ['TRANSACTION', transactions[0]!.hash],
      ['TRANSACTION', transactions[1]!.hash],
    ]);
    expect(stores.ledger.values().map((node) => node.evidence.kind)).toEqual([
      'BLOCK',
      'TRANSACTION',
      'TRANSACTION',
    ]);
    expect(checkpoints.run?.query).toMatchObject({
      materialize: { blocks: true, transactions: true },
    });
  });

  it('materializes ledger-specific records before the checkpoint with explicit applicability', async () => {
    const runFixture = async (input: {
      dataset: SqdDataset;
      ledger: Ledger;
      chainId: string;
      block: SqdFinalizedBlock;
    }) => {
      const events: string[] = [];
      const checkpoints = new FakeCheckpoints(events);
      const stores = createStores(events);
      const pipeline = new SqdFinalizedIngestionPipeline({
        source: new FakeSource(input.dataset, input.ledger, input.chainId, [input.block]),
        checkpoints,
        artifacts: stores.artifacts,
        evidence: stores.evidence,
        facts: stores.factWriter,
        nowImplementation: () => new Date('2026-08-09T13:00:00.000Z'),
      });
      const result = await pipeline.run(
        createSqdProfileRequest({
          dataset: input.dataset,
          profile: 'ledger-records',
          fromBlock: input.block.header.number,
          toBlock: input.block.header.number,
        }),
      );
      expect(events.at(-2)).toBe(`checkpoint:${input.block.header.number}`);
      expect(events.at(-1)).toBe('finish:REQUESTED_RANGE_COMPLETE');
      return { result, facts: stores.facts, ledger: stores.ledger };
    };

    const evmTransaction = { hash: `0x${'a'.repeat(64)}` };
    const evm = await runFixture({
      dataset: 'ethereum-mainnet',
      ledger: 'EVM',
      chainId: '1',
      block: {
        ...evmBlocks[0]!,
        transactions: [evmTransaction],
        logs: [
          {
            transactionHash: evmTransaction.hash,
            transactionIndex: 0,
            logIndex: 0,
            address: `0x${'1'.repeat(40)}`,
            topics: [],
            data: '0x',
          },
        ],
        traces: [
          { transactionIndex: 0, traceAddress: [], type: 'call' },
          { transactionIndex: 0, traceAddress: [0], type: 'create' },
        ],
        stateDiffs: [
          {
            transactionIndex: 0,
            address: `0x${'1'.repeat(40)}`,
            key: 'balance',
            kind: '*',
            prev: '0x01',
            next: '0x02',
          },
        ],
      },
    });
    expect(evm.result.recordCoverage).toEqual({
      transactions: { state: 'MATERIALIZED', processed: 1 },
      logs: { state: 'MATERIALIZED', processed: 1 },
      inputs: { state: 'NOT_APPLICABLE', processed: null },
      outputs: { state: 'NOT_APPLICABLE', processed: null },
      instructions: { state: 'NOT_APPLICABLE', processed: null },
      traces: { state: 'MATERIALIZED', processed: 2 },
      stateDiffs: { state: 'MATERIALIZED', processed: 1 },
      balances: { state: 'NOT_APPLICABLE', processed: null },
      tokenBalances: { state: 'NOT_APPLICABLE', processed: null },
      rewards: { state: 'NOT_APPLICABLE', processed: null },
    });
    expect(evm.facts.map((fact) => fact.factType)).toEqual([
      'BLOCK',
      'TRANSACTION',
      'LOG',
      'TRACE',
      'TRACE',
      'STATE_DIFF',
    ]);

    const bitcoin = await runFixture({
      dataset: 'bitcoin-mainnet',
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      block: {
        header: {
          number: 170,
          hash: 'a'.repeat(64),
          parentHash: 'b'.repeat(64),
          timestamp: 1_234_567_890,
        },
        transactions: [{ transactionIndex: 0, txid: 'c'.repeat(64) }],
        inputs: [
          { transactionIndex: 0, inputIndex: 0, txid: null, vout: null },
          { transactionIndex: 1, inputIndex: 0, txid: 'd'.repeat(64), vout: 0 },
        ],
        outputs: [{ transactionIndex: 0, outputIndex: 0, value: 50 }],
      },
    });
    expect(bitcoin.result.recordCoverage).toMatchObject({
      transactions: { state: 'MATERIALIZED', processed: 1 },
      logs: { state: 'NOT_APPLICABLE', processed: null },
      inputs: { state: 'MATERIALIZED', processed: 2 },
      outputs: { state: 'MATERIALIZED', processed: 1 },
      instructions: { state: 'NOT_APPLICABLE', processed: null },
      traces: { state: 'NOT_APPLICABLE', processed: null },
      stateDiffs: { state: 'NOT_APPLICABLE', processed: null },
      balances: { state: 'NOT_APPLICABLE', processed: null },
      tokenBalances: { state: 'NOT_APPLICABLE', processed: null },
      rewards: { state: 'NOT_APPLICABLE', processed: null },
    });
    expect(bitcoin.facts.map((fact) => fact.factType)).toEqual([
      'BLOCK',
      'TRANSACTION',
      'UTXO_INPUT',
      'UTXO_INPUT',
      'UTXO_OUTPUT',
    ]);

    const solana = await runFixture({
      dataset: 'solana-mainnet',
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      block: {
        header: {
          number: 105_368,
          hash: '1'.repeat(44),
          parentHash: '2'.repeat(44),
          timestamp: 1_234_567_890,
        },
        transactions: [{ signatures: ['3'.repeat(88)] }],
        instructions: [
          { transactionIndex: 2, instructionAddress: [0], programId: '4'.repeat(44) },
          { transactionIndex: 2, instructionAddress: [0, 1], programId: '5'.repeat(44) },
        ],
        logs: [
          {
            transactionIndex: 2,
            logIndex: 0,
            instructionAddress: [0],
            programId: '4'.repeat(44),
            kind: 'log',
            message: 'Instruction: test',
          },
        ],
        balances: [{ transactionIndex: 2, account: '6'.repeat(44), pre: '2', post: '1' }],
        tokenBalances: [
          { transactionIndex: 2, account: '7'.repeat(44), preAmount: '1', postAmount: '2' },
        ],
        rewards: [{ pubkey: '8'.repeat(44), lamports: '3', postBalance: '4' }],
      },
    });
    expect(solana.result.recordCoverage).toMatchObject({
      transactions: { state: 'MATERIALIZED', processed: 1 },
      logs: { state: 'MATERIALIZED', processed: 1 },
      inputs: { state: 'NOT_APPLICABLE', processed: null },
      outputs: { state: 'NOT_APPLICABLE', processed: null },
      instructions: { state: 'MATERIALIZED', processed: 2 },
      traces: { state: 'NOT_APPLICABLE', processed: null },
      stateDiffs: { state: 'NOT_APPLICABLE', processed: null },
      balances: { state: 'MATERIALIZED', processed: 1 },
      tokenBalances: { state: 'MATERIALIZED', processed: 1 },
      rewards: { state: 'MATERIALIZED', processed: 1 },
    });
    expect(solana.facts.map((fact) => fact.factType)).toEqual([
      'BLOCK',
      'TRANSACTION',
      'LOG',
      'INSTRUCTION',
      'INSTRUCTION',
      'BALANCE',
      'TOKEN_BALANCE',
      'REWARD',
    ]);
    expect(solana.ledger.values().map((node) => node.evidence.kind)).toEqual([
      'BLOCK',
      'TRANSACTION',
      'LOG',
      'INSTRUCTION',
      'INSTRUCTION',
      'ACCOUNT_STATE',
      'ACCOUNT_STATE',
      'ACCOUNT_STATE',
    ]);
  });

  it('records provider-defined empty transaction coverage without inventing a count', async () => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events);
    const stores = createStores(events);
    const source = new FakeSource('ethereum-mainnet', 'EVM', '1', evmBlocks.slice(0, 1));
    const pipeline = new SqdFinalizedIngestionPipeline({
      source,
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
    });
    const request = createSqdProfileRequest({
      dataset: 'ethereum-mainnet',
      profile: 'transactions',
      fromBlock: 0,
      toBlock: 0,
    });

    await expect(pipeline.run(request)).resolves.toMatchObject({
      processedBlocks: 1,
      transactionCoverage: 'MATERIALIZED',
      processedTransactions: 0,
      run: { status: 'REQUESTED_RANGE_COMPLETE', nextBlock: 1 },
    });
    expect(events).toEqual([
      'artifact:0',
      'evidence:0',
      'fact:0',
      'checkpoint:0',
      'finish:REQUESTED_RANGE_COMPLETE',
    ]);
    expect(checkpoints.failures).toEqual([]);
  });

  it('resumes from the durable cursor and reuses the original observation time', async () => {
    const initial = {
      ...terminalRun(),
      status: 'RUNNING' as const,
      nextBlock: 1,
      completedAt: null,
    };
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events, initial);
    const stores = createStores(events);
    const source = new FakeSource('ethereum-mainnet', 'EVM', '1', evmBlocks);
    const pipeline = new SqdFinalizedIngestionPipeline({
      source,
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
      nowImplementation: () => new Date('2026-08-10T00:00:00.000Z'),
    });

    const result = await pipeline.run({ fromBlock: 0, toBlock: 1 });

    expect(source.readFinalizedRange.mock.calls[0]?.[0]).toMatchObject({
      fromBlock: 1,
      toBlock: 1,
    });
    expect(result).toMatchObject({ resumedFrom: 1, processedBlocks: 1 });
    expect(stores.ledger.values()[0]?.evidence.observedAt).toBe(initial.startedAt);
  });

  it('does not contact providers or rewrite storage for a terminal run', async () => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events, terminalRun());
    const stores = createStores(events);
    const source = new FakeSource('ethereum-mainnet', 'EVM', '1', evmBlocks);
    const pipeline = new SqdFinalizedIngestionPipeline({
      source,
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
    });

    const result = await pipeline.run({ fromBlock: 0, toBlock: 1 });

    expect(result).toMatchObject({ alreadyTerminal: true, processedBlocks: 0 });
    expect(source.metadata).not.toHaveBeenCalled();
    expect(source.readFinalizedRange).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it.each([
    {
      dataset: 'bitcoin-mainnet' as const,
      ledger: 'BITCOIN' as const,
      chainId: 'bitcoin-mainnet',
      block: {
        header: {
          number: 0,
          hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
          parentHash: '0'.repeat(64),
          timestamp: 1_231_006_505,
        },
      },
      expected: { ledger: 'BITCOIN', height: '0', finality: 'best-chain' },
    },
    {
      dataset: 'solana-mainnet' as const,
      ledger: 'SOLANA' as const,
      chainId: 'solana-mainnet',
      block: {
        header: {
          number: 0,
          hash: '4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn',
          parentHash: '4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn',
          timestamp: 1_584_368_940,
        },
      },
      expected: { ledger: 'SOLANA', slot: '0', commitment: 'finalized' },
    },
  ])('creates the ledger-specific finalized Snapshot for $ledger', async (fixture) => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events);
    const stores = createStores(events);
    const source = new FakeSource(fixture.dataset, fixture.ledger, fixture.chainId, [
      fixture.block,
    ]);
    const pipeline = new SqdFinalizedIngestionPipeline({
      source,
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
      nowImplementation: () => new Date('2026-08-09T13:00:00.000Z'),
    });

    await pipeline.run({ fromBlock: 0, toBlock: 0 });

    expect(stores.ledger.values()[0]?.snapshot).toMatchObject(fixture.expected);
  });

  it('fails closed on a malformed ledger record without advancing the checkpoint', async () => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events);
    const stores = createStores(events);
    const transactionHash = `0x${'a'.repeat(64)}`;
    const pipeline = new SqdFinalizedIngestionPipeline({
      source: new FakeSource('ethereum-mainnet', 'EVM', '1', [
        {
          ...evmBlocks[0]!,
          transactions: [{ hash: transactionHash }],
          traces: [{ transactionIndex: 0, traceAddress: [-1], type: 'call' }],
        },
      ]),
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
    });

    await expect(
      pipeline.run(
        createSqdProfileRequest({
          dataset: 'ethereum-mainnet',
          profile: 'ledger-records',
          fromBlock: 0,
          toBlock: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INGESTION_FAILED', retryable: false });
    expect(events).not.toContain('checkpoint:0');
    expect(checkpoints.failures).toEqual(['INVALID_RESPONSE']);
  });

  it('records a safe failure code and never advances before the Raw Fact is durable', async () => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events);
    const stores = createStores(events);
    const failure = Object.assign(new Error('ClickHouse secret-bearing upstream failure'), {
      code: 'CLICKHOUSE_UNAVAILABLE',
      retryable: true,
    });
    stores.factWriter.put = vi.fn(async () => {
      throw failure;
    });
    const pipeline = new SqdFinalizedIngestionPipeline({
      source: new FakeSource('ethereum-mainnet', 'EVM', '1', evmBlocks.slice(0, 1)),
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
      nowImplementation: () => new Date('2026-08-09T13:00:00.000Z'),
    });

    await expect(pipeline.run({ fromBlock: 0, toBlock: 0 })).rejects.toMatchObject({
      code: 'INGESTION_FAILED',
      retryable: true,
    });
    expect(events).toEqual(['artifact:0', 'evidence:0']);
    expect(checkpoints.failures).toEqual(['CLICKHOUSE_UNAVAILABLE']);
  });

  it('fails closed when source coverage is Unknown', async () => {
    const events: string[] = [];
    const checkpoints = new FakeCheckpoints(events);
    const stores = createStores(events);
    const source = new FakeSource('ethereum-mainnet', 'EVM', '1', evmBlocks);
    source.metadata.mockResolvedValueOnce({
      dataset: 'ethereum-mainnet',
      aliases: [],
      realTime: true,
      startBlock: null,
    });
    const pipeline = new SqdFinalizedIngestionPipeline({
      source,
      checkpoints,
      artifacts: stores.artifacts,
      evidence: stores.evidence,
      facts: stores.factWriter,
    });

    await expect(pipeline.run({ fromBlock: 0, toBlock: 0 })).rejects.toBeInstanceOf(
      IngestionPipelineError,
    );
    expect(source.readFinalizedRange).not.toHaveBeenCalled();
    expect(checkpoints.failures).toEqual(['INGESTION_SOURCE_COVERAGE_UNKNOWN']);
  });
});
