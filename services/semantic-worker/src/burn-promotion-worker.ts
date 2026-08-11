import { EvmLedgerAdapter, SqdEvmLogReader, SqdPortalClient } from '@zerotrace/chain-adapters';
import { runErc20BurnPromotionRestartSafe } from '@zerotrace/platform-adapters';
import {
  PostgresEvidenceRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import type { BurnPromotionWorkerConfig } from './burn-promotion-config.js';
import { createBscTransport, providerPolicy } from './worker.js';

type BurnPromotionRun = Awaited<ReturnType<typeof runErc20BurnPromotionRestartSafe>>;

export interface BurnPromotionWorkerSummary {
  event: 'erc20_burn_promotion_complete';
  scanId: string;
  token: string;
  requestedRange: { fromBlock: string; toBlock: string };
  coverageScope: BurnPromotionRun['result']['coverageScope'];
  segmentCount: number;
  zeroAddressEventCount: number;
  burnCandidateCount: number;
  verifiedCandidateCount: number;
  contradictedCandidateCount: number;
  verifiedActionCount: number;
  silentSupplyChangeDetection: BurnPromotionRun['result']['silentSupplyChangeDetection'];
  terminalEvidenceId: string;
  evidenceIds: string[];
  snapshot: BurnPromotionRun['result']['metadata']['snapshot'];
  freshness: BurnPromotionRun['result']['metadata']['freshness'];
  sourceSet: string[];
  modelVersion: string;
  confidence: number;
}

export interface BurnPromotionWorkerResources {
  evidence: PostgresEvidenceRepository;
  checkpoints: PostgresSemanticScanCheckpointRepository;
  close(): Promise<void>;
}

export type BurnPromotionExecutor = (
  config: BurnPromotionWorkerConfig,
  resources: BurnPromotionWorkerResources,
) => Promise<BurnPromotionRun>;

export function createBurnPromotionWorkerResources(
  config: BurnPromotionWorkerConfig,
): BurnPromotionWorkerResources {
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

async function executeBurnPromotion(
  config: BurnPromotionWorkerConfig,
  resources: BurnPromotionWorkerResources,
): Promise<BurnPromotionRun> {
  const source = new SqdPortalClient({
    portalUrl: config.sqdPortalUrl,
    dataset: 'binance-mainnet',
    policy: providerPolicy(config.sqdAllowedHosts, config.allowPrivateProviderUrls),
    timeoutMs: config.requestTimeoutMs,
    maxRangeBlocks: config.segmentSize,
    maxAttempts: config.maxAttempts,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    requestsPerSecond: config.sqdRequestsPerSecond,
  });
  return runErc20BurnPromotionRestartSafe({
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
      maxRangeBlocks: config.segmentSize,
      maxResults: config.maxTransfers,
      includeAllBlocks: false,
    }),
    tokenAddress: config.token,
    fromBlock: String(config.fromBlock),
    toBlock: String(config.toBlock),
    segmentSize: config.segmentSize,
    maxTransfers: config.maxTransfers,
    maxCandidatesPerSegment: config.maxCandidatesPerSegment,
    checkpoints: resources.checkpoints,
    writeEvidence: async (evidence, sourceEvidenceIds = [], snapshot) =>
      (await resources.evidence.put(evidence, sourceEvidenceIds, snapshot)).evidence,
  });
}

export async function runBurnPromotionWorker(
  config: BurnPromotionWorkerConfig,
  resources: BurnPromotionWorkerResources,
  execute: BurnPromotionExecutor = executeBurnPromotion,
): Promise<BurnPromotionWorkerSummary> {
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
    event: 'erc20_burn_promotion_complete',
    scanId: run.scanId,
    token: result.tokenAddress,
    requestedRange: { fromBlock: result.fromBlock, toBlock: result.toBlock },
    coverageScope: result.coverageScope,
    segmentCount: result.segmentCount,
    zeroAddressEventCount: result.zeroAddressEventCount,
    burnCandidateCount: result.burnCandidateCount,
    verifiedCandidateCount: result.verifiedCandidateCount,
    contradictedCandidateCount: result.contradictedCandidateCount,
    verifiedActionCount: result.verifiedActionCount,
    silentSupplyChangeDetection: result.silentSupplyChangeDetection,
    terminalEvidenceId: result.terminalEvidenceId,
    evidenceIds: [...result.metadata.evidenceIds],
    snapshot: result.metadata.snapshot,
    freshness: result.metadata.freshness,
    sourceSet: [...result.metadata.sourceSet],
    modelVersion: result.metadata.modelVersion,
    confidence: result.metadata.confidence,
  };
}
