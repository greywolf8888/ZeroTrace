import { z } from 'zod';

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  CORS_ORIGIN: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173',
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(8_000),
  HEALTH_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
  PROVIDER_ALLOW_HOSTS: z.string().default(''),
  ALLOW_PRIVATE_PROVIDER_URLS: z.enum(['true', 'false']).default('false'),
  PROVIDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  PROVIDER_RETRY_BASE_MS: z.coerce.number().int().min(0).max(60_000).default(100),
  PROVIDER_RETRY_MAX_MS: z.coerce.number().int().min(0).max(300_000).default(2_000),
  PROVIDER_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(1_000).default(5),
  PROVIDER_CIRCUIT_RESET_MS: z.coerce.number().int().min(1).max(3_600_000).default(30_000),
  PROVIDER_CACHE_TTL_MS: z.coerce.number().int().min(0).max(3_600_000).default(1_000),
  PROVIDER_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).max(100_000).default(500),
  DATA_QUALITY_MIN_SOURCES: z.coerce.number().int().min(2).max(20).default(2),
  ALCHEMY_API_KEY: optionalString,
  ETH_RPC_URL: optionalString,
  EVM_ETHEREUM_RPC_URL: optionalString,
  EVM_ETHEREUM_RPC_URLS: optionalString,
  EVM_ETHEREUM_CHAIN_ID: z.coerce.number().int().positive().default(1),
  EVM_ETHEREUM_SNAPSHOT_TAG: z.enum(['latest', 'safe', 'finalized']).default('finalized'),
  EVM_ETHEREUM_REQUESTS_PER_SECOND: z.coerce.number().min(0).max(10_000).default(5),
  BSC_RPC_URL: optionalString,
  EVM_BSC_RPC_URL: optionalString,
  EVM_BSC_RPC_URLS: optionalString,
  EVM_BSC_CHAIN_ID: z.coerce.number().int().positive().default(56),
  EVM_BSC_SNAPSHOT_TAG: z.enum(['latest', 'safe', 'finalized']).default('finalized'),
  EVM_BSC_REQUESTS_PER_SECOND: z.coerce.number().min(0).max(10_000).default(10),
  BTC_ESPLORA_URL: optionalString,
  BITCOIN_ESPLORA_URL: optionalString,
  BITCOIN_ESPLORA_URLS: optionalString,
  BITCOIN_ESPLORA_REQUESTS_PER_SECOND: z.coerce.number().min(0).max(10_000).default(2),
  SOLANA_RPC_URL: optionalString,
  SOLANA_RPC_URLS: optionalString,
  SOLANA_REQUESTS_PER_SECOND: z.coerce.number().min(0).max(10_000).default(4),
  SOLANA_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('finalized'),
  SQD_PORTAL_URL: optionalString,
  SOURCIFY_V2_URL: optionalString,
  SOURCIFY_REQUESTS_PER_SECOND: z.coerce.number().min(0).max(100).default(2),
  POSTGRES_URL: optionalString,
  AGE_URL: optionalString,
  CLICKHOUSE_URL: optionalString,
  CLICKHOUSE_USERNAME: optionalString,
  CLICKHOUSE_PASSWORD: optionalString,
  OBJECT_STORE_ENDPOINT: optionalString,
  OBJECT_STORE_ACCESS_KEY: optionalString,
  OBJECT_STORE_SECRET_KEY: optionalString,
  OBJECT_STORE_BUCKET: optionalString,
  GMGN_API_KEY: optionalString,
  JUPITER_API_KEY: optionalString,
  ETHERSCAN_API_KEY: optionalString,
  DUNE_API_KEY: optionalString,
  NANSEN_API_KEY: optionalString,
  ARKHAM_API_KEY: optionalString,
  OIDC_ISSUER: optionalString,
  OIDC_AUDIENCE: optionalString,
  LOCAL_DEV_AUTH: z.enum(['0', '1']).default('0'),
});

export interface ProviderResilienceConfig {
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
}

export interface ConfigSecret {
  reveal(): string;
  toJSON(): '[REDACTED]';
}

export interface AppConfig {
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  corsOrigins: string[];
  logLevel: string;
  requestTimeoutMs: number;
  healthCacheTtlMs: number;
  providerAllowedHosts: string[];
  allowPrivateProviderUrls: boolean;
  providerResilience: ProviderResilienceConfig;
  dataQualityMinSources: number;
  ethereumRpcUrl?: string;
  ethereumRpcUrls: string[];
  ethereumChainId: number;
  ethereumSnapshotTag: 'latest' | 'safe' | 'finalized';
  ethereumRequestsPerSecond: number;
  bscRpcUrl?: string;
  bscRpcUrls: string[];
  bscChainId: number;
  bscSnapshotTag: 'latest' | 'safe' | 'finalized';
  bscRequestsPerSecond: number;
  bitcoinEsploraUrl?: string;
  bitcoinEsploraUrls: string[];
  bitcoinEsploraRequestsPerSecond: number;
  solanaRpcUrl?: string;
  solanaRpcUrls: string[];
  solanaRequestsPerSecond: number;
  solanaCommitment: 'processed' | 'confirmed' | 'finalized';
  sqdPortalUrl?: string;
  sourcifyV2Url?: string;
  sourcifyRequestsPerSecond: number;
  postgresUrl?: string;
  ageUrl?: string;
  clickhouseUrl?: string;
  clickhouseUsername?: string;
  clickhousePassword?: ConfigSecret;
  objectStoreEndpoint?: string;
  objectStoreAccessKey?: string;
  objectStoreSecretKey?: ConfigSecret;
  objectStoreBucket?: string;
  gmgnConfigured: boolean;
  jupiterConfigured: boolean;
  etherscanConfigured: boolean;
  duneConfigured: boolean;
  nansenConfigured: boolean;
  arkhamConfigured: boolean;
  oidcIssuer?: string;
  oidcAudience?: string;
  localDevAuth: boolean;
}

function splitUrls(value: string | undefined): string[] {
  return (
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function validateUrl(rawUrl: string, field: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid protocol');
    return url.toString().replace(/\/$/, rawUrl.endsWith('/') ? '/' : '');
  } catch {
    throw new Error(`${field} must contain valid HTTP(S) provider URLs.`);
  }
}

function providerUrls(
  field: string,
  values: Array<string | undefined>,
  alchemyApiKey?: string,
): string[] {
  const expanded = values
    .flatMap(splitUrls)
    .flatMap((value) => {
      if (!value.includes('${ALCHEMY_API_KEY}')) return [value];
      return alchemyApiKey === undefined
        ? []
        : [value.replaceAll('${ALCHEMY_API_KEY}', encodeURIComponent(alchemyApiKey))];
    })
    .map((value) => validateUrl(value, field));
  return [...new Set(expanded)];
}

function optionalUrl(rawUrl: string | undefined, field: string): string | undefined {
  return rawUrl === undefined ? undefined : validateUrl(rawUrl, field);
}

function optionalOrigin(rawUrl: string | undefined, field: string): string | undefined {
  if (rawUrl === undefined) return undefined;
  try {
    const url = new URL(rawUrl);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username !== '' ||
      url.password !== '' ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new Error('invalid origin');
    }
    return url.origin;
  } catch {
    throw new Error(`${field} must be a valid HTTP(S) origin without embedded credentials.`);
  }
}

function secret(value: string): ConfigSecret {
  return Object.freeze({
    reveal: () => value,
    toJSON: () => '[REDACTED]' as const,
  });
}

function optionalPostgresUrl(rawUrl: string | undefined, field: string): string | undefined {
  if (rawUrl === undefined) return undefined;
  try {
    const url = new URL(rawUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('invalid protocol');
    return rawUrl;
  } catch {
    throw new Error(`${field} must be a valid PostgreSQL connection URL.`);
  }
}

function firstUrl(values: readonly string[]): { primary?: string } {
  const primary = values[0];
  return primary === undefined ? {} : { primary };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
  const ethereumRpcUrls = providerUrls(
    'Ethereum RPC',
    [parsed.EVM_ETHEREUM_RPC_URLS, parsed.EVM_ETHEREUM_RPC_URL, parsed.ETH_RPC_URL],
    parsed.ALCHEMY_API_KEY,
  );
  if (ethereumRpcUrls.length === 0 && parsed.ALCHEMY_API_KEY !== undefined) {
    ethereumRpcUrls.push(
      `https://eth-mainnet.g.alchemy.com/v2/${encodeURIComponent(parsed.ALCHEMY_API_KEY)}`,
    );
  }
  const bscRpcUrls = providerUrls(
    'BSC RPC',
    [parsed.EVM_BSC_RPC_URLS, parsed.EVM_BSC_RPC_URL, parsed.BSC_RPC_URL],
    parsed.ALCHEMY_API_KEY,
  );
  const bitcoinEsploraUrls = providerUrls('Bitcoin Esplora', [
    parsed.BITCOIN_ESPLORA_URLS,
    parsed.BITCOIN_ESPLORA_URL,
    parsed.BTC_ESPLORA_URL,
  ]);
  const solanaRpcUrls = providerUrls('Solana RPC', [parsed.SOLANA_RPC_URLS, parsed.SOLANA_RPC_URL]);
  const ethereumPrimary = firstUrl(ethereumRpcUrls).primary;
  const bscPrimary = firstUrl(bscRpcUrls).primary;
  const bitcoinPrimary = firstUrl(bitcoinEsploraUrls).primary;
  const solanaPrimary = firstUrl(solanaRpcUrls).primary;
  const sqdPortalUrl = optionalUrl(parsed.SQD_PORTAL_URL, 'SQD Portal URL');
  const sourcifyV2Url = optionalUrl(parsed.SOURCIFY_V2_URL, 'Sourcify V2 URL');
  const postgresUrl = optionalPostgresUrl(parsed.POSTGRES_URL, 'POSTGRES_URL');
  const ageUrl = optionalPostgresUrl(parsed.AGE_URL, 'AGE_URL');
  const clickhouseUrl = optionalOrigin(parsed.CLICKHOUSE_URL, 'CLICKHOUSE_URL');
  const objectStoreEndpoint = optionalOrigin(parsed.OBJECT_STORE_ENDPOINT, 'OBJECT_STORE_ENDPOINT');
  if (
    clickhouseUrl === undefined &&
    (parsed.CLICKHOUSE_USERNAME !== undefined || parsed.CLICKHOUSE_PASSWORD !== undefined)
  ) {
    throw new Error('CLICKHOUSE_URL is required when ClickHouse credentials are configured.');
  }
  const objectStoreValues = [
    objectStoreEndpoint,
    parsed.OBJECT_STORE_ACCESS_KEY,
    parsed.OBJECT_STORE_SECRET_KEY,
  ];
  const configuredObjectStoreValues = objectStoreValues.filter(
    (value): value is string => value !== undefined,
  );
  if (configuredObjectStoreValues.length > 0 && configuredObjectStoreValues.length !== 3) {
    throw new Error(
      'OBJECT_STORE_ENDPOINT, OBJECT_STORE_ACCESS_KEY, and OBJECT_STORE_SECRET_KEY must be configured together.',
    );
  }

  return {
    environment: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.API_PORT,
    corsOrigins: parsed.CORS_ORIGIN.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    logLevel: parsed.LOG_LEVEL,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    healthCacheTtlMs: parsed.HEALTH_CACHE_TTL_MS,
    providerAllowedHosts: parsed.PROVIDER_ALLOW_HOSTS.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    allowPrivateProviderUrls: parsed.ALLOW_PRIVATE_PROVIDER_URLS === 'true',
    providerResilience: {
      maxAttempts: parsed.PROVIDER_MAX_ATTEMPTS,
      retryBaseDelayMs: parsed.PROVIDER_RETRY_BASE_MS,
      retryMaxDelayMs: parsed.PROVIDER_RETRY_MAX_MS,
      circuitFailureThreshold: parsed.PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
      circuitResetMs: parsed.PROVIDER_CIRCUIT_RESET_MS,
      cacheTtlMs: parsed.PROVIDER_CACHE_TTL_MS,
      cacheMaxEntries: parsed.PROVIDER_CACHE_MAX_ENTRIES,
    },
    dataQualityMinSources: parsed.DATA_QUALITY_MIN_SOURCES,
    ethereumRpcUrls,
    ethereumChainId: parsed.EVM_ETHEREUM_CHAIN_ID,
    ethereumSnapshotTag: parsed.EVM_ETHEREUM_SNAPSHOT_TAG,
    ethereumRequestsPerSecond: parsed.EVM_ETHEREUM_REQUESTS_PER_SECOND,
    bscRpcUrls,
    bscChainId: parsed.EVM_BSC_CHAIN_ID,
    bscSnapshotTag: parsed.EVM_BSC_SNAPSHOT_TAG,
    bscRequestsPerSecond: parsed.EVM_BSC_REQUESTS_PER_SECOND,
    bitcoinEsploraUrls,
    bitcoinEsploraRequestsPerSecond: parsed.BITCOIN_ESPLORA_REQUESTS_PER_SECOND,
    solanaRpcUrls,
    solanaRequestsPerSecond: parsed.SOLANA_REQUESTS_PER_SECOND,
    solanaCommitment: parsed.SOLANA_COMMITMENT,
    sourcifyRequestsPerSecond: parsed.SOURCIFY_REQUESTS_PER_SECOND,
    gmgnConfigured: parsed.GMGN_API_KEY !== undefined,
    jupiterConfigured: parsed.JUPITER_API_KEY !== undefined,
    etherscanConfigured: parsed.ETHERSCAN_API_KEY !== undefined,
    duneConfigured: parsed.DUNE_API_KEY !== undefined,
    nansenConfigured: parsed.NANSEN_API_KEY !== undefined,
    arkhamConfigured: parsed.ARKHAM_API_KEY !== undefined,
    localDevAuth: parsed.LOCAL_DEV_AUTH === '1',
    ...(parsed.OIDC_ISSUER === undefined ? {} : { oidcIssuer: parsed.OIDC_ISSUER }),
    ...(parsed.OIDC_AUDIENCE === undefined ? {} : { oidcAudience: parsed.OIDC_AUDIENCE }),
    ...(ethereumPrimary === undefined ? {} : { ethereumRpcUrl: ethereumPrimary }),
    ...(bscPrimary === undefined ? {} : { bscRpcUrl: bscPrimary }),
    ...(bitcoinPrimary === undefined ? {} : { bitcoinEsploraUrl: bitcoinPrimary }),
    ...(solanaPrimary === undefined ? {} : { solanaRpcUrl: solanaPrimary }),
    ...(sqdPortalUrl === undefined ? {} : { sqdPortalUrl }),
    ...(sourcifyV2Url === undefined ? {} : { sourcifyV2Url }),
    ...(postgresUrl === undefined ? {} : { postgresUrl }),
    ...(ageUrl === undefined ? {} : { ageUrl }),
    ...(clickhouseUrl === undefined ? {} : { clickhouseUrl }),
    ...(parsed.CLICKHOUSE_USERNAME === undefined
      ? {}
      : { clickhouseUsername: parsed.CLICKHOUSE_USERNAME }),
    ...(parsed.CLICKHOUSE_PASSWORD === undefined
      ? {}
      : { clickhousePassword: secret(parsed.CLICKHOUSE_PASSWORD) }),
    ...(objectStoreEndpoint === undefined
      ? {}
      : {
          objectStoreEndpoint,
          objectStoreAccessKey: parsed.OBJECT_STORE_ACCESS_KEY as string,
          objectStoreSecretKey: secret(parsed.OBJECT_STORE_SECRET_KEY as string),
          objectStoreBucket: parsed.OBJECT_STORE_BUCKET ?? 'zerotrace-raw',
        }),
  };
}
