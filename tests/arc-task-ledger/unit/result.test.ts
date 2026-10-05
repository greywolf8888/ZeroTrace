import { it, expect } from 'vitest';
import { settlementResult } from '../../../packages/arc-task-ledger/src/result.js';
import { accountPending, settlement } from '../../../packages/arc-task-ledger/src/settlement.js';
import { known } from '../../../packages/arc-task-ledger/src/types.js';
import { run, meta, receipt, completeLogs, event, transfer, WORKER } from '../fixtures/helpers.js';
import { protocolAtoms } from '../../../packages/arc-task-ledger/src/protocol.js';
import { DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';

it('无证据不是已付0，首屏结果不能将面值当实际报酬', () => {
  const d = run().jobs[0]!;
  const result = settlementResult(d);
  expect(result.metrics.find((m) => m.key === 'worker')!.amount.atomic.state).toBe('unknown');
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
