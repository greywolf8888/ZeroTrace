import { describe, expect, it } from 'vitest';

import { parseEvmClaimDeclaration, reviewClaimDeclarationDraft } from '@zerotrace/claim-audit';

import {
  ClaimRuleReviewReportStorageError,
  PostgresClaimRuleReviewReportRepository,
} from './claim-rule-review-reports.js';

function report() {
  const declarationReport = parseEvmClaimDeclaration({
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
  const draft = declarationReport.drafts.find((item) => item.role === 'COMMUNITY_FUND');
  if (draft === undefined) throw new Error('Community draft fixture is missing.');
  return reviewClaimDeclarationDraft({
    declarationReport,
    draftId: draft.id,
    reviewerLabel: 'local analyst session',
    reviewSource: 'analyst:local-session',
    reviewedAt: '2026-08-12T00:01:00.000Z',
    rule: {
      sourceAddress: `0x${'1'.repeat(40)}`,
      destinationAddress: `0x${'2'.repeat(40)}`,
      role: 'COMMUNITY_FUND',
      expectedAction: 'DISTRIBUTE',
      expectedShareBps: '10000',
      window: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-12T00:00:00.000Z',
      },
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
      if (text.includes('INSERT INTO claim_rule_review_reports')) {
        row = {
          id: values[0],
          declaration_report_id: values[1],
          declaration_result_hash: values[2],
          document_hash: values[3],
          draft_id: values[4],
          rule_id: values[5],
          ledger: values[6],
          chain_id: values[7],
          asset_id: values[8],
          result_hash: values[9],
          report: JSON.parse(String(values[10])) as unknown,
          review_evidence_id: values[11],
          terminal_evidence_id: values[12],
          token_decimals_evidence_id: values[13],
          evidence_ids: values[14],
          source_set: values[15],
          model_version: values[16],
          reviewed_at: values[17],
          created_at: '2026-08-12T00:01:01.000Z',
        };
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("to_regclass('public.claim_rule_review_reports')")) {
        return {
          rows: [{ reports: 'claim_rule_review_reports', migrated: true }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM claim_rule_review_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    async end() {},
  };
}

describe('Claim rule review report repository', () => {
  it('persists and replays one canonical reviewed Expected rule', async () => {
    const database = pool();
    const repository = PostgresClaimRuleReviewReportRepository.fromPool(database);
    const input = report();

    const stored = await repository.put(input);
    expect(stored).toMatchObject({
      id: input.id,
      declarationReportId: input.declarationReportId,
      declarationResultHash: input.declarationResultHash,
      documentHash: input.documentHash,
      draftId: input.draftId,
      ruleId: input.rule.id,
      ledger: 'EVM',
      chainId: 'eip155:56',
      assetId: input.assetId,
      resultHash: input.resultHash,
      report: input,
      reviewEvidenceId: input.reviewEvidenceId,
      terminalEvidenceId: input.terminalEvidenceId,
      tokenDecimalsEvidenceId: null,
      modelVersion: input.modelVersion,
      reviewedAt: input.reviewedAt,
    });
    await expect(repository.get(input.id)).resolves.toEqual(stored);
    await expect(repository.latestByAsset(input.assetId)).resolves.toEqual(stored);
    await expect(
      repository.latestByDraft(input.declarationReportId, input.draftId),
    ).resolves.toEqual(stored);
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
  });

  it('rejects non-canonical reports and corrupt durable columns', async () => {
    const database = pool();
    const repository = PostgresClaimRuleReviewReportRepository.fromPool(database);
    const input = report();
    await expect(
      repository.put({
        ...input,
        evidence: input.evidence.map((item) =>
          item.id === input.terminalEvidenceId ? { ...item, summary: 'Tampered.' } : item,
        ),
      }),
    ).rejects.toBeInstanceOf(ClaimRuleReviewReportStorageError);

    await repository.put(input);
    database.row = { ...database.row, source_set: ['invented-source'] };
    await expect(repository.get(input.id)).rejects.toMatchObject({
      code: 'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
      retryable: false,
    });
  });
});
