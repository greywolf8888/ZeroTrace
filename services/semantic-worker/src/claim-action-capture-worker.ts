import { EvmLedgerAdapter, SqdEvmLogReader, SqdPortalClient } from '@zerotrace/chain-adapters';
import { runCaptureCycle, type CaptureHandler } from '@zerotrace/capture-scheduler';
import type { CaptureKind, CaptureRun } from '@zerotrace/schemas';
import {
  PostgresCaptureScheduleRepository,
  PostgresClaimReportRepository,
  PostgresClaimRuleReviewReportRepository,
  PostgresClaimVerificationReportRepository,
  PostgresEvidenceRepository,
} from '@zerotrace/storage';

import type { ClaimActionsCaptureWorkerConfig } from './claim-action-capture-config.js';
import { createClaimActionsCaptureHandler } from './claim-action-capture-handler.js';
import { createBscTransport, providerPolicy } from './worker.js';

export interface ClaimActionsCaptureWorkerResources {
  schedules: PostgresCaptureScheduleRepository;
  reviews: PostgresClaimRuleReviewReportRepository;
  addressReports: PostgresClaimReportRepository;
  verifications: PostgresClaimVerificationReportRepository;
  evidence: PostgresEvidenceRepository;
  close(): Promise<void>;
}

export interface ClaimActionsCaptureCycleSummary {
  event: 'claim_actions_capture_cycle_complete';
  claimed: number;
  succeeded: number;
  retryWaiting: number;
  failedTerminal: number;
  runIds: string[];
}

export interface ClaimActionsCaptureLoopOptions {
  signal?: AbortSignal;
  emit?: (event: ClaimActionsCaptureCycleSummary) => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export function createClaimActionsCaptureWorkerResources(
  config: ClaimActionsCaptureWorkerConfig,
): ClaimActionsCaptureWorkerResources {
  const schedules = new PostgresCaptureScheduleRepository({ connectionString: config.postgresUrl });
  const reviews = new PostgresClaimRuleReviewReportRepository({
    connectionString: config.postgresUrl,
  });
  const addressReports = new PostgresClaimReportRepository({
    connectionString: config.postgresUrl,
  });
  const verifications = new PostgresClaimVerificationReportRepository({
    connectionString: config.postgresUrl,
  });
  const evidence = PostgresEvidenceRepository.fromConnectionString({
    connectionString: config.postgresUrl,
    maxConnections: 8,
  });
  return {
    schedules,
    reviews,
    addressReports,
    verifications,
    evidence,
    close: async () => {
      await Promise.allSettled([
        schedules.close(),
        reviews.close(),
        addressReports.close(),
        verifications.close(),
        evidence.close(),
      ]);
    },
  };
}

function summarize(runs: readonly CaptureRun[]): ClaimActionsCaptureCycleSummary {
  return {
    event: 'claim_actions_capture_cycle_complete',
    claimed: runs.length,
    succeeded: runs.filter((run) => run.status === 'SUCCEEDED').length,
    retryWaiting: runs.filter((run) => run.status === 'RETRY_WAIT').length,
    failedTerminal: runs.filter((run) => run.status === 'FAILED_TERMINAL').length,
    runIds: runs.map((run) => run.id).sort(),
  };
}

async function preflight(resources: ClaimActionsCaptureWorkerResources): Promise<void> {
  const health = await Promise.all([
    resources.schedules.health(),
    resources.reviews.health(),
    resources.addressReports.health(),
    resources.verifications.health(),
    resources.evidence.health(),
  ]);
  const failed = health.find((item) => item.status !== 'UP');
  if (failed !== undefined) {
    throw Object.assign(new Error('A required Claim Actions storage backend is unavailable.'), {
      code: failed.errorCode ?? 'CLAIM_ACTIONS_STORAGE_UNAVAILABLE',
      retryable: true,
    });
  }
}

function buildHandler(
  config: ClaimActionsCaptureWorkerConfig,
  resources: ClaimActionsCaptureWorkerResources,
): CaptureHandler {
  const source = new SqdPortalClient({
    portalUrl: config.sqdPortalUrl,
    dataset: 'binance-mainnet',
    policy: providerPolicy(config.sqdAllowedHosts, config.allowPrivateProviderUrls),
    timeoutMs: config.requestTimeoutMs,
    maxRangeBlocks: 50_000,
    maxAttempts: config.maxAttempts,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    requestsPerSecond: config.sqdRequestsPerSecond,
  });
  const adapter = new EvmLedgerAdapter(
    {
      id: 'bsc-rpc',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    createBscTransport(config),
  );
  return createClaimActionsCaptureHandler({
    reviews: resources.reviews,
    addressReports: resources.addressReports,
    verifications: resources.verifications,
    evidence: resources.evidence,
    chains: new Map([
      [
        'eip155:56',
        {
          adapter,
          logReader: new SqdEvmLogReader({
            source,
            maxRangeBlocks: 50_000,
            maxResults: 25_000,
            includeAllBlocks: true,
          }),
        },
      ],
    ]),
  });
}

export async function runClaimActionsCaptureWorkerCycle(
  config: ClaimActionsCaptureWorkerConfig,
  resources: ClaimActionsCaptureWorkerResources,
  signal?: AbortSignal,
): Promise<ClaimActionsCaptureCycleSummary> {
  await preflight(resources);
  const handlers = new Map<CaptureKind, CaptureHandler>([
    ['CLAIM_ACTIONS', buildHandler(config, resources)],
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

export async function runClaimActionsCaptureWorkerLoop(
  config: ClaimActionsCaptureWorkerConfig,
  resources: ClaimActionsCaptureWorkerResources,
  options: ClaimActionsCaptureLoopOptions = {},
): Promise<ClaimActionsCaptureCycleSummary[]> {
  const summaries: ClaimActionsCaptureCycleSummary[] = [];
  const emit = options.emit ?? (() => undefined);
  const sleep = options.sleep ?? wait;
  do {
    if (!active(options.signal)) break;
    const summary = await runClaimActionsCaptureWorkerCycle(config, resources, options.signal);
    summaries.push(summary);
    if (summaries.length > 100) summaries.shift();
    if (summary.claimed > 0) emit(summary);
    if (config.once || !active(options.signal)) break;
    await sleep(config.pollIntervalMs, options.signal);
  } while (active(options.signal));
  return summaries;
}
