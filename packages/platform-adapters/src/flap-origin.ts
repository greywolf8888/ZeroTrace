import {
  ProviderError,
  type EvmContractCreationReader,
  type EvmContractCreationRecord,
  type EvmLedgerAdapter,
  type EvmSnapshot,
} from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  FlapTokenOriginSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type Evidence,
  type FlapTokenOrigin,
} from '@zerotrace/schemas';
import { getAddress } from 'viem';

import { inspectFlapEventTransaction } from './flap-events.js';
import type { FlapDeployment, FlapEvidenceWriter } from './flap.js';

export const FLAP_TOKEN_ORIGIN_MODEL_VERSION = 'flap-token-origin-v1';
export const FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS = 1_000_000;

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

export async function inspectFlapTokenOrigin(options: {
  adapter: EvmLedgerAdapter;
  creationReader: EvmContractCreationReader;
  token: string;
  fromBlock: string;
  toBlock: string;
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
}): Promise<FlapTokenOrigin> {
  const { adapter, creationReader, deployment, writeEvidence } = options;
  const token = canonicalAddress(options.token, 'origin token');
  const portal = canonicalAddress(deployment.portal, 'origin Portal');
  const fromBlock = decimalPosition(options.fromBlock, 'origin fromBlock');
  const toBlock = decimalPosition(options.toBlock, 'origin toBlock');
  if (toBlock < fromBlock) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap origin range ends before it begins.');
  }
  if (toBlock - fromBlock + 1n > BigInt(FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap origin range exceeds ${FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS} blocks.`,
    );
  }
  if (`eip155:${adapter.config.chainId}` !== deployment.chainId) {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap origin deployment and adapter chains differ.');
  }

  const upperAnchor = await adapter.readAnchorAt(toBlock.toString());
  if (
    upperAnchor.snapshot.ledger !== 'EVM' ||
    upperAnchor.snapshot.chainId !== deployment.chainId ||
    snapshotPosition(upperAnchor.snapshot) !== toBlock.toString()
  ) {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap origin upper Snapshot is inconsistent.');
  }
  const observation = await creationReader.getContractCreationsObservation({
    address: token,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
  });
  const rangeEvidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'PROVIDER_OBSERVATION',
      source: observation.endpointId,
      locator: `contract-creation-traces:${token}:${fromBlock}-${toBlock}`,
      payload: {
        filter: { address: token, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() },
        creations: observation.value,
      },
      observedAt: upperAnchor.snapshot.capturedAt,
      blockOrSlot: toBlock.toString(),
      finality: upperAnchor.snapshot.finality,
      summary: `Contract-creation traces observed for bounded block range ${fromBlock}-${toBlock}.`,
    }),
    [],
    upperAnchor.snapshot,
  );

  if (observation.value.length !== 1) {
    const reason = observation.value.length === 0 ? 'INSUFFICIENT_DATA' : 'CONFLICTING_SOURCES';
    const detail =
      observation.value.length === 0
        ? 'No creation trace was found in the complete bounded range; the contract origin may be outside it.'
        : 'Multiple creation generations were observed for this address; a unique origin is unsafe.';
    const derived = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: deployment.chainId,
        kind: observation.value.length === 0 ? 'NEGATIVE_EVIDENCE' : 'DERIVED_FEATURE',
        source: `zerotrace:${FLAP_TOKEN_ORIGIN_MODEL_VERSION}`,
        locator: `flap-token-origin:${token}:${fromBlock}-${toBlock}`,
        payload: { token, observedCreationCount: observation.value.length, originState: 'unknown' },
        observedAt: upperAnchor.snapshot.capturedAt,
        blockOrSlot: toBlock.toString(),
        finality: upperAnchor.snapshot.finality,
        summary: detail,
        sourceEvidenceIds: [rangeEvidence.id],
      }),
      [rangeEvidence.id],
      upperAnchor.snapshot,
    );
    const evidence = [rangeEvidence, derived];
    return FlapTokenOriginSchema.parse({
      platform: 'flap',
      token,
      searchedRange: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() },
      searchedRangeCoverage: 1,
      origin: unknownValue(reason, detail),
      lifetimeCoverage: unknownValue(
        'INSUFFICIENT_DATA',
        'Lifetime coverage requires a unique creation origin and continuous indexing to the target Snapshot.',
      ),
      observedCreationCount: observation.value.length,
      metadata: analysisMetadata(
        upperAnchor.snapshot,
        [upperAnchor.anchor.source, observation.endpointId],
        evidence,
        0,
      ),
      evidence,
    });
  }

  const creationTrace = observation.value[0];
  if (creationTrace === undefined) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Flap origin observation declared one creation without returning its trace.',
    );
  }
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
      source: observation.endpointId,
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
  const sourceEvidenceIds = [rangeEvidence.id, traceEvidence.id, transactionRoot.id];
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
      observedAt: upperAnchor.snapshot.capturedAt,
      blockOrSlot: toBlock.toString(),
      finality: upperAnchor.snapshot.finality,
      summary:
        'Unique Flap token creation trace and TokenCreated receipt event agree through the bounded target Snapshot.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    upperAnchor.snapshot,
  );
  const evidence = [rangeEvidence, ...transaction.evidence, traceEvidence, derived];
  return FlapTokenOriginSchema.parse({
    platform: 'flap',
    token,
    searchedRange: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() },
    searchedRangeCoverage: 1,
    origin: knownValue(originValue),
    lifetimeCoverage: unknownValue(
      'INSUFFICIENT_DATA',
      'The creation origin is known, but continuous event indexing to the target Snapshot is not complete.',
    ),
    observedCreationCount: 1,
    metadata: analysisMetadata(
      upperAnchor.snapshot,
      [upperAnchor.anchor.source, observation.endpointId, ...transaction.metadata.sourceSet],
      evidence,
      1,
    ),
    evidence,
  });
}
