import { Pool } from 'pg';

import { ReportEnvelopeSchema, type ReportEnvelope } from '@zerotrace/schemas';

export interface ForensicReportRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

export class ForensicReportStorageError extends Error {
  readonly code:
    'FORENSIC_REPORT_INVALID' | 'FORENSIC_REPORT_CONFLICT' | 'FORENSIC_REPORT_UNAVAILABLE';
  readonly retryable: boolean;
  constructor(
    code: ForensicReportStorageError['code'],
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ForensicReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export class PostgresForensicReportRepository {
  readonly #pool: Pool;

  constructor(options: ForensicReportRepositoryOptions) {
    this.#pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
      statement_timeout: options.statementTimeoutMs ?? 15_000,
      application_name: 'zerotrace-forensic-reports',
    });
  }

  async put(envelope: ReportEnvelope): Promise<ReportEnvelope> {
    const parsed = ReportEnvelopeSchema.parse(envelope);
    try {
      await this.#pool.query(
        `INSERT INTO forensic_reports (
           id, report_type, schema_version, model_version, policy_version, ledger, chain_id,
           subject_type, subject_id, snapshot, status, payload, coverage, evidence_closure,
           source_set, result_hash, supersedes
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17
         )`,
        [
          parsed.id,
          parsed.reportType,
          parsed.schemaContractVersion,
          parsed.modelVersion,
          parsed.policyVersion,
          parsed.subject.ledger,
          parsed.subject.chainId,
          parsed.subject.subjectType,
          parsed.subject.identifier,
          JSON.stringify(parsed.snapshot),
          parsed.status,
          JSON.stringify(parsed),
          JSON.stringify(parsed.coverage),
          [...parsed.evidenceClosure],
          [...parsed.sourceSet],
          parsed.resultHash,
          parsed.supersedes ?? null,
        ],
      );
      return parsed;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        throw new ForensicReportStorageError(
          'FORENSIC_REPORT_CONFLICT',
          `Forensic report ${parsed.id} already exists.`,
          { cause: error },
        );
      }
      throw new ForensicReportStorageError(
        'FORENSIC_REPORT_UNAVAILABLE',
        'Failed to persist forensic report.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(
    reportType: string,
    chainId: string,
    subjectId: string,
  ): Promise<ReportEnvelope | undefined> {
    const result = await this.#pool.query(
      `SELECT payload FROM forensic_reports
       WHERE report_type = $1 AND chain_id = $2 AND subject_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [reportType, chainId, subjectId],
    );
    const payload = result.rows[0]?.payload;
    return payload === undefined ? undefined : ReportEnvelopeSchema.parse(payload);
  }

  async get(id: string): Promise<ReportEnvelope | undefined> {
    const result = await this.#pool.query(`SELECT payload FROM forensic_reports WHERE id = $1`, [
      id,
    ]);
    const payload = result.rows[0]?.payload;
    return payload === undefined ? undefined : ReportEnvelopeSchema.parse(payload);
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
  }> {
    try {
      await this.#pool.query('SELECT 1');
      return {
        status: 'UP',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
