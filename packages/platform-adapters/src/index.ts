import type { Ledger } from '@zerotrace/schemas';

export * from './flap.js';
export * from './flap-market.js';
export * from './flap-pension-entry.js';
export * from './flap-market-reconciliation.js';
export * from './flap-events.js';
export * from './flap-history.js';
export * from './flap-history-projection.js';
export * from './flap-lifetime-extension.js';
export * from './flap-lifetime.js';
export * from './flap-origin.js';
export * from './claim-evm.js';
export * from './claim-evm-burn.js';
export * from './claim-evm-burn-discovery.js';
export * from './claim-evm-burn-promotion.js';
export * from './claim-evm-supply-continuity.js';
export * from './claim-evm-observation.js';
export * from './claim-evm-pension-discovery.js';
export * from './erc20-metadata.js';
export * from './evm-control-rights.js';
export * from './bitcoin-control-rights.js';
export * from './bitcoin-transaction-entity.js';
export * from './bitcoin-forensic-graph.js';
export * from './launchpad-registry.js';
export * from './launchpad-provenance.js';
export * from './solana-control-rights.js';
export * from './solana-asset-flow.js';
export * from './solana-transaction-semantics.js';
export * from './solana-launchpad.js';
export * from './solana-raydium-launchlab.js';
export * from './solana-raydium-launchlab-pool-state.js';
export * from './sourcify.js';

export type PlatformRole = 'LAUNCH_MECHANISM' | 'EXECUTION_PLATFORM' | 'LABEL_PROVIDER';
export type AdapterImplementationStatus =
  | 'INTERFACE_READY'
  | 'PARTIALLY_IMPLEMENTED'
  | 'IMPLEMENTED'
  | 'EXTERNAL_VALIDATION_REQUIRED'
  | 'LICENSE_ISOLATION_REQUIRED'
  | 'REGISTRY_ONLY';

export interface PlatformDescriptor {
  id: string;
  name: string;
  roles: PlatformRole[];
  ledgers: Ledger[];
  implementationStatus: AdapterImplementationStatus;
  officialSources: string[];
  integrationBoundary: string;
}

export const PLATFORM_REGISTRY: readonly PlatformDescriptor[] = Object.freeze([
  {
    id: 'flap',
    name: 'Flap',
    roles: ['LAUNCH_MECHANISM'],
    ledgers: ['EVM'],
    implementationStatus: 'PARTIALLY_IMPLEMENTED',
    officialSources: [
      'https://docs.flap.sh/flap/developers/inspect-a-token',
      'https://docs.flap.sh/flap/developers/basic-and-mechanism/bonding-curve',
    ],
    integrationBoundary:
      'Versioned Portal V8Safe/V6/V5 inspection, fixed-block previewSell, exact receipt events, durable origin/history scans, exact lifetime materialization, continuous accepted heads, deterministic rollback, provider-free replay, and verified Pancake V2 migrated-pool spot/buy/exit-size scenarios are wired; real-reorg acceptance, fork tax execution, vault, migration control, LP ownership, additional routes, gas, and executable capacity remain pending.',
  },
  {
    id: 'pump',
    name: 'Pump / PumpSwap',
    roles: ['LAUNCH_MECHANISM'],
    ledgers: ['SOLANA'],
    implementationStatus: 'EXTERNAL_VALIDATION_REQUIRED',
    officialSources: ['https://github.com/pump-fun/pump-public-docs'],
    integrationBoundary:
      'IDL and program accounts are authoritative; Carbon is the preferred decoder boundary.',
  },
  {
    id: 'raydium-launchlab',
    name: 'Raydium LaunchLab',
    roles: ['LAUNCH_MECHANISM'],
    ledgers: ['SOLANA'],
    implementationStatus: 'LICENSE_ISOLATION_REQUIRED',
    officialSources: ['https://docs.raydium.io/products/launchlab/bonding-curve'],
    integrationBoundary:
      'Use chain state/IDL or an isolated GPL-compatible sidecar; do not copy SDK code into core.',
  },
  {
    id: 'meteora-dbc',
    name: 'Meteora Dynamic Bonding Curve',
    roles: ['LAUNCH_MECHANISM'],
    ledgers: ['SOLANA'],
    implementationStatus: 'EXTERNAL_VALIDATION_REQUIRED',
    officialSources: ['https://docs.meteora.ag/'],
    integrationBoundary:
      'Read virtual-pool config and migration state through official program data/decoder.',
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    roles: ['LAUNCH_MECHANISM'],
    ledgers: ['SOLANA', 'EVM'],
    implementationStatus: 'REGISTRY_ONLY',
    officialSources: ['https://docs.moonshot.cc/', 'https://api.moonshot.cc'],
    integrationBoundary:
      'Deployment and launch timestamp must select a versioned mechanism; current API data is cross-check evidence only.',
  },
  {
    id: 'four-meme',
    name: 'Four.meme',
    roles: ['LAUNCH_MECHANISM'],
    ledgers: ['EVM'],
    implementationStatus: 'REGISTRY_ONLY',
    officialSources: [
      'https://www.four.meme/',
      'https://github.com/four-meme-community/four-meme-ai',
    ],
    integrationBoundary:
      'Discover versioned TokenManager/template, curve, graduation, and Pancake migration state at runtime; never connect write or private-key flows.',
  },
  {
    id: 'fomowell',
    name: 'FomoWell',
    roles: ['LAUNCH_MECHANISM'],
    ledgers: ['BITCOIN'],
    implementationStatus: 'EXTERNAL_VALIDATION_REQUIRED',
    officialSources: ['https://btc.fomowell.com/'],
    integrationBoundary:
      'Minimal ICP/ICRC/ckBTC read adapter; production canisters require runtime discovery.',
  },
  {
    id: 'gmgn',
    name: 'GMGN',
    roles: ['EXECUTION_PLATFORM', 'LABEL_PROVIDER'],
    ledgers: ['EVM', 'SOLANA'],
    implementationStatus: 'EXTERNAL_VALIDATION_REQUIRED',
    officialSources: [
      'https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-solana-trading-api',
    ],
    integrationBoundary:
      'Optional authenticated quote cross-check only; observations never merge entities.',
  },
]);
