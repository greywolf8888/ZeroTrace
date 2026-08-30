import { Pool } from 'pg';

import {
  dispatchRequest,
  finishRequest,
  parseProcurementState,
  parseSpendPolicy,
  reserveRequest,
  type ProcurementState,
  type Quote,
  type SpendPolicy,
} from '@zerotrace/provider-plane';

export interface DataProcurementRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface ProcurementClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

export interface ProcurementPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  connect(): Promise<ProcurementClient>;
  end(): Promise<void>;
}

interface InternalOptions {
  pool: ProcurementPool;
}

export type DataProcurementStorageErrorCode =
  | 'DATA_PROCUREMENT_INVALID'
  | 'DATA_PROCUREMENT_NOT_INITIALIZED'
  | 'DATA_PROCUREMENT_CONFLICT'
  | 'DATA_PROCUREMENT_UNAVAILABLE';

export class DataProcurementStorageError extends Error {
  readonly code: DataProcurementStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: DataProcurementStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'DataProcurementStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface DataProcurementRecord {
  scopeId: string;
  policy: SpendPolicy;
  state: ProcurementState;
  updatedAt: string;
}

function scopeId(value: string): string {
  if (!/^[a-z0-9][a-z0-9_.:-]{0,127}$/.test(value)) {
    throw new DataProcurementStorageError(
      'DATA_PROCUREMENT_INVALID',
      'Data-procurement scope is invalid.',
    );
  }
  return value;
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new DataProcurementStorageError(
      'DATA_PROCUREMENT_INVALID',
      'Stored data-procurement JSON is invalid.',
      { cause: error },
    );
  }
}

function rowToRecord(row: Record<string, unknown>): DataProcurementRecord {
  const id = row.scope_id;
  const revision = row.revision;
  const updated = row.updated_at;
  if (
    typeof id !== 'string' ||
    (typeof revision !== 'number' && typeof revision !== 'string') ||
    (typeof updated !== 'string' && !(updated instanceof Date))
  ) {
    throw new DataProcurementStorageError(
      'DATA_PROCUREMENT_INVALID',
      'Stored data-procurement row is malformed.',
    );
  }
  let policy: SpendPolicy;
  let state: ProcurementState;
  try {
    policy = parseSpendPolicy(json(row.policy));
    state = parseProcurementState(json(row.state));
  } catch (error) {
    throw new DataProcurementStorageError(
      'DATA_PROCUREMENT_INVALID',
      'Stored data-procurement policy or state is invalid.',
      { cause: error },
    );
  }
  const storedRevision = Number(revision);
  if (!Number.isSafeInteger(storedRevision) || storedRevision !== state.revision) {
    throw new DataProcurementStorageError(
      'DATA_PROCUREMENT_CONFLICT',
      'Stored data-procurement revision does not match its state.',
    );
  }
  const date = updated instanceof Date ? updated : new Date(updated);
  if (Number.isNaN(date.getTime())) {
    throw new DataProcurementStorageError(
      'DATA_PROCUREMENT_INVALID',
      'Stored data-procurement update time is invalid.',
    );
  }
  return { scopeId: scopeId(id), policy, state, updatedAt: date.toISOString() };
}

function nodePool(options: DataProcurementRepositoryOptions): ProcurementPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 10_000,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', () => undefined);
  const values = (input: readonly unknown[] | undefined): unknown[] | undefined =>
    input === undefined ? undefined : [...input];
  return {
    query: async (text, parameters) => {
      const result = await pool.query(text, values(parameters));
      return { rows: result.rows as Array<Record<string, unknown>>, rowCount: result.rowCount };
    },
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (text, parameters) => {
          const result = await client.query(text, values(parameters));
          return { rows: result.rows as Array<Record<string, unknown>>, rowCount: result.rowCount };
        },
        release: () => client.release(),
      };
    },
    end: () => pool.end(),
  };
}

const SELECT_LEDGER = `
  SELECT scope_id, policy, state, revision, updated_at
  FROM data_procurement_ledgers
  WHERE scope_id = $1
`;

export class PostgresDataProcurementRepository {
  readonly #pool: ProcurementPool;

  constructor(options: DataProcurementRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : nodePool(options);
  }

  static fromPool(pool: ProcurementPool): PostgresDataProcurementRepository {
    return new PostgresDataProcurementRepository({ pool });
  }

  async get(scope = 'global'): Promise<DataProcurementRecord> {
    const normalized = scopeId(scope);
    try {
      const result = await this.#pool.query(SELECT_LEDGER, [normalized]);
      const row = result.rows[0];
      if (row === undefined) {
        throw new DataProcurementStorageError(
          'DATA_PROCUREMENT_NOT_INITIALIZED',
          'Durable data-procurement state is not initialized.',
        );
      }
      return rowToRecord(row);
    } catch (error) {
      if (error instanceof DataProcurementStorageError) throw error;
      throw new DataProcurementStorageError(
        'DATA_PROCUREMENT_UNAVAILABLE',
        'Durable data-procurement storage is unavailable.',
        { retryable: true, cause: error },
      );
    }
  }

  reserve(scope: string, quote: Quote, now: number): Promise<DataProcurementRecord> {
    return this.#mutate(scope, (record) => reserveRequest(record.state, record.policy, quote, now));
  }

  dispatch(
    scope: string,
    requestId: string,
    policyVersion: string,
    now: number,
  ): Promise<DataProcurementRecord> {
    return this.#mutate(scope, (record) =>
      dispatchRequest(record.state, requestId, policyVersion, now),
    );
  }

  finish(
    scope: string,
    requestId: string,
    result:
      | { kind: 'NOT_DISPATCHED' }
      | { kind: 'UNKNOWN_CHARGE' }
      | { kind: 'CHARGED'; units: string; microusd: string },
  ): Promise<DataProcurementRecord> {
    return this.#mutate(scope, (record) => finishRequest(record.state, requestId, result));
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    durable: true;
    checkedAt: string;
    errorCode?: DataProcurementStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(`
        SELECT
          to_regclass('public.data_procurement_ledgers')::text AS ledger_table,
          EXISTS (
            SELECT 1 FROM schema_migrations WHERE version = '041_v11_data_procurement'
          ) AS migrated
      `);
      return result.rows[0]?.ledger_table === 'data_procurement_ledgers' &&
        result.rows[0]?.migrated === true
        ? { status: 'UP', durable: true, checkedAt }
        : {
            status: 'DOWN',
            durable: true,
            checkedAt,
            errorCode: 'DATA_PROCUREMENT_NOT_INITIALIZED',
          };
    } catch {
      return {
        status: 'DOWN',
        durable: true,
        checkedAt,
        errorCode: 'DATA_PROCUREMENT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }

  async #mutate(
    scope: string,
    mutate: (current: DataProcurementRecord) => ProcurementState,
  ): Promise<DataProcurementRecord> {
    const normalized = scopeId(scope);
    let client: ProcurementClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw new DataProcurementStorageError(
        'DATA_PROCUREMENT_UNAVAILABLE',
        'Durable data-procurement transaction is unavailable.',
        { retryable: true, cause: error },
      );
    }
    try {
      await client.query('BEGIN');
      const selected = await client.query(`${SELECT_LEDGER} FOR UPDATE`, [normalized]);
      const row = selected.rows[0];
      if (row === undefined) {
        throw new DataProcurementStorageError(
          'DATA_PROCUREMENT_NOT_INITIALIZED',
          'Durable data-procurement state is not initialized.',
        );
      }
      const current = rowToRecord(row);
      const next = parseProcurementState(mutate(current));
      if (next.revision === current.state.revision) {
        await client.query('COMMIT');
        return current;
      }
      if (next.revision !== current.state.revision + 1) {
        throw new DataProcurementStorageError(
          'DATA_PROCUREMENT_CONFLICT',
          'Data-procurement mutation must advance exactly one revision.',
        );
      }
      const updated = await client.query(
        `
          UPDATE data_procurement_ledgers
          SET state = $2::jsonb, revision = $3, updated_at = now()
          WHERE scope_id = $1 AND revision = $4
          RETURNING scope_id, policy, state, revision, updated_at
        `,
        [normalized, JSON.stringify(next), next.revision, current.state.revision],
      );
      const updatedRow = updated.rows[0];
      if (updated.rowCount !== 1 || updatedRow === undefined) {
        throw new DataProcurementStorageError(
          'DATA_PROCUREMENT_CONFLICT',
          'Concurrent data-procurement update lost its revision fence.',
          { retryable: true },
        );
      }
      const result = rowToRecord(updatedRow);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }
      if (error instanceof DataProcurementStorageError) throw error;
      if (error instanceof Error) {
        throw new DataProcurementStorageError('DATA_PROCUREMENT_INVALID', error.message, {
          cause: error,
        });
      }
      throw new DataProcurementStorageError(
        'DATA_PROCUREMENT_INVALID',
        'Data-procurement mutation failed.',
        { cause: error },
      );
    } finally {
      client.release();
    }
  }
}
