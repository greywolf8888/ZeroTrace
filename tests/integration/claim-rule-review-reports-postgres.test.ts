import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseEvmClaimDeclaration, reviewClaimDeclarationDraft } from '@zerotrace/claim-audit';
import { createEvidence } from '@zerotrace/evidence';
import { knownValue, type AnalysisSnapshot } from '@zerotrace/schemas';
import {
  PostgresClaimDeclarationReportRepository,
  PostgresClaimRuleReviewReportRepository,
  PostgresEvidenceRepository,
} from '@zerotrace/storage';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;

postgresDescribe('PostgreSQL durable Claim rule review report integration', () => {
  let evidence: PostgresEvidenceRepository;
  let declarations: PostgresClaimDeclarationReportRepository;
  let reviews: PostgresClaimRuleReviewReportRepository;

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    declarations = new PostgresClaimDeclarationReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    reviews = new PostgresClaimRuleReviewReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => Promise.all([evidence.close(), declarations.close(), reviews.close()]));

  it('links one reviewed Expected rule to immutable source and review Evidence', async () => {
    const nonce = randomUUID();
    const tokenAddress = nonce.replaceAll('-', '').padEnd(40, '0').slice(0, 40);
    const declaration = parseEvmClaimDeclaration({
      text: `Tax receiver (100%)\n0x${'1'.repeat(40)}\nCommunity fund (100%)\n0x${'2'.repeat(40)}\nReference ${nonce}`,
      chainId: 'eip155:56',
      assetId: `eip155:56:erc20:0x${tokenAddress}`,
      source: `integration:claim-review-source:${nonce}`,
      observedAt: '2026-08-12T00:10:00.000Z',
      auditWindow: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-12T00:00:00.000Z',
      },
    });
    const draft = declaration.drafts.find((item) => item.role === 'COMMUNITY_FUND');
    if (draft === undefined) throw new Error('Community draft fixture is missing.');
    const review = reviewClaimDeclarationDraft({
      declarationReport: declaration,
      draftId: draft.id,
      reviewerLabel: `integration analyst ${nonce}`,
      reviewSource: `integration:analyst-review:${nonce}`,
      reviewedAt: '2026-08-12T00:11:00.000Z',
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

    await expect(reviews.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(reviews.put(review)).rejects.toMatchObject({
      code: 'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
      retryable: false,
    });

    await evidence.put(declaration.evidence);
    await evidence.put(declaration.terminalEvidence, [declaration.evidence.id]);
    await declarations.put(declaration);
    await evidence.put(review.evidence.find((item) => item.id === review.reviewEvidenceId)!);
    await evidence.put(
      review.evidence.find((item) => item.id === review.terminalEvidenceId)!,
      [declaration.terminalEvidenceId, review.reviewEvidenceId],
    );
    const stored = await reviews.put(review);
    await expect(reviews.put(review)).resolves.toEqual(stored);
    expect(stored).toMatchObject({
      id: review.id,
      declarationReportId: declaration.id,
      draftId: draft.id,
      ruleId: review.rule.id,
      report: {
        claimTruth: { state: 'unknown', reason: 'NOT_QUERIED' },
        coverage: { chainVerification: { state: 'unknown', reason: 'NOT_QUERIED' } },
      },
    });

    await reviews.close();
    reviews = new PostgresClaimRuleReviewReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(reviews.get(review.id)).resolves.toEqual(stored);
    await expect(reviews.latestByAsset(review.assetId)).resolves.toEqual(stored);
    await expect(reviews.latestByDraft(declaration.id, draft.id)).resolves.toEqual(stored);

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE claim_rule_review_reports SET report = report WHERE id = $1', [
          review.id,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM claim_rule_review_reports WHERE id = $1', [review.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool.end();
    }
  });

  it('requires pension token decimals to reference durable finalized Snapshot Evidence', async () => {
    const nonce = randomUUID();
    const tokenAddress = nonce.replaceAll('-', '').padEnd(40, '0').slice(0, 40);
    const pensionAddress = `0x${'5'.repeat(40)}`;
    const declaration = parseEvmClaimDeclaration({
      text: `养老钱包\n${pensionAddress}\n打入1000000币为1股进行加入不可退出。\nReference ${nonce}`,
      chainId: 'eip155:56',
      assetId: `eip155:56:erc20:0x${tokenAddress}`,
      source: `integration:pension-source:${nonce}`,
      observedAt: '2026-08-12T00:20:00.000Z',
      auditWindow: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-12T00:00:00.000Z',
      },
    });
    const draft = declaration.drafts.find((item) => item.role === 'PENSION_VAULT');
    if (draft === undefined) throw new Error('Pension draft fixture is missing.');
    const snapshot: AnalysisSnapshot = {
      ledger: 'EVM',
      chainId: 'eip155:56',
      blockNumber: '100',
      blockHash: `0x${tokenAddress}${'1'.repeat(24)}`,
      parentBlockHash: `0x${tokenAddress}${'2'.repeat(24)}`,
      finality: 'finalized',
      blockTimestamp: '2026-08-12T00:19:59.000Z',
      capturedAt: '2026-08-12T00:20:30.000Z',
      providerVersions: { [`integration:bsc-rpc:${nonce}`]: 'json-rpc' },
      adapterVersions: { evm: '0.1.0' },
      configHash: 'a'.repeat(64),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
    const decimalsEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'CONTRACT_STATE',
      source: `integration:bsc-rpc:${nonce}`,
      locator: `token-decimals:${declaration.assetId}`,
      payload: {
        schema: 'zerotrace-token-decimals-v1',
        assetId: declaration.assetId,
        decimals: 18,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'ERC-20 decimals observed from finalized integration contract state.',
    });
    const review = reviewClaimDeclarationDraft({
      declarationReport: declaration,
      draftId: draft.id,
      reviewerLabel: `integration pension analyst ${nonce}`,
      reviewSource: `integration:pension-review:${nonce}`,
      reviewedAt: '2026-08-12T00:21:00.000Z',
      tokenDecimals: knownValue(18),
      tokenDecimalsEvidence: decimalsEvidence,
      rule: {
        sourceAddress: `0x${'6'.repeat(40)}`,
        destinationAddress: pensionAddress,
        role: 'PENSION_VAULT',
        expectedAction: 'LOCK',
        shareUnit: (1_000_000n * 10n ** 18n).toString(),
        noExit: true,
        window: {
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-12T00:00:00.000Z',
        },
      },
    });

    await evidence.put(declaration.evidence);
    await evidence.put(declaration.terminalEvidence, [declaration.evidence.id]);
    await declarations.put(declaration);
    await evidence.put(decimalsEvidence, [], snapshot);
    await evidence.put(review.evidence.find((item) => item.id === review.reviewEvidenceId)!);
    await evidence.put(
      review.evidence.find((item) => item.id === review.terminalEvidenceId)!,
      [declaration.terminalEvidenceId, decimalsEvidence.id, review.reviewEvidenceId],
    );
    const stored = await reviews.put(review);

    expect(stored).toMatchObject({
      tokenDecimalsEvidenceId: decimalsEvidence.id,
      report: {
        tokenDecimals: { state: 'known', value: 18 },
        fieldOrigins: {
          shareUnit: 'DECLARATION_CONFIRMED',
          noExit: 'DECLARATION_CONFIRMED',
        },
      },
    });
  });
});
