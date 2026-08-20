import { statfsSync } from 'node:fs';

import type { DataClass, QuotaLevel, StorageProfile, StorageQuotaView } from './types.js';

/** ZeroTrace 预算 =（当前已用 + 磁盘剩余）的 70%，即不超过当前可用空间的 70%。 */
export const QUOTA_FRACTION_OF_FREE = 0.7;

export function quotaLevel(usedBytes: number, budgetBytes: number): QuotaLevel {
  if (budgetBytes <= 0) return 'EVIDENCE_ONLY';
  const ratio = usedBytes / budgetBytes;
  if (ratio >= 0.92) return 'EVIDENCE_ONLY';
  if (ratio >= 0.88) return 'STOP_NEW_FULL_LIFETIME';
  if (ratio >= 0.82) return 'COMPACT_AND_EVICT';
  if (ratio >= 0.75) return 'STOP_PREFETCH';
  if (ratio >= 0.65) return 'WARN';
  return 'OK';
}

export function allowsPrefetch(level: QuotaLevel): boolean {
  return level === 'OK' || level === 'WARN';
}

export function allowsFullLifetime(level: QuotaLevel): boolean {
  return (
    level === 'OK' || level === 'WARN' || level === 'STOP_PREFETCH' || level === 'COMPACT_AND_EVICT'
  );
}

export function allowsNonEvidenceWrite(level: QuotaLevel): boolean {
  return level !== 'EVIDENCE_ONLY';
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(2)} ${units[index]}`;
}

export function measureDisk(rootDir: string): { freeBytes: number; totalBytes: number } {
  const stats = statfsSync(rootDir);
  const bsize = Number(stats.bsize);
  return {
    freeBytes: Number(stats.bavail) * bsize,
    totalBytes: Number(stats.blocks) * bsize,
  };
}

export function budgetFromFree(freeBytes: number): number {
  return Math.floor(Math.max(0, freeBytes) * QUOTA_FRACTION_OF_FREE);
}

const LEVEL_LABEL: Record<QuotaLevel, string> = {
  OK: '正常',
  WARN: '告警',
  STOP_PREFETCH: '停止预取',
  COMPACT_AND_EVICT: '压缩并驱逐',
  STOP_NEW_FULL_LIFETIME: '停止新的全生命周期',
  EVIDENCE_ONLY: '仅保留案件证据',
};

const CLASS_LABEL: Record<DataClass, string> = {
  PERMANENT_EVIDENCE: '不可删除证据',
  NORMALIZED_FACT: '规范化事实',
  EPHEMERAL: '可重建缓存',
};

export function buildQuotaView(input: {
  profile: StorageProfile;
  usedBytes: number;
  freeBytes: number;
  rebuildableBytes: number;
  permanentEvidenceBytes: number;
  dailyGrowthBytes: number;
  evictingClass?: DataClass;
}): StorageQuotaView {
  const budgetBytes = budgetFromFree(input.freeBytes + input.usedBytes);
  const level = quotaLevel(input.usedBytes, budgetBytes);
  const remaining = Math.max(0, budgetBytes - input.usedBytes);
  const estimatedFullAt =
    input.dailyGrowthBytes > 0 && remaining > 0
      ? new Date(Date.now() + (remaining / input.dailyGrowthBytes) * 86_400_000).toISOString()
      : null;
  return {
    profile: input.profile,
    level,
    usedBytes: input.usedBytes,
    budgetBytes,
    freeBytes: input.freeBytes,
    rebuildableBytes: input.rebuildableBytes,
    permanentEvidenceBytes: input.permanentEvidenceBytes,
    dailyGrowthBytes: input.dailyGrowthBytes,
    estimatedFullAt,
    evictingClass: input.evictingClass ?? null,
    labels: {
      used: `当前使用 ${formatBytes(input.usedBytes)} / 预算 ${formatBytes(budgetBytes)}`,
      rebuildable: `可重建数据 ${formatBytes(input.rebuildableBytes)}`,
      permanent: `不可删除证据 ${formatBytes(input.permanentEvidenceBytes)}`,
      dailyGrowth: `每日增长 ${formatBytes(input.dailyGrowthBytes)}`,
      fullAt:
        estimatedFullAt === null
          ? '预计满盘日期 未知（增长为 0 或样本不足）'
          : `预计满盘日期 ${estimatedFullAt}`,
      evicting:
        input.evictingClass === undefined
          ? '正在清理的类别 无'
          : `正在清理的类别 ${CLASS_LABEL[input.evictingClass]}`,
      level: LEVEL_LABEL[level],
    },
  };
}
