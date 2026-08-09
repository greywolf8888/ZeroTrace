import { hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  unavailableValue,
  unknownValue,
  type BitcoinSnapshotSchema,
  type ProviderCapability,
  type ProviderHealth,
} from '@zerotrace/schemas';
import type { z } from 'zod';

import { ProviderError, toProviderError } from './errors.js';
import type { RestTransport } from './transport.js';

export type BitcoinSnapshot = z.infer<typeof BitcoinSnapshotSchema>;

const BITCOIN_CAPABILITIES: ProviderCapability[] = [
  'CURRENT_STATE',
  'BLOCK',
  'TRANSACTION',
  'MEMPOOL',
  'UTXO',
];

export interface EsploraAddressStats {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

export interface BitcoinAdapterConfig {
  id: string;
  adapterVersion?: string;
}

function requireHeight(value: string): string {
  const trimmed = value.trim();
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid block height.');
  }
  return trimmed;
}

function requireBlockHash(value: string): string {
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid block hash.');
  }
  return trimmed.toLowerCase();
}

export class BitcoinUtxoLedgerAdapter {
  readonly ledger = 'BITCOIN' as const;
  readonly config: BitcoinAdapterConfig;
  readonly #transport: RestTransport;

  constructor(config: BitcoinAdapterConfig, transport: RestTransport) {
    this.config = config;
    this.#transport = transport;
  }

  getAddress(address: string): Promise<EsploraAddressStats> {
    return this.#transport.getJson<EsploraAddressStats>(`/address/${encodeURIComponent(address)}`);
  }

  getTransaction(txid: string): Promise<Record<string, unknown>> {
    return this.#transport.getJson<Record<string, unknown>>(`/tx/${encodeURIComponent(txid)}`);
  }

  getOutspend(txid: string, vout: number): Promise<Record<string, unknown>> {
    if (!Number.isSafeInteger(vout) || vout < 0) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Bitcoin vout must be a non-negative safe integer.',
      );
    }
    return this.#transport.getJson<Record<string, unknown>>(
      `/tx/${encodeURIComponent(txid)}/outspend/${vout}`,
    );
  }

  async probe(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const height = requireHeight(await this.#transport.getText('/blocks/tip/height'));
      return {
        id: this.config.id,
        ledger: 'BITCOIN',
        status: 'UP',
        capabilities: BITCOIN_CAPABILITIES,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        lastSuccessAt: checkedAt,
        head: knownValue(height),
        lag: unknownValue('NOT_QUERIED', 'No trusted comparison head is configured.'),
      };
    } catch (error) {
      const providerError = toProviderError(error);
      return {
        id: this.config.id,
        ledger: 'BITCOIN',
        status: providerError.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'DOWN',
        capabilities: BITCOIN_CAPABILITIES,
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

  async createSnapshot(): Promise<BitcoinSnapshot> {
    const height = requireHeight(await this.#transport.getText('/blocks/tip/height'));
    const blockHash = requireBlockHash(await this.#transport.getText('/blocks/tip/hash'));
    return {
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      height,
      blockHash,
      capturedAt: new Date().toISOString(),
      providerVersions: { [this.config.id]: 'esplora-http' },
      adapterVersions: { bitcoin: this.config.adapterVersion ?? '0.1.0' },
      configHash: hashPayload({ id: this.config.id, chainId: 'bitcoin-mainnet' }),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
  }
}
