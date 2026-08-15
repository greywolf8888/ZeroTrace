import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  ControlCampaignBundleSchema,
  type ControlCampaignBundle,
  type Ledger,
} from '@zerotrace/schemas';

export interface ControlCampaignReportRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface ReportPool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export type ControlCampaignReportStorageErrorCode =
  | 'CONTROL_CAMPAIGN_REPORT_INVALID'
  | 'CONTROL_CAMPAIGN_REPORT_CONFLICT'
  | 'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE'
  | 'CONTROL_CAMPAIGN_REPORT_NOT_INITIALIZED';

export class ControlCampaignReportStorageError extends Error {
  readonly code: ControlCampaignReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ControlCampaignReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ControlCampaignReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredControlCampaignReport {
  id: string;
  ledger: Ledger;
  chainId: string;
  token: string;
  snapshotPosition: string;
  snapshotHash: string;
  resultHash: string;
  bundle: ControlCampaignBundle;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: string;
  capturedAt: string;
  createdAt: string;
}

function createPool(options: ControlCampaignReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-control-campaign-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): ControlCampaignReportStorageError {
  return new ControlCampaignReportStorageError('CONTROL_CAMPAIGN_REPORT_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): ControlCampaignReportStorageError {
  return new ControlCampaignReportStorageError('CONTROL_CAMPAIGN_REPORT_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored Control Campaign bundle is not JSON.', error);
  }
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime()))
    throw conflict(`Stored Control Campaign ${field} is invalid.`);
  return parsed.toISOString();
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored Control Campaign ${field} is invalid.`);
  }
  return value;
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw conflict(`Stored Control Campaign ${field} is invalid.`);
  }
  const items = value as string[];
  const canonical = [...new Set(items)].sort();
  if (canonical.length !== items.length || canonical.some((item, index) => item !== items[index])) {
    throw conflict(`Stored Control Campaign ${field} is not canonical.`);
  }
  return canonical;
}

function snapshotIdentity(bundle: ControlCampaignBundle): {
  ledger: Ledger;
  chainId: string;
  position: string;
  hash: string;
  capturedAt: string;
} {
  const snapshot = bundle.campaign.snapshotEnd;
  if (snapshot.ledger === 'EVM') {
    return {
      ledger: snapshot.ledger,
      chainId: snapshot.chainId,
      position: snapshot.blockNumber,
      hash: snapshot.blockHash,
      capturedAt: snapshot.capturedAt,
    };
  }
  if (snapshot.ledger === 'BITCOIN') {
    return {
      ledger: snapshot.ledger,
      chainId: snapshot.chainId,
      position: snapshot.height,
      hash: snapshot.blockHash,
      capturedAt: snapshot.capturedAt,
    };
  }
  return {
    ledger: snapshot.ledger,
    chainId: snapshot.chainId,
    position: snapshot.slot,
    hash: snapshot.blockhash,
    capturedAt: snapshot.capturedAt,
  };
}

function materialize(bundleValue: ControlCampaignBundle): StoredControlCampaignReport {
  const parsed = ControlCampaignBundleSchema.safeParse(bundleValue);
  if (!parsed.success) throw invalid('Control Campaign bundle is invalid.', parsed.error);
  const bundle = parsed.data;
  const { ledger, chainId, position, hash, capturedAt } = snapshotIdentity(bundle);
  const withoutResultHash = {
    schemaVersion: bundle.schemaVersion,
    campaign: bundle.campaign,
    clusterVersion: bundle.clusterVersion,
    memberships: bundle.memberships,
    positions: bundle.positions,
    behaviorEvents: bundle.behaviorEvents,
    evidenceItems: bundle.evidenceItems,
    evidenceLine: bundle.evidenceLine,
  };
  const resultHash = hashPayload(withoutResultHash);
  if (bundle.resultHash !== resultHash || bundle.campaign.resultHash.length !== 64) {
    throw invalid('Control Campaign bundle resultHash is not canonical.');
  }
  return {
    id: bundle.campaign.id,
    ledger,
    chainId,
    token: bundle.campaign.token,
    snapshotPosition: position,
    snapshotHash: hash,
    resultHash,
    bundle,
    evidenceIds: bundle.campaign.metadata.evidenceIds,
    sourceSet: bundle.campaign.metadata.sourceSet,
    modelVersion: bundle.campaign.ruleVersion,
    capturedAt,
    createdAt: capturedAt,
  };
}

function rowToReport(row: Record<string, unknown>): StoredControlCampaignReport {
  const parsed = ControlCampaignBundleSchema.safeParse(json(row.bundle));
  if (!parsed.success) throw conflict('Stored Control Campaign bundle is invalid.', parsed.error);
  const stored: StoredControlCampaignReport = {
    id: requiredString(row, 'id'),
    ledger: requiredString(row, 'ledger') as Ledger,
    chainId: requiredString(row, 'chain_id'),
    token: requiredString(row, 'token'),
    snapshotPosition: requiredString(row, 'snapshot_position'),
    snapshotHash: requiredString(row, 'snapshot_hash'),
    resultHash: requiredString(row, 'result_hash'),
    bundle: parsed.data,
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version'),
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  const expected = materialize(stored.bundle);
  if (
    expected.id !== stored.id ||
    expected.ledger !== stored.ledger ||
    expected.chainId !== stored.chainId ||
    expected.token !== stored.token ||
    expected.snapshotPosition !== stored.snapshotPosition ||
    expected.snapshotHash !== stored.snapshotHash ||
    expected.resultHash !== stored.resultHash ||
    expected.modelVersion !== stored.modelVersion ||
    canonicalJson(expected.evidenceIds) !== canonicalJson(stored.evidenceIds) ||
    canonicalJson(expected.sourceSet) !== canonicalJson(stored.sourceSet)
  ) {
    throw conflict('Stored Control Campaign identity conflicts with its immutable bundle.');
  }
  return stored;
}

function reportId(value: string): string {
  if (!/^cc_[0-9a-f]{24}$/.test(value)) throw invalid('Control Campaign ID is invalid.');
  return value;
}

const SELECT_REPORT = `
  SELECT id, ledger, chain_id, token, snapshot_position::text, snapshot_hash, result_hash,
         bundle, evidence_ids, source_set, model_version, captured_at, created_at
  FROM control_campaign_reports
`;

export class PostgresControlCampaignReportRepository {
  readonly #pool: ReportPool;

  constructor(options: ControlCampaignReportRepositoryOptions | { pool: ReportPool }) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromConnectionString(
    options: ControlCampaignReportRepositoryOptions,
  ): PostgresControlCampaignReportRepository {
    return new PostgresControlCampaignReportRepository(options);
  }

  static fromPool(pool: ReportPool): PostgresControlCampaignReportRepository {
    return new PostgresControlCampaignReportRepository({ pool });
  }

  async put(bundle: ControlCampaignBundle): Promise<StoredControlCampaignReport> {
    const expected = materialize(bundle);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        if (
          existing.resultHash !== expected.resultHash ||
          canonicalJson(existing.bundle) !== canonicalJson(expected.bundle)
        ) {
          throw conflict('Existing Control Campaign conflicts with the canonical bundle.');
        }
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO control_campaign_reports (
          id, ledger, chain_id, token, snapshot_position, snapshot_hash, result_hash, bundle,
          evidence_ids, source_set, model_version, captured_at
        ) VALUES ($1, $2::ledger_kind, $3, $4, $5::numeric, $6, $7, $8::jsonb,
                  $9::text[], $10::text[], $11, $12::timestamptz)
         ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.ledger,
          expected.chainId,
          expected.token,
          expected.snapshotPosition,
          expected.snapshotHash,
          expected.resultHash,
          canonicalJson(expected.bundle),
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.capturedAt,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) throw conflict('Control Campaign was not stored.');
      if (stored.resultHash !== expected.resultHash)
        throw conflict('Stored Control Campaign conflicts after insert.');
      return stored;
    } catch (error) {
      if (error instanceof ControlCampaignReportStorageError) throw error;
      throw new ControlCampaignReportStorageError(
        'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
        'Control Campaign storage write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredControlCampaignReport | undefined> {
    const normalizedId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [normalizedId]);
      const row = result.rows[0];
      return row === undefined ? undefined : rowToReport(row);
    } catch (error) {
      if (error instanceof ControlCampaignReportStorageError) throw error;
      throw new ControlCampaignReportStorageError(
        'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
        'Control Campaign storage read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async list(input: {
    chainId: string;
    token: string;
    limit?: number;
  }): Promise<StoredControlCampaignReport[]> {
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 50)));
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE chain_id = $1 AND token = $2
         ORDER BY snapshot_position DESC, captured_at DESC, id DESC
         LIMIT $3`,
        [input.chainId, input.token, limit],
      );
      return result.rows.map(rowToReport);
    } catch (error) {
      if (error instanceof ControlCampaignReportStorageError) throw error;
      throw new ControlCampaignReportStorageError(
        'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
        'Control Campaign list failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(chainId: string, token: string): Promise<StoredControlCampaignReport | undefined> {
    const reports = await this.list({ chainId, token, limit: 1 });
    return reports[0];
  }

  async findByBehaviorEventId(eventId: string): Promise<StoredControlCampaignReport | undefined> {
    if (!/^be_[0-9a-f]{24}$/.test(eventId)) throw invalid('Behavior Event ID is invalid.');
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE bundle @> $1::jsonb
         ORDER BY snapshot_position DESC, captured_at DESC, id DESC
         LIMIT 1`,
        [JSON.stringify({ behaviorEvents: [{ id: eventId }] })],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : rowToReport(row);
    } catch (error) {
      if (error instanceof ControlCampaignReportStorageError) throw error;
      throw new ControlCampaignReportStorageError(
        'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
        'Behavior Event lookup failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async findByEvidenceItemId(itemId: string): Promise<StoredControlCampaignReport | undefined> {
    if (!/^cei_[0-9a-f]{24}$/.test(itemId)) throw invalid('Campaign Evidence Item ID is invalid.');
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE bundle @> $1::jsonb
         ORDER BY snapshot_position DESC, captured_at DESC, id DESC
         LIMIT 1`,
        [JSON.stringify({ evidenceItems: [{ id: itemId }] })],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : rowToReport(row);
    } catch (error) {
      if (error instanceof ControlCampaignReportStorageError) throw error;
      throw new ControlCampaignReportStorageError(
        'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
        'Campaign Evidence Item lookup failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: ControlCampaignReportStorageErrorCode;
  }> {
    try {
      await this.#pool.query('SELECT 1 FROM control_campaign_reports LIMIT 1');
      return {
        status: 'UP',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
        errorCode: 'CONTROL_CAMPAIGN_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
