import {
  BitcoinUtxoLedgerAdapter,
  EvmLedgerAdapter,
  FailoverJsonRpcTransport,
  FailoverRestTransport,
  ProviderRegistry,
  SafeJsonRpcTransport,
  SafeRestTransport,
  SolanaLedgerAdapter,
  SqdEvmContractCreationReader,
  SqdEvmLogReader,
  SqdPortalClient,
  type EvmContractCreationReader,
  type EvmLogReader,
  type ProviderUrlPolicy,
  type RestTransport,
  type JsonRpcTransport,
} from '@zerotrace/chain-adapters';
import {
  AnchorDataQualityService,
  MemoryDataQualityRepository,
  type ChainAnchorReader,
  type DataQualityEvidenceWriter,
} from '@zerotrace/data-quality';
import { EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import {
  ClickHouseRawFactRepository,
  DataQualityStorageError,
  PostgresDataQualityRepository,
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
  PostgresSemanticScanCheckpointRepository,
  RawArtifactStore,
  type EvidenceRepository,
  type DataQualityStorageHealth,
  type ObjectStoreHealth,
  type RawFactStorageHealth,
} from '@zerotrace/storage';

import type { AppConfig } from './config.js';

export interface AppRuntime {
  providerRegistry: ProviderRegistry;
  evmAdapters: Map<number, EvmLedgerAdapter>;
  sqdBscLogReader?: EvmLogReader;
  sqdBscCreationReader?: EvmContractCreationReader;
  bitcoinAdapter?: BitcoinUtxoLedgerAdapter;
  solanaAdapter?: SolanaLedgerAdapter;
  evidenceLedger: EvidenceLedger;
  evidenceRepository?: EvidenceRepository;
  semanticCheckpoints?: PostgresSemanticScanCheckpointRepository;
  dataQuality: AnchorDataQualityService;
  dataQualityStorage?: { health(): Promise<DataQualityStorageHealth> };
  ingestionStorage: {
    rawFacts?: { health(): Promise<RawFactStorageHealth> };
    checkpoints?: {
      health(): Promise<{
        status: 'UP' | 'DOWN';
        backend: 'POSTGRES';
        durable: true;
        checkedAt: string;
        errorCode?: string;
      }>;
    };
    artifacts?: { health(): Promise<ObjectStoreHealth> };
  };
  close?: () => Promise<void>;
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

function configuredUrls(urls: readonly string[], primary: string | undefined): string[] {
  if (urls.length > 0) return [...urls];
  return primary === undefined ? [] : [primary];
}

function resilienceFor(config: AppConfig, requestsPerSecond: number) {
  return { ...config.providerResilience, requestsPerSecond };
}

function sourceIdFor(id: string, url: string, index: number, total: number): string {
  const host = new URL(url).hostname.toLowerCase();
  return `${id}@${host}${total === 1 ? '' : `#${index + 1}`}`;
}

function jsonRpcTransports(
  urls: readonly string[],
  id: string,
  config: AppConfig,
  requestsPerSecond: number,
): JsonRpcTransport[] {
  return urls.map(
    (url, index) =>
      new SafeJsonRpcTransport({
        endpointId: sourceIdFor(id, url, index, urls.length),
        baseUrl: url,
        policy: policyFor(url, config),
        timeoutMs: config.requestTimeoutMs,
        resilience: resilienceFor(config, requestsPerSecond),
      }),
  );
}

function pooledJsonRpcTransport(
  id: string,
  transports: readonly JsonRpcTransport[],
): JsonRpcTransport {
  const first = transports[0];
  if (first === undefined) throw new Error(`Provider pool ${id} requires at least one URL.`);
  return transports.length === 1 ? first : new FailoverJsonRpcTransport(id, [...transports]);
}

function restTransports(
  urls: readonly string[],
  id: string,
  config: AppConfig,
  requestsPerSecond: number,
): RestTransport[] {
  return urls.map(
    (url, index) =>
      new SafeRestTransport({
        endpointId: sourceIdFor(id, url, index, urls.length),
        baseUrl: url,
        policy: policyFor(url, config),
        timeoutMs: config.requestTimeoutMs,
        resilience: resilienceFor(config, requestsPerSecond),
      }),
  );
}

function pooledRestTransport(id: string, transports: readonly RestTransport[]): RestTransport {
  const first = transports[0];
  if (first === undefined) throw new Error(`Provider pool ${id} requires at least one URL.`);
  return transports.length === 1 ? first : new FailoverRestTransport(id, [...transports]);
}

export function createRuntime(config: AppConfig): AppRuntime {
  const providers: Array<EvmLedgerAdapter | BitcoinUtxoLedgerAdapter | SolanaLedgerAdapter> = [];
  const unconfigured = [];
  const evmAdapters = new Map<number, EvmLedgerAdapter>();
  const ethereumAnchorReaders: ChainAnchorReader[] = [];
  const bscAnchorReaders: ChainAnchorReader[] = [];
  const bitcoinAnchorReaders: ChainAnchorReader[] = [];
  const solanaAnchorReaders: ChainAnchorReader[] = [];

  const addEvm = (
    urls: readonly string[],
    id: string,
    chainId: number,
    chainName: string,
    snapshotBlockTag: 'latest' | 'safe' | 'finalized',
    requestsPerSecond: number,
    anchorReaders: ChainAnchorReader[],
  ) => {
    if (urls.length === 0) {
      unconfigured.push({
        id,
        ledger: 'EVM' as const,
        capabilities: [
          'CURRENT_STATE',
          'BALANCE',
          'BLOCK',
          'TRANSACTION',
          'RECEIPT',
          'LOG',
        ] as const,
      });
      return;
    }
    const transports = jsonRpcTransports(urls, id, config, requestsPerSecond);
    const adapter = new EvmLedgerAdapter(
      { id, chainId, chainName, snapshotBlockTag },
      pooledJsonRpcTransport(id, transports),
    );
    providers.push(adapter);
    evmAdapters.set(chainId, adapter);
    for (const transport of transports) {
      const anchorAdapter = new EvmLedgerAdapter(
        { id, chainId, chainName, snapshotBlockTag },
        transport,
      );
      anchorReaders.push({
        sourceId: transport.endpointId,
        ledger: 'EVM',
        chainId: `eip155:${chainId}`,
        readHead: () => anchorAdapter.readHeadAnchor(),
        readAt: (position) => anchorAdapter.readAnchorAt(position),
      });
    }
  };

  addEvm(
    configuredUrls(config.ethereumRpcUrls, config.ethereumRpcUrl),
    'ethereum-rpc',
    config.ethereumChainId,
    'Ethereum',
    config.ethereumSnapshotTag,
    config.ethereumRequestsPerSecond,
    ethereumAnchorReaders,
  );
  addEvm(
    configuredUrls(config.bscRpcUrls, config.bscRpcUrl),
    'bsc-rpc',
    config.bscChainId,
    'BNB Smart Chain',
    config.bscSnapshotTag,
    config.bscRequestsPerSecond,
    bscAnchorReaders,
  );

  const sqdBscSource =
    config.sqdPortalUrl === undefined || config.bscChainId !== 56
      ? undefined
      : new SqdPortalClient({
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
  const sqdBscLogReader =
    sqdBscSource === undefined
      ? undefined
      : new SqdEvmLogReader({
          source: sqdBscSource,
          maxRangeBlocks: 10_000,
          maxResults: 25_000,
        });
  const sqdBscCreationReader =
    sqdBscSource === undefined
      ? undefined
      : new SqdEvmContractCreationReader({
          source: sqdBscSource,
          maxRangeBlocks: 1_000_000,
          maxResults: 16,
        });

  let bitcoinAdapter: BitcoinUtxoLedgerAdapter | undefined;
  const bitcoinUrls = configuredUrls(config.bitcoinEsploraUrls, config.bitcoinEsploraUrl);
  if (bitcoinUrls.length === 0) {
    unconfigured.push({
      id: 'bitcoin-esplora',
      ledger: 'BITCOIN' as const,
      capabilities: ['CURRENT_STATE', 'BLOCK', 'TRANSACTION', 'MEMPOOL', 'UTXO'] as const,
    });
  } else {
    const transports = restTransports(
      bitcoinUrls,
      'bitcoin-esplora',
      config,
      config.bitcoinEsploraRequestsPerSecond,
    );
    bitcoinAdapter = new BitcoinUtxoLedgerAdapter(
      { id: 'bitcoin-esplora' },
      pooledRestTransport('bitcoin-esplora', transports),
    );
    providers.push(bitcoinAdapter);
    for (const transport of transports) {
      const anchorAdapter = new BitcoinUtxoLedgerAdapter({ id: 'bitcoin-esplora' }, transport);
      bitcoinAnchorReaders.push({
        sourceId: transport.endpointId,
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        readHead: () => anchorAdapter.readHeadAnchor(),
        readAt: (position) => anchorAdapter.readAnchorAt(position),
      });
    }
  }

  let solanaAdapter: SolanaLedgerAdapter | undefined;
  const solanaUrls = configuredUrls(config.solanaRpcUrls, config.solanaRpcUrl);
  if (solanaUrls.length === 0) {
    unconfigured.push({
      id: 'solana-rpc',
      ledger: 'SOLANA' as const,
      capabilities: [
        'CURRENT_STATE',
        'BALANCE',
        'BLOCK',
        'TRANSACTION',
        'INSTRUCTION',
        'SIMULATION',
      ] as const,
    });
  } else {
    const transports = jsonRpcTransports(
      solanaUrls,
      'solana-rpc',
      config,
      config.solanaRequestsPerSecond,
    );
    solanaAdapter = new SolanaLedgerAdapter(
      { id: 'solana-rpc', commitment: config.solanaCommitment },
      pooledJsonRpcTransport('solana-rpc', transports),
    );
    providers.push(solanaAdapter);
    for (const transport of transports) {
      const anchorAdapter = new SolanaLedgerAdapter(
        { id: 'solana-rpc', commitment: config.solanaCommitment },
        transport,
      );
      solanaAnchorReaders.push({
        sourceId: transport.endpointId,
        ledger: 'SOLANA',
        chainId: 'solana-mainnet',
        readHead: () => anchorAdapter.readHeadAnchor(),
        readAt: (position) => anchorAdapter.readAnchorAt(position),
      });
    }
  }

  const evidenceLedger = new EvidenceLedger();
  const evidenceRepository =
    config.postgresUrl === undefined
      ? undefined
      : PostgresEvidenceRepository.fromConnectionString({
          connectionString: config.postgresUrl,
          connectionTimeoutMs: Math.min(config.requestTimeoutMs, 5_000),
          statementTimeoutMs: config.requestTimeoutMs,
          maxConnections: 10,
        });

  const dataQualityRepository =
    config.postgresUrl === undefined
      ? new MemoryDataQualityRepository()
      : new PostgresDataQualityRepository({
          connectionString: config.postgresUrl,
          connectionTimeoutMs: Math.min(config.requestTimeoutMs, 5_000),
          statementTimeoutMs: config.requestTimeoutMs,
          maxConnections: 4,
        });
  const evidenceWriter: DataQualityEvidenceWriter = {
    put: async (evidence, sourceEvidenceIds = [], snapshot) => {
      if (evidenceRepository !== undefined) {
        const stored = await evidenceRepository.put(evidence, sourceEvidenceIds, snapshot);
        if (
          sourceEvidenceIds.every((id) => evidenceLedger.get(id) !== undefined) &&
          evidenceLedger.get(evidence.id) === undefined
        ) {
          evidenceLedger.add(evidence, sourceEvidenceIds, snapshot);
        }
        return stored;
      }
      const existing = evidenceLedger.get(evidence.id);
      if (existing !== undefined) {
        if (
          hashPayload(existing.evidence) !== hashPayload(evidence) ||
          hashPayload(existing.sourceEvidenceIds) !==
            hashPayload([...new Set(sourceEvidenceIds)].sort()) ||
          hashPayload(existing.snapshot ?? null) !== hashPayload(snapshot ?? null)
        ) {
          throw new DataQualityStorageError(
            'DATA_QUALITY_STORAGE_CONFLICT',
            'Process-local Data Quality Evidence conflicts with an existing observation.',
          );
        }
        return existing;
      }
      return evidenceLedger.add(evidence, sourceEvidenceIds, snapshot);
    },
  };
  const dataQuality = new AnchorDataQualityService({
    targets: [
      {
        ledger: 'EVM',
        chainId: `eip155:${config.ethereumChainId}`,
        readers: ethereumAnchorReaders,
      },
      { ledger: 'EVM', chainId: `eip155:${config.bscChainId}`, readers: bscAnchorReaders },
      { ledger: 'BITCOIN', chainId: 'bitcoin-mainnet', readers: bitcoinAnchorReaders },
      { ledger: 'SOLANA', chainId: 'solana-mainnet', readers: solanaAnchorReaders },
    ],
    repository: dataQualityRepository,
    evidence: evidenceWriter,
    requiredSources: config.dataQualityMinSources,
  });

  const rawFacts =
    config.clickhouseUrl === undefined
      ? undefined
      : new ClickHouseRawFactRepository({
          url: config.clickhouseUrl,
          requestTimeoutMs: config.requestTimeoutMs,
          maxConnections: 4,
          ...(config.clickhouseUsername === undefined
            ? {}
            : { username: config.clickhouseUsername }),
          ...(config.clickhousePassword === undefined
            ? {}
            : { password: config.clickhousePassword.reveal() }),
        });
  const checkpoints =
    config.postgresUrl === undefined
      ? undefined
      : new PostgresIngestionCheckpointRepository({
          connectionString: config.postgresUrl,
          connectionTimeoutMs: Math.min(config.requestTimeoutMs, 5_000),
          statementTimeoutMs: config.requestTimeoutMs,
          maxConnections: 4,
        });
  const semanticCheckpoints =
    config.postgresUrl === undefined
      ? undefined
      : new PostgresSemanticScanCheckpointRepository({
          connectionString: config.postgresUrl,
          connectionTimeoutMs: Math.min(config.requestTimeoutMs, 5_000),
          statementTimeoutMs: config.requestTimeoutMs,
          maxConnections: 4,
        });
  const artifacts =
    config.objectStoreEndpoint === undefined ||
    config.objectStoreAccessKey === undefined ||
    config.objectStoreSecretKey === undefined
      ? undefined
      : new RawArtifactStore({
          endpoint: config.objectStoreEndpoint,
          accessKey: config.objectStoreAccessKey,
          secretKey: config.objectStoreSecretKey.reveal(),
          ...(config.objectStoreBucket === undefined ? {} : { bucket: config.objectStoreBucket }),
        });

  const close = async () => {
    await Promise.all([
      evidenceRepository?.close(),
      dataQualityRepository instanceof PostgresDataQualityRepository
        ? dataQualityRepository.close()
        : undefined,
      checkpoints?.close(),
      semanticCheckpoints?.close(),
      rawFacts?.close(),
    ]);
  };

  return {
    providerRegistry: new ProviderRegistry(
      providers,
      unconfigured.map((item) => ({ ...item, capabilities: [...item.capabilities] })),
    ),
    evmAdapters,
    ...(sqdBscLogReader === undefined ? {} : { sqdBscLogReader }),
    ...(sqdBscCreationReader === undefined ? {} : { sqdBscCreationReader }),
    evidenceLedger,
    dataQuality,
    ingestionStorage: {
      ...(rawFacts === undefined ? {} : { rawFacts }),
      ...(checkpoints === undefined ? {} : { checkpoints }),
      ...(artifacts === undefined ? {} : { artifacts }),
    },
    close,
    ...(evidenceRepository === undefined ? {} : { evidenceRepository }),
    ...(semanticCheckpoints === undefined ? {} : { semanticCheckpoints }),
    ...(dataQualityRepository instanceof PostgresDataQualityRepository
      ? { dataQualityStorage: dataQualityRepository }
      : {}),
    ...(bitcoinAdapter === undefined ? {} : { bitcoinAdapter }),
    ...(solanaAdapter === undefined ? {} : { solanaAdapter }),
  };
}
