import { describe, expect, it } from 'vitest';

import {
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type EvmClaimAddressObservation,
  type EvmClaimTransferObservation,
} from '@zerotrace/schemas';

import { auditClaims, summarizeClaimAddressFlows } from './index.js';
import { parseEvmClaimDeclaration } from './declaration.js';
import { reviewClaimDeclarationDraft } from './review.js';
import {
  buildClaimVerificationObservation,
  calculateClaimVerificationObservationResultHash,
  expectedClaimVerificationObservationTerminalEvidence,
} from './verification.js';

const token = `0x${'1'.repeat(40)}`;
const member = `0x${'2'.repeat(40)}`;
const source = `0x${'3'.repeat(40)}`;
const destination = `0x${'4'.repeat(40)}`;
const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  blockTimestamp: '2026-08-10T00:00:00.000Z',
  capturedAt: '2026-08-10T00:00:01.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { claimEvm: 'claim-evm-transfer-v1.0.0' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-v1',
};

function transfer(
  idFill: string,
  from: string,
  to: string,
  amount: string,
  evidenceFill: string,
): EvmClaimTransferObservation {
  return {
    id: `transfer-${idFill}`,
    from,
    to,
    amount,
    observedAt: '2026-08-03T00:00:00.000Z',
    transactionId: `0x${idFill.repeat(64)}`,
    evidenceIds: [`ev_${evidenceFill.repeat(24)}`],
    blockNumber: '90',
    blockHash: `0x${'c'.repeat(64)}`,
    transactionIndex: '1',
    logIndex: idFill === '5' ? '1' : '2',
  };
}

function observation(
  address: string,
  transfers: EvmClaimTransferObservation[],
  evidenceFill: string,
): EvmClaimAddressObservation {
  const custodyEvidenceId = `ev_${evidenceFill.repeat(24)}`;
  const terminalEvidenceId = `ev_${evidenceFill.repeat(23)}9`;
  const transferEvidenceIds = transfers.flatMap((item) => item.evidenceIds);
  const custodyMetadata: AnalysisMetadata = {
    snapshot,
    dataCoverage: 1,
    sourceCoverage: 0.5,
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet: ['rpc:test'],
    modelVersion: 'evm-custody-v1.0.0',
    confidence: 0.95,
    evidenceIds: [custodyEvidenceId],
  };
  const flowMetadata: AnalysisMetadata = {
    ...custodyMetadata,
    sourceSet: ['sqd:test'],
    modelVersion: 'evm-claim-transfer-v1.0.0',
    historyCoverage: 1,
    evidenceIds: transferEvidenceIds,
  };
  const flow = summarizeClaimAddressFlows({
    address,
    window: { from: '2026-08-01T00:00:00.000Z', to: snapshot.blockTimestamp },
    transfers,
    metadata: flowMetadata,
  });
  const evidenceIds = [
    ...new Set([custodyEvidenceId, ...flow.metadata.evidenceIds, terminalEvidenceId]),
  ].sort();
  return {
    tokenAddress: token,
    address,
    fromBlock: '90',
    toBlock: '100',
    window: flow.window,
    custody: {
      address,
      kind: 'EOA',
      canMoveFunds: knownValue(true),
      evidenceIds: [custodyEvidenceId],
    },
    custodyMetadata,
    flow,
    transfers,
    terminalEvidenceId,
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: snapshot.blockTimestamp,
      sourceSet: ['rpc:test', 'sqd:test'],
      modelVersion: 'evm-claim-address-observation-v1.0.0',
      confidence: 0.95,
      evidenceIds,
    },
  };
}

function reviewedRule() {
  const declaration = parseEvmClaimDeclaration({
    text: `Tax receiver (100%)\n${source}\nCommunity fund (20%)\n${destination}`,
    chainId: 'eip155:56',
    assetId: `eip155:56:erc20:${token}`,
    source: 'public:test-announcement',
    observedAt: snapshot.blockTimestamp,
    auditWindow: { from: '2026-08-01T00:00:00.000Z', to: snapshot.blockTimestamp },
  });
  const draft = declaration.drafts.find((item) => item.role === 'COMMUNITY_FUND');
  if (draft === undefined) throw new Error('Expected community-fund declaration draft.');
  return reviewClaimDeclarationDraft({
    declarationReport: declaration,
    draftId: draft.id,
    reviewerLabel: 'test reviewer',
    reviewedAt: snapshot.capturedAt,
    rule: {
      sourceAddress: source,
      destinationAddress: destination,
      role: 'COMMUNITY_FUND',
      expectedAction: 'DISTRIBUTE',
      expectedShareBps: '2000',
      window: { from: '2026-08-01T00:00:00.000Z', to: snapshot.blockTimestamp },
    },
  });
}

describe('Claim verification observation composition', () => {
  it('persists replay inputs while keeping denominator, action coverage and claim truth Unknown', () => {
    const transfers = [
      transfer('5', member, source, '5000', '5'),
      transfer('6', source, destination, '1000', '6'),
    ];
    const sourceObservation = observation(source, transfers, '7');
    const destinationObservation = observation(destination, [transfers[1]!], '8');
    const review = reviewedRule();
    const metadata: AnalysisMetadata = {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: snapshot.capturedAt,
      sourceSet: ['rpc:test', 'sqd:test'],
      modelVersion: 'claim-verification-audit-input-v1',
      confidence: 0.5,
      evidenceIds: [
        ...new Set([
          ...review.evidenceIds,
          ...sourceObservation.metadata.evidenceIds,
          ...destinationObservation.metadata.evidenceIds,
        ]),
      ].sort(),
    };
    const audit = auditClaims({
      baseAmount: unknownValue(
        'INSUFFICIENT_DATA',
        'Observed source inflow is not a complete allocation denominator.',
      ),
      claims: [review.rule],
      transfers,
      actions: [],
      custody: [
        {
          address: destinationObservation.custody.address,
          kind: destinationObservation.custody.kind,
          canMoveFunds: knownValue(true),
          evidenceIds: destinationObservation.custody.evidenceIds,
        },
      ],
      metadata,
    });
    const built = buildClaimVerificationObservation({
      reviewReport: review,
      sourceObservationReportId: `ecr_${'1'.repeat(24)}`,
      sourceObservation,
      destinationObservationReportId: `ecr_${'2'.repeat(24)}`,
      destinationObservation,
      actions: [],
      audit,
    });

    expect(built.report).toMatchObject({
      observedBaseAmountLowerBound: '5000',
      baseAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      status: 'INSUFFICIENT_DATA',
      claimTruth: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      coverage: {
        reviewedRule: 1,
        addressFlow: 1,
        custodyAtSnapshot: 1,
        custodyHistory: { state: 'unknown' },
        actionSemantics: { state: 'unknown', reason: 'NOT_QUERIED' },
        sourceIndependence: { state: 'unknown' },
      },
      audit: {
        status: 'INSUFFICIENT_DATA',
        items: [
          {
            observedReceivedAmount: '1000',
            actualReceivedAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
          },
        ],
      },
    });
    expect(calculateClaimVerificationObservationResultHash(built.report)).toBe(
      built.report.resultHash,
    );
    expect(expectedClaimVerificationObservationTerminalEvidence(built.report)).toEqual(
      built.terminalEvidence,
    );
    expect(built.parentEvidenceIds).toEqual(
      [
        review.terminalEvidenceId,
        sourceObservation.terminalEvidenceId,
        destinationObservation.terminalEvidenceId,
      ].sort(),
    );
  });
});
