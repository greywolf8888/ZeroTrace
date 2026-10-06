import {
  ArcReader,
  LedgerError,
  type configFromEnv,
  type Snapshot,
  type StoredEvidence,
} from '@zerotrace/arc-task-ledger';

export interface LiveObservation {
  snapshot: Snapshot;
  evidence: StoredEvidence[];
  blockTimestamp?: string;
}
// 所有访问者共用一次只读观察；失败也冷却，避免浏览器轮询放大免费来源负载。
export function liveObserver(
  collect: () => Promise<LiveObservation>,
  now: () => number = Date.now,
) {
  let pending: Promise<ReturnType<typeof response>> | undefined;
  let attemptedAt = -Infinity;
  let reusableUntil = -Infinity;
  let last: LiveObservation | undefined;
  let failureCode: string | null = null;
  let state: 'fresh' | 'stale' | 'conflict' | 'provider-down' | 'unavailable' = 'unavailable';
  const response = () => ({
    state,
    failureCode,
    checkedAt: Number.isFinite(attemptedAt) ? new Date(attemptedAt).toISOString() : null,
    refreshAfterMs: 30000,
    observation: state === 'fresh' ? last : null,
    lastSuccessfulObservation: state === 'fresh' ? null : (last ?? null),
    durable: false,
    formalForensicReady: false,
    reason:
      state === 'fresh'
        ? '单来源实时区块观察，未归档；不替代资金快照。'
        : '实时来源未返回可核验区块；上次成功观察仅供参考。',
  });
  return {
    async read() {
      if (pending) return pending;
      if (now() < reusableUntil) return response();
      attemptedAt = now();
      pending = (async () => {
        try {
          last = await collect();
          failureCode = null;
          state =
            last.blockTimestamp && now() - Date.parse(last.blockTimestamp) > 120000
              ? 'stale'
              : 'fresh';
        } catch (error) {
          const code =
            (error as { code?: string; cause?: { code?: string } })?.cause?.code ??
            (error as { code?: string })?.code;
          failureCode =
            typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)
              ? code
              : 'SOURCE_READ_FAILED';
          state =
            error instanceof LedgerError && error.status === 409
              ? 'conflict'
              : error instanceof LedgerError && error.code === 'INVALID_RESPONSE'
                ? 'unavailable'
                : 'provider-down';
        }
        reusableUntil = now() + 30000;
        return response();
      })();
      try {
        return await pending;
      } finally {
        pending = undefined;
      }
    },
  };
}
export function productionLiveObserver(config: ReturnType<typeof configFromEnv>) {
  return liveObserver(async () => {
    const reader = new ArcReader(config);
    try {
      const snapshot = await reader.anchor();
      const raw = reader.evidence[0]?.raw as { finalized?: { timestamp?: string } };
      if (!raw?.finalized?.timestamp || !/^0x[\da-f]+$/i.test(raw.finalized.timestamp))
        throw new LedgerError('INVALID_RESPONSE', '来源未返回可核验区块时间。');
      const timestamp = Number(BigInt(raw.finalized.timestamp)) * 1000;
      if (!Number.isSafeInteger(timestamp) || timestamp > Date.now() + 30000)
        throw new LedgerError('SOURCE_CONFLICT', '来源区块时间超出可核验范围。', 409);
      return {
        snapshot,
        evidence: reader.evidence,
        blockTimestamp: new Date(timestamp).toISOString(),
      };
    } finally {
      await reader.close();
    }
  });
}
