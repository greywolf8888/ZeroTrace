import { hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  unavailableValue,
  unknownValue,
  type ProviderCapability,
  type ProviderHealth,
  type SolanaSnapshotSchema,
} from '@zerotrace/schemas';
import type { z } from 'zod';

import { ProviderError, toProviderError } from './errors.js';
import type { JsonRpcTransport } from './transport.js';

export type SolanaSnapshot = z.infer<typeof SolanaSnapshotSchema>;

const ALLOWED_SOLANA_METHODS = new Set([
  'getHealth',
  'getVersion',
  'getSlot',
  'getBlockHeight',
  'getLatestBlockhash',
  'getBlock',
  'getTransaction',
  'getSignaturesForAddress',
  'getAccountInfo',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getBalance',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTokenSupply',
  'getTokenLargestAccounts',
  'getSignatureStatuses',
  'getRecentPrioritizationFees',
  'simulateTransaction',
]);

const SOLANA_CAPABILITIES: ProviderCapability[] = [
  'CURRENT_STATE',
  'BALANCE',
  'BLOCK',
  'TRANSACTION',
  'INSTRUCTION',
  'SIMULATION',
];

export interface SolanaAdapterConfig {
  id: string;
  commitment: 'processed' | 'confirmed' | 'finalized';
  adapterVersion?: string;
}

function requireSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return value;
}

export class SolanaLedgerAdapter {
  readonly ledger = 'SOLANA' as const;
  readonly config: SolanaAdapterConfig;
  readonly #transport: JsonRpcTransport;

  constructor(config: SolanaAdapterConfig, transport: JsonRpcTransport) {
    this.config = config;
    this.#transport = transport;
  }

  async read<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    if (!ALLOWED_SOLANA_METHODS.has(method)) {
      throw new ProviderError(
        'METHOD_NOT_ALLOWED',
        `Solana method ${method} is outside the read-only allowlist.`,
      );
    }
    return this.#transport.request<T>(method, params);
  }

  getAccountInfo(address: string, minimumContextSlot?: number): Promise<Record<string, unknown>> {
    return this.read<Record<string, unknown>>('getAccountInfo', [
      address,
      {
        encoding: 'base64',
        commitment: this.config.commitment,
        ...(minimumContextSlot === undefined ? {} : { minContextSlot: minimumContextSlot }),
      },
    ]);
  }

  async probe(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const [health, rawSlot] = await Promise.all([
        this.read<string>('getHealth'),
        this.read<number>('getSlot', [{ commitment: this.config.commitment }]),
      ]);
      if (health !== 'ok') {
        throw new ProviderError('INVALID_RESPONSE', 'Solana getHealth did not return ok.');
      }
      const slot = requireSafeInteger(rawSlot, 'slot').toString();
      return {
        id: this.config.id,
        ledger: 'SOLANA',
        status: 'UP',
        capabilities: SOLANA_CAPABILITIES,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        lastSuccessAt: checkedAt,
        head: knownValue(slot),
        lag: unknownValue('NOT_QUERIED', 'No trusted comparison slot is configured.'),
      };
    } catch (error) {
      const providerError = toProviderError(error);
      return {
        id: this.config.id,
        ledger: 'SOLANA',
        status: providerError.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'DOWN',
        capabilities: SOLANA_CAPABILITIES,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        lastSuccessAt: null,
        head: unavailableValue(
          providerError.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_DOWN',
          providerError.message,
        ),
        lag: unavailableValue('PROVIDER_DOWN'),
        errorCode: providerError.code,
        errorDetail: providerError.message,
      };
    }
  }

  async createSnapshot(): Promise<SolanaSnapshot> {
    const [rawSlot, latest] = await Promise.all([
      this.read<number>('getSlot', [{ commitment: this.config.commitment }]),
      this.read<{ value?: { blockhash?: unknown } }>('getLatestBlockhash', [
        { commitment: this.config.commitment },
      ]),
    ]);
    const slot = requireSafeInteger(rawSlot, 'slot').toString();
    const blockhash = latest.value?.blockhash;
    if (typeof blockhash !== 'string' || blockhash.length < 32) {
      throw new ProviderError('INVALID_RESPONSE', 'Solana provider returned an invalid blockhash.');
    }
    return {
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      slot,
      blockhash,
      commitment: this.config.commitment,
      capturedAt: new Date().toISOString(),
      providerVersions: { [this.config.id]: 'solana-json-rpc' },
      adapterVersions: { solana: this.config.adapterVersion ?? '0.1.0' },
      configHash: hashPayload({ id: this.config.id, commitment: this.config.commitment }),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
  }
}
