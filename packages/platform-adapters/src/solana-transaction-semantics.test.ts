import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';

import type { SolanaTransactionRecord } from '@zerotrace/chain-adapters';

import { analyzeSolanaTransactionSemantics } from './solana-transaction-semantics.js';

function key(seed: number): string {
  return bs58.encode(Buffer.alloc(32, seed));
}

function signature(seed: number): string {
  return bs58.encode(Buffer.alloc(64, seed));
}

function transaction(overrides: Partial<SolanaTransactionRecord> = {}): SolanaTransactionRecord {
  return {
    signature: signature(9),
    signatures: [signature(9), signature(8)],
    slot: '400000000',
    blockTime: '2026-08-11T00:00:00.000Z',
    version: '0',
    recentBlockhash: key(7),
    header: {
      numRequiredSignatures: 2,
      numReadonlySignedAccounts: 1,
      numReadonlyUnsignedAccounts: 1,
    },
    staticAccountKeys: [key(1), key(2), key(3), key(4)],
    addressTableLookups: [{ accountKey: key(5), writableIndexes: [1], readonlyIndexes: [2] }],
    instructions: [{ accounts: [0, 4], data: '', programIdIndex: 3, stackHeight: 1 }],
    feeLamports: '5000',
    success: true,
    loadedAddresses: { writable: [key(6)], readonly: [key(10)] },
    innerInstructions: [
      {
        index: 0,
        instructions: [{ accounts: [4, 0], data: '1', programIdIndex: 5, stackHeight: 2 }],
      },
    ],
    preBalances: ['100000', '2', '3', '4', '5', '6'],
    postBalances: ['95000', '2', '3', '4', '5', '6'],
    preTokenBalances: [
      {
        accountIndex: 4,
        mint: key(11),
        owner: key(1),
        programId: key(12),
        amount: '100',
        decimals: 6,
      },
    ],
    postTokenBalances: [
      {
        accountIndex: 4,
        mint: key(11),
        owner: key(1),
        programId: key(12),
        amount: '70',
        decimals: 6,
      },
    ],
    logMessages: ['Program invoke [1]', 'Program success'],
    computeUnitsConsumed: '2100',
    raw: {},
    ...overrides,
  };
}

describe('Solana transaction semantics', () => {
  it('resolves v0 loaded accounts, signer/writable flags, CPI and exact balance deltas', () => {
    const result = analyzeSolanaTransactionSemantics(transaction());

    expect(result).toMatchObject({
      execution: 'SUCCESS',
      feePayer: { state: 'known', value: key(1) },
      signers: [key(1), key(2)],
      requiredSignatureCount: 2,
      staticAccountCount: 4,
      loadedWritableAccountCount: 1,
      loadedReadonlyAccountCount: 1,
      accountResolutionComplete: { state: 'known', value: true },
      accountCoverage: 1,
      recordingCoverage: 1,
      innerInstructionRecording: { state: 'known', value: true },
      cpiCount: { state: 'known', value: 1 },
      tokenBalanceRecording: { state: 'known', value: true },
      computeUnitsConsumed: { state: 'known', value: '2100' },
      logCount: { state: 'known', value: 2 },
    });
    expect(
      result.accounts.map(({ source, signer, writable, feePayer }) => ({
        source,
        signer,
        writable,
        feePayer,
      })),
    ).toEqual([
      { source: 'STATIC', signer: true, writable: true, feePayer: true },
      { source: 'STATIC', signer: true, writable: false, feePayer: false },
      { source: 'STATIC', signer: false, writable: true, feePayer: false },
      { source: 'STATIC', signer: false, writable: false, feePayer: false },
      { source: 'LOOKUP_WRITABLE', signer: false, writable: true, feePayer: false },
      { source: 'LOOKUP_READONLY', signer: false, writable: false, feePayer: false },
    ]);
    expect(result.accounts[0]?.balanceDeltaLamports).toEqual({
      state: 'known',
      value: '-5000',
    });
    expect(result.outerInstructions[0]).toMatchObject({
      path: 'outer:0',
      programId: { state: 'known', value: key(4) },
      accounts: { state: 'known', value: [key(1), key(6)] },
    });
    expect(result.innerInstructions[0]).toMatchObject({
      path: 'outer:0/inner:0',
      programId: { state: 'known', value: key(10) },
    });
    expect(result.tokenBalanceChanges).toEqual([
      expect.objectContaining({
        account: { state: 'known', value: key(6) },
        preAmount: { state: 'known', value: '100' },
        postAmount: { state: 'known', value: '70' },
        deltaAmount: { state: 'known', value: '-30' },
      }),
    ]);
  });

  it('keeps loaded account and instruction resolution Unknown when v0 metadata is absent', () => {
    const incomplete = transaction({
      staticAccountKeys: [key(1), key(2)],
      signatures: [signature(9)],
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 1,
      },
      addressTableLookups: [{ accountKey: key(5), writableIndexes: [1], readonlyIndexes: [2] }],
      instructions: [{ accounts: [0, 2], data: '', programIdIndex: 3 }],
    });
    delete incomplete.loadedAddresses;
    delete incomplete.innerInstructions;
    delete incomplete.preBalances;
    delete incomplete.postBalances;
    const result = analyzeSolanaTransactionSemantics(incomplete);

    expect(result.accountResolutionComplete).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(result.accountCoverage).toBe(0.5);
    expect(result.recordingCoverage).toBeCloseTo(2 / 3);
    expect(result.outerInstructions[0]).toMatchObject({
      programId: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      accounts: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(result.cpiCount).toMatchObject({ state: 'unknown', reason: 'INSUFFICIENT_DATA' });
  });

  it('preserves failed execution Evidence without treating the error as absence', () => {
    const result = analyzeSolanaTransactionSemantics(
      transaction({
        success: false,
        executionError: { InstructionError: [0, 'Custom'] },
      }),
    );

    expect(result.execution).toBe('FAILED');
    expect(result.executionError).toEqual({
      state: 'known',
      value: { InstructionError: [0, 'Custom'] },
    });
  });

  it('does not coerce an unrecorded side of a token balance into zero', () => {
    const result = analyzeSolanaTransactionSemantics(
      transaction({
        preTokenBalances: [],
      }),
    );

    expect(result.tokenBalanceChanges[0]).toMatchObject({
      preAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      postAmount: { state: 'known', value: '70' },
      deltaAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
  });
});
