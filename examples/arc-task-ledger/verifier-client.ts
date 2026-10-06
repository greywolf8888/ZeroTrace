import { randomUUID } from 'node:crypto';
import type {
  SettlementExpectation,
  SettlementReport,
  ReportBundle,
} from '@zerotrace/arc-task-ledger';
export class VerifierApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(`Arc API ${status}: ${code}`);
  }
}
export class ArcUsdcClient {
  private token = '';
  private csrf = '';
  readonly baseUrl: string;
  constructor(baseUrl: string) {
    const u = new URL(baseUrl);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !['/', '/api', '/api/'].includes(u.pathname) ||
      !(
        u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))
      )
    )
      throw Error('API origin must be HTTPS or loopback HTTP, without credentials');
    this.baseUrl = u.origin + (u.pathname.startsWith('/api') ? '/api' : '');
  }
  async request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
    if (!/^\/v1\/[a-z0-9/_-]+$/i.test(path)) throw Error('Invalid API path');
    const response = await fetch(this.baseUrl + path, {
      method,
      redirect: 'error',
      headers: {
        'x-arc-client': 'zasv-sdk-v1',
        ...(this.token ? { authorization: 'Bearer ' + this.token } : {}),
        ...(method === 'POST'
          ? {
              'content-type': 'application/json',
              'x-zasv-csrf': this.csrf,
              'idempotency-key': key ?? randomUUID(),
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60000),
    });
    const reader = response.body?.getReader();
    if (!reader) throw Error('Missing API response');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 16777216) {
        await reader.cancel();
        throw Error('API response limit reached');
      }
      chunks.push(item.value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok || response.status === 202)
      throw new VerifierApiError(
        response.status,
        typeof data.code === 'string' ? data.code : 'API_FAILED',
        typeof data.requestId === 'string' ? data.requestId : undefined,
      );
    return data as T;
  }
  async session() {
    const s = await this.request<{ sessionToken: string; csrfToken: string }>(
      '/v1/sessions',
      'POST',
      {},
    );
    this.token = s.sessionToken;
    this.csrf = s.csrfToken;
    return { state: 'PRIVATE_SESSION_READY' };
  }
  async verify(transaction: string, expectation?: SettlementExpectation, key = randomUUID()) {
    if (!this.token) await this.session();
    return this.request<{ report: SettlementReport; requestId: string }>(
      '/v1/verifications',
      'POST',
      { transaction, ...(expectation ? { expectation } : {}) },
      key,
    );
  }
  report(id: string) {
    return this.request<{ report: SettlementReport }>('/v1/reports/' + id);
  }
  status(id: string) {
    return this.request<{
      requestId: string;
      status: 'RUNNING' | 'COMPLETED' | 'FAILED';
      errorCode: string | null;
      result: { report: SettlementReport } | null;
    }>('/v1/verifications/' + id);
  }
  bundle(id: string) {
    return this.request<ReportBundle>('/v1/reports/' + id + '/bundle');
  }
  recheck(id: string, key = randomUUID()) {
    return this.request<{ report: SettlementReport }>(
      '/v1/reports/' + id + '/recheck',
      'POST',
      {},
      key,
    );
  }
  preview(id: string) {
    return this.request<{ report: SettlementReport; bundleHash: string }>(
      '/v1/reports/' + id + '/share-preview',
      'POST',
      {},
    );
  }
  publish(
    id: string,
    preview: { report: SettlementReport; bundleHash: string },
    key = randomUUID(),
  ) {
    return this.request<{ reportId: string; path: string }>(
      '/v1/reports/' + id + '/publish',
      'POST',
      { confirmReportId: preview.report.reportId, confirmBundleHash: preview.bundleHash },
      key,
    );
  }
}
