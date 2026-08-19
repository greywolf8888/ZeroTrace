import bs58 from 'bs58';

import { hashPayload } from '@zerotrace/evidence';
import type { SolanaTransactionRecord } from '@zerotrace/chain-adapters';
import {
  SolanaLaunchpadObservationSchema,
  type AnalysisSnapshot,
  type SolanaInstructionObservation,
  type SolanaLaunchpadDecodedArgument,
  type SolanaLaunchpadInstructionCategory,
  type SolanaLaunchpadObservation,
  type SolanaTransactionSemantics,
} from '@zerotrace/schemas';

export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' as const;
export const PUMPSWAP_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' as const;
export const PUMP_SOURCE_COMMIT = '9c82f61cb711b044a17f770ab8ce9f9bdf78f333' as const;
export const PUMP_IDL_SHA256 =
  'b90bc471327f671449271d5d1d42354d1fae6f5a06502f5834459a3108138e49' as const;
export const PUMPSWAP_IDL_SHA256 =
  '6b5c7ec4e5ef9742fa99dc57b0d75b1031b379bba02a7e1b3c5a4cad68d77e56' as const;
export const SOLANA_PUMP_LAUNCHPAD_MODEL_VERSION = 'solana-pump-launchpad-v1.0.0' as const;

const PUMP_SOURCE_URIS = [
  'https://pump.fun/docs/',
  'https://github.com/pump-fun/pump-public-docs',
  `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/idl/pump.json`,
] as const;
const PUMPSWAP_SOURCE_URIS = [
  'https://github.com/pump-fun/pump-public-docs',
  `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/idl/pump_amm.json`,
  `https://github.com/pump-fun/pump-public-docs/blob/${PUMP_SOURCE_COMMIT}/docs/PUMP_SWAP_README.md`,
] as const;

type InstructionVersion = 'LEGACY' | 'V2' | 'CURRENT';
type Execution = SolanaLaunchpadObservation['execution'];

interface DecodedArguments {
  values: SolanaLaunchpadDecodedArgument[];
  expected: number;
  warnings: string[];
}

interface PumpInstructionDefinition {
  readonly name: string;
  readonly category: SolanaLaunchpadInstructionCategory;
  readonly version: InstructionVersion;
  readonly discriminator: readonly number[];
  readonly accountNames: readonly string[];
  readonly decodeArguments: (data: Uint8Array) => DecodedArguments;
}

interface PumpProgramDefinition {
  readonly platform: SolanaLaunchpadObservation['platform'];
  readonly programId: string;
  readonly deploymentId: string;
  readonly sourceCommit: string;
  readonly abiOrIdlHash: string;
  readonly officialSourceUris: readonly string[];
  readonly instructions: readonly PumpInstructionDefinition[];
}

const EMPTY_ARGUMENTS = (): DecodedArguments => ({ values: [], expected: 0, warnings: [] });

function u64(data: Uint8Array, offset: number): string | undefined {
  if (offset < 0 || offset + 8 > data.length) return undefined;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(data[offset + index]!) << BigInt(index * 8);
  }
  return value.toString();
}

function u16(data: Uint8Array, offset: number): string | undefined {
  if (offset < 0 || offset + 2 > data.length) return undefined;
  return (BigInt(data[offset]!) | (BigInt(data[offset + 1]!) << 8n)).toString();
}

function u32(data: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > data.length) return undefined;
  const value =
    Number(data[offset]!) |
    (Number(data[offset + 1]!) << 8) |
    (Number(data[offset + 2]!) << 16) |
    (Number(data[offset + 3]!) << 24);
  return value >>> 0;
}

function pubkey(data: Uint8Array, offset: number): string | undefined {
  if (offset < 0 || offset + 32 > data.length) return undefined;
  return bs58.encode(data.slice(offset, offset + 32));
}

function utf8(data: Uint8Array, offset: number, length: number): string | undefined {
  if (offset < 0 || length < 0 || offset + length > data.length) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data.slice(offset, offset + length));
  } catch {
    return undefined;
  }
}

function stringField(
  data: Uint8Array,
  offset: number,
  name: string,
): { value?: SolanaLaunchpadDecodedArgument; next: number; warning?: string } {
  const length = u32(data, offset);
  if (length === undefined) {
    return { next: offset, warning: `Missing ${name} string length.` };
  }
  const value = utf8(data, offset + 4, length);
  if (value === undefined) {
    return { next: offset, warning: `Invalid UTF-8 ${name} string.` };
  }
  return { value: { name, value }, next: offset + 4 + length };
}

function pairArguments(
  data: Uint8Array,
  names: readonly [string, string],
  third?: string,
): DecodedArguments {
  const values: SolanaLaunchpadDecodedArgument[] = [];
  const warnings: string[] = [];
  const first = u64(data, 0);
  const second = u64(data, 8);
  if (first === undefined) warnings.push(`Missing ${names[0]} u64 argument.`);
  else values.push({ name: names[0], value: first });
  if (second === undefined) warnings.push(`Missing ${names[1]} u64 argument.`);
  else values.push({ name: names[1], value: second });
  let expected = 2;
  if (third !== undefined && data.length > 16) {
    expected = 3;
    const option = data[16];
    if (option === 0 || option === 1)
      values.push({ name: third, value: option === 1 ? 'true' : 'false' });
    else warnings.push(`Invalid ${third} OptionBool argument.`);
  }
  return { values, expected, warnings };
}

function createArguments(data: Uint8Array): DecodedArguments {
  const values: SolanaLaunchpadDecodedArgument[] = [];
  const warnings: string[] = [];
  let offset = 0;
  for (const name of ['name', 'symbol', 'uri'] as const) {
    const field = stringField(data, offset, name);
    if (field.value === undefined) warnings.push(field.warning ?? `Missing ${name} argument.`);
    else values.push(field.value);
    if (field.next === offset) return { values, expected: 4, warnings };
    offset = field.next;
  }
  const creator = pubkey(data, offset);
  if (creator === undefined) warnings.push('Missing creator pubkey argument.');
  else values.push({ name: 'creator', value: creator });
  return { values, expected: 4, warnings };
}

function createPoolArguments(data: Uint8Array): DecodedArguments {
  const values: SolanaLaunchpadDecodedArgument[] = [];
  const warnings: string[] = [];
  const index = u16(data, 0);
  const baseAmount = u64(data, 2);
  const quoteAmount = u64(data, 10);
  const coinCreator = pubkey(data, 18);
  const mayhem = data[50];
  const cashback = data[51];
  if (index === undefined) warnings.push('Missing pool index argument.');
  else values.push({ name: 'index', value: index });
  if (baseAmount === undefined) warnings.push('Missing base_amount_in argument.');
  else values.push({ name: 'base_amount_in', value: baseAmount });
  if (quoteAmount === undefined) warnings.push('Missing quote_amount_in argument.');
  else values.push({ name: 'quote_amount_in', value: quoteAmount });
  if (coinCreator === undefined) warnings.push('Missing coin_creator pubkey argument.');
  else values.push({ name: 'coin_creator', value: coinCreator });
  if (mayhem !== 0 && mayhem !== 1) warnings.push('Invalid is_mayhem_mode boolean argument.');
  else values.push({ name: 'is_mayhem_mode', value: mayhem === 1 ? 'true' : 'false' });
  if (cashback !== 0 && cashback !== 1) warnings.push('Invalid is_cashback_coin boolean argument.');
  else values.push({ name: 'is_cashback_coin', value: cashback === 1 ? 'true' : 'false' });
  return { values, expected: 6, warnings };
}

const PUMP_INSTRUCTIONS: readonly PumpInstructionDefinition[] = [
  {
    name: 'create',
    category: 'CREATE',
    version: 'CURRENT',
    discriminator: [24, 30, 200, 40, 5, 28, 7, 119],
    accountNames: [
      'mint',
      'mint_authority',
      'bonding_curve',
      'associated_bonding_curve',
      'global',
      'mpl_token_metadata',
      'metadata',
      'user',
      'system_program',
      'token_program',
      'associated_token_program',
      'rent',
      'event_authority',
      'program',
    ],
    decodeArguments: createArguments,
  },
  {
    name: 'buy',
    category: 'TRADE',
    version: 'LEGACY',
    discriminator: [102, 6, 61, 18, 1, 218, 235, 234],
    accountNames: [
      'global',
      'fee_recipient',
      'mint',
      'bonding_curve',
      'associated_bonding_curve',
      'associated_user',
      'user',
      'system_program',
      'token_program',
      'creator_vault',
      'event_authority',
      'program',
      'global_volume_accumulator',
      'user_volume_accumulator',
      'fee_config',
      'fee_program',
    ],
    decodeArguments: (data) => pairArguments(data, ['amount', 'max_sol_cost'], 'track_volume'),
  },
  {
    name: 'sell',
    category: 'TRADE',
    version: 'LEGACY',
    discriminator: [51, 230, 133, 164, 1, 127, 131, 173],
    accountNames: [
      'global',
      'fee_recipient',
      'mint',
      'bonding_curve',
      'associated_bonding_curve',
      'associated_user',
      'user',
      'system_program',
      'creator_vault',
      'token_program',
      'event_authority',
      'program',
      'fee_config',
      'fee_program',
    ],
    decodeArguments: (data) => pairArguments(data, ['amount', 'min_sol_output']),
  },
  {
    name: 'buy_v2',
    category: 'TRADE',
    version: 'V2',
    discriminator: [184, 23, 238, 97, 103, 197, 211, 61],
    accountNames: [
      'global',
      'base_mint',
      'quote_mint',
      'base_token_program',
      'quote_token_program',
      'associated_token_program',
      'fee_recipient',
      'associated_quote_fee_recipient',
      'buyback_fee_recipient',
      'associated_quote_buyback_fee_recipient',
      'bonding_curve',
      'associated_base_bonding_curve',
      'associated_quote_bonding_curve',
      'user',
      'associated_base_user',
      'associated_quote_user',
      'creator_vault',
      'associated_creator_vault',
      'sharing_config',
      'global_volume_accumulator',
      'user_volume_accumulator',
      'associated_user_volume_accumulator',
      'fee_config',
      'fee_program',
      'system_program',
      'event_authority',
      'program',
    ],
    decodeArguments: (data) => pairArguments(data, ['amount', 'max_sol_cost']),
  },
  {
    name: 'sell_v2',
    category: 'TRADE',
    version: 'V2',
    discriminator: [93, 246, 130, 60, 231, 233, 64, 178],
    accountNames: [
      'global',
      'base_mint',
      'quote_mint',
      'base_token_program',
      'quote_token_program',
      'associated_token_program',
      'fee_recipient',
      'associated_quote_fee_recipient',
      'buyback_fee_recipient',
      'associated_quote_buyback_fee_recipient',
      'bonding_curve',
      'associated_base_bonding_curve',
      'associated_quote_bonding_curve',
      'user',
      'associated_base_user',
      'associated_quote_user',
      'creator_vault',
      'associated_creator_vault',
      'sharing_config',
      'user_volume_accumulator',
      'associated_user_volume_accumulator',
      'fee_config',
      'fee_program',
      'system_program',
      'event_authority',
      'program',
    ],
    decodeArguments: (data) => pairArguments(data, ['amount', 'min_sol_output']),
  },
  {
    name: 'buy_exact_quote_in_v2',
    category: 'TRADE',
    version: 'V2',
    discriminator: [194, 171, 28, 70, 104, 77, 91, 47],
    accountNames: [
      'global',
      'base_mint',
      'quote_mint',
      'base_token_program',
      'quote_token_program',
      'associated_token_program',
      'fee_recipient',
      'associated_quote_fee_recipient',
      'buyback_fee_recipient',
      'associated_quote_buyback_fee_recipient',
      'bonding_curve',
      'associated_base_bonding_curve',
      'associated_quote_bonding_curve',
      'user',
      'associated_base_user',
      'associated_quote_user',
      'creator_vault',
      'associated_creator_vault',
      'sharing_config',
      'global_volume_accumulator',
      'user_volume_accumulator',
      'associated_user_volume_accumulator',
      'fee_config',
      'fee_program',
      'system_program',
      'event_authority',
      'program',
    ],
    decodeArguments: (data) => pairArguments(data, ['spendable_quote_in', 'min_tokens_out']),
  },
  {
    name: 'migrate',
    category: 'MIGRATION',
    version: 'CURRENT',
    discriminator: [155, 234, 231, 146, 236, 158, 162, 30],
    accountNames: [
      'global',
      'withdraw_authority',
      'mint',
      'bonding_curve',
      'associated_bonding_curve',
      'user',
      'system_program',
      'token_program',
      'pump_amm',
      'pool',
      'pool_authority',
      'pool_authority_mint_account',
      'pool_authority_wsol_account',
      'amm_global_config',
      'wsol_mint',
      'lp_mint',
      'user_pool_token_account',
      'pool_base_token_account',
      'pool_quote_token_account',
      'token_2022_program',
      'associated_token_program',
      'pump_amm_event_authority',
      'event_authority',
      'program',
      'rent',
    ],
    decodeArguments: EMPTY_ARGUMENTS,
  },
];

const PUMPSWAP_INSTRUCTIONS: readonly PumpInstructionDefinition[] = [
  {
    name: 'create_pool',
    category: 'POOL_CREATE',
    version: 'CURRENT',
    discriminator: [233, 146, 209, 142, 207, 104, 64, 188],
    accountNames: [
      'pool',
      'global_config',
      'creator',
      'base_mint',
      'quote_mint',
      'lp_mint',
      'user_base_token_account',
      'user_quote_token_account',
      'user_pool_token_account',
      'pool_base_token_account',
      'pool_quote_token_account',
      'system_program',
      'token_2022_program',
      'base_token_program',
      'quote_token_program',
      'associated_token_program',
      'event_authority',
      'program',
    ],
    decodeArguments: createPoolArguments,
  },
  {
    name: 'buy',
    category: 'SWAP',
    version: 'CURRENT',
    discriminator: [102, 6, 61, 18, 1, 218, 235, 234],
    accountNames: [
      'pool',
      'user',
      'global_config',
      'base_mint',
      'quote_mint',
      'user_base_token_account',
      'user_quote_token_account',
      'pool_base_token_account',
      'pool_quote_token_account',
      'protocol_fee_recipient',
      'protocol_fee_recipient_token_account',
      'base_token_program',
      'quote_token_program',
      'system_program',
      'associated_token_program',
      'event_authority',
      'program',
      'coin_creator_vault_ata',
      'coin_creator_vault_authority',
      'global_volume_accumulator',
      'user_volume_accumulator',
      'fee_config',
      'fee_program',
    ],
    decodeArguments: (data) =>
      pairArguments(data, ['base_amount_out', 'max_quote_amount_in'], 'track_volume'),
  },
  {
    name: 'sell',
    category: 'SWAP',
    version: 'CURRENT',
    discriminator: [51, 230, 133, 164, 1, 127, 131, 173],
    accountNames: [
      'pool',
      'user',
      'global_config',
      'base_mint',
      'quote_mint',
      'user_base_token_account',
      'user_quote_token_account',
      'pool_base_token_account',
      'pool_quote_token_account',
      'protocol_fee_recipient',
      'protocol_fee_recipient_token_account',
      'base_token_program',
      'quote_token_program',
      'system_program',
      'associated_token_program',
      'event_authority',
      'program',
      'coin_creator_vault_ata',
      'coin_creator_vault_authority',
      'fee_config',
      'fee_program',
    ],
    decodeArguments: (data) => pairArguments(data, ['base_amount_in', 'min_quote_amount_out']),
  },
  {
    name: 'deposit',
    category: 'LIQUIDITY',
    version: 'CURRENT',
    discriminator: [242, 35, 198, 137, 82, 225, 242, 182],
    accountNames: [
      'pool',
      'global_config',
      'user',
      'base_mint',
      'quote_mint',
      'lp_mint',
      'user_base_token_account',
      'user_quote_token_account',
      'user_pool_token_account',
      'pool_base_token_account',
      'pool_quote_token_account',
      'token_program',
      'token_2022_program',
      'event_authority',
      'program',
    ],
    decodeArguments: (data) => {
      const values: SolanaLaunchpadDecodedArgument[] = [];
      const warnings: string[] = [];
      for (const [index, name] of [
        'lp_token_amount_out',
        'max_base_amount_in',
        'max_quote_amount_in',
      ].entries()) {
        const value = u64(data, index * 8);
        if (value === undefined) warnings.push(`Missing ${name} u64 argument.`);
        else values.push({ name, value });
      }
      return { values, expected: 3, warnings };
    },
  },
  {
    name: 'withdraw',
    category: 'LIQUIDITY',
    version: 'CURRENT',
    discriminator: [183, 18, 70, 156, 148, 109, 161, 34],
    accountNames: [
      'pool',
      'global_config',
      'user',
      'base_mint',
      'quote_mint',
      'lp_mint',
      'user_base_token_account',
      'user_quote_token_account',
      'user_pool_token_account',
      'pool_base_token_account',
      'pool_quote_token_account',
      'token_program',
      'token_2022_program',
      'event_authority',
      'program',
    ],
    decodeArguments: (data) => {
      const values: SolanaLaunchpadDecodedArgument[] = [];
      const warnings: string[] = [];
      for (const [index, name] of [
        'lp_token_amount_in',
        'min_base_amount_out',
        'min_quote_amount_out',
      ].entries()) {
        const value = u64(data, index * 8);
        if (value === undefined) warnings.push(`Missing ${name} u64 argument.`);
        else values.push({ name, value });
      }
      return { values, expected: 3, warnings };
    },
  },
];

const PROGRAMS: readonly PumpProgramDefinition[] = [
  {
    platform: 'PUMP',
    programId: PUMP_PROGRAM_ID,
    deploymentId: `pump-solana-mainnet-${PUMP_SOURCE_COMMIT.slice(0, 12)}`,
    sourceCommit: PUMP_SOURCE_COMMIT,
    abiOrIdlHash: PUMP_IDL_SHA256,
    officialSourceUris: PUMP_SOURCE_URIS,
    instructions: PUMP_INSTRUCTIONS,
  },
  {
    platform: 'PUMPSWAP',
    programId: PUMPSWAP_PROGRAM_ID,
    deploymentId: `pumpswap-solana-mainnet-${PUMP_SOURCE_COMMIT.slice(0, 12)}`,
    sourceCommit: PUMP_SOURCE_COMMIT,
    abiOrIdlHash: PUMPSWAP_IDL_SHA256,
    officialSourceUris: PUMPSWAP_SOURCE_URIS,
    instructions: PUMPSWAP_INSTRUCTIONS,
  },
];

const PROGRAM_BY_ID = new Map(PROGRAMS.map((program) => [program.programId, program]));

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function executionFor(transaction: SolanaTransactionRecord): Execution {
  if (transaction.success === true) return 'SUCCESS';
  if (transaction.success === false) return 'FAILED';
  return 'UNKNOWN';
}

function discriminatorHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function sameBytes(left: Uint8Array, right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseInstructionData(dataBase58: string): Uint8Array | undefined {
  try {
    const bytes = bs58.decode(dataBase58);
    return bytes.length < 8 ? undefined : bytes;
  } catch {
    return undefined;
  }
}

function buildAccounts(
  instruction: SolanaInstructionObservation,
  definition: PumpInstructionDefinition,
): {
  accounts: SolanaLaunchpadObservation['accounts'];
  coverage: number;
  warnings: string[];
} {
  const resolved = instruction.accounts.state === 'known' ? instruction.accounts.value : undefined;
  const accounts = instruction.accountIndexes.map((index, position) => ({
    index,
    name: definition.accountNames[position] ?? `account_${position}`,
    ...(resolved?.[position] === undefined ? {} : { address: resolved[position] }),
  }));
  const resolvedCount = accounts.filter((account) => account.address !== undefined).length;
  const expected = Math.max(1, definition.accountNames.length);
  const warnings = [
    ...(resolved === undefined ? ['Instruction account addresses are unresolved.'] : []),
  ];
  if (instruction.accountIndexes.length < expected) {
    warnings.push(
      `Instruction account layout is short by ${expected - instruction.accountIndexes.length} account(s).`,
    );
  } else if (instruction.accountIndexes.length > expected) {
    warnings.push(
      `Instruction carries ${instruction.accountIndexes.length - expected} trailing account(s) outside the pinned layout.`,
    );
  }
  return {
    accounts,
    coverage: Math.min(1, resolvedCount / expected),
    warnings,
  };
}

function makeObservation(input: {
  instruction: SolanaInstructionObservation;
  transaction: SolanaTransactionRecord;
  snapshot: Extract<AnalysisSnapshot, { ledger: 'SOLANA' }>;
  program: PumpProgramDefinition;
  definition: PumpInstructionDefinition;
  evidenceIds: readonly string[];
  data: Uint8Array;
}): SolanaLaunchpadObservation {
  const decoded = input.definition.decodeArguments(input.data.slice(8));
  const accountState = buildAccounts(input.instruction, input.definition);
  const evidenceIds = sortedUnique(input.evidenceIds);
  if (evidenceIds.length === 0) throw new Error('Pump launchpad decoding requires Evidence IDs.');
  const base = {
    schemaVersion: 'solana-launchpad-observation-v1' as const,
    platform: input.program.platform,
    programId: input.program.programId,
    deploymentId: input.program.deploymentId,
    sourceCommit: input.program.sourceCommit,
    abiOrIdlHash: input.program.abiOrIdlHash,
    officialSourceUris: [...input.program.officialSourceUris],
    signature: input.transaction.signature,
    slot: input.transaction.slot,
    instructionPath: input.instruction.path,
    instructionName: input.definition.name,
    instructionVersion: input.definition.version,
    category: input.definition.category,
    discriminator: discriminatorHex(input.data.slice(0, 8)),
    accountIndexes: [...input.instruction.accountIndexes],
    accounts: accountState.accounts,
    accountCoverage: accountState.coverage,
    decodedArguments: decoded.values,
    argumentCoverage:
      decoded.expected === 0 ? 1 : Math.min(1, decoded.values.length / decoded.expected),
    decodeWarnings: [...accountState.warnings, ...decoded.warnings],
    execution: executionFor(input.transaction),
    evidenceIds,
    snapshot: input.snapshot,
  };
  const id = `slo_${hashPayload({ schema: base.schemaVersion, value: base }).slice(0, 24)}`;
  const withId = { ...base, id };
  return SolanaLaunchpadObservationSchema.parse({
    ...withId,
    resultHash: hashPayload(withId),
  });
}

export interface DecodePumpLaunchpadInstructionInput {
  instruction: SolanaInstructionObservation;
  transaction: SolanaTransactionRecord;
  snapshot: Extract<AnalysisSnapshot, { ledger: 'SOLANA' }>;
  evidenceIds: readonly string[];
}

/**
 * Clean-room, read-only decoder for the official Pump and PumpSwap instruction
 * discriminators.  It only activates for the pinned program IDs and source
 * commit represented above; unknown program bytes remain outside this result.
 */
export function decodePumpLaunchpadInstruction(
  input: DecodePumpLaunchpadInstructionInput,
): SolanaLaunchpadObservation | undefined {
  const programId =
    input.instruction.programId.state === 'known' ? input.instruction.programId.value : undefined;
  if (programId === undefined) return undefined;
  const program = PROGRAM_BY_ID.get(programId);
  if (program === undefined) return undefined;
  const data = parseInstructionData(input.instruction.dataBase58);
  if (data === undefined) return undefined;
  const definition = program.instructions.find((candidate) =>
    sameBytes(data.slice(0, 8), candidate.discriminator),
  );
  if (definition === undefined) return undefined;
  return makeObservation({ ...input, program, definition, data });
}

export function decodePumpLaunchpadInstructions(input: {
  transaction: SolanaTransactionRecord;
  semantics: SolanaTransactionSemantics;
  snapshot: Extract<AnalysisSnapshot, { ledger: 'SOLANA' }>;
  evidenceIdsForInstruction: (instructionPath: string) => readonly string[];
}): SolanaLaunchpadObservation[] {
  const decoded: SolanaLaunchpadObservation[] = [];
  for (const instruction of [
    ...input.semantics.outerInstructions,
    ...input.semantics.innerInstructions,
  ]) {
    const observation = decodePumpLaunchpadInstruction({
      instruction,
      transaction: input.transaction,
      snapshot: input.snapshot,
      evidenceIds: input.evidenceIdsForInstruction(instruction.path),
    });
    if (observation !== undefined) decoded.push(observation);
  }
  return decoded.sort((left, right) => left.instructionPath.localeCompare(right.instructionPath));
}

export function pumpLaunchpadProgramIds(): readonly string[] {
  return PROGRAMS.map((program) => program.programId);
}
