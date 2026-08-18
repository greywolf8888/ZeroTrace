import {
  buildForensicFinding,
  contentAddressedId,
  coverageFromRatios,
  fuseEvidenceScore,
  inconclusiveSourceIndependence,
  unknownCoverageVector,
} from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type EconomicRole,
  type HiddenAffiliateBounds,
  type IdentityRolesReportPayload,
  type RetailMetrics,
  type RoleAssessment,
  type RoleFeatureVector,
  type ForensicSubject,
} from '@zerotrace/schemas';

export { resolveEntityRelationship } from '@zerotrace/entity-engine';

export const IDENTITY_INTELLIGENCE_MODEL_VERSION = 'identity-intelligence-v1.0.0';
export const IDENTITY_POLICY_VERSION = 'role-policy-v1';

export interface RoleCandidateInput {
  subject: ForensicSubject;
  features: RoleFeatureVector;
  proposedRole: EconomicRole;
  amountAtomic: string;
  executableAtomic: string;
  evidenceFor: readonly string[];
  evidenceAgainst: readonly string[];
  coverageShrink: number;
  historyCoverage: number;
  serviceHub: boolean;
  disclosedTeam: boolean;
  publicAirdrop: boolean;
  publicVesting: boolean;
}

export interface IdentityAssessmentInput {
  snapshot: AnalysisSnapshot;
  registryEvidenceId: string;
  terminalEvidenceId: string;
  candidates: readonly RoleCandidateInput[];
  protocolSupplyAtomic: string;
  executableSellableAtomic: string;
  nonServiceNonPoolAtomic: string;
  marketWideExitU: string;
}

const CONTROLLER_GROUP = 'controller-like';
const SERVICE_ROLES: readonly EconomicRole[] = [
  'CEX_CUSTODY',
  'BRIDGE_CUSTODY',
  'ROUTER_OR_SERVICE',
];

export function compatibleRolesFor(role: EconomicRole): EconomicRole[] {
  if (SERVICE_ROLES.includes(role)) return [...SERVICE_ROLES];
  if (role === 'CONFIRMED_ONCHAIN_CONTROLLER' || role === 'DISCLOSED_TEAM_OR_TREASURY') {
    return ['CONFIRMED_ONCHAIN_CONTROLLER', 'DISCLOSED_TEAM_OR_TREASURY'];
  }
  if (role === 'MARKET_MAKER' || role === 'ARBITRAGEUR') return ['MARKET_MAKER', 'ARBITRAGEUR'];
  return [role];
}

export function confirmHiddenAffiliate(features: RoleFeatureVector): boolean {
  if (features.forbiddenSingleFactors.includes('early') && features.insiderAccessScore < 40) {
    return false;
  }
  if (
    features.forbiddenSingleFactors.includes('small_balance') &&
    features.commonControlScore < 40
  ) {
    return false;
  }
  const controlOrCoord = features.commonControlScore >= 50 || features.coordinationScore >= 50;
  return features.insiderAccessScore >= 50 && controlOrCoord && features.benefitReturnScore >= 50;
}

export function confirmRetail(features: RoleFeatureVector, serviceHub: boolean): boolean {
  if (serviceHub) return false;
  if (!features.positiveIndependenceEvidence) return false;
  if (
    features.marketMakerScore >= 50 ||
    features.botScore >= 50 ||
    features.serviceHubScore >= 50
  ) {
    return false;
  }
  return features.independenceScore >= 50 && features.commonControlScore < 30;
}

export function assessRoles(input: IdentityAssessmentInput): IdentityRolesReportPayload {
  const assessments: RoleAssessment[] = [];
  const serviceHubs = [];
  let unattributed = 0;
  let hiddenLower = 0n;
  let hiddenScenario = 0n;
  let hiddenUpper = 0n;
  let hiddenUnknown = 0n;
  let retailHolding = 0n;
  let retailExecutable = 0n;
  let retailEntities = 0;
  let rawAddresses = 0;

  for (const candidate of input.candidates) {
    rawAddresses += 1;
    const amount = BigInt(candidate.amountAtomic);
    const executable = BigInt(candidate.executableAtomic);
    let role = candidate.proposedRole;
    if (candidate.serviceHub) {
      role = role === 'CEX_CUSTODY' || role === 'BRIDGE_CUSTODY' ? role : 'ROUTER_OR_SERVICE';
      serviceHubs.push(candidate.subject);
    } else if (role === 'SUSPECTED_HIDDEN_AFFILIATE') {
      if (candidate.publicAirdrop || candidate.publicVesting || candidate.disclosedTeam) {
        role = 'UNKNOWN';
      } else if (!confirmHiddenAffiliate(candidate.features)) {
        role = 'UNKNOWN';
      }
    } else if (role === 'INDEPENDENT_NATURAL_TRADER') {
      if (!confirmRetail(candidate.features, candidate.serviceHub)) role = 'UNKNOWN';
    }

    if (role === 'UNKNOWN') {
      unattributed += 1;
      hiddenUnknown += amount;
    }
    if (role === 'INDEPENDENT_NATURAL_TRADER') {
      retailEntities += 1;
      retailHolding += amount;
      retailExecutable += executable;
    }
    if (role === 'SUSPECTED_HIDDEN_AFFILIATE') {
      hiddenScenario += amount;
      hiddenUpper += amount;
    }
    if (role === 'CONFIRMED_ONCHAIN_CONTROLLER' || role === 'DISCLOSED_TEAM_OR_TREASURY') {
      hiddenLower += 0n;
    }

    const familyCap = 0.4;
    const score = fuseEvidenceScore({
      familyContributions: [
        { contribution: candidate.features.insiderAccessScore * 0.25, cap: 25 },
        { contribution: candidate.features.commonControlScore * 0.25, cap: 25 },
        { contribution: candidate.features.coordinationScore * 0.25, cap: 25 },
        { contribution: candidate.features.benefitReturnScore * 0.25, cap: 25 },
      ].map((item) => ({ ...item, cap: item.cap * familyCap * 10 })),
      contradictionPenalty: candidate.evidenceAgainst.length * 5,
      coverageShrink: candidate.coverageShrink,
    });

    const finding = buildForensicFinding({
      schemaVersion: 'forensic-finding-v1',
      assertionClass: role === 'CONFIRMED_ONCHAIN_CONTROLLER' ? 'ONCHAIN_FACT' : 'MODEL_HYPOTHESIS',
      subject: candidate.subject,
      findingType: `role:${role}`,
      payload: candidate.features,
      evidenceFor: candidate.evidenceFor.map((id) => ({ id })),
      evidenceAgainst: candidate.evidenceAgainst.map((id) => ({ id })),
      evidenceFamilies: [
        {
          id: contentAddressedId('fam', { subject: candidate.subject, kind: 'FUNDING_ORIGIN' }),
          kind: 'FUNDING_ORIGIN',
          underlyingEventId: candidate.evidenceFor[0] ?? input.terminalEvidenceId,
          correlationGroupId: candidate.subject.identifier,
          familyContributionCap: familyCap,
          evidenceIds: [...new Set([...candidate.evidenceFor, input.terminalEvidenceId])].sort(),
        },
      ],
      alternativeExplanations: [
        {
          id: 'market-making',
          kind: 'MARKET_MAKING',
          summary: '正常做市或库存管理可能解释同步交易。',
          excluded: candidate.features.marketMakerScore < 30,
          evidenceIds:
            candidate.evidenceAgainst.length > 0
              ? [...candidate.evidenceAgainst]
              : [input.terminalEvidenceId],
        },
      ],
      coverage:
        candidate.historyCoverage < 1
          ? unknownCoverageVector()
          : coverageFromRatios({ historyCoverage: candidate.historyCoverage, entityCoverage: 1 }),
      sourceIndependence: inconclusiveSourceIndependence(
        input.registryEvidenceId,
        input.terminalEvidenceId,
      ),
      evidenceScore: knownValue(score),
      calibratedProbability: unknownValue('NOT_APPLICABLE', '模型未校准，不得显示为概率。'),
      calibrationStatus: 'UNCALIBRATED',
      snapshot: input.snapshot,
      modelVersion: IDENTITY_INTELLIGENCE_MODEL_VERSION,
      policyVersion: IDENTITY_POLICY_VERSION,
      replayRef: `identity:${candidate.subject.identifier}`,
      analystDisposition: 'UNREVIEWED',
    });

    const exclusiveGroup =
      role === 'SUSPECTED_HIDDEN_AFFILIATE' || role === 'INDEPENDENT_NATURAL_TRADER'
        ? CONTROLLER_GROUP
        : SERVICE_ROLES.includes(role)
          ? 'service'
          : undefined;
    const assessment: RoleAssessment = {
      id: contentAddressedId('rol', { subject: candidate.subject, role }),
      subject: candidate.subject,
      role,
      effectiveFrom: {
        ledger: candidate.subject.ledger,
        chainId: candidate.subject.chainId,
        blockOrSlot:
          input.snapshot.ledger === 'EVM'
            ? input.snapshot.blockNumber
            : input.snapshot.ledger === 'BITCOIN'
              ? input.snapshot.height
              : input.snapshot.slot,
      },
      effectiveTo: unknownValue('NOT_QUERIED'),
      finding,
      compatibleRoles: compatibleRolesFor(role),
      ...(exclusiveGroup === undefined ? {} : { mutuallyExclusiveGroup: exclusiveGroup }),
    };
    assessments.push(assessment);
  }

  const hiddenAffiliate: HiddenAffiliateBounds = {
    ofProtocolSupply: {
      lower: hiddenLower.toString(),
      scenario: hiddenScenario.toString(),
      upper: hiddenUpper.toString(),
      unknown: hiddenUnknown.toString(),
    },
    ofExecutableSellable: {
      lower: hiddenLower.toString(),
      scenario: hiddenScenario.toString(),
      upper: hiddenUpper.toString(),
      unknown: hiddenUnknown.toString(),
    },
    ofNonServiceNonPool: {
      lower: '0',
      scenario: '0',
      upper: '0',
      unknown: input.nonServiceNonPoolAtomic,
    },
    ofMarketWideExitU: {
      lower: '0',
      scenario: '0',
      upper: '0',
      unknown: input.marketWideExitU,
    },
  };

  const retail: RetailMetrics = {
    rawAddressCount: rawAddresses,
    independentEntityCandidates: retailEntities,
    effectiveRetailCount: retailEntities,
    currentHoldingAtomic: retailHolding.toString(),
    executableHoldingAtomic: retailExecutable.toString(),
    netOrganicCapitalU: unknownValue('NOT_QUERIED'),
    realizedPnlRangeU: unknownValue('NOT_QUERIED'),
  };

  return {
    assessments,
    hiddenAffiliate,
    retail,
    serviceHubsSuppressed: serviceHubs,
    unattributedSubjects: unattributed,
  };
}

export function hiddenAffiliateShare(numerator: string, denominator: string): string | undefined {
  const den = BigInt(denominator);
  if (den === 0n) return undefined;
  return ((BigInt(numerator) * 10_000n) / den).toString();
}
