import { describe, it, expect } from 'vitest';
import { accountPending, settlement } from '../../../packages/arc-task-ledger/src/settlement.js';
import {
  decodeReceipt,
  lifecycle,
  protocolAtoms,
  timeoutSplit,
} from '../../../packages/arc-task-ledger/src/protocol.js';
import { DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
import { known, unknown, decimal } from '../../../packages/arc-task-ledger/src/types.js';
import {
  meta,
  receipt,
  event,
  transfer,
  completeLogs,
  WORKER,
  POSTER,
  FEE,
} from '../fixtures/helpers.js';
const settle = (logs: ReturnType<typeof completeLogs>) =>
  settlement(meta(), [{ receipt: receipt(logs), evidenceIds: ['ev_test'] }]);
describe('资金与事实边界 ATL-01..20', () => {
  it('ATL-01 精确奖励与费用，单次分配', () => {
    const r = settle(completeLogs());
    expect(r.legs.filter((l) => l.kind === 'REWARD')).toHaveLength(1);
    expect(r.legs.find((l) => l.kind === 'REWARD')!.observedAmount.atomic).toMatchObject({
      state: 'known',
      value: '990000000000000000',
    });
    expect(r.legs.find((l) => l.kind === 'FEE')!.observedAmount.atomic).toMatchObject({
      value: '10000000000000000',
    });
  });
  it('ATL-02 双事件只入账一次并保留交叉状态', () => {
    const r = decodeReceipt(
      receipt([
        transfer(POSTER, WORKER, protocolAtoms('1'), 0),
        transfer(POSTER, WORKER, '1', 1, false),
      ]),
      ['ev_test'],
    );
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0]!.crossCheck).toBe('matched');
  });
  it('ATL-03 同身份重复日志去重', () => {
    const log = transfer(POSTER, WORKER, protocolAtoms('1'), 0);
    expect(decodeReceipt(receipt([log, log, log]), []).movements).toHaveLength(1);
  });
  it('ATL-04 完成与奖励待领取正交', () => {
    const logs = completeLogs().filter((l) => BigInt(l.logIndex) !== 3n);
    logs.push(event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 990000n }, 5));
    const r = settle(logs);
    expect(lifecycle(meta(), r.events)).toBe('APPROVED');
    expect(r.legs.find((l) => l.kind === 'REWARD')!.parkedAmount.atomic).toMatchObject({
      value: protocolAtoms('990000'),
    });
    expect(r.legs.find((l) => l.kind === 'REWARD')!.observedAmount.atomic).toMatchObject({
      value: '0',
    });
    expect(r.cashState).toBe('PARTIAL');
  });
  it('ATL-05 费用 Paid 名称不证明到账', () => {
    const logs = completeLogs().filter((l) => BigInt(l.logIndex) !== 1n);
    logs.push(event('PayoutParked', { jobId: 8n, payee: FEE, amount: 10000n }, 5));
    expect(settle(logs).legs.find((l) => l.kind === 'FEE')!.observedAmount.atomic).toMatchObject({
      state: 'known',
      value: '0',
    });
  });
  it('ATL-06 保证金退回待领取不算奖励', () => {
    const r = settle([
      event('WorkerBondRefunded', { jobId: 8n, worker: WORKER, amount: 500000n }, 0),
      event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 500000n }, 1),
    ]);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]!.kind).toBe('BOND_RETURN');
    expect(r.cashState).toBe('PARKED');
  });
  it('ATL-07 自动批准与完成不重复', () => {
    const r = settle([
      ...completeLogs(),
      event('BountyAutoApproved', { jobId: 8n, provider: WORKER }, 5),
    ]);
    expect(r.legs.filter((l) => l.kind === 'REWARD')).toHaveLength(1);
  });
  it('ATL-08 拒绝与取消共现只生成一退款', () => {
    const r = settle([
      event('RejectionFinalized', { jobId: 8n }, 0),
      event('BountyCancelled', { jobId: 8n, reason: '拒绝' }, 1),
      transfer(DEPLOYMENT.adapter, POSTER, protocolAtoms('1000000'), 2),
    ]);
    expect(r.legs.filter((l) => l.kind === 'REFUND')).toHaveLength(1);
    expect(lifecycle(meta(), r.events)).toBe('REJECTED');
  });
  it('ATL-09 奇数超时分账精确且无费', () => {
    expect(timeoutSplit('1000001')).toEqual(['500000', '500001']);
    const r = settle([
      event(
        'ArbitratorTimeoutClaimed',
        { jobId: 8n, posterAmount: 500000n, providerAmount: 500001n },
        0,
      ),
      transfer(DEPLOYMENT.adapter, POSTER, protocolAtoms('500000'), 1),
      transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('500001'), 2),
    ]);
    expect(r.legs.map((l) => l.observedAmount.atomic)).toEqual([
      known(protocolAtoms('500000'), ['ev_test']),
      known(protocolAtoms('500001'), ['ev_test']),
    ]);
    expect(r.legs.some((l) => l.kind === 'FEE')).toBe(false);
  });
  it('ATL-10 存入和托管中转不算收入', () => {
    const r = settle([
      event(
        'BountyCreated',
        { jobId: 8n, poster: POSTER, reward: 1000000n, category: '研发', deadline: 1n },
        0,
      ),
      transfer(POSTER, DEPLOYMENT.adapter, protocolAtoms('1000000'), 1),
      event('BountyTaken', { jobId: 8n, provider: WORKER, agentId: 0n }, 2),
      transfer(DEPLOYMENT.adapter, DEPLOYMENT.escrow, protocolAtoms('1000000'), 3),
    ]);
    expect(r.legs.map((l) => l.kind)).toEqual(['DEPOSIT', 'ESCROW_TRANSIT']);
    expect(r.cashState).toBe('NONE_OBSERVED');
  });
  it('ATL-11 同收款人退款与保证金保持独立且不重复消费', () => {
    const r = settle([
      event('BountyExpired', { jobId: 8n }, 0),
      event('WorkerBondForfeited', { jobId: 8n, poster: POSTER, amount: 500000n }, 1),
      transfer(DEPLOYMENT.adapter, POSTER, protocolAtoms('1500000'), 2),
    ]);
    expect(new Set(r.legs.map((l) => l.kind))).toEqual(new Set(['REFUND', 'BOND_FORFEIT']));
    expect(r.legs.every((l) => l.attribution === 'AMBIGUOUS')).toBe(true);
  });
  it('ATL-12 外部退款不虚构同交易托管入款', () => {
    const r = settle([
      event(
        'ExternalRefundReconciled',
        { jobId: 8n, poster: POSTER, worker: WORKER, posterAmount: 500000n, workerAmount: 500000n },
        0,
      ),
      transfer(DEPLOYMENT.adapter, POSTER, protocolAtoms('500000'), 1),
      transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('500000'), 2),
    ]);
    expect(r.legs.some((l) => l.kind === 'ESCROW_TRANSIT')).toBe(false);
    expect(r.cashState).toBe('CONFIRMED_DIRECT');
  });
  it('ATL-13 初始余额未知不分摊提现', () => {
    const r = accountPending(
      WORKER,
      known('0'),
      [
        {
          receipt: receipt([
            event('WithdrawalClaimed', { payee: WORKER, amount: 50n }, 0),
            transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('50'), 1),
          ]),
          evidenceIds: ['e'],
        },
      ],
      false,
      unknown('缺历史'),
    );
    expect(r.sequenceDerivedJobIds).toEqual([]);
    expect(r.withdrawals[0]!.attribution).toBe('ACCOUNT_ONLY');
  });
  it('ATL-14 完整账户序列推导，不 FIFO', () => {
    const r = accountPending(
      WORKER,
      known('0'),
      [
        {
          receipt: receipt([
            event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 30n }, 0),
            event('PayoutParked', { jobId: 19n, payee: WORKER, amount: 20n }, 1),
            event('WithdrawalClaimed', { payee: WORKER, amount: 50n }, 2),
            transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('50'), 3),
          ]),
          evidenceIds: ['e'],
        },
      ],
      true,
      known('0'),
    );
    expect(r.sequenceDerivedJobIds).toEqual(['8', '19']);
    expect(r.history).toBe('complete');
  });
  it('ATL-15 同收款角色不猜配', () => {
    const logs = completeLogs().map((l) => l);
    logs[2] = event('ProtocolFeePaid', { jobId: 8n, recipient: WORKER, amount: 10000n }, 2);
    logs[1] = transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('10000'), 1);
    expect(settle(logs).legs.every((l) => l.attribution === 'AMBIGUOUS')).toBe(true);
  });
  it('ATL-16 一交易多任务有歧义', () => {
    const r = settle([
      ...completeLogs(),
      event('BountyCompleted', { jobId: 19n, agentId: 0n, reputationScore: 100n }, 5),
    ]);
    expect(r.legs.every((l) => l.attribution === 'AMBIGUOUS')).toBe(true);
  });
  it('ATL-17 回滚交易没有结算', () => {
    const r = settlement(meta(), [
      { receipt: receipt(completeLogs(), { status: '0x0' }), evidenceIds: ['e'] },
    ]);
    expect(r.legs).toEqual([]);
    expect(r.cashState).toBe('NONE_OBSERVED');
  });
  it('ATL-18 同名代币不能冒充系统现金', () => {
    const l = transfer(POSTER, WORKER, '1', 0);
    l.address = FEE;
    expect(decodeReceipt(receipt([l]), []).movements).toEqual([]);
  });
  it('ATL-19 原生微额保留原子精度', () => {
    const r = decodeReceipt(receipt([transfer(POSTER, WORKER, '1000000000001', 0)]), []);
    expect(r.movements[0]!.atomic).toBe('1000000000001');
  });
  it('ATL-20 gas 独立不扣奖励', () => {
    const r = settle(completeLogs());
    expect(r.gas[0]!.amount.atomic).toMatchObject({ value: '21000' });
    expect(r.legs.find((l) => l.kind === 'REWARD')!.observedAmount.atomic).toMatchObject({
      value: protocolAtoms('990000'),
    });
  });
  it('ATL-32 截止时间经过不证明 expire 已执行', () => {
    expect(lifecycle(meta({ resolved: false, isTaken: false, submittedAt: '0' }), [])).toBe('OPEN');
  });
  it('金额和编号拒绝指数、小数、负数及超 uint256', () => {
    for (const v of ['-1', '1e5', '1.1', '01', (2n ** 256n).toString()])
      expect(() => decimal(v)).toThrow();
    expect(decimal('9007199254740993')).toBe('9007199254740993');
  });
  it('跨表示金额冲突冻结系统现金', () => {
    expect(
      decodeReceipt(
        receipt([
          transfer(POSTER, WORKER, protocolAtoms('2'), 0),
          transfer(POSTER, WORKER, '1', 1, false),
        ]),
        [],
      ).normalization,
    ).toBe('conflict');
  });
});
