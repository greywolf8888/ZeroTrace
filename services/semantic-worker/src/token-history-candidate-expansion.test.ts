import { describe, expect, it, vi } from 'vitest';

import type { SqdFinalizedBlock } from '@zerotrace/chain-adapters';

import { captureCandidateNativeTransfers } from './token-history-backfill-handler.js';

const hash = (digit: string): string => `0x${digit.repeat(64)}`;
const address = (digit: string): string => `0x${digit.repeat(40)}`;

const blockHash = hash('1');
const parentHash = hash('0');
const blockNumber = 100;
const focusWallet = address('a');
const recipient = address('b');
const funder = address('c');

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  finality: 'finalized' as const,
  blockNumber: String(blockNumber),
  blockHash,
  parentBlockHash: parentHash,
  blockTimestamp: '2026-08-14T00:00:00.000Z',
  capturedAt: '2026-08-14T00:00:00.000Z',
  configHash: hash('2'),
  labelSnapshot: 'labels-unapplied',
  adapterVersions: { test: '1' },
  providerVersions: { test: '1' },
  entityModelVersion: 'entity-model-unapplied',
};

function block(input: {
  transactions: readonly Record<string, unknown>[];
  traces: readonly Record<string, unknown>[];
  logs?: readonly Record<string, unknown>[];
}): SqdFinalizedBlock {
  return {
    header: {
      number: blockNumber,
      hash: blockHash,
      parentHash,
      timestamp: 1_755_120_000,
    },
    transactions: input.transactions,
    traces: input.traces,
    ...(input.logs === undefined ? {} : { logs: input.logs }),
  } as unknown as SqdFinalizedBlock;
}

function context(
  value: SqdFinalizedBlock,
  completion: 'REQUESTED_RANGE_COMPLETE' | 'SOURCE_HEAD_REACHED' = 'REQUESTED_RANGE_COMPLETE',
) {
  const evidencePut = vi.fn(async (evidence: unknown) => ({
    evidence,
    sourceEvidenceIds: [],
    snapshot,
  }));
  const factPutMany = vi.fn(async (facts: readonly unknown[]) => [...facts]);
  const source = {
    dataset: 'binance-mainnet' as const,
    readFinalizedRange: vi.fn(
      async (_request: unknown, onBlock: (value: SqdFinalizedBlock) => void | Promise<void>) => {
        await onBlock(value);
        return {
          dataset: 'binance-mainnet' as const,
          completion,
          requestedFrom: blockNumber,
          requestedTo: blockNumber,
          lastBlock: blockNumber,
          nextBlock: blockNumber + 1,
          finalizedHead: blockNumber,
          blocks: 1,
          requests: 1,
          retries: 0,
        };
      },
    ),
  };
  const adapter = {
    readAnchorAt: vi.fn(async () => ({ snapshot })),
  };
  const artifacts = {
    put: vi.fn(async () => ({
      ref: 's3://test-artifacts/candidate.json#sha256=' + 'a'.repeat(64),
      bucket: 'test-artifacts',
      key: 'candidate.json',
      artifactHash: 'a'.repeat(64),
      payloadHash: 'b'.repeat(64),
      size: 1_024,
      created: true,
    })),
  };
  return {
    input: {
      source,
      adapter,
      report: {
        chainId: 'eip155:56',
        freshness: '2026-08-14T00:00:00.000Z',
        historyCoverage: 1,
      },
      focusWalletIds: [focusWallet],
      fromBlock: blockNumber,
      toBlock: blockNumber,
      artifacts,
      evidence: { put: evidencePut },
      facts: { putMany: factPutMany },
      maxRecords: 32,
    },
    source,
    adapter,
    artifacts,
    evidencePut,
    factPutMany,
  } as const;
}

function transaction(
  digit: string,
  transactionIndex: number,
  value: string,
  status: number,
  to: string | null = recipient,
) {
  return {
    hash: hash(digit),
    from: focusWallet,
    to,
    value,
    transactionIndex,
    status,
  };
}

function trace(
  transactionIndex: number,
  type: string,
  value: string | null,
  error: string | null = null,
) {
  return {
    transactionIndex,
    traceAddress: [],
    type,
    action: { from: funder, to: focusWallet, value },
    error,
  };
}

function transferLog(
  transactionHash: string,
  logIndex: number,
  asset: string,
  source: string,
  destination: string,
  amountHex: string,
) {
  return {
    transactionHash,
    transactionIndex: 0,
    logIndex,
    address: asset,
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      `0x${'0'.repeat(24)}${source.slice(2)}`,
      `0x${'0'.repeat(24)}${destination.slice(2)}`,
    ],
    data: `0x${amountHex.padStart(64, '0')}`,
  };
}

describe('candidate-scoped Token History expansion', () => {
  it('keeps an empty focus set and a source-head partial range explicit', async () => {
    const empty = context(block({ transactions: [], traces: [] }));
    const emptyResult = await captureCandidateNativeTransfers({
      ...empty.input,
      focusWalletIds: [],
    } as never);
    expect(emptyResult).toEqual({
      transfers: [],
      historyCoverage: 0,
      coverageScope: 'TRANSACTION_LOCAL',
      sourceSet: [],
      evidenceIds: [],
    });

    const partial = context(
      block({
        transactions: [transaction('3', 0, '0x0', 1)],
        traces: [],
      }),
      'SOURCE_HEAD_REACHED',
    );
    const partialResult = await captureCandidateNativeTransfers(partial.input as never);
    expect(partialResult.historyCoverage).toBe(0);
    expect(partialResult.coverageScope).toBe('TRANSACTION_LOCAL');
  });

  it('materializes successful top-level and internal native transfers with parent Evidence', async () => {
    const test = context(
      block({
        transactions: [transaction('3', 0, '0x10', 1)],
        traces: [trace(0, 'call', '0x20')],
      }),
    );

    const result = await captureCandidateNativeTransfers(test.input as never);

    expect(result.transfers).toHaveLength(2);
    expect(result.historyCoverage).toBe(1);
    expect(result.coverageScope).toBe('BOUNDED_RANGE');
    expect(result.sourceSet).toEqual(['sqd:binance-mainnet']);
    expect(result.evidenceIds).toHaveLength(2);
    expect(test.evidencePut).toHaveBeenCalledTimes(2);
    expect(test.factPutMany).toHaveBeenCalledTimes(1);
    expect(test.source.readFinalizedRange).toHaveBeenCalledWith(
      expect.objectContaining({
        requests: {
          transactions: [{ from: [focusWallet] }, { to: [focusWallet] }],
          logs: [
            {
              topic0: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
              topic1: [`0x${'0'.repeat(24)}${focusWallet.slice(2)}`],
            },
            {
              topic0: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
              topic2: [`0x${'0'.repeat(24)}${focusWallet.slice(2)}`],
            },
          ],
          traces: [
            { callFrom: [focusWallet], transaction: true },
            { callTo: [focusWallet], transaction: true },
          ],
        },
      }),
      expect.any(Function),
    );
  });

  it('materializes successful ERC-20 Transfer logs with dynamic asset identity', async () => {
    const token = address('d');
    const transactionHash = hash('3');
    const test = context(
      block({
        transactions: [],
        traces: [],
        logs: [transferLog(transactionHash, 7, token, funder, focusWallet, '2a')],
      }),
    );

    const result = await captureCandidateNativeTransfers(test.input as never);

    expect(result.transfers).toEqual([
      expect.objectContaining({
        asset: token,
        source: funder,
        destination: focusWallet,
        amountAtomic: '42',
        transactionHash,
        transactionIndex: '0',
        eventIndex: '7',
      }),
    ]);
    expect(result.evidenceIds).toHaveLength(1);
    expect(test.evidencePut).toHaveBeenCalledTimes(1);
    expect(test.factPutMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ factType: 'LOG' })]),
    );
  });

  it('keeps non-canonical Transfer-topic logs as Evidence without deriving a transfer', async () => {
    const token = address('d');
    const transactionHash = hash('3');
    const nonCanonical = transferLog(transactionHash, 8, token, funder, focusWallet, '2a');
    nonCanonical.topics.push(`0x${'e'.repeat(64)}`);
    const test = context(
      block({
        transactions: [],
        traces: [],
        logs: [nonCanonical],
      }),
    );

    const result = await captureCandidateNativeTransfers(test.input as never);

    expect(result.transfers).toEqual([]);
    expect(result.evidenceIds).toHaveLength(1);
    expect(test.evidencePut).toHaveBeenCalledTimes(1);
    expect(test.factPutMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ factType: 'LOG' })]),
    );
  });

  it('keeps zero, failed, errored, and non-call records as Evidence without deriving transfers', async () => {
    const test = context(
      block({
        transactions: [
          transaction('3', 0, '0x10', 1, null),
          transaction('4', 1, '0x10', 0),
          transaction('5', 2, '0x0', 1),
        ],
        traces: [
          trace(0, 'reward', '0x10'),
          trace(1, 'call', '0x10'),
          trace(2, 'call', '0x0', 'reverted'),
        ],
      }),
    );

    const result = await captureCandidateNativeTransfers(test.input as never);

    expect(result.transfers).toEqual([]);
    expect(result.evidenceIds).toHaveLength(6);
    expect(test.evidencePut).toHaveBeenCalledTimes(6);
    expect(test.factPutMany).toHaveBeenCalledTimes(1);
  });

  it('keeps successful traces with an absent optional call value as Evidence', async () => {
    const test = context(
      block({
        transactions: [transaction('3', 0, '0x0', 1)],
        traces: [trace(0, 'call', null)],
      }),
    );

    const result = await captureCandidateNativeTransfers(test.input as never);

    expect(result.transfers).toEqual([]);
    expect(result.evidenceIds).toHaveLength(2);
    expect(test.evidencePut).toHaveBeenCalledTimes(2);
    expect(test.factPutMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a trace whose transaction:true parent is absent', async () => {
    const test = context(
      block({
        transactions: [transaction('3', 0, '0x0', 1)],
        traces: [trace(1, 'call', '0x1')],
      }),
    );

    await expect(captureCandidateNativeTransfers(test.input as never)).rejects.toMatchObject({
      code: 'TOKEN_HISTORY_BACKFILL_EXPANSION_INVALID_RESPONSE',
      sourceRetryable: false,
    });
    expect(test.factPutMany).not.toHaveBeenCalled();
  });

  it('fails closed for an exact Snapshot mismatch, abort, and oversized focus set', async () => {
    const mismatch = context(
      block({
        transactions: [transaction('3', 0, '0x1', 1)],
        traces: [],
      }),
    );
    mismatch.adapter.readAnchorAt.mockResolvedValue({
      snapshot: { ...snapshot, blockHash: hash('9') },
    });
    await expect(captureCandidateNativeTransfers(mismatch.input as never)).rejects.toMatchObject({
      code: 'TOKEN_HISTORY_BACKFILL_EXPANSION_SNAPSHOT_MISMATCH',
      sourceRetryable: true,
    });

    const aborted = context(
      block({
        transactions: [],
        traces: [],
      }),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      captureCandidateNativeTransfers({ ...aborted.input, signal: controller.signal } as never),
    ).rejects.toMatchObject({
      code: 'TOKEN_HISTORY_BACKFILL_ABORTED',
      sourceRetryable: true,
    });

    const oversized = context(
      block({
        transactions: [],
        traces: [],
      }),
    );
    await expect(
      captureCandidateNativeTransfers({
        ...oversized.input,
        focusWalletIds: Array.from(
          { length: 129 },
          (_, index) => `0x${index.toString(16).padStart(40, '0')}`,
        ),
      } as never),
    ).rejects.toMatchObject({
      code: 'TOKEN_HISTORY_BACKFILL_EXPANSION_WALLET_LIMIT',
      sourceRetryable: false,
    });
  });
});
