import { describe, expect, it, vi } from 'vitest';

import type { SqdFinalizedBlock, SqdPortalClient } from '@zerotrace/chain-adapters';
import type { AnalysisSnapshot, Evidence } from '@zerotrace/schemas';

const { querySolanaTransactionMock } = vi.hoisted(() => ({
  querySolanaTransactionMock: vi.fn(),
}));

vi.mock('../../src/ledger-query.js', () => ({
  querySolanaTransaction: querySolanaTransactionMock,
}));

import {
  captureSolanaDealerCampaign,
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
  fromSlot = 100,
  toSlot = 101,
  dataset: 'solana-mainnet' | 'ethereum-mainnet' = 'solana-mainnet',
  completion: 'REQUESTED_RANGE_COMPLETE' | 'SOURCE_HEAD_REACHED' = 'REQUESTED_RANGE_COMPLETE',
): SqdPortalClient {
  return {
    dataset,
    async readFinalizedRange(
      _request: Parameters<SqdPortalClient['readFinalizedRange']>[0],
      onBlock: Parameters<SqdPortalClient['readFinalizedRange']>[1],
    ) {
      for (const item of blocks) await onBlock(item);
      return {
        dataset: 'solana-mainnet',
        completion,
        requestedFrom: fromSlot,
        requestedTo: toSlot,
        lastBlock: toSlot,
        nextBlock: toSlot + 1,
        finalizedHead: toSlot,
        blocks: blocks.length,
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
  return {
    mint,
    fromSlot: '100',
    toSlot: '101',
    maxTransactions: 10,
    source: source([block(100), block(101)]),
    adapter: adapter(),
    writeEvidence: async (evidence: Evidence) => evidence,
    now: () => capturedAt,
    ...overrides,
  };
}

describe('Solana dealer capture', () => {
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
