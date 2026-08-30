import { describe, expect, it } from 'vitest';

import { applyPaperCommand, createPaperExperiment, type PaperCommand } from './paper-simulation.js';
import {
  buildPaperReview,
  type PaperAtomicObservation,
  type RejectedCandidateReviewInput,
} from './paper-review.js';

const evidence = `ev_${'2'.repeat(24)}`;
const assetId = `0x${'a'.repeat(40)}`;
const startAt = '2026-08-31T00:00:00.000Z';

function experimentAndJournal() {
  let experiment = createPaperExperiment({
    name: 'BSC 复盘实验',
    chain: 'BSC',
    initialPrincipalAtomic: '1000000000000000000',
    createdAt: startAt,
    policy: {
      version: 'V11.0',
      targetPositionBps: 500,
      maxSinglePositionBps: 1_000,
      maxControllerGroupBps: 1_500,
      maxNarrativeGroupBps: 2_500,
      maxTotalInvestedBps: 6_000,
      minimumUncommittedCashBps: 1_500,
      minimumFeeReserveBps: 500,
      opaqueTokenStressLossBps: 10_000,
    },
  });
  const start: PaperCommand = {
    type: 'START_BUY',
    commandId: 'start-1',
    assetId,
    strategyVersion: 'strategy-v1',
    candidateEpoch: 'epoch-1',
    eventAt: startAt,
    reasons: ['固定门槛通过'],
    evidenceIds: [evidence],
    controllerGroupId: 'controller-1',
    narrativeGroupId: 'narrative-1',
    requestedQuoteAtomic: '50000000000000000',
    maximumFeeAtomic: '1000000000000000',
    maximumWorstLossAtomic: '100000000000000000',
    exitCapacityQuoteAtomic: '80000000000000000',
    quoteAvailableAt: '2026-08-30T23:59:59.000Z',
    quoteValidUntil: '2026-08-31T00:00:10.000Z',
    hardConditions: [{ id: 'sellable', state: 'PASS' }],
  };
  experiment = applyPaperCommand(experiment, start);
  const fill: PaperCommand = {
    type: 'RECORD_BUY_FILL',
    commandId: 'fill-1',
    assetId,
    strategyVersion: 'strategy-v1',
    candidateEpoch: 'epoch-1',
    eventAt: '2026-08-31T00:00:02.000Z',
    reasons: ['模拟成交回执'],
    evidenceIds: [evidence],
    intentId: experiment.intents[0]!.id,
    fillId: 'fill-1',
    quoteSpentAtomic: '50000000000000000',
    feeAtomic: '100000000000000',
    tokenReceivedAtomic: '100',
    final: true,
  };
  experiment = applyPaperCommand(experiment, fill);
  return { experiment, commands: [start, fill] };
}

function known(valueAtomic: string, availableAt: string): PaperAtomicObservation {
  return {
    state: 'known',
    valueAtomic,
    sourceId: 'official-chain-observation',
    observedAt: availableAt,
    availableAt,
  };
}

function rejected(overrides: Partial<RejectedCandidateReviewInput> = {}) {
  return {
    candidateId: 'candidate-rejected-1',
    assetId: `0x${'b'.repeat(40)}`,
    chain: 'BSC' as const,
    strategyVersion: 'strategy-v1',
    decisionAt: '2026-08-31T00:01:00.000Z',
    evaluatedAt: '2026-08-31T01:00:00.000Z',
    rejectionReasons: ['退出容量不足'],
    evidenceIds: [evidence],
    entryCost: known('10', '2026-08-31T00:00:59.000Z'),
    laterExitProceeds: known('30', '2026-08-31T00:59:00.000Z'),
    estimatedCosts: known('2', '2026-08-31T00:59:00.000Z'),
    exitCapacity: known('20', '2026-08-31T00:59:00.000Z'),
    ...overrides,
  } satisfies RejectedCandidateReviewInput;
}

describe('模拟交易复盘与拒绝反事实', () => {
  it('从完整命令日志重放成交、费用、延迟及有容量上限的反事实', () => {
    const { experiment, commands } = experimentAndJournal();
    const report = buildPaperReview({
      experiment,
      commands,
      rejectedCandidates: [rejected()],
      asOf: '2026-08-31T01:01:00.000Z',
    });

    expect(report.historicalState).toBe(true);
    expect(report.trades[0]).toMatchObject({
      status: 'FILLED',
      fillCount: 1,
      feeAtomic: '100000000000000',
      executionDelayMs: { state: 'known', value: 2_000 },
      errorDecomposition: { slippage: { state: 'unavailable', valueAtomic: null } },
    });
    expect(report.rejectedCandidates[0]).toMatchObject({
      outcome: 'EXECUTABLE_GAIN',
      executableExitProceedsAtomic: '20',
      netCounterfactualPnlAtomic: '8',
      netCounterfactualReturnBps: '8000',
      confidence: { meaning: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY' },
    });
    expect(report.coverage.rejectedCounterfactuals).toMatchObject({
      eligible: 1,
      covered: 1,
      ratio: 1,
    });
    expect(
      buildPaperReview({
        experiment,
        commands,
        rejectedCandidates: [rejected()],
        asOf: '2026-08-31T01:01:00.000Z',
      }),
    ).toEqual(report);
  });

  it('缺失退出容量时保持未定与 null，不把边界当成已实现收益', () => {
    const { experiment, commands } = experimentAndJournal();
    const report = buildPaperReview({
      experiment,
      commands,
      rejectedCandidates: [
        rejected({ exitCapacity: { state: 'unavailable', reason: '历史池深度不可重放' } }),
      ],
      asOf: '2026-08-31T01:01:00.000Z',
    });
    expect(report.rejectedCandidates[0]).toMatchObject({
      outcome: 'UNDETERMINED',
      executableExitProceedsAtomic: null,
      netCounterfactualPnlAtomic: null,
      netCounterfactualReturnBps: null,
      missingStates: ['exitCapacity'],
      confidence: { value: 0.75 },
    });
    expect(report.coverage.rejectedCounterfactuals).toMatchObject({ covered: 0, ratio: 0 });
  });

  it('拒绝决策后才可见的入场输入和被篡改的命令日志', () => {
    const { experiment, commands } = experimentAndJournal();
    expect(() =>
      buildPaperReview({
        experiment,
        commands,
        rejectedCandidates: [rejected({ entryCost: known('10', '2026-08-31T00:01:01.000Z') })],
        asOf: '2026-08-31T01:01:00.000Z',
      }),
    ).toThrow('PAPER_REVIEW_ENTRY_COST_LOOK_AHEAD');
    expect(() =>
      buildPaperReview({
        experiment,
        commands: [{ ...commands[0]!, reasons: ['篡改'] }, commands[1]!],
        rejectedCandidates: [],
        asOf: '2026-08-31T01:01:00.000Z',
      }),
    ).toThrow('PAPER_REVIEW_COMMAND_JOURNAL_CONFLICT');
  });
});
