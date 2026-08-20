import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { IndexedTransfer, LocalIndexStore } from '@zerotrace/local-index';
import { tokenKey } from '@zerotrace/local-index';

import { FileCoverageRegistry } from './coverage.js';
import { ClickHouseFactStore, DuckDbParquetFactStore, DualFactStore } from './facts.js';
import { LocalFsArtifactStore } from './artifacts.js';
import { MemoryCacheStore } from './cache.js';
import { JsonFileMetadataStore } from './metadata.js';
import { clickhouseEnabled, optionalComponentStatuses } from './profile.js';
import { buildQuotaView, measureDisk } from './quota.js';
import type {
  ArtifactStore,
  CacheStore,
  CoverageRecord,
  CoverageRegistry,
  FactStore,
  MetadataStore,
  NormalizedFact,
  OptionalComponentStatus,
  OriginCheckpoint,
  StageCheckpoint,
  StorageProfile,
  StorageQuotaView,
} from './types.js';

export interface StoragePlaneOptions {
  rootDir: string;
  profile: StorageProfile;
  postgresConfigured?: boolean;
  clickhouseUrl?: string;
  minioConfigured?: boolean;
  archiveNodeConfigured?: boolean;
  metadata?: MetadataStore;
  facts?: FactStore;
  artifacts?: ArtifactStore;
  coverage?: CoverageRegistry;
  cache?: CacheStore;
}

export interface StoragePlane {
  profile: StorageProfile;
  rootDir: string;
  metadata: MetadataStore;
  facts: FactStore;
  hotFacts?: FactStore;
  artifacts: ArtifactStore;
  coverage: CoverageRegistry;
  cache: CacheStore;
  optional: OptionalComponentStatus[];
  inspectQuota(dailyGrowthBytes?: number): Promise<StorageQuotaView>;
  applyWatermarks(): Promise<{ compacted: boolean; evicted: number; level: StorageQuotaView['level'] }>;
}

function directoryBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stats = statSync(full);
    total += stats.isDirectory() ? directoryBytes(full) : stats.size;
  }
  return total;
}

export function openStoragePlane(options: StoragePlaneOptions): StoragePlane {
  mkdirSync(options.rootDir, { recursive: true });
  const parquet = options.facts ?? new DuckDbParquetFactStore(options.rootDir);
  const hot =
    options.clickhouseUrl === undefined || !clickhouseEnabled(options.profile, true)
      ? undefined
      : new ClickHouseFactStore(options.clickhouseUrl);
  const facts =
    hot === undefined || options.profile === 'LOW_COST_CASE'
      ? parquet
      : new DualFactStore(parquet, hot);
  const artifacts = options.artifacts ?? new LocalFsArtifactStore(options.rootDir);
  const metadata = options.metadata ?? new JsonFileMetadataStore(options.rootDir);
  const coverage = options.coverage ?? new FileCoverageRegistry(options.rootDir);
  const cache = options.cache ?? new MemoryCacheStore();
  const optional = optionalComponentStatuses({
    postgres: options.postgresConfigured === true,
    clickhouse: options.clickhouseUrl !== undefined && options.clickhouseUrl.length > 0,
    minio: options.minioConfigured === true,
    archiveNode: options.archiveNodeConfigured === true,
  });

  const inspectQuota = async (dailyGrowthBytes = 0): Promise<StorageQuotaView> => {
    const usedBytes = directoryBytes(options.rootDir);
    const disk = measureDisk(options.rootDir);
    const permanent = await artifacts.byteSize('PERMANENT_EVIDENCE');
    const ephemeral = await artifacts.byteSize('EPHEMERAL');
    const cacheBytes = await cache.byteSize();
    return buildQuotaView({
      profile: options.profile,
      usedBytes,
      freeBytes: disk.freeBytes,
      rebuildableBytes: ephemeral + cacheBytes,
      permanentEvidenceBytes: permanent,
      dailyGrowthBytes,
    });
  };

  return {
    profile: options.profile,
    rootDir: options.rootDir,
    metadata,
    facts,
    ...(hot === undefined ? {} : { hotFacts: hot }),
    artifacts,
    coverage,
    cache,
    optional,
    inspectQuota,
    async applyWatermarks() {
      const view = await inspectQuota();
      let compacted = false;
      let evicted = 0;
      if (view.level === 'COMPACT_AND_EVICT' || view.level === 'STOP_NEW_FULL_LIFETIME' || view.level === 'EVIDENCE_ONLY') {
        await facts.compact();
        compacted = true;
        evicted += await cache.evictExpired(Date.now());
        evicted += await cache.evictLru(Math.floor(view.budgetBytes * 0.2));
        if (artifacts.evictExpired !== undefined) evicted += await artifacts.evictExpired(Date.now());
        if (artifacts.evictLru !== undefined) {
          evicted += await artifacts.evictLru(Math.floor(view.budgetBytes * 0.5));
        }
      }
      return { compacted, evicted, level: (await inspectQuota()).level };
    },
  };
}

export function transferToFact(item: IndexedTransfer, adapterVersion: string): NormalizedFact {
  return {
    token: item.token.toLowerCase(),
    blockOrSlot: item.blockNumber.toString(10),
    blockHash: '',
    transactionId: item.transactionHash,
    transactionIndex: '',
    logOrInstructionIndex: String(item.logIndex),
    subjectA: item.from,
    subjectB: item.to,
    asset: item.token.toLowerCase(),
    amountAtomic: item.valueAtomic,
    eventType: 'Transfer',
    evidenceId: `${item.transactionHash}:${item.logIndex}`,
    sourceId: 'local-index',
    adapterVersion,
  };
}

export function factToTransfer(chainId: string, fact: NormalizedFact): IndexedTransfer {
  return {
    chainId,
    token: fact.token,
    blockNumber: BigInt(fact.blockOrSlot || '0'),
    logIndex: Number(fact.logOrInstructionIndex || '0'),
    transactionHash: fact.transactionId,
    from: fact.subjectA,
    to: fact.subjectB,
    valueAtomic: fact.amountAtomic,
  };
}

export async function hydrateLocalIndex(input: {
  plane: StoragePlane;
  index: LocalIndexStore;
  chainId: string;
  token: string;
}): Promise<{ origin?: OriginCheckpoint; records: CoverageRecord[] }> {
  const records = await input.plane.coverage.read(input.chainId, input.token, 'Transfer');
  const key = tokenKey(input.chainId, input.token);
  for (const record of records) {
    input.index.putCoverage(key, {
      startBlock: BigInt(record.startBlock),
      endBlock: BigInt(record.endBlock),
    });
  }
  const facts = await input.plane.facts.queryByToken(input.token, 'Transfer');
  input.index.putTransfers(
    key,
    facts.map((fact) => factToTransfer(input.chainId, fact)),
  );
  const raw = await input.plane.metadata.get(`origin/${input.chainId}/${input.token.toLowerCase()}`);
  return {
    records,
    ...(raw === undefined ? {} : { origin: JSON.parse(raw) as OriginCheckpoint }),
  };
}

export async function persistLocalIndex(input: {
  plane: StoragePlane;
  index: LocalIndexStore;
  chainId: string;
  token: string;
  origin?: OriginCheckpoint;
  stages?: readonly StageCheckpoint[];
}): Promise<{ parquetBytes: number; eventCount: number }> {
  const key = tokenKey(input.chainId, input.token);
  const transfers = input.index.transfers(key);
  const facts = transfers.map((item) => transferToFact(item, 'token-market-capture-v1'));
  const appended = await input.plane.facts.append(facts);
  for (const span of input.index.coverage(key)) {
    await input.plane.coverage.commit({
      chainId: input.chainId,
      token: input.token.toLowerCase(),
      factType: 'Transfer',
      startBlock: span.startBlock.toString(10),
      endBlock: span.endBlock.toString(10),
      updatedAt: new Date().toISOString(),
    });
  }
  if (input.origin !== undefined) {
    await input.plane.metadata.put(
      `origin/${input.chainId}/${input.token.toLowerCase()}`,
      JSON.stringify(input.origin),
    );
  }
  for (const stage of input.stages ?? []) {
    await input.plane.metadata.put(
      `stage/${stage.chainId}/${stage.token.toLowerCase()}/${stage.stage}`,
      JSON.stringify(stage),
    );
  }
  return { parquetBytes: appended.bytes, eventCount: facts.length };
}
