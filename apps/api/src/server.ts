import { loadWorkspaceEnv } from './workspace-env.js';

loadWorkspaceEnv();

import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp({ config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown started');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ error }, 'API startup failed');
  process.exit(1);
}
