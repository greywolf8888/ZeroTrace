import { describe, expect, it, vi } from 'vitest';

import {
  tombstoneExternalContent,
  type ExternalContentTombstone,
  type SearchPage,
} from '@zerotrace/provider-plane';

import {
  PostgresSocialObservationRepository,
  SocialObservationStorageError,
  type CreateSocialObservationWindowInput,
  type SocialObservationPool,
} from './social-observations.js';

const observedAt = '2026-08-31T00:00:00.000Z';
const rightsId = `ev_${'a'.repeat(24)}`;
const postEvidenceId = `ev_${'b'.repeat(24)}`;
const tombstoneEvidenceId = `ev_${'c'.repeat(24)}`;

function queryResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function windowRow(
  windowId = `sow_${'1'.repeat(24)}`,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    window_id: windowId,
    ledger: 'EVM',
    chain_id: 'eip155:56',
    asset_key: `BSC:0x${'1'.repeat(40)}`,
    query_role: 'IDENTITY',
    approved_query: `0x${'1'.repeat(40)}`,
    provider_id: 'verified-social',
    query_version: 'query-v1',
    contract_version: 'contract-v1',
    temporal_contract: {
      sinceParameter: 'from',
      untilParameter: 'until',
      precision: 'INSTANT',
      untilMode: 'EXCLUSIVE',
      overlapSeconds: 60,
    },
    content_policy_version: 'rights-v1',
    rights_evidence_ids: [rightsId],
    from_at: '2026-08-30T00:00:00.000Z',
    until_at: '2026-09-01T00:00:00.000Z',
    page_size: 10,
    cursor: null,
    completed: false,
    pages: 0,
    revision: 0,
    used_cursors: [],
    receipt_ids: [],
    receipt_signatures: [],
    coverage: 'NOT_COMPLETE',
    created_at: observedAt,
    updated_at: observedAt,
    ...overrides,
  };
}

const activeRecord = {
  state: 'ACTIVE' as const,
  sourceId: 'verified-social',
  upstreamGroup: 'X' as const,
  postId: '123456789',
  text: '可删除的当前正文。',
  contentHash: 'd'.repeat(64),
  createdAt: '2026-08-30T23:00:00.000Z',
  observedAt,
  deletionCheckedAt: observedAt,
  retainUntil: '2026-09-01T00:00:00.000Z',
  policyVersion: 'rights-v1',
  contractVersion: 'contract-v1',
  rightsEvidenceIds: [rightsId],
};

function observationRow(
  payload: typeof activeRecord | ExternalContentTombstone = activeRecord,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source_id: payload.sourceId,
    post_id: payload.postId,
    ledger: 'EVM',
    chain_id: 'eip155:56',
    state: payload.state,
    content_hash: payload.contentHash,
    policy_version: payload.policyVersion,
    contract_version: activeRecord.contractVersion,
    evidence_id: postEvidenceId,
    payload,
    revision: payload.state === 'TOMBSTONED' ? 2 : 1,
    first_observed_at: observedAt,
    last_observed_at: payload.state === 'TOMBSTONED' ? payload.deletedAt : activeRecord.observedAt,
    updated_at: observedAt,
    ...overrides,
  };
}

function receiptRow(windowId: string): Record<string, unknown> {
  return {
    receipt_id: `sor_${'2'.repeat(24)}`,
    window_id: windowId,
    page_revision: 0,
    requested_cursor: null,
    next_cursor: null,
    records_persisted: 1,
    normalized_page_hash: 'e'.repeat(64),
    evidence_ids: [postEvidenceId],
    procurement_request_id: 'social:test:request',
    created_at: observedAt,
  };
}

function repository(pool: SocialObservationPool) {
  return new PostgresSocialObservationRepository({ pool });
}

function input(): CreateSocialObservationWindowInput {
  return {
    ledger: 'EVM',
    chainId: 'eip155:56',
    assetKey: `BSC:0x${'1'.repeat(40)}`,
    queryRole: 'IDENTITY',
    approvedQuery: `0x${'1'.repeat(40)}`,
    providerId: 'verified-social',
    queryVersion: 'query-v1',
    contractVersion: 'contract-v1',
    temporalContract: {
      sinceParameter: 'from',
      untilParameter: 'until',
      precision: 'INSTANT',
      untilMode: 'EXCLUSIVE',
      overlapSeconds: 60,
    },
    contentPolicyVersion: 'rights-v1',
    rightsEvidenceIds: [rightsId],
    from: '2026-08-30T00:00:00.000Z',
    until: '2026-09-01T00:00:00.000Z',
    pageSize: 10,
  };
}

describe('PostgresSocialObservationRepository', () => {
  it('creates, lists and reads deterministic durable records through the storage interface', async () => {
    let storedWindowId = `sow_${'1'.repeat(24)}`;
    let listCalls = 0;
    const end = vi.fn(async () => undefined);
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      if (text.includes('INSERT INTO social_observation_windows')) {
        storedWindowId = String(values?.[0]);
        return queryResult([], 1);
      }
      if (text.includes('WHERE window_id = $1')) {
        return queryResult([windowRow(storedWindowId)]);
      }
      if (text.includes('ORDER BY updated_at DESC, window_id DESC')) {
        listCalls += 1;
        return listCalls === 1
          ? queryResult([
              windowRow(storedWindowId),
              windowRow(`sow_${'0'.repeat(24)}`, {
                query_role: 'COUNTER_EVIDENCE',
                approved_query: 'counter evidence',
                updated_at: '2026-08-30T23:59:00.000Z',
              }),
            ])
          : queryResult([]);
      }
      if (text.includes('social_observation_page_receipts')) {
        return queryResult([receiptRow(storedWindowId)]);
      }
      if (text.includes('FROM social_observations')) {
        return queryResult([observationRow()]);
      }
      if (text.includes("to_regclass('public.social_observation_windows')")) {
        return queryResult([
          {
            windows: 'social_observation_windows',
            observations: 'social_observations',
            migrated: true,
          },
        ]);
      }
      throw new Error(`UNEXPECTED_QUERY:${text}`);
    });
    const store = repository({
      query,
      connect: async () => {
        throw new Error('unexpected transaction');
      },
      end,
    });

    const created = await store.create(input());
    expect(created.window.id).toBe(storedWindowId);
    await expect(store.get(storedWindowId)).resolves.toMatchObject({
      window: { id: storedWindowId, coverage: 'NOT_COMPLETE' },
    });
    const firstPage = await store.list({ limit: 1 });
    expect(firstPage.records).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual({ updatedAt: observedAt, windowId: storedWindowId });
    await expect(store.list({ limit: 1, after: firstPage.nextCursor! })).resolves.toEqual({
      records: [],
      nextCursor: null,
    });
    await expect(store.receiptForRequest('social:test:request')).resolves.toMatchObject({
      windowId: storedWindowId,
      recordsPersisted: 1,
    });
    await expect(store.getObservation('verified-social', '123456789')).resolves.toMatchObject({
      record: activeRecord,
      revision: 1,
    });
    await expect(store.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await store.close();
    expect(end).toHaveBeenCalledOnce();
  });

  it('commits one page, its metadata-only event and the existing procurement ticket atomically', async () => {
    const windowId = `sow_${'3'.repeat(24)}`;
    const updatedWindow = windowRow(windowId, {
      completed: true,
      pages: 1,
      revision: 1,
      receipt_ids: [`sor_${'2'.repeat(24)}`],
      receipt_signatures: [{ id: `sor_${'2'.repeat(24)}`, signature: 'f'.repeat(64) }],
      coverage: 'ACCESSIBLE_QUERY_RESULTS_PROCESSED',
    });
    const procurementState = {
      revision: 2,
      remainingMicrousd: '0',
      accounts: {
        free: {
          providerIds: ['verified-social'],
          allowedCostKind: 'FREE_ONLY',
          quotaRemaining: '1',
          costEvidence: 'free-entitlement',
          enabled: true,
          rightsApproved: true,
        },
      },
      tickets: {
        'social:test:request': {
          requestId: 'social:test:request',
          fingerprint: 'page-fingerprint',
          providerId: 'verified-social',
          accountId: 'free',
          costKind: 'VERIFIED_FREE',
          maxUnits: '1',
          maxMicrousd: '0',
          evidence: 'free-entitlement',
          expiresAt: Date.parse(observedAt) + 300_000,
          policyVersion: 'policy-v1',
          state: 'DISPATCHED',
        },
      },
      blocked: false,
    };
    let windowReads = 0;
    const transactionQuery = vi.fn(async (text: string, _values?: readonly unknown[]) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return queryResult();
      if (text.includes('FROM social_observation_windows') && text.includes('FOR UPDATE')) {
        return queryResult([windowRow(windowId)]);
      }
      if (text.includes('social_observation_page_receipts WHERE procurement_request_id')) {
        return queryResult();
      }
      if (text.includes('FROM data_procurement_ledgers')) {
        return queryResult([
          {
            policy: { version: 'policy-v1', paidAllowed: false, approvedProviderIds: [] },
            state: procurementState,
            revision: 2,
          },
        ]);
      }
      if (text.includes('SELECT source, evidence_kind FROM evidence')) {
        return queryResult([{ source: 'verified-social', evidence_kind: 'PROVIDER_OBSERVATION' }]);
      }
      if (text.includes('SELECT state, content_hash, revision FROM social_observations')) {
        return queryResult();
      }
      if (text.includes('INSERT INTO social_observations')) return queryResult([], 1);
      if (text.includes('INSERT INTO social_observation_events')) return queryResult([], 1);
      if (text.includes('INSERT INTO social_observation_page_receipts')) {
        return queryResult([receiptRow(windowId)], 1);
      }
      if (text.includes('UPDATE social_observation_windows')) return queryResult([], 1);
      if (text.includes('UPDATE data_procurement_ledgers')) return queryResult([], 1);
      if (text.includes('FROM social_observation_windows')) {
        windowReads += 1;
        return queryResult([updatedWindow]);
      }
      throw new Error(`UNEXPECTED_TRANSACTION_QUERY:${text}`);
    });
    const store = repository({
      query: async () => queryResult(),
      connect: async () => ({ query: transactionQuery, release: vi.fn() }),
      end: async () => undefined,
    });
    const page: SearchPage = {
      posts: [
        {
          id: activeRecord.postId,
          text: activeRecord.text!,
          createdAt: activeRecord.createdAt,
          observedAt: activeRecord.observedAt,
          authorId: null,
          authorHandle: null,
          sourceId: activeRecord.sourceId,
          upstreamGroup: 'X',
          permalink: `https://x.com/i/status/${activeRecord.postId}`,
        },
      ],
      nextCursor: null,
    };
    const committed = await store.commitPage({
      windowId,
      procurementRequestId: 'social:test:request',
      page,
      records: [activeRecord],
      evidenceIds: [postEvidenceId],
      settlement: { scopeId: 'global', units: '1', microusd: '0' },
    });
    expect(committed.window.window).toMatchObject({ completed: true, revision: 1 });
    expect(committed.receipt.windowId).toBe(windowId);
    expect(windowReads).toBe(1);
    const eventInsert = transactionQuery.mock.calls.find(([text]) =>
      String(text).includes('INSERT INTO social_observation_events'),
    );
    expect(String(eventInsert?.[1]?.[6])).not.toContain('"text"');

    const outsideRecord = {
      ...activeRecord,
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    await expect(
      store.commitPage({
        windowId,
        procurementRequestId: 'social:test:request',
        page: {
          posts: [
            {
              ...page.posts[0]!,
              createdAt: outsideRecord.createdAt,
            },
          ],
          nextCursor: null,
        },
        records: [outsideRecord],
        evidenceIds: [postEvidenceId],
        settlement: { scopeId: 'global', units: '1', microusd: '0' },
      }),
    ).rejects.toMatchObject({ code: 'SOCIAL_OBSERVATION_INVALID' });
    expect(transactionQuery.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('tombstones active content and treats the exact repeated tombstone as idempotent', async () => {
    const tombstone = tombstoneExternalContent(activeRecord, {
      deletedAt: '2026-08-31T00:01:00.000Z',
      reason: 'UPSTREAM_DELETED',
      evidenceIds: [tombstoneEvidenceId],
    });
    let storedPayload: typeof activeRecord | ExternalContentTombstone = activeRecord;
    const transactionQuery = vi.fn(async (text: string) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return queryResult();
      if (text.includes('SELECT * FROM social_observations')) {
        return queryResult([observationRow(storedPayload)]);
      }
      if (text.includes('SELECT source, evidence_kind FROM evidence')) {
        return queryResult([{ source: 'verified-social', evidence_kind: 'PROVIDER_OBSERVATION' }]);
      }
      if (text.includes('UPDATE social_observations')) {
        storedPayload = tombstone;
        return queryResult([], 1);
      }
      if (text.includes('INSERT INTO social_observation_events')) return queryResult([], 1);
      throw new Error(`UNEXPECTED_TOMBSTONE_QUERY:${text}`);
    });
    const store = repository({
      query: async () => queryResult(),
      connect: async () => ({ query: transactionQuery, release: vi.fn() }),
      end: async () => undefined,
    });
    await expect(
      store.tombstone({
        ledger: 'EVM',
        chainId: 'eip155:56',
        tombstone,
        evidenceId: tombstoneEvidenceId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      store.tombstone({
        ledger: 'EVM',
        chainId: 'eip155:56',
        tombstone,
        evidenceId: tombstoneEvidenceId,
      }),
    ).resolves.toBeUndefined();
    expect(
      transactionQuery.mock.calls.filter(([text]) => String(text).startsWith('UPDATE')),
    ).toHaveLength(1);
  });

  it('rejects malformed identities and money fields before opening a transaction', async () => {
    const connect = vi.fn(async () => {
      throw new Error('must not connect');
    });
    const store = repository({
      query: async () => queryResult(),
      connect,
      end: async () => undefined,
    });
    const invalidCreates: CreateSocialObservationWindowInput[] = [
      { ...input(), chainId: '' },
      { ...input(), assetKey: '' },
      { ...input(), queryRole: '' },
      { ...input(), approvedQuery: '' },
      { ...input(), providerId: '' },
      { ...input(), queryVersion: '' },
      { ...input(), contractVersion: '' },
      { ...input(), contentPolicyVersion: '' },
      {
        ...input(),
        temporalContract: { ...input().temporalContract, sinceParameter: '' },
      },
      {
        ...input(),
        temporalContract: {
          ...input().temporalContract,
          untilParameter: input().temporalContract.sinceParameter,
        },
      },
      {
        ...input(),
        temporalContract: { ...input().temporalContract, overlapSeconds: 1.5 },
      },
      { ...input(), pageSize: 0 },
      { ...input(), pageSize: 1_001 },
      { ...input(), pageSize: 1.5 },
      { ...input(), rightsEvidenceIds: [] },
      { ...input(), rightsEvidenceIds: ['invalid'] },
    ];
    for (const invalid of invalidCreates) {
      await expect(store.create(invalid)).rejects.toMatchObject({
        code: 'SOCIAL_OBSERVATION_INVALID',
      });
    }
    await expect(store.list({ limit: 0 })).rejects.toBeInstanceOf(SocialObservationStorageError);
    await expect(
      store.list({ limit: 1, after: { updatedAt: 'invalid', windowId: 'invalid' } }),
    ).rejects.toBeInstanceOf(SocialObservationStorageError);
    await expect(store.getObservation('', '')).rejects.toBeInstanceOf(
      SocialObservationStorageError,
    );
    const validPage: SearchPage = { posts: [], nextCursor: null };
    const baseCommit = {
      windowId: `sow_${'3'.repeat(24)}`,
      procurementRequestId: 'social:test:request',
      page: validPage,
      records: [],
      evidenceIds: [],
      settlement: { scopeId: 'global', units: '0', microusd: '0' },
    };
    const invalidCommits = [
      { ...baseCommit, procurementRequestId: 'bad request' },
      { ...baseCommit, records: [activeRecord] },
      { ...baseCommit, evidenceIds: [postEvidenceId] },
      { ...baseCommit, evidenceIds: ['invalid'] },
      { ...baseCommit, settlement: { ...baseCommit.settlement, scopeId: 'INVALID SCOPE' } },
      { ...baseCommit, settlement: { ...baseCommit.settlement, units: '-1' } },
      { ...baseCommit, settlement: { ...baseCommit.settlement, microusd: 'unknown' } },
    ];
    for (const invalid of invalidCommits) {
      await expect(store.commitPage(invalid)).rejects.toMatchObject({
        code: 'SOCIAL_OBSERVATION_INVALID',
      });
    }
    await expect(
      store.tombstone({
        ledger: 'EVM',
        chainId: 'eip155:56',
        tombstone: tombstoneExternalContent(activeRecord, {
          deletedAt: '2026-08-31T00:01:00.000Z',
          reason: 'UPSTREAM_DELETED',
          evidenceIds: [tombstoneEvidenceId],
        }),
        evidenceId: 'invalid',
      }),
    ).rejects.toMatchObject({ code: 'SOCIAL_OBSERVATION_INVALID' });
    expect(connect).not.toHaveBeenCalled();
    expect(
      () =>
        new PostgresSocialObservationRepository({
          connectionString: 'not-a-url',
        }),
    ).toThrow('invalid');
    expect(
      () =>
        new PostgresSocialObservationRepository({
          connectionString: 'https://database.example.com/zerotrace',
        }),
    ).toThrow('PostgreSQL');
  });
});
