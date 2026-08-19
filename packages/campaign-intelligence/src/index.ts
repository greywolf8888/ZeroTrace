import { buildControlCampaign, type BuildControlCampaignInput } from '@zerotrace/campaign-engine';
import {
  buildForensicFinding,
  contentAddressedId,
  coverageFromRatios,
  inconclusiveSourceIndependence,
} from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type CampaignFeatureWindow,
  type CampaignIntelligencePayload,
  type CampaignStage,
  type ChainPosition,
  type MarketControlCampaign,
  type TacticHypothesis,
  type TacticType,
} from '@zerotrace/schemas';

export const CAMPAIGN_INTELLIGENCE_MODEL_VERSION = 'campaign-intelligence-v1.0.0';

export interface FeatureSeriesPoint {
  position: ChainPosition;
  value: number | string;
}

function asSafeNumbers(series: readonly FeatureSeriesPoint[]): number[] {
  const ints = series.map((point) =>
    BigInt(typeof point.value === 'string' ? point.value : Math.trunc(point.value)),
  );
  let max = 0n;
  for (const value of ints) {
    const magnitude = value < 0n ? -value : value;
    if (magnitude > max) max = magnitude;
  }
  let scale = 1n;
  while (max / scale > BigInt(Number.MAX_SAFE_INTEGER)) scale *= 10n;
  return ints.map((value) => Number(value / scale));
}

export function detectChangePoints(
  series: readonly FeatureSeriesPoint[],
  penalty = 3,
): FeatureSeriesPoint[] {
  if (series.length < 4) return [];
  const values = asSafeNumbers(series);
  const n = values.length;
  const prefix = new Array<number>(n + 1).fill(0);
  const prefixSq = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i += 1) {
    const value = values[i] ?? 0;
    prefix[i + 1] = (prefix[i] ?? 0) + value;
    prefixSq[i + 1] = (prefixSq[i] ?? 0) + value * value;
  }
  const cost = (start: number, end: number): number => {
    const len = end - start;
    if (len <= 0) return 0;
    const sum = (prefix[end] ?? 0) - (prefix[start] ?? 0);
    const sumSq = (prefixSq[end] ?? 0) - (prefixSq[start] ?? 0);
    const mean = sum / len;
    return sumSq - len * mean * mean;
  };
  const f = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(n + 1).fill(0);
  f[0] = -penalty;
  for (let end = 1; end <= n; end += 1) {
    for (let start = 0; start < end; start += 1) {
      const candidate = (f[start] ?? 0) + cost(start, end) + penalty;
      if (candidate < (f[end] ?? Number.POSITIVE_INFINITY)) {
        f[end] = candidate;
        prev[end] = start;
      }
    }
  }
  const points: FeatureSeriesPoint[] = [];
  let cursor = n;
  while (cursor > 0) {
    const start = prev[cursor] ?? 0;
    if (start > 0) {
      const point = series[start];
      if (point !== undefined) points.push(point);
    }
    cursor = start;
  }
  return points.reverse();
}

export interface TacticObservation {
  tacticType: TacticType;
  stages: CampaignStage[];
  subjects: string[];
  evidenceFor: readonly string[];
  evidenceAgainst: readonly string[];
  families: number;
  alternativesExcluded: boolean;
  singleFactorOnly: boolean;
}

export function evaluateTactic(observation: TacticObservation): boolean {
  if (observation.singleFactorOnly) return false;
  if (observation.families < 2) return false;
  if (!observation.alternativesExcluded) return false;
  return observation.evidenceFor.length > 0;
}

export interface CampaignBuildInput {
  token: { ledger: 'EVM' | 'BITCOIN' | 'SOLANA'; chainId: string; token: string };
  snapshot: AnalysisSnapshot;
  registryEvidenceId: string;
  terminalEvidenceId: string;
  windows: CampaignFeatureWindow[];
  originComplete: boolean;
  controllerEntityIds: string[];
  compatibleControlCampaignId?: string;
  tactics: TacticObservation[];
  existingCampaign?: BuildControlCampaignInput;
}

function stageFromWindow(window: CampaignFeatureWindow): CampaignStage {
  const mint = BigInt(window.mintAtomic);
  const lpAdd = window.lpAddCount;
  const lpRemove = window.lpRemoveCount;
  const controllerNet = BigInt(window.controllerNetToken);
  if (mint > 0n && lpAdd === 0) return 'ORIGIN_AND_PRIVILEGE_SETUP';
  if (lpAdd > 0 && controllerNet > 0n) return 'LIQUIDITY_SEEDING';
  if (lpRemove > 0) return 'LIQUIDITY_EXIT';
  if (controllerNet < 0n) return 'DISTRIBUTION';
  if (window.fanOut > window.fanIn * 2) return 'HIDDEN_WAREHOUSE_DISTRIBUTION';
  return 'INVENTORY_BUILD';
}

export function buildCampaignIntelligence(input: CampaignBuildInput): CampaignIntelligencePayload {
  if (input.existingCampaign !== undefined) {
    buildControlCampaign(input.existingCampaign);
  }
  const series = input.windows.map((window) => ({
    position: window.start,
    value: window.controllerNetToken,
  }));
  const changePoints = detectChangePoints(series);
  const changePointScores = asSafeNumbers(changePoints);
  const campaigns: MarketControlCampaign[] = [];
  const firstStart = input.windows[0]?.start;
  const lastEnd = input.windows.at(-1)?.end;
  const boundaries =
    changePoints.length === 0
      ? [{ start: firstStart, end: lastEnd }]
      : [firstStart, ...changePoints.map((point) => point.position)].map(
          (start, index, starts) => ({
            start,
            end: index + 1 < starts.length ? starts[index + 1] : lastEnd,
          }),
        );

  for (const [index, boundary] of boundaries.entries()) {
    const start = boundary.start;
    const end = boundary.end;
    if (start === undefined || end === undefined) continue;
    const startKey = BigInt(start.blockOrSlot);
    const endKey = BigInt(end.blockOrSlot);
    if (endKey < startKey) continue;
    const lastBoundary = index === boundaries.length - 1;
    const windowSlice = input.windows.filter((item) => {
      const at = BigInt(item.start.blockOrSlot);
      if (at < startKey) return false;
      return lastBoundary ? at <= endKey : at < endKey;
    });
    if (windowSlice.length === 0) continue;
    const evidenceIds = [
      ...new Set(windowSlice.flatMap((item) => [...item.evidenceIds, input.terminalEvidenceId])),
    ].sort();
    const finding = buildForensicFinding({
      schemaVersion: 'forensic-finding-v1',
      assertionClass: 'MODEL_HYPOTHESIS',
      subject: {
        ledger: input.token.ledger,
        chainId: input.token.chainId,
        subjectType: 'TOKEN',
        identifier: input.token.token,
      },
      findingType: 'campaign-boundary',
      payload: { index, changePoints: changePoints.length },
      evidenceFor: evidenceIds.map((id) => ({ id })),
      evidenceAgainst: [],
      evidenceFamilies: [
        {
          id: `fam-campaign-${index}`,
          kind: 'BEHAVIOR_SYNC',
          underlyingEventId: input.terminalEvidenceId,
          correlationGroupId: `campaign-${index}`,
          familyContributionCap: 0.5,
          evidenceIds,
        },
      ],
      alternativeExplanations: [
        {
          id: 'organic-cycle',
          kind: 'OTHER',
          summary: '自然市场周期或外部事件也可能造成流量变化点。',
          excluded: changePoints.length > 0 && evidenceIds.length > 1,
          evidenceIds: [input.terminalEvidenceId],
        },
      ],
      coverage: input.originComplete
        ? coverageFromRatios({ originCoverage: 1, historyCoverage: 1 })
        : coverageFromRatios({ originCoverage: 0, historyCoverage: 0.5 }),
      sourceIndependence: inconclusiveSourceIndependence(
        input.registryEvidenceId,
        input.terminalEvidenceId,
      ),
      evidenceScore: knownValue(Math.min(100, 40 + evidenceIds.length * 10)),
      calibratedProbability: unknownValue('NOT_APPLICABLE'),
      calibrationStatus: 'UNCALIBRATED',
      snapshot: input.snapshot,
      modelVersion: CAMPAIGN_INTELLIGENCE_MODEL_VERSION,
      policyVersion: 'campaign-boundary-v1',
      replayRef: `campaign:${index}`,
      analystDisposition: 'UNREVIEWED',
    });
    const campaign: MarketControlCampaign = {
      id: contentAddressedId('mcc', { token: input.token, index, start }),
      token: input.token,
      controllerEntityIds: input.controllerEntityIds,
      boundary: {
        start,
        end: knownValue(end),
        originComplete: input.originComplete,
        deterministicReasons:
          changePoints.length > 0
            ? ['change-point', 'feature-window']
            : ['single-observation-window'],
        changePointCandidates: changePoints.map((point, pointIndex) => ({
          position: point.position,
          score: changePointScores[pointIndex] ?? 0,
          evidenceIds: [input.terminalEvidenceId],
        })),
      },
      episodes: windowSlice.map((window) => ({
        stage: stageFromWindow(window),
        start: window.start,
        end: knownValue(window.end),
        featureWindow: window,
        finding,
      })),
      tacticFindingIds: [],
      supplySnapshotIds: [],
      capitalLedgerId: unknownValue('NOT_QUERIED'),
      profitReportId: unknownValue('NOT_QUERIED'),
      evidenceClosure: evidenceIds,
      status: input.originComplete
        ? changePoints.length > 1
          ? 'CLOSED'
          : 'OPEN'
        : 'BOUNDED_OBSERVATION',
      ...(input.compatibleControlCampaignId === undefined
        ? {}
        : { compatibleControlCampaignId: input.compatibleControlCampaignId }),
    };
    campaigns.push(campaign);
  }

  const tactics: TacticHypothesis[] = input.tactics.filter(evaluateTactic).map((observation) => {
    const campaignId =
      campaigns[0]?.id ?? contentAddressedId('mcc', { token: input.token, fallback: true });
    const finding = buildForensicFinding({
      schemaVersion: 'forensic-finding-v1',
      assertionClass: 'MODEL_HYPOTHESIS',
      subject: {
        ledger: input.token.ledger,
        chainId: input.token.chainId,
        subjectType: 'TOKEN',
        identifier: input.token.token,
      },
      findingType: `tactic:${observation.tacticType}`,
      payload: observation,
      evidenceFor: observation.evidenceFor.map((id) => ({ id })),
      evidenceAgainst: observation.evidenceAgainst.map((id) => ({ id })),
      evidenceFamilies: [
        {
          id: `fam-${observation.tacticType}`,
          kind: 'BEHAVIOR_SYNC',
          underlyingEventId: observation.evidenceFor[0] ?? input.terminalEvidenceId,
          correlationGroupId: observation.tacticType,
          familyContributionCap: 0.45,
          evidenceIds: [...observation.evidenceFor].sort(),
        },
      ],
      alternativeExplanations: [
        {
          id: 'mm',
          kind: 'MARKET_MAKING',
          summary: '做市、套利或公开空投可能构成替代解释。',
          excluded: observation.alternativesExcluded,
          evidenceIds:
            observation.evidenceAgainst.length > 0
              ? [...observation.evidenceAgainst]
              : [input.terminalEvidenceId],
        },
      ],
      coverage: coverageFromRatios({ historyCoverage: 1 }),
      sourceIndependence: inconclusiveSourceIndependence(
        input.registryEvidenceId,
        input.terminalEvidenceId,
      ),
      evidenceScore: knownValue(70),
      calibratedProbability: unknownValue('NOT_APPLICABLE'),
      calibrationStatus: 'UNCALIBRATED',
      snapshot: input.snapshot,
      modelVersion: CAMPAIGN_INTELLIGENCE_MODEL_VERSION,
      policyVersion: 'tactic-v1',
      replayRef: `tactic:${observation.tacticType}`,
      analystDisposition: 'UNREVIEWED',
    });
    return {
      id: contentAddressedId('tac', observation),
      tacticType: observation.tacticType,
      campaignId,
      stages: observation.stages,
      subjects: observation.subjects,
      finding,
      impactTokenAtomic: unknownValue('NOT_QUERIED'),
      impactQuoteU: unknownValue('NOT_QUERIED'),
    };
  });

  const tacticFindingIds = tactics.map((item) => item.finding.id);
  for (const campaign of campaigns) {
    campaign.tacticFindingIds.push(...tacticFindingIds);
  }

  return {
    campaigns,
    tactics,
    unattributedEventCount: 0,
  };
}
