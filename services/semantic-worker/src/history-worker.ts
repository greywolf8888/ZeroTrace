import { EvmLedgerAdapter, SqdEvmLogReader, SqdPortalClient } from '@zerotrace/chain-adapters';
import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  runFlapEventHistoryProjectionRestartSafe,
} from '@zerotrace/platform-adapters';
import {
  PostgresEvidenceRepository,
  PostgresFlapHistoryProjectionRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import type { FlapHistoryWorkerConfig } from './history-config.js';
import { createBscTransport, providerPolicy } from './worker.js';

type FlapHistoryRun = Awaited<ReturnType<typeof runFlapEventHistoryProjectionRestartSafe>>;

export interface FlapHistoryWorkerSummary {
  event: 'flap_history_projection_complete';
  scanId: string;
  token: string;
  requestedRange: FlapHistoryRun['result']['requestedRange'];
  coverage: number;
  segmentCount: number;
  transactionCount: number;
  unrecognizedPortalLogCount: number;
  terminalEvidenceId: string;
  evidenceIds: string[];
  snapshot: FlapHistoryRun['result']['metadata']['snapshot'];
  freshness: FlapHistoryRun['result']['metadata']['freshness'];
  sourceSet: string[];
  modelVersion: string;
  confidence: number;
  lifetimeCoverage: {
    state: 'known' | 'unknown' | 'unavailable' | 'stale';
    reason: string | null;
  };
}

export interface FlapHistoryWorkerResources {
  evidence: PostgresEvidenceRepository;
  checkpoints: PostgresSemanticScanCheckpointRepository;
  projection: PostgresFlapHistoryProjectionRepository;
  close(): Promise<void>;
}

export type FlapHistoryExecutor = (
  config: FlapHistoryWorkerConfig,
  resources: FlapHistoryWorkerResources,
) => Promise<FlapHistoryRun>;

export function createFlapHistoryWorkerResources(
  config: FlapHistoryWorkerConfig,
): FlapHistoryWorkerResources {
  const evidence = PostgresEvidenceRepository.fromConnectionString({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const checkpoints = new PostgresSemanticScanCheckpointRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const projection = new PostgresFlapHistoryProjectionRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  return {
    evidence,
    checkpoints,
    projection,
    close: async () => {
      await Promise.allSettled([evidence.close(), checkpoints.close(), projection.close()]);
    },
  };
}

function reason(value: object): string | null {
  return 'reason' in value && typeof value.reason === 'string' ? value.reason : null;
}

async function executeFlapHistory(
  config: FlapHistoryWorkerConfig,
  resources: FlapHistoryWorkerResources,
): Promise<FlapHistoryRun> {
  const source = new SqdPortalClient({
    portalUrl: config.sqdPortalUrl,
    dataset: 'binance-mainnet',
    policy: providerPolicy(config.sqdAllowedHosts, config.allowPrivateProviderUrls),
    timeoutMs: config.requestTimeoutMs,
    maxRangeBlocks: config.chunkSize,
    maxAttempts: config.maxAttempts,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    requestsPerSecond: config.sqdRequestsPerSecond,
  });
  return runFlapEventHistoryProjectionRestartSafe({
    adapter: new EvmLedgerAdapter(
      {
        id: 'bsc-rpc',
        chainId: 56,
        chainName: 'BNB Smart Chain',
        snapshotBlockTag: 'finalized',
      },
      createBscTransport(config),
    ),
    logReader: new SqdEvmLogReader({
      source,
      maxRangeBlocks: config.chunkSize,
      maxResults: config.maxLogs,
    }),
    token: config.token,
    fromBlock: String(config.fromBlock),
    toBlock: String(config.toBlock),
    segmentSize: config.segmentSize,
    chunkSize: config.chunkSize,
    maxTransactions: config.maxTransactions,
    maxLogs: config.maxLogs,
    deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
    checkpoints: resources.checkpoints,
    projection: resources.projection,
    writeEvidence: async (evidence, sourceEvidenceIds = [], snapshot) =>
      (await resources.evidence.put(evidence, sourceEvidenceIds, snapshot)).evidence,
  });
}

export async function runFlapHistoryWorker(
  config: FlapHistoryWorkerConfig,
  resources: FlapHistoryWorkerResources,
  execute: FlapHistoryExecutor = executeFlapHistory,
): Promise<FlapHistoryWorkerSummary> {
  const storageHealth = await Promise.all([
    resources.evidence.health(),
    resources.checkpoints.health(),
    resources.projection.health(),
  ]);
  const failed = storageHealth.find((item) => item.status !== 'UP');
  if (failed !== undefined) {
    throw Object.assign(new Error('A required durable storage backend is unavailable.'), {
      code: failed.errorCode ?? 'STORAGE_UNAVAILABLE',
      retryable: true,
    });
  }

  const run = await execute(config, resources);
  const result = run.result;
  return {
    event: 'flap_history_projection_complete',
    scanId: run.scanId,
    token: result.token,
    requestedRange: result.requestedRange,
    coverage: result.requestedRangeCoverage,
    segmentCount: result.segments.length,
    transactionCount: result.transactionCount,
    unrecognizedPortalLogCount: result.unrecognizedPortalLogCount,
    terminalEvidenceId: result.terminalEvidenceId,
    evidenceIds: [...result.metadata.evidenceIds],
    snapshot: result.metadata.snapshot,
    freshness: result.metadata.freshness,
    sourceSet: [...result.metadata.sourceSet],
    modelVersion: result.metadata.modelVersion,
    confidence: result.metadata.confidence,
    lifetimeCoverage: {
      state: result.lifetimeCoverage.state,
      reason: reason(result.lifetimeCoverage),
    },
  };
}
