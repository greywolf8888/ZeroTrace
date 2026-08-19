import { initialStages, markStage, type StageState } from '@zerotrace/terminal-pipeline';
import { assertLoadBearingQuorum } from '@zerotrace/source-registry';

import { campaignWindowsFromTransfers } from './campaign.js';
import { automaticLots } from './capital.js';
import { observeRoles } from './features.js';
import { captureHistory, holdersFromTransfers } from './history.js';
import { captureOrigin } from './origin.js';
import type { CaptureReport, TokenCaptureRequest, TokenCaptureRuntime } from './types.js';

const DEFAULT_CHUNK = 2_000n;

export async function captureTokenMarket(
  runtime: TokenCaptureRuntime,
  request: TokenCaptureRequest,
): Promise<CaptureReport> {
  let stages: StageState[] = initialStages();
  try {
    assertLoadBearingQuorum(runtime.operators);
    stages = markStage(stages, 'CAPABILITY', 'COMPLETE');
  } catch (error) {
    const limitation = error instanceof Error ? error.message : '能力矩阵未满足。';
    stages = markStage(stages, 'CAPABILITY', 'FAILED', limitation);
    return {
      chainId: request.chainId,
      token: request.token.toLowerCase(),
      stages,
      origin: { status: 'FAILED', limitation },
      history: { status: 'FAILED', logCount: 0, limitation },
      holders: [],
      roles: [],
      campaignWindows: [],
      lotCount: 0,
      artifacts: [],
      rawHashesValid: false,
    };
  }

  stages = markStage(
    stages,
    'SNAPSHOT',
    'PARTIAL',
    '公开 RPC 头不等于 pinned archive fork；快照保持部分观察。',
  );

  const originCapture = await captureOrigin({
    transport: runtime.transport,
    operators: runtime.operators,
    request,
  });
  stages = markStage(
    stages,
    'ORIGIN',
    originCapture.origin.status,
    originCapture.origin.limitation,
  );

  const originBlock =
    originCapture.origin.createdBlock === undefined
      ? undefined
      : BigInt(originCapture.origin.createdBlock);
  const historyCapture = await captureHistory({
    transport: runtime.transport,
    operators: runtime.operators,
    chainId: request.chainId,
    token: request.token,
    ...(originBlock === undefined ? {} : { originBlock }),
    index: runtime.index,
    logBudgetChunks: request.logBudgetChunks ?? runtime.logBudgetChunks,
    chunkBlocks: request.chunkBlocks ?? DEFAULT_CHUNK,
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
    historyCapture.history.status === 'COMPLETE' ? 'PARTIAL' : 'PARTIAL',
    '持有人由已索引 Transfer 物化；未覆盖区间的差额保持未知，不是 0。',
  );

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
    historyCapture.history.status === 'COMPLETE' && campaignWindows.length > 0
      ? 'PARTIAL'
      : 'PARTIAL',
    historyCapture.history.status === 'COMPLETE'
      ? '切分窗口来自已索引序列；手法确认仍需排除替代解释。'
      : '历史未闭合，不得伪造完整坐庄周期。',
  );

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

  return {
    chainId: request.chainId,
    token: request.token.toLowerCase(),
    stages,
    origin: originCapture.origin,
    history: historyCapture.history,
    holders,
    roles,
    campaignWindows,
    lotCount: lots.lots.length,
    ...(lots.limitation === undefined ? {} : { capitalLimitation: lots.limitation }),
    artifacts,
    rawHashesValid: artifacts.every((item) => item.sha256.length === 64),
  };
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
