import type { ProviderRecord, ProviderRole } from './types.js';
import type { ProviderCredentialRef } from './types.js';

export class ProviderRegistry {
  readonly #records = new Map<string, ProviderRecord>();
  readonly #credentials = new Map<string, ProviderCredentialRef>();
  readonly usage = new Map<
    string,
    { requests: number; bytes: number; throttles: number; errors: number }
  >();

  constructor(
    records: readonly ProviderRecord[] = [],
    credentials: readonly ProviderCredentialRef[] = [],
  ) {
    for (const record of records) this.#records.set(record.providerId, record);
    for (const credential of credentials) this.#credentials.set(credential.slotId, credential);
  }

  list(): ProviderRecord[] {
    return [...this.#records.values()];
  }

  get(providerId: string): ProviderRecord | undefined {
    return this.#records.get(providerId);
  }

  upsert(record: ProviderRecord): void {
    this.#records.set(record.providerId, record);
  }

  revokeSlot(slotId: string): void {
    this.#credentials.set(slotId, {
      slotId,
      status: 'UNCONFIGURED',
      authType: this.#credentials.get(slotId)?.authType ?? 'none',
    });
    for (const record of this.#records.values()) {
      if (record.providerId.includes(slotId.toLowerCase()) || record.operatorId === slotId) {
        this.#records.set(record.providerId, {
          ...record,
          credentialStatus: 'UNCONFIGURED',
          role: 'FALLBACK',
        });
      }
    }
  }

  credential(slotId: string): ProviderCredentialRef {
    return (
      this.#credentials.get(slotId) ?? {
        slotId,
        status: 'UNCONFIGURED',
        authType: 'none',
      }
    );
  }

  setCredential(ref: ProviderCredentialRef): void {
    this.#credentials.set(ref.slotId, ref);
  }

  setRole(providerId: string, role: ProviderRole): void {
    const record = this.#records.get(providerId);
    if (record === undefined) return;
    this.#records.set(providerId, { ...record, role });
  }

  recordUsage(providerId: string, bytes: number, outcome: 'ok' | 'throttle' | 'error'): void {
    const current = this.usage.get(providerId) ?? {
      requests: 0,
      bytes: 0,
      throttles: 0,
      errors: 0,
    };
    current.requests += 1;
    current.bytes += bytes;
    if (outcome === 'throttle') current.throttles += 1;
    if (outcome === 'error') current.errors += 1;
    this.usage.set(providerId, current);
  }
}

export class SourceOperatorRegistry {
  constructor(private readonly providers: ProviderRegistry) {}

  operators(chainId: string) {
    const groups = new Map<string, string>();
    for (const record of this.providers.list()) {
      if (record.chainId !== chainId) continue;
      groups.set(record.independenceGroup, record.operatorId);
    }
    return [...groups.entries()].map(([independenceGroup, operatorId]) => ({
      independenceGroup,
      operatorId,
    }));
  }
}
