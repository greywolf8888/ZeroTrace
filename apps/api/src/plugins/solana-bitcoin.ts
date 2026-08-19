import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ProviderError } from '@zerotrace/chain-adapters';
import { captureBitcoinForensicGraph } from '../bitcoin-forensic-graph.js';
import { captureSolanaDealerCampaign } from '../solana-dealer.js';
import { classifyIdentifier } from '@zerotrace/identifiers';
import {
  SolanaTransactionIntelligenceReportSchema,
  SolanaDealerCampaignRequestSchema,
  unavailableValue,
  type AnalysisSnapshot,
  type Evidence,
} from '@zerotrace/schemas';
import {
  queryBitcoinBlock,
  queryBitcoinOutpoint,
  queryBitcoinTransaction,
  queryEvmBlock,
  queryEvmTransaction,
  querySolanaBlock,
  querySolanaTransaction,
} from '../ledger-query.js';
import {
  LedgerRecordParamsSchema,
  LedgerRecordQuerySchema,
  SolanaTransactionReportParamsSchema,
  SolanaTransactionReportByIdParamsSchema,
  SolanaDealerCampaignReportParamsSchema,
  SolanaDealerCampaignMintParamsSchema,
  BitcoinForensicGraphReportParamsSchema,
  BitcoinForensicGraphRootParamsSchema,
  BitcoinForensicGraphRequestSchema,
  ActionSemanticsReportLookupQuerySchema,
  ActionSemanticsReportParamsSchema,
} from '../http/request-schemas.js';
import {
  errorResponse,
  emptyMetadata,
  addEvidence,
  bindRequestAbort,
  solanaTransactionReportResponse,
} from '../http/helpers.js';
import type { AppHttpContext } from '../http/context.js';

export async function registerSolanaBitcoinLedgerRoutes(
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
    '/api/v1/ledger/SOLANA/TRANSACTION/:signature/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = SolanaTransactionReportParamsSchema.parse(request.params);
      const repository = runtime.solanaTransactionReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_TRANSACTION_REPORT_UNAVAILABLE',
              'Durable Solana transaction report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(params.signature);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'SOLANA_TRANSACTION_REPORT_NOT_FOUND',
              'No durable Solana transaction report exists for this signature.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/ledger/SOLANA/TRANSACTION/:signature/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = SolanaTransactionReportByIdParamsSchema.parse(request.params);
      const repository = runtime.solanaTransactionReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_TRANSACTION_REPORT_UNAVAILABLE',
              'Durable Solana transaction report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined || record.signature !== params.signature) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'SOLANA_TRANSACTION_REPORT_NOT_FOUND',
              'The durable Solana transaction report was not found for this signature.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.post(
    '/api/v1/solana/dealer-campaigns',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const body = SolanaDealerCampaignRequestSchema.parse(request.body);
      const requestAbort = bindRequestAbort(request, reply);
      const source = runtime.sqdSolanaSource;
      const adapter = runtime.solanaAdapter;
      if (source === undefined || adapter === undefined) {
        requestAbort.cleanup();
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_DEALER_CAPTURE_NO_SOURCE',
              'A finalized Solana RPC adapter and SQD solana-mainnet source are required for dealer capture.',
              false,
            ),
          );
      }
      try {
        const result = await captureSolanaDealerCampaign({
          ...body,
          source,
          adapter,
          signal: requestAbort.signal,
          writeEvidence: async (evidence, sourceEvidenceIds = [], snapshot) => {
            if (requestAbort.signal.aborted) {
              throw new ProviderError('TIMEOUT', 'Solana dealer capture was aborted.', {
                retryable: false,
              });
            }
            const stored = await addEvidence(runtime, evidence, sourceEvidenceIds, snapshot);
            if (requestAbort.signal.aborted) {
              throw new ProviderError('TIMEOUT', 'Solana dealer capture was aborted.', {
                retryable: false,
              });
            }
            return stored;
          },
        });
        const durableReport = await runtime.solanaDealerReports?.put(result.report);
        if (result.report.campaign !== null) {
          await runtime.controlCampaignReports?.put(result.report.campaign);
          for (const alert of result.report.alerts) {
            await runtime.forensicCampaignAlerts?.put(alert);
          }
        }
        return {
          replayed: false,
          durable: durableReport !== undefined,
          record: durableReport ?? null,
          report: result.report,
          sourceSummary: result.sourceSummary,
          candidateCount: result.candidateCount,
          truncated: result.truncated,
        };
      } finally {
        requestAbort.cleanup();
      }
    },
  );

  app.get(
    '/api/v1/solana/dealer-campaigns/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = SolanaDealerCampaignReportParamsSchema.parse(request.params);
      const repository = runtime.solanaDealerReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_DEALER_REPORT_UNAVAILABLE',
              'Durable Solana dealer campaign report storage is not configured.',
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
              'SOLANA_DEALER_REPORT_NOT_FOUND',
              'The durable Solana dealer campaign report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/solana/mints/:mint/dealer-campaigns/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = SolanaDealerCampaignMintParamsSchema.parse(request.params);
      const repository = runtime.solanaDealerReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_DEALER_REPORT_UNAVAILABLE',
              'Durable Solana dealer campaign report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(params.mint);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'SOLANA_DEALER_REPORT_NOT_FOUND',
              'No durable Solana dealer campaign report exists for this mint.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.post(
    '/api/v1/bitcoin/forensic-graphs',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const body = BitcoinForensicGraphRequestSchema.parse(request.body);
      const adapter = runtime.bitcoinAdapter;
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'BITCOIN_FORENSIC_GRAPH_PROVIDER_UNCONFIGURED',
              'A Bitcoin Esplora adapter is required for forensic graph capture.',
              false,
            ),
          );
      }
      const result = await captureBitcoinForensicGraph({
        adapter,
        request: body,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
      });
      const durableReport = await runtime.bitcoinForensicGraphReports?.put(result.report);
      return {
        replayed: false,
        durable: durableReport !== undefined,
        record: durableReport ?? null,
        report: result.report,
        sourceSummary: result.sourceSummary,
        capturedEvidence: result.evidence.map((item) => item.id),
      };
    },
  );

  app.get(
    '/api/v1/bitcoin/forensic-graphs/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = BitcoinForensicGraphReportParamsSchema.parse(request.params);
      const repository = runtime.bitcoinForensicGraphReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
              'Durable Bitcoin forensic graph storage is not configured.',
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
              'BITCOIN_FORENSIC_GRAPH_NOT_FOUND',
              'The durable Bitcoin forensic graph was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/bitcoin/transactions/:txid/forensic-graphs/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = BitcoinForensicGraphRootParamsSchema.parse(request.params);
      const repository = runtime.bitcoinForensicGraphReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
              'Durable Bitcoin forensic graph storage is not configured.',
              false,
            ),
          );
      }
      const record = (await repository.list({ rootTxid: params.txid, limit: 1 }))[0];
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'BITCOIN_FORENSIC_GRAPH_NOT_FOUND',
              'No durable Bitcoin forensic graph exists for this transaction.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/actions/semantics/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ActionSemanticsReportLookupQuerySchema.parse(request.query);
      const repository = runtime.actionSemanticsReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ACTION_SEMANTICS_REPORT_UNAVAILABLE',
              'Durable Action Semantics report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(query);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ACTION_SEMANTICS_REPORT_NOT_FOUND',
              'No durable Action Semantics report exists for this transaction.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/actions/semantics/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ActionSemanticsReportParamsSchema.parse(request.params);
      const repository = runtime.actionSemanticsReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ACTION_SEMANTICS_REPORT_UNAVAILABLE',
              'Durable Action Semantics report storage is not configured.',
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
              'ACTION_SEMANTICS_REPORT_NOT_FOUND',
              'The durable Action Semantics report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/ledger/:ledger/:type/:id',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LedgerRecordParamsSchema.parse(request.params);
      const query = LedgerRecordQuerySchema.parse(request.query);
      if (params.type === 'OUTPOINT' && params.ledger !== 'BITCOIN') {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'UNSUPPORTED_IDENTIFIER_TYPE',
              'Outpoints are only supported on Bitcoin.',
              false,
            ),
          );
      }
      const canonicalNonEvmChainId =
        params.ledger === 'BITCOIN'
          ? 'bitcoin-mainnet'
          : params.ledger === 'SOLANA'
            ? 'solana-mainnet'
            : undefined;
      if (
        query.chainId !== undefined &&
        canonicalNonEvmChainId !== undefined &&
        query.chainId !== canonicalNonEvmChainId
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_CHAIN_ID',
              `${params.ledger} queries require chainId=${canonicalNonEvmChainId}.`,
              false,
            ),
          );
      }
      const requestedChainId =
        params.ledger === 'EVM'
          ? (query.chainId ?? `eip155:${config.ethereumChainId}`)
          : params.ledger === 'BITCOIN'
            ? 'bitcoin-mainnet'
            : 'solana-mainnet';
      const classification = classifyIdentifier(params.id, {
        ledger: params.ledger,
        type: params.type,
        chainId: requestedChainId,
      });
      const subject = classification.candidates.find(
        (candidate) => candidate.ledger === params.ledger && candidate.type === params.type,
      );
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              `A structurally valid ${params.ledger} ${params.type.toLowerCase()} identifier is required.`,
              false,
            ),
          );
      }
      const writeEvidence = (
        evidence: Evidence,
        sourceEvidenceIds: readonly string[] = [],
        snapshot?: AnalysisSnapshot,
      ) => addEvidence(runtime, evidence, sourceEvidenceIds, snapshot);

      if (params.ledger === 'EVM') {
        const match = /^eip155:([1-9]\d*)$/.exec(requestedChainId);
        const numericChainId = match === null ? Number.NaN : Number(match[1]);
        if (!Number.isSafeInteger(numericChainId)) {
          return reply
            .code(400)
            .send(errorResponse(request, 'INVALID_CHAIN_ID', 'Invalid EIP-155 chain ID.', false));
        }
        const adapter = runtime.evmAdapters.get(numericChainId);
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata(`evm-${params.type.toLowerCase()}-query-v0.1.0`),
          });
        }
        return params.type === 'BLOCK'
          ? queryEvmBlock(adapter, subject, writeEvidence)
          : queryEvmTransaction(adapter, subject, writeEvidence);
      }

      if (params.ledger === 'BITCOIN') {
        const adapter = runtime.bitcoinAdapter;
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata(`bitcoin-${params.type.toLowerCase()}-query-v0.1.0`),
          });
        }
        if (params.type === 'BLOCK') return queryBitcoinBlock(adapter, subject, writeEvidence);
        if (params.type === 'OUTPOINT') {
          return queryBitcoinOutpoint(adapter, subject, writeEvidence);
        }
        return queryBitcoinTransaction(adapter, subject, writeEvidence);
      }

      const adapter = runtime.solanaAdapter;
      if (params.type === 'BLOCK') {
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata('solana-block-query-v0.1.0'),
          });
        }
        return querySolanaBlock(adapter, subject, writeEvidence);
      }

      const repository = runtime.solanaTransactionReports;
      if (adapter === undefined) {
        const record = await repository?.latest(subject.normalizedId);
        if (record !== undefined) {
          return solanaTransactionReportResponse(
            record,
            true,
            unavailableValue(
              'PROVIDER_UNCONFIGURED',
              'The immutable report was replayed because no live Solana provider is configured.',
            ),
          );
        }
        return reply.code(503).send({
          subject,
          facts: unavailableValue('PROVIDER_UNCONFIGURED'),
          metadata: emptyMetadata('solana-transaction-query-v1.1.0'),
        });
      }

      try {
        const result = await querySolanaTransaction(adapter, subject, writeEvidence);
        const parsed = SolanaTransactionIntelligenceReportSchema.safeParse(result);
        if (
          !parsed.success ||
          repository === undefined ||
          runtime.evidenceRepository === undefined
        ) {
          return result;
        }
        const record = await repository.put(parsed.data);
        return solanaTransactionReportResponse(record, false);
      } catch (error) {
        if (!(error instanceof ProviderError) || repository === undefined) throw error;
        const record = await repository.latest(subject.normalizedId);
        if (record === undefined) throw error;
        return solanaTransactionReportResponse(
          record,
          true,
          unavailableValue(
            error.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_DOWN',
            `Live refresh failed with ${error.code}; the immutable report was replayed without changing its Snapshot.`,
          ),
        );
      }
    },
  );
}
