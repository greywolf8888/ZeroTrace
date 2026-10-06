import { expect, it } from 'vitest';
import { planEvidence } from '../../../packages/arc-task-ledger/src/enrichment.js';
import { DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
import { run, TX, HASH } from '../fixtures/helpers.js';

it('无法定位任务事件时不猜最近200000区块，不假装扫描成功', () => {
  const plan = planEvidence(run().jobs[0]!, []);
  expect(plan.basis).toBe('UNLOCATABLE');
  expect(plan.from).toBeUndefined();
  expect(plan.targetKinds).toContain('SETTLEMENT_GAP');
});
it('已知创建位置选未扫描缺口；老任务不会永远重复创建后的首段', () => {
  const detail = run().jobs[0]!;
  const first = BigInt(DEPLOYMENT.verifiedDeploymentBlock);
  detail.job.snapshot = { ...detail.job.snapshot, blockNumber: (first + 800000n).toString() };
  detail.timeline = [
    {
      id: 'local-created',
      name: 'BountyCreated',
      jobId: '8',
      args: {},
      blockNumber: first.toString(),
      blockHash: HASH,
      transactionHash: TX,
      logIndex: '0',
      evidenceIds: [],
    },
  ];
  const latest = planEvidence(detail, []);
  expect(latest.to).toBe(detail.job.snapshot.blockNumber);
  expect(BigInt(latest.to!) - BigInt(latest.from!) + 1n).toBe(200000n);
  const next = planEvidence(detail, [{ from: latest.from!, to: latest.to! }]);
  expect(BigInt(next.to!)).toBe(BigInt(latest.from!) - 1n);
  const covered = planEvidence(detail, [
    { from: first.toString(), to: detail.job.snapshot.blockNumber },
  ]);
  expect(covered.basis).toBe('COVERED');
  expect(covered.from).toBeUndefined();
});
it('已知结算事件优先定向核验该区块；完成后不重复申请相同窗口', () => {
  const detail = run().jobs[0]!;
  detail.timeline = [
    {
      id: 'local-completed',
      name: 'BountyCompleted',
      jobId: '8',
      args: {},
      blockNumber: '21900000',
      blockHash: HASH,
      transactionHash: TX,
      logIndex: '0',
      evidenceIds: [],
    },
  ];
  expect(planEvidence(detail, [])).toMatchObject({
    basis: 'KNOWN_EVENT',
    from: '21900000',
    to: '21900000',
  });
  expect(planEvidence(detail, [{ from: '21900000', to: '21900000' }]).from).toBe('21900001');
});
