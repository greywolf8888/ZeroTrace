import { CACHE_TTL_MS, expired, lruOrder } from './ttl.js';
import type { CacheStore, DataClass } from './types.js';

interface CacheEntry {
  value: string;
  dataClass: DataClass;
  createdAt: string;
  lastAccessAt: string;
  bytes: number;
}

export class MemoryCacheStore implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>();

  async get(key: string): Promise<string | undefined> {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (expired(entry.createdAt, Date.now(), entry.dataClass)) {
      this.#entries.delete(key);
      return undefined;
    }
    entry.lastAccessAt = new Date().toISOString();
    return entry.value;
  }

  async set(key: string, value: string, dataClass: DataClass = 'EPHEMERAL'): Promise<void> {
    const now = new Date().toISOString();
    this.#entries.set(key, {
      value,
      dataClass,
      createdAt: now,
      lastAccessAt: now,
      bytes: Buffer.byteLength(value),
    });
  }

  async evictExpired(nowMs: number): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.#entries) {
      const ttlClass = entry.dataClass === 'EPHEMERAL' ? 'EPHEMERAL' : entry.dataClass;
      if (ttlClass === 'PERMANENT_EVIDENCE') continue;
      if (nowMs - Date.parse(entry.createdAt) > CACHE_TTL_MS || expired(entry.createdAt, nowMs, ttlClass)) {
        this.#entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async evictLru(targetBytes: number): Promise<number> {
    const items = [...this.#entries.entries()].map(([key, entry]) => ({ key, ...entry }));
    let remaining = items.reduce((sum, item) => sum + item.bytes, 0);
    let removed = 0;
    for (const item of lruOrder(items)) {
      if (remaining <= targetBytes) break;
      if (item.dataClass === 'PERMANENT_EVIDENCE') continue;
      this.#entries.delete(item.key);
      remaining -= item.bytes;
      removed += 1;
    }
    return removed;
  }

  async byteSize(): Promise<number> {
    return [...this.#entries.values()].reduce((sum, item) => sum + item.bytes, 0);
  }
}
