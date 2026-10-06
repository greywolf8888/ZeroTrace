import { createEvidence, hashPayload } from '@zerotrace/evidence';
import { decodeEventLog, parseAbiItem, toEventSelector } from 'viem';
import { ABI, DEPLOYMENT } from './config.js';
import { decodeUsdcLog, USDC_TRANSFER_TOPIC, usdcAtoms } from './usdc-log.js';
import {
  RULE_VERSION,
  ZERO_ADDRESS,
  address,
  decimal,
  type RawMeta,
  type ProtocolEvent,
  type Receipt,
  type Movement,
  type Snapshot,
  type StoredEvidence,
} from './types.js';

export const protocolAtoms = (value: string): string => usdcAtoms(value, 6);
export const timeoutSplit = (value: string): [string, string] => {
  const n = BigInt(decimal(value));
  return [(n / 2n).toString(), (n - n / 2n).toString()];
};
export function rawEvidence(
  raw: unknown,
  snapshot: Snapshot,
  locator: string,
  summary: string,
): StoredEvidence {
  raw = structuredClone(raw);
  const payloadHash = hashPayload(raw);
  const evidence = createEvidence({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    kind: 'RAW_RPC_RESPONSE',
    source: snapshot.sourceSet.join('+'),
    locator,
    payload: raw,
    summary,
    observedAt: snapshot.observedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    rawArtifactRef: `pg:arc_task_ledger_v1/observations/${payloadHash}`,
  });
  return { id: evidence.id, evidence: { ...evidence }, raw, payloadHash, snapshot };
}
export function decodeReceipt(
  receipt: Receipt,
  evidenceIds: string[],
): {
  events: ProtocolEvent[];
  movements: Movement[];
  normalization: 'complete' | 'unsupported' | 'conflict';
  nonCashLogs: {
    id: string;
    classification: 'APPROVAL' | 'UNSUPPORTED_TOPIC';
    evidenceIds: string[];
  }[];
} {
  if (receipt.status !== '0x1')
    return { events: [], movements: [], normalization: 'unsupported', nonCashLogs: [] };
  const nonCashLogs: {
    id: string;
    classification: 'APPROVAL' | 'UNSUPPORTED_TOPIC';
    evidenceIds: string[];
  }[] = [];
  const events: ProtocolEvent[] = [];
  const system: Movement[] = [];
  const erc: Movement[] = [];
  const seen = new Map<string, string>();
  let conflict = false;
  let unsupportedAdapter = false;
  const approvalAbi = [
    parseAbiItem('event Approval(address indexed owner,address indexed spender,uint256 value)'),
  ];
  const transferTopic = USDC_TRANSFER_TOPIC;
  const approvalTopic = toEventSelector(approvalAbi[0]!);
  const adapterTopics = new Set(
    ABI.filter((item) => item.type === 'event').map((item) => toEventSelector(item)),
  );
  for (const log of receipt.logs) {
    if (
      log.removed ||
      log.blockHash !== receipt.blockHash ||
      log.transactionHash !== receipt.transactionHash ||
      BigInt(log.blockNumber) !== BigInt(receipt.blockNumber)
    ) {
      conflict = true;
      continue;
    }
    const id = `5042:${receipt.transactionHash}:${BigInt(log.logIndex)}`;
    const digest = hashPayload(log);
    const previous = seen.get(id);
    if (previous !== undefined) {
      if (previous !== digest) conflict = true;
      continue;
    }
    seen.set(id, digest);
    const emitter = address(log.address);
    if (emitter === DEPLOYMENT.adapter) {
      if (!adapterTopics.has(log.topics[0]!)) {
        unsupportedAdapter = true;
        nonCashLogs.push({ id, classification: 'UNSUPPORTED_TOPIC', evidenceIds });
        continue;
      }
      try {
        const decoded = decodeEventLog({
          abi: ABI,
          data: log.data,
          topics: log.topics as [typeof log.data, ...(typeof log.data)[]],
          strict: true,
        });
        const args = Object.fromEntries(
          Object.entries(decoded.args ?? {}).map(([k, v]) => [
            k,
            typeof v === 'boolean' ? v : String(v),
          ]),
        );
        const jobId = typeof args.jobId === 'string' ? decimal(args.jobId) : undefined;
        if (decoded.eventName === undefined) {
          conflict = true;
          continue;
        }
        events.push({
          id,
          name: decoded.eventName,
          args,
          ...(jobId === undefined ? {} : { jobId }),
          transactionHash: receipt.transactionHash,
          blockHash: receipt.blockHash,
          blockNumber: BigInt(log.blockNumber).toString(),
          logIndex: BigInt(log.logIndex).toString(),
          evidenceIds,
        });
      } catch {
        conflict = true;
      }
    } else if (emitter === DEPLOYMENT.usdcSystemEmitter || emitter === DEPLOYMENT.usdcErc20) {
      if (log.topics[0] === approvalTopic && emitter === DEPLOYMENT.usdcErc20) {
        try {
          decodeEventLog({
            abi: approvalAbi,
            data: log.data,
            topics: log.topics as [typeof log.data, ...(typeof log.data)[]],
            strict: true,
          });
          nonCashLogs.push({ id, classification: 'APPROVAL', evidenceIds });
        } catch {
          conflict = true;
        }
        continue;
      }
      if (log.topics[0] !== transferTopic) {
        nonCashLogs.push({ id, classification: 'UNSUPPORTED_TOPIC', evidenceIds });
        continue;
      }
      try {
        const parsed = decodeUsdcLog(log, receipt, evidenceIds);
        if (parsed) (parsed.interface === 'SYSTEM' ? system : erc).push(parsed.movement);
      } catch {
        conflict = true;
      }
    }
  }
  const key = (m: Movement) => `${m.from}:${m.to}:${m.atomic}`;
  for (const m of system) {
    const peers = erc.filter((e) => key(e) === key(m));
    const same = system.filter((e) => key(e) === key(m));
    m.crossCheck =
      peers.length === 0
        ? 'absent'
        : peers.length === 1 && same.length === 1
          ? 'matched'
          : 'ambiguous';
  }
  for (const e of erc) if (!system.some((m) => key(m) === key(e))) conflict = true;
  return {
    events: events.sort((a, b) => Number(BigInt(a.logIndex) - BigInt(b.logIndex))),
    movements: conflict ? [] : system,
    nonCashLogs,
    normalization: conflict
      ? 'conflict'
      : unsupportedAdapter
        ? 'unsupported'
        : system.length === 0 && erc.length > 0
          ? 'unsupported'
          : 'complete',
  };
}
export function lifecycle(meta: RawMeta, events: ProtocolEvent[]): string {
  const names = new Set(events.map((e) => e.name));
  if (meta.resolved) {
    if (names.has('ExternalRefundReconciled')) return 'EXTERNAL_REFUND_RECONCILED';
    if (names.has('ArbitratorTimeoutClaimed')) return 'TIMEOUT_SPLIT';
    const dispute = events.findLast((e) => e.name === 'DisputeResolved');
    if (dispute) return dispute.args.payProvider ? 'DISPUTE_WORKER' : 'DISPUTE_POSTER';
    if (names.has('RejectionFinalized')) return 'REJECTED';
    if (names.has('BountyExpired')) return 'EXPIRED';
    if (names.has('BountyCompleted')) return 'APPROVED';
    if (names.has('BountyCancelled')) return 'CANCELLED';
    return 'TERMINAL_UNKNOWN';
  }
  if (meta.inDispute) return 'DISPUTED';
  if (meta.rejectedAt !== '0') return 'REJECTION_PENDING';
  if (meta.submittedAt !== '0') return 'SUBMITTED';
  return meta.isTaken ? 'TAKEN' : 'OPEN';
}
export function assertMeta(meta: RawMeta, id: string): void {
  if (decimal(meta.jobId) !== decimal(id) || address(meta.poster) === ZERO_ADDRESS)
    throw new Error('任务原始状态与枚举编号不一致。');
  for (const field of [
    'reward',
    'deadline',
    'agentId',
    'submittedAt',
    'rejectedAt',
    'disputeRaisedAt',
    'workerBond',
  ] as const)
    decimal(meta[field]);
  for (const field of [
    'poster',
    'assignedProvider',
    'whitelistedProvider',
    'disputeInitiator',
  ] as const)
    address(meta[field]);
}
export const ruleMetadata = {
  modelVersion: RULE_VERSION,
  confidence: { state: 'uncalibrated' as const, reason: '确定性规则与覆盖说明，不是校准概率。' },
};
