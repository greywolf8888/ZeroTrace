import { Pool } from 'pg';

import {
  applyPaperCommand,
  type PaperCommand,
  type PaperExperiment,
  type PaperOutboxRecord,
  type PaperReviewReport,
  PAPER_REVIEW_MODEL_VERSION,
} from '@zerotrace/asset-ledger';
import { canonicalJson, hashPayload } from '@zerotrace/evidence';

export interface PaperSimulationRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface TransactionClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

interface PaperPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  connect(): Promise<TransactionClient>;
  end(): Promise<void>;
}

interface InternalOptions {
  pool: PaperPool;
}

export type PaperSimulationStorageErrorCode =
  | 'PAPER_STORAGE_INVALID'
  | 'PAPER_STORAGE_CONFLICT'
  | 'PAPER_STORAGE_NOT_FOUND'
  | 'PAPER_STORAGE_UNAVAILABLE'
  | 'PAPER_STORAGE_NOT_INITIALIZED';

export class PaperSimulationStorageError extends Error {
  readonly code: PaperSimulationStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: PaperSimulationStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'PaperSimulationStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

function createPool(options: PaperSimulationRepositoryOptions): PaperPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-paper-simulation',
  });
  pool.on('error', () => undefined);
  return pool as unknown as PaperPool;
}

function storageError(
  code: PaperSimulationStorageErrorCode,
  message: string,
  cause?: unknown,
): PaperSimulationStorageError {
  return new PaperSimulationStorageError(code, message, {
    retryable: code === 'PAPER_STORAGE_UNAVAILABLE',
    ...(cause === undefined ? {} : { cause }),
  });
}

function json(value: unknown, field: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw storageError('PAPER_STORAGE_CONFLICT', `Stored ${field} is not valid JSON.`, error);
  }
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw storageError('PAPER_STORAGE_CONFLICT', `Stored ${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw storageError('PAPER_STORAGE_CONFLICT', `Stored ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function experimentId(value: string): string {
  if (!/^pex_[0-9a-f]{24}$/.test(value)) {
    throw storageError('PAPER_STORAGE_INVALID', 'Paper experiment ID is invalid.');
  }
  return value;
}

function outboxId(value: string): string {
  if (!/^pob_[0-9a-f]{24}$/.test(value)) {
    throw storageError('PAPER_STORAGE_INVALID', 'Paper outbox cursor is invalid.');
  }
  return value;
}

function reviewId(value: string): string {
  if (!/^prv_[0-9a-f]{24}$/.test(value)) {
    throw storageError('PAPER_STORAGE_INVALID', 'Paper review ID is invalid.');
  }
  return value;
}

function parseExperiment(value: unknown): PaperExperiment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper experiment is invalid.');
  }
  const state = value as PaperExperiment;
  if (
    state.schemaVersion !== 'paper-experiment-v1' ||
    !/^pex_[0-9a-f]{24}$/.test(state.id) ||
    (state.chain !== 'BSC' && state.chain !== 'SOLANA') ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.processedCommands) ||
    state.processedCommands.length !== state.revision ||
    !Array.isArray(state.events) ||
    !Array.isArray(state.outbox) ||
    state.outbox.some((record) => !state.events.some((event) => event.id === record.eventId))
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper experiment integrity is invalid.');
  }
  return structuredClone(state);
}

const SELECT_EXPERIMENT = `
  SELECT id, chain, current_state, current_state_hash, revision, created_at, updated_at
  FROM paper_experiments
`;

function experimentFromRow(row: Record<string, unknown>): PaperExperiment {
  const state = parseExperiment(json(row.current_state, 'paper experiment'));
  if (
    stringValue(row.id, 'paper experiment ID') !== state.id ||
    stringValue(row.chain, 'paper experiment chain') !== state.chain ||
    String(row.revision) !== String(state.revision) ||
    stringValue(row.current_state_hash, 'paper state hash') !== hashPayload(state) ||
    timestamp(row.created_at, 'paper createdAt') !== new Date(state.createdAt).toISOString() ||
    timestamp(row.updated_at, 'paper updatedAt') !== new Date(state.updatedAt).toISOString()
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper state conflicts with its envelope.');
  }
  return state;
}

function outboxFromRow(row: Record<string, unknown>): PaperOutboxRecord {
  const payload = json(row.payload, 'paper outbox payload');
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper outbox payload is invalid.');
  }
  const record = payload as PaperOutboxRecord;
  const { id: _id, payloadHash, ...hashablePayload } = record;
  if (
    record.id !== stringValue(row.id, 'outbox ID') ||
    record.businessKey !== stringValue(row.business_key, 'outbox business key') ||
    record.eventId !== stringValue(row.event_id, 'outbox event ID') ||
    record.eventType !== stringValue(row.event_type, 'outbox event type') ||
    record.urgency !== stringValue(row.urgency, 'outbox urgency') ||
    record.deliveryState !== stringValue(row.delivery_state, 'outbox delivery state') ||
    payloadHash !== stringValue(row.payload_hash, 'outbox payload hash') ||
    payloadHash !== hashPayload(hashablePayload) ||
    record.createdAt !== timestamp(row.created_at, 'outbox createdAt')
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper outbox envelope conflicts.');
  }
  return record;
}

function commandFromRow(row: Record<string, unknown>): PaperCommand {
  const payload = json(row.payload, 'paper command payload');
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper command is invalid.');
  }
  const command = payload as PaperCommand;
  if (
    command.commandId !== stringValue(row.command_id, 'paper command ID') ||
    hashPayload(command) !== stringValue(row.command_hash, 'paper command hash')
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper command envelope conflicts.');
  }
  return structuredClone(command);
}

function parseReview(value: unknown): PaperReviewReport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper review is invalid.');
  }
  const report = value as PaperReviewReport;
  if (
    report.schemaVersion !== 'paper-review-v1' ||
    !/^prv_[0-9a-f]{24}$/.test(report.id) ||
    !/^pex_[0-9a-f]{24}$/.test(report.experimentId) ||
    !/^psn_[0-9a-f]{24}$/.test(report.snapshot?.id) ||
    report.modelVersion !== PAPER_REVIEW_MODEL_VERSION ||
    !Array.isArray(report.trades) ||
    !Array.isArray(report.rejectedCandidates) ||
    !Array.isArray(report.evidenceIds)
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper review integrity is invalid.');
  }
  return structuredClone(report);
}

function reviewFromRow(row: Record<string, unknown>): PaperReviewReport {
  const report = parseReview(json(row.report, 'paper review report'));
  if (
    report.id !== stringValue(row.id, 'paper review ID') ||
    report.experimentId !== stringValue(row.experiment_id, 'paper review experiment ID') ||
    report.snapshot.id !== stringValue(row.snapshot_id, 'paper review snapshot ID') ||
    hashPayload(report) !== stringValue(row.report_hash, 'paper review hash') ||
    report.asOf !== timestamp(row.as_of, 'paper review asOf')
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper review envelope conflicts.');
  }
  return report;
}

export class PostgresPaperSimulationRepository {
  readonly #pool: PaperPool;

  constructor(options: PaperSimulationRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: PaperPool): PostgresPaperSimulationRepository {
    return new PostgresPaperSimulationRepository({ pool });
  }

  async create(experiment: PaperExperiment): Promise<PaperExperiment> {
    const expected = parseExperiment(experiment);
    if (expected.revision !== 0 || expected.events.length > 0 || expected.outbox.length > 0) {
      throw storageError('PAPER_STORAGE_INVALID', 'New paper experiment must be at revision zero.');
    }
    try {
      await this.#pool.query(
        `INSERT INTO paper_experiments (
          id, chain, initial_state, current_state, current_state_hash, revision, created_at, updated_at
        ) VALUES ($1, $2, $3::jsonb, $3::jsonb, $4, 0, $5::timestamptz, $5::timestamptz)
        ON CONFLICT (id) DO NOTHING`,
        [
          expected.id,
          expected.chain,
          canonicalJson(expected),
          hashPayload(expected),
          expected.createdAt,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined || canonicalJson(stored) !== canonicalJson(expected)) {
        throw storageError('PAPER_STORAGE_CONFLICT', 'Paper experiment identity conflicts.');
      }
      return stored;
    } catch (error) {
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper experiment creation failed.', error);
    }
  }

  async get(id: string): Promise<PaperExperiment | undefined> {
    const normalized = experimentId(id);
    try {
      const result = await this.#pool.query(`${SELECT_EXPERIMENT} WHERE id = $1`, [normalized]);
      return result.rows[0] === undefined ? undefined : experimentFromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper experiment read failed.', error);
    }
  }

  async getCommandJournal(id: string): Promise<PaperCommand[]> {
    const normalized = experimentId(id);
    try {
      const [experiment, result] = await Promise.all([
        this.get(normalized),
        this.#pool.query(
          `SELECT command_id, command_hash, payload
           FROM paper_experiment_commands
           WHERE experiment_id = $1
           ORDER BY ordinal ASC`,
          [normalized],
        ),
      ]);
      if (experiment === undefined) {
        throw storageError('PAPER_STORAGE_NOT_FOUND', 'Paper experiment not found.');
      }
      const commands = result.rows.map(commandFromRow);
      if (
        commands.length !== experiment.processedCommands.length ||
        commands.some((command, index) => {
          const audit = experiment.processedCommands[index];
          return audit?.id !== command.commandId || audit.hash !== hashPayload(command);
        })
      ) {
        throw storageError('PAPER_STORAGE_CONFLICT', 'Paper command journal is incomplete.');
      }
      return commands;
    } catch (error) {
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper command journal read failed.', error);
    }
  }

  async apply(input: {
    experimentId: string;
    command: PaperCommand;
    expectedRevision?: number;
  }): Promise<PaperExperiment> {
    const id = experimentId(input.experimentId);
    const client = await this.#pool.connect().catch((error: unknown) => {
      throw storageError(
        'PAPER_STORAGE_UNAVAILABLE',
        'Paper transaction connection failed.',
        error,
      );
    });
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const selected = await client.query(`${SELECT_EXPERIMENT} WHERE id = $1 FOR UPDATE`, [id]);
      const row = selected.rows[0];
      if (row === undefined)
        throw storageError('PAPER_STORAGE_NOT_FOUND', 'Paper experiment not found.');
      const current = experimentFromRow(row);
      const alreadyProcessed = current.processedCommands.some(
        (command) => command.id === input.command.commandId,
      );
      if (
        !alreadyProcessed &&
        input.expectedRevision !== undefined &&
        input.expectedRevision !== current.revision
      ) {
        throw storageError('PAPER_STORAGE_CONFLICT', 'Paper experiment revision changed.');
      }
      const next = applyPaperCommand(current, input.command);
      if (next === current) {
        await client.query('COMMIT');
        return current;
      }
      const processed = next.processedCommands.at(-1);
      if (processed === undefined || processed.id !== input.command.commandId) {
        throw storageError('PAPER_STORAGE_CONFLICT', 'Paper command audit record is inconsistent.');
      }
      await client.query(
        `INSERT INTO paper_experiment_commands (
          experiment_id, command_id, ordinal, command_hash, payload, created_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
        [
          id,
          processed.id,
          next.revision,
          processed.hash,
          canonicalJson(input.command),
          next.updatedAt,
        ],
      );
      for (const [index, event] of next.events.slice(current.events.length).entries()) {
        await client.query(
          `INSERT INTO paper_experiment_events (
            id, experiment_id, ordinal, event_type, payload, created_at
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
          [
            event.id,
            id,
            current.events.length + index + 1,
            event.type,
            canonicalJson(event),
            event.eventAt,
          ],
        );
      }
      for (const record of next.outbox.slice(current.outbox.length)) {
        await client.query(
          `INSERT INTO paper_notification_outbox (
            id, experiment_id, business_key, event_id, event_type, urgency,
            delivery_state, payload_hash, payload, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8::jsonb, $9::timestamptz)`,
          [
            record.id,
            id,
            record.businessKey,
            record.eventId,
            record.eventType,
            record.urgency,
            record.payloadHash,
            canonicalJson(record),
            record.createdAt,
          ],
        );
      }
      const updated = await client.query(
        `UPDATE paper_experiments
         SET current_state = $1::jsonb, current_state_hash = $2, revision = $3,
             updated_at = $4::timestamptz
         WHERE id = $5 AND revision = $6`,
        [
          canonicalJson(next),
          hashPayload(next),
          next.revision,
          next.updatedAt,
          id,
          current.revision,
        ],
      );
      if (updated.rowCount !== 1) {
        throw storageError('PAPER_STORAGE_CONFLICT', 'Paper experiment revision fence failed.');
      }
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof PaperSimulationStorageError) throw error;
      if (error instanceof Error && error.message.startsWith('PAPER_')) {
        throw storageError('PAPER_STORAGE_CONFLICT', error.message, error);
      }
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper transaction failed.', error);
    } finally {
      client.release();
    }
  }

  async listOutbox(input: {
    experimentId: string;
    after?: string;
    limit?: number;
  }): Promise<{ records: PaperOutboxRecord[]; nextCursor: string | null }> {
    const id = experimentId(input.experimentId);
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw storageError('PAPER_STORAGE_INVALID', 'Paper outbox page limit is invalid.');
    }
    try {
      let cursor: { createdAt: string; id: string } | undefined;
      if (input.after !== undefined) {
        const after = outboxId(input.after);
        const found = await this.#pool.query(
          `SELECT id, created_at FROM paper_notification_outbox
           WHERE experiment_id = $1 AND id = $2`,
          [id, after],
        );
        const row = found.rows[0];
        if (row === undefined) {
          throw storageError('PAPER_STORAGE_INVALID', 'Paper outbox cursor does not exist.');
        }
        cursor = {
          id: stringValue(row.id, 'outbox cursor ID'),
          createdAt: timestamp(row.created_at, 'outbox cursor time'),
        };
      }
      const result = await this.#pool.query(
        `SELECT id, business_key, event_id, event_type, urgency, delivery_state,
                payload_hash, payload, created_at
         FROM paper_notification_outbox
         WHERE experiment_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3))
         ORDER BY created_at ASC, id ASC
         LIMIT $4`,
        [id, cursor?.createdAt ?? null, cursor?.id ?? '', limit + 1],
      );
      const hasMore = result.rows.length > limit;
      const records = result.rows.slice(0, limit).map(outboxFromRow);
      return {
        records,
        nextCursor: hasMore ? (records.at(-1)?.id ?? null) : null,
      };
    } catch (error) {
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper outbox page failed.', error);
    }
  }

  async saveReview(input: PaperReviewReport): Promise<PaperReviewReport> {
    const report = parseReview(input);
    try {
      await this.#pool.query(
        `INSERT INTO paper_review_reports (
          id, experiment_id, snapshot_id, report_hash, report, as_of
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
        ON CONFLICT (id) DO NOTHING`,
        [
          report.id,
          report.experimentId,
          report.snapshot.id,
          hashPayload(report),
          canonicalJson(report),
          report.asOf,
        ],
      );
      const stored = await this.getReview(report.id);
      if (stored === undefined || canonicalJson(stored) !== canonicalJson(report)) {
        throw storageError('PAPER_STORAGE_CONFLICT', 'Paper review identity conflicts.');
      }
      return stored;
    } catch (error) {
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper review persistence failed.', error);
    }
  }

  async getReview(id: string): Promise<PaperReviewReport | undefined> {
    const normalized = reviewId(id);
    try {
      const result = await this.#pool.query(
        `SELECT id, experiment_id, snapshot_id, report_hash, report, as_of
         FROM paper_review_reports WHERE id = $1`,
        [normalized],
      );
      return result.rows[0] === undefined ? undefined : reviewFromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper review read failed.', error);
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: PaperSimulationStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
           to_regclass('public.paper_experiments')::text AS experiment_table,
           to_regclass('public.paper_experiment_commands')::text AS command_table,
           to_regclass('public.paper_experiment_events')::text AS event_table,
           to_regclass('public.paper_notification_outbox')::text AS outbox_table,
           to_regclass('public.paper_review_reports')::text AS review_table,
           EXISTS (SELECT 1 FROM schema_migrations WHERE version = '042_paper_simulation') AS ledger_migration_applied,
           EXISTS (SELECT 1 FROM schema_migrations WHERE version = '043_paper_reviews') AS review_migration_applied`,
      );
      const row = result.rows[0];
      if (
        row?.experiment_table !== 'paper_experiments' ||
        row.command_table !== 'paper_experiment_commands' ||
        row.event_table !== 'paper_experiment_events' ||
        row.outbox_table !== 'paper_notification_outbox' ||
        row.review_table !== 'paper_review_reports' ||
        row.ledger_migration_applied !== true ||
        row.review_migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'PAPER_STORAGE_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'PAPER_STORAGE_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
