import { describe, expect, it } from 'vitest';

import {
  EvmLedgerAdapter,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import { encodeAbiParameters, toEventSelector, type AbiParameter } from 'viem';

import { FLAP_BSC_MAINNET_DEPLOYMENT, inspectFlapEventTransaction } from './index.js';

const token = `0x${'a'.repeat(40)}`;
const creator = `0x${'c'.repeat(40)}`;
const pool = `0x${'b'.repeat(40)}`;
const transactionHash = `0x${'3'.repeat(64)}`;
const blockHash = `0x${'1'.repeat(64)}`;
const parentHash = `0x${'2'.repeat(64)}`;
const unknownTopic = `0x${'9'.repeat(64)}` as const;

interface EventFixture {
  signature: string;
  parameters: readonly AbiParameter[];
  values: readonly unknown[];
}

function eventLog(event: EventFixture, logIndex: number, overrides: Record<string, unknown> = {}) {
  return {
    address: FLAP_BSC_MAINNET_DEPLOYMENT.portal,
    blockHash,
    blockNumber: '0x10',
    transactionHash,
    transactionIndex: '0x1',
    logIndex: `0x${logIndex.toString(16)}`,
    data: encodeAbiParameters(event.parameters, event.values),
    topics: [toEventSelector(event.signature)],
    removed: false,
    ...overrides,
  };
}

function tokenCreated(overrides: Partial<{ name: string; symbol: string; meta: string }> = {}) {
  return {
    signature: 'TokenCreated(uint256,address,uint256,address,string,string,string)',
    parameters: [
      { type: 'uint256' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'string' },
      { type: 'string' },
      { type: 'string' },
    ],
    values: [
      1_700_000_000n,
      creator,
      7n,
      token,
      overrides.name ?? 'Fixture Token',
      overrides.symbol ?? 'FIX',
      overrides.meta ?? 'ipfs://fixture',
    ],
  } satisfies EventFixture;
}

function event(signature: string, parameters: readonly AbiParameter[], values: readonly unknown[]) {
  return { signature, parameters, values } satisfies EventFixture;
}

function receipt(logs: readonly unknown[]) {
  return {
    transactionHash,
    blockHash,
    blockNumber: '0x10',
    transactionIndex: '0x1',
    from: creator,
    to: FLAP_BSC_MAINNET_DEPLOYMENT.portal,
    contractAddress: null,
    cumulativeGasUsed: '0x100',
    gasUsed: '0x80',
    status: '0x1',
    logs,
  };
}

class EventJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-event-fixture';
  readonly calls: Array<{ method: string; params: readonly unknown[] }> = [];

  constructor(
    readonly receiptValue: unknown,
    readonly returnedBlockHash = blockHash,
  ) {}

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    this.calls.push({ method, params });
    if (method === 'eth_getTransactionReceipt') return this.receiptValue as T;
    if (method === 'eth_getBlockByNumber') {
      return {
        number: '0x10',
        hash: this.returnedBlockHash,
        parentHash,
        timestamp: '0x65',
      } as T;
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

function fixture(logs: readonly unknown[], returnedBlockHash = blockHash) {
  const transport = new EventJsonRpcTransport(receipt(logs), returnedBlockHash);
  const adapter = new EvmLedgerAdapter(
    {
      id: 'bsc-rpc',
      chainId: 56,
      chainName: 'BNB Smart Chain',
      snapshotBlockTag: 'finalized',
    },
    transport,
  );
  const ledger = new EvidenceLedger();
  return {
    ledger,
    transport,
    inspect: () =>
      inspectFlapEventTransaction({
        adapter,
        token,
        transactionHash,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: async (item, sources = [], snapshot) =>
          ledger.add(item, sources, snapshot).evidence,
      }),
  };
}

describe('Flap transaction-local event inspection', () => {
  it('normalizes creation and explicit configuration from one pinned receipt', async () => {
    const curve = `0x${'d'.repeat(40)}`;
    const logs = [
      eventLog(tokenCreated(), 0),
      eventLog(
        event(
          'TokenCurveSetV2(address,uint256,uint256,uint256)',
          [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
          [token, 10n, 20n, 300n],
        ),
        2,
      ),
      eventLog(
        event(
          'TokenCurveSet(address,address,uint256)',
          [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
          [token, curve, 18n],
        ),
        1,
      ),
      eventLog(
        event(
          'FlapTokenAsymmetricTaxSet(address,uint256,uint256)',
          [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
          [token, 300n, 700n],
        ),
        3,
      ),
      eventLog(
        event(
          'TokenDexPreferenceSet(address,uint8,uint8)',
          [{ type: 'address' }, { type: 'uint8' }, { type: 'uint8' }],
          [token, 2, 1],
        ),
        4,
      ),
    ];
    const result = await fixture(logs).inspect();

    expect(result.transactionKind).toBe('CREATION_CONFIGURATION');
    expect(result.creation).toMatchObject({
      creator,
      token,
      name: 'Fixture Token',
      symbol: 'FIX',
      metadataUri: 'ipfs://fixture',
      position: { blockNumber: '16', logIndex: '0' },
    });
    expect(result.configuration).toMatchObject({
      curveAddress: { value: { state: 'known', value: curve }, source: 'EVENT' },
      curveParameter: { value: { state: 'known', value: '18' }, source: 'EVENT' },
      virtualQuoteReserve: { value: { state: 'known', value: '10' }, source: 'EVENT' },
      virtualBaseReserve: { value: { state: 'known', value: '20' }, source: 'EVENT' },
      virtualLiquiditySquared: { value: { state: 'known', value: '300' }, source: 'EVENT' },
      buyTaxBps: { value: { state: 'known', value: '300' }, source: 'EVENT' },
      sellTaxBps: { value: { state: 'known', value: '700' }, source: 'EVENT' },
      dexId: { value: { state: 'known', value: 'DEX2' }, source: 'EVENT' },
      lpFeeProfile: { value: { state: 'known', value: 'LOW' }, source: 'EVENT' },
    });
    expect(result.decodedEventNames).toEqual([
      'TokenCreated',
      'TokenCurveSet',
      'TokenCurveSetV2',
      'FlapTokenAsymmetricTaxSet',
      'TokenDexPreferenceSet',
    ]);
    expect(result.evidence.at(-1)?.kind).toBe('DERIVED_FEATURE');
    expect(result.metadata.snapshot).toMatchObject({ ledger: 'EVM', blockHash });
  });

  it('applies versioned official defaults without fabricating unavailable curve state', async () => {
    const result = await fixture([eventLog(tokenCreated(), 0)]).inspect();

    expect(result.configuration).toMatchObject({
      curveAddress: {
        value: { state: 'unknown', reason: 'NOT_QUERIED' },
        source: 'OFFICIAL_DEFAULT',
      },
      curveParameter: {
        value: { state: 'known', value: '16000000000000000000' },
        source: 'OFFICIAL_DEFAULT',
      },
      virtualQuoteReserve: {
        value: { state: 'unknown', reason: 'NOT_QUERIED' },
        source: 'OFFICIAL_DEFAULT',
      },
      dexSupplyThreshold: {
        value: { state: 'known', value: '667000000000000000000000000' },
        source: 'OFFICIAL_DEFAULT',
      },
      buyTaxBps: { value: { state: 'known', value: '0' }, source: 'OFFICIAL_DEFAULT' },
      sellTaxBps: { value: { state: 'known', value: '0' }, source: 'OFFICIAL_DEFAULT' },
      dexId: { value: { state: 'known', value: 'DEX0' }, source: 'OFFICIAL_DEFAULT' },
    });
    expect(result.evidence.some((item) => item.sourceUri?.includes('docs.flap.sh'))).toBe(true);
  });

  it('marks legacy curve fields not applicable when V2 reserves are explicitly configured', async () => {
    const result = await fixture([
      eventLog(tokenCreated(), 0),
      eventLog(
        event(
          'TokenCurveSetV2(address,uint256,uint256,uint256)',
          [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
          [token, 10n, 20n, 300n],
        ),
        1,
      ),
    ]).inspect();

    expect(result.configuration).toMatchObject({
      curveAddress: {
        value: { state: 'unknown', reason: 'NOT_APPLICABLE' },
        source: 'NOT_APPLICABLE',
      },
      curveParameter: {
        value: { state: 'unknown', reason: 'NOT_APPLICABLE' },
        source: 'NOT_APPLICABLE',
      },
      virtualQuoteReserve: { value: { state: 'known', value: '10' }, source: 'EVENT' },
    });
  });

  it('captures launch and pool migration facts without inferring missing counterparts', async () => {
    const logs = [
      eventLog(
        event(
          'LaunchedToDEX(address,address,uint256,uint256)',
          [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
          [token, pool, 500n, 25n],
        ),
        0,
      ),
      eventLog(
        event(
          'TokenPoolInfoUpdated(address,(address,uint24,uint8,uint64))',
          [
            { type: 'address' },
            {
              type: 'tuple',
              components: [
                { name: 'pool', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'poolType', type: 'uint8' },
                { name: 'unused', type: 'uint64' },
              ],
            },
          ],
          [token, { pool, fee: 2_500, poolType: 1, unused: 0n }],
        ),
        1,
      ),
    ];
    const result = await fixture(logs).inspect();

    expect(result.transactionKind).toBe('MIGRATION');
    expect(result.configuration).toBeNull();
    expect(result.migration).toMatchObject({
      launchedToDex: { pool, tokenAmount: '500', quoteAmount: '25' },
      poolConfiguration: { pool, fee: '2500', poolTypeCode: '1' },
    });
  });

  it('returns negative Evidence when the receipt has no supported event for the token', async () => {
    const result = await fixture([
      {
        ...eventLog(tokenCreated(), 0),
        topics: [unknownTopic],
        data: '0x',
      },
    ]).inspect();

    expect(result.platformMatch).toEqual({ state: 'known', value: false });
    expect(result.transactionKind).toBe('UNRECOGNIZED');
    expect(result.unrecognizedPortalLogCount).toBe(1);
    expect(result.evidence.map((item) => item.kind)).toEqual(['RECEIPT', 'NEGATIVE_EVIDENCE']);
  });

  it('keeps future enumerations Unknown while retaining their event Evidence', async () => {
    const logs = [
      eventLog(tokenCreated(), 0),
      eventLog(
        event(
          'TokenMigratorSet(address,uint8)',
          [{ type: 'address' }, { type: 'uint8' }],
          [token, 99],
        ),
        1,
      ),
      eventLog(
        event(
          'TokenVersionSet(address,uint8)',
          [{ type: 'address' }, { type: 'uint8' }],
          [token, 99],
        ),
        2,
      ),
    ];
    const result = await fixture(logs).inspect();

    expect(result.configuration?.migratorType.value).toMatchObject({
      state: 'unknown',
      reason: 'UNSUPPORTED',
    });
    expect(result.configuration?.tokenVersion.value).toMatchObject({
      state: 'unknown',
      reason: 'UNSUPPORTED',
    });
    expect(result.configuration?.migratorType.evidenceIds).toHaveLength(1);
  });

  it('rejects duplicate creation facts and inconsistent replay placement', async () => {
    await expect(
      fixture([eventLog(tokenCreated(), 0), eventLog(tokenCreated(), 1)]).inspect(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      fixture([eventLog(tokenCreated(), 0, { blockHash: `0x${'8'.repeat(64)}` })]).inspect(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      fixture([eventLog(tokenCreated(), 0, { data: '0x' })]).inspect(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      fixture([eventLog(tokenCreated(), 0, { removed: true })]).inspect(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      fixture([eventLog(tokenCreated(), 0)], `0x${'7'.repeat(64)}`).inspect(),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
