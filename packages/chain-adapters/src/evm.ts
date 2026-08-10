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

export interface EvmTransactionRecord {
  hash: string;
  blockHash: string | null;
  blockNumber: string | null;
  transactionIndex: string | null;
  from: string;
  to: string | null;
  value: string;
  nonce: string;
  gas: string;
  input: string;
  raw: Readonly<Record<string, unknown>>;
}

export interface EvmTransactionReceiptRecord {
  transactionHash: string;
  blockHash: string;
  blockNumber: string;
  transactionIndex: string;
  from: string;
  to: string | null;
  contractAddress: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  status: '0x0' | '0x1' | null;
  logCount: number;
  raw: Readonly<Record<string, unknown>>;
}

export interface EvmLogRecord {
  address: string;
  blockHash: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  data: string;
  topics: readonly string[];
  removed: false;
  raw: Readonly<Record<string, unknown>>;
}

export type EvmLogTopicFilter = string | readonly string[] | null;

export interface EvmLogQuery {
  address: string;
  fromBlock: string;
  toBlock: string;
  topics?: readonly EvmLogTopicFilter[];
}

export interface EvmLogReader {
  getLogsObservation(query: EvmLogQuery): Promise<TransportObservation<EvmLogRecord[]>>;
}

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

function requireHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `EVM provider returned an invalid ${field}.`);
  }
  return value.toLowerCase();
}

function requireAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `EVM provider returned an invalid ${field}.`);
  }
  return value;
}

function nullableAddress(value: unknown, field: string): string | null {
  return value === null ? null : requireAddress(value, field);
}

function nullableHash(value: unknown, field: string): string | null {
  return value === null ? null : requireHash(value, field);
}

function nullableHexQuantity(value: unknown, field: string): string | null {
  return value === null ? null : requireHexQuantity(value, field);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', `EVM provider returned an invalid ${field}.`);
  }
  return value as Record<string, unknown>;
}

function parseTransaction(value: unknown, expectedHash: string): EvmTransactionRecord | null {
  if (value === null) return null;
  const raw = requireRecord(value, 'transaction');
  const hash = requireHash(raw.hash, 'transaction hash');
  if (hash !== expectedHash.toLowerCase()) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'EVM transaction identity does not match the requested hash.',
    );
  }
  const blockHash = nullableHash(raw.blockHash, 'transaction block hash');
  const blockNumber = nullableHexQuantity(raw.blockNumber, 'transaction block number');
  const transactionIndex = nullableHexQuantity(raw.transactionIndex, 'transaction index');
  const placementFields = [blockHash, blockNumber, transactionIndex];
  if (
    placementFields.some((item) => item === null) &&
    placementFields.some((item) => item !== null)
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'EVM transaction placement fields disagree about pending state.',
    );
  }
  return {
    hash,
    blockHash,
    blockNumber,
    transactionIndex,
    from: requireAddress(raw.from, 'transaction sender'),
    to: nullableAddress(raw.to, 'transaction recipient'),
    value: requireHexQuantity(raw.value, 'transaction value'),
    nonce: requireHexQuantity(raw.nonce, 'transaction nonce'),
    gas: requireHexQuantity(raw.gas, 'transaction gas limit'),
    input: requireHexData(raw.input, 'transaction input'),
    raw,
  };
}

function parseReceipt(value: unknown, expectedHash: string): EvmTransactionReceiptRecord | null {
  if (value === null) return null;
  const raw = requireRecord(value, 'transaction receipt');
  const transactionHash = requireHash(raw.transactionHash, 'receipt transaction hash');
  if (transactionHash !== expectedHash.toLowerCase()) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'EVM receipt identity does not match the requested transaction.',
    );
  }
  const statusValue = raw.status;
  const status =
    statusValue === undefined || statusValue === null
      ? null
      : requireHexQuantity(statusValue, 'receipt status');
  if (status !== null && status !== '0x0' && status !== '0x1') {
    throw new ProviderError('INVALID_RESPONSE', 'EVM receipt status must be 0x0 or 0x1.');
  }
  if (!Array.isArray(raw.logs)) {
    throw new ProviderError('INVALID_RESPONSE', 'EVM receipt logs must be an array.');
  }
  return {
    transactionHash,
    blockHash: requireHash(raw.blockHash, 'receipt block hash'),
    blockNumber: requireHexQuantity(raw.blockNumber, 'receipt block number'),
    transactionIndex: requireHexQuantity(raw.transactionIndex, 'receipt transaction index'),
    from: requireAddress(raw.from, 'receipt sender'),
    to: nullableAddress(raw.to, 'receipt recipient'),
    contractAddress: nullableAddress(raw.contractAddress, 'receipt contract address'),
    cumulativeGasUsed: requireHexQuantity(raw.cumulativeGasUsed, 'receipt cumulative gas used'),
    gasUsed: requireHexQuantity(raw.gasUsed, 'receipt gas used'),
    status: status as '0x0' | '0x1' | null,
    logCount: raw.logs.length,
    raw,
  };
}

function parseLog(value: unknown): EvmLogRecord {
  const raw = requireRecord(value, 'log');
  if (!Array.isArray(raw.topics) || raw.topics.length > 4) {
    throw new ProviderError('INVALID_RESPONSE', 'EVM provider returned invalid log topics.');
  }
  if (raw.removed !== false) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'EVM provider returned a removed or non-final log observation.',
    );
  }
  return {
    address: requireAddress(raw.address, 'log address').toLowerCase(),
    blockHash: requireHash(raw.blockHash, 'log block hash'),
    blockNumber: requireHexQuantity(raw.blockNumber, 'log block number'),
    transactionHash: requireHash(raw.transactionHash, 'log transaction hash'),
    transactionIndex: requireHexQuantity(raw.transactionIndex, 'log transaction index'),
    logIndex: requireHexQuantity(raw.logIndex, 'log index'),
    data: requireHexData(raw.data, 'log data').toLowerCase(),
    topics: raw.topics.map((topic, index) => requireHash(topic, `log topic ${index}`)),
    removed: false,
    raw,
  };
}

function normalizeLogTopics(topics: readonly EvmLogTopicFilter[] | undefined) {
  if (topics === undefined) return undefined;
  if (topics.length > 4) {
    throw new ProviderError('INVALID_RESPONSE', 'EVM log queries support at most four topics.');
  }
  return topics.map((topic, index) => {
    if (topic === null) return null;
    if (typeof topic === 'string') return requireHash(topic, `log filter topic ${index}`);
    if (topic.length === 0) {
      throw new ProviderError('INVALID_RESPONSE', 'EVM log topic alternatives may not be empty.');
    }
    return [...new Set(topic.map((item) => requireHash(item, `log filter topic ${index}`)))];
  });
}

function matchesLogTopics(
  logTopics: readonly string[],
  filters: ReturnType<typeof normalizeLogTopics>,
): boolean {
  if (filters === undefined) return true;
  return filters.every((filter, index) => {
    if (filter === null) return true;
    const topic = logTopics[index];
    if (topic === undefined) return false;
    return typeof filter === 'string' ? topic === filter : filter.includes(topic);
  });
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

function requireBlockTag(value: string): string {
  if (
    !['latest', 'safe', 'finalized', 'earliest'].includes(value) &&
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'EVM block tag must be canonical and read-only.');
  }
  return value;
}

export interface EvmAdapterConfig {
  id: string;
  chainId: number;
  chainName: string;
  snapshotBlockTag?: 'latest' | 'safe' | 'finalized';
  adapterVersion?: string;
  maxLogRangeBlocks?: number;
  maxLogResults?: number;
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

  async call(to: string, data: string, blockTag: string): Promise<string> {
    return (await this.callObservation(to, data, blockTag)).value;
  }

  async callObservation(
    to: string,
    data: string,
    blockTag: string,
  ): Promise<TransportObservation<string>> {
    const request = {
      to: requireAddress(to, 'call target'),
      data: requireHexData(data, 'call data'),
    };
    const observation = await this.readSourced<unknown>('eth_call', [
      request,
      requireBlockTag(blockTag),
    ]);
    return { ...observation, value: requireHexData(observation.value, 'call result') };
  }

  async getTransaction(hash: string): Promise<EvmTransactionRecord | null> {
    return (await this.getTransactionObservation(hash)).value;
  }

  async getTransactionObservation(
    hash: string,
  ): Promise<TransportObservation<EvmTransactionRecord | null>> {
    const normalizedHash = requireHash(hash, 'requested transaction hash');
    const observation = await this.readSourced<unknown>('eth_getTransactionByHash', [
      normalizedHash,
    ]);
    return { ...observation, value: parseTransaction(observation.value, normalizedHash) };
  }

  async getTransactionReceipt(hash: string): Promise<EvmTransactionReceiptRecord | null> {
    return (await this.getTransactionReceiptObservation(hash)).value;
  }

  async getTransactionReceiptObservation(
    hash: string,
  ): Promise<TransportObservation<EvmTransactionReceiptRecord | null>> {
    const normalizedHash = requireHash(hash, 'requested transaction hash');
    const observation = await this.readSourced<unknown>('eth_getTransactionReceipt', [
      normalizedHash,
    ]);
    return { ...observation, value: parseReceipt(observation.value, normalizedHash) };
  }

  async getLogs(query: EvmLogQuery): Promise<EvmLogRecord[]> {
    return (await this.getLogsObservation(query)).value;
  }

  async getLogsObservation(query: EvmLogQuery): Promise<TransportObservation<EvmLogRecord[]>> {
    const fromBlock = requireDecimalPosition(query.fromBlock);
    const toBlock = requireDecimalPosition(query.toBlock);
    if (toBlock < fromBlock) {
      throw new ProviderError('INVALID_RESPONSE', 'EVM log range ends before it begins.');
    }
    const range = toBlock - fromBlock + 1n;
    const configuredRange = this.config.maxLogRangeBlocks ?? 10_000;
    if (!Number.isSafeInteger(configuredRange) || configuredRange < 1) {
      throw new ProviderError('INVALID_RESPONSE', 'EVM maximum log range is invalid.');
    }
    if (range > BigInt(configuredRange)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `EVM log range exceeds the configured ${configuredRange}-block limit.`,
      );
    }
    const address = requireAddress(query.address, 'log filter address').toLowerCase();
    const topics = normalizeLogTopics(query.topics);
    const filter = {
      address,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      ...(topics === undefined ? {} : { topics }),
    };
    const observation = await this.readSourced<unknown>('eth_getLogs', [filter]);
    if (!Array.isArray(observation.value)) {
      throw new ProviderError('INVALID_RESPONSE', 'EVM provider returned a non-array log result.');
    }
    const configuredResults = this.config.maxLogResults ?? 10_000;
    if (!Number.isSafeInteger(configuredResults) || configuredResults < 1) {
      throw new ProviderError('INVALID_RESPONSE', 'EVM maximum log result count is invalid.');
    }
    if (observation.value.length > configuredResults) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `EVM log result exceeds the configured ${configuredResults}-record limit.`,
      );
    }
    const seen = new Set<string>();
    const logs = observation.value
      .map((value) => parseLog(value))
      .sort((left, right) => {
        const blockOrder = BigInt(left.blockNumber) - BigInt(right.blockNumber);
        if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
        const transactionOrder = BigInt(left.transactionIndex) - BigInt(right.transactionIndex);
        if (transactionOrder !== 0n) return transactionOrder < 0n ? -1 : 1;
        const logOrder = BigInt(left.logIndex) - BigInt(right.logIndex);
        return logOrder === 0n ? 0 : logOrder < 0n ? -1 : 1;
      });
    for (const log of logs) {
      const position = BigInt(log.blockNumber);
      if (
        position < fromBlock ||
        position > toBlock ||
        log.address !== address ||
        !matchesLogTopics(log.topics, topics)
      ) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'EVM provider returned a log outside the requested range, address, or topic filter.',
        );
      }
      const identity = `${log.blockHash}:${log.transactionHash}:${log.logIndex}`;
      if (seen.has(identity)) {
        throw new ProviderError('INVALID_RESPONSE', 'EVM provider returned a duplicate log.');
      }
      seen.add(identity);
    }
    return { ...observation, value: logs };
  }

  #anchorFromBlock(
    observation: TransportObservation<unknown>,
    expectedPosition?: string,
    expectedHash?: string,
  ): ChainAnchorRead {
    const finality = this.config.snapshotBlockTag ?? 'finalized';
    const block = requireRecord(observation.value, 'block');
    const blockNumber = hexQuantity(block.number, 'block number').toString();
    if (expectedPosition !== undefined && blockNumber !== expectedPosition) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'EVM provider returned a block at a different position.',
      );
    }
    const blockHash = requireHash(block.hash, 'block hash');
    if (expectedHash !== undefined && blockHash !== expectedHash.toLowerCase()) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'EVM provider returned a block with a different hash.',
      );
    }
    const parentBlockHash = requireHash(block.parentHash, 'parent block hash');
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

  async #readAnchor(blockTag: string, expectedPosition?: string): Promise<ChainAnchorRead> {
    const observation = await this.readSourced<unknown>('eth_getBlockByNumber', [blockTag, false], {
      cacheMode: 'bypass',
    });
    return this.#anchorFromBlock(observation, expectedPosition);
  }

  readHeadAnchor(): Promise<ChainAnchorRead> {
    return this.#readAnchor(this.config.snapshotBlockTag ?? 'finalized');
  }

  async readAnchorAt(position: string): Promise<ChainAnchorRead> {
    const numericPosition = requireDecimalPosition(position);
    return this.#readAnchor(`0x${numericPosition.toString(16)}`, position);
  }

  async readAnchorByHash(hash: string): Promise<ChainAnchorRead> {
    const normalizedHash = requireHash(hash, 'requested block hash');
    const observation = await this.readSourced<unknown>(
      'eth_getBlockByHash',
      [normalizedHash, false],
      { cacheMode: 'bypass' },
    );
    return this.#anchorFromBlock(observation, undefined, normalizedHash);
  }

  async createSnapshot(): Promise<EvmSnapshot> {
    return (await this.readHeadAnchor()).snapshot as EvmSnapshot;
  }
}
