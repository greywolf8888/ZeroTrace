import type { SettlementResult } from '../../../packages/arc-task-ledger/src/result.js';
import type { EvidenceRequest } from '../../../packages/arc-task-ledger/src/storage.js';
export type K<T> =
  | { state: 'known'; value: T; evidenceIds?: string[] }
  | { state: string; reason: string; evidenceIds?: string[] };
export interface Amount {
  atomic: K<string>;
  decimals: number;
}
export interface Row {
  jobId: string;
  adapter: string;
  poster: K<string>;
  worker: K<string>;
  reward: K<Amount>;
  lifecycle: K<string>;
  cashState: K<string>;
  snapshot: {
    chainId: string;
    blockNumber: string;
    blockHash: string;
    observedAt: string;
    sourceSet: string[];
  };
  coverage: Record<string, K<string>>;
  freshness?: string;
}
export interface Registry {
  chainId: string;
  adapter: string;
  navigation: {
    taskOrigin: string;
    taskPathPrefix: string;
    transactionOrigin: string;
    transactionPathPrefix: string;
    sourceRepository: string;
  };
}
export interface Page {
  snapshotRunId: string;
  items: Row[];
  nextCursor: string | null;
  snapshot: Row['snapshot'];
  freshness: { state: string; capturedAt: string };
  historyRange: K<{
    fromBlock: string;
    targetBlock: string;
    contiguousThrough: string;
    status: string;
    omittedPriorHistory: boolean;
    gaps: { fromBlock: string; toBlock: string; reason: string }[];
  }>;
}
export interface Detail {
  job: Row;
  snapshotTasks?: Row[];
  snapshotRunId: string;
  result: SettlementResult;
  rawState: K<Record<string, unknown>>;
  ruleVersion: string;
  settlementLegs: {
    id: string;
    role: string;
    kind: string;
    payee: string;
    expectedAmount: Amount;
    observedAmount: K<Amount>;
    parkedAmount: K<Amount>;
    attribution: string;
    evidenceIds: string[];
  }[];
  pendingAccounts: {
    payee: string;
    balance: Amount;
    history: string;
    obligations: {
      id: string;
      jobId: string;
      amount: Amount;
      status: string;
      clearedBy?: string;
      transactionHash: string;
    }[];
    withdrawals: {
      eventId: string;
      transactionHash: string;
      amount: Amount;
      obligationIds: string[];
      evidenceIds: string[];
    }[];
  }[];
  timeline: {
    id: string;
    name: string;
    blockNumber: string;
    transactionHash: string;
    evidenceIds: string[];
  }[];
  nextTimelineCursor: string | null;
  evidence: { id: string; payloadHash: string; sourceAlias: string; safePayload: unknown }[];
  evidenceRequest: EvidenceRequest | null;
}
export const value = <T>(k: K<T>): T | undefined =>
  k.state === 'known' && 'value' in k ? k.value : undefined;
export function money(a: Amount) {
  const atoms = value(a.atomic);
  if (atoms === undefined) return '未知：暂无法核验';
  const n = BigInt(atoms);
  const divisor = 10n ** BigInt(a.decimals);
  const f = (n % divisor).toString().padStart(a.decimals, '0').replace(/0+$/, '');
  return `${n / divisor}${f ? '.' + f : ''} USDC`;
}
export const labels: Record<string, string> = {
  OPEN: '待接单',
  TAKEN: '已接单',
  SUBMITTED: '已提交',
  REJECTION_PENDING: '拒绝待处理',
  DISPUTED: '争议中',
  TERMINAL_UNKNOWN: '任务结束路径待核验',
  APPROVED: '已批准',
  CANCELLED: '已取消',
  EXPIRED: '已执行到期',
  REJECTED: '已拒绝',
  DISPUTE_WORKER: '裁定工作者胜',
  DISPUTE_POSTER: '裁定发布者胜',
  TIMEOUT_SPLIT: '仲裁超时分账',
  EXTERNAL_REFUND_RECONCILED: '外部退款已协调',
  CONFIRMED_DIRECT: '已核验直接转移',
  PARKED: '曾转入待领取',
  PARTIAL: '部分直接转移，部分待领取',
  UNKNOWN: '暂无法核验',
  CONFLICT: '证据冲突',
  NONE_OBSERVED: '未观察到任务付款',
  NOT_APPLICABLE: '零分配，无应付义务',
  VERIFIED_SEQUENCE_DERIVED: '完整账户序列推导已领取',
  WITHDRAWAL_OBSERVED_ACCOUNT_LEVEL: '仅账户级提现',
  WORKER: '工作者',
  POSTER: '发布者',
  PROTOCOL: '协议费用',
  ADAPTER: '任务适配器',
  ESCROW: '托管合约',
  DEPOSIT: '奖励存入',
  ESCROW_TRANSIT: '托管中转',
  BOND_DEPOSIT: '保证金存入',
  REWARD: '奖励',
  FEE: '费用',
  REFUND: '退款',
  BOND_RETURN: '保证金退回',
  BOND_FORFEIT: '保证金没收',
  TIMEOUT_SHARE: '超时份额',
  DIRECT: '唯一直接转移',
  UNIQUE_EVENT_SEGMENT: '唯一事件段',
  ACCOUNT_ONLY: '仅账户级',
  AMBIGUOUS: '归属有歧义',
  ZERO_ALLOCATION: '已核验零分配',
  CLEARED_SEQUENCE: '具体义务已清偿',
  OUTSTANDING: '已核验仍未清偿',
  UNVERIFIED: '清偿关系未核验',
  PENDING: '等待有界采集',
  COMPLETED: '所选区间已完成',
  FAILED: '补证失败，未自动扩张范围',
  NEW_EVIDENCE_FOUND: '取得新的相关回执证据',
  NO_MATCH_IN_RANGE: '所选区间未取得新的相关回执',
  STILL_INSUFFICIENT: '仍缺少可定位的证据',
  complete: '完整',
  partial: '不完整',
  unknown: '未知',
  conflict: '冲突',
  currentState: '当前状态',
  jobEnumeration: '任务枚举',
  sourceAgreement: '来源一致性',
  lifecycleHistory: '生命周期历史',
  settlementHistory: '结算历史',
  accountPendingHistory: '待领取历史',
  deploymentVerification: '部署核验',
  BountyCreated: '创建任务',
  BountyTaken: '接单',
  WorkSubmitted: '提交工作',
  BountyCompleted: '任务完成事件',
  ProtocolFeePaid: '费用分配声明',
  PayoutParked: '转入待领取',
  WithdrawalClaimed: '账户提现',
  WorkerBondRefunded: '保证金退回声明',
  DisputeResolved: '争议裁决',
  ExternalRefundReconciled: '外部退款协调',
};
export const label = (s: string) => labels[s] ?? `协议字段：${s}`;
export function semantics(state: string) {
  return [
    'CONFIRMED_DIRECT',
    'VERIFIED_SEQUENCE_DERIVED',
    'NOT_APPLICABLE',
    'complete',
    'confirmed',
  ].includes(state)
    ? 'confirmed'
    : ['CONFLICT', 'conflict'].includes(state)
      ? 'conflict'
      : ['PARKED', 'PARTIAL', 'pending'].includes(state)
        ? 'pending'
        : 'unknown';
}
export function parseInput(
  input: string,
  registry: Registry,
): { jobId: string } | { address: string } {
  const text = input.trim();
  if (/^0x[\da-fA-F]{40}$/.test(text)) return { address: text.toLowerCase() };
  if (/^(0|[1-9]\d{0,77})$/.test(text) && BigInt(text) < 2n ** 256n) return { jobId: text };
  try {
    const u = new URL(text);
    const origin = new URL(registry.navigation.taskOrigin);
    if (u.origin !== origin.origin || u.username || u.password || u.hash) throw Error();
    const match = u.pathname.match(
      new RegExp('^' + registry.navigation.taskPathPrefix + '(0|[1-9]\\d{0,77})/?$'),
    );
    if (
      !match ||
      BigInt(match[1]!) >= 2n ** 256n ||
      [...u.searchParams.keys()].some((k) => !['chainId', 'adapter'].includes(k)) ||
      (u.searchParams.has('chainId') && u.searchParams.get('chainId') !== registry.chainId) ||
      (u.searchParams.has('adapter') &&
        u.searchParams.get('adapter')?.toLowerCase() !== registry.adapter)
    )
      throw Error();
    return { jobId: match[1]! };
  } catch {
    throw new Error(
      '输入不受支持：请使用任务编号、已登记 ArcBounty 主网任务链接或完整地址；不会抓取任意 URL。',
    );
  }
}
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, method = 'GET'): Promise<T> {
  const r = await fetch('/api' + path, {
    method,
    signal: AbortSignal.timeout(15000),
    ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
  });
  const body = await r.json();
  if (!r.ok)
    throw new ApiError(
      body.code ?? 'SERVICE_UNAVAILABLE',
      body.message ?? '读取暂不可用。',
      r.status,
    );
  return body as T;
}
export function taskPath(registry: Registry, id: string, runId?: string, report = false) {
  return `/tasks/${registry.chainId}/${registry.adapter}/${id}${report ? '/report' : ''}${runId ? '?snapshotRunId=' + encodeURIComponent(runId) : ''}`;
}
