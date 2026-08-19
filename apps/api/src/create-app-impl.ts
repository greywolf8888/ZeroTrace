import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';

import type { AppConfig } from './config.js';
import { createRuntime, type AppRuntime } from './runtime.js';
import { CorsOriginError, registerApiErrorHandler } from './http/error-handler.js';
import { createHealthProbes } from './http/health.js';
import type { AppHttpContext } from './http/context.js';
import type { ForensicReportStore } from './plugins/market-structure.js';
import { registerMarketStructureV2 } from './plugins/market-structure.js';
import { registerSystemRoutes } from './plugins/system.js';
import { registerSearchAndLabelRoutes } from './plugins/search-labels.js';
import { registerSolanaBitcoinLedgerRoutes } from './plugins/solana-bitcoin.js';
import { registerEvidenceAndLaunchRoutes } from './plugins/evidence-launches.js';
import { registerRvAndFlapMarketRoutes } from './plugins/rv-flap.js';
import { registerEntityRelationshipRoutes } from './plugins/entities-relationships.js';
import { registerEntityGraphRoutes } from './plugins/entities-graphs.js';
import { registerScenarioAndClaimDeclarationRoutes } from './plugins/scenarios-claims.js';
import { registerClaimObservationRoutes } from './plugins/claims-observation.js';
import { registerControlRightsRoutes } from './plugins/control-rights.js';
import { registerFundingAndCampaignRoutes } from './plugins/funding-campaigns.js';
import { registerForensicCaseRoutes } from './plugins/forensics.js';

export interface CreateAppOptions {
  config: AppConfig;
  runtime?: AppRuntime;
  logger?: boolean;
  forensicReports?: ForensicReportStore;
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

  const probes = createHealthProbes(runtime, options.config);
  const ctx: AppHttpContext = {
    runtime,
    config: options.config,
    metricsRegistry,
    ...probes,
    ...(options.forensicReports === undefined ? {} : { forensicReports: options.forensicReports }),
  };
  registerApiErrorHandler(app);
  await registerSystemRoutes(app, ctx);
  await registerSearchAndLabelRoutes(app, ctx);
  await registerSolanaBitcoinLedgerRoutes(app, ctx);
  await registerEvidenceAndLaunchRoutes(app, ctx);
  await registerRvAndFlapMarketRoutes(app, ctx);
  await registerEntityRelationshipRoutes(app, ctx);
  await registerEntityGraphRoutes(app, ctx);
  await registerScenarioAndClaimDeclarationRoutes(app, ctx);
  await registerClaimObservationRoutes(app, ctx);
  await registerControlRightsRoutes(app, ctx);
  await registerFundingAndCampaignRoutes(app, ctx);
  await registerForensicCaseRoutes(app, ctx);
  await registerMarketStructureV2(app, {
    runtime,
    ...(options.forensicReports !== undefined
      ? { forensicReports: options.forensicReports }
      : runtime.forensicReports === undefined
        ? {}
        : { forensicReports: runtime.forensicReports }),
  });
  return app;
}
