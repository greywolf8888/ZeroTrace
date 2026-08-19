import { describe, expect, it } from 'vitest';

import type {
  EvmTransactionReceiptRecord,
  EvmTransactionRecord,
  SqdDatasetMetadata,
  SqdFinalizedBlock,
  SqdFinalizedRangeRequest,
  SqdStreamSummary,
} from '@zerotrace/chain-adapters';
import { createEvidence, EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import type { AnalysisSnapshot, RawChainFact } from '@zerotrace/schemas';
import { createRawChainFact, type IngestionRun } from '@zerotrace/storage';

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
const unrelatedToken = `0x${'f'.repeat(40)}`;
const unrelatedTransactionHash = `0x${'9'.repeat(64)}`;

function exactSnapshot(blockNumber: number): AnalysisSnapshot {
  return {
    capturedAt: '2026-08-14T00:00:00.000Z',
    providerVersions: { 'bsc-rpc@test': 'test-rpc-v1' },
    adapterVersions: { 'test-adapter': 'v1' },
    configHash: hashPayload({ blockNumber }),
    entityModelVersion: 'test-entity-v1',
    labelSnapshot: 'test-labels-v1',
    ledger: 'EVM',
    chainId: 'eip155:1',
    blockNumber: String(blockNumber),
    blockHash: `0x${String(blockNumber).padStart(2, '0')}${'e'.repeat(62)}`,
    parentBlockHash: `0x${String(Math.max(0, blockNumber - 1)).padStart(2, '0')}${'e'.repeat(62)}`,
    finality: 'finalized',
  };
}

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

class VersionedReportStore {
  readonly reports = new Map<string, Awaited<ReturnType<TokenHistoryDiscovery['run']>>['report']>();

  async put(report: Awaited<ReturnType<TokenHistoryDiscovery['run']>>['report']) {
    const existing = this.reports.get(report.id);
    if (existing !== undefined && existing.resultHash !== report.resultHash) {
      throw new Error('report conflict');
    }
    this.reports.set(report.id, existing ?? report);
    return existing ?? report;
  }

  async get(id: string) {
    return this.reports.get(id);
  }
}

function stores() {
  const ledger = new EvidenceLedger();
  const evidenceWrites: Array<{
    evidence: Parameters<typeof ledger.add>[0];
    sources: readonly string[];
  }> = [];
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
      evidenceWrites.push({ evidence: item, sources });
      const existing = ledger.get(item.id);
      if (existing !== undefined) return existing;
      return ledger.add(item, sources, snapshot);
    },
  };
  const factWriter: RawFactWriter = {
    async put(fact) {
      facts.push(fact);
      return fact;
    },
  };
  return { artifacts, evidence, evidenceWrites, factWriter, facts, ledger };
}

describe('TokenHistoryDiscovery', () => {
  it('builds finalized Transfer observations and preserves unconfigured exact RPC state', async () => {
    const request = tokenHistoryDiscoveryRequest({ token, fromBlock: 0, toBlock: 1 });
    expect(request).toMatchObject({
      includeAllBlocks: false,
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
      sourceId: 'bsc-rpc@test#1',
      sourceIds: ['bsc-rpc@test#1', 'bsc-rpc@test#2'],
      async getTransactionObservation() {
        return {
          endpointId: 'bsc-rpc@test#1',
          sourceIds: ['bsc-rpc@test#1', 'bsc-rpc@test#2'],
          value: transaction,
        };
      },
      async getTransactionReceiptObservation() {
        return {
          endpointId: 'bsc-rpc@test#1',
          sourceIds: ['bsc-rpc@test#1', 'bsc-rpc@test#2'],
          value: receipt,
        };
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
    const actionReport = actionReports[0] as { terminalEvidenceId: string };
    expect(
      storage.evidenceWrites.some(
        (write) =>
          write.evidence.id === actionReport.terminalEvidenceId && write.sources.length > 0,
      ),
    ).toBe(true);
    expect(result.report.sourceSet).toEqual(
      expect.arrayContaining(['bsc-rpc@test#1', 'bsc-rpc@test#2']),
    );
    expect(
      storage.evidenceWrites.some(
        (write) => write.evidence.source === 'zerotrace:token-history-source-reconciliation-v1.0.0',
      ),
    ).toBe(true);
    const providerAttestations = storage.evidenceWrites.filter(
      (write) =>
        write.evidence.kind === 'PROVIDER_OBSERVATION' &&
        ['bsc-rpc@test#1', 'bsc-rpc@test#2'].includes(write.evidence.source),
    );
    expect(providerAttestations).toHaveLength(2);
    expect(providerAttestations.map((write) => write.evidence.source).sort()).toEqual([
      'bsc-rpc@test#1',
      'bsc-rpc@test#2',
    ]);
    expect(result.report.evidenceIds).toEqual(
      expect.arrayContaining(providerAttestations.map((write) => write.evidence.id)),
    );
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

  it('rebinds unresolved exact observations into an immutable terminal report revision', async () => {
    const checkpoint = new FakeCheckpoints();
    const storage = stores();
    const reports = new VersionedReportStore();
    const first = await new TokenHistoryDiscovery({
      source: new FakeSource(),
      token,
      fromBlock: 0,
      toBlock: 1,
      checkpoints: checkpoint,
      artifacts: storage.artifacts,
      evidence: storage.evidence,
      facts: storage.factWriter,
      reportStore: reports,
    }).run();

    expect(first.report.actionSemanticsBindings[0]).toMatchObject({
      status: 'UNKNOWN',
      reason: 'EXACT_RPC_PROVIDER_UNCONFIGURED',
    });

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
    const replay = await new TokenHistoryDiscovery({
      source: new FakeSource(),
      token,
      fromBlock: 0,
      toBlock: 1,
      checkpoints: checkpoint,
      artifacts: storage.artifacts,
      evidence: storage.evidence,
      facts: storage.factWriter,
      factReader: { listRange: async () => storage.facts },
      evidenceReader: { get: async (id) => storage.ledger.get(id) },
      exactReader,
      reportStore: reports,
      recoveryRevision: 'capture-attempt:2',
      actionSemantics: { put: async () => undefined },
    }).run();

    expect(replay.report.id).not.toBe(first.report.id);
    expect(replay.report.actionSemanticsBindings[0]).toMatchObject({ status: 'BOUND' });
    expect(replay.report.observations[0]).toMatchObject({
      application: 'SUCCESS',
      actionSemanticsIds: [expect.stringMatching(/^asr_[0-9a-f]{24}$/)],
    });
    expect(reports.reports.has(first.report.id)).toBe(true);
    expect(reports.reports.has(replay.report.id)).toBe(true);
  });

  it('replays only the requested token from a shared durable Raw Fact range', async () => {
    const checkpoint = new FakeCheckpoints();
    const storage = stores();
    const exactReader: TokenHistoryExactReader = {
      sourceId: 'bsc-rpc@test',
      async getTransactionObservation() {
        return { endpointId: 'bsc-rpc@test', value: null };
      },
      async getTransactionReceiptObservation() {
        return { endpointId: 'bsc-rpc@test', value: null };
      },
      async readAnchorAt(position) {
        return { snapshot: exactSnapshot(Number(position)) };
      },
    };
    const first = await new TokenHistoryDiscovery({
      source: new FakeSource(),
      token,
      fromBlock: 0,
      toBlock: 1,
      checkpoints: checkpoint,
      artifacts: storage.artifacts,
      evidence: storage.evidence,
      facts: storage.factWriter,
      exactReader,
    }).run();

    const unrelatedPayload = {
      transactionHash: unrelatedTransactionHash,
      transactionIndex: 0,
      logIndex: 1,
      address: unrelatedToken,
      topics: [transferTopic, fromTopic, toTopic],
      data: `0x${'0'.repeat(63)}2`,
    };
    const unrelatedArtifactRef = `s3://zerotrace-raw/test/unrelated.json#sha256=${hashPayload(unrelatedPayload)}`;
    const unrelatedEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'LOG',
      source: 'sqd:ethereum-mainnet',
      locator: `unrelated-token-log:${unrelatedTransactionHash}`,
      payload: unrelatedPayload,
      observedAt: '2026-08-14T00:00:00.000Z',
      blockOrSlot: '1',
      finality: 'finalized',
      rawArtifactRef: unrelatedArtifactRef,
      summary: 'Shared-range unrelated token log used to verify resumed query filtering.',
    });
    const unrelatedEvidenceNode = storage.ledger.add(unrelatedEvidence, [], exactSnapshot(1));
    storage.facts.push(
      createRawChainFact({
        ledger: 'EVM',
        chainId: 'eip155:1',
        blockOrSlot: '1',
        blockHash: blocks[1]!.header.hash,
        factType: 'LOG',
        subject: unrelatedTransactionHash,
        provider: 'sqd:ethereum-mainnet',
        finality: 'finalized',
        payload: unrelatedPayload,
        evidenceId: unrelatedEvidenceNode.evidence.id,
        rawArtifactRef: unrelatedArtifactRef,
        observedAt: '2026-08-14T00:00:00.000Z',
      }),
    );
    const candidateTransactionHash = `0x${'8'.repeat(64)}`;
    const candidatePayload = {
      ...unrelatedPayload,
      transactionHash: candidateTransactionHash,
      address: token,
    };
    const candidateArtifactRef = `s3://zerotrace-raw/test/candidate.json#sha256=${hashPayload(candidatePayload)}`;
    const candidateEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'LOG',
      source: 'sqd:ethereum-mainnet',
      locator: `token-history-candidate-log:${candidateTransactionHash}:0`,
      payload: candidatePayload,
      observedAt: '2026-08-14T00:00:00.000Z',
      blockOrSlot: '1',
      finality: 'finalized',
      rawArtifactRef: candidateArtifactRef,
      summary: 'Candidate expansion log used to verify replay provenance filtering.',
    });
    const candidateEvidenceNode = storage.ledger.add(candidateEvidence, [], exactSnapshot(1));
    storage.facts.push(
      createRawChainFact({
        ledger: 'EVM',
        chainId: 'eip155:1',
        blockOrSlot: '1',
        blockHash: blocks[1]!.header.hash,
        factType: 'LOG',
        subject: candidateTransactionHash,
        provider: 'sqd:ethereum-mainnet',
        finality: 'finalized',
        payload: candidatePayload,
        evidenceId: candidateEvidenceNode.evidence.id,
        rawArtifactRef: candidateArtifactRef,
        observedAt: '2026-08-14T00:00:00.000Z',
      }),
    );

    const originalRequestedFact = storage.facts.find(
      (fact) => fact.factType === 'LOG' && fact.provider === 'sqd:ethereum-mainnet',
    );
    if (originalRequestedFact === undefined) throw new Error('requested replay fact missing');
    const duplicateArtifactRef = `s3://zerotrace-raw/test/duplicate.json#sha256=${hashPayload(originalRequestedFact.payload)}`;
    const duplicateEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'LOG',
      source: 'sqd:ethereum-mainnet',
      locator: `evm-log:duplicate:${originalRequestedFact.subject}`,
      payload: originalRequestedFact.payload,
      observedAt: originalRequestedFact.observedAt,
      blockOrSlot: originalRequestedFact.blockOrSlot,
      finality: 'finalized',
      rawArtifactRef: duplicateArtifactRef,
      summary: 'Duplicate semantic Raw Fact used to verify deterministic replay deduplication.',
    });
    const duplicateEvidenceNode = storage.ledger.add(
      duplicateEvidence,
      [],
      exactSnapshot(Number(originalRequestedFact.blockOrSlot)),
    );
    storage.facts.push(
      createRawChainFact({
        ledger: 'EVM',
        chainId: 'eip155:1',
        blockOrSlot: originalRequestedFact.blockOrSlot,
        blockHash: originalRequestedFact.blockHash,
        factType: 'LOG',
        subject: originalRequestedFact.subject,
        provider: originalRequestedFact.provider,
        finality: 'finalized',
        payload: originalRequestedFact.payload,
        evidenceId: duplicateEvidenceNode.evidence.id,
        rawArtifactRef: duplicateArtifactRef,
        observedAt: originalRequestedFact.observedAt,
      }),
    );

    if (checkpoint.run === undefined) throw new Error('checkpoint run missing after first pass');
    checkpoint.run = {
      ...checkpoint.run,
      status: 'RUNNING',
      nextBlock: 2,
      lastBlock: 1,
      completedAt: null,
    };
    const replay = await new TokenHistoryDiscovery({
      source: new FakeSource(),
      token,
      fromBlock: 0,
      toBlock: 1,
      checkpoints: checkpoint,
      artifacts: storage.artifacts,
      evidence: storage.evidence,
      facts: storage.factWriter,
      exactReader,
      factReader: { listRange: async () => storage.facts },
      evidenceReader: { get: async (id) => storage.ledger.get(id) },
    }).run();

    expect(replay.report.observations).toHaveLength(1);
    expect(replay.report.observations[0]?.token).toBe(token);
    expect(replay.report.relevantTransactionHashes).toEqual(first.report.relevantTransactionHashes);
    expect(replay.report.evidenceIds).not.toContain(candidateEvidenceNode.evidence.id);
    expect(
      [originalRequestedFact.evidenceId, duplicateEvidenceNode.evidence.id].filter((id) =>
        replay.report.evidenceIds.includes(id ?? ''),
      ),
    ).toHaveLength(1);
  });

  it('keeps a complete sparse range covered when the requested end has no Transfer event', async () => {
    const storage = stores();
    const exactReader: TokenHistoryExactReader = {
      sourceId: 'bsc-rpc@test',
      async getTransactionObservation() {
        return { endpointId: 'bsc-rpc@test', value: null };
      },
      async getTransactionReceiptObservation() {
        return { endpointId: 'bsc-rpc@test', value: null };
      },
      async readAnchorAt(position) {
        return { snapshot: exactSnapshot(Number(position)) };
      },
    };

    const result = await new TokenHistoryDiscovery({
      source: new FakeSource(),
      token,
      fromBlock: 0,
      toBlock: 2,
      checkpoints: new FakeCheckpoints(),
      artifacts: storage.artifacts,
      evidence: storage.evidence,
      facts: storage.factWriter,
      exactReader,
    }).run();

    expect(result.report).toMatchObject({
      status: 'COMPLETE',
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      checkpoint: {
        nextBlock: '3',
        lastBlock: '2',
        status: 'REQUESTED_RANGE_COMPLETE',
      },
      snapshot: { blockNumber: '2', blockHash: expect.stringMatching(/^0x02/) },
    });
    expect(result.report.rangeEvidenceIds.length).toBeGreaterThan(0);
    expect(
      storage.evidenceWrites.some((write) => write.evidence.kind === 'PROVIDER_OBSERVATION'),
    ).toBe(true);
  });
});
