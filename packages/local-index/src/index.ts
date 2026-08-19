export interface CoverageSpan {
  startBlock: bigint;
  endBlock: bigint;
}

export interface IndexedTransfer {
  chainId: string;
  token: string;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
  from: string;
  to: string;
  valueAtomic: string;
}

export interface LocalIndexStore {
  putTransfers(tokenKey: string, transfers: readonly IndexedTransfer[]): void;
  putCoverage(tokenKey: string, span: CoverageSpan): void;
  transfers(tokenKey: string): IndexedTransfer[];
  coverage(tokenKey: string): CoverageSpan[];
}

export class MemoryLocalIndex implements LocalIndexStore {
  readonly #transfers = new Map<string, IndexedTransfer[]>();
  readonly #coverage = new Map<string, CoverageSpan[]>();

  putTransfers(tokenKey: string, transfers: readonly IndexedTransfer[]): void {
    const existing = this.#transfers.get(tokenKey) ?? [];
    const merged = [...existing, ...transfers];
    const seen = new Set<string>();
    const unique: IndexedTransfer[] = [];
    for (const item of merged) {
      const id = `${item.transactionHash}:${item.logIndex}`;
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(item);
    }
    unique.sort((left, right) =>
      left.blockNumber === right.blockNumber
        ? left.logIndex - right.logIndex
        : left.blockNumber < right.blockNumber
          ? -1
          : 1,
    );
    this.#transfers.set(tokenKey, unique);
  }

  putCoverage(tokenKey: string, span: CoverageSpan): void {
    this.#coverage.set(tokenKey, mergeSpans([...(this.#coverage.get(tokenKey) ?? []), span]));
  }

  transfers(tokenKey: string): IndexedTransfer[] {
    return [...(this.#transfers.get(tokenKey) ?? [])];
  }

  coverage(tokenKey: string): CoverageSpan[] {
    return [...(this.#coverage.get(tokenKey) ?? [])];
  }
}

export function tokenKey(chainId: string, token: string): string {
  return `${chainId}:${token.toLowerCase()}`;
}

export function mergeSpans(spans: readonly CoverageSpan[]): CoverageSpan[] {
  if (spans.length === 0) return [];
  const ordered = [...spans].sort((left, right) =>
    left.startBlock === right.startBlock
      ? left.endBlock < right.endBlock
        ? -1
        : 1
      : left.startBlock < right.startBlock
        ? -1
        : 1,
  );
  const merged: CoverageSpan[] = [];
  for (const span of ordered) {
    const last = merged[merged.length - 1];
    if (last === undefined) {
      merged.push({ ...span });
      continue;
    }
    if (span.startBlock <= last.endBlock + 1n) {
      if (span.endBlock > last.endBlock) last.endBlock = span.endBlock;
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

export function coverageGaps(
  spans: readonly CoverageSpan[],
  startBlock: bigint,
  endBlock: bigint,
): CoverageSpan[] {
  if (endBlock < startBlock) return [];
  const merged = mergeSpans(spans);
  const gaps: CoverageSpan[] = [];
  let cursor = startBlock;
  for (const span of merged) {
    if (span.endBlock < cursor) continue;
    if (span.startBlock > cursor) {
      gaps.push({ startBlock: cursor, endBlock: span.startBlock - 1n });
    }
    if (span.endBlock + 1n > cursor) cursor = span.endBlock + 1n;
    if (cursor > endBlock) break;
  }
  if (cursor <= endBlock) gaps.push({ startBlock: cursor, endBlock });
  return gaps;
}

export function coverageComplete(
  spans: readonly CoverageSpan[],
  startBlock: bigint,
  endBlock: bigint,
): boolean {
  return coverageGaps(spans, startBlock, endBlock).length === 0;
}

export function coveredBlockCount(spans: readonly CoverageSpan[]): bigint {
  let total = 0n;
  for (const span of mergeSpans(spans)) {
    total += span.endBlock - span.startBlock + 1n;
  }
  return total;
}
