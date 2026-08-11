import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  LabelIntelligenceReportSchema,
  LabelIntelligenceSubjectSchema,
  LabelObservationSchema,
  LedgerSchema,
  SubjectTypeSchema,
  unknownValue,
  knownValue,
  type LabelIntelligenceReport,
  type LabelIntelligenceSubject,
  type LabelObservation,
  type Ledger,
  type SubjectType,
} from '@zerotrace/schemas';

export interface LabelIntelligenceReportRepositoryOptions {
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

export type LabelIntelligenceStorageErrorCode =
  | 'LABEL_INTELLIGENCE_INVALID'
  | 'LABEL_INTELLIGENCE_CONFLICT'
  | 'LABEL_INTELLIGENCE_UNAVAILABLE'
  | 'LABEL_INTELLIGENCE_NOT_INITIALIZED';

export class LabelIntelligenceStorageError extends Error {
  readonly code: LabelIntelligenceStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: LabelIntelligenceStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'LabelIntelligenceStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface RegisteredLabelObservationSet {
  subject: LabelIntelligenceSubject;
  observations: readonly LabelObservation[];
}

export interface StoredLabelIntelligenceReport {
  id: string;
  ledger: Ledger;
  chainId: string;
  subjectId: string;
  subjectType: SubjectType;
  normalizedIdentifier: string;
  labelSnapshotId: string;
  observationSetHash: string;
  resultHash: string;
  report: LabelIntelligenceReport;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: 'label-intelligence-v0.1.0';
  asOf: string;
  createdAt: string;
}

type Materialized = Omit<StoredLabelIntelligenceReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    ledger,
    chain_id,
    subject_id,
    subject_type,
    normalized_identifier,
    label_snapshot_id,
    observation_set_hash,
    result_hash,
    report,
    terminal_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    as_of,
    created_at
  FROM label_intelligence_reports
`;

const SELECT_OBSERVATIONS = `
  SELECT
    subject.id AS subject_id,
    subject.ledger::text AS ledger,
    subject.chain_id,
    subject.subject_type,
    subject.normalized_identifier,
    observation.id AS observation_id,
    observation.source,
    observation.source_class,
    observation.label,
    observation.category,
    observation.actor_candidate,
    observation.source_confidence,
    observation.evidence_id,
    observation.observed_at,
    observation.valid_from,
    observation.valid_to,
    observation.deterministic,
    observation.license_policy,
    observation.raw_payload_hash
  FROM subjects subject
  LEFT JOIN label_observations observation ON observation.subject_id = subject.id
  WHERE subject.ledger = $1::ledger_kind
    AND subject.chain_id = $2
    AND subject.subject_type = $3
    AND (
      ($1::ledger_kind = 'EVM' AND lower(subject.normalized_identifier) = lower($4))
      OR ($1::ledger_kind <> 'EVM' AND subject.normalized_identifier = $4)
    )
  ORDER BY subject.id, observation.id
`;

function createPool(options: LabelIntelligenceReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-label-intelligence-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): LabelIntelligenceStorageError {
  return new LabelIntelligenceStorageError('LABEL_INTELLIGENCE_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): LabelIntelligenceStorageError {
  return new LabelIntelligenceStorageError('LABEL_INTELLIGENCE_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored Label Intelligence ${field} is invalid.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored Label Intelligence ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored Label Intelligence report is not JSON.', error);
  }
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw conflict(`Stored Label Intelligence ${field} is invalid.`);
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw conflict(`Stored Label Intelligence ${field} is not canonical.`);
  }
  return canonical;
}

function ratio(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw conflict(`Stored Label Intelligence ${field} is invalid.`);
  }
  return parsed;
}

function identity(input: {
  ledger: Ledger;
  chainId: string;
  subjectType: SubjectType;
  normalizedIdentifier: string;
}) {
  const ledger = LedgerSchema.safeParse(input.ledger);
  const subjectType = SubjectTypeSchema.safeParse(input.subjectType);
  const chainId = input.chainId.trim();
  const identifier = input.normalizedIdentifier.trim();
  if (
    !ledger.success ||
    !subjectType.success ||
    chainId.length === 0 ||
    chainId.length > 128 ||
    identifier.length === 0 ||
    identifier.length > 512
  ) {
    throw invalid('Label Intelligence Subject identity is invalid.');
  }
  return {
    ledger: ledger.data,
    chainId,
    subjectType: subjectType.data,
    normalizedIdentifier: ledger.data === 'EVM' ? identifier.toLowerCase() : identifier,
  };
}

function observationFromRow(row: Record<string, unknown>): LabelObservation | undefined {
  if (row.observation_id === null || row.observation_id === undefined) return undefined;
  const actorCandidate = optionalString(row.actor_candidate);
  const validFrom =
    row.valid_from === null || row.valid_from === undefined
      ? unknownValue('INSUFFICIENT_DATA', 'This observation has no declared valid-from time.')
      : knownValue(timestamp(row.valid_from, 'validFrom'));
  const validTo =
    row.valid_to === null || row.valid_to === undefined
      ? unknownValue('INSUFFICIENT_DATA', 'This observation has no declared valid-to time.')
      : knownValue(timestamp(row.valid_to, 'validTo'));
  return LabelObservationSchema.parse({
    id: String(row.observation_id),
    subjectId: requiredString(row, 'subject_id'),
    ledger: requiredString(row, 'ledger'),
    chainId: requiredString(row, 'chain_id'),
    subjectType: requiredString(row, 'subject_type'),
    normalizedIdentifier: requiredString(row, 'normalized_identifier'),
    source: requiredString(row, 'source'),
    sourceClass: requiredString(row, 'source_class'),
    label: requiredString(row, 'label'),
    category: requiredString(row, 'category'),
    actorCandidate:
      actorCandidate === undefined
        ? unknownValue('INSUFFICIENT_DATA', 'This observation has no actor candidate.')
        : knownValue(actorCandidate),
    sourceConfidence: ratio(row.source_confidence, 'source confidence'),
    evidenceIds: [requiredString(row, 'evidence_id')],
    observedAt: timestamp(row.observed_at, 'observedAt'),
    validFrom,
    validTo,
    deterministic: row.deterministic,
    licensePolicy: requiredString(row, 'license_policy'),
    rawPayloadHash: requiredString(row, 'raw_payload_hash'),
  });
}

function materialize(input: LabelIntelligenceReport): Materialized {
  const parsed = LabelIntelligenceReportSchema.safeParse(input);
  if (!parsed.success) throw invalid('Label Intelligence report is invalid.', parsed.error);
  const report = parsed.data;
  const resultWithoutTerminal = {
    ...report.result,
    metadata: {
      ...report.result.metadata,
      evidenceIds: report.result.metadata.evidenceIds.filter(
        (evidenceId) => evidenceId !== report.terminalEvidenceId,
      ),
    },
  };
  const terminal = report.evidence.find((item) => item.id === report.terminalEvidenceId);
  if (
    terminal === undefined ||
    terminal.payloadHash !==
      hashPayload({ request: report.result.request, result: resultWithoutTerminal })
  ) {
    throw invalid('Label Intelligence terminal Evidence payload does not match the report.');
  }
  const expectedObservationSetHash = hashPayload({
    schema: 'zerotrace-label-observation-set-v1',
    subject: report.result.subject,
    request: report.result.request,
    observations: report.result.observations
      .map((item) => item.observation)
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
  const expectedSnapshotId = `lss_${hashPayload({
    schema: 'zerotrace-label-snapshot-v1',
    observationSetHash: expectedObservationSetHash,
  }).slice(0, 24)}`;
  if (
    report.result.snapshot.observationSetHash !== expectedObservationSetHash ||
    report.result.snapshot.id !== expectedSnapshotId
  ) {
    throw invalid('Label Intelligence observation Snapshot is not content-addressed correctly.');
  }
  const resultHash = hashPayload(report);
  return {
    id: `lir_${hashPayload({
      schema: 'zerotrace-label-intelligence-report-v1',
      resultHash,
    }).slice(0, 24)}`,
    ledger: report.result.subject.ledger,
    chainId: report.result.subject.chainId,
    subjectId: report.result.subject.id,
    subjectType: report.result.subject.subjectType,
    normalizedIdentifier: report.result.subject.normalizedIdentifier,
    labelSnapshotId: report.result.snapshot.id,
    observationSetHash: report.result.snapshot.observationSetHash,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds: report.result.metadata.evidenceIds,
    sourceSet: report.result.metadata.sourceSet,
    modelVersion: 'label-intelligence-v0.1.0',
    asOf: new Date(report.result.request.asOf).toISOString(),
  };
}

function assertSame(stored: StoredLabelIntelligenceReport, expected: Materialized): void {
  if (
    stored.id !== expected.id ||
    stored.ledger !== expected.ledger ||
    stored.chainId !== expected.chainId ||
    stored.subjectId !== expected.subjectId ||
    stored.subjectType !== expected.subjectType ||
    stored.normalizedIdentifier !== expected.normalizedIdentifier ||
    stored.labelSnapshotId !== expected.labelSnapshotId ||
    stored.observationSetHash !== expected.observationSetHash ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.asOf !== expected.asOf ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw conflict('Stored Label Intelligence report conflicts with its canonical content.');
  }
}

function rowToReport(row: Record<string, unknown>): StoredLabelIntelligenceReport {
  const parsed = LabelIntelligenceReportSchema.safeParse(json(row.report));
  if (!parsed.success) throw conflict('Stored Label Intelligence report is invalid.', parsed.error);
  const ledger = LedgerSchema.parse(requiredString(row, 'ledger'));
  const subjectType = SubjectTypeSchema.parse(requiredString(row, 'subject_type'));
  const stored: StoredLabelIntelligenceReport = {
    id: requiredString(row, 'id'),
    ledger,
    chainId: requiredString(row, 'chain_id'),
    subjectId: String(row.subject_id),
    subjectType,
    normalizedIdentifier: requiredString(row, 'normalized_identifier'),
    labelSnapshotId: requiredString(row, 'label_snapshot_id'),
    observationSetHash: requiredString(row, 'observation_set_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version') as 'label-intelligence-v0.1.0',
    asOf: timestamp(row.as_of, 'asOf'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function reportId(value: string): string {
  if (!/^lir_[0-9a-f]{24}$/.test(value)) throw invalid('Label Intelligence report ID is invalid.');
  return value;
}

export class PostgresLabelIntelligenceReportRepository {
  readonly #pool: ReportPool;

  constructor(options: LabelIntelligenceReportRepositoryOptions | { pool: ReportPool }) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ReportPool): PostgresLabelIntelligenceReportRepository {
    return new PostgresLabelIntelligenceReportRepository({ pool });
  }

  async loadObservationSet(input: {
    ledger: Ledger;
    chainId: string;
    subjectType: SubjectType;
    normalizedIdentifier: string;
  }): Promise<RegisteredLabelObservationSet | undefined> {
    const expected = identity(input);
    try {
      const result = await this.#pool.query(SELECT_OBSERVATIONS, [
        expected.ledger,
        expected.chainId,
        expected.subjectType,
        expected.normalizedIdentifier,
      ]);
      if (result.rows.length === 0) return undefined;
      const subjectIds = [...new Set(result.rows.map((row) => String(row.subject_id)))];
      if (subjectIds.length !== 1) {
        throw conflict('Label Intelligence identity resolves to multiple Subject Registry rows.');
      }
      const first = result.rows[0];
      if (first === undefined) return undefined;
      const subject = LabelIntelligenceSubjectSchema.parse({
        id: requiredString(first, 'subject_id'),
        ledger: requiredString(first, 'ledger'),
        chainId: requiredString(first, 'chain_id'),
        subjectType: requiredString(first, 'subject_type'),
        normalizedIdentifier: requiredString(first, 'normalized_identifier'),
      });
      const observations = result.rows
        .map(observationFromRow)
        .filter((item): item is LabelObservation => item !== undefined);
      return { subject, observations };
    } catch (error) {
      if (error instanceof LabelIntelligenceStorageError) throw error;
      throw new LabelIntelligenceStorageError(
        'LABEL_INTELLIGENCE_UNAVAILABLE',
        'Durable Label observations could not be loaded.',
        { retryable: true, cause: error },
      );
    }
  }

  async put(input: LabelIntelligenceReport): Promise<StoredLabelIntelligenceReport> {
    const expected = materialize(input);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO label_intelligence_reports (
          id,
          ledger,
          chain_id,
          subject_id,
          subject_type,
          normalized_identifier,
          label_snapshot_id,
          observation_set_hash,
          result_hash,
          report,
          terminal_evidence_id,
          evidence_ids,
          source_set,
          model_version,
          as_of
        ) VALUES (
          $1, $2::ledger_kind, $3, $4::uuid, $5, $6, $7, $8, $9, $10::jsonb, $11,
          $12::text[], $13::text[], $14, $15::timestamptz
        ) ON CONFLICT (id) DO NOTHING`,
        [
          expected.id,
          expected.ledger,
          expected.chainId,
          expected.subjectId,
          expected.subjectType,
          expected.normalizedIdentifier,
          expected.labelSnapshotId,
          expected.observationSetHash,
          expected.resultHash,
          JSON.stringify(expected.report),
          expected.terminalEvidenceId,
          [...expected.evidenceIds],
          [...expected.sourceSet],
          expected.modelVersion,
          expected.asOf,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) throw conflict('Label Intelligence report insert was not visible.');
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof LabelIntelligenceStorageError) throw error;
      throw new LabelIntelligenceStorageError(
        'LABEL_INTELLIGENCE_UNAVAILABLE',
        'Durable Label Intelligence report persistence failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredLabelIntelligenceReport | undefined> {
    const expectedId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [expectedId]);
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof LabelIntelligenceStorageError) throw error;
      throw new LabelIntelligenceStorageError(
        'LABEL_INTELLIGENCE_UNAVAILABLE',
        'Durable Label Intelligence report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(input: {
    ledger: Ledger;
    chainId: string;
    subjectType: SubjectType;
    normalizedIdentifier: string;
  }): Promise<StoredLabelIntelligenceReport | undefined> {
    const expected = identity(input);
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE ledger = $1::ledger_kind
           AND chain_id = $2
           AND subject_type = $3
           AND (
             ($1::ledger_kind = 'EVM' AND lower(normalized_identifier) = lower($4))
             OR ($1::ledger_kind <> 'EVM' AND normalized_identifier = $4)
           )
         ORDER BY as_of DESC, created_at DESC, id DESC
         LIMIT 1`,
        [expected.ledger, expected.chainId, expected.subjectType, expected.normalizedIdentifier],
      );
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof LabelIntelligenceStorageError) throw error;
      throw new LabelIntelligenceStorageError(
        'LABEL_INTELLIGENCE_UNAVAILABLE',
        'Latest durable Label Intelligence report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: 'LABEL_INTELLIGENCE_UNAVAILABLE' | 'LABEL_INTELLIGENCE_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.label_intelligence_reports')::text AS table_name,
          to_regclass('public.label_intelligence_search_documents_v1')::text AS view_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['023_label_intelligence_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'label_intelligence_reports' ||
        result.rows[0]?.view_name !== 'label_intelligence_search_documents_v1' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'LABEL_INTELLIGENCE_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'LABEL_INTELLIGENCE_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
