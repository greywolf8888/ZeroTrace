import { expect, it } from 'vitest';
import { assertScope } from '../../../scripts/northflank-orchestrate.mjs';
it('范围外资源和缩写提交禁止进入托管变更', () => {
  expect(() => assertScope([{ id: 'another-project-api' }], 'a'.repeat(40))).toThrow();
  expect(() => assertScope([{ id: 'atl-api' }], '77538e0')).toThrow();
  expect(() =>
    assertScope([{ id: 'atl-api' }, { id: 'atl-postgres' }], 'a'.repeat(40)),
  ).not.toThrow();
});
