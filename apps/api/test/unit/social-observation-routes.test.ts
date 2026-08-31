import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExternalContentTombstone, SocialSourceConfig } from '@zerotrace/provider-plane';
import type { StoredSocialObservation } from '@zerotrace/storage';

import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { createRuntime, type AppRuntime } from '../../src/runtime.js';

function baseConfig(): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 8080,
    corsOrigins: ['http://localhost:5173'],
    logLevel: 'silent',
    requestTimeoutMs: 1_000,
    healthCacheTtlMs: 0,
    providerAllowedHosts: [],
    allowPrivateProviderUrls: false,
    providerResilience: {
      maxAttempts: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      circuitFailureThreshold: 5,
      circuitResetMs: 30_000,
      cacheTtlMs: 0,
      cacheMaxEntries: 100,
    },
    dataQualityMinSources: 2,
    ethereumRpcUrls: [],
    ethereumChainId: 1,
    ethereumSnapshotTag: 'finalized',
    ethereumRequestsPerSecond: 0,
    bscRpcUrls: [],
    bscChainId: 56,
    bscSnapshotTag: 'finalized',
    bscRequestsPerSecond: 0,
    bitcoinEsploraUrls: [],
    bitcoinEsploraRequestsPerSecond: 0,
    solanaRpcUrls: [],
    solanaRequestsPerSecond: 0,
    solanaCommitment: 'finalized',
    sourcifyRequestsPerSecond: 0,
    gmgnConfigured: false,
    jupiterConfigured: false,
    etherscanConfigured: false,
    duneConfigured: false,
    nansenConfigured: false,
    arkhamConfigured: false,
    providerSlotStatus: {
      NODEREAL_API_KEY: 'UNCONFIGURED',
      ANKR_API_KEY: 'UNCONFIGURED',
      CHAINSTACK_BSC_RPC_URL: 'UNCONFIGURED',
      DRPC_API_KEY: 'UNCONFIGURED',
      HELIUS_API_KEY: 'UNCONFIGURED',
      BSC_TRACE_RPC_URL: 'UNCONFIGURED',
    },
    bscTraceRpcAuthType: 'none',
    bscTraceOperatorId: 'bsc-trace-slot',
    storageProfile: 'LOW_COST_CASE',
    storageRoot: '/tmp/zerotrace-social-observation-routes-test',
    localDevAuth: false,
  };
}

function readySource(rightsId: string): SocialSourceConfig {
  return {
    id: 'verified-social',
    origin: 'https://verified-social.example.com',
    identityVerified: true,
    rightsApproved: true,
    enabled: true,
    contractVersion: 'contract-v1',
    upstreamGroup: 'X',
    documentation: 'https://verified-social.example.com/docs',
    authentication: { kind: 'NONE', secretRef: null, headerName: null },
    dispatch: {
      accountId: 'verified-social-free',
      costKind: 'VERIFIED_FREE',
      maxUnits: '1',
      maxMicrousd: '0',
      costEvidence: 'verified-free-entitlement-v1',
      quoteTtlSeconds: 300,
      timeoutMs: 5_000,
      maxResponseBytes: 1_000_000,
    },
    contentPolicy: {
      policyVersion: 'rights-v1',
      sourceId: 'verified-social',
      contractVersion: 'contract-v1',
      rightsStatus: 'VERIFIED',
      rightsEvidenceIds: [rightsId],
      retention: 'EPHEMERAL_TEXT',
      maxRetentionSeconds: 3_600,
      deletionMode: 'POLL_OR_WEBHOOK_VERIFIED',
      deletionCheckMaxAgeSeconds: 3_600,
      externalAi: 'PROHIBITED',
      verifiedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2027-08-01T00:00:00.000Z',
    },
    search: {
      path: '/v1/search',
      queryParameter: 'query',
      cursorParameter: 'cursor',
      countParameter: 'limit',
      latestParameter: null,
      latestValue: null,
      maxCount: 100,
      maxQueryChars: 512,
      itemsPath: ['data'],
      cursorPath: ['nextCursor'],
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
}

function fakeWindow(overrides: Record<string, unknown> = {}) {
  return {
    window: {
      id: `sow_${'a'.repeat(24)}`,
      providerId: 'verified-social',
      queryVersion: 'query-v1',
      contractVersion: 'contract-v1',
      from: '2026-08-30T00:00:00.000Z',
      until: '2026-09-01T00:00:00.000Z',
      cursor: null,
      completed: false,
      pages: 0,
      revision: 0,
      usedCursors: [],
      receiptIds: [],
      receiptSignatures: [],
      coverage: 'NOT_COMPLETE' as const,
    },
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    assetKey: `BSC:0x${'a'.repeat(40)}`,
    queryRole: 'IDENTITY',
    approvedQuery: `0x${'a'.repeat(40)}`,
    pageSize: 10,
    temporalContract: {
      sinceParameter: 'from',
      untilParameter: 'until',
      precision: 'INSTANT' as const,
      untilMode: 'EXCLUSIVE' as const,
      overlapSeconds: 60,
    },
    contentPolicyVersion: 'rights-v1',
    rightsEvidenceIds: [`ev_${'a'.repeat(24)}`],
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

describe('durable social observation routes', () => {
  const apps: Awaited<ReturnType<typeof createApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it('persists query windows, dispatches one free page, and replays the idempotency receipt', async () => {
    const config = baseConfig();
    const runtime = createRuntime(config);
    const rightsId = `ev_${'a'.repeat(24)}`;
    const source: SocialSourceConfig = {
      id: 'xapid',
      origin: 'https://verified-social.example.com',
      identityVerified: true,
      rightsApproved: true,
      enabled: true,
      contractVersion: 'xapid-contract-v1',
      upstreamGroup: 'X' as const,
      documentation: 'https://verified-social.example.com/docs',
      authentication: { kind: 'NONE' as const, secretRef: null, headerName: null },
      dispatch: {
        accountId: 'xapid-free',
        costKind: 'VERIFIED_FREE' as const,
        maxUnits: '1',
        maxMicrousd: '0',
        costEvidence: 'verified-free-entitlement-v1',
        quoteTtlSeconds: 300,
        timeoutMs: 5_000,
        maxResponseBytes: 1_000_000,
      },
      contentPolicy: {
        policyVersion: 'xapid-rights-v1',
        sourceId: 'xapid',
        contractVersion: 'xapid-contract-v1',
        rightsStatus: 'VERIFIED' as const,
        rightsEvidenceIds: [rightsId],
        retention: 'METADATA_ONLY' as const,
        maxRetentionSeconds: null,
        deletionMode: 'UNVERIFIED' as const,
        deletionCheckMaxAgeSeconds: 3600,
        externalAi: 'PROHIBITED' as const,
        verifiedAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2027-08-01T00:00:00.000Z',
      },
      search: {
        path: '/v1/search',
        queryParameter: 'query',
        cursorParameter: 'cursor',
        countParameter: 'limit',
        latestParameter: null,
        latestValue: null,
        maxCount: 100,
        maxQueryChars: 512,
        itemsPath: ['data'],
        cursorPath: ['nextCursor'],
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
    runtime.socialSources = [source];
    const windows = new Map<
      string,
      {
        window: {
          id: string;
          providerId: string;
          queryVersion: string;
          contractVersion: string;
          from: string;
          until: string;
          cursor: string | null;
          completed: boolean;
          pages: number;
          revision: number;
          usedCursors: string[];
          receiptIds: string[];
          receiptSignatures: { id: string; signature: string }[];
          coverage: 'NOT_COMPLETE' | 'ACCESSIBLE_QUERY_RESULTS_PROCESSED';
        };
        ledger: 'EVM';
        chainId: string;
        assetKey: string;
        queryRole: string;
        approvedQuery: string;
        pageSize: number;
        temporalContract: NonNullable<NonNullable<SocialSourceConfig['search']>['temporal']>;
        contentPolicyVersion: string;
        rightsEvidenceIds: string[];
        createdAt: string;
        updatedAt: string;
      }
    >();
    const receipts = new Map<string, Record<string, unknown>>();
    let windowCounter = 0;
    const create = vi.fn(async (input: Record<string, unknown>) => {
      windowCounter += 1;
      const id = `sow_${windowCounter.toString(16).padStart(24, '0')}`;
      const record = {
        window: {
          id,
          providerId: String(input.providerId),
          queryVersion: String(input.queryVersion),
          contractVersion: String(input.contractVersion),
          from: String(input.from),
          until: String(input.until),
          cursor: null,
          completed: false,
          pages: 0,
          revision: 0,
          usedCursors: [],
          receiptIds: [],
          receiptSignatures: [],
          coverage: 'NOT_COMPLETE' as const,
        },
        ledger: 'EVM' as const,
        chainId: String(input.chainId),
        assetKey: String(input.assetKey),
        queryRole: String(input.queryRole),
        approvedQuery: String(input.approvedQuery),
        pageSize: Number(input.pageSize),
        temporalContract: input.temporalContract as NonNullable<
          NonNullable<SocialSourceConfig['search']>['temporal']
        >,
        contentPolicyVersion: String(input.contentPolicyVersion),
        rightsEvidenceIds: [...(input.rightsEvidenceIds as string[])],
        createdAt: '2026-08-31T00:00:00.000Z',
        updatedAt: '2026-08-31T00:00:00.000Z',
      };
      windows.set(id, record);
      return record;
    });
    const get = vi.fn(async (id: string) => {
      const record = windows.get(id);
      if (record === undefined) throw new Error('missing');
      return record;
    });
    const receiptForRequest = vi.fn(async (requestId: string) => receipts.get(requestId));
    const list = vi.fn(async () => ({ records: [...windows.values()], nextCursor: null }));
    const commitPage = vi.fn(async (input: Record<string, unknown>) => {
      const record = windows.get(String(input.windowId));
      if (record === undefined) throw new Error('missing');
      const updated = {
        ...record,
        window: {
          ...record.window,
          completed: true,
          pages: 1,
          revision: 1,
          coverage: 'ACCESSIBLE_QUERY_RESULTS_PROCESSED' as const,
        },
      };
      windows.set(record.window.id, updated);
      const receipt = {
        receiptId: `sor_${'b'.repeat(24)}`,
        windowId: record.window.id,
        pageRevision: 0,
        requestedCursor: null,
        nextCursor: null,
        recordsPersisted: 1,
        normalizedPageHash: 'c'.repeat(64),
        evidenceIds: [`ev_${'d'.repeat(24)}`],
        procurementRequestId: String(input.procurementRequestId),
        createdAt: '2026-08-31T00:00:01.000Z',
      };
      receipts.set(receipt.procurementRequestId, receipt);
      return { window: updated, receipt };
    });
    runtime.socialObservations = {
      create,
      get,
      list,
      receiptForRequest,
      commitPage,
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    const reserve = vi.fn(async () => ({ policy: { version: 'data-policy-v11.0' } }));
    const dispatch = vi.fn(async () => ({}));
    const finish = vi.fn(async () => ({}));
    runtime.dataProcurement = {
      reserve,
      dispatch,
      finish,
    } as unknown as NonNullable<AppRuntime['dataProcurement']>;
    runtime.evidenceRepository = {
      get: vi.fn(async (id: string) => (id === rightsId ? { evidence: { id } } : undefined)),
      put: vi.fn(async (evidence: { id: string }) => ({ evidence })),
    } as unknown as NonNullable<AppRuntime['evidenceRepository']>;
    const fetcher = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: '123456789',
                text: '只读观察',
                createdAt: '2026-08-31T00:00:00.000Z',
                authorId: '987654321',
                authorHandle: 'zerotrace_test',
              },
              {
                id: '123456790',
                text: '窗口外观察不得落库',
                createdAt: '2026-09-01T00:00:00.000Z',
                authorId: '987654321',
                authorHandle: 'zerotrace_test',
              },
            ],
            nextCursor: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    runtime.socialFetchDependencies = {
      fetcher,
      approvePublicOrigin: vi.fn(async () => true),
      readSecret: vi.fn(async () => {
        throw new Error('unexpected secret read');
      }),
    };
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-windows',
      payload: {
        providerId: 'xapid',
        queryVersion: 'query-v1',
        pageSize: 25,
        from: '2026-08-30T00:00:00.000Z',
        until: '2026-09-01T00:00:00.000Z',
        identity: { chain: 'BSC', address: `0x${'a'.repeat(40)}` },
      },
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({
      networkRequestPerformed: false,
      windows: expect.arrayContaining([
        expect.objectContaining({ providerId: 'xapid', coverage: 'NOT_COMPLETE' }),
      ]),
    });
    const windowId = String(created.json().windows[0].id);
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/research/social-observation-windows?limit=10',
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      records: expect.arrayContaining([expect.objectContaining({ id: windowId })]),
      nextCursor: null,
    });
    const invalidCursor = await app.inject({
      method: 'GET',
      url: '/api/v1/research/social-observation-windows?after=bad&limit=10',
    });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json().error.code).toBe('INVALID_SOCIAL_OBSERVATION_CURSOR');
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/research/social-observation-windows/${windowId}/fetch-next`,
      payload: { idempotencyKey: 'operator-attempt-1' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      replayed: false,
      networkRequestPerformed: true,
      window: { completed: true, coverage: 'ACCESSIBLE_QUERY_RESULTS_PROCESSED' },
    });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(commitPage).toHaveBeenCalledWith(
      expect.objectContaining({
        settlement: { scopeId: 'global', units: '1', microusd: '0' },
      }),
    );
    const committedInput = commitPage.mock.calls[0]?.[0] as {
      page: { posts: Array<{ id: string }> };
      records: unknown[];
      evidenceIds: string[];
    };
    expect(committedInput.page.posts.map((post) => post.id)).toEqual(['123456789']);
    expect(committedInput.records).toHaveLength(1);
    expect(committedInput.evidenceIds).toHaveLength(1);
    expect(finish).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('from=2026-08-29T23%3A59%3A00.000Z');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('until=2026-09-01T00%3A00%3A00.000Z');

    const replayed = await app.inject({
      method: 'POST',
      url: `/api/v1/research/social-observation-windows/${windowId}/fetch-next`,
      payload: { idempotencyKey: 'operator-attempt-1' },
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({ replayed: true, networkRequestPerformed: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it('keeps xapid disabled and performs no network request while its identity is unknown', async () => {
    const config = baseConfig();
    const runtime = createRuntime(config);
    const fetcher = vi.fn();
    runtime.socialFetchDependencies = {
      fetcher,
      approvePublicOrigin: vi.fn(async () => true),
      readSecret: vi.fn(async () => ''),
    };
    runtime.socialObservations = {} as NonNullable<AppRuntime['socialObservations']>;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-windows',
      payload: {
        providerId: 'xapid',
        queryVersion: 'query-v1',
        from: '2026-08-30T00:00:00.000Z',
        until: '2026-09-01T00:00:00.000Z',
        identity: { chain: 'BSC', address: `0x${'1'.repeat(40)}` },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({
      code: 'RESEARCH_SOURCE_NOT_READY',
      sourceStatus: 'UNVERIFIED_IDENTITY',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed across storage, contract, budget, dispatch, pagination, and deletion boundaries', async () => {
    const config = baseConfig();
    const runtime = createRuntime(config);
    const rightsId = `ev_${'a'.repeat(24)}`;
    const windowId = `sow_${'a'.repeat(24)}`;
    const source = readySource(rightsId);
    const windowRecord = fakeWindow();
    const completedWindow = {
      ...windowRecord,
      window: {
        ...windowRecord.window,
        completed: true,
        coverage: 'ACCESSIBLE_QUERY_RESULTS_PROCESSED' as const,
      },
    };
    const createPayload = {
      providerId: source.id,
      queryVersion: 'query-v1',
      pageSize: 10,
      from: '2026-08-30T00:00:00.000Z',
      until: '2026-09-01T00:00:00.000Z',
      identity: { chain: 'BSC', address: `0x${'a'.repeat(40)}` },
    };
    const fetchUrl = `/api/v1/research/social-observation-windows/${windowId}/fetch-next`;
    const fetchPayload = { idempotencyKey: 'fail-closed-attempt' };
    const activeObservation: StoredSocialObservation = {
      ledger: 'EVM',
      chainId: 'eip155:56',
      record: {
        state: 'ACTIVE',
        sourceId: source.id,
        upstreamGroup: 'X',
        postId: '123456789',
        text: '删除前的临时正文',
        contentHash: 'b'.repeat(64),
        createdAt: '2026-08-30T23:00:00.000Z',
        observedAt: '2026-08-31T00:00:00.000Z',
        deletionCheckedAt: '2026-08-31T00:00:00.000Z',
        retainUntil: '2026-09-01T00:00:00.000Z',
        policyVersion: 'rights-v1',
        contractVersion: 'contract-v1',
        rightsEvidenceIds: [rightsId],
      },
      evidenceId: `ev_${'b'.repeat(24)}`,
      revision: 1,
      firstObservedAt: '2026-08-31T00:00:00.000Z',
      lastObservedAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    };
    const evidencePut = vi.fn(async (evidence: { id: string }) => ({ evidence }));
    const evidenceGet = vi.fn(async (id: string) =>
      id === rightsId ? { evidence: { id } } : undefined,
    );
    const durableEvidence = {
      get: evidenceGet,
      put: evidencePut,
    } as unknown as NonNullable<AppRuntime['evidenceRepository']>;
    const readyProcurement = {
      get: vi.fn(async () => ({
        state: { remainingMicrousd: '0', blocked: false, revision: 3 },
        policy: { version: 'data-policy-v11.0', paidAllowed: false },
        updatedAt: '2026-08-31T00:00:00.000Z',
      })),
      reserve: vi.fn(async () => ({ policy: { version: 'data-policy-v11.0' } })),
      dispatch: vi.fn(async () => ({})),
      finish: vi.fn(async () => ({})),
    } as unknown as NonNullable<AppRuntime['dataProcurement']>;
    const readyTransport = {
      fetcher: vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [], nextCursor: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
      approvePublicOrigin: vi.fn(async () => true),
      readSecret: vi.fn(async () => ''),
    };
    const baseStore = () =>
      ({
        create: vi.fn(async () => windowRecord),
        get: vi.fn(async () => windowRecord),
        list: vi.fn(async () => ({ records: [windowRecord], nextCursor: null })),
        receiptForRequest: vi.fn(async () => undefined),
        commitPage: vi.fn(async () => {
          throw new Error('UNEXPECTED_COMMIT');
        }),
        getObservation: vi.fn(async () => activeObservation),
        tombstone: vi.fn(async () => undefined),
      }) as unknown as NonNullable<AppRuntime['socialObservations']>;
    runtime.socialSources = [source];
    runtime.evidenceRepository = durableEvidence;
    runtime.dataProcurement = readyProcurement;
    runtime.socialFetchDependencies = readyTransport;
    runtime.socialObservations = baseStore();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const durableSettings = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/research-sources',
    });
    expect(durableSettings.statusCode).toBe(200);
    expect(durableSettings.json()).toMatchObject({
      procurement: { status: 'DURABLE', blocked: false, revision: 3 },
      sources: [expect.objectContaining({ providerId: source.id, dispatchAllowed: true })],
    });
    runtime.dataProcurement = {
      get: vi.fn(async () => {
        throw codedError('DATA_PROCUREMENT_NOT_INITIALIZED');
      }),
    } as unknown as NonNullable<AppRuntime['dataProcurement']>;
    const missingLedgerSettings = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/research-sources',
    });
    expect(missingLedgerSettings.json()).toMatchObject({
      procurement: {
        status: 'NOT_INITIALIZED',
        reason: 'DATA_PROCUREMENT_NOT_INITIALIZED',
      },
    });

    delete runtime.socialObservations;
    let response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-windows',
      payload: createPayload,
    });
    expect(response.statusCode).toBe(503);
    runtime.socialObservations = baseStore();
    runtime.socialSources = [];
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-windows',
      payload: createPayload,
    });
    expect(response.statusCode).toBe(404);
    runtime.socialSources = [source];
    delete runtime.evidenceRepository;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-windows',
      payload: createPayload,
    });
    expect(response.json().error.code).toBe('RESEARCH_RIGHTS_EVIDENCE_UNAVAILABLE');
    runtime.evidenceRepository = {
      get: vi.fn(async () => undefined),
    } as unknown as NonNullable<AppRuntime['evidenceRepository']>;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-windows',
      payload: createPayload,
    });
    expect(response.json().error.code).toBe('RESEARCH_RIGHTS_EVIDENCE_INCOMPLETE');
    runtime.evidenceRepository = durableEvidence;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-windows',
      payload: { ...createPayload, from: createPayload.until, until: createPayload.from },
    });
    expect(response.json().error.code).toBe('INVALID_SOCIAL_OBSERVATION_WINDOW');
    runtime.socialSources = [{ ...source, search: { ...source.search!, temporal: null } }];
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-windows',
      payload: createPayload,
    });
    expect(response.json().error.code).toBe('RESEARCH_SOURCE_TEMPORAL_CONTRACT_INCOMPLETE');
    runtime.socialSources = [source];

    delete runtime.socialObservations;
    response = await app.inject({
      method: 'GET',
      url: '/api/v1/research/social-observation-windows?limit=1',
    });
    expect(response.statusCode).toBe(503);
    runtime.socialObservations = {
      list: vi.fn(async () => {
        throw new Error('POSTGRES_DOWN');
      }),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'GET',
      url: '/api/v1/research/social-observation-windows?limit=1',
    });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE');
    const list = vi.fn(async () => ({
      records: [windowRecord],
      nextCursor: { updatedAt: windowRecord.updatedAt, windowId },
    }));
    runtime.socialObservations = {
      list,
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'GET',
      url: '/api/v1/research/social-observation-windows?limit=1',
    });
    expect(response.statusCode).toBe(200);
    const nextCursor = String(response.json().nextCursor);
    response = await app.inject({
      method: 'GET',
      url: `/api/v1/research/social-observation-windows?limit=1&after=${nextCursor}`,
    });
    expect(response.statusCode).toBe(200);
    expect(list).toHaveBeenLastCalledWith({
      limit: 1,
      after: { updatedAt: windowRecord.updatedAt, windowId },
    });

    delete runtime.socialObservations;
    response = await app.inject({
      method: 'GET',
      url: `/api/v1/research/social-observation-windows/${windowId}`,
    });
    expect(response.statusCode).toBe(503);
    runtime.socialObservations = {
      get: vi.fn(async () => {
        throw codedError('SOCIAL_OBSERVATION_NOT_FOUND');
      }),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'GET',
      url: `/api/v1/research/social-observation-windows/${windowId}`,
    });
    expect(response.statusCode).toBe(404);
    runtime.socialObservations = {
      get: vi.fn(async () => {
        throw new Error('POSTGRES_DOWN');
      }),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'GET',
      url: `/api/v1/research/social-observation-windows/${windowId}`,
    });
    expect(response.statusCode).toBe(503);

    delete runtime.socialObservations;
    runtime.dataProcurement = readyProcurement;
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_DURABILITY_UNAVAILABLE');
    runtime.socialObservations = {
      receiptForRequest: vi.fn(async () => ({ windowId: `sow_${'b'.repeat(24)}` })),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_IDEMPOTENCY_CONFLICT');
    runtime.socialObservations = {
      receiptForRequest: vi.fn(async () => undefined),
      get: vi.fn(async () => {
        throw codedError('SOCIAL_OBSERVATION_NOT_FOUND');
      }),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.statusCode).toBe(404);
    runtime.socialObservations = {
      receiptForRequest: vi.fn(async () => undefined),
      get: vi.fn(async () => {
        throw new Error('POSTGRES_DOWN');
      }),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.statusCode).toBe(503);
    runtime.socialObservations = {
      receiptForRequest: vi.fn(async () => undefined),
      get: vi.fn(async () => completedWindow),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_WINDOW_COMPLETE');
    runtime.socialObservations = baseStore();
    runtime.socialSources = [];
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_CONTRACT_CHANGED');
    runtime.socialSources = [{ ...source, search: { ...source.search!, temporal: null } }];
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_CONTRACT_CHANGED');
    runtime.socialSources = [
      {
        ...source,
        search: {
          ...source.search!,
          temporal: { ...source.search!.temporal!, overlapSeconds: 120 },
        },
      },
    ];
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_CONTRACT_CHANGED');
    runtime.socialSources = [source];
    runtime.evidenceRepository = {
      get: vi.fn(async () => undefined),
      put: evidencePut,
    } as unknown as NonNullable<AppRuntime['evidenceRepository']>;
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('RESEARCH_RIGHTS_EVIDENCE_INCOMPLETE');
    runtime.evidenceRepository = durableEvidence;
    runtime.socialSources = [
      {
        ...source,
        dispatch: {
          ...source.dispatch!,
          costKind: 'PAID_MAXIMUM',
          maxMicrousd: '1',
        },
      },
    ];
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_COST_RECEIPT_UNAVAILABLE');
    runtime.socialSources = [source];
    runtime.dataProcurement = {
      reserve: vi.fn(async () => {
        throw codedError('DATA_PROCUREMENT_BUDGET_EXCEEDED');
      }),
    } as unknown as NonNullable<AppRuntime['dataProcurement']>;
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_BUDGET_NOT_RESERVED');

    const finishNotDispatched = vi.fn(async () => ({}));
    runtime.dataProcurement = {
      ...readyProcurement,
      finish: finishNotDispatched,
    } as unknown as NonNullable<AppRuntime['dataProcurement']>;
    runtime.socialFetchDependencies = {
      ...readyTransport,
      approvePublicOrigin: vi.fn(async () => false),
    };
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error).toMatchObject({
      code: 'SOCIAL_OBSERVATION_DISPATCH_REJECTED',
      diagnostic: 'EGRESS_NOT_APPROVED',
    });
    expect(finishNotDispatched).toHaveBeenCalledWith('global', expect.any(String), {
      kind: 'NOT_DISPATCHED',
    });

    const finishCharged = vi.fn(async () => ({}));
    runtime.dataProcurement = {
      ...readyProcurement,
      finish: finishCharged,
    } as unknown as NonNullable<AppRuntime['dataProcurement']>;
    runtime.socialFetchDependencies = {
      ...readyTransport,
      fetcher: vi.fn(async () => new Response('provider down', { status: 500 })),
      approvePublicOrigin: vi.fn(async () => true),
    };
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_PROVIDER_FAILED');
    expect(finishCharged).toHaveBeenCalledWith('global', expect.any(String), {
      kind: 'CHARGED',
      units: '1',
      microusd: '0',
    });
    runtime.dataProcurement = {
      ...readyProcurement,
      finish: vi.fn(async () => {
        throw new Error('POSTGRES_DOWN');
      }),
    } as unknown as NonNullable<AppRuntime['dataProcurement']>;
    response = await app.inject({ method: 'POST', url: fetchUrl, payload: fetchPayload });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_COST_RECONCILIATION_FAILED');

    const tombstonePayload = {
      sourceId: source.id,
      postId: '123456789',
      deletedAt: '2026-08-31T00:01:00.000Z',
      reason: 'ANALYST_REQUEST',
      verification: {
        method: 'ANALYST_REQUEST',
        locator: 'analyst:case:zt-1',
      },
    };
    delete runtime.socialObservations;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload: tombstonePayload,
    });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_DURABILITY_UNAVAILABLE');
    runtime.socialObservations = {
      getObservation: vi.fn(async () => {
        throw codedError('SOCIAL_OBSERVATION_NOT_FOUND');
      }),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload: tombstonePayload,
    });
    expect(response.statusCode).toBe(404);
    runtime.socialObservations = {
      getObservation: vi.fn(async () => {
        throw new Error('POSTGRES_DOWN');
      }),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload: tombstonePayload,
    });
    expect(response.statusCode).toBe(503);

    const existingTombstone: StoredSocialObservation = {
      ...activeObservation,
      record: {
        state: 'TOMBSTONED',
        sourceId: source.id,
        upstreamGroup: 'X',
        postId: '123456789',
        contentHash: activeObservation.record.contentHash,
        deletedAt: '2026-08-31T00:00:30.000Z',
        reason: 'UPSTREAM_DELETED',
        policyVersion: 'rights-v1',
        evidenceIds: [`ev_${'c'.repeat(24)}`],
      },
    };
    runtime.socialObservations = {
      getObservation: vi.fn(async () => existingTombstone),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload: tombstonePayload,
    });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_TOMBSTONE_CONFLICT');

    runtime.socialObservations = {
      getObservation: vi.fn(async () => ({
        ...activeObservation,
        record: { ...activeObservation.record, retainUntil: null },
      })),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload: {
        ...tombstonePayload,
        reason: 'RETENTION_EXPIRED',
        verification: { method: 'RETENTION_POLICY', locator: 'retention:rights-v1' },
      },
    });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_RETENTION_NOT_EXPIRED');

    const tombstone = vi.fn(async () => undefined);
    runtime.socialObservations = {
      getObservation: vi.fn(async () => activeObservation),
      tombstone,
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload: tombstonePayload,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().tombstone).not.toHaveProperty('text');
    expect(evidencePut).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ANALYST_OBSERVATION' }),
    );
    expect(evidencePut.mock.calls[0]?.[0]).not.toHaveProperty('sourceUri');
    runtime.socialObservations = {
      getObservation: vi.fn(async () => activeObservation),
      tombstone: vi.fn(async () => {
        throw codedError('SOCIAL_OBSERVATION_CONFLICT');
      }),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload: tombstonePayload,
    });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_TOMBSTONE_CONFLICT');
    runtime.socialObservations = {
      getObservation: vi.fn(async () => activeObservation),
      tombstone: vi.fn(async () => {
        throw new Error('POSTGRES_DOWN');
      }),
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    response = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload: tombstonePayload,
    });
    expect(response.json().error.code).toBe('SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE');
  });

  it('propagates a verified deletion to a durable no-text tombstone and replays it', async () => {
    const config = baseConfig();
    const runtime = createRuntime(config);
    const rightsId = `ev_${'a'.repeat(24)}`;
    let current: StoredSocialObservation = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      record: {
        state: 'ACTIVE' as const,
        sourceId: 'verified-social',
        upstreamGroup: 'X' as const,
        postId: '123456789',
        text: '这段正文必须能够被墓碑移除。',
        contentHash: 'b'.repeat(64),
        createdAt: '2026-08-30T23:00:00.000Z',
        observedAt: '2026-08-31T00:00:00.000Z',
        deletionCheckedAt: '2026-08-31T00:00:00.000Z',
        retainUntil: '2026-09-01T00:00:00.000Z',
        policyVersion: 'rights-v1',
        contractVersion: 'contract-v1',
        rightsEvidenceIds: [rightsId],
      },
      evidenceId: `ev_${'c'.repeat(24)}`,
      revision: 1,
      firstObservedAt: '2026-08-31T00:00:00.000Z',
      lastObservedAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    };
    const getObservation = vi.fn(async () => current);
    const tombstone = vi.fn(
      async (input: { tombstone: ExternalContentTombstone; evidenceId: string }) => {
        current = {
          ...current,
          record: input.tombstone,
          evidenceId: input.evidenceId,
          revision: 2,
        };
      },
    );
    runtime.socialObservations = {
      getObservation,
      tombstone,
    } as unknown as NonNullable<AppRuntime['socialObservations']>;
    const put = vi.fn(async (evidence: { id: string }) => ({ evidence }));
    runtime.evidenceRepository = {
      put,
    } as unknown as NonNullable<AppRuntime['evidenceRepository']>;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const payload = {
      sourceId: 'verified-social',
      postId: '123456789',
      deletedAt: '2026-08-31T00:01:00.000Z',
      reason: 'UPSTREAM_DELETED',
      verification: {
        method: 'PROVIDER_WEBHOOK',
        locator: 'webhook:deletion:123456789',
        sourceUri: 'https://verified-social.example.com/deletions/123456789',
      },
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload,
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({
      replayed: false,
      networkRequestPerformed: false,
      tombstone: {
        state: 'TOMBSTONED',
        reason: 'UPSTREAM_DELETED',
        postId: '123456789',
      },
    });
    expect(first.json().tombstone).not.toHaveProperty('text');
    expect(tombstone).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);

    const replayed = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-observation-tombstones',
      payload,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({ replayed: true, networkRequestPerformed: false });
    expect(tombstone).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
