import {
  createReadOnlyQueryPolicy,
  guardReadOnlyQuery,
  QuerySecurityError,
} from '@zerotrace/query-security';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const QUERY_CATALOG_VERSION = 'query-catalog-v1.0.0';
const QueryPlanBodySchema = z
  .object({
    sql: z.string().min(1).max(65_536),
  })
  .strict();

const catalog = [
  {
    name: 'curated.evidence_index',
    chineseName: '证据索引',
    grain: '每个不可变 Evidence 一行',
    source: 'PostgreSQL public.evidence',
    migration: '044_readonly_query_views',
    fields: [
      'id',
      'ledger',
      'chain_id',
      'evidence_kind',
      'source',
      'observed_at',
      'block_or_slot',
      'finality',
      'summary',
      'snapshot_id',
      'created_at',
    ],
    pointInTimeColumns: ['observed_at', 'created_at'],
    excludedSensitiveFields: ['locator', 'source_uri', 'raw_artifact_ref', 'payload_hash'],
  },
  {
    name: 'curated.analysis_snapshot_index',
    chineseName: '分析快照索引',
    grain: '每个固定账本位置与配置哈希一行',
    source: 'PostgreSQL public.analysis_snapshots',
    migration: '044_readonly_query_views',
    fields: [
      'id',
      'ledger',
      'chain_id',
      'block_or_slot',
      'block_hash',
      'commitment',
      'captured_at',
      'entity_model_version',
      'simulation_version',
      'label_snapshot',
      'config_hash',
      'created_at',
    ],
    pointInTimeColumns: ['captured_at', 'created_at'],
    excludedSensitiveFields: ['payload', 'provider_versions', 'adapter_versions'],
  },
] as const;

const policy = createReadOnlyQueryPolicy({
  allowedRelations: catalog.map((relation) => relation.name),
  allowedFunctions: ['count', 'sum', 'min', 'max', 'avg', 'coalesce', 'lower', 'upper'],
});

export async function registerQueryLabRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/query/catalog', { schema: { tags: ['analysis'] } }, async () => ({
    version: QUERY_CATALOG_VERSION,
    status: 'PLAN_ONLY_EXECUTION_DISABLED',
    relations: catalog,
    limits: {
      maxSqlBytes: policy.maxSqlBytes,
      maxRows: policy.maxRows,
      maxOffset: policy.maxOffset,
      maxRelations: policy.maxRelations,
      maxSubqueries: policy.maxSubqueries,
      maxParameters: policy.maxParameters,
      maxScanBytes: policy.maxScanBytes,
      timeoutMs: policy.timeoutMs,
    },
    executionBoundary:
      '仅提供 AST 安全计划；独立只读数据库角色、租户行级策略、取消/成本执行器与真实 PostgreSQL 验收完成前不执行 SQL。',
  }));

  app.post('/api/v1/query/plan', { schema: { tags: ['analysis'] } }, async (request, reply) => {
    const body = QueryPlanBodySchema.parse(request.body);
    try {
      return {
        catalogVersion: QUERY_CATALOG_VERSION,
        executionStatus: 'DISABLED',
        admission: guardReadOnlyQuery(body.sql, policy),
        limitations: [
          '计划通过不表示 SQL 已执行。',
          '未配置独立只读数据库角色与租户行级策略。',
          '未生成查询结果、Evidence、Snapshot 或指标结论。',
        ],
      };
    } catch (error) {
      if (!(error instanceof QuerySecurityError)) throw error;
      return reply.code(400).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
        },
      });
    }
  });
}
