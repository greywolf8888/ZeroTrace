/** ArcBounty 最小只读接入样例。此文件不操作钱包，也不宣称上游已采用。 */
import type { SettlementResult } from '../../packages/arc-task-ledger/src/result.js';
interface LedgerResponse {
  job: { jobId: string };
  snapshotRunId: string;
  result: SettlementResult;
}
export async function fetchLedgerJob(
  baseUrl: string,
  chainId: string,
  adapter: string,
  jobId: string,
  fallback?: () => Promise<unknown>,
) {
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/v1/jobs/${encodeURIComponent(chainId)}/${encodeURIComponent(adapter)}/${encodeURIComponent(jobId)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw new Error('证据服务暂不可用');
    const job = (await response.json()) as LedgerResponse;
    if (
      job.result?.schemaVersion !== 'atl-settlement-result-v2' ||
      !Array.isArray(job.result.metrics) ||
      job.job?.jobId !== jobId ||
      typeof job.snapshotRunId !== 'string'
    )
      throw new Error('结算结果契约不符');
    const degraded =
      job.result.state !== 'confirmed' ||
      !job.result.historyComplete ||
      job.result.reasons.length > 0;
    return {
      datasource: 'arc-task-ledger',
      degraded,
      status: degraded ? 'EVIDENCE_INCOMPLETE' : 'VERIFIED_RESULT',
      job,
      result: job.result,
    };
  } catch {
    return {
      datasource: fallback ? 'upstream-read-only' : 'unavailable',
      degraded: true,
      status: 'API_UNAVAILABLE',
      job: fallback ? await fallback() : undefined,
      message: '回退数据只表示原始合约状态，不代表任务资金已到账。',
    };
  }
}
