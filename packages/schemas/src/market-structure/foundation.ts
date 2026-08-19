import { z } from 'zod';

import {
  AnalysisSnapshotSchema,
  ConfidenceSchema,
  DecimalStringSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  LedgerSchema,
  SourceIndependenceAssessmentSchema,
  SubjectTypeSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
  knownValue,
  unavailableValue,
  unknownValue,
} from '../contracts/legacy-index.js';

export const ForensicIdSchema = z.string().regex(/^[a-z]{3}_[0-9a-f]{24}$/);
export const EvidenceIdSchema = z.string().regex(/^ev_[0-9a-f]{24}$/);
export const FindingIdSchema = z.string().regex(/^fnd_[0-9a-f]{24}$/);
export const ReportIdSchema = z.string().regex(/^frp_[0-9a-f]{24}$/);
export const InvestigationIdSchema = z.string().regex(/^inv_[0-9a-f]{24}$/);
export const LotIdSchema = z.string().regex(/^lot_[0-9a-f]{24}$/);
export const CampaignV2IdSchema = z.string().regex(/^mcc_[0-9a-f]{24}$/);
export const ScenarioIdSchema = z.string().regex(/^mwe_[0-9a-f]{24}$/);
export const DecisionIdSchema = z.string().regex(/^ads_[0-9a-f]{24}$/);
export const CaseIdSchema = z.string().regex(/^cse_[0-9a-f]{24}$/);
export const CellIdSchema = z.string().regex(/^cel_[0-9a-f]{24}$/);

export const AssetIdSchema = z.object({
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  token: z.string().min(1),
  symbol: z.string().min(1).optional(),
  decimals: z.number().int().min(0).max(36).optional(),
});
export type AssetId = z.infer<typeof AssetIdSchema>;

export const ForensicSubjectSchema = z.object({
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  subjectType: SubjectTypeSchema,
  identifier: z.string().min(1),
});
export type ForensicSubject = z.infer<typeof ForensicSubjectSchema>;

export const ChainPositionSchema = z.object({
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  blockOrSlot: UnsignedQuantityStringSchema,
  timestamp: IsoDateTimeSchema.optional(),
});
export type ChainPosition = z.infer<typeof ChainPositionSchema>;

export const AssertionClassSchema = z.enum([
  'ONCHAIN_FACT',
  'DETERMINISTIC_DERIVATION',
  'MODEL_HYPOTHESIS',
  'ANALYST_FINDING',
]);
export type AssertionClass = z.infer<typeof AssertionClassSchema>;

export const CalibrationStatusSchema = z.enum([
  'NOT_APPLICABLE',
  'UNCALIBRATED',
  'CALIBRATED',
  'DRIFTED',
]);
export type CalibrationStatus = z.infer<typeof CalibrationStatusSchema>;

export const AnalystDispositionSchema = z.enum([
  'UNREVIEWED',
  'ACCEPTED',
  'DOWNGRADED',
  'REJECTED',
  'NEEDS_MORE_EVIDENCE',
]);
export type AnalystDisposition = z.infer<typeof AnalystDispositionSchema>;

export const EvidenceReferenceSchema = z.object({
  id: EvidenceIdSchema,
  familyKind: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const EvidenceFamilyKindSchema = z.enum([
  'FUNDING_ORIGIN',
  'SETTLEMENT_CONVERGENCE',
  'AUTHORITY_CONTROL',
  'BEHAVIOR_SYNC',
  'SUPPLY_CONSERVATION',
  'VENUE_EXECUTION',
  'BRIDGE_MATCH',
  'CEX_BOUNDARY',
  'DECLARATION_TEXT',
  'ANALYST_OVERRIDE',
  'PROVIDER_CROSS_CHECK',
]);
export type EvidenceFamilyKind = z.infer<typeof EvidenceFamilyKindSchema>;

export const EvidenceFamilyReferenceSchema = z.object({
  id: z.string().min(1),
  kind: EvidenceFamilyKindSchema,
  underlyingEventId: z.string().min(1),
  sourceOperatorId: z.string().min(1).optional(),
  correlationGroupId: z.string().min(1),
  familyContributionCap: z.number().min(0).max(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
  independenceAssessment: SourceIndependenceAssessmentSchema.optional(),
});
export type EvidenceFamilyReference = z.infer<typeof EvidenceFamilyReferenceSchema>;

export const AlternativeExplanationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'MARKET_MAKING',
    'ARBITRAGE',
    'COPY_TRADING',
    'COMMUNITY_DELEGATION',
    'BATCH_WALLET_SERVICE',
    'PUBLIC_AIRDROP',
    'VESTING_RELEASE',
    'CEX_WITHDRAWAL_BATCH',
    'AGGREGATOR_SPLIT',
    'MEV_OR_SNIPER',
    'LP_MANAGER',
    'PROTOCOL_TREASURY',
    'DISCLOSED_TEAM',
    'OTHER',
  ]),
  summary: z.string().min(1),
  excluded: z.boolean(),
  evidenceIds: z.array(EvidenceIdSchema),
});
export type AlternativeExplanation = z.infer<typeof AlternativeExplanationSchema>;

export const CoverageVectorSchema = z.object({
  originCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  historyCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  balanceCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  assetCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  venueCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  protocolDecodeCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  entityCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  priceCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  bridgeCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  sourceCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
  finalityCoverage: knowledgeValueSchema(z.number().min(0).max(1)),
});
export type CoverageVector = z.infer<typeof CoverageVectorSchema>;

export const ReplayRefSchema = z.object({
  command: z.string().min(1),
  snapshot: AnalysisSnapshotSchema,
  modelVersion: z.string().min(1),
  policyVersion: z.string().min(1),
  seed: z.number().int().optional(),
  inputHash: Hash256Schema,
});
export type ReplayRef = z.infer<typeof ReplayRefSchema>;

export const ForensicFindingSchema = z.object({
  schemaVersion: z.literal('forensic-finding-v1'),
  id: FindingIdSchema,
  assertionClass: AssertionClassSchema,
  subject: ForensicSubjectSchema,
  findingType: z.string().min(1),
  payload: z.unknown(),
  evidenceFor: z.array(EvidenceReferenceSchema),
  evidenceAgainst: z.array(EvidenceReferenceSchema),
  evidenceFamilies: z.array(EvidenceFamilyReferenceSchema),
  alternativeExplanations: z.array(AlternativeExplanationSchema),
  coverage: CoverageVectorSchema,
  sourceIndependence: SourceIndependenceAssessmentSchema,
  evidenceScore: knowledgeValueSchema(z.number().min(0).max(100)),
  calibratedProbability: knowledgeValueSchema(ConfidenceSchema),
  calibrationStatus: CalibrationStatusSchema,
  snapshot: AnalysisSnapshotSchema,
  modelVersion: z.string().min(1),
  policyVersion: z.string().min(1),
  resultHash: Hash256Schema,
  replayRef: z.string().min(1),
  analystDisposition: AnalystDispositionSchema,
});
export type ForensicFinding = z.infer<typeof ForensicFindingSchema>;

export const ReportStatusSchema = z.enum([
  'COMPLETE',
  'PARTIAL',
  'INSUFFICIENT_HISTORY',
  'BOUNDED_OBSERVATION',
  'FAILED_CLOSED',
]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const ReportEnvelopeSchema = z.object({
  schemaVersion: z.literal('report-envelope-v1'),
  id: ReportIdSchema,
  reportType: z.string().min(1),
  schemaContractVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  policyVersion: z.string().min(1),
  subject: ForensicSubjectSchema,
  snapshot: AnalysisSnapshotSchema,
  status: ReportStatusSchema,
  coverage: CoverageVectorSchema,
  sourceSet: z.array(z.string().min(1)).min(1),
  sourceIndependence: SourceIndependenceAssessmentSchema,
  evidenceClosure: z.array(EvidenceIdSchema).min(1),
  resultHash: Hash256Schema,
  createdAt: IsoDateTimeSchema,
  supersedes: ReportIdSchema.optional(),
  replayRef: ReplayRefSchema,
  payload: z.unknown(),
});
export type ReportEnvelope = z.infer<typeof ReportEnvelopeSchema>;

export const DecimalRangeSchema = z.object({
  lower: DecimalStringSchema,
  upper: DecimalStringSchema,
});
export type DecimalRange = z.infer<typeof DecimalRangeSchema>;

export const ScenarioDistributionSchema = z.object({
  p10: DecimalStringSchema,
  p50: DecimalStringSchema,
  p90: DecimalStringSchema,
  seed: z.number().int(),
  iterations: z.number().int().positive(),
});
export type ScenarioDistribution = z.infer<typeof ScenarioDistributionSchema>;

export {
  knowledgeValueSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  DecimalStringSchema,
  UnsignedQuantityStringSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  AnalysisSnapshotSchema,
};
