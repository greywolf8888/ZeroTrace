import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { LedgerStore } from '../../../apps/arc-task-ledger-api/src/storage.js';
import { DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
import { rawEvidence } from '../../../packages/arc-task-ledger/src/protocol.js';
import { createLedgerApp } from '../../../apps/arc-task-ledger-api/src/app.js';
import { run, snapshot, meta } from '../fixtures/helpers.js';
import { ArcReader } from '../../../packages/arc-task-ledger/src/reader.js';
import { scanHistory } from '../../../packages/arc-task-ledger/src/worker.js';
import type { JsonRpcTransport } from '@zerotrace/chain-adapters/transport';
import { fetchLedgerJob } from '../../../examples/arc-task-ledger/consumer.js';
const url = process.env.ARC_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/arc_task_ledger_test')
  throw new Error('必须显式配置专用 arc_task_ledger_test 测试数据库，不允许跳过真实持久门禁。');
const store = new LedgerStore(url);
const secret = 'test-only-cursor-secret-with-32-bytes';
beforeAll(async () => {
  await store.migrate();
});
beforeEach(async () => {
  await store.pool.query(
    'TRUNCATE arc_task_ledger_v1.receipts,arc_task_ledger_v1.jobs,arc_task_ledger_v1.runs,arc_task_ledger_v1.observations,arc_task_ledger_v1.segments,arc_task_ledger_v1.checkpoints,arc_task_ledger_v1.sync_attempts',
  );
});
afterAll(async () => {
  await store.close();
});
describe('真实 PostgreSQL 与 API 集成', () => {
  it('worker 租约连接被终止后不能继续写入', async () => {
    const other = new LedgerStore(url!);
    try {
      await expect(
        store.withWorkerLock(async () => {
          const pid = await store.transaction(
            async (client) =>
              (await client.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid as number,
          );
          await other.pool.query('SELECT pg_terminate_backend($1)', [pid]);
          await new Promise((resolve) => setTimeout(resolve, 100));
          await store.transaction(async (client) => {
            await client.query(
              'INSERT INTO arc_task_ledger_v1.checkpoints(deployment,head) VALUES($1,$2)',
              ['zombie', '0'],
            );
          });
        }),
      ).rejects.toThrow();
      expect(
        (
          await other.pool.query(
            "SELECT count(*) FROM arc_task_ledger_v1.checkpoints WHERE deployment='zombie'",
          )
        ).rows[0]!.count,
      ).toBe('0');
    } finally {
      await other.close();
    }
  });
  it('迁移重复执行且保留共享库其他表', async () => {
    await store.pool.query(
      'CREATE TABLE IF NOT EXISTS public.atl_sentinel(value integer PRIMARY KEY)',
    );
    await store.pool.query('INSERT INTO public.atl_sentinel VALUES(17) ON CONFLICT DO NOTHING');
    await store.migrate();
    expect((await store.pool.query('SELECT value FROM public.atl_sentinel')).rows[0]!.value).toBe(
      17,
    );
    expect(await store.ready()).toBe(true);
  });
  it('ATL-25 崩溃前事务回滚与原始观察幂等', async () => {
    const evidence = rawEvidence(meta(), snapshot, 'test-only:meta', '测试专用');
    await expect(
      store.transaction(async (client) => {
        await store.putEvidence(client, evidence);
        throw new Error('crash');
      }),
    ).rejects.toThrow('crash');
    expect(
      (await store.pool.query('SELECT count(*) FROM arc_task_ledger_v1.observations')).rows[0]!
        .count,
    ).toBe('0');
    await store.transaction(async (client) => {
      await store.putEvidence(client, evidence);
      await store.putEvidence(client, evidence);
    });
    expect(
      (await store.pool.query('SELECT count(*) FROM arc_task_ledger_v1.observations')).rows[0]!
        .count,
    ).toBe('1');
  });
  it('原始证据禁止变更覆盖且可离线回放', async () => {
    const evidence = rawEvidence(meta(), snapshot, 'test-only:meta', '测试专用');
    await store.transaction((client) => store.putEvidence(client, evidence));
    await expect(
      store.transaction((client) =>
        store.putEvidence(client, {
          ...evidence,
          evidence: { ...evidence.evidence, summary: 'overwrite' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'EVIDENCE_CONFLICT' });
    expect(
      (await store.pool.query('SELECT document FROM arc_task_ledger_v1.observations')).rows[0]!
        .document,
    ).toEqual(evidence);
  });
  it('ATL-26 双 worker 与 CAS 排他', async () => {
    const other = new LedgerStore(url!);
    let release!: () => void;
    let started!: () => void;
    const signal = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = store.withWorkerLock(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await signal;
    await expect(other.withWorkerLock(async () => 1)).rejects.toMatchObject({
      code: 'WORKER_LOCKED',
    });
    release();
    await hold;
    await store.checkpoint(DEPLOYMENT.adapter, '9');
    const segment = {
      deployment: DEPLOYMENT.adapter,
      from: '10',
      to: '19',
      status: 'complete' as const,
      document: { testOnly: true },
      observations: [],
      receipts: [],
      expectedVersion: '0',
    };
    await store.saveSegment(segment);
    await expect(other.saveSegment(segment)).rejects.toMatchObject({
      code: 'CHECKPOINT_CAS_CONFLICT',
    });
    await other.close();
  });
  it('ATL-27 乱序完成水位等待首个缺口', async () => {
    await store.checkpoint(DEPLOYMENT.adapter, '9');
    const base = {
      deployment: DEPLOYMENT.adapter,
      status: 'complete' as const,
      document: { testOnly: true },
      observations: [],
      receipts: [],
    };
    const second = await store.saveSegment({ ...base, from: '20', to: '29', expectedVersion: '0' });
    expect(second.head).toBe('9');
    const first = await store.saveSegment({
      ...base,
      from: '10',
      to: '19',
      expectedVersion: second.version,
    });
    expect(first.head).toBe('29');
  });
  it('ATL-29 哈希冲突保留且阻止连续水位', async () => {
    await store.checkpoint(DEPLOYMENT.adapter, '9');
    const base = {
      deployment: DEPLOYMENT.adapter,
      from: '10',
      to: '19',
      observations: [],
      receipts: [],
    };
    const bad = await store.saveSegment({
      ...base,
      status: 'conflict',
      document: { hash: 'old' },
      expectedVersion: '0',
    });
    const good = await store.saveSegment({
      ...base,
      status: 'complete',
      document: { hash: 'new' },
      expectedVersion: bad.version,
    });
    expect(good.head).toBe('9');
    expect(
      (await store.pool.query('SELECT count(*) FROM arc_task_ledger_v1.segments')).rows[0]!.count,
    ).toBe('2');
  });
  it('ATL-33 发布新快照不影响旧分页且数值排序', async () => {
    await store.publish(run(), []);
    const app = await createLedgerApp(store, secret);
    try {
      const first = await app.inject('/v1/jobs?limit=1');
      expect(first.statusCode).toBe(200);
      const a = first.json();
      expect(a.items[0].jobId).toBe('8');
      await store.publish(run('test_run_b', ['2', '8', '19', '104']), []);
      const second = await app.inject(`/v1/jobs?limit=2&cursor=${a.nextCursor}`);
      expect(second.json().snapshotRunId).toBe('test_run_a');
      expect(second.json().items.map((r: { jobId: string }) => r.jobId)).toEqual(['19', '104']);
      const bad = await app.inject(`/v1/jobs?cursor=${a.nextCursor}&address=${meta().poster}`);
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
  it('ATL-34 过期游标返回410，不能换最新快照', async () => {
    const old = run();
    old.expiresAt = '2000-01-01T00:00:00Z';
    await store.publish(old, []);
    const app = await createLedgerApp(store, secret);
    try {
      const r = await app.inject('/v1/jobs');
      expect(r.statusCode).toBe(410);
      expect(r.json().code).toBe('SNAPSHOT_EXPIRED');
    } finally {
      await app.close();
    }
  });
  it('未知任务与不完整状态明确区分', async () => {
    await store.publish(run(), []);
    const app = await createLedgerApp(store, secret);
    try {
      expect((await app.inject(`/v1/jobs/5042/${DEPLOYMENT.adapter}/999`)).json().code).toBe(
        'NOT_IN_ENUMERATED_SET',
      );
      const partial = run('test_partial');
      partial.coverage.jobEnumeration = 'partial';
      await store.publish(partial, []);
      expect((await app.inject(`/v1/jobs/5042/${DEPLOYMENT.adapter}/999`)).json().code).toBe(
        'STATE_NOT_AVAILABLE',
      );
      expect((await app.inject('/v1/jobs?limit=0')).statusCode).toBe(400);
      expect((await app.inject('/v1/jobs?lifecycle=fake')).statusCode).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/jobs',
            payload: { rpc: 'eth_sendTransaction' },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('服务重启后快照与精准金额不变', async () => {
    await store.publish(run(), []);
    const before = await store.getRun();
    const restarted = new LedgerStore(url!);
    try {
      expect(await restarted.getRun()).toEqual(before);
    } finally {
      await restarted.close();
    }
  });
  it('ATL-40 账户 pending 在任务引用中不重复累计', async () => {
    const r = run();
    r.jobs.forEach((j) => {
      j.pendingAccounts = [
        {
          payee: meta().assignedProvider,
          balance: {
            asset: 'USDC',
            decimals: 18,
            atomic: { state: 'known', value: '50000000000000', evidenceIds: [] },
          },
          history: 'partial',
          withdrawals: [],
          sequenceDerivedJobIds: [],
          evidenceIds: [],
        },
      ];
    });
    await store.publish(r, []);
    const loaded = await store.getRun();
    const accounts = new Map(
      loaded!.jobs.flatMap((j) => j.pendingAccounts).map((a) => [a.payee, a.balance.atomic]),
    );
    expect(accounts.size).toBe(1);
    expect(accounts.values().next().value).toMatchObject({ value: '50000000000000' });
  });
  it('GET 查询不隐式启动链采集或创建检查点', async () => {
    await store.publish(run(), []);
    const app = await createLedgerApp(store, secret);
    try {
      await app.inject('/v1/coverage');
      await app.inject('/v1/jobs');
      expect(
        (await store.pool.query('SELECT count(*) FROM arc_task_ledger_v1.checkpoints')).rows[0]!
          .count,
      ).toBe('0');
    } finally {
      await app.close();
    }
  });
  it('ATL-24 413 缩小窗口；持续429停止且不越过缺口', async () => {
    let requests = 0;
    const ranges: string[] = [];
    const transport: JsonRpcTransport = {
      endpointId: 'test-only',
      request: async <T>(method: string, params: readonly unknown[] = []) => {
        if (method === 'eth_getBlockByNumber')
          return { number: params[0], hash: snapshot.blockHash } as T;
        if (method === 'eth_getLogs') {
          requests++;
          const q = params[0] as { fromBlock: string; toBlock: string };
          ranges.push((BigInt(q.toBlock) - BigInt(q.fromBlock) + 1n).toString());
          if (requests === 1) throw Object.assign(new Error('range'), { statusCode: 413 });
          throw Object.assign(new Error('quota'), { code: 'RATE_LIMITED' });
        }
        throw new Error('unexpected');
      },
      requestSourced: async () => {
        throw new Error('unused');
      },
    };
    const reader = new ArcReader(
      {
        rpcUrl: 'https://rpc.mainnet.arc.io',
        rpcHosts: ['rpc.mainnet.arc.io'],
        providerAlias: 'test-only',
      },
      transport,
    );
    const result = await scanHistory(
      reader,
      store,
      { ...snapshot, blockNumber: (BigInt(DEPLOYMENT.verifiedDeploymentBlock) + 4999n).toString() },
      '5000',
    );
    expect(ranges).toEqual(['2000', '1000']);
    expect(requests).toBe(2);
    expect(result.head).toBe((BigInt(DEPLOYMENT.verifiedDeploymentBlock) - 1n).toString());
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it('独立 consumer 使用真实 HTTP 并明确降级', async () => {
    await store.publish(run(), []);
    const app = await createLedgerApp(store, secret);
    await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const base = app.listeningOrigin;
      const result = await fetchLedgerJob(base, '5042', DEPLOYMENT.adapter, '8');
      expect(result.degraded).toBe(false);
      expect((result.job as { job: { jobId: string } }).job.jobId).toBe('8');
      const fallback = await fetchLedgerJob(base, '5042', DEPLOYMENT.adapter, '999', async () => ({
        resolved: true,
      }));
      expect(fallback.datasource).toBe('upstream-read-only');
      expect(fallback.degraded).toBe(true);
    } finally {
      await app.close();
    }
  });
  it('来源故障与陈旧、未知分别表达且保留旧快照', async () => {
    await store.publish(run(), []);
    await store.recordSync(false, { code: 'RPC_UNAVAILABLE', providerAlias: 'test-only' });
    const app = await createLedgerApp(store, secret);
    try {
      const page = await app.inject('/v1/jobs');
      expect(page.json().freshness.state).toBe('provider-down');
      expect(page.json().items[0].reward.state).toBe('known');
      const coverage = await app.inject('/v1/coverage');
      expect(coverage.json().lastAttempt.success).toBe(false);
      expect(coverage.json().formalMode).toBe('FAIL_CLOSED_COVERAGE_INSUFFICIENT');
    } finally {
      await app.close();
    }
  });
});
