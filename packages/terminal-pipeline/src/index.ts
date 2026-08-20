export const MARKET_STRUCTURE_JOB_TYPE = 'TOKEN_MARKET_STRUCTURE';

export const STAGE_ORDER = [
  'CAPABILITY',
  'SNAPSHOT',
  'ORIGIN',
  'HISTORY',
  'SUPPLY',
  'ENTITY',
  'CAMPAIGN',
  'CAPITAL',
  'RV',
  'REPLAY',
] as const;

export type StageName = (typeof STAGE_ORDER)[number];

export interface StageState {
  name: StageName;
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'UNSUPPORTED' | 'FAILED';
  limitation?: string;
}

export function initialStages(): StageState[] {
  return STAGE_ORDER.map((name) => ({ name, status: 'PENDING' }));
}

export function nextIncomplete(stages: readonly StageState[]): StageState | undefined {
  return stages.find((stage) => stage.status === 'PENDING' || stage.status === 'RUNNING');
}

export function markStage(
  stages: readonly StageState[],
  name: StageName,
  status: StageState['status'],
  limitation?: string,
): StageState[] {
  return stages.map((stage) =>
    stage.name === name
      ? { ...stage, status, ...(limitation === undefined ? {} : { limitation }) }
      : stage,
  );
}

export function coverageComplete(stages: readonly StageState[]): boolean {
  return stages.every((stage) => stage.status === 'COMPLETE');
}
