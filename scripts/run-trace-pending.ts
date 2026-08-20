import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureTokenMarket } from '@zerotrace/token-market-capture';

import { loadConfig } from '../apps/api/src/config.js';
import { createTokenCaptureRuntime } from '../apps/api/src/token-capture-runtime.js';
import { loadWorkspaceEnv } from '../apps/api/src/workspace-env.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TRACE_PENDING = [
  {
    id: 'BSC_FLAP_TAX_V6_ORIGIN',
    token: '0xAeCBD0E461047d6B7Cfc82e637AD197097407777',
    creationTx: '0xa56f5e359cae2723f957043b5fd953342440907981d1e751f7182f1a0f8d80b3',
  },
  {
    id: 'BSC_FLAP_TAX_V3_LIFETIME',
    token: '0x13Aa2c5bbfD15B65b15Ef1129fF3dCDDF8c17777',
    creationTx: '0xb7a9c3c6d7168ba5901ca30f6c9711f7ac485add4dbac25e856616befce1faef',
  },
  {
    id: 'BSC_FLAP_NEW_TOKEN_V2',
    token: '0x711770df85F79c4aEbba1f1d8db263110D3D7777',
    creationTx: '0xff42119993f03ea6d5df1d024d4b8e4a53b9f3d21e47abd91c616c1abdb8ff26',
  },
] as const;

loadWorkspaceEnv(root);
const config = loadConfig(process.env);
const runtime = createTokenCaptureRuntime(config);
if (runtime === undefined) {
  throw new Error('public operator quorum unavailable');
}

const perToken = [];
for (const item of TRACE_PENDING) {
  const started = Date.now();
  const report = await captureTokenMarket(runtime, {
    chainId: 'eip155:56',
    token: item.token,
    creationTx: item.creationTx,
    logBudgetChunks: 2,
    chunkBlocks: 2_000n,
  });
  perToken.push({
    id: item.id,
    token: item.token.toLowerCase(),
    origin: report.origin.status,
    history: report.history.status,
    limitationCode: report.origin.limitationCode,
    originLimitation: report.origin.limitation,
    historyLimitation: report.history.limitation,
    createdBlock: report.origin.createdBlock,
    deployer: report.origin.deployer,
    coverageLogs: report.history.logCount,
    artifactCount: report.artifacts.length,
    rawHashesValid: report.rawHashesValid,
    elapsedMs: Date.now() - started,
  });
}

const originComplete = perToken.filter((item) => item.origin === 'COMPLETE').length;
const document = {
  schemaVersion: 'zerotrace-corpus-run-trace-pending-v1',
  capturedAt: new Date().toISOString(),
  reviewed: false,
  traceSlot: config.providerSlotStatus.BSC_TRACE_RPC_URL,
  keyedSlots: {
    NODEREAL_API_KEY: config.providerSlotStatus.NODEREAL_API_KEY,
    ANKR_API_KEY: config.providerSlotStatus.ANKR_API_KEY,
  },
  creationTraceSource: runtime.creationTraceSource !== undefined,
  note: '只对已知创建交易做 Trace。起源 COMPLETE 需要双 Operator 交易/回执/字节码一致，且 traces 匹配 CREATE/CREATE2。不是 G12 PASS。',
  tokenCount: TRACE_PENDING.length,
  originComplete,
  historyComplete: perToken.filter((item) => item.history === 'COMPLETE').length,
  perToken,
};

writeFileSync(
  join(root, 'docs/terminal-market-structure/corpus-run-trace-pending.json'),
  `${JSON.stringify(document, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify(
    {
      tokens: TRACE_PENDING.length,
      originComplete,
      historyComplete: document.historyComplete,
      traceSlot: document.traceSlot,
      creationTraceSource: document.creationTraceSource,
      codes: perToken.map((item) => ({
        id: item.id,
        origin: item.origin,
        limitationCode: item.limitationCode,
      })),
    },
    null,
    2,
  )}\n`,
);
