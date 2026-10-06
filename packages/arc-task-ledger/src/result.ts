import {
  amount,
  known,
  unknown,
  type Amount,
  type JobDetail,
  type Knowledge,
  type SettlementLeg,
} from './types.js';
import { DEPLOYMENT } from './config.js';

export interface ResultMetric {
  key: string;
  label: string;
  amount: Amount;
  scope: 'OBSERVED' | 'VERIFIED_OBLIGATIONS' | 'FACE_VALUE';
  qualifier: 'EXACT' | 'OBSERVED_SUBSET' | 'AT_LEAST' | 'UNKNOWN';
  role: SettlementLeg['role'] | 'TASK';
  phase: 'DIRECT' | 'CLAIMED' | 'OUTSTANDING' | 'FACE_VALUE';
  evidenceIds: string[];
}
export interface SettlementResult {
  schemaVersion: 'atl-settlement-result-v2';
  jobId: string;
  state: 'confirmed' | 'pending' | 'unknown' | 'conflict';
  conclusion: string;
  reasons: string[];
  nextAction: string;
  metrics: ResultMetric[];
  historyComplete: boolean;
  flows: {
    id: string;
    from: string;
    to: string;
    role: SettlementLeg['role'];
    kind: SettlementLeg['kind'];
    phase: 'DIRECT' | 'PARKED' | 'CLAIMED';
    amount: Amount;
    evidenceIds: string[];
    eventIds: string[];
    transactionHashes: string[];
  }[];
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
  const select = (
    key: string,
    label: string,
    role: SettlementLeg['role'],
    kinds: string[],
  ): ResultMetric => {
    const legs = detail.settlementLegs.filter((l) => kinds.includes(l.kind) && l.role === role);
    const ids = [...new Set(legs.flatMap((l) => l.evidenceIds))];
    const values = legs.map((l) => l.observedAmount.atomic);
    return {
      key,
      label,
      scope: 'OBSERVED',
      role,
      phase: 'DIRECT',
      qualifier:
        !legs.length || values.some((v) => v.state !== 'known') ? 'UNKNOWN' : 'OBSERVED_SUBSET',
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
  const obligations = [
    ...new Map(
      detail.pendingAccounts
        .flatMap((a) => a.obligations)
        .filter((o) => o.jobId === detail.job.jobId)
        .map((o) => [o.id, o]),
    ).values(),
  ];
  const outstanding = obligations.filter((o) => o.status === 'OUTSTANDING');
  const uncertain = obligations.some(
    (o) => o.status === 'UNVERIFIED' || o.amount.atomic.state !== 'known',
  );
  const obligationIds = [
    ...new Set(
      obligations.flatMap((o) => [
        ...(o.amount.atomic.evidenceIds ?? []),
        ...detail.pendingAccounts.flatMap((a) =>
          a.withdrawals
            .filter((w) => w.eventId === o.clearedBy && w.obligationIds.includes(o.id))
            .flatMap((w) => w.evidenceIds),
        ),
      ]),
    ),
  ];
  const historyComplete =
    detail.job.coverage.settlementHistory === 'complete' &&
    detail.job.coverage.accountPendingHistory === 'complete' &&
    detail.pendingAccounts.every((a) => a.history === 'complete');
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
      : historyComplete
        ? known('0', obligationIds)
        : unknown<string>('没有完整的任务义务及清偿证据；账户余额不能替代任务未清偿额。');
  const metrics: ResultMetric[] = [
    {
      key: 'face',
      label: '奖励面值',
      amount: detail.job.reward,
      scope: 'FACE_VALUE',
      qualifier: detail.job.reward.atomic.state === 'known' ? 'EXACT' : 'UNKNOWN',
      role: 'TASK',
      phase: 'FACE_VALUE',
      evidenceIds: detail.job.reward.atomic.evidenceIds ?? [],
    },
    select('worker', '工作者直接奖励', 'WORKER', ['REWARD']),
    select('fee', '已观察协议费', 'PROTOCOL', ['FEE']),
    select('refund', '发布者直接退款', 'POSTER', ['REFUND']),
    {
      key: 'outstanding',
      label: historyComplete ? '本任务未清偿总额' : '本任务已识别未清偿记录',
      amount: amount(unpaid),
      scope: 'VERIFIED_OBLIGATIONS',
      qualifier: unpaid.state !== 'known' ? 'UNKNOWN' : historyComplete ? 'EXACT' : 'AT_LEAST',
      role: 'TASK',
      phase: 'OUTSTANDING',
      evidenceIds: obligationIds,
    },
  ];
  const flows: SettlementResult['flows'] = [];
  const references = (ids: string[]) => ({
    eventIds: detail.timeline
      .filter((e) => e.evidenceIds.some((id) => ids.includes(id)))
      .map((e) => e.id),
    transactionHashes: [
      ...new Set(
        detail.evidence
          .filter((e) => ids.includes(e.id))
          .flatMap((e) => {
            const hash = (e.raw as { transactionHash?: string } | null)?.transactionHash;
            return hash ? [hash] : [];
          }),
      ),
    ],
  });
  // 端点遵循已登记部署的既有分配规则，不在浏览器重新匹配转移。
  for (const leg of detail.settlementLegs) {
    // 旧投影没有保存历史保证金付款人时，不能用当前工作者补造历史端点。
    if (leg.kind === 'BOND_DEPOSIT' && !leg.from) continue;
    const from =
      leg.from ??
      (leg.kind === 'DEPOSIT'
        ? detail.rawState.poster
        : leg.kind === 'BOND_DEPOSIT'
          ? detail.rawState.assignedProvider
          : leg.kind === 'ESCROW_TRANSIT' && leg.role === 'ADAPTER'
            ? DEPLOYMENT.escrow
            : DEPLOYMENT.adapter);
    for (const phase of ['DIRECT', 'PARKED'] as const) {
      const observed = phase === 'DIRECT' ? leg.observedAmount : leg.parkedAmount;
      if (observed.atomic.state !== 'known' || BigInt(observed.atomic.value) === 0n) continue;
      flows.push({
        id: leg.id + ':' + phase,
        from,
        to: leg.payee,
        role: leg.role,
        kind: leg.kind,
        phase,
        amount: observed,
        evidenceIds: leg.evidenceIds,
        ...references(leg.evidenceIds),
      });
    }
  }
  const extra: [string, string, SettlementLeg['role'], SettlementLeg['kind']][] = [
    ['worker_timeout', '工作者直接超时份额', 'WORKER', 'TIMEOUT_SHARE'],
    ['poster_timeout', '发布者直接超时份额', 'POSTER', 'TIMEOUT_SHARE'],
    ['worker_bond', '工作者直接保证金退回', 'WORKER', 'BOND_RETURN'],
    ['poster_forfeit', '发布者直接没收保证金', 'POSTER', 'BOND_FORFEIT'],
  ];
  for (const [key, title, role, kind] of extra) {
    if (detail.settlementLegs.some((l) => l.role === role && l.kind === kind))
      metrics.push(select(key, title, role, [kind]));
  }
  // 只投影核心已建立的唯一义务→分配段→提现批次映射；不重新匹配链上转移。
  const claimedKinds: [string, string, SettlementLeg['role'], SettlementLeg['kind']][] = [
    ['worker_claimed', '工作者后续领取奖励', 'WORKER', 'REWARD'],
    ['worker_timeout_claimed', '工作者后续领取超时份额', 'WORKER', 'TIMEOUT_SHARE'],
    ['worker_bond_claimed', '工作者后续领取保证金', 'WORKER', 'BOND_RETURN'],
    ['poster_refund_claimed', '发布者后续领取退款', 'POSTER', 'REFUND'],
    ['poster_timeout_claimed', '发布者后续领取超时份额', 'POSTER', 'TIMEOUT_SHARE'],
    ['poster_forfeit_claimed', '发布者后续领取没收保证金', 'POSTER', 'BOND_FORFEIT'],
  ];
  for (const [key, title, role, kind] of claimedKinds) {
    const legs = detail.settlementLegs.filter(
      (l) => l.role === role && l.kind === kind && l.obligationIds.length > 0,
    );
    if (!legs.length) continue;
    const ids = [...new Set(legs.flatMap((l) => l.obligationIds))];
    const proofs = ids.map((id) => {
      const linked = detail.settlementLegs.filter((l) => l.obligationIds.includes(id));
      const leg = linked[0];
      if (linked.length !== 1 || !leg) return undefined;
      const account = detail.pendingAccounts.find(
        (a) => a.payee === leg.payee && a.history === 'complete',
      );
      const obligation = account?.obligations.find(
        (o) => o.id === id && o.jobId === detail.job.jobId && o.status === 'CLEARED_SEQUENCE',
      );
      const withdrawal = account?.withdrawals.find(
        (w) =>
          w.eventId === obligation?.clearedBy &&
          w.obligationIds.includes(id) &&
          w.amount.atomic.state === 'known',
      );
      if (!obligation || !withdrawal || obligation.amount.atomic.state !== 'known')
        return undefined;
      return {
        value: obligation.amount.atomic.value,
        evidenceIds: [...(obligation.amount.atomic.evidenceIds ?? []), ...withdrawal.evidenceIds],
      };
    });
    const evidenceIds = [...new Set(proofs.flatMap((p) => p?.evidenceIds ?? []))];
    const verified = proofs.every((p) => p !== undefined);
    metrics.push({
      key,
      label: title,
      role,
      phase: 'CLAIMED',
      scope: 'VERIFIED_OBLIGATIONS',
      qualifier: verified ? 'OBSERVED_SUBSET' : 'UNKNOWN',
      evidenceIds,
      amount: amount(
        verified
          ? known(proofs.reduce((sum, p) => sum + BigInt(p!.value), 0n).toString(), evidenceIds)
          : unknown('后续领取须有唯一的任务义务、分配类型及完整清偿批次证据。'),
      ),
    });
    if (verified)
      for (const [i, id] of ids.entries()) {
        const leg = legs.find((l) => l.obligationIds.includes(id))!;
        const proof = proofs[i]!;
        flows.push({
          id: id + ':CLAIMED',
          from: DEPLOYMENT.adapter,
          to: leg.payee,
          role,
          kind,
          phase: 'CLAIMED',
          amount: amount(known(proof.value, proof.evidenceIds)),
          evidenceIds: proof.evidenceIds,
          ...references(proof.evidenceIds),
        });
      }
  }
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
    schemaVersion: 'atl-settlement-result-v2',
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
    flows,
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
