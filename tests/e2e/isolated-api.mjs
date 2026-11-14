// Windows PowerShell 的空环境赋值会删除变量，随后生产入口加载 .env。
// 此测试入口直接传递显式空值，隔离外部数据源；不加载本地配置或改变生产入口。
import { createApp } from '../../apps/api/dist/src/app.js';
import { loadConfig } from '../../apps/api/dist/src/config.js';

const excluded = [
  'ALCHEMY_API_KEY',
  'ETH_RPC_URL',
  'EVM_ETHEREUM_RPC_URL',
  'EVM_ETHEREUM_RPC_URLS',
  'BSC_RPC_URL',
  'EVM_BSC_RPC_URL',
  'EVM_BSC_RPC_URLS',
  'BTC_ESPLORA_URL',
  'BITCOIN_ESPLORA_URL',
  'BITCOIN_ESPLORA_URLS',
  'SOLANA_RPC_URL',
  'SOLANA_RPC_URLS',
  'POSTGRES_URL',
  'CLICKHOUSE_URL',
  'CLICKHOUSE_USERNAME',
  'CLICKHOUSE_PASSWORD',
  'OBJECT_STORE_ENDPOINT',
  'OBJECT_STORE_ACCESS_KEY',
  'OBJECT_STORE_SECRET_KEY',
  'OBJECT_STORE_BUCKET',
];
const config = loadConfig({
  ...process.env,
  ...Object.fromEntries(excluded.map((key) => [key, ''])),
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
});
const app = await createApp({ config });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
await app.listen({ host: '127.0.0.1', port: config.port });
