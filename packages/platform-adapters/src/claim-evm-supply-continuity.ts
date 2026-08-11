import { ProviderError, type EvmLedgerAdapter, type EvmLogReader } from '@zerotrace/chain-adapters';
import type { SourceOperatorRegistryEntry } from '@zerotrace/data-quality';
import { createEvidence, evidenceIdFor, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  ChainAnchorReadSchema,
  EvidenceSchema,
  EvmClaimBurnConservationSchema,
  EvmSnapshotSchema,
  EvmSupplyContinuitySchema,
  EvmSupplyContinuitySegmentSchema,
  JsonValueSchema,
  type AnalysisSnapshot,
  type Evidence,
  type EvmClaimBurnConservation,
  type EvmSupplyContinuity,
  type EvmSupplyContinuityChange,
  type EvmSupplyContinuitySegment,
  type JsonValue,
} from '@zerotrace/schemas';
import { decodeFunctionResult, encodeFunctionData, getAddress } from 'viem';

import {
  observeEvmClaimBurnBlock,
  type EvmClaimBurnBlockRun,
  type EvmClaimBurnEvidenceWriter,
} from './claim-evm-burn.js';
import { attestBscSourceIndependence } from './flap-market-reconciliation.js';

export const ERC20_SUPPLY_CONTINUITY_MODEL_VERSION = 'erc20-supply-continuity-v1.0.0';
export const ERC20_SUPPLY_CONTINUITY_CHECKPOINT_VERSION = 'erc20-supply-continuity-checkpoint-v1';
export const ERC20_SUPPLY_CONTINUITY_SCAN_TYPE = 'ERC20_SUPPLY_CONTINUITY';
export const ERC20_SUPPLY_CONTINUITY_SOURCE = 'multi-source:bsc-rpc+sqd';
export const ERC20_SUPPLY_CONTINUITY_DEFAULT_SEGMENT_SIZE = 128;
export const ERC20_SUPPLY_CONTINUITY_MAX_SEGMENT_SIZE = 1_024;
export const ERC20_SUPPLY_CONTINUITY_MAX_SEGMENTS = 32;
export const ERC20_SUPPLY_CONTINUITY_MAX_RANGE_BLOCKS =
  ERC20_SUPPLY_CONTINUITY_MAX_SEGMENT_SIZE * ERC20_SUPPLY_CONTINUITY_MAX_SEGMENTS;

const COVERAGE_SCOPE =
  'ERC20_TOTAL_SUPPLY_EVERY_FINALIZED_BLOCK_WITH_EVENT_RECONCILIATION' as const;

const totalSupplyAbi = [
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const totalSupplyCallData = encodeFunctionData({
  abi: totalSupplyAbi,
  functionName: 'totalSupply',
});

export interface Erc20SupplyContinuityCheckpointRun {
  id: string;
  status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
  nextBlock: number;
  state: JsonValue;
  evidenceIds: readonly string[];
}

export interface Erc20SupplyContinuityCheckpointStore {
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
  }): Promise<Erc20SupplyContinuityCheckpointRun>;
  advance(
    id: string,
    input: {
      expectedNextBlock: number;
      completedToBlock: number;
      state: JsonValue;
      evidenceIds: readonly string[];
    },
  ): Promise<Erc20SupplyContinuityCheckpointRun>;
  finish(
    id: string,
    input: { state: JsonValue; evidenceIds: readonly string[] },
  ): Promise<Erc20SupplyContinuityCheckpointRun>;
  recordFailure(id: string, errorCode: string): Promise<Erc20SupplyContinuityCheckpointRun>;
}

export type Erc20SupplyChangeCertificateExecutor = (options: {
  tokenAddress: string;
  snapshot: Extract<AnalysisSnapshot, { ledger: 'EVM' }>;
  adapter: EvmLedgerAdapter;
  logReader: EvmLogReader;
  blockReader: EvmLedgerAdapter;
  writeEvidence: EvmClaimBurnEvidenceWriter;
  maxTransfers?: number | undefined;
  now?: (() => string) | undefined;
}) => Promise<EvmClaimBurnBlockRun>;

export interface ScanErc20SupplyContinuityOptions {
  adapters: readonly EvmLedgerAdapter[];
  logReader: EvmLogReader & { readonly endpointId: string };
  tokenAddress: string;
  fromBlock: string;
  toBlock: string;
  checkpoints: Erc20SupplyContinuityCheckpointStore;
  writeEvidence: EvmClaimBurnEvidenceWriter;
  segmentSize?: number | undefined;
  maxTransfers?: number | undefined;
  certifyChange?: Erc20SupplyChangeCertificateExecutor | undefined;
  operatorRegistry?: readonly SourceOperatorRegistryEntry[] | undefined;
}

interface ValidatedRequest extends ScanErc20SupplyContinuityOptions {
  tokenAddress: string;
  fromBlockNumber: number;
  toBlockNumber: number;
  selectedSegmentSize: number;
  selectedMaxTransfers: number;
  sourceIds: string[];
}

interface SupplyContinuityCheckpointState {
  segments: EvmSupplyContinuitySegment[];
  snapshot: AnalysisSnapshot | null;
  sourceSet: string[];
  result: EvmSupplyContinuity | null;
}

interface SourceSupplyObservation {
  sourceId: string;
  blockNumber: string;
  blockHash: string;
  parentBlockHash?: string | undefined;
  blockTimestamp: string;
  totalSupply: string;
  snapshot: Extract<AnalysisSnapshot, { ledger: 'EVM' }>;
  evidenceIds: string[];
}

interface ReconciledSupplySample {
  blockNumber: string;
  blockHash: string;
  parentBlockHash?: string | undefined;
  totalSupply: string;
  snapshot: Extract<AnalysisSnapshot, { ledger: 'EVM' }>;
  sourceSet: string[];
  evidenceIds: string[];
}

export interface Erc20SupplyContinuityRun {
  scanId: string;
  result: EvmSupplyContinuity;
}

export interface Erc20SupplyContinuityReplayRun extends Erc20SupplyContinuityCheckpointRun {
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

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeBlock(value: string, field: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw invalid(`${field} must be an unsigned integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalid(`${field} exceeds the durable cursor range.`);
  return parsed;
}

function boundedInteger(value: number | undefined, fallback: number, field: string, max: number) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > max) {
    throw new RangeError(`${field} must be between 1 and ${max}.`);
  }
  return resolved;
}

function decodeTotalSupply(value: string): string {
  try {
    const decoded = decodeFunctionResult({
      abi: totalSupplyAbi,
      functionName: 'totalSupply',
      data: value as `0x${string}`,
    });
    if (typeof decoded !== 'bigint' || decoded < 0n) throw new Error('invalid uint256');
    return decoded.toString();
  } catch (error) {
    throw invalid('ERC-20 totalSupply response is malformed.', error);
  }
}

function validateRequest(options: ScanErc20SupplyContinuityOptions): ValidatedRequest {
  let tokenAddress: string;
  try {
    tokenAddress = getAddress(options.tokenAddress).toLowerCase();
  } catch (error) {
    throw invalid('Supply-continuity token must be an EVM address.', error);
  }
  if (options.adapters.length < 1 || options.adapters.length > 8) {
    throw new RangeError('Supply continuity requires between one and eight EVM sources.');
  }
  if (
    options.adapters.some(
      (adapter) => adapter.config.chainId !== 56 || adapter.config.snapshotBlockTag !== 'finalized',
    )
  ) {
    throw invalid('Supply continuity currently requires finalized BSC mainnet adapters.');
  }
  const sourceIds = sortedUnique(options.adapters.map((adapter) => adapter.sourceId));
  if (sourceIds.length !== options.adapters.length) {
    throw invalid('Supply-continuity adapters must expose distinct observation sources.');
  }
  const fromBlockNumber = safeBlock(options.fromBlock, 'fromBlock');
  const toBlockNumber = safeBlock(options.toBlock, 'toBlock');
  if (fromBlockNumber < 1) throw new RangeError('Supply continuity must start after genesis.');
  if (toBlockNumber < fromBlockNumber)
    throw new RangeError('Supply-continuity range must be ordered.');
  if (toBlockNumber - fromBlockNumber + 1 > ERC20_SUPPLY_CONTINUITY_MAX_RANGE_BLOCKS) {
    throw new RangeError(
      `Supply continuity is limited to ${ERC20_SUPPLY_CONTINUITY_MAX_RANGE_BLOCKS} transitions per run.`,
    );
  }
  const selectedSegmentSize = boundedInteger(
    options.segmentSize,
    ERC20_SUPPLY_CONTINUITY_DEFAULT_SEGMENT_SIZE,
    'segmentSize',
    ERC20_SUPPLY_CONTINUITY_MAX_SEGMENT_SIZE,
  );
  if (
    Math.ceil((toBlockNumber - fromBlockNumber + 1) / selectedSegmentSize) >
    ERC20_SUPPLY_CONTINUITY_MAX_SEGMENTS
  ) {
    throw new RangeError(
      `Supply continuity is limited to ${ERC20_SUPPLY_CONTINUITY_MAX_SEGMENTS} durable segments.`,
    );
  }
  return {
    ...options,
    tokenAddress,
    fromBlockNumber,
    toBlockNumber,
    selectedSegmentSize,
    selectedMaxTransfers: boundedInteger(options.maxTransfers, 25_000, 'maxTransfers', 100_000),
    sourceIds,
  };
}

function checkpointIdentity(request: ValidatedRequest): Readonly<Record<string, JsonValue>> {
  return {
    checkpointVersion: ERC20_SUPPLY_CONTINUITY_CHECKPOINT_VERSION,
    modelVersion: ERC20_SUPPLY_CONTINUITY_MODEL_VERSION,
    tokenAddress: request.tokenAddress,
    segmentSize: request.selectedSegmentSize,
    maxTransfers: request.selectedMaxTransfers,
    sourceIds: request.sourceIds,
    eventSource: request.logReader.endpointId,
    coverageScope: COVERAGE_SCOPE,
    stateReadPolicy: 'eip-1898-require-canonical-v1',
  };
}

function stateJson(state: SupplyContinuityCheckpointState): JsonValue {
  return JsonValueSchema.parse({
    version: ERC20_SUPPLY_CONTINUITY_CHECKPOINT_VERSION,
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
    throw invalid(`Supply-continuity checkpoint ${field} must be an object.`);
  }
  return value;
}

function canonicalStrings(value: JsonValue | undefined, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw invalid(`Supply-continuity checkpoint ${field} is invalid.`);
  }
  const canonical = sortedUnique(value);
  if (!sameStrings(canonical, value)) {
    throw invalid(`Supply-continuity checkpoint ${field} is not canonical.`);
  }
  return canonical;
}

function expectedSegmentEnd(request: ValidatedRequest, fromBlock: number): number {
  return Math.min(fromBlock + request.selectedSegmentSize - 1, request.toBlockNumber);
}

function checkpointEvidenceIds(state: SupplyContinuityCheckpointState): string[] {
  return state.result === null
    ? state.segments.map((segment) => segment.terminalEvidenceId).sort()
    : [...state.result.metadata.evidenceIds].sort();
}

function parseCheckpointState(
  run: Erc20SupplyContinuityCheckpointRun,
  request: ValidatedRequest,
): SupplyContinuityCheckpointState {
  const parsedJson = JsonValueSchema.safeParse(run.state);
  if (!parsedJson.success)
    throw invalid('Supply-continuity checkpoint is not JSON.', parsedJson.error);
  const value = record(parsedJson.data, 'state');
  if (value.version !== ERC20_SUPPLY_CONTINUITY_CHECKPOINT_VERSION) {
    throw invalid('Supply-continuity checkpoint version is unsupported.');
  }
  if (!Array.isArray(value.segments))
    throw invalid('Supply-continuity checkpoint segments are invalid.');
  const segments = value.segments.map((segment) => {
    const parsed = EvmSupplyContinuitySegmentSchema.safeParse(segment);
    if (!parsed.success)
      throw invalid('Supply-continuity checkpoint segment is invalid.', parsed.error);
    return parsed.data;
  });
  const snapshot =
    value.snapshot === null
      ? null
      : (() => {
          const parsed = EvmSnapshotSchema.safeParse(value.snapshot);
          if (!parsed.success) throw invalid('Supply-continuity checkpoint Snapshot is invalid.');
          return parsed.data;
        })();
  const sourceSet = canonicalStrings(value.sourceSet, 'source set');
  const result =
    value.result === null
      ? null
      : (() => {
          const parsed = EvmSupplyContinuitySchema.safeParse(value.result);
          if (!parsed.success)
            throw invalid('Supply-continuity checkpoint result is invalid.', parsed.error);
          return parsed.data;
        })();
  let expectedFrom = request.fromBlockNumber;
  for (const segment of segments) {
    const expectedTo = expectedSegmentEnd(request, expectedFrom);
    if (segment.fromBlock !== String(expectedFrom) || segment.toBlock !== String(expectedTo)) {
      throw invalid('Supply-continuity checkpoint segments are not contiguous.');
    }
    expectedFrom = expectedTo + 1;
  }
  if (run.nextBlock !== expectedFrom || run.nextBlock > request.toBlockNumber + 1) {
    throw invalid('Supply-continuity checkpoint cursor is inconsistent.');
  }
  if (segments.length === 0) {
    if (snapshot !== null || sourceSet.length !== 0) {
      throw invalid('Unstarted supply-continuity checkpoint contains materialized state.');
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
      throw invalid('Supply-continuity checkpoint materialized state is inconsistent.');
    }
  }
  const expectedEvidenceIds = checkpointEvidenceIds({ segments, snapshot, sourceSet, result });
  const actualEvidenceIds = sortedUnique(run.evidenceIds);
  if (
    !sameStrings(expectedEvidenceIds, actualEvidenceIds) ||
    actualEvidenceIds.length !== run.evidenceIds.length
  ) {
    throw invalid('Supply-continuity checkpoint Evidence identities are inconsistent.');
  }
  if (run.status === 'REQUESTED_RANGE_COMPLETE') {
    if (run.nextBlock !== request.toBlockNumber + 1 || result === null) {
      throw invalid('Completed supply-continuity checkpoint has no terminal result.');
    }
  } else if (result !== null) {
    throw invalid('Running supply-continuity checkpoint contains a terminal result.');
  }
  return { segments, snapshot, sourceSet, result };
}

async function persistEvidence(
  evidence: Evidence,
  writer: EvmClaimBurnEvidenceWriter,
  sourceEvidenceIds: readonly string[] = [],
  snapshot?: AnalysisSnapshot,
): Promise<Evidence> {
  const persisted = EvidenceSchema.parse(await writer(evidence, sourceEvidenceIds, snapshot));
  if (
    persisted.id !== evidence.id ||
    persisted.id !== evidenceIdFor(persisted, sortedUnique(sourceEvidenceIds))
  ) {
    throw invalid('Supply-continuity Evidence writer changed a canonical node.');
  }
  return persisted;
}

async function readSourceSupply(
  request: ValidatedRequest,
  adapter: EvmLedgerAdapter,
  blockNumber: number,
): Promise<SourceSupplyObservation> {
  const position = String(blockNumber);
  const rawAnchor = ChainAnchorReadSchema.parse(await adapter.readAnchorAt(position));
  const snapshot = EvmSnapshotSchema.parse(rawAnchor.snapshot);
  if (
    rawAnchor.anchor.ledger !== 'EVM' ||
    rawAnchor.anchor.chainId !== 'eip155:56' ||
    rawAnchor.anchor.position !== position ||
    rawAnchor.anchor.finality !== 'finalized' ||
    snapshot.chainId !== 'eip155:56' ||
    snapshot.blockNumber !== position ||
    snapshot.finality !== 'finalized' ||
    snapshot.blockTimestamp === undefined ||
    rawAnchor.anchor.hash.toLowerCase() !== snapshot.blockHash.toLowerCase() ||
    rawAnchor.anchor.source !== adapter.sourceId
  ) {
    throw invalid('Supply-continuity source returned an inconsistent finalized block anchor.');
  }
  const call = await adapter.callObservationAtBlockHash(
    request.tokenAddress,
    totalSupplyCallData,
    snapshot.blockHash,
  );
  if (call.endpointId !== rawAnchor.anchor.source) {
    throw invalid('Supply-continuity block and state observations came from different sources.');
  }
  const totalSupply = decodeTotalSupply(call.value);
  const blockEvidence = await persistEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'BLOCK',
      source: rawAnchor.anchor.source,
      locator: `supply-continuity-block:${position}:${snapshot.blockHash.toLowerCase()}`,
      payload: rawAnchor.payload,
      observedAt: snapshot.capturedAt,
      blockOrSlot: position,
      finality: 'finalized',
      summary: 'Finalized block identity used for an all-block ERC-20 supply observation.',
    }),
    request.writeEvidence,
    [],
    snapshot,
  );
  const supplyEvidence = await persistEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'CONTRACT_STATE',
      source: call.endpointId,
      locator: `erc20-total-supply-by-hash:${request.tokenAddress}:${snapshot.blockHash.toLowerCase()}`,
      payload: {
        tokenAddress: request.tokenAddress,
        function: 'totalSupply()',
        blockNumber: position,
        blockHash: snapshot.blockHash.toLowerCase(),
        requireCanonical: true,
        rawResult: call.value,
        totalSupply,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: position,
      finality: 'finalized',
      summary: 'ERC-20 totalSupply read by canonical block hash through EIP-1898.',
    }),
    request.writeEvidence,
    [],
    snapshot,
  );
  return {
    sourceId: call.endpointId,
    blockNumber: position,
    blockHash: snapshot.blockHash.toLowerCase(),
    ...(snapshot.parentBlockHash === undefined
      ? {}
      : { parentBlockHash: snapshot.parentBlockHash.toLowerCase() }),
    blockTimestamp: snapshot.blockTimestamp,
    totalSupply,
    snapshot,
    evidenceIds: [blockEvidence.id, supplyEvidence.id],
  };
}

function reconciledSnapshot(
  observations: readonly SourceSupplyObservation[],
): Extract<AnalysisSnapshot, { ledger: 'EVM' }> {
  const first = observations[0];
  if (first === undefined)
    throw invalid('Supply continuity requires at least one source observation.');
  const providerVersions = Object.assign(
    {},
    ...observations.map((observation) => observation.snapshot.providerVersions),
  ) as Record<string, string>;
  const adapterVersions = Object.assign(
    {},
    ...observations.map((observation) => observation.snapshot.adapterVersions),
  ) as Record<string, string>;
  return EvmSnapshotSchema.parse({
    ...first.snapshot,
    capturedAt: observations
      .map((item) => item.snapshot.capturedAt)
      .sort()
      .at(-1),
    providerVersions,
    adapterVersions,
    configHash: hashPayload({
      modelVersion: ERC20_SUPPLY_CONTINUITY_MODEL_VERSION,
      sources: observations.map((item) => ({
        sourceId: item.sourceId,
        configHash: item.snapshot.configHash,
      })),
    }),
    entityModelVersion: 'entity-model-unapplied',
    labelSnapshot: 'labels-unapplied',
  });
}

async function readReconciledSupply(
  request: ValidatedRequest,
  blockNumber: number,
): Promise<ReconciledSupplySample> {
  const observations = await Promise.all(
    request.adapters.map((adapter) => readSourceSupply(request, adapter, blockNumber)),
  );
  const first = observations[0];
  if (first === undefined) throw invalid('Supply continuity requires source observations.');
  const sourceSet = observations.map((item) => item.sourceId).sort();
  const identityMatches = observations.every(
    (item) =>
      item.blockNumber === first.blockNumber &&
      item.blockHash === first.blockHash &&
      item.parentBlockHash === first.parentBlockHash &&
      item.blockTimestamp === first.blockTimestamp &&
      item.totalSupply === first.totalSupply,
  );
  if (!identityMatches || !sameStrings(sourceSet, request.sourceIds)) {
    const evidenceIds = sortedUnique(observations.flatMap((item) => item.evidenceIds));
    const conflict = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${ERC20_SUPPLY_CONTINUITY_MODEL_VERSION}`,
      locator: `erc20-supply-source-conflict:${request.tokenAddress}:${blockNumber}`,
      payload: {
        tokenAddress: request.tokenAddress,
        blockNumber: String(blockNumber),
        observations: observations.map((item) => ({
          sourceId: item.sourceId,
          blockHash: item.blockHash,
          parentBlockHash: item.parentBlockHash ?? null,
          blockTimestamp: item.blockTimestamp,
          totalSupply: item.totalSupply,
        })),
      },
      observedAt: observations
        .map((item) => item.snapshot.capturedAt)
        .sort()
        .at(-1) as string,
      blockOrSlot: String(blockNumber),
      finality: 'finalized',
      summary: 'BSC sources disagree on exact block identity or ERC-20 totalSupply.',
      sourceEvidenceIds: evidenceIds,
    });
    const persisted = await persistEvidence(conflict, request.writeEvidence, evidenceIds);
    throw invalid(`Supply-continuity source conflict at block ${blockNumber} (${persisted.id}).`);
  }
  return {
    blockNumber: first.blockNumber,
    blockHash: first.blockHash,
    ...(first.parentBlockHash === undefined ? {} : { parentBlockHash: first.parentBlockHash }),
    totalSupply: first.totalSupply,
    snapshot: reconciledSnapshot(observations),
    sourceSet,
    evidenceIds: sortedUnique(observations.flatMap((item) => item.evidenceIds)),
  };
}

function validateChangeCertificate(
  previous: ReconciledSupplySample,
  current: ReconciledSupplySample,
  report: EvmClaimBurnConservation,
): EvmSupplyContinuityChange {
  if (
    report.blockNumber !== current.blockNumber ||
    report.blockHash.toLowerCase() !== current.blockHash ||
    report.parentBlockNumber !== previous.blockNumber ||
    report.parentBlockHash.toLowerCase() !== previous.blockHash ||
    report.totalSupplyBefore !== previous.totalSupply ||
    report.totalSupplyAfter !== current.totalSupply
  ) {
    throw invalid('Supply-change certificate does not match the all-block state observations.');
  }
  const supplyDelta = BigInt(current.totalSupply) - BigInt(previous.totalSupply);
  const eventNetSupplyDelta = BigInt(report.mintedAmount) - BigInt(report.burnedAmount);
  return {
    blockNumber: current.blockNumber,
    blockHash: current.blockHash,
    parentBlockHash: previous.blockHash,
    totalSupplyBefore: previous.totalSupply,
    totalSupplyAfter: current.totalSupply,
    supplyDelta: supplyDelta.toString(),
    mintedEventAmount: report.mintedAmount,
    burnedEventAmount: report.burnedAmount,
    eventNetSupplyDelta: eventNetSupplyDelta.toString(),
    reconciliationStatus: supplyDelta === eventNetSupplyDelta ? 'EVENT_CONSERVED' : 'UNEXPLAINED',
    certificateStatus: report.status,
    certificateTerminalEvidenceId: report.terminalEvidenceId,
  };
}

async function executeSegment(
  request: ValidatedRequest,
  fromBlock: number,
  toBlock: number,
): Promise<EvmSupplyContinuitySegment> {
  const samples: ReconciledSupplySample[] = [];
  for (let blockNumber = fromBlock - 1; blockNumber <= toBlock; blockNumber += 1) {
    samples.push(await readReconciledSupply(request, blockNumber));
  }
  const changes: EvmSupplyContinuityChange[] = [];
  const certificateEvidenceIds: string[] = [];
  const certificateSourceSet: string[] = [];
  const certify = request.certifyChange ?? observeEvmClaimBurnBlock;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === undefined || current === undefined) throw invalid('Supply sample vanished.');
    if (
      current.parentBlockHash === undefined ||
      current.parentBlockHash !== previous.blockHash ||
      BigInt(current.blockNumber) !== BigInt(previous.blockNumber) + 1n
    ) {
      throw invalid('Supply-continuity samples are not one finalized parent-linked chain.');
    }
    if (current.totalSupply === previous.totalSupply) continue;
    const certificateRun = await certify({
      tokenAddress: request.tokenAddress,
      snapshot: current.snapshot,
      adapter: request.adapters[0] as EvmLedgerAdapter,
      logReader: request.logReader,
      blockReader: request.adapters[0] as EvmLedgerAdapter,
      writeEvidence: request.writeEvidence,
      maxTransfers: request.selectedMaxTransfers,
      now: () => current.snapshot.capturedAt,
    });
    const report = EvmClaimBurnConservationSchema.parse(certificateRun.report);
    changes.push(validateChangeCertificate(previous, current, report));
    certificateEvidenceIds.push(report.terminalEvidenceId);
    certificateSourceSet.push(...report.metadata.sourceSet);
  }
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined) throw invalid('Supply segment has no samples.');
  const rawEvidenceIds = sortedUnique(samples.flatMap((sample) => sample.evidenceIds));
  const sourceEvidenceIds = sortedUnique([...rawEvidenceIds, ...certificateEvidenceIds]);
  const eventConservedChangeCount = changes.filter(
    (change) => change.reconciliationStatus === 'EVENT_CONSERVED',
  ).length;
  const terminal = await persistEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: last.snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${ERC20_SUPPLY_CONTINUITY_MODEL_VERSION}`,
      locator: `erc20-supply-continuity-segment:${request.tokenAddress}:${fromBlock}-${toBlock}@${last.blockHash}`,
      payload: {
        tokenAddress: request.tokenAddress,
        fromBlock: String(fromBlock),
        toBlock: String(toBlock),
        sampleCount: samples.length,
        startTotalSupply: first.totalSupply,
        endTotalSupply: last.totalSupply,
        supplyChangeCount: changes.length,
        eventConservedChangeCount,
        unexplainedChangeCount: changes.length - eventConservedChangeCount,
        changes,
        coverageScope: COVERAGE_SCOPE,
      },
      observedAt: last.snapshot.capturedAt,
      blockOrSlot: last.blockNumber,
      finality: 'finalized',
      summary:
        changes.length === 0
          ? 'Every finalized block transition in the segment has the same independently compared ERC-20 totalSupply.'
          : 'Every finalized block transition in the segment was sampled and each supply change was reconciled against complete mint/burn events.',
      sourceEvidenceIds,
    }),
    request.writeEvidence,
    sourceEvidenceIds,
    last.snapshot,
  );
  return EvmSupplyContinuitySegmentSchema.parse({
    fromBlock: String(fromBlock),
    toBlock: String(toBlock),
    sampleCount: samples.length,
    startTotalSupply: first.totalSupply,
    endTotalSupply: last.totalSupply,
    supplyChangeCount: changes.length,
    eventConservedChangeCount,
    unexplainedChangeCount: changes.length - eventConservedChangeCount,
    changes,
    terminalEvidenceId: terminal.id,
    snapshot: last.snapshot,
    sourceSet: sortedUnique([
      ...samples.flatMap((sample) => sample.sourceSet),
      ...certificateSourceSet,
    ]),
  });
}

async function terminalResult(
  request: ValidatedRequest,
  state: SupplyContinuityCheckpointState,
): Promise<EvmSupplyContinuity> {
  const snapshot = EvmSnapshotSchema.parse(state.snapshot);
  const sourceIndependenceRun = await attestBscSourceIndependence({
    sourceIds: request.sourceIds,
    snapshot,
    writeEvidence: request.writeEvidence,
    ...(request.operatorRegistry === undefined
      ? {}
      : { operatorRegistry: request.operatorRegistry }),
  });
  const changes = state.segments.flatMap((segment) => segment.changes);
  const eventConservedChangeCount = changes.filter(
    (change) => change.reconciliationStatus === 'EVENT_CONSERVED',
  ).length;
  const unexplainedChangeCount = changes.length - eventConservedChangeCount;
  const independent =
    sourceIndependenceRun.assessment.independence.state === 'known' &&
    sourceIndependenceRun.assessment.independence.value;
  const status =
    unexplainedChangeCount > 0
      ? 'UNEXPLAINED_SUPPLY_CHANGE'
      : !independent
        ? 'INCONCLUSIVE_SOURCE_INDEPENDENCE'
        : changes.length === 0
          ? 'VERIFIED_NO_CHANGE'
          : 'VERIFIED_EVENT_CONSERVED_CHANGES';
  const first = state.segments[0];
  const last = state.segments.at(-1);
  if (first === undefined || last === undefined)
    throw invalid('Supply continuity has no segments.');
  const sourceEvidenceIds = sortedUnique([
    ...state.segments.map((segment) => segment.terminalEvidenceId),
    sourceIndependenceRun.assessment.terminalEvidenceId,
  ]);
  const terminal = await persistEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${ERC20_SUPPLY_CONTINUITY_MODEL_VERSION}`,
      locator: `erc20-supply-continuity:${request.tokenAddress}:${request.fromBlockNumber}-${request.toBlockNumber}@${snapshot.blockHash.toLowerCase()}`,
      payload: {
        tokenAddress: request.tokenAddress,
        fromBlock: String(request.fromBlockNumber),
        toBlock: String(request.toBlockNumber),
        coverageScope: COVERAGE_SCOPE,
        status,
        segmentCount: state.segments.length,
        scannedBlockCount: request.toBlockNumber - request.fromBlockNumber + 1,
        supplySampleCount:
          state.segments.reduce((total, segment) => total + segment.sampleCount, 0) -
          state.segments.length +
          1,
        initialTotalSupply: first.startTotalSupply,
        finalTotalSupply: last.endTotalSupply,
        netSupplyDelta: (BigInt(last.endTotalSupply) - BigInt(first.startTotalSupply)).toString(),
        supplyChangeCount: changes.length,
        eventConservedChangeCount,
        unexplainedChangeCount,
        sourceIndependence: sourceIndependenceRun.assessment,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: 'finalized',
      summary:
        status === 'UNEXPLAINED_SUPPLY_CHANGE'
          ? 'All-block ERC-20 supply coverage found a change that standard mint/burn events do not explain.'
          : status === 'INCONCLUSIVE_SOURCE_INDEPENDENCE'
            ? 'All requested block transitions were sampled, but source-operator independence is inconclusive.'
            : changes.length === 0
              ? 'Independent all-block ERC-20 supply coverage found no totalSupply change in the requested range.'
              : 'Independent all-block ERC-20 supply coverage found only event-conserved changes.',
      sourceEvidenceIds,
    }),
    request.writeEvidence,
    sourceEvidenceIds,
    snapshot,
  );
  const metadataEvidenceIds = sortedUnique([
    ...state.segments.map((segment) => segment.terminalEvidenceId),
    ...sourceIndependenceRun.assessment.evidenceIds,
    terminal.id,
  ]);
  return EvmSupplyContinuitySchema.parse({
    tokenAddress: request.tokenAddress,
    fromBlock: String(request.fromBlockNumber),
    toBlock: String(request.toBlockNumber),
    coverageScope: COVERAGE_SCOPE,
    status,
    segmentCount: state.segments.length,
    scannedBlockCount: request.toBlockNumber - request.fromBlockNumber + 1,
    supplySampleCount:
      state.segments.reduce((total, segment) => total + segment.sampleCount, 0) -
      state.segments.length +
      1,
    initialTotalSupply: first.startTotalSupply,
    finalTotalSupply: last.endTotalSupply,
    netSupplyDelta: (BigInt(last.endTotalSupply) - BigInt(first.startTotalSupply)).toString(),
    supplyChangeCount: changes.length,
    eventConservedChangeCount,
    unexplainedChangeCount,
    segments: state.segments,
    sourceIndependence: sourceIndependenceRun.assessment,
    terminalEvidenceId: terminal.id,
    metadata: AnalysisMetadataSchema.parse({
      snapshot,
      dataCoverage: 1,
      sourceCoverage: independent ? 1 : 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: state.sourceSet,
      modelVersion: ERC20_SUPPLY_CONTINUITY_MODEL_VERSION,
      confidence: independent ? 1 : 0.5,
      evidenceIds: metadataEvidenceIds,
    }),
  });
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code.slice(0, 128);
  }
  return 'SUPPLY_CONTINUITY_FAILED';
}

export async function scanErc20SupplyContinuityRestartSafe(
  options: ScanErc20SupplyContinuityOptions,
): Promise<Erc20SupplyContinuityRun> {
  const request = validateRequest(options);
  let run = await request.checkpoints.begin({
    scanType: ERC20_SUPPLY_CONTINUITY_SCAN_TYPE,
    source: ERC20_SUPPLY_CONTINUITY_SOURCE,
    ledger: 'EVM',
    chainId: 'eip155:56',
    subject: request.tokenAddress,
    fromBlock: request.fromBlockNumber,
    toBlock: request.toBlockNumber,
    chunkSize: request.selectedSegmentSize,
    identity: checkpointIdentity(request),
    initialState: initialState(),
  });
  try {
    let state = parseCheckpointState(run, request);
    if (run.status === 'REQUESTED_RANGE_COMPLETE') {
      if (state.result === null) throw invalid('Completed supply-continuity scan has no result.');
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
        evidenceIds: checkpointEvidenceIds(state),
      });
      state = parseCheckpointState(run, request);
    }
    const result = await terminalResult(request, state);
    const completedState: SupplyContinuityCheckpointState = { ...state, result };
    run = await request.checkpoints.finish(run.id, {
      state: stateJson(completedState),
      evidenceIds: checkpointEvidenceIds(completedState),
    });
    const parsed = parseCheckpointState(run, request);
    if (parsed.result === null) throw invalid('Supply-continuity terminal result was not stored.');
    return { scanId: run.id, result: parsed.result };
  } catch (error) {
    try {
      await request.checkpoints.recordFailure(run.id, errorCode(error));
    } catch {
      // Preserve the provider, Evidence, or validation failure that prevented advancement.
    }
    throw error;
  }
}

export function replayErc20SupplyContinuityResult(
  run: Erc20SupplyContinuityReplayRun,
): EvmSupplyContinuity | null {
  if (
    run.scanType !== ERC20_SUPPLY_CONTINUITY_SCAN_TYPE ||
    run.source !== ERC20_SUPPLY_CONTINUITY_SOURCE ||
    run.ledger !== 'EVM' ||
    run.chainId !== 'eip155:56' ||
    (run.status !== 'RUNNING' && run.status !== 'REQUESTED_RANGE_COMPLETE')
  ) {
    throw invalid('Stored semantic scan is not a completed BSC supply-continuity result.');
  }
  let tokenAddress: string;
  try {
    tokenAddress = getAddress(run.subject).toLowerCase();
  } catch (error) {
    throw invalid('Stored supply-continuity subject is not an EVM address.', error);
  }
  const fromBlock = safeBlock(String(run.fromBlock), 'fromBlock');
  const toBlock = safeBlock(String(run.toBlock), 'toBlock');
  boundedInteger(
    run.chunkSize,
    ERC20_SUPPLY_CONTINUITY_DEFAULT_SEGMENT_SIZE,
    'chunkSize',
    ERC20_SUPPLY_CONTINUITY_MAX_SEGMENT_SIZE,
  );
  if (
    fromBlock < 1 ||
    toBlock < fromBlock ||
    toBlock - fromBlock + 1 > ERC20_SUPPLY_CONTINUITY_MAX_RANGE_BLOCKS
  ) {
    throw invalid('Stored supply-continuity range exceeds the supported replay bounds.');
  }
  const raw = record(JsonValueSchema.parse(run.state), 'state');
  if (raw.version !== ERC20_SUPPLY_CONTINUITY_CHECKPOINT_VERSION || !Array.isArray(raw.segments)) {
    throw invalid('Stored supply-continuity checkpoint version or segments are invalid.');
  }
  const segments = raw.segments.map((segment) => {
    const parsed = EvmSupplyContinuitySegmentSchema.safeParse(segment);
    if (!parsed.success)
      throw invalid('Stored supply-continuity segment is invalid.', parsed.error);
    return parsed.data;
  });
  let expectedFrom = fromBlock;
  for (const segment of segments) {
    const expectedTo = Math.min(expectedFrom + run.chunkSize - 1, toBlock);
    if (segment.fromBlock !== String(expectedFrom) || segment.toBlock !== String(expectedTo)) {
      throw invalid('Stored supply-continuity segments are not contiguous.');
    }
    expectedFrom = expectedTo + 1;
  }
  const sourceSet = canonicalStrings(raw.sourceSet, 'source set');
  const expectedSourceSet = sortedUnique(segments.flatMap((segment) => segment.sourceSet));
  const snapshot = raw.snapshot === null ? null : EvmSnapshotSchema.safeParse(raw.snapshot);
  if (snapshot !== null && !snapshot.success) {
    throw invalid('Stored supply-continuity Snapshot is invalid.', snapshot.error);
  }
  const parsedSnapshot = snapshot === null ? null : snapshot.data;
  const lastSegment = segments.at(-1);
  if (
    run.nextBlock !== expectedFrom ||
    run.nextBlock > toBlock + 1 ||
    !sameStrings(sourceSet, expectedSourceSet) ||
    (lastSegment === undefined
      ? parsedSnapshot !== null || sourceSet.length !== 0
      : parsedSnapshot === null ||
        parsedSnapshot.blockNumber !== lastSegment.toBlock ||
        parsedSnapshot.blockHash.toLowerCase() !== lastSegment.snapshot.blockHash.toLowerCase())
  ) {
    throw invalid('Stored supply-continuity materialized state is inconsistent.');
  }
  if (run.status === 'RUNNING') {
    const expectedEvidenceIds = segments.map((segment) => segment.terminalEvidenceId).sort();
    const actualEvidenceIds = [...run.evidenceIds].sort();
    if (
      raw.result !== null ||
      !sameStrings(expectedEvidenceIds, actualEvidenceIds) ||
      run.evidenceIds.length !== new Set(run.evidenceIds).size
    ) {
      throw invalid('Running supply-continuity checkpoint is inconsistent.');
    }
    return null;
  }
  const result = EvmSupplyContinuitySchema.safeParse(raw.result);
  if (!result.success) throw invalid('Stored supply-continuity result is invalid.', result.error);
  if (
    result.data.tokenAddress !== tokenAddress ||
    result.data.fromBlock !== String(fromBlock) ||
    result.data.toBlock !== String(toBlock) ||
    run.nextBlock !== toBlock + 1 ||
    JSON.stringify(result.data.segments) !== JSON.stringify(segments) ||
    !sameStrings([...result.data.metadata.evidenceIds].sort(), [...run.evidenceIds].sort()) ||
    run.evidenceIds.length !== new Set(run.evidenceIds).size
  ) {
    throw invalid('Stored supply-continuity result conflicts with its checkpoint identity.');
  }
  return result.data;
}
