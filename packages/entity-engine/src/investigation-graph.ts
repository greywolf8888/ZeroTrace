import { hashPayload } from '@zerotrace/evidence';
import {
  EntityInvestigationGraphCoreSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type EntityInvestigationComponent,
  type EntityInvestigationGraphCore,
  type EntityInvestigationGraphEdge,
  type EntityInvestigationGraphNode,
  type EntityInvestigationGraphObservation,
  type EntityInvestigationGraphProjectionState,
  type EntityInvestigationGraphRelation,
  type EntityRelationshipTimelineCore,
  type KnowledgeValue,
  type SubjectType,
} from '@zerotrace/schemas';

export const ENTITY_INVESTIGATION_GRAPH_MODEL_VERSION =
  'entity-investigation-graph-v0.1.0' as const;

export interface EntityInvestigationGraphTimelineSource {
  timelineId: string;
  resultHash: string;
  terminalEvidenceId: string;
  timeline: EntityRelationshipTimelineCore;
  subjectAType?: KnowledgeValue<SubjectType>;
  subjectBType?: KnowledgeValue<SubjectType>;
  subjectAIsService?: boolean;
  subjectBIsService?: boolean;
}

export interface BuildEntityInvestigationGraphInput {
  sources: readonly EntityInvestigationGraphTimelineSource[];
}

interface SubjectObservation {
  subjectType?: KnowledgeValue<SubjectType>;
  isService?: boolean;
  terminalEvidenceId: string;
}

function nodeId(ledger: string, chainId: string, subjectId: string): string {
  return `egn_${hashPayload({ ledger, chainId, subjectId }).slice(0, 24)}`;
}

function edgeId(timelineId: string, relation: EntityInvestigationGraphRelation): string {
  return `ege_${hashPayload({ timelineId, relation }).slice(0, 24)}`;
}

function componentId(nodeIds: readonly string[], edgeIds: readonly string[]): string {
  return `igc_${hashPayload({ nodeIds, edgeIds }).slice(0, 24)}`;
}

function relationForClassification(
  classification: EntityRelationshipTimelineCore['summary']['currentClassification'],
): EntityInvestigationGraphRelation | undefined {
  if (
    classification === 'CONFIRMED_SAME_CONTROLLER' ||
    classification === 'HIGHLY_PROBABLE_SAME_CONTROLLER' ||
    classification === 'PROBABLE_SAME_CONTROLLER'
  ) {
    return 'SAME_CONTROLLER';
  }
  return classification === 'COORDINATED_BUT_INDEPENDENT' ? 'COORDINATED_WITH' : undefined;
}

function projectionState(
  timeline: EntityRelationshipTimelineCore,
  endpointIsService: boolean,
): EntityInvestigationGraphProjectionState {
  if (
    endpointIsService ||
    timeline.summary.currentClassification === 'SERVICE_INFRASTRUCTURE' ||
    timeline.observations.at(-1)?.serviceSuppressionApplied === true
  ) {
    return 'SERVICE_SUPPRESSED';
  }
  if (relationForClassification(timeline.summary.currentClassification) !== undefined) {
    return 'PROJECTED';
  }
  if (timeline.summary.currentClassification === 'LIKELY_INDEPENDENT') {
    return 'INDEPENDENCE_RETAINED';
  }
  if (timeline.summary.currentClassification === 'BOT_MM_ARBITRAGE') {
    return 'INFRASTRUCTURE_RETAINED';
  }
  return 'UNKNOWN_RETAINED';
}

function subjectType(
  observations: readonly SubjectObservation[],
): EntityInvestigationGraphNode['subjectType'] {
  const knownTypes = [
    ...new Set(
      observations.flatMap((item) =>
        item.subjectType?.state === 'known' ? [item.subjectType.value] : [],
      ),
    ),
  ];
  if (knownTypes.length === 1 && knownTypes[0] !== 'UNKNOWN') {
    return knownValue(knownTypes[0] as Exclude<SubjectType, 'UNKNOWN'>);
  }
  return unknownValue(
    knownTypes.length > 1 ? 'CONFLICTING_SOURCES' : 'INSUFFICIENT_DATA',
    knownTypes.length > 1
      ? 'Timeline sources disagree on the subject type.'
      : 'Relationship timelines do not establish whether this subject is an address, account, wallet, cluster, or Entity.',
  );
}

function serviceInfrastructure(
  observations: readonly SubjectObservation[],
): EntityInvestigationGraphNode['serviceInfrastructure'] {
  const stated = observations.flatMap((item) =>
    item.isService === undefined ? [] : [item.isService],
  );
  if (stated.includes(true) && stated.includes(false)) {
    return unknownValue('CONFLICTING_SOURCES', 'Timeline sources disagree on service status.');
  }
  if (stated.includes(true)) return knownValue(true);
  if (stated.length === observations.length && stated.every((item) => !item)) {
    return knownValue(false);
  }
  return unknownValue(
    'INSUFFICIENT_DATA',
    'No complete Evidence-backed service-infrastructure assessment is available.',
  );
}

function requiresServiceSuppression(node: EntityInvestigationGraphNode): boolean {
  return (
    (node.serviceInfrastructure.state === 'known' && node.serviceInfrastructure.value) ||
    (node.serviceInfrastructure.state === 'unknown' &&
      node.serviceInfrastructure.reason === 'CONFLICTING_SOURCES')
  );
}

function buildComponents(
  nodes: readonly EntityInvestigationGraphNode[],
  edges: readonly EntityInvestigationGraphEdge[],
): EntityInvestigationComponent[] {
  const adjacency = new Map<string, Set<string>>(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId);
    adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId);
  }
  const visited = new Set<string>();
  const components: EntityInvestigationComponent[] = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const queue = [node.id];
    const nodeIds: string[] = [];
    visited.add(node.id);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      nodeIds.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    nodeIds.sort();
    const nodeSet = new Set(nodeIds);
    const edgeIds = edges
      .filter((edge) => nodeSet.has(edge.sourceNodeId) && nodeSet.has(edge.targetNodeId))
      .map((edge) => edge.id)
      .sort();
    components.push({
      id: componentId(nodeIds, edgeIds),
      nodeIds,
      edgeIds,
      automaticEntityMembershipAllowed: false,
      membershipConclusion: unknownValue(
        'INSUFFICIENT_DATA',
        'Connectivity is an investigation aid, not an Entity membership or ownership conclusion.',
      ),
    });
  }
  return components.sort((left, right) => left.id.localeCompare(right.id));
}

function minimum(
  sources: readonly EntityInvestigationGraphTimelineSource[],
  field: keyof Pick<
    AnalysisMetadata,
    'dataCoverage' | 'sourceCoverage' | 'historyCoverage' | 'simulationCoverage' | 'confidence'
  >,
): number {
  return Math.min(...sources.map((source) => source.timeline.metadata[field] as number));
}

function conservativeFreshness(
  sources: readonly EntityInvestigationGraphTimelineSource[],
): AnalysisMetadata['freshness'] {
  const values = sources.map((source) => source.timeline.metadata.freshness);
  if (values.some((value) => value === null)) return null;
  return (values as string[]).sort()[0] ?? null;
}

export function buildEntityInvestigationGraph(
  input: BuildEntityInvestigationGraphInput,
): EntityInvestigationGraphCore {
  if (input.sources.length < 1 || input.sources.length > 250) {
    throw new Error('Investigation graphs require between 1 and 250 relationship timelines.');
  }
  const sources = [...input.sources].sort((left, right) => {
    const leftPair = `${left.timeline.request.subjectA}\u0000${left.timeline.request.subjectB}`;
    const rightPair = `${right.timeline.request.subjectA}\u0000${right.timeline.request.subjectB}`;
    return leftPair.localeCompare(rightPair) || left.timelineId.localeCompare(right.timelineId);
  });
  const first = sources[0] as EntityInvestigationGraphTimelineSource;
  const ledger = first.timeline.request.ledger;
  const chainId = first.timeline.request.chainId;
  const snapshotHash = hashPayload(first.timeline.metadata.snapshot);
  const pairKeys = sources.map(
    (source) => `${source.timeline.request.subjectA}\u0000${source.timeline.request.subjectB}`,
  );
  const timelineIds = sources.map((source) => source.timelineId).sort();
  if (
    new Set(pairKeys).size !== pairKeys.length ||
    new Set(timelineIds).size !== timelineIds.length ||
    sources.some(
      (source) =>
        source.timeline.request.ledger !== ledger ||
        source.timeline.request.chainId !== chainId ||
        hashPayload(source.timeline.metadata.snapshot) !== snapshotHash ||
        source.timeline.observations.at(-1)?.reportId === undefined ||
        source.timeline.request.subjectA >= source.timeline.request.subjectB,
    )
  ) {
    throw new Error(
      'Investigation graph timelines require unique canonical pairs on one exact ledger Snapshot.',
    );
  }

  const bySubject = new Map<string, SubjectObservation[]>();
  for (const source of sources) {
    const terminalEvidenceId = source.terminalEvidenceId;
    if (!/^ev_[0-9a-f]{24}$/.test(terminalEvidenceId)) {
      throw new Error('Investigation graph timelines require terminal timeline Evidence.');
    }
    const subjectA = source.timeline.request.subjectA;
    const subjectB = source.timeline.request.subjectB;
    bySubject.set(subjectA, [
      ...(bySubject.get(subjectA) ?? []),
      {
        ...(source.subjectAType === undefined ? {} : { subjectType: source.subjectAType }),
        ...(source.subjectAIsService === undefined ? {} : { isService: source.subjectAIsService }),
        terminalEvidenceId,
      },
    ]);
    bySubject.set(subjectB, [
      ...(bySubject.get(subjectB) ?? []),
      {
        ...(source.subjectBType === undefined ? {} : { subjectType: source.subjectBType }),
        ...(source.subjectBIsService === undefined ? {} : { isService: source.subjectBIsService }),
        terminalEvidenceId,
      },
    ]);
  }

  const nodes = [...bySubject.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([subjectId, observations]) => ({
      id: nodeId(ledger, chainId, subjectId),
      subjectId,
      subjectType: subjectType(observations),
      serviceInfrastructure: serviceInfrastructure(observations),
      terminalEvidenceIds: [...new Set(observations.map((item) => item.terminalEvidenceId))].sort(),
    }));
  const nodesBySubject = new Map(nodes.map((node) => [node.subjectId, node]));

  const observations: EntityInvestigationGraphObservation[] = [];
  const edges: EntityInvestigationGraphEdge[] = [];
  for (const source of sources) {
    const timeline = source.timeline;
    const latest = timeline.observations.at(-1);
    if (latest === undefined) throw new Error('Investigation graph timeline is empty.');
    const sourceNode = nodesBySubject.get(timeline.request.subjectA);
    const targetNode = nodesBySubject.get(timeline.request.subjectB);
    if (sourceNode === undefined || targetNode === undefined) {
      throw new Error('Investigation graph endpoint node is missing.');
    }
    const endpointIsService = [sourceNode, targetNode].some(requiresServiceSuppression);
    const state = projectionState(timeline, endpointIsService);
    const relation = relationForClassification(timeline.summary.currentClassification);
    const projectedEdgeId =
      state === 'PROJECTED' && relation !== undefined ? edgeId(source.timelineId, relation) : null;
    observations.push({
      timelineId: source.timelineId,
      timelineResultHash: source.resultHash,
      subjectA: timeline.request.subjectA,
      subjectB: timeline.request.subjectB,
      fromPosition: timeline.request.fromPosition,
      toPosition: timeline.request.toPosition,
      classification: timeline.summary.currentClassification,
      sameControllerProbability: timeline.summary.currentSameControllerProbability,
      coordinationProbability: timeline.summary.currentCoordinationProbability,
      independenceProbability: timeline.summary.currentIndependenceProbability,
      serviceSuppressionApplied: latest.serviceSuppressionApplied,
      projectionState: state,
      projectedEdgeId: knownValue(projectedEdgeId),
      terminalEvidenceId: source.terminalEvidenceId,
    });
    if (projectedEdgeId === null || relation === undefined) continue;
    let relationStartIndex = timeline.observations.length - 1;
    while (relationStartIndex > 0) {
      const previous = timeline.observations[relationStartIndex - 1];
      if (
        previous === undefined ||
        previous.serviceSuppressionApplied ||
        relationForClassification(previous.classification) !== relation
      ) {
        break;
      }
      relationStartIndex -= 1;
    }
    const validFromSnapshot = timeline.observations[relationStartIndex]?.snapshot;
    const validFromPosition =
      validFromSnapshot?.ledger === 'EVM'
        ? validFromSnapshot.blockNumber
        : validFromSnapshot?.ledger === 'BITCOIN'
          ? validFromSnapshot.height
          : validFromSnapshot?.slot;
    if (validFromPosition === undefined) {
      throw new Error('Investigation graph edge validity is unavailable.');
    }
    edges.push({
      id: projectedEdgeId,
      relation,
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      subjectA: timeline.request.subjectA,
      subjectB: timeline.request.subjectB,
      classification: timeline.summary.currentClassification,
      sameControllerProbability: timeline.summary.currentSameControllerProbability,
      coordinationProbability: timeline.summary.currentCoordinationProbability,
      independenceProbability: timeline.summary.currentIndependenceProbability,
      validFromPosition,
      validToPosition: timeline.request.toPosition,
      observationCount: timeline.summary.observationCount,
      classificationChangeCount: timeline.summary.classificationChangeCount,
      temporalContinuity: timeline.summary.chainObservationContinuity,
      timelineId: source.timelineId,
      terminalEvidenceId: source.terminalEvidenceId,
      automaticOwnershipPropagationAllowed: false,
    });
  }
  observations.sort((left, right) => left.timelineId.localeCompare(right.timelineId));
  edges.sort((left, right) => left.id.localeCompare(right.id));
  const investigationComponents = buildComponents(nodes, edges);
  const evidenceIds = observations.map((item) => item.terminalEvidenceId).sort();
  const sourceSet = [
    ...new Set(sources.flatMap((source) => source.timeline.metadata.sourceSet)),
  ].sort();

  return EntityInvestigationGraphCoreSchema.parse({
    request: {
      ledger,
      chainId,
      timelineIds,
      timelineSetHash: hashPayload(timelineIds),
    },
    nodes,
    observations,
    edges,
    investigationComponents,
    summary: {
      nodeCount: nodes.length,
      observationCount: observations.length,
      projectedEdgeCount: edges.length,
      sameControllerEdgeCount: edges.filter((edge) => edge.relation === 'SAME_CONTROLLER').length,
      coordinationEdgeCount: edges.filter((edge) => edge.relation === 'COORDINATED_WITH').length,
      suppressedObservationCount: observations.filter(
        (observation) => observation.projectionState !== 'PROJECTED',
      ).length,
      componentCount: investigationComponents.length,
      completeRequestedTimelineSet: true,
      rawTransferEdgesCopied: false,
    },
    metadata: {
      snapshot: first.timeline.metadata.snapshot,
      dataCoverage: minimum(sources, 'dataCoverage'),
      sourceCoverage: minimum(sources, 'sourceCoverage'),
      historyCoverage: minimum(sources, 'historyCoverage'),
      simulationCoverage: minimum(sources, 'simulationCoverage'),
      freshness: conservativeFreshness(sources),
      sourceSet,
      modelVersion: ENTITY_INVESTIGATION_GRAPH_MODEL_VERSION,
      confidence: minimum(sources, 'confidence'),
      evidenceIds,
    },
  });
}

export interface EntityInvestigationSubgraph {
  seedSubjectId: string;
  maxDepth: number;
  maxNodes: number;
  truncated: boolean;
  distances: Readonly<Record<string, number>>;
  nodes: readonly EntityInvestigationGraphNode[];
  edges: readonly EntityInvestigationGraphEdge[];
  observations: readonly EntityInvestigationGraphObservation[];
}

export function traverseEntityInvestigationGraph(
  graph: EntityInvestigationGraphCore,
  input: { seedSubjectId: string; maxDepth?: number; maxNodes?: number },
): EntityInvestigationSubgraph {
  const maxDepth = input.maxDepth ?? 2;
  const maxNodes = input.maxNodes ?? 100;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 3) {
    throw new Error('Investigation graph traversal depth must be between 0 and 3.');
  }
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 200) {
    throw new Error('Investigation graph traversal node limit must be between 1 and 200.');
  }
  const seed = graph.nodes.find((node) => node.subjectId === input.seedSubjectId);
  if (seed === undefined) throw new Error('Investigation graph seed subject was not found.');
  const adjacency = new Map<string, Set<string>>(
    graph.nodes.map((node) => [node.id, new Set<string>()]),
  );
  for (const edge of graph.edges) {
    adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId);
    adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId);
  }
  const queue: Array<{ id: string; depth: number }> = [{ id: seed.id, depth: 0 }];
  const distances = new Map<string, number>([[seed.id, 0]]);
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current.depth >= maxDepth) continue;
    for (const neighbor of [...(adjacency.get(current.id) ?? [])].sort()) {
      if (distances.has(neighbor)) continue;
      if (distances.size >= maxNodes) {
        truncated = true;
        continue;
      }
      distances.set(neighbor, current.depth + 1);
      queue.push({ id: neighbor, depth: current.depth + 1 });
    }
  }
  const included = new Set(distances.keys());
  const nodes = graph.nodes.filter((node) => included.has(node.id));
  const subjectIds = new Set(nodes.map((node) => node.subjectId));
  const edges = graph.edges.filter(
    (edge) => included.has(edge.sourceNodeId) && included.has(edge.targetNodeId),
  );
  const observations = graph.observations.filter(
    (observation) => subjectIds.has(observation.subjectA) || subjectIds.has(observation.subjectB),
  );
  return {
    seedSubjectId: input.seedSubjectId,
    maxDepth,
    maxNodes,
    truncated,
    distances: Object.fromEntries([...distances.entries()].sort()),
    nodes,
    edges,
    observations,
  };
}
