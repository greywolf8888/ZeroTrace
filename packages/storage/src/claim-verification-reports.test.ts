import { describe, expect, it } from 'vitest';

import {
  auditClaims,
  buildClaimVerificationObservation,
  parseEvmClaimDeclaration,
  reviewClaimDeclarationDraft,
  summarizeClaimAddressFlows,
} from '@zerotrace/claim-audit';
import {
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type EvmClaimAddressObservation,
  type EvmClaimTransferObservation,
} from '@zerotrace/schemas';

import {
  ClaimVerificationReportStorageError,
  PostgresClaimVerificationReportRepository,
} from './claim-verification-reports.js';

const token = `0x${'a'.repeat(40)}`;
const source = `0x${'1'.repeat(40)}`;
const destination = `0x${'2'.repeat(40)}`;
const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'b'.repeat(64)}`,
  finality: 'finalized' as const,
  blockTimestamp: '2026-08-12T00:00:00.000Z',
  capturedAt: '2026-08-12T00:00:01.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { claimEvm: 'claim-evm-transfer-v1.0.0' },
  configHash: 'c'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-v1',
};

function transfer(): EvmClaimTransferObservation {
  return {
    id: 'transfer-one',
    from: source,
    to: destination,
    amount: '2000',
    observedAt: '2026-08-11T00:00:00.000Z',
    transactionId: `0x${'d'.repeat(64)}`,
    evidenceIds: [`ev_${'1'.repeat(24)}`],
    blockNumber: '90',
    blockHash: `0x${'e'.repeat(64)}`,
    transactionIndex: '1',
    logIndex: '1',
  };
}

function observation(
  address: string,
  transfers: EvmClaimTransferObservation[],
  evidenceFill: string,
): EvmClaimAddressObservation {
  const custodyEvidenceId = `ev_${evidenceFill.repeat(24)}`;
  const terminalEvidenceId = `ev_${evidenceFill.repeat(23)}f`;
  const flowMetadata: AnalysisMetadata = {
    snapshot,
    dataCoverage: 1,
    sourceCoverage: 0.5,
    historyCoverage: 1,
    simulationCoverage: 0,
    freshness: snapshot.blockTimestamp,
    sourceSet: ['sqd:test'],
    modelVersion: 'evm-claim-transfer-v1.0.0',
    confidence: 0.95,
    evidenceIds: transfers.flatMap((item) => item.evidenceIds),
  };
  const flow = summarizeClaimAddressFlows({
    address,
    window: { from: '2026-08-01T00:00:00.000Z', to: snapshot.blockTimestamp },
    transfers,
    metadata: flowMetadata,
  });
  const custodyMetadata: AnalysisMetadata = {
    ...flowMetadata,
    historyCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet: ['rpc:test'],
    modelVersion: 'evm-custody-v1.0.0',
    evidenceIds: [custodyEvidenceId],
  };
  const evidenceIds = [
    ...new Set([custodyEvidenceId, ...flow.metadata.evidenceIds, terminalEvidenceId]),
  ].sort();
  return {
    tokenAddress: token,
    address,
    fromBlock: '80',
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

function report() {
  const declaration = parseEvmClaimDeclaration({
    text: `Tax receiver (100%)\n${source}\nCommunity fund (20%)\n${destination}`,
    chainId: 'eip155:56',
    assetId: `eip155:56:erc20:${token}`,
    source: 'public:test-announcement',
    observedAt: snapshot.blockTimestamp,
    auditWindow: { from: '2026-08-01T00:00:00.000Z', to: snapshot.blockTimestamp },
  });
  const draft = declaration.drafts.find((item) => item.role === 'COMMUNITY_FUND');
  if (draft === undefined) throw new Error('Expected a community-fund draft.');
  const review = reviewClaimDeclarationDraft({
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
  const observedTransfer = transfer();
  const sourceObservation = observation(source, [observedTransfer], '3');
  const destinationObservation = observation(destination, [observedTransfer], '4');
  const evidenceIds = [
    ...new Set([
      ...review.evidenceIds,
      ...sourceObservation.metadata.evidenceIds,
      ...destinationObservation.metadata.evidenceIds,
    ]),
  ].sort();
  const audit = auditClaims({
    baseAmount: unknownValue('INSUFFICIENT_DATA', 'No complete denominator.'),
    claims: [review.rule],
    transfers: [observedTransfer],
    actions: [],
    custody: [
      {
        address: destination,
        kind: 'EOA',
        canMoveFunds: knownValue(true),
        evidenceIds: destinationObservation.custody.evidenceIds,
      },
    ],
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: snapshot.capturedAt,
      sourceSet: ['rpc:test', 'sqd:test'],
      modelVersion: 'claim-verification-audit-input-v1',
      confidence: 0.5,
      evidenceIds,
    },
  });
  return buildClaimVerificationObservation({
    reviewReport: review,
    sourceObservationReportId: `ecr_${'5'.repeat(24)}`,
    sourceObservation,
    destinationObservationReportId: `ecr_${'6'.repeat(24)}`,
    destinationObservation,
    actions: [],
    audit,
  }).report;
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
      if (text.includes('INSERT INTO claim_verification_reports')) {
        row = {
          id: values[0],
          review_report_id: values[1],
          review_result_hash: values[2],
          rule_id: values[3],
          asset_id: values[4],
          from_block: values[5],
          to_block: values[6],
          source_observation_report_id: values[7],
          destination_observation_report_id: values[8],
          action_semantics_report_ids: values[9],
          result_hash: values[10],
          report: JSON.parse(String(values[11])) as unknown,
          status: values[12],
          terminal_evidence_id: values[13],
          evidence_ids: values[14],
          source_set: values[15],
          model_version: values[16],
          captured_at: values[17],
          created_at: '2026-08-12T00:00:02.000Z',
        };
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("to_regclass('public.claim_verification_reports')")) {
        return {
          rows: [{ table_name: 'claim_verification_reports', migrated: true }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM claim_verification_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    async end() {},
  };
}

describe('Claim verification report repository', () => {
  it('persists and replays one immutable observation report', async () => {
    const database = pool();
    const repository = PostgresClaimVerificationReportRepository.fromPool(database);
    const input = report();

    const stored = await repository.put(input);
    expect(stored).toMatchObject({
      id: input.id,
      reviewReportId: input.reviewReportId,
      ruleId: input.ruleId,
      assetId: input.assetId,
      status: 'INSUFFICIENT_DATA',
      report: input,
      modelVersion: 'claim-verification-observation-v0.1.0',
    });
    await expect(repository.get(input.id)).resolves.toEqual(stored);
    await expect(repository.latestByRule(input.ruleId)).resolves.toEqual(stored);
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
  });

  it('rejects tampered report identity and corrupt durable columns', async () => {
    const database = pool();
    const repository = PostgresClaimVerificationReportRepository.fromPool(database);
    const input = report();
    await expect(repository.put({ ...input, resultHash: '0'.repeat(64) })).rejects.toBeInstanceOf(
      ClaimVerificationReportStorageError,
    );

    await repository.put(input);
    database.row = { ...database.row, status: 'VERIFIED' };
    await expect(repository.get(input.id)).rejects.toMatchObject({
      code: 'CLAIM_VERIFICATION_REPORT_CONFLICT',
      retryable: false,
    });
  });
});
