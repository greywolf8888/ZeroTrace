// 只导出已发布声明窗口的公开链上证明，绝不复制整个私有状态目录或连接配置。
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LedgerStore } from '../apps/arc-task-ledger-api/src/storage.js';
import { configFromEnv, DEPLOYMENT, LedgerError } from '@zerotrace/arc-task-ledger';
import { hashPayload } from '@zerotrace/evidence';
const runId = process.argv[process.argv.indexOf('--run') + 1];
const target = process.argv[process.argv.indexOf('--out') + 1];
if (
  !process.argv.includes('--run') ||
  !process.argv.includes('--out') ||
  !/^run_[a-f0-9]{32}$/.test(runId ?? '') ||
  !target
)
  throw new LedgerError('CONFIG_INVALID', '必须显式提供已发布 --run 与本地 --out。', 400);
const store = new LedgerStore(configFromEnv().databaseUrl);
try {
  const run = await store.getRunMetadata(runId);
  if (!run?.historyRange) throw new LedgerError('STATE_NOT_AVAILABLE', '此快照未声明历史窗口。');
  const range = run.historyRange;
  const segments = await store.pool.query(
    "SELECT id,first_block::text,last_block::text,status,document FROM arc_task_ledger_v1.segments WHERE deployment=$1 AND first_block>=$2::numeric AND last_block<=$3::numeric AND document->>'scopeFromBlock'=$2::text ORDER BY first_block,last_block,id",
    [DEPLOYMENT.adapter, range.fromBlock, range.targetBlock],
  );
  const ids = [...new Set(segments.rows.flatMap((row) => row.document.evidenceIds ?? []))];
  const observations = await store.pool.query(
    'SELECT document FROM arc_task_ledger_v1.observations WHERE id=ANY($1::text[]) ORDER BY id',
    [ids],
  );
  if (observations.rows.length !== ids.length)
    throw new LedgerError('RAW_ARTIFACT_UNAVAILABLE', '窗口原始证明不完整，拒绝导出。');
  for (const row of observations.rows)
    if (hashPayload(row.document.raw) !== row.document.payloadHash)
      throw new LedgerError('EVIDENCE_HASH_MISMATCH', '窗口原始证明摘要不一致。');
  const report = {
    schemaVersion: 'atl-public-window-evidence-v1',
    snapshotRunId: runId,
    snapshot: run.snapshot,
    historyRange: range,
    coverage: run.coverage,
    segments: segments.rows,
    observations: observations.rows.map((row) => row.document),
    privateStateIncluded: false,
    note: '只含公开链上RPC日志/回执与窗口锚点。单来源，不等于全历史或正式高保证取证。',
  };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(report, null, 2) + '\n');
  console.info(
    `已导出声明窗口公开原始证明：${segments.rows.length}段、${observations.rows.length}项观察。`,
  );
} finally {
  await store.close();
}
