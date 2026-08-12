import { describe, expect, it } from 'vitest';

import { createEvidence, hashPayload } from '@zerotrace/evidence';
import { knownValue } from '@zerotrace/schemas';

import { parseEvmClaimDeclaration } from './declaration.js';
import {
  calculateClaimRuleReviewResultHash,
  expectedClaimRuleReviewTerminalEvidence,
  reviewClaimDeclarationDraft,
  validateClaimRuleReviewReport,
} from './review.js';

const chainId = 'eip155:56';
const assetId = `eip155:56:erc20:0x${'a'.repeat(40)}`;
const taxReceiver = `0x${'1'.repeat(40)}`;
const communityFund = `0x${'2'.repeat(40)}`;
const auditWindow = {
  from: '2026-08-02T00:00:00.000Z',
  to: '2026-08-10T00:00:00.000Z',
};

function allocationDeclaration() {
  return parseEvmClaimDeclaration({
    text: `
Tax receiver wallet (100%)
${taxReceiver}

Community fund (20%)
${communityFund}
`,
    chainId,
    assetId,
    source: 'public:project-announcement-capture',
    sourceUri: 'https://example.invalid/project/announcement/1',
    observedAt: '2026-08-10T00:00:00.000Z',
    auditWindow,
  });
}

function reviewedCommunityRule() {
  const declarationReport = allocationDeclaration();
  const draft = declarationReport.drafts.find((item) => item.role === 'COMMUNITY_FUND');
  if (draft === undefined) throw new Error('Community draft fixture was not parsed.');
  return reviewClaimDeclarationDraft({
    declarationReport,
    draftId: draft.id,
    reviewerLabel: 'local analyst session',
    reviewSource: 'analyst:local-session',
    reviewedAt: '2026-08-10T00:01:00.000Z',
    rule: {
      sourceAddress: taxReceiver,
      destinationAddress: communityFund,
      role: 'COMMUNITY_FUND',
      expectedAction: 'DISTRIBUTE',
      expectedShareBps: '2000',
      window: auditWindow,
    },
  });
}

describe('Claim declaration draft review', () => {
  it('promotes a confirmed draft to an Evidence-backed Expected rule without asserting truth', () => {
    const report = reviewedCommunityRule();

    expect(report).toMatchObject({
      schemaVersion: 'claim-rule-review-report-v1',
      assetId,
      reviewerLabel: 'local analyst session',
      rule: {
        assetId,
        sourceAddress: taxReceiver,
        destinationAddress: communityFund,
        role: 'COMMUNITY_FUND',
        expectedAction: 'DISTRIBUTE',
        expectedShareBps: '2000',
      },
      fieldOrigins: {
        assetId: 'DECLARATION_CONFIRMED',
        sourceAddress: 'DECLARATION_CONFIRMED',
        destinationAddress: 'DECLARATION_CONFIRMED',
        role: 'DECLARATION_CONFIRMED',
        expectedAction: 'DECLARATION_CONFIRMED',
        expectedShareBps: 'DECLARATION_CONFIRMED',
        window: 'DECLARATION_CONFIRMED',
      },
      tokenDecimals: { state: 'unknown', reason: 'NOT_QUERIED' },
      claimTruth: { state: 'unknown', reason: 'NOT_QUERIED' },
      reviewerAuthority: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      confidence: { state: 'unknown', reason: 'NOT_QUERIED' },
      coverage: {
        sourceDocument: 1,
        humanReview: 1,
        fieldCompleteness: 1,
        chainVerification: { state: 'unknown', reason: 'NOT_QUERIED' },
      },
      requiresChainVerification: true,
    });
    expect(report.rule.claimEvidenceIds).toContain(report.reviewEvidenceId);
    expect(report.rule.claimEvidenceIds).not.toContain(report.terminalEvidenceId);
    expect(report.terminalEvidenceId).toBe(expectedClaimRuleReviewTerminalEvidence(report).id);
    expect(calculateClaimRuleReviewResultHash(report)).toBe(report.resultHash);
    expect(validateClaimRuleReviewReport(report)).toEqual(report);
  });

  it('is deterministic and rejects mutated review values or Evidence', () => {
    const report = reviewedCommunityRule();
    expect(reviewedCommunityRule()).toEqual(report);

    expect(() =>
      validateClaimRuleReviewReport({
        ...report,
        rule: { ...report.rule, destinationAddress: `0x${'3'.repeat(40)}` },
      }),
    ).toThrow(/canonical|linked/i);
    expect(() =>
      validateClaimRuleReviewReport({
        ...report,
        evidence: report.evidence.map((item) =>
          item.id === report.terminalEvidenceId ? { ...item, summary: 'Mutated.' } : item,
        ),
      }),
    ).toThrow(/canonical|linked/i);
    expect(() => validateClaimRuleReviewReport({ ...report, resultHash: '0'.repeat(64) })).toThrow(
      /canonical|linked/i,
    );
  });

  it('records analyst overrides instead of silently filling declaration gaps', () => {
    const declarationReport = allocationDeclaration();
    const draft = declarationReport.drafts.find((item) => item.role === 'TAX_RECEIVER');
    if (draft === undefined) throw new Error('Tax-receiver draft fixture was not parsed.');
    const report = reviewClaimDeclarationDraft({
      declarationReport,
      draftId: draft.id,
      reviewerLabel: 'local analyst session',
      reviewSource: 'analyst:local-session',
      reviewedAt: '2026-08-10T00:01:00.000Z',
      rule: {
        sourceAddress: `0x${'4'.repeat(40)}`,
        destinationAddress: taxReceiver,
        role: 'TAX_RECEIVER',
        expectedAction: 'RECEIVE',
        expectedShareBps: '10000',
        window: auditWindow,
      },
    });

    expect(report.fieldOrigins.sourceAddress).toBe('ANALYST_OVERRIDE');
    expect(report.fieldOrigins.destinationAddress).toBe('DECLARATION_CONFIRMED');
    expect(report.claimTruth.state).toBe('unknown');
  });

  it('requires same-chain state Evidence to convert human token units to atomic units', () => {
    const pensionAddress = `0x${'5'.repeat(40)}`;
    const memberAddress = `0x${'6'.repeat(40)}`;
    const declarationReport = parseEvmClaimDeclaration({
      text: `养老钱包\n${pensionAddress}\n打入1000000币为1股进行加入不可退出。`,
      chainId,
      assetId,
      source: 'public:pension-policy-capture',
      observedAt: '2026-08-10T00:00:00.000Z',
      auditWindow,
    });
    const draft = declarationReport.drafts.find((item) => item.role === 'PENSION_VAULT');
    if (draft === undefined) throw new Error('Pension draft fixture was not parsed.');
    const rule = {
      sourceAddress: memberAddress,
      destinationAddress: pensionAddress,
      role: 'PENSION_VAULT' as const,
      expectedAction: 'LOCK' as const,
      window: auditWindow,
      shareUnit: (1_000_000n * 10n ** 18n).toString(),
      noExit: true,
    };

    expect(() =>
      reviewClaimDeclarationDraft({
        declarationReport,
        draftId: draft.id,
        reviewerLabel: 'local analyst session',
        reviewedAt: '2026-08-10T00:01:00.000Z',
        rule,
      }),
    ).toThrow(/decimals/i);

    const tokenDecimalsEvidence = createEvidence({
      ledger: 'EVM',
      chainId,
      kind: 'CONTRACT_STATE',
      source: 'rpc:bsc-state-capture',
      locator: `token-decimals:${assetId}`,
      payload: { schema: 'zerotrace-token-decimals-v1', assetId, decimals: 18 },
      observedAt: '2026-08-10T00:00:30.000Z',
      blockOrSlot: '100',
      finality: 'finalized',
      summary: 'ERC-20 decimals observed from finalized contract state.',
    });
    expect(tokenDecimalsEvidence.payloadHash).toBe(
      hashPayload({ schema: 'zerotrace-token-decimals-v1', assetId, decimals: 18 }),
    );
    const report = reviewClaimDeclarationDraft({
      declarationReport,
      draftId: draft.id,
      reviewerLabel: 'local analyst session',
      reviewSource: 'analyst:local-session',
      reviewedAt: '2026-08-10T00:01:00.000Z',
      rule,
      tokenDecimals: knownValue(18),
      tokenDecimalsEvidence,
    });

    expect(report.fieldOrigins).toMatchObject({
      sourceAddress: 'ANALYST_OVERRIDE',
      destinationAddress: 'DECLARATION_CONFIRMED',
      shareUnit: 'DECLARATION_CONFIRMED',
      noExit: 'DECLARATION_CONFIRMED',
    });
    expect(report.tokenDecimalsEvidenceId).toBe(tokenDecimalsEvidence.id);
    expect(report.sourceSet).toEqual(
      ['analyst:local-session', 'public:pension-policy-capture', 'rpc:bsc-state-capture'].sort(),
    );
  });

  it('does not permit omission of a declaration field that was Known', () => {
    const declarationReport = allocationDeclaration();
    const draft = declarationReport.drafts.find((item) => item.role === 'COMMUNITY_FUND');
    if (draft === undefined) throw new Error('Community draft fixture was not parsed.');
    expect(() =>
      reviewClaimDeclarationDraft({
        declarationReport,
        draftId: draft.id,
        reviewerLabel: 'local analyst session',
        reviewedAt: '2026-08-10T00:01:00.000Z',
        rule: {
          sourceAddress: taxReceiver,
          destinationAddress: communityFund,
          role: 'COMMUNITY_FUND',
          expectedAction: 'DISTRIBUTE',
          window: auditWindow,
        },
      }),
    ).toThrow(/silently omit/i);
  });
});
