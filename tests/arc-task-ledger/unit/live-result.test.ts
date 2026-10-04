import assert from 'node:assert/strict';
import { it, expect } from 'vitest';
import { classifyLiveError } from '../../../packages/arc-task-ledger/src/live-result.js';
import { LedgerError } from '../../../packages/arc-task-ledger/src/types.js';
it('live 本地断言、程序及SQL错误不得伪装外部阻塞', () => {
  let failure: unknown;
  try {
    assert.equal(1, 2);
  } catch (error) {
    failure = error;
  }
  expect(classifyLiveError(failure)).toMatchObject({
    status: 'FAIL_LOCAL',
    category: 'ASSERTION_FAILED',
  });
  for (const error of [
    new TypeError('bug'),
    { code: '23505' },
    new LedgerError('STORAGE_UNAVAILABLE', '未迁移'),
  ])
    expect(classifyLiveError(error).status).toBe('FAIL_LOCAL');
  expect(classifyLiveError(new LedgerError('VERSION_QUARANTINED', '版本变化', 409)).status).toBe(
    'FAIL_CONFLICT_OR_VERSION',
  );
  expect(classifyLiveError({ code: 'HTTP_ERROR', cause: { code: 'ENOTFOUND' } }).status).toBe(
    'BLOCKED_EXTERNAL',
  );
  expect(classifyLiveError({ code: 'HTTP_ERROR', statusCode: 401 }).category).toBe(
    'NETWORK_OR_AUTH_BLOCKED',
  );
  expect(classifyLiveError({ code: 'HTTP_ERROR' }).status).toBe('FAIL_LOCAL');
});
