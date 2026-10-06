import { describe, it, expect } from 'vitest';
import { decodeReceipt } from '../../../packages/arc-task-ledger/src/protocol.js';
import {
  normalizeTransaction,
  evaluateSettlement,
  parseExpectation,
  decimalUsdcToAtomic18,
  displayUsdc,
  parseTransactionInput,
  type RawAcquisition,
} from '../../../packages/arc-task-ledger/src/verifier-core.js';
import { POSTER, WORKER, TX, HASH, receipt, transfer } from '../fixtures/helpers.js';

function raw(logs = [transfer(POSTER, WORKER, '1000000000000000001', 0)]): RawAcquisition {
  const block = { hash: HASH, number: '0x14fb180', timestamp: '0x68e09000', transactions: [TX] };
  return {
    chainId: '0x13b2',
    transaction: {
      hash: TX,
      from: POSTER,
      to: WORKER,
      value: '0xde0b6b3a7640001',
      blockHash: HASH,
      blockNumber: block.number,
      transactionIndex: '0x0',
    },
    receipt: receipt(
      logs.map((l) => ({ ...l, transactionIndex: '0x0' })),
      { transactionIndex: '0x0' },
    ),
    finalized: block,
    blockBefore: block,
    blockAfter: block,
  };
}
const condition = (selection = [`5042:${TX}:0`]) =>
  parseExpectation({
    schemaVersion: 'zasv-expectation-v1',
    chainId: '5042',
    asset: 'USDC',
    expectedPayee: WORKER,
    amountMode: 'EXACT',
    minAmountAtomic18: '1000000000000000001',
    maxAmountAtomic18: '1000000000000000001',
    selection,
    provenance: 'USER_INPUT',
  });
describe('通用核验器：明确标记的合成语义反例', () => {
  it('保留18位尾数，以规范系统身份核对精确金额', () => {
    const a = normalizeTransaction(TX, raw());
    expect(a.state).toBe('READY');
    expect(a.facts?.movements[0]?.atomic).toBe('1000000000000000001');
    expect(evaluateSettlement(a, condition()).outcome).toBe('MATCHED');
    expect(decimalUsdcToAtomic18('1.000000000000000001')).toBe('1000000000000000001');
    expect(displayUsdc('1000000000000000001')).toBe('1.000000000000000001');
    expect(
      evaluateSettlement(a, {
        ...condition(),
        minAmountAtomic18: '1000000000000000000',
        maxAmountAtomic18: '1000000000000000000',
      }).outcome,
    ).toBe('MISMATCHED');
  });
  it('复现旧some镜像数量缺陷；新规则按多重集拒绝一对二', () => {
    const logs = [
      transfer(POSTER, WORKER, '1000000000000000000', 0),
      transfer(POSTER, WORKER, '1000000', 1, false),
      transfer(POSTER, WORKER, '1000000', 2, false),
    ];
    expect(decodeReceipt(receipt(logs), []).normalization).toBe('complete'); // 基线诊断，不继承为新规则。
    const a = normalizeTransaction(TX, raw(logs));
    expect(a.state).toBe('CONFLICT');
    expect(a.facts?.normalizationIssues).toContain('ERC20_MULTIPLICITY_CONFLICT');
    expect(evaluateSettlement(a, condition()).outcome).toBe('INCONCLUSIVE');
  });
  it('不同logIndex同额两笔保留；镜像不双计，配对歧义单列', () => {
    const a = normalizeTransaction(
      TX,
      raw([
        transfer(POSTER, WORKER, '1000000000000000000', 0),
        transfer(POSTER, WORKER, '1000000000000000000', 1),
        transfer(POSTER, WORKER, '1000000', 2, false),
        transfer(POSTER, WORKER, '1000000', 3, false),
      ]),
    );
    expect(a.state).toBe('READY');
    expect(a.facts?.movements).toHaveLength(2);
    expect(a.facts?.movements.every((m) => m.crossCheck === 'ambiguous')).toBe(true);
  });
  it('重复身份去重；同身份不同金额与变化区块拒绝', () => {
    const m = transfer(POSTER, WORKER, '1000000000000000001', 0);
    expect(normalizeTransaction(TX, raw([m, m])).facts?.movements).toHaveLength(1);
    expect(normalizeTransaction(TX, raw([m, transfer(POSTER, WORKER, '2', 0)])).code).toBe(
      'DUPLICATE_IDENTITY_CONFLICT',
    );
    const r = raw();
    r.blockAfter = { ...r.blockAfter!, hash: `0x${'c'.repeat(64)}` };
    expect(normalizeTransaction(TX, r).state).toBe('CONFLICT');
  });
  it('tx.from不替代movement付款人，收入/支出/净movement与Gas分开', () => {
    const r = raw([
      transfer(POSTER, WORKER, '1000000000000000001', 0),
      transfer(WORKER, POSTER, '500000000000000000', 1),
    ]);
    r.transaction!.from = WORKER;
    const a = normalizeTransaction(TX, r);
    const e = evaluateSettlement(a, { ...condition(), expectedMovementPayer: POSTER });
    expect(e.outcome).toBe('MATCHED');
    expect(e.account.netMovementAtomic18).toBe('500000000000000001');
    expect(e.account.gasAtomic18).not.toBeNull();
    expect(e.business.purpose).toBe('NOT_VERIFIED');
  });
  it('pending/错链/缺原件/removed不变成支付成功', () => {
    const pending = raw();
    pending.receipt = null;
    pending.transaction!.blockHash = null;
    pending.transaction!.blockNumber = null;
    expect(normalizeTransaction(TX, pending).state).toBe('PENDING');
    const wrong = raw();
    wrong.chainId = '0x1';
    expect(normalizeTransaction(TX, wrong).state).toBe('CONFLICT');
    const removed = raw();
    removed.receipt!.logs[0]!.removed = true;
    expect(normalizeTransaction(TX, removed).state).toBe('CONFLICT');
  });
  it('官方链接只解析哈希，拒绝任意URL和非精确金额', () => {
    expect(parseTransactionInput(`https://explorer.arc.io/tx/${TX}`)).toBe(TX);
    expect(() => parseTransactionInput(`https://127.0.0.1/tx/${TX}`)).toThrow();
    expect(() => decimalUsdcToAtomic18('1e6')).toThrow();
    expect(() => decimalUsdcToAtomic18('1.0000000000000000001')).toThrow();
    expect(() => parseExpectation({ ...condition(), deadline: '2026-02-30T00:00:00Z' })).toThrow();
  });
  it('批量、退款、mint/burn、零值、自转、失败与缺失日志的语义保持分开', () => {
    const zero = '0x' + '0'.repeat(40);
    const batch = normalizeTransaction(
      TX,
      raw([
        transfer(POSTER, WORKER, '1000000000000000001', 0),
        transfer(POSTER, WORKER, '2', 1),
        transfer(WORKER, POSTER, '3', 2),
      ]),
    );
    const combined = evaluateSettlement(batch, {
      ...condition([`5042:${TX}:0`, `5042:${TX}:1`]),
      minAmountAtomic18: '1000000000000000003',
      maxAmountAtomic18: '1000000000000000003',
    });
    expect(combined.outcome).toBe('MATCHED');
    expect(combined.account.outgoingAtomic18).toBe('3');
    for (const [from, to, kind] of [
      [zero, WORKER, 'MINT'],
      [WORKER, zero, 'BURN'],
    ] as const) {
      const a = normalizeTransaction(TX, raw([transfer(from, to, '1000000000000000001', 0)]));
      expect(a.facts?.movements[0]?.kind).toBe(kind);
      expect(evaluateSettlement(a, condition()).outcome).toBe('MISMATCHED');
    }
    for (const l of [transfer(WORKER, WORKER, '1', 0), transfer(POSTER, WORKER, '0', 0)])
      expect(normalizeTransaction(TX, raw([l])).state).toBe('CONFLICT');
    const ercZero = normalizeTransaction(TX, raw([transfer(POSTER, WORKER, '0', 0, false)]));
    expect(ercZero.facts?.movements).toHaveLength(0);
    const ercSelf = normalizeTransaction(TX, raw([transfer(WORKER, WORKER, '1000000', 0, false)]));
    expect(ercSelf.facts?.movements).toHaveLength(0);
    const failed = raw([]);
    failed.receipt!.status = '0x0';
    expect(evaluateSettlement(normalizeTransaction(TX, failed), condition()).outcome).toBe(
      'MISMATCHED',
    );
    const missing = raw();
    missing.receipt = null;
    expect(normalizeTransaction(TX, missing).state).toBe('UNAVAILABLE');
    const noSystem = normalizeTransaction(TX, raw([transfer(POSTER, WORKER, '1000000', 0, false)]));
    expect(noSystem.state).toBe('CONFLICT');
    const before = raw();
    before.finalized = { ...before.finalized!, number: '0x14fb17f' };
    expect(normalizeTransaction(TX, before).code).toBe('NOT_FINALIZED');
  });
});
