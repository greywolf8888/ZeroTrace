import {
  BitcoinUtxoLedgerAdapter,
  EvmLedgerAdapter,
  FailoverJsonRpcTransport,
  FailoverRestTransport,
  ProviderRegistry,
  SafeJsonRpcTransport,
  SafeRestTransport,
  SolanaLedgerAdapter,
  type ProviderUrlPolicy,
  type RestTransport,
  type JsonRpcTransport,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import {
  ClickHouseRawFactRepository,
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
  RawArtifactStore,
  type EvidenceRepository,
  type ObjectStoreHealth,
  type RawFactStorageHealth,
} from '@zerotrace/storage';

import type { AppConfig } from './config.js';

export interface AppRuntime {
  providerRegistry: ProviderRegistry;
  evmAdapters: Map<number, EvmLedgerAdapter>;
  bitcoinAdapter?: BitcoinUtxoLedgerAdapter;
  solanaAdapter?: SolanaLedgerAdapter;
  evidenceLedger: EvidenceLedger;
  evidenceRepository?: EvidenceRepository;
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

function jsonRpcTransport(
  urls: readonly string[],
  id: string,
  config: AppConfig,
  requestsPerSecond: number,
): JsonRpcTransport {
  const transports = urls.map(
    (url, index) =>
      new SafeJsonRpcTransport({
        endpointId: sourceIdFor(id, url, index, urls.length),
        baseUrl: url,
        policy: policyFor(url, config),
        timeoutMs: config.requestTimeoutMs,
        resilience: resilienceFor(config, requestsPerSecond),
      }),
  );
  const first = transports[0];
  if (first === undefined) throw new Error(`Provider pool ${id} requires at least one URL.`);
  return transports.length === 1 ? first : new FailoverJsonRpcTransport(id, transports);
}

function restTransport(
  urls: readonly string[],
  id: string,
  config: AppConfig,
  requestsPerSecond: number,
): RestTransport {
  const transports = urls.map(
    (url, index) =>
      new SafeRestTransport({
        endpointId: sourceIdFor(id, url, index, urls.length),
        baseUrl: url,
        policy: policyFor(url, config),
        timeoutMs: config.requestTimeoutMs,
        resilience: resilienceFor(config, requestsPerSecond),
      }),
  );
  const first = transports[0];
  if (first === undefined) throw new Error(`Provider pool ${id} requires at least one URL.`);
  return transports.length === 1 ? first : new FailoverRestTransport(id, transports);
}

export function createRuntime(config: AppConfig): AppRuntime {
  const providers: Array<EvmLedgerAdapter | BitcoinUtxoLedgerAdapter | SolanaLedgerAdapter> = [];
  const unconfigured = [];
  const evmAdapters = new Map<number, EvmLedgerAdapter>();

  const addEvm = (
    urls: readonly string[],
    id: string,
    chainId: number,
    chainName: string,
    requestsPerSecond: number,
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
    const adapter = new EvmLedgerAdapter(
      { id, chainId, chainName },
      jsonRpcTransport(urls, id, config, requestsPerSecond),
    );
    providers.push(adapter);
    evmAdapters.set(chainId, adapter);
  };

  addEvm(
    configuredUrls(config.ethereumRpcUrls, config.ethereumRpcUrl),
    'ethereum-rpc',
    config.ethereumChainId,
    'Ethereum',
    config.ethereumRequestsPerSecond,
  );
  addEvm(
    configuredUrls(config.bscRpcUrls, config.bscRpcUrl),
    'bsc-rpc',
    config.bscChainId,
    'BNB Smart Chain',
    config.bscRequestsPerSecond,
  );

  let bitcoinAdapter: BitcoinUtxoLedgerAdapter | undefined;
  const bitcoinUrls = configuredUrls(config.bitcoinEsploraUrls, config.bitcoinEsploraUrl);
  if (bitcoinUrls.length === 0) {
    unconfigured.push({
      id: 'bitcoin-esplora',
      ledger: 'BITCOIN' as const,
      capabilities: ['CURRENT_STATE', 'BLOCK', 'TRANSACTION', 'MEMPOOL', 'UTXO'] as const,
    });
  } else {
    bitcoinAdapter = new BitcoinUtxoLedgerAdapter(
      { id: 'bitcoin-esplora' },
      restTransport(bitcoinUrls, 'bitcoin-esplora', config, config.bitcoinEsploraRequestsPerSecond),
    );
    providers.push(bitcoinAdapter);
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
    solanaAdapter = new SolanaLedgerAdapter(
      { id: 'solana-rpc', commitment: config.solanaCommitment },
      jsonRpcTransport(solanaUrls, 'solana-rpc', config, config.solanaRequestsPerSecond),
    );
    providers.push(solanaAdapter);
  }

  const evidenceRepository =
    config.postgresUrl === undefined
      ? undefined
      : PostgresEvidenceRepository.fromConnectionString({
          connectionString: config.postgresUrl,
          connectionTimeoutMs: Math.min(config.requestTimeoutMs, 5_000),
          statementTimeoutMs: config.requestTimeoutMs,
          maxConnections: 10,
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
    await Promise.all([evidenceRepository?.close(), checkpoints?.close(), rawFacts?.close()]);
  };

  return {
    providerRegistry: new ProviderRegistry(
      providers,
      unconfigured.map((item) => ({ ...item, capabilities: [...item.capabilities] })),
    ),
    evmAdapters,
    evidenceLedger: new EvidenceLedger(),
    ingestionStorage: {
      ...(rawFacts === undefined ? {} : { rawFacts }),
      ...(checkpoints === undefined ? {} : { checkpoints }),
      ...(artifacts === undefined ? {} : { artifacts }),
    },
    close,
    ...(evidenceRepository === undefined ? {} : { evidenceRepository }),
    ...(bitcoinAdapter === undefined ? {} : { bitcoinAdapter }),
    ...(solanaAdapter === undefined ? {} : { solanaAdapter }),
  };
}
