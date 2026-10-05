import { LedgerStore } from './storage.js';
import { writeFile } from 'node:fs/promises';
import { ArcReader, configFromEnv, syncOnce, LedgerError } from '@zerotrace/arc-task-ledger';
const config = configFromEnv();
const store = new LedgerStore(config.databaseUrl);
const follow = process.argv.includes('--follow');
const interval = Number(process.env.ARC_SYNC_INTERVAL_MS ?? 300000);
if (!Number.isSafeInteger(interval) || interval < 60000 || interval > 3600000)
  throw new Error('采集间隔必须在 60000–3600000 毫秒之间。');
let stopped = false;
let wake: (() => void) | undefined;
process.once('SIGINT', () => {
  stopped = true;
  wake?.();
});
process.once('SIGTERM', () => {
  stopped = true;
  wake?.();
});
try {
  do {
    const reader = new ArcReader(config);
    const started = Date.now();
    try {
      if (!(await store.ready()))
        throw new LedgerError('STORAGE_UNAVAILABLE', '请先执行 Arc 数据库迁移。');
      const run = await syncOnce(reader, store, {
        maxJobs: config.maxJobs,
        scanBudget: config.scanBudget,
        recentBudget: config.recentBudget,
        proofBudget: config.proofBudget,
        currentOnly: process.argv.includes('--current-only'),
        evidenceBlocks: config.evidenceBlocks,
        ...(config.historyFromBlock === undefined
          ? {}
          : { historyFromBlock: config.historyFromBlock }),
        ...(config.snapshotBlock === undefined ? {} : { snapshotBlock: config.snapshotBlock }),
      });
      const result = {
        snapshotRunId: run.id,
        snapshot: run.snapshot,
        coverage: run.coverage,
        tasks: run.jobs.length,
        totalExpected: run.totalExpected,
        rpcRequests: reader.requests,
        responseBytes: reader.responseBytes,
        durationMs: Date.now() - started,
        gaps: run.errors,
        historyRange: run.historyRange,
        collection: run.collection,
      };
      await store.recordSync(true, {
        snapshotRunId: run.id,
        providerAlias: config.providerAlias,
        rpcRequests: reader.requests,
        responseBytes: reader.responseBytes,
        durationMs: Date.now() - started,
        collection: run.collection,
      });
      if (process.env.ARC_EVIDENCE_OUTPUT)
        await writeFile(process.env.ARC_EVIDENCE_OUTPUT, JSON.stringify(result, null, 2) + '\n');
      console.info(JSON.stringify(result, null, 2));
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'SYNC_UNAVAILABLE';
      if (await store.ready()) {
        await store.transaction(async (client) => {
          for (const evidence of reader.evidence) await store.putEvidence(client, evidence);
        });
        await store.recordSync(false, {
          code,
          providerAlias: config.providerAlias,
          rpcRequests: reader.requests,
          responseBytes: reader.responseBytes,
          durationMs: Date.now() - started,
        });
      }
      console.error(
        JSON.stringify({
          code,
          message:
            error instanceof LedgerError ? error.message : '本次链上读取失败，已有持久快照保留。',
        }),
      );
      if (!follow) process.exitCode = 1;
    } finally {
      await reader.close();
    }
    if (follow && !stopped)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, interval);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
  } while (follow && !stopped);
} finally {
  await store.close();
}
