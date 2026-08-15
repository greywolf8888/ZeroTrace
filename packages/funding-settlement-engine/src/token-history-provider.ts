import type { EvmLedgerAdapter } from '@zerotrace/chain-adapters';
import type {
  EvmAssetTransferObservation,
  RawChainFact,
  TokenHistoryDiscoveryReport,
  FundingSettlementCoverageScope,
} from '@zerotrace/schemas';
import {
  decodeEvmAssetTransfers,
  deriveFundingSettlementReport,
  type EvmTransactionCapture,
} from './index.js';

export interface TokenHistoryFundingSettlementInput {
  report: TokenHistoryDiscoveryReport;
  facts: readonly RawChainFact[];
  exactReader: EvmLedgerAdapter;
  token: string;
  fromBlock: number;
  toBlock: number;
  probeHistoricalCode: boolean;
  /**
   * Optional candidate-scoped historical transfers materialized by an archival provider. These
   * are deliberately supplied separately from the exact receipt captures: a bounded SQD query
   * can prove native movement in a requested range, but it must not be mistaken for an exact
   * transaction/receipt observation or for lifetime coverage.
   */
  historicalTransfers?: readonly EvmAssetTransferObservation[];
  historicalHistoryCoverage?: number;
  historicalCoverageScope?: FundingSettlementCoverageScope;
  historicalSourceSet?: readonly string[];
  historicalExpansion?: (input: {
    focusWalletIds: readonly string[];
    token: string;
    fromBlock: number;
    toBlock: number;
  }) => Promise<{
    transfers: readonly EvmAssetTransferObservation[];
    historyCoverage: number;
    coverageScope: FundingSettlementCoverageScope;
    sourceSet: readonly string[];
    evidenceIds?: readonly string[];
  }>;
}

export type TokenHistoryFundingSettlementResult =
  | {
      status: 'UNKNOWN';
      reason: string;
      focusWalletIds: readonly string[];
      focusSelection: {
        codeConfirmed: readonly string[];
        transactionSenderFallback: readonly string[];
      };
      codeProbeFailures: readonly string[];
      historicalEvidenceIds: readonly string[];
    }
  | {
      status: 'DERIVED';
      report: ReturnType<typeof deriveFundingSettlementReport>;
      replayResultHash: string;
      focusWalletIds: readonly string[];
      focusSelection: {
        codeConfirmed: readonly string[];
        transactionSenderFallback: readonly string[];
      };
      codeProbeFailures: readonly string[];
      historicalEvidenceIds: readonly string[];
    };

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function transferIdentity(transfer: EvmAssetTransferObservation): string {
  return [
    transfer.chainId,
    transfer.asset === 'NATIVE' ? 'NATIVE' : transfer.asset.toLowerCase(),
    transfer.blockNumber,
    transfer.blockHash.toLowerCase(),
    transfer.transactionHash.toLowerCase(),
    transfer.transactionIndex,
    transfer.eventIndex ?? '',
    transfer.source.toLowerCase(),
    transfer.destination.toLowerCase(),
    transfer.amountAtomic,
  ].join(':');
}

function deduplicateTransfers(
  transfers: readonly EvmAssetTransferObservation[],
): EvmAssetTransferObservation[] {
  // Candidate expansion can legitimately return tens of thousands of rows and may overlap the
  // exact receipt set. The previous findIndex-based de-duplication was quadratic in that count,
  // making a bounded provider response look hung while it rebuilt the Funding/Settlement graph.
  // Keep the first canonical observation (exact receipt before archival expansion) in linear time.
  const unique = new Map<string, EvmAssetTransferObservation>();
  for (const transfer of transfers) {
    const identity = transferIdentity(transfer);
    if (!unique.has(identity)) unique.set(identity, transfer);
  }
  return [...unique.values()];
}

/**
 * Builds the bounded Funding/Settlement report from the exact receipts already bound by Token
 * History. Historical code failures remain diagnostics; transaction senders are only a bounded
 * focus fallback and never become ownership assertions.
 */
export async function buildFundingSettlementFromTokenHistory(
  input: TokenHistoryFundingSettlementInput,
): Promise<TokenHistoryFundingSettlementResult> {
  if (input.report.snapshot.ledger !== 'EVM') {
    return {
      status: 'UNKNOWN',
      reason: 'TOKEN_HISTORY_SNAPSHOT_IS_NOT_EVM',
      focusWalletIds: [],
      focusSelection: { codeConfirmed: [], transactionSenderFallback: [] },
      codeProbeFailures: [],
      historicalEvidenceIds: [],
    };
  }
  const observationByTransaction = new Map(
    input.report.observations.map((observation) => [observation.transactionHash, observation]),
  );
  const reportEvidenceIds = new Set(input.report.evidenceIds);
  const observationByAddress = new Map<string, (typeof input.report.observations)[number]>();
  for (const observation of input.report.observations) {
    if (!observationByAddress.has(observation.from))
      observationByAddress.set(observation.from, observation);
    if (!observationByAddress.has(observation.to))
      observationByAddress.set(observation.to, observation);
  }
  const candidates = [
    ...new Set(
      input.report.observations.flatMap((observation) => [observation.from, observation.to]),
    ),
  ].filter((address) => address !== input.token.toLowerCase());
  const codeConfirmed: string[] = [];
  const codeStatus = new Map<string, string>();
  const codeProbeFailures: string[] = [];
  for (const address of candidates.sort()) {
    if (!input.probeHistoricalCode) continue;
    const observation = observationByAddress.get(address);
    if (observation === undefined || observation.snapshot.ledger !== 'EVM') continue;
    try {
      const code = await input.exactReader.getCodeObservationAtBlockHash(
        address,
        observation.snapshot.blockHash,
      );
      codeStatus.set(address, code.value);
      if (code.value === '0x') codeConfirmed.push(address);
    } catch (error) {
      codeProbeFailures.push(`${address}:${error instanceof Error ? error.message : 'ERROR'}`);
    }
  }
  const factsByTransaction = new Map<string, RawChainFact[]>();
  for (const fact of input.facts) {
    if (fact.factType !== 'TRANSACTION') continue;
    const key = fact.subject.toLowerCase();
    const list = factsByTransaction.get(key) ?? [];
    list.push(fact);
    factsByTransaction.set(key, list);
  }
  const captures: EvmTransactionCapture[] = [];
  for (const transactionHash of input.report.relevantTransactionHashes) {
    const observation = observationByTransaction.get(transactionHash);
    if (observation?.snapshot.ledger !== 'EVM') continue;
    const [transactionObservation, receiptObservation] = await Promise.all([
      input.exactReader.getTransactionObservation(transactionHash),
      input.exactReader.getTransactionReceiptObservation(transactionHash),
    ]);
    if (transactionObservation.value === null || receiptObservation.value === null) continue;
    const transactionFacts = factsByTransaction.get(transactionHash) ?? [];
    // A resumed durable range can contain older Raw Facts for the same transaction. Prefer the
    // fact whose Evidence is part of the current report closure; otherwise use the newest
    // observed fact rather than letting an orphaned historical Evidence ID poison the capture.
    const transactionFact =
      transactionFacts.find((fact) => reportEvidenceIds.has(fact.evidenceId)) ??
      [...transactionFacts].sort((left, right) =>
        right.observedAt.localeCompare(left.observedAt),
      )[0];
    const evidenceIds =
      transactionFact?.evidenceId === undefined
        ? observation.evidenceIds
        : [transactionFact.evidenceId];
    captures.push({
      transaction: transactionObservation.value,
      receipt: receiptObservation.value,
      snapshot: observation.snapshot,
      transactionEvidenceIds: evidenceIds,
      ...(transactionFact?.rawArtifactRef === undefined
        ? {}
        : { rawArtifactRef: transactionFact.rawArtifactRef }),
    });
  }
  const candidateSet = new Set(candidates);
  const transactionSenderFallback = sortedUnique(
    captures
      .map((capture) => capture.transaction.from.toLowerCase())
      .filter((address) => candidateSet.has(address) && codeStatus.get(address) !== '0x'),
  );
  const focusWalletIds = sortedUnique([...codeConfirmed, ...transactionSenderFallback]);
  if (focusWalletIds.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: 'NO_EOA_FOCUS_WALLET_AFTER_EXACT_CODE_CHECK_AND_TX_SENDER_FALLBACK',
      focusWalletIds,
      focusSelection: { codeConfirmed, transactionSenderFallback },
      codeProbeFailures,
      historicalEvidenceIds: [],
    };
  }
  const exactTransfers = captures.flatMap((capture) => decodeEvmAssetTransfers(capture));
  const expanded =
    input.historicalExpansion === undefined
      ? undefined
      : await input.historicalExpansion({
          focusWalletIds,
          token: input.token,
          fromBlock: input.fromBlock,
          toBlock: input.toBlock,
        });
  const historicalTransfers = [
    ...(input.historicalTransfers ?? []),
    ...(expanded?.transfers ?? []),
  ];
  const historicalEvidenceIds = sortedUnique(expanded?.evidenceIds ?? []);
  const allTransfers = deduplicateTransfers([...exactTransfers, ...historicalTransfers]);
  if (allTransfers.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: 'NO_EXACT_ASSET_TRANSFERS_IN_RELEVANT_RECEIPTS',
      focusWalletIds,
      focusSelection: { codeConfirmed, transactionSenderFallback },
      codeProbeFailures,
      historicalEvidenceIds,
    };
  }
  const hasHistoricalCoverage = historicalTransfers.length > 0;
  const sourceSet = sortedUnique([
    ...input.report.sourceSet,
    ...((input.exactReader.sourceIds?.length ?? 0) > 0
      ? (input.exactReader.sourceIds ?? [])
      : [input.exactReader.sourceId]),
    ...(input.historicalSourceSet ?? []),
    ...(expanded?.sourceSet ?? []),
  ]);
  const historicalCoverageValues = [
    ...(input.historicalHistoryCoverage === undefined ? [] : [input.historicalHistoryCoverage]),
    ...(expanded === undefined ? [] : [expanded.historyCoverage]),
  ];
  const historyCoverage = hasHistoricalCoverage
    ? Math.min(
        input.report.historyCoverage,
        ...(historicalCoverageValues.length === 0 ? [0] : historicalCoverageValues),
      )
    : 0;
  const coverageScope = hasHistoricalCoverage
    ? (expanded?.coverageScope ?? input.historicalCoverageScope ?? 'BOUNDED_RANGE')
    : 'TRANSACTION_LOCAL';
  const report = deriveFundingSettlementReport({
    token: input.token,
    fromBlock: String(input.fromBlock),
    toBlock: String(input.toBlock),
    snapshot: input.report.snapshot,
    transfers: allTransfers,
    focusWalletIds,
    dataCoverage: input.report.dataCoverage,
    sourceCoverage: input.report.sourceCoverage,
    historyCoverage,
    coverageScope,
    sourceSet,
    maxHops: 2,
  });
  const replay = deriveFundingSettlementReport({
    token: input.token,
    fromBlock: String(input.fromBlock),
    toBlock: String(input.toBlock),
    snapshot: input.report.snapshot,
    transfers: [...allTransfers].reverse(),
    focusWalletIds,
    dataCoverage: input.report.dataCoverage,
    sourceCoverage: input.report.sourceCoverage,
    historyCoverage,
    coverageScope,
    sourceSet,
    maxHops: 2,
  });
  return {
    status: 'DERIVED',
    report,
    replayResultHash: replay.resultHash,
    focusWalletIds,
    focusSelection: { codeConfirmed, transactionSenderFallback },
    codeProbeFailures,
    historicalEvidenceIds,
  };
}
