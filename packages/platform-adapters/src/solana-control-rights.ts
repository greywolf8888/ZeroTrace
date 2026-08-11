import { LOADER_V3_PROGRAM_ADDRESS } from '@solana-program/loader-v3';
import {
  TOKEN_PROGRAM_ADDRESS,
  getMintDecoder as getClassicMintDecoder,
  getMultisigDecoder as getClassicMultisigDecoder,
  getTokenDecoder as getClassicTokenDecoder,
} from '@solana-program/token';
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  getMintDecoder as getToken2022MintDecoder,
  getMultisigDecoder as getToken2022MultisigDecoder,
  getTokenDecoder as getToken2022TokenDecoder,
  type Extension,
} from '@solana-program/token-2022';
import {
  ProviderError,
  type SolanaAccountInfoResponse,
  type SolanaAccountState,
  type SolanaMultipleAccountsResponse,
  type TransportObservation,
} from '@zerotrace/chain-adapters';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  SolanaControlCoverageDomainSchema,
  SolanaControlSurfaceReportSchema,
  SolanaSnapshotSchema,
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type ChainAnchorRead,
  type Evidence,
  type KnowledgeValue,
  type SolanaAccountKind,
  type SolanaControlCoverage,
  type SolanaControlCoverageDomain,
  type SolanaControlRight,
  type SolanaControlRightType,
  type SolanaControlSurfaceReport,
  type SolanaMintControl,
  type SolanaMultisigControl,
  type SolanaProgramControl,
  type SolanaTokenAccountControl,
  type SolanaTokenExtensionControl,
  type SolanaTokenProgram,
} from '@zerotrace/schemas';
import bs58 from 'bs58';

export const SOLANA_CONTROL_SURFACE_MODEL_VERSION = 'solana-control-surface-v1.0.0';

const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111';
const MAX_ATOMIC_READ_ATTEMPTS = 3;
const TOKEN_MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;
const TOKEN_MULTISIG_SIZE = 355;

type SolanaSnapshot = ReturnType<typeof SolanaSnapshotSchema.parse>;

export interface SolanaControlReadAdapter {
  readonly sourceId: string;
  readonly config: { commitment: 'processed' | 'confirmed' | 'finalized' };
  getAccountInfoObservation(
    address: string,
    minimumContextSlot?: number,
  ): Promise<TransportObservation<SolanaAccountInfoResponse>>;
  getMultipleAccountsObservation(
    addresses: readonly string[],
    minimumContextSlot?: number,
  ): Promise<TransportObservation<SolanaMultipleAccountsResponse>>;
  readAnchorAt(position: string): Promise<ChainAnchorRead>;
}

export interface SolanaControlEvidenceWriter {
  (
    evidence: Evidence,
    sourceEvidenceIds?: readonly string[],
    snapshot?: AnalysisSnapshot,
  ): Promise<Evidence>;
}

interface DecodedSubject {
  accountKind: SolanaAccountKind;
  ownerProgram: string;
  executable: boolean;
  mint?: SolanaMintControl;
  tokenAccount?: SolanaTokenAccountControl;
  multisig?: SolanaMultisigControl;
  program?: SolanaProgramControl;
  rawExtensions: readonly Extension[];
  authorityAddresses: readonly string[];
  programDataAddress?: string;
}

interface AtomicObservation {
  addresses: readonly string[];
  accounts: readonly (SolanaAccountState | null)[];
  decoded: DecodedSubject;
  endpointId: string;
  snapshot: SolanaSnapshot;
}

function publicKey(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new ProviderError('INVALID_RESPONSE', 'Invalid public key bytes.');
  return bs58.encode(bytes);
}

function optionAddress(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const option = value as { __option?: unknown; value?: unknown };
  if (option.__option === 'None') return null;
  if (option.__option !== 'Some' || typeof option.value !== 'string') return null;
  return option.value === SYSTEM_PROGRAM_ADDRESS ? null : option.value;
}

function authorityAddress(value: unknown): string | null {
  return typeof value === 'string' && value !== SYSTEM_PROGRAM_ADDRESS ? value : null;
}

function decodeData(account: SolanaAccountState): Buffer {
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length !== account.space) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana account data length changed after validation.',
    );
  }
  return data;
}

function stateName(value: number): string {
  if (value === 0) return 'UNINITIALIZED';
  if (value === 1) return 'INITIALIZED';
  if (value === 2) return 'FROZEN';
  return `UNKNOWN_${value}`;
}

function authoritiesFromMint(mint: SolanaMintControl): string[] {
  return [mint.mintAuthority, mint.freezeAuthority]
    .flatMap((entry) => (entry.state === 'known' ? [entry.value] : []))
    .sort();
}

function authoritiesFromToken(token: SolanaTokenAccountControl): string[] {
  return [knownValue(token.owner), token.delegate, token.closeAuthority]
    .flatMap((entry) => (entry.state === 'known' ? [entry.value] : []))
    .sort();
}

function extensionAddresses(extension: Extension): string[] {
  const record = extension as unknown as Record<string, unknown>;
  const direct = [
    'transferFeeConfigAuthority',
    'withdrawWithheldAuthority',
    'closeAuthority',
    'rateAuthority',
    'delegate',
    'authority',
    'programId',
    'updateAuthority',
  ].flatMap((field) => {
    const raw = record[field];
    const value =
      typeof raw === 'object' && raw !== null ? optionAddress(raw) : authorityAddress(raw);
    return value === null ? [] : [value];
  });
  return [...new Set(direct)].sort();
}

function token2022Kind(data: Uint8Array): 'MINT' | 'TOKEN' | 'MULTISIG' | 'UNKNOWN' {
  if (data.length === TOKEN_MULTISIG_SIZE) return 'MULTISIG';
  if (data.length === TOKEN_MINT_SIZE) return 'MINT';
  if (data.length === TOKEN_ACCOUNT_SIZE) return 'TOKEN';
  if (data.length > TOKEN_ACCOUNT_SIZE) {
    if (data[TOKEN_ACCOUNT_SIZE] === 1) return 'MINT';
    if (data[TOKEN_ACCOUNT_SIZE] === 2) return 'TOKEN';
  }
  return 'UNKNOWN';
}

function decodeTokenSubject(
  ownerProgram: string,
  executable: boolean,
  data: Uint8Array,
  tokenProgram: SolanaTokenProgram,
): DecodedSubject {
  const isClassic = tokenProgram === 'SPL_TOKEN';
  const kind = isClassic
    ? data.length === TOKEN_MINT_SIZE
      ? 'MINT'
      : data.length === TOKEN_ACCOUNT_SIZE
        ? 'TOKEN'
        : data.length === TOKEN_MULTISIG_SIZE
          ? 'MULTISIG'
          : 'UNKNOWN'
    : token2022Kind(data);
  try {
    if (kind === 'MINT') {
      const decoded = isClassic
        ? getClassicMintDecoder().decode(data)
        : getToken2022MintDecoder().decode(data);
      const mint: SolanaMintControl = {
        tokenProgram,
        supply: decoded.supply.toString(),
        decimals: decoded.decimals,
        initialized: decoded.isInitialized,
        mintAuthority:
          optionAddress(decoded.mintAuthority) === null
            ? unknownValue('NOT_APPLICABLE', 'Mint authority is permanently disabled.')
            : knownValue(optionAddress(decoded.mintAuthority) as string),
        freezeAuthority:
          optionAddress(decoded.freezeAuthority) === null
            ? unknownValue('NOT_APPLICABLE', 'Freeze authority is permanently disabled.')
            : knownValue(optionAddress(decoded.freezeAuthority) as string),
      };
      const rawExtensions = 'extensions' in decoded ? optionExtensions(decoded.extensions) : [];
      const authorityAddresses = [
        ...authoritiesFromMint(mint),
        ...rawExtensions.flatMap(extensionAddresses),
      ];
      return {
        accountKind: isClassic ? 'SPL_TOKEN_MINT' : 'TOKEN_2022_MINT',
        ownerProgram,
        executable,
        mint,
        rawExtensions,
        authorityAddresses: [...new Set(authorityAddresses)].sort(),
      };
    }
    if (kind === 'TOKEN') {
      const decoded = isClassic
        ? getClassicTokenDecoder().decode(data)
        : getToken2022TokenDecoder().decode(data);
      const tokenAccount: SolanaTokenAccountControl = {
        tokenProgram,
        mint: String(decoded.mint),
        owner: String(decoded.owner),
        amount: decoded.amount.toString(),
        state: stateName(decoded.state),
        delegate:
          optionAddress(decoded.delegate) === null
            ? unknownValue('NOT_APPLICABLE', 'No delegate is configured at this Snapshot.')
            : knownValue(optionAddress(decoded.delegate) as string),
        delegatedAmount: decoded.delegatedAmount.toString(),
        closeAuthority:
          optionAddress(decoded.closeAuthority) === null
            ? unknownValue('NOT_APPLICABLE', 'No separate close authority is configured.')
            : knownValue(optionAddress(decoded.closeAuthority) as string),
      };
      const rawExtensions = 'extensions' in decoded ? optionExtensions(decoded.extensions) : [];
      const authorityAddresses = [
        ...authoritiesFromToken(tokenAccount),
        ...rawExtensions.flatMap(extensionAddresses),
      ];
      return {
        accountKind: isClassic ? 'SPL_TOKEN_ACCOUNT' : 'TOKEN_2022_ACCOUNT',
        ownerProgram,
        executable,
        tokenAccount,
        rawExtensions,
        authorityAddresses: [...new Set(authorityAddresses)].sort(),
      };
    }
    if (kind === 'MULTISIG') {
      const decoded = isClassic
        ? getClassicMultisigDecoder().decode(data)
        : getToken2022MultisigDecoder().decode(data);
      if (!decoded.isInitialized || decoded.m < 1 || decoded.n < decoded.m || decoded.n > 11) {
        throw new ProviderError('INVALID_RESPONSE', 'Invalid SPL Token multisig configuration.');
      }
      const signers = decoded.signers.slice(0, decoded.n).map(String);
      const multisig: SolanaMultisigControl = {
        tokenProgram,
        initialized: true,
        minimumSigners: decoded.m,
        signerCount: decoded.n,
        signers,
      };
      return {
        accountKind: isClassic ? 'SPL_TOKEN_MULTISIG' : 'TOKEN_2022_MULTISIG',
        ownerProgram,
        executable,
        multisig,
        rawExtensions: [],
        authorityAddresses: signers,
      };
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Official SPL Token decoder rejected account state.',
      {
        cause: error,
      },
    );
  }
  return {
    accountKind: 'OTHER_ACCOUNT',
    ownerProgram,
    executable,
    rawExtensions: [],
    authorityAddresses: [],
  };
}

function optionExtensions(value: unknown): readonly Extension[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const option = value as { __option?: unknown; value?: unknown };
  return option.__option === 'Some' && Array.isArray(option.value)
    ? (option.value as Extension[])
    : [];
}

function decodeProgramData(
  subject: string,
  ownerProgram: string,
  executable: boolean,
  data: Buffer,
): DecodedSubject {
  if (data.length < 13 || data.readUInt32LE(0) !== 3) {
    return {
      accountKind: 'OTHER_ACCOUNT',
      ownerProgram,
      executable,
      rawExtensions: [],
      authorityAddresses: [],
    };
  }
  const slot = data.readBigUInt64LE(4).toString();
  const optionTag = data[12];
  if (optionTag !== 0 && optionTag !== 1) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Upgradeable ProgramData authority option is invalid.',
    );
  }
  if (optionTag === 1 && data.length < 45) {
    throw new ProviderError('INVALID_RESPONSE', 'Upgradeable ProgramData authority is truncated.');
  }
  const upgradeAuthority = optionTag === 1 ? publicKey(data.subarray(13, 45)) : null;
  const metadataBytes = optionTag === 1 ? 45 : 13;
  const program: SolanaProgramControl = {
    loader: String(LOADER_V3_PROGRAM_ADDRESS),
    programDataAddress: knownValue(subject),
    upgradeAuthority:
      upgradeAuthority === null
        ? unknownValue('NOT_APPLICABLE', 'Upgrade authority is revoked.')
        : knownValue(upgradeAuthority),
    immutable: knownValue(upgradeAuthority === null),
    deploymentSlot: knownValue(slot),
    programDataBytes: knownValue(Math.max(0, data.length - metadataBytes)),
  };
  return {
    accountKind: 'UPGRADEABLE_PROGRAM_DATA',
    ownerProgram,
    executable,
    program,
    rawExtensions: [],
    authorityAddresses: upgradeAuthority === null ? [] : [upgradeAuthority],
  };
}

function decodeSubject(subject: string, account: SolanaAccountState): DecodedSubject {
  const data = decodeData(account);
  if (account.owner === String(TOKEN_PROGRAM_ADDRESS)) {
    return decodeTokenSubject(account.owner, account.executable, data, 'SPL_TOKEN');
  }
  if (account.owner === String(TOKEN_2022_PROGRAM_ADDRESS)) {
    return decodeTokenSubject(account.owner, account.executable, data, 'TOKEN_2022');
  }
  if (account.owner === String(LOADER_V3_PROGRAM_ADDRESS)) {
    if (data.length === 36 && data.readUInt32LE(0) === 2) {
      const programDataAddress = publicKey(data.subarray(4, 36));
      return {
        accountKind: 'UPGRADEABLE_PROGRAM',
        ownerProgram: account.owner,
        executable: account.executable,
        rawExtensions: [],
        authorityAddresses: [],
        programDataAddress,
      };
    }
    return decodeProgramData(subject, account.owner, account.executable, data);
  }
  return {
    accountKind: account.owner === SYSTEM_PROGRAM_ADDRESS ? 'SYSTEM_ACCOUNT' : 'OTHER_ACCOUNT',
    ownerProgram: account.owner,
    executable: account.executable,
    rawExtensions: [],
    authorityAddresses: [],
  };
}

function candidateAddresses(subject: string, decoded: DecodedSubject): string[] {
  const addresses = [
    ...(decoded.programDataAddress === undefined ? [] : [decoded.programDataAddress]),
    ...decoded.authorityAddresses,
  ].filter((address) => address !== subject && address !== SYSTEM_PROGRAM_ADDRESS);
  const canonical = [...new Set(addresses)].sort();
  if (canonical.length > 99) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana control subject exposes too many authorities.',
    );
  }
  return canonical;
}

function sameAddresses(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function bindProgramData(
  decoded: DecodedSubject,
  candidateMap: ReadonlyMap<string, SolanaAccountState | null>,
): DecodedSubject {
  if (decoded.programDataAddress === undefined) return decoded;
  const programData = candidateMap.get(decoded.programDataAddress);
  if (
    programData === undefined ||
    programData === null ||
    programData.owner !== String(LOADER_V3_PROGRAM_ADDRESS) ||
    programData.executable
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Upgradeable program does not link to valid ProgramData at the same slot.',
    );
  }
  const linked = decodeProgramData(
    decoded.programDataAddress,
    programData.owner,
    programData.executable,
    decodeData(programData),
  );
  if (linked.accountKind !== 'UPGRADEABLE_PROGRAM_DATA' || linked.program === undefined) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Upgradeable program points to invalid ProgramData.',
    );
  }
  return {
    ...decoded,
    program: linked.program,
    authorityAddresses: linked.authorityAddresses,
  };
}

async function observeAtomic(
  subject: string,
  adapter: SolanaControlReadAdapter,
): Promise<AtomicObservation> {
  if (adapter.config.commitment !== 'finalized') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Solana control inspection requires finalized state.',
    );
  }
  const discovery = await adapter.getAccountInfoObservation(subject);
  if (discovery.value.value === null) {
    throw new ProviderError('INVALID_RESPONSE', 'Solana control subject account does not exist.');
  }
  let decoded = decodeSubject(subject, discovery.value.value);
  let candidates = candidateAddresses(subject, decoded);
  let minimumSlot = discovery.value.context.slot;

  for (let attempt = 0; attempt < MAX_ATOMIC_READ_ATTEMPTS; attempt += 1) {
    const addresses = [subject, ...candidates];
    const observation = await adapter.getMultipleAccountsObservation(addresses, minimumSlot);
    const subjectAccount = observation.value.value[0];
    if (subjectAccount === null || subjectAccount === undefined) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Solana control subject disappeared during inspection.',
      );
    }
    const candidateMap = new Map(
      candidates.map((address, index) => [address, observation.value.value[index + 1] ?? null]),
    );
    decoded = bindProgramData(decodeSubject(subject, subjectAccount), candidateMap);
    const nextCandidates = candidateAddresses(subject, decoded);
    if (!sameAddresses(candidates, nextCandidates)) {
      candidates = nextCandidates;
      minimumSlot = observation.value.context.slot;
      continue;
    }
    const anchor = await adapter.readAnchorAt(String(observation.value.context.slot));
    if (anchor.snapshot.ledger !== 'SOLANA' || anchor.snapshot.commitment !== 'finalized') {
      throw new ProviderError('INVALID_RESPONSE', 'Solana account set lacks a finalized anchor.');
    }
    const sources = [
      ...new Set([...Object.keys(anchor.snapshot.providerVersions), observation.endpointId]),
    ].sort();
    const snapshot = SolanaSnapshotSchema.parse({
      ...anchor.snapshot,
      providerVersions: Object.fromEntries(sources.map((source) => [source, 'solana-json-rpc'])),
      configHash: hashPayload({
        baseConfigHash: anchor.snapshot.configHash,
        accountSource: observation.endpointId,
        slot: anchor.snapshot.slot,
      }),
    });
    return {
      addresses,
      accounts: observation.value.value,
      decoded,
      endpointId: observation.endpointId,
      snapshot,
    };
  }
  throw new ProviderError(
    'INVALID_RESPONSE',
    'Solana control authorities changed during bounded same-slot inspection.',
  );
}

function scalar(value: unknown): string | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'bigint' || typeof value === 'number') return String(value);
  return String(value);
}

function normalizedExtension(
  extension: Extension,
  evidenceId: string,
): SolanaTokenExtensionControl {
  const record = extension as unknown as Record<string, unknown>;
  const authorities: Array<{ role: string; address: string }> = [];
  const relatedAddresses: Array<{ role: string; address: string }> = [];
  const settings: Record<string, string | boolean | null> = {};
  const addAuthority = (role: string, value: unknown, optional = false) => {
    const address = optional ? optionAddress(value) : authorityAddress(value);
    if (address !== null) authorities.push({ role, address });
  };
  const addRelated = (role: string, value: unknown, optional = false) => {
    const address = optional ? optionAddress(value) : authorityAddress(value);
    if (address !== null) relatedAddresses.push({ role, address });
  };
  switch (extension.__kind) {
    case 'TransferFeeConfig': {
      addAuthority('TRANSFER_FEE_CONFIG_AUTHORITY', record.transferFeeConfigAuthority);
      addAuthority('WITHHELD_FEE_AUTHORITY', record.withdrawWithheldAuthority);
      const newer = record.newerTransferFee as Record<string, unknown>;
      settings.newerEpoch = scalar(newer.epoch);
      settings.newerMaximumFee = scalar(newer.maximumFee);
      settings.newerBasisPoints = scalar(newer.transferFeeBasisPoints);
      settings.withheldAmount = scalar(record.withheldAmount);
      break;
    }
    case 'MintCloseAuthority':
      addAuthority('MINT_CLOSE_AUTHORITY', record.closeAuthority);
      break;
    case 'ConfidentialTransferMint':
      addAuthority('CONFIDENTIAL_TRANSFER_AUTHORITY', record.authority, true);
      settings.autoApproveNewAccounts = scalar(record.autoApproveNewAccounts);
      break;
    case 'DefaultAccountState':
      settings.state = scalar(record.state);
      break;
    case 'ImmutableOwner':
    case 'NonTransferable':
    case 'NonTransferableAccount':
    case 'PausableAccount':
      settings.enabled = true;
      break;
    case 'MemoTransfer':
      settings.requireIncomingTransferMemos = scalar(record.requireIncomingTransferMemos);
      break;
    case 'InterestBearingConfig':
      addAuthority('INTEREST_RATE_AUTHORITY', record.rateAuthority);
      settings.currentRate = scalar(record.currentRate);
      settings.lastUpdateTimestamp = scalar(record.lastUpdateTimestamp);
      break;
    case 'CpiGuard':
      settings.lockCpi = scalar(record.lockCpi);
      break;
    case 'PermanentDelegate':
      addAuthority('PERMANENT_DELEGATE', record.delegate);
      break;
    case 'TransferHook':
      addAuthority('TRANSFER_HOOK_AUTHORITY', record.authority);
      addRelated('TRANSFER_HOOK_PROGRAM', record.programId);
      break;
    case 'ConfidentialTransferFee':
      addAuthority('CONFIDENTIAL_TRANSFER_AUTHORITY', record.authority, true);
      settings.harvestToMintEnabled = scalar(record.harvestToMintEnabled);
      break;
    case 'MetadataPointer':
      addAuthority('METADATA_POINTER_AUTHORITY', record.authority, true);
      addRelated('METADATA_ADDRESS', record.metadataAddress, true);
      break;
    case 'TokenMetadata': {
      addAuthority('METADATA_UPDATE_AUTHORITY', record.updateAuthority, true);
      addRelated('MINT', record.mint);
      settings.name = scalar(record.name);
      settings.symbol = scalar(record.symbol);
      settings.uri = scalar(record.uri);
      settings.additionalMetadataEntries =
        record.additionalMetadata instanceof Map ? String(record.additionalMetadata.size) : null;
      break;
    }
    case 'GroupPointer':
      addAuthority('GROUP_POINTER_AUTHORITY', record.authority, true);
      addRelated('GROUP_ADDRESS', record.groupAddress, true);
      break;
    case 'TokenGroup':
      addAuthority('GROUP_UPDATE_AUTHORITY', record.updateAuthority, true);
      addRelated('MINT', record.mint);
      settings.size = scalar(record.size);
      settings.maxSize = scalar(record.maxSize);
      break;
    case 'GroupMemberPointer':
      addAuthority('GROUP_MEMBER_POINTER_AUTHORITY', record.authority, true);
      addRelated('MEMBER_ADDRESS', record.memberAddress, true);
      break;
    case 'TokenGroupMember':
      addRelated('MINT', record.mint);
      addRelated('GROUP_ADDRESS', record.group);
      settings.memberNumber = scalar(record.memberNumber);
      break;
    case 'ScaledUiAmountConfig':
      addAuthority('SCALED_UI_AMOUNT_AUTHORITY', record.authority);
      settings.multiplier = scalar(record.multiplier);
      settings.newMultiplier = scalar(record.newMultiplier);
      settings.newMultiplierEffectiveTimestamp = scalar(record.newMultiplierEffectiveTimestamp);
      break;
    case 'PausableConfig':
      addAuthority('PAUSE_AUTHORITY', record.authority, true);
      settings.paused = scalar(record.paused);
      break;
    case 'PermissionedBurn':
      addAuthority('PERMISSIONED_BURN_AUTHORITY', record.authority, true);
      break;
    case 'TransferFeeAmount':
      settings.withheldAmount = scalar(record.withheldAmount);
      break;
    case 'TransferHookAccount':
      settings.transferring = scalar(record.transferring);
      break;
    case 'ConfidentialTransferAccount':
      settings.approved = scalar(record.approved);
      settings.allowConfidentialCredits = scalar(record.allowConfidentialCredits);
      settings.allowNonConfidentialCredits = scalar(record.allowNonConfidentialCredits);
      break;
    case 'Uninitialized':
      settings.initialized = false;
      break;
    default:
      settings.present = true;
  }
  return {
    extensionType: extension.__kind,
    authorities: authorities.sort((left, right) => left.role.localeCompare(right.role)),
    relatedAddresses: relatedAddresses.sort((left, right) => left.role.localeCompare(right.role)),
    settings,
    evidenceIds: [evidenceId],
  };
}

const EXTENSION_RIGHT_TYPES: Readonly<Record<string, SolanaControlRightType>> = {
  MINT_CLOSE_AUTHORITY: 'MINT_CLOSE_AUTHORITY',
  PERMANENT_DELEGATE: 'PERMANENT_DELEGATE',
  TRANSFER_FEE_CONFIG_AUTHORITY: 'TRANSFER_FEE_CONFIG_AUTHORITY',
  WITHHELD_FEE_AUTHORITY: 'WITHHELD_FEE_AUTHORITY',
  CONFIDENTIAL_TRANSFER_AUTHORITY: 'CONFIDENTIAL_TRANSFER_AUTHORITY',
  INTEREST_RATE_AUTHORITY: 'INTEREST_RATE_AUTHORITY',
  TRANSFER_HOOK_AUTHORITY: 'TRANSFER_HOOK_AUTHORITY',
  METADATA_POINTER_AUTHORITY: 'METADATA_POINTER_AUTHORITY',
  METADATA_UPDATE_AUTHORITY: 'METADATA_UPDATE_AUTHORITY',
  GROUP_POINTER_AUTHORITY: 'GROUP_POINTER_AUTHORITY',
  GROUP_UPDATE_AUTHORITY: 'GROUP_UPDATE_AUTHORITY',
  GROUP_MEMBER_POINTER_AUTHORITY: 'GROUP_MEMBER_POINTER_AUTHORITY',
  SCALED_UI_AMOUNT_AUTHORITY: 'SCALED_UI_AMOUNT_AUTHORITY',
  PAUSE_AUTHORITY: 'PAUSE_AUTHORITY',
  PERMISSIONED_BURN_AUTHORITY: 'PERMISSIONED_BURN_AUTHORITY',
};

function decodeCandidateMultisig(
  account: SolanaAccountState | null | undefined,
  tokenProgram: SolanaTokenProgram | undefined,
): SolanaMultisigControl | undefined {
  if (account === null || account === undefined || tokenProgram === undefined) return undefined;
  const expectedOwner =
    tokenProgram === 'SPL_TOKEN'
      ? String(TOKEN_PROGRAM_ADDRESS)
      : String(TOKEN_2022_PROGRAM_ADDRESS);
  if (account.owner !== expectedOwner || account.space !== TOKEN_MULTISIG_SIZE) return undefined;
  const decoded = decodeTokenSubject(
    account.owner,
    account.executable,
    decodeData(account),
    tokenProgram,
  );
  return decoded.multisig;
}

function right(input: {
  subject: string;
  controller: string;
  rightType: SolanaControlRightType;
  scope: string;
  evidenceId: string;
  multisig?: SolanaMultisigControl;
  extraConstraints?: readonly string[];
}): SolanaControlRight {
  const constraints = [
    ...(input.multisig === undefined
      ? ['Controller account shape is unresolved; threshold remains Unknown.']
      : [
          `${input.multisig.minimumSigners}-of-${input.multisig.signerCount} SPL Token multisig at the same slot.`,
          `Signers: ${input.multisig.signers.join(', ')}. Signer independence is not assessed.`,
        ]),
    ...(input.extraConstraints ?? []),
  ];
  return {
    id: `cr_${hashPayload({
      schema: 'zerotrace-solana-control-right-v1',
      subject: input.subject,
      controller: input.controller,
      rightType: input.rightType,
      scope: input.scope,
      evidenceId: input.evidenceId,
    }).slice(0, 24)}`,
    chainId: 'solana-mainnet',
    subject: input.subject,
    controller: input.controller,
    rightType: input.rightType,
    scope: input.scope,
    threshold:
      input.multisig === undefined
        ? unknownValue('INSUFFICIENT_DATA', 'Controller threshold was not established.')
        : knownValue(String(input.multisig.minimumSigners)),
    constraints,
    evidenceIds: [input.evidenceId],
    activeFrom: unknownValue('NOT_QUERIED', 'Authority activation history is not queried.'),
    activeTo: unknownValue('NOT_QUERIED', 'Authority revocation history is not queried.'),
  };
}

function coverage(
  domain: SolanaControlCoverageDomain,
  observed: SolanaControlCoverage['observed'],
  detail: string,
  evidenceId?: string,
): SolanaControlCoverage {
  return { domain, observed, detail, evidenceIds: evidenceId === undefined ? [] : [evidenceId] };
}

const EXTENSION_DOMAINS: Readonly<Record<string, SolanaControlCoverageDomain>> = {
  MintCloseAuthority: 'MINT_CLOSE_AUTHORITY',
  PermanentDelegate: 'PERMANENT_DELEGATE',
  TransferFeeConfig: 'TRANSFER_FEE_CONFIG',
  TransferFeeAmount: 'WITHHELD_FEE_AUTHORITY',
  ConfidentialTransferMint: 'CONFIDENTIAL_TRANSFER',
  ConfidentialTransferAccount: 'CONFIDENTIAL_TRANSFER',
  ConfidentialTransferFee: 'CONFIDENTIAL_TRANSFER',
  ConfidentialTransferFeeAmount: 'CONFIDENTIAL_TRANSFER',
  DefaultAccountState: 'DEFAULT_ACCOUNT_STATE',
  NonTransferable: 'NON_TRANSFERABLE',
  NonTransferableAccount: 'NON_TRANSFERABLE',
  InterestBearingConfig: 'INTEREST_BEARING',
  TransferHook: 'TRANSFER_HOOK',
  TransferHookAccount: 'TRANSFER_HOOK',
  MetadataPointer: 'METADATA_POINTER',
  TokenMetadata: 'TOKEN_METADATA',
  GroupPointer: 'GROUP_POINTER',
  TokenGroup: 'TOKEN_GROUP',
  GroupMemberPointer: 'GROUP_MEMBER_POINTER',
  TokenGroupMember: 'TOKEN_GROUP_MEMBER',
  ScaledUiAmountConfig: 'SCALED_UI_AMOUNT',
  PausableConfig: 'PAUSABLE',
  PausableAccount: 'PAUSABLE',
  PermissionedBurn: 'PERMISSIONED_BURN',
  CpiGuard: 'CPI_GUARD',
  MemoTransfer: 'MEMO_TRANSFER',
  ImmutableOwner: 'IMMUTABLE_OWNER',
};

function buildCoverage(decoded: DecodedSubject, evidenceId: string): SolanaControlCoverage[] {
  const tokenKind =
    decoded.mint !== undefined ||
    decoded.tokenAccount !== undefined ||
    decoded.multisig !== undefined;
  const token2022 =
    decoded.mint?.tokenProgram === 'TOKEN_2022' ||
    decoded.tokenAccount?.tokenProgram === 'TOKEN_2022' ||
    decoded.multisig?.tokenProgram === 'TOKEN_2022';
  const extensionDomains = new Set(
    decoded.rawExtensions.flatMap((extension) => {
      const domain = EXTENSION_DOMAINS[extension.__kind];
      return domain === undefined ? [] : [domain];
    }),
  );
  const programKind =
    decoded.accountKind === 'UPGRADEABLE_PROGRAM' ||
    decoded.accountKind === 'UPGRADEABLE_PROGRAM_DATA';
  const baseState: Partial<Record<SolanaControlCoverageDomain, boolean>> = {
    ACCOUNT_STATE: true,
    ACCOUNT_CLASSIFICATION: true,
    ...(tokenKind ? { TOKEN_BASE_STATE: true } : {}),
    ...(decoded.mint === undefined
      ? {}
      : {
          MINT_AUTHORITY: decoded.mint.mintAuthority.state === 'known',
          FREEZE_AUTHORITY: decoded.mint.freezeAuthority.state === 'known',
        }),
    ...(decoded.tokenAccount === undefined
      ? {}
      : {
          ACCOUNT_OWNER: true,
          ACCOUNT_CLOSE_AUTHORITY: decoded.tokenAccount.closeAuthority.state === 'known',
          ACCOUNT_DELEGATE: decoded.tokenAccount.delegate.state === 'known',
        }),
    ...(decoded.multisig === undefined ? {} : { MULTISIG_CONFIGURATION: true }),
    ...(programKind
      ? {
          PROGRAM_EXECUTABLE: decoded.executable,
          PROGRAM_DATA: decoded.program !== undefined,
          PROGRAM_UPGRADE_AUTHORITY: decoded.program?.upgradeAuthority.state === 'known',
        }
      : {}),
  };
  const permanentlyPending = new Set<SolanaControlCoverageDomain>([
    'ANCHOR_IDL',
    'VERIFIABLE_BUILD',
    'SQUADS_CONFIGURATION',
    'AUTHORITY_HISTORY',
    'CONTROLLER_RECURSION',
  ]);
  return SolanaControlCoverageDomainSchema.options.map((domain) => {
    if (permanentlyPending.has(domain)) {
      return coverage(
        domain,
        unknownValue('NOT_IMPLEMENTED', `${domain} is preserved as an explicit pending boundary.`),
        `${domain} was not inferred by this point-in-time adapter.`,
      );
    }
    if (Object.hasOwn(baseState, domain)) {
      const observed = baseState[domain] as boolean;
      return coverage(
        domain,
        knownValue(observed),
        observed
          ? `${domain} was established at the Snapshot.`
          : `${domain} was inspected and absent.`,
        evidenceId,
      );
    }
    if (Object.values(EXTENSION_DOMAINS).includes(domain)) {
      if (!tokenKind) {
        return coverage(
          domain,
          unknownValue('NOT_APPLICABLE', 'The subject is not an SPL Token account.'),
          `${domain} does not apply to this account classification.`,
        );
      }
      const present = token2022 && extensionDomains.has(domain);
      return coverage(
        domain,
        knownValue(present),
        token2022
          ? present
            ? `${domain} extension state is present and decoded.`
            : `${domain} extension was not present in the complete Token-2022 TLV state.`
          : 'Classic SPL Token does not support Token-2022 extensions.',
        evidenceId,
      );
    }
    return coverage(
      domain,
      unknownValue('NOT_APPLICABLE', `${domain} does not apply to this account classification.`),
      `${domain} was not coerced to false for an unrelated account type.`,
    );
  });
}

function reportRights(
  subject: string,
  observation: AtomicObservation,
  extensions: readonly SolanaTokenExtensionControl[],
  evidenceId: string,
): SolanaControlRight[] {
  const candidateMap = new Map(
    observation.addresses
      .slice(1)
      .map((address, index) => [address, observation.accounts[index + 1] ?? null]),
  );
  const tokenProgram =
    observation.decoded.mint?.tokenProgram ??
    observation.decoded.tokenAccount?.tokenProgram ??
    observation.decoded.multisig?.tokenProgram;
  const add = (
    controller: string,
    rightType: SolanaControlRightType,
    scope: string,
    extraConstraints?: readonly string[],
  ) => {
    const multisig = decodeCandidateMultisig(candidateMap.get(controller), tokenProgram);
    return right({
      subject,
      controller,
      rightType,
      scope,
      evidenceId,
      ...(multisig === undefined ? {} : { multisig }),
      ...(extraConstraints === undefined ? {} : { extraConstraints }),
    });
  };
  const rights: SolanaControlRight[] = [];
  const mint = observation.decoded.mint;
  if (mint?.mintAuthority.state === 'known') {
    rights.push(add(mint.mintAuthority.value, 'MINT_AUTHORITY', 'Mint additional token supply.'));
  }
  if (mint?.freezeAuthority.state === 'known') {
    rights.push(
      add(mint.freezeAuthority.value, 'FREEZE_AUTHORITY', 'Freeze or thaw token accounts.'),
    );
  }
  const token = observation.decoded.tokenAccount;
  if (token !== undefined) {
    rights.push(
      add(token.owner, 'ACCOUNT_OWNER', 'Authorize owner-controlled token account operations.'),
    );
    if (token.delegate.state === 'known') {
      rights.push(
        add(
          token.delegate.value,
          'ACCOUNT_DELEGATE',
          `Transfer up to ${token.delegatedAmount} atomic units.`,
        ),
      );
    }
    if (token.closeAuthority.state === 'known') {
      rights.push(
        add(token.closeAuthority.value, 'ACCOUNT_CLOSE_AUTHORITY', 'Close the token account.'),
      );
    }
  }
  for (const extension of extensions) {
    for (const authority of extension.authorities) {
      const rightType = EXTENSION_RIGHT_TYPES[authority.role];
      if (rightType !== undefined) {
        rights.push(
          add(authority.address, rightType, `Control Token-2022 ${extension.extensionType}.`),
        );
      }
    }
    for (const related of extension.relatedAddresses) {
      if (related.role === 'TRANSFER_HOOK_PROGRAM') {
        rights.push(
          add(
            related.address,
            'TRANSFER_HOOK_PROGRAM',
            'Execute transfer-hook behavior on token transfers.',
          ),
        );
      }
    }
  }
  const program = observation.decoded.program;
  if (program?.upgradeAuthority.state === 'known') {
    rights.push(
      add(
        program.upgradeAuthority.value,
        'PROGRAM_UPGRADE_AUTHORITY',
        'Upgrade the loader-v3 program bytes.',
        ['Authority shape (including Squads membership) is not inferred in this phase.'],
      ),
    );
  }
  const multisig = observation.decoded.multisig;
  if (multisig !== undefined) {
    for (const signer of multisig.signers) {
      rights.push(
        right({
          subject,
          controller: signer,
          rightType: 'MULTISIG_SIGNER',
          scope: `Participate in the ${multisig.minimumSigners}-of-${multisig.signerCount} SPL Token multisig.`,
          evidenceId,
          extraConstraints: ['Signer independence and controller recursion remain Unknown.'],
        }),
      );
    }
  }
  return rights.sort((left, rightItem) => left.id.localeCompare(rightItem.id));
}

export async function inspectSolanaControlSurface(options: {
  subject: string;
  adapter: SolanaControlReadAdapter;
  writeEvidence: SolanaControlEvidenceWriter;
}): Promise<SolanaControlSurfaceReport> {
  const observation = await observeAtomic(options.subject, options.adapter);
  const snapshot = observation.snapshot;
  const sourceEvidence = await options.writeEvidence(
    createEvidence({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      kind: observation.decoded.executable ? 'PROGRAM_STATE' : 'ACCOUNT_STATE',
      source: observation.endpointId,
      locator: `solana-account-set:${options.subject}@${snapshot.slot}`,
      payload: {
        subject: options.subject,
        slot: snapshot.slot,
        addresses: observation.addresses,
        accounts: observation.addresses.map((address, index) => {
          const account = observation.accounts[index];
          return account === null || account === undefined
            ? { address, state: 'ABSENT' }
            : {
                address,
                owner: account.owner,
                executable: account.executable,
                lamports: account.lamports,
                space: account.space,
                dataHash: hashPayload(account.data[0]),
              };
        }),
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.slot,
      finality: snapshot.commitment,
      summary: 'Atomic Solana subject and direct-authority account state at one finalized slot.',
    }),
    [],
    snapshot,
  );
  const extensions = observation.decoded.rawExtensions
    .map((extension) => normalizedExtension(extension, sourceEvidence.id))
    .sort((left, rightItem) => left.extensionType.localeCompare(rightItem.extensionType));
  const rights = reportRights(options.subject, observation, extensions, sourceEvidence.id);
  const coverageItems = buildCoverage(observation.decoded, sourceEvidence.id);
  const sourceAgreement: KnowledgeValue<boolean> = unknownValue(
    'INSUFFICIENT_DATA',
    'Only one Solana RPC observation source was used.',
  );
  const sourceIndependence: KnowledgeValue<boolean> = unknownValue(
    'INSUFFICIENT_DATA',
    'No independent Solana operator registry is configured.',
  );
  const terminal = await options.writeEvidence(
    createEvidence({
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${SOLANA_CONTROL_SURFACE_MODEL_VERSION}`,
      locator: `solana-control-surface-report:${options.subject}@${snapshot.blockhash}`,
      payload: {
        modelVersion: SOLANA_CONTROL_SURFACE_MODEL_VERSION,
        subject: options.subject,
        snapshotHash: snapshot.blockhash,
        accountKind: observation.decoded.accountKind,
        ownerProgram: observation.decoded.ownerProgram,
        mint: observation.decoded.mint ?? null,
        tokenAccount: observation.decoded.tokenAccount ?? null,
        multisig: observation.decoded.multisig ?? null,
        program: observation.decoded.program ?? null,
        extensions,
        rights,
        coverage: coverageItems,
        sourceAgreement,
        sourceIndependence,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.slot,
      finality: snapshot.commitment,
      summary:
        'Evidence-bound Solana control surface with official token decoders and explicit pending domains.',
      sourceEvidenceIds: [sourceEvidence.id],
    }),
    [sourceEvidence.id],
    snapshot,
  );
  const evidence = [sourceEvidence, terminal].sort((left, rightItem) =>
    left.id.localeCompare(rightItem.id),
  );
  const evidenceIds = evidence.map((item) => item.id);
  const knownCoverage = coverageItems.filter((item) => item.observed.state === 'known').length;
  const metadata = AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage: knownCoverage / SolanaControlCoverageDomainSchema.options.length,
    sourceCoverage: 0.5,
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: snapshot.blockTimestamp ?? snapshot.capturedAt,
    sourceSet: [observation.endpointId],
    modelVersion: SOLANA_CONTROL_SURFACE_MODEL_VERSION,
    confidence: 0.82,
    evidenceIds,
  });
  return SolanaControlSurfaceReportSchema.parse({
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    subject: options.subject,
    accountKind: knownValue(observation.decoded.accountKind),
    ownerProgram: knownValue(observation.decoded.ownerProgram),
    executable: knownValue(observation.decoded.executable),
    mint:
      observation.decoded.mint === undefined
        ? unknownValue('NOT_APPLICABLE', 'Subject is not a decoded token mint.')
        : knownValue(observation.decoded.mint),
    tokenAccount:
      observation.decoded.tokenAccount === undefined
        ? unknownValue('NOT_APPLICABLE', 'Subject is not a decoded token account.')
        : knownValue(observation.decoded.tokenAccount),
    multisig:
      observation.decoded.multisig === undefined
        ? unknownValue('NOT_APPLICABLE', 'Subject is not a decoded SPL Token multisig.')
        : knownValue(observation.decoded.multisig),
    program:
      observation.decoded.program === undefined
        ? unknownValue('NOT_APPLICABLE', 'Subject is not a decoded loader-v3 program state.')
        : knownValue(observation.decoded.program),
    extensions,
    sourceAgreement,
    sourceIndependence,
    rights,
    coverage: coverageItems,
    terminalEvidenceId: terminal.id,
    metadata,
    evidence,
  });
}
