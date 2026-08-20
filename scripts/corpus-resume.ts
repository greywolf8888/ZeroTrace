import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureTokenMarket } from '@zerotrace/token-market-capture';
import {
  readCorpusCheckpoint,
  resumeTokens,
  writeCorpusCheckpoint,
  type CorpusTokenMetrics,
} from '@zerotrace/storage-plane';

import { loadConfig } from '../apps/api/src/config.js';
import { createStoragePlane } from '../apps/api/src/storage-plane-bind.js';
import { createTokenCaptureRuntime } from '../apps/api/src/token-capture-runtime.js';
import { loadWorkspaceEnv } from '../apps/api/src/workspace-env.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
loadWorkspaceEnv(root);

const corpus = JSON.parse(
  readFileSync(join(root, 'docs/terminal-market-structure/token-corpus.json'), 'utf8'),
) as { tokens: Array<{ token: string; creationTx?: string }> };

const config = loadConfig(process.env);
const plane = createStoragePlane(config);
const runtime = createTokenCaptureRuntime(config, { storagePlane: plane });
if (runtime === undefined) throw new Error('public operator quorum unavailable');

const previous = await readCorpusCheckpoint(plane.metadata);
const remainingAll = resumeTokens(
  corpus.tokens.map((item) => item.token),
  previous,
);
const maxTokens = Number.parseInt(process.env.CORPUS_MAX_TOKENS ?? '', 10);
const remaining =
  Number.isFinite(maxTokens) && maxTokens > 0 ? remainingAll.slice(0, maxTokens) : remainingAll;
const completed = previous?.completed ?? [];
const metrics: CorpusTokenMetrics[] = [...(previous?.metrics ?? [])];
let stop = false;
process.on('SIGINT', () => {
  stop = true;
});

for (const token of remaining) {
  if (stop) break;
  const started = Date.now();
  const known = corpus.tokens.find((item) => item.token.toLowerCase() === token.toLowerCase());
  const report = await captureTokenMarket(runtime, {
    chainId: 'eip155:56',
    token,
    ...(known?.creationTx === undefined ? {} : { creationTx: known.creationTx }),
    logBudgetChunks: 1,
    chunkBlocks: 2_000n,
    stopAfter: 'LIFETIME_HISTORY',
  });
  metrics.push({
    token,
    eventCount: report.history.logCount,
    rawBytes: report.artifacts.length * 256,
    parquetBytes: await plane.facts.byteSize(),
    evidenceBytes: await plane.artifacts.byteSize('PERMANENT_EVIDENCE'),
    traceBytes: 0,
    rpcCalls: report.rpcStats.current + report.rpcStats.historical,
    historicalRpcCalls: report.rpcStats.historical,
    traceCalls: report.rpcStats.trace,
    durationMs: Date.now() - started,
    coverage: report.history.status,
    originStatus: report.origin.status,
    resultHash: report.origin.createdBlock ?? '',
    updatedAt: new Date().toISOString(),
  });
  completed.push(token);
  await writeCorpusCheckpoint(plane.metadata, {
    index: completed.length,
    completed,
    metrics,
    updatedAt: new Date().toISOString(),
  });
}

const document = {
  schemaVersion: 'zerotrace-corpus-resume-v1',
  capturedAt: new Date().toISOString(),
  total: corpus.tokens.length,
  completed: completed.length,
  remaining: corpus.tokens.length - completed.length,
  interrupted: stop,
  originComplete: metrics.filter((item) => item.originStatus === 'COMPLETE').length,
  historyComplete: metrics.filter((item) => item.coverage === 'COMPLETE').length,
  reviewed: false,
  note: '串行、可中断。失败后从 Checkpoint 继续，不得从头重跑。reviewed=false。',
};

writeFileSync(
  join(root, 'docs/terminal-market-structure/corpus-resume.json'),
  `${JSON.stringify(document, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
