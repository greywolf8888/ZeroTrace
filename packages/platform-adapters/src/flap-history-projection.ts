import { ProviderError, type EvmLedgerAdapter, type EvmLogReader } from '@zerotrace/chain-adapters';
import { createEvidence, evidenceIdFor } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  EvidenceSchema,
  FlapEventHistoryProjectionSchema,
  FlapEventHistorySchema,
  FlapHistoryProjectionSegmentSchema,
  JsonValueSchema,
  unknownValue,
  type AnalysisSnapshot,
  type FlapEventHistory,
  type FlapEventHistoryProjection,
  type FlapHistoryProjectionSegment,
  type JsonValue,
} from '@zerotrace/schemas';
import { getAddress } from 'viem';

import type { FlapDeployment, FlapEvidenceWriter } from './flap.js';
import {
  discoverFlapEventHistory,
  FLAP_HISTORY_DEFAULT_CHUNK_SIZE,
  FLAP_HISTORY_MAX_LOGS,
  FLAP_HISTORY_MAX_RANGE_BLOCKS,
  FLAP_HISTORY_MAX_TRANSACTIONS,
  FLAP_HISTORY_MODEL_VERSION,
} from './flap-history.js';

export const FLAP_HISTORY_PROJECTION_MODEL_VERSION = 'flap-event-history-projection-v1';
export const FLAP_HISTORY_PROJECTION_CHECKPOINT_VERSION =
  'flap-event-history-projection-checkpoint-v1';
export const FLAP_HISTORY_PROJECTION_CHECKPOINT_SOURCE = 'sqd:binance-mainnet';
export const FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE = 5_000;
export const FLAP_HISTORY_PROJECTION_MAX_SEGMENT_SIZE = FLAP_HISTORY_MAX_RANGE_BLOCKS;
export const FLAP_HISTORY_PROJECTION_MAX_SEGMENTS = 5_000;
export const FLAP_HISTORY_PROJECTION_MAX_RANGE_BLOCKS =
  FLAP_HISTORY_PROJECTION_MAX_SEGMENT_SIZE * FLAP_HISTORY_PROJECTION_MAX_SEGMENTS;

export interface FlapHistoryProjectionCheckpointRun {
  id: string;
  status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
  nextBlock: number;
  state: JsonValue;
  evidenceIds: readonly string[];
}

export interface FlapHistoryProjectionCheckpointStore {
  begin(input: {
    scanType: string;
    source: string;
    ledger: 'EVM';
    chainId: string;
    subject: string;
    fromBlock: number;
    toBlock: number;
    chunkSize: number;
    identity: Readonly<Record<string, JsonValue>>;
    initialState: JsonValue;
  }): Promise<FlapHistoryProjectionCheckpointRun>;
  advance(
    id: string,
    input: {
      expectedNextBlock: number;
      completedToBlock: number;
      state: JsonValue;
      evidenceIds: readonly string[];
    },
  ): Promise<FlapHistoryProjectionCheckpointRun>;
  finish(
    id: string,
    input: { state: JsonValue; evidenceIds: readonly string[] },
  ): Promise<FlapHistoryProjectionCheckpointRun>;
  recordFailure(id: string, errorCode: string): Promise<FlapHistoryProjectionCheckpointRun>;
}

export interface FlapHistoryProjectionStoredSegment {
  id: string;
  scanId: string;
  chainId: string;
  token: string;
  fromBlock: number;
  toBlock: number;
  result: FlapEventHistory;
  terminalEvidenceId: string;
  sourceSet: readonly string[];
  transactionCount: number;
  unrecognizedPortalLogCount: number;
}

export interface FlapHistoryProjectionStore {
  putSegment(input: {
    scanId: string;
    result: FlapEventHistory;
  }): Promise<FlapHistoryProjectionStoredSegment>;
  listSegments(
    scanId: string,
    options?: { afterBlock?: number; limit?: number },
  ): Promise<FlapHistoryProjectionStoredSegment[]>;
}

export type FlapHistorySegmentExecutor = (options: {
  adapter: EvmLedgerAdapter;
  logReader: EvmLogReader;
  token: string;
  fromBlock: string;
  toBlock: string;
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
  chunkSize: number;
  maxTransactions: number;
  maxLogs: number;
}) => Promise<FlapEventHistory>;

export interface ProjectFlapEventHistoryOptions {
  adapter: EvmLedgerAdapter;
  logReader: EvmLogReader & { readonly endpointId: string };
  token: string;
  fromBlock: string;
  toBlock: string;
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
  checkpoints: FlapHistoryProjectionCheckpointStore;
  projection: FlapHistoryProjectionStore;
  segmentSize?: number;
  chunkSize?: number;
  maxTransactions?: number;
  maxLogs?: number;
  executeSegment?: FlapHistorySegmentExecutor;
}

interface ValidatedProjectionRequest extends ProjectFlapEventHistoryOptions {
  token: string;
  portal: string;
  fromBlockNumber: number;
  toBlockNumber: number;
  selectedSegmentSize: number;
  selectedChunkSize: number;
  selectedMaxTransactions: number;
  selectedMaxLogs: number;
  segmentCount: number;
}

interface ProjectionCheckpointState {
  segments: FlapHistoryProjectionSegment[];
  snapshot: AnalysisSnapshot | null;
  sourceSet: string[];
  transactionCount: number;
  unrecognizedPortalLogCount: number;
  result: FlapEventHistoryProjection | null;
}

function checkpointInvalid(message: string, cause?: unknown): ProviderError {
  return new ProviderError('INVALID_RESPONSE', message, { cause });
}

function canonicalAddress(value: string, field: string): string {
  try {
    return getAddress(value).toLowerCase();
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not an EVM address.`, {
      cause: error,
    });
  }
}

function safeBlock(value: string, field: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} must be unsigned decimal.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap ${field} must be a safe-integer block position for durable projection.`,
    );
  }
  return parsed;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  field: string,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap ${field} must be an integer from 1 through ${maximum}.`,
    );
  }
  return selected;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function canonicalStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw checkpointInvalid(`Flap history projection checkpoint ${field} is invalid.`);
  }
  const stored = value as string[];
  const canonical = sortedUnique(stored);
  if (
    canonical.length !== stored.length ||
    canonical.some((item, index) => item !== stored[index])
  ) {
    throw checkpointInvalid(`Flap history projection checkpoint ${field} is not canonical.`);
  }
  return canonical;
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw checkpointInvalid(`Flap history projection checkpoint ${field} is invalid.`);
  }
  return Number(value);
}

function validateRequest(options: ProjectFlapEventHistoryOptions): ValidatedProjectionRequest {
  const token = canonicalAddress(options.token, 'history projection token');
  const portal = canonicalAddress(options.deployment.portal, 'history projection Portal');
  if (`eip155:${options.adapter.config.chainId}` !== options.deployment.chainId) {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap deployment and EVM adapter chains differ.');
  }
  if (options.logReader.endpointId !== FLAP_HISTORY_PROJECTION_CHECKPOINT_SOURCE) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Durable Flap history projection requires ${FLAP_HISTORY_PROJECTION_CHECKPOINT_SOURCE}.`,
    );
  }
  const fromBlockNumber = safeBlock(options.fromBlock, 'history projection fromBlock');
  const toBlockNumber = safeBlock(options.toBlock, 'history projection toBlock');
  if (toBlockNumber < fromBlockNumber) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Flap history projection range ends before it begins.',
    );
  }
  const selectedSegmentSize = boundedInteger(
    options.segmentSize,
    FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE,
    FLAP_HISTORY_PROJECTION_MAX_SEGMENT_SIZE,
    'history projection segmentSize',
  );
  const requestedBlocks = toBlockNumber - fromBlockNumber + 1;
  if (requestedBlocks > FLAP_HISTORY_PROJECTION_MAX_RANGE_BLOCKS) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap history projection exceeds ${FLAP_HISTORY_PROJECTION_MAX_RANGE_BLOCKS} blocks.`,
    );
  }
  const segmentCount = Math.ceil(requestedBlocks / selectedSegmentSize);
  if (segmentCount > FLAP_HISTORY_PROJECTION_MAX_SEGMENTS) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap history projection exceeds ${FLAP_HISTORY_PROJECTION_MAX_SEGMENTS} segments.`,
    );
  }
  return {
    ...options,
    token,
    portal,
    fromBlockNumber,
    toBlockNumber,
    selectedSegmentSize,
    selectedChunkSize: boundedInteger(
      options.chunkSize,
      FLAP_HISTORY_DEFAULT_CHUNK_SIZE,
      10_000,
      'history projection inner chunkSize',
    ),
    selectedMaxTransactions: boundedInteger(
      options.maxTransactions,
      FLAP_HISTORY_MAX_TRANSACTIONS,
      FLAP_HISTORY_MAX_TRANSACTIONS,
      'history projection maxTransactions',
    ),
    selectedMaxLogs: boundedInteger(
      options.maxLogs,
      FLAP_HISTORY_MAX_LOGS,
      FLAP_HISTORY_MAX_LOGS,
      'history projection maxLogs',
    ),
    segmentCount,
  };
}

function checkpointIdentity(
  request: ValidatedProjectionRequest,
): Readonly<Record<string, JsonValue>> {
  return {
    version: FLAP_HISTORY_PROJECTION_CHECKPOINT_VERSION,
    modelVersion: FLAP_HISTORY_PROJECTION_MODEL_VERSION,
    segmentModelVersion: FLAP_HISTORY_MODEL_VERSION,
    token: request.token,
    chainId: request.deployment.chainId,
    portal: request.portal,
    documentedVersion: request.deployment.documentedVersion,
    sourceRevision: request.deployment.sourceRevision,
    snapshotTag: request.adapter.config.snapshotBlockTag ?? 'latest',
    fromBlock: String(request.fromBlockNumber),
    toBlock: String(request.toBlockNumber),
    segmentSize: request.selectedSegmentSize,
    innerChunkSize: request.selectedChunkSize,
    maxTransactions: request.selectedMaxTransactions,
    maxLogs: request.selectedMaxLogs,
  };
}

function stateJson(state: ProjectionCheckpointState): JsonValue {
  return JsonValueSchema.parse({
    version: FLAP_HISTORY_PROJECTION_CHECKPOINT_VERSION,
    segments: state.segments,
    snapshot: state.snapshot,
    sourceSet: state.sourceSet,
    transactionCount: state.transactionCount,
    unrecognizedPortalLogCount: state.unrecognizedPortalLogCount,
    result: state.result,
  });
}

function initialState(): JsonValue {
  return stateJson({
    segments: [],
    snapshot: null,
    sourceSet: [],
    transactionCount: 0,
    unrecognizedPortalLogCount: 0,
    result: null,
  });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw checkpointInvalid(`Flap history projection checkpoint ${field} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function segmentRef(segment: FlapHistoryProjectionStoredSegment): FlapHistoryProjectionSegment {
  return FlapHistoryProjectionSegmentSchema.parse({
    id: segment.id,
    fromBlock: String(segment.fromBlock),
    toBlock: String(segment.toBlock),
    terminalEvidenceId: segment.terminalEvidenceId,
    transactionCount: segment.transactionCount,
    unrecognizedPortalLogCount: segment.unrecognizedPortalLogCount,
  });
}

function expectedSegmentEnd(request: ValidatedProjectionRequest, fromBlock: number): number {
  return Math.min(request.toBlockNumber, fromBlock + request.selectedSegmentSize - 1);
}

function validateStoredSegment(
  segment: FlapHistoryProjectionStoredSegment,
  runId: string,
  request: ValidatedProjectionRequest,
  expectedFromBlock: number,
): FlapHistoryProjectionStoredSegment {
  const result = FlapEventHistorySchema.safeParse(segment.result);
  if (!result.success) {
    throw checkpointInvalid(
      'Stored Flap history projection segment result is invalid.',
      result.error,
    );
  }
  const parsed = result.data;
  const expectedToBlock = expectedSegmentEnd(request, expectedFromBlock);
  const expectedChunkCount = Math.ceil(
    (expectedToBlock - expectedFromBlock + 1) / request.selectedChunkSize,
  );
  const snapshot = parsed.metadata.snapshot;
  const terminal = parsed.evidence.filter(
    (item) =>
      item.source === `zerotrace:${parsed.metadata.modelVersion}` &&
      item.locator ===
        `flap-event-history:${request.token}:${expectedFromBlock}-${expectedToBlock}`,
  );
  if (
    segment.scanId !== runId ||
    segment.chainId !== request.deployment.chainId ||
    segment.token !== request.token ||
    segment.fromBlock !== expectedFromBlock ||
    segment.toBlock !== expectedToBlock ||
    segment.transactionCount !== parsed.transactions.length ||
    segment.unrecognizedPortalLogCount !== parsed.unrecognizedPortalLogCount ||
    parsed.token !== request.token ||
    parsed.requestedRange.fromBlock !== String(expectedFromBlock) ||
    parsed.requestedRange.toBlock !== String(expectedToBlock) ||
    parsed.requestedRange.chunkSize !== request.selectedChunkSize ||
    parsed.requestedRange.chunkCount !== expectedChunkCount ||
    parsed.requestedRangeCoverage !== 1 ||
    parsed.lifetimeCoverage.state === 'known' ||
    parsed.metadata.dataCoverage !== 1 ||
    parsed.metadata.historyCoverage !== 0 ||
    parsed.metadata.modelVersion !== FLAP_HISTORY_MODEL_VERSION ||
    snapshot?.ledger !== 'EVM' ||
    snapshot.chainId !== request.deployment.chainId ||
    snapshot.blockNumber !== String(expectedToBlock) ||
    terminal.length !== 1 ||
    terminal[0]?.id !== segment.terminalEvidenceId ||
    !['DERIVED_FEATURE', 'NEGATIVE_EVIDENCE'].includes(terminal[0]?.kind ?? '')
  ) {
    throw checkpointInvalid('Stored Flap history projection segment identity is inconsistent.');
  }
  const canonicalSources = sortedUnique(segment.sourceSet);
  if (
    canonicalSources.length === 0 ||
    canonicalSources.length !== segment.sourceSet.length ||
    canonicalSources.some((item, index) => item !== segment.sourceSet[index]) ||
    canonicalSources.some((item, index) => item !== parsed.metadata.sourceSet[index]) ||
    canonicalSources.length !== parsed.metadata.sourceSet.length
  ) {
    throw checkpointInvalid('Stored Flap history projection segment sources are inconsistent.');
  }
  if (!canonicalSources.includes(FLAP_HISTORY_PROJECTION_CHECKPOINT_SOURCE)) {
    throw checkpointInvalid('Stored Flap history projection omitted its SQD discovery source.');
  }
  return { ...segment, result: parsed };
}

function parseCheckpointState(
  run: FlapHistoryProjectionCheckpointRun,
  request: ValidatedProjectionRequest,
): ProjectionCheckpointState {
  const parsedJson = JsonValueSchema.safeParse(run.state);
  if (!parsedJson.success) {
    throw checkpointInvalid(
      'Flap history projection checkpoint state is not JSON.',
      parsedJson.error,
    );
  }
  const state = record(parsedJson.data, 'state');
  if (state.version !== FLAP_HISTORY_PROJECTION_CHECKPOINT_VERSION) {
    throw checkpointInvalid('Flap history projection checkpoint version is unsupported.');
  }
  if (!Array.isArray(state.segments)) {
    throw checkpointInvalid('Flap history projection checkpoint segments are invalid.');
  }
  const segments = state.segments.map((item) => {
    const parsed = FlapHistoryProjectionSegmentSchema.safeParse(item);
    if (!parsed.success) {
      throw checkpointInvalid(
        'Flap history projection checkpoint segment is invalid.',
        parsed.error,
      );
    }
    return parsed.data;
  });
  const snapshot =
    state.snapshot === null
      ? null
      : (() => {
          const parsed = AnalysisSnapshotSchema.safeParse(state.snapshot);
          if (!parsed.success || parsed.data.ledger !== 'EVM') {
            throw checkpointInvalid(
              'Flap history projection checkpoint Snapshot is invalid.',
              parsed.error,
            );
          }
          return parsed.data;
        })();
  const sourceSet = canonicalStrings(state.sourceSet, 'source set');
  const transactionCount = nonnegativeInteger(state.transactionCount, 'transaction count');
  const unrecognizedPortalLogCount = nonnegativeInteger(
    state.unrecognizedPortalLogCount,
    'unrecognized Portal-log count',
  );
  const result =
    state.result === null
      ? null
      : (() => {
          const parsed = FlapEventHistoryProjectionSchema.safeParse(state.result);
          if (!parsed.success) {
            throw checkpointInvalid(
              'Flap history projection checkpoint result is invalid.',
              parsed.error,
            );
          }
          return parsed.data;
        })();
  if (
    !Number.isSafeInteger(run.nextBlock) ||
    run.nextBlock < request.fromBlockNumber ||
    run.nextBlock > request.toBlockNumber + 1
  ) {
    throw checkpointInvalid('Flap history projection checkpoint cursor is outside its range.');
  }
  const processedBlocks = run.nextBlock - request.fromBlockNumber;
  const expectedSegmentCount =
    processedBlocks === 0 ? 0 : Math.ceil(processedBlocks / request.selectedSegmentSize);
  const expectedNextBlock = Math.min(
    request.fromBlockNumber + expectedSegmentCount * request.selectedSegmentSize,
    request.toBlockNumber + 1,
  );
  if (run.nextBlock !== expectedNextBlock || segments.length !== expectedSegmentCount) {
    throw checkpointInvalid('Flap history projection checkpoint coverage is inconsistent.');
  }
  let summedTransactions = 0;
  let summedUnrecognized = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const item = segments[index];
    if (item === undefined) {
      throw checkpointInvalid('Flap history projection checkpoint segment vanished.');
    }
    const from = request.fromBlockNumber + index * request.selectedSegmentSize;
    const to = expectedSegmentEnd(request, from);
    if (item.fromBlock !== String(from) || item.toBlock !== String(to)) {
      throw checkpointInvalid('Flap history projection checkpoint segments are not contiguous.');
    }
    summedTransactions += item.transactionCount;
    summedUnrecognized += item.unrecognizedPortalLogCount;
  }
  if (
    summedTransactions !== transactionCount ||
    summedUnrecognized !== unrecognizedPortalLogCount
  ) {
    throw checkpointInvalid('Flap history projection checkpoint counts are inconsistent.');
  }
  if (segments.length === 0) {
    if (snapshot !== null || sourceSet.length !== 0 || result !== null) {
      throw checkpointInvalid('Unstarted Flap history projection contains materialized state.');
    }
  } else {
    const last = segments.at(-1);
    if (
      last === undefined ||
      snapshot?.ledger !== 'EVM' ||
      snapshot.chainId !== request.deployment.chainId ||
      snapshot.blockNumber !== last.toBlock ||
      sourceSet.length === 0
    ) {
      throw checkpointInvalid('Flap history projection Snapshot is inconsistent.');
    }
  }
  const segmentEvidenceIds = sortedUnique(segments.map((item) => item.terminalEvidenceId));
  const expectedEvidenceIds = sortedUnique([
    ...segmentEvidenceIds,
    ...(result === null ? [] : [result.terminalEvidenceId]),
  ]);
  if (
    expectedEvidenceIds.length !== run.evidenceIds.length ||
    expectedEvidenceIds.some((item, index) => item !== run.evidenceIds[index])
  ) {
    throw checkpointInvalid('Flap history projection checkpoint Evidence IDs are inconsistent.');
  }
  if (result !== null) {
    const terminal = result.evidence[0];
    const metadataEvidenceIds = sortedUnique(result.metadata.evidenceIds);
    if (
      run.nextBlock !== request.toBlockNumber + 1 ||
      result.token !== request.token ||
      result.requestedRange.fromBlock !== String(request.fromBlockNumber) ||
      result.requestedRange.toBlock !== String(request.toBlockNumber) ||
      result.requestedRange.segmentSize !== request.selectedSegmentSize ||
      result.requestedRange.segmentCount !== request.segmentCount ||
      result.requestedRangeCoverage !== 1 ||
      result.lifetimeCoverage.state === 'known' ||
      result.transactionCount !== transactionCount ||
      result.unrecognizedPortalLogCount !== unrecognizedPortalLogCount ||
      result.metadata.snapshot?.ledger !== 'EVM' ||
      result.metadata.snapshot.blockNumber !== String(request.toBlockNumber) ||
      result.metadata.dataCoverage !== 1 ||
      result.metadata.historyCoverage !== 0 ||
      result.metadata.freshness !== result.metadata.snapshot.capturedAt ||
      result.metadata.modelVersion !== FLAP_HISTORY_PROJECTION_MODEL_VERSION ||
      result.metadata.sourceSet.length !== sourceSet.length ||
      result.metadata.sourceSet.some((item, index) => item !== sourceSet[index]) ||
      metadataEvidenceIds.length !== expectedEvidenceIds.length ||
      metadataEvidenceIds.some((item, index) => item !== result.metadata.evidenceIds[index]) ||
      metadataEvidenceIds.some((item, index) => item !== expectedEvidenceIds[index]) ||
      result.segments.length !== segments.length ||
      result.segments.some(
        (item, index) => JSON.stringify(item) !== JSON.stringify(segments[index]),
      ) ||
      result.evidence.length !== 1 ||
      terminal === undefined ||
      terminal.id !== result.terminalEvidenceId ||
      terminal.kind !== (transactionCount === 0 ? 'NEGATIVE_EVIDENCE' : 'DERIVED_FEATURE') ||
      terminal.source !== `zerotrace:${FLAP_HISTORY_PROJECTION_MODEL_VERSION}` ||
      terminal.locator !==
        `flap-event-history-projection:${request.token}:${request.fromBlockNumber}-${request.toBlockNumber}` ||
      terminal.observedAt !== result.metadata.snapshot.capturedAt ||
      terminal.blockOrSlot !== String(request.toBlockNumber) ||
      terminal.finality !== result.metadata.snapshot.finality ||
      terminal.id !== evidenceIdFor(terminal, segmentEvidenceIds)
    ) {
      throw checkpointInvalid('Flap history projection terminal result is inconsistent.');
    }
  }
  if (run.status === 'REQUESTED_RANGE_COMPLETE' && result === null) {
    throw checkpointInvalid('Completed Flap history projection result vanished.');
  }
  if (run.status === 'RUNNING' && result !== null) {
    throw checkpointInvalid('Running Flap history projection contains a terminal result.');
  }
  return {
    segments,
    snapshot,
    sourceSet,
    transactionCount,
    unrecognizedPortalLogCount,
    result,
  };
}

async function listAllSegments(
  projection: FlapHistoryProjectionStore,
  runId: string,
): Promise<FlapHistoryProjectionStoredSegment[]> {
  const segments: FlapHistoryProjectionStoredSegment[] = [];
  let afterBlock: number | undefined;
  for (;;) {
    const page = await projection.listSegments(runId, {
      ...(afterBlock === undefined ? {} : { afterBlock }),
      limit: 1_000,
    });
    segments.push(...page);
    if (page.length < 1_000) return segments;
    const last = page.at(-1);
    if (last === undefined || last.fromBlock === afterBlock) {
      throw checkpointInvalid('Flap history projection pagination made no progress.');
    }
    afterBlock = last.fromBlock;
  }
}

function reconcileStoredSegments(
  stored: readonly FlapHistoryProjectionStoredSegment[],
  state: ProjectionCheckpointState,
  run: FlapHistoryProjectionCheckpointRun,
  request: ValidatedProjectionRequest,
): FlapHistoryProjectionStoredSegment[] {
  if (stored.length > request.segmentCount || stored.length > state.segments.length + 1) {
    throw checkpointInvalid('Stored Flap history projection has non-contiguous future segments.');
  }
  const validated = stored.map((segment, index) =>
    validateStoredSegment(
      segment,
      run.id,
      request,
      request.fromBlockNumber + index * request.selectedSegmentSize,
    ),
  );
  for (let index = 0; index < state.segments.length; index += 1) {
    const projected = validated[index];
    const checkpoint = state.segments[index];
    if (
      projected === undefined ||
      checkpoint === undefined ||
      JSON.stringify(segmentRef(projected)) !== JSON.stringify(checkpoint)
    ) {
      throw checkpointInvalid('Stored Flap history projection conflicts with its checkpoint.');
    }
  }
  if (
    validated.length === state.segments.length + 1 &&
    validated.at(-1)?.fromBlock !== run.nextBlock
  ) {
    throw checkpointInvalid('Pending Flap history projection segment is not at the scan cursor.');
  }
  return validated;
}

function nextState(
  previous: ProjectionCheckpointState,
  segment: FlapHistoryProjectionStoredSegment,
): ProjectionCheckpointState {
  const snapshot = segment.result.metadata.snapshot;
  if (snapshot?.ledger !== 'EVM') {
    throw checkpointInvalid('Flap history projection segment has no EVM Snapshot.');
  }
  return {
    segments: [...previous.segments, segmentRef(segment)],
    snapshot,
    sourceSet: sortedUnique([...previous.sourceSet, ...segment.sourceSet]),
    transactionCount: previous.transactionCount + segment.transactionCount,
    unrecognizedPortalLogCount:
      previous.unrecognizedPortalLogCount + segment.unrecognizedPortalLogCount,
    result: null,
  };
}

async function terminalResult(
  request: ValidatedProjectionRequest,
  state: ProjectionCheckpointState,
  stored: readonly FlapHistoryProjectionStoredSegment[],
): Promise<FlapEventHistoryProjection> {
  if (state.snapshot?.ledger !== 'EVM' || state.segments.length !== request.segmentCount) {
    throw checkpointInvalid('Flap history projection cannot finish without exact coverage.');
  }
  const sourceEvidenceIds = sortedUnique(
    state.segments.map((segment) => segment.terminalEvidenceId),
  );
  const payload = {
    token: request.token,
    requestedRange: {
      fromBlock: String(request.fromBlockNumber),
      toBlock: String(request.toBlockNumber),
      segmentSize: request.selectedSegmentSize,
      segmentCount: request.segmentCount,
    },
    segments: state.segments,
    transactionCount: state.transactionCount,
    unrecognizedPortalLogCount: state.unrecognizedPortalLogCount,
  };
  const evidence = await request.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: request.deployment.chainId,
      kind: state.transactionCount === 0 ? 'NEGATIVE_EVIDENCE' : 'DERIVED_FEATURE',
      source: `zerotrace:${FLAP_HISTORY_PROJECTION_MODEL_VERSION}`,
      locator:
        `flap-event-history-projection:${request.token}:` +
        `${request.fromBlockNumber}-${request.toBlockNumber}`,
      payload,
      observedAt: state.snapshot.capturedAt,
      blockOrSlot: String(request.toBlockNumber),
      finality: state.snapshot.finality,
      summary:
        state.transactionCount === 0
          ? 'No supported Flap event was found across the complete requested projection range.'
          : 'Bounded Flap history segments were projected across the complete requested range.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    state.snapshot,
  );
  const parsedEvidence = EvidenceSchema.parse(evidence);
  if (parsedEvidence.id !== evidenceIdFor(parsedEvidence, sourceEvidenceIds)) {
    throw checkpointInvalid('Flap history projection terminal Evidence is not canonical.');
  }
  const confidence = Math.min(...stored.map((segment) => segment.result.metadata.confidence));
  return FlapEventHistoryProjectionSchema.parse({
    platform: 'flap',
    token: request.token,
    requestedRange: payload.requestedRange,
    requestedRangeCoverage: 1,
    lifetimeCoverage: unknownValue(
      'INSUFFICIENT_DATA',
      'The requested range is complete, but token-lifetime coverage requires an evidenced origin and a continuous origin-to-head projection.',
    ),
    segments: state.segments,
    transactionCount: state.transactionCount,
    unrecognizedPortalLogCount: state.unrecognizedPortalLogCount,
    terminalEvidenceId: parsedEvidence.id,
    metadata: AnalysisMetadataSchema.parse({
      snapshot: state.snapshot,
      dataCoverage: 1,
      sourceCoverage: Math.min(1, state.sourceSet.length / 2),
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: state.snapshot.capturedAt,
      sourceSet: state.sourceSet,
      modelVersion: FLAP_HISTORY_PROJECTION_MODEL_VERSION,
      confidence,
      evidenceIds: sortedUnique([...sourceEvidenceIds, parsedEvidence.id]),
    }),
    evidence: [parsedEvidence],
  });
}

function safeFailureCode(error: unknown): string {
  if (error instanceof ProviderError) return error.code;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,159}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'FLAP_HISTORY_PROJECTION_FAILED';
}

export interface FlapEventHistoryProjectionRun {
  scanId: string;
  result: FlapEventHistoryProjection;
}

export async function runFlapEventHistoryProjectionRestartSafe(
  options: ProjectFlapEventHistoryOptions,
): Promise<FlapEventHistoryProjectionRun> {
  const request = validateRequest(options);
  let run: FlapHistoryProjectionCheckpointRun | undefined;
  try {
    run = await request.checkpoints.begin({
      scanType: 'FLAP_EVENT_HISTORY',
      source: FLAP_HISTORY_PROJECTION_CHECKPOINT_SOURCE,
      ledger: 'EVM',
      chainId: request.deployment.chainId,
      subject: request.token,
      fromBlock: request.fromBlockNumber,
      toBlock: request.toBlockNumber,
      chunkSize: request.selectedSegmentSize,
      identity: checkpointIdentity(request),
      initialState: initialState(),
    });
    let state = parseCheckpointState(run, request);
    if (run.status === 'REQUESTED_RANGE_COMPLETE') {
      if (state.result === null) {
        throw checkpointInvalid('Completed Flap history projection result vanished.');
      }
      return { scanId: run.id, result: state.result };
    }
    const stored = reconcileStoredSegments(
      await listAllSegments(request.projection, run.id),
      state,
      run,
      request,
    );
    const executeSegment = request.executeSegment ?? discoverFlapEventHistory;
    while (run.nextBlock <= request.toBlockNumber) {
      const fromBlock = run.nextBlock;
      const toBlock = expectedSegmentEnd(request, fromBlock);
      const existing = stored[state.segments.length];
      const segment =
        existing ??
        (await request.projection.putSegment({
          scanId: run.id,
          result: await executeSegment({
            adapter: request.adapter,
            logReader: request.logReader,
            token: request.token,
            fromBlock: String(fromBlock),
            toBlock: String(toBlock),
            deployment: request.deployment,
            writeEvidence: request.writeEvidence,
            chunkSize: request.selectedChunkSize,
            maxTransactions: request.selectedMaxTransactions,
            maxLogs: request.selectedMaxLogs,
          }),
        }));
      const validated = validateStoredSegment(segment, run.id, request, fromBlock);
      if (existing === undefined) stored.push(validated);
      state = nextState(state, validated);
      run = await request.checkpoints.advance(run.id, {
        expectedNextBlock: fromBlock,
        completedToBlock: toBlock,
        state: stateJson(state),
        evidenceIds: sortedUnique(state.segments.map((item) => item.terminalEvidenceId)),
      });
      state = parseCheckpointState(run, request);
    }
    const result = await terminalResult(request, state, stored);
    const terminalState = stateJson({ ...state, result });
    const completed = await request.checkpoints.finish(run.id, {
      state: terminalState,
      evidenceIds: sortedUnique([
        ...state.segments.map((item) => item.terminalEvidenceId),
        result.terminalEvidenceId,
      ]),
    });
    const replay = parseCheckpointState(completed, request);
    if (replay.result === null) {
      throw checkpointInvalid('Flap history projection terminal checkpoint result vanished.');
    }
    return { scanId: completed.id, result: replay.result };
  } catch (error) {
    if (run?.status === 'RUNNING') {
      try {
        await request.checkpoints.recordFailure(run.id, safeFailureCode(error));
      } catch {
        // Preserve the original provider, projection, or checkpoint failure.
      }
    }
    throw error;
  }
}

export async function projectFlapEventHistoryRestartSafe(
  options: ProjectFlapEventHistoryOptions,
): Promise<FlapEventHistoryProjection> {
  return (await runFlapEventHistoryProjectionRestartSafe(options)).result;
}
