import { describe, expect, it } from 'vitest';

import {
  createEvmAssetTransferObservation,
  decodeEvmAssetTransfers,
  deriveFundingSettlementReport,
} from './index.js';

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const USDT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ROOT = '0x1111111111111111111111111111111111111111';
const MID = '0x2222222222222222222222222222222222222222';
const FUNDER = '0x3333333333333333333333333333333333333333';
const W1 = '0x4444444444444444444444444444444444444444';
const W2 = '0x5555555555555555555555555555555555555555';
const POOL = '0x6666666666666666666666666666666666666666';
const SERVICE = '0x7777777777777777777777777777777777777777';
const CEX = '0x8888888888888888888888888888888888888888';
const SETTLEMENT = '0x9999999999999999999999999999999999999999';
const SWEEP = '0xabababababababababababababababababababab';

function hashFor(value: number): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '200',
  blockHash: hashFor(200),
  finality: 'finalized' as const,
  capturedAt: '2026-08-14T00:00:00.000Z',
  providerVersions: { rpc: 'test-rpc-v1' },
  adapterVersions: { test: '1.0.0' },
  configHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  entityModelVersion: 'entity-test-v1',
  labelSnapshot: 'labels-test-v1',
};

let evidenceSequence = 0;
function evidenceId(): string {
  evidenceSequence += 1;
  return `ev_${evidenceSequence.toString().padStart(24, '0')}`;
}

let transactionSequence = 0;
function transfer(input: {
  asset: string;
  source: string;
  destination: string;
  block: number;
  amount?: string;
  transaction?: number;
}): ReturnType<typeof createEvmAssetTransferObservation> {
  transactionSequence += 1;
  return createEvmAssetTransferObservation({
    chainId: 'eip155:56',
    asset: input.asset,
    source: input.source,
    destination: input.destination,
    amountAtomic: input.amount ?? '10',
    blockNumber: String(input.block),
    blockHash: hashFor(input.block),
    transactionHash: hashFor(input.transaction ?? 10_000 + transactionSequence),
    transactionIndex: '0',
    eventIndex: '0',
    observedAt: '2026-08-14T00:00:00.000Z',
    execution: 'SUCCESS',
    finality: 'FINAL',
    evidenceIds: [evidenceId()],
  });
}

function makeReport(
  transfers: readonly ReturnType<typeof createEvmAssetTransferObservation>[],
  maxHops = 3,
) {
  return deriveFundingSettlementReport({
    token: TOKEN,
    fromBlock: '90',
    toBlock: '200',
    snapshot,
    transfers,
    focusWalletIds: [W1, W2],
    serviceHubIds: [SERVICE],
    cexEndpointIds: [CEX],
    maxHops,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    sourceSet: ['exact-rpc@bsc', 'sqd:binance-mainnet'],
  });
}

function graphTransfers() {
  const items = [
    transfer({ asset: USDT, source: FUNDER, destination: W1, block: 95 }),
    transfer({ asset: USDT, source: FUNDER, destination: W2, block: 96 }),
    transfer({ asset: USDT, source: FUNDER, destination: W1, block: 97 }),
    transfer({ asset: USDT, source: ROOT, destination: MID, block: 98 }),
    transfer({ asset: USDT, source: MID, destination: W1, block: 99 }),
    transfer({ asset: USDT, source: SERVICE, destination: W2, block: 94 }),
    transfer({ asset: TOKEN, source: POOL, destination: W1, block: 120 }),
    transfer({ asset: TOKEN, source: POOL, destination: W2, block: 121 }),
    transfer({ asset: TOKEN, source: W1, destination: POOL, block: 130, transaction: 20_000 }),
    transfer({ asset: USDT, source: POOL, destination: W1, block: 130, transaction: 20_000 }),
    transfer({ asset: TOKEN, source: W1, destination: CEX, block: 131 }),
    transfer({ asset: USDT, source: W1, destination: SETTLEMENT, block: 132 }),
    transfer({ asset: USDT, source: W2, destination: SETTLEMENT, block: 133 }),
    transfer({ asset: USDT, source: W1, destination: SWEEP, block: 134 }),
    transfer({ asset: USDT, source: W1, destination: SWEEP, block: 135 }),
  ];
  return items;
}

describe('funding and settlement engine', () => {
  it('derives bounded funding, settlement, and graph patterns with replay-stable output', () => {
    const transfers = graphTransfers();
    const report = makeReport(transfers);
    const replay = makeReport([...transfers].reverse());

    expect(report.resultHash).toBe(replay.resultHash);
    expect(report.fundingEdges.map((edge) => edge.relation)).toEqual(
      expect.arrayContaining(['FIRST_FUNDER', 'COMMON_FUNDER', 'SEQUENTIAL_FUNDER']),
    );
    expect(report.settlementEdges.map((edge) => edge.relation)).toEqual(
      expect.arrayContaining(['SELL_PROCEEDS', 'CEX_DEPOSIT', 'SWEEP', 'SETTLEMENT_CONVERGENCE']),
    );
    expect(report.patterns.map((pattern) => pattern.kind)).toEqual(
      expect.arrayContaining(['RADIAL', 'SEQUENTIAL', 'SWEEP', 'SETTLEMENT_CONVERGENCE']),
    );
    expect(report.suppressedPaths.map((path) => path.reason)).toContain('SERVICE_HUB');
    expect(report.fundingEdges.some((edge) => edge.source === SERVICE)).toBe(false);
    expect(report.drilldown.length).toBe(
      new Set(transfers.map((item) => item.transactionHash)).size,
    );
    expect(report.status).toBe('COMPLETE');
  });

  it('does not expand a sequential path beyond the configured hop bound', () => {
    const bounded = [
      transfer({ asset: USDT, source: ROOT, destination: MID, block: 95 }),
      transfer({ asset: USDT, source: MID, destination: FUNDER, block: 96 }),
      transfer({ asset: USDT, source: FUNDER, destination: W1, block: 97 }),
      transfer({ asset: TOKEN, source: POOL, destination: W1, block: 120 }),
    ];
    expect(
      makeReport(bounded, 1).fundingEdges.some((edge) => edge.relation === 'SEQUENTIAL_FUNDER'),
    ).toBe(false);
    expect(
      makeReport(bounded, 3).fundingEdges.some((edge) => edge.relation === 'SEQUENTIAL_FUNDER'),
    ).toBe(true);
  });

  it('records a service boundary instead of propagating through it', () => {
    const report = makeReport([
      transfer({ asset: USDT, source: SERVICE, destination: MID, block: 95 }),
      transfer({ asset: USDT, source: MID, destination: W1, block: 96 }),
      transfer({ asset: TOKEN, source: POOL, destination: W1, block: 120 }),
    ]);
    expect(report.fundingEdges.some((edge) => edge.relation === 'SEQUENTIAL_FUNDER')).toBe(false);
    expect(report.suppressedPaths).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'SERVICE_HUB' })]),
    );
  });

  it('does not turn endpoint convergence into a common settlement pattern', () => {
    const report = makeReport([
      transfer({ asset: TOKEN, source: W1, destination: CEX, block: 130 }),
      transfer({ asset: TOKEN, source: W2, destination: CEX, block: 131 }),
      transfer({ asset: USDT, source: POOL, destination: W1, block: 120 }),
    ]);
    expect(report.settlementEdges).toEqual(
      expect.arrayContaining([expect.objectContaining({ relation: 'CEX_DEPOSIT' })]),
    );
    expect(report.patterns.some((pattern) => pattern.kind === 'SETTLEMENT_CONVERGENCE')).toBe(
      false,
    );
  });

  it('reports unknown when every exact observation is failed or provisional', () => {
    const failed = transfer({ asset: USDT, source: FUNDER, destination: W1, block: 95 });
    const report = makeReport([{ ...failed, execution: 'FAILED', finality: 'PROVISIONAL' }]);
    expect(report.status).toBe('UNKNOWN');
    expect(report.fundingEdges).toHaveLength(0);
    expect(report.drilldown).toHaveLength(1);
  });

  it('decodes only exact native value and canonical ERC-20 Transfer logs', () => {
    const transactionHash = hashFor(500);
    const blockHash = hashFor(100);
    const capture = {
      transaction: {
        hash: transactionHash,
        blockHash,
        blockNumber: '0x64',
        transactionIndex: '0x0',
        from: ROOT,
        to: W1,
        value: '0x1',
        nonce: '0x0',
        gas: '0x5208',
        input: '0x',
        raw: {},
      },
      receipt: {
        transactionHash,
        blockHash,
        blockNumber: '0x64',
        transactionIndex: '0x0',
        from: ROOT,
        to: W1,
        contractAddress: null,
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        status: '0x1' as const,
        logCount: 1,
        raw: {
          logs: [
            {
              address: TOKEN,
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                `0x${ROOT.slice(2).padStart(64, '0')}`,
                `0x${W1.slice(2).padStart(64, '0')}`,
              ],
              data: `0x${'0'.repeat(63)}2`,
              logIndex: '0x0',
            },
          ],
        },
      },
      snapshot: {
        ...snapshot,
        blockNumber: '100',
        blockHash,
      },
      transactionEvidenceIds: [evidenceId()],
      logEvidenceIds: { '0': evidenceId() },
    };
    const transfers = decodeEvmAssetTransfers(capture);
    expect(transfers).toHaveLength(2);
    expect(transfers.map((item) => [item.asset, item.amountAtomic])).toEqual(
      expect.arrayContaining([
        ['NATIVE', '1'],
        [TOKEN, '2'],
      ]),
    );
  });

  it('rejects mismatched transaction and receipt identities', () => {
    const transactionHash = hashFor(500);
    const blockHash = hashFor(100);
    const capture = {
      transaction: {
        hash: transactionHash,
        blockHash,
        blockNumber: '0x64',
        transactionIndex: '0x0',
        from: ROOT,
        to: W1,
        value: '0x0',
        nonce: '0x0',
        gas: '0x5208',
        input: '0x',
        raw: {},
      },
      receipt: {
        transactionHash: hashFor(501),
        blockHash,
        blockNumber: '0x64',
        transactionIndex: '0x0',
        from: ROOT,
        to: W1,
        contractAddress: null,
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        status: '0x1' as const,
        logCount: 0,
        raw: { logs: [] },
      },
      snapshot: { ...snapshot, blockNumber: '100', blockHash },
      transactionEvidenceIds: [evidenceId()],
    };
    expect(() => decodeEvmAssetTransfers(capture)).toThrow(
      'Transaction and receipt identities disagree.',
    );
  });
});
