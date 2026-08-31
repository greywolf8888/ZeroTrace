import { Pool } from 'pg';

import {
  commitSearchPage,
  newSearchWindow,
  type PageReceipt,
  type SearchWindow,
} from '@zerotrace/capture-scheduler';
import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import type {
  ExternalContentRecord,
  ExternalContentTombstone,
  SearchPage,
  SocialSourceTemporalContract,
} from '@zerotrace/provider-plane';
import {
  finishRequest,
  parseProcurementState,
  parseSpendPolicy,
  tombstoneExternalContent,
} from '@zerotrace/provider-plane';

export type SocialObservationLedger = 'EVM' | 'SOLANA';

export interface SocialObservationRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

interface SocialObservationClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

export interface SocialObservationPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  connect(): Promise<SocialObservationClient>;
  end(): Promise<void>;
}

interface InternalOptions {
  pool: SocialObservationPool;
}

export interface CreateSocialObservationWindowInput {
  ledger: SocialObservationLedger;
  chainId: string;
  assetKey: string;
  queryRole: string;
  approvedQuery: string;
  providerId: string;
  queryVersion: string;
  contractVersion: string;
  temporalContract: SocialSourceTemporalContract;
  contentPolicyVersion: string;
  rightsEvidenceIds: readonly string[];
  from: string;
  until: string;
  pageSize: number;
}

export interface SocialObservationWindowRecord {
  window: SearchWindow;
  ledger: SocialObservationLedger;
  chainId: string;
  assetKey: string;
  queryRole: string;
  approvedQuery: string;
  pageSize: number;
  temporalContract: SocialSourceTemporalContract;
  contentPolicyVersion: string;
  rightsEvidenceIds: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface SocialObservationPageCommit {
  windowId: string;
  procurementRequestId: string;
  page: SearchPage;
  records: readonly ExternalContentRecord[];
  evidenceIds: readonly string[];
  settlement: {
    scopeId: string;
    units: string;
    microusd: string;
  };
}

export interface SocialObservationPageReceipt {
  receiptId: string;
  windowId: string;
  pageRevision: number;
  requestedCursor: string | null;
  nextCursor: string | null;
  recordsPersisted: number;
  normalizedPageHash: string;
  evidenceIds: readonly string[];
  procurementRequestId: string;
  createdAt: string;
}

export interface SocialObservationWindowListCursor {
  updatedAt: string;
  windowId: string;
}

export interface SocialObservationWindowListPage {
  records: SocialObservationWindowRecord[];
  nextCursor: SocialObservationWindowListCursor | null;
}

export interface StoredSocialObservation {
  ledger: SocialObservationLedger;
  chainId: string;
  record: ExternalContentRecord | ExternalContentTombstone;
  evidenceId: string;
  revision: number;
  firstObservedAt: string;
  lastObservedAt: string;
  updatedAt: string;
}

export type SocialObservationStorageErrorCode =
  | 'SOCIAL_OBSERVATION_UNAVAILABLE'
  | 'SOCIAL_OBSERVATION_NOT_INITIALIZED'
  | 'SOCIAL_OBSERVATION_NOT_FOUND'
  | 'SOCIAL_OBSERVATION_CONFLICT'
  | 'SOCIAL_OBSERVATION_INVALID';

export class SocialObservationStorageError extends Error {
  readonly code: SocialObservationStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: SocialObservationStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SocialObservationStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

function pool(options: SocialObservationRepositoryOptions): SocialObservationPool {
  let url: URL;
  try {
    url = new URL(options.connectionString);
  } catch (error) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_NOT_INITIALIZED',
      'Social observation PostgreSQL URL is invalid.',
      { cause: error },
    );
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_NOT_INITIALIZED',
      'Social observations require PostgreSQL.',
    );
  }
  const database = new Pool({
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 30_000,
    max: options.maxConnections ?? 4,
    application_name: 'zerotrace-social-observations',
  });
  return {
    query: (text, values) => database.query(text, values as unknown[] | undefined),
    connect: async () => {
      const client = await database.connect();
      return {
        query: (text, values) => client.query(text, values as unknown[] | undefined),
        release: () => client.release(),
      };
    },
    end: () => database.end(),
  };
}

function string(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      `Stored social observation ${field} is invalid.`,
    );
  }
  return value;
}

function nullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null) return null;
  return string(row, field);
}

function integer(row: Record<string, unknown>, field: string): number {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      `Stored social observation ${field} is invalid.`,
    );
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      `Stored social observation ${field} is invalid.`,
    );
  }
  return date.toISOString();
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      `Stored social observation ${field} is invalid.`,
    );
  }
  return value as string[];
}

function jsonArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      `Stored social observation ${field} is invalid.`,
    );
  }
  return value;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      `Stored social observation ${field} is invalid.`,
    );
  }
  return value as Record<string, unknown>;
}

function validTemporalContract(value: unknown): value is SocialSourceTemporalContract {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const contract = value as Record<string, unknown>;
  return (
    typeof contract.sinceParameter === 'string' &&
    /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(contract.sinceParameter) &&
    typeof contract.untilParameter === 'string' &&
    /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(contract.untilParameter) &&
    contract.sinceParameter !== contract.untilParameter &&
    ['INSTANT', 'UTC_DATE'].includes(String(contract.precision)) &&
    ['EXCLUSIVE', 'INCLUSIVE'].includes(String(contract.untilMode)) &&
    Number.isSafeInteger(contract.overlapSeconds) &&
    Number(contract.overlapSeconds) >= 0 &&
    Number(contract.overlapSeconds) <= 604_800
  );
}

function temporalContract(value: unknown): SocialSourceTemporalContract {
  if (!validTemporalContract(value)) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      'Stored social observation temporal contract is invalid.',
    );
  }
  return {
    sinceParameter: value.sinceParameter,
    untilParameter: value.untilParameter,
    precision: value.precision,
    untilMode: value.untilMode,
    overlapSeconds: value.overlapSeconds,
  };
}

function optionalNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      `Stored social observation ${field} is invalid.`,
    );
  }
  return value;
}

function externalContentRecord(value: unknown): ExternalContentRecord | ExternalContentTombstone {
  const payload = object(value, 'payload');
  const state = payload.state;
  const upstreamGroup = payload.upstreamGroup;
  const sourceId = payload.sourceId;
  const postId = payload.postId;
  const contentHash = payload.contentHash;
  const policyVersion = payload.policyVersion;
  if (
    upstreamGroup !== 'X' ||
    typeof sourceId !== 'string' ||
    sourceId.length === 0 ||
    typeof postId !== 'string' ||
    postId.length === 0 ||
    typeof contentHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(contentHash) ||
    typeof policyVersion !== 'string' ||
    policyVersion.length === 0
  ) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      'Stored social observation payload identity is invalid.',
    );
  }
  if (state === 'ACTIVE') {
    const text = optionalNullableString(payload.text, 'payload.text');
    const contractVersion = payload.contractVersion;
    const rightsEvidenceIds = stringArray(payload.rightsEvidenceIds, 'payload.rightsEvidenceIds');
    if (
      typeof contractVersion !== 'string' ||
      contractVersion.length === 0 ||
      rightsEvidenceIds.length === 0
    ) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_CONFLICT',
        'Stored active social observation policy is invalid.',
      );
    }
    return {
      state,
      sourceId,
      upstreamGroup,
      postId,
      text,
      contentHash,
      createdAt: timestamp(payload.createdAt, 'payload.createdAt'),
      observedAt: timestamp(payload.observedAt, 'payload.observedAt'),
      deletionCheckedAt: timestamp(payload.deletionCheckedAt, 'payload.deletionCheckedAt'),
      retainUntil:
        payload.retainUntil === null ? null : timestamp(payload.retainUntil, 'payload.retainUntil'),
      policyVersion,
      contractVersion,
      rightsEvidenceIds,
    };
  }
  if (state === 'TOMBSTONED') {
    const reason = payload.reason;
    if (
      !['UPSTREAM_DELETED', 'RIGHTS_REVOKED', 'RETENTION_EXPIRED', 'ANALYST_REQUEST'].includes(
        String(reason),
      ) ||
      'text' in payload
    ) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_CONFLICT',
        'Stored social observation tombstone is invalid.',
      );
    }
    return {
      state,
      sourceId,
      upstreamGroup,
      postId,
      contentHash,
      deletedAt: timestamp(payload.deletedAt, 'payload.deletedAt'),
      reason: reason as ExternalContentTombstone['reason'],
      policyVersion,
      evidenceIds: stringArray(payload.evidenceIds, 'payload.evidenceIds'),
    };
  }
  throw new SocialObservationStorageError(
    'SOCIAL_OBSERVATION_CONFLICT',
    'Stored social observation payload state is invalid.',
  );
}

function rowToObservation(row: Record<string, unknown>): StoredSocialObservation {
  const ledger = string(row, 'ledger');
  if (ledger !== 'EVM' && ledger !== 'SOLANA') {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      'Stored social observation ledger is invalid.',
    );
  }
  const record = externalContentRecord(row.payload);
  if (
    record.sourceId !== string(row, 'source_id') ||
    record.postId !== string(row, 'post_id') ||
    record.state !== string(row, 'state') ||
    record.contentHash !== string(row, 'content_hash') ||
    record.policyVersion !== string(row, 'policy_version')
  ) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      'Stored social observation row conflicts with its payload.',
    );
  }
  return {
    ledger,
    chainId: string(row, 'chain_id'),
    record,
    evidenceId: string(row, 'evidence_id'),
    revision: integer(row, 'revision'),
    firstObservedAt: timestamp(row.first_observed_at, 'first_observed_at'),
    lastObservedAt: timestamp(row.last_observed_at, 'last_observed_at'),
    updatedAt: timestamp(row.updated_at, 'updated_at'),
  };
}

function auditPayload(record: ExternalContentRecord | ExternalContentTombstone) {
  if (record.state === 'TOMBSTONED') return record;
  return {
    state: record.state,
    sourceId: record.sourceId,
    upstreamGroup: record.upstreamGroup,
    postId: record.postId,
    contentHash: record.contentHash,
    createdAt: record.createdAt,
    observedAt: record.observedAt,
    deletionCheckedAt: record.deletionCheckedAt,
    retainUntil: record.retainUntil,
    policyVersion: record.policyVersion,
    contractVersion: record.contractVersion,
    rightsEvidenceIds: record.rightsEvidenceIds,
    textRetainedInMutableCurrentRecord: record.text !== null,
  };
}

function rowToWindow(row: Record<string, unknown>): SocialObservationWindowRecord {
  const ledger = string(row, 'ledger');
  if (ledger !== 'EVM' && ledger !== 'SOLANA') {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      'Stored social observation ledger is invalid.',
    );
  }
  const receiptSignatures = jsonArray(row.receipt_signatures, 'receipt_signatures').map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      Array.isArray(item) ||
      typeof (item as Record<string, unknown>).id !== 'string' ||
      typeof (item as Record<string, unknown>).signature !== 'string'
    ) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_CONFLICT',
        'Stored social observation receipt signatures are invalid.',
      );
    }
    const record = item as Record<string, unknown>;
    return {
      id: record.id as string,
      signature: record.signature as string,
    };
  });
  const coverage = string(row, 'coverage');
  if (!['NOT_COMPLETE', 'ACCESSIBLE_QUERY_RESULTS_PROCESSED'].includes(coverage)) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      'Stored social observation coverage is invalid.',
    );
  }
  const record: SocialObservationWindowRecord = {
    window: {
      id: string(row, 'window_id'),
      providerId: string(row, 'provider_id'),
      queryVersion: string(row, 'query_version'),
      contractVersion: string(row, 'contract_version'),
      from: timestamp(row.from_at, 'from_at'),
      until: timestamp(row.until_at, 'until_at'),
      cursor: nullableString(row, 'cursor'),
      completed: row.completed === true,
      pages: integer(row, 'pages'),
      revision: integer(row, 'revision'),
      usedCursors: stringArray(row.used_cursors, 'used_cursors'),
      receiptIds: stringArray(row.receipt_ids, 'receipt_ids'),
      receiptSignatures,
      coverage: coverage as SearchWindow['coverage'],
    },
    ledger,
    chainId: string(row, 'chain_id'),
    assetKey: string(row, 'asset_key'),
    queryRole: string(row, 'query_role'),
    approvedQuery: string(row, 'approved_query'),
    pageSize: integer(row, 'page_size'),
    temporalContract: temporalContract(row.temporal_contract),
    contentPolicyVersion: string(row, 'content_policy_version'),
    rightsEvidenceIds: stringArray(row.rights_evidence_ids, 'rights_evidence_ids'),
    createdAt: timestamp(row.created_at, 'created_at'),
    updatedAt: timestamp(row.updated_at, 'updated_at'),
  };
  if (
    record.window.completed !==
    (record.window.coverage === 'ACCESSIBLE_QUERY_RESULTS_PROCESSED')
  ) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_CONFLICT',
      'Stored social observation completion conflicts with coverage.',
    );
  }
  return record;
}

const SELECT_WINDOW = `
  SELECT * FROM social_observation_windows WHERE window_id = $1
`;

function identity(input: CreateSocialObservationWindowInput): Record<string, unknown> {
  return {
    schema: 'zerotrace-social-observation-window-v1',
    ledger: input.ledger,
    chainId: input.chainId,
    assetKey: input.assetKey,
    queryRole: input.queryRole,
    approvedQuery: input.approvedQuery,
    providerId: input.providerId,
    queryVersion: input.queryVersion,
    contractVersion: input.contractVersion,
    temporalContract: input.temporalContract,
    contentPolicyVersion: input.contentPolicyVersion,
    rightsEvidenceIds: [...new Set(input.rightsEvidenceIds)].sort(),
    from: new Date(input.from).toISOString(),
    until: new Date(input.until).toISOString(),
    pageSize: input.pageSize,
  };
}

function validateCreate(input: CreateSocialObservationWindowInput): void {
  if (
    !input.chainId ||
    !input.assetKey ||
    !input.queryRole ||
    !input.approvedQuery ||
    !input.providerId ||
    !input.queryVersion ||
    !input.contractVersion ||
    !validTemporalContract(input.temporalContract) ||
    !input.contentPolicyVersion ||
    !Number.isSafeInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 1_000 ||
    input.rightsEvidenceIds.length === 0 ||
    input.rightsEvidenceIds.some((id) => !/^ev_[0-9a-f]{24}$/.test(id))
  ) {
    throw new SocialObservationStorageError(
      'SOCIAL_OBSERVATION_INVALID',
      'Social observation window identity is invalid.',
    );
  }
}

function rowToReceipt(row: Record<string, unknown>): SocialObservationPageReceipt {
  return {
    receiptId: string(row, 'receipt_id'),
    windowId: string(row, 'window_id'),
    pageRevision: integer(row, 'page_revision'),
    requestedCursor: nullableString(row, 'requested_cursor'),
    nextCursor: nullableString(row, 'next_cursor'),
    recordsPersisted: integer(row, 'records_persisted'),
    normalizedPageHash: string(row, 'normalized_page_hash'),
    evidenceIds: stringArray(row.evidence_ids, 'evidence_ids'),
    procurementRequestId: string(row, 'procurement_request_id'),
    createdAt: timestamp(row.created_at, 'created_at'),
  };
}

export class PostgresSocialObservationRepository {
  readonly #pool: SocialObservationPool;

  constructor(options: SocialObservationRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : pool(options);
  }

  static fromPool(poolValue: SocialObservationPool): PostgresSocialObservationRepository {
    return new PostgresSocialObservationRepository({ pool: poolValue });
  }

  async create(input: CreateSocialObservationWindowInput): Promise<SocialObservationWindowRecord> {
    validateCreate(input);
    const windowIdentity = identity(input);
    const windowId = `sow_${hashPayload(windowIdentity).slice(0, 24)}`;
    const initial = newSearchWindow({
      id: windowId,
      providerId: input.providerId,
      queryVersion: input.queryVersion,
      contractVersion: input.contractVersion,
      from: input.from,
      until: input.until,
    });
    try {
      await this.#pool.query(
        `
          INSERT INTO social_observation_windows (
            window_id, ledger, chain_id, asset_key, query_role, approved_query,
            provider_id, query_version, contract_version, temporal_contract,
            content_policy_version, rights_evidence_ids, from_at, until_at, page_size, cursor, completed,
            pages, revision, used_cursors, receipt_ids, receipt_signatures, coverage
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::text[], $13, $14, $15,
            $16, $17, $18, $19, $20::jsonb, $21::jsonb, $22::jsonb, $23
          ) ON CONFLICT (window_id) DO NOTHING
        `,
        [
          windowId,
          input.ledger,
          input.chainId,
          input.assetKey,
          input.queryRole,
          input.approvedQuery,
          input.providerId,
          input.queryVersion,
          input.contractVersion,
          canonicalJson(input.temporalContract),
          input.contentPolicyVersion,
          [...new Set(input.rightsEvidenceIds)].sort(),
          initial.from,
          initial.until,
          input.pageSize,
          initial.cursor,
          initial.completed,
          initial.pages,
          initial.revision,
          JSON.stringify(initial.usedCursors),
          JSON.stringify(initial.receiptIds),
          JSON.stringify(initial.receiptSignatures),
          initial.coverage,
        ],
      );
      const stored = await this.get(windowId);
      const storedIdentity = identity({
        ledger: stored.ledger,
        chainId: stored.chainId,
        assetKey: stored.assetKey,
        queryRole: stored.queryRole,
        approvedQuery: stored.approvedQuery,
        providerId: stored.window.providerId,
        queryVersion: stored.window.queryVersion,
        contractVersion: stored.window.contractVersion,
        temporalContract: stored.temporalContract,
        contentPolicyVersion: stored.contentPolicyVersion,
        rightsEvidenceIds: stored.rightsEvidenceIds,
        from: stored.window.from,
        until: stored.window.until,
        pageSize: stored.pageSize,
      });
      if (hashPayload(storedIdentity) !== hashPayload(windowIdentity)) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_CONFLICT',
          'Existing social observation window conflicts with its deterministic identity.',
        );
      }
      return stored;
    } catch (error) {
      if (error instanceof SocialObservationStorageError) throw error;
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_UNAVAILABLE',
        'Durable social observation window could not be created.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(windowId: string): Promise<SocialObservationWindowRecord> {
    try {
      const result = await this.#pool.query(SELECT_WINDOW, [windowId]);
      const row = result.rows[0];
      if (row === undefined) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_NOT_FOUND',
          'Social observation window was not found.',
        );
      }
      return rowToWindow(row);
    } catch (error) {
      if (error instanceof SocialObservationStorageError) throw error;
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_UNAVAILABLE',
        'Durable social observation window is unavailable.',
        { retryable: true, cause: error },
      );
    }
  }

  async list(input: {
    limit: number;
    after?: SocialObservationWindowListCursor;
  }): Promise<SocialObservationWindowListPage> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.after !== undefined &&
        (!/^sow_[0-9a-f]{24}$/.test(input.after.windowId) ||
          !Number.isFinite(Date.parse(input.after.updatedAt))))
    ) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_INVALID',
        'Social observation window list request is invalid.',
      );
    }
    try {
      const result = await this.#pool.query(
        `SELECT * FROM social_observation_windows
         WHERE ($1::timestamptz IS NULL OR (updated_at, window_id) < ($1::timestamptz, $2::text))
         ORDER BY updated_at DESC, window_id DESC
         LIMIT $3`,
        [input.after?.updatedAt ?? null, input.after?.windowId ?? null, input.limit + 1],
      );
      const records = result.rows.slice(0, input.limit).map(rowToWindow);
      const tail = result.rows.length > input.limit ? records.at(-1) : undefined;
      return {
        records,
        nextCursor:
          tail === undefined ? null : { updatedAt: tail.updatedAt, windowId: tail.window.id },
      };
    } catch (error) {
      if (error instanceof SocialObservationStorageError) throw error;
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_UNAVAILABLE',
        'Durable social observation window list is unavailable.',
        { retryable: true, cause: error },
      );
    }
  }

  async receiptForRequest(
    procurementRequestId: string,
  ): Promise<SocialObservationPageReceipt | undefined> {
    try {
      const result = await this.#pool.query(
        `SELECT * FROM social_observation_page_receipts WHERE procurement_request_id = $1`,
        [procurementRequestId],
      );
      return result.rows[0] === undefined ? undefined : rowToReceipt(result.rows[0]);
    } catch (error) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_UNAVAILABLE',
        'Durable social observation receipt is unavailable.',
        { retryable: true, cause: error },
      );
    }
  }

  async getObservation(sourceId: string, postId: string): Promise<StoredSocialObservation> {
    if (!sourceId || !postId) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_INVALID',
        'Social observation identity is invalid.',
      );
    }
    try {
      const result = await this.#pool.query(
        `SELECT * FROM social_observations WHERE source_id = $1 AND post_id = $2`,
        [sourceId, postId],
      );
      if (result.rows[0] === undefined) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_NOT_FOUND',
          'Social observation was not found.',
        );
      }
      return rowToObservation(result.rows[0]);
    } catch (error) {
      if (error instanceof SocialObservationStorageError) throw error;
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_UNAVAILABLE',
        'Durable social observation is unavailable.',
        { retryable: true, cause: error },
      );
    }
  }

  async commitPage(input: SocialObservationPageCommit): Promise<{
    window: SocialObservationWindowRecord;
    receipt: SocialObservationPageReceipt;
  }> {
    if (
      !/^[A-Za-z0-9_:.-]{1,180}$/.test(input.procurementRequestId) ||
      input.records.length !== input.page.posts.length ||
      input.evidenceIds.length !== input.page.posts.length ||
      input.evidenceIds.some((id) => !/^ev_[0-9a-f]{24}$/.test(id)) ||
      !/^[a-z0-9][a-z0-9_.:-]{0,127}$/.test(input.settlement.scopeId) ||
      !/^(0|[1-9][0-9]*)$/.test(input.settlement.units) ||
      !/^(0|[1-9][0-9]*)$/.test(input.settlement.microusd)
    ) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_INVALID',
        'Social observation page commit is invalid.',
      );
    }
    const normalizedPageHash = hashPayload(input.page);
    let client: SocialObservationClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_UNAVAILABLE',
        'Social observation transaction is unavailable.',
        { retryable: true, cause: error },
      );
    }
    try {
      await client.query('BEGIN');
      const selected = await client.query(`${SELECT_WINDOW} FOR UPDATE`, [input.windowId]);
      const row = selected.rows[0];
      if (row === undefined) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_NOT_FOUND',
          'Social observation window was not found.',
        );
      }
      const current = rowToWindow(row);
      const prior = await client.query(
        `SELECT * FROM social_observation_page_receipts WHERE procurement_request_id = $1`,
        [input.procurementRequestId],
      );
      if (prior.rows[0] !== undefined) {
        const receipt = rowToReceipt(prior.rows[0]);
        if (
          receipt.windowId !== input.windowId ||
          receipt.normalizedPageHash !== normalizedPageHash
        ) {
          throw new SocialObservationStorageError(
            'SOCIAL_OBSERVATION_CONFLICT',
            'The idempotency key conflicts with another social observation page.',
          );
        }
        await client.query('COMMIT');
        return { window: current, receipt };
      }
      const receiptId = `sor_${hashPayload({
        schema: 'zerotrace-social-observation-receipt-v1',
        windowId: input.windowId,
        revision: current.window.revision,
        procurementRequestId: input.procurementRequestId,
        normalizedPageHash,
      }).slice(0, 24)}`;
      const receiptInput: PageReceipt = {
        receiptId,
        windowId: input.windowId,
        providerId: current.window.providerId,
        queryVersion: current.window.queryVersion,
        contractVersion: current.window.contractVersion,
        requestedCursor: current.window.cursor,
        nextCursor: input.page.nextCursor,
        recordsPersisted: input.records.length,
        recordsRejected: 0,
        durable: true,
        expectedRevision: current.window.revision,
      };
      const next = commitSearchPage(current.window, receiptInput);
      const procurement = await client.query(
        `SELECT policy, state, revision FROM data_procurement_ledgers
         WHERE scope_id = $1 FOR UPDATE`,
        [input.settlement.scopeId],
      );
      const procurementRow = procurement.rows[0];
      if (procurementRow === undefined) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_NOT_INITIALIZED',
          'Durable data-procurement state is not initialized.',
        );
      }
      const procurementPolicy = parseSpendPolicy(procurementRow.policy);
      const procurementState = parseProcurementState(procurementRow.state);
      if (procurementState.revision !== integer(procurementRow, 'revision')) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_CONFLICT',
          'Durable data-procurement revision conflicts with its state.',
        );
      }
      const settledProcurement = finishRequest(procurementState, input.procurementRequestId, {
        kind: 'CHARGED',
        units: input.settlement.units,
        microusd: input.settlement.microusd,
      });
      for (let index = 0; index < input.page.posts.length; index += 1) {
        const post = input.page.posts[index];
        const record = input.records[index];
        const evidenceId = input.evidenceIds[index];
        if (
          post === undefined ||
          record === undefined ||
          evidenceId === undefined ||
          record.state !== 'ACTIVE' ||
          record.sourceId !== current.window.providerId ||
          record.upstreamGroup !== 'X' ||
          post.sourceId !== current.window.providerId ||
          post.upstreamGroup !== 'X' ||
          record.postId !== post.id ||
          record.createdAt !== post.createdAt ||
          record.observedAt !== post.observedAt ||
          record.contractVersion !== current.window.contractVersion ||
          record.policyVersion !== current.contentPolicyVersion ||
          hashPayload([...record.rightsEvidenceIds].sort()) !==
            hashPayload([...current.rightsEvidenceIds].sort()) ||
          Date.parse(record.createdAt) < Date.parse(current.window.from) ||
          Date.parse(record.createdAt) >= Date.parse(current.window.until) ||
          (record.text !== null && record.text !== post.text)
        ) {
          throw new SocialObservationStorageError(
            'SOCIAL_OBSERVATION_INVALID',
            'Social observation content does not match the normalized page.',
          );
        }
        const evidence = await client.query(
          `SELECT source, evidence_kind FROM evidence WHERE id = $1`,
          [evidenceId],
        );
        const evidenceRow = evidence.rows[0];
        if (
          evidenceRow === undefined ||
          evidenceRow.source !== record.sourceId ||
          evidenceRow.evidence_kind !== 'PROVIDER_OBSERVATION'
        ) {
          throw new SocialObservationStorageError(
            'SOCIAL_OBSERVATION_INVALID',
            'Social observation Evidence does not match the provider observation.',
          );
        }
        const existing = await client.query(
          `SELECT state, content_hash, revision FROM social_observations
           WHERE source_id = $1 AND post_id = $2 FOR UPDATE`,
          [record.sourceId, record.postId],
        );
        const existingRow = existing.rows[0];
        let eventType: 'OBSERVED' | 'EDITED' = 'OBSERVED';
        if (existingRow === undefined) {
          await client.query(
            `INSERT INTO social_observations (
               source_id, post_id, ledger, chain_id, state, content_hash, policy_version,
               contract_version, evidence_id, payload, revision, first_observed_at, last_observed_at
             ) VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8,$9::jsonb,1,$10,$10)`,
            [
              record.sourceId,
              record.postId,
              current.ledger,
              current.chainId,
              record.contentHash,
              record.policyVersion,
              record.contractVersion,
              evidenceId,
              canonicalJson(record),
              record.observedAt,
            ],
          );
        } else {
          if (existingRow.state === 'TOMBSTONED') {
            throw new SocialObservationStorageError(
              'SOCIAL_OBSERVATION_CONFLICT',
              'A tombstoned social observation cannot be silently restored.',
            );
          }
          eventType = existingRow.content_hash === record.contentHash ? 'OBSERVED' : 'EDITED';
          await client.query(
            `UPDATE social_observations SET
               state = 'ACTIVE', content_hash = $3, policy_version = $4, contract_version = $5,
               evidence_id = $6, payload = $7::jsonb, revision = revision + 1,
               last_observed_at = $8, updated_at = now()
             WHERE source_id = $1 AND post_id = $2`,
            [
              record.sourceId,
              record.postId,
              record.contentHash,
              record.policyVersion,
              record.contractVersion,
              evidenceId,
              canonicalJson(record),
              record.observedAt,
            ],
          );
        }
        const eventId = `soe_${hashPayload({
          schema: 'zerotrace-social-observation-event-v1',
          receiptId,
          sourceId: record.sourceId,
          postId: record.postId,
          eventType,
          contentHash: record.contentHash,
          evidenceId,
        }).slice(0, 24)}`;
        await client.query(
          `INSERT INTO social_observation_events (
             event_id, source_id, post_id, event_type, content_hash, evidence_id, payload
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            eventId,
            record.sourceId,
            record.postId,
            eventType,
            record.contentHash,
            evidenceId,
            canonicalJson(auditPayload(record)),
          ],
        );
      }
      const receiptSignature = hashPayload(receiptInput);
      const insertedReceipt = await client.query(
        `INSERT INTO social_observation_page_receipts (
           receipt_id, window_id, page_revision, receipt_signature, requested_cursor, next_cursor,
           records_persisted, records_rejected, normalized_page_hash, evidence_ids,
           procurement_request_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9::text[],$10)
         RETURNING *`,
        [
          receiptId,
          input.windowId,
          current.window.revision,
          receiptSignature,
          current.window.cursor,
          input.page.nextCursor,
          input.records.length,
          normalizedPageHash,
          [...input.evidenceIds],
          input.procurementRequestId,
        ],
      );
      const windowUpdate = await client.query(
        `UPDATE social_observation_windows SET
           cursor = $2, completed = $3, pages = $4, revision = $5,
           used_cursors = $6::jsonb, receipt_ids = $7::jsonb,
           receipt_signatures = $8::jsonb, coverage = $9, updated_at = now()
         WHERE window_id = $1 AND revision = $10`,
        [
          input.windowId,
          next.cursor,
          next.completed,
          next.pages,
          next.revision,
          JSON.stringify(next.usedCursors),
          JSON.stringify(next.receiptIds),
          JSON.stringify(next.receiptSignatures),
          next.coverage,
          current.window.revision,
        ],
      );
      if (windowUpdate.rowCount !== 1) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_CONFLICT',
          'Social observation window lost its revision fence.',
          { retryable: true },
        );
      }
      if (settledProcurement.revision !== procurementState.revision) {
        const procurementUpdate = await client.query(
          `UPDATE data_procurement_ledgers SET state = $2::jsonb, revision = $3, updated_at = now()
           WHERE scope_id = $1 AND revision = $4`,
          [
            input.settlement.scopeId,
            canonicalJson(settledProcurement),
            settledProcurement.revision,
            procurementState.revision,
          ],
        );
        if (procurementUpdate.rowCount !== 1) {
          throw new SocialObservationStorageError(
            'SOCIAL_OBSERVATION_CONFLICT',
            'Data-procurement settlement lost its revision fence.',
            { retryable: true },
          );
        }
      }
      if (!procurementPolicy.version) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_CONFLICT',
          'Durable data-procurement policy version is invalid.',
        );
      }
      const updated = await client.query(SELECT_WINDOW, [input.windowId]);
      if (updated.rows[0] === undefined || insertedReceipt.rows[0] === undefined) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_CONFLICT',
          'Social observation page commit did not return durable state.',
        );
      }
      const result = {
        window: rowToWindow(updated.rows[0]),
        receipt: rowToReceipt(insertedReceipt.rows[0]),
      };
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }
      if (error instanceof SocialObservationStorageError) throw error;
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_CONFLICT',
        error instanceof Error ? error.message : 'Social observation page commit failed.',
        { cause: error },
      );
    } finally {
      client.release();
    }
  }

  async tombstone(input: {
    ledger: SocialObservationLedger;
    chainId: string;
    tombstone: ExternalContentTombstone;
    evidenceId: string;
  }): Promise<void> {
    if (!/^ev_[0-9a-f]{24}$/.test(input.evidenceId)) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_INVALID',
        'Social observation tombstone Evidence is invalid.',
      );
    }
    let client: SocialObservationClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_UNAVAILABLE',
        'Social observation tombstone transaction is unavailable.',
        { retryable: true, cause: error },
      );
    }
    try {
      await client.query('BEGIN');
      const selected = await client.query(
        `SELECT * FROM social_observations WHERE source_id = $1 AND post_id = $2 FOR UPDATE`,
        [input.tombstone.sourceId, input.tombstone.postId],
      );
      const current = selected.rows[0];
      if (current === undefined) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_NOT_FOUND',
          'Social observation to tombstone was not found.',
        );
      }
      if (current.ledger !== input.ledger || current.chain_id !== input.chainId) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_CONFLICT',
          'Social observation tombstone ledger identity conflicts.',
        );
      }
      if (current.state === 'TOMBSTONED') {
        if (canonicalJson(current.payload) !== canonicalJson(input.tombstone)) {
          throw new SocialObservationStorageError(
            'SOCIAL_OBSERVATION_CONFLICT',
            'Social observation already has a conflicting tombstone.',
          );
        }
        await client.query('COMMIT');
        return;
      }
      const active = rowToObservation(current);
      if (active.record.state !== 'ACTIVE') {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_CONFLICT',
          'Social observation active state is invalid.',
        );
      }
      const expected = tombstoneExternalContent(active.record, {
        deletedAt: input.tombstone.deletedAt,
        reason: input.tombstone.reason,
        evidenceIds: input.tombstone.evidenceIds,
      });
      if (canonicalJson(expected) !== canonicalJson(input.tombstone)) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_CONFLICT',
          'Social observation tombstone does not match the active observation.',
        );
      }
      const evidence = await client.query(
        `SELECT source, evidence_kind FROM evidence WHERE id = $1`,
        [input.evidenceId],
      );
      const evidenceRow = evidence.rows[0];
      const expectedEvidenceKind =
        input.tombstone.reason === 'ANALYST_REQUEST'
          ? 'ANALYST_OBSERVATION'
          : 'PROVIDER_OBSERVATION';
      if (
        evidenceRow === undefined ||
        evidenceRow.source !== input.tombstone.sourceId ||
        evidenceRow.evidence_kind !== expectedEvidenceKind
      ) {
        throw new SocialObservationStorageError(
          'SOCIAL_OBSERVATION_INVALID',
          'Social observation tombstone Evidence does not match the provider observation.',
        );
      }
      await client.query(
        `UPDATE social_observations SET
           state = 'TOMBSTONED', content_hash = $3, policy_version = $4,
           evidence_id = $5, payload = $6::jsonb, revision = revision + 1,
           last_observed_at = $7, updated_at = now()
         WHERE source_id = $1 AND post_id = $2`,
        [
          input.tombstone.sourceId,
          input.tombstone.postId,
          input.tombstone.contentHash,
          input.tombstone.policyVersion,
          input.evidenceId,
          canonicalJson(input.tombstone),
          input.tombstone.deletedAt,
        ],
      );
      const eventId = `soe_${hashPayload({
        schema: 'zerotrace-social-observation-event-v1',
        tombstone: input.tombstone,
        evidenceId: input.evidenceId,
      }).slice(0, 24)}`;
      await client.query(
        `INSERT INTO social_observation_events (
           event_id, source_id, post_id, event_type, content_hash, evidence_id, payload
         ) VALUES ($1,$2,$3,'TOMBSTONED',$4,$5,$6::jsonb)`,
        [
          eventId,
          input.tombstone.sourceId,
          input.tombstone.postId,
          input.tombstone.contentHash,
          input.evidenceId,
          canonicalJson(input.tombstone),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }
      if (error instanceof SocialObservationStorageError) throw error;
      throw new SocialObservationStorageError(
        'SOCIAL_OBSERVATION_CONFLICT',
        error instanceof Error ? error.message : 'Social observation tombstone failed.',
        { cause: error },
      );
    } finally {
      client.release();
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: SocialObservationStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(`
        SELECT
          to_regclass('public.social_observation_windows')::text AS windows,
          to_regclass('public.social_observations')::text AS observations,
          EXISTS (
            SELECT 1 FROM schema_migrations WHERE version = '046_social_observation_windows'
          ) AS migrated
      `);
      const row = result.rows[0];
      return row?.windows === 'social_observation_windows' &&
        row.observations === 'social_observations' &&
        row.migrated === true
        ? { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt }
        : {
            status: 'DOWN',
            backend: 'POSTGRES',
            durable: true,
            checkedAt,
            errorCode: 'SOCIAL_OBSERVATION_NOT_INITIALIZED',
          };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'SOCIAL_OBSERVATION_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
