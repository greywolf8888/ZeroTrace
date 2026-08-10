import {
  EvmLedgerAdapter,
  FailoverJsonRpcTransport,
  SafeJsonRpcTransport,
  SqdEvmContractCreationReader,
  SqdPortalClient,
  type JsonRpcTransport,
  type ProviderUrlPolicy,
} from '@zerotrace/chain-adapters';
import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  FLAP_TOKEN_ORIGIN_MODEL_VERSION,
  inspectFlapTokenOriginRestartSafe,
} from '@zerotrace/platform-adapters';
import {
  PostgresEvidenceRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import type { FlapOriginWorkerConfig } from './config.js';

type FlapOriginResult = Awaited<ReturnType<typeof inspectFlapTokenOriginRestartSafe>>;

export interface FlapOriginWorkerSummary {
  event: 'flap_origin_scan_complete';
  token: string;
  searchedRange: {
    fromBlock: string;
    toBlock: string;
    chunkSize: number;
    chunkCount: number;
  };
  coverage: number;
  originState: 'known' | 'unknown' | 'unavailable' | 'stale';
  observedCreationCount: number;
  terminalEvidenceId: string;
  evidenceIds: string[];
  snapshot: FlapOriginResult['metadata']['snapshot'];
  freshness: FlapOriginResult['metadata']['freshness'];
  sourceSet: string[];
  modelVersion: string;
  confidence: number;
  lifetimeCoverage: {
    state: 'known' | 'unknown' | 'unavailable' | 'stale';
    reason: string | null;
  };
}

export interface FlapOriginWorkerResources {
  evidence: PostgresEvidenceRepository;
  checkpoints: PostgresSemanticScanCheckpointRepository;
  close(): Promise<void>;
}

export type FlapOriginExecutor = (
  config: FlapOriginWorkerConfig,
  resources: FlapOriginWorkerResources,
) => Promise<FlapOriginResult>;

export function providerPolicy(
  allowedHosts: readonly string[],
  allowPrivateProviderUrls: boolean,
): ProviderUrlPolicy {
  return {
    allowedHosts,
    allowPrivateNetworks: allowPrivateProviderUrls,
    allowHttpForPrivateNetworks: allowPrivateProviderUrls,
  };
}

function endpointId(url: string, index: number, total: number): string {
  const host = new URL(url).hostname.toLowerCase();
  return `bsc-rpc@${host}${total === 1 ? '' : `#${index + 1}`}`;
}

export interface BscProviderConfig {
  bscRpcUrls: string[];
  providerAllowedHosts: string[];
  allowPrivateProviderUrls: boolean;
  requestTimeoutMs: number;
  bscRequestsPerSecond: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

export function createBscTransport(config: BscProviderConfig): JsonRpcTransport {
  const transports = config.bscRpcUrls.map(
    (url, index) =>
      new SafeJsonRpcTransport({
        endpointId: endpointId(url, index, config.bscRpcUrls.length),
        baseUrl: url,
        policy: providerPolicy(config.providerAllowedHosts, config.allowPrivateProviderUrls),
        timeoutMs: config.requestTimeoutMs,
        resilience: {
          maxAttempts: config.maxAttempts,
          retryBaseDelayMs: config.retryBaseDelayMs,
          retryMaxDelayMs: config.retryMaxDelayMs,
          requestsPerSecond: config.bscRequestsPerSecond,
        },
      }),
  );
  const first = transports[0];
  if (first === undefined) throw new Error('A BSC read provider is required.');
  return transports.length === 1 ? first : new FailoverJsonRpcTransport('bsc-rpc', transports);
}

export function createFlapOriginWorkerResources(
  config: FlapOriginWorkerConfig,
): FlapOriginWorkerResources {
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

function reason(value: object): string | null {
  return 'reason' in value && typeof value.reason === 'string' ? value.reason : null;
}

async function executeFlapOrigin(
  config: FlapOriginWorkerConfig,
  resources: FlapOriginWorkerResources,
): Promise<FlapOriginResult> {
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
  return inspectFlapTokenOriginRestartSafe({
    adapter: new EvmLedgerAdapter(
      {
        id: 'bsc-rpc',
        chainId: 56,
        chainName: 'BNB Smart Chain',
        snapshotBlockTag: 'finalized',
      },
      createBscTransport(config),
    ),
    creationReader: new SqdEvmContractCreationReader({
      source,
      maxRangeBlocks: config.chunkSize,
      maxResults: 16,
    }),
    token: config.token,
    fromBlock: String(config.fromBlock),
    toBlock: String(config.toBlock),
    chunkSize: config.chunkSize,
    deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
    checkpoints: resources.checkpoints,
    writeEvidence: async (evidence, sourceEvidenceIds = [], snapshot) =>
      (await resources.evidence.put(evidence, sourceEvidenceIds, snapshot)).evidence,
  });
}

export async function runFlapOriginWorker(
  config: FlapOriginWorkerConfig,
  resources: FlapOriginWorkerResources,
  execute: FlapOriginExecutor = executeFlapOrigin,
): Promise<FlapOriginWorkerSummary> {
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

  const result = await execute(config, resources);
  const terminalEvidence = [...result.evidence]
    .reverse()
    .find(
      (item) =>
        item.source === `zerotrace:${FLAP_TOKEN_ORIGIN_MODEL_VERSION}` &&
        item.locator.startsWith('flap-token-origin:'),
    );
  if (terminalEvidence === undefined) {
    throw Object.assign(new Error('The terminal Evidence record is unavailable.'), {
      code: 'EVIDENCE_INCOMPLETE',
      retryable: false,
    });
  }
  return {
    event: 'flap_origin_scan_complete',
    token: result.token,
    searchedRange: result.searchedRange,
    coverage: result.searchedRangeCoverage,
    originState: result.origin.state,
    observedCreationCount: result.observedCreationCount,
    terminalEvidenceId: terminalEvidence.id,
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
