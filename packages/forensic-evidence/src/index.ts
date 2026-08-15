import { createEvidence, evidenceIdFor, hashPayload, type EvidenceNode } from '@zerotrace/evidence';
import {
  AnalysisSnapshotSchema,
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

export const FORENSIC_CASE_BUNDLE_SCHEMA_VERSION = 'forensic-case-bundle-v1' as const;
export const FORENSIC_CASE_MANIFEST_SCHEMA_VERSION = 'forensic-case-manifest-v1' as const;

export type ForensicCaseBundleModelVersion = typeof FORENSIC_EVIDENCE_MODEL_VERSION;

export interface ForensicCaseEvidenceNode {
  evidence: Evidence;
  sourceEvidenceIds: readonly string[];
  snapshot?: AnalysisSnapshot;
}

export interface ForensicCaseArtifact {
  ref: string;
  sha256: string | null;
}

export interface ForensicCaseManifest {
  schemaVersion: typeof FORENSIC_CASE_MANIFEST_SCHEMA_VERSION;
  caseId: string;
  campaignId: string;
  evidenceCount: number;
  snapshotCount: number;
  rawArtifactCount: number;
  evidenceIds: readonly string[];
  snapshotKeys: readonly string[];
  rawArtifactHashes: readonly string[];
  sourceSet: readonly string[];
  modelRegistry: readonly string[];
  policyRegistry: readonly string[];
  gitCommit: string | null;
  manifestHash: string;
}

export interface ForensicCaseBundle {
  schemaVersion: typeof FORENSIC_CASE_BUNDLE_SCHEMA_VERSION;
  caseId: string;
  campaignId: string;
  campaign: ControlCampaignBundle;
  evidenceClosure: readonly ForensicCaseEvidenceNode[];
  snapshots: readonly AnalysisSnapshot[];
  rawArtifacts: readonly ForensicCaseArtifact[];
  sourceRegistry: readonly string[];
  modelRegistry: readonly string[];
  policyRegistry: readonly string[];
  gitCommit: string | null;
  manifest: ForensicCaseManifest;
  resultHash: string;
}

export interface BuildForensicCaseBundleInput {
  campaign: ControlCampaignBundle;
  evidenceNodes: readonly (ForensicCaseEvidenceNode | EvidenceNode)[];
  gitCommit?: string | null;
}

export type ForensicCaseBundleErrorCode =
  | 'CASE_CAMPAIGN_INVALID'
  | 'CASE_EVIDENCE_CLOSURE_INCOMPLETE'
  | 'CASE_EVIDENCE_CONFLICT'
  | 'CASE_BUNDLE_INVALID'
  | 'CASE_BUNDLE_HASH_MISMATCH';

export class ForensicCaseBundleError extends Error {
  readonly code: ForensicCaseBundleErrorCode;

  constructor(code: ForensicCaseBundleErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ForensicCaseBundleError';
    this.code = code;
  }
}

export type ForensicCaseBundleVerification =
  | { valid: true; bundle: ForensicCaseBundle }
  | { valid: false; code: ForensicCaseBundleErrorCode; errors: readonly string[] };

function sortedCaseValues(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

export function caseIdForCampaign(campaignId: string): string {
  if (!/^cc_[0-9a-f]{24}$/.test(campaignId)) {
    throw new ForensicCaseBundleError('CASE_CAMPAIGN_INVALID', 'Campaign ID is not canonical.');
  }
  return `fcb_${campaignId}`;
}

function caseSnapshotPosition(snapshot: AnalysisSnapshot): string {
  switch (snapshot.ledger) {
    case 'EVM':
      return snapshot.blockNumber;
    case 'BITCOIN':
      return snapshot.height;
    case 'SOLANA':
      return snapshot.slot;
  }
}

function caseSnapshotHash(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
}

function snapshotKey(snapshot: AnalysisSnapshot): string {
  return [
    snapshot.ledger,
    snapshot.chainId,
    caseSnapshotPosition(snapshot),
    caseSnapshotHash(snapshot).toLowerCase(),
    hashPayload(snapshot),
  ].join(':');
}

function sortSnapshots(snapshots: readonly AnalysisSnapshot[]): AnalysisSnapshot[] {
  return [...snapshots].sort((left, right) => {
    const identity = snapshotKey(left).localeCompare(snapshotKey(right));
    if (identity !== 0) return identity;
    return left.capturedAt.localeCompare(right.capturedAt);
  });
}

function artifactFromRef(ref: string): ForensicCaseArtifact {
  const match = /#sha256=([0-9a-f]{64})$/i.exec(ref);
  return { ref, sha256: match?.[1]?.toLowerCase() ?? null };
}

function normalizeEvidenceNode(
  node: ForensicCaseEvidenceNode | EvidenceNode,
): ForensicCaseEvidenceNode {
  const evidence = EvidenceSchema.parse(node.evidence);
  const sourceEvidenceIds = sortedCaseValues(node.sourceEvidenceIds);
  const snapshot =
    node.snapshot === undefined ? undefined : AnalysisSnapshotSchema.parse(node.snapshot);
  if (evidence.id !== evidenceIdFor(evidence, sourceEvidenceIds)) {
    throw new ForensicCaseBundleError(
      'CASE_EVIDENCE_CONFLICT',
      `Evidence ${evidence.id} does not match its source closure.`,
    );
  }
  if (
    snapshot !== undefined &&
    (snapshot.ledger !== evidence.ledger || snapshot.chainId !== evidence.chainId)
  ) {
    throw new ForensicCaseBundleError(
      'CASE_EVIDENCE_CONFLICT',
      `Evidence ${evidence.id} is bound to a conflicting Snapshot identity.`,
    );
  }
  return {
    evidence,
    sourceEvidenceIds,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
}

function requiredEvidenceIds(campaign: ControlCampaignBundle): string[] {
  return sortedCaseValues([
    ...campaign.campaign.metadata.evidenceIds,
    ...campaign.clusterVersion.membershipEvidenceIds,
    ...campaign.memberships.flatMap((membership) => membership.evidenceIds),
    ...campaign.positions.flatMap((position) => [
      ...position.positionEvidenceIds,
      ...position.membershipEvidenceIds,
    ]),
    ...campaign.behaviorEvents.flatMap((event) => [
      ...event.supportingEvidenceIds,
      ...event.contradictingEvidenceIds,
      ...event.featureVector.flatMap((feature) => feature.evidenceIds),
    ]),
    ...campaign.evidenceItems.flatMap((item) => [item.evidenceId, ...item.parentEvidenceIds]),
    ...campaign.evidenceLine.evidenceIds,
  ]);
}

function assertEvidenceClosure(
  campaign: ControlCampaignBundle,
  nodes: readonly ForensicCaseEvidenceNode[],
): void {
  const byId = new Map<string, ForensicCaseEvidenceNode>();
  for (const node of nodes) {
    const existing = byId.get(node.evidence.id);
    if (existing !== undefined) {
      if (
        hashPayload(existing.evidence) !== hashPayload(node.evidence) ||
        hashPayload(existing.sourceEvidenceIds) !== hashPayload(node.sourceEvidenceIds) ||
        hashPayload(existing.snapshot ?? null) !== hashPayload(node.snapshot ?? null)
      ) {
        throw new ForensicCaseBundleError(
          'CASE_EVIDENCE_CONFLICT',
          `Evidence ${node.evidence.id} appears with conflicting payloads.`,
        );
      }
      continue;
    }
    byId.set(node.evidence.id, node);
  }
  const missing = requiredEvidenceIds(campaign).filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new ForensicCaseBundleError(
      'CASE_EVIDENCE_CLOSURE_INCOMPLETE',
      `Forensic case Evidence closure is missing: ${missing.join(', ')}.`,
    );
  }
  for (const node of byId.values()) {
    const missingSources = node.sourceEvidenceIds.filter((id) => !byId.has(id));
    if (missingSources.length > 0) {
      throw new ForensicCaseBundleError(
        'CASE_EVIDENCE_CLOSURE_INCOMPLETE',
        `Evidence ${node.evidence.id} is missing source closure: ${missingSources.join(', ')}.`,
      );
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new ForensicCaseBundleError(
        'CASE_EVIDENCE_CONFLICT',
        `Evidence closure contains a cycle at ${id}.`,
      );
    }
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (node === undefined) return;
    visiting.add(id);
    for (const sourceId of node.sourceEvidenceIds) visit(sourceId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

function registriesFor(
  campaign: ControlCampaignBundle,
  evidenceClosure: readonly ForensicCaseEvidenceNode[],
): { sourceSet: string[]; modelRegistry: string[]; policyRegistry: string[] } {
  return {
    sourceSet: sortedCaseValues([
      ...campaign.campaign.metadata.sourceSet,
      ...campaign.clusterVersion.sourceSet,
      ...campaign.positions.flatMap((position) => position.sourceSet),
      ...campaign.behaviorEvents.flatMap((event) => event.sourceSet),
      ...evidenceClosure.map((node) => node.evidence.source),
    ]),
    modelRegistry: sortedCaseValues([
      FORENSIC_EVIDENCE_MODEL_VERSION,
      campaign.campaign.entityModelVersion,
      campaign.campaign.metadata.modelVersion,
      campaign.clusterVersion.modelVersion,
      ...campaign.positions.map((position) => position.modelVersion),
      ...campaign.behaviorEvents.map((event) => event.modelVersion),
      ...campaign.evidenceItems.map((item) => item.parserVersion),
    ]),
    policyRegistry: sortedCaseValues([
      campaign.campaign.ruleVersion,
      ...campaign.behaviorEvents.map((event) => event.ruleVersion),
      ...campaign.evidenceItems.map((item) => item.ruleVersion),
      ...campaign.evidenceItems.map((item) => item.sourceLabelVersion),
    ]),
  };
}

function bundleContent(
  input: Omit<ForensicCaseBundle, 'resultHash'>,
): Omit<ForensicCaseBundle, 'resultHash'> {
  return input;
}

export function buildForensicCaseBundle(input: BuildForensicCaseBundleInput): ForensicCaseBundle {
  const campaign = ControlCampaignBundleSchema.safeParse(input.campaign);
  if (!campaign.success) {
    throw new ForensicCaseBundleError(
      'CASE_CAMPAIGN_INVALID',
      'Control Campaign bundle is invalid.',
      campaign.error,
    );
  }
  const normalizedNodes = input.evidenceNodes.map(normalizeEvidenceNode);
  assertEvidenceClosure(campaign.data, normalizedNodes);
  const evidenceClosure = [...normalizedNodes].sort((left, right) =>
    left.evidence.id.localeCompare(right.evidence.id),
  );
  const snapshotMap = new Map<string, AnalysisSnapshot>();
  const addSnapshot = (snapshot: AnalysisSnapshot): void => {
    const parsed = AnalysisSnapshotSchema.parse(snapshot);
    const key = snapshotKey(parsed);
    const existing = snapshotMap.get(key);
    if (existing !== undefined && hashPayload(existing) !== hashPayload(parsed)) {
      throw new ForensicCaseBundleError(
        'CASE_EVIDENCE_CONFLICT',
        `Snapshot ${key} appears with conflicting payloads.`,
      );
    }
    snapshotMap.set(key, parsed);
  };
  addSnapshot(campaign.data.campaign.snapshotStart);
  addSnapshot(campaign.data.campaign.snapshotEnd);
  for (const position of campaign.data.positions) addSnapshot(position.snapshot);
  for (const event of campaign.data.behaviorEvents) addSnapshot(event.snapshot);
  for (const node of evidenceClosure) {
    if (node.snapshot !== undefined) addSnapshot(node.snapshot);
  }
  const snapshots = sortSnapshots([...snapshotMap.values()]);
  const rawArtifacts = [
    ...new Map(
      evidenceClosure
        .flatMap((node) =>
          node.evidence.rawArtifactRef === undefined ? [] : [node.evidence.rawArtifactRef],
        )
        .map((ref) => [ref, artifactFromRef(ref)] as const),
    ).values(),
  ].sort((left, right) => left.ref.localeCompare(right.ref));
  const registries = registriesFor(campaign.data, evidenceClosure);
  const gitCommit = input.gitCommit ?? null;
  const caseId = caseIdForCampaign(campaign.data.campaign.id);
  const manifestCore = {
    schemaVersion: FORENSIC_CASE_MANIFEST_SCHEMA_VERSION,
    caseId,
    campaignId: campaign.data.campaign.id,
    evidenceCount: evidenceClosure.length,
    snapshotCount: snapshots.length,
    rawArtifactCount: rawArtifacts.length,
    evidenceIds: evidenceClosure.map((node) => node.evidence.id),
    snapshotKeys: snapshots.map(snapshotKey),
    rawArtifactHashes: rawArtifacts
      .map((artifact) => artifact.sha256)
      .filter((hash): hash is string => hash !== null)
      .sort(),
    sourceSet: registries.sourceSet,
    modelRegistry: registries.modelRegistry,
    policyRegistry: registries.policyRegistry,
    gitCommit,
  };
  const manifest = {
    ...manifestCore,
    manifestHash: hashPayload({
      schema: FORENSIC_CASE_MANIFEST_SCHEMA_VERSION,
      value: manifestCore,
    }),
  } satisfies ForensicCaseManifest;
  const content = bundleContent({
    schemaVersion: FORENSIC_CASE_BUNDLE_SCHEMA_VERSION,
    caseId,
    campaignId: campaign.data.campaign.id,
    campaign: campaign.data,
    evidenceClosure,
    snapshots,
    rawArtifacts,
    sourceRegistry: registries.sourceSet,
    modelRegistry: registries.modelRegistry,
    policyRegistry: registries.policyRegistry,
    gitCommit,
    manifest,
  });
  return {
    ...content,
    resultHash: hashPayload({ schema: FORENSIC_CASE_BUNDLE_SCHEMA_VERSION, value: content }),
  };
}

export function verifyForensicCaseBundle(value: unknown): ForensicCaseBundleVerification {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ForensicCaseBundleError(
        'CASE_BUNDLE_INVALID',
        'Case bundle must be a JSON object.',
      );
    }
    const input = value as Partial<ForensicCaseBundle>;
    if (input.schemaVersion !== FORENSIC_CASE_BUNDLE_SCHEMA_VERSION) {
      throw new ForensicCaseBundleError(
        'CASE_BUNDLE_INVALID',
        'Case bundle schemaVersion is unsupported.',
      );
    }
    if (!Array.isArray(input.evidenceClosure)) {
      throw new ForensicCaseBundleError(
        'CASE_BUNDLE_INVALID',
        'Case bundle Evidence closure is not an array.',
      );
    }
    if (typeof input.gitCommit !== 'string' && input.gitCommit !== null) {
      throw new ForensicCaseBundleError('CASE_BUNDLE_INVALID', 'Case bundle gitCommit is invalid.');
    }
    if (input.campaign === undefined) {
      throw new ForensicCaseBundleError('CASE_BUNDLE_INVALID', 'Case bundle campaign is missing.');
    }
    const rebuilt = buildForensicCaseBundle({
      campaign: input.campaign,
      evidenceNodes: input.evidenceClosure,
      gitCommit: input.gitCommit,
    });
    if (hashPayload(rebuilt) !== hashPayload(value)) {
      throw new ForensicCaseBundleError(
        'CASE_BUNDLE_HASH_MISMATCH',
        'Case bundle content, manifest, or result hash does not match its canonical rebuild.',
      );
    }
    return { valid: true, bundle: rebuilt };
  } catch (error) {
    const code =
      error instanceof ForensicCaseBundleError ? error.code : ('CASE_BUNDLE_INVALID' as const);
    return {
      valid: false,
      code,
      errors: [error instanceof Error ? error.message : 'Case bundle verification failed.'],
    };
  }
}
