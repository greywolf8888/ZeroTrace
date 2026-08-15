import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import type { SolanaSnapshot, SolanaTransactionRecord } from '@zerotrace/chain-adapters';
import { hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type SolanaInstructionObservation,
  type SolanaTransactionSemantics,
} from '@zerotrace/schemas';

import {
  decodePumpLaunchpadInstruction,
  decodePumpLaunchpadInstructions,
  PUMP_PROGRAM_ID,
  PUMPSWAP_PROGRAM_ID,
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

function encodedInstruction(discriminator: readonly number[], payload: Uint8Array): string {
  const data = new Uint8Array(discriminator.length + payload.length);
  data.set(discriminator, 0);
  data.set(payload, discriminator.length);
  return bs58.encode(data);
}

function u64(value: bigint): Uint8Array {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setBigUint64(0, value, true);
  return data;
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  new DataView(data.buffer).setUint32(offset, value, true);
}

function writeBytes(data: Uint8Array, offset: number, value: Uint8Array): void {
  data.set(value, offset);
}

function stringBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
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

  it('decodes Pump create and PumpSwap pool-create arguments from pinned layouts', () => {
    const name = stringBytes('Zero');
    const symbol = stringBytes('ZRO');
    const uri = stringBytes('https://example.invalid/zro.json');
    const createPayload = new Uint8Array(4 + name.length + 4 + symbol.length + 4 + uri.length + 32);
    let offset = 0;
    for (const value of [name, symbol, uri]) {
      writeU32(createPayload, offset, value.length);
      offset += 4;
      writeBytes(createPayload, offset, value);
      offset += value.length;
    }
    writeBytes(createPayload, offset, new Uint8Array(32).fill(7));
    const create = decodePumpLaunchpadInstruction({
      instruction: instruction(encodedInstruction([24, 30, 200, 40, 5, 28, 7, 119], createPayload)),
      transaction: transaction(),
      snapshot: snapshot(),
      evidenceIds: [`ev_${'c'.repeat(24)}`],
    });
    expect(create).toMatchObject({
      platform: 'PUMP',
      instructionName: 'create',
      category: 'CREATE',
      argumentCoverage: 1,
      decodedArguments: expect.arrayContaining([
        { name: 'name', value: 'Zero' },
        { name: 'symbol', value: 'ZRO' },
        { name: 'uri', value: 'https://example.invalid/zro.json' },
      ]),
    });

    const poolPayload = new Uint8Array(52);
    new DataView(poolPayload.buffer).setUint16(0, 9, true);
    writeBytes(poolPayload, 2, u64(100n));
    writeBytes(poolPayload, 10, u64(200n));
    writeBytes(poolPayload, 18, new Uint8Array(32).fill(8));
    poolPayload[50] = 1;
    poolPayload[51] = 0;
    const pool = decodePumpLaunchpadInstruction({
      instruction: instruction(
        encodedInstruction([233, 146, 209, 142, 207, 104, 64, 188], poolPayload),
        PUMPSWAP_PROGRAM_ID,
      ),
      transaction: transaction(),
      snapshot: snapshot(),
      evidenceIds: [`ev_${'d'.repeat(24)}`],
    });
    expect(pool).toMatchObject({
      platform: 'PUMPSWAP',
      instructionName: 'create_pool',
      category: 'POOL_CREATE',
      decodedArguments: expect.arrayContaining([
        { name: 'index', value: '9' },
        { name: 'base_amount_in', value: '100' },
        { name: 'quote_amount_in', value: '200' },
        { name: 'is_mayhem_mode', value: 'true' },
        { name: 'is_cashback_coin', value: 'false' },
      ]),
    });
  });

  it('keeps malformed payloads and unresolved accounts explicit', () => {
    const short = decodePumpLaunchpadInstruction({
      instruction: {
        ...instruction(encodedInstruction([102, 6, 61, 18, 1, 218, 235, 234], new Uint8Array())),
        accountIndexes: [],
        accounts: unknownValue('INSUFFICIENT_DATA', 'Accounts were not resolved.'),
      },
      transaction: { ...transaction(), success: false },
      snapshot: snapshot(),
      evidenceIds: [`ev_${'e'.repeat(24)}`],
    });
    expect(short).toMatchObject({
      instructionName: 'buy',
      execution: 'FAILED',
      accountCoverage: 0,
      argumentCoverage: 0,
    });
    expect(short?.decodeWarnings).toEqual(
      expect.arrayContaining([
        'Instruction account addresses are unresolved.',
        expect.stringContaining('account(s)'),
        'Missing amount u64 argument.',
        'Missing max_sol_cost u64 argument.',
      ]),
    );

    expect(
      decodePumpLaunchpadInstruction({
        instruction: instruction('!!!'),
        transaction: transaction(),
        snapshot: snapshot(),
        evidenceIds: [`ev_${'f'.repeat(24)}`],
      }),
    ).toBeUndefined();
    expect(
      decodePumpLaunchpadInstruction({
        instruction: instruction(bs58.encode(new Uint8Array([1, 2, 3]))),
        transaction: transaction(),
        snapshot: snapshot(),
        evidenceIds: [`ev_${'f'.repeat(24)}`],
      }),
    ).toBeUndefined();
    expect(
      decodePumpLaunchpadInstruction({
        instruction: {
          ...instruction(buyV2Data(1n, 2n)),
          programId: unknownValue('NOT_QUERIED', 'Program identity is unavailable.'),
        },
        transaction: transaction(),
        snapshot: snapshot(),
        evidenceIds: [`ev_${'f'.repeat(24)}`],
      }),
    ).toBeUndefined();
  });

  it('decodes optional volume flags and sorts outer plus inner instruction paths', () => {
    const withVolume = new Uint8Array(17);
    writeBytes(withVolume, 0, u64(12n));
    writeBytes(withVolume, 8, u64(34n));
    withVolume[16] = 1;
    const outer = instruction(encodedInstruction([102, 6, 61, 18, 1, 218, 235, 234], withVolume));
    const inner = {
      ...instruction(buyV2Data(56n, 78n)),
      path: 'outer:1/inner:0',
    };
    const evidenceFor = vi.fn((path: string) => [
      `ev_${path === 'outer:0' ? '1'.repeat(24) : '2'.repeat(24)}`,
    ]);
    const decoded = decodePumpLaunchpadInstructions({
      transaction: transaction(),
      semantics: {
        outerInstructions: [outer],
        innerInstructions: [inner],
      } as SolanaTransactionSemantics,
      snapshot: snapshot(),
      evidenceIdsForInstruction: evidenceFor,
    });
    expect(decoded.map((item) => item.instructionPath)).toEqual(['outer:0', 'outer:1/inner:0']);
    expect(decoded[0]?.decodedArguments).toEqual([
      { name: 'amount', value: '12' },
      { name: 'max_sol_cost', value: '34' },
      { name: 'track_volume', value: 'true' },
    ]);
    expect(evidenceFor).toHaveBeenCalledWith('outer:0');
    expect(evidenceFor).toHaveBeenCalledWith('outer:1/inner:0');
  });
});
