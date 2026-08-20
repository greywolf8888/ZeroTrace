import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { forecastFromMetrics, type CorpusTokenMetrics } from '@zerotrace/storage-plane';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const benchPath = join(root, 'docs/terminal-market-structure/low-disk-bench.json');
const checkpointHint = join(root, 'docs/terminal-market-structure/storage-profile.json');

function metricsFromFiles(): { samples: CorpusTokenMetrics[]; source: string } {
  try {
    const bench = JSON.parse(readFileSync(benchPath, 'utf8')) as {
      pass1?: { metrics?: CorpusTokenMetrics };
      pass2?: { metrics?: CorpusTokenMetrics };
    };
    const samples = [bench.pass1?.metrics, bench.pass2?.metrics].filter(
      (item): item is CorpusTokenMetrics => item !== undefined,
    );
    if (samples.length > 0) return { samples, source: 'low-disk-bench.json' };
  } catch {
    // fall through
  }
  try {
    const profile = JSON.parse(readFileSync(checkpointHint, 'utf8')) as {
      bytesPerToken?: number;
      sampleTokens?: number;
      sampleEvents?: number;
      source?: string;
    };
    if (profile.bytesPerToken !== undefined) {
      return {
        samples: [
          {
            token: 'profile',
            eventCount: profile.sampleEvents ?? 1,
            rawBytes: Math.round((profile.bytesPerToken ?? 1) * 4),
            parquetBytes: Math.round(profile.bytesPerToken ?? 1),
            evidenceBytes: 0,
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
        ],
        source: profile.source ?? 'storage-profile.json',
      };
    }
  } catch {
    // fall through
  }
  return { samples: [], source: 'none' };
}

const { samples, source } = metricsFromFiles();
if (samples.length === 0) {
  const blocked = {
    status: 'NOT_RUN',
    reason: '缺少真实主网样本。先运行 npm run bench:low-disk。',
  };
  process.stdout.write(`${JSON.stringify(blocked, null, 2)}\n`);
  process.exitCode = 2;
} else {
  const forecast = forecastFromMetrics(samples, source);
  const document = {
    schemaVersion: 'zerotrace-storage-forecast-v1',
    capturedAt: new Date().toISOString(),
    source,
    bytesPerEvent: forecast.bytesPerEvent,
    bytesPerToken: forecast.bytesPerToken,
    bytesPerCase: forecast.bytesPerCase,
    compressionRatio: forecast.compressionRatio,
    dailyGrowth: forecast.dailyGrowthBytes,
    '30d': forecast.forecast30,
    '90d': forecast.forecast90,
    '365d': forecast.forecast365,
    capacity: {
      '500GB_usable_70pct_tokens': forecast.capacity500gbTokens,
      '1TB_usable_70pct_tokens': forecast.capacity1tbTokens,
      '2TB_usable_70pct_tokens': forecast.capacity2tbTokens,
    },
    note: '容量按 ZeroTrace 不超过可用空间 70% 估算。样本来自 PARTIAL 生命周期窗口，不是完整 BSC Archive，也不是闭合全历史；完整生命周期的 bytes/token 会显著更大，Token 容量是上限而非承诺。',
  };
  mkdirSync(join(root, 'docs/terminal-market-structure'), { recursive: true });
  writeFileSync(
    join(root, 'docs/terminal-market-structure/storage-forecast.json'),
    `${JSON.stringify(document, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}
