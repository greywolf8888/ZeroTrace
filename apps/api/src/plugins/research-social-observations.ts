import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  fetchSearchPage,
  FXEMBED_TEMPLATE,
  makeSearchPlan,
  prepareExternalContentRecord,
  XAPID_TEMPLATE,
  type Quote,
} from '@zerotrace/provider-plane';
import { buildIdentityQueries, compileApprovedQuery } from '@zerotrace/workflow-core';

import type { AppHttpContext } from '../http/context.js';
import { rightsEvidenceAvailable, sourceStatus } from './research-source-contracts.js';

const QueryVersionSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const QueryIdentityBase = {
  verifiedHandle: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,15}$/)
    .optional(),
  aliases: z.array(z.string().trim().min(1).max(160)).max(8).optional(),
};
const SocialObservationWindowSchema = z
  .object({
    providerId: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/),
    queryVersion: QueryVersionSchema,
    pageSize: z.number().int().min(1).max(1_000).default(30),
    identity: z.discriminatedUnion('chain', [
      z
        .object({
          chain: z.literal('BSC'),
          address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
          ...QueryIdentityBase,
        })
        .strict(),
      z
        .object({
          chain: z.literal('SOLANA'),
          address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
          ...QueryIdentityBase,
        })
        .strict(),
    ]),
    from: z.iso.datetime({ offset: true }),
    until: z.iso.datetime({ offset: true }),
  })
  .strict();
const SocialObservationWindowParamsSchema = z
  .object({
    windowId: z.string().regex(/^sow_[0-9a-f]{24}$/),
  })
  .strict();
const SocialObservationWindowListSchema = z
  .object({
    after: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,512}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const SocialObservationFetchSchema = z
  .object({
    idempotencyKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  })
  .strict();
function chainIdentity(chain: 'BSC' | 'SOLANA'): {
  ledger: 'EVM' | 'SOLANA';
  chainId: string;
} {
  return chain === 'BSC'
    ? { ledger: 'EVM', chainId: 'eip155:56' }
    : { ledger: 'SOLANA', chainId: 'solana-mainnet' };
}

function publicWindow(
  record: Awaited<ReturnType<NonNullable<AppHttpContext['runtime']['socialObservations']>['get']>>,
) {
  return {
    id: record.window.id,
    ledger: record.ledger,
    chainId: record.chainId,
    assetKey: record.assetKey,
    queryRole: record.queryRole,
    providerId: record.window.providerId,
    queryVersion: record.window.queryVersion,
    contractVersion: record.window.contractVersion,
    temporalContract: record.temporalContract,
    contentPolicyVersion: record.contentPolicyVersion,
    from: record.window.from,
    until: record.window.until,
    cursor: record.window.cursor,
    completed: record.window.completed,
    pages: record.window.pages,
    revision: record.window.revision,
    coverage: record.window.coverage,
    pageSize: record.pageSize,
    rightsEvidenceIds: record.rightsEvidenceIds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function decodeWindowCursor(cursor: string): { updatedAt: string; windowId: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('INVALID_SOCIAL_OBSERVATION_CURSOR');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('INVALID_SOCIAL_OBSERVATION_CURSOR');
  }
  const candidate = parsed as Record<string, unknown>;
  const updatedAt = candidate.updatedAt;
  const windowId = candidate.windowId;
  if (
    typeof updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    typeof windowId !== 'string' ||
    !/^sow_[0-9a-f]{24}$/.test(windowId)
  ) {
    throw new Error('INVALID_SOCIAL_OBSERVATION_CURSOR');
  }
  return {
    updatedAt: new Date(updatedAt).toISOString(),
    windowId,
  };
}

function encodeWindowCursor(cursor: { updatedAt: string; windowId: string }): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export async function registerSocialObservationRoutes(
  app: FastifyInstance,
  context: AppHttpContext,
): Promise<void> {
  app.post(
    '/api/v1/research/social-observation-windows',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = SocialObservationWindowSchema.parse(request.body);
      if (context.runtime.socialObservations === undefined) {
        return reply.code(503).send({
          error: {
            code: 'SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE',
            message: '未配置持久社交观察仓库，不能创建分页读取窗口。',
            retryable: false,
          },
        });
      }
      const configured = context.runtime.socialSources ?? [FXEMBED_TEMPLATE, XAPID_TEMPLATE];
      const source = configured.find((candidate) => candidate.id === input.providerId);
      if (source === undefined) {
        return reply.code(404).send({
          error: {
            code: 'RESEARCH_SOURCE_NOT_FOUND',
            message: '未找到指定的研究来源合同。',
            retryable: false,
          },
        });
      }
      const status = sourceStatus(source);
      if (status !== 'READY' || source.search === null || source.contentPolicy === null) {
        return reply.code(409).send({
          error: {
            code: 'RESEARCH_SOURCE_NOT_READY',
            message: '研究来源身份、权益、费用或端点合同尚未全部核验。',
            retryable: false,
            sourceStatus: status,
          },
        });
      }
      if (source.search.temporal === null) {
        return reply.code(409).send({
          error: {
            code: 'RESEARCH_SOURCE_TEMPORAL_CONTRACT_INCOMPLETE',
            message: '来源未核验历史时间参数、精度和边界语义，不能创建观察窗口。',
            retryable: false,
          },
        });
      }
      if (!(await rightsEvidenceAvailable(context, source))) {
        return reply.code(context.runtime.evidenceRepository === undefined ? 503 : 409).send({
          error: {
            code:
              context.runtime.evidenceRepository === undefined
                ? 'RESEARCH_RIGHTS_EVIDENCE_UNAVAILABLE'
                : 'RESEARCH_RIGHTS_EVIDENCE_INCOMPLETE',
            message: '来源权益合同引用的持久证据不可用或不完整。',
            retryable: false,
          },
        });
      }
      if (Date.parse(input.from) >= Date.parse(input.until)) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_SOCIAL_OBSERVATION_WINDOW',
            message: '社交观察窗口的开始时间必须早于结束时间。',
            retryable: false,
          },
        });
      }
      const compiled = buildIdentityQueries(
        {
          chain: input.identity.chain,
          address: input.identity.address,
          ...(input.identity.verifiedHandle === undefined
            ? {}
            : { verifiedHandle: input.identity.verifiedHandle }),
          ...(input.identity.aliases === undefined ? {} : { aliases: input.identity.aliases }),
        },
        input.queryVersion,
      );
      const chain = chainIdentity(input.identity.chain);
      const windows = await Promise.all(
        compiled.queries.map(async ({ role, query }) => {
          const approvedQuery = compileApprovedQuery(
            query,
            source.search!.maxQueryChars,
            input.queryVersion,
          );
          return context.runtime.socialObservations!.create({
            ...chain,
            assetKey: compiled.assetKey,
            queryRole: role,
            approvedQuery,
            providerId: source.id,
            queryVersion: input.queryVersion,
            contractVersion: source.contractVersion,
            temporalContract: source.search!.temporal!,
            contentPolicyVersion: source.contentPolicy!.policyVersion,
            rightsEvidenceIds: source.contentPolicy!.rightsEvidenceIds,
            from: input.from,
            until: input.until,
            pageSize: input.pageSize,
          });
        }),
      );
      return reply.code(202).send({
        mode: 'DURABLE_READ_ONLY_SOCIAL_OBSERVATION',
        sourceId: source.id,
        assetKey: compiled.assetKey,
        networkRequestPerformed: false,
        windows: windows.map(publicWindow),
        warning: '窗口已持久化；只有管理员 MFA 操作才能逐页读取，窗口创建本身不会发网。',
      });
    },
  );

  app.get(
    '/api/v1/research/social-observation-windows',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const query = SocialObservationWindowListSchema.parse(request.query);
      if (context.runtime.socialObservations === undefined) {
        return reply.code(503).send({
          error: {
            code: 'SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE',
            message: '持久社交观察仓库不可用。',
            retryable: false,
          },
        });
      }
      let after;
      try {
        after = query.after === undefined ? undefined : decodeWindowCursor(query.after);
      } catch {
        return reply.code(400).send({
          error: {
            code: 'INVALID_SOCIAL_OBSERVATION_CURSOR',
            message: '社交观察窗口分页游标无效。',
            retryable: false,
          },
        });
      }
      try {
        const page = await context.runtime.socialObservations.list({
          limit: query.limit,
          ...(after === undefined ? {} : { after }),
        });
        return {
          records: page.records.map(publicWindow),
          nextCursor: page.nextCursor === null ? null : encodeWindowCursor(page.nextCursor),
        };
      } catch {
        return reply.code(503).send({
          error: {
            code: 'SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE',
            message: '持久社交观察窗口列表不可用。',
            retryable: true,
          },
        });
      }
    },
  );

  app.get(
    '/api/v1/research/social-observation-windows/:windowId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = SocialObservationWindowParamsSchema.parse(request.params);
      if (context.runtime.socialObservations === undefined) {
        return reply.code(503).send({
          error: {
            code: 'SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE',
            message: '持久社交观察仓库不可用。',
            retryable: false,
          },
        });
      }
      try {
        return publicWindow(await context.runtime.socialObservations.get(params.windowId));
      } catch (error) {
        const notFound =
          error instanceof Error &&
          'code' in error &&
          (error as { code: unknown }).code === 'SOCIAL_OBSERVATION_NOT_FOUND';
        return reply.code(notFound ? 404 : 503).send({
          error: {
            code: notFound
              ? 'SOCIAL_OBSERVATION_WINDOW_NOT_FOUND'
              : 'SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE',
            message: notFound ? '未找到社交观察窗口。' : '持久社交观察仓库不可用。',
            retryable: !notFound,
          },
        });
      }
    },
  );

  app.post(
    '/api/v1/research/social-observation-windows/:windowId/fetch-next',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = SocialObservationWindowParamsSchema.parse(request.params);
      const input = SocialObservationFetchSchema.parse(request.body);
      const observations = context.runtime.socialObservations;
      const procurement = context.runtime.dataProcurement;
      const evidenceRepository = context.runtime.evidenceRepository;
      const transport = context.runtime.socialFetchDependencies;
      if (
        observations === undefined ||
        procurement === undefined ||
        evidenceRepository === undefined ||
        transport === undefined
      ) {
        return reply.code(503).send({
          error: {
            code: 'SOCIAL_OBSERVATION_DURABILITY_UNAVAILABLE',
            message: '社交观察要求 PostgreSQL 观察、费用与 Evidence 仓库同时可用。',
            retryable: false,
          },
        });
      }
      const procurementRequestId = `social:${hashPayload({
        schema: 'zerotrace-social-dispatch-idempotency-v1',
        windowId: params.windowId,
        idempotencyKey: input.idempotencyKey,
      }).slice(0, 32)}`;
      const prior = await observations.receiptForRequest(procurementRequestId);
      if (prior !== undefined) {
        if (prior.windowId !== params.windowId) {
          return reply.code(409).send({
            error: {
              code: 'SOCIAL_OBSERVATION_IDEMPOTENCY_CONFLICT',
              message: '幂等键已绑定其他社交观察窗口。',
              retryable: false,
            },
          });
        }
        return {
          replayed: true,
          networkRequestPerformed: false,
          receipt: prior,
          window: publicWindow(await observations.get(params.windowId)),
        };
      }
      let windowRecord;
      try {
        windowRecord = await observations.get(params.windowId);
      } catch (error) {
        const notFound =
          error instanceof Error &&
          'code' in error &&
          (error as { code: unknown }).code === 'SOCIAL_OBSERVATION_NOT_FOUND';
        return reply.code(notFound ? 404 : 503).send({
          error: {
            code: notFound
              ? 'SOCIAL_OBSERVATION_WINDOW_NOT_FOUND'
              : 'SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE',
            message: notFound ? '未找到社交观察窗口。' : '持久社交观察仓库不可用。',
            retryable: !notFound,
          },
        });
      }
      if (windowRecord.window.completed) {
        return reply.code(409).send({
          error: {
            code: 'SOCIAL_OBSERVATION_WINDOW_COMPLETE',
            message: '该社交观察窗口已经完成全部可访问分页。',
            retryable: false,
          },
        });
      }
      const configured = context.runtime.socialSources ?? [FXEMBED_TEMPLATE, XAPID_TEMPLATE];
      const source = configured.find(
        (candidate) => candidate.id === windowRecord.window.providerId,
      );
      if (
        source === undefined ||
        sourceStatus(source) !== 'READY' ||
        source.dispatch === null ||
        source.contentPolicy === null ||
        source.search === null ||
        source.search.temporal === null ||
        source.contractVersion !== windowRecord.window.contractVersion ||
        hashPayload(source.search.temporal) !== hashPayload(windowRecord.temporalContract) ||
        source.contentPolicy.policyVersion !== windowRecord.contentPolicyVersion ||
        hashPayload([...source.contentPolicy.rightsEvidenceIds].sort()) !==
          hashPayload([...windowRecord.rightsEvidenceIds].sort())
      ) {
        return reply.code(409).send({
          error: {
            code: 'SOCIAL_OBSERVATION_CONTRACT_CHANGED',
            message: '来源合同、权益、费用或查询版本已变化；旧窗口禁止继续发网。',
            retryable: false,
          },
        });
      }
      if (!(await rightsEvidenceAvailable(context, source))) {
        return reply.code(409).send({
          error: {
            code: 'RESEARCH_RIGHTS_EVIDENCE_INCOMPLETE',
            message: '来源权益合同引用的持久证据不完整。',
            retryable: false,
          },
        });
      }
      if (source.dispatch.costKind !== 'VERIFIED_FREE') {
        return reply.code(409).send({
          error: {
            code: 'SOCIAL_OBSERVATION_COST_RECEIPT_UNAVAILABLE',
            message: '当前读取链只支持已核验免费单位；付费来源缺少逐请求费用回执映射。',
            retryable: false,
          },
        });
      }
      const plan = makeSearchPlan(
        source,
        windowRecord.approvedQuery,
        windowRecord.window.queryVersion,
        windowRecord.window.cursor,
        windowRecord.pageSize,
        { from: windowRecord.window.from, until: windowRecord.window.until },
      );
      const now = Date.now();
      const quote: Quote = {
        requestId: procurementRequestId,
        fingerprint: hashPayload(plan),
        providerId: source.id,
        accountId: source.dispatch.accountId,
        costKind: source.dispatch.costKind,
        maxUnits: source.dispatch.maxUnits,
        maxMicrousd: source.dispatch.maxMicrousd,
        evidence: source.dispatch.costEvidence,
        expiresAt: now + source.dispatch.quoteTtlSeconds * 1_000,
      };
      let policyVersion: string;
      try {
        const reserved = await procurement.reserve('global', quote, now);
        policyVersion = reserved.policy.version;
      } catch {
        return reply.code(409).send({
          error: {
            code: 'SOCIAL_OBSERVATION_BUDGET_NOT_RESERVED',
            message: '持久费用或额度权威拒绝了本次读取预占。',
            retryable: false,
          },
        });
      }
      let dispatched = false;
      try {
        const page = await fetchSearchPage(
          source,
          plan,
          {
            fetcher: transport.fetcher,
            approvePublicOrigin: transport.approvePublicOrigin,
            claimDispatch: async (claimedPlan) => {
              if (hashPayload(claimedPlan) !== quote.fingerprint) return false;
              await procurement.dispatch('global', procurementRequestId, policyVersion, Date.now());
              dispatched = true;
              return true;
            },
            readSecret: async (ref) => {
              if (ref !== source.authentication.secretRef) throw new Error('SECRET_SCOPE_MISMATCH');
              return transport.readSecret(ref);
            },
          },
          {
            timeoutMs: source.dispatch.timeoutMs,
            maxBytes: source.dispatch.maxResponseBytes,
          },
          new Date().toISOString(),
        );
        if (plan.temporalWindow === null) throw new Error('TEMPORAL_WINDOW_MISSING');
        const requestedFrom = Date.parse(plan.temporalWindow.requestedFrom);
        const requestedUntil = Date.parse(plan.temporalWindow.requestedUntil);
        const boundedPage = {
          ...page,
          posts: page.posts.filter((post) => {
            const createdAt = Date.parse(post.createdAt);
            return createdAt >= requestedFrom && createdAt < requestedUntil;
          }),
        };
        const records = boundedPage.posts.map((post) =>
          prepareExternalContentRecord(source, post, post.observedAt),
        );
        const evidenceIds = await Promise.all(
          records.map(async (record, index) => {
            const post = boundedPage.posts[index];
            if (post === undefined) throw new Error('SOCIAL_PAGE_INDEX_MISMATCH');
            const evidence = createEvidence({
              ledger: windowRecord.ledger,
              chainId: windowRecord.chainId,
              kind: 'PROVIDER_OBSERVATION',
              source: source.id,
              locator: `social:${source.id}:${post.id}`,
              sourceUri: post.permalink,
              payload: record,
              observedAt: post.observedAt,
              summary: 'X 上游只读帖子观察；不代表链上事实或独立来源互证。',
            });
            const stored = await evidenceRepository.put(evidence);
            return stored.evidence.id;
          }),
        );
        const committed = await observations.commitPage({
          windowId: params.windowId,
          procurementRequestId,
          page: boundedPage,
          records,
          evidenceIds,
          settlement: { scopeId: 'global', units: '1', microusd: '0' },
        });
        return {
          replayed: false,
          networkRequestPerformed: true,
          receipt: committed.receipt,
          window: publicWindow(committed.window),
        };
      } catch (error) {
        try {
          await procurement.finish(
            'global',
            procurementRequestId,
            dispatched
              ? { kind: 'CHARGED', units: '1', microusd: '0' }
              : { kind: 'NOT_DISPATCHED' },
          );
        } catch {
          return reply.code(503).send({
            error: {
              code: 'SOCIAL_OBSERVATION_COST_RECONCILIATION_FAILED',
              message: '读取失败且费用状态无法安全对账，费用权威已保持失败关闭。',
              retryable: false,
            },
          });
        }
        return reply.code(dispatched ? 502 : 409).send({
          error: {
            code: dispatched
              ? 'SOCIAL_OBSERVATION_PROVIDER_FAILED'
              : 'SOCIAL_OBSERVATION_DISPATCH_REJECTED',
            message: dispatched
              ? '只读来源请求失败；该页未推进，已按一次免费单位对账。'
              : '只读来源请求未发出，额度预占已退回。',
            retryable: dispatched,
            diagnostic:
              error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
                ? error.message
                : 'SOCIAL_OBSERVATION_FAILED',
          },
        });
      }
    },
  );
}
