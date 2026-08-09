import { describe, expect, it, vi } from 'vitest';

import { ProviderError } from './errors.js';
import {
  SqdPortalClient,
  sqdBitcoinInputsFromBlock,
  sqdBitcoinOutputsFromBlock,
  sqdEvmLogsFromBlock,
  sqdSolanaInstructionsFromBlock,
  sqdTransactionsFromBlock,
  type SqdFinalizedBlock,
} from './sqd.js';

const policy = { allowedHosts: ['portal.sqd.dev'], allowPrivateNetworks: true } as const;

function block(number: number, suffix = number.toString(16)): SqdFinalizedBlock {
  return {
    header: {
      number,
      hash: `0x${suffix.padStart(64, '0')}`,
      parentHash: `0x${Math.max(number - 1, 0)
        .toString(16)
        .padStart(64, '0')}`,
      timestamp: 1_700_000_000 + number,
    },
  };
}

function jsonlResponse(
  blocks: readonly SqdFinalizedBlock[],
  options: { chunks?: readonly string[]; finalizedHead?: number } = {},
): Response {
  const encoded = `${blocks.map((item) => JSON.stringify(item)).join('\n')}\n`;
  const chunks = options.chunks ?? [encoded];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/jsonl',
      ...(options.finalizedHead === undefined
        ? {}
        : { 'x-sqd-finalized-head-number': String(options.finalizedHead) }),
    },
  });
}

function client(
  fetchImplementation: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof SqdPortalClient>[0]> = {},
): SqdPortalClient {
  return new SqdPortalClient({
    portalUrl: 'https://portal.sqd.dev',
    dataset: 'ethereum-mainnet',
    policy,
    requestsPerSecond: 0,
    retryBaseDelayMs: 0,
    retryMaxDelayMs: 0,
    fetchImplementation,
    ...overrides,
  });
}

describe('SqdPortalClient', () => {
  it('validates and maps dataset metadata without inventing a missing start block', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          dataset: 'ethereum-mainnet',
          aliases: ['eth-mainnet'],
          real_time: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await client(fetchImplementation).metadata();

    expect(result).toEqual({
      dataset: 'ethereum-mainnet',
      aliases: ['eth-mainnet'],
      realTime: true,
      startBlock: null,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe(
      'https://portal.sqd.dev/datasets/ethereum-mainnet/metadata',
    );
    expect(fetchImplementation.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('rejects metadata for a different dataset', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          dataset: 'binance-mainnet',
          aliases: [],
          real_time: true,
          start_block: 0,
        }),
        { status: 200 },
      ),
    );

    await expect(client(fetchImplementation).metadata()).rejects.toMatchObject({
      code: 'CHAIN_MISMATCH',
    });
  });

  it('streams bounded JSONL, preserves constant-memory chunks, and resumes at last block plus one', async () => {
    const first = `${JSON.stringify(block(10))}\n${JSON.stringify(block(11))}\n`;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonlResponse([], {
          chunks: [first.slice(0, 17), first.slice(17, 89), first.slice(89)],
          finalizedHead: 20,
        }),
      )
      .mockResolvedValueOnce(jsonlResponse([block(12), block(13)], { finalizedHead: 21 }));
    const received: number[] = [];

    const result = await client(fetchImplementation).readFinalizedRange(
      {
        fromBlock: 10,
        toBlock: 13,
        fields: { transaction: { hash: true } },
        requests: { transactions: [{}] },
      },
      (item) => {
        received.push(item.header.number);
      },
    );

    expect(received).toEqual([10, 11, 12, 13]);
    expect(result).toEqual({
      dataset: 'ethereum-mainnet',
      completion: 'REQUESTED_RANGE_COMPLETE',
      requestedFrom: 10,
      requestedTo: 13,
      lastBlock: 13,
      nextBlock: 14,
      finalizedHead: 21,
      blocks: 4,
      requests: 2,
      retries: 0,
    });
    const firstBody = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    const secondBody = JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(firstBody).toMatchObject({
      type: 'evm',
      fromBlock: 10,
      toBlock: 13,
      includeAllBlocks: true,
      transactions: [{}],
      fields: {
        block: { number: true, hash: true, parentHash: true, timestamp: true },
        transaction: { hash: true },
      },
    });
    expect(secondBody.fromBlock).toBe(12);
  });

  it('keeps source-head exhaustion distinct from completed requested coverage', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    const result = await client(fetchImplementation).readFinalizedRange(
      { fromBlock: 100, toBlock: 110 },
      vi.fn(),
    );

    expect(result).toMatchObject({
      completion: 'SOURCE_HEAD_REACHED',
      lastBlock: null,
      nextBlock: 100,
      blocks: 0,
    });
  });

  it('rejects gaps for EVM and Bitcoin finalized block streams', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonlResponse([block(10), block(12)]));

    await expect(
      client(fetchImplementation).readFinalizedRange({ fromBlock: 10, toBlock: 12 }, vi.fn()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('allows skipped Solana slots while preserving strictly increasing ordering', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonlResponse([block(10), block(12)]));
    const received: number[] = [];

    const result = await client(fetchImplementation, {
      dataset: 'solana-mainnet',
    }).readFinalizedRange({ fromBlock: 10, toBlock: 12 }, (item) => {
      received.push(item.header.number);
    });

    expect(received).toEqual([10, 12]);
    expect(result.completion).toBe('REQUESTED_RANGE_COMPLETE');
  });

  it('treats an empty finalized Solana response as covered only with a verifiable head', async () => {
    const completeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonlResponse([], { finalizedHead: 12 }));
    const complete = await client(completeFetch, { dataset: 'solana-mainnet' }).readFinalizedRange(
      { fromBlock: 10, toBlock: 12 },
      vi.fn(),
    );
    expect(complete).toMatchObject({
      completion: 'REQUESTED_RANGE_COMPLETE',
      lastBlock: null,
      nextBlock: 13,
      finalizedHead: 12,
      blocks: 0,
    });

    const sourceHeadFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonlResponse([], { finalizedHead: 11 }));
    const sourceHead = await client(sourceHeadFetch, {
      dataset: 'solana-mainnet',
    }).readFinalizedRange({ fromBlock: 10, toBlock: 12 }, vi.fn());
    expect(sourceHead).toMatchObject({
      completion: 'SOURCE_HEAD_REACHED',
      nextBlock: 12,
      finalizedHead: 11,
      blocks: 0,
    });
  });

  it('rejects empty coverage for contiguous ledgers or when the finalized head is Unknown', async () => {
    const contiguousFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonlResponse([], { finalizedHead: 12 }));
    await expect(
      client(contiguousFetch).readFinalizedRange({ fromBlock: 10, toBlock: 12 }, vi.fn()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const unknownHeadFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonlResponse([]));
    await expect(
      client(unknownHeadFetch, { dataset: 'solana-mainnet' }).readFinalizedRange(
        { fromBlock: 10, toBlock: 12 },
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('honors rate-limit retry metadata and does not turn it into provider-down', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('limited', { status: 429, headers: { 'retry-after': '0' } }),
      )
      .mockResolvedValueOnce(jsonlResponse([block(10)]));

    const result = await client(fetchImplementation).readFinalizedRange(
      { fromBlock: 10, toBlock: 10 },
      vi.fn(),
    );

    expect(result).toMatchObject({ requests: 2, retries: 1, blocks: 1 });
  });

  it('does not retry malformed evidence or hide a consumer write failure', async () => {
    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{bad}\n', { headers: { 'content-type': 'application/jsonl' } }),
      );
    await expect(
      client(malformedFetch).readFinalizedRange({ fromBlock: 1, toBlock: 1 }, vi.fn()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(malformedFetch).toHaveBeenCalledOnce();

    const failure = new Error('durable writer rejected block');
    const consumerFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonlResponse([block(1)]));
    await expect(
      client(consumerFetch).readFinalizedRange({ fromBlock: 1, toBlock: 1 }, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('rejects unsafe numbers, invalid query groups, and provider URL path injection', async () => {
    const unsafeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          '{"header":{"number":9007199254740993,"hash":"x","parentHash":"y","timestamp":1}}\n',
          { headers: { 'content-type': 'application/jsonl' } },
        ),
      );
    await expect(
      client(unsafeFetch, { maxRangeBlocks: 2 }).readFinalizedRange(
        { fromBlock: Number.MAX_SAFE_INTEGER - 1, toBlock: Number.MAX_SAFE_INTEGER },
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    await expect(
      client(vi.fn<typeof fetch>()).readFinalizedRange(
        { fromBlock: 1, toBlock: 1, requests: { instructions: [{}] } },
        vi.fn(),
      ),
    ).rejects.toThrow(/request group/);

    expect(
      () =>
        new SqdPortalClient({
          portalUrl: 'https://portal.sqd.dev/attacker-controlled',
          dataset: 'ethereum-mainnet',
          policy,
        }),
    ).toThrow(ProviderError);
  });
});

describe('sqdTransactionsFromBlock', () => {
  it.each([
    {
      dataset: 'ethereum-mainnet' as const,
      transaction: { hash: `0x${'a'.repeat(64)}`, value: '9007199254740993' },
      identity: `0x${'a'.repeat(64)}`,
    },
    {
      dataset: 'bitcoin-mainnet' as const,
      transaction: { txid: 'b'.repeat(64), weight: 400 },
      identity: 'b'.repeat(64),
    },
    {
      dataset: 'solana-mainnet' as const,
      transaction: { signatures: ['1'.repeat(88)], fee: 5000 },
      identity: '1'.repeat(88),
    },
  ])(
    'extracts a strict transaction identity for $dataset',
    ({ dataset, transaction, identity }) => {
      const item = sqdTransactionsFromBlock(dataset, {
        ...block(1),
        transactions: [transaction],
      })[0];

      expect(item).toEqual({ sourceIndex: 0, identity, payload: transaction });
    },
  );

  it('accepts the provider-defined omitted or explicit empty transaction table', () => {
    expect(sqdTransactionsFromBlock('ethereum-mainnet', block(1))).toEqual([]);
    expect(sqdTransactionsFromBlock('ethereum-mainnet', { ...block(1), transactions: [] })).toEqual(
      [],
    );
  });

  it('rejects malformed and duplicate transaction identities', () => {
    expect(() =>
      sqdTransactionsFromBlock('ethereum-mainnet', {
        ...block(1),
        transactions: [{ hash: 'not-a-hash' }],
      }),
    ).toThrow(/hash/);
    expect(() =>
      sqdTransactionsFromBlock('bitcoin-mainnet', {
        ...block(1),
        transactions: [{ txid: 'c'.repeat(64) }, { txid: 'C'.repeat(64) }],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      sqdTransactionsFromBlock('solana-mainnet', {
        ...block(1),
        transactions: [{ signatures: [] }],
      }),
    ).toThrow(/signatures/);
    expect(() =>
      sqdTransactionsFromBlock('solana-mainnet', {
        ...block(1),
        transactions: null,
      }),
    ).toThrow(/table/);
  });
});

describe('SQD ledger-specific record extraction', () => {
  it('extracts EVM logs by transaction hash and log index', () => {
    const payload = {
      transactionHash: `0x${'A'.repeat(64)}`,
      transactionIndex: 7,
      logIndex: 9,
      address: `0x${'1'.repeat(40)}`,
      topics: [],
      data: '0x',
    };
    expect(sqdEvmLogsFromBlock('ethereum-mainnet', { ...block(1), logs: [payload] })).toEqual([
      {
        sourceIndex: 0,
        identity: `0x${'a'.repeat(64)}:9`,
        payload,
      },
    ]);
    expect(sqdEvmLogsFromBlock('binance-mainnet', block(1))).toEqual([]);
  });

  it('preserves coinbase nulls while identifying Bitcoin inputs and outputs by source position', () => {
    const bitcoinBlock: SqdFinalizedBlock = {
      header: {
        number: 170,
        hash: 'a'.repeat(64),
        parentHash: 'b'.repeat(64),
        timestamp: 1_234_567_890,
      },
      inputs: [
        { transactionIndex: 0, inputIndex: 0, txid: null, vout: null },
        { transactionIndex: 1, inputIndex: 0, txid: 'c'.repeat(64), vout: 0 },
      ],
      outputs: [{ transactionIndex: 0, outputIndex: 0, value: 50 }],
    };

    expect(
      sqdBitcoinInputsFromBlock('bitcoin-mainnet', bitcoinBlock).map((item) => item.identity),
    ).toEqual([`${'a'.repeat(64)}:0:0`, `${'a'.repeat(64)}:1:0`]);
    expect(sqdBitcoinInputsFromBlock('bitcoin-mainnet', bitcoinBlock)[0]?.payload).toMatchObject({
      txid: null,
      vout: null,
    });
    expect(sqdBitcoinOutputsFromBlock('bitcoin-mainnet', bitcoinBlock)[0]?.identity).toBe(
      `${'a'.repeat(64)}:0:0`,
    );
  });

  it('keeps Solana instruction paths independent from the returned transaction array order', () => {
    const solanaBlock: SqdFinalizedBlock = {
      header: {
        number: 105_368,
        hash: '1'.repeat(44),
        parentHash: '2'.repeat(44),
        timestamp: 1_234_567_890,
      },
      transactions: [{ signatures: ['3'.repeat(88)] }],
      instructions: [
        { transactionIndex: 2, instructionAddress: [0], programId: '4'.repeat(44) },
        { transactionIndex: 2, instructionAddress: [0, 1], programId: '5'.repeat(44) },
      ],
    };

    expect(
      sqdSolanaInstructionsFromBlock('solana-mainnet', solanaBlock).map((item) => item.identity),
    ).toEqual([`${'1'.repeat(44)}:2:0`, `${'1'.repeat(44)}:2:0.1`]);
  });

  it('rejects malformed, duplicate, and non-applicable ledger records', () => {
    expect(() =>
      sqdEvmLogsFromBlock('ethereum-mainnet', {
        ...block(1),
        logs: [{ transactionHash: `0x${'a'.repeat(64)}`, transactionIndex: 0, logIndex: -1 }],
      }),
    ).toThrow(/index/);
    expect(() =>
      sqdEvmLogsFromBlock('ethereum-mainnet', {
        ...block(1),
        logs: [
          { transactionHash: `0x${'a'.repeat(64)}`, transactionIndex: 0, logIndex: 0 },
          { transactionHash: `0x${'A'.repeat(64)}`, transactionIndex: 0, logIndex: 0 },
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      sqdBitcoinInputsFromBlock('bitcoin-mainnet', {
        header: {
          number: 1,
          hash: 'a'.repeat(64),
          parentHash: 'b'.repeat(64),
          timestamp: null,
        },
        inputs: [{ transactionIndex: 0, inputIndex: 0, txid: null, vout: 0 }],
      }),
    ).toThrow(/fully known/);
    expect(() =>
      sqdSolanaInstructionsFromBlock('solana-mainnet', {
        header: {
          number: 1,
          hash: '1'.repeat(44),
          parentHash: '2'.repeat(44),
          timestamp: null,
        },
        instructions: [{ transactionIndex: 0, instructionAddress: [] }],
      }),
    ).toThrow(/address/);
    expect(() => sqdBitcoinOutputsFromBlock('ethereum-mainnet', block(1))).toThrow(
      /not applicable/,
    );
  });
});
