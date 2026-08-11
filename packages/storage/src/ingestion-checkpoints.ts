import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import { LedgerSchema, type Ledger } from '@zerotrace/schemas';

export type IngestionRunStatus = 'RUNNING' | 'REQUESTED_RANGE_COMPLETE' | 'SOURCE_HEAD_REACHED';

export interface IngestionRun {
  id: string;
  source: string;
  dataset: string;
  ledger: Ledger;
  chainId: string;
  fromBlock: number;
  toBlock: number;
  queryHash: string;
  query: Readonly<Record<string, unknown>>;
  status: IngestionRunStatus;
  nextBlock: number;
  lastBlock: number | null;
  lastErrorCode: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BeginIngestionRunInput {
  source: string;
  dataset: string;
  ledger: Ledger;
  chainId: string;
  fromBlock: number;
  toBlock: number;
  query: Readonly<Record<string, unknown>>;
  startedAt?: string;
}

export interface IngestionCheckpointOptions {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

export interface CompletedIngestionCoverageLookup {
  source: string;
  dataset: string;
  ledger: Ledger;
  chainId: string;
  position: number;
  queryHash: string;
}

export type IngestionCheckpointErrorCode =
  | 'CHECKPOINT_UNAVAILABLE'
  | 'CHECKPOINT_NOT_INITIALIZED'
  | 'CHECKPOINT_INVALID'
  | 'CHECKPOINT_CONFLICT'
  | 'CHECKPOINT_NOT_FOUND';

export class IngestionCheckpointError extends Error {
  readonly code: IngestionCheckpointErrorCode;
  readonly retryable: boolean;

  constructor(
    code: IngestionCheckpointErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'IngestionCheckpointError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface CheckpointPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

interface InternalCheckpointOptions {
  pool: CheckpointPool;
}

const SELECT_RUN = `
  SELECT
    id::text,
    source,
    dataset,
    ledger::text,
    chain_id,
    from_block::text,
    to_block::text,
    query_hash,
    query,
    status,
    next_block::text,
    last_block::text,
    last_error_code,
    started_at,
    updated_at,
    completed_at
  FROM ingestion_runs
`;

function requireRangeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    throw new IngestionCheckpointError('CHECKPOINT_CONFLICT', `Stored ${field} is invalid.`);
  }
  return value;
}

function nullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new IngestionCheckpointError('CHECKPOINT_CONFLICT', `Stored ${field} is invalid.`);
  }
  return value;
}

function integerFromRow(row: Record<string, unknown>, field: string): number {
  const text = requiredString(row, field);
  if (!/^\d+$/.test(text)) {
    throw new IngestionCheckpointError('CHECKPOINT_CONFLICT', `Stored ${field} is invalid.`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new IngestionCheckpointError('CHECKPOINT_CONFLICT', `Stored ${field} is unsafe.`);
  }
  return value;
}

function nullableIntegerFromRow(row: Record<string, unknown>, field: string): number | null {
  if (row[field] === null || row[field] === undefined) return null;
  return integerFromRow(row, field);
}

function isoFromRow(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  const date = value instanceof Date ? value : new Date(requiredString(row, field));
  if (Number.isNaN(date.getTime())) {
    throw new IngestionCheckpointError('CHECKPOINT_CONFLICT', `Stored ${field} is invalid.`);
  }
  return date.toISOString();
}

function nullableIsoFromRow(row: Record<string, unknown>, field: string): string | null {
  if (row[field] === null || row[field] === undefined) return null;
  return isoFromRow(row, field);
}

function runFromRow(row: Record<string, unknown>): IngestionRun {
  const query = row.query;
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw new IngestionCheckpointError('CHECKPOINT_CONFLICT', 'Stored ingestion query is invalid.');
  }
  const status = requiredString(row, 'status');
  if (!['RUNNING', 'REQUESTED_RANGE_COMPLETE', 'SOURCE_HEAD_REACHED'].includes(status)) {
    throw new IngestionCheckpointError(
      'CHECKPOINT_CONFLICT',
      'Stored ingestion status is invalid.',
    );
  }
  return {
    id: requiredString(row, 'id'),
    source: requiredString(row, 'source'),
    dataset: requiredString(row, 'dataset'),
    ledger: LedgerSchema.parse(requiredString(row, 'ledger')),
    chainId: requiredString(row, 'chain_id'),
    fromBlock: integerFromRow(row, 'from_block'),
    toBlock: integerFromRow(row, 'to_block'),
    queryHash: requiredString(row, 'query_hash'),
    query: query as Record<string, unknown>,
    status: status as IngestionRunStatus,
    nextBlock: integerFromRow(row, 'next_block'),
    lastBlock: nullableIntegerFromRow(row, 'last_block'),
    lastErrorCode: nullableString(row, 'last_error_code'),
    startedAt: isoFromRow(row, 'started_at'),
    updatedAt: isoFromRow(row, 'updated_at'),
    completedAt: nullableIsoFromRow(row, 'completed_at'),
  };
}

function createPool(options: IngestionCheckpointOptions): CheckpointPool {
  let url: URL;
  try {
    url = new URL(options.connectionString);
  } catch (error) {
    throw new IngestionCheckpointError(
      'CHECKPOINT_NOT_INITIALIZED',
      'Checkpoint database URL is invalid.',
      { cause: error },
    );
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new IngestionCheckpointError(
      'CHECKPOINT_NOT_INITIALIZED',
      'Checkpoint database must use PostgreSQL.',
    );
  }
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-ingestion-checkpoints',
  });
  pool.on('error', () => undefined);
  return pool;
}

export class PostgresIngestionCheckpointRepository {
  readonly #pool: CheckpointPool;

  constructor(options: IngestionCheckpointOptions | InternalCheckpointOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: CheckpointPool): PostgresIngestionCheckpointRepository {
    return new PostgresIngestionCheckpointRepository({ pool });
  }

  async begin(input: BeginIngestionRunInput): Promise<IngestionRun> {
    const ledger = LedgerSchema.parse(input.ledger);
    requireRangeInteger(input.fromBlock, 'fromBlock');
    requireRangeInteger(input.toBlock, 'toBlock');
    if (input.toBlock < input.fromBlock) {
      throw new RangeError('toBlock must be greater than or equal to fromBlock.');
    }
    if (input.source.trim() === '' || input.dataset.trim() === '' || input.chainId.trim() === '') {
      throw new IngestionCheckpointError(
        'CHECKPOINT_INVALID',
        'Ingestion source, dataset, and chain must be non-empty.',
      );
    }
    const queryHash = hashPayload(input.query);
    const startedAt = new Date(input.startedAt ?? Date.now()).toISOString();
    try {
      await this.#pool.query(
        `INSERT INTO ingestion_runs (
          source, dataset, ledger, chain_id, from_block, to_block,
          query_hash, query, next_block, started_at
        ) VALUES ($1, $2, $3::ledger_kind, $4, $5::numeric, $6::numeric, $7, $8::jsonb, $5::numeric, $9)
        ON CONFLICT (source, dataset, from_block, to_block, query_hash) DO NOTHING`,
        [
          input.source,
          input.dataset,
          ledger,
          input.chainId,
          input.fromBlock,
          input.toBlock,
          queryHash,
          canonicalJson(input.query),
          startedAt,
        ],
      );
      const run = await this.#findIdentity(
        input.source,
        input.dataset,
        input.fromBlock,
        input.toBlock,
        queryHash,
      );
      if (run === undefined) {
        throw new IngestionCheckpointError(
          'CHECKPOINT_NOT_FOUND',
          'Ingestion run was not stored.',
          {
            retryable: true,
          },
        );
      }
      if (
        run.ledger !== ledger ||
        run.chainId !== input.chainId ||
        canonicalJson(run.query) !== canonicalJson(input.query)
      ) {
        throw new IngestionCheckpointError(
          'CHECKPOINT_CONFLICT',
          'Stored ingestion run conflicts with the requested identity.',
        );
      }
      return run;
    } catch (error) {
      if (error instanceof IngestionCheckpointError) throw error;
      throw new IngestionCheckpointError('CHECKPOINT_UNAVAILABLE', 'Ingestion run start failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async advance(id: string, block: number): Promise<IngestionRun> {
    requireRangeInteger(block, 'block');
    return this.#update(
      `UPDATE ingestion_runs
       SET next_block = GREATEST(next_block, $2::numeric + 1),
           last_block = GREATEST(COALESCE(last_block, $2::numeric), $2::numeric),
           last_error_code = NULL
       WHERE id = $1::uuid AND status = 'RUNNING'
       RETURNING id`,
      [id, block],
    );
  }

  async finish(
    id: string,
    status: Exclude<IngestionRunStatus, 'RUNNING'>,
    nextBlock: number,
  ): Promise<IngestionRun> {
    requireRangeInteger(nextBlock, 'nextBlock');
    return this.#update(
      `UPDATE ingestion_runs
       SET status = $2,
           next_block = $3::numeric,
           completed_at = now(),
           last_error_code = NULL
       WHERE id = $1::uuid AND status = 'RUNNING'
       RETURNING id`,
      [id, status, nextBlock],
    );
  }

  async recordFailure(id: string, errorCode: string): Promise<IngestionRun> {
    if (errorCode.trim() === '') {
      throw new IngestionCheckpointError('CHECKPOINT_INVALID', 'Failure code must be non-empty.');
    }
    return this.#update(
      `UPDATE ingestion_runs
       SET last_error_code = $2
       WHERE id = $1::uuid AND status = 'RUNNING'
       RETURNING id`,
      [id, errorCode.slice(0, 160)],
    );
  }

  async get(id: string): Promise<IngestionRun | undefined> {
    try {
      const result = await this.#pool.query(`${SELECT_RUN} WHERE id = $1::uuid`, [id]);
      return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof IngestionCheckpointError) throw error;
      throw new IngestionCheckpointError('CHECKPOINT_UNAVAILABLE', 'Ingestion run read failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async findCompletedCoverage(
    input: CompletedIngestionCoverageLookup,
  ): Promise<IngestionRun | undefined> {
    const source = input.source.trim();
    const dataset = input.dataset.trim();
    const ledger = LedgerSchema.parse(input.ledger);
    const chainId = input.chainId.trim();
    const position = requireRangeInteger(input.position, 'position');
    if (
      source === '' ||
      dataset === '' ||
      chainId === '' ||
      !/^[0-9a-f]{64}$/.test(input.queryHash)
    ) {
      throw new IngestionCheckpointError(
        'CHECKPOINT_INVALID',
        'Completed coverage lookup identity is invalid.',
      );
    }
    try {
      const result = await this.#pool.query(
        `${SELECT_RUN}
         WHERE source = $1
           AND dataset = $2
           AND ledger = $3::ledger_kind
           AND chain_id = $4
           AND from_block <= $5::numeric
           AND to_block >= $5::numeric
           AND next_block > $5::numeric
           AND query_hash = $6
           AND status IN ('REQUESTED_RANGE_COMPLETE', 'SOURCE_HEAD_REACHED')
         ORDER BY completed_at DESC, started_at DESC, id DESC
         LIMIT 1`,
        [source, dataset, ledger, chainId, position, input.queryHash],
      );
      return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof IngestionCheckpointError) throw error;
      throw new IngestionCheckpointError(
        'CHECKPOINT_UNAVAILABLE',
        'Completed ingestion coverage read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: IngestionCheckpointErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.ingestion_runs')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['004_ingestion_checkpoints'],
      );
      if (
        result.rows[0]?.table_name !== 'ingestion_runs' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'CHECKPOINT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'CHECKPOINT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }

  async #findIdentity(
    source: string,
    dataset: string,
    fromBlock: number,
    toBlock: number,
    queryHash: string,
  ): Promise<IngestionRun | undefined> {
    const result = await this.#pool.query(
      `${SELECT_RUN}
       WHERE source = $1 AND dataset = $2
         AND from_block = $3::numeric AND to_block = $4::numeric AND query_hash = $5`,
      [source, dataset, fromBlock, toBlock, queryHash],
    );
    return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
  }

  async #update(text: string, values: readonly unknown[]): Promise<IngestionRun> {
    try {
      const updated = await this.#pool.query(text, values);
      const id = updated.rows[0]?.id;
      if (typeof id !== 'string') {
        const existing = typeof values[0] === 'string' ? await this.get(values[0]) : undefined;
        if (existing !== undefined && existing.status !== 'RUNNING') return existing;
        throw new IngestionCheckpointError(
          'CHECKPOINT_NOT_FOUND',
          'Running ingestion checkpoint was not found.',
        );
      }
      const run = await this.get(id);
      if (run === undefined) {
        throw new IngestionCheckpointError(
          'CHECKPOINT_NOT_FOUND',
          'Ingestion checkpoint vanished.',
        );
      }
      return run;
    } catch (error) {
      if (error instanceof IngestionCheckpointError) throw error;
      throw new IngestionCheckpointError('CHECKPOINT_UNAVAILABLE', 'Checkpoint update failed.', {
        retryable: true,
        cause: error,
      });
    }
  }
}
