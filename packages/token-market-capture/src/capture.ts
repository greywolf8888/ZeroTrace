import { initialStages, markStage, type StageState } from '@zerotrace/terminal-pipeline';
import { assertLoadBearingQuorum } from '@zerotrace/source-registry';

import { campaignWindowsFromTransfers } from './campaign.js';
import { automaticLots } from './capital.js';
import { observeRoles } from './features.js';
import { captureHistory, holdersFromTransfers } from './history.js';
import { captureOrigin } from './origin.js';
import type {
  CaptureReport,
  RpcCallStats,
  RpcTransport,
  TokenCaptureRequest,
  TokenCaptureRuntime,
} from './types.js';

const DEFAULT_CHUNK = 2_000n;

const STOP_RANK = {
  CURRENT_SNAPSHOT: 0,
  ORIGIN: 1,
  LIFETIME_HISTORY: 2,
  ENTITY_AND_CAMPAIGN: 3,
  CAPITAL_AND_RV: 4,
  CASE_AND_REPLAY: 5,
} as const;

function shouldRun(
  stopAfter: TokenCaptureRequest['stopAfter'],
  stage: keyof typeof STOP_RANK,
): boolean {
  const stop = stopAfter ?? 'CASE_AND_REPLAY';
  return STOP_RANK[stage] <= STOP_RANK[stop];
}

function emptyStats(): RpcCallStats {
  return { current: 0, historical: 0, trace: 0, byMethod: {} };
}

function countingTransport(inner: RpcTransport, stats: RpcCallStats): RpcTransport {
  return {
    async call(endpointId, method, params) {
      stats.byMethod[method] = (stats.byMethod[method] ?? 0) + 1;
      const historical =
        method !== 'eth_blockNumber' &&
        method !== 'eth_chainId' &&
        method !== 'net_version' &&
        !(
          (method === 'eth_getCode' || method === 'eth_call') &&
          (params[1] === 'latest' || params[1] === 'safe' || params[1] === 'finalized')
        );
      if (method.startsWith('debug_') || method.startsWith('trace_')) stats.trace += 1;
      if (historical) stats.historical += 1;
      else stats.current += 1;
      return inner.call(endpointId, method, params);
    },
  };
}

function reportOf(
  request: TokenCaptureRequest,
  stages: StageState[],
  extra: Omit<CaptureReport, 'chainId' | 'token' | 'stages' | 'rawHashesValid'>,
): CaptureReport {
  return {
    chainId: request.chainId,
    token: request.token.toLowerCase(),
    stages,
    ...extra,
    rawHashesValid: extra.artifacts.every((item) => item.sha256.length === 64),
  };
}

export async function captureTokenMarket(
  runtime: TokenCaptureRuntime,
  request: TokenCaptureRequest,
): Promise<CaptureReport> {
  if (runtime.hydrate !== undefined) await runtime.hydrate(request);
  const rpcStats = emptyStats();
  const transport = countingTransport(runtime.transport, rpcStats);
  let stages: StageState[] = initialStages();
  const pending = (limitation: string): CaptureReport =>
    reportOf(request, stages, {
      origin: { status: 'PARTIAL', limitation },
      history: { status: 'PARTIAL', logCount: 0, limitation },
      holders: [],
      roles: [],
      campaignWindows: [],
      lotCount: 0,
      artifacts: [],
      rpcStats,
    });

  try {
    assertLoadBearingQuorum(runtime.operators);
    stages = markStage(stages, 'CAPABILITY', 'COMPLETE');
  } catch (error) {
    const limitation = error instanceof Error ? error.message : '能力矩阵未满足。';
    stages = markStage(stages, 'CAPABILITY', 'FAILED', limitation);
    const failed = reportOf(request, stages, {
      origin: { status: 'FAILED', limitation },
      history: { status: 'FAILED', logCount: 0, limitation },
      holders: [],
      roles: [],
      campaignWindows: [],
      lotCount: 0,
      artifacts: [],
      rpcStats,
    });
    if (runtime.persist !== undefined) await runtime.persist(request, failed);
    return failed;
  }

  stages = markStage(
    stages,
    'SNAPSHOT',
    'PARTIAL',
    '公开 RPC 头不等于 pinned archive fork；快照保持部分观察。',
  );
  if (!shouldRun(request.stopAfter, 'ORIGIN')) {
    const snapshot = pending('CURRENT_SNAPSHOT 阶段不拉取起源或历史。');
    if (runtime.persist !== undefined) await runtime.persist(request, snapshot);
    return snapshot;
  }

  const token = request.token.toLowerCase();
  const cachedOrigin = runtime.cachedOrigins?.get(token);
  const originCapture = await captureOrigin({
    transport,
    operators: runtime.operators,
    request,
    ...(runtime.traceAvailable === undefined ? {} : { traceAvailable: runtime.traceAvailable }),
    ...(runtime.traceEndpointId === undefined ? {} : { traceEndpointId: runtime.traceEndpointId }),
    ...(runtime.creationTraceSource === undefined
      ? {}
      : { creationTraceSource: runtime.creationTraceSource }),
    ...(cachedOrigin === undefined ? {} : { cachedOrigin }),
  });
  stages = markStage(
    stages,
    'ORIGIN',
    originCapture.origin.status,
    originCapture.origin.limitation,
  );
  if (originCapture.origin.status === 'COMPLETE') {
    runtime.cachedOrigins?.set(token, originCapture.origin);
  }
  if (!shouldRun(request.stopAfter, 'LIFETIME_HISTORY')) {
    const originOnly = reportOf(request, stages, {
      origin: originCapture.origin,
      history: {
        status: 'PARTIAL',
        logCount: runtime.index.transfers(`${request.chainId}:${token}`).length,
        limitation: 'ORIGIN 阶段不扫描生命周期日志。',
      },
      holders: [],
      roles: [],
      campaignWindows: [],
      lotCount: 0,
      artifacts: originCapture.artifacts,
      rpcStats,
    });
    if (runtime.persist !== undefined) await runtime.persist(request, originOnly);
    return originOnly;
  }

  const originBlock =
    originCapture.origin.createdBlock === undefined
      ? undefined
      : BigInt(originCapture.origin.createdBlock);
  const historyCapture = await captureHistory({
    transport,
    operators: runtime.operators,
    chainId: request.chainId,
    token: request.token,
    ...(originBlock === undefined ? {} : { originBlock }),
    index: runtime.index,
    logBudgetChunks: request.logBudgetChunks ?? runtime.logBudgetChunks,
    chunkBlocks: request.chunkBlocks ?? DEFAULT_CHUNK,
    ...(runtime.bulkLogSource === undefined ? {} : { bulkLogSource: runtime.bulkLogSource }),
  });
  stages = markStage(
    stages,
    'HISTORY',
    historyCapture.history.status,
    historyCapture.history.limitation,
  );

  const holders = holdersFromTransfers(historyCapture.transfers);
  stages = markStage(
    stages,
    'SUPPLY',
    'PARTIAL',
    '持有人由已索引 Transfer 物化；未覆盖区间的差额保持未知，不是 0。',
  );

  if (!shouldRun(request.stopAfter, 'ENTITY_AND_CAMPAIGN')) {
    const historyOnly = reportOf(request, stages, {
      origin: originCapture.origin,
      history: historyCapture.history,
      holders,
      roles: [],
      campaignWindows: [],
      lotCount: 0,
      artifacts: [...originCapture.artifacts, ...historyCapture.artifacts],
      rpcStats,
    });
    if (runtime.persist !== undefined) await runtime.persist(request, historyOnly);
    return historyOnly;
  }

  const roles = observeRoles({
    holders,
    transfers: historyCapture.transfers,
    ...(originCapture.origin.deployer === undefined
      ? {}
      : { deployer: originCapture.origin.deployer }),
    ...(originBlock === undefined ? {} : { originBlock }),
  });
  stages = markStage(
    stages,
    'ENTITY',
    'PARTIAL',
    '角色特征从转账自动提取；无真实标注不得输出校准概率。服务节点不得标控制实体或散户。',
  );

  const campaignWindows = campaignWindowsFromTransfers(historyCapture.transfers);
  stages = markStage(
    stages,
    'CAMPAIGN',
    'PARTIAL',
    historyCapture.history.status === 'COMPLETE'
      ? '切分窗口来自已索引序列；手法确认仍需排除替代解释。'
      : '历史未闭合，不得伪造完整坐庄周期。',
  );

  if (!shouldRun(request.stopAfter, 'CAPITAL_AND_RV')) {
    const entityOnly = reportOf(request, stages, {
      origin: originCapture.origin,
      history: historyCapture.history,
      holders,
      roles,
      campaignWindows,
      lotCount: 0,
      artifacts: [...originCapture.artifacts, ...historyCapture.artifacts],
      rpcStats,
    });
    if (runtime.persist !== undefined) await runtime.persist(request, entityOnly);
    return entityOnly;
  }

  const lots = automaticLots({
    chainId: request.chainId,
    token: request.token.toLowerCase(),
    transfers: historyCapture.transfers,
  });
  stages = markStage(stages, 'CAPITAL', 'PARTIAL', lots.limitation);
  stages = markStage(
    stages,
    'RV',
    runtime.pinnedFork === undefined ? 'UNSUPPORTED' : 'PARTIAL',
    runtime.pinnedFork === undefined
      ? '无 pinned archive fork，拒绝用 V2 虚拟储备冒充精确 VM。'
      : '已声明 fork，尚未接入 revm 执行。',
  );

  const artifacts = [...originCapture.artifacts, ...historyCapture.artifacts];
  stages = markStage(
    stages,
    'REPLAY',
    artifacts.length > 0 ? 'PARTIAL' : 'FAILED',
    '已保存原始 RPC 哈希；完整 Decoder/Ledger/模型重执行尚未闭合。',
  );

  const report = reportOf(request, stages, {
    origin: originCapture.origin,
    history: historyCapture.history,
    holders,
    roles,
    campaignWindows,
    lotCount: lots.lots.length,
    ...(lots.limitation === undefined ? {} : { capitalLimitation: lots.limitation }),
    artifacts,
    rpcStats,
  });
  if (runtime.persist !== undefined) await runtime.persist(request, report);
  return report;
}

export { captureOrigin } from './origin.js';
export { captureHistory, holdersFromTransfers } from './history.js';
export { extractAddressFeatures, observeRoles, DEFAULT_SERVICE_HUBS } from './features.js';
export { campaignWindowsFromTransfers } from './campaign.js';
export { automaticLots } from './capital.js';
export { MemoryLocalIndex, tokenKey } from '@zerotrace/local-index';
export type {
  CaptureReport,
  RpcTransport,
  TokenCaptureRequest,
  TokenCaptureRuntime,
} from './types.js';
