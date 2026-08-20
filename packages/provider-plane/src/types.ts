export type MethodClass =
  | 'ANCHOR'
  | 'RECEIPT'
  | 'CODE'
  | 'CURRENT_STATE'
  | 'ARCHIVE_STATE'
  | 'LOGS'
  | 'TRACE'
  | 'BATCH'
  | 'SAMPLE_VERIFY';

export type TransportKind = 'json-rpc' | 'bulk-dataset';

export type ProviderRole = 'PRIMARY' | 'SHADOW' | 'FALLBACK';

export type AuthType = 'none' | 'bearer' | 'header' | 'query';

export interface ProviderCredentialRef {
  slotId: string;
  status: 'CONFIGURED' | 'UNCONFIGURED';
  authType: AuthType;
}

export interface ProviderRecord {
  providerId: string;
  operatorId: string;
  independenceGroup: string;
  chainId: string;
  endpointRef: string;
  transportKind: TransportKind;
  forensicGrade:
    | 'PUBLIC_NO_SLA'
    | 'FREE_KEYED'
    | 'PAID_SHADOW'
    | 'PAID_PRIMARY'
    | 'BULK_INDEX'
    | 'ARCHIVE_SELF_HOSTED'
    | 'TRACE_SLOT';
  role: ProviderRole;
  credentialStatus: 'NONE' | 'CONFIGURED' | 'UNCONFIGURED';
  deniedMethods: readonly string[];
  allowedMethodClasses: readonly MethodClass[];
  archiveDeclared: boolean;
  logsDeclared: boolean;
  traceDeclared: boolean;
  startRps: number;
  costClass: 0 | 1 | 2;
  maxResponseBytes: number;
  timeoutMs: number;
  termsReference: string;
}

export interface BoundEndpoint {
  providerId: string;
  operatorId: string;
  endpointRef: string;
  fetchUrl: string;
  authType: AuthType;
  authSecret?: string;
  headerName?: string;
}

export interface QueryRequest {
  chainId: string;
  method: string;
  params: unknown[];
  blockHeight?: bigint;
  archiveRequired?: boolean;
  traceRequired?: boolean;
  loadBearing?: boolean;
  allowShadow?: boolean;
  tenant?: string;
  job?: string;
  maxResponseBytes?: number;
}

export interface ProviderSelectionEvidence {
  method: string;
  methodClass: MethodClass;
  selected: Array<{
    providerId: string;
    operatorId: string;
    independenceGroup: string;
    endpointRef: string;
    forensicGrade: ProviderRecord['forensicGrade'];
    role: ProviderRole;
    costClass: 0 | 1 | 2;
  }>;
  rejected: Array<{ providerId: string; reason: string }>;
  unavailableReason?: string;
}

export type QuerySource =
  | 'LOCAL_INDEX'
  | 'CONTENT_CACHE'
  | 'BULK_DATASET'
  | 'RPC_GAP'
  | 'INDEPENDENT_VERIFY'
  | 'TRACE_CRITICAL';

export interface QueryPlanStep {
  id: string;
  source: QuerySource;
  method: string;
  estimatedRpcCost: number;
  loadBearing: boolean;
}

export interface QueryPlan {
  steps: QueryPlanStep[];
  estimatedRpcCost: number;
  localIndexFirst: boolean;
  forbidPerTokenPublicLogs: boolean;
  cursorAdvanceRequiresPersist: true;
}

export interface ProviderCapabilitySnapshot {
  providerId: string;
  operatorId: string;
  endpointRef: string;
  probedAt: string;
  chainIdOk: boolean;
  finalizedOk: boolean;
  historicalCodeOk: boolean;
  historicalCallOk: boolean;
  smallLogsOk: boolean | 'POLICY_DENIED';
  traceOk: boolean | 'UNCONFIGURED';
  batchOk: boolean;
  timeoutMsObserved?: number;
  retryAfterObserved?: boolean;
  maxResponseBytes: number;
  error?: string;
}

export interface ShadowMetrics {
  completionRate: number;
  originTraceCompletion: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  rateLimited: number;
  timeouts: number;
  coverage: number;
  sourceConflicts: number;
  requestCost: number;
  costPerCompletedCase: number;
  resultHashDiffs: number;
  closedCriticalCapability: boolean;
}

export interface UsageCounter {
  providerId: string;
  requests: number;
  bytes: number;
  throttles: number;
  errors: number;
}
