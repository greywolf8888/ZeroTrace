import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LedgerStore } from '../../../apps/arc-task-ledger-api/src/storage.js';
import { createLedgerApp } from '../../../apps/arc-task-ledger-api/src/app.js';
import { verifierRepository } from '../../../apps/arc-task-ledger-api/src/verifier-storage.js';
import { buildReportBundle } from '../../../packages/arc-task-ledger/src/verifier-report.js';
import { verifierObservation, verifierCondition } from '../fixtures/verifier-observation.js';
import { configureRequestRole } from '../../../infra/northflank/migration-bootstrap.mjs';
import { run, POSTER, WORKER, TX, snapshot } from '../fixtures/helpers.js';
import { rawEvidence } from '../../../packages/arc-task-ledger/src/protocol.js';
import { known, amount, RULE_VERSION } from '../../../packages/arc-task-ledger/src/types.js';
const url = process.env.ARC_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/arc_task_ledger_test')
  throw Error('只允许隔离真实测试库 arc_task_ledger_test');
const store = new LedgerStore(url);
beforeAll(() => store.migrate());
beforeEach(() =>
  store.pool.query(
    'TRUNCATE arc_task_ledger_v1.zasv_publications,arc_task_ledger_v1.zasv_ownership,arc_task_ledger_v1.zasv_bundles,arc_task_ledger_v1.zasv_reports,arc_task_ledger_v1.zasv_requests',
  ),
);
afterAll(() => store.close());
const sdk = { 'x-arc-client': 'zasv-sdk-v1' };
const secret = 'test-only-settlement-session-secret-32-bytes';
describe('真实持久核验权限与原子性', () => {
  it('会话报告列表和管理元数据只暴露当前所有者；公开访问不授予管理权也不查链', async () => {
    const observe = vi.fn(async () => verifierObservation());
    const app = await createLedgerApp(store, secret, store, undefined, observe);
    try {
      const owner = (
        await app.inject({ method: 'POST', url: '/v1/sessions', headers: sdk })
      ).json();
      const stranger = (
        await app.inject({ method: 'POST', url: '/v1/sessions', headers: sdk })
      ).json();
      const headers = {
        ...sdk,
        authorization: 'Bearer ' + owner.sessionToken,
        'x-zasv-csrf': owner.csrfToken,
        'idempotency-key': 'ui-history-owner-001',
      };
      const other = { ...sdk, authorization: 'Bearer ' + stranger.sessionToken };
      const saved = (
        await app.inject({
          method: 'POST',
          url: '/v1/verifications',
          headers,
          payload: { transaction: TX, expectation: verifierCondition() },
        })
      ).json();
      const path = '/v1/reports/' + saved.report.reportId;
      expect((await app.inject({ url: path, headers })).json()).toMatchObject({
        canManage: true,
        visibility: 'PRIVATE',
      });
      expect((await app.inject({ url: '/v1/reports', headers })).json()).toMatchObject({
        scope: 'CURRENT_SESSION',
        startsChainWork: false,
        reports: [{ report_id: saved.report.reportId, public: false }],
      });
      expect((await app.inject({ url: '/v1/reports', headers: other })).json().reports).toEqual([]);
      expect((await app.inject('/v1/reports')).statusCode).toBe(401);
      expect((await app.inject({ url: path, headers: other })).statusCode).toBe(404);
      const preview = (
        await app.inject({
          method: 'POST',
          url: path + '/share-preview',
          headers: { ...headers, 'idempotency-key': 'ui-history-preview-001' },
          payload: {},
        })
      ).json();
      const published = await app.inject({
        method: 'POST',
        url: path + '/publish',
        headers: { ...headers, 'idempotency-key': 'ui-history-publish-001' },
        payload: {
          confirmReportId: preview.report.reportId,
          confirmBundleHash: preview.bundleHash,
        },
      });
      expect(published.statusCode).toBe(200);
      const publicPath = '/v1/reports/' + preview.report.reportId;
      expect((await app.inject({ url: publicPath, headers: other })).json()).toMatchObject({
        canManage: false,
        visibility: 'PUBLIC',
      });
      expect((await app.inject({ url: publicPath, headers })).json()).toMatchObject({
        canManage: true,
        visibility: 'PUBLIC',
      });
      expect(observe).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
  it('接近容量的两个请求不能突破1000报告硬限额，失败保存保持原子性', async () => {
    await store.pool.query(
      "INSERT INTO arc_task_ledger_v1.zasv_reports(report_id,document) SELECT 'test_only_capacity_'||n,'{\"testOnly\":true}'::jsonb FROM generate_series(1,999) n",
    );
    const repo = verifierRepository(store),
      owner = 'test-only-capacity-owner';
    const first = await repo.begin(owner, 'capacity-request-one', { n: 1 }),
      second = await repo.begin(owner, 'capacity-request-two', { n: 2 });
    await repo.complete(
      first.id,
      owner,
      buildReportBundle(verifierObservation(), verifierCondition()),
    );
    const condition = { ...verifierCondition(), minAmountAtomic18: '2', maxAmountAtomic18: '2' };
    await expect(
      repo.complete(second.id, owner, buildReportBundle(verifierObservation(), condition)),
    ).rejects.toMatchObject({ code: 'REPORT_CAPACITY' });
    expect(
      (await store.pool.query('SELECT count(*)::int AS n FROM arc_task_ledger_v1.zasv_reports'))
        .rows[0].n,
    ).toBe(1000);
    expect(
      (
        await store.pool.query('SELECT status FROM arc_task_ledger_v1.zasv_requests WHERE id=$1', [
          second.id,
        ])
      ).rows[0].status,
    ).toBe('RUNNING');
  });
  it('请求状态读取只认会话所有者；RUNNING/FAILED/COMPLETED均不触发链读取或回收', async () => {
    const observe = vi.fn(async () => verifierObservation());
    const app = await createLedgerApp(store, secret, store, undefined, observe);
    try {
      const s = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: sdk })).json();
      const headers = {
        ...sdk,
        authorization: 'Bearer ' + s.sessionToken,
        'x-zasv-csrf': s.csrfToken,
        'idempotency-key': 'status-contract-request-001',
      };
      const verified = await app.inject({
        method: 'POST',
        url: '/v1/verifications',
        headers,
        payload: { transaction: TX, expectation: verifierCondition() },
      });
      expect(verified.statusCode).toBe(200);
      const row = (
        await store.pool.query(
          'SELECT id,owner_hash FROM arc_task_ledger_v1.zasv_requests WHERE idempotency_key=$1',
          [headers['idempotency-key']],
        )
      ).rows[0];
      const read = await app.inject({ url: '/v1/verifications/' + row.id, headers });
      expect(read.json().status).toBe('COMPLETED');
      expect(verified.json().requestId).toBe(row.id);
      expect(read.json().result.report.reportId).toBe(verified.json().report.reportId);
      expect(read.json().startsChainWork).toBe(false);
      expect((await app.inject('/v1/verifications/' + row.id)).statusCode).toBe(401);
      const stranger = (
        await app.inject({ method: 'POST', url: '/v1/sessions', headers: sdk })
      ).json();
      expect(
        (
          await app.inject({
            url: '/v1/verifications/' + row.id,
            headers: { ...sdk, authorization: 'Bearer ' + stranger.sessionToken },
          })
        ).statusCode,
      ).toBe(404);
      const repo = verifierRepository(store);
      const pending = await repo.begin(row.owner_hash, 'status-running-request-001', {
        testOnly: true,
      });
      expect(
        (await app.inject({ url: '/v1/verifications/' + pending.id, headers })).json().status,
      ).toBe('RUNNING');
      await repo.fail(pending.id, row.owner_hash, 'TEST_ONLY_FAILURE');
      const failed = (await app.inject({ url: '/v1/verifications/' + pending.id, headers })).json();
      expect(failed.status).toBe('FAILED');
      expect(failed.errorCode).toBe('TEST_ONLY_FAILURE');
      expect(observe).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
  it('固定任务协议条件进入真实持久报告；改金额、无来源和未知归属不伪造协议条件', async () => {
    const observation = verifierObservation();
    const raw = rawEvidence(
      observation.raw.receipt,
      snapshot,
      'test-task-receipt',
      '仅测试合成回执',
    );
    const fixture = run('verifier_registered_task_fixture_' + randomUUID(), ['8']);
    const detail = fixture.jobs[0]!;
    detail.evidence = [raw];
    detail.settlementLegs = [
      {
        id: 'test_leg',
        from: POSTER,
        payee: WORKER,
        role: 'WORKER',
        kind: 'REWARD',
        expectedAmount: amount(known('1000000000000000000')),
        observedAmount: amount(known('1000000000000000000')),
        parkedAmount: amount(known('0')),
        attribution: 'DIRECT',
        obligationIds: [],
        evidenceIds: [raw.id],
        ruleVersion: RULE_VERSION,
      },
    ];
    await store.publish(fixture, [raw]);
    const observe = vi.fn(async () => observation);
    const app = await createLedgerApp(store, secret, store, undefined, observe);
    try {
      const task = { jobId: '8', snapshotRunId: fixture.id, legId: 'test_leg' };
      const query = new URLSearchParams({
        snapshotRunId: fixture.id,
        legId: 'test_leg',
        transaction: TX,
      });
      expect(
        (await app.inject('/v1/task-conditions/8?' + query)).json().context.expectedAmountAtomic18,
      ).toBe('1000000000000000000');
      expect(observe).not.toHaveBeenCalled();
      const s = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: sdk })).json();
      const headers = {
        ...sdk,
        authorization: 'Bearer ' + s.sessionToken,
        'x-zasv-csrf': s.csrfToken,
        'idempotency-key': 'registered-task-request-001',
      };
      const expectation = { ...verifierCondition(), expectedMovementPayer: POSTER };
      const response = await app.inject({
        method: 'POST',
        url: '/v1/verifications',
        headers,
        payload: { transaction: TX, expectation, task },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().evaluation.outcome).toBe('MATCHED');
      expect(response.json().report.taskBinding.jobId).toBe('8');
      expect(response.json().report.expectation.provenance).toBe('REGISTERED_TASK');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/verifications',
            headers: { ...headers, 'idempotency-key': 'registered-task-wrong-002' },
            payload: {
              transaction: TX,
              expectation: { ...expectation, minAmountAtomic18: '2', maxAmountAtomic18: '2' },
              task,
            },
          })
        ).statusCode,
      ).toBe(409);
      expect(observe).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
  it('私有报告、幂等、反例版本、显式分享脱敏、GET不查链、在线重查保留原版', async () => {
    const observe = vi.fn(async () => verifierObservation());
    const app = await createLedgerApp(store, secret, store, undefined, observe);
    try {
      const issue = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: sdk,
        payload: {},
      });
      expect(issue.statusCode).toBe(200);
      const session = issue.json();
      const headers = {
        ...sdk,
        authorization: 'Bearer ' + session.sessionToken,
        'x-zasv-csrf': session.csrfToken,
        'idempotency-key': 'verify-idempotent-001',
      };
      const expectation = { ...verifierCondition(), contextRef: 'PRIVATE_ORDER_DO_NOT_PUBLISH' };
      const payload = { transaction: verifierObservation().transactionHash, expectation };
      const first = await app.inject({
        method: 'POST',
        url: '/v1/verifications',
        headers,
        payload,
      });
      expect(first.statusCode).toBe(200);
      const saved = first.json();
      const path = '/v1/reports/' + saved.report.reportId;
      expect(saved.evaluation.outcome).toBe('MATCHED');
      expect((await app.inject(path)).statusCode).toBe(404);
      const other = (
        await app.inject({ method: 'POST', url: '/v1/sessions', headers: sdk })
      ).json();
      expect(
        (
          await app.inject({
            url: path,
            headers: { authorization: 'Bearer ' + other.sessionToken },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: '/v1/verifications', headers, payload })).json()
          .report.reportId,
      ).toBe(saved.report.reportId);
      expect(observe).toHaveBeenCalledTimes(1);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/verifications',
            headers,
            payload: {
              ...payload,
              expectation: { ...expectation, minAmountAtomic18: '2', maxAmountAtomic18: '2' },
            },
          })
        ).statusCode,
      ).toBe(409);
      const wrong = await app.inject({
        method: 'POST',
        url: '/v1/verifications',
        headers: { ...headers, 'idempotency-key': 'verify-wrong-amount-002' },
        payload: {
          ...payload,
          expectation: { ...expectation, minAmountAtomic18: '2', maxAmountAtomic18: '2' },
        },
      });
      expect(wrong.json().evaluation.outcome).toBe('MISMATCHED');
      expect(wrong.json().report.reportId).not.toBe(saved.report.reportId);
      const preview = await app.inject({
        method: 'POST',
        url: path + '/share-preview',
        headers,
        payload: {},
      });
      expect(preview.body).not.toContain('PRIVATE_ORDER');
      expect(preview.statusCode).toBe(200);
      expect(preview.json().bundle.bundleHash).toBe(preview.json().bundleHash);
      expect((await app.inject('/v1/verifier/examples')).json().examples).toEqual([]);
      const publicVersion = preview.json();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: path + '/publish',
            headers,
            payload: {
              confirmReportId: saved.report.reportId,
              confirmBundleHash: publicVersion.bundleHash,
            },
          })
        ).statusCode,
      ).toBe(409);
      const publish = await app.inject({
        method: 'POST',
        url: path + '/publish',
        headers: { ...headers, 'idempotency-key': 'publish-fixed-version-003' },
        payload: {
          confirmReportId: publicVersion.report.reportId,
          confirmBundleHash: publicVersion.bundleHash,
        },
      });
      expect(publish.statusCode).toBe(200);
      const publicRead = await app.inject('/v1/reports/' + publish.json().reportId + '/bundle');
      expect(publicRead.statusCode).toBe(200);
      expect(publicRead.body).not.toContain('PRIVATE_ORDER');
      expect((await app.inject('/v1/verifier/examples')).json().examples).toEqual([
        { reportId: publish.json().reportId, transactionHash: TX },
      ]);
      expect((await app.inject({ url: path + '/bundle', headers })).statusCode).toBe(200);
      expect(observe).toHaveBeenCalledTimes(2);
      const recheck = await app.inject({
        method: 'POST',
        url: path + '/recheck',
        headers: { ...headers, 'idempotency-key': 'recheck-preserve-004' },
        payload: {},
      });
      expect(recheck.statusCode).toBe(200);
      expect(observe).toHaveBeenCalledTimes(3);
      expect((await app.inject({ url: path, headers })).json().report.reportId).toBe(
        saved.report.reportId,
      );
      expect(
        (await store.pool.query('SELECT count(*)::int AS n FROM arc_task_ledger_v1.zasv_reports'))
          .rows[0].n,
      ).toBe(3);
    } finally {
      await app.close();
    }
  });
  it('CSRF、来源、会话、伪登记任务在链读取前拒绝', async () => {
    const observe = vi.fn(async () => verifierObservation());
    const app = await createLedgerApp(store, secret, store, undefined, observe);
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/sessions',
            headers: { origin: 'https://attacker.example' },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: 'POST', url: '/v1/verifications', headers: sdk, payload: {} }))
          .statusCode,
      ).toBe(401);
      const s = (await app.inject({ method: 'POST', url: '/v1/sessions', headers: sdk })).json();
      const headers = {
        ...sdk,
        authorization: 'Bearer ' + s.sessionToken,
        'idempotency-key': 'security-test-request-01',
      };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/verifications',
            headers,
            payload: { transaction: verifierObservation().transactionHash },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/verifications',
            headers: { ...headers, 'x-zasv-csrf': s.csrfToken },
            payload: {
              transaction: verifierObservation().transactionHash,
              expectation: { ...verifierCondition(), provenance: 'REGISTERED_TASK' },
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(observe).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('数据库拒绝覆盖/删除，坏报告事务回滚，账户配额与并发约束真实生效', async () => {
    const repo = verifierRepository(store);
    const owner = 'test-owner-opaque';
    const request = await repo.begin(owner, 'first-request-001', { a: 1 });
    const b = buildReportBundle(verifierObservation(), verifierCondition());
    await repo.complete(request.id, owner, b);
    await expect(
      store.pool.query(
        'UPDATE arc_task_ledger_v1.zasv_reports SET document=$1 WHERE report_id=$2',
        [{}, b.report.reportId],
      ),
    ).rejects.toThrow('ZASV_IMMUTABLE');
    await expect(store.pool.query('DELETE FROM arc_task_ledger_v1.zasv_bundles')).rejects.toThrow(
      'ZASV_IMMUTABLE',
    );
    const second = await repo.begin(owner, 'second-request-002', { a: 2 });
    const corrupt = structuredClone(b);
    corrupt.report.evaluation!.outcome = 'MISMATCHED';
    await expect(repo.complete(second.id, owner, corrupt)).rejects.toThrow('不可覆盖');
    expect(
      (
        await store.pool.query('SELECT status FROM arc_task_ledger_v1.zasv_requests WHERE id=$1', [
          second.id,
        ])
      ).rows[0].status,
    ).toBe('RUNNING');
    const third = await repo.begin(owner, 'third-request-003', { a: 3 });
    await expect(repo.begin('other-owner', 'fourth-request-004', { a: 4 })).rejects.toThrow('配额');
    await repo.fail(second.id, owner, 'TEST_ROLLBACK');
    await repo.fail(third.id, owner, 'TEST_RELEASE');
    for (let n = 3; n < 30; n++) {
      const r = await repo.begin(owner, 'daily-request-' + String(n).padStart(5, '0'), { n });
      await repo.fail(r.id, owner, 'TEST_ONLY');
    }
    await expect(repo.begin(owner, 'daily-request-over-limit', { n: 31 })).rejects.toThrow('配额');
  });
  it('现有请求角色只能追加报告与更新请求状态，不能修改旧金融表或报告输入', async () => {
    await configureRequestRole(store.pool, 'a'.repeat(64));
    await store.transaction(async (c) => {
      await c.query('SET LOCAL ROLE atl_evidence_requester');
      const rights = await c.query(
        "SELECT has_table_privilege(current_user,'arc_task_ledger_v1.zasv_reports','INSERT') AS insert,has_table_privilege(current_user,'arc_task_ledger_v1.zasv_reports','UPDATE') AS update,has_column_privilege(current_user,'arc_task_ledger_v1.zasv_requests','input_hash','UPDATE') AS input,has_table_privilege(current_user,'arc_task_ledger_v1.jobs','INSERT') AS old_insert",
      );
      expect(rights.rows[0]).toEqual({
        insert: true,
        update: false,
        input: false,
        old_insert: false,
      });
    });
  });
});
