import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  LedgerError,
  parseExpectation,
  parseTransactionInput,
  VERIFIER_RULE,
  PARSER_VERSION,
  USDC_NETWORK,
  buildReportBundle,
  replayReportBundle,
  type ReportBundle,
  type transactionCollector,
  type TransactionObservation,
} from '@zerotrace/arc-task-ledger';
import { verifierRepository } from './verifier-storage.js';
import { verifierSessions } from './verifier-session.js';
import type { LedgerStore } from './storage.js';

function document(bundle: ReportBundle) {
  const { report, observation } = bundle;
  return {
    report,
    observation,
    expectation: report.expectation,
    evaluation: report.evaluation,
    ruleVersion: report.ruleVersion,
    parserVersion: report.parserVersion,
    readOnlyChain: true,
    evidence: {
      id: bundle.bundleHash,
      rawArtifacts: 'IN_BUNDLE',
      sourceSet: [observation.source.alias],
    },
    snapshot: {
      id: bundle.bundleHash,
      blockHash: report.facts?.blockHash ?? null,
      blockNumber: report.facts?.blockNumber ?? null,
      replayable: true,
    },
    coverage: {
      scope: 'SINGLE_TRANSACTION',
      state: report.acquisition.completeness,
      history: 'NOT_CHECKED',
      independentSourceAgreement: 'NOT_VERIFIED',
    },
    freshness: { observedAt: observation.source.observedAt, state: 'FIXED_OBSERVATION' },
    confidence: report.confidence,
    formalForensicMode: false,
    visibility: 'PRIVATE_UNLESS_EXPLICITLY_PUBLISHED',
  };
}
export async function registerVerifierRoutes(
  app: FastifyInstance,
  collect: ReturnType<typeof transactionCollector>,
  store: LedgerStore,
  secret: string,
  writer?: LedgerStore,
) {
  const sessions = verifierSessions(secret);
  const read = verifierRepository(store);
  const write = writer ? verifierRepository(writer) : null;
  const requireWriter = () => {
    if (!write)
      throw new LedgerError('DURABLE_WRITE_UNAVAILABLE', '持久报告写入未配置，核验保持关闭。', 503);
    return write;
  };
  const key = (r: FastifyRequest) => {
    const value = r.headers['idempotency-key'];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value))
      throw new LedgerError('IDEMPOTENCY_KEY_REQUIRED', '请使用独立且稳定的请求键。', 400);
    return value;
  };
  const reportId = (r: FastifyRequest) => {
    const id = (r.params as { id: string }).id;
    if (!/^zasv_[a-f0-9]{64}$/.test(id))
      throw new LedgerError('INVALID_REPORT_ID', '报告编号无效。', 400);
    return id;
  };
  async function taskContext(
    input: unknown,
    transactionHash: string,
  ): Promise<NonNullable<TransactionObservation['taskContext']>> {
    const t = input as { jobId: string; snapshotRunId: string; legId: string };
    if (
      !t ||
      typeof t !== 'object' ||
      Array.isArray(t) ||
      Object.keys(t).sort().join(',') !== 'jobId,legId,snapshotRunId' ||
      !/^[0-9]{1,78}$/.test(t.jobId) ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(t.snapshotRunId) ||
      typeof t.legId !== 'string' ||
      t.legId.length > 200
    )
      throw new LedgerError('INVALID_TASK_REFERENCE', '任务引用无效。', 400);
    const run = await store.getRunMetadata(t.snapshotRunId);
    if (!run) throw new LedgerError('TASK_SNAPSHOT_UNAVAILABLE', '固定任务快照不可用。', 410);
    const detail = await store.getJobDetail(t.snapshotRunId, t.jobId);
    const leg = detail?.settlementLegs.find((l) => l.id === t.legId);
    if (
      !detail ||
      detail.job.cashState === 'CONFLICT' ||
      !leg ||
      leg.expectedAmount.atomic.state !== 'known' ||
      leg.expectedAmount.decimals !== 18 ||
      !leg.evidenceIds.length ||
      !['DIRECT', 'UNIQUE_EVENT_SEGMENT'].includes(leg.attribution)
    )
      throw new LedgerError(
        'TASK_CONDITIONS_UNKNOWN',
        '该任务资金段没有足够证据生成确定核对条件；可继续手填交易条件。',
        422,
      );
    const evidence = detail.evidence.filter((e) => leg.evidenceIds.includes(e.id));
    if (
      !evidence.some(
        (e) => (e.raw as { transactionHash?: string })?.transactionHash === transactionHash,
      )
    )
      throw new LedgerError(
        'TASK_TRANSACTION_NOT_REFERENCED',
        '该交易未被固定任务资金段引用。',
        422,
      );
    return {
      schemaVersion: 'zasv-task-context-v1',
      jobId: t.jobId,
      legId: leg.id,
      snapshotRunId: run.id,
      ruleVersion: detail.ruleVersion,
      expectedPayee: leg.payee,
      ...(leg.from ? { expectedMovementPayer: leg.from } : {}),
      expectedAmountAtomic18: leg.expectedAmount.atomic.value,
      evidenceIds: leg.evidenceIds,
      rawEvidence: evidence,
    };
  }
  app.get('/v1/task-conditions/:jobId', async (r) => {
    const query = r.query as { snapshotRunId: string; legId: string; transaction: string };
    if (Object.keys(query).sort().join(',') !== 'legId,snapshotRunId,transaction')
      throw new LedgerError('INVALID_TASK_REFERENCE', '任务条件只接受固定引用。', 400);
    const context = await taskContext(
      {
        jobId: (r.params as { jobId: string }).jobId,
        snapshotRunId: query.snapshotRunId,
        legId: query.legId,
      },
      parseTransactionInput(query.transaction),
    );
    const projection = Object.fromEntries(
      Object.entries(context).filter(([key]) => key !== 'rawEvidence'),
    );
    return {
      context: projection,
      scope: 'FIXED_REGISTERED_PROTOCOL_PROJECTION',
      priorAgreement: 'NOT_VERIFIED',
      rawEvidenceIncludedInReportBundle: true,
    };
  });
  app.get('/v1/verifier', () => ({
    schemaVersion: 'zasv-interface-v1',
    ruleVersion: VERIFIER_RULE,
    parserVersion: PARSER_VERSION,
    network: USDC_NETWORK,
    limits: {
      concurrentReads: 2,
      rpcPerSecond: 2,
      rpcPerVerification: 24,
      responseBytes: 8388608,
      deadlineMs: 45000,
      ownerDaily: 30,
      globalDaily: 200,
      maxReports: 1000,
      maxBundleBytes: 16777216,
      totalBundleBytes: 134217728,
    },
    readOnlyChain: true,
  }));
  app.post(
    '/v1/sessions',
    { bodyLimit: 1024, config: { rateLimit: { max: 10, timeWindow: 60000 } } },
    async (r, reply) => sessions.issue(r, reply),
  );
  app.get('/v1/verifier/examples', async () => ({
    examples: await read.examples(),
    scope: 'EXPLICITLY_PUBLISHED_FIXED_REPORTS',
    conditionProvenance: 'SEE_EACH_REPORT',
    startsChainWork: false,
  }));
  app.post(
    '/v1/verifications',
    { bodyLimit: 32768, config: { rateLimit: { max: 12, timeWindow: 60000 } } },
    async (r, reply) => {
      const owner = sessions.authorize(r);
      const repo = requireWriter();
      const body = r.body as { transaction?: unknown; expectation?: unknown; task?: unknown };
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some((k) => !['transaction', 'expectation', 'task'].includes(k)) ||
        typeof body.transaction !== 'string'
      )
        throw new LedgerError('INVALID_VERIFICATION', '只接受单笔交易和规范核对条件。', 400);
      const transactionHash = parseTransactionInput(body.transaction);
      let expectation = body.expectation === undefined ? null : parseExpectation(body.expectation);
      const context =
        body.task === undefined ? null : await taskContext(body.task, transactionHash);
      if (context) {
        if (
          !expectation ||
          expectation.expectedPayee !== context.expectedPayee ||
          expectation.expectedMovementPayer !== context.expectedMovementPayer ||
          expectation.amountMode !== 'EXACT' ||
          expectation.minAmountAtomic18 !== context.expectedAmountAtomic18 ||
          expectation.maxAmountAtomic18 !== context.expectedAmountAtomic18 ||
          expectation.deadline ||
          expectation.notBefore
        )
          throw new LedgerError(
            'TASK_CONDITIONS_CHANGED',
            '输入条件与固定任务投影不同，请用手填条件模式。',
            409,
          );
        expectation = { ...expectation, provenance: 'REGISTERED_TASK' };
      } else if (expectation?.provenance === 'REGISTERED_TASK')
        throw new LedgerError('TASK_PROVENANCE_REQUIRED', '登记任务条件必须由任务入口生成。', 400);
      const request = await repo.begin(owner, key(r), {
        operation: 'VERIFY',
        transactionHash,
        expectation,
        task: body.task ?? null,
      });
      if (!request.fresh) {
        if (request.status === 'COMPLETED')
          return {
            ...document(await read.get(request.report_id, owner, request.bundle_hash)),
            requestId: request.id,
          };
        return reply.code(request.status === 'RUNNING' ? 202 : 409).send({
          code: request.status === 'RUNNING' ? 'VERIFICATION_RUNNING' : 'VERIFICATION_FAILED',
          requestId: request.id,
          error: request.error_code ?? null,
        });
      }
      try {
        const observation = await collect(transactionHash);
        const bundle = buildReportBundle(
          { ...observation, ...(context ? { taskContext: context } : {}) },
          expectation,
        );
        await repo.complete(request.id, owner, bundle);
        return { ...document(bundle), requestId: request.id };
      } catch (e) {
        await repo.fail(
          request.id,
          owner,
          e instanceof LedgerError ? e.code : 'VERIFICATION_FAILED',
        );
        throw e;
      }
    },
  );
  app.get('/v1/verifications/:id', async (r) => {
    const id = (r.params as { id: string }).id;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
      throw new LedgerError('INVALID_REQUEST_ID', '核验请求编号无效。', 400);
    const owner = sessions.owner(r, true)!;
    const row = await read.request(id, owner);
    return {
      requestId: row.id,
      status: row.status,
      errorCode: row.error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      result:
        row.status === 'COMPLETED'
          ? document(await read.get(row.report_id, owner, row.bundle_hash))
          : null,
      startsChainWork: false,
    };
  });
  app.get('/v1/reports', async (r) => read.list(sessions.owner(r, true)!));
  app.get('/v1/reports/:id', async (r) => {
    const owner = sessions.owner(r);
    const bundle = await read.get(reportId(r), owner);
    return {
      ...document(bundle),
      ...(await read.access(bundle.report.reportId, bundle.bundleHash, owner)),
    };
  });
  app.get('/v1/reports/:id/bundle', async (r, reply) => {
    const bundle = await read.get(reportId(r), sessions.owner(r));
    return reply
      .header('content-disposition', `attachment; filename="${bundle.report.reportId}.json"`)
      .send(bundle);
  });
  app.post(
    '/v1/reports/:id/recheck',
    { bodyLimit: 1024, config: { rateLimit: { max: 6, timeWindow: 60000 } } },
    async (r, reply) => {
      const owner = sessions.authorize(r);
      const repo = requireWriter();
      const old = await read.owned(reportId(r), owner);
      const request = await repo.begin(owner, key(r), {
        operation: 'RECHECK',
        reportId: old.report.reportId,
      });
      if (!request.fresh) {
        if (request.status === 'COMPLETED')
          return {
            ...document(await read.get(request.report_id, owner, request.bundle_hash)),
            requestId: request.id,
          };
        return reply.code(request.status === 'RUNNING' ? 202 : 409).send({
          code: request.status === 'RUNNING' ? 'VERIFICATION_RUNNING' : 'VERIFICATION_FAILED',
          requestId: request.id,
        });
      }
      try {
        const bundle = buildReportBundle(
          {
            ...(await collect(old.report.transactionHash, true)),
            ...(old.observation.taskContext ? { taskContext: old.observation.taskContext } : {}),
          },
          old.report.expectation,
        );
        await repo.complete(request.id, owner, bundle);
        return {
          ...document(bundle),
          requestId: request.id,
          previousReportId: old.report.reportId,
          factsChanged: old.report.factsHash !== bundle.report.factsHash,
        };
      } catch (e) {
        await repo.fail(
          request.id,
          owner,
          e instanceof LedgerError ? e.code : 'VERIFICATION_FAILED',
        );
        throw e;
      }
    },
  );
  const publicPreview = async (r: FastifyRequest) => {
    const owner = sessions.authorize(r);
    const old = await read.owned(reportId(r), owner);
    const expectation = old.report.expectation ? structuredClone(old.report.expectation) : null;
    if (expectation) delete expectation.contextRef;
    const bundle = buildReportBundle(old.observation, expectation);
    return { owner, bundle };
  };
  app.post('/v1/reports/:id/share-preview', { bodyLimit: 1024 }, async (r) => {
    const { bundle } = await publicPreview(r);
    return {
      report: bundle.report,
      bundle,
      bundleHash: bundle.bundleHash,
      removedFields: ['expectation.contextRef'],
      publicFields: [
        'raw chain transaction and receipt',
        'payee/payer/amount/time/selection conditions',
        'source alias and acquisition time',
        'per-condition checks',
      ],
      warning:
        '公开后固定版本不能撤回，并可能进入公开示例列表；核对条件是用户输入，不证明事先约定。',
    };
  });
  app.post(
    '/v1/reports/:id/publish',
    { bodyLimit: 1024, config: { rateLimit: { max: 6, timeWindow: 60000 } } },
    async (r) => {
      const { owner, bundle } = await publicPreview(r);
      const repo = requireWriter();
      const body = r.body as { confirmReportId?: string; confirmBundleHash?: string };
      if (
        !body ||
        Object.keys(body).sort().join(',') !== 'confirmBundleHash,confirmReportId' ||
        body.confirmReportId !== bundle.report.reportId ||
        body.confirmBundleHash !== bundle.bundleHash
      )
        throw new LedgerError(
          'SHARE_CONFIRMATION_REQUIRED',
          '必须确认完整预览的报告与原件版本。',
          409,
        );
      const request = await repo.begin(owner, key(r), {
        operation: 'PUBLISH',
        reportId: bundle.report.reportId,
        bundleHash: bundle.bundleHash,
      });
      if (request.fresh) {
        try {
          await repo.complete(request.id, owner, bundle);
        } catch (e) {
          await repo.fail(request.id, owner, 'PUBLICATION_FAILED');
          throw e;
        }
      } else if (request.status !== 'COMPLETED')
        throw new LedgerError('PUBLICATION_STATE_CONFLICT', '分享请求尚未完成。', 409);
      await repo.publish(bundle.report.reportId, owner, bundle.bundleHash);
      return {
        reportId: bundle.report.reportId,
        bundleHash: bundle.bundleHash,
        visibility: 'PUBLIC',
        path: `/?report=${bundle.report.reportId}`,
      };
    },
  );
  app.post(
    '/v1/replay',
    { bodyLimit: 16777216, config: { rateLimit: { max: 6, timeWindow: 60000 } } },
    async (r) => {
      sessions.authorize(r);
      return replayReportBundle(r.body);
    },
  );
}
