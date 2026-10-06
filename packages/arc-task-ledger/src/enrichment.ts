import { hashPayload } from '@zerotrace/evidence';
import { DEPLOYMENT } from './config.js';
import { settlementResult } from './result.js';
import type { JobDetail } from './types.js';

export interface EvidencePlan {
  version: 'atl-enrichment-plan-v2';
  targetKinds: string[];
  basis: 'KNOWN_EVENT' | 'KNOWN_CREATION_UNSCANNED' | 'UNLOCATABLE' | 'COVERED';
  reason: string;
  from?: string;
  to?: string;
  priorCoverage: { from: string; to: string }[];
  beforeReceiptHashes: string[];
  beforeConclusion: string;
}
export const conclusionDigest = (detail: JobDetail) => {
  const result = settlementResult(detail);
  return hashPayload({
    state: result.state,
    historyComplete: result.historyComplete,
    metrics: result.metrics.map((m) => ({
      key: m.key,
      amount: m.amount.atomic.state === 'known' ? m.amount.atomic.value : m.amount.atomic.state,
      qualifier: m.qualifier,
    })),
  });
};
export const taskReceiptEvidence = (detail: JobDetail) => {
  const obligations = detail.pendingAccounts
    .flatMap((a) => a.obligations)
    .filter((o) => o.jobId === detail.job.jobId);
  const ids = new Set([
    ...detail.timeline.flatMap((e) => e.evidenceIds),
    ...detail.settlementLegs.flatMap((l) => l.evidenceIds),
    ...obligations.flatMap((o) => o.amount.atomic.evidenceIds ?? []),
    ...detail.pendingAccounts.flatMap((a) =>
      a.withdrawals
        .filter((w) =>
          obligations.some((o) => o.clearedBy === w.eventId && w.obligationIds.includes(o.id)),
        )
        .flatMap((w) => w.evidenceIds),
    ),
  ]);
  return detail.evidence.filter(
    (e) => ids.has(e.id) && !!(e.raw as { transactionHash?: string } | null)?.transactionHash,
  );
};

/** 已知事件／创建位置及实际已扫覆盖决定区间；无法定位时不猜最近窗口。 */
export function planEvidence(
  detail: JobDetail,
  covered: { from: string; to: string }[],
): EvidencePlan {
  const events = detail.timeline.filter((e) => e.jobId === detail.job.jobId);
  const created = events.find((e) => e.name === 'BountyCreated');
  const targetKinds = [
    ...(detail.job.coverage.lifecycleHistory !== 'complete' ? ['LIFECYCLE_GAP'] : []),
    ...(detail.job.coverage.settlementHistory !== 'complete' ? ['SETTLEMENT_GAP'] : []),
    ...(detail.job.coverage.accountPendingHistory !== 'complete'
      ? ['OBLIGATION_SEQUENCE_GAP']
      : []),
  ];
  const plan: EvidencePlan = {
    version: 'atl-enrichment-plan-v2',
    targetKinds,
    basis: 'UNLOCATABLE',
    reason: '尚不能定位所缺事件；没有可信创建或相关事件区块，不自动扫描最近窗口。',
    priorCoverage: covered,
    beforeReceiptHashes: taskReceiptEvidence(detail).map((e) => e.payloadHash),
    beforeConclusion: conclusionDigest(detail),
  };
  const first = created
    ? BigInt(created.blockNumber)
    : events.length
      ? events.reduce(
          (min, e) => (BigInt(e.blockNumber) < min ? BigInt(e.blockNumber) : min),
          BigInt(events[0]!.blockNumber),
        )
      : undefined;
  if (first === undefined) return plan;
  const start =
    first < BigInt(DEPLOYMENT.verifiedDeploymentBlock)
      ? BigInt(DEPLOYMENT.verifiedDeploymentBlock)
      : first;
  const target = BigInt(detail.job.snapshot.blockNumber);
  let gaps: { from: bigint; to: bigint }[] = start <= target ? [{ from: start, to: target }] : [];
  for (const range of covered) {
    const from = BigInt(range.from),
      to = BigInt(range.to);
    gaps = gaps.flatMap((g) =>
      to < g.from || from > g.to
        ? [g]
        : [
            ...(from > g.from ? [{ from: g.from, to: from - 1n }] : []),
            ...(to < g.to ? [{ from: to + 1n, to: g.to }] : []),
          ],
    );
  }
  const gap = gaps.at(-1);
  if (!gap)
    return {
      ...plan,
      basis: 'COVERED',
      reason: '可定位区间已经扫描；不重复扫描已核验的无效窗口，窗口之外仍未验证。',
    };
  // 先检查所缺结算声明所在的已知事件块，否则选择创建后尚未采集的最新缺口。
  const event = events.find(
    (e) =>
      e.name !== 'BountyCreated' &&
      gaps.some((g) => BigInt(e.blockNumber) >= g.from && BigInt(e.blockNumber) <= g.to),
  );
  const to = event ? BigInt(event.blockNumber) : gap.to;
  const from = event ? to : gap.from > to - 199999n ? gap.from : to - 199999n;
  return {
    ...plan,
    from: from.toString(),
    to: to.toString(),
    basis: event ? 'KNOWN_EVENT' : 'KNOWN_CREATION_UNSCANNED',
    reason: event
      ? '定向复核本任务已知事件区块；取得完整回执后重新投影。'
      : created
        ? '按可信创建位置与已有覆盖选择未扫描缺口；此窗口不保证包含目标结算。'
        : '仅定位到相关事件之后的缺口；创建前历史仍无法定位。',
  };
}
