import { createEvidence } from '@zerotrace/evidence';
import {
  ProviderError,
  sqdSolanaTokenBalancesFromBlock,
  sqdTransactionsFromBlock,
  type SqdFinalizedBlock,
  type SqdLedgerRecordItem,
  type SqdPortalClient,
  type SqdStreamSummary,
  type SolanaLedgerAdapter,
} from '@zerotrace/chain-adapters';
import { buildSolanaDealerCampaign } from '@zerotrace/campaign-engine';
import { createSqdProfileRequest } from '@zerotrace/ingestion';
import {
  SolanaDealerCampaignRequestSchema,
  SolanaTransactionIntelligenceReportSchema,
  type AnalysisSnapshot,
  type Evidence,
  type SolanaDealerCampaignReport,
  type SolanaTransactionIntelligenceReport,
  type SubjectReference,
} from '@zerotrace/schemas';
import { querySolanaTransaction } from './ledger-query.js';

export interface SolanaDealerCaptureInput {
  mint: string;
  fromSlot: string;
  toSlot: string;
  maxTransactions: number;
  source: SqdPortalClient;
  adapter: SolanaLedgerAdapter;
  writeEvidence: (
    evidence: Evidence,
    sourceEvidenceIds?: readonly string[],
    snapshot?: AnalysisSnapshot,
  ) => Promise<Evidence>;
  signal?: AbortSignal;
  now?: () => string;
}

export interface SolanaDealerCaptureResult {
  report: SolanaDealerCampaignReport;
  sourceSummary: SqdStreamSummary;
  transactionReports: readonly SolanaTransactionIntelligenceReport[];
  candidateCount: number;
  truncated: boolean;
}

export function deriveSolanaDealerHistoryCoverage(input: {
  fromSlot: string;
  sourceCompletion: SqdStreamSummary['completion'];
  truncated: boolean;
  transactionReports: readonly SolanaTransactionIntelligenceReport[];
  mint: string;
}): number {
  if (input.sourceCompletion !== 'REQUESTED_RANGE_COMPLETE' || input.truncated) return 0;
  return input.transactionReports.some((report) => {
    const snapshot = report.metadata.snapshot;
    if (snapshot?.ledger !== 'SOLANA' || snapshot.slot !== input.fromSlot) return false;
    const semantics = report.facts.transactionSemantics;
    if (semantics.state !== 'known') return false;
    return semantics.value.assetFlows.some(
      (flow) =>
        flow.flowKind === 'MINT' &&
        flow.application === 'APPLIED' &&
        flow.mint.state === 'known' &&
        flow.mint.value === input.mint,
    );
  })
    ? 1
    : 0;
}

export class SolanaDealerCaptureError extends Error {
  readonly code:
    | 'SOLANA_DEALER_CAPTURE_INVALID'
    | 'SOLANA_DEALER_CAPTURE_INCOMPLETE'
    | 'SOLANA_DEALER_CAPTURE_NO_SOURCE';

  constructor(code: SolanaDealerCaptureError['code'], message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SolanaDealerCaptureError';
    this.code = code;
  }
}

const SOLANA_DEALER_SOURCE_WINDOW = 16;

function maxOptional(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function captureAbortError(): ProviderError {
  return new ProviderError('TIMEOUT', 'Solana dealer capture was aborted.', {
    retryable: false,
  });
}

async function raceWithCaptureSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) throw captureAbortError();
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(captureAbortError());
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort);
  }
}

async function readSolanaDealerRange(
  source: SqdPortalClient,
  fromSlot: number,
  toSlot: number,
  onBlock: (block: SqdFinalizedBlock) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<SqdStreamSummary> {
  let cursor = fromSlot;
  let lastBlock: number | null = null;
  let finalizedHead: number | null = null;
  let blocks = 0;
  let requests = 0;
  let retries = 0;
  let rateLimitEvents = 0;
  let rangeAdjustments = 0;

  while (cursor <= toSlot) {
    // A busy Solana slot can produce a very large ledger-record JSONL line. Keep the
    // source-level request bounded even when the caller asks for a wider investigation.
    const windowEnd =
      toSlot - cursor >= SOLANA_DEALER_SOURCE_WINDOW - 1
        ? cursor + SOLANA_DEALER_SOURCE_WINDOW - 1
        : toSlot;
    const profileRequest = createSqdProfileRequest({
      dataset: 'solana-mainnet',
      profile: 'ledger-records',
      fromBlock: cursor,
      toBlock: windowEnd,
    });
    const summary = await raceWithCaptureSignal(
      source.readFinalizedRange(
        signal === undefined ? profileRequest : { ...profileRequest, signal },
        async (block) => {
          if (signalAborted(signal)) {
            throw new SolanaDealerCaptureError(
              'SOLANA_DEALER_CAPTURE_INCOMPLETE',
              'Solana dealer capture was aborted by the caller.',
            );
          }
          await onBlock(block);
        },
      ),
      signal,
    );
    if (
      summary.dataset !== 'solana-mainnet' ||
      summary.requestedFrom !== cursor ||
      summary.requestedTo !== windowEnd
    ) {
      throw new SolanaDealerCaptureError(
        'SOLANA_DEALER_CAPTURE_INCOMPLETE',
        `SQD returned a mismatched Solana range summary for ${cursor}–${windowEnd}.`,
      );
    }

    lastBlock = maxOptional(lastBlock, summary.lastBlock);
    finalizedHead = maxOptional(finalizedHead, summary.finalizedHead);
    blocks += summary.blocks;
    requests += summary.requests;
    retries += summary.retries;
    rateLimitEvents += summary.rateLimitEvents ?? 0;
    rangeAdjustments += summary.rangeAdjustments ?? 0;

    if (summary.completion === 'REQUESTED_RANGE_COMPLETE') {
      if (summary.nextBlock !== windowEnd + 1) {
        throw new SolanaDealerCaptureError(
          'SOLANA_DEALER_CAPTURE_INCOMPLETE',
          `SQD reported incomplete Solana cursor coverage for ${cursor}–${windowEnd}.`,
        );
      }
      cursor = windowEnd + 1;
      continue;
    }
    if (summary.nextBlock < cursor || summary.nextBlock > windowEnd + 1) {
      throw new SolanaDealerCaptureError(
        'SOLANA_DEALER_CAPTURE_INCOMPLETE',
        `SQD returned an invalid Solana source-head cursor for ${cursor}–${windowEnd}.`,
      );
    }
    return {
      dataset: 'solana-mainnet',
      completion: 'SOURCE_HEAD_REACHED',
      requestedFrom: fromSlot,
      requestedTo: toSlot,
      lastBlock,
      nextBlock: summary.nextBlock,
      finalizedHead,
      blocks,
      requests,
      retries,
      ...(rateLimitEvents === 0 ? {} : { rateLimitEvents }),
      ...(rangeAdjustments === 0 ? {} : { rangeAdjustments }),
    };
  }

  return {
    dataset: 'solana-mainnet',
    completion: 'REQUESTED_RANGE_COMPLETE',
    requestedFrom: fromSlot,
    requestedTo: toSlot,
    lastBlock,
    nextBlock: toSlot + 1,
    finalizedHead,
    blocks,
    requests,
    retries,
    ...(rateLimitEvents === 0 ? {} : { rateLimitEvents }),
    ...(rangeAdjustments === 0 ? {} : { rangeAdjustments }),
  };
}

interface CandidateTransaction {
  slot: number;
  transactionIndex: number;
  signature: string;
}

function safeSlot(value: string, field: string): number {
  if (!/^\d+$/.test(value)) {
    throw new SolanaDealerCaptureError(
      'SOLANA_DEALER_CAPTURE_INVALID',
      `${field} must be an unsigned decimal slot.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new SolanaDealerCaptureError(
      'SOLANA_DEALER_CAPTURE_INVALID',
      `${field} exceeds the JSON-RPC safe integer range.`,
    );
  }
  return parsed;
}

function indexValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function transactionIndex(
  item: SqdLedgerRecordItem | { payload: Readonly<Record<string, unknown>> },
): number | undefined {
  return indexValue(item.payload.transactionIndex);
}

function tokenBalanceMatches(item: SqdLedgerRecordItem, mint: string): boolean {
  const preMint = stringValue(item.payload.preMint);
  const postMint = stringValue(item.payload.postMint);
  return preMint === mint || postMint === mint;
}

function subjectFor(signature: string): SubjectReference {
  return {
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    type: 'TRANSACTION',
    id: signature,
    normalizedId: signature,
    validation: 'STRUCTURALLY_VALID',
    confidence: 1,
  };
}

function sourceSetFromSnapshot(snapshot: AnalysisSnapshot): string[] {
  return Object.keys(snapshot.providerVersions).sort();
}

function blockEvidence(block: SqdFinalizedBlock, capturedAt: string): Evidence {
  const position = String(block.header.number);
  return createEvidence({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    kind: 'BLOCK',
    source: 'sqd:solana-mainnet',
    locator: `block:${position}:${block.header.hash}`,
    payload: block,
    observedAt: capturedAt,
    blockOrSlot: position,
    finality: 'finalized',
    summary: `SQD finalized Solana slot ${position}.`,
  });
}

function rangeEvidence(
  fromSlot: string,
  toSlot: string,
  summary: SqdStreamSummary,
  capturedAt: string,
  sourceEvidenceIds: readonly string[],
): Evidence {
  return createEvidence({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    // The range summary is derived from the per-slot block observations below. A provider
    // observation cannot itself derive from another provider observation in the Evidence graph;
    // keeping this as a derived feature preserves the full parent chain without weakening the
    // provenance validator.
    kind: 'DERIVED_FEATURE',
    source: 'sqd:solana-mainnet',
    locator: `sqd-range:solana-mainnet:${fromSlot}-${toSlot}`,
    payload: summary,
    observedAt: capturedAt,
    blockOrSlot: toSlot,
    finality: 'finalized',
    summary: `SQD finalized Solana range ${fromSlot}–${toSlot} stream summary.`,
    sourceEvidenceIds,
  });
}

export async function captureSolanaDealerCampaign(
  input: SolanaDealerCaptureInput,
): Promise<SolanaDealerCaptureResult> {
  const parsed = SolanaDealerCampaignRequestSchema.parse({
    mint: input.mint,
    fromSlot: input.fromSlot,
    toSlot: input.toSlot,
    maxTransactions: input.maxTransactions,
  });
  const fromSlot = safeSlot(parsed.fromSlot, 'fromSlot');
  const toSlot = safeSlot(parsed.toSlot, 'toSlot');
  if (input.source.dataset !== 'solana-mainnet') {
    throw new SolanaDealerCaptureError(
      'SOLANA_DEALER_CAPTURE_NO_SOURCE',
      'Solana dealer capture requires the SQD solana-mainnet dataset.',
    );
  }
  if (input.adapter.config.commitment !== 'finalized') {
    throw new SolanaDealerCaptureError(
      'SOLANA_DEALER_CAPTURE_INVALID',
      'Solana dealer capture requires a finalized RPC adapter.',
    );
  }
  const capturedAt = input.now?.() ?? new Date().toISOString();
  const rangeEvidenceValues: Evidence[] = [];
  const candidates = new Map<string, CandidateTransaction>();
  const sourceSummary = await readSolanaDealerRange(
    input.source,
    fromSlot,
    toSlot,
    async (block) => {
      await yieldToEventLoop();
      if (signalAborted(input.signal)) {
        throw new SolanaDealerCaptureError(
          'SOLANA_DEALER_CAPTURE_INCOMPLETE',
          'Solana dealer capture was aborted by the caller.',
        );
      }
      const evidence = await input.writeEvidence(blockEvidence(block, capturedAt));
      rangeEvidenceValues.push(evidence);
      const transactions = sqdTransactionsFromBlock('solana-mainnet', block);
      const transactionsByIndex = new Map<number, CandidateTransaction>();
      for (const transaction of transactions) {
        const position = transactionIndex(transaction);
        if (position === undefined) continue;
        transactionsByIndex.set(position, {
          slot: block.header.number,
          transactionIndex: position,
          signature: transaction.identity,
        });
      }
      for (const balance of sqdSolanaTokenBalancesFromBlock('solana-mainnet', block)) {
        if (!tokenBalanceMatches(balance, parsed.mint)) continue;
        const position = transactionIndex(balance);
        if (position === undefined) continue;
        const candidate = transactionsByIndex.get(position);
        if (candidate !== undefined) candidates.set(candidate.signature, candidate);
      }
    },
    input.signal,
  );
  if (signalAborted(input.signal)) {
    throw new SolanaDealerCaptureError(
      'SOLANA_DEALER_CAPTURE_INCOMPLETE',
      'Solana dealer capture was aborted by the caller.',
    );
  }
  const summaryEvidence = await input.writeEvidence(
    rangeEvidence(
      fromSlot.toString(),
      toSlot.toString(),
      sourceSummary,
      capturedAt,
      rangeEvidenceValues.map((evidence) => evidence.id),
    ),
    rangeEvidenceValues.map((evidence) => evidence.id),
  );
  rangeEvidenceValues.push(summaryEvidence);

  const orderedCandidates = [...candidates.values()].sort((left, right) => {
    if (left.slot !== right.slot) return left.slot - right.slot;
    if (left.transactionIndex !== right.transactionIndex) {
      return left.transactionIndex - right.transactionIndex;
    }
    return left.signature.localeCompare(right.signature);
  });
  const selectedCandidates = orderedCandidates.slice(0, parsed.maxTransactions);
  const truncated = selectedCandidates.length < orderedCandidates.length;
  const transactionReports: SolanaTransactionIntelligenceReport[] = [];
  const transactionInputs: Array<{
    report: SolanaTransactionIntelligenceReport;
    transactionIndex: string;
  }> = [];
  for (const candidate of selectedCandidates) {
    if (signalAborted(input.signal)) {
      throw new SolanaDealerCaptureError(
        'SOLANA_DEALER_CAPTURE_INCOMPLETE',
        'Solana dealer capture was aborted by the caller.',
      );
    }
    const rawReport = await querySolanaTransaction(
      input.adapter,
      subjectFor(candidate.signature),
      input.writeEvidence,
      input.signal === undefined ? {} : { signal: input.signal },
    );
    const parsedReport = SolanaTransactionIntelligenceReportSchema.safeParse(rawReport);
    if (!parsedReport.success) {
      throw new SolanaDealerCaptureError(
        'SOLANA_DEALER_CAPTURE_INCOMPLETE',
        `Transaction ${candidate.signature} did not produce a confirmed finalized report.`,
        parsedReport.error,
      );
    }
    const report = parsedReport.data;
    if (report.metadata.snapshot?.ledger !== 'SOLANA') {
      throw new SolanaDealerCaptureError(
        'SOLANA_DEALER_CAPTURE_INCOMPLETE',
        `Transaction ${candidate.signature} has no Solana Snapshot.`,
      );
    }
    if (report.metadata.snapshot.slot !== String(candidate.slot)) {
      throw new SolanaDealerCaptureError(
        'SOLANA_DEALER_CAPTURE_INCOMPLETE',
        `Transaction ${candidate.signature} moved across slots during capture.`,
      );
    }
    transactionReports.push(report);
    transactionInputs.push({ report, transactionIndex: String(candidate.transactionIndex) });
  }

  const finalAnchor = await input.adapter.readAnchorAt(
    parsed.toSlot,
    input.signal === undefined ? {} : { signal: input.signal },
  );
  const snapshot = finalAnchor.snapshot;
  const sourceSet = [...new Set([...sourceSetFromSnapshot(snapshot), 'sqd:solana-mainnet'])].sort();
  const coverage = sourceSummary.completion === 'REQUESTED_RANGE_COMPLETE' && !truncated;
  const historyCoverage = deriveSolanaDealerHistoryCoverage({
    fromSlot: parsed.fromSlot,
    sourceCompletion: sourceSummary.completion,
    truncated,
    transactionReports,
    mint: parsed.mint,
  });
  let built = buildSolanaDealerCampaign({
    mint: parsed.mint,
    fromSlot: parsed.fromSlot,
    toSlot: parsed.toSlot,
    snapshot,
    transactions: transactionInputs,
    rangeEvidence: rangeEvidenceValues,
    sourceSet,
    dataCoverage: coverage ? 1 : 0.5,
    sourceCoverage: sourceSet.length >= 2 ? 1 : 0.5,
    historyCoverage,
    allowComplete: coverage,
  });
  if (historyCoverage === 1 && built.report.openingBalanceUnknownWalletIds.length > 0) {
    built = buildSolanaDealerCampaign({
      mint: parsed.mint,
      fromSlot: parsed.fromSlot,
      toSlot: parsed.toSlot,
      snapshot,
      transactions: transactionInputs,
      rangeEvidence: rangeEvidenceValues,
      sourceSet,
      dataCoverage: coverage ? 1 : 0.5,
      sourceCoverage: sourceSet.length >= 2 ? 1 : 0.5,
      historyCoverage: 0,
      allowComplete: coverage,
    });
  }
  for (const evidence of built.derivedEvidence) {
    await input.writeEvidence(evidence, built.derivedEvidenceSources[evidence.id] ?? [], snapshot);
  }
  return {
    report: built.report,
    sourceSummary,
    transactionReports,
    candidateCount: orderedCandidates.length,
    truncated,
  };
}
