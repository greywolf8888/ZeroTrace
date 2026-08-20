import { describe, expect, it, vi } from 'vitest';

import {
  EvmLedgerAdapter,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import { createEvidence, EvidenceLedger } from '@zerotrace/evidence';
import {
  quoteFlapPensionEntryScenarios,
  PANCAKE_V2_BSC_DEPLOYMENT,
} from '@zerotrace/platform-adapters';
import {
  unknownValue,
  type AnalysisSnapshot,
  type Evidence,
  type FlapPancakeV2PensionEntryResult,
} from '@zerotrace/schemas';
import { encodeAbiParameters } from 'viem';

import { PostgresFlapPensionEntryReportRepository } from './flap-pension-entry-reports.js';

describe('Postgres Flap pension entry Scenario Report repository', () => {
  it('rejects invalid reports and lookup identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresFlapPensionEntryReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as FlapPancakeV2PensionEntryResult)).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_INVALID',
    });
    await expect(repository.latest('invalid')).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks both the report table and migration marker', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ table_name: 'flap_pension_entry_reports', migration_applied: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresFlapPensionEntryReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'FLAP_PENSION_ENTRY_REPORT_NOT_INITIALIZED',
    });
  });

  it('keeps missing reports undefined and maps unavailable storage honestly', async () => {
    const token = `0x${'a'.repeat(40)}`;
    const empty = PostgresFlapPensionEntryReportRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(empty.get(`per_${'a'.repeat(24)}`)).resolves.toBeUndefined();
    await expect(empty.latest(token)).resolves.toBeUndefined();

    const down = PostgresFlapPensionEntryReportRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      end: vi.fn(),
    });
    await expect(down.get(`per_${'a'.repeat(24)}`)).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
    });
    await expect(down.latest(token)).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
    });
    await expect(down.health()).resolves.toMatchObject({
      errorCode: 'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
    });
  });
});

const tokenAddress = `0x${'a'.repeat(40)}`;
const poolAddress = `0x${'b'.repeat(40)}`;
const quoteAddress = `0x${'c'.repeat(40)}`;
const zeroBytes32 = `0x${'0'.repeat(64)}` as const;
const pancakeQuoteReserve = 1_000n * 10n ** 18n;
const pancakeTokenReserve = 1_000_000n * 10n ** 18n;

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

function encodeFlapV8Safe() {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
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
        status: 4,
        reserve: 100n,
        circulatingSupply: 500n,
        price: 200n,
        tokenVersion: 6,
        r: 10n,
        h: 20n,
        k: 300n,
        dexSupplyThresh: 1_000n,
        quoteTokenAddress: quoteAddress,
        nativeToQuoteSwapEnabled: true,
        extensionID: zeroBytes32,
        buyTaxRate: 300n,
        sellTaxRate: 700n,
        pool: poolAddress,
        progress: 500_000_000_000_000_000n,
        lpFeeProfile: 1,
        dexId: 0,
      },
    ],
  );
}

class FlapJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-fixture';
  readonly #callResults: unknown[];

  constructor(callResults: unknown[]) {
    this.#callResults = [...callResults];
  }

  async request<T>(method: string, _params: readonly unknown[] = []): Promise<T> {
    if (method === 'eth_getBlockByNumber') {
      return {
        number: '0x10',
        hash: `0x${'1'.repeat(64)}`,
        parentHash: `0x${'2'.repeat(64)}`,
        timestamp: '0x65',
      } as T;
    }
    if (method === 'eth_getCode') return '0x6000' as T;
    if (method === 'eth_call') {
      const value = this.#callResults.shift();
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

function pensionBehavior(evidence: EvidenceLedger) {
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
  const evidenceItems: Evidence[] = [coverage, candidateEvidence, terminal];
  return {
    wallet,
    evidenceItems,
    report: {
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
        modelVersion: 'evm-pension-candidate-discovery-v1.0.0' as const,
        confidence: 0.8,
        evidenceIds: evidenceItems.map((item) => item.id).sort(),
      },
    },
  };
}

function reportRow(values: readonly unknown[]) {
  return {
    id: values[0],
    chain_id: values[1],
    token_address: values[2],
    pension_report_id: values[3],
    pension_wallet: values[4],
    block_number: values[5],
    snapshot_hash: values[6],
    result_hash: values[7],
    report: values[8],
    terminal_evidence_id: values[9],
    evidence_ids: values[10],
    source_set: values[11],
    model_version: values[12],
    captured_at: values[13],
    created_at: values[13],
  };
}

describe('Postgres Flap pension entry report writes', () => {
  it('writes, replays, and lists the latest report without inventing missing rows', async () => {
    const inputs = [100n * 10n ** 18n, 1_000n * 10n ** 18n];
    const transport = new FlapJsonRpcTransport([
      encodeFlapV8Safe(),
      encodeAddress(PANCAKE_V2_BSC_DEPLOYMENT.factory),
      encodeAddress(quoteAddress),
      encodeAddress(tokenAddress),
      encodeReserves(pancakeQuoteReserve, pancakeTokenReserve),
      encodeAddress(poolAddress),
      encodeAddress(PANCAKE_V2_BSC_DEPLOYMENT.factory),
      encodeUint8(18),
      encodeUint8(18),
      ...inputs.map((input) =>
        encodeAmountsOut(
          input,
          pancakeV2AmountOut(input, pancakeQuoteReserve, pancakeTokenReserve),
        ),
      ),
    ]);
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
    const behavior = pensionBehavior(evidence);
    const report = await quoteFlapPensionEntryScenarios({
      adapter,
      token: tokenAddress,
      quoteInputs: ['100', '1000'],
      pensionWallet: behavior.wallet,
      behaviorReport: behavior.report,
      behaviorReportId: `pcr_${'1'.repeat(24)}`,
      behaviorResultHash: '1'.repeat(64),
      behaviorEvidence: behavior.evidenceItems,
      writeEvidence: async (item, sources = [], snapshot) =>
        evidence.add(item, sources, snapshot).evidence,
    });

    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO flap_pension_entry_reports')) {
        row ??= reportRow(values);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM flap_pension_entry_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresFlapPensionEntryReportRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });
    const first = await repository.put(report);
    await expect(repository.put(report)).resolves.toMatchObject({ id: first.id });
    await expect(repository.get(first.id)).resolves.toMatchObject({ id: first.id });
    await expect(repository.latest(tokenAddress)).resolves.toMatchObject({ id: first.id });
    expect(first.report.destinationTreatment).toBe('NON_ZERO_CUSTODY_ADDRESS');
    await repository.close();
  });
});
