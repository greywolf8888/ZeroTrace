import {
  SQD_DATASETS,
  sqdBitcoinInputsFromBlock,
  sqdBitcoinOutputsFromBlock,
  sqdEvmLogsFromBlock,
  sqdEvmStateDiffsFromBlock,
  sqdEvmTracesFromBlock,
  sqdSolanaBalancesFromBlock,
  sqdSolanaInstructionsFromBlock,
  sqdSolanaLogsFromBlock,
  sqdSolanaRewardsFromBlock,
  sqdSolanaTokenBalancesFromBlock,
  sqdTransactionsFromBlock,
} from '@zerotrace/chain-adapters';
import type {
  SqdDataset,
  SqdDatasetMetadata,
  SqdFinalizedBlock,
  SqdFinalizedRangeRequest,
  SqdLedgerRecordItem,
  SqdStreamSummary,
} from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload, type EvidenceNode } from '@zerotrace/evidence';
import type {
  AnalysisSnapshot,
  Evidence,
  EvidenceKind,
  JsonValue,
  Ledger,
  RawChainFact,
} from '@zerotrace/schemas';
import {
  createRawChainFact,
  type IngestionRun,
  type RawArtifactWriteResult,
} from '@zerotrace/storage';

export * from './profiles.js';
export * from './token-history.js';

export const SQD_INGESTION_VERSION = 'sqd-finalized-ingestion-v4';

const RAW_FACT_BLOCK_BATCH_SIZE = 250;

function canonicalSourceChainId(ledger: Ledger, chainId: string): string {
  if (ledger !== 'EVM') return chainId;
  return chainId.startsWith('eip155:') ? chainId : `eip155:${chainId}`;
}

export type IngestionPipelineErrorCode =
  | 'INGESTION_SOURCE_MISMATCH'
  | 'INGESTION_SOURCE_COVERAGE_UNKNOWN'
  | 'INGESTION_SOURCE_RANGE_UNAVAILABLE'
  | 'INGESTION_BLOCK_INVALID'
  | 'INGESTION_FAILED';

export class IngestionPipelineError extends Error {
  readonly code: IngestionPipelineErrorCode;
  readonly retryable: boolean;

  constructor(
    code: IngestionPipelineErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'IngestionPipelineError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface SqdFinalizedSource {
  readonly dataset: SqdDataset;
  readonly ledger: Ledger;
  readonly chainId: string;
  metadata(): Promise<SqdDatasetMetadata>;
  readFinalizedRange(
    request: SqdFinalizedRangeRequest,
    onBlock: (block: SqdFinalizedBlock) => void | Promise<void>,
  ): Promise<SqdStreamSummary>;
}

export interface IngestionCheckpointWriter {
  begin(input: {
    source: string;
    dataset: string;
    ledger: Ledger;
    chainId: string;
    fromBlock: number;
    toBlock: number;
    query: Readonly<Record<string, unknown>>;
    startedAt?: string;
  }): Promise<IngestionRun>;
  advance(id: string, block: number): Promise<IngestionRun>;
  finish(
    id: string,
    status: 'REQUESTED_RANGE_COMPLETE' | 'SOURCE_HEAD_REACHED',
    nextBlock: number,
  ): Promise<IngestionRun>;
  recordFailure(id: string, errorCode: string): Promise<IngestionRun>;
}

export interface RawArtifactWriter {
  put(input: {
    ledger: Ledger;
    chainId: string;
    blockOrSlot: string;
    provider: string;
    capturedAt: string;
    payload: JsonValue;
  }): Promise<RawArtifactWriteResult>;
}

export interface EvidenceWriter {
  put(
    evidence: Evidence,
    sourceEvidenceIds?: readonly string[],
    snapshot?: AnalysisSnapshot,
  ): Promise<EvidenceNode>;
}

export interface RawFactWriter {
  put(fact: RawChainFact): Promise<RawChainFact>;
  /**
   * Optional batch boundary used by durable stores. The ingestion pipeline only
   * advances a checkpoint after this batch resolves successfully.
   */
  putMany?(facts: readonly RawChainFact[]): Promise<readonly RawChainFact[]>;
}

export interface SqdFinalizedIngestionOptions {
  source: SqdFinalizedSource;
  checkpoints: IngestionCheckpointWriter;
  artifacts: RawArtifactWriter;
  evidence: EvidenceWriter;
  facts: RawFactWriter;
  entityModelVersion?: string;
  labelSnapshot?: string;
  adapterVersion?: string;
  nowImplementation?: () => Date;
  onBlockMaterialized?: (input: {
    block: SqdFinalizedBlock;
    snapshot: AnalysisSnapshot;
    artifact: RawArtifactWriteResult;
    facts: readonly RawChainFact[];
    evidence: readonly Evidence[];
  }) => void | Promise<void>;
  onBeforeFinish?: (input: {
    run: IngestionRun;
    resumedFrom: number;
    sourceSummary: SqdStreamSummary;
  }) => void | Promise<void>;
}

export interface SqdIngestionResult {
  run: IngestionRun;
  resumedFrom: number;
  processedBlocks: number;
  recordCoverage: SqdRecordCoverage;
  transactionCoverage: 'NOT_QUERIED' | 'MATERIALIZED';
  processedTransactions: number | null;
  alreadyTerminal: boolean;
  sourceSummary: SqdStreamSummary | null;
}

export type SqdRecordTable =
  | 'transactions'
  | 'logs'
  | 'inputs'
  | 'outputs'
  | 'instructions'
  | 'traces'
  | 'stateDiffs'
  | 'balances'
  | 'tokenBalances'
  | 'rewards';

export type SqdRecordMaterialization =
  | { state: 'MATERIALIZED'; processed: number }
  | { state: 'NOT_QUERIED' | 'NOT_APPLICABLE'; processed: null };

export type SqdRecordCoverage = Readonly<Record<SqdRecordTable, SqdRecordMaterialization>>;

type RequestedMaterialization = Readonly<Record<SqdRecordTable, boolean>>;
type ProcessedRecordCounts = Record<SqdRecordTable, number>;

function requestGroupSelected(request: SqdFinalizedRangeRequest, group: SqdRecordTable): boolean {
  const selected = request.requests?.[group];
  return Array.isArray(selected) && selected.length > 0;
}

function requestedMaterialization(
  dataset: SqdDataset,
  request: SqdFinalizedRangeRequest,
): RequestedMaterialization {
  const queryType = SQD_DATASETS[dataset].queryType;
  return {
    transactions: requestGroupSelected(request, 'transactions'),
    logs: (queryType === 'evm' || queryType === 'solana') && requestGroupSelected(request, 'logs'),
    inputs: queryType === 'bitcoin' && requestGroupSelected(request, 'inputs'),
    outputs: queryType === 'bitcoin' && requestGroupSelected(request, 'outputs'),
    instructions: queryType === 'solana' && requestGroupSelected(request, 'instructions'),
    traces: queryType === 'evm' && requestGroupSelected(request, 'traces'),
    stateDiffs: queryType === 'evm' && requestGroupSelected(request, 'stateDiffs'),
    balances: queryType === 'solana' && requestGroupSelected(request, 'balances'),
    tokenBalances: queryType === 'solana' && requestGroupSelected(request, 'tokenBalances'),
    rewards: queryType === 'solana' && requestGroupSelected(request, 'rewards'),
  };
}

function materializationState(
  applicable: boolean,
  requested: boolean,
  processed: number,
): SqdRecordMaterialization {
  if (!applicable) return { state: 'NOT_APPLICABLE', processed: null };
  if (!requested) return { state: 'NOT_QUERIED', processed: null };
  return { state: 'MATERIALIZED', processed };
}

function recordCoverage(
  dataset: SqdDataset,
  requested: RequestedMaterialization,
  counts: ProcessedRecordCounts,
): SqdRecordCoverage {
  const queryType = SQD_DATASETS[dataset].queryType;
  return {
    transactions: materializationState(true, requested.transactions, counts.transactions),
    logs: materializationState(
      queryType === 'evm' || queryType === 'solana',
      requested.logs,
      counts.logs,
    ),
    inputs: materializationState(queryType === 'bitcoin', requested.inputs, counts.inputs),
    outputs: materializationState(queryType === 'bitcoin', requested.outputs, counts.outputs),
    instructions: materializationState(
      queryType === 'solana',
      requested.instructions,
      counts.instructions,
    ),
    traces: materializationState(queryType === 'evm', requested.traces, counts.traces),
    stateDiffs: materializationState(queryType === 'evm', requested.stateDiffs, counts.stateDiffs),
    balances: materializationState(queryType === 'solana', requested.balances, counts.balances),
    tokenBalances: materializationState(
      queryType === 'solana',
      requested.tokenBalances,
      counts.tokenBalances,
    ),
    rewards: materializationState(queryType === 'solana', requested.rewards, counts.rewards),
  };
}

function emptyProcessedCounts(): ProcessedRecordCounts {
  return {
    transactions: 0,
    logs: 0,
    inputs: 0,
    outputs: 0,
    instructions: 0,
    traces: 0,
    stateDiffs: 0,
    balances: 0,
    tokenBalances: 0,
    rewards: 0,
  };
}

function timestampFromSeconds(seconds: number | null): string | undefined {
  if (seconds === null) return undefined;
  const milliseconds = seconds * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new IngestionPipelineError(
      'INGESTION_BLOCK_INVALID',
      'Block timestamp exceeds safe precision.',
    );
  }
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw new IngestionPipelineError('INGESTION_BLOCK_INVALID', 'Block timestamp is invalid.');
  }
  return date.toISOString();
}

function validateHash(ledger: Ledger, hash: string, parentHash: string): void {
  const evmHash = /^0x[0-9a-fA-F]{64}$/;
  const bitcoinHash = /^[0-9a-fA-F]{64}$/;
  const solanaHash = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
  const pattern = ledger === 'EVM' ? evmHash : ledger === 'BITCOIN' ? bitcoinHash : solanaHash;
  if (!pattern.test(hash) || !pattern.test(parentHash)) {
    throw new IngestionPipelineError(
      'INGESTION_BLOCK_INVALID',
      'Finalized block hash does not match its ledger format.',
    );
  }
}

function createSnapshot(options: {
  ledger: Ledger;
  chainId: string;
  block: SqdFinalizedBlock;
  capturedAt: string;
  queryHash: string;
  source: string;
  entityModelVersion: string;
  labelSnapshot: string;
  adapterVersion: string;
}): AnalysisSnapshot {
  const { header } = options.block;
  validateHash(options.ledger, header.hash, header.parentHash);
  const common = {
    capturedAt: options.capturedAt,
    providerVersions: { [options.source]: 'sqd-portal-finalized-http-v1' },
    adapterVersions: { [SQD_INGESTION_VERSION]: options.adapterVersion },
    configHash: options.queryHash,
    entityModelVersion: options.entityModelVersion,
    labelSnapshot: options.labelSnapshot,
  };
  const blockTimestamp = timestampFromSeconds(header.timestamp);
  if (options.ledger === 'EVM') {
    return {
      ...common,
      ledger: 'EVM',
      chainId: options.chainId,
      blockNumber: String(header.number),
      blockHash: header.hash,
      parentBlockHash: header.parentHash,
      finality: 'finalized',
      ...(blockTimestamp === undefined ? {} : { blockTimestamp }),
    };
  }
  if (options.ledger === 'BITCOIN') {
    if (options.chainId !== 'bitcoin-mainnet') {
      throw new IngestionPipelineError(
        'INGESTION_SOURCE_MISMATCH',
        'Bitcoin SQD source must use bitcoin-mainnet.',
      );
    }
    return {
      ...common,
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      height: String(header.number),
      blockHash: header.hash,
      previousBlockHash: header.parentHash,
      finality: 'best-chain',
    };
  }
  if (options.chainId !== 'solana-mainnet') {
    throw new IngestionPipelineError(
      'INGESTION_SOURCE_MISMATCH',
      'Solana SQD source must use solana-mainnet.',
    );
  }
  return {
    ...common,
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    slot: String(header.number),
    blockhash: header.hash,
    commitment: 'finalized',
    ...(blockTimestamp === undefined ? {} : { blockTimestamp }),
  };
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'INGESTION_FAILED';
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' && /^[A-Z0-9_:-]{1,160}$/.test(code) ? code : 'INGESTION_FAILED';
}

function retryableFrom(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as Record<string, unknown>).retryable === true;
}

async function materializeLedgerRecord(options: {
  item: SqdLedgerRecordItem;
  ledger: Ledger;
  chainId: string;
  dataset: SqdDataset;
  position: string;
  blockHash: string;
  sourceId: string;
  observedAt: string;
  rawArtifactRef: string;
  snapshot: AnalysisSnapshot;
  evidenceKind: EvidenceKind;
  factType:
    | 'LOG'
    | 'UTXO_INPUT'
    | 'UTXO_OUTPUT'
    | 'INSTRUCTION'
    | 'TRACE'
    | 'STATE_DIFF'
    | 'BALANCE'
    | 'TOKEN_BALANCE'
    | 'REWARD';
  locatorPrefix:
    | 'evm-log'
    | 'bitcoin-input'
    | 'bitcoin-output'
    | 'solana-instruction'
    | 'evm-trace'
    | 'evm-state-diff'
    | 'solana-log'
    | 'solana-balance'
    | 'solana-token-balance'
    | 'solana-reward';
  summaryNoun:
    | 'log'
    | 'input'
    | 'output'
    | 'instruction'
    | 'trace'
    | 'state diff'
    | 'balance'
    | 'token balance'
    | 'reward';
  evidence: EvidenceWriter;
  facts: RawFactWriter;
}): Promise<void> {
  const recordEvidence = createEvidence({
    ledger: options.ledger,
    chainId: options.chainId,
    kind: options.evidenceKind,
    source: options.sourceId,
    locator: `${options.locatorPrefix}:${options.item.identity}`,
    payload: options.item.payload,
    observedAt: options.observedAt,
    blockOrSlot: options.position,
    finality: 'finalized',
    rawArtifactRef: options.rawArtifactRef,
    summary: `SQD finalized ${options.dataset} ${options.summaryNoun} ${options.item.identity}.`,
  });
  await options.evidence.put(recordEvidence, [], options.snapshot);
  await options.facts.put(
    createRawChainFact({
      ledger: options.ledger,
      chainId: options.chainId,
      blockOrSlot: options.position,
      blockHash: options.blockHash,
      factType: options.factType,
      subject: options.item.identity,
      provider: options.sourceId,
      finality: 'finalized',
      payload: options.item.payload,
      evidenceId: recordEvidence.id,
      rawArtifactRef: options.rawArtifactRef,
      observedAt: options.observedAt,
    }),
  );
}

export function sqdIngestionQuery(
  dataset: SqdDataset,
  request: SqdFinalizedRangeRequest,
): Readonly<Record<string, unknown>> {
  const materialize = requestedMaterialization(dataset, request);
  return {
    schema: SQD_INGESTION_VERSION,
    dataset,
    type: SQD_DATASETS[dataset].queryType,
    fromBlock: request.fromBlock,
    toBlock: request.toBlock,
    includeAllBlocks: request.includeAllBlocks ?? true,
    materialize: { blocks: true, ...materialize },
    fields: request.fields ?? {},
    requests: request.requests ?? {},
  };
}

export class SqdFinalizedIngestionPipeline {
  readonly #source: SqdFinalizedSource;
  readonly #checkpoints: IngestionCheckpointWriter;
  readonly #artifacts: RawArtifactWriter;
  readonly #evidence: EvidenceWriter;
  readonly #facts: RawFactWriter;
  readonly #entityModelVersion: string;
  readonly #labelSnapshot: string;
  readonly #adapterVersion: string;
  readonly #now: () => Date;
  readonly #onBlockMaterialized:
    NonNullable<SqdFinalizedIngestionOptions['onBlockMaterialized']> | undefined;
  readonly #onBeforeFinish: NonNullable<SqdFinalizedIngestionOptions['onBeforeFinish']> | undefined;

  constructor(options: SqdFinalizedIngestionOptions) {
    this.#source = options.source;
    this.#checkpoints = options.checkpoints;
    this.#artifacts = options.artifacts;
    this.#evidence = options.evidence;
    this.#facts = options.facts;
    this.#entityModelVersion = options.entityModelVersion ?? 'entity-model-unapplied';
    this.#labelSnapshot = options.labelSnapshot ?? 'labels-unapplied';
    this.#adapterVersion = options.adapterVersion ?? '0.1.0';
    this.#now = options.nowImplementation ?? (() => new Date());
    this.#onBlockMaterialized = options.onBlockMaterialized;
    this.#onBeforeFinish = options.onBeforeFinish;
  }

  async run(request: SqdFinalizedRangeRequest): Promise<SqdIngestionResult> {
    const sourceId = `sqd:${this.#source.dataset}`;
    const chainId = canonicalSourceChainId(this.#source.ledger, this.#source.chainId);
    const query = sqdIngestionQuery(this.#source.dataset, request);
    const materialize = requestedMaterialization(this.#source.dataset, request);
    const processedRecords = emptyProcessedCounts();
    const transactionCoverage = materialize.transactions ? 'MATERIALIZED' : 'NOT_QUERIED';
    let run = await this.#checkpoints.begin({
      source: sourceId,
      dataset: this.#source.dataset,
      ledger: this.#source.ledger,
      chainId,
      fromBlock: request.fromBlock,
      toBlock: request.toBlock,
      query,
      startedAt: this.#now().toISOString(),
    });
    const resumedFrom = run.nextBlock;
    if (run.status !== 'RUNNING') {
      return {
        run,
        resumedFrom,
        processedBlocks: 0,
        recordCoverage: recordCoverage(this.#source.dataset, materialize, processedRecords),
        transactionCoverage,
        processedTransactions: materialize.transactions ? 0 : null,
        alreadyTerminal: true,
        sourceSummary: null,
      };
    }

    try {
      if (run.nextBlock > run.toBlock) {
        const sourceSummary: SqdStreamSummary = {
          dataset: this.#source.dataset,
          completion: 'REQUESTED_RANGE_COMPLETE',
          requestedFrom: request.fromBlock,
          requestedTo: request.toBlock,
          lastBlock: run.lastBlock,
          nextBlock: run.nextBlock,
          finalizedHead: null,
          blocks: 0,
          requests: 0,
          retries: 0,
        };
        await this.#onBeforeFinish?.({ run, resumedFrom, sourceSummary });
        run = await this.#checkpoints.finish(run.id, 'REQUESTED_RANGE_COMPLETE', run.toBlock + 1);
        return {
          run,
          resumedFrom,
          processedBlocks: 0,
          recordCoverage: recordCoverage(this.#source.dataset, materialize, processedRecords),
          transactionCoverage,
          processedTransactions: materialize.transactions ? 0 : null,
          alreadyTerminal: false,
          sourceSummary: null,
        };
      }
      const metadata = await this.#source.metadata();
      if (metadata.dataset !== this.#source.dataset) {
        throw new IngestionPipelineError(
          'INGESTION_SOURCE_MISMATCH',
          'SQD metadata does not match the configured dataset.',
        );
      }
      if (metadata.startBlock === null) {
        throw new IngestionPipelineError(
          'INGESTION_SOURCE_COVERAGE_UNKNOWN',
          'SQD dataset start block is unavailable.',
        );
      }
      if (run.nextBlock < metadata.startBlock) {
        throw new IngestionPipelineError(
          'INGESTION_SOURCE_RANGE_UNAVAILABLE',
          'Requested range begins before SQD dataset coverage.',
        );
      }

      let processedBlocks = 0;
      const pendingBlocks: Array<{
        block: SqdFinalizedBlock;
        snapshot: AnalysisSnapshot;
        artifact: RawArtifactWriteResult;
        facts: readonly RawChainFact[];
        evidence: readonly Evidence[];
        counts: ProcessedRecordCounts;
      }> = [];
      const commitBlock = async (input: {
        block: SqdFinalizedBlock;
        snapshot: AnalysisSnapshot;
        artifact: RawArtifactWriteResult;
        facts: readonly RawChainFact[];
        evidence: readonly Evidence[];
        counts: ProcessedRecordCounts;
      }): Promise<void> => {
        await this.#onBlockMaterialized?.(input);
        run = await this.#checkpoints.advance(run.id, input.block.header.number);
        processedBlocks += 1;
        for (const table of Object.keys(input.counts) as SqdRecordTable[]) {
          processedRecords[table] += input.counts[table];
        }
      };
      const flushPendingBlocks = async (): Promise<void> => {
        if (pendingBlocks.length === 0 || this.#facts.putMany === undefined) return;
        const pendingFacts = pendingBlocks.flatMap((pending) => pending.facts);
        const stored = await this.#facts.putMany(pendingFacts);
        if (
          stored.length !== pendingFacts.length ||
          stored.some((fact, index) => fact.id !== pendingFacts[index]?.id)
        ) {
          throw new IngestionPipelineError(
            'INGESTION_FAILED',
            'Raw Fact batch writer returned a conflicting result.',
          );
        }
        let factOffset = 0;
        for (const pending of pendingBlocks) {
          const factCount = pending.facts.length;
          await commitBlock({
            ...pending,
            facts: stored.slice(factOffset, factOffset + factCount),
          });
          factOffset += factCount;
        }
        pendingBlocks.length = 0;
      };
      const sourceSummary = await this.#source.readFinalizedRange(
        { ...request, fromBlock: run.nextBlock, toBlock: run.toBlock },
        async (block) => {
          const position = String(block.header.number);
          const artifact = await this.#artifacts.put({
            ledger: this.#source.ledger,
            chainId,
            blockOrSlot: position,
            provider: sourceId,
            capturedAt: run.startedAt,
            payload: block,
          });
          const snapshot = createSnapshot({
            ledger: this.#source.ledger,
            chainId,
            block,
            capturedAt: run.startedAt,
            queryHash: run.queryHash,
            source: sourceId,
            entityModelVersion: this.#entityModelVersion,
            labelSnapshot: this.#labelSnapshot,
            adapterVersion: this.#adapterVersion,
          });
          const blockEvidence: Evidence[] = [];
          const blockFacts: RawChainFact[] = [];
          const pendingFacts: RawChainFact[] = [];
          const evidenceWriter: EvidenceWriter = {
            put: async (candidate, sourceEvidenceIds = [], candidateSnapshot) => {
              const stored = await this.#evidence.put(
                candidate,
                sourceEvidenceIds,
                candidateSnapshot,
              );
              blockEvidence.push(stored.evidence);
              return stored;
            },
          };
          const factWriter: RawFactWriter = {
            put: async (candidate) => {
              if (this.#facts.putMany !== undefined) {
                pendingFacts.push(candidate);
                return candidate;
              }
              const stored = await this.#facts.put(candidate);
              blockFacts.push(stored);
              return stored;
            },
          };
          const evidence = createEvidence({
            ledger: this.#source.ledger,
            chainId,
            kind: 'BLOCK',
            source: sourceId,
            locator: `block:${position}:${block.header.hash}`,
            payload: block,
            observedAt: run.startedAt,
            blockOrSlot: position,
            finality: 'finalized',
            rawArtifactRef: artifact.ref,
            summary: `SQD finalized ${this.#source.dataset} block ${position}.`,
          });
          await evidenceWriter.put(evidence, [], snapshot);
          const fact = createRawChainFact({
            ledger: this.#source.ledger,
            chainId,
            blockOrSlot: position,
            blockHash: block.header.hash,
            factType: 'BLOCK',
            subject: block.header.hash,
            provider: sourceId,
            finality: 'finalized',
            payload: block,
            evidenceId: evidence.id,
            rawArtifactRef: artifact.ref,
            observedAt: run.startedAt,
          });
          await factWriter.put(fact);
          const transactions = materialize.transactions
            ? sqdTransactionsFromBlock(this.#source.dataset, block)
            : [];
          for (const transaction of transactions) {
            const transactionEvidence = createEvidence({
              ledger: this.#source.ledger,
              chainId,
              kind: 'TRANSACTION',
              source: sourceId,
              locator: `transaction:${transaction.identity}`,
              payload: transaction.payload,
              observedAt: run.startedAt,
              blockOrSlot: position,
              finality: 'finalized',
              rawArtifactRef: artifact.ref,
              summary: `SQD finalized ${this.#source.dataset} transaction ${transaction.identity}.`,
            });
            await evidenceWriter.put(transactionEvidence, [], snapshot);
            await factWriter.put(
              createRawChainFact({
                ledger: this.#source.ledger,
                chainId,
                blockOrSlot: position,
                blockHash: block.header.hash,
                factType: 'TRANSACTION',
                subject: transaction.identity,
                provider: sourceId,
                finality: 'finalized',
                payload: transaction.payload,
                evidenceId: transactionEvidence.id,
                rawArtifactRef: artifact.ref,
                observedAt: run.startedAt,
              }),
            );
          }
          const commonRecord = {
            ledger: this.#source.ledger,
            chainId,
            dataset: this.#source.dataset,
            position,
            blockHash: block.header.hash,
            sourceId,
            observedAt: run.startedAt,
            rawArtifactRef: artifact.ref,
            snapshot,
            evidence: evidenceWriter,
            facts: factWriter,
          } as const;
          const queryType = SQD_DATASETS[this.#source.dataset].queryType;
          const logs = materialize.logs
            ? queryType === 'solana'
              ? sqdSolanaLogsFromBlock(this.#source.dataset, block)
              : sqdEvmLogsFromBlock(this.#source.dataset, block)
            : [];
          for (const item of logs) {
            await materializeLedgerRecord({
              ...commonRecord,
              item,
              evidenceKind: 'LOG',
              factType: 'LOG',
              locatorPrefix: queryType === 'solana' ? 'solana-log' : 'evm-log',
              summaryNoun: 'log',
            });
          }
          const traces = materialize.traces
            ? sqdEvmTracesFromBlock(this.#source.dataset, block)
            : [];
          for (const item of traces) {
            await materializeLedgerRecord({
              ...commonRecord,
              item,
              evidenceKind: 'TRACE',
              factType: 'TRACE',
              locatorPrefix: 'evm-trace',
              summaryNoun: 'trace',
            });
          }
          const stateDiffs = materialize.stateDiffs
            ? sqdEvmStateDiffsFromBlock(this.#source.dataset, block)
            : [];
          for (const item of stateDiffs) {
            await materializeLedgerRecord({
              ...commonRecord,
              item,
              evidenceKind: 'ACCOUNT_STATE',
              factType: 'STATE_DIFF',
              locatorPrefix: 'evm-state-diff',
              summaryNoun: 'state diff',
            });
          }
          const inputs = materialize.inputs
            ? sqdBitcoinInputsFromBlock(this.#source.dataset, block)
            : [];
          for (const item of inputs) {
            await materializeLedgerRecord({
              ...commonRecord,
              item,
              evidenceKind: 'UTXO',
              factType: 'UTXO_INPUT',
              locatorPrefix: 'bitcoin-input',
              summaryNoun: 'input',
            });
          }
          const outputs = materialize.outputs
            ? sqdBitcoinOutputsFromBlock(this.#source.dataset, block)
            : [];
          for (const item of outputs) {
            await materializeLedgerRecord({
              ...commonRecord,
              item,
              evidenceKind: 'UTXO',
              factType: 'UTXO_OUTPUT',
              locatorPrefix: 'bitcoin-output',
              summaryNoun: 'output',
            });
          }
          const instructions = materialize.instructions
            ? sqdSolanaInstructionsFromBlock(this.#source.dataset, block)
            : [];
          for (const item of instructions) {
            await materializeLedgerRecord({
              ...commonRecord,
              item,
              evidenceKind: 'INSTRUCTION',
              factType: 'INSTRUCTION',
              locatorPrefix: 'solana-instruction',
              summaryNoun: 'instruction',
            });
          }
          const balances = materialize.balances
            ? sqdSolanaBalancesFromBlock(this.#source.dataset, block)
            : [];
          for (const item of balances) {
            await materializeLedgerRecord({
              ...commonRecord,
              item,
              evidenceKind: 'ACCOUNT_STATE',
              factType: 'BALANCE',
              locatorPrefix: 'solana-balance',
              summaryNoun: 'balance',
            });
          }
          const tokenBalances = materialize.tokenBalances
            ? sqdSolanaTokenBalancesFromBlock(this.#source.dataset, block)
            : [];
          for (const item of tokenBalances) {
            await materializeLedgerRecord({
              ...commonRecord,
              item,
              evidenceKind: 'ACCOUNT_STATE',
              factType: 'TOKEN_BALANCE',
              locatorPrefix: 'solana-token-balance',
              summaryNoun: 'token balance',
            });
          }
          const rewards = materialize.rewards
            ? sqdSolanaRewardsFromBlock(this.#source.dataset, block)
            : [];
          for (const item of rewards) {
            await materializeLedgerRecord({
              ...commonRecord,
              item,
              evidenceKind: 'ACCOUNT_STATE',
              factType: 'REWARD',
              locatorPrefix: 'solana-reward',
              summaryNoun: 'reward',
            });
          }
          const counts = emptyProcessedCounts();
          counts.transactions = transactions.length;
          counts.logs = logs.length;
          counts.inputs = inputs.length;
          counts.outputs = outputs.length;
          counts.instructions = instructions.length;
          counts.traces = traces.length;
          counts.stateDiffs = stateDiffs.length;
          counts.balances = balances.length;
          counts.tokenBalances = tokenBalances.length;
          counts.rewards = rewards.length;
          if (this.#facts.putMany !== undefined) {
            pendingBlocks.push({
              block,
              snapshot,
              artifact,
              facts: pendingFacts,
              evidence: blockEvidence,
              counts,
            });
            if (pendingBlocks.length >= RAW_FACT_BLOCK_BATCH_SIZE) {
              await flushPendingBlocks();
            }
            return;
          }
          await commitBlock({
            block,
            snapshot,
            artifact,
            facts: blockFacts,
            evidence: blockEvidence,
            counts,
          });
        },
      );
      await flushPendingBlocks();
      await this.#onBeforeFinish?.({ run, resumedFrom, sourceSummary });
      run = await this.#checkpoints.finish(
        run.id,
        sourceSummary.completion,
        sourceSummary.nextBlock,
      );
      return {
        run,
        resumedFrom,
        processedBlocks,
        recordCoverage: recordCoverage(this.#source.dataset, materialize, processedRecords),
        transactionCoverage,
        processedTransactions: materialize.transactions ? processedRecords.transactions : null,
        alreadyTerminal: false,
        sourceSummary,
      };
    } catch (error) {
      try {
        await this.#checkpoints.recordFailure(run.id, safeErrorCode(error));
      } catch {
        // Preserve the original ingestion failure; checkpoint health reports the secondary failure.
      }
      if (error instanceof IngestionPipelineError) throw error;
      throw new IngestionPipelineError('INGESTION_FAILED', 'Finalized ingestion failed.', {
        retryable: retryableFrom(error),
        cause: error,
      });
    }
  }
}

export function sqdIngestionQueryHash(
  dataset: SqdDataset,
  request: SqdFinalizedRangeRequest,
): string {
  return hashPayload(sqdIngestionQuery(dataset, request));
}
