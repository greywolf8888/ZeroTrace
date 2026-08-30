import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  externalContentPolicyStatus,
  FXEMBED_TEMPLATE,
  makeSearchPlan,
  XAPID_TEMPLATE,
  type SocialSourceConfig,
} from '@zerotrace/provider-plane';
import { buildIdentityQueries, compileApprovedQuery } from '@zerotrace/workflow-core';

import type { AppHttpContext } from '../http/context.js';

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
const SocialQueryPlanSchema = z
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
  })
  .strict();

function sourceStatus(
  source: SocialSourceConfig,
):
  | 'READY'
  | 'DISABLED'
  | 'UNVERIFIED_IDENTITY'
  | 'RIGHTS_NOT_APPROVED'
  | 'CONTRACT_INCOMPLETE'
  | 'CONTENT_POLICY_UNCONFIGURED'
  | 'CONTENT_POLICY_INACTIVE' {
  if (!source.identityVerified) return 'UNVERIFIED_IDENTITY';
  if (!source.rightsApproved) return 'RIGHTS_NOT_APPROVED';
  if (source.origin === null || source.documentation === null || source.search === null) {
    return 'CONTRACT_INCOMPLETE';
  }
  const contentPolicy = externalContentPolicyStatus(source);
  if (contentPolicy === 'UNCONFIGURED') return 'CONTENT_POLICY_UNCONFIGURED';
  if (contentPolicy === 'INACTIVE') return 'CONTENT_POLICY_INACTIVE';
  return source.enabled ? 'READY' : 'DISABLED';
}

function publicSource(source: SocialSourceConfig, durableDispatchAvailable: boolean) {
  return {
    providerId: source.id,
    displayName: source.id === 'xapid' ? 'xapid（待确认具体服务）' : 'FxEmbed',
    status: sourceStatus(source),
    enabled: source.enabled,
    identityVerified: source.identityVerified,
    rightsApproved: source.rightsApproved,
    endpointConfigured: source.origin !== null && source.search !== null,
    documentation: source.documentation,
    contractVersion: source.contractVersion,
    contentPolicy:
      source.contentPolicy === null
        ? {
            status: 'UNCONFIGURED',
            retention: null,
            deletionMode: null,
            externalAi: 'PROHIBITED',
          }
        : {
            status: externalContentPolicyStatus(source),
            policyVersion: source.contentPolicy.policyVersion,
            rightsStatus: source.contentPolicy.rightsStatus,
            retention: source.contentPolicy.retention,
            deletionMode: source.contentPolicy.deletionMode,
            externalAi: source.contentPolicy.externalAi,
            expiresAt: source.contentPolicy.expiresAt,
          },
    authenticationConfigured:
      source.authentication.kind === 'NONE' || source.authentication.secretRef !== null,
    upstreamGroup: source.upstreamGroup,
    dispatchAllowed: sourceStatus(source) === 'READY' && durableDispatchAvailable,
  };
}

export async function registerResearchSourceRoutes(
  app: FastifyInstance,
  context: AppHttpContext,
): Promise<void> {
  app.get('/api/v1/settings/research-sources', { schema: { tags: ['system'] } }, async () => {
    const configured = context.runtime.socialSources ?? [FXEMBED_TEMPLATE, XAPID_TEMPLATE];
    let procurement:
      | {
          status: 'DURABLE';
          remainingMicrousd: string;
          paidEnabled: boolean;
          blocked: boolean;
          revision: number;
          updatedAt: string;
        }
      | {
          status: 'UNAVAILABLE' | 'NOT_INITIALIZED';
          remainingMicrousd: null;
          paidEnabled: false;
          blocked: null;
          revision: null;
          updatedAt: null;
          reason: string;
        };
    if (context.runtime.dataProcurement === undefined) {
      procurement = {
        status: 'UNAVAILABLE',
        remainingMicrousd: null,
        paidEnabled: false,
        blocked: null,
        revision: null,
        updatedAt: null,
        reason: 'DURABLE_STORAGE_UNAVAILABLE',
      };
    } else {
      try {
        const record = await context.runtime.dataProcurement.get('global');
        procurement = {
          status: 'DURABLE',
          remainingMicrousd: record.state.remainingMicrousd,
          paidEnabled: record.policy.paidAllowed,
          blocked: record.state.blocked,
          revision: record.state.revision,
          updatedAt: record.updatedAt,
        };
      } catch (error) {
        procurement = {
          status: 'NOT_INITIALIZED',
          remainingMicrousd: null,
          paidEnabled: false,
          blocked: null,
          revision: null,
          updatedAt: null,
          reason:
            error instanceof Error && 'code' in error
              ? String((error as { code: unknown }).code)
              : 'DATA_PROCUREMENT_UNAVAILABLE',
        };
      }
    }
    return {
      policyVersion: 'data-policy-v11.0',
      procurementBudgetMicrousd: '0',
      paidEnabledByDefault: false,
      credentialsAreSpendConsent: false,
      unknownPrice: 'BLOCK',
      autoFailoverToPaid: false,
      procurement,
      sources: configured.map((source) =>
        publicSource(source, procurement.status === 'DURABLE' && procurement.blocked === false),
      ),
      xUpstreamEvidenceRule: 'ALL_X_TOOLS_ONE_UPSTREAM_GROUP',
    };
  });

  app.post(
    '/api/v1/research/social-query-plans',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = SocialQueryPlanSchema.parse(request.body);
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
            message: '研究来源身份、权益、内容规则或端点合同尚未全部核验。',
            retryable: false,
            sourceStatus: status,
          },
        });
      }
      if (context.runtime.evidenceRepository === undefined) {
        return reply.code(503).send({
          error: {
            code: 'RESEARCH_RIGHTS_EVIDENCE_UNAVAILABLE',
            message: '未配置持久证据仓库，不能核验来源权益合同。',
            retryable: false,
          },
        });
      }
      const rightsEvidence = await Promise.all(
        source.contentPolicy.rightsEvidenceIds.map((id) =>
          context.runtime.evidenceRepository?.get(id),
        ),
      );
      if (rightsEvidence.some((node) => node === undefined)) {
        return reply.code(409).send({
          error: {
            code: 'RESEARCH_RIGHTS_EVIDENCE_INCOMPLETE',
            message: '来源权益合同引用的持久证据不完整。',
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
      const plans = compiled.queries.map(({ role, query }) => {
        const approvedQuery = compileApprovedQuery(
          query,
          source.search!.maxQueryChars,
          input.queryVersion,
        );
        const plan = makeSearchPlan(
          source,
          approvedQuery,
          input.queryVersion,
          null,
          input.pageSize,
        );
        return { role, approvedQuery, plan };
      });
      return {
        mode: 'READ_ONLY_RESEARCH_PLAN' as const,
        sourceId: source.id,
        assetKey: compiled.assetKey,
        queryVersion: compiled.version,
        contractVersion: source.contractVersion,
        contentPolicyVersion: source.contentPolicy.policyVersion,
        rightsEvidenceIds: [...source.contentPolicy.rightsEvidenceIds].sort(),
        upstreamEvidenceGroup: 'X' as const,
        plans,
        networkRequestPerformed: false,
        dispatchState: 'NOT_RESERVED' as const,
        warning: '该入口只生成固定合同的读取计划；未预留额度、未发出网络请求。',
      };
    },
  );
}
