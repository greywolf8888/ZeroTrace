import type { Receipt, SnapshotRun, StoredEvidence } from './types.js';

// 领域逻辑仅依赖可重放仓储契约；PostgreSQL 实现位于独立 API 基础设施层。
export interface Checkpoint {
  head: string;
  version: string;
}
export interface SegmentInput {
  deployment: string;
  checkpointKey?: string;
  from: string;
  to: string;
  status: 'complete' | 'partial' | 'conflict';
  document: unknown;
  observations: StoredEvidence[];
  receipts: { receipt: Receipt; observationId: string }[];
  expectedVersion: string;
  requestUpdate?: {
    id: string;
    head: string;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    error?: string;
  };
}
export interface EvidenceRequest {
  id: string;
  jobId: string;
  from: string;
  to: string;
  head: string;
  status: string;
  ruleVersion: string;
  snapshotRunId: string;
}
export interface LedgerRepository {
  checkpoint(deployment: string, openingHead: string): Promise<Checkpoint>;
  saveSegment(input: SegmentInput): Promise<Checkpoint>;
  receiptsThrough(
    height: string,
  ): Promise<{ receipt: Receipt; evidenceIds: string[]; evidence: StoredEvidence }[]>;
  withWorkerLock<T>(action: () => Promise<T>): Promise<T>;
  getRun(id?: string): Promise<SnapshotRun | undefined>;
  publish(run: SnapshotRun, observations: StoredEvidence[]): Promise<void>;
  nextEvidenceRequest?(): Promise<EvidenceRequest | undefined>;
  capturedBlock?(height: string, source: string): Promise<{ hash: string } | undefined>;
  cachedReceipt?(
    tx: string,
    source: string,
  ): Promise<{ receipt: Receipt; evidence: StoredEvidence } | undefined>;
}
