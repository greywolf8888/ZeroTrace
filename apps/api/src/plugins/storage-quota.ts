import type { FastifyInstance } from 'fastify';

import type { AppHttpContext } from '../http/context.js';

export async function registerStoragePlaneRoutes(
  app: FastifyInstance,
  ctx: AppHttpContext,
): Promise<void> {
  app.get('/api/v1/storage/quota', { schema: { tags: ['system'] } }, async () => {
    const plane = ctx.runtime.storagePlane;
    if (plane === undefined) {
      return {
        profile: ctx.config.storageProfile,
        level: 'OK',
        labels: {
          used: '当前使用 未知',
          rebuildable: '可重建数据 未知',
          permanent: '不可删除证据 未知',
          dailyGrowth: '每日增长 未知',
          fullAt: '预计满盘日期 未知（存储平面未初始化）',
          evicting: '正在清理的类别 无',
          level: '正常',
        },
      };
    }
    return plane.inspectQuota();
  });

  app.get('/api/v1/storage/profile', { schema: { tags: ['system'] } }, async () => {
    const plane = ctx.runtime.storagePlane;
    const quota = plane === undefined ? undefined : await plane.inspectQuota();
    return {
      profile: ctx.config.storageProfile,
      root: ctx.config.storageRoot,
      optional: plane?.optional ?? [],
      quota,
      note: 'LOW_COST_CASE 默认不启用 ClickHouse、MinIO 或本机 Archive。缺少可选组件时进程仍启动；Unknown 不得变成 0。',
    };
  });
}
