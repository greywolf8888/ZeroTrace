import {
  runCaptureCycle,
  type CaptureHandler,
  type CaptureKind,
  type CaptureRun,
} from '@zerotrace/capture-scheduler';
import {
  PostgresActionSemanticsReportRepository,
  PostgresCaptureScheduleRepository,
  PostgresControlCampaignReportRepository,
  PostgresEvidenceRepository,
  PostgresForensicCampaignAlertRepository,
  PostgresFundingSettlementReportRepository,
  PostgresIngestionCheckpointRepository,
  PostgresTokenHistoryDiscoveryReportRepository,
  ClickHouseRawFactRepository,
  RawArtifactStore,
} from '@zerotrace/storage';

import type { TokenHistoryBackfillWorkerConfig } from './token-history-backfill-config.js';
import {
  createTokenHistoryBackfillHandler,
  createTokenHistoryLiveCaptureHandler,
  type TokenHistoryBackfillHandlerResources,
} from './token-history-backfill-handler.js';

export interface TokenHistoryBackfillWorkerResources extends TokenHistoryBackfillHandlerResources {
  schedules: PostgresCaptureScheduleRepository;
  close(): Promise<void>;
}

export interface TokenHistoryBackfillCycleSummary {
  event: 'token_history_backfill_capture_cycle_complete';
  claimed: number;
  succeeded: number;
  retryWaiting: number;
  failedTerminal: number;
  runIds: string[];
}

export interface TokenHistoryBackfillLoopOptions {
  signal?: AbortSignal;
  emit?: (event: TokenHistoryBackfillCycleSummary) => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export function createTokenHistoryBackfillWorkerResources(
  config: TokenHistoryBackfillWorkerConfig,
): TokenHistoryBackfillWorkerResources {
  const schedules = new PostgresCaptureScheduleRepository({ connectionString: config.postgresUrl });
  const facts = new ClickHouseRawFactRepository({
    url: config.clickhouseUrl,
    ...(config.clickhouseUsername === undefined ? {} : { username: config.clickhouseUsername }),
    ...(config.clickhousePassword === undefined ? {} : { password: config.clickhousePassword }),
    requestTimeoutMs: config.requestTimeoutMs,
  });
  const checkpoints = new PostgresIngestionCheckpointRepository({
    connectionString: config.postgresUrl,
    maxConnections: 8,
  });
  const artifacts = new RawArtifactStore({
    endpoint: config.objectStoreEndpoint,
    accessKey: config.objectStoreAccessKey,
    secretKey: config.objectStoreSecretKey,
    bucket: config.objectStoreBucket,
  });
  const evidence = PostgresEvidenceRepository.fromConnectionString({
    connectionString: config.postgresUrl,
    maxConnections: 12,
  });
  const actionSemantics = new PostgresActionSemanticsReportRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const reports = new PostgresTokenHistoryDiscoveryReportRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const funding = new PostgresFundingSettlementReportRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const campaigns = new PostgresControlCampaignReportRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const alerts = new PostgresForensicCampaignAlertRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  return {
    schedules,
    facts,
    checkpoints,
    artifacts,
    evidence,
    actionSemantics,
    reports,
    funding,
    campaigns,
    alerts,
    close: async () => {
      await Promise.allSettled([
        schedules.close(),
        checkpoints.close(),
        evidence.close(),
        actionSemantics.close(),
        reports.close(),
        funding.close(),
        campaigns.close(),
        alerts.close(),
        facts.close(),
      ]);
    },
  };
}

function summarize(runs: readonly CaptureRun[]): TokenHistoryBackfillCycleSummary {
  return {
    event: 'token_history_backfill_capture_cycle_complete',
    claimed: runs.length,
    succeeded: runs.filter((run) => run.status === 'SUCCEEDED').length,
    retryWaiting: runs.filter((run) => run.status === 'RETRY_WAIT').length,
    failedTerminal: runs.filter((run) => run.status === 'FAILED_TERMINAL').length,
    runIds: runs.map((run) => run.id).sort(),
  };
}

async function preflight(resources: TokenHistoryBackfillWorkerResources): Promise<void> {
  const health = await Promise.all([
    resources.schedules.health(),
    resources.facts.health(),
    resources.checkpoints.health(),
    resources.artifacts.health(),
    resources.evidence.health(),
    resources.actionSemantics.health(),
    resources.reports.health(),
    resources.funding.health(),
    resources.campaigns.health(),
    resources.alerts.health(),
  ]);
  const failed = health.find((item) => item.status !== 'UP');
  if (failed !== undefined) {
    throw Object.assign(
      new Error('A required Token History backfill storage backend is unavailable.'),
      {
        code: failed.errorCode ?? 'TOKEN_HISTORY_BACKFILL_STORAGE_UNAVAILABLE',
        retryable: true,
      },
    );
  }
}

export async function runTokenHistoryBackfillWorkerCycle(
  config: TokenHistoryBackfillWorkerConfig,
  resources: TokenHistoryBackfillWorkerResources,
  signal?: AbortSignal,
): Promise<TokenHistoryBackfillCycleSummary> {
  await preflight(resources);
  const handlers = new Map<CaptureKind, CaptureHandler>([
    ['TOKEN_HISTORY_BACKFILL', createTokenHistoryBackfillHandler(config, resources)],
    ['TOKEN_LIVE_CAPTURE', createTokenHistoryLiveCaptureHandler(config, resources)],
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

export async function runTokenHistoryBackfillWorkerLoop(
  config: TokenHistoryBackfillWorkerConfig,
  resources: TokenHistoryBackfillWorkerResources,
  options: TokenHistoryBackfillLoopOptions = {},
): Promise<TokenHistoryBackfillCycleSummary[]> {
  const summaries: TokenHistoryBackfillCycleSummary[] = [];
  const emit = options.emit ?? (() => undefined);
  const sleep = options.sleep ?? wait;
  do {
    if (options.signal !== undefined && options.signal.aborted) break;
    const summary = await runTokenHistoryBackfillWorkerCycle(config, resources, options.signal);
    summaries.push(summary);
    if (summaries.length > 100) summaries.shift();
    if (summary.claimed > 0) emit(summary);
    if (config.once || (options.signal !== undefined && options.signal.aborted)) break;
    await sleep(config.pollIntervalMs, options.signal);
  } while (options.signal === undefined || !options.signal.aborted);
  return summaries;
}
