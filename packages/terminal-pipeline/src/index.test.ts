import { describe, expect, it } from 'vitest';

import { coverageComplete, initialStages, markStage, nextIncomplete } from './index.js';

describe('token market-structure stage DAG', () => {
  it('starts incomplete and refuses COMPLETE until every stage is closed', () => {
    let stages = initialStages();
    expect(coverageComplete(stages)).toBe(false);
    expect(nextIncomplete(stages)?.name).toBe('CAPABILITY');
    for (const stage of stages) {
      stages = markStage(stages, stage.name, 'PARTIAL', '历史未闭合');
    }
    expect(coverageComplete(stages)).toBe(false);
  });

  it('only reports complete when every named stage is COMPLETE', () => {
    let stages = initialStages();
    for (const stage of stages) {
      stages = markStage(stages, stage.name, 'COMPLETE');
    }
    expect(coverageComplete(stages)).toBe(true);
  });
});
