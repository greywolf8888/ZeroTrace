import { hostname } from 'node:os';

import { booleanValue, integer, required } from './config.js';

export interface ActionCaptureWorkerConfig {
  postgresUrl: string;
  clickhouseUrl: string;
  clickhouseUsername?: string;
  clickhousePassword?: string;
  owner: string;
  pollIntervalMs: number;
  leaseSeconds: number;
  batchSize: number;
  requestTimeoutMs: number;
  once: boolean;
}

function internalHttpUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(`${field} must be an HTTP(S) URL without embedded credentials or fragments.`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function workerOwner(value: string | undefined): string {
  const selected = value?.trim() || `${hostname()}:${process.pid}`;
  if (selected.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(selected)) {
    throw new Error('CAPTURE_WORKER_OWNER contains unsupported characters or is too long.');
  }
  return selected;
}

function parseArguments(args: readonly string[]): { once: boolean } {
  let once = false;
  for (const argument of args) {
    if (argument !== '--once') {
      throw new Error(`Unknown Action Semantics capture argument: ${argument}`);
    }
    if (once) throw new Error('--once may be supplied only once.');
    once = true;
  }
  return { once };
}

export function loadActionCaptureWorkerConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): ActionCaptureWorkerConfig {
  const parsed = parseArguments(args);
  const username = env.CLICKHOUSE_USERNAME?.trim();
  const password = env.CLICKHOUSE_PASSWORD?.trim();
  return {
    postgresUrl: required(env, 'POSTGRES_URL'),
    clickhouseUrl: internalHttpUrl(required(env, 'CLICKHOUSE_URL'), 'CLICKHOUSE_URL'),
    ...(username === undefined || username === '' ? {} : { clickhouseUsername: username }),
    ...(password === undefined || password === '' ? {} : { clickhousePassword: password }),
    owner: workerOwner(env.CAPTURE_WORKER_OWNER),
    pollIntervalMs: integer(
      env.CAPTURE_WORKER_POLL_INTERVAL_MS,
      'CAPTURE_WORKER_POLL_INTERVAL_MS',
      5_000,
      250,
      60_000,
    ),
    leaseSeconds: integer(
      env.CAPTURE_WORKER_LEASE_SECONDS,
      'CAPTURE_WORKER_LEASE_SECONDS',
      300,
      30,
      3_600,
    ),
    batchSize: integer(env.CAPTURE_WORKER_BATCH_SIZE, 'CAPTURE_WORKER_BATCH_SIZE', 10, 1, 100),
    requestTimeoutMs: integer(
      env.CAPTURE_WORKER_REQUEST_TIMEOUT_MS ?? env.REQUEST_TIMEOUT_MS,
      'CAPTURE_WORKER_REQUEST_TIMEOUT_MS',
      30_000,
      1_000,
      300_000,
    ),
    once: parsed.once || booleanValue(env.CAPTURE_WORKER_ONCE, 'CAPTURE_WORKER_ONCE'),
  };
}
