import { hostname } from 'node:os';

import { booleanValue, hosts, integer, numberValue, providerUrl, required } from './config.js';

export interface TokenHistoryBackfillWorkerConfig {
  postgresUrl: string;
  clickhouseUrl: string;
  clickhouseUsername?: string;
  clickhousePassword?: string;
  objectStoreEndpoint: string;
  objectStoreAccessKey: string;
  objectStoreSecretKey: string;
  objectStoreBucket: string;
  ethereumRpcUrls: string[];
  bscRpcUrls: string[];
  sqdPortalUrl: string;
  providerAllowedHosts: string[];
  sqdAllowedHosts: string[];
  allowPrivateProviderUrls: boolean;
  requestTimeoutMs: number;
  ethereumRequestsPerSecond: number;
  bscRequestsPerSecond: number;
  sqdRequestsPerSecond: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  maxFactRows: number;
  owner: string;
  pollIntervalMs: number;
  leaseSeconds: number;
  batchSize: number;
  once: boolean;
}

const DEFAULT_BSC_RPC_URL = 'https://bsc-dataseed.bnbchain.org';

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
      throw new Error(`Unknown Token History backfill argument: ${argument}`);
    }
    if (once) throw new Error('--once may be supplied only once.');
    once = true;
  }
  return { once };
}

function urls(
  env: NodeJS.ProcessEnv,
  fields: readonly string[],
  fallback: readonly string[] = [],
): string[] {
  const raw = fields
    .map((field) => env[field]?.trim())
    .find((value) => value !== undefined && value !== '');
  const configured = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  return [...new Set(configured.length === 0 ? fallback : configured)];
}

function expandAlchemyTemplate(value: string, key: string | undefined): string | undefined {
  if (!value.includes('${ALCHEMY_API_KEY}')) return value;
  if (key === undefined || key === '') return undefined;
  return value.replaceAll('${ALCHEMY_API_KEY}', encodeURIComponent(key));
}

function validatedUrls(
  values: readonly string[],
  field: string,
  allowPrivateProviderUrls: boolean,
): string[] {
  return values.map((value, index) =>
    providerUrl(value, `${field} ${index + 1}`, allowPrivateProviderUrls).toString(),
  );
}

export function loadTokenHistoryBackfillWorkerConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): TokenHistoryBackfillWorkerConfig {
  const parsed = parseArguments(args);
  const allowPrivateProviderUrls = booleanValue(
    env.ALLOW_PRIVATE_PROVIDER_URLS,
    'ALLOW_PRIVATE_PROVIDER_URLS',
  );
  const alchemyKey = env.ALCHEMY_API_KEY?.trim();
  const ethereumConfigured = urls(env, [
    'EVM_ETHEREUM_RPC_URLS',
    'EVM_ETHEREUM_RPC_URL',
    'ETH_RPC_URL',
  ])
    .map((value) => expandAlchemyTemplate(value, alchemyKey))
    .filter((value): value is string => value !== undefined);
  const bscConfigured = urls(
    env,
    ['EVM_BSC_RPC_URLS', 'EVM_BSC_RPC_URL', 'BSC_RPC_URL'],
    [DEFAULT_BSC_RPC_URL],
  );
  const ethereumRpcUrls = validatedUrls(
    ethereumConfigured,
    'Ethereum RPC URL',
    allowPrivateProviderUrls,
  );
  const bscRpcUrls = validatedUrls(bscConfigured, 'BSC RPC URL', allowPrivateProviderUrls);
  const sqdPortalUrl = env.SQD_PORTAL_URL?.trim() || 'https://portal.sqd.dev';
  const sqdUrl = providerUrl(sqdPortalUrl, 'SQD_PORTAL_URL', allowPrivateProviderUrls);
  const providerUrlObjects = [...ethereumRpcUrls, ...bscRpcUrls].map((value) => new URL(value));
  const username = env.CLICKHOUSE_USERNAME?.trim();
  const password = env.CLICKHOUSE_PASSWORD?.trim();
  const config: TokenHistoryBackfillWorkerConfig = {
    postgresUrl: required(env, 'POSTGRES_URL'),
    clickhouseUrl: internalHttpUrl(required(env, 'CLICKHOUSE_URL'), 'CLICKHOUSE_URL'),
    ...(username === undefined || username === '' ? {} : { clickhouseUsername: username }),
    ...(password === undefined || password === '' ? {} : { clickhousePassword: password }),
    objectStoreEndpoint: internalHttpUrl(
      required(env, 'OBJECT_STORE_ENDPOINT'),
      'OBJECT_STORE_ENDPOINT',
    ),
    objectStoreAccessKey: required(env, 'OBJECT_STORE_ACCESS_KEY'),
    objectStoreSecretKey: required(env, 'OBJECT_STORE_SECRET_KEY'),
    objectStoreBucket: env.OBJECT_STORE_BUCKET?.trim() || 'zerotrace-raw',
    ethereumRpcUrls,
    bscRpcUrls,
    sqdPortalUrl: sqdUrl.toString().replace(/\/$/, ''),
    providerAllowedHosts: hosts(
      env.PROVIDER_ALLOW_HOSTS,
      providerUrlObjects.map((value) => value.hostname.toLowerCase()),
    ),
    sqdAllowedHosts: hosts(env.SQD_PROVIDER_ALLOW_HOSTS, [sqdUrl.hostname.toLowerCase()]),
    allowPrivateProviderUrls,
    requestTimeoutMs: integer(
      env.CAPTURE_WORKER_REQUEST_TIMEOUT_MS ?? env.REQUEST_TIMEOUT_MS,
      'CAPTURE_WORKER_REQUEST_TIMEOUT_MS',
      30_000,
      1_000,
      300_000,
    ),
    ethereumRequestsPerSecond: numberValue(
      env.EVM_ETHEREUM_REQUESTS_PER_SECOND,
      'EVM_ETHEREUM_REQUESTS_PER_SECOND',
      5,
      0,
      100,
    ),
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
    maxFactRows: integer(
      env.TOKEN_HISTORY_MAX_FACTS,
      'TOKEN_HISTORY_MAX_FACTS',
      250_000,
      1,
      1_000_000,
    ),
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
      900,
      30,
      3_600,
    ),
    batchSize: integer(env.CAPTURE_WORKER_BATCH_SIZE, 'CAPTURE_WORKER_BATCH_SIZE', 1, 1, 20),
    once: parsed.once || booleanValue(env.CAPTURE_WORKER_ONCE, 'CAPTURE_WORKER_ONCE'),
  };
  return config;
}
