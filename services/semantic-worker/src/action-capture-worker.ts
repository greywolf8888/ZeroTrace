import { runCaptureCycle, type CaptureHandler } from '@zerotrace/capture-scheduler';
import type { CaptureKind, CaptureRun } from '@zerotrace/schemas';
import {
  ClickHouseRawFactRepository,
  PostgresActionSemanticsReportRepository,
  PostgresCaptureScheduleRepository,
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
} from '@zerotrace/storage';

import type { ActionCaptureWorkerConfig } from './action-capture-config.js';
import { createActionSemanticsTransactionCaptureHandler } from './action-capture-handler.js';

export interface ActionCaptureWorkerResources {
  schedules: PostgresCaptureScheduleRepository;
  facts: ClickHouseRawFactRepository;
  ingestion: PostgresIngestionCheckpointRepository;
  evidence: PostgresEvidenceRepository;
  reports: PostgresActionSemanticsReportRepository;
  close(): Promise<void>;
}

export interface ActionCaptureCycleSummary {
  event: 'action_capture_cycle_complete';
  claimed: number;
  succeeded: number;
  retryWaiting: number;
  failedTerminal: number;
  runIds: string[];
}

export interface ActionCaptureLoopOptions {
  signal?: AbortSignal;
  emit?: (event: ActionCaptureCycleSummary) => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface HealthResult {
  status: 'UP' | 'DOWN';
  errorCode?: string;
}

export function createActionCaptureWorkerResources(
  config: ActionCaptureWorkerConfig,
): ActionCaptureWorkerResources {
  const schedules = new PostgresCaptureScheduleRepository({
    connectionString: config.postgresUrl,
  });
  const ingestion = new PostgresIngestionCheckpointRepository({
    connectionString: config.postgresUrl,
  });
  const evidence = PostgresEvidenceRepository.fromConnectionString({
    connectionString: config.postgresUrl,
  });
  const reports = new PostgresActionSemanticsReportRepository({
    connectionString: config.postgresUrl,
  });
  const facts = new ClickHouseRawFactRepository({
    url: config.clickhouseUrl,
    ...(config.clickhouseUsername === undefined ? {} : { username: config.clickhouseUsername }),
    ...(config.clickhousePassword === undefined ? {} : { password: config.clickhousePassword }),
    requestTimeoutMs: config.requestTimeoutMs,
  });
  return {
    schedules,
    facts,
    ingestion,
    evidence,
    reports,
    async close() {
      await Promise.allSettled([
        schedules.close(),
        facts.close(),
        ingestion.close(),
        evidence.close(),
        reports.close(),
      ]);
    },
  };
}

async function storagePreflight(resources: ActionCaptureWorkerResources): Promise<void> {
  const health: HealthResult[] = await Promise.all([
    resources.schedules.health(),
    resources.facts.health(),
    resources.ingestion.health(),
    resources.evidence.health(),
    resources.reports.health(),
  ]);
  const failed = health.find((item) => item.status !== 'UP');
  if (failed !== undefined) {
    throw Object.assign(new Error('A required Action Semantics storage backend is unavailable.'), {
      code: failed.errorCode ?? 'ACTION_CAPTURE_STORAGE_UNAVAILABLE',
      retryable: true,
    });
  }
}

function summarize(runs: readonly CaptureRun[]): ActionCaptureCycleSummary {
  return {
    event: 'action_capture_cycle_complete',
    claimed: runs.length,
    succeeded: runs.filter((run) => run.status === 'SUCCEEDED').length,
    retryWaiting: runs.filter((run) => run.status === 'RETRY_WAIT').length,
    failedTerminal: runs.filter((run) => run.status === 'FAILED_TERMINAL').length,
    runIds: runs.map((run) => run.id).sort(),
  };
}

export async function runActionCaptureWorkerCycle(
  config: ActionCaptureWorkerConfig,
  resources: ActionCaptureWorkerResources,
  signal?: AbortSignal,
): Promise<ActionCaptureCycleSummary> {
  await storagePreflight(resources);
  const handlers = new Map<CaptureKind, CaptureHandler>([
    [
      'TRANSACTION',
      createActionSemanticsTransactionCaptureHandler({
        facts: resources.facts,
        ingestion: resources.ingestion,
        evidence: resources.evidence,
        reports: resources.reports,
      }),
    ],
  ]);
  return summarize(
    await runCaptureCycle({
      repository: resources.schedules,
      handlers,
      owner: config.owner,
      leaseSeconds: config.leaseSeconds,
      limit: config.batchSize,
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

function active(signal?: AbortSignal): boolean {
  return signal?.aborted !== true;
}

export async function runActionCaptureWorkerLoop(
  config: ActionCaptureWorkerConfig,
  resources: ActionCaptureWorkerResources,
  options: ActionCaptureLoopOptions = {},
): Promise<ActionCaptureCycleSummary[]> {
  const summaries: ActionCaptureCycleSummary[] = [];
  const emit = options.emit ?? (() => undefined);
  const sleep = options.sleep ?? wait;
  do {
    if (!active(options.signal)) break;
    const summary = await runActionCaptureWorkerCycle(config, resources, options.signal);
    summaries.push(summary);
    if (summaries.length > 100) summaries.shift();
    if (summary.claimed > 0) emit(summary);
    if (config.once || !active(options.signal)) break;
    await sleep(config.pollIntervalMs, options.signal);
  } while (active(options.signal));
  return summaries;
}
