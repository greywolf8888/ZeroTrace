import { STORAGE_PROFILES, type OptionalComponentStatus, type StorageProfile } from './types.js';

export const DEFAULT_STORAGE_PROFILE: StorageProfile = 'LOW_COST_CASE';

export function parseStorageProfile(value: string | undefined): StorageProfile {
  if (value === undefined || value === '') return DEFAULT_STORAGE_PROFILE;
  if ((STORAGE_PROFILES as readonly string[]).includes(value)) return value as StorageProfile;
  throw new Error(`ZEROTRACE_STORAGE_PROFILE 非法：${value}`);
}

export function lowCostConcurrency(profile: StorageProfile): {
  acquisition: number;
  token: number;
  trace: number;
  aimdMax: number;
} {
  if (profile === 'LOW_COST_CASE') {
    return { acquisition: 1, token: 1, trace: 1, aimdMax: 1 };
  }
  if (profile === 'SELECTIVE_MARKET_INDEX') {
    return { acquisition: 2, token: 1, trace: 1, aimdMax: 2 };
  }
  return { acquisition: 2, token: 1, trace: 1, aimdMax: 2 };
}

export function clickhouseEnabled(profile: StorageProfile, clickhouseConfigured: boolean): boolean {
  return clickhouseConfigured && profile !== 'LOW_COST_CASE';
}

export function optionalComponentStatuses(input: {
  postgres: boolean;
  clickhouse: boolean;
  minio: boolean;
  archiveNode: boolean;
}): OptionalComponentStatus[] {
  const row = (
    id: OptionalComponentStatus['id'],
    configured: boolean,
    note: string,
  ): OptionalComponentStatus => ({
    id,
    status: configured ? 'CONFIGURED' : 'UNCONFIGURED',
    note,
  });
  return [
    row('postgres', input.postgres, '仅控制面。缺省时使用本地 JSON 控制面，进程仍启动。'),
    row('clickhouse', input.clickhouse, '可选热层。LOW_COST_CASE 默认不启用。'),
    row('minio', input.minio, '可选对象存储。缺省使用 LocalFsArtifactStore。'),
    row('archiveNode', input.archiveNode, '不在本机建设完整 Archive；仅经能力平面远程接入。'),
  ];
}
