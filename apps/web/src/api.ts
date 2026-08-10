const configuredBase = import.meta.env.VITE_API_URL as string | undefined;
const API_BASE = (configuredBase ?? '').replace(/\/$/, '');

export interface KnowledgeValue<T> {
  state: 'known' | 'unknown' | 'unavailable' | 'stale';
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

export type IntelligenceResponse = SubjectResponse;

export interface LaunchMechanismSnapshot {
  platform: string;
  platformVersion: KnowledgeValue<string>;
  deploymentId: KnowledgeValue<string>;
  factoryOrProgram: KnowledgeValue<string>;
  lifecycle: string;
  quoteAsset: KnowledgeValue<string>;
  curveType: KnowledgeValue<string>;
  realQuoteReserve: KnowledgeValue<string>;
  virtualBaseReserve: KnowledgeValue<string>;
  virtualQuoteReserve: KnowledgeValue<string>;
  circulatingSupply: KnowledgeValue<string>;
  remainingSupply: KnowledgeValue<string>;
  progress: KnowledgeValue<string>;
  graduationThreshold: KnowledgeValue<string>;
  currentSellCapacity: KnowledgeValue<string>;
  taxModel: KnowledgeValue<string>;
  buyTaxBps: KnowledgeValue<string>;
  sellTaxBps: KnowledgeValue<string>;
  migrationPool: KnowledgeValue<string>;
  lpLocked: KnowledgeValue<boolean>;
  lpBurned: KnowledgeValue<boolean>;
  sourceBlockOrSlot: string;
  sourceVersion: string;
  evidenceIds: string[];
}

export interface FlapInspectionResponse {
  platform: 'flap';
  token: string;
  deployment: {
    portal: string;
    documentedVersion: string;
    sourceRevision: string;
  };
  platformMatch: KnowledgeValue<boolean>;
  launch: LaunchMechanismSnapshot | null;
  metadata: AnalysisMetadata;
  evidence: EvidenceRecord[];
}

export interface FlapSellQuoteResponse {
  platform: 'flap';
  token: string;
  quoteAsset: KnowledgeValue<string>;
  quote: {
    inputQuantity: string;
    nominalValue: KnowledgeValue<string>;
    realizableValue: KnowledgeValue<string>;
    averageExitPrice: KnowledgeValue<string>;
    priceImpactBps: KnowledgeValue<string>;
    totalFeeBps: KnowledgeValue<string>;
    route: string[];
    metadata: AnalysisMetadata;
  };
  evidence: EvidenceRecord[];
}

export interface FlapConfigurationField {
  value: KnowledgeValue<string>;
  source: 'EVENT' | 'OFFICIAL_DEFAULT' | 'NOT_APPLICABLE';
  evidenceIds: string[];
}

export interface FlapEventTransactionResponse {
  platform: 'flap';
  token: string;
  transactionHash: string;
  platformMatch: KnowledgeValue<boolean>;
  transactionKind: 'CREATION_CONFIGURATION' | 'STAGED' | 'MIGRATION' | 'MIXED' | 'UNRECOGNIZED';
  creation: {
    timestampUnix: string;
    creator: string;
    nonce: string;
    token: string;
    name: string;
    symbol: string;
    metadataUri: string;
  } | null;
  staged: { timestampUnix: string; creator: string; token: string } | null;
  configuration: {
    curveAddress: FlapConfigurationField;
    curveParameter: FlapConfigurationField;
    virtualQuoteReserve: FlapConfigurationField;
    virtualBaseReserve: FlapConfigurationField;
    virtualLiquiditySquared: FlapConfigurationField;
    dexSupplyThreshold: FlapConfigurationField;
    quoteTokenAddress: FlapConfigurationField;
    migratorType: FlapConfigurationField;
    tokenVersion: FlapConfigurationField;
    buyTaxBps: FlapConfigurationField;
    sellTaxBps: FlapConfigurationField;
    dexId: FlapConfigurationField;
    lpFeeProfile: FlapConfigurationField;
    extensions: unknown[];
    rawConfigHash: string;
  } | null;
  migration: {
    launchedToDex: {
      pool: string;
      tokenAmount: string;
      quoteAmount: string;
    } | null;
    poolConfiguration: { pool: string; fee: string; poolTypeCode: string } | null;
  } | null;
  decodedEventNames: string[];
  unrecognizedPortalLogCount: number;
  metadata: AnalysisMetadata;
  evidence: EvidenceRecord[];
}

export interface FlapEventHistoryResponse {
  platform: 'flap';
  token: string;
  requestedRange: {
    fromBlock: string;
    toBlock: string;
    chunkSize: number;
    chunkCount: number;
  };
  requestedRangeCoverage: number;
  lifetimeCoverage: KnowledgeValue<boolean>;
  chronology: Array<{
    transactionHash: string;
    blockNumber: string;
    blockHash: string;
    transactionIndex: string;
    transactionKind: FlapEventTransactionResponse['transactionKind'];
    decodedEventNames: string[];
    evidenceIds: string[];
  }>;
  transactions: FlapEventTransactionResponse[];
  unrecognizedPortalLogCount: number;
  metadata: AnalysisMetadata;
  evidence: EvidenceRecord[];
}

export interface FlapHistoryProjectionPageResponse {
  scan: {
    id: string;
    status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
    source: string;
    chainId: 'eip155:56';
    token: string;
    requestedRange: {
      fromBlock: string;
      toBlock: string;
      segmentSize: number;
    };
    nextBlock: string;
    requestedRangeCoverage: number;
    evidenceIds: string[];
    lastErrorCode: string | null;
    startedAt: string;
    updatedAt: string;
    completedAt: string | null;
    terminalResult: {
      requestedRangeCoverage: number;
      lifetimeCoverage: KnowledgeValue<boolean>;
      transactionCount: number;
      unrecognizedPortalLogCount: number;
      terminalEvidenceId: string;
      metadata: AnalysisMetadata;
    } | null;
  };
  page: {
    afterBlock: number | null;
    limit: number;
    hasMore: boolean;
    nextAfterBlock: number | null;
  };
  segments: Array<{
    id: string;
    fromBlock: number;
    toBlock: number;
    terminalEvidenceId: string;
    transactionCount: number;
    unrecognizedPortalLogCount: number;
    createdAt: string;
    result: FlapEventHistoryResponse;
  }>;
}

export interface FlapLifetimeMaterializationResponse {
  scan: {
    id: string;
    status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
    source: string;
    chainId: 'eip155:56';
    token: string;
    dataset: 'binance-mainnet';
    datasetStartBlock: string;
    targetBlock: string;
    nextBlock: string;
    requestedRangeCoverage: number;
    evidenceIds: string[];
    lastErrorCode: string | null;
    startedAt: string;
    updatedAt: string;
    completedAt: string | null;
    terminalResult: {
      originScanId: string;
      originSearchCoverage: number;
      origin: KnowledgeValue<{
        contractCreator: string;
        launchCreator: string;
        creationTrace: { blockNumber: string; transactionHash: string };
      }>;
      historyProjection: {
        scanId: string;
        fromBlock: string;
        toBlock: string;
        segmentCount: number;
        transactionCount: number;
        unrecognizedPortalLogCount: number;
        requestedRangeCoverage: number;
        terminalEvidenceId: string;
      } | null;
      lifetimeCoverage: KnowledgeValue<boolean>;
      terminalEvidenceId: string;
      metadata: AnalysisMetadata;
      evidence: EvidenceRecord[];
    } | null;
  };
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
  ledgerRecord: (candidate: SubjectCandidate) => {
    const parameters = new URLSearchParams();
    if (candidate.ledger === 'EVM') parameters.set('chainId', candidate.chainId);
    const suffix = parameters.size === 0 ? '' : '?' + parameters.toString();
    return requestJson<IntelligenceResponse>(
      '/api/v1/ledger/' +
        candidate.ledger +
        '/' +
        candidate.type +
        '/' +
        encodeURIComponent(candidate.normalizedId) +
        suffix,
    );
  },
  flapLaunch: (candidate: SubjectCandidate) => {
    const parameters = new URLSearchParams({
      chainId: candidate.chainId,
      platform: 'flap',
    });
    return requestJson<FlapInspectionResponse>(
      '/api/v1/launches/EVM/' +
        encodeURIComponent(candidate.normalizedId) +
        '?' +
        parameters.toString(),
    );
  },
  flapSellQuote: (token: string, inputQuantity: string, blockNumber: string) =>
    requestJson<FlapSellQuoteResponse>('/api/v1/rv/flap-sell', {
      method: 'POST',
      body: JSON.stringify({
        chainId: 'eip155:56',
        platform: 'flap',
        token,
        inputQuantity,
        blockNumber,
      }),
    }),
  flapEventTransaction: (token: string, transactionHash: string) => {
    const parameters = new URLSearchParams({ chainId: 'eip155:56', platform: 'flap' });
    return requestJson<FlapEventTransactionResponse>(
      '/api/v1/launches/EVM/' +
        encodeURIComponent(token) +
        '/events/' +
        encodeURIComponent(transactionHash) +
        '?' +
        parameters.toString(),
    );
  },
  flapEventHistory: (token: string, fromBlock: string, toBlock: string) => {
    const parameters = new URLSearchParams({
      chainId: 'eip155:56',
      platform: 'flap',
      fromBlock,
      toBlock,
    });
    return requestJson<FlapEventHistoryResponse>(
      '/api/v1/launches/EVM/' + encodeURIComponent(token) + '/history?' + parameters.toString(),
    );
  },
  flapHistoryProjection: (token: string, scanId: string, afterBlock?: number) => {
    const parameters = new URLSearchParams({
      chainId: 'eip155:56',
      platform: 'flap',
      limit: '10',
    });
    if (afterBlock !== undefined) parameters.set('afterBlock', String(afterBlock));
    return requestJson<FlapHistoryProjectionPageResponse>(
      '/api/v1/launches/EVM/' +
        encodeURIComponent(token) +
        '/history/projections/' +
        encodeURIComponent(scanId) +
        '?' +
        parameters.toString(),
    );
  },
  flapLifetimeMaterialization: (token: string, scanId: string) => {
    const parameters = new URLSearchParams({ chainId: 'eip155:56', platform: 'flap' });
    return requestJson<FlapLifetimeMaterializationResponse>(
      '/api/v1/launches/EVM/' +
        encodeURIComponent(token) +
        '/history/lifetime/materializations/' +
        encodeURIComponent(scanId) +
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
