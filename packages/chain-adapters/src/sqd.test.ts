import { describe, expect, it, vi } from 'vitest';

import { ProviderError } from './errors.js';
import {
  SqdEvmContractCreationReader,
  SqdPortalClient,
  SqdEvmLogReader,
  sqdBitcoinInputsFromBlock,
  sqdBitcoinOutputsFromBlock,
  sqdEvmLogsFromBlock,
  sqdEvmStateDiffsFromBlock,
  sqdEvmTracesFromBlock,
  sqdSolanaBalancesFromBlock,
  sqdSolanaInstructionsFromBlock,
  sqdSolanaLogsFromBlock,
  sqdSolanaRewardsFromBlock,
  sqdSolanaTokenBalancesFromBlock,
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
  options: { chunks?: readonly string[]; contentType?: string; finalizedHead?: number } = {},
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
      'content-type': options.contentType ?? 'application/jsonl',
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

  it('bounds metadata and streaming bodies after headers arrive', async () => {
    const stalled = new ReadableStream<Uint8Array>({ start() {} });
    const metadataFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stalled, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      client(metadataFetch, { timeoutMs: 10, maxAttempts: 1 }).metadata(),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });

    const finalizedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'content-type': 'application/jsonl' },
      }),
    );

    await expect(
      client(finalizedFetch, { timeoutMs: 10, maxAttempts: 1 }).readFinalizedRange(
        { fromBlock: 10, toBlock: 10 },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
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

    const parentConflict = {
      ...block(11),
      header: { ...block(11).header, parentHash: `0x${'f'.repeat(64)}` },
    };
    const parentFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonlResponse([block(10), parentConflict]));
    await expect(
      client(parentFetch).readFinalizedRange({ fromBlock: 10, toBlock: 11 }, vi.fn()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('uses official sparse continuation semantics without claiming omitted blocks as returned rows', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonlResponse([block(10), block(12)], { finalizedHead: 20 }));
    const received: number[] = [];

    const result = await client(fetchImplementation).readFinalizedRange(
      { fromBlock: 10, toBlock: 12, includeAllBlocks: false },
      (item) => {
        received.push(item.header.number);
      },
    );

    expect(received).toEqual([10, 12]);
    expect(result).toMatchObject({
      completion: 'REQUESTED_RANGE_COMPLETE',
      lastBlock: 12,
      nextBlock: 13,
      blocks: 2,
    });
    expect(JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body))).toMatchObject({
      fromBlock: 10,
      toBlock: 12,
      includeAllBlocks: false,
    });
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

  it('accepts provider JSONL served as text/plain while preserving strict parsing', async () => {
    const validFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonlResponse([block(10)], { contentType: 'text/plain; charset=utf-8' }));

    await expect(
      client(validFetch).readFinalizedRange({ fromBlock: 10, toBlock: 10 }, vi.fn()),
    ).resolves.toMatchObject({ blocks: 1, requests: 1 });
    expect(validFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      accept: expect.stringContaining('text/plain'),
    });

    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{bad}\n', { headers: { 'content-type': 'text/plain' } }));
    await expect(
      client(malformedFetch).readFinalizedRange({ fromBlock: 10, toBlock: 10 }, vi.fn()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(malformedFetch).toHaveBeenCalledOnce();
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

describe('SqdEvmContractCreationReader', () => {
  it('extracts a filtered successful creation and its parent transaction from a sparse range', async () => {
    const address = `0x${'a'.repeat(40)}`;
    const creator = `0x${'b'.repeat(40)}`;
    const transactionHash = `0x${'c'.repeat(64)}`;
    const responseBlock: SqdFinalizedBlock = {
      ...block(10),
      transactions: [{ transactionIndex: 7, hash: transactionHash }],
      traces: [
        {
          transactionIndex: 7,
          traceAddress: [0, 1],
          type: 'create',
          error: null,
          action: { from: creator },
          result: { address, code: '0x1234' },
        },
      ],
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dataset: 'binance-mainnet',
            aliases: [],
            real_time: true,
            start_block: 0,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(jsonlResponse([responseBlock], { finalizedHead: 10 }));
    const reader = new SqdEvmContractCreationReader({
      source: client(fetchImplementation, { dataset: 'binance-mainnet' }),
      maxRangeBlocks: 10,
    });

    await expect(
      reader.getContractCreationsObservation({ address, fromBlock: '10', toBlock: '10' }),
    ).resolves.toMatchObject({
      endpointId: 'sqd:binance-mainnet',
      coverage: {
        fromBlock: '10',
        toBlock: '10',
        nextBlock: '11',
        finalizedHead: '10',
        requestCount: 1,
        completion: 'REQUESTED_RANGE_COMPLETE',
      },
      value: [
        {
          address,
          creator,
          bytecode: '0x1234',
          blockNumber: '0xa',
          transactionHash,
          transactionIndex: '0x7',
          traceAddress: [0, 1],
        },
      ],
    });
    expect(JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body))).toMatchObject({
      type: 'evm',
      fromBlock: 10,
      toBlock: 10,
      includeAllBlocks: false,
      traces: [{ type: ['create'], createResultAddress: [address], transaction: true }],
      fields: {
        transaction: { hash: true, transactionIndex: true },
        trace: { createFrom: true, createResultAddress: true, createResultCode: true },
      },
    });
  });

  it('fails closed on a mismatched creation result or incomplete source coverage', async () => {
    const address = `0x${'a'.repeat(40)}`;
    const metadata = new Response(
      JSON.stringify({
        dataset: 'binance-mainnet',
        aliases: [],
        real_time: true,
        start_block: 0,
      }),
      { status: 200 },
    );
    const mismatchedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(metadata)
      .mockResolvedValueOnce(
        jsonlResponse([
          {
            ...block(10),
            transactions: [{ transactionIndex: 0, hash: `0x${'c'.repeat(64)}` }],
            traces: [
              {
                transactionIndex: 0,
                traceAddress: [],
                type: 'create',
                error: null,
                action: { from: `0x${'b'.repeat(40)}` },
                result: { address: `0x${'d'.repeat(40)}`, code: '0x12' },
              },
            ],
          },
        ]),
      );
    await expect(
      new SqdEvmContractCreationReader({
        source: client(mismatchedFetch, { dataset: 'binance-mainnet' }),
      }).getContractCreationsObservation({ address, fromBlock: '10', toBlock: '10' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const shortfallFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dataset: 'binance-mainnet',
            aliases: [],
            real_time: true,
            start_block: 0,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
          headers: { 'x-sqd-finalized-head-number': '9' },
        }),
      );
    await expect(
      new SqdEvmContractCreationReader({
        source: client(shortfallFetch, { dataset: 'binance-mainnet' }),
      }).getContractCreationsObservation({ address, fromBlock: '10', toBlock: '10' }),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR', retryable: true });
  });

  it('returns a bounded empty result only when sparse source coverage reaches the range end', async () => {
    const address = `0x${'a'.repeat(40)}`;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dataset: 'binance-mainnet',
            aliases: [],
            real_time: true,
            start_block: 0,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(jsonlResponse([], { finalizedHead: 10 }));

    await expect(
      new SqdEvmContractCreationReader({
        source: client(fetchImplementation, { dataset: 'binance-mainnet' }),
      }).getContractCreationsObservation({ address, fromBlock: '10', toBlock: '10' }),
    ).resolves.toEqual({
      endpointId: 'sqd:binance-mainnet',
      value: [],
      coverage: {
        fromBlock: '10',
        toBlock: '10',
        nextBlock: '11',
        finalizedHead: '10',
        responseBlockCount: 0,
        requestCount: 1,
        completion: 'REQUESTED_RANGE_COMPLETE',
      },
    });
  });
});

describe('SqdEvmLogReader', () => {
  it('turns a complete filtered SQD range into strict request-scoped EVM logs', async () => {
    const address = `0x${'a'.repeat(40)}`;
    const topic = `0x${'b'.repeat(64)}`;
    const transactionHash = `0x${'c'.repeat(64)}`;
    const responseBlock: SqdFinalizedBlock = {
      ...block(10),
      logs: [
        {
          logIndex: 2,
          transactionIndex: 1,
          transactionHash,
          address,
          topics: [topic],
          data: '0x1234',
        },
      ],
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dataset: 'binance-mainnet',
            aliases: [],
            real_time: true,
            start_block: 0,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(jsonlResponse([responseBlock], { finalizedHead: 10 }));
    const source = client(fetchImplementation, { dataset: 'binance-mainnet' });
    const reader = new SqdEvmLogReader({ source, maxRangeBlocks: 10 });

    await expect(
      reader.getLogsObservation({
        address,
        fromBlock: '10',
        toBlock: '10',
        topics: [[topic, topic]],
      }),
    ).resolves.toMatchObject({
      endpointId: 'sqd:binance-mainnet',
      value: [
        {
          address,
          blockNumber: '0xa',
          transactionHash,
          transactionIndex: '0x1',
          logIndex: '0x2',
          removed: false,
        },
      ],
    });
    const request = JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(request).toMatchObject({
      type: 'evm',
      fromBlock: 10,
      toBlock: 10,
      includeAllBlocks: true,
      logs: [{ address: [address], topic0: [topic] }],
    });

    const wrongTopicFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dataset: 'binance-mainnet',
            aliases: [],
            real_time: true,
            start_block: 0,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        jsonlResponse([
          {
            ...responseBlock,
            logs: [
              {
                ...(responseBlock.logs as Array<Record<string, unknown>>)[0],
                topics: [`0x${'d'.repeat(64)}`],
              },
            ],
          },
        ]),
      );
    await expect(
      new SqdEvmLogReader({
        source: client(wrongTopicFetch, { dataset: 'binance-mainnet' }),
      }).getLogsObservation({ address, fromBlock: '10', toBlock: '10', topics: [topic] }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('supports explicit sparse filtered coverage without changing the continuous default', async () => {
    const address = `0x${'a'.repeat(40)}`;
    const topic = `0x${'b'.repeat(64)}`;
    const responseBlock: SqdFinalizedBlock = {
      ...block(10),
      logs: [
        {
          logIndex: 0,
          transactionIndex: 0,
          transactionHash: `0x${'c'.repeat(64)}`,
          address,
          topics: [topic],
          data: '0x',
        },
      ],
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dataset: 'binance-mainnet',
            aliases: [],
            real_time: true,
            start_block: 0,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(jsonlResponse([responseBlock], { finalizedHead: 12 }))
      .mockResolvedValueOnce(jsonlResponse([], { finalizedHead: 12 }));
    const reader = new SqdEvmLogReader({
      source: client(fetchImplementation, { dataset: 'binance-mainnet' }),
      maxRangeBlocks: 10,
      includeAllBlocks: false,
    });

    await expect(
      reader.getLogsObservation({ address, fromBlock: '10', toBlock: '12', topics: [topic] }),
    ).resolves.toMatchObject({ value: [{ blockNumber: '0xa', address }] });
    const firstRequest = JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    const secondRequest = JSON.parse(
      String(fetchImplementation.mock.calls[2]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(firstRequest).toMatchObject({
      fromBlock: 10,
      toBlock: 12,
      includeAllBlocks: false,
    });
    expect(secondRequest.fromBlock).toBe(11);
  });

  it('rejects unsupported coverage and source-head shortfalls without fabricating completeness', async () => {
    expect(
      () =>
        new SqdEvmLogReader({
          source: client(vi.fn<typeof fetch>(), { dataset: 'bitcoin-mainnet' }),
        }),
    ).toThrow('requires an EVM dataset');

    const address = `0x${'a'.repeat(40)}`;
    const beforeStartFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          dataset: 'binance-mainnet',
          aliases: [],
          real_time: true,
          start_block: 11,
        }),
        { status: 200 },
      ),
    );
    await expect(
      new SqdEvmLogReader({
        source: client(beforeStartFetch, { dataset: 'binance-mainnet' }),
      }).getLogsObservation({ address, fromBlock: '10', toBlock: '10' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(beforeStartFetch).toHaveBeenCalledOnce();

    const shortfallFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dataset: 'binance-mainnet',
            aliases: [],
            real_time: true,
            start_block: 0,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
          headers: { 'x-sqd-finalized-head-number': '9' },
        }),
      );
    await expect(
      new SqdEvmLogReader({
        source: client(shortfallFetch, { dataset: 'binance-mainnet' }),
      }).getLogsObservation({ address, fromBlock: '10', toBlock: '10' }),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR', retryable: true });
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

  it('identifies EVM traces by source path and state diffs by changed state key', () => {
    const evmBlock: SqdFinalizedBlock = {
      ...block(1),
      traces: [
        { transactionIndex: 0, traceAddress: [], type: 'call' },
        { transactionIndex: 0, traceAddress: [0, 1], type: 'create' },
      ],
      stateDiffs: [
        {
          transactionIndex: 0,
          address: `0x${'A'.repeat(40)}`,
          key: `0x${'B'.repeat(64)}`,
          kind: '*',
          prev: '0x01',
          next: '0x02',
        },
      ],
    };
    const prefix = evmBlock.header.hash.toLowerCase();

    expect(
      sqdEvmTracesFromBlock('ethereum-mainnet', evmBlock).map((item) => item.identity),
    ).toEqual([`${prefix}:0:root`, `${prefix}:0:0.1`]);
    expect(sqdEvmStateDiffsFromBlock('ethereum-mainnet', evmBlock)[0]?.identity).toBe(
      `${prefix}:0:0x${'a'.repeat(40)}:0x${'b'.repeat(64)}`,
    );
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

  it('extracts Solana logs, native/token balances, and block rewards without array joins', () => {
    const solanaBlock: SqdFinalizedBlock = {
      header: {
        number: 259_985_000,
        hash: '1'.repeat(44),
        parentHash: '2'.repeat(44),
        timestamp: 1_234_567_890,
      },
      logs: [
        {
          transactionIndex: 65,
          logIndex: 1,
          instructionAddress: [0, 1],
          programId: '3'.repeat(44),
          kind: 'log',
          message: 'Instruction: test',
        },
      ],
      balances: [{ transactionIndex: 65, account: '4'.repeat(44), pre: '2', post: '1' }],
      tokenBalances: [
        {
          transactionIndex: 65,
          account: '5'.repeat(44),
          preProgramId: null,
          preMint: null,
          preDecimals: null,
          preOwner: null,
          preAmount: null,
          postProgramId: '3'.repeat(44),
          postMint: '7'.repeat(44),
          postDecimals: 6,
          postOwner: '8'.repeat(44),
          postAmount: '2',
        },
      ],
      rewards: [{ pubkey: '6'.repeat(44), lamports: '3', postBalance: '4', rewardType: 'Fee' }],
    };

    expect(sqdSolanaLogsFromBlock('solana-mainnet', solanaBlock)[0]?.identity).toBe(
      `${'1'.repeat(44)}:65:1`,
    );
    expect(sqdSolanaBalancesFromBlock('solana-mainnet', solanaBlock)[0]?.identity).toBe(
      `${'1'.repeat(44)}:65:${'4'.repeat(44)}`,
    );
    expect(sqdSolanaTokenBalancesFromBlock('solana-mainnet', solanaBlock)[0]?.identity).toBe(
      `${'1'.repeat(44)}:65:${'5'.repeat(44)}`,
    );
    expect(
      sqdSolanaTokenBalancesFromBlock('solana-mainnet', solanaBlock)[0]?.payload,
    ).toMatchObject({
      preAmount: null,
      postAmount: '2',
    });
    expect(sqdSolanaRewardsFromBlock('solana-mainnet', solanaBlock)[0]?.identity).toBe(
      `${'1'.repeat(44)}:0:${'6'.repeat(44)}`,
    );
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
    expect(() =>
      sqdEvmTracesFromBlock('ethereum-mainnet', {
        ...block(1),
        traces: [{ transactionIndex: 0, traceAddress: [-1], type: 'call' }],
      }),
    ).toThrow(/trace address/);
    expect(() =>
      sqdEvmStateDiffsFromBlock('ethereum-mainnet', {
        ...block(1),
        stateDiffs: [
          { transactionIndex: 0, address: `0x${'1'.repeat(40)}`, key: 'unknown-state-key' },
        ],
      }),
    ).toThrow(/key/);
    expect(() =>
      sqdSolanaBalancesFromBlock('solana-mainnet', {
        header: {
          number: 1,
          hash: '1'.repeat(44),
          parentHash: '2'.repeat(44),
          timestamp: null,
        },
        balances: [
          { transactionIndex: 0, account: '3'.repeat(44), pre: '1', post: '0' },
          { transactionIndex: 0, account: '3'.repeat(44), pre: '1', post: '0' },
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      sqdSolanaRewardsFromBlock('solana-mainnet', {
        header: {
          number: 1,
          hash: '1'.repeat(44),
          parentHash: '2'.repeat(44),
          timestamp: null,
        },
        rewards: [{ pubkey: 'not-base58' }],
      }),
    ).toThrow(/pubkey/);
  });
});
