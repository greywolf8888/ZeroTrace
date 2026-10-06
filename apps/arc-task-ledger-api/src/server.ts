import { LedgerStore } from './storage.js';
import { configFromEnv } from '@zerotrace/arc-task-ledger';
import { createLedgerApp } from './app.js';
import { productionLiveObserver } from './live.js';
import { transactionCollector } from '@zerotrace/arc-task-ledger';
const config = configFromEnv();
const store = new LedgerStore(config.databaseUrl);
const secret = process.env.ARC_CURSOR_SECRET;
if (!secret) throw new Error('请配置稳定的 ARC_CURSOR_SECRET，以保持重启后的分页游标可用。');
const requestStore = process.env.ARC_REQUEST_DATABASE_URL
  ? new LedgerStore(process.env.ARC_REQUEST_DATABASE_URL)
  : undefined;
const app = await createLedgerApp(
  store,
  secret,
  requestStore,
  productionLiveObserver(config),
  transactionCollector(config),
);
const close = async () => {
  await app.close();
  await store.close();
  await requestStore?.close();
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
await app.listen({ host: process.env.ARC_API_HOST ?? '127.0.0.1', port: config.port });
console.info(`Arc 任务证据 API 已启动，端口 ${config.port}，只读。`);
