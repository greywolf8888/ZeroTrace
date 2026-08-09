import { describe, expect, it } from 'vitest';

import {
  EvmLedgerAdapter,
  ProviderError,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import { encodeAbiParameters } from 'viem';

import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  PLATFORM_REGISTRY,
  inferGenericLaunchMechanism,
  inspectFlapToken,
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
  };
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
  it('normalizes a BSC V6 token into an Evidence-backed mechanism Snapshot', async () => {
    const fixture = flapFixture([encodeFlapV6()]);
    const result = await fixture.inspect();

    expect(result.platformMatch).toEqual({ state: 'known', value: true });
    expect(result.state).toMatchObject({
      inspectionMethod: 'getTokenV6',
      status: { state: 'known', value: 'TRADABLE' },
      tokenVersion: { state: 'known', value: 'TOKEN_TAXED_V2' },
      buyTaxBps: { state: 'known', value: '500' },
      sellTaxBps: { state: 'known', value: '500' },
    });
    expect(result.launch).toMatchObject({
      platform: 'flap',
      lifecycle: 'PRIMARY_MARKET',
      quoteAsset: { state: 'known', value: 'eip155:56:native' },
      realQuoteReserve: { state: 'known', value: '100' },
      virtualBaseReserve: { state: 'known', value: '20' },
      virtualQuoteReserve: { state: 'known', value: '10' },
      circulatingSupply: { state: 'known', value: '500' },
      remainingSupply: { state: 'known', value: '500' },
      progress: { state: 'known', value: '0.5' },
      taxModel: { state: 'known', value: 'FLAP_TAX_V2' },
      currentSellCapacity: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(result.evidence.map((item) => item.kind)).toEqual([
      'PROVIDER_OBSERVATION',
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

  it('falls back from an unavailable V6 method to V5 without inventing tax or pool fields', async () => {
    const fixture = flapFixture([
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
    expect(fixture.transport.calls.filter((call) => call.method === 'eth_call')).toHaveLength(2);
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

  it('rejects malformed V6 progress instead of clamping it to a plausible value', async () => {
    const fixture = flapFixture([encodeFlapV6({ progress: 1_000_000_000_000_000_001n })]);
    await expect(fixture.inspect()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
