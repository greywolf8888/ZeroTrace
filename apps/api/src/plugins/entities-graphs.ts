import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ENTITY_INVESTIGATION_GRAPH_MODEL_VERSION,
  ENTITY_INVESTIGATION_GRAPH_TIMELINE_MODEL_VERSION,
  buildEntityInvestigationGraph,
  buildEntityInvestigationGraphTimeline,
  traverseEntityInvestigationGraph,
} from '@zerotrace/entity-engine';
import { hashPayload } from '@zerotrace/evidence';
import {
  AgeInvestigationGraphProjectionError,
  type AgeInvestigationGraphProjectionResult,
} from '@zerotrace/storage';
import {
  EntityInvestigationGraphReportSchema,
  EntityInvestigationGraphTimelineReportSchema,
  knownValue,
  unavailableValue,
  type Evidence,
  type KnowledgeValue,
} from '@zerotrace/schemas';
import {
  EntityInvestigationGraphMaterializeSchema,
  EntityInvestigationGraphQuerySchema,
  EntityInvestigationGraphParamsSchema,
  EntityInvestigationGraphTimelineMaterializeSchema,
  EntityInvestigationGraphTimelineQuerySchema,
  EntityInvestigationGraphTimelineParamsSchema,
} from '../http/request-schemas.js';
import { errorResponse, addDerivedAnalysisEvidence } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export async function registerEntityGraphRoutes(
  app: FastifyInstance,
  ctx: AppHttpContext,
): Promise<void> {
  const {
    runtime,
    config,
    providerHealth,
    storageHealth,
    ingestionStorageHealth,
    dataQualityHealth,
    graphProjectionHealth,
  } = ctx;
  app.post(
    '/api/v1/entities/investigation-graphs/materialize',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphMaterializeSchema.parse(request.body);
      if (
        runtime.evidenceRepository === undefined ||
        runtime.entityRelationshipReports === undefined ||
        runtime.entityRelationshipTimelines === undefined ||
        runtime.entityInvestigationGraphs === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
              'Durable Evidence, relationship reports, timelines, and graph report storage are required.',
              false,
            ),
          );
      }
      const timelineIds = [...input.timelineIds].sort();
      const records = await Promise.all(
        timelineIds.map((timelineId) => runtime.entityRelationshipTimelines?.get(timelineId)),
      );
      const missingTimelineIds = timelineIds.filter((_, index) => records[index] === undefined);
      if (missingTimelineIds.length > 0) {
        return reply.code(404).send({
          ...errorResponse(
            request,
            'ENTITY_RELATIONSHIP_TIMELINE_NOT_FOUND',
            'At least one requested durable relationship timeline was not found.',
            false,
          ),
          timelineIds: missingTimelineIds,
        });
      }
      const storedTimelines = records.map((record) => record!);
      if (
        storedTimelines.some(
          (record) => record.ledger !== input.ledger || record.chainId !== input.chainId,
        )
      ) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_IDENTITY_MISMATCH',
              'Every requested timeline must use the requested ledger and chain.',
              false,
            ),
          );
      }
      const snapshotHashes = new Set(
        storedTimelines.map((record) => hashPayload(record.report.timeline.metadata.snapshot)),
      );
      if (snapshotHashes.size !== 1) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_SNAPSHOT_MISMATCH',
              'Every requested timeline must terminate at the same exact Snapshot.',
              false,
            ),
          );
      }
      const relationshipPairs = storedTimelines.map(
        (record) => `${record.subjectA}\u0000${record.subjectB}`,
      );
      if (new Set(relationshipPairs).size !== relationshipPairs.length) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_DUPLICATE_PAIR',
              'An investigation graph may include only one timeline for each canonical subject pair.',
              false,
            ),
          );
      }
      const latestRelationshipReports = await Promise.all(
        storedTimelines.map((record) => {
          const latestReportId = record.report.timeline.observations.at(-1)?.reportId;
          return latestReportId === undefined
            ? undefined
            : runtime.entityRelationshipReports?.get(latestReportId);
        }),
      );
      if (latestRelationshipReports.some((record) => record === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_RELATIONSHIP_REPORT_INCOMPLETE',
              'A timeline terminal relationship report is unavailable.',
              true,
            ),
          );
      }
      const terminalEvidenceIds = storedTimelines.map((record) => record.terminalEvidenceId).sort();
      const terminalNodes = await Promise.all(
        terminalEvidenceIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
      );
      if (terminalNodes.some((node) => node === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_EVIDENCE_INCOMPLETE',
              'A relationship timeline terminal Evidence node is unavailable.',
              true,
            ),
          );
      }
      const graph = buildEntityInvestigationGraph({
        sources: storedTimelines.map((record, index) => {
          const relationship = latestRelationshipReports[index]!;
          return {
            timelineId: record.id,
            resultHash: record.resultHash,
            terminalEvidenceId: record.terminalEvidenceId,
            timeline: record.report.timeline,
            ...(relationship.report.input.subjectAIsService === undefined
              ? {}
              : { subjectAIsService: relationship.report.input.subjectAIsService }),
            ...(relationship.report.input.subjectBIsService === undefined
              ? {}
              : { subjectBIsService: relationship.report.input.subjectBIsService }),
          };
        }),
      });
      const snapshot = graph.metadata.snapshot;
      const graphPosition =
        snapshot.ledger === 'EVM'
          ? snapshot.blockNumber
          : snapshot.ledger === 'BITCOIN'
            ? snapshot.height
            : snapshot.slot;
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        snapshot,
        terminalEvidenceIds,
        `zerotrace:${ENTITY_INVESTIGATION_GRAPH_MODEL_VERSION}`,
        `entity-investigation-graph:${graph.request.ledger}:${graph.request.chainId}:${graphPosition}:${graph.request.timelineSetHash}`,
        { graph },
        'Exact-Snapshot investigation graph projection with distinct controller, coordination, service-suppression, negative, and Unknown semantics.',
      );
      const evidence = [...terminalNodes.map((node) => node?.evidence as Evidence), derived].sort(
        (left, right) => left.id.localeCompare(right.id),
      );
      const report = EntityInvestigationGraphReportSchema.parse({
        schemaVersion: 'entity-investigation-graph-report-v1',
        sourceOfTruth: 'DURABLE_ENTITY_RELATIONSHIP_TIMELINES',
        automaticOwnershipMergeAllowed: false,
        graph,
        terminalEvidenceId: derived.id,
        evidence,
      });
      const stored = await runtime.entityInvestigationGraphs.put(report);
      let ageProjection: KnowledgeValue<AgeInvestigationGraphProjectionResult>;
      if (runtime.ageInvestigationGraphProjection === undefined) {
        ageProjection = unavailableValue(
          'PROVIDER_UNCONFIGURED',
          'AGE_URL is absent; the authoritative PostgreSQL graph report remains available.',
        );
      } else {
        try {
          ageProjection = knownValue(await runtime.ageInvestigationGraphProjection.project(stored));
        } catch (error) {
          const reason =
            error instanceof AgeInvestigationGraphProjectionError
              ? error.code === 'AGE_PROJECTION_NOT_INITIALIZED'
                ? 'EXECUTION_BLOCKED'
                : error.code === 'AGE_PROJECTION_CONFLICT'
                  ? 'CONFLICTING_SOURCES'
                  : 'PROVIDER_DOWN'
              : 'PROVIDER_DOWN';
          ageProjection = unavailableValue(
            reason,
            'The optional Apache AGE index was not updated; the authoritative PostgreSQL graph report remains available.',
          );
        }
      }
      return { replayed: false, record: stored, ageProjection };
    },
  );

  app.get(
    '/api/v1/entities/investigation-graphs/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphQuerySchema.parse(request.query);
      const repository = runtime.entityInvestigationGraphs;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
              'Durable Entity investigation graph storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest({
        ledger: input.ledger,
        chainId: input.chainId,
        ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
      });
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_NOT_FOUND',
              'No durable Entity investigation graph exists for this identity.',
              false,
            ),
          );
      }
      const seedSubjectId = input.seedSubjectId ?? input.subjectId;
      if (
        seedSubjectId !== undefined &&
        !record.report.graph.nodes.some((node) => node.subjectId === seedSubjectId)
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_SEED_NOT_FOUND',
              'The traversal seed is not present in this investigation graph.',
              false,
            ),
          );
      }
      return {
        replayed: true,
        record,
        ...(seedSubjectId === undefined
          ? {}
          : {
              subgraph: traverseEntityInvestigationGraph(record.report.graph, {
                seedSubjectId,
                maxDepth: input.maxDepth,
                maxNodes: input.maxNodes,
              }),
            }),
      };
    },
  );

  app.get(
    '/api/v1/entities/investigation-graphs/:graphId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphQuerySchema.parse(request.query);
      const params = EntityInvestigationGraphParamsSchema.parse(request.params);
      const repository = runtime.entityInvestigationGraphs;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
              'Durable Entity investigation graph storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.graphId);
      if (
        record === undefined ||
        record.ledger !== input.ledger ||
        record.chainId !== input.chainId ||
        (input.subjectId !== undefined && !record.subjectIds.includes(input.subjectId))
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_NOT_FOUND',
              'The durable Entity investigation graph was not found for this identity.',
              false,
            ),
          );
      }
      const seedSubjectId = input.seedSubjectId ?? input.subjectId;
      if (
        seedSubjectId !== undefined &&
        !record.report.graph.nodes.some((node) => node.subjectId === seedSubjectId)
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_SEED_NOT_FOUND',
              'The traversal seed is not present in this investigation graph.',
              false,
            ),
          );
      }
      return {
        replayed: true,
        record,
        ...(seedSubjectId === undefined
          ? {}
          : {
              subgraph: traverseEntityInvestigationGraph(record.report.graph, {
                seedSubjectId,
                maxDepth: input.maxDepth,
                maxNodes: input.maxNodes,
              }),
            }),
      };
    },
  );

  app.post(
    '/api/v1/entities/investigation-graph-timelines/materialize',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphTimelineMaterializeSchema.parse(request.body);
      if (
        runtime.evidenceRepository === undefined ||
        runtime.entityInvestigationGraphs === undefined ||
        runtime.entityInvestigationGraphTimelines === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
              'Durable Evidence, investigation graph, and graph timeline storage are required.',
              false,
            ),
          );
      }
      const records = await Promise.all(
        input.graphIds.map((graphId) => runtime.entityInvestigationGraphs?.get(graphId)),
      );
      const missingGraphIds = input.graphIds.filter((_, index) => records[index] === undefined);
      if (missingGraphIds.length > 0) {
        return reply.code(404).send({
          ...errorResponse(
            request,
            'ENTITY_INVESTIGATION_GRAPH_NOT_FOUND',
            'At least one requested durable investigation graph was not found.',
            false,
          ),
          graphIds: missingGraphIds,
        });
      }
      const storedGraphs = records.map((record) => record!);
      if (
        storedGraphs.some(
          (record) => record.ledger !== input.ledger || record.chainId !== input.chainId,
        )
      ) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_IDENTITY_MISMATCH',
              'Every requested investigation graph must use the requested ledger and chain.',
              false,
            ),
          );
      }
      const graphTerminalIds = storedGraphs.map((record) => record.terminalEvidenceId).sort();
      const graphTerminalNodes = await Promise.all(
        graphTerminalIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
      );
      if (graphTerminalNodes.some((node) => node === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_EVIDENCE_INCOMPLETE',
              'An investigation graph terminal Evidence node is unavailable.',
              true,
            ),
          );
      }
      const timeline = buildEntityInvestigationGraphTimeline({
        sources: storedGraphs.map((record) => ({
          graphId: record.id,
          resultHash: record.resultHash,
          terminalEvidenceId: record.terminalEvidenceId,
          graph: record.report.graph,
        })),
      });
      const snapshot = timeline.metadata.snapshot;
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        snapshot,
        timeline.metadata.evidenceIds,
        `zerotrace:${ENTITY_INVESTIGATION_GRAPH_TIMELINE_MODEL_VERSION}`,
        `entity-investigation-graph-timeline:${timeline.request.ledger}:${timeline.request.chainId}:${timeline.request.fromPosition}-${timeline.request.toPosition}:${timeline.request.graphSetHash}`,
        { timeline },
        'Cross-Snapshot investigation graph timeline with explicit continuity, request-scope deltas, and no automatic membership or relationship termination.',
      );
      const evidence = [
        ...graphTerminalNodes.map((node) => node?.evidence as Evidence),
        derived,
      ].sort((left, right) => left.id.localeCompare(right.id));
      const report = EntityInvestigationGraphTimelineReportSchema.parse({
        schemaVersion: 'entity-investigation-graph-timeline-report-v1',
        sourceOfTruth: 'DURABLE_ENTITY_INVESTIGATION_GRAPHS',
        automaticOwnershipMergeAllowed: false,
        automaticEntityMembershipMutationAllowed: false,
        relationshipTerminationInferenceAllowed: false,
        timeline,
        terminalEvidenceId: derived.id,
        evidence,
      });
      const stored = await runtime.entityInvestigationGraphTimelines.put(report);
      return { replayed: false, record: stored };
    },
  );

  app.get(
    '/api/v1/entities/investigation-graph-timelines/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphTimelineQuerySchema.parse(request.query);
      const repository = runtime.entityInvestigationGraphTimelines;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
              'Durable Entity investigation graph timeline storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest({
        ledger: input.ledger,
        chainId: input.chainId,
        ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
      });
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_NOT_FOUND',
              'No durable Entity investigation graph timeline exists for this identity.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/entities/investigation-graph-timelines/:timelineId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphTimelineQuerySchema.parse(request.query);
      const params = EntityInvestigationGraphTimelineParamsSchema.parse(request.params);
      const repository = runtime.entityInvestigationGraphTimelines;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
              'Durable Entity investigation graph timeline storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.timelineId);
      if (
        record === undefined ||
        record.ledger !== input.ledger ||
        record.chainId !== input.chainId ||
        (input.subjectId !== undefined && !record.subjectIds.includes(input.subjectId))
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_NOT_FOUND',
              'The durable Entity investigation graph timeline was not found for this identity.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );
}
