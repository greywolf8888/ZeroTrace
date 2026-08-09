import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { z, ZodError } from 'zod';

import { ProviderError } from '@zerotrace/chain-adapters';
import { resolveEntityRelationship } from '@zerotrace/entity-engine';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import { classifyIdentifier } from '@zerotrace/identifiers';
import { PLATFORM_REGISTRY } from '@zerotrace/platform-adapters';
import { quoteConstantProductExit, simulateExitRace } from '@zerotrace/rv';
import {
  StorageError,
  type ObjectStoreHealth,
  type RawFactStorageHealth,
  type StorageHealth,
} from '@zerotrace/storage';
import {
  AnalysisMetadataSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type Evidence,
  type Ledger,
} from '@zerotrace/schemas';

import type { AppConfig } from './config.js';
import { createRuntime, type AppRuntime } from './runtime.js';

const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(512),
  ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']).optional(),
  chainId: z.string().min(1).max(128).optional(),
});

const EntityFeatureSchema = z.object({
  kind: z.enum([
    'SHARED_ONCHAIN_AUTHORITY',
    'COMMON_FUNDER',
    'SHARED_FEE_PAYER',
    'SETTLEMENT_CONVERGENCE',
    'TRANSACTION_GRAMMAR',
    'TIMING_SYNCHRONY',
    'EARLY_BUYER_COHORT',
    'TOKEN_DISTRIBUTION',
    'INDEPENDENT_HISTORY',
    'DISTINCT_FUNDING',
    'DISTINCT_SETTLEMENT',
    'CEX_PATH_BREAK',
    'SERVICE_HUB',
    'COINJOIN',
    'BOT_COMMON_INFRASTRUCTURE',
  ]),
  strength: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1),
  evidenceId: z.string().min(1),
});

const EntityRequestSchema = z.object({
  subjectA: z.string().min(1),
  subjectB: z.string().min(1),
  features: z.array(EntityFeatureSchema).max(1_000),
  metadata: AnalysisMetadataSchema,
  subjectAIsService: z.boolean().optional(),
  subjectBIsService: z.boolean().optional(),
});

const AtomicQuantitySchema = z.string().regex(/^(0|[1-9]\d*)$/);
const PositiveAtomicQuantitySchema = AtomicQuantitySchema.refine((value) => BigInt(value) > 0n, {
  message: 'Quantity must be greater than zero.',
});

const PoolSchema = z
  .object({
    id: z.string().min(1),
    baseReserve: AtomicQuantitySchema,
    quoteReserve: AtomicQuantitySchema,
    virtualBaseReserve: AtomicQuantitySchema.optional(),
    virtualQuoteReserve: AtomicQuantitySchema.optional(),
    feeBps: AtomicQuantitySchema.refine((value) => BigInt(value) <= 10_000n, {
      message: 'feeBps must be at most 10000.',
    }),
    sellEnabled: z.boolean(),
    maxSellQuantity: PositiveAtomicQuantitySchema.optional(),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .superRefine((pool, context) => {
    if (BigInt(pool.baseReserve) + BigInt(pool.virtualBaseReserve ?? '0') === 0n) {
      context.addIssue({
        code: 'custom',
        path: ['baseReserve'],
        message: 'Effective base reserve must be greater than zero.',
      });
    }
    if (BigInt(pool.quoteReserve) + BigInt(pool.virtualQuoteReserve ?? '0') === 0n) {
      context.addIssue({
        code: 'custom',
        path: ['quoteReserve'],
        message: 'Effective quote reserve must be greater than zero.',
      });
    }
  });

const RvRequestSchema = z.object({
  pool: PoolSchema,
  inputQuantity: PositiveAtomicQuantitySchema,
  metadata: AnalysisMetadataSchema,
});

const ExitRaceRequestSchema = z.object({
  pool: PoolSchema,
  participants: z
    .array(z.object({ id: z.string().min(1), inputQuantity: PositiveAtomicQuantitySchema }))
    .min(1)
    .max(100),
  order: z.enum(['SEQUENTIAL', 'RANDOM']),
  seed: z.number().int().safe(),
  iterations: z.number().int().min(1).max(10_000).optional(),
  metadata: AnalysisMetadataSchema,
});

function errorResponse(request: FastifyRequest, code: string, message: string, retryable: boolean) {
  return { error: { code, message, requestId: request.id, retryable } };
}

function emptyMetadata(modelVersion: string, confidence = 0): AnalysisMetadata {
  return {
    snapshot: null,
    dataCoverage: 0,
    sourceCoverage: 0,
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: null,
    sourceSet: [],
    modelVersion,
    confidence,
    evidenceIds: [],
  };
}

async function getEvidenceNode(runtime: AppRuntime, id: string) {
  return runtime.evidenceLedger.get(id) ?? runtime.evidenceRepository?.get(id);
}

async function addEvidence(
  runtime: AppRuntime,
  evidence: Evidence,
  sourceEvidenceIds: readonly string[] = [],
  snapshot?: AnalysisSnapshot,
): Promise<Evidence> {
  const existing = await getEvidenceNode(runtime, evidence.id);
  if (existing !== undefined) {
    const normalizedSources = uniqueEvidenceIds(sourceEvidenceIds).sort();
    if (
      hashPayload(existing.evidence) !== hashPayload(evidence) ||
      hashPayload(existing.sourceEvidenceIds) !== hashPayload(normalizedSources)
    ) {
      throw new StorageError(
        'EVIDENCE_CONFLICT',
        'Existing Evidence conflicts with the canonical observation.',
      );
    }
    if (hashPayload(existing.snapshot ?? null) !== hashPayload(snapshot ?? null)) {
      throw new StorageError('SNAPSHOT_CONFLICT', 'Existing Evidence uses a different Snapshot.');
    }
    return existing.evidence;
  }
  const stored = await runtime.evidenceRepository?.put(evidence, sourceEvidenceIds, snapshot);
  if (sourceEvidenceIds.every((id) => runtime.evidenceLedger.get(id) !== undefined)) {
    runtime.evidenceLedger.add(evidence, sourceEvidenceIds, snapshot);
  }
  return stored?.evidence ?? evidence;
}

function uniqueEvidenceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

async function missingEvidenceIds(runtime: AppRuntime, ids: readonly string[]): Promise<string[]> {
  const unique = uniqueEvidenceIds(ids);
  const nodes = await Promise.all(unique.map((id) => getEvidenceNode(runtime, id)));
  return unique.filter((_id, index) => nodes[index] === undefined);
}

function snapshotPosition(snapshot: AnalysisSnapshot): {
  blockOrSlot: string;
  finality: string;
} {
  switch (snapshot.ledger) {
    case 'EVM':
      return { blockOrSlot: snapshot.blockNumber, finality: snapshot.finality };
    case 'BITCOIN':
      return { blockOrSlot: snapshot.height, finality: snapshot.finality };
    case 'SOLANA':
      return { blockOrSlot: snapshot.slot, finality: snapshot.commitment };
  }
}

async function incompatibleEvidenceIds(
  runtime: AppRuntime,
  ids: readonly string[],
  snapshot: AnalysisSnapshot,
): Promise<string[]> {
  const position = snapshotPosition(snapshot);
  const unique = uniqueEvidenceIds(ids);
  const nodes = await Promise.all(unique.map((id) => getEvidenceNode(runtime, id)));
  return unique.filter((_id, index) => {
    const node = nodes[index];
    if (node === undefined) return false;
    if (
      node.evidence.ledger !== snapshot.ledger ||
      node.evidence.chainId !== snapshot.chainId ||
      node.evidence.blockOrSlot !== position.blockOrSlot
    ) {
      return true;
    }
    return node.snapshot === undefined || hashPayload(node.snapshot) !== hashPayload(snapshot);
  });
}

async function addDerivedAnalysisEvidence(
  runtime: AppRuntime,
  snapshot: AnalysisSnapshot,
  sourceEvidenceIds: readonly string[],
  source: string,
  locator: string,
  payload: unknown,
  summary: string,
): Promise<Evidence> {
  const position = snapshotPosition(snapshot);
  return addEvidence(
    runtime,
    createEvidence({
      ledger: snapshot.ledger,
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source,
      locator,
      payload,
      blockOrSlot: position.blockOrSlot,
      finality: position.finality,
      summary,
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    snapshot,
  );
}

function rejectUngroundedAnalysis(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
  evidenceIds: readonly string[] = [],
  evidenceIssue: 'MISSING' | 'SNAPSHOT_INCOMPATIBLE' = 'MISSING',
) {
  return reply.code(422).send({
    ...errorResponse(request, 'UNGROUNDED_ANALYSIS', message, false),
    evidenceIssue: { kind: evidenceIssue, evidenceIds: [...evidenceIds] },
  });
}

function capabilityNotImplemented(
  request: FastifyRequest,
  reply: FastifyReply,
  capability: string,
) {
  return reply.code(501).send({
    capability,
    status: unknownValue(
      'NOT_IMPLEMENTED',
      'The production adapter is not implemented in this release.',
    ),
    metadata: emptyMetadata(`${capability}-v0`),
    error: errorResponse(
      request,
      'CAPABILITY_NOT_IMPLEMENTED',
      `${capability} is not implemented.`,
      false,
    ).error,
  });
}

function parseHexQuantity(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value))
    throw new ProviderError('INVALID_RESPONSE', `Invalid ${field}.`);
  return BigInt(value).toString();
}

export interface CreateAppOptions {
  config: AppConfig;
  runtime?: AppRuntime;
  logger?: boolean;
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const runtime = options.runtime ?? createRuntime(options.config);
  const ownsRuntime = options.runtime === undefined;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : options.config.environment === 'development'
          ? {
              level: options.config.logLevel,
              transport: { target: 'pino-pretty', options: { colorize: true } },
            }
          : { level: options.config.logLevel },
    bodyLimit: 1_000_000,
    requestTimeout: options.config.requestTimeoutMs,
    trustProxy: false,
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (origin === undefined || options.config.corsOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed.'), false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ZeroTrace Read-only Intelligence API',
        version: '0.1.0',
        description:
          'Evidence-first EVM, Bitcoin, and Solana intelligence. No transaction broadcasting.',
      },
      tags: [
        { name: 'system', description: 'Health, capabilities, and provider state' },
        { name: 'intelligence', description: 'Read-only intelligence queries' },
        { name: 'analysis', description: 'Deterministic evidence-backed analysis' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const metricsRegistry = new Registry();
  collectDefaultMetrics({ register: metricsRegistry, prefix: 'zerotrace_' });
  const requests = new Counter({
    name: 'zerotrace_http_requests_total',
    help: 'ZeroTrace HTTP requests by method, route, and status.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [metricsRegistry],
  });
  app.addHook('onResponse', (request, reply, done) => {
    requests.inc({
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      status: String(reply.statusCode),
    });
    done();
  });
  if (ownsRuntime && runtime.close !== undefined) {
    app.addHook('onClose', runtime.close);
  }

  let healthCache:
    | { expiresAt: number; value: Awaited<ReturnType<AppRuntime['providerRegistry']['health']>> }
    | undefined;
  const providerHealth = async () => {
    if (healthCache !== undefined && healthCache.expiresAt > Date.now()) return healthCache.value;
    const value = await runtime.providerRegistry.health();
    healthCache = { expiresAt: Date.now() + options.config.healthCacheTtlMs, value };
    return value;
  };
  type RuntimeStorageHealth =
    | StorageHealth
    | {
        status: 'EPHEMERAL';
        backend: 'MEMORY';
        durable: false;
        checkedAt: string;
      };
  let storageCache: { expiresAt: number; value: RuntimeStorageHealth } | undefined;
  const storageHealth = async (): Promise<RuntimeStorageHealth> => {
    if (storageCache !== undefined && storageCache.expiresAt > Date.now()) {
      return storageCache.value;
    }
    const value: RuntimeStorageHealth =
      runtime.evidenceRepository === undefined
        ? {
            status: 'EPHEMERAL',
            backend: 'MEMORY',
            durable: false,
            checkedAt: new Date().toISOString(),
          }
        : await runtime.evidenceRepository.health();
    storageCache = { expiresAt: Date.now() + options.config.healthCacheTtlMs, value };
    return value;
  };
  type UnconfiguredStorageHealth = {
    status: 'UNCONFIGURED';
    backend: 'CLICKHOUSE' | 'POSTGRES' | 'S3_COMPATIBLE';
    durable: true;
    checkedAt: string;
  };
  type IngestionStorageHealth = {
    status: 'UP' | 'DOWN' | 'PARTIAL' | 'UNCONFIGURED';
    configured: number;
    required: 3;
    checkedAt: string;
    rawFacts: RawFactStorageHealth | UnconfiguredStorageHealth;
    checkpoints:
      | Awaited<ReturnType<NonNullable<AppRuntime['ingestionStorage']['checkpoints']>['health']>>
      | UnconfiguredStorageHealth;
    artifacts: ObjectStoreHealth | UnconfiguredStorageHealth;
  };
  let ingestionStorageCache: { expiresAt: number; value: IngestionStorageHealth } | undefined;
  const ingestionStorageHealth = async (): Promise<IngestionStorageHealth> => {
    if (ingestionStorageCache !== undefined && ingestionStorageCache.expiresAt > Date.now()) {
      return ingestionStorageCache.value;
    }
    const checkedAt = new Date().toISOString();
    const unconfigured = (
      backend: UnconfiguredStorageHealth['backend'],
    ): UnconfiguredStorageHealth => ({
      status: 'UNCONFIGURED',
      backend,
      durable: true,
      checkedAt,
    });
    const [rawFacts, checkpoints, artifacts] = await Promise.all([
      runtime.ingestionStorage.rawFacts?.health() ?? unconfigured('CLICKHOUSE'),
      runtime.ingestionStorage.checkpoints?.health() ?? unconfigured('POSTGRES'),
      runtime.ingestionStorage.artifacts?.health() ?? unconfigured('S3_COMPATIBLE'),
    ]);
    const components = [rawFacts, checkpoints, artifacts];
    const configured = components.filter((component) => component.status !== 'UNCONFIGURED').length;
    const status =
      configured === 0
        ? 'UNCONFIGURED'
        : components.some((component) => component.status === 'DOWN')
          ? 'DOWN'
          : configured === components.length
            ? 'UP'
            : 'PARTIAL';
    const value: IngestionStorageHealth = {
      status,
      configured,
      required: 3,
      checkedAt,
      rawFacts,
      checkpoints,
      artifacts,
    };
    ingestionStorageCache = {
      expiresAt: Date.now() + options.config.healthCacheTtlMs,
      value,
    };
    return value;
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        ...errorResponse(request, 'INVALID_REQUEST', 'Request validation failed.', false),
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    if (error instanceof ProviderError) {
      const status =
        error.code === 'METHOD_NOT_ALLOWED' || error.code === 'INVALID_RESPONSE' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof StorageError) {
      return reply
        .code(503)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    const internalError = error instanceof Error ? error : new Error('Unknown thrown value');
    request.log.error(
      { message: internalError.message, name: internalError.name },
      'request failed',
    );
    return reply
      .code(500)
      .send(errorResponse(request, 'INTERNAL_ERROR', 'Internal server error.', false));
  });

  app.get('/health/live', { schema: { tags: ['system'] } }, async () => ({
    status: 'UP',
    service: 'zerotrace-api',
    version: '0.1.0',
    readOnly: true,
    checkedAt: new Date().toISOString(),
  }));

  app.get('/health/ready', { schema: { tags: ['system'] } }, async (_request, reply) => {
    const [providers, storage] = await Promise.all([providerHealth(), storageHealth()]);
    const status =
      providers.some((provider) => provider.status === 'UP') && storage.status !== 'DOWN'
        ? 'UP'
        : 'DEGRADED';
    return reply.code(status === 'UP' ? 200 : 503).send({
      status,
      service: 'zerotrace-api',
      readOnly: true,
      providers,
      storage,
      checkedAt: new Date().toISOString(),
    });
  });

  app.get('/health', { schema: { tags: ['system'] } }, async () => {
    const [providers, storage, ingestionStorage] = await Promise.all([
      providerHealth(),
      storageHealth(),
      ingestionStorageHealth(),
    ]);
    return {
      status:
        providers.some((provider) => provider.status === 'UP') &&
        storage.status !== 'DOWN' &&
        ingestionStorage.status !== 'DOWN'
          ? 'UP'
          : 'DEGRADED',
      service: 'zerotrace-api',
      readOnly: true,
      providers,
      storage,
      ingestionStorage,
      checkedAt: new Date().toISOString(),
    };
  });

  app.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
    reply.header('content-type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });

  app.get('/api/v1/capabilities', { schema: { tags: ['system'] } }, async () => ({
    readOnly: true,
    core: [
      { id: 'canonical-schemas', status: 'IMPLEMENTED' },
      {
        id: 'evidence-ledger',
        status:
          runtime.evidenceRepository === undefined
            ? 'IMPLEMENTED_EPHEMERAL'
            : 'IMPLEMENTED_DURABLE',
        detail:
          runtime.evidenceRepository === undefined
            ? 'POSTGRES_URL is absent; Evidence is process-local.'
            : 'PostgreSQL append-only Evidence and Snapshot persistence is configured.',
      },
      {
        id: 'evm-current-state',
        status: runtime.evmAdapters.size > 0 ? 'IMPLEMENTED' : 'PROVIDER_REQUIRED',
      },
      {
        id: 'bitcoin-esplora',
        status: runtime.bitcoinAdapter === undefined ? 'PROVIDER_REQUIRED' : 'IMPLEMENTED',
      },
      {
        id: 'solana-current-state',
        status: runtime.solanaAdapter === undefined ? 'PROVIDER_REQUIRED' : 'IMPLEMENTED',
      },
      {
        id: 'finalized-historical-ingestion',
        status:
          runtime.ingestionStorage.rawFacts !== undefined &&
          runtime.ingestionStorage.checkpoints !== undefined &&
          runtime.ingestionStorage.artifacts !== undefined
            ? 'IMPLEMENTED_DURABLE'
            : Object.values(runtime.ingestionStorage).some((value) => value !== undefined)
              ? 'STORAGE_PARTIALLY_CONFIGURED'
              : 'STORAGE_REQUIRED',
        detail:
          'Restart-safe SQD finalized blocks, transactions, EVM logs/traces/state diffs, Bitcoin inputs/outputs, and Solana instructions/logs/balances/token balances/rewards are implemented with durable provenance. Semantic transfers, protocol decoding, continuous scheduling, and reorg reconciliation remain pending.',
      },
      { id: 'entity-evidence-fusion', status: 'IMPLEMENTED_BASELINE' },
      { id: 'constant-product-rv', status: 'IMPLEMENTED_DETERMINISTIC' },
      { id: 'shared-liquidity-exit-race', status: 'IMPLEMENTED_DETERMINISTIC' },
    ],
    boundaries: {
      transactionSigning: 'FORBIDDEN',
      transactionBroadcasting: 'FORBIDDEN',
      privateKeyStorage: 'FORBIDDEN',
    },
  }));

  app.get('/api/v1/chains', { schema: { tags: ['system'] } }, async () => ({
    chains: [
      {
        ledger: 'EVM',
        chainId: `eip155:${options.config.ethereumChainId}`,
        name: 'Ethereum',
        configured: runtime.evmAdapters.has(options.config.ethereumChainId),
      },
      {
        ledger: 'EVM',
        chainId: `eip155:${options.config.bscChainId}`,
        name: 'BNB Smart Chain',
        configured: runtime.evmAdapters.has(options.config.bscChainId),
      },
      {
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        name: 'Bitcoin',
        configured: runtime.bitcoinAdapter !== undefined,
      },
      {
        ledger: 'SOLANA',
        chainId: 'solana-mainnet',
        name: 'Solana',
        configured: runtime.solanaAdapter !== undefined,
      },
    ],
  }));

  app.get('/api/v1/platforms', { schema: { tags: ['system'] } }, async () => ({
    platforms: PLATFORM_REGISTRY,
    gmgnConfigured: options.config.gmgnConfigured,
  }));

  app.get('/api/v1/search', { schema: { tags: ['intelligence'] } }, async (request) => {
    const query = SearchQuerySchema.parse(request.query);
    const result = classifyIdentifier(query.q, {
      ...(query.ledger === undefined ? {} : { ledger: query.ledger }),
      ...(query.chainId === undefined ? {} : { chainId: query.chainId }),
    });
    return {
      ...result,
      metadata: {
        ...emptyMetadata('identifier-parser-v0.1.0', result.candidates[0]?.confidence ?? 0),
        dataCoverage: result.candidates.length === 0 ? 0 : 1,
        sourceCoverage: result.candidates.length === 0 ? 0 : 1,
        freshness: new Date().toISOString(),
        sourceSet: ['local-checksum-and-structure'],
      },
    };
  });

  app.get(
    '/api/v1/subjects/:ledger/:id',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = request.params as { ledger: string; id: string };
      const query = request.query as { chainId?: string };
      const ledger = params.ledger.toUpperCase();
      if (!['EVM', 'BITCOIN', 'SOLANA'].includes(ledger)) {
        return reply
          .code(400)
          .send(errorResponse(request, 'INVALID_LEDGER', 'Unsupported ledger.', false));
      }
      const classification = classifyIdentifier(params.id, {
        ledger: ledger as Ledger,
        ...(query.chainId === undefined ? {} : { chainId: query.chainId }),
      });
      const subject = classification.candidates.find((candidate) => candidate.type === 'ADDRESS');
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              'A checksum-valid or structurally valid address is required.',
              false,
            ),
          );
      }

      if (ledger === 'EVM') {
        const numericChainId = Number(
          (query.chainId ?? `eip155:${options.config.ethereumChainId}`).replace(/^eip155:/, ''),
        );
        const adapter = runtime.evmAdapters.get(numericChainId);
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata('evm-subject-v0.1.0'),
          });
        }
        const snapshot = await adapter.createSnapshot();
        const blockTag = `0x${BigInt(snapshot.blockNumber).toString(16)}`;
        const [balanceHex, code] = await Promise.all([
          adapter.getBalance(subject.normalizedId, blockTag),
          adapter.getCode(subject.normalizedId, blockTag),
        ]);
        const payload = { balanceHex, code, blockTag, blockHash: snapshot.blockHash };
        const evidence = await addEvidence(
          runtime,
          createEvidence({
            ledger: 'EVM',
            chainId: snapshot.chainId,
            kind: 'ACCOUNT_STATE',
            source: adapter.sourceId,
            locator: `address:${subject.normalizedId}@${snapshot.blockNumber}`,
            payload,
            blockOrSlot: snapshot.blockNumber,
            finality: snapshot.finality,
            summary: 'EVM native balance and bytecode at the snapshot block.',
          }),
          [],
          snapshot,
        );
        const metadata: AnalysisMetadata = {
          snapshot,
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: snapshot.capturedAt,
          sourceSet: [adapter.sourceId],
          modelVersion: 'evm-subject-v0.1.0',
          confidence: 1,
          evidenceIds: [evidence.id],
        };
        return {
          subject,
          facts: {
            nativeBalanceAtomic: knownValue(parseHexQuantity(balanceHex, 'EVM balance')),
            accountKind: knownValue(code === '0x' ? 'EOA' : 'CONTRACT'),
          },
          metadata,
          evidence: [evidence],
        };
      }

      if (ledger === 'BITCOIN') {
        const adapter = runtime.bitcoinAdapter;
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata('btc-subject-v0.1.0'),
          });
        }
        const snapshot = await adapter.createSnapshot();
        const stats = await adapter.getAddress(subject.normalizedId);
        const payload = {
          stats,
          snapshotHeight: snapshot.height,
          snapshotHash: snapshot.blockHash,
        };
        const evidence = await addEvidence(
          runtime,
          createEvidence({
            ledger: 'BITCOIN',
            chainId: snapshot.chainId,
            kind: 'ACCOUNT_STATE',
            source: adapter.sourceId,
            locator: `address:${subject.normalizedId}@${snapshot.height}`,
            payload,
            blockOrSlot: snapshot.height,
            finality: snapshot.finality,
            summary: 'Bitcoin address chain and mempool statistics near the snapshot tip.',
          }),
          [],
          snapshot,
        );
        const confirmedBalance = stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
        const mempoolDelta = stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum;
        return {
          subject,
          facts: {
            confirmedBalanceSats: knownValue(String(confirmedBalance)),
            mempoolDeltaSats: knownValue(String(mempoolDelta)),
            transactionCount: knownValue(String(stats.chain_stats.tx_count)),
          },
          metadata: {
            snapshot,
            dataCoverage: 1,
            sourceCoverage: 0.5,
            historyCoverage: 0.5,
            simulationCoverage: 0,
            freshness: snapshot.capturedAt,
            sourceSet: [adapter.sourceId],
            modelVersion: 'btc-subject-v0.1.0',
            confidence: 0.9,
            evidenceIds: [evidence.id],
          },
          evidence: [evidence],
          consistency: 'BEST_EFFORT_ESPLORA_TIP',
        };
      }

      const adapter = runtime.solanaAdapter;
      if (adapter === undefined) {
        return reply.code(503).send({
          subject,
          facts: unavailableValue('PROVIDER_UNCONFIGURED'),
          metadata: emptyMetadata('solana-subject-v0.1.0'),
        });
      }
      const snapshot = await adapter.createSnapshot();
      const response = await adapter.getAccountInfo(subject.normalizedId, Number(snapshot.slot));
      const value = response.value;
      const payload = {
        response,
        snapshotSlot: snapshot.slot,
        snapshotBlockhash: snapshot.blockhash,
      };
      const evidence = await addEvidence(
        runtime,
        createEvidence({
          ledger: 'SOLANA',
          chainId: snapshot.chainId,
          kind: 'ACCOUNT_STATE',
          source: adapter.sourceId,
          locator: `account:${subject.normalizedId}@${snapshot.slot}`,
          payload,
          blockOrSlot: snapshot.slot,
          finality: snapshot.commitment,
          summary: 'Solana account state with a minimum snapshot slot.',
        }),
        [],
        snapshot,
      );
      const account = value ?? undefined;
      return {
        subject,
        facts: {
          exists: knownValue(account !== undefined),
          lamports: knownValue(account?.lamports ?? '0'),
          owner:
            account === undefined || typeof account.owner !== 'string'
              ? unknownValue('INSUFFICIENT_DATA')
              : knownValue(account.owner),
          executable:
            account === undefined || typeof account.executable !== 'boolean'
              ? unknownValue('INSUFFICIENT_DATA')
              : knownValue(account.executable),
        },
        metadata: {
          snapshot,
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: snapshot.capturedAt,
          sourceSet: [adapter.sourceId],
          modelVersion: 'solana-subject-v0.1.0',
          confidence: 1,
          evidenceIds: [evidence.id],
        },
        evidence: [evidence],
      };
    },
  );

  app.get(
    '/api/v1/evidence/:id',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const node = await getEvidenceNode(runtime, id);
      if (node === undefined)
        return reply
          .code(404)
          .send(errorResponse(request, 'EVIDENCE_NOT_FOUND', 'Evidence was not found.', false));
      return node;
    },
  );

  app.get(
    '/api/v1/evidence/:id/drilldown',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const nodes =
        runtime.evidenceRepository === undefined
          ? runtime.evidenceLedger.drilldown(id)
          : await runtime.evidenceRepository.drilldown(id);
      if (nodes.length === 0)
        return reply
          .code(404)
          .send(errorResponse(request, 'EVIDENCE_NOT_FOUND', 'Evidence was not found.', false));
      return { rootEvidenceId: id, nodes };
    },
  );

  app.post(
    '/api/v1/entities/resolve',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRequestSchema.parse(request.body);
      if (input.features.length === 0) return resolveEntityRelationship(input);
      if (input.metadata.snapshot === null) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Entity conclusions with features require a ledger snapshot.',
        );
      }
      const sourceEvidenceIds = uniqueEvidenceIds([
        ...input.metadata.evidenceIds,
        ...input.features.map((feature) => feature.evidenceId),
      ]);
      const missingIds = await missingEvidenceIds(runtime, sourceEvidenceIds);
      if (missingIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Entity feature evidence is not present in the evidence ledger.',
          missingIds,
        );
      }
      const incompatibleIds = await incompatibleEvidenceIds(
        runtime,
        sourceEvidenceIds,
        input.metadata.snapshot,
      );
      if (incompatibleIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Entity evidence is not anchored to the requested ledger snapshot.',
          incompatibleIds,
          'SNAPSHOT_INCOMPATIBLE',
        );
      }
      const result = resolveEntityRelationship(input);
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        input.metadata.snapshot,
        sourceEvidenceIds,
        'zerotrace-entity-engine@0.1.0',
        'entity-relationship:' + input.subjectA + ':' + input.subjectB,
        { input, result },
        'Evidence-weighted controller, coordination, and independence inference.',
      );
      return {
        ...result,
        metadata: {
          ...result.metadata,
          evidenceIds: uniqueEvidenceIds([...result.metadata.evidenceIds, derived.id]),
        },
        evidence: [derived],
      };
    },
  );

  app.post(
    '/api/v1/rv/constant-product',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = RvRequestSchema.parse(request.body);
      if (input.metadata.snapshot === null) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Realizable-value calculations require a ledger snapshot.',
        );
      }
      const sourceEvidenceIds = uniqueEvidenceIds([
        ...input.metadata.evidenceIds,
        ...input.pool.evidenceIds,
      ]);
      const missingIds = await missingEvidenceIds(runtime, sourceEvidenceIds);
      if (missingIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Pool-state evidence is not present in the evidence ledger.',
          missingIds,
        );
      }
      const incompatibleIds = await incompatibleEvidenceIds(
        runtime,
        sourceEvidenceIds,
        input.metadata.snapshot,
      );
      if (incompatibleIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Pool-state evidence is not anchored to the requested ledger snapshot.',
          incompatibleIds,
          'SNAPSHOT_INCOMPATIBLE',
        );
      }
      const result = quoteConstantProductExit(input);
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        input.metadata.snapshot,
        sourceEvidenceIds,
        'zerotrace-rv-engine@0.1.0',
        'rv:constant-product:' + input.pool.id,
        { input, result },
        'Deterministic constant-product realizable-value calculation.',
      );
      return {
        ...result,
        metadata: {
          ...result.metadata,
          evidenceIds: uniqueEvidenceIds([...result.metadata.evidenceIds, derived.id]),
        },
        evidence: [derived],
      };
    },
  );

  app.post(
    '/api/v1/scenarios/exit-race',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = ExitRaceRequestSchema.parse(request.body);
      if (input.metadata.snapshot === null) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Exit-race scenarios require a ledger snapshot.',
        );
      }
      const sourceEvidenceIds = uniqueEvidenceIds([
        ...input.metadata.evidenceIds,
        ...input.pool.evidenceIds,
      ]);
      const missingIds = await missingEvidenceIds(runtime, sourceEvidenceIds);
      if (missingIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Scenario evidence is not present in the evidence ledger.',
          missingIds,
        );
      }
      const incompatibleIds = await incompatibleEvidenceIds(
        runtime,
        sourceEvidenceIds,
        input.metadata.snapshot,
      );
      if (incompatibleIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Scenario evidence is not anchored to the requested ledger snapshot.',
          incompatibleIds,
          'SNAPSHOT_INCOMPATIBLE',
        );
      }
      const result = simulateExitRace(input);
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        input.metadata.snapshot,
        sourceEvidenceIds,
        'zerotrace-scenario-engine@0.1.0',
        'scenario:exit-race:' + input.pool.id + ':' + String(input.seed),
        { input, result },
        'Deterministic shared-liquidity exit-race scenario.',
      );
      return {
        ...result,
        evidenceIds: uniqueEvidenceIds([...result.evidenceIds, derived.id]),
        metadata: {
          ...input.metadata,
          evidenceIds: uniqueEvidenceIds([...sourceEvidenceIds, derived.id]),
        },
        evidence: [derived],
      };
    },
  );

  const incompleteCapabilities = [
    'assets',
    'labels',
    'control-rights',
    'launches',
    'markets',
    'claims',
    'timeline',
  ];
  for (const capability of incompleteCapabilities) {
    app.all(`/api/v1/${capability}`, { schema: { tags: ['analysis'] } }, (request, reply) =>
      capabilityNotImplemented(request, reply, capability),
    );
  }

  return app;
}
