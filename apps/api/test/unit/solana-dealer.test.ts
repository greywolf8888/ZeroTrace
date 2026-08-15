import { describe, expect, it, vi } from 'vitest';

import type { SqdFinalizedBlock, SqdPortalClient } from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import type {
  AnalysisSnapshot,
  Evidence,
  SolanaTransactionIntelligenceReport,
} from '@zerotrace/schemas';

const { querySolanaTransactionMock } = vi.hoisted(() => ({
  querySolanaTransactionMock: vi.fn(),
}));

vi.mock('../../src/ledger-query.js', () => ({
  querySolanaTransaction: querySolanaTransactionMock,
}));

import {
  captureSolanaDealerCampaign,
  deriveSolanaDealerHistoryCoverage,
  type SolanaDealerCaptureInput,
} from '../../src/solana-dealer.js';

const mint = 'M'.repeat(32);
const capturedAt = '2026-08-14T00:00:00.000Z';

function snapshot(slot: string): AnalysisSnapshot {
  return {
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    slot,
    blockhash: '1'.repeat(32),
    parentSlot: String(Math.max(0, Number(slot) - 1)),
    previousBlockhash: '2'.repeat(32),
    commitment: 'finalized',
    blockTimestamp: capturedAt,
    capturedAt,
    providerVersions: { 'solana-rpc:test': 'solana-json-rpc' },
    adapterVersions: { solana: 'test' },
    configHash: 'a'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-empty-v1',
  };
}

function block(slot: number, signature?: string, transactionIndex = 0): SqdFinalizedBlock {
  return {
    header: {
      number: slot,
      hash: '1'.repeat(32),
      parentHash: '2'.repeat(32),
      timestamp: 1_755_120_000,
    },
    ...(signature === undefined
      ? {}
      : {
          transactions: [{ signatures: [signature], transactionIndex }],
          tokenBalances: [
            {
              transactionIndex,
              account: 'A'.repeat(32),
              preAmount: '1',
              postAmount: '2',
              preMint: mint,
              postMint: mint,
            },
          ],
        }),
  };
}

function source(
  blocks: readonly SqdFinalizedBlock[],
  _fromSlot = 100,
  toSlot = 101,
  dataset: 'solana-mainnet' | 'ethereum-mainnet' = 'solana-mainnet',
  completion: 'REQUESTED_RANGE_COMPLETE' | 'SOURCE_HEAD_REACHED' = 'REQUESTED_RANGE_COMPLETE',
): SqdPortalClient {
  return {
    dataset,
    async readFinalizedRange(
      request: Parameters<SqdPortalClient['readFinalizedRange']>[0],
      onBlock: Parameters<SqdPortalClient['readFinalizedRange']>[1],
    ) {
      const selected = blocks.filter(
        (item) => item.header.number >= request.fromBlock && item.header.number <= request.toBlock,
      );
      for (const item of selected) await onBlock(item);
      return {
        dataset: 'solana-mainnet',
        completion,
        requestedFrom: request.fromBlock,
        requestedTo: request.toBlock,
        lastBlock: selected.at(-1)?.header.number ?? null,
        nextBlock:
          completion === 'SOURCE_HEAD_REACHED'
            ? (selected.at(-1)?.header.number ?? request.fromBlock) + 1
            : request.toBlock + 1,
        finalizedHead: toSlot,
        blocks: selected.length,
        requests: 1,
        retries: 0,
      };
    },
  } as unknown as SqdPortalClient;
}

function adapter(commitment: 'finalized' | 'confirmed' = 'finalized') {
  return {
    config: { commitment },
    readAnchorAt: vi.fn(async (slot: string) => ({
      snapshot: snapshot(slot),
    })),
  } as unknown as SolanaDealerCaptureInput['adapter'];
}

function input(overrides: Partial<SolanaDealerCaptureInput> = {}): SolanaDealerCaptureInput {
  const ledger = new EvidenceLedger();
  return {
    mint,
    fromSlot: '100',
    toSlot: '101',
    maxTransactions: 10,
    source: source([block(100), block(101)]),
    adapter: adapter(),
    writeEvidence: async (evidence: Evidence, sourceEvidenceIds = [], snapshotValue) => {
      const existing = ledger.get(evidence.id);
      if (existing !== undefined) return existing.evidence;
      return ledger.add(evidence, sourceEvidenceIds, snapshotValue).evidence;
    },
    now: () => capturedAt,
    ...overrides,
  };
}

describe('Solana dealer capture', () => {
  it('only calls a complete range historical when the range starts at a decoded mint', () => {
    const report = {
      metadata: { snapshot: snapshot('100') },
      facts: {
        transactionSemantics: {
          state: 'known',
          value: {
            assetFlows: [
              {
                flowKind: 'MINT',
                application: 'APPLIED',
                mint: { state: 'known', value: mint },
              },
            ],
          },
        },
      },
    } as unknown as SolanaTransactionIntelligenceReport;

    expect(
      deriveSolanaDealerHistoryCoverage({
        fromSlot: '100',
        sourceCompletion: 'REQUESTED_RANGE_COMPLETE',
        truncated: false,
        transactionReports: [report],
        mint,
      }),
    ).toBe(1);
    expect(
      deriveSolanaDealerHistoryCoverage({
        fromSlot: '101',
        sourceCompletion: 'REQUESTED_RANGE_COMPLETE',
        truncated: false,
        transactionReports: [report],
        mint,
      }),
    ).toBe(0);
    expect(
      deriveSolanaDealerHistoryCoverage({
        fromSlot: '100',
        sourceCompletion: 'SOURCE_HEAD_REACHED',
        truncated: false,
        transactionReports: [report],
        mint,
      }),
    ).toBe(0);
  });

  it('fails closed for the wrong dataset and non-finalized adapters', async () => {
    await expect(
      captureSolanaDealerCampaign(input({ source: source([], 100, 101, 'ethereum-mainnet') })),
    ).rejects.toMatchObject({
      code: 'SOLANA_DEALER_CAPTURE_NO_SOURCE',
    });

    await expect(
      captureSolanaDealerCampaign(input({ adapter: adapter('confirmed') })),
    ).rejects.toMatchObject({
      code: 'SOLANA_DEALER_CAPTURE_INVALID',
    });
  });

  it('keeps a complete finalized range with no observations explicitly Unknown', async () => {
    const result = await captureSolanaDealerCampaign(input());

    expect(result.candidateCount).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.transactionReports).toEqual([]);
    expect(result.report.status).toBe('UNKNOWN');
    expect(result.report.tokenFlowEdges).toEqual([]);
    expect(result.report.dataCoverage).toBe(1);
    expect(result.report.historyCoverage).toBe(0);
    expect(result.report.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('splits wide finalized ranges into bounded SQD windows', async () => {
    const blocks = Array.from({ length: 33 }, (_, index) => block(100 + index));
    const boundedSource = source(blocks, 100, 132);
    const readFinalizedRange = vi.spyOn(boundedSource, 'readFinalizedRange');

    const result = await captureSolanaDealerCampaign(
      input({ source: boundedSource, fromSlot: '100', toSlot: '132' }),
    );

    expect(result.sourceSummary.completion).toBe('REQUESTED_RANGE_COMPLETE');
    expect(result.sourceSummary.blocks).toBe(33);
    expect(readFinalizedRange).toHaveBeenCalledTimes(3);
    expect(
      readFinalizedRange.mock.calls.map(([request]) => [request.fromBlock, request.toBlock]),
    ).toEqual([
      [100, 115],
      [116, 131],
      [132, 132],
    ]);
  });

  it('rejects a candidate whose finalized transaction report is incomplete', async () => {
    const signature = '3'.repeat(64);
    querySolanaTransactionMock.mockResolvedValueOnce({});

    await expect(
      captureSolanaDealerCampaign(
        input({
          source: source([block(100, signature), block(101)], 100, 101),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'SOLANA_DEALER_CAPTURE_INCOMPLETE',
    });
    expect(querySolanaTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ normalizedId: signature }),
      expect.anything(),
      {},
    );
  });

  it('passes the caller signal through exact transaction expansion', async () => {
    const signature = '4'.repeat(64);
    const controller = new AbortController();
    querySolanaTransactionMock.mockReset().mockResolvedValue({});

    await expect(
      captureSolanaDealerCampaign(
        input({
          signal: controller.signal,
          source: source([block(100, signature), block(101)]),
        }),
      ),
    ).rejects.toMatchObject({ code: 'SOLANA_DEALER_CAPTURE_INCOMPLETE' });
    expect(querySolanaTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ normalizedId: signature }),
      expect.anything(),
      { signal: controller.signal },
    );
  });

  it('rejects unsafe decimal slots before opening a provider stream', async () => {
    await expect(
      captureSolanaDealerCampaign(
        input({ fromSlot: '9007199254740992', toSlot: '9007199254740992' }),
      ),
    ).rejects.toThrow('Solana slots must fit the JSON-RPC safe integer range.');
  });

  it('keeps a source-head-truncated range partial instead of promoting completeness', async () => {
    const result = await captureSolanaDealerCampaign(
      input({ source: source([block(100)], 100, 101, 'solana-mainnet', 'SOURCE_HEAD_REACHED') }),
    );
    expect(result.truncated).toBe(false);
    expect(result.sourceSummary.completion).toBe('SOURCE_HEAD_REACHED');
    expect(result.report.status).toBe('UNKNOWN');
    expect(result.report.dataCoverage).toBe(0.5);
    expect(result.report.sourceCoverage).toBe(1);
    expect(result.report.campaign).toBeNull();
  });

  it('ignores unrelated and orphaned token balances and preserves provider coverage as Unknown', async () => {
    const signature = '8'.repeat(64);
    const unrelatedMint = 'N'.repeat(32);
    const orphanedAccount = 'B'.repeat(32);
    const candidateBlock = {
      ...block(100, signature),
      tokenBalances: [
        {
          transactionIndex: 0,
          account: 'A'.repeat(32),
          preAmount: '1',
          postAmount: '2',
          preMint: unrelatedMint,
          postMint: unrelatedMint,
        },
        {
          transactionIndex: 99,
          account: orphanedAccount,
          preAmount: '1',
          postAmount: '2',
          preMint: mint,
          postMint: mint,
        },
      ],
    } as SqdFinalizedBlock;
    const sparseAdapter = {
      ...adapter(),
      readAnchorAt: vi.fn(async (slot: string) => ({
        snapshot: { ...snapshot(slot), providerVersions: {} },
      })),
    } as unknown as SolanaDealerCaptureInput['adapter'];

    const withNow = input({ source: source([candidateBlock]), adapter: sparseAdapter });
    const { now, ...withoutNow } = withNow;
    expect(now).toBeTypeOf('function');
    const result = await captureSolanaDealerCampaign(withoutNow);

    expect(result.candidateCount).toBe(0);
    expect(result.report.status).toBe('UNKNOWN');
    expect(result.report.sourceCoverage).toBe(0.5);
  });

  it('sorts same-slot candidates by transaction index and signature before bounded expansion', async () => {
    const first = '9'.repeat(64);
    const second = 'C'.repeat(64);
    const third = 'D'.repeat(64);
    querySolanaTransactionMock.mockReset().mockResolvedValue({});

    await expect(
      captureSolanaDealerCampaign(
        input({
          source: source([block(100, first, 0), block(100, second, 1), block(100, third, 1)]),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'SOLANA_DEALER_CAPTURE_INCOMPLETE',
    });
  });

  it('bounds candidate transaction expansion and records truncation before report validation', async () => {
    const first = '6'.repeat(64);
    const second = '7'.repeat(64);
    querySolanaTransactionMock.mockReset().mockResolvedValue({});
    await expect(
      captureSolanaDealerCampaign(
        input({
          maxTransactions: 1,
          source: source([block(100, first), block(101, second)]),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'SOLANA_DEALER_CAPTURE_INCOMPLETE',
    });
    expect(querySolanaTransactionMock).toHaveBeenCalledTimes(1);
  });
});
