export const STORAGE_PROFILES = [
  'LOW_COST_CASE',
  'SELECTIVE_MARKET_INDEX',
  'REMOTE_ARCHIVE_HYBRID',
] as const;

export type StorageProfile = (typeof STORAGE_PROFILES)[number];

export const DATA_CLASSES = ['PERMANENT_EVIDENCE', 'NORMALIZED_FACT', 'EPHEMERAL'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const ANALYSIS_STAGES = [
  'CURRENT_SNAPSHOT',
  'ORIGIN',
  'LIFETIME_HISTORY',
  'ENTITY_AND_CAMPAIGN',
  'CAPITAL_AND_RV',
  'CASE_AND_REPLAY',
] as const;
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

export const QUOTA_LEVELS = [
  'OK',
  'WARN',
  'STOP_PREFETCH',
  'COMPACT_AND_EVICT',
  'STOP_NEW_FULL_LIFETIME',
  'EVIDENCE_ONLY',
] as const;
export type QuotaLevel = (typeof QUOTA_LEVELS)[number];

export const TRACE_CLASSES = ['EPHEMERAL_TRACE', 'MATERIAL_TRACE', 'CASE_TRACE'] as const;
export type TraceClass = (typeof TRACE_CLASSES)[number];

export const JOB_PRIORITIES = [
  'Active Case',
  'P0 Validation',
  'Trace Pending',
  'Monitored Token',
  'Corpus',
  'Prefetch',
] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const OPTIONAL_COMPONENTS = ['clickhouse', 'minio', 'archiveNode', 'postgres'] as const;
export type OptionalComponent = (typeof OPTIONAL_COMPONENTS)[number];

export interface NormalizedFact {
  token: string;
  blockOrSlot: string;
  blockHash: string;
  transactionId: string;
  transactionIndex: string;
  logOrInstructionIndex: string;
  subjectA: string;
  subjectB: string;
  asset: string;
  amountAtomic: string;
  eventType: string;
  evidenceId: string;
  sourceId: string;
  adapterVersion: string;
}

export interface CoverageRecord {
  chainId: string;
  token: string;
  factType: string;
  startBlock: string;
  endBlock: string;
  headBlock?: string;
  updatedAt: string;
}

export interface StageCheckpoint {
  chainId: string;
  token: string;
  stage: AnalysisStage;
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'UNSUPPORTED' | 'NOT_RUN';
  resultHash?: string;
  limitation?: string;
  updatedAt: string;
}

export interface OriginCheckpoint {
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  creationTx?: string;
  deployer?: string;
  createdBlock?: string;
  codeHash?: string;
  limitation?: string;
  limitationCode?: string;
  updatedAt: string;
}

export interface StorageForecast {
  bytesPerEvent: number;
  bytesPerToken: number;
  bytesPerCase: number;
  compressionRatio: number;
  dailyGrowthBytes: number;
  forecast30: number;
  forecast90: number;
  forecast365: number;
  capacity500gbTokens: number;
  capacity1tbTokens: number;
  capacity2tbTokens: number;
  sampleTokens: number;
  sampleEvents: number;
  source: string;
}

export interface AcquisitionJob {
  id: string;
  chainId: string;
  token: string;
  fromBlock: string;
  toBlock: string;
  priority: JobPriority;
  status: 'PENDING' | 'RUNNING' | 'PERSISTED' | 'FAILED';
  createdAt: string;
}

export interface ArtifactRecord {
  id: string;
  dataClass: DataClass;
  contentType: string;
  bytes: number;
  sha256: string;
  createdAt: string;
  lastAccessAt: string;
  permanent: boolean;
}

export interface CorpusTokenMetrics {
  token: string;
  eventCount: number;
  rawBytes: number;
  parquetBytes: number;
  evidenceBytes: number;
  traceBytes: number;
  rpcCalls: number;
  historicalRpcCalls: number;
  traceCalls: number;
  durationMs: number;
  coverage: string;
  originStatus: string;
  resultHash: string;
  updatedAt: string;
}

export interface StorageQuotaView {
  profile: StorageProfile;
  level: QuotaLevel;
  usedBytes: number;
  budgetBytes: number;
  freeBytes: number;
  rebuildableBytes: number;
  permanentEvidenceBytes: number;
  dailyGrowthBytes: number;
  estimatedFullAt: string | null;
  evictingClass: DataClass | null;
  labels: {
    used: string;
    rebuildable: string;
    permanent: string;
    dailyGrowth: string;
    fullAt: string;
    evicting: string;
    level: string;
  };
}

export interface OptionalComponentStatus {
  id: OptionalComponent;
  status: 'CONFIGURED' | 'UNCONFIGURED' | 'UNAVAILABLE';
  note: string;
}

export interface MetadataStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface FactStore {
  readonly backend: 'DUCKDB_PARQUET' | 'CLICKHOUSE' | 'MEMORY';
  append(facts: readonly NormalizedFact[], observedAt?: string): Promise<{ bytes: number }>;
  queryByToken(token: string, factType?: string): Promise<NormalizedFact[]>;
  resultHash(token: string, factType?: string): Promise<string>;
  byteSize(): Promise<number>;
  compact(): Promise<{ filesBefore: number; filesAfter: number; bytesAfter: number }>;
}

export interface ArtifactStore {
  put(
    id: string,
    bytes: Uint8Array,
    meta: { dataClass: DataClass; contentType: string; permanent?: boolean },
  ): Promise<ArtifactRecord>;
  get(id: string): Promise<Uint8Array | undefined>;
  stat(id: string): Promise<ArtifactRecord | undefined>;
  deleteEphemeral(id: string): Promise<boolean>;
  list(dataClass?: DataClass): Promise<ArtifactRecord[]>;
  byteSize(dataClass?: DataClass): Promise<number>;
  evictExpired?(nowMs: number): Promise<number>;
  evictLru?(targetBytes: number): Promise<number>;
}

export interface CoverageRegistry {
  read(chainId: string, token: string, factType?: string): Promise<CoverageRecord[]>;
  commit(record: CoverageRecord): Promise<void>;
}

export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, dataClass?: DataClass): Promise<void>;
  evictExpired(nowMs: number): Promise<number>;
  evictLru(targetBytes: number): Promise<number>;
  byteSize(): Promise<number>;
}
