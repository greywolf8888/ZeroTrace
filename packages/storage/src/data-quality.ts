import { Pool } from 'pg';

import type { DataQualityRepository } from '@zerotrace/data-quality';
import { hashPayload } from '@zerotrace/evidence';
import {
  DataQualityAlertSchema,
  LedgerSchema,
  PersistedChainAnchorObservationSchema,
  type DataQualityAlert,
  type Ledger,
  type PersistedChainAnchorObservation,
} from '@zerotrace/schemas';

export interface DataQualityStorageOptions {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

export type DataQualityStorageErrorCode =
  | 'DATA_QUALITY_STORAGE_UNAVAILABLE'
  | 'DATA_QUALITY_STORAGE_NOT_INITIALIZED'
  | 'DATA_QUALITY_STORAGE_WRITE_FAILED'
  | 'DATA_QUALITY_STORAGE_READ_FAILED'
  | 'DATA_QUALITY_STORAGE_CONFLICT';

export class DataQualityStorageError extends Error {
  readonly code: DataQualityStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: DataQualityStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'DataQualityStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface DataQualityStorageHealth {
  status: 'UP' | 'DOWN';
  backend: 'POSTGRES';
  durable: true;
  checkedAt: string;
  errorCode?: DataQualityStorageErrorCode;
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

export interface DataQualityDatabaseClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

export interface DataQualityDatabasePool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  connect(): Promise<DataQualityDatabaseClient>;
  end(): Promise<void>;
}

function createPool(options: DataQualityStorageOptions): DataQualityDatabasePool {
  let url: URL;
  try {
    url = new URL(options.connectionString);
  } catch (error) {
    throw new DataQualityStorageError(
      'DATA_QUALITY_STORAGE_NOT_INITIALIZED',
      'Data-quality PostgreSQL URL is invalid.',
      { cause: error },
    );
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new DataQualityStorageError(
      'DATA_QUALITY_STORAGE_NOT_INITIALIZED',
      'Data-quality storage must use PostgreSQL.',
    );
  }
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-data-quality',
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

function payloadFromRow(row: Record<string, unknown>, field = 'payload'): unknown {
  const value = row[field];
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch (error) {
      throw new DataQualityStorageError(
        'DATA_QUALITY_STORAGE_CONFLICT',
        `Stored ${field} JSON is invalid.`,
        { cause: error },
      );
    }
  }
  return value;
}

function evidenceIdsFromRow(row: Record<string, unknown>): string[] {
  const value = row.evidence_ids;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DataQualityStorageError(
      'DATA_QUALITY_STORAGE_CONFLICT',
      'Stored Data Quality Alert Evidence edges are invalid.',
    );
  }
  return [...new Set(value as string[])].sort();
}

function normalizedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

const SELECT_ALERT = `
  SELECT
    alert.payload,
    COALESCE(
      array_agg(edge.evidence_id ORDER BY edge.evidence_id)
        FILTER (WHERE edge.evidence_id IS NOT NULL),
      ARRAY[]::text[]
    ) AS evidence_ids
  FROM data_quality_alerts alert
  LEFT JOIN data_quality_alert_evidence edge ON edge.alert_id = alert.id
  WHERE alert.id = $1
  GROUP BY alert.id
`;

export class PostgresDataQualityRepository implements DataQualityRepository {
  readonly durable = true;
  readonly #pool: DataQualityDatabasePool;

  constructor(options: DataQualityStorageOptions | { pool: DataQualityDatabasePool }) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: DataQualityDatabasePool): PostgresDataQualityRepository {
    return new PostgresDataQualityRepository({ pool });
  }

  async putAnchor(
    observation: PersistedChainAnchorObservation,
  ): Promise<PersistedChainAnchorObservation> {
    const parsed = PersistedChainAnchorObservationSchema.parse(observation);
    try {
      await this.#pool.query(
        `INSERT INTO chain_anchor_observations (
          id, ledger, chain_id, source, observation_role, position, block_hash,
          parent_position, parent_hash, finality, observed_at, evidence_id, payload
        ) VALUES (
          $1, $2::ledger_kind, $3, $4, $5, $6::numeric, $7,
          $8::numeric, $9, $10, $11::timestamptz, $12, $13::jsonb
        ) ON CONFLICT (id) DO NOTHING`,
        [
          parsed.id,
          parsed.ledger,
          parsed.chainId,
          parsed.source,
          parsed.role,
          parsed.position,
          parsed.hash,
          parsed.parentPosition ?? null,
          parsed.parentHash ?? null,
          parsed.finality,
          parsed.observedAt,
          parsed.evidenceId,
          JSON.stringify(parsed),
        ],
      );
      const stored = await this.#pool.query(
        'SELECT payload FROM chain_anchor_observations WHERE id = $1',
        [parsed.id],
      );
      const row = stored.rows[0];
      if (row === undefined) {
        throw new DataQualityStorageError(
          'DATA_QUALITY_STORAGE_WRITE_FAILED',
          'Chain anchor was not stored.',
        );
      }
      const result = PersistedChainAnchorObservationSchema.parse(payloadFromRow(row));
      if (hashPayload(result) !== hashPayload(parsed)) {
        throw new DataQualityStorageError(
          'DATA_QUALITY_STORAGE_CONFLICT',
          'Stored chain anchor conflicts with its canonical identity.',
        );
      }
      return result;
    } catch (error) {
      if (error instanceof DataQualityStorageError) throw error;
      throw new DataQualityStorageError(
        'DATA_QUALITY_STORAGE_WRITE_FAILED',
        'Durable chain-anchor write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latestHead(
    ledger: Ledger,
    chainId: string,
    source: string,
  ): Promise<PersistedChainAnchorObservation | undefined> {
    const parsedLedger = LedgerSchema.parse(ledger);
    try {
      const result = await this.#pool.query(
        `SELECT payload
         FROM chain_anchor_observations
         WHERE ledger = $1::ledger_kind
           AND chain_id = $2
           AND source = $3
           AND observation_role = 'HEAD'
         ORDER BY observed_at DESC, id DESC
         LIMIT 1`,
        [parsedLedger, chainId, source],
      );
      const row = result.rows[0];
      return row === undefined
        ? undefined
        : PersistedChainAnchorObservationSchema.parse(payloadFromRow(row));
    } catch (error) {
      if (error instanceof DataQualityStorageError) throw error;
      throw new DataQualityStorageError(
        'DATA_QUALITY_STORAGE_READ_FAILED',
        'Durable chain-anchor read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async putAlert(alert: DataQualityAlert): Promise<DataQualityAlert> {
    const parsed = DataQualityAlertSchema.parse(alert);
    let client: DataQualityDatabaseClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw new DataQualityStorageError(
        'DATA_QUALITY_STORAGE_UNAVAILABLE',
        'Durable Data Quality Alert storage is unavailable.',
        { retryable: true, cause: error },
      );
    }
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO data_quality_alerts (
          id, alert_kind, severity, ledger, chain_id, position, summary,
          details, observed_at, model_version, payload
        ) VALUES (
          $1, $2, $3, $4::ledger_kind, $5, $6::numeric, $7,
          $8::jsonb, $9::timestamptz, $10, $11::jsonb
        ) ON CONFLICT (id) DO NOTHING
        RETURNING id`,
        [
          parsed.id,
          parsed.kind,
          parsed.severity,
          parsed.ledger,
          parsed.chainId,
          parsed.position ?? null,
          parsed.summary,
          JSON.stringify(parsed.details),
          parsed.observedAt,
          parsed.modelVersion,
          JSON.stringify(parsed),
        ],
      );
      if (inserted.rowCount === 1) {
        for (const evidenceId of normalizedIds(parsed.evidenceIds)) {
          await client.query(
            `INSERT INTO data_quality_alert_evidence (alert_id, evidence_id)
             VALUES ($1, $2)`,
            [parsed.id, evidenceId],
          );
        }
      }
      const stored = await client.query(SELECT_ALERT, [parsed.id]);
      const row = stored.rows[0];
      if (row === undefined) {
        throw new DataQualityStorageError(
          'DATA_QUALITY_STORAGE_WRITE_FAILED',
          'Data Quality Alert was not stored.',
        );
      }
      const result = DataQualityAlertSchema.parse(payloadFromRow(row));
      const storedEvidenceIds = evidenceIdsFromRow(row);
      if (
        hashPayload(result) !== hashPayload(parsed) ||
        hashPayload(storedEvidenceIds) !== hashPayload(normalizedIds(parsed.evidenceIds))
      ) {
        throw new DataQualityStorageError(
          'DATA_QUALITY_STORAGE_CONFLICT',
          'Stored Data Quality Alert conflicts with its Evidence edges.',
        );
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the primary durable-write failure.
      }
      if (error instanceof DataQualityStorageError) throw error;
      throw new DataQualityStorageError(
        'DATA_QUALITY_STORAGE_WRITE_FAILED',
        'Durable Data Quality Alert write failed.',
        { retryable: true, cause: error },
      );
    } finally {
      client.release();
    }
  }

  async health(): Promise<DataQualityStorageHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.chain_anchor_observations')::text AS anchor_table,
          to_regclass('public.data_quality_alerts')::text AS alert_table,
          to_regclass('public.data_quality_alert_evidence')::text AS alert_evidence_table,
          EXISTS (
            SELECT 1 FROM schema_migrations WHERE version = '005_data_quality'
          ) AS migration_applied`,
      );
      const row = result.rows[0];
      if (
        row?.anchor_table !== 'chain_anchor_observations' ||
        row.alert_table !== 'data_quality_alerts' ||
        row.alert_evidence_table !== 'data_quality_alert_evidence' ||
        row.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'DATA_QUALITY_STORAGE_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'DATA_QUALITY_STORAGE_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
