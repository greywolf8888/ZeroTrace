import {
  FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS,
} from '@zerotrace/platform-adapters';
import { getAddress } from 'viem';

export interface FlapOriginWorkerConfig {
  token: string;
  fromBlock: number;
  toBlock: number;
  chunkSize: number;
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
  chunkSize?: string;
}

function parseArguments(args: readonly string[]): Arguments {
  const result: Arguments = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!['--token', '--from', '--to', '--chunk-size'].includes(argument ?? '')) {
      throw new Error(`Unknown Flap origin argument: ${argument ?? ''}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === '--token') result.token = value;
    if (argument === '--from') result.fromBlock = value;
    if (argument === '--to') result.toBlock = value;
    if (argument === '--chunk-size') result.chunkSize = value;
  }
  return result;
}

function integer(
  value: string | undefined,
  field: string,
  fallback: number | undefined,
  minimum: number,
  maximum: number,
): number {
  const selected = value ?? (fallback === undefined ? undefined : String(fallback));
  if (selected === undefined || !/^(?:0|[1-9][0-9]*)$/.test(selected)) {
    throw new Error(`${field} must be an unsigned integer.`);
  }
  const parsed = Number(selected);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function numberValue(
  value: string | undefined,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function booleanValue(value: string | undefined, field: string): boolean {
  if (value === undefined || value.trim() === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${field} must be true or false.`);
}

function required(env: NodeJS.ProcessEnv, field: string): string {
  const value = env[field]?.trim();
  if (value === undefined || value === '') throw new Error(`${field} is required.`);
  return value;
}

function configuredUrls(env: NodeJS.ProcessEnv): string[] {
  const configured =
    env.EVM_BSC_RPC_URLS?.trim() || env.EVM_BSC_RPC_URL?.trim() || env.BSC_RPC_URL?.trim() || '';
  const urls = configured
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (urls.length === 0) {
    throw new Error('EVM_BSC_RPC_URLS, EVM_BSC_RPC_URL, or BSC_RPC_URL is required.');
  }
  return [...new Set(urls)];
}

function providerUrl(value: string, field: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error(`${field} must not contain credentials, query parameters, or fragments.`);
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    throw new Error(`${field} must use HTTPS unless private-network development is explicit.`);
  }
  return url;
}

function hosts(value: string | undefined, fallback: readonly string[]): string[] {
  const selected = (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== '');
  return selected.length === 0 ? [...new Set(fallback)].sort() : [...new Set(selected)].sort();
}

export function loadFlapOriginWorkerConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): FlapOriginWorkerConfig {
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
  const fromBlock = integer(parsed.fromBlock, '--from', undefined, 0, Number.MAX_SAFE_INTEGER);
  const toBlock = integer(parsed.toBlock, '--to', undefined, 0, Number.MAX_SAFE_INTEGER);
  if (toBlock < fromBlock) throw new Error('--to must be greater than or equal to --from.');
  if (toBlock - fromBlock + 1 > FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS) {
    throw new Error(`Requested range exceeds ${FLAP_TOKEN_ORIGIN_MAX_RANGE_BLOCKS} blocks.`);
  }
  const chunkSize = integer(
    parsed.chunkSize,
    '--chunk-size',
    FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
    1,
    FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE,
  );
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
    chunkSize,
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
