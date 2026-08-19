import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hashPayload } from '@zerotrace/evidence';
import { ForensicCaseBundleError, caseIdForCampaign } from '@zerotrace/forensic-evidence';
import type { Evidence } from '@zerotrace/schemas';
import {
  ControlCampaignParamsSchema,
  ForensicCaseParamsSchema,
  ForensicCaseCreateSchema,
  ControlCampaignEvidenceItemParamsSchema,
  ControlCampaignEventParamsSchema,
  ControlCampaignGraphQuerySchema,
} from '../http/request-schemas.js';
import {
  errorResponse,
  capabilityNotImplemented,
  forensicCaseBundleForCampaign,
  forensicCaseBundleError,
} from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';
import { createCampaignHandlers } from './campaign-handlers.js';

export async function registerForensicCaseRoutes(
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
  const {
    controlCampaignUnavailable,
    captureScheduleUnavailable,
    queueControlCampaignBackfill,
    listControlCampaignBackfills,
    queueControlCampaignMonitor,
    readControlCampaignMonitor,
    alertsUnavailable,
    campaignAlerts,
    streamControlCampaignById,
    streamControlCampaign,
    fundingSettlementUnavailable,
  } = createCampaignHandlers(ctx);
  app.post(
    '/api/v1/forensics/cases',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const body = ForensicCaseCreateSchema.parse(request.body);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(body.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      try {
        return { case: await forensicCaseBundleForCampaign(runtime, record), replayed: true };
      } catch (error) {
        if (error instanceof ForensicCaseBundleError)
          return forensicCaseBundleError(request, reply, error);
        throw error;
      }
    },
  );

  const readForensicCase = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ForensicCaseParamsSchema.parse(request.params);
    const campaignId = params.caseId.slice('fcb_'.length);
    const repository = runtime.controlCampaignReports;
    if (repository === undefined) return controlCampaignUnavailable(request, reply);
    const record = await repository.get(campaignId);
    if (record === undefined || caseIdForCampaign(record.id) !== params.caseId) {
      return reply
        .code(404)
        .send(
          errorResponse(
            request,
            'FORENSIC_CASE_NOT_FOUND',
            'Forensic Case Bundle was not found.',
            false,
          ),
        );
    }
    try {
      return { case: await forensicCaseBundleForCampaign(runtime, record), replayed: true };
    } catch (error) {
      if (error instanceof ForensicCaseBundleError)
        return forensicCaseBundleError(request, reply, error);
      throw error;
    }
  };

  app.get('/api/v1/forensics/cases/:caseId', { schema: { tags: ['analysis'] } }, readForensicCase);
  app.get(
    '/api/v1/forensics/cases/:caseId/export',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const response = await readForensicCase(request, reply);
      if (reply.sent || response === undefined) return response;
      reply.header('content-type', 'application/json; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="forensic-case-bundle.json"');
      return response;
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/timeline',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return {
        campaignId: record.id,
        snapshot: record.bundle.campaign.snapshotEnd,
        metadata: record.bundle.campaign.metadata,
        events: record.bundle.behaviorEvents,
        evidenceLine: record.bundle.evidenceLine,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/positions',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return {
        campaignId: record.id,
        snapshot: record.bundle.campaign.snapshotEnd,
        metadata: record.bundle.campaign.metadata,
        positions: record.bundle.positions,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/wallets',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return {
        campaignId: record.id,
        snapshot: record.bundle.campaign.snapshotEnd,
        metadata: record.bundle.campaign.metadata,
        memberships: record.bundle.memberships,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/graph',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const query = ControlCampaignGraphQuerySchema.parse(request.query);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      const bundle = record.bundle;
      const phaseForLayer = {
        control: undefined,
        funding: 'FUNDING',
        token: 'TOKEN_CONTROL',
        settlement: 'SETTLEMENT',
      }[query.layer];
      const phaseItems =
        phaseForLayer === undefined
          ? bundle.evidenceItems
          : bundle.evidenceItems.filter((item) => item.phase === phaseForLayer);
      const nodes = new Map<string, { id: string; type: string; role?: string }>();
      for (const wallet of bundle.clusterVersion.memberWalletIds) {
        nodes.set(wallet, { id: wallet, type: 'WALLET' });
      }
      const edges = phaseItems
        .filter((item) => item.subjectA !== undefined && item.subjectB !== undefined)
        .map((item) => {
          const subjectA = item.subjectA!;
          const subjectB = item.subjectB!;
          nodes.set(subjectA, { id: subjectA, type: 'SUBJECT' });
          nodes.set(subjectB, { id: subjectB, type: 'SUBJECT' });
          return {
            id: item.id,
            source: subjectA,
            target: subjectB,
            relation: item.featureKind ?? item.phase,
            evidenceIds: [item.evidenceId],
            automaticEntityMembershipAllowed: false,
          };
        });
      return {
        layer: query.layer,
        campaignId: record.id,
        snapshot: bundle.campaign.snapshotEnd,
        metadata: bundle.campaign.metadata,
        automaticEntityMembershipAllowed: false,
        nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
        edges,
        resultHash: hashPayload({
          layer: query.layer,
          campaignId: record.id,
          nodes: [...nodes.keys()].sort(),
          edges,
        }),
      };
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/evidence-line',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return {
        campaignId: record.id,
        snapshot: record.bundle.campaign.snapshotEnd,
        metadata: record.bundle.campaign.metadata,
        evidenceLine: record.bundle.evidenceLine,
        items: record.bundle.evidenceItems,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/events/:eventId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignEventParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.findByBehaviorEventId(params.eventId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_EVENT_NOT_FOUND',
              'Behavior Event was not found.',
              false,
            ),
          );
      }
      const event = record.bundle.behaviorEvents.find((item) => item.id === params.eventId);
      return {
        campaignId: record.id,
        event,
        snapshot: record.bundle.campaign.snapshotEnd,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/evidence/:itemId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignEvidenceItemParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.findByEvidenceItemId(params.itemId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_EVIDENCE_NOT_FOUND',
              'Campaign Evidence Item was not found.',
              false,
            ),
          );
      }
      const item = record.bundle.evidenceItems.find((candidate) => candidate.id === params.itemId);
      return {
        campaignId: record.id,
        item,
        evidenceLine: record.bundle.evidenceLine,
        snapshot: record.bundle.campaign.snapshotEnd,
        resultHash: record.resultHash,
      };
    },
  );

  const incompleteCapabilities = ['assets', 'labels', 'launches', 'markets', 'claims', 'timeline'];
  for (const capability of incompleteCapabilities) {
    app.all(`/api/v1/${capability}`, { schema: { tags: ['analysis'] } }, (request, reply) =>
      capabilityNotImplemented(request, reply, capability),
    );
  }
}
