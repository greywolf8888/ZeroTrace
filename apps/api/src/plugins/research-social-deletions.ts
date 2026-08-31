import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createEvidence } from '@zerotrace/evidence';
import { tombstoneExternalContent } from '@zerotrace/provider-plane';

import type { AppHttpContext } from '../http/context.js';

const SocialObservationTombstoneSchema = z
  .object({
    sourceId: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/),
    postId: z.string().regex(/^[1-9][0-9]{0,24}$/),
    deletedAt: z.iso.datetime({ offset: true }),
    reason: z.enum(['UPSTREAM_DELETED', 'RIGHTS_REVOKED', 'RETENTION_EXPIRED', 'ANALYST_REQUEST']),
    verification: z
      .object({
        method: z.enum([
          'PROVIDER_POLL',
          'PROVIDER_WEBHOOK',
          'RIGHTS_REVOCATION',
          'RETENTION_POLICY',
          'ANALYST_REQUEST',
        ]),
        locator: z.string().trim().min(1).max(512),
        sourceUri: z.string().url().max(2_048).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    const expected = {
      UPSTREAM_DELETED: ['PROVIDER_POLL', 'PROVIDER_WEBHOOK'],
      RIGHTS_REVOKED: ['RIGHTS_REVOCATION'],
      RETENTION_EXPIRED: ['RETENTION_POLICY'],
      ANALYST_REQUEST: ['ANALYST_REQUEST'],
    }[input.reason];
    if (!expected.includes(input.verification.method)) {
      context.addIssue({
        code: 'custom',
        path: ['verification', 'method'],
        message: '删除原因与核验方式不匹配。',
      });
    }
  });

export async function registerSocialDeletionRoutes(
  app: FastifyInstance,
  context: AppHttpContext,
): Promise<void> {
  app.post(
    '/api/v1/research/social-observation-tombstones',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = SocialObservationTombstoneSchema.parse(request.body);
      const observations = context.runtime.socialObservations;
      const evidenceRepository = context.runtime.evidenceRepository;
      if (observations === undefined || evidenceRepository === undefined) {
        return reply.code(503).send({
          error: {
            code: 'SOCIAL_OBSERVATION_DURABILITY_UNAVAILABLE',
            message: '删除传播要求 PostgreSQL 观察与 Evidence 仓库同时可用。',
            retryable: false,
          },
        });
      }
      let current;
      try {
        current = await observations.getObservation(input.sourceId, input.postId);
      } catch (error) {
        const notFound =
          error instanceof Error &&
          'code' in error &&
          (error as { code: unknown }).code === 'SOCIAL_OBSERVATION_NOT_FOUND';
        return reply.code(notFound ? 404 : 503).send({
          error: {
            code: notFound
              ? 'SOCIAL_OBSERVATION_NOT_FOUND'
              : 'SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE',
            message: notFound ? '未找到要删除传播的社交观察。' : '持久社交观察仓库不可用。',
            retryable: !notFound,
          },
        });
      }
      if (current.record.state === 'TOMBSTONED') {
        if (
          current.record.reason !== input.reason ||
          current.record.deletedAt !== new Date(input.deletedAt).toISOString()
        ) {
          return reply.code(409).send({
            error: {
              code: 'SOCIAL_OBSERVATION_TOMBSTONE_CONFLICT',
              message: '该观察已经存在不同的删除墓碑。',
              retryable: false,
            },
          });
        }
        return {
          replayed: true,
          networkRequestPerformed: false,
          tombstone: current.record,
          evidenceId: current.evidenceId,
        };
      }
      if (
        input.reason === 'RETENTION_EXPIRED' &&
        (current.record.retainUntil === null ||
          Date.parse(input.deletedAt) < Date.parse(current.record.retainUntil))
      ) {
        return reply.code(409).send({
          error: {
            code: 'SOCIAL_OBSERVATION_RETENTION_NOT_EXPIRED',
            message: '当前观察尚未到达经核验的正文保留期限。',
            retryable: false,
          },
        });
      }
      const deletionEvidence = createEvidence({
        ledger: current.ledger,
        chainId: current.chainId,
        kind:
          input.verification.method === 'ANALYST_REQUEST'
            ? 'ANALYST_OBSERVATION'
            : 'PROVIDER_OBSERVATION',
        source: input.sourceId,
        locator: input.verification.locator,
        ...(input.verification.sourceUri === undefined
          ? {}
          : { sourceUri: input.verification.sourceUri }),
        payload: {
          schema: 'zerotrace-social-deletion-verification-v1',
          sourceId: input.sourceId,
          postId: input.postId,
          deletedAt: input.deletedAt,
          reason: input.reason,
          method: input.verification.method,
        },
        observedAt: input.deletedAt,
        summary: '社交内容删除、撤权、保留期到期或分析员删除请求的只读核验记录。',
      });
      const storedEvidence = await evidenceRepository.put(deletionEvidence);
      const tombstone = tombstoneExternalContent(current.record, {
        deletedAt: input.deletedAt,
        reason: input.reason,
        evidenceIds: [storedEvidence.evidence.id],
      });
      try {
        await observations.tombstone({
          ledger: current.ledger,
          chainId: current.chainId,
          tombstone,
          evidenceId: storedEvidence.evidence.id,
        });
      } catch (error) {
        const conflict =
          error instanceof Error &&
          'code' in error &&
          (error as { code: unknown }).code === 'SOCIAL_OBSERVATION_CONFLICT';
        return reply.code(conflict ? 409 : 503).send({
          error: {
            code: conflict
              ? 'SOCIAL_OBSERVATION_TOMBSTONE_CONFLICT'
              : 'SOCIAL_OBSERVATION_STORAGE_UNAVAILABLE',
            message: conflict
              ? '删除传播与当前观察版本冲突，未覆盖现有内容。'
              : '删除 Evidence 已记录，但持久墓碑传播失败。',
            retryable: !conflict,
            evidenceId: storedEvidence.evidence.id,
          },
        });
      }
      return reply.code(202).send({
        replayed: false,
        networkRequestPerformed: false,
        tombstone,
        evidenceId: storedEvidence.evidence.id,
      });
    },
  );
}
