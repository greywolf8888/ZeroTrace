import { hashPayload } from '@zerotrace/evidence';
import {
  ControlCampaignSchema,
  ControlClusterVersionSchema,
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type BehaviorEvent,
  type ControlCampaign,
  type ControlCampaignStage,
  type ControlClusterVersion,
  type KnowledgeValue,
  type ClusterPosition,
  type CampaignWalletRole,
} from '@zerotrace/schemas';

export const CAMPAIGN_ENGINE_MODEL_VERSION = 'campaign-v1.0.0' as const;

export interface BuildControlClusterVersionInput {
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  chainId: string;
  token: string;
  version?: string;
  validFromBlock: string;
  validToBlock?: KnowledgeValue<string>;
  memberWalletIds: readonly string[];
  coreWalletIds: readonly string[];
  satelliteWalletIds: readonly string[];
  fundingRootIds?: readonly string[];
  settlementRootIds?: readonly string[];
  membershipEvidenceIds: readonly string[];
  snapshot: AnalysisSnapshot;
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  sourceSet: readonly string[];
  freshness?: string;
  confidence?: KnowledgeValue<number>;
}

export interface BuildControlCampaignInput {
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  chainId: string;
  token: string;
  originBlock: string;
  startBlock: string;
  endBlock?: KnowledgeValue<string>;
  status?: ControlCampaign['status'];
  clusterVersion: ControlClusterVersion;
  snapshotStart: AnalysisSnapshot;
  snapshotEnd: AnalysisSnapshot;
  positions?: readonly ClusterPosition[];
  behaviorEvents: readonly BehaviorEvent[];
  fundingRootIds?: readonly string[];
  settlementRootIds?: readonly string[];
  cexBoundaryIds?: readonly string[];
  evidenceLineItemIds?: readonly string[];
  controlConfidence?: KnowledgeValue<number>;
  coordinationConfidence?: KnowledgeValue<number>;
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  freshness?: string;
  sourceSet: readonly string[];
  entityModelVersion?: string;
  calibrationStatus?: 'UNCALIBRATED' | 'CALIBRATED';
}

export interface CampaignSegmentObservation {
  clusterVersion: ControlClusterVersion;
  startBlock: string;
  endBlock: string;
  behaviorEvents: readonly BehaviorEvent[];
  snapshotStart: AnalysisSnapshot;
  snapshotEnd: AnalysisSnapshot;
}

export interface CampaignBoundaryRules {
  minimumInactivityBlocks: bigint;
  maximumClusterJaccard: number;
  requireRootChange: boolean;
}

export const DEFAULT_CAMPAIGN_BOUNDARY_RULES: CampaignBoundaryRules = {
  minimumInactivityBlocks: 100_000n,
  maximumClusterJaccard: 0.25,
  requireRootChange: true,
};

export interface CampaignBoundaryDecision {
  boundary: boolean;
  clusterJaccard: number;
  rootChanged: boolean;
  inactivityBlocks: string;
  reasons: readonly string[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function unsigned(value: string, field: string): string {
  if (!/^\d+$/.test(value)) throw new TypeError(`${field} must be an unsigned integer string.`);
  return BigInt(value).toString();
}

function canonicalTime(value: string | undefined, fallback: string): string {
  const date = new Date(value ?? fallback);
  if (Number.isNaN(date.getTime()))
    throw new TypeError('Campaign freshness must be an ISO date-time.');
  return date.toISOString();
}

function snapshotIdentity(snapshot: AnalysisSnapshot): { ledger: string; chainId: string } {
  return { ledger: snapshot.ledger, chainId: snapshot.chainId };
}

function assertSnapshotMatches(snapshot: AnalysisSnapshot, ledger: string, chainId: string): void {
  const identity = snapshotIdentity(snapshot);
  if (identity.ledger !== ledger || identity.chainId !== chainId) {
    throw new TypeError('Campaign Snapshot ledger and chain must match the campaign.');
  }
}

export function controlClusterVersionIdFor(
  value: Omit<ControlClusterVersion, 'id' | 'resultHash'>,
): string {
  return `clv_${hashPayload({ schema: 'control-cluster-version-v1', value }).slice(0, 24)}`;
}

export function buildControlClusterVersion(
  input: BuildControlClusterVersionInput,
): ControlClusterVersion {
  assertSnapshotMatches(input.snapshot, input.ledger, input.chainId);
  const members = sortedUnique(input.memberWalletIds);
  const core = sortedUnique(input.coreWalletIds);
  const satellite = sortedUnique(input.satelliteWalletIds);
  const memberSet = new Set(members);
  if (members.length === 0) throw new TypeError('A control cluster version requires a member.');
  if (core.some((id) => !memberSet.has(id)) || satellite.some((id) => !memberSet.has(id))) {
    throw new TypeError('Cluster core and satellite wallets must be members.');
  }
  if (core.some((id) => satellite.includes(id))) {
    throw new TypeError('Cluster core and satellite wallets must not overlap.');
  }
  const sourceSet = sortedUnique(input.sourceSet);
  if (sourceSet.length === 0) throw new TypeError('Cluster version requires a source set.');
  const membershipEvidenceIds = sortedUnique(input.membershipEvidenceIds);
  if (membershipEvidenceIds.length === 0) {
    throw new TypeError('Cluster version requires membership Evidence.');
  }
  const freshness = canonicalTime(input.freshness, input.snapshot.capturedAt);
  const value: Omit<ControlClusterVersion, 'id' | 'resultHash'> = {
    schemaVersion: 'control-cluster-version-v1',
    ledger: input.ledger,
    chainId: input.chainId,
    token: input.token,
    version: unsigned(input.version ?? '1', 'version'),
    validFromBlock: unsigned(input.validFromBlock, 'validFromBlock'),
    validToBlock: input.validToBlock ?? unknownValue('NOT_APPLICABLE'),
    memberWalletIds: members,
    coreWalletIds: core,
    satelliteWalletIds: satellite,
    fundingRootIds: sortedUnique(input.fundingRootIds ?? []),
    settlementRootIds: sortedUnique(input.settlementRootIds ?? []),
    membershipEvidenceIds,
    modelVersion: 'control-cluster-v1.0.0',
    snapshot: input.snapshot,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    freshness,
    sourceSet,
    confidence:
      input.confidence ?? unknownValue('NOT_QUERIED', 'Cluster confidence is not calibrated.'),
    automaticEntityMembershipAllowed: false,
  };
  return ControlClusterVersionSchema.parse({
    ...value,
    id: controlClusterVersionIdFor(value),
    resultHash: hashPayload(value),
  });
}

export function controlCampaignIdFor(input: {
  ledger: string;
  chainId: string;
  token: string;
  originBlock: string;
  startBlock: string;
  endBlock: KnowledgeValue<string>;
  clusterVersionId: string;
}): string {
  return `cc_${hashPayload({ schema: 'control-campaign-v1', input }).slice(0, 24)}`;
}

function stageForBehavior(type: BehaviorEvent['type']): ControlCampaignStage {
  switch (type) {
    case 'ACCUMULATION':
      return 'ACCUMULATION';
    case 'TOKEN_DISPERSION':
      return 'DISPERSION';
    case 'TOKEN_CONSOLIDATION':
    case 'RECONSOLIDATION':
      return 'CONSOLIDATION';
    case 'COORDINATED_BUYING':
    case 'CIRCULAR_FLOW':
    case 'ROUND_TRIP_TRADING':
    case 'WASH_TRADING_PATTERN':
      return 'COORDINATED_TRADING';
    case 'PRE_EXIT_DISPERSION':
      return 'PRE_EXIT_DISPERSION';
    case 'COORDINATED_SELLING':
    case 'SELL_PRESSURE':
      return 'SELLING';
    case 'LIQUIDITY_EXIT':
      return 'LIQUIDITY_EXIT';
    case 'SETTLEMENT_CONVERGENCE':
    case 'CEX_PREPOSITIONING':
      return 'SETTLEMENT';
    case 'CEX_BOUNDARY_REACHED':
      return 'CEX_BOUNDARY';
    case 'CAMPAIGN_DORMANCY':
      return 'DORMANT';
    case 'LIQUIDITY_ADDITION':
      return 'ACCUMULATION';
  }
}

function eventOrder(left: BehaviorEvent, right: BehaviorEvent): number {
  const block = BigInt(left.startBlock) - BigInt(right.startBlock);
  return block === 0n ? left.id.localeCompare(right.id) : block < 0n ? -1 : 1;
}

function averageEvidenceScore(events: readonly BehaviorEvent[]): number {
  if (events.length === 0) return 0;
  return Number(
    (events.reduce((sum, event) => sum + event.evidenceScore, 0) / events.length).toFixed(6),
  );
}

function lastKnownPosition(positions: readonly ClusterPosition[]): ClusterPosition | undefined {
  return [...positions]
    .sort((left, right) => (BigInt(left.atBlock) < BigInt(right.atBlock) ? -1 : 1))
    .at(-1);
}

export function buildControlCampaign(input: BuildControlCampaignInput): ControlCampaign {
  assertSnapshotMatches(input.snapshotStart, input.ledger, input.chainId);
  assertSnapshotMatches(input.snapshotEnd, input.ledger, input.chainId);
  if (
    input.clusterVersion.ledger !== input.ledger ||
    input.clusterVersion.chainId !== input.chainId ||
    input.clusterVersion.token !== input.token
  ) {
    throw new TypeError('Cluster version identity must match the campaign.');
  }
  const originBlock = unsigned(input.originBlock, 'originBlock');
  const startBlock = unsigned(input.startBlock, 'startBlock');
  if (BigInt(startBlock) < BigInt(originBlock))
    throw new TypeError('Campaign starts before token origin.');
  const endBlock = input.endBlock ?? unknownValue('NOT_QUERIED');
  if (endBlock.state === 'known' && BigInt(endBlock.value) < BigInt(startBlock)) {
    throw new TypeError('Campaign ends before it starts.');
  }
  const events = [...input.behaviorEvents].sort(eventOrder);
  if (
    events.some(
      (event) =>
        event.ledger !== input.ledger ||
        event.chainId !== input.chainId ||
        event.token !== input.token,
    )
  ) {
    throw new TypeError('Behavior Events must share the campaign identity.');
  }
  const campaignId = controlCampaignIdFor({
    ledger: input.ledger,
    chainId: input.chainId,
    token: input.token,
    originBlock,
    startBlock,
    endBlock,
    clusterVersionId: input.clusterVersion.id,
  });
  if (events.some((event) => event.campaignId !== campaignId)) {
    throw new TypeError('Behavior Events must be built for this deterministic Campaign ID.');
  }
  const position = lastKnownPosition(input.positions ?? []);
  const evidenceScore = averageEvidenceScore(events);
  const metadataEvidenceIds = sortedUnique([
    ...input.clusterVersion.membershipEvidenceIds,
    ...events.flatMap((event) => [
      ...event.supportingEvidenceIds,
      ...event.contradictingEvidenceIds,
    ]),
    ...(position?.positionEvidenceIds ?? []),
  ]);
  const snapshotEndTime = input.snapshotEnd.capturedAt;
  const metadata = {
    snapshot: input.snapshotEnd,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    freshness: canonicalTime(input.freshness, snapshotEndTime),
    sourceSet: sortedUnique(input.sourceSet),
    modelVersion: CAMPAIGN_ENGINE_MODEL_VERSION,
    confidence:
      input.calibrationStatus === 'CALIBRATED'
        ? knownValue(evidenceScore)
        : unknownValue('NOT_QUERIED', 'Campaign evidence score is not a calibrated probability.'),
    evidenceIds: metadataEvidenceIds,
    calibrationStatus: input.calibrationStatus ?? 'UNCALIBRATED',
  };
  const withoutIdentity = {
    schemaVersion: 'control-campaign-v1' as const,
    ledger: input.ledger,
    chainId: input.chainId,
    token: input.token,
    originBlock,
    startBlock,
    endBlock,
    status: input.status ?? (endBlock.state === 'known' ? 'CLOSED' : 'ACTIVE'),
    currentStage:
      events.at(-1) === undefined ? ('DISCOVERY' as const) : stageForBehavior(events.at(-1)!.type),
    primaryClusterId: input.clusterVersion.id,
    clusterVersionId: input.clusterVersion.id,
    coreWalletIds: input.clusterVersion.coreWalletIds,
    satelliteWalletIds: input.clusterVersion.satelliteWalletIds,
    fundingRootIds: sortedUnique(input.fundingRootIds ?? input.clusterVersion.fundingRootIds),
    settlementRootIds: sortedUnique(
      input.settlementRootIds ?? input.clusterVersion.settlementRootIds,
    ),
    controlledSupply:
      position === undefined ? unknownValue('NOT_QUERIED') : position.controlledSupplyRatio,
    controlConfidence:
      input.controlConfidence ??
      unknownValue('NOT_QUERIED', 'Entity calibration or control evidence was not supplied.'),
    coordinationConfidence:
      input.coordinationConfidence ??
      unknownValue('NOT_QUERIED', 'Entity calibration or coordination evidence was not supplied.'),
    campaignConfidence:
      input.calibrationStatus === 'CALIBRATED'
        ? knownValue(evidenceScore)
        : unknownValue('NOT_QUERIED', 'Campaign evidence score is not a calibrated probability.'),
    evidenceScore,
    evidenceCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    dataCoverage: input.dataCoverage,
    behaviorEventIds: sortedUnique(events.map((event) => event.id)),
    cexBoundaryIds: sortedUnique(input.cexBoundaryIds ?? []),
    snapshotStart: input.snapshotStart,
    snapshotEnd: input.snapshotEnd,
    ruleVersion: 'campaign-v1.0.0' as const,
    entityModelVersion: input.entityModelVersion ?? 'entity-v0.1.0',
    metadata,
    automaticOwnershipMergeAllowed: false as const,
    automaticEntityMembershipMutationAllowed: false as const,
    calibrationStatus: input.calibrationStatus ?? ('UNCALIBRATED' as const),
    evidenceLineItemIds: sortedUnique(input.evidenceLineItemIds ?? []),
  };
  return ControlCampaignSchema.parse({
    ...withoutIdentity,
    id: campaignId,
    resultHash: hashPayload(withoutIdentity),
  });
}

function intersectionCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

export function campaignBoundaryDecision(
  previous: CampaignSegmentObservation,
  next: CampaignSegmentObservation,
  rules: CampaignBoundaryRules = DEFAULT_CAMPAIGN_BOUNDARY_RULES,
): CampaignBoundaryDecision {
  const previousMembers = new Set(previous.clusterVersion.memberWalletIds);
  const nextMembers = new Set(next.clusterVersion.memberWalletIds);
  const union = new Set([...previousMembers, ...nextMembers]);
  const jaccard =
    union.size === 0 ? 1 : intersectionCount(previousMembers, nextMembers) / union.size;
  const rootChanged =
    JSON.stringify(previous.clusterVersion.fundingRootIds) !==
      JSON.stringify(next.clusterVersion.fundingRootIds) ||
    JSON.stringify(previous.clusterVersion.settlementRootIds) !==
      JSON.stringify(next.clusterVersion.settlementRootIds);
  const inactivityBlocks = (BigInt(next.startBlock) - BigInt(previous.endBlock)).toString();
  const inactivity = BigInt(inactivityBlocks) >= rules.minimumInactivityBlocks;
  const reasons = [
    ...(jaccard < rules.maximumClusterJaccard ? ['LOW_CLUSTER_OVERLAP'] : []),
    ...(rootChanged ? ['FUNDING_OR_SETTLEMENT_ROOT_CHANGED'] : []),
    ...(inactivity ? ['LONG_INACTIVITY'] : []),
  ];
  return {
    boundary:
      (jaccard < rules.maximumClusterJaccard && (!rules.requireRootChange || rootChanged)) ||
      inactivity,
    clusterJaccard: Number(jaccard.toFixed(6)),
    rootChanged,
    inactivityBlocks,
    reasons,
  };
}

export function segmentCampaignObservations(
  observations: readonly CampaignSegmentObservation[],
  rules: CampaignBoundaryRules = DEFAULT_CAMPAIGN_BOUNDARY_RULES,
): CampaignSegmentObservation[][] {
  const ordered = [...observations].sort((left, right) =>
    BigInt(left.startBlock) < BigInt(right.startBlock) ? -1 : 1,
  );
  const segments: CampaignSegmentObservation[][] = [];
  for (const observation of ordered) {
    const current = segments.at(-1);
    if (current === undefined) {
      segments.push([observation]);
      continue;
    }
    const previous = current.at(-1)!;
    if (campaignBoundaryDecision(previous, observation, rules).boundary)
      segments.push([observation]);
    else current.push(observation);
  }
  return segments;
}

export function campaignWalletRoleFor(input: {
  walletId: string;
  coreWalletIds: readonly string[];
  satelliteWalletIds: readonly string[];
  fundingRootIds: readonly string[];
  settlementRootIds: readonly string[];
  serviceWalletIds?: readonly string[];
  cexBoundaryWalletIds?: readonly string[];
  coordinatedOnlyWalletIds?: readonly string[];
}): CampaignWalletRole {
  if (input.serviceWalletIds?.includes(input.walletId)) return 'SERVICE_ENDPOINT';
  if (input.cexBoundaryWalletIds?.includes(input.walletId)) return 'CEX_BOUNDARY';
  if (input.fundingRootIds.includes(input.walletId)) return 'FUNDER';
  if (input.settlementRootIds.includes(input.walletId)) return 'SETTLEMENT';
  if (input.coreWalletIds.includes(input.walletId)) return 'CORE';
  if (input.satelliteWalletIds.includes(input.walletId)) return 'SATELLITE';
  if (input.coordinatedOnlyWalletIds?.includes(input.walletId)) return 'COORDINATED_ONLY';
  return 'UNKNOWN';
}

export * from './provider-reconstruction.js';
