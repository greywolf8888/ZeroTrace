import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { LedgerStore } from '../../../apps/arc-task-ledger-api/src/storage.js';
import { ABI, DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { rawEvidence } from '../../../packages/arc-task-ledger/src/protocol.js';
import { createLedgerApp } from '../../../apps/arc-task-ledger-api/src/app.js';
import { run, snapshot, meta, receipt, event, POSTER } from '../fixtures/helpers.js';
import { ArcReader } from '../../../packages/arc-task-ledger/src/reader.js';
import {
  scanHistory,
  syncOnce,
  historyCheckpointKey,
  scanPriority,
} from '../../../packages/arc-task-ledger/src/worker.js';
import { readonlyChain } from '../fixtures/readonly-chain.js';
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
    'TRUNCATE arc_task_ledger_v1.evidence_requests,arc_task_ledger_v1.receipts,arc_task_ledger_v1.jobs,arc_task_ledger_v1.runs,arc_task_ledger_v1.observations,arc_task_ledger_v1.segments,arc_task_ledger_v1.checkpoints,arc_task_ledger_v1.sync_attempts',
  );
});
afterAll(async () => {
  await store.close();
});
describe('真实 PostgreSQL 与 API 集成', () => {
  it('小窗口分批仍消费完整的有界预算，每批原始证据和水位落盘', async () => {
    const reader = new ArcReader(
      {
        rpcUrl: 'https://rpc.mainnet.arc.io',
        rpcHosts: ['rpc.mainnet.arc.io'],
        providerAlias: 'test-only',
      },
      readonlyChain(false),
    );
    Object.defineProperty(reader, 'logWindowLimit', { value: 1n });
    try {
      const anchor = await reader.anchor();
      const calls = vi.spyOn(reader, 'logs');
      const r = await scanPriority(reader, store, anchor, '3', '0');
      expect(calls.mock.calls).toEqual(
        [0n, 1n, 2n].map((offset) => {
          const b = (BigInt(anchor.blockNumber) - 2n + offset).toString();
          return [b, b];
        }),
      );
      expect(r.recent).toMatchObject({ through: anchor.blockNumber, complete: true });
      expect((await store.receiptsThrough(anchor.blockNumber)).length).toBe(3);
      expect(
        (
          await store.pool.query(
            "SELECT count(*) AS n FROM arc_task_ledger_v1.segments WHERE document->>'scope'='recent-changes'",
          )
        ).rows[0].n,
      ).toBe('3');
    } finally {
      await reader.close();
    }
  });
  it('补证头与已持久的连续检查点一致，既有区间复用不能使申请水位落后', async () => {
    const fixture = run('proof_existing', ['8']);
    await store.publish(fixture, []);
    const q = await store.enqueueEvidence(fixture.jobs[0]!, fixture.id);
    const base = await store.checkpoint(
      DEPLOYMENT.adapter,
      (BigInt(DEPLOYMENT.verifiedDeploymentBlock) - 1n).toString(),
    );
    const end = (BigInt(q.from) + 10n).toString();
    await store.saveSegment({
      deployment: DEPLOYMENT.adapter,
      from: q.from,
      to: end,
      status: 'complete',
      document: { scope: 'local-test-existing-window' },
      observations: [],
      receipts: [],
      expectedVersion: base.version,
    });
    const reader = new ArcReader(
      {
        rpcUrl: 'https://rpc.mainnet.arc.io',
        rpcHosts: ['rpc.mainnet.arc.io'],
        providerAlias: 'test-only',
      },
      readonlyChain(false),
    );
    try {
      await scanPriority(
        reader,
        store,
        { ...snapshot, blockNumber: fixture.snapshot.blockNumber },
        '0',
        '1',
      );
      const request = await store.evidenceRequest('8');
      const cp = await store.currentCheckpoint(`${DEPLOYMENT.adapter}:request:${q.id}`);
      expect(request!.head).toBe(end);
      expect(request!.head).toBe(cp!.head);
    } finally {
      await reader.close();
    }
  });
  it('补证POST去重、有界、版本隔离；GET不触发，角色筛选在数据库执行', async () => {
    const fixture = run('request_test', ['8']);
    await store.publish(fixture, []);
    const app = await createLedgerApp(store, secret, store);
    try {
      const path = `/v1/jobs/5042/${DEPLOYMENT.adapter}/8`;
      const before = await store.pool.query(
        'SELECT count(*) AS n FROM arc_task_ledger_v1.evidence_requests',
      );
      expect((await app.inject(path)).statusCode).toBe(200);
      expect(
        (await store.pool.query('SELECT count(*) AS n FROM arc_task_ledger_v1.evidence_requests'))
          .rows,
      ).toEqual(before.rows);
      const first = await app.inject({
        method: 'POST',
        url: path + '/evidence-requests',
        payload: {},
      });
      expect(first.statusCode).toBe(202);
      const request = first.json().request;
      expect(BigInt(request.to) - BigInt(request.from) + 1n).toBeLessThanOrEqual(200000n);
      const again = await app.inject({
        method: 'POST',
        url: path + '/evidence-requests',
        payload: {},
      });
      expect(again.json().request.id).toBe(request.id);
      expect(
        (await store.pool.query('SELECT count(*) AS n FROM arc_task_ledger_v1.evidence_requests'))
          .rows[0].n,
      ).toBe('1');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: path + '/evidence-requests',
            payload: { rpcUrl: 'https://evil.test' },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/jobs/1/' + DEPLOYMENT.adapter + '/8/evidence-requests',
            payload: {},
          })
        ).statusCode,
      ).toBe(422);
      expect((await store.nextEvidenceRequest())!.id).toBe(request.id);
      await store.pool.query(
        "UPDATE arc_task_ledger_v1.evidence_requests SET rule_version='retired',id='retired_'||id WHERE id=$1",
        [request.id],
      );
      expect(await store.nextEvidenceRequest()).toBeUndefined();
      const newer = await app.inject({
        method: 'POST',
        url: path + '/evidence-requests',
        payload: {},
      });
      expect(newer.statusCode).toBe(202);
      expect(newer.json().request.id).not.toBe('retired_' + request.id);
      await store.pool.query(
        "UPDATE arc_task_ledger_v1.evidence_requests SET status='COMPLETED' WHERE id=$1",
        [newer.json().request.id],
      );
      expect(
        (await app.inject({ method: 'POST', url: path + '/evidence-requests', payload: {} })).json()
          .request.id,
      ).toBe(newer.json().request.id);
      const poster = fixture.jobs[0]!.job.poster;
      const page = (await app.inject('/v1/jobs?address=' + poster + '&role=poster')).json();
      expect(page.items.length).toBe(1);
      expect(
        (await app.inject('/v1/jobs?address=' + poster + '&role=worker')).json().items.length,
      ).toBe(0);
    } finally {
      await app.close();
    }
  });
  it('本地合成新任务从最新预算进入PG与API，不等待旧历史回填；重读定点复用原始回执', async () => {
    const base = readonlyChain(false);
    let added = false;
    const height = BigInt(DEPLOYMENT.verifiedDeploymentBlock) + 1003n;
    const tx = '0x' + 'd'.repeat(64);
    const created = receipt(
      [
        event(
          'BountyCreated',
          {
            jobId: 19n,
            poster: POSTER,
            reward: 1000000n,
            deadline: 9999999999n,
            category: '本地合成',
          },
          0,
        ),
      ].map((l) => ({ ...l, transactionHash: tx, blockNumber: '0x' + height.toString(16) })),
      { transactionHash: tx, blockNumber: '0x' + height.toString(16) },
    );
    const handle = async <T>(method: string, params: readonly unknown[] = []) => {
      if (method === 'eth_getBlockByNumber' && params[0] === 'finalized') {
        const block = await base.request<Record<string, unknown>>(method, params);
        return { ...block, number: '0x' + (added ? height : height - 1n).toString(16) } as T;
      }
      if (method === 'eth_call') {
        const { functionName, args } = decodeFunctionData({
          abi: ABI,
          data: (params[0] as { data: `0x${string}` }).data,
        });
        if (functionName === 'totalBounties')
          return encodeFunctionResult({ abi: ABI, functionName, result: added ? 2n : 1n }) as T;
        if (functionName === 'allJobIds')
          return encodeFunctionResult({
            abi: ABI,
            functionName,
            result: args?.[0] === 1n ? 19n : 8n,
          }) as T;
        if (functionName === 'getBountyMeta' && args?.[0] === 19n) {
          const state = meta({ jobId: '19', resolved: false, isTaken: false });
          const decoded = Object.fromEntries(
            Object.entries(state).map(([k, v]) => [
              k,
              typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v,
            ]),
          );
          return encodeFunctionResult({ abi: ABI, functionName, result: decoded }) as T;
        }
      }
      if (method === 'eth_getTransactionReceipt' && params[0] === tx) return created as T;
      if (method === 'eth_getLogs') {
        const q = params[0] as { fromBlock: string; toBlock: string };
        const old = await base.request<unknown[]>(method, params);
        return [
          ...old,
          ...(added && BigInt(q.fromBlock) <= height && BigInt(q.toBlock) >= height
            ? created.logs
            : []),
        ] as T;
      }
      return base.request<T>(method, params);
    };
    const transport: JsonRpcTransport = {
      endpointId: 'test-only',
      request: handle,
      requestSourced: async <T>(m: string, p: readonly unknown[] = []) => ({
        value: await handle<T>(m, p),
        endpointId: 'test-only',
      }),
    };
    const reader = new ArcReader(
      {
        rpcUrl: 'https://rpc.mainnet.arc.io',
        rpcHosts: ['rpc.mainnet.arc.io'],
        providerAlias: 'test-only',
      },
      transport,
    );
    try {
      const options = {
        maxJobs: 5,
        scanBudget: '1',
        recentBudget: '1',
        proofBudget: '0',
        evidenceBlocks: [(height - 1n).toString()],
      };
      await syncOnce(reader, store, { ...options, snapshotBlock: (height - 1n).toString() });
      added = true;
      const receiptReads = vi.spyOn(reader, 'read');
      const current = await syncOnce(reader, store, {
        ...options,
        snapshotBlock: height.toString(),
      });
      expect(current.totalExpected).toBe('2');
      expect(current.coverage.lifecycleHistory).toBe('partial');
      expect(
        current.jobs
          .find((j) => j.job.jobId === '19')!
          .timeline.some((e) => e.name === 'BountyCreated'),
      ).toBe(true);
      expect(
        receiptReads.mock.calls.filter(
          ([method, params]) => method === 'eth_getTransactionReceipt' && params?.[0] === tx,
        ),
      ).toHaveLength(1);
      const app = await createLedgerApp(store, secret);
      try {
        const visible = (
          await app.inject(`/v1/jobs/5042/${DEPLOYMENT.adapter}/19?snapshotRunId=${current.id}`)
        ).json();
        expect(visible.job.jobId).toBe('19');
        expect(visible.timeline[0].name).toBe('BountyCreated');
      } finally {
        await app.close();
      }
    } finally {
      await reader.close();
    }
  });
  it('最新变化预算独立落盘、续采与补证水位事务一致；回填仍partial', async () => {
    const config = {
      rpcUrl: 'https://rpc.mainnet.arc.io',
      rpcHosts: ['rpc.mainnet.arc.io'],
      providerAlias: 'test-only',
    };
    const reader = new ArcReader(config, readonlyChain(false));
    const anchor = await reader.anchor();
    const spy = vi.spyOn(reader, 'logs');
    const first = await scanPriority(reader, store, anchor, '1', '0');
    expect(first.recent).toMatchObject({ through: anchor.blockNumber, complete: true });
    const receipts = await store.receiptsThrough(anchor.blockNumber);
    expect(receipts.length).toBeGreaterThan(0);
    const second = await scanPriority(
      reader,
      store,
      { ...anchor, blockNumber: (BigInt(anchor.blockNumber) + 1n).toString() },
      '1',
      '0',
    );
    expect(spy).toHaveBeenLastCalledWith(
      (BigInt(anchor.blockNumber) + 1n).toString(),
      (BigInt(anchor.blockNumber) + 1n).toString(),
    );
    expect(second.recent).toMatchObject({ complete: true });
    const fixture = run('proof_transaction', ['8']);
    await store.publish(fixture, []);
    const q = await store.enqueueEvidence(fixture.jobs[0]!, fixture.id);
    const lower = { ...anchor, blockNumber: fixture.snapshot.blockNumber };
    await scanPriority(reader, store, lower, '0', '1');
    const progressed = await store.evidenceRequest('8');
    expect(progressed!.head).toBe(q.from);
    expect(
      (
        await store.pool.query(
          "SELECT count(*) AS n FROM arc_task_ledger_v1.segments WHERE document->>'scope'='bounded-task-enrichment'",
        )
      ).rows[0].n,
    ).toBe('1');
    await reader.close();
  });
  it('声明窗口预算缺口→关闭重开续采；窗口完整不提升部署全历史', async () => {
    const from = (BigInt(DEPLOYMENT.verifiedDeploymentBlock) + 1n).toString();
    const target = (BigInt(from) + 1n).toString();
    const config = {
      rpcUrl: 'https://rpc.mainnet.arc.io',
      rpcHosts: ['rpc.mainnet.arc.io'],
      providerAlias: 'test-only',
    };
    const reader = new ArcReader(config, readonlyChain(false));
    const first = await syncOnce(reader, store, {
      maxJobs: 5,
      scanBudget: '1',
      historyFromBlock: from,
      snapshotBlock: from,
    });
    expect(first.snapshot.blockNumber).toBe(from);
    expect(first.historyRange).toMatchObject({
      status: 'complete',
      contiguousThrough: from,
      omittedPriorHistory: true,
    });
    const partial = await syncOnce(reader, store, {
      maxJobs: 5,
      scanBudget: '1',
      historyFromBlock: from,
      snapshotBlock: target,
    });
    expect(partial.historyRange?.status).toBe('complete');
    expect(partial.coverage.lifecycleHistory).toBe('partial');
    expect(partial.coverage.accountPendingHistory).toBe('partial');
    expect(await store.currentCheckpoint(DEPLOYMENT.adapter)).toBeUndefined();
    await reader.close();
    const restarted = new LedgerStore(url!);
    const resumed = new ArcReader(config, readonlyChain(false));
    try {
      const replay = await restarted.getRun(partial.id);
      expect(replay?.historyRange).toEqual(partial.historyRange);
      const rangeCalls = vi.spyOn(resumed, 'logs');
      const result = await syncOnce(resumed, restarted, {
        maxJobs: 5,
        scanBudget: '1',
        historyFromBlock: from,
      });
      expect(rangeCalls).not.toHaveBeenCalled();
      expect(result.historyRange?.contiguousThrough).toBe(target);
      expect((await restarted.currentCheckpoint(historyCheckpointKey(from)))!.head).toBe(target);
      const app = await createLedgerApp(restarted, secret);
      const response = (await app.inject('/v1/coverage')).json();
      expect(response.historyRange.value.status).toBe('complete');
      expect(response.historyHead.state).toBe('unknown');
      expect(response.formalMode).toBe('FAIL_CLOSED_COVERAGE_INSUFFICIENT');
      await app.close();
    } finally {
      await resumed.close();
      await restarted.close();
    }
  });
  it('声明窗口限额留缺口；恢复从下一块且不把失败日志视作空记录', async () => {
    const from = (BigInt(DEPLOYMENT.verifiedDeploymentBlock) + 1n).toString();
    const target = (BigInt(from) + 1n).toString();
    const reader = new ArcReader(
      {
        rpcUrl: 'https://rpc.mainnet.arc.io',
        rpcHosts: ['rpc.mainnet.arc.io'],
        providerAlias: 'test-only',
      },
      readonlyChain(false),
    );
    const anchored = await reader.anchor();
    const first = await scanHistory(reader, store, anchored, '1', from);
    expect(first.historyRange).toMatchObject({
      status: 'partial',
      contiguousThrough: from,
      gaps: [{ fromBlock: target, toBlock: target }],
    });
    const logs = vi
      .spyOn(reader, 'logs')
      .mockRejectedValueOnce(Object.assign(new Error('source timeout'), { code: 'ETIMEDOUT' }));
    const failed = await scanHistory(reader, store, anchored, '1', from);
    expect(failed.head).toBe(from);
    expect(failed.historyRange.status).toBe('partial');
    const last = await scanHistory(reader, store, anchored, '1', from);
    expect(logs).toHaveBeenLastCalledWith(target, target);
    expect(last.historyRange.status).toBe('complete');
    expect(
      (
        await store.pool.query(
          "SELECT count(*) FROM arc_task_ledger_v1.segments WHERE status='partial'",
        )
      ).rows[0].count,
    ).toBe('1');
    await reader.close();
  });
  it('已知区间中间冲突不被大区间跨越；已推进水位遇冲突撤回', async () => {
    const key = historyCheckpointKey((BigInt(DEPLOYMENT.verifiedDeploymentBlock) + 1n).toString());
    await store.checkpoint(key, '9');
    const base = {
      deployment: DEPLOYMENT.adapter,
      checkpointKey: key,
      document: {},
      observations: [],
      receipts: [],
    };
    await store.saveSegment({
      ...base,
      from: '12',
      to: '12',
      status: 'conflict',
      expectedVersion: '0',
    });
    const state = await store.saveSegment({
      ...base,
      from: '10',
      to: '20',
      status: 'complete',
      expectedVersion: '1',
    });
    expect(state.head).toBe('11');
    const retracted = await store.saveSegment({
      ...base,
      from: '10',
      to: '10',
      status: 'conflict',
      expectedVersion: state.version,
    });
    expect(retracted.head).toBe('9');
  });
  it('定点真实回执路径仅覆盖指定区块，不越过历史缺口', async () => {
    const reader = new ArcReader(
      {
        rpcUrl: 'https://rpc.mainnet.arc.io',
        rpcHosts: ['rpc.mainnet.arc.io'],
        providerAlias: 'test-only',
      },
      readonlyChain(false),
    );
    const height = (BigInt(DEPLOYMENT.verifiedDeploymentBlock) + 2n).toString();
    try {
      const result = await syncOnce(reader, store, {
        maxJobs: 5,
        scanBudget: '1',
        currentOnly: true,
        evidenceBlocks: [height],
      });
      expect(result.coverage.lifecycleHistory).toBe('partial');
      expect(result.coverage.accountPendingHistory).toBe('partial');
      expect((await store.currentCheckpoint(DEPLOYMENT.adapter))!.head).toBe(
        (BigInt(DEPLOYMENT.verifiedDeploymentBlock) - 1n).toString(),
      );
      expect(
        result.jobs[0]!.settlementLegs.find((l) => l.kind === 'REWARD')!.parkedAmount.atomic.state,
      ).toBe('known');
      expect(result.jobs[0]!.job.cashState).toBe('PARTIAL');
      expect(
        (await store.pool.query('SELECT document FROM arc_task_ledger_v1.segments')).rows[0]
          .document.scope,
      ).toBe('selected-block-only');
    } finally {
      await reader.close();
    }
  });
  it.each([false, true])(
    '完整reader/worker→真实PG→API→关闭重开，争议默认=%s，新义务不继承旧清偿',
    async (defaultRuling) => {
      const reader = new ArcReader(
        {
          rpcUrl: 'https://rpc.mainnet.arc.io',
          rpcHosts: ['rpc.mainnet.arc.io'],
          providerAlias: 'test-only',
        },
        readonlyChain(defaultRuling),
      );
      const result = await syncOnce(reader, store, { maxJobs: 5, scanBudget: '3' });
      expect(result.coverage.lifecycleHistory).toBe('complete');
      expect(result.jobs[0]!.job.cashState).toBe('PARTIAL');
      expect(
        result.jobs[0]!.settlementLegs.find((l) => l.kind === 'REWARD')!.parkedAmount.atomic,
      ).toMatchObject({ state: 'known', value: '990000000000000000' });
      const account = result.jobs[0]!.pendingAccounts.find(
        (a) => a.payee === meta().assignedProvider,
      )!;
      expect(account.obligations.map((o) => o.status)).toEqual(['CLEARED_SEQUENCE', 'OUTSTANDING']);
      const restart = new LedgerStore(url!);
      const app = await createLedgerApp(restart, secret);
      try {
        expect(await restart.getRun(result.id)).toEqual(result);
        const response = await app.inject(
          `/v1/jobs/5042/${DEPLOYMENT.adapter}/8?snapshotRunId=${result.id}`,
        );
        expect(response.statusCode).toBe(200);
        expect(response.json().job.cashState.value).toBe('PARTIAL');
        expect(
          response
            .json()
            .pendingAccounts.find((a: { payee: string }) => a.payee === meta().assignedProvider)
            .withdrawals[0].obligationIds,
        ).toEqual([account.obligations[0]!.id]);
      } finally {
        await app.close();
        await restart.close();
        await reader.close();
      }
    },
  );
  it('列表SQL keyset+LIMIT仅读投影；详情单任务；coverage不读jobs', async () => {
    const fixture = run(
      'query_bound',
      Array.from({ length: 120 }, (_, i) => String(i + 1)),
    );
    fixture.jobs.forEach((detail) => {
      detail.evidence = [
        rawEvidence(
          { testOnly: true, payload: 'x'.repeat(4096) },
          snapshot,
          'test-only:large',
          '大原始记录不进入列表',
        ),
      ];
    });
    await store.publish(fixture, []);
    const app = await createLedgerApp(store, secret);
    const fullReplay = vi
      .spyOn(store, 'getRun')
      .mockRejectedValue(new Error('GET禁止完整运行读取'));
    const queries = vi.spyOn(store.pool, 'query');
    try {
      const first = (await app.inject('/v1/jobs?limit=3')).json();
      queries.mockClear();
      const page = await app.inject(`/v1/jobs?limit=3&cursor=${first.nextCursor}`);
      expect(page.json().items.map((j: { jobId: string }) => j.jobId)).toEqual(['4', '5', '6']);
      const index = queries.mock.calls.findIndex((call) =>
        String(call[0]).includes('FROM arc_task_ledger_v1.jobs'),
      );
      const [sql, values] = queries.mock.calls[index]!;
      expect(String(sql)).toMatch(/SELECT list_projection,evidence_ids/);
      expect(String(sql)).toMatch(/job_id>\$2::numeric.*ORDER BY job_id LIMIT \$3/);
      expect(values).toEqual(['query_bound', '3', 4]);
      expect((await queries.mock.results[index]!.value).rows).toHaveLength(4);
      expect(page.body).not.toContain('xxxx');
      queries.mockClear();
      expect((await app.inject(`/v1/jobs/5042/${DEPLOYMENT.adapter}/8`)).statusCode).toBe(200);
      expect(
        queries.mock.calls
          .filter((call) => String(call[0]).includes('FROM arc_task_ledger_v1.jobs'))
          .map((call) => String(call[0])),
      ).toEqual([
        'SELECT document FROM arc_task_ledger_v1.jobs WHERE run_id=$1 AND job_id=$2 LIMIT 1',
      ]);
      queries.mockClear();
      await app.inject('/v1/coverage');
      expect(
        queries.mock.calls.some((call) => String(call[0]).includes('FROM arc_task_ledger_v1.jobs')),
      ).toBe(false);
      expect(fullReplay).not.toHaveBeenCalled();
    } finally {
      queries.mockRestore();
      fullReplay.mockRestore();
      await app.close();
    }
  });
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
          obligations: [],
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
      expect(result.degraded).toBe(true); // HTTP成功不等于资金与覆盖完整。
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
