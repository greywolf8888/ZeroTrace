import {
  createJsonRpcTransport,
  ProviderRegistry,
  ProviderScheduler,
  selectProviders,
} from '@zerotrace/provider-plane';
import { lowCostConcurrency } from '@zerotrace/storage-plane';
import {
  independentOperatorCount,
  operatorFromEndpoint,
  pickIndependentOperators,
  type SourceOperator,
} from '@zerotrace/source-registry';
import {
  SqdEvmContractCreationReader,
  SqdEvmLogReader,
  SqdPortalClient,
  type EvmContractCreationReader,
  type EvmLogReader,
  type ProviderUrlPolicy,
} from '@zerotrace/chain-adapters';
import {
  MemoryLocalIndex,
  type RpcResult,
  type TokenCaptureRuntime,
} from '@zerotrace/token-market-capture';

import type { AppConfig } from './config.js';
import { buildProviderPlaneBindings } from './provider-slots.js';
import { bindStoragePlane, createStoragePlane } from './storage-plane-bind.js';
import type { StoragePlane } from '@zerotrace/storage-plane';

export function operatorsFromPlane(config: AppConfig): SourceOperator[] {
  const plane = buildProviderPlaneBindings(config);
  const publicOperators = plane.records
    .filter((item) => item.forensicGrade === 'PUBLIC_NO_SLA')
    .map((item) =>
      operatorFromEndpoint({
        endpointId: item.endpointRef,
        chainId: item.chainId,
        forensicGrade: item.forensicGrade,
        logsCapability: 'denied',
        deniedMethods: item.deniedMethods,
        operatorId: item.operatorId,
      }),
    );
  const keyed = plane.records
    .filter((item) => item.forensicGrade === 'FREE_KEYED' && item.credentialStatus === 'CONFIGURED')
    .map((item) => ({
      ...operatorFromEndpoint({
        endpointId: item.endpointRef,
        chainId: item.chainId,
        forensicGrade: item.forensicGrade,
        logsCapability: item.logsDeclared ? 'declared' : 'denied',
        archiveCapability: item.archiveDeclared,
        deniedMethods: [],
        credentialStatus: 'CONFIGURED',
        operatorId: item.providerId,
      }),
      endpointId: item.providerId,
    }));
  const quorum = pickIndependentOperators(publicOperators, 2);
  return [...quorum, ...keyed];
}

export function wrapSqdBulkSource(
  reader: EvmLogReader | undefined,
): TokenCaptureRuntime['bulkLogSource'] | undefined {
  if (reader === undefined) return undefined;
  return {
    async getLogs(params) {
      const filter = params[0];
      if (filter === undefined || typeof filter !== 'object') {
        return { ok: false, result: null, raw: '', error: 'invalid log filter' };
      }
      const query = filter as {
        fromBlock: string;
        toBlock: string;
        address: string;
        topics?: string[];
      };
      try {
        const observation = await reader.getLogsObservation({
          address: query.address,
          fromBlock: query.fromBlock,
          toBlock: query.toBlock,
          ...(query.topics === undefined ? {} : { topics: query.topics }),
        });
        const raw = JSON.stringify(observation.value);
        return { ok: true, result: observation.value, raw };
      } catch (error) {
        return {
          ok: false,
          result: null,
          raw: '',
          error: error instanceof Error ? error.message : 'bulk logs failed',
        };
      }
    },
  };
}

export function wrapSqdCreationSource(
  reader: EvmContractCreationReader | undefined,
): TokenCaptureRuntime['creationTraceSource'] | undefined {
  if (reader === undefined) return undefined;
  return {
    async getCreations(query) {
      try {
        const observation = await reader.getContractCreationsObservation({
          address: query.address,
          fromBlock: query.fromBlock,
          toBlock: query.toBlock,
        });
        const raw = JSON.stringify(observation.value);
        return { ok: true, result: observation.value, raw };
      } catch (error) {
        return {
          ok: false,
          result: null,
          raw: '',
          error: error instanceof Error ? error.message : 'bulk creation traces failed',
        };
      }
    },
  };
}

function policyFor(url: string, config: AppConfig): ProviderUrlPolicy {
  const configuredHost = new URL(url).hostname.toLowerCase();
  return {
    allowedHosts:
      config.providerAllowedHosts.length === 0 ? [configuredHost] : config.providerAllowedHosts,
    allowPrivateNetworks: config.allowPrivateProviderUrls,
    allowHttpForPrivateNetworks: config.environment !== 'production',
  };
}

export function createSqdBscCaptureSources(config: AppConfig): {
  bulk: TokenCaptureRuntime['bulkLogSource'] | undefined;
  creationTraces: TokenCaptureRuntime['creationTraceSource'] | undefined;
} {
  if (config.sqdPortalUrl === undefined || config.bscChainId !== 56) {
    return { bulk: undefined, creationTraces: undefined };
  }
  const source = new SqdPortalClient({
    portalUrl: config.sqdPortalUrl,
    dataset: 'binance-mainnet',
    policy: policyFor(config.sqdPortalUrl, config),
    timeoutMs: Math.max(config.requestTimeoutMs, 30_000),
    maxRangeBlocks: 1_000_000,
    maxAttempts: config.providerResilience.maxAttempts,
    retryBaseDelayMs: config.providerResilience.retryBaseDelayMs,
    retryMaxDelayMs: config.providerResilience.retryMaxDelayMs,
    requestsPerSecond: 2,
  });
  return {
    bulk: wrapSqdBulkSource(
      new SqdEvmLogReader({
        source,
        maxRangeBlocks: 1_000_000,
        maxResults: 25_000,
        includeAllBlocks: false,
      }),
    ),
    creationTraces: wrapSqdCreationSource(
      new SqdEvmContractCreationReader({
        source,
        maxRangeBlocks: 16,
        maxResults: 16,
        requestRangeBlocks: 1,
      }),
    ),
  };
}

export function createTokenCaptureRuntime(
  config: AppConfig,
  options: {
    bulk?: TokenCaptureRuntime['bulkLogSource'];
    creationTraces?: TokenCaptureRuntime['creationTraceSource'];
    storagePlane?: StoragePlane;
  } = {},
): TokenCaptureRuntime | undefined {
  const plane = buildProviderPlaneBindings(config);
  const operators = operatorsFromPlane(config);
  if (independentOperatorCount(operators) < 2) return undefined;
  const registry = new ProviderRegistry(plane.records, plane.credentials);
  const concurrency = lowCostConcurrency(config.storageProfile);
  const scheduler = new ProviderScheduler(registry, { aimdMax: concurrency.aimdMax });
  const transport = createJsonRpcTransport({
    bindings: plane.bindings,
    records: plane.records,
    timeoutMs: Math.max(
      config.requestTimeoutMs,
      plane.traceAvailable || plane.keyedArchiveAvailable ? 60_000 : 20_000,
    ),
    scheduler,
    secrets: plane.secrets,
  });
  const codeSelection = selectProviders(plane.records, {
    chainId: `eip155:${config.bscChainId}`,
    method: 'eth_getCode',
    params: ['0x0000000000000000000000000000000000000000', 'latest'],
    loadBearing: true,
  });
  if (codeSelection.selected.length < 2) return undefined;
  const sqd =
    options.bulk === undefined || options.creationTraces === undefined
      ? createSqdBscCaptureSources(config)
      : { bulk: undefined, creationTraces: undefined };
  const bulk = options.bulk ?? sqd.bulk;
  const creationTraces = options.creationTraces ?? sqd.creationTraces;
  const storagePlane = options.storagePlane ?? createStoragePlane(config);
  const base: TokenCaptureRuntime = {
    transport: {
      async call(endpointId, method, params): Promise<RpcResult> {
        const binding = plane.bindings.find(
          (item) =>
            item.providerId === endpointId ||
            item.operatorId === endpointId ||
            item.endpointRef === endpointId,
        );
        if (binding === undefined) {
          return { ok: false, result: null, raw: '', error: 'BINDING_MISSING' };
        }
        return transport.call(binding.providerId, method, params);
      },
    },
    operators,
    index: new MemoryLocalIndex(),
    logBudgetChunks: 8,
    traceAvailable: plane.traceAvailable,
    ...(plane.traceAvailable ? { traceEndpointId: 'slot-bsc-trace' } : {}),
    ...(bulk === undefined ? {} : { bulkLogSource: bulk }),
    ...(creationTraces === undefined ? {} : { creationTraceSource: creationTraces }),
  };
  return bindStoragePlane(base, storagePlane);
}
