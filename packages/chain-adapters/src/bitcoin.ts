import { hashPayload } from '@zerotrace/evidence';
import {
  ChainAnchorReadSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type BitcoinSnapshotSchema,
  type ChainAnchorRead,
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

function requirePosition(value: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', 'Bitcoin block position must be unsigned decimal.');
  }
  return value;
}

function requireSafeBlockHeight(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid block height.');
  }
  return String(value);
}

function sourceSet(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
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

  async #readAnchorAt(
    height: string,
    initialSourceIds: readonly string[] = [],
  ): Promise<ChainAnchorRead> {
    requirePosition(height);
    const hashObservation = await getRestTextSourced(
      this.#transport,
      `/block-height/${encodeURIComponent(height)}`,
      { cacheMode: 'bypass' },
    );
    const blockHash = requireBlockHash(hashObservation.value);
    const blockObservation = await getRestJsonSourced<unknown>(
      this.#transport,
      `/block/${encodeURIComponent(blockHash)}`,
      { cacheMode: 'bypass' },
    );
    if (
      typeof blockObservation.value !== 'object' ||
      blockObservation.value === null ||
      Array.isArray(blockObservation.value)
    ) {
      throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid block record.');
    }
    const block = blockObservation.value as Record<string, unknown>;
    if (typeof block.id !== 'string' || requireBlockHash(block.id) !== blockHash) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Esplora block identity does not match its hash.',
      );
    }
    if (requireSafeBlockHeight(block.height) !== height) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Esplora block record does not match the requested height.',
      );
    }
    const numericHeight = BigInt(height);
    let previousBlockHash: string | undefined;
    if (numericHeight > 0n) {
      if (typeof block.previousblockhash !== 'string') {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Esplora block record is missing its previous block hash.',
        );
      }
      previousBlockHash = requireBlockHash(block.previousblockhash);
    }
    const sourceIds = sourceSet([
      ...initialSourceIds,
      hashObservation.endpointId,
      blockObservation.endpointId,
    ]);
    const observedAt = new Date().toISOString();
    const snapshot: BitcoinSnapshot = {
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      height,
      blockHash,
      ...(previousBlockHash === undefined ? {} : { previousBlockHash }),
      finality: 'best-chain',
      capturedAt: observedAt,
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
    return ChainAnchorReadSchema.parse({
      anchor: {
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        position: height,
        hash: blockHash,
        ...(previousBlockHash === undefined
          ? {}
          : {
              parentPosition: (numericHeight - 1n).toString(),
              parentHash: previousBlockHash,
            }),
        finality: 'best-chain',
        source: sourceIds.join('|'),
        observedAt,
      },
      snapshot,
      payload: { height, resolvedHash: blockHash, block },
    });
  }

  async readHeadAnchor(): Promise<ChainAnchorRead> {
    const heightObservation = await getRestTextSourced(this.#transport, '/blocks/tip/height', {
      cacheMode: 'bypass',
    });
    const height = requireHeight(heightObservation.value);
    return this.#readAnchorAt(height, [heightObservation.endpointId]);
  }

  async readAnchorAt(position: string): Promise<ChainAnchorRead> {
    return this.#readAnchorAt(requirePosition(position));
  }

  async createSnapshot(): Promise<BitcoinSnapshot> {
    return (await this.readHeadAnchor()).snapshot as BitcoinSnapshot;
  }
}
