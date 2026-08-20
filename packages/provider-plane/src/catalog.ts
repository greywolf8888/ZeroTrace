import {
  BSC_PUBLIC_NO_SLA_ENDPOINTS,
  isOfficialBnbPublicDataseed,
  operatorFromEndpoint,
  PUBLIC_NO_SLA_DENIED_METHODS,
} from '@zerotrace/source-registry';

import type { MethodClass, ProviderRecord } from './types.js';

export const TRACE_METHODS = [
  'debug_traceTransaction',
  'debug_traceCall',
  'debug_traceBlockByNumber',
  'debug_jsTraceTransaction',
  'trace_transaction',
  'trace_block',
  'trace_call',
  'trace_filter',
] as const;

const PUBLIC_CLASSES: MethodClass[] = [
  'ANCHOR',
  'RECEIPT',
  'CODE',
  'CURRENT_STATE',
  'SAMPLE_VERIFY',
];

export function methodClassOf(method: string, params: unknown[] = []): MethodClass {
  if (method === 'eth_getLogs') return 'LOGS';
  if ((TRACE_METHODS as readonly string[]).includes(method)) return 'TRACE';
  if (method === 'eth_getTransactionReceipt' || method === 'eth_getTransactionByHash') {
    return 'RECEIPT';
  }
  if (method === 'eth_getCode') {
    return isHistoricalBlock(params[1]) ? 'ARCHIVE_STATE' : 'CODE';
  }
  if (method === 'eth_call' || method === 'eth_getBalance' || method === 'eth_getStorageAt') {
    const tag = method === 'eth_call' ? params[1] : params[1];
    return isHistoricalBlock(tag) ? 'ARCHIVE_STATE' : 'CURRENT_STATE';
  }
  if (
    method === 'eth_chainId' ||
    method === 'eth_blockNumber' ||
    method.startsWith('eth_getBlock')
  ) {
    return 'ANCHOR';
  }
  return 'ANCHOR';
}

export function isHistoricalBlock(tag: unknown): boolean {
  if (typeof tag !== 'string') return false;
  const normalized = tag.toLowerCase();
  if (
    normalized === 'latest' ||
    normalized === 'pending' ||
    normalized === 'safe' ||
    normalized === 'finalized'
  ) {
    return false;
  }
  return normalized.startsWith('0x') || /^\d+$/.test(normalized);
}

export function defaultBscPublicCatalog(chainId = 'eip155:56'): ProviderRecord[] {
  return BSC_PUBLIC_NO_SLA_ENDPOINTS.map((endpoint, index) => {
    const operator = operatorFromEndpoint({ endpointId: endpoint, chainId });
    return {
      providerId: `public-${operator.independenceGroup}-${index}`,
      operatorId: operator.operatorId,
      independenceGroup: operator.independenceGroup,
      chainId,
      endpointRef: operator.endpointId,
      transportKind: 'json-rpc',
      forensicGrade: 'PUBLIC_NO_SLA',
      role: 'PRIMARY',
      credentialStatus: 'NONE',
      deniedMethods: [
        ...PUBLIC_NO_SLA_DENIED_METHODS,
        ...(isOfficialBnbPublicDataseed(endpoint) ? (['eth_getLogs'] as const) : []),
      ],
      allowedMethodClasses: PUBLIC_CLASSES,
      archiveDeclared: false,
      logsDeclared: false,
      traceDeclared: false,
      startRps: 4,
      costClass: 0,
      maxResponseBytes: 2_000_000,
      timeoutMs: 8_000,
      termsReference: operator.termsReference,
    };
  });
}

export function bulkDatasetRecord(chainId = 'eip155:56'): ProviderRecord {
  return {
    providerId: 'bulk-sqd-binance-mainnet',
    operatorId: 'sqd-portal',
    independenceGroup: 'sqd-portal',
    chainId,
    endpointRef: 'https://portal.sqd.dev',
    transportKind: 'bulk-dataset',
    forensicGrade: 'BULK_INDEX',
    role: 'PRIMARY',
    credentialStatus: 'NONE',
    deniedMethods: [...TRACE_METHODS],
    allowedMethodClasses: ['LOGS', 'ANCHOR'],
    archiveDeclared: true,
    logsDeclared: true,
    traceDeclared: false,
    startRps: 2,
    costClass: 0,
    maxResponseBytes: 32_000_000,
    timeoutMs: 60_000,
    termsReference: 'sqd-portal',
  };
}
