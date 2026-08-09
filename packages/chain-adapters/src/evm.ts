import { hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  unavailableValue,
  unknownValue,
  type EvmSnapshotSchema,
  type ProviderCapability,
  type ProviderHealth,
} from '@zerotrace/schemas';
import type { z } from 'zod';

import { ProviderError, toProviderError } from './errors.js';
import type { JsonRpcTransport } from './transport.js';

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

function requireHex(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `EVM provider returned an invalid ${field}.`);
  }
  return value;
}

function hexQuantity(value: unknown, field: string): bigint {
  return BigInt(requireHex(value, field));
}

export interface EvmAdapterConfig {
  id: string;
  chainId: number;
  chainName: string;
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

  async read<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    if (!ALLOWED_EVM_METHODS.has(method)) {
      throw new ProviderError(
        'METHOD_NOT_ALLOWED',
        `EVM method ${method} is outside the read-only allowlist.`,
      );
    }
    return this.#transport.request<T>(method, params);
  }

  async probe(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const [rawChainId, rawHead] = await Promise.all([
        this.read<string>('eth_chainId'),
        this.read<string>('eth_blockNumber'),
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
      };
    }
  }

  getBalance(address: string, blockTag = 'latest'): Promise<string> {
    return this.read<string>('eth_getBalance', [address, blockTag]);
  }

  getCode(address: string, blockTag = 'latest'): Promise<string> {
    return this.read<string>('eth_getCode', [address, blockTag]);
  }

  async createSnapshot(): Promise<EvmSnapshot> {
    const block = await this.read<Record<string, unknown>>('eth_getBlockByNumber', [
      'latest',
      false,
    ]);
    const blockNumber = hexQuantity(block.number, 'block number').toString();
    const blockHash = block.hash;
    if (typeof blockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(blockHash)) {
      throw new ProviderError('INVALID_RESPONSE', 'EVM provider returned an invalid block hash.');
    }
    const timestamp = Number(hexQuantity(block.timestamp, 'block timestamp'));
    return {
      ledger: 'EVM',
      chainId: `eip155:${this.config.chainId}`,
      blockNumber,
      blockHash,
      blockTimestamp: new Date(timestamp * 1000).toISOString(),
      capturedAt: new Date().toISOString(),
      providerVersions: { [this.config.id]: 'json-rpc' },
      adapterVersions: { evm: this.config.adapterVersion ?? '0.1.0' },
      configHash: hashPayload({ id: this.config.id, chainId: this.config.chainId }),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
  }
}
