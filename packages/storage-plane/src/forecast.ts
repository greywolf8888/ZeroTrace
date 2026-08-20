import type { CorpusTokenMetrics, StorageForecast } from './types.js';

const GIGABYTE = 1024 ** 3;

export function forecastFromMetrics(
  samples: readonly CorpusTokenMetrics[],
  source: string,
): StorageForecast {
  const tokenCount = Math.max(1, samples.length);
  const events = samples.reduce((sum, item) => sum + item.eventCount, 0);
  const parquet = samples.reduce((sum, item) => sum + item.parquetBytes, 0);
  const raw = samples.reduce((sum, item) => sum + item.rawBytes, 0);
  const evidence = samples.reduce((sum, item) => sum + item.evidenceBytes, 0);
  const traces = samples.reduce((sum, item) => sum + item.traceBytes, 0);
  const total = parquet + evidence + traces;
  const bytesPerEvent = events === 0 ? 0 : total / events;
  const bytesPerToken = total / tokenCount;
  const bytesPerCase = bytesPerToken + evidence / tokenCount;
  const compressionRatio = raw === 0 || parquet === 0 ? 0 : raw / parquet;
  const dailyGrowthBytes = samples.reduce((sum, item) => sum + item.parquetBytes, 0);
  const usable = (capacity: number) => Math.floor(capacity * 0.7);
  const tokensAt = (capacity: number) =>
    bytesPerToken === 0 ? 0 : Math.floor(usable(capacity) / bytesPerToken);
  return {
    bytesPerEvent,
    bytesPerToken,
    bytesPerCase,
    compressionRatio,
    dailyGrowthBytes,
    forecast30: dailyGrowthBytes * 30,
    forecast90: dailyGrowthBytes * 90,
    forecast365: dailyGrowthBytes * 365,
    capacity500gbTokens: tokensAt(500 * GIGABYTE),
    capacity1tbTokens: tokensAt(1024 * GIGABYTE),
    capacity2tbTokens: tokensAt(2048 * GIGABYTE),
    sampleTokens: samples.length,
    sampleEvents: events,
    source,
  };
}
