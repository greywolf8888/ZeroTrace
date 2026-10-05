import { describe, expect, it, vi } from 'vitest';
import { configureRoles } from '../../../infra/northflank/migration-bootstrap.mjs';

describe('Northflank 专用数据库权限', () => {
  it('角色与密钥异常时不执行 SQL', async () => {
    const pool = { query: vi.fn() };
    for (const workerRole of ['a"; DROP SCHEMA x', 'atl_api_reader'])
      await expect(
        configureRoles(pool, {
          workerRole,
          readerRole: 'atl_api_reader',
          readerPassword: 'a'.repeat(64),
        }),
      ).rejects.toThrow();
    await expect(
      configureRoles(pool, {
        workerRole: 'worker',
        readerRole: 'other',
        readerPassword: 'a'.repeat(64),
      }),
    ).rejects.toThrow();
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('拒绝复用具有管理员权限的同名角色', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValue({ rowCount: 1, rows: [{ rolsuper: true, rolcanlogin: true }] }),
    };
    await expect(
      configureRoles(pool, {
        workerRole: 'worker',
        readerRole: 'atl_api_reader',
        readerPassword: 'a'.repeat(64),
      }),
    ).rejects.toThrow();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
  it('实际权限读数显示只读角色可写时失败', async () => {
    const pool = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM pg_roles')) return { rowCount: 1, rows: [{ rolcanlogin: true }] };
        if (sql.includes('current_database')) return { rows: [{ name: 'test_db' }] };
        if (sql.includes('has_table_privilege'))
          return { rows: [{ reader_select: true, reader_insert: true, worker_insert: true }] };
        return { rows: [] };
      }),
    };
    await expect(
      configureRoles(pool, {
        workerRole: 'worker',
        readerRole: 'atl_api_reader',
        readerPassword: 'a'.repeat(64),
      }),
    ).rejects.toThrow();
    expect(pool.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(
      /GRANT ALL|ALTER SYSTEM|DROP /,
    );
  });
});
