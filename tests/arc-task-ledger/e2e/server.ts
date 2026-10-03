// 仅供浏览器测试：专用数据库与明显标记的合成记录。生产入口不导入此文件。
import { LedgerStore } from '../../../apps/arc-task-ledger-api/src/storage.js';
import { rawEvidence } from '../../../packages/arc-task-ledger/src/protocol.js';
import { createLedgerApp } from '../../../apps/arc-task-ledger-api/src/app.js';
import { run, snapshot, meta } from '../fixtures/helpers.js';
const url = process.env.ARC_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/arc_task_ledger_test')
  throw new Error('浏览器测试必须使用隔离测试数据库。');
const store = new LedgerStore(url);
await store.migrate();
await store.pool.query(
  'TRUNCATE arc_task_ledger_v1.receipts,arc_task_ledger_v1.jobs,arc_task_ledger_v1.runs,arc_task_ledger_v1.observations,arc_task_ledger_v1.segments,arc_task_ledger_v1.checkpoints',
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
fixture.jobs[0]!.rawState = meta({ ipfsDescHash: '<script>window.__unsafeExecuted=true</script>' });
fixture.jobs[0]!.evidence = [
  rawEvidence(
    fixture.jobs[0]!.rawState,
    snapshot,
    'test-only:fixture',
    '本地合成测试，不是主网证据。',
  ),
];
await store.publish(fixture, []);
const app = await createLedgerApp(store, 'browser-test-only-cursor-32-bytes-secret');
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
