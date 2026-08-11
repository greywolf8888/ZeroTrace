import { describe, expect, it, vi } from 'vitest';

import type { SolanaTransactionIntelligenceReport } from '@zerotrace/schemas';

import {
  PostgresSolanaTransactionReportRepository,
  SolanaTransactionReportStorageError,
} from './solana-transaction-reports.js';

const signature = '1'.repeat(64);
const account = '11111111111111111111111111111111';
const terminalEvidence = `ev_${'2'.repeat(24)}`;
const rawEvidence = `ev_${'1'.repeat(24)}`;
const capturedAt = '2026-08-11T05:00:01.000Z';
const blockhash = '3ySAYPQqMfpyZL6QhH4RzgT68HWpV72G2JAa2XWrpHEi';

function report(): SolanaTransactionIntelligenceReport {
  const snapshot = {
    ledger: 'SOLANA' as const,
    chainId: 'solana-mainnet' as const,
    slot: '100',
    blockhash,
    parentSlot: '99',
    previousBlockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
    commitment: 'finalized' as const,
    blockTimestamp: '2026-08-11T05:00:00.000Z',
    capturedAt,
    providerVersions: { fixture: 'solana-json-rpc' },
    adapterVersions: { solana: 'fixture' },
    configHash: 'd'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
  const unknownNotApplicable = { state: 'unknown' as const, reason: 'NOT_APPLICABLE' as const };
  const semantics = {
    signature,
    version: 'legacy' as const,
    recentBlockhash: account,
    execution: 'SUCCESS' as const,
    executionError: unknownNotApplicable,
    feePayer: { state: 'known' as const, value: account },
    signers: [account],
    requiredSignatureCount: 1,
    staticAccountCount: 1,
    loadedWritableAccountCount: 0,
    loadedReadonlyAccountCount: 0,
    accountResolutionComplete: { state: 'known' as const, value: true },
    accountCoverage: 1,
    recordingCoverage: 1,
    accounts: [
      {
        index: 0,
        address: account,
        source: 'STATIC' as const,
        signer: true,
        writable: true,
        feePayer: true,
        preBalanceLamports: { state: 'known' as const, value: '100' },
        postBalanceLamports: { state: 'known' as const, value: '95' },
        balanceDeltaLamports: { state: 'known' as const, value: '-5' },
      },
    ],
    addressTableLookups: [],
    outerInstructions: [],
    innerInstructionRecording: { state: 'known' as const, value: true },
    innerInstructions: [],
    cpiCount: { state: 'known' as const, value: 0 },
    programIds: [],
    officialProgramInstructionCount: 0,
    identifiedOfficialProgramInstructionCount: 0,
    officialProgramIdentificationCoverage: unknownNotApplicable,
    assetFlowCandidateCount: 0,
    assetFlowDecodeCoverage: unknownNotApplicable,
    assetFlowCoverage: unknownNotApplicable,
    assetFlows: [],
    tokenFlowReconciliation: {
      status: 'NOT_APPLICABLE' as const,
      expectedIdentityCount: 0,
      observedIdentityCount: 0,
      matchedIdentityCount: 0,
      conflictingIdentityCount: 0,
      unknownIdentityCount: 0,
      unmodeledTokenInstructionCount: 0,
      coverage: 1,
      recommendedMaxRelativeError: 0 as const,
      observedRelativeError: unknownNotApplicable,
      detail: 'No modeled token flow exists in this fixture.',
    },
    tokenBalanceRecording: { state: 'known' as const, value: true },
    tokenBalanceChanges: [],
    computeUnitsConsumed: { state: 'unknown' as const, reason: 'INSUFFICIENT_DATA' as const },
    logRecording: { state: 'known' as const, value: true },
    logCount: { state: 'known' as const, value: 0 },
    modelVersion: 'solana-transaction-semantics-v1.1.0' as const,
  };
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
      confidence: 0.9,
    },
    facts: {
      status: { state: 'known', value: 'CONFIRMED' },
      slot: { state: 'known', value: '100' },
      blockTime: { state: 'known', value: '2023-11-14T22:13:20.000Z' },
      version: { state: 'known', value: 'legacy' },
      feeLamports: { state: 'known', value: '5' },
      execution: { state: 'known', value: 'SUCCESS' },
      transactionSemantics: { state: 'known', value: semantics },
      feePayer: semantics.feePayer,
      signerCount: { state: 'known', value: 1 },
      outerInstructionCount: { state: 'known', value: 0 },
      cpiCount: semantics.cpiCount,
      accountResolutionComplete: semantics.accountResolutionComplete,
      tokenBalanceChangeCount: { state: 'known', value: 0 },
      coreAssetFlowCount: { state: 'known', value: 0 },
      tokenFlowReconciliation: { state: 'known', value: semantics.tokenFlowReconciliation },
    },
    terminalEvidenceId: terminalEvidence,
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: capturedAt,
      sourceSet: ['fixture'],
      modelVersion: 'solana-transaction-query-v1.1.0',
      confidence: 0.95,
      evidenceIds: [rawEvidence, terminalEvidence],
    },
    evidence: [
      {
        id: rawEvidence,
        ledger: 'SOLANA',
        chainId: 'solana-mainnet',
        kind: 'TRANSACTION',
        source: 'fixture',
        locator: `transaction:${signature}@100`,
        payloadHash: 'a'.repeat(64),
        observedAt: capturedAt,
        blockOrSlot: '100',
        finality: 'finalized',
        summary: 'Fixture transaction.',
      },
      {
        id: terminalEvidence,
        ledger: 'SOLANA',
        chainId: 'solana-mainnet',
        kind: 'DERIVED_FEATURE',
        source: 'zerotrace:solana-transaction-semantics-v1.1.0',
        locator: `transaction-semantics:${signature}@100`,
        payloadHash: 'b'.repeat(64),
        observedAt: capturedAt,
        blockOrSlot: '100',
        finality: 'finalized',
        summary: 'Fixture transaction semantics.',
      },
    ],
  };
}

function storedRow(values: readonly unknown[]): Record<string, unknown> {
  return {
    id: values[0],
    chain_id: values[1],
    signature: values[2],
    snapshot_slot: values[3],
    snapshot_hash: values[4],
    result_hash: values[5],
    report: values[6],
    terminal_evidence_id: values[7],
    evidence_ids: values[8],
    source_set: values[9],
    model_version: values[10],
    captured_at: values[11],
    created_at: '2026-08-11T05:00:02.000Z',
  };
}

describe('Postgres Solana transaction report repository', () => {
  it('writes once and replays the immutable latest report', async () => {
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO solana_transaction_reports')) {
        row ??= storedRow(values);
        return { rows: [], rowCount: 1 };
      }
      return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
    });
    const repository = PostgresSolanaTransactionReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    const first = await repository.put(report());
    const second = await repository.put(report());
    const latest = await repository.latest(signature);

    expect(first.id).toMatch(/^str_[0-9a-f]{24}$/);
    expect(second).toEqual(first);
    expect(latest).toEqual(first);
    expect(first).toMatchObject({
      signature,
      snapshotSlot: '100',
      terminalEvidenceId: terminalEvidence,
      capturedAt,
    });
    expect(query.mock.calls.filter(([text]) => String(text).includes('INSERT INTO'))).toHaveLength(
      1,
    );
  });

  it('rejects conflicting identity and corrupt replay content', async () => {
    const invalid = report();
    invalid.subject.normalizedId = '2'.repeat(64);
    const repository = PostgresSolanaTransactionReportRepository.fromPool({
      query: vi.fn(),
      end: vi.fn(),
    });
    await expect(repository.put(invalid)).rejects.toMatchObject({
      code: 'SOLANA_TRANSACTION_REPORT_INVALID',
    });

    let corruptRow: Record<string, unknown> | undefined;
    const corrupt = PostgresSolanaTransactionReportRepository.fromPool({
      query: vi.fn(async (text: string, values: readonly unknown[] = []) => {
        if (text.includes('INSERT INTO solana_transaction_reports')) {
          corruptRow = { ...storedRow(values), result_hash: '0'.repeat(64) };
          return { rows: [], rowCount: 1 };
        }
        return {
          rows: corruptRow === undefined ? [] : [corruptRow],
          rowCount: corruptRow === undefined ? 0 : 1,
        };
      }),
      end: vi.fn(),
    });
    await expect(corrupt.put(report())).rejects.toBeInstanceOf(SolanaTransactionReportStorageError);
    await expect(corrupt.put(report())).rejects.toMatchObject({
      code: 'SOLANA_TRANSACTION_REPORT_CONFLICT',
    });
  });

  it('checks migration health and validates lookup identities before querying', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ table_name: 'solana_transaction_reports', migration_applied: true }],
      rowCount: 1,
    });
    const repository = PostgresSolanaTransactionReportRepository.fromPool({
      query,
      end: vi.fn(),
    });
    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'SOLANA_TRANSACTION_REPORT_INVALID',
    });
    await expect(repository.latest('invalid')).rejects.toMatchObject({
      code: 'SOLANA_TRANSACTION_REPORT_INVALID',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
