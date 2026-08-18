import type { FastifyInstance } from 'fastify';

import { buildCampaignIntelligence } from '@zerotrace/campaign-intelligence';
import { buildCapitalReport } from '@zerotrace/capital-intelligence';
import { exportCasePackage, recordAnalystDecision } from '@zerotrace/casework';
import {
  buildReportEnvelope,
  contentAddressedId,
  coverageFromRatios,
  inconclusiveSourceIndependence,
} from '@zerotrace/evidence';
import { assessRoles, type RoleCandidateInput } from '@zerotrace/identity-intelligence';
import { validateLlmOutput } from '@zerotrace/llm-gateway';
import {
  isolatedRvSumIsIllegal,
  reproducibleDistribution,
  simulateMarketWideExit,
} from '@zerotrace/market-reality-engine';
import {
  AnalystDecisionSchema,
  InvestigationIdSchema,
  MarketWideExitScenarioSchema,
  ReportEnvelopeSchema,
  type AnalysisSnapshot,
  type CampaignFeatureWindow,
  type ExitCohort,
  type ForensicFinding,
  type ReportEnvelope,
  type SupplyCell,
  type VenueSnapshot,
} from '@zerotrace/schemas';
import { materializeSupplyReality } from '@zerotrace/supply-reality-engine';
import type { PostgresForensicReportRepository } from '@zerotrace/storage';

import type { AppRuntime } from '../runtime.js';

export interface MarketStructurePluginOptions {
  runtime: AppRuntime;
  forensicReports?: PostgresForensicReportRepository;
}

function errorBody(code: string, message: string) {
  return { error: { code, message, retryable: false } };
}

function snapshotFromBody(snapshot: AnalysisSnapshot): AnalysisSnapshot {
  return snapshot;
}

export async function registerMarketStructureV2(
  app: FastifyInstance,
  options: MarketStructurePluginOptions,
): Promise<void> {
  const investigations = new Map<string, Record<string, unknown>>();
  const envelopes = new Map<string, ReportEnvelope>();

  const envelopeKey = (reportType: string, chainId: string, token: string): string =>
    `${reportType}:${chainId}:${token}`;

  const rememberEnvelope = async (envelope: ReportEnvelope): Promise<ReportEnvelope> => {
    envelopes.set(
      envelopeKey(envelope.reportType, envelope.subject.chainId, envelope.subject.identifier),
      envelope,
    );
    try {
      await options.forensicReports?.put(envelope);
    } catch (error) {
      app.log.warn({ err: error }, 'forensic report persist skipped');
    }
    return envelope;
  };

  const loadEnvelope = async (
    reportType: string,
    chainId: string,
    token: string,
  ): Promise<ReportEnvelope | undefined> => {
    const memory = envelopes.get(envelopeKey(reportType, chainId, token));
    if (memory !== undefined) return memory;
    return options.forensicReports?.latest(reportType, chainId, token);
  };

  app.post('/api/v2/investigations', { schema: { tags: ['analysis'] } }, async (request, reply) => {
    const body = request.body as {
      ledger: AnalysisSnapshot['ledger'];
      chainId: string;
      subjectType: string;
      identifier: string;
      actor?: string;
    };
    const id = contentAddressedId('inv', body);
    const record = {
      id,
      status: 'OPEN' as const,
      subject: {
        ledger: body.ledger,
        chainId: body.chainId,
        subjectType: body.subjectType,
        identifier: body.identifier,
      },
      actor: body.actor ?? 'local-analyst',
      createdAt: new Date().toISOString(),
      replay: `/api/v2/investigations/${id}/replay`,
    };
    investigations.set(id, record);
    return reply.code(201).send(record);
  });

  app.get(
    '/api/v2/investigations/:investigationId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = request.params as { investigationId: string };
      InvestigationIdSchema.parse(params.investigationId);
      const record = investigations.get(params.investigationId);
      if (record === undefined) {
        return reply.code(404).send(errorBody('NOT_FOUND', '调查不存在。'));
      }
      return record;
    },
  );

  app.post(
    '/api/v2/investigations/:investigationId/replay',
    { schema: { tags: ['analysis'] } },
    async (request) => ({
      investigationId: (request.params as { investigationId: string }).investigationId,
      replayed: true,
      readOnly: true,
    }),
  );

  app.post(
    '/api/v2/tokens/:ledger/:chainId/:token/supply-reality',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = request.params as {
        ledger: SupplyCell['token']['ledger'];
        chainId: string;
        token: string;
      };
      const body = request.body as {
        snapshot: AnalysisSnapshot;
        protocolSupplyAtomic: string;
        historicalMintAtomic: string;
        historicalBurnAtomic: string;
        burnAlreadyReflectedInSupply: boolean;
        originCoverageComplete: boolean;
        cells: SupplyCell[];
        registryEvidenceId: string;
        terminalEvidenceId: string;
      };
      const payload = materializeSupplyReality({
        token: { ledger: params.ledger, chainId: params.chainId, token: params.token },
        protocolSupplyAtomic: body.protocolSupplyAtomic,
        historicalMintAtomic: body.historicalMintAtomic,
        historicalBurnAtomic: body.historicalBurnAtomic,
        burnAlreadyReflectedInSupply: body.burnAlreadyReflectedInSupply,
        originCoverageComplete: body.originCoverageComplete,
        cells: body.cells,
      });
      const envelope = buildReportEnvelope({
        schemaVersion: 'report-envelope-v1',
        reportType: 'supply-reality-v1',
        schemaContractVersion: 'supply-reality-v1',
        modelVersion: 'supply-reality-v1.0.0',
        policyVersion: 'market-structure-policy-v1',
        subject: {
          ledger: params.ledger,
          chainId: params.chainId,
          subjectType: 'TOKEN',
          identifier: params.token,
        },
        snapshot: snapshotFromBody(body.snapshot),
        status: body.originCoverageComplete ? 'COMPLETE' : 'BOUNDED_OBSERVATION',
        coverage: coverageFromRatios({
          originCoverage: body.originCoverageComplete ? 1 : 0,
          historyCoverage: body.originCoverageComplete ? 1 : 0.5,
        }),
        sourceSet: ['deterministic-supply-reality'],
        sourceIndependence: inconclusiveSourceIndependence(
          body.registryEvidenceId,
          body.terminalEvidenceId,
        ),
        evidenceClosure: [body.terminalEvidenceId, body.registryEvidenceId].sort(),
        createdAt: new Date().toISOString(),
        replayRef: {
          command: `GET /api/v2/tokens/${params.ledger}/${params.chainId}/${params.token}/supply-reality/latest`,
          snapshot: body.snapshot,
          modelVersion: 'supply-reality-v1.0.0',
          policyVersion: 'market-structure-policy-v1',
          inputHash: body.terminalEvidenceId.replace('ev_', '').padEnd(64, '0').slice(0, 64),
        },
        payload,
      });
      return reply.send(await rememberEnvelope(envelope));
    },
  );

  app.get(
    '/api/v2/tokens/:ledger/:chainId/:token/supply-reality/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = request.params as { chainId: string; token: string };
      const stored = await loadEnvelope('supply-reality-v1', params.chainId, params.token);
      if (stored === undefined)
        return reply.code(404).send(errorBody('NOT_FOUND', '供应现实报告不存在。'));
      return stored;
    },
  );

  app.post(
    '/api/v2/tokens/:ledger/:chainId/:token/roles',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const params = request.params as {
        ledger: RoleCandidateInput['subject']['ledger'];
        chainId: string;
        token: string;
      };
      const body = request.body as {
        snapshot: AnalysisSnapshot;
        registryEvidenceId: string;
        terminalEvidenceId: string;
        candidates: RoleCandidateInput[];
        protocolSupplyAtomic: string;
        executableSellableAtomic: string;
        nonServiceNonPoolAtomic: string;
        marketWideExitU: string;
      };
      const payload = assessRoles(body);
      return rememberEnvelope(
        buildReportEnvelope({
          schemaVersion: 'report-envelope-v1',
          reportType: 'identity-roles-v1',
          schemaContractVersion: 'identity-roles-v1',
          modelVersion: 'identity-intelligence-v1.0.0',
          policyVersion: 'role-policy-v1',
          subject: {
            ledger: params.ledger,
            chainId: params.chainId,
            subjectType: 'TOKEN',
            identifier: params.token,
          },
          snapshot: body.snapshot,
          status: 'PARTIAL',
          coverage: coverageFromRatios({ entityCoverage: 1 }),
          sourceSet: ['deterministic-identity'],
          sourceIndependence: inconclusiveSourceIndependence(
            body.registryEvidenceId,
            body.terminalEvidenceId,
          ),
          evidenceClosure: [body.registryEvidenceId, body.terminalEvidenceId].sort(),
          createdAt: new Date().toISOString(),
          replayRef: {
            command: `GET /api/v2/tokens/${params.ledger}/${params.chainId}/${params.token}/roles/latest`,
            snapshot: body.snapshot,
            modelVersion: 'identity-intelligence-v1.0.0',
            policyVersion: 'role-policy-v1',
            inputHash: body.terminalEvidenceId.replace('ev_', '').padEnd(64, '0').slice(0, 64),
          },
          payload,
        }),
      );
    },
  );

  app.post(
    '/api/v2/tokens/:ledger/:chainId/:token/campaigns/materialize',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const params = request.params as {
        ledger: CampaignFeatureWindow['start']['ledger'];
        chainId: string;
        token: string;
      };
      const body = request.body as {
        snapshot: AnalysisSnapshot;
        registryEvidenceId: string;
        terminalEvidenceId: string;
        windows: CampaignFeatureWindow[];
        originComplete: boolean;
        controllerEntityIds: string[];
      };
      const payload = buildCampaignIntelligence({
        token: { ledger: params.ledger, chainId: params.chainId, token: params.token },
        snapshot: body.snapshot,
        registryEvidenceId: body.registryEvidenceId,
        terminalEvidenceId: body.terminalEvidenceId,
        windows: body.windows,
        originComplete: body.originComplete,
        controllerEntityIds: body.controllerEntityIds,
        tactics: [],
      });
      return payload;
    },
  );

  app.post(
    '/api/v2/campaigns/:campaignId/profit',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const params = request.params as { campaignId: string };
      const body = request.body as {
        lots: Parameters<typeof buildCapitalReport>[0]['lots'];
        entries: Parameters<typeof buildCapitalReport>[0]['entries'];
      };
      return buildCapitalReport({
        lots: [...body.lots],
        entries: [...body.entries],
        campaignId: params.campaignId,
      });
    },
  );

  app.post(
    '/api/v2/tokens/:ledger/:chainId/:token/exit-scenarios',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = request.params as {
        ledger: VenueSnapshot['baseToken']['ledger'];
        chainId: string;
        token: string;
      };
      const body = request.body as {
        snapshot: AnalysisSnapshot;
        venues: VenueSnapshot[];
        cohorts: ExitCohort[];
        strategy: Parameters<typeof simulateMarketWideExit>[0]['strategy'];
        seed: number;
        metadata: Parameters<typeof simulateMarketWideExit>[0]['metadata'];
        isolatedQuotes?: string[];
      };
      if (body.isolatedQuotes !== undefined && body.isolatedQuotes.length > 1) {
        try {
          isolatedRvSumIsIllegal(body.isolatedQuotes.map((item) => BigInt(item)));
        } catch (error) {
          return reply
            .code(400)
            .send(errorBody('ISOLATED_RV_SUM_REJECTED', (error as Error).message));
        }
      }
      const scenario = simulateMarketWideExit({
        token: { ledger: params.ledger, chainId: params.chainId, token: params.token },
        snapshot: body.snapshot,
        venues: body.venues,
        cohorts: body.cohorts,
        strategy: body.strategy,
        seed: body.seed,
        metadata: body.metadata,
      });
      return MarketWideExitScenarioSchema.parse(scenario);
    },
  );

  app.post(
    '/api/v2/exit-scenarios/distribution',
    { schema: { tags: ['analysis'] } },
    async (request) => {
      const body = request.body as {
        seed: number;
        scenarios: ReturnType<typeof simulateMarketWideExit>[];
      };
      return reproducibleDistribution(body.scenarios, body.seed);
    },
  );

  app.post('/api/v2/analyst-decisions', { schema: { tags: ['analysis'] } }, async (request) => {
    return recordAnalystDecision(
      AnalystDecisionSchema.omit({ id: true, nextStateHash: true }).parse(request.body),
    );
  });

  app.post('/api/v2/cases/export', { schema: { tags: ['analysis'] } }, async (request) => {
    const body = request.body as {
      investigationId: string;
      findings?: ForensicFinding[];
      limitations?: string[];
      createdAt?: string;
    };
    return exportCasePackage({
      investigationId: body.investigationId,
      findings: body.findings ?? [],
      limitations: body.limitations ?? [
        '链上只读，不嵌入 Provider 密钥。',
        '未提供发现列表时仅导出限制说明。',
      ],
      createdAt: body.createdAt ?? new Date().toISOString(),
    });
  });

  app.get('/api/v2/cases/:caseId/export', { schema: { tags: ['analysis'] } }, async (request) => {
    const params = request.params as { caseId: string };
    const query = request.query as { investigationId?: string };
    const investigationId =
      query.investigationId ??
      `inv_${params.caseId
        .replace(/^[a-z]+_/, '')
        .replace(/[^0-9a-f]/g, '0')
        .padEnd(24, '0')
        .slice(0, 24)}`;
    return exportCasePackage({
      investigationId,
      findings: [],
      limitations: ['导出时若无发现列表，则仅返回限制说明。', '链上只读，不嵌入 Provider 密钥。'],
      createdAt: new Date().toISOString(),
    });
  });

  app.post('/api/v2/llm/validate', { schema: { tags: ['analysis'] } }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof validateLlmOutput>[0];
      return validateLlmOutput(body);
    } catch (error) {
      return reply.code(400).send(errorBody('LLM_VALIDATION_FAILED', (error as Error).message));
    }
  });

  app.get(
    '/api/v2/tokens/:ledger/:chainId/:token/market-structure/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = request.params as { chainId: string; token: string };
      const stored = await loadEnvelope('supply-reality-v1', params.chainId, params.token);
      if (stored === undefined) {
        return reply
          .code(404)
          .send(errorBody('NOT_FOUND', '盘面结构报告不存在，请先物化供应现实。'));
      }
      return ReportEnvelopeSchema.parse(stored);
    },
  );
}
