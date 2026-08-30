import { createCoreMetricRegistry, METRIC_EVALUATOR_VERSION } from '@zerotrace/metric-registry';
import type { FastifyInstance } from 'fastify';

const METRICS_CATALOG_VERSION = 'metrics-catalog-v1.0.0';
const registry = createCoreMetricRegistry();

export async function registerMetricsLabRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/metrics-lab/catalog', { schema: { tags: ['analysis'] } }, async () => ({
    version: METRICS_CATALOG_VERSION,
    evaluatorVersion: METRIC_EVALUATOR_VERSION,
    status: 'VERSIONED_REGISTRY_READY_EXECUTION_API_DISABLED',
    definitions: registry.list(),
    invariants: [
      '公式只接受受控 AST，不执行任意代码。',
      'Point-in-Time 计算只读取 eventTime 与 knownAt 均不晚于 asOf 的同 Snapshot Observation。',
      'Unknown、Unavailable、Stale 与 Provider Down 保持不同状态，绝不填充为数值零。',
      'Evidence Score 仅表示证据质量，不是校准概率。',
      '地址、钱包、实体与控制人是不同口径；RAW 指标不得解释为 ENTITY_ADJUSTED。',
    ],
    executionBoundary:
      '当前公开版本化定义目录。持久 Observation 仓库、租户授权、Cohort、完整指标物化与命名实链回放通过前，不开放远程求值，也不宣称 X70 完成。',
  }));
}
