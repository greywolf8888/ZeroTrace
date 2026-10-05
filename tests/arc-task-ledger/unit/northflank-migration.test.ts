import { describe, expect, it, vi } from 'vitest';
import {
  configureRoles,
  configureRequestRole,
} from '../../../infra/northflank/migration-bootstrap.mjs';

describe('Northflank 专用数据库权限', () => {
  it('补证账号密钥无效或已有管理员权限时拒绝；仅申请表可插入', async () => {
    const invalid = { query: vi.fn() };
    await expect(configureRequestRole(invalid, 'bad')).rejects.toThrow();
    expect(invalid.query).not.toHaveBeenCalled();
    const elevated = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ rolsuper: true }] }),
    };
    await expect(configureRequestRole(elevated, 'a'.repeat(64))).rejects.toThrow();
    const pool = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM pg_roles')) return { rowCount: 1, rows: [{ rolcanlogin: true }] };
        if (sql.includes('current_database')) return { rows: [{ name: 'test_db' }] };
        if (sql.includes('has_table_privilege'))
          return {
            rows: [{ request_insert: true, projection_insert: false, evidence_insert: false }],
          };
        return { rows: [] };
      }),
    };
    expect(await configureRequestRole(pool, 'a'.repeat(64))).toEqual({
      requestInsert: true,
      projectionInsert: false,
      evidenceInsert: false,
    });
    expect(
      pool.query.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => sql.includes('GRANT SELECT,INSERT')),
    ).toEqual([
      'GRANT SELECT,INSERT ON arc_task_ledger_v1.evidence_requests TO atl_evidence_requester',
    ]);
  });
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
