import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { classifyIdentifier } from '@zerotrace/identifiers';
import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  FLAP_EVENT_MODEL_VERSION,
  FLAP_HISTORY_DEFAULT_CHUNK_SIZE,
  FLAP_HISTORY_MODEL_VERSION,
  FLAP_LIFETIME_MATERIALIZATION_SOURCE,
  FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MODEL_VERSION,
  discoverFlapEventHistory,
  inspectFlapEventTransaction,
  inspectFlapTokenOrigin,
  inspectFlapTokenOriginRestartSafe,
  inspectFlapToken,
  type InspectFlapTokenOriginOptions,
} from '@zerotrace/platform-adapters';
import { FlapHistoryProjectionError, SemanticCheckpointError } from '@zerotrace/storage';
import {
  FlapEventHistoryProjectionSchema,
  FlapLifetimeMaterializationSchema,
  unavailableValue,
  type Evidence,
} from '@zerotrace/schemas';
import {
  LaunchInspectionParamsSchema,
  LaunchInspectionQuerySchema,
  FlapEventTransactionParamsSchema,
  FlapEventTransactionQuerySchema,
  FlapEventHistoryQuerySchema,
  FlapHistoryProjectionParamsSchema,
  FlapHistoryProjectionPageQuerySchema,
  FlapTokenOriginQuerySchema,
} from '../http/request-schemas.js';
import { errorResponse, emptyMetadata, addEvidence, getEvidenceNode } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export async function registerEvidenceAndLaunchRoutes(
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
}
