/** ArcBounty 最小只读接入样例。此文件不操作钱包，也不宣称上游已采用。 */
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
    return {
      datasource: 'arc-task-ledger',
      degraded: false,
      job: (await response.json()) as unknown,
    };
  } catch {
    return {
      datasource: fallback ? 'upstream-read-only' : 'unavailable',
      degraded: true,
      job: fallback ? await fallback() : undefined,
      message: '回退数据只表示原始合约状态，不代表任务资金已到账。',
    };
  }
}
