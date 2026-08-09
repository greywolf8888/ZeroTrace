import { z } from 'zod';

const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.url().optional());
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(8_000),
  HEALTH_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
  PROVIDER_ALLOW_HOSTS: z.string().default(''),
  ALLOW_PRIVATE_PROVIDER_URLS: z.enum(['true', 'false']).default('false'),
  EVM_ETHEREUM_RPC_URL: optionalUrl,
  EVM_ETHEREUM_CHAIN_ID: z.coerce.number().int().positive().default(1),
  EVM_BSC_RPC_URL: optionalUrl,
  EVM_BSC_CHAIN_ID: z.coerce.number().int().positive().default(56),
  BITCOIN_ESPLORA_URL: optionalUrl,
  SOLANA_RPC_URL: optionalUrl,
  SOLANA_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('finalized'),
  POSTGRES_URL: optionalString,
  GMGN_API_KEY: optionalString,
});

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
  ethereumRpcUrl?: string;
  ethereumChainId: number;
  bscRpcUrl?: string;
  bscChainId: number;
  bitcoinEsploraUrl?: string;
  solanaRpcUrl?: string;
  solanaCommitment: 'processed' | 'confirmed' | 'finalized';
  postgresUrl?: string;
  gmgnConfigured: boolean;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
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
    ethereumChainId: parsed.EVM_ETHEREUM_CHAIN_ID,
    bscChainId: parsed.EVM_BSC_CHAIN_ID,
    solanaCommitment: parsed.SOLANA_COMMITMENT,
    gmgnConfigured: parsed.GMGN_API_KEY !== undefined,
    ...(parsed.EVM_ETHEREUM_RPC_URL === undefined
      ? {}
      : { ethereumRpcUrl: parsed.EVM_ETHEREUM_RPC_URL }),
    ...(parsed.EVM_BSC_RPC_URL === undefined ? {} : { bscRpcUrl: parsed.EVM_BSC_RPC_URL }),
    ...(parsed.BITCOIN_ESPLORA_URL === undefined
      ? {}
      : { bitcoinEsploraUrl: parsed.BITCOIN_ESPLORA_URL }),
    ...(parsed.SOLANA_RPC_URL === undefined ? {} : { solanaRpcUrl: parsed.SOLANA_RPC_URL }),
    ...(parsed.POSTGRES_URL === undefined ? {} : { postgresUrl: parsed.POSTGRES_URL }),
  };
}
