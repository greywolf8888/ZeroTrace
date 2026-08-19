import {
  coverageComplete,
  coverageGaps,
  tokenKey,
  type IndexedTransfer,
  type LocalIndexStore,
} from '@zerotrace/local-index';
import type { SourceOperator } from '@zerotrace/source-registry';

import {
  callBoth,
  decodeUint,
  fromHex,
  normalizeAddress,
  sha256Hex,
  toHex,
  topicAddress,
} from './rpc.js';
import {
  TRANSFER_TOPIC,
  ZERO_ADDRESS,
  type CaptureArtifact,
  type HistoryObservation,
  type HolderBalance,
  type RpcTransport,
} from './types.js';

interface LogShape {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string;
  removed?: boolean;
}

function isRangeError(error: string | undefined): boolean {
  if (error === undefined) return false;
  return /limit|range|too many|exceed/i.test(error);
}

function parseLogs(result: unknown): LogShape[] {
  return Array.isArray(result) ? (result as LogShape[]) : [];
}

function logId(item: LogShape): string {
  return `${item.transactionHash ?? ''}:${item.logIndex ?? ''}`;
}

function toTransfer(chainId: string, token: string, item: LogShape): IndexedTransfer | undefined {
  if (item.removed === true) return undefined;
  const topics = item.topics ?? [];
  if (topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return undefined;
  if (topics[1] === undefined || topics[2] === undefined) return undefined;
  return {
    chainId,
    token,
    blockNumber: fromHex(item.blockNumber ?? '0x0'),
    logIndex: Number(fromHex(item.logIndex ?? '0x0')),
    transactionHash: (item.transactionHash ?? '').toLowerCase(),
    from: topicAddress(topics[1]!),
    to: topicAddress(topics[2]!),
    valueAtomic: decodeUint(item.data ?? '0x0').toString(10),
  };
}

export async function captureHistory(input: {
  transport: RpcTransport;
  operators: readonly SourceOperator[];
  chainId: string;
  token: string;
  originBlock?: bigint;
  index: LocalIndexStore;
  logBudgetChunks: number;
  chunkBlocks: bigint;
}): Promise<{
  history: HistoryObservation;
  transfers: IndexedTransfer[];
  artifacts: CaptureArtifact[];
}> {
  const artifacts: CaptureArtifact[] = [];
  const endpoints = input.operators.map((item) => item.endpointId);
  const token = normalizeAddress(input.token);
  const key = tokenKey(input.chainId, token);
  const headCall = await callBoth(input.transport, endpoints, 'eth_blockNumber', []);
  artifacts.push(
    { path: 'rpc/head-left.json', sha256: sha256Hex(headCall.left.raw) },
    { path: 'rpc/head-right.json', sha256: sha256Hex(headCall.right.raw) },
  );
  if (!headCall.agree || typeof headCall.left.result !== 'string') {
    return {
      history: {
        status: 'FAILED',
        logCount: 0,
        limitation: '区块高度双 Operator 不一致或不可用，拒绝把空日志当完整历史。',
      },
      transfers: input.index.transfers(key),
      artifacts,
    };
  }
  const head = fromHex(headCall.left.result);
  const origin = input.originBlock ?? 0n;
  let chunks = 0;
  let cursor = origin;
  while (cursor <= head && chunks < input.logBudgetChunks) {
    const remainingGaps = coverageGaps(input.index.coverage(key), origin, head);
    const gap = remainingGaps[0];
    if (gap === undefined) break;
    const from = gap.startBlock < cursor ? cursor : gap.startBlock;
    let span = input.chunkBlocks;
    if (from + span - 1n > gap.endBlock) span = gap.endBlock - from + 1n;
    if (span < 1n) break;
    let accepted = false;
    while (span >= 1n && !accepted) {
      const params = [
        {
          fromBlock: toHex(from),
          toBlock: toHex(from + span - 1n),
          address: token,
          topics: [TRANSFER_TOPIC],
        },
      ];
      const logs = await callBoth(input.transport, endpoints, 'eth_getLogs', params);
      artifacts.push(
        {
          path: `rpc/logs-${from.toString(10)}-left.json`,
          sha256: sha256Hex(logs.left.raw),
        },
        {
          path: `rpc/logs-${from.toString(10)}-right.json`,
          sha256: sha256Hex(logs.right.raw),
        },
      );
      if (!logs.left.ok || !logs.right.ok) {
        const error = logs.left.error ?? logs.right.error;
        if (isRangeError(error) && span > 1n) {
          span = span / 2n;
          continue;
        }
        return {
          history: {
            status: 'PARTIAL',
            fromBlock: origin.toString(10),
            toBlock: from.toString(10),
            headBlock: head.toString(10),
            logCount: input.index.transfers(key).length,
            limitation: `日志窗口失败：${error ?? 'unknown'}。未覆盖区间不得记为空持有人。`,
          },
          transfers: input.index.transfers(key),
          artifacts,
        };
      }
      const leftLogs = parseLogs(logs.left.result).filter((item) => item.removed !== true);
      const rightLogs = parseLogs(logs.right.result).filter((item) => item.removed !== true);
      const leftIds = new Set(leftLogs.map(logId));
      const rightIds = new Set(rightLogs.map(logId));
      if (leftIds.size !== rightIds.size || [...leftIds].some((id) => !rightIds.has(id))) {
        return {
          history: {
            status: 'FAILED',
            fromBlock: origin.toString(10),
            headBlock: head.toString(10),
            logCount: input.index.transfers(key).length,
            limitation: '日志集合双 Operator 不一致，按静默截断/冲突处理，不得取较短一方。',
          },
          transfers: input.index.transfers(key),
          artifacts,
        };
      }
      const parsed = leftLogs
        .map((item) => toTransfer(input.chainId, token, item))
        .filter((item): item is IndexedTransfer => item !== undefined);
      input.index.putTransfers(key, parsed);
      input.index.putCoverage(key, { startBlock: from, endBlock: from + span - 1n });
      accepted = true;
      cursor = from + span;
      chunks += 1;
    }
    if (!accepted) break;
  }

  const transfers = input.index.transfers(key);
  const complete = origin > 0n && coverageComplete(input.index.coverage(key), origin, head);
  return {
    history: {
      status: complete ? 'COMPLETE' : 'PARTIAL',
      fromBlock: origin.toString(10),
      toBlock: (input.index.coverage(key).at(-1)?.endBlock ?? origin).toString(10),
      headBlock: head.toString(10),
      logCount: transfers.length,
      ...(complete
        ? {}
        : {
            limitation:
              origin === 0n
                ? '起源区块未知，历史覆盖无法闭合。'
                : '公开 RPC 窗口未覆盖起源到当前头，持有人集合保持部分观察。',
          }),
    },
    transfers,
    artifacts,
  };
}

export function holdersFromTransfers(transfers: readonly IndexedTransfer[]): HolderBalance[] {
  const balances = new Map<string, bigint>();
  for (const item of transfers) {
    const value = BigInt(item.valueAtomic);
    if (item.from !== ZERO_ADDRESS) {
      balances.set(item.from, (balances.get(item.from) ?? 0n) - value);
    }
    if (item.to !== ZERO_ADDRESS) {
      balances.set(item.to, (balances.get(item.to) ?? 0n) + value);
    }
  }
  return [...balances.entries()]
    .filter(([, amount]) => amount !== 0n)
    .map(([address, amount]) => ({ address, amountAtomic: amount.toString(10) }));
}
