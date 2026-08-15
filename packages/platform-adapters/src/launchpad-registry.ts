import {
  GenericLaunchDetectionSchema,
  GenericLaunchObservationSchema,
  LaunchpadRegistryEntrySchema,
  ProtocolDeploymentVersionSchema,
  unknownValue,
  type GenericLaunchDetection,
  type GenericLaunchObservation,
  type LaunchpadRegistryEntry,
  type ProtocolDeploymentVersion,
} from '@zerotrace/schemas';

import {
  PUMP_LAUNCHPAD_PROTOCOL_VERSION,
  PUMPSWAP_LAUNCHPAD_PROTOCOL_VERSION,
} from './launchpad-provenance.js';
import {
  RAYDIUM_LAUNCHLAB_PROTOCOL_VERSION,
  RAYDIUM_LAUNCHLAB_SOURCE_COMMIT,
} from './solana-raydium-launchlab.js';

export {
  GenericLaunchDetectionSchema,
  GenericLaunchObservationSchema,
  LaunchpadDecoderStatusSchema,
  LaunchpadProvenanceStatusSchema,
  LaunchpadRegistryEntrySchema,
  ProtocolDeploymentVersionSchema,
} from '@zerotrace/schemas';
export type {
  GenericLaunchDetection,
  GenericLaunchObservation,
  LaunchpadDecoderStatus,
  LaunchpadProvenanceStatus,
  LaunchpadRegistryEntry,
  ProtocolDeploymentVersion,
} from '@zerotrace/schemas';

export const LAUNCHPAD_REGISTRY_VERSION = 'launchpad-registry-v1';
export const LAUNCHPAD_DECODER_POLICY_VERSION = 'launchpad-decoder-policy-v1';

const officialReadOnlySources = {
  flap: [
    'https://docs.flap.sh/flap/developers/deployed-contract-addresses',
    'https://docs.flap.sh/flap/developers/inspect-a-token',
    'https://docs.flap.sh/flap/developers/basic-and-mechanism/bonding-curve',
  ],
  pump: [
    'https://pump.fun/docs/',
    'https://github.com/pump-fun/pump-public-docs',
    'https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json',
    'https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json',
    'https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md',
  ],
  raydium: [
    'https://docs.raydium.io/reference/program-addresses',
    'https://docs.raydium.io/products/launchlab/bonding-curve',
    'https://docs.raydium.io/products/launchlab/instructions',
    'https://docs.raydium.io/sdk-api/anchor-idl',
    `https://github.com/raydium-io/raydium-idl/tree/${RAYDIUM_LAUNCHLAB_SOURCE_COMMIT}`,
    `https://raw.githubusercontent.com/raydium-io/raydium-idl/${RAYDIUM_LAUNCHLAB_SOURCE_COMMIT}/raydium_launchpad/raydium_launchpad.json`,
  ],
  meteora: [
    'https://docs.meteora.ag/',
    'https://github.com/MeteoraAg/dynamic-bonding-curve',
    'https://raw.githubusercontent.com/MeteoraAg/dynamic-bonding-curve/main/license.md',
  ],
  moonshot: ['https://docs.moonshot.cc/', 'https://api.moonshot.cc'],
  fourMeme: ['https://www.four.meme/', 'https://github.com/four-meme-community/four-meme-ai'],
  fomowell: ['https://btc.fomowell.com/'],
} as const;

function pendingEntry(
  entry: Omit<LaunchpadRegistryEntry, 'provenanceStatus' | 'decoderStatus' | 'versions'> & {
    provenanceStatus?: LaunchpadRegistryEntry['provenanceStatus'];
    decoderStatus?: LaunchpadRegistryEntry['decoderStatus'];
    versions?: ProtocolDeploymentVersion[];
  },
): LaunchpadRegistryEntry {
  return {
    ...entry,
    provenanceStatus: entry.provenanceStatus ?? 'PROVENANCE_PENDING',
    decoderStatus: entry.decoderStatus ?? 'NOT_AVAILABLE',
    versions: entry.versions ?? [],
  };
}

/**
 * This registry intentionally contains no guessed addresses. An entry with an
 * empty `versions` array is visible to the UI and API as a research target,
 * but cannot activate a decoder until the official source, chain identity,
 * hash, and historical provider capture are all bound to one version record. Pump and
 * PumpSwap are the first entries with complete read-only provenance records.
 */
export const LAUNCHPAD_PROTOCOL_REGISTRY: readonly LaunchpadRegistryEntry[] = Object.freeze([
  pendingEntry({
    platform: 'flap',
    name: 'Flap',
    ledgers: ['EVM'],
    officialSourceUris: [...officialReadOnlySources.flap],
    integrationBoundary:
      'The existing Flap adapter remains read-only and partially implemented. Its deployment inspection is not promoted into this registry until its ABI hash and replay Evidence root are pinned as one version record.',
    decoderStatus: 'PARTIAL_READ_ONLY',
  }),
  pendingEntry({
    platform: 'pump',
    name: 'Pump / PumpSwap',
    ledgers: ['SOLANA'],
    officialSourceUris: [...officialReadOnlySources.pump],
    provenanceStatus: 'PINNED',
    decoderStatus: 'READY_READ_ONLY',
    versions: [PUMP_LAUNCHPAD_PROTOCOL_VERSION, PUMPSWAP_LAUNCHPAD_PROTOCOL_VERSION],
    integrationBoundary:
      'Use raw Solana instructions, program accounts, bonding-curve accounts, and PumpSwap pools. These pinned Pump and PumpSwap versions are read-only and backed by real finalized provider captures; web pages are not a core data source. SOL/USDC, fee, and feature changes require separate deployment versions.',
  }),
  pendingEntry({
    platform: 'raydium-launchlab',
    name: 'Raydium LaunchLab',
    ledgers: ['SOLANA'],
    officialSourceUris: [...officialReadOnlySources.raydium],
    provenanceStatus: 'PROVENANCE_PENDING',
    decoderStatus: 'PARTIAL_READ_ONLY',
    versions: [RAYDIUM_LAUNCHLAB_PROTOCOL_VERSION],
    integrationBoundary:
      'A clean-room discriminator/account decoder is wired for the pinned official LaunchLab program and source commit, including Borsh MintParams, CurveParams, VestingParams, the Token-2022 transfer-fee option, AMM/CPMM migration arguments, and the raw 429-byte PoolState layout. Historical pool-state reads, deployment-sensitive remaining accounts, and real-fixture Evidence closure are still required before activation. The GPL-licensed SDK is not copied into core.',
  }),
  pendingEntry({
    platform: 'meteora-dbc',
    name: 'Meteora Dynamic Bonding Curve',
    ledgers: ['SOLANA'],
    officialSourceUris: [...officialReadOnlySources.meteora],
    provenanceStatus: 'LICENSE_REVIEW_REQUIRED',
    integrationBoundary:
      'The public DBC repository is a protocol/schema reference only until its repository license is cleared for the intended boundary. A clean-room decoder or isolated process may be used.',
  }),
  pendingEntry({
    platform: 'moonshot',
    name: 'Moonshot / Moonit',
    ledgers: ['SOLANA', 'EVM'],
    officialSourceUris: [...officialReadOnlySources.moonshot],
    integrationBoundary:
      'Separate old Moonshot curves, later versions, migration destinations, and Moonit evolution by time window. The public Data API is cross-check evidence, not the sole historical source.',
  }),
  pendingEntry({
    platform: 'four-meme',
    name: 'Four.meme',
    ledgers: ['EVM'],
    officialSourceUris: [...officialReadOnlySources.fourMeme],
    integrationBoundary:
      'Version TokenManager/template/migration and read-only event or quote semantics. Never import the official agent skill write path, private-key path, or transaction path.',
  }),
  pendingEntry({
    platform: 'fomowell',
    name: 'FomoWell',
    ledgers: ['BITCOIN'],
    officialSourceUris: [...officialReadOnlySources.fomowell],
    integrationBoundary:
      'Keep the ICP/ckBTC canister boundary separate from EVM and Solana. Canister identifiers and query/read_state observations must be discovered from official material and chain state before activation.',
  }),
]);

for (const entry of LAUNCHPAD_PROTOCOL_REGISTRY) {
  LaunchpadRegistryEntrySchema.parse(entry);
}

export function getLaunchpadProtocolRegistryEntry(
  platform: string,
): LaunchpadRegistryEntry | undefined {
  return LAUNCHPAD_PROTOCOL_REGISTRY.find((entry) => entry.platform === platform);
}

export interface LaunchpadDecoderActivationInput {
  platform: string;
  deploymentId: string;
  version?: ProtocolDeploymentVersion;
  hasRealHistoricalFixture: boolean;
  chainIdentityVerified: boolean;
}

export interface LaunchpadDecoderActivationResult {
  platform: string;
  deploymentId: string;
  state: 'READY' | 'BLOCKED';
  reasons: string[];
  version?: ProtocolDeploymentVersion;
}

/**
 * A decoder can be wired only after provenance and real-chain gates pass.
 * This is deliberately a pure policy decision so callers can surface a
 * durable `Unknown`/blocked state without probing or mutating external state.
 */
export function evaluateLaunchpadDecoderActivation(
  input: LaunchpadDecoderActivationInput,
): LaunchpadDecoderActivationResult {
  const entry = getLaunchpadProtocolRegistryEntry(input.platform);
  const version =
    input.version ??
    entry?.versions.find((candidate) => candidate.deploymentId === input.deploymentId);
  const reasons: string[] = [];

  if (entry === undefined) {
    reasons.push('PLATFORM_NOT_REGISTERED');
  } else if (entry.provenanceStatus !== 'PINNED') {
    reasons.push(`PROVENANCE_${entry.provenanceStatus}`);
  }
  if (version === undefined) {
    reasons.push('DEPLOYMENT_VERSION_NOT_PINNED');
  } else {
    ProtocolDeploymentVersionSchema.parse(version);
    if (version.sourceCommit === undefined) reasons.push('SOURCE_COMMIT_NOT_PINNED');
    if (version.evidenceIds.length === 0) reasons.push('PROVENANCE_EVIDENCE_MISSING');
  }
  if (!input.chainIdentityVerified) reasons.push('CHAIN_IDENTITY_NOT_VERIFIED');
  if (!input.hasRealHistoricalFixture) reasons.push('REAL_HISTORICAL_FIXTURE_MISSING');

  if (reasons.length > 0) {
    return {
      platform: input.platform,
      deploymentId: input.deploymentId,
      state: 'BLOCKED',
      reasons,
      ...(version === undefined ? {} : { version }),
    };
  }

  return {
    platform: input.platform,
    deploymentId: input.deploymentId,
    state: 'READY',
    reasons: [],
    ...(version === undefined ? {} : { version }),
  };
}

export function inferGenericLaunchMechanism(
  observation: GenericLaunchObservation,
): GenericLaunchDetection {
  const parsed = GenericLaunchObservationSchema.parse(observation);
  if (parsed.evidenceIds.length === 0) {
    return GenericLaunchDetectionSchema.parse({
      platform: 'UNKNOWN_LAUNCHPAD',
      mechanismConfidence: 0,
      mechanism: unknownValue('INSUFFICIENT_DATA', 'Detection requires raw on-chain evidence.'),
      evidenceIds: [],
      reasons: ['No grounded evidence was supplied.'],
    });
  }

  const reasons: string[] = [];
  let score = 0;
  if (parsed.factoryOrProgram !== undefined) {
    score += 0.2;
    reasons.push('A factory or program origin is present.');
  }
  if (parsed.quoteReserve !== undefined || parsed.virtualReserve !== undefined) {
    score += 0.3;
    reasons.push('Reserve state is observable.');
  }
  if (parsed.buySellEvents >= 2) {
    score += 0.25;
    reasons.push('Repeated primary-market buy/sell events are present.');
  }
  if (parsed.migrationEvents > 0 && parsed.liquidityEvents > 0) {
    score += 0.2;
    reasons.push('Migration and liquidity creation are linked.');
  }
  if (parsed.feeTransferEvents > 0) {
    score += 0.05;
    reasons.push('Protocol fee transfers are observable.');
  }
  const confidence = Math.min(1, Number(score.toFixed(4)));
  return GenericLaunchDetectionSchema.parse({
    platform: 'UNKNOWN_LAUNCHPAD',
    mechanismConfidence: confidence,
    mechanism:
      confidence >= 0.65
        ? { state: 'known', value: 'BONDING_CURVE_LIKE' }
        : unknownValue(
            'INSUFFICIENT_DATA',
            'Observed features do not identify a mechanism reliably.',
          ),
    evidenceIds: [...new Set(parsed.evidenceIds)],
    reasons,
  });
}
