import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ProviderError } from '@zerotrace/chain-adapters';
import { parseEvmClaimDeclaration, reviewClaimDeclarationDraft } from '@zerotrace/claim-audit';
import { observeErc20Decimals } from '@zerotrace/platform-adapters';
import { quoteConstantProductExit, simulateExitRace } from '@zerotrace/rv';
import { ClaimRuleReviewReportStorageError } from '@zerotrace/storage';
import { knownValue, unknownValue, type Evidence } from '@zerotrace/schemas';
import { ClaimDeclarationReportParamsSchema, ClaimDeclarationReportLookupQuerySchema, ClaimRuleReviewReportParamsSchema, ClaimRuleReviewReportLookupQuerySchema, ClaimVerificationReportParamsSchema, ClaimVerificationReportLookupQuerySchema, ClaimBurnParamsSchema, ClaimDeclarationParseRequestSchema, ClaimRuleReviewRequestSchema, Erc20DecimalsObservationRequestSchema, RvRequestSchema, ExitRaceRequestSchema } from '../http/request-schemas.js';
import { errorResponse, addEvidence, rejectUngroundedAnalysis, addDerivedAnalysisEvidence, missingEvidenceIds, incompatibleEvidenceIds, uniqueEvidenceIds, getEvidenceNode } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export async function registerScenarioAndClaimDeclarationRoutes(app: FastifyInstance, ctx: AppHttpContext): Promise<void> {
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
      const terminalEvidence = await addEvidence(runtime, result.terminalEvidence, [evidence.id]);
      const report = { ...result, evidence, terminalEvidence };
      const stored = await runtime.claimDeclarationReports?.put(report);
      return {
        ...report,
        durableReport:
          stored === undefined
            ? unknownValue(
                'STORAGE_UNCONFIGURED',
                'The declaration report and Evidence are available only for this process because durable PostgreSQL storage is not configured.',
              )
            : knownValue({
                id: stored.id,
                resultHash: stored.resultHash,
                createdAt: stored.createdAt,
              }),
      };
    },
  );

  app.get(
    '/api/v1/claims/declarations/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ClaimDeclarationReportLookupQuerySchema.parse(request.query);
      const repository = runtime.claimDeclarationReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_UNAVAILABLE',
              'Durable Claim declaration report storage is not configured.',
              false,
            ),
          );
      }
      const record =
        query.documentHash === undefined
          ? await repository.latestByAsset(query.assetId)
          : await repository.latestByDocument(query.documentHash, query.assetId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_NOT_FOUND',
              'No durable Claim declaration report exists for this asset and source document.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/claims/declarations/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimDeclarationReportParamsSchema.parse(request.params);
      const repository = runtime.claimDeclarationReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_UNAVAILABLE',
              'Durable Claim declaration report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_NOT_FOUND',
              'The durable Claim declaration report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.post(
    '/api/v1/claims/rules/review',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const input = ClaimRuleReviewRequestSchema.parse(request.body);
      const declarationRepository = runtime.claimDeclarationReports;
      const reviewRepository = runtime.claimRuleReviewReports;
      if (declarationRepository === undefined || reviewRepository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_UNAVAILABLE',
              'Durable Claim declaration and rule-review storage must both be configured.',
              false,
            ),
          );
      }
      const declarationRecord = await declarationRepository.get(input.declarationReportId);
      if (declarationRecord === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_NOT_FOUND',
              'The source Claim declaration report was not found.',
              false,
            ),
          );
      }
      const tokenDecimalsNode =
        input.tokenDecimalsEvidenceId === undefined
          ? undefined
          : await getEvidenceNode(runtime, input.tokenDecimalsEvidenceId);
      if (input.tokenDecimalsEvidenceId !== undefined && tokenDecimalsNode === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_EVIDENCE_NOT_FOUND',
              'The token-decimals Evidence was not found.',
              false,
            ),
          );
      }
      if (
        tokenDecimalsNode !== undefined &&
        (tokenDecimalsNode.snapshot?.ledger !== 'EVM' ||
          tokenDecimalsNode.snapshot.chainId !== declarationRecord.chainId ||
          tokenDecimalsNode.snapshot.finality !== 'finalized' ||
          tokenDecimalsNode.evidence.blockOrSlot !== tokenDecimalsNode.snapshot.blockNumber ||
          tokenDecimalsNode.evidence.observedAt !== tokenDecimalsNode.snapshot.capturedAt)
      ) {
        return reply
          .code(409)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_EVIDENCE_CONFLICT',
              'Token-decimals Evidence must be bound to a matching finalized EVM Snapshot.',
              false,
            ),
          );
      }
      const result = reviewClaimDeclarationDraft({
        declarationReport: declarationRecord.report,
        draftId: input.draftId,
        reviewerLabel: input.reviewerLabel,
        reviewedAt: new Date().toISOString(),
        rule: input.rule,
        ...(input.tokenDecimals === undefined
          ? {}
          : { tokenDecimals: knownValue(input.tokenDecimals) }),
        ...(tokenDecimalsNode === undefined
          ? {}
          : { tokenDecimalsEvidence: tokenDecimalsNode.evidence }),
      });
      const reviewEvidence = result.evidence.find((item) => item.id === result.reviewEvidenceId);
      const terminalEvidence = result.evidence.find(
        (item) => item.id === result.terminalEvidenceId,
      );
      if (reviewEvidence === undefined || terminalEvidence === undefined) {
        throw new ClaimRuleReviewReportStorageError(
          'CLAIM_RULE_REVIEW_REPORT_INVALID',
          'Claim rule review Evidence closure is incomplete.',
        );
      }
      const storedReviewEvidence = await addEvidence(runtime, reviewEvidence);
      const terminalSourceIds = [
        declarationRecord.terminalEvidenceId,
        storedReviewEvidence.id,
        ...(tokenDecimalsNode === undefined ? [] : [tokenDecimalsNode.evidence.id]),
      ].sort();
      const storedTerminalEvidence = await addEvidence(
        runtime,
        terminalEvidence,
        terminalSourceIds,
      );
      const report = {
        ...result,
        evidence: result.evidence
          .map((item) =>
            item.id === storedReviewEvidence.id
              ? storedReviewEvidence
              : item.id === storedTerminalEvidence.id
                ? storedTerminalEvidence
                : item,
          )
          .sort((left, right) => left.id.localeCompare(right.id)),
      };
      const stored = await reviewRepository.put(report);
      return {
        ...report,
        durableReport: knownValue({
          id: stored.id,
          resultHash: stored.resultHash,
          createdAt: stored.createdAt,
        }),
      };
    },
  );

  app.post(
    '/api/v1/claims/:ledger/:token/metadata/decimals',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const input = Erc20DecimalsObservationRequestSchema.parse(request.body);
      const numericChainId = Number(input.chainId.slice('eip155:'.length));
      const adapter = Number.isSafeInteger(numericChainId)
        ? runtime.evmAdapters.get(numericChainId)
        : undefined;
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A configured EVM provider is required for token metadata observation.',
              true,
            ),
          );
      }
      const observation = await observeErc20Decimals(adapter, params.token);
      if (observation.assetId !== `${input.chainId}:erc20:${params.token.toLowerCase()}`) {
        throw new ProviderError('INVALID_RESPONSE', 'Token metadata Snapshot chain mismatched.');
      }
      const evidence = await addEvidence(runtime, observation.evidence, [], observation.snapshot);
      return {
        assetId: observation.assetId,
        decimals: knownValue(observation.decimals),
        snapshot: observation.snapshot,
        evidence,
        coverage: {
          metadataField: 1,
          sourceIndependence: unknownValue(
            'NOT_QUERIED',
            'One provider observation does not establish independent-source agreement.',
          ),
        },
        freshness: observation.snapshot.capturedAt,
        sourceSet: [evidence.source],
        modelVersion: 'erc20-metadata-observation-v1.0.0',
        confidence: unknownValue(
          'NOT_QUERIED',
          'Provider-independent confidence was not computed for this exact contract value.',
        ),
      };
    },
  );

  app.get(
    '/api/v1/claims/rules/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ClaimRuleReviewReportLookupQuerySchema.parse(request.query);
      const repository = runtime.claimRuleReviewReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_UNAVAILABLE',
              'Durable Claim rule review report storage is not configured.',
              false,
            ),
          );
      }
      const record =
        query.declarationReportId === undefined || query.draftId === undefined
          ? await repository.latestByAsset(query.assetId)
          : await repository.latestByDraft(query.declarationReportId, query.draftId);
      if (record === undefined || record.assetId !== query.assetId) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_NOT_FOUND',
              'No durable Claim rule review report exists for this asset and draft.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/claims/rules/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimRuleReviewReportParamsSchema.parse(request.params);
      const repository = runtime.claimRuleReviewReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_UNAVAILABLE',
              'Durable Claim rule review report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_NOT_FOUND',
              'The durable Claim rule review report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/claims/verification/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ClaimVerificationReportLookupQuerySchema.parse(request.query);
      const repository = runtime.claimVerificationReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_VERIFICATION_REPORT_UNAVAILABLE',
              'Durable Claim verification report storage is not configured.',
              false,
            ),
          );
      }
      const record =
        query.ruleId === undefined
          ? await repository.latestByAsset(query.assetId as string)
          : await repository.latestByRule(query.ruleId);
      if (
        record === undefined ||
        (query.assetId !== undefined && record.assetId !== query.assetId)
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_VERIFICATION_REPORT_NOT_FOUND',
              'No durable Claim verification report exists for this reviewed rule.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/claims/verification/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimVerificationReportParamsSchema.parse(request.params);
      const repository = runtime.claimVerificationReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_VERIFICATION_REPORT_UNAVAILABLE',
              'Durable Claim verification report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_VERIFICATION_REPORT_NOT_FOUND',
              'The durable Claim verification report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

}
