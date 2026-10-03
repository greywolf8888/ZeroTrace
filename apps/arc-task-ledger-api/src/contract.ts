import {
  known,
  unknown,
  type Coverage,
  type JobDetail,
  type JobRow,
  type Snapshot,
  type StoredEvidence,
} from '@zerotrace/arc-task-ledger';
export function publicCoverage(coverage: Coverage, evidenceIds: string[] = []) {
  return Object.fromEntries(
    Object.entries(coverage).map(([key, value]) => [
      key,
      value === 'unknown'
        ? unknown('此维度尚无可核验覆盖。')
        : value === 'conflict'
          ? { state: 'conflict', reason: '来源或历史观察冲突。' }
          : known(value, evidenceIds),
    ]),
  );
}
export function publicSnapshot(snapshot: Snapshot) {
  return {
    ...snapshot,
    finality: snapshot.finality === 'FINALIZED' ? known('FINALIZED') : unknown('最终性尚未核验。'),
  };
}
export function publicRow(row: JobRow, evidenceIds: string[] = []) {
  return {
    ...row,
    poster: known(row.poster, evidenceIds),
    reward: known(row.reward, evidenceIds),
    lifecycle: known(row.lifecycle, evidenceIds),
    cashState:
      row.cashState === 'UNKNOWN'
        ? unknown('缺少足够的任务级资金证据。')
        : row.cashState === 'CONFLICT'
          ? { state: 'conflict', reason: '任务级资金证据冲突。', evidenceIds }
          : known(row.cashState, evidenceIds),
    coverage: publicCoverage(row.coverage, evidenceIds),
    snapshot: publicSnapshot(row.snapshot),
  };
}
export function publicEvidence(evidence: StoredEvidence) {
  return {
    id: evidence.id,
    payloadHash: evidence.payloadHash,
    sourceAlias: evidence.snapshot.sourceSet.join('+'),
    snapshot: publicSnapshot(evidence.snapshot),
    safePayload: evidence.raw,
  };
}
export function publicDetail(detail: JobDetail) {
  const ids = detail.evidence.map((e) => e.id);
  return {
    ...detail,
    job: publicRow(detail.job, ids),
    rawState: known(detail.rawState, ids),
    settlementLegs: detail.settlementLegs.map((l) => ({
      ...l,
      observedAmount:
        l.observedAmount.atomic.state === 'known'
          ? known(l.observedAmount, l.evidenceIds)
          : l.observedAmount.atomic,
      parkedAmount:
        l.parkedAmount.atomic.state === 'known'
          ? known(l.parkedAmount, l.evidenceIds)
          : l.parkedAmount.atomic,
    })),
    evidence: detail.evidence.map(publicEvidence),
  };
}
