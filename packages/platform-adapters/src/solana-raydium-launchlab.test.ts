import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import type { SolanaSnapshot, SolanaTransactionRecord } from '@zerotrace/chain-adapters';
import { hashPayload } from '@zerotrace/evidence';
import { knownValue, unknownValue, type SolanaInstructionObservation } from '@zerotrace/schemas';

import {
  decodeRaydiumLaunchlabPoolState,
  decodeRaydiumLaunchlabInstruction,
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH,
  RAYDIUM_LAUNCHLAB_POOL_STATE_DISCRIMINATOR,
  RAYDIUM_LAUNCHLAB_SOURCE_COMMIT,
  SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION,
} from './solana-raydium-launchlab.js';

const SIGNATURE = '2'.repeat(64);
const EVIDENCE = [`ev_${'a'.repeat(24)}`];

function snapshot(): SolanaSnapshot {
  return {
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    slot: '77',
    blockhash: bs58.encode(new Uint8Array(32).fill(3)),
    parentSlot: '76',
    previousBlockhash: bs58.encode(new Uint8Array(32).fill(4)),
    commitment: 'finalized',
    capturedAt: '2026-08-15T00:00:00.000Z',
    providerVersions: { 'test-solana': 'test' },
    adapterVersions: { solana: 'test' },
    configHash: hashPayload('raydium-launchlab-test-config'),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-empty-v1',
  };
}

function transaction(): SolanaTransactionRecord {
  return {
    signature: SIGNATURE,
    signatures: [SIGNATURE],
    slot: '77',
    version: 'legacy',
    recentBlockhash: bs58.encode(new Uint8Array(32).fill(5)),
    header: {
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: 0,
    },
    staticAccountKeys: [RAYDIUM_LAUNCHLAB_PROGRAM_ID],
    addressTableLookups: [],
    instructions: [],
    success: true,
    raw: {},
  };
}

function instruction(data: Uint8Array, accountCount = 15): SolanaInstructionObservation {
  return {
    path: 'outer:0',
    outerIndex: 0,
    innerIndex: unknownValue('NOT_APPLICABLE', 'Outer instruction.'),
    stackHeight: unknownValue('INSUFFICIENT_DATA', 'Test fixture does not include stack height.'),
    programIdIndex: 0,
    programId: knownValue(RAYDIUM_LAUNCHLAB_PROGRAM_ID),
    accountIndexes: Array.from({ length: accountCount }, (_, index) => index),
    accounts: knownValue(
      Array.from({ length: accountCount }, () => bs58.encode(new Uint8Array(32).fill(9))),
    ),
    dataBase58: bs58.encode(data),
    programSemantic: unknownValue('NOT_QUERIED', 'Raydium LaunchLab decoder test input.'),
  };
}

function encoded(discriminator: readonly number[], values: readonly bigint[]): Uint8Array {
  const data = new Uint8Array(8 + values.length * 8);
  data.set(discriminator);
  values.forEach((value, index) =>
    new DataView(data.buffer).setBigUint64(8 + index * 8, value, true),
  );
  return data;
}

function structuredInitializeData(options: {
  ammFee: boolean;
  transferFeeOption: boolean;
}): Uint8Array {
  const bytes: number[] = [175, 175, 109, 31, 13, 152, 155, 237, 6];
  const appendU32 = (value: number) => {
    bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  };
  const appendU64 = (value: bigint) => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setBigUint64(0, value, true);
    bytes.push(...new Uint8Array(buffer));
  };
  const appendString = (value: string) => {
    const encodedValue = new TextEncoder().encode(value);
    appendU32(encodedValue.length);
    bytes.push(...encodedValue);
  };
  appendString('Raydium');
  appendString('RAY');
  appendString('https://example.invalid/raydium.json');
  bytes.push(0);
  appendU64(1_000n);
  appendU64(700n);
  appendU64(300n);
  bytes.push(1);
  appendU64(100n);
  appendU64(20n);
  appendU64(30n);
  if (options.ammFee) bytes.push(1);
  if (options.transferFeeOption) {
    bytes.push(1, 25, 0);
    appendU64(500n);
  }
  return Uint8Array.from(bytes);
}

function poolStateData(): Uint8Array {
  const bytes: number[] = [...RAYDIUM_LAUNCHLAB_POOL_STATE_DISCRIMINATOR];
  const appendU64 = (value: bigint) => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setBigUint64(0, value, true);
    bytes.push(...new Uint8Array(buffer));
  };
  appendU64(77n);
  bytes.push(9, 0, 6, 6, 1);
  for (const value of [
    1_000n,
    700n,
    800n,
    900n,
    600n,
    500n,
    400n,
    30n,
    20n,
    10n,
    100n,
    11n,
    12n,
    13n,
    14n,
  ]) {
    appendU64(value);
  }
  for (let index = 1; index <= 7; index += 1) bytes.push(...new Uint8Array(32).fill(index));
  bytes.push(3, 1);
  appendU64(55n);
  bytes.push(...new Uint8Array(54));
  return Uint8Array.from(bytes);
}

describe('Raydium LaunchLab clean-room decoder', () => {
  it('decodes exact-in trade arguments and keeps the source/version boundary', () => {
    const decoded = decodeRaydiumLaunchlabInstruction({
      instruction: instruction(encoded([250, 234, 13, 123, 213, 156, 19, 236], [123n, 456n, 25n])),
      transaction: transaction(),
      snapshot: snapshot(),
      evidenceIds: EVIDENCE,
    });

    expect(decoded).toMatchObject({
      platform: 'RAYDIUM_LAUNCHLAB',
      programId: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
      sourceCommit: RAYDIUM_LAUNCHLAB_SOURCE_COMMIT,
      instructionName: 'buy_exact_in',
      category: 'TRADE',
      accountCoverage: 1,
      argumentCoverage: 1,
      decodedArguments: [
        { name: 'amount_in', value: '123' },
        { name: 'minimum_amount_out', value: '456' },
        { name: 'share_fee_rate', value: '25' },
      ],
      evidenceIds: EVIDENCE,
    });
    expect(decoded?.resultHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps truncated initialize structs explicitly incomplete', () => {
    const data = new Uint8Array([175, 175, 109, 31, 13, 152, 155, 237, 1, 2, 3]);
    const decoded = decodeRaydiumLaunchlabInstruction({
      instruction: instruction(data),
      transaction: transaction(),
      snapshot: snapshot(),
      evidenceIds: EVIDENCE,
    });

    expect(decoded).toMatchObject({
      instructionName: 'initialize',
      argumentCoverage: 0,
      decodedArguments: [],
    });
    expect(decoded?.decodeWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Missing base_mint_param.name')]),
    );
  });

  it('decodes the pinned Borsh initialize structs without promoting unverified state', () => {
    const decoded = decodeRaydiumLaunchlabInstruction({
      instruction: instruction(
        structuredInitializeData({ ammFee: false, transferFeeOption: false }),
        18,
      ),
      transaction: transaction(),
      snapshot: snapshot(),
      evidenceIds: EVIDENCE,
    });

    expect(decoded).toMatchObject({
      instructionName: 'initialize',
      argumentCoverage: 1,
      decodedArguments: [
        { name: 'base_mint_param' },
        { name: 'curve_param' },
        { name: 'vesting_param' },
      ],
    });
    expect(JSON.parse(decoded?.decodedArguments[0]?.value ?? '{}')).toEqual({
      decimals: '6',
      name: 'Raydium',
      symbol: 'RAY',
      uri: 'https://example.invalid/raydium.json',
    });
  });

  it('recognizes the official Token-2022 initializer and optional transfer-fee struct', () => {
    const data = structuredInitializeData({ ammFee: true, transferFeeOption: true });
    data.set([37, 190, 126, 222, 44, 154, 171, 17], 0);
    const decoded = decodeRaydiumLaunchlabInstruction({
      instruction: instruction(data, 16),
      transaction: transaction(),
      snapshot: snapshot(),
      evidenceIds: EVIDENCE,
    });

    expect(decoded).toMatchObject({
      instructionName: 'initialize_with_token_2022',
      argumentCoverage: 1,
      decodedArguments: [
        { name: 'base_mint_param' },
        { name: 'curve_param' },
        { name: 'vesting_param' },
        { name: 'amm_fee_on', value: 'BothToken' },
        { name: 'transfer_fee_extension_param' },
      ],
    });
  });

  it('keeps the official AMM and CPMM migration account layouts distinct', () => {
    const amm = decodeRaydiumLaunchlabInstruction({
      instruction: instruction(encoded([207, 82, 192, 145, 254, 207, 145, 223], [1n, 2n, 3n]), 32),
      transaction: transaction(),
      snapshot: snapshot(),
      evidenceIds: EVIDENCE,
    });
    const cpswap = decodeRaydiumLaunchlabInstruction({
      instruction: instruction(new Uint8Array([136, 92, 200, 103, 28, 218, 144, 140]), 28),
      transaction: transaction(),
      snapshot: snapshot(),
      evidenceIds: EVIDENCE,
    });

    expect(amm).toMatchObject({ instructionName: 'migrate_to_amm', argumentCoverage: 1 });
    expect(amm?.accounts.slice(0, 5).map(({ name }) => name)).toEqual([
      'payer',
      'base_mint',
      'quote_mint',
      'openbook_program',
      'market',
    ]);
    expect(amm?.accounts.slice(16, 21).map(({ name }) => name)).toEqual([
      'amm_lp_mint',
      'amm_base_vault',
      'amm_quote_vault',
      'amm_target_orders',
      'amm_config',
    ]);
    expect(cpswap).toMatchObject({ instructionName: 'migrate_to_cpswap', argumentCoverage: 1 });
    expect(cpswap?.accounts.slice(0, 6).map(({ name }) => name)).toEqual([
      'payer',
      'base_mint',
      'quote_mint',
      'platform_config',
      'cpswap_program',
      'cpswap_pool',
    ]);
  });

  it('decodes the pinned PoolState account without deriving price or graduation', () => {
    const decoded = decodeRaydiumLaunchlabPoolState(poolStateData());

    expect(decoded).toMatchObject({
      accountName: 'PoolState',
      accountDataLength: RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH,
      expectedAccountDataLength: RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH,
      fieldCoverage: 1,
      decodeWarnings: [],
    });
    expect(decoded?.decodedFields).toEqual(
      expect.arrayContaining([
        { name: 'epoch', value: '77' },
        { name: 'status_code', value: '0' },
        { name: 'status', value: 'Fund' },
        { name: 'migrate_type_code', value: '1' },
        { name: 'migrate_type', value: 'CPMM' },
        { name: 'real_base', value: '600' },
        { name: 'real_quote', value: '500' },
        { name: 'base_token_program', value: 'TOKEN_2022' },
        { name: 'quote_token_program', value: 'TOKEN_2022' },
        { name: 'amm_creator_fee_on', value: 'BothToken' },
      ]),
    );
  });

  it('keeps truncated or unrelated account bytes explicitly outside the decoder', () => {
    const truncated = decodeRaydiumLaunchlabPoolState(poolStateData().slice(0, 64));
    expect(truncated?.fieldCoverage).toBeLessThan(1);
    expect(truncated?.decodeWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('expects 429')]),
    );
    const trailing = decodeRaydiumLaunchlabPoolState(Uint8Array.from([...poolStateData(), 255]));
    expect(trailing?.fieldCoverage).toBe(1);
    expect(trailing?.decodeWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('trailing byte')]),
    );
    expect(decodeRaydiumLaunchlabPoolState(new Uint8Array(429))).toBeUndefined();
  });

  it('fails closed at every PoolState boundary and preserves unknown enum values', () => {
    for (const length of [8, 16, 17, 18, 19, 20, 21, 141, 365, 366, 367, 375]) {
      const decoded = decodeRaydiumLaunchlabPoolState(poolStateData().slice(0, length));
      expect(decoded?.decodeWarnings.length).toBeGreaterThan(0);
    }

    const unknownStatus = poolStateData();
    unknownStatus[17] = 3;
    expect(decodeRaydiumLaunchlabPoolState(unknownStatus)?.decodeWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Unknown status variant 3')]),
    );

    const unknownMigration = poolStateData();
    unknownMigration[20] = 2;
    expect(decodeRaydiumLaunchlabPoolState(unknownMigration)?.decodeWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Unknown migrate_type variant 2')]),
    );

    const unknownFee = poolStateData();
    unknownFee[366] = 2;
    expect(decodeRaydiumLaunchlabPoolState(unknownFee)?.decodeWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Unknown amm_creator_fee_on variant 2')]),
    );

    const splPrograms = poolStateData();
    splPrograms[365] = 0;
    expect(decodeRaydiumLaunchlabPoolState(splPrograms)?.decodedFields).toEqual(
      expect.arrayContaining([
        { name: 'base_token_program', value: 'SPL_TOKEN' },
        { name: 'quote_token_program', value: 'SPL_TOKEN' },
      ]),
    );
  });

  it('rejects an unrelated program even when the discriminator is known', () => {
    const data = encoded([250, 234, 13, 123, 213, 156, 19, 236], [1n, 2n, 3n]);
    const unrelated = {
      ...instruction(data),
      programId: knownValue('11111111111111111111111111111111'),
    };
    expect(
      decodeRaydiumLaunchlabInstruction({
        instruction: unrelated,
        transaction: transaction(),
        snapshot: snapshot(),
        evidenceIds: EVIDENCE,
      }),
    ).toBeUndefined();
    expect(SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION).toBe('solana-raydium-launchlab-v1.0.0');
  });
});
