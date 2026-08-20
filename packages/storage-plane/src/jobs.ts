import type { AnalysisStage, JobPriority, QuotaLevel } from './types.js';
import { allowsFullLifetime, allowsNonEvidenceWrite, allowsPrefetch } from './quota.js';

export const STAGE_JOB_TYPE: Record<AnalysisStage, string> = {
  CURRENT_SNAPSHOT: 'TOKEN_STAGE_CURRENT_SNAPSHOT',
  ORIGIN: 'TOKEN_STAGE_ORIGIN',
  LIFETIME_HISTORY: 'TOKEN_STAGE_LIFETIME_HISTORY',
  ENTITY_AND_CAMPAIGN: 'TOKEN_STAGE_ENTITY_AND_CAMPAIGN',
  CAPITAL_AND_RV: 'TOKEN_STAGE_CAPITAL_AND_RV',
  CASE_AND_REPLAY: 'TOKEN_STAGE_CASE_AND_REPLAY',
};

const STAGE_RANK: Record<AnalysisStage, number> = {
  CURRENT_SNAPSHOT: 0,
  ORIGIN: 1,
  LIFETIME_HISTORY: 2,
  ENTITY_AND_CAMPAIGN: 3,
  CAPITAL_AND_RV: 4,
  CASE_AND_REPLAY: 5,
};

export function stageRank(stage: AnalysisStage): number {
  return STAGE_RANK[stage];
}

export function nextStage(stage: AnalysisStage): AnalysisStage | undefined {
  const order = Object.keys(STAGE_RANK) as AnalysisStage[];
  return order[STAGE_RANK[stage] + 1];
}

export function allowsStage(level: QuotaLevel, stage: AnalysisStage): boolean {
  if (!allowsNonEvidenceWrite(level) && stage !== 'CASE_AND_REPLAY') return false;
  if (stage === 'LIFETIME_HISTORY' && !allowsFullLifetime(level)) return false;
  return true;
}

export const JOB_PRIORITY_RANK: Record<JobPriority, number> = {
  'Active Case': 0,
  'P0 Validation': 1,
  'Trace Pending': 2,
  'Monitored Token': 3,
  Corpus: 4,
  Prefetch: 5,
};

export function compareJobPriority(left: JobPriority, right: JobPriority): number {
  return JOB_PRIORITY_RANK[left] - JOB_PRIORITY_RANK[right];
}

export function admitJob(level: QuotaLevel, priority: JobPriority): boolean {
  if (priority === 'Prefetch' && !allowsPrefetch(level)) return false;
  if (priority === 'Corpus' && !allowsFullLifetime(level)) return false;
  if (level === 'EVIDENCE_ONLY' && priority !== 'Active Case') return false;
  return true;
}
