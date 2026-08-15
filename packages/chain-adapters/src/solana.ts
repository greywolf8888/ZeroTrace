import { hashPayload } from '@zerotrace/evidence';
import {
  ChainAnchorReadSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type ChainAnchorRead,
  type ProviderCapability,
  type ProviderHealth,
  type SolanaSnapshotSchema,
} from '@zerotrace/schemas';
import type { z } from 'zod';
import bs58 from 'bs58';

import { ProviderError, toProviderError } from './errors.js';
import {
  requestJsonRpcSourced,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from './transport.js';

export type SolanaSnapshot = z.infer<typeof SolanaSnapshotSchema>;

export interface SolanaMessageHeader {
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
}

export interface SolanaCompiledInstruction {
  accounts: number[];
  data: string;
  programIdIndex: number;
  stackHeight?: number;
}

export interface SolanaAddressTableLookup {
  accountKey: string;
  writableIndexes: number[];
  readonlyIndexes: number[];
}

export interface SolanaLoadedAddresses {
  writable: string[];
  readonly: string[];
}

export interface SolanaInnerInstructionGroup {
  index: number;
  instructions: SolanaCompiledInstruction[];
}

export interface SolanaTokenBalanceRecord {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  amount: string;
  decimals: number;
}

export interface SolanaTransactionRecord {
  signature: string;
  signatures: string[];
  slot: string;
  blockTime?: string;
  version: 'legacy' | string;
  recentBlockhash: string;
  header: SolanaMessageHeader;
  staticAccountKeys: string[];
  addressTableLookups: SolanaAddressTableLookup[];
  instructions: SolanaCompiledInstruction[];
  feeLamports?: string;
  success?: boolean;
  executionError?: Readonly<Record<string, unknown>> | string;
  loadedAddresses?: SolanaLoadedAddresses;
  innerInstructions?: SolanaInnerInstructionGroup[];
  preBalances?: string[];
  postBalances?: string[];
  preTokenBalances?: SolanaTokenBalanceRecord[];
  postTokenBalances?: SolanaTokenBalanceRecord[];
  logMessages?: string[];
  computeUnitsConsumed?: string;
  raw: Readonly<Record<string, unknown>>;
}

export interface SolanaAccountState {
  data: readonly [string, 'base64'];
  executable: boolean;
  lamports: string;
  owner: string;
  rentEpoch: string;
  space: number;
}

export interface SolanaAccountInfoResponse {
  context: { slot: number; apiVersion?: string };
  value: SolanaAccountState | null;
}

export interface SolanaMultipleAccountsResponse {
  context: { slot: number; apiVersion?: string };
  value: Array<SolanaAccountState | null>;
}

const ALLOWED_SOLANA_METHODS = new Set([
  'getHealth',
  'getVersion',
  'getSlot',
  'getBlockHeight',
  'getLatestBlockhash',
  'getBlock',
  'getTransaction',
  'getSignaturesForAddress',
  'getAccountInfo',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getBalance',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTokenSupply',
  'getTokenLargestAccounts',
  'getSignatureStatuses',
  'getRecentPrioritizationFees',
  'simulateTransaction',
]);

const SOLANA_CAPABILITIES: ProviderCapability[] = [
  'CURRENT_STATE',
  'BALANCE',
  'BLOCK',
  'TRANSACTION',
  'INSTRUCTION',
  'SIMULATION',
];

const SOLANA_BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const UNSIGNED_QUANTITY = /^(?:0|[1-9][0-9]*)$/;
const SIGNED_QUANTITY = /^-?(?:0|[1-9][0-9]*)$/;
const BASE64_DATA = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface SolanaAdapterConfig {
  id: string;
  commitment: 'processed' | 'confirmed' | 'finalized';
  adapterVersion?: string;
}

function requireSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return value;
}

function requireUnsignedQuantity(value: unknown, field: string): string {
  if (typeof value === 'number') return String(requireSafeInteger(value, field));
  if (typeof value !== 'string' || !UNSIGNED_QUANTITY.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return value;
}

function requireSafeQuantityNumber(value: unknown, field: string): number {
  const quantity = requireUnsignedQuantity(value, field);
  const parsed = Number(quantity);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an unsafe ${field}.`);
  }
  return parsed;
}

function requirePosition(value: string): number {
  if (!UNSIGNED_QUANTITY.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana slot must be unsigned decimal.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana slot exceeds safe JSON-RPC precision.');
  }
  return parsed;
}

function sourceSet(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function requireBase58(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SOLANA_BASE58.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return value;
}

function requirePublicKey(value: unknown, field: string): string {
  const encoded = requireBase58(value, field);
  try {
    if (bs58.decode(encoded).length !== 32) throw new Error('invalid public key length');
  } catch {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return encoded;
}

function requireSignature(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  try {
    if (bs58.decode(value).length !== 64) throw new Error('invalid signature length');
  } catch {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return value as Record<string, unknown>;
}

function requireUnsignedByte(value: unknown, field: string): number {
  const parsed = requireSafeInteger(value, field);
  if (parsed > 255) {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned an invalid ${field}.`);
  }
  return parsed;
}

function requireBase58Data(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned invalid ${field}.`);
  }
  try {
    bs58.decode(value);
  } catch {
    throw new ProviderError('INVALID_RESPONSE', `Solana provider returned invalid ${field}.`);
  }
  return value;
}

function parseMessageHeader(value: unknown, staticAccountCount: number): SolanaMessageHeader {
  const header = requireRecord(value, 'transaction message header');
  const numRequiredSignatures = requireUnsignedByte(
    header.numRequiredSignatures,
    'required signature count',
  );
  const numReadonlySignedAccounts = requireUnsignedByte(
    header.numReadonlySignedAccounts,
    'readonly signed account count',
  );
  const numReadonlyUnsignedAccounts = requireUnsignedByte(
    header.numReadonlyUnsignedAccounts,
    'readonly unsigned account count',
  );
  if (
    numRequiredSignatures === 0 ||
    numRequiredSignatures > staticAccountCount ||
    numReadonlySignedAccounts >= numRequiredSignatures ||
    numReadonlyUnsignedAccounts > staticAccountCount - numRequiredSignatures
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana transaction message header is inconsistent with its static account keys.',
    );
  }
  return {
    numRequiredSignatures,
    numReadonlySignedAccounts,
    numReadonlyUnsignedAccounts,
  };
}

function parseCompiledInstruction(value: unknown, field: string): SolanaCompiledInstruction {
  const instruction = requireRecord(value, field);
  if (!Array.isArray(instruction.accounts)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Solana provider returned invalid ${field} accounts.`,
    );
  }
  const stackHeight = instruction.stackHeight;
  return {
    accounts: instruction.accounts.map((account, index) =>
      requireUnsignedByte(account, `${field} account index ${index}`),
    ),
    data: requireBase58Data(instruction.data, `${field} data`),
    programIdIndex: requireUnsignedByte(instruction.programIdIndex, `${field} program index`),
    ...(stackHeight === undefined || stackHeight === null
      ? {}
      : { stackHeight: requireUnsignedByte(stackHeight, `${field} stack height`) }),
  };
}

function parseAddressTableLookups(value: unknown): SolanaAddressTableLookup[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana transaction address-table lookups are invalid.',
    );
  }
  return value.map((item, lookupIndex) => {
    const lookup = requireRecord(item, `address-table lookup ${lookupIndex}`);
    if (!Array.isArray(lookup.writableIndexes) || !Array.isArray(lookup.readonlyIndexes)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `Solana address-table lookup ${lookupIndex} indexes are invalid.`,
      );
    }
    return {
      accountKey: requirePublicKey(lookup.accountKey, `address-table lookup ${lookupIndex} key`),
      writableIndexes: lookup.writableIndexes.map((index, position) =>
        requireUnsignedByte(
          index,
          `address-table lookup ${lookupIndex} writable index ${position}`,
        ),
      ),
      readonlyIndexes: lookup.readonlyIndexes.map((index, position) =>
        requireUnsignedByte(
          index,
          `address-table lookup ${lookupIndex} readonly index ${position}`,
        ),
      ),
    };
  });
}

function parseLoadedAddresses(value: unknown): SolanaLoadedAddresses | undefined {
  if (value === undefined) return undefined;
  const loaded = requireRecord(value, 'loaded addresses');
  if (!Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana loaded addresses are invalid.');
  }
  return {
    writable: loaded.writable.map((address, index) =>
      requirePublicKey(address, `loaded writable address ${index}`),
    ),
    readonly: loaded.readonly.map((address, index) =>
      requirePublicKey(address, `loaded readonly address ${index}`),
    ),
  };
}

function parseInnerInstructions(
  value: unknown,
  outerInstructionCount: number,
): SolanaInnerInstructionGroup[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana inner instructions are invalid.');
  }
  const groups = value.map((item, groupIndex) => {
    const group = requireRecord(item, `inner instruction group ${groupIndex}`);
    const index = requireUnsignedByte(group.index, `inner instruction group ${groupIndex} index`);
    if (index >= outerInstructionCount || !Array.isArray(group.instructions)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `Solana inner instruction group ${groupIndex} is inconsistent with the message.`,
      );
    }
    return {
      index,
      instructions: group.instructions.map((instruction, instructionIndex) =>
        parseCompiledInstruction(
          instruction,
          `inner instruction ${groupIndex}:${instructionIndex}`,
        ),
      ),
    };
  });
  if (new Set(groups.map((group) => group.index)).size !== groups.length) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana inner instruction groups contain duplicate outer indexes.',
    );
  }
  return groups.sort((left, right) => left.index - right.index);
}

function parseBalanceArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Solana transaction ${field} are invalid.`);
  }
  return value.map((balance, index) => requireUnsignedQuantity(balance, `${field} ${index}`));
}

function parseTokenBalances(value: unknown, field: string): SolanaTokenBalanceRecord[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Solana transaction ${field} are invalid.`);
  }
  const balances = value.map((item, index) => {
    const balance = requireRecord(item, `${field} ${index}`);
    const uiTokenAmount = requireRecord(balance.uiTokenAmount, `${field} ${index} token amount`);
    const owner = balance.owner;
    const programId = balance.programId;
    return {
      accountIndex: requireUnsignedByte(balance.accountIndex, `${field} ${index} account index`),
      mint: requirePublicKey(balance.mint, `${field} ${index} mint`),
      ...(owner === undefined ? {} : { owner: requirePublicKey(owner, `${field} ${index} owner`) }),
      ...(programId === undefined
        ? {}
        : { programId: requirePublicKey(programId, `${field} ${index} program`) }),
      amount: requireUnsignedQuantity(uiTokenAmount.amount, `${field} ${index} amount`),
      decimals: requireUnsignedByte(uiTokenAmount.decimals, `${field} ${index} decimals`),
    };
  });
  const identities = balances.map((balance) => `${balance.accountIndex}:${balance.mint}`);
  if (new Set(identities).size !== identities.length) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Solana transaction ${field} contain duplicate account/mint identities.`,
    );
  }
  return balances;
}

function parseLogMessages(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((message) => typeof message !== 'string')) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana transaction log messages are invalid.');
  }
  return value as string[];
}

function parseTransaction(
  value: unknown,
  expectedSignature: string,
): SolanaTransactionRecord | null {
  if (value === null) return null;
  const response = requireRecord(value, 'transaction response');
  const slot = requireSafeQuantityNumber(response.slot, 'transaction slot');
  const transaction = requireRecord(response.transaction, 'transaction');
  if (!Array.isArray(transaction.signatures) || transaction.signatures.length === 0) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana transaction signatures are invalid.');
  }
  const signatures = transaction.signatures.map((signature, index) =>
    requireSignature(signature, `transaction signature ${index}`),
  );
  const primarySignature = signatures[0]!;
  if (primarySignature !== expectedSignature) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana transaction identity does not match the requested signature.',
    );
  }
  const message = requireRecord(transaction.message, 'transaction message');
  if (!Array.isArray(message.accountKeys) || message.accountKeys.length === 0) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana transaction message account keys are invalid.',
    );
  }
  const staticAccountKeys = message.accountKeys.map((address, index) =>
    requirePublicKey(address, `transaction static account ${index}`),
  );
  if (new Set(staticAccountKeys).size !== staticAccountKeys.length) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana transaction message contains duplicate static account keys.',
    );
  }
  const header = parseMessageHeader(message.header, staticAccountKeys.length);
  if (signatures.length !== header.numRequiredSignatures) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana transaction signature count does not match the message header.',
    );
  }
  if (!Array.isArray(message.instructions)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana transaction instructions are invalid.');
  }
  const instructions = message.instructions.map((instruction, index) =>
    parseCompiledInstruction(instruction, `outer instruction ${index}`),
  );
  const addressTableLookups = parseAddressTableLookups(message.addressTableLookups);
  const recentBlockhash = requirePublicKey(message.recentBlockhash, 'transaction recent blockhash');
  const version = response.version;
  if (
    version !== 'legacy' &&
    (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana transaction version is invalid.');
  }
  if (version === 'legacy' && addressTableLookups.length > 0) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Legacy Solana transactions cannot contain address-table lookups.',
    );
  }
  const blockTime = optionalBlockTimestamp(response.blockTime);
  let feeLamports: string | undefined;
  let success: boolean | undefined;
  let executionError: Readonly<Record<string, unknown>> | string | undefined;
  let loadedAddresses: SolanaLoadedAddresses | undefined;
  let innerInstructions: SolanaInnerInstructionGroup[] | undefined;
  let preBalances: string[] | undefined;
  let postBalances: string[] | undefined;
  let preTokenBalances: SolanaTokenBalanceRecord[] | undefined;
  let postTokenBalances: SolanaTokenBalanceRecord[] | undefined;
  let logMessages: string[] | undefined;
  let computeUnitsConsumed: string | undefined;
  if (response.meta !== null) {
    const meta = requireRecord(response.meta, 'transaction metadata');
    if (!Object.hasOwn(meta, 'err')) {
      throw new ProviderError('INVALID_RESPONSE', 'Solana transaction metadata is missing err.');
    }
    feeLamports = requireUnsignedQuantity(meta.fee, 'transaction fee');
    success = meta.err === null;
    if (meta.err !== null) {
      if (typeof meta.err === 'string' && meta.err.length > 0) {
        executionError = meta.err;
      } else if (typeof meta.err === 'object' && meta.err !== null && !Array.isArray(meta.err)) {
        executionError = meta.err as Readonly<Record<string, unknown>>;
      } else {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Solana transaction execution error is invalid.',
        );
      }
    }
    loadedAddresses = parseLoadedAddresses(meta.loadedAddresses);
    innerInstructions = parseInnerInstructions(meta.innerInstructions, instructions.length);
    preBalances = parseBalanceArray(meta.preBalances, 'pre-balances');
    postBalances = parseBalanceArray(meta.postBalances, 'post-balances');
    if (preBalances.length !== postBalances.length) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Solana transaction pre/post balance cardinality does not match.',
      );
    }
    preTokenBalances = parseTokenBalances(meta.preTokenBalances, 'pre-token balances');
    postTokenBalances = parseTokenBalances(meta.postTokenBalances, 'post-token balances');
    if ((preTokenBalances === undefined) !== (postTokenBalances === undefined)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Solana transaction token-balance recording is incomplete.',
      );
    }
    logMessages = parseLogMessages(meta.logMessages);
    if (meta.computeUnitsConsumed !== undefined) {
      computeUnitsConsumed = requireUnsignedQuantity(
        meta.computeUnitsConsumed,
        'transaction compute units consumed',
      );
    }
  }
  const expectedWritableLookupCount = addressTableLookups.reduce(
    (count, lookup) => count + lookup.writableIndexes.length,
    0,
  );
  const expectedReadonlyLookupCount = addressTableLookups.reduce(
    (count, lookup) => count + lookup.readonlyIndexes.length,
    0,
  );
  if (
    loadedAddresses !== undefined &&
    (loadedAddresses.writable.length !== expectedWritableLookupCount ||
      loadedAddresses.readonly.length !== expectedReadonlyLookupCount)
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana loaded-address cardinality does not match address-table lookups.',
    );
  }
  const addressResolutionComplete =
    addressTableLookups.length === 0 || loadedAddresses !== undefined;
  const resolvedAccountCount =
    staticAccountKeys.length +
    (loadedAddresses?.writable.length ?? 0) +
    (loadedAddresses?.readonly.length ?? 0);
  if (
    preBalances !== undefined &&
    addressResolutionComplete &&
    preBalances.length !== resolvedAccountCount
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana balance cardinality does not match resolved transaction accounts.',
    );
  }
  if (addressResolutionComplete) {
    const compiledInstructions = [
      ...instructions,
      ...(innerInstructions?.flatMap((group) => group.instructions) ?? []),
    ];
    for (const instruction of compiledInstructions) {
      if (
        instruction.programIdIndex >= resolvedAccountCount ||
        instruction.accounts.some((index) => index >= resolvedAccountCount)
      ) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Solana compiled instruction references an unresolved account index.',
        );
      }
    }
    for (const balance of [...(preTokenBalances ?? []), ...(postTokenBalances ?? [])]) {
      if (balance.accountIndex >= resolvedAccountCount) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Solana token balance references an unresolved account index.',
        );
      }
    }
  }
  return {
    signature: primarySignature,
    signatures,
    slot: String(slot),
    ...(blockTime === undefined ? {} : { blockTime }),
    version: version === 'legacy' ? version : String(version),
    recentBlockhash,
    header,
    staticAccountKeys,
    addressTableLookups,
    instructions,
    ...(feeLamports === undefined ? {} : { feeLamports }),
    ...(success === undefined ? {} : { success }),
    ...(executionError === undefined ? {} : { executionError }),
    ...(loadedAddresses === undefined ? {} : { loadedAddresses }),
    ...(innerInstructions === undefined ? {} : { innerInstructions }),
    ...(preBalances === undefined ? {} : { preBalances }),
    ...(postBalances === undefined ? {} : { postBalances }),
    ...(preTokenBalances === undefined ? {} : { preTokenBalances }),
    ...(postTokenBalances === undefined ? {} : { postTokenBalances }),
    ...(logMessages === undefined ? {} : { logMessages }),
    ...(computeUnitsConsumed === undefined ? {} : { computeUnitsConsumed }),
    raw: response,
  };
}

function optionalBlockTimestamp(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !SIGNED_QUANTITY.test(text)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana provider returned an invalid block time.');
  }
  const seconds = Number(text);
  if (
    !Number.isSafeInteger(seconds) ||
    Math.abs(seconds) > Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana block time is outside the safe range.');
  }
  const date = new Date(seconds * 1_000);
  if (Number.isNaN(date.getTime())) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana provider returned an invalid block time.');
  }
  return date.toISOString();
}

function parseAccountValue(raw: unknown): SolanaAccountState | null {
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account value is invalid.');
  }
  const account = raw as Record<string, unknown>;
  const data = account.data;
  if (
    !Array.isArray(data) ||
    data.length !== 2 ||
    typeof data[0] !== 'string' ||
    !BASE64_DATA.test(data[0]) ||
    data[1] !== 'base64'
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account data is invalid.');
  }
  if (typeof account.executable !== 'boolean') {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account executable flag is invalid.');
  }
  const space = requireSafeQuantityNumber(account.space, 'account space');
  const bytes = Buffer.from(data[0], 'base64');
  if (bytes.length !== space) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account data length does not match space.');
  }
  return {
    data: [data[0], 'base64'],
    executable: account.executable,
    lamports: requireUnsignedQuantity(account.lamports, 'account lamports'),
    owner: requirePublicKey(account.owner, 'account owner'),
    rentEpoch: requireUnsignedQuantity(account.rentEpoch, 'account rent epoch'),
    space,
  };
}

function parseAccountContext(
  raw: unknown,
  minimumContextSlot: number | undefined,
): { response: Record<string, unknown>; context: SolanaAccountInfoResponse['context'] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account response must be an object.');
  }
  const response = raw as Record<string, unknown>;
  const context = response.context;
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account context is invalid.');
  }
  const contextRecord = context as Record<string, unknown>;
  const slot = requireSafeQuantityNumber(contextRecord.slot, 'account context slot');
  if (minimumContextSlot !== undefined && slot < minimumContextSlot) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana account response predates the requested minimum context slot.',
    );
  }
  const apiVersion = contextRecord.apiVersion;
  if (apiVersion !== undefined && typeof apiVersion !== 'string') {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account API version is invalid.');
  }
  return {
    response,
    context: { slot, ...(apiVersion === undefined ? {} : { apiVersion }) },
  };
}

function parseAccountInfo(
  raw: unknown,
  minimumContextSlot: number | undefined,
): SolanaAccountInfoResponse {
  const { response, context } = parseAccountContext(raw, minimumContextSlot);
  if (!Object.hasOwn(response, 'value')) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana account response is missing value.');
  }
  return {
    context,
    value: parseAccountValue(response.value),
  };
}

function parseMultipleAccounts(
  raw: unknown,
  expectedLength: number,
  minimumContextSlot: number | undefined,
): SolanaMultipleAccountsResponse {
  const { response, context } = parseAccountContext(raw, minimumContextSlot);
  if (!Array.isArray(response.value) || response.value.length !== expectedLength) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana multiple-account response cardinality is invalid.',
    );
  }
  return { context, value: response.value.map((item) => parseAccountValue(item)) };
}

export class SolanaLedgerAdapter {
  readonly ledger = 'SOLANA' as const;
  readonly config: SolanaAdapterConfig;
  readonly #transport: JsonRpcTransport;

  constructor(config: SolanaAdapterConfig, transport: JsonRpcTransport) {
    this.config = config;
    this.#transport = transport;
  }

  get sourceId(): string {
    return this.#transport.lastEndpointId ?? this.#transport.endpointId;
  }

  async read<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<T> {
    return (await this.readSourced<T>(method, params, options)).value;
  }

  async readSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    if (!ALLOWED_SOLANA_METHODS.has(method)) {
      throw new ProviderError(
        'METHOD_NOT_ALLOWED',
        `Solana method ${method} is outside the read-only allowlist.`,
      );
    }
    return requestJsonRpcSourced<T>(this.#transport, method, params, options);
  }

  async getAccountInfo(
    address: string,
    minimumContextSlot?: number,
  ): Promise<SolanaAccountInfoResponse> {
    return (await this.getAccountInfoObservation(address, minimumContextSlot)).value;
  }

  async getAccountInfoObservation(
    address: string,
    minimumContextSlot?: number,
  ): Promise<TransportObservation<SolanaAccountInfoResponse>> {
    requirePublicKey(address, 'account address');
    if (minimumContextSlot !== undefined) {
      requireSafeInteger(minimumContextSlot, 'minimum context slot');
    }
    const observation = await this.readSourced<unknown>('getAccountInfo', [
      address,
      {
        encoding: 'base64',
        commitment: this.config.commitment,
        ...(minimumContextSlot === undefined ? {} : { minContextSlot: minimumContextSlot }),
      },
    ]);
    return { ...observation, value: parseAccountInfo(observation.value, minimumContextSlot) };
  }

  async getMultipleAccounts(
    addresses: readonly string[],
    minimumContextSlot?: number,
  ): Promise<SolanaMultipleAccountsResponse> {
    return (await this.getMultipleAccountsObservation(addresses, minimumContextSlot)).value;
  }

  async getMultipleAccountsObservation(
    addresses: readonly string[],
    minimumContextSlot?: number,
  ): Promise<TransportObservation<SolanaMultipleAccountsResponse>> {
    if (addresses.length === 0 || addresses.length > 100) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Solana multiple-account reads require between one and 100 addresses.',
      );
    }
    const canonicalAddresses = addresses.map((address) =>
      requirePublicKey(address, 'account address'),
    );
    if (new Set(canonicalAddresses).size !== canonicalAddresses.length) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Solana multiple-account addresses must be unique.',
      );
    }
    if (minimumContextSlot !== undefined) {
      requireSafeInteger(minimumContextSlot, 'minimum context slot');
    }
    const observation = await this.readSourced<unknown>('getMultipleAccounts', [
      canonicalAddresses,
      {
        encoding: 'base64',
        commitment: this.config.commitment,
        ...(minimumContextSlot === undefined ? {} : { minContextSlot: minimumContextSlot }),
      },
    ]);
    return {
      ...observation,
      value: parseMultipleAccounts(
        observation.value,
        canonicalAddresses.length,
        minimumContextSlot,
      ),
    };
  }

  async getTransaction(
    signature: string,
    options: TransportReadOptions = {},
  ): Promise<SolanaTransactionRecord | null> {
    return (await this.getTransactionObservation(signature, options)).value;
  }

  async getTransactionObservation(
    signature: string,
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<SolanaTransactionRecord | null>> {
    const normalizedSignature = requireSignature(signature, 'requested transaction signature');
    const observation = await this.readSourced<unknown>(
      'getTransaction',
      [
        normalizedSignature,
        {
          encoding: 'json',
          commitment: this.config.commitment,
          maxSupportedTransactionVersion: 0,
        },
      ],
      options,
    );
    return {
      ...observation,
      value: parseTransaction(observation.value, normalizedSignature),
    };
  }

  async probe(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const [health, rawSlot] = await Promise.all([
        this.read<string>('getHealth'),
        this.read<number>('getSlot', [{ commitment: this.config.commitment }], {
          cacheMode: 'bypass',
        }),
      ]);
      if (health !== 'ok') {
        throw new ProviderError('INVALID_RESPONSE', 'Solana getHealth did not return ok.');
      }
      const slot = requireSafeInteger(rawSlot, 'slot').toString();
      return {
        id: this.config.id,
        ledger: 'SOLANA',
        status: 'UP',
        capabilities: SOLANA_CAPABILITIES,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        lastSuccessAt: checkedAt,
        head: knownValue(slot),
        lag: unknownValue('NOT_QUERIED', 'No trusted comparison slot is configured.'),
        ...(this.#transport.diagnostics === undefined
          ? {}
          : { transport: this.#transport.diagnostics() }),
      };
    } catch (error) {
      const providerError = toProviderError(error);
      return {
        id: this.config.id,
        ledger: 'SOLANA',
        status: providerError.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'DOWN',
        capabilities: SOLANA_CAPABILITIES,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        lastSuccessAt: null,
        head: unavailableValue(
          providerError.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_DOWN',
          providerError.message,
        ),
        lag: unavailableValue('PROVIDER_DOWN'),
        errorCode: providerError.code,
        errorDetail: providerError.message,
        ...(this.#transport.diagnostics === undefined
          ? {}
          : { transport: this.#transport.diagnostics() }),
      };
    }
  }

  async #readAnchorAt(
    slotNumber: number,
    initialSourceIds: readonly string[] = [],
    options: TransportReadOptions = {},
  ): Promise<ChainAnchorRead> {
    requireSafeInteger(slotNumber, 'slot');
    const blockObservation = await this.readSourced<unknown>(
      'getBlock',
      [
        slotNumber,
        {
          commitment: this.config.commitment,
          transactionDetails: 'none',
          rewards: false,
          maxSupportedTransactionVersion: 0,
        },
      ],
      { ...options, cacheMode: 'bypass' },
    );
    const rawBlock = blockObservation.value;
    if (typeof rawBlock !== 'object' || rawBlock === null || Array.isArray(rawBlock)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Solana provider did not return the selected committed block.',
      );
    }
    const block = rawBlock as Record<string, unknown>;
    const blockhash = requireBase58(block.blockhash, 'blockhash');
    const previousBlockhash = requireBase58(block.previousBlockhash, 'previous blockhash');
    const parentSlot = requireSafeQuantityNumber(block.parentSlot, 'parent slot');
    if (parentSlot > slotNumber) {
      throw new ProviderError('INVALID_RESPONSE', 'Solana parent slot exceeds the snapshot slot.');
    }
    const blockTimestamp = optionalBlockTimestamp(block.blockTime);
    const sourceIds = sourceSet([...initialSourceIds, blockObservation.endpointId]);
    const observedAt = new Date().toISOString();
    const snapshot: SolanaSnapshot = {
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      slot: String(slotNumber),
      blockhash,
      parentSlot: String(parentSlot),
      previousBlockhash,
      commitment: this.config.commitment,
      ...(blockTimestamp === undefined ? {} : { blockTimestamp }),
      capturedAt: observedAt,
      providerVersions: Object.fromEntries(
        sourceIds.map((sourceId) => [sourceId, 'solana-json-rpc']),
      ),
      adapterVersions: { solana: this.config.adapterVersion ?? '0.1.0' },
      configHash: hashPayload({
        id: this.config.id,
        commitment: this.config.commitment,
        sourceIds,
      }),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
    return ChainAnchorReadSchema.parse({
      anchor: {
        ledger: 'SOLANA',
        chainId: 'solana-mainnet',
        position: String(slotNumber),
        hash: blockhash,
        parentPosition: String(parentSlot),
        parentHash: previousBlockhash,
        finality: this.config.commitment,
        source: sourceIds.join('|'),
        observedAt,
      },
      snapshot,
      payload: block,
    });
  }

  async readHeadAnchor(options: TransportReadOptions = {}): Promise<ChainAnchorRead> {
    const slotObservation = await this.readSourced<unknown>(
      'getSlot',
      [{ commitment: this.config.commitment }],
      { ...options, cacheMode: 'bypass' },
    );
    const slotNumber = requireSafeQuantityNumber(slotObservation.value, 'slot');
    return this.#readAnchorAt(slotNumber, [slotObservation.endpointId], options);
  }

  async readAnchorAt(
    position: string,
    options: TransportReadOptions = {},
  ): Promise<ChainAnchorRead> {
    return this.#readAnchorAt(requirePosition(position), [], options);
  }

  async createSnapshot(options: TransportReadOptions = {}): Promise<SolanaSnapshot> {
    return (await this.readHeadAnchor(options)).snapshot as SolanaSnapshot;
  }
}
