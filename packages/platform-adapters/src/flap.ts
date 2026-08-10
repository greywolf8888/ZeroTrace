import {
  ProviderError,
  type EvmLedgerAdapter,
  type TransportObservation,
} from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  LaunchMechanismSnapshotSchema,
  RealizableValuePointSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type Evidence,
  type KnowledgeValue,
  type LaunchMechanismSnapshot,
  type RealizableValuePoint,
} from '@zerotrace/schemas';
import { decodeFunctionResult, encodeFunctionData, getAddress } from 'viem';

export type FlapInspectionMethod = 'getTokenV8Safe' | 'getTokenV6' | 'getTokenV5';

export interface FlapDeployment {
  chainId: `eip155:${number}`;
  portal: string;
  vaultPortal?: string;
  documentedVersion: string;
  registryObservedAt: string;
  officialSource: string;
  sourceRevision: string;
  inspectionMethods: readonly FlapInspectionMethod[];
}

export const FLAP_INTERFACE_SOURCE_REVISION =
  'flap-sh/FlapVaultExample@0a6ad1b71cecf0051b1f3a239e719d2f77989e26';

export const FLAP_BSC_MAINNET_DEPLOYMENT: FlapDeployment = Object.freeze({
  chainId: 'eip155:56',
  portal: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',
  vaultPortal: '0x90497450f2a706f1951b5bdda52B4E5d16f34C06',
  documentedVersion: 'v5.14.16',
  registryObservedAt: '2026-08-10T00:00:00.000Z',
  officialSource: 'https://docs.flap.sh/flap/developers/deployed-contract-addresses',
  sourceRevision: FLAP_INTERFACE_SOURCE_REVISION,
  inspectionMethods: ['getTokenV8Safe', 'getTokenV6', 'getTokenV5'] as const,
});

const TOKEN_STATUS_NAMES = ['INVALID', 'TRADABLE', 'IN_DUEL', 'KILLED', 'DEX', 'STAGED'] as const;
export type FlapTokenStatus = (typeof TOKEN_STATUS_NAMES)[number];

export const FLAP_TOKEN_VERSION_NAMES = [
  'TOKEN_LEGACY_MINT_NO_PERMIT',
  'TOKEN_LEGACY_MINT_NO_PERMIT_DUPLICATE',
  'TOKEN_V2_PERMIT',
  'TOKEN_GOPLUS',
  'TOKEN_TAXED',
  'TOKEN_TAXED_V2',
  'TOKEN_TAXED_V3',
  'TOKEN_V3_PERMIT',
] as const;
export type FlapTokenVersion = (typeof FLAP_TOKEN_VERSION_NAMES)[number];

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const WAD = 1_000_000_000_000_000_000n;

const TOKEN_STATE_V5_COMPONENTS = [
  { name: 'status', type: 'uint8' },
  { name: 'reserve', type: 'uint256' },
  { name: 'circulatingSupply', type: 'uint256' },
  { name: 'price', type: 'uint256' },
  { name: 'tokenVersion', type: 'uint8' },
  { name: 'r', type: 'uint256' },
  { name: 'h', type: 'uint256' },
  { name: 'k', type: 'uint256' },
  { name: 'dexSupplyThresh', type: 'uint256' },
  { name: 'quoteTokenAddress', type: 'address' },
  { name: 'nativeToQuoteSwapEnabled', type: 'bool' },
  { name: 'extensionID', type: 'bytes32' },
] as const;

const GET_TOKEN_V5_ABI = [
  {
    type: 'function',
    name: 'getTokenV5',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: 'state', type: 'tuple', components: TOKEN_STATE_V5_COMPONENTS }],
  },
] as const;

const GET_TOKEN_V6_ABI = [
  {
    type: 'function',
    name: 'getTokenV6',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        name: 'state',
        type: 'tuple',
        components: [
          ...TOKEN_STATE_V5_COMPONENTS,
          { name: 'taxRate', type: 'uint256' },
          { name: 'pool', type: 'address' },
          { name: 'progress', type: 'uint256' },
        ],
      },
    ],
  },
] as const;

const GET_TOKEN_V8_SAFE_ABI = [
  {
    type: 'function',
    name: 'getTokenV8Safe',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        name: 'state',
        type: 'tuple',
        components: [
          ...TOKEN_STATE_V5_COMPONENTS,
          { name: 'buyTaxRate', type: 'uint256' },
          { name: 'sellTaxRate', type: 'uint256' },
          { name: 'pool', type: 'address' },
          { name: 'progress', type: 'uint256' },
          { name: 'lpFeeProfile', type: 'uint8' },
          { name: 'dexId', type: 'uint8' },
        ],
      },
    ],
  },
] as const;

const PREVIEW_SELL_ABI = [
  {
    type: 'function',
    name: 'previewSell',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'quoteAmount', type: 'uint256' }],
  },
] as const;

export interface FlapTokenState {
  inspectionMethod: FlapInspectionMethod;
  statusCode: number;
  status: KnowledgeValue<FlapTokenStatus>;
  reserve: string;
  circulatingSupply: string;
  priceWad: string;
  tokenVersionCode: number;
  tokenVersion: KnowledgeValue<FlapTokenVersion>;
  r: string;
  h: string;
  k: string;
  dexSupplyThresh: string;
  quoteTokenAddress: string;
  nativeToQuoteSwapEnabled: boolean;
  extensionId: string;
  buyTaxBps: KnowledgeValue<string>;
  sellTaxBps: KnowledgeValue<string>;
  pool: KnowledgeValue<string>;
  progressWad: KnowledgeValue<string>;
  lpFeeProfile: KnowledgeValue<string>;
  dexId: KnowledgeValue<string>;
}

export interface FlapInspectionResult {
  platform: 'flap';
  token: string;
  deployment: FlapDeployment;
  platformMatch: KnowledgeValue<boolean>;
  state: FlapTokenState | null;
  launch: LaunchMechanismSnapshot | null;
  metadata: AnalysisMetadata;
  evidence: Evidence[];
}

export interface FlapSellQuoteResult {
  platform: 'flap';
  token: string;
  quoteAsset: LaunchMechanismSnapshot['quoteAsset'];
  quote: RealizableValuePoint;
  evidence: Evidence[];
}

export type FlapEvidenceWriter = (
  evidence: Evidence,
  sourceEvidenceIds?: readonly string[],
  snapshot?: AnalysisSnapshot,
) => Promise<Evidence>;

function canonicalAddress(value: string, field: string): string {
  try {
    return getAddress(value).toLowerCase();
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not a canonical EVM address.`, {
      cause: error,
    });
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap returned an invalid ${field}.`);
  }
  return value as Record<string, unknown>;
}

function uint(value: unknown, field: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new ProviderError('INVALID_RESPONSE', `Flap returned an invalid ${field}.`);
  }
  return value;
}

function uint8(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? BigInt(value) : uint(value, field);
  if (parsed < 0n || parsed > 255n) {
    throw new ProviderError('INVALID_RESPONSE', `Flap returned an invalid ${field}.`);
  }
  return Number(parsed);
}

function unsignedDecimal(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap ${field} must be an unsigned decimal string.`,
    );
  }
  return BigInt(value);
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ProviderError('INVALID_RESPONSE', `Flap returned an invalid ${field}.`);
  }
  return value;
}

function bytes32(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap returned an invalid ${field}.`);
  }
  return value.toLowerCase();
}

function decodedAddress(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ProviderError('INVALID_RESPONSE', `Flap returned an invalid ${field}.`);
  }
  return canonicalAddress(value, field);
}

function enumKnowledge<T extends string>(
  code: number,
  names: readonly T[],
  field: string,
): KnowledgeValue<T> {
  const value = names[code];
  return value === undefined
    ? unknownValue('UNSUPPORTED', `Flap ${field} code ${code} is not recognized by this decoder.`)
    : knownValue(value);
}

function encodeInspection(method: FlapInspectionMethod, token: string): string {
  switch (method) {
    case 'getTokenV8Safe':
      return encodeFunctionData({
        abi: GET_TOKEN_V8_SAFE_ABI,
        functionName: 'getTokenV8Safe',
        args: [token as `0x${string}`],
      });
    case 'getTokenV6':
      return encodeFunctionData({
        abi: GET_TOKEN_V6_ABI,
        functionName: 'getTokenV6',
        args: [token as `0x${string}`],
      });
    case 'getTokenV5':
      return encodeFunctionData({
        abi: GET_TOKEN_V5_ABI,
        functionName: 'getTokenV5',
        args: [token as `0x${string}`],
      });
  }
}

function decodeInspection(method: FlapInspectionMethod, data: string): Record<string, unknown> {
  try {
    switch (method) {
      case 'getTokenV8Safe':
        return requireRecord(
          decodeFunctionResult({
            abi: GET_TOKEN_V8_SAFE_ABI,
            functionName: 'getTokenV8Safe',
            data: data as `0x${string}`,
          }),
          'getTokenV8Safe result',
        );
      case 'getTokenV6':
        return requireRecord(
          decodeFunctionResult({
            abi: GET_TOKEN_V6_ABI,
            functionName: 'getTokenV6',
            data: data as `0x${string}`,
          }),
          'getTokenV6 result',
        );
      case 'getTokenV5':
        return requireRecord(
          decodeFunctionResult({
            abi: GET_TOKEN_V5_ABI,
            functionName: 'getTokenV5',
            data: data as `0x${string}`,
          }),
          'getTokenV5 result',
        );
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('INVALID_RESPONSE', `Flap ${method} result could not be decoded.`, {
      cause: error,
    });
  }
}

function normalizeState(
  method: FlapInspectionMethod,
  decoded: Record<string, unknown>,
): FlapTokenState {
  const statusCode = uint8(decoded.status, 'token status');
  const tokenVersionCode = uint8(decoded.tokenVersion, 'token version');
  const taxRate = method === 'getTokenV6' ? uint(decoded.taxRate, 'tax rate') : undefined;
  const buyTaxRate =
    method === 'getTokenV8Safe' ? uint(decoded.buyTaxRate, 'buy tax rate') : taxRate;
  const sellTaxRate =
    method === 'getTokenV8Safe' ? uint(decoded.sellTaxRate, 'sell tax rate') : taxRate;
  if ((buyTaxRate !== undefined && buyTaxRate > 10_000n) || (sellTaxRate ?? 0n) > 10_000n) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap tax basis points exceed 10000.');
  }
  const progress =
    method === 'getTokenV6' || method === 'getTokenV8Safe'
      ? uint(decoded.progress, 'progress')
      : undefined;
  if (progress !== undefined && progress > WAD) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap progress exceeds the documented 1e18 scale.');
  }
  return {
    inspectionMethod: method,
    statusCode,
    status: enumKnowledge(statusCode, TOKEN_STATUS_NAMES, 'token status'),
    reserve: uint(decoded.reserve, 'reserve').toString(),
    circulatingSupply: uint(decoded.circulatingSupply, 'circulating supply').toString(),
    priceWad: uint(decoded.price, 'price').toString(),
    tokenVersionCode,
    tokenVersion: enumKnowledge(tokenVersionCode, FLAP_TOKEN_VERSION_NAMES, 'token version'),
    r: uint(decoded.r, 'curve r').toString(),
    h: uint(decoded.h, 'curve h').toString(),
    k: uint(decoded.k, 'curve k').toString(),
    dexSupplyThresh: uint(decoded.dexSupplyThresh, 'DEX supply threshold').toString(),
    quoteTokenAddress: decodedAddress(decoded.quoteTokenAddress, 'quote token address'),
    nativeToQuoteSwapEnabled: bool(decoded.nativeToQuoteSwapEnabled, 'native-to-quote swap flag'),
    extensionId: bytes32(decoded.extensionID, 'extension ID'),
    buyTaxBps:
      buyTaxRate === undefined
        ? unknownValue('NOT_QUERIED', `${method} does not return a buy tax rate.`)
        : knownValue(buyTaxRate.toString()),
    sellTaxBps:
      sellTaxRate === undefined
        ? unknownValue('NOT_QUERIED', `${method} does not return a sell tax rate.`)
        : knownValue(sellTaxRate.toString()),
    pool:
      method === 'getTokenV5'
        ? unknownValue('NOT_QUERIED', 'getTokenV5 does not return a DEX pool.')
        : knownValue(decodedAddress(decoded.pool, 'DEX pool')),
    progressWad:
      progress === undefined
        ? unknownValue('NOT_QUERIED', 'getTokenV5 does not return progress.')
        : knownValue(progress.toString()),
    lpFeeProfile:
      method === 'getTokenV8Safe'
        ? knownValue(String(uint8(decoded.lpFeeProfile, 'LP fee profile')))
        : unknownValue('NOT_QUERIED', `${method} does not return an LP fee profile.`),
    dexId:
      method === 'getTokenV8Safe'
        ? knownValue(String(uint8(decoded.dexId, 'DEX ID')))
        : unknownValue('NOT_QUERIED', `${method} does not return a DEX ID.`),
  };
}

function wadDecimal(value: bigint): string {
  const integer = value / WAD;
  const fraction = (value % WAD).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction.length === 0 ? integer.toString() : `${integer}.${fraction}`;
}

function progressKnowledge(state: FlapTokenState): KnowledgeValue<string> {
  if (state.progressWad.state === 'known') {
    return knownValue(wadDecimal(BigInt(state.progressWad.value)));
  }
  const threshold = BigInt(state.dexSupplyThresh);
  if (threshold === 0n) {
    return unknownValue('INSUFFICIENT_DATA', 'Flap DEX supply threshold is zero.');
  }
  const numerator = BigInt(state.circulatingSupply) * WAD;
  return knownValue(wadDecimal(numerator >= threshold * WAD ? WAD : numerator / threshold));
}

function lifecycle(status: KnowledgeValue<FlapTokenStatus>): LaunchMechanismSnapshot['lifecycle'] {
  if (status.state !== 'known') return 'UNKNOWN';
  switch (status.value) {
    case 'TRADABLE':
    case 'IN_DUEL':
      return 'PRIMARY_MARKET';
    case 'KILLED':
      return 'KILLED';
    case 'DEX':
      return 'DEX_TRADING';
    case 'STAGED':
      return 'PRE_LAUNCH';
    case 'INVALID':
      return 'UNKNOWN';
  }
}

function taxModel(state: FlapTokenState): KnowledgeValue<string> {
  if (state.tokenVersion.state !== 'known') return state.tokenVersion;
  switch (state.tokenVersion.value) {
    case 'TOKEN_TAXED':
      return knownValue('FLAP_TAX_V1');
    case 'TOKEN_TAXED_V2':
      return knownValue('FLAP_TAX_V2');
    case 'TOKEN_TAXED_V3':
      return knownValue('FLAP_TAX_V3');
    default:
      return knownValue('NONE');
  }
}

function unknownNotQueried(detail: string) {
  return unknownValue('NOT_QUERIED', detail);
}

function portalSpotPrice(state: FlapTokenState): KnowledgeValue<string> {
  if (state.status.state !== 'known') {
    return unknownValue(
      'UNSUPPORTED',
      'The Portal token status is newer than this decoder, so its price field cannot be interpreted.',
    );
  }
  if (state.status.value === 'TRADABLE' || state.status.value === 'IN_DUEL') {
    return knownValue(wadDecimal(BigInt(state.priceWad)));
  }
  return unknownValue(
    'NOT_APPLICABLE',
    'The Flap Portal price field is not a DEX market price; migrated tokens require an evidenced pool quote.',
  );
}

function buildLaunch(
  state: FlapTokenState,
  token: string,
  deployment: FlapDeployment,
  blockNumber: string,
  evidenceIds: readonly string[],
): LaunchMechanismSnapshot {
  const circulating = BigInt(state.circulatingSupply);
  const threshold = BigInt(state.dexSupplyThresh);
  const remaining = threshold > circulating ? threshold - circulating : 0n;
  const quoteAsset =
    state.quoteTokenAddress === ZERO_ADDRESS
      ? `${deployment.chainId}:native`
      : state.quoteTokenAddress;
  return LaunchMechanismSnapshotSchema.parse({
    platform: 'flap',
    platformVersion: knownValue(deployment.documentedVersion),
    deploymentId: knownValue(
      `${deployment.chainId}:${canonicalAddress(deployment.portal, 'Portal')}`,
    ),
    ledger: 'EVM',
    chainId: deployment.chainId,
    factoryOrProgram: knownValue(canonicalAddress(deployment.portal, 'Portal')),
    creator: unknownNotQueried('Creator requires the versioned TokenCreated event history.'),
    lifecycle: lifecycle(state.status),
    quoteAsset: knownValue(quoteAsset),
    spotPrice: portalSpotPrice(state),
    curveType: knownValue('FLAP_VIRTUAL_CONSTANT_PRODUCT'),
    realBaseReserve: unknownNotQueried('Portal inspection does not expose a real base reserve.'),
    realQuoteReserve: knownValue(state.reserve),
    virtualBaseReserve: knownValue(state.h),
    virtualQuoteReserve: knownValue(state.r),
    totalSupply: unknownNotQueried('Total supply requires a token contract read at this Snapshot.'),
    curveSupply: unknownNotQueried('Curve supply semantics require lifecycle reconstruction.'),
    circulatingSupply: knownValue(state.circulatingSupply),
    remainingSupply: knownValue(remaining.toString()),
    progress: progressKnowledge(state),
    graduationCondition: knownValue('circulatingSupply >= dexSupplyThresh'),
    graduationThreshold: knownValue(state.dexSupplyThresh),
    currentSellCapacity: unknownNotQueried('Sell capacity requires a bounded curve quote.'),
    buyFeeBps: unknownNotQueried('Portal inspection does not expose the complete buy fee.'),
    sellFeeBps: unknownNotQueried('Portal inspection does not expose the complete sell fee.'),
    creatorFeeBps: unknownNotQueried('Creator fee requires versioned fee configuration.'),
    protocolFeeBps: unknownNotQueried('Protocol fee requires versioned fee configuration.'),
    taxModel: taxModel(state),
    buyTaxBps: state.buyTaxBps,
    sellTaxBps: state.sellTaxBps,
    taxAllocations: unknownNotQueried('Tax allocation requires the token/processor configuration.'),
    fundRecipient: unknownNotQueried('Fund recipient requires tax or vault inspection.'),
    taxProcessor: unknownNotQueried('Tax processor requires token-version-specific inspection.'),
    dividendContract: unknownNotQueried('Dividend state requires tax allocation inspection.'),
    vault: unknownNotQueried('VaultPortal provenance and vault bytecode are not yet queried.'),
    migrationTarget:
      state.dexId.state === 'known' ? knownValue(`FLAP_DEX_${state.dexId.value}`) : state.dexId,
    migrationPool: state.pool,
    lpOwner: unknownNotQueried('LP ownership requires migration and pool-position inspection.'),
    lpLocked: unknownNotQueried('LP lock state was not queried.'),
    lpBurned: unknownNotQueried('LP burn state was not queried.'),
    lpClaimRight: unknownNotQueried('LP fee claim rights were not queried.'),
    antiSniperOrFarmerSettings: unknownNotQueried('Anti-farmer settings require config reads.'),
    rawConfigHash: hashPayload({ token, deployment, state }),
    sourceBlockOrSlot: blockNumber,
    sourceVersion: `flap:${state.inspectionMethod}:${deployment.sourceRevision}`,
    evidenceIds: [...new Set(evidenceIds)],
  });
}

async function readState(
  adapter: EvmLedgerAdapter,
  deployment: FlapDeployment,
  token: string,
  blockTag: string,
): Promise<{
  method: FlapInspectionMethod;
  data: string;
  observation: TransportObservation<string>;
  state: FlapTokenState;
}> {
  let lastUnsupportedMethod: ProviderError | undefined;
  for (const method of deployment.inspectionMethods) {
    const data = encodeInspection(method, token);
    try {
      const observation = await adapter.callObservation(deployment.portal, data, blockTag);
      return {
        method,
        data,
        observation,
        state: normalizeState(method, decodeInspection(method, observation.value)),
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RPC_ERROR' && !error.retryable) {
        lastUnsupportedMethod = error;
        continue;
      }
      throw error;
    }
  }
  throw (
    lastUnsupportedMethod ??
    new ProviderError('INVALID_RESPONSE', 'Flap deployment has no inspection method configured.')
  );
}

function metadata(
  snapshot: AnalysisSnapshot,
  sourceSet: readonly string[],
  modelVersion: string,
  evidenceIds: readonly string[],
  dataCoverage: number,
  confidence: number,
): AnalysisMetadata {
  return AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage,
    sourceCoverage: Math.min(1, new Set(sourceSet).size / 3),
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet: [...new Set(sourceSet)].sort(),
    modelVersion,
    confidence,
    evidenceIds: [...new Set(evidenceIds)],
  });
}

export async function inspectFlapToken(options: {
  adapter: EvmLedgerAdapter;
  token: string;
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
  blockNumber?: string;
}): Promise<FlapInspectionResult> {
  const { adapter, deployment, writeEvidence } = options;
  const token = canonicalAddress(options.token, 'token address');
  if (`eip155:${adapter.config.chainId}` !== deployment.chainId) {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap deployment and EVM adapter chains differ.');
  }
  if (deployment.inspectionMethods.length === 0) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap deployment has no inspection methods.');
  }

  const anchor =
    options.blockNumber === undefined
      ? await adapter.readHeadAnchor()
      : await adapter.readAnchorAt(options.blockNumber);
  if (anchor.snapshot.ledger !== 'EVM' || anchor.snapshot.chainId !== deployment.chainId) {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap Snapshot does not match the deployment chain.');
  }
  const snapshot = anchor.snapshot;
  const blockTag = `0x${BigInt(snapshot.blockNumber).toString(16)}`;
  const portal = canonicalAddress(deployment.portal, 'Portal');
  const [portalCode, tokenCode] = await Promise.all([
    adapter.getCodeObservation(portal, blockTag),
    adapter.getCodeObservation(token, blockTag),
  ]);
  if (portalCode.value === '0x') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'The documented Flap Portal has no bytecode at the selected Snapshot.',
    );
  }

  const deploymentEvidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'PROVIDER_OBSERVATION',
      source: `flap-official-registry@${deployment.registryObservedAt.slice(0, 10)}`,
      sourceUri: deployment.officialSource,
      locator: `flap-deployment:${portal}@${snapshot.blockNumber}`,
      payload: deployment,
      observedAt: deployment.registryObservedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Official Flap deployment/version registry observation selected for this query.',
    }),
    [],
    snapshot,
  );
  const portalCodeEvidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'CONTRACT_STATE',
      source: portalCode.endpointId,
      locator: `contract-code:${portal}@${snapshot.blockNumber}`,
      payload: { address: portal, bytecode: portalCode.value },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Flap Portal bytecode observed at the pinned Snapshot.',
    }),
    [],
    snapshot,
  );
  const tokenCodeEvidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'CONTRACT_STATE',
      source: tokenCode.endpointId,
      locator: `contract-code:${token}@${snapshot.blockNumber}`,
      payload: { address: token, bytecode: tokenCode.value },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Candidate Flap token bytecode observed at the pinned Snapshot.',
    }),
    [],
    snapshot,
  );
  const baseEvidence = [deploymentEvidence, portalCodeEvidence, tokenCodeEvidence];
  const baseSources = [
    deploymentEvidence.source,
    portalCode.endpointId,
    tokenCode.endpointId,
    ...Object.keys(snapshot.providerVersions),
  ];

  if (tokenCode.value === '0x') {
    const sourceEvidenceIds = baseEvidence.map((item) => item.id);
    const negative = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: deployment.chainId,
        kind: 'NEGATIVE_EVIDENCE',
        source: 'zerotrace:flap-inspector',
        locator: `flap-token:${token}@${snapshot.blockNumber}`,
        payload: { platformMatch: false, reason: 'NO_TOKEN_BYTECODE' },
        blockOrSlot: snapshot.blockNumber,
        finality: snapshot.finality,
        summary: 'Candidate address has no token bytecode at the selected Snapshot.',
        sourceEvidenceIds,
      }),
      sourceEvidenceIds,
      snapshot,
    );
    const evidence = [...baseEvidence, negative];
    return {
      platform: 'flap',
      token,
      deployment,
      platformMatch: knownValue(false),
      state: null,
      launch: null,
      metadata: metadata(
        snapshot,
        baseSources,
        'flap-inspector-v0.1.0',
        evidence.map((item) => item.id),
        1,
        1,
      ),
      evidence,
    };
  }

  const stateRead = await readState(adapter, deployment, token, blockTag);
  const stateEvidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'CONTRACT_STATE',
      source: stateRead.observation.endpointId,
      locator: `flap:${stateRead.method}:${token}@${snapshot.blockNumber}`,
      payload: {
        portal,
        token,
        callData: stateRead.data,
        rawResult: stateRead.observation.value,
        state: stateRead.state,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: `Flap ${stateRead.method} token state observed at the pinned Snapshot.`,
    }),
    [],
    snapshot,
  );
  const observationEvidence = [...baseEvidence, stateEvidence];
  const sourceEvidenceIds = observationEvidence.map((item) => item.id);

  if (stateRead.state.status.state === 'known' && stateRead.state.status.value === 'INVALID') {
    const negative = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: deployment.chainId,
        kind: 'NEGATIVE_EVIDENCE',
        source: 'zerotrace:flap-inspector',
        locator: `flap-token:${token}@${snapshot.blockNumber}`,
        payload: { platformMatch: false, reason: 'PORTAL_STATUS_INVALID' },
        blockOrSlot: snapshot.blockNumber,
        finality: snapshot.finality,
        summary: 'The selected Flap Portal reports the candidate token as Invalid.',
        sourceEvidenceIds,
      }),
      sourceEvidenceIds,
      snapshot,
    );
    const evidence = [...observationEvidence, negative];
    return {
      platform: 'flap',
      token,
      deployment,
      platformMatch: knownValue(false),
      state: stateRead.state,
      launch: null,
      metadata: metadata(
        snapshot,
        [...baseSources, stateRead.observation.endpointId],
        `flap-inspector-${stateRead.method}-v0.1.0`,
        evidence.map((item) => item.id),
        stateRead.method === 'getTokenV5' ? 0.55 : 0.7,
        0.99,
      ),
      evidence,
    };
  }

  const launchWithoutDerived = buildLaunch(
    stateRead.state,
    token,
    deployment,
    snapshot.blockNumber,
    sourceEvidenceIds,
  );
  const derived = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:flap-inspector:${stateRead.method}`,
      locator: `launch-mechanism:${token}@${snapshot.blockNumber}`,
      payload: {
        platform: 'flap',
        token,
        lifecycle: launchWithoutDerived.lifecycle,
        rawConfigHash: launchWithoutDerived.rawConfigHash,
      },
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Flap launch mechanism normalized from versioned Portal state.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    snapshot,
  );
  const evidence = [...observationEvidence, derived];
  const launch = LaunchMechanismSnapshotSchema.parse({
    ...launchWithoutDerived,
    evidenceIds: [...sourceEvidenceIds, derived.id],
  });
  return {
    platform: 'flap',
    token,
    deployment,
    platformMatch: knownValue(true),
    state: stateRead.state,
    launch,
    metadata: metadata(
      snapshot,
      [...baseSources, stateRead.observation.endpointId],
      `flap-inspector-${stateRead.method}-v0.1.0`,
      evidence.map((item) => item.id),
      stateRead.method === 'getTokenV5' ? 0.55 : 0.7,
      stateRead.state.status.state === 'known' ? 0.95 : 0.7,
    ),
    evidence,
  };
}

async function finalizeSellQuote(options: {
  inspection: FlapInspectionResult;
  writeEvidence: FlapEvidenceWriter;
  inputQuantity: string;
  output: KnowledgeValue<string>;
  additionalEvidence?: Evidence;
  dataCoverage: number;
  confidence: number;
}): Promise<FlapSellQuoteResult> {
  const { inspection, writeEvidence, inputQuantity, output, dataCoverage, confidence } = options;
  const snapshot = inspection.metadata.snapshot;
  if (snapshot === null || snapshot.ledger !== 'EVM') {
    throw new ProviderError('INVALID_RESPONSE', 'Flap sell preview requires an EVM Snapshot.');
  }
  const supportingEvidence = inspection.evidence.at(-1);
  if (supportingEvidence === undefined) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap inspection did not produce Evidence.');
  }
  const sourceEvidenceIds = [
    supportingEvidence.id,
    ...(options.additionalEvidence === undefined ? [] : [options.additionalEvidence.id]),
  ];
  const derived = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: inspection.deployment.chainId,
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:flap-preview-sell:v0.1.0',
      locator: `rv:flap-preview-sell:${inspection.token}:${inputQuantity}@${snapshot.blockNumber}`,
      payload: {
        platform: 'flap',
        token: inspection.token,
        inputQuantity,
        output,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Flap sell preview normalized into a realizable-value observation.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    snapshot,
  );
  const evidence = [
    ...inspection.evidence,
    ...(options.additionalEvidence === undefined ? [] : [options.additionalEvidence]),
    derived,
  ];
  const quoteMetadata = metadata(
    snapshot,
    [
      ...inspection.metadata.sourceSet,
      ...(options.additionalEvidence === undefined ? [] : [options.additionalEvidence.source]),
    ],
    'flap-preview-sell-v0.1.0',
    evidence.map((item) => item.id),
    dataCoverage,
    confidence,
  );
  const quote = RealizableValuePointSchema.parse({
    inputQuantity,
    nominalValue: unknownValue(
      'NOT_QUERIED',
      'A decimals-normalized independent reference price was not queried.',
    ),
    realizableValue: output,
    averageExitPrice: unknownValue(
      'NOT_QUERIED',
      'Token and quote-asset decimals are not yet bound to this Snapshot.',
    ),
    priceImpactBps: unknownValue(
      'NOT_QUERIED',
      'Price impact requires a separately evidenced reference price.',
    ),
    totalFeeBps: unknownValue(
      'NOT_QUERIED',
      'previewSell returns aggregate proceeds; fee decomposition was not queried.',
    ),
    route: [
      `${inspection.deployment.chainId}:${canonicalAddress(inspection.deployment.portal, 'Portal')}:previewSell`,
    ],
    metadata: quoteMetadata,
  });
  return {
    platform: 'flap',
    token: inspection.token,
    quoteAsset:
      inspection.launch?.quoteAsset ??
      unknownValue('INSUFFICIENT_DATA', 'No evidenced Flap launch mechanism is available.'),
    quote,
    evidence,
  };
}

export async function quoteFlapSell(options: {
  adapter: EvmLedgerAdapter;
  token: string;
  inputQuantity: string;
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
  blockNumber?: string;
}): Promise<FlapSellQuoteResult> {
  const inputAmount = unsignedDecimal(options.inputQuantity, 'sell input quantity');
  const inspection = await inspectFlapToken({
    adapter: options.adapter,
    token: options.token,
    deployment: options.deployment,
    writeEvidence: options.writeEvidence,
    ...(options.blockNumber === undefined ? {} : { blockNumber: options.blockNumber }),
  });
  const state = inspection.state;
  if (inspection.launch === null || state === null) {
    return finalizeSellQuote({
      inspection,
      writeEvidence: options.writeEvidence,
      inputQuantity: options.inputQuantity,
      output: unavailableValue(
        'UNSUPPORTED',
        'The selected Portal does not identify this address as a tradable Flap token.',
      ),
      dataCoverage: 0.2,
      confidence: 1,
    });
  }
  if (state.status.state !== 'known') {
    return finalizeSellQuote({
      inspection,
      writeEvidence: options.writeEvidence,
      inputQuantity: options.inputQuantity,
      output: unknownValue(
        'UNSUPPORTED',
        'The Portal token status is newer than this versioned decoder.',
      ),
      dataCoverage: 0.3,
      confidence: 0.6,
    });
  }
  if (state.status.value !== 'TRADABLE') {
    const detail =
      state.status.value === 'DEX'
        ? 'The token has migrated; a DEX route must be reconstructed instead of using Portal previewSell.'
        : `Portal status ${state.status.value} does not permit a sell preview.`;
    return finalizeSellQuote({
      inspection,
      writeEvidence: options.writeEvidence,
      inputQuantity: options.inputQuantity,
      output: unavailableValue(
        state.status.value === 'DEX' ? 'UNSUPPORTED' : 'EXECUTION_BLOCKED',
        detail,
      ),
      dataCoverage: 0.4,
      confidence: 0.98,
    });
  }
  if (inputAmount > BigInt(state.circulatingSupply)) {
    return finalizeSellQuote({
      inspection,
      writeEvidence: options.writeEvidence,
      inputQuantity: options.inputQuantity,
      output: unavailableValue(
        'EXECUTION_BLOCKED',
        'The requested input exceeds the Snapshot circulating supply.',
      ),
      dataCoverage: 0.45,
      confidence: 1,
    });
  }

  const snapshot = inspection.metadata.snapshot;
  if (snapshot === null || snapshot.ledger !== 'EVM') {
    throw new ProviderError('INVALID_RESPONSE', 'Flap sell preview requires an EVM Snapshot.');
  }
  const callData = encodeFunctionData({
    abi: PREVIEW_SELL_ABI,
    functionName: 'previewSell',
    args: [inspection.token as `0x${string}`, inputAmount],
  });
  const observation = await options.adapter.callObservation(
    inspection.deployment.portal,
    callData,
    `0x${BigInt(snapshot.blockNumber).toString(16)}`,
  );
  let outputAmount: bigint;
  try {
    outputAmount = uint(
      decodeFunctionResult({
        abi: PREVIEW_SELL_ABI,
        functionName: 'previewSell',
        data: observation.value as `0x${string}`,
      }),
      'previewSell output',
    );
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('INVALID_RESPONSE', 'Flap previewSell result could not be decoded.', {
      cause: error,
    });
  }
  const quoteEvidence = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: inspection.deployment.chainId,
      kind: 'CONTRACT_STATE',
      source: observation.endpointId,
      locator: `flap:previewSell:${inspection.token}:${options.inputQuantity}@${snapshot.blockNumber}`,
      payload: {
        portal: canonicalAddress(inspection.deployment.portal, 'Portal'),
        token: inspection.token,
        inputQuantity: options.inputQuantity,
        callData,
        rawResult: observation.value,
        outputQuoteAtomic: outputAmount.toString(),
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Flap previewSell output observed at the pinned Snapshot.',
    }),
    [],
    snapshot,
  );
  return finalizeSellQuote({
    inspection,
    writeEvidence: options.writeEvidence,
    inputQuantity: options.inputQuantity,
    output: knownValue(outputAmount.toString()),
    additionalEvidence: quoteEvidence,
    dataCoverage: 0.6,
    confidence: 0.95,
  });
}
