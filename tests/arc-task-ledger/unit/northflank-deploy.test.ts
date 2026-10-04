import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import {
  NorthflankClient,
  DeploymentError,
  plan,
  apply,
} from '../../../scripts/northflank-deploy.mjs';

const testToken = 'nf-test-only-no-credential';
const reply = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });

describe('Northflank 费用、凭据与有界请求门禁', () => {
  it('apply 重新读取账户，只探测源码，不创建计费资源', async () => {
    const transport = vi.fn().mockImplementation(async (url: string) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/v1/auth')
        return reply({ data: { tokenKind: 'api', entityType: 'team', entityId: 'test-team' } });
      if (endpoint === '/v1/plans')
        return reply({ data: { plans: [{ id: 'test-zero-catalog', amountPerMonth: 0 }] } });
      if (endpoint === '/v1/regions') return reply({ data: { regions: [] } });
      if (endpoint === '/v1/projects')
        return reply({ data: { projects: [] }, pagination: { hasNextPage: false } });
      if (endpoint === '/v1/integrations/vcs') return reply({ data: { vcsAccountLinks: [] } });
      if (endpoint === '/v1/integrations/vcs/repo-access')
        return reply({ data: { accessible: true, publicRepo: true } });
      if (endpoint === '/v1/billing/usage')
        return reply({ data: { granularity: 'total', usage: [{ currency: 'usd', total: 0 }] } });
      throw new Error('测试拒绝非预检请求');
    });
    const result = await apply(new NorthflankClient(testToken, { transport }));
    expect(result.status).toBe('FREE_TIER_UNVERIFIED');
    expect(result.writesPerformed).toBe(0);
    expect(
      transport.mock.calls
        .filter(([, options]) => options.method !== 'GET')
        .map(([url]) => new URL(url).pathname),
    ).toEqual(['/v1/integrations/vcs/repo-access']);
  });
  it('只把认证发送到官方 HTTPS 地址并禁止重定向', async () => {
    const transport = vi.fn().mockResolvedValue(reply({ data: {} }));
    const client = new NorthflankClient(testToken, { transport });
    await client.request('/v1/auth');
    expect(transport.mock.calls[0][0]).toBe('https://api.northflank.com/v1/auth');
    expect(transport.mock.calls[0][1].redirect).toBe('error');
    expect(transport.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${testToken}`);
    for (const endpoint of ['https://evil.test', '//evil.test/v1/auth', '/v1/../auth'])
      await expect(client.request(endpoint)).rejects.toMatchObject({ code: 'INVALID_ENDPOINT' });
    expect(JSON.stringify(client.records)).not.toContain(testToken);
  });

  it.each([
    [401, 'AUTH_REQUIRED'],
    [403, 'PERMISSION_DENIED'],
  ])('分类 HTTP %s 且不泄露正文中的凭据', async (status, code) => {
    const transport = vi
      .fn()
      .mockResolvedValue(reply({ error: { message: testToken } }, status as number));
    const client = new NorthflankClient(testToken, { transport });
    await expect(client.request('/v1/auth')).rejects.toMatchObject({ code, status });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(client.records)).not.toContain(testToken);
  });

  it('GET 429 遵守 Retry-After，最多两次重试', async () => {
    const transport = vi
      .fn()
      .mockImplementation(async () => reply({ error: {} }, 429, { 'Retry-After': '2' }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new NorthflankClient(testToken, { transport, sleep });
    await expect(client.request('/v1/plans')).rejects.toMatchObject({ status: 429 });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[2000], [2000]]);
  });

  it('超出等待预算时停止，不提前重试', async () => {
    const transport = vi.fn().mockResolvedValue(reply({ error: {} }, 429, { 'Retry-After': '60' }));
    const client = new NorthflankClient(testToken, { transport });
    await expect(client.request('/v1/plans')).rejects.toMatchObject({
      code: 'RETRY_WINDOW_EXCEEDED',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('写入超时不自动重复，需读取核对结果', async () => {
    const transport = vi.fn().mockRejectedValue(new Error(testToken));
    const client = new NorthflankClient(testToken, { transport });
    await expect(
      client.request('/v1/projects', { method: 'POST', body: {} }),
    ).rejects.toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(client.records)).not.toContain(testToken);
  });

  it('拒绝过大和结构错误响应', async () => {
    const client = new NorthflankClient(testToken, {
      maxBytes: 10,
      transport: vi.fn().mockResolvedValue(reply({ data: 'x'.repeat(20) })),
    });
    await expect(client.request('/v1/auth')).rejects.toMatchObject({ code: 'RESPONSE_SIZE_LIMIT' });
    const bad = new NorthflankClient(testToken, {
      transport: vi.fn().mockResolvedValue(new Response('<html>')),
    });
    await expect(bad.request('/v1/auth')).rejects.toBeInstanceOf(DeploymentError);
  });

  it('实际分页不能只读取第一页，游标必须变化', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          data: { projects: [{ id: 'one' }] },
          pagination: { hasNextPage: true, cursor: 'next' },
        }),
      )
      .mockResolvedValueOnce(
        reply({ data: { projects: [{ id: 'two' }] }, pagination: { hasNextPage: false } }),
      );
    const client = new NorthflankClient(testToken, { transport });
    expect(await client.list('/v1/projects', 'projects')).toEqual([{ id: 'one' }, { id: 'two' }]);
    expect(transport.mock.calls[1][0]).toContain('cursor=next');
    const cycle = new NorthflankClient(testToken, {
      transport: vi
        .fn()
        .mockImplementation(async () =>
          reply({ data: { projects: [] }, pagination: { hasNextPage: true, cursor: 'same' } }),
        ),
    });
    await expect(cycle.list('/v1/projects', 'projects')).rejects.toMatchObject({
      code: 'PAGINATION_CYCLE',
    });
  });

  it('目录标价与零历史账单不能代替免费资格', () => {
    const result = plan({
      freeTier: { status: 'FREE_TIER_UNVERIFIED' },
      vcs: { accessible: false },
      catalog: [{ amountPerMonth: 0 }],
      recentBilling: { total: 0 },
    });
    expect(result.status).toBe('FREE_TIER_UNVERIFIED');
    expect(result.blockers).toContain('SOURCE_ACCESS_REQUIRED');
    expect(result.selectedBillingPlans).toBeNull();
    expect(result.publicUrl).toBeNull();
  });

  it('构建上下文排除私有凭据，Nginx 仅替换指定变量', () => {
    const ignore = fs.readFileSync('.dockerignore', 'utf8');
    expect(ignore.split(/\r?\n/)).toContain('.agent-state');
    expect(ignore.split(/\r?\n/)).toContain('dist-public');
    const script = fs.readFileSync('infra/northflank/web-entrypoint.sh', 'utf8');
    expect(script).toContain("envsubst '${ARC_INTERNAL_API_HOST} ${ARC_INTERNAL_API_PORT}'");
    const template = fs.readFileSync('infra/northflank/nginx.conf.template', 'utf8');
    expect(template).toContain('try_files $uri $uri/ /index.html');
    expect(template).toContain('proxy_set_header Host $host');
    expect(template).not.toContain('http://api:8087');
  });
});
