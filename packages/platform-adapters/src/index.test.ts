import { describe, expect, it } from 'vitest';

import {
  EvmLedgerAdapter,
  ProviderError,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import { createEvidence, EvidenceLedger } from '@zerotrace/evidence';
import {
  unknownValue,
  type AnalysisSnapshot,
  type EvmPensionCandidateDiscovery,
  type Evidence,
} from '@zerotrace/schemas';
import { encodeAbiParameters } from 'viem';

import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  PANCAKE_V2_BSC_DEPLOYMENT,
  PLATFORM_REGISTRY,
  inferGenericLaunchMechanism,
  inspectFlapToken,
  quoteFlapPancakeV2BuyScenarios,
  quoteFlapPancakeV2SellScenarios,
  quoteFlapPensionEntryScenarios,
  quoteFlapSell,
  type FlapDeployment,
} from './index.js';

const flapStateV5Components = [
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

const zeroAddress = `0x${'0'.repeat(40)}` as const;
const zeroBytes32 = `0x${'0'.repeat(64)}` as const;
const tokenAddress = `0x${'a'.repeat(40)}`;
const poolAddress = `0x${'b'.repeat(40)}`;
const quoteAddress = `0x${'c'.repeat(40)}`;

function encodeFlapV5(overrides: Record<string, unknown> = {}) {
  return encodeAbiParameters(
    [{ type: 'tuple', components: flapStateV5Components }],
    [
      {
        status: 1,
        reserve: 100n,
        circulatingSupply: 500n,
        price: 200n,
        tokenVersion: 2,
        r: 10n,
        h: 20n,
        k: 300n,
        dexSupplyThresh: 1_000n,
        quoteTokenAddress: zeroAddress,
        nativeToQuoteSwapEnabled: true,
        extensionID: zeroBytes32,
        ...overrides,
      },
    ],
  );
}

function encodeFlapV6(overrides: Record<string, unknown> = {}) {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          ...flapStateV5Components,
          { name: 'taxRate', type: 'uint256' },
          { name: 'pool', type: 'address' },
          { name: 'progress', type: 'uint256' },
        ],
      },
    ],
    [
      {
        status: 1,
        reserve: 100n,
        circulatingSupply: 500n,
        price: 200n,
        tokenVersion: 5,
        r: 10n,
        h: 20n,
        k: 300n,
        dexSupplyThresh: 1_000n,
        quoteTokenAddress: zeroAddress,
        nativeToQuoteSwapEnabled: true,
        extensionID: zeroBytes32,
        taxRate: 500n,
        pool: zeroAddress,
        progress: 500_000_000_000_000_000n,
        ...overrides,
      },
    ],
  );
}

function encodeFlapV8Safe(overrides: Record<string, unknown> = {}) {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          ...flapStateV5Components,
          { name: 'buyTaxRate', type: 'uint256' },
          { name: 'sellTaxRate', type: 'uint256' },
          { name: 'pool', type: 'address' },
          { name: 'progress', type: 'uint256' },
          { name: 'lpFeeProfile', type: 'uint8' },
          { name: 'dexId', type: 'uint8' },
        ],
      },
    ],
    [
      {
        status: 1,
        reserve: 100n,
        circulatingSupply: 500n,
        price: 200n,
        tokenVersion: 6,
        r: 10n,
        h: 20n,
        k: 300n,
        dexSupplyThresh: 1_000n,
        quoteTokenAddress: zeroAddress,
        nativeToQuoteSwapEnabled: true,
        extensionID: zeroBytes32,
        buyTaxRate: 300n,
        sellTaxRate: 700n,
        pool: `0x${'b'.repeat(40)}`,
        progress: 500_000_000_000_000_000n,
        lpFeeProfile: 1,
        dexId: 0,
        ...overrides,
      },
    ],
  );
}

function encodeAddress(value: string) {
  return encodeAbiParameters([{ type: 'address' }], [value as `0x${string}`]);
}

function encodeUint8(value: number) {
  return encodeAbiParameters([{ type: 'uint8' }], [value]);
}

function encodeReserves(reserve0: bigint, reserve1: bigint) {
  return encodeAbiParameters(
    [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }],
    [reserve0, reserve1, 123],
  );
}

function pancakeV2AmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint) {
  const amountInWithFee = amountIn * 9_975n;
  return (amountInWithFee * reserveOut) / (reserveIn * 10_000n + amountInWithFee);
}

function encodeAmountsOut(input: bigint, output: bigint) {
  return encodeAbiParameters([{ type: 'uint256[]' }], [[input, output]]);
}

class FlapJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-fixture';
  readonly calls: Array<{ method: string; params: readonly unknown[] }> = [];
  readonly #callResults: unknown[];
  readonly #tokenHasCode: boolean;

  constructor(callResults: unknown[], tokenHasCode = true) {
    this.#callResults = [...callResults];
    this.#tokenHasCode = tokenHasCode;
  }

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    this.calls.push({ method, params });
    if (method === 'eth_getBlockByNumber') {
      return {
        number: '0x10',
        hash: `0x${'1'.repeat(64)}`,
        parentHash: `0x${'2'.repeat(64)}`,
        timestamp: '0x65',
      } as T;
    }
    if (method === 'eth_getCode') {
      const address = (params[0] as string).toLowerCase();
      return (address === tokenAddress && !this.#tokenHasCode ? '0x' : '0x6000') as T;
    }
    if (method === 'eth_call') {
      const value = this.#callResults.shift();
      if (value instanceof Error) throw value;
      return value as T;
    }
    throw new Error(`Unexpected method ${method}`);
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    return { value: await this.request<T>(method, params), endpointId: this.endpointId };
  }
}

function flapFixture(callResults: unknown[], deployment = FLAP_BSC_MAINNET_DEPLOYMENT) {
  const transport = new FlapJsonRpcTransport(callResults);
  const adapter = new EvmLedgerAdapter(
    {
      id: 'bsc-rpc',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    transport,
  );
  const evidence = new EvidenceLedger();
  return {
    transport,
    evidence,
    inspect: () =>
      inspectFlapToken({
        adapter,
        deployment,
        token: tokenAddress,
        writeEvidence: async (item, sources = [], snapshot) =>
          evidence.add(item, sources, snapshot).evidence,
      }),
    quote: (inputQuantity: string) =>
      quoteFlapSell({
        adapter,
        deployment,
        token: tokenAddress,
        inputQuantity,
        writeEvidence: async (item, sources = [], snapshot) =>
          evidence.add(item, sources, snapshot).evidence,
      }),
    buyScenarios: (quoteInputs: readonly string[]) =>
      quoteFlapPancakeV2BuyScenarios({
        adapter,
        deployment,
        token: tokenAddress,
        quoteInputs,
        writeEvidence: async (item, sources = [], snapshot) =>
          evidence.add(item, sources, snapshot).evidence,
      }),
    pensionEntry: (options: {
      quoteInputs: readonly string[];
      pensionWallet: string;
      behaviorReport: EvmPensionCandidateDiscovery;
      behaviorReportId: string;
      behaviorResultHash: string;
      behaviorEvidence: readonly Evidence[];
    }) =>
      quoteFlapPensionEntryScenarios({
        adapter,
        deployment,
        token: tokenAddress,
        ...options,
        writeEvidence: async (item, sources = [], snapshot) =>
          evidence.add(item, sources, snapshot).evidence,
      }),
    sellScenarios: (tokenInputs: readonly string[]) =>
      quoteFlapPancakeV2SellScenarios({
        adapter,
        deployment,
        token: tokenAddress,
        tokenInputs,
        writeEvidence: async (item, sources = [], snapshot) =>
          evidence.add(item, sources, snapshot).evidence,
      }),
  };
}

function pensionBehaviorFixture(evidence: EvidenceLedger) {
  const snapshot: Extract<AnalysisSnapshot, { ledger: 'EVM' }> = {
    ledger: 'EVM',
    chainId: 'eip155:56',
    blockNumber: '15',
    blockHash: `0x${'3'.repeat(64)}`,
    parentBlockHash: `0x${'4'.repeat(64)}`,
    blockTimestamp: '1970-01-01T00:01:40.000Z',
    finality: 'finalized',
    capturedAt: '1970-01-01T00:01:40.000Z',
    providerVersions: { fixture: '1' },
    adapterVersions: { evm: '1' },
    configHash: '5'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
  const coverage = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'LOG',
    source: 'bsc-history-fixture',
    locator: `pension-transfer-range:${tokenAddress}:1-15`,
    payload: { fromBlock: '1', toBlock: '15', complete: true },
    observedAt: snapshot.capturedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    summary: 'Complete fixture transfer range.',
  });
  evidence.add(coverage, [], snapshot);
  const wallet = `0x${'d'.repeat(40)}`;
  const candidateEvidence = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:evm-pension-candidate-discovery-v1.0.0',
    locator: `pension-behavior-candidate:${tokenAddress}:${wallet}:1-15`,
    payload: { wallet, exactUnitDeposits: 5 },
    observedAt: snapshot.capturedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    summary: 'Fixture pension behavior candidate.',
    sourceEvidenceIds: [coverage.id],
  });
  evidence.add(candidateEvidence, [coverage.id], snapshot);
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:evm-pension-candidate-discovery-v1.0.0',
    locator: `pension-behavior-discovery:${tokenAddress}:1-15`,
    payload: { candidateCount: 1 },
    observedAt: snapshot.capturedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    summary: 'Fixture pension behavior discovery completed.',
    sourceEvidenceIds: [coverage.id, candidateEvidence.id],
  });
  evidence.add(terminal, [coverage.id, candidateEvidence.id], snapshot);
  const evidenceItems = [coverage, candidateEvidence, terminal];
  const report: EvmPensionCandidateDiscovery = {
    tokenAddress,
    fromBlock: '1',
    toBlock: '15',
    policy: {
      shareUnitAtomic: (1_000n * 10n ** 18n).toString(),
      minimumExactUnitDeposits: 5,
      minimumUniqueExactUnitDepositors: 5,
      maximumCandidates: 20,
    },
    scannedTransferCount: 5,
    candidates: [
      {
        address: wallet,
        inflowTransferCount: 5,
        outflowTransferCount: 0,
        exactUnitDepositCount: 5,
        exactMultipleDepositCount: 5,
        nonMultipleDepositCount: 0,
        uniqueExactUnitDepositorCount: 5,
        uniqueOutflowDestinationCount: 0,
        observedInflowAmount: (5_000n * 10n ** 18n).toString(),
        observedOutflowAmount: '0',
        observedNetAmount: (5_000n * 10n ** 18n).toString(),
        observedWholeShares: '5',
        firstInflowAt: snapshot.capturedAt,
        lastInflowAt: snapshot.capturedAt,
        firstOutflowAt: unknownValue('NOT_APPLICABLE'),
        lastOutflowAt: unknownValue('NOT_APPLICABLE'),
        criteria: ['EXACT_SHARE_UNIT_DEPOSITS', 'UNIQUE_DEPOSITOR_THRESHOLD'],
        transferEvidenceIds: [coverage.id],
        evidenceId: candidateEvidence.id,
        roleAttribution: unknownValue('INSUFFICIENT_DATA'),
        participantExitPolicy: unknownValue('INSUFFICIENT_DATA'),
        dividendExecution: unknownValue('INSUFFICIENT_DATA'),
      },
    ],
    coverageEvidenceIds: [coverage.id],
    terminalEvidenceId: terminal.id,
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp ?? null,
      sourceSet: ['bsc-history-fixture'],
      modelVersion: 'evm-pension-candidate-discovery-v1.0.0',
      confidence: 0.8,
      evidenceIds: evidenceItems.map((item) => item.id).sort(),
    },
  };
  return { report, wallet, evidenceItems };
}

describe('platform registry', () => {
  it('models GMGN as execution/labels rather than a launchpad', () => {
    const gmgn = PLATFORM_REGISTRY.find((platform) => platform.id === 'gmgn');
    expect(gmgn?.roles).toEqual(['EXECUTION_PLATFORM', 'LABEL_PROVIDER']);
  });

  it('does not invent a platform name when only generic mechanism evidence exists', () => {
    const detection = inferGenericLaunchMechanism({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      factoryOrProgram: 'program',
      quoteReserve: '100',
      virtualReserve: '1000',
      buySellEvents: 10,
      migrationEvents: 1,
      liquidityEvents: 1,
      feeTransferEvents: 3,
      evidenceIds: ['ev_raw'],
    });
    expect(detection.platform).toBe('UNKNOWN_LAUNCHPAD');
    expect(detection.mechanism).toEqual({ state: 'known', value: 'BONDING_CURVE_LIKE' });
  });

  it('requires evidence before scoring generic launch behavior', () => {
    const detection = inferGenericLaunchMechanism({
      ledger: 'EVM',
      chainId: 'eip155:56',
      buySellEvents: 10,
      migrationEvents: 1,
      liquidityEvents: 1,
      feeTransferEvents: 1,
      evidenceIds: [],
    });
    expect(detection.mechanismConfidence).toBe(0);
    expect(detection.mechanism).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
  });

  it('reports a low-confidence generic mechanism without inventing certainty', () => {
    const detection = inferGenericLaunchMechanism({
      ledger: 'EVM',
      chainId: 'eip155:1',
      factoryOrProgram: 'factory',
      buySellEvents: 1,
      migrationEvents: 1,
      liquidityEvents: 0,
      feeTransferEvents: 0,
      evidenceIds: ['ev_one', 'ev_one'],
    });
    expect(detection.mechanismConfidence).toBe(0.2);
    expect(detection.evidenceIds).toEqual(['ev_one']);
    expect(detection.mechanism).toMatchObject({ state: 'unknown' });
  });
});

describe('Flap read-only inspection', () => {
  it('normalizes the current BSC V8Safe token state into an Evidence-backed mechanism Snapshot', async () => {
    const fixture = flapFixture([encodeFlapV8Safe()]);
    const result = await fixture.inspect();

    expect(result.platformMatch).toEqual({ state: 'known', value: true });
    expect(result.state).toMatchObject({
      inspectionMethod: 'getTokenV8Safe',
      status: { state: 'known', value: 'TRADABLE' },
      tokenVersion: { state: 'known', value: 'TOKEN_TAXED_V3' },
      buyTaxBps: { state: 'known', value: '300' },
      sellTaxBps: { state: 'known', value: '700' },
    });
    expect(result.launch).toMatchObject({
      platform: 'flap',
      lifecycle: 'PRIMARY_MARKET',
      quoteAsset: { state: 'known', value: 'eip155:56:native' },
      spotPrice: { state: 'known', value: '0.0000000000000002' },
      realQuoteReserve: { state: 'known', value: '100' },
      virtualBaseReserve: { state: 'known', value: '20' },
      virtualQuoteReserve: { state: 'known', value: '10' },
      circulatingSupply: { state: 'known', value: '500' },
      remainingSupply: { state: 'known', value: '500' },
      progress: { state: 'known', value: '0.5' },
      taxModel: { state: 'known', value: 'FLAP_TAX_V3' },
      currentSellCapacity: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(result.evidence.map((item) => item.kind)).toEqual([
      'OFFICIAL_DOCUMENT',
      'CONTRACT_STATE',
      'CONTRACT_STATE',
      'CONTRACT_STATE',
      'DERIVED_FEATURE',
    ]);
    expect(fixture.evidence.get(result.evidence.at(-1)?.id ?? '')?.sourceEvidenceIds).toHaveLength(
      4,
    );
    expect(fixture.transport.calls.at(-1)).toMatchObject({ method: 'eth_call' });
    expect(fixture.transport.calls.at(-1)?.params[1]).toBe('0x10');
  });

  it('falls back from an unavailable V8Safe method to V6 with symmetric tax semantics', async () => {
    const fixture = flapFixture([
      new ProviderError('RPC_ERROR', 'method unavailable'),
      encodeFlapV6(),
    ]);
    const result = await fixture.inspect();

    expect(result.state).toMatchObject({
      inspectionMethod: 'getTokenV6',
      tokenVersion: { state: 'known', value: 'TOKEN_TAXED_V2' },
      buyTaxBps: { state: 'known', value: '500' },
      sellTaxBps: { state: 'known', value: '500' },
      lpFeeProfile: { state: 'unknown', reason: 'NOT_QUERIED' },
      dexId: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_call')).toHaveLength(2);
  });

  it('falls back from unavailable V8Safe and V6 methods to V5 without inventing fields', async () => {
    const fixture = flapFixture([
      new ProviderError('RPC_ERROR', 'method unavailable'),
      new ProviderError('RPC_ERROR', 'method unavailable'),
      encodeFlapV5(),
    ]);
    const result = await fixture.inspect();

    expect(result.state).toMatchObject({
      inspectionMethod: 'getTokenV5',
      buyTaxBps: { state: 'unknown', reason: 'NOT_QUERIED' },
      sellTaxBps: { state: 'unknown', reason: 'NOT_QUERIED' },
      pool: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(result.launch?.progress).toEqual({ state: 'known', value: '0.5' });
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_call')).toHaveLength(3);
  });

  it('does not reinterpret a retryable provider RPC failure as an older interface', async () => {
    const fixture = flapFixture([
      new ProviderError('RPC_ERROR', 'temporary provider failure', { retryable: true }),
      encodeFlapV5(),
    ]);

    await expect(fixture.inspect()).rejects.toMatchObject({
      code: 'RPC_ERROR',
      retryable: true,
    });
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_call')).toHaveLength(1);
  });

  it('keeps future V8Safe enum values Unknown while preserving asymmetric taxes', async () => {
    const deployment: FlapDeployment = {
      ...FLAP_BSC_MAINNET_DEPLOYMENT,
      documentedVersion: 'future-fixture',
      inspectionMethods: ['getTokenV8Safe'],
    };
    const fixture = flapFixture([encodeFlapV8Safe({ status: 9, tokenVersion: 9 })], deployment);
    const result = await fixture.inspect();

    expect(result.platformMatch).toEqual({ state: 'known', value: true });
    expect(result.state).toMatchObject({
      status: { state: 'unknown', reason: 'UNSUPPORTED' },
      tokenVersion: { state: 'unknown', reason: 'UNSUPPORTED' },
      buyTaxBps: { state: 'known', value: '300' },
      sellTaxBps: { state: 'known', value: '700' },
    });
    expect(result.launch?.lifecycle).toBe('UNKNOWN');
  });

  it('returns negative Evidence for a non-contract candidate without calling the Portal', async () => {
    const transport = new FlapJsonRpcTransport([], false);
    const adapter = new EvmLedgerAdapter(
      { id: 'bsc-rpc', chainId: 56, chainName: 'BNB Smart Chain' },
      transport,
    );
    const evidence = new EvidenceLedger();
    const result = await inspectFlapToken({
      adapter,
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      token: tokenAddress,
      writeEvidence: async (item, sources = [], snapshot) =>
        evidence.add(item, sources, snapshot).evidence,
    });

    expect(result.platformMatch).toEqual({ state: 'known', value: false });
    expect(result.state).toBeNull();
    expect(result.launch).toBeNull();
    expect(result.evidence.at(-1)?.kind).toBe('NEGATIVE_EVIDENCE');
    expect(transport.calls.some((call) => call.method === 'eth_call')).toBe(false);
  });

  it('rejects malformed V8Safe progress instead of clamping it to a plausible value', async () => {
    const fixture = flapFixture([encodeFlapV8Safe({ progress: 1_000_000_000_000_000_001n })]);
    await expect(fixture.inspect()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('Flap read-only sell preview', () => {
  it('preserves the exact Portal preview output with source-linked Evidence', async () => {
    const fixture = flapFixture([
      encodeFlapV8Safe(),
      encodeAbiParameters([{ type: 'uint256' }], [42n]),
    ]);
    const result = await fixture.quote('100');

    expect(result.quoteAsset).toEqual({ state: 'known', value: 'eip155:56:native' });
    expect(result.quote).toMatchObject({
      inputQuantity: '100',
      realizableValue: { state: 'known', value: '42' },
      nominalValue: { state: 'unknown', reason: 'NOT_QUERIED' },
      averageExitPrice: { state: 'unknown', reason: 'NOT_QUERIED' },
      priceImpactBps: { state: 'unknown', reason: 'NOT_QUERIED' },
      totalFeeBps: { state: 'unknown', reason: 'NOT_QUERIED' },
      metadata: {
        snapshot: { blockNumber: '16' },
        modelVersion: 'flap-preview-sell-v0.1.0',
      },
    });
    expect(result.evidence.map((item) => item.kind)).toEqual([
      'OFFICIAL_DOCUMENT',
      'CONTRACT_STATE',
      'CONTRACT_STATE',
      'CONTRACT_STATE',
      'DERIVED_FEATURE',
      'CONTRACT_STATE',
      'DERIVED_FEATURE',
    ]);
    expect(fixture.evidence.get(result.evidence.at(-1)?.id ?? '')?.sourceEvidenceIds).toEqual(
      result.evidence
        .slice(4, 6)
        .map((item) => item.id)
        .sort(),
    );
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_call')).toHaveLength(2);
  });

  it('keeps an exact zero known only when previewSell returns zero', async () => {
    const fixture = flapFixture([
      encodeFlapV8Safe(),
      encodeAbiParameters([{ type: 'uint256' }], [0n]),
    ]);

    const result = await fixture.quote('1');
    expect(result.quote.realizableValue).toEqual({ state: 'known', value: '0' });
    expect(result.evidence.at(-2)?.summary).toBe(
      'Flap previewSell output observed at the pinned Snapshot.',
    );
  });

  it('reports a buy-only Portal status as execution-blocked without calling previewSell', async () => {
    const fixture = flapFixture([encodeFlapV8Safe({ status: 2 })]);

    const result = await fixture.quote('100');
    expect(result.quote.realizableValue).toMatchObject({
      state: 'unavailable',
      reason: 'EXECUTION_BLOCKED',
    });
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_call')).toHaveLength(1);
    expect(result.evidence.at(-1)?.kind).toBe('DERIVED_FEATURE');
  });

  it('does not call previewSell when input exceeds evidenced circulating supply', async () => {
    const fixture = flapFixture([encodeFlapV8Safe()]);

    const result = await fixture.quote('501');
    expect(result.quote.realizableValue).toMatchObject({
      state: 'unavailable',
      reason: 'EXECUTION_BLOCKED',
      detail: expect.stringContaining('circulating supply'),
    });
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_call')).toHaveLength(1);
  });
});

const pancakeQuoteReserve = 1_000n * 10n ** 18n;
const pancakeTokenReserve = 1_000_000n * 10n ** 18n;

function marketFixture(
  options: {
    inputs?: readonly bigint[];
    factory?: string;
    reserve0?: bigint;
    reserve1?: bigint;
    buyTaxBps?: bigint;
    sellTaxBps?: bigint;
    extraCallResults?: readonly unknown[];
  } = {},
) {
  const inputs = options.inputs ?? [100n * 10n ** 18n, 1_000n * 10n ** 18n];
  const reserve0 = options.reserve0 ?? pancakeQuoteReserve;
  const reserve1 = options.reserve1 ?? pancakeTokenReserve;
  const factory = options.factory ?? PANCAKE_V2_BSC_DEPLOYMENT.factory;
  return flapFixture([
    encodeFlapV8Safe({
      status: 4,
      quoteTokenAddress: quoteAddress,
      pool: poolAddress,
      dexId: 0,
      buyTaxRate: options.buyTaxBps ?? 300n,
      sellTaxRate: options.sellTaxBps ?? 700n,
    }),
    encodeAddress(factory),
    encodeAddress(quoteAddress),
    encodeAddress(tokenAddress),
    encodeReserves(reserve0, reserve1),
    encodeAddress(poolAddress),
    encodeAddress(PANCAKE_V2_BSC_DEPLOYMENT.factory),
    encodeUint8(18),
    encodeUint8(18),
    ...inputs.map((input) =>
      encodeAmountsOut(input, pancakeV2AmountOut(input, reserve0, reserve1)),
    ),
    ...(options.extraCallResults ?? []),
  ]);
}

describe('Flap migrated Pancake V2 buy-size scenarios', () => {
  it('binds the official pair/router quote and deterministic multi-size model to one Snapshot', async () => {
    const fixture = marketFixture();
    const result = await fixture.buyScenarios(['100', '1000']);

    expect(result.market).toMatchObject({
      state: 'known',
      value: {
        venue: 'PANCAKESWAP_V2',
        pool: poolAddress,
        token: tokenAddress,
        quoteAsset: quoteAddress,
        tokenReserve: { decimal: '1000000' },
        quoteReserve: { decimal: '1000' },
        currentSpotPrice: '0.001',
        dexFeeBps: '25',
        configuredBuyTaxBps: { state: 'known', value: '300' },
      },
    });
    expect(result.scenarios).toHaveLength(2);
    expect(result.validation).toEqual({
      status: 'PASS',
      deterministicToleranceBps: '10',
      evaluatedScenarioCount: 2,
      failedScenarioCount: 0,
    });
    expect(result.scenarios[0]).toMatchObject({
      quoteInput: { decimal: '100' },
      deterministicQuoteErrorBps: '0',
      deterministicToleranceBps: '10',
      withinDeterministicTolerance: true,
      executionNetTokenOutput: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(result.scenarios[0]?.officialRouterGrossTokenOutput).toEqual(
      result.scenarios[0]?.deterministicPoolGrossTokenOutput,
    );
    expect(result.scenarios[0]?.configuredTaxNetTokenOutput).toMatchObject({ state: 'known' });
    expect(result.pensionSinkTreatment).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
      detail: expect.stringContaining('not supply burn'),
    });
    expect(result.metadata).toMatchObject({
      snapshot: { blockNumber: '16' },
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0.5,
    });
    expect(result.evidence.at(-1)?.id).toBe(result.terminalEvidenceId);
    expect(
      fixture.evidence.get(result.terminalEvidenceId)?.sourceEvidenceIds.length,
    ).toBeGreaterThan(10);
  });

  it('rejects a pair whose factory identity disagrees with the official deployment', async () => {
    const fixture = marketFixture({ factory: `0x${'d'.repeat(40)}` });

    await expect(fixture.buyScenarios(['100', '1000'])).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringContaining('identities do not agree'),
    });
  });

  it('does not read a pool when the Flap token is still in its primary market', async () => {
    const fixture = flapFixture([encodeFlapV8Safe({ status: 1 })]);
    const result = await fixture.buyScenarios(['100']);

    expect(result.market).toMatchObject({ state: 'unavailable', reason: 'NOT_APPLICABLE' });
    expect(result.scenarios).toEqual([]);
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_call')).toHaveLength(1);
  });

  it('rejects a pool with a zero reserve instead of presenting a zero price', async () => {
    const fixture = marketFixture({ reserve0: 0n });

    await expect(fixture.buyScenarios(['100', '1000'])).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringContaining('reserves must be positive'),
    });
  });

  it('rejects a quote input above the router uint256 limit before making a quote call', async () => {
    const fixture = marketFixture({ inputs: [] });

    await expect(fixture.buyScenarios([(2n ** 256n).toString()])).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringContaining('uint256 limit'),
    });
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_call')).toHaveLength(9);
  });

  it('keeps a configured 100% tax net output known as zero but its average price Unknown', async () => {
    const fixture = marketFixture({ buyTaxBps: 10_000n });
    const result = await fixture.buyScenarios(['100', '1000']);

    expect(result.scenarios[0]?.configuredTaxNetTokenOutput).toEqual({
      state: 'known',
      value: { atomic: '0', decimal: '0' },
    });
    expect(result.scenarios[0]?.averageConfiguredTaxBuyPrice).toMatchObject({
      state: 'unknown',
      reason: 'NOT_APPLICABLE',
    });
  });
});

describe('Flap pension-entry economics', () => {
  it('binds share economics to a durable behavior candidate without calling custody a burn', async () => {
    const fixture = marketFixture();
    const behavior = pensionBehaviorFixture(fixture.evidence);
    const result = await fixture.pensionEntry({
      quoteInputs: ['100', '1000'],
      pensionWallet: behavior.wallet,
      behaviorReport: behavior.report,
      behaviorReportId: `pcr_${'1'.repeat(24)}`,
      behaviorResultHash: '1'.repeat(64),
      behaviorEvidence: behavior.evidenceItems,
    });

    expect(result.behavior).toMatchObject({
      wallet: behavior.wallet,
      shareUnit: { decimal: '1000' },
      roleAttribution: { state: 'unknown' },
      participantExitPolicy: { state: 'unknown' },
      dividendExecution: { state: 'unknown' },
    });
    expect(result.entries).toHaveLength(2);
    const first = result.entries[0];
    expect(first?.modeledNetTokenOutput.state).toBe('known');
    if (first?.modeledNetTokenOutput.state === 'known') {
      const net = BigInt(first.modeledNetTokenOutput.value.atomic);
      expect(first.modeledWholeShares).toEqual({
        state: 'known',
        value: (net / BigInt(result.behavior.shareUnit.atomic)).toString(),
      });
      expect(
        BigInt(
          first.modeledCommittedTokenAmount.state === 'known'
            ? first.modeledCommittedTokenAmount.value.atomic
            : '-1',
        ) +
          BigInt(
            first.modeledRemainderTokenAmount.state === 'known'
              ? first.modeledRemainderTokenAmount.value.atomic
              : '-1',
          ),
      ).toBe(net);
    }
    expect(first?.modeledPostDepositSpotPrice).toEqual({
      state: 'known',
      value: first?.buyScenario.modeledPostBuySpotPrice,
    });
    expect(first?.executionWholeShares).toMatchObject({
      state: 'unknown',
      reason: 'NOT_QUERIED',
    });
    expect(result.destinationTreatment).toBe('NON_ZERO_CUSTODY_ADDRESS');
    expect(result.totalSupplyReduction).toMatchObject({ state: 'unknown' });
    expect(result.custodyIrreversible).toMatchObject({ state: 'unknown' });
    expect(result.metadata).toMatchObject({
      snapshot: { blockNumber: '16' },
      modelVersion: 'flap-pension-entry-economics-v0.1.0',
    });
    expect(result.evidence.at(-1)?.id).toBe(result.terminalEvidenceId);
    expect(fixture.evidence.get(result.terminalEvidenceId)?.sourceEvidenceIds).toEqual(
      [
        result.behavior.candidateEvidenceId,
        result.behavior.reportTerminalEvidenceId,
        result.evidence.find(
          (item) => item.source === 'zerotrace:flap-pancake-v2-pool-buy-scenarios-v0.1.0',
        )?.id,
      ].sort(),
    );
  });

  it('rejects a wallet that is not in the referenced behavior report before provider reads', async () => {
    const fixture = marketFixture();
    const behavior = pensionBehaviorFixture(fixture.evidence);

    await expect(
      fixture.pensionEntry({
        quoteInputs: ['100', '1000'],
        pensionWallet: `0x${'e'.repeat(40)}`,
        behaviorReport: behavior.report,
        behaviorReportId: `pcr_${'1'.repeat(24)}`,
        behaviorResultHash: '1'.repeat(64),
        behaviorEvidence: behavior.evidenceItems,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringContaining('not a candidate'),
    });
    expect(fixture.transport.calls).toHaveLength(0);
  });

  it('rejects an incomplete behavior Evidence set before provider reads', async () => {
    const fixture = marketFixture();
    const behavior = pensionBehaviorFixture(fixture.evidence);

    await expect(
      fixture.pensionEntry({
        quoteInputs: ['100'],
        pensionWallet: behavior.wallet,
        behaviorReport: behavior.report,
        behaviorReportId: `pcr_${'1'.repeat(24)}`,
        behaviorResultHash: '1'.repeat(64),
        behaviorEvidence: behavior.evidenceItems.slice(0, 1),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringContaining('Evidence set is incomplete'),
    });
    expect(fixture.transport.calls).toHaveLength(0);
  });

  it('keeps a known zero receipt distinct from an undefined average share cost', async () => {
    const fixture = marketFixture({ buyTaxBps: 10_000n });
    const behavior = pensionBehaviorFixture(fixture.evidence);
    const result = await fixture.pensionEntry({
      quoteInputs: ['100'],
      pensionWallet: behavior.wallet,
      behaviorReport: behavior.report,
      behaviorReportId: `pcr_${'1'.repeat(24)}`,
      behaviorResultHash: '1'.repeat(64),
      behaviorEvidence: behavior.evidenceItems,
    });

    expect(result.entries[0]).toMatchObject({
      modeledNetTokenOutput: { state: 'known', value: { atomic: '0', decimal: '0' } },
      modeledWholeShares: { state: 'known', value: '0' },
      modeledAverageQuoteCostPerShare: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    });
  });
});

describe('Flap migrated Pancake V2 sell-size scenarios', () => {
  const marketCertificationInput = 1n * 10n ** 18n;

  function sellFixture(
    tokenInputs: readonly bigint[],
    options: { sellTaxBps?: bigint; grossOutputDelta?: bigint } = {},
  ) {
    return marketFixture({
      inputs: [marketCertificationInput],
      ...(options.sellTaxBps === undefined ? {} : { sellTaxBps: options.sellTaxBps }),
      extraCallResults: tokenInputs.map((input) =>
        encodeAmountsOut(
          input,
          pancakeV2AmountOut(input, pancakeTokenReserve, pancakeQuoteReserve) +
            (options.grossOutputDelta ?? 0n),
        ),
      ),
    });
  }

  it('separates nominal, Router gross, configured-tax estimate and actual execution Unknown', async () => {
    const tokenInputs = [1_000n * 10n ** 18n, 10_000n * 10n ** 18n];
    const fixture = sellFixture(tokenInputs);
    const result = await fixture.sellScenarios(['1000', '10000']);

    expect(result.market).toMatchObject({
      state: 'known',
      value: {
        currentSpotPrice: '0.001',
        configuredSellTaxBps: { state: 'known', value: '700' },
      },
    });
    expect(result.validation).toEqual({
      status: 'PASS',
      deterministicToleranceBps: '10',
      evaluatedScenarioCount: 2,
      failedScenarioCount: 0,
    });
    expect(result.scenarios[0]).toMatchObject({
      tokenInput: { decimal: '1000' },
      nominalSpotQuoteValue: { decimal: '1' },
      deterministicQuoteErrorBps: '0',
      withinDeterministicTolerance: true,
      configuredTaxTokenInputToPool: { state: 'known', value: { decimal: '930' } },
      configuredTaxNetQuoteOutput: { state: 'known' },
      executionNetQuoteOutput: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(
      BigInt(result.scenarios[0]?.officialRouterGrossQuoteOutput.atomic ?? '0'),
    ).toBeGreaterThan(
      BigInt(
        result.scenarios[0]?.configuredTaxNetQuoteOutput.state === 'known'
          ? result.scenarios[0].configuredTaxNetQuoteOutput.value.atomic
          : '0',
      ),
    );
    expect(result.executionCapacity).toMatchObject({
      state: 'unknown',
      reason: 'NOT_QUERIED',
      detail: expect.stringContaining('pinned-fork'),
    });
    expect(result.metadata).toMatchObject({
      snapshot: { blockNumber: '16' },
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0.5,
      modelVersion: 'flap-pancake-v2-pool-sell-scenarios-v0.1.0',
    });
    expect(result.evidence.at(-1)?.id).toBe(result.terminalEvidenceId);
  });

  it('fails the automatic check and withholds configured-tax estimates on a Router mismatch', async () => {
    const tokenInput = 1_000n * 10n ** 18n;
    const expected = pancakeV2AmountOut(tokenInput, pancakeTokenReserve, pancakeQuoteReserve);
    const fixture = sellFixture([tokenInput], { grossOutputDelta: expected / 100n });
    const result = await fixture.sellScenarios(['1000']);

    expect(result.validation).toMatchObject({ status: 'FAIL', failedScenarioCount: 1 });
    expect(result.scenarios[0]).toMatchObject({
      withinDeterministicTolerance: false,
      configuredTaxNetQuoteOutput: { state: 'unknown', reason: 'CONFLICTING_SOURCES' },
      executionNetQuoteOutput: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
  });

  it('keeps a configured 100% sell tax as a zero estimate without calling it execution proof', async () => {
    const tokenInput = 1_000n * 10n ** 18n;
    const fixture = sellFixture([tokenInput], { sellTaxBps: 10_000n });
    const result = await fixture.sellScenarios(['1000']);

    expect(result.scenarios[0]).toMatchObject({
      configuredTaxTokenInputToPool: { state: 'known', value: { atomic: '0', decimal: '0' } },
      configuredTaxNetQuoteOutput: { state: 'known', value: { atomic: '0', decimal: '0' } },
      averageConfiguredTaxExitPrice: { state: 'known', value: '0' },
      executionNetQuoteOutput: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
  });
});
