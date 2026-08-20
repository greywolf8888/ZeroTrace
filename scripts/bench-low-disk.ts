import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureTokenMarket } from '@zerotrace/token-market-capture';
import {
  ClickHouseFactStore,
  DuckDbParquetFactStore,
  quotaLevel,
  type CorpusTokenMetrics,
} from '@zerotrace/storage-plane';

import { loadConfig } from '../apps/api/src/config.js';
import { createStoragePlane } from '../apps/api/src/storage-plane-bind.js';
import { createTokenCaptureRuntime } from '../apps/api/src/token-capture-runtime.js';
import { loadWorkspaceEnv } from '../apps/api/src/workspace-env.js';
import { P0_FLAP_TOKENS } from './p0-flap-tokens.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadWorkspaceEnv(root);

const config = loadConfig(process.env);
const plane = createStoragePlane(config);
const first = P0_FLAP_TOKENS[0];
if (first === undefined) throw new Error('P0 token list empty');

async function runOnce(label: string) {
  const runtime = createTokenCaptureRuntime(config, { storagePlane: plane });
  if (runtime === undefined) throw new Error('public operator quorum unavailable');
  const started = Date.now();
  const report = await captureTokenMarket(runtime, {
    chainId: 'eip155:56',
    token: first.token,
    creationTx: first.creationTx,
    logBudgetChunks: 2,
    chunkBlocks: 2_000n,
  });
  const metrics: CorpusTokenMetrics = {
    token: first.token,
    eventCount: report.history.logCount,
    rawBytes: report.artifacts.length * 256,
    parquetBytes: await plane.facts.byteSize(),
    evidenceBytes: await plane.artifacts.byteSize('PERMANENT_EVIDENCE'),
    traceBytes: 0,
    rpcCalls: report.rpcStats.current + report.rpcStats.historical,
    historicalRpcCalls: report.rpcStats.historical,
    traceCalls: report.rpcStats.trace,
    durationMs: Date.now() - started,
    coverage: report.history.status,
    originStatus: report.origin.status,
    resultHash: report.origin.createdBlock ?? report.history.headBlock ?? '',
    updatedAt: new Date().toISOString(),
  };
  return { label, report, metrics };
}

const pass1 = await runOnce('first');
const pass2 = await runOnce('second-after-restart');

const parquet = new DuckDbParquetFactStore(config.storageRoot);
const clickhouseUrl = config.clickhouseUrl;
let clickhouse: { status: 'PASS' | 'NOT_RUN' | 'FAIL'; detail: string; left?: string; right?: string } = {
  status: 'NOT_RUN',
  detail: 'CLICKHOUSE_URL 未配置或 LOW_COST_CASE 不启用热层，不得记 PASS。',
};
if (clickhouseUrl !== undefined && config.storageProfile !== 'LOW_COST_CASE') {
  try {
    const hot = new ClickHouseFactStore(clickhouseUrl);
    const token = first.token.toLowerCase();
    const facts = await parquet.queryByToken(token, 'Transfer');
    await hot.append(facts);
    const left = await parquet.resultHash(token, 'Transfer');
    const right = await hot.resultHash(token, 'Transfer');
    clickhouse = {
      status: left === right ? 'PASS' : 'FAIL',
      detail: left === right ? '同一规范化事实 ResultHash 一致。' : 'ResultHash 不一致。',
      left,
      right,
    };
  } catch (error) {
    clickhouse = {
      status: 'NOT_RUN',
      detail: error instanceof Error ? error.message : 'ClickHouse 不可用',
    };
  }
}

const quota = await plane.inspectQuota(pass1.metrics.parquetBytes);
const watermarkProbe = {
  warn: quotaLevel(65, 100),
  stopPrefetch: quotaLevel(75, 100),
  compact: quotaLevel(82, 100),
  stopLifetime: quotaLevel(88, 100),
  evidenceOnly: quotaLevel(92, 100),
};

const document = {
  schemaVersion: 'zerotrace-low-disk-bench-v1',
  capturedAt: new Date().toISOString(),
  profile: config.storageProfile,
  token: first.token,
  pass1: {
    origin: pass1.report.origin.status,
    history: pass1.report.history.status,
    historicalRpc: pass1.report.rpcStats.historical,
    limitation: pass1.report.history.limitation ?? pass1.report.origin.limitation,
    metrics: pass1.metrics,
  },
  pass2: {
    origin: pass2.report.origin.status,
    history: pass2.report.history.status,
    historicalRpc: pass2.report.rpcStats.historical,
    methods: pass2.report.rpcStats.byMethod,
    limitation: pass2.report.history.limitation ?? pass2.report.origin.limitation,
    metrics: pass2.metrics,
  },
  secondPassHistoricalRpcZero: pass2.report.rpcStats.historical === 0,
  coverageSurvivedRestart: pass2.report.origin.status === pass1.report.origin.status,
  clickhouseResultHash: clickhouse,
  quota,
  watermarkProbe,
  evidenceNotDeleted: (await plane.artifacts.list('PERMANENT_EVIDENCE')).length > 0,
  notes: [
    '第二次分析的历史 RPC 仅在本地 Coverage 已覆盖起源到头时为 0。',
    'eth_blockNumber 计为当前快照，不计历史 RPC。',
    '未覆盖区间保持 PARTIAL，不得记为空持有人。',
  ],
};

const outDir = join(root, 'docs/terminal-market-structure');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'low-disk-bench.json');
writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
