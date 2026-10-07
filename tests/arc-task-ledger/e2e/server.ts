// 仅供浏览器测试：专用数据库与明显标记的合成记录。生产入口不导入此文件。
import { LedgerStore } from '../../../apps/arc-task-ledger-api/src/storage.js';
import {
  rawEvidence,
  decodeReceipt,
  protocolAtoms,
  lifecycle,
} from '../../../packages/arc-task-ledger/src/protocol.js';
import { settlement } from '../../../packages/arc-task-ledger/src/settlement.js';
import { accountPending } from '../../../packages/arc-task-ledger/src/settlement.js';
import { known } from '../../../packages/arc-task-ledger/src/types.js';
import { DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
import { createLedgerApp } from '../../../apps/arc-task-ledger-api/src/app.js';
import { verifierObservation } from '../fixtures/verifier-observation.js';
import {
  run,
  snapshot,
  meta,
  completeLogs,
  event,
  transfer,
  receipt,
  WORKER,
  POSTER,
} from '../fixtures/helpers.js';
const url = process.env.ARC_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/arc_task_ledger_test')
  throw new Error('浏览器测试必须使用隔离测试数据库。');
const store = new LedgerStore(url);
await store.migrate();
await store.pool.query(
  'TRUNCATE arc_task_ledger_v1.zasv_publications,arc_task_ledger_v1.zasv_ownership,arc_task_ledger_v1.zasv_bundles,arc_task_ledger_v1.zasv_reports,arc_task_ledger_v1.zasv_requests',
);
await store.pool.query(
  'TRUNCATE arc_task_ledger_v1.evidence_requests,arc_task_ledger_v1.receipts,arc_task_ledger_v1.jobs,arc_task_ledger_v1.runs,arc_task_ledger_v1.observations,arc_task_ledger_v1.segments,arc_task_ledger_v1.checkpoints,arc_task_ledger_v1.sync_attempts',
);
const fixture = run('browser_test_only', [
  '8',
  '19',
  '104',
  '105',
  '106',
  '107',
  '108',
  '109',
  '110',
  '111',
  '112',
  '113',
]);
fixture.historyRange = {
  scope: 'DECLARED_WINDOW',
  fromBlock: '21153191',
  targetBlock: '21153193',
  contiguousThrough: '21153192',
  checkpointKey: `${DEPLOYMENT.adapter}:from:21153191`,
  checkpointVersion: '1',
  status: 'partial',
  omittedPriorHistory: true,
  gaps: [{ fromBlock: '21153193', toBlock: '21153193', reason: '本地测试：窗口限额未覆盖末块。' }],
};
fixture.jobs[0]!.rawState = meta({ ipfsDescHash: '<script>window.__unsafeExecuted=true</script>' });
fixture.jobs[0]!.evidence = [
  rawEvidence(
    fixture.jobs[0]!.rawState,
    snapshot,
    'test-only:fixture',
    '本地合成测试，不是主网证据。',
  ),
];
for (const [jobId, scenario] of [
  ['19', 'reward'],
  ['104', 'parked'],
  ['105', 'dispute'],
  ['106', 'zero-refund'],
  ['109', 'timeout'],
  ['110', 'claimed'],
] as const) {
  let logs = completeLogs();
  if (scenario === 'parked' || scenario === 'claimed')
    logs = [
      ...logs.filter((l) => BigInt(l.logIndex) !== 3n),
      event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 990000n }, 5),
    ];
  if (scenario === 'timeout')
    logs = [
      event(
        'ArbitratorTimeoutClaimed',
        { jobId: 8n, posterAmount: 500000n, providerAmount: 500000n },
        0,
      ),
      transfer(DEPLOYMENT.adapter, POSTER, protocolAtoms('500000'), 1),
      transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('500000'), 2),
    ];
  if (scenario === 'dispute')
    logs[4] = event(
      'DisputeResolved',
      { jobId: 8n, payProvider: true, rulingHash: 'local-test-ruling', defaultRuling: false },
      4,
    );
  if (scenario === 'zero-refund')
    logs = [
      event(
        'ExternalRefundReconciled',
        { jobId: 8n, poster: POSTER, worker: WORKER, posterAmount: 1000000n, workerAmount: 0n },
        0,
      ),
      transfer(DEPLOYMENT.adapter, POSTER, protocolAtoms('1000000'), 1),
    ];
  const protocolEvents = decodeReceipt(receipt(logs), []).events;
  logs = logs.map((log) => {
    const decoded = protocolEvents.find((e) => BigInt(e.logIndex) === BigInt(log.logIndex));
    return decoded
      ? event(decoded.name, { ...decoded.args, jobId: BigInt(jobId) }, Number(BigInt(log.logIndex)))
      : log;
  });
  const raw = receipt(logs);
  const evidence = rawEvidence(
    raw,
    snapshot,
    `test-only:${scenario}`,
    '明确标注的本地合成资金回归，不是主网观察。',
  );
  const state = meta({ jobId });
  const cash = settlement(state, [{ receipt: raw, evidenceIds: [evidence.id] }]);
  const detail = fixture.jobs.find((d) => d.job.jobId === jobId)!;
  detail.job.lifecycle = lifecycle(state, cash.events);
  detail.job.cashState = cash.cashState;
  detail.rawState = state;
  detail.settlementLegs = cash.legs;
  detail.timeline = cash.events;
  detail.evidence = [evidence];
  detail.gas = cash.gas;
  if (scenario === 'claimed') {
    const claimTx = '0x' + 'c'.repeat(64);
    const claimBlock = '0x14fb181';
    const claim = receipt(
      [
        transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('990000'), 0),
        event('WithdrawalClaimed', { payee: WORKER, amount: 990000n }, 1),
      ].map((l) => ({ ...l, transactionHash: claimTx, blockNumber: claimBlock })),
      { transactionHash: claimTx, blockNumber: claimBlock },
    );
    const claimProof = rawEvidence(
      claim,
      snapshot,
      'test-only:claimed-sequence',
      '本地合成完整义务序列，不是主网观察。',
    );
    detail.pendingAccounts = [
      accountPending(
        WORKER,
        known('0'),
        [
          { receipt: raw, evidenceIds: [evidence.id] },
          { receipt: claim, evidenceIds: [claimProof.id] },
        ],
        true,
        known('0'),
      ),
    ];
    detail.evidence.push(claimProof);
    detail.job.cashState = 'VERIFIED_SEQUENCE_DERIVED';
  }
}
// UX04：旧保证金已提现，新奖励仍未清偿；仅本地合成数据。
const obligationLogs = [
  event('PayoutParked', { jobId: 107n, payee: WORKER, amount: 500000n }, 0),
  transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('500000'), 1),
  event('WithdrawalClaimed', { payee: WORKER, amount: 500000n }, 2),
  event('PayoutParked', { jobId: 107n, payee: WORKER, amount: 990000n }, 3),
];
const parked = fixture.jobs.find((d) => d.job.jobId === '107')!;
parked.pendingAccounts = [
  accountPending(
    WORKER,
    known(protocolAtoms('990000')),
    [{ receipt: receipt(obligationLogs), evidenceIds: ['local-obligation-proof'] }],
    true,
    known('0'),
  ),
];
parked.job.cashState = 'PARKED';
const conflict = fixture.jobs.find((d) => d.job.jobId === '108')!;
conflict.job.cashState = 'CONFLICT';
await store.publish(fixture, []);
const app = await createLedgerApp(
  store,
  'browser-test-only-cursor-32-bytes-secret',
  store,
  undefined,
  async () => verifierObservation(),
);
app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('x-atl-test-fixture', 'synthetic-not-mainnet');
  return payload;
});
await app.listen({ host: '127.0.0.1', port: 8088 });
const shutdown = async () => {
  await app.close();
  await store.close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
