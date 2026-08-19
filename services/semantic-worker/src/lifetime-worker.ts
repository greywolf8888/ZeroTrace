import {
  EvmLedgerAdapter,
  SqdEvmContractCreationReader,
  SqdEvmLogReader,
  SqdPortalClient,
} from '@zerotrace/chain-adapters';
import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  materializeFlapLifetimeRestartSafe,
} from '@zerotrace/platform-adapters';
import { ChainAnchorReadSchema, type ChainAnchorRead } from '@zerotrace/schemas';
import {
  PostgresEvidenceRepository,
  PostgresFlapHistoryProjectionRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import type { FlapLifetimeWorkerConfig } from './lifetime-config.js';
import { createBscTransport, providerPolicy } from './worker.js';

type FlapLifetimeRun = Awaited<ReturnType<typeof materializeFlapLifetimeRestartSafe>>;

export interface FlapLifetimeWorkerSummary {
  event: 'flap_lifetime_materialization_complete';
  scanId: string;
  token: string;
  dataset: 'binance-mainnet';
  datasetStartBlock: string;
  targetBlock: string;
  originScanId: string;
  originSearchMode: 'FULL_DATASET' | 'VERIFIED_HINT';
  originState: 'known' | 'unknown' | 'unavailable' | 'stale';
  historyScanId: string | null;
  lifetimeCoverage: {
    state: 'known' | 'unknown' | 'unavailable' | 'stale';
    reason: string | null;
  };
  terminalEvidenceId: string;
  evidenceIds: string[];
  snapshot: FlapLifetimeRun['result']['metadata']['snapshot'];
  freshness: string | null;
  sourceSet: string[];
  modelVersion: string;
  confidence: number;
}

export interface FlapLifetimeWorkerResources {
  evidence: PostgresEvidenceRepository;
  checkpoints: PostgresSemanticScanCheckpointRepository;
  projection: PostgresFlapHistoryProjectionRepository;
  close(): Promise<void>;
}

export type FlapLifetimeExecutor = (
  config: FlapLifetimeWorkerConfig,
  resources: FlapLifetimeWorkerResources,
) => Promise<FlapLifetimeRun>;

export function createFlapLifetimeWorkerResources(
  config: FlapLifetimeWorkerConfig,
): FlapLifetimeWorkerResources {
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

export async function exactFinalizedTarget(
  adapter: EvmLedgerAdapter,
  requestedTarget: number | undefined,
): Promise<ChainAnchorRead> {
  const finalizedHead = await adapter.readHeadAnchor();
  if (requestedTarget === undefined || String(requestedTarget) === finalizedHead.anchor.position) {
    return finalizedHead;
  }
  if (BigInt(requestedTarget) > BigInt(finalizedHead.anchor.position)) {
    throw Object.assign(new Error('Requested target is above the current finalized BSC head.'), {
      code: 'TARGET_NOT_FINALIZED',
      retryable: true,
    });
  }
  const target = await adapter.readAnchorAt(String(requestedTarget));
  return ChainAnchorReadSchema.parse({
    ...target,
    payload: {
      block: target.payload,
      finalizedHead: finalizedHead.payload,
      finalizedHeadPosition: finalizedHead.anchor.position,
      verification: 'target_at_or_before_finalized_head',
    },
  });
}

async function executeFlapLifetime(
  config: FlapLifetimeWorkerConfig,
  resources: FlapLifetimeWorkerResources,
): Promise<FlapLifetimeRun> {
  const source = new SqdPortalClient({
    portalUrl: config.sqdPortalUrl,
    dataset: 'binance-mainnet',
    policy: providerPolicy(config.sqdAllowedHosts, config.allowPrivateProviderUrls),
    timeoutMs: config.requestTimeoutMs,
    maxRangeBlocks: Math.max(config.originChunkSize, config.historyChunkSize),
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
  let lastOriginProgressAt = 0;
  const targetAnchor = await exactFinalizedTarget(adapter, config.targetBlock);
  return materializeFlapLifetimeRestartSafe({
    adapter,
    creationReader: new SqdEvmContractCreationReader({
      source,
      maxRangeBlocks: config.originChunkSize,
      maxResults: 16,
      requestRangeBlocks: config.sqdCreationRequestRangeBlocks,
      onProgress: (progress) => {
        const now = Date.now();
        if (now - lastOriginProgressAt < 15_000 && progress.nextBlock !== progress.toBlock) {
          return;
        }
        lastOriginProgressAt = now;
        process.stderr.write(
          `${JSON.stringify({
            event: 'flap_lifetime_origin_progress',
            token: config.token,
            fromBlock: progress.fromBlock,
            toBlock: progress.toBlock,
            nextBlock: progress.nextBlock,
            requestCount: progress.requestCount,
            responseBlockCount: progress.responseBlockCount,
            creationCount: progress.creationCount,
          })}\n`,
        );
      },
    }),
    logReader: new SqdEvmLogReader({
      source,
      maxRangeBlocks: config.historyChunkSize,
      maxResults: config.historyMaxLogs,
      includeAllBlocks: false,
    }),
    token: config.token,
    deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
    checkpoints: resources.checkpoints,
    projection: resources.projection,
    writeEvidence: async (evidence, sourceEvidenceIds = [], snapshot) =>
      (await resources.evidence.put(evidence, sourceEvidenceIds, snapshot)).evidence,
    readDatasetMetadata: () => source.metadata(),
    targetAnchor,
    ...(config.originHintBlock === undefined ? {} : { originHintBlock: config.originHintBlock }),
    originChunkSize: config.originChunkSize,
    historySegmentSize: config.historySegmentSize,
    historyChunkSize: config.historyChunkSize,
    historyMaxTransactions: config.historyMaxTransactions,
    historyMaxLogs: config.historyMaxLogs,
  });
}

export async function runFlapLifetimeWorker(
  config: FlapLifetimeWorkerConfig,
  resources: FlapLifetimeWorkerResources,
  execute: FlapLifetimeExecutor = executeFlapLifetime,
): Promise<FlapLifetimeWorkerSummary> {
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
    event: 'flap_lifetime_materialization_complete',
    scanId: run.scanId,
    token: result.token,
    dataset: result.dataset,
    datasetStartBlock: result.datasetStartBlock,
    targetBlock: result.targetBlock,
    originScanId: result.originScanId,
    originSearchMode: result.originSearchMode,
    originState: result.origin.state,
    historyScanId: result.historyProjection?.scanId ?? null,
    lifetimeCoverage: {
      state: result.lifetimeCoverage.state,
      reason: reason(result.lifetimeCoverage),
    },
    terminalEvidenceId: result.terminalEvidenceId,
    evidenceIds: [...result.metadata.evidenceIds],
    snapshot: result.metadata.snapshot,
    freshness: result.metadata.freshness,
    sourceSet: [...result.metadata.sourceSet],
    modelVersion: result.metadata.modelVersion,
    confidence: result.metadata.confidence,
  };
}
