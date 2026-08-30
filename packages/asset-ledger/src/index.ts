import { contentAddressedId } from '@zerotrace/evidence';
import {
  AnalysisSnapshotSchema,
  type AnalysisSnapshot,
  type AssetId,
  type ChainPosition,
  type Ledger,
} from '@zerotrace/schemas';

export * from './paper-simulation.js';
export * from './paper-review.js';

export const ASSET_LEDGER_MODEL_VERSION = 'asset-ledger-v1.1.0-cross-ledger-boundary';

export type AssetEventKind =
  | 'TRANSFER'
  | 'SWAP_IN'
  | 'SWAP_OUT'
  | 'MINT'
  | 'BURN'
  | 'LP_ADD'
  | 'LP_REMOVE'
  | 'FEE'
  | 'BRIDGE_DEPOSIT'
  | 'BRIDGE_RELEASE'
  | 'CEX_DEPOSIT'
  | 'GAS'
  | 'FAILED';

export interface AssetLedgerEvent {
  id: string;
  kind: AssetEventKind;
  ledger: Ledger;
  chainId: string;
  txId: string;
  position: ChainPosition;
  asset: AssetId;
  from: string;
  to: string;
  amountAtomic: string;
  swapGroupId?: string;
  matchedBridgeEventId?: string;
  internal: boolean;
  failed: boolean;
  evidenceIds: readonly string[];
}

export interface SwapLinkInput {
  txId: string;
  input: AssetLedgerEvent;
  output: AssetLedgerEvent;
  evidenceIds: readonly string[];
}

export function parseAtomic(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer string.`);
  }
  return BigInt(value);
}

export function linkSwapLegs(input: SwapLinkInput): {
  input: AssetLedgerEvent;
  output: AssetLedgerEvent;
  groupId: string;
} {
  if (input.input.txId !== input.output.txId || input.input.txId !== input.txId) {
    throw new Error('Swap legs must share one transaction identity.');
  }
  if (input.input.kind !== 'SWAP_IN' || input.output.kind !== 'SWAP_OUT') {
    throw new Error('Swap legs must be SWAP_IN then SWAP_OUT.');
  }
  if (input.input.failed || input.output.failed) {
    throw new Error('Failed execution cannot create a completed swap.');
  }
  const groupId = contentAddressedId('swp', {
    txId: input.txId,
    in: input.input.id,
    out: input.output.id,
  });
  return {
    groupId,
    input: { ...input.input, swapGroupId: groupId },
    output: { ...input.output, swapGroupId: groupId },
  };
}

export function assertNoUnlinkedSwapIncome(events: readonly AssetLedgerEvent[]): void {
  const groups = new Map<string, AssetLedgerEvent[]>();
  for (const event of events) {
    if (event.kind !== 'SWAP_IN' && event.kind !== 'SWAP_OUT') continue;
    if (event.swapGroupId === undefined) {
      throw new Error(`Swap event ${event.id} is missing an explicit swap group.`);
    }
    const list = groups.get(event.swapGroupId) ?? [];
    list.push(event);
    groups.set(event.swapGroupId, list);
  }
  for (const [groupId, legs] of groups) {
    const hasIn = legs.some((item) => item.kind === 'SWAP_IN');
    const hasOut = legs.some((item) => item.kind === 'SWAP_OUT');
    if (!hasIn || !hasOut) {
      throw new Error(`Swap group ${groupId} is incomplete and cannot be treated as income.`);
    }
  }
}

function sameAssetIdentity(left: AssetId, right: AssetId): boolean {
  const sameToken =
    left.ledger === 'EVM'
      ? left.token.toLowerCase() === right.token.toLowerCase()
      : left.token === right.token;
  return left.ledger === right.ledger && left.chainId === right.chainId && sameToken;
}

function snapshotPosition(snapshot: AnalysisSnapshot): string {
  if (snapshot.ledger === 'EVM') return snapshot.blockNumber;
  if (snapshot.ledger === 'BITCOIN') return snapshot.height;
  return snapshot.slot;
}

function validateSnapshotEvent(snapshotInput: AnalysisSnapshot, event: AssetLedgerEvent): void {
  const snapshot = AnalysisSnapshotSchema.parse(snapshotInput);
  if (
    event.ledger !== event.position.ledger ||
    event.chainId !== event.position.chainId ||
    event.asset.ledger !== event.ledger ||
    event.asset.chainId !== event.chainId ||
    snapshot.ledger !== event.ledger ||
    snapshot.chainId !== event.chainId ||
    snapshotPosition(snapshot) !== event.position.blockOrSlot
  ) {
    throw new Error('Bridge event, asset, position, and Snapshot identities must agree exactly.');
  }
}

function assertHttpsSources(sources: readonly string[]): void {
  if (sources.length === 0) throw new Error('Bridge proof requires an official source URI.');
  for (const source of sources) {
    let parsed: URL;
    try {
      parsed = new URL(source);
    } catch {
      throw new Error('Bridge proof official source URI is invalid.');
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('Bridge proof official source URI must use HTTPS.');
    }
  }
}

export interface BridgeMessageProof {
  protocol: string;
  protocolVersion: string;
  protocolMessageId: string;
  sourceMessageRef: string;
  destinationMessageRef: string;
  sourceEventId: string;
  destinationEventId: string;
  sourceSender: string;
  sourceBridgeEndpoint: string;
  destinationBridgeEndpoint: string;
  destinationRecipient: string;
  sourceAsset: AssetId;
  destinationAsset: AssetId;
  sourceDecimals: number;
  destinationDecimals: number;
  canonicalDecimals: number;
  feeCanonicalAtomic: string;
  sourceSnapshot: AnalysisSnapshot;
  destinationSnapshot: AnalysisSnapshot;
  officialSourceUris: readonly string[];
  evidenceIds: readonly string[];
  modelVersion: string;
}

export interface BridgePairMatch {
  id: string;
  status: 'VERIFIED_PROTOCOL_MESSAGE';
  protocol: string;
  protocolVersion: string;
  protocolMessageId: string;
  sourceMessageRef: string;
  destinationMessageRef: string;
  sourceEvent: AssetLedgerEvent;
  destinationEvent: AssetLedgerEvent;
  sourceSnapshot: AnalysisSnapshot;
  destinationSnapshot: AnalysisSnapshot;
  sourceAsset: AssetId;
  destinationAsset: AssetId;
  canonicalDecimals: number;
  sourceAmountCanonicalAtomic: string;
  destinationAmountCanonicalAtomic: string;
  feeCanonicalAtomic: string;
  evidenceIds: string[];
  officialSourceUris: string[];
  modelVersion: string;
  realizationStatus: 'CROSS_LEDGER_TRANSFER_NOT_MARKET_REALIZATION';
}

export function matchBridgePair(
  deposit: AssetLedgerEvent,
  release: AssetLedgerEvent,
  proof?: BridgeMessageProof,
): BridgePairMatch {
  if (deposit.kind !== 'BRIDGE_DEPOSIT' || release.kind !== 'BRIDGE_RELEASE') {
    throw new Error('Bridge match requires deposit and release events.');
  }
  if (deposit.failed || release.failed) {
    throw new Error('Failed bridge execution cannot create a cross-ledger match.');
  }
  if (proof === undefined) {
    throw new Error(
      'Bridge amount/asset coincidence is insufficient; protocol message proof is required.',
    );
  }
  validateSnapshotEvent(proof.sourceSnapshot, deposit);
  validateSnapshotEvent(proof.destinationSnapshot, release);
  if (deposit.ledger === release.ledger && deposit.chainId === release.chainId) {
    throw new Error('Bridge match requires distinct source and destination ledgers or chains.');
  }
  if (
    proof.protocol.trim().length === 0 ||
    proof.protocolVersion.trim().length === 0 ||
    proof.protocolMessageId.trim().length === 0 ||
    proof.sourceMessageRef.trim().length === 0 ||
    proof.destinationMessageRef.trim().length === 0 ||
    proof.modelVersion.trim().length === 0
  ) {
    throw new Error('Bridge proof protocol, message, and model identities are required.');
  }
  if (
    proof.sourceEventId !== deposit.id ||
    proof.destinationEventId !== release.id ||
    proof.sourceSender !== deposit.from ||
    proof.sourceBridgeEndpoint !== deposit.to ||
    proof.destinationBridgeEndpoint !== release.from ||
    proof.destinationRecipient !== release.to
  ) {
    throw new Error('Bridge proof event and endpoint bindings do not match the ledger events.');
  }
  if (
    !sameAssetIdentity(proof.sourceAsset, deposit.asset) ||
    !sameAssetIdentity(proof.destinationAsset, release.asset)
  ) {
    throw new Error('Bridge proof asset mapping does not match the ledger events.');
  }
  for (const [name, decimals] of [
    ['sourceDecimals', proof.sourceDecimals],
    ['destinationDecimals', proof.destinationDecimals],
    ['canonicalDecimals', proof.canonicalDecimals],
  ] as const) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new Error(`Bridge proof ${name} must be an integer from 0 through 36.`);
    }
  }
  if (
    proof.canonicalDecimals < proof.sourceDecimals ||
    proof.canonicalDecimals < proof.destinationDecimals ||
    (deposit.asset.decimals !== undefined && deposit.asset.decimals !== proof.sourceDecimals) ||
    (release.asset.decimals !== undefined && release.asset.decimals !== proof.destinationDecimals)
  ) {
    throw new Error('Bridge proof decimal mapping is inconsistent with its assets.');
  }
  assertHttpsSources(proof.officialSourceUris);
  const evidenceIds = [
    ...new Set([...deposit.evidenceIds, ...release.evidenceIds, ...proof.evidenceIds]),
  ].sort();
  if (
    evidenceIds.length < 2 ||
    deposit.evidenceIds.some((id) => !proof.evidenceIds.includes(id)) ||
    release.evidenceIds.some((id) => !proof.evidenceIds.includes(id))
  ) {
    throw new Error('Bridge proof must bind distinct source and destination Evidence.');
  }
  const sourceAmount =
    parseAtomic(deposit.amountAtomic, 'deposit.amountAtomic') *
    10n ** BigInt(proof.canonicalDecimals - proof.sourceDecimals);
  const destinationAmount =
    parseAtomic(release.amountAtomic, 'release.amountAtomic') *
    10n ** BigInt(proof.canonicalDecimals - proof.destinationDecimals);
  const fee = parseAtomic(proof.feeCanonicalAtomic, 'feeCanonicalAtomic');
  if (sourceAmount !== destinationAmount + fee) {
    throw new Error(
      'Bridge canonical amount must equal destination release plus explicit bridge fee.',
    );
  }
  const sourceEvent = { ...deposit, matchedBridgeEventId: release.id };
  const destinationEvent = { ...release, matchedBridgeEventId: deposit.id };
  const matchPayload = {
    protocol: proof.protocol,
    protocolVersion: proof.protocolVersion,
    protocolMessageId: proof.protocolMessageId,
    sourceMessageRef: proof.sourceMessageRef,
    destinationMessageRef: proof.destinationMessageRef,
    sourceEventId: deposit.id,
    destinationEventId: release.id,
    sourceSnapshot: proof.sourceSnapshot,
    destinationSnapshot: proof.destinationSnapshot,
    evidenceIds,
    modelVersion: proof.modelVersion,
  };
  return {
    id: contentAddressedId('brm', matchPayload),
    status: 'VERIFIED_PROTOCOL_MESSAGE',
    protocol: proof.protocol,
    protocolVersion: proof.protocolVersion,
    protocolMessageId: proof.protocolMessageId,
    sourceMessageRef: proof.sourceMessageRef,
    destinationMessageRef: proof.destinationMessageRef,
    sourceEvent,
    destinationEvent,
    sourceSnapshot: proof.sourceSnapshot,
    destinationSnapshot: proof.destinationSnapshot,
    sourceAsset: proof.sourceAsset,
    destinationAsset: proof.destinationAsset,
    canonicalDecimals: proof.canonicalDecimals,
    sourceAmountCanonicalAtomic: sourceAmount.toString(),
    destinationAmountCanonicalAtomic: destinationAmount.toString(),
    feeCanonicalAtomic: fee.toString(),
    evidenceIds,
    officialSourceUris: [...new Set(proof.officialSourceUris)].sort(),
    modelVersion: proof.modelVersion,
    realizationStatus: 'CROSS_LEDGER_TRANSFER_NOT_MARKET_REALIZATION',
  };
}

export type TerminalBoundaryKind = 'CEX' | 'BRIDGE_UNMATCHED' | 'PRIVACY_TOOL' | 'UNKNOWN';

export interface TerminalBoundaryInput {
  event: AssetLedgerEvent;
  boundary: TerminalBoundaryKind;
  snapshot: AnalysisSnapshot;
  coverage: number;
  freshness: string;
  sourceSet: readonly string[];
  evidenceIds: readonly string[];
  modelVersion: string;
  evidenceScore: number;
}

export interface TerminalBoundaryObservation {
  id: string;
  status: 'LAST_OBSERVABLE_BOUNDARY';
  boundary: TerminalBoundaryKind;
  event: AssetLedgerEvent;
  snapshot: AnalysisSnapshot;
  coverage: number;
  freshness: string;
  sourceSet: string[];
  evidenceIds: string[];
  modelVersion: string;
  confidence: {
    kind: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY';
    score: number;
  };
  ownershipPropagation: 'STOPPED';
  realization: {
    state: 'unknown';
    reason: 'BOUNDARY_IS_NOT_CONFIRMED_REALIZATION';
  };
}

export function createTerminalBoundary(input: TerminalBoundaryInput): TerminalBoundaryObservation {
  validateSnapshotEvent(input.snapshot, input.event);
  if (input.event.failed)
    throw new Error('Failed event cannot establish an observed venue boundary.');
  if (
    (input.boundary === 'CEX' && input.event.kind !== 'CEX_DEPOSIT') ||
    (input.boundary === 'BRIDGE_UNMATCHED' && input.event.kind !== 'BRIDGE_DEPOSIT')
  ) {
    throw new Error('Terminal boundary kind does not match the classified asset-ledger event.');
  }
  if (
    input.coverage < 0 ||
    input.coverage > 1 ||
    input.evidenceScore < 0 ||
    input.evidenceScore > 100 ||
    !Number.isFinite(Date.parse(input.freshness)) ||
    input.sourceSet.length === 0 ||
    input.modelVersion.trim().length === 0
  ) {
    throw new Error(
      'Terminal boundary coverage, freshness, source, model, or Evidence score is invalid.',
    );
  }
  const evidenceIds = [...new Set(input.evidenceIds)].sort();
  if (evidenceIds.length === 0 || input.event.evidenceIds.some((id) => !evidenceIds.includes(id))) {
    throw new Error('Terminal boundary must preserve the event Evidence set.');
  }
  const payload = {
    eventId: input.event.id,
    boundary: input.boundary,
    snapshot: input.snapshot,
    evidenceIds,
    modelVersion: input.modelVersion,
  };
  return {
    id: contentAddressedId('bnd', payload),
    status: 'LAST_OBSERVABLE_BOUNDARY',
    boundary: input.boundary,
    event: input.event,
    snapshot: input.snapshot,
    coverage: input.coverage,
    freshness: new Date(input.freshness).toISOString(),
    sourceSet: [...new Set(input.sourceSet)].sort(),
    evidenceIds,
    modelVersion: input.modelVersion,
    confidence: {
      kind: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY',
      score: input.evidenceScore,
    },
    ownershipPropagation: 'STOPPED',
    realization: {
      state: 'unknown',
      reason: 'BOUNDARY_IS_NOT_CONFIRMED_REALIZATION',
    },
  };
}

export function netAtomicFlow(
  events: readonly AssetLedgerEvent[],
  owner: string,
  asset: AssetId,
): bigint {
  let net = 0n;
  for (const event of events) {
    if (event.failed) continue;
    if (
      event.asset.ledger !== asset.ledger ||
      event.asset.chainId !== asset.chainId ||
      event.asset.token.toLowerCase() !== asset.token.toLowerCase()
    ) {
      continue;
    }
    const amount = parseAtomic(event.amountAtomic, 'amountAtomic');
    if (event.to === owner) net += amount;
    if (event.from === owner) net -= amount;
  }
  return net;
}
