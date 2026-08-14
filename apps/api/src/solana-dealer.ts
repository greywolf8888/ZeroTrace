import { createEvidence } from '@zerotrace/evidence';
import {
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
  now?: () => string;
}

export interface SolanaDealerCaptureResult {
  report: SolanaDealerCampaignReport;
  sourceSummary: SqdStreamSummary;
  transactionReports: readonly SolanaTransactionIntelligenceReport[];
  candidateCount: number;
  truncated: boolean;
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
): Evidence {
  return createEvidence({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    kind: 'PROVIDER_OBSERVATION',
    source: 'sqd:solana-mainnet',
    locator: `sqd-range:solana-mainnet:${fromSlot}-${toSlot}`,
    payload: summary,
    observedAt: capturedAt,
    blockOrSlot: toSlot,
    finality: 'finalized',
    summary: `SQD finalized Solana range ${fromSlot}–${toSlot} stream summary.`,
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
  const sourceSummary = await input.source.readFinalizedRange(
    createSqdProfileRequest({
      dataset: 'solana-mainnet',
      profile: 'ledger-records',
      fromBlock: fromSlot,
      toBlock: toSlot,
    }),
    async (block) => {
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
  );
  const summaryEvidence = await input.writeEvidence(
    rangeEvidence(fromSlot.toString(), toSlot.toString(), sourceSummary, capturedAt),
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
    const rawReport = await querySolanaTransaction(
      input.adapter,
      subjectFor(candidate.signature),
      input.writeEvidence,
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

  const finalAnchor = await input.adapter.readAnchorAt(parsed.toSlot);
  const snapshot = finalAnchor.snapshot;
  const sourceSet = [...new Set([...sourceSetFromSnapshot(snapshot), 'sqd:solana-mainnet'])].sort();
  const coverage = sourceSummary.completion === 'REQUESTED_RANGE_COMPLETE' && !truncated;
  const built = buildSolanaDealerCampaign({
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
