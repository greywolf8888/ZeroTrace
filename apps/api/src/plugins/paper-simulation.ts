import type { FastifyInstance } from 'fastify';

import {
  createPaperExperiment,
  type PaperCommand,
  type PaperExperiment,
} from '@zerotrace/asset-ledger';
import {
  PaperSimulationStorageError,
  type PostgresPaperSimulationRepository,
} from '@zerotrace/storage';

import type { AppHttpContext } from '../http/context.js';
import {
  PaperCommandRequestSchema,
  PaperExperimentCreateSchema,
  PaperExperimentParamsSchema,
  PaperOutboxQuerySchema,
} from '../paper-simulation-schemas.js';

const WARNING = '仅为可重放的模拟研究，不是投资建议；不会签名、广播交易或移动真实资金。';

function repository(context: AppHttpContext): PostgresPaperSimulationRepository {
  if (context.runtime.paperSimulation === undefined) {
    throw new PaperSimulationStorageError(
      'PAPER_STORAGE_NOT_INITIALIZED',
      'Durable paper simulation storage is not configured.',
    );
  }
  return context.runtime.paperSimulation;
}

function response(experiment: PaperExperiment) {
  return {
    mode: 'PAPER' as const,
    chainAccess: 'READ_ONLY' as const,
    warning: WARNING,
    experiment,
  };
}

export async function registerPaperSimulationRoutes(
  app: FastifyInstance,
  context: AppHttpContext,
): Promise<void> {
  app.post(
    '/api/v1/paper/experiments',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = PaperExperimentCreateSchema.parse(request.body);
      const experiment = createPaperExperiment({
        name: input.name,
        chain: input.chain,
        initialPrincipalAtomic: input.initialPrincipalAtomic,
        policy: input.policy,
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      });
      const stored = await repository(context).create(experiment);
      return reply.code(201).send(response(stored));
    },
  );

  app.get(
    '/api/v1/paper/experiments/:experimentId',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const { experimentId } = PaperExperimentParamsSchema.parse(request.params);
      const experiment = await repository(context).get(experimentId);
      if (experiment === undefined) {
        throw new PaperSimulationStorageError(
          'PAPER_STORAGE_NOT_FOUND',
          'Paper experiment not found.',
        );
      }
      return response(experiment);
    },
  );

  app.post(
    '/api/v1/paper/experiments/:experimentId/commands',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const { experimentId } = PaperExperimentParamsSchema.parse(request.params);
      const input = PaperCommandRequestSchema.parse(request.body);
      const experiment = await repository(context).apply({
        experimentId,
        command: input.command as PaperCommand,
        ...(input.expectedRevision === undefined
          ? {}
          : { expectedRevision: input.expectedRevision }),
      });
      return response(experiment);
    },
  );

  app.get(
    '/api/v1/paper/experiments/:experimentId/outbox',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const { experimentId } = PaperExperimentParamsSchema.parse(request.params);
      const query = PaperOutboxQuerySchema.parse(request.query);
      const page = await repository(context).listOutbox({
        experimentId,
        limit: query.limit,
        ...(query.after === undefined ? {} : { after: query.after }),
      });
      return {
        mode: 'PAPER' as const,
        deliverySemantics: 'AT_LEAST_ONCE_WITH_BUSINESS_KEY_DEDUP' as const,
        warning: WARNING,
        ...page,
      };
    },
  );
}
