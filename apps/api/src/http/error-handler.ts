import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ProviderError } from '@zerotrace/chain-adapters';
import { BitcoinForensicGraphCaptureError } from '../bitcoin-forensic-graph.js';
import { SolanaDealerCaptureError } from '../solana-dealer.js';
import {
  ActionSemanticsReportStorageError,
  ClaimDeclarationReportStorageError,
  ClaimRuleReviewReportStorageError,
  ClaimReportStorageError,
  ClaimVerificationReportStorageError,
  ControlCampaignReportStorageError,
  ControlSurfaceReportStorageError,
  EntityRelationshipReportStorageError,
  EntityRelationshipTimelineStorageError,
  EntityInvestigationGraphStorageError,
  EntityInvestigationGraphTimelineStorageError,
  AgeInvestigationGraphProjectionError,
  FlapHistoryProjectionError,
  FlapLifetimeHeadError,
  FlapPensionEntryReportStorageError,
  FundingSettlementReportStorageError,
  CaptureScheduleStorageError,
  ForensicCampaignAlertStorageError,
  LabelIntelligenceStorageError,
  PensionCandidateReportStorageError,
  SemanticCheckpointError,
  SolanaTransactionReportStorageError,
  SolanaDealerCampaignReportStorageError,
  BitcoinForensicGraphReportStorageError,
  StorageError,
} from '@zerotrace/storage';
import { errorResponse } from './helpers.js';

export class CorsOriginError extends Error {
  constructor() {
    super('Origin is not allowed.');
    this.name = 'CorsOriginError';
  }
}

export function registerApiErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof CorsOriginError) {
      return reply
        .code(403)
        .send(errorResponse(request, 'CORS_ORIGIN_DENIED', error.message, false));
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        ...errorResponse(request, 'INVALID_REQUEST', 'Request validation failed.', false),
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    if (error instanceof ProviderError) {
      const status =
        error.code === 'METHOD_NOT_ALLOWED' ? 400 : error.code === 'INVALID_RESPONSE' ? 502 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof SolanaDealerCaptureError) {
      const status =
        error.code === 'SOLANA_DEALER_CAPTURE_INVALID'
          ? 400
          : error.code === 'SOLANA_DEALER_CAPTURE_NO_SOURCE'
            ? 503
            : 502;
      return reply.code(status).send(errorResponse(request, error.code, error.message, false));
    }
    if (error instanceof BitcoinForensicGraphCaptureError) {
      const status =
        error.code === 'BITCOIN_FORENSIC_GRAPH_INVALID_REQUEST'
          ? 400
          : error.code === 'BITCOIN_FORENSIC_GRAPH_UNCONFIRMED'
            ? 409
            : 502;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof StorageError) {
      return reply
        .code(503)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof CaptureScheduleStorageError) {
      const status =
        error.code === 'CAPTURE_SCHEDULER_INVALID'
          ? 400
          : error.code === 'CAPTURE_SCHEDULER_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ForensicCampaignAlertStorageError) {
      const status = error.code === 'FORENSIC_ALERT_STORAGE_CONFLICT' ? 409 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FlapHistoryProjectionError) {
      const status = error.code === 'FLAP_HISTORY_PROJECTION_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FlapLifetimeHeadError) {
      const status = error.code === 'FLAP_LIFETIME_HEAD_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ClaimReportStorageError) {
      const status = error.code === 'CLAIM_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ClaimDeclarationReportStorageError) {
      const status =
        error.code === 'CLAIM_DECLARATION_REPORT_INVALID'
          ? 400
          : error.code === 'CLAIM_DECLARATION_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ClaimRuleReviewReportStorageError) {
      const status =
        error.code === 'CLAIM_RULE_REVIEW_REPORT_INVALID'
          ? 400
          : error.code === 'CLAIM_RULE_REVIEW_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ClaimVerificationReportStorageError) {
      const status =
        error.code === 'CLAIM_VERIFICATION_REPORT_INVALID'
          ? 400
          : error.code === 'CLAIM_VERIFICATION_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ControlSurfaceReportStorageError) {
      const status = error.code === 'CONTROL_SURFACE_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof SolanaTransactionReportStorageError) {
      const status = error.code === 'SOLANA_TRANSACTION_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof SolanaDealerCampaignReportStorageError) {
      const status =
        error.code === 'SOLANA_DEALER_REPORT_INVALID'
          ? 400
          : error.code === 'SOLANA_DEALER_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof BitcoinForensicGraphReportStorageError) {
      const status =
        error.code === 'BITCOIN_FORENSIC_GRAPH_INVALID'
          ? 400
          : error.code === 'BITCOIN_FORENSIC_GRAPH_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ActionSemanticsReportStorageError) {
      const status = error.code === 'ACTION_SEMANTICS_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof PensionCandidateReportStorageError) {
      const status = error.code === 'PENSION_CANDIDATE_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FlapPensionEntryReportStorageError) {
      const status = error.code === 'FLAP_PENSION_ENTRY_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof EntityRelationshipReportStorageError) {
      const status = error.code === 'ENTITY_RELATIONSHIP_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof EntityRelationshipTimelineStorageError) {
      const status = error.code === 'ENTITY_RELATIONSHIP_TIMELINE_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof EntityInvestigationGraphStorageError) {
      const status = error.code === 'ENTITY_INVESTIGATION_GRAPH_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof EntityInvestigationGraphTimelineStorageError) {
      const status = error.code === 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ControlCampaignReportStorageError) {
      const status =
        error.code === 'CONTROL_CAMPAIGN_REPORT_INVALID'
          ? 400
          : error.code === 'CONTROL_CAMPAIGN_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FundingSettlementReportStorageError) {
      const status =
        error.code === 'FUNDING_SETTLEMENT_REPORT_INVALID'
          ? 400
          : error.code === 'FUNDING_SETTLEMENT_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof LabelIntelligenceStorageError) {
      const status = error.code === 'LABEL_INTELLIGENCE_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof AgeInvestigationGraphProjectionError) {
      const status = error.code === 'AGE_PROJECTION_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof SemanticCheckpointError) {
      const status =
        error.code === 'SEMANTIC_CHECKPOINT_INVALID'
          ? 400
          : error.code === 'SEMANTIC_CHECKPOINT_NOT_FOUND'
            ? 404
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    const internalError = error instanceof Error ? error : new Error('Unknown thrown value');
    request.log.error(
      { message: internalError.message, name: internalError.name },
      'request failed',
    );
    return reply
      .code(500)
      .send(errorResponse(request, 'INTERNAL_ERROR', 'Internal server error.', false));
  });
}
