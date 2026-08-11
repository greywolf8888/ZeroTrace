import { describe, expect, it } from 'vitest';

import { createEvidence } from '@zerotrace/evidence';
import { knownValue, unknownValue, type ActionAssetDelta } from '@zerotrace/schemas';

import {
  ACTION_SEMANTICS_MODEL_VERSION,
  actionSemanticsReportId,
  buildActionSemanticsReport,
  calculateActionSemanticsResultHash,
  canonicalActionTransactionId,
  createActionCandidate,
  expectedActionSemanticsTerminalEvidence,
} from './index.js';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '50000000',
  blockHash: `0x${'ab'.repeat(32)}`,
  parentBlockHash: `0x${'cd'.repeat(32)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-12T00:00:10.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { actions: ACTION_SEMANTICS_MODEL_VERSION },
  configHash: 'ef'.repeat(32),
  entityModelVersion: 'entity-v1',
  labelSnapshot: 'labels-v1',
};

function source(locator: string) {
  return createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'RECEIPT',
    source: 'bsc-rpc@test',
    locator,
    payload: { locator },
    observedAt: '2026-08-12T00:00:09.000Z',
    blockOrSlot: snapshot.blockNumber,
    finality: 'finalized',
    summary: `Action source ${locator}.`,
  });
}

function delta(
  assetId: string,
  account: string,
  direction: 'DEBIT' | 'CREDIT',
  amount: string,
  evidenceId: string,
): ActionAssetDelta {
  return { assetId, account, direction, amount, evidenceIds: [evidenceId] };
}

describe('action semantics', () => {
  it('confirms a swap primitive while keeping buyback intent Unknown', () => {
    const evidence = source('swap');
    const candidate = createActionCandidate({
      ledger: 'EVM',
      chainId: 'eip155:56',
      transactionId: `0x${'11'.repeat(32)}`,
      blockOrSlot: snapshot.blockNumber,
      observedAt: evidence.observedAt,
      proposedKind: 'SWAP',
      application: 'APPLIED',
      actor: knownValue('0x1111111111111111111111111111111111111111'),
      counterparties: ['0x2222222222222222222222222222222222222222'],
      assetDeltas: [
        delta('USDT', '0x1111111111111111111111111111111111111111', 'DEBIT', '100', evidence.id),
        delta('FFT', '0x1111111111111111111111111111111111111111', 'CREDIT', '200000', evidence.id),
      ],
      proofKinds: ['BALANCE_DELTAS', 'SWAP_EVENT'],
      evidenceIds: [evidence.id],
    });
    const report = buildActionSemanticsReport({
      snapshot,
      candidates: [candidate],
      evidence: [evidence],
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
    });
    expect(report.actions[0]).toMatchObject({
      proposedKind: 'SWAP',
      primitive: { state: 'known', value: 'SWAP' },
      claimedPurpose: { state: 'unknown', reason: 'NOT_QUERIED' },
      confidence: { state: 'known', value: 1 },
    });
    expect(report.evidence).toHaveLength(2);
    expect(report.metadata.confidence).toBe(1);
  });

  it('refuses to call a transfer-to-custody a burn without supply conservation', () => {
    const evidence = source('movable-custody');
    const candidate = createActionCandidate({
      ledger: 'EVM',
      chainId: 'eip155:56',
      transactionId: `0x${'22'.repeat(32)}`,
      blockOrSlot: snapshot.blockNumber,
      observedAt: evidence.observedAt,
      proposedKind: 'BURN',
      application: 'APPLIED',
      actor: knownValue('0x1111111111111111111111111111111111111111'),
      assetDeltas: [
        delta('FFT', '0x1111111111111111111111111111111111111111', 'DEBIT', '1000000', evidence.id),
        delta(
          'FFT',
          '0x3333333333333333333333333333333333333333',
          'CREDIT',
          '1000000',
          evidence.id,
        ),
      ],
      proofKinds: ['TRANSFER_LOG'],
      evidenceIds: [evidence.id],
    });
    const report = buildActionSemanticsReport({
      snapshot,
      candidates: [candidate],
      evidence: [evidence],
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
    });
    expect(report.actions[0]).toMatchObject({
      primitive: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      findings: ['PROOF_INCOMPLETE', 'INTENT_NOT_INFERRED'],
    });
    expect(report.classificationCoverage).toBe(0);
    expect(report.metadata.confidence).toBe(1);
  });

  it('retains a proved failed attempt with no applied deltas', () => {
    const evidence = source('failed-call');
    const candidate = createActionCandidate({
      ledger: 'EVM',
      chainId: 'eip155:56',
      transactionId: `0x${'33'.repeat(32)}`,
      blockOrSlot: snapshot.blockNumber,
      observedAt: evidence.observedAt,
      proposedKind: 'ADD_LIQUIDITY',
      application: 'NOT_APPLIED',
      actor: unknownValue('INSUFFICIENT_DATA'),
      proofKinds: ['EXECUTION_RECEIPT', 'TRANSACTION_INPUT'],
      evidenceIds: [evidence.id],
    });
    const report = buildActionSemanticsReport({
      snapshot,
      candidates: [candidate],
      evidence: [evidence],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 0,
    });
    expect(report.actions[0]).toMatchObject({
      primitive: { state: 'known', value: 'ADD_LIQUIDITY' },
      application: 'NOT_APPLIED',
      assetDeltas: [],
      findings: ['ACTOR_UNKNOWN', 'EXECUTION_NOT_APPLIED', 'INTENT_NOT_INFERRED'],
    });
  });

  it('rejects candidate Evidence outside the exact Snapshot ledger position', () => {
    const evidence = source('wrong-position');
    const candidate = createActionCandidate({
      ledger: 'EVM',
      chainId: 'eip155:56',
      transactionId: `0x${'44'.repeat(32)}`,
      blockOrSlot: '49999999',
      observedAt: evidence.observedAt,
      proposedKind: 'CONTRACT_CALL',
      application: 'UNKNOWN',
      actor: unknownValue('INSUFFICIENT_DATA'),
      proofKinds: ['TRANSACTION_INPUT'],
      evidenceIds: [evidence.id],
    });
    expect(() =>
      buildActionSemanticsReport({
        snapshot,
        candidates: [candidate],
        evidence: [evidence],
        dataCoverage: 0.5,
        sourceCoverage: 0.5,
        historyCoverage: 0,
      }),
    ).toThrow(/exact ledger identity/);
  });

  it('keeps report identity stable across candidate and Evidence input order', () => {
    const firstEvidence = source('order-a');
    const secondEvidence = source('order-b');
    const candidate = (transactionByte: string, evidenceId: string) =>
      createActionCandidate({
        ledger: 'EVM',
        chainId: 'eip155:56',
        transactionId: `0x${transactionByte.repeat(32)}`,
        blockOrSlot: snapshot.blockNumber,
        observedAt: '2026-08-12T00:00:09.000Z',
        proposedKind: 'CONTRACT_CALL',
        application: 'NOT_APPLIED',
        actor: unknownValue('INSUFFICIENT_DATA'),
        proofKinds: ['EXECUTION_RECEIPT', 'TRANSACTION_INPUT'],
        evidenceIds: [evidenceId],
      });
    const firstCandidate = candidate('55', firstEvidence.id);
    const secondCandidate = candidate('66', secondEvidence.id);
    const build = (
      candidates: Parameters<typeof buildActionSemanticsReport>[0]['candidates'],
      evidence: Parameters<typeof buildActionSemanticsReport>[0]['evidence'],
    ) =>
      buildActionSemanticsReport({
        snapshot,
        candidates,
        evidence,
        dataCoverage: 1,
        sourceCoverage: 1,
        historyCoverage: 0,
      });
    const forward = build([firstCandidate, secondCandidate], [firstEvidence, secondEvidence]);
    const reversed = build([secondCandidate, firstCandidate], [secondEvidence, firstEvidence]);
    expect(reversed.resultHash).toBe(forward.resultHash);
    expect(reversed.terminalEvidenceId).toBe(forward.terminalEvidenceId);
    expect(reversed.actions).toEqual(forward.actions);
  });

  it('canonicalizes transaction identities without collapsing ledger formats', () => {
    expect(canonicalActionTransactionId('EVM', `0x${'AB'.repeat(32)}`)).toBe(
      `0x${'ab'.repeat(32)}`,
    );
    expect(canonicalActionTransactionId('BITCOIN', 'CD'.repeat(32))).toBe('cd'.repeat(32));
    const signature =
      '4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9';
    expect(canonicalActionTransactionId('SOLANA', signature)).toBe(signature);
    expect(() => canonicalActionTransactionId('EVM', 'not-a-hash')).toThrow(/EVM transaction/);
    expect(() => canonicalActionTransactionId('BITCOIN', `0x${'11'.repeat(32)}`)).toThrow(
      /Bitcoin transaction/,
    );
  });

  it('recomputes the report result, storage identity and terminal Evidence deterministically', () => {
    const evidence = source('identity');
    const candidate = createActionCandidate({
      ledger: 'EVM',
      chainId: 'eip155:56',
      transactionId: `0x${'AA'.repeat(32)}`,
      blockOrSlot: snapshot.blockNumber,
      observedAt: evidence.observedAt,
      proposedKind: 'CONTRACT_CALL',
      application: 'NOT_APPLIED',
      actor: unknownValue('INSUFFICIENT_DATA'),
      proofKinds: ['TRANSACTION_INPUT', 'EXECUTION_RECEIPT'],
      evidenceIds: [evidence.id],
    });
    const report = buildActionSemanticsReport({
      snapshot,
      candidates: [candidate],
      evidence: [evidence],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 0,
    });
    expect(candidate.transactionId).toBe(`0x${'aa'.repeat(32)}`);
    expect(calculateActionSemanticsResultHash(report)).toBe(report.resultHash);
    expect(actionSemanticsReportId(report.resultHash)).toMatch(/^asr_[0-9a-f]{24}$/);
    expect(expectedActionSemanticsTerminalEvidence(report)).toEqual(
      report.evidence.find((item) => item.id === report.terminalEvidenceId),
    );

    const forged = {
      ...report,
      actions: report.actions.map((action) => ({
        ...action,
        primitive: knownValue('BURN' as const),
      })),
    };
    expect(() => calculateActionSemanticsResultHash(forged)).toThrow(/canonical candidate/);
  });
});
