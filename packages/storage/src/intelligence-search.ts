import { Pool } from 'pg';

import { hashPayload } from '@zerotrace/evidence';
import {
  EvidenceSchema,
  GlobalIntelligenceSearchEntityCandidateSchema,
  GlobalIntelligenceSearchLabelSchema,
  GlobalIntelligenceSearchProjectionSchema,
  GlobalIntelligenceSearchRecordTypeSchema,
  LedgerSchema,
  SubjectTypeSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type GlobalIntelligenceSearchEntityCandidate,
  type GlobalIntelligenceSearchLabel,
  type GlobalIntelligenceSearchMatch,
  type GlobalIntelligenceSearchProjection,
  type KnowledgeValue,
  type Ledger,
} from '@zerotrace/schemas';

export interface IntelligenceSearchRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface SearchPool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export type IntelligenceSearchStorageErrorCode =
  | 'INTELLIGENCE_SEARCH_INVALID'
  | 'INTELLIGENCE_SEARCH_CONFLICT'
  | 'INTELLIGENCE_SEARCH_UNAVAILABLE'
  | 'INTELLIGENCE_SEARCH_NOT_INITIALIZED';

export class IntelligenceSearchStorageError extends Error {
  readonly code: IntelligenceSearchStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: IntelligenceSearchStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'IntelligenceSearchStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

const SEARCH_DOCUMENTS = `
  WITH matched_documents AS (
    SELECT
      document.*,
      CASE
        WHEN (
          (document.ledger = 'EVM' AND lower(document.normalized_identifier) = lower($1))
          OR (document.ledger <> 'EVM' AND document.normalized_identifier = $1)
        ) THEN 'IDENTIFIER'
        WHEN lower(document.label_text) = lower($1) THEN 'LABEL'
        ELSE 'LABEL_CATEGORY'
      END AS matched_by
    FROM (
      SELECT * FROM durable_intelligence_search_documents_v1
      UNION ALL
      SELECT * FROM label_intelligence_search_documents_v1
    ) document
    WHERE ($2::ledger_kind IS NULL OR document.ledger = $2::ledger_kind)
      AND ($3::text IS NULL OR document.chain_id = $3)
      AND (
        (document.ledger = 'EVM' AND lower(document.normalized_identifier) = lower($1))
        OR (document.ledger <> 'EVM' AND document.normalized_identifier = $1)
        OR lower(document.label_text) = lower($1)
        OR lower(document.label_category) = lower($1)
      )
  )
  SELECT
    document.*,
    terminal.ledger::text AS evidence_ledger,
    terminal.chain_id AS evidence_chain_id,
    terminal.evidence_kind,
    terminal.source AS evidence_source,
    terminal.locator AS evidence_locator,
    terminal.source_uri AS evidence_source_uri,
    terminal.payload_hash AS evidence_payload_hash,
    terminal.observed_at AS evidence_observed_at,
    terminal.block_or_slot::text AS evidence_block_or_slot,
    terminal.finality AS evidence_finality,
    terminal.summary AS evidence_summary,
    terminal.raw_artifact_ref AS evidence_raw_artifact_ref,
    registry.subject_count,
    labels.labels_json,
    entities.entities_json
  FROM matched_documents document
  JOIN evidence terminal ON terminal.id = document.terminal_evidence_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS subject_count
    FROM subjects subject
    WHERE subject.ledger = document.ledger
      AND subject.chain_id = document.chain_id
      AND (
        (document.ledger = 'EVM' AND lower(subject.normalized_identifier) = lower(document.normalized_identifier))
        OR (document.ledger <> 'EVM' AND subject.normalized_identifier = document.normalized_identifier)
      )
  ) registry ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', label.id,
          'label', label.label,
          'category', label.category,
          'source', label.source,
          'sourceClass', label.source_class,
          'actorCandidate', label.actor_candidate,
          'sourceConfidence', label.source_confidence,
          'evidenceId', label.evidence_id,
          'observedAt', label.observed_at,
          'deterministic', label.deterministic,
          'licensePolicy', label.license_policy
        ) ORDER BY label.label, label.category, label.observed_at, label.id
      ),
      '[]'::jsonb
    ) AS labels_json
    FROM subjects subject
    JOIN label_observations label ON label.subject_id = subject.id
    WHERE subject.ledger = document.ledger
      AND subject.chain_id = document.chain_id
      AND (
        (document.ledger = 'EVM' AND lower(subject.normalized_identifier) = lower(document.normalized_identifier))
        OR (document.ledger <> 'EVM' AND subject.normalized_identifier = document.normalized_identifier)
      )
  ) labels ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(entity_row.payload ORDER BY entity_row.entity_id),
      '[]'::jsonb
    ) AS entities_json
    FROM (
      SELECT DISTINCT ON (entity.id)
        entity.id AS entity_id,
        jsonb_build_object(
          'entityId', entity.id,
          'classification', entity.classification,
          'confidenceState', entity.confidence_state,
          'confidence', entity.confidence,
          'membershipClass', member.membership_class,
          'probabilityState', member.probability_state,
          'probability', member.probability,
          'evidenceIds', member.evidence_ids,
          'modelVersion', entity.model_version
        ) AS payload
      FROM subjects subject
      JOIN entity_members member ON member.subject_id = subject.id
      JOIN entities entity ON entity.id = member.entity_id
      WHERE subject.ledger = document.ledger
        AND subject.chain_id = document.chain_id
        AND (
          (document.ledger = 'EVM' AND lower(subject.normalized_identifier) = lower(document.normalized_identifier))
          OR (document.ledger <> 'EVM' AND subject.normalized_identifier = document.normalized_identifier)
        )
      ORDER BY entity.id, entity.created_at DESC
    ) entity_row
  ) entities ON true
  ORDER BY document.captured_at DESC, document.record_type, document.record_id, document.role
  LIMIT $4
`;

function createPool(options: IntelligenceSearchRepositoryOptions): SearchPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-durable-intelligence-search',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): IntelligenceSearchStorageError {
  return new IntelligenceSearchStorageError('INTELLIGENCE_SEARCH_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): IntelligenceSearchStorageError {
  return new IntelligenceSearchStorageError('INTELLIGENCE_SEARCH_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored intelligence search ${field} is invalid.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored intelligence search ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown, field: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict(`Stored intelligence search ${field} is not JSON.`, error);
  }
}

function array(value: unknown, field: string): unknown[] {
  const parsed = json(value, field);
  if (!Array.isArray(parsed)) throw conflict(`Stored intelligence search ${field} is invalid.`);
  return parsed;
}

function stringArray(value: unknown, field: string): string[] {
  const parsed = array(value, field);
  if (parsed.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw conflict(`Stored intelligence search ${field} is invalid.`);
  }
  const strings = parsed as string[];
  if (
    strings.length !== new Set(strings).size ||
    strings.some((item, index) => item !== [...strings].sort()[index])
  ) {
    throw conflict(`Stored intelligence search ${field} is not canonical.`);
  }
  return strings;
}

function ratio(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw conflict(`Stored intelligence search ${field} is invalid.`);
  }
  return parsed;
}

function knowledgeRatio(state: unknown, value: unknown, field: string): KnowledgeValue<number> {
  if (state === 'KNOWN') return knownValue(ratio(value, field));
  if (state === 'UNKNOWN') {
    return unknownValue('INSUFFICIENT_DATA', `Stored ${field} is explicitly Unknown.`);
  }
  if (state === 'UNAVAILABLE') {
    return unavailableValue('STORAGE_DOWN', `Stored ${field} is explicitly unavailable.`);
  }
  throw conflict(`Stored intelligence search ${field} knowledge state is invalid.`);
}

function labels(
  row: Record<string, unknown>,
  registered: boolean,
): KnowledgeValue<GlobalIntelligenceSearchLabel[]> {
  if (!registered) {
    return unknownValue(
      'NOT_QUERIED',
      'No durable Subject Registry binding exists for label lookup on this identifier.',
    );
  }
  return knownValue(
    array(row.labels_json, 'labels').map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw conflict('Stored intelligence search label is invalid.');
      }
      const value = item as Record<string, unknown>;
      const actorCandidate = value.actorCandidate;
      if (
        actorCandidate !== null &&
        actorCandidate !== undefined &&
        (typeof actorCandidate !== 'string' || actorCandidate.length === 0)
      ) {
        throw conflict('Stored intelligence search label actor candidate is invalid.');
      }
      return GlobalIntelligenceSearchLabelSchema.parse({
        ...value,
        sourceConfidence: ratio(value.sourceConfidence, 'label source confidence'),
        observedAt: timestamp(value.observedAt, 'label observedAt'),
        actorCandidate:
          actorCandidate === null || actorCandidate === undefined
            ? unknownValue('INSUFFICIENT_DATA', 'This label has no actor candidate.')
            : knownValue(actorCandidate),
      });
    }),
  );
}

function entities(
  row: Record<string, unknown>,
  registered: boolean,
): KnowledgeValue<GlobalIntelligenceSearchEntityCandidate[]> {
  if (!registered) {
    return unknownValue(
      'NOT_QUERIED',
      'No durable Subject Registry binding exists for Entity-membership lookup on this identifier.',
    );
  }
  return knownValue(
    array(row.entities_json, 'entities').map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw conflict('Stored intelligence search Entity candidate is invalid.');
      }
      const value = item as Record<string, unknown>;
      return GlobalIntelligenceSearchEntityCandidateSchema.parse({
        entityId: value.entityId,
        classification: value.classification,
        confidence: knowledgeRatio(value.confidenceState, value.confidence, 'Entity confidence'),
        membershipClass: value.membershipClass,
        membershipProbability: knowledgeRatio(
          value.probabilityState,
          value.probability,
          'Entity membership probability',
        ),
        evidenceIds: stringArray(value.evidenceIds, 'Entity Evidence IDs'),
        modelVersion: value.modelVersion,
      });
    }),
  );
}

function rowToMatch(row: Record<string, unknown>): GlobalIntelligenceSearchMatch {
  const ledger = LedgerSchema.safeParse(requiredString(row, 'ledger'));
  if (!ledger.success)
    throw conflict('Stored intelligence search ledger is invalid.', ledger.error);
  const chainId = requiredString(row, 'chain_id');
  const documentKey = requiredString(row, 'document_key');
  const subjectType = requiredString(row, 'subject_type');
  const parsedSubjectType = SubjectTypeSchema.safeParse(subjectType);
  if (!parsedSubjectType.success) {
    throw conflict('Stored intelligence search subject type is invalid.', parsedSubjectType.error);
  }
  const matchedBy = requiredString(row, 'matched_by');
  if (!['IDENTIFIER', 'LABEL', 'LABEL_CATEGORY'].includes(matchedBy)) {
    throw conflict('Stored intelligence search match mode is invalid.');
  }
  const snapshotPosition = optionalString(row.snapshot_position);
  const snapshotHash = optionalString(row.snapshot_hash);
  const subjectCount = Number(row.subject_count);
  if (!Number.isInteger(subjectCount) || subjectCount < 0) {
    throw conflict('Stored intelligence search Subject Registry count is invalid.');
  }
  const registered = subjectCount > 0;
  const analysisConfidence =
    row.confidence === null || row.confidence === undefined
      ? unknownValue('INSUFFICIENT_DATA', 'This indexed record has no analysis confidence.')
      : knownValue(ratio(row.confidence, 'analysis confidence'));
  const terminalEvidence = EvidenceSchema.parse({
    id: requiredString(row, 'terminal_evidence_id'),
    ledger: requiredString(row, 'evidence_ledger'),
    chainId: requiredString(row, 'evidence_chain_id'),
    kind: requiredString(row, 'evidence_kind'),
    source: requiredString(row, 'evidence_source'),
    locator: requiredString(row, 'evidence_locator'),
    ...(optionalString(row.evidence_source_uri) === undefined
      ? {}
      : { sourceUri: optionalString(row.evidence_source_uri) }),
    payloadHash: requiredString(row, 'evidence_payload_hash'),
    observedAt: timestamp(row.evidence_observed_at, 'Evidence observedAt'),
    ...(optionalString(row.evidence_block_or_slot) === undefined
      ? {}
      : { blockOrSlot: optionalString(row.evidence_block_or_slot) }),
    ...(optionalString(row.evidence_finality) === undefined
      ? {}
      : { finality: optionalString(row.evidence_finality) }),
    summary: requiredString(row, 'evidence_summary'),
    ...(optionalString(row.evidence_raw_artifact_ref) === undefined
      ? {}
      : { rawArtifactRef: optionalString(row.evidence_raw_artifact_ref) }),
  });
  if (terminalEvidence.ledger !== ledger.data || terminalEvidence.chainId !== chainId) {
    throw conflict('Search record ledger or chain conflicts with terminal Evidence.');
  }
  if (
    snapshotPosition !== undefined &&
    terminalEvidence.blockOrSlot !== undefined &&
    terminalEvidence.blockOrSlot !== snapshotPosition
  ) {
    throw conflict('Search record Snapshot position conflicts with terminal Evidence.');
  }
  return {
    documentId: `isr_${hashPayload({
      schema: 'durable-intelligence-search-document-v1',
      documentKey,
    }).slice(0, 24)}`,
    ledger: ledger.data,
    chainId,
    normalizedIdentifier: requiredString(row, 'normalized_identifier'),
    subjectType:
      parsedSubjectType.data === 'UNKNOWN'
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'The source report does not establish a terminal subject type.',
          )
        : knownValue(parsedSubjectType.data),
    matchedBy: matchedBy as 'IDENTIFIER' | 'LABEL' | 'LABEL_CATEGORY',
    recordType: GlobalIntelligenceSearchRecordTypeSchema.parse(row.record_type),
    recordId: requiredString(row, 'record_id'),
    role: requiredString(row, 'role'),
    snapshot:
      snapshotPosition === undefined || snapshotHash === undefined
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'This indexed observation has no complete Snapshot identity.',
          )
        : knownValue({ position: snapshotPosition, hash: snapshotHash }),
    analysisConfidence,
    freshness: knownValue(timestamp(row.captured_at, 'freshness')),
    labels: labels(row, registered),
    entities: entities(row, registered),
    terminalEvidence,
    sourceSet: stringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version'),
  };
}

function searchInput(input: { query: string; ledger?: Ledger; chainId?: string; limit?: number }) {
  const query = input.query.trim();
  const chainId = input.chainId?.trim();
  const limit = input.limit ?? 50;
  if (
    query.length === 0 ||
    query.length > 512 ||
    (input.ledger !== undefined && !['EVM', 'BITCOIN', 'SOLANA'].includes(input.ledger)) ||
    chainId === '' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw invalid('Durable intelligence search input is invalid.');
  }
  return {
    query,
    ledger: input.ledger ?? null,
    chainId: chainId ?? null,
    limit,
  };
}

export class PostgresIntelligenceSearchRepository {
  readonly #pool: SearchPool;

  constructor(options: IntelligenceSearchRepositoryOptions | { pool: SearchPool }) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: SearchPool): PostgresIntelligenceSearchRepository {
    return new PostgresIntelligenceSearchRepository({ pool });
  }

  async search(input: {
    query: string;
    ledger?: Ledger;
    chainId?: string;
    limit?: number;
  }): Promise<GlobalIntelligenceSearchProjection> {
    const expected = searchInput(input);
    try {
      const result = await this.#pool.query(SEARCH_DOCUMENTS, [
        expected.query,
        expected.ledger,
        expected.chainId,
        expected.limit + 1,
      ]);
      const truncated = result.rows.length > expected.limit;
      try {
        const matches = result.rows.slice(0, expected.limit).map(rowToMatch);
        return GlobalIntelligenceSearchProjectionSchema.parse({
          query: expected.query,
          coverageScope: 'IMMUTABLE_REPORTS_AND_REGISTERED_LABELS_V1',
          matches,
          matchCount: matches.length,
          truncated,
          indexedRecordTypes: [...GlobalIntelligenceSearchRecordTypeSchema.options].sort(),
          terminalEvidenceIds: [
            ...new Set(matches.map((match) => match.terminalEvidence.id)),
          ].sort(),
        });
      } catch (error) {
        if (error instanceof IntelligenceSearchStorageError) throw error;
        throw conflict('Stored intelligence search projection fails schema validation.', error);
      }
    } catch (error) {
      if (error instanceof IntelligenceSearchStorageError) throw error;
      throw new IntelligenceSearchStorageError(
        'INTELLIGENCE_SEARCH_UNAVAILABLE',
        'Durable intelligence search failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: 'INTELLIGENCE_SEARCH_UNAVAILABLE' | 'INTELLIGENCE_SEARCH_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.durable_intelligence_search_documents_v1')::text AS view_name,
          to_regclass('public.label_intelligence_search_documents_v1')::text AS label_view_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS search_migration_applied,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $2) AS label_migration_applied`,
        ['022_durable_intelligence_search', '023_label_intelligence_reports'],
      );
      if (
        result.rows[0]?.view_name !== 'durable_intelligence_search_documents_v1' ||
        result.rows[0]?.label_view_name !== 'label_intelligence_search_documents_v1' ||
        result.rows[0]?.search_migration_applied !== true ||
        result.rows[0]?.label_migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'INTELLIGENCE_SEARCH_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'INTELLIGENCE_SEARCH_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
