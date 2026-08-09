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
import {
  getRestJsonSourced,
  getRestTextSourced,
  type RestTransport,
  type TransportObservation,
} from './transport.js';

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

  get sourceId(): string {
    return this.#transport.lastEndpointId ?? this.#transport.endpointId;
  }

  async getAddress(address: string): Promise<EsploraAddressStats> {
    return (await this.getAddressObservation(address)).value;
  }

  getAddressObservation(address: string): Promise<TransportObservation<EsploraAddressStats>> {
    return getRestJsonSourced<EsploraAddressStats>(
      this.#transport,
      `/address/${encodeURIComponent(address)}`,
    );
  }

  async getTransaction(txid: string): Promise<Record<string, unknown>> {
    return (await this.getTransactionObservation(txid)).value;
  }

  getTransactionObservation(txid: string): Promise<TransportObservation<Record<string, unknown>>> {
    return getRestJsonSourced<Record<string, unknown>>(
      this.#transport,
      `/tx/${encodeURIComponent(txid)}`,
    );
  }

  getOutspend(txid: string, vout: number): Promise<Record<string, unknown>> {
    return this.getOutspendObservation(txid, vout).then((observation) => observation.value);
  }

  getOutspendObservation(
    txid: string,
    vout: number,
  ): Promise<TransportObservation<Record<string, unknown>>> {
    if (!Number.isSafeInteger(vout) || vout < 0) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Bitcoin vout must be a non-negative safe integer.',
      );
    }
    return getRestJsonSourced<Record<string, unknown>>(
      this.#transport,
      `/tx/${encodeURIComponent(txid)}/outspend/${vout}`,
    );
  }

  async probe(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const height = requireHeight(
        await this.#transport.getText('/blocks/tip/height', { cacheMode: 'bypass' }),
      );
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
        ...(this.#transport.diagnostics === undefined
          ? {}
          : { transport: this.#transport.diagnostics() }),
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
        ...(this.#transport.diagnostics === undefined
          ? {}
          : { transport: this.#transport.diagnostics() }),
      };
    }
  }

  async createSnapshot(): Promise<BitcoinSnapshot> {
    const heightObservation = await getRestTextSourced(this.#transport, '/blocks/tip/height', {
      cacheMode: 'bypass',
    });
    const height = requireHeight(heightObservation.value);
    const hashObservation = await getRestTextSourced(
      this.#transport,
      `/block-height/${encodeURIComponent(height)}`,
      { cacheMode: 'bypass' },
    );
    const blockHash = requireBlockHash(hashObservation.value);
    const sourceIds = [
      ...new Set([heightObservation.endpointId, hashObservation.endpointId]),
    ].sort();
    return {
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      height,
      blockHash,
      finality: 'best-chain',
      capturedAt: new Date().toISOString(),
      providerVersions: Object.fromEntries(sourceIds.map((sourceId) => [sourceId, 'esplora-http'])),
      adapterVersions: { bitcoin: this.config.adapterVersion ?? '0.1.0' },
      configHash: hashPayload({
        id: this.config.id,
        chainId: 'bitcoin-mainnet',
        sourceIds,
      }),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
  }
}
