const configuredBase = import.meta.env.VITE_API_URL as string | undefined;
const API_BASE = (configuredBase ?? '').replace(/\/$/, '');

export interface KnowledgeValue<T> {
  state: 'known' | 'unknown' | 'unavailable';
  value?: T;
  reason?: string;
  detail?: string;
}

export interface ProviderHealth {
  id: string;
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  status: 'UP' | 'DEGRADED' | 'DOWN' | 'UNCONFIGURED' | 'RATE_LIMITED';
  capabilities: string[];
  checkedAt: string;
  latencyMs: number | null;
  head: KnowledgeValue<string>;
  lag: KnowledgeValue<number>;
  errorCode?: string;
  errorDetail?: string;
  transport?: {
    endpointId: string;
    activeEndpointId?: string;
    circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    circuitOpenUntil: string | null;
    logicalRequests: number;
    attempts: number;
    successes: number;
    failures: number;
    retries: number;
    rateLimitDelays: number;
    cacheHits: number;
    cacheMisses: number;
    cacheBypasses: number;
    failovers: number;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  };
}

export interface StorageHealth {
  status: 'UP' | 'DOWN' | 'EPHEMERAL';
  backend: 'POSTGRES' | 'MEMORY';
  durable: boolean;
  checkedAt: string;
  errorCode?: string;
}

export interface HealthResponse {
  status: 'UP' | 'DEGRADED';
  service: string;
  readOnly: boolean;
  providers: ProviderHealth[];
  storage: StorageHealth;
  ingestionStorage: {
    status: 'UP' | 'DOWN' | 'PARTIAL' | 'UNCONFIGURED';
    configured: number;
    required: number;
    checkedAt: string;
    rawFacts: IngestionStorageComponentHealth;
    checkpoints: IngestionStorageComponentHealth;
    artifacts: IngestionStorageComponentHealth & { bucket?: string };
  };
  dataQuality: DataQualityHealth;
  checkedAt: string;
}

export interface ChainAnchorObservation {
  id: string;
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  chainId: string;
  position: string;
  hash: string;
  parentPosition?: string;
  parentHash?: string;
  finality: string;
  source: string;
  observedAt: string;
  role: 'HEAD' | 'COMPARISON' | 'CONTINUITY_CHECK';
  evidenceId: string;
}

export interface DataQualityAlert {
  id: string;
  kind: 'CROSS_SOURCE_DISAGREEMENT' | 'REORG_DETECTED' | 'SOURCE_REGRESSION';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  chainId: string;
  position?: string;
  summary: string;
  evidenceIds: string[];
  observedAt: string;
}

export interface AnchorReconciliationResult {
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  chainId: string;
  status: 'AGREEMENT' | 'DISAGREEMENT' | 'INSUFFICIENT_SOURCES' | 'UNAVAILABLE';
  requiredSources: number;
  configuredSources: number;
  observedSources: number;
  comparisonPosition: KnowledgeValue<string>;
  canonicalAnchor: KnowledgeValue<{
    position: string;
    hash: string;
    parentPosition?: string;
    parentHash?: string;
    finality: string;
  }>;
  sourceIndependence: KnowledgeValue<boolean>;
  sources: Array<{
    source: string;
    head: KnowledgeValue<ChainAnchorObservation>;
    comparison: KnowledgeValue<ChainAnchorObservation>;
    continuity?: {
      status: string;
      continuous: KnowledgeValue<boolean>;
      evidenceIds: string[];
      alertIds: string[];
    };
  }>;
  alerts: DataQualityAlert[];
  metadata: AnalysisMetadata;
}

export interface DataQualityHealth {
  status: 'UP' | 'PARTIAL' | 'INSUFFICIENT_SOURCES' | 'UNCONFIGURED' | 'DEGRADED' | 'DOWN';
  durable: boolean;
  checkedAt: string;
  configuredSources: Record<string, number>;
  results: AnchorReconciliationResult[];
  storage: StorageHealth;
  errorCode?: string;
}

export interface IngestionStorageComponentHealth {
  status: 'UP' | 'DOWN' | 'UNCONFIGURED';
  backend: 'CLICKHOUSE' | 'POSTGRES' | 'S3_COMPATIBLE';
  durable: true;
  checkedAt: string;
  errorCode?: string;
}

export interface SubjectCandidate {
  ledger: 'EVM' | 'BITCOIN' | 'SOLANA';
  chainId: string;
  type: string;
  id: string;
  normalizedId: string;
  validation: string;
  confidence: number;
}

export interface AnalysisMetadata {
  snapshot: Record<string, unknown> | null;
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  simulationCoverage: number;
  freshness: string | null;
  sourceSet: string[];
  modelVersion: string;
  confidence: number;
  evidenceIds: string[];
}

export interface SearchResponse {
  query: string;
  candidates: SubjectCandidate[];
  rejectedReason?: string;
  metadata: AnalysisMetadata;
}

export interface EvidenceRecord {
  id: string;
  ledger: string;
  chainId: string;
  kind: string;
  source: string;
  locator: string;
  payloadHash: string;
  observedAt: string;
  summary: string;
  blockOrSlot?: string;
  finality?: string;
}

export interface SubjectResponse {
  subject: SubjectCandidate;
  facts: Record<string, KnowledgeValue<unknown>>;
  metadata: AnalysisMetadata;
  evidence?: EvidenceRecord[];
  consistency?: string;
}

export interface PlatformDescriptor {
  id: string;
  name: string;
  roles: string[];
  ledgers: string[];
  implementationStatus: string;
  officialSources: string[];
  integrationBoundary: string;
}

export interface Capability {
  id: string;
  status: string;
  detail?: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'object' &&
      payload.error !== null &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : 'Request failed with HTTP ' + response.status + '.';
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  health: (signal?: AbortSignal) =>
    requestJson<HealthResponse>('/health', signal === undefined ? {} : { signal }),
  capabilities: (signal?: AbortSignal) =>
    requestJson<{ core: Capability[]; boundaries: Record<string, string> }>(
      '/api/v1/capabilities',
      signal === undefined ? {} : { signal },
    ),
  platforms: (signal?: AbortSignal) =>
    requestJson<{ platforms: PlatformDescriptor[]; gmgnConfigured: boolean }>(
      '/api/v1/platforms',
      signal === undefined ? {} : { signal },
    ),
  search: (query: string, ledger?: string, chainId?: string) => {
    const parameters = new URLSearchParams({ q: query });
    if (ledger !== undefined) parameters.set('ledger', ledger);
    if (chainId !== undefined) parameters.set('chainId', chainId);
    return requestJson<SearchResponse>('/api/v1/search?' + parameters.toString());
  },
  subject: (candidate: SubjectCandidate) => {
    const parameters = new URLSearchParams({ chainId: candidate.chainId });
    return requestJson<SubjectResponse>(
      '/api/v1/subjects/' +
        candidate.ledger +
        '/' +
        encodeURIComponent(candidate.normalizedId) +
        '?' +
        parameters.toString(),
    );
  },
  exitRace: (payload: unknown) =>
    requestJson<Record<string, unknown>>('/api/v1/scenarios/exit-race', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
