import {
  unavailableValue,
  type Ledger,
  type ProviderCapability,
  type ProviderHealth,
} from '@zerotrace/schemas';

export interface HealthProbe {
  readonly ledger: Ledger;
  readonly config: { id: string };
  probe(): Promise<ProviderHealth>;
}

export interface UnconfiguredProvider {
  id: string;
  ledger: Ledger;
  capabilities: ProviderCapability[];
}

export class ProviderRegistry {
  readonly #providers: HealthProbe[];
  readonly #unconfigured: UnconfiguredProvider[];

  constructor(providers: HealthProbe[], unconfigured: UnconfiguredProvider[] = []) {
    this.#providers = providers;
    this.#unconfigured = unconfigured;
  }

  async health(): Promise<ProviderHealth[]> {
    const checkedAt = new Date().toISOString();
    const configured = await Promise.all(this.#providers.map((provider) => provider.probe()));
    const unconfigured: ProviderHealth[] = this.#unconfigured.map((provider) => ({
      id: provider.id,
      ledger: provider.ledger,
      status: 'UNCONFIGURED',
      capabilities: provider.capabilities,
      checkedAt,
      latencyMs: null,
      lastSuccessAt: null,
      head: unavailableValue('PROVIDER_UNCONFIGURED'),
      lag: unavailableValue('PROVIDER_UNCONFIGURED'),
    }));
    return [...configured, ...unconfigured].sort((a, b) => a.id.localeCompare(b.id));
  }
}
