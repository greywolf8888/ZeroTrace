import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from '@zerotrace/evidence';

import {
  ClickHouseRawFactRepository,
  createRawChainFact,
  rawFactIdFor,
  RawFactStorageError,
} from './clickhouse.js';

const input = {
  ledger: 'EVM' as const,
  chainId: '1',
  blockOrSlot: '42',
  blockHash: `0x${'a'.repeat(64)}`,
  factType: 'BLOCK',
  subject: `0x${'a'.repeat(64)}`,
  provider: 'sqd:ethereum-mainnet',
  finality: 'finalized',
  payload: { header: { hash: `0x${'a'.repeat(64)}`, number: 42 } },
  evidenceId: `ev_${'b'.repeat(24)}`,
  rawArtifactRef: `s3://zerotrace-raw/v1/evm/item.json#sha256=${'c'.repeat(64)}`,
  observedAt: '2026-08-09T13:00:00.000Z',
};

function createFakeClient() {
  const rows = new Map<string, Record<string, unknown>>();
  const insert = vi.fn(async (options: { values: Array<Record<string, string>> }) => {
    const value = options.values[0];
    if (value !== undefined) {
      rows.set(value.fact_id as string, {
        ...value,
        observed_at_ms: Date.parse(value.observed_at as string),
      });
    }
    return { executed: true };
  });
  const query = vi.fn(
    async (options: { query: string; query_params?: Record<string, unknown> }) => ({
      json: async () => {
        if (options.query.includes('FROM system.tables')) return [{ engine: 'ReplacingMergeTree' }];
        if (options.query.includes('FROM system.columns')) {
          return [
            'fact_id',
            'schema_version',
            'ledger',
            'chain_id',
            'block_or_slot',
            'block_hash',
            'fact_type',
            'subject',
            'provider',
            'finality',
            'payload',
            'payload_hash',
            'evidence_id',
            'raw_artifact_ref',
            'observed_at',
          ].map((name) => ({ name }));
        }
        if (options.query.includes('schema_migrations')) return [{ version: '001_raw_facts' }];
        if (options.query.includes('fact_id =')) {
          const row = rows.get(String(options.query_params?.factId));
          return row === undefined ? [] : [row];
        }
        return [...rows.values()];
      },
    }),
  );
  const close = vi.fn(async () => undefined);
  const client = { insert, query, close };
  return {
    client,
    rows,
    repository: ClickHouseRawFactRepository.fromClient(
      client as unknown as Parameters<typeof ClickHouseRawFactRepository.fromClient>[0],
    ),
  };
}

function rawRow(fact: ReturnType<typeof createRawChainFact>): Record<string, unknown> {
  return {
    fact_id: fact.id,
    schema_version: fact.schemaVersion,
    ledger: fact.ledger,
    chain_id: fact.chainId,
    block_or_slot: fact.blockOrSlot,
    block_hash: fact.blockHash,
    fact_type: fact.factType,
    subject: fact.subject,
    provider: fact.provider,
    finality: fact.finality,
    payload: canonicalJson(fact.payload),
    payload_hash: fact.payloadHash,
    evidence_id: fact.evidenceId,
    raw_artifact_ref: fact.rawArtifactRef,
    observed_at_ms: Date.parse(fact.observedAt),
  };
}

describe('ClickHouseRawFactRepository', () => {
  it('builds deterministic facts whose identity covers Evidence and artifact provenance', () => {
    const first = createRawChainFact(input);
    const reordered = createRawChainFact({
      ...input,
      payload: { header: { number: 42, hash: `0x${'a'.repeat(64)}` } },
    });
    const differentEvidence = createRawChainFact({
      ...input,
      evidenceId: `ev_${'d'.repeat(24)}`,
    });

    expect(first).toEqual(reordered);
    expect(first.id).toMatch(/^[0-9a-f]{64}$/);
    expect(first.id).toBe(rawFactIdFor(first));
    expect(differentEvidence.id).not.toBe(first.id);
  });

  it('writes, retrieves, and replays canonical Raw Facts without FINAL read-after-write queries', async () => {
    const fixture = createFakeClient();
    const fact = createRawChainFact(input);

    await expect(fixture.repository.put(fact)).resolves.toEqual(fact);
    await expect(fixture.repository.put(fact)).resolves.toEqual(fact);
    expect(fixture.client.query).not.toHaveBeenCalled();
    await expect(fixture.repository.get(fact.id)).resolves.toEqual(fact);
    await expect(
      fixture.repository.listRange({ ledger: 'EVM', chainId: '1', fromBlock: 42, toBlock: 42 }),
    ).resolves.toEqual([fact]);
    const rangeQuery = fixture.client.query.mock.calls.at(-1)?.[0]?.query;
    expect(rangeQuery).toContain('LIMIT 1 BY fact_id');
    expect(rangeQuery).not.toContain('FINAL');
    expect(fixture.client.insert).toHaveBeenCalledTimes(2);
    expect(fixture.rows.size).toBe(1);
  });

  it('pages lightweight fact keys before payloads and restores deterministic key order', async () => {
    const first = createRawChainFact(input);
    const second = createRawChainFact({
      ...input,
      blockOrSlot: '43',
      blockHash: `0x${'d'.repeat(64)}`,
      subject: `0x${'d'.repeat(64)}`,
      payload: { header: { hash: `0x${'d'.repeat(64)}`, number: 43 } },
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => [{ fact_id: second.id }, { fact_id: first.id }] })
      .mockResolvedValueOnce({ json: async () => [rawRow(first), rawRow(second)] });
    const repository = ClickHouseRawFactRepository.fromClient({
      query,
      insert: vi.fn(),
      close: vi.fn(),
    } as unknown as Parameters<typeof ClickHouseRawFactRepository.fromClient>[0]);

    await expect(
      repository.listRange({ ledger: 'EVM', chainId: '1', fromBlock: 42, toBlock: 43, limit: 2 }),
    ).resolves.toEqual([second, first]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]?.query).toContain('SELECT fact_id');
    expect(query.mock.calls[0]?.[0]?.query).not.toContain('payload');
    expect(query.mock.calls[1]?.[0]?.query).toContain('fact_id IN');
    expect(query.mock.calls[1]?.[0]?.query).not.toContain('ORDER BY');
    expect(query.mock.calls[1]?.[0]?.query_params?.factIds).toEqual([second.id, first.id]);
  });

  it('keeps large range pages below the ClickHouse factIds form-field limit', async () => {
    const facts = Array.from({ length: 1_001 }, (_, index) => {
      const hash = `0x${index.toString(16).padStart(64, '0')}`;
      return createRawChainFact({
        ...input,
        blockOrSlot: String(42 + index),
        blockHash: hash,
        subject: hash,
        payload: { header: { hash, number: 42 + index } },
      });
    });
    let keyPage = 0;
    let payloadPage = 0;
    const query = vi.fn(
      async (options: { query: string; query_params?: Record<string, unknown> }) => {
        if (options.query.includes('SELECT fact_id')) {
          const page = keyPage++ === 0 ? facts.slice(0, 1_000) : facts.slice(1_000);
          return { json: async () => page.map((fact) => ({ fact_id: fact.id })) };
        }
        const page = payloadPage++ === 0 ? facts.slice(0, 1_000) : facts.slice(1_000);
        return { json: async () => page.map(rawRow) };
      },
    );
    const repository = ClickHouseRawFactRepository.fromClient({
      query,
      insert: vi.fn(),
      close: vi.fn(),
    } as unknown as Parameters<typeof ClickHouseRawFactRepository.fromClient>[0]);

    await expect(
      repository.listRange({
        ledger: 'EVM',
        chainId: '1',
        fromBlock: 42,
        toBlock: 1_042,
        limit: 1_001,
      }),
    ).resolves.toEqual(facts);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[0]?.[0]?.query).toContain('LIMIT {limit:UInt32}');
    expect(query.mock.calls[2]?.[0]?.query_params?.limit).toBe(1);
  });

  it('inserts validated facts in bounded batches and rejects the whole batch before network access', async () => {
    const fixture = createFakeClient();
    const first = createRawChainFact(input);
    const second = createRawChainFact({
      ...input,
      blockOrSlot: '43',
      blockHash: `0x${'d'.repeat(64)}`,
      subject: `0x${'d'.repeat(64)}`,
      payload: { header: { hash: `0x${'d'.repeat(64)}`, number: 43 } },
    });

    await expect(fixture.repository.putMany([first, second])).resolves.toEqual([first, second]);
    expect(fixture.client.insert).toHaveBeenCalledOnce();
    expect(fixture.client.insert.mock.calls[0]?.[0]?.values).toHaveLength(2);

    await expect(
      fixture.repository.putMany([first, { ...second, payload: { header: { number: 44 } } }]),
    ).rejects.toMatchObject({ code: 'RAW_FACT_INVALID' });
    expect(fixture.client.insert).toHaveBeenCalledOnce();
  });

  it('rejects mutated identity before network access', async () => {
    const fixture = createFakeClient();
    const fact = createRawChainFact(input);

    await expect(
      fixture.repository.put({ ...fact, payload: { header: { number: 43 } } }),
    ).rejects.toMatchObject({ code: 'RAW_FACT_INVALID' });
    expect(fixture.client.insert).not.toHaveBeenCalled();
  });

  it('checks the ReplacingMergeTree schema and migration before reporting healthy', async () => {
    const fixture = createFakeClient();
    await expect(fixture.repository.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'CLICKHOUSE',
      logicalDeduplication: 'REPLACING_MERGE_TREE',
    });
    await fixture.repository.close();
    expect(fixture.client.close).toHaveBeenCalledOnce();
  });

  it('loads one exact artifact-scoped transaction fact bundle', async () => {
    const transactionId = `0x${'d'.repeat(64)}`;
    const transaction = createRawChainFact({
      ...input,
      factType: 'TRANSACTION',
      subject: transactionId,
      payload: { hash: transactionId, transactionIndex: 3, status: 1 },
    });
    const log = createRawChainFact({
      ...input,
      factType: 'LOG',
      subject: `${transactionId}:0`,
      evidenceId: `ev_${'e'.repeat(24)}`,
      payload: {
        transactionHash: transactionId,
        transactionIndex: 3,
        logIndex: 0,
        address: `0x${'1'.repeat(40)}`,
        topics: [],
        data: '0x',
      },
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => [rawRow(transaction)] })
      .mockResolvedValueOnce({
        json: async () => [{ fact_id: log.id, fact_type: log.factType, subject: log.subject }],
      })
      .mockResolvedValueOnce({ json: async () => [rawRow(log)] });
    const repository = ClickHouseRawFactRepository.fromClient({
      query,
      insert: vi.fn(),
      close: vi.fn(),
    } as unknown as Parameters<typeof ClickHouseRawFactRepository.fromClient>[0]);

    await expect(
      repository.listTransactionFacts({
        ledger: 'EVM',
        chainId: '1',
        blockOrSlot: '42',
        transactionId: transactionId.toUpperCase().replace('0X', '0x'),
        provider: input.provider,
      }),
    ).resolves.toEqual([transaction, log]);
    expect(query.mock.calls[1]?.[0]?.query).toContain('SELECT fact_id, fact_type, subject');
    expect(query.mock.calls[1]?.[0]?.query).not.toContain('toUnixTimestamp64Milli');
    expect(query.mock.calls[1]?.[0]?.query_params).toMatchObject({
      transactionId,
      transactionIndex: '3',
    });
    expect(query.mock.calls[2]?.[0]?.query_params).toMatchObject({
      rawArtifactRef: transaction.rawArtifactRef,
      factIds: [log.id],
    });
  });

  it('returns a retryable typed miss when the transaction has not been ingested', async () => {
    const repository = ClickHouseRawFactRepository.fromClient({
      query: vi.fn(async () => ({ json: async () => [] })),
      insert: vi.fn(),
      close: vi.fn(),
    } as unknown as Parameters<typeof ClickHouseRawFactRepository.fromClient>[0]);

    await expect(
      repository.listTransactionFacts({
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        blockOrSlot: '42',
        transactionId: 'd'.repeat(64),
        provider: 'sqd:bitcoin-mainnet',
      }),
    ).rejects.toMatchObject({ code: 'RAW_FACT_NOT_FOUND', retryable: true });
  });

  it('rejects embedded ClickHouse credentials', () => {
    expect(
      () =>
        new ClickHouseRawFactRepository({
          url: 'http://user:password@clickhouse:8123',
        }),
    ).toThrow(RawFactStorageError);
  });
});
