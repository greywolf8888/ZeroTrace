import { hashPayload } from '@zerotrace/evidence';

import type { PaperCommand, PaperExperiment, PaperIntent } from './paper-simulation.js';

export const PAPER_REVIEW_MODEL_VERSION = 'paper-review-v1.0.0';

export type PaperAtomicObservation =
  | {
      state: 'known';
      valueAtomic: string;
      sourceId: string;
      observedAt: string;
      availableAt: string;
    }
  | {
      state: 'unknown' | 'unavailable' | 'stale';
      reason: string;
      sourceId?: string;
      observedAt?: string;
      availableAt?: string;
    };

export interface RejectedCandidateReviewInput {
  candidateId: string;
  assetId: string;
  chain: PaperExperiment['chain'];
  strategyVersion: string;
  decisionAt: string;
  evaluatedAt: string;
  rejectionReasons: readonly string[];
  evidenceIds: readonly string[];
  entryCost: PaperAtomicObservation;
  laterExitProceeds: PaperAtomicObservation;
  estimatedCosts: PaperAtomicObservation;
  exitCapacity: PaperAtomicObservation;
}

export interface PaperTradeReview {
  intentId: string;
  inferenceKind: 'FACT_DERIVATION';
  side: PaperIntent['side'];
  assetId: string;
  status: PaperIntent['status'];
  requestedAtomic: string;
  remainingAtomic: string;
  fillCount: number;
  feeAtomic: string;
  executionDelayMs: {
    state: 'known' | 'unavailable';
    value: number | null;
    reason: string | null;
  };
  errorDecomposition: {
    fee: { state: 'known'; valueAtomic: string; unit: 'NATIVE_ATOMIC' };
    unfilled: { state: 'known'; valueAtomic: string; unit: 'QUOTE_ATOMIC' | 'TOKEN_ATOMIC' };
    slippage: { state: 'unavailable'; valueAtomic: null; reason: string };
  };
  evidenceIds: string[];
}

export interface RejectedCandidateReview {
  candidateId: string;
  inferenceKind: 'COUNTERFACTUAL_ESTIMATE';
  assetId: string;
  chain: PaperExperiment['chain'];
  strategyVersion: string;
  decisionAt: string;
  evaluatedAt: string;
  rejectionReasons: string[];
  outcome: 'EXECUTABLE_GAIN' | 'EXECUTABLE_LOSS_OR_FLAT' | 'UNDETERMINED';
  executableExitProceedsAtomic: string | null;
  netCounterfactualPnlAtomic: string | null;
  netCounterfactualReturnBps: string | null;
  missingStates: Array<'entryCost' | 'laterExitProceeds' | 'estimatedCosts' | 'exitCapacity'>;
  evidenceIds: string[];
  confidence: {
    value: number | null;
    meaning: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY';
  };
}

interface CoverageMetric {
  eligible: number;
  covered: number;
  ratio: number | null;
  state: 'known' | 'not_applicable';
}

export interface PaperReviewReport {
  schemaVersion: 'paper-review-v1';
  id: string;
  experimentId: string;
  chain: PaperExperiment['chain'];
  asOf: string;
  historicalState: true;
  snapshot: {
    id: string;
    asOf: string;
    experimentStateHash: string;
    commandJournalHash: string;
    sourceSet: string[];
    replayHash: string;
  };
  trades: PaperTradeReview[];
  rejectedCandidates: RejectedCandidateReview[];
  coverage: {
    tradeIntents: CoverageMetric;
    rejectedCounterfactuals: CoverageMetric;
  };
  freshness: { state: 'HISTORICAL_AS_OF'; asOf: string };
  evidenceIds: string[];
  modelVersion: typeof PAPER_REVIEW_MODEL_VERSION;
  confidence: {
    value: number | null;
    meaning: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY';
  };
  limitations: string[];
}

function iso(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`PAPER_REVIEW_${field}_INVALID`);
  return parsed.toISOString();
}

function atomic(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`PAPER_REVIEW_${field}_INVALID`);
  return BigInt(value);
}

function strings(values: readonly string[], field: string, requireOne = false): string[] {
  if (
    (requireOne && values.length === 0) ||
    values.some((value) => typeof value !== 'string' || value.trim().length === 0)
  ) {
    throw new Error(`PAPER_REVIEW_${field}_INVALID`);
  }
  return [...new Set(values.map((value) => value.trim()))].sort();
}

function coverage(eligible: number, covered: number): CoverageMetric {
  return eligible === 0
    ? { eligible, covered, ratio: null, state: 'not_applicable' }
    : { eligible, covered, ratio: covered / eligible, state: 'known' };
}

function validateJournal(experiment: PaperExperiment, commands: readonly PaperCommand[]): void {
  if (commands.length !== experiment.processedCommands.length) {
    throw new Error('PAPER_REVIEW_COMMAND_JOURNAL_INCOMPLETE');
  }
  for (const [index, command] of commands.entries()) {
    const audit = experiment.processedCommands[index];
    if (
      audit === undefined ||
      audit.id !== command.commandId ||
      audit.hash !== hashPayload(command)
    ) {
      throw new Error('PAPER_REVIEW_COMMAND_JOURNAL_CONFLICT');
    }
  }
}

function reviewTrade(
  experiment: PaperExperiment,
  commands: readonly PaperCommand[],
  intent: PaperIntent,
): PaperTradeReview {
  const related = commands.filter(
    (command) => 'intentId' in command && command.intentId === intent.id,
  );
  const fills = related.filter(
    (command) => command.type === 'RECORD_BUY_FILL' || command.type === 'RECORD_SELL_FILL',
  );
  const fees = related.reduce((sum, command) => {
    if (command.type === 'RECORD_BUY_FILL' || command.type === 'RECORD_SELL_FILL') {
      return sum + atomic(command.feeAtomic, 'FEE');
    }
    if (command.type === 'FAIL_BUY' || command.type === 'FAIL_SELL') {
      return sum + atomic(command.failureFeeAtomic, 'FAILURE_FEE');
    }
    return sum;
  }, 0n);
  const firstFillAt = fills.map((command) => iso(command.eventAt, 'FILL_TIME')).sort()[0];
  const evidenceIds = strings(
    related.flatMap((command) => command.evidenceIds),
    'TRADE_EVIDENCE',
    false,
  );
  const startEvidence = experiment.events
    .filter((event) => event.intentId === intent.id)
    .flatMap((event) => event.evidenceIds);
  return {
    intentId: intent.id,
    inferenceKind: 'FACT_DERIVATION',
    side: intent.side,
    assetId: intent.assetId,
    status: intent.status,
    requestedAtomic: intent.requestedAtomic,
    remainingAtomic: intent.remainingAtomic,
    fillCount: fills.length,
    feeAtomic: fees.toString(),
    executionDelayMs:
      firstFillAt === undefined
        ? { state: 'unavailable', value: null, reason: 'NO_FILL_OBSERVED' }
        : {
            state: 'known',
            value: new Date(firstFillAt).getTime() - new Date(intent.createdAt).getTime(),
            reason: null,
          },
    errorDecomposition: {
      fee: { state: 'known', valueAtomic: fees.toString(), unit: 'NATIVE_ATOMIC' },
      unfilled: {
        state: 'known',
        valueAtomic: intent.remainingAtomic,
        unit: intent.side === 'BUY' ? 'QUOTE_ATOMIC' : 'TOKEN_ATOMIC',
      },
      slippage: {
        state: 'unavailable',
        valueAtomic: null,
        reason: 'NO_SAME_SNAPSHOT_BENCHMARK_IN_COMMAND_JOURNAL',
      },
    },
    evidenceIds: strings([...evidenceIds, ...startEvidence], 'TRADE_EVIDENCE', true),
  };
}

function validateObservation(
  observation: PaperAtomicObservation,
  field: string,
  asOf: string,
  decisionAt: string,
  decisionVisible: boolean,
): bigint | undefined {
  if (observation.state !== 'known') {
    if (!observation.reason.trim()) throw new Error(`PAPER_REVIEW_${field}_REASON_REQUIRED`);
    return undefined;
  }
  const observedAt = iso(observation.observedAt, `${field}_OBSERVED_AT`);
  const availableAt = iso(observation.availableAt, `${field}_AVAILABLE_AT`);
  if (observedAt > asOf || availableAt > asOf) {
    throw new Error(`PAPER_REVIEW_${field}_AFTER_AS_OF`);
  }
  if (decisionVisible && availableAt > decisionAt) {
    throw new Error(`PAPER_REVIEW_${field}_LOOK_AHEAD`);
  }
  if (!observation.sourceId.trim()) throw new Error(`PAPER_REVIEW_${field}_SOURCE_REQUIRED`);
  return atomic(observation.valueAtomic, field);
}

function reviewRejected(
  experiment: PaperExperiment,
  input: RejectedCandidateReviewInput,
  asOf: string,
): RejectedCandidateReview {
  if (input.chain !== experiment.chain) throw new Error('PAPER_REVIEW_CHAIN_CONFLICT');
  const decisionAt = iso(input.decisionAt, 'DECISION_AT');
  const evaluatedAt = iso(input.evaluatedAt, 'EVALUATED_AT');
  if (decisionAt > evaluatedAt || evaluatedAt > asOf) {
    throw new Error('PAPER_REVIEW_TIME_ORDER_INVALID');
  }
  const values = {
    entryCost: validateObservation(input.entryCost, 'ENTRY_COST', asOf, decisionAt, true),
    laterExitProceeds: validateObservation(
      input.laterExitProceeds,
      'LATER_EXIT_PROCEEDS',
      asOf,
      decisionAt,
      false,
    ),
    estimatedCosts: validateObservation(
      input.estimatedCosts,
      'ESTIMATED_COSTS',
      asOf,
      decisionAt,
      false,
    ),
    exitCapacity: validateObservation(input.exitCapacity, 'EXIT_CAPACITY', asOf, decisionAt, false),
  };
  const missingStates = (Object.entries(values) as Array<[keyof typeof values, bigint | undefined]>)
    .filter((entry) => entry[1] === undefined)
    .map((entry) => entry[0]);
  const evidenceIds = strings(input.evidenceIds, 'REJECTED_EVIDENCE', true);
  const knownCount = Object.values(values).filter((value) => value !== undefined).length;
  if (missingStates.length > 0) {
    return {
      candidateId: input.candidateId,
      inferenceKind: 'COUNTERFACTUAL_ESTIMATE',
      assetId: input.assetId,
      chain: input.chain,
      strategyVersion: input.strategyVersion,
      decisionAt,
      evaluatedAt,
      rejectionReasons: strings(input.rejectionReasons, 'REJECTION_REASONS', true),
      outcome: 'UNDETERMINED',
      executableExitProceedsAtomic: null,
      netCounterfactualPnlAtomic: null,
      netCounterfactualReturnBps: null,
      missingStates,
      evidenceIds,
      confidence: {
        value: knownCount === 0 ? null : knownCount / 4,
        meaning: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY',
      },
    };
  }
  const entryCost = values.entryCost!;
  if (entryCost <= 0n) throw new Error('PAPER_REVIEW_ENTRY_COST_MUST_BE_POSITIVE');
  const executableExitProceeds =
    values.laterExitProceeds! < values.exitCapacity!
      ? values.laterExitProceeds!
      : values.exitCapacity!;
  const pnl = executableExitProceeds - values.estimatedCosts! - entryCost;
  return {
    candidateId: input.candidateId,
    inferenceKind: 'COUNTERFACTUAL_ESTIMATE',
    assetId: input.assetId,
    chain: input.chain,
    strategyVersion: input.strategyVersion,
    decisionAt,
    evaluatedAt,
    rejectionReasons: strings(input.rejectionReasons, 'REJECTION_REASONS', true),
    outcome: pnl > 0n ? 'EXECUTABLE_GAIN' : 'EXECUTABLE_LOSS_OR_FLAT',
    executableExitProceedsAtomic: executableExitProceeds.toString(),
    netCounterfactualPnlAtomic: pnl.toString(),
    netCounterfactualReturnBps: ((pnl * 10_000n) / entryCost).toString(),
    missingStates: [],
    evidenceIds,
    confidence: { value: 1, meaning: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY' },
  };
}

function observationSources(observation: PaperAtomicObservation): string[] {
  return observation.sourceId === undefined || observation.sourceId.trim().length === 0
    ? []
    : [observation.sourceId.trim()];
}

export function buildPaperReview(input: {
  experiment: PaperExperiment;
  commands: readonly PaperCommand[];
  rejectedCandidates: readonly RejectedCandidateReviewInput[];
  asOf: string;
}): PaperReviewReport {
  validateJournal(input.experiment, input.commands);
  const asOf = iso(input.asOf, 'AS_OF');
  if (asOf < input.experiment.updatedAt) throw new Error('PAPER_REVIEW_AS_OF_BEFORE_STATE');
  const trades = input.experiment.intents.map((intent) =>
    reviewTrade(input.experiment, input.commands, intent),
  );
  const rejectedCandidates = input.rejectedCandidates.map((candidate) =>
    reviewRejected(input.experiment, candidate, asOf),
  );
  const sourceSet = strings(
    input.rejectedCandidates.flatMap((candidate) => [
      ...observationSources(candidate.entryCost),
      ...observationSources(candidate.laterExitProceeds),
      ...observationSources(candidate.estimatedCosts),
      ...observationSources(candidate.exitCapacity),
    ]),
    'SOURCE_SET',
  );
  const evidenceIds = strings(
    [
      ...trades.flatMap((trade) => trade.evidenceIds),
      ...rejectedCandidates.flatMap((candidate) => candidate.evidenceIds),
    ],
    'REPORT_EVIDENCE',
    trades.length + rejectedCandidates.length > 0,
  );
  const reviewedRejections = rejectedCandidates.filter(
    (candidate) => candidate.outcome !== 'UNDETERMINED',
  ).length;
  const commandJournalHash = hashPayload(input.commands);
  const snapshotCore = {
    asOf,
    experimentStateHash: hashPayload(input.experiment),
    commandJournalHash,
    sourceSet,
  };
  const snapshot = {
    id: `psn_${hashPayload(snapshotCore).slice(0, 24)}`,
    ...snapshotCore,
    replayHash: hashPayload({ snapshotCore, evidenceIds }),
  };
  const reportCore = {
    schemaVersion: 'paper-review-v1' as const,
    experimentId: input.experiment.id,
    chain: input.experiment.chain,
    asOf,
    historicalState: true as const,
    snapshot,
    trades,
    rejectedCandidates,
    coverage: {
      tradeIntents: coverage(input.experiment.intents.length, trades.length),
      rejectedCounterfactuals: coverage(rejectedCandidates.length, reviewedRejections),
    },
    freshness: { state: 'HISTORICAL_AS_OF' as const, asOf },
    evidenceIds,
    modelVersion: PAPER_REVIEW_MODEL_VERSION as typeof PAPER_REVIEW_MODEL_VERSION,
    confidence: {
      value:
        rejectedCandidates.length === 0
          ? trades.length === 0
            ? null
            : 1
          : reviewedRejections / rejectedCandidates.length,
      meaning: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY' as const,
    },
    limitations: [
      '反事实结果是按声明成本与退出容量计算的历史估计，不是实际可实现收益证明。',
      '缺少同 Snapshot 基准时，滑点误差保持 unavailable，不以 0 代替。',
      '当前状态不代表历史状态；本报告只对应冻结的 asOf 与命令日志。',
    ],
  };
  return { id: `prv_${hashPayload(reportCore).slice(0, 24)}`, ...reportCore };
}
