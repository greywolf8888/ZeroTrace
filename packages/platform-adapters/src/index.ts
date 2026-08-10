import { unknownValue, type Ledger } from '@zerotrace/schemas';

export * from './flap.js';
export * from './flap-market.js';
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
export * from './claim-evm-observation.js';

export type PlatformRole = 'LAUNCH_MECHANISM' | 'EXECUTION_PLATFORM' | 'LABEL_PROVIDER';
export type AdapterImplementationStatus =
  | 'INTERFACE_READY'
  | 'PARTIALLY_IMPLEMENTED'
  | 'IMPLEMENTED'
  | 'EXTERNAL_VALIDATION_REQUIRED'
  | 'LICENSE_ISOLATION_REQUIRED';

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
    implementationStatus: 'INTERFACE_READY',
    officialSources: [],
    integrationBoundary: 'Deployment and launch timestamp must select the mechanism version.',
  },
  {
    id: 'four-meme',
    name: 'Four.meme',
    roles: ['LAUNCH_MECHANISM'],
    ledgers: ['EVM'],
    implementationStatus: 'INTERFACE_READY',
    officialSources: [],
    integrationBoundary:
      'Discover current factory, curve, graduation, and Pancake migration state at runtime.',
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

export interface GenericLaunchObservation {
  ledger: Ledger;
  chainId: string;
  factoryOrProgram?: string;
  quoteReserve?: string;
  virtualReserve?: string;
  buySellEvents: number;
  migrationEvents: number;
  liquidityEvents: number;
  feeTransferEvents: number;
  evidenceIds: string[];
}

export interface GenericLaunchDetection {
  platform: 'UNKNOWN_LAUNCHPAD';
  mechanismConfidence: number;
  mechanism: ReturnType<typeof unknownValue> | { state: 'known'; value: 'BONDING_CURVE_LIKE' };
  evidenceIds: string[];
  reasons: string[];
}

export function inferGenericLaunchMechanism(
  observation: GenericLaunchObservation,
): GenericLaunchDetection {
  if (observation.evidenceIds.length === 0) {
    return {
      platform: 'UNKNOWN_LAUNCHPAD',
      mechanismConfidence: 0,
      mechanism: unknownValue('INSUFFICIENT_DATA', 'Detection requires raw on-chain evidence.'),
      evidenceIds: [],
      reasons: ['No grounded evidence was supplied.'],
    };
  }
  const reasons: string[] = [];
  let score = 0;
  if (observation.factoryOrProgram !== undefined) {
    score += 0.2;
    reasons.push('A factory or program origin is present.');
  }
  if (observation.quoteReserve !== undefined || observation.virtualReserve !== undefined) {
    score += 0.3;
    reasons.push('Reserve state is observable.');
  }
  if (observation.buySellEvents >= 2) {
    score += 0.25;
    reasons.push('Repeated primary-market buy/sell events are present.');
  }
  if (observation.migrationEvents > 0 && observation.liquidityEvents > 0) {
    score += 0.2;
    reasons.push('Migration and liquidity creation are linked.');
  }
  if (observation.feeTransferEvents > 0) {
    score += 0.05;
    reasons.push('Protocol fee transfers are observable.');
  }
  const confidence = Math.min(1, Number(score.toFixed(4)));
  return {
    platform: 'UNKNOWN_LAUNCHPAD',
    mechanismConfidence: confidence,
    mechanism:
      confidence >= 0.65
        ? { state: 'known', value: 'BONDING_CURVE_LIKE' }
        : unknownValue(
            'INSUFFICIENT_DATA',
            'Observed features do not identify a mechanism reliably.',
          ),
    evidenceIds: [...new Set(observation.evidenceIds)],
    reasons,
  };
}
