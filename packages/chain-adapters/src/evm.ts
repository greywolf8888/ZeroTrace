import { hashPayload } from '@zerotrace/evidence';
import {
  ChainAnchorReadSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type ChainAnchorRead,
  type EvmSnapshotSchema,
  type ProviderCapability,
  type ProviderHealth,
} from '@zerotrace/schemas';
import type { z } from 'zod';

import { ProviderError, toProviderError } from './errors.js';
import {
  requestJsonRpcSourced,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from './transport.js';

export type EvmSnapshot = z.infer<typeof EvmSnapshotSchema>;

const ALLOWED_EVM_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_call',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'eth_feeHistory',
  'eth_getProof',
  'trace_transaction',
  'trace_block',
  'debug_traceTransaction',
  'debug_traceBlockByHash',
  'debug_traceBlockByNumber',
]);

const EVM_CAPABILITIES: ProviderCapability[] = [
  'CURRENT_STATE',
  'BALANCE',
  'BLOCK',
  'TRANSACTION',
  'RECEIPT',
  'LOG',
];

function requireHexQuantity(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `EVM provider returned an invalid ${field}.`);
  }
  return value;
}

function hexQuantity(value: unknown, field: string): bigint {
  return BigInt(requireHexQuantity(value, field));
}

function requireHexData(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `EVM provider returned invalid ${field}.`);
  }
  return value;
}

function timestampFromHex(value: unknown): string {
  const seconds = hexQuantity(value, 'block timestamp');
  if (seconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1_000))) {
    throw new ProviderError('INVALID_RESPONSE', 'EVM block timestamp is outside the safe range.');
  }
  const date = new Date(Number(seconds) * 1_000);
  if (Number.isNaN(date.getTime())) {
    throw new ProviderError('INVALID_RESPONSE', 'EVM block timestamp is invalid.');
  }
  return date.toISOString();
}

function requireDecimalPosition(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', 'EVM block position must be unsigned decimal.');
  }
  return BigInt(value);
}

export interface EvmAdapterConfig {
  id: string;
  chainId: number;
  chainName: string;
  snapshotBlockTag?: 'latest' | 'safe' | 'finalized';
  adapterVersion?: string;
}

export class EvmLedgerAdapter {
  readonly ledger = 'EVM' as const;
  readonly config: EvmAdapterConfig;
  readonly #transport: JsonRpcTransport;

  constructor(config: EvmAdapterConfig, transport: JsonRpcTransport) {
    this.config = config;
    this.#transport = transport;
  }

  get sourceId(): string {
    return this.#transport.lastEndpointId ?? this.#transport.endpointId;
  }

  async read<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<T> {
    return (await this.readSourced<T>(method, params, options)).value;
  }

  async readSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    if (!ALLOWED_EVM_METHODS.has(method)) {
      throw new ProviderError(
        'METHOD_NOT_ALLOWED',
        `EVM method ${method} is outside the read-only allowlist.`,
      );
    }
    return requestJsonRpcSourced<T>(this.#transport, method, params, options);
  }

  async probe(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const [rawChainId, rawHead] = await Promise.all([
        this.read<string>('eth_chainId'),
        this.read<string>('eth_blockNumber', [], { cacheMode: 'bypass' }),
      ]);
      const actualChainId = Number(hexQuantity(rawChainId, 'chain id'));
      const head = hexQuantity(rawHead, 'block number').toString();
      if (actualChainId !== this.config.chainId) {
        return {
          id: this.config.id,
          ledger: 'EVM',
          status: 'DEGRADED',
          capabilities: EVM_CAPABILITIES,
          checkedAt,
          latencyMs: Math.round(performance.now() - started),
          lastSuccessAt: checkedAt,
          head: knownValue(head),
          lag: unknownValue('NOT_QUERIED', 'No trusted comparison head is configured.'),
          errorCode: 'CHAIN_MISMATCH',
          errorDetail: `Expected chain ${this.config.chainId}, received ${actualChainId}.`,
          ...(this.#transport.diagnostics === undefined
            ? {}
            : { transport: this.#transport.diagnostics() }),
        };
      }
      return {
        id: this.config.id,
        ledger: 'EVM',
        status: 'UP',
        capabilities: EVM_CAPABILITIES,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        lastSuccessAt: checkedAt,
        head: knownValue(head),
        lag: unknownValue('NOT_QUERIED', 'No trusted comparison head is configured.'),
        ...(this.#transport.diagnostics === undefined
          ? {}
          : { transport: this.#transport.diagnostics() }),
      };
    } catch (error) {
      const providerError = toProviderError(error);
      return {
        id: this.config.id,
        ledger: 'EVM',
        status: providerError.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'DOWN',
        capabilities: EVM_CAPABILITIES,
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

  async getBalance(address: string, blockTag = 'latest'): Promise<string> {
    return (await this.getBalanceObservation(address, blockTag)).value;
  }

  async getBalanceObservation(
    address: string,
    blockTag = 'latest',
  ): Promise<TransportObservation<string>> {
    const observation = await this.readSourced<unknown>('eth_getBalance', [address, blockTag]);
    return { ...observation, value: requireHexQuantity(observation.value, 'balance') };
  }

  async getCode(address: string, blockTag = 'latest'): Promise<string> {
    return (await this.getCodeObservation(address, blockTag)).value;
  }

  async getCodeObservation(
    address: string,
    blockTag = 'latest',
  ): Promise<TransportObservation<string>> {
    const observation = await this.readSourced<unknown>('eth_getCode', [address, blockTag]);
    return { ...observation, value: requireHexData(observation.value, 'bytecode') };
  }

  async #readAnchor(blockTag: string, expectedPosition?: string): Promise<ChainAnchorRead> {
    const finality = this.config.snapshotBlockTag ?? 'finalized';
    const observation = await this.readSourced<unknown>('eth_getBlockByNumber', [blockTag, false], {
      cacheMode: 'bypass',
    });
    const rawBlock = observation.value;
    if (typeof rawBlock !== 'object' || rawBlock === null || Array.isArray(rawBlock)) {
      throw new ProviderError('INVALID_RESPONSE', 'EVM provider returned an invalid block.');
    }
    const block = rawBlock as Record<string, unknown>;
    const blockNumber = hexQuantity(block.number, 'block number').toString();
    if (expectedPosition !== undefined && blockNumber !== expectedPosition) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'EVM provider returned a block at a different position.',
      );
    }
    const blockHash = block.hash;
    if (typeof blockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(blockHash)) {
      throw new ProviderError('INVALID_RESPONSE', 'EVM provider returned an invalid block hash.');
    }
    const parentBlockHash = block.parentHash;
    if (typeof parentBlockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(parentBlockHash)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'EVM provider returned an invalid parent block hash.',
      );
    }
    const observedAt = new Date().toISOString();
    const numericPosition = BigInt(blockNumber);
    const snapshot: EvmSnapshot = {
      ledger: 'EVM',
      chainId: `eip155:${this.config.chainId}`,
      blockNumber,
      blockHash,
      ...(numericPosition === 0n ? {} : { parentBlockHash }),
      finality,
      blockTimestamp: timestampFromHex(block.timestamp),
      capturedAt: observedAt,
      providerVersions: { [observation.endpointId]: 'json-rpc' },
      adapterVersions: { evm: this.config.adapterVersion ?? '0.1.0' },
      configHash: hashPayload({
        id: this.config.id,
        chainId: this.config.chainId,
        finality,
        sourceIds: [observation.endpointId],
      }),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
    return ChainAnchorReadSchema.parse({
      anchor: {
        ledger: 'EVM',
        chainId: snapshot.chainId,
        position: blockNumber,
        hash: blockHash,
        ...(numericPosition === 0n
          ? {}
          : { parentPosition: (numericPosition - 1n).toString(), parentHash: parentBlockHash }),
        finality,
        source: observation.endpointId,
        observedAt,
      },
      snapshot,
      payload: block,
    });
  }

  readHeadAnchor(): Promise<ChainAnchorRead> {
    return this.#readAnchor(this.config.snapshotBlockTag ?? 'finalized');
  }

  async readAnchorAt(position: string): Promise<ChainAnchorRead> {
    const numericPosition = requireDecimalPosition(position);
    return this.#readAnchor(`0x${numericPosition.toString(16)}`, position);
  }

  async createSnapshot(): Promise<EvmSnapshot> {
    return (await this.readHeadAnchor()).snapshot as EvmSnapshot;
  }
}
