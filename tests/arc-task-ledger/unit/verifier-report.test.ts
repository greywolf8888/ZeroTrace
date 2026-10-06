import { describe, it, expect } from 'vitest';
import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  buildReportBundle,
  buildSettlementReport,
  replayReportBundle,
  assertReportJson,
} from '../../../packages/arc-task-ledger/src/verifier-report.js';
import {
  normalizeTransaction,
  parseExpectation,
} from '../../../packages/arc-task-ledger/src/verifier-core.js';
import type { TransactionObservation } from '../../../packages/arc-task-ledger/src/transaction-reader.js';
import { browserReplayReportBundle } from '../../../packages/arc-task-ledger/src/verifier-browser-replay.js';
import { POSTER, WORKER, TX, HASH, transfer, receipt } from '../fixtures/helpers.js';

function observation(): TransactionObservation {
  const block = { hash: HASH, number: '0x14fb180', timestamp: '0x68e09000', transactions: [TX] };
  const raw = {
    chainId: '0x13b2',
    transaction: {
      hash: TX,
      from: POSTER,
      to: WORKER,
      value: '0xde0b6b3a7640000',
      blockHash: HASH,
      blockNumber: block.number,
      transactionIndex: '0x0',
    },
    receipt: receipt(
      [{ ...transfer(POSTER, WORKER, '1000000000000000000', 0), transactionIndex: '0x0' }],
      { transactionIndex: '0x0' },
    ),
    finalized: block,
    blockBefore: block,
    blockAfter: block,
  };
  return {
    transactionHash: TX,
    raw,
    acquisition: normalizeTransaction(TX, raw),
    source: {
      alias: 'test-only',
      observedAt: '2026-10-07T00:00:00Z',
      agreement: 'SINGLE_SOURCE',
      independence: 'NOT_VERIFIED',
      authenticity: 'RPC_SOURCE_REPORTED',
    },
    metrics: { elapsedMs: 1, rpcRequests: 6, rpcAttempts: 6, responseBytes: 100, cacheHit: false },
    collectionError: null,
  };
}
const condition = () =>
  parseExpectation({
    schemaVersion: 'zasv-expectation-v1',
    chainId: '5042',
    asset: 'USDC',
    expectedPayee: WORKER,
    amountMode: 'EXACT',
    minAmountAtomic18: '1000000000000000000',
    maxAmountAtomic18: '1000000000000000000',
    selection: [`5042:${TX}:0`],
    provenance: 'USER_INPUT',
  });
describe('不可覆盖报告与原件复算，合成数据不证明主网真实性', () => {
  it('WebCrypto与Node规范序列化/三层标识一致；Unicode/指数数字向量与非JSON值校验', async () => {
    expect(canonicalJson({ z: 1e30, a: '欧元€😀', n: 0.000001 })).toBe(
      '{"a":"欧元€😀","n":0.000001,"z":1e+30}',
    );
    const b = buildReportBundle(observation(), condition());
    const browser = await browserReplayReportBundle(b),
      node = replayReportBundle(b);
    expect(browser.reportId).toBe(node.reportId);
    expect(browser.factsHash).toBe(node.factsHash);
    expect(browser.expectationHash).toBe(b.report.expectationHash);
    for (const value of [NaN, Infinity, undefined, '\ud800'])
      expect(() => assertReportJson(value)).toThrow();
  });
  it('协议条件必须绑定固定任务投影；离线保留来源声明，不能凭输入自称协议结果', () => {
    const o = observation();
    const e = { ...condition(), provenance: 'REGISTERED_TASK' as const };
    expect(() => buildReportBundle(o, e)).toThrow('固定协议投影');
    o.taskContext = {
      schemaVersion: 'zasv-task-context-v1',
      jobId: '8',
      legId: 'test-only-leg',
      snapshotRunId: 'test_snapshot',
      ruleVersion: 'atl-v1.2.1',
      expectedPayee: WORKER,
      expectedAmountAtomic18: e.minAmountAtomic18,
      evidenceIds: ['test-only-source'],
      rawEvidence: [{ fixture: true }],
    };
    const b = buildReportBundle(o, e);
    expect(replayReportBundle(b).recomputation).toBe('PASS');
    o.taskContext.expectedAmountAtomic18 = '2';
    expect(() => buildReportBundle(o, e)).toThrow('固定协议投影');
  });
  it('三个哈希分层：时间/来源改变不变事实和评估，原件包改变', () => {
    const a = observation(),
      b = observation();
    b.source.observedAt = '2026-10-07T01:00:00Z';
    b.source.alias = 'other-test-only';
    b.metrics.elapsedMs = 99;
    const first = buildReportBundle(a, condition()),
      second = buildReportBundle(b, condition());
    expect(first.report.factsHash).toBe(second.report.factsHash);
    expect(first.report.reportId).toBe(second.report.reportId);
    expect(first.bundleHash).not.toBe(second.bundleHash);
    expect(replayReportBundle(first).recomputation).toBe('PASS');
    expect(
      buildSettlementReport(a, {
        ...condition(),
        maxAmountAtomic18: '2000000000000000000',
        amountMode: 'RANGE',
      }).reportId,
    ).not.toBe(first.report.reportId);
  });
  it('从原件重解析：仅改结论且重新包装摘要也不能骗过复算', () => {
    const b = buildReportBundle(observation(), condition());
    b.report.evaluation!.outcome = 'MISMATCHED';
    const rest = { schemaVersion: b.schemaVersion, report: b.report, observation: b.observation };
    b.bundleHash = hashPayload(rest);
    expect(() => replayReportBundle(b)).toThrow('从原始回执重新解析');
  });
  it('金额原件篡改、未知规则、原件声明事实篡改分别拒绝', () => {
    const a = buildReportBundle(observation(), condition());
    a.observation.raw.receipt!.logs[0]!.data = '0x' + '0'.repeat(63) + '2';
    expect(() => replayReportBundle(a)).toThrow('完整性');
    const b = buildReportBundle(observation(), condition());
    b.report.ruleVersion = 'fake';
    expect(() => replayReportBundle(b)).toThrow('不支持');
    const c = buildReportBundle(observation(), condition());
    c.observation.acquisition.code = 'FAKE';
    const rest = { schemaVersion: c.schemaVersion, report: c.report, observation: c.observation };
    c.bundleHash = hashPayload(rest);
    expect(() => replayReportBundle(c)).toThrow('规范事实不一致');
  });
  it('自洽重造原件可离线一致，仍不能获得主网真实性背书', () => {
    const fabricated = observation();
    fabricated.raw.transaction!.from = WORKER;
    fabricated.acquisition = normalizeTransaction(TX, fabricated.raw);
    const b = buildReportBundle(fabricated, condition());
    const proof = replayReportBundle(b);
    expect(proof.integrity).toBe('PASS');
    expect(proof.mainnetAuthenticity).toBe('NOT_VERIFIED_OFFLINE');
  });
  it('既有规范排序符合新报告向量；只对新报告拒绝非法JSON', () => {
    const vector = {
      numbers: [JSON.parse('333333333.33333329'), 1e30, 4.5, 2e-3, 1e-27],
      literals: [null, true, false],
      z: '€',
      a: '\u000f',
    };
    expect(canonicalJson(vector)).toBe(
      '{"a":"\\u000f","literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"z":"€"}',
    );
    expect(() => assertReportJson({ x: undefined })).toThrow();
    expect(() => assertReportJson({ x: Infinity })).toThrow();
    expect(() => assertReportJson('\ud800')).toThrow();
    expect(() => assertReportJson(JSON.parse('{"__proto__":{}}'))).toThrow();
  });
});
