import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = 'arc_task_ledger_v1';
const identifier = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))
    throw new Error('数据库角色名称不合法。');
  return `"${value}"`;
};

export async function configureRoles(pool, { workerRole, readerRole, readerPassword }) {
  if (readerRole !== 'atl_api_reader' || workerRole === readerRole)
    throw new Error('数据库角色边界不合法。');
  const worker = identifier(workerRole);
  const reader = identifier(readerRole);
  if (!/^[a-f0-9]{64}$/.test(readerPassword)) throw new Error('只读账号密钥格式不合法。');
  const existing = await pool.query(
    'SELECT rolsuper,rolcreatedb,rolcreaterole,rolcanlogin FROM pg_roles WHERE rolname=$1',
    [readerRole],
  );
  if (existing.rowCount === 0)
    await pool.query(
      `CREATE ROLE ${reader} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${readerPassword}'`,
    );
  else if (
    existing.rows[0].rolsuper ||
    existing.rows[0].rolcreatedb ||
    existing.rows[0].rolcreaterole ||
    !existing.rows[0].rolcanlogin
  )
    throw new Error('已有只读角色权限不符合托管边界。');
  const database = await pool.query('SELECT current_database() AS name');
  await pool.query(`GRANT CONNECT ON DATABASE ${identifier(database.rows[0].name)} TO ${reader}`);
  await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${worker},${reader}`);
  await pool.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${worker}`,
  );
  await pool.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${worker}`);
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${reader}`);
  await pool.query(`ALTER ROLE ${reader} SET default_transaction_read_only=on`);
  const permission = await pool.query(
    `SELECT
    has_table_privilege($1,'${schema}.migrations','SELECT') AS reader_select,
    has_table_privilege($1,'${schema}.migrations','INSERT') AS reader_insert,
    has_table_privilege($2,'${schema}.sync_attempts','INSERT') AS worker_insert`,
    [readerRole, workerRole],
  );
  if (
    !permission.rows[0].reader_select ||
    permission.rows[0].reader_insert ||
    !permission.rows[0].worker_insert
  )
    throw new Error('托管数据库权限实际核验失败。');
  return { readerSelect: true, readerInsert: false, workerInsert: true };
}

export async function configureRequestRole(pool, password) {
  if (!/^[a-f0-9]{64}$/.test(password ?? '')) throw new Error('补证请求账号密钥格式不合法。');
  const role = 'atl_evidence_requester';
  const existing = await pool.query(
    'SELECT rolsuper,rolcreatedb,rolcreaterole,rolcanlogin FROM pg_roles WHERE rolname=$1',
    [role],
  );
  if (existing.rowCount === 0)
    await pool.query(
      `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
    );
  else if (
    existing.rows[0].rolsuper ||
    existing.rows[0].rolcreatedb ||
    existing.rows[0].rolcreaterole ||
    !existing.rows[0].rolcanlogin
  )
    throw new Error('补证角色不符合权限边界。');
  const db = await pool.query('SELECT current_database() AS name');
  await pool.query(`GRANT CONNECT ON DATABASE ${identifier(db.rows[0].name)} TO ${role}`);
  await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await pool.query(`GRANT SELECT,INSERT ON ${schema}.evidence_requests TO ${role}`);
  const checked = await pool.query(
    `SELECT has_table_privilege($1,'${schema}.evidence_requests','INSERT') AS request_insert,has_table_privilege($1,'${schema}.jobs','INSERT') AS projection_insert,has_table_privilege($1,'${schema}.observations','INSERT') AS evidence_insert`,
    [role],
  );
  if (
    !checked.rows[0].request_insert ||
    checked.rows[0].projection_insert ||
    checked.rows[0].evidence_insert
  )
    throw new Error('补证账号实际权限失败。');
  return { requestInsert: true, projectionInsert: false, evidenceInsert: false };
}

async function main() {
  const { LedgerStore } = await import('../../apps/arc-task-ledger-api/dist/storage.js');
  const store = new LedgerStore(process.env.ARC_DATABASE_URL);
  try {
    await store.migrate();
    const permissions = await configureRoles(store.pool, {
      workerRole: process.env.ARC_WORKER_DB_ROLE,
      readerRole: process.env.ARC_READER_DB_ROLE,
      readerPassword: process.env.ARC_READER_DB_PASSWORD,
    });
    const requestPermissions = process.env.ARC_REQUEST_DB_PASSWORD
      ? await configureRequestRole(store.pool, process.env.ARC_REQUEST_DB_PASSWORD)
      : null;
    if (!(await store.ready())) throw new Error('专用数据库迁移版本未达到 5。');
    console.info(
      JSON.stringify({
        status: 'MIGRATION_VALIDATED',
        migrationVersion: 5,
        permissions,
        requestPermissions,
      }),
    );
  } finally {
    await store.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error('托管迁移或数据库权限核验失败，后续采集保持停止。');
    process.exitCode = 1;
  });
