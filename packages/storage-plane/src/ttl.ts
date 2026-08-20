import type { DataClass } from './types.js';

export const EPHEMERAL_TTL_MS = 24 * 60 * 60 * 1000;
export const CACHE_TTL_MS = 60 * 60 * 1000;

export function expired(createdAt: string, nowMs: number, dataClass: DataClass): boolean {
  if (dataClass === 'PERMANENT_EVIDENCE') return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  const ttl = dataClass === 'EPHEMERAL' ? EPHEMERAL_TTL_MS : 30 * EPHEMERAL_TTL_MS;
  return nowMs - created > ttl;
}

export function lruOrder<T extends { lastAccessAt: string; permanent?: boolean }>(
  items: readonly T[],
): T[] {
  return [...items]
    .filter((item) => item.permanent !== true)
    .sort((left, right) => Date.parse(left.lastAccessAt) - Date.parse(right.lastAccessAt));
}
