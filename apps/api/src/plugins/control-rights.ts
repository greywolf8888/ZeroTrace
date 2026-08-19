import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  inspectEvmControlSurface,
  inspectSolanaControlSurface,
} from '@zerotrace/platform-adapters';
import type { Evidence, Ledger } from '@zerotrace/schemas';
import {
  ControlSurfaceParamsSchema,
  ControlSurfaceByIdParamsSchema,
  ControlSurfaceQuerySchema,
  ControlSurfaceInspectSchema,
  ControlSurfaceListQuerySchema,
} from '../http/request-schemas.js';
import { errorResponse, addEvidence } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export async function registerControlRightsRoutes(
  app: FastifyInstance,
  ctx: AppHttpContext,
): Promise<void> {
  const {
    runtime,
    config,
    providerHealth,
    storageHealth,
    ingestionStorageHealth,
    dataQualityHealth,
    graphProjectionHealth,
  } = ctx;
  app.post(
    '/api/v1/control-rights/:ledger/:subject/inspect',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ControlSurfaceParamsSchema.parse(request.params);
      const input = ControlSurfaceInspectSchema.parse(request.body);
      if (
        (params.ledger === 'EVM' && !input.chainId.startsWith('eip155:')) ||
        (params.ledger === 'SOLANA' && input.chainId !== 'solana-mainnet')
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_CHAIN_ID',
              'Control surface ledger and chain ID do not match.',
              false,
            ),
          );
      }
      if (runtime.evidenceRepository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              'Durable Evidence storage is required for control inspection.',
              false,
            ),
          );
      }
      if (params.ledger === 'SOLANA') {
        if (input.blockNumber !== undefined) {
          return reply
            .code(400)
            .send(
              errorResponse(
                request,
                'HISTORICAL_STATE_UNSUPPORTED',
                'Solana JSON-RPC does not provide arbitrary historical account state; inspect the finalized live account set instead.',
                false,
              ),
            );
        }
        if (runtime.solanaControlSurfaces === undefined) {
          return reply
            .code(503)
            .send(
              errorResponse(
                request,
                'CONTROL_SURFACE_UNAVAILABLE',
                'Durable Solana control surface storage is required.',
                false,
              ),
            );
        }
        if (runtime.solanaAdapter === undefined) {
          return reply
            .code(503)
            .send(
              errorResponse(
                request,
                'PROVIDER_UNCONFIGURED',
                'A configured finalized Solana provider is required for control inspection.',
                true,
              ),
            );
        }
        const report = await inspectSolanaControlSurface({
          subject: params.subject,
          adapter: runtime.solanaAdapter,
          writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
            addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        });
        const record = await runtime.solanaControlSurfaces.put(report);
        return { record };
      }
      const repository = runtime.controlSurfaces;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              'Durable EVM control surface storage is required.',
              false,
            ),
          );
      }
      const numericChainId = Number(input.chainId.slice('eip155:'.length));
      if (!Number.isSafeInteger(numericChainId)) {
        return reply
          .code(400)
          .send(errorResponse(request, 'INVALID_CHAIN_ID', 'Invalid EIP-155 chain ID.', false));
      }
      const primary = runtime.evmAdapters.get(numericChainId);
      if (primary === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A configured finalized EVM provider is required for control inspection.',
              true,
            ),
          );
      }
      const adapters = runtime.evmSourceAdapters?.get(numericChainId) ?? [primary];
      const report = await inspectEvmControlSurface({
        subject: params.subject,
        adapters,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(runtime.evmSourceVerification === undefined
          ? {}
          : { sourceVerificationAdapter: runtime.evmSourceVerification }),
        ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
      });
      const record = await repository.put(report);
      return { record };
    },
  );

  app.get(
    '/api/v1/control-rights/:ledger/:subject/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ControlSurfaceParamsSchema.parse(request.params);
      const query = ControlSurfaceQuerySchema.parse(request.query);
      if (
        (params.ledger === 'EVM' && !query.chainId.startsWith('eip155:')) ||
        (params.ledger === 'SOLANA' && query.chainId !== 'solana-mainnet')
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(request, 'INVALID_CHAIN_ID', 'Ledger and chain ID do not match.', false),
          );
      }
      const repository =
        params.ledger === 'EVM' ? runtime.controlSurfaces : runtime.solanaControlSurfaces;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              `Durable ${params.ledger} control surface storage is not configured.`,
              false,
            ),
          );
      }
      const record =
        params.ledger === 'EVM'
          ? await runtime.controlSurfaces?.latest(query.chainId, params.subject.toLowerCase())
          : await runtime.solanaControlSurfaces?.latest(params.subject);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_NOT_FOUND',
              `No durable ${params.ledger} control surface report was found for this subject.`,
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/control-rights/:ledger/:subject/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ControlSurfaceByIdParamsSchema.parse(request.params);
      const query = ControlSurfaceQuerySchema.parse(request.query);
      if (
        (params.ledger === 'EVM' && !query.chainId.startsWith('eip155:')) ||
        (params.ledger === 'SOLANA' && query.chainId !== 'solana-mainnet')
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(request, 'INVALID_CHAIN_ID', 'Ledger and chain ID do not match.', false),
          );
      }
      const repository =
        params.ledger === 'EVM' ? runtime.controlSurfaces : runtime.solanaControlSurfaces;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              `Durable ${params.ledger} control surface storage is not configured.`,
              false,
            ),
          );
      }
      const record =
        params.ledger === 'EVM'
          ? await runtime.controlSurfaces?.get(params.reportId)
          : await runtime.solanaControlSurfaces?.get(params.reportId);
      if (
        record === undefined ||
        record.chainId !== query.chainId ||
        record.subject !== (params.ledger === 'EVM' ? params.subject.toLowerCase() : params.subject)
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_NOT_FOUND',
              `The requested durable ${params.ledger} control surface report was not found.`,
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/control-rights',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ControlSurfaceListQuerySchema.parse(request.query);
      const repository =
        query.ledger === 'EVM' ? runtime.controlSurfaces : runtime.solanaControlSurfaces;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              `Durable ${query.ledger} control surface storage is not configured.`,
              false,
            ),
          );
      }
      const record =
        query.ledger === 'EVM'
          ? await runtime.controlSurfaces?.latest(query.chainId, query.subject.toLowerCase())
          : await runtime.solanaControlSurfaces?.latest(query.subject);
      return { records: record === undefined ? [] : [record] };
    },
  );
}
