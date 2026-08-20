import { createHash } from 'node:crypto';

export function redactSecret(raw: string, secrets: readonly string[]): string {
  let out = raw;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join('[REDACTED]');
  }
  return out;
}

export function resultHash(raw: string, secrets: readonly string[] = []): string {
  return createHash('sha256').update(redactSecret(raw, secrets)).digest('hex');
}

export function contentAddress(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export class ContentAddressedCache {
  readonly #entries = new Map<
    string,
    { raw: string; result: unknown; expiresAt: number; bytes: number }
  >();
  #bytes = 0;

  constructor(
    readonly ttlMs = 60_000,
    readonly maxEntries = 2_000,
    readonly maxBytes = 32_000_000,
  ) {}

  get(key: string, nowMs: number): { raw: string; result: unknown } | undefined {
    const hit = this.#entries.get(key);
    if (hit === undefined) return undefined;
    if (hit.expiresAt <= nowMs) {
      this.#entries.delete(key);
      this.#bytes -= hit.bytes;
      return undefined;
    }
    return { raw: hit.raw, result: hit.result };
  }

  set(key: string, raw: string, result: unknown, nowMs: number): void {
    const bytes = raw.length;
    if (bytes > this.maxBytes) return;
    const existing = this.#entries.get(key);
    if (existing !== undefined) this.#bytes -= existing.bytes;
    while (
      (this.#entries.size >= this.maxEntries || this.#bytes + bytes > this.maxBytes) &&
      this.#entries.size > 0
    ) {
      const first = this.#entries.keys().next().value;
      if (first === undefined) break;
      const removed = this.#entries.get(first);
      this.#entries.delete(first);
      if (removed !== undefined) this.#bytes -= removed.bytes;
    }
    this.#entries.set(key, { raw, result, expiresAt: nowMs + this.ttlMs, bytes });
    this.#bytes += bytes;
  }
}
