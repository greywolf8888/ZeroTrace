import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditDiscrepancies, DISCREPANCY_MODEL_VERSION } from '@zerotrace/data-quality';
import { hashPayload } from '@zerotrace/evidence';
import { FLAP_BSC_MAINNET_DEPLOYMENT, quoteFlapPancakeV2BuyScenarios, quoteFlapPancakeV2SellScenarios, quoteFlapPensionEntryScenarios, reconcileFlapPancakeV2Market, quoteFlapSell } from '@zerotrace/platform-adapters';
import { unavailableValue, unknownValue, type Evidence } from '@zerotrace/schemas';
import { FlapSellQuoteRequestSchema, FlapPancakeV2BuyScenarioRequestSchema, FlapPancakeV2SellScenarioRequestSchema, FlapPancakeV2PensionEntryRequestSchema, FlapPensionEntryReportQuerySchema, FlapPensionEntryReportParamsSchema, FlapPancakeV2ReconciliationRequestSchema, DiscrepancyAuditRequestSchema } from '../http/request-schemas.js';
import { errorResponse, emptyMetadata, addEvidence, rejectUngroundedAnalysis, addDerivedAnalysisEvidence, missingEvidenceIds, incompatibleEvidenceIds, uniqueEvidenceIds } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export async function registerRvAndFlapMarketRoutes(app: FastifyInstance, ctx: AppHttpContext): Promise<void> {
  const {
    runtime,
    config,
    providerHealth,
    storageHealth,
    ingestionStorageHealth,
    dataQualityHealth,
    graphProjectionHealth,
  } = ctx;
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
    '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPancakeV2PensionEntryRequestSchema.parse(request.body);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A BNB Smart Chain read-only provider is required for pension-entry economics.',
              true,
            ),
          );
      }
      if (
        runtime.evidenceRepository === undefined ||
        runtime.pensionCandidateReports === undefined ||
        runtime.pensionEntryReports === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_STORAGE_REQUIRED',
              'Pension-entry economics require durable Evidence, pension-candidate and Scenario Report storage.',
              false,
            ),
          );
      }
      const token = input.token.toLowerCase();
      const record =
        input.pensionReportId === undefined
          ? await runtime.pensionCandidateReports.latest(token)
          : await runtime.pensionCandidateReports.get(input.pensionReportId);
      if (
        record === undefined ||
        record.chainId !== input.chainId ||
        record.tokenAddress !== token
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_NOT_FOUND',
              'No matching durable BSC pension candidate report was found.',
              false,
            ),
          );
      }
      const selectedCandidate =
        input.pensionWallet === undefined
          ? record.report.candidates.length === 1
            ? record.report.candidates[0]
            : undefined
          : record.report.candidates.find(
              (candidate) => candidate.address === input.pensionWallet?.toLowerCase(),
            );
      if (selectedCandidate === undefined) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_SELECTION_REQUIRED',
              'Select one wallet contained in the referenced report; omission is allowed only when the report has exactly one candidate.',
              false,
            ),
          );
      }
      const evidenceNodes = await Promise.all(
        record.evidenceIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
      );
      if (evidenceNodes.some((node) => node === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_EVIDENCE_INCOMPLETE',
              'The pension candidate report references unavailable durable Evidence.',
              false,
            ),
          );
      }
      const result = await quoteFlapPensionEntryScenarios({
        adapter,
        token,
        quoteInputs: input.quoteInputs,
        pensionWallet: selectedCandidate.address,
        behaviorReportId: record.id,
        behaviorResultHash: record.resultHash,
        behaviorReport: record.report,
        behaviorEvidence: evidenceNodes.map((node) => node?.evidence as Evidence),
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
      });
      const stored = await runtime.pensionEntryReports.put(result);
      return {
        ...result,
        durableReport: {
          id: stored.id,
          resultHash: stored.resultHash,
          createdAt: stored.createdAt,
        },
      };
    },
  );

  app.get(
    '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPensionEntryReportQuerySchema.parse(request.query);
      const repository = runtime.pensionEntryReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
              'Durable Flap pension entry Scenario Report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(input.token.toLowerCase());
      if (
        record === undefined ||
        record.chainId !== input.chainId ||
        record.tokenAddress !== input.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_PENSION_ENTRY_REPORT_NOT_FOUND',
              'No durable Flap pension entry Scenario Report exists for this token.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/:reportId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPensionEntryReportQuerySchema.parse(request.query);
      const params = FlapPensionEntryReportParamsSchema.parse(request.params);
      const repository = runtime.pensionEntryReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
              'Durable Flap pension entry Scenario Report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (
        record === undefined ||
        record.chainId !== input.chainId ||
        record.tokenAddress !== input.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_PENSION_ENTRY_REPORT_NOT_FOUND',
              'The durable Flap pension entry Scenario Report was not found for this BSC token.',
              false,
            ),
          );
      }
      return { replayed: true, record };
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
    '/api/v1/rv/flap-pancake-v2-reconciliation',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPancakeV2ReconciliationRequestSchema.parse(request.body);
      const sourceAdapters = runtime.evmSourceAdapters?.get(56) ?? [];
      if (sourceAdapters.length < config.dataQualityMinSources) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'MULTIPLE_BSC_ENDPOINTS_REQUIRED',
              `At least ${config.dataQualityMinSources} separately configured BSC endpoints are required.`,
              true,
            ),
          );
      }
      const anchorReconciliation = await runtime.dataQuality.inspect('EVM', 'eip155:56');
      if (anchorReconciliation.status !== 'AGREEMENT') {
        const unavailable = ['UNAVAILABLE', 'INSUFFICIENT_SOURCES'].includes(
          anchorReconciliation.status,
        );
        return reply.code(unavailable ? 503 : 409).send({
          ...errorResponse(
            request,
            `ANCHOR_${anchorReconciliation.status}`,
            'BSC endpoints did not establish one common finalized block identity.',
            unavailable,
          ),
          anchorReconciliation,
        });
      }
      return reconcileFlapPancakeV2Market({
        sourceAdapters,
        anchorReconciliation,
        token: input.token,
        quoteInputs: input.quoteInputs,
        tokenInputs: input.tokenInputs,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
      });
    },
  );

  app.post(
    '/api/v1/data-quality/discrepancies',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = DiscrepancyAuditRequestSchema.parse(request.body);
      if (input.checks.length === 0) return auditDiscrepancies(input.checks, input.metadata);
      const snapshot = input.metadata.snapshot;
      if (snapshot === null) {
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
      const incompatibleIds = await incompatibleEvidenceIds(runtime, sourceEvidenceIds, snapshot);
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
        snapshot,
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

}
