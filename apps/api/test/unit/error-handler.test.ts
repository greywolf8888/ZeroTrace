import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { ProviderError } from '@zerotrace/chain-adapters';
import {
  AgeInvestigationGraphProjectionError,
  ForensicReportStorageError,
  FundingSettlementReportStorageError,
  LabelIntelligenceStorageError,
  SemanticCheckpointError,
  StorageError,
} from '@zerotrace/storage';

import { BitcoinForensicGraphCaptureError } from '../../src/bitcoin-forensic-graph.js';
import { CorsOriginError, registerApiErrorHandler } from '../../src/http/error-handler.js';
import { SolanaDealerCaptureError } from '../../src/solana-dealer.js';

describe('API error handler', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function throwOnGet(error: unknown) {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerApiErrorHandler(app);
    app.get('/boom', async () => {
      throw error;
    });
    return app.inject({ method: 'GET', url: '/boom' });
  }

  it('maps domain failures without coercing them to empty success', async () => {
    const cases: Array<{ error: unknown; status: number; code: string }> = [
      { error: new CorsOriginError(), status: 403, code: 'CORS_ORIGIN_DENIED' },
      {
        error: new ZodError([{ code: 'custom', path: ['token'], message: 'bad' }]),
        status: 400,
        code: 'INVALID_REQUEST',
      },
      {
        error: new ProviderError('METHOD_NOT_ALLOWED', 'no', { retryable: false }),
        status: 400,
        code: 'METHOD_NOT_ALLOWED',
      },
      {
        error: new ProviderError('INVALID_RESPONSE', 'bad json', { retryable: true }),
        status: 502,
        code: 'INVALID_RESPONSE',
      },
      {
        error: new ProviderError('TIMEOUT', 'slow', { retryable: true }),
        status: 503,
        code: 'TIMEOUT',
      },
      {
        error: new SolanaDealerCaptureError('SOLANA_DEALER_CAPTURE_INVALID', 'shape'),
        status: 400,
        code: 'SOLANA_DEALER_CAPTURE_INVALID',
      },
      {
        error: new SolanaDealerCaptureError('SOLANA_DEALER_CAPTURE_NO_SOURCE', 'offline'),
        status: 503,
        code: 'SOLANA_DEALER_CAPTURE_NO_SOURCE',
      },
      {
        error: new SolanaDealerCaptureError('SOLANA_DEALER_CAPTURE_INCOMPLETE', 'partial'),
        status: 502,
        code: 'SOLANA_DEALER_CAPTURE_INCOMPLETE',
      },
      {
        error: new BitcoinForensicGraphCaptureError(
          'BITCOIN_FORENSIC_GRAPH_INVALID_REQUEST',
          'bad tx',
        ),
        status: 400,
        code: 'BITCOIN_FORENSIC_GRAPH_INVALID_REQUEST',
      },
      {
        error: new BitcoinForensicGraphCaptureError(
          'BITCOIN_FORENSIC_GRAPH_UNCONFIRMED',
          'mempool',
        ),
        status: 409,
        code: 'BITCOIN_FORENSIC_GRAPH_UNCONFIRMED',
      },
      {
        error: new BitcoinForensicGraphCaptureError(
          'BITCOIN_FORENSIC_GRAPH_PROVIDER_DOWN',
          'esplora',
          { retryable: true },
        ),
        status: 502,
        code: 'BITCOIN_FORENSIC_GRAPH_PROVIDER_DOWN',
      },
      {
        error: new StorageError('STORAGE_UNAVAILABLE', 'postgres down', { retryable: true }),
        status: 503,
        code: 'STORAGE_UNAVAILABLE',
      },
      {
        error: new ForensicReportStorageError('FORENSIC_REPORT_CONFLICT', 'dup'),
        status: 500,
        code: 'INTERNAL_ERROR',
      },
      {
        error: new FundingSettlementReportStorageError(
          'FUNDING_SETTLEMENT_REPORT_INVALID',
          'range',
        ),
        status: 400,
        code: 'FUNDING_SETTLEMENT_REPORT_INVALID',
      },
      {
        error: new FundingSettlementReportStorageError('FUNDING_SETTLEMENT_REPORT_CONFLICT', 'dup'),
        status: 409,
        code: 'FUNDING_SETTLEMENT_REPORT_CONFLICT',
      },
      {
        error: new FundingSettlementReportStorageError(
          'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
          'down',
          { retryable: true },
        ),
        status: 503,
        code: 'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
      },
      {
        error: new LabelIntelligenceStorageError('LABEL_INTELLIGENCE_INVALID', 'shape'),
        status: 400,
        code: 'LABEL_INTELLIGENCE_INVALID',
      },
      {
        error: new LabelIntelligenceStorageError('LABEL_INTELLIGENCE_UNAVAILABLE', 'down', {
          retryable: true,
        }),
        status: 503,
        code: 'LABEL_INTELLIGENCE_UNAVAILABLE',
      },
      {
        error: new AgeInvestigationGraphProjectionError('AGE_PROJECTION_INVALID', 'cypher'),
        status: 400,
        code: 'AGE_PROJECTION_INVALID',
      },
      {
        error: new AgeInvestigationGraphProjectionError('AGE_PROJECTION_UNAVAILABLE', 'age down', {
          retryable: true,
        }),
        status: 503,
        code: 'AGE_PROJECTION_UNAVAILABLE',
      },
      {
        error: new SemanticCheckpointError('SEMANTIC_CHECKPOINT_INVALID', 'state'),
        status: 400,
        code: 'SEMANTIC_CHECKPOINT_INVALID',
      },
      {
        error: new SemanticCheckpointError('SEMANTIC_CHECKPOINT_NOT_FOUND', 'missing'),
        status: 404,
        code: 'SEMANTIC_CHECKPOINT_NOT_FOUND',
      },
      {
        error: new SemanticCheckpointError('SEMANTIC_CHECKPOINT_UNAVAILABLE', 'down', {
          retryable: true,
        }),
        status: 503,
        code: 'SEMANTIC_CHECKPOINT_UNAVAILABLE',
      },
      { error: new Error('boom'), status: 500, code: 'INTERNAL_ERROR' },
      { error: 'string-throw', status: 500, code: 'INTERNAL_ERROR' },
    ];

    for (const item of cases) {
      const response = await throwOnGet(item.error);
      expect(response.statusCode, item.code).toBe(item.status);
      expect(response.json()).toMatchObject({ error: { code: item.code } });
    }
  });
});
