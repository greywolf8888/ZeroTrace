import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { canonicalizeEntityRelationshipInput, ENTITY_RELATIONSHIP_MODEL_VERSION, ENTITY_RELATIONSHIP_TIMELINE_MODEL_VERSION, buildEntityRelationshipTimeline, resolveEntityRelationship } from '@zerotrace/entity-engine';
import { EntityRelationshipInputSchema, EntityRelationshipReportSchema, EntityRelationshipTimelineReportSchema, type Evidence } from '@zerotrace/schemas';
import { EntityRelationshipReportQuerySchema, EntityRelationshipReportParamsSchema, EntityRelationshipTimelineMaterializeSchema, EntityRelationshipTimelineParamsSchema } from '../http/request-schemas.js';
import { errorResponse, rejectUngroundedAnalysis, addDerivedAnalysisEvidence, missingEvidenceIds, incompatibleEvidenceIds, uniqueEvidenceIds, uniqueSourceIds, canonicalSubjectPair } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export async function registerEntityRelationshipRoutes(app: FastifyInstance, ctx: AppHttpContext): Promise<void> {
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
    '/api/v1/entities/resolve',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      let input = canonicalizeEntityRelationshipInput(
        EntityRelationshipInputSchema.parse(request.body),
      );
      if (input.features.length === 0) return resolveEntityRelationship(input);
      const snapshot = input.metadata.snapshot;
      if (snapshot === null) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Entity conclusions with features require a ledger snapshot.',
        );
      }
      if (
        runtime.evidenceRepository === undefined ||
        runtime.entityRelationshipReports === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_STORAGE_REQUIRED',
              'Entity relationship hypotheses require durable Evidence and report storage.',
              false,
            ),
          );
      }
      const sourceEvidenceIds = uniqueEvidenceIds([
        ...input.metadata.evidenceIds,
        ...input.features.map((feature) => feature.evidenceId),
      ]).sort();
      const missingIds = await missingEvidenceIds(runtime, sourceEvidenceIds);
      if (missingIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Entity feature evidence is not present in the evidence ledger.',
          missingIds,
        );
      }
      const incompatibleIds = await incompatibleEvidenceIds(runtime, sourceEvidenceIds, snapshot);
      if (incompatibleIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Entity evidence is not anchored to the requested ledger snapshot.',
          incompatibleIds,
          'SNAPSHOT_INCOMPATIBLE',
        );
      }
      const sourceNodes = await Promise.all(
        sourceEvidenceIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
      );
      if (sourceNodes.some((node) => node === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_EVIDENCE_INCOMPLETE',
              'Entity relationship source Evidence became unavailable before persistence.',
              true,
            ),
          );
      }
      const sourceEvidence = sourceNodes.map((node) => node?.evidence as Evidence);
      input = canonicalizeEntityRelationshipInput({
        ...input,
        metadata: {
          ...input.metadata,
          evidenceIds: sourceEvidenceIds,
          sourceSet: uniqueSourceIds(sourceEvidence.map((evidence) => evidence.source)),
        },
      });
      const result = resolveEntityRelationship(input);
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        snapshot,
        sourceEvidenceIds,
        `zerotrace:${ENTITY_RELATIONSHIP_MODEL_VERSION}`,
        'entity-relationship:' + input.subjectA + ':' + input.subjectB,
        { input, result },
        'Evidence-weighted controller, coordination, and independence inference.',
      );
      const resultWithTerminal = {
        ...result,
        metadata: {
          ...result.metadata,
          evidenceIds: uniqueSourceIds([...result.metadata.evidenceIds, derived.id]),
        },
      };
      const evidence = [...sourceEvidence, derived].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      const report = EntityRelationshipReportSchema.parse({
        schemaVersion: 'entity-relationship-report-v1',
        automaticOwnershipMergeAllowed: false,
        input,
        result: resultWithTerminal,
        terminalEvidenceId: derived.id,
        evidence,
      });
      const stored = await runtime.entityRelationshipReports.put(report);
      return {
        ...resultWithTerminal,
        automaticOwnershipMergeAllowed: false,
        terminalEvidenceId: derived.id,
        evidence,
        durableReport: {
          id: stored.id,
          resultHash: stored.resultHash,
          createdAt: stored.createdAt,
          replayed: false,
        },
      };
    },
  );

  app.get(
    '/api/v1/entities/relationships/reports/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipReportQuerySchema.parse(request.query);
      const repository = runtime.entityRelationshipReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
              'Durable Entity relationship report storage is not configured.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const record = await repository.latest({
        ledger: input.ledger,
        chainId: input.chainId,
        subjectA,
        subjectB,
      });
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_REPORT_NOT_FOUND',
              'No durable Entity relationship hypothesis report exists for this pair.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/entities/relationships/reports/:reportId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipReportQuerySchema.parse(request.query);
      const params = EntityRelationshipReportParamsSchema.parse(request.params);
      const repository = runtime.entityRelationshipReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
              'Durable Entity relationship report storage is not configured.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const record = await repository.get(params.reportId);
      if (
        record === undefined ||
        record.ledger !== input.ledger ||
        record.chainId !== input.chainId ||
        record.subjectA !== subjectA ||
        record.subjectB !== subjectB
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_REPORT_NOT_FOUND',
              'The durable Entity relationship hypothesis report was not found for this pair.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.post(
    '/api/v1/entities/relationships/timelines/materialize',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipTimelineMaterializeSchema.parse(request.body);
      if (
        runtime.evidenceRepository === undefined ||
        runtime.entityRelationshipReports === undefined ||
        runtime.entityRelationshipTimelines === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
              'Durable Evidence, relationship report, and timeline storage are required.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const records = await runtime.entityRelationshipReports.history({
        ledger: input.ledger,
        chainId: input.chainId,
        subjectA,
        subjectB,
        ...(input.fromPosition === undefined ? {} : { fromPosition: input.fromPosition }),
        ...(input.toPosition === undefined ? {} : { toPosition: input.toPosition }),
        limit: 1_001,
      });
      if (records.length > 1_000) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_TOO_LARGE',
              'The requested range contains more than 1,000 reports; provide a narrower position range.',
              false,
            ),
          );
      }
      if (records.length < 2) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_INSUFFICIENT_REPORTS',
              'At least two durable relationship reports are required to materialize a timeline.',
              false,
            ),
          );
      }
      const terminalEvidenceIds = records.map((record) => record.terminalEvidenceId).sort();
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
              'A relationship report terminal Evidence node is unavailable.',
              true,
            ),
          );
      }
      const timeline = buildEntityRelationshipTimeline({
        ledger: input.ledger,
        chainId: input.chainId,
        subjectA,
        subjectB,
        reports: records.map((record) => ({
          observation: {
            reportId: record.id,
            resultHash: record.resultHash,
            snapshot: record.report.result.metadata.snapshot,
            classification: record.report.result.classification,
            sameControllerProbability: record.report.result.sameControllerProbability,
            coordinationProbability: record.report.result.coordinationProbability,
            independenceProbability: record.report.result.independenceProbability,
            serviceSuppressionApplied: record.report.result.serviceSuppressionApplied,
            terminalEvidenceId: record.terminalEvidenceId,
            capturedAt: record.capturedAt,
          },
          metadata: record.report.result.metadata,
        })),
      });
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        timeline.metadata.snapshot,
        terminalEvidenceIds,
        `zerotrace:${ENTITY_RELATIONSHIP_TIMELINE_MODEL_VERSION}`,
        `entity-relationship-timeline:${subjectA}:${subjectB}:${timeline.request.fromPosition}:${timeline.request.toPosition}`,
        { timeline },
        'Durable relationship evolution across persisted Snapshot hypotheses; chain-position continuity remains explicit Unknown.',
      );
      const evidence = [...terminalNodes.map((node) => node?.evidence as Evidence), derived].sort(
        (left, right) => left.id.localeCompare(right.id),
      );
      const report = EntityRelationshipTimelineReportSchema.parse({
        schemaVersion: 'entity-relationship-timeline-report-v1',
        automaticOwnershipMergeAllowed: false,
        timeline,
        terminalEvidenceId: derived.id,
        evidence,
      });
      const stored = await runtime.entityRelationshipTimelines.put(report);
      return { replayed: false, record: stored };
    },
  );

  app.get(
    '/api/v1/entities/relationships/timelines/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipReportQuerySchema.parse(request.query);
      const repository = runtime.entityRelationshipTimelines;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
              'Durable Entity relationship timeline storage is not configured.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const record = await repository.latest({
        ledger: input.ledger,
        chainId: input.chainId,
        subjectA,
        subjectB,
      });
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_NOT_FOUND',
              'No durable Entity relationship timeline exists for this pair.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/entities/relationships/timelines/:timelineId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipReportQuerySchema.parse(request.query);
      const params = EntityRelationshipTimelineParamsSchema.parse(request.params);
      const repository = runtime.entityRelationshipTimelines;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
              'Durable Entity relationship timeline storage is not configured.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const record = await repository.get(params.timelineId);
      if (
        record === undefined ||
        record.ledger !== input.ledger ||
        record.chainId !== input.chainId ||
        record.subjectA !== subjectA ||
        record.subjectB !== subjectB
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_NOT_FOUND',
              'The durable Entity relationship timeline was not found for this pair.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

}
