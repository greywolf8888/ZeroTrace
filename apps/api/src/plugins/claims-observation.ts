import type { FastifyInstance } from 'fastify';
import {
  discoverErc20BurnCandidates,
  discoverEvmPensionCandidates,
  observeEvmClaimBurnBlock,
  replayErc20BurnPromotionResult,
  replayErc20SupplyContinuityResult,
} from '@zerotrace/platform-adapters';
import {
  ClaimReportParamsSchema,
  ClaimReportByIdParamsSchema,
  ClaimReportQuerySchema,
  ClaimBurnParamsSchema,
  ClaimBurnRequestSchema,
  ClaimBurnPromotionParamsSchema,
  ClaimSupplyContinuityParamsSchema,
  ClaimBurnDiscoveryRequestSchema,
  PensionCandidateReportByIdParamsSchema,
  PensionCandidateDiscoveryRequestSchema,
} from '../http/request-schemas.js';
import { errorResponse, addEvidence } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export async function registerClaimObservationRoutes(
  app: FastifyInstance,
  ctx: AppHttpContext,
): Promise<void> {
  const { runtime } = ctx;
  app.get(
    '/api/v1/claims/:ledger/:token/pension-candidates/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const repository = runtime.pensionCandidateReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_UNAVAILABLE',
              'Durable pension candidate report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(params.token.toLowerCase());
      if (record === undefined || record.chainId !== 'eip155:56') {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_NOT_FOUND',
              'No durable BSC pension candidate report exists for this token.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/pension-candidates/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = PensionCandidateReportByIdParamsSchema.parse(request.params);
      const repository = runtime.pensionCandidateReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_UNAVAILABLE',
              'Durable pension candidate report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (
        record === undefined ||
        record.chainId !== 'eip155:56' ||
        record.tokenAddress !== params.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_NOT_FOUND',
              'The durable pension candidate report was not found for this BSC token.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.post(
    '/api/v1/claims/:ledger/:token/pension-candidates',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const input = PensionCandidateDiscoveryRequestSchema.parse(request.body);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A configured BSC provider is required for pension candidate discovery.',
              true,
            ),
          );
      }
      if (runtime.sqdBscLogReader === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'HISTORY_PROVIDER_UNCONFIGURED',
              'Pension candidate discovery requires the finalized BSC SQD dataset.',
              true,
            ),
          );
      }
      if (
        runtime.evidenceRepository === undefined ||
        runtime.pensionCandidateReports === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_STORAGE_REQUIRED',
              'Pension candidate discovery requires durable Evidence and report storage.',
              false,
            ),
          );
      }
      const anchor = await adapter.readAnchorAt(input.toBlock);
      if (anchor.snapshot.ledger !== 'EVM' || anchor.snapshot.finality !== 'finalized') {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FINALIZED_PROVIDER_REQUIRED',
              'Pension candidate discovery requires a finalized range-end Snapshot.',
              true,
            ),
          );
      }
      const run = await discoverEvmPensionCandidates({
        tokenAddress: params.token,
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
        snapshot: anchor.snapshot,
        policy: {
          shareUnitAtomic: input.shareUnitAtomic,
          minimumExactUnitDeposits: input.minimumExactUnitDeposits,
          minimumUniqueExactUnitDepositors: input.minimumUniqueExactUnitDepositors,
          maximumCandidates: input.maximumCandidates,
        },
        logReader: runtime.sqdBscLogReader,
        blockReader: adapter,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.maxBlocksPerRequest === undefined
          ? {}
          : { maxBlocksPerRequest: input.maxBlocksPerRequest }),
        ...(input.maxRequests === undefined ? {} : { maxRequests: input.maxRequests }),
        ...(input.maxTransfers === undefined ? {} : { maxTransfers: input.maxTransfers }),
      });
      const durableReport = await runtime.pensionCandidateReports.put(run.report);
      return { report: run.report, durableReport };
    },
  );

  app.post(
    '/api/v1/claims/:ledger/:token/burn-candidates',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const input = ClaimBurnDiscoveryRequestSchema.parse(request.body);
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
              'A configured EVM provider is required for burn candidate discovery.',
              true,
            ),
          );
      }
      if (numericChainId !== 56 || runtime.sqdBscLogReader === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'HISTORY_PROVIDER_UNCONFIGURED',
              'The current long-range burn candidate path requires the BSC SQD dataset.',
              true,
            ),
          );
      }
      const anchor = await adapter.readAnchorAt(input.toBlock);
      if (anchor.snapshot.ledger !== 'EVM' || anchor.snapshot.finality !== 'finalized') {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FINALIZED_PROVIDER_REQUIRED',
              'Burn candidate discovery requires a finalized range-end Snapshot.',
              true,
            ),
          );
      }
      return discoverErc20BurnCandidates({
        tokenAddress: params.token,
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
        snapshot: anchor.snapshot,
        logReader: runtime.sqdBscLogReader,
        blockReader: adapter,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.maxBlocksPerRequest === undefined
          ? {}
          : { maxBlocksPerRequest: input.maxBlocksPerRequest }),
        ...(input.maxTransfers === undefined ? {} : { maxTransfers: input.maxTransfers }),
        ...(input.maxCandidates === undefined ? {} : { maxCandidates: input.maxCandidates }),
      });
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/burn-promotions/:scanId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnPromotionParamsSchema.parse(request.params);
      const checkpoints = runtime.semanticCheckpoints;
      if (checkpoints === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'BURN_PROMOTION_REPLAY_UNAVAILABLE',
              'Durable burn promotion storage is not configured.',
              false,
            ),
          );
      }
      const run = await checkpoints.get(params.scanId);
      if (
        run === undefined ||
        run.scanType !== 'ERC20_BURN_CANDIDATE_PROMOTION' ||
        run.source !== 'sqd:binance-mainnet' ||
        run.ledger !== 'EVM' ||
        run.chainId !== 'eip155:56' ||
        run.subject !== params.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'BURN_PROMOTION_NOT_FOUND',
              'The requested burn promotion scan was not found.',
              false,
            ),
          );
      }
      const terminalResult = replayErc20BurnPromotionResult(run);
      const totalBlocks = run.toBlock - run.fromBlock + 1;
      const completedBlocks = Math.min(Math.max(run.nextBlock - run.fromBlock, 0), totalBlocks);
      return {
        scan: {
          id: run.id,
          status: run.status,
          token: run.subject,
          requestedRange: {
            fromBlock: String(run.fromBlock),
            toBlock: String(run.toBlock),
            segmentSize: run.chunkSize,
          },
          nextBlock: String(run.nextBlock),
          requestedRangeCoverage: completedBlocks / totalBlocks,
          lastErrorCode: run.lastErrorCode,
          updatedAt: run.updatedAt,
        },
        terminalResult,
      };
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/supply-continuity/:scanId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimSupplyContinuityParamsSchema.parse(request.params);
      const checkpoints = runtime.semanticCheckpoints;
      if (checkpoints === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SUPPLY_CONTINUITY_REPLAY_UNAVAILABLE',
              'Durable supply-continuity storage is not configured.',
              false,
            ),
          );
      }
      const run = await checkpoints.get(params.scanId);
      if (
        run === undefined ||
        run.scanType !== 'ERC20_SUPPLY_CONTINUITY' ||
        run.source !== 'multi-source:bsc-rpc+sqd' ||
        run.ledger !== 'EVM' ||
        run.chainId !== 'eip155:56' ||
        run.subject !== params.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'SUPPLY_CONTINUITY_NOT_FOUND',
              'The requested supply-continuity scan was not found.',
              false,
            ),
          );
      }
      const terminalResult = replayErc20SupplyContinuityResult(run);
      const totalBlocks = run.toBlock - run.fromBlock + 1;
      const completedBlocks = Math.min(Math.max(run.nextBlock - run.fromBlock, 0), totalBlocks);
      return {
        scan: {
          id: run.id,
          status: run.status,
          token: run.subject,
          requestedRange: {
            fromBlock: String(run.fromBlock),
            toBlock: String(run.toBlock),
            segmentSize: run.chunkSize,
          },
          nextBlock: String(run.nextBlock),
          requestedRangeCoverage: completedBlocks / totalBlocks,
          lastErrorCode: run.lastErrorCode,
          updatedAt: run.updatedAt,
        },
        terminalResult,
      };
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
}
