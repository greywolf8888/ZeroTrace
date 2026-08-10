import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import { JsonValueSchema, LedgerSchema, type JsonValue, type Ledger } from '@zerotrace/schemas';

export type SemanticScanStatus = 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';

export interface SemanticScanRun {
  id: string;
  scanType: string;
  source: string;
  ledger: Ledger;
  chainId: string;
  subject: string;
  fromBlock: number;
  toBlock: number;
  chunkSize: number;
  identityHash: string;
  identity: Readonly<Record<string, JsonValue>>;
  status: SemanticScanStatus;
  nextBlock: number;
  stateHash: string;
  state: JsonValue;
  evidenceIds: readonly string[];
  lastErrorCode: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BeginSemanticScanInput {
  scanType: string;
  source: string;
  ledger: Ledger;
  chainId: string;
  subject: string;
  fromBlock: number;
  toBlock: number;
  chunkSize: number;
  identity: Readonly<Record<string, JsonValue>>;
  initialState: JsonValue;
  startedAt?: string;
}

export interface AdvanceSemanticScanInput {
  expectedNextBlock: number;
  completedToBlock: number;
  state: JsonValue;
  evidenceIds: readonly string[];
}

export interface FinishSemanticScanInput {
  state: JsonValue;
  evidenceIds: readonly string[];
}

export interface SemanticCheckpointOptions {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

export type SemanticCheckpointErrorCode =
  | 'SEMANTIC_CHECKPOINT_UNAVAILABLE'
  | 'SEMANTIC_CHECKPOINT_NOT_INITIALIZED'
  | 'SEMANTIC_CHECKPOINT_INVALID'
  | 'SEMANTIC_CHECKPOINT_CONFLICT'
  | 'SEMANTIC_CHECKPOINT_NOT_FOUND';

export class SemanticCheckpointError extends Error {
  readonly code: SemanticCheckpointErrorCode;
  readonly retryable: boolean;

  constructor(
    code: SemanticCheckpointErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SemanticCheckpointError';
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
    scan_type,
    source,
    ledger::text,
    chain_id,
    subject,
    from_block::text,
    to_block::text,
    chunk_size,
    identity_hash,
    identity,
    status,
    next_block::text,
    state_hash,
    state,
    evidence_ids,
    last_error_code,
    started_at,
    updated_at,
    completed_at
  FROM semantic_scan_runs
`;

function rangeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveInteger(value: number, field: string): number {
  rangeInteger(value, field);
  if (value === 0) throw new RangeError(`${field} must be positive.`);
  return value;
}

function nonEmpty(value: string, field: string): string {
  if (value.trim() === '') {
    throw new SemanticCheckpointError('SEMANTIC_CHECKPOINT_INVALID', `${field} must be non-empty.`);
  }
  return value;
}

function inputJson(value: unknown, field: string): JsonValue {
  const parsed = JsonValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_INVALID',
      `${field} must be a JSON value.`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function inputRecord(value: unknown, field: string): Readonly<Record<string, JsonValue>> {
  const parsed = inputJson(value, field);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_INVALID',
      `${field} must be a JSON object.`,
    );
  }
  return parsed;
}

function record(value: unknown, field: string): Readonly<Record<string, JsonValue>> {
  const parsed = JsonValueSchema.safeParse(value);
  if (
    !parsed.success ||
    typeof parsed.data !== 'object' ||
    parsed.data === null ||
    Array.isArray(parsed.data)
  ) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      `Stored ${field} is invalid.`,
      { cause: parsed.success ? undefined : parsed.error },
    );
  }
  return parsed.data;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      `Stored ${field} is invalid.`,
    );
  }
  return value;
}

function nullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      `Stored ${field} is invalid.`,
    );
  }
  return value;
}

function integer(row: Record<string, unknown>, field: string): number {
  const raw = row[field];
  const value = typeof raw === 'number' ? raw : Number(requiredString(row, field));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      `Stored ${field} is invalid.`,
    );
  }
  return value;
}

function iso(row: Record<string, unknown>, field: string): string {
  const raw = row[field];
  const date = raw instanceof Date ? raw : new Date(requiredString(row, field));
  if (Number.isNaN(date.getTime())) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      `Stored ${field} is invalid.`,
    );
  }
  return date.toISOString();
}

function nullableIso(row: Record<string, unknown>, field: string): string | null {
  return row[field] === null || row[field] === undefined ? null : iso(row, field);
}

function evidenceIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string' && /^ev_[0-9a-f]{24}$/.test(item))
  ) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      'Stored semantic scan Evidence IDs are invalid.',
    );
  }
  const sorted = [...new Set(value)].sort();
  if (sorted.length !== value.length || sorted.some((item, index) => item !== value[index])) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      'Stored semantic scan Evidence IDs are not canonical.',
    );
  }
  return sorted;
}

function stateValue(value: unknown): JsonValue {
  const parsed = JsonValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      'Stored semantic scan state is invalid.',
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function runFromRow(row: Record<string, unknown>): SemanticScanRun {
  const identity = record(row.identity, 'identity');
  const state = stateValue(row.state);
  const identityHash = requiredString(row, 'identity_hash');
  const stateHash = requiredString(row, 'state_hash');
  if (hashPayload(identity) !== identityHash || hashPayload(state) !== stateHash) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      'Stored semantic scan hashes do not match their payloads.',
    );
  }
  const status = requiredString(row, 'status');
  if (status !== 'RUNNING' && status !== 'REQUESTED_RANGE_COMPLETE') {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_CONFLICT',
      'Stored semantic scan status is invalid.',
    );
  }
  return {
    id: requiredString(row, 'id'),
    scanType: requiredString(row, 'scan_type'),
    source: requiredString(row, 'source'),
    ledger: LedgerSchema.parse(requiredString(row, 'ledger')),
    chainId: requiredString(row, 'chain_id'),
    subject: requiredString(row, 'subject'),
    fromBlock: integer(row, 'from_block'),
    toBlock: integer(row, 'to_block'),
    chunkSize: positiveInteger(integer(row, 'chunk_size'), 'stored chunk_size'),
    identityHash,
    identity,
    status,
    nextBlock: integer(row, 'next_block'),
    stateHash,
    state,
    evidenceIds: evidenceIds(row.evidence_ids),
    lastErrorCode: nullableString(row, 'last_error_code'),
    startedAt: iso(row, 'started_at'),
    updatedAt: iso(row, 'updated_at'),
    completedAt: nullableIso(row, 'completed_at'),
  };
}

function createPool(options: SemanticCheckpointOptions): CheckpointPool {
  let url: URL;
  try {
    url = new URL(options.connectionString);
  } catch (error) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_NOT_INITIALIZED',
      'Semantic checkpoint database URL is invalid.',
      { cause: error },
    );
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_NOT_INITIALIZED',
      'Semantic checkpoints require PostgreSQL.',
    );
  }
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-semantic-checkpoints',
  });
  pool.on('error', () => undefined);
  return pool;
}

function canonicalEvidenceIds(ids: readonly string[]): string[] {
  if (!ids.every((id) => /^ev_[0-9a-f]{24}$/.test(id))) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_INVALID',
      'Semantic checkpoint Evidence IDs must be canonical Evidence identifiers.',
    );
  }
  return [...new Set(ids)].sort();
}

function scanId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new SemanticCheckpointError(
      'SEMANTIC_CHECKPOINT_INVALID',
      'Semantic scan ID must be a UUID.',
    );
  }
  return id;
}

export class PostgresSemanticScanCheckpointRepository {
  readonly #pool: CheckpointPool;

  constructor(options: SemanticCheckpointOptions | InternalCheckpointOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: CheckpointPool): PostgresSemanticScanCheckpointRepository {
    return new PostgresSemanticScanCheckpointRepository({ pool });
  }

  async begin(input: BeginSemanticScanInput): Promise<SemanticScanRun> {
    const ledger = LedgerSchema.parse(input.ledger);
    rangeInteger(input.fromBlock, 'fromBlock');
    rangeInteger(input.toBlock, 'toBlock');
    positiveInteger(input.chunkSize, 'chunkSize');
    if (input.toBlock < input.fromBlock) {
      throw new RangeError('toBlock must be greater than or equal to fromBlock.');
    }
    nonEmpty(input.scanType, 'scanType');
    nonEmpty(input.source, 'source');
    nonEmpty(input.chainId, 'chainId');
    nonEmpty(input.subject, 'subject');
    const identity = inputRecord(input.identity, 'identity');
    const initialState = inputJson(input.initialState, 'initialState');
    const identityHash = hashPayload(identity);
    const stateHash = hashPayload(initialState);
    const startedDate = new Date(input.startedAt ?? Date.now());
    if (Number.isNaN(startedDate.getTime())) {
      throw new SemanticCheckpointError(
        'SEMANTIC_CHECKPOINT_INVALID',
        'startedAt must be a valid timestamp.',
      );
    }
    const startedAt = startedDate.toISOString();
    try {
      await this.#pool.query(
        `INSERT INTO semantic_scan_runs (
          scan_type, source, ledger, chain_id, subject, from_block, to_block, chunk_size,
          identity_hash, identity, next_block, state_hash, state, started_at
        ) VALUES (
          $1, $2, $3::ledger_kind, $4, $5, $6::numeric, $7::numeric, $8,
          $9, $10::jsonb, $6::numeric, $11, $12::jsonb, $13
        ) ON CONFLICT (
          scan_type, source, ledger, chain_id, subject, from_block, to_block,
          chunk_size, identity_hash
        ) DO NOTHING`,
        [
          input.scanType,
          input.source,
          ledger,
          input.chainId,
          input.subject,
          input.fromBlock,
          input.toBlock,
          input.chunkSize,
          identityHash,
          canonicalJson(identity),
          stateHash,
          canonicalJson(initialState),
          startedAt,
        ],
      );
      const run = await this.#findIdentity(input, identityHash);
      if (run === undefined) {
        throw new SemanticCheckpointError(
          'SEMANTIC_CHECKPOINT_NOT_FOUND',
          'Semantic scan was not stored.',
          { retryable: true },
        );
      }
      if (
        run.ledger !== ledger ||
        run.chainId !== input.chainId ||
        run.chunkSize !== input.chunkSize ||
        canonicalJson(run.identity) !== canonicalJson(identity)
      ) {
        throw new SemanticCheckpointError(
          'SEMANTIC_CHECKPOINT_CONFLICT',
          'Stored semantic scan conflicts with the requested identity.',
        );
      }
      return run;
    } catch (error) {
      if (error instanceof SemanticCheckpointError || error instanceof RangeError) throw error;
      throw new SemanticCheckpointError(
        'SEMANTIC_CHECKPOINT_UNAVAILABLE',
        'Semantic scan start failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async advance(id: string, input: AdvanceSemanticScanInput): Promise<SemanticScanRun> {
    scanId(id);
    rangeInteger(input.expectedNextBlock, 'expectedNextBlock');
    rangeInteger(input.completedToBlock, 'completedToBlock');
    if (input.completedToBlock < input.expectedNextBlock) {
      throw new RangeError('completedToBlock must not precede expectedNextBlock.');
    }
    if (input.completedToBlock === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('completedToBlock leaves no safe integer for the next cursor.');
    }
    const nextBlock = input.completedToBlock + 1;
    const state = inputJson(input.state, 'state');
    const stateHash = hashPayload(state);
    const ids = canonicalEvidenceIds(input.evidenceIds);
    try {
      const result = await this.#pool.query(
        `UPDATE semantic_scan_runs
         SET next_block = $4::numeric,
             state_hash = $5,
             state = $6::jsonb,
             evidence_ids = $7::text[],
             last_error_code = NULL
         WHERE id = $1::uuid AND status = 'RUNNING'
           AND next_block = $2::numeric
           AND $3::numeric >= next_block
           AND $3::numeric <= to_block
           AND $3::numeric < next_block + chunk_size
         RETURNING id::text`,
        [
          id,
          input.expectedNextBlock,
          input.completedToBlock,
          nextBlock,
          stateHash,
          canonicalJson(state),
          ids,
        ],
      );
      const updatedId = result.rows[0]?.id;
      if (typeof updatedId === 'string') return await this.#required(updatedId);
      const existing = await this.get(id);
      if (
        existing !== undefined &&
        existing.nextBlock === nextBlock &&
        existing.stateHash === stateHash &&
        canonicalJson(existing.evidenceIds) === canonicalJson(ids)
      ) {
        return existing;
      }
      throw new SemanticCheckpointError(
        existing === undefined ? 'SEMANTIC_CHECKPOINT_NOT_FOUND' : 'SEMANTIC_CHECKPOINT_CONFLICT',
        'Semantic scan cursor did not match the requested contiguous advance.',
      );
    } catch (error) {
      if (error instanceof SemanticCheckpointError || error instanceof RangeError) throw error;
      throw new SemanticCheckpointError(
        'SEMANTIC_CHECKPOINT_UNAVAILABLE',
        'Semantic scan advance failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async finish(id: string, input?: FinishSemanticScanInput): Promise<SemanticScanRun> {
    scanId(id);
    const finalState = input === undefined ? undefined : inputJson(input.state, 'state');
    const finalStateHash = finalState === undefined ? undefined : hashPayload(finalState);
    const finalEvidenceIds =
      input === undefined ? undefined : canonicalEvidenceIds(input.evidenceIds);
    try {
      const result = await this.#pool.query(
        `UPDATE semantic_scan_runs
         SET status = 'REQUESTED_RANGE_COMPLETE',
             completed_at = now(),
             last_error_code = NULL,
             state_hash = COALESCE($2, state_hash),
             state = COALESCE($3::jsonb, state),
             evidence_ids = COALESCE($4::text[], evidence_ids)
         WHERE id = $1::uuid AND status = 'RUNNING' AND next_block = to_block + 1
         RETURNING id::text`,
        [
          id,
          finalStateHash ?? null,
          finalState === undefined ? null : canonicalJson(finalState),
          finalEvidenceIds ?? null,
        ],
      );
      const updatedId = result.rows[0]?.id;
      if (typeof updatedId === 'string') return await this.#required(updatedId);
      const existing = await this.get(id);
      if (existing?.status === 'REQUESTED_RANGE_COMPLETE') {
        if (
          finalStateHash !== undefined &&
          (existing.stateHash !== finalStateHash ||
            canonicalJson(existing.evidenceIds) !== canonicalJson(finalEvidenceIds))
        ) {
          throw new SemanticCheckpointError(
            'SEMANTIC_CHECKPOINT_CONFLICT',
            'Completed semantic scan conflicts with the requested terminal state.',
          );
        }
        return existing;
      }
      throw new SemanticCheckpointError(
        existing === undefined ? 'SEMANTIC_CHECKPOINT_NOT_FOUND' : 'SEMANTIC_CHECKPOINT_CONFLICT',
        'Semantic scan cannot complete before its requested range is contiguous.',
      );
    } catch (error) {
      if (error instanceof SemanticCheckpointError) throw error;
      throw new SemanticCheckpointError(
        'SEMANTIC_CHECKPOINT_UNAVAILABLE',
        'Semantic scan completion failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async recordFailure(id: string, errorCode: string): Promise<SemanticScanRun> {
    scanId(id);
    nonEmpty(errorCode, 'errorCode');
    try {
      const result = await this.#pool.query(
        `UPDATE semantic_scan_runs
         SET last_error_code = $2
         WHERE id = $1::uuid AND status = 'RUNNING'
         RETURNING id::text`,
        [id, errorCode.slice(0, 160)],
      );
      const updatedId = result.rows[0]?.id;
      if (typeof updatedId !== 'string') {
        throw new SemanticCheckpointError(
          'SEMANTIC_CHECKPOINT_NOT_FOUND',
          'Running semantic scan was not found.',
        );
      }
      return await this.#required(updatedId);
    } catch (error) {
      if (error instanceof SemanticCheckpointError) throw error;
      throw new SemanticCheckpointError(
        'SEMANTIC_CHECKPOINT_UNAVAILABLE',
        'Semantic scan failure recording failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<SemanticScanRun | undefined> {
    scanId(id);
    try {
      const result = await this.#pool.query(`${SELECT_RUN} WHERE id = $1::uuid`, [id]);
      return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof SemanticCheckpointError) throw error;
      throw new SemanticCheckpointError(
        'SEMANTIC_CHECKPOINT_UNAVAILABLE',
        'Semantic scan read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: SemanticCheckpointErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.semantic_scan_runs')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['007_semantic_scan_checkpoints'],
      );
      if (
        result.rows[0]?.table_name !== 'semantic_scan_runs' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'SEMANTIC_CHECKPOINT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'SEMANTIC_CHECKPOINT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }

  async #findIdentity(
    input: BeginSemanticScanInput,
    identityHash: string,
  ): Promise<SemanticScanRun | undefined> {
    const result = await this.#pool.query(
      `${SELECT_RUN}
       WHERE scan_type = $1 AND source = $2 AND ledger = $3::ledger_kind
         AND chain_id = $4 AND subject = $5
         AND from_block = $6::numeric AND to_block = $7::numeric
         AND chunk_size = $8 AND identity_hash = $9`,
      [
        input.scanType,
        input.source,
        input.ledger,
        input.chainId,
        input.subject,
        input.fromBlock,
        input.toBlock,
        input.chunkSize,
        identityHash,
      ],
    );
    return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
  }

  async #required(id: string): Promise<SemanticScanRun> {
    const run = await this.get(id);
    if (run === undefined) {
      throw new SemanticCheckpointError(
        'SEMANTIC_CHECKPOINT_NOT_FOUND',
        'Semantic scan checkpoint vanished.',
      );
    }
    return run;
  }
}
