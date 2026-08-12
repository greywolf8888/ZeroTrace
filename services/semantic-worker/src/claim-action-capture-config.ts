import { hostname } from 'node:os';

import {
  booleanValue,
  configuredUrls,
  hosts,
  integer,
  numberValue,
  providerUrl,
  required,
} from './config.js';

export interface ClaimActionsCaptureWorkerConfig {
  postgresUrl: string;
  bscRpcUrls: string[];
  sqdPortalUrl: string;
  providerAllowedHosts: string[];
  sqdAllowedHosts: string[];
  allowPrivateProviderUrls: boolean;
  requestTimeoutMs: number;
  bscRequestsPerSecond: number;
  sqdRequestsPerSecond: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  owner: string;
  pollIntervalMs: number;
  leaseSeconds: number;
  batchSize: number;
  once: boolean;
}

function workerOwner(value: string | undefined): string {
  const selected = value?.trim() || `${hostname()}:${process.pid}:claim-actions`;
  if (selected.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(selected)) {
    throw new Error('CLAIM_CAPTURE_WORKER_OWNER contains unsupported characters or is too long.');
  }
  return selected;
}

function parseArguments(args: readonly string[]): { once: boolean } {
  let once = false;
  for (const argument of args) {
    if (argument !== '--once') {
      throw new Error(`Unknown Claim Actions capture argument: ${argument}`);
    }
    if (once) throw new Error('--once may be supplied only once.');
    once = true;
  }
  return { once };
}

export function loadClaimActionsCaptureWorkerConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): ClaimActionsCaptureWorkerConfig {
  const parsed = parseArguments(args);
  const allowPrivateProviderUrls = booleanValue(
    env.ALLOW_PRIVATE_PROVIDER_URLS,
    'ALLOW_PRIVATE_PROVIDER_URLS',
  );
  const bscRpcUrls = configuredUrls(env);
  const bscUrlObjects = bscRpcUrls.map((url, index) =>
    providerUrl(url, `BSC RPC URL ${index + 1}`, allowPrivateProviderUrls),
  );
  const sqdPortalUrl = env.SQD_PORTAL_URL?.trim() || 'https://portal.sqd.dev';
  const sqdUrl = providerUrl(sqdPortalUrl, 'SQD_PORTAL_URL', allowPrivateProviderUrls);
  return {
    postgresUrl: required(env, 'POSTGRES_URL'),
    bscRpcUrls,
    sqdPortalUrl,
    providerAllowedHosts: hosts(
      env.PROVIDER_ALLOW_HOSTS,
      bscUrlObjects.map((url) => url.hostname.toLowerCase()),
    ),
    sqdAllowedHosts: hosts(env.SQD_PROVIDER_ALLOW_HOSTS, [sqdUrl.hostname.toLowerCase()]),
    allowPrivateProviderUrls,
    requestTimeoutMs: integer(env.REQUEST_TIMEOUT_MS, 'REQUEST_TIMEOUT_MS', 30_000, 1, 300_000),
    bscRequestsPerSecond: numberValue(
      env.EVM_BSC_REQUESTS_PER_SECOND,
      'EVM_BSC_REQUESTS_PER_SECOND',
      10,
      0,
      100,
    ),
    sqdRequestsPerSecond: numberValue(
      env.SQD_REQUESTS_PER_SECOND,
      'SQD_REQUESTS_PER_SECOND',
      2,
      0,
      20,
    ),
    maxAttempts: integer(env.PROVIDER_MAX_ATTEMPTS, 'PROVIDER_MAX_ATTEMPTS', 3, 1, 10),
    retryBaseDelayMs: integer(env.PROVIDER_RETRY_BASE_MS, 'PROVIDER_RETRY_BASE_MS', 250, 0, 60_000),
    retryMaxDelayMs: integer(
      env.PROVIDER_RETRY_MAX_MS,
      'PROVIDER_RETRY_MAX_MS',
      10_000,
      0,
      300_000,
    ),
    owner: workerOwner(env.CLAIM_CAPTURE_WORKER_OWNER ?? env.CAPTURE_WORKER_OWNER),
    pollIntervalMs: integer(
      env.CLAIM_CAPTURE_WORKER_POLL_INTERVAL_MS ?? env.CAPTURE_WORKER_POLL_INTERVAL_MS,
      'CLAIM_CAPTURE_WORKER_POLL_INTERVAL_MS',
      5_000,
      250,
      60_000,
    ),
    leaseSeconds: integer(
      env.CLAIM_CAPTURE_WORKER_LEASE_SECONDS ?? env.CAPTURE_WORKER_LEASE_SECONDS,
      'CLAIM_CAPTURE_WORKER_LEASE_SECONDS',
      300,
      30,
      3_600,
    ),
    batchSize: integer(
      env.CLAIM_CAPTURE_WORKER_BATCH_SIZE ?? env.CAPTURE_WORKER_BATCH_SIZE,
      'CLAIM_CAPTURE_WORKER_BATCH_SIZE',
      10,
      1,
      100,
    ),
    once:
      parsed.once ||
      booleanValue(
        env.CLAIM_CAPTURE_WORKER_ONCE ?? env.CAPTURE_WORKER_ONCE,
        'CLAIM_CAPTURE_WORKER_ONCE',
      ),
  };
}
