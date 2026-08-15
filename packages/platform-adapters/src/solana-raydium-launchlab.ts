import bs58 from 'bs58';

import { hashPayload } from '@zerotrace/evidence';
import type { SolanaTransactionRecord } from '@zerotrace/chain-adapters';
import {
  SolanaLaunchpadObservationSchema,
  ProtocolDeploymentVersionSchema,
  type AnalysisSnapshot,
  type SolanaInstructionObservation,
  type SolanaLaunchpadDecodedArgument,
  type SolanaLaunchpadObservation,
  type SolanaTransactionSemantics,
} from '@zerotrace/schemas';

/**
 * Raydium documents this address as the mainnet-beta LaunchLab program. The
 * decoder is clean-room and retains only the source-pinned discriminator,
 * account, and Borsh observation surface needed for read-only analysis; it
 * does not import the GPL-licensed Raydium SDK or expose any instruction
 * builder.
 */
export const RAYDIUM_LAUNCHLAB_PROGRAM_ID = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj' as const;
export const RAYDIUM_LAUNCHLAB_SOURCE_COMMIT = 'e7e0c96fe77bcf6a020b84a44c47a722aac8e359' as const;
export const SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION = 'solana-raydium-launchlab-v1.0.0' as const;
export const RAYDIUM_LAUNCHLAB_POOL_STATE_DISCRIMINATOR = [
  247, 237, 227, 245, 215, 195, 222, 70,
] as const;
export const RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH = 429;

const OFFICIAL_SOURCE_URIS = [
  'https://docs.raydium.io/reference/program-addresses',
  'https://docs.raydium.io/products/launchlab/bonding-curve',
  'https://docs.raydium.io/products/launchlab/instructions',
  'https://docs.raydium.io/sdk-api/anchor-idl',
  `https://github.com/raydium-io/raydium-idl/tree/${RAYDIUM_LAUNCHLAB_SOURCE_COMMIT}`,
  `https://github.com/raydium-io/raydium-idl/blob/${RAYDIUM_LAUNCHLAB_SOURCE_COMMIT}/raydium_launchpad/raydium_launchpad.json`,
  `https://raw.githubusercontent.com/raydium-io/raydium-idl/${RAYDIUM_LAUNCHLAB_SOURCE_COMMIT}/raydium_launchpad/raydium_launchpad.json`,
] as const;

const TRADE_ACCOUNTS = [
  'payer',
  'authority',
  'global_config',
  'platform_config',
  'pool_state',
  'user_base_token',
  'user_quote_token',
  'base_vault',
  'quote_vault',
  'base_token_mint',
  'quote_token_mint',
  'base_token_program',
  'quote_token_program',
  'event_authority',
  'program',
] as const;

const INITIALIZE_ACCOUNTS = [
  'payer',
  'creator',
  'global_config',
  'platform_config',
  'authority',
  'pool_state',
  'base_mint',
  'quote_mint',
  'base_vault',
  'quote_vault',
  'metadata_account',
  'base_token_program',
  'quote_token_program',
  'metadata_program',
  'system_program',
  'rent_program',
  'event_authority',
  'program',
] as const;

const INITIALIZE_TOKEN_2022_ACCOUNTS = [
  'payer',
  'creator',
  'global_config',
  'platform_config',
  'authority',
  'pool_state',
  'base_mint',
  'quote_mint',
  'base_vault',
  'quote_vault',
  'metadata_account',
  'base_token_program',
  'quote_token_program',
  'system_program',
  'event_authority',
  'program',
] as const;

// These are the stable account names from the pinned official IDL. Runtime
// transactions may still carry extra accounts or a deployment-specific
// remaining-account suffix; those are exposed as account_N with a warning.
const MIGRATE_TO_AMM_ACCOUNTS = [
  'payer',
  'base_mint',
  'quote_mint',
  'openbook_program',
  'market',
  'request_queue',
  'event_queue',
  'bids',
  'asks',
  'market_vault_signer',
  'market_base_vault',
  'market_quote_vault',
  'amm_program',
  'amm_pool',
  'amm_authority',
  'amm_open_orders',
  'amm_lp_mint',
  'amm_base_vault',
  'amm_quote_vault',
  'amm_target_orders',
  'amm_config',
  'amm_create_fee_destination',
  'authority',
  'pool_state',
  'global_config',
  'base_vault',
  'quote_vault',
  'pool_lp_token',
  'spl_token_program',
  'associated_token_program',
  'system_program',
  'rent_program',
] as const;

const MIGRATE_TO_CPSWAP_ACCOUNTS = [
  'payer',
  'base_mint',
  'quote_mint',
  'platform_config',
  'cpswap_program',
  'cpswap_pool',
  'cpswap_authority',
  'cpswap_lp_mint',
  'cpswap_base_vault',
  'cpswap_quote_vault',
  'cpswap_config',
  'cpswap_create_pool_fee',
  'cpswap_observation',
  'lock_program',
  'lock_authority',
  'lock_lp_vault',
  'authority',
  'pool_state',
  'global_config',
  'base_vault',
  'quote_vault',
  'pool_lp_token',
  'base_token_program',
  'quote_token_program',
  'associated_token_program',
  'system_program',
  'rent_program',
  'metadata_program',
] as const;

type RaydiumInstructionDefinition = {
  readonly name: string;
  readonly category: SolanaLaunchpadObservation['category'];
  readonly version: SolanaLaunchpadObservation['instructionVersion'];
  readonly discriminator: readonly number[];
  readonly accountNames: readonly string[];
  readonly decodeArguments: (data: Uint8Array) => {
    values: SolanaLaunchpadDecodedArgument[];
    expected: number;
    warnings: string[];
  };
};

function u64(data: Uint8Array, offset: number): string | undefined {
  if (offset < 0 || offset + 8 > data.length) return undefined;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(data[offset + index]!) << BigInt(index * 8);
  }
  return value.toString();
}

function u8(data: Uint8Array, offset: number): string | undefined {
  return offset >= 0 && offset < data.length ? String(data[offset]) : undefined;
}

function u16(data: Uint8Array, offset: number): string | undefined {
  if (offset < 0 || offset + 2 > data.length) return undefined;
  return (BigInt(data[offset]!) | (BigInt(data[offset + 1]!) << 8n)).toString();
}

function u32(data: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > data.length) return undefined;
  return (
    (Number(data[offset]!) |
      (Number(data[offset + 1]!) << 8) |
      (Number(data[offset + 2]!) << 16) |
      (Number(data[offset + 3]!) << 24)) >>>
    0
  );
}

type ParsedField<T> = {
  value?: T;
  next: number;
  warning?: string;
};

export interface RaydiumLaunchlabPoolStateDecode {
  readonly accountName: 'PoolState';
  readonly accountDiscriminator: string;
  readonly accountDataLength: number;
  readonly expectedAccountDataLength: number;
  readonly decodedFields: readonly SolanaLaunchpadDecodedArgument[];
  readonly fieldCoverage: number;
  readonly decodeWarnings: readonly string[];
}

function parsedU64(data: Uint8Array, offset: number, name: string): ParsedField<string> {
  const value = u64(data, offset);
  return value === undefined
    ? { next: data.length, warning: `Missing ${name} u64 field.` }
    : { value, next: offset + 8 };
}

function parsedU8(data: Uint8Array, offset: number, name: string): ParsedField<string> {
  const value = u8(data, offset);
  return value === undefined
    ? { next: data.length, warning: `Missing ${name} u8 field.` }
    : { value, next: offset + 1 };
}

function parsedPubkey(data: Uint8Array, offset: number, name: string): ParsedField<string> {
  if (offset < 0 || offset + 32 > data.length) {
    return { next: data.length, warning: `Missing ${name} pubkey field.` };
  }
  return { value: bs58.encode(data.slice(offset, offset + 32)), next: offset + 32 };
}

function poolStateEnum(
  values: SolanaLaunchpadDecodedArgument[],
  data: Uint8Array,
  offset: number,
  name: string,
  labels: readonly string[],
  warnings: string[],
): { next: number; decoded: boolean } {
  const parsed = parsedU8(data, offset, name);
  if (parsed.value === undefined) {
    warnings.push(parsed.warning!);
    return { next: parsed.next, decoded: false };
  }
  values.push({ name: `${name}_code`, value: parsed.value });
  const label = labels[Number(parsed.value)];
  if (label === undefined) warnings.push(`Unknown ${name} variant ${parsed.value}.`);
  else values.push({ name, value: label });
  return { next: parsed.next, decoded: label !== undefined };
}

/**
 * Decode the source-pinned Raydium LaunchLab PoolState account layout.
 *
 * This is deliberately a raw account decoder: it does not calculate price,
 * graduation, realizable value, ownership, or migration control. A caller
 * must attach the account's finalized provider Evidence and exact Snapshot
 * before promoting these fields into an analysis result. Unknown or truncated
 * bytes remain visible through coverage and warnings.
 */
export function decodeRaydiumLaunchlabPoolState(
  data: Uint8Array,
): RaydiumLaunchlabPoolStateDecode | undefined {
  if (!sameBytes(data.slice(0, 8), RAYDIUM_LAUNCHLAB_POOL_STATE_DISCRIMINATOR)) {
    return undefined;
  }

  const values: SolanaLaunchpadDecodedArgument[] = [];
  const warnings: string[] = [];
  let offset = 8;
  let decodedFieldCount = 0;
  const expectedFieldCount = 31;

  const result = (): RaydiumLaunchlabPoolStateDecode => ({
    accountName: 'PoolState',
    accountDiscriminator: discriminatorHex(data.slice(0, 8)),
    accountDataLength: data.length,
    expectedAccountDataLength: RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH,
    decodedFields: values,
    fieldCoverage: Math.min(1, decodedFieldCount / expectedFieldCount),
    decodeWarnings: warnings,
  });

  const appendU64 = (name: string): boolean => {
    const parsed = parsedU64(data, offset, name);
    if (parsed.value === undefined) {
      warnings.push(parsed.warning!);
      return false;
    }
    values.push({ name, value: parsed.value });
    offset = parsed.next;
    decodedFieldCount += 1;
    return true;
  };

  const appendU8 = (name: string): boolean => {
    const parsed = parsedU8(data, offset, name);
    if (parsed.value === undefined) {
      warnings.push(parsed.warning!);
      return false;
    }
    values.push({ name, value: parsed.value });
    offset = parsed.next;
    decodedFieldCount += 1;
    return true;
  };

  const appendPubkey = (name: string): boolean => {
    const parsed = parsedPubkey(data, offset, name);
    if (parsed.value === undefined) {
      warnings.push(parsed.warning!);
      return false;
    }
    values.push({ name, value: parsed.value });
    offset = parsed.next;
    decodedFieldCount += 1;
    return true;
  };

  if (data.length < RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH) {
    warnings.push(
      `PoolState account data is ${data.length} byte(s); the pinned layout expects ${RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH}.`,
    );
  } else if (data.length > RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH) {
    warnings.push(
      `PoolState account carries ${data.length - RAYDIUM_LAUNCHLAB_POOL_STATE_ACCOUNT_DATA_LENGTH} trailing byte(s) beyond the pinned layout.`,
    );
  }

  if (!appendU64('epoch')) return result();
  if (!appendU8('auth_bump')) return result();
  const status = poolStateEnum(
    values,
    data,
    offset,
    'status',
    ['Fund', 'Migrate', 'Trade'],
    warnings,
  );
  if (!status.decoded) return result();
  offset = status.next;
  decodedFieldCount += 1;
  if (!appendU8('base_decimals')) return result();
  if (!appendU8('quote_decimals')) return result();
  const migrateType = poolStateEnum(
    values,
    data,
    offset,
    'migrate_type',
    ['AMM', 'CPMM'],
    warnings,
  );
  if (!migrateType.decoded) return result();
  offset = migrateType.next;
  decodedFieldCount += 1;

  for (const name of [
    'supply',
    'total_base_sell',
    'virtual_base',
    'virtual_quote',
    'real_base',
    'real_quote',
    'total_quote_fund_raising',
    'quote_protocol_fee',
    'platform_fee',
    'migrate_fee',
    'vesting_schedule.total_locked_amount',
    'vesting_schedule.cliff_period',
    'vesting_schedule.unlock_period',
    'vesting_schedule.start_time',
    'vesting_schedule.allocated_share_amount',
  ]) {
    if (!appendU64(name)) return result();
  }
  for (const name of [
    'global_config',
    'platform_config',
    'base_mint',
    'quote_mint',
    'base_vault',
    'quote_vault',
    'creator',
  ]) {
    if (!appendPubkey(name)) return result();
  }
  if (!appendU8('token_program_flag')) return result();
  const tokenProgramFlag = values.at(-1)?.value;
  if (tokenProgramFlag !== undefined) {
    const flag = Number(tokenProgramFlag);
    values.push({
      name: 'base_token_program',
      value: (flag & 1) === 1 ? 'TOKEN_2022' : 'SPL_TOKEN',
    });
    values.push({
      name: 'quote_token_program',
      value: (flag & 2) === 2 ? 'TOKEN_2022' : 'SPL_TOKEN',
    });
  }
  const fee = poolStateEnum(
    values,
    data,
    offset,
    'amm_creator_fee_on',
    ['QuoteToken', 'BothToken'],
    warnings,
  );
  if (!fee.decoded) return result();
  offset = fee.next;
  decodedFieldCount += 1;
  if (!appendU64('platform_vesting_share')) return result();

  if (offset + 54 > data.length) {
    warnings.push('Missing PoolState padding bytes.');
  }
  return result();
}

function parsedString(data: Uint8Array, offset: number, name: string): ParsedField<string> {
  const length = u32(data, offset);
  if (length === undefined) {
    return { next: data.length, warning: `Missing ${name} string length.` };
  }
  if (length > 2048) {
    return {
      next: data.length,
      warning: `${name} string length ${length} exceeds the 2048-byte observation limit.`,
    };
  }
  if (offset + 4 + length > data.length) {
    return { next: data.length, warning: `Truncated ${name} string field.` };
  }
  try {
    return {
      value: new TextDecoder('utf-8', { fatal: true }).decode(
        data.slice(offset + 4, offset + 4 + length),
      ),
      next: offset + 4 + length,
    };
  } catch {
    return { next: data.length, warning: `Invalid UTF-8 ${name} string.` };
  }
}

function jsonArgument(name: string, value: Record<string, string>): SolanaLaunchpadDecodedArgument {
  return { name, value: JSON.stringify(value) };
}

function structuredInitializeArguments(
  data: Uint8Array,
  options: { ammFee: boolean; transferFeeOption: boolean },
) {
  const values: SolanaLaunchpadDecodedArgument[] = [];
  const warnings: string[] = [];
  let offset = 0;

  const mint = parsedU8(data, offset, 'base_mint_param.decimals');
  if (mint.value === undefined) {
    warnings.push(mint.warning!);
    return {
      values,
      expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
      warnings,
    };
  }
  offset = mint.next;
  const name = parsedString(data, offset, 'base_mint_param.name');
  if (name.value === undefined) {
    warnings.push(name.warning!);
    return {
      values,
      expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
      warnings,
    };
  }
  offset = name.next;
  const symbol = parsedString(data, offset, 'base_mint_param.symbol');
  if (symbol.value === undefined) {
    warnings.push(symbol.warning!);
    return {
      values,
      expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
      warnings,
    };
  }
  offset = symbol.next;
  const uri = parsedString(data, offset, 'base_mint_param.uri');
  if (uri.value === undefined) {
    warnings.push(uri.warning!);
    return {
      values,
      expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
      warnings,
    };
  }
  offset = uri.next;
  values.push(
    jsonArgument('base_mint_param', {
      decimals: mint.value,
      name: name.value,
      symbol: symbol.value,
      uri: uri.value,
    }),
  );

  const curveTag = parsedU8(data, offset, 'curve_param.variant');
  if (curveTag.value === undefined) {
    warnings.push(curveTag.warning!);
    return {
      values,
      expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
      warnings,
    };
  }
  offset = curveTag.next;
  const curveName =
    curveTag.value === '0'
      ? 'Constant'
      : curveTag.value === '1'
        ? 'Fixed'
        : curveTag.value === '2'
          ? 'Linear'
          : undefined;
  if (curveName === undefined) {
    warnings.push(`Unknown curve_param variant ${curveTag.value}.`);
    return {
      values,
      expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
      warnings,
    };
  }
  const curveFieldNames =
    curveName === 'Constant'
      ? ['supply', 'total_base_sell', 'total_quote_fund_raising']
      : ['supply', 'total_quote_fund_raising'];
  const curve: Record<string, string> = { variant: curveName };
  for (const field of curveFieldNames) {
    const parsed = parsedU64(data, offset, `curve_param.${field}`);
    if (parsed.value === undefined) {
      warnings.push(parsed.warning!);
      return {
        values,
        expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
        warnings,
      };
    }
    curve[field] = parsed.value;
    offset = parsed.next;
  }
  const migrateType = parsedU8(data, offset, 'curve_param.migrate_type');
  if (migrateType.value === undefined) {
    warnings.push(migrateType.warning!);
    return {
      values,
      expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
      warnings,
    };
  }
  curve.migrate_type = migrateType.value;
  offset = migrateType.next;
  values.push(jsonArgument('curve_param', curve));

  const vesting: Record<string, string> = {};
  for (const field of ['total_locked_amount', 'cliff_period', 'unlock_period']) {
    const parsed = parsedU64(data, offset, `vesting_param.${field}`);
    if (parsed.value === undefined) {
      warnings.push(parsed.warning!);
      return {
        values,
        expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
        warnings,
      };
    }
    vesting[field] = parsed.value;
    offset = parsed.next;
  }
  values.push(jsonArgument('vesting_param', vesting));

  if (options.ammFee) {
    const fee = parsedU8(data, offset, 'amm_fee_on.variant');
    if (fee.value === undefined) warnings.push(fee.warning!);
    else {
      offset = fee.next;
      const feeName =
        fee.value === '0' ? 'QuoteToken' : fee.value === '1' ? 'BothToken' : undefined;
      if (feeName === undefined) warnings.push(`Unknown amm_fee_on variant ${fee.value}.`);
      else values.push({ name: 'amm_fee_on', value: feeName });
    }
  }

  if (options.transferFeeOption) {
    const option = parsedU8(data, offset, 'transfer_fee_extension_param.option');
    if (option.value === undefined) warnings.push(option.warning!);
    else if (option.value === '0') {
      offset = option.next;
      values.push({ name: 'transfer_fee_extension_param', value: 'None' });
    } else if (option.value === '1') {
      offset = option.next;
      const basisPoints = u16(data, offset);
      const maximumFee = u64(data, offset + 2);
      if (basisPoints === undefined || maximumFee === undefined) {
        warnings.push('Truncated transfer_fee_extension_param.Some fields.');
      } else {
        offset += 10;
        values.push(
          jsonArgument('transfer_fee_extension_param', {
            transfer_fee_basis_points: basisPoints,
            maximum_fee: maximumFee,
          }),
        );
      }
    } else warnings.push(`Unknown transfer_fee_extension_param option ${option.value}.`);
  }

  if (offset < data.length)
    warnings.push(`Ignored ${data.length - offset} trailing argument byte(s).`);
  return {
    values,
    expected: 3 + (options.ammFee ? 1 : 0) + (options.transferFeeOption ? 1 : 0),
    warnings,
  };
}

function primitiveArguments(names: readonly string[], data: Uint8Array) {
  const values: SolanaLaunchpadDecodedArgument[] = [];
  const warnings: string[] = [];
  for (const [index, name] of names.entries()) {
    const value = u64(data, index * 8);
    if (value === undefined) warnings.push(`Missing ${name} u64 argument.`);
    else values.push({ name, value });
  }
  return { values, expected: names.length, warnings };
}

function migrationArguments(data: Uint8Array) {
  const values = primitiveArguments(['base_lot_size', 'quote_lot_size'], data);
  const nonce = u8(data, 16);
  if (nonce === undefined) values.warnings.push('Missing market_vault_signer_nonce u8 argument.');
  else values.values.push({ name: 'market_vault_signer_nonce', value: nonce });
  return { ...values, expected: 3 };
}

const INSTRUCTIONS: readonly RaydiumInstructionDefinition[] = [
  {
    name: 'initialize',
    category: 'CREATE',
    version: 'CURRENT',
    discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
    accountNames: INITIALIZE_ACCOUNTS,
    decodeArguments: (data) =>
      structuredInitializeArguments(data, { ammFee: false, transferFeeOption: false }),
  },
  {
    name: 'initialize_v2',
    category: 'CREATE',
    version: 'V2',
    discriminator: [67, 153, 175, 39, 218, 16, 38, 32],
    accountNames: INITIALIZE_ACCOUNTS,
    decodeArguments: (data) =>
      structuredInitializeArguments(data, { ammFee: true, transferFeeOption: false }),
  },
  {
    name: 'initialize_with_token_2022',
    category: 'CREATE',
    version: 'CURRENT',
    discriminator: [37, 190, 126, 222, 44, 154, 171, 17],
    accountNames: INITIALIZE_TOKEN_2022_ACCOUNTS,
    decodeArguments: (data) =>
      structuredInitializeArguments(data, { ammFee: true, transferFeeOption: true }),
  },
  {
    name: 'buy_exact_in',
    category: 'TRADE',
    version: 'CURRENT',
    discriminator: [250, 234, 13, 123, 213, 156, 19, 236],
    accountNames: TRADE_ACCOUNTS,
    decodeArguments: (data) =>
      primitiveArguments(['amount_in', 'minimum_amount_out', 'share_fee_rate'], data),
  },
  {
    name: 'buy_exact_out',
    category: 'TRADE',
    version: 'CURRENT',
    discriminator: [24, 211, 116, 40, 105, 3, 153, 56],
    accountNames: TRADE_ACCOUNTS,
    decodeArguments: (data) =>
      primitiveArguments(['amount_out', 'maximum_amount_in', 'share_fee_rate'], data),
  },
  {
    name: 'sell_exact_in',
    category: 'TRADE',
    version: 'CURRENT',
    discriminator: [149, 39, 222, 155, 211, 124, 152, 26],
    accountNames: TRADE_ACCOUNTS,
    decodeArguments: (data) =>
      primitiveArguments(['amount_in', 'minimum_amount_out', 'share_fee_rate'], data),
  },
  {
    name: 'sell_exact_out',
    category: 'TRADE',
    version: 'CURRENT',
    discriminator: [95, 200, 71, 34, 8, 9, 11, 166],
    accountNames: TRADE_ACCOUNTS,
    decodeArguments: (data) =>
      primitiveArguments(['amount_out', 'maximum_amount_in', 'share_fee_rate'], data),
  },
  {
    name: 'migrate_to_amm',
    category: 'MIGRATION',
    version: 'CURRENT',
    discriminator: [207, 82, 192, 145, 254, 207, 145, 223],
    accountNames: MIGRATE_TO_AMM_ACCOUNTS,
    decodeArguments: migrationArguments,
  },
  {
    name: 'migrate_to_cpswap',
    category: 'MIGRATION',
    version: 'CURRENT',
    discriminator: [136, 92, 200, 103, 28, 218, 144, 140],
    accountNames: MIGRATE_TO_CPSWAP_ACCOUNTS,
    decodeArguments: () => ({ values: [], expected: 0, warnings: [] }),
  },
];

const DESCRIPTOR = {
  programId: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  sourceCommit: RAYDIUM_LAUNCHLAB_SOURCE_COMMIT,
  instructions: INSTRUCTIONS.map(({ name, category, version, discriminator, accountNames }) => ({
    name,
    category,
    version,
    discriminator,
    accountNames,
  })),
};

/** Hash of the compact clean-room descriptor, not a claim that core copied the SDK/IDL. */
export const RAYDIUM_LAUNCHLAB_DESCRIPTOR_SHA256 = hashPayload(DESCRIPTOR);

/**
 * A source-pinned but evidence-incomplete version record. Keeping it visible
 * lets the API explain exactly why activation is blocked instead of hiding a
 * decoder that still lacks a real finalized historical fixture.
 */
export const RAYDIUM_LAUNCHLAB_PROTOCOL_VERSION = ProtocolDeploymentVersionSchema.parse({
  platform: 'raydium-launchlab',
  ledger: 'SOLANA',
  chain: 'solana-mainnet',
  deploymentId: `raydium-launchlab-solana-mainnet-${RAYDIUM_LAUNCHLAB_SOURCE_COMMIT.slice(0, 12)}`,
  validFrom: { state: 'known', value: '0' },
  validTo: { state: 'unknown', reason: 'NOT_APPLICABLE' },
  programOrContract: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  factories: [],
  abiOrIdlHash: RAYDIUM_LAUNCHLAB_DESCRIPTOR_SHA256,
  sourceCommit: `raydium-io/raydium-idl@${RAYDIUM_LAUNCHLAB_SOURCE_COMMIT}`,
  officialSourceUris: [...OFFICIAL_SOURCE_URIS],
  evidenceIds: [],
});

function parseInstructionData(dataBase58: string): Uint8Array | undefined {
  try {
    const data = bs58.decode(dataBase58);
    return data.length < 8 ? undefined : data;
  } catch {
    return undefined;
  }
}

function sameBytes(left: Uint8Array, right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function discriminatorHex(data: Uint8Array): string {
  return [...data].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function makeObservation(input: {
  instruction: SolanaInstructionObservation;
  transaction: SolanaTransactionRecord;
  snapshot: Extract<AnalysisSnapshot, { ledger: 'SOLANA' }>;
  definition: RaydiumInstructionDefinition;
  evidenceIds: readonly string[];
  data: Uint8Array;
}): SolanaLaunchpadObservation {
  const decoded = input.definition.decodeArguments(input.data.slice(8));
  const resolved =
    input.instruction.accounts.state === 'known' ? input.instruction.accounts.value : undefined;
  const accounts = input.instruction.accountIndexes.map((index, position) => ({
    index,
    name: input.definition.accountNames[position] ?? `account_${position}`,
    ...(resolved?.[position] === undefined ? {} : { address: resolved[position] }),
  }));
  const expectedAccounts = Math.max(1, input.definition.accountNames.length);
  const accountWarnings = [
    ...(resolved === undefined ? ['Instruction account addresses are unresolved.'] : []),
  ];
  if (input.instruction.accountIndexes.length < expectedAccounts) {
    accountWarnings.push(
      `Instruction account layout is short by ${expectedAccounts - input.instruction.accountIndexes.length} account(s).`,
    );
  } else if (input.instruction.accountIndexes.length > expectedAccounts) {
    accountWarnings.push(
      `Instruction carries ${input.instruction.accountIndexes.length - expectedAccounts} trailing account(s) outside the pinned layout.`,
    );
  }
  const evidenceIds = sortedUnique(input.evidenceIds);
  if (evidenceIds.length === 0)
    throw new Error('Raydium LaunchLab decoding requires Evidence IDs.');
  const base = {
    schemaVersion: 'solana-launchpad-observation-v1' as const,
    platform: 'RAYDIUM_LAUNCHLAB' as const,
    programId: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
    deploymentId: `raydium-launchlab-solana-mainnet-${RAYDIUM_LAUNCHLAB_SOURCE_COMMIT.slice(0, 12)}`,
    sourceCommit: RAYDIUM_LAUNCHLAB_SOURCE_COMMIT,
    abiOrIdlHash: RAYDIUM_LAUNCHLAB_DESCRIPTOR_SHA256,
    officialSourceUris: [...OFFICIAL_SOURCE_URIS],
    signature: input.transaction.signature,
    slot: input.transaction.slot,
    instructionPath: input.instruction.path,
    instructionName: input.definition.name,
    instructionVersion: input.definition.version,
    category: input.definition.category,
    discriminator: discriminatorHex(input.data.slice(0, 8)),
    accountIndexes: [...input.instruction.accountIndexes],
    accounts,
    accountCoverage: Math.min(
      1,
      accounts.filter((account) => account.address !== undefined).length / expectedAccounts,
    ),
    decodedArguments: decoded.values,
    argumentCoverage:
      decoded.expected === 0 ? 1 : Math.min(1, decoded.values.length / decoded.expected),
    decodeWarnings: [...accountWarnings, ...decoded.warnings],
    execution:
      input.transaction.success === true
        ? 'SUCCESS'
        : input.transaction.success === false
          ? 'FAILED'
          : 'UNKNOWN',
    evidenceIds,
    snapshot: input.snapshot,
  };
  const id = `slo_${hashPayload({ schema: base.schemaVersion, value: base }).slice(0, 24)}`;
  const withId = { ...base, id };
  return SolanaLaunchpadObservationSchema.parse({ ...withId, resultHash: hashPayload(withId) });
}

export function decodeRaydiumLaunchlabInstruction(input: {
  instruction: SolanaInstructionObservation;
  transaction: SolanaTransactionRecord;
  snapshot: Extract<AnalysisSnapshot, { ledger: 'SOLANA' }>;
  evidenceIds: readonly string[];
}): SolanaLaunchpadObservation | undefined {
  const programId =
    input.instruction.programId.state === 'known' ? input.instruction.programId.value : undefined;
  if (programId !== RAYDIUM_LAUNCHLAB_PROGRAM_ID) return undefined;
  const data = parseInstructionData(input.instruction.dataBase58);
  if (data === undefined) return undefined;
  const definition = INSTRUCTIONS.find((candidate) =>
    sameBytes(data.slice(0, 8), candidate.discriminator),
  );
  if (definition === undefined) return undefined;
  return makeObservation({ ...input, definition, data });
}

export function decodeRaydiumLaunchlabInstructions(input: {
  transaction: SolanaTransactionRecord;
  semantics: SolanaTransactionSemantics;
  snapshot: Extract<AnalysisSnapshot, { ledger: 'SOLANA' }>;
  evidenceIdsForInstruction: (instructionPath: string) => readonly string[];
}): SolanaLaunchpadObservation[] {
  return [...input.semantics.outerInstructions, ...input.semantics.innerInstructions]
    .flatMap((instruction) => {
      const observation = decodeRaydiumLaunchlabInstruction({
        instruction,
        transaction: input.transaction,
        snapshot: input.snapshot,
        evidenceIds: input.evidenceIdsForInstruction(instruction.path),
      });
      return observation === undefined ? [] : [observation];
    })
    .sort((left, right) => left.instructionPath.localeCompare(right.instructionPath));
}
