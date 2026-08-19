import {
  EvmLedgerAdapter,
  FailoverJsonRpcTransport,
  QuorumJsonRpcTransport,
  SafeJsonRpcTransport,
  SqdEvmContractCreationReader,
  SqdPortalClient,
  sqdEvmLogsFromBlock,
  sqdTransactionsFromBlock,
  sqdEvmTracesFromBlock,
  type JsonRpcTransport,
} from '@zerotrace/chain-adapters';
import {
  CaptureExecutionError,
  type CaptureRun,
  type CaptureHandler,
} from '@zerotrace/capture-scheduler';
import {
  buildForensicCampaignAlerts,
  buildProviderBackedControlCampaign,
} from '@zerotrace/campaign-engine';
import { EvidenceLedger, createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  buildFundingSettlementFromTokenHistory,
  createEvmAssetTransferObservation,
} from '@zerotrace/funding-settlement-engine';
import { TokenHistoryDiscovery, type SqdFinalizedSource } from '@zerotrace/ingestion';
import {
  CaptureRunSuccessSchema,
  JsonValueSchema,
  TokenLiveCaptureParametersSchema,
  TokenHistoryBackfillParametersSchema,
  type EvmAssetTransferObservation,
  type TokenLiveCaptureParameters,
  type CaptureRunSuccess,
  type Evidence,
  type RawChainFact,
  type TokenHistoryBackfillParameters,
} from '@zerotrace/schemas';
import type {
  PostgresActionSemanticsReportRepository,
  PostgresControlCampaignReportRepository,
  PostgresCaptureScheduleRepository,
  PostgresEvidenceRepository,
  PostgresForensicCampaignAlertRepository,
  PostgresFundingSettlementReportRepository,
  PostgresIngestionCheckpointRepository,
  PostgresTokenHistoryDiscoveryReportRepository,
  ClickHouseRawFactRepository,
  RawArtifactStore,
} from '@zerotrace/storage';
import { createRawChainFact } from '@zerotrace/storage';

import type { TokenHistoryBackfillWorkerConfig } from './token-history-backfill-config.js';
import { providerPolicy } from './worker.js';

export interface TokenHistoryBackfillHandlerResources {
  facts: ClickHouseRawFactRepository;
  checkpoints: PostgresIngestionCheckpointRepository;
  artifacts: RawArtifactStore;
  evidence: PostgresEvidenceRepository;
  actionSemantics: PostgresActionSemanticsReportRepository;
  reports: PostgresTokenHistoryDiscoveryReportRepository;
  funding: PostgresFundingSettlementReportRepository;
  campaigns: PostgresControlCampaignReportRepository;
  schedules: PostgresCaptureScheduleRepository;
  alerts: PostgresForensicCampaignAlertRepository;
}

function asRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;
  const value = error as { retryable?: unknown; sourceRetryable?: unknown };
  if (typeof value.sourceRetryable === 'boolean') return value.sourceRetryable;
  if (typeof value.retryable === 'boolean') return value.retryable;
  return true;
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'TOKEN_HISTORY_BACKFILL_FAILED';
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' && value.trim() !== ''
    ? value.slice(0, 160)
    : 'TOKEN_HISTORY_BACKFILL_FAILED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Token History backfill failed.';
}

function rangeNumber(parameters: TokenHistoryBackfillParameters): {
  fromBlock: number;
  toBlock: number;
} {
  const from = BigInt(parameters.fromBlock);
  const to = BigInt(parameters.toBlock);
  if (
    from > BigInt(Number.MAX_SAFE_INTEGER) ||
    to > BigInt(Number.MAX_SAFE_INTEGER) ||
    to < from ||
    to - from + 1n > 1_000_000n
  ) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_RANGE_INVALID',
      'Token History backfill range exceeds the worker safety bound.',
      false,
    );
  }
  return { fromBlock: Number(from), toBlock: Number(to) };
}

function chainForDataset(dataset: TokenHistoryBackfillParameters['dataset']): {
  chainId: number;
  chainName: string;
} {
  return dataset === 'ethereum-mainnet'
    ? { chainId: 1, chainName: 'Ethereum Mainnet' }
    : { chainId: 56, chainName: 'BNB Smart Chain' };
}

function transportFor(
  urls: readonly string[],
  endpointPrefix: string,
  config: TokenHistoryBackfillWorkerConfig,
  requestsPerSecond: number,
): JsonRpcTransport {
  const transports = urls.map(
    (url, index) =>
      new SafeJsonRpcTransport({
        endpointId: `${endpointPrefix}@${new URL(url).hostname.toLowerCase()}${
          urls.length === 1 ? '' : `#${index + 1}`
        }`,
        baseUrl: url,
        policy: providerPolicy(config.providerAllowedHosts, config.allowPrivateProviderUrls),
        timeoutMs: config.requestTimeoutMs,
        resilience: {
          maxAttempts: config.maxAttempts,
          retryBaseDelayMs: config.retryBaseDelayMs,
          retryMaxDelayMs: config.retryMaxDelayMs,
          requestsPerSecond,
        },
      }),
  );
  const first = transports[0];
  if (first === undefined) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_RPC_UNCONFIGURED',
      `No read-only RPC endpoint is configured for ${endpointPrefix}.`,
      false,
    );
  }
  if (config.requireIndependentRpc === true) {
    if (transports.length < 2) {
      throw new CaptureExecutionError(
        'TOKEN_HISTORY_BACKFILL_INDEPENDENT_RPC_REQUIRED',
        `At least two ${endpointPrefix} endpoints are required for independent Token History reads.`,
        false,
      );
    }
    return new QuorumJsonRpcTransport(`${endpointPrefix}:independent`, transports);
  }
  return transports.length === 1 ? first : new FailoverJsonRpcTransport(endpointPrefix, transports);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function latestEvidenceObservedAt(ledger: EvidenceLedger, fallback: string): string {
  const timestamps = ledger
    .values()
    .map((node) => Date.parse(node.evidence.observedAt))
    .filter((value) => Number.isFinite(value));
  const latest = Math.max(Date.parse(fallback), ...timestamps);
  return new Date(latest).toISOString();
}

async function loadFacts(
  resources: TokenHistoryBackfillHandlerResources,
  chainId: string,
  fromBlock: number,
  toBlock: number,
  maximum: number,
): Promise<RawChainFact[]> {
  const pageSize = 10_000;
  const facts: RawChainFact[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await resources.facts.listRange({
      ledger: 'EVM',
      chainId,
      fromBlock,
      toBlock,
      limit: pageSize,
      offset,
    });
    facts.push(...page);
    if (facts.length > maximum) {
      throw new CaptureExecutionError(
        'TOKEN_HISTORY_BACKFILL_FACT_LIMIT',
        `Raw Fact range exceeded the configured ${maximum}-row safety bound.`,
        false,
      );
    }
    if (page.length < pageSize) return facts;
  }
}

const MAX_CANDIDATE_EXPANSION_WALLETS = 128;
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

interface CandidateExpansionResult {
  transfers: readonly EvmAssetTransferObservation[];
  historyCoverage: number;
  coverageScope: 'BOUNDED_RANGE' | 'RANGE_COMPLETE' | 'TRANSACTION_LOCAL';
  sourceSet: readonly string[];
  evidenceIds: readonly string[];
}

function isEvmAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function indexedAddressTopic(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function transferTopicAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
      `SQD candidate expansion ${field} is not a padded EVM address topic.`,
      false,
    );
  }
  return `0x${value.slice(-40).toLowerCase()}`;
}

function transferAmount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
      'SQD candidate expansion Transfer data is not one 32-byte hexadecimal amount.',
      false,
    );
  }
  return BigInt(value);
}

function transactionStatus(value: unknown): 'SUCCESS' | 'FAILED' | 'UNKNOWN' {
  if (value === 1 || value === '0x1' || value === '1') return 'SUCCESS';
  if (value === 0 || value === '0x0' || value === '0') return 'FAILED';
  return 'UNKNOWN';
}

function hexQuantity(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
      `SQD candidate expansion ${field} is not a canonical hexadecimal quantity.`,
      false,
    );
  }
  return BigInt(value);
}

function optionalHexQuantity(value: unknown, field: string): bigint | undefined {
  // SQD exposes callValue as an optional trace action field. A successful call may therefore
  // carry a null/absent value even though its from/to addresses and TRACE Evidence are valid.
  // Preserve that Evidence but do not invent a native transfer amount.
  if (value === null || value === undefined) return undefined;
  return hexQuantity(value, field);
}

function transactionIndex(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value).toString();
  throw new CaptureExecutionError(
    'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
    'SQD candidate expansion transactionIndex is invalid.',
    false,
  );
}

function transactionIndexNumber(value: unknown, subject: string): number {
  const normalized = transactionIndex(value);
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric)) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
      `SQD candidate expansion ${subject} transactionIndex exceeds the safe integer range.`,
      false,
    );
  }
  return numeric;
}

/**
 * Expands only the already selected candidate wallets over the requested finalized range. This
 * keeps the historical query bounded and gives Funding/Settlement a provider-backed native
 * transfer set without turning the entire chain into a raw transaction scan.
 */
export async function captureCandidateNativeTransfers(input: {
  source: Pick<SqdFinalizedSource, 'dataset' | 'readFinalizedRange'>;
  adapter: EvmLedgerAdapter;
  report: Awaited<ReturnType<TokenHistoryDiscovery['run']>>['report'];
  focusWalletIds: readonly string[];
  fromBlock: number;
  toBlock: number;
  artifacts: RawArtifactStore;
  evidence: PostgresEvidenceRepository;
  facts: ClickHouseRawFactRepository;
  maxRecords: number;
  signal?: AbortSignal;
}): Promise<CandidateExpansionResult> {
  const wallets = [...new Set(input.focusWalletIds.map((wallet) => wallet.toLowerCase()))].sort();
  if (wallets.length === 0) {
    return {
      transfers: [],
      historyCoverage: 0,
      coverageScope: 'TRANSACTION_LOCAL',
      sourceSet: [],
      evidenceIds: [],
    };
  }
  if (wallets.length > MAX_CANDIDATE_EXPANSION_WALLETS) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EXPANSION_WALLET_LIMIT',
      `Candidate expansion received ${wallets.length} wallets; the bounded limit is ${MAX_CANDIDATE_EXPANSION_WALLETS}.`,
      false,
    );
  }
  const sourceId = `sqd:${input.source.dataset}`;
  const transfers: EvmAssetTransferObservation[] = [];
  const facts: RawChainFact[] = [];
  const seenTransactions = new Set<string>();
  const seenLogs = new Set<string>();
  const seenTraces = new Set<string>();
  if (!wallets.every(isEvmAddress)) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_WALLET',
      'Candidate expansion received a non-EVM focus wallet.',
      false,
    );
  }
  const walletTopics = wallets.map(indexedAddressTopic);
  const summary = await input.source.readFinalizedRange(
    {
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
      includeAllBlocks: false,
      fields: {
        block: { timestamp: true },
        transaction: {
          hash: true,
          from: true,
          to: true,
          value: true,
          transactionIndex: true,
          status: true,
        },
        log: {
          logIndex: true,
          transactionIndex: true,
          transactionHash: true,
          address: true,
          topics: true,
          data: true,
        },
        trace: {
          transactionIndex: true,
          traceAddress: true,
          type: true,
          callFrom: true,
          callTo: true,
          callValue: true,
          error: true,
        },
      },
      requests: {
        transactions: [{ from: wallets }, { to: wallets }],
        logs: [
          { topic0: [ERC20_TRANSFER_TOPIC], topic1: walletTopics },
          { topic0: [ERC20_TRANSFER_TOPIC], topic2: walletTopics },
        ],
        traces: [
          { callFrom: wallets, transaction: true },
          { callTo: wallets, transaction: true },
        ],
      },
    },
    async (block) => {
      if (input.signal?.aborted === true) {
        throw new CaptureExecutionError(
          'TOKEN_HISTORY_BACKFILL_ABORTED',
          'Candidate expansion was aborted.',
          true,
        );
      }
      const snapshotResult = await input.adapter.readAnchorAt(String(block.header.number));
      if (snapshotResult.snapshot.ledger !== 'EVM') {
        throw new CaptureExecutionError(
          'TOKEN_HISTORY_BACKFILL_EXPANSION_SNAPSHOT_INVALID',
          'Candidate expansion exact anchor is not an EVM Snapshot.',
          false,
        );
      }
      if (
        snapshotResult.snapshot.blockHash.toLowerCase() !== block.header.hash.toLowerCase() ||
        snapshotResult.snapshot.blockNumber !== String(block.header.number)
      ) {
        throw new CaptureExecutionError(
          'TOKEN_HISTORY_BACKFILL_EXPANSION_SNAPSHOT_MISMATCH',
          `SQD candidate expansion block ${block.header.number} does not match the exact RPC Snapshot.`,
          true,
        );
      }
      // Keep the Evidence/Snapshot identity stable when a retry replays the same immutable
      // candidate expansion. The chain position/hash remains exact; only the capture timestamp
      // is bound to the durable Token History report.
      const snapshot = {
        ...snapshotResult.snapshot,
        capturedAt: input.report.freshness,
      };
      const payload = JsonValueSchema.parse(block);
      const artifact = await input.artifacts.put({
        ledger: 'EVM',
        chainId: input.report.chainId,
        blockOrSlot: String(block.header.number),
        provider: sourceId,
        capturedAt: input.report.freshness,
        payload,
      });
      const transactions = sqdTransactionsFromBlock(input.source.dataset, block);
      const transactionsByIndex = new Map<number, (typeof transactions)[number]>();
      for (const transaction of transactions) {
        if (seenTransactions.has(transaction.identity)) continue;
        seenTransactions.add(transaction.identity);
        if (facts.length >= input.maxRecords) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_FACT_LIMIT',
            `Candidate expansion exceeded the configured ${input.maxRecords}-record safety bound.`,
            false,
          );
        }
        const transactionPayload = JsonValueSchema.parse(transaction.payload);
        const evidence = createEvidence({
          ledger: 'EVM',
          chainId: input.report.chainId,
          kind: 'TRANSACTION',
          source: sourceId,
          locator: `token-history-candidate-transaction:${transaction.identity}`,
          payload: transactionPayload,
          observedAt: input.report.freshness,
          blockOrSlot: String(block.header.number),
          finality: 'finalized',
          rawArtifactRef: artifact.ref,
          summary: `SQD finalized candidate-scoped transaction ${transaction.identity}.`,
        });
        await input.evidence.put(evidence, [], snapshot);
        const fact = createRawChainFact({
          ledger: 'EVM',
          chainId: input.report.chainId,
          blockOrSlot: String(block.header.number),
          blockHash: block.header.hash,
          factType: 'TRANSACTION',
          subject: transaction.identity,
          provider: sourceId,
          finality: 'finalized',
          payload: transactionPayload,
          evidenceId: evidence.id,
          rawArtifactRef: artifact.ref,
          observedAt: input.report.freshness,
        });
        facts.push(fact);

        const from = transaction.payload.from;
        const to = transaction.payload.to;
        if (!isEvmAddress(from) || (to !== null && !isEvmAddress(to))) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
            `SQD candidate expansion transaction ${transaction.identity} has an invalid address field.`,
            false,
          );
        }
        if (to === null || transactionStatus(transaction.payload.status) !== 'SUCCESS') continue;
        const amount = hexQuantity(transaction.payload.value, 'transaction value');
        if (amount === 0n) continue;
        transfers.push(
          createEvmAssetTransferObservation({
            chainId: input.report.chainId,
            asset: 'NATIVE',
            source: from,
            destination: to,
            amountAtomic: amount.toString(),
            blockNumber: String(block.header.number),
            blockHash: block.header.hash,
            transactionHash: transaction.identity,
            transactionIndex: transactionIndex(transaction.payload.transactionIndex),
            observedAt: snapshot.blockTimestamp ?? input.report.freshness,
            execution: 'SUCCESS',
            finality: 'FINAL',
            evidenceIds: [evidence.id],
            rawArtifactRef: artifact.ref,
          }),
        );
      }

      // Trace filters with transaction:true return the parent transaction alongside the trace.
      // Keep that relationship explicit so a successful internal call can become a native
      // transfer observation without guessing its transaction hash or status.
      for (const transaction of transactions) {
        const index = transactionIndexNumber(
          transaction.payload.transactionIndex,
          'parent transaction',
        );
        if (transactionsByIndex.has(index)) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
            `SQD candidate expansion returned duplicate parent transaction index ${index}.`,
            false,
          );
        }
        transactionsByIndex.set(index, transaction);
      }
      for (const log of sqdEvmLogsFromBlock(input.source.dataset, block)) {
        if (seenLogs.has(log.identity)) continue;
        seenLogs.add(log.identity);
        if (facts.length >= input.maxRecords) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_FACT_LIMIT',
            `Candidate expansion exceeded the configured ${input.maxRecords}-record safety bound.`,
            false,
          );
        }
        const logPayload = JsonValueSchema.parse(log.payload);
        const logTopics = log.payload.topics;
        const hasTransferTopic =
          Array.isArray(logTopics) &&
          typeof logTopics[0] === 'string' &&
          logTopics[0].toLowerCase() === ERC20_TRANSFER_TOPIC;
        if (!hasTransferTopic) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
            `SQD candidate expansion log ${log.identity} does not match the requested Transfer topic.`,
            false,
          );
        }
        const isCanonicalTransfer = logTopics.length === 3;
        const logIndex = transactionIndexNumber(log.payload.logIndex, 'log');
        const parentIndex = transactionIndexNumber(log.payload.transactionIndex, 'log');
        if (typeof log.payload.transactionHash !== 'string') {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
            `SQD candidate expansion log ${log.identity} has no transaction hash.`,
            false,
          );
        }
        const transactionHash = log.payload.transactionHash;
        const parent = transactionsByIndex.get(parentIndex);
        if (
          parent !== undefined &&
          transactionHash.toLowerCase() !== parent.identity.toLowerCase()
        ) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
            `SQD candidate expansion log ${log.identity} disagrees with its parent transaction.`,
            false,
          );
        }
        if (!isEvmAddress(log.payload.address)) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
            `SQD candidate expansion log ${log.identity} has an invalid asset address.`,
            false,
          );
        }
        const logEvidence = createEvidence({
          ledger: 'EVM',
          chainId: input.report.chainId,
          kind: 'LOG',
          source: sourceId,
          locator: `token-history-candidate-log:${log.identity}`,
          payload: logPayload,
          observedAt: input.report.freshness,
          blockOrSlot: String(block.header.number),
          finality: 'finalized',
          rawArtifactRef: artifact.ref,
          summary: `SQD finalized candidate-scoped ERC-20 Transfer log ${log.identity}.`,
        });
        await input.evidence.put(logEvidence, [], snapshot);
        facts.push(
          createRawChainFact({
            ledger: 'EVM',
            chainId: input.report.chainId,
            blockOrSlot: String(block.header.number),
            blockHash: block.header.hash,
            factType: 'LOG',
            subject: log.identity,
            provider: sourceId,
            finality: 'finalized',
            payload: logPayload,
            evidenceId: logEvidence.id,
            rawArtifactRef: artifact.ref,
            observedAt: input.report.freshness,
          }),
        );
        // A topic-0 Transfer log with extra indexed topics is a valid EVM log but not the
        // canonical ERC-20 Transfer(address,address,uint256) shape. Keep its raw Evidence for
        // replay and skip only the unsupported derived transfer.
        if (!isCanonicalTransfer) continue;
        // SQD log filters return the log's transactionHash/transactionIndex, but do not include
        // the parent transaction unless a matching transaction filter selected it as well. A
        // canonical EVM log is already post-execution evidence; when the parent is present,
        // still cross-check its status and hash before accepting the derived transfer.
        if (parent !== undefined && transactionStatus(parent.payload.status) !== 'SUCCESS') {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
            `SQD candidate expansion log ${log.identity} has a non-successful parent transaction.`,
            false,
          );
        }
        const amount = transferAmount(log.payload.data);
        if (amount === 0n) continue;
        transfers.push(
          createEvmAssetTransferObservation({
            chainId: input.report.chainId,
            asset: log.payload.address,
            source: transferTopicAddress(logTopics[1], 'Transfer source'),
            destination: transferTopicAddress(logTopics[2], 'Transfer destination'),
            amountAtomic: amount.toString(),
            blockNumber: String(block.header.number),
            blockHash: block.header.hash,
            transactionHash,
            transactionIndex: String(parentIndex),
            eventIndex: String(logIndex),
            observedAt: snapshot.blockTimestamp ?? input.report.freshness,
            execution: 'SUCCESS',
            finality: 'FINAL',
            evidenceIds: [logEvidence.id],
            rawArtifactRef: artifact.ref,
          }),
        );
      }
      for (const trace of sqdEvmTracesFromBlock(input.source.dataset, block)) {
        if (seenTraces.has(trace.identity)) continue;
        seenTraces.add(trace.identity);
        if (facts.length >= input.maxRecords) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_FACT_LIMIT',
            `Candidate expansion exceeded the configured ${input.maxRecords}-record safety bound.`,
            false,
          );
        }
        const parentIndex = transactionIndexNumber(trace.payload.transactionIndex, 'trace');
        const parent = transactionsByIndex.get(parentIndex);
        if (parent === undefined) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
            `SQD candidate expansion trace ${trace.identity} is missing its parent transaction.`,
            false,
          );
        }
        const tracePayload = JsonValueSchema.parse(trace.payload);
        const traceEvidence = createEvidence({
          ledger: 'EVM',
          chainId: input.report.chainId,
          kind: 'TRACE',
          source: sourceId,
          locator: `token-history-candidate-trace:${trace.identity}`,
          payload: tracePayload,
          observedAt: input.report.freshness,
          blockOrSlot: String(block.header.number),
          finality: 'finalized',
          rawArtifactRef: artifact.ref,
          summary: `SQD finalized candidate-scoped trace ${trace.identity}.`,
        });
        await input.evidence.put(traceEvidence, [], snapshot);
        facts.push(
          createRawChainFact({
            ledger: 'EVM',
            chainId: input.report.chainId,
            blockOrSlot: String(block.header.number),
            blockHash: block.header.hash,
            factType: 'TRACE',
            subject: trace.identity,
            provider: sourceId,
            finality: 'finalized',
            payload: tracePayload,
            evidenceId: traceEvidence.id,
            rawArtifactRef: artifact.ref,
            observedAt: input.report.freshness,
          }),
        );

        if (
          trace.payload.type !== 'call' ||
          transactionStatus(parent.payload.status) !== 'SUCCESS' ||
          (trace.payload.error !== undefined && trace.payload.error !== null)
        ) {
          continue;
        }
        const rawAction = trace.payload.action;
        const action =
          typeof rawAction === 'object' && rawAction !== null && !Array.isArray(rawAction)
            ? rawAction
            : {
                from: trace.payload.callFrom,
                to: trace.payload.callTo,
                value: trace.payload.callValue,
              };
        const from = action.from;
        const to = action.to;
        if (!isEvmAddress(from) || !isEvmAddress(to)) {
          throw new CaptureExecutionError(
            'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
            `SQD candidate expansion trace ${trace.identity} has an invalid call address.`,
            false,
          );
        }
        const amount = optionalHexQuantity(action.value, 'trace value');
        if (amount === undefined || amount === 0n) continue;
        transfers.push(
          createEvmAssetTransferObservation({
            chainId: input.report.chainId,
            asset: 'NATIVE',
            source: from,
            destination: to,
            amountAtomic: amount.toString(),
            blockNumber: String(block.header.number),
            blockHash: block.header.hash,
            transactionHash: parent.identity,
            transactionIndex: String(parentIndex),
            observedAt: snapshot.blockTimestamp ?? input.report.freshness,
            execution: 'SUCCESS',
            finality: 'FINAL',
            evidenceIds: [traceEvidence.id],
            rawArtifactRef: artifact.ref,
          }),
        );
      }
    },
  );
  if (facts.length > 0) {
    if (input.facts.putMany === undefined) {
      for (const fact of facts) await input.facts.put(fact);
    } else {
      const stored = await input.facts.putMany(facts);
      if (
        stored.length !== facts.length ||
        stored.some((fact, index) => fact.id !== facts[index]?.id)
      ) {
        throw new CaptureExecutionError(
          'TOKEN_HISTORY_BACKFILL_EXPANSION_FACT_CONFLICT',
          'Candidate expansion Raw Fact writer returned a conflicting result.',
          false,
        );
      }
    }
  }
  const complete = summary.completion === 'REQUESTED_RANGE_COMPLETE';
  const historyCoverage = complete ? input.report.historyCoverage : 0;
  return {
    transfers,
    historyCoverage,
    coverageScope: complete ? 'BOUNDED_RANGE' : 'TRANSACTION_LOCAL',
    sourceSet: [sourceId],
    evidenceIds: sortedUnique(facts.map((fact) => fact.evidenceId)),
  };
}

async function hydrateEvidence(
  ledger: EvidenceLedger,
  repository: PostgresEvidenceRepository,
  id: string,
  visiting = new Set<string>(),
): Promise<void> {
  if (ledger.get(id) !== undefined) return;
  if (visiting.has(id)) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EVIDENCE_CYCLE',
      `Evidence source cycle detected at ${id}.`,
      false,
    );
  }
  visiting.add(id);
  const node = await repository.get(id);
  if (node === undefined) {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_EVIDENCE_MISSING',
      `Required Evidence ${id} is not available in durable storage.`,
      false,
    );
  }
  for (const sourceId of node.sourceEvidenceIds) {
    await hydrateEvidence(ledger, repository, sourceId, visiting);
  }
  ledger.add(node.evidence, node.sourceEvidenceIds, node.snapshot);
  visiting.delete(id);
}

async function persistLedger(
  ledger: EvidenceLedger,
  repository: PostgresEvidenceRepository,
): Promise<void> {
  for (const node of ledger.values()) {
    await repository.put(node.evidence, node.sourceEvidenceIds, node.snapshot);
  }
}

function terminalEvidence(
  report: Awaited<ReturnType<TokenHistoryDiscovery['run']>>['report'],
  campaignId: string,
  campaignResultHash: string,
  sourceEvidenceIds: readonly string[],
): Evidence {
  const snapshot = report.snapshot;
  if (snapshot.ledger !== 'EVM') {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_SNAPSHOT_INVALID',
      'Token History backfill terminal Snapshot is not EVM.',
      false,
    );
  }
  return createEvidence({
    ledger: 'EVM',
    chainId: report.chainId,
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:token-history-backfill-v1.0.0',
    locator: `token-history-backfill:${campaignId}`,
    payload: {
      schemaVersion: 'token-history-backfill-capture-result-v1',
      reportId: report.id,
      reportResultHash: report.resultHash,
      campaignId,
      campaignResultHash,
      fromBlock: report.fromBlock,
      toBlock: report.toBlock,
      status: report.status,
    },
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    observedAt: snapshot.capturedAt,
    summary: 'Token History backfill and provider-backed Control Campaign completed.',
    sourceEvidenceIds,
  });
}

function emptyRangeTerminalEvidence(
  report: Awaited<ReturnType<TokenHistoryDiscovery['run']>>['report'],
  fromBlock: number,
  toBlock: number,
): Evidence {
  const snapshot = report.snapshot;
  if (snapshot.ledger !== 'EVM') {
    throw new CaptureExecutionError(
      'TOKEN_HISTORY_BACKFILL_SNAPSHOT_INVALID',
      'Token History empty-range terminal Snapshot is not EVM.',
      false,
    );
  }
  return createEvidence({
    ledger: 'EVM',
    chainId: report.chainId,
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:token-history-backfill-v1.0.0',
    locator: `token-history-backfill:empty-range:${report.id}`,
    payload: {
      schemaVersion: 'token-history-empty-range-v1',
      reportId: report.id,
      reportResultHash: report.resultHash,
      token: report.token,
      fromBlock: String(fromBlock),
      toBlock: String(toBlock),
      observationCount: report.observations.length,
      state: 'NO_TOKEN_FLOW_OBSERVATIONS',
      dataCoverage: report.dataCoverage,
      sourceCoverage: report.sourceCoverage,
      historyCoverage: report.historyCoverage,
    },
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    observedAt: snapshot.capturedAt,
    summary: 'Finalized Token History range completed with no exact token-flow observations.',
    sourceEvidenceIds: report.evidenceIds,
  });
}

interface TokenHistoryBackfillHandlerOptions {
  allowEmptyCapture?: boolean;
}

export function createTokenHistoryBackfillHandler(
  config: TokenHistoryBackfillWorkerConfig,
  resources: TokenHistoryBackfillHandlerResources,
  options: TokenHistoryBackfillHandlerOptions = {},
): CaptureHandler {
  return async (run: CaptureRun, signal?: AbortSignal): Promise<CaptureRunSuccess> => {
    if (signal?.aborted === true) {
      throw new CaptureExecutionError(
        'TOKEN_HISTORY_BACKFILL_ABORTED',
        'Capture was aborted.',
        true,
      );
    }
    let parameters: TokenHistoryBackfillParameters;
    try {
      parameters = TokenHistoryBackfillParametersSchema.parse(run.parameters);
    } catch (error) {
      throw new CaptureExecutionError(
        'TOKEN_HISTORY_BACKFILL_INVALID_PARAMETERS',
        'Capture parameters are not a valid Token History backfill request.',
        false,
        error,
      );
    }
    // The schedule schema accepts checksum/mixed-case EVM input, while all durable report and
    // range identities are canonical lowercase addresses. Normalize once at the handler
    // boundary so a mixed-case retry cannot fail later in the Funding/Settlement repository.
    const token = parameters.token.toLowerCase();
    const chain = chainForDataset(parameters.dataset);
    const expectedChainId = `eip155:${chain.chainId}`;
    if (
      run.captureKind !== 'TOKEN_HISTORY_BACKFILL' ||
      run.target.ledger !== 'EVM' ||
      run.target.chainId !== expectedChainId ||
      run.target.subjectType !== 'TOKEN' ||
      run.target.normalizedIdentifier !== token
    ) {
      throw new CaptureExecutionError(
        'TOKEN_HISTORY_BACKFILL_TARGET_MISMATCH',
        'Capture target does not match its immutable Token History parameters.',
        false,
      );
    }
    const { fromBlock, toBlock } = rangeNumber(parameters);
    const rpcUrls =
      parameters.dataset === 'ethereum-mainnet' ? config.ethereumRpcUrls : config.bscRpcUrls;
    const rpc = transportFor(
      rpcUrls,
      parameters.dataset === 'ethereum-mainnet' ? 'ethereum-rpc' : 'bsc-rpc',
      config,
      parameters.dataset === 'ethereum-mainnet'
        ? config.ethereumRequestsPerSecond
        : config.bscRequestsPerSecond,
    );
    const adapter = new EvmLedgerAdapter(
      {
        id: parameters.dataset === 'ethereum-mainnet' ? 'ethereum-rpc' : 'bsc-rpc',
        chainId: chain.chainId,
        chainName: chain.chainName,
        snapshotBlockTag: 'finalized',
      },
      rpc,
    );
    const source = new SqdPortalClient({
      portalUrl: config.sqdPortalUrl,
      dataset: parameters.dataset,
      policy: providerPolicy(config.sqdAllowedHosts, config.allowPrivateProviderUrls),
      timeoutMs: config.requestTimeoutMs,
      maxRangeBlocks: 1_000_000,
      maxAttempts: config.maxAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
      retryMaxDelayMs: config.retryMaxDelayMs,
      requestsPerSecond: config.sqdRequestsPerSecond,
    });
    const discovery = new TokenHistoryDiscovery({
      source,
      token,
      fromBlock,
      toBlock,
      exactReader: adapter,
      originReader: new SqdEvmContractCreationReader({
        source,
        maxRangeBlocks: 1_000_000,
        maxResults: 16,
      }),
      checkpoints: resources.checkpoints,
      artifacts: resources.artifacts,
      evidence: resources.evidence,
      facts: resources.facts,
      factReader: resources.facts,
      evidenceReader: resources.evidence,
      reportStore: resources.reports,
      actionSemantics: resources.actionSemantics,
      checkpointBatchSize: config.checkpointBatchSize,
      // A terminal SQD checkpoint can still carry an immutable report whose exact RPC bindings
      // were unavailable on an earlier capture attempt. Keep each capture attempt's recovery
      // revision separate so retries may rebind exact Evidence without mutating that report.
      // The capture result includes provider-level quorum attestations. Keep a deployment
      // revision in the durable report identity so a retry cannot replay an older report that
      // predates those attestations and then fail the capture provenance guard at completion.
      recoveryRevision: `capture-attempt:${run.id}:${run.attempt}:capture-source-provenance-v3`,
    });
    try {
      const result = await discovery.run();
      if (signal !== undefined && signal.aborted) {
        throw new CaptureExecutionError(
          'TOKEN_HISTORY_BACKFILL_ABORTED',
          'Capture was aborted.',
          true,
        );
      }
      const report = result.report;
      const facts = await loadFacts(
        resources,
        expectedChainId,
        fromBlock,
        toBlock,
        config.maxFactRows,
      );
      if (options.allowEmptyCapture && report.observations.length === 0) {
        const terminal = emptyRangeTerminalEvidence(report, fromBlock, toBlock);
        await resources.evidence.put(terminal, report.evidenceIds, report.snapshot);
        const evidenceIds = sortedUnique([...report.evidenceIds, terminal.id]);
        return CaptureRunSuccessSchema.parse({
          resultRef: `token-history-empty-range:${report.id}#sha256=${report.resultHash}`,
          snapshot: report.snapshot,
          terminalEvidenceId: terminal.id,
          evidenceIds,
          sourceSet: report.sourceSet,
          modelVersion: 'token-history-backfill-capture-v1.0.0',
          coverage: report.dataCoverage,
          freshness: report.freshness,
          confidence: report.dataCoverage,
        });
      }
      const ledger = new EvidenceLedger();
      for (const id of report.evidenceIds) await hydrateEvidence(ledger, resources.evidence, id);
      // A retry may reach this handler after Funding/Settlement was durably written but before
      // Campaign completion. Re-running the provider expansion can produce a different exact-RPC
      // observation set (for example, a public endpoint may temporarily return an unknown
      // receipt), so TokenHistoryDiscovery keeps each exact-recovery revision immutable. Once a
      // revision has all exact bindings, the durable child report remains provider-free on the
      // rest of the retry path.
      let fundingReport = await resources.funding.forRange(
        expectedChainId,
        token,
        String(fromBlock),
        String(toBlock),
      );
      if (fundingReport === undefined) {
        const fundingResult = await buildFundingSettlementFromTokenHistory({
          report,
          facts,
          exactReader: adapter,
          token,
          fromBlock,
          toBlock,
          probeHistoricalCode: true,
          historicalExpansion: async ({ focusWalletIds }) =>
            captureCandidateNativeTransfers({
              source,
              adapter,
              report,
              focusWalletIds,
              fromBlock,
              toBlock,
              artifacts: resources.artifacts,
              evidence: resources.evidence,
              facts: resources.facts,
              maxRecords: config.maxFactRows,
              ...(signal === undefined ? {} : { signal }),
            }),
        });
        // Candidate-scoped transactions/traces are still part of the durable capture Evidence
        // closure when they do not yield a non-zero native transfer. Keeping them attached makes
        // a negative bounded observation replayable instead of leaving orphan Raw Facts behind.
        for (const id of fundingResult.historicalEvidenceIds) {
          await hydrateEvidence(ledger, resources.evidence, id);
        }
        fundingReport =
          fundingResult.status === 'DERIVED'
            ? await resources.funding.put(fundingResult.report)
            : undefined;
      }
      if (fundingReport !== undefined) {
        for (const id of fundingReport.evidenceIds) {
          await hydrateEvidence(ledger, resources.evidence, id);
        }
      }
      const reconstruction = buildProviderBackedControlCampaign({
        history: report,
        ...(fundingReport === undefined ? {} : { fundingSettlement: fundingReport }),
        evidenceLedger: ledger,
        maxStageSnapshots: 8,
      });
      await persistLedger(ledger, resources.evidence);
      const campaign = await resources.campaigns.put(reconstruction.bundle);
      for (const alert of buildForensicCampaignAlerts(campaign.bundle)) {
        await resources.alerts.put(alert);
      }
      const captureSourceEvidenceIds = ledger
        .values()
        .map((node) => node.evidence.id)
        .sort();
      const terminal = terminalEvidence(
        report,
        campaign.id,
        campaign.resultHash,
        captureSourceEvidenceIds,
      );
      ledger.add(terminal, captureSourceEvidenceIds, report.snapshot);
      await resources.evidence.put(terminal, captureSourceEvidenceIds, report.snapshot);
      const evidenceIds = ledger
        .values()
        .map((node) => node.evidence.id)
        .sort();
      const sourceSet = sortedUnique([
        ...report.sourceSet,
        ...ledger
          .values()
          .filter(
            (node) =>
              !['DERIVED_FEATURE', 'NEGATIVE_EVIDENCE', 'ANALYST_OBSERVATION'].includes(
                node.evidence.kind,
              ),
          )
          .map((node) => node.evidence.source),
      ]);
      const freshness = latestEvidenceObservedAt(ledger, report.snapshot.capturedAt);
      const coverage = Math.min(
        report.dataCoverage,
        report.sourceCoverage,
        report.historyCoverage,
        campaign.bundle.campaign.metadata.dataCoverage,
        campaign.bundle.campaign.metadata.sourceCoverage,
        campaign.bundle.campaign.metadata.historyCoverage,
      );
      return CaptureRunSuccessSchema.parse({
        resultRef: `control-campaign:${campaign.id}#sha256=${campaign.resultHash}`,
        snapshot: report.snapshot,
        terminalEvidenceId: terminal.id,
        evidenceIds,
        sourceSet,
        modelVersion: 'token-history-backfill-capture-v1.0.0',
        coverage,
        freshness,
        // This is capture completeness, not a calibrated probability for the inferred campaign.
        confidence: coverage,
      });
    } catch (error) {
      if (error instanceof CaptureExecutionError) throw error;
      throw new CaptureExecutionError(
        errorCode(error),
        errorMessage(error),
        asRetryable(error),
        error,
      );
    }
  };
}

function previousSuccessfulRunEnd(runs: readonly CaptureRun[]):
  | {
      blockNumber: number;
      blockHash: string;
    }
  | undefined {
  const successful = runs
    .flatMap((run) =>
      run.status === 'SUCCEEDED' && run.result.state === 'known' ? [run.result.value] : [],
    )
    .filter(
      (
        result,
      ): result is CaptureRunSuccess & {
        snapshot: { ledger: 'EVM'; blockNumber: string; blockHash: string };
      } => result.snapshot.ledger === 'EVM',
    )
    .sort((left, right) => {
      const position = BigInt(left.snapshot.blockNumber) - BigInt(right.snapshot.blockNumber);
      return position === 0n ? 0 : position < 0n ? 1 : -1;
    })[0];
  if (successful?.snapshot.ledger !== 'EVM') return undefined;
  const blockNumber = Number(successful.snapshot.blockNumber);
  if (!Number.isSafeInteger(blockNumber)) return undefined;
  return { blockNumber, blockHash: successful.snapshot.blockHash };
}

function liveCaptureProviderEvidence(input: {
  run: CaptureRun;
  parameters: TokenLiveCaptureParameters;
  snapshot: Extract<
    Awaited<ReturnType<EvmLedgerAdapter['readHeadAnchor']>>['snapshot'],
    { ledger: 'EVM' }
  >;
  providerSource: string;
}): ReturnType<typeof createEvidence> {
  return createEvidence({
    ledger: 'EVM',
    chainId: input.snapshot.chainId,
    kind: 'PROVIDER_OBSERVATION',
    source: input.providerSource,
    locator: `token-live-capture:provider:${input.run.scheduleId}:${input.snapshot.blockNumber}:${input.providerSource}`,
    payload: {
      schemaVersion: 'token-live-capture-provider-observation-v1',
      scheduleId: input.run.scheduleId,
      token: input.parameters.token.toLowerCase(),
      finalizedHead: input.snapshot.blockNumber,
      state: 'NO_NEW_FINALIZED_RANGE',
      providerSource: input.providerSource,
    },
    blockOrSlot: input.snapshot.blockNumber,
    finality: input.snapshot.finality,
    observedAt: input.snapshot.capturedAt,
    summary: 'RPC provider contributed the finalized Token Campaign monitor heartbeat.',
  });
}

function liveCaptureEvidence(input: {
  run: CaptureRun;
  parameters: TokenLiveCaptureParameters;
  snapshot: Extract<
    Awaited<ReturnType<EvmLedgerAdapter['readHeadAnchor']>>['snapshot'],
    { ledger: 'EVM' }
  >;
  fromBlock: number;
  sourceSet: readonly string[];
  sourceEvidenceIds: readonly string[];
}): ReturnType<typeof createEvidence> {
  return createEvidence({
    ledger: 'EVM',
    chainId: input.snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:token-live-capture-v1.0.0',
    locator: `token-live-capture:heartbeat:${input.run.scheduleId}:${input.snapshot.blockNumber}`,
    payload: {
      schemaVersion: 'token-live-capture-heartbeat-v1',
      scheduleId: input.run.scheduleId,
      token: input.parameters.token.toLowerCase(),
      fromBlock: String(input.fromBlock),
      finalizedHead: input.snapshot.blockNumber,
      state: 'NO_NEW_FINALIZED_RANGE',
      providerSources: [...input.sourceSet],
    },
    blockOrSlot: input.snapshot.blockNumber,
    finality: input.snapshot.finality,
    observedAt: input.snapshot.capturedAt,
    summary: 'Finalized Token Campaign monitor observed no new range to capture.',
    sourceEvidenceIds: input.sourceEvidenceIds,
  });
}

export function createTokenHistoryLiveCaptureHandler(
  config: TokenHistoryBackfillWorkerConfig,
  resources: TokenHistoryBackfillHandlerResources,
): CaptureHandler {
  const backfill = createTokenHistoryBackfillHandler(config, resources, {
    allowEmptyCapture: true,
  });
  return async (run: CaptureRun, signal?: AbortSignal) => {
    if (run.captureKind !== 'TOKEN_LIVE_CAPTURE') {
      throw new CaptureExecutionError(
        'TOKEN_LIVE_CAPTURE_KIND_INVALID',
        'Capture run is not a Token Live Capture run.',
        false,
      );
    }
    let parameters: TokenLiveCaptureParameters;
    try {
      parameters = TokenLiveCaptureParametersSchema.parse(run.parameters);
    } catch (error) {
      throw new CaptureExecutionError(
        'TOKEN_LIVE_CAPTURE_INVALID_PARAMETERS',
        'Capture parameters are not a valid Token Live Capture request.',
        false,
        error,
      );
    }
    const token = parameters.token.toLowerCase();
    const chain = chainForDataset(parameters.dataset);
    const expectedChainId = `eip155:${chain.chainId}`;
    if (
      run.target.ledger !== 'EVM' ||
      run.target.chainId !== expectedChainId ||
      run.target.subjectType !== 'TOKEN' ||
      run.target.normalizedIdentifier !== token
    ) {
      throw new CaptureExecutionError(
        'TOKEN_LIVE_CAPTURE_TARGET_MISMATCH',
        'Live monitor target does not match its immutable Token Live Capture parameters.',
        false,
      );
    }
    if (resources.schedules === undefined) {
      throw new CaptureExecutionError(
        'TOKEN_LIVE_CAPTURE_SCHEDULER_UNAVAILABLE',
        'Live monitor requires durable schedule history for its incremental cursor.',
        false,
      );
    }
    const rpcUrls =
      parameters.dataset === 'ethereum-mainnet' ? config.ethereumRpcUrls : config.bscRpcUrls;
    const rpc = transportFor(
      rpcUrls,
      parameters.dataset === 'ethereum-mainnet' ? 'ethereum-rpc' : 'bsc-rpc',
      config,
      parameters.dataset === 'ethereum-mainnet'
        ? config.ethereumRequestsPerSecond
        : config.bscRequestsPerSecond,
    );
    const adapter = new EvmLedgerAdapter(
      {
        id: parameters.dataset === 'ethereum-mainnet' ? 'ethereum-rpc' : 'bsc-rpc',
        chainId: chain.chainId,
        chainName: chain.chainName,
        snapshotBlockTag: 'finalized',
      },
      rpc,
    );
    try {
      const head = await adapter.readHeadAnchor();
      if (head.snapshot.ledger !== 'EVM') {
        throw new CaptureExecutionError(
          'TOKEN_LIVE_CAPTURE_SNAPSHOT_INVALID',
          'Finalized monitor head Snapshot is not EVM.',
          false,
        );
      }
      const snapshot = head.snapshot;
      const finalizedHeadQuantity = BigInt(head.snapshot.blockNumber);
      const initialFromQuantity = BigInt(parameters.initialFromBlock);
      if (
        finalizedHeadQuantity > BigInt(Number.MAX_SAFE_INTEGER) ||
        initialFromQuantity > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new CaptureExecutionError(
          'TOKEN_LIVE_CAPTURE_RANGE_INVALID',
          'Live monitor head or initial cursor exceeded the safe integer range.',
          false,
        );
      }
      const finalizedHead = Number(finalizedHeadQuantity);
      const initialFromBlock = Number(initialFromQuantity);
      const runs = await resources.schedules.listRunsForSchedule(run.scheduleId, 100);
      const previous = previousSuccessfulRunEnd(runs);
      if (previous !== undefined) {
        if (previous.blockNumber > finalizedHead) {
          throw new CaptureExecutionError(
            'TOKEN_LIVE_CAPTURE_REORG_DETECTED',
            'Finalized monitor head moved behind its durable cursor.',
            true,
          );
        }
        const priorAnchor = await adapter.readAnchorAt(String(previous.blockNumber));
        if (
          priorAnchor.snapshot.ledger !== 'EVM' ||
          priorAnchor.snapshot.blockHash.toLowerCase() !== previous.blockHash.toLowerCase()
        ) {
          throw new CaptureExecutionError(
            'TOKEN_LIVE_CAPTURE_REORG_DETECTED',
            'Finalized monitor cursor no longer matches the provider chain.',
            true,
          );
        }
      }
      const fromBlock = Math.max(
        initialFromBlock,
        previous === undefined ? initialFromBlock : previous.blockNumber + 1,
      );
      if (!Number.isSafeInteger(fromBlock)) {
        throw new CaptureExecutionError(
          'TOKEN_LIVE_CAPTURE_RANGE_INVALID',
          'Live monitor cursor exceeded the safe integer range.',
          false,
        );
      }
      if (fromBlock > finalizedHead) {
        const sourceSet = sortedUnique(
          Object.keys(head.snapshot.providerVersions).length > 0
            ? Object.keys(head.snapshot.providerVersions)
            : adapter.sourceIds.length > 0
              ? adapter.sourceIds
              : [adapter.sourceId],
        );
        const providerEvidence = sourceSet.map((providerSource) =>
          liveCaptureProviderEvidence({
            run,
            parameters,
            snapshot,
            providerSource,
          }),
        );
        for (const evidence of providerEvidence) {
          await resources.evidence.put(evidence, [], snapshot);
        }
        const sourceEvidenceIds = providerEvidence.map((evidence) => evidence.id).sort();
        const evidence = liveCaptureEvidence({
          run,
          parameters,
          snapshot,
          fromBlock,
          sourceSet,
          sourceEvidenceIds,
        });
        await resources.evidence.put(evidence, sourceEvidenceIds, snapshot);
        return CaptureRunSuccessSchema.parse({
          resultRef: `token-live-capture:${run.scheduleId}#sha256=${hashPayload({ evidence, sourceEvidenceIds })}`,
          snapshot,
          terminalEvidenceId: evidence.id,
          evidenceIds: [...sourceEvidenceIds, evidence.id].sort(),
          sourceSet,
          modelVersion: 'token-live-capture-v1.0.0',
          coverage: 1,
          freshness: head.snapshot.capturedAt,
          confidence: 1,
        });
      }
      const toBlockQuantity = [
        BigInt(finalizedHead),
        BigInt(fromBlock) + BigInt(parameters.windowBlocks) - 1n,
      ].reduce((minimum, value) => (value < minimum ? value : minimum));
      if (toBlockQuantity > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new CaptureExecutionError(
          'TOKEN_LIVE_CAPTURE_RANGE_INVALID',
          'Live monitor capture window exceeded the safe integer range.',
          false,
        );
      }
      const toBlock = Number(toBlockQuantity);
      const backfillRun = {
        ...run,
        captureKind: 'TOKEN_HISTORY_BACKFILL' as const,
        parameters: {
          schemaVersion: 'token-history-backfill-v1' as const,
          dataset: parameters.dataset,
          token,
          fromBlock: String(fromBlock),
          toBlock: String(toBlock),
          modelVersion: 'token-history-backfill-v1.0.0' as const,
          policyVersion: 'token-history-policy-v1.0.0' as const,
        },
      } satisfies CaptureRun;
      const result = await backfill(backfillRun, signal);
      return CaptureRunSuccessSchema.parse({
        ...result,
        modelVersion: 'token-live-capture-v1.0.0',
      });
    } catch (error) {
      if (error instanceof CaptureExecutionError) throw error;
      throw new CaptureExecutionError(
        errorCode(error),
        errorMessage(error),
        asRetryable(error),
        error,
      );
    }
  };
}
