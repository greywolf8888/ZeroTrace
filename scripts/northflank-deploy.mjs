import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const origin = 'https://api.northflank.com';
const targetProject = 'arc-task-ledger';
export class DeploymentError extends Error {
  constructor(code, status = null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// 公开记录只采用字段白名单；响应正文与请求体不进入日志。
export class NorthflankClient {
  #token;
  constructor(token, { transport = fetch, timeoutMs = 20000, maxBytes = 2097152, sleep } = {}) {
    if (typeof token !== 'string' || !/^nf-[A-Za-z0-9._-]+$/.test(token))
      throw new DeploymentError('AUTH_REQUIRED');
    this.#token = token;
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.records = [];
  }

  async request(endpoint, { method = 'GET', body } = {}) {
    if (!/^\/v1\/[A-Za-z0-9/_?=&%.+-]+$/.test(endpoint) || endpoint.includes('..'))
      throw new DeploymentError('INVALID_ENDPOINT');
    if (!['GET', 'POST', 'PATCH', 'PUT'].includes(method))
      throw new DeploymentError('INVALID_METHOD');
    const url = new URL(endpoint, origin);
    if (url.origin !== origin) throw new DeploymentError('INVALID_ENDPOINT');
    const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response;
      let json;
      try {
        response = await this.transport(url.href, {
          method,
          redirect: 'error',
          headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.body || Number(response.headers.get('content-length')) > this.maxBytes)
          throw new DeploymentError('RESPONSE_SIZE_LIMIT');
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > this.maxBytes) throw new DeploymentError('RESPONSE_SIZE_LIMIT');
            chunks.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new DeploymentError('INVALID_JSON', response.status);
        }
        if (!json || typeof json !== 'object' || Array.isArray(json))
          throw new DeploymentError('INVALID_RESPONSE', response.status);
      } catch (error) {
        const code = error instanceof DeploymentError ? error.code : 'NETWORK_FAILURE';
        this.records.push({ method, endpoint: url.pathname, attempt, code });
        if (method !== 'GET') throw new DeploymentError('WRITE_OUTCOME_UNKNOWN');
        if (code !== 'NETWORK_FAILURE' || attempt + 1 === attempts)
          throw new DeploymentError(code, error instanceof DeploymentError ? error.status : null);
        await this.sleep(500 * (attempt + 1));
        continue;
      }
      this.records.push({ method, endpoint: url.pathname, attempt, status: response.status });
      if (response.ok) {
        if (!json.data || typeof json.data !== 'object')
          throw new DeploymentError('INVALID_RESPONSE', response.status);
        return json;
      }
      if (response.status === 401) throw new DeploymentError('AUTH_REQUIRED', 401);
      if (response.status === 403) throw new DeploymentError('PERMISSION_DENIED', 403);
      if (
        method === 'GET' &&
        (response.status === 429 || response.status >= 500) &&
        attempt + 1 < attempts
      ) {
        const retry = response.headers.get('retry-after');
        const delay =
          retry === null
            ? 1000
            : /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : Math.max(0, Date.parse(retry) - Date.now());
        if (!Number.isFinite(delay) || delay > 10000)
          throw new DeploymentError('RETRY_WINDOW_EXCEEDED', response.status);
        await this.sleep(delay);
        continue;
      }
      throw new DeploymentError('HTTP_ERROR', response.status);
    }
    throw new DeploymentError('NETWORK_FAILURE');
  }

  async list(endpoint, key, { pageSizeKey = 'per_page', maxPages = 50 } = {}) {
    const results = [];
    let cursor;
    const seen = new Set();
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(endpoint, origin);
      url.searchParams.set(pageSizeKey, '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      else url.searchParams.set('page', String(page));
      const response = await this.request(url.pathname + url.search);
      const items = response.data[key];
      if (!Array.isArray(items) || typeof response.pagination?.hasNextPage !== 'boolean')
        throw new DeploymentError('INVALID_PAGINATION');
      results.push(...items);
      if (!response.pagination.hasNextPage) return results;
      const next = response.pagination.cursor;
      if (next !== undefined) {
        if (typeof next !== 'string' || !next || seen.has(next))
          throw new DeploymentError('PAGINATION_CYCLE');
        seen.add(next);
        cursor = next;
      } else if (items.length === 0) throw new DeploymentError('INVALID_PAGINATION');
    }
    throw new DeploymentError('PAGINATION_BUDGET_EXCEEDED');
  }
}

export async function discover(client) {
  const { data: auth } = await client.request('/v1/auth');
  if (auth.tokenKind !== 'api' || auth.entityType !== 'team' || typeof auth.entityId !== 'string')
    throw new DeploymentError('UNSUPPORTED_AUTH_SCOPE');
  const { data: catalog } = await client.request('/v1/plans');
  const { data: regionCatalog } = await client.request('/v1/regions');
  if (!Array.isArray(catalog.plans) || !Array.isArray(regionCatalog.regions))
    throw new DeploymentError('INVALID_CATALOG');
  const projects = await client.list('/v1/projects', 'projects');
  const { data: vcs } = await client.request('/v1/integrations/vcs');
  if (!Array.isArray(vcs.vcsAccountLinks)) throw new DeploymentError('INVALID_VCS_RESPONSE');
  const resources = [];
  for (const project of projects) {
    if (typeof project.id !== 'string' || !/^[A-Za-z0-9-]+$/.test(project.id))
      throw new DeploymentError('INVALID_PROJECT');
    for (const [kind, key] of [
      ['services', 'services'],
      ['addons', 'addons'],
      ['jobs', 'jobs'],
    ]) {
      const items = await client.list(`/v1/projects/${project.id}/${kind}`, key);
      for (const item of items)
        resources.push({ projectId: project.id, kind, id: item.id, name: item.name });
    }
  }
  // 此接口为访问探测，POST 不创建工作负载，也不触发构建。
  const { data: source } = await client.request('/v1/integrations/vcs/repo-access', {
    method: 'POST',
    body: {
      projectUrl: 'https://github.com/greywolf8888/ZeroTrace',
      projectType: 'github',
      projectBranch: 'agent/arc-task-ledger-v1',
    },
  });
  if (typeof source.accessible !== 'boolean' || typeof source.publicRepo !== 'boolean')
    throw new DeploymentError('INVALID_SOURCE_RESPONSE');
  const end = Math.floor(Date.now() / 1000);
  const { data: billing } = await client.request(
    `/v1/billing/usage?granularity=total&startTime=${end - 86400}&endTime=${end}`,
  );
  if (billing.granularity !== 'total' || !Array.isArray(billing.usage))
    throw new DeploymentError('INVALID_BILLING_RESPONSE');
  return {
    observedAt: new Date().toISOString(),
    targetProject,
    auth: {
      verified: true,
      entityId: auth.entityId,
      entityType: auth.entityType,
      role: auth.role?.name,
      expiresAt: auth.expiresAt ?? null,
    },
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    resources,
    catalog: catalog.plans.map((p) => ({
      id: p.id,
      currency: p.currency,
      amountPerHour: p.amountPerHour,
      amountPerMonth: p.amountPerMonth,
      cpuResource: p.cpuResource,
      ramResource: p.ramResource,
    })),
    regions: regionCatalog.regions.map((r) => ({ id: r.id, name: r.name })),
    vcs: {
      linkedAccounts: vcs.vcsAccountLinks.length,
      accessible: source.accessible,
      publicRepo: source.publicRepo,
      reason:
        typeof source.reason === 'string' && /^[a-z-]+$/.test(source.reason)
          ? source.reason
          : undefined,
    },
    recentBilling: {
      window: billing.window,
      usage: billing.usage.map((u) => ({ currency: u.currency, total: u.total })),
    },
    // 当前公开 REST schema 不提供团队 Sandbox 资格与剩余额度。
    freeTier: {
      status: 'FREE_TIER_UNVERIFIED',
      accountEntitlement: null,
      remainingQuota: null,
      buildAllowance: null,
      storageAllowance: null,
      trafficAllowance: null,
      manualCronAllowance: null,
    },
    paidBudgetUsd: 0,
    requests: client.records,
  };
}

export function plan(discovery) {
  return {
    status: discovery.freeTier.status,
    blockers: [
      discovery.freeTier.status,
      ...(discovery.vcs.accessible ? [] : ['SOURCE_ACCESS_REQUIRED']),
    ],
    targetProject,
    resourceIntents: [
      { name: 'atl-api', kind: 'service', port: 8087, public: false },
      { name: 'atl-web', kind: 'service', port: 8080, public: true },
      { name: 'atl-postgres', kind: 'addon', public: false },
      { name: 'atl-migrate', kind: 'cron', suspended: true },
      { name: 'atl-sync', kind: 'cron', suspended: true },
    ],
    selectedRegion: null,
    selectedBillingPlans: null,
    publicUrl: null,
  };
}

export async function apply(client) {
  const current = await discover(client);
  const result = plan(current);
  // 不能用价格目录、零历史账单或本地布尔标志绕过真实账户资格核验。
  // 资源创建编排必须在资格和完整 payload 实测后完成；此版本明确停止于预检。
  return {
    ...result,
    discovery: current,
    writesPerformed: 0,
    deploymentImplementation: '待免费资格核验后完成真实资源创建与迁移编排',
  };
}

function loadToken() {
  if (process.env.NORTHFLANK_API_TOKEN) return process.env.NORTHFLANK_API_TOKEN.trim();
  if (process.env.NORTHFLANK_TOKEN_FILE)
    return fs.readFileSync(process.env.NORTHFLANK_TOKEN_FILE, 'utf8').trim();
  throw new DeploymentError('AUTH_REQUIRED');
}

async function main() {
  const mode = process.argv[2] ?? 'discover';
  if (!['discover', 'plan', 'apply', 'status', 'verify'].includes(mode))
    throw new DeploymentError('INVALID_MODE');
  const client = new NorthflankClient(loadToken());
  const discovery = mode === 'apply' ? undefined : await discover(client);
  let result;
  if (mode === 'apply') result = await apply(client);
  else if (mode === 'plan') result = { ...plan(discovery), discovery };
  else if (mode === 'verify')
    result = {
      ...plan(discovery),
      hostedMainnet: '未执行',
      persistence: '未执行',
      restart: '未执行',
      cronTrigger: '未执行',
      discovery,
    };
  else result = discovery;
  result.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const output = process.env.NORTHFLANK_REPORT_FILE;
  if (output) {
    const root = process.cwd();
    const resolved = path.resolve(output);
    if (!resolved.startsWith(path.join(root, '.agent-state') + path.sep))
      throw new DeploymentError('INVALID_PRIVATE_REPORT_PATH');
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(
    JSON.stringify({
      mode,
      status: result.status ?? result.freeTier?.status,
      observedAt: discovery?.observedAt ?? result.discovery?.observedAt,
      publicUrl: result.publicUrl ?? null,
      writesPerformed: 0,
    }),
  );
  if (mode === 'apply' || mode === 'verify') process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(
      JSON.stringify({
        status: error instanceof DeploymentError ? error.code : 'FAIL_LOCAL',
        httpStatus: error instanceof DeploymentError ? error.status : null,
      }),
    );
    process.exitCode = 1;
  });
