import { hashPayload } from '@zerotrace/evidence';
import {
  BehaviorEventSchema,
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type BehaviorEvent,
  type BehaviorFeatureObservation,
  type BehaviorSuppressionReason,
  type BehaviorType,
  type ClusterPosition,
  type KnowledgeValue,
  type TokenFlowEdge,
} from '@zerotrace/schemas';

export const BEHAVIOR_ENGINE_MODEL_VERSION = 'behavior-v1.0.0' as const;

export interface BehaviorRules {
  accumulationMinSupplyDelta: number;
  accumulationMinScore: number;
  dispersionMinWalletCountDelta: number;
  consolidationMinWalletCountDelta: number;
  coordinatedWindowBlocks: bigint;
  coordinatedMinActors: number;
  sellPressureMinLiquidityConsumption: number;
  settlementMinConvergingActors: number;
  circularFlowMinRatio: number;
  familyCaps: Readonly<Record<string, number>>;
}

export const DEFAULT_BEHAVIOR_RULES: BehaviorRules = {
  accumulationMinSupplyDelta: 0.0025,
  accumulationMinScore: 0.55,
  dispersionMinWalletCountDelta: 1,
  consolidationMinWalletCountDelta: 1,
  coordinatedWindowBlocks: 100n,
  coordinatedMinActors: 2,
  sellPressureMinLiquidityConsumption: 0.25,
  settlementMinConvergingActors: 2,
  circularFlowMinRatio: 0.7,
  familyCaps: {
    FUNDING: 3,
    CONTROL: 4,
    TOKEN_FLOW: 4,
    BEHAVIOR: 4,
    MARKET: 4,
    SETTLEMENT: 4,
    ATTRIBUTION: 3,
    NEGATIVE: 6,
  },
};

export interface BehaviorObservationInput {
  campaignId: string;
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  chainId: string;
  token: string;
  clusterVersionId: string;
  snapshot: AnalysisSnapshot;
  beforePosition?: ClusterPosition;
  afterPosition: ClusterPosition;
  edges: readonly TokenFlowEdge[];
  actors?: readonly string[];
  counterparties?: readonly string[];
  type?: BehaviorType;
  startBlock?: string;
  endBlock?: string;
  startTime?: string;
  endTime?: string;
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  sourceSet: readonly string[];
  freshness?: string;
  supportingEvidenceIds?: readonly string[];
  contradictingEvidenceIds?: readonly string[];
  suppressionReasons?: readonly BehaviorSuppressionReason[];
  liquidityConsumption?: KnowledgeValue<string>;
  quoteValue?: KnowledgeValue<string>;
  rules?: Partial<BehaviorRules>;
}

type LooseStringKnowledgeValue =
  | { state: 'known'; value: string }
  | { state: 'unknown' | 'unavailable'; reason: string; detail?: string | undefined };

interface EvidenceContribution {
  kind: string;
  family: BehaviorFeatureObservation['family'];
  weight: number;
  strength: number;
  reliability: number;
  evidenceIds: string[];
  explanation: string;
}

function mergeRules(rules: Partial<BehaviorRules> | undefined): BehaviorRules {
  return {
    ...DEFAULT_BEHAVIOR_RULES,
    ...rules,
    familyCaps: { ...DEFAULT_BEHAVIOR_RULES.familyCaps, ...(rules?.familyCaps ?? {}) },
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function canonicalTime(value: string | undefined, fallback: string): string {
  const date = new Date(value ?? fallback);
  if (Number.isNaN(date.getTime()))
    throw new TypeError('Behavior event time must be an ISO date-time.');
  return date.toISOString();
}

function ratioFromKnowledge(value: LooseStringKnowledgeValue): number | undefined {
  if (value.state !== 'known') return undefined;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function addContribution(
  contributions: EvidenceContribution[],
  input: Omit<EvidenceContribution, 'evidenceIds'> & { evidenceIds: readonly string[] },
): void {
  const evidenceIds = sortedUnique(input.evidenceIds);
  if (evidenceIds.length === 0) return;
  contributions.push({ ...input, evidenceIds });
}

function netScore(
  contributions: readonly EvidenceContribution[],
  caps: Readonly<Record<string, number>>,
): number {
  const byFamily = new Map<string, number>();
  for (const contribution of contributions) {
    const value = contribution.weight * contribution.strength * contribution.reliability;
    byFamily.set(contribution.family, (byFamily.get(contribution.family) ?? 0) + value);
  }
  return [...byFamily.entries()].reduce(
    (total, [family, value]) => total + Math.max(-caps[family]!, Math.min(caps[family]!, value)),
    0,
  );
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function qualityShrink(
  rawConfidence: number,
  dataCoverage: number,
  sourceCoverage: number,
  historyCoverage: number,
): number {
  const quality = Math.cbrt(dataCoverage * sourceCoverage * historyCoverage);
  return Number((0.5 + (rawConfidence - 0.5) * quality).toFixed(6));
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

function featureVector(
  contributions: readonly EvidenceContribution[],
): BehaviorFeatureObservation[] {
  return contributions
    .map((item) => ({
      featureKind: item.kind,
      family: item.family,
      weight: item.weight,
      strength: item.strength,
      reliability: item.reliability,
      contribution: Number((item.weight * item.strength * item.reliability).toFixed(6)),
      evidenceIds: item.evidenceIds,
      explanation: item.explanation,
    }))
    .sort((left, right) =>
      [left.family, left.featureKind, left.evidenceIds.join(',')]
        .join(':')
        .localeCompare([right.family, right.featureKind, right.evidenceIds.join(',')].join(':')),
    );
}

function suppressionSet(input: BehaviorObservationInput): BehaviorSuppressionReason[] {
  return sortedUnique(input.suppressionReasons ?? []) as BehaviorSuppressionReason[];
}

function deriveType(input: BehaviorObservationInput, rules: BehaviorRules): BehaviorType {
  if (input.type !== undefined) return input.type;
  const before = input.beforePosition;
  const after = input.afterPosition;
  const beforeBalance = BigInt(before?.tokenBalanceRaw ?? '0');
  const afterBalance = BigInt(after.tokenBalanceRaw);
  const walletDelta = after.walletCount - (before?.walletCount ?? 0);
  const beforeTop3 = ratioFromKnowledge(before?.top3Concentration ?? unknownValue('NOT_QUERIED'));
  const afterTop3 = ratioFromKnowledge(after.top3Concentration);
  const net = afterBalance - beforeBalance;
  const supplyDelta = ratioFromKnowledge(after.controlledSupplyRatio);
  if (
    (supplyDelta !== undefined && supplyDelta >= rules.accumulationMinSupplyDelta) ||
    (net > 0n && BigInt(after.dexBuyRaw) > BigInt(after.dexSellRaw))
  ) {
    return 'ACCUMULATION';
  }
  if (
    walletDelta >= rules.dispersionMinWalletCountDelta &&
    beforeTop3 !== undefined &&
    afterTop3 !== undefined &&
    afterTop3 < beforeTop3
  ) {
    return 'TOKEN_DISPERSION';
  }
  if (
    walletDelta <= -rules.consolidationMinWalletCountDelta &&
    beforeTop3 !== undefined &&
    afterTop3 !== undefined &&
    afterTop3 > beforeTop3
  ) {
    return 'TOKEN_CONSOLIDATION';
  }
  if (BigInt(after.dexSellRaw) > 0n && net < 0n) return 'COORDINATED_SELLING';
  return 'CAMPAIGN_DORMANCY';
}

function contributionsFor(
  input: BehaviorObservationInput,
  type: BehaviorType,
): EvidenceContribution[] {
  const contributions: EvidenceContribution[] = [];
  const before = input.beforePosition;
  const after = input.afterPosition;
  const evidenceIds = sortedUnique([
    ...(input.supportingEvidenceIds ?? []),
    ...after.positionEvidenceIds,
  ]);
  const net = BigInt(after.tokenBalanceRaw) - BigInt(before?.tokenBalanceRaw ?? '0');
  const buys = BigInt(after.dexBuyRaw);
  const sells = BigInt(after.dexSellRaw);
  const walletDelta = after.walletCount - (before?.walletCount ?? 0);
  const beforeTop3 = ratioFromKnowledge(before?.top3Concentration ?? unknownValue('NOT_QUERIED'));
  const afterTop3 = ratioFromKnowledge(after.top3Concentration);
  const supply = ratioFromKnowledge(after.controlledSupplyRatio);
  if (net > 0n) {
    addContribution(contributions, {
      kind: 'CLUSTER_NET_TOKEN_INFLOW',
      family: 'TOKEN_FLOW',
      weight: 2.4,
      strength: 1,
      reliability: input.dataCoverage,
      evidenceIds,
      explanation: `Cluster token position increased by ${net.toString()} raw units.`,
    });
  }
  if (buys > sells) {
    addContribution(contributions, {
      kind: 'DEX_NET_BUY',
      family: 'BEHAVIOR',
      weight: 2,
      strength: 1,
      reliability: input.sourceCoverage,
      evidenceIds,
      explanation: `DEX buy flow ${buys.toString()} exceeded sell flow ${sells.toString()}.`,
    });
  }
  if (sells > buys) {
    addContribution(contributions, {
      kind: 'CLUSTER_NET_SELL',
      family: 'BEHAVIOR',
      weight: 2.6,
      strength: 1,
      reliability: input.sourceCoverage,
      evidenceIds,
      explanation: `Cluster sell flow ${sells.toString()} exceeded buy flow ${buys.toString()}.`,
    });
  }
  if (supply !== undefined && supply > 0) {
    addContribution(contributions, {
      kind: 'SUPPLY_SHARE_OBSERVED',
      family: 'TOKEN_FLOW',
      weight: 1.8,
      strength: Math.min(1, supply),
      reliability: input.dataCoverage,
      evidenceIds,
      explanation: `Cluster controlled supply ratio observed at ${supply}.`,
    });
  }
  if (
    walletDelta > 0 &&
    beforeTop3 !== undefined &&
    afterTop3 !== undefined &&
    afterTop3 < beforeTop3
  ) {
    addContribution(contributions, {
      kind: type === 'PRE_EXIT_DISPERSION' ? 'PRE_EXIT_DISPERSION' : 'TOKEN_FAN_OUT',
      family: 'TOKEN_FLOW',
      weight: type === 'PRE_EXIT_DISPERSION' ? 2 : 1.8,
      strength: Math.min(1, walletDelta / Math.max(1, after.walletCount)),
      reliability: input.historyCoverage,
      evidenceIds,
      explanation: `Wallet count increased by ${walletDelta} while Top-3 concentration declined.`,
    });
  }
  if (
    walletDelta < 0 &&
    beforeTop3 !== undefined &&
    afterTop3 !== undefined &&
    afterTop3 > beforeTop3
  ) {
    addContribution(contributions, {
      kind: 'TOKEN_FAN_IN',
      family: 'TOKEN_FLOW',
      weight: 2.3,
      strength: Math.min(1, Math.abs(walletDelta) / Math.max(1, before?.walletCount ?? 1)),
      reliability: input.historyCoverage,
      evidenceIds,
      explanation: `Wallet count declined by ${Math.abs(walletDelta)} while Top-3 concentration increased.`,
    });
  }
  if (input.suppressionReasons?.length) {
    for (const reason of input.suppressionReasons) {
      addContribution(contributions, {
        kind: reason,
        family:
          reason === 'CEX_PATH_BREAK' || reason === 'SERVICE_HUB' ? 'NEGATIVE' : 'ATTRIBUTION',
        weight: reason === 'SERVICE_HUB' ? -8 : reason === 'CEX_PATH_BREAK' ? -2.5 : -3,
        strength: 1,
        reliability: input.sourceCoverage,
        evidenceIds: input.contradictingEvidenceIds ?? [],
        explanation: `${reason} suppresses ownership/attribution propagation.`,
      });
    }
  }
  return contributions;
}

function defaultKnowledge(
  value: LooseStringKnowledgeValue | undefined,
  reason: 'NOT_QUERIED' | 'INSUFFICIENT_DATA',
): LooseStringKnowledgeValue {
  return value ?? { state: 'unknown', reason };
}

export function detectBehaviorEvent(input: BehaviorObservationInput): BehaviorEvent {
  const rules = mergeRules(input.rules);
  const type = deriveType(input, rules);
  const contributions = contributionsFor(input, type);
  const score = netScore(contributions, rules.familyCaps);
  const rawConfidence = logistic(score - 1.5);
  const suppressionReasons = suppressionSet(input);
  const hardSuppressed = suppressionReasons.some((reason) =>
    [
      'SERVICE_HUB',
      'CEX_PATH_BREAK',
      'DEX_ROUTER_COMMON_INFRA',
      'BRIDGE_PATH_BREAK',
      'DUST_OR_ADDRESS_POISONING',
    ].includes(reason),
  );
  const confidence = hardSuppressed
    ? unknownValue(
        'NOT_APPLICABLE',
        'Attribution is suppressed by a hard boundary; no confidence value is emitted.',
      )
    : knownValue(
        qualityShrink(
          rawConfidence,
          input.dataCoverage,
          input.sourceCoverage,
          input.historyCoverage,
        ),
      );
  const support = sortedUnique([
    ...(input.supportingEvidenceIds ?? []),
    ...contributions.filter((item) => item.weight >= 0).flatMap((item) => item.evidenceIds),
  ]);
  const contradicting = sortedUnique([
    ...(input.contradictingEvidenceIds ?? []),
    ...contributions.filter((item) => item.weight < 0).flatMap((item) => item.evidenceIds),
  ]);
  const position = snapshotPosition(input.snapshot);
  const sourceSet = sortedUnique(input.sourceSet);
  if (sourceSet.length === 0) throw new TypeError('Behavior Event requires a source set.');
  const startBlock = input.startBlock ?? input.beforePosition?.atBlock ?? position;
  const endBlock = input.endBlock ?? input.afterPosition.atBlock;
  const startTime = canonicalTime(input.startTime, input.snapshot.capturedAt);
  const endTime = canonicalTime(input.endTime, input.snapshot.capturedAt);
  const eventWithoutIdentity = {
    schemaVersion: 'behavior-event-v1' as const,
    campaignId: input.campaignId,
    ledger: input.ledger,
    chainId: input.chainId,
    token: input.token,
    type,
    status: 'FINAL' as const,
    startBlock,
    endBlock,
    startTime,
    endTime,
    clusterVersionId: input.clusterVersionId,
    actors: sortedUnique(input.actors ?? []),
    counterparties: sortedUnique(input.counterparties ?? []),
    tokenAmountRaw: knownValue(
      (
        BigInt(input.afterPosition.tokenBalanceRaw) -
        BigInt(input.beforePosition?.tokenBalanceRaw ?? '0')
      )
        .toString()
        .replace('-', ''),
    ),
    supplyRatio: defaultKnowledge(input.afterPosition.controlledSupplyRatio, 'NOT_QUERIED'),
    quoteValue: defaultKnowledge(input.quoteValue, 'NOT_QUERIED'),
    liquidityConsumption: defaultKnowledge(input.liquidityConsumption, 'NOT_QUERIED'),
    featureVector: featureVector(contributions),
    supportingEvidenceIds: support,
    contradictingEvidenceIds: contradicting,
    evidenceScore: Number(Math.min(1, Math.max(0, rawConfidence)).toFixed(6)),
    confidence,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
    freshness: canonicalTime(input.freshness, input.snapshot.capturedAt),
    sourceSet,
    suppressionReasons,
    attributionStopped: suppressionReasons.includes('CEX_PATH_BREAK'),
    modelVersion: BEHAVIOR_ENGINE_MODEL_VERSION,
    ruleVersion: 'behavior-v1.0.0' as const,
    explanation: hardSuppressed
      ? `Detected ${type}, but attribution is suppressed by ${suppressionReasons.join(', ')}.`
      : `Detected ${type} from ${contributions.length} evidence-backed feature observations; score is uncalibrated.`,
    snapshot: input.snapshot,
  };
  return BehaviorEventSchema.parse({
    ...eventWithoutIdentity,
    id: `be_${hashPayload({ schema: 'behavior-event-v1', value: eventWithoutIdentity }).slice(0, 24)}`,
    resultHash: hashPayload(eventWithoutIdentity),
  });
}

export function revokeBehaviorEvent(
  event: BehaviorEvent,
  snapshot: AnalysisSnapshot,
  evidenceIds: readonly string[],
): BehaviorEvent {
  const revoked = {
    ...event,
    status: 'REVOKED' as const,
    confidence: unknownValue(
      'CONFLICTING_SOURCES',
      'The provisional observation was invalidated by a reorg or source conflict.',
    ),
    supportingEvidenceIds: sortedUnique(evidenceIds),
    contradictingEvidenceIds: sortedUnique([...event.contradictingEvidenceIds, ...evidenceIds]),
    snapshot,
    explanation:
      'Event revoked because its source observation no longer matches the canonical Snapshot.',
  };
  return BehaviorEventSchema.parse({
    ...revoked,
    id: `be_${hashPayload({ schema: 'behavior-event-v1-revoked', value: revoked }).slice(0, 24)}`,
    resultHash: hashPayload(revoked),
  });
}
