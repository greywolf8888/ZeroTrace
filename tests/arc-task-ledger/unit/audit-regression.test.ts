import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import {
  settlement,
  accountPending,
  sequenceCleared,
} from '../../../packages/arc-task-ledger/src/settlement.js';
import { decodeReceipt, protocolAtoms } from '../../../packages/arc-task-ledger/src/protocol.js';
import { DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
import { known, type RawLog } from '../../../packages/arc-task-ledger/src/types.js';
import {
  meta,
  receipt,
  event,
  transfer,
  completeLogs,
  WORKER,
  POSTER,
} from '../fixtures/helpers.js';

const settle = (logs: RawLog[]) =>
  settlement(meta(), [{ receipt: receipt(logs), evidenceIds: ['audit'] }]);
const pending = (logs: RawLog[], balance = '0', complete = true) =>
  accountPending(
    WORKER,
    known(protocolAtoms(balance)),
    [{ receipt: receipt(logs), evidenceIds: ['audit'] }],
    complete,
    known('0'),
  );

describe('审计反例：当前源码与真实 ABI，本地合成而非主网观察', () => {
  it.each([false, true])('REG-1 争议工作者胜诉含奖励，默认=%s', (isDefault) => {
    const logs = completeLogs().slice(0, 4);
    logs.push(
      event(
        'DisputeResolved',
        { jobId: 8n, payProvider: true, rulingHash: 'ruling', defaultRuling: isDefault },
        4,
      ),
    );
    const result = settle(logs);
    expect(result.legs.find((l) => l.kind === 'REWARD')?.observedAmount.atomic).toMatchObject({
      state: 'known',
      value: protocolAtoms('990000'),
    });
    expect(result.cashState).toBe('CONFIRMED_DIRECT');
  });
  it('REG-1 手续费到账不能掩盖缺失奖励', () => {
    const logs = completeLogs().filter((l) => BigInt(l.logIndex) !== 3n);
    logs[logs.length - 1] = event(
      'DisputeResolved',
      { jobId: 8n, payProvider: true, rulingHash: 'ruling', defaultRuling: false },
      4,
    );
    expect(settle(logs).cashState).toBe('UNKNOWN');
  });
  it('REG-2 保证金清空后新奖励不继承旧提现', () => {
    const logs = [
      event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 500000n }, 0),
      transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('500000'), 1),
      event('WithdrawalClaimed', { payee: WORKER, amount: 500000n }, 2),
      event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 990000n }, 3),
    ];
    const account = pending(logs, '990000');
    expect(account.history).toBe('complete');
    expect(account.sequenceDerivedJobIds).toEqual([]);
    expect(account.obligations.map((o) => o.status)).toEqual(['CLEARED_SEQUENCE', 'OUTSTANDING']);
    expect(account.withdrawals[0]!.obligationIds).toEqual([account.obligations[0]!.id]);
    expect(account.withdrawals[0]!.obligationIds).not.toContain(account.obligations[1]!.id);
    const result = settle([...completeLogs().filter((l) => BigInt(l.logIndex) !== 3n), logs[3]!]);
    expect(sequenceCleared(result.legs, result.cashState, [account])).toBe(false);
  });
  it('同任务重复停放与多任务清空按具体义务关联，不按FIFO', () => {
    const account = pending([
      event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 30n }, 0),
      event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 10n }, 1),
      event('PayoutParked', { jobId: 19n, payee: WORKER, amount: 20n }, 2),
      transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('60'), 3),
      event('WithdrawalClaimed', { payee: WORKER, amount: 60n }, 4),
    ]);
    expect(account.obligations).toHaveLength(3);
    expect(new Set(account.obligations.map((o) => o.id)).size).toBe(3);
    expect(account.withdrawals[0]!.obligationIds).toEqual(account.obligations.map((o) => o.id));
  });
  it('缺历史时不发布义务级清偿', () => {
    const account = pending(
      [
        event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 10n }, 0),
        transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('10'), 1),
        event('WithdrawalClaimed', { payee: WORKER, amount: 10n }, 2),
      ],
      '0',
      false,
    );
    expect(account.withdrawals[0]!.obligationIds).toEqual([]);
    expect(account.obligations[0]!.status).toBe('UNVERIFIED');
  });
  it.each([
    [1000000n, 0n],
    [0n, 1000000n],
    [0n, 0n],
    [400000n, 600000n],
  ])('REG-3 零/部分分配 %s/%s 不要求不存在的转移', (posterAmount, workerAmount) => {
    const logs = [
      event(
        'ExternalRefundReconciled',
        { jobId: 8n, poster: POSTER, worker: WORKER, posterAmount, workerAmount },
        0,
      ),
    ];
    if (posterAmount > 0n)
      logs.push(transfer(DEPLOYMENT.adapter, POSTER, protocolAtoms(String(posterAmount)), 1));
    if (workerAmount > 0n)
      logs.push(transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms(String(workerAmount)), 2));
    const result = settle(logs);
    expect(result.cashState).toBe(
      posterAmount + workerAmount === 0n ? 'NOT_APPLICABLE' : 'CONFIRMED_DIRECT',
    );
    expect(
      result.legs
        .filter(
          (l) => l.expectedAmount.atomic.state === 'known' && l.expectedAmount.atomic.value === '0',
        )
        .every((l) => l.attribution === 'ZERO_ALLOCATION'),
    ).toBe(true);
  });
  it('Approval+Transfer+协议事件使用viem真实解码，Approval不计现金', () => {
    const item = parseAbiItem(
      'event Approval(address indexed owner,address indexed spender,uint256 value)',
    );
    const approval = {
      ...transfer(POSTER, WORKER, '1', 6, false),
      topics: encodeEventTopics({
        abi: [item],
        eventName: 'Approval',
        args: { owner: POSTER, spender: DEPLOYMENT.escrow as `0x${string}` },
      }) as `0x${string}`[],
      data: encodeAbiParameters([{ type: 'uint256' }], [1000000n]),
    };
    const result = decodeReceipt(receipt([...completeLogs(), approval]), ['audit']);
    expect(result.normalization).toBe('complete');
    expect(result.movements).toHaveLength(3);
    expect(result.nonCashLogs[0]!.classification).toBe('APPROVAL');
  });
  it('已知Transfer损坏仍失败关闭', () => {
    const broken = transfer(DEPLOYMENT.adapter, WORKER, '1', 6, false);
    broken.data = '0x12';
    expect(decodeReceipt(receipt([...completeLogs(), broken]), []).normalization).toBe('conflict');
  });
  it('只有保证金到账不提升已终结任务为整体已确认', () => {
    expect(
      settle([
        event('WorkerBondRefunded', { jobId: 8n, worker: WORKER, amount: 500000n }, 0),
        transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('500000'), 1),
      ]).cashState,
    ).toBe('UNKNOWN');
  });
  it('已观察创建资金段缺失，不能只凭终结费用和奖励确认', () => {
    expect(
      settle([
        ...completeLogs(),
        event(
          'BountyCreated',
          { jobId: 8n, poster: POSTER, reward: 1000000n, category: '研发', deadline: 1n },
          7,
        ),
      ]).cashState,
    ).toBe('UNKNOWN');
  });
  it('无手续费事件不能假定零；锁定版本feeBps=0才允许证明零', () => {
    const logs = completeLogs().filter((l) => ![1n, 2n, 3n].includes(BigInt(l.logIndex)));
    logs.push(transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('1000000'), 6));
    expect(settle(logs).cashState).toBe('UNKNOWN');
    expect(
      settlement(meta(), [{ receipt: receipt(logs), evidenceIds: ['audit'] }], {
        feeBps: known('0', ['verified-view']),
        feeRecipient: POSTER,
      }).cashState,
    ).toBe('CONFIRMED_DIRECT');
  });
  it('合法ERC20零Transfer仍解码；协议零分配的意外转移不能吞掉', () => {
    const logs = [transfer(POSTER, WORKER, '0', 0), transfer(POSTER, WORKER, '0', 1, false)];
    expect(decodeReceipt(receipt(logs), []).movements[0]?.atomic).toBe('0');
    expect(
      settle([
        event(
          'ExternalRefundReconciled',
          { jobId: 8n, poster: POSTER, worker: WORKER, posterAmount: 0n, workerAmount: 0n },
          2,
        ),
        transfer(DEPLOYMENT.adapter, WORKER, '0', 3),
      ]).cashState,
    ).toBe('CONFLICT');
  });
  it('同任务再次提现按有序交易分别清偿', () => {
    const first = receipt([
      event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 10n }, 0),
      transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('10'), 1),
      event('WithdrawalClaimed', { payee: WORKER, amount: 10n }, 2),
    ]);
    const tx = `0x${'c'.repeat(64)}`;
    const second = receipt(
      [
        event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 20n }, 0),
        transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('20'), 1),
        event('WithdrawalClaimed', { payee: WORKER, amount: 20n }, 2),
      ].map((l) => ({ ...l, transactionHash: tx })),
      { transactionHash: tx, transactionIndex: '0x1' },
    );
    const account = accountPending(
      WORKER,
      known('0'),
      [
        { receipt: second, evidenceIds: ['second'] },
        { receipt: first, evidenceIds: ['first'] },
      ],
      true,
      known('0'),
    );
    expect(account.withdrawals.map((w) => w.obligationIds)).toEqual(
      account.obligations.map((o) => [o.id]),
    );
    expect(account.obligations.every((o) => o.status === 'CLEARED_SEQUENCE')).toBe(true);
  });
});
