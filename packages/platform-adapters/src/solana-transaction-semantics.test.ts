import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import {
  TOKEN_PROGRAM_ADDRESS,
  getBurnCheckedInstructionDataEncoder,
  getMintToCheckedInstructionDataEncoder,
  getTransferCheckedInstructionDataEncoder,
} from '@solana-program/token';
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  getTransferCheckedInstructionDataEncoder as getToken2022TransferCheckedInstructionDataEncoder,
  getTransferCheckedWithFeeInstructionDataEncoder,
} from '@solana-program/token-2022';

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

function encoded(data: ArrayLike<number>): string {
  return bs58.encode(Uint8Array.from(data));
}

function tokenTransaction(options: {
  programId?: string;
  data: ArrayLike<number>;
  amountBefore?: string;
  amountAfter?: string;
  destinationBefore?: string;
  destinationAfter?: string;
  success?: boolean;
  sourceOwner?: string;
  destinationOwner?: string;
}): SolanaTransactionRecord {
  const mint = key(22);
  const source = key(23);
  const destination = key(24);
  const authority = key(25);
  const programId = options.programId ?? String(TOKEN_PROGRAM_ADDRESS);
  return transaction({
    version: 'legacy',
    signatures: [signature(9)],
    header: {
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: 3,
    },
    staticAccountKeys: [key(1), source, mint, destination, authority, programId],
    addressTableLookups: [],
    instructions: [
      {
        accounts: [1, 2, 3, 4],
        data: encoded(options.data),
        programIdIndex: 5,
        stackHeight: 1,
      },
    ],
    success: options.success ?? true,
    loadedAddresses: { writable: [], readonly: [] },
    innerInstructions: [],
    preBalances: ['100000', '2039280', '1461600', '2039280', '1', '1'],
    postBalances: ['95000', '2039280', '1461600', '2039280', '1', '1'],
    preTokenBalances: [
      {
        accountIndex: 1,
        mint,
        ...(options.sourceOwner === undefined ? {} : { owner: options.sourceOwner }),
        programId,
        amount: options.amountBefore ?? '100',
        decimals: 6,
      },
      {
        accountIndex: 3,
        mint,
        ...(options.destinationOwner === undefined ? {} : { owner: options.destinationOwner }),
        programId,
        amount: options.destinationBefore ?? '10',
        decimals: 6,
      },
    ],
    postTokenBalances: [
      {
        accountIndex: 1,
        mint,
        ...(options.sourceOwner === undefined ? {} : { owner: options.sourceOwner }),
        programId,
        amount: options.amountAfter ?? '60',
        decimals: 6,
      },
      {
        accountIndex: 3,
        mint,
        ...(options.destinationOwner === undefined ? {} : { owner: options.destinationOwner }),
        programId,
        amount: options.destinationAfter ?? '50',
        decimals: 6,
      },
    ],
  });
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
    expect(result.recordingCoverage).toBeCloseTo(5 / 6);
  });

  it('decodes an applied SPL TransferChecked into owner-aware flow and exact atomic reconciliation', () => {
    const sourceOwner = key(26);
    const destinationOwner = key(27);
    const result = analyzeSolanaTransactionSemantics(
      tokenTransaction({
        data: getTransferCheckedInstructionDataEncoder().encode({ amount: 40n, decimals: 6 }),
        sourceOwner,
        destinationOwner,
      }),
    );

    expect(result.outerInstructions[0]?.programSemantic).toEqual({
      state: 'known',
      value: {
        programFamily: 'SPL_TOKEN',
        instructionName: 'TransferChecked',
        category: 'ASSET_TRANSFER',
        application: 'APPLIED',
      },
    });
    expect(result.assetFlows).toEqual([
      expect.objectContaining({
        instructionPath: 'outer:0',
        flowKind: 'TRANSFER',
        assetKind: 'SPL_TOKEN',
        amount: { state: 'known', value: '40' },
        decimals: { state: 'known', value: 6 },
        sourceOwner: { state: 'known', value: sourceOwner },
        destinationOwner: { state: 'known', value: destinationOwner },
        expectedFeeAmount: { state: 'known', value: '0' },
        expectedRecipientAmount: { state: 'known', value: '40' },
      }),
    ]);
    expect(result.assetFlowDecodeCoverage).toEqual({ state: 'known', value: 1 });
    expect(result.assetFlowCoverage).toEqual({ state: 'known', value: 1 });
    expect(result.tokenFlowReconciliation).toMatchObject({
      status: 'MATCHED',
      expectedIdentityCount: 2,
      matchedIdentityCount: 2,
      conflictingIdentityCount: 0,
      unknownIdentityCount: 0,
      recommendedMaxRelativeError: 0,
      observedRelativeError: { state: 'known', value: 0 },
    });
  });

  it('keeps Token-2022 net output Unknown without mint extension state', () => {
    const result = analyzeSolanaTransactionSemantics(
      tokenTransaction({
        programId: String(TOKEN_2022_PROGRAM_ADDRESS),
        data: getToken2022TransferCheckedInstructionDataEncoder().encode({
          amount: 20n,
          decimals: 6,
        }),
        amountAfter: '80',
        destinationAfter: '28',
        sourceOwner: key(26),
        destinationOwner: key(27),
      }),
    );

    expect(result.assetFlows[0]).toMatchObject({
      programFamily: 'TOKEN_2022',
      amount: { state: 'known', value: '20' },
      expectedFeeAmount: { state: 'unknown', reason: 'NOT_QUERIED' },
      expectedRecipientAmount: { state: 'unknown', reason: 'NOT_QUERIED' },
    });
    expect(result.assetFlowCoverage).toEqual({ state: 'known', value: 0.8 });
    expect(result.tokenFlowReconciliation).toMatchObject({
      status: 'PARTIAL',
      matchedIdentityCount: 1,
      unknownIdentityCount: 1,
      recommendedMaxRelativeError: 0,
      observedRelativeError: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
  });

  it('uses the explicit Token-2022 expected fee for exact recipient reconciliation', () => {
    const result = analyzeSolanaTransactionSemantics(
      tokenTransaction({
        programId: String(TOKEN_2022_PROGRAM_ADDRESS),
        data: getTransferCheckedWithFeeInstructionDataEncoder().encode({
          amount: 20n,
          decimals: 6,
          fee: 2n,
        }),
        amountAfter: '80',
        destinationAfter: '28',
        sourceOwner: key(26),
        destinationOwner: key(27),
      }),
    );

    expect(result.assetFlows[0]).toMatchObject({
      instructionName: 'TransferCheckedWithFee',
      expectedFeeAmount: { state: 'known', value: '2' },
      expectedRecipientAmount: { state: 'known', value: '18' },
    });
    expect(result.tokenFlowReconciliation).toMatchObject({
      status: 'MATCHED',
      matchedIdentityCount: 2,
      observedRelativeError: { state: 'known', value: 0 },
    });
  });

  it('fails the zero-tolerance audit when a recorded atomic delta differs', () => {
    const result = analyzeSolanaTransactionSemantics(
      tokenTransaction({
        data: getTransferCheckedInstructionDataEncoder().encode({ amount: 40n, decimals: 6 }),
        destinationAfter: '49',
        sourceOwner: key(26),
        destinationOwner: key(27),
      }),
    );

    expect(result.tokenFlowReconciliation).toMatchObject({
      status: 'CONFLICT',
      matchedIdentityCount: 1,
      conflictingIdentityCount: 1,
      recommendedMaxRelativeError: 0,
      observedRelativeError: { state: 'known', value: 0.0125 },
    });
  });

  it('marks decoded asset intent as not applied when the transaction failed', () => {
    const result = analyzeSolanaTransactionSemantics(
      tokenTransaction({
        data: getTransferCheckedInstructionDataEncoder().encode({ amount: 40n, decimals: 6 }),
        success: false,
        amountAfter: '100',
        destinationAfter: '10',
        sourceOwner: key(26),
        destinationOwner: key(27),
      }),
    );

    expect(result.assetFlows[0]).toMatchObject({
      application: 'NOT_APPLIED',
      amount: { state: 'known', value: '40' },
    });
    expect(result.tokenFlowReconciliation).toMatchObject({
      status: 'MATCHED',
      matchedIdentityCount: 2,
      observedRelativeError: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    });
  });

  it('rejects a truncated official asset instruction without fabricating a flow', () => {
    const result = analyzeSolanaTransactionSemantics(
      tokenTransaction({
        data: Uint8Array.of(12),
        sourceOwner: key(26),
        destinationOwner: key(27),
      }),
    );

    expect(result.outerInstructions[0]?.programSemantic).toMatchObject({
      state: 'unknown',
      reason: 'INVALID_INPUT',
    });
    expect(result.officialProgramInstructionCount).toBe(1);
    expect(result.identifiedOfficialProgramInstructionCount).toBe(0);
    expect(result.assetFlowCandidateCount).toBe(1);
    expect(result.assetFlowDecodeCoverage).toEqual({ state: 'known', value: 0 });
    expect(result.assetFlows).toEqual([]);
  });

  it('decodes mint and burn CPI effects without treating token accounts as independent owners', () => {
    const mint = key(22);
    const tokenAccount = key(23);
    const owner = key(26);
    const result = analyzeSolanaTransactionSemantics(
      transaction({
        signatures: [signature(9)],
        header: {
          numRequiredSignatures: 1,
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 3,
        },
        staticAccountKeys: [key(1), tokenAccount, mint, key(25), String(TOKEN_PROGRAM_ADDRESS)],
        addressTableLookups: [],
        instructions: [
          {
            accounts: [2, 1, 3],
            data: encoded(
              getMintToCheckedInstructionDataEncoder().encode({ amount: 50n, decimals: 6 }),
            ),
            programIdIndex: 4,
            stackHeight: 1,
          },
        ],
        loadedAddresses: { writable: [], readonly: [] },
        innerInstructions: [
          {
            index: 0,
            instructions: [
              {
                accounts: [1, 2, 3],
                data: encoded(
                  getBurnCheckedInstructionDataEncoder().encode({ amount: 20n, decimals: 6 }),
                ),
                programIdIndex: 4,
                stackHeight: 2,
              },
            ],
          },
        ],
        preBalances: ['100000', '2039280', '1461600', '1', '1'],
        postBalances: ['95000', '2039280', '1461600', '1', '1'],
        preTokenBalances: [
          {
            accountIndex: 1,
            mint,
            owner,
            programId: String(TOKEN_PROGRAM_ADDRESS),
            amount: '100',
            decimals: 6,
          },
        ],
        postTokenBalances: [
          {
            accountIndex: 1,
            mint,
            owner,
            programId: String(TOKEN_PROGRAM_ADDRESS),
            amount: '130',
            decimals: 6,
          },
        ],
      }),
    );

    expect(result.assetFlows.map((flow) => [flow.flowKind, flow.application])).toEqual([
      ['MINT', 'APPLIED'],
      ['BURN', 'APPLIED'],
    ]);
    expect(result.assetFlows[0]?.destinationOwner).toEqual({ state: 'known', value: owner });
    expect(result.assetFlows[1]?.sourceOwner).toEqual({ state: 'known', value: owner });
    expect(result.tokenFlowReconciliation).toMatchObject({
      status: 'MATCHED',
      expectedIdentityCount: 1,
      matchedIdentityCount: 1,
    });
  });
});
