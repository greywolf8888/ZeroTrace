import { amount, known, unknown, type Amount, type JobDetail, type Knowledge } from './types.js';

export interface ResultMetric {
  key: string;
  label: string;
  amount: Amount;
  scope: 'OBSERVED' | 'VERIFIED_OBLIGATIONS' | 'FACE_VALUE';
  evidenceIds: string[];
}
export interface SettlementResult {
  schemaVersion: 'atl-settlement-result-v1';
  jobId: string;
  state: 'confirmed' | 'pending' | 'unknown' | 'conflict';
  conclusion: string;
  reasons: string[];
  nextAction: string;
  metrics: ResultMetric[];
  historyComplete: boolean;
  gas: {
    transactionHash: string;
    amount: Amount;
    payer: Knowledge<string>;
    scope: 'TRANSACTION_ONLY';
    evidenceIds: string[];
  }[];
}

/** 只解释已有领域结果，不重新匹配资金，也不把账户总余额归到任务。 */
export function settlementResult(detail: JobDetail): SettlementResult {
  const select = (key: string, label: string, kinds: string[]): ResultMetric => {
    const legs = detail.settlementLegs.filter(
      (l) =>
        kinds.includes(l.kind) &&
        (key !== 'worker' || l.role === 'WORKER') &&
        (key !== 'refund' || l.role === 'POSTER'),
    );
    const ids = [...new Set(legs.flatMap((l) => l.evidenceIds))];
    const values = legs.map((l) => l.observedAmount.atomic);
    return {
      key,
      label,
      scope: 'OBSERVED',
      evidenceIds: ids,
      amount: amount(
        !legs.length
          ? unknown('没有取得该分配的任务级证据；不能认定已付 0。')
          : values.some((v) => v.state !== 'known')
            ? unknown('至少一段资金归属或转移未能核验。')
            : known(
                values
                  .reduce((sum, v) => sum + BigInt(v.state === 'known' ? v.value : '0'), 0n)
                  .toString(),
                ids,
              ),
      ),
    };
  };
  const obligations = detail.pendingAccounts
    .flatMap((a) => a.obligations)
    .filter((o) => o.jobId === detail.job.jobId);
  const outstanding = obligations.filter((o) => o.status === 'OUTSTANDING');
  const uncertain = obligations.some(
    (o) => o.status === 'UNVERIFIED' || o.amount.atomic.state !== 'known',
  );
  const obligationIds = detail.pendingAccounts.flatMap((a) => a.evidenceIds);
  const historyComplete =
    detail.job.coverage.settlementHistory === 'complete' &&
    detail.job.coverage.accountPendingHistory === 'complete';
  // 即使历史不完整，具体已核验义务仍可给下限；不把未知义务清零。
  const unpaid = uncertain
    ? unknown<string>('具体义务的清偿序列尚未核验。')
    : outstanding.length
      ? known(
          outstanding
            .reduce(
              (sum, o) =>
                sum + BigInt(o.amount.atomic.state === 'known' ? o.amount.atomic.value : '0'),
              0n,
            )
            .toString(),
          obligationIds,
        )
      : detail.job.cashState === 'CONFIRMED_DIRECT' ||
          detail.job.cashState === 'NOT_APPLICABLE' ||
          detail.job.cashState === 'VERIFIED_SEQUENCE_DERIVED' ||
          historyComplete
        ? known('0', obligationIds)
        : unknown<string>('没有完整的任务义务及清偿证据；账户余额不能替代任务未清偿额。');
  const metrics: ResultMetric[] = [
    {
      key: 'face',
      label: '奖励面值',
      amount: detail.job.reward,
      scope: 'FACE_VALUE',
      evidenceIds: detail.job.reward.atomic.evidenceIds ?? [],
    },
    select('worker', '工作者已观察报酬', ['REWARD', 'TIMEOUT_SHARE']),
    select('fee', '已观察协议费', ['FEE']),
    select('refund', '发布者已观察退款', ['REFUND', 'BOND_FORFEIT']),
    {
      key: 'outstanding',
      label: '本任务已核验未清偿额',
      amount: amount(unpaid),
      scope: 'VERIFIED_OBLIGATIONS',
      evidenceIds: obligationIds,
    },
  ];
  const state =
    detail.job.cashState === 'CONFLICT'
      ? 'conflict'
      : ['CONFIRMED_DIRECT', 'VERIFIED_SEQUENCE_DERIVED', 'NOT_APPLICABLE'].includes(
            detail.job.cashState,
          )
        ? 'confirmed'
        : ['PARKED', 'PARTIAL'].includes(detail.job.cashState)
          ? 'pending'
          : 'unknown';
  return {
    schemaVersion: 'atl-settlement-result-v1',
    jobId: detail.job.jobId,
    state,
    conclusion:
      state === 'confirmed'
        ? '本任务的已识别资金分配已核验；请按各收款角色查看金额。'
        : state === 'pending'
          ? '已识别转入待领取的款项；是否已领取须逐项核对清偿关系。'
          : state === 'conflict'
            ? '资金证据存在冲突，不能确认付款。'
            : '目前无法确认本任务完整结算，缺失证据不表示已付 0。',
    reasons: [
      ...(historyComplete ? [] : ['历史不完整；金额仅覆盖已观察转移和已核验具体义务。']),
      ...(detail.job.coverage.sourceAgreement === 'complete'
        ? []
        : ['单来源或独立来源一致性尚未完整核验。']),
    ],
    nextAction:
      state === 'unknown'
        ? '查看缺失证据，并申请本部署内的有界补证；稍后重新加载已采集结果。'
        : '打开金额对应证据，复制固定快照链接或生成可读报告。',
    metrics,
    historyComplete,
    gas: detail.gas.map((g) => {
      const evidence = detail.evidence.find(
        (e) =>
          (e.raw as { transactionHash?: string } | null)?.transactionHash === g.transactionHash,
      );
      const from = (evidence?.raw as { from?: string } | undefined)?.from;
      return {
        ...g,
        payer:
          from && /^0x[\da-fA-F]{40}$/.test(from)
            ? known(from.toLowerCase(), [evidence!.id])
            : unknown<string>('回执未提供可核验的交易付费方。'),
        scope: 'TRANSACTION_ONLY',
        evidenceIds: evidence ? [evidence.id] : [],
      };
    }),
  };
}
