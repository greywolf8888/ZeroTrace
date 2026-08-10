import { ProviderError, type EvmLedgerAdapter, type EvmLogReader } from '@zerotrace/chain-adapters';
import { createEvidence, evidenceIdFor } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  ChainAnchorReadSchema,
  EvidenceSchema,
  EvmClaimBurnCandidateDiscoverySchema,
  EvmClaimBurnConservationSchema,
  EvmClaimBurnPromotionSchema,
  EvmClaimBurnPromotionSegmentSchema,
  EvmSnapshotSchema,
  JsonValueSchema,
  unknownValue,
  type AnalysisSnapshot,
  type EvmClaimBurnCandidateDiscovery,
  type EvmClaimBurnConservation,
  type EvmClaimBurnPromotion,
  type EvmClaimBurnPromotionSegment,
  type JsonValue,
} from '@zerotrace/schemas';
import { getAddress } from 'viem';

import {
  discoverErc20BurnCandidates,
  type DiscoverErc20BurnCandidatesOptions,
  type Erc20BurnCandidateDiscoveryRun,
} from './claim-evm-burn-discovery.js';
import {
  observeEvmClaimBurnBlock,
  type EvmClaimBurnBlockRun,
  type EvmClaimBurnEvidenceWriter,
  type ObserveEvmClaimBurnBlockOptions,
} from './claim-evm-burn.js';

export const ERC20_BURN_PROMOTION_MODEL_VERSION = 'erc20-burn-candidate-promotion-v1.0.0';
export const ERC20_BURN_PROMOTION_CHECKPOINT_VERSION =
  'erc20-burn-candidate-promotion-checkpoint-v1';
export const ERC20_BURN_PROMOTION_SCAN_TYPE = 'ERC20_BURN_CANDIDATE_PROMOTION';
export const ERC20_BURN_PROMOTION_SOURCE = 'sqd:binance-mainnet';
export const ERC20_BURN_PROMOTION_DEFAULT_SEGMENT_SIZE = 1_000_000;
export const ERC20_BURN_PROMOTION_MAX_SEGMENTS = 5;
export const ERC20_BURN_PROMOTION_MAX_RANGE_BLOCKS =
  ERC20_BURN_PROMOTION_DEFAULT_SEGMENT_SIZE * ERC20_BURN_PROMOTION_MAX_SEGMENTS;

export interface Erc20BurnPromotionCheckpointRun {
  id: string;
  status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
  nextBlock: number;
  state: JsonValue;
  evidenceIds: readonly string[];
}

export interface Erc20BurnPromotionCheckpointStore {
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
  }): Promise<Erc20BurnPromotionCheckpointRun>;
  advance(
    id: string,
    input: {
      expectedNextBlock: number;
      completedToBlock: number;
      state: JsonValue;
      evidenceIds: readonly string[];
    },
  ): Promise<Erc20BurnPromotionCheckpointRun>;
  finish(
    id: string,
    input: { state: JsonValue; evidenceIds: readonly string[] },
  ): Promise<Erc20BurnPromotionCheckpointRun>;
  recordFailure(id: string, errorCode: string): Promise<Erc20BurnPromotionCheckpointRun>;
}

export type Erc20BurnPromotionDiscoveryExecutor = (
  options: DiscoverErc20BurnCandidatesOptions,
) => Promise<Erc20BurnCandidateDiscoveryRun>;

export type Erc20BurnPromotionCertificateExecutor = (
  options: ObserveEvmClaimBurnBlockOptions,
) => Promise<EvmClaimBurnBlockRun>;

export interface PromoteErc20BurnCandidatesOptions {
  adapter: EvmLedgerAdapter;
  logReader: EvmLogReader & { readonly endpointId: string };
  tokenAddress: string;
  fromBlock: string;
  toBlock: string;
  checkpoints: Erc20BurnPromotionCheckpointStore;
  writeEvidence: EvmClaimBurnEvidenceWriter;
  segmentSize?: number | undefined;
  maxTransfers?: number | undefined;
  maxCandidatesPerSegment?: number | undefined;
  discoverSegment?: Erc20BurnPromotionDiscoveryExecutor | undefined;
  certifyCandidate?: Erc20BurnPromotionCertificateExecutor | undefined;
}

interface ValidatedRequest extends PromoteErc20BurnCandidatesOptions {
  tokenAddress: string;
  fromBlockNumber: number;
  toBlockNumber: number;
  selectedSegmentSize: number;
  selectedMaxTransfers: number;
  selectedMaxCandidates: number;
}

interface PromotionCheckpointState {
  segments: EvmClaimBurnPromotionSegment[];
  snapshot: AnalysisSnapshot | null;
  sourceSet: string[];
  result: EvmClaimBurnPromotion | null;
}

export interface Erc20BurnPromotionRun {
  scanId: string;
  result: EvmClaimBurnPromotion;
}

export interface Erc20BurnPromotionReplayRun extends Erc20BurnPromotionCheckpointRun {
  scanType: string;
  source: string;
  ledger: string;
  chainId: string;
  subject: string;
  fromBlock: number;
  toBlock: number;
  chunkSize: number;
}

function invalid(message: string, cause?: unknown): ProviderError {
  return new ProviderError('INVALID_RESPONSE', message, { cause });
}

function safeBlock(value: string, field: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `${field} must be an unsigned integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProviderError('INVALID_RESPONSE', `${field} exceeds the durable cursor range.`);
  }
  return parsed;
}

function boundedInteger(value: number | undefined, fallback: number, field: string, max: number) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > max) {
    throw new RangeError(`${field} must be between 1 and ${max}.`);
  }
  return resolved;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stateJson(state: PromotionCheckpointState): JsonValue {
  return JsonValueSchema.parse({
    version: ERC20_BURN_PROMOTION_CHECKPOINT_VERSION,
    segments: state.segments,
    snapshot: state.snapshot,
    sourceSet: state.sourceSet,
    result: state.result,
  });
}

function initialState(): JsonValue {
  return stateJson({ segments: [], snapshot: null, sourceSet: [], result: null });
}

function record(value: JsonValue, field: string): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`Burn promotion checkpoint ${field} must be an object.`);
  }
  return value;
}

function canonicalStrings(value: JsonValue | undefined, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw invalid(`Burn promotion checkpoint ${field} is invalid.`);
  }
  const canonical = sortedUnique(value);
  if (!sameStrings(canonical, value)) {
    throw invalid(`Burn promotion checkpoint ${field} is not canonical.`);
  }
  return canonical;
}

function terminalIds(
  segments: readonly EvmClaimBurnPromotionSegment[],
  result?: EvmClaimBurnPromotion,
) {
  return sortedUnique([
    ...segments.flatMap((segment) => [
      segment.discoveryTerminalEvidenceId,
      ...segment.certificates.map((certificate) => certificate.terminalEvidenceId),
    ]),
    ...(result === undefined ? [] : [result.terminalEvidenceId]),
  ]);
}

function expectedSegmentEnd(request: ValidatedRequest, fromBlock: number): number {
  return Math.min(fromBlock + request.selectedSegmentSize - 1, request.toBlockNumber);
}

function validateRequest(options: PromoteErc20BurnCandidatesOptions): ValidatedRequest {
  let tokenAddress: string;
  try {
    tokenAddress = getAddress(options.tokenAddress).toLowerCase();
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', 'Burn promotion token must be an EVM address.', {
      cause: error,
    });
  }
  if (options.adapter.config.chainId !== 56) {
    throw new ProviderError('INVALID_RESPONSE', 'Burn promotion currently requires BSC mainnet.');
  }
  if (options.logReader.endpointId !== ERC20_BURN_PROMOTION_SOURCE) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Burn promotion requires the versioned BSC SQD event source.',
    );
  }
  const fromBlockNumber = safeBlock(options.fromBlock, 'fromBlock');
  const toBlockNumber = safeBlock(options.toBlock, 'toBlock');
  if (toBlockNumber < fromBlockNumber) {
    throw new RangeError('Burn promotion range must be ordered.');
  }
  if (toBlockNumber - fromBlockNumber + 1 > ERC20_BURN_PROMOTION_MAX_RANGE_BLOCKS) {
    throw new RangeError(
      `Burn promotion is limited to ${ERC20_BURN_PROMOTION_MAX_RANGE_BLOCKS} blocks per run.`,
    );
  }
  const selectedSegmentSize = boundedInteger(
    options.segmentSize,
    ERC20_BURN_PROMOTION_DEFAULT_SEGMENT_SIZE,
    'segmentSize',
    ERC20_BURN_PROMOTION_DEFAULT_SEGMENT_SIZE,
  );
  if (Math.ceil((toBlockNumber - fromBlockNumber + 1) / selectedSegmentSize) > 5) {
    throw new RangeError('Burn promotion is limited to five durable segments per run.');
  }
  return {
    ...options,
    tokenAddress,
    fromBlockNumber,
    toBlockNumber,
    selectedSegmentSize,
    selectedMaxTransfers: boundedInteger(options.maxTransfers, 25_000, 'maxTransfers', 100_000),
    selectedMaxCandidates: boundedInteger(
      options.maxCandidatesPerSegment,
      512,
      'maxCandidatesPerSegment',
      2_000,
    ),
  };
}

function checkpointIdentity(request: ValidatedRequest): Readonly<Record<string, JsonValue>> {
  return {
    checkpointVersion: ERC20_BURN_PROMOTION_CHECKPOINT_VERSION,
    modelVersion: ERC20_BURN_PROMOTION_MODEL_VERSION,
    tokenAddress: request.tokenAddress,
    segmentSize: request.selectedSegmentSize,
    maxTransfers: request.selectedMaxTransfers,
    maxCandidatesPerSegment: request.selectedMaxCandidates,
    snapshotSourceSetPolicy: 'provider-versions-v1',
    coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION',
  };
}

function parseCheckpointState(
  run: Erc20BurnPromotionCheckpointRun,
  request: ValidatedRequest,
): PromotionCheckpointState {
  const parsedJson = JsonValueSchema.safeParse(run.state);
  if (!parsedJson.success)
    throw invalid('Burn promotion checkpoint is not JSON.', parsedJson.error);
  const value = record(parsedJson.data, 'state');
  if (value.version !== ERC20_BURN_PROMOTION_CHECKPOINT_VERSION) {
    throw invalid('Burn promotion checkpoint version is unsupported.');
  }
  if (!Array.isArray(value.segments)) {
    throw invalid('Burn promotion checkpoint segments are invalid.');
  }
  const segments = value.segments.map((segment) => {
    const parsed = EvmClaimBurnPromotionSegmentSchema.safeParse(segment);
    if (!parsed.success)
      throw invalid('Burn promotion checkpoint segment is invalid.', parsed.error);
    return parsed.data;
  });
  const snapshot =
    value.snapshot === null
      ? null
      : (() => {
          const parsed = EvmSnapshotSchema.safeParse(value.snapshot);
          if (!parsed.success) throw invalid('Burn promotion checkpoint Snapshot is invalid.');
          return parsed.data;
        })();
  const sourceSet = canonicalStrings(value.sourceSet, 'source set');
  const result =
    value.result === null
      ? null
      : (() => {
          const parsed = EvmClaimBurnPromotionSchema.safeParse(value.result);
          if (!parsed.success)
            throw invalid('Burn promotion checkpoint result is invalid.', parsed.error);
          return parsed.data;
        })();
  let expectedFrom = request.fromBlockNumber;
  for (const segment of segments) {
    const expectedTo = expectedSegmentEnd(request, expectedFrom);
    if (segment.fromBlock !== String(expectedFrom) || segment.toBlock !== String(expectedTo)) {
      throw invalid('Burn promotion checkpoint segments are not contiguous.');
    }
    expectedFrom = expectedTo + 1;
  }
  if (run.nextBlock !== expectedFrom || run.nextBlock > request.toBlockNumber + 1) {
    throw invalid('Burn promotion checkpoint cursor is inconsistent.');
  }
  if (segments.length === 0) {
    if (snapshot !== null || sourceSet.length !== 0) {
      throw invalid('Unstarted burn promotion contains materialized state.');
    }
  } else {
    const last = segments.at(-1);
    const expectedSources = sortedUnique(segments.flatMap((segment) => segment.sourceSet));
    if (
      last === undefined ||
      snapshot?.ledger !== 'EVM' ||
      snapshot.blockNumber !== last.toBlock ||
      snapshot.blockHash.toLowerCase() !== last.snapshot.blockHash.toLowerCase() ||
      !sameStrings(sourceSet, expectedSources)
    ) {
      throw invalid('Burn promotion checkpoint materialized state is inconsistent.');
    }
  }
  const expectedEvidenceIds = terminalIds(segments, result ?? undefined);
  const actualEvidenceIds = sortedUnique(run.evidenceIds);
  if (
    !sameStrings(expectedEvidenceIds, actualEvidenceIds) ||
    actualEvidenceIds.length !== run.evidenceIds.length
  ) {
    throw invalid('Burn promotion checkpoint Evidence identities are inconsistent.');
  }
  if (run.status === 'REQUESTED_RANGE_COMPLETE') {
    if (run.nextBlock !== request.toBlockNumber + 1 || result === null) {
      throw invalid('Completed burn promotion checkpoint has no terminal result.');
    }
  } else if (result !== null) {
    throw invalid('Running burn promotion checkpoint contains a terminal result.');
  }
  return { segments, snapshot, sourceSet, result };
}

function exactSnapshot(
  raw: Awaited<ReturnType<EvmLedgerAdapter['readAnchorAt']>>,
  blockNumber: string,
  expectedHash?: string,
) {
  const anchor = ChainAnchorReadSchema.parse(raw);
  const parsed = EvmSnapshotSchema.safeParse(anchor.snapshot);
  if (
    !parsed.success ||
    anchor.anchor.ledger !== 'EVM' ||
    anchor.anchor.chainId !== 'eip155:56' ||
    anchor.anchor.position !== blockNumber ||
    anchor.anchor.finality !== 'finalized' ||
    parsed.data.chainId !== 'eip155:56' ||
    parsed.data.blockNumber !== blockNumber ||
    parsed.data.finality !== 'finalized' ||
    parsed.data.blockTimestamp === undefined ||
    anchor.anchor.hash.toLowerCase() !== parsed.data.blockHash.toLowerCase() ||
    (expectedHash !== undefined &&
      parsed.data.blockHash.toLowerCase() !== expectedHash.toLowerCase())
  ) {
    throw invalid('Burn promotion provider returned an inconsistent finalized block Snapshot.');
  }
  return parsed.data;
}

function validateCertificate(
  discovery: EvmClaimBurnCandidateDiscovery,
  candidateIndex: number,
  report: EvmClaimBurnConservation,
) {
  const candidate = discovery.candidates[candidateIndex];
  if (candidate === undefined) throw invalid('Burn promotion candidate vanished.');
  const candidateTransfers = [...candidate.burnTransferIds].sort();
  const certifiedTransfers = [...report.candidateBurnTransferIds].sort();
  if (
    report.tokenAddress.toLowerCase() !== discovery.tokenAddress.toLowerCase() ||
    report.blockNumber !== candidate.blockNumber ||
    report.blockHash.toLowerCase() !== candidate.blockHash.toLowerCase() ||
    report.mintedAmount !== candidate.mintedEventAmount ||
    report.burnedAmount !== candidate.burnedEventAmount ||
    !sameStrings(candidateTransfers, certifiedTransfers) ||
    report.status === 'NOT_APPLICABLE'
  ) {
    throw invalid('Exact-block certificate does not match its discovered burn candidate.');
  }
  return {
    blockNumber: candidate.blockNumber,
    blockHash: candidate.blockHash.toLowerCase(),
    burnTransferIds: candidateTransfers,
    mintedEventAmount: candidate.mintedEventAmount,
    burnedEventAmount: candidate.burnedEventAmount,
    status: report.status,
    actionCount: report.actions.length,
    terminalEvidenceId: report.terminalEvidenceId,
  } as const;
}

async function executeSegment(
  request: ValidatedRequest,
  fromBlock: number,
  toBlock: number,
): Promise<EvmClaimBurnPromotionSegment> {
  const snapshot = exactSnapshot(
    await request.adapter.readAnchorAt(String(toBlock)),
    String(toBlock),
  );
  const discover = request.discoverSegment ?? discoverErc20BurnCandidates;
  const discoveryRun = await discover({
    tokenAddress: request.tokenAddress,
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
    snapshot,
    logReader: request.logReader,
    blockReader: request.adapter,
    writeEvidence: request.writeEvidence,
    maxBlocksPerRequest: request.selectedSegmentSize,
    maxRequests: 2,
    maxTransfers: request.selectedMaxTransfers,
    maxCandidates: request.selectedMaxCandidates,
    now: () => snapshot.capturedAt,
  });
  const discovery = EvmClaimBurnCandidateDiscoverySchema.parse(discoveryRun.report);
  const certify = request.certifyCandidate ?? observeEvmClaimBurnBlock;
  const certificates = [];
  const certificateSources: string[] = [];
  for (let index = 0; index < discovery.candidates.length; index += 1) {
    const candidate = discovery.candidates[index];
    if (candidate === undefined) throw invalid('Burn promotion candidate vanished.');
    const candidateSnapshot = exactSnapshot(
      await request.adapter.readAnchorAt(candidate.blockNumber),
      candidate.blockNumber,
      candidate.blockHash,
    );
    const certificateRun = await certify({
      tokenAddress: request.tokenAddress,
      snapshot: candidateSnapshot,
      adapter: request.adapter,
      logReader: request.logReader,
      blockReader: request.adapter,
      writeEvidence: request.writeEvidence,
      maxTransfers: request.selectedMaxTransfers,
      now: () => candidateSnapshot.capturedAt,
    });
    const report = EvmClaimBurnConservationSchema.parse(certificateRun.report);
    certificates.push(validateCertificate(discovery, index, report));
    certificateSources.push(...report.metadata.sourceSet);
  }
  return EvmClaimBurnPromotionSegmentSchema.parse({
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
    zeroAddressEventCount: discovery.zeroAddressEventCount,
    burnCandidateCount: discovery.burnCandidateCount,
    discoveryTerminalEvidenceId: discovery.terminalEvidenceId,
    certificates,
    snapshot,
    sourceSet: sortedUnique([
      ...Object.keys(snapshot.providerVersions),
      ...discovery.metadata.sourceSet,
      ...certificateSources,
    ]),
  });
}

async function terminalResult(
  request: ValidatedRequest,
  state: PromotionCheckpointState,
): Promise<EvmClaimBurnPromotion> {
  const snapshot = EvmSnapshotSchema.parse(state.snapshot);
  const sourceEvidenceIds = terminalIds(state.segments);
  const certificates = state.segments.flatMap((segment) => segment.certificates);
  const observedAt = snapshot.capturedAt;
  const silentSupplyChangeDetection = unknownValue(
    'NOT_QUERIED',
    'This durable run proves zero-address event coverage and exact candidate-block conservation only. Silent totalSupply changes require an all-block state analysis.',
  );
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${ERC20_BURN_PROMOTION_MODEL_VERSION}`,
    locator: `erc20-burn-promotion:${request.tokenAddress}:${request.fromBlockNumber}-${request.toBlockNumber}@${snapshot.blockHash.toLowerCase()}`,
    payload: {
      tokenAddress: request.tokenAddress,
      fromBlock: String(request.fromBlockNumber),
      toBlock: String(request.toBlockNumber),
      coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION',
      segmentCount: state.segments.length,
      zeroAddressEventCount: state.segments.reduce(
        (total, segment) => total + segment.zeroAddressEventCount,
        0,
      ),
      burnCandidateCount: certificates.length,
      verifiedCandidateCount: certificates.filter((item) => item.status === 'VERIFIED').length,
      contradictedCandidateCount: certificates.filter((item) => item.status === 'CONTRADICTED')
        .length,
      verifiedActionCount: certificates
        .filter((item) => item.status === 'VERIFIED')
        .reduce((total, item) => total + item.actionCount, 0),
      silentSupplyChangeDetection,
    },
    observedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: 'finalized',
    summary:
      certificates.length === 0
        ? 'Durable zero-address event coverage completed with no burn candidates; silent supply changes remain Unknown.'
        : 'Durable zero-address burn candidates were promoted through exact-block supply-conservation certificates.',
    sourceEvidenceIds,
  });
  const persisted = EvidenceSchema.parse(
    await request.writeEvidence(terminal, sourceEvidenceIds, snapshot),
  );
  if (
    persisted.id !== terminal.id ||
    persisted.id !== evidenceIdFor(persisted, sourceEvidenceIds)
  ) {
    throw invalid('Burn promotion terminal Evidence is not canonical.');
  }
  return EvmClaimBurnPromotionSchema.parse({
    tokenAddress: request.tokenAddress,
    fromBlock: String(request.fromBlockNumber),
    toBlock: String(request.toBlockNumber),
    coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION',
    status: 'REQUESTED_RANGE_COMPLETE',
    segmentCount: state.segments.length,
    zeroAddressEventCount: state.segments.reduce(
      (total, segment) => total + segment.zeroAddressEventCount,
      0,
    ),
    burnCandidateCount: certificates.length,
    verifiedCandidateCount: certificates.filter((item) => item.status === 'VERIFIED').length,
    contradictedCandidateCount: certificates.filter((item) => item.status === 'CONTRADICTED')
      .length,
    verifiedActionCount: certificates
      .filter((item) => item.status === 'VERIFIED')
      .reduce((total, item) => total + item.actionCount, 0),
    segments: state.segments,
    silentSupplyChangeDetection,
    terminalEvidenceId: persisted.id,
    metadata: AnalysisMetadataSchema.parse({
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: state.sourceSet,
      modelVersion: ERC20_BURN_PROMOTION_MODEL_VERSION,
      confidence: 0.98,
      evidenceIds: sortedUnique([...sourceEvidenceIds, persisted.id]),
    }),
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
  return 'ERC20_BURN_PROMOTION_FAILED';
}

export function replayErc20BurnPromotionResult(
  run: Erc20BurnPromotionReplayRun,
): EvmClaimBurnPromotion | null {
  if (
    run.scanType !== ERC20_BURN_PROMOTION_SCAN_TYPE ||
    run.source !== ERC20_BURN_PROMOTION_SOURCE ||
    run.ledger !== 'EVM' ||
    run.chainId !== 'eip155:56'
  ) {
    throw invalid('Semantic checkpoint is not a BSC burn promotion run.');
  }
  const parsed = JsonValueSchema.safeParse(run.state);
  if (!parsed.success) throw invalid('Burn promotion replay state is not JSON.');
  const value = record(parsed.data, 'replay state');
  if (value.version !== ERC20_BURN_PROMOTION_CHECKPOINT_VERSION) {
    throw invalid('Burn promotion replay version is unsupported.');
  }
  if (
    !Number.isSafeInteger(run.fromBlock) ||
    !Number.isSafeInteger(run.toBlock) ||
    !Number.isSafeInteger(run.chunkSize) ||
    run.fromBlock < 0 ||
    run.toBlock < run.fromBlock ||
    run.chunkSize < 1 ||
    !Array.isArray(value.segments)
  ) {
    throw invalid('Burn promotion replay range or segments are invalid.');
  }
  const segments = value.segments.map((segment) => {
    const parsedSegment = EvmClaimBurnPromotionSegmentSchema.safeParse(segment);
    if (!parsedSegment.success) {
      throw invalid('Burn promotion replay segment is invalid.', parsedSegment.error);
    }
    return parsedSegment.data;
  });
  let expectedFromBlock = run.fromBlock;
  for (const segment of segments) {
    const expectedToBlock = Math.min(expectedFromBlock + run.chunkSize - 1, run.toBlock);
    if (
      segment.fromBlock !== String(expectedFromBlock) ||
      segment.toBlock !== String(expectedToBlock)
    ) {
      throw invalid('Burn promotion replay segments are not contiguous.');
    }
    expectedFromBlock = expectedToBlock + 1;
  }
  const sourceSet = canonicalStrings(value.sourceSet, 'replay source set');
  const expectedSourceSet = sortedUnique(segments.flatMap((segment) => segment.sourceSet));
  const parsedSnapshot =
    value.snapshot === null ? null : EvmSnapshotSchema.safeParse(value.snapshot);
  if (parsedSnapshot !== null && !parsedSnapshot.success) {
    throw invalid('Burn promotion replay Snapshot is invalid.', parsedSnapshot.error);
  }
  const snapshot = parsedSnapshot === null ? null : parsedSnapshot.data;
  const lastSegment = segments.at(-1);
  if (
    run.nextBlock !== expectedFromBlock ||
    !sameStrings(sourceSet, expectedSourceSet) ||
    (lastSegment === undefined
      ? snapshot !== null
      : snapshot === null ||
        snapshot.blockNumber !== lastSegment.toBlock ||
        snapshot.blockHash.toLowerCase() !== lastSegment.snapshot.blockHash.toLowerCase())
  ) {
    throw invalid('Burn promotion replay materialized state is inconsistent.');
  }
  if (run.status === 'RUNNING') {
    if (
      value.result !== null ||
      !sameStrings(terminalIds(segments), sortedUnique(run.evidenceIds)) ||
      run.evidenceIds.length !== new Set(run.evidenceIds).size
    ) {
      throw invalid('Running burn promotion checkpoint is inconsistent.');
    }
    return null;
  }
  const result = EvmClaimBurnPromotionSchema.safeParse(value.result);
  if (
    !result.success ||
    result.data.tokenAddress.toLowerCase() !== run.subject.toLowerCase() ||
    result.data.fromBlock !== String(run.fromBlock) ||
    result.data.toBlock !== String(run.toBlock) ||
    run.nextBlock !== run.toBlock + 1 ||
    JSON.stringify(result.data.segments) !== JSON.stringify(segments) ||
    !sameStrings([...result.data.metadata.evidenceIds].sort(), [...run.evidenceIds].sort()) ||
    run.evidenceIds.length !== new Set(run.evidenceIds).size
  ) {
    throw invalid('Completed burn promotion replay identity is inconsistent.');
  }
  return result.data;
}

export async function runErc20BurnPromotionRestartSafe(
  options: PromoteErc20BurnCandidatesOptions,
): Promise<Erc20BurnPromotionRun> {
  const request = validateRequest(options);
  let run: Erc20BurnPromotionCheckpointRun | undefined;
  try {
    run = await request.checkpoints.begin({
      scanType: ERC20_BURN_PROMOTION_SCAN_TYPE,
      source: ERC20_BURN_PROMOTION_SOURCE,
      ledger: 'EVM',
      chainId: 'eip155:56',
      subject: request.tokenAddress,
      fromBlock: request.fromBlockNumber,
      toBlock: request.toBlockNumber,
      chunkSize: request.selectedSegmentSize,
      identity: checkpointIdentity(request),
      initialState: initialState(),
    });
    let state = parseCheckpointState(run, request);
    if (run.status === 'REQUESTED_RANGE_COMPLETE') {
      if (state.result === null) throw invalid('Completed burn promotion result vanished.');
      return { scanId: run.id, result: state.result };
    }
    while (run.nextBlock <= request.toBlockNumber) {
      const fromBlock = run.nextBlock;
      const toBlock = expectedSegmentEnd(request, fromBlock);
      const segment = await executeSegment(request, fromBlock, toBlock);
      state = {
        segments: [...state.segments, segment],
        snapshot: segment.snapshot,
        sourceSet: sortedUnique([...state.sourceSet, ...segment.sourceSet]),
        result: null,
      };
      run = await request.checkpoints.advance(run.id, {
        expectedNextBlock: fromBlock,
        completedToBlock: toBlock,
        state: stateJson(state),
        evidenceIds: terminalIds(state.segments),
      });
      state = parseCheckpointState(run, request);
    }
    const result = await terminalResult(request, state);
    const completed = await request.checkpoints.finish(run.id, {
      state: stateJson({ ...state, result }),
      evidenceIds: terminalIds(state.segments, result),
    });
    const replay = parseCheckpointState(completed, request);
    if (replay.result === null) throw invalid('Burn promotion terminal result vanished.');
    return { scanId: completed.id, result: replay.result };
  } catch (error) {
    if (run?.status === 'RUNNING') {
      try {
        await request.checkpoints.recordFailure(run.id, safeFailureCode(error));
      } catch {
        // Preserve the original provider, Evidence, or checkpoint failure.
      }
    }
    throw error;
  }
}
