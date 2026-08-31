import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { createEvidence } from '@zerotrace/evidence';
import {
  prepareExternalContentRecord,
  tombstoneExternalContent,
  type SocialSourceConfig,
} from '@zerotrace/provider-plane';
import {
  PostgresDataProcurementRepository,
  PostgresEvidenceRepository,
  PostgresSocialObservationRepository,
} from '@zerotrace/storage';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;

postgresDescribe('PostgreSQL durable social observation pagination', () => {
  let database: Pool;
  let evidence: PostgresEvidenceRepository;
  let procurement: PostgresDataProcurementRepository;
  let observations: PostgresSocialObservationRepository;

  beforeAll(() => {
    database = new Pool({ connectionString: connectionString as string, max: 2 });
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    procurement = new PostgresDataProcurementRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    observations = new PostgresSocialObservationRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => {
    await Promise.all([
      database.end(),
      evidence.close(),
      procurement.close(),
      observations.close(),
    ]);
  });

  it('atomically persists Evidence, posts, page receipt, cursor and free-quota settlement', async () => {
    await expect(observations.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    const nonce = randomBytes(8).toString('hex');
    const sourceId = `social-test-${nonce}`;
    const scopeId = `social-test:${nonce}`;
    const accountId = `social-test:${nonce}`;
    const requestId = `social:test:${nonce}`;
    const observedAt = '2026-08-31T00:00:00.000Z';
    const rights = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'OFFICIAL_DOCUMENT',
      source: sourceId,
      locator: `rights:${nonce}`,
      sourceUri: 'https://social.example.com/rights',
      payload: { contractVersion: `contract-${nonce}`, rights: 'test-only' },
      observedAt,
      summary: '集成测试中的只读来源权益合同。',
    });
    await evidence.put(rights);
    const source: SocialSourceConfig = {
      id: sourceId,
      origin: 'https://social.example.com',
      identityVerified: true,
      rightsApproved: true,
      enabled: true,
      contractVersion: `contract-${nonce}`,
      upstreamGroup: 'X',
      documentation: 'https://social.example.com/docs',
      authentication: { kind: 'NONE', secretRef: null, headerName: null },
      dispatch: {
        accountId,
        costKind: 'VERIFIED_FREE',
        maxUnits: '1',
        maxMicrousd: '0',
        costEvidence: `free-quota-${nonce}`,
        quoteTtlSeconds: 300,
        timeoutMs: 5_000,
        maxResponseBytes: 1_000_000,
      },
      contentPolicy: {
        policyVersion: `rights-${nonce}`,
        sourceId,
        contractVersion: `contract-${nonce}`,
        rightsStatus: 'VERIFIED',
        rightsEvidenceIds: [rights.id],
        retention: 'EPHEMERAL_TEXT',
        maxRetentionSeconds: 3_600,
        deletionMode: 'POLL_OR_WEBHOOK_VERIFIED',
        deletionCheckMaxAgeSeconds: 3_600,
        externalAi: 'PROHIBITED',
        verifiedAt: '2026-08-30T00:00:00.000Z',
        expiresAt: '2026-09-30T00:00:00.000Z',
      },
      search: {
        path: '/v1/search',
        queryParameter: 'q',
        cursorParameter: 'cursor',
        countParameter: 'limit',
        latestParameter: null,
        latestValue: null,
        maxCount: 100,
        maxQueryChars: 512,
        itemsPath: ['data'],
        cursorPath: ['next'],
        missingCursorMeansEnd: true,
        successPath: null,
        successValue: null,
        idPath: ['id'],
        textPath: ['text'],
        createdAtPath: ['createdAt'],
        authorIdPath: ['authorId'],
        authorHandlePath: ['authorHandle'],
        temporal: {
          sinceParameter: 'from',
          untilParameter: 'until',
          precision: 'INSTANT',
          untilMode: 'EXCLUSIVE',
          overlapSeconds: 60,
        },
      },
    };
    await database.query(
      `INSERT INTO data_procurement_ledgers (scope_id, policy, state, revision)
       VALUES ($1, $2::jsonb, $3::jsonb, 0)`,
      [
        scopeId,
        JSON.stringify({ version: `policy-${nonce}`, paidAllowed: false, approvedProviderIds: [] }),
        JSON.stringify({
          revision: 0,
          remainingMicrousd: '0',
          accounts: {
            [accountId]: {
              providerIds: [sourceId],
              allowedCostKind: 'FREE_ONLY',
              quotaRemaining: '2',
              costEvidence: source.dispatch.costEvidence,
              enabled: true,
              rightsApproved: true,
            },
          },
          tickets: {},
          blocked: false,
        }),
      ],
    );
    const reserved = await procurement.reserve(
      scopeId,
      {
        requestId,
        fingerprint: 'page-fingerprint',
        providerId: sourceId,
        accountId,
        costKind: 'VERIFIED_FREE',
        maxUnits: '1',
        maxMicrousd: '0',
        evidence: source.dispatch.costEvidence,
        expiresAt: Date.parse(observedAt) + 300_000,
      },
      Date.parse(observedAt),
    );
    await procurement.dispatch(scopeId, requestId, reserved.policy.version, Date.parse(observedAt));
    const window = await observations.create({
      ledger: 'EVM',
      chainId: 'eip155:56',
      assetKey: `BSC:0x${nonce.padEnd(40, '0')}`,
      queryRole: 'IDENTITY',
      approvedQuery: `0x${nonce.padEnd(40, '0')}`,
      providerId: sourceId,
      queryVersion: `query-${nonce}`,
      contractVersion: source.contractVersion,
      temporalContract: source.search!.temporal!,
      contentPolicyVersion: source.contentPolicy.policyVersion,
      rightsEvidenceIds: [rights.id],
      from: '2026-08-30T00:00:00.000Z',
      until: '2026-09-01T00:00:00.000Z',
      pageSize: 10,
    });
    const secondWindow = await observations.create({
      ledger: window.ledger,
      chainId: window.chainId,
      assetKey: window.assetKey,
      queryRole: 'COUNTER_EVIDENCE',
      approvedQuery: `${window.approvedQuery} -is:reply`,
      providerId: window.window.providerId,
      queryVersion: window.window.queryVersion,
      contractVersion: window.window.contractVersion,
      temporalContract: window.temporalContract,
      contentPolicyVersion: window.contentPolicyVersion,
      rightsEvidenceIds: window.rightsEvidenceIds,
      from: window.window.from,
      until: window.window.until,
      pageSize: window.pageSize,
    });
    const firstListPage = await observations.list({ limit: 1 });
    expect(firstListPage.records).toHaveLength(1);
    expect(firstListPage.nextCursor).not.toBeNull();
    const secondListPage = await observations.list({
      limit: 1,
      after: firstListPage.nextCursor!,
    });
    expect(secondListPage.records).toHaveLength(1);
    expect(
      new Set([firstListPage.records[0]?.window.id, secondListPage.records[0]?.window.id]),
    ).toEqual(new Set([window.window.id, secondWindow.window.id]));
    expect(secondListPage.nextCursor).toBeNull();
    const post = {
      id: `${BigInt(`0x${nonce}`) + 1n}`,
      text: '集成测试帖子，不是链上事实。',
      createdAt: '2026-08-30T23:59:00.000Z',
      observedAt,
      authorId: null,
      authorHandle: 'zerotrace_test',
      sourceId,
      upstreamGroup: 'X' as const,
      permalink: `https://x.com/i/status/${BigInt(`0x${nonce}`) + 1n}`,
    };
    const record = prepareExternalContentRecord(source, post, observedAt);
    const postEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'PROVIDER_OBSERVATION',
      source: sourceId,
      locator: `social:${sourceId}:${post.id}`,
      sourceUri: post.permalink,
      payload: record,
      observedAt,
      summary: '集成测试中的 X 上游只读帖子观察。',
    });
    await evidence.put(postEvidence);
    const page = { posts: [post], nextCursor: null };
    const committed = await observations.commitPage({
      windowId: window.window.id,
      procurementRequestId: requestId,
      page,
      records: [record],
      evidenceIds: [postEvidence.id],
      settlement: { scopeId, units: '1', microusd: '0' },
    });
    expect(committed.window.window).toMatchObject({
      completed: true,
      pages: 1,
      revision: 1,
      coverage: 'ACCESSIBLE_QUERY_RESULTS_PROCESSED',
    });
    expect(committed.receipt).toMatchObject({
      recordsPersisted: 1,
      procurementRequestId: requestId,
      evidenceIds: [postEvidence.id],
    });
    await expect(observations.getObservation(sourceId, post.id)).resolves.toMatchObject({
      record: { state: 'ACTIVE', text: post.text },
      revision: 1,
    });
    await expect(procurement.get(scopeId)).resolves.toMatchObject({
      state: {
        revision: 3,
        accounts: { [accountId]: { quotaRemaining: '1' } },
        tickets: { [requestId]: { state: 'SETTLED', actualUnits: '1', actualMicrousd: '0' } },
      },
    });
    await expect(
      observations.commitPage({
        windowId: window.window.id,
        procurementRequestId: requestId,
        page,
        records: [record],
        evidenceIds: [postEvidence.id],
        settlement: { scopeId, units: '1', microusd: '0' },
      }),
    ).resolves.toEqual(committed);
    await expect(
      observations.commitPage({
        windowId: window.window.id,
        procurementRequestId: requestId,
        page: { posts: [post], nextCursor: 'conflict' },
        records: [record],
        evidenceIds: [postEvidence.id],
        settlement: { scopeId, units: '1', microusd: '0' },
      }),
    ).rejects.toMatchObject({ code: 'SOCIAL_OBSERVATION_CONFLICT' });

    const tombstone = tombstoneExternalContent(record, {
      deletedAt: '2026-08-31T00:01:00.000Z',
      reason: 'UPSTREAM_DELETED',
      evidenceIds: [rights.id],
    });
    const tombstoneEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'PROVIDER_OBSERVATION',
      source: sourceId,
      locator: `social-tombstone:${sourceId}:${post.id}`,
      payload: tombstone,
      observedAt: tombstone.deletedAt,
      summary: '集成测试中的上游删除观察。',
    });
    await evidence.put(tombstoneEvidence);
    await observations.tombstone({
      ledger: 'EVM',
      chainId: 'eip155:56',
      tombstone,
      evidenceId: tombstoneEvidence.id,
    });
    const stored = await database.query(
      `SELECT state, payload, revision FROM social_observations
       WHERE source_id = $1 AND post_id = $2`,
      [sourceId, post.id],
    );
    expect(stored.rows[0]).toMatchObject({
      state: 'TOMBSTONED',
      revision: '2',
      payload: expect.not.objectContaining({ text: expect.anything() }),
    });
    await expect(observations.getObservation(sourceId, post.id)).resolves.toMatchObject({
      record: expect.objectContaining({ state: 'TOMBSTONED', reason: 'UPSTREAM_DELETED' }),
      revision: 2,
    });
    const events = await database.query(
      `SELECT payload FROM social_observation_events
       WHERE source_id = $1 AND post_id = $2 ORDER BY created_at, event_id`,
      [sourceId, post.id],
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows.every((row) => !Object.hasOwn(row.payload as object, 'text'))).toBe(true);
  });
});
