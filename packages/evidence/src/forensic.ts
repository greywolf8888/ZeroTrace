import {
  ForensicFindingSchema,
  ReportEnvelopeSchema,
  SourceIndependenceAssessmentSchema,
  unknownValue,
  type AnalysisSnapshot,
  type CoverageVector,
  type ForensicFinding,
  type ReportEnvelope,
  type SourceIndependenceAssessment,
  type ForensicSubject,
} from '@zerotrace/schemas';

import { hashPayload } from './hash.js';

export const FORENSIC_POLICY_VERSION = 'market-structure-policy-v1';

export function contentAddressedId(prefix: string, payload: unknown): string {
  if (!/^[a-z]{3}$/.test(prefix)) {
    throw new Error('Forensic ID prefix must be three lowercase letters.');
  }
  return `${prefix}_${hashPayload(payload).slice(0, 24)}`;
}

export function unknownCoverageVector(): CoverageVector {
  const unknown = unknownValue('NOT_QUERIED');
  return {
    originCoverage: unknown,
    historyCoverage: unknown,
    balanceCoverage: unknown,
    assetCoverage: unknown,
    venueCoverage: unknown,
    protocolDecodeCoverage: unknown,
    entityCoverage: unknown,
    priceCoverage: unknown,
    bridgeCoverage: unknown,
    sourceCoverage: unknown,
    finalityCoverage: unknown,
  };
}

export function coverageFromRatios(
  ratios: Partial<Record<keyof CoverageVector, number>>,
): CoverageVector {
  const unknown = unknownValue('NOT_QUERIED');
  const cell = (key: keyof CoverageVector) => {
    const value = ratios[key];
    return value === undefined ? unknown : { state: 'known' as const, value };
  };
  return {
    originCoverage: cell('originCoverage'),
    historyCoverage: cell('historyCoverage'),
    balanceCoverage: cell('balanceCoverage'),
    assetCoverage: cell('assetCoverage'),
    venueCoverage: cell('venueCoverage'),
    protocolDecodeCoverage: cell('protocolDecodeCoverage'),
    entityCoverage: cell('entityCoverage'),
    priceCoverage: cell('priceCoverage'),
    bridgeCoverage: cell('bridgeCoverage'),
    sourceCoverage: cell('sourceCoverage'),
    finalityCoverage: cell('finalityCoverage'),
  };
}

export function inconclusiveSourceIndependence(
  registryEvidenceId: string,
  terminalEvidenceId: string,
): SourceIndependenceAssessment {
  if (registryEvidenceId === terminalEvidenceId) {
    throw new Error('Registry and terminal Evidence IDs must be distinct.');
  }
  const evidenceIds = [registryEvidenceId, terminalEvidenceId].sort();
  return SourceIndependenceAssessmentSchema.parse({
    status: 'INCONCLUSIVE',
    independence: unknownValue('NOT_QUERIED'),
    requiredOperators: 2,
    observedSources: 0,
    operatorCount: 0,
    unresolvedSources: [],
    attestations: [],
    registryEvidenceId,
    terminalEvidenceId,
    evidenceIds,
    modelVersion: 'source-operator-registry-v1',
  });
}

export function fuseEvidenceScore(input: {
  familyContributions: ReadonlyArray<{ contribution: number; cap: number }>;
  contradictionPenalty: number;
  coverageShrink: number;
}): number {
  let score = 0;
  for (const family of input.familyContributions) {
    score += Math.min(family.contribution, family.cap);
  }
  score = Math.max(0, score - input.contradictionPenalty) * input.coverageShrink;
  return Math.min(100, Math.max(0, score));
}

export function buildForensicFinding(
  input: Omit<ForensicFinding, 'id' | 'resultHash'> & {
    id?: string;
  },
): ForensicFinding {
  const withoutIds = {
    ...input,
    id: 'fnd_000000000000000000000000',
    resultHash: '0'.repeat(64),
  };
  const resultHash = hashPayload({
    schema: 'forensic-finding-v1',
    finding: {
      ...withoutIds,
      id: undefined,
      resultHash: undefined,
    },
  });
  const id = input.id ?? contentAddressedId('fnd', { resultHash, subject: input.subject });
  return ForensicFindingSchema.parse({
    ...input,
    id,
    resultHash,
  });
}

export function buildReportEnvelope(
  input: Omit<ReportEnvelope, 'id' | 'resultHash'> & { id?: string },
): ReportEnvelope {
  const resultHash = hashPayload({
    schema: 'report-envelope-v1',
    envelope: {
      ...input,
      id: undefined,
      resultHash: undefined,
    },
  });
  const id = input.id ?? contentAddressedId('frp', { resultHash, subject: input.subject });
  return ReportEnvelopeSchema.parse({
    ...input,
    id,
    resultHash,
  });
}

export function snapshotPosition(snapshot: AnalysisSnapshot): string {
  if (snapshot.ledger === 'EVM') return snapshot.blockNumber;
  if (snapshot.ledger === 'BITCOIN') return snapshot.height;
  return snapshot.slot;
}

export function subjectKey(subject: ForensicSubject): string {
  return `${subject.ledger}:${subject.chainId}:${subject.subjectType}:${subject.identifier}`;
}
