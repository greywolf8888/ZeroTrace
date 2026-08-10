import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  FlapLifetimeRollbackSchema,
  FlapLifetimeStateSchema,
  type FlapLifetimeRollback,
  type FlapLifetimeState,
} from '@zerotrace/schemas';

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

export interface FlapLifetimeHeadInvalidation {
  id: string;
  chainId: 'eip155:56';
  token: string;
  eventSequence: number;
  invalidatedFromHeadId: string;
  invalidatedThroughHeadId: string;
  rollbackToHeadId: string | null;
  alertId: string;
  terminalEvidenceId: string;
  resultHash: string;
  result: FlapLifetimeRollback;
  snapshotHash: string;
  createdAt: string;
}

export interface PutFlapLifetimeHeadInvalidationInput {
  result: FlapLifetimeRollback;
}

type MaterializedHead = Omit<FlapLifetimeHead, 'createdAt'>;
type MaterializedInvalidation = Omit<FlapLifetimeHeadInvalidation, 'createdAt'>;

const HEAD_COLUMNS = `
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
`;

const SELECT_HEAD = `
  SELECT ${HEAD_COLUMNS}
  FROM flap_lifetime_heads
`;

const INVALIDATED_HEADS_CTE = `
  WITH RECURSIVE invalidated(id) AS (
    SELECT invalidated_from_head_id
    FROM flap_lifetime_head_invalidations
    WHERE chain_id = $1 AND token = $2
    UNION
    SELECT head.id
    FROM flap_lifetime_heads head
    JOIN invalidated ON head.predecessor_id = invalidated.id
    WHERE head.chain_id = $1 AND head.token = $2
  )
`;

const INVALIDATION_COLUMNS = `
  id,
  chain_id,
  token,
  event_sequence::text,
  invalidated_from_head_id,
  invalidated_through_head_id,
  rollback_to_head_id,
  alert_id,
  terminal_evidence_id,
  result_hash,
  result,
  snapshot_hash,
  created_at
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

function identifier(value: string, pattern: RegExp, field: string): string {
  if (!pattern.test(value)) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_INVALID',
      `Flap lifetime ${field} is invalid.`,
    );
  }
  return value;
}

function headId(value: string): string {
  return identifier(value, /^flh_[0-9a-f]{24}$/, 'head ID');
}

function invalidationId(value: string): string {
  return identifier(value, /^fli_[0-9a-f]{24}$/, 'invalidation ID');
}

function alertId(value: string): string {
  return identifier(value, /^dqa_[0-9a-f]{24}$/, 'alert ID');
}

function evidenceId(value: string): string {
  return identifier(value, /^ev_[0-9a-f]{24}$/, 'Evidence ID');
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
    (!isExtension && predecessorId !== null)
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

function reference(head: FlapLifetimeHead) {
  return {
    headId: head.id,
    scanId: head.scanId,
    targetBlock: String(head.targetBlock),
    targetHash: head.targetHash,
    terminalEvidenceId: head.terminalEvidenceId,
  };
}

function invalidationIdentity(result: FlapLifetimeRollback) {
  const resultHash = hashPayload(result);
  return {
    id: `fli_${hashPayload({
      schema: 'zerotrace-flap-lifetime-head-invalidation-v1',
      resultHash,
    }).slice(0, 24)}`,
    resultHash,
  };
}

function materializeInvalidation(
  input: PutFlapLifetimeHeadInvalidationInput,
  activeLineage: readonly FlapLifetimeHead[],
  eventSequence: number,
): MaterializedInvalidation {
  const parsed = FlapLifetimeRollbackSchema.safeParse(input.result);
  if (!parsed.success) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_INVALID',
      'Flap lifetime head invalidation result is invalid.',
      { cause: parsed.error },
    );
  }
  const result = parsed.data;
  if (activeLineage.length === 0) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Flap lifetime invalidation requires an active lineage.',
    );
  }
  const invalidatedFromIndex = activeLineage.findIndex(
    (head) => head.id === result.invalidatedHeads[0]?.headId,
  );
  if (invalidatedFromIndex < 0) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Flap lifetime invalidation start is not in the active lineage.',
    );
  }
  const expectedInvalidated = activeLineage
    .slice(0, invalidatedFromIndex + 1)
    .reverse()
    .map(reference);
  const expectedRollback = activeLineage[invalidatedFromIndex + 1];
  if (
    canonicalJson(result.invalidatedHeads) !== canonicalJson(expectedInvalidated) ||
    canonicalJson(result.rollbackTo) !==
      canonicalJson(expectedRollback === undefined ? null : reference(expectedRollback))
  ) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Flap lifetime invalidation does not match the exact active suffix.',
    );
  }
  const snapshot = result.metadata.snapshot;
  if (snapshot?.ledger !== 'EVM') {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_INVALID',
      'Flap lifetime invalidation requires an EVM Snapshot.',
    );
  }
  const identity = invalidationIdentity(result);
  return {
    id: identity.id,
    chainId: 'eip155:56',
    token: tokenAddress(result.token),
    eventSequence,
    invalidatedFromHeadId: expectedInvalidated[0]?.headId ?? '',
    invalidatedThroughHeadId: activeLineage[0]?.id ?? '',
    rollbackToHeadId: expectedRollback?.id ?? null,
    alertId: result.alertId,
    terminalEvidenceId: result.terminalEvidenceId,
    resultHash: identity.resultHash,
    result,
    snapshotHash: hashPayload(snapshot),
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

function assertSameInvalidation(
  stored: FlapLifetimeHeadInvalidation,
  expected: MaterializedInvalidation,
): void {
  if (
    stored.id !== expected.id ||
    stored.chainId !== expected.chainId ||
    stored.token !== expected.token ||
    stored.eventSequence !== expected.eventSequence ||
    stored.invalidatedFromHeadId !== expected.invalidatedFromHeadId ||
    stored.invalidatedThroughHeadId !== expected.invalidatedThroughHeadId ||
    stored.rollbackToHeadId !== expected.rollbackToHeadId ||
    stored.alertId !== expected.alertId ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.resultHash !== expected.resultHash ||
    stored.snapshotHash !== expected.snapshotHash ||
    canonicalJson(stored.result) !== canonicalJson(expected.result)
  ) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Stored Flap lifetime invalidation conflicts with the canonical result.',
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
    id: headId(requiredString(row, 'id')),
    chainId,
    token: tokenAddress(requiredString(row, 'token')),
    sequence: safeInteger(row.sequence, 'sequence'),
    scanId: uuid(requiredString(row, 'scan_id')),
    headType: headType as 'INITIAL' | 'EXTENSION',
    predecessorId:
      optionalString(row, 'predecessor_id') === null
        ? null
        : headId(requiredString(row, 'predecessor_id')),
    targetBlock: safeInteger(row.target_block, 'targetBlock'),
    targetHash: requiredString(row, 'target_hash'),
    resultHash: requiredString(row, 'result_hash'),
    result: parsed.data,
    snapshotHash: requiredString(row, 'snapshot_hash'),
    terminalEvidenceId: evidenceId(requiredString(row, 'terminal_evidence_id')),
    createdAt: timestamp(row.created_at),
  };
  assertSame(
    head,
    materialize({ scanId: head.scanId, result: head.result }, head.sequence, head.predecessorId),
  );
  return head;
}

function rowToInvalidation(row: Record<string, unknown>): FlapLifetimeHeadInvalidation {
  const parsed = FlapLifetimeRollbackSchema.safeParse(json(row.result));
  if (!parsed.success) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Stored Flap lifetime invalidation result is invalid.',
      { cause: parsed.error },
    );
  }
  const chainId = requiredString(row, 'chain_id');
  if (chainId !== 'eip155:56') {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Stored Flap lifetime invalidation chain is invalid.',
    );
  }
  const rollback = optionalString(row, 'rollback_to_head_id');
  const invalidation: FlapLifetimeHeadInvalidation = {
    id: invalidationId(requiredString(row, 'id')),
    chainId,
    token: tokenAddress(requiredString(row, 'token')),
    eventSequence: safeInteger(row.event_sequence, 'eventSequence'),
    invalidatedFromHeadId: headId(requiredString(row, 'invalidated_from_head_id')),
    invalidatedThroughHeadId: headId(requiredString(row, 'invalidated_through_head_id')),
    rollbackToHeadId: rollback === null ? null : headId(rollback),
    alertId: alertId(requiredString(row, 'alert_id')),
    terminalEvidenceId: evidenceId(requiredString(row, 'terminal_evidence_id')),
    resultHash: requiredString(row, 'result_hash'),
    result: parsed.data,
    snapshotHash: requiredString(row, 'snapshot_hash'),
    createdAt: timestamp(row.created_at),
  };
  const identity = invalidationIdentity(invalidation.result);
  const invalidated = invalidation.result.invalidatedHeads;
  if (
    invalidation.id !== identity.id ||
    invalidation.resultHash !== identity.resultHash ||
    invalidation.chainId !== invalidation.result.chainId ||
    invalidation.token !== invalidation.result.token ||
    invalidation.invalidatedFromHeadId !== invalidated[0]?.headId ||
    invalidation.invalidatedThroughHeadId !== invalidated[invalidated.length - 1]?.headId ||
    invalidation.rollbackToHeadId !== (invalidation.result.rollbackTo?.headId ?? null) ||
    invalidation.alertId !== invalidation.result.alertId ||
    invalidation.terminalEvidenceId !== invalidation.result.terminalEvidenceId ||
    invalidation.snapshotHash !== hashPayload(invalidation.result.metadata.snapshot)
  ) {
    throw new FlapLifetimeHeadError(
      'FLAP_LIFETIME_HEAD_CONFLICT',
      'Stored Flap lifetime invalidation identity is inconsistent.',
    );
  }
  return invalidation;
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
      const parsed = FlapLifetimeStateSchema.parse(input.result);
      const activeLineage = await this.#activeLineage('eip155:56', parsed.token);
      const existing = await this.#findByScanId(scanId);
      if (existing !== undefined) {
        if (!activeLineage.some((head) => head.id === existing.id)) {
          throw new FlapLifetimeHeadError(
            'FLAP_LIFETIME_HEAD_CONFLICT',
            'An invalidated Flap lifetime scan cannot be accepted again.',
          );
        }
        const expected = materialize(
          { scanId, result: parsed },
          existing.sequence,
          existing.predecessorId,
        );
        assertSame(existing, expected);
        return existing;
      }
      const predecessor =
        'predecessor' in parsed ? await this.#findByScanId(parsed.predecessor.scanId) : undefined;
      if ('predecessor' in parsed && predecessor === undefined) {
        throw new FlapLifetimeHeadError(
          'FLAP_LIFETIME_HEAD_CONFLICT',
          'Flap lifetime extension predecessor is not stored.',
        );
      }
      const activeHead = activeLineage[0];
      if (
        ('predecessor' in parsed && activeHead?.id !== predecessor?.id) ||
        (!('predecessor' in parsed) && activeHead !== undefined)
      ) {
        throw new FlapLifetimeHeadError(
          'FLAP_LIFETIME_HEAD_CONFLICT',
          'Flap lifetime result does not append to the active lineage.',
        );
      }
      const sequence = await this.#nextHeadSequence('eip155:56', parsed.token);
      const expected = materialize({ scanId, result: parsed }, sequence, predecessor?.id ?? null);
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
      return (await this.#activeLineage(chainId, canonicalToken))[0];
    } catch (error) {
      if (error instanceof FlapLifetimeHeadError) throw error;
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_UNAVAILABLE',
        'Flap lifetime head read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async listActiveLineage(chainId: string, token: string): Promise<FlapLifetimeHead[]> {
    if (chainId !== 'eip155:56') {
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_INVALID',
        'Flap lifetime heads currently require eip155:56.',
      );
    }
    const canonicalToken = tokenAddress(token);
    try {
      return await this.#activeLineage(chainId, canonicalToken);
    } catch (error) {
      if (error instanceof FlapLifetimeHeadError) throw error;
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_UNAVAILABLE',
        'Flap lifetime lineage read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async putInvalidation(
    input: PutFlapLifetimeHeadInvalidationInput,
  ): Promise<FlapLifetimeHeadInvalidation> {
    const validation = FlapLifetimeRollbackSchema.safeParse(input.result);
    if (!validation.success) {
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_INVALID',
        'Flap lifetime head invalidation result is invalid.',
        { cause: validation.error },
      );
    }
    const parsed = validation.data;
    try {
      const identity = invalidationIdentity(parsed);
      const existing = await this.#findInvalidationById(identity.id);
      if (existing !== undefined) {
        const snapshot = parsed.metadata.snapshot;
        if (
          snapshot?.ledger !== 'EVM' ||
          existing.resultHash !== identity.resultHash ||
          existing.snapshotHash !== hashPayload(snapshot) ||
          existing.alertId !== parsed.alertId ||
          existing.terminalEvidenceId !== parsed.terminalEvidenceId ||
          canonicalJson(existing.result) !== canonicalJson(parsed)
        ) {
          throw new FlapLifetimeHeadError(
            'FLAP_LIFETIME_HEAD_CONFLICT',
            'Stored Flap lifetime invalidation conflicts with its replay.',
          );
        }
        return existing;
      }
      const activeLineage = await this.#activeLineage(parsed.chainId, parsed.token);
      const eventSequence = await this.#nextInvalidationSequence(parsed.chainId, parsed.token);
      const expected = materializeInvalidation({ result: parsed }, activeLineage, eventSequence);
      await this.#pool.query(
        `INSERT INTO flap_lifetime_head_invalidations (
          id, chain_id, token, event_sequence, invalidated_from_head_id,
          invalidated_through_head_id, rollback_to_head_id, alert_id,
          terminal_evidence_id, result_hash, result, snapshot_hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.chainId,
          expected.token,
          expected.eventSequence,
          expected.invalidatedFromHeadId,
          expected.invalidatedThroughHeadId,
          expected.rollbackToHeadId,
          expected.alertId,
          expected.terminalEvidenceId,
          expected.resultHash,
          canonicalJson(expected.result),
          expected.snapshotHash,
        ],
      );
      const stored = await this.#findInvalidationById(expected.id);
      if (stored === undefined) {
        throw new FlapLifetimeHeadError(
          'FLAP_LIFETIME_HEAD_CONFLICT',
          'Flap lifetime invalidation was not stored.',
        );
      }
      assertSameInvalidation(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof FlapLifetimeHeadError) throw error;
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_UNAVAILABLE',
        'Flap lifetime invalidation write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latestInvalidation(
    chainId: string,
    token: string,
  ): Promise<FlapLifetimeHeadInvalidation | undefined> {
    if (chainId !== 'eip155:56') {
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_INVALID',
        'Flap lifetime invalidations currently require eip155:56.',
      );
    }
    const canonicalToken = tokenAddress(token);
    try {
      const result = await this.#pool.query(
        `SELECT ${INVALIDATION_COLUMNS}
         FROM flap_lifetime_head_invalidations
         WHERE chain_id = $1 AND token = $2
         ORDER BY event_sequence DESC
         LIMIT 1`,
        [chainId, canonicalToken],
      );
      return result.rows[0] === undefined ? undefined : rowToInvalidation(result.rows[0]);
    } catch (error) {
      if (error instanceof FlapLifetimeHeadError) throw error;
      throw new FlapLifetimeHeadError(
        'FLAP_LIFETIME_HEAD_UNAVAILABLE',
        'Flap lifetime invalidation read failed.',
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
          to_regclass('public.flap_lifetime_head_invalidations')::text AS invalidation_table,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['010_flap_lifetime_reorgs'],
      );
      if (
        result.rows[0]?.table_name !== 'flap_lifetime_heads' ||
        result.rows[0]?.invalidation_table !== 'flap_lifetime_head_invalidations' ||
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

  async #activeLineage(chainId: string, token: string): Promise<FlapLifetimeHead[]> {
    const result = await this.#pool.query(
      `${INVALIDATED_HEADS_CTE},
       active_latest AS (
         SELECT head.*
         FROM flap_lifetime_heads head
         WHERE head.chain_id = $1
           AND head.token = $2
           AND NOT EXISTS (SELECT 1 FROM invalidated WHERE invalidated.id = head.id)
         ORDER BY head.sequence DESC
         LIMIT 1
       ),
       active_lineage AS (
         SELECT * FROM active_latest
         UNION ALL
         SELECT parent.*
         FROM flap_lifetime_heads parent
         JOIN active_lineage child ON child.predecessor_id = parent.id
       )
       SELECT ${HEAD_COLUMNS}
       FROM active_lineage
       ORDER BY sequence DESC`,
      [chainId, token],
    );
    return result.rows.map(rowToHead);
  }

  async #nextHeadSequence(chainId: string, token: string): Promise<number> {
    const result = await this.#pool.query(
      `SELECT (COALESCE(MAX(sequence), -1) + 1)::text AS next_sequence
       FROM flap_lifetime_heads
       WHERE chain_id = $1 AND token = $2`,
      [chainId, token],
    );
    return safeInteger(result.rows[0]?.next_sequence, 'nextSequence');
  }

  async #nextInvalidationSequence(chainId: string, token: string): Promise<number> {
    const result = await this.#pool.query(
      `SELECT (COALESCE(MAX(event_sequence), -1) + 1)::text AS next_sequence
       FROM flap_lifetime_head_invalidations
       WHERE chain_id = $1 AND token = $2`,
      [chainId, token],
    );
    return safeInteger(result.rows[0]?.next_sequence, 'nextInvalidationSequence');
  }

  async #findInvalidationById(id: string): Promise<FlapLifetimeHeadInvalidation | undefined> {
    const result = await this.#pool.query(
      `SELECT ${INVALIDATION_COLUMNS}
       FROM flap_lifetime_head_invalidations
       WHERE id = $1`,
      [invalidationId(id)],
    );
    return result.rows[0] === undefined ? undefined : rowToInvalidation(result.rows[0]);
  }
}
