import { describe, expect, it } from 'vitest';

import {
  commitSearchPage,
  comparePostIds,
  newSearchWindow,
  type PageReceipt,
  type SearchWindow,
} from './observation-checkpoint.js';

function window(): SearchWindow {
  return newSearchWindow({
    id: 'window-1',
    providerId: 'fxembed',
    queryVersion: 'query-v1',
    contractVersion: 'contract-v1',
    from: '2026-08-01T00:00:00.000Z',
    until: '2026-08-02T00:00:00.000Z',
  });
}

function receipt(overrides: Partial<PageReceipt> = {}): PageReceipt {
  return {
    receiptId: 'receipt-1',
    windowId: 'window-1',
    providerId: 'fxembed',
    queryVersion: 'query-v1',
    contractVersion: 'contract-v1',
    requestedCursor: null,
    nextCursor: 'page-2',
    recordsPersisted: 2,
    recordsRejected: 0,
    durable: true,
    expectedRevision: 0,
    ...overrides,
  };
}

describe('durable social observation checkpoints', () => {
  it('commits pages once and records an explicit terminal cursor', () => {
    const firstReceipt = receipt();
    const first = commitSearchPage(window(), firstReceipt);
    expect(first).toMatchObject({
      cursor: 'page-2',
      pages: 1,
      revision: 1,
      completed: false,
      coverage: 'NOT_COMPLETE',
    });
    expect(first.usedCursors).toEqual(['FIRST']);
    expect(commitSearchPage(first, firstReceipt)).toBe(first);

    const complete = commitSearchPage(
      first,
      receipt({
        receiptId: 'receipt-2',
        requestedCursor: 'page-2',
        nextCursor: null,
        expectedRevision: 1,
      }),
    );
    expect(complete).toMatchObject({
      cursor: null,
      pages: 2,
      revision: 2,
      completed: true,
      coverage: 'ACCESSIBLE_QUERY_RESULTS_PROCESSED',
    });
    expect(complete.usedCursors).toEqual(['FIRST', 'CURSOR:page-2']);
    expect(() =>
      commitSearchPage(complete, receipt({ receiptId: 'receipt-3', expectedRevision: 2 })),
    ).toThrow('WINDOW_ALREADY_COMPLETE');
  });

  it('rejects conflicting receipts and every incomplete durability state', () => {
    const committed = commitSearchPage(window(), receipt());
    expect(() => commitSearchPage(committed, receipt({ recordsPersisted: 3 }))).toThrow(
      'RECEIPT_ID_CONFLICT',
    );

    const invalid = [
      receipt({ receiptId: '' }),
      receipt({ durable: false }),
      receipt({ recordsRejected: 1 }),
      receipt({ recordsPersisted: Number.MAX_SAFE_INTEGER + 1 }),
      receipt({ recordsPersisted: -1 }),
    ];
    for (const candidate of invalid) {
      expect(() => commitSearchPage(window(), candidate)).toThrow('PAGE_NOT_DURABLE_OR_INCOMPLETE');
    }
  });

  it('fails closed on scope, revision, requested cursor, and cursor loops', () => {
    for (const candidate of [
      receipt({ windowId: 'window-2' }),
      receipt({ providerId: 'other-provider' }),
      receipt({ queryVersion: 'query-v2' }),
      receipt({ contractVersion: 'contract-v2' }),
    ]) {
      expect(() => commitSearchPage(window(), candidate)).toThrow('CHECKPOINT_SCOPE_MISMATCH');
    }
    expect(() => commitSearchPage(window(), receipt({ expectedRevision: 1 }))).toThrow(
      'CHECKPOINT_CONCURRENCY_CONFLICT',
    );
    expect(() => commitSearchPage(window(), receipt({ requestedCursor: 'unexpected' }))).toThrow(
      'CHECKPOINT_CONCURRENCY_CONFLICT',
    );
    expect(() => commitSearchPage(window(), receipt({ nextCursor: '' }))).toThrow('CURSOR_LOOP');

    const first = commitSearchPage(window(), receipt());
    expect(() =>
      commitSearchPage(
        first,
        receipt({
          receiptId: 'receipt-2',
          requestedCursor: 'page-2',
          nextCursor: 'page-2',
          expectedRevision: 1,
        }),
      ),
    ).toThrow('CURSOR_LOOP');
    expect(() =>
      commitSearchPage(
        { ...first, usedCursors: [...first.usedCursors, 'CURSOR:seen'] },
        receipt({
          receiptId: 'receipt-2',
          requestedCursor: 'page-2',
          nextCursor: 'seen',
          expectedRevision: 1,
        }),
      ),
    ).toThrow('CURSOR_LOOP');
  });

  it('validates query windows without converting invalid boundaries into progress', () => {
    const base = {
      id: 'window-1',
      providerId: 'fxembed',
      queryVersion: 'query-v1',
      contractVersion: 'contract-v1',
      from: '2026-08-01T00:00:00.000Z',
      until: '2026-08-02T00:00:00.000Z',
    };
    for (const candidate of [
      { ...base, from: 'invalid' },
      { ...base, until: 'invalid' },
      { ...base, from: base.until },
      { ...base, id: '' },
      { ...base, providerId: '' },
      { ...base, queryVersion: '' },
      { ...base, contractVersion: '' },
    ]) {
      expect(() => newSearchWindow(candidate)).toThrow('INVALID_QUERY_WINDOW');
    }
  });

  it('orders large post IDs exactly and rejects ambiguous identifiers', () => {
    expect(comparePostIds('999999999999999999999999', '1000000000000000000000000')).toBe(-1);
    expect(comparePostIds('1000000000000000000000000', '999999999999999999999999')).toBe(1);
    expect(comparePostIds('100', '100')).toBe(0);
    expect(() => comparePostIds('0', '1')).toThrow('INVALID_POST_ID');
    expect(() => comparePostIds('1', '01')).toThrow('INVALID_POST_ID');
    expect(() => comparePostIds('12345678901234567890123456', '1')).toThrow('INVALID_POST_ID');
  });
});
