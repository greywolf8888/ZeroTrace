import { EvmLedgerAdapter, SqdEvmLogReader, SqdPortalClient } from '@zerotrace/chain-adapters';
import { scanErc20SupplyContinuityRestartSafe } from '@zerotrace/platform-adapters';
import {
  PostgresEvidenceRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import type { SupplyContinuityWorkerConfig } from './supply-continuity-config.js';
import { createBscTransports, providerPolicy } from './worker.js';

type SupplyContinuityRun = Awaited<ReturnType<typeof scanErc20SupplyContinuityRestartSafe>>;

export interface SupplyContinuityWorkerSummary {
  event: 'erc20_supply_continuity_complete';
  scanId: string;
  token: string;
  requestedRange: { fromBlock: string; toBlock: string };
  coverageScope: SupplyContinuityRun['result']['coverageScope'];
  status: SupplyContinuityRun['result']['status'];
  segmentCount: number;
  scannedBlockCount: number;
  supplySampleCount: number;
  initialTotalSupply: string;
  finalTotalSupply: string;
  netSupplyDelta: string;
  supplyChangeCount: number;
  eventConservedChangeCount: number;
  unexplainedChangeCount: number;
  sourceIndependence: SupplyContinuityRun['result']['sourceIndependence'];
  terminalEvidenceId: string;
  evidenceIds: string[];
  snapshot: SupplyContinuityRun['result']['metadata']['snapshot'];
  freshness: SupplyContinuityRun['result']['metadata']['freshness'];
  sourceSet: string[];
  modelVersion: string;
  confidence: number;
}

export interface SupplyContinuityWorkerResources {
  evidence: PostgresEvidenceRepository;
  checkpoints: PostgresSemanticScanCheckpointRepository;
  close(): Promise<void>;
}

export type SupplyContinuityExecutor = (
  config: SupplyContinuityWorkerConfig,
  resources: SupplyContinuityWorkerResources,
) => Promise<SupplyContinuityRun>;

export function createSupplyContinuityWorkerResources(
  config: SupplyContinuityWorkerConfig,
): SupplyContinuityWorkerResources {
  const evidence = PostgresEvidenceRepository.fromConnectionString({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const checkpoints = new PostgresSemanticScanCheckpointRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  return {
    evidence,
    checkpoints,
    close: async () => {
      await Promise.allSettled([evidence.close(), checkpoints.close()]);
    },
  };
}

async function executeSupplyContinuity(
  config: SupplyContinuityWorkerConfig,
  resources: SupplyContinuityWorkerResources,
): Promise<SupplyContinuityRun> {
  const source = new SqdPortalClient({
    portalUrl: config.sqdPortalUrl,
    dataset: 'binance-mainnet',
    policy: providerPolicy(config.sqdAllowedHosts, config.allowPrivateProviderUrls),
    timeoutMs: config.requestTimeoutMs,
    maxRangeBlocks: 1,
    maxAttempts: config.maxAttempts,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    requestsPerSecond: config.sqdRequestsPerSecond,
  });
  const adapters = createBscTransports(config).map(
    (transport) =>
      new EvmLedgerAdapter(
        {
          id: 'bsc-rpc',
          chainId: 56,
          chainName: 'BNB Smart Chain',
          snapshotBlockTag: 'finalized',
        },
        transport,
      ),
  );
  return scanErc20SupplyContinuityRestartSafe({
    adapters,
    logReader: new SqdEvmLogReader({
      source,
      maxRangeBlocks: 1,
      maxResults: config.maxTransfers,
      includeAllBlocks: false,
    }),
    tokenAddress: config.token,
    fromBlock: String(config.fromBlock),
    toBlock: String(config.toBlock),
    segmentSize: config.segmentSize,
    maxTransfers: config.maxTransfers,
    checkpoints: resources.checkpoints,
    writeEvidence: async (evidence, sourceEvidenceIds = [], snapshot) =>
      (await resources.evidence.put(evidence, sourceEvidenceIds, snapshot)).evidence,
  });
}

export async function runSupplyContinuityWorker(
  config: SupplyContinuityWorkerConfig,
  resources: SupplyContinuityWorkerResources,
  execute: SupplyContinuityExecutor = executeSupplyContinuity,
): Promise<SupplyContinuityWorkerSummary> {
  const storageHealth = await Promise.all([
    resources.evidence.health(),
    resources.checkpoints.health(),
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
    event: 'erc20_supply_continuity_complete',
    scanId: run.scanId,
    token: result.tokenAddress,
    requestedRange: { fromBlock: result.fromBlock, toBlock: result.toBlock },
    coverageScope: result.coverageScope,
    status: result.status,
    segmentCount: result.segmentCount,
    scannedBlockCount: result.scannedBlockCount,
    supplySampleCount: result.supplySampleCount,
    initialTotalSupply: result.initialTotalSupply,
    finalTotalSupply: result.finalTotalSupply,
    netSupplyDelta: result.netSupplyDelta,
    supplyChangeCount: result.supplyChangeCount,
    eventConservedChangeCount: result.eventConservedChangeCount,
    unexplainedChangeCount: result.unexplainedChangeCount,
    sourceIndependence: result.sourceIndependence,
    terminalEvidenceId: result.terminalEvidenceId,
    evidenceIds: [...result.metadata.evidenceIds],
    snapshot: result.metadata.snapshot,
    freshness: result.metadata.freshness,
    sourceSet: [...result.metadata.sourceSet],
    modelVersion: result.metadata.modelVersion,
    confidence: result.metadata.confidence,
  };
}
