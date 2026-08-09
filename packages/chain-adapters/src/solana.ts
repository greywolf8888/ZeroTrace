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
import {
  requestJsonRpcSourced,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from './transport.js';

export type SolanaSnapshot = z.infer<typeof SolanaSnapshotSchema>;

export interface SolanaAccountState {
  data: readonly [string, 'base64'];
  executable: boolean;
  lamports: string;
  owner: string;
  rentEpoch: string;
  space: number;
}

export interface SolanaAccountInfoResponse {
  context: { slot: number; apiVersion?: string };
  value: SolanaAccountState | null;
}

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

const SOLANA_BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const UNSIGNED_QUANTITY = /^(?:0|[1-9][0-9]*)$/;
const SIGNED_QUANTITY = /^-?(?:0|[1-9][0-9]*)$/;
const BASE64_DATA = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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

function requireUnsignedQuantity(value: unknown, field: string): string {
  if (typeof value === 'number') return String(requireSafeInteger(value, field));
  if (typeof value !== 'string' || !UNSIGNED_QUANTITY.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return value;
}

function requireSafeQuantityNumber(value: unknown, field: string): number {
  const quantity = requireUnsignedQuantity(value, field);
  const parsed = Number(quantity);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an unsafe ${field}.`);
  }
  return parsed;
}

function requireBase58(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SOLANA_BASE58.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return value;
}

function optionalBlockTimestamp(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !SIGNED_QUANTITY.test(text)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana provider returned an invalid block time.');
  }
  const seconds = Number(text);
  if (
    !Number.isSafeInteger(seconds) ||
    Math.abs(seconds) > Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana block time is outside the safe range.');
  }
  const date = new Date(seconds * 1_000);
  if (Number.isNaN(date.getTime())) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana provider returned an invalid block time.');
  }
  return date.toISOString();
}

function parseAccountInfo(
  raw: unknown,
  minimumContextSlot: number | undefined,
): SolanaAccountInfoResponse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account response must be an object.');
  }
  const response = raw as Record<string, unknown>;
  const context = response.context;
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account context is invalid.');
  }
  const contextRecord = context as Record<string, unknown>;
  const slot = requireSafeQuantityNumber(contextRecord.slot, 'account context slot');
  if (minimumContextSlot !== undefined && slot < minimumContextSlot) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana account response predates the requested minimum context slot.',
    );
  }
  const apiVersion = contextRecord.apiVersion;
  if (apiVersion !== undefined && typeof apiVersion !== 'string') {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account API version is invalid.');
  }
  if (!Object.hasOwn(response, 'value')) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account response is missing value.');
  }
  if (response.value === null) {
    return {
      context: { slot, ...(apiVersion === undefined ? {} : { apiVersion }) },
      value: null,
    };
  }
  if (typeof response.value !== 'object' || Array.isArray(response.value)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account value is invalid.');
  }
  const account = response.value as Record<string, unknown>;
  const data = account.data;
  if (
    !Array.isArray(data) ||
    data.length !== 2 ||
    typeof data[0] !== 'string' ||
    !BASE64_DATA.test(data[0]) ||
    data[1] !== 'base64'
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account data is invalid.');
  }
  if (typeof account.executable !== 'boolean') {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account executable flag is invalid.');
  }
  const space = requireSafeQuantityNumber(account.space, 'account space');
  return {
    context: { slot, ...(apiVersion === undefined ? {} : { apiVersion }) },
    value: {
      data: [data[0], 'base64'],
      executable: account.executable,
      lamports: requireUnsignedQuantity(account.lamports, 'account lamports'),
      owner: requireBase58(account.owner, 'account owner'),
      rentEpoch: requireUnsignedQuantity(account.rentEpoch, 'account rent epoch'),
      space,
    },
  };
}

export class SolanaLedgerAdapter {
  readonly ledger = 'SOLANA' as const;
  readonly config: SolanaAdapterConfig;
  readonly #transport: JsonRpcTransport;

  constructor(config: SolanaAdapterConfig, transport: JsonRpcTransport) {
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
    if (!ALLOWED_SOLANA_METHODS.has(method)) {
      throw new ProviderError(
        'METHOD_NOT_ALLOWED',
        `Solana method ${method} is outside the read-only allowlist.`,
      );
    }
    return requestJsonRpcSourced<T>(this.#transport, method, params, options);
  }

  async getAccountInfo(
    address: string,
    minimumContextSlot?: number,
  ): Promise<SolanaAccountInfoResponse> {
    return (await this.getAccountInfoObservation(address, minimumContextSlot)).value;
  }

  async getAccountInfoObservation(
    address: string,
    minimumContextSlot?: number,
  ): Promise<TransportObservation<SolanaAccountInfoResponse>> {
    requireBase58(address, 'account address');
    if (minimumContextSlot !== undefined) {
      requireSafeInteger(minimumContextSlot, 'minimum context slot');
    }
    const observation = await this.readSourced<unknown>('getAccountInfo', [
      address,
      {
        encoding: 'base64',
        commitment: this.config.commitment,
        ...(minimumContextSlot === undefined ? {} : { minContextSlot: minimumContextSlot }),
      },
    ]);
    return { ...observation, value: parseAccountInfo(observation.value, minimumContextSlot) };
  }

  async probe(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const [health, rawSlot] = await Promise.all([
        this.read<string>('getHealth'),
        this.read<number>('getSlot', [{ commitment: this.config.commitment }], {
          cacheMode: 'bypass',
        }),
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
        ...(this.#transport.diagnostics === undefined
          ? {}
          : { transport: this.#transport.diagnostics() }),
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
        ...(this.#transport.diagnostics === undefined
          ? {}
          : { transport: this.#transport.diagnostics() }),
      };
    }
  }

  async createSnapshot(): Promise<SolanaSnapshot> {
    const slotObservation = await this.readSourced<unknown>(
      'getSlot',
      [{ commitment: this.config.commitment }],
      { cacheMode: 'bypass' },
    );
    const slotNumber = requireSafeQuantityNumber(slotObservation.value, 'slot');
    const blockObservation = await this.readSourced<unknown>(
      'getBlock',
      [
        slotNumber,
        {
          commitment: this.config.commitment,
          transactionDetails: 'none',
          rewards: false,
          maxSupportedTransactionVersion: 0,
        },
      ],
      { cacheMode: 'bypass' },
    );
    const rawBlock = blockObservation.value;
    if (typeof rawBlock !== 'object' || rawBlock === null || Array.isArray(rawBlock)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Solana provider did not return the selected committed block.',
      );
    }
    const block = rawBlock as Record<string, unknown>;
    const blockhash = requireBase58(block.blockhash, 'blockhash');
    requireBase58(block.previousBlockhash, 'previous blockhash');
    const parentSlot = requireSafeQuantityNumber(block.parentSlot, 'parent slot');
    if (parentSlot > slotNumber) {
      throw new ProviderError('INVALID_RESPONSE', 'Solana parent slot exceeds the snapshot slot.');
    }
    const blockTimestamp = optionalBlockTimestamp(block.blockTime);
    const sourceIds = [
      ...new Set([slotObservation.endpointId, blockObservation.endpointId]),
    ].sort();
    return {
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      slot: String(slotNumber),
      blockhash,
      commitment: this.config.commitment,
      ...(blockTimestamp === undefined ? {} : { blockTimestamp }),
      capturedAt: new Date().toISOString(),
      providerVersions: Object.fromEntries(
        sourceIds.map((sourceId) => [sourceId, 'solana-json-rpc']),
      ),
      adapterVersions: { solana: this.config.adapterVersion ?? '0.1.0' },
      configHash: hashPayload({
        id: this.config.id,
        commitment: this.config.commitment,
        sourceIds,
      }),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
  }
}
