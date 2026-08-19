import { exportCasePackage, type CaseExportFiles } from '@zerotrace/casework';
import {
  buildReportEnvelope,
  contentAddressedId,
  coverageFromRatios,
  hashPayload,
  inconclusiveSourceIndependence,
} from '@zerotrace/evidence';
import { assessRoles, type RoleCandidateInput } from '@zerotrace/identity-intelligence';
import {
  type AnalysisSnapshot,
  type Evidence,
  type IdentityRolesReportPayload,
  type ReportEnvelope,
  type SupplyCell,
  type SupplyRealityPayload,
  type TokenAnalyzeRequest,
  type WorkstationStatus,
} from '@zerotrace/schemas';
import { materializeSupplyReality } from '@zerotrace/supply-reality-engine';

import { decideTokenAnalyzeCapability } from './capability.js';

export const FORENSIC_PIPELINE_MODEL_VERSION = 'forensic-pipeline-v1.0.0';
export const FORENSIC_PIPELINE_POLICY_VERSION = 'token-auto-materialize-v1';

export interface TokenInspectionObservation {
  token: string;
  chainId: string;
  snapshot: AnalysisSnapshot;
  evidence: readonly Evidence[];
  portalAddress?: string;
  circulatingSupplyAtomic?: string;
  reserveAtomic?: string;
  buyTaxBps?: string;
  sellTaxBps?: string;
  poolAddress?: string;
  platformMatch?: boolean;
}

export interface TokenMarketStructureReport {
  status: WorkstationStatus;
  request: TokenAnalyzeRequest;
  limitations: string[];
  investigationId?: string;
  supply?: SupplyRealityPayload;
  roles?: IdentityRolesReportPayload;
  envelopes: ReportEnvelope[];
  casePackage?: CaseExportFiles;
  reason?: string;
}

function canonicalEvm(value: string): string {
  return value.toLowerCase();
}

function isUnsignedAtomic(value: string | undefined): value is string {
  return value !== undefined && /^(?:0|[1-9]\d*)$/.test(value);
}

function cellId(token: string, owner: string, custody: string): string {
  return contentAddressedId('cel', { token, owner, custody });
}

function envelopeFor(
  reportType: string,
  request: TokenAnalyzeRequest,
  snapshot: AnalysisSnapshot,
  status: ReportEnvelope['status'],
  coverage: ReportEnvelope['coverage'],
  evidenceIds: readonly string[],
  payload: unknown,
  limitations: readonly string[],
): ReportEnvelope {
  const registryEvidenceId = evidenceIds[0];
  const terminalEvidenceId = evidenceIds[1] ?? evidenceIds[0];
  if (registryEvidenceId === undefined || terminalEvidenceId === undefined) {
    throw new Error('Report envelope requires at least one Evidence ID.');
  }
  return buildReportEnvelope({
    schemaVersion: 'report-envelope-v1',
    reportType,
    schemaContractVersion: reportType,
    modelVersion: FORENSIC_PIPELINE_MODEL_VERSION,
    policyVersion: FORENSIC_PIPELINE_POLICY_VERSION,
    subject: {
      ledger: request.ledger,
      chainId: request.chainId,
      subjectType: 'TOKEN',
      identifier: request.token,
    },
    snapshot,
    status,
    coverage,
    sourceSet: ['token-auto-materialize', 'flap-inspection'],
    sourceIndependence: inconclusiveSourceIndependence(registryEvidenceId, terminalEvidenceId),
    evidenceClosure: [...evidenceIds].sort(),
    createdAt: snapshot.capturedAt,
    replayRef: {
      command: `POST /api/v2/tokens/${request.ledger}/${request.chainId}/${request.token}/analyze`,
      snapshot,
      modelVersion: FORENSIC_PIPELINE_MODEL_VERSION,
      policyVersion: FORENSIC_PIPELINE_POLICY_VERSION,
      inputHash: hashPayload({ request, snapshot, limitations }),
    },
    payload,
  });
}

export function materializeTokenMarketStructure(input: {
  request: TokenAnalyzeRequest;
  observation?: TokenInspectionObservation;
  createdAt?: string;
}): TokenMarketStructureReport {
  const capability = decideTokenAnalyzeCapability(input.request);
  if (capability.status === 'UNSUPPORTED') {
    return {
      status: 'UNSUPPORTED',
      request: input.request,
      limitations: [capability.reason ?? '能力矩阵拒绝该主体。'],
      envelopes: [],
      ...(capability.reason === undefined ? {} : { reason: capability.reason }),
    };
  }
  const observation = input.observation;
  if (observation === undefined) {
    return {
      status: 'OFFLINE',
      request: input.request,
      limitations: ['只读 Provider 未配置或不可用，拒绝用空数填补盘面。'],
      envelopes: [],
      reason: 'PROVIDER_UNCONFIGURED',
    };
  }
  const snapshotFinalized =
    observation.snapshot.ledger === 'SOLANA'
      ? observation.snapshot.commitment === 'finalized'
      : observation.snapshot.finality === 'finalized';
  if (!snapshotFinalized) {
    return {
      status: 'FAILED',
      request: input.request,
      limitations: ['快照不是 FINALIZED，拒绝继续物化。'],
      envelopes: [],
      reason: 'SNAPSHOT_NOT_FINALIZED',
    };
  }
  const evidenceIds = observation.evidence.map((item) => item.id).sort();
  if (evidenceIds.length < 2) {
    return {
      status: 'FAILED',
      request: input.request,
      limitations: ['检查结果证据不足两条，无法构造登记/终端证据对。'],
      envelopes: [],
      reason: 'INSUFFICIENT_EVIDENCE',
    };
  }
  const token = {
    ledger: input.request.ledger,
    chainId: input.request.chainId,
    token: canonicalEvm(input.request.token),
  };
  const limitations: string[] = [
    '当前物化绑定 Portal 检查快照，不是完整持有人历史。',
    '起源扫描未完成前不得将创建者标为完整经济控制人。',
    '未知数量保持未知，不得记为数字 0。',
  ];
  if (input.request.analysisMode === 'FULL_LIFETIME') {
    limitations.push('FULL_LIFETIME 在起源与历史任务完成前只能给出有界观察。');
  }

  const envelopes: ReportEnvelope[] = [];
  let supply: SupplyRealityPayload | undefined;
  const circulatingSupplyAtomic = observation.circulatingSupplyAtomic;
  const reserveAtomic = observation.reserveAtomic;
  const circulatingKnown = isUnsignedAtomic(circulatingSupplyAtomic);
  const reserveKnown = isUnsignedAtomic(reserveAtomic);
  if (circulatingKnown || reserveKnown) {
    const cells: SupplyCell[] = [];
    if (reserveKnown) {
      cells.push({
        id: cellId(token.token, observation.portalAddress ?? 'portal-reserve', 'POOL_RESERVE'),
        token,
        snapshot: observation.snapshot,
        amountAtomic: reserveAtomic,
        owner: observation.portalAddress ?? 'portal-reserve',
        custodyType: 'POOL_RESERVE',
        economicController: 'SERVICE',
        liquidityStatus: 'LP_WITHDRAWAL_REQUIRED',
        roleAssessmentIds: [],
        lotIds: [],
        evidenceIds: [evidenceIds[0]!, evidenceIds[1]!],
      });
    }
    if (circulatingKnown) {
      cells.push({
        id: cellId(token.token, 'unattributed-circulating', 'UNKNOWN'),
        token,
        snapshot: observation.snapshot,
        amountAtomic: circulatingSupplyAtomic,
        owner: 'unattributed-circulating',
        custodyType: 'UNKNOWN',
        economicController: 'UNKNOWN',
        liquidityStatus: 'UNKNOWN',
        roleAssessmentIds: [],
        lotIds: [],
        evidenceIds: [evidenceIds[0]!, evidenceIds[1]!],
      });
    }
    const protocol = (
      (circulatingKnown ? BigInt(circulatingSupplyAtomic) : 0n) +
      (reserveKnown ? BigInt(reserveAtomic) : 0n)
    ).toString();
    supply = materializeSupplyReality({
      token,
      protocolSupplyAtomic: protocol,
      historicalMintAtomic: protocol,
      historicalBurnAtomic: '0',
      burnAlreadyReflectedInSupply: true,
      originCoverageComplete: false,
      cells,
    });
    if (!circulatingKnown || !reserveKnown) {
      limitations.push('协议供应仅覆盖已观察的储备或流通分量，不是独立 totalSupply。');
    } else {
      limitations.push('协议供应取自检查接口 circulating+reserve 之和，不是独立 totalSupply 观察。');
    }
    envelopes.push(
      envelopeFor(
        'supply-reality-v1',
        input.request,
        observation.snapshot,
        'BOUNDED_OBSERVATION',
        coverageFromRatios({ originCoverage: 0, historyCoverage: 0.2, balanceCoverage: 0.4 }),
        evidenceIds,
        supply,
        limitations,
      ),
    );
  } else {
    limitations.push('检查结果未给出可解析的原子供应，未物化供应现实，也未记为 0。');
  }

  const registryEvidenceId = evidenceIds[0]!;
  const terminalEvidenceId = evidenceIds[1]!;
  const candidates: RoleCandidateInput[] = [];
  if (observation.portalAddress !== undefined && reserveKnown) {
    candidates.push({
      subject: {
        ledger: input.request.ledger,
        chainId: input.request.chainId,
        subjectType: 'CONTRACT',
        identifier: canonicalEvm(observation.portalAddress),
      },
      features: {
        insiderAccessScore: 0,
        commonControlScore: 0,
        coordinationScore: 0,
        benefitReturnScore: 0,
        independenceScore: 0,
        serviceHubScore: 90,
        marketMakerScore: 0,
        botScore: 0,
        forbiddenSingleFactors: [],
        positiveIndependenceEvidence: false,
      },
      proposedRole: 'ROUTER_OR_SERVICE',
      amountAtomic: reserveAtomic,
      executableAtomic: '0',
      evidenceFor: [registryEvidenceId],
      evidenceAgainst: [],
      coverageShrink: 0.5,
      historyCoverage: 0.2,
      serviceHub: true,
      disclosedTeam: false,
      publicAirdrop: false,
      publicVesting: false,
      onchainPrivilegeEvidence: true,
    });
  }
  let roles: IdentityRolesReportPayload | undefined;
  if (candidates.length > 0 && supply !== undefined) {
    roles = assessRoles({
      snapshot: observation.snapshot,
      registryEvidenceId,
      terminalEvidenceId,
      candidates,
      protocolSupplyAtomic: supply.conservation.protocolSupplyAtomic,
      executableSellableAtomic: supply.executable.sellableNowAtomic,
      nonServiceNonPoolAtomic: supply.conservation.unknownDifferenceAtomic,
      marketWideExitU: '0',
    });
    envelopes.push(
      envelopeFor(
        'identity-roles-v1',
        input.request,
        observation.snapshot,
        'PARTIAL',
        coverageFromRatios({ entityCoverage: 0.3, originCoverage: 0 }),
        evidenceIds,
        roles,
        limitations,
      ),
    );
  } else {
    limitations.push('缺少可绑定角色的链上主体或供应观察，未生成角色报告。');
  }

  limitations.push('坐庄时间线需要持有人与成交历史；当前快照检查不会用 0 伪造活动窗口。');

  const investigationId = contentAddressedId('inv', {
    request: input.request,
    snapshot: observation.snapshot,
  });
  const findings = [...(roles?.assessments.map((item) => item.finding) ?? [])];
  const casePackage = exportCasePackage({
    investigationId,
    findings,
    limitations,
    createdAt: input.createdAt ?? observation.snapshot.capturedAt,
  });

  return {
    status: 'PARTIAL',
    request: input.request,
    limitations,
    investigationId,
    envelopes,
    casePackage,
    ...(supply === undefined ? {} : { supply }),
    ...(roles === undefined ? {} : { roles }),
  };
}
