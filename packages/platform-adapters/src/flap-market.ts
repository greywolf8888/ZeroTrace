import {
  ProviderError,
  type EvmLedgerAdapter,
  type TransportObservation,
} from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  FlapPancakeV2BuyScenarioResultSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type Evidence,
  type FlapPancakeV2BuyScenarioPoint,
  type FlapPancakeV2BuyScenarioResult,
  type FlapPancakeV2Market,
  type FlapPancakeV2TokenAmount,
  type KnowledgeValue,
} from '@zerotrace/schemas';
import { decodeFunctionResult, encodeFunctionData, getAddress } from 'viem';

import {
  inspectFlapToken,
  type FlapDeployment,
  type FlapEvidenceWriter,
  type FlapInspectionResult,
} from './flap.js';

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const BPS_DENOMINATOR = 10_000n;
const PANCAKE_V2_FEE_BPS = 25n;
const PANCAKE_V2_FEE_NUMERATOR = BPS_DENOMINATOR - PANCAKE_V2_FEE_BPS;
const PRICE_SCALE = 18;
const DETERMINISTIC_TOLERANCE_BPS = 10n;
const MAX_UINT256 = 2n ** 256n - 1n;

export const FLAP_PANCAKE_V2_BUY_MODEL_VERSION = 'flap-pancake-v2-pool-buy-scenarios-v0.1.0';

export interface PancakeV2Deployment {
  chainId: 'eip155:56';
  factory: string;
  router: string;
  feeBps: '25';
  registryObservedAt: string;
  factorySource: string;
  routerSource: string;
  feeSource: string;
  sourceRevision: string;
}

export const PANCAKE_V2_BSC_DEPLOYMENT: PancakeV2Deployment = Object.freeze({
  chainId: 'eip155:56',
  factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  feeBps: '25',
  registryObservedAt: '2026-08-10T00:00:00.000Z',
  factorySource:
    'https://docs.pancakeswap.finance/french/code/smart-contracts/pancakeswap-exchange/factory-v2',
  routerSource:
    'https://docs.pancakeswap.finance/chinese/gei-kai-fa-zhe-men/zhi-neng-he-yue-evm/pancakeswap-jiao-yi-xiang-guan/v2-xiang-guan-he-yue/lu-you-v2',
  feeSource: 'https://docs.pancakeswap.finance/trade/pancakeswap-exchange/trade',
  sourceRevision: 'pancakeswap-v2-bsc-registry-and-fee@2026-08-10',
});

const ADDRESS_READ_ABI = (name: 'factory' | 'token0' | 'token1') =>
  [
    {
      type: 'function',
      name,
      stateMutability: 'view',
      inputs: [],
      outputs: [{ name: '', type: 'address' }],
    },
  ] as const;

const GET_RESERVES_ABI = [
  {
    type: 'function',
    name: 'getReserves',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
] as const;

const GET_PAIR_ABI = [
  {
    type: 'function',
    name: 'getPair',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: 'pair', type: 'address' }],
  },
] as const;

const DECIMALS_ABI = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

const GET_AMOUNTS_OUT_ABI = [
  {
    type: 'function',
    name: 'getAmountsOut',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

interface ObservedCall<T> {
  value: T;
  observation: TransportObservation<string>;
  evidence: Evidence;
}

type EvmAnalysisSnapshot = Extract<AnalysisSnapshot, { ledger: 'EVM' }>;

function canonicalAddress(value: string, field: string): string {
  try {
    return getAddress(value).toLowerCase();
  } catch (error) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Pancake V2 ${field} is not a canonical EVM address.`,
      { cause: error },
    );
  }
}

function decimalInput(value: string): string {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Pancake V2 quote inputs must be positive plain decimal strings.',
    );
  }
  return normalized;
}

function uint8(value: unknown, field: string): number {
  const parsed =
    typeof value === 'number' ? BigInt(value) : typeof value === 'bigint' ? value : -1n;
  if (parsed < 0n || parsed > 255n) {
    throw new ProviderError('INVALID_RESPONSE', `Pancake V2 returned invalid ${field}.`);
  }
  return Number(parsed);
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}

function power10(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

function formatAtomic(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const scale = power10(decimals);
  const integer = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length === 0 ? integer.toString() : `${integer}.${fraction}`;
}

function toAtomic(value: string, decimals: number): bigint {
  const [integer = '0', fraction = ''] = decimalInput(value).split('.');
  if (fraction.length > decimals) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Pancake V2 quote input has more than the quote asset's ${decimals} decimal places.`,
    );
  }
  const atomic =
    BigInt(integer) * power10(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (atomic <= 0n) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Pancake V2 quote inputs must be greater than zero.',
    );
  }
  if (atomic > MAX_UINT256) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Pancake V2 quote input exceeds the router uint256 limit.',
    );
  }
  return atomic;
}

function ratioDecimal(numerator: bigint, denominator: bigint, decimals: number): string {
  if (denominator <= 0n || numerator < 0n) {
    throw new ProviderError('INVALID_RESPONSE', 'Pancake V2 ratio inputs are invalid.');
  }
  const scaled = (numerator * power10(decimals)) / denominator;
  return formatAtomic(scaled, decimals);
}

function amount(value: bigint, decimals: number): FlapPancakeV2TokenAmount {
  return { atomic: value.toString(), decimal: formatAtomic(value, decimals) };
}

function averagePrice(
  quoteInput: bigint,
  tokenOutput: bigint,
  quoteDecimals: number,
  tokenDecimals: number,
): KnowledgeValue<string> {
  if (tokenOutput === 0n) {
    return unknownValue('NOT_APPLICABLE', 'A zero token output has no finite acquisition price.');
  }
  return knownValue(
    ratioDecimal(
      quoteInput * power10(tokenDecimals),
      tokenOutput * power10(quoteDecimals),
      PRICE_SCALE,
    ),
  );
}

function formulaAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const amountInWithFee = amountIn * PANCAKE_V2_FEE_NUMERATOR;
  return (amountInWithFee * reserveOut) / (reserveIn * BPS_DENOMINATOR + amountInWithFee);
}

function absoluteDifference(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left;
}

function quoteErrorBps(officialOutput: bigint, formulaOutput: bigint): string {
  if (officialOutput === 0n) return formulaOutput === 0n ? '0' : '10000';
  return ratioDecimal(
    absoluteDifference(officialOutput, formulaOutput) * BPS_DENOMINATOR,
    officialOutput,
    6,
  );
}

function withinTolerance(officialOutput: bigint, formulaOutput: bigint): boolean {
  if (officialOutput === 0n) return formulaOutput === 0n;
  return (
    absoluteDifference(officialOutput, formulaOutput) * BPS_DENOMINATOR <=
    officialOutput * DETERMINISTIC_TOLERANCE_BPS
  );
}

function priceChangeBps(
  quoteReserve: bigint,
  tokenReserve: bigint,
  quoteInput: bigint,
  tokenOutput: bigint,
): string {
  const postTokenReserve = tokenReserve - tokenOutput;
  const numerator = (quoteReserve + quoteInput) * tokenReserve - quoteReserve * postTokenReserve;
  const denominator = quoteReserve * postTokenReserve;
  return ratioDecimal(numerator * BPS_DENOMINATOR, denominator, 6);
}

function metadata(options: {
  snapshot: AnalysisSnapshot;
  sourceSet: readonly string[];
  evidenceIds: readonly string[];
  dataCoverage: number;
  sourceCoverage: number;
  simulationCoverage: number;
  confidence: number;
}): AnalysisMetadata {
  const sources = [...new Set(options.sourceSet)].sort();
  return AnalysisMetadataSchema.parse({
    snapshot: options.snapshot,
    dataCoverage: options.dataCoverage,
    sourceCoverage: options.sourceCoverage,
    historyCoverage: 0,
    simulationCoverage: options.simulationCoverage,
    freshness: options.snapshot.capturedAt,
    sourceSet: sources,
    modelVersion: FLAP_PANCAKE_V2_BUY_MODEL_VERSION,
    confidence: options.confidence,
    evidenceIds: [...new Set(options.evidenceIds)],
  });
}

async function observeContractCall<T>(options: {
  adapter: EvmLedgerAdapter;
  to: string;
  data: string;
  method: string;
  blockTag: string;
  snapshot: EvmAnalysisSnapshot;
  writeEvidence: FlapEvidenceWriter;
  decode: (raw: string) => T;
}): Promise<ObservedCall<T>> {
  const observation = await options.adapter.callObservation(
    options.to,
    options.data,
    options.blockTag,
  );
  let value: T;
  try {
    value = options.decode(observation.value);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Pancake V2 ${options.method} result could not be decoded.`,
      { cause: error },
    );
  }
  const evidence = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: options.snapshot.chainId,
      kind: 'CONTRACT_STATE',
      source: observation.endpointId,
      locator: `pancake-v2:${options.method}:${options.to}@${options.snapshot.blockNumber}`,
      payload: {
        address: options.to,
        method: options.method,
        callData: options.data,
        rawResult: observation.value,
        decoded: jsonSafe(value),
      },
      observedAt: options.snapshot.capturedAt,
      blockOrSlot: options.snapshot.blockNumber,
      finality: options.snapshot.finality,
      summary: `Pancake V2 ${options.method} observed at the pinned Snapshot.`,
    }),
    [],
    options.snapshot,
  );
  return { value, observation, evidence };
}

async function observeCode(options: {
  adapter: EvmLedgerAdapter;
  address: string;
  role: string;
  blockTag: string;
  snapshot: EvmAnalysisSnapshot;
  writeEvidence: FlapEvidenceWriter;
}): Promise<{ observation: TransportObservation<string>; evidence: Evidence }> {
  const observation = await options.adapter.getCodeObservation(options.address, options.blockTag);
  if (observation.value === '0x') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `The selected Pancake V2 ${options.role} has no bytecode at the pinned Snapshot.`,
    );
  }
  const evidence = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: options.snapshot.chainId,
      kind: 'CONTRACT_STATE',
      source: observation.endpointId,
      locator: `contract-code:${options.address}@${options.snapshot.blockNumber}`,
      payload: { address: options.address, role: options.role, bytecode: observation.value },
      observedAt: options.snapshot.capturedAt,
      blockOrSlot: options.snapshot.blockNumber,
      finality: options.snapshot.finality,
      summary: `Pancake V2 ${options.role} bytecode observed at the pinned Snapshot.`,
    }),
    [],
    options.snapshot,
  );
  return { observation, evidence };
}

async function finalizeUnavailable(options: {
  inspection: FlapInspectionResult;
  writeEvidence: FlapEvidenceWriter;
  reason: 'NOT_APPLICABLE' | 'UNSUPPORTED' | 'INSUFFICIENT_DATA';
  detail: string;
}): Promise<FlapPancakeV2BuyScenarioResult> {
  const snapshot = options.inspection.metadata.snapshot;
  const supportingEvidence = options.inspection.evidence.at(-1);
  if (snapshot === null || snapshot.ledger !== 'EVM' || supportingEvidence === undefined) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Flap DEX scenario availability requires terminal inspection Evidence and an EVM Snapshot.',
    );
  }
  const market = unavailableValue(options.reason, options.detail);
  const validation = {
    status: 'NOT_RUN' as const,
    deterministicToleranceBps: DETERMINISTIC_TOLERANCE_BPS.toString(),
    evaluatedScenarioCount: 0,
    failedScenarioCount: 0,
  };
  const pensionSinkTreatment = unknownValue(
    'INSUFFICIENT_DATA',
    'Sending tokens to a wallet is not a burn. No pension-wallet price effect is counted without custody and transfer-tax execution Evidence.',
  );
  const sourceEvidenceIds = [supportingEvidence.id];
  const terminal = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${FLAP_PANCAKE_V2_BUY_MODEL_VERSION}`,
      locator: `rv:flap-pancake-v2-buy:${options.inspection.token}@${snapshot.blockNumber}`,
      payload: { market, scenarios: [], validation, pensionSinkTreatment },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Flap token is not eligible for a Pancake V2 DEX buy-size scenario.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    snapshot,
  );
  const evidence = [...options.inspection.evidence, terminal];
  return FlapPancakeV2BuyScenarioResultSchema.parse({
    platform: 'flap',
    token: options.inspection.token,
    market,
    scenarios: [],
    validation,
    pensionSinkTreatment,
    terminalEvidenceId: terminal.id,
    metadata: metadata({
      snapshot,
      sourceSet: options.inspection.metadata.sourceSet,
      evidenceIds: evidence.map((item) => item.id),
      dataCoverage: 0.3,
      sourceCoverage: 0.5,
      simulationCoverage: 0,
      confidence: 0.98,
    }),
    evidence,
  });
}

export async function quoteFlapPancakeV2BuyScenarios(options: {
  adapter: EvmLedgerAdapter;
  token: string;
  quoteInputs: readonly string[];
  deployment: FlapDeployment;
  pancakeDeployment?: PancakeV2Deployment;
  writeEvidence: FlapEvidenceWriter;
  blockNumber?: string;
}): Promise<FlapPancakeV2BuyScenarioResult> {
  if (options.quoteInputs.length === 0 || options.quoteInputs.length > 8) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Pancake V2 scenarios require one to eight inputs.',
    );
  }
  const normalizedInputs = options.quoteInputs.map(decimalInput);
  const inspection = await inspectFlapToken({
    adapter: options.adapter,
    token: options.token,
    deployment: options.deployment,
    writeEvidence: options.writeEvidence,
    ...(options.blockNumber === undefined ? {} : { blockNumber: options.blockNumber }),
  });
  const state = inspection.state;
  if (
    inspection.launch === null ||
    state === null ||
    state.status.state !== 'known' ||
    state.status.value !== 'DEX'
  ) {
    return finalizeUnavailable({
      inspection,
      writeEvidence: options.writeEvidence,
      reason: 'NOT_APPLICABLE',
      detail: 'The selected Flap token is not in the migrated DEX lifecycle at this Snapshot.',
    });
  }
  if (
    state.pool.state !== 'known' ||
    state.dexId.state !== 'known' ||
    state.dexId.value !== '0' ||
    state.quoteTokenAddress === ZERO_ADDRESS
  ) {
    return finalizeUnavailable({
      inspection,
      writeEvidence: options.writeEvidence,
      reason:
        state.dexId.state === 'known' && state.dexId.value !== '0'
          ? 'UNSUPPORTED'
          : 'INSUFFICIENT_DATA',
      detail:
        'The Portal did not provide a supported Pancake V2 pool, DEX ID 0, and ERC-20 quote asset.',
    });
  }

  const snapshot = inspection.metadata.snapshot;
  const supportingEvidence = inspection.evidence.at(-1);
  if (snapshot === null || snapshot.ledger !== 'EVM' || supportingEvidence === undefined) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Flap Pancake V2 scenarios require terminal inspection Evidence and an EVM Snapshot.',
    );
  }
  const pancake = options.pancakeDeployment ?? PANCAKE_V2_BSC_DEPLOYMENT;
  if (pancake.chainId !== snapshot.chainId || pancake.feeBps !== PANCAKE_V2_FEE_BPS.toString()) {
    throw new ProviderError(
      'CHAIN_MISMATCH',
      'The versioned Pancake V2 deployment does not match the Flap Snapshot or fee model.',
    );
  }
  const token = inspection.token;
  const quoteAsset = canonicalAddress(state.quoteTokenAddress, 'quote asset');
  const pool = canonicalAddress(state.pool.value, 'pool');
  const factory = canonicalAddress(pancake.factory, 'factory');
  const router = canonicalAddress(pancake.router, 'router');
  if (pool === ZERO_ADDRESS) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap returned the zero address as a DEX pool.');
  }
  const blockTag = `0x${BigInt(snapshot.blockNumber).toString(16)}`;

  const registryEvidence = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'PROVIDER_OBSERVATION',
      source: `pancakeswap-official-v2-registry@${pancake.registryObservedAt.slice(0, 10)}`,
      sourceUri: pancake.factorySource,
      locator: `pancakeswap-v2-bsc:${factory}:${router}@${snapshot.blockNumber}`,
      payload: pancake,
      observedAt: pancake.registryObservedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Official Pancake V2 BSC factory, router and fixed-fee registry selected.',
    }),
    [],
    snapshot,
  );

  const codeReads = [];
  for (const [address, role] of [
    [pool, 'pair'],
    [factory, 'factory'],
    [router, 'router'],
  ] as const) {
    codeReads.push(
      await observeCode({
        adapter: options.adapter,
        address,
        role,
        blockTag,
        snapshot,
        writeEvidence: options.writeEvidence,
      }),
    );
  }

  const poolFactoryAbi = ADDRESS_READ_ABI('factory');
  const poolFactory = await observeContractCall({
    adapter: options.adapter,
    to: pool,
    data: encodeFunctionData({ abi: poolFactoryAbi, functionName: 'factory' }),
    method: 'pair.factory',
    blockTag,
    snapshot,
    writeEvidence: options.writeEvidence,
    decode: (raw) =>
      canonicalAddress(
        decodeFunctionResult({
          abi: poolFactoryAbi,
          functionName: 'factory',
          data: raw as `0x${string}`,
        }),
        'pair factory',
      ),
  });
  const token0Abi = ADDRESS_READ_ABI('token0');
  const token0Read = await observeContractCall({
    adapter: options.adapter,
    to: pool,
    data: encodeFunctionData({ abi: token0Abi, functionName: 'token0' }),
    method: 'pair.token0',
    blockTag,
    snapshot,
    writeEvidence: options.writeEvidence,
    decode: (raw) =>
      canonicalAddress(
        decodeFunctionResult({
          abi: token0Abi,
          functionName: 'token0',
          data: raw as `0x${string}`,
        }),
        'pair token0',
      ),
  });
  const token1Abi = ADDRESS_READ_ABI('token1');
  const token1Read = await observeContractCall({
    adapter: options.adapter,
    to: pool,
    data: encodeFunctionData({ abi: token1Abi, functionName: 'token1' }),
    method: 'pair.token1',
    blockTag,
    snapshot,
    writeEvidence: options.writeEvidence,
    decode: (raw) =>
      canonicalAddress(
        decodeFunctionResult({
          abi: token1Abi,
          functionName: 'token1',
          data: raw as `0x${string}`,
        }),
        'pair token1',
      ),
  });
  const reservesRead = await observeContractCall({
    adapter: options.adapter,
    to: pool,
    data: encodeFunctionData({ abi: GET_RESERVES_ABI, functionName: 'getReserves' }),
    method: 'pair.getReserves',
    blockTag,
    snapshot,
    writeEvidence: options.writeEvidence,
    decode: (raw) => {
      const [reserve0, reserve1, timestamp] = decodeFunctionResult({
        abi: GET_RESERVES_ABI,
        functionName: 'getReserves',
        data: raw as `0x${string}`,
      });
      return { reserve0, reserve1, timestamp };
    },
  });
  const getPairRead = await observeContractCall({
    adapter: options.adapter,
    to: factory,
    data: encodeFunctionData({
      abi: GET_PAIR_ABI,
      functionName: 'getPair',
      args: [token as `0x${string}`, quoteAsset as `0x${string}`],
    }),
    method: 'factory.getPair',
    blockTag,
    snapshot,
    writeEvidence: options.writeEvidence,
    decode: (raw) =>
      canonicalAddress(
        decodeFunctionResult({
          abi: GET_PAIR_ABI,
          functionName: 'getPair',
          data: raw as `0x${string}`,
        }),
        'factory pair',
      ),
  });
  const routerFactoryAbi = ADDRESS_READ_ABI('factory');
  const routerFactory = await observeContractCall({
    adapter: options.adapter,
    to: router,
    data: encodeFunctionData({ abi: routerFactoryAbi, functionName: 'factory' }),
    method: 'router.factory',
    blockTag,
    snapshot,
    writeEvidence: options.writeEvidence,
    decode: (raw) =>
      canonicalAddress(
        decodeFunctionResult({
          abi: routerFactoryAbi,
          functionName: 'factory',
          data: raw as `0x${string}`,
        }),
        'router factory',
      ),
  });
  const tokenDecimalsRead = await observeContractCall({
    adapter: options.adapter,
    to: token,
    data: encodeFunctionData({ abi: DECIMALS_ABI, functionName: 'decimals' }),
    method: 'token.decimals',
    blockTag,
    snapshot,
    writeEvidence: options.writeEvidence,
    decode: (raw) =>
      uint8(
        decodeFunctionResult({
          abi: DECIMALS_ABI,
          functionName: 'decimals',
          data: raw as `0x${string}`,
        }),
        'token decimals',
      ),
  });
  const quoteDecimalsRead = await observeContractCall({
    adapter: options.adapter,
    to: quoteAsset,
    data: encodeFunctionData({ abi: DECIMALS_ABI, functionName: 'decimals' }),
    method: 'quote.decimals',
    blockTag,
    snapshot,
    writeEvidence: options.writeEvidence,
    decode: (raw) =>
      uint8(
        decodeFunctionResult({
          abi: DECIMALS_ABI,
          functionName: 'decimals',
          data: raw as `0x${string}`,
        }),
        'quote decimals',
      ),
  });

  const token0 = token0Read.value;
  const token1 = token1Read.value;
  const pairMatches =
    (token0 === token && token1 === quoteAsset) || (token0 === quoteAsset && token1 === token);
  if (
    poolFactory.value !== factory ||
    routerFactory.value !== factory ||
    getPairRead.value !== pool ||
    !pairMatches
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Flap pool, Pancake V2 factory/router, getPair, and pair token identities do not agree.',
    );
  }
  const tokenReserve = token0 === token ? reservesRead.value.reserve0 : reservesRead.value.reserve1;
  const quoteReserve =
    token0 === quoteAsset ? reservesRead.value.reserve0 : reservesRead.value.reserve1;
  if (tokenReserve <= 0n || quoteReserve <= 0n) {
    throw new ProviderError('INVALID_RESPONSE', 'Pancake V2 pair reserves must be positive.');
  }

  const tokenDecimals = tokenDecimalsRead.value;
  const quoteDecimals = quoteDecimalsRead.value;
  const atomicInputs = normalizedInputs.map((input) => toAtomic(input, quoteDecimals));
  if (new Set(atomicInputs.map(String)).size !== atomicInputs.length) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Pancake V2 quote inputs must be unique after quote-asset decimal normalization.',
    );
  }

  const callEvidence = [
    poolFactory.evidence,
    token0Read.evidence,
    token1Read.evidence,
    reservesRead.evidence,
    getPairRead.evidence,
    routerFactory.evidence,
    tokenDecimalsRead.evidence,
    quoteDecimalsRead.evidence,
  ];
  const quoteReads: Array<ObservedCall<readonly bigint[]>> = [];
  const scenarios: FlapPancakeV2BuyScenarioPoint[] = [];
  for (const quoteInputAtomic of atomicInputs) {
    const quoteRead = await observeContractCall({
      adapter: options.adapter,
      to: router,
      data: encodeFunctionData({
        abi: GET_AMOUNTS_OUT_ABI,
        functionName: 'getAmountsOut',
        args: [quoteInputAtomic, [quoteAsset as `0x${string}`, token as `0x${string}`]],
      }),
      method: `router.getAmountsOut:${quoteInputAtomic.toString()}`,
      blockTag,
      snapshot,
      writeEvidence: options.writeEvidence,
      decode: (raw) =>
        decodeFunctionResult({
          abi: GET_AMOUNTS_OUT_ABI,
          functionName: 'getAmountsOut',
          data: raw as `0x${string}`,
        }),
    });
    const [observedInput, officialOutput, ...extraOutputs] = quoteRead.value;
    if (
      observedInput !== quoteInputAtomic ||
      officialOutput === undefined ||
      extraOutputs.length !== 0
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Pancake V2 router quote did not preserve the exact two-asset path and input.',
      );
    }
    const formulaOutput = formulaAmountOut(quoteInputAtomic, quoteReserve, tokenReserve);
    if (formulaOutput >= tokenReserve || officialOutput >= tokenReserve) {
      throw new ProviderError('INVALID_RESPONSE', 'Pancake V2 quote exceeds the pair reserve.');
    }
    const quoteWithinTolerance = withinTolerance(officialOutput, formulaOutput);
    let configuredTaxNetTokenOutput: KnowledgeValue<FlapPancakeV2TokenAmount>;
    if (!quoteWithinTolerance) {
      configuredTaxNetTokenOutput = unknownValue(
        'CONFLICTING_SOURCES',
        'The official router quote and deterministic pool formula exceed the 0.1% error budget.',
      );
    } else if (state.buyTaxBps.state !== 'known') {
      configuredTaxNetTokenOutput = state.buyTaxBps;
    } else {
      const taxBps = BigInt(state.buyTaxBps.value);
      configuredTaxNetTokenOutput = knownValue(
        amount((officialOutput * (BPS_DENOMINATOR - taxBps)) / BPS_DENOMINATOR, tokenDecimals),
      );
    }
    const averageConfiguredTaxBuyPrice: KnowledgeValue<string> =
      configuredTaxNetTokenOutput.state === 'known'
        ? averagePrice(
            quoteInputAtomic,
            BigInt(configuredTaxNetTokenOutput.value.atomic),
            quoteDecimals,
            tokenDecimals,
          )
        : configuredTaxNetTokenOutput;
    const postTokenReserve = tokenReserve - formulaOutput;
    const modeledPostBuySpotPrice = ratioDecimal(
      (quoteReserve + quoteInputAtomic) * power10(tokenDecimals),
      postTokenReserve * power10(quoteDecimals),
      PRICE_SCALE,
    );
    scenarios.push({
      quoteInput: amount(quoteInputAtomic, quoteDecimals),
      officialRouterGrossTokenOutput: amount(officialOutput, tokenDecimals),
      deterministicPoolGrossTokenOutput: amount(formulaOutput, tokenDecimals),
      configuredTaxNetTokenOutput,
      executionNetTokenOutput: unknownValue(
        'NOT_QUERIED',
        'Actual wallet receipt requires a pinned fork swap simulation including token tax and swapback behavior.',
      ),
      averageGrossBuyPrice: averagePrice(
        quoteInputAtomic,
        officialOutput,
        quoteDecimals,
        tokenDecimals,
      ),
      averageConfiguredTaxBuyPrice,
      modeledPostBuySpotPrice,
      modeledPriceChangeBps: priceChangeBps(
        quoteReserve,
        tokenReserve,
        quoteInputAtomic,
        formulaOutput,
      ),
      deterministicQuoteErrorBps: quoteErrorBps(officialOutput, formulaOutput),
      deterministicToleranceBps: DETERMINISTIC_TOLERANCE_BPS.toString(),
      withinDeterministicTolerance: quoteWithinTolerance,
      assumption:
        'Pool-only exact-input model: the full quote input reaches the pair, the documented 25 bps V2 fee applies, and token tax/swapback side effects are excluded.',
    });
    quoteReads.push(quoteRead);
  }

  const market: FlapPancakeV2Market = {
    venue: 'PANCAKESWAP_V2',
    chainId: 'eip155:56',
    pool,
    factory,
    router,
    token,
    quoteAsset,
    token0,
    token1,
    tokenDecimals,
    quoteDecimals,
    tokenReserve: amount(tokenReserve, tokenDecimals),
    quoteReserve: amount(quoteReserve, quoteDecimals),
    currentSpotPriceWad: (
      (quoteReserve * power10(tokenDecimals) * power10(PRICE_SCALE)) /
      (tokenReserve * power10(quoteDecimals))
    ).toString(),
    currentSpotPrice: ratioDecimal(
      quoteReserve * power10(tokenDecimals),
      tokenReserve * power10(quoteDecimals),
      PRICE_SCALE,
    ),
    dexFeeBps: pancake.feeBps,
    configuredBuyTaxBps: state.buyTaxBps,
    pairTimestampLast: reservesRead.value.timestamp.toString(),
    sourceRevision: pancake.sourceRevision,
  };
  const pensionSinkTreatment = unknownValue(
    'INSUFFICIENT_DATA',
    'A transfer to the pension wallet is movable custody, not supply burn. The displayed post-buy price counts only the pool trade and no extra sink effect.',
  );
  const failedScenarioCount = scenarios.filter(
    (scenario) => !scenario.withinDeterministicTolerance,
  ).length;
  const validation = {
    status: failedScenarioCount === 0 ? ('PASS' as const) : ('FAIL' as const),
    deterministicToleranceBps: DETERMINISTIC_TOLERANCE_BPS.toString(),
    evaluatedScenarioCount: scenarios.length,
    failedScenarioCount,
  };
  const sourceEvidenceIds = [
    supportingEvidence.id,
    registryEvidence.id,
    ...codeReads.map((item) => item.evidence.id),
    ...callEvidence.map((item) => item.id),
    ...quoteReads.map((item) => item.evidence.id),
  ];
  const terminal = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${FLAP_PANCAKE_V2_BUY_MODEL_VERSION}`,
      locator: `rv:flap-pancake-v2-buy:${token}:${atomicInputs.join(',')}@${snapshot.blockNumber}`,
      payload: { market, scenarios, validation, pensionSinkTreatment },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary:
        'Pancake V2 spot price and buy-size scenarios derived from verified same-Snapshot pool and official router state.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    snapshot,
  );
  const evidence = [
    ...inspection.evidence,
    registryEvidence,
    ...codeReads.map((item) => item.evidence),
    ...callEvidence,
    ...quoteReads.map((item) => item.evidence),
    terminal,
  ];
  return FlapPancakeV2BuyScenarioResultSchema.parse({
    platform: 'flap',
    token,
    market: knownValue(market),
    scenarios,
    validation,
    pensionSinkTreatment,
    terminalEvidenceId: terminal.id,
    metadata: metadata({
      snapshot,
      sourceSet: [
        ...inspection.metadata.sourceSet,
        registryEvidence.source,
        ...codeReads.map((item) => item.observation.endpointId),
        ...callEvidence.map((item) => item.source),
        ...quoteReads.map((item) => item.observation.endpointId),
      ],
      evidenceIds: evidence.map((item) => item.id),
      dataCoverage: 0.85,
      sourceCoverage: 0.5,
      simulationCoverage: 0.5,
      confidence: validation.status === 'PASS' ? 0.96 : 0.5,
    }),
    evidence,
  });
}
