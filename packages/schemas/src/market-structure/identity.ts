import { z } from 'zod';

import { ForensicFindingSchema } from './foundation.js';
import { ChainPositionSchema, ForensicSubjectSchema, knowledgeValueSchema } from './foundation.js';

export const EconomicRoleSchema = z.enum([
  'CONFIRMED_ONCHAIN_CONTROLLER',
  'DISCLOSED_TEAM_OR_TREASURY',
  'PROBABLE_COMMON_CONTROLLER',
  'COORDINATED_ENTITY',
  'SUSPECTED_HIDDEN_AFFILIATE',
  'INDEPENDENT_NATURAL_TRADER',
  'MARKET_MAKER',
  'ARBITRAGEUR',
  'MEV_OR_BOT',
  'CEX_CUSTODY',
  'BRIDGE_CUSTODY',
  'ROUTER_OR_SERVICE',
  'PROTOCOL_TREASURY',
  'UNKNOWN',
]);
export type EconomicRole = z.infer<typeof EconomicRoleSchema>;

export const RoleFeatureVectorSchema = z.object({
  insiderAccessScore: z.number().min(0).max(100),
  commonControlScore: z.number().min(0).max(100),
  coordinationScore: z.number().min(0).max(100),
  benefitReturnScore: z.number().min(0).max(100),
  independenceScore: z.number().min(0).max(100),
  serviceHubScore: z.number().min(0).max(100),
  marketMakerScore: z.number().min(0).max(100),
  botScore: z.number().min(0).max(100),
  forbiddenSingleFactors: z.array(z.enum(['early', 'small_balance', 'same_cex', 'same_gas'])),
  positiveIndependenceEvidence: z.boolean(),
});
export type RoleFeatureVector = z.infer<typeof RoleFeatureVectorSchema>;

export const RoleAssessmentSchema = z.object({
  id: z.string().regex(/^rol_[0-9a-f]{24}$/),
  subject: ForensicSubjectSchema,
  role: EconomicRoleSchema,
  effectiveFrom: ChainPositionSchema,
  effectiveTo: knowledgeValueSchema(ChainPositionSchema),
  finding: ForensicFindingSchema,
  mutuallyExclusiveGroup: z.string().min(1).optional(),
  compatibleRoles: z.array(EconomicRoleSchema),
});
export type RoleAssessment = z.infer<typeof RoleAssessmentSchema>;

export const HiddenAffiliateBoundsSchema = z.object({
  ofProtocolSupply: z.object({
    lower: z.string(),
    scenario: z.string(),
    upper: z.string(),
    unknown: z.string(),
  }),
  ofExecutableSellable: z.object({
    lower: z.string(),
    scenario: z.string(),
    upper: z.string(),
    unknown: z.string(),
  }),
  ofNonServiceNonPool: z.object({
    lower: z.string(),
    scenario: z.string(),
    upper: z.string(),
    unknown: z.string(),
  }),
  ofMarketWideExitU: knowledgeValueSchema(
    z.object({
      lower: z.string(),
      scenario: z.string(),
      upper: z.string(),
      unknown: z.string(),
    }),
  ),
});
export type HiddenAffiliateBounds = z.infer<typeof HiddenAffiliateBoundsSchema>;

export const RetailMetricsSchema = z.object({
  rawAddressCount: z.number().int().nonnegative(),
  independentEntityCandidates: z.number().int().nonnegative(),
  effectiveRetailCount: z.number().int().nonnegative(),
  currentHoldingAtomic: z.string(),
  executableHoldingAtomic: z.string(),
  netOrganicCapitalU: knowledgeValueSchema(z.string()),
  realizedPnlRangeU: knowledgeValueSchema(z.object({ lower: z.string(), upper: z.string() })),
});
export type RetailMetrics = z.infer<typeof RetailMetricsSchema>;

export const IdentityRolesReportPayloadSchema = z.object({
  assessments: z.array(RoleAssessmentSchema),
  hiddenAffiliate: HiddenAffiliateBoundsSchema,
  retail: RetailMetricsSchema,
  serviceHubsSuppressed: z.array(ForensicSubjectSchema),
  unattributedSubjects: z.number().int().nonnegative(),
});
export type IdentityRolesReportPayload = z.infer<typeof IdentityRolesReportPayloadSchema>;
