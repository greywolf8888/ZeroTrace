import {
  FLAP_HISTORY_DEFAULT_CHUNK_SIZE,
  FLAP_HISTORY_MAX_LOGS,
  FLAP_HISTORY_MAX_TRANSACTIONS,
  FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE,
  FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE,
} from '@zerotrace/platform-adapters';
import { getAddress } from 'viem';

import {
  booleanValue,
  configuredUrls,
  hosts,
  integer,
  numberValue,
  providerUrl,
  required,
} from './config.js';

export interface FlapLifetimeWorkerConfig {
  token: string;
  targetBlock?: number;
  originChunkSize: number;
  historySegmentSize: number;
  historyChunkSize: number;
  historyMaxTransactions: number;
  historyMaxLogs: number;
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
  postgresUrl: string;
}

interface Arguments {
  token?: string;
  targetBlock?: string;
  originChunkSize?: string;
  historySegmentSize?: string;
  historyChunkSize?: string;
  historyMaxTransactions?: string;
  historyMaxLogs?: string;
}

function parseArguments(args: readonly string[]): Arguments {
  const result: Arguments = {};
  const supported = new Set([
    '--token',
    '--target',
    '--origin-chunk-size',
    '--history-segment-size',
    '--history-chunk-size',
    '--history-max-transactions',
    '--history-max-logs',
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!supported.has(argument ?? '')) {
      throw new Error(`Unknown Flap lifetime argument: ${argument ?? ''}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === '--token') result.token = value;
    if (argument === '--target') result.targetBlock = value;
    if (argument === '--origin-chunk-size') result.originChunkSize = value;
    if (argument === '--history-segment-size') result.historySegmentSize = value;
    if (argument === '--history-chunk-size') result.historyChunkSize = value;
    if (argument === '--history-max-transactions') result.historyMaxTransactions = value;
    if (argument === '--history-max-logs') result.historyMaxLogs = value;
  }
  return result;
}

export function loadFlapLifetimeWorkerConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): FlapLifetimeWorkerConfig {
  const parsed = parseArguments(args);
  const allowPrivateProviderUrls = booleanValue(
    env.ALLOW_PRIVATE_PROVIDER_URLS,
    'ALLOW_PRIVATE_PROVIDER_URLS',
  );
  const tokenInput = parsed.token?.trim();
  if (tokenInput === undefined || tokenInput === '') throw new Error('--token is required.');
  let token: string;
  try {
    token = getAddress(tokenInput).toLowerCase();
  } catch {
    throw new Error('--token must be an EVM address.');
  }
  const targetInput = parsed.targetBlock ?? (env.FLAP_LIFETIME_TARGET_BLOCK?.trim() || undefined);
  const targetBlock =
    targetInput === undefined
      ? undefined
      : integer(targetInput, '--target', undefined, 0, Number.MAX_SAFE_INTEGER);
  const originChunkSize = integer(
    parsed.originChunkSize,
    '--origin-chunk-size',
    FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
    1,
    FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE,
  );
  const historySegmentSize = integer(
    parsed.historySegmentSize,
    '--history-segment-size',
    FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE,
    1,
    FLAP_HISTORY_PROJECTION_DEFAULT_SEGMENT_SIZE,
  );
  const historyChunkSize = integer(
    parsed.historyChunkSize,
    '--history-chunk-size',
    FLAP_HISTORY_DEFAULT_CHUNK_SIZE,
    1,
    10_000,
  );
  const historyMaxTransactions = integer(
    parsed.historyMaxTransactions,
    '--history-max-transactions',
    FLAP_HISTORY_MAX_TRANSACTIONS,
    1,
    FLAP_HISTORY_MAX_TRANSACTIONS,
  );
  const historyMaxLogs = integer(
    parsed.historyMaxLogs,
    '--history-max-logs',
    FLAP_HISTORY_MAX_LOGS,
    1,
    FLAP_HISTORY_MAX_LOGS,
  );
  const bscRpcUrls = configuredUrls(env);
  const bscUrlObjects = bscRpcUrls.map((url, index) =>
    providerUrl(url, `BSC RPC URL ${index + 1}`, allowPrivateProviderUrls),
  );
  const sqdPortalUrl = env.SQD_PORTAL_URL?.trim() || 'https://portal.sqd.dev';
  const sqdUrl = providerUrl(sqdPortalUrl, 'SQD_PORTAL_URL', allowPrivateProviderUrls);
  return {
    token,
    ...(targetBlock === undefined ? {} : { targetBlock }),
    originChunkSize,
    historySegmentSize,
    historyChunkSize,
    historyMaxTransactions,
    historyMaxLogs,
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
    postgresUrl: required(env, 'POSTGRES_URL'),
  };
}
