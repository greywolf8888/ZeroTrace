import { z } from 'zod';
export * from './part-06.js';
import type { Evidence, KnowledgeValue } from './part-06.js';
import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  ConfidenceSchema,
  EntityRelationshipTimelineCoreSchema,
  EntityResolutionClassSchema,
  EvidenceSchema,
  Hash256Schema,
  LedgerSchema,
  SubjectTypeSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-06.js';

export type EntityRelationshipTimelineCore = z.infer<typeof EntityRelationshipTimelineCoreSchema>;

export const EntityRelationshipTimelineReportSchema = z
  .object({
    schemaVersion: z.literal('entity-relationship-timeline-report-v1'),
    automaticOwnershipMergeAllowed: z.literal(false),
    timeline: EntityRelationshipTimelineCoreSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidence: z.array(EvidenceSchema).min(3).max(1_001),
  })
  .strict()
  .superRefine((value, context) => {
    const latest = value.timeline.observations.at(-1);
    if (latest === undefined) return;
    const position =
      latest.snapshot.ledger === 'EVM'
        ? { value: latest.snapshot.blockNumber, finality: latest.snapshot.finality }
        : latest.snapshot.ledger === 'BITCOIN'
          ? { value: latest.snapshot.height, finality: latest.snapshot.finality }
          : { value: latest.snapshot.slot, finality: latest.snapshot.commitment };
    const expectedEvidenceIds = [
      ...value.timeline.metadata.evidenceIds,
      value.terminalEvidenceId,
    ].sort();
    const evidenceIds = value.evidence.map((item) => item.id);
    const terminal = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    const expectedLocator = `entity-relationship-timeline:${value.timeline.request.subjectA}:${value.timeline.request.subjectB}:${value.timeline.request.fromPosition}:${value.timeline.request.toPosition}`;
    const issues =
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
        const observationPosition =
          observation.snapshot.ledger === 'EVM'
            ? { value: observation.snapshot.blockNumber, finality: observation.snapshot.finality }
            : observation.snapshot.ledger === 'BITCOIN'
              ? { value: observation.snapshot.height, finality: observation.snapshot.finality }
              : { value: observation.snapshot.slot, finality: observation.snapshot.commitment };
        return (
          evidence?.source !== 'zerotrace:entity-v0.1.0' ||
          evidence.blockOrSlot !== observationPosition.value ||
          evidence.finality !== observationPosition.finality
        );
      }) ||
      terminal?.kind !== 'DERIVED_FEATURE' ||
      terminal.source !== 'zerotrace:entity-timeline-v0.1.0' ||
      terminal.locator !== expectedLocator ||
      terminal.blockOrSlot !== position.value ||
      terminal.finality !== position.finality;
    if (issues) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message:
          'Entity relationship timeline reports require complete per-observation terminal Evidence and one latest-Snapshot timeline derivation.',
      });
    }
  });
export type EntityRelationshipTimelineReport = z.infer<
  typeof EntityRelationshipTimelineReportSchema
>;

export const EntityInvestigationGraphRelationSchema = z.enum([
  'SAME_CONTROLLER',
  'COORDINATED_WITH',
]);
export type EntityInvestigationGraphRelation = z.infer<
  typeof EntityInvestigationGraphRelationSchema
>;

export const EntityInvestigationGraphProjectionStateSchema = z.enum([
  'PROJECTED',
  'SERVICE_SUPPRESSED',
  'INDEPENDENCE_RETAINED',
  'INFRASTRUCTURE_RETAINED',
  'UNKNOWN_RETAINED',
]);
export type EntityInvestigationGraphProjectionState = z.infer<
  typeof EntityInvestigationGraphProjectionStateSchema
>;

export const EntityInvestigationGraphNodeSchema = z
  .object({
    id: z.string().regex(/^egn_[0-9a-f]{24}$/),
    subjectId: z.string().trim().min(1).max(512),
    subjectType: knowledgeValueSchema(SubjectTypeSchema),
    serviceInfrastructure: knowledgeValueSchema(z.boolean()),
    terminalEvidenceIds: z
      .array(z.string().regex(/^ev_[0-9a-f]{24}$/))
      .min(1)
      .max(250),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subjectType.state === 'known' && value.subjectType.value === 'UNKNOWN') {
      context.addIssue({
        code: 'custom',
        path: ['subjectType'],
        message: 'An unknown subject type must use explicit KnowledgeValue Unknown.',
      });
    }
    if (
      value.terminalEvidenceIds.length !== new Set(value.terminalEvidenceIds).size ||
      value.terminalEvidenceIds.some(
        (item, index) => item !== [...value.terminalEvidenceIds].sort()[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceIds'],
        message: 'Graph node Evidence identities must be unique and canonical.',
      });
    }
  });
export type EntityInvestigationGraphNode = z.infer<typeof EntityInvestigationGraphNodeSchema>;

export const EntityInvestigationGraphObservationSchema = z
  .object({
    timelineId: z.string().regex(/^ert_[0-9a-f]{24}$/),
    timelineResultHash: Hash256Schema,
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    fromPosition: UnsignedQuantityStringSchema,
    toPosition: UnsignedQuantityStringSchema,
    classification: EntityResolutionClassSchema,
    sameControllerProbability: knowledgeValueSchema(ConfidenceSchema),
    coordinationProbability: knowledgeValueSchema(ConfidenceSchema),
    independenceProbability: knowledgeValueSchema(ConfidenceSchema),
    serviceSuppressionApplied: z.boolean(),
    projectionState: EntityInvestigationGraphProjectionStateSchema,
    projectedEdgeId: knowledgeValueSchema(
      z
        .string()
        .regex(/^ege_[0-9a-f]{24}$/)
        .nullable(),
    ),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  })
  .strict()
  .superRefine((value, context) => {
    const hasEdge = value.projectedEdgeId.state === 'known' && value.projectedEdgeId.value !== null;
    if (
      value.subjectA >= value.subjectB ||
      (value.projectionState === 'PROJECTED') !== hasEdge ||
      BigInt(value.fromPosition) > BigInt(value.toPosition)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionState'],
        message:
          'Graph observations require a canonical pair, ordered positions, and an edge only for projected relationships.',
      });
    }
  });
export type EntityInvestigationGraphObservation = z.infer<
  typeof EntityInvestigationGraphObservationSchema
>;

export const EntityInvestigationGraphEdgeSchema = z
  .object({
    id: z.string().regex(/^ege_[0-9a-f]{24}$/),
    relation: EntityInvestigationGraphRelationSchema,
    sourceNodeId: z.string().regex(/^egn_[0-9a-f]{24}$/),
    targetNodeId: z.string().regex(/^egn_[0-9a-f]{24}$/),
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    classification: EntityResolutionClassSchema,
    sameControllerProbability: knowledgeValueSchema(ConfidenceSchema),
    coordinationProbability: knowledgeValueSchema(ConfidenceSchema),
    independenceProbability: knowledgeValueSchema(ConfidenceSchema),
    validFromPosition: UnsignedQuantityStringSchema,
    validToPosition: UnsignedQuantityStringSchema,
    observationCount: z.number().int().min(2).max(1_000),
    classificationChangeCount: z.number().int().nonnegative(),
    temporalContinuity: knowledgeValueSchema(z.boolean()),
    timelineId: z.string().regex(/^ert_[0-9a-f]{24}$/),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    automaticOwnershipPropagationAllowed: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const sameControllerClasses = new Set([
      'CONFIRMED_SAME_CONTROLLER',
      'HIGHLY_PROBABLE_SAME_CONTROLLER',
      'PROBABLE_SAME_CONTROLLER',
    ]);
    const classificationMatchesRelation =
      value.relation === 'SAME_CONTROLLER'
        ? sameControllerClasses.has(value.classification)
        : value.classification === 'COORDINATED_BUT_INDEPENDENT';
    if (
      value.sourceNodeId === value.targetNodeId ||
      value.subjectA >= value.subjectB ||
      BigInt(value.validFromPosition) > BigInt(value.validToPosition) ||
      !classificationMatchesRelation
    ) {
      context.addIssue({
        code: 'custom',
        path: ['relation'],
        message:
          'Graph edges require distinct canonical endpoints, valid positions, and a classification-compatible relationship.',
      });
    }
  });
export type EntityInvestigationGraphEdge = z.infer<typeof EntityInvestigationGraphEdgeSchema>;

export const EntityInvestigationComponentSchema = z
  .object({
    id: z.string().regex(/^igc_[0-9a-f]{24}$/),
    nodeIds: z
      .array(z.string().regex(/^egn_[0-9a-f]{24}$/))
      .min(1)
      .max(500),
    edgeIds: z.array(z.string().regex(/^ege_[0-9a-f]{24}$/)).max(250),
    automaticEntityMembershipAllowed: z.literal(false),
    membershipConclusion: knowledgeValueSchema(z.enum(['COMMON_CONTROL', 'COORDINATION_GROUP'])),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.membershipConclusion.state === 'known' ||
      value.nodeIds.length !== new Set(value.nodeIds).size ||
      value.edgeIds.length !== new Set(value.edgeIds).size ||
      value.nodeIds.some((item, index) => item !== [...value.nodeIds].sort()[index]) ||
      value.edgeIds.some((item, index) => item !== [...value.edgeIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['membershipConclusion'],
        message:
          'Investigation components are canonical navigation groups and never known Entity membership conclusions.',
      });
    }
  });
export type EntityInvestigationComponent = z.infer<typeof EntityInvestigationComponentSchema>;

export const EntityInvestigationGraphCoreSchema = z
  .object({
    request: z
      .object({
        ledger: LedgerSchema,
        chainId: z.string().trim().min(1).max(128),
        timelineIds: z
          .array(z.string().regex(/^ert_[0-9a-f]{24}$/))
          .min(1)
          .max(250),
        timelineSetHash: Hash256Schema,
      })
      .strict(),
    nodes: z.array(EntityInvestigationGraphNodeSchema).min(2).max(500),
    observations: z.array(EntityInvestigationGraphObservationSchema).min(1).max(250),
    edges: z.array(EntityInvestigationGraphEdgeSchema).max(250),
    investigationComponents: z.array(EntityInvestigationComponentSchema).min(1).max(500),
    summary: z
      .object({
        nodeCount: z.number().int().min(2).max(500),
        observationCount: z.number().int().min(1).max(250),
        projectedEdgeCount: z.number().int().nonnegative().max(250),
        sameControllerEdgeCount: z.number().int().nonnegative().max(250),
        coordinationEdgeCount: z.number().int().nonnegative().max(250),
        suppressedObservationCount: z.number().int().nonnegative().max(250),
        componentCount: z.number().int().positive().max(500),
        completeRequestedTimelineSet: z.literal(true),
        rawTransferEdgesCopied: z.literal(false),
      })
      .strict(),
    metadata: AnalysisMetadataSchema.extend({
      snapshot: AnalysisSnapshotSchema,
      modelVersion: z.literal('entity-investigation-graph-v0.1.0'),
    }),
  })
  .strict()
  .superRefine((value, context) => {
    const timelineIds = value.observations.map((item) => item.timelineId).sort();
    const nodeIds = value.nodes.map((item) => item.id);
    const subjects = value.nodes.map((item) => item.subjectId);
    const edgeIds = value.edges.map((item) => item.id);
    const evidenceIds = value.observations.map((item) => item.terminalEvidenceId).sort();
    const componentNodeIds = value.investigationComponents.flatMap((item) => item.nodeIds).sort();
    const componentEdgeIds = value.investigationComponents.flatMap((item) => item.edgeIds).sort();
    const issues =
      value.request.timelineIds.length !== new Set(value.request.timelineIds).size ||
      value.request.timelineIds.some(
        (item, index) => item !== [...value.request.timelineIds].sort()[index],
      ) ||
      value.request.timelineIds.length !== timelineIds.length ||
      value.request.timelineIds.some((item, index) => item !== timelineIds[index]) ||
      nodeIds.length !== new Set(nodeIds).size ||
      subjects.length !== new Set(subjects).size ||
      value.nodes.some((item, index) => index > 0 && subjects[index - 1]! >= item.subjectId) ||
      edgeIds.length !== new Set(edgeIds).size ||
      value.edges.some((edge) => {
        const sourceNode = value.nodes.find((node) => node.id === edge.sourceNodeId);
        const targetNode = value.nodes.find((node) => node.id === edge.targetNodeId);
        const observation = value.observations.find((item) => item.timelineId === edge.timelineId);
        if (sourceNode === undefined || targetNode === undefined || observation === undefined) {
          return true;
        }
        return (
          sourceNode.subjectId !== edge.subjectA ||
          targetNode.subjectId !== edge.subjectB ||
          (sourceNode.serviceInfrastructure.state === 'known' &&
            sourceNode.serviceInfrastructure.value) ||
          (sourceNode.serviceInfrastructure.state === 'unknown' &&
            sourceNode.serviceInfrastructure.reason === 'CONFLICTING_SOURCES') ||
          (targetNode.serviceInfrastructure.state === 'known' &&
            targetNode.serviceInfrastructure.value) ||
          (targetNode.serviceInfrastructure.state === 'unknown' &&
            targetNode.serviceInfrastructure.reason === 'CONFLICTING_SOURCES') ||
          observation.subjectA !== edge.subjectA ||
          observation.subjectB !== edge.subjectB ||
          observation.classification !== edge.classification ||
          JSON.stringify(observation.sameControllerProbability) !==
            JSON.stringify(edge.sameControllerProbability) ||
          JSON.stringify(observation.coordinationProbability) !==
            JSON.stringify(edge.coordinationProbability) ||
          JSON.stringify(observation.independenceProbability) !==
            JSON.stringify(edge.independenceProbability) ||
          observation.terminalEvidenceId !== edge.terminalEvidenceId ||
          observation.toPosition !== edge.validToPosition ||
          BigInt(edge.validFromPosition) < BigInt(observation.fromPosition)
        );
      }) ||
      value.observations.some((observation) => {
        const edge = value.edges.find((item) => item.timelineId === observation.timelineId);
        return observation.projectionState === 'PROJECTED'
          ? edge?.id !==
              (observation.projectedEdgeId.state === 'known'
                ? observation.projectedEdgeId.value
                : undefined)
          : edge !== undefined;
      }) ||
      componentNodeIds.length !== nodeIds.length ||
      componentNodeIds.some((item, index) => item !== [...nodeIds].sort()[index]) ||
      componentEdgeIds.length !== edgeIds.length ||
      componentEdgeIds.some((item, index) => item !== [...edgeIds].sort()[index]) ||
      value.summary.nodeCount !== value.nodes.length ||
      value.summary.observationCount !== value.observations.length ||
      value.summary.projectedEdgeCount !== value.edges.length ||
      value.summary.sameControllerEdgeCount !==
        value.edges.filter((item) => item.relation === 'SAME_CONTROLLER').length ||
      value.summary.coordinationEdgeCount !==
        value.edges.filter((item) => item.relation === 'COORDINATED_WITH').length ||
      value.summary.suppressedObservationCount !==
        value.observations.filter((item) => item.projectionState !== 'PROJECTED').length ||
      value.summary.componentCount !== value.investigationComponents.length ||
      value.metadata.evidenceIds.length !== evidenceIds.length ||
      value.metadata.evidenceIds.some((item, index) => item !== evidenceIds[index]);
    if (issues) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message:
          'Investigation graphs require an exact requested timeline set, canonical nodes and edges, service-safe projection, complete components, and terminal Evidence references.',
      });
    }
  });
export type EntityInvestigationGraphCore = z.infer<typeof EntityInvestigationGraphCoreSchema>;

export const EntityInvestigationGraphReportSchema = z
  .object({
    schemaVersion: z.literal('entity-investigation-graph-report-v1'),
    sourceOfTruth: z.literal('DURABLE_ENTITY_RELATIONSHIP_TIMELINES'),
    automaticOwnershipMergeAllowed: z.literal(false),
    graph: EntityInvestigationGraphCoreSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidence: z.array(EvidenceSchema).min(2).max(251),
  })
  .strict()
  .superRefine((value, context) => {
    const snapshot = value.graph.metadata.snapshot;
    const position =
      snapshot.ledger === 'EVM'
        ? { value: snapshot.blockNumber, finality: snapshot.finality }
        : snapshot.ledger === 'BITCOIN'
          ? { value: snapshot.height, finality: snapshot.finality }
          : { value: snapshot.slot, finality: snapshot.commitment };
    const expectedEvidenceIds = [
      ...value.graph.metadata.evidenceIds,
      value.terminalEvidenceId,
    ].sort();
    const evidenceIds = value.evidence.map((item) => item.id);
    const terminal = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    const expectedLocator = `entity-investigation-graph:${value.graph.request.ledger}:${value.graph.request.chainId}:${position.value}:${value.graph.request.timelineSetHash}`;
    const issues =
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((item, index) => item !== [...evidenceIds].sort()[index]) ||
      evidenceIds.length !== expectedEvidenceIds.length ||
      evidenceIds.some((item, index) => item !== expectedEvidenceIds[index]) ||
      value.evidence.some(
        (item) =>
          item.ledger !== value.graph.request.ledger ||
          item.chainId !== value.graph.request.chainId,
      ) ||
      terminal?.kind !== 'DERIVED_FEATURE' ||
      terminal.source !== 'zerotrace:entity-investigation-graph-v0.1.0' ||
      terminal.locator !== expectedLocator ||
      terminal.blockOrSlot !== position.value ||
      terminal.finality !== position.finality;
    if (issues) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message:
          'Investigation graph reports require every timeline terminal Evidence node and one exact-Snapshot graph derivation.',
      });
    }
  });
export type EntityInvestigationGraphReport = z.infer<typeof EntityInvestigationGraphReportSchema>;

export const EntityInvestigationGraphTimelinePairStateSchema = z
  .object({
    timelineId: z.string().regex(/^ert_[0-9a-f]{24}$/),
    classification: EntityResolutionClassSchema,
    sameControllerProbability: knowledgeValueSchema(ConfidenceSchema),
    coordinationProbability: knowledgeValueSchema(ConfidenceSchema),
    independenceProbability: knowledgeValueSchema(ConfidenceSchema),
    serviceSuppressionApplied: z.boolean(),
    projectionState: EntityInvestigationGraphProjectionStateSchema,
    relation: knowledgeValueSchema(EntityInvestigationGraphRelationSchema.nullable()),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    automaticOwnershipPropagationAllowed: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const projectedRelation = value.relation.state === 'known' ? value.relation.value : undefined;
    const validProjection =
      value.projectionState === 'PROJECTED'
        ? projectedRelation === 'SAME_CONTROLLER' || projectedRelation === 'COORDINATED_WITH'
        : projectedRelation === null;
    const validClassification =
      projectedRelation === 'SAME_CONTROLLER'
        ? [
            'CONFIRMED_SAME_CONTROLLER',
            'HIGHLY_PROBABLE_SAME_CONTROLLER',
            'PROBABLE_SAME_CONTROLLER',
          ].includes(value.classification)
        : projectedRelation === 'COORDINATED_WITH'
          ? value.classification === 'COORDINATED_BUT_INDEPENDENT'
          : true;
    if (!validProjection || !validClassification) {
      context.addIssue({
        code: 'custom',
        path: ['relation'],
        message:
          'A temporal pair state must preserve the graph projection state and its classification-compatible relation.',
      });
    }
  });
export type EntityInvestigationGraphTimelinePairState = z.infer<
  typeof EntityInvestigationGraphTimelinePairStateSchema
>;

export const EntityInvestigationGraphTimelinePairObservationSchema = z
  .object({
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    state: EntityInvestigationGraphTimelinePairStateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subjectA >= value.subjectB) {
      context.addIssue({
        code: 'custom',
        path: ['subjectA'],
        message: 'Temporal graph pair observations require a canonical distinct subject pair.',
      });
    }
  });
export type EntityInvestigationGraphTimelinePairObservation = z.infer<
  typeof EntityInvestigationGraphTimelinePairObservationSchema
>;

export const EntityInvestigationGraphTimelinePairKnowledgeSchema = knowledgeValueSchema(
  EntityInvestigationGraphTimelinePairStateSchema,
);
