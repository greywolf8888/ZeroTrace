import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkspaceEnv } from '../apps/api/src/workspace-env.js';
import { loadConfig } from '../apps/api/src/config.js';
import { createTokenCaptureRuntime } from '../apps/api/src/token-capture-runtime.js';
import { captureTokenMarket } from '@zerotrace/token-market-capture';
import { evaluateShadowPromotion } from '@zerotrace/provider-plane';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadWorkspaceEnv(root);
const corpusPath = join(root, 'docs/terminal-market-structure/token-corpus.json');
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as {
  tokens: Array<{ token: string }>;
};

const config = loadConfig(process.env);
const runtime = createTokenCaptureRuntime(config);
if (runtime === undefined) {
  throw new Error('public operator quorum unavailable');
}

const tracePending: string[] = [];
const tokens = corpus.tokens.map((item) => item.token);
const perToken: Array<{
  token: string;
  origin: string;
  history: string;
  coverageLogs: number;
  openReasons: string[];
  limitationCode?: string;
}> = [];

for (const token of tokens) {
  const report = await captureTokenMarket(runtime, {
    chainId: 'eip155:56',
    token,
    logBudgetChunks: 1,
    chunkBlocks: 2_000n,
  });
  const openReasons = [
    report.origin.limitation,
    report.history.limitation,
    ...report.stages
      .filter((item) => item.status !== 'COMPLETE')
      .map((item) => `${item.name}:${item.status}`),
  ].filter((item): item is string => item !== undefined);
  if (report.origin.limitationCode === 'TRACE_UNAVAILABLE') {
    tracePending.push(token);
  }
  perToken.push({
    token,
    origin: report.origin.status,
    history: report.history.status,
    coverageLogs: report.history.logCount,
    openReasons,
    ...(report.origin.limitationCode === undefined
      ? {}
      : { limitationCode: report.origin.limitationCode }),
  });
}

const originComplete = perToken.filter((item) => item.origin === 'COMPLETE').length;
const historyComplete = perToken.filter((item) => item.history === 'COMPLETE').length;
const freeOnlyRate = tokens.length === 0 ? 0 : originComplete / tokens.length;
const keyedConfigured = Object.values(config.providerSlotStatus).some(
  (item) => item === 'CONFIGURED',
);
const traceConfigured = config.providerSlotStatus.BSC_TRACE_RPC_URL === 'CONFIGURED';

const document = {
  schemaVersion: 'zerotrace-corpus-run-v1',
  capturedAt: new Date().toISOString(),
  tokenCount: tokens.length,
  reviewed: false,
  modes: {
    FREE_ONLY: {
      completionRate: freeOnlyRate,
      originComplete,
      historyComplete,
      note: '公共 Operator + SQD/本地索引。无 Trace 时起源不得 COMPLETE。不是 G12 PASS。',
    },
    FREE_KEYED: {
      completionRate: keyedConfigured ? freeOnlyRate : null,
      status: keyedConfigured ? 'RAN_WITH_FREE_SLOTS' : 'UNCONFIGURED',
      slots: config.providerSlotStatus,
      note: keyedConfigured
        ? '已配置免费 Key 插槽；未关闭的能力仍保持 PARTIAL。'
        : '免费 Key 未配置。依赖归档/日志的 Case 必须 PARTIAL/BLOCKED，不得记 PASS。',
    },
    TRACE_ENABLED: {
      completionRate: null,
      status: traceConfigured ? 'PENDING_CRITICAL_TX_ONLY' : 'UNCONFIGURED',
      tracePending,
      note: traceConfigured
        ? '只对 trace_pending 的创建/迁移/权限/关键资金交易调用通用 Trace 插槽，不阻塞整个 Corpus。'
        : 'TRACE_UNAVAILABLE。不得用 receipt.contractAddress 或 Explorer 替代。',
    },
  },
  cost: {
    FREE_ONLY: {
      rpcClass: 'public-no-sla',
      estimatedCu: 0,
      note: '无已知单价，只记请求分层，不编造 CU。',
    },
    FREE_KEYED: { configured: keyedConfigured, estimatedCu: null },
    TRACE_ENABLED: { configured: traceConfigured, estimatedCu: null },
  },
  perToken,
  shadowGate: evaluateShadowPromotion(
    {
      completionRate: freeOnlyRate,
      originTraceCompletion: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      rateLimited: 0,
      timeouts: 0,
      coverage: 0,
      sourceConflicts: 0,
      requestCost: 0,
      costPerCompletedCase: 0,
      resultHashDiffs: 0,
      closedCriticalCapability: false,
    },
    {
      completionRate: freeOnlyRate,
      originTraceCompletion: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      rateLimited: 0,
      timeouts: 0,
      coverage: 0,
      sourceConflicts: 0,
      requestCost: 0,
      costPerCompletedCase: 0,
      resultHashDiffs: 0,
      closedCriticalCapability: false,
    },
  ),
};

writeFileSync(
  join(root, 'docs/terminal-market-structure/corpus-run-free-only.json'),
  `${JSON.stringify(document, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify(
    {
      tokens: tokens.length,
      FREE_ONLY: document.modes.FREE_ONLY.completionRate,
      FREE_KEYED: document.modes.FREE_KEYED.status,
      TRACE_ENABLED: document.modes.TRACE_ENABLED.status,
      tracePending: tracePending.length,
    },
    null,
    2,
  )}\n`,
);
