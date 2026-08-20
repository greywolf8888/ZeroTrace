import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  materializeTokenMarketStructure,
  originHistoryWithoutReader,
} from '@zerotrace/forensic-pipeline';
import { FLAP_BSC_MAINNET_DEPLOYMENT, inspectFlapToken } from '@zerotrace/platform-adapters';
import { TokenAnalyzeRequestSchema, type ReportEnvelope } from '@zerotrace/schemas';
import { InMemoryJobQueue, type JobQueue } from '@zerotrace/workflow-core';

import type { AppRuntime } from '../runtime.js';

export interface TokenAnalyzePluginOptions {
  runtime: AppRuntime;
  jobQueue?: JobQueue;
  rememberEnvelope: (
    envelope: ReportEnvelope,
    request: FastifyRequest,
    reply: FastifyReply,
    investigationId?: string,
  ) => Promise<ReportEnvelope | FastifyReply>;
  isAdmissibleMode: (mode: unknown) => boolean;
  analysisModeOf: (request: FastifyRequest) => unknown;
}

function errorBody(code: string, message: string) {
  return { error: { code, message, retryable: false } };
}

function workstationStatus(job: { status: string; resultRef?: string }) {
  if (job.status === 'PENDING') return 'QUEUED';
  if (job.status === 'RUNNING') return 'RUNNING';
  if (job.status === 'CANCELLED') return 'CANCELLED';
  if (job.status === 'FAILED' || job.status === 'DEAD_LETTER') return 'FAILED';
  if (job.status === 'SUCCEEDED' && job.resultRef === 'COMPLETE') return 'COMPLETE';
  if (job.status === 'SUCCEEDED') return 'PARTIAL';
  return 'FAILED';
}

export async function registerTokenAnalyze(
  app: FastifyInstance,
  options: TokenAnalyzePluginOptions,
): Promise<void> {
  const durableQueue: JobQueue | undefined = options.jobQueue ?? options.runtime.jobQueue;
  const researchQueue = durableQueue ?? new InMemoryJobQueue();

  app.post(
    '/api/v2/tokens/:ledger/:chainId/:token/analyze',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = request.params as { ledger: string; chainId: string; token: string };
      const body = (request.body ?? {}) as {
        snapshotPolicy?: unknown;
        analysisMode?: unknown;
        forensicMode?: unknown;
      };
      const parsed = TokenAnalyzeRequestSchema.parse({
        ledger: params.ledger,
        chainId: params.chainId,
        token: params.token,
        snapshotPolicy: body.snapshotPolicy ?? 'FINALIZED',
        analysisMode: body.analysisMode ?? 'FULL_LIFETIME',
        ...(body.forensicMode === undefined ? {} : { forensicMode: body.forensicMode }),
      });
      const admissible = options.isAdmissibleMode(
        parsed.forensicMode ?? options.analysisModeOf(request),
      );
      if (admissible && durableQueue === undefined) {
        return reply
          .code(503)
          .send(errorBody('JOB_QUEUE_UNAVAILABLE', '取证模式禁止内存任务队列降级。'));
      }
      const queue = admissible ? durableQueue : researchQueue;
      if (queue === undefined) {
        return reply.code(503).send(errorBody('JOB_QUEUE_UNAVAILABLE', '任务队列不可用。'));
      }
      const job = await queue.enqueue({
        type: 'TOKEN_MARKET_STRUCTURE',
        idempotencyKey: `${parsed.ledger}:${parsed.chainId}:${parsed.token}:${parsed.snapshotPolicy}:${parsed.analysisMode}`,
        payload: JSON.stringify(parsed),
      });
      if (admissible) {
        return reply.code(job.status === 'PENDING' ? 202 : 200).send({
          status: workstationStatus(job),
          job,
          limitations: ['正式取证请求已进入持久任务队列；阶段结果落盘后可通过任务接口查询。'],
        });
      }
      const adapter =
        parsed.ledger === 'EVM' && parsed.chainId === 'eip155:56'
          ? options.runtime.evmAdapters.get(56)
          : undefined;
      let observation: Parameters<typeof materializeTokenMarketStructure>[0]['observation'];
      if (adapter !== undefined) {
        try {
          const inspection = await inspectFlapToken({
            adapter,
            token: parsed.token,
            deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
            writeEvidence: async (evidence, sourceEvidenceIds = [], snapshot) => {
              try {
                options.runtime.evidenceLedger.add(evidence, sourceEvidenceIds, snapshot);
              } catch {
                // Evidence is immutable; a matching insert is a replay.
              }
              const stored = await options.runtime.evidenceRepository?.put(
                evidence,
                sourceEvidenceIds,
                snapshot,
              );
              return stored?.evidence ?? evidence;
            },
          });
          const snapshot = inspection.metadata.snapshot;
          if (snapshot !== null && snapshot.ledger === 'EVM') {
            const circulating = inspection.state?.circulatingSupply;
            const reserve = inspection.state?.reserve;
            const pool = inspection.state?.pool;
            observation = {
              token: inspection.token,
              chainId: snapshot.chainId,
              snapshot,
              evidence: inspection.evidence,
              portalAddress: inspection.deployment.portal,
              ...(typeof circulating === 'string' && /^(?:0|[1-9]\d*)$/.test(circulating)
                ? { circulatingSupplyAtomic: circulating }
                : {}),
              ...(typeof reserve === 'string' && /^(?:0|[1-9]\d*)$/.test(reserve)
                ? { reserveAtomic: reserve }
                : {}),
              ...(pool !== undefined && pool.state === 'known' ? { poolAddress: pool.value } : {}),
              ...(inspection.platformMatch.state === 'known'
                ? { platformMatch: inspection.platformMatch.value }
                : {}),
            };
          }
        } catch (error) {
          const failed = await queue.fail(
            job.id,
            error instanceof Error ? error.message : 'Token inspection failed.',
          );
          return reply.code(502).send({
            status: 'FAILED',
            job,
            reason: failed.lastError ?? 'PROVIDER_DOWN',
            limitations: ['只读检查失败，未用空数填补盘面。'],
          });
        }
      }
      const report = materializeTokenMarketStructure({
        request: parsed,
        ...(observation === undefined ? {} : { observation }),
      });
      for (const envelope of report.envelopes) {
        const persisted = await options.rememberEnvelope(envelope, request, reply);
        if (reply.sent) return persisted;
      }
      const origin =
        options.runtime.sqdBscCreationReader === undefined
          ? originHistoryWithoutReader()
          : undefined;
      if (origin !== undefined) {
        report.limitations.push(...origin.limitations);
      }
      const succeeded = await queue.succeed(job.id, report.envelopes[0]?.id ?? report.status);
      return {
        status: report.status,
        job: succeeded,
        investigationId: report.investigationId,
        limitations: report.limitations,
        supply: report.supply,
        roles: report.roles,
        envelopes: report.envelopes,
        casePackage: report.casePackage,
        ...(report.reason === undefined ? {} : { reason: report.reason }),
      };
    },
  );

  app.get('/api/v2/jobs/:jobId', { schema: { tags: ['analysis'] } }, async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await researchQueue.get(params.jobId);
    if (job === undefined) {
      return reply.code(404).send(errorBody('NOT_FOUND', '任务不存在。'));
    }
    return job;
  });

  app.post(
    '/api/v2/jobs/:jobId/cancel',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = request.params as { jobId: string };
      try {
        return await researchQueue.cancel(params.jobId);
      } catch (error) {
        const existing = await researchQueue.get(params.jobId);
        if (existing === undefined) {
          return reply.code(404).send(errorBody('NOT_FOUND', '任务不存在。'));
        }
        return reply
          .code(409)
          .send(
            errorBody(
              'INVALID_JOB_TRANSITION',
              error instanceof Error ? error.message : '任务当前状态不能取消。',
            ),
          );
      }
    },
  );

  app.post(
    '/api/v2/jobs/:jobId/retry',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = request.params as { jobId: string };
      try {
        return await researchQueue.retry(params.jobId);
      } catch (error) {
        const existing = await researchQueue.get(params.jobId);
        if (existing === undefined) {
          return reply.code(404).send(errorBody('NOT_FOUND', '任务不存在。'));
        }
        return reply
          .code(409)
          .send(
            errorBody(
              'INVALID_JOB_TRANSITION',
              error instanceof Error ? error.message : '任务当前状态不能重试。',
            ),
          );
      }
    },
  );
}
