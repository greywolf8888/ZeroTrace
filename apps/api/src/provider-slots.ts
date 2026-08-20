import {
  bulkDatasetRecord,
  defaultBscPublicCatalog,
  type BoundEndpoint,
  type ProviderCredentialRef,
  type ProviderRecord,
} from '@zerotrace/provider-plane';
import { endpointRefFromUrl, operatorFromEndpoint } from '@zerotrace/source-registry';

import type { AppConfig } from './config.js';

const KEYED_CLASSES = [
  'ANCHOR',
  'RECEIPT',
  'CODE',
  'CURRENT_STATE',
  'ARCHIVE_STATE',
  'LOGS',
  'SAMPLE_VERIFY',
] as const;

export interface ProviderPlaneBindings {
  records: ProviderRecord[];
  bindings: BoundEndpoint[];
  credentials: ProviderCredentialRef[];
  secrets: string[];
  traceAvailable: boolean;
  keyedArchiveAvailable: boolean;
}

function keyedRecord(input: {
  providerId: string;
  fetchUrl: string;
  chainId: string;
  forensicGrade: ProviderRecord['forensicGrade'];
  role: ProviderRecord['role'];
  archiveDeclared: boolean;
  logsDeclared: boolean;
  traceDeclared: boolean;
  costClass: 0 | 1 | 2;
  termsReference: string;
}): { record: ProviderRecord; binding: BoundEndpoint } {
  const operator = operatorFromEndpoint({
    endpointId: input.fetchUrl,
    chainId: input.chainId,
    forensicGrade: input.forensicGrade,
    logsCapability: input.logsDeclared ? 'declared' : 'denied',
    archiveCapability: input.archiveDeclared,
    deniedMethods: input.traceDeclared
      ? []
      : ['debug_traceTransaction', 'debug_jsTraceTransaction'],
    credentialStatus: 'CONFIGURED',
    operatorId: input.providerId,
  });
  return {
    record: {
      providerId: input.providerId,
      operatorId: operator.operatorId,
      independenceGroup: operator.independenceGroup,
      chainId: input.chainId,
      endpointRef: endpointRefFromUrl(input.fetchUrl),
      transportKind: 'json-rpc',
      forensicGrade: input.forensicGrade,
      role: input.role,
      credentialStatus: 'CONFIGURED',
      deniedMethods: input.traceDeclared
        ? []
        : [
            'debug_traceTransaction',
            'debug_jsTraceTransaction',
            'debug_traceCall',
            'debug_traceBlockByNumber',
            'trace_transaction',
          ],
      allowedMethodClasses: input.traceDeclared ? ['TRACE', 'RECEIPT', 'CODE'] : [...KEYED_CLASSES],
      archiveDeclared: input.archiveDeclared,
      logsDeclared: input.logsDeclared,
      traceDeclared: input.traceDeclared,
      startRps: 4,
      costClass: input.costClass,
      maxResponseBytes: 8_000_000,
      timeoutMs: 20_000,
      termsReference: input.termsReference,
    },
    binding: {
      providerId: input.providerId,
      operatorId: operator.operatorId,
      endpointRef: endpointRefFromUrl(input.fetchUrl),
      fetchUrl: input.fetchUrl,
      authType: 'none',
    },
  };
}

export function buildProviderPlaneBindings(config: AppConfig): ProviderPlaneBindings {
  const chainId = `eip155:${config.bscChainId}`;
  const records = [...defaultBscPublicCatalog(chainId)];
  const bindings: BoundEndpoint[] = records.map((record) => ({
    providerId: record.providerId,
    operatorId: record.operatorId,
    endpointRef: record.endpointRef,
    fetchUrl: record.endpointRef,
    authType: 'none',
  }));
  const credentials: ProviderCredentialRef[] = Object.entries(config.providerSlotStatus).map(
    ([slotId, status]) => ({
      slotId,
      status,
      authType: slotId === 'BSC_TRACE_RPC_URL' ? config.bscTraceRpcAuthType : 'none',
    }),
  );
  const secrets: string[] = [];
  const remember = (value: string | undefined) => {
    if (value !== undefined && value.length >= 8) secrets.push(value);
  };

  if (config.noderealApiKey !== undefined) {
    const key = config.noderealApiKey.reveal();
    remember(key);
    const built = keyedRecord({
      providerId: 'slot-nodereal-free',
      fetchUrl: `https://bsc-mainnet.nodereal.io/v1/${encodeURIComponent(key)}`,
      chainId,
      forensicGrade: 'FREE_KEYED',
      role: 'PRIMARY',
      archiveDeclared: true,
      logsDeclared: true,
      traceDeclared: false,
      costClass: 1,
      termsReference: 'nodereal-free',
    });
    records.push(built.record);
    bindings.push(built.binding);
  }
  if (config.ankrApiKey !== undefined) {
    const key = config.ankrApiKey.reveal();
    remember(key);
    const built = keyedRecord({
      providerId: 'slot-ankr-freemium',
      fetchUrl: `https://rpc.ankr.com/bsc/${encodeURIComponent(key)}`,
      chainId,
      forensicGrade: 'FREE_KEYED',
      role: 'PRIMARY',
      archiveDeclared: true,
      logsDeclared: true,
      traceDeclared: false,
      costClass: 1,
      termsReference: 'ankr-freemium',
    });
    records.push(built.record);
    bindings.push(built.binding);
  }
  if (config.chainstackBscRpcUrl !== undefined) {
    const url = config.chainstackBscRpcUrl.reveal();
    remember(url);
    const built = keyedRecord({
      providerId: 'slot-chainstack-bsc',
      fetchUrl: url,
      chainId,
      forensicGrade: 'FREE_KEYED',
      role: 'PRIMARY',
      archiveDeclared: true,
      logsDeclared: true,
      traceDeclared: false,
      costClass: 1,
      termsReference: 'chainstack',
    });
    records.push(built.record);
    bindings.push(built.binding);
  }
  if (config.drpcApiKey !== undefined) {
    const key = config.drpcApiKey.reveal();
    remember(key);
    const built = keyedRecord({
      providerId: 'slot-drpc',
      fetchUrl: `https://lb.drpc.org/ogrpc?network=bsc&dkey=${encodeURIComponent(key)}`,
      chainId,
      forensicGrade: 'FREE_KEYED',
      role: 'PRIMARY',
      archiveDeclared: true,
      logsDeclared: true,
      traceDeclared: false,
      costClass: 1,
      termsReference: 'drpc',
    });
    records.push(built.record);
    bindings.push(built.binding);
  }
  if (config.heliusApiKey !== undefined) {
    const key = config.heliusApiKey.reveal();
    remember(key);
    const built = keyedRecord({
      providerId: 'slot-helius',
      fetchUrl: `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`,
      chainId: 'solana-mainnet',
      forensicGrade: 'FREE_KEYED',
      role: 'PRIMARY',
      archiveDeclared: false,
      logsDeclared: false,
      traceDeclared: false,
      costClass: 1,
      termsReference: 'helius',
    });
    records.push(built.record);
    bindings.push(built.binding);
  }
  if (config.sqdPortalUrl !== undefined) {
    records.push(bulkDatasetRecord(chainId));
  }

  let traceAvailable = false;
  if (config.bscTraceRpcUrl !== undefined) {
    const url = config.bscTraceRpcUrl.reveal();
    remember(url);
    const secret = config.bscTraceRpcSecret?.reveal();
    remember(secret);
    const operator = operatorFromEndpoint({
      endpointId: url,
      chainId,
      forensicGrade: 'TRACE_SLOT',
      logsCapability: 'denied',
      credentialStatus: 'CONFIGURED',
      operatorId: config.bscTraceOperatorId,
    });
    records.push({
      providerId: 'slot-bsc-trace',
      operatorId: operator.operatorId,
      independenceGroup: operator.independenceGroup,
      chainId,
      endpointRef: endpointRefFromUrl(url),
      transportKind: 'json-rpc',
      forensicGrade: 'TRACE_SLOT',
      role: 'PRIMARY',
      credentialStatus: 'CONFIGURED',
      deniedMethods: [],
      allowedMethodClasses: ['TRACE', 'RECEIPT'],
      archiveDeclared: false,
      logsDeclared: false,
      traceDeclared: true,
      startRps: 2,
      costClass: 2,
      maxResponseBytes: 16_000_000,
      timeoutMs: 60_000,
      termsReference: 'generic-trace-slot',
    });
    bindings.push({
      providerId: 'slot-bsc-trace',
      operatorId: operator.operatorId,
      endpointRef: endpointRefFromUrl(url),
      fetchUrl: url,
      authType: config.bscTraceRpcAuthType,
      ...(secret === undefined ? {} : { authSecret: secret }),
    });
    traceAvailable = true;
  }

  return {
    records,
    bindings,
    credentials,
    secrets,
    traceAvailable,
    keyedArchiveAvailable: records.some(
      (item) => item.forensicGrade === 'FREE_KEYED' && item.archiveDeclared,
    ),
  };
}
