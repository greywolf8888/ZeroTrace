import { z } from 'zod';

import {
  AnalystDispositionSchema,
  CaseIdSchema,
  DecisionIdSchema,
  EvidenceIdSchema,
  FindingIdSchema,
  Hash256Schema,
  InvestigationIdSchema,
  IsoDateTimeSchema,
  ForensicSubjectSchema,
} from './foundation.js';

export const AnalystRoleSchema = z.enum(['LOCAL_ADMIN', 'ANALYST', 'REVIEWER']);
export type AnalystRole = z.infer<typeof AnalystRoleSchema>;

export const AnalystDecisionSchema = z.object({
  id: DecisionIdSchema,
  investigationId: InvestigationIdSchema,
  actor: z.string().min(1),
  role: AnalystRoleSchema,
  targetFindingId: FindingIdSchema.optional(),
  action: z.enum([
    'ACCEPT',
    'REJECT',
    'DOWNGRADE',
    'MERGE_ENTITY',
    'SPLIT_ENTITY',
    'SET_ROLE_INTERVAL',
    'ADJUST_CAMPAIGN_BOUNDARY',
    'ADD_OFFCHAIN_SOURCE',
    'MARK_ALTERNATIVE',
  ]),
  disposition: AnalystDispositionSchema,
  rationale: z.string().min(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
  previousStateHash: Hash256Schema.optional(),
  nextStateHash: Hash256Schema,
  createdAt: IsoDateTimeSchema,
});
export type AnalystDecision = z.infer<typeof AnalystDecisionSchema>;

export const CaseExportManifestSchema = z.object({
  caseId: CaseIdSchema,
  investigationId: InvestigationIdSchema,
  createdAt: IsoDateTimeSchema,
  files: z.array(
    z.object({
      name: z.string().min(1),
      sha256: Hash256Schema,
    }),
  ),
  limitations: z.array(z.string().min(1)),
});
export type CaseExportManifest = z.infer<typeof CaseExportManifestSchema>;

export const InvestigationRecordSchema = z.object({
  id: InvestigationIdSchema,
  subject: ForensicSubjectSchema,
  createdAt: IsoDateTimeSchema,
  actor: z.string().min(1),
  status: z.enum(['OPEN', 'REVIEW', 'CLOSED']),
});
export type InvestigationRecord = z.infer<typeof InvestigationRecordSchema>;

export const LlmTaskTypeSchema = z.enum([
  'CLAIM_PARSE',
  'EVIDENCE_NARRATIVE',
  'READONLY_PLAN',
  'PROTOCOL_RESEARCH',
  'CASE_NARRATIVE',
]);
export type LlmTaskType = z.infer<typeof LlmTaskTypeSchema>;

export const LlmStructuredOutputSchema = z.object({
  narrative: z.string(),
  evidenceIds: z.array(EvidenceIdSchema),
  uncertainty: z.array(z.string()),
  unsupportedClaims: z.array(z.string()),
  suggestedQueries: z.array(
    z.object({
      tool: z.string().min(1),
      args: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type LlmStructuredOutput = z.infer<typeof LlmStructuredOutputSchema>;

export const LlmAuditRecordSchema = z.object({
  id: z.string().regex(/^llm_[0-9a-f]{24}$/),
  taskType: LlmTaskTypeSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  promptTemplateVersion: z.string().min(1),
  inputEvidenceIds: z.array(EvidenceIdSchema),
  output: LlmStructuredOutputSchema,
  outputHash: Hash256Schema,
  rawResponseHash: Hash256Schema,
  createdAt: IsoDateTimeSchema,
  analystAccepted: z.boolean().optional(),
});
export type LlmAuditRecord = z.infer<typeof LlmAuditRecordSchema>;
