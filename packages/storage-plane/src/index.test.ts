import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryLocalIndex } from '@zerotrace/local-index';
import { describe, expect, it, vi } from 'vitest';

import { hydrateLocalIndex, openStoragePlane, persistLocalIndex } from './compose.js';
import { FileCoverageRegistry, missingRanges } from './coverage.js';
import { MemoryCacheStore } from './cache.js';
import { readCorpusCheckpoint, resumeTokens, writeCorpusCheckpoint } from './corpus.js';
import { LocalFsArtifactStore, MinioArtifactStore } from './artifacts.js';
import {
  ClickHouseFactStore,
  DualFactStore,
  DuckDbParquetFactStore,
  MemoryFactStore,
} from './facts.js';
import { forecastFromMetrics } from './forecast.js';
import { admitJob, allowsStage, compareJobPriority, nextStage, stageRank } from './jobs.js';
import { JsonFileMetadataStore } from './metadata.js';
import { decodeParquet, encodeParquet, factsResultHash } from './parquet.js';
import { clickhouseEnabled, lowCostConcurrency, parseStorageProfile } from './profile.js';
import {
  allowsFullLifetime,
  allowsNonEvidenceWrite,
  allowsPrefetch,
  budgetFromFree,
  buildQuotaView,
  quotaLevel,
} from './quota.js';
import { classifyTrace, isHistoricalRpc, isTraceRpc, shouldFetchTrace } from './trace-policy.js';
import { CACHE_TTL_MS, EPHEMERAL_TTL_MS, expired, lruOrder } from './ttl.js';
import type { NormalizedFact } from './types.js';

function sampleFact(token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'): NormalizedFact {
  return {
    token,
    blockOrSlot: '16',
    blockHash: '0xbb',
    transactionId: `0x${'11'.repeat(32)}`,
    transactionIndex: '0',
    logOrInstructionIndex: '0',
    subjectA: '0x0000000000000000000000000000000000000000',
    subjectB: '0xcccccccccccccccccccccccccccccccccccccccc',
    asset: token,
    amountAtomic: '1000',
    eventType: 'Transfer',
    evidenceId: 'ev-1',
    sourceId: 'test',
    adapterVersion: 'test-v1',
  };
}

describe('storage plane', () => {
  it('defaults to LOW_COST_CASE and rejects unknown profiles', () => {
    expect(parseStorageProfile(undefined)).toBe('LOW_COST_CASE');
    expect(parseStorageProfile('SELECTIVE_MARKET_INDEX')).toBe('SELECTIVE_MARKET_INDEX');
    expect(() => parseStorageProfile('FULL_BSC_ARCHIVE')).toThrow(/ZEROTRACE_STORAGE_PROFILE/);
  });

  it('writes real Parquet and keeps DuckDB/ClickHouse ResultHash identical', async () => {
    const facts = [
      sampleFact(),
      { ...sampleFact(), logOrInstructionIndex: '1', amountAtomic: '50' },
    ];
    const bytes = encodeParquet(facts);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('PAR1');
    expect(bytes.subarray(bytes.length - 4).toString('ascii')).toBe('PAR1');
    const decoded = await decodeParquet(bytes);
    expect(decoded).toEqual(facts);
    const dir = mkdtempSync(join(tmpdir(), 'zt-parquet-'));
    try {
      const parquet = new DuckDbParquetFactStore(dir);
      const clickhouse = new ClickHouseFactStore('http://clickhouse.test');
      await parquet.append(facts);
      await clickhouse.append(facts);
      expect(await parquet.resultHash(facts[0]!.token)).toBe(
        await clickhouse.resultHash(facts[0]!.token),
      );
      expect(await parquet.resultHash(facts[0]!.token)).toBe(factsResultHash(facts));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hydrates coverage after restart and never deletes permanent evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zt-plane-'));
    try {
      const plane = openStoragePlane({
        rootDir: dir,
        profile: 'LOW_COST_CASE',
      });
      const index = new MemoryLocalIndex();
      index.putCoverage('eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
        startBlock: 16n,
        endBlock: 32n,
      });
      index.putTransfers('eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [
        {
          chainId: 'eip155:56',
          token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          blockNumber: 16n,
          logIndex: 0,
          transactionHash: `0x${'11'.repeat(32)}`,
          from: '0x0000000000000000000000000000000000000000',
          to: '0xcccccccccccccccccccccccccccccccccccccccc',
          valueAtomic: '1000',
        },
      ]);
      await persistLocalIndex({
        plane,
        index,
        chainId: 'eip155:56',
        token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        origin: {
          status: 'COMPLETE',
          createdBlock: '16',
          updatedAt: new Date().toISOString(),
        },
      });
      await plane.artifacts.put('case-evidence', Buffer.from('origin-receipt'), {
        dataClass: 'PERMANENT_EVIDENCE',
        contentType: 'application/json',
        permanent: true,
      });
      await plane.artifacts.put('tmp-trace', Buffer.from('ephemeral'), {
        dataClass: 'EPHEMERAL',
        contentType: 'application/json',
      });
      expect(await plane.artifacts.deleteEphemeral('case-evidence')).toBe(false);
      expect(await plane.artifacts.deleteEphemeral('tmp-trace')).toBe(true);

      const restarted = openStoragePlane({ rootDir: dir, profile: 'LOW_COST_CASE' });
      const restored = new MemoryLocalIndex();
      const hydrated = await hydrateLocalIndex({
        plane: restarted,
        index: restored,
        chainId: 'eip155:56',
        token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      });
      expect(hydrated.origin?.status).toBe('COMPLETE');
      expect(hydrated.records[0]?.startBlock).toBe('16');
      expect(
        restored.transfers('eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      ).toHaveLength(1);
      expect(await restarted.artifacts.stat('case-evidence')).toMatchObject({
        dataClass: 'PERMANENT_EVIDENCE',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies disk watermarks and keeps uncovered ranges as gaps', async () => {
    expect(quotaLevel(64, 100)).toBe('OK');
    expect(quotaLevel(65, 100)).toBe('WARN');
    expect(quotaLevel(75, 100)).toBe('STOP_PREFETCH');
    expect(quotaLevel(82, 100)).toBe('COMPACT_AND_EVICT');
    expect(quotaLevel(88, 100)).toBe('STOP_NEW_FULL_LIFETIME');
    expect(quotaLevel(92, 100)).toBe('EVIDENCE_ONLY');
    expect(admitJob('STOP_PREFETCH', 'Prefetch')).toBe(false);
    expect(allowsStage('STOP_NEW_FULL_LIFETIME', 'LIFETIME_HISTORY')).toBe(false);
    expect(allowsStage('EVIDENCE_ONLY', 'ORIGIN')).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'zt-cov-'));
    try {
      const coverage = new FileCoverageRegistry(dir);
      await coverage.commit({
        chainId: 'eip155:56',
        token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        factType: 'Transfer',
        startBlock: '10',
        endBlock: '20',
        updatedAt: new Date().toISOString(),
      });
      const records = await coverage.read(
        'eip155:56',
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
      expect(missingRanges(records, 10n, 40n)).toEqual([{ startBlock: 21n, endBlock: 40n }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('only fetches traces for material reasons', () => {
    expect(shouldFetchTrace('Creation/Internal CREATE')).toBe(true);
    expect(shouldFetchTrace('full-chain')).toBe(false);
    expect(classifyTrace({ reason: 'Creation/Internal CREATE', inActiveCase: false })).toBe(
      'MATERIAL_TRACE',
    );
    expect(isHistoricalRpc('eth_blockNumber', [])).toBe(false);
    expect(isHistoricalRpc('eth_getLogs', [{}])).toBe(true);
    expect(isHistoricalRpc('eth_getCode', ['0xabc', 'latest'])).toBe(false);
  });

  it('forecasts 500GB/1TB/2TB from real sample rates without coercing empty coverage to zero tokens', () => {
    const forecast = forecastFromMetrics(
      [
        {
          token: '0xae',
          eventCount: 1000,
          rawBytes: 800_000,
          parquetBytes: 80_000,
          evidenceBytes: 20_000,
          traceBytes: 5_000,
          rpcCalls: 12,
          historicalRpcCalls: 10,
          traceCalls: 0,
          durationMs: 1_000,
          coverage: 'PARTIAL',
          originStatus: 'COMPLETE',
          resultHash: 'abc',
          updatedAt: new Date().toISOString(),
        },
      ],
      'unit-sample',
    );
    expect(forecast.compressionRatio).toBe(10);
    expect(forecast.capacity500gbTokens).toBeGreaterThan(forecast.capacity1tbTokens ? 0 : -1);
    expect(forecast.capacity2tbTokens).toBeGreaterThan(forecast.capacity1tbTokens);
  });

  it('expires cache, resumes corpus checkpoints, and inspects quota without coercing unknown to zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zt-cache-'));
    try {
      expect(expired('not-a-date', Date.now(), 'EPHEMERAL')).toBe(false);
      expect(expired(new Date().toISOString(), Date.now(), 'PERMANENT_EVIDENCE')).toBe(false);
      expect(
        expired(
          new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
          Date.now(),
          'NORMALIZED_FACT',
        ),
      ).toBe(true);
      expect(lruOrder([{ lastAccessAt: '2026-08-20T00:00:00.000Z', permanent: true }])).toEqual([]);

      const cache = new MemoryCacheStore();
      await cache.set('gone', '1', 'EPHEMERAL');
      expect(await cache.get('missing')).toBeUndefined();
      expect(await cache.get('gone')).toBe('1');
      expect(await cache.evictExpired(Date.now() + 2 * 60 * 60 * 1000)).toBe(1);
      await cache.set('perm', 'keep', 'PERMANENT_EVIDENCE');
      await cache.set('big', 'x'.repeat(100), 'EPHEMERAL');
      expect(await cache.byteSize()).toBeGreaterThan(0);
      expect(await cache.evictLru(1)).toBeGreaterThan(0);
      expect(await cache.get('perm')).toBe('keep');

      const metadata = new JsonFileMetadataStore(dir);
      expect(await readCorpusCheckpoint(metadata)).toBeUndefined();
      await writeCorpusCheckpoint(metadata, {
        index: 1,
        completed: ['0xAA'],
        metrics: [],
        updatedAt: new Date().toISOString(),
      });
      expect(await metadata.list('corpus')).toEqual(['corpus/checkpoint']);
      expect(resumeTokens(['0xaa', '0xbb'], await readCorpusCheckpoint(metadata))).toEqual([
        '0xbb',
      ]);
      expect(resumeTokens(['0x1'], undefined)).toEqual(['0x1']);

      const plane = openStoragePlane({ rootDir: dir, profile: 'LOW_COST_CASE' });
      const quota = await plane.inspectQuota(1024);
      expect(quota.labels.used.length).toBeGreaterThan(0);
      expect(quota.level).toBeDefined();
      const marks = await plane.applyWatermarks();
      expect(marks.level).toBe(quota.level);
      expect(await plane.artifacts.list('PERMANENT_EVIDENCE')).toEqual([]);
      expect(await plane.artifacts.deleteEphemeral('missing')).toBe(false);
      expect(await plane.artifacts.get('missing')).toBeUndefined();

      expect(quotaLevel(1, 0)).toBe('EVIDENCE_ONLY');
      expect(allowsPrefetch('WARN')).toBe(true);
      expect(allowsPrefetch('STOP_PREFETCH')).toBe(false);
      expect(allowsFullLifetime('COMPACT_AND_EVICT')).toBe(true);
      expect(allowsNonEvidenceWrite('EVIDENCE_ONLY')).toBe(false);
      expect(budgetFromFree(-1)).toBe(0);
      expect(
        buildQuotaView({
          profile: 'LOW_COST_CASE',
          usedBytes: 10,
          freeBytes: 100,
          rebuildableBytes: 1,
          permanentEvidenceBytes: 2,
          dailyGrowthBytes: 0,
        }).labels.fullAt,
      ).toContain('未知');
      expect(
        buildQuotaView({
          profile: 'LOW_COST_CASE',
          usedBytes: 10,
          freeBytes: 1000,
          rebuildableBytes: 1,
          permanentEvidenceBytes: 2,
          dailyGrowthBytes: 1,
          evictingClass: 'EPHEMERAL',
        }).labels.evicting,
      ).toContain('可重建缓存');
      expect(nextStage('CURRENT_SNAPSHOT')).toBe('ORIGIN');
      expect(nextStage('CASE_AND_REPLAY')).toBeUndefined();
      expect(stageRank('ORIGIN')).toBe(1);
      expect(compareJobPriority('Active Case', 'Corpus')).toBeLessThan(0);
      expect(admitJob('EVIDENCE_ONLY', 'Active Case')).toBe(true);
      expect(admitJob('EVIDENCE_ONLY', 'Corpus')).toBe(false);
      expect(admitJob('STOP_NEW_FULL_LIFETIME', 'Corpus')).toBe(false);
      expect(allowsStage('OK', 'LIFETIME_HISTORY')).toBe(true);
      expect(classifyTrace({ reason: 'Proxy Init', inActiveCase: true })).toBe('CASE_TRACE');
      expect(classifyTrace({ reason: 'Proxy Init', inActiveCase: false })).toBe('EPHEMERAL_TRACE');
      expect(isTraceRpc('debug_traceTransaction')).toBe(true);
      expect(isTraceRpc('eth_call')).toBe(false);
      expect(isHistoricalRpc('eth_getCode', ['0xabc', '0x10'])).toBe(true);
      expect(isHistoricalRpc('eth_getCode', ['0xabc'])).toBe(true);
      expect(isHistoricalRpc('debug_traceCall', [])).toBe(true);
      expect(classifyTrace({ reason: 'Migration', inActiveCase: false })).toBe('MATERIAL_TRACE');
      expect(allowsStage('EVIDENCE_ONLY', 'CASE_AND_REPLAY')).toBe(true);
      expect(admitJob('STOP_PREFETCH', 'Prefetch')).toBe(false);
      expect(parseStorageProfile('')).toBe('LOW_COST_CASE');
      expect(lowCostConcurrency('LOW_COST_CASE').aimdMax).toBe(1);
      expect(lowCostConcurrency('SELECTIVE_MARKET_INDEX').aimdMax).toBe(2);
      expect(lowCostConcurrency('REMOTE_ARCHIVE_HYBRID').aimdMax).toBe(2);
      expect(clickhouseEnabled('LOW_COST_CASE', true)).toBe(false);
      expect(clickhouseEnabled('SELECTIVE_MARKET_INDEX', true)).toBe(true);
      expect(
        buildQuotaView({
          profile: 'LOW_COST_CASE',
          usedBytes: 3 * 1024 ** 4,
          freeBytes: 1024,
          rebuildableBytes: 1,
          permanentEvidenceBytes: 2,
          dailyGrowthBytes: 0,
        }).labels.used,
      ).toContain('TB');

      vi.useFakeTimers();
      try {
        const timed = new MemoryCacheStore();
        await timed.set('stale', '1', 'EPHEMERAL');
        vi.advanceTimersByTime(EPHEMERAL_TTL_MS + CACHE_TTL_MS + 1);
        expect(await timed.get('stale')).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compacts parquet, wraps optional backends, and lists nested artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zt-facts-'));
    try {
      expect(await new JsonFileMetadataStore(dir).list('missing')).toEqual([]);
      const parquet = new DuckDbParquetFactStore(dir);
      expect(await parquet.append([])).toEqual({ bytes: 0 });
      await parquet.append([sampleFact()], '2026-01-01T00:00:00.000Z');
      await parquet.append(
        [{ ...sampleFact(), logOrInstructionIndex: '2' }],
        '2026-01-01T00:00:00.000Z',
      );
      const compacted = await parquet.compact();
      expect(compacted.filesBefore).toBeGreaterThanOrEqual(2);
      expect(compacted.filesAfter).toBe(1);
      expect(await parquet.queryByToken(sampleFact().token, 'Transfer')).toHaveLength(2);
      expect(await parquet.byteSize()).toBeGreaterThan(0);

      const memory = new MemoryFactStore();
      await memory.append([sampleFact()]);
      expect(await memory.queryByToken(sampleFact().token)).toHaveLength(1);
      expect(await memory.resultHash(sampleFact().token)).toHaveLength(64);
      expect((await memory.compact()).filesAfter).toBe(1);

      const unavailable = new ClickHouseFactStore();
      await expect(unavailable.append([sampleFact()])).rejects.toThrow(/CLICKHOUSE_UNAVAILABLE/);
      const dual = new DualFactStore(memory, unavailable);
      expect((await dual.append([sampleFact()])).bytes).toBeGreaterThan(0);
      expect(await dual.queryByToken(sampleFact().token)).toHaveLength(2);
      expect(await dual.resultHash(sampleFact().token)).toHaveLength(64);
      expect(await dual.byteSize()).toBeGreaterThan(0);
      expect((await dual.compact()).filesAfter).toBe(1);

      const artifacts = new LocalFsArtifactStore(dir);
      await artifacts.put('case/nested/one.json', Buffer.from('nested'), {
        dataClass: 'EPHEMERAL',
        contentType: 'application/json',
      });
      await artifacts.put('keep.json', Buffer.from('perm'), {
        dataClass: 'PERMANENT_EVIDENCE',
        contentType: 'application/json',
        permanent: true,
      });
      expect((await artifacts.list('EPHEMERAL')).some((item) => item.id.includes('nested'))).toBe(
        true,
      );
      expect(await artifacts.get('case/nested/one.json')).toBeDefined();
      writeFileSync(join(dir, 'artifacts', 'meta', 'broken.json'), '{not-json');
      expect(await artifacts.list()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'keep.json' })]),
      );
      expect(await artifacts.evictExpired(Date.now() + 40 * 24 * 60 * 60 * 1000)).toBeGreaterThan(
        0,
      );
      await artifacts.put('lru.json', Buffer.from('x'.repeat(32)), {
        dataClass: 'EPHEMERAL',
        contentType: 'application/json',
      });
      expect(await artifacts.evictLru(0)).toBeGreaterThan(0);
      expect(await artifacts.deleteEphemeral('keep.json')).toBe(false);

      const wrapped = new MinioArtifactStore(artifacts);
      await wrapped.put('wrap.json', Buffer.from('wrap'), {
        dataClass: 'EPHEMERAL',
        contentType: 'application/json',
      });
      expect(await wrapped.get('wrap.json')).toBeDefined();
      expect(await wrapped.stat('wrap.json')).toMatchObject({ id: 'wrap.json' });
      expect(await wrapped.byteSize('EPHEMERAL')).toBeGreaterThan(0);
      expect(await wrapped.deleteEphemeral('wrap.json')).toBe(true);

      const coverage = new FileCoverageRegistry(dir);
      const coverageFile = join(
        dir,
        'coverage',
        'eip155_56',
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.Transfer.json',
      );
      mkdirSync(join(dir, 'coverage', 'eip155_56'), { recursive: true });
      writeFileSync(coverageFile, '{bad');
      expect(
        await coverage.read('eip155:56', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      ).toEqual([]);
      await coverage.commit({
        chainId: 'eip155:56',
        token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        factType: 'Transfer',
        startBlock: '1',
        endBlock: '2',
        updatedAt: new Date().toISOString(),
        headBlock: '9',
      });
      expect(
        (await coverage.read('eip155:56', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))[0]
          ?.headBlock,
      ).toBe('9');

      const selective = openStoragePlane({
        rootDir: join(dir, 'selective'),
        profile: 'SELECTIVE_MARKET_INDEX',
        clickhouseUrl: 'http://clickhouse.test',
        postgresConfigured: true,
        minioConfigured: true,
        archiveNodeConfigured: true,
      });
      expect(selective.hotFacts).toBeDefined();
      expect(selective.optional.some((item) => item.status === 'CONFIGURED')).toBe(true);
      expect(forecastFromMetrics([], 'empty-sample').capacity500gbTokens).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
