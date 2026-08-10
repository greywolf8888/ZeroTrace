import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import { FlapLifetimeStateSchema, type FlapLifetimeState } from '@zerotrace/schemas';

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface LifetimeHeadPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

export interface FlapLifetimeHeadRepositoryOptions {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

interface InternalOptions {
  pool: LifetimeHeadPool;
}

export type FlapLifetimeHeadErrorCode =
  | 'FLAP_LIFETIME_HEAD_UNAVAILABLE'
  | 'FLAP_LIFETIME_HEAD_NOT_INITIALIZED'
  | 'FLAP_LIFETIME_HEAD_INVALID'
  | 'FLAP_LIFETIME_HEAD_CONFLICT';

export class FlapLifetimeHeadError extends Error {
  readonly code: FlapLifetimeHeadErrorCode;
  readonly retryable: boolean;

  constructor(
    code: FlapLifetimeHeadErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'FlapLifetimeHeadError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface FlapLifetimeHead {
  id: string;
  chainId: 'eip155:56';
  token: string;
  sequence: number;
  scanId: string;
  headType: 'INITIAL' | 'EXTENSION';
  predecessorId: string | null;
  targetBlock: number;
  targetHash: string;
  resultHash: string;
  result: FlapLifetimeState;
  snapshotHash: string;
  terminalEvidenceId: string;
  createdAt: string;
}

export interface PutFlapLifetimeHeadInput {
  scanId: string;
  result: FlapLifetimeState;
}

type MaterializedHead = Omit<FlapLifetimeHead, 'createdAt'>;

const SELECT_HEAD = `
  SELECT
    id,
    chain_id,
    token,
    sequence::text,
    scan_id::text,
    head_type,
    predecessor_id,
    target_block::text,
    target_hash,
    result_hash,
    result,
    snapshot_hash,
    terminal_evidence_id,
    created_at
  FROM flap_lifetime_heads
`;

function createPool(options: FlapLifetimeHeadRepositoryOptions): LifetimeHeadPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-flap-lifetime-heads',
  });
  pool.on('error', () => undefined);
  return pool;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      `Stored Flap lifetime ${field} is invalid.`,
    );
  }
  return value;
}

function optionalString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null) return null;
  return requiredString(row, field);
}

function safeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      `Stored Flap lifetime ${field} is invalid.`,
    );
  }
  return parsed;
}

function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_INVALID',
      'Flap lifetime head scan ID must be a UUID.',
    );
  }
  return value.toLowerCase();
}

function tokenAddress(value: string): string {
  if (!/^0x[0-9a-f]{40}$/.test(value)) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_INVALID',
      'Flap lifetime head token must be a canonical lowercase EVM address.',
    );
  }
  return value;
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Stored Flap lifetime createdAt is invalid.',
    );
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Stored Flap lifetime result is not JSON.',
      { cause: error },
    );
  }
}

function materialize(
  input: PutFlapLifetimeHeadInput,
  sequence: number,
  predecessorId: string | null,
): MaterializedHead {
  const scanId = uuid(input.scanId);
  const parsed = FlapLifetimeStateSchema.safeParse(input.result);
  if (!parsed.success) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_INVALID',
      'Flap lifetime head result is invalid.',
      { cause: parsed.error },
    );
  }
  const result = parsed.data;
  const snapshot = result.metadata.snapshot;
  const isExtension = 'predecessor' in result;
  if (
    snapshot?.ledger !== 'EVM' ||
    snapshot.chainId !== 'eip155:56' ||
    snapshot.finality !== 'finalized' ||
    result.lifetimeCoverage.state !== 'known' ||
    result.lifetimeCoverage.value !== true ||
    result.metadata.dataCoverage !== 1 ||
    result.metadata.historyCoverage !== 1 ||
    snapshot.blockNumber !== result.targetBlock ||
    !result.metadata.evidenceIds.includes(result.terminalEvidenceId)
  ) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_INVALID',
      'Flap lifetime head requires exact Known finalized coverage and terminal Evidence.',
    );
  }
  const targetBlock = safeInteger(result.targetBlock, 'targetBlock');
  if (
    (isExtension && (predecessorId === null || sequence < 1)) ||
    (!isExtension && (predecessorId !== null || sequence !== 0))
  ) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Flap lifetime head predecessor sequence is inconsistent.',
    );
  }
  const resultHash = hashPayload(result);
  return {
    id: `flh_${hashPayload({
      schema: 'zerotrace-flap-lifetime-head-v1',
      scanId,
      resultHash,
    }).slice(0, 24)}`,
    chainId: 'eip155:56',
    token: tokenAddress(result.token),
    sequence,
    scanId,
    headType: isExtension ? 'EXTENSION' : 'INITIAL',
    predecessorId,
    targetBlock,
    targetHash: snapshot.blockHash,
    resultHash,
    result,
    snapshotHash: hashPayload(snapshot),
    terminalEvidenceId: result.terminalEvidenceId,
  };
}

function assertSame(stored: FlapLifetimeHead, expected: MaterializedHead): void {
  if (
    stored.id !== expected.id ||
    stored.chainId !== expected.chainId ||
    stored.token !== expected.token ||
    stored.sequence !== expected.sequence ||
    stored.scanId !== expected.scanId ||
    stored.headType !== expected.headType ||
    stored.predecessorId !== expected.predecessorId ||
    stored.targetBlock !== expected.targetBlock ||
    stored.targetHash !== expected.targetHash ||
    stored.resultHash !== expected.resultHash ||
    stored.snapshotHash !== expected.snapshotHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    canonicalJson(stored.result) !== canonicalJson(expected.result)
  ) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Stored Flap lifetime head conflicts with the canonical result.',
    );
  }
}

function rowToHead(row: Record<string, unknown>): FlapLifetimeHead {
  const parsed = FlapLifetimeStateSchema.safeParse(json(row.result));
  if (!parsed.success) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Stored Flap lifetime result is invalid.',
      { cause: parsed.error },
    );
  }
  const chainId = requiredString(row, 'chain_id');
  const headType = requiredString(row, 'head_type');
  if (chainId !== 'eip155:56' || !['INITIAL', 'EXTENSION'].includes(headType)) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Stored Flap lifetime chain or head type is invalid.',
    );
  }
  const head: FlapLifetimeHead = {
    id: requiredString(row, 'id'),
    chainId,
    token: tokenAddress(requiredString(row, 'token')),
    sequence: safeInteger(row.sequence, 'sequence'),
    scanId: uuid(requiredString(row, 'scan_id')),
    headType: headType as 'INITIAL' | 'EXTENSION',
    predecessorId: optionalString(row, 'predecessor_id'),
    targetBlock: safeInteger(row.target_block, 'targetBlock'),
    targetHash: requiredString(row, 'target_hash'),
    resultHash: requiredString(row, 'result_hash'),
    result: parsed.data,
    snapshotHash: requiredString(row, 'snapshot_hash'),
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    createdAt: timestamp(row.created_at),
  };
  assertSame(
    head,
    materialize({ scanId: head.scanId, result: head.result }, head.sequence, head.predecessorId),
  );
  return head;
}

export class PostgresFlapLifetimeHeadRepository {
  readonly #pool: LifetimeHeadPool;

  constructor(options: FlapLifetimeHeadRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: LifetimeHeadPool): PostgresFlapLifetimeHeadRepository {
    return new PostgresFlapLifetimeHeadRepository({ pool });
  }

  async putHead(input: PutFlapLifetimeHeadInput): Promise<FlapLifetimeHead> {
    const scanId = uuid(input.scanId);
    try {
      const existing = await this.#findByScanId(scanId);
      if (existing !== undefined) {
        const expected = materialize(
          { scanId, result: input.result },
          existing.sequence,
          existing.predecessorId,
        );
        assertSame(existing, expected);
        return existing;
      }
      const parsed = FlapLifetimeStateSchema.parse(input.result);
      const predecessor =
        'predecessor' in parsed ? await this.#findByScanId(parsed.predecessor.scanId) : undefined;
      if ('predecessor' in parsed && predecessor === undefined) {
        throw new FlapLifetimeHeadError(
          'FLAP_LIFETIME_HEAD_CONFLICT',
          'Flap lifetime extension predecessor is not stored.',
        );
      }
      const expected = materialize(
        { scanId, result: parsed },
        predecessor === undefined ? 0 : predecessor.sequence + 1,
        predecessor?.id ?? null,
      );
      await this.#pool.query(
        `INSERT INTO flap_lifetime_heads (
          id, chain_id, token, sequence, scan_id, head_type, predecessor_id,
          target_block, target_hash, result_hash, result, snapshot_hash,
          terminal_evidence_id
        ) VALUES (
          $1, $2, $3, $4, $5::uuid, $6, $7, $8::numeric, $9, $10,
          $11::jsonb, $12, $13
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.chainId,
          expected.token,
          expected.sequence,
          expected.scanId,
          expected.headType,
          expected.predecessorId,
          expected.targetBlock,
          expected.targetHash,
          expected.resultHash,
          canonicalJson(expected.result),
          expected.snapshotHash,
          expected.terminalEvidenceId,
        ],
      );
      const stored = await this.#findByScanId(scanId);
      if (stored === undefined) {
        throw new FlapLifetimeHeadError(
          'FLAP_LIFETIME_HEAD_CONFLICT',
          'Flap lifetime head was not stored.',
        );
      }
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof FlapLifetimeHeadError) throw error;
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_UNAVAILABLE',
        'Flap lifetime head write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latestHead(chainId: string, token: string): Promise<FlapLifetimeHead | undefined> {
    if (chainId !== 'eip155:56') {
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_INVALID',
        'Flap lifetime heads currently require eip155:56.',
      );
    }
    const canonicalToken = tokenAddress(token);
    try {
      const result = await this.#pool.query(
        `${SELECT_HEAD}
         WHERE chain_id = $1 AND token = $2
         ORDER BY sequence DESC
         LIMIT 1`,
        [chainId, canonicalToken],
      );
      return result.rows[0] === undefined ? undefined : rowToHead(result.rows[0]);
    } catch (error) {
      if (error instanceof FlapLifetimeHeadError) throw error;
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_UNAVAILABLE',
        'Flap lifetime head read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: FlapLifetimeHeadErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.flap_lifetime_heads')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['009_flap_lifetime_heads'],
      );
      if (
        result.rows[0]?.table_name !== 'flap_lifetime_heads' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'FLAP_LIFETIME_HEAD_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'FLAP_LIFETIME_HEAD_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }

  async #findByScanId(scanId: string): Promise<FlapLifetimeHead | undefined> {
    const result = await this.#pool.query(`${SELECT_HEAD} WHERE scan_id = $1::uuid`, [scanId]);
    return result.rows[0] === undefined ? undefined : rowToHead(result.rows[0]);
  }
}
