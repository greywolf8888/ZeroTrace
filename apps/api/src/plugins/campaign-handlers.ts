import type { FastifyReply, FastifyRequest } from 'fastify';
import { defineCaptureSchedule } from '@zerotrace/capture-scheduler';
import { hashPayload } from '@zerotrace/evidence';
import {
  unknownValue,
  TokenHistoryBackfillParametersSchema,
  TokenLiveCaptureParametersSchema,
  type ForensicCampaignAlert,
} from '@zerotrace/schemas';
import {
  ControlCampaignBackfillRequestSchema,
  ControlCampaignMonitorRequestSchema,
  ControlCampaignParamsSchema,
  ControlCampaignMonitorParamsSchema,
  ControlCampaignListQuerySchema,
} from '../http/request-schemas.js';
import { errorResponse, emptyMetadata } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export function createCampaignHandlers(ctx: AppHttpContext) {
  const { runtime } = ctx;
  const controlCampaignUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({
      status: unknownValue(
        'STORAGE_UNCONFIGURED',
        'PostgreSQL Control Campaign storage is not configured.',
      ),
      metadata: emptyMetadata('control-campaign-v1'),
      error: errorResponse(
        request,
        'CONTROL_CAMPAIGN_STORAGE_UNAVAILABLE',
        'Durable Control Campaign storage is not configured.',
        false,
      ).error,
    });

  const captureScheduleUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({
      status: unknownValue(
        'STORAGE_UNCONFIGURED',
        'PostgreSQL capture scheduler storage is not configured.',
      ),
      metadata: emptyMetadata('capture-scheduler-v1'),
      error: errorResponse(
        request,
        'CAPTURE_SCHEDULER_UNAVAILABLE',
        'Durable capture scheduler storage is not configured.',
        false,
      ).error,
    });

  const queueControlCampaignBackfill = async (
    request: FastifyRequest,
    reply: FastifyReply,
    params: { chainId: string; token: string },
  ) => {
    const schedules = runtime.captureSchedules;
    if (schedules === undefined) return captureScheduleUnavailable(request, reply);
    const body = ControlCampaignBackfillRequestSchema.parse(request.body);
    const dataset =
      params.chainId === 'eip155:1'
        ? 'ethereum-mainnet'
        : params.chainId === 'eip155:56'
          ? 'binance-mainnet'
          : undefined;
    if (dataset === undefined) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_BACKFILL_UNSUPPORTED_CHAIN',
            'Token History backfill currently supports Ethereum and BNB Smart Chain only.',
            false,
          ),
        );
    }
    const parameters = TokenHistoryBackfillParametersSchema.parse({
      schemaVersion: 'token-history-backfill-v1',
      dataset,
      token: params.token.toLowerCase(),
      fromBlock: body.fromBlock,
      toBlock: body.toBlock,
      modelVersion: 'token-history-backfill-v1.0.0',
      policyVersion: 'token-history-policy-v1.0.0',
    });
    const fromBlock = BigInt(parameters.fromBlock);
    const toBlock = BigInt(parameters.toBlock);
    if (
      fromBlock > BigInt(Number.MAX_SAFE_INTEGER) ||
      toBlock > BigInt(Number.MAX_SAFE_INTEGER) ||
      toBlock - fromBlock + 1n > 1_000_000n
    ) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_BACKFILL_RANGE_INVALID',
            'Token History backfill must fit a safe integer range and at most 1,000,000 blocks.',
            false,
          ),
        );
    }
    const target = {
      ledger: 'EVM' as const,
      chainId: params.chainId,
      subjectType: 'TOKEN' as const,
      normalizedIdentifier: params.token.toLowerCase(),
    };
    const existing = (
      await schedules.listSchedules({
        target,
        captureKind: 'TOKEN_HISTORY_BACKFILL',
        limit: 100,
      })
    ).find((schedule) => hashPayload(schedule.definition.parameters) === hashPayload(parameters));
    const schedule =
      existing ??
      (() => {
        // Bind creation and one-shot execution to the same millisecond. If these
        // calls straddle a millisecond boundary, the schedule can be born
        // COMPLETED instead of QUEUED and a valid backfill is never claimable.
        const enqueueAt = new Date().toISOString();
        return defineCaptureSchedule({
          captureKind: 'TOKEN_HISTORY_BACKFILL',
          target,
          parameters,
          createdAt: enqueueAt,
          trigger: { type: 'ONCE', at: enqueueAt },
          retryPolicy: {
            maxAttempts: 3,
            initialDelaySeconds: 30,
            maximumDelaySeconds: 900,
            backoffMultiplierBps: 20_000,
          },
        });
      })();
    const stored = existing ?? (await schedules.putSchedule(schedule));
    const runs = await schedules.listRunsForSchedule(stored.definition.id, 20);
    const response = {
      backfill: {
        scheduleId: stored.definition.id,
        status: stored.status === 'ACTIVE' ? 'QUEUED' : stored.status,
        target: stored.definition.target,
        parameters: TokenHistoryBackfillParametersSchema.parse(stored.definition.parameters),
        nextRunAt: stored.nextRunAt,
      },
      schedule: stored,
      runs,
      replayed: existing !== undefined,
    };
    return reply.code(existing === undefined ? 202 : 200).send(response);
  };

  const listControlCampaignBackfills = async (
    request: FastifyRequest,
    reply: FastifyReply,
    params: { chainId: string; token: string },
  ) => {
    const schedules = runtime.captureSchedules;
    if (schedules === undefined) return captureScheduleUnavailable(request, reply);
    const query = ControlCampaignListQuerySchema.parse(request.query);
    const target = {
      ledger: 'EVM' as const,
      chainId: params.chainId,
      subjectType: 'TOKEN' as const,
      normalizedIdentifier: params.token.toLowerCase(),
    };
    const records = await schedules.listSchedules({
      target,
      captureKind: 'TOKEN_HISTORY_BACKFILL',
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return {
      records: await Promise.all(
        records.map(async (schedule) => ({
          schedule,
          runs: await schedules.listRunsForSchedule(schedule.definition.id, 20),
        })),
      ),
      replayed: true,
    };
  };

  const queueControlCampaignMonitor = async (
    request: FastifyRequest,
    reply: FastifyReply,
    params: { chainId: string; token: string },
  ) => {
    const schedules = runtime.captureSchedules;
    if (schedules === undefined) return captureScheduleUnavailable(request, reply);
    const body = ControlCampaignMonitorRequestSchema.parse(request.body);
    const dataset =
      params.chainId === 'eip155:1'
        ? 'ethereum-mainnet'
        : params.chainId === 'eip155:56'
          ? 'binance-mainnet'
          : undefined;
    if (dataset === undefined) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_MONITOR_UNSUPPORTED_CHAIN',
            'Token Campaign monitoring currently supports Ethereum and BNB Smart Chain only.',
            false,
          ),
        );
    }
    const initialFromBlock = BigInt(body.initialFromBlock);
    if (initialFromBlock > BigInt(Number.MAX_SAFE_INTEGER)) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_MONITOR_RANGE_INVALID',
            'Monitor initialFromBlock must fit a safe integer range.',
            false,
          ),
        );
    }
    const parameters = TokenLiveCaptureParametersSchema.parse({
      schemaVersion: 'token-live-capture-v1',
      dataset,
      token: params.token.toLowerCase(),
      initialFromBlock: body.initialFromBlock,
      windowBlocks: body.windowBlocks ?? 10_000,
      modelVersion: 'token-live-capture-v1.0.0',
      policyVersion: 'token-history-policy-v1.0.0',
    });
    const everySeconds = body.everySeconds ?? 60;
    const target = {
      ledger: 'EVM' as const,
      chainId: params.chainId,
      subjectType: 'TOKEN' as const,
      normalizedIdentifier: params.token.toLowerCase(),
    };
    const existing = (
      await schedules.listSchedules({
        target,
        captureKind: 'TOKEN_LIVE_CAPTURE',
        limit: 100,
      })
    ).find(
      (schedule) =>
        hashPayload(schedule.definition.parameters) === hashPayload(parameters) &&
        schedule.definition.trigger.type === 'INTERVAL' &&
        schedule.definition.trigger.everySeconds === everySeconds,
    );
    const schedule =
      existing ??
      defineCaptureSchedule({
        captureKind: 'TOKEN_LIVE_CAPTURE',
        target,
        parameters,
        trigger: {
          type: 'INTERVAL',
          anchorAt: new Date().toISOString(),
          everySeconds,
          catchupPolicy: 'SKIP_MISSED',
        },
        retryPolicy: {
          maxAttempts: 3,
          initialDelaySeconds: 30,
          maximumDelaySeconds: 900,
          backoffMultiplierBps: 20_000,
        },
      });
    const stored = existing ?? (await schedules.putSchedule(schedule));
    const runs = await schedules.listRunsForSchedule(stored.definition.id, 20);
    return reply.code(existing === undefined ? 202 : 200).send({
      monitor: {
        monitorId: stored.definition.id,
        scheduleId: stored.definition.id,
        status: stored.status,
        target: stored.definition.target,
        parameters: TokenLiveCaptureParametersSchema.parse(stored.definition.parameters),
        trigger: stored.definition.trigger,
        nextRunAt: stored.nextRunAt,
      },
      schedule: stored,
      runs,
      replayed: existing !== undefined,
    });
  };

  const readControlCampaignMonitor = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ControlCampaignMonitorParamsSchema.parse(request.params);
    const schedules = runtime.captureSchedules;
    if (schedules === undefined) return captureScheduleUnavailable(request, reply);
    const schedule = await schedules.getSchedule(params.monitorId);
    if (schedule === undefined || schedule.definition.captureKind !== 'TOKEN_LIVE_CAPTURE') {
      return reply
        .code(404)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_MONITOR_NOT_FOUND',
            'Control Campaign monitor was not found.',
            false,
          ),
        );
    }
    return {
      monitor: {
        monitorId: schedule.definition.id,
        scheduleId: schedule.definition.id,
        status: schedule.status,
        target: schedule.definition.target,
        parameters: TokenLiveCaptureParametersSchema.parse(schedule.definition.parameters),
        trigger: schedule.definition.trigger,
        nextRunAt: schedule.nextRunAt,
      },
      schedule,
      runs: await schedules.listRunsForSchedule(schedule.definition.id, 50),
      replayed: true,
    };
  };

  const alertsUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({
      status: unknownValue(
        'STORAGE_UNCONFIGURED',
        'PostgreSQL Forensic Campaign Alert storage is not configured.',
      ),
      metadata: emptyMetadata('forensic-campaign-alert-v1'),
      error: errorResponse(
        request,
        'FORENSIC_ALERT_STORAGE_UNAVAILABLE',
        'Durable Forensic Campaign Alert storage is not configured.',
        false,
      ).error,
    });

  const campaignAlerts = async (
    request: FastifyRequest,
    reply: FastifyReply,
    campaignId: string,
  ): Promise<
    FastifyReply | { campaignId: string; alerts: ForensicCampaignAlert[]; replayed: true }
  > => {
    const campaigns = runtime.controlCampaignReports;
    const alerts = runtime.forensicCampaignAlerts;
    if (campaigns === undefined) return controlCampaignUnavailable(request, reply);
    if (alerts === undefined) return alertsUnavailable(request, reply);
    const record = await campaigns.get(campaignId);
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
    return { campaignId, alerts: await alerts.listByCampaign(campaignId), replayed: true };
  };

  const streamControlCampaignById = async (
    request: FastifyRequest,
    reply: FastifyReply,
    campaignId: string,
  ) => {
    const campaigns = runtime.controlCampaignReports;
    const alerts = runtime.forensicCampaignAlerts;
    if (campaigns === undefined) return controlCampaignUnavailable(request, reply);
    if (alerts === undefined) return alertsUnavailable(request, reply);
    const record = await campaigns.get(campaignId);
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
    const records = await alerts.listByCampaign(campaignId);
    const events = [
      `event: campaign\ndata: ${JSON.stringify({
        campaignId: record.id,
        resultHash: record.resultHash,
        snapshotPosition: record.snapshotPosition,
        capturedAt: record.capturedAt,
        replayed: true,
      })}\n\n`,
      ...records.map(
        (alert) => `id: ${alert.id}\nevent: alert\ndata: ${JSON.stringify(alert)}\n\n`,
      ),
      `event: complete\ndata: ${JSON.stringify({
        campaignId: record.id,
        alertCount: records.length,
        replayed: true,
      })}\n\n`,
    ];
    return reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache, no-store')
      .header('connection', 'keep-alive')
      .send(events.join(''));
  };

  const streamControlCampaign = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ControlCampaignParamsSchema.parse(request.params);
    return streamControlCampaignById(request, reply, params.campaignId);
  };

  const fundingSettlementUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({
      status: unknownValue(
        'STORAGE_UNCONFIGURED',
        'PostgreSQL Funding and Settlement report storage is not configured.',
      ),
      metadata: emptyMetadata('funding-settlement-v1.0.0'),
      error: errorResponse(
        request,
        'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
        'Durable Funding and Settlement report storage is not configured.',
        false,
      ).error,
    });

  return {
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
  };
}
