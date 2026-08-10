import {
  ProviderError,
  type EvmContractCreationReader,
  type EvmContractCreationRecord,
  type EvmLedgerAdapter,
  type EvmSnapshot,
} from '@zerotrace/chain-adapters';
import { createEvidence, evidenceIdFor, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  EvidenceSchema,
  FlapTokenOriginSchema,
  JsonValueSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type Evidence,
  type FlapTokenOrigin,
  type JsonValue,
} from '@zerotrace/schemas';
import { getAddress } from 'viem';

import { inspectFlapEventTransaction } from './flap-events.js';
import type { FlapDeployment, FlapEvidenceWriter } from './flap.js';

export const FLAP_TOKEN_ORIGIN_MODEL_VERSION = 'flap-token-origin-v1';
export const FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE = 1_000_000;
export const FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE = 1_000_000;
export const FLAP_TOKEN_ORIGIN_MAX_CHUNKS = 250;
export const FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS =
  FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE * FLAP_TOKEN_ORIGIN_MAX_CHUNKS;
export const FLAP_TOKEN_ORIGIN_CHECKPOINT_VERSION = 'flap-origin-checkpoint-v1';
export const FLAP_TOKEN_ORIGIN_CHECKPOINT_SOURCE = 'sqd:binance-mainnet';

export interface InspectFlapTokenOriginOptions {
  adapter: EvmLedgerAdapter;
  creationReader: EvmContractCreationReader;
  token: string;
  fromBlock: string;
  toBlock: string;
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
  chunkSize?: number;
}

export interface FlapOriginCheckpointRun {
  id: string;
  status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
  nextBlock: number;
  state: JsonValue;
  evidenceIds: readonly string[];
}

export interface FlapOriginCheckpointStore {
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
  }): Promise<FlapOriginCheckpointRun>;
  advance(
    id: string,
    input: {
      expectedNextBlock: number;
      completedToBlock: number;
      state: JsonValue;
      evidenceIds: readonly string[];
    },
  ): Promise<FlapOriginCheckpointRun>;
  finish(
    id: string,
    input: { state: JsonValue; evidenceIds: readonly string[] },
  ): Promise<FlapOriginCheckpointRun>;
  recordFailure(id: string, errorCode: string): Promise<FlapOriginCheckpointRun>;
}

interface ValidatedFlapOriginRequest {
  adapter: EvmLedgerAdapter;
  creationReader: EvmContractCreationReader;
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
  token: string;
  portal: string;
  fromBlock: bigint;
  toBlock: bigint;
  selectedChunkSize: number;
  chunkCount: number;
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

function decimalPosition(value: string, field: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} must be unsigned decimal.`);
  }
  return BigInt(value);
}

function chunkSize(value: number | undefined): number {
  const selected = value ?? FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE;
  if (
    !Number.isSafeInteger(selected) ||
    selected < 1 ||
    selected > FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap origin chunkSize must be an integer from 1 through ${FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE}.`,
    );
  }
  return selected;
}

function snapshotPosition(snapshot: EvmSnapshot): string {
  return snapshot.blockNumber;
}

function analysisMetadata(
  snapshot: EvmSnapshot,
  sources: readonly string[],
  evidence: readonly Evidence[],
  confidence: number,
): AnalysisMetadata {
  return AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet: [...new Set(sources)].sort(),
    modelVersion: FLAP_TOKEN_ORIGIN_MODEL_VERSION,
    confidence,
    evidenceIds: [...new Set(evidence.map((item) => item.id))].sort(),
  });
}

function transactionRootEvidence(evidence: readonly Evidence[]): Evidence {
  const root = [...evidence].reverse().find((item) => item.kind === 'DERIVED_FEATURE');
  if (root === undefined) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap origin transaction Evidence is incomplete.');
  }
  return root;
}

function tracePosition(creation: EvmContractCreationRecord) {
  return {
    transactionHash: creation.transactionHash,
    blockNumber: BigInt(creation.blockNumber).toString(),
    blockHash: creation.blockHash,
    transactionIndex: BigInt(creation.transactionIndex).toString(),
    traceAddress: [...creation.traceAddress],
  };
}

function validateOriginRequest(options: InspectFlapTokenOriginOptions): ValidatedFlapOriginRequest {
  const { adapter, creationReader, deployment, writeEvidence } = options;
  const token = canonicalAddress(options.token, 'origin token');
  const portal = canonicalAddress(deployment.portal, 'origin Portal');
  const fromBlock = decimalPosition(options.fromBlock, 'origin fromBlock');
  const toBlock = decimalPosition(options.toBlock, 'origin toBlock');
  if (toBlock < fromBlock) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap origin range ends before it begins.');
  }
  const requestedBlocks = toBlock - fromBlock + 1n;
  if (requestedBlocks > BigInt(FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap origin range exceeds ${FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS} blocks.`,
    );
  }
  if (`eip155:${adapter.config.chainId}` !== deployment.chainId) {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap origin deployment and adapter chains differ.');
  }
  const selectedChunkSize = chunkSize(options.chunkSize);
  const chunkCount = Number(
    (requestedBlocks + BigInt(selectedChunkSize) - 1n) / BigInt(selectedChunkSize),
  );
  if (chunkCount > FLAP_TOKEN_ORIGIN_MAX_CHUNKS) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap origin query exceeds ${FLAP_TOKEN_ORIGIN_MAX_CHUNKS} chunks.`,
    );
  }
  return {
    adapter,
    creationReader,
    deployment,
    writeEvidence,
    token,
    portal,
    fromBlock,
    toBlock,
    selectedChunkSize,
    chunkCount,
  };
}

interface FlapOriginAccumulatedCreation {
  creation: EvmContractCreationRecord;
  endpointId: string;
}

interface FlapOriginResume {
  snapshot: EvmSnapshot;
  nextBlock: bigint;
  rangeEvidence: Evidence[];
  observedCreations: FlapOriginAccumulatedCreation[];
  sourceSet: string[];
}

interface FlapOriginChunkProgress extends FlapOriginResume {
  completedToBlock: bigint;
}

async function runFlapTokenOrigin(
  options: InspectFlapTokenOriginOptions,
  resume?: FlapOriginResume,
  onChunk?: (progress: FlapOriginChunkProgress) => Promise<void>,
): Promise<FlapTokenOrigin> {
  const {
    adapter,
    creationReader,
    deployment,
    writeEvidence,
    token,
    portal,
    fromBlock,
    toBlock,
    selectedChunkSize,
    chunkCount,
  } = validateOriginRequest(options);

  let upperSnapshot: EvmSnapshot;
  let initialSourceSet: string[];
  if (resume === undefined) {
    const upperAnchor = await adapter.readAnchorAt(toBlock.toString());
    if (
      upperAnchor.snapshot.ledger !== 'EVM' ||
      upperAnchor.snapshot.chainId !== deployment.chainId ||
      snapshotPosition(upperAnchor.snapshot) !== toBlock.toString()
    ) {
      throw new ProviderError('CHAIN_MISMATCH', 'Flap origin upper Snapshot is inconsistent.');
    }
    upperSnapshot = upperAnchor.snapshot;
    initialSourceSet = [upperAnchor.anchor.source];
  } else {
    upperSnapshot = resume.snapshot;
    initialSourceSet = resume.sourceSet;
    if (
      upperSnapshot.chainId !== deployment.chainId ||
      snapshotPosition(upperSnapshot) !== toBlock.toString() ||
      resume.nextBlock < fromBlock ||
      resume.nextBlock > toBlock + 1n
    ) {
      throw new ProviderError('INVALID_RESPONSE', 'Flap origin checkpoint state is inconsistent.');
    }
  }
  const rangeEvidence: Evidence[] = resume?.rangeEvidence.map((item) => ({ ...item })) ?? [];
  const observedCreations: FlapOriginAccumulatedCreation[] =
    resume?.observedCreations.map((item) => ({
      endpointId: item.endpointId,
      creation: { ...item.creation, traceAddress: [...item.creation.traceAddress] },
    })) ?? [];
  const sourceSet = new Set<string>(initialSourceSet);
  const creationIdentities = new Set<string>();
  for (const { creation } of observedCreations) {
    const identity = `${creation.blockHash}:${creation.transactionHash}:${creation.traceAddress.join('.') || 'root'}`;
    if (creationIdentities.has(identity)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Flap origin checkpoint contains a duplicate contract creation.',
      );
    }
    creationIdentities.add(identity);
  }
  for (
    let start = resume?.nextBlock ?? fromBlock;
    start <= toBlock;
    start += BigInt(selectedChunkSize)
  ) {
    const end =
      start + BigInt(selectedChunkSize) - 1n > toBlock
        ? toBlock
        : start + BigInt(selectedChunkSize) - 1n;
    const observation = await creationReader.getContractCreationsObservation({
      address: token,
      fromBlock: start.toString(),
      toBlock: end.toString(),
    });
    if (
      observation.coverage.completion !== 'REQUESTED_RANGE_COMPLETE' ||
      observation.coverage.fromBlock !== start.toString() ||
      observation.coverage.toBlock !== end.toString() ||
      observation.coverage.nextBlock !== (end + 1n).toString()
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Flap origin creation source returned inconsistent range coverage.',
      );
    }
    sourceSet.add(observation.endpointId);
    for (const creation of observation.value) {
      const identity = `${creation.blockHash}:${creation.transactionHash}:${creation.traceAddress.join('.') || 'root'}`;
      if (creationIdentities.has(identity)) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Flap origin chunks returned a duplicate contract creation.',
        );
      }
      creationIdentities.add(identity);
      observedCreations.push({ creation, endpointId: observation.endpointId });
    }
    rangeEvidence.push(
      await writeEvidence(
        createEvidence({
          ledger: 'EVM',
          chainId: deployment.chainId,
          kind: 'PROVIDER_OBSERVATION',
          source: observation.endpointId,
          locator: `contract-creation-traces:${token}:${start}-${end}`,
          payload: {
            filter: { address: token, fromBlock: start.toString(), toBlock: end.toString() },
            coverage: observation.coverage,
            creations: observation.value,
          },
          observedAt: upperSnapshot.capturedAt,
          blockOrSlot: toBlock.toString(),
          finality: upperSnapshot.finality,
          summary: `Contract-creation traces observed for bounded chunk ${start}-${end}.`,
        }),
        [],
        upperSnapshot,
      ),
    );
    if (onChunk !== undefined) {
      await onChunk({
        snapshot: upperSnapshot,
        nextBlock: end + 1n,
        completedToBlock: end,
        rangeEvidence: [...rangeEvidence],
        observedCreations: observedCreations.map((item) => ({
          endpointId: item.endpointId,
          creation: { ...item.creation, traceAddress: [...item.creation.traceAddress] },
        })),
        sourceSet: [...sourceSet].sort(),
      });
    }
  }

  if (observedCreations.length !== 1) {
    const reason = observedCreations.length === 0 ? 'INSUFFICIENT_DATA' : 'CONFLICTING_SOURCES';
    const detail =
      observedCreations.length === 0
        ? 'No creation trace was found in the complete bounded range; the contract origin may be outside it.'
        : 'Multiple creation generations were observed for this address; a unique origin is unsafe.';
    const sourceEvidenceIds = rangeEvidence.map((item) => item.id);
    const derived = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: deployment.chainId,
        kind: observedCreations.length === 0 ? 'NEGATIVE_EVIDENCE' : 'DERIVED_FEATURE',
        source: `zerotrace:${FLAP_TOKEN_ORIGIN_MODEL_VERSION}`,
        locator: `flap-token-origin:${token}:${fromBlock}-${toBlock}`,
        payload: { token, observedCreationCount: observedCreations.length, originState: 'unknown' },
        observedAt: upperSnapshot.capturedAt,
        blockOrSlot: toBlock.toString(),
        finality: upperSnapshot.finality,
        summary: detail,
        sourceEvidenceIds,
      }),
      sourceEvidenceIds,
      upperSnapshot,
    );
    const evidence = [...rangeEvidence, derived];
    return FlapTokenOriginSchema.parse({
      platform: 'flap',
      token,
      searchedRange: {
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        chunkSize: selectedChunkSize,
        chunkCount,
      },
      searchedRangeCoverage: 1,
      origin: unknownValue(reason, detail),
      lifetimeCoverage: unknownValue(
        'INSUFFICIENT_DATA',
        'Lifetime coverage requires a unique creation origin and continuous indexing to the target Snapshot.',
      ),
      observedCreationCount: observedCreations.length,
      metadata: analysisMetadata(upperSnapshot, [...sourceSet], evidence, 0),
      evidence,
    });
  }

  const observedCreation = observedCreations[0];
  if (observedCreation === undefined) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Flap origin observation declared one creation without returning its trace.',
    );
  }
  const { creation: creationTrace, endpointId: creationEndpointId } = observedCreation;
  const transaction = await inspectFlapEventTransaction({
    adapter,
    token,
    transactionHash: creationTrace.transactionHash,
    deployment,
    writeEvidence,
  });
  const creationEvent = transaction.creation;
  const transactionSnapshot = transaction.metadata.snapshot;
  if (
    transaction.platformMatch.state !== 'known' ||
    !transaction.platformMatch.value ||
    creationEvent === null ||
    transactionSnapshot?.ledger !== 'EVM'
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'The contract creation trace cannot be reproduced as a Flap TokenCreated transaction.',
    );
  }
  const position = tracePosition(creationTrace);
  if (
    creationTrace.creator !== portal ||
    position.blockNumber !== creationEvent.position.blockNumber ||
    position.blockHash !== creationEvent.position.blockHash ||
    position.transactionHash !== creationEvent.position.transactionHash ||
    position.transactionIndex !== creationEvent.position.transactionIndex ||
    transactionSnapshot.blockNumber !== position.blockNumber ||
    transactionSnapshot.blockHash !== position.blockHash
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Flap contract-creation trace, receipt event, and replay Snapshot disagree.',
    );
  }

  const traceEvidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'TRACE',
      source: creationEndpointId,
      locator: `contract-creation-trace:${token}:${position.transactionHash}:${position.traceAddress.join('.') || 'root'}`,
      payload: { ...creationTrace, normalizedPosition: position },
      observedAt: transactionSnapshot.capturedAt,
      blockOrSlot: position.blockNumber,
      finality: transactionSnapshot.finality,
      summary: 'Flap token contract creation trace rebound to its exact transaction Snapshot.',
    }),
    [],
    transactionSnapshot,
  );
  const transactionRoot = transactionRootEvidence(transaction.evidence);
  const sourceEvidenceIds = [
    ...rangeEvidence.map((item) => item.id),
    traceEvidence.id,
    transactionRoot.id,
  ];
  const originValue = {
    contractCreator: creationTrace.creator,
    launchCreator: creationEvent.creator,
    bytecodeFingerprint: hashPayload({ bytecode: creationTrace.bytecode }),
    creationTrace: position,
    tokenCreatedPosition: creationEvent.position,
    evidenceIds: sourceEvidenceIds,
  };
  const derived = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${FLAP_TOKEN_ORIGIN_MODEL_VERSION}`,
      locator: `flap-token-origin:${token}:${position.blockNumber}@${toBlock}`,
      payload: { ...originValue, analysisBlockNumber: toBlock.toString() },
      observedAt: upperSnapshot.capturedAt,
      blockOrSlot: toBlock.toString(),
      finality: upperSnapshot.finality,
      summary:
        'Unique Flap token creation trace and TokenCreated receipt event agree through the bounded target Snapshot.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    upperSnapshot,
  );
  const evidence = [...rangeEvidence, ...transaction.evidence, traceEvidence, derived];
  return FlapTokenOriginSchema.parse({
    platform: 'flap',
    token,
    searchedRange: {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      chunkSize: selectedChunkSize,
      chunkCount,
    },
    searchedRangeCoverage: 1,
    origin: knownValue(originValue),
    lifetimeCoverage: unknownValue(
      'INSUFFICIENT_DATA',
      'The creation origin is known, but continuous event indexing to the target Snapshot is not complete.',
    ),
    observedCreationCount: 1,
    metadata: analysisMetadata(
      upperSnapshot,
      [...sourceSet, ...transaction.metadata.sourceSet],
      evidence,
      1,
    ),
    evidence,
  });
}

export async function inspectFlapTokenOrigin(
  options: InspectFlapTokenOriginOptions,
): Promise<FlapTokenOrigin> {
  return runFlapTokenOrigin(options);
}

interface ParsedFlapOriginCheckpointState {
  snapshot: EvmSnapshot | null;
  rangeEvidence: Evidence[];
  observedCreations: FlapOriginAccumulatedCreation[];
  sourceSet: string[];
  result: FlapTokenOrigin | null;
}

function checkpointInvalid(message: string, cause?: unknown): ProviderError {
  return new ProviderError('INVALID_RESPONSE', message, { cause });
}

function checkpointRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw checkpointInvalid(`Flap origin checkpoint ${field} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function checkpointString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw checkpointInvalid(`Flap origin checkpoint ${field} is invalid.`);
  }
  return value;
}

function checkpointCreation(value: unknown, token: string): EvmContractCreationRecord {
  const record = checkpointRecord(value, 'creation');
  const address = checkpointString(record.address, 'creation address');
  const creator = checkpointString(record.creator, 'creation creator');
  const bytecode = checkpointString(record.bytecode, 'creation bytecode');
  const blockHash = checkpointString(record.blockHash, 'creation blockHash');
  const blockNumber = checkpointString(record.blockNumber, 'creation blockNumber');
  const transactionHash = checkpointString(record.transactionHash, 'creation transactionHash');
  const transactionIndex = checkpointString(record.transactionIndex, 'creation transactionIndex');
  if (
    canonicalAddress(address, 'checkpoint creation address') !== address ||
    canonicalAddress(creator, 'checkpoint creation creator') !== creator ||
    address !== token ||
    !/^0x(?:[0-9a-f]{2})+$/.test(bytecode) ||
    !/^0x[0-9a-f]{64}$/.test(blockHash) ||
    !/^0x[0-9a-f]{64}$/.test(transactionHash) ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(blockNumber) ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(transactionIndex)
  ) {
    throw checkpointInvalid('Flap origin checkpoint creation identity is invalid.');
  }
  if (
    !Array.isArray(record.traceAddress) ||
    record.traceAddress.length > 64 ||
    !record.traceAddress.every((item) => Number.isSafeInteger(item) && Number(item) >= 0)
  ) {
    throw checkpointInvalid('Flap origin checkpoint trace address is invalid.');
  }
  const raw = checkpointRecord(record.raw, 'creation raw payload');
  if (!JsonValueSchema.safeParse(raw).success) {
    throw checkpointInvalid('Flap origin checkpoint creation payload is not JSON.');
  }
  return {
    address,
    creator,
    bytecode,
    blockHash,
    blockNumber,
    transactionHash,
    transactionIndex,
    traceAddress: record.traceAddress as number[],
    raw,
  };
}

function checkpointJsonState(
  progress: Omit<FlapOriginResume, 'nextBlock'>,
  result: FlapTokenOrigin | null,
): JsonValue {
  return JsonValueSchema.parse({
    version: FLAP_TOKEN_ORIGIN_CHECKPOINT_VERSION,
    snapshot: progress.snapshot,
    rangeEvidence: progress.rangeEvidence,
    observedCreations: progress.observedCreations,
    sourceSet: [...new Set(progress.sourceSet)].sort(),
    result,
  });
}

function initialCheckpointState(): JsonValue {
  return JsonValueSchema.parse({
    version: FLAP_TOKEN_ORIGIN_CHECKPOINT_VERSION,
    snapshot: null,
    rangeEvidence: [],
    observedCreations: [],
    sourceSet: [],
    result: null,
  });
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function parseCheckpointState(
  run: FlapOriginCheckpointRun,
  request: ValidatedFlapOriginRequest,
): ParsedFlapOriginCheckpointState {
  const parsedJson = JsonValueSchema.safeParse(run.state);
  if (!parsedJson.success) {
    throw checkpointInvalid('Flap origin checkpoint state is not JSON.', parsedJson.error);
  }
  const state = checkpointRecord(parsedJson.data, 'state');
  if (state.version !== FLAP_TOKEN_ORIGIN_CHECKPOINT_VERSION) {
    throw checkpointInvalid('Flap origin checkpoint version is unsupported.');
  }
  const snapshot =
    state.snapshot === null
      ? null
      : (() => {
          const parsed = AnalysisSnapshotSchema.safeParse(state.snapshot);
          if (!parsed.success || parsed.data.ledger !== 'EVM') {
            throw checkpointInvalid('Flap origin checkpoint Snapshot is invalid.', parsed.error);
          }
          return parsed.data;
        })();
  if (!Array.isArray(state.rangeEvidence)) {
    throw checkpointInvalid('Flap origin checkpoint range Evidence is invalid.');
  }
  const rangeEvidence = state.rangeEvidence.map((item) => {
    const parsed = EvidenceSchema.safeParse(item);
    if (!parsed.success) {
      throw checkpointInvalid('Flap origin checkpoint Evidence is invalid.', parsed.error);
    }
    return parsed.data;
  });
  if (!Array.isArray(state.observedCreations)) {
    throw checkpointInvalid('Flap origin checkpoint creations are invalid.');
  }
  const observedCreations = state.observedCreations.map((item) => {
    const record = checkpointRecord(item, 'creation observation');
    return {
      endpointId: checkpointString(record.endpointId, 'creation endpoint'),
      creation: checkpointCreation(record.creation, request.token),
    };
  });
  if (
    !Array.isArray(state.sourceSet) ||
    !state.sourceSet.every((item) => typeof item === 'string' && item !== '')
  ) {
    throw checkpointInvalid('Flap origin checkpoint source set is invalid.');
  }
  const storedSourceSet = state.sourceSet as string[];
  const sourceSet = sortedUnique(storedSourceSet);
  if (
    sourceSet.length !== storedSourceSet.length ||
    sourceSet.some((item, index) => item !== storedSourceSet[index])
  ) {
    throw checkpointInvalid('Flap origin checkpoint source set is not canonical.');
  }
  const result =
    state.result === null
      ? null
      : (() => {
          const parsed = FlapTokenOriginSchema.safeParse(state.result);
          if (!parsed.success) {
            throw checkpointInvalid('Flap origin checkpoint result is invalid.', parsed.error);
          }
          return parsed.data;
        })();
  const fromBlock = Number(request.fromBlock);
  const toBlock = Number(request.toBlock);
  if (
    !Number.isSafeInteger(run.nextBlock) ||
    run.nextBlock < fromBlock ||
    run.nextBlock > toBlock + 1
  ) {
    throw checkpointInvalid('Flap origin checkpoint cursor is outside its requested range.');
  }
  const processedBlocks = run.nextBlock - fromBlock;
  const expectedChunks =
    processedBlocks === 0 ? 0 : Math.ceil(processedBlocks / request.selectedChunkSize);
  const expectedNextBlock = Math.min(
    fromBlock + expectedChunks * request.selectedChunkSize,
    toBlock + 1,
  );
  if (rangeEvidence.length !== expectedChunks || run.nextBlock !== expectedNextBlock) {
    throw checkpointInvalid('Flap origin checkpoint chunk Evidence coverage is inconsistent.');
  }
  for (let index = 0; index < rangeEvidence.length; index += 1) {
    const evidence = rangeEvidence[index];
    if (evidence === undefined)
      throw checkpointInvalid('Flap origin checkpoint Evidence vanished.');
    const start = request.fromBlock + BigInt(index * request.selectedChunkSize);
    const end =
      start + BigInt(request.selectedChunkSize) - 1n > request.toBlock
        ? request.toBlock
        : start + BigInt(request.selectedChunkSize) - 1n;
    if (
      evidence.kind !== 'PROVIDER_OBSERVATION' ||
      evidence.ledger !== 'EVM' ||
      evidence.chainId !== request.deployment.chainId ||
      evidence.locator !== `contract-creation-traces:${request.token}:${start}-${end}` ||
      evidence.observedAt !== snapshot?.capturedAt ||
      evidence.blockOrSlot !== request.toBlock.toString() ||
      evidence.finality !== snapshot?.finality ||
      !sourceSet.includes(evidence.source) ||
      evidence.id !== evidenceIdFor(evidence)
    ) {
      throw checkpointInvalid('Flap origin checkpoint Evidence coverage is inconsistent.');
    }
  }
  if (processedBlocks === 0) {
    if (
      snapshot !== null ||
      rangeEvidence.length !== 0 ||
      observedCreations.length !== 0 ||
      sourceSet.length !== 0 ||
      result !== null
    ) {
      throw checkpointInvalid('Unstarted Flap origin checkpoint contains materialized state.');
    }
  } else if (
    snapshot === null ||
    snapshot.chainId !== request.deployment.chainId ||
    snapshot.blockNumber !== request.toBlock.toString()
  ) {
    throw checkpointInvalid('Flap origin checkpoint Snapshot does not bind the target block.');
  }
  const creationIdentities = new Set<string>();
  for (const item of observedCreations) {
    const position = tracePosition(item.creation);
    if (
      BigInt(position.blockNumber) < request.fromBlock ||
      BigInt(position.blockNumber) >= BigInt(run.nextBlock)
    ) {
      throw checkpointInvalid('Flap origin checkpoint creation is outside completed coverage.');
    }
    const identity = `${position.blockHash}:${position.transactionHash}:${position.traceAddress.join('.') || 'root'}`;
    if (creationIdentities.has(identity)) {
      throw checkpointInvalid('Flap origin checkpoint creations are duplicated.');
    }
    creationIdentities.add(identity);
  }
  if (
    !observedCreations.every((item) => sourceSet.includes(item.endpointId)) ||
    (processedBlocks > 0 && sourceSet.length < 2)
  ) {
    throw checkpointInvalid('Flap origin checkpoint source coverage is inconsistent.');
  }
  if (
    result !== null &&
    (result.token !== request.token ||
      result.searchedRange.fromBlock !== request.fromBlock.toString() ||
      result.searchedRange.toBlock !== request.toBlock.toString() ||
      result.searchedRange.chunkSize !== request.selectedChunkSize ||
      result.searchedRange.chunkCount !== request.chunkCount ||
      result.observedCreationCount !== observedCreations.length)
  ) {
    throw checkpointInvalid('Flap origin checkpoint result identity is inconsistent.');
  }
  if (run.status === 'REQUESTED_RANGE_COMPLETE' && result === null) {
    throw checkpointInvalid('Completed Flap origin checkpoint has no terminal result.');
  }
  if (result !== null && run.nextBlock !== toBlock + 1) {
    throw checkpointInvalid(
      'Flap origin checkpoint materialized a result before complete coverage.',
    );
  }
  const stateEvidenceIds = sortedUnique(
    (result?.evidence ?? rangeEvidence).map((evidence) => evidence.id),
  );
  const rangeEvidenceIds = new Set(rangeEvidence.map((evidence) => evidence.id));
  if (
    result !== null &&
    [...rangeEvidenceIds].some((id) => !result.evidence.some((evidence) => evidence.id === id))
  ) {
    throw checkpointInvalid('Flap origin checkpoint result dropped range Evidence.');
  }
  if (
    stateEvidenceIds.length !== run.evidenceIds.length ||
    stateEvidenceIds.some((item, index) => item !== run.evidenceIds[index])
  ) {
    throw checkpointInvalid('Flap origin checkpoint Evidence IDs are inconsistent.');
  }
  return { snapshot, rangeEvidence, observedCreations, sourceSet, result };
}

function checkpointIdentity(
  request: ValidatedFlapOriginRequest,
): Readonly<Record<string, JsonValue>> {
  return {
    version: FLAP_TOKEN_ORIGIN_CHECKPOINT_VERSION,
    modelVersion: FLAP_TOKEN_ORIGIN_MODEL_VERSION,
    token: request.token,
    chainId: request.deployment.chainId,
    portal: request.portal,
    documentedVersion: request.deployment.documentedVersion,
    sourceRevision: request.deployment.sourceRevision,
    snapshotTag: request.adapter.config.snapshotBlockTag ?? 'latest',
    inspectionMethods: [...request.deployment.inspectionMethods],
    fromBlock: request.fromBlock.toString(),
    toBlock: request.toBlock.toString(),
    chunkSize: request.selectedChunkSize,
  };
}

function safeCheckpointFailureCode(error: unknown): string {
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
  return 'FLAP_ORIGIN_FAILED';
}

export async function inspectFlapTokenOriginRestartSafe(
  options: InspectFlapTokenOriginOptions & { checkpoints: FlapOriginCheckpointStore },
): Promise<FlapTokenOrigin> {
  const request = validateOriginRequest(options);
  const fromBlock = Number(request.fromBlock);
  const toBlock = Number(request.toBlock);
  if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Durable Flap origin cursors require safe-integer block positions.',
    );
  }
  let run: FlapOriginCheckpointRun | undefined;
  try {
    run = await options.checkpoints.begin({
      scanType: 'FLAP_CONTRACT_ORIGIN',
      source: FLAP_TOKEN_ORIGIN_CHECKPOINT_SOURCE,
      ledger: 'EVM',
      chainId: request.deployment.chainId,
      subject: request.token,
      fromBlock,
      toBlock,
      chunkSize: request.selectedChunkSize,
      identity: checkpointIdentity(request),
      initialState: initialCheckpointState(),
    });
    const stored = parseCheckpointState(run, request);
    if (run.status === 'REQUESTED_RANGE_COMPLETE') {
      if (stored.result === null) {
        throw checkpointInvalid('Completed Flap origin checkpoint result vanished.');
      }
      return stored.result;
    }

    let latestResume: FlapOriginResume | undefined =
      stored.snapshot === null
        ? undefined
        : {
            snapshot: stored.snapshot,
            nextBlock: BigInt(run.nextBlock),
            rangeEvidence: stored.rangeEvidence,
            observedCreations: stored.observedCreations,
            sourceSet: stored.sourceSet,
          };
    const result = await runFlapTokenOrigin(options, latestResume, async (progress) => {
      if (run === undefined) throw checkpointInvalid('Flap origin checkpoint run vanished.');
      const state = checkpointJsonState(progress, null);
      run = await options.checkpoints.advance(run.id, {
        expectedNextBlock: run.nextBlock,
        completedToBlock: Number(progress.completedToBlock),
        state,
        evidenceIds: sortedUnique(progress.rangeEvidence.map((item) => item.id)),
      });
      latestResume = {
        snapshot: progress.snapshot,
        nextBlock: progress.nextBlock,
        rangeEvidence: progress.rangeEvidence,
        observedCreations: progress.observedCreations,
        sourceSet: progress.sourceSet,
      };
    });
    if (run === undefined || latestResume === undefined || run.nextBlock !== toBlock + 1) {
      throw checkpointInvalid('Flap origin checkpoint did not reach exact requested coverage.');
    }
    const terminalState = checkpointJsonState(latestResume, result);
    const completed = await options.checkpoints.finish(run.id, {
      state: terminalState,
      evidenceIds: sortedUnique(result.evidence.map((item) => item.id)),
    });
    const replay = parseCheckpointState(completed, request);
    if (replay.result === null) {
      throw checkpointInvalid('Flap origin terminal checkpoint result vanished.');
    }
    return replay.result;
  } catch (error) {
    if (run?.status === 'RUNNING') {
      try {
        await options.checkpoints.recordFailure(run.id, safeCheckpointFailureCode(error));
      } catch {
        // Preserve the original provider, validation, or checkpoint error.
      }
    }
    throw error;
  }
}
