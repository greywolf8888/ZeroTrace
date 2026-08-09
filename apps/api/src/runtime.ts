import {
  BitcoinUtxoLedgerAdapter,
  EvmLedgerAdapter,
  ProviderRegistry,
  SafeJsonRpcTransport,
  SafeRestTransport,
  SolanaLedgerAdapter,
  type ProviderUrlPolicy,
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

export function createRuntime(config: AppConfig): AppRuntime {
  const providers: Array<EvmLedgerAdapter | BitcoinUtxoLedgerAdapter | SolanaLedgerAdapter> = [];
  const unconfigured = [];
  const evmAdapters = new Map<number, EvmLedgerAdapter>();

  const addEvm = (url: string | undefined, id: string, chainId: number, chainName: string) => {
    if (url === undefined) {
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
      new SafeJsonRpcTransport({
        endpointId: id,
        baseUrl: url,
        policy: policyFor(url, config),
        timeoutMs: config.requestTimeoutMs,
      }),
    );
    providers.push(adapter);
    evmAdapters.set(chainId, adapter);
  };

  addEvm(config.ethereumRpcUrl, 'ethereum-rpc', config.ethereumChainId, 'Ethereum');
  addEvm(config.bscRpcUrl, 'bsc-rpc', config.bscChainId, 'BNB Smart Chain');

  let bitcoinAdapter: BitcoinUtxoLedgerAdapter | undefined;
  if (config.bitcoinEsploraUrl === undefined) {
    unconfigured.push({
      id: 'bitcoin-esplora',
      ledger: 'BITCOIN' as const,
      capabilities: ['CURRENT_STATE', 'BLOCK', 'TRANSACTION', 'MEMPOOL', 'UTXO'] as const,
    });
  } else {
    bitcoinAdapter = new BitcoinUtxoLedgerAdapter(
      { id: 'bitcoin-esplora' },
      new SafeRestTransport({
        endpointId: 'bitcoin-esplora',
        baseUrl: config.bitcoinEsploraUrl,
        policy: policyFor(config.bitcoinEsploraUrl, config),
        timeoutMs: config.requestTimeoutMs,
      }),
    );
    providers.push(bitcoinAdapter);
  }

  let solanaAdapter: SolanaLedgerAdapter | undefined;
  if (config.solanaRpcUrl === undefined) {
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
      new SafeJsonRpcTransport({
        endpointId: 'solana-rpc',
        baseUrl: config.solanaRpcUrl,
        policy: policyFor(config.solanaRpcUrl, config),
        timeoutMs: config.requestTimeoutMs,
      }),
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
