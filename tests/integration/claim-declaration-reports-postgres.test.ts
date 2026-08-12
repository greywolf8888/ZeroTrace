import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseEvmClaimDeclaration } from '@zerotrace/claim-audit';
import {
  PostgresClaimDeclarationReportRepository,
  PostgresEvidenceRepository,
} from '@zerotrace/storage';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;

postgresDescribe('PostgreSQL durable Claim declaration report integration', () => {
  let evidence: PostgresEvidenceRepository;
  let reports: PostgresClaimDeclarationReportRepository;

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    reports = new PostgresClaimDeclarationReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => Promise.all([evidence.close(), reports.close()]));

  it('persists exact source text, terminal Evidence, restart replay, and immutable rows', async () => {
    const nonce = randomUUID();
    const tokenAddress = nonce.replaceAll('-', '').padEnd(40, '0').slice(0, 40);
    const report = parseEvmClaimDeclaration({
      text: `Tax receiver (100%)\n0x${'1'.repeat(40)}\nCommunity fund (100%)\n0x${'2'.repeat(40)}\nReference ${nonce}`,
      chainId: 'eip155:56',
      assetId: `eip155:56:erc20:0x${tokenAddress}`,
      source: `integration:claim-document:${nonce}`,
      sourceUri: `https://project.example/declarations/${nonce}`,
      observedAt: '2026-08-12T00:10:00.000Z',
      auditWindow: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-12T00:00:00.000Z',
      },
    });

    await expect(reports.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(reports.put(report)).rejects.toMatchObject({
      code: 'CLAIM_DECLARATION_REPORT_CONFLICT',
      retryable: false,
    });

    await evidence.put(report.evidence);
    await evidence.put(report.terminalEvidence, [report.evidence.id]);
    const stored = await reports.put(report);
    await expect(reports.put(report)).resolves.toEqual(stored);
    expect(stored).toMatchObject({
      id: report.id,
      sourceSnapshotId: report.sourceSnapshot.id,
      documentHash: report.documentHash,
      contentHash: report.sourceSnapshot.contentHash,
      report: {
        sourceSnapshot: { content: report.sourceSnapshot.content },
        coverage: { chainVerification: { state: 'unknown', reason: 'NOT_QUERIED' } },
        terminalEvidenceId: report.terminalEvidenceId,
      },
    });

    await reports.close();
    reports = new PostgresClaimDeclarationReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(reports.get(report.id)).resolves.toEqual(stored);
    await expect(reports.latestByAsset(report.assetId)).resolves.toEqual(stored);
    await expect(reports.latestByDocument(report.documentHash, report.assetId)).resolves.toEqual(
      stored,
    );

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE claim_declaration_reports SET report = report WHERE id = $1', [
          report.id,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM claim_declaration_reports WHERE id = $1', [report.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool.end();
    }
  });
});
