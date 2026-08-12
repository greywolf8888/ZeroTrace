import { describe, expect, it } from 'vitest';

import { parseEvmClaimDeclaration } from '@zerotrace/claim-audit';

import {
  ClaimDeclarationReportStorageError,
  PostgresClaimDeclarationReportRepository,
} from './claim-declaration-reports.js';

function report() {
  return parseEvmClaimDeclaration({
    text: `Tax receiver (100%)\n0x${'1'.repeat(40)}\nCommunity fund (100%)\n0x${'2'.repeat(40)}`,
    chainId: 'eip155:56',
    assetId: `eip155:56:erc20:0x${'a'.repeat(40)}`,
    source: 'https://project.example/announcement/1',
    sourceUri: 'https://project.example/announcement/1',
    observedAt: '2026-08-12T00:00:00.000Z',
    auditWindow: {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-12T00:00:00.000Z',
    },
  });
}

function pool() {
  let row: Record<string, unknown> | undefined;
  return {
    set row(value: Record<string, unknown> | undefined) {
      row = value;
    },
    get row() {
      return row;
    },
    async query(text: string, values: readonly unknown[] = []) {
      if (text.includes('INSERT INTO claim_declaration_reports')) {
        row = {
          id: values[0],
          source_snapshot_id: values[1],
          document_hash: values[2],
          content_hash: values[3],
          ledger: values[4],
          chain_id: values[5],
          asset_id: values[6],
          result_hash: values[7],
          report: JSON.parse(String(values[8])) as unknown,
          source_evidence_id: values[9],
          terminal_evidence_id: values[10],
          evidence_ids: values[11],
          source_set: values[12],
          model_version: values[13],
          freshness: values[14],
          field_extraction_coverage: values[15],
          extraction_confidence: values[16],
          created_at: '2026-08-12T00:00:01.000Z',
        };
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("to_regclass('public.claim_declaration_reports')")) {
        return {
          rows: [{ reports: 'claim_declaration_reports', migrated: true }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM claim_declaration_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    async end() {},
  };
}

describe('Claim declaration report repository', () => {
  it('persists and replays one canonical source-Snapshot report', async () => {
    const database = pool();
    const repository = PostgresClaimDeclarationReportRepository.fromPool(database);
    const input = report();

    const stored = await repository.put(input);
    expect(stored).toMatchObject({
      id: input.id,
      sourceSnapshotId: input.sourceSnapshot.id,
      documentHash: input.documentHash,
      contentHash: input.sourceSnapshot.contentHash,
      ledger: 'EVM',
      chainId: 'eip155:56',
      assetId: input.assetId,
      resultHash: input.resultHash,
      report: input,
      sourceEvidenceId: input.evidence.id,
      terminalEvidenceId: input.terminalEvidenceId,
      modelVersion: input.modelVersion,
      freshness: input.freshness,
      extractionConfidence: 1,
    });
    await expect(repository.get(input.id)).resolves.toEqual(stored);
    await expect(repository.latestByAsset(input.assetId)).resolves.toEqual(stored);
    await expect(repository.latestByDocument(input.documentHash, input.assetId)).resolves.toEqual(
      stored,
    );
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
  });

  it('rejects non-canonical reports and corrupt durable columns', async () => {
    const database = pool();
    const repository = PostgresClaimDeclarationReportRepository.fromPool(database);
    const input = report();
    await expect(
      repository.put({
        ...input,
        terminalEvidence: { ...input.terminalEvidence, summary: 'Tampered.' },
      }),
    ).rejects.toBeInstanceOf(ClaimDeclarationReportStorageError);

    await repository.put(input);
    database.row = { ...database.row, source_set: ['invented-source'] };
    await expect(repository.get(input.id)).rejects.toMatchObject({
      code: 'CLAIM_DECLARATION_REPORT_CONFLICT',
      retryable: false,
    });
    await expect(
      repository.latestByDocument('not-a-document-hash', input.assetId),
    ).rejects.toMatchObject({ code: 'CLAIM_DECLARATION_REPORT_INVALID' });
  });
});
