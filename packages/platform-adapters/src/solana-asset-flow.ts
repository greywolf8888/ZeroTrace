import {
  SYSTEM_PROGRAM_ADDRESS,
  SystemInstruction,
  getTransferSolInstructionDataDecoder,
  getTransferSolWithSeedInstructionDataDecoder,
  identifySystemInstruction,
} from '@solana-program/system';
import {
  TOKEN_PROGRAM_ADDRESS,
  TokenInstruction,
  getBurnCheckedInstructionDataDecoder,
  getBurnInstructionDataDecoder,
  getMintToCheckedInstructionDataDecoder,
  getMintToInstructionDataDecoder,
  getTransferCheckedInstructionDataDecoder,
  getTransferInstructionDataDecoder,
  identifyTokenInstruction,
} from '@solana-program/token';
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  Token2022Instruction,
  getBurnCheckedInstructionDataDecoder as getToken2022BurnCheckedInstructionDataDecoder,
  getBurnInstructionDataDecoder as getToken2022BurnInstructionDataDecoder,
  getMintToCheckedInstructionDataDecoder as getToken2022MintToCheckedInstructionDataDecoder,
  getMintToInstructionDataDecoder as getToken2022MintToInstructionDataDecoder,
  getTransferCheckedInstructionDataDecoder as getToken2022TransferCheckedInstructionDataDecoder,
  getTransferCheckedWithFeeInstructionDataDecoder,
  getTransferInstructionDataDecoder as getToken2022TransferInstructionDataDecoder,
  identifyToken2022Instruction,
} from '@solana-program/token-2022';
import bs58 from 'bs58';

import {
  knownValue,
  unknownValue,
  type KnowledgeValue,
  type SolanaAssetFlow,
  type SolanaInstructionObservation,
  type SolanaTokenBalanceChange,
  type SolanaTokenFlowReconciliation,
} from '@zerotrace/schemas';

const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const SOLANA_ASSET_FLOW_MODEL_VERSION = 'solana-asset-flow-v1.0.0';

type Execution = 'SUCCESS' | 'FAILED' | 'METADATA_UNAVAILABLE';
type ProgramFamily = 'SYSTEM' | 'SPL_TOKEN' | 'TOKEN_2022';
type InstructionCategory =
  | 'ASSET_TRANSFER'
  | 'SUPPLY_INCREASE'
  | 'SUPPLY_DECREASE'
  | 'ACCOUNT_LIFECYCLE'
  | 'CONTROL_CHANGE'
  | 'OTHER';
type Application = 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN';
type StringKnowledge = SolanaAssetFlow['sourceAccount'];
type NumberKnowledge = SolanaAssetFlow['decimals'];

type ProgramSemantic = {
  programFamily: ProgramFamily;
  instructionName: string;
  category: InstructionCategory;
  application: Application;
};

type InstructionDecode = {
  instruction: SolanaInstructionObservation;
  officialProgram: boolean;
  decoded: boolean;
  assetFlowCandidate: boolean;
  flow?: SolanaAssetFlow;
  unmodeledTokenEffect: boolean;
};

export interface SolanaAssetFlowAnalysis {
  instructions: SolanaInstructionObservation[];
  officialProgramInstructionCount: number;
  identifiedOfficialProgramInstructionCount: number;
  officialProgramIdentificationCoverage: KnowledgeValue<number>;
  assetFlowCandidateCount: number;
  assetFlowDecodeCoverage: KnowledgeValue<number>;
  assetFlowCoverage: KnowledgeValue<number>;
  assetFlows: SolanaAssetFlow[];
  tokenFlowReconciliation: SolanaTokenFlowReconciliation;
}

function notApplicable(detail: string): StringKnowledge {
  return unknownValue('NOT_APPLICABLE', detail);
}

function applicationFor(execution: Execution): Application {
  return execution === 'SUCCESS' ? 'APPLIED' : execution === 'FAILED' ? 'NOT_APPLIED' : 'UNKNOWN';
}

function programFamilyFor(
  programId: SolanaInstructionObservation['programId'],
): ProgramFamily | 'OTHER' | 'UNRESOLVED' {
  if (programId.state !== 'known') return 'UNRESOLVED';
  if (programId.value === String(SYSTEM_PROGRAM_ADDRESS)) return 'SYSTEM';
  if (programId.value === String(TOKEN_PROGRAM_ADDRESS)) return 'SPL_TOKEN';
  if (programId.value === String(TOKEN_2022_PROGRAM_ADDRESS)) return 'TOKEN_2022';
  return 'OTHER';
}

function accountAt(
  instruction: SolanaInstructionObservation,
  index: number,
  role: string,
): StringKnowledge {
  if (instruction.accounts.state !== 'known') {
    return unknownValue(
      'INSUFFICIENT_DATA',
      `${role} cannot be resolved because the compiled account list is incomplete.`,
    );
  }
  const address = instruction.accounts.value[index];
  return address === undefined
    ? unknownValue('INVALID_INPUT', `${role} account position ${index} is absent.`)
    : knownValue(address);
}

function uniqueKnownAddress(values: StringKnowledge[], missingDetail: string): StringKnowledge {
  const known = [
    ...new Set(values.flatMap((value) => (value.state === 'known' ? [value.value] : []))),
  ];
  if (known.length === 1) return knownValue(known[0]!);
  if (known.length > 1) {
    return unknownValue('CONFLICTING_SOURCES', 'Recorded token metadata contains multiple values.');
  }
  return unknownValue('INSUFFICIENT_DATA', missingDetail);
}

function changesForAccount(
  account: StringKnowledge,
  changes: readonly SolanaTokenBalanceChange[],
): SolanaTokenBalanceChange[] {
  if (account.state !== 'known') return [];
  return changes.filter(
    (change) => change.account.state === 'known' && change.account.value === account.value,
  );
}

function ownerForAccount(
  account: StringKnowledge,
  side: 'source' | 'destination',
  changes: readonly SolanaTokenBalanceChange[],
): StringKnowledge {
  const candidates = changesForAccount(account, changes).flatMap((change) =>
    side === 'source' ? [change.ownerBefore] : [change.ownerAfter],
  );
  return uniqueKnownAddress(
    candidates,
    `The ${side} token-account owner was not recorded in pre/post token balances.`,
  );
}

function mintForAccounts(
  accounts: StringKnowledge[],
  execution: Execution,
  changes: readonly SolanaTokenBalanceChange[],
): StringKnowledge {
  const mintSets = accounts.map(
    (account) => new Set(changesForAccount(account, changes).map((change) => change.mint)),
  );
  const observed = [...new Set(mintSets.flatMap((mints) => [...mints]))];
  if (observed.length === 1 && (execution === 'SUCCESS' || mintSets.every((set) => set.size > 0))) {
    return knownValue(observed[0]!);
  }
  if (observed.length > 1) {
    return unknownValue(
      'CONFLICTING_SOURCES',
      'Recorded source/destination token balances do not identify one common mint.',
    );
  }
  return unknownValue(
    'INSUFFICIENT_DATA',
    'Unchecked transfer data omits the mint and recorded balances did not establish it.',
  );
}

function decimalsForMint(
  mint: StringKnowledge,
  changes: readonly SolanaTokenBalanceChange[],
): NumberKnowledge {
  if (mint.state !== 'known') {
    return unknownValue('INSUFFICIENT_DATA', 'Mint decimals require a resolved mint identity.');
  }
  const values = [
    ...new Set(
      changes
        .filter((change) => change.mint === mint.value && change.decimals.state === 'known')
        .map((change) => (change.decimals.state === 'known' ? change.decimals.value : Number.NaN)),
    ),
  ].filter(Number.isFinite);
  if (values.length === 1) return knownValue(values[0]!);
  if (values.length > 1) {
    return unknownValue('CONFLICTING_SOURCES', 'Recorded token balances disagree on decimals.');
  }
  return unknownValue('INSUFFICIENT_DATA', 'Mint decimals were not recorded.');
}

function categoryFor(family: ProgramFamily, name: string): InstructionCategory {
  if (family === 'SYSTEM') {
    if (name === 'TransferSol' || name === 'TransferSolWithSeed') return 'ASSET_TRANSFER';
    if (name.startsWith('CreateAccount') || name.includes('NonceAccount')) {
      return 'ACCOUNT_LIFECYCLE';
    }
    if (name.startsWith('Assign') || name.startsWith('Authorize')) return 'CONTROL_CHANGE';
    return 'OTHER';
  }
  if (name === 'Transfer' || name === 'TransferChecked' || name === 'TransferCheckedWithFee') {
    return 'ASSET_TRANSFER';
  }
  if (name === 'MintTo' || name === 'MintToChecked') return 'SUPPLY_INCREASE';
  if (name === 'Burn' || name === 'BurnChecked') return 'SUPPLY_DECREASE';
  if (
    name.startsWith('Initialize') ||
    name === 'CloseAccount' ||
    name === 'SyncNative' ||
    name === 'Reallocate' ||
    name === 'CreateNativeMint'
  ) {
    return 'ACCOUNT_LIFECYCLE';
  }
  if (
    /Authority|Approve|Revoke|Freeze|Thaw|Delegate|TransferHook|SetTransferFee|Pause|Resume/.test(
      name,
    )
  ) {
    return 'CONTROL_CHANGE';
  }
  return 'OTHER';
}

function isUnmodeledTokenEffect(name: string): boolean {
  return (
    name === 'CloseAccount' ||
    name === 'SyncNative' ||
    name === 'WithdrawExcessLamports' ||
    name === 'UnwrapLamports' ||
    name === 'Batch' ||
    /^WithdrawWithheldTokens/.test(name) ||
    /^HarvestWithheldTokens/.test(name) ||
    /^Confidential(?:Deposit|Withdraw|Transfer|Mint|Burn)/.test(name) ||
    name === 'ApplyConfidentialPendingBalance' ||
    name === 'ApplyConfidentialPendingBurn' ||
    /^Permissioned.*Burn/.test(name)
  );
}

function semanticName(
  family: ProgramFamily,
  data: Uint8Array,
): { name: string; category: InstructionCategory } {
  const identifier =
    family === 'SYSTEM'
      ? identifySystemInstruction(data)
      : family === 'SPL_TOKEN'
        ? identifyTokenInstruction(data)
        : identifyToken2022Instruction(data);
  const name =
    family === 'SYSTEM'
      ? SystemInstruction[identifier]
      : family === 'SPL_TOKEN'
        ? TokenInstruction[identifier]
        : Token2022Instruction[identifier];
  if (typeof name !== 'string')
    throw new Error('Official decoder returned an unknown instruction.');
  return { name, category: categoryFor(family, name) };
}

function baseFlow(options: {
  instruction: SolanaInstructionObservation;
  family: ProgramFamily;
  name: string;
  execution: Execution;
  flowKind: 'TRANSFER' | 'MINT' | 'BURN';
  assetKind: SolanaAssetFlow['assetKind'];
  sourceAccount: StringKnowledge;
  destinationAccount: StringKnowledge;
  sourceOwner: StringKnowledge;
  destinationOwner: StringKnowledge;
  mint: StringKnowledge;
  authority: StringKnowledge;
  amount: bigint;
  decimals: NumberKnowledge;
  expectedFeeAmount: StringKnowledge;
  expectedRecipientAmount: StringKnowledge;
}): SolanaAssetFlow {
  return {
    id: `${options.instruction.path}:flow:0`,
    instructionPath: options.instruction.path,
    programFamily: options.family,
    instructionName: options.name,
    application: applicationFor(options.execution),
    flowKind: options.flowKind,
    assetKind: options.assetKind,
    sourceAccount: options.sourceAccount,
    destinationAccount: options.destinationAccount,
    sourceOwner: options.sourceOwner,
    destinationOwner: options.destinationOwner,
    mint: options.mint,
    authority: options.authority,
    amount: knownValue(options.amount.toString()),
    decimals: options.decimals,
    expectedFeeAmount: options.expectedFeeAmount,
    expectedRecipientAmount: options.expectedRecipientAmount,
  };
}

function decodeSystemFlow(
  instruction: SolanaInstructionObservation,
  name: string,
  data: Uint8Array,
  execution: Execution,
): SolanaAssetFlow {
  const withSeed = name === 'TransferSolWithSeed';
  const decoded = withSeed
    ? getTransferSolWithSeedInstructionDataDecoder().decode(data)
    : getTransferSolInstructionDataDecoder().decode(data);
  const source = accountAt(instruction, 0, 'SOL source');
  const destination = accountAt(instruction, withSeed ? 2 : 1, 'SOL destination');
  return baseFlow({
    instruction,
    family: 'SYSTEM',
    name,
    execution,
    flowKind: 'TRANSFER',
    assetKind: 'NATIVE_SOL',
    sourceAccount: source,
    destinationAccount: destination,
    sourceOwner: notApplicable('Native SOL instructions address ledger accounts directly.'),
    destinationOwner: notApplicable('Native SOL instructions address ledger accounts directly.'),
    mint: notApplicable('Native SOL has no SPL mint account.'),
    authority: withSeed ? accountAt(instruction, 1, 'seed base authority') : source,
    amount: decoded.amount,
    decimals: knownValue(9),
    expectedFeeAmount: knownValue('0'),
    expectedRecipientAmount: knownValue(decoded.amount.toString()),
  });
}

function decodeTokenFlow(options: {
  instruction: SolanaInstructionObservation;
  family: 'SPL_TOKEN' | 'TOKEN_2022';
  name: string;
  data: Uint8Array;
  execution: Execution;
  changes: readonly SolanaTokenBalanceChange[];
}): SolanaAssetFlow {
  const { instruction, family, name, data, execution, changes } = options;
  const isToken2022 = family === 'TOKEN_2022';
  const decodeTransfer = isToken2022
    ? getToken2022TransferInstructionDataDecoder
    : getTransferInstructionDataDecoder;
  const decodeTransferChecked = isToken2022
    ? getToken2022TransferCheckedInstructionDataDecoder
    : getTransferCheckedInstructionDataDecoder;
  const decodeMint = isToken2022
    ? getToken2022MintToInstructionDataDecoder
    : getMintToInstructionDataDecoder;
  const decodeMintChecked = isToken2022
    ? getToken2022MintToCheckedInstructionDataDecoder
    : getMintToCheckedInstructionDataDecoder;
  const decodeBurn = isToken2022
    ? getToken2022BurnInstructionDataDecoder
    : getBurnInstructionDataDecoder;
  const decodeBurnChecked = isToken2022
    ? getToken2022BurnCheckedInstructionDataDecoder
    : getBurnCheckedInstructionDataDecoder;
  let amount: bigint;
  let decimals: NumberKnowledge;
  let source: StringKnowledge;
  let destination: StringKnowledge;
  let mint: StringKnowledge;
  let authority: StringKnowledge;
  let fee: StringKnowledge = knownValue('0');
  let recipient: StringKnowledge;
  let flowKind: 'TRANSFER' | 'MINT' | 'BURN';

  if (name === 'Transfer') {
    const decoded = decodeTransfer().decode(data);
    amount = decoded.amount;
    source = accountAt(instruction, 0, 'source token account');
    destination = accountAt(instruction, 1, 'destination token account');
    mint = mintForAccounts([source, destination], execution, changes);
    decimals = decimalsForMint(mint, changes);
    authority = accountAt(instruction, 2, 'transfer authority');
    flowKind = 'TRANSFER';
  } else if (name === 'TransferChecked' || name === 'TransferCheckedWithFee') {
    if (name === 'TransferCheckedWithFee') {
      const decoded = getTransferCheckedWithFeeInstructionDataDecoder().decode(data);
      amount = decoded.amount;
      decimals = knownValue(decoded.decimals);
      fee = knownValue(decoded.fee.toString());
    } else {
      const decoded = decodeTransferChecked().decode(data);
      amount = decoded.amount;
      decimals = knownValue(decoded.decimals);
    }
    source = accountAt(instruction, 0, 'source token account');
    mint = accountAt(instruction, 1, 'token mint');
    destination = accountAt(instruction, 2, 'destination token account');
    authority = accountAt(instruction, 3, 'transfer authority');
    flowKind = 'TRANSFER';
  } else if (name === 'MintTo' || name === 'MintToChecked') {
    mint = accountAt(instruction, 0, 'token mint');
    source = notApplicable('Mint issuance has no source token account.');
    destination = accountAt(instruction, 1, 'mint destination token account');
    authority = accountAt(instruction, 2, 'mint authority');
    if (name === 'MintToChecked') {
      const decoded = decodeMintChecked().decode(data);
      amount = decoded.amount;
      decimals = knownValue(decoded.decimals);
    } else {
      const decoded = decodeMint().decode(data);
      amount = decoded.amount;
      decimals = decimalsForMint(mint, changes);
    }
    flowKind = 'MINT';
  } else {
    source = accountAt(instruction, 0, 'burn source token account');
    mint = accountAt(instruction, 1, 'token mint');
    destination = notApplicable('Burn destroys supply and has no destination token account.');
    authority = accountAt(instruction, 2, 'burn authority');
    if (name === 'BurnChecked') {
      const decoded = decodeBurnChecked().decode(data);
      amount = decoded.amount;
      decimals = knownValue(decoded.decimals);
    } else {
      const decoded = decodeBurn().decode(data);
      amount = decoded.amount;
      decimals = decimalsForMint(mint, changes);
    }
    flowKind = 'BURN';
  }

  if (flowKind === 'TRANSFER') {
    if (isToken2022 && name !== 'TransferCheckedWithFee') {
      fee = unknownValue(
        'NOT_QUERIED',
        'Token-2022 fee/net output requires the same-Snapshot mint extension state.',
      );
      recipient = unknownValue(
        'NOT_QUERIED',
        'Token-2022 transfer fees or hooks may change the recipient amount.',
      );
    } else if (fee.state === 'known') {
      const expected = amount - BigInt(fee.value);
      recipient =
        expected < 0n
          ? unknownValue('INVALID_INPUT', 'Expected fee exceeds the instructed amount.')
          : knownValue(expected.toString());
    } else {
      recipient = unknownValue('INSUFFICIENT_DATA');
    }
  } else {
    recipient =
      flowKind === 'MINT'
        ? knownValue(amount.toString())
        : notApplicable('Burned supply has no recipient amount.');
  }

  const sourceOwner =
    flowKind === 'MINT'
      ? notApplicable('Mint issuance has no source token-account owner.')
      : ownerForAccount(source, 'source', changes);
  const destinationOwner =
    flowKind === 'BURN'
      ? notApplicable('Burned supply has no destination token-account owner.')
      : ownerForAccount(destination, 'destination', changes);
  const assetKind =
    mint.state === 'known' && mint.value === WRAPPED_SOL_MINT
      ? 'WRAPPED_SOL'
      : isToken2022
        ? 'TOKEN_2022'
        : 'SPL_TOKEN';
  return baseFlow({
    instruction,
    family,
    name,
    execution,
    flowKind,
    assetKind,
    sourceAccount: source,
    destinationAccount: destination,
    sourceOwner,
    destinationOwner,
    mint,
    authority,
    amount,
    decimals,
    expectedFeeAmount: fee,
    expectedRecipientAmount: recipient,
  });
}

function decodeInstruction(options: {
  instruction: SolanaInstructionObservation;
  execution: Execution;
  tokenBalanceChanges: readonly SolanaTokenBalanceChange[];
}): InstructionDecode {
  const { instruction, execution, tokenBalanceChanges } = options;
  const family = programFamilyFor(instruction.programId);
  if (family === 'UNRESOLVED' || family === 'OTHER') {
    return {
      instruction: {
        ...instruction,
        programSemantic:
          family === 'UNRESOLVED'
            ? unknownValue('INSUFFICIENT_DATA', 'Program ID is unresolved.')
            : unknownValue(
                'UNSUPPORTED',
                'No official System/SPL decoder applies to this program.',
              ),
      },
      officialProgram: false,
      decoded: false,
      assetFlowCandidate: false,
      unmodeledTokenEffect: false,
    };
  }
  const data = bs58.decode(instruction.dataBase58);
  try {
    const identified = semanticName(family, data);
    const semantic: ProgramSemantic = {
      programFamily: family,
      instructionName: identified.name,
      category: identified.category,
      application: applicationFor(execution),
    };
    const assetFlowCandidate =
      identified.category === 'ASSET_TRANSFER' ||
      identified.category === 'SUPPLY_INCREASE' ||
      identified.category === 'SUPPLY_DECREASE';
    const flow = assetFlowCandidate
      ? family === 'SYSTEM'
        ? decodeSystemFlow(instruction, identified.name, data, execution)
        : decodeTokenFlow({
            instruction,
            family,
            name: identified.name,
            data,
            execution,
            changes: tokenBalanceChanges,
          })
      : undefined;
    return {
      instruction: { ...instruction, programSemantic: knownValue(semantic) },
      officialProgram: true,
      decoded: true,
      assetFlowCandidate,
      ...(flow === undefined ? {} : { flow }),
      unmodeledTokenEffect:
        family !== 'SYSTEM' && !assetFlowCandidate && isUnmodeledTokenEffect(identified.name),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Official instruction decoder failed.';
    return {
      instruction: {
        ...instruction,
        programSemantic: unknownValue(
          'INVALID_INPUT',
          `Official ${family} decoder rejected the instruction: ${detail}`,
        ),
      },
      officialProgram: true,
      decoded: false,
      assetFlowCandidate: true,
      unmodeledTokenEffect: family !== 'SYSTEM',
    };
  }
}

function knowledgeCoverage(flow: SolanaAssetFlow): number {
  const required: Array<{ state: string }> = [
    flow.sourceAccount,
    flow.destinationAccount,
    flow.authority,
    flow.amount,
    flow.decimals,
  ];
  if (flow.assetKind !== 'NATIVE_SOL') required.push(flow.mint);
  if (flow.flowKind !== 'MINT' && flow.assetKind !== 'NATIVE_SOL') {
    required.push(flow.sourceOwner);
  }
  if (flow.flowKind !== 'BURN' && flow.assetKind !== 'NATIVE_SOL') {
    required.push(flow.destinationOwner);
  }
  if (flow.flowKind === 'TRANSFER') {
    required.push(flow.expectedFeeAmount, flow.expectedRecipientAmount);
  }
  return required.filter((value) => value.state === 'known').length / required.length;
}

function tokenFlowReconciliation(options: {
  flows: readonly SolanaAssetFlow[];
  changes: readonly SolanaTokenBalanceChange[];
  execution: Execution;
  innerInstructionRecordingComplete: boolean;
  unmodeledTokenInstructionCount: number;
}): SolanaTokenFlowReconciliation {
  const tokenFlows = options.flows.filter((flow) => flow.assetKind !== 'NATIVE_SOL');
  if (tokenFlows.length === 0 && options.changes.length === 0) {
    return {
      status: 'NOT_APPLICABLE',
      expectedIdentityCount: 0,
      observedIdentityCount: 0,
      matchedIdentityCount: 0,
      conflictingIdentityCount: 0,
      unknownIdentityCount: 0,
      unmodeledTokenInstructionCount: options.unmodeledTokenInstructionCount,
      coverage: 1,
      recommendedMaxRelativeError: 0,
      observedRelativeError: unknownValue('NOT_APPLICABLE', 'No token balance effect exists.'),
      detail: 'No decoded or recorded token balance effect exists in this transaction.',
    };
  }

  type Expected = { amount: bigint; complete: boolean };
  const expected = new Map<string, Expected>();
  const mark = (
    account: StringKnowledge,
    mint: StringKnowledge,
    amount: StringKnowledge,
    sign: 1n | -1n,
  ) => {
    if (account.state !== 'known' || mint.state !== 'known' || amount.state !== 'known') return;
    const key = `${account.value}:${mint.value}`;
    const existing = expected.get(key) ?? { amount: 0n, complete: true };
    existing.amount += BigInt(amount.value) * sign;
    expected.set(key, existing);
  };
  for (const flow of tokenFlows) {
    if (flow.application === 'UNKNOWN') continue;
    const effectAmount = flow.application === 'NOT_APPLIED' ? knownValue('0') : flow.amount;
    if (flow.flowKind === 'TRANSFER') {
      mark(flow.sourceAccount, flow.mint, effectAmount, -1n);
      const destinationAmount =
        flow.application === 'NOT_APPLIED' ? knownValue('0') : flow.expectedRecipientAmount;
      mark(flow.destinationAccount, flow.mint, destinationAmount, 1n);
      if (destinationAmount.state !== 'known' && flow.destinationAccount.state === 'known') {
        const key =
          flow.mint.state === 'known'
            ? `${flow.destinationAccount.value}:${flow.mint.value}`
            : undefined;
        if (key !== undefined) expected.set(key, { amount: 0n, complete: false });
      }
    } else if (flow.flowKind === 'MINT') {
      mark(flow.destinationAccount, flow.mint, effectAmount, 1n);
    } else {
      mark(flow.sourceAccount, flow.mint, effectAmount, -1n);
    }
  }

  const observed = new Map<string, SolanaTokenBalanceChange['deltaAmount']>();
  for (const change of options.changes) {
    if (change.account.state === 'known') {
      observed.set(`${change.account.value}:${change.mint}`, change.deltaAmount);
    }
  }
  let matched = 0;
  let conflicts = 0;
  let unknown = 0;
  let absoluteError = 0n;
  let absoluteExpected = 0n;
  for (const [key, value] of expected) {
    const actual = observed.get(key);
    if (!value.complete || actual?.state !== 'known') {
      unknown += 1;
      continue;
    }
    const actualAmount = BigInt(actual.value);
    absoluteExpected += value.amount < 0n ? -value.amount : value.amount;
    const error = actualAmount - value.amount;
    const absolute = error < 0n ? -error : error;
    absoluteError += absolute;
    if (error === 0n) matched += 1;
    else conflicts += 1;
  }
  for (const [key, actual] of observed) {
    if (expected.has(key) || actual.state !== 'known' || actual.value === '0') continue;
    if (options.unmodeledTokenInstructionCount > 0 || !options.innerInstructionRecordingComplete) {
      unknown += 1;
    } else {
      conflicts += 1;
      absoluteError += BigInt(actual.value) < 0n ? -BigInt(actual.value) : BigInt(actual.value);
    }
  }
  const denominator = Math.max(expected.size, matched + conflicts + unknown);
  const coverage = denominator === 0 ? 0 : (matched + conflicts) / denominator;
  const incomplete =
    unknown > 0 ||
    options.unmodeledTokenInstructionCount > 0 ||
    !options.innerInstructionRecordingComplete ||
    options.execution === 'METADATA_UNAVAILABLE';
  const status = conflicts > 0 ? 'CONFLICT' : incomplete ? 'PARTIAL' : 'MATCHED';
  const relativeError =
    incomplete || absoluteExpected === 0n
      ? unknownValue(
          incomplete ? 'INSUFFICIENT_DATA' : 'NOT_APPLICABLE',
          incomplete
            ? 'Exact relative error requires complete token effects and balance recording.'
            : 'Relative error has no non-zero expected denominator.',
        )
      : knownValue(Number((absoluteError * 1_000_000_000_000n) / absoluteExpected) / 1e12);
  return {
    status,
    expectedIdentityCount: expected.size,
    observedIdentityCount: observed.size,
    matchedIdentityCount: matched,
    conflictingIdentityCount: conflicts,
    unknownIdentityCount: unknown,
    unmodeledTokenInstructionCount: options.unmodeledTokenInstructionCount,
    coverage,
    recommendedMaxRelativeError: 0,
    observedRelativeError: relativeError,
    detail:
      status === 'MATCHED'
        ? 'Every modeled token-account atomic delta matched exactly; integer accounting tolerance is zero.'
        : status === 'CONFLICT'
          ? 'At least one modeled atomic token delta conflicts with the recorded pre/post balance effect.'
          : 'The comparison is partial because at least one effect, owner, extension, CPI, or balance side is unavailable.',
  };
}

export function analyzeSolanaAssetFlows(options: {
  instructions: readonly SolanaInstructionObservation[];
  execution: Execution;
  tokenBalanceChanges: readonly SolanaTokenBalanceChange[];
  innerInstructionRecordingComplete: boolean;
}): SolanaAssetFlowAnalysis {
  const decoded = options.instructions.map((instruction) =>
    decodeInstruction({
      instruction,
      execution: options.execution,
      tokenBalanceChanges: options.tokenBalanceChanges,
    }),
  );
  const official = decoded.filter((item) => item.officialProgram);
  const assetCandidates = decoded.filter((item) => item.assetFlowCandidate);
  const flows = decoded.flatMap((item) => (item.flow === undefined ? [] : [item.flow]));
  const unmodeledTokenInstructionCount = decoded.filter((item) => item.unmodeledTokenEffect).length;
  const flowCoverage =
    assetCandidates.length === 0
      ? unknownValue('NOT_APPLICABLE', 'No supported core asset-flow instruction was observed.')
      : knownValue(
          flows.reduce((sum, flow) => sum + knowledgeCoverage(flow), 0) / assetCandidates.length,
        );
  return {
    instructions: decoded.map((item) => item.instruction),
    officialProgramInstructionCount: official.length,
    identifiedOfficialProgramInstructionCount: official.filter((item) => item.decoded).length,
    officialProgramIdentificationCoverage:
      official.length === 0
        ? unknownValue(
            'NOT_APPLICABLE',
            'No System, SPL Token, or Token-2022 instruction was observed.',
          )
        : knownValue(official.filter((item) => item.decoded).length / official.length),
    assetFlowCandidateCount: assetCandidates.length,
    assetFlowDecodeCoverage:
      assetCandidates.length === 0
        ? unknownValue('NOT_APPLICABLE', 'No supported core asset-flow instruction was observed.')
        : knownValue(flows.length / assetCandidates.length),
    assetFlowCoverage: flowCoverage,
    assetFlows: flows,
    tokenFlowReconciliation: tokenFlowReconciliation({
      flows,
      changes: options.tokenBalanceChanges,
      execution: options.execution,
      innerInstructionRecordingComplete: options.innerInstructionRecordingComplete,
      unmodeledTokenInstructionCount,
    }),
  };
}
