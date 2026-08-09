import { ProviderError, toProviderError } from './errors.js';
import {
  assertProviderUrlSafe,
  validateProviderUrlSyntax,
  type ProviderUrlPolicy,
} from './security.js';
import { parseProviderJson, type FetchImplementation } from './transport.js';
import type { JsonValue } from '@zerotrace/schemas';

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

export interface SqdFinalizedRangeRequest {
  fromBlock: number;
  toBlock: number;
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
const BITCOIN_TRANSACTION_ID = /^[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const MAX_QUERY_BYTES = 262_144;
const MAX_TRANSACTIONS_PER_BLOCK = 100_000;

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
    includeAllBlocks: true,
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
    const progress: StreamProgress = { lastBlock: null, blocks: 0, finalizedHead: null };
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
            if (SQD_DATASETS[this.dataset].contiguous || outcome.finalizedHead === null) {
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
    onBlock: (block: SqdFinalizedBlock) => void | Promise<void>,
  ): Promise<{ noContent: boolean; emptyRange: boolean; finalizedHead: number | null }> {
    const response = await this.#fetch('finalized-stream', {
      method: 'POST',
      headers: {
        accept: 'application/jsonl, application/x-ndjson, application/json',
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
      !contentType.includes('application/json')
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
      if (
        SQD_DATASETS[this.dataset].contiguous &&
        block.header.number !== (previous ?? fromBlock - 1) + 1
      ) {
        throw new ProviderError('INVALID_RESPONSE', 'SQD finalized stream contains a block gap.');
      }
      try {
        await onBlock(block);
      } catch (error) {
        throw new SqdConsumerError(error);
      }
      previous = block.header.number;
      progress.lastBlock = block.header.number;
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
