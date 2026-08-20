import type { QueryPlan, QueryPlanStep } from './types.js';

export function splitRange(
  fromBlock: bigint,
  toBlock: bigint,
): { left: { from: bigint; to: bigint }; right: { from: bigint; to: bigint } } | undefined {
  if (toBlock <= fromBlock) return undefined;
  const span = toBlock - fromBlock + 1n;
  const mid = fromBlock + span / 2n - 1n;
  return {
    left: { from: fromBlock, to: mid },
    right: { from: mid + 1n, to: toBlock },
  };
}

export function nextWindow(input: {
  from: bigint;
  to: bigint;
  ok: boolean;
  persisted: boolean;
  responseBytes: number;
  maxResponseBytes: number;
}): { from: bigint; to: bigint } | { split: true; from: bigint; to: bigint } | { blocked: string } {
  if (!input.ok) {
    const split = splitRange(input.from, input.to);
    if (split === undefined) return { blocked: 'RANGE_SPLIT_EXHAUSTED' };
    return { split: true, from: split.left.from, to: split.left.to };
  }
  if (input.responseBytes > input.maxResponseBytes) {
    const split = splitRange(input.from, input.to);
    if (split === undefined) return { blocked: 'RESPONSE_SIZE_LIMIT' };
    return { split: true, from: split.left.from, to: split.left.to };
  }
  if (!input.persisted) return { blocked: 'CURSOR_REQUIRES_PERSIST' };
  return { from: input.to + 1n, to: input.to + (input.to - input.from + 1n) };
}

export function planQuery(input: {
  hasLocalIndex: boolean;
  bulkAvailable: boolean;
  archiveRequired: boolean;
  traceRequired: boolean;
  loadBearing: boolean;
  method: string;
}): QueryPlan {
  const steps: QueryPlanStep[] = [];
  if (input.hasLocalIndex) {
    steps.push({
      id: 'local-index',
      source: 'LOCAL_INDEX',
      method: 'index.scan',
      estimatedRpcCost: 0,
      loadBearing: false,
    });
    steps.push({
      id: 'cache',
      source: 'CONTENT_CACHE',
      method: 'cache.get',
      estimatedRpcCost: 0,
      loadBearing: false,
    });
  }
  if (input.bulkAvailable && (input.method === 'eth_getLogs' || input.method === 'dataset.scan')) {
    steps.push({
      id: 'bulk-dataset',
      source: 'BULK_DATASET',
      method: 'dataset.scan',
      estimatedRpcCost: 1,
      loadBearing: false,
    });
  } else if (!input.hasLocalIndex && input.method === 'eth_getLogs' && !input.bulkAvailable) {
    steps.push({
      id: 'blocked-public-logs',
      source: 'RPC_GAP',
      method: 'eth_getLogs',
      estimatedRpcCost: 0,
      loadBearing: false,
    });
  }
  if (input.archiveRequired) {
    steps.push({
      id: 'rpc-state',
      source: 'RPC_GAP',
      method: input.method,
      estimatedRpcCost: 2,
      loadBearing: input.loadBearing,
    });
  }
  if (input.loadBearing) {
    steps.push({
      id: 'independent-verify',
      source: 'INDEPENDENT_VERIFY',
      method: 'eth_getBlockByHash',
      estimatedRpcCost: 2,
      loadBearing: true,
    });
  }
  if (input.traceRequired) {
    steps.push({
      id: 'trace-critical',
      source: 'TRACE_CRITICAL',
      method: 'debug_traceTransaction',
      estimatedRpcCost: 4,
      loadBearing: true,
    });
  }
  return {
    steps,
    estimatedRpcCost: steps.reduce((sum, step) => sum + step.estimatedRpcCost, 0),
    localIndexFirst: input.hasLocalIndex,
    forbidPerTokenPublicLogs: true,
    cursorAdvanceRequiresPersist: true,
  };
}

export function planLifetimeHistory(input: {
  coverageComplete: boolean;
  bulkAvailable: boolean;
}): QueryPlan {
  const steps: QueryPlanStep[] = [
    {
      id: 'local-index',
      source: 'LOCAL_INDEX',
      method: 'index.scan',
      estimatedRpcCost: 0,
      loadBearing: false,
    },
    {
      id: 'cache',
      source: 'CONTENT_CACHE',
      method: 'cache.get',
      estimatedRpcCost: 0,
      loadBearing: false,
    },
  ];
  if (!input.coverageComplete && input.bulkAvailable) {
    steps.push({
      id: 'bulk-dataset',
      source: 'BULK_DATASET',
      method: 'dataset.scan',
      estimatedRpcCost: 1,
      loadBearing: false,
    });
  }
  return {
    steps,
    estimatedRpcCost: steps.reduce((sum, step) => sum + step.estimatedRpcCost, 0),
    localIndexFirst: true,
    forbidPerTokenPublicLogs: true,
    cursorAdvanceRequiresPersist: true,
  };
}

export function planCorpusIngestion(input: {
  tokenCount: number;
  bulkAvailable: boolean;
  keyedArchiveAvailable: boolean;
  traceAvailable: boolean;
}): QueryPlan & {
  strategy: 'BULK_THEN_RPC_VERIFY' | 'BLOCKED_NO_BULK';
  traceQueue: 'trace_pending';
} {
  const plan = planQuery({
    hasLocalIndex: true,
    bulkAvailable: input.bulkAvailable,
    archiveRequired: true,
    traceRequired: input.traceAvailable,
    loadBearing: true,
    method: 'dataset.scan',
  });
  return {
    ...plan,
    strategy: input.bulkAvailable ? 'BULK_THEN_RPC_VERIFY' : 'BLOCKED_NO_BULK',
    traceQueue: 'trace_pending',
    steps: [
      ...plan.steps,
      {
        id: 'multi-token-coalesce',
        source: 'BULK_DATASET',
        method: `tokens:${input.tokenCount}`,
        estimatedRpcCost: input.bulkAvailable ? 1 : 0,
        loadBearing: false,
      },
    ],
  };
}
