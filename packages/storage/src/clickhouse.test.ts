import { describe, expect, it, vi } from 'vitest';

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

  it('writes, verifies, retrieves, and replays canonical Raw Facts', async () => {
    const fixture = createFakeClient();
    const fact = createRawChainFact(input);

    await expect(fixture.repository.put(fact)).resolves.toEqual(fact);
    await expect(fixture.repository.put(fact)).resolves.toEqual(fact);
    await expect(fixture.repository.get(fact.id)).resolves.toEqual(fact);
    await expect(
      fixture.repository.listRange({ ledger: 'EVM', chainId: '1', fromBlock: 42, toBlock: 42 }),
    ).resolves.toEqual([fact]);
    expect(fixture.client.insert).toHaveBeenCalledTimes(2);
    expect(fixture.rows.size).toBe(1);
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

  it('rejects embedded ClickHouse credentials', () => {
    expect(
      () =>
        new ClickHouseRawFactRepository({
          url: 'http://user:password@clickhouse:8123',
        }),
    ).toThrow(RawFactStorageError);
  });
});
