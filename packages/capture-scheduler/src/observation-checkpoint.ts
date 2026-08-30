/** A page receipt may be committed ONLY after its observations/outbox are durable.
 * Integrate with CaptureLeaseRepository and an atomic compare-and-swap on revision. */
export interface SearchWindow {
  id: string;
  providerId: string;
  queryVersion: string;
  contractVersion: string;
  from: string;
  until: string;
  cursor: string | null;
  completed: boolean;
  pages: number;
  revision: number;
  usedCursors: readonly string[];
  receiptIds: readonly string[];
  receiptSignatures: readonly { id: string; signature: string }[];
  coverage: 'NOT_COMPLETE' | 'ACCESSIBLE_QUERY_RESULTS_PROCESSED';
}
export interface PageReceipt {
  receiptId: string;
  windowId: string;
  providerId: string;
  queryVersion: string;
  contractVersion: string;
  requestedCursor: string | null;
  nextCursor: string | null;
  recordsPersisted: number;
  recordsRejected: number;
  durable: boolean;
  expectedRevision: number;
}
function token(c: string | null): string {
  return c === null ? 'FIRST' : `CURSOR:${c}`;
}
export function commitSearchPage(w: SearchWindow, r: PageReceipt): SearchWindow {
  const signature = JSON.stringify(r);
  const previous = w.receiptSignatures.find((v) => v.id === r.receiptId);
  if (previous) {
    if (previous.signature !== signature) throw new Error('RECEIPT_ID_CONFLICT');
    return w;
  }
  if (w.completed) throw new Error('WINDOW_ALREADY_COMPLETE');
  if (
    !r.receiptId ||
    !r.durable ||
    r.recordsRejected !== 0 ||
    !Number.isSafeInteger(r.recordsPersisted) ||
    r.recordsPersisted < 0
  )
    throw new Error('PAGE_NOT_DURABLE_OR_INCOMPLETE');
  if (
    r.windowId !== w.id ||
    r.providerId !== w.providerId ||
    r.queryVersion !== w.queryVersion ||
    r.contractVersion !== w.contractVersion
  )
    throw new Error('CHECKPOINT_SCOPE_MISMATCH');
  if (w.revision !== r.expectedRevision || r.requestedCursor !== w.cursor)
    throw new Error('CHECKPOINT_CONCURRENCY_CONFLICT');
  if (
    r.nextCursor !== null &&
    (!r.nextCursor || r.nextCursor === w.cursor || w.usedCursors.includes(token(r.nextCursor)))
  )
    throw new Error('CURSOR_LOOP');
  return {
    ...w,
    cursor: r.nextCursor,
    pages: w.pages + 1,
    revision: w.revision + 1,
    usedCursors: [...w.usedCursors, token(w.cursor)],
    receiptIds: [...w.receiptIds, r.receiptId],
    receiptSignatures: [...w.receiptSignatures, { id: r.receiptId, signature }],
    completed: r.nextCursor === null,
    coverage: r.nextCursor === null ? 'ACCESSIBLE_QUERY_RESULTS_PROCESSED' : 'NOT_COMPLETE',
  };
}
export function comparePostIds(a: string, b: string): number {
  if (!/^[1-9][0-9]{0,24}$/.test(a) || !/^[1-9][0-9]{0,24}$/.test(b))
    throw new Error('INVALID_POST_ID');
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

export function newSearchWindow(
  input: Pick<
    SearchWindow,
    'id' | 'providerId' | 'queryVersion' | 'contractVersion' | 'from' | 'until'
  >,
): SearchWindow {
  const start = Date.parse(input.from),
    end = Date.parse(input.until);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    !input.id ||
    !input.providerId ||
    !input.queryVersion ||
    !input.contractVersion
  )
    throw new Error('INVALID_QUERY_WINDOW');
  return {
    ...input,
    cursor: null,
    completed: false,
    pages: 0,
    revision: 0,
    usedCursors: [],
    receiptIds: [],
    receiptSignatures: [],
    coverage: 'NOT_COMPLETE',
  };
}
