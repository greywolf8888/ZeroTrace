import { it, expect } from 'vitest';
import { receiptIsCurrent } from '../../../scripts/arc-receipt-current.js';
it('ATL-42 新源码使旧检查失效', () => {
  expect(
    receiptIsCurrent(
      { exitCode: 0, sourceFingerprint: 'old', sourceChangedDuringCheck: false },
      'new',
    ),
  ).toBe(false);
  expect(
    receiptIsCurrent(
      { exitCode: 0, sourceFingerprint: 'new', sourceChangedDuringCheck: true },
      'new',
    ),
  ).toBe(false);
  expect(
    receiptIsCurrent(
      { exitCode: 1, sourceFingerprint: 'new', sourceChangedDuringCheck: false },
      'new',
    ),
  ).toBe(false);
  expect(
    receiptIsCurrent(
      { exitCode: 0, sourceFingerprint: 'new', sourceChangedDuringCheck: false },
      'new',
    ),
  ).toBe(true);
});
