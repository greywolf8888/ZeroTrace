import type { FastifyInstance } from 'fastify';

import {
  createPaperExperiment,
  buildPaperReview,
  type PaperCommand,
  type PaperExperiment,
  type RejectedCandidateReviewInput,
} from '@zerotrace/asset-ledger';
import {
  PaperSimulationStorageError,
  type PostgresPaperSimulationRepository,
} from '@zerotrace/storage';

import type { AppHttpContext } from '../http/context.js';
import { loadPaperPortfolioSettings } from '../paper-portfolio-settings.js';
import {
  PaperCommandRequestSchema,
  PaperExperimentCreateSchema,
  PaperExperimentParamsSchema,
  PaperNotificationClaimSchema,
  PaperNotificationParamsSchema,
  PaperNotificationSettlementSchema,
  PaperOutboxQuerySchema,
  PaperReviewCreateSchema,
  PaperReviewParamsSchema,
} from '../paper-simulation-schemas.js';

const WARNING = '仅为可重放的模拟研究，不是投资建议；不会签名、广播交易或移动真实资金。';
const DELIVERY_SEMANTICS = 'AT_LEAST_ONCE_WITH_BUSINESS_KEY_DEDUP' as const;

function deliveryActor(request: { zerotracePrincipal: { subject: string } | null }): string {
  return request.zerotracePrincipal?.subject ?? 'non-production-local-session';
}

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

async function requireEvidence(
  context: AppHttpContext,
  evidenceIds: readonly string[],
  chain: PaperExperiment['chain'],
  availableBy: string,
): Promise<void> {
  const evidence = context.runtime.evidenceRepository;
  if (evidence === undefined) {
    throw new PaperSimulationStorageError(
      'PAPER_STORAGE_NOT_INITIALIZED',
      'Durable Evidence storage is required for paper state changes.',
    );
  }
  const expected =
    chain === 'BSC'
      ? { ledger: 'EVM', chainId: 'eip155:56' }
      : { ledger: 'SOLANA', chainId: 'solana-mainnet' };
  const cutoff = new Date(availableBy).getTime();
  const nodes = await Promise.all(evidenceIds.map((id) => evidence.get(id)));
  if (
    nodes.some(
      (node, index) =>
        node === undefined ||
        node.evidence.id !== evidenceIds[index] ||
        node.evidence.ledger !== expected.ledger ||
        node.evidence.chainId !== expected.chainId ||
        new Date(node.evidence.observedAt).getTime() > cutoff,
    )
  ) {
    throw new PaperSimulationStorageError(
      'PAPER_STORAGE_INVALID',
      'Paper state change Evidence is missing, cross-chain, or not decision-time visible.',
    );
  }
}

export async function registerPaperSimulationRoutes(
  app: FastifyInstance,
  context: AppHttpContext,
): Promise<void> {
  app.get('/api/v1/settings/paper-simulation', { schema: { tags: ['system'] } }, async () =>
    loadPaperPortfolioSettings(context.config),
  );

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
      const store = repository(context);
      const current = await store.get(experimentId);
      if (current === undefined) {
        throw new PaperSimulationStorageError(
          'PAPER_STORAGE_NOT_FOUND',
          'Paper experiment not found.',
        );
      }
      await requireEvidence(
        context,
        input.command.evidenceIds,
        current.chain,
        input.command.eventAt,
      );
      const experiment = await store.apply({
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
        deliverySemantics: DELIVERY_SEMANTICS,
        warning: WARNING,
        ...page,
      };
    },
  );

  app.get(
    '/api/v1/paper/experiments/:experimentId/notifications',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const { experimentId } = PaperExperimentParamsSchema.parse(request.params);
      const query = PaperOutboxQuerySchema.parse(request.query);
      const page = await repository(context).listNotifications({
        experimentId,
        limit: query.limit,
        ...(query.after === undefined ? {} : { after: query.after }),
      });
      return {
        mode: 'PAPER' as const,
        deliverySemantics: DELIVERY_SEMANTICS,
        desktopStateMeaning: 'DISPATCHED 表示已交给桌面通知 API，不表示用户已查看。',
        warning: WARNING,
        ...page,
      };
    },
  );

  app.post(
    '/api/v1/paper/experiments/:experimentId/notifications/desktop/claims',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const { experimentId } = PaperExperimentParamsSchema.parse(request.params);
      const input = PaperNotificationClaimSchema.parse(request.body ?? {});
      const records = await repository(context).claimDesktopNotifications({
        experimentId,
        actor: deliveryActor(request),
        limit: input.limit,
      });
      return {
        mode: 'PAPER' as const,
        channel: 'DESKTOP' as const,
        deliverySemantics: DELIVERY_SEMANTICS,
        leaseRequired: true,
        records,
        warning: WARNING,
      };
    },
  );

  app.post(
    '/api/v1/paper/experiments/:experimentId/notifications/:outboxId/desktop/settlement',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const { experimentId, outboxId } = PaperNotificationParamsSchema.parse(request.params);
      const input = PaperNotificationSettlementSchema.parse(request.body);
      const delivery = await repository(context).settleDesktopNotification({
        experimentId,
        outboxId,
        actor: deliveryActor(request),
        leaseToken: input.leaseToken,
        outcome: input.outcome,
        ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      });
      return {
        mode: 'PAPER' as const,
        channel: 'DESKTOP' as const,
        dispatchConfirmation:
          'HANDED_TO_DESKTOP_NOTIFICATION_API_NOT_USER_READ_CONFIRMATION' as const,
        delivery,
        warning: WARNING,
      };
    },
  );

  app.post(
    '/api/v1/paper/experiments/:experimentId/notifications/:outboxId/read',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const { experimentId, outboxId } = PaperNotificationParamsSchema.parse(request.params);
      const delivery = await repository(context).markInAppNotificationRead({
        experimentId,
        outboxId,
        actor: deliveryActor(request),
      });
      return {
        mode: 'PAPER' as const,
        channel: 'IN_APP' as const,
        delivery,
        warning: WARNING,
      };
    },
  );

  app.post(
    '/api/v1/paper/experiments/:experimentId/reviews',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const { experimentId } = PaperExperimentParamsSchema.parse(request.params);
      const input = PaperReviewCreateSchema.parse(request.body);
      const store = repository(context);
      const experiment = await store.get(experimentId);
      if (experiment === undefined) {
        throw new PaperSimulationStorageError(
          'PAPER_STORAGE_NOT_FOUND',
          'Paper experiment not found.',
        );
      }
      const commands = await store.getCommandJournal(experimentId);
      await requireEvidence(
        context,
        input.rejectedCandidates.flatMap((candidate) => candidate.evidenceIds),
        experiment.chain,
        input.asOf,
      );
      let report;
      try {
        report = buildPaperReview({
          experiment,
          commands,
          rejectedCandidates: input.rejectedCandidates as RejectedCandidateReviewInput[],
          asOf: input.asOf,
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('PAPER_REVIEW_')) {
          throw new PaperSimulationStorageError('PAPER_STORAGE_INVALID', error.message, {
            cause: error,
          });
        }
        throw error;
      }
      const stored = await store.saveReview(report);
      return reply.code(201).send({
        mode: 'PAPER' as const,
        historicalState: true,
        warning: WARNING,
        report: stored,
      });
    },
  );

  app.get(
    '/api/v1/paper/reviews/:reviewId',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const { reviewId } = PaperReviewParamsSchema.parse(request.params);
      const report = await repository(context).getReview(reviewId);
      if (report === undefined) {
        throw new PaperSimulationStorageError('PAPER_STORAGE_NOT_FOUND', 'Paper review not found.');
      }
      return { mode: 'PAPER' as const, historicalState: true, warning: WARNING, report };
    },
  );
}
