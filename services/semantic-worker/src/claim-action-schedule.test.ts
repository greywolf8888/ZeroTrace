import { describe, expect, it } from 'vitest';

import { parseEvmClaimDeclaration, reviewClaimDeclarationDraft } from '@zerotrace/claim-audit';

import { buildClaimActionsSchedule } from './claim-action-schedule.js';

const capturedAt = '2026-08-12T00:00:00.000Z';
const assetId = `eip155:56:erc20:0x${'11'.repeat(20)}`;
const sourceAddress = `0x${'22'.repeat(20)}`;
const destinationAddress = `0x${'33'.repeat(20)}`;

function review() {
  const declaration = parseEvmClaimDeclaration({
    source: 'operator:claim-schedule-test',
    text: `Tax receiver (100%)\n${sourceAddress}\nCommunity fund (20%)\n${destinationAddress}`,
    chainId: 'eip155:56',
    observedAt: capturedAt,
    assetId,
    auditWindow: { from: '2026-08-01T00:00:00.000Z', to: capturedAt },
  });
  const draft = declaration.drafts.find(
    (item) =>
      item.sourceAddress.state === 'known' && item.destinationAddress.state === 'known',
  );
  if (draft === undefined) throw new Error('Expected a schedulable declaration draft.');
  return reviewClaimDeclarationDraft({
    declarationReport: declaration,
    draftId: draft.id,
    reviewerLabel: 'test reviewer',
    reviewedAt: capturedAt,
    rule: {
      sourceAddress,
      destinationAddress,
      role: 'COMMUNITY_FUND',
      expectedAction: 'DISTRIBUTE',
      expectedShareBps: '2000',
      window: { from: '2026-08-01T00:00:00.000Z', to: capturedAt },
    },
  });
}

describe('Claim Actions schedules', () => {
  it('binds one immutable read-only range capture to an exact reviewed rule revision', () => {
    const report = review();
    const schedule = buildClaimActionsSchedule({
      reviewReport: report,
      fromBlock: '100',
      toBlock: '200',
      createdAt: capturedAt,
      at: capturedAt,
    });

    expect(schedule).toMatchObject({
      definition: {
        captureKind: 'CLAIM_ACTIONS',
        operation: 'READ_ONLY_CAPTURE',
        target: {
          ledger: 'EVM',
          chainId: '56',
          subjectType: 'TOKEN',
          normalizedIdentifier: assetId,
        },
        parameters: {
          reviewReportId: report.id,
          reviewResultHash: report.resultHash,
          ruleId: report.rule.id,
          assetId,
          fromBlock: '100',
          toBlock: '200',
          observerVersion: 'evm-claim-address-observation-v1.0.0',
        },
      },
      status: 'ACTIVE',
    });
  });

  it('rejects stale times, non-EVM assets, invalid ranges, and inadequate request budgets', () => {
    const report = review();
    expect(() =>
      buildClaimActionsSchedule({
        reviewReport: report,
        fromBlock: '200',
        toBlock: '100',
        createdAt: capturedAt,
        at: capturedAt,
      }),
    ).toThrow('must not end before');
    expect(() =>
      buildClaimActionsSchedule({
        reviewReport: report,
        fromBlock: '0',
        toBlock: '1000000',
        createdAt: capturedAt,
        at: capturedAt,
        limits: { maxBlocksPerRequest: 1, maxRequests: 1 },
      }),
    ).toThrow('request budget');
    expect(() =>
      buildClaimActionsSchedule({
        reviewReport: report,
        fromBlock: '0',
        toBlock: '0',
        createdAt: capturedAt,
        at: '2026-08-11T00:00:00.000Z',
      }),
    ).toThrow('may not precede');
    expect(() =>
      buildClaimActionsSchedule({
        reviewReport: { ...report, assetId: 'bitcoin-mainnet:asset' },
        fromBlock: '0',
        toBlock: '0',
        createdAt: capturedAt,
        at: capturedAt,
      }),
    ).toThrow();
  });
});
