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
  terminalEvidenceId?: string;
  durableReport?: {
    id: string;
    resultHash: string;
    createdAt: string;
    capturedAt: string;
    replayed: boolean;
    liveRefresh: KnowledgeValue<boolean>;
  };
}

export type IntelligenceResponse = SubjectResponse;

export interface LaunchMechanismSnapshot {
  platform: string;
  platformVersion: KnowledgeValue<string>;
  deploymentId: KnowledgeValue<string>;
  factoryOrProgram: KnowledgeValue<string>;
  lifecycle: string;
  quoteAsset: KnowledgeValue<string>;
  spotPrice: KnowledgeValue<string>;
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

export interface FlapTokenAmount {
  atomic: string;
  decimal: string;
}

export interface FlapPancakeV2Market {
  venue: 'PANCAKESWAP_V2';
  chainId: 'eip155:56';
  pool: string;
  factory: string;
  router: string;
  token: string;
  quoteAsset: string;
  token0: string;
  token1: string;
  tokenDecimals: number;
  quoteDecimals: number;
  tokenReserve: FlapTokenAmount;
  quoteReserve: FlapTokenAmount;
  currentSpotPriceWad: string;
  currentSpotPrice: string;
  dexFeeBps: string;
  configuredBuyTaxBps: KnowledgeValue<string>;
  configuredSellTaxBps: KnowledgeValue<string>;
  pairTimestampLast: string;
  sourceRevision: string;
}

export interface FlapPancakeV2BuyScenarioResponse {
  platform: 'flap';
  token: string;
  market: KnowledgeValue<FlapPancakeV2Market>;
  scenarios: Array<{
    quoteInput: FlapTokenAmount;
    officialRouterGrossTokenOutput: FlapTokenAmount;
    deterministicPoolGrossTokenOutput: FlapTokenAmount;
    configuredTaxNetTokenOutput: KnowledgeValue<FlapTokenAmount>;
    executionNetTokenOutput: KnowledgeValue<FlapTokenAmount>;
    averageGrossBuyPrice: KnowledgeValue<string>;
    averageConfiguredTaxBuyPrice: KnowledgeValue<string>;
    modeledPostBuySpotPrice: string;
    modeledPriceChangeBps: string;
    deterministicQuoteErrorBps: string;
    deterministicToleranceBps: string;
    withinDeterministicTolerance: boolean;
    assumption: string;
  }>;
  validation: {
    status: 'PASS' | 'FAIL' | 'NOT_RUN';
    deterministicToleranceBps: string;
    evaluatedScenarioCount: number;
    failedScenarioCount: number;
  };
  pensionSinkTreatment: KnowledgeValue<string>;
  terminalEvidenceId: string | null;
  metadata: AnalysisMetadata;
  evidence: EvidenceRecord[];
}

export interface FlapPancakeV2PensionEntryResponse {
  platform: 'flap';
  token: string;
  behavior: {
    reportId: string;
    resultHash: string;
    wallet: string;
    shareUnit: FlapTokenAmount;
    fromBlock: string;
    toBlock: string;
    snapshotHash: string;
    observedWholeShares: string;
    candidateEvidenceId: string;
    reportTerminalEvidenceId: string;
    roleAttribution: KnowledgeValue<'PENSION_VAULT'>;
    participantExitPolicy: KnowledgeValue<boolean>;
    dividendExecution: KnowledgeValue<boolean>;
  };
  market: KnowledgeValue<FlapPancakeV2Market>;
  entries: Array<{
    buyScenario: FlapPancakeV2BuyScenarioResponse['scenarios'][number];
    modeledNetTokenOutput: KnowledgeValue<FlapTokenAmount>;
    modeledShareEquivalent: KnowledgeValue<string>;
    modeledWholeShares: KnowledgeValue<string>;
    modeledCommittedTokenAmount: KnowledgeValue<FlapTokenAmount>;
    modeledRemainderTokenAmount: KnowledgeValue<FlapTokenAmount>;
    modeledQuoteCostForCommittedShares: KnowledgeValue<FlapTokenAmount>;
    modeledAverageQuoteCostPerShare: KnowledgeValue<FlapTokenAmount>;
    modeledPostDepositSpotPrice: KnowledgeValue<string>;
    executionNetTokenOutput: KnowledgeValue<FlapTokenAmount>;
    executionWholeShares: KnowledgeValue<string>;
    executionPostDepositSpotPrice: KnowledgeValue<string>;
    assumption: string;
  }>;
  validation: FlapPancakeV2BuyScenarioResponse['validation'];
  destinationTreatment: 'NON_ZERO_CUSTODY_ADDRESS';
  totalSupplyReduction: KnowledgeValue<FlapTokenAmount>;
  custodyIrreversible: KnowledgeValue<boolean>;
  terminalEvidenceId: string;
  metadata: AnalysisMetadata;
  evidence: EvidenceRecord[];
  durableReport?: {
    id: string;
    resultHash: string;
    createdAt: string;
  };
}

export interface StoredFlapPensionEntryReport {
  id: string;
  chainId: 'eip155:56';
  tokenAddress: string;
  pensionReportId: string;
  pensionWallet: string;
  blockNumber: string;
  snapshotHash: string;
  resultHash: string;
  report: Omit<FlapPancakeV2PensionEntryResponse, 'durableReport'>;
  terminalEvidenceId: string;
  evidenceIds: string[];
  sourceSet: string[];
  modelVersion: string;
  capturedAt: string;
  createdAt: string;
}

export interface FlapPensionEntryReportReplayResponse {
  replayed: true;
  record: StoredFlapPensionEntryReport;
}

export interface FlapPancakeV2SellScenarioResponse {
  platform: 'flap';
  token: string;
  market: KnowledgeValue<FlapPancakeV2Market>;
  scenarios: Array<{
    tokenInput: FlapTokenAmount;
    nominalSpotQuoteValue: FlapTokenAmount;
    officialRouterGrossQuoteOutput: FlapTokenAmount;
    deterministicPoolGrossQuoteOutput: FlapTokenAmount;
    configuredTaxTokenInputToPool: KnowledgeValue<FlapTokenAmount>;
    configuredTaxNetQuoteOutput: KnowledgeValue<FlapTokenAmount>;
    executionNetQuoteOutput: KnowledgeValue<FlapTokenAmount>;
    averageGrossExitPrice: KnowledgeValue<string>;
    averageConfiguredTaxExitPrice: KnowledgeValue<string>;
    modeledGrossPostSellSpotPrice: string;
    modeledConfiguredTaxPostSellSpotPrice: KnowledgeValue<string>;
    grossPriceImpactBps: string;
    configuredTotalExitHaircutBps: KnowledgeValue<string>;
    grossQuoteReserveConsumedBps: string;
    configuredTaxQuoteReserveConsumedBps: KnowledgeValue<string>;
    deterministicQuoteErrorBps: string;
    deterministicToleranceBps: string;
    withinDeterministicTolerance: boolean;
    assumption: string;
  }>;
  validation: FlapPancakeV2BuyScenarioResponse['validation'];
  executionCapacity: KnowledgeValue<string>;
  terminalEvidenceId: string | null;
  metadata: AnalysisMetadata;
  evidence: EvidenceRecord[];
}

export interface SourceIndependenceAssessment {
  status: 'VERIFIED_INDEPENDENT' | 'SAME_OPERATOR' | 'INCONCLUSIVE';
  independence: KnowledgeValue<boolean>;
  requiredOperators: number;
  observedSources: number;
  operatorCount: number;
  unresolvedSources: string[];
  attestations: Array<{
    sourceId: string;
    hostname: string;
    operatorId: string;
    operatorName: string;
    officialSource: string;
    registryObservedAt: string;
    registryRevision: string;
    evidenceId: string;
  }>;
  registryEvidenceId: string;
  terminalEvidenceId: string;
  evidenceIds: string[];
  modelVersion: 'source-operator-registry-v1';
}

export interface DiscrepancyCheckResult {
  id: string;
  fieldPath: string;
  comparisonClass:
    | 'EXACT_IDENTITY_STATE'
    | 'CONSERVATION'
    | 'DETERMINISTIC_DERIVED'
    | 'INDEPENDENT_MARKET_QUOTE_RV'
    | 'HOLDER_ENTITY_AGGREGATE'
    | 'FRESHNESS'
    | 'API_UI_PARITY';
  disposition: 'PASS' | 'WARNING' | 'FAIL' | 'INCONCLUSIVE';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  actual: KnowledgeValue<string | boolean>;
  reference: KnowledgeValue<string | boolean>;
  absoluteError: KnowledgeValue<string>;
  relativeErrorPct: KnowledgeValue<string>;
  passThresholdPct: KnowledgeValue<string>;
  warningThresholdPct: KnowledgeValue<string>;
  coverage: number;
  requiredCoverage: number;
  sourceIndependence: KnowledgeValue<boolean>;
  sourceIndependenceEvidenceIds: string[];
  numericDenominatorIncluded: boolean;
  sourceSet: string[];
  evidenceIds: string[];
  explanationEvidenceIds: string[];
  message: string;
}

export interface FlapPancakeV2ReconciliationResponse {
  platform: 'flap';
  token: string;
  status: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL' | 'INCONCLUSIVE';
  blockNumber: string;
  blockHash: string;
  anchorReconciliation: AnchorReconciliationResult;
  sourceIndependence: SourceIndependenceAssessment;
  sources: Array<{
    sourceId: string;
    operatorId: KnowledgeValue<string>;
    buy: FlapPancakeV2BuyScenarioResponse;
    sell: FlapPancakeV2SellScenarioResponse;
  }>;
  audit: {
    status: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL' | 'INCONCLUSIVE';
    checks: DiscrepancyCheckResult[];
    summary: {
      total: number;
      passed: number;
      warnings: number;
      failed: number;
      inconclusive: number;
      numericDenominator: number;
      coverageGaps: number;
    };
    metadata: AnalysisMetadata;
  };
  terminalEvidenceId: string;
  metadata: AnalysisMetadata;
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

export interface FlapLifetimeHeadResponse {
  head: {
    id: string;
    chainId: 'eip155:56';
    token: string;
    sequence: number;
    scanId: string;
    headType: 'INITIAL' | 'EXTENSION';
    predecessorId: string | null;
    targetBlock: number;
    targetHash: string;
    terminalEvidenceId: string;
    createdAt: string;
    result: {
      platform: 'flap';
      token: string;
      dataset: 'binance-mainnet';
      datasetStartBlock: string;
      targetBlock: string;
      originScanId: string;
      origin: KnowledgeValue<{
        contractCreator: string;
        launchCreator: string;
        creationTrace: { blockNumber: string; transactionHash: string };
      }>;
      predecessor?: {
        scanId: string;
        targetBlock: string;
        targetHash: string;
        terminalEvidenceId: string;
      };
      continuity?: {
        status: 'DIRECT_EXTENSION' | 'HISTORICAL_MATCH';
        continuous: KnowledgeValue<boolean>;
        evidenceIds: string[];
        terminalEvidenceId: string;
      };
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
    };
  };
}

export interface ClaimReportResponse {
  record: {
    id: string;
    chainId: string;
    tokenAddress: string;
    address: string;
    fromBlock: string;
    toBlock: string;
    snapshotBlock: string;
    snapshotHash: string;
    resultHash: string;
    terminalEvidenceId: string;
    evidenceIds: string[];
    sourceSet: string[];
    modelVersion: string;
    capturedAt: string;
    createdAt: string;
    report: {
      window: { from: string; to: string };
      custody: {
        kind: string;
        canMoveFunds: KnowledgeValue<boolean>;
        threshold?: number;
        ownerCount?: number;
        executedTransactions?: number;
        implementationAddress?: string;
        implementationVersion?: string;
        evidenceIds: string[];
      };
      flow: {
        inflow: ClaimFlowAggregate;
        outflow: ClaimFlowAggregate;
        shareUnitAssessment: {
          unit: string;
          observedDeposits: number;
          exactUnitDeposits: number;
          exactMultipleDeposits: number;
          nonMultipleDeposits: number;
          observedWholeShares: string;
          nonMultipleObservedAmount: string;
          exactMultipleCoverage: KnowledgeValue<number>;
        } | null;
        selfTransferCount: number;
        selfTransferObservedAmount: string;
        topCounterparties: Array<{
          direction: 'INFLOW' | 'OUTFLOW';
          address: string;
          observedAmount: string;
          transferCount: number;
          firstObservedAt: string;
          lastObservedAt: string;
          evidenceIds: string[];
        }>;
        metadata: AnalysisMetadata;
      };
      terminalEvidenceId: string;
      metadata: AnalysisMetadata;
    };
  };
}

export interface ClaimDeclarationDraft {
  id: string;
  assetId: string;
  role: string;
  expectedAction: string;
  sourceAddress: KnowledgeValue<string>;
  destinationAddress: KnowledgeValue<string>;
  expectedShareBps: KnowledgeValue<string>;
  shareUnitTokens: KnowledgeValue<string>;
  noExit: KnowledgeValue<boolean>;
  cadenceSeconds: KnowledgeValue<string>;
  window: KnowledgeValue<{ from: string; to: string }>;
  matchedText: string;
  missingFields: string[];
  chainVerifyReadiness: 'READY_FOR_REVIEW' | 'INCOMPLETE';
  requiresHumanReview: true;
  claimEvidenceIds: string[];
}

export interface ClaimDeclarationParseResponse {
  parserVersion: string;
  documentHash: string;
  assetId: string;
  evidence: EvidenceRecord;
  drafts: ClaimDeclarationDraft[];
  unmatchedAddresses: string[];
  warnings: string[];
}

export interface EvmClaimBurnConservationResponse {
  report: {
    tokenAddress: string;
    blockNumber: string;
    blockHash: string;
    parentBlockNumber: string;
    parentBlockHash: string;
    totalSupplyBefore: string;
    totalSupplyAfter: string;
    mintedAmount: string;
    burnedAmount: string;
    supplyDelta: string;
    eventNetSupplyDelta: string;
    expectedSupplyAfter: string;
    status: 'VERIFIED' | 'CONTRADICTED' | 'NOT_APPLICABLE';
    candidateBurnTransferIds: string[];
    actions: Array<{
      id: string;
      type: 'BURN';
      actor: string;
      amount: string;
      observedAt: string;
      transferIds: string[];
      path: string[];
      evidenceIds: string[];
    }>;
    terminalEvidenceId: string;
    metadata: AnalysisMetadata;
  };
  evidence: EvidenceRecord[];
}

export interface EvmClaimBurnCandidateDiscoveryResponse {
  report: {
    tokenAddress: string;
    fromBlock: string;
    toBlock: string;
    coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS';
    status: 'CANDIDATES_DISCOVERED' | 'NO_EVENT_CANDIDATES';
    zeroAddressEventCount: number;
    burnCandidateCount: number;
    candidates: Array<{
      blockNumber: string;
      blockHash: string;
      burnTransferIds: string[];
      mintedEventAmount: string;
      burnedEventAmount: string;
    }>;
    silentSupplyChangeDetection: KnowledgeValue<boolean>;
    terminalEvidenceId: string;
    metadata: AnalysisMetadata;
  };
  evidence: EvidenceRecord[];
}

export interface EvmPensionVaultCandidate {
  address: string;
  inflowTransferCount: number;
  outflowTransferCount: number;
  exactUnitDepositCount: number;
  exactMultipleDepositCount: number;
  nonMultipleDepositCount: number;
  uniqueExactUnitDepositorCount: number;
  uniqueOutflowDestinationCount: number;
  observedInflowAmount: string;
  observedOutflowAmount: string;
  observedNetAmount: string;
  observedWholeShares: string;
  firstInflowAt: string;
  lastInflowAt: string;
  firstOutflowAt: KnowledgeValue<string>;
  lastOutflowAt: KnowledgeValue<string>;
  criteria: ['EXACT_SHARE_UNIT_DEPOSITS', 'UNIQUE_DEPOSITOR_THRESHOLD'];
  transferEvidenceIds: string[];
  evidenceId: string;
  roleAttribution: KnowledgeValue<'PENSION_VAULT'>;
  participantExitPolicy: KnowledgeValue<boolean>;
  dividendExecution: KnowledgeValue<boolean>;
}

export interface EvmPensionCandidateReport {
  tokenAddress: string;
  fromBlock: string;
  toBlock: string;
  policy: {
    shareUnitAtomic: string;
    minimumExactUnitDeposits: number;
    minimumUniqueExactUnitDepositors: number;
    maximumCandidates: number;
  };
  scannedTransferCount: number;
  candidates: EvmPensionVaultCandidate[];
  coverageEvidenceIds: string[];
  terminalEvidenceId: string;
  metadata: AnalysisMetadata;
}

export interface StoredPensionCandidateReport {
  id: string;
  chainId: 'eip155:56';
  tokenAddress: string;
  fromBlock: string;
  toBlock: string;
  snapshotHash: string;
  resultHash: string;
  report: EvmPensionCandidateReport;
  terminalEvidenceId: string;
  evidenceIds: string[];
  sourceSet: string[];
  modelVersion: 'evm-pension-candidate-discovery-v1.0.0';
  capturedAt: string;
  createdAt: string;
}

export interface EvmPensionCandidateDiscoveryResponse {
  report: EvmPensionCandidateReport;
  durableReport: StoredPensionCandidateReport;
}

export interface EvmPensionCandidateReplayResponse {
  record: StoredPensionCandidateReport;
}

export interface EvmClaimBurnPromotionReplayResponse {
  scan: {
    id: string;
    status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
    token: string;
    requestedRange: { fromBlock: string; toBlock: string; segmentSize: number };
    nextBlock: string;
    requestedRangeCoverage: number;
    lastErrorCode: string | null;
    updatedAt: string;
  };
  terminalResult: null | {
    tokenAddress: string;
    fromBlock: string;
    toBlock: string;
    coverageScope: 'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION';
    status: 'REQUESTED_RANGE_COMPLETE';
    segmentCount: number;
    zeroAddressEventCount: number;
    burnCandidateCount: number;
    verifiedCandidateCount: number;
    contradictedCandidateCount: number;
    verifiedActionCount: number;
    segments: Array<{
      fromBlock: string;
      toBlock: string;
      zeroAddressEventCount: number;
      burnCandidateCount: number;
      discoveryTerminalEvidenceId: string;
      certificates: Array<{
        blockNumber: string;
        blockHash: string;
        burnTransferIds: string[];
        mintedEventAmount: string;
        burnedEventAmount: string;
        status: 'VERIFIED' | 'CONTRADICTED';
        actionCount: number;
        terminalEvidenceId: string;
      }>;
      snapshot: Record<string, unknown>;
      sourceSet: string[];
    }>;
    silentSupplyChangeDetection: KnowledgeValue<boolean>;
    terminalEvidenceId: string;
    metadata: AnalysisMetadata;
  };
}

export interface EvmSupplyContinuityReplayResponse {
  scan: {
    id: string;
    status: 'RUNNING' | 'REQUESTED_RANGE_COMPLETE';
    token: string;
    requestedRange: { fromBlock: string; toBlock: string; segmentSize: number };
    nextBlock: string;
    requestedRangeCoverage: number;
    lastErrorCode: string | null;
    updatedAt: string;
  };
  terminalResult: null | {
    tokenAddress: string;
    fromBlock: string;
    toBlock: string;
    coverageScope: 'ERC20_TOTAL_SUPPLY_EVERY_FINALIZED_BLOCK_WITH_EVENT_RECONCILIATION';
    status:
      | 'VERIFIED_NO_CHANGE'
      | 'VERIFIED_EVENT_CONSERVED_CHANGES'
      | 'UNEXPLAINED_SUPPLY_CHANGE'
      | 'INCONCLUSIVE_SOURCE_INDEPENDENCE';
    segmentCount: number;
    scannedBlockCount: number;
    supplySampleCount: number;
    initialTotalSupply: string;
    finalTotalSupply: string;
    netSupplyDelta: string;
    supplyChangeCount: number;
    eventConservedChangeCount: number;
    unexplainedChangeCount: number;
    segments: Array<{
      fromBlock: string;
      toBlock: string;
      sampleCount: number;
      startTotalSupply: string;
      endTotalSupply: string;
      supplyChangeCount: number;
      eventConservedChangeCount: number;
      unexplainedChangeCount: number;
      changes: Array<{
        blockNumber: string;
        blockHash: string;
        parentBlockHash: string;
        totalSupplyBefore: string;
        totalSupplyAfter: string;
        supplyDelta: string;
        mintedEventAmount: string;
        burnedEventAmount: string;
        eventNetSupplyDelta: string;
        reconciliationStatus: 'EVENT_CONSERVED' | 'UNEXPLAINED';
        certificateStatus: 'VERIFIED' | 'CONTRADICTED' | 'NOT_APPLICABLE';
        certificateTerminalEvidenceId: string;
      }>;
      terminalEvidenceId: string;
      snapshot: Record<string, unknown>;
      sourceSet: string[];
    }>;
    sourceIndependence: SourceIndependenceAssessment;
    terminalEvidenceId: string;
    metadata: AnalysisMetadata;
  };
}

export interface EvmControlSurfaceResponse {
  record: {
    id: string;
    chainId: string;
    subject: string;
    snapshotBlock: string;
    snapshotHash: string;
    resultHash: string;
    terminalEvidenceId: string;
    evidenceIds: string[];
    sourceSet: string[];
    modelVersion: string;
    capturedAt: string;
    createdAt: string;
    report: {
      ledger: 'EVM';
      chainId: string;
      subject: string;
      contractKind: KnowledgeValue<
        | 'EOA'
        | 'DIRECT_CONTRACT'
        | 'ERC1167_MINIMAL_PROXY'
        | 'EIP1967_PROXY'
        | 'EIP1967_BEACON_PROXY'
        | 'SAFE_PROXY'
      >;
      implementationAddress: KnowledgeValue<string>;
      proxyAdminAddress: KnowledgeValue<string>;
      beaconAddress: KnowledgeValue<string>;
      ownerAddress: KnowledgeValue<string>;
      safe: KnowledgeValue<{
        owners: string[];
        threshold: string;
        nonce: string;
        implementationAddress: string;
        implementationVersion: string;
      }>;
      logicCode?: KnowledgeValue<{
        address: string;
        relation:
          | 'SUBJECT'
          | 'ERC1167_IMPLEMENTATION'
          | 'EIP1967_IMPLEMENTATION'
          | 'BEACON_IMPLEMENTATION'
          | 'SAFE_SINGLETON';
        runtimeBytecodeHash: string;
        runtimeBytecodeBytes: number;
      }>;
      verifiedSource?: KnowledgeValue<{
        sourceId: string;
        sourceUri: string;
        address: string;
        matchType: 'exact_match';
        runtimeBytecodeHash: string;
        runtimeBytecodeBytes: number;
        contractName: string;
        fullyQualifiedName: string;
        language: string;
        compilerVersion: string;
        verifiedAt: string;
        deployment: KnowledgeValue<{
          blockNumber: string;
          transactionHash: string;
          deployer: string;
        }>;
        abiFunctionCount: number;
        mutatingFunctionSignatures: string[];
      }>;
      declaredCapabilities?: Array<{
        rightType: string;
        functionSignatures: string[];
        detail: string;
        evidenceIds: string[];
      }>;
      sourceAgreement: KnowledgeValue<boolean>;
      sourceIndependence: KnowledgeValue<boolean>;
      rights: Array<{
        id: string;
        chainId: string;
        subject: string;
        controller: string;
        rightType: string;
        scope: string;
        threshold: KnowledgeValue<string>;
        constraints: string[];
        evidenceIds: string[];
        activeFrom: KnowledgeValue<string>;
        activeTo: KnowledgeValue<string>;
      }>;
      coverage: Array<{
        domain: string;
        observed: KnowledgeValue<boolean>;
        detail: string;
        evidenceIds: string[];
      }>;
      terminalEvidenceId: string;
      metadata: AnalysisMetadata;
      evidence: EvidenceRecord[];
    };
  };
}

export interface SolanaControlSurfaceResponse {
  record: {
    id: string;
    chainId: 'solana-mainnet';
    subject: string;
    snapshotSlot: string;
    snapshotHash: string;
    resultHash: string;
    terminalEvidenceId: string;
    evidenceIds: string[];
    sourceSet: string[];
    modelVersion: string;
    capturedAt: string;
    createdAt: string;
    report: {
      ledger: 'SOLANA';
      chainId: 'solana-mainnet';
      subject: string;
      accountKind: KnowledgeValue<string>;
      ownerProgram: KnowledgeValue<string>;
      executable: KnowledgeValue<boolean>;
      mint: KnowledgeValue<{
        tokenProgram: 'SPL_TOKEN' | 'TOKEN_2022';
        supply: string;
        decimals: number;
        initialized: boolean;
        mintAuthority: KnowledgeValue<string>;
        freezeAuthority: KnowledgeValue<string>;
      }>;
      tokenAccount: KnowledgeValue<{
        tokenProgram: 'SPL_TOKEN' | 'TOKEN_2022';
        mint: string;
        owner: string;
        amount: string;
        state: string;
        delegate: KnowledgeValue<string>;
        delegatedAmount: string;
        closeAuthority: KnowledgeValue<string>;
      }>;
      multisig: KnowledgeValue<{
        tokenProgram: 'SPL_TOKEN' | 'TOKEN_2022';
        initialized: boolean;
        minimumSigners: number;
        signerCount: number;
        signers: string[];
      }>;
      program: KnowledgeValue<{
        loader: string;
        programDataAddress: KnowledgeValue<string>;
        upgradeAuthority: KnowledgeValue<string>;
        immutable: KnowledgeValue<boolean>;
        deploymentSlot: KnowledgeValue<string>;
        programDataBytes: KnowledgeValue<number>;
      }>;
      extensions: Array<{
        extensionType: string;
        authorities: Array<{ role: string; address: string }>;
        relatedAddresses: Array<{ role: string; address: string }>;
        settings: Record<string, string | boolean | null>;
        evidenceIds: string[];
      }>;
      sourceAgreement: KnowledgeValue<boolean>;
      sourceIndependence: KnowledgeValue<boolean>;
      rights: Array<{
        id: string;
        chainId: 'solana-mainnet';
        subject: string;
        controller: string;
        rightType: string;
        scope: string;
        threshold: KnowledgeValue<string>;
        constraints: string[];
        evidenceIds: string[];
        activeFrom: KnowledgeValue<string>;
        activeTo: KnowledgeValue<string>;
      }>;
      coverage: Array<{
        domain: string;
        observed: KnowledgeValue<boolean>;
        detail: string;
        evidenceIds: string[];
      }>;
      terminalEvidenceId: string;
      metadata: AnalysisMetadata;
      evidence: EvidenceRecord[];
    };
  };
}

interface ClaimFlowAggregate {
  observedAmount: string;
  actualAmount: KnowledgeValue<string>;
  transferCount: number;
  uniqueCounterparties: number;
  firstObservedAt: KnowledgeValue<string>;
  lastObservedAt: KnowledgeValue<string>;
  evidenceIds: string[];
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
  flapPancakeV2BuyScenarios: (token: string, quoteInputs: readonly string[], blockNumber: string) =>
    requestJson<FlapPancakeV2BuyScenarioResponse>('/api/v1/rv/flap-pancake-v2-buy-scenarios', {
      method: 'POST',
      body: JSON.stringify({
        chainId: 'eip155:56',
        platform: 'flap',
        token,
        quoteInputs,
        blockNumber,
      }),
    }),
  flapPancakeV2PensionEntryScenarios: (
    token: string,
    quoteInputs: readonly string[],
    blockNumber: string,
    pensionReportId: string,
    pensionWallet: string,
  ) =>
    requestJson<FlapPancakeV2PensionEntryResponse>(
      '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios',
      {
        method: 'POST',
        body: JSON.stringify({
          chainId: 'eip155:56',
          platform: 'flap',
          token,
          quoteInputs,
          blockNumber,
          ...(pensionReportId.length === 0 ? {} : { pensionReportId }),
          ...(pensionWallet.length === 0 ? {} : { pensionWallet }),
        }),
      },
    ),
  flapPancakeV2PensionEntryLatestReport: (token: string) => {
    const parameters = new URLSearchParams({
      chainId: 'eip155:56',
      platform: 'flap',
      token,
    });
    return requestJson<FlapPensionEntryReportReplayResponse>(
      '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/latest?' + parameters.toString(),
    );
  },
  flapPancakeV2PensionEntryReport: (token: string, reportId: string) => {
    const parameters = new URLSearchParams({
      chainId: 'eip155:56',
      platform: 'flap',
      token,
    });
    return requestJson<FlapPensionEntryReportReplayResponse>(
      '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/' +
        encodeURIComponent(reportId) +
        '?' +
        parameters.toString(),
    );
  },
  flapPancakeV2SellScenarios: (
    token: string,
    tokenInputs: readonly string[],
    blockNumber: string,
  ) =>
    requestJson<FlapPancakeV2SellScenarioResponse>('/api/v1/rv/flap-pancake-v2-sell-scenarios', {
      method: 'POST',
      body: JSON.stringify({
        chainId: 'eip155:56',
        platform: 'flap',
        token,
        tokenInputs,
        blockNumber,
      }),
    }),
  flapPancakeV2Reconciliation: (
    token: string,
    quoteInputs: readonly string[],
    tokenInputs: readonly string[],
  ) =>
    requestJson<FlapPancakeV2ReconciliationResponse>('/api/v1/rv/flap-pancake-v2-reconciliation', {
      method: 'POST',
      body: JSON.stringify({
        chainId: 'eip155:56',
        platform: 'flap',
        token,
        quoteInputs,
        tokenInputs,
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
  flapLatestLifetimeHead: (token: string) => {
    const parameters = new URLSearchParams({ chainId: 'eip155:56', platform: 'flap' });
    return requestJson<FlapLifetimeHeadResponse>(
      '/api/v1/launches/EVM/' +
        encodeURIComponent(token) +
        '/history/lifetime/heads/latest?' +
        parameters.toString(),
    );
  },
  latestClaimReport: (token: string, address: string, chainId = 'eip155:56') => {
    const parameters = new URLSearchParams({ chainId });
    return requestJson<ClaimReportResponse>(
      '/api/v1/claims/EVM/' +
        encodeURIComponent(token) +
        '/addresses/' +
        encodeURIComponent(address) +
        '/reports/latest?' +
        parameters.toString(),
    );
  },
  claimReport: (token: string, address: string, reportId: string, chainId = 'eip155:56') => {
    const parameters = new URLSearchParams({ chainId });
    return requestJson<ClaimReportResponse>(
      '/api/v1/claims/EVM/' +
        encodeURIComponent(token) +
        '/addresses/' +
        encodeURIComponent(address) +
        '/reports/' +
        encodeURIComponent(reportId) +
        '?' +
        parameters.toString(),
    );
  },
  parseClaimDeclaration: (
    token: string,
    text: string,
    auditWindow?: { from: string; to: string },
    chainId = 'eip155:56',
  ) =>
    requestJson<ClaimDeclarationParseResponse>('/api/v1/claims/declarations/parse', {
      method: 'POST',
      body: JSON.stringify({
        chainId,
        assetId: `${chainId}:erc20:${token.toLowerCase()}`,
        text,
        ...(auditWindow === undefined ? {} : { auditWindow }),
      }),
    }),
  inspectClaimBurnConservation: (token: string, blockNumber: string, chainId = 'eip155:56') =>
    requestJson<EvmClaimBurnConservationResponse>(
      `/api/v1/claims/EVM/${encodeURIComponent(token)}/burn-conservation`,
      {
        method: 'POST',
        body: JSON.stringify({ chainId, blockNumber }),
      },
    ),
  discoverClaimBurnCandidates: (
    token: string,
    fromBlock: string,
    toBlock: string,
    chainId = 'eip155:56',
  ) =>
    requestJson<EvmClaimBurnCandidateDiscoveryResponse>(
      `/api/v1/claims/EVM/${encodeURIComponent(token)}/burn-candidates`,
      {
        method: 'POST',
        body: JSON.stringify({ chainId, fromBlock, toBlock }),
      },
    ),
  discoverPensionCandidates: (
    token: string,
    input: {
      fromBlock: string;
      toBlock: string;
      shareUnitAtomic: string;
      minimumExactUnitDeposits: number;
      minimumUniqueExactUnitDepositors: number;
      maximumCandidates: number;
    },
  ) =>
    requestJson<EvmPensionCandidateDiscoveryResponse>(
      `/api/v1/claims/EVM/${encodeURIComponent(token)}/pension-candidates`,
      {
        method: 'POST',
        body: JSON.stringify({ chainId: 'eip155:56', ...input }),
      },
    ),
  latestPensionCandidateReport: (token: string) =>
    requestJson<EvmPensionCandidateReplayResponse>(
      `/api/v1/claims/EVM/${encodeURIComponent(token)}/pension-candidates/reports/latest`,
    ),
  replayClaimBurnPromotion: (token: string, scanId: string) =>
    requestJson<EvmClaimBurnPromotionReplayResponse>(
      `/api/v1/claims/EVM/${encodeURIComponent(token)}/burn-promotions/${encodeURIComponent(scanId)}`,
    ),
  replaySupplyContinuity: (token: string, scanId: string) =>
    requestJson<EvmSupplyContinuityReplayResponse>(
      `/api/v1/claims/EVM/${encodeURIComponent(token)}/supply-continuity/${encodeURIComponent(scanId)}`,
    ),
  inspectControlSurface: (subject: string, blockNumber?: string, chainId = 'eip155:56') =>
    requestJson<EvmControlSurfaceResponse>(
      `/api/v1/control-rights/EVM/${encodeURIComponent(subject)}/inspect`,
      {
        method: 'POST',
        body: JSON.stringify({
          chainId,
          ...(blockNumber === undefined || blockNumber === '' ? {} : { blockNumber }),
        }),
      },
    ),
  latestControlSurface: (subject: string, chainId = 'eip155:56') => {
    const parameters = new URLSearchParams({ chainId });
    return requestJson<EvmControlSurfaceResponse>(
      `/api/v1/control-rights/EVM/${encodeURIComponent(subject)}/reports/latest?${parameters.toString()}`,
    );
  },
  inspectSolanaControlSurface: (subject: string) =>
    requestJson<SolanaControlSurfaceResponse>(
      `/api/v1/control-rights/SOLANA/${encodeURIComponent(subject)}/inspect`,
      {
        method: 'POST',
        body: JSON.stringify({ chainId: 'solana-mainnet' }),
      },
    ),
  latestSolanaControlSurface: (subject: string) => {
    const parameters = new URLSearchParams({ chainId: 'solana-mainnet' });
    return requestJson<SolanaControlSurfaceResponse>(
      `/api/v1/control-rights/SOLANA/${encodeURIComponent(subject)}/reports/latest?${parameters.toString()}`,
    );
  },
  exitRace: (payload: unknown) =>
    requestJson<Record<string, unknown>>('/api/v1/scenarios/exit-race', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
