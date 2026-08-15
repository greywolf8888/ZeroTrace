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

export interface ProviderCapabilityDeclaration {
  id: string;
  ledger: Ledger;
  chainId: string;
  capabilities: readonly ProviderCapability[];
  configured: boolean;
  version: string;
}

export type ProviderCapabilityResolutionState = 'DECLARED' | 'UNCONFIGURED' | 'NOT_DECLARED';

export interface ProviderCapabilityResolution {
  ledger: Ledger;
  chainId: string;
  capability: ProviderCapability;
  state: ProviderCapabilityResolutionState;
  providers: readonly string[];
  reason?: string;
}

/**
 * A capability declaration is an explicit routing input, not a health check and not proof that a
 * provider is currently reachable.  Callers must combine this with ProviderRegistry.health().
 */
export class ProviderCapabilityRegistry {
  readonly #declarations = new Map<string, ProviderCapabilityDeclaration>();

  constructor(declarations: readonly ProviderCapabilityDeclaration[] = []) {
    for (const declaration of declarations) this.register(declaration);
  }

  register(declaration: ProviderCapabilityDeclaration): void {
    if (declaration.id.trim() === '' || declaration.chainId.trim() === '') {
      throw new RangeError('Provider capability identity must be non-empty.');
    }
    if (declaration.version.trim() === '') {
      throw new RangeError('Provider capability version must be non-empty.');
    }
    const capabilities = [...new Set(declaration.capabilities)].sort();
    if (capabilities.length !== declaration.capabilities.length) {
      throw new RangeError('Provider capability declarations must not contain duplicates.');
    }
    if (this.#declarations.has(declaration.id)) {
      throw new RangeError(`Provider capability ${declaration.id} is already registered.`);
    }
    this.#declarations.set(declaration.id, {
      ...declaration,
      capabilities,
    });
  }

  declarations(): readonly ProviderCapabilityDeclaration[] {
    return [...this.#declarations.values()]
      .map((declaration) => ({
        ...declaration,
        capabilities: [...declaration.capabilities],
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  resolve(input: {
    ledger: Ledger;
    chainId: string;
    capability: ProviderCapability;
  }): ProviderCapabilityResolution {
    const matching = this.declarations().filter(
      (declaration) => declaration.ledger === input.ledger && declaration.chainId === input.chainId,
    );
    const declared = matching.filter((declaration) =>
      declaration.capabilities.includes(input.capability),
    );
    const configured = declared.filter((declaration) => declaration.configured);
    if (configured.length > 0) {
      return {
        ...input,
        state: 'DECLARED',
        providers: configured.map((declaration) => declaration.id),
        reason:
          'Capability is declared by a configured provider; health remains separately measured.',
      };
    }
    if (declared.length > 0) {
      return {
        ...input,
        state: 'UNCONFIGURED',
        providers: declared.map((declaration) => declaration.id),
        reason: 'Capability is declared but no matching provider is configured.',
      };
    }
    return {
      ...input,
      state: 'NOT_DECLARED',
      providers: [],
      reason:
        matching.length === 0
          ? 'No provider declaration exists for this ledger and chain.'
          : 'No matching provider declares this capability.',
    };
  }
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
