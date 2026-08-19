import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ForensicCaseBundleError } from '@zerotrace/forensic-evidence';
import { unknownValue } from '@zerotrace/schemas';
import { ControlCampaignTokenParamsSchema, ControlCampaignBackfillAliasParamsSchema, ControlCampaignParamsSchema, FundingSettlementReportParamsSchema, FundingSettlementRangeQuerySchema, ControlCampaignListQuerySchema } from '../http/request-schemas.js';
import { errorResponse, emptyMetadata, forensicCaseBundleForCampaign, forensicCaseBundleError, controlCampaignResponse } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';
import { createCampaignHandlers } from './campaign-handlers.js';

export async function registerFundingAndCampaignRoutes(app: FastifyInstance, ctx: AppHttpContext): Promise<void> {
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
  app.get(
    '/api/v1/funding-settlement/tokens/:chainId/:token/range',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const query = FundingSettlementRangeQuerySchema.parse(request.query);
      const repository = runtime.fundingSettlementReports;
      if (repository === undefined) return fundingSettlementUnavailable(request, reply);
      const report = await repository.forRange(
        params.chainId,
        params.token.toLowerCase(),
        query.fromBlock,
        query.toBlock,
      );
      if (report === undefined) {
        return {
          report: unknownValue(
            'NOT_QUERIED',
            'No durable Funding and Settlement report matches the selected campaign range.',
          ),
          snapshot: unknownValue('NOT_QUERIED'),
          metadata: emptyMetadata('funding-settlement-v1.0.0'),
          replayed: true,
        };
      }
      return { report, replayed: true };
    },
  );

  app.get(
    '/api/v1/funding-settlement/tokens/:chainId/:token',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const repository = runtime.fundingSettlementReports;
      if (repository === undefined) return fundingSettlementUnavailable(request, reply);
      const report = await repository.latest(params.chainId, params.token.toLowerCase());
      if (report === undefined) {
        return {
          report: unknownValue(
            'NOT_QUERIED',
            'No durable Funding and Settlement report has been materialized for this token.',
          ),
          snapshot: unknownValue('NOT_QUERIED'),
          metadata: emptyMetadata('funding-settlement-v1.0.0'),
          replayed: true,
        };
      }
      return { report, replayed: true };
    },
  );

  app.get(
    '/api/v1/funding-settlement/reports/:reportId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = FundingSettlementReportParamsSchema.parse(request.params);
      const repository = runtime.fundingSettlementReports;
      if (repository === undefined) return fundingSettlementUnavailable(request, reply);
      const report = await repository.get(params.reportId);
      if (report === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FUNDING_SETTLEMENT_REPORT_NOT_FOUND',
              'The requested durable Funding and Settlement report was not found.',
              false,
            ),
          );
      }
      return { report, replayed: true };
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/overview',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.latest(params.chainId, params.token.toLowerCase());
      if (record === undefined) {
        return {
          campaign: unknownValue(
            'NOT_QUERIED',
            'No durable Control Campaign has been materialized for this token.',
          ),
          snapshot: unknownValue('NOT_QUERIED'),
          metadata: emptyMetadata('control-campaign-v1'),
        };
      }
      return controlCampaignResponse(record);
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/campaigns',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const query = ControlCampaignListQuerySchema.parse(request.query);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const records = await repository.list({
        chainId: params.chainId,
        token: params.token.toLowerCase(),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
      return { records: records.map((record) => controlCampaignResponse(record)) };
    },
  );

  app.post(
    '/api/v1/control/tokens/:chainId/:token/backfill',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      return queueControlCampaignBackfill(request, reply, params);
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/backfill',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      return listControlCampaignBackfills(request, reply, params);
    },
  );

  app.post(
    '/api/v1/control-campaigns/:ledger/:chainId/:token/backfills',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignBackfillAliasParamsSchema.parse(request.params);
      return queueControlCampaignBackfill(request, reply, params);
    },
  );

  app.get(
    '/api/v1/control-campaigns/:ledger/:chainId/:token/backfills',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignBackfillAliasParamsSchema.parse(request.params);
      return listControlCampaignBackfills(request, reply, params);
    },
  );

  app.post(
    '/api/v1/control/tokens/:chainId/:token/monitor',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      return queueControlCampaignMonitor(request, reply, params);
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/alerts',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const campaigns = runtime.controlCampaignReports;
      if (campaigns === undefined) return controlCampaignUnavailable(request, reply);
      const record = await campaigns.latest(params.chainId, params.token.toLowerCase());
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'No latest Control Campaign was found for this token.',
              false,
            ),
          );
      }
      return campaignAlerts(request, reply, record.id);
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/stream',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const campaigns = runtime.controlCampaignReports;
      if (campaigns === undefined) return controlCampaignUnavailable(request, reply);
      const record = await campaigns.latest(params.chainId, params.token.toLowerCase());
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'No latest Control Campaign was found for this token.',
              false,
            ),
          );
      }
      return streamControlCampaignById(request, reply, record.id);
    },
  );

  app.post(
    '/api/v1/control-campaigns/:ledger/:chainId/:token/monitors',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignBackfillAliasParamsSchema.parse(request.params);
      return queueControlCampaignMonitor(request, reply, params);
    },
  );

  app.get(
    '/api/v1/control-campaigns/monitors/:monitorId',
    { schema: { tags: ['analysis'] } },
    readControlCampaignMonitor,
  );

  app.get(
    '/api/v1/control-campaigns/:campaignId/alerts',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      return campaignAlerts(request, reply, params.campaignId);
    },
  );

  app.get(
    '/api/v1/control-campaigns/:campaignId/stream',
    { schema: { tags: ['analysis'] } },
    streamControlCampaign,
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId',
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
      return controlCampaignResponse(record);
    },
  );

  app.post(
    '/api/v1/control/campaigns/:campaignId/replay',
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
      return controlCampaignResponse(record, true);
    },
  );

  app.post(
    '/api/v1/control/campaigns/:campaignId/export',
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
      try {
        return { case: await forensicCaseBundleForCampaign(runtime, record), replayed: true };
      } catch (error) {
        if (error instanceof ForensicCaseBundleError)
          return forensicCaseBundleError(request, reply, error);
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/export',
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
      try {
        return { case: await forensicCaseBundleForCampaign(runtime, record), replayed: true };
      } catch (error) {
        if (error instanceof ForensicCaseBundleError)
          return forensicCaseBundleError(request, reply, error);
        throw error;
      }
    },
  );

}
