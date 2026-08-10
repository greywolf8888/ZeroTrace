import { ProviderError, toProviderError } from './errors.js';
import {
  assertProviderUrlSafe,
  validateProviderUrlSyntax,
  type ProviderUrlPolicy,
} from './security.js';
import { parseProviderJson, type FetchImplementation } from './transport.js';
import type { JsonValue } from '@zerotrace/schemas';
import type {
  EvmContractCreationQuery,
  EvmContractCreationReader,
  EvmContractCreationRecord,
  EvmContractCreationObservation,
  EvmLogQuery,
  EvmLogReader,
  EvmLogRecord,
  EvmLogTopicFilter,
} from './evm.js';
import type { TransportObservation } from './transport.js';

export const SQD_DATASETS = {
  'ethereum-mainnet': {
    ledger: 'EVM',
    chainId: '1',
    queryType: 'evm',
    contiguous: true,
  },
  'binance-mainnet': {
    ledger: 'EVM',
    chainId: '56',
    queryType: 'evm',
    contiguous: true,
  },
  'bitcoin-mainnet': {
    ledger: 'BITCOIN',
    chainId: 'bitcoin-mainnet',
    queryType: 'bitcoin',
    contiguous: true,
  },
  'solana-mainnet': {
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    queryType: 'solana',
    contiguous: false,
  },
} as const;

export type SqdDataset = keyof typeof SQD_DATASETS;
export type SqdQueryType = (typeof SQD_DATASETS)[SqdDataset]['queryType'];

export interface SqdDatasetMetadata {
  dataset: SqdDataset;
  aliases: readonly string[];
  realTime: boolean;
  startBlock: number | null;
}

export interface SqdBlockHeader {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number | null;
  [field: string]: JsonValue;
}

export interface SqdFinalizedBlock {
  header: SqdBlockHeader;
  [field: string]: JsonValue;
}

export interface SqdTransactionItem {
  sourceIndex: number;
  identity: string;
  payload: Readonly<Record<string, JsonValue>>;
}

export interface SqdLedgerRecordItem {
  sourceIndex: number;
  identity: string;
  payload: Readonly<Record<string, JsonValue>>;
}

export interface SqdFinalizedRangeRequest {
  fromBlock: number;
  toBlock: number;
  includeAllBlocks?: boolean;
  fields?: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  requests?: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}

export interface SqdStreamSummary {
  dataset: SqdDataset;
  completion: 'REQUESTED_RANGE_COMPLETE' | 'SOURCE_HEAD_REACHED';
  requestedFrom: number;
  requestedTo: number;
  lastBlock: number | null;
  nextBlock: number;
  finalizedHead: number | null;
  blocks: number;
  requests: number;
  retries: number;
}

export interface SqdPortalClientOptions {
  portalUrl: string;
  dataset: SqdDataset;
  policy: ProviderUrlPolicy;
  timeoutMs?: number;
  maxRangeBlocks?: number;
  maxResponseBytes?: number;
  maxLineBytes?: number;
  maxRequestsPerRange?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  requestsPerSecond?: number;
  fetchImplementation?: FetchImplementation;
  nowImplementation?: () => number;
  sleepImplementation?: (milliseconds: number) => Promise<void>;
}

interface ResolvedOptions {
  portalUrl: string;
  dataset: SqdDataset;
  policy: ProviderUrlPolicy;
  timeoutMs: number;
  maxRangeBlocks: number;
  maxResponseBytes: number;
  maxLineBytes: number;
  maxRequestsPerRange: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  requestsPerSecond: number;
  fetchImplementation: FetchImplementation;
  nowImplementation: () => number;
  sleepImplementation: (milliseconds: number) => Promise<void>;
}

interface StreamProgress {
  lastBlock: number | null;
  lastHash: string | null;
  blocks: number;
  finalizedHead: number | null;
}

class SqdConsumerError extends Error {
  readonly consumerCause: unknown;

  constructor(cause: unknown) {
    super('SQD block consumer failed.', { cause });
    this.name = 'SqdConsumerError';
    this.consumerCause = cause;
  }
}

const DATASET_PATH = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const EVM_TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_STATE_KEY = /^(?:balance|code|nonce|0x[0-9a-fA-F]{64})$/;
const BITCOIN_TRANSACTION_ID = /^[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const SOLANA_BLOCK_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const SOLANA_ACCOUNT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9][0-9]*)$/;
const EVM_TRACE_TYPES = new Set(['call', 'create', 'suicide', 'reward']);
const EVM_STATE_DIFF_KINDS = new Set(['=', '+', '*', '-']);
const SOLANA_LOG_KINDS = new Set(['log', 'data', 'other']);
const MAX_QUERY_BYTES = 262_144;
const MAX_TRANSACTIONS_PER_BLOCK = 100_000;
const MAX_LEDGER_RECORDS_PER_BLOCK = 1_000_000;
const MAX_INSTRUCTION_ADDRESS_DEPTH = 64;
const EVM_HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/;

const ALLOWED_FIELD_GROUPS: Record<SqdQueryType, ReadonlySet<string>> = {
  evm: new Set(['block', 'transaction', 'log', 'trace', 'stateDiff']),
  bitcoin: new Set(['block', 'transaction', 'input', 'output']),
  solana: new Set([
    'block',
    'transaction',
    'instruction',
    'log',
    'balance',
    'tokenBalance',
    'reward',
  ]),
};

const ALLOWED_REQUEST_GROUPS: Record<SqdQueryType, ReadonlySet<string>> = {
  evm: new Set(['transactions', 'logs', 'traces', 'stateDiffs']),
  bitcoin: new Set(['transactions', 'inputs', 'outputs']),
  solana: new Set(['transactions', 'instructions', 'logs', 'balances', 'tokenBalances', 'rewards']),
};

function requireInteger(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resolveOptions(options: SqdPortalClientOptions): ResolvedOptions {
  const portal = validateProviderUrlSyntax(options.portalUrl, options.policy);
  if (
    (portal.pathname !== '' && portal.pathname !== '/') ||
    portal.search !== '' ||
    portal.hash !== ''
  ) {
    throw new ProviderError(
      'INVALID_PROVIDER_URL',
      'SQD Portal URL must be an origin without a path, query, or fragment.',
    );
  }
  if (!DATASET_PATH.test(options.dataset) || SQD_DATASETS[options.dataset] === undefined) {
    throw new RangeError('SQD dataset is not supported by this adapter version.');
  }
  const timeoutMs = requireInteger(options.timeoutMs ?? 30_000, 'timeoutMs', 1, 300_000);
  const maxRangeBlocks = requireInteger(
    options.maxRangeBlocks ?? 50_000,
    'maxRangeBlocks',
    1,
    1_000_000,
  );
  const maxResponseBytes = requireInteger(
    options.maxResponseBytes ?? 64_000_000,
    'maxResponseBytes',
    1_024,
    1_000_000_000,
  );
  const maxLineBytes = requireInteger(
    options.maxLineBytes ?? 8_000_000,
    'maxLineBytes',
    128,
    maxResponseBytes,
  );
  const maxRequestsPerRange = requireInteger(
    options.maxRequestsPerRange ?? 10_000,
    'maxRequestsPerRange',
    1,
    1_000_000,
  );
  const maxAttempts = requireInteger(options.maxAttempts ?? 3, 'maxAttempts', 1, 10);
  const retryBaseDelayMs = requireInteger(
    options.retryBaseDelayMs ?? 250,
    'retryBaseDelayMs',
    0,
    60_000,
  );
  const retryMaxDelayMs = requireInteger(
    options.retryMaxDelayMs ?? 10_000,
    'retryMaxDelayMs',
    0,
    300_000,
  );
  if (retryBaseDelayMs > retryMaxDelayMs) {
    throw new RangeError('retryBaseDelayMs may not exceed retryMaxDelayMs.');
  }
  const requestsPerSecond = options.requestsPerSecond ?? 2;
  if (!Number.isFinite(requestsPerSecond) || requestsPerSecond < 0 || requestsPerSecond > 20) {
    throw new RangeError('requestsPerSecond must be between 0 and 20.');
  }
  return {
    portalUrl: portal.origin,
    dataset: options.dataset,
    policy: options.policy,
    timeoutMs,
    maxRangeBlocks,
    maxResponseBytes,
    maxLineBytes,
    maxRequestsPerRange,
    maxAttempts,
    retryBaseDelayMs,
    retryMaxDelayMs,
    requestsPerSecond,
    fetchImplementation: options.fetchImplementation ?? fetch,
    nowImplementation: options.nowImplementation ?? Date.now,
    sleepImplementation: options.sleepImplementation ?? defaultSleep,
  };
}

function retryAfterMs(response: Response, now: number): number | undefined {
  const raw = response.headers.get('retry-after')?.trim();
  if (raw === undefined || raw === '') return undefined;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.ceil(Number(raw) * 1_000));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function responseError(response: Response, now: number): ProviderError {
  const retryAfter = retryAfterMs(response, now);
  if (response.status >= 300 && response.status < 400) {
    return new ProviderError('REDIRECT_BLOCKED', 'SQD Portal redirects are blocked.');
  }
  if (response.status === 429) {
    return new ProviderError('RATE_LIMITED', 'SQD Portal rate limit exceeded.', {
      retryable: true,
      statusCode: 429,
      ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
    });
  }
  if (response.status === 409) {
    return new ProviderError(
      'INVALID_RESPONSE',
      'SQD finalized stream unexpectedly reported a chain reorganization.',
      { statusCode: 409 },
    );
  }
  return new ProviderError('HTTP_ERROR', `SQD Portal returned HTTP ${response.status}.`, {
    retryable: response.status >= 500,
    statusCode: response.status,
    ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
  });
}

function parseHead(response: Response): number | null {
  const raw = response.headers.get('x-sqd-finalized-head-number');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD finalized head header is invalid.');
  }
  return value;
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function parseBlock(line: string, fromBlock: number, toBlock: number): SqdFinalizedBlock {
  let parsed: unknown;
  try {
    parsed = parseProviderJson(line);
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal returned invalid JSONL.', {
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal block must be a JSON object.');
  }
  const header = (parsed as Record<string, unknown>).header;
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal block is missing its header.');
  }
  const record = header as Record<string, unknown>;
  const number = record.number;
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < fromBlock ||
    number > toBlock
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal block number is outside the request.');
  }
  if (typeof record.hash !== 'string' || record.hash.length === 0) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal block hash is missing.');
  }
  if (typeof record.parentHash !== 'string' || record.parentHash.length === 0) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal parent block hash is missing.');
  }
  const timestamp = record.timestamp;
  if (
    timestamp !== undefined &&
    timestamp !== null &&
    (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp < 0)
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal block timestamp is invalid.');
  }
  return {
    ...(parsed as Record<string, unknown>),
    header: {
      ...record,
      number,
      hash: record.hash,
      parentHash: record.parentHash,
      timestamp: timestamp === undefined ? null : (timestamp as number | null),
    },
  };
}

function transactionIdentity(
  dataset: SqdDataset,
  transaction: Readonly<Record<string, unknown>>,
): string {
  const queryType = SQD_DATASETS[dataset].queryType;
  if (queryType === 'evm') {
    const hash = transaction.hash;
    if (typeof hash !== 'string' || !EVM_TRANSACTION_HASH.test(hash)) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD EVM transaction hash is invalid.');
    }
    return hash.toLowerCase();
  }
  if (queryType === 'bitcoin') {
    const txid = transaction.txid;
    if (typeof txid !== 'string' || !BITCOIN_TRANSACTION_ID.test(txid)) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD Bitcoin transaction ID is invalid.');
    }
    return txid.toLowerCase();
  }
  const signatures = transaction.signatures;
  if (
    !Array.isArray(signatures) ||
    signatures.length === 0 ||
    !signatures.every(
      (signature) => typeof signature === 'string' && SOLANA_SIGNATURE.test(signature),
    )
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Solana transaction signatures are invalid.');
  }
  return signatures[0] as string;
}

export function sqdTransactionsFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdTransactionItem[] {
  const transactions = block.transactions;
  if (transactions === undefined) return [];
  if (!Array.isArray(transactions) || transactions.length > MAX_TRANSACTIONS_PER_BLOCK) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD transaction table is invalid or too large.');
  }
  const identities = new Set<string>();
  return transactions.map((transaction, sourceIndex) => {
    if (typeof transaction !== 'object' || transaction === null || Array.isArray(transaction)) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD transaction must be a JSON object.');
    }
    const payload = transaction as Readonly<Record<string, JsonValue>>;
    const identity = transactionIdentity(dataset, payload);
    if (identities.has(identity)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'SQD transaction table contains a duplicate identity.',
      );
    }
    identities.add(identity);
    return { sourceIndex, identity, payload };
  });
}

function sourcePosition(value: JsonValue | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError('INVALID_RESPONSE', `SQD ${field} is invalid.`);
  }
  return value;
}

function ledgerRecordsFromTable(
  block: SqdFinalizedBlock,
  tableName:
    | 'logs'
    | 'inputs'
    | 'outputs'
    | 'instructions'
    | 'traces'
    | 'stateDiffs'
    | 'balances'
    | 'tokenBalances'
    | 'rewards',
  identityFor: (payload: Readonly<Record<string, JsonValue>>, sourceIndex: number) => string,
): readonly SqdLedgerRecordItem[] {
  const table = block[tableName];
  if (table === undefined) return [];
  if (!Array.isArray(table) || table.length > MAX_LEDGER_RECORDS_PER_BLOCK) {
    throw new ProviderError('INVALID_RESPONSE', `SQD ${tableName} table is invalid or too large.`);
  }
  const identities = new Set<string>();
  return table.map((record, sourceIndex) => {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw new ProviderError('INVALID_RESPONSE', `SQD ${tableName} item must be a JSON object.`);
    }
    const payload = record as Readonly<Record<string, JsonValue>>;
    const identity = identityFor(payload, sourceIndex);
    if (identities.has(identity)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `SQD ${tableName} table contains a duplicate identity.`,
      );
    }
    identities.add(identity);
    return { sourceIndex, identity, payload };
  });
}

function requireDatasetType(dataset: SqdDataset, expected: SqdQueryType, tableName: string): void {
  if (SQD_DATASETS[dataset].queryType !== expected) {
    throw new RangeError(`SQD ${tableName} records are not applicable to ${dataset}.`);
  }
}

export function sqdEvmLogsFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'evm', 'EVM log');
  return ledgerRecordsFromTable(block, 'logs', (payload) => {
    const transactionHash = payload.transactionHash;
    if (typeof transactionHash !== 'string' || !EVM_TRANSACTION_HASH.test(transactionHash)) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD EVM log transaction hash is invalid.');
    }
    const logIndex = sourcePosition(payload.logIndex, 'EVM log index');
    sourcePosition(payload.transactionIndex, 'EVM log transaction index');
    return `${transactionHash.toLowerCase()}:${logIndex}`;
  });
}

function evmBlockHash(block: SqdFinalizedBlock, tableName: string): string {
  if (!EVM_TRANSACTION_HASH.test(block.header.hash)) {
    throw new ProviderError('INVALID_RESPONSE', `SQD ${tableName} block hash is invalid.`);
  }
  return block.header.hash.toLowerCase();
}

function sourcePath(value: JsonValue | undefined, field: string, allowEmpty: boolean): number[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > MAX_INSTRUCTION_ADDRESS_DEPTH ||
    !value.every(
      (position) => typeof position === 'number' && Number.isSafeInteger(position) && position >= 0,
    )
  ) {
    throw new ProviderError('INVALID_RESPONSE', `SQD ${field} is invalid.`);
  }
  return value as number[];
}

export function sqdEvmTracesFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'evm', 'EVM trace');
  const blockHash = evmBlockHash(block, 'EVM trace');
  return ledgerRecordsFromTable(block, 'traces', (payload) => {
    const transactionIndex = sourcePosition(
      payload.transactionIndex,
      'EVM trace transaction index',
    );
    const traceAddress = sourcePath(payload.traceAddress, 'EVM trace address', true);
    if (typeof payload.type !== 'string' || !EVM_TRACE_TYPES.has(payload.type)) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD EVM trace type is invalid.');
    }
    for (const field of ['error', 'revertReason'] as const) {
      const value = payload[field];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        throw new ProviderError('INVALID_RESPONSE', `SQD EVM trace ${field} is invalid.`);
      }
    }
    const path = traceAddress.length === 0 ? 'root' : traceAddress.join('.');
    return `${blockHash}:${transactionIndex}:${path}`;
  });
}

export function sqdEvmStateDiffsFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'evm', 'EVM state diff');
  const blockHash = evmBlockHash(block, 'EVM state diff');
  return ledgerRecordsFromTable(block, 'stateDiffs', (payload) => {
    const transactionIndex = sourcePosition(
      payload.transactionIndex,
      'EVM state diff transaction index',
    );
    const address = payload.address;
    const key = payload.key;
    if (typeof address !== 'string' || !EVM_ADDRESS.test(address)) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD EVM state diff address is invalid.');
    }
    if (typeof key !== 'string' || !EVM_STATE_KEY.test(key)) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD EVM state diff key is invalid.');
    }
    if (typeof payload.kind !== 'string' || !EVM_STATE_DIFF_KINDS.has(payload.kind)) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD EVM state diff kind is invalid.');
    }
    for (const field of ['prev', 'next'] as const) {
      const value = payload[field];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        throw new ProviderError('INVALID_RESPONSE', `SQD EVM state diff ${field} is invalid.`);
      }
    }
    return `${blockHash}:${transactionIndex}:${address.toLowerCase()}:${key.toLowerCase()}`;
  });
}

function bitcoinRecordIdentity(
  block: SqdFinalizedBlock,
  payload: Readonly<Record<string, JsonValue>>,
  itemIndexField: 'inputIndex' | 'outputIndex',
): string {
  if (!BITCOIN_TRANSACTION_ID.test(block.header.hash)) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Bitcoin block hash is invalid.');
  }
  const transactionIndex = sourcePosition(
    payload.transactionIndex,
    'Bitcoin parent transaction index',
  );
  const itemIndex = sourcePosition(payload[itemIndexField], `Bitcoin ${itemIndexField}`);
  return `${block.header.hash.toLowerCase()}:${transactionIndex}:${itemIndex}`;
}

export function sqdBitcoinInputsFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'bitcoin', 'Bitcoin input');
  return ledgerRecordsFromTable(block, 'inputs', (payload) => {
    const txid = payload.txid;
    const vout = payload.vout;
    if (txid !== undefined && txid !== null) {
      if (typeof txid !== 'string' || !BITCOIN_TRANSACTION_ID.test(txid)) {
        throw new ProviderError('INVALID_RESPONSE', 'SQD Bitcoin input outpoint txid is invalid.');
      }
    }
    if (vout !== undefined && vout !== null) {
      sourcePosition(vout, 'Bitcoin input outpoint index');
    }
    if ((txid === null) !== (vout === null)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'SQD Bitcoin input outpoint must be fully known or explicitly null for coinbase.',
      );
    }
    return bitcoinRecordIdentity(block, payload, 'inputIndex');
  });
}

export function sqdBitcoinOutputsFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'bitcoin', 'Bitcoin output');
  return ledgerRecordsFromTable(block, 'outputs', (payload) =>
    bitcoinRecordIdentity(block, payload, 'outputIndex'),
  );
}

export function sqdSolanaInstructionsFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'solana', 'Solana instruction');
  if (!SOLANA_BLOCK_HASH.test(block.header.hash)) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Solana block hash is invalid.');
  }
  return ledgerRecordsFromTable(block, 'instructions', (payload) => {
    const transactionIndex = sourcePosition(
      payload.transactionIndex,
      'Solana instruction transaction index',
    );
    const address = sourcePath(payload.instructionAddress, 'Solana instruction address', false);
    return `${block.header.hash}:${transactionIndex}:${address.join('.')}`;
  });
}

function solanaBlockHash(block: SqdFinalizedBlock, tableName: string): string {
  if (!SOLANA_BLOCK_HASH.test(block.header.hash)) {
    throw new ProviderError('INVALID_RESPONSE', `SQD ${tableName} block hash is invalid.`);
  }
  return block.header.hash;
}

function solanaAccount(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !SOLANA_ACCOUNT.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `SQD ${field} is invalid.`);
  }
  return value;
}

function optionalSolanaAccount(value: JsonValue | undefined, field: string): void {
  if (value === undefined || value === null) return;
  solanaAccount(value, field);
}

function decimalQuantity(
  value: JsonValue | undefined,
  field: string,
  options: { nullable?: boolean; signed?: boolean } = {},
): boolean {
  if (value === undefined || value === null) {
    if (options.nullable) return false;
    throw new ProviderError('INVALID_RESPONSE', `SQD ${field} is unavailable.`);
  }
  const pattern = options.signed ? SIGNED_DECIMAL : UNSIGNED_DECIMAL;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `SQD ${field} is invalid.`);
  }
  return true;
}

function optionalDecimals(value: JsonValue | undefined, field: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new ProviderError('INVALID_RESPONSE', `SQD ${field} is invalid.`);
  }
}

export function sqdSolanaLogsFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'solana', 'Solana log');
  const blockHash = solanaBlockHash(block, 'Solana log');
  return ledgerRecordsFromTable(block, 'logs', (payload) => {
    const transactionIndex = sourcePosition(
      payload.transactionIndex,
      'Solana log transaction index',
    );
    const logIndex = sourcePosition(payload.logIndex, 'Solana log index');
    sourcePath(payload.instructionAddress, 'Solana log instruction address', true);
    solanaAccount(payload.programId, 'Solana log program ID');
    if (typeof payload.kind !== 'string' || !SOLANA_LOG_KINDS.has(payload.kind)) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD Solana log kind is invalid.');
    }
    if (typeof payload.message !== 'string') {
      throw new ProviderError('INVALID_RESPONSE', 'SQD Solana log message is invalid.');
    }
    return `${blockHash}:${transactionIndex}:${logIndex}`;
  });
}

export function sqdSolanaBalancesFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'solana', 'Solana balance');
  const blockHash = solanaBlockHash(block, 'Solana balance');
  return ledgerRecordsFromTable(block, 'balances', (payload) => {
    const transactionIndex = sourcePosition(
      payload.transactionIndex,
      'Solana balance transaction index',
    );
    const account = solanaAccount(payload.account, 'Solana balance account');
    decimalQuantity(payload.pre, 'Solana pre-balance');
    decimalQuantity(payload.post, 'Solana post-balance');
    return `${blockHash}:${transactionIndex}:${account}`;
  });
}

export function sqdSolanaTokenBalancesFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'solana', 'Solana token balance');
  const blockHash = solanaBlockHash(block, 'Solana token balance');
  return ledgerRecordsFromTable(block, 'tokenBalances', (payload) => {
    const transactionIndex = sourcePosition(
      payload.transactionIndex,
      'Solana token balance transaction index',
    );
    const account = solanaAccount(payload.account, 'Solana token balance account');
    const hasPre = decimalQuantity(payload.preAmount, 'Solana pre-token amount', {
      nullable: true,
    });
    const hasPost = decimalQuantity(payload.postAmount, 'Solana post-token amount', {
      nullable: true,
    });
    if (!hasPre && !hasPost) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'SQD Solana token balance has neither a pre nor post amount.',
      );
    }
    for (const field of [
      'preProgramId',
      'preMint',
      'preOwner',
      'postProgramId',
      'postMint',
      'postOwner',
    ] as const) {
      optionalSolanaAccount(payload[field], `Solana token balance ${field}`);
    }
    optionalDecimals(payload.preDecimals, 'Solana pre-token decimals');
    optionalDecimals(payload.postDecimals, 'Solana post-token decimals');
    return `${blockHash}:${transactionIndex}:${account}`;
  });
}

export function sqdSolanaRewardsFromBlock(
  dataset: SqdDataset,
  block: SqdFinalizedBlock,
): readonly SqdLedgerRecordItem[] {
  requireDatasetType(dataset, 'solana', 'Solana reward');
  const blockHash = solanaBlockHash(block, 'Solana reward');
  return ledgerRecordsFromTable(block, 'rewards', (payload, sourceIndex) => {
    const pubkey = solanaAccount(payload.pubkey, 'Solana reward pubkey');
    decimalQuantity(payload.lamports, 'Solana reward lamports', { signed: true });
    decimalQuantity(payload.postBalance, 'Solana reward post-balance');
    if (
      payload.rewardType !== undefined &&
      payload.rewardType !== null &&
      typeof payload.rewardType !== 'string'
    ) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD Solana reward type is invalid.');
    }
    if (
      payload.commission !== undefined &&
      payload.commission !== null &&
      (typeof payload.commission !== 'number' ||
        !Number.isSafeInteger(payload.commission) ||
        payload.commission < 0 ||
        payload.commission > 100)
    ) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD Solana reward commission is invalid.');
    }
    return `${blockHash}:${sourceIndex}:${pubkey}`;
  });
}

function validateFilterValue(value: unknown, depth = 0): void {
  if (depth > 6) throw new RangeError('SQD request filters may not exceed six levels.');
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new RangeError('SQD request filter array is too large.');
    for (const item of value) validateFilterValue(item, depth + 1);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RangeError('SQD request filters must contain plain JSON values.');
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!FIELD_NAME.test(key)) throw new RangeError('SQD request filter name is invalid.');
      validateFilterValue(item, depth + 1);
    }
    return;
  }
  throw new RangeError('SQD request filters must contain plain JSON values.');
}

function buildQuery(
  dataset: SqdDataset,
  request: SqdFinalizedRangeRequest,
): Record<string, unknown> {
  const config = SQD_DATASETS[dataset];
  if (request.includeAllBlocks !== undefined && typeof request.includeAllBlocks !== 'boolean') {
    throw new RangeError('SQD includeAllBlocks must be boolean.');
  }
  const allowedFields = ALLOWED_FIELD_GROUPS[config.queryType];
  const fields: Record<string, Record<string, boolean>> = {};
  for (const [group, selection] of Object.entries(request.fields ?? {})) {
    if (!allowedFields.has(group)) {
      throw new RangeError(`SQD field group ${group} is not valid for ${config.queryType}.`);
    }
    const selected: Record<string, boolean> = {};
    for (const [field, include] of Object.entries(selection)) {
      if (!FIELD_NAME.test(field) || typeof include !== 'boolean') {
        throw new RangeError('SQD field selections must map valid field names to booleans.');
      }
      selected[field] = include;
    }
    fields[group] = selected;
  }
  fields.block = {
    ...(fields.block ?? {}),
    number: true,
    hash: true,
    parentHash: true,
    timestamp: true,
  };

  const allowedRequests = ALLOWED_REQUEST_GROUPS[config.queryType];
  const itemRequests: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
  for (const [group, filters] of Object.entries(request.requests ?? {})) {
    if (!allowedRequests.has(group)) {
      throw new RangeError(`SQD request group ${group} is not valid for ${config.queryType}.`);
    }
    if (!Array.isArray(filters) || filters.length > 1_000) {
      throw new RangeError('SQD request groups must contain at most 1000 filters.');
    }
    validateFilterValue(filters);
    itemRequests[group] = filters;
  }

  const query = {
    type: config.queryType,
    fromBlock: request.fromBlock,
    toBlock: request.toBlock,
    includeAllBlocks: request.includeAllBlocks ?? true,
    fields,
    ...itemRequests,
  };
  let encoded: string;
  try {
    encoded = JSON.stringify(query);
  } catch (error) {
    throw new RangeError('SQD request must be serializable JSON.', { cause: error });
  }
  if (Buffer.byteLength(encoded) > MAX_QUERY_BYTES) {
    throw new RangeError('SQD request exceeds the configured query size limit.');
  }
  return query;
}

function parseMetadata(body: string, expectedDataset: SqdDataset): SqdDatasetMetadata {
  let parsed: unknown;
  try {
    parsed = parseProviderJson(body);
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal metadata is invalid JSON.', {
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal metadata must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  if (record.dataset !== expectedDataset) {
    throw new ProviderError('CHAIN_MISMATCH', 'SQD Portal returned metadata for another dataset.');
  }
  if (
    !Array.isArray(record.aliases) ||
    !record.aliases.every((alias): alias is string => typeof alias === 'string') ||
    typeof record.real_time !== 'boolean'
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal metadata fields are invalid.');
  }
  const rawStart = record.start_block;
  if (
    rawStart !== undefined &&
    (typeof rawStart !== 'number' || !Number.isSafeInteger(rawStart) || rawStart < 0)
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD Portal start block is invalid.');
  }
  return {
    dataset: expectedDataset,
    aliases: [...record.aliases],
    realTime: record.real_time,
    startBlock: rawStart === undefined ? null : rawStart,
  };
}

async function readBoundedText(response: Response, maximum: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maximum) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD response exceeds the size limit.');
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > maximum) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD response exceeds the size limit.');
  }
  return body;
}

export class SqdPortalClient {
  readonly dataset: SqdDataset;
  readonly ledger: (typeof SQD_DATASETS)[SqdDataset]['ledger'];
  readonly chainId: string;
  readonly #options: ResolvedOptions;
  #nextRequestAt = 0;

  constructor(options: SqdPortalClientOptions) {
    this.#options = resolveOptions(options);
    this.dataset = options.dataset;
    const datasetConfig = SQD_DATASETS[this.dataset];
    this.ledger = datasetConfig.ledger;
    this.chainId = datasetConfig.chainId;
  }

  async metadata(): Promise<SqdDatasetMetadata> {
    let lastError: ProviderError | undefined;
    for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt += 1) {
      try {
        const response = await this.#fetch('metadata', { method: 'GET' });
        if (!response.ok) throw responseError(response, this.#options.nowImplementation());
        return parseMetadata(
          await readBoundedText(response, Math.min(this.#options.maxResponseBytes, 1_000_000)),
          this.dataset,
        );
      } catch (error) {
        const providerError = toProviderError(error);
        lastError = providerError;
        if (!providerError.retryable || attempt === this.#options.maxAttempts) break;
        await this.#retryDelay(attempt, providerError.retryAfterMs);
      }
    }
    throw lastError ?? new ProviderError('HTTP_ERROR', 'SQD metadata request failed.');
  }

  async readFinalizedRange(
    request: SqdFinalizedRangeRequest,
    onBlock: (block: SqdFinalizedBlock) => void | Promise<void>,
  ): Promise<SqdStreamSummary> {
    requireInteger(request.fromBlock, 'fromBlock', 0, Number.MAX_SAFE_INTEGER);
    requireInteger(request.toBlock, 'toBlock', 0, Number.MAX_SAFE_INTEGER);
    if (request.toBlock < request.fromBlock) {
      throw new RangeError('toBlock must be greater than or equal to fromBlock.');
    }
    const range = request.toBlock - request.fromBlock + 1;
    if (range > this.#options.maxRangeBlocks) {
      throw new RangeError(`SQD range may not exceed ${this.#options.maxRangeBlocks} blocks.`);
    }
    const baseQuery = buildQuery(this.dataset, request);
    const requireContiguous =
      SQD_DATASETS[this.dataset].contiguous && request.includeAllBlocks !== false;
    const progress: StreamProgress = {
      lastBlock: null,
      lastHash: null,
      blocks: 0,
      finalizedHead: null,
    };
    let cursor = request.fromBlock;
    let requests = 0;
    let retries = 0;

    while (cursor <= request.toBlock) {
      let completedResponse = false;
      for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt += 1) {
        if (requests >= this.#options.maxRequestsPerRange) {
          throw new ProviderError(
            'HTTP_ERROR',
            'SQD range exceeded the maximum number of requests.',
          );
        }
        requests += 1;
        const attemptStart = cursor;
        try {
          const outcome = await this.#readResponse(
            { ...baseQuery, fromBlock: cursor },
            cursor,
            request.toBlock,
            progress,
            requireContiguous,
            onBlock,
          );
          progress.finalizedHead = maxNullable(progress.finalizedHead, outcome.finalizedHead);
          if (outcome.noContent) {
            return {
              dataset: this.dataset,
              completion: 'SOURCE_HEAD_REACHED',
              requestedFrom: request.fromBlock,
              requestedTo: request.toBlock,
              lastBlock: progress.lastBlock,
              nextBlock: cursor,
              finalizedHead: progress.finalizedHead,
              blocks: progress.blocks,
              requests,
              retries,
            };
          }
          if (outcome.emptyRange) {
            if (requireContiguous || outcome.finalizedHead === null) {
              throw new ProviderError(
                'INVALID_RESPONSE',
                'SQD finalized stream returned unverifiable empty coverage.',
              );
            }
            if (outcome.finalizedHead < request.toBlock) {
              return {
                dataset: this.dataset,
                completion: 'SOURCE_HEAD_REACHED',
                requestedFrom: request.fromBlock,
                requestedTo: request.toBlock,
                lastBlock: progress.lastBlock,
                nextBlock: Math.max(cursor, outcome.finalizedHead + 1),
                finalizedHead: progress.finalizedHead,
                blocks: progress.blocks,
                requests,
                retries,
              };
            }
            cursor = request.toBlock + 1;
            completedResponse = true;
            break;
          }
          if (progress.lastBlock === null || progress.lastBlock < attemptStart) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              'SQD finalized stream made no verifiable progress.',
            );
          }
          cursor = progress.lastBlock + 1;
          completedResponse = true;
          break;
        } catch (error) {
          if (error instanceof SqdConsumerError) throw error.consumerCause;
          const providerError = toProviderError(error);
          if (
            providerError.retryable &&
            progress.lastBlock !== null &&
            progress.lastBlock >= attemptStart
          ) {
            cursor = progress.lastBlock + 1;
            retries += 1;
            completedResponse = true;
            break;
          }
          if (!providerError.retryable || attempt === this.#options.maxAttempts) {
            throw providerError;
          }
          retries += 1;
          await this.#retryDelay(attempt, providerError.retryAfterMs);
        }
      }
      if (!completedResponse) {
        throw new ProviderError('HTTP_ERROR', 'SQD finalized stream exhausted retry attempts.', {
          retryable: true,
        });
      }
    }

    return {
      dataset: this.dataset,
      completion: 'REQUESTED_RANGE_COMPLETE',
      requestedFrom: request.fromBlock,
      requestedTo: request.toBlock,
      lastBlock: progress.lastBlock,
      nextBlock: request.toBlock + 1,
      finalizedHead: progress.finalizedHead,
      blocks: progress.blocks,
      requests,
      retries,
    };
  }

  async #readResponse(
    query: Record<string, unknown>,
    fromBlock: number,
    toBlock: number,
    progress: StreamProgress,
    requireContiguous: boolean,
    onBlock: (block: SqdFinalizedBlock) => void | Promise<void>,
  ): Promise<{ noContent: boolean; emptyRange: boolean; finalizedHead: number | null }> {
    const response = await this.#fetch('finalized-stream', {
      method: 'POST',
      headers: {
        accept: 'application/jsonl, application/x-ndjson, application/json, text/plain',
        'content-type': 'application/json',
      },
      body: JSON.stringify(query),
    });
    if (response.status === 204) {
      return { noContent: true, emptyRange: false, finalizedHead: parseHead(response) };
    }
    if (!response.ok) throw responseError(response, this.#options.nowImplementation());
    const finalizedHead = parseHead(response);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (
      !contentType.includes('application/jsonl') &&
      !contentType.includes('application/x-ndjson') &&
      !contentType.includes('application/ndjson') &&
      !contentType.includes('application/json') &&
      !contentType.includes('text/plain')
    ) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD finalized stream content type is invalid.');
    }
    if (response.body === null) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD finalized stream body is missing.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffered = '';
    let bytes = 0;
    let responseBlocks = 0;
    let previous = progress.lastBlock;
    let previousHash = progress.lastHash;

    const consumeLine = async (rawLine: string): Promise<void> => {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.trim() === '') return;
      if (Buffer.byteLength(line) > this.#options.maxLineBytes) {
        throw new ProviderError('INVALID_RESPONSE', 'SQD JSONL line exceeds the size limit.');
      }
      const block = parseBlock(line, fromBlock, toBlock);
      if (previous !== null && block.header.number <= previous) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'SQD block numbers are not strictly increasing.',
        );
      }
      if (requireContiguous && block.header.number !== (previous ?? fromBlock - 1) + 1) {
        throw new ProviderError('INVALID_RESPONSE', 'SQD finalized stream contains a block gap.');
      }
      if (
        previous !== null &&
        previousHash !== null &&
        (requireContiguous || block.header.number === previous + 1) &&
        block.header.parentHash.toLowerCase() !== previousHash.toLowerCase()
      ) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'SQD finalized stream contains a parent-hash discontinuity.',
        );
      }
      try {
        await onBlock(block);
      } catch (error) {
        throw new SqdConsumerError(error);
      }
      previous = block.header.number;
      previousHash = block.header.hash;
      progress.lastBlock = block.header.number;
      progress.lastHash = block.header.hash;
      progress.blocks += 1;
      responseBlocks += 1;
      if (responseBlocks > this.#options.maxRangeBlocks) {
        throw new ProviderError('INVALID_RESPONSE', 'SQD response contains too many blocks.');
      }
    };

    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > this.#options.maxResponseBytes) {
          throw new ProviderError('INVALID_RESPONSE', 'SQD response exceeds the size limit.');
        }
        try {
          buffered += decoder.decode(chunk.value, { stream: true });
        } catch (error) {
          throw new ProviderError('INVALID_RESPONSE', 'SQD response is not valid UTF-8.', {
            cause: error,
          });
        }
        let newline = buffered.indexOf('\n');
        while (newline >= 0) {
          await consumeLine(buffered.slice(0, newline));
          buffered = buffered.slice(newline + 1);
          newline = buffered.indexOf('\n');
        }
        if (Buffer.byteLength(buffered) > this.#options.maxLineBytes) {
          throw new ProviderError('INVALID_RESPONSE', 'SQD JSONL line exceeds the size limit.');
        }
      }
      try {
        buffered += decoder.decode();
      } catch (error) {
        throw new ProviderError('INVALID_RESPONSE', 'SQD response is not valid UTF-8.', {
          cause: error,
        });
      }
      await consumeLine(buffered);
    } catch (error) {
      if (error instanceof SqdConsumerError || error instanceof ProviderError) throw error;
      throw toProviderError(error);
    } finally {
      reader.releaseLock();
    }
    if (responseBlocks === 0) {
      return { noContent: false, emptyRange: true, finalizedHead };
    }
    return { noContent: false, emptyRange: false, finalizedHead };
  }

  async #fetch(path: 'metadata' | 'finalized-stream', init: RequestInit): Promise<Response> {
    await this.#reserveRateLimitSlot();
    const portal = await assertProviderUrlSafe(this.#options.portalUrl, this.#options.policy);
    const url = new URL(`/datasets/${this.dataset}/${path}`, portal);
    try {
      const response = await this.#options.fetchImplementation(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#options.timeoutMs),
      });
      if (response.status >= 300 && response.status < 400) {
        throw responseError(response, this.#options.nowImplementation());
      }
      return response;
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async #reserveRateLimitSlot(): Promise<void> {
    if (this.#options.requestsPerSecond === 0) return;
    const interval = 1_000 / this.#options.requestsPerSecond;
    const now = this.#options.nowImplementation();
    const reservedAt = Math.max(now, this.#nextRequestAt);
    this.#nextRequestAt = reservedAt + interval;
    const delay = Math.ceil(reservedAt - now);
    if (delay > 0) await this.#options.sleepImplementation(delay);
  }

  async #retryDelay(attempt: number, retryAfter: number | undefined): Promise<void> {
    const delay =
      retryAfter === undefined
        ? Math.min(
            this.#options.retryMaxDelayMs,
            this.#options.retryBaseDelayMs * 2 ** (attempt - 1),
          )
        : Math.min(this.#options.retryMaxDelayMs, retryAfter);
    if (delay > 0) await this.#options.sleepImplementation(delay);
  }
}

export interface SqdEvmLogReaderOptions {
  source: SqdPortalClient;
  maxRangeBlocks?: number;
  maxResults?: number;
}

export interface SqdEvmContractCreationReaderOptions {
  source: SqdPortalClient;
  maxRangeBlocks?: number;
  maxResults?: number;
}

function sqdObject(
  value: JsonValue | undefined,
  field: string,
): Readonly<Record<string, JsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', `SQD EVM ${field} is invalid.`);
  }
  return value as Readonly<Record<string, JsonValue>>;
}

export class SqdEvmContractCreationReader implements EvmContractCreationReader {
  readonly endpointId: string;
  readonly #source: SqdPortalClient;
  readonly #maxRangeBlocks: number;
  readonly #maxResults: number;
  #metadataPromise: Promise<SqdDatasetMetadata> | undefined;

  constructor(options: SqdEvmContractCreationReaderOptions) {
    if (SQD_DATASETS[options.source.dataset].queryType !== 'evm') {
      throw new RangeError('SQD EVM contract creation reader requires an EVM dataset.');
    }
    this.#source = options.source;
    this.endpointId = `sqd:${options.source.dataset}`;
    this.#maxRangeBlocks = requireInteger(
      options.maxRangeBlocks ?? 1_000_000,
      'maxRangeBlocks',
      1,
      1_000_000,
    );
    this.#maxResults = requireInteger(options.maxResults ?? 16, 'maxResults', 1, 10_000);
  }

  async getContractCreationsObservation(
    query: EvmContractCreationQuery,
  ): Promise<EvmContractCreationObservation> {
    const fromBlock = sqdLogPosition(query.fromBlock, 'fromBlock');
    const toBlock = sqdLogPosition(query.toBlock, 'toBlock');
    if (toBlock < fromBlock) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD EVM creation range ends before it begins.');
    }
    if (toBlock - fromBlock + 1 > this.#maxRangeBlocks) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `SQD EVM creation range exceeds the configured ${this.#maxRangeBlocks}-block limit.`,
      );
    }
    const address = sqdLogAddress(query.address, 'creation address');
    const metadata = await this.#metadata();
    if (metadata.startBlock === null || fromBlock < metadata.startBlock) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'SQD dataset start coverage does not include the requested EVM creation range.',
      );
    }

    const creations: EvmContractCreationRecord[] = [];
    const seen = new Set<string>();
    const summary = await this.#source.readFinalizedRange(
      {
        fromBlock,
        toBlock,
        includeAllBlocks: false,
        fields: {
          transaction: { hash: true, transactionIndex: true },
          trace: {
            transactionIndex: true,
            traceAddress: true,
            type: true,
            createFrom: true,
            createResultAddress: true,
            createResultCode: true,
            error: true,
          },
        },
        requests: {
          traces: [{ type: ['create'], createResultAddress: [address], transaction: true }],
        },
      },
      (block) => {
        const blockHash = evmBlockHash(block, 'EVM contract creation');
        const transactionHashes = new Map<number, string>();
        for (const transaction of sqdTransactionsFromBlock(this.#source.dataset, block)) {
          const transactionIndex = sourcePosition(
            transaction.payload.transactionIndex,
            'EVM creation transaction index',
          );
          if (transactionHashes.has(transactionIndex)) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              'SQD EVM creation response contains duplicate transaction indexes.',
            );
          }
          transactionHashes.set(transactionIndex, transaction.identity);
        }

        for (const trace of sqdEvmTracesFromBlock(this.#source.dataset, block)) {
          const payload = trace.payload;
          if (
            payload.type !== 'create' ||
            (payload.error !== undefined && payload.error !== null)
          ) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              'SQD returned a trace outside the requested successful creation filter.',
            );
          }
          const transactionIndex = sourcePosition(
            payload.transactionIndex,
            'EVM creation trace transaction index',
          );
          const transactionHash = transactionHashes.get(transactionIndex);
          if (transactionHash === undefined) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              'SQD EVM creation trace is missing its parent transaction.',
            );
          }
          const action = sqdObject(payload.action, 'creation action');
          const result = sqdObject(payload.result, 'creation result');
          const creator = sqdLogAddress(String(action.from ?? ''), 'creation creator');
          const createdAddress = sqdLogAddress(
            String(result.address ?? ''),
            'created contract address',
          );
          const bytecode = result.code;
          if (
            createdAddress !== address ||
            typeof bytecode !== 'string' ||
            !EVM_HEX_DATA.test(bytecode) ||
            bytecode === '0x'
          ) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              'SQD returned an invalid or mismatched EVM contract creation.',
            );
          }
          const traceAddress = sourcePath(payload.traceAddress, 'EVM creation trace address', true);
          const identity = `${blockHash}:${transactionHash}:${traceAddress.join('.') || 'root'}`;
          if (seen.has(identity)) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              'SQD returned a duplicate EVM contract creation.',
            );
          }
          seen.add(identity);
          creations.push({
            address: createdAddress,
            creator,
            bytecode: bytecode.toLowerCase(),
            blockHash,
            blockNumber: `0x${block.header.number.toString(16)}`,
            transactionHash,
            transactionIndex: `0x${transactionIndex.toString(16)}`,
            traceAddress,
            raw: payload,
          });
          if (creations.length > this.#maxResults) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              `SQD EVM creation result exceeds the configured ${this.#maxResults}-record limit.`,
            );
          }
        }
      },
    );
    if (summary.completion !== 'REQUESTED_RANGE_COMPLETE' || summary.nextBlock !== toBlock + 1) {
      throw new ProviderError(
        'HTTP_ERROR',
        'SQD finalized coverage did not reach the requested EVM creation range end.',
        { retryable: true },
      );
    }
    return {
      endpointId: this.endpointId,
      value: creations,
      coverage: {
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        nextBlock: summary.nextBlock.toString(),
        finalizedHead: summary.finalizedHead?.toString() ?? null,
        responseBlockCount: summary.blocks,
        requestCount: summary.requests,
        completion: 'REQUESTED_RANGE_COMPLETE',
      },
    };
  }

  async #metadata(): Promise<SqdDatasetMetadata> {
    this.#metadataPromise ??= this.#source.metadata();
    try {
      return await this.#metadataPromise;
    } catch (error) {
      this.#metadataPromise = undefined;
      throw error;
    }
  }
}

function sqdLogPosition(value: string, field: string): number {
  if (!UNSIGNED_DECIMAL.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `SQD EVM log ${field} must be unsigned decimal.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProviderError('INVALID_RESPONSE', `SQD EVM log ${field} is unsafe.`);
  }
  return parsed;
}

function sqdLogAddress(value: string, field: string): string {
  if (!EVM_ADDRESS.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `SQD EVM log ${field} is invalid.`);
  }
  return value.toLowerCase();
}

function sqdLogHash(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !EVM_TRANSACTION_HASH.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `SQD EVM log ${field} is invalid.`);
  }
  return value.toLowerCase();
}

function sqdLogTopics(value: JsonValue | undefined): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 4 ||
    !value.every((topic) => typeof topic === 'string' && EVM_TRANSACTION_HASH.test(topic))
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'SQD EVM log topics are invalid.');
  }
  return (value as string[]).map((topic) => topic.toLowerCase());
}

function sqdLogIndex(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError('INVALID_RESPONSE', `SQD EVM log ${field} is invalid.`);
  }
  return `0x${value.toString(16)}`;
}

function sqdTopicFilter(value: EvmLogTopicFilter, index: number): readonly string[] | null {
  if (value === null) return null;
  const alternatives = typeof value === 'string' ? [value] : value;
  if (
    alternatives.length === 0 ||
    alternatives.some((topic) => !EVM_TRANSACTION_HASH.test(topic))
  ) {
    throw new ProviderError('INVALID_RESPONSE', `SQD EVM topic filter ${index} is invalid.`);
  }
  return [...new Set(alternatives.map((topic) => topic.toLowerCase()))];
}

function matchesSqdTopics(
  logTopics: readonly string[],
  filters: readonly (readonly string[] | null)[],
): boolean {
  return filters.every((filter, index) => {
    if (filter === null) return true;
    const topic = logTopics[index];
    return topic !== undefined && filter.includes(topic);
  });
}

export class SqdEvmLogReader implements EvmLogReader {
  readonly endpointId: string;
  readonly #source: SqdPortalClient;
  readonly #maxRangeBlocks: number;
  readonly #maxResults: number;
  #metadataPromise: Promise<SqdDatasetMetadata> | undefined;

  constructor(options: SqdEvmLogReaderOptions) {
    if (SQD_DATASETS[options.source.dataset].queryType !== 'evm') {
      throw new RangeError('SQD EVM log reader requires an EVM dataset.');
    }
    this.#source = options.source;
    this.endpointId = `sqd:${options.source.dataset}`;
    this.#maxRangeBlocks = requireInteger(
      options.maxRangeBlocks ?? 50_000,
      'maxRangeBlocks',
      1,
      1_000_000,
    );
    this.#maxResults = requireInteger(options.maxResults ?? 25_000, 'maxResults', 1, 1_000_000);
  }

  async getLogsObservation(query: EvmLogQuery): Promise<TransportObservation<EvmLogRecord[]>> {
    const fromBlock = sqdLogPosition(query.fromBlock, 'fromBlock');
    const toBlock = sqdLogPosition(query.toBlock, 'toBlock');
    if (toBlock < fromBlock) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD EVM log range ends before it begins.');
    }
    if (toBlock - fromBlock + 1 > this.#maxRangeBlocks) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `SQD EVM log range exceeds the configured ${this.#maxRangeBlocks}-block limit.`,
      );
    }
    const address = sqdLogAddress(query.address, 'address');
    const topics = (query.topics ?? []).map(sqdTopicFilter);
    if (topics.length > 4) {
      throw new ProviderError('INVALID_RESPONSE', 'SQD EVM log queries support four topics.');
    }
    const metadata = await this.#metadata();
    if (metadata.startBlock === null || fromBlock < metadata.startBlock) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'SQD dataset start coverage does not include the requested EVM log range.',
      );
    }
    const filter: Record<string, unknown> = { address: [address] };
    topics.forEach((topic, index) => {
      if (topic !== null) filter[`topic${index}`] = topic;
    });
    const logs: EvmLogRecord[] = [];
    const seen = new Set<string>();
    const summary = await this.#source.readFinalizedRange(
      {
        fromBlock,
        toBlock,
        fields: {
          block: { timestamp: true },
          log: {
            logIndex: true,
            transactionIndex: true,
            transactionHash: true,
            address: true,
            topics: true,
            data: true,
          },
        },
        requests: { logs: [filter] },
      },
      (block) => {
        const blockHash = sqdLogHash(block.header.hash, 'block hash');
        if (block.header.timestamp === null) {
          throw new ProviderError(
            'INVALID_RESPONSE',
            'SQD EVM log block timestamp is unavailable.',
          );
        }
        const blockTimestamp = new Date(block.header.timestamp * 1_000).toISOString();
        for (const item of sqdEvmLogsFromBlock(this.#source.dataset, block)) {
          const payload = item.payload;
          if (typeof payload.address !== 'string') {
            throw new ProviderError('INVALID_RESPONSE', 'SQD EVM log address is invalid.');
          }
          const logAddress = sqdLogAddress(payload.address, 'address');
          const logTopics = sqdLogTopics(payload.topics);
          const data = payload.data;
          if (typeof data !== 'string' || !EVM_HEX_DATA.test(data)) {
            throw new ProviderError('INVALID_RESPONSE', 'SQD EVM log data is invalid.');
          }
          if (logAddress !== address || !matchesSqdTopics(logTopics, topics)) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              'SQD returned an EVM log outside the requested address or topic filter.',
            );
          }
          const transactionHash = sqdLogHash(payload.transactionHash, 'transaction hash');
          const transactionIndex = sqdLogIndex(payload.transactionIndex, 'transaction index');
          const logIndex = sqdLogIndex(payload.logIndex, 'index');
          const identity = `${blockHash}:${transactionHash}:${logIndex}`;
          if (seen.has(identity)) {
            throw new ProviderError('INVALID_RESPONSE', 'SQD returned a duplicate EVM log.');
          }
          seen.add(identity);
          logs.push({
            address: logAddress,
            blockHash,
            blockNumber: `0x${block.header.number.toString(16)}`,
            blockTimestamp,
            transactionHash,
            transactionIndex,
            logIndex,
            data: data.toLowerCase(),
            topics: logTopics,
            removed: false,
            raw: payload,
          });
          if (logs.length > this.#maxResults) {
            throw new ProviderError(
              'INVALID_RESPONSE',
              `SQD EVM log result exceeds the configured ${this.#maxResults}-record limit.`,
            );
          }
        }
      },
    );
    if (
      summary.completion !== 'REQUESTED_RANGE_COMPLETE' ||
      summary.lastBlock !== toBlock ||
      summary.nextBlock !== toBlock + 1 ||
      summary.blocks !== toBlock - fromBlock + 1
    ) {
      throw new ProviderError(
        'HTTP_ERROR',
        'SQD finalized coverage did not reach the requested EVM log range end.',
        { retryable: true },
      );
    }
    return { endpointId: this.endpointId, value: logs };
  }

  async #metadata(): Promise<SqdDatasetMetadata> {
    this.#metadataPromise ??= this.#source.metadata();
    try {
      return await this.#metadataPromise;
    } catch (error) {
      this.#metadataPromise = undefined;
      throw error;
    }
  }
}
