import { createClient, type ClickHouseClient } from '@clickhouse/client';

import { canonicalActionTransactionId } from '@zerotrace/action-semantics';
import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import { LedgerSchema, RawChainFactSchema, type RawChainFact } from '@zerotrace/schemas';

export type RawFactStorageErrorCode =
  | 'CLICKHOUSE_UNAVAILABLE'
  | 'CLICKHOUSE_NOT_INITIALIZED'
  | 'RAW_FACT_INVALID'
  | 'RAW_FACT_CONFLICT'
  | 'RAW_FACT_NOT_FOUND';

export class RawFactStorageError extends Error {
  readonly code: RawFactStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: RawFactStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'RawFactStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface CreateRawChainFactInput {
  ledger: RawChainFact['ledger'];
  chainId: string;
  blockOrSlot: string;
  blockHash: string;
  factType: string;
  subject: string;
  provider: string;
  finality: string;
  payload: RawChainFact['payload'];
  evidenceId: string;
  rawArtifactRef: string;
  observedAt: string;
}

export interface RawFactStorageHealth {
  status: 'UP' | 'DOWN';
  backend: 'CLICKHOUSE';
  durable: true;
  checkedAt: string;
  table: 'zerotrace.raw_chain_facts';
  logicalDeduplication: 'REPLACING_MERGE_TREE';
  errorCode?: RawFactStorageErrorCode;
}

export interface ClickHouseRawFactRepositoryOptions {
  url: string;
  username?: string;
  password?: string;
  requestTimeoutMs?: number;
  maxConnections?: number;
}

export interface RawTransactionFactLookup {
  ledger: RawChainFact['ledger'];
  chainId: string;
  blockOrSlot: string;
  transactionId: string;
  provider: string;
  limit?: number;
}

type ClickHouseClientLike = Pick<ClickHouseClient, 'insert' | 'query' | 'close'>;

interface InternalClickHouseOptions {
  client: ClickHouseClientLike;
}

interface RawFactRow {
  fact_id: string;
  schema_version: string;
  ledger: string;
  chain_id: string;
  block_or_slot: string | number;
  block_hash: string;
  fact_type: string;
  subject: string;
  provider: string;
  finality: string;
  payload: string;
  payload_hash: string;
  evidence_id: string;
  raw_artifact_ref: string;
  observed_at_ms: string | number;
}

interface RawFactKeyRow {
  fact_id: string;
  fact_type: string;
  subject: string;
}

const RAW_FACT_INSERT_BATCH_SIZE = 1_000;
const RAW_FACT_RANGE_KEY_PAGE_SIZE = 1_000;

const RAW_FACT_COLUMNS = [
  'fact_id',
  'schema_version',
  'ledger',
  'chain_id',
  'block_or_slot',
  'block_hash',
  'fact_type',
  'subject',
  'provider',
  'finality',
  'payload',
  'payload_hash',
  'evidence_id',
  'raw_artifact_ref',
  'observed_at',
] as const;

const SELECT_FACT = `
  SELECT
    fact_id,
    schema_version,
    ledger,
    chain_id,
    block_or_slot,
    block_hash,
    fact_type,
    subject,
    provider,
    finality,
    payload,
    payload_hash,
    evidence_id,
    raw_artifact_ref,
    toUnixTimestamp64Milli(observed_at) AS observed_at_ms
  FROM zerotrace.raw_chain_facts
`;

function requireInteger(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function canonicalFactContent(
  fact: Omit<RawChainFact, 'id'> | RawChainFact,
): Omit<RawChainFact, 'id'> {
  const content = { ...fact } as Partial<RawChainFact>;
  delete content.id;
  return content as Omit<RawChainFact, 'id'>;
}

export function rawFactIdFor(fact: Omit<RawChainFact, 'id'> | RawChainFact): string {
  return hashPayload({
    schema: 'zerotrace-raw-fact-identity-v1',
    fact: canonicalFactContent(fact),
  });
}

export function createRawChainFact(input: CreateRawChainFactInput): RawChainFact {
  const content = {
    schemaVersion: 'zerotrace-raw-fact-v1' as const,
    ...input,
    observedAt: new Date(input.observedAt).toISOString(),
    payloadHash: hashPayload(input.payload),
  };
  return RawChainFactSchema.parse({ id: rawFactIdFor(content), ...content });
}

function validateFact(fact: RawChainFact): RawChainFact {
  const parsed = RawChainFactSchema.parse(fact);
  if (parsed.payloadHash !== hashPayload(parsed.payload) || parsed.id !== rawFactIdFor(parsed)) {
    throw new RawFactStorageError(
      'RAW_FACT_INVALID',
      'Raw Fact identity does not match its canonical content.',
    );
  }
  return parsed;
}

function parseUnsigned(value: string | number, field: string): string {
  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new RawFactStorageError('RAW_FACT_CONFLICT', `Stored ${field} is invalid.`);
  }
  return text;
}

function uint64(value: string, field: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 18_446_744_073_709_551_615n) {
    throw new RawFactStorageError('RAW_FACT_INVALID', `${field} must be a UInt64 decimal string.`);
  }
  return value;
}

function nonEmpty(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new RawFactStorageError(
      'RAW_FACT_INVALID',
      `${field} must contain between 1 and ${maximum} characters.`,
    );
  }
  return normalized;
}

function transactionIndex(fact: RawChainFact): number {
  const payload = fact.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new RawFactStorageError('RAW_FACT_CONFLICT', 'Transaction payload must be an object.');
  }
  const value = payload.transactionIndex;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RawFactStorageError(
      'RAW_FACT_CONFLICT',
      'Transaction payload is missing its canonical transaction index.',
    );
  }
  return value;
}

function relatedTransactionIndex(fact: RawChainFact): number {
  const payload = fact.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new RawFactStorageError('RAW_FACT_CONFLICT', 'Related fact payload must be an object.');
  }
  const value = payload.transactionIndex;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RawFactStorageError(
      'RAW_FACT_CONFLICT',
      'Related fact payload is missing its canonical transaction index.',
    );
  }
  return value;
}

function rowToFact(row: RawFactRow): RawChainFact {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload) as unknown;
  } catch (error) {
    throw new RawFactStorageError('RAW_FACT_CONFLICT', 'Stored Raw Fact payload is invalid JSON.', {
      cause: error,
    });
  }
  const milliseconds = Number(row.observed_at_ms);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new RawFactStorageError('RAW_FACT_CONFLICT', 'Stored Raw Fact timestamp is invalid.');
  }
  try {
    return validateFact(
      RawChainFactSchema.parse({
        id: row.fact_id,
        schemaVersion: row.schema_version,
        ledger: row.ledger,
        chainId: row.chain_id,
        blockOrSlot: parseUnsigned(row.block_or_slot, 'block or slot'),
        blockHash: row.block_hash,
        factType: row.fact_type,
        subject: row.subject,
        provider: row.provider,
        finality: row.finality,
        payload,
        payloadHash: row.payload_hash,
        evidenceId: row.evidence_id,
        rawArtifactRef: row.raw_artifact_ref,
        observedAt: new Date(milliseconds).toISOString(),
      }),
    );
  } catch (error) {
    if (error instanceof RawFactStorageError) throw error;
    throw new RawFactStorageError('RAW_FACT_CONFLICT', 'Stored Raw Fact schema is invalid.', {
      cause: error,
    });
  }
}

function toInsertRow(fact: RawChainFact): Record<string, string> {
  return {
    fact_id: fact.id,
    schema_version: fact.schemaVersion,
    ledger: fact.ledger,
    chain_id: fact.chainId,
    block_or_slot: fact.blockOrSlot,
    block_hash: fact.blockHash,
    fact_type: fact.factType,
    subject: fact.subject,
    provider: fact.provider,
    finality: fact.finality,
    payload: canonicalJson(fact.payload),
    payload_hash: fact.payloadHash,
    evidence_id: fact.evidenceId,
    raw_artifact_ref: fact.rawArtifactRef,
    observed_at: fact.observedAt,
  };
}

function createClickHouseClient(options: ClickHouseRawFactRepositoryOptions): ClickHouseClientLike {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch (error) {
    throw new RawFactStorageError('CLICKHOUSE_NOT_INITIALIZED', 'ClickHouse URL is invalid.', {
      cause: error,
    });
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new RawFactStorageError(
      'CLICKHOUSE_NOT_INITIALIZED',
      'ClickHouse URL must be an HTTP(S) origin without embedded credentials.',
    );
  }
  const requestTimeoutMs = requireInteger(
    options.requestTimeoutMs ?? 30_000,
    'requestTimeoutMs',
    1,
    300_000,
  );
  const maxConnections = requireInteger(options.maxConnections ?? 4, 'maxConnections', 1, 100);
  return createClient({
    url: url.origin,
    database: 'zerotrace',
    username: options.username ?? 'default',
    password: options.password ?? '',
    application: 'zerotrace-storage/0.1.0',
    request_timeout: requestTimeoutMs,
    max_open_connections: maxConnections,
    compression: { request: true, response: true },
    clickhouse_settings: {
      date_time_input_format: 'best_effort',
      // FINAL can otherwise fan out to every host CPU and exceed the memory budget of the
      // default local/CI container even for a small content-addressed fact range.
      max_threads: 2,
      max_final_threads: 2,
    },
  });
}

export class ClickHouseRawFactRepository {
  readonly #client: ClickHouseClientLike;

  constructor(options: ClickHouseRawFactRepositoryOptions | InternalClickHouseOptions) {
    this.#client = 'client' in options ? options.client : createClickHouseClient(options);
  }

  static fromClient(client: ClickHouseClientLike): ClickHouseRawFactRepository {
    return new ClickHouseRawFactRepository({ client });
  }

  async put(fact: RawChainFact): Promise<RawChainFact> {
    const stored = await this.putMany([fact]);
    const first = stored[0];
    if (first === undefined) {
      throw new RawFactStorageError(
        'CLICKHOUSE_UNAVAILABLE',
        'Raw Fact batch write returned no fact.',
        { retryable: true },
      );
    }
    return first;
  }

  async putMany(facts: readonly RawChainFact[]): Promise<RawChainFact[]> {
    const parsed = facts.map(validateFact);
    if (parsed.length === 0) return [];
    try {
      // The insert acknowledgement is the durable write boundary. A per-fact FINAL
      // read-after-write check is intentionally avoided here: large finalized ranges
      // must be written in bounded batches, and FINAL verification belongs to the
      // subsequent bounded replay/read path rather than every individual insert.
      for (let offset = 0; offset < parsed.length; offset += RAW_FACT_INSERT_BATCH_SIZE) {
        const batch = parsed.slice(offset, offset + RAW_FACT_INSERT_BATCH_SIZE);
        const result = await this.#client.insert({
          table: 'zerotrace.raw_chain_facts',
          values: batch.map(toInsertRow),
          format: 'JSONEachRow',
          columns: [...RAW_FACT_COLUMNS] as [string, ...string[]],
          clickhouse_settings: { date_time_input_format: 'best_effort' },
        });
        if (!result.executed) {
          throw new RawFactStorageError(
            'CLICKHOUSE_UNAVAILABLE',
            'Raw Fact insert was not executed.',
            { retryable: true },
          );
        }
      }
      return parsed;
    } catch (error) {
      if (error instanceof RawFactStorageError) throw error;
      throw new RawFactStorageError('CLICKHOUSE_UNAVAILABLE', 'Raw Fact batch write failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async get(id: string): Promise<RawChainFact | undefined> {
    if (!/^[0-9a-f]{64}$/.test(id)) {
      throw new RawFactStorageError('RAW_FACT_INVALID', 'Raw Fact ID is invalid.');
    }
    try {
      const result = await this.#client.query({
        query: `${SELECT_FACT}
          WHERE fact_id = {factId:String}
          LIMIT 1 BY fact_id
          LIMIT 2`,
        format: 'JSONEachRow',
        query_params: { factId: id },
      });
      const rows = await result.json<RawFactRow>();
      if (rows.length > 1) {
        throw new RawFactStorageError('RAW_FACT_CONFLICT', 'Raw Fact identity is not unique.');
      }
      return rows[0] === undefined ? undefined : rowToFact(rows[0]);
    } catch (error) {
      if (error instanceof RawFactStorageError) throw error;
      throw new RawFactStorageError('CLICKHOUSE_UNAVAILABLE', 'Raw Fact read failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async listRange(options: {
    ledger: RawChainFact['ledger'];
    chainId: string;
    fromBlock: number;
    toBlock: number;
    limit?: number;
    offset?: number;
  }): Promise<RawChainFact[]> {
    const ledger = LedgerSchema.parse(options.ledger);
    requireInteger(options.fromBlock, 'fromBlock', 0, Number.MAX_SAFE_INTEGER);
    requireInteger(options.toBlock, 'toBlock', 0, Number.MAX_SAFE_INTEGER);
    if (options.toBlock < options.fromBlock) {
      throw new RangeError('toBlock must be greater than or equal to fromBlock.');
    }
    const limit = requireInteger(options.limit ?? 1_000, 'limit', 1, 10_000);
    const offset = requireInteger(options.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
    try {
      // Keep both the deterministic key sort and the HTTP form field bounded. Sorting the full
      // Raw Fact row carries payload strings through ClickHouse's LIMIT BY pipeline, while a
      // 10,000-item factIds array can exceed the server's form-field limit. The public limit and
      // offset remain unchanged; only the internal key/payload batches are capped.
      const facts: RawChainFact[] = [];
      let pageOffset = offset;
      while (facts.length < limit) {
        const pageLimit = Math.min(RAW_FACT_RANGE_KEY_PAGE_SIZE, limit - facts.length);
        const keyResult = await this.#client.query({
          query: `
            SELECT fact_id
            FROM zerotrace.raw_chain_facts
            WHERE ledger = {ledger:String}
              AND chain_id = {chainId:String}
              AND block_or_slot BETWEEN {fromBlock:UInt64} AND {toBlock:UInt64}
            ORDER BY block_or_slot, fact_type, subject, fact_id
            LIMIT 1 BY fact_id
            LIMIT {limit:UInt32} OFFSET {offset:UInt64}`,
          format: 'JSONEachRow',
          query_params: {
            ledger,
            chainId: options.chainId,
            fromBlock: String(options.fromBlock),
            toBlock: String(options.toBlock),
            limit: pageLimit,
            offset: String(pageOffset),
          },
          clickhouse_settings: {
            max_bytes_before_external_sort: '64000000',
            max_bytes_before_external_group_by: '64000000',
          },
        });
        const keys = (await keyResult.json<{ fact_id: string }>()).map((row) => row.fact_id);
        if (keys.length === 0) break;
        const result = await this.#client.query({
          query: `${SELECT_FACT}
            WHERE ledger = {ledger:String}
              AND chain_id = {chainId:String}
              AND block_or_slot BETWEEN {fromBlock:UInt64} AND {toBlock:UInt64}
              AND fact_id IN {factIds:Array(String)}
            LIMIT 1 BY fact_id`,
          format: 'JSONEachRow',
          query_params: {
            ledger,
            chainId: options.chainId,
            fromBlock: String(options.fromBlock),
            toBlock: String(options.toBlock),
            factIds: keys,
          },
        });
        const rows = await result.json<RawFactRow>();
        const rowsById = new Map(rows.map((row) => [row.fact_id, row]));
        if (rowsById.size !== keys.length) {
          throw new RawFactStorageError(
            'RAW_FACT_CONFLICT',
            'Raw Fact range page changed between key and payload reads.',
          );
        }
        facts.push(...keys.map((key) => rowToFact(rowsById.get(key) as RawFactRow)));
        if (keys.length < pageLimit) break;
        pageOffset += keys.length;
      }
      return facts;
    } catch (error) {
      if (error instanceof RawFactStorageError) throw error;
      throw new RawFactStorageError('CLICKHOUSE_UNAVAILABLE', 'Raw Fact range read failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async listTransactionFacts(options: RawTransactionFactLookup): Promise<RawChainFact[]> {
    const ledger = LedgerSchema.parse(options.ledger);
    const chainId = nonEmpty(options.chainId, 'chainId', 128);
    const blockOrSlot = uint64(options.blockOrSlot, 'blockOrSlot');
    const transactionId = canonicalActionTransactionId(ledger, options.transactionId);
    const provider = nonEmpty(options.provider, 'provider', 512);
    const limit = requireInteger(options.limit ?? 10_000, 'limit', 1, 10_000);
    try {
      const transactionResult = await this.#client.query({
        query: `${SELECT_FACT}
          WHERE ledger = {ledger:String}
            AND chain_id = {chainId:String}
            AND block_or_slot = {blockOrSlot:UInt64}
            AND fact_type = 'TRANSACTION'
            AND subject = {transactionId:String}
            AND provider = {provider:String}
          ORDER BY observed_at DESC, fact_id DESC
          LIMIT 1 BY fact_id
          LIMIT 1`,
        format: 'JSONEachRow',
        query_params: { ledger, chainId, blockOrSlot, transactionId, provider },
      });
      const transactionRows = await transactionResult.json<RawFactRow>();
      const transactionRow = transactionRows[0];
      if (transactionRow === undefined) {
        throw new RawFactStorageError(
          'RAW_FACT_NOT_FOUND',
          'Finalized transaction fact is unavailable.',
          { retryable: true },
        );
      }
      const transaction = rowToFact(transactionRow);
      const index = transactionIndex(transaction);
      const relatedPredicate =
        ledger === 'EVM'
          ? `(
              (fact_type = 'LOG' AND JSONExtractString(payload, 'transactionHash') = {transactionId:String})
              OR (fact_type IN ('TRACE', 'STATE_DIFF')
                AND JSONExtractUInt(payload, 'transactionIndex') = {transactionIndex:UInt64})
            )`
          : ledger === 'BITCOIN'
            ? `(fact_type IN ('UTXO_INPUT', 'UTXO_OUTPUT')
                AND JSONExtractUInt(payload, 'transactionIndex') = {transactionIndex:UInt64})`
            : `(fact_type IN ('INSTRUCTION', 'LOG', 'BALANCE', 'TOKEN_BALANCE')
                AND JSONExtractUInt(payload, 'transactionIndex') = {transactionIndex:UInt64})`;
      // Keep the safety-limit and deterministic ordering query payload-free. On a reused
      // ClickHouse volume, selecting large JSON payloads through LIMIT BY can retain every
      // candidate row until the sort completes and exceed the container memory budget. Fetch
      // the bounded key set first, then hydrate exactly those IDs.
      const relatedKeyResult = await this.#client.query({
        query: `
          SELECT fact_id, fact_type, subject
          FROM zerotrace.raw_chain_facts
          WHERE ledger = {ledger:String}
            AND chain_id = {chainId:String}
            AND block_or_slot = {blockOrSlot:UInt64}
            AND provider = {provider:String}
            AND raw_artifact_ref = {rawArtifactRef:String}
            AND ${relatedPredicate}
          ORDER BY fact_type, subject, fact_id
          LIMIT 1 BY fact_id
          LIMIT {rowLimit:UInt32}`,
        format: 'JSONEachRow',
        query_params: {
          ledger,
          chainId,
          blockOrSlot,
          transactionId,
          transactionIndex: String(index),
          provider,
          rawArtifactRef: transaction.rawArtifactRef,
          rowLimit: limit + 1,
        },
        clickhouse_settings: {
          max_bytes_before_external_sort: '64000000',
          max_bytes_before_external_group_by: '64000000',
        },
      });
      const relatedKeys = await relatedKeyResult.json<RawFactKeyRow>();
      if (relatedKeys.length > limit) {
        throw new RawFactStorageError(
          'RAW_FACT_CONFLICT',
          'Transaction fact bundle exceeds the configured safety limit.',
        );
      }
      const relatedResult = await this.#client.query({
        query: `${SELECT_FACT}
          WHERE ledger = {ledger:String}
            AND chain_id = {chainId:String}
            AND block_or_slot = {blockOrSlot:UInt64}
            AND provider = {provider:String}
            AND raw_artifact_ref = {rawArtifactRef:String}
            AND fact_id IN {factIds:Array(String)}
          LIMIT 1 BY fact_id`,
        format: 'JSONEachRow',
        query_params: {
          ledger,
          chainId,
          blockOrSlot,
          provider,
          rawArtifactRef: transaction.rawArtifactRef,
          factIds: relatedKeys.map((row) => row.fact_id),
        },
      });
      const relatedRows = await relatedResult.json<RawFactRow>();
      const relatedRowsById = new Map(relatedRows.map((row) => [row.fact_id, row]));
      if (relatedRowsById.size !== relatedKeys.length) {
        throw new RawFactStorageError(
          'RAW_FACT_CONFLICT',
          'Transaction fact bundle changed between key and payload reads.',
        );
      }
      const related = relatedKeys.map((row) => rowToFact(relatedRowsById.get(row.fact_id)!));
      for (const fact of related) {
        if (fact.factType === 'LOG' && ledger === 'EVM') {
          const payload = fact.payload;
          const hash =
            typeof payload === 'object' && payload !== null && !Array.isArray(payload)
              ? payload.transactionHash
              : undefined;
          if (
            typeof hash !== 'string' ||
            canonicalActionTransactionId('EVM', hash) !== transactionId
          ) {
            throw new RawFactStorageError(
              'RAW_FACT_CONFLICT',
              'Stored EVM log belongs to another transaction.',
            );
          }
        } else if (relatedTransactionIndex(fact) !== index) {
          throw new RawFactStorageError(
            'RAW_FACT_CONFLICT',
            'Stored related fact belongs to another transaction.',
          );
        }
      }
      return [transaction, ...related];
    } catch (error) {
      if (error instanceof RawFactStorageError) throw error;
      throw new RawFactStorageError('CLICKHOUSE_UNAVAILABLE', 'Raw transaction fact read failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async health(): Promise<RawFactStorageHealth> {
    const checkedAt = new Date().toISOString();
    const down = (errorCode: RawFactStorageErrorCode): RawFactStorageHealth => ({
      status: 'DOWN',
      backend: 'CLICKHOUSE',
      durable: true,
      checkedAt,
      table: 'zerotrace.raw_chain_facts',
      logicalDeduplication: 'REPLACING_MERGE_TREE',
      errorCode,
    });
    try {
      const tableResult = await this.#client.query({
        query: `SELECT engine FROM system.tables
          WHERE database = {database:String} AND name = {table:String}`,
        format: 'JSONEachRow',
        query_params: { database: 'zerotrace', table: 'raw_chain_facts' },
      });
      const tables = await tableResult.json<{ engine: string }>();
      if (tables.length !== 1 || tables[0]?.engine !== 'ReplacingMergeTree') {
        return down('CLICKHOUSE_NOT_INITIALIZED');
      }
      const columnsResult = await this.#client.query({
        query: `SELECT name FROM system.columns
          WHERE database = {database:String} AND table = {table:String}`,
        format: 'JSONEachRow',
        query_params: { database: 'zerotrace', table: 'raw_chain_facts' },
      });
      const columns = new Set(
        (await columnsResult.json<{ name: string }>()).map((row) => row.name),
      );
      if (!RAW_FACT_COLUMNS.every((column) => columns.has(column))) {
        return down('CLICKHOUSE_NOT_INITIALIZED');
      }
      const migrationResult = await this.#client.query({
        query: `SELECT version FROM zerotrace.schema_migrations FINAL
          WHERE version = {version:String} LIMIT 1`,
        format: 'JSONEachRow',
        query_params: { version: '001_raw_facts' },
      });
      if ((await migrationResult.json<{ version: string }>()).length !== 1) {
        return down('CLICKHOUSE_NOT_INITIALIZED');
      }
      return {
        status: 'UP',
        backend: 'CLICKHOUSE',
        durable: true,
        checkedAt,
        table: 'zerotrace.raw_chain_facts',
        logicalDeduplication: 'REPLACING_MERGE_TREE',
      };
    } catch {
      return down('CLICKHOUSE_UNAVAILABLE');
    }
  }

  close(): Promise<void> {
    return this.#client.close();
  }
}
