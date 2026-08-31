import { describe, expect, it, vi } from 'vitest';

import {
  authorizeExternalAiTransfer,
  externalContentPolicyStatus,
  prepareExternalContentRecord,
  tombstoneExternalContent,
  type ExternalContentRightsPolicy,
} from './external-content.js';
import {
  FXEMBED_TEMPLATE,
  fetchSearchPage,
  makeSearchPlan,
  normalizeSearchPage,
  XAPID_TEMPLATE,
  type SocialPost,
  type SocialSourceConfig,
} from './social-source.js';

const rightsEvidence = `ev_${'1'.repeat(24)}`;
const deletionEvidence = `ev_${'2'.repeat(24)}`;

function configuredSource(
  overrides: Partial<ExternalContentRightsPolicy> = {},
): SocialSourceConfig {
  const now = Date.now();
  return {
    ...structuredClone(FXEMBED_TEMPLATE),
    enabled: true,
    rightsApproved: true,
    dispatch: {
      accountId: 'fxembed-free-test',
      costKind: 'VERIFIED_FREE',
      maxUnits: '1',
      maxMicrousd: '0',
      costEvidence: 'fxembed-free-test-evidence',
      quoteTtlSeconds: 300,
      timeoutMs: 5_000,
      maxResponseBytes: 1_000_000,
    },
    contentPolicy: {
      policyVersion: 'fxembed-rights-test-v1',
      sourceId: 'fxembed',
      contractVersion: FXEMBED_TEMPLATE.contractVersion,
      rightsStatus: 'VERIFIED',
      rightsEvidenceIds: [rightsEvidence],
      retention: 'EPHEMERAL_TEXT',
      maxRetentionSeconds: 3_600,
      deletionMode: 'POLL_OR_WEBHOOK_VERIFIED',
      deletionCheckMaxAgeSeconds: 600,
      externalAi: 'RIGHTS_GATED',
      verifiedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 86_400_000).toISOString(),
      ...overrides,
    },
  };
}

function post(observedAt = new Date().toISOString()): SocialPost {
  return {
    id: '123456789',
    text: '测试外部内容',
    createdAt: new Date(Date.parse(observedAt) - 1_000).toISOString(),
    observedAt,
    authorId: '987654321',
    authorHandle: 'test-user',
    sourceId: 'fxembed',
    upstreamGroup: 'X',
    permalink: 'https://x.com/i/status/123456789',
  };
}

describe('external content rights, deletion, and AI boundary', () => {
  it('requires an active content policy before network planning or text retention', () => {
    expect(externalContentPolicyStatus(XAPID_TEMPLATE)).toBe('UNCONFIGURED');
    expect(() => makeSearchPlan(XAPID_TEMPLATE, 'query', 'query-v1')).toThrow('SOURCE_NOT_READY');

    const source = configuredSource();
    expect(externalContentPolicyStatus(source)).toBe('READY');
    expect(makeSearchPlan(source, 'query', 'query-v1')).toMatchObject({
      sourceId: 'fxembed',
      contractVersion: FXEMBED_TEMPLATE.contractVersion,
      contentPolicyVersion: 'fxembed-rights-test-v1',
      rightsEvidenceIds: [rightsEvidence],
    });
  });

  it('maps exact and UTC-date observation windows without claiming broader coverage', () => {
    const exactSource = configuredSource();
    exactSource.search!.temporal = {
      sinceParameter: 'from',
      untilParameter: 'until',
      precision: 'INSTANT',
      untilMode: 'EXCLUSIVE',
      overlapSeconds: 60,
    };
    const exact = makeSearchPlan(exactSource, 'query', 'query-v1', null, 30, {
      from: '2026-08-30T00:00:00.000Z',
      until: '2026-09-01T00:00:00.000Z',
    });
    expect(new URL(exact.url).searchParams.get('from')).toBe('2026-08-29T23:59:00.000Z');
    expect(new URL(exact.url).searchParams.get('until')).toBe('2026-09-01T00:00:00.000Z');
    expect(exact.temporalWindow).toEqual({
      requestedFrom: '2026-08-30T00:00:00.000Z',
      requestedUntil: '2026-09-01T00:00:00.000Z',
      queryFrom: '2026-08-29T23:59:00.000Z',
      queryUntil: '2026-09-01T00:00:00.000Z',
      precision: 'INSTANT',
      untilMode: 'EXCLUSIVE',
      overlapSeconds: 60,
    });

    const dateSource = configuredSource();
    const datePlan = makeSearchPlan(dateSource, 'query', 'query-v1', null, 30, {
      from: '2026-08-30T12:30:00.000Z',
      until: '2026-09-01T00:00:00.000Z',
    });
    expect(new URL(datePlan.url).searchParams.get('since')).toBe('2026-08-30');
    expect(new URL(datePlan.url).searchParams.get('until')).toBe('2026-08-31');
    expect(datePlan.temporalWindow).toMatchObject({
      requestedFrom: '2026-08-30T12:30:00.000Z',
      requestedUntil: '2026-09-01T00:00:00.000Z',
      precision: 'UTC_DATE',
      untilMode: 'INCLUSIVE',
    });

    const withoutTemporal = configuredSource();
    withoutTemporal.search!.temporal = null;
    expect(() =>
      makeSearchPlan(withoutTemporal, 'query', 'query-v1', null, 30, {
        from: '2026-08-30T00:00:00.000Z',
        until: '2026-09-01T00:00:00.000Z',
      }),
    ).toThrow('TEMPORAL_CONTRACT_UNAVAILABLE');

    const invalidTemporal = configuredSource();
    invalidTemporal.search!.temporal = {
      ...invalidTemporal.search!.temporal!,
      precision: 'MINUTE' as 'INSTANT',
    };
    expect(() => makeSearchPlan(invalidTemporal, 'query', 'query-v1')).toThrow(
      'INVALID_TEMPORAL_CONTRACT',
    );
  });

  it('creates a bounded record and a rights/evidence-preserving deletion tombstone', () => {
    const observedAt = new Date().toISOString();
    const source = configuredSource();
    const record = prepareExternalContentRecord(source, post(observedAt), observedAt);
    expect(record).toMatchObject({
      state: 'ACTIVE',
      text: '测试外部内容',
      policyVersion: 'fxembed-rights-test-v1',
    });
    expect(record.retainUntil).not.toBeNull();
    expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const tombstone = tombstoneExternalContent(record, {
      deletedAt: new Date(Date.parse(observedAt) + 1_000).toISOString(),
      reason: 'UPSTREAM_DELETED',
      evidenceIds: [deletionEvidence],
    });
    expect(tombstone).not.toHaveProperty('text');
    expect(tombstone.evidenceIds).toEqual([rightsEvidence, deletionEvidence].sort());
    expect(() =>
      authorizeExternalAiTransfer(
        source,
        tombstone,
        new Date(Date.parse(observedAt) + 2_000).toISOString(),
      ),
    ).toThrow('EXTERNAL_CONTENT_AI_TRANSFER_NOT_AUTHORIZED');
  });

  it('issues an AI authorization only for retained text with fresh deletion checks', () => {
    const observedAt = new Date().toISOString();
    const source = configuredSource();
    const record = prepareExternalContentRecord(source, post(observedAt), observedAt);
    expect(authorizeExternalAiTransfer(source, record, observedAt)).toEqual({
      externalAiApproved: true,
      sourceId: 'fxembed',
      postId: '123456789',
      policyVersion: 'fxembed-rights-test-v1',
      rightsEvidenceIds: [rightsEvidence],
      deletionCheckedAt: observedAt,
    });

    const metadataOnly = configuredSource({
      retention: 'METADATA_ONLY',
      maxRetentionSeconds: null,
    });
    const metadataRecord = prepareExternalContentRecord(metadataOnly, post(observedAt), observedAt);
    expect(metadataRecord.text).toBeNull();
    expect(() => authorizeExternalAiTransfer(metadataOnly, metadataRecord, observedAt)).toThrow(
      'EXTERNAL_CONTENT_AI_TRANSFER_NOT_AUTHORIZED',
    );
  });

  it('rejects unverified deletion support, expired rights, and stale deletion checks', () => {
    const now = Date.now();
    expect(externalContentPolicyStatus(configuredSource({ deletionMode: 'UNVERIFIED' }))).toBe(
      'INACTIVE',
    );
    expect(
      externalContentPolicyStatus(
        configuredSource({ expiresAt: new Date(now - 1_000).toISOString() }),
      ),
    ).toBe('INACTIVE');
    const source = configuredSource({ deletionCheckMaxAgeSeconds: 60 });
    const observedAt = new Date(now).toISOString();
    expect(() =>
      prepareExternalContentRecord(source, post(observedAt), new Date(now - 61_000).toISOString()),
    ).toThrow('EXTERNAL_CONTENT_DELETION_CHECK_STALE');
  });

  it('enforces pagination schema, explicit terminal cursor, and one-shot dispatch leases', async () => {
    const source = configuredSource();
    const observedAt = new Date().toISOString();
    const item = {
      id: '123456789',
      text: '测试外部内容',
      created_at: observedAt,
      author: { id: '987654321', screen_name: 'test-user' },
    };
    expect(
      normalizeSearchPage(
        source,
        { code: 200, results: [item], cursor: { bottom: null } },
        observedAt,
      ),
    ).toMatchObject({ posts: [{ id: '123456789' }], nextCursor: null });
    expect(() => normalizeSearchPage(source, { code: 200, results: [item] }, observedAt)).toThrow(
      'MISSING_CURSOR_CONTRACT',
    );

    const plan = makeSearchPlan(source, 'query', 'query-v1');
    let claimed = false;
    let fetches = 0;
    const dependencies = {
      approvePublicOrigin: async () => true,
      claimDispatch: async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      readSecret: async () => '',
      fetcher: async () => {
        fetches += 1;
        return new Response(
          JSON.stringify({ code: 200, results: [item], cursor: { bottom: 'cursor-2' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    };
    await expect(
      fetchSearchPage(
        source,
        plan,
        dependencies,
        { timeoutMs: 1_000, maxBytes: 10_000 },
        observedAt,
      ),
    ).resolves.toMatchObject({ nextCursor: 'cursor-2' });
    await expect(
      fetchSearchPage(
        source,
        plan,
        dependencies,
        { timeoutMs: 1_000, maxBytes: 10_000 },
        observedAt,
      ),
    ).rejects.toThrow('BUDGET_OR_DISPATCH_NOT_APPROVED');
    expect(fetches).toBe(1);
  });

  it('rejects a tampered temporal plan before egress approval or dispatch', async () => {
    const source = configuredSource();
    const plan = makeSearchPlan(source, 'query', 'query-v1', null, 30, {
      from: '2026-08-30T00:00:00.000Z',
      until: '2026-09-01T00:00:00.000Z',
    });
    const tampered = {
      ...plan,
      url: plan.url.replace('until=2026-08-31', 'until=2026-09-01'),
    };
    const approvePublicOrigin = vi.fn(async () => true);
    const claimDispatch = vi.fn(async () => true);
    const fetcher = vi.fn();
    await expect(
      fetchSearchPage(
        source,
        tampered,
        {
          approvePublicOrigin,
          claimDispatch,
          fetcher,
          readSecret: async () => '',
        },
        { timeoutMs: 1_000, maxBytes: 10_000 },
        '2026-08-31T00:00:00.000Z',
      ),
    ).rejects.toThrow('PLAN_TEMPORAL_CONTRACT_MISMATCH');
    expect(approvePublicOrigin).not.toHaveBeenCalled();
    expect(claimDispatch).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      fetchSearchPage(
        source,
        {
          ...plan,
          temporalWindow: {
            ...plan.temporalWindow!,
            requestedUntil: '2026-09-02T00:00:00.000Z',
          },
        },
        {
          approvePublicOrigin,
          claimDispatch,
          fetcher,
          readSecret: async () => '',
        },
        { timeoutMs: 1_000, maxBytes: 10_000 },
        '2026-08-31T00:00:00.000Z',
      ),
    ).rejects.toThrow('PLAN_TEMPORAL_CONTRACT_MISMATCH');
    expect(approvePublicOrigin).not.toHaveBeenCalled();
  });
});
