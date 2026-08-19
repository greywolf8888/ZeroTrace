import { Pool } from 'pg';

import { hashPayload } from '@zerotrace/evidence';
import { ForensicCampaignAlertSchema, type ForensicCampaignAlert } from '@zerotrace/schemas';

export interface ForensicCampaignAlertStorageOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

export type ForensicCampaignAlertStorageErrorCode =
  | 'FORENSIC_ALERT_STORAGE_UNAVAILABLE'
  | 'FORENSIC_ALERT_STORAGE_NOT_INITIALIZED'
  | 'FORENSIC_ALERT_STORAGE_WRITE_FAILED'
  | 'FORENSIC_ALERT_STORAGE_READ_FAILED'
  | 'FORENSIC_ALERT_STORAGE_CONFLICT';

export class ForensicCampaignAlertStorageError extends Error {
  readonly code: ForensicCampaignAlertStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ForensicCampaignAlertStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ForensicCampaignAlertStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

interface AlertQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface AlertClient {
  query(text: string, values?: readonly unknown[]): Promise<AlertQueryResult>;
  release(): void;
}

interface AlertPool {
  query(text: string, values?: readonly unknown[]): Promise<AlertQueryResult>;
  connect(): Promise<AlertClient>;
  end(): Promise<void>;
}

function createPool(options: ForensicCampaignAlertStorageOptions): AlertPool {
  let url: URL;
  try {
    url = new URL(options.connectionString);
  } catch (error) {
    throw new ForensicCampaignAlertStorageError(
      'FORENSIC_ALERT_STORAGE_NOT_INITIALIZED',
      'Forensic Campaign Alert PostgreSQL URL is invalid.',
      { cause: error },
    );
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new ForensicCampaignAlertStorageError(
      'FORENSIC_ALERT_STORAGE_NOT_INITIALIZED',
      'Forensic Campaign Alert storage must use PostgreSQL.',
    );
  }
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-forensic-campaign-alerts',
  });
  pool.on('error', () => undefined);
  return {
    query: async (text, values) => {
      const result = await pool.query(text, values === undefined ? undefined : [...values]);
      return { rows: result.rows as Array<Record<string, unknown>>, rowCount: result.rowCount };
    },
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (text, values) => {
          const result = await client.query(text, values === undefined ? undefined : [...values]);
          return {
            rows: result.rows as Array<Record<string, unknown>>,
            rowCount: result.rowCount,
          };
        },
        release: () => client.release(),
      };
    },
    end: () => pool.end(),
  };
}

function payloadFromRow(row: Record<string, unknown>): unknown {
  const payload = row.payload;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as unknown;
    } catch (error) {
      throw new ForensicCampaignAlertStorageError(
        'FORENSIC_ALERT_STORAGE_CONFLICT',
        'Stored Forensic Campaign Alert payload is invalid JSON.',
        { cause: error },
      );
    }
  }
  return payload;
}

function evidenceIdsFromRow(row: Record<string, unknown>): string[] {
  const value = row.evidence_ids;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ForensicCampaignAlertStorageError(
      'FORENSIC_ALERT_STORAGE_CONFLICT',
      'Stored Forensic Campaign Alert Evidence edges are invalid.',
    );
  }
  return [...new Set(value as string[])].sort();
}

const SELECT_ALERT = `
  SELECT
    alert.payload,
    COALESCE(
      array_agg(edge.evidence_id ORDER BY edge.evidence_id)
        FILTER (WHERE edge.evidence_id IS NOT NULL),
      ARRAY[]::text[]
    ) AS evidence_ids
  FROM control_campaign_alerts alert
  LEFT JOIN control_campaign_alert_evidence edge ON edge.alert_id = alert.id
`;

function alertFromRow(row: Record<string, unknown>): ForensicCampaignAlert {
  const parsed = ForensicCampaignAlertSchema.parse(payloadFromRow(row));
  const storedEvidenceIds = evidenceIdsFromRow(row);
  if (hashPayload(parsed.evidenceIds) !== hashPayload(storedEvidenceIds)) {
    throw new ForensicCampaignAlertStorageError(
      'FORENSIC_ALERT_STORAGE_CONFLICT',
      'Stored Forensic Campaign Alert conflicts with its Evidence edges.',
    );
  }
  return parsed;
}

function campaignId(value: string): string {
  if (!/^cc_[0-9a-f]{24}$/.test(value)) {
    throw new ForensicCampaignAlertStorageError(
      'FORENSIC_ALERT_STORAGE_CONFLICT',
      'Forensic Campaign Alert Campaign ID is invalid.',
    );
  }
  return value;
}

function alertId(value: string): string {
  if (!/^fca_[0-9a-f]{24}$/.test(value)) {
    throw new ForensicCampaignAlertStorageError(
      'FORENSIC_ALERT_STORAGE_CONFLICT',
      'Forensic Campaign Alert ID is invalid.',
    );
  }
  return value;
}

export class PostgresForensicCampaignAlertRepository {
  readonly #pool: AlertPool;

  constructor(options: ForensicCampaignAlertStorageOptions | { pool: AlertPool }) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: AlertPool): PostgresForensicCampaignAlertRepository {
    return new PostgresForensicCampaignAlertRepository({ pool });
  }

  async put(alert: ForensicCampaignAlert): Promise<ForensicCampaignAlert> {
    const parsed = ForensicCampaignAlertSchema.parse(alert);
    let client: AlertClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw new ForensicCampaignAlertStorageError(
        'FORENSIC_ALERT_STORAGE_UNAVAILABLE',
        'Durable Forensic Campaign Alert storage is unavailable.',
        { retryable: true, cause: error },
      );
    }
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO control_campaign_alerts (
          id, campaign_id, behavior_event_id, severity, classification, evidence_ids,
          snapshot, confidence, suppression_applied, details, model_version, created_at,
          result_hash, payload
        ) VALUES (
          $1, $2, $3, $4, $5, $6::text[], $7::jsonb, $8::jsonb, $9::text[], $10::jsonb,
          $11, $12::timestamptz, $13, $14::jsonb
        ) ON CONFLICT (id) DO NOTHING
        RETURNING id`,
        [
          parsed.id,
          parsed.campaignId,
          parsed.behaviorEventId,
          parsed.severity,
          parsed.classification,
          parsed.evidenceIds,
          JSON.stringify(parsed.snapshot),
          JSON.stringify(parsed.confidence),
          parsed.suppressionApplied,
          JSON.stringify(parsed.details),
          parsed.modelVersion,
          parsed.createdAt,
          parsed.resultHash,
          JSON.stringify(parsed),
        ],
      );
      if (inserted.rowCount === 1) {
        for (const evidenceId of parsed.evidenceIds) {
          await client.query(
            `INSERT INTO control_campaign_alert_evidence (alert_id, evidence_id)
             VALUES ($1, $2) ON CONFLICT (alert_id, evidence_id) DO NOTHING`,
            [parsed.id, evidenceId],
          );
        }
      }
      const stored = await client.query(
        `${SELECT_ALERT}
         WHERE alert.id = $1
         GROUP BY alert.id`,
        [parsed.id],
      );
      const row = stored.rows[0];
      if (row === undefined) {
        throw new ForensicCampaignAlertStorageError(
          'FORENSIC_ALERT_STORAGE_WRITE_FAILED',
          'Forensic Campaign Alert was not stored.',
        );
      }
      const result = alertFromRow(row);
      if (hashPayload(result) !== hashPayload(parsed)) {
        throw new ForensicCampaignAlertStorageError(
          'FORENSIC_ALERT_STORAGE_CONFLICT',
          'Stored Forensic Campaign Alert conflicts with its canonical identity.',
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
      if (error instanceof ForensicCampaignAlertStorageError) throw error;
      throw new ForensicCampaignAlertStorageError(
        'FORENSIC_ALERT_STORAGE_WRITE_FAILED',
        'Durable Forensic Campaign Alert write failed.',
        { retryable: true, cause: error },
      );
    } finally {
      client.release();
    }
  }

  async get(id: string): Promise<ForensicCampaignAlert | undefined> {
    const canonicalId = alertId(id);
    try {
      const result = await this.#pool.query(
        `${SELECT_ALERT}
         WHERE alert.id = $1
         GROUP BY alert.id`,
        [canonicalId],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : alertFromRow(row);
    } catch (error) {
      if (error instanceof ForensicCampaignAlertStorageError) throw error;
      throw new ForensicCampaignAlertStorageError(
        'FORENSIC_ALERT_STORAGE_READ_FAILED',
        'Durable Forensic Campaign Alert read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async listByCampaign(campaignIdInput: string, limit = 100): Promise<ForensicCampaignAlert[]> {
    const campaign = campaignId(campaignIdInput);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new ForensicCampaignAlertStorageError(
        'FORENSIC_ALERT_STORAGE_CONFLICT',
        'Forensic Campaign Alert limit must be between 1 and 500.',
      );
    }
    try {
      const result = await this.#pool.query(
        `${SELECT_ALERT}
         WHERE alert.campaign_id = $1
         GROUP BY alert.id
         ORDER BY alert.created_at ASC, alert.id ASC
         LIMIT $2`,
        [campaign, limit],
      );
      return result.rows.map(alertFromRow);
    } catch (error) {
      if (error instanceof ForensicCampaignAlertStorageError) throw error;
      throw new ForensicCampaignAlertStorageError(
        'FORENSIC_ALERT_STORAGE_READ_FAILED',
        'Durable Forensic Campaign Alert list failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: ForensicCampaignAlertStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.control_campaign_alerts')::text AS alert_table,
          to_regclass('public.control_campaign_alert_evidence')::text AS evidence_table,
          EXISTS (
            SELECT 1 FROM schema_migrations WHERE version = '034_control_campaign_alerts'
          ) AS migration_applied`,
      );
      const row = result.rows[0];
      if (
        row?.alert_table !== 'control_campaign_alerts' ||
        row.evidence_table !== 'control_campaign_alert_evidence' ||
        row.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'FORENSIC_ALERT_STORAGE_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'FORENSIC_ALERT_STORAGE_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
