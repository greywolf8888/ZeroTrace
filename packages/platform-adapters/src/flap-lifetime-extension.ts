import type { EvmLedgerAdapter, EvmLogReader } from '@zerotrace/chain-adapters';
import { createEvidence, evidenceIdFor } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  ChainAnchorReadSchema,
  EvidenceSchema,
  FlapLifetimeContinuityProofSchema,
  FlapLifetimeExtensionSchema,
  FlapLifetimeStateSchema,
  JsonValueSchema,
  knownValue,
  type ChainAnchorRead,
  type FlapLifetimeContinuityProof,
  type FlapLifetimeExtension,
  type FlapLifetimeState,
  type JsonValue,
} from '@zerotrace/schemas';
import { getAddress } from 'viem';

import {
  FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE,
  FLAP_HISTORY_PROJECTION_MAX_SEGMENT_SIZE,
  FLAP_HISTORY_PROJECTION_MAX_RANGE_BLOCKS,
  runFlapEventHistoryProjectionRestartSafe,
  type FlapEventHistoryProjectionRun,
  type FlapHistoryProjectionStore,
} from './flap-history-projection.js';
import type { FlapOriginCheckpointStore } from './flap-origin.js';
import type { FlapDeployment, FlapEvidenceWriter } from './flap.js';

export const FLAP_LIFETIME_EXTENSION_MODEL_VERSION = 'flap-lifetime-extension-v1';
export const FLAP_LIFETIME_EXTENSION_CHECKPOINT_VERSION = 'flap-lifetime-extension-checkpoint-v1';
export const FLAP_LIFETIME_EXTENSION_SOURCE = `zerotrace:${FLAP_LIFETIME_EXTENSION_MODEL_VERSION}`;

interface ExtensionCheckpointRun {
  id: string;
  status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
  nextBlock: number;
  state: JsonValue;
  evidenceIds: readonly string[];
}

export interface ExtendFlapLifetimeOptions {
  adapter: EvmLedgerAdapter;
  logReader: EvmLogReader & { readonly endpointId: string };
  token: string;
  deployment: FlapDeployment;
  predecessor: { scanId: string; result: FlapLifetimeState };
  continuity: FlapLifetimeContinuityProof;
  targetAnchor: ChainAnchorRead;
  checkpoints: FlapOriginCheckpointStore;
  projection: FlapHistoryProjectionStore;
  writeEvidence: FlapEvidenceWriter;
  historySegmentSize?: number;
  historyChunkSize?: number;
  historyMaxTransactions?: number;
  historyMaxLogs?: number;
  executeHistory?: (
    options: Parameters<typeof runFlapEventHistoryProjectionRestartSafe>[0],
  ) => Promise<FlapEventHistoryProjectionRun>;
}

export interface FlapLifetimeExtensionRun {
  scanId: string;
  result: FlapLifetimeExtension;
}

interface ValidatedExtensionRequest extends ExtendFlapLifetimeOptions {
  token: string;
  predecessor: { scanId: string; result: FlapLifetimeState };
  continuity: FlapLifetimeContinuityProof;
  targetAnchor: ChainAnchorRead;
  previousTargetBlock: number;
  targetBlock: number;
  deltaFromBlock: number;
  historySegmentSize: number;
  historyChunkSize: number;
}

function safeInteger(value: number | undefined, fallback: number, field: string, maximum: number) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw new RangeError(`${field} must be an integer between 1 and ${maximum}.`);
  }
  return selected;
}

function exactTargetSnapshot(value: unknown, target: ChainAnchorRead): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.ledger === 'EVM' &&
    snapshot.chainId === 'eip155:56' &&
    snapshot.blockNumber === target.anchor.position &&
    snapshot.blockHash === target.anchor.hash &&
    snapshot.finality === 'finalized'
  );
}

function validateRequest(options: ExtendFlapLifetimeOptions): ValidatedExtensionRequest {
  if (options.deployment.chainId !== 'eip155:56' || options.adapter.config.chainId !== 56) {
    throw new RangeError('Flap lifetime extension requires the BSC deployment and adapter.');
  }
  if ((options.adapter.config.snapshotBlockTag ?? 'latest') !== 'finalized') {
    throw new RangeError('Flap lifetime extension requires an explicit finalized adapter.');
  }
  let token: string;
  try {
    token = getAddress(options.token).toLowerCase();
  } catch {
    throw new RangeError('Flap lifetime extension requires an EVM token address.');
  }
  const predecessor = {
    scanId: options.predecessor.scanId,
    result: FlapLifetimeStateSchema.parse(options.predecessor.result),
  };
  if (
    predecessor.result.token !== token ||
    predecessor.result.lifetimeCoverage.state !== 'known' ||
    predecessor.result.lifetimeCoverage.value !== true ||
    predecessor.result.origin.state !== 'known' ||
    predecessor.result.metadata.snapshot === null ||
    predecessor.result.metadata.snapshot.ledger !== 'EVM'
  ) {
    throw new RangeError('Flap lifetime extension requires a Known exact predecessor.');
  }
  const continuity = FlapLifetimeContinuityProofSchema.parse(options.continuity);
  if (continuity.continuous.state !== 'known' || continuity.continuous.value !== true) {
    throw new RangeError('Flap lifetime extension requires Known target-chain continuity.');
  }
  const targetAnchor = ChainAnchorReadSchema.parse(options.targetAnchor);
  const targetBlock = Number(targetAnchor.anchor.position);
  const previousTargetBlock = Number(predecessor.result.targetBlock);
  if (
    targetAnchor.anchor.ledger !== 'EVM' ||
    targetAnchor.anchor.chainId !== 'eip155:56' ||
    targetAnchor.anchor.finality !== 'finalized' ||
    !Number.isSafeInteger(targetBlock) ||
    !Number.isSafeInteger(previousTargetBlock) ||
    targetBlock <= previousTargetBlock ||
    !exactTargetSnapshot(targetAnchor.snapshot, targetAnchor)
  ) {
    throw new RangeError('Flap lifetime extension target must advance one finalized BSC chain.');
  }
  const deltaFromBlock = previousTargetBlock + 1;
  if (targetBlock - deltaFromBlock + 1 > FLAP_HISTORY_PROJECTION_MAX_RANGE_BLOCKS) {
    throw new RangeError('Flap lifetime extension delta exceeds the durable safety limit.');
  }
  return {
    ...options,
    token,
    predecessor,
    continuity,
    targetAnchor,
    previousTargetBlock,
    targetBlock,
    deltaFromBlock,
    historySegmentSize: safeInteger(
      options.historySegmentSize,
      FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE,
      'historySegmentSize',
      FLAP_HISTORY_PROJECTION_MAX_SEGMENT_SIZE,
    ),
    historyChunkSize: safeInteger(options.historyChunkSize, 2_000, 'historyChunkSize', 10_000),
  };
}

function stateJson(result: FlapLifetimeExtension | null): JsonValue {
  return JsonValueSchema.parse({
    version: FLAP_LIFETIME_EXTENSION_CHECKPOINT_VERSION,
    result,
  });
}

function parseStoredResult(
  run: ExtensionCheckpointRun,
  request: ValidatedExtensionRequest,
): FlapLifetimeExtension | null {
  const parsed = JsonValueSchema.safeParse(run.state);
  if (
    !parsed.success ||
    typeof parsed.data !== 'object' ||
    parsed.data === null ||
    Array.isArray(parsed.data) ||
    parsed.data.version !== FLAP_LIFETIME_EXTENSION_CHECKPOINT_VERSION
  ) {
    throw new RangeError('Flap lifetime extension checkpoint state is invalid.');
  }
  if (parsed.data.result === null) return null;
  const result = FlapLifetimeExtensionSchema.parse(parsed.data.result);
  if (
    result.token !== request.token ||
    result.predecessor.scanId !== request.predecessor.scanId ||
    result.targetBlock !== String(request.targetBlock) ||
    !exactTargetSnapshot(result.metadata.snapshot, request.targetAnchor)
  ) {
    throw new RangeError('Flap lifetime extension conflicts with its immutable identity.');
  }
  return result;
}

function checkpointIdentity(
  request: ValidatedExtensionRequest,
): Readonly<Record<string, JsonValue>> {
  const previousSnapshot = request.predecessor.result.metadata.snapshot;
  if (previousSnapshot === null || previousSnapshot.ledger !== 'EVM') {
    throw new RangeError('Flap lifetime predecessor Snapshot vanished.');
  }
  return {
    version: FLAP_LIFETIME_EXTENSION_CHECKPOINT_VERSION,
    modelVersion: FLAP_LIFETIME_EXTENSION_MODEL_VERSION,
    token: request.token,
    chainId: request.deployment.chainId,
    portal: request.deployment.portal.toLowerCase(),
    documentedVersion: request.deployment.documentedVersion,
    sourceRevision: request.deployment.sourceRevision,
    predecessorScanId: request.predecessor.scanId,
    predecessorTargetBlock: request.previousTargetBlock,
    predecessorTargetHash: previousSnapshot.blockHash,
    predecessorTerminalEvidenceId: request.predecessor.result.terminalEvidenceId,
    continuityStatus: request.continuity.status,
    continuityTerminalEvidenceId: request.continuity.terminalEvidenceId,
    targetBlock: request.targetBlock,
    targetHash: request.targetAnchor.anchor.hash,
    historySegmentSize: request.historySegmentSize,
    historyChunkSize: request.historyChunkSize,
    historyMaxTransactions: request.historyMaxTransactions ?? null,
    historyMaxLogs: request.historyMaxLogs ?? null,
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function safeFailureCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,159}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'FLAP_LIFETIME_EXTENSION_FAILED';
}

async function extensionResult(
  request: ValidatedExtensionRequest,
  historyRun: FlapEventHistoryProjectionRun,
): Promise<FlapLifetimeExtension> {
  const previous = request.predecessor.result;
  const previousSnapshot = previous.metadata.snapshot;
  if (previousSnapshot === null || previousSnapshot.ledger !== 'EVM') {
    throw new RangeError('Flap lifetime predecessor Snapshot vanished.');
  }
  const history = historyRun.result;
  if (
    history.token !== request.token ||
    history.requestedRange.fromBlock !== String(request.deltaFromBlock) ||
    history.requestedRange.toBlock !== String(request.targetBlock) ||
    history.requestedRangeCoverage !== 1 ||
    !exactTargetSnapshot(history.metadata.snapshot, request.targetAnchor)
  ) {
    throw new RangeError('Flap lifetime delta history is incomplete or Snapshot-conflicting.');
  }
  const sourceEvidenceIds = sortedUnique([
    previous.terminalEvidenceId,
    ...request.continuity.evidenceIds,
    history.terminalEvidenceId,
  ]);
  const terminal = EvidenceSchema.parse(
    await request.writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: request.deployment.chainId,
        kind: 'DERIVED_FEATURE',
        source: FLAP_LIFETIME_EXTENSION_SOURCE,
        locator: `flap-lifetime-extension:${request.token}:${request.previousTargetBlock}-${request.targetBlock}`,
        payload: {
          token: request.token,
          predecessorScanId: request.predecessor.scanId,
          predecessorTargetBlock: String(request.previousTargetBlock),
          targetBlock: String(request.targetBlock),
          continuityStatus: request.continuity.status,
          historyScanId: historyRun.scanId,
          lifetimeCoverage: true,
        },
        observedAt: request.targetAnchor.snapshot.capturedAt,
        blockOrSlot: String(request.targetBlock),
        finality: 'finalized',
        summary:
          'Flap lifetime coverage is extended across a continuous finalized target and complete delta history.',
        sourceEvidenceIds,
      }),
      sourceEvidenceIds,
      request.targetAnchor.snapshot,
    ),
  );
  if (terminal.id !== evidenceIdFor(terminal, sourceEvidenceIds)) {
    throw new RangeError('Flap lifetime extension Evidence is not canonical.');
  }
  const evidenceIds = sortedUnique([...sourceEvidenceIds, terminal.id]);
  const sourceSet = sortedUnique([
    ...previous.metadata.sourceSet,
    ...history.metadata.sourceSet,
    request.targetAnchor.anchor.source,
    'zerotrace-data-quality',
  ]);
  return FlapLifetimeExtensionSchema.parse({
    platform: 'flap',
    token: request.token,
    dataset: 'binance-mainnet',
    datasetStartBlock: previous.datasetStartBlock,
    targetBlock: String(request.targetBlock),
    predecessor: {
      scanId: request.predecessor.scanId,
      targetBlock: String(request.previousTargetBlock),
      targetHash: previousSnapshot.blockHash,
      terminalEvidenceId: previous.terminalEvidenceId,
    },
    originScanId: previous.originScanId,
    origin: previous.origin,
    continuity: request.continuity,
    historyProjection: {
      scanId: historyRun.scanId,
      fromBlock: history.requestedRange.fromBlock,
      toBlock: history.requestedRange.toBlock,
      segmentCount: history.requestedRange.segmentCount,
      transactionCount: history.transactionCount,
      unrecognizedPortalLogCount: history.unrecognizedPortalLogCount,
      requestedRangeCoverage: history.requestedRangeCoverage,
      terminalEvidenceId: history.terminalEvidenceId,
    },
    lifetimeCoverage: knownValue(true),
    terminalEvidenceId: terminal.id,
    metadata: AnalysisMetadataSchema.parse({
      snapshot: request.targetAnchor.snapshot,
      dataCoverage: 1,
      sourceCoverage: Math.min(1, sourceSet.length / 3),
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: request.targetAnchor.snapshot.capturedAt,
      sourceSet,
      modelVersion: FLAP_LIFETIME_EXTENSION_MODEL_VERSION,
      confidence: Math.min(previous.metadata.confidence, history.metadata.confidence),
      evidenceIds,
    }),
    evidence: [terminal],
  });
}

export async function extendFlapLifetimeRestartSafe(
  options: ExtendFlapLifetimeOptions,
): Promise<FlapLifetimeExtensionRun> {
  const request = validateRequest(options);
  const deltaSize = request.targetBlock - request.deltaFromBlock + 1;
  let checkpoint: ExtensionCheckpointRun | undefined;
  try {
    checkpoint = (await request.checkpoints.begin({
      scanType: 'FLAP_LIFETIME_EXTENSION',
      source: FLAP_LIFETIME_EXTENSION_SOURCE,
      ledger: 'EVM',
      chainId: request.deployment.chainId,
      subject: request.token,
      fromBlock: request.deltaFromBlock,
      toBlock: request.targetBlock,
      chunkSize: deltaSize,
      identity: checkpointIdentity(request),
      initialState: stateJson(null),
    })) as ExtensionCheckpointRun;
    const stored = parseStoredResult(checkpoint, request);
    if (checkpoint.status === 'REQUESTED_RANGE_COMPLETE') {
      if (stored === null) throw new RangeError('Completed Flap lifetime extension vanished.');
      return { scanId: checkpoint.id, result: stored };
    }
    if (checkpoint.nextBlock === request.targetBlock + 1) {
      if (stored === null) throw new RangeError('Advanced Flap lifetime extension vanished.');
      const completed = (await request.checkpoints.finish(checkpoint.id, {
        state: checkpoint.state,
        evidenceIds: checkpoint.evidenceIds,
      })) as ExtensionCheckpointRun;
      const result = parseStoredResult(completed, request);
      if (result === null) throw new RangeError('Completed Flap lifetime extension vanished.');
      return { scanId: completed.id, result };
    }
    if (checkpoint.nextBlock !== request.deltaFromBlock || stored !== null) {
      throw new RangeError('Flap lifetime extension checkpoint cursor is invalid.');
    }
    const executeHistory = request.executeHistory ?? runFlapEventHistoryProjectionRestartSafe;
    const historyRun = await executeHistory({
      adapter: request.adapter,
      logReader: request.logReader,
      token: request.token,
      fromBlock: String(request.deltaFromBlock),
      toBlock: String(request.targetBlock),
      segmentSize: request.historySegmentSize,
      chunkSize: request.historyChunkSize,
      ...(request.historyMaxTransactions === undefined
        ? {}
        : { maxTransactions: request.historyMaxTransactions }),
      ...(request.historyMaxLogs === undefined ? {} : { maxLogs: request.historyMaxLogs }),
      deployment: request.deployment,
      checkpoints: request.checkpoints,
      projection: request.projection,
      writeEvidence: request.writeEvidence,
    });
    const result = await extensionResult(request, historyRun);
    const state = stateJson(result);
    checkpoint = (await request.checkpoints.advance(checkpoint.id, {
      expectedNextBlock: request.deltaFromBlock,
      completedToBlock: request.targetBlock,
      state,
      evidenceIds: result.metadata.evidenceIds,
    })) as ExtensionCheckpointRun;
    const completed = (await request.checkpoints.finish(checkpoint.id, {
      state,
      evidenceIds: result.metadata.evidenceIds,
    })) as ExtensionCheckpointRun;
    const replay = parseStoredResult(completed, request);
    if (replay === null) throw new RangeError('Flap lifetime extension terminal result vanished.');
    return { scanId: completed.id, result: replay };
  } catch (error) {
    if (checkpoint?.status === 'RUNNING') {
      try {
        await request.checkpoints.recordFailure(checkpoint.id, safeFailureCode(error));
      } catch {
        // Preserve the primary history, Evidence, or checkpoint failure.
      }
    }
    throw error;
  }
}
