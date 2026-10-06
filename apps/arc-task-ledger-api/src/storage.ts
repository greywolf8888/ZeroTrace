import { hashPayload } from '@zerotrace/evidence';
import { Pool, type PoolClient } from 'pg';
import {
  LedgerError,
  decimal,
  type Receipt,
  type SnapshotRun,
  type StoredEvidence,
  type LedgerRepository,
  type JobDetail,
  type JobRow,
  type SegmentInput,
  RULE_VERSION,
  DEPLOYMENT,
  type EvidenceRequest,
  planEvidence,
  conclusionDigest,
  taskReceiptEvidence,
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
ALTER TABLE arc_task_ledger_v1.jobs ADD COLUMN IF NOT EXISTS list_projection jsonb;
ALTER TABLE arc_task_ledger_v1.jobs ADD COLUMN IF NOT EXISTS evidence_ids jsonb;
UPDATE arc_task_ledger_v1.jobs SET list_projection=document->'job', evidence_ids=COALESCE((SELECT jsonb_agg(e->'id') FROM jsonb_array_elements(document->'evidence') e), '[]'::jsonb) WHERE list_projection IS NULL;
ALTER TABLE arc_task_ledger_v1.jobs ALTER COLUMN list_projection SET NOT NULL;
ALTER TABLE arc_task_ledger_v1.jobs ALTER COLUMN evidence_ids SET NOT NULL;
CREATE INDEX IF NOT EXISTS atl_list_lifecycle ON arc_task_ledger_v1.jobs(run_id,(list_projection->>'lifecycle'),job_id);
CREATE INDEX IF NOT EXISTS atl_list_cash ON arc_task_ledger_v1.jobs(run_id,(list_projection->>'cashState'),job_id);
CREATE INDEX IF NOT EXISTS atl_list_poster ON arc_task_ledger_v1.jobs(run_id,(list_projection->>'poster'),job_id);
CREATE INDEX IF NOT EXISTS atl_list_worker ON arc_task_ledger_v1.jobs(run_id,(list_projection->'worker'->>'value'),job_id);
INSERT INTO arc_task_ledger_v1.migrations(version) VALUES(3) ON CONFLICT DO NOTHING;
ALTER TABLE arc_task_ledger_v1.runs ADD COLUMN IF NOT EXISTS history_range jsonb;
INSERT INTO arc_task_ledger_v1.migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS arc_task_ledger_v1.evidence_requests(
id text PRIMARY KEY, job_id numeric(78,0) NOT NULL, run_id text NOT NULL REFERENCES arc_task_ledger_v1.runs(id),
first_block numeric(78,0) NOT NULL,last_block numeric(78,0) NOT NULL,head numeric(78,0) NOT NULL,
status text NOT NULL CHECK(status IN ('PENDING','COMPLETED','FAILED')),rule_version text NOT NULL,
error_code text,requested_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
DROP INDEX IF EXISTS arc_task_ledger_v1.atl_request_active;
CREATE UNIQUE INDEX IF NOT EXISTS atl_request_active_v5 ON arc_task_ledger_v1.evidence_requests(job_id,rule_version) WHERE status='PENDING';
ALTER TABLE arc_task_ledger_v1.runs ADD COLUMN IF NOT EXISTS collection jsonb;
INSERT INTO arc_task_ledger_v1.migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
ALTER TABLE arc_task_ledger_v1.evidence_requests ADD COLUMN IF NOT EXISTS plan jsonb;
ALTER TABLE arc_task_ledger_v1.evidence_requests ADD COLUMN IF NOT EXISTS outcome jsonb;
INSERT INTO arc_task_ledger_v1.migrations(version) VALUES(6) ON CONFLICT DO NOTHING;
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
        'SELECT version FROM arc_task_ledger_v1.migrations WHERE version=6',
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
        'INSERT INTO arc_task_ledger_v1.runs(id,snapshot,coverage,expires_at,expected,errors,history_range,collection) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
        [
          run.id,
          run.snapshot,
          run.coverage,
          run.expiresAt,
          decimal(run.totalExpected),
          JSON.stringify(run.errors),
          run.historyRange ?? null,
          run.collection ?? null,
        ],
      );
      if (inserted.rowCount === 0)
        throw new LedgerError('RUN_CONFLICT', '快照运行编号已存在。', 409);
      for (const detail of run.jobs) {
        for (const evidence of detail.evidence) await this.putEvidence(client, evidence);
        await client.query(
          'INSERT INTO arc_task_ledger_v1.jobs(run_id,job_id,document,list_projection,evidence_ids) VALUES($1,$2,$3,$4,$5)',
          [
            run.id,
            decimal(detail.job.jobId),
            JSON.stringify(detail),
            JSON.stringify(detail.job),
            JSON.stringify(detail.evidence.map((e) => e.id)),
          ],
        );
      }
      // 只有新快照与原件在同一事务内发布后，才报告任务级补证结果。
      const completed = await client.query(
        "SELECT * FROM arc_task_ledger_v1.evidence_requests WHERE status='COMPLETED' AND rule_version=$1 AND plan IS NOT NULL AND outcome->>'state'='PENDING' FOR UPDATE",
        [RULE_VERSION],
      );
      for (const row of completed.rows) {
        const detail = run.jobs.find((d) => d.job.jobId === String(row.job_id));
        if (
          !detail ||
          detail.job.modelVersion !== row.rule_version ||
          detail.job.freshness === 'stale' ||
          BigInt(detail.job.snapshot.blockNumber) < BigInt(row.last_block)
        )
          continue;
        const plan = row.plan as NonNullable<EvidenceRequest['plan']>;
        const fresh = taskReceiptEvidence(detail).filter((e) => {
          const block = (e.raw as { blockNumber?: string } | null)?.blockNumber;
          return (
            typeof block === 'string' &&
            /^(?:0x[\da-fA-F]+|\d+)$/.test(block) &&
            BigInt(block) >= BigInt(row.first_block) &&
            BigInt(block) <= BigInt(row.last_block) &&
            !plan.beforeReceiptHashes.includes(e.payloadHash)
          );
        });
        const outcome: EvidenceRequest['outcome'] = {
          state: fresh.length ? 'NEW_EVIDENCE_FOUND' : 'NO_MATCH_IN_RANGE',
          beforeSnapshot: String(row.run_id),
          afterSnapshot: run.id,
          newEvidenceIds: fresh.map((e) => e.id),
          conclusionChanged: conclusionDigest(detail) !== plan.beforeConclusion,
        };
        await client.query(
          'UPDATE arc_task_ledger_v1.evidence_requests SET outcome=$2,updated_at=now() WHERE id=$1',
          [row.id, JSON.stringify(outcome)],
        );
      }
    });
  }
  async getRun(id?: string): Promise<SnapshotRun | undefined> {
    const metadata = await this.getRunMetadata(id);
    if (!metadata) return undefined;
    // 完整回放仅供 worker/验收使用，HTTP GET 不调用本方法。
    const jobs = await this.pool.query(
      'SELECT document FROM arc_task_ledger_v1.jobs WHERE run_id=$1 ORDER BY job_id',
      [metadata.id],
    );
    return { ...metadata, jobs: jobs.rows.map((r) => r.document) };
  }
  async getRunMetadata(id?: string): Promise<Omit<SnapshotRun, 'jobs'> | undefined> {
    const selected =
      id === undefined
        ? await this.pool.query(
            'SELECT * FROM arc_task_ledger_v1.runs ORDER BY created_at DESC,id DESC LIMIT 1',
          )
        : await this.pool.query('SELECT * FROM arc_task_ledger_v1.runs WHERE id=$1', [id]);
    const row = selected.rows[0];
    if (!row) return undefined;
    return {
      id: row.id as string,
      snapshot: row.snapshot,
      coverage: row.coverage,
      expiresAt: (row.expires_at as Date).toISOString(),
      totalExpected: String(row.expected),
      errors: row.errors,
      mode: 'stored-replay',
      ...(row.history_range ? { historyRange: row.history_range } : {}),
      ...(row.collection ? { collection: row.collection } : {}),
    };
  }
  async getJobPage(
    runId: string,
    limit: number,
    after?: string,
    filter: {
      address?: string | undefined;
      lifecycle?: string | undefined;
      cashState?: string | undefined;
      role?: string | undefined;
    } = {},
  ): Promise<{ job: JobRow; evidenceIds: string[] }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new LedgerError('INVALID_LIMIT', '列表数据库读取上限不合法。', 400);
    const values: (string | number)[] = [runId];
    const clauses = ['run_id=$1'];
    const bind = (value: string | number) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (after !== undefined) clauses.push(`job_id>${bind(decimal(after))}::numeric`);
    if (filter.address) {
      const parameter = bind(filter.address);
      const poster = `list_projection->>'poster'=${parameter}`;
      const worker = `(list_projection->'worker'->>'state'='known' AND list_projection->'worker'->>'value'=${parameter})`;
      clauses.push(
        filter.role === 'poster'
          ? poster
          : filter.role === 'worker'
            ? worker
            : `(${poster} OR ${worker})`,
      );
    }
    if (filter.lifecycle) clauses.push(`list_projection->>'lifecycle'=${bind(filter.lifecycle)}`);
    if (filter.cashState) clauses.push(`list_projection->>'cashState'=${bind(filter.cashState)}`);
    const result = await this.pool.query(
      `SELECT list_projection,evidence_ids FROM arc_task_ledger_v1.jobs WHERE ${clauses.join(' AND ')} ORDER BY job_id LIMIT ${bind(limit + 1)}`,
      values,
    );
    return result.rows.map((row) => ({
      job: row.list_projection as JobRow,
      evidenceIds: row.evidence_ids as string[],
    }));
  }
  async getJobDetail(runId: string, jobId: string): Promise<JobDetail | undefined> {
    const result = await this.pool.query(
      'SELECT document FROM arc_task_ledger_v1.jobs WHERE run_id=$1 AND job_id=$2 LIMIT 1',
      [runId, decimal(jobId)],
    );
    return result.rows[0]?.document as JobDetail | undefined;
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
  async saveSegment(input: SegmentInput): Promise<{ head: string; version: string }> {
    if (BigInt(decimal(input.from)) > BigInt(decimal(input.to)))
      throw new LedgerError('INVALID_RANGE', '区间顺序不合法。', 400);
    return this.transaction(async (client) => {
      const checkpointKey = input.checkpointKey ?? input.deployment;
      const checkpoint = await client.query(
        'SELECT head,version FROM arc_task_ledger_v1.checkpoints WHERE deployment=$1 FOR UPDATE',
        [checkpointKey],
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
      if (input.status === 'conflict' && BigInt(input.from) <= head) head = BigInt(input.from) - 1n;
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
        const end = BigInt(r.rows[0].last_block);
        const interior = await client.query(
          "SELECT min(first_block) AS first_block FROM arc_task_ledger_v1.segments WHERE deployment=$1 AND status='conflict' AND first_block<=$3 AND last_block>=$2",
          [input.deployment, (head + 1n).toString(), end.toString()],
        );
        if (interior.rows[0]?.first_block !== null && interior.rows[0]?.first_block !== undefined) {
          head = BigInt(interior.rows[0].first_block) - 1n;
          break;
        }
        head = end;
      }
      const updated = await client.query(
        'UPDATE arc_task_ledger_v1.checkpoints SET head=$1,version=version+1 WHERE deployment=$2 AND version=$3 RETURNING head,version',
        [head.toString(), checkpointKey, input.expectedVersion],
      );
      if (input.requestUpdate) {
        const u = input.requestUpdate;
        const changed = await client.query(
          "UPDATE arc_task_ledger_v1.evidence_requests SET head=LEAST($2,last_block),status=CASE WHEN $3='FAILED' THEN 'FAILED' WHEN LEAST($2,last_block)>=last_block THEN 'COMPLETED' ELSE 'PENDING' END,outcome=CASE WHEN $3='FAILED' AND outcome IS NOT NULL THEN jsonb_set(outcome,'{state}','\"FAILED\"') ELSE outcome END,error_code=$4,updated_at=now() WHERE id=$1 AND status='PENDING' AND rule_version=$5",
          [u.id, head.toString(), u.status, u.error ?? null, RULE_VERSION],
        );
        if (changed.rowCount !== 1)
          throw new LedgerError(
            'REQUEST_VERSION_CONFLICT',
            '补证请求状态或版本变化，整段回滚。',
            409,
          );
      }
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
  async evidenceRequest(jobId: string): Promise<EvidenceRequest | undefined> {
    const r = await this.pool.query(
      'SELECT * FROM arc_task_ledger_v1.evidence_requests WHERE job_id=$1 ORDER BY requested_at DESC,id DESC LIMIT 1',
      [decimal(jobId)],
    );
    return r.rows[0] ? this.requestRow(r.rows[0]) : undefined;
  }
  private requestRow(r: Record<string, unknown>): EvidenceRequest {
    return {
      id: String(r.id),
      jobId: String(r.job_id),
      from: String(r.first_block),
      to: String(r.last_block),
      head: String(r.head),
      status: String(r.status),
      ruleVersion: String(r.rule_version),
      snapshotRunId: String(r.run_id),
      ...(r.plan ? { plan: r.plan as NonNullable<EvidenceRequest['plan']> } : {}),
      ...(r.outcome ? { outcome: r.outcome as NonNullable<EvidenceRequest['outcome']> } : {}),
    };
  }
  async coveredRanges(): Promise<{ from: string; to: string }[]> {
    const r = await this.pool.query(
      "SELECT first_block,last_block FROM arc_task_ledger_v1.segments WHERE deployment=$1 AND status='complete' ORDER BY first_block,last_block",
      [DEPLOYMENT.adapter],
    );
    return r.rows.map((row) => ({ from: String(row.first_block), to: String(row.last_block) }));
  }
  async enqueueEvidence(
    detail: JobDetail,
    runId: string,
    covered?: { from: string; to: string }[],
  ): Promise<EvidenceRequest> {
    const ranges = covered ?? (await this.coveredRanges());
    return this.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('arc_task_ledger_v1:request-quota'))");
      const active = await c.query(
        "SELECT * FROM arc_task_ledger_v1.evidence_requests WHERE job_id=$1 AND rule_version=$2 AND (status='PENDING' OR run_id=$3) ORDER BY requested_at DESC LIMIT 1",
        [detail.job.jobId, RULE_VERSION, runId],
      );
      if (active.rows[0]) return this.requestRow(active.rows[0]);
      const quota = await c.query(
        "SELECT count(*) FILTER(WHERE status='PENDING') AS active,count(*) FILTER(WHERE job_id=$1 AND requested_at>now()-interval '1 hour') AS recent FROM arc_task_ledger_v1.evidence_requests WHERE rule_version=$2",
        [detail.job.jobId, RULE_VERSION],
      );
      if (Number(quota.rows[0].active) >= 20 || Number(quota.rows[0].recent) >= 1)
        throw new LedgerError(
          'REQUEST_QUOTA',
          '补证队列已满或该任务一小时内已提交；请稍后查询队列状态。',
          429,
        );
      const target = BigInt(detail.job.snapshot.blockNumber);
      const plan = planEvidence(detail, ranges);
      const from = plan.from ? BigInt(plan.from) : target;
      const to = plan.to ? BigInt(plan.to) : target;
      const scannable = plan.from !== undefined;
      const outcome: EvidenceRequest['outcome'] = {
        state: scannable ? 'PENDING' : 'STILL_INSUFFICIENT',
        beforeSnapshot: runId,
        newEvidenceIds: [],
        conclusionChanged: null,
      };
      const id =
        'req_' +
        hashPayload({ jobId: detail.job.jobId, runId, ruleVersion: RULE_VERSION }).slice(0, 32);
      const r = await c.query(
        'INSERT INTO arc_task_ledger_v1.evidence_requests(id,job_id,run_id,first_block,last_block,head,status,rule_version,plan,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
        [
          id,
          detail.job.jobId,
          runId,
          from.toString(),
          to.toString(),
          (scannable ? from - 1n : target).toString(),
          scannable ? 'PENDING' : 'COMPLETED',
          RULE_VERSION,
          JSON.stringify(plan),
          JSON.stringify(outcome),
        ],
      );
      return this.requestRow(r.rows[0]);
    });
  }
  async nextEvidenceRequest(): Promise<EvidenceRequest | undefined> {
    const r = await this.pool.query(
      "SELECT * FROM arc_task_ledger_v1.evidence_requests WHERE status='PENDING' AND rule_version=$1 ORDER BY requested_at,id LIMIT 1",
      [RULE_VERSION],
    );
    return r.rows[0] ? this.requestRow(r.rows[0]) : undefined;
  }
  async capturedBlock(height: string, source: string): Promise<{ hash: string } | undefined> {
    const r = await this.pool.query(
      "SELECT document->'anchor'->>'hash' AS hash FROM arc_task_ledger_v1.segments WHERE deployment=$1 AND first_block=$2 AND last_block=$2 AND status='complete' AND document->>'scope'='selected-block-only' AND document->>'ruleVersion'=$3 AND document->'snapshot'->'sourceSet' ? $4 ORDER BY id LIMIT 1",
      [DEPLOYMENT.adapter, decimal(height), RULE_VERSION, source],
    );
    return r.rows[0] ? { hash: r.rows[0].hash } : undefined;
  }
  async cachedReceipt(
    tx: string,
    source: string,
  ): Promise<{ receipt: Receipt; evidence: StoredEvidence } | undefined> {
    const r = await this.pool.query(
      "SELECT r.document,o.document AS evidence FROM arc_task_ledger_v1.receipts r JOIN arc_task_ledger_v1.observations o ON o.id=r.observation_id WHERE r.tx_hash=$1 AND o.document->'snapshot'->'sourceSet' ? $2 ORDER BY r.observation_id LIMIT 2",
      [tx, source],
    );
    if (!r.rows[0]) return undefined;
    if (r.rows[1] && hashPayload(r.rows[0].document) !== hashPayload(r.rows[1].document))
      throw new LedgerError('RECEIPT_CONFLICT', '缓存回执冲突，停止补证。', 409);
    return { receipt: r.rows[0].document, evidence: r.rows[0].evidence };
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
