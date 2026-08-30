import { z } from 'zod';

import { EvidenceIdSchema, IsoDateTimeSchema } from './foundation.js';

export const AiConclusionTypeSchema = z.enum([
  'FACT_SUMMARY',
  'HYPOTHESIS',
  'COUNTEREVIDENCE',
  'RESEARCH_QUESTION',
  'SIMILAR_CASES',
  'EXPLANATION',
]);
export type AiConclusionType = z.infer<typeof AiConclusionTypeSchema>;

export const AiAnalysisOutputV2Schema = z
  .object({
    schemaVersion: z.literal('ai-analysis-v2'),
    conclusionType: AiConclusionTypeSchema,
    conclusions: z
      .array(
        z
          .object({
            text: z.string().min(1),
            evidenceIds: z.array(EvidenceIdSchema).min(1),
            featureIds: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .min(1),
    counterevidence: z.array(
      z
        .object({
          text: z.string().min(1),
          evidenceIds: z.array(EvidenceIdSchema).min(1),
        })
        .strict(),
    ),
    missingItems: z.array(z.string().min(1)),
    verifiableConditions: z.array(z.string().min(1)),
    applicableAsOf: IsoDateTimeSchema,
    promptVersion: z.string().min(1),
    suggestedQueries: z
      .array(
        z
          .object({
            tool: z.string().min(1),
            args: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type AiAnalysisOutputV2 = z.infer<typeof AiAnalysisOutputV2Schema>;
