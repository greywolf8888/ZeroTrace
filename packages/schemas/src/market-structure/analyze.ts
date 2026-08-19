import { z } from 'zod';

import { LedgerSchema } from '../contracts/legacy-index.js';

export const SnapshotPolicySchema = z.literal('FINALIZED');
export type SnapshotPolicy = z.infer<typeof SnapshotPolicySchema>;

export const TokenAnalysisModeSchema = z.enum(['FULL_LIFETIME', 'BOUNDED_WINDOW']);
export type TokenAnalysisMode = z.infer<typeof TokenAnalysisModeSchema>;

export const ForensicAnalysisModeSchema = z.enum(['RESEARCH', 'ADMISSIBLE', 'FORENSIC']);
export type ForensicAnalysisMode = z.infer<typeof ForensicAnalysisModeSchema>;

export const WorkstationStatusSchema = z.enum([
  'IDLE',
  'QUEUED',
  'RUNNING',
  'PARTIAL',
  'COMPLETE',
  'STALE',
  'SOURCE_CONFLICT',
  'FAILED',
  'CANCELLED',
  'OFFLINE',
  'UNSUPPORTED',
]);
export type WorkstationStatus = z.infer<typeof WorkstationStatusSchema>;

export const TokenAnalyzeRequestSchema = z
  .object({
    ledger: LedgerSchema,
    chainId: z.string().min(1).max(128),
    token: z.string().min(1).max(128),
    snapshotPolicy: SnapshotPolicySchema,
    analysisMode: TokenAnalysisModeSchema,
    forensicMode: ForensicAnalysisModeSchema.optional(),
  })
  .strict();
export type TokenAnalyzeRequest = z.infer<typeof TokenAnalyzeRequestSchema>;
