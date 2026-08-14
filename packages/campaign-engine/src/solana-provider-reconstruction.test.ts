import { describe, expect, it } from 'vitest';

import { createEvidence } from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type Evidence,
  type SolanaAssetFlow,
  type SolanaTransactionIntelligenceReport,
} from '@zerotrace/schemas';

import { buildSolanaDealerCampaign } from './solana-provider-reconstruction.js';

const mint = 'So11111111111111111111111111111111111111112';
const ownerA = '11111111111111111111111111111111';
const ownerB = '22222222222222222222222222222222';
const pdaOwner = '2iJm4RM5JdVfq8zfazk1zT6QqpqFZFSoN6G8T5YGy5JN';
const accountA = '33333333333333333333333333333333';
const accountB = '44444444444444444444444444444444';
const pdaAccount = '66666666666666666666666666666666';
const funder = '55555555555555555555555555555555';
const blockhash100 = '3ySAYPQqMfpyZL6QhH4RzgT68HWpV72G2JAa2XWrpHEi';
const blockhash101 = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi';
const capturedAt = '2026-08-14T03:00:00.000Z';

function snapshot(slot: string, blockhash: string): AnalysisSnapshot {
  return {
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    slot,
    blockhash,
    parentSlot: slot === '100' ? '99' : '100',
    previousBlockhash: blockhash100,
    commitment: 'finalized',
    blockTimestamp: capturedAt,
    capturedAt,
    providerVersions: { fixture: 'solana-json-rpc' },
    adapterVersions: { solana: 'fixture' },
    configHash: 'a'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
}

const notApplicable = unknownValue('NOT_APPLICABLE', 'The field is not applicable to this flow.');

function flowEvidence(signature: string, flow: SolanaAssetFlow): Evidence {
  return createEvidence({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    kind: 'DERIVED_FEATURE',
    source: 'fixture:solana-semantics',
    locator: `asset-flow:${signature}:${flow.id}@${signature === '1'.repeat(64) ? '100' : '101'}`,
    payload: flow,
    observedAt: capturedAt,
    blockOrSlot: signature === '1'.repeat(64) ? '100' : '101',
    finality: 'finalized',
    summary: 'Fixture Solana asset flow.',
  });
}

function tokenFlow(
  id: string,
  flowKind: SolanaAssetFlow['flowKind'],
  sourceAccount: SolanaAssetFlow['sourceAccount'],
  destinationAccount: SolanaAssetFlow['destinationAccount'],
  sourceOwner: SolanaAssetFlow['sourceOwner'],
  destinationOwner: SolanaAssetFlow['destinationOwner'],
  amount: string,
): SolanaAssetFlow {
  return {
    id,
    instructionPath: 'outer:0',
    programFamily: 'SPL_TOKEN',
    instructionName: flowKind === 'MINT' ? 'MintTo' : 'Transfer',
    application: 'APPLIED',
    flowKind,
    assetKind: 'SPL_TOKEN',
    sourceAccount,
    destinationAccount,
    sourceOwner,
    destinationOwner,
    mint: knownValue(mint),
    authority: knownValue(ownerA),
    amount: knownValue(amount),
    decimals: knownValue(9),
    expectedFeeAmount: knownValue('0'),
    expectedRecipientAmount: knownValue(amount),
  };
}

function solTransfer(id: string, amount: string): SolanaAssetFlow {
  return {
    id,
    instructionPath: 'outer:1',
    programFamily: 'SYSTEM',
    instructionName: 'TransferSol',
    application: 'APPLIED',
    flowKind: 'TRANSFER',
    assetKind: 'NATIVE_SOL',
    sourceAccount: knownValue(funder),
    destinationAccount: knownValue(ownerA),
    sourceOwner: notApplicable,
    destinationOwner: notApplicable,
    mint: notApplicable,
    authority: knownValue(funder),
    amount: knownValue(amount),
    decimals: knownValue(9),
    expectedFeeAmount: knownValue('0'),
    expectedRecipientAmount: knownValue(amount),
  };
}

function report(
  signature: string,
  slot: string,
  blockhash: string,
  flows: readonly SolanaAssetFlow[],
): SolanaTransactionIntelligenceReport {
  const transactionEvidence = createEvidence({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    kind: 'TRANSACTION',
    source: 'fixture:solana-rpc',
    locator: `transaction:${signature}@${slot}`,
    payload: { signature, slot },
    observedAt: capturedAt,
    blockOrSlot: slot,
    finality: 'finalized',
    summary: 'Fixture Solana transaction.',
  });
  const flowEvidenceValues = flows.map((flow) => flowEvidence(signature, flow));
  const terminal = createEvidence({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    kind: 'DERIVED_FEATURE',
    source: 'fixture:solana-semantics',
    locator: `transaction-semantics:${signature}@${slot}`,
    payload: { signature, flows },
    observedAt: capturedAt,
    blockOrSlot: slot,
    finality: 'finalized',
    summary: 'Fixture Solana transaction semantics.',
  });
  return {
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    signature,
    subject: {
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      type: 'TRANSACTION',
      id: signature,
      normalizedId: signature,
      validation: 'STRUCTURALLY_VALID',
      confidence: 1,
    },
    facts: {
      transactionSemantics: { state: 'known', value: { assetFlows: flows } },
    },
    metadata: { snapshot: snapshot(slot, blockhash) },
    terminalEvidenceId: terminal.id,
    evidence: [transactionEvidence, ...flowEvidenceValues, terminal],
  } as unknown as SolanaTransactionIntelligenceReport;
}

describe('Solana dealer provider reconstruction', () => {
  it('keeps token accounts distinct from owners and materializes bounded funding/settlement evidence', () => {
    const signature100 = '1'.repeat(64);
    const signature101 = '2'.repeat(64);
    const mintA = tokenFlow(
      'outer:0:flow:0',
      'MINT',
      notApplicable,
      knownValue(accountA),
      notApplicable,
      knownValue(ownerA),
      '100',
    );
    const mintB = tokenFlow(
      'outer:0:flow:0',
      'MINT',
      notApplicable,
      knownValue(accountB),
      notApplicable,
      knownValue(ownerB),
      '50',
    );
    const mintPda = tokenFlow(
      'outer:0:flow:1',
      'MINT',
      notApplicable,
      knownValue(pdaAccount),
      notApplicable,
      knownValue(pdaOwner),
      '10',
    );
    const transfer = tokenFlow(
      'outer:0:flow:0',
      'TRANSFER',
      knownValue(accountA),
      knownValue(accountB),
      knownValue(ownerA),
      knownValue(ownerB),
      '25',
    );
    const result = buildSolanaDealerCampaign({
      mint,
      fromSlot: '100',
      toSlot: '101',
      snapshot: snapshot('101', blockhash101),
      transactions: [
        {
          report: report(signature100, '100', blockhash100, [
            mintA,
            mintB,
            mintPda,
            solTransfer('outer:1:flow:0', '7'),
          ]),
          transactionIndex: '0',
        },
        {
          report: report(signature101, '101', blockhash101, [
            transfer,
            solTransfer('outer:1:flow:0', '9'),
          ]),
          transactionIndex: '1',
        },
      ],
      rangeEvidence: [
        createEvidence({
          ledger: 'SOLANA',
          chainId: 'solana-mainnet',
          kind: 'BLOCK',
          source: 'fixture:sqd',
          locator: `block:101:${blockhash101}`,
          payload: { slot: '101', blockhash: blockhash101 },
          observedAt: capturedAt,
          blockOrSlot: '101',
          finality: 'finalized',
          summary: 'Fixture finalized range anchor.',
        }),
      ],
      sourceSet: ['fixture:sqd', 'fixture:solana-rpc'],
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 0,
    });

    expect(result.report.status).toBe('COMPLETE');
    expect(result.report.campaign).not.toBeNull();
    expect(result.report.holders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owner: ownerA, tokenAccounts: [accountA] }),
        expect.objectContaining({ owner: ownerB, tokenAccounts: [accountB] }),
      ]),
    );
    expect(result.report.fundingEdges.length).toBeGreaterThan(0);
    expect(result.report.settlementEdges.length).toBeGreaterThan(0);
    expect(result.report.pdaSuppressedOwnerIds).toEqual([pdaOwner]);
    expect(result.report.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'zerotrace:forensic-evidence-v1.0.0',
          summary: expect.stringContaining('Off-curve Solana owner accounts'),
        }),
      ]),
    );
    expect(result.report.campaign?.campaign.coreWalletIds).toContain(ownerA);
    expect(result.report.campaign?.campaign.coreWalletIds).not.toContain(pdaOwner);
    expect(result.report.evidenceIds).toEqual(
      [...new Set(result.report.evidence.map((evidence) => evidence.id))].sort(),
    );
    expect(result.report.resultHash).toHaveLength(64);
  });

  it('does not promote truncated candidate coverage to a complete campaign', () => {
    const signature = '1'.repeat(64);
    const flow = tokenFlow(
      'outer:0:flow:0',
      'MINT',
      notApplicable,
      knownValue(accountA),
      notApplicable,
      knownValue(ownerA),
      '1',
    );
    const result = buildSolanaDealerCampaign({
      mint,
      fromSlot: '100',
      toSlot: '100',
      snapshot: snapshot('100', blockhash100),
      transactions: [
        { report: report(signature, '100', blockhash100, [flow]), transactionIndex: '0' },
      ],
      rangeEvidence: [
        createEvidence({
          ledger: 'SOLANA',
          chainId: 'solana-mainnet',
          kind: 'BLOCK',
          source: 'fixture:sqd',
          locator: `block:100:${blockhash100}`,
          payload: { slot: '100' },
          observedAt: capturedAt,
          blockOrSlot: '100',
          finality: 'finalized',
          summary: 'Fixture range.',
        }),
      ],
      sourceSet: ['fixture:sqd'],
      dataCoverage: 0.5,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      allowComplete: false,
    });
    expect(result.report.status).toBe('PARTIAL');
    expect(result.report.campaign).toBeNull();
  });
});
