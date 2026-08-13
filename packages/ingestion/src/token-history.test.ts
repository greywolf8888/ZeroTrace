import { describe, expect, it } from 'vitest';

import type {
  EvmTransactionReceiptRecord,
  EvmTransactionRecord,
  SqdDatasetMetadata,
  SqdFinalizedBlock,
  SqdFinalizedRangeRequest,
  SqdStreamSummary,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import type { RawChainFact } from '@zerotrace/schemas';
import type { IngestionRun } from '@zerotrace/storage';

import {
  TokenHistoryDiscovery,
  tokenHistoryDiscoveryRequest,
  type TokenHistoryExactReader,
  type IngestionCheckpointWriter,
  type RawArtifactWriter,
  type RawFactWriter,
  type SqdFinalizedSource,
} from './index.js';

const token = `0x${'a'.repeat(40)}`;
const transactionHash = `0x${'b'.repeat(64)}`;
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const fromTopic = `0x${'0'.repeat(24)}${'1'.repeat(40)}`;
const toTopic = `0x${'0'.repeat(24)}${'2'.repeat(40)}`;

const blocks: SqdFinalizedBlock[] = [
  {
    header: {
      number: 0,
      hash: `0x${'c'.repeat(64)}`,
      parentHash: `0x${'0'.repeat(64)}`,
      timestamp: 1_700_000_000,
    },
  },
  {
    header: {
      number: 1,
      hash: `0x${'d'.repeat(64)}`,
      parentHash: `0x${'c'.repeat(64)}`,
      timestamp: 1_700_000_001,
    },
    logs: [
      {
        logIndex: 0,
        transactionIndex: 0,
        transactionHash,
        address: token,
        topics: [transferTopic, fromTopic, toTopic],
        data: `0x${'0'.repeat(63)}1`,
      },
    ],
  },
];

class FakeSource implements SqdFinalizedSource {
  readonly dataset = 'ethereum-mainnet' as const;
  readonly ledger = 'EVM' as const;
  readonly chainId = '1';

  async metadata(): Promise<SqdDatasetMetadata> {
    return {
      dataset: this.dataset,
      aliases: [],
      realTime: true,
      startBlock: 0,
    };
  }

  async readFinalizedRange(
    request: SqdFinalizedRangeRequest,
    onBlock: (block: SqdFinalizedBlock) => void | Promise<void>,
  ): Promise<SqdStreamSummary> {
    const selected = blocks.filter(
      (block) => block.header.number >= request.fromBlock && block.header.number <= request.toBlock,
    );
    for (const block of selected) await onBlock(block);
    return {
      dataset: this.dataset,
      completion: 'REQUESTED_RANGE_COMPLETE',
      requestedFrom: request.fromBlock,
      requestedTo: request.toBlock,
      lastBlock: selected.at(-1)?.header.number ?? null,
      nextBlock: request.toBlock + 1,
      finalizedHead: request.toBlock,
      blocks: selected.length,
      requests: 1,
      retries: 0,
    };
  }
}

class FakeCheckpoints implements IngestionCheckpointWriter {
  run: IngestionRun | undefined;

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
      startedAt: input.startedAt ?? '2026-08-14T00:00:00.000Z',
      updatedAt: input.startedAt ?? '2026-08-14T00:00:00.000Z',
      completedAt: null,
    };
    return this.run;
  }

  async advance(_id: string, block: number): Promise<IngestionRun> {
    if (this.run === undefined) throw new Error('checkpoint run missing');
    this.run = { ...this.run, nextBlock: block + 1, lastBlock: block };
    return this.run;
  }

  async finish(
    _id: string,
    status: 'REQUESTED_RANGE_COMPLETE' | 'SOURCE_HEAD_REACHED',
    nextBlock: number,
  ): Promise<IngestionRun> {
    if (this.run === undefined) throw new Error('checkpoint run missing');
    this.run = { ...this.run, status, nextBlock, completedAt: '2026-08-14T00:01:00.000Z' };
    return this.run;
  }

  async recordFailure(_id: string, errorCode: string): Promise<IngestionRun> {
    if (this.run === undefined) throw new Error('checkpoint run missing');
    this.run = { ...this.run, lastErrorCode: errorCode };
    return this.run;
  }
}

class FakeReportStore {
  report: Awaited<ReturnType<TokenHistoryDiscovery['run']>>['report'] | undefined;

  async put(report: Awaited<ReturnType<TokenHistoryDiscovery['run']>>['report']) {
    this.report ??= report;
    if (this.report.resultHash !== report.resultHash) throw new Error('report conflict');
    return this.report;
  }

  async get() {
    return this.report;
  }
}

function stores() {
  const ledger = new EvidenceLedger();
  const facts: RawChainFact[] = [];
  const artifacts: RawArtifactWriter = {
    async put(input) {
      const artifactHash = hashPayload({ schema: 'test-artifact', ...input });
      return {
        ref: `s3://zerotrace-raw/test/${input.blockOrSlot}.json#sha256=${artifactHash}`,
        bucket: 'zerotrace-raw',
        key: `test/${input.blockOrSlot}.json`,
        artifactHash,
        payloadHash: hashPayload(input.payload),
        size: 1_024,
        created: true,
      };
    },
  };
  const evidence = {
    async put(
      item: Parameters<typeof ledger.add>[0],
      sources: readonly string[] = [],
      snapshot?: Parameters<typeof ledger.add>[2],
    ) {
      return ledger.add(item, sources, snapshot);
    },
  };
  const factWriter: RawFactWriter = {
    async put(fact) {
      facts.push(fact);
      return fact;
    },
  };
  return { artifacts, evidence, factWriter, facts };
}

describe('TokenHistoryDiscovery', () => {
  it('builds finalized Transfer observations and preserves unconfigured exact RPC state', async () => {
    const request = tokenHistoryDiscoveryRequest({ token, fromBlock: 0, toBlock: 1 });
    expect(request).toMatchObject({
      includeAllBlocks: true,
      requests: { logs: [{ address: [token], topic0: [transferTopic] }] },
    });

    const checkpoint = new FakeCheckpoints();
    const storage = stores();
    const result = await new TokenHistoryDiscovery({
      source: new FakeSource(),
      token,
      fromBlock: 0,
      toBlock: 1,
      checkpoints: checkpoint,
      artifacts: storage.artifacts,
      evidence: storage.evidence,
      facts: storage.factWriter,
    }).run();

    expect(result.report).toMatchObject({
      chainId: 'eip155:1',
      status: 'COMPLETE',
      observations: [
        {
          token,
          transactionHash,
          from: `0x${'1'.repeat(40)}`,
          to: `0x${'2'.repeat(40)}`,
          amountRaw: '1',
          kind: 'TRANSFER',
          application: 'UNKNOWN',
          actionSemanticsIds: [],
          snapshot: { chainId: 'eip155:1', blockNumber: '1' },
        },
      ],
      actionSemanticsBindings: [
        {
          transactionHash,
          status: 'UNKNOWN',
          reason: 'EXACT_RPC_PROVIDER_UNCONFIGURED',
        },
      ],
      origin: { state: 'unknown', reason: 'NOT_QUERIED' },
      snapshot: { chainId: 'eip155:1', blockNumber: '1' },
    });
    expect(result.report.evidenceIds.length).toBeGreaterThan(0);
    expect(result.report.providerCapabilityDeclarations).toEqual([
      {
        id: 'exact-rpc:eip155:1',
        ledger: 'EVM',
        chainId: 'eip155:1',
        capabilities: ['BLOCK', 'RECEIPT', 'TRANSACTION'],
        configured: false,
        version: 'token-history-exact-rpc-v1.0.0',
      },
      {
        id: 'sqd:ethereum-mainnet',
        ledger: 'EVM',
        chainId: 'eip155:1',
        capabilities: ['BLOCK', 'LOG', 'TRACE', 'TRANSACTION'],
        configured: true,
        version: 'sqd-finalized-ingestion-v4',
      },
    ]);
    expect(storage.facts.filter((fact) => fact.factType === 'LOG')).toHaveLength(1);
  });

  it('binds a relevant transaction to exact RPC receipt Evidence and Action Semantics', async () => {
    const storage = stores();
    const transaction: EvmTransactionRecord = {
      hash: transactionHash,
      blockHash: blocks[1]!.header.hash,
      blockNumber: '0x1',
      transactionIndex: '0x0',
      from: `0x${'3'.repeat(40)}`,
      to: token,
      value: '0x0',
      nonce: '0x1',
      gas: '0x5208',
      input: '0x',
      raw: {
        hash: transactionHash,
        blockHash: blocks[1]!.header.hash,
        blockNumber: '0x1',
        transactionIndex: '0x0',
        from: `0x${'3'.repeat(40)}`,
        to: token,
        value: '0x0',
        nonce: '0x1',
        gas: '0x5208',
        input: '0x',
      },
    };
    const receipt: EvmTransactionReceiptRecord = {
      transactionHash,
      blockHash: blocks[1]!.header.hash,
      blockNumber: '0x1',
      transactionIndex: '0x0',
      from: transaction.from,
      to: transaction.to,
      contractAddress: null,
      cumulativeGasUsed: '0x5208',
      gasUsed: '0x5208',
      status: '0x1',
      logCount: 1,
      raw: {
        transactionHash,
        blockHash: blocks[1]!.header.hash,
        blockNumber: '0x1',
        transactionIndex: '0x0',
        from: transaction.from,
        to: transaction.to,
        contractAddress: null,
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        status: '0x1',
        logs: [],
      },
    };
    const exactReader: TokenHistoryExactReader = {
      sourceId: 'bsc-rpc@test',
      async getTransactionObservation() {
        return { endpointId: 'bsc-rpc@test', value: transaction };
      },
      async getTransactionReceiptObservation() {
        return { endpointId: 'bsc-rpc@test', value: receipt };
      },
    };
    const actionReports: unknown[] = [];
    const result = await new TokenHistoryDiscovery({
      source: new FakeSource(),
      token,
      fromBlock: 0,
      toBlock: 1,
      checkpoints: new FakeCheckpoints(),
      artifacts: storage.artifacts,
      evidence: storage.evidence,
      facts: storage.factWriter,
      exactReader,
      actionSemantics: { put: async (report) => void actionReports.push(report) },
    }).run();

    expect(result.report.observations[0]).toMatchObject({
      application: 'SUCCESS',
      actionSemanticsIds: [expect.stringMatching(/^asr_[0-9a-f]{24}$/)],
    });
    expect(result.report.actionSemanticsBindings[0]).toMatchObject({ status: 'BOUND' });
    expect(actionReports).toHaveLength(1);
    expect(result.report.sourceSet).toContain('bsc-rpc@test');
  });

  it('replays a terminal run from the durable report with the same result hash', async () => {
    const checkpoint = new FakeCheckpoints();
    const storage = stores();
    const reportStore = new FakeReportStore();
    const options = {
      source: new FakeSource(),
      token,
      fromBlock: 0,
      toBlock: 1,
      checkpoints: checkpoint,
      artifacts: storage.artifacts,
      evidence: storage.evidence,
      facts: storage.factWriter,
      reportStore,
    };

    const first = await new TokenHistoryDiscovery(options).run();
    const replay = await new TokenHistoryDiscovery(options).run();

    expect(first.report.resultHash).toBe(replay.report.resultHash);
    expect(replay.ingestion.alreadyTerminal).toBe(true);
    expect(replay.report.observations).toEqual(first.report.observations);
  });
});
