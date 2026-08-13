import type { EvmLedgerAdapter } from '@zerotrace/chain-adapters';
import type { RawChainFact, TokenHistoryDiscoveryReport } from '@zerotrace/schemas';
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
    };

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
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
    };
  }
  const observationByTransaction = new Map(
    input.report.observations.map((observation) => [observation.transactionHash, observation]),
  );
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
    const observation = input.report.observations.find(
      (item) => item.from === address || item.to === address,
    );
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
  const captures: EvmTransactionCapture[] = [];
  for (const transactionHash of input.report.relevantTransactionHashes) {
    const observation = observationByTransaction.get(transactionHash);
    if (observation?.snapshot.ledger !== 'EVM') continue;
    const [transactionObservation, receiptObservation] = await Promise.all([
      input.exactReader.getTransactionObservation(transactionHash),
      input.exactReader.getTransactionReceiptObservation(transactionHash),
    ]);
    if (transactionObservation.value === null || receiptObservation.value === null) continue;
    const transactionFact = input.facts.find(
      (fact) => fact.factType === 'TRANSACTION' && fact.subject.toLowerCase() === transactionHash,
    );
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
  const transactionSenderFallback = sortedUnique(
    captures
      .map((capture) => capture.transaction.from.toLowerCase())
      .filter((address) => candidates.includes(address) && codeStatus.get(address) !== '0x'),
  );
  const focusWalletIds = sortedUnique([...codeConfirmed, ...transactionSenderFallback]);
  if (focusWalletIds.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: 'NO_EOA_FOCUS_WALLET_AFTER_EXACT_CODE_CHECK_AND_TX_SENDER_FALLBACK',
      focusWalletIds,
      focusSelection: { codeConfirmed, transactionSenderFallback },
      codeProbeFailures,
    };
  }
  const transfers = captures.flatMap((capture) => decodeEvmAssetTransfers(capture));
  if (transfers.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: 'NO_EXACT_ASSET_TRANSFERS_IN_RELEVANT_RECEIPTS',
      focusWalletIds,
      focusSelection: { codeConfirmed, transactionSenderFallback },
      codeProbeFailures,
    };
  }
  const sourceSet = sortedUnique([...input.report.sourceSet, input.exactReader.sourceId]);
  const report = deriveFundingSettlementReport({
    token: input.token,
    fromBlock: String(input.fromBlock),
    toBlock: String(input.toBlock),
    snapshot: input.report.snapshot,
    transfers,
    focusWalletIds,
    dataCoverage: input.report.dataCoverage,
    sourceCoverage: input.report.sourceCoverage,
    historyCoverage: 0,
    coverageScope: 'TRANSACTION_LOCAL',
    sourceSet,
    maxHops: 2,
  });
  const replay = deriveFundingSettlementReport({
    token: input.token,
    fromBlock: String(input.fromBlock),
    toBlock: String(input.toBlock),
    snapshot: input.report.snapshot,
    transfers: [...transfers].reverse(),
    focusWalletIds,
    dataCoverage: input.report.dataCoverage,
    sourceCoverage: input.report.sourceCoverage,
    historyCoverage: 0,
    coverageScope: 'TRANSACTION_LOCAL',
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
  };
}
