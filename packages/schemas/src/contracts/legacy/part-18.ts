import { z } from 'zod';
export * from './part-17.js';
import {
  ActionApplicationSchema,
  ActionAssetDeltaSchema,
  ActionPrimitiveKindSchema,
  ActionProofKindSchema,
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  ClaimExpectedActionSchema,
  ConfidenceSchema,
  CoverageRatioSchema,
  EvidenceSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  LedgerSchema,
  UnsignedQuantityStringSchema,
  isCanonicalActionTransactionId,
  knowledgeValueSchema,
} from './part-17.js';

export const ActionSemanticFindingCodeSchema = z.enum([
  'PRIMITIVE_CONFIRMED',
  'EXECUTION_NOT_APPLIED',
  'EXECUTION_UNKNOWN',
  'ACTOR_UNKNOWN',
  'PROOF_INCOMPLETE',
  'DELTA_SHAPE_INVALID',
  'INTENT_NOT_INFERRED',
]);

export const ActionSemanticObservationSchema = z
  .object({
    id: z.string().regex(/^act_[0-9a-f]{24}$/),
    candidateId: z.string().regex(/^acn_[0-9a-f]{24}$/),
    ledger: LedgerSchema,
    chainId: z.string().trim().min(1).max(128),
    transactionId: z.string().trim().min(1).max(512),
    blockOrSlot: UnsignedQuantityStringSchema,
    observedAt: IsoDateTimeSchema,
    proposedKind: ActionPrimitiveKindSchema,
    primitive: knowledgeValueSchema(ActionPrimitiveKindSchema),
    application: ActionApplicationSchema,
    actor: knowledgeValueSchema(z.string().trim().min(1).max(512)),
    counterparties: z.array(z.string().trim().min(1).max(512)).max(1_000),
    assetDeltas: z.array(ActionAssetDeltaSchema).max(10_000),
    proofKinds: z.array(ActionProofKindSchema).min(1),
    claimedPurpose: knowledgeValueSchema(ClaimExpectedActionSchema),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    findings: z.array(ActionSemanticFindingCodeSchema).min(1),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const canonical = (items: readonly string[]) => [...new Set(items)].sort();
    if (!isCanonicalActionTransactionId(value.ledger, value.transactionId)) {
      context.addIssue({
        code: 'custom',
        path: ['transactionId'],
        message: 'Action transaction ID must be canonical for its ledger.',
      });
    }
    for (const [field, items] of [
      ['counterparties', value.counterparties],
      ['proofKinds', value.proofKinds],
      ['evidenceIds', value.evidenceIds],
    ] as const) {
      const expected = canonical(items);
      if (
        expected.length !== items.length ||
        expected.some((item, index) => item !== items[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `Action ${field} must be sorted and unique.`,
        });
      }
    }
    if (new Set(value.findings).size !== value.findings.length) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'Action findings must be unique.',
      });
    }
  });
export type ActionSemanticObservation = z.infer<typeof ActionSemanticObservationSchema>;

export const ActionSemanticsReportSchema = z
  .object({
    schemaVersion: z.literal('action-semantics-report-v1'),
    resultHash: Hash256Schema,
    snapshot: AnalysisSnapshotSchema,
    actions: z.array(ActionSemanticObservationSchema).min(1).max(10_000),
    classificationCoverage: CoverageRatioSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot !== null, {
      message: 'Action Semantics requires a replayable chain Snapshot.',
    }),
    evidence: z.array(EvidenceSchema).min(2).max(10_001),
  })
  .strict()
  .superRefine((value, context) => {
    const evidenceIds = value.evidence.map((item) => item.id);
    const metadataEvidence = [...value.metadata.evidenceIds].sort();
    const sortedEvidence = [...new Set(evidenceIds)].sort();
    const actionIds = value.actions.map((item) => item.id);
    const sortedActionIds = [...actionIds].sort();
    const actionEvidenceIds = [
      ...new Set(value.actions.flatMap((item) => item.evidenceIds)),
    ].sort();
    const nonTerminalEvidenceIds = sortedEvidence.filter(
      (item) => item !== value.terminalEvidenceId,
    );
    const nonDerivedSourceSet = [
      ...new Set(
        value.evidence
          .filter(
            (item) =>
              item.kind !== 'DERIVED_FEATURE' &&
              item.kind !== 'NEGATIVE_EVIDENCE' &&
              item.kind !== 'ANALYST_OBSERVATION',
          )
          .map((item) => item.source),
      ),
    ].sort();
    const metadataSourceSet = [...value.metadata.sourceSet];
    const knownActions = value.actions.filter((item) => item.primitive.state === 'known').length;
    const position =
      value.snapshot.ledger === 'EVM'
        ? value.snapshot.blockNumber
        : value.snapshot.ledger === 'BITCOIN'
          ? value.snapshot.height
          : value.snapshot.slot;
    if (
      value.metadata.snapshot === null ||
      JSON.stringify(value.metadata.snapshot) !== JSON.stringify(value.snapshot) ||
      value.metadata.freshness !== value.snapshot.capturedAt ||
      !['action-semantics-v0.1.0', 'action-semantics-v0.2.0'].includes(
        value.metadata.modelVersion,
      ) ||
      value.metadata.confidence !== 1 ||
      value.classificationCoverage !== knownActions / value.actions.length ||
      !evidenceIds.includes(value.terminalEvidenceId) ||
      sortedEvidence.length !== evidenceIds.length ||
      sortedEvidence.some((item, index) => item !== evidenceIds[index]) ||
      new Set(actionIds).size !== actionIds.length ||
      sortedActionIds.some((item, index) => item !== actionIds[index]) ||
      actionEvidenceIds.length !== nonTerminalEvidenceIds.length ||
      actionEvidenceIds.some((item, index) => item !== nonTerminalEvidenceIds[index]) ||
      metadataSourceSet.length !== nonDerivedSourceSet.length ||
      nonDerivedSourceSet.length === 0 ||
      metadataSourceSet.some((item, index) => item !== nonDerivedSourceSet[index]) ||
      metadataEvidence.length !== evidenceIds.length ||
      metadataEvidence.some((item, index) => item !== sortedEvidence[index]) ||
      value.evidence.some(
        (evidence) =>
          evidence.ledger !== value.snapshot.ledger ||
          evidence.chainId !== value.snapshot.chainId ||
          (evidence.blockOrSlot !== undefined && evidence.blockOrSlot !== position),
      ) ||
      value.actions.some(
        (action) =>
          action.ledger !== value.snapshot.ledger ||
          action.chainId !== value.snapshot.chainId ||
          action.blockOrSlot !== position ||
          action.evidenceIds.some((id) => !evidenceIds.includes(id)),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Action Semantics Snapshot and Evidence provenance must be complete and exact.',
      });
    }
  });
export type ActionSemanticsReport = z.infer<typeof ActionSemanticsReportSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
