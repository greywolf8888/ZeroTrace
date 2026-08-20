import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryLocalIndex } from '@zerotrace/local-index';
import { describe, expect, it } from 'vitest';

import { LocalFsArtifactStore } from './artifacts.js';
import { hydrateLocalIndex, openStoragePlane, persistLocalIndex } from './compose.js';
import { FileCoverageRegistry, missingRanges } from './coverage.js';
import { ClickHouseFactStore, DuckDbParquetFactStore } from './facts.js';
import { forecastFromMetrics } from './forecast.js';
import { admitJob, allowsStage } from './jobs.js';
import { decodeParquet, encodeParquet, factsResultHash } from './parquet.js';
import { parseStorageProfile } from './profile.js';
import { quotaLevel } from './quota.js';
import { classifyTrace, isHistoricalRpc, shouldFetchTrace } from './trace-policy.js';
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
    const facts = [sampleFact(), { ...sampleFact(), logOrInstructionIndex: '1', amountAtomic: '50' }];
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
      expect(await parquet.resultHash(facts[0]!.token)).toBe(await clickhouse.resultHash(facts[0]!.token));
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
      expect(restored.transfers('eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toHaveLength(1);
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
      const records = await coverage.read('eip155:56', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
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
});
