import { z } from 'zod';
export * from './part-07.js';
import type { KnowledgeValue } from './part-07.js';
import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  EntityInvestigationGraphTimelinePairKnowledgeSchema,
  EntityInvestigationGraphTimelinePairObservationSchema,
  EvidenceSchema,
  Hash256Schema,
  LedgerSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
  knownValue,
  unavailableValue,
  unknownValue,
} from './part-07.js';

export const EntityInvestigationGraphTimelinePairChangeKindSchema = z.enum([
  'ADDED_TO_REQUESTED_GRAPH',
  'OMITTED_FROM_REQUESTED_GRAPH',
  'PROJECTION_CHANGED',
  'RELATION_CHANGED',
  'CLASSIFICATION_CHANGED',
  'SERVICE_SUPPRESSION_CHANGED',
  'PROBABILITY_CHANGED',
  'EVIDENCE_REFRESHED',
]);
export type EntityInvestigationGraphTimelinePairChangeKind = z.infer<
  typeof EntityInvestigationGraphTimelinePairChangeKindSchema
>;

export const EntityInvestigationGraphTimelinePairChangeSchema = z
  .object({
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    kind: EntityInvestigationGraphTimelinePairChangeKindSchema,
    before: EntityInvestigationGraphTimelinePairKnowledgeSchema,
    after: EntityInvestigationGraphTimelinePairKnowledgeSchema,
    evidenceIds: z
      .array(z.string().regex(/^ev_[0-9a-f]{24}$/))
      .min(1)
      .max(2),
    relationshipStartEstablished: z.literal(false),
    relationshipEndEstablished: z.literal(false),
    automaticEntityMembershipMutationAllowed: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const before = value.before.state === 'known' ? value.before.value : undefined;
    const after = value.after.state === 'known' ? value.after.value : undefined;
    let expectedKind: EntityInvestigationGraphTimelinePairChangeKind | undefined;
    if (before === undefined && after !== undefined) expectedKind = 'ADDED_TO_REQUESTED_GRAPH';
    else if (before !== undefined && after === undefined)
      expectedKind = 'OMITTED_FROM_REQUESTED_GRAPH';
    else if (before !== undefined && after !== undefined) {
      if (before.projectionState !== after.projectionState) expectedKind = 'PROJECTION_CHANGED';
      else if (JSON.stringify(before.relation) !== JSON.stringify(after.relation))
        expectedKind = 'RELATION_CHANGED';
      else if (before.classification !== after.classification)
        expectedKind = 'CLASSIFICATION_CHANGED';
      else if (before.serviceSuppressionApplied !== after.serviceSuppressionApplied)
        expectedKind = 'SERVICE_SUPPRESSION_CHANGED';
      else if (
        JSON.stringify(before.sameControllerProbability) !==
          JSON.stringify(after.sameControllerProbability) ||
        JSON.stringify(before.coordinationProbability) !==
          JSON.stringify(after.coordinationProbability) ||
        JSON.stringify(before.independenceProbability) !==
          JSON.stringify(after.independenceProbability)
      )
        expectedKind = 'PROBABILITY_CHANGED';
      else if (
        before.timelineId !== after.timelineId ||
        before.terminalEvidenceId !== after.terminalEvidenceId
      )
        expectedKind = 'EVIDENCE_REFRESHED';
    }
    const expectedEvidenceIds = [before?.terminalEvidenceId, after?.terminalEvidenceId]
      .filter((item): item is string => item !== undefined)
      .filter((item, index, items) => items.indexOf(item) === index)
      .sort();
    const missingStateIsExplicit =
      (value.before.state === 'known' || value.before.reason === 'NOT_QUERIED') &&
      (value.after.state === 'known' || value.after.reason === 'NOT_QUERIED');
    if (
      value.subjectA >= value.subjectB ||
      expectedKind === undefined ||
      value.kind !== expectedKind ||
      !missingStateIsExplicit ||
      value.evidenceIds.length !== expectedEvidenceIds.length ||
      value.evidenceIds.some((item, index) => item !== expectedEvidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['kind'],
        message:
          'Temporal pair changes must be canonical, non-empty, Evidence-bound, and treat omitted pairs as not queried rather than ended.',
      });
    }
  });
export type EntityInvestigationGraphTimelinePairChange = z.infer<
  typeof EntityInvestigationGraphTimelinePairChangeSchema
>;

export const EntityInvestigationGraphTimelineObservationSchema = z
  .object({
    graphId: z.string().regex(/^eig_[0-9a-f]{24}$/),
    resultHash: Hash256Schema,
    timelineSetHash: Hash256Schema,
    subjectIds: z.array(z.string().trim().min(1).max(512)).min(2).max(500),
    pairs: z.array(EntityInvestigationGraphTimelinePairObservationSchema).min(1).max(250),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      snapshot: AnalysisSnapshotSchema,
      modelVersion: z.literal('entity-investigation-graph-v0.1.0'),
    }),
  })
  .strict()
  .superRefine((value, context) => {
    const pairKeys = value.pairs.map((item) => `${item.subjectA}\u0000${item.subjectB}`);
    if (
      value.subjectIds.length !== new Set(value.subjectIds).size ||
      value.subjectIds.some((item, index) => item !== [...value.subjectIds].sort()[index]) ||
      pairKeys.length !== new Set(pairKeys).size ||
      pairKeys.some((item, index) => item !== [...pairKeys].sort()[index]) ||
      value.pairs.some(
        (pair) =>
          !value.subjectIds.includes(pair.subjectA) || !value.subjectIds.includes(pair.subjectB),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pairs'],
        message:
          'Temporal graph observations require canonical subjects and exactly one ordered observation per pair.',
      });
    }
  });
export type EntityInvestigationGraphTimelineObservation = z.infer<
  typeof EntityInvestigationGraphTimelineObservationSchema
>;

export const EntityInvestigationGraphTimelineTransitionSchema = z
  .object({
    fromGraphId: z.string().regex(/^eig_[0-9a-f]{24}$/),
    toGraphId: z.string().regex(/^eig_[0-9a-f]{24}$/),
    fromPosition: UnsignedQuantityStringSchema,
    toPosition: UnsignedQuantityStringSchema,
    kind: z.enum(['REVISION', 'POSITION_ADVANCE']),
    unobservedPositionCount: UnsignedQuantityStringSchema,
    snapshotContinuity: knowledgeValueSchema(z.boolean()),
    addedSubjectIds: z.array(z.string().trim().min(1).max(512)).max(500),
    omittedSubjectIds: z.array(z.string().trim().min(1).max(512)).max(500),
    pairChanges: z.array(EntityInvestigationGraphTimelinePairChangeSchema).max(500),
    unchangedPairCount: z.number().int().nonnegative().max(250),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).length(2),
    omittedSubjectsEstablishExit: z.literal(false),
    omittedPairsEstablishRelationshipEnd: z.literal(false),
    automaticEntityMembershipMutationAllowed: z.literal(false),
  })
  .strict();
export type EntityInvestigationGraphTimelineTransition = z.infer<
  typeof EntityInvestigationGraphTimelineTransitionSchema
>;

export const EntityInvestigationGraphTimelineCoreSchema = z
  .object({
    request: z
      .object({
        ledger: LedgerSchema,
        chainId: z.string().trim().min(1).max(128),
        graphIds: z
          .array(z.string().regex(/^eig_[0-9a-f]{24}$/))
          .min(2)
          .max(100),
        graphSetHash: Hash256Schema,
        fromPosition: UnsignedQuantityStringSchema,
        toPosition: UnsignedQuantityStringSchema,
      })
      .strict(),
    observations: z.array(EntityInvestigationGraphTimelineObservationSchema).min(2).max(100),
    transitions: z.array(EntityInvestigationGraphTimelineTransitionSchema).min(1).max(99),
    summary: z
      .object({
        observationCount: z.number().int().min(2).max(100),
        transitionCount: z.number().int().min(1).max(99),
        subjectAdditionCount: z.number().int().nonnegative(),
        subjectOmissionCount: z.number().int().nonnegative(),
        pairChangeCount: z.number().int().nonnegative(),
        currentGraphId: z.string().regex(/^eig_[0-9a-f]{24}$/),
        completeRequestedGraphSet: z.literal(true),
        rawTransferEdgesCopied: z.literal(false),
        absenceEstablishesRelationshipTermination: z.literal(false),
        automaticEntityMembershipMutationAllowed: z.literal(false),
        chainObservationContinuity: knowledgeValueSchema(z.boolean()),
      })
      .strict(),
    metadata: AnalysisMetadataSchema.extend({
      snapshot: AnalysisSnapshotSchema,
      modelVersion: z.literal('entity-investigation-graph-timeline-v0.1.0'),
    }),
  })
  .strict()
  .superRefine((value, context) => {
    const position = (observation: EntityInvestigationGraphTimelineObservation) => {
      const snapshot = observation.metadata.snapshot;
      return snapshot.ledger === 'EVM'
        ? snapshot.blockNumber
        : snapshot.ledger === 'BITCOIN'
          ? snapshot.height
          : snapshot.slot;
    };
    const snapshotHash = (observation: EntityInvestigationGraphTimelineObservation) => {
      const snapshot = observation.metadata.snapshot;
      return snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
    };
    const expectedContinuity = (
      before: EntityInvestigationGraphTimelineObservation,
      after: EntityInvestigationGraphTimelineObservation,
    ): KnowledgeValue<boolean> => {
      const beforePosition = BigInt(position(before));
      const afterPosition = BigInt(position(after));
      if (beforePosition === afterPosition) {
        return knownValue(snapshotHash(before) === snapshotHash(after));
      }
      if (afterPosition !== beforePosition + 1n) {
        return unknownValue(
          'INSUFFICIENT_DATA',
          'Adjacent persisted graphs do not observe every chain position.',
        );
      }
      const beforeSnapshot = before.metadata.snapshot;
      const afterSnapshot = after.metadata.snapshot;
      if (beforeSnapshot.ledger === 'EVM' && afterSnapshot.ledger === 'EVM') {
        return afterSnapshot.parentBlockHash === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'The successor EVM Snapshot has no parent hash.')
          : knownValue(
              afterSnapshot.parentBlockHash.toLowerCase() ===
                beforeSnapshot.blockHash.toLowerCase(),
            );
      }
      if (beforeSnapshot.ledger === 'BITCOIN' && afterSnapshot.ledger === 'BITCOIN') {
        return afterSnapshot.previousBlockHash === undefined
          ? unknownValue(
              'INSUFFICIENT_DATA',
              'The successor Bitcoin Snapshot has no previous hash.',
            )
          : knownValue(afterSnapshot.previousBlockHash === beforeSnapshot.blockHash);
      }
      if (beforeSnapshot.ledger === 'SOLANA' && afterSnapshot.ledger === 'SOLANA') {
        return afterSnapshot.parentSlot === undefined ||
          afterSnapshot.previousBlockhash === undefined
          ? unknownValue(
              'INSUFFICIENT_DATA',
              'The successor Solana Snapshot has no complete parent identity.',
            )
          : knownValue(
              afterSnapshot.parentSlot === position(before) &&
                afterSnapshot.previousBlockhash === beforeSnapshot.blockhash,
            );
      }
      return unavailableValue('CONFLICTING_SOURCES', 'Snapshot ledgers are inconsistent.');
    };
    const observations = value.observations;
    const graphIds = observations.map((item) => item.graphId);
    const evidenceIds = observations.map((item) => item.terminalEvidenceId).sort();
    const latest = observations.at(-1);
    if (latest === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Investigation graph timelines require at least two graph observations.',
      });
      return;
    }
    let invalid =
      graphIds.length !== new Set(graphIds).size ||
      value.request.graphIds.length !== graphIds.length ||
      value.request.graphIds.some((item, index) => item !== graphIds[index]) ||
      value.request.fromPosition !== position(observations[0]!) ||
      value.request.toPosition !== position(latest) ||
      BigInt(value.request.fromPosition) > BigInt(value.request.toPosition) ||
      observations.some((item, index) => {
        if (
          item.metadata.snapshot.ledger !== value.request.ledger ||
          item.metadata.snapshot.chainId !== value.request.chainId
        )
          return true;
        const previous = observations[index - 1];
        if (previous === undefined) return false;
        const previousPosition = BigInt(position(previous));
        const currentPosition = BigInt(position(item));
        return (
          previousPosition > currentPosition ||
          (previousPosition === currentPosition &&
            (previous.metadata.snapshot.capturedAt > item.metadata.snapshot.capturedAt ||
              (previous.metadata.snapshot.capturedAt === item.metadata.snapshot.capturedAt &&
                previous.graphId >= item.graphId)))
        );
      }) ||
      value.transitions.length !== observations.length - 1;

    for (let index = 0; index < value.transitions.length && !invalid; index += 1) {
      const before = observations[index]!;
      const after = observations[index + 1]!;
      const transition = value.transitions[index]!;
      const beforePosition = BigInt(position(before));
      const afterPosition = BigInt(position(after));
      const beforePairs = new Map(
        before.pairs.map((pair) => [`${pair.subjectA}\u0000${pair.subjectB}`, pair.state]),
      );
      const afterPairs = new Map(
        after.pairs.map((pair) => [`${pair.subjectA}\u0000${pair.subjectB}`, pair.state]),
      );
      const allPairKeys = [...new Set([...beforePairs.keys(), ...afterPairs.keys()])].sort();
      const changedPairKeys = allPairKeys.filter(
        (key) => JSON.stringify(beforePairs.get(key)) !== JSON.stringify(afterPairs.get(key)),
      );
      const transitionPairKeys = transition.pairChanges.map(
        (change) => `${change.subjectA}\u0000${change.subjectB}`,
      );
      const pairChangeStatesMatch = transition.pairChanges.every((change) => {
        const key = `${change.subjectA}\u0000${change.subjectB}`;
        const beforeState = beforePairs.get(key);
        const afterState = afterPairs.get(key);
        const expectedBefore =
          beforeState === undefined
            ? unknownValue(
                'NOT_QUERIED',
                'This pair was not included in the earlier requested investigation graph.',
              )
            : knownValue(beforeState);
        const expectedAfter =
          afterState === undefined
            ? unknownValue(
                'NOT_QUERIED',
                'This pair was not included in the later requested investigation graph.',
              )
            : knownValue(afterState);
        return (
          JSON.stringify(change.before) === JSON.stringify(expectedBefore) &&
          JSON.stringify(change.after) === JSON.stringify(expectedAfter)
        );
      });
      const addedSubjectIds = after.subjectIds.filter((item) => !before.subjectIds.includes(item));
      const omittedSubjectIds = before.subjectIds.filter(
        (item) => !after.subjectIds.includes(item),
      );
      const expectedTransitionEvidence = [
        before.terminalEvidenceId,
        after.terminalEvidenceId,
      ].sort();
      invalid =
        transition.fromGraphId !== before.graphId ||
        transition.toGraphId !== after.graphId ||
        transition.fromPosition !== beforePosition.toString() ||
        transition.toPosition !== afterPosition.toString() ||
        transition.kind !== (beforePosition === afterPosition ? 'REVISION' : 'POSITION_ADVANCE') ||
        transition.unobservedPositionCount !==
          (beforePosition === afterPosition
            ? '0'
            : (afterPosition - beforePosition - 1n).toString()) ||
        JSON.stringify(transition.snapshotContinuity) !==
          JSON.stringify(expectedContinuity(before, after)) ||
        JSON.stringify(transition.addedSubjectIds) !== JSON.stringify(addedSubjectIds) ||
        JSON.stringify(transition.omittedSubjectIds) !== JSON.stringify(omittedSubjectIds) ||
        JSON.stringify(transitionPairKeys) !== JSON.stringify(changedPairKeys) ||
        !pairChangeStatesMatch ||
        transition.unchangedPairCount !== allPairKeys.length - changedPairKeys.length ||
        JSON.stringify(transition.evidenceIds) !== JSON.stringify(expectedTransitionEvidence);
    }

    const continuityValues = value.transitions.map((item) => item.snapshotContinuity);
    const expectedAggregateContinuity: KnowledgeValue<boolean> = continuityValues.some(
      (item) => item.state === 'known' && item.value === false,
    )
      ? knownValue(false)
      : continuityValues.some((item) => item.state === 'unavailable')
        ? unavailableValue(
            continuityValues.find((item) => item.state === 'unavailable')!.reason,
            'At least one graph transition continuity check is unavailable.',
          )
        : continuityValues.some((item) => item.state === 'unknown')
          ? unknownValue(
              continuityValues.find((item) => item.state === 'unknown')!.reason,
              'At least one graph transition lacks complete chain continuity evidence.',
            )
          : knownValue(true);
    invalid =
      invalid ||
      value.summary.observationCount !== observations.length ||
      value.summary.transitionCount !== value.transitions.length ||
      value.summary.subjectAdditionCount !==
        value.transitions.reduce((sum, item) => sum + item.addedSubjectIds.length, 0) ||
      value.summary.subjectOmissionCount !==
        value.transitions.reduce((sum, item) => sum + item.omittedSubjectIds.length, 0) ||
      value.summary.pairChangeCount !==
        value.transitions.reduce((sum, item) => sum + item.pairChanges.length, 0) ||
      value.summary.currentGraphId !== latest.graphId ||
      JSON.stringify(value.summary.chainObservationContinuity) !==
        JSON.stringify(expectedAggregateContinuity) ||
      JSON.stringify(value.metadata.snapshot) !== JSON.stringify(latest.metadata.snapshot) ||
      value.metadata.evidenceIds.length !== evidenceIds.length ||
      value.metadata.evidenceIds.some((item, index) => item !== evidenceIds[index]);

    if (invalid) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message:
          'Investigation graph timelines require ordered exact graph observations, deterministic pair deltas, explicit continuity, and no inferred membership or relationship termination.',
      });
    }
  });
export type EntityInvestigationGraphTimelineCore = z.infer<
  typeof EntityInvestigationGraphTimelineCoreSchema
>;

export const EntityInvestigationGraphTimelineReportSchema = z
  .object({
    schemaVersion: z.literal('entity-investigation-graph-timeline-report-v1'),
    sourceOfTruth: z.literal('DURABLE_ENTITY_INVESTIGATION_GRAPHS'),
    automaticOwnershipMergeAllowed: z.literal(false),
    automaticEntityMembershipMutationAllowed: z.literal(false),
    relationshipTerminationInferenceAllowed: z.literal(false),
    timeline: EntityInvestigationGraphTimelineCoreSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidence: z.array(EvidenceSchema).min(3).max(101),
  })
  .strict()
  .superRefine((value, context) => {
    const latest = value.timeline.observations.at(-1);
    if (latest === undefined) return;
    const snapshot = latest.metadata.snapshot;
    const position =
      snapshot.ledger === 'EVM'
        ? { value: snapshot.blockNumber, finality: snapshot.finality }
        : snapshot.ledger === 'BITCOIN'
          ? { value: snapshot.height, finality: snapshot.finality }
          : { value: snapshot.slot, finality: snapshot.commitment };
    const expectedEvidenceIds = [
      ...value.timeline.metadata.evidenceIds,
      value.terminalEvidenceId,
    ].sort();
    const evidenceIds = value.evidence.map((item) => item.id);
    const terminal = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    const expectedLocator = `entity-investigation-graph-timeline:${value.timeline.request.ledger}:${value.timeline.request.chainId}:${value.timeline.request.fromPosition}-${value.timeline.request.toPosition}:${value.timeline.request.graphSetHash}`;
    const invalid =
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((item, index) => item !== [...evidenceIds].sort()[index]) ||
      evidenceIds.length !== expectedEvidenceIds.length ||
      evidenceIds.some((item, index) => item !== expectedEvidenceIds[index]) ||
      value.evidence.some(
        (item) =>
          item.ledger !== value.timeline.request.ledger ||
          item.chainId !== value.timeline.request.chainId,
      ) ||
      value.timeline.observations.some((observation) => {
        const evidence = value.evidence.find((item) => item.id === observation.terminalEvidenceId);
        return evidence?.source !== 'zerotrace:entity-investigation-graph-v0.1.0';
      }) ||
      terminal?.kind !== 'DERIVED_FEATURE' ||
      terminal.source !== 'zerotrace:entity-investigation-graph-timeline-v0.1.0' ||
      terminal.locator !== expectedLocator ||
      terminal.blockOrSlot !== position.value ||
      terminal.finality !== position.finality;
    if (invalid) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message:
          'Investigation graph timeline reports require exact durable graph terminal Evidence and one latest-Snapshot temporal derivation.',
      });
    }
  });
export type EntityInvestigationGraphTimelineReport = z.infer<
  typeof EntityInvestigationGraphTimelineReportSchema
>;

export const BitcoinScriptClassSchema = z.enum([
  'P2PKH',
  'P2SH',
  'P2WPKH',
  'P2WSH',
  'P2TR',
  'BARE_MULTISIG',
  'OP_RETURN',
  'OTHER_SCRIPT',
]);
export type BitcoinScriptClass = z.infer<typeof BitcoinScriptClassSchema>;

export const BitcoinSpendConditionVisibilitySchema = z.enum([
  'FULLY_VISIBLE',
  'HASH_COMMITTED_HIDDEN',
  'REVEALED_AND_COMMITMENT_VERIFIED',
  'TAPROOT_OUTPUT_KEY_ONLY',
  'TAPROOT_SPEND_OBSERVED',
  'UNSUPPORTED_SCRIPT',
]);
