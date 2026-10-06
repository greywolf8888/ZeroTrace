import type { LedgerStore } from './storage.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { hashPayload } from '@zerotrace/evidence';
import {
  DEPLOYMENT,
  NAVIGATION,
  LedgerError,
  RULE_VERSION,
  address,
  decimal,
  emptyCoverage,
  known,
  unknown,
} from '@zerotrace/arc-task-ledger';
import { publicCoverage, publicDetail, publicRow } from './contract.js';

interface Cursor {
  run: string;
  filter: string;
  last: string;
  kind: 'jobs' | 'timeline';
}
export function cursorCodec(secret: string) {
  if (Buffer.byteLength(secret) < 32)
    throw new LedgerError('CONFIG_INVALID', '分页签名密钥至少需要 32 字节。');
  const signature = (value: string) =>
    createHmac('sha256', secret).update(value).digest('base64url');
  return {
    encode(value: Cursor) {
      const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
      return `${payload}.${signature(payload)}`;
    },
    decode(value: string): Cursor {
      if (value.length > 2048 || !/^[\w-]+\.[\w-]+$/.test(value))
        throw new LedgerError('INVALID_CURSOR', '分页游标格式不合法。', 400);
      const [payload, sig] = value.split('.');
      const expected = signature(payload!);
      const received = Buffer.from(sig!);
      if (
        received.length !== Buffer.byteLength(expected) ||
        !timingSafeEqual(received, Buffer.from(expected))
      )
        throw new LedgerError('INVALID_CURSOR', '分页游标签名不合法。', 400);
      let cursor: Cursor;
      try {
        cursor = JSON.parse(Buffer.from(payload!, 'base64url').toString());
      } catch {
        throw new LedgerError('INVALID_CURSOR', '分页游标内容不合法。', 400);
      }
      if (
        !cursor ||
        typeof cursor.run !== 'string' ||
        cursor.run.length > 100 ||
        !/^[a-zA-Z0-9_-]+$/.test(cursor.run) ||
        typeof cursor.filter !== 'string' ||
        !/^[a-f0-9]{64}$/.test(cursor.filter) ||
        typeof cursor.last !== 'string' ||
        !['jobs', 'timeline'].includes(cursor.kind) ||
        Object.keys(cursor).length !== 4
      )
        throw new LedgerError('INVALID_CURSOR', '分页游标结构不合法。', 400);
      decimal(cursor.last);
      return cursor;
    },
  };
}
const lifecycleStates = new Set([
  'OPEN',
  'TAKEN',
  'SUBMITTED',
  'REJECTION_PENDING',
  'DISPUTED',
  'TERMINAL_UNKNOWN',
  'APPROVED',
  'CANCELLED',
  'EXPIRED',
  'REJECTED',
  'DISPUTE_WORKER',
  'DISPUTE_POSTER',
  'TIMEOUT_SPLIT',
  'EXTERNAL_REFUND_RECONCILED',
]);
const cashStates = new Set([
  'NOT_APPLICABLE',
  'NONE_OBSERVED',
  'CONFIRMED_DIRECT',
  'PARKED',
  'PARTIAL',
  'WITHDRAWAL_OBSERVED_ACCOUNT_LEVEL',
  'VERIFIED_SEQUENCE_DERIVED',
  'UNKNOWN',
  'CONFLICT',
]);
export async function createLedgerApp(
  store: LedgerStore,
  secret: string,
  requestStore?: LedgerStore,
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 4096,
    routerOptions: { maxParamLength: 200 },
    requestTimeout: 10000,
  });
  const cursors = cursorCodec(secret);
  await app.register(rateLimit, { max: 120, timeWindow: 60000 });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('cache-control', 'no-store');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof LedgerError)
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message, retryable: error.status === 503 });
    if ((error as { statusCode?: number }).statusCode === 429)
      return reply
        .code(429)
        .send({ code: 'RATE_LIMITED', message: '查询频率过高，请稍后重试。', retryable: true });
    return reply.code(503).send({
      code: 'STORAGE_UNAVAILABLE',
      message: '持久存储暂不可用，请检查本组件数据库与迁移状态。',
      retryable: true,
    });
  });
  app.get('/healthz', () => ({
    status: 'UP',
    components: { readOnly: true, version: RULE_VERSION },
  }));
  app.get('/v1/registry', () => ({
    chainId: DEPLOYMENT.chainId,
    adapter: DEPLOYMENT.adapter,
    navigation: NAVIGATION,
    ruleVersion: RULE_VERSION,
  }));
  app.get('/readyz', async (_request, reply) => {
    const ready = await store.ready();
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'UP' : 'DOWN',
      components: { database: ready ? 'UP' : 'DOWN', mainnet: '独立查询覆盖接口核验' },
    });
  });
  const requireRun = async (id?: string) => {
    const run = await store.getRunMetadata(id);
    if (!run)
      throw new LedgerError(
        id ? 'SNAPSHOT_EXPIRED' : 'STATE_NOT_AVAILABLE',
        id ? '快照不存在或已过期，请重新加载列表。' : '尚无经核验的已发布快照，请运行采集 worker。',
        id ? 410 : 503,
      );
    if (Date.parse(run.expiresAt) <= Date.now())
      throw new LedgerError('SNAPSHOT_EXPIRED', '快照已过期，请重新加载列表。', 410);
    return run;
  };
  app.get('/v1/jobs', async (request) => {
    const q = request.query as Record<string, string>;
    if (Object.values(q).some((value) => typeof value !== 'string' || value.length > 2048))
      throw new LedgerError('INVALID_QUERY', '查询参数类型或长度不合法。', 400);
    if (
      Object.keys(q).some(
        (key) =>
          ![
            'limit',
            'cursor',
            'address',
            'role',
            'snapshotRunId',
            'lifecycle',
            'cashState',
          ].includes(key),
      )
    )
      throw new LedgerError('INVALID_QUERY', '查询参数不受支持。', 400);
    const limit = q.limit === undefined ? 30 : Number(q.limit);
    if (!/^\d+$/.test(q.limit ?? '30') || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new LedgerError('INVALID_LIMIT', '每页条数必须在 1–100 之间。', 400);
    const filter = {
      address: q.address === undefined ? undefined : address(q.address),
      lifecycle: q.lifecycle,
      cashState: q.cashState,
      role: q.role,
    };
    if (
      (q.lifecycle !== undefined && !lifecycleStates.has(q.lifecycle)) ||
      (q.cashState !== undefined && !cashStates.has(q.cashState))
    )
      throw new LedgerError('INVALID_FILTER', '业务或现金状态不合法。', 400);
    if (q.role !== undefined && (!['poster', 'worker', 'all'].includes(q.role) || !q.address))
      throw new LedgerError('INVALID_FILTER', '地址角色筛选必须带完整地址，角色不受支持。', 400);
    const digest = hashPayload(filter);
    const cursor = q.cursor ? cursors.decode(q.cursor) : undefined;
    if (cursor && (cursor.kind !== 'jobs' || cursor.filter !== digest))
      throw new LedgerError('CURSOR_FILTER_MISMATCH', '分页游标与当前筛选条件不一致。', 400);
    if (cursor && q.snapshotRunId && cursor.run !== q.snapshotRunId)
      throw new LedgerError('CURSOR_FILTER_MISMATCH', '游标与快照不一致。', 400);
    const run = await requireRun(cursor?.run ?? q.snapshotRunId);
    const rows = await store.getJobPage(run.id, limit, cursor?.last, filter);
    const items = rows.slice(0, limit);
    const next =
      rows.length > limit
        ? cursors.encode({
            run: run.id,
            filter: digest,
            last: items.at(-1)!.job.jobId,
            kind: 'jobs',
          })
        : undefined;
    const attempt = await store.lastSync();
    return {
      snapshotRunId: run.id,
      snapshot: run.snapshot,
      items: items.map((row) => publicRow(row.job, row.evidenceIds)),
      nextCursor: next ?? null,
      coverage: publicCoverage(run.coverage),
      historyRange: run.historyRange
        ? known(run.historyRange)
        : unknown('本快照未声明连续历史窗口。'),
      datasource: 'stored-replay',
      freshness: {
        capturedAt: run.snapshot.observedAt,
        ageSeconds: Math.floor((Date.now() - Date.parse(run.snapshot.observedAt)) / 1000),
        state:
          attempt && !attempt.success
            ? 'provider-down'
            : Date.now() - Date.parse(run.snapshot.observedAt) > 3600000
              ? 'stale'
              : 'known',
      },
    };
  });
  app.get('/v1/jobs/:chainId/:adapter/:jobId', async (request, reply) => {
    const params = request.params as { chainId: string; adapter: string; jobId: string };
    const q = request.query as Record<string, string>;
    if (Object.values(q).some((value) => typeof value !== 'string' || value.length > 2048))
      throw new LedgerError('INVALID_QUERY', '详情查询参数类型或长度不合法。', 400);
    if (params.chainId !== DEPLOYMENT.chainId || address(params.adapter) !== DEPLOYMENT.adapter)
      throw new LedgerError('UNSUPPORTED_DEPLOYMENT', '仅支持已登记的 Arc 主网部署。', 422);
    decimal(params.jobId);
    if (
      Object.keys(q).some(
        (key) => !['snapshotRunId', 'timelineCursor', 'timelineLimit', 'format'].includes(key),
      ) ||
      (q.format !== undefined && q.format !== 'json')
    )
      throw new LedgerError('INVALID_QUERY', '详情查询参数不受支持。', 400);
    const limit = Number(q.timelineLimit ?? 200);
    if (
      !/^\d+$/.test(q.timelineLimit ?? '200') ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200
    )
      throw new LedgerError('INVALID_LIMIT', '时间线每页最多 200 条。', 400);
    const cursor = q.timelineCursor ? cursors.decode(q.timelineCursor) : undefined;
    const filter = hashPayload({ jobId: params.jobId });
    if (
      cursor &&
      (cursor.kind !== 'timeline' ||
        cursor.filter !== filter ||
        (q.snapshotRunId && q.snapshotRunId !== cursor.run))
    )
      throw new LedgerError('CURSOR_FILTER_MISMATCH', '时间线游标与当前任务或快照不一致。', 400);
    const run = await requireRun(cursor?.run ?? q.snapshotRunId);
    const detail = await store.getJobDetail(run.id, params.jobId);
    if (!detail)
      throw new LedgerError(
        run.coverage.jobEnumeration === 'complete'
          ? 'NOT_IN_ENUMERATED_SET'
          : 'STATE_NOT_AVAILABLE',
        run.coverage.jobEnumeration === 'complete'
          ? '该任务不在此部署的已核验任务集合中。'
          : '当前枚举不完整，无法确定该任务是否存在。',
        run.coverage.jobEnumeration === 'complete' ? 404 : 503,
      );
    const start = cursor ? Number(cursor.last) : 0;
    if (!Number.isSafeInteger(start))
      throw new LedgerError('INVALID_CURSOR', '时间线游标超出范围。', 400);
    const timeline = detail.timeline.slice(start, start + limit);
    const next =
      start + limit < detail.timeline.length
        ? known(
            cursors.encode({ run: run.id, filter, last: String(start + limit), kind: 'timeline' }),
          )
        : unknown<string>('已到当前快照时间线末页。');
    if (q.format === 'json')
      reply.header('content-disposition', `attachment; filename="arc-task-${params.jobId}.json"`);
    return {
      ...publicDetail(detail),
      evidenceRequest: (await store.evidenceRequest(params.jobId)) ?? null,
      timeline,
      nextTimelineCursor: next.state === 'known' ? next.value : null,
      snapshotRunId: run.id,
      datasource: 'stored-replay',
      snapshotTasks: (await store.getJobPage(run.id, 20))
        .slice(0, 20)
        .map((row) => publicRow(row.job, row.evidenceIds)),
    };
  });
  app.post(
    '/v1/jobs/:chainId/:adapter/:jobId/evidence-requests',
    { config: { rateLimit: { max: 6, timeWindow: 3600000 } } },
    async (request, reply) => {
      const p = request.params as { chainId: string; adapter: string; jobId: string };
      if (p.chainId !== DEPLOYMENT.chainId || address(p.adapter) !== DEPLOYMENT.adapter)
        throw new LedgerError('UNSUPPORTED_DEPLOYMENT', '仅支持已登记 Arc 主网部署。', 422);
      decimal(p.jobId);
      if (
        Object.keys((request.body ?? {}) as object).length ||
        Object.keys((request.query ?? {}) as object).length
      )
        throw new LedgerError('INVALID_QUERY', '补证请求不接受自定义区间、URL、合约或说明。', 400);
      if (!requestStore)
        throw new LedgerError(
          'REQUEST_UNAVAILABLE',
          '当前服务未配置受限补证角色，已有查询继续可用。',
          503,
        );
      const r = await requireRun();
      const detail = await store.getJobDetail(r.id, p.jobId);
      if (!detail)
        throw new LedgerError('NOT_IN_ENUMERATED_SET', '该任务未在当前已采集范围内。', 404);
      const queued = await requestStore.enqueueEvidence(detail, r.id, await store.coveredRanges());
      return reply.code(202).send({
        request: queued,
        message: queued.plan?.from
          ? '已登记有界补证；完成扫描与找到新证据分别报告，原固定快照保持不变。'
          : (queued.plan?.reason ?? '补证目标暂无法定位。'),
      });
    },
  );
  app.get('/v1/coverage', async () => {
    const run = await store.getRunMetadata();
    const checkpoint = await store.currentCheckpoint(DEPLOYMENT.adapter);
    const attempt = await store.lastSync();
    return {
      network: 'arc-mainnet',
      adapter: DEPLOYMENT.adapter,
      lastSuccessfulSync: run?.snapshot.observedAt ?? null,
      stateHead: run ? known(run.snapshot.blockNumber) : unknown('当前状态不可用。'),
      historyHead: checkpoint ? known(checkpoint.head) : unknown('尚无连续历史水位。'),
      historyRange: run?.historyRange ? known(run.historyRange) : unknown('尚无声明窗口验收范围。'),
      coverage: publicCoverage(run?.coverage ?? emptyCoverage()),
      gaps: (run?.errors ?? ['尚无已发布快照。']).map((reason) => ({ reason })),
      datasource: 'stored-replay',
      ruleVersion: RULE_VERSION,
      sourceSet: run?.snapshot.sourceSet ?? [],
      freshness:
        attempt && !attempt.success
          ? 'provider-down'
          : run
            ? Date.now() - Date.parse(run.snapshot.observedAt) > 3600000
              ? 'stale'
              : 'known'
            : 'unavailable',
      lastAttempt: attempt ?? null,
      formalMode:
        run &&
        (!attempt || attempt.success) &&
        Object.values(run.coverage).every((v) => v === 'complete')
          ? 'AVAILABLE'
          : 'FAIL_CLOSED_COVERAGE_INSUFFICIENT',
    };
  });
  return app;
}
