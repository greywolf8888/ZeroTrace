import { LedgerStore } from './storage.js';
import { configFromEnv } from '@zerotrace/arc-task-ledger';
const config = configFromEnv();
const store = new LedgerStore(config.databaseUrl);
try {
  await store.migrate();
  console.info('Arc 专用 schema 迁移完成；原有业务表保持不变。');
} finally {
  await store.close();
}
