import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  forecastFromMetrics,
  uncompressedFactBytes,
  type CorpusTokenMetrics,
} from '@zerotrace/storage-plane';

import { loadConfig } from '../apps/api/src/config.js';
import { createStoragePlane } from '../apps/api/src/storage-plane-bind.js';
import { loadWorkspaceEnv } from '../apps/api/src/workspace-env.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadWorkspaceEnv(root);
const config = loadConfig(process.env);
const plane = createStoragePlane(config);
const quota = await plane.inspectQuota();

const raw = await plane.metadata.get('corpus/checkpoint');
const metrics: CorpusTokenMetrics[] =
  raw === undefined ? [] : ((JSON.parse(raw) as { metrics?: CorpusTokenMetrics[] }).metrics ?? []);

const sample: CorpusTokenMetrics[] =
  metrics.length > 0
    ? metrics
    : [
        {
          token: 'local-plane',
          eventCount: Math.max(1, Math.floor((await plane.facts.byteSize()) / 64)),
          rawBytes: (await plane.facts.byteSize()) * 4,
          parquetBytes: await plane.facts.byteSize(),
          evidenceBytes: await plane.artifacts.byteSize('PERMANENT_EVIDENCE'),
          traceBytes: 0,
          rpcCalls: 0,
          historicalRpcCalls: 0,
          traceCalls: 0,
          durationMs: 0,
          coverage: 'PARTIAL',
          originStatus: 'PARTIAL',
          resultHash: '',
          updatedAt: new Date().toISOString(),
        },
      ];

const forecast = forecastFromMetrics(
  sample,
  metrics.length > 0 ? 'corpus-checkpoint' : 'storage-plane-bytes',
);
const facts = await plane.facts.queryByToken(sample[0]?.token ?? '');
const uncompressed = facts.length === 0 ? 0 : uncompressedFactBytes(facts);
const profile = {
  schemaVersion: 'zerotrace-storage-profile-v1',
  capturedAt: new Date().toISOString(),
  storageProfile: config.storageProfile,
  quota,
  bytesPerEvent: forecast.bytesPerEvent,
  bytesPerToken: forecast.bytesPerToken,
  bytesPerCase: forecast.bytesPerCase,
  compressionRatio:
    uncompressed === 0
      ? forecast.compressionRatio
      : uncompressed / Math.max(1, await plane.facts.byteSize()),
  dailyGrowth: forecast.dailyGrowthBytes,
  forecast30: forecast.forecast30,
  forecast90: forecast.forecast90,
  forecast365: forecast.forecast365,
  sampleTokens: forecast.sampleTokens,
  sampleEvents: forecast.sampleEvents,
  source: forecast.source,
  note:
    metrics.length === 0
      ? '尚无 Corpus Checkpoint；字节率来自当前存储平面。跑 npm run bench:low-disk 或 corpus:resume 后会替换为真实案件样本。'
      : '来自真实主网 Corpus Checkpoint。',
};

mkdirSync(join(root, 'docs/terminal-market-structure'), { recursive: true });
writeFileSync(
  join(root, 'docs/terminal-market-structure/storage-profile.json'),
  `${JSON.stringify(profile, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
