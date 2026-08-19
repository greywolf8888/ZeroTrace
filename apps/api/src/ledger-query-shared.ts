import { ProviderError } from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  BitcoinSnapshotSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type ChainAnchorRead,
  type Evidence,
  type SubjectReference,
} from '@zerotrace/schemas';

export type EvidenceWriter = (
  evidence: Evidence,
  sourceEvidenceIds?: readonly string[],
  snapshot?: AnalysisSnapshot,
) => Promise<Evidence>;

export type BitcoinAnalysisSnapshot = Extract<AnalysisSnapshot, { ledger: 'BITCOIN' }>;

export function uniqueSourceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

export function snapshotSources(snapshot: AnalysisSnapshot): string[] {
  return Object.keys(snapshot.providerVersions);
}

export function position(snapshot: AnalysisSnapshot): string {
  switch (snapshot.ledger) {
    case 'EVM':
      return snapshot.blockNumber;
    case 'BITCOIN':
      return snapshot.height;
    case 'SOLANA':
      return snapshot.slot;
  }
}

export function snapshotFinality(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'SOLANA' ? snapshot.commitment : snapshot.finality;
}

export function metadata(
  snapshot: AnalysisSnapshot,
  sourceIds: readonly string[],
  modelVersion: string,
  evidenceIds: readonly string[],
  options: { dataCoverage?: number; historyCoverage?: number; confidence?: number } = {},
): AnalysisMetadata {
  const sourceSet = uniqueSourceIds([...snapshotSources(snapshot), ...sourceIds]);
  return {
    snapshot,
    dataCoverage: options.dataCoverage ?? 1,
    sourceCoverage: Math.min(1, sourceSet.length / 2),
    historyCoverage: options.historyCoverage ?? 0,
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet,
    modelVersion,
    confidence: options.confidence ?? 1,
    evidenceIds: [...evidenceIds],
  };
}

export function decimalHexQuantity(value: string, field: string): string {
  if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `EVM ${field} is not a canonical quantity.`);
  }
  return BigInt(value).toString();
}

export function unixTimestamp(value: string | undefined) {
  if (value === undefined) return unknownValue('INSUFFICIENT_DATA', 'Block time was not returned.');
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds > Math.floor(Number.MAX_SAFE_INTEGER / 1_000)) {
    return unknownValue('PRECISION_UNSAFE', 'Block time exceeds safe date precision.');
  }
  return knownValue(new Date(seconds * 1_000).toISOString());
}

export function bitcoinObservationSnapshot(
  anchor: AnalysisSnapshot,
  payload: unknown,
  observationSourceIds: readonly string[],
): BitcoinAnalysisSnapshot {
  if (anchor.ledger !== 'BITCOIN') {
    throw new TypeError('Bitcoin observation snapshots require a Bitcoin anchor.');
  }
  const sourceIds = uniqueSourceIds([...snapshotSources(anchor), ...observationSourceIds]);
  const capturedAt = new Date().toISOString();
  return BitcoinSnapshotSchema.parse({
    ...anchor,
    capturedAt,
    providerVersions: Object.fromEntries(sourceIds.map((id) => [id, 'esplora-http'])),
    configHash: hashPayload({
      anchorConfigHash: anchor.configHash,
      observationSourceIds: sourceIds,
    }),
    mempoolSnapshot: `sha256:${hashPayload({
      anchorHeight: anchor.height,
      anchorHash: anchor.blockHash,
      payload,
      sourceIds,
    })}`,
  });
}

export async function blockResult(
  subject: SubjectReference,
  anchorRead: ChainAnchorRead,
  writeEvidence: EvidenceWriter,
  modelVersion: string,
) {
  const snapshot = anchorRead.snapshot;
  const blockPosition = position(snapshot);
  const evidence = await writeEvidence(
    createEvidence({
      ledger: snapshot.ledger,
      chainId: snapshot.chainId,
      kind: 'BLOCK',
      source: anchorRead.anchor.source,
      locator: `block:${anchorRead.anchor.hash}@${blockPosition}`,
      payload: anchorRead.payload,
      observedAt: anchorRead.anchor.observedAt,
      blockOrSlot: blockPosition,
      finality: anchorRead.anchor.finality,
      summary: `${snapshot.ledger} block anchored by position and hash.`,
    }),
    [],
    snapshot,
  );
  const timestamp =
    snapshot.ledger === 'EVM'
      ? snapshot.blockTimestamp === undefined
        ? unknownValue('INSUFFICIENT_DATA')
        : knownValue(snapshot.blockTimestamp)
      : snapshot.ledger === 'SOLANA'
        ? snapshot.blockTimestamp === undefined
          ? unknownValue('INSUFFICIENT_DATA')
          : knownValue(snapshot.blockTimestamp)
        : unknownValue('NOT_QUERIED', 'Bitcoin timestamp remains in the captured block payload.');
  return {
    subject,
    facts: {
      position: knownValue(anchorRead.anchor.position),
      hash: knownValue(anchorRead.anchor.hash),
      parentPosition:
        anchorRead.anchor.parentPosition === undefined
          ? unknownValue('INSUFFICIENT_DATA')
          : knownValue(anchorRead.anchor.parentPosition),
      parentHash:
        anchorRead.anchor.parentHash === undefined
          ? unknownValue('INSUFFICIENT_DATA')
          : knownValue(anchorRead.anchor.parentHash),
      finality: knownValue(anchorRead.anchor.finality),
      timestamp,
    },
    metadata: metadata(snapshot, [anchorRead.anchor.source], modelVersion, [evidence.id]),
    evidence: [evidence],
  };
}
