import { SQD_DATASETS, type SqdDataset } from '@zerotrace/chain-adapters';

export interface IngestWorkerConfig {
  dataset: SqdDataset;
  fromBlock: number;
  toBlock: number;
  portalUrl: string;
  providerPolicy: {
    allowedHosts: readonly string[];
    allowPrivateNetworks: boolean;
    allowHttpForPrivateNetworks: boolean;
  };
  requestTimeoutMs: number;
  requestsPerSecond: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  postgresUrl: string;
  clickHouseUrl: string;
  clickHouseUsername?: string;
  clickHousePassword?: string;
  objectStoreEndpoint: string;
  objectStoreAccessKey: string;
  objectStoreSecretKey: string;
  objectStoreBucket: string;
}

interface ParsedArguments {
  dataset?: string;
  fromBlock?: string;
  toBlock?: string;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const result: ParsedArguments = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!['--dataset', '--from', '--to'].includes(argument ?? '')) {
      throw new Error(`Unknown ingest argument: ${argument ?? ''}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === '--dataset') result.dataset = value;
    if (argument === '--from') result.fromBlock = value;
    if (argument === '--to') result.toBlock = value;
  }
  return result;
}

function required(env: NodeJS.ProcessEnv, field: string): string {
  const value = env[field]?.trim();
  if (value === undefined || value === '') throw new Error(`${field} is required.`);
  return value;
}

function integer(
  value: string | undefined,
  field: string,
  fallback: number | undefined,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? (fallback === undefined ? undefined : String(fallback));
  if (resolved === undefined || !/^\d+$/.test(resolved)) {
    throw new Error(`${field} must be an integer.`);
  }
  const parsed = Number(resolved);
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

function booleanValue(value: string | undefined, field: string, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${field} must be true or false.`);
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

export function loadIngestWorkerConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): IngestWorkerConfig {
  const parsed = parseArguments(args);
  if (parsed.dataset === undefined || !(parsed.dataset in SQD_DATASETS)) {
    throw new Error('--dataset must name a supported SQD dataset.');
  }
  const dataset = parsed.dataset as SqdDataset;
  const fromBlock = integer(parsed.fromBlock, '--from', undefined, 0, Number.MAX_SAFE_INTEGER);
  const toBlock = integer(parsed.toBlock, '--to', undefined, 0, Number.MAX_SAFE_INTEGER);
  if (toBlock < fromBlock) throw new Error('--to must be greater than or equal to --from.');
  const maximumRange = integer(
    env.SQD_MAX_RANGE_BLOCKS,
    'SQD_MAX_RANGE_BLOCKS',
    50_000,
    1,
    1_000_000,
  );
  if (toBlock - fromBlock + 1 > maximumRange) {
    throw new Error(`Requested range exceeds SQD_MAX_RANGE_BLOCKS (${maximumRange}).`);
  }
  const allowedHosts = (env.SQD_PROVIDER_ALLOW_HOSTS ?? 'portal.sqd.dev')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== '');
  if (allowedHosts.length === 0) throw new Error('SQD_PROVIDER_ALLOW_HOSTS must not be empty.');
  const clickHouseUsername = optional(env.CLICKHOUSE_USERNAME);
  const clickHousePassword = optional(env.CLICKHOUSE_PASSWORD);
  return {
    dataset,
    fromBlock,
    toBlock,
    portalUrl: env.SQD_PORTAL_URL?.trim() || 'https://portal.sqd.dev',
    providerPolicy: {
      allowedHosts,
      allowPrivateNetworks: booleanValue(
        env.ALLOW_PRIVATE_PROVIDER_URLS,
        'ALLOW_PRIVATE_PROVIDER_URLS',
        false,
      ),
      allowHttpForPrivateNetworks: false,
    },
    requestTimeoutMs: integer(env.REQUEST_TIMEOUT_MS, 'REQUEST_TIMEOUT_MS', 30_000, 1, 300_000),
    requestsPerSecond: numberValue(
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
    clickHouseUrl: required(env, 'CLICKHOUSE_URL'),
    ...(clickHouseUsername === undefined ? {} : { clickHouseUsername }),
    ...(clickHousePassword === undefined ? {} : { clickHousePassword }),
    objectStoreEndpoint: required(env, 'OBJECT_STORE_ENDPOINT'),
    objectStoreAccessKey: required(env, 'OBJECT_STORE_ACCESS_KEY'),
    objectStoreSecretKey: required(env, 'OBJECT_STORE_SECRET_KEY'),
    objectStoreBucket: env.OBJECT_STORE_BUCKET?.trim() || 'zerotrace-raw',
  };
}
