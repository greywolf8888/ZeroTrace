import type { RoleFeatureVector } from '@zerotrace/schemas';
import type { SourceOperator } from '@zerotrace/source-registry';
import type { StageName, StageState } from '@zerotrace/terminal-pipeline';
import type { LocalIndexStore } from '@zerotrace/local-index';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface RpcResult {
  ok: boolean;
  result: unknown;
  raw: string;
  error?: string;
}

export interface RpcTransport {
  call(endpointId: string, method: string, params: unknown[]): Promise<RpcResult>;
}

export interface TokenCaptureRequest {
  chainId: string;
  token: string;
  creationTx?: string;
  logBudgetChunks?: number;
  chunkBlocks?: bigint;
  stopAfter?:
    | 'CURRENT_SNAPSHOT'
    | 'ORIGIN'
    | 'LIFETIME_HISTORY'
    | 'ENTITY_AND_CAMPAIGN'
    | 'CAPITAL_AND_RV'
    | 'CASE_AND_REPLAY';
}

export interface RpcCallStats {
  current: number;
  historical: number;
  trace: number;
  byMethod: Record<string, number>;
}

export interface TokenCaptureRuntime {
  transport: RpcTransport;
  operators: readonly SourceOperator[];
  index: LocalIndexStore;
  logBudgetChunks: number;
  pinnedFork?: { blockHash: string; vm: 'revm' };
  traceAvailable?: boolean;
  traceEndpointId?: string;
  bulkLogSource?: BulkLogSource;
  creationTraceSource?: CreationTraceSource;
  cachedOrigins?: Map<string, OriginObservation>;
  hydrate?: (request: TokenCaptureRequest) => Promise<void>;
  persist?: (request: TokenCaptureRequest, report: CaptureReport) => Promise<void>;
}

export interface CaptureArtifact {
  path: string;
  sha256: string;
}

export interface BulkLogSource {
  getLogs(params: unknown[]): Promise<RpcResult>;
}

export interface CreationTraceSource {
  getCreations(query: { address: string; fromBlock: string; toBlock: string }): Promise<RpcResult>;
}

export interface OriginObservation {
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  creationTx?: string;
  deployer?: string;
  createdBlock?: string;
  codeHash?: string;
  limitation?: string;
  limitationCode?: string;
}

export interface HistoryObservation {
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  fromBlock?: string;
  toBlock?: string;
  headBlock?: string;
  logCount: number;
  limitation?: string;
}

export interface HolderBalance {
  address: string;
  amountAtomic: string;
}

export interface AddressRoleObservation {
  address: string;
  features: RoleFeatureVector;
  hiddenConfirmed: boolean;
  retailConfirmed: boolean;
}

export interface CaptureReport {
  chainId: string;
  token: string;
  stages: StageState[];
  origin: OriginObservation;
  history: HistoryObservation;
  holders: HolderBalance[];
  roles: AddressRoleObservation[];
  campaignWindows: Array<{ start: number; end: number }>;
  lotCount: number;
  capitalLimitation?: string;
  artifacts: CaptureArtifact[];
  rawHashesValid: boolean;
  rpcStats: RpcCallStats;
}

export function stageOf(
  name: StageName,
  status: StageState['status'],
  limitation?: string,
): StageState {
  return limitation === undefined ? { name, status } : { name, status, limitation };
}
