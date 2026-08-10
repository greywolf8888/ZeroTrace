import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { z, ZodError } from 'zod';

import { ProviderError } from '@zerotrace/chain-adapters';
import { parseEvmClaimDeclaration } from '@zerotrace/claim-audit';
import { auditDiscrepancies, DISCREPANCY_MODEL_VERSION } from '@zerotrace/data-quality';
import { resolveEntityRelationship } from '@zerotrace/entity-engine';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import { classifyIdentifier } from '@zerotrace/identifiers';
import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  FLAP_EVENT_MODEL_VERSION,
  FLAP_HISTORY_DEFAULT_CHUNK_SIZE,
  FLAP_HISTORY_MAX_CHUNKS,
  FLAP_HISTORY_MAX_RANGE_BLOCKS,
  FLAP_HISTORY_MODEL_VERSION,
  FLAP_LIFETIME_MATERIALIZATION_SOURCE,
  FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_CHUNKS,
  FLAP_TOKEN_ORIGIN_MODEL_VERSION,
  PLATFORM_REGISTRY,
  discoverFlapEventHistory,
  inspectFlapEventTransaction,
  observeEvmClaimBurnBlock,
  inspectFlapTokenOrigin,
  inspectFlapTokenOriginRestartSafe,
  inspectFlapToken,
  quoteFlapPancakeV2BuyScenarios,
  quoteFlapPancakeV2SellScenarios,
  quoteFlapSell,
  type InspectFlapTokenOriginOptions,
} from '@zerotrace/platform-adapters';
import { quoteConstantProductExit, simulateExitRace } from '@zerotrace/rv';
import {
  ClaimReportStorageError,
  FlapHistoryProjectionError,
  FlapLifetimeHeadError,
  SemanticCheckpointError,
  StorageError,
  type ObjectStoreHealth,
  type RawFactStorageHealth,
  type StorageHealth,
} from '@zerotrace/storage';
import {
  AnalysisMetadataSchema,
  DiscrepancyCheckInputSchema,
  FlapEventHistoryProjectionSchema,
  FlapLifetimeMaterializationSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type Evidence,
  type Ledger,
} from '@zerotrace/schemas';

import type { AppConfig } from './config.js';
import {
  queryBitcoinBlock,
  queryBitcoinOutpoint,
  queryBitcoinTransaction,
  queryEvmBlock,
  queryEvmTransaction,
  querySolanaBlock,
  querySolanaTransaction,
} from './ledger-query.js';
import { createRuntime, type AppRuntime } from './runtime.js';

const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(512),
  ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']).optional(),
  chainId: z.string().min(1).max(128).optional(),
});

const LedgerRecordParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(['EVM', 'BITCOIN', 'SOLANA'])),
  type: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(['TRANSACTION', 'BLOCK', 'OUTPOINT'])),
  id: z.string().trim().min(1).max(512),
});

const LedgerRecordQuerySchema = z.object({
  chainId: z.string().trim().min(1).max(128).optional(),
});

const LaunchInspectionParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  token: z.string().trim().min(1).max(128),
});

const LaunchInspectionQuerySchema = z.object({
  chainId: z.literal('eip155:56'),
  platform: z.literal('flap').optional(),
  blockNumber: z
    .string()
    .regex(/^(?:0|[1-9]\d*)$/)
    .optional(),
});

const ClaimReportParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  token: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/),
  address: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/),
});

const ClaimReportByIdParamsSchema = ClaimReportParamsSchema.extend({
  reportId: z.string().regex(/^ecr_[0-9a-f]{24}$/),
});

const ClaimReportQuerySchema = z.object({
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
});

const ClaimBurnParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  token: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/),
});

const ClaimBurnRequestSchema = z.object({
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  blockNumber: z.string().regex(/^[1-9]\d*$/),
  maxTransfers: z.number().int().min(1).max(25_000).optional(),
});

const FlapEventTransactionParamsSchema = LaunchInspectionParamsSchema.extend({
  transactionHash: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{64}$/),
});

const FlapEventTransactionQuerySchema = z.object({
  chainId: z.literal('eip155:56'),
  platform: z.literal('flap').optional(),
});

const FlapEventHistoryQuerySchema = FlapEventTransactionQuerySchema.extend({
  fromBlock: z
    .string()
    .max(32)
    .regex(/^(?:0|[1-9]\d*)$/),
  toBlock: z
    .string()
    .max(32)
    .regex(/^(?:0|[1-9]\d*)$/),
  chunkSize: z.coerce.number().int().min(1).max(10_000).optional(),
}).superRefine((query, context) => {
  const fromBlock = BigInt(query.fromBlock);
  const toBlock = BigInt(query.toBlock);
  if (toBlock < fromBlock) {
    context.addIssue({ code: 'custom', path: ['toBlock'], message: 'toBlock precedes fromBlock.' });
  } else if (toBlock - fromBlock + 1n > BigInt(FLAP_HISTORY_MAX_RANGE_BLOCKS)) {
    context.addIssue({
      code: 'custom',
      path: ['toBlock'],
      message: `History range exceeds ${FLAP_HISTORY_MAX_RANGE_BLOCKS} blocks.`,
    });
  } else {
    const chunkSize = BigInt(query.chunkSize ?? FLAP_HISTORY_DEFAULT_CHUNK_SIZE);
    const chunkCount = (toBlock - fromBlock + chunkSize) / chunkSize;
    if (chunkCount > BigInt(FLAP_HISTORY_MAX_CHUNKS)) {
      context.addIssue({
        code: 'custom',
        path: ['chunkSize'],
        message: `History query exceeds ${FLAP_HISTORY_MAX_CHUNKS} chunks.`,
      });
    }
  }
});

const FlapHistoryProjectionParamsSchema = LaunchInspectionParamsSchema.extend({
  scanId: z.string().uuid(),
});

const FlapHistoryProjectionPageQuerySchema = FlapEventTransactionQuerySchema.extend({
  afterBlock: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const FlapTokenOriginQuerySchema = FlapEventTransactionQuerySchema.extend({
  fromBlock: z
    .string()
    .max(32)
    .regex(/^(?:0|[1-9]\d*)$/),
  toBlock: z
    .string()
    .max(32)
    .regex(/^(?:0|[1-9]\d*)$/),
  chunkSize: z.coerce.number().int().min(1).max(FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE).optional(),
}).superRefine((query, context) => {
  const fromBlock = BigInt(query.fromBlock);
  const toBlock = BigInt(query.toBlock);
  if (toBlock < fromBlock) {
    context.addIssue({ code: 'custom', path: ['toBlock'], message: 'toBlock precedes fromBlock.' });
  } else if (toBlock - fromBlock + 1n > BigInt(FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE)) {
    context.addIssue({
      code: 'custom',
      path: ['toBlock'],
      message: `Synchronous origin range exceeds ${FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE} blocks.`,
    });
  } else {
    const selectedChunkSize = BigInt(query.chunkSize ?? FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE);
    const chunkCount = (toBlock - fromBlock + selectedChunkSize) / selectedChunkSize;
    if (chunkCount > BigInt(FLAP_TOKEN_ORIGIN_MAX_CHUNKS)) {
      context.addIssue({
        code: 'custom',
        path: ['chunkSize'],
        message: `Origin query exceeds ${FLAP_TOKEN_ORIGIN_MAX_CHUNKS} chunks.`,
      });
    }
  }
});

const FlapSellQuoteRequestSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z.string().trim().min(1).max(128),
    inputQuantity: z.string().regex(/^(?:0|[1-9]\d*)$/),
    blockNumber: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
  })
  .strict();

const ClaimDeclarationParseRequestSchema = z
  .object({
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    assetId: z
      .string()
      .trim()
      .regex(/^eip155:[1-9]\d*:erc20:0x[0-9a-fA-F]{40}$/),
    text: z.string().trim().min(1).max(100_000),
    sourceUri: z
      .url()
      .max(2_048)
      .refine((value) => /^https?:\/\//i.test(value), {
        message: 'Claim declaration sourceUri must use HTTP(S).',
      })
      .optional(),
    auditWindow: z
      .object({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
      })
      .refine((window) => Date.parse(window.from) <= Date.parse(window.to), {
        message: 'Audit window must not end before it begins.',
      })
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.assetId.startsWith(`${input.chainId}:`)) {
      context.addIssue({
        code: 'custom',
        path: ['assetId'],
        message: 'Claim declaration assetId must belong to the requested EVM chain.',
      });
    }
  });

const FlapPancakeV2BuyScenarioRequestSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
    quoteInputs: z
      .array(
        z
          .string()
          .trim()
          .max(128)
          .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      )
      .min(1)
      .max(8),
    blockNumber: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
  })
  .strict();

const FlapPancakeV2SellScenarioRequestSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
    tokenInputs: z
      .array(
        z
          .string()
          .trim()
          .max(128)
          .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      )
      .min(1)
      .max(8),
    blockNumber: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
  })
  .strict();

const DiscrepancyAuditRequestSchema = z
  .object({
    checks: z.array(DiscrepancyCheckInputSchema).max(1_000),
    metadata: AnalysisMetadataSchema,
  })
  .strict();

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

function uniqueSourceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function evidenceSourceId(ids: readonly string[]): string {
  return uniqueSourceIds(ids).join('|');
}

function snapshotSourceIds(snapshot: AnalysisSnapshot): string[] {
  return Object.keys(snapshot.providerVersions);
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

class CorsOriginError extends Error {
  constructor() {
    super('Origin is not allowed.');
    this.name = 'CorsOriginError';
  }
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
      else callback(new CorsOriginError(), false);
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
    | Awaited<ReturnType<NonNullable<AppRuntime['semanticCheckpoints']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['flapHistoryProjection']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['flapLifetimeHeads']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['claimReports']>['health']>>
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
    let value: RuntimeStorageHealth;
    if (runtime.evidenceRepository === undefined) {
      value = {
        status: 'EPHEMERAL',
        backend: 'MEMORY',
        durable: false,
        checkedAt: new Date().toISOString(),
      };
    } else {
      const [
        evidence,
        semanticCheckpoints,
        flapHistoryProjection,
        flapLifetimeHeads,
        claimReports,
      ] = await Promise.all([
        runtime.evidenceRepository.health(),
        runtime.semanticCheckpoints?.health(),
        runtime.flapHistoryProjection?.health(),
        runtime.flapLifetimeHeads?.health(),
        runtime.claimReports?.health(),
      ]);
      value =
        evidence.status === 'DOWN'
          ? evidence
          : semanticCheckpoints?.status === 'DOWN'
            ? semanticCheckpoints
            : flapHistoryProjection?.status === 'DOWN'
              ? flapHistoryProjection
              : flapLifetimeHeads?.status === 'DOWN'
                ? flapLifetimeHeads
                : claimReports?.status === 'DOWN'
                  ? claimReports
                  : evidence;
    }
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
  type EphemeralDataQualityStorageHealth = {
    status: 'EPHEMERAL';
    backend: 'MEMORY';
    durable: false;
    checkedAt: string;
  };
  type RuntimeDataQualityHealth = {
    status: 'UP' | 'PARTIAL' | 'INSUFFICIENT_SOURCES' | 'UNCONFIGURED' | 'DEGRADED' | 'DOWN';
    durable: boolean;
    checkedAt: string;
    configuredSources: Readonly<Record<string, number>>;
    results: Awaited<ReturnType<AppRuntime['dataQuality']['inspectAll']>>;
    storage:
      | Awaited<ReturnType<NonNullable<AppRuntime['dataQualityStorage']>['health']>>
      | EphemeralDataQualityStorageHealth;
    errorCode?: string;
  };
  let dataQualityCache: { expiresAt: number; value: RuntimeDataQualityHealth } | undefined;
  const dataQualityHealth = async (): Promise<RuntimeDataQualityHealth> => {
    if (dataQualityCache !== undefined && dataQualityCache.expiresAt > Date.now()) {
      return dataQualityCache.value;
    }
    const checkedAt = new Date().toISOString();
    const configuredSources = runtime.dataQuality.configuredSources();
    const storage =
      runtime.dataQualityStorage === undefined
        ? ({
            status: 'EPHEMERAL',
            backend: 'MEMORY',
            durable: false,
            checkedAt,
          } as const)
        : await runtime.dataQualityStorage.health();
    let value: RuntimeDataQualityHealth;
    try {
      if (storage.status === 'DOWN') {
        value = {
          status: 'DOWN',
          durable: storage.durable,
          checkedAt,
          configuredSources,
          results: [],
          storage,
          ...(storage.errorCode === undefined ? {} : { errorCode: storage.errorCode }),
        };
      } else {
        const results = await runtime.dataQuality.inspectAll();
        const configuredTotal = Object.values(configuredSources).reduce(
          (total, count) => total + count,
          0,
        );
        const disagreement = results.some(
          (result) => result.status === 'DISAGREEMENT' || result.alerts.length > 0,
        );
        const agreementCount = results.filter((result) => result.status === 'AGREEMENT').length;
        const status = disagreement
          ? 'DEGRADED'
          : configuredTotal === 0
            ? 'UNCONFIGURED'
            : agreementCount === results.length
              ? 'UP'
              : agreementCount > 0
                ? 'PARTIAL'
                : 'INSUFFICIENT_SOURCES';
        value = {
          status,
          durable: runtime.dataQuality.durable,
          checkedAt,
          configuredSources,
          results,
          storage,
        };
      }
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        typeof (error as Record<string, unknown>).code === 'string' &&
        /^[A-Z0-9_:-]{1,160}$/.test((error as Record<string, unknown>).code as string)
          ? ((error as Record<string, unknown>).code as string)
          : 'DATA_QUALITY_CHECK_FAILED';
      value = {
        status: 'DOWN',
        durable: runtime.dataQuality.durable,
        checkedAt,
        configuredSources,
        results: [],
        storage,
        errorCode: code,
      };
    }
    dataQualityCache = {
      expiresAt: Date.now() + options.config.healthCacheTtlMs,
      value,
    };
    return value;
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof CorsOriginError) {
      return reply
        .code(403)
        .send(errorResponse(request, 'CORS_ORIGIN_DENIED', error.message, false));
    }
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
        error.code === 'METHOD_NOT_ALLOWED' ? 400 : error.code === 'INVALID_RESPONSE' ? 502 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof StorageError) {
      return reply
        .code(503)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FlapHistoryProjectionError) {
      const status = error.code === 'FLAP_HISTORY_PROJECTION_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FlapLifetimeHeadError) {
      const status = error.code === 'FLAP_LIFETIME_HEAD_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ClaimReportStorageError) {
      const status = error.code === 'CLAIM_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof SemanticCheckpointError) {
      const status =
        error.code === 'SEMANTIC_CHECKPOINT_INVALID'
          ? 400
          : error.code === 'SEMANTIC_CHECKPOINT_NOT_FOUND'
            ? 404
            : 503;
      return reply
        .code(status)
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
    const [providers, storage, ingestionStorage, dataQuality] = await Promise.all([
      providerHealth(),
      storageHealth(),
      ingestionStorageHealth(),
      dataQualityHealth(),
    ]);
    return {
      status:
        providers.some((provider) => provider.status === 'UP') &&
        storage.status !== 'DOWN' &&
        ingestionStorage.status !== 'DOWN' &&
        !['DOWN', 'DEGRADED'].includes(dataQuality.status)
          ? 'UP'
          : 'DEGRADED',
      service: 'zerotrace-api',
      readOnly: true,
      providers,
      storage,
      ingestionStorage,
      dataQuality,
      checkedAt: new Date().toISOString(),
    };
  });

  app.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
    reply.header('content-type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });

  app.get('/api/v1/data-quality/anchors', { schema: { tags: ['system'] } }, async () =>
    dataQualityHealth(),
  );

  const dataQualityConfiguredSources = runtime.dataQuality.configuredSources();
  const dataQualityReady = Object.values(dataQualityConfiguredSources).some(
    (count) => count >= options.config.dataQualityMinSources,
  );

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
        id: 'typed-ledger-query',
        status:
          runtime.evmAdapters.size > 0 &&
          runtime.bitcoinAdapter !== undefined &&
          runtime.solanaAdapter !== undefined
            ? 'IMPLEMENTED'
            : 'PROVIDERS_PARTIALLY_CONFIGURED',
        detail:
          'Read-only EVM transaction/block, Bitcoin transaction/block/outpoint, and Solana transaction/slot queries use strict provider-response validation and bind observations to Evidence plus replayable Snapshots. Null, pending, mempool, and provider failures remain distinct.',
      },
      {
        id: 'flap-bsc-inspection',
        status: runtime.evmAdapters.has(56)
          ? 'PARTIALLY_IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'Versioned read-only Flap Portal V8Safe/V6/V5 decoding binds deployment metadata, bytecode, raw state, normalized launch fields, Snapshot, and Evidence. Transaction-local TokenCreated/configuration/migration decoding is available separately; automatic history discovery, tax/vault internals, migration/LP control analysis, and complete realizable value remain pending.',
      },
      {
        id: 'flap-event-transaction',
        status: runtime.evmAdapters.has(56)
          ? 'IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'A caller-supplied Flap transaction hash is decoded against the versioned Portal event interface at its exact block. Creation defaults remain source-tagged, unavailable curve internals remain Unknown, and migration facts carry receipt/log/derived Evidence. Chain-wide discovery remains pending.',
      },
      {
        id: 'flap-bounded-event-history',
        status: runtime.evmAdapters.has(56)
          ? 'IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'Bounded Portal log ranges use the finalized SQD BSC stream when configured, with strict RPC-log fallback, then decode by token and replay exact RPC receipts/block hashes. Requested-range coverage is distinct from token-lifetime coverage, which remains Unknown until deployment-origin indexing is continuous.',
      },
      {
        id: 'flap-event-history-projection',
        status:
          runtime.semanticCheckpoints === undefined || runtime.flapHistoryProjection === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A one-shot worker with separately configured SQD/BSC read providers projects wider finalized ranges as immutable bounded segments, persists each segment before cursor advancement, and resumes one exact pending segment after interruption. This API replays stored scan-ID pages without providers. Requested-range completion does not imply continuous token-lifetime coverage.',
      },
      {
        id: 'flap-lifetime-materialization',
        status:
          runtime.semanticCheckpoints === undefined || runtime.flapHistoryProjection === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A one-shot worker composes official SQD dataset-start metadata, unique Flap deployment origin, and immutable origin-to-target event history at one exact finalized BSC Snapshot. Lifetime coverage is Known only when every child proof is complete; this API replays the composite checkpoint by scan ID without contacting providers.',
      },
      {
        id: 'flap-lifetime-heads',
        status:
          runtime.semanticCheckpoints === undefined ||
          runtime.flapHistoryProjection === undefined ||
          runtime.flapLifetimeHeads === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A continuous read-only worker reconciles a finalized BSC endpoint quorum, accepts one exact INITIAL lifetime materialization, then appends only Evidence-proven continuous deltas. A finalized conflict triggers all-source historical verification, append-only suffix invalidation and safe replay from the newest verified ancestor; unavailable or disagreeing sources cannot choose a branch. The latest accepted state replays without providers; forced real-reorg and independent-operator acceptance remain pending.',
      },
      {
        id: 'flap-token-origin',
        status: !runtime.evmAdapters.has(56)
          ? 'BSC_PROVIDER_REQUIRED'
          : runtime.sqdBscCreationReader === undefined
            ? 'SQD_PROVIDER_REQUIRED'
            : runtime.semanticCheckpoints === undefined
              ? 'IMPLEMENTED_EPHEMERAL_PENDING_REAL_CHAIN_VALIDATION'
              : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A synchronous, range-limited finalized SQD create-trace search validates multi-response continuation metadata and rebinds a unique result to the exact BSC receipt, TokenCreated event, and Snapshot. When PostgreSQL is configured, every bounded chunk and terminal result resumes through immutable semantic checkpoints. Empty bounded ranges produce negative Evidence but never imply lifetime absence; the continuous lifetime scheduler composes this primitive only after exact coverage.',
      },
      {
        id: 'flap-bsc-sell-preview',
        status: runtime.evmAdapters.has(56)
          ? 'PARTIALLY_IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'Read-only Portal previewSell produces a fixed-block, provider-observed quote with Evidence. Non-tradable, migrated, unsupported, excessive-input, and provider-failure states never become zero proceeds.',
      },
      {
        id: 'cross-source-anchor-reconciliation',
        status: dataQualityReady
          ? runtime.dataQuality.durable
            ? 'IMPLEMENTED_DURABLE_PENDING_INDEPENDENT_VALIDATION'
            : 'IMPLEMENTED_EPHEMERAL_PENDING_INDEPENDENT_VALIDATION'
          : 'INDEPENDENT_PROVIDERS_REQUIRED',
        detail:
          'Common-position anchor comparison, continuity checks, reorg alerts, and explicit disagreement states are wired. Endpoint operator independence is not inferred from hostnames.',
      },
      {
        id: 'typed-discrepancy-audit',
        status: 'IMPLEMENTED_DETERMINISTIC',
        detail:
          'Evidence-grounded same-Snapshot comparisons enforce zero mismatch for exact state, exact-decimal typed budgets for derived/quote/aggregate values, warning bands, coverage gates, and Unknown exclusion from numeric denominators.',
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
          'Restart-safe SQD finalized blocks, transactions, EVM logs/traces/state diffs, Bitcoin inputs/outputs, and Solana instructions/logs/balances/token balances/rewards are implemented with durable provenance. Anchor continuity/reorg detection is wired separately; semantic transfers, protocol decoding, continuous scheduling, and historical replay policy remain pending.',
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
        const [balanceObservation, codeObservation] = await Promise.all([
          adapter.getBalanceObservation(subject.normalizedId, blockTag),
          adapter.getCodeObservation(subject.normalizedId, blockTag),
        ]);
        const balanceHex = balanceObservation.value;
        const code = codeObservation.value;
        const observationSources = {
          balance: balanceObservation.endpointId,
          code: codeObservation.endpointId,
        };
        const stateSourceIds = uniqueSourceIds(Object.values(observationSources));
        const sourceSet = uniqueSourceIds([...snapshotSourceIds(snapshot), ...stateSourceIds]);
        const payload = {
          balanceHex,
          code,
          blockTag,
          blockHash: snapshot.blockHash,
          observationSources,
        };
        const evidence = await addEvidence(
          runtime,
          createEvidence({
            ledger: 'EVM',
            chainId: snapshot.chainId,
            kind: 'ACCOUNT_STATE',
            source: evidenceSourceId(stateSourceIds),
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
          sourceSet,
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
        const statsObservation = await adapter.getAddressObservation(subject.normalizedId);
        const stats = statsObservation.value;
        const sourceSet = uniqueSourceIds([
          ...snapshotSourceIds(snapshot),
          statsObservation.endpointId,
        ]);
        const payload = {
          stats,
          snapshotHeight: snapshot.height,
          snapshotHash: snapshot.blockHash,
          observationSource: statsObservation.endpointId,
        };
        const evidence = await addEvidence(
          runtime,
          createEvidence({
            ledger: 'BITCOIN',
            chainId: snapshot.chainId,
            kind: 'ACCOUNT_STATE',
            source: statsObservation.endpointId,
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
            sourceSet,
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
      const accountObservation = await adapter.getAccountInfoObservation(
        subject.normalizedId,
        Number(snapshot.slot),
      );
      const response = accountObservation.value;
      const value = response.value;
      const sourceSet = uniqueSourceIds([
        ...snapshotSourceIds(snapshot),
        accountObservation.endpointId,
      ]);
      const payload = {
        response,
        snapshotSlot: snapshot.slot,
        snapshotBlockhash: snapshot.blockhash,
        observationSource: accountObservation.endpointId,
      };
      const evidence = await addEvidence(
        runtime,
        createEvidence({
          ledger: 'SOLANA',
          chainId: snapshot.chainId,
          kind: 'ACCOUNT_STATE',
          source: accountObservation.endpointId,
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
          lamports:
            account === undefined
              ? unknownValue('INSUFFICIENT_DATA', 'The account does not exist at this Snapshot.')
              : knownValue(account.lamports),
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
          sourceSet,
          modelVersion: 'solana-subject-v0.1.0',
          confidence: 1,
          evidenceIds: [evidence.id],
        },
        evidence: [evidence],
      };
    },
  );

  app.get(
    '/api/v1/ledger/:ledger/:type/:id',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LedgerRecordParamsSchema.parse(request.params);
      const query = LedgerRecordQuerySchema.parse(request.query);
      if (params.type === 'OUTPOINT' && params.ledger !== 'BITCOIN') {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'UNSUPPORTED_IDENTIFIER_TYPE',
              'Outpoints are only supported on Bitcoin.',
              false,
            ),
          );
      }
      const canonicalNonEvmChainId =
        params.ledger === 'BITCOIN'
          ? 'bitcoin-mainnet'
          : params.ledger === 'SOLANA'
            ? 'solana-mainnet'
            : undefined;
      if (
        query.chainId !== undefined &&
        canonicalNonEvmChainId !== undefined &&
        query.chainId !== canonicalNonEvmChainId
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_CHAIN_ID',
              `${params.ledger} queries require chainId=${canonicalNonEvmChainId}.`,
              false,
            ),
          );
      }
      const requestedChainId =
        params.ledger === 'EVM'
          ? (query.chainId ?? `eip155:${options.config.ethereumChainId}`)
          : params.ledger === 'BITCOIN'
            ? 'bitcoin-mainnet'
            : 'solana-mainnet';
      const classification = classifyIdentifier(params.id, {
        ledger: params.ledger,
        type: params.type,
        chainId: requestedChainId,
      });
      const subject = classification.candidates.find(
        (candidate) => candidate.ledger === params.ledger && candidate.type === params.type,
      );
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              `A structurally valid ${params.ledger} ${params.type.toLowerCase()} identifier is required.`,
              false,
            ),
          );
      }
      const writeEvidence = (
        evidence: Evidence,
        sourceEvidenceIds: readonly string[] = [],
        snapshot?: AnalysisSnapshot,
      ) => addEvidence(runtime, evidence, sourceEvidenceIds, snapshot);

      if (params.ledger === 'EVM') {
        const match = /^eip155:([1-9]\d*)$/.exec(requestedChainId);
        const numericChainId = match === null ? Number.NaN : Number(match[1]);
        if (!Number.isSafeInteger(numericChainId)) {
          return reply
            .code(400)
            .send(errorResponse(request, 'INVALID_CHAIN_ID', 'Invalid EIP-155 chain ID.', false));
        }
        const adapter = runtime.evmAdapters.get(numericChainId);
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata(`evm-${params.type.toLowerCase()}-query-v0.1.0`),
          });
        }
        return params.type === 'BLOCK'
          ? queryEvmBlock(adapter, subject, writeEvidence)
          : queryEvmTransaction(adapter, subject, writeEvidence);
      }

      if (params.ledger === 'BITCOIN') {
        const adapter = runtime.bitcoinAdapter;
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata(`bitcoin-${params.type.toLowerCase()}-query-v0.1.0`),
          });
        }
        if (params.type === 'BLOCK') return queryBitcoinBlock(adapter, subject, writeEvidence);
        if (params.type === 'OUTPOINT') {
          return queryBitcoinOutpoint(adapter, subject, writeEvidence);
        }
        return queryBitcoinTransaction(adapter, subject, writeEvidence);
      }

      const adapter = runtime.solanaAdapter;
      if (adapter === undefined) {
        return reply.code(503).send({
          subject,
          facts: unavailableValue('PROVIDER_UNCONFIGURED'),
          metadata: emptyMetadata(`solana-${params.type.toLowerCase()}-query-v0.1.0`),
        });
      }
      return params.type === 'BLOCK'
        ? querySolanaBlock(adapter, subject, writeEvidence)
        : querySolanaTransaction(adapter, subject, writeEvidence);
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
    '/api/v1/launches/:ledger/:token',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LaunchInspectionParamsSchema.parse(request.params);
      const query = LaunchInspectionQuerySchema.parse(request.query);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        return reply.code(503).send({
          platform: 'flap',
          token: params.token,
          platformMatch: unavailableValue('PROVIDER_UNCONFIGURED'),
          launch: null,
          metadata: emptyMetadata('flap-inspector-v0.1.0'),
        });
      }
      return inspectFlapToken({
        adapter,
        token: params.token,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(query.blockNumber === undefined ? {} : { blockNumber: query.blockNumber }),
      });
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

  app.get(
    '/api/v1/launches/:ledger/:token/events/:transactionHash',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = FlapEventTransactionParamsSchema.parse(request.params);
      FlapEventTransactionQuerySchema.parse(request.query);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        return reply.code(503).send({
          platform: 'flap',
          token: params.token,
          transactionHash: params.transactionHash,
          platformMatch: unavailableValue(
            'PROVIDER_UNCONFIGURED',
            'A BNB Smart Chain read-only provider is required.',
          ),
          transactionKind: null,
          creation: null,
          staged: null,
          configuration: null,
          migration: null,
          decodedEventNames: [],
          unrecognizedPortalLogCount: null,
          metadata: emptyMetadata(FLAP_EVENT_MODEL_VERSION),
          evidence: [],
        });
      }
      return inspectFlapEventTransaction({
        adapter,
        token: params.token,
        transactionHash: params.transactionHash,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
      });
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/history',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LaunchInspectionParamsSchema.parse(request.params);
      const query = FlapEventHistoryQuerySchema.parse(request.query);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        const chunkSize = query.chunkSize ?? FLAP_HISTORY_DEFAULT_CHUNK_SIZE;
        const fromBlock = BigInt(query.fromBlock);
        const toBlock = BigInt(query.toBlock);
        const range = toBlock >= fromBlock ? toBlock - fromBlock + 1n : 0n;
        return reply.code(503).send({
          platform: 'flap',
          token: params.token,
          requestedRange: {
            fromBlock: query.fromBlock,
            toBlock: query.toBlock,
            chunkSize,
            chunkCount:
              range === 0n ? 0 : Number((range + BigInt(chunkSize) - 1n) / BigInt(chunkSize)),
          },
          requestedRangeCoverage: 0,
          lifetimeCoverage: unavailableValue(
            'PROVIDER_UNCONFIGURED',
            'A BNB Smart Chain read-only provider is required.',
          ),
          chronology: [],
          transactions: [],
          unrecognizedPortalLogCount: null,
          metadata: emptyMetadata(FLAP_HISTORY_MODEL_VERSION),
          evidence: [],
        });
      }
      return discoverFlapEventHistory({
        adapter,
        ...(runtime.sqdBscLogReader === undefined ? {} : { logReader: runtime.sqdBscLogReader }),
        token: params.token,
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(query.chunkSize === undefined ? {} : { chunkSize: query.chunkSize }),
      });
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/history/projections/:scanId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = FlapHistoryProjectionParamsSchema.parse(request.params);
      const query = FlapHistoryProjectionPageQuerySchema.parse(request.query);
      const classification = classifyIdentifier(params.token, {
        ledger: 'EVM',
        type: 'ADDRESS',
        chainId: 'eip155:56',
      });
      const subject = classification.candidates.find(
        (candidate) => candidate.ledger === 'EVM' && candidate.type === 'ADDRESS',
      );
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              'A structurally valid EVM token address is required.',
              false,
            ),
          );
      }
      const checkpoints = runtime.semanticCheckpoints;
      const projection = runtime.flapHistoryProjection;
      if (checkpoints === undefined || projection === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_HISTORY_PROJECTION_UNAVAILABLE',
              'Durable Flap history projection storage is not configured.',
              false,
            ),
          );
      }
      const run = await checkpoints.get(params.scanId);
      if (
        run === undefined ||
        run.scanType !== 'FLAP_EVENT_HISTORY' ||
        run.source !== 'sqd:binance-mainnet' ||
        run.ledger !== 'EVM' ||
        run.chainId !== 'eip155:56' ||
        run.subject !== subject.normalizedId.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_HISTORY_PROJECTION_NOT_FOUND',
              'The requested Flap history projection was not found.',
              false,
            ),
          );
      }
      let terminalResult = null;
      if (run.status === 'REQUESTED_RANGE_COMPLETE') {
        const state =
          typeof run.state === 'object' && run.state !== null && !Array.isArray(run.state)
            ? run.state
            : undefined;
        const parsed = FlapEventHistoryProjectionSchema.safeParse(state?.result);
        if (!parsed.success) {
          throw new FlapHistoryProjectionError(
            'FLAP_HISTORY_PROJECTION_CONFLICT',
            'Completed Flap history projection terminal state is invalid.',
            { cause: parsed.error },
          );
        }
        terminalResult = parsed.data;
      }
      const stored = await projection.listSegments(run.id, {
        ...(query.afterBlock === undefined ? {} : { afterBlock: query.afterBlock }),
        limit: query.limit + 1,
      });
      const hasMore = stored.length > query.limit;
      const segments = stored.slice(0, query.limit);
      const last = segments.at(-1);
      const requestedBlocks = run.toBlock - run.fromBlock + 1;
      const completedBlocks = Math.max(0, Math.min(requestedBlocks, run.nextBlock - run.fromBlock));
      return {
        scan: {
          id: run.id,
          status: run.status,
          source: run.source,
          chainId: run.chainId,
          token: run.subject,
          requestedRange: {
            fromBlock: String(run.fromBlock),
            toBlock: String(run.toBlock),
            segmentSize: run.chunkSize,
          },
          nextBlock: String(run.nextBlock),
          requestedRangeCoverage: completedBlocks / requestedBlocks,
          evidenceIds: [...run.evidenceIds],
          lastErrorCode: run.lastErrorCode,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          completedAt: run.completedAt,
          terminalResult,
        },
        page: {
          afterBlock: query.afterBlock ?? null,
          limit: query.limit,
          hasMore,
          nextAfterBlock: hasMore && last !== undefined ? last.fromBlock : null,
        },
        segments,
      };
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/history/lifetime/heads/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LaunchInspectionParamsSchema.parse(request.params);
      FlapEventTransactionQuerySchema.parse(request.query);
      const classification = classifyIdentifier(params.token, {
        ledger: 'EVM',
        type: 'ADDRESS',
        chainId: 'eip155:56',
      });
      const subject = classification.candidates.find(
        (candidate) => candidate.ledger === 'EVM' && candidate.type === 'ADDRESS',
      );
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              'A structurally valid EVM token address is required.',
              false,
            ),
          );
      }
      const heads = runtime.flapLifetimeHeads;
      if (heads === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_LIFETIME_HEAD_UNAVAILABLE',
              'Durable Flap lifetime head storage is not configured.',
              false,
            ),
          );
      }
      const head = await heads.latestHead('eip155:56', subject.normalizedId.toLowerCase());
      if (head === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_LIFETIME_HEAD_NOT_FOUND',
              'No accepted Flap lifetime head exists for this token.',
              false,
            ),
          );
      }
      return { head };
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/history/lifetime/materializations/:scanId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = FlapHistoryProjectionParamsSchema.parse(request.params);
      FlapEventTransactionQuerySchema.parse(request.query);
      const classification = classifyIdentifier(params.token, {
        ledger: 'EVM',
        type: 'ADDRESS',
        chainId: 'eip155:56',
      });
      const subject = classification.candidates.find(
        (candidate) => candidate.ledger === 'EVM' && candidate.type === 'ADDRESS',
      );
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              'A structurally valid EVM token address is required.',
              false,
            ),
          );
      }
      const checkpoints = runtime.semanticCheckpoints;
      if (checkpoints === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_LIFETIME_MATERIALIZATION_UNAVAILABLE',
              'Durable Flap lifetime materialization storage is not configured.',
              false,
            ),
          );
      }
      const run = await checkpoints.get(params.scanId);
      if (
        run === undefined ||
        run.scanType !== 'FLAP_LIFETIME_MATERIALIZATION' ||
        run.source !== FLAP_LIFETIME_MATERIALIZATION_SOURCE ||
        run.ledger !== 'EVM' ||
        run.chainId !== 'eip155:56' ||
        run.subject !== subject.normalizedId.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_LIFETIME_MATERIALIZATION_NOT_FOUND',
              'The requested Flap lifetime materialization was not found.',
              false,
            ),
          );
      }
      let terminalResult = null;
      if (run.status === 'REQUESTED_RANGE_COMPLETE') {
        const state =
          typeof run.state === 'object' && run.state !== null && !Array.isArray(run.state)
            ? run.state
            : undefined;
        const parsed = FlapLifetimeMaterializationSchema.safeParse(state?.result);
        if (!parsed.success) {
          throw new SemanticCheckpointError(
            'SEMANTIC_CHECKPOINT_CONFLICT',
            'Completed Flap lifetime materialization terminal state is invalid.',
            { cause: parsed.error },
          );
        }
        terminalResult = parsed.data;
      }
      const requestedBlocks = run.toBlock - run.fromBlock + 1;
      const completedBlocks = Math.max(0, Math.min(requestedBlocks, run.nextBlock - run.fromBlock));
      return {
        scan: {
          id: run.id,
          status: run.status,
          source: run.source,
          chainId: run.chainId,
          token: run.subject,
          dataset: 'binance-mainnet',
          datasetStartBlock: String(run.fromBlock),
          targetBlock: String(run.toBlock),
          nextBlock: String(run.nextBlock),
          requestedRangeCoverage: completedBlocks / requestedBlocks,
          evidenceIds: [...run.evidenceIds],
          lastErrorCode: run.lastErrorCode,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          completedAt: run.completedAt,
          terminalResult,
        },
      };
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/origin',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LaunchInspectionParamsSchema.parse(request.params);
      const query = FlapTokenOriginQuerySchema.parse(request.query);
      const adapter = runtime.evmAdapters.get(56);
      const creationReader = runtime.sqdBscCreationReader;
      if (adapter === undefined || creationReader === undefined) {
        const detail =
          adapter === undefined
            ? 'A BNB Smart Chain read-only provider is required.'
            : 'The finalized SQD BSC source is required for contract-creation trace discovery.';
        return reply.code(503).send({
          platform: 'flap',
          token: params.token,
          searchedRange: {
            fromBlock: query.fromBlock,
            toBlock: query.toBlock,
            chunkSize: query.chunkSize ?? FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
            chunkCount: Number(
              (BigInt(query.toBlock) -
                BigInt(query.fromBlock) +
                BigInt(query.chunkSize ?? FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE)) /
                BigInt(query.chunkSize ?? FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE),
            ),
          },
          searchedRangeCoverage: 0,
          origin: unavailableValue('PROVIDER_UNCONFIGURED', detail),
          lifetimeCoverage: unavailableValue('PROVIDER_UNCONFIGURED', detail),
          observedCreationCount: 0,
          metadata: emptyMetadata(FLAP_TOKEN_ORIGIN_MODEL_VERSION),
          evidence: [],
        });
      }
      const originOptions: InspectFlapTokenOriginOptions = {
        adapter,
        creationReader,
        token: params.token,
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(query.chunkSize === undefined ? {} : { chunkSize: query.chunkSize }),
      };
      return runtime.semanticCheckpoints === undefined
        ? inspectFlapTokenOrigin(originOptions)
        : inspectFlapTokenOriginRestartSafe({
            ...originOptions,
            checkpoints: runtime.semanticCheckpoints,
          });
    },
  );

  app.post('/api/v1/rv/flap-sell', { schema: { tags: ['analysis'] } }, async (request, reply) => {
    const input = FlapSellQuoteRequestSchema.parse(request.body);
    const adapter = runtime.evmAdapters.get(56);
    if (adapter === undefined) {
      const unavailable = unavailableValue(
        'PROVIDER_UNCONFIGURED',
        'A BNB Smart Chain read-only provider is required.',
      );
      return reply.code(503).send({
        platform: 'flap',
        token: input.token,
        quoteAsset: unavailable,
        quote: {
          inputQuantity: input.inputQuantity,
          nominalValue: unavailable,
          realizableValue: unavailable,
          averageExitPrice: unavailable,
          priceImpactBps: unavailable,
          totalFeeBps: unavailable,
          route: [],
          metadata: emptyMetadata('flap-preview-sell-v0.1.0'),
        },
        evidence: [],
      });
    }
    return quoteFlapSell({
      adapter,
      token: input.token,
      inputQuantity: input.inputQuantity,
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
        addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
      ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
    });
  });

  app.post(
    '/api/v1/rv/flap-pancake-v2-buy-scenarios',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPancakeV2BuyScenarioRequestSchema.parse(request.body);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        const detail = 'A BNB Smart Chain read-only provider is required.';
        return reply.code(503).send({
          platform: 'flap',
          token: input.token.toLowerCase(),
          market: unavailableValue('PROVIDER_UNCONFIGURED', detail),
          scenarios: [],
          validation: {
            status: 'NOT_RUN',
            deterministicToleranceBps: '10',
            evaluatedScenarioCount: 0,
            failedScenarioCount: 0,
          },
          pensionSinkTreatment: unknownValue(
            'INSUFFICIENT_DATA',
            'Sending tokens to a wallet is not a burn; custody and execution Evidence are unavailable.',
          ),
          terminalEvidenceId: null,
          metadata: emptyMetadata('flap-pancake-v2-pool-buy-scenarios-v0.1.0'),
          evidence: [],
        });
      }
      return quoteFlapPancakeV2BuyScenarios({
        adapter,
        token: input.token,
        quoteInputs: input.quoteInputs,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
      });
    },
  );

  app.post(
    '/api/v1/rv/flap-pancake-v2-sell-scenarios',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPancakeV2SellScenarioRequestSchema.parse(request.body);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        const detail = 'A BNB Smart Chain read-only provider is required.';
        return reply.code(503).send({
          platform: 'flap',
          token: input.token.toLowerCase(),
          market: unavailableValue('PROVIDER_UNCONFIGURED', detail),
          scenarios: [],
          validation: {
            status: 'NOT_RUN',
            deterministicToleranceBps: '10',
            evaluatedScenarioCount: 0,
            failedScenarioCount: 0,
          },
          executionCapacity: unknownValue(
            'NOT_QUERIED',
            'Pinned-fork sell-capacity validation requires a configured BNB Smart Chain provider.',
          ),
          terminalEvidenceId: null,
          metadata: emptyMetadata('flap-pancake-v2-pool-sell-scenarios-v0.1.0'),
          evidence: [],
        });
      }
      return quoteFlapPancakeV2SellScenarios({
        adapter,
        token: input.token,
        tokenInputs: input.tokenInputs,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
      });
    },
  );

  app.post(
    '/api/v1/data-quality/discrepancies',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = DiscrepancyAuditRequestSchema.parse(request.body);
      if (input.checks.length === 0) return auditDiscrepancies(input.checks, input.metadata);
      if (input.metadata.snapshot === null) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Discrepancy comparisons require a target ledger Snapshot.',
        );
      }
      const sourceEvidenceIds = uniqueEvidenceIds([
        ...input.metadata.evidenceIds,
        ...input.checks.flatMap((check) => [
          ...check.actual.evidenceIds,
          ...check.reference.evidenceIds,
          ...(check.sourceIndependenceEvidenceIds ?? []),
          ...(check.explanationEvidenceIds ?? []),
        ]),
      ]);
      if (sourceEvidenceIds.length === 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'A non-empty discrepancy audit requires at least one source Evidence node.',
        );
      }
      const missingIds = await missingEvidenceIds(runtime, sourceEvidenceIds);
      if (missingIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Discrepancy source or explanation Evidence is not present in the evidence ledger.',
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
          'Discrepancy Evidence is not anchored to the target Snapshot.',
          incompatibleIds,
          'SNAPSHOT_INCOMPATIBLE',
        );
      }
      const result = auditDiscrepancies(input.checks, input.metadata);
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        input.metadata.snapshot,
        sourceEvidenceIds,
        DISCREPANCY_MODEL_VERSION,
        `data-quality:discrepancy-audit:${hashPayload(input.checks)}`,
        { input, result },
        'Typed same-Snapshot discrepancy and error-budget audit.',
      );
      return {
        ...result,
        checks: result.checks.map((check) => ({
          ...check,
          evidenceIds: uniqueEvidenceIds([...check.evidenceIds, derived.id]),
        })),
        metadata: {
          ...result.metadata,
          evidenceIds: uniqueEvidenceIds([...result.metadata.evidenceIds, derived.id]),
        },
        evidence: [derived],
      };
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

  app.post(
    '/api/v1/claims/declarations/parse',
    { schema: { tags: ['intelligence'] } },
    async (request) => {
      const input = ClaimDeclarationParseRequestSchema.parse(request.body);
      const result = parseEvmClaimDeclaration({
        text: input.text,
        chainId: input.chainId,
        assetId: input.assetId,
        source: 'api:user-submitted-claim-declaration',
        observedAt: new Date().toISOString(),
        ...(input.sourceUri === undefined ? {} : { sourceUri: input.sourceUri }),
        ...(input.auditWindow === undefined ? {} : { auditWindow: input.auditWindow }),
      });
      const evidence = await addEvidence(runtime, result.evidence);
      return { ...result, evidence };
    },
  );

  app.post(
    '/api/v1/claims/:ledger/:token/burn-conservation',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const input = ClaimBurnRequestSchema.parse(request.body);
      const numericChainId = Number(input.chainId.slice('eip155:'.length));
      if (!Number.isSafeInteger(numericChainId)) {
        return reply
          .code(400)
          .send(errorResponse(request, 'INVALID_CHAIN_ID', 'Invalid EIP-155 chain ID.', false));
      }
      const adapter = runtime.evmAdapters.get(numericChainId);
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A configured EVM provider is required for burn conservation.',
              true,
            ),
          );
      }
      const anchor = await adapter.readAnchorAt(input.blockNumber);
      if (anchor.snapshot.ledger !== 'EVM' || anchor.snapshot.finality !== 'finalized') {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FINALIZED_PROVIDER_REQUIRED',
              'Burn conservation requires a finalized EVM Snapshot.',
              true,
            ),
          );
      }
      const run = await observeEvmClaimBurnBlock({
        tokenAddress: params.token,
        snapshot: anchor.snapshot,
        adapter,
        logReader: adapter,
        blockReader: adapter,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.maxTransfers === undefined ? {} : { maxTransfers: input.maxTransfers }),
      });
      return run;
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/addresses/:address/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimReportParamsSchema.parse(request.params);
      const query = ClaimReportQuerySchema.parse(request.query);
      const repository = runtime.claimReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_REPORT_UNAVAILABLE',
              'Durable Claim Report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(
        query.chainId,
        params.token.toLowerCase(),
        params.address.toLowerCase(),
      );
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_REPORT_NOT_FOUND',
              'No durable Claim Report exists for this token and address.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/addresses/:address/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimReportByIdParamsSchema.parse(request.params);
      const query = ClaimReportQuerySchema.parse(request.query);
      const repository = runtime.claimReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_REPORT_UNAVAILABLE',
              'Durable Claim Report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (
        record === undefined ||
        record.chainId !== query.chainId ||
        record.tokenAddress !== params.token.toLowerCase() ||
        record.address !== params.address.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_REPORT_NOT_FOUND',
              'The requested durable Claim Report was not found for this subject.',
              false,
            ),
          );
      }
      return { record };
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
