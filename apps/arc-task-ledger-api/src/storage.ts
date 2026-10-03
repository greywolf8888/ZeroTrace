import { hashPayload } from '@zerotrace/evidence';
import { Pool, type PoolClient } from 'pg';
import {
  LedgerError,
  decimal,
  type Receipt,
  type SnapshotRun,
  type StoredEvidence,
  type LedgerRepository,
} from '@zerotrace/arc-task-ledger';

// 与现有 storage 使用同一 pg 连接模式；独立 schema 只保存本组件链上只读投影。
const MIGRATION = `
CREATE SCHEMA IF NOT EXISTS arc_task_ledger_v1;
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.migrations(version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.observations(id text PRIMARY KEY, payload_hash text NOT NULL, document jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.runs(id text PRIMARY KEY, snapshot jsonb NOT NULL, coverage jsonb NOT NULL, expires_at timestamptz NOT NULL, expected numeric(78,0) NOT NULL, errors jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.jobs(run_id text NOT NULL REFERENCES arc_task_ledger_v1.runs(id), job_id numeric(78,0) NOT NULL, document jsonb NOT NULL, PRIMARY KEY(run_id,job_id));
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.receipts(observation_id text PRIMARY KEY REFERENCES arc_task_ledger_v1.observations(id), tx_hash text NOT NULL, block_hash text NOT NULL, block_number numeric(78,0) NOT NULL, document jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.checkpoints(deployment text PRIMARY KEY, head numeric(78,0) NOT NULL, version bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.segments(id text PRIMARY KEY, deployment text NOT NULL, first_block numeric(78,0) NOT NULL,last_block numeric(78,0) NOT NULL, status text NOT NULL CHECK(status IN ('complete','partial','conflict')),document jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS atl_receipt_height ON arc_task_ledger_v1.receipts(block_number);
CREATE INDEX IF NOT EXISTS atl_segment_frontier ON arc_task_ledger_v1.segments(deployment,first_block,status);
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.sync_attempts(id bigserial PRIMARY KEY,observed_at timestamptz NOT NULL DEFAULT now(),success boolean NOT NULL,document jsonb NOT NULL);
INSERT INTO arc_task_ledger_v1.migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
INSERT INTO arc_task_ledger_v1.migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
`;
export class LedgerStore implements LedgerRepository {
  readonly pool: Pool;
  private workerClient: PoolClient | undefined;
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      max: 5,
    });
    this.pool.on('error', () => undefined);
    this.pool.on('connect', (client) => client.on('error', () => undefined));
  }
  async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = this.workerClient ?? (await this.pool.connect());
    const owned = client !== this.workerClient;
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      if (owned) client.release();
    }
  }
  async migrate(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('arc_task_ledger_v1:migrate'))");
      await client.query(MIGRATION);
    });
  }
  async ready(): Promise<boolean> {
    try {
      const r = await this.pool.query(
        'SELECT version FROM arc_task_ledger_v1.migrations WHERE version=2',
      );
      return r.rowCount === 1;
    } catch {
      return false;
    }
  }
  async recordSync(success: boolean, document: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      'INSERT INTO arc_task_ledger_v1.sync_attempts(success,document) VALUES($1,$2)',
      [success, JSON.stringify(document)],
    );
  }
  async lastSync(): Promise<
    { success: boolean; observedAt: string; document: Record<string, unknown> } | undefined
  > {
    const r = await this.pool.query(
      'SELECT success,observed_at,document FROM arc_task_ledger_v1.sync_attempts ORDER BY id DESC LIMIT 1',
    );
    return r.rows[0]
      ? {
          success: r.rows[0].success as boolean,
          observedAt: (r.rows[0].observed_at as Date).toISOString(),
          document: r.rows[0].document,
        }
      : undefined;
  }
  async putEvidence(client: PoolClient, observation: StoredEvidence): Promise<void> {
    if (hashPayload(observation.raw) !== observation.payloadHash)
      throw new LedgerError('EVIDENCE_HASH_MISMATCH', '原始证据摘要不一致。');
    const inserted = await client.query(
      'INSERT INTO arc_task_ledger_v1.observations(id,payload_hash,document) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [observation.id, observation.payloadHash, JSON.stringify(observation)],
    );
    if (inserted.rowCount === 0) {
      const old = await client.query(
        'SELECT document FROM arc_task_ledger_v1.observations WHERE id=$1',
        [observation.id],
      );
      if (hashPayload(old.rows[0]?.document) !== hashPayload(observation))
        throw new LedgerError('EVIDENCE_CONFLICT', '不可覆盖已有原始观察。', 409);
    }
  }
  async publish(run: SnapshotRun, observations: StoredEvidence[]): Promise<void> {
    await this.transaction(async (client) => {
      for (const evidence of observations) await this.putEvidence(client, evidence);
      const inserted = await client.query(
        'INSERT INTO arc_task_ledger_v1.runs(id,snapshot,coverage,expires_at,expected,errors) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [
          run.id,
          run.snapshot,
          run.coverage,
          run.expiresAt,
          decimal(run.totalExpected),
          JSON.stringify(run.errors),
        ],
      );
      if (inserted.rowCount === 0)
        throw new LedgerError('RUN_CONFLICT', '快照运行编号已存在。', 409);
      for (const detail of run.jobs) {
        for (const evidence of detail.evidence) await this.putEvidence(client, evidence);
        await client.query(
          'INSERT INTO arc_task_ledger_v1.jobs(run_id,job_id,document) VALUES($1,$2,$3)',
          [run.id, decimal(detail.job.jobId), JSON.stringify(detail)],
        );
      }
    });
  }
  async getRun(id?: string): Promise<SnapshotRun | undefined> {
    const selected =
      id === undefined
        ? await this.pool.query(
            'SELECT * FROM arc_task_ledger_v1.runs ORDER BY created_at DESC,id DESC LIMIT 1',
          )
        : await this.pool.query('SELECT * FROM arc_task_ledger_v1.runs WHERE id=$1', [id]);
    const row = selected.rows[0];
    if (!row) return undefined;
    const jobs = await this.pool.query(
      'SELECT document FROM arc_task_ledger_v1.jobs WHERE run_id=$1 ORDER BY job_id',
      [row.id],
    );
    return {
      id: row.id as string,
      snapshot: row.snapshot,
      coverage: row.coverage,
      expiresAt: (row.expires_at as Date).toISOString(),
      totalExpected: String(row.expected),
      errors: row.errors,
      jobs: jobs.rows.map((r) => r.document),
      mode: 'stored-replay',
    };
  }
  async checkpoint(
    deployment: string,
    openingHead: string,
  ): Promise<{ head: string; version: string }> {
    await this.pool.query(
      'INSERT INTO arc_task_ledger_v1.checkpoints(deployment,head) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [deployment, openingHead],
    );
    const r = await this.pool.query(
      'SELECT head,version FROM arc_task_ledger_v1.checkpoints WHERE deployment=$1',
      [deployment],
    );
    return { head: String(r.rows[0]!.head), version: String(r.rows[0]!.version) };
  }
  async currentCheckpoint(
    deployment: string,
  ): Promise<{ head: string; version: string } | undefined> {
    const r = await this.pool.query(
      'SELECT head,version FROM arc_task_ledger_v1.checkpoints WHERE deployment=$1',
      [deployment],
    );
    return r.rows[0]
      ? { head: String(r.rows[0].head), version: String(r.rows[0].version) }
      : undefined;
  }
  async saveSegment(input: {
    deployment: string;
    from: string;
    to: string;
    status: 'complete' | 'partial' | 'conflict';
    document: unknown;
    observations: StoredEvidence[];
    receipts: { receipt: Receipt; observationId: string }[];
    expectedVersion: string;
  }): Promise<{ head: string; version: string }> {
    if (BigInt(decimal(input.from)) > BigInt(decimal(input.to)))
      throw new LedgerError('INVALID_RANGE', '区间顺序不合法。', 400);
    return this.transaction(async (client) => {
      const checkpoint = await client.query(
        'SELECT head,version FROM arc_task_ledger_v1.checkpoints WHERE deployment=$1 FOR UPDATE',
        [input.deployment],
      );
      if (String(checkpoint.rows[0]?.version) !== input.expectedVersion)
        throw new LedgerError('CHECKPOINT_CAS_CONFLICT', '采集检查点已被其他进程推进。', 409);
      for (const e of input.observations) await this.putEvidence(client, e);
      for (const { receipt, observationId } of input.receipts)
        await client.query(
          'INSERT INTO arc_task_ledger_v1.receipts(observation_id,tx_hash,block_hash,block_number,document) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [
            observationId,
            receipt.transactionHash,
            receipt.blockHash,
            BigInt(receipt.blockNumber).toString(),
            JSON.stringify(receipt),
          ],
        );
      const id = hashPayload({
        deployment: input.deployment,
        from: input.from,
        to: input.to,
        document: input.document,
      });
      await client.query(
        'INSERT INTO arc_task_ledger_v1.segments(id,deployment,first_block,last_block,status,document) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [id, input.deployment, input.from, input.to, input.status, JSON.stringify(input.document)],
      );
      let head = BigInt(String(checkpoint.rows[0]!.head));
      while (true) {
        const conflict = await client.query(
          "SELECT 1 FROM arc_task_ledger_v1.segments WHERE deployment=$1 AND status='conflict' AND first_block<=$2 AND last_block>=$2 LIMIT 1",
          [input.deployment, (head + 1n).toString()],
        );
        if (conflict.rowCount) break;
        const r = await client.query(
          "SELECT last_block FROM arc_task_ledger_v1.segments WHERE deployment=$1 AND status='complete' AND first_block<=$2 AND last_block>=$2 ORDER BY last_block DESC LIMIT 1",
          [input.deployment, (head + 1n).toString()],
        );
        if (!r.rows[0]) break;
        head = BigInt(r.rows[0].last_block);
      }
      const updated = await client.query(
        'UPDATE arc_task_ledger_v1.checkpoints SET head=$1,version=version+1 WHERE deployment=$2 AND version=$3 RETURNING head,version',
        [head.toString(), input.deployment, input.expectedVersion],
      );
      return { head: String(updated.rows[0]!.head), version: String(updated.rows[0]!.version) };
    });
  }
  async receiptsThrough(
    height: string,
  ): Promise<{ receipt: Receipt; evidenceIds: string[]; evidence: StoredEvidence }[]> {
    const r = await this.pool.query(
      'SELECT r.document,o.document AS evidence FROM arc_task_ledger_v1.receipts r JOIN arc_task_ledger_v1.observations o ON o.id=r.observation_id WHERE block_number<=$1 ORDER BY block_number,tx_hash',
      [decimal(height)],
    );
    const versions = new Map<string, string>();
    const unique = new Map<
      string,
      { receipt: Receipt; evidenceIds: string[]; evidence: StoredEvidence }
    >();
    for (const row of r.rows) {
      const receipt = row.document as Receipt;
      const previous = versions.get(receipt.transactionHash);
      if (previous !== undefined && previous !== hashPayload(receipt))
        throw new LedgerError('RECEIPT_CONFLICT', '交易回执存在冲突观察，冻结资金确认。', 409);
      versions.set(receipt.transactionHash, hashPayload(receipt));
      const evidence = row.evidence as StoredEvidence;
      unique.set(receipt.transactionHash, { receipt, evidenceIds: [evidence.id], evidence });
    }
    return [...unique.values()];
  }
  async withWorkerLock<T>(action: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      const lock = await client.query(
        "SELECT pg_try_advisory_lock(hashtext('arc_task_ledger_v1:worker')) AS acquired",
      );
      if (!lock.rows[0]?.acquired)
        throw new LedgerError('WORKER_LOCKED', '已有采集进程持有数据库租约。', 409);
      this.workerClient = client;
      return await action();
    } finally {
      this.workerClient = undefined;
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext('arc_task_ledger_v1:worker'))");
      } finally {
        client.release();
      }
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
