import type {
  EvmContractCreationReader,
  EvmLedgerAdapter,
  EvmLogReader,
  SqdDatasetMetadata,
} from '@zerotrace/chain-adapters';
import { createEvidence, evidenceIdFor } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  ChainAnchorReadSchema,
  EvidenceSchema,
  FlapLifetimeMaterializationSchema,
  JsonValueSchema,
  knownValue,
  unknownValue,
  type ChainAnchorRead,
  type Evidence,
  type FlapLifetimeMaterialization,
  type JsonValue,
} from '@zerotrace/schemas';
import { getAddress } from 'viem';

import {
  FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE,
  FLAP_HISTORY_PROJECTION_MAX_RANGE_BLOCKS,
  runFlapEventHistoryProjectionRestartSafe,
  type FlapEventHistoryProjectionRun,
  type FlapHistoryProjectionStore,
} from './flap-history-projection.js';
import {
  FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS,
  FLAP_TOKEN_ORIGIN_MODEL_VERSION,
  runFlapTokenOriginRestartSafe,
  type FlapOriginCheckpointStore,
  type FlapTokenOriginRun,
} from './flap-origin.js';
import type { FlapDeployment, FlapEvidenceWriter } from './flap.js';

export const FLAP_LIFETIME_MATERIALIZATION_MODEL_VERSION = 'flap-lifetime-materialization-v1';
export const FLAP_LIFETIME_MATERIALIZATION_CHECKPOINT_VERSION =
  'flap-lifetime-materialization-checkpoint-v1';
export const FLAP_LIFETIME_MATERIALIZATION_SOURCE = `zerotrace:${FLAP_LIFETIME_MATERIALIZATION_MODEL_VERSION}`;

interface MaterializationCheckpointRun {
  id: string;
  status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
  nextBlock: number;
  state: JsonValue;
  evidenceIds: readonly string[];
}

export interface MaterializeFlapLifetimeOptions {
  adapter: EvmLedgerAdapter;
  creationReader: EvmContractCreationReader;
  logReader: EvmLogReader & { readonly endpointId: string };
  token: string;
  deployment: FlapDeployment;
  checkpoints: FlapOriginCheckpointStore;
  projection: FlapHistoryProjectionStore;
  writeEvidence: FlapEvidenceWriter;
  readDatasetMetadata(): Promise<SqdDatasetMetadata>;
  targetAnchor?: ChainAnchorRead;
  originChunkSize?: number;
  historySegmentSize?: number;
  historyChunkSize?: number;
  historyMaxTransactions?: number;
  historyMaxLogs?: number;
  executeOrigin?: (
    options: Parameters<typeof runFlapTokenOriginRestartSafe>[0],
  ) => Promise<FlapTokenOriginRun>;
  executeHistory?: (
    options: Parameters<typeof runFlapEventHistoryProjectionRestartSafe>[0],
  ) => Promise<FlapEventHistoryProjectionRun>;
}

export interface FlapLifetimeMaterializationRun {
  scanId: string;
  result: FlapLifetimeMaterialization;
}

interface ValidatedMaterializationRequest extends MaterializeFlapLifetimeOptions {
  token: string;
  datasetStartBlock: number;
  targetBlock: number;
  targetAnchor: ChainAnchorRead;
  datasetMetadata: SqdDatasetMetadata & { startBlock: number };
  originChunkSize: number;
  historySegmentSize: number;
  historyChunkSize: number;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
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

async function validateRequest(
  options: MaterializeFlapLifetimeOptions,
): Promise<ValidatedMaterializationRequest> {
  if (options.deployment.chainId !== 'eip155:56' || options.adapter.config.chainId !== 56) {
    throw new RangeError('Flap lifetime materialization requires the BSC deployment and adapter.');
  }
  if ((options.adapter.config.snapshotBlockTag ?? 'latest') !== 'finalized') {
    throw new RangeError('Flap lifetime materialization requires an explicit finalized adapter.');
  }
  let token: string;
  try {
    token = getAddress(options.token).toLowerCase();
  } catch {
    throw new RangeError('Flap lifetime materialization requires an EVM token address.');
  }
  const [rawMetadata, rawTarget] = await Promise.all([
    options.readDatasetMetadata(),
    options.targetAnchor === undefined
      ? options.adapter.readHeadAnchor()
      : Promise.resolve(options.targetAnchor),
  ]);
  if (
    rawMetadata.dataset !== 'binance-mainnet' ||
    rawMetadata.startBlock === null ||
    !Number.isSafeInteger(rawMetadata.startBlock) ||
    rawMetadata.startBlock < 0
  ) {
    throw new RangeError('SQD binance-mainnet must report a valid dataset start block.');
  }
  const targetAnchor = ChainAnchorReadSchema.parse(rawTarget);
  const targetBlock = Number(targetAnchor.anchor.position);
  if (
    targetAnchor.anchor.ledger !== 'EVM' ||
    targetAnchor.anchor.chainId !== 'eip155:56' ||
    targetAnchor.anchor.finality !== 'finalized' ||
    !Number.isSafeInteger(targetBlock) ||
    targetBlock < rawMetadata.startBlock ||
    !exactTargetSnapshot(targetAnchor.snapshot, targetAnchor)
  ) {
    throw new RangeError('Flap lifetime target must be an exact finalized BSC Snapshot.');
  }
  const requestedBlocks = targetBlock - rawMetadata.startBlock + 1;
  if (
    requestedBlocks > FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS ||
    requestedBlocks > FLAP_HISTORY_PROJECTION_MAX_RANGE_BLOCKS
  ) {
    throw new RangeError('Flap lifetime source-to-target range exceeds the durable safety limit.');
  }
  return {
    ...options,
    token,
    datasetStartBlock: rawMetadata.startBlock,
    targetBlock,
    targetAnchor,
    datasetMetadata: { ...rawMetadata, startBlock: rawMetadata.startBlock },
    originChunkSize: safeInteger(
      options.originChunkSize,
      FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
      'originChunkSize',
      1_000_000,
    ),
    historySegmentSize: safeInteger(
      options.historySegmentSize,
      FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE,
      'historySegmentSize',
      FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE,
    ),
    historyChunkSize: safeInteger(options.historyChunkSize, 2_000, 'historyChunkSize', 10_000),
  };
}

function checkpointState(result: FlapLifetimeMaterialization | null): JsonValue {
  return JsonValueSchema.parse({
    version: FLAP_LIFETIME_MATERIALIZATION_CHECKPOINT_VERSION,
    result,
  });
}

function parseCheckpointResult(
  run: MaterializationCheckpointRun,
  request: ValidatedMaterializationRequest,
): FlapLifetimeMaterialization | null {
  const parsed = JsonValueSchema.safeParse(run.state);
  if (
    !parsed.success ||
    typeof parsed.data !== 'object' ||
    parsed.data === null ||
    Array.isArray(parsed.data)
  ) {
    throw new RangeError('Flap lifetime checkpoint state is invalid.');
  }
  if (parsed.data.version !== FLAP_LIFETIME_MATERIALIZATION_CHECKPOINT_VERSION) {
    throw new RangeError('Flap lifetime checkpoint version is unsupported.');
  }
  if (parsed.data.result === null) return null;
  const result = FlapLifetimeMaterializationSchema.parse(parsed.data.result);
  if (
    result.token !== request.token ||
    Number(result.datasetStartBlock) !== request.datasetStartBlock ||
    Number(result.targetBlock) !== request.targetBlock ||
    !exactTargetSnapshot(result.metadata.snapshot, request.targetAnchor)
  ) {
    throw new RangeError('Flap lifetime checkpoint result conflicts with its immutable identity.');
  }
  return result;
}

function checkpointIdentity(
  request: ValidatedMaterializationRequest,
): Readonly<Record<string, JsonValue>> {
  return {
    version: FLAP_LIFETIME_MATERIALIZATION_CHECKPOINT_VERSION,
    modelVersion: FLAP_LIFETIME_MATERIALIZATION_MODEL_VERSION,
    token: request.token,
    chainId: request.deployment.chainId,
    portal: request.deployment.portal.toLowerCase(),
    documentedVersion: request.deployment.documentedVersion,
    sourceRevision: request.deployment.sourceRevision,
    dataset: request.datasetMetadata.dataset,
    datasetStartBlock: request.datasetStartBlock,
    datasetRealTime: request.datasetMetadata.realTime,
    targetBlock: request.targetBlock,
    targetHash: request.targetAnchor.anchor.hash,
    targetFinality: request.targetAnchor.anchor.finality,
    originChunkSize: request.originChunkSize,
    historySegmentSize: request.historySegmentSize,
    historyChunkSize: request.historyChunkSize,
    historyMaxTransactions: request.historyMaxTransactions ?? null,
    historyMaxLogs: request.historyMaxLogs ?? null,
  };
}

function terminalOriginEvidence(run: FlapTokenOriginRun): Evidence {
  const evidence = [...run.result.evidence]
    .reverse()
    .find(
      (item) =>
        item.source === `zerotrace:${FLAP_TOKEN_ORIGIN_MODEL_VERSION}` &&
        item.locator.startsWith('flap-token-origin:'),
    );
  if (evidence === undefined) throw new RangeError('Flap origin terminal Evidence is unavailable.');
  return evidence;
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
  return 'FLAP_LIFETIME_MATERIALIZATION_FAILED';
}

async function materializationEvidence(
  request: ValidatedMaterializationRequest,
  originRun: FlapTokenOriginRun,
  historyRun: FlapEventHistoryProjectionRun | null,
  sourceEvidence: readonly Evidence[],
): Promise<FlapLifetimeMaterialization> {
  const origin = originRun.result;
  if (
    origin.token !== request.token ||
    origin.searchedRange.fromBlock !== String(request.datasetStartBlock) ||
    origin.searchedRange.toBlock !== String(request.targetBlock) ||
    origin.searchedRangeCoverage !== 1 ||
    !exactTargetSnapshot(origin.metadata.snapshot, request.targetAnchor)
  ) {
    throw new RangeError('Flap origin result does not prove dataset-start-to-target coverage.');
  }
  const originTerminal = terminalOriginEvidence(originRun);
  let historySummary: FlapLifetimeMaterialization['historyProjection'] = null;
  let lifetimeCoverage: FlapLifetimeMaterialization['lifetimeCoverage'] = unknownValue(
    origin.origin.state === 'unknown' ? origin.origin.reason : 'INSUFFICIENT_DATA',
    'A unique deployment origin and complete origin-to-target event projection are required.',
  );
  const sourceEvidenceIds = sourceEvidence.map((item) => item.id);
  sourceEvidenceIds.push(originTerminal.id);
  const sourceSet = new Set<string>([
    'sqd:binance-mainnet',
    request.targetAnchor.anchor.source,
    ...origin.metadata.sourceSet,
  ]);
  let confidence = origin.metadata.confidence;

  if (origin.origin.state === 'known') {
    if (historyRun === null) {
      throw new RangeError('Known Flap origin is missing its event-history projection.');
    }
    const history = historyRun.result;
    if (
      history.token !== request.token ||
      history.requestedRange.fromBlock !== origin.origin.value.creationTrace.blockNumber ||
      history.requestedRange.toBlock !== String(request.targetBlock) ||
      history.requestedRangeCoverage !== 1 ||
      !exactTargetSnapshot(history.metadata.snapshot, request.targetAnchor)
    ) {
      throw new RangeError('Flap event history does not prove exact origin-to-target coverage.');
    }
    sourceEvidenceIds.push(history.terminalEvidenceId);
    for (const source of history.metadata.sourceSet) sourceSet.add(source);
    confidence = Math.min(confidence, history.metadata.confidence);
    historySummary = {
      scanId: historyRun.scanId,
      fromBlock: history.requestedRange.fromBlock,
      toBlock: history.requestedRange.toBlock,
      segmentCount: history.requestedRange.segmentCount,
      transactionCount: history.transactionCount,
      unrecognizedPortalLogCount: history.unrecognizedPortalLogCount,
      requestedRangeCoverage: history.requestedRangeCoverage,
      terminalEvidenceId: history.terminalEvidenceId,
    };
    lifetimeCoverage = knownValue(true);
  } else if (historyRun !== null) {
    throw new RangeError('Unknown Flap origin cannot carry a lifetime history projection.');
  }

  const canonicalSources = sortedUnique(sourceEvidenceIds);
  const terminal = EvidenceSchema.parse(
    await request.writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: request.deployment.chainId,
        kind: 'DERIVED_FEATURE',
        source: FLAP_LIFETIME_MATERIALIZATION_SOURCE,
        locator: `flap-lifetime:${request.token}@${request.targetBlock}`,
        payload: {
          token: request.token,
          dataset: request.datasetMetadata.dataset,
          datasetStartBlock: String(request.datasetStartBlock),
          targetBlock: String(request.targetBlock),
          originScanId: originRun.scanId,
          originState: origin.origin.state,
          historyScanId: historyRun?.scanId ?? null,
          lifetimeCoverageState: lifetimeCoverage.state,
        },
        observedAt: request.targetAnchor.snapshot.capturedAt,
        blockOrSlot: String(request.targetBlock),
        finality: 'finalized',
        summary:
          lifetimeCoverage.state === 'known'
            ? 'Flap deployment origin and every supported Portal event are materialized through one finalized target Snapshot.'
            : 'Flap lifetime coverage remains Unknown because a unique deployment origin was not established.',
        sourceEvidenceIds: canonicalSources,
      }),
      canonicalSources,
      request.targetAnchor.snapshot,
    ),
  );
  if (terminal.id !== evidenceIdFor(terminal, canonicalSources)) {
    throw new RangeError('Flap lifetime terminal Evidence is not canonical.');
  }
  const evidenceIds = sortedUnique([...canonicalSources, terminal.id]);
  return FlapLifetimeMaterializationSchema.parse({
    platform: 'flap',
    token: request.token,
    dataset: 'binance-mainnet',
    datasetStartBlock: String(request.datasetStartBlock),
    targetBlock: String(request.targetBlock),
    originScanId: originRun.scanId,
    originSearchCoverage: origin.searchedRangeCoverage,
    origin: origin.origin,
    historyProjection: historySummary,
    lifetimeCoverage,
    terminalEvidenceId: terminal.id,
    metadata: AnalysisMetadataSchema.parse({
      snapshot: request.targetAnchor.snapshot,
      dataCoverage: 1,
      sourceCoverage: Math.min(1, sourceSet.size / 2),
      historyCoverage: lifetimeCoverage.state === 'known' ? 1 : 0,
      simulationCoverage: 0,
      freshness: request.targetAnchor.snapshot.capturedAt,
      sourceSet: [...sourceSet].sort(),
      modelVersion: FLAP_LIFETIME_MATERIALIZATION_MODEL_VERSION,
      confidence,
      evidenceIds,
    }),
    evidence: [terminal],
  });
}

export async function materializeFlapLifetimeRestartSafe(
  options: MaterializeFlapLifetimeOptions,
): Promise<FlapLifetimeMaterializationRun> {
  const request = await validateRequest(options);
  const rangeSize = request.targetBlock - request.datasetStartBlock + 1;
  let checkpoint: MaterializationCheckpointRun | undefined;
  try {
    checkpoint = (await request.checkpoints.begin({
      scanType: 'FLAP_LIFETIME_MATERIALIZATION',
      source: FLAP_LIFETIME_MATERIALIZATION_SOURCE,
      ledger: 'EVM',
      chainId: request.deployment.chainId,
      subject: request.token,
      fromBlock: request.datasetStartBlock,
      toBlock: request.targetBlock,
      chunkSize: rangeSize,
      identity: checkpointIdentity(request),
      initialState: checkpointState(null),
    })) as MaterializationCheckpointRun;
    const storedResult = parseCheckpointResult(checkpoint, request);
    if (checkpoint.status === 'REQUESTED_RANGE_COMPLETE') {
      if (storedResult === null) throw new RangeError('Completed Flap lifetime result vanished.');
      return { scanId: checkpoint.id, result: storedResult };
    }
    if (checkpoint.nextBlock === request.targetBlock + 1) {
      if (storedResult === null) throw new RangeError('Advanced Flap lifetime result vanished.');
      const completed = (await request.checkpoints.finish(checkpoint.id, {
        state: checkpoint.state,
        evidenceIds: checkpoint.evidenceIds,
      })) as MaterializationCheckpointRun;
      const result = parseCheckpointResult(completed, request);
      if (result === null) throw new RangeError('Completed Flap lifetime result vanished.');
      return { scanId: completed.id, result };
    }
    if (checkpoint.nextBlock !== request.datasetStartBlock || storedResult !== null) {
      throw new RangeError('Flap lifetime checkpoint has an invalid single-advance cursor.');
    }

    const metadataEvidence = EvidenceSchema.parse(
      await request.writeEvidence(
        createEvidence({
          ledger: 'EVM',
          chainId: request.deployment.chainId,
          kind: 'PROVIDER_OBSERVATION',
          source: 'sqd:binance-mainnet',
          locator: 'sqd-dataset-metadata:binance-mainnet',
          payload: request.datasetMetadata,
          observedAt: request.targetAnchor.snapshot.capturedAt,
          blockOrSlot: String(request.targetBlock),
          finality: 'finalized',
          summary: 'SQD binance-mainnet dataset start and real-time metadata observed.',
        }),
        [],
        request.targetAnchor.snapshot,
      ),
    );
    const targetEvidence = EvidenceSchema.parse(
      await request.writeEvidence(
        createEvidence({
          ledger: 'EVM',
          chainId: request.deployment.chainId,
          kind: 'BLOCK',
          source: request.targetAnchor.anchor.source,
          locator: `block:${request.targetAnchor.anchor.position}:${request.targetAnchor.anchor.hash}`,
          payload: request.targetAnchor.payload,
          observedAt: request.targetAnchor.snapshot.capturedAt,
          blockOrSlot: String(request.targetBlock),
          finality: 'finalized',
          summary: 'Finalized BSC target block for Flap lifetime materialization.',
        }),
        [],
        request.targetAnchor.snapshot,
      ),
    );
    const executeOrigin = request.executeOrigin ?? runFlapTokenOriginRestartSafe;
    const originRun = await executeOrigin({
      adapter: request.adapter,
      creationReader: request.creationReader,
      token: request.token,
      fromBlock: String(request.datasetStartBlock),
      toBlock: String(request.targetBlock),
      chunkSize: request.originChunkSize,
      deployment: request.deployment,
      checkpoints: request.checkpoints,
      writeEvidence: request.writeEvidence,
    });
    let historyRun: FlapEventHistoryProjectionRun | null = null;
    if (originRun.result.origin.state === 'known') {
      const executeHistory = request.executeHistory ?? runFlapEventHistoryProjectionRestartSafe;
      historyRun = await executeHistory({
        adapter: request.adapter,
        logReader: request.logReader,
        token: request.token,
        fromBlock: originRun.result.origin.value.creationTrace.blockNumber,
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
    }
    const result = await materializationEvidence(request, originRun, historyRun, [
      metadataEvidence,
      targetEvidence,
    ]);
    const state = checkpointState(result);
    checkpoint = (await request.checkpoints.advance(checkpoint.id, {
      expectedNextBlock: request.datasetStartBlock,
      completedToBlock: request.targetBlock,
      state,
      evidenceIds: result.metadata.evidenceIds,
    })) as MaterializationCheckpointRun;
    const completed = (await request.checkpoints.finish(checkpoint.id, {
      state,
      evidenceIds: result.metadata.evidenceIds,
    })) as MaterializationCheckpointRun;
    const replay = parseCheckpointResult(completed, request);
    if (replay === null) throw new RangeError('Flap lifetime terminal result vanished.');
    return { scanId: completed.id, result: replay };
  } catch (error) {
    if (checkpoint?.status === 'RUNNING') {
      try {
        await request.checkpoints.recordFailure(checkpoint.id, safeFailureCode(error));
      } catch {
        // Preserve the original provider, validation, Evidence, or checkpoint failure.
      }
    }
    throw error;
  }
}
