import { Pool } from 'pg';
import { createHash, randomBytes } from 'node:crypto';

import {
  applyPaperCommand,
  type PaperCommand,
  type PaperEvent,
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

export type PaperNotificationChannel = 'IN_APP' | 'DESKTOP';
export type PaperNotificationDeliveryState = 'PENDING' | 'LEASED' | 'DELIVERED' | 'DISPATCHED';

export interface PaperNotificationDelivery {
  outboxId: string;
  experimentId: string;
  channel: PaperNotificationChannel;
  state: PaperNotificationDeliveryState;
  attemptCount: number;
  nextAttemptAt: string;
  leaseExpiresAt: string | null;
  deliveredAt: string | null;
  dispatchedAt: string | null;
  readAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaperNotificationView {
  record: PaperOutboxRecord;
  channels: PaperNotificationDelivery[];
}

export interface ClaimedPaperNotification {
  record: PaperOutboxRecord;
  event: PaperEvent;
  delivery: PaperNotificationDelivery;
  leaseToken: string;
}

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

function optionalTimestamp(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : timestamp(value, field);
}

function safeInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw storageError('PAPER_STORAGE_CONFLICT', `Stored ${field} is invalid.`);
  }
  return parsed;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function actorHash(actor: string): string {
  const normalized = actor.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    throw storageError('PAPER_STORAGE_INVALID', 'Paper notification actor is invalid.');
  }
  return sha256(`zerotrace-paper-notification-actor\0${normalized}`);
}

function errorCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(normalized)) {
    throw storageError('PAPER_STORAGE_INVALID', 'Paper notification error code is invalid.');
  }
  return normalized;
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
  const { payloadHash } = record;
  const hashablePayload: Partial<PaperOutboxRecord> = { ...record };
  delete hashablePayload.id;
  delete hashablePayload.payloadHash;
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

function paperEventFromRow(row: Record<string, unknown>): PaperEvent {
  const payload = json(row.event_payload, 'paper notification event');
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper notification event is invalid.');
  }
  const event = payload as PaperEvent;
  if (
    !/^pev_[0-9a-f]{24}$/.test(event.id) ||
    event.id !== stringValue(row.event_id, 'paper notification event ID') ||
    !Array.isArray(event.reasons) ||
    !Array.isArray(event.evidenceIds) ||
    (event.chain !== 'BSC' && event.chain !== 'SOLANA')
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper notification event conflicts.');
  }
  return structuredClone(event);
}

function notificationDeliveryFromRow(row: Record<string, unknown>): PaperNotificationDelivery {
  const channel = stringValue(row.channel, 'paper notification channel');
  const state = stringValue(row.state, 'paper notification delivery state');
  if (
    (channel !== 'IN_APP' && channel !== 'DESKTOP') ||
    !(['PENDING', 'LEASED', 'DELIVERED', 'DISPATCHED'] as const).includes(
      state as PaperNotificationDeliveryState,
    )
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper notification state is invalid.');
  }
  const leaseExpiresAt = optionalTimestamp(row.lease_expires_at, 'paper notification lease expiry');
  const leaseTokenHash =
    row.lease_token_hash === undefined || row.lease_token_hash === null
      ? null
      : stringValue(row.lease_token_hash, 'paper notification lease token hash');
  const leaseOwnerHash =
    row.lease_owner_hash === undefined || row.lease_owner_hash === null
      ? null
      : stringValue(row.lease_owner_hash, 'paper notification lease owner hash');
  const deliveredAt = optionalTimestamp(row.delivered_at, 'paper notification deliveredAt');
  const dispatchedAt = optionalTimestamp(row.dispatched_at, 'paper notification dispatchedAt');
  const readAt = optionalTimestamp(row.read_at, 'paper notification readAt');
  const lastErrorCode =
    row.last_error_code === undefined || row.last_error_code === null
      ? null
      : stringValue(row.last_error_code, 'paper notification error code');
  if (
    (state === 'LEASED') !==
      (leaseExpiresAt !== null &&
        leaseTokenHash !== null &&
        leaseOwnerHash !== null &&
        /^[0-9a-f]{64}$/.test(leaseTokenHash) &&
        /^[0-9a-f]{64}$/.test(leaseOwnerHash)) ||
    (state !== 'LEASED' && (leaseTokenHash !== null || leaseOwnerHash !== null)) ||
    (channel === 'IN_APP' && (state !== 'DELIVERED' || deliveredAt === null)) ||
    (channel === 'DESKTOP' && (deliveredAt !== null || readAt !== null || state === 'DELIVERED')) ||
    (state === 'DISPATCHED') !== (dispatchedAt !== null) ||
    (lastErrorCode !== null && !/^[A-Z][A-Z0-9_]{0,127}$/.test(lastErrorCode))
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper notification envelope conflicts.');
  }
  const storedOutboxId = stringValue(row.outbox_id, 'paper notification outbox ID');
  const storedExperimentId = stringValue(row.experiment_id, 'paper notification experiment ID');
  if (
    !/^pob_[0-9a-f]{24}$/.test(storedOutboxId) ||
    !/^pex_[0-9a-f]{24}$/.test(storedExperimentId)
  ) {
    throw storageError('PAPER_STORAGE_CONFLICT', 'Stored paper notification identity is invalid.');
  }
  return {
    outboxId: storedOutboxId,
    experimentId: storedExperimentId,
    channel,
    state: state as PaperNotificationDeliveryState,
    attemptCount: safeInteger(row.attempt_count, 'paper notification attempt count'),
    nextAttemptAt: timestamp(row.next_attempt_at, 'paper notification next attempt'),
    leaseExpiresAt,
    deliveredAt,
    dispatchedAt,
    readAt,
    lastErrorCode,
    createdAt: timestamp(row.delivery_created_at ?? row.created_at, 'paper notification createdAt'),
    updatedAt: timestamp(row.delivery_updated_at ?? row.updated_at, 'paper notification updatedAt'),
  };
}

const SELECT_NOTIFICATION_DELIVERY = `
  SELECT outbox_id, experiment_id, channel, state, attempt_count, lease_token_hash,
         lease_owner_hash, lease_expires_at, next_attempt_at, delivered_at,
         dispatched_at, read_at, last_error_code,
         created_at AS delivery_created_at, updated_at AS delivery_updated_at
  FROM paper_notification_delivery_state
`;

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

  async listNotifications(input: {
    experimentId: string;
    after?: string;
    limit?: number;
  }): Promise<{ records: PaperNotificationView[]; nextCursor: string | null }> {
    const page = await this.listOutbox(input);
    if (page.records.length === 0) return { records: [], nextCursor: page.nextCursor };
    try {
      const result = await this.#pool.query(
        `${SELECT_NOTIFICATION_DELIVERY}
         WHERE experiment_id = $1 AND outbox_id = ANY($2::text[])
         ORDER BY outbox_id ASC, channel ASC`,
        [input.experimentId, page.records.map((record) => record.id)],
      );
      const deliveryByOutbox = new Map<string, PaperNotificationDelivery[]>();
      for (const row of result.rows) {
        const delivery = notificationDeliveryFromRow(row);
        const current = deliveryByOutbox.get(delivery.outboxId) ?? [];
        current.push(delivery);
        deliveryByOutbox.set(delivery.outboxId, current);
      }
      const records = page.records.map((record) => {
        const channels = deliveryByOutbox.get(record.id) ?? [];
        if (
          channels.length !== 2 ||
          channels.some((delivery) => delivery.experimentId !== input.experimentId) ||
          !channels.some((delivery) => delivery.channel === 'IN_APP') ||
          !channels.some((delivery) => delivery.channel === 'DESKTOP')
        ) {
          throw storageError(
            'PAPER_STORAGE_CONFLICT',
            'Paper notification delivery channels are incomplete.',
          );
        }
        return { record, channels };
      });
      return { records, nextCursor: page.nextCursor };
    } catch (error) {
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper notification page failed.', error);
    }
  }

  async claimDesktopNotifications(input: {
    experimentId: string;
    actor: string;
    limit?: number;
    leaseDurationMs?: number;
    now?: string;
  }): Promise<ClaimedPaperNotification[]> {
    const id = experimentId(input.experimentId);
    const owner = actorHash(input.actor);
    const limit = input.limit ?? 20;
    const leaseDurationMs = input.leaseDurationMs ?? 30_000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw storageError('PAPER_STORAGE_INVALID', 'Paper notification claim limit is invalid.');
    }
    if (
      !Number.isSafeInteger(leaseDurationMs) ||
      leaseDurationMs < 5_000 ||
      leaseDurationMs > 300_000
    ) {
      throw storageError('PAPER_STORAGE_INVALID', 'Paper notification lease duration is invalid.');
    }
    const now = input.now === undefined ? new Date() : new Date(input.now);
    if (Number.isNaN(now.getTime())) {
      throw storageError('PAPER_STORAGE_INVALID', 'Paper notification claim time is invalid.');
    }
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
    const client = await this.#pool.connect().catch((error: unknown) => {
      throw storageError(
        'PAPER_STORAGE_UNAVAILABLE',
        'Paper notification claim connection failed.',
        error,
      );
    });
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const selected = await client.query(
        `SELECT outbox.id, outbox.business_key, outbox.event_id, outbox.event_type,
                outbox.urgency, outbox.delivery_state, outbox.payload_hash,
                outbox.payload, outbox.created_at,
                event.payload AS event_payload,
                delivery.outbox_id, delivery.experiment_id, delivery.channel, delivery.state,
                delivery.attempt_count, delivery.lease_token_hash,
                delivery.lease_owner_hash, delivery.lease_expires_at,
                delivery.next_attempt_at, delivery.delivered_at, delivery.dispatched_at,
                delivery.read_at, delivery.last_error_code,
                delivery.created_at AS delivery_created_at,
                delivery.updated_at AS delivery_updated_at
         FROM paper_notification_delivery_state AS delivery
         JOIN paper_notification_outbox AS outbox ON outbox.id = delivery.outbox_id
         JOIN paper_experiment_events AS event ON event.id = outbox.event_id
         WHERE delivery.experiment_id = $1
           AND delivery.channel = 'DESKTOP'
           AND (
             (delivery.state = 'PENDING' AND delivery.next_attempt_at <= $2::timestamptz)
             OR
             (delivery.state = 'LEASED' AND delivery.lease_expires_at <= $2::timestamptz)
           )
         ORDER BY CASE WHEN outbox.urgency = 'URGENT' THEN 0 ELSE 1 END,
                  outbox.created_at ASC, outbox.id ASC
         LIMIT $3
         FOR UPDATE OF delivery SKIP LOCKED`,
        [id, nowIso, limit],
      );
      const claimed: ClaimedPaperNotification[] = [];
      for (const row of selected.rows) {
        const outbox = outboxFromRow(row);
        const event = paperEventFromRow(row);
        const previousAttempt = safeInteger(row.attempt_count, 'paper notification attempt count');
        if (row.state === 'LEASED') {
          await client.query(
            `INSERT INTO paper_notification_delivery_events (
              outbox_id, channel, experiment_id, event_type, attempt_number,
              lease_token_hash, actor_hash, event_at
            ) VALUES ($1, 'DESKTOP', $2, 'LEASE_EXPIRED', $3, $4, $5, $6::timestamptz)`,
            [outbox.id, id, previousAttempt, row.lease_token_hash, row.lease_owner_hash, nowIso],
          );
        }
        const leaseToken = randomBytes(32).toString('hex');
        const leaseTokenHash = sha256(leaseToken);
        const updated = await client.query(
          `UPDATE paper_notification_delivery_state
           SET state = 'LEASED', attempt_count = attempt_count + 1,
               lease_token_hash = $1, lease_owner_hash = $2,
               lease_expires_at = $3::timestamptz, updated_at = $4::timestamptz
           WHERE outbox_id = $5 AND channel = 'DESKTOP'
           RETURNING outbox_id, experiment_id, channel, state, attempt_count,
                     lease_token_hash, lease_owner_hash, lease_expires_at,
                     next_attempt_at, delivered_at, dispatched_at,
                     read_at, last_error_code, created_at AS delivery_created_at,
                     updated_at AS delivery_updated_at`,
          [leaseTokenHash, owner, leaseExpiresAt, nowIso, outbox.id],
        );
        const deliveryRow = updated.rows[0];
        if (updated.rowCount !== 1 || deliveryRow === undefined) {
          throw storageError('PAPER_STORAGE_CONFLICT', 'Paper notification claim fence failed.');
        }
        const delivery = notificationDeliveryFromRow(deliveryRow);
        await client.query(
          `INSERT INTO paper_notification_delivery_events (
            outbox_id, channel, experiment_id, event_type, attempt_number,
            lease_token_hash, actor_hash, event_at
          ) VALUES ($1, 'DESKTOP', $2, 'CLAIMED', $3, $4, $5, $6::timestamptz)`,
          [outbox.id, id, delivery.attemptCount, leaseTokenHash, owner, nowIso],
        );
        claimed.push({ record: outbox, event, delivery, leaseToken });
      }
      await client.query('COMMIT');
      return claimed;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper notification claim failed.', error);
    } finally {
      client.release();
    }
  }

  async settleDesktopNotification(input: {
    experimentId: string;
    outboxId: string;
    actor: string;
    leaseToken: string;
    outcome: 'DISPATCHED' | 'FAILED';
    errorCode?: string;
    now?: string;
  }): Promise<PaperNotificationDelivery> {
    const id = experimentId(input.experimentId);
    const notificationId = outboxId(input.outboxId);
    const owner = actorHash(input.actor);
    if (!/^[0-9a-f]{64}$/.test(input.leaseToken)) {
      throw storageError('PAPER_STORAGE_INVALID', 'Paper notification lease token is invalid.');
    }
    if (input.outcome === 'FAILED' && input.errorCode === undefined) {
      throw storageError('PAPER_STORAGE_INVALID', 'Paper notification failure code is required.');
    }
    if (input.outcome === 'DISPATCHED' && input.errorCode !== undefined) {
      throw storageError(
        'PAPER_STORAGE_INVALID',
        'A dispatched paper notification cannot carry a failure code.',
      );
    }
    const failureCode = input.errorCode === undefined ? undefined : errorCode(input.errorCode);
    const tokenHash = sha256(input.leaseToken);
    const now = input.now === undefined ? new Date() : new Date(input.now);
    if (Number.isNaN(now.getTime())) {
      throw storageError('PAPER_STORAGE_INVALID', 'Paper notification settlement time is invalid.');
    }
    const nowIso = now.toISOString();
    const client = await this.#pool.connect().catch((error: unknown) => {
      throw storageError(
        'PAPER_STORAGE_UNAVAILABLE',
        'Paper notification settlement connection failed.',
        error,
      );
    });
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const selected = await client.query(
        `${SELECT_NOTIFICATION_DELIVERY}
         WHERE experiment_id = $1 AND outbox_id = $2 AND channel = 'DESKTOP'
         FOR UPDATE`,
        [id, notificationId],
      );
      const row = selected.rows[0];
      if (row === undefined) {
        throw storageError('PAPER_STORAGE_NOT_FOUND', 'Paper notification delivery not found.');
      }
      const previous = await client.query(
        `SELECT event_type
         FROM paper_notification_delivery_events
         WHERE outbox_id = $1 AND channel = 'DESKTOP' AND lease_token_hash = $2
           AND event_type IN ('DISPATCHED', 'DELIVERY_FAILED')
         ORDER BY id DESC LIMIT 1`,
        [notificationId, tokenHash],
      );
      const previousType = previous.rows[0]?.event_type;
      const expectedType = input.outcome === 'DISPATCHED' ? 'DISPATCHED' : 'DELIVERY_FAILED';
      if (previousType !== undefined) {
        if (previousType !== expectedType) {
          throw storageError(
            'PAPER_STORAGE_CONFLICT',
            'Paper notification lease was settled with a different outcome.',
          );
        }
        await client.query('COMMIT');
        return notificationDeliveryFromRow(row);
      }
      if (
        row.state !== 'LEASED' ||
        row.lease_token_hash !== tokenHash ||
        row.lease_owner_hash !== owner
      ) {
        throw storageError(
          'PAPER_STORAGE_CONFLICT',
          'Paper notification lease is missing, expired, or owned by another worker.',
        );
      }
      const attempt = safeInteger(row.attempt_count, 'paper notification attempt count');
      let updated: QueryResult;
      if (input.outcome === 'DISPATCHED') {
        updated = await client.query(
          `UPDATE paper_notification_delivery_state
           SET state = 'DISPATCHED', lease_token_hash = NULL, lease_owner_hash = NULL,
               lease_expires_at = NULL, dispatched_at = $1::timestamptz,
               last_error_code = NULL, updated_at = $1::timestamptz
           WHERE outbox_id = $2 AND channel = 'DESKTOP'
           RETURNING outbox_id, experiment_id, channel, state, attempt_count,
                     lease_token_hash, lease_owner_hash, lease_expires_at,
                     next_attempt_at, delivered_at, dispatched_at,
                     read_at, last_error_code, created_at AS delivery_created_at,
                     updated_at AS delivery_updated_at`,
          [nowIso, notificationId],
        );
      } else {
        const delayMs = Math.min(300_000, 1_000 * 2 ** Math.min(attempt - 1, 8));
        const nextAttemptAt = new Date(now.getTime() + delayMs).toISOString();
        updated = await client.query(
          `UPDATE paper_notification_delivery_state
           SET state = 'PENDING', lease_token_hash = NULL, lease_owner_hash = NULL,
               lease_expires_at = NULL, next_attempt_at = $1::timestamptz,
               last_error_code = $2, updated_at = $3::timestamptz
           WHERE outbox_id = $4 AND channel = 'DESKTOP'
           RETURNING outbox_id, experiment_id, channel, state, attempt_count,
                     lease_token_hash, lease_owner_hash, lease_expires_at,
                     next_attempt_at, delivered_at, dispatched_at,
                     read_at, last_error_code, created_at AS delivery_created_at,
                     updated_at AS delivery_updated_at`,
          [nextAttemptAt, failureCode, nowIso, notificationId],
        );
      }
      const updatedRow = updated.rows[0];
      if (updated.rowCount !== 1 || updatedRow === undefined) {
        throw storageError('PAPER_STORAGE_CONFLICT', 'Paper notification settlement fence failed.');
      }
      await client.query(
        `INSERT INTO paper_notification_delivery_events (
          outbox_id, channel, experiment_id, event_type, attempt_number,
          lease_token_hash, actor_hash, error_code, event_at
        ) VALUES ($1, 'DESKTOP', $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
        [notificationId, id, expectedType, attempt, tokenHash, owner, failureCode ?? null, nowIso],
      );
      await client.query('COMMIT');
      return notificationDeliveryFromRow(updatedRow);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError(
        'PAPER_STORAGE_UNAVAILABLE',
        'Paper notification settlement failed.',
        error,
      );
    } finally {
      client.release();
    }
  }

  async markInAppNotificationRead(input: {
    experimentId: string;
    outboxId: string;
    actor: string;
    now?: string;
  }): Promise<PaperNotificationDelivery> {
    const id = experimentId(input.experimentId);
    const notificationId = outboxId(input.outboxId);
    const reader = actorHash(input.actor);
    const now = input.now === undefined ? new Date() : new Date(input.now);
    if (Number.isNaN(now.getTime())) {
      throw storageError('PAPER_STORAGE_INVALID', 'Paper notification read time is invalid.');
    }
    const nowIso = now.toISOString();
    const client = await this.#pool.connect().catch((error: unknown) => {
      throw storageError(
        'PAPER_STORAGE_UNAVAILABLE',
        'Paper notification read connection failed.',
        error,
      );
    });
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const selected = await client.query(
        `${SELECT_NOTIFICATION_DELIVERY}
         WHERE experiment_id = $1 AND outbox_id = $2 AND channel = 'IN_APP'
         FOR UPDATE`,
        [id, notificationId],
      );
      const row = selected.rows[0];
      if (row === undefined) {
        throw storageError('PAPER_STORAGE_NOT_FOUND', 'Paper notification delivery not found.');
      }
      if (row.read_at !== undefined && row.read_at !== null) {
        await client.query('COMMIT');
        return notificationDeliveryFromRow(row);
      }
      const updated = await client.query(
        `UPDATE paper_notification_delivery_state
         SET read_at = $1::timestamptz, updated_at = $1::timestamptz
         WHERE outbox_id = $2 AND channel = 'IN_APP'
         RETURNING outbox_id, experiment_id, channel, state, attempt_count,
                   lease_token_hash, lease_owner_hash, lease_expires_at,
                   next_attempt_at, delivered_at, dispatched_at,
                   read_at, last_error_code, created_at AS delivery_created_at,
                   updated_at AS delivery_updated_at`,
        [nowIso, notificationId],
      );
      const updatedRow = updated.rows[0];
      if (updated.rowCount !== 1 || updatedRow === undefined) {
        throw storageError('PAPER_STORAGE_CONFLICT', 'Paper notification read fence failed.');
      }
      await client.query(
        `INSERT INTO paper_notification_delivery_events (
          outbox_id, channel, experiment_id, event_type, attempt_number, actor_hash, event_at
        ) VALUES ($1, 'IN_APP', $2, 'READ', 0, $3, $4::timestamptz)`,
        [notificationId, id, reader, nowIso],
      );
      await client.query('COMMIT');
      return notificationDeliveryFromRow(updatedRow);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof PaperSimulationStorageError) throw error;
      throw storageError('PAPER_STORAGE_UNAVAILABLE', 'Paper notification read failed.', error);
    } finally {
      client.release();
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
           to_regclass('public.paper_notification_delivery_state')::text AS delivery_table,
           to_regclass('public.paper_notification_delivery_events')::text AS delivery_event_table,
           to_regclass('public.paper_review_reports')::text AS review_table,
           EXISTS (SELECT 1 FROM schema_migrations WHERE version = '042_paper_simulation') AS ledger_migration_applied,
           EXISTS (SELECT 1 FROM schema_migrations WHERE version = '043_paper_reviews') AS review_migration_applied,
           EXISTS (SELECT 1 FROM schema_migrations WHERE version = '045_paper_notification_delivery') AS delivery_migration_applied`,
      );
      const row = result.rows[0];
      if (
        row?.experiment_table !== 'paper_experiments' ||
        row.command_table !== 'paper_experiment_commands' ||
        row.event_table !== 'paper_experiment_events' ||
        row.outbox_table !== 'paper_notification_outbox' ||
        row.delivery_table !== 'paper_notification_delivery_state' ||
        row.delivery_event_table !== 'paper_notification_delivery_events' ||
        row.review_table !== 'paper_review_reports' ||
        row.ledger_migration_applied !== true ||
        row.review_migration_applied !== true ||
        row.delivery_migration_applied !== true
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
