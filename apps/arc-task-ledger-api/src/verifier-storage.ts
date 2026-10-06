import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPayload } from '@zerotrace/evidence';
import { LedgerError, type ReportBundle } from '@zerotrace/arc-task-ledger';
import type { LedgerStore } from './storage.js';

export const VERIFIER_MIGRATION = `
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.zasv_requests(
 id text PRIMARY KEY, owner_hash text NOT NULL, idempotency_key text NOT NULL,
 input_hash text NOT NULL, status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
 report_id text, bundle_hash text, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_hash,idempotency_key));
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.zasv_reports(
 report_id text PRIMARY KEY, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.zasv_bundles(
 bundle_hash text PRIMARY KEY, report_id text NOT NULL REFERENCES arc_task_ledger_v1.zasv_reports(report_id),
 document jsonb NOT NULL, bytes integer NOT NULL CHECK(bytes>0), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.zasv_ownership(
 owner_hash text NOT NULL, report_id text NOT NULL REFERENCES arc_task_ledger_v1.zasv_reports(report_id),
 bundle_hash text NOT NULL REFERENCES arc_task_ledger_v1.zasv_bundles(bundle_hash),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_hash,report_id,bundle_hash));
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.zasv_publications(
 report_id text PRIMARY KEY REFERENCES arc_task_ledger_v1.zasv_reports(report_id),
 bundle_hash text NOT NULL REFERENCES arc_task_ledger_v1.zasv_bundles(bundle_hash),
 owner_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION arc_task_ledger_v1.zasv_immutable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'ZASV_IMMUTABLE'; END $$;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['zasv_reports','zasv_bundles','zasv_ownership','zasv_publications'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=n||'_immutable' AND tgrelid=('arc_task_ledger_v1.'||n)::regclass) THEN
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON arc_task_ledger_v1.%I FOR EACH ROW EXECUTE FUNCTION arc_task_ledger_v1.zasv_immutable()',n||'_immutable',n);
 END IF; END LOOP; END $$;
CREATE INDEX IF NOT EXISTS zasv_request_owner_time ON arc_task_ledger_v1.zasv_requests(owner_hash,created_at);
INSERT INTO arc_task_ledger_v1.migrations(version) VALUES(7) ON CONFLICT DO NOTHING;
`;
export function verifierRepository(store: LedgerStore) {
  const lock = (c: PoolClient) =>
    c.query("SELECT pg_advisory_xact_lock(hashtext('zasv:bounded-requests-v1'))");
  return {
    async examples() {
      return (
        await store.pool.query(
          `SELECT p.report_id,r.document->>'transactionHash' AS transaction_hash
        FROM arc_task_ledger_v1.zasv_publications p JOIN arc_task_ledger_v1.zasv_reports r USING(report_id)
        WHERE r.document->'evaluation'->>'outcome'='MATCHED'
        ORDER BY p.created_at DESC,p.report_id LIMIT 3`,
        )
      ).rows.map((row) => ({ reportId: row.report_id, transactionHash: row.transaction_hash }));
    },
    async request(id: string, owner: string) {
      const result = await store.pool.query(
        'SELECT id,status,report_id,bundle_hash,error_code,created_at,updated_at FROM arc_task_ledger_v1.zasv_requests WHERE id=$1 AND owner_hash=$2',
        [id, owner],
      );
      if (!result.rows[0])
        throw new LedgerError('REQUEST_NOT_FOUND', '核验请求不存在或未授权。', 404);
      return result.rows[0];
    },
    async begin(owner: string, key: string, input: unknown) {
      const digest = hashPayload(input);
      return store.transaction(async (c) => {
        await lock(c);
        const old = await c.query(
          'SELECT * FROM arc_task_ledger_v1.zasv_requests WHERE owner_hash=$1 AND idempotency_key=$2',
          [owner, key],
        );
        if (old.rows[0]) {
          const row = old.rows[0];
          if (row.input_hash !== digest)
            throw new LedgerError('IDEMPOTENCY_CONFLICT', '同一个请求键不能对应不同输入。', 409);
          if (row.status === 'RUNNING' && Date.now() - new Date(row.updated_at).getTime() > 60000) {
            // 仅新的显式 POST 可回收崩溃请求；GET 不会启动工作。
            await c.query(
              "UPDATE arc_task_ledger_v1.zasv_requests SET status='FAILED',error_code='INTERRUPTED',updated_at=now() WHERE id=$1",
              [row.id],
            );
            row.status = 'FAILED';
            row.error_code = 'INTERRUPTED';
          }
          return { ...row, fresh: false };
        }
        const counts = await c.query(
          `SELECT count(*) FILTER(WHERE status='RUNNING' AND updated_at>now()-interval '60 seconds') AS active,
          count(*) FILTER(WHERE created_at>now()-interval '24 hours') AS daily,
          count(*) FILTER(WHERE owner_hash=$1 AND created_at>now()-interval '24 hours') AS owner_daily
          FROM arc_task_ledger_v1.zasv_requests`,
          [owner],
        );
        const n = counts.rows[0];
        if (+n.active >= 2 || +n.daily >= 200 || +n.owner_daily >= 30)
          throw new LedgerError('VERIFICATION_QUOTA', '核验并发或每日免费配额已达到上限。', 429);
        const capacity = await c.query(
          'SELECT count(*) AS reports FROM arc_task_ledger_v1.zasv_reports',
        );
        const bytes = await c.query(
          'SELECT COALESCE(sum(bytes),0) AS total FROM arc_task_ledger_v1.zasv_bundles',
        );
        if (+capacity.rows[0].reports >= 1000 || +bytes.rows[0].total >= 134217728)
          throw new LedgerError('REPORT_CAPACITY', '报告存储达到有界容量，已有报告仍可读取。', 429);
        const id = randomUUID();
        await c.query(
          "INSERT INTO arc_task_ledger_v1.zasv_requests(id,owner_hash,idempotency_key,input_hash,status) VALUES($1,$2,$3,$4,'RUNNING')",
          [id, owner, key, digest],
        );
        return { id, status: 'RUNNING', fresh: true };
      });
    },
    async complete(id: string, owner: string, bundle: ReportBundle) {
      await store.transaction(async (c) => {
        await lock(c);
        const row = await c.query(
          "SELECT id FROM arc_task_ledger_v1.zasv_requests WHERE id=$1 AND owner_hash=$2 AND status='RUNNING' FOR UPDATE",
          [id, owner],
        );
        if (!row.rowCount) throw new LedgerError('REQUEST_STATE_CONFLICT', '请求状态已改变。', 409);
        const text = JSON.stringify(bundle);
        const bytes = Buffer.byteLength(text);
        const size = await c.query(
          'SELECT COALESCE(sum(bytes),0) AS total FROM arc_task_ledger_v1.zasv_bundles',
        );
        if (bytes > 16777216 || +size.rows[0].total + bytes > 134217728)
          throw new LedgerError('REPORT_CAPACITY', '原件包超过有界存储容量。', 429);
        const capacity = await c.query(
          'SELECT (SELECT count(*) FROM arc_task_ledger_v1.zasv_reports) AS total, EXISTS(SELECT 1 FROM arc_task_ledger_v1.zasv_reports WHERE report_id=$1) AS existing',
          [bundle.report.reportId],
        );
        if (!capacity.rows[0].existing && +capacity.rows[0].total >= 1000)
          throw new LedgerError(
            'REPORT_CAPACITY',
            '并发保存后报告容量已满，已有报告仍可读取。',
            429,
          );
        await c.query(
          'INSERT INTO arc_task_ledger_v1.zasv_reports(report_id,document) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [bundle.report.reportId, JSON.stringify(bundle.report)],
        );
        const report = await c.query(
          'SELECT document FROM arc_task_ledger_v1.zasv_reports WHERE report_id=$1',
          [bundle.report.reportId],
        );
        if (hashPayload(report.rows[0].document) !== hashPayload(bundle.report))
          throw new LedgerError('REPORT_CONFLICT', '不可覆盖已有报告。', 409);
        await c.query(
          'INSERT INTO arc_task_ledger_v1.zasv_bundles(bundle_hash,report_id,document,bytes) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [bundle.bundleHash, bundle.report.reportId, text, bytes],
        );
        await c.query(
          'INSERT INTO arc_task_ledger_v1.zasv_ownership(owner_hash,report_id,bundle_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [owner, bundle.report.reportId, bundle.bundleHash],
        );
        await c.query(
          "UPDATE arc_task_ledger_v1.zasv_requests SET status='COMPLETED',report_id=$2,bundle_hash=$3,updated_at=now() WHERE id=$1",
          [id, bundle.report.reportId, bundle.bundleHash],
        );
      });
    },
    async fail(id: string, owner: string, code: string) {
      await store.pool.query(
        "UPDATE arc_task_ledger_v1.zasv_requests SET status='FAILED',error_code=$3,updated_at=now() WHERE id=$1 AND owner_hash=$2 AND status='RUNNING'",
        [id, owner, code],
      );
    },
    async get(reportId: string, owner: string | null, bundleHash?: string): Promise<ReportBundle> {
      const r = await store.pool.query(
        `SELECT b.document FROM arc_task_ledger_v1.zasv_bundles b WHERE b.report_id=$1
        AND ($3::text IS NULL OR b.bundle_hash=$3) AND (
          EXISTS(SELECT 1 FROM arc_task_ledger_v1.zasv_ownership o WHERE o.owner_hash=$2 AND o.report_id=b.report_id AND o.bundle_hash=b.bundle_hash)
          OR EXISTS(SELECT 1 FROM arc_task_ledger_v1.zasv_publications p WHERE p.report_id=b.report_id AND p.bundle_hash=b.bundle_hash))
        ORDER BY b.created_at DESC,b.bundle_hash LIMIT 1`,
        [reportId, owner, bundleHash ?? null],
      );
      if (!r.rows[0]) throw new LedgerError('REPORT_NOT_FOUND', '报告不存在或未授权。', 404);
      return r.rows[0].document;
    },
    async owned(reportId: string, owner: string): Promise<ReportBundle> {
      const r = await store.pool.query(
        `SELECT b.document FROM arc_task_ledger_v1.zasv_bundles b JOIN arc_task_ledger_v1.zasv_ownership o USING(report_id,bundle_hash)
        WHERE o.owner_hash=$2 AND b.report_id=$1 ORDER BY b.created_at DESC,b.bundle_hash LIMIT 1`,
        [reportId, owner],
      );
      if (!r.rows[0]) throw new LedgerError('REPORT_NOT_FOUND', '报告不存在或未授权。', 404);
      return r.rows[0].document;
    },
    async publish(reportId: string, owner: string, bundleHash: string) {
      await store.transaction(async (c) => {
        await lock(c);
        const own = await c.query(
          'SELECT 1 FROM arc_task_ledger_v1.zasv_ownership WHERE report_id=$1 AND owner_hash=$2 AND bundle_hash=$3',
          [reportId, owner, bundleHash],
        );
        if (!own.rowCount) throw new LedgerError('REPORT_NOT_FOUND', '报告不存在或未授权。', 404);
        const count = await c.query(
          "SELECT count(*) AS n FROM arc_task_ledger_v1.zasv_publications WHERE owner_hash=$1 AND created_at>now()-interval '24 hours'",
          [owner],
        );
        if (+count.rows[0].n >= 10)
          throw new LedgerError('PUBLICATION_QUOTA', '每日公开分享配额已达到上限。', 429);
        await c.query(
          'INSERT INTO arc_task_ledger_v1.zasv_publications(report_id,bundle_hash,owner_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [reportId, bundleHash, owner],
        );
        const saved = await c.query(
          'SELECT bundle_hash FROM arc_task_ledger_v1.zasv_publications WHERE report_id=$1',
          [reportId],
        );
        if (saved.rows[0].bundle_hash !== bundleHash)
          throw new LedgerError(
            'PUBLICATION_VERSION_CONFLICT',
            '已公开的固定原件版本不可替换。',
            409,
          );
      });
    },
  };
}
