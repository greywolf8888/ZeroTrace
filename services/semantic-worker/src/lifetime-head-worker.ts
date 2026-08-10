import {
  EvmLedgerAdapter,
  SqdEvmContractCreationReader,
  SqdEvmLogReader,
  SqdPortalClient,
  type JsonRpcTransport,
} from '@zerotrace/chain-adapters';
import { AnchorDataQualityService, type ChainAnchorReader } from '@zerotrace/data-quality';
import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  extendFlapLifetimeRestartSafe,
  materializeFlapLifetimeRestartSafe,
} from '@zerotrace/platform-adapters';
import {
  PostgresDataQualityRepository,
  PostgresEvidenceRepository,
  PostgresFlapHistoryProjectionRepository,
  PostgresFlapLifetimeHeadRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import { publicWorkerError } from './errors.js';
import type { FlapLifetimeHeadWorkerConfig } from './lifetime-head-config.js';
import { runFlapLifetimeHeadCycle } from './lifetime-head-cycle.js';
import { proveFlapLifetimeContinuity } from './lifetime-continuity.js';
import { createBscTransport, createBscTransports, providerPolicy } from './worker.js';

export interface FlapLifetimeHeadWorkerResources {
  evidence: PostgresEvidenceRepository;
  checkpoints: PostgresSemanticScanCheckpointRepository;
  projection: PostgresFlapHistoryProjectionRepository;
  dataQuality: PostgresDataQualityRepository;
  heads: PostgresFlapLifetimeHeadRepository;
  close(): Promise<void>;
}

export interface FlapLifetimeHeadCycleSummary {
  event: 'flap_lifetime_head_cycle_complete';
  cycle: number;
  action: 'INITIALIZED' | 'EXTENDED' | 'UNCHANGED';
  token: string;
  sequence: number;
  scanId: string;
  headId: string;
  predecessorId: string | null;
  targetBlock: string;
  targetHash: string;
  terminalEvidenceId: string;
  freshness: string | null;
  modelVersion: string;
}

export interface FlapLifetimeHeadDeferredSummary {
  event: 'flap_lifetime_head_cycle_deferred';
  cycle: number;
  token: string;
  code: string;
  retryable: true;
}

export type FlapLifetimeHeadLoopEvent =
  FlapLifetimeHeadCycleSummary | FlapLifetimeHeadDeferredSummary;

export interface FlapLifetimeHeadRuntime {
  inspect(): ReturnType<AnchorDataQualityService['inspectAll']>;
  runCycle(
    reconciliation: Awaited<ReturnType<AnchorDataQualityService['inspectAll']>>[number],
  ): ReturnType<typeof runFlapLifetimeHeadCycle>;
}

export interface FlapLifetimeHeadLoopOptions {
  signal?: AbortSignal;
  emit?: (event: FlapLifetimeHeadLoopEvent) => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export function createFlapLifetimeHeadWorkerResources(
  config: FlapLifetimeHeadWorkerConfig,
): FlapLifetimeHeadWorkerResources {
  const evidence = PostgresEvidenceRepository.fromConnectionString({
    connectionString: config.postgresUrl,
    maxConnections: 6,
  });
  const checkpoints = new PostgresSemanticScanCheckpointRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const projection = new PostgresFlapHistoryProjectionRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const dataQuality = new PostgresDataQualityRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  const heads = new PostgresFlapLifetimeHeadRepository({
    connectionString: config.postgresUrl,
    maxConnections: 4,
  });
  return {
    evidence,
    checkpoints,
    projection,
    dataQuality,
    heads,
    close: async () => {
      await Promise.allSettled([
        evidence.close(),
        checkpoints.close(),
        projection.close(),
        dataQuality.close(),
        heads.close(),
      ]);
    },
  };
}

function adapter(transport: JsonRpcTransport, id = transport.endpointId) {
  return new EvmLedgerAdapter(
    {
      id,
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    transport,
  );
}

function anchorReader(ledger: EvmLedgerAdapter): ChainAnchorReader {
  return {
    sourceId: ledger.config.id,
    ledger: 'EVM',
    chainId: 'eip155:56',
    readHead: () => ledger.readHeadAnchor(),
    readAt: (position) => ledger.readAnchorAt(position),
  };
}

export function createFlapLifetimeHeadRuntime(
  config: FlapLifetimeHeadWorkerConfig,
  resources: FlapLifetimeHeadWorkerResources,
): FlapLifetimeHeadRuntime {
  const individualAdapters = createBscTransports(config).map((transport) => adapter(transport));
  const readers = individualAdapters.map(anchorReader);
  const analysisAdapter = adapter(createBscTransport(config), 'bsc-rpc');
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
  const creationReader = new SqdEvmContractCreationReader({
    source,
    maxRangeBlocks: config.originChunkSize,
    maxResults: 16,
  });
  const logReader = new SqdEvmLogReader({
    source,
    maxRangeBlocks: config.historyChunkSize,
    maxResults: config.historyMaxLogs,
  });
  const writeEvidence = async (
    item: Parameters<typeof resources.evidence.put>[0],
    sourceEvidenceIds: readonly string[] = [],
    snapshot?: Parameters<typeof resources.evidence.put>[2],
  ) => (await resources.evidence.put(item, sourceEvidenceIds, snapshot)).evidence;
  const dataQuality = new AnchorDataQualityService({
    targets: [{ ledger: 'EVM', chainId: 'eip155:56', readers }],
    repository: resources.dataQuality,
    evidence: resources.evidence,
    requiredSources: config.requiredSources,
  });
  return {
    inspect: () => dataQuality.inspectAll(),
    runCycle: async (reconciliation) =>
      runFlapLifetimeHeadCycle({
        token: config.token,
        reconciliation,
        heads: resources.heads,
        materialize: (targetAnchor) =>
          materializeFlapLifetimeRestartSafe({
            adapter: analysisAdapter,
            creationReader,
            logReader,
            token: config.token,
            deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
            checkpoints: resources.checkpoints,
            projection: resources.projection,
            writeEvidence,
            readDatasetMetadata: () => source.metadata(),
            targetAnchor,
            originChunkSize: config.originChunkSize,
            historySegmentSize: config.historySegmentSize,
            historyChunkSize: config.historyChunkSize,
            historyMaxTransactions: config.historyMaxTransactions,
            historyMaxLogs: config.historyMaxLogs,
          }),
        proveContinuity: (predecessor, target, agreed) =>
          proveFlapLifetimeContinuity({
            predecessor,
            target,
            reconciliation: agreed,
            readers,
            evidence: resources.evidence,
            repository: resources.dataQuality,
          }),
        extend: (predecessor, continuity, targetAnchor) =>
          extendFlapLifetimeRestartSafe({
            adapter: analysisAdapter,
            logReader,
            token: config.token,
            deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
            predecessor: { scanId: predecessor.scanId, result: predecessor.result },
            continuity,
            targetAnchor,
            checkpoints: resources.checkpoints,
            projection: resources.projection,
            writeEvidence,
            historySegmentSize: config.historySegmentSize,
            historyChunkSize: config.historyChunkSize,
            historyMaxTransactions: config.historyMaxTransactions,
            historyMaxLogs: config.historyMaxLogs,
          }),
      }),
  };
}

async function storagePreflight(resources: FlapLifetimeHeadWorkerResources): Promise<void> {
  const health = await Promise.all([
    resources.evidence.health(),
    resources.checkpoints.health(),
    resources.projection.health(),
    resources.dataQuality.health(),
    resources.heads.health(),
  ]);
  const failed = health.find((item) => item.status !== 'UP');
  if (failed !== undefined) {
    throw Object.assign(new Error('A required durable storage backend is unavailable.'), {
      code: failed.errorCode ?? 'STORAGE_UNAVAILABLE',
      retryable: true,
    });
  }
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

export async function runFlapLifetimeHeadLoop(
  config: FlapLifetimeHeadWorkerConfig,
  resources: FlapLifetimeHeadWorkerResources,
  runtime: FlapLifetimeHeadRuntime = createFlapLifetimeHeadRuntime(config, resources),
  options: FlapLifetimeHeadLoopOptions = {},
): Promise<FlapLifetimeHeadLoopEvent[]> {
  const events: FlapLifetimeHeadLoopEvent[] = [];
  const emit = options.emit ?? (() => undefined);
  const sleep = options.sleep ?? wait;
  const maxCycles = config.maxCycles ?? Number.POSITIVE_INFINITY;
  for (let cycle = 1; cycle <= maxCycles && active(options.signal); cycle += 1) {
    try {
      await storagePreflight(resources);
      const reconciliations = await runtime.inspect();
      const reconciliation = reconciliations.find(
        (item) => item.ledger === 'EVM' && item.chainId === 'eip155:56',
      );
      if (reconciliation === undefined) {
        throw Object.assign(new Error('BSC reconciliation result is unavailable.'), {
          code: 'LIFETIME_RECONCILIATION_REQUIRED',
          retryable: true,
        });
      }
      const result = await runtime.runCycle(reconciliation);
      const event: FlapLifetimeHeadCycleSummary = {
        event: 'flap_lifetime_head_cycle_complete',
        cycle,
        action: result.action,
        token: result.head.token,
        sequence: result.head.sequence,
        scanId: result.head.scanId,
        headId: result.head.id,
        predecessorId: result.head.predecessorId,
        targetBlock: result.targetBlock,
        targetHash: result.targetHash,
        terminalEvidenceId: result.head.terminalEvidenceId,
        freshness: result.head.result.metadata.freshness,
        modelVersion: result.head.result.metadata.modelVersion,
      };
      events.push(event);
      emit(event);
    } catch (error) {
      const safe = publicWorkerError(error, 'FLAP_LIFETIME_HEAD_FAILED');
      if (!safe.retryable) throw error;
      const event: FlapLifetimeHeadDeferredSummary = {
        event: 'flap_lifetime_head_cycle_deferred',
        cycle,
        token: config.token,
        code: safe.code,
        retryable: true,
      };
      events.push(event);
      emit(event);
    }
    if (cycle < maxCycles && active(options.signal)) {
      await sleep(config.intervalMs, options.signal);
    }
  }
  return events;
}
