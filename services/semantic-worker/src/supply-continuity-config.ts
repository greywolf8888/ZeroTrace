import {
  ERC20_SUPPLY_CONTINUITY_DEFAULT_SEGMENT_SIZE,
  ERC20_SUPPLY_CONTINUITY_MAX_RANGE_BLOCKS,
  ERC20_SUPPLY_CONTINUITY_MAX_SEGMENTS,
  ERC20_SUPPLY_CONTINUITY_MAX_SEGMENT_SIZE,
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

export interface SupplyContinuityWorkerConfig {
  token: string;
  fromBlock: number;
  toBlock: number;
  segmentSize: number;
  maxTransfers: number;
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
  fromBlock?: string;
  toBlock?: string;
  segmentSize?: string;
  maxTransfers?: string;
}

function parseArguments(args: readonly string[]): Arguments {
  const result: Arguments = {};
  const supported = new Set(['--token', '--from', '--to', '--segment-size', '--max-transfers']);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!supported.has(argument ?? '')) {
      throw new Error(`Unknown supply-continuity argument: ${argument ?? ''}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === '--token') result.token = value;
    if (argument === '--from') result.fromBlock = value;
    if (argument === '--to') result.toBlock = value;
    if (argument === '--segment-size') result.segmentSize = value;
    if (argument === '--max-transfers') result.maxTransfers = value;
  }
  return result;
}

export function loadSupplyContinuityWorkerConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): SupplyContinuityWorkerConfig {
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
  const fromBlock = integer(parsed.fromBlock, '--from', undefined, 1, Number.MAX_SAFE_INTEGER);
  const toBlock = integer(parsed.toBlock, '--to', undefined, 1, Number.MAX_SAFE_INTEGER);
  if (toBlock < fromBlock) throw new Error('--to must be greater than or equal to --from.');
  if (toBlock - fromBlock + 1 > ERC20_SUPPLY_CONTINUITY_MAX_RANGE_BLOCKS) {
    throw new Error(`Requested range exceeds ${ERC20_SUPPLY_CONTINUITY_MAX_RANGE_BLOCKS} blocks.`);
  }
  const segmentSize = integer(
    parsed.segmentSize,
    '--segment-size',
    ERC20_SUPPLY_CONTINUITY_DEFAULT_SEGMENT_SIZE,
    1,
    ERC20_SUPPLY_CONTINUITY_MAX_SEGMENT_SIZE,
  );
  if (Math.ceil((toBlock - fromBlock + 1) / segmentSize) > ERC20_SUPPLY_CONTINUITY_MAX_SEGMENTS) {
    throw new Error(`Requested range exceeds ${ERC20_SUPPLY_CONTINUITY_MAX_SEGMENTS} segments.`);
  }
  const bscRpcUrls = configuredUrls(env);
  const bscUrlObjects = bscRpcUrls.map((url, index) =>
    providerUrl(url, `BSC RPC URL ${index + 1}`, allowPrivateProviderUrls),
  );
  const sqdPortalUrl = env.SQD_PORTAL_URL?.trim() || 'https://portal.sqd.dev';
  const sqdUrl = providerUrl(sqdPortalUrl, 'SQD_PORTAL_URL', allowPrivateProviderUrls);
  return {
    token,
    fromBlock,
    toBlock,
    segmentSize,
    maxTransfers: integer(parsed.maxTransfers, '--max-transfers', 25_000, 1, 100_000),
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
