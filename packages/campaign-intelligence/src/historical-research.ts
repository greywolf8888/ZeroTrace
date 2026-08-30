import { hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type KnowledgeValue,
} from '@zerotrace/schemas';

export const HISTORICAL_RESEARCH_MODEL_VERSION = 'historical-research-v1.0.0';

export interface HistoricalFeature {
  id: string;
  group: 'FUNDING' | 'SUPPLY' | 'BEHAVIOR' | 'LIQUIDITY' | 'STAGE';
  value: KnowledgeValue<number>;
  visibleAt: string;
  evidenceIds: readonly string[];
}

export interface HistoricalFingerprint {
  ledger: 'EVM' | 'SOLANA';
  chainId: string;
  token: string;
  mechanismVersion: string;
  stage: string;
  asOf: string;
  snapshot: AnalysisSnapshot;
  features: readonly HistoricalFeature[];
  sourceSet: readonly string[];
  evidenceIds: readonly string[];
  dataCoverage: number;
  historyCoverage: number;
}

export interface FingerprintFeaturePolicy {
  id: string;
  weight: number;
  minimum: number;
  maximum: number;
}

export interface FingerprintPolicy {
  version: string;
  minimumComparableWeight: number;
  missingFeaturePenalty: number;
  features: readonly FingerprintFeaturePolicy[];
}

export interface HistoricalFingerprintComparison {
  id: string;
  status: 'COMPARABLE' | 'PARTIAL' | 'UNKNOWN' | 'NOT_COMPARABLE';
  behaviorSimilarity: KnowledgeValue<number>;
  commonControl: KnowledgeValue<boolean>;
  conditionalOutcome: KnowledgeValue<number>;
  comparableWeight: number;
  totalWeight: number;
  coverage: number;
  differences: Array<{
    featureId: string;
    state: 'COMPARED' | 'MISSING' | 'POST_DECISION_EXCLUDED';
    normalizedDifference?: number;
  }>;
  snapshot: AnalysisSnapshot;
  freshness: string;
  sourceSet: string[];
  evidenceIds: string[];
  evidenceScore: number;
  calibrationStatus: 'UNCALIBRATED';
  modelVersion: typeof HISTORICAL_RESEARCH_MODEL_VERSION;
  policyVersion: string;
  resultHash: string;
}

function time(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO date-time.`);
  return parsed;
}

function ratio(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be between zero and one.`);
  }
  return value;
}

function policyMap(policy: FingerprintPolicy): Map<string, FingerprintFeaturePolicy> {
  if (!policy.version || policy.features.length === 0)
    throw new Error('INVALID_FINGERPRINT_POLICY');
  ratio(policy.minimumComparableWeight, 'minimumComparableWeight');
  ratio(policy.missingFeaturePenalty, 'missingFeaturePenalty');
  const values = new Map<string, FingerprintFeaturePolicy>();
  for (const feature of policy.features) {
    if (
      !feature.id ||
      !Number.isFinite(feature.weight) ||
      feature.weight <= 0 ||
      !Number.isFinite(feature.minimum) ||
      !Number.isFinite(feature.maximum) ||
      feature.maximum <= feature.minimum ||
      values.has(feature.id)
    ) {
      throw new Error('INVALID_FINGERPRINT_POLICY');
    }
    values.set(feature.id, feature);
  }
  return values;
}

function featureMap(features: readonly HistoricalFeature[]): Map<string, HistoricalFeature> {
  const values = new Map<string, HistoricalFeature>();
  for (const feature of features) {
    if (!feature.id || values.has(feature.id)) throw new Error('DUPLICATE_HISTORICAL_FEATURE');
    time(feature.visibleAt, 'feature.visibleAt');
    values.set(feature.id, feature);
  }
  return values;
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

export function compareHistoricalFingerprints(input: {
  query: HistoricalFingerprint;
  reference: HistoricalFingerprint;
  decisionAsOf: string;
  policy: FingerprintPolicy;
}): HistoricalFingerprintComparison {
  const asOf = time(input.decisionAsOf, 'decisionAsOf');
  if (input.query.snapshot.ledger !== input.query.ledger) {
    throw new Error('QUERY_SNAPSHOT_LEDGER_MISMATCH');
  }
  ratio(input.query.dataCoverage, 'query.dataCoverage');
  ratio(input.query.historyCoverage, 'query.historyCoverage');
  ratio(input.reference.dataCoverage, 'reference.dataCoverage');
  ratio(input.reference.historyCoverage, 'reference.historyCoverage');
  const policies = policyMap(input.policy);
  const query = featureMap(input.query.features);
  const reference = featureMap(input.reference.features);
  const totalWeight = [...policies.values()].reduce((sum, feature) => sum + feature.weight, 0);
  const differences: HistoricalFingerprintComparison['differences'] = [];
  let comparableWeight = 0;
  let weightedDifference = 0;

  for (const feature of policies.values()) {
    const left = query.get(feature.id);
    const right = reference.get(feature.id);
    if (
      (left !== undefined && time(left.visibleAt, 'query.visibleAt') > asOf) ||
      (right !== undefined && time(right.visibleAt, 'reference.visibleAt') > asOf)
    ) {
      differences.push({ featureId: feature.id, state: 'POST_DECISION_EXCLUDED' });
      weightedDifference += feature.weight * input.policy.missingFeaturePenalty;
      continue;
    }
    if (left?.value.state !== 'known' || right?.value.state !== 'known') {
      differences.push({ featureId: feature.id, state: 'MISSING' });
      weightedDifference += feature.weight * input.policy.missingFeaturePenalty;
      continue;
    }
    const range = feature.maximum - feature.minimum;
    const normalizedDifference = Math.min(
      1,
      Math.abs(left.value.value - right.value.value) / range,
    );
    comparableWeight += feature.weight;
    weightedDifference += feature.weight * normalizedDifference;
    differences.push({ featureId: feature.id, state: 'COMPARED', normalizedDifference });
  }

  const comparableRatio = totalWeight === 0 ? 0 : comparableWeight / totalWeight;
  const mechanismComparable =
    input.query.ledger === input.reference.ledger &&
    input.query.chainId === input.reference.chainId &&
    input.query.mechanismVersion === input.reference.mechanismVersion &&
    input.query.stage === input.reference.stage;
  const status = !mechanismComparable
    ? 'NOT_COMPARABLE'
    : comparableWeight === 0
      ? 'UNKNOWN'
      : comparableRatio < input.policy.minimumComparableWeight
        ? 'PARTIAL'
        : 'COMPARABLE';
  const behaviorSimilarity =
    status === 'COMPARABLE' || status === 'PARTIAL'
      ? knownValue(Math.max(0, Math.min(1, 1 - weightedDifference / totalWeight)))
      : unknownValue(
          status === 'NOT_COMPARABLE' ? 'NOT_APPLICABLE' : 'INSUFFICIENT_DATA',
          status === 'NOT_COMPARABLE'
            ? '机制版本、活动阶段或链不一致，不能直接比较。'
            : '决策时点前没有足够的共同已知特征。',
        );
  const coverage = Math.min(
    comparableRatio,
    input.query.dataCoverage,
    input.query.historyCoverage,
    input.reference.dataCoverage,
    input.reference.historyCoverage,
  );
  const evidenceIds = canonicalStrings([
    ...input.query.evidenceIds,
    ...input.reference.evidenceIds,
    ...input.query.features.flatMap((feature) =>
      time(feature.visibleAt, 'query.visibleAt') <= asOf ? feature.evidenceIds : [],
    ),
    ...input.reference.features.flatMap((feature) =>
      time(feature.visibleAt, 'reference.visibleAt') <= asOf ? feature.evidenceIds : [],
    ),
  ]);
  const sourceSet = canonicalStrings([...input.query.sourceSet, ...input.reference.sourceSet]);
  const identity = {
    schemaVersion: 'historical-fingerprint-comparison-v1',
    query: [input.query.chainId, input.query.token, input.query.asOf],
    reference: [input.reference.chainId, input.reference.token, input.reference.asOf],
    decisionAsOf: new Date(asOf).toISOString(),
    status,
    behaviorSimilarity,
    comparableWeight,
    totalWeight,
    coverage,
    differences,
    sourceSet,
    evidenceIds,
    modelVersion: HISTORICAL_RESEARCH_MODEL_VERSION,
    policyVersion: input.policy.version,
  };
  const resultHash = hashPayload(identity);
  return {
    id: `hfc_${resultHash.slice(0, 24)}`,
    status,
    behaviorSimilarity,
    commonControl: unknownValue(
      'NOT_APPLICABLE',
      '行为相似不证明共同控制；服务节点和公开程序代理也不得据此合并。',
    ),
    conditionalOutcome: unknownValue(
      'NOT_APPLICABLE',
      '相似度不是胜率或未来收益，需要冻结样本外的校准结果。',
    ),
    comparableWeight,
    totalWeight,
    coverage,
    differences,
    snapshot: input.query.snapshot,
    freshness: new Date(asOf).toISOString(),
    sourceSet,
    evidenceIds,
    evidenceScore: Math.round(coverage * 100),
    calibrationStatus: 'UNCALIBRATED',
    modelVersion: HISTORICAL_RESEARCH_MODEL_VERSION,
    policyVersion: input.policy.version,
    resultHash,
  };
}

export interface MarketEnvironmentObservation {
  ledger: 'EVM' | 'SOLANA';
  chainId: string;
  theme: string;
  observedAt: string;
  availableAt: string;
  activeCandidateCount: number;
  executableEntryCount: number;
  realizableExitCount: number;
  dataCoverage: number;
  source: string;
  evidenceIds: readonly string[];
  snapshot: AnalysisSnapshot;
}

export interface MarketEnvironmentPolicy {
  version: string;
  lookbackSeconds: number;
  minimumObservations: number;
  minimumSources: number;
  selectiveEntryBreadth: number;
  broadEntryBreadth: number;
  broadRealizableShare: number;
}

export interface MarketEnvironmentReport {
  status: 'BROAD' | 'SELECTIVE' | 'COLD' | 'UNKNOWN';
  chainId: string;
  theme: string;
  asOf: string;
  entryBreadth: KnowledgeValue<number>;
  realizableShare: KnowledgeValue<number>;
  coverage: number;
  sourceSet: string[];
  evidenceIds: string[];
  snapshot: AnalysisSnapshot | null;
  evidenceScore: number;
  calibrationStatus: 'UNCALIBRATED';
  modelVersion: typeof HISTORICAL_RESEARCH_MODEL_VERSION;
  policyVersion: string;
  limitations: string[];
}

export function classifyMarketEnvironment(input: {
  ledger: 'EVM' | 'SOLANA';
  chainId: string;
  theme: string;
  asOf: string;
  observations: readonly MarketEnvironmentObservation[];
  policy: MarketEnvironmentPolicy;
}): MarketEnvironmentReport {
  const asOf = time(input.asOf, 'asOf');
  const policy = input.policy;
  if (
    !policy.version ||
    !Number.isSafeInteger(policy.lookbackSeconds) ||
    policy.lookbackSeconds <= 0 ||
    !Number.isSafeInteger(policy.minimumObservations) ||
    policy.minimumObservations <= 0 ||
    !Number.isSafeInteger(policy.minimumSources) ||
    policy.minimumSources <= 0
  ) {
    throw new Error('INVALID_MARKET_ENVIRONMENT_POLICY');
  }
  ratio(policy.selectiveEntryBreadth, 'selectiveEntryBreadth');
  ratio(policy.broadEntryBreadth, 'broadEntryBreadth');
  ratio(policy.broadRealizableShare, 'broadRealizableShare');
  if (policy.broadEntryBreadth < policy.selectiveEntryBreadth) {
    throw new Error('INVALID_MARKET_ENVIRONMENT_POLICY');
  }
  const windowStart = asOf - policy.lookbackSeconds * 1_000;
  const eligible = input.observations.filter((observation) => {
    const observedAt = time(observation.observedAt, 'observation.observedAt');
    const availableAt = time(observation.availableAt, 'observation.availableAt');
    return (
      observation.ledger === input.ledger &&
      observation.chainId === input.chainId &&
      observation.theme === input.theme &&
      observedAt >= windowStart &&
      observedAt <= asOf &&
      availableAt <= asOf
    );
  });
  const sourceSet = canonicalStrings(eligible.map((observation) => observation.source));
  const evidenceIds = canonicalStrings(eligible.flatMap((observation) => observation.evidenceIds));
  const totalCandidates = eligible.reduce(
    (sum, observation) => sum + observation.activeCandidateCount,
    0,
  );
  const totalEntries = eligible.reduce(
    (sum, observation) => sum + observation.executableEntryCount,
    0,
  );
  const totalExits = eligible.reduce(
    (sum, observation) => sum + observation.realizableExitCount,
    0,
  );
  const countsValid = eligible.every(
    (observation) =>
      Number.isSafeInteger(observation.activeCandidateCount) &&
      observation.activeCandidateCount >= 0 &&
      Number.isSafeInteger(observation.executableEntryCount) &&
      observation.executableEntryCount >= 0 &&
      observation.executableEntryCount <= observation.activeCandidateCount &&
      Number.isSafeInteger(observation.realizableExitCount) &&
      observation.realizableExitCount >= 0 &&
      observation.realizableExitCount <= observation.executableEntryCount,
  );
  if (!countsValid) throw new Error('INVALID_MARKET_ENVIRONMENT_OBSERVATION');
  const coverage =
    eligible.length === 0
      ? 0
      : Math.min(...eligible.map((observation) => ratio(observation.dataCoverage, 'dataCoverage')));
  const sufficient =
    eligible.length >= policy.minimumObservations &&
    sourceSet.length >= policy.minimumSources &&
    totalCandidates > 0;
  const entryBreadth = sufficient
    ? knownValue(totalEntries / totalCandidates)
    : unknownValue('INSUFFICIENT_DATA', '候选、来源或观察窗口覆盖不足。');
  const realizableShare =
    sufficient && totalEntries > 0
      ? knownValue(totalExits / totalEntries)
      : unknownValue(
          totalEntries === 0 ? 'NOT_APPLICABLE' : 'INSUFFICIENT_DATA',
          totalEntries === 0 ? '没有可执行进入，不能计算可兑现退出占比。' : '来源覆盖不足。',
        );
  const status =
    entryBreadth.state !== 'known' || realizableShare.state !== 'known'
      ? 'UNKNOWN'
      : entryBreadth.value >= policy.broadEntryBreadth &&
          realizableShare.value >= policy.broadRealizableShare
        ? 'BROAD'
        : entryBreadth.value >= policy.selectiveEntryBreadth
          ? 'SELECTIVE'
          : 'COLD';
  const terminal = eligible
    .slice()
    .sort(
      (left, right) => time(left.observedAt, 'observedAt') - time(right.observedAt, 'observedAt'),
    )
    .at(-1);
  return {
    status,
    chainId: input.chainId,
    theme: input.theme,
    asOf: new Date(asOf).toISOString(),
    entryBreadth,
    realizableShare,
    coverage,
    sourceSet,
    evidenceIds,
    snapshot: terminal?.snapshot ?? null,
    evidenceScore: Math.round(coverage * 100),
    calibrationStatus: 'UNCALIBRATED',
    modelVersion: HISTORICAL_RESEARCH_MODEL_VERSION,
    policyVersion: policy.version,
    limitations: [
      '证据分不是校准概率。',
      '分链分题材环境只描述已覆盖窗口，不证明当前进入机会或未来收益。',
    ],
  };
}
