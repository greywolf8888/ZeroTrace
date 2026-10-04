import { LedgerStore } from '../apps/arc-task-ledger-api/src/storage.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import assert from 'node:assert/strict';
import {
  ArcReader,
  configFromEnv,
  syncOnce,
  DEPLOYMENT,
  LedgerError,
  classifyLiveError,
} from '@zerotrace/arc-task-ledger';
import { createLedgerApp } from '../apps/arc-task-ledger-api/src/app.js';
let config: ReturnType<typeof configFromEnv> | undefined;
let reader: ArcReader | undefined;
let store: LedgerStore | undefined;
const target =
  process.env.ARC_EVIDENCE_OUTPUT ?? '.agent-state/arc-task-ledger/evidence/live-smoke.json';
await mkdir(dirname(target), { recursive: true });
const started = Date.now();
try {
  config = configFromEnv();
  reader = new ArcReader(config);
  store = new LedgerStore(config.databaseUrl);
  if (!(await store.ready()))
    throw new LedgerError('STORAGE_UNAVAILABLE', '主网验证要求已迁移的专用持久存储。');
  const run = await syncOnce(reader, store, {
    maxJobs: config.maxJobs,
    scanBudget: config.scanBudget,
    currentOnly: process.argv.includes('--current-only'),
    evidenceBlocks: config.evidenceBlocks,
    ...(config.historyFromBlock === undefined ? {} : { historyFromBlock: config.historyFromBlock }),
    ...(config.snapshotBlock === undefined ? {} : { snapshotBlock: config.snapshotBlock }),
  });
  assert.equal(run.snapshot.chainId, '5042');
  assert.equal(run.coverage.deploymentVerification, 'complete');
  assert.equal(run.coverage.currentState, 'complete');
  assert.ok(run.jobs.length > 0, '真实任务竖切片不可为空');
  const restarted = new LedgerStore(config.databaseUrl);
  const replay = await restarted.getRun(run.id);
  assert.deepEqual(replay, run);
  await restarted.close();
  const app = await createLedgerApp(
    store,
    process.env.ARC_CURSOR_SECRET ?? 'live-read-only-local-check-32-bytes',
  );
  const page = await app.inject('/v1/jobs?limit=1');
  assert.equal(page.statusCode, 200);
  const job =
    run.jobs.find(
      (d) =>
        d.job.cashState === 'CONFIRMED_DIRECT' &&
        d.settlementLegs.some(
          (l) =>
            l.kind === 'REWARD' &&
            l.observedAmount.atomic.state === 'known' &&
            BigInt(l.observedAmount.atomic.value) > 0n,
        ),
    ) ?? run.jobs[0]!;
  const response = await app.inject(
    `/v1/jobs/5042/${DEPLOYMENT.adapter}/${job.job.jobId}?snapshotRunId=${run.id}`,
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().job.jobId, job.job.jobId);
  await app.close();
  const cashVerified =
    job.job.cashState === 'CONFIRMED_DIRECT' &&
    job.settlementLegs.some(
      (l) =>
        l.kind === 'REWARD' &&
        l.observedAmount.atomic.state === 'known' &&
        BigInt(l.observedAmount.atomic.value) > 0n,
    );
  const report = {
    schemaVersion: 'atl-live-v1',
    status: cashVerified ? 'MAINNET_READ_VALIDATED' : 'PARTIAL_MAINNET_CURRENT_STATE',
    snapshot: run.snapshot,
    snapshotRunId: run.id,
    tasks: run.jobs.length,
    selectedJobId: job.job.jobId,
    coverage: run.coverage,
    settlementLegs: job.settlementLegs,
    evidenceIds: job.evidence.map((e) => e.id),
    rpcRequests: reader.requests,
    responseBytes: reader.responseBytes,
    durationMs: Date.now() - started,
    providerFreeRestartReplay: true,
    restartKind: 'DATABASE_CONNECTION_REOPENED',
    historyScope:
      config.evidenceBlocks.length > 0 ? 'SELECTED_BLOCKS_WITH_GAPS' : 'CONTIGUOUS_SCAN',
    apiReadVerified: true,
    mainnetEdgeCases: 'NOT_OBSERVED',
    gaps: run.errors,
    historyRange: run.historyRange,
  };
  await store.recordSync(true, {
    snapshotRunId: run.id,
    providerAlias: config.providerAlias,
    rpcRequests: reader.requests,
    responseBytes: reader.responseBytes,
  });
  await writeFile(target, JSON.stringify(report, null, 2) + '\n');
  console.info(JSON.stringify(report, null, 2));
  if (!cashVerified) process.exitCode = 2;
} catch (error) {
  await store
    ?.transaction(async (client) => {
      for (const evidence of reader?.evidence ?? []) await store.putEvidence(client, evidence);
    })
    .catch(() => undefined);
  const report = {
    ...classifyLiveError(error),
    message: error instanceof LedgerError ? error.message : '主网只读采集不可用。',
    requests: reader?.requests ?? 0,
    durationMs: Date.now() - started,
  };
  await store
    ?.recordSync(false, { ...report, providerAlias: config?.providerAlias ?? 'not-configured' })
    .catch(() => undefined);
  await writeFile(target, JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify(report));
  process.exitCode = 1;
} finally {
  await reader?.close();
  await store?.close();
}
