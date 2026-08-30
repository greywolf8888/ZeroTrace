import { describe, expect, it } from 'vitest';

import {
  applyPaperCommand,
  createPaperExperiment,
  pagePaperOutbox,
  type PaperCommand,
  type PaperPositionPolicy,
} from './paper-simulation.js';

const evidence = `ev_${'1'.repeat(24)}`;
const assetId = `0x${'a'.repeat(40)}`;
const at = '2026-08-31T00:00:00.000Z';
const policy: PaperPositionPolicy = {
  version: 'V11.0',
  targetPositionBps: 500,
  maxSinglePositionBps: 1_000,
  maxControllerGroupBps: 1_500,
  maxNarrativeGroupBps: 2_500,
  maxTotalInvestedBps: 6_000,
  minimumUncommittedCashBps: 1_500,
  minimumFeeReserveBps: 500,
  opaqueTokenStressLossBps: 10_000,
};

function experiment() {
  return createPaperExperiment({
    name: 'BSC 实验一',
    chain: 'BSC',
    initialPrincipalAtomic: '1000000000000000000',
    policy,
    createdAt: at,
  });
}

function base(commandId: string) {
  return {
    commandId,
    assetId,
    strategyVersion: 'strategy-v1',
    candidateEpoch: 'epoch-1',
    eventAt: at,
    reasons: ['固定规则通过'],
    evidenceIds: [evidence],
  };
}

function startBuy(commandId = 'buy-start'): Extract<PaperCommand, { type: 'START_BUY' }> {
  return {
    ...base(commandId),
    type: 'START_BUY',
    controllerGroupId: 'controller-1',
    narrativeGroupId: 'theme-1',
    requestedQuoteAtomic: '900000000000000000',
    maximumFeeAtomic: '1000000000000000',
    maximumWorstLossAtomic: '100000000000000000',
    exitCapacityQuoteAtomic: '80000000000000000',
    quoteAvailableAt: '2026-08-30T23:59:59.000Z',
    quoteValidUntil: '2026-08-31T00:00:01.000Z',
    hardConditions: [
      { id: 'sellable', state: 'PASS' },
      { id: 'fresh', state: 'PASS' },
    ],
  };
}

describe('双链纯模拟账本', () => {
  it('按最小资金上限预占并对命令严格幂等', () => {
    const initial = experiment();
    const command = startBuy();
    const started = applyPaperCommand(initial, command);

    expect(started.intents[0]).toMatchObject({
      side: 'BUY',
      requestedAtomic: '50000000000000000',
      reservedCashAtomic: '51000000000000000',
    });
    expect(started.availableCashAtomic).toBe('949000000000000000');
    expect(started.reservedCashAtomic).toBe('51000000000000000');
    expect(applyPaperCommand(started, command)).toBe(started);
    expect(() => applyPaperCommand(started, { ...command, requestedQuoteAtomic: '1' })).toThrow(
      'PAPER_COMMAND_ID_CONFLICT',
    );
  });

  it('未知硬条件、过期报价和未知可卖量均失败关闭', () => {
    expect(() =>
      applyPaperCommand(experiment(), {
        ...startBuy(),
        hardConditions: [{ id: 'sellable', state: 'UNKNOWN' }],
      }),
    ).toThrow('PAPER_BUY_HARD_CONDITION_NOT_MET');
    expect(() =>
      applyPaperCommand(experiment(), {
        ...startBuy(),
        quoteValidUntil: '2026-08-30T23:59:59.000Z',
      }),
    ).toThrow('PAPER_QUOTE_NOT_DECISION_AVAILABLE');

    const started = applyPaperCommand(experiment(), startBuy());
    const intentId = started.intents[0]!.id;
    const filled = applyPaperCommand(started, {
      ...base('buy-fill'),
      type: 'RECORD_BUY_FILL',
      intentId,
      fillId: 'fill-buy-1',
      quoteSpentAtomic: '50000000000000000',
      feeAtomic: '100000000000000',
      tokenReceivedAtomic: '100',
      final: true,
    });
    expect(() =>
      applyPaperCommand(filled, {
        ...base('sell-start-unknown'),
        type: 'START_SELL',
        controllerGroupId: 'controller-1',
        narrativeGroupId: 'theme-1',
        requestedTokenAtomic: '100',
        sellableTokenAtomic: { state: 'unknown', reason: '池状态未固定' },
        maximumFeeAtomic: '1000',
        quoteAvailableAt: at,
        quoteValidUntil: '2026-08-31T00:00:01.000Z',
        urgent: true,
      }),
    ).toThrow('PAPER_SELLABLE_UNKNOWN');
  });

  it('部分买入后失败保留持仓，部分卖出后失败也不虚构止损退出', () => {
    const started = applyPaperCommand(experiment(), startBuy());
    const buyIntent = started.intents[0]!.id;
    const partiallyBought = applyPaperCommand(started, {
      ...base('buy-fill-partial'),
      type: 'RECORD_BUY_FILL',
      intentId: buyIntent,
      fillId: 'fill-buy-partial',
      quoteSpentAtomic: '20000000000000000',
      feeAtomic: '100000000000000',
      tokenReceivedAtomic: '100',
      final: false,
    });
    const buyFailed = applyPaperCommand(partiallyBought, {
      ...base('buy-failed'),
      type: 'FAIL_BUY',
      intentId: buyIntent,
      failureFeeAtomic: '50000000000000',
    });
    expect(buyFailed.positions[0]).toMatchObject({
      quantityAtomic: '100',
      costBasisAtomic: '20100000000000000',
    });
    expect(buyFailed.reservedCashAtomic).toBe('0');

    const sellStarted = applyPaperCommand(buyFailed, {
      ...base('sell-start'),
      type: 'START_SELL',
      controllerGroupId: 'controller-1',
      narrativeGroupId: 'theme-1',
      requestedTokenAtomic: '100',
      sellableTokenAtomic: { state: 'known', value: '100' },
      maximumFeeAtomic: '100000000000000',
      quoteAvailableAt: at,
      quoteValidUntil: '2026-08-31T00:00:01.000Z',
      urgent: true,
    });
    const sellIntent = sellStarted.intents.at(-1)!.id;
    expect(sellStarted.events.slice(-2).map((event) => event.type)).toEqual([
      'RISK_EXIT_REQUIRED',
      'PAPER_SELL_STARTED',
    ]);
    const partiallySold = applyPaperCommand(sellStarted, {
      ...base('sell-fill-partial'),
      type: 'RECORD_SELL_FILL',
      intentId: sellIntent,
      fillId: 'fill-sell-partial',
      tokenSoldAtomic: '40',
      quoteReceivedAtomic: '10000000000000000',
      feeAtomic: '20000000000000',
      final: false,
    });
    const sellFailed = applyPaperCommand(partiallySold, {
      ...base('sell-failed'),
      type: 'FAIL_SELL',
      intentId: sellIntent,
      failureFeeAtomic: '10000000000000',
    });
    expect(sellFailed.positions[0]).toMatchObject({
      quantityAtomic: '60',
      reservedQuantityAtomic: '0',
      costBasisAtomic: '12060000000000000',
    });
    expect(sellFailed.intents.at(-1)?.status).toBe('FAILED');
    expect(sellFailed.events.at(-1)?.type).toBe('PAPER_SELL_FAILED');
  });

  it('提醒标题始终标明模拟动作，分页游标稳定且拒绝未知游标', () => {
    let state = experiment();
    state = applyPaperCommand(state, { ...base('candidate'), type: 'ENTER_CANDIDATE' });
    state = applyPaperCommand(state, {
      ...base('prepare'),
      type: 'PREPARE_BUY',
      currentValues: { price: 'unknown' },
      unmetConditions: ['等待价格'],
    });
    state = applyPaperCommand(state, startBuy());

    expect(
      state.outbox
        .filter((item) => item.eventType.includes('BUY'))
        .every((item) => item.title.includes('模拟')),
    ).toBe(true);
    const first = pagePaperOutbox(state, { limit: 2 });
    expect(first.records).toHaveLength(2);
    expect(first.nextCursor).toBe(first.records[1]?.id);
    const second = pagePaperOutbox(state, { after: first.nextCursor!, limit: 2 });
    expect(second.records).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(() => pagePaperOutbox(state, { after: 'pob_missing' })).toThrow(
      'PAPER_PAGE_CURSOR_INVALID',
    );
  });
});
