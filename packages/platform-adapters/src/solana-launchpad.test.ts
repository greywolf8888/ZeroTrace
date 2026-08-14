import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import type { SolanaSnapshot, SolanaTransactionRecord } from '@zerotrace/chain-adapters';
import { hashPayload } from '@zerotrace/evidence';
import { knownValue, unknownValue, type SolanaInstructionObservation } from '@zerotrace/schemas';

import {
  decodePumpLaunchpadInstruction,
  PUMP_PROGRAM_ID,
  pumpLaunchpadProgramIds,
  SOLANA_PUMP_LAUNCHPAD_MODEL_VERSION,
} from './solana-launchpad.js';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const SIGNATURE = '1'.repeat(64);

function snapshot(): SolanaSnapshot {
  return {
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    slot: '42',
    blockhash: bs58.encode(new Uint8Array(32).fill(1)),
    parentSlot: '41',
    previousBlockhash: bs58.encode(new Uint8Array(32).fill(2)),
    commitment: 'finalized',
    capturedAt: '2026-08-14T00:00:00.000Z',
    providerVersions: { 'test-solana': 'test' },
    adapterVersions: { solana: 'test' },
    configHash: hashPayload('solana-launchpad-test-config'),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-empty-v1',
  };
}

function transaction(): SolanaTransactionRecord {
  return {
    signature: SIGNATURE,
    signatures: [SIGNATURE],
    slot: '42',
    version: 'legacy',
    recentBlockhash: bs58.encode(new Uint8Array(32).fill(3)),
    header: {
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: 0,
    },
    staticAccountKeys: [PUMP_PROGRAM_ID, SYSTEM_PROGRAM_ID],
    addressTableLookups: [],
    instructions: [],
    success: true,
    raw: {},
  };
}

function instruction(
  dataBase58: string,
  programId: string = PUMP_PROGRAM_ID,
): SolanaInstructionObservation {
  return {
    path: 'outer:0',
    outerIndex: 0,
    innerIndex: unknownValue('NOT_APPLICABLE', 'Outer instruction.'),
    stackHeight: unknownValue('INSUFFICIENT_DATA', 'Test fixture does not include stack height.'),
    programIdIndex: 0,
    programId: knownValue(programId),
    accountIndexes: [1],
    accounts: knownValue([SYSTEM_PROGRAM_ID]),
    dataBase58,
    programSemantic: unknownValue('NOT_QUERIED', 'Launchpad decoder test input.'),
  };
}

function buyV2Data(amount: bigint, maxCost: bigint): string {
  const data = new Uint8Array(24);
  data.set([184, 23, 238, 97, 103, 197, 211, 61]);
  new DataView(data.buffer).setBigUint64(8, amount, true);
  new DataView(data.buffer).setBigUint64(16, maxCost, true);
  return bs58.encode(data);
}

describe('Solana Pump launchpad decoder', () => {
  it('decodes the pinned official buy_v2 discriminator and preserves decimal arguments', () => {
    const decoded = decodePumpLaunchpadInstruction({
      instruction: instruction(buyV2Data(123n, 456n)),
      transaction: transaction(),
      snapshot: snapshot(),
      evidenceIds: [`ev_${'a'.repeat(24)}`, `ev_${'b'.repeat(24)}`],
    });

    expect(decoded).toBeDefined();
    expect(decoded?.platform).toBe('PUMP');
    expect(decoded?.instructionName).toBe('buy_v2');
    expect(decoded?.instructionVersion).toBe('V2');
    expect(decoded?.decodedArguments).toEqual([
      { name: 'amount', value: '123' },
      { name: 'max_sol_cost', value: '456' },
    ]);
    expect(decoded?.execution).toBe('SUCCESS');
    expect(decoded?.accountCoverage).toBe(1 / 27);
    expect(decoded?.evidenceIds).toEqual([`ev_${'a'.repeat(24)}`, `ev_${'b'.repeat(24)}`]);
    expect(decoded?.resultHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not classify an unknown program or discriminator as Pump evidence', () => {
    expect(
      decodePumpLaunchpadInstruction({
        instruction: instruction(buyV2Data(1n, 2n), SYSTEM_PROGRAM_ID),
        transaction: transaction(),
        snapshot: snapshot(),
        evidenceIds: [`ev_${'a'.repeat(24)}`],
      }),
    ).toBeUndefined();

    const unknownData = bs58.encode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(
      decodePumpLaunchpadInstruction({
        instruction: instruction(unknownData),
        transaction: transaction(),
        snapshot: snapshot(),
        evidenceIds: [`ev_${'a'.repeat(24)}`],
      }),
    ).toBeUndefined();
  });

  it('exposes the model and both official program identities without enabling write paths', () => {
    expect(SOLANA_PUMP_LAUNCHPAD_MODEL_VERSION).toBe('solana-pump-launchpad-v1.0.0');
    expect(pumpLaunchpadProgramIds()).toEqual([
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    ]);
  });
});
