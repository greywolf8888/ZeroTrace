import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Registry } from 'prom-client';
import { createEvidence } from '@zerotrace/evidence';
import { classifyIdentifier } from '@zerotrace/identifiers';
import { buildLabelIntelligenceCore, LABEL_INTELLIGENCE_MODEL_VERSION } from '@zerotrace/label-engine';
import { IntelligenceSearchStorageError } from '@zerotrace/storage';
import { LabelIntelligenceReportSchema, LabelIntelligenceRequestSchema, knownValue, unavailableValue, unknownValue, type AnalysisMetadata, type Evidence, type Ledger } from '@zerotrace/schemas';
import { queryBitcoinAddress } from '../ledger-query.js';
import { SearchQuerySchema, LabelIntelligenceIdentityQuerySchema, LabelIntelligenceReportParamsSchema } from '../http/request-schemas.js';
import { errorResponse, emptyMetadata, addEvidence, rejectUngroundedAnalysis, incompatibleEvidenceIds, uniqueEvidenceIds, uniqueSourceIds, evidenceSourceId, snapshotSourceIds, parseHexQuantity } from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export async function registerSearchAndLabelRoutes(app: FastifyInstance, ctx: AppHttpContext): Promise<void> {
  const {
    runtime,
    config,
    providerHealth,
    storageHealth,
    ingestionStorageHealth,
    dataQualityHealth,
    graphProjectionHealth,
  } = ctx;
  app.get('/api/v1/search', { schema: { tags: ['intelligence'] } }, async (request) => {
    const query = SearchQuerySchema.parse(request.query);
    const result = classifyIdentifier(query.q, {
      ...(query.ledger === undefined ? {} : { ledger: query.ledger }),
      ...(query.chainId === undefined ? {} : { chainId: query.chainId }),
    });
    let durableResults;
    if (runtime.intelligenceSearch === undefined) {
      durableResults = unavailableValue(
        'STORAGE_UNCONFIGURED',
        'POSTGRES_URL is absent; only deterministic local identifier classification was executed.',
      );
    } else {
      try {
        durableResults = knownValue(
          await runtime.intelligenceSearch.search({
            query: query.q,
            ...(query.ledger === undefined ? {} : { ledger: query.ledger }),
            ...(query.chainId === undefined ? {} : { chainId: query.chainId }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          }),
        );
      } catch (error) {
        if (!(error instanceof IntelligenceSearchStorageError)) throw error;
        durableResults = unavailableValue(
          'STORAGE_DOWN',
          `${error.code}: ${error.message} Local identifier classification remains available.`,
        );
      }
    }
    const durableMatches = durableResults.state === 'known' ? durableResults.value.matches : [];
    const matchConfidences = durableMatches.flatMap((match) =>
      match.analysisConfidence.state === 'known' ? [match.analysisConfidence.value] : [],
    );
    const resultConfidences = [
      ...result.candidates.map((candidate) => candidate.confidence),
      ...matchConfidences,
    ];
    const resultConfidence =
      resultConfidences.length === 0
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'No classified identifier or confidence-bearing durable match was found in the declared scope.',
          )
        : knownValue(Math.max(...resultConfidences));
    const terminalEvidenceIds =
      durableResults.state === 'known' ? durableResults.value.terminalEvidenceIds : [];
    const sourceSet = [
      'local-checksum-and-structure',
      ...(durableResults.state === 'known' ? ['postgres-durable-intelligence-search-v1'] : []),
    ].sort();
    const executionCoverage = durableResults.state === 'known' ? 1 : 0.5;
    return {
      ...result,
      durableResults,
      resultConfidence,
      coverage: {
        scope: 'IDENTIFIER_CLASSIFICATION_AND_DURABLE_EXACT_PROJECTION_V1',
        identifierClassification: knownValue(true),
        durableProjection:
          durableResults.state === 'known'
            ? knownValue(true)
            : unavailableValue(durableResults.reason, durableResults.detail),
        gaps: {
          tokenSymbolTickerLookup: unknownValue(
            'NOT_IMPLEMENTED',
            'A verified token-symbol registry is not indexed yet.',
          ),
          platformProjectLexicalLookup: unknownValue(
            'NOT_IMPLEMENTED',
            'Platform and project names are not yet resolved by this exact-match projection.',
          ),
          completeSubjectRegistry: unknownValue(
            'NOT_IMPLEMENTED',
            'Not every report subject has a durable Subject Registry binding yet.',
          ),
          semanticCheckpointIndex: unknownValue(
            'NOT_IMPLEMENTED',
            'Semantic checkpoint payloads are not included in this projection version.',
          ),
        },
      },
      absenceSemantics: 'NO_DURABLE_MATCH_IS_NOT_ONCHAIN_NONEXISTENCE' as const,
      metadata: {
        ...emptyMetadata(
          'global-intelligence-search-v0.1.0',
          resultConfidence.state === 'known' ? resultConfidence.value : executionCoverage,
        ),
        dataCoverage: executionCoverage,
        sourceCoverage: executionCoverage,
        freshness: new Date().toISOString(),
        sourceSet,
        evidenceIds: terminalEvidenceIds,
      },
    };
  });

  app.post('/api/v1/labels/reports', { schema: { tags: ['analysis'] } }, async (request, reply) => {
    const input = LabelIntelligenceRequestSchema.parse(request.body);
    if (
      runtime.evidenceRepository === undefined ||
      runtime.labelIntelligenceReports === undefined
    ) {
      return reply
        .code(503)
        .send(
          errorResponse(
            request,
            'DURABLE_STORAGE_REQUIRED',
            'Label Intelligence requires durable Subject, Label observation, Evidence and report storage.',
            false,
          ),
        );
    }
    const observationSet = await runtime.labelIntelligenceReports.loadObservationSet(input);
    if (observationSet === undefined) {
      return reply
        .code(404)
        .send(
          errorResponse(
            request,
            'LABEL_SUBJECT_NOT_FOUND',
            'No exact ledger-scoped Subject Registry binding exists for this identifier.',
            false,
          ),
        );
    }
    if (observationSet.observations.length === 0) {
      return reply
        .code(422)
        .send(
          errorResponse(
            request,
            'LABEL_OBSERVATIONS_REQUIRED',
            'The Subject Registry row exists, but it has no durable Label observations to materialize.',
            false,
          ),
        );
    }
    const canonicalRequest = LabelIntelligenceRequestSchema.parse({
      ...input,
      normalizedIdentifier: observationSet.subject.normalizedIdentifier,
      asOf: new Date(input.asOf).toISOString(),
    });
    const result = buildLabelIntelligenceCore({
      subject: observationSet.subject,
      observations: observationSet.observations,
      request: canonicalRequest,
    });
    const sourceEvidenceIds = result.metadata.evidenceIds;
    const sourceNodes = await Promise.all(
      sourceEvidenceIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
    );
    if (sourceNodes.some((node) => node === undefined)) {
      return reply
        .code(503)
        .send(
          errorResponse(
            request,
            'DURABLE_EVIDENCE_INCOMPLETE',
            'A registered Label observation references unavailable durable Evidence.',
            true,
          ),
        );
    }
    const sourceEvidence = sourceNodes.map((node) => node?.evidence as Evidence);
    const incompatibleEvidenceIds = sourceEvidence
      .filter(
        (evidence) =>
          evidence.ledger !== result.subject.ledger || evidence.chainId !== result.subject.chainId,
      )
      .map((evidence) => evidence.id);
    if (incompatibleEvidenceIds.length > 0) {
      return rejectUngroundedAnalysis(
        request,
        reply,
        'Label observation Evidence is not scoped to the requested ledger and chain.',
        incompatibleEvidenceIds,
        'SNAPSHOT_INCOMPATIBLE',
      );
    }
    const locator = [
      'label-intelligence',
      result.subject.ledger,
      result.subject.chainId,
      result.subject.id,
      result.snapshot.id,
    ].join(':');
    const terminal = await addEvidence(
      runtime,
      createEvidence({
        ledger: result.subject.ledger,
        chainId: result.subject.chainId,
        kind: 'DERIVED_FEATURE',
        source: `zerotrace:${LABEL_INTELLIGENCE_MODEL_VERSION}`,
        locator,
        payload: { request: canonicalRequest, result },
        observedAt: canonicalRequest.asOf,
        finality: 'label-observation-set',
        summary:
          'Immutable Label observation-set review with preserved conflicts and non-merging safety rules.',
        sourceEvidenceIds,
      }),
      sourceEvidenceIds,
    );
    const resultWithTerminal = {
      ...result,
      metadata: {
        ...result.metadata,
        evidenceIds: uniqueEvidenceIds([...result.metadata.evidenceIds, terminal.id]).sort(),
      },
    };
    const report = LabelIntelligenceReportSchema.parse({
      schemaVersion: 'label-intelligence-report-v1',
      result: resultWithTerminal,
      terminalEvidenceId: terminal.id,
      evidence: [...sourceEvidence, terminal].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    });
    const record = await runtime.labelIntelligenceReports.put(report);
    return { replayed: false, record };
  });

  app.get(
    '/api/v1/labels/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const input = LabelIntelligenceIdentityQuerySchema.parse(request.query);
      const repository = runtime.labelIntelligenceReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'LABEL_INTELLIGENCE_UNAVAILABLE',
              'Durable Label Intelligence report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(input);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'LABEL_INTELLIGENCE_REPORT_NOT_FOUND',
              'No durable Label Intelligence report exists for this ledger-scoped Subject.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/labels/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LabelIntelligenceReportParamsSchema.parse(request.params);
      const repository = runtime.labelIntelligenceReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'LABEL_INTELLIGENCE_UNAVAILABLE',
              'Durable Label Intelligence report storage is not configured.',
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
              'LABEL_INTELLIGENCE_REPORT_NOT_FOUND',
              'The durable Label Intelligence report does not exist.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

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
          (query.chainId ?? `eip155:${config.ethereumChainId}`).replace(/^eip155:/, ''),
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
        return queryBitcoinAddress(adapter, subject, (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        );
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

}
