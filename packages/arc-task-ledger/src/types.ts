export const RULE_VERSION = 'atl-v1.2.1';
export type Knowledge<T> =
  | { state: 'known'; value: T; evidenceIds: string[]; derivation?: string }
  | {
      state: 'unknown' | 'unavailable' | 'unsupported' | 'conflict';
      reason: string;
      evidenceIds?: string[];
    };
export const known = <T>(value: T, evidenceIds: string[] = []): Knowledge<T> => ({
  state: 'known',
  value,
  evidenceIds,
});
export const unknown = <T>(reason: string): Knowledge<T> => ({ state: 'unknown', reason });
export type CoverageState = 'complete' | 'partial' | 'unknown' | 'conflict';
export interface Coverage {
  currentState: CoverageState;
  jobEnumeration: CoverageState;
  lifecycleHistory: CoverageState;
  settlementHistory: CoverageState;
  accountPendingHistory: CoverageState;
  deploymentVerification: CoverageState;
  sourceAgreement: CoverageState;
}
export const emptyCoverage = (): Coverage => ({
  currentState: 'unknown',
  jobEnumeration: 'unknown',
  lifecycleHistory: 'unknown',
  settlementHistory: 'unknown',
  accountPendingHistory: 'unknown',
  deploymentVerification: 'unknown',
  sourceAgreement: 'unknown',
});
export interface Snapshot {
  chainId: string;
  blockNumber: string;
  blockHash: string;
  observedAt: string;
  finality: 'FINALIZED' | 'UNKNOWN';
  sourceSet: string[];
}
export interface RawMeta {
  jobId: string;
  poster: string;
  reward: string;
  deadline: string;
  ipfsDescHash: string;
  category: string;
  tags: string[];
  agentId: string;
  agentOnly: boolean;
  humanOnly: boolean;
  whitelistedProvider: string;
  assignedProvider: string;
  submittedResultHash: string;
  submittedAt: string;
  isTaken: boolean;
  rejectedAt: string;
  rejectionReasonHash: string;
  inDispute: boolean;
  resolved: boolean;
  disputeInitiator: string;
  disputeRaisedAt: string;
  disputeReasonHash: string;
  disputeResponseHash: string;
  disputeRulingHash: string;
  requireWorkerBond: boolean;
  workerBond: string;
}
export interface RawLog {
  address: string;
  topics: `0x${string}`[];
  data: `0x${string}`;
  transactionHash: string;
  blockHash: string;
  blockNumber: string;
  logIndex: string;
  removed?: boolean;
}
export interface Receipt {
  transactionHash: string;
  transactionIndex?: string;
  blockHash: string;
  blockNumber: string;
  status: string;
  gasUsed: string;
  effectiveGasPrice: string;
  logs: RawLog[];
}
export interface ProtocolEvent {
  id: string;
  name: string;
  args: Record<string, string | boolean>;
  jobId?: string;
  transactionHash: string;
  blockHash: string;
  blockNumber: string;
  logIndex: string;
  evidenceIds: string[];
}
export interface Movement {
  id: string;
  transactionHash: string;
  blockHash: string;
  logIndex: string;
  from: string;
  to: string;
  atomic: string;
  evidenceIds: string[];
  crossCheck: 'matched' | 'absent' | 'ambiguous';
}
export interface Amount {
  asset: 'USDC';
  decimals: 18;
  atomic: Knowledge<string>;
}
export const amount = (atomic: Knowledge<string>): Amount => ({
  asset: 'USDC',
  decimals: 18,
  atomic,
});
export interface SettlementLeg {
  id: string;
  from?: string;
  role: 'WORKER' | 'POSTER' | 'PROTOCOL' | 'ADAPTER' | 'ESCROW';
  kind:
    | 'DEPOSIT'
    | 'ESCROW_TRANSIT'
    | 'BOND_DEPOSIT'
    | 'REWARD'
    | 'FEE'
    | 'REFUND'
    | 'BOND_RETURN'
    | 'BOND_FORFEIT'
    | 'TIMEOUT_SHARE';
  payee: string;
  expectedAmount: Amount;
  observedAmount: Amount;
  parkedAmount: Amount;
  attribution: 'DIRECT' | 'UNIQUE_EVENT_SEGMENT' | 'ACCOUNT_ONLY' | 'AMBIGUOUS' | 'ZERO_ALLOCATION';
  obligationIds: string[];
  evidenceIds: string[];
  ruleVersion: string;
}
export interface JobRow {
  jobKey: string;
  jobId: string;
  adapter: string;
  poster: string;
  worker: Knowledge<string>;
  snapshot: Snapshot;
  reward: Amount;
  lifecycle: string;
  cashState: string;
  coverage: Coverage;
  selfTake: boolean;
  freshness?: 'known' | 'stale';
  confidence: { state: 'uncalibrated'; reason: string };
  modelVersion: string;
  historyRange?: HistoryRange;
}
export interface StoredEvidence {
  id: string;
  evidence: Record<string, unknown>;
  raw: unknown;
  payloadHash: string;
  snapshot: Snapshot;
}
export interface PendingAccount {
  payee: string;
  balance: Amount;
  history: CoverageState;
  withdrawals: {
    transactionHash: string;
    amount: Amount;
    attribution: 'ACCOUNT_ONLY';
    evidenceIds: string[];
    obligationIds: string[];
    eventId: string;
  }[];
  obligations: {
    id: string;
    jobId: string;
    transactionHash: string;
    logIndex: string;
    amount: Amount;
    status: 'OUTSTANDING' | 'CLEARED_SEQUENCE' | 'UNVERIFIED';
    clearedBy?: string;
  }[];
  sequenceDerivedJobIds: string[];
  evidenceIds: string[];
}
export interface JobDetail {
  job: JobRow;
  rawState: RawMeta;
  settlementLegs: SettlementLeg[];
  timeline: ProtocolEvent[];
  nextTimelineCursor: Knowledge<string>;
  evidence: StoredEvidence[];
  ruleVersion: string;
  pendingAccounts: PendingAccount[];
  gas: { transactionHash: string; amount: Amount }[];
  trace: 'NOT_QUERIED';
}
export interface HistoryRange {
  scope: 'DEPLOYMENT_TO_SNAPSHOT' | 'DECLARED_WINDOW';
  fromBlock: string;
  targetBlock: string;
  contiguousThrough: string;
  checkpointKey: string;
  checkpointVersion: string;
  status: 'complete' | 'partial';
  omittedPriorHistory: boolean;
  gaps: { fromBlock: string; toBlock: string; reason: string }[];
}
export interface SnapshotRun {
  id: string;
  snapshot: Snapshot;
  coverage: Coverage;
  expiresAt: string;
  jobs: JobDetail[];
  totalExpected: string;
  errors: string[];
  mode: 'stored-replay';
  historyRange?: HistoryRange;
  collection?: Record<string, unknown>;
}
export class LedgerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}
export const decimal = (value: string): string => {
  if (!/^(0|[1-9]\d{0,77})$/.test(value) || BigInt(value) >= 2n ** 256n)
    throw new LedgerError('INVALID_DECIMAL', '整数格式或范围不合法。', 400);
  return value;
};
export const address = (value: string): string => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new LedgerError('INVALID_ADDRESS', '地址格式不合法。', 400);
  return value.toLowerCase();
};
export const hex = (value: string): `0x${string}` => `0x${BigInt(value).toString(16)}`;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
