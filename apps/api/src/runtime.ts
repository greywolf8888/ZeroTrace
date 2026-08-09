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

import type { AppConfig } from './config.js';

export interface AppRuntime {
  providerRegistry: ProviderRegistry;
  evmAdapters: Map<number, EvmLedgerAdapter>;
  bitcoinAdapter?: BitcoinUtxoLedgerAdapter;
  solanaAdapter?: SolanaLedgerAdapter;
  evidenceLedger: EvidenceLedger;
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

  return {
    providerRegistry: new ProviderRegistry(
      providers,
      unconfigured.map((item) => ({ ...item, capabilities: [...item.capabilities] })),
    ),
    evmAdapters,
    evidenceLedger: new EvidenceLedger(),
    ...(bitcoinAdapter === undefined ? {} : { bitcoinAdapter }),
    ...(solanaAdapter === undefined ? {} : { solanaAdapter }),
  };
}
