import type { ShadowMetrics } from './types.js';

export interface ShadowDecision {
  promote: boolean;
  reasons: string[];
}

export function evaluateShadowPromotion(
  baseline: ShadowMetrics,
  candidate: ShadowMetrics,
): ShadowDecision {
  const reasons: string[] = [];
  if (candidate.sourceConflicts > baseline.sourceConflicts) {
    reasons.push('ACCURACY_SOURCE_CONFLICT_UP');
  }
  if (candidate.resultHashDiffs > 0 && candidate.completionRate < 1) {
    reasons.push('RESULT_HASH_DIFF');
  }
  const accuracyOk = reasons.length === 0;
  const closesGap = candidate.closedCriticalCapability && !baseline.closedCriticalCapability;
  const completionLift = candidate.completionRate - baseline.completionRate >= 0.1;
  const latencyCut = baseline.p95Ms > 0 && candidate.p95Ms <= baseline.p95Ms * 0.7;
  if (closesGap) reasons.push('CLOSES_CRITICAL_CAPABILITY');
  if (completionLift) reasons.push('COMPLETION_PLUS_10PP');
  if (latencyCut) reasons.push('P95_MINUS_30PCT');
  const promote = accuracyOk && (closesGap || completionLift || latencyCut);
  if (!promote && accuracyOk) reasons.push('THRESHOLD_NOT_MET');
  if (!accuracyOk) reasons.push('NO_PROMOTE_ACCURACY');
  return { promote, reasons };
}
