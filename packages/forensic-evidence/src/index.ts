import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  CampaignEvidenceItemSchema,
  ControlCampaignBundleSchema,
  EvidenceSchema,
  ForensicEvidenceLineSchema,
  unknownValue,
  type AnalysisSnapshot,
  type CampaignEvidenceItem,
  type CampaignEvidencePhase,
  type Evidence,
  type ForensicEvidenceLine,
  type ForensicEvidenceLinePhase,
  type ControlCampaignBundle,
  type ControlCampaign,
  type ControlClusterVersion,
  type CampaignWalletMembership,
  type ClusterPosition,
  type BehaviorEvent,
} from '@zerotrace/schemas';

export const FORENSIC_EVIDENCE_MODEL_VERSION = 'forensic-evidence-v1.0.0' as const;

export interface CreateCampaignEvidenceItemInput {
  evidence: Evidence;
  campaignId: string;
  behaviorEventId?: string;
  phase: CampaignEvidencePhase;
  role: 'DIRECT' | 'DERIVED' | 'ATTRIBUTION';
  polarity: 'SUPPORT' | 'CONTRADICT' | 'NEUTRAL';
  snapshot: AnalysisSnapshot;
  parentEvidenceIds?: readonly string[];
  subjectA?: string;
  subjectB?: string;
  featureKind?: string;
  strength?: number;
  reliability?: number;
  weight?: number;
  scoreContribution?: number;
  parserVersion?: string;
  ruleVersion?: string;
  sourceLabelVersion?: string;
  explanation: string;
  reviewState?: 'UNREVIEWED' | 'REVIEWED' | 'REJECTED';
}

export interface BuildForensicEvidenceLineInput {
  campaignId: string;
  items: readonly CampaignEvidenceItem[];
  snapshotStart: AnalysisSnapshot;
  snapshotEnd: AnalysisSnapshot;
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  sourceSet: readonly string[];
  freshness?: string;
}

export function buildControlCampaignBundle(input: {
  campaign: ControlCampaign;
  clusterVersion: ControlClusterVersion;
  memberships: readonly CampaignWalletMembership[];
  positions: readonly ClusterPosition[];
  behaviorEvents: readonly BehaviorEvent[];
  evidenceItems: readonly CampaignEvidenceItem[];
  evidenceLine: ForensicEvidenceLine;
}): ControlCampaignBundle {
  const value = {
    schemaVersion: 'control-campaign-bundle-v1' as const,
    campaign: input.campaign,
    clusterVersion: input.clusterVersion,
    memberships: [...input.memberships],
    positions: [...input.positions],
    behaviorEvents: [...input.behaviorEvents],
    evidenceItems: [...input.evidenceItems],
    evidenceLine: input.evidenceLine,
  };
  return ControlCampaignBundleSchema.parse({
    ...value,
    resultHash: hashPayload(value),
  });
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function snapshotPosition(snapshot: AnalysisSnapshot): string {
  switch (snapshot.ledger) {
    case 'EVM':
      return snapshot.blockNumber;
    case 'BITCOIN':
      return snapshot.height;
    case 'SOLANA':
      return snapshot.slot;
  }
}

function snapshotHash(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
}

function blockHash(snapshot: AnalysisSnapshot): string {
  return snapshotHash(snapshot);
}

function blockNumber(evidence: Evidence, snapshot: AnalysisSnapshot): string {
  const position = snapshotPosition(snapshot);
  if (evidence.blockOrSlot !== undefined && evidence.blockOrSlot !== position) {
    throw new TypeError('Campaign Evidence and Snapshot positions must match.');
  }
  return evidence.blockOrSlot ?? position;
}

export function campaignEvidenceItemIdFor(
  value: Omit<CampaignEvidenceItem, 'id' | 'resultHash'>,
): string {
  return `cei_${hashPayload({ schema: 'campaign-evidence-item-v1', value }).slice(0, 24)}`;
}

export function createCampaignEvidenceItem(
  input: CreateCampaignEvidenceItemInput,
): CampaignEvidenceItem {
  const evidence = EvidenceSchema.parse(input.evidence);
  const snapshot = input.snapshot;
  if (evidence.ledger !== snapshot.ledger || evidence.chainId !== snapshot.chainId) {
    throw new TypeError('Campaign Evidence and Snapshot ledger/chain must match.');
  }
  if (!/^ev_[0-9a-f]{24}$/.test(evidence.id)) {
    throw new TypeError('Campaign Evidence must reference a canonical ev_ Evidence ID.');
  }
  const position = blockNumber(evidence, snapshot);
  const value: Omit<CampaignEvidenceItem, 'id' | 'resultHash'> = {
    schemaVersion: 'campaign-evidence-item-v1',
    evidenceId: evidence.id,
    campaignId: input.campaignId,
    ...(input.behaviorEventId === undefined ? {} : { behaviorEventId: input.behaviorEventId }),
    phase: input.phase,
    role: input.role,
    polarity: input.polarity,
    ledger: evidence.ledger,
    chainId: evidence.chainId,
    blockNumber: position,
    blockHash: blockHash(snapshot),
    ...(evidence.locator.startsWith('0x') ? { txHash: evidence.locator } : {}),
    ...(input.subjectA === undefined ? {} : { subjectA: input.subjectA }),
    ...(input.subjectB === undefined ? {} : { subjectB: input.subjectB }),
    ...(input.featureKind === undefined ? {} : { featureKind: input.featureKind }),
    ...(input.strength === undefined ? {} : { strength: input.strength }),
    ...(input.reliability === undefined ? {} : { reliability: input.reliability }),
    ...(input.weight === undefined ? {} : { weight: input.weight }),
    ...(input.scoreContribution === undefined
      ? {}
      : { scoreContribution: input.scoreContribution }),
    parentEvidenceIds: sortedUnique(input.parentEvidenceIds ?? []),
    ...(evidence.rawArtifactRef === undefined ? {} : { rawArtifactRef: evidence.rawArtifactRef }),
    snapshotHash: snapshotHash(snapshot),
    parserVersion: input.parserVersion ?? 'raw-evidence-v1.0.0',
    ruleVersion: input.ruleVersion ?? 'campaign-v1.0.0',
    sourceLabelVersion: input.sourceLabelVersion ?? 'labels-unqueried-v1',
    explanation: input.explanation,
    reviewState: input.reviewState ?? 'UNREVIEWED',
  };
  return CampaignEvidenceItemSchema.parse({
    ...value,
    id: campaignEvidenceItemIdFor(value),
    resultHash: hashPayload(value),
  });
}

export function createDerivedCampaignEvidence(input: {
  ledger: Evidence['ledger'];
  chainId: string;
  blockOrSlot: string;
  finality: string;
  snapshot: AnalysisSnapshot;
  payload: unknown;
  summary: string;
  sourceEvidenceIds: readonly string[];
  observedAt?: string;
}): Evidence {
  if (input.sourceEvidenceIds.length === 0) {
    throw new TypeError('Derived Campaign Evidence requires source Evidence IDs.');
  }
  const evidence = createEvidence({
    ledger: input.ledger,
    chainId: input.chainId,
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:forensic-evidence-v1.0.0',
    locator: `forensic-derived:${input.chainId}:${input.blockOrSlot}:${hashPayload(input.payload).slice(0, 24)}`,
    blockOrSlot: input.blockOrSlot,
    finality: input.finality,
    payload: input.payload,
    summary: input.summary,
    sourceEvidenceIds: sortedUnique(input.sourceEvidenceIds),
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
  });
  if (evidence.ledger !== input.snapshot.ledger || evidence.chainId !== input.snapshot.chainId) {
    throw new TypeError('Derived Evidence and Snapshot ledger/chain must match.');
  }
  return evidence;
}

const PHASE_ORDER: readonly CampaignEvidencePhase[] = [
  'FUNDING',
  'TOKEN_CONTROL',
  'TRADING',
  'SELL',
  'LIQUIDITY',
  'SETTLEMENT',
  'CEX_BOUNDARY',
  'NEGATIVE',
];

export function buildForensicEvidenceLine(
  input: BuildForensicEvidenceLineInput,
): ForensicEvidenceLine {
  if (
    input.snapshotStart.ledger !== input.snapshotEnd.ledger ||
    input.snapshotStart.chainId !== input.snapshotEnd.chainId
  ) {
    throw new TypeError('Forensic Evidence line requires one ledger and chain.');
  }
  const items = input.items
    .map((item) => CampaignEvidenceItemSchema.parse(item))
    .filter((item) => item.campaignId === input.campaignId);
  if (
    items.some(
      (item) =>
        item.ledger !== input.snapshotStart.ledger || item.chainId !== input.snapshotStart.chainId,
    )
  ) {
    throw new TypeError('Forensic Evidence items and Snapshots must share one ledger and chain.');
  }
  const phases: ForensicEvidenceLinePhase[] = [];
  for (const phase of PHASE_ORDER) {
    const phaseItems = items
      .filter((item) => item.phase === phase)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (phaseItems.length === 0) continue;
    const evidenceIds = sortedUnique(phaseItems.map((item) => item.evidenceId));
    const rejected = phaseItems.filter((item) => item.polarity === 'CONTRADICT').length;
    phases.push({
      phase,
      itemIds: phaseItems.map((item) => item.id),
      evidenceIds,
      coverage: Math.max(0, Math.min(1, 1 - rejected / phaseItems.length)),
      attributionStopped:
        phase === 'CEX_BOUNDARY' || phaseItems.some((item) => item.phase === 'CEX_BOUNDARY'),
    });
  }
  const terminalBoundary = phases.some((phase) => phase.phase === 'CEX_BOUNDARY')
    ? 'CEX_BOUNDARY'
    : phases.length === 0
      ? 'UNKNOWN'
      : 'NONE_OBSERVED';
  const value = {
    schemaVersion: 'forensic-evidence-line-v1' as const,
    campaignId: input.campaignId,
    phases,
    terminalBoundary,
    itemIds: sortedUnique(phases.flatMap((phase) => phase.itemIds)),
    evidenceIds: sortedUnique(phases.flatMap((phase) => phase.evidenceIds)),
    snapshotStart: input.snapshotStart,
    snapshotEnd: input.snapshotEnd,
    dataCoverage: input.dataCoverage,
    freshness: input.freshness ?? input.snapshotEnd.capturedAt,
    sourceSet: sortedUnique(input.sourceSet),
    modelVersion: FORENSIC_EVIDENCE_MODEL_VERSION,
    confidence: unknownValue(
      'NOT_QUERIED',
      'Forensic line confidence is not a calibrated probability.',
    ),
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
  };
  return ForensicEvidenceLineSchema.parse({
    ...value,
    resultHash: hashPayload(value),
  });
}
