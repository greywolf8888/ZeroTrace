import { it, expect } from 'vitest';
import { settlementResult } from '../../../packages/arc-task-ledger/src/result.js';
import { accountPending, settlement } from '../../../packages/arc-task-ledger/src/settlement.js';
import { amount, known } from '../../../packages/arc-task-ledger/src/types.js';
import {
  run,
  meta,
  receipt,
  completeLogs,
  event,
  transfer,
  WORKER,
  POSTER,
} from '../fixtures/helpers.js';
import { protocolAtoms } from '../../../packages/arc-task-ledger/src/protocol.js';
import { DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';

it('无证据不是已付0，首屏结果不能将面值当实际报酬', () => {
  const d = run().jobs[0]!;
  const result = settlementResult(d);
  expect(result.metrics.find((m) => m.key === 'worker')!.amount.atomic.state).toBe('unknown');
  expect(result.metrics.find((m) => m.key === 'outstanding')!.amount.atomic.state).toBe('unknown');
});

it('R1 部分历史下直接收款不能证明本任务总未清偿额为零，账户余额不归到任务', () => {
  const d = run().jobs[0]!;
  const cash = settlement(meta(), [{ receipt: receipt(completeLogs()), evidenceIds: ['direct'] }]);
  d.settlementLegs = cash.legs;
  d.job.cashState = cash.cashState;
  d.pendingAccounts = [
    {
      payee: WORKER,
      balance: amount(known(protocolAtoms('500000'))),
      history: 'partial',
      withdrawals: [],
      obligations: [],
      sequenceDerivedJobIds: [],
      evidenceIds: ['account'],
    },
  ];
  expect(
    settlementResult(d).metrics.find((m) => m.key === 'outstanding')!.amount.atomic.state,
  ).toBe('unknown');
});

it('R2 发布者与工作者超时份额独立展示，不冒充奖励或退款', () => {
  const d = run().jobs[0]!;
  const cash = settlement(meta(), [
    {
      receipt: receipt([
        transfer(DEPLOYMENT.adapter, POSTER, protocolAtoms('500000'), 0),
        transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('500000'), 1),
        event(
          'ArbitratorTimeoutClaimed',
          { jobId: 8n, posterAmount: 500000n, providerAmount: 500000n },
          2,
        ),
      ]),
      evidenceIds: ['timeout'],
    },
  ]);
  d.settlementLegs = cash.legs;
  d.job.cashState = cash.cashState;
  const result = settlementResult(d);
  for (const key of ['worker_timeout', 'poster_timeout']) {
    expect(result.metrics.find((m) => m.key === key)?.amount.atomic).toMatchObject({
      state: 'known',
      value: protocolAtoms('500000'),
    });
  }
  expect(result.metrics.find((m) => m.key === 'refund')!.amount.atomic.state).toBe('unknown');
});

it('R3 具体奖励义务的后续领取单列，只计本任务份额且不重复计整笔账户提现', () => {
  const d = run().jobs[0]!;
  const logs = [
    ...completeLogs().filter((l) => BigInt(l.logIndex) !== 3n),
    event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 990000n }, 5),
    event('PayoutParked', { jobId: 9n, payee: WORKER, amount: 500000n }, 6),
    transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('1490000'), 7),
    event('WithdrawalClaimed', { payee: WORKER, amount: 1490000n }, 8),
  ];
  const proof = { receipt: receipt(logs), evidenceIds: ['sequence'] };
  d.settlementLegs = settlement(meta(), [
    { receipt: receipt(logs.slice(0, 5)), evidenceIds: ['sequence'] },
  ]).legs;
  const account = accountPending(WORKER, known('0'), [proof], true, known('0'));
  // 同一记录重复出现不能使投影重复计款。
  d.pendingAccounts = [account, structuredClone(account)];
  d.job.cashState = 'VERIFIED_SEQUENCE_DERIVED';
  const result = settlementResult(d);
  expect(result.metrics.find((m) => m.key === 'worker_claimed')?.amount.atomic).toMatchObject({
    state: 'known',
    value: protocolAtoms('990000'),
  });
  expect(result.metrics.find((m) => m.key === 'worker')!.amount.atomic).toMatchObject({
    state: 'known',
    value: '0',
  });
  expect(result.metrics.find((m) => m.key === 'outstanding')!.amount.atomic.state).toBe('unknown');
});
it('同一结果模型解释正常奖励且不合并存入中转与报酬', () => {
  const d = run().jobs[0]!;
  const cash = settlement(meta(), [{ receipt: receipt(completeLogs()), evidenceIds: ['local'] }]);
  d.settlementLegs = cash.legs;
  d.job.cashState = cash.cashState;
  expect(settlementResult(d).metrics.find((m) => m.key === 'worker')!.amount.atomic).toMatchObject({
    state: 'known',
    value: protocolAtoms('990000'),
  });
  expect(settlementResult(d).metrics.find((m) => m.key === 'fee')!.amount.atomic).toMatchObject({
    state: 'known',
    value: protocolAtoms('10000'),
  });
});
it('旧保证金清偿不能清除新奖励；账户余额不重复归属每个任务', () => {
  const d = run().jobs[0]!;
  const logs = [
    event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 500000n }, 0),
    transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('500000'), 1),
    event('WithdrawalClaimed', { payee: WORKER, amount: 500000n }, 2),
    event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 990000n }, 3),
    event('PayoutParked', { jobId: 9n, payee: WORKER, amount: 1000000n }, 4),
  ];
  d.pendingAccounts = [
    accountPending(
      WORKER,
      known(protocolAtoms('1990000')),
      [{ receipt: receipt(logs), evidenceIds: ['local-sequence'] }],
      true,
      known('0'),
    ),
  ];
  const result = settlementResult(d);
  expect(result.metrics.find((m) => m.key === 'outstanding')!.amount.atomic).toMatchObject({
    state: 'known',
    value: protocolAtoms('990000'),
  });
});
