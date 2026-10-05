import { expect, it } from 'vitest';
import { assertScope, hostedCurrentVerified } from '../../../scripts/northflank-orchestrate.mjs';
it('范围外资源和缩写提交禁止进入托管变更', () => {
  expect(() => assertScope([{ id: 'another-project-api' }], 'a'.repeat(40))).toThrow();
  expect(() => assertScope([{ id: 'atl-api' }], '77538e0')).toThrow();
  expect(() =>
    assertScope([{ id: 'atl-api' }, { id: 'atl-postgres' }], 'a'.repeat(40)),
  ).not.toThrow();
});
it('实际 API 的已知覆盖值才允许启用定时采集，未知值保持暂停', () => {
  const coverage = {
    lastSuccessfulSync: '2026-10-05T11:54:45.736Z',
    coverage: {
      currentState: { state: 'known', value: 'complete' },
      deploymentVerification: { state: 'known', value: 'complete' },
    },
  };
  expect(hostedCurrentVerified(coverage)).toBe(true);
  expect(
    hostedCurrentVerified({
      ...coverage,
      coverage: { ...coverage.coverage, currentState: { state: 'unknown', value: 'complete' } },
    }),
  ).toBe(false);
  expect(hostedCurrentVerified({})).toBe(false);
});
