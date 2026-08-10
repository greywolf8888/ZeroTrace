import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import { FlapEventHistorySchema, type FlapEventHistory } from '@zerotrace/schemas';

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface ProjectionPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

export interface FlapHistoryProjectionOptions {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

interface InternalProjectionOptions {
  pool: ProjectionPool;
}

export type FlapHistoryProjectionErrorCode =
  | 'FLAP_HISTORY_PROJECTION_UNAVAILABLE'
  | 'FLAP_HISTORY_PROJECTION_NOT_INITIALIZED'
  | 'FLAP_HISTORY_PROJECTION_INVALID'
  | 'FLAP_HISTORY_PROJECTION_CONFLICT';

export class FlapHistoryProjectionError extends Error {
  readonly code: FlapHistoryProjectionErrorCode;
  readonly retryable: boolean;

  constructor(
    code: FlapHistoryProjectionErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'FlapHistoryProjectionError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface FlapHistorySegment {
  id: string;
  scanId: string;
  chainId: string;
  token: string;
  fromBlock: number;
  toBlock: number;
  resultHash: string;
  result: FlapEventHistory;
  snapshotHash: string;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: string;
  transactionCount: number;
  unrecognizedPortalLogCount: number;
  createdAt: string;
}

export interface PutFlapHistorySegmentInput {
  scanId: string;
  result: FlapEventHistory;
}

const SELECT_SEGMENT = `
  SELECT
    id,
    scan_id::text,
    chain_id,
    token,
    from_block::text,
    to_block::text,
    result_hash,
    result,
    snapshot_hash,
    terminal_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    transaction_count,
    unrecognized_portal_log_count,
    created_at
  FROM flap_history_segments
`;

function createPool(options: FlapHistoryProjectionOptions): ProjectionPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-flap-history-projection',
  });
  pool.on('error', () => undefined);
  return pool;
}

function scanId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_INVALID',
      'Flap history projection scan ID must be a UUID.',
    );
  }
  return value.toLowerCase();
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_CONFLICT',
      `Stored Flap history ${field} is invalid.`,
    );
  }
  return value;
}

function safeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_CONFLICT',
      `Stored Flap history ${field} is invalid.`,
    );
  }
  return parsed;
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_CONFLICT',
      'Stored Flap history createdAt is invalid.',
    );
  }
  return parsed.toISOString();
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_CONFLICT',
      `Stored Flap history ${field} is invalid.`,
    );
  }
  const canonical = [...new Set(value as string[])].sort();
  if (canonical.length !== value.length || canonical.some((item, index) => item !== value[index])) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_CONFLICT',
      `Stored Flap history ${field} is not canonical.`,
    );
  }
  return canonical;
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_CONFLICT',
      'Stored Flap history result is not JSON.',
      { cause: error },
    );
  }
}

interface MaterializedSegment {
  id: string;
  scanId: string;
  chainId: string;
  token: string;
  fromBlock: number;
  toBlock: number;
  resultHash: string;
  result: FlapEventHistory;
  snapshotHash: string;
  terminalEvidenceId: string;
  evidenceIds: string[];
  sourceSet: string[];
  modelVersion: string;
  transactionCount: number;
  unrecognizedPortalLogCount: number;
}

function materialize(input: PutFlapHistorySegmentInput): MaterializedSegment {
  const id = scanId(input.scanId);
  const parsed = FlapEventHistorySchema.safeParse(input.result);
  if (!parsed.success) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_INVALID',
      'Flap history segment result is invalid.',
      { cause: parsed.error },
    );
  }
  const result = parsed.data;
  const snapshot = result.metadata.snapshot;
  if (
    snapshot?.ledger !== 'EVM' ||
    snapshot.chainId === '' ||
    result.requestedRangeCoverage !== 1 ||
    result.requestedRange.chunkCount < 1 ||
    result.metadata.dataCoverage !== 1 ||
    result.metadata.historyCoverage !== 0 ||
    result.lifetimeCoverage.state === 'known'
  ) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_INVALID',
      'Flap history segment requires complete EVM bounded-range coverage.',
    );
  }
  const fromBlock = safeInteger(result.requestedRange.fromBlock, 'fromBlock');
  const toBlock = safeInteger(result.requestedRange.toBlock, 'toBlock');
  if (
    toBlock < fromBlock ||
    toBlock - fromBlock + 1 > 50_000 ||
    snapshot.blockNumber !== String(toBlock) ||
    result.transactions.length !== result.chronology.length
  ) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_INVALID',
      'Flap history segment Snapshot does not bind its inclusive upper block.',
    );
  }
  const modelVersion = result.metadata.modelVersion;
  const terminalLocator = `flap-event-history:${result.token}:${fromBlock}-${toBlock}`;
  const terminal = result.evidence.filter(
    (item) => item.source === `zerotrace:${modelVersion}` && item.locator === terminalLocator,
  );
  if (
    terminal.length !== 1 ||
    terminal[0] === undefined ||
    !['DERIVED_FEATURE', 'NEGATIVE_EVIDENCE'].includes(terminal[0].kind)
  ) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_INVALID',
      'Flap history segment requires one terminal Evidence root.',
    );
  }
  const evidenceIds = [...new Set(result.metadata.evidenceIds)].sort();
  const sourceSet = [...new Set(result.metadata.sourceSet)].sort();
  if (
    evidenceIds.length !== result.metadata.evidenceIds.length ||
    evidenceIds.some((item, index) => item !== result.metadata.evidenceIds[index]) ||
    sourceSet.length !== result.metadata.sourceSet.length ||
    sourceSet.some((item, index) => item !== result.metadata.sourceSet[index]) ||
    sourceSet.length === 0 ||
    !evidenceIds.includes(terminal[0].id) ||
    !result.evidence.every((item) => evidenceIds.includes(item.id))
  ) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_INVALID',
      'Flap history segment provenance must be canonical and include its terminal Evidence.',
    );
  }
  const resultHash = hashPayload(result);
  const snapshotHash = hashPayload(snapshot);
  return {
    id: `fhs_${hashPayload({
      schema: 'zerotrace-flap-history-segment-v1',
      scanId: id,
      resultHash,
    }).slice(0, 24)}`,
    scanId: id,
    chainId: snapshot.chainId,
    token: result.token,
    fromBlock,
    toBlock,
    resultHash,
    result,
    snapshotHash,
    terminalEvidenceId: terminal[0].id,
    evidenceIds,
    sourceSet,
    modelVersion,
    transactionCount: result.transactions.length,
    unrecognizedPortalLogCount: result.unrecognizedPortalLogCount,
  };
}

function assertSame(stored: FlapHistorySegment, expected: MaterializedSegment): void {
  if (
    stored.id !== expected.id ||
    stored.scanId !== expected.scanId ||
    stored.chainId !== expected.chainId ||
    stored.token !== expected.token ||
    stored.fromBlock !== expected.fromBlock ||
    stored.toBlock !== expected.toBlock ||
    stored.resultHash !== expected.resultHash ||
    stored.snapshotHash !== expected.snapshotHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.transactionCount !== expected.transactionCount ||
    stored.unrecognizedPortalLogCount !== expected.unrecognizedPortalLogCount ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.result) !== canonicalJson(expected.result)
  ) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_CONFLICT',
      'Stored Flap history segment conflicts with the canonical result.',
    );
  }
}

function rowToSegment(row: Record<string, unknown>): FlapHistorySegment {
  const result = FlapEventHistorySchema.safeParse(json(row.result));
  if (!result.success) {
    throw new FlapHistoryProjectionError(
      'FLAP_HISTORY_PROJECTION_CONFLICT',
      'Stored Flap history result is invalid.',
      { cause: result.error },
    );
  }
  const segment: FlapHistorySegment = {
    id: requiredString(row, 'id'),
    scanId: scanId(requiredString(row, 'scan_id')),
    chainId: requiredString(row, 'chain_id'),
    token: requiredString(row, 'token'),
    fromBlock: safeInteger(row.from_block, 'fromBlock'),
    toBlock: safeInteger(row.to_block, 'toBlock'),
    resultHash: requiredString(row, 'result_hash'),
    result: result.data,
    snapshotHash: requiredString(row, 'snapshot_hash'),
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    evidenceIds: stringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: stringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version'),
    transactionCount: safeInteger(row.transaction_count, 'transactionCount'),
    unrecognizedPortalLogCount: safeInteger(
      row.unrecognized_portal_log_count,
      'unrecognizedPortalLogCount',
    ),
    createdAt: timestamp(row.created_at),
  };
  assertSame(segment, materialize({ scanId: segment.scanId, result: segment.result }));
  return segment;
}

export class PostgresFlapHistoryProjectionRepository {
  readonly #pool: ProjectionPool;

  constructor(options: FlapHistoryProjectionOptions | InternalProjectionOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ProjectionPool): PostgresFlapHistoryProjectionRepository {
    return new PostgresFlapHistoryProjectionRepository({ pool });
  }

  async putSegment(input: PutFlapHistorySegmentInput): Promise<FlapHistorySegment> {
    const expected = materialize(input);
    try {
      const existing = await this.#findRange(expected.scanId, expected.fromBlock, expected.toBlock);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO flap_history_segments (
          id, scan_id, chain_id, token, from_block, to_block, result_hash, result,
          snapshot_hash, terminal_evidence_id, evidence_ids, source_set, model_version,
          transaction_count, unrecognized_portal_log_count
        ) VALUES (
          $1, $2::uuid, $3, $4, $5::numeric, $6::numeric, $7, $8::jsonb,
          $9, $10, $11::text[], $12::text[], $13, $14, $15
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.scanId,
          expected.chainId,
          expected.token,
          expected.fromBlock,
          expected.toBlock,
          expected.resultHash,
          canonicalJson(expected.result),
          expected.snapshotHash,
          expected.terminalEvidenceId,
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.transactionCount,
          expected.unrecognizedPortalLogCount,
        ],
      );
      const stored = await this.#findRange(expected.scanId, expected.fromBlock, expected.toBlock);
      if (stored === undefined) {
        throw new FlapHistoryProjectionError(
          'FLAP_HISTORY_PROJECTION_CONFLICT',
          'Flap history segment was not stored.',
        );
      }
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof FlapHistoryProjectionError) throw error;
      throw new FlapHistoryProjectionError(
        'FLAP_HISTORY_PROJECTION_UNAVAILABLE',
        'Flap history segment write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async listSegments(
    id: string,
    options: { afterBlock?: number; limit?: number } = {},
  ): Promise<FlapHistorySegment[]> {
    const canonicalId = scanId(id);
    const afterBlock = options.afterBlock;
    if (afterBlock !== undefined && (!Number.isSafeInteger(afterBlock) || afterBlock < 0)) {
      throw new FlapHistoryProjectionError(
        'FLAP_HISTORY_PROJECTION_INVALID',
        'Flap history page cursor must be a non-negative safe integer.',
      );
    }
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new FlapHistoryProjectionError(
        'FLAP_HISTORY_PROJECTION_INVALID',
        'Flap history page limit must be between 1 and 1000.',
      );
    }
    try {
      const result = await this.#pool.query(
        `${SELECT_SEGMENT}
         WHERE scan_id = $1::uuid
           AND ($2::numeric IS NULL OR from_block > $2::numeric)
         ORDER BY from_block, to_block
         LIMIT $3`,
        [canonicalId, afterBlock ?? null, limit],
      );
      return result.rows.map(rowToSegment);
    } catch (error) {
      if (error instanceof FlapHistoryProjectionError) throw error;
      throw new FlapHistoryProjectionError(
        'FLAP_HISTORY_PROJECTION_UNAVAILABLE',
        'Flap history segment read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: FlapHistoryProjectionErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.flap_history_segments')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['008_flap_history_projection'],
      );
      if (
        result.rows[0]?.table_name !== 'flap_history_segments' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'FLAP_HISTORY_PROJECTION_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'FLAP_HISTORY_PROJECTION_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }

  async #findRange(
    id: string,
    fromBlock: number,
    toBlock: number,
  ): Promise<FlapHistorySegment | undefined> {
    const result = await this.#pool.query(
      `${SELECT_SEGMENT}
       WHERE scan_id = $1::uuid AND from_block = $2::numeric AND to_block = $3::numeric`,
      [id, fromBlock, toBlock],
    );
    return result.rows[0] === undefined ? undefined : rowToSegment(result.rows[0]);
  }
}
