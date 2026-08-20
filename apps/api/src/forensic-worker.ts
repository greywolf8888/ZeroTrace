import { setTimeout as delay } from 'node:timers/promises';

import { loadWorkspaceEnv } from './workspace-env.js';

loadWorkspaceEnv();

import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';
import { processOneForensicJob } from './workers/forensic-jobs.js';

const config = loadConfig();
const runtime = createRuntime(config);
const queue = runtime.jobQueue;

if (queue === undefined) {
  process.stderr.write('取证 worker 启动失败：POSTGRES_URL 未配置，禁止内存队列降级。\n');
  await runtime.close?.();
  process.exitCode = 1;
} else {
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const workerId = `forensic-worker:${process.pid}`;
  process.stdout.write(`取证 worker 已启动：${workerId}\n`);
  while (!stopping) {
    try {
      const result = await processOneForensicJob(queue, runtime, { workerId });
      if (result === undefined) await delay(500);
    } catch (error) {
      process.stderr.write(
        `取证 worker 循环失败：${error instanceof Error ? error.message : '未知错误'}\n`,
      );
      await delay(1_000);
    }
  }
  await runtime.close?.();
  process.stdout.write('取证 worker 已安全退出。\n');
}
